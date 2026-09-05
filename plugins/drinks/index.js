/**
 * Drinks — mixology and hot drinks, in a vessel you keep.
 *
 * `mix <thing> into <vessel>` builds; `mix <vessel>` resolves the build into a
 * drink; `brew <vessel>` does the same at a hot-water appliance and stamps the
 * result hot. `drink <vessel>` takes one serving. `pour <a> into <b>` decants.
 * `rinse <vessel>` gets the last drink out of it.
 *
 * THE ONE DESIGN DECISION everything else follows from: a finished drink lives
 * on the vessel's `player_inventory.custom_data`, not as a new item row. A row
 * would consume the vessel, and the whole point of drinkware is that you carry
 * it, drink it down, and still have a cup. vessel.js owns that JSON shape.
 *
 * Alcohol is DERIVED from what went in (alcohol.js) and lands through the
 * existing `useDrug(..., 'drug_alcohol', { potencyMult })` path — the identical
 * call applyItemUse makes for a bottled cocktail — so intox, phases, tolerance
 * and overdose behave exactly as they always have. Nothing here reimplements
 * being drunk.
 */
import { query } from '../../server/models/db.js';
import { adjustSanity } from '../../server/engine/condition.js';
import { registerAction, dispatchAction, getRegisteredActions } from '../../server/engine/actions.js';
import { resolveInventoryItem } from '../../server/engine/inventory.js';
import { getZoneFurniture, getZone } from '../../server/engine/world.js';
import { sendToZone } from '../../server/engine/messaging.js';
import { skillCheck, awardSkillUse } from '../../server/engine/skills.js';
import { useDrug } from '../../server/engine/drugs.js';
import { isPluggedIn } from '../appliances/index.js';
import { applyWarmth } from '../../server/engine/warmth.js';
import { registerFluidResolver } from '../../server/engine/topical.js';

// A hot drink is the cheapest cold-weather gear in the game and the only kind you can carry
// in your hands. Worth about a wool hat while it lasts, and it does not last long.
const WARM_DRINK_C = 4;
const WARM_DRINK_MIN = 12;   // game-minutes at full heat, tapering to nothing
import {
  DRINKS, UNKNOWN_DRINK, signature, matchDrink, drinkName, composeBand,
  seasoningBonus, DRINKWARE_KINDS, describeRecipe,
} from './recipes.js';
import { DRINK_PROFILES, profileNameFor, poursOf, isModifierProfile, isMediumProfile, bandIndex, QUALITY_BANDS } from './profiles.js';
import { derivePotency, abvOf, servingPotency, strengthLabel } from './alcohol.js';
import {
  isDrinkware, drinkwareKind, isInsulated, capacityOf,
  buildOf, drinkOf, isDirty, residueOf,
  writeBuild, clearBuild, writeDrink, takeServing, rinse as rinseVessel,
  hotMultiplier, temperatureNote,
} from './vessel.js';
import {
  BREW_TIERS, SHAKEN_BONUS, DIRTY_PENALTY, RESIDUE_MISMATCH_PENALTY,
  KNOWN_RECIPE_BONUS, SKILL_BAND_SCALE, POUR_ML,
} from './config.js';

