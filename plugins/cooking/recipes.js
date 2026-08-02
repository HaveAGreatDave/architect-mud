// `recipe` — the half of the cookbook you write yourself.
//
// The authored catalog is 47 dishes and belongs to the game. Improvised dishes
// (improvised.js) are named by the game too, off what went in. This is where a
// player takes one over: saving costs nothing and gates nothing — it is a LABEL
// on a signature you already cooked — and the payoff is that the game starts
// calling your invention what you call it, plus the same small sub-band nudge
// the authored cookbook pays for knowing what you're making.
//
// SHARING IS TWO SHAPES ON PURPOSE, because they cover different situations. A
// CARD is an object: sellable, findable on a corpse, leavable on a table, and it
// travels through the trade system that already exists rather than through a
// new one. `teach` is what you do when the other person is standing right there
// and neither of you wants to find a pen.
import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { resolveInventoryItem } from '../../server/engine/inventory.js';
import { getZonePlayers } from '../../server/engine/world.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { resolve as siftResolve } from '../../server/engine/sift.js';
import { savedRecipes, saveRecipe, renameRecipe, forgetRecipe, slugify } from './knowledge.js';

// The blank a player writes on. One content item for every recipe anybody ever
// invents, exactly the way all 48 cooked dishes share `item_cooked_dish` — the
// name and the payload ride on `custom_data`.
export const WRITTEN_CARD = 'item_written_recipe';

// Find one of the player's saved recipes by name or slug, loosely — exact match
// first so a recipe called "stew" is reachable even when "beef stew" exists.
function findSaved(saved, nameStr) {
  const q = String(nameStr || '').trim().toLowerCase();
  if (!q) return null;
  for (const [slug, blob] of saved) {
    if (slug === q || blob.name.toLowerCase() === q) return { slug, ...blob };
  }
  for (const [slug, blob] of saved) {
    if (blob.name.toLowerCase().includes(q) || slug.includes(slugify(q))) return { slug, ...blob };
  }
  return null;
}

