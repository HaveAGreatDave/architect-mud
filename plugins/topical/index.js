/**
 * Topical — the player-facing half of "somebody threw a liquid at you".
 *
 * The substrate is `server/engine/topical.js`: the law (every liquid wets you,
 * claimed once by clothing-wetness), the registries, and the consent gate that
 * every caller inherits rather than remembers. This plugin is the leaf on top —
 * the verb you do it with, the switch that says whether it may be done to you,
 * and the per-fluid consequences that need nothing but engine substrates.
 *
 * WHERE AN EFFECT LIVES. The rule is one line: it is registered by whoever owns
 * the state it writes. Wetness is clothing-wetness's, so the wetting pass is
 * there. Everything below writes only ENGINE substrates — `stainClothing`,
 * `stainZone`, durability's `wear`, damage — which are open to any caller, so
 * they live here rather than being scattered into whichever plugin happens to
 * mention fuel. Anything that needs a plugin's own model (a drug, a mutation, a
 * status effect somebody else owns) belongs in that plugin, not in this file.
 *
 * WHY THE GATE IS AN OPT OUT. Weather is done to everyone and nobody consents to
 * rain, so the gate is narrower than "topical contact": A PLAYER splashing A
 * DIFFERENT PLAYER. That is the only case where a person chose to do it to a
 * person. Everything else — the sky, an NPC, a burst pipe, your own bucket —
 * lands regardless.
 *
 * And it defaults ON. Default-off would mean the world's liquids do nothing to
 * anybody who has never gone looking for a switch, which is a feature that reads
 * as broken. So `sprayconsent off` is there for the person who wants it and
 * costs everyone else nothing — a VERB, with no tablet surface, because the
 * switch you may need in a hurry shouldn't be four taps inside an app. Somebody
 * who has turned it off is never told they were nearly splashed, and the thrower
 * is never told who has it off.
 */
import {
  getTopicalConsent, setTopicalConsent, registerTopicalEffect, registerTopicalDosing,
  describeContainerFluid, applyTopical, fluidInfo, isHarmfulFluid,
} from '../../server/engine/topical.js';
import { useDrug } from '../../server/engine/drugs.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { stainClothing, stainZone } from '../../server/engine/bodily.js';
import { wear, announceWear } from '../../server/engine/durability.js';
import { resolveInventoryItem, resolveInventoryForPlayers } from '../../server/engine/inventory.js';
import { getZonePlayers, getZone } from '../../server/engine/world.js';
import { sendToZoneExcept } from '../../server/engine/messaging.js';

// A splash HURTS but never kills. Deliberate: killing routes through
// handlePlayerDeath, wanted stars, a corpse and possibly jail, and a verb that
// tips a cup out has no business owning any of that — if you want somebody dead,
// `attack` them. So this floors at 1 HP and rides the combat system's own
// coalesced resource flush rather than writing the row itself.
function burn(player, amount) {
  const before = player.hp ?? player.hp_max ?? 100;
  player.hp = Math.max(1, before - Math.max(0, Math.round(amount)));
  player._resDirty = true;
  return before - player.hp;
}

// ── What crosses the skin ───────────────────────────────────────────────────
//
// The substrate computes the DOSE (potency × the liquid's permeability × how
// much got past the clothes) and knows no drug ids; this pass is the one place
// that turns that number into an actual dose, through the ordinary `useDrug`
// path on the `skin` route. So a splashed drug is the SAME drug, at a fraction
// of the strength, arriving slowly — not a parallel implementation of being
// high.
//
// The `drug` rides on the container, not the fluid table: a solvent is a
// carrier, and what it carries is whatever was dissolved in it.
registerTopicalDosing(async (player, { drug, dose = 0, potencyMult = 1, broadcast }) => {
  if (!drug || dose <= 0) return null;
  await useDrug(player, drug, broadcast, {
    route: 'skin',
    // The absorbed fraction IS the strength. A batch multiplier still rides on
    // top, so strong product splashed on you is worse than weak product.
    potencyMult: Math.max(0.1, dose * potencyMult),
  }).catch(() => {});
  return null;   // no message: the drug prints its own, and the liquid prints the rest
});

// ── The per-fluid consequences ──────────────────────────────────────────────

// Where a thrown liquid lands on a body. Deliberately not every slot: you throw
// it AT someone, front-on, and the rain model already covers water from above.
const SPLASH_SLOTS = ['head', 'torso'];