// ── What's in the glass, for anything that wants to throw it ────────────────
//
// The bar-fight case. The topical substrate must not learn that a finished drink
// lives on `custom_data.drink` any more than it should have to know about
// `fluid_amount` — so this plugin, which owns the vessel schema, answers for its
// own containers. Registered here rather than in vessel.js because it is a
// SEAM, not part of the shape.
//
// Three liquids come out of one glass, and the split is the drink's own state
// rather than anything authored: still hot ⇒ scalding, alcoholic ⇒ liquor,
// otherwise a sticky cold drink. Potency is what's left in the glass, so the
// last mouthful of a pint is a flick and a full one is a faceful.
registerFluidResolver((item) => {
  const drink = drinkOf(item);
  if (!drink) return null;
  const servings = Number(drink.servings) || 0;
  if (servings <= 0) return null;
  const stillHot = drink.hot_at && hotMultiplier(drink.hot_at, isInsulated(item)) > 0.75;
  const fluid = stillHot ? 'hot_drink' : ((Number(drink.potency) || 0) > 0 ? 'booze' : 'soft_drink');
  return {
    fluid,
    potency: Math.min(1, servings / Math.max(1, Number(drink.capacity) || servings)),
    label: drink.name || 'the drink',
    // The alcohol IS dissolved in it, so it is named honestly — and then the
    // absorption model correctly does nothing with it. `booze` has an `absorb`
    // of 0.02, so even a full pint over a bare chest lands well under the
    // minimum systemic dose: you wear it, you do not drink it. That is the
    // model working, not a gap in it.
    drug: (Number(drink.potency) || 0) > 0 ? 'drug_alcohol' : null,
    potencyMult: Math.max(0.1, Number(drink.potency) || 1),
    // The glass comes back EMPTY AND DIRTY, exactly as it would after the last
    // swallow — a thrown drink is a drink you no longer have.
    empty: async (invId) => { await takeServing(invId, { ...drink, servings: 1 }); },
  };
});

const sys = s => `<span class="msg-system">${s}</span>`;
const dim = s => `<span class="text-dim">${s}</span>`;

// ── resolution ───────────────────────────────────────────────────────────────

// A vessel in hand, or in the dish cabinet on the wall. `fromNearby` is why a
// bar's own glassware works without anyone pocketing it.
async function findVessel(player, name) {
  const row = await resolveInventoryItem(player, {
    tag: 'drinkware', name: name || undefined, topLevel: true, fromNearby: true,
  });
  return row && isDrinkware(row) ? row : null;
}

// Does this typed string name that piece of furniture? The same loose rule the
// rest of the game uses: the whole name, or part of it.
function matchesFurniture(f, str) {
  const n = String(f?.name || '').toLowerCase();
  const q = str.toLowerCase();
  return !!n && (n === q || n.includes(q) || q.includes(n));
}

// A hot-water appliance in the room, if there is one and it's working.
function brewAppliance(zoneId, name = '') {
  let first = null;
  for (const f of getZoneFurniture(zoneId)) {
    const tier = f.flags?.brew_tier;
    if (!tier || !BREW_TIERS[tier]) continue;
    // A kettle is a kettle; a machine is a machine and machines need power.
    if (tier !== 'kettle' && f.power_draw_kw != null && !isPluggedIn(f)) continue;
    const app = { furniture: f, tier, ...BREW_TIERS[tier] };
    // A cafe can have two machines. If the player named one, use that one.
    if (name && matchesFurniture(f, name)) return app;
    if (!first) first = app;
  }
  return first;
}

// ── mix ──────────────────────────────────────────────────────────────────────

async function cmdMix(args, raw, player, broadcast) {
  const str = args.join(' ').trim();
  if (!str) return { type: 'error', message: `Mix what? (mix <ingredient> into <vessel>, or mix <vessel> to finish it)` };

  const m = str.match(/^(.*?)\s+(?:into|in|to)\s+(.+)$/i);
  if (m) return addToBuild(player, m[1].trim(), m[2].trim());

  // Bare `mix <vessel>` — resolve what's already in it.
  const vessel = await findVessel(player, str);
  if (vessel) return resolveBuild(player, vessel, broadcast, { hot: false });

  // Not drinkware. It may still be a MIXING BOWL, which is cooking's — hand it
  // over (see cooking.mix_vessel). Falling through to the dispatcher instead
  // answered "Unknown command: mix" on the line after `mix` had just printed
  // its own usage, which reads as the verb not existing.
  return (await toCooking(player, null, str))
    ?? { type: 'error', message: `You don't have a "${str}" to mix in.` };
}

// Cooking's bowls take the same verb. Returns undefined when cooking isn't
// loaded or doesn't recognise the vessel either, so the caller still owns the
// refusal — this only ever ADDS an outcome.
const hasCooking = () => getRegisteredActions().includes('cooking.mix_vessel');
async function toCooking(player, ingredient, vessel) {
  if (!hasCooking()) return undefined;
  const r = await dispatchAction({
    type: 'cooking.mix_vessel', actor: player, params: { ingredient, vessel },
  });
  return r || undefined;
}