export async function cmdRecipe(args, raw, player, broadcast) {
  const sub = (args[0] || '').toLowerCase();
  // Off `raw`, not `args` — the dispatcher lower-cases arguments, and a player
  // who names their invention "Rat Surprise" should get "Rat Surprise". Lookups
  // still match case-insensitively; only the stored label keeps its shape.
  const rest = String(raw || '').trim().split(/\s+/).slice(2).join(' ').trim();
  const saved = await savedRecipes(player.id);

  // ── list ──────────────────────────────────────────────────────────────────
  if (!sub || sub === 'list') {
    if (!saved.size) {
      return { type: 'output', message: `<span class="text-dim">You've written nothing down. Cook something no recipe covers, then <b>recipe save &lt;name&gt;</b> while you're holding it.</span>` };
    }
    const lines = [`<span class="text-bright">Your own recipes</span>`];
    for (const [, blob] of saved) {
      const best = blob.best ? ` <span class="text-dim">(best: ${blob.best})</span>` : '';
      const from = blob.author && blob.author !== player.handle ? ` <span class="text-dim">— from ${blob.author}</span>` : '';
      lines.push(`  <span class="text-bright">${blob.name}</span>${best} <span class="text-dim">· ${blob.family || 'dish'}${blob.vessel ? ` in a ${blob.vessel}` : ''}</span>${from}`);
    }
    return { type: 'output', message: lines.join('\n') };
  }

  // ── save <name> ───────────────────────────────────────────────────────────
  //
  // The DISH ITSELF is the record. You write down what you made while holding
  // it, which is why this needs no "last thing you cooked" state — there is
  // nothing to go stale, and nothing to write on a tick.
  if (sub === 'save') {
    const name = rest.replace(/^as\s+/i, '').trim();
    if (!name) return { type: 'error', message: `Call it what? ("recipe save rat surprise")` };

    const rows = await resolveInventoryItem(player, { topLevel: true, all: true });
    const held = (rows || []).find(r => r.custom_data?.improv);
    if (!held) {
      return { type: 'error', message: `You're not holding anything you invented. Cook something no recipe covers first.` };
    }
    const cd = held.custom_data;
    const res = await saveRecipe(player.id, {
      name, sig: cd.improv, vessel: cd.vessel || null, family: cd.family,
      complexity: cd.complexity, band: cd.cook_quality, author: player.handle,
    });
    if (!res.saved) {
      return { type: 'error', message: `You've already written that one down — you called it ${res.existing.name}. ("recipe rename ${res.existing.name} to ${name}")` };
    }
    // Rename the plate in your hands to match, so the thing you just named is
    // called that now rather than only the next time you make it.
    await query(
      `UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) || jsonb_build_object('name', $2::text) WHERE id=$1`,
      [held.inv_id ?? held.id, name]
    );
    return { type: 'output', message: `You write it down: <span class="text-bright">${name}</span>. Yours now — the game will call it that, and so will anybody you teach.` };
  }

  // ── rename <old> to <new> ─────────────────────────────────────────────────
  //
  // Free, and changes nothing mechanical: the SIGNATURE is the identity and the
  // name is a label. That asymmetry is what lets two players call the same pot
  // different things without either of them breaking.
  if (sub === 'rename') {
    const m = rest.match(/^(.*?)\s+(?:to|as)\s+(.+)$/i);
    if (!m) return { type: 'error', message: `Rename what to what? ("recipe rename rat surprise to house special")` };
    const hit = findSaved(saved, m[1]);
    if (!hit) return { type: 'error', message: `You haven't written down anything called "${m[1].trim()}".` };
    const r = await renameRecipe(player.id, hit.slug, m[2].trim());
    return { type: 'output', message: r.ok ? `${hit.name} is now <span class="text-bright">${r.name}</span>.` : `That didn't take.` };
  }

  // ── forget <name> ─────────────────────────────────────────────────────────
  if (sub === 'forget') {
    const hit = findSaved(saved, rest);
    if (!hit) return { type: 'error', message: `You haven't written down anything called "${rest}".` };
    await forgetRecipe(player.id, hit.slug);
    return { type: 'output', message: `You scratch ${hit.name} out. You can always work it out again.` };
  }

  // ── write <name> — a card, which is an ordinary object ────────────────────
  if (sub === 'write' || sub === 'card') {
    const hit = findSaved(saved, rest);
    if (!hit) return { type: 'error', message: `You haven't written down anything called "${rest}".` };
    await query(
      `INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, custom_data)
       VALUES ($1,$2,$3,1,1.0,$4::jsonb)`,
      [randomUUID(), player.id, WRITTEN_CARD, JSON.stringify({
        name: `recipe card: ${hit.name}`,
        recipe: {
          name: hit.name, sig: hit.sig, vessel: hit.vessel,
          family: hit.family, complexity: hit.complexity, author: hit.author || player.handle,
        },
      })]
    );
    return { type: 'output', message: `You copy ${hit.name} onto a card. Anybody can <b>read</b> it — or buy it off you.` };
  }

  // ── teach <name> to <player> ──────────────────────────────────────────────
  if (sub === 'teach') {
    const m = rest.match(/^(.*?)\s+to\s+(.+)$/i);
    if (!m) return { type: 'error', message: `Teach what to whom? ("recipe teach rat surprise to Vale")` };
    const hit = findSaved(saved, m[1]);
    if (!hit) return { type: 'error', message: `You haven't written down anything called "${m[1].trim()}".` };

    const pool = getZonePlayers(player.current_zone).filter(p => p.id !== player.id).map(p => ({ ...p, name: p.handle }));
    if (!pool.length) return { type: 'error', message: `There's nobody here to teach.` };
    const r = siftResolve(m[2].trim(), pool);
    if (r.type === 'none') return { type: 'error', message: `There's no "${m[2].trim()}" here.` };
    if (r.type === 'ambiguous') return { type: 'error', message: `Who do you mean — ${r.candidates.map(c => c.handle).join(', ')}?` };
    const target = r.candidate;

    // The AUTHOR travels with it. A recipe three players deep still says whose
    // it was, which is the whole social point of a dish having a name.
    const res = await saveRecipe(target.id, {
      name: hit.name, sig: hit.sig, vessel: hit.vessel, family: hit.family,
      complexity: hit.complexity, band: null, author: hit.author || player.handle,
    });
    if (!res.saved) return { type: 'error', message: `${target.handle} already knows how to make that.` };
    sendToPlayer(target.id, { type: 'output', message: `<span class="msg-system">${player.handle} walks you through ${hit.name}. Written down.</span>` });
    broadcast?.(player.current_zone, { type: 'zone_event', message: `${player.handle} talks ${target.handle} through a recipe, describing it with their hands.` }, player.id);
    return { type: 'output', message: `You teach ${target.handle} how to make ${hit.name}.` };
  }

  return {
    type: 'error',
    message: `recipe list | save &lt;name&gt; | rename &lt;a&gt; to &lt;b&gt; | forget &lt;name&gt; | write &lt;name&gt; | teach &lt;name&gt; to &lt;who&gt;`,
  };
}

// A written card learned by `read`. Returns a message, or null if this card
// isn't one of ours.
export async function learnFromWrittenCard(card, player) {
  const blob = card?.custom_data?.recipe;
  if (!blob?.sig) return null;
  const res = await saveRecipe(player.id, {
    name: blob.name, sig: blob.sig, vessel: blob.vessel, family: blob.family,
    complexity: blob.complexity, band: null, author: blob.author || null,
  });
  return res.saved
    ? `You read it twice and it sticks: <span class="text-bright">${blob.name}</span>${blob.author ? `, ${blob.author}'s` : ''}. Written down.`
    : `You already know how to make that. The card goes back in your pocket.`;
}