// Anything with a `stain` in the substrate's table leaves that contaminant on
// the clothes it hit — which is what makes hygiene, the smell command and NPC
// reactions notice, with no new plumbing. One registration per fluid rather than
// a loop with a branch inside it, so a fluid that later wants MORE than a stain
// has an obvious place to grow.
function stainer(type) {
  return async (player) => {
    await stainClothing(player, SPLASH_SLOTS, type).catch(() => {});
    return null;   // no message: the wetting pass already said what landed
  };
}
for (const [fluid, info] of Object.entries({
  dirty_water: { stain: 'grease' }, fuel: { stain: 'fuel' }, booze: { stain: 'booze' },
  soft_drink: { stain: 'grease' }, blood: { stain: 'blood' }, chem: { stain: 'chem' },
})) registerTopicalEffect(fluid, stainer(info.stain));

// Acid eats gear. This is the same sanctioned exception to the durability rule
// ("wear accrues on use, never on the clock") that acid RAIN already takes: it
// isn't the clock, it's a thing that happened to you. `wear` is sync by
// contract, so this adds no round trips.
const ACID_WEAR_POINTS = 14;      // one faceful ≈ three minutes in an acid storm
const ACID_DAMAGE = 4;
registerTopicalEffect('acid', async (player, { potency = 1 }) => {
  await stainClothing(player, SPLASH_SLOTS, 'chem').catch(() => {});
  const worn = (await resolveInventoryForPlayers([player.id], { equipped: true, topLevel: false })
    .then(m => m.get(player.id))) || [];
  for (const item of worn) {
    announceWear(player, item, wear(player, item, ACID_WEAR_POINTS * potency, 'acid'));
  }
  burn(player, ACID_DAMAGE * potency);
  return { message: '<span class="text-red">It lands stinging and keeps stinging — it is eating into everything it touched.</span>' };
});

// Scalding. Small numbers on purpose: this is a bar-fight insult that happens to
// hurt, not a weapon, and the coffee is cold in twenty minutes either way.
const SCALD_DAMAGE = 3;
registerTopicalEffect('hot_drink', async (player, { potency = 1 }) => {
  await stainClothing(player, SPLASH_SLOTS, 'grease').catch(() => {});
  burn(player, Math.max(1, SCALD_DAMAGE * potency));
  return { message: '<span class="text-red">It lands scalding. You are wearing it, and it is still hot.</span>' };
});