async function addToBuild(player, ingredientStr, vesselStr) {
  const vessel = await findVessel(player, vesselStr);
  // Same hand-off as the bare form: a mixing bowl is a cooking vessel, and
  // "mix mustard into bowl" is the most natural sentence a player will ever
  // type at one.
  if (!vessel) {
    return (await toCooking(player, ingredientStr, vesselStr))
      ?? { type: 'error', message: `You don't have a "${vesselStr}" to mix into.` };
  }
  if (drinkOf(vessel)) return { type: 'error', message: `The ${vessel.name} already has a drink in it.` };

  const row = await resolveInventoryItem(player, { name: ingredientStr, topLevel: true });
  if (!row) return { type: 'error', message: `You don't have "${ingredientStr}".` };
  if (row.inv_id === vessel.inv_id) return { type: 'error', message: `You can't pour the ${vessel.name} into itself.` };

  const profile = profileNameFor(row);
  if (!profile) {
    return { type: 'error', message: `${row.name} isn't something that goes in a drink. Not one you'd finish, anyway.` };
  }

  const build = buildOf(vessel);
  const pours = poursOf({ ...row, quantity: 1 });
  build.push({
    item_id: row.item_id,
    name: row.name,
    profile,
    pours,
    abv: abvOf(row),
    band: DRINK_PROFILES[profile]?.raw || 'acceptable',
    contaminated: !!row.custom_data?.contaminated,
  });
  await writeBuild(vessel.inv_id, build);

  // Consume one unit of the ingredient.
  if (row.quantity > 1) await query('UPDATE player_inventory SET quantity=quantity-1 WHERE id=$1', [row.inv_id]);
  else await query('DELETE FROM player_inventory WHERE id=$1', [row.inv_id]);

  const parts = build.length;
  return {
    type: 'use',
    message: `You add ${row.name} to the ${vessel.name}. ${dim(`${parts} thing${parts === 1 ? '' : 's'} in it now.`)}`,
  };
}

// ── brew ─────────────────────────────────────────────────────────────────────

async function cmdBrew(args, raw, player, broadcast) {
  let str = args.join(' ').trim();
  const app = brewAppliance(player.current_zone, str);
  // The appliance advertises BREW on examine, so `brew <machine>` is the sentence
  // a player types next. The machine is not the vessel — read it as the bare
  // form and go looking for a mug.
  if (str && app && matchesFurniture(app.furniture, str)) str = '';
  const vessel = await findVessel(player, str);
  if (!vessel) {
    return { type: 'error', message: str ? `You don't have a "${str}" to brew in.` : `Brew what? You need a mug or a cup in hand.` };
  }
  if (!app) {
    // Deliberately says what's missing rather than "you can't do that" — the
    // appliance gate is only a good gate if the refusal teaches it.
    return { type: 'error', message: `There's nothing here to heat water with. You want a kettle, or a machine.` };
  }
  return resolveBuild(player, vessel, broadcast, { hot: true, appliance: app });
}

// ── the shared resolve ───────────────────────────────────────────────────────

