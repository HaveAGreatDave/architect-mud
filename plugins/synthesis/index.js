/**
 * Synthesis plugin — cook reagents into drugs.
 *
 * `cook`                → list chemistry recipes you can attempt (+ what you're missing)
 * `cook <recipe>`       → validate reagents/skill/station, then open the "stabilize
 *                         the reaction" minigame (server sends `synth_minigame`)
 * `synthresolve <id> <score>` → internal: the client reports its 0–100 minigame
 *                         score; the server rolls the authoritative 2d8−2d8
 *                         chemistry check, folds in the minigame score + station
 *                         bonus, and on success produces a POTENCY-scaled drug.
 *
 * Skill AND minigame both matter: the check is server-authoritative (guarded by a
 * pending+TTL entry so a stale/forged resolve is ignored), but a good cook adds
 * margin → higher potency (baked into the drug item's custom_data, read by
 * useDrug) and a botch can blow up in your face. Cook at a chem-lab station
 * (quality bonus) or with a cook kit anywhere (penalty). Reuses the crafting
 * recipe cache + the 2d8−2d8 skillCheck; recipes/reagents/labs are content.
 */
import { query, withTransaction } from '../../server/models/db.js';
import { getRecipeCache, findRecipeByName } from '../../server/engine/crafting.js';
import { skillCheck, awardSkillUse, skillStatBonus } from '../../server/engine/skills.js';
import { randomUUID } from 'crypto';

const SYNTH_SKILL = 'chemistry';
const PENDING_TTL_MS = 180000;
const pendingSynth = new Map(); // playerId -> { recipeId, contextBonus, mode, ts }

function synthRecipes() {
  return Object.values(getRecipeCache()).filter(r => r.skill_id === SYNTH_SKILL);
}

async function playerInventory(playerId) {
  const { rows } = await query(
    `SELECT pi.id, pi.item_id, pi.quantity, i.name FROM player_inventory pi
     JOIN items i ON i.id = pi.item_id WHERE pi.player_id = $1 AND pi.is_equipped = 0`,
    [playerId]
  );
  return rows;
}

// Resolve reagents against inventory → { toConsume } or { missing }.
function resolveIngredients(recipe, inventory) {
  const toConsume = [];
  for (const ing of recipe.ingredients || []) {
    if (!ing.item_id || !ing.quantity) continue;
    const found = inventory.find(inv => inv.item_id === ing.item_id && inv.quantity >= ing.quantity);
    if (!found) return { missing: ing };
    toConsume.push({ invId: found.id, quantity: ing.quantity, currentQty: found.quantity });
  }
  return { toConsume };
}

// Chem-lab furniture in the zone, or a carried cook kit, or nothing.
async function findWorkspace(recipe, player) {
  const wantStation = recipe.requires_station || null;
  if (wantStation) {
    const { rows } = await query(
      `SELECT flags FROM furniture WHERE zone_id = $1 AND flags->>'crafting_station' = $2 LIMIT 1`,
      [player.current_zone, wantStation]
    );
    if (rows.length) {
      const q = rows[0].flags?.station_quality;
      const bonus = q === 'pristine' ? 4 : q === 'refined' ? 2 : 0;
      return { mode: 'lab', contextBonus: bonus, label: 'the lab' };
    }
  }
  const { rows: kit } = await query(
    `SELECT 1 FROM player_inventory pi JOIN items i ON i.id = pi.item_id
     WHERE pi.player_id = $1 AND jsonb_exists(i.tags, 'cook_kit') LIMIT 1`,
    [player.id]
  );
  if (kit.length) return { mode: 'kit', contextBonus: -3, label: 'your cook kit' };
  return null;
}

async function cmdCook(args, raw, player, broadcast) {
  const recipes = synthRecipes();
  if (!recipes.length) return { type: 'error', message: 'You know no way to cook anything.' };

  const name = args.join(' ').trim();
  if (!name) {
    const inv = await playerInventory(player.id);
    const lines = recipes.map(r => {
      const res = resolveIngredients(r, inv);
      const ready = !res.missing;
      const need = (r.ingredients || []).map(ing => `${ing.quantity}x ${ing.item_id.replace(/^item_/, '').replace(/_/g, ' ')}`).join(', ');
      return `<span class="${ready ? 'safe' : 'system'}">${ready ? '✓' : '·'} ${r.name}</span> — ${need}`;
    });
    return { type: 'output', message: `<span class="msg-system">You can cook:</span>\n${lines.join('\n')}\n<span class="msg-system">Use "cook &lt;name&gt;" at a chem lab or with a cook kit.</span>` };
  }

  const recipe = findRecipeByName(name);
  if (!recipe || recipe.skill_id !== SYNTH_SKILL) return { type: 'error', message: `You don't know how to cook "${name}".` };

  // Skill-rank gate (level + stat bonus), matching the crafting requirement style.
  const { rows: skillRows } = await query('SELECT skill_id, ip FROM player_skills WHERE player_id=$1', [player.id]);
  const levels = {};
  for (const r of skillRows) levels[r.skill_id] = Math.floor((r.ip || 0) / 100);
  for (const [sid, minRank] of Object.entries(recipe.skill_req || {})) {
    if ((levels[sid] || 0) + skillStatBonus(player, sid) < minRank) {
      return { type: 'error', message: `You need ${sid.replace(/_/g, ' ')} rank ${minRank} to attempt this cook.` };
    }
  }

  const inv = await playerInventory(player.id);
  const res = resolveIngredients(recipe, inv);
  if (res.missing) {
    const { rows } = await query('SELECT name FROM items WHERE id=$1', [res.missing.item_id]);
    return { type: 'error', message: `You need ${res.missing.quantity}x ${rows[0]?.name || res.missing.item_id}.` };
  }

  const ws = await findWorkspace(recipe, player);
  if (!ws) {
    const need = (recipe.requires_station || 'chem_lab').replace(/_/g, ' ');
    return { type: 'error', message: `You need a ${need} or a cook kit to attempt this.` };
  }

  pendingSynth.set(player.id, { recipeId: recipe.id, contextBonus: ws.contextBonus, mode: ws.mode, ts: Date.now() });
  return {
    type: 'synth_minigame',
    recipeId: recipe.id,
    recipeName: recipe.name,
    difficulty: recipe.base_difficulty ?? 5,
    workspace: ws.label,
  };
}