// ── splash ──────────────────────────────────────────────────────────────────
//
// `splash <target> [with <container>]` — tip what you're carrying over somebody.
// NOT named `douse`: the work plugin owns that verb for a bar shift's fire
// event, and quietly winning a collision off load order is how a whole feature
// goes dead with no error.
//
// The verb decides WHO and WHETHER YOU HAVE IT. What the liquid is, what it
// does, and whether it may touch that particular person are all the substrate's
// — which is why there is no fluid branch anywhere in here.
async function cmdSplash(args, raw, player, broadcast) {
  const words = args.join(' ').trim();
  if (!words) return { type: 'error', message: 'Splash whom? (<span class="text-dim">splash &lt;target&gt; with &lt;container&gt;</span>)' };

  const [targetName, containerName] = words.split(/\s+with\s+/i);
  const zone = getZone(player.current_zone);
  if (!zone) return { type: 'error', message: 'Not here.' };

  // Players only, and only in this room. An NPC has no wetness, no hygiene map
  // and nothing to feel it — dressing that up as a hit would be a lie.
  const needle = (targetName || '').trim().toLowerCase();
  const target = getZonePlayers(player.current_zone)
    .find(p => p.id !== player.id && (p.handle || '').toLowerCase().startsWith(needle));
  if (!target) return { type: 'error', message: `You can't see ${targetName || 'them'} here.` };

  // Both container families, because the whole point of the expansion is that
  // any liquid counts — a canteen and a cocktail glass are the same question.
  // Unnamed, we take the first thing that actually has something in it rather
  // than the first fillable, which is otherwise reliably the empty canteen.
  const carried = await resolveInventoryItem(player, {
    tag: ['fillable', 'drinkware'], name: (containerName || '').trim() || undefined,
    topLevel: true, all: true }) || [];
  const rows = Array.isArray(carried) ? carried : [carried];
  let item = null, held = null;
  for (const row of rows) {
    const d = describeContainerFluid(row);
    if (d) { item = row; held = d; break; }
  }
  if (!item) {
    if (containerName) {
      const named = rows[0];
      return { type: 'error', message: named
        ? `The ${named.name} is empty.`
        : `You aren't carrying a ${containerName}.` };
    }
    return { type: 'error', message: "You aren't carrying anything with liquid in it." };
  }

  const info = fluidInfo(held.fluid);
  const res = await applyTopical(target, {
    fluid: held.fluid, potency: held.potency, actor: player, broadcast,
    drug: held.drug, potencyMult: held.potencyMult,
    source: `${player.handle} throws ${held.label} over you`,
  });

  // The container empties whether or not it landed — you tipped it out either
  // way, and a refusal that quietly refilled your glass would be a free retry
  // and a way to probe who has opted in.
  if (held.empty) await held.empty(item.inv_id ?? item.id).catch(() => {});

  if (res.message) broadcast(null, { type: 'output', message: res.message }, null, target.id);

  if (!res.applied) {
    // Same words the actor would get for a miss. Nothing here says "opted out".
    return { type: 'output', message: `<span class="text-dim">You tip the ${item.name} out over ${target.handle}, and somehow it comes to nothing.</span>` };
  }

  // The room sees it, because being seen is most of the point.
  sendToZoneExcept(player.current_zone, {
    type: 'zone_event',
    message: `<span class="text-amber">${player.handle} throws ${held.label} over ${target.handle}.</span>`,
  }, new Set([player.id, target.id]));
  // …and so does the floor. `fuel` has no floor entry of its own — solvent is
  // what a puddle of it smells like, and inventing a stain type nothing reads
  // would be a smell nobody could ever notice.
  if (info.stain) stainZone(player.current_zone, info.stain === 'fuel' ? 'chem' : info.stain);

  // Throwing something that HARMS, or that got into somebody, is an assault —
  // and the victim is a witness by definition, so it is charged forced-witnessed
  // rather than rolled for. A drink in the face is not; that's a bar, not a
  // crime scene, and charging it would make the funniest verb in the game a
  // four-star mistake.
  if (isHarmfulFluid(held.fluid) || (res.dose || 0) > 0) {
    await dispatchAction({
      type: 'CHARGE_CRIME', actor: player,
      params: { key: 'assault_chemical', zoneId: player.current_zone },
    }).catch(() => {});
  }

  return { type: 'output', message: isHarmfulFluid(held.fluid)
    ? `<span class="text-red">You throw ${held.label} over ${target.handle}. That was not a joke and everybody here knows it.</span>`
    : `<span class="text-cyan">You throw ${held.label} over ${target.handle}.</span>` };
}

// ── sprayconsent ────────────────────────────────────────────────────────────
const HELP = '<span class="text-dim">sprayconsent off</span> — stop other players getting liquid on you (a thrown drink, a crop-duster pass).\n'
           + '<span class="text-dim">sprayconsent on</span> — allow it again. It starts on. Weather and your own hand are unaffected either way.\n'
           + '<span class="text-dim">Type it anywhere — no tablet needed.</span>';

async function cmdSprayConsent(args, raw, player) {
  const arg = (args[0] || '').toLowerCase();
  const on = await getTopicalConsent(player);

  if (!arg) {
    return {
      type: 'output',
      message: on
        ? `<span class="text-cyan">Other players CAN get liquid on you.</span>\n${HELP}`
        : `<span class="text-dim">Other players CANNOT get liquid on you. Anything they aim at you comes to nothing.</span>\n${HELP}`,
    };
  }
  if (!['on', 'off', 'yes', 'no'].includes(arg)) return { type: 'output', message: HELP };

  const want = arg === 'on' || arg === 'yes';
  if (want === on) {
    return { type: 'output', message: want
      ? 'Other players could already get liquid on you.'
      : 'They already couldn\'t.' };
  }
  await setTopicalConsent(player, want);
  return {
    type: 'output',
    message: want
      ? '<span class="text-cyan">Back on.</span> <span class="text-dim">Other players can get liquid on you. Turn it off again any time with</span> sprayconsent off<span class="text-dim">.</span>'
      : '<span class="text-dim">Off. Nothing another player throws will touch you — the weather still will.</span>',
  };
}

export const commands = {
  sprayconsent: (args, raw, player) => cmdSprayConsent(args, raw, player),
  splash: (args, raw, player, broadcast) => cmdSplash(args, raw, player, broadcast),
};

export const _test = { SPLASH_SLOTS, ACID_WEAR_POINTS };