async function resolveBuild(player, vessel, broadcast, { hot, appliance = null }) {
  const build = buildOf(vessel);
  if (drinkOf(vessel)) return { type: 'error', message: `The ${vessel.name} already has a drink in it.` };
  if (!build.length) return { type: 'error', message: `There's nothing in the ${vessel.name} to make a drink out of.` };

  const kind = drinkwareKind(vessel);
  const rows = build.map(c => ({
    item_id: c.item_id, name: c.name, quantity: 1,
    tags: { drink_profile: c.profile, pour_units: c.pours, drink_noun: c.drink_noun },
  }));
  const sig = signature(rows);
  const itemIds = new Set(build.map(c => c.item_id));
  const match = matchDrink(sig, { kind, hot, itemIds });
  const template = match?.template || UNKNOWN_DRINK;

  // A hot recipe you tried to make cold. Say which way round it went — a player
  // who has assembled tea leaves and cold water deserves to be told about the
  // kettle rather than handed sludge.
  if (!hot && !match) {
    const wantsHeat = Object.values(DRINKS).some(t => t.hot && matchDrink(sig, { kind, hot: true, itemIds })?.template === t);
    if (wantsHeat) return { type: 'error', message: `That wants hot water. You need a kettle, or something like one.` };
  }

  // ── quality ──
  // Mediums (water, ice) are in the glass but are not what the drink is made of.
  const composing = build.filter(c => !isModifierProfile(c.profile) && !isMediumProfile(c.profile));
  const modifiers = build.filter(c => isModifierProfile(c.profile));
  const check = await skillCheck(player, 'cooking', template.difficulty || 5);
  let bonus = Math.max(-2, Math.min(2, check.margin * SKILL_BAND_SCALE));
  bonus += seasoningBonus(template, modifiers.reduce((n, c) => n + c.pours, 0));
  if (template.shaken && kind === 'shaker') bonus += SHAKEN_BONUS;
  if (appliance) bonus += appliance.bonus;
  if (isDirty(vessel)) {
    bonus -= DIRTY_PENALTY;
    // Residue only hurts when it has no business being there. A coffee cup that
    // last held coffee is a coffee cup — the same call cooking's fond makes.
    const res = residueOf(vessel);
    const fits = res && (template.needs?.[res] || (template.optional || []).includes(res));
    if (res && !fits) bonus -= RESIDUE_MISMATCH_PENALTY;
  }

  let band = composeBand(composing.map(c => c.band), template, bonus);
  // An appliance tier is also a hard ceiling: a kettle can't pull espresso.
  if (appliance && bandIndex(band) > bandIndex(appliance.ceiling)) band = appliance.ceiling;

  // ── the drink ──
  const capacity = capacityOf(vessel);
  const potency = derivePotency(build);
  const name = match ? drinkName(template, rows) : UNKNOWN_DRINK.noun;
  const bandMult = 0.6 + bandIndex(band) * 0.08;   // poor 0.6 → masterful 1.24
  const drink = {
    key: match?.key || null,
    name,
    band,
    servings: capacity,
    capacity,
    thirst: Math.round(14 * capacity * bandMult),
    sanity: Math.round(2 * bandIndex(band) / 2),
    potency,
    hot_at: hot ? Date.now() : null,
    made_at: Date.now(),
    residue: composing[0]?.profile || null,
    // Foul water carries through into whatever you made with it. Two lines, and
    // it's the emergent composition the whole architecture is for: a coffee made
    // from toilet water is still a coffee made from toilet water.
    contaminated: build.some(c => c.contaminated),
  };
  await writeDrink(vessel.inv_id, drink);
  await clearBuild(vessel.inv_id);
  if (check.success) awardSkillUse(player.id, 'cooking', check.margin).catch(() => {});

  const strength = strengthLabel(potency);
  const verb = hot ? 'brew' : 'mix';
  sendToZone(player.current_zone, { type: 'zone_event',
    message: `${player.handle} ${hot ? 'brews' : 'mixes'} a drink.` }, player.id);

  const lines = [
    `You ${verb} it up: <span class="text-accent">${name}</span> — ${band}.`,
    dim(template.blurb),
  ];
  if (strength) lines.push(dim(`It reads ${strength}.`));
  if (drink.contaminated) lines.push(`<span style="color:var(--red)">Whatever water went into this wasn't clean.</span>`);
  lines.push(dim(`${capacity} serving${capacity === 1 ? '' : 's'} in the ${vessel.name}.`));
  return { type: 'use', message: lines.join('\n') };
}

// ── drink ────────────────────────────────────────────────────────────────────