function qualityFor(margin) {
  if (margin >= 6) return 'pristine';
  if (margin >= 3) return 'refined';
  if (margin < 0) return 'scrap';
  return 'common';
}

async function cmdSynthResolve(args, raw, player, broadcast) {
  const recipeId = args[0];
  const score = Math.max(0, Math.min(100, parseInt(args[1], 10) || 0));
  const pending = pendingSynth.get(player.id);
  pendingSynth.delete(player.id);
  if (!pending || pending.recipeId !== recipeId || Date.now() - pending.ts > PENDING_TTL_MS) return { type: 'noop' };

  const recipe = getRecipeCache()[recipeId];
  if (!recipe) return { type: 'error', message: 'The recipe slips out of your head.' };

  const inv = await playerInventory(player.id);
  const res = resolveIngredients(recipe, inv);
  if (res.missing) return { type: 'error', message: "You're missing something now — the cook falls apart." };
  const toConsume = res.toConsume;

  const skillResult = await skillCheck(player, SYNTH_SKILL, recipe.base_difficulty ?? 5);
  const minigameBonus = Math.round((score / 100 - 0.5) * 8); // -4..+4
  const finalMargin = skillResult.margin + minigameBonus + pending.contextBonus;
  const success = finalMargin >= 0;
  const catastrophic = finalMargin < -5;

  const consume = async (q) => {
    for (const c of toConsume) {
      if (c.currentQty <= c.quantity) await q('DELETE FROM player_inventory WHERE id=$1', [c.invId]);
      else await q('UPDATE player_inventory SET quantity=quantity-$1 WHERE id=$2', [c.quantity, c.invId]);
    }
  };

  if (catastrophic) {
    await withTransaction(consume);
    // Toxic byproduct — a flash of heat and acrid smoke.
    const hp = Math.max(0, (player.hp || 0) - 20);
    const sanity = Math.max(0, (player.sanity || 0) - 10);
    player.hp = hp; player.sanity = sanity;
    query('UPDATE players SET hp=$1, sanity=$2 WHERE id=$3', [hp, sanity, player.id]).catch(() => {});
    if (hp <= 0) {
      broadcast(null, { type: 'output', message: `<span class="overdose-warning">The mixture detonates in your hands. The last thing you smell is burning.</span>`, player_update: { hp, sanity } }, null, player.id);
      const { handlePlayerDeath } = await import('../../server/engine/gameLoop.js');
      await handlePlayerDeath(player, null);
      return { type: 'noop' };
    }
    return { type: 'output', message: `<span class="overdose-warning">The reaction runs away from you — a flash of heat, a gout of acrid smoke. The batch is ruined and you're burned.</span>`, player_update: { hp, sanity } };
  }

  if (!success) {
    return { type: 'error', message: `The cook doesn't take. The mixture goes inert and cloudy — a wasted run, but your reagents survive. (margin ${finalMargin})` };
  }

  // Potency baked into the produced drug item — a great cook makes stronger product.
  const potency = Math.max(0.5, Math.min(1.8, Math.round((0.6 + finalMargin * 0.09) * 100) / 100));
  const quality = qualityFor(finalMargin);
  const customData = { potency, quality, synthesized: true };
  const outQty = recipe.base_output?.quantity || 1;
  const outId = recipe.base_output?.item_id;
  const { rows: itemRows } = await query('SELECT name FROM items WHERE id=$1', [outId]);
  const outName = itemRows[0]?.name || recipe.name;

  await withTransaction(async (q) => {
    await consume(q);
    // Non-stacking: each batch's potency is distinct, so always a fresh row.
    await q(
      'INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, custom_data) VALUES ($1,$2,$3,$4,1.0,$5)',
      [randomUUID(), player.id, outId, outQty, JSON.stringify(customData)]
    );
  });

  await awardSkillUse(player.id, SYNTH_SKILL, skillResult.margin);

  const pct = Math.round(potency * 100);
  return {
    type: 'output',
    message: `<span class="ip-gain">The reaction settles clean.</span> You cook ${outQty}x <span class="item">${outName}</span> — <b>${pct}% potency</b> [${quality}].`,
  };
}

export const commands = {
  cook: cmdCook,
  synthesize: cmdCook,
  synthresolve: cmdSynthResolve,
};