async function cmdDrinkVessel(args, raw, player, broadcast) {
  const name = args.join(' ').replace(/^(from|at)\s+/i, '').trim();
  const vessel = await findVessel(player, name);
  if (!vessel) return undefined;              // not ours — fall through to fillable/water
  const drink = drinkOf(vessel);
  if (!drink) return undefined;               // an empty mug is fillable's business

  if (player._consume) return { type: 'error', message: `You're still working on that. Finish it first.` };
  if ((drink.servings || 0) <= 0) return { type: 'error', message: `The ${vessel.name} is empty.` };

  const mult = hotMultiplier(drink.hot_at, isInsulated(vessel));
  const thirst = Math.round((drink.thirst / drink.capacity) * mult);

  return dispatchAction({
    type: 'consume.begin',
    actor: player,
    params: {
      item: { id: vessel.inv_id, name: drink.name },
      itemKind: 'vessel',
      thirst,
      cd: { name: drink.name },
    },
    context: { broadcast },
  });
}

/**
 * The vessel-safe finish, called by plugins/consume at the end of the sip
 * sequence INSTEAD of finishConsumeItem — which deletes the row, and a vessel
 * must survive being drunk from.
 *
 * Re-queries fresh: a cup dropped or traded mid-drink must not apply off the
 * snapshot taken twelve seconds ago.
 */
registerAction({
  type: 'drinks.finishServing',
  handler: async ({ actor: player, params, context }) => {
    const { rows } = await query(
      `SELECT pi.id AS inv_id, pi.custom_data, i.name, i.tags
         FROM player_inventory pi JOIN items i ON i.id = pi.item_id
        WHERE pi.id=$1 AND pi.player_id=$2`,
      [params.invId, player.id]);
    const row = rows[0];
    if (!row) return null;                      // consume prints "it is gone"
    const drink = row.custom_data?.drink;
    if (!drink) return null;

    const left = await takeServing(row.inv_id, drink);

    // Sanity in memory + one write. Thirst was credited sip by sip already.
    const gain = Math.max(0, Math.round((drink.sanity || 0)));
    if (gain) {
      adjustSanity(player, gain, 'drink');
      await query('UPDATE players SET sanity=$1 WHERE id=$2', [player.sanity, player.id]).catch(() => {});
    }

    const parts = [params.takeLine || ''];
    if (left > 0) parts.push(dim(`${left} left in the ${row.name}.`));
    else parts.push(dim(`That's the last of it. The ${row.name} could do with a rinse.`));

    // WARMTH. Scaled by how hot the cup still IS — the same `hotMultiplier` the thirst credit
    // already uses, so a mug you left on the desk warms you as little as it refreshes you, and
    // a thermos (`tags.insulated`) stays useful far longer. A drink that was never hot does
    // nothing, which is why iced tea is not a survival item.
    if (drink.hot_at) {
      const heat = hotMultiplier(drink.hot_at, isInsulated(row), Date.now());
      if (heat > 0.4) applyWarmth(player, WARM_DRINK_C * heat, WARM_DRINK_MIN * heat);
    }

    // The alcohol, through the ordinary path. A serving's share of the whole,
    // so nursing a pint is three small doses rather than one triple.
    const pot = servingPotency(drink.potency, drink.capacity);
    if (pot > 0) {
      const res = await useDrug(player, 'drug_alcohol', context?.broadcast, {
        potencyMult: pot, skipInstant: true, route: 'drink',
      });
      if (res?.message) parts.push(res.message);
    }
    if (drink.contaminated) {
      const foul = await dispatchAction({ type: 'bodily.drinkContaminated', actor: player, params: { fouled: true } });
      if (foul?.message) parts.push(foul.message);
    }

    return {
      type: 'use',
      message: parts.filter(Boolean).join('\n'),
      player_update: { sanity: player.sanity, thirst: player.thirst },
    };
  },
});

// ── pour (decant) ────────────────────────────────────────────────────────────
//
// Drinks are liquids, so they move between vessels. `pour` is already owned by
// consort and interactions, but both use the return-undefined fall-through
// contract, so this layers alongside them exactly the way `drink` does.

async function cmdPour(args, raw, player, broadcast) {
  const m = args.join(' ').trim().match(/^(.*?)\s+(?:into|in|to)\s+(.+)$/i);
  if (!m) return undefined;                    // not our shape — fall through
  const from = await findVessel(player, m[1].trim());
  const to = await findVessel(player, m[2].trim());
  if (!from || !to) return undefined;
  if (from.inv_id === to.inv_id) return { type: 'error', message: `Into itself?` };

  const src = drinkOf(from);
  if (!src) return { type: 'error', message: `There's no drink in the ${from.name}.` };

  const dstCap = capacityOf(to);
  const dst = drinkOf(to);
  const room = dstCap - (dst?.servings || 0);
  if (room <= 0) return { type: 'error', message: `The ${to.name} is already full.` };

  const moved = Math.min(room, src.servings);
  let merged;
  if (!dst) {
    merged = { ...src, servings: moved, capacity: dstCap };
  } else if (dst.key === src.key && dst.name === src.name) {
    // Same drink: the bands blend by servings, so topping a great cocktail up
    // with a bad one drags it down. Which is correct, and is the reason not to.
    const total = dst.servings + moved;
    const idx = Math.round((bandIndex(dst.band) * dst.servings + bandIndex(src.band) * moved) / total);
    merged = {
      ...dst,
      servings: total,
      band: QUALITY_BANDS[Math.max(0, Math.min(QUALITY_BANDS.length - 1, idx))],
      // The OLDER hot stamp wins, so you can't refresh a cold coffee by decanting.
      hot_at: (dst.hot_at && src.hot_at) ? Math.min(dst.hot_at, src.hot_at) : (dst.hot_at || src.hot_at || null),
      potency: (dst.potency * dst.servings + src.potency * moved) / total,
      contaminated: dst.contaminated || src.contaminated,
    };
  } else {
    // Two different drinks in one glass is not a third drink. The catalogue's
    // own fallback does the work — no special case, no apology.
    merged = {
      ...UNKNOWN_DRINK, key: null, name: UNKNOWN_DRINK.noun,
      band: UNKNOWN_DRINK.ceiling,
      servings: dst.servings + moved, capacity: dstCap,
      thirst: Math.round((dst.thirst + src.thirst) / 2),
      sanity: 0,
      potency: (dst.potency * dst.servings + src.potency * moved) / (dst.servings + moved),
      hot_at: (dst.hot_at && src.hot_at) ? Math.min(dst.hot_at, src.hot_at) : null,
      made_at: Date.now(),
      residue: dst.residue || src.residue || null,
      contaminated: dst.contaminated || src.contaminated,
    };
  }
  await writeDrink(to.inv_id, merged);

  const leftInSrc = src.servings - moved;
  if (leftInSrc > 0) await writeDrink(from.inv_id, { ...src, servings: leftInSrc });
  else await takeServing(from.inv_id, { ...src, servings: 1 });   // empties it and leaves it dirty

  const note = (dst && merged.name === UNKNOWN_DRINK.noun && dst.name !== src.name)
    ? `\n${dim("The two of them don't get on. It goes cloudy.")}` : '';
  return { type: 'use',
    message: `You pour ${moved} serving${moved === 1 ? '' : 's'} from the ${from.name} into the ${to.name}.${note}` };
}

// ── rinse ────────────────────────────────────────────────────────────────────

async function cmdRinse(args, raw, player) {
  const str = args.join(' ').trim();
  const vessel = await findVessel(player, str);
  if (!vessel) return undefined;
  if (drinkOf(vessel)) return { type: 'error', message: `There's still a drink in the ${vessel.name}.` };
  if (!isDirty(vessel) && !residueOf(vessel)) return { type: 'error', message: `The ${vessel.name} is already clean.` };

  // A zone can be its own water source — see cooking's `waterSourceIn` for why a transient room out
  // in the waste has no other way to say so, and note that the tag name is the furniture flag's.
  const selfSource = !!getZone(player.current_zone)?.flags?.water_source;
  const { rows: src } = selfSource ? { rows: [{ name: 'the water' }] } : await query(
    `SELECT name FROM furniture WHERE zone_id=$1 AND jsonb_exists(flags,'water_source') LIMIT 1`,
    [player.current_zone]);
  if (!src.length) return { type: 'error', message: `There's no water here to rinse it in.` };

  // Soap is rewarded, not required — the same trade the cleaning plugin makes
  // for a mop. A bare rinse gets the drink out; soap gets the smell out too.
  const soap = await resolveInventoryItem(player, { tag: ['soap', 'cleaning_tool'], topLevel: true });
  await rinseVessel(vessel.inv_id, { thorough: !!soap });
  return { type: 'use', message: soap
    ? `You scrub the ${vessel.name} out with ${soap.name} at the ${src[0].name}. Good as it gets.`
    : `You rinse the ${vessel.name} at the ${src[0].name}. ${dim('A trace of the last one stays in it.')}` };
}

// ── recipes ──────────────────────────────────────────────────────────────────
//
// `recipes` lists what you can make; `recipes <name>` prints the card. The card
// is rendered from the SAME template the matcher uses — measures converted from
// pours at 25ml each, method derived from the template's own flags — so it can
// never drift out of step with what actually happens when you pour it.

async function cmdRecipes(args, raw, player) {
  const q = args.join(' ').trim().toLowerCase();
  if (!q) {
    const names = Object.entries(DRINKS)
      .sort(([, a], [, b]) => a.difficulty - b.difficulty)
      .map(([, t]) => `${t.noun}${t.hot ? dim(' (hot)') : ''}`);
    return { type: 'output', message: [
      `<span class="text-accent">DRINKS YOU COULD MAKE</span>`,
      dim(`Anything with a spirit and a mixer in it works whether it's on this list or not.`),
      '',
      ...names.map(n => `  · ${n}`),
      '',
      dim(`recipes <name> for measures and method.`),
    ].join('\n') };
  }
  const hit = Object.entries(DRINKS).find(([k, t]) => k === q || t.noun.toLowerCase() === q)
           || Object.entries(DRINKS).find(([k, t]) => t.noun.toLowerCase().includes(q) || k.includes(q));
  if (!hit) return { type: 'error', message: `You've never heard of a "${q}".` };
  return { type: 'output', message: describeRecipe(hit[0], hit[1], POUR_ML) };
}

// ── examine hook ─────────────────────────────────────────────────────────────
// What's in the cup, when you look at the cup.

export const hooks = {
  'item.describeVessel': ({ item }) => {
    if (!isDrinkware(item)) return undefined;
    const drink = drinkOf(item);
    const build = buildOf(item);
    if (drink) {
      const temp = temperatureNote(drink, isInsulated(item));
      const bits = [`It holds ${drink.servings} serving${drink.servings === 1 ? '' : 's'} of ${drink.name} (${drink.band})`];
      if (temp) bits.push(temp);
      const s = strengthLabel(drink.potency);
      if (s) bits.push(s);
      return `${bits.join(', ')}.`;
    }
    if (build.length) return `Part-built: ${build.map(c => c.name).join(', ')}. ${dim('Mix it to finish.')}`;
    if (isDirty(item)) return `It hasn't been rinsed since the last one.`;
    return undefined;
  },
};

export const commands = {
  mix:   (args, raw, player, broadcast) => cmdMix(args, raw, player, broadcast),
  brew:  (args, raw, player, broadcast) => cmdBrew(args, raw, player, broadcast),
  rinse: (args, raw, player)            => cmdRinse(args, raw, player),
  recipes: (args, raw, player)          => cmdRecipes(args, raw, player),
};

export const specializedActions = [
  { verb: 'drink', requiredTag: 'drinkware', handler: cmdDrinkVessel },
  { verb: 'pour',  requiredTag: 'drinkware', handler: cmdPour },
  // Declaration-only: makes a kettle or coffee machine advertise BREW on examine.
  // Without a row here the verb worked and nothing in the world mentioned it.
  // (furniture flags are normalised to tags by loadContainerById, so a furniture
  // capability is declared with requiredTag exactly like an item one.)
  { verb: 'brew',  requiredTag: 'brew_tier', handler: null },
];

console.log('[drinks] Plugin loaded.');
