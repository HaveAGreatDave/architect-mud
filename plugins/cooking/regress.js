// Cooking plugin regression — weight/thaw math, stage boundaries, the heat
// verb end-to-end (free/busy/powered stove, portable oven capacity), and the
// eat-path gate (raw sickness vs. a normal cooked meal).
import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { reloadItem, deleteItemCache } from '../../server/engine/items-cache.js';
import { insertFurniture, deleteFurniture, getFurnitureById } from '../../server/engine/world.js';
import { furnitureVerbs } from '../../server/engine/furnitureActions.js';
import { computeDuration, checkCooking, _test as cookTest } from './cook.js';
import { THAW_STAGES, COOK_STAGES, STOVE_SPEED, COOK_SECONDS_PER_KG, MIN_COOK_MS, stageText, BARE_VESSEL, PEAK_LINES, SLIPPING_LINES, FADING_LINES, STAGE_LINES, lineFor, stagesFor } from './config.js';
import { PROFILES, LEGACY_BAND_INDEX, profileNameFor, profileNeedsPrep, needsPrep, validateProfiles, QUALITY_BANDS, bandIndex, donenessLevels, donenessLevel, donenessAt, achievedDoneness } from './profiles.js';
import { leavesFond, makeFond, fondState, fondModifier, fondText, fondBelongs } from './fond.js';
import { prepWindowMult, prepBurnMult, prepCeilingDrop, prepBonus, marinadeStrength, canMarinate, prepText } from './prep.js';
import { tasteNotes, tasteTier, flavourLines } from './taste.js';
import { portionOf, isWhole, canChop, portionName, yieldOf } from './portions.js';
import { FOND_BONUS, FOND_RESIDUE_PENALTY, FOND_NEGLECT_PENALTY, FOND_LIFE_MS, MODIFIER_BONUS_CAP, MIN_PORTION, MINCE_RATE, MARINATE_MIN_MS, MARINATE_FULL_MS, MARINATE_PROFILES, TASTE_TIERS, MINCE_CEILING_DROP, BAND_SCALE, BASE_OFFSET, FOND_MIN_BAND, DISCOVERY_MIN_BAND, SLOP_CEILING, BAND_REWARDS, rewardFor, restMultiplier, restText, RESTS_WELL, REST_MIN_MS, REST_PEAK_MS, REST_COLD_MS, REST_COLD_PENALTY } from './config.js';
import { DISCOVERY_ATTEMPTS, cookingIpFor, ROUTINE_IP, MASTERFUL_IP, ROUTINE_IP_COOLDOWN_MS, DISCOVERY_IP, RECIPE_MASTERY_IP } from './config.js';
import {
  DISHES, UNKNOWN_DISH, validateDishes, signature, matchScore, matchDish,
  dishName, composeBand, nounFor, VESSEL_KINDS, seasoningIdeal, seasoningBonus, unitsOf, GENERIC_SANDWICH, ALSO,
  keyNounFor, ingredientLine, methodLines,
} from './dishes.js';
import { FLAG_PREFIX, PROGRESS_PREFIX, UNTRIED, learnRecipe, knownRecipes, cookbookState, recordAttempt, improveRecipe, beatsRecorded, knownBonus,
         SAVED_PREFIX, savedRecipes } from './knowledge.js';
import { inferDish, improvisedCeiling, improvisedIp, recipeSignature } from './improvised.js';
import { SHOPLIST_FLAG, getList, holdings, answer, buyableExamples } from './shoplist.js';
import { markShelf, markContainer } from './shoplist-cmd.js';
import { getItemCache, getItem } from '../../server/engine/items-cache.js';
import { evaluate, endStateAt, timeline, heatSpans, finishAt } from './quality.js';
import { rowIsInstanced } from '../../server/engine/inventory.js';
import { applyEffect, tickEffects, getRegisteredStatusEffects } from '../../server/engine/effects.js';
import { computeSellUnitPrice, COOK_QUALITY_PRICE } from '../../server/engine/vendor.js';
import { getAlias } from '../../server/engine/commands/aliases.js';
import { _test as cookTest2 } from './index.js';

// A synthetic profiled session, positioned relative to `now` so each case can
// ask "what would this be, evaluated at time T" without any clock manipulation.
function session(profileName, { startedAt, cookMs = 10000, vessel = BARE_VESSEL, acts = [], heatTier } = {}) {
  const p = PROFILES[profileName];
  const s0 = startedAt ?? Date.now() - cookMs;
  return {
    applianceId: 'furn_fake', startedAt: s0, thawMs: 0, cookMs, doneAt: s0 + cookMs,
    profile: profileName, heatTier: heatTier ?? p.heatTolerance, vessel, acts,
  };
}

export default async function regress({ run, check, getPlayer }) {
  const player = getPlayer();
  const saved = player.current_zone;
  const Z = 'zone_cooking_regress';
  const RAW = 'item_cooking_regress_raw';
  const OVEN = 'item_cooking_regress_oven';
  const STEAK = 'item_cooking_regress_steak';
  const TOM = 'item_cooking_regress_tomato';
  const PAN = 'item_cooking_regress_pan';
  const TURNER = 'item_cooking_regress_spatula';
  const KNIFE = 'item_cooking_regress_knife';
  const STOVE = 'furn_cooking_regress_stove';
  const STOVE_POWERED = 'furn_cooking_regress_stove_powered';
  const LAB = 'furn_cooking_regress_lab';

  // ── Pure math ──────────────────────────────────────────────────────────────
  const unfrozen = computeDuration(1000, STOVE_SPEED.low, false);
  check('1kg on a low stove has no thaw segment when unfrozen', unfrozen.thawMs === 0 && unfrozen.cookMs > 0, unfrozen);

  const frozen = computeDuration(1000, STOVE_SPEED.low, true);
  check('the same food frozen adds a thaw segment on top', frozen.totalMs > unfrozen.totalMs && frozen.thawMs > 0, frozen);

  const faster = computeDuration(1000, STOVE_SPEED.high, false);
  check('a higher-tier stove cooks the same food faster', faster.cookMs < unfrozen.cookMs, { faster, unfrozen });

  // Cook time follows m^(2/3), not mass — heat has to reach the middle, so the
  // clock is set by thickness. Double the weight is ~1.59x the time, and a 1kg
  // cut is the calibration point where the per-kg constants mean what they say.
  const heavier = computeDuration(2000, STOVE_SPEED.low, false);
  check('double the weight takes MORE time, but less than double',
    heavier.cookMs > unfrozen.cookMs && heavier.cookMs < unfrozen.cookMs * 2,
    { heavier, unfrozen });
  check('...specifically the 2^(2/3) the diffusion law gives',
    Math.abs(heavier.cookMs - unfrozen.cookMs * Math.pow(2, 2 / 3)) < 5, { heavier, unfrozen });
  check('1kg is the fixed point — the per-kg constant is unchanged there',
    unfrozen.cookMs === Math.round(COOK_SECONDS_PER_KG / STOVE_SPEED.low * 1000), unfrozen);
  // The counterintuitive half, and the reason this is worth modelling: a small
  // piece is slower than its weight suggests, so chopping is a weaker lever than
  // mincing. Quarter the mass, and you still pay ~40% of the clock.
  const quartered = computeDuration(250, STOVE_SPEED.low, false);
  check('a quarter-weight piece takes MORE than a quarter of the time',
    quartered.cookMs > unfrozen.cookMs * 0.25, { quartered, unfrozen });

  // ── The floor: every quality window is a fraction of cookMs, so a cook nobody
  // can react inside has no game in it. The worst case was a minced eighth-portion
  // of glassberries at ~1 SECOND.
  const tiny = computeDuration(70 * 0.125, STOVE_SPEED.high, false, 0.5 * 0.35);
  check('a tiny minced portion is floored, not instant', tiny.cookMs === MIN_COOK_MS, tiny);
  check('...and the floor leaves the tightest profile a playable window',
    MIN_COOK_MS * 0.25 >= 5000, MIN_COOK_MS);
  check('the floor never LENGTHENS an ordinary cook',
    computeDuration(1000, STOVE_SPEED.low, false).cookMs
      === Math.round(COOK_SECONDS_PER_KG / STOVE_SPEED.low * 1000));
  // Nothing to cook stays nothing to cook — a 0g row must not become a 20s cook.
  check('a weightless row is 0, not floored', computeDuration(0, STOVE_SPEED.low, false).cookMs === 0);

  // ── penne alla gin: a named dish anchored on BOTH its key items ────────────
  // The anchor is the whole point — penne and tomato in a pan is pasta in sauce,
  // and without the penne it's just sauce. Neither half alone may claim the name.
  //
  // And the SAUCE is named too. This asked for "any two or three liquids", which
  // meant penne, gin and two bottles of water was a valid pan of it. The steps
  // have always said tomato cooked down hard and then cream off the heat, so
  // both are required by class — and `liquid` is optional now, because every
  // liquid that ends up in the pan is something the recipe already named.
  {
    const { DISHES, matchScore } = await import('./dishes.js');
    const t = DISHES.penne_alla_gin;
    const full = new Set(['item_penne', 'item_gin', 'item_tomato_paste', 'item_synth_cream']);
    check('penne alla gin exists as a pan dish', t?.vessel === 'pan', t?.vessel);
    check('...and matches penne + gin + tomato + cream in hot fat',
      matchScore({ dry_starch: 1, soft_vegetable: 1, dairy: 1, fat_or_oil: 1, liquid: 2 }, t, full) > 0);
    // The method says "into hot fat". A dry pan is a pan of tomato drying out.
    check('...but never with no fat to cook the tomato down in',
      matchScore({ dry_starch: 1, soft_vegetable: 1, dairy: 1, liquid: 2 }, t, full) === -1);
    check('...but never without the gin',
      matchScore({ dry_starch: 1, soft_vegetable: 1, dairy: 1 }, t,
        new Set(['item_penne', 'item_tomato_paste', 'item_synth_cream'])) === -1);
    check('...nor without the penne',
      matchScore({ soft_vegetable: 1, dairy: 1 }, t,
        new Set(['item_gin', 'item_tomato_paste', 'item_synth_cream'])) === -1);
    check('...nor without the tomato, which is the body of the sauce',
      matchScore({ dry_starch: 1, dairy: 1, fat_or_oil: 1, liquid: 2 }, t, full) === -1);
    check('...nor without the cream that goes in last',
      matchScore({ dry_starch: 1, soft_vegetable: 1, liquid: 2 }, t, full) === -1);
    check('...and gin with two bottles of water is no longer a sauce',
      matchScore({ dry_starch: 1, liquid: 3 }, t, full) === -1);
    check('...nor on gin alone with nothing to carry it',
      matchScore({ dry_starch: 1, liquid: 1 }, t, full) === -1);
    // By CLASS, not by id: naming the tin in `keyItems` would forbid the tube,
    // and the paste cooked down is the same sauce. All three tomatoes carry
    // `soft_vegetable`, two of them as a `food_also`.
    check('...the tomato is required as a class, so tin/tube/fresh all work',
      !(t.keyItems || []).some(id => /tomato/.test(id)), JSON.stringify(t.keyItems));

    // ...BUT A CLASS IT NAMES IS A CLASS IT MEANS. `nouns` said "tomato" to the
    // recipe card while the matcher accepted any soft vegetable at all, so a pan
    // of penne, gin and lamp-grown greens plated as penne alla gin — and the
    // card printed "a tomato" over the top of it. `requires` binds the two.
    const { signature } = await import('./dishes.js');
    const P = r => r.tags?.food_profile || null;
    const row = (name, tags, weight) => ({ name, tags, weight, quantity: 1 });
    // Weights are the profiles' own unit weights, so every one of these is
    // exactly one of its class and nothing here fails for the boring reason.
    const penneRow = row('box of penne', { food_profile: 'dry_starch' }, 125);
    const ginRow = row('bottle of gin', { food_profile: 'liquid' }, 400);
    const fatRow = row('cooking oil', { food_profile: 'fat_or_oil' }, 300);
    const creamRow = row('synth cream', { food_profile: 'liquid', food_also: 'dairy', food_noun: 'cream' }, 400);
    const tomatoRow = row('tin of tomatoes', { food_profile: 'liquid', food_also: 'soft_vegetable', food_noun: 'tomato' }, 400);
    const greensRow = row('lamp-grown greens', { food_profile: 'soft_vegetable', food_noun: 'greens' }, 120);
    const ids = new Set(['item_penne', 'item_gin']);
    const sigOf = rows => signature(rows, P);

    check('a tin of tomatoes answers the tomato the sauce is made of',
      matchScore(sigOf([penneRow, ginRow, fatRow, tomatoRow, creamRow]), t, ids) > 0);
    check('...and lamp-grown greens do not, however much soft vegetable they are',
      matchScore(sigOf([penneRow, ginRow, fatRow, greensRow, creamRow]), t, ids) === -1);
    check('...nor does a pile of them big enough to meet the weight',
      matchScore(sigOf([penneRow, ginRow, fatRow, greensRow, { ...greensRow }, creamRow]), t, ids) === -1);
    check("...and cheese isn't the cream that goes in last",
      matchScore(sigOf([penneRow, ginRow, fatRow, tomatoRow,
        row('vat cheese', { food_profile: 'dairy', food_noun: 'vat cheese' }, 200)]), t, ids) === -1);
    // The display half and the binding half are one statement, and the validator
    // is what stops them drifting back apart.
    check('...and what the card names is what the matcher demands',
      Object.entries(t.requires || {}).every(([p, want]) => t.nouns?.[p] === want),
      JSON.stringify([t.requires, t.nouns]));
  }

  // ── boiling: water as a cooking MEDIUM ────────────────────────────────────
  //
  // Pasta cooks in liquid, not in heat, and until this existed a box of penne on
  // a dry hob arrived at `excellent`. The medium is the thing that makes the
  // gate passable without making the pan of water an ingredient — so every case
  // here is about the same split: a medium is a liquid for the PAN and nothing
  // at all for the DISH.
  {
    const { isMedium } = await import('./profiles.js');
    const { hasCookingLiquid } = cookTest2;
    const water = { name: 'water', tags: { food_profile: 'liquid', cooking_medium: true } };
    const stock = { name: 'bone broth', tags: { food_profile: 'liquid' } };
    const penne = { name: 'box of penne', tags: { food_profile: 'dry_starch' } };

    check('water in the pot is a medium', isMedium(water));
    check("...and stock is not — it's an ingredient", !isMedium(stock));
    check('...and neither is a thing with no tags at all', !isMedium(penne) && !isMedium(null));
    check('a medium still reads as a liquid to the pan', hasCookingLiquid([water]));
    check('...so does real stock', hasCookingLiquid([stock]));
    check("a dry pan of penne isn't wet, which is what the gate turns on",
      !hasCookingLiquid([penne]));

    // ...but the gate is about DRY starch. Boiled and drained pasta going into a
    // pan of sauce carries no water and needs none — that is the whole two-vessel
    // method, and the gate used to refuse it.
    const { needsBoiling } = cookTest2;
    const drained = { ...penne, custom_data: { cooked: true, finishable: true, drained: true } };
    check('dry penne still has to boil', needsBoiling(penne));
    check('...drained penne does not, so it can finish in a dry pan of sauce', !needsBoiling(drained));
    check('...and nothing else was ever asked to boil', !needsBoiling(stock) && !needsBoiling(null));

    // The dish half. A medium must never satisfy a recipe asking for stock, or
    // the fix that stopped "penne, gin and two bottles of water" being a sauce
    // is undone by a tap.
    const { DISHES, matchScore, signature } = await import('./dishes.js');
    const { profileNameFor } = await import('./profiles.js');
    // signature() is fed the same filtered list plating feeds it — medium rows
    // are excluded upstream, so this asserts the exclusion is what makes ramen
    // refuse rather than any property of `signature` itself.
    const forDish = rows => signature(rows.filter(r => !isMedium(r)), profileNameFor);
    check("a pot of noodles and tap water isn't ramen",
      matchScore(forDish([penne, water]), DISHES.ramen, new Set(['item_ramen_noodles'])) === -1,
      JSON.stringify(forDish([penne, water])));
    check('...and the same pot with actual stock in it is',
      matchScore(forDish([penne, stock]), DISHES.ramen, new Set(['item_ramen_noodles'])) > 0,
      JSON.stringify(forDish([penne, stock])));
  }

  // THE PICKER AND THE KEY ITEM IT COULD NOT SEE.
  //
  // `pickFor` is the one place `prepare` and the Assistant's walkthrough both go
  // for "which rows would this recipe use", and it used to walk `needs` and only
  // `needs`. penne alla gin is keyed on the gin, whose profile is `liquid` — a
  // class that dish lists as OPTIONAL — so the gin was never picked, the plan
  // gathered a pan without it, and the generated step list silently dropped the
  // one beat the dish is named after while still calling the recipe ready.
  {
    const { _test: wsTest } = await import('./workspace.js');
    const { pickFor, loadOrder } = wsTest;
    const row = (id, item_id, name, tags, weight) =>
      ({ id, item_id, name, tags, weight, quantity: 1, container_id: null, custom_data: {} });
    const pan = row(1, 'item_pan', 'cast-iron skillet', { vessel: true, vessel_kind: 'pan' }, 900);
    const rows = [
      pan,
      row(2, 'item_penne', 'box of penne', { food_profile: 'dry_starch' }, 500),
      row(3, 'item_tomato', 'tomato', { food_profile: 'soft_vegetable', food_noun: 'tomato' }, 120),
      row(4, 'item_cream', 'carton of cream', { food_profile: 'liquid', food_also: 'dairy', food_noun: 'cream' }, 400),
      row(5, 'item_butter_analog', 'butter-analog', { food_profile: 'fat_or_oil' }, 250),
      row(6, 'item_gin', 'bottle of gin', { food_profile: 'liquid', food_noun: 'gin' }, 400),
      // The ingredient that used to answer the tomato class first and wreck the
      // whole dish. It stays in the room so this also pins the `requires` gate.
      row(7, 'item_greens', 'lamp-grown greens', { food_profile: 'soft_vegetable' }, 300),
    ];
    const kitchen = {
      all: rows, vessels: [pan], vesselIds: new Set([pan.id]),
      boxIds: new Set(), childrenOf: new Map(),
    };
    const picked = pickFor(DISHES.penne_alla_gin, kitchen);
    const names = picked.picks.map(r => r.name);
    check('the picker reaches for the gin, though the recipe never counts liquid',
      names.includes('bottle of gin'), names.join(', '));
    check('...and the plan is short of nothing', !picked.shortfall.length, JSON.stringify(picked.shortfall));
    check('...and still refuses the greens, because the tomato is required',
      !names.includes('lamp-grown greens'), names.join(', '));
    check('...and the gin loads on its own authored step, off the heat',
      /in with the gin/i.test(loadOrder(DISHES.penne_alla_gin, picked.picks)
        .find(s => s.row.item_id === 'item_gin')?.text || ''),
      JSON.stringify(loadOrder(DISHES.penne_alla_gin, picked.picks).map(s => [s.row.name, s.text])));

    // A key item that isn't in the room is a shortfall, which is what stops the
    // walkthrough being generated for a dish that would refuse.
    const noGin = pickFor(DISHES.penne_alla_gin, { ...kitchen, all: rows.filter(r => r.item_id !== 'item_gin') });
    check('no gin in the room is a shortfall, not a quiet omission',
      noGin.shortfall.some(s => s.item === 'item_gin'), JSON.stringify(noGin.shortfall));

    // THE BAR AND THE LIST HAVE TO AGREE. A line that fails only on its NOUN has
    // all the weight the class asks for, so the clamped ratio was a full 1 and it
    // scored as if satisfied — which filed penne alla gin under "Missing
    // Ingredients", printed tomato and cream in the shortfall beneath it, and put
    // 100% on the bar above. Half credit: nearer than an empty pan, and not done.
    const { scoreRecipe } = wsTest;
    const held = [
      row(0, 'item_penne', 'box of penne', { food_profile: 'dry_starch' }, 500),
      row(0, 'item_gin', 'bottle of gin', { food_profile: 'liquid', food_noun: 'gin' }, 400),
      row(0, 'item_butter_analog', 'butter-analog', { food_profile: 'fat_or_oil' }, 250),
      row(0, 'item_greens', 'lamp-grown greens', { food_profile: 'soft_vegetable' }, 300),
      row(0, 'item_ration_cheese', 'ration cheese', { food_profile: 'dairy' }, 200),
    ];
    const ctxOf = rows => ({
      itemIds: new Set(rows.map(r => r.item_id)), stoves: [{}],
      vesselKinds: new Set(['pan']), kitTags: new Set(['can_chop', 'can_turn']),
    });
    const scoreWith = rows =>
      scoreRecipe('penne_alla_gin', DISHES.penne_alla_gin, signature(rows, profileNameFor), ctxOf(rows), null);

    const wrongVeg = scoreWith(held);
    check('a pan of greens and cheese is still short the tomato and the cream',
      wrongVeg.missing.length === 2, JSON.stringify(wrongVeg.missing));
    check("...so it can't read 100% over a list of what it's missing",
      wrongVeg.pct < 100, wrongVeg.pct);
    check('...but it beats holding none of the class at all',
      wrongVeg.pct > scoreWith(held.filter(r => !/greens|cheese/.test(r.name))).pct,
      [wrongVeg.pct, scoreWith(held.filter(r => !/greens|cheese/.test(r.name))).pct]);

    const right = scoreWith([
      ...held.filter(r => !/greens|cheese/.test(r.name)),
      row(0, 'item_tomato', 'tomato', { food_profile: 'soft_vegetable', food_noun: 'tomato' }, 120),
      row(0, 'item_cream', 'carton of cream', { food_profile: 'liquid', food_also: 'dairy', food_noun: 'cream' }, 400),
    ]);
    check('the right ingredients read 100% and nothing missing',
      right.pct === 100 && !right.missing.length, [right.pct, right.missing]);
  }

  check('stage text is monotonic and covers 0..1', stageText(COOK_STAGES, 0) === 'raw, glistening' && stageText(COOK_STAGES, 1) === 'cooked through, a faint char forming', {
    a: stageText(COOK_STAGES, 0), b: stageText(COOK_STAGES, 1),
  });

  // checkCooking: never-below-zero / done detection off a synthetic session
  const now = Date.now();
  const midCook = { custom_data: { cooking: { startedAt: now - 1000, thawMs: 0, cookMs: 10000, doneAt: now + 9000 } } };
  const midState = checkCooking(midCook);
  check('mid-cook examine returns a stage, not done', midState && midState.done === false, midState);
  const doneCook = { custom_data: { cooking: { startedAt: now - 20000, thawMs: 0, cookMs: 10000, doneAt: now - 10000 } } };
  const doneState = checkCooking(doneCook);
  check('past doneAt, examine reads as done', doneState?.done === true, doneState);
  check('an item with no cooking session returns null', checkCooking({ custom_data: {} }) === null);
  // The stage the workspace HUD draws its pips from. It must be the SAME beat the
  // prose beside it names — one table, one index — and it must never grow into a
  // clock: how long is left is the question the kitchen deliberately refuses.
  check("mid-cook reports which beat it's on, in range",
    midState.phase === 'cook' && midState.stage >= 1 && midState.stage <= midState.stages,
    midState);
  check('...and the stage agrees with the prose it sits beside',
    midState.text === stageText(COOK_STAGES, 0.1), midState.text);
  check('...and carries no clock — nothing that could be read as time remaining',
    !('remaining' in midState) && !('doneAt' in midState) && !('pct' in midState), Object.keys(midState).join(','));
  check('a cook past its finish is a state, not a beat count',
    doneState.phase === 'window' && !doneState.stage, doneState);

  // `finishAt` is the ONLY sanctioned way to ask when a cook ends, and it has to
  // keep answering for sessions written before the field was renamed — there are
  // real ones sitting in player_inventory mid-cook across any deploy.
  check('finishAt reads the plain stamp for unprofiled food',
    finishAt({ plainDoneAt: 4242 }) === 4242);
  check('a session stamped before the rename still finishes',
    finishAt({ doneAt: 4242 }) === 4242);
  check('the new field wins where both are present',
    finishAt({ plainDoneAt: 1, doneAt: 999 }) === 1);

  // A doneness target moves the finish line, and examine has to read off the
  // SAME clock the quality ladder does. Rare lands at 0.75 of the cook: at 0.80
  // the food is in its window, and examine saying "still browning" there is the
  // telegraph lying to the player about a steak they are about to lose.
  const doneSess = t => ({
    custom_data: { cooking: {
      startedAt: now - 8000, thawMs: 0, cookMs: 10000, doneAt: now + 2000,
      profile: 'dense_meat', heatTier: 'high', vessel: BARE_VESSEL, acts: [], target: t,
    } },
  });
  check('a rare cut is DONE at 80% of the cook, and examine says so',
    checkCooking(doneSess('rare'))?.done === true, checkCooking(doneSess('rare')));
  check('...while a well-done one is still cooking at the same instant',
    checkCooking(doneSess('well done'))?.done === false, checkCooking(doneSess('well done')));
  check('examine and the quality ladder agree on the end state',
    (checkCooking(doneSess('rare'))?.done === true)
      === (endStateAt(doneSess('rare').custom_data.cooking, PROFILES.dense_meat) !== 'raw'));
  check('for profiled food finishAt IS the timeline, not the stamp',
    finishAt(doneSess('rare').custom_data.cooking, PROFILES.dense_meat)
      === timeline(doneSess('rare').custom_data.cooking, PROFILES.dense_meat).doneAt);

  // ── Profiles + quality (pure) ─────────────────────────────────────────────
  const v = validateProfiles();
  check('every shipped food profile passes validation', v.ok, v.errors);

  const badCatalog = validateProfiles({
    bad_spud: { ...PROFILES.starchy_vegetable, targets: { raw: 'excellent', peak: 'poor', over: 'poor', burnt: 'poor' } },
  });
  check('the validator rejects a profile whose peak is worse than raw', !badCatalog.ok && /cooking would be pointless/.test(badCatalog.errors.join(' ')), badCatalog.errors);
  const badBurn = validateProfiles({
    bad_burn: { ...PROFILES.dense_meat, targets: { raw: 'poor', peak: 'good', over: 'good', burnt: 'masterful' } },
  });
  check('the validator rejects a profile where burnt beats overcooked', !badBurn.ok, badBurn.errors);

  // Progression through the four windows off ONE session, evaluated at different
  // instants — nothing simulates the gaps.
  const steak = session('dense_meat', { startedAt: 0, cookMs: 10000 });
  const tl = timeline(steak, PROFILES.dense_meat);
  check('a session before doneAt reads as raw', endStateAt(steak, PROFILES.dense_meat, tl.doneAt - 1) === 'raw');
  check('a session inside the window reads as peak', endStateAt(steak, PROFILES.dense_meat, tl.doneAt + tl.peakMs / 2) === 'peak');
  check('a session past the window reads as over', endStateAt(steak, PROFILES.dense_meat, tl.peakEnd + 1) === 'over');
  check('a session past the burn point reads as burnt', endStateAt(steak, PROFILES.dense_meat, tl.burnAt + 1) === 'burnt');
  check('the windows are ordered doneAt < peakEnd < burnAt', tl.doneAt < tl.peakEnd && tl.peakEnd < tl.burnAt, tl);

  // Lazy equivalence: evaluating once at T must equal evaluating at T after any
  // number of intermediate reads. This is the whole architectural claim.
  const at = tl.doneAt + tl.peakMs / 2;
  const once = evaluate(steak, PROFILES.dense_meat, at, 0);
  for (let i = 0; i < 20; i++) evaluate(steak, PROFILES.dense_meat, tl.doneAt + (tl.peakMs * i) / 20, 0);
  const again = evaluate(steak, PROFILES.dense_meat, at, 0);
  check('evaluating a session is lazy — intermediate reads change nothing', once.band === again.band && once.score === again.score, { once, again });

  // The target is a ceiling: nothing the player does can push a band past it.
  const perfectActs = [{ at: 5000, kind: 'flip' }];
  const bestKit = session('dense_meat', { startedAt: 0, cookMs: 10000, acts: perfectActs, vessel: { d: 1, r: 1 } });
  const burntBest = evaluate(bestKit, PROFILES.dense_meat, timeline(bestKit, PROFILES.dense_meat).burnAt + 1, 14);
  check("a burnt steak can't exceed its burnt target however well it was handled", burntBest.band === PROFILES.dense_meat.targets.burnt, burntBest);

  // A well-run cook in the window reaches the top band; a careless one does not.
  const good = evaluate(session('dense_meat', { startedAt: 0, cookMs: 10000, acts: perfectActs, vessel: { d: 0.9, r: 0.8 } }), PROFILES.dense_meat, at, 10);
  check('a well-handled steak plated mid-window is masterful', good.band === 'masterful', good);
  const careless = evaluate(session('dense_meat', { startedAt: 0, cookMs: 10000, acts: [], heatTier: 'high' }), PROFILES.dense_meat, tl.peakEnd - 1, -14);
  check('a careless steak in the same window scores well below it', bandIndex(careless.band) < bandIndex(good.band), { careless, good });

  // Multiple valid targets — the reason `targets` is a map and not a single state.
  const rawTom = evaluate(session('soft_vegetable', { startedAt: 0, cookMs: 10000 }), PROFILES.soft_vegetable, 1, 0);
  const rawSpud = evaluate(session('starchy_vegetable', { startedAt: 0, cookMs: 10000 }), PROFILES.starchy_vegetable, 1, 0);
  check('a tomato pulled raw is still ceilinged at excellent — raw is a valid target', rawTom.ceiling === 'excellent', rawTom);
  check('a potato pulled raw is capped at poor', rawSpud.ceiling === 'poor' && rawSpud.band === 'poor', rawSpud);

  // Over-handling a food that wants no handling.
  const tomBase = session('soft_vegetable', { startedAt: 0, cookMs: 10000 });
  const tomTl = timeline(tomBase, PROFILES.soft_vegetable);
  const tomMid = tomTl.doneAt + tomTl.peakMs / 2;
  const tomLeftAlone = evaluate(tomBase, PROFILES.soft_vegetable, tomMid, 0);
  const tomFussed = evaluate(session('soft_vegetable', { startedAt: 0, cookMs: 10000, acts: [{ at: 3000, kind: 'flip' }, { at: 6000, kind: 'flip' }] }), PROFILES.soft_vegetable, tomMid, 0);
  check('a turns:0 food scores worse for being handled', tomFussed.score < tomLeftAlone.score, { tomFussed: tomFussed.score, tomLeftAlone: tomLeftAlone.score });

  // Equipment: a vessel widens both windows and scores better than bare metal.
  const bare = session('dense_meat', { startedAt: 0, cookMs: 10000, vessel: BARE_VESSEL });
  const panned = session('dense_meat', { startedAt: 0, cookMs: 10000, vessel: { d: 0.7, r: 0.45 } });
  const bareTl = timeline(bare, PROFILES.dense_meat);
  const panTl = timeline(panned, PROFILES.dense_meat);
  check('a vessel widens the peak window', panTl.peakMs > bareTl.peakMs, { panTl, bareTl });
  check('a vessel widens the margin before burning', panTl.overMs > bareTl.overMs, { panTl, bareTl });
  check('cooking in a vessel scores better than bare on the stove',
    evaluate(panned, PROFILES.dense_meat, panTl.doneAt + 1, 0).score > evaluate(bare, PROFILES.dense_meat, bareTl.doneAt + 1, 0).score);

  // Heat choice matters, in both directions.
  const rightHeat = evaluate(session('batter', { startedAt: 0, cookMs: 10000, heatTier: 'high', acts: [{ at: 5000, kind: 'flip' }] }), PROFILES.batter, timeline(session('batter', { startedAt: 0, cookMs: 10000 }), PROFILES.batter).doneAt + 1, 0);
  const wrongHeat = evaluate(session('batter', { startedAt: 0, cookMs: 10000, heatTier: 'low', acts: [{ at: 5000, kind: 'flip' }] }), PROFILES.batter, timeline(session('batter', { startedAt: 0, cookMs: 10000 }), PROFILES.batter).doneAt + 1, 0);
  check('the right stove tier scores better than the wrong one', rightHeat.score > wrongHeat.score, { rightHeat: rightHeat.score, wrongHeat: wrongHeat.score });

  // A profile's cook rate actually changes the clock.
  check('a profile cookRateMult scales the cook duration',
    computeDuration(1000, STOVE_SPEED.low, false, 1.4).cookMs > computeDuration(1000, STOVE_SPEED.low, false, 1.0).cookMs);

  check('every band produced is a real band', QUALITY_BANDS.includes(good.band) && QUALITY_BANDS.includes(careless.band));

  // Stack safety — a plated quality must make the row unique.
  check('a plated quality marks the row as instanced', rowIsInstanced({ custom_data: { cook_quality: 'masterful' } }) === true);
  check('an ordinary cooked row is still stackable', rowIsInstanced({ custom_data: { cooked: true } }) === false);

  // ── Integration: heat verb + eat gate ─────────────────────────────────────
  try {
    await query(
      `INSERT INTO items (id,name,description,type,value,weight,tags) VALUES ($1,'test raw cutlet','test raw cutlet','consumable',1,1000,$2)
       ON CONFLICT (id) DO UPDATE SET tags=$2, weight=1000`,
      [RAW, JSON.stringify({ consumable: true, needs_cooking: true, restore_hunger: 20, stackable: false })]
    );
    await reloadItem(RAW);
    await query(
      `INSERT INTO items (id,name,description,type,value,weight,tags) VALUES ($1,'test portable oven','test portable oven','misc',1,500,$2)
       ON CONFLICT (id) DO UPDATE SET tags=$2`,
      [OVEN, JSON.stringify({ portable_oven: true, oven_capacity_g: 500 })]
    );
    await reloadItem(OVEN);

    await insertFurniture({
      id: STOVE, name: 'test cooktop', description: 'a test cooktop', object_type: 'fixture',
      zone_id: Z, flags: JSON.stringify({ stove_tier: 'low' }),
    }, 'ON CONFLICT (id) DO UPDATE SET flags=EXCLUDED.flags, zone_id=EXCLUDED.zone_id');

    player.current_zone = Z;

    // The range advertises the Preparation Workspace on its own examine. The HUD
    // was fully working and completely unfindable — you had to already know the
    // verb — which is the invisible-content case, so this asserts the range says
    // so rather than that the verb runs.
    {
      const stoveRow = await getFurnitureById(STOVE);
      const verbs = furnitureVerbs(stoveRow, player);
      check('a range advertises the workspace HUD on examine', verbs.includes('workspace'), verbs.join(','));
      // And it is genuinely gated: a piece of furniture that isn't a kitchen
      // appliance must not offer a kitchen.
      check('...but a plain fixture does not',
        !furnitureVerbs({ id: 'x', name: 'crate', flags: {} }, player).includes('workspace'));
    }

    // No stove reachable (none placed yet in a fresh sub-zone) + no oven carried → clean error.
    let r = await run('cook nonexistent food');
    check('heating with nothing by that name errors cleanly', r?.type === 'error', JSON.stringify(r));

    await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2', [player.id, RAW]);
    const invId = randomUUID();
    await query(`INSERT INTO player_inventory (id, player_id, item_id, quantity, condition) VALUES ($1,$2,$3,1,1.0)`, [invId, player.id, RAW]);

    r = await run('cook test raw cutlet');
    check('heat starts a cook session on the free stove', r?.type === 'output', JSON.stringify(r));
    let row = (await query('SELECT custom_data FROM player_inventory WHERE id=$1', [invId])).rows[0];
    check('a cooking session is written to the item', !!row.custom_data?.cooking, row.custom_data);

    let stove = await getFurnitureById(STOVE);
    check('the stove is marked busy_until', typeof stove.flags?.busy_until === 'number', stove.flags);

    r = await run('cook test raw cutlet');
    check('cooking the same item twice is refused (already cooking)', r?.type === 'error', JSON.stringify(r));

    // A second stove in the same zone, already busy — the free-stove finder must skip it.
    // (Not seeded here — single-stove busy rejection is covered by the check above.)

    // Simulate completion (what the scheduled timer would do) and verify the flip.
    await cookTest.finishCook(invId, player.id);
    row = (await query('SELECT custom_data FROM player_inventory WHERE id=$1', [invId])).rows[0];
    check('finishing a cook clears the session and sets cooked', !row.custom_data?.cooking && row.custom_data?.cooked === true, row.custom_data);

    // Eating cooked food behaves normally.
    player.hunger = 0;
    r = await run('eat test raw cutlet');
    check('eating cooked food restores normally', player.hunger === 20, `hunger=${player.hunger}`);

    // Fresh raw instance, never cooked — eating it should sicken instead of feed.
    await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2', [player.id, RAW]);
    const rawInvId = randomUUID();
    await query(`INSERT INTO player_inventory (id, player_id, item_id, quantity, condition) VALUES ($1,$2,$3,1,1.0)`, [rawInvId, player.id, RAW]);
    player.hunger = 0;
    r = await run('eat test raw cutlet');
    check('eating raw food applies the undercooked message, not a normal restore', /raw in the middle/.test(r?.message || ''), r?.message);
    check("eating raw food doesn't restore hunger", player.hunger === 0, `hunger=${player.hunger}`);
    check('eating raw food applies food_poisoning', (player.statuses || []).some(s => s.name === 'food_poisoning'), player.statuses);
    player.statuses = (player.statuses || []).filter(s => s.name !== 'food_poisoning');

    // A powered stove in an unpowered (fake) zone refuses to heat.
    await insertFurniture({
      id: STOVE_POWERED, name: 'test electric range', description: 'a test electric range', object_type: 'fixture',
      zone_id: Z, power_draw_kw: 0.3, flags: JSON.stringify({ stove_tier: 'mid' }),
    }, 'ON CONFLICT (id) DO UPDATE SET flags=EXCLUDED.flags, zone_id=EXCLUDED.zone_id, power_draw_kw=EXCLUDED.power_draw_kw');
    await deleteFurniture(STOVE); // only the powered stove remains, so heat must pick it
    const anotherRaw = randomUUID();
    await query(`INSERT INTO player_inventory (id, player_id, item_id, quantity, condition) VALUES ($1,$2,$3,1,1.0)`, [anotherRaw, player.id, RAW]);
    r = await run('cook test raw cutlet');
    check('a powered stove with no grid power refuses to heat', r?.type === 'error' && /power/i.test(r?.message || ''), JSON.stringify(r));
    await deleteFurniture(STOVE_POWERED);

    // No stove at all — falls back to a carried portable oven, capacity-gated.
    await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2', [player.id, OVEN]);
    const ovenInvId = randomUUID();
    await query(`INSERT INTO player_inventory (id, player_id, item_id, quantity, condition) VALUES ($1,$2,$3,1,1.0)`, [ovenInvId, player.id, OVEN]);
    // The remaining raw cutlet row is 1000g, oven capacity is 500g — too much.
    r = await run('cook test raw cutlet');
    check('food heavier than the portable oven capacity is refused', r?.type === 'error' && /small amounts/i.test(r?.message || ''), JSON.stringify(r));

    // ── The profiled loop, end to end ────────────────────────────────────────
    await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2', [player.id, OVEN]);
    await insertFurniture({
      id: STOVE, name: 'test cooktop', description: 'a test cooktop', object_type: 'fixture',
      zone_id: Z, flags: JSON.stringify({ stove_tier: 'mid' }),
    }, 'ON CONFLICT (id) DO UPDATE SET flags=EXCLUDED.flags, zone_id=EXCLUDED.zone_id, power_draw_kw=NULL');

    for (const [id, name, tags, weight] of [
      [STEAK, 'test steak', { consumable: true, needs_cooking: true, food_profile: 'dense_meat', restore_hunger: 20, stackable: true }, 400],
      [TOM, 'test tomato', { consumable: true, food_profile: 'soft_vegetable', restore_hunger: 8, stackable: true }, 150],
      [PAN, 'test pan', { container: 2000, vessel: true, heat_distribution: 0.7, heat_retention: 0.45, unique: true }, 1000],
      [TURNER, 'test spatula', { can_turn: true, unique: true }, 150],
      [KNIFE, 'test knife', { can_chop: true, unique: true }, 200],
    ]) {
      await query(
        `INSERT INTO items (id,name,description,type,value,weight,tags) VALUES ($1,$2,$2,'misc',1,$4,$3)
         ON CONFLICT (id) DO UPDATE SET tags=$3, weight=$4`, [id, name, JSON.stringify(tags), weight]);
      await reloadItem(id);
    }

    const panId = randomUUID(), steakId = randomUUID(), turnerId = randomUUID(), knifeId = randomUUID();
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition) VALUES ($1,$2,$3,1,1.0)`, [panId, player.id, PAN]);
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition) VALUES ($1,$2,$3,1,1.0)`, [turnerId, player.id, TURNER]);

    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition,container_id) VALUES ($1,$2,$3,1,1.0,$4)`, [steakId, player.id, STEAK, panId]);

    // Combining whole ingredients needs a blade. Prove the gate bites BEFORE
    // handing one over, so the fixture can't quietly hide a broken check.
    const noKnife = await run('cook test pan');
    check('combining whole ingredients bare-handed is refused', noKnife?.type === 'error' && /knife/.test(noKnife.message), JSON.stringify(noKnife));
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition) VALUES ($1,$2,$3,1,1.0)`, [knifeId, player.id, KNIFE]);

    // Heating the vessel heats what's in it.
    r = await run('cook test pan');
    check('heating a vessel starts a session on the food inside it', r?.type === 'output' && /test steak/.test(r.message), JSON.stringify(r));
    let sRow = (await query('SELECT custom_data FROM player_inventory WHERE id=$1', [steakId])).rows[0];
    const live = sRow.custom_data?.cooking;
    check('a profiled session records its profile, heat tier and vessel', live?.profile === 'dense_meat' && live.heatTier === 'mid' && live.vessel?.d === 0.7, live);
    check('a profiled session starts with an empty handling log', Array.isArray(live.acts) && live.acts.length === 0, live);

    // The stove is held until it's plated or burns off, not merely until done.
    let heldStove = await getFurnitureById(STOVE);
    check('a profiled cook holds the stove past the finish line',
      heldStove.flags.busy_until > finishAt(live, PROFILES[live.profile]),
      { busy: heldStove.flags.busy_until, finish: finishAt(live, PROFILES[live.profile]) });

    // Handling: right verb, wrong verb, and the tool gate.
    r = await run('stir test steak');
    check('stirring a food that wants turning points you at the right verb', r?.type === 'error' && /flip/.test(r.message), JSON.stringify(r));
    r = await run('flip test steak');
    check('flipping with a spatula in hand works', r?.type === 'output', JSON.stringify(r));
    sRow = (await query('SELECT custom_data FROM player_inventory WHERE id=$1', [steakId])).rows[0];
    check('a flip is recorded against the session', sRow.custom_data.cooking.acts?.length === 1, sRow.custom_data.cooking.acts);
    check("flipping doesn't disturb the rest of the session",
      sRow.custom_data.cooking.startedAt === live.startedAt && sRow.custom_data.cooking.doneAt === live.doneAt);

    await query('UPDATE player_inventory SET container_id=NULL WHERE id=$1', [turnerId]);
    await query('DELETE FROM player_inventory WHERE id=$1', [turnerId]);
    r = await run('flip test steak');
    check('flipping with no turning tool is refused', r?.type === 'error' && /turn it with/.test(r.message), JSON.stringify(r));

    // The examine telegraph must survive `done` — a profiled cook sits on the
    // heat after it's ready, and that window is the only warning you get.
    const readyPeek = checkCooking({ custom_data: { cooking: { ...live, doneAt: Date.now() - 1, startedAt: Date.now() - live.cookMs - 1 } } });
    const inWindowLines = [lineFor(PEAK_LINES, 'dense_meat'), lineFor(SLIPPING_LINES, 'dense_meat')];
    check('a profiled cook past doneAt still reports a stage, not silence',
      readyPeek?.done === true && inWindowLines.includes(readyPeek.text), readyPeek);
    // The telegraph describes the food; it never tells you what to do about it.
    check('in-window narration is observational, never instructional',
      !/take it off|it's ready|ready —|you should/i.test(readyPeek.text), readyPeek.text);
    // GRAMMAR. Every line is a COMPLEMENT, rendered two ways: `It's <x>.` by
    // examine (server/engine/commands/world.js) and `The <name> is <x>.` by the
    // push. A line that carries its own verb reads as "It's has gone dark…",
    // which is exactly the bug this catches.
    const LEADING_VERB = /^(has|have|is|are|was|were|had|looks|seems)\b/i;
    for (const [label, table] of [['peak', PEAK_LINES], ['slipping', SLIPPING_LINES], ['fading', FADING_LINES]]) {
      const bad = Object.entries(table).filter(([, t]) => LEADING_VERB.test(t));
      check(`${label} lines are complements, not sentences — they must read after "It's"`, bad.length === 0, bad);
    }
    for (const [prof, stages] of Object.entries(STAGE_LINES)) {
      const bad = stages.filter(s => LEADING_VERB.test(s.text));
      check(`${prof} stage lines are complements too`, bad.length === 0, bad);
      check(`${prof} stage lines cover the whole cook`, stages.length > 0 && stages[stages.length - 1].max === 1, stages.map(s => s.max));
    }
    check('a profile without its own stage list falls back to the generic one', stagesFor('nope') === COOK_STAGES);
    check('every cooking profile has its own stage prose',
      Object.keys(PROFILES).filter(p => !PROFILES[p].modifier).every(p => STAGE_LINES[p]),
      Object.keys(PROFILES).filter(p => !PROFILES[p].modifier && !STAGE_LINES[p]));
    check('a broth and a cut of meat read differently mid-cook',
      stageText(stagesFor('liquid'), 0.6) !== stageText(stagesFor('dense_meat'), 0.6),
      [stageText(stagesFor('liquid'), 0.6), stageText(stagesFor('dense_meat'), 0.6)]);

    for (const table of [PEAK_LINES, SLIPPING_LINES, FADING_LINES]) {
      const bad = Object.entries(table).filter(([, t]) => /take it off|ready|now is the time|you should/i.test(t));
      check(`no line in that narration table instructs the player (${Object.keys(table).length} entries)`, bad.length === 0, bad);
    }
    // Modifiers never take a session, so they never narrate — every profile that
    // DOES cook needs all three lines or it falls back to the generic one.
    const cooks = Object.keys(PROFILES).filter(p => !PROFILES[p].modifier);
    check('every cooking profile has its own peak, slipping and fading line',
      cooks.every(p => PEAK_LINES[p] && SLIPPING_LINES[p] && FADING_LINES[p]),
      cooks.filter(p => !(PEAK_LINES[p] && SLIPPING_LINES[p] && FADING_LINES[p])));

    // Examine is a pure read — it must not end or alter the session.
    const beforeExamine = JSON.stringify((await query('SELECT custom_data FROM player_inventory WHERE id=$1', [steakId])).rows[0].custom_data);
    checkCooking({ custom_data: JSON.parse(beforeExamine) });
    const afterExamine = JSON.stringify((await query('SELECT custom_data FROM player_inventory WHERE id=$1', [steakId])).rows[0].custom_data);
    check('reading a cooking session writes nothing', beforeExamine === afterExamine);

    // Plating mid-cook is allowed — you just get what raw is worth.
    r = await run('plate test steak');
    check('plating ends the session and reports a band', r?.type === 'output' && /It's [A-Z]/.test(r.message), JSON.stringify(r));
    sRow = (await query('SELECT custom_data FROM player_inventory WHERE id=$1', [steakId])).rows[0];
    check('plating clears the session and stamps cooked + a quality band',
      !sRow.custom_data.cooking && sRow.custom_data.cooked === true && QUALITY_BANDS.includes(sRow.custom_data.cook_quality), sRow.custom_data);
    heldStove = await getFurnitureById(STOVE);
    check('plating frees the stove', !heldStove.flags?.busy_until, heldStove.flags);

    r = await run('plate test steak');
    check('plating something already off the heat errors cleanly', r?.type === 'error', JSON.stringify(r));

    // Quality is visible on the shelf, not only in the moment you plate or eat it.
    await query('UPDATE player_inventory SET container_id=NULL WHERE id=$1', [steakId]); // out of the pan
    r = await run('examine test steak');
    check('examine reports the band a plated meal was cooked to', /Cooked /.test(r?.message || ''), r?.message);

    // Quality scales the meal. Same item, same restore tag, two bands.
    for (const [band, expected] of [['poor', 10], ['masterful', 32]]) {
      await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2', [player.id, STEAK]);
      await query(
        `INSERT INTO player_inventory (id,player_id,item_id,quantity,condition,custom_data) VALUES ($1,$2,$3,1,1.0,$4::jsonb)`,
        [randomUUID(), player.id, STEAK, JSON.stringify({ cooked: true, cook_quality: band })]
      );
      player.hunger = 0;
      const eaten = await run('eat test steak');
      check(`a ${band} meal restores ${expected} hunger`, player.hunger === expected, `hunger=${player.hunger}`);
      if (band === 'masterful') check("a masterful meal is well-fed even though the item isn't tagged well_fed", /Well-fed/.test(eaten?.message || ''), eaten?.message);
    }

    // Unquality-stamped food is untouched by any of this.
    await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2', [player.id, STEAK]);
    const plainId = randomUUID();
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition,custom_data) VALUES ($1,$2,$3,1,1.0,'{"cooked":true}'::jsonb)`, [plainId, player.id, STEAK]);
    player.hunger = 0;
    r = await run('eat test steak');
    check('food with no cook_quality restores exactly what it always did', player.hunger === 20, `hunger=${player.hunger}`);

    // Burning: a profiled cook left alone resolves to the burnt target.
    const burnId = randomUUID();
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition) VALUES ($1,$2,$3,1,1.0)`, [burnId, player.id, STEAK]);
    r = await run('cook test steak');
    check('a profiled food heats fine with no vessel at all', r?.type === 'output', JSON.stringify(r));
    const burnRow = (await query('SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND jsonb_exists(custom_data,$3)', [player.id, STEAK, 'cooking'])).rows[0];
    await cookTest.autoPlate(burnRow.id, player.id);
    const burnt = (await query('SELECT custom_data FROM player_inventory WHERE id=$1', [burnRow.id])).rows[0];
    check('food left on the heat past the burn point ends up burnt, not waiting',
      !burnt.custom_data.cooking && burnt.custom_data.cook_quality === PROFILES.dense_meat.targets.burnt, burnt.custom_data);
    const freed = await getFurnitureById(STOVE);
    check('burning off the heat frees the stove too', !freed.flags?.busy_until, freed.flags);

    // ── `mix` on a cooking vessel ────────────────────────────────────────────
    //
    // `mix` is the drinks plugin's verb and stays there, but a mixing bowl is a
    // `vessel`, never `drinkware` — so every sentence a player would naturally
    // type at a bowl ("mix mustard into bowl") missed drinks' lookup and came
    // back either "You don't have a bowl" or, worse, "Unknown command: mix" one
    // line after `mix` had printed its own usage.
    await query('DELETE FROM player_inventory WHERE container_id=$1', [panId]);
    const mixMeId = randomUUID();
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition) VALUES ($1,$2,$3,1,1.0)`, [mixMeId, player.id, TOM]);

    r = await run('mix test tomato into test pan');
    check('mix <thing> into a cooking vessel is accepted, not refused', r?.type === 'use', JSON.stringify(r));
    const moved = (await query('SELECT container_id FROM player_inventory WHERE id=$1', [mixMeId])).rows[0];
    check('mixing into a vessel MOVES the ingredient in', moved?.container_id === panId, moved?.container_id);
    check('the reply teaches the verb that finishes it', /plate/.test(r?.message || ''), r?.message);

    // The failure that started this: an unknown vessel must refuse in words,
    // never fall through to "Unknown command" — the verb plainly exists.
    r = await run('mix nothing at all into a fictional bowl');
    check("mixing into something you don't have is a spoken refusal",
      r?.type === 'error' && /don't have/.test(r.message || ''), JSON.stringify(r));
    r = await run('mix a fictional bowl');
    check('bare mix of an unknown vessel is a spoken refusal too',
      r?.type === 'error' && /don't have/.test(r.message || ''), JSON.stringify(r));

    await query('DELETE FROM player_inventory WHERE container_id=$1', [panId]);
    await query('DELETE FROM player_inventory WHERE id=$1', [mixMeId]).catch(() => {});

    // ── Mince → bowl: the working board ──────────────────────────────────────
    //
    // A minced cut is renamed in custom_data ONLY, and `inventory` prints that
    // name — so the name the player was shown was the one name `stow` could not
    // resolve, and mince could never be put in a vessel. The second half is
    // worse: merging a minced row into a plain stack keeps the TARGET's
    // custom_data, so a successful stow would have silently un-minced it.
    await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2', [player.id, STEAK]);
    const minceId = randomUUID();
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition) VALUES ($1,$2,$3,1,1.0)`, [minceId, player.id, STEAK]);
    r = await run('mince test steak');
    check('mincing a cut works with a knife in hand', r?.type === 'output', JSON.stringify(r));
    let mRow = (await query('SELECT custom_data FROM player_inventory WHERE id=$1', [minceId])).rows[0];
    check('mince stamps the row and renames it in custom_data',
      mRow.custom_data?.minced === true && /mince/.test(mRow.custom_data?.name || ''), mRow.custom_data);

    // A plain cut already in the pan — the merge target that used to eat it.
    const plainStackId = randomUUID();
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition,container_id) VALUES ($1,$2,$3,1,1.0,$4)`, [plainStackId, player.id, STEAK, panId]);

    r = await run(`put ${mRow.custom_data.name} in test pan`);
    check('mince stows into a vessel under the name you were shown', r?.type === 'stow', JSON.stringify(r));
    mRow = (await query('SELECT container_id, custom_data FROM player_inventory WHERE id=$1', [minceId])).rows[0];
    check('the minced row survives the stow — it never merges away', !!mRow, 'row gone');
    check('mince lands in the vessel', mRow?.container_id === panId, mRow?.container_id);
    check('mince is still mince after being put in the pan', mRow?.custom_data?.minced === true, mRow?.custom_data);
    check('the plain cut it stowed beside is untouched',
      (await query('SELECT id FROM player_inventory WHERE id=$1', [plainStackId])).rows.length === 1);

    // The board itself: one command that says what is in play and where.
    r = await run('mise');
    check('mise reports the vessel', r?.type === 'output' && /test pan/.test(r.message), JSON.stringify(r));
    check('mise names the mince inside it', /mince/.test(r?.message || ''), r?.message);
    check('prep reaches the same board', (await run('prep'))?.message === r.message);

    // ── The shared `cook` verb ───────────────────────────────────────────────
    await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2', [player.id, STEAK]);
    check('a room with only a stove offers one kind of cooking',
      new Set(cookTest2.cookStations(Z).map(s => s._cookKind)).size === 1, cookTest2.cookStations(Z).map(s => s.name));

    r = await run('cook');
    check('bare cook at a stove alone opens the kitchen workspace, not a prompt',
      r?.type === 'workspace_view' && r.provider === 'kitchen', JSON.stringify(r));

    await insertFurniture({
      id: LAB, name: 'test chem bench', description: 'a test chem bench', object_type: 'fixture',
      zone_id: Z, flags: JSON.stringify({ crafting_station: 'chem_lab' }),
    }, 'ON CONFLICT (id) DO UPDATE SET flags=EXCLUDED.flags, zone_id=EXCLUDED.zone_id');

    const both = cookTest2.cookStations(Z);
    check('a stove and a chem lab in one room are both cook stations', new Set(both.map(s => s._cookKind)).size === 2, both.map(s => `${s.name}:${s._cookKind}`));

    r = await run('cook');
    check('bare cook with a stove AND a lab raises a station prompt', /Cook on which/.test(r?.message || ''), JSON.stringify(r));
    check('the prompt lists both stations by name', /test cooktop/.test(r?.message || '') && /test chem bench/.test(r?.message || ''), r?.message);
    // Picking the stove out of that prompt lands where a bare `cook` would have.
    r = await run('1');
    check('choosing the stove from the station prompt opens the kitchen workspace',
      r?.type === 'workspace_view' && r.provider === 'kitchen', JSON.stringify(r));
    await run('cancel'); // clear the selection state so it can't leak into later checks

    // Routing stays target-first even with both stations present.
    const routeId = randomUUID();
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition) VALUES ($1,$2,$3,1,1.0)`, [routeId, player.id, STEAK]);
    r = await run('cook test steak');
    check('cook <carried food> is food even in a room with a chem lab', r?.type === 'output' && /You put/.test(r.message), JSON.stringify(r));
    await query('DELETE FROM player_inventory WHERE id=$1', [routeId]);

    // Not carried → the router hands it to synthesis, whose error it is to give.
    // (Which error depends on whether this DB has synth recipes at all; either
    // way it must NOT be the food path's "you don't have that".)
    r = await run('cook nothing you have ever heard of');
    check('cook <unknown> falls through to synthesis, not the food path',
      r?.type === 'error' && /cook anything|know how to cook/.test(r.message || '') && !/don't have/.test(r.message || ''), JSON.stringify(r));

    // `heat` survives as a pure alias — the pre-pass rewrites it before routing.
    check('heat is aliased to cook', getAlias('heat') === 'cook', getAlias('heat'));
    await deleteFurniture(LAB);
    // ── kitchenkit (admin) ───────────────────────────────────────────────────
    const savedRole = player.role;
    player.role = 'player';
    r = await run('kitchenkit');
    check('kitchenkit is refused to a non-admin', r?.type === 'error' && /Access denied/.test(r.message), JSON.stringify(r));

    player.role = 'admin';
    r = await run('kitchenkit');
    check('kitchenkit issues equipment to an admin', r?.type === 'output' && /Kitchen kit issued|already have all/.test(r.message), JSON.stringify(r));

    const kitHeld = (await query(
      `SELECT i.id FROM player_inventory pi JOIN items i ON i.id=pi.item_id
        WHERE pi.player_id=$1 AND i.tags ?| $2::text[]`,
      [player.id, ['vessel', 'can_turn', 'can_stir', 'portable_oven']]
    )).rows;
    check('every vessel and utensil in the catalog is now carried', kitHeld.length >= 5, kitHeld.length);

    r = await run('kitchenkit');
    check('running it twice issues no duplicates', /already have all/.test(r?.message || ''), JSON.stringify(r));
    player.role = savedRole;

    // Hand the kit back. It's real catalog equipment, and leaving ten items in
    // the shared fake player's pack changes what later suites see it carrying.
    await query(
      `DELETE FROM player_inventory pi USING items i
        WHERE i.id = pi.item_id AND pi.player_id = $1 AND i.tags ?| $2::text[] AND pi.id <> ALL($3::text[])`,
      [player.id, ['vessel', 'can_turn', 'can_stir', 'portable_oven'], [panId, turnerId]]
    );

    // ── plate <vessel> end-to-end ────────────────────────────────────────────
    // The one path that exercises the real INSERT, so a bad dish row can't reach
    // production behind a green suite of pure-function checks.
    await query('DELETE FROM player_flags WHERE player_id=$1 AND flag_key LIKE $2', [player.id, `${FLAG_PREFIX}%`]);
    await query(`UPDATE items SET tags=$2 WHERE id=$1`, [PAN, JSON.stringify({ container: 2000, vessel: true, vessel_kind: 'pan', heat_distribution: 0.7, heat_retention: 0.45, unique: true })]);
    await reloadItem(PAN);

    const fatId = randomUUID(), steak2 = randomUUID();
    const FAT = 'item_cooking_regress_fat';
    await query(
      `INSERT INTO items (id,name,description,type,value,weight,tags) VALUES ($1,$2,$2,'misc',1,$4,$3)
       ON CONFLICT (id) DO UPDATE SET tags=$3, weight=$4`,
      [FAT, 'test dripping', JSON.stringify({ consumable: true, food_profile: 'fat_or_oil', food_noun: 'dripping', restore_hunger: 4, stackable: true }), 200]
    );
    await reloadItem(FAT);
    await query('DELETE FROM player_inventory WHERE container_id=$1', [panId]);
    // Earlier cases left the stove held. Release it through the engine path —
    // furniture is served from an in-memory map, so raw SQL wouldn't be seen.
    await cookTest.freeAppliance({ applianceId: STOVE });
    await cookTest.freeAppliance({ applianceId: STOVE_POWERED });
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition,container_id) VALUES ($1,$2,$3,1,1.0,$4)`, [steak2, player.id, STEAK, panId]);
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition,container_id) VALUES ($1,$2,$3,1,1.0,$4)`, [fatId, player.id, FAT, panId]);

    r = await run('cook test pan');
    check('cooking a vessel heats its real ingredients', r?.type === 'output' && /test steak/.test(r.message), JSON.stringify(r));
    check("a modifier isn't put on the heat as its own ingredient", !/test dripping/.test(r?.message || ''), r?.message);

    const batch = (await query(
      `SELECT pi.id, pi.custom_data, i.tags->>'food_profile' AS profile
         FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.container_id=$1`, [panId])).rows;
    const sessioned = batch.filter(b => b.custom_data?.cooking);
    check('the scored ingredient takes a session', sessioned.length === 1 && sessioned[0].profile === 'dense_meat', batch.map(b => `${b.profile}:${!!b.custom_data?.cooking}`));
    check('the modifier sits in the vessel with no session of its own — it can never burn away',
      batch.some(b => b.profile === 'fat_or_oil' && !b.custom_data?.cooking), batch.map(b => `${b.profile}:${!!b.custom_data?.cooking}`));

    r = await run('plate test pan');
    check('plating a vessel resolves it to a dish, not to its contents', r?.type === 'output' && /You plate/.test(r.message || ''), JSON.stringify(r));

    const dish = (await query(`SELECT custom_data FROM player_inventory WHERE player_id=$1 AND item_id=$2`, [player.id, 'item_cooked_dish'])).rows[0];
    check('the dish row is actually written', !!dish, dish);
    check('the dish carries a derived name and a band', !!dish?.custom_data?.name && QUALITY_BANDS.includes(dish?.custom_data?.cook_quality), dish?.custom_data);
    check('a meat-and-fat pan resolves to a sear', dish?.custom_data?.dish === 'seared_cut', dish?.custom_data?.dish);
    check('the dish name uses the food_noun, not the item name', /dripping|meat|steak/.test(dish?.custom_data?.name || ''), dish?.custom_data?.name);

    const consumed = (await query('SELECT id FROM player_inventory WHERE container_id=$1', [panId])).rows;
    check('the ingredients are consumed by plating', consumed.length === 0, consumed.length);

    const afterOne = await cookbookState(player.id);
    check('one plate never writes the recipe down', !afterOne.known.has('seared_cut'), [...afterOne.known]);
    // Progress is earned only by a good-or-better plate, so the rule — not a
    // fixed outcome — is what's asserted: this cook is plated the instant it
    // starts, so it's raw, so it should teach nothing.
    const platedBand = dish?.custom_data?.cook_quality;
    const earned = (afterOne.progress.get('seared_cut') || 0) >= 1;
    check('progress is logged if and only if the plate met the bar',
      earned === (bandIndex(platedBand) >= bandIndex('good')), { platedBand, earned });

    await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2', [player.id, 'item_cooked_dish']);
    await query('DELETE FROM items WHERE id=$1', [FAT]).catch(() => {});
    deleteItemCache(FAT);

    // ── Cooking IP: 1 routine (on a cooldown), 3 for masterful (never) ───────
    check('an ordinary meal is worth 1 IP', cookingIpFor('good', 0, 1000).ip === ROUTINE_IP, cookingIpFor('good', 0, 1000));
    check('a masterful meal is worth 3', cookingIpFor('masterful', 0, 1000).ip === MASTERFUL_IP);
    const justEarned = 1_000_000;
    check('a second routine meal inside the cooldown pays nothing',
      cookingIpFor('good', justEarned, justEarned + 1000).ip === 0, cookingIpFor('good', justEarned, justEarned + 1000));
    check('...and says so, rather than silently paying zero', cookingIpFor('good', justEarned, justEarned + 1000).cooled === true);
    check("masterful ignores the cooldown entirely — you can't grind those",
      cookingIpFor('masterful', justEarned, justEarned + 1000).ip === MASTERFUL_IP);
    check('the cooldown expires', cookingIpFor('good', justEarned, justEarned + ROUTINE_IP_COOLDOWN_MS + 1).ip === ROUTINE_IP);
    check('only a routine award resets the cooldown clock',
      cookingIpFor('good', 0, 1000).resets === true && cookingIpFor('masterful', 0, 1000).resets === false);

    // ── Smoking: meat in, PRESERVED out ──────────────────────────────────────
    check('a smoked cut reads as preserved, whatever it started as',
      profileNameFor({ tags: { food_profile: 'dense_meat' }, custom_data: { smoked: 'preserved' } }) === 'preserved');
    check('an unsmoked cut is unaffected',
      profileNameFor({ tags: { food_profile: 'dense_meat' }, custom_data: {} }) === 'dense_meat');
    check('a nonsense smoked value is ignored rather than trusted',
      profileNameFor({ tags: { food_profile: 'dense_meat' }, custom_data: { smoked: 'nope' } }) === 'dense_meat');
    const smokeSession = { startedAt: 0, thawMs: 0, cookMs: 60000, profile: 'preserved', vessel: BARE_VESSEL, smoking: true };
    const plainSession = { startedAt: 0, thawMs: 0, cookMs: 60000, profile: 'preserved', vessel: BARE_VESSEL };
    check('a smoke gets a far wider window than the same time on a stove',
      timeline(smokeSession, PROFILES.preserved).peakMs > timeline(plainSession, PROFILES.preserved).peakMs * 2,
      { smoked: timeline(smokeSession, PROFILES.preserved).peakMs, plain: timeline(plainSession, PROFILES.preserved).peakMs });
    check('smoked meat slots into preserved recipes with no new template', (() => {
      const rows = [
        { id: 'x', name: 'smoked beef', tags: { food_profile: 'dense_meat' }, custom_data: { smoked: 'preserved', food_noun: 'smoked beef' } },
        { id: 'item_bone_broth', name: 'bone broth', tags: { food_profile: 'liquid' }, custom_data: {} },
      ];
      return matchDish(signature(rows, profileNameFor), 'pot', new Set(['item_bone_broth']))?.key === 'brined_pot';
    })());

    // ── Price: the band is worth money, the same way drug potency is ─────────
    const px = (band, opts = {}) => computeSellUnitPrice(40, 0, 0, { cookQuality: band, ...opts });
    check('every band has a price multiplier', QUALITY_BANDS.every(b => COOK_QUALITY_PRICE[b]),
      QUALITY_BANDS.filter(b => !COOK_QUALITY_PRICE[b]));
    check('price rises with every rung, without exception', (() => {
      let last = -1;
      for (const b of QUALITY_BANDS) { const p = px(b); if (p <= last) return false; last = p; }
      return true;
    })(), QUALITY_BANDS.map(b => `${b}:${px(b)}`));
    check('a botched plate is worth less than an ordinary one', px('poor') < px('acceptable'));
    check('a masterful plate is worth many times a botched one', px('masterful') / px('poor') >= 5,
      { masterful: px('masterful'), poor: px('poor'), ratio: (px('masterful') / px('poor')).toFixed(1) });
    check('a food buyer pays a real premium, like a drug buyer does',
      px('masterful', { foodBuyer: true }) > px('masterful') * 1.5);
    check('half a dish sells for about half', Math.abs(px('masterful', { portion: 0.5 }) - px('masterful') / 2) <= 1);
    check('an item with no band prices exactly as it always did',
      computeSellUnitPrice(40, 0, 0, {}) === computeSellUnitPrice(40, 0, 0, { cookQuality: null }));
    check("an unknown band doesn't zero out the price", px('nonsense') === computeSellUnitPrice(40, 0, 0, {}));
    check('the quality multiplier respects the same ceiling drug potency does',
      Math.max(...Object.values(COOK_QUALITY_PRICE)) <= 3);

    // ── What the bands are WORTH ─────────────────────────────────────────────
    // Nine rungs of feedback are pointless if only the top one changes anything.
    check('every band has a reward entry', QUALITY_BANDS.every(b => BAND_REWARDS[b]),
      QUALITY_BANDS.filter(b => !BAND_REWARDS[b]));
    check('rewards never go backwards up the ladder', (() => {
      let lastFed = -1, lastIp = -1;
      for (const b of QUALITY_BANDS) {
        const r = rewardFor(b);
        if (r.wellFedMs < lastFed || r.ip < lastIp) return false;
        lastFed = r.wellFedMs; lastIp = r.ip;
      }
      return true;
    })(), QUALITY_BANDS.map(b => `${b}:${rewardFor(b).wellFedMs / 60000}m/${rewardFor(b).ip}ip`));
    check('well-fed is no longer masterful-or-nothing', rewardFor('good').wellFedMs > 0 && rewardFor('excellent').wellFedMs > 0);
    check('...but masterful still has the longest', rewardFor('masterful').wellFedMs > rewardFor('superb').wellFedMs);
    check('the bottom four bands earn no buff at all', ['poor', 'grim', 'acceptable', 'decent'].every(b => rewardFor('' + b).wellFedMs === 0));
    check('an unknown band falls back to the baseline rather than crashing', rewardFor('nonsense').ip === rewardFor('acceptable').ip);
    check('excellent and up escape the IP cooldown', !rewardFor('excellent').cooled && !rewardFor('masterful').cooled);
    check('routine cooking is still rate-limited', rewardFor('acceptable').cooled && rewardFor('good').cooled);

    // ── Resting: carry-over cooking from ONE timestamp ───────────────────────
    const T = 1_000_000;
    check("food that doesn't rest is unaffected", restMultiplier(T, false, T + 60_000) === 1);
    check('eaten straight off the heat, no bonus', restMultiplier(T, true, T + 1000) === 1);
    check('rested into the window, a real bonus', restMultiplier(T, true, T + REST_PEAK_MS) > 1.2, restMultiplier(T, true, T + REST_PEAK_MS));
    check('the bonus climbs toward the peak',
      restMultiplier(T, true, T + REST_PEAK_MS) > restMultiplier(T, true, T + REST_MIN_MS + 1000));
    check('left too long it goes cold and costs you', restMultiplier(T, true, T + REST_COLD_MS + 1) < 1, restMultiplier(T, true, T + REST_COLD_MS + 1));
    check('the curve is continuous — no cliff at the cold edge',
      Math.abs(restMultiplier(T, true, T + REST_COLD_MS - 1) - REST_COLD_PENALTY) < 0.02);
    check('examine describes each phase differently', new Set([
      restText(T, true, T + 1000), restText(T, true, T + REST_PEAK_MS),
      restText(T, true, T + REST_COLD_MS - 60_000), restText(T, true, T + REST_COLD_MS + 1),
    ]).size === 4);
    check('a stew has nothing to rest', restText(T, false, T + 60_000) === null);
    check('only things that brown are worth resting',
      RESTS_WELL.every(p => PROFILES[p]) && !RESTS_WELL.includes('liquid'), RESTS_WELL);

    // ── The quality scale: nine bands, and the old five still mean what they did
    check('the scale has nine rungs', QUALITY_BANDS.length === 9, QUALITY_BANDS);
    check('every band name is unique', new Set(QUALITY_BANDS).size === QUALITY_BANDS.length);
    for (const [name, expected] of Object.entries(LEGACY_BAND_INDEX)) {
      check(`"${name}" still sits where it did (index ${expected})`, bandIndex(name) === expected, bandIndex(name));
    }
    check('the five original bands are exactly TWICE their old index — no meal in the database changed meaning',
      Object.entries(LEGACY_BAND_INDEX).every(([n, i]) => bandIndex(n) === i) &&
      [0, 1, 2, 3, 4].every((old, k) => Object.values(LEGACY_BAND_INDEX)[k] === old * 2));
    check('acceptable is still the 1.0x baseline, in the middle of the scale',
      bandIndex('acceptable') * 2 === QUALITY_BANDS.length - 1 - 4, bandIndex('acceptable'));

    // Doubling the span without doubling the scoring would have made every dish
    // dramatically easier — a cook would start only 4.4 rungs below a ceiling
    // that is now 8 high instead of 4. BAND_SCALE is what keeps the curve.
    check('the scoring constants scaled with the span', BASE_OFFSET === -2.2 * BAND_SCALE, { BASE_OFFSET, BAND_SCALE });
    check('a score of X now lands at exactly twice the rung it used to', (() => {
      // raw_new = ceiling*2 + BASE*2 + mods*2 = 2 * raw_old, for any modifiers.
      for (const mods of [-3, -1.4, -0.11, 0, 0.48, 1.08, 2.6]) {
        const rawOld = 4 + (-2.2) + mods;
        const rawNew = 8 + BASE_OFFSET + mods * BAND_SCALE;
        if (Math.abs(rawNew - rawOld * 2) > 1e-9) return false;
      }
      return true;
    })());

    // Names used as thresholds elsewhere must still resolve, or those gates
    // silently become "index 0" and stop meaning anything.
    for (const name of [FOND_MIN_BAND, DISCOVERY_MIN_BAND, SLOP_CEILING]) {
      check(`threshold band "${name}" is still a real band`, QUALITY_BANDS.includes(name), name);
    }
    check('every profile ceiling is still a real band',
      Object.values(PROFILES).every(p => Object.values(p.targets).every(b => QUALITY_BANDS.includes(b))));
    check('every dish ceiling is still a real band',
      Object.values(DISHES).every(d => QUALITY_BANDS.includes(d.ceiling)),
      Object.entries(DISHES).filter(([, d]) => !QUALITY_BANDS.includes(d.ceiling)).map(([k]) => k));

    // ── Food poisoning actually does something now ───────────────────────────
    // It was applied by four paths and REGISTERED BY NONE — for its whole life
    // it sat in player.statuses counting down and doing nothing at all.
    check('food poisoning is a registered effect', getRegisteredStatusEffects().includes('food_poisoning'));

    const sick = () => {
      const p = { hp: 100, hp_max: 100, stamina: 100, stamina_max: 100, statuses: [], handle: 'T', current_zone: Z };
      applyEffect(p, 'food_poisoning', 60);
      return p;
    };
    const runTicks = (p, n) => { const out = []; for (let i = 0; i < n; i++) out.push(...tickEffects(p)); return out; };

    const p1 = sick();
    runTicks(p1, 8);
    check("it guts your stamina fast — you're going nowhere", p1.stamina <= 10, p1.stamina);
    check('...but barely touches your HP', 100 - p1.hp <= 10, 100 - p1.hp);

    const p2 = sick();
    runTicks(p2, 200);
    check('HP loss is capped across the whole illness', 100 - p2.hp <= 30, 100 - p2.hp);
    check('it can never be the thing that kills you', p2.hp >= 1, p2.hp);
    check('stamina stays on the floor throughout', p2.stamina === 0);

    const msgs = runTicks(sick(), 40);
    check('there are episodes, not just a status line',
      msgs.some(m => /sick|toilet|guts give out|holding it|comes up|double over/i.test(m)), msgs.slice(0, 3));
    check('both ends are represented', (() => {
      const all = runTicks(sick(), 80).join(' ');
      return /toilet|guts give out|holding it/i.test(all) && /comes up|double over|inside out/i.test(all);
    })());

    // A fresh bout gets its own budget, or a second poisoning would be free.
    const p3 = sick();
    runTicks(p3, 200);
    const afterFirst = p3.hp;
    applyEffect(p3, 'food_poisoning', 60);
    runTicks(p3, 40);
    check('a second bout can hurt you again — the cap is per illness', p3.hp < afterFirst, { afterFirst, now: p3.hp });

    // ── Volume: recipes count MASS, not how many things you put in ───────────
    const vRow = (prof, grams, portion) => ({ weight: grams, tags: { food_profile: prof }, custom_data: portion ? { portion } : {} });
    check('every profile declares what one unit weighs', Object.values(PROFILES).every(p => p.unitWeight > 0),
      Object.entries(PROFILES).filter(([, p]) => !p.unitWeight).map(([k]) => k));
    check('an item of exactly unit weight counts as one',
      unitsOf(vRow('dense_meat', PROFILES.dense_meat.unitWeight), 'dense_meat') === 1);
    check('a big cut counts as more than one', unitsOf(vRow('dense_meat', 700), 'dense_meat') > 2.5);
    check('a small one counts as less', unitsOf(vRow('dense_meat', 200), 'dense_meat') < 1);
    check('portions still halve it', unitsOf(vRow('soft_vegetable', 120, 0.5), 'soft_vegetable') === 0.5);
    check('a weightless row falls back to counting as one rather than vanishing',
      unitsOf({ tags: { food_profile: 'liquid' }, custom_data: {} }, 'liquid') === 1);
    // Modifiers are dosed, not weighed — a jar of mustard is forty uses of mustard.
    check('a heavy condiment still counts as ONE seasoning',
      unitsOf(vRow('aromatic', 250), 'aromatic') === 1 && unitsOf(vRow('fat_or_oil', 600), 'fat_or_oil') === 1);
    check('...which is what stops one jar reading as catastrophic over-seasoning',
      signature([vRow('aromatic', 250), vRow('aromatic', 20)], r => r.tags.food_profile).aromatic === 2);

    // ── Prep: score, tenderise, marinate ─────────────────────────────────────
    const prepSess = extra => ({ startedAt: 0, thawMs: 0, cookMs: 60000, profile: 'dense_meat',
      heatTier: 'low', vessel: BARE_VESSEL, acts: [{ at: 30000 }], ...extra });
    check('scoring widens the window', prepWindowMult({ scored: true }) > 1);
    check('tenderising widens it too', prepWindowMult({ tenderised: true }) > 1);
    check('an unprepped cut gets no slack', prepWindowMult({}) === 1);
    check('tenderising costs one rung; mince costs two',
      prepCeilingDrop({ tenderised: true }) < prepCeilingDrop({ minced: true }) && prepCeilingDrop({ tenderised: true }) > 0,
      { tenderised: prepCeilingDrop({ tenderised: true }), minced: prepCeilingDrop({ minced: true }) });
    check("mince already destroyed what tenderising would — the costs don't stack",
      prepCeilingDrop({ minced: true, tenderised: true }) === prepCeilingDrop({ minced: true }));
    check('scoring pays a flat bonus', prepBonus({ scored: true }) > 0);
    check('a marinade under the minimum soak has done nothing',
      marinadeStrength({ custom_data: { marinated_at: 1_000_000 } }, 1_000_000 + 1000) === 0);
    check('a full soak is worth the most', marinadeStrength({ custom_data: { marinated_at: 1 } }, 1 + MARINATE_FULL_MS) === 1);
    check('...and it climbs in between',
      marinadeStrength({ custom_data: { marinated_at: 1 } }, 1 + (MARINATE_MIN_MS + MARINATE_FULL_MS) / 2) > 0);
    check('time is the whole cost of a marinade — no soak, no gain',
      prepBonus(prepSess({ marinated_at: Date.now() }), Date.now()) === 0);
    check('only meat and cured cuts are worth marinating',
      canMarinate('dense_meat') && !canMarinate('batter'), MARINATE_PROFILES);
    // The marinade is frozen when the heat comes on. Without this, a token soak
    // followed by a long cook would collect the full bonus for free.
    check('a frozen marinade strength is what scores, not the wall clock',
      prepBonus(prepSess({ marinade: 1 }), Date.now() + MARINATE_FULL_MS * 10)
        === prepBonus(prepSess({ marinade: 1 }), 0));
    check('a token soak stays a token soak however long the cook runs',
      prepBonus(prepSess({ marinade: 0 }), Date.now() + MARINATE_FULL_MS * 10) === 0);
    check('a half-strength marinade pays half',
      Math.abs(prepBonus(prepSess({ marinade: 0.5 }), 0) * 2 - prepBonus(prepSess({ marinade: 1 }), 0)) < 1e-9);
    // Scoring is a wider window bought with a shorter grace after it.
    // The live-cook registry: `smell` is a spammable verb, so "what's on the
    // heat in this room" must be answerable without a query. A stale entry here
    // is worse than a slow one — it would report a pot that was plated long ago.
    const { cooksOnAppliances, forgetCook } = await import('./cook.js');
    check('an appliance with nothing on it reports nothing',
      cooksOnAppliances(['no-such-stove']).length === 0);
    check('the registry answers without touching the database',
      Array.isArray(cooksOnAppliances([])) && cooksOnAppliances([]).length === 0);
    check('forgetting a cook that was never live is a safe no-op', (() => {
      forgetCook('no-such-inv-row');
      return true;
    })());

    // ── Procedural audio ──────────────────────────────────────────────────────
    // Cooking emits SEMANTICS and owns no acoustics; the audio plugin turns an
    // action + material + intensity into layers. The contract worth protecting
    // is that every action×material pair yields a playable def, because a silent
    // verb fails in a way nobody notices until a player asks why.
    await import('../../client/shared/procedural-sfx.js');   // dual-mode: attaches to globalThis
    const { buildCookingCue, ...sfxTest } = globalThis.ProceduralSFX;
    const ACTIONS = ['chop', 'impact', 'scrape', 'stir', 'pour', 'sizzle', 'boil'];
    const MATS = Object.keys(sfxTest.MATERIALS);
    let badCue = null;
    for (const action of ACTIONS) {
      for (const m of MATS) {
        const d = buildCookingCue({ action, material: m, intensity: 0.6 });
        if (!d?.config?.layers?.length) { badCue = `${action}/${m}`; break; }
        if (d.config.duration <= 0) { badCue = `${action}/${m} duration`; break; }
        if (d.config.layers.some(l => l.gain > 1 || l.gain <= 0)) { badCue = `${action}/${m} gain`; break; }
      }
      if (badCue) break;
    }
    check('every action × material produces a playable cue', !badCue, badCue);
    check('an unknown action stays silent rather than throwing',
      buildCookingCue({ action: 'nonsense' }) === null);
    check('an unknown material falls back instead of throwing',
      !!buildCookingCue({ action: 'chop', material: 'no_such_material' })?.config?.layers?.length);

    // The point of a procedural generator: the same call twice is not the same
    // sound. Without variation it reads as one sample on repeat.
    const a = buildCookingCue({ action: 'chop', material: 'hard_food', intensity: 0.6 });
    const b = buildCookingCue({ action: 'chop', material: 'hard_food', intensity: 0.6 });
    check('repeats vary rather than replaying identically',
      JSON.stringify(a.config.layers[0]) !== JSON.stringify(b.config.layers[0]));

    // SEEDING is what lets the server send ~100 bytes instead of a serialised
    // burst field. The client rebuilds from the seed, so the two MUST agree
    // exactly — if this drifts, players hear something the server never meant.
    const seeded = s => buildCookingCue({ action: 'sizzle', material: 'wet_meat', heat: 0.9, seed: s });
    check('the same seed rebuilds the identical cue',
      JSON.stringify(seeded(12345)) === JSON.stringify(seeded(12345)));
    check('a different seed gives a different cue',
      JSON.stringify(seeded(12345)) !== JSON.stringify(seeded(999)));
    check("seeding doesn't leave the generator armed for the next caller", (() => {
      seeded(42);
      const x = buildCookingCue({ action: 'chop', material: 'hard_food' });
      const y = buildCookingCue({ action: 'chop', material: 'hard_food' });
      return JSON.stringify(x) !== JSON.stringify(y);
    })());
    // The whole point of the refactor, asserted: parameters are tiny where the
    // rendered layers are not.
    check('the wire payload is a fraction of the rendered cue', (() => {
      const params = JSON.stringify({ action: 'sizzle', material: 'wet_meat', heat: 0.9, seed: 4242 }).length;
      const rendered = JSON.stringify(seeded(4242)).length;
      return params * 10 < rendered;
    })());

    // Material must actually change the sound, or the whole design is theatre.
    const wet = buildCookingCue({ action: 'chop', material: 'wet_meat', intensity: 0.6 });
    const dry = buildCookingCue({ action: 'chop', material: 'bread', intensity: 0.6 });
    check("a wet material adds a squelch layer a dry one doesn't have",
      wet.config.layers.length > dry.config.layers.length,
      { wet: wet.config.layers.length, dry: dry.config.layers.length });
    check('heat drives sizzle density', (() => {
      const cool = buildCookingCue({ action: 'sizzle', material: 'wet_meat', heat: 0.1 });
      const hot  = buildCookingCue({ action: 'sizzle', material: 'wet_meat', heat: 1 });
      return hot.config.layers.length > cool.config.layers.length;
    })());
    // States are the sparse alternative to authoring 425 acoustic values across
    // 85 items. Frozen is the one that earns its place, and it's already tracked.
    const room = buildCookingCue({ action: 'chop', material: 'wet_meat', intensity: 0.6 });
    const iced = buildCookingCue({ action: 'chop', material: 'wet_meat', intensity: 0.6, state: 'frozen' });
    check('frozen meat loses the wet squelch a thawed cut has',
      iced.config.layers.length < room.config.layers.length,
      { thawed: room.config.layers.length, frozen: iced.config.layers.length });
    check('...and goes under the knife brighter, like wood', (() => {
      const blade = d => d.config.layers.find(l => l.waveform === 'square')?.freq || 0;
      return blade(iced) > blade(room);
    })());
    check('an unknown state is ignored rather than throwing',
      !!buildCookingCue({ action: 'chop', material: 'wet_meat', state: 'no_such_state' })?.config?.layers?.length);
    check('every declared state is a function the generator can apply',
      Object.values(sfxTest.STATES).every(f => typeof f === 'function'));

    check('burst fields stay bounded however hot it gets',
      buildCookingCue({ action: 'sizzle', material: 'fat', heat: 1, duration: 60 })
        .config.layers.length <= 45);

    // ── The microwave: fast, forgiving, and incapable of a good meal ──────────
    const { MICROWAVE_CEILING, MICROWAVE_SPEED, MICROWAVE_THAW_SPEED, STOVE_SPEED } = await import('./config.js');
    const mw = (extra = {}) => ({ startedAt: 0, thawMs: 0, cookMs: 60000, profile: 'dense_meat',
      heatTier: 'high', vessel: { d: 0.7, r: 0.7 }, acts: [], microwave: true, ...extra });
    const hob = (extra = {}) => ({ ...mw(extra), microwave: undefined });

    check('a microwave is faster than the best stove', MICROWAVE_SPEED > STOVE_SPEED.high);
    check("...and thaws faster still — the one job it's genuinely best at",
      MICROWAVE_THAW_SPEED > MICROWAVE_SPEED);
    check('frozen food thaws far quicker in one than on a hob', (() => {
      const onHob = computeDuration(1000, STOVE_SPEED.high, true, 1);
      const inMw  = computeDuration(1000, MICROWAVE_SPEED, true, 1, MICROWAVE_THAW_SPEED);
      return inMw.thawMs < onHob.thawMs;
    })());

    // The trade: a hard ceiling nothing can lift.
    const mwPeak = evaluate(mw(), PROFILES.dense_meat, timeline(mw(), PROFILES.dense_meat).doneAt + 1, 60);
    const hobPeak = evaluate(hob(), PROFILES.dense_meat, timeline(hob(), PROFILES.dense_meat).doneAt + 1, 60);
    check('a perfectly-timed microwave meal is capped below a hob one',
      bandIndex(mwPeak.band) < bandIndex(hobPeak.band), { mw: mwPeak.band, hob: hobPeak.band });
    check('...and never beats its ceiling however good the cook',
      bandIndex(mwPeak.band) <= bandIndex(MICROWAVE_CEILING), mwPeak.band);
    check('no amount of prep buys it back', (() => {
      const best = evaluate(mw({ scored: true, marinade: 1 }), PROFILES.dense_meat,
        timeline(mw(), PROFILES.dense_meat).doneAt + 1, 100);
      return bandIndex(best.band) <= bandIndex(MICROWAVE_CEILING);
    })());

    // ...bought with forgiveness. It is very hard to ruin anything in one.
    check('a microwave gives an enormous window',
      timeline(mw(), PROFILES.dense_meat).peakMs > timeline(hob(), PROFILES.dense_meat).peakMs);
    check('...and barely burns at all',
      timeline(mw(), PROFILES.dense_meat).burnAt > timeline(hob(), PROFILES.dense_meat).burnAt);
    check('it browns nothing, so it can never leave fond',
      !leavesFond({ vesselKind: 'pan', profiles: ['dense_meat'], band: 'masterful', microwave: true }));

    // It sounds like a microwave, not a pan: a hum with one knock per turn of
    // the plate. Not a loop — three revolutions reads as "running" without
    // pretending to run for the whole cook.
    const mwCue = buildCookingCue({ action: 'microwave', intensity: 0.6, flow: 3, seed: 5 });
    check('a microwave has its own sound', !!mwCue?.config?.layers?.length);
    // The beep is the one cue that must NOT vary much — it's a machine
    // announcing itself, not a physical event.
    const beep = buildCookingCue({ action: 'microwave', state: 'done', seed: 5 });
    check('it beeps three times when the timer runs out',
      beep.config.layers.length === 3, beep.config.layers.length);
    check('the beeps are one flat identical tone',
      new Set(beep.config.layers.map(l => l.freq)).size === 1);
    check("the beep isn't the running sound", beep.id !== mwCue.id);
    check('...built from one knock per revolution',
      mwCue.config.layers.filter(l => l.waveform === 'triangle').length === 3);
    check('...and more revolutions runs longer',
      buildCookingCue({ action: 'microwave', flow: 6, seed: 5 }).config.duration
        > buildCookingCue({ action: 'microwave', flow: 2, seed: 5 }).config.duration);

    check('scoring widens the peak window', prepWindowMult({ scored: true }) > 1);
    check('...and shortens the grace after it — no prep verb is free',
      prepBurnMult({ scored: true }) < 1, prepBurnMult({ scored: true }));
    check('an unscored cut burns on the normal clock', prepBurnMult({}) === 1);
    // A stack has to mean the same thing to the matcher as it does to the clock.
    const oneSpud = { weight: 200, quantity: 1, tags: { food_profile: 'starchy_vegetable' }, custom_data: {} };
    check('three of a thing in one row counts as three',
      Math.abs(unitsOf({ ...oneSpud, quantity: 3 }, 'starchy_vegetable') - unitsOf(oneSpud, 'starchy_vegetable') * 3) < 1e-9);
    check('a row with no quantity still counts as one',
      unitsOf({ ...oneSpud, quantity: undefined }, 'starchy_vegetable') === unitsOf(oneSpud, 'starchy_vegetable'));
    check('stacking and portioning compose',
      Math.abs(unitsOf({ ...oneSpud, quantity: 4, custom_data: { portion: 0.25 } }, 'starchy_vegetable')
        - unitsOf(oneSpud, 'starchy_vegetable')) < 1e-9);
    check('prep state is readable before the heat', !!prepText({ marinated_at: 1 }, 1 + MARINATE_FULL_MS));
    check('an unprepped ingredient says nothing', prepText({}) === null);

    // ── Tasting: what you learn scales with skill ────────────────────────────
    const tSess = prepSess({});
    const notesAt = skill => tasteNotes({ session: tSess, profile: PROFILES.dense_meat, skill, now: 1 });
    check('a novice learns one thing', notesAt(0).length === 1, notesAt(0));
    check('an expert learns more than a novice', notesAt(9).length > notesAt(0).length, { novice: notesAt(0).length, expert: notesAt(9).length });
    check('the tiers are ordered', tasteTier(0) === 'novice' && tasteTier(TASTE_TIERS.competent) === 'competent' && tasteTier(TASTE_TIERS.expert) === 'expert');
    check('a novice is told something vague, an expert something specific',
      notesAt(0)[0] !== tasteNotes({ session: tSess, profile: PROFILES.dense_meat, skill: 9, now: 1 })[0]);
    check("seasoning is only commented on when there's a dish to judge",
      tasteNotes({ template: DISHES.roast, modifierCount: 0, skill: 9 }).length > 0 &&
      tasteNotes({ skill: 9 }).length === 0);

    // ── Eating: nine bands you can actually feel ─────────────────────────────
    check('every band has its own line in the mouth',
      new Set(QUALITY_BANDS.map(b => flavourLines({ cook_quality: b })[0])).size === QUALITY_BANDS.length);
    check('doneness adds a second line', flavourLines({ cook_quality: 'good', doneness: 'rare' }).length === 2);
    check('a cold plate says so', flavourLines({ cook_quality: 'good' }, 'cold').some(l => /cold/i.test(l)));
    check('a rested one says so too', flavourLines({ cook_quality: 'good' }, 'rested').some(l => /sat exactly/i.test(l)));
    check('mince admits what it is', flavourLines({ cook_quality: 'good', minced: true }).some(l => /texture/i.test(l)));
    check('an uncooked thing has nothing to say', flavourLines({}).length === 0);

    // ── Fond remembers what made it ──────────────────────────────────────────
    const meatFond = makeFond('dense_meat', 'excellent', 1_000_000);
    check('fond from meat belongs in a meat dish', fondBelongs(meatFond, DISHES.stew));
    check("...and doesn't belong in a fruit one", !fondBelongs(makeFond('preserved', 'good', 1), DISHES.compote));
    check('lifting fond that belongs pays',
      fondModifier(meatFond, { deglazed: true, template: DISHES.stew, now: 1_000_001 }) > 0);
    check('lifting fond that does NOT belong costs — fruit tasting of fish is worse than plain fruit',
      fondModifier(makeFond('dense_meat', 'excellent', 1_000_000), { deglazed: true, template: DISHES.compote, now: 1_000_001 }) < 0);
    check('with no dish to judge against, fond is assumed to belong', fondBelongs(meatFond, null));

    // ── Mincing: the opposite trade to chopping ──────────────────────────────
    const minceSess = (minced) => ({
      startedAt: 0, thawMs: 0, cookMs: 60000, profile: 'dense_meat',
      heatTier: 'low', vessel: BARE_VESSEL, acts: [{ at: 30000 }], minced,
    });
    const wholeRate = computeDuration(400, STOVE_SPEED.low, false, PROFILES.dense_meat.cookRateMult).cookMs;
    const minceRate = computeDuration(400, STOVE_SPEED.low, false, PROFILES.dense_meat.cookRateMult * MINCE_RATE).cookMs;
    check('mince cooks far faster than the cut it came from', minceRate < wholeRate / 2, { wholeRate, minceRate });
    check('...but weighs the same, so it feeds you the same', MINCE_RATE < 1 && true);

    const ms = minceSess(true), ws = minceSess(false);
    const at = s => timeline(s, PROFILES.dense_meat).doneAt + timeline(s, PROFILES.dense_meat).peakMs / 2;
    const mBand = evaluate(ms, PROFILES.dense_meat, at(ms), 20);
    const wBand = evaluate(ws, PROFILES.dense_meat, at(ws), 20);
    check('mince can never reach what the whole cut could', bandIndex(mBand.band) < bandIndex(wBand.band), { mince: mBand.band, whole: wBand.band });
    check('the drop is exactly the configured one', bandIndex(wBand.ceiling) - bandIndex(mBand.ceiling) === MINCE_CEILING_DROP,
      { whole: mBand.ceiling, minced: wBand.ceiling });
    check('mince is still food, never floored to poor', bandIndex(mBand.ceiling) >= 1, mBand.ceiling);

    check("a doneness target on mince is ignored — there's no rare middle",
      timeline({ ...minceSess(true), target: 'blue' }, PROFILES.dense_meat).doneAt ===
      timeline({ ...minceSess(true), target: 'well done' }, PROFILES.dense_meat).doneAt);
    check('...while a whole cut still honours it',
      timeline({ ...minceSess(false), target: 'blue' }, PROFILES.dense_meat).doneAt !==
      timeline({ ...minceSess(false), target: 'well done' }, PROFILES.dense_meat).doneAt);

    check('mince needs no knife — it IS the prep',
      !needsPrep({ tags: { food_profile: 'dense_meat' }, custom_data: { minced: true } }) &&
      needsPrep({ tags: { food_profile: 'dense_meat' }, custom_data: {} }));
    check('minced meat is instanced, so it never merges back into whole cuts',
      rowIsInstanced({ custom_data: { minced: true } }) === true);

    // ── Portions: half an onion is an onion cut in half ──────────────────────
    const whole = { name: 'onion', custom_data: {} };
    const half = { name: 'onion', custom_data: { portion: 0.5 } };
    const quarter = { name: 'onion', custom_data: { portion: 0.25 } };
    check('an unportioned item is whole', portionOf(whole) === 1 && isWhole(whole));
    check('a half reads as a half', portionOf(half) === 0.5 && !isWhole(half));
    check('a nonsense portion falls back to whole rather than corrupting the maths',
      portionOf({ custom_data: { portion: 0 } }) === 1 && portionOf({ custom_data: { portion: 'x' } }) === 1);

    check('a whole thing can be cut', canChop(whole, 4));
    check('a half can be cut again', canChop(half, 2));
    check('but not past the floor', !canChop(quarter, 4), MIN_PORTION);

    check('a half is named as one', portionName(half, 'onion') === 'half an onion', portionName(half, 'onion'));
    check('a quarter too', portionName(quarter, 'potato') === 'a quarter of a potato', portionName(quarter, 'potato'));
    check('a whole one keeps its plain name', portionName(whole, 'onion') === 'onion');

    // THE invariant: portions conserve. Cutting creates nothing.
    check('four quarters yield exactly what one whole yields',
      yieldOf([quarter, quarter, quarter, quarter]) === 0.25 && yieldOf([whole]) === 1,
      { quarters: yieldOf([quarter, quarter, quarter, quarter]), whole: yieldOf([whole]) });
    check('a dish of halves yields half', yieldOf([half, half]) === 0.5);
    check('a dish of whole ingredients yields full', yieldOf([whole, whole]) === 1);
    check('mixing whole and half lands between', yieldOf([whole, half]) === 0.75);

    // And the payoff: a portion cooks faster — by m^(2/3), not in proportion.
    // A quarter-weight piece is ~40% of the clock, because heat still has to
    // cross what's left of it. Chopping is a real lever, just not a linear one.
    const wholeCook = computeDuration(400 * portionOf(whole), STOVE_SPEED.low, false, 1).cookMs;
    const quarterCook = computeDuration(400 * portionOf(quarter), STOVE_SPEED.low, false, 1).cookMs;
    check('a quartered ingredient cooks in ~40% of the time (m^2/3, not m)',
      Math.abs(quarterCook - wholeCook * Math.pow(0.25, 2 / 3)) < 5, { wholeCook, quarterCook });
    check('...which is MORE than a linear quarter would suggest',
      quarterCook > wholeCook / 4, { wholeCook, quarterCook });
    check('...but still the tactical point of the knife', quarterCook < wholeCook);

    // Recipes count PORTIONS, not rows. Every count in the catalog was authored
    // as "how many of this ingredient", so a whole one still contributes exactly
    // 1 and no template needed rewriting — but half of one now contributes half.
    const pRow = (prof, portion) => ({ tags: { food_profile: prof }, custom_data: portion ? { portion } : {} });
    const pSig = rows => signature(rows, profileNameFor);
    check('a whole ingredient contributes exactly 1, as it always did',
      pSig([pRow('soft_vegetable')]).soft_vegetable === 1);
    check('half contributes exactly half', pSig([pRow('soft_vegetable', 0.5)]).soft_vegetable === 0.5);
    check('two halves are exactly one — no floating-point drift',
      pSig([pRow('soft_vegetable', 0.5), pRow('soft_vegetable', 0.5)]).soft_vegetable === 1);
    check('four quarters likewise',
      pSig([...Array(4)].map(() => pRow('soft_vegetable', 0.25))).soft_vegetable === 1);
    check('an eighth is the smallest piece and still exact',
      pSig([...Array(8)].map(() => pRow('soft_vegetable', 0.125))).soft_vegetable === 1);

    const soupWhole = matchDish(pSig([pRow('liquid'), pRow('soft_vegetable')]), 'pot', new Set());
    const soupHalf = matchDish(pSig([pRow('liquid'), pRow('soft_vegetable', 0.5)]), 'pot', new Set());
    const soupTwoHalves = matchDish(pSig([pRow('liquid'), pRow('soft_vegetable', 0.5), pRow('soft_vegetable', 0.5)]), 'pot', new Set());
    check('a whole vegetable fills a one-vegetable recipe', soupWhole?.key === 'soup', soupWhole?.key);
    check('HALF of one no longer does — that hole is closed', soupHalf === null, soupHalf?.key);
    check('but two halves do, because two halves are one', soupTwoHalves?.key === 'soup', soupTwoHalves?.key);

    check('the difficulty tiebreak stays far below the smallest real difference',
      Math.max(...Object.values(DISHES).map(t => (t.difficulty || 0) / 1000)) < MIN_PORTION,
      { tiebreak: Math.max(...Object.values(DISHES).map(t => (t.difficulty || 0) / 1000)), MIN_PORTION });

    // ── Fond: the one thing a vessel remembers between cooks ─────────────────
    const seared = { vesselKind: 'pan', profiles: ['dense_meat', 'fat_or_oil'], band: 'excellent', hadLiquid: false };
    check('a good sear in a pan leaves fond', leavesFond(seared));
    check('a ruined sear leaves carbon, not fond', !leavesFond({ ...seared, band: 'poor' }));
    check('boiling a broth leaves nothing behind', !leavesFond({ ...seared, hadLiquid: true }));
    check('a pot leaves nothing behind either', !leavesFond({ ...seared, vesselKind: 'pot' }));
    check('a bowl certainly does not', !leavesFond({ ...seared, vesselKind: 'bowl' }));
    check('vegetables alone leave nothing', !leavesFond({ ...seared, profiles: ['soft_vegetable'] }));

    const fresh = makeFond('dense_meat', 'excellent', 1_000_000);
    check('fresh fond reads as fresh', fondState(fresh, 1_000_000 + 1000) === 'fresh');
    check('left too long it dries to residue', fondState(fresh, 1_000_000 + FOND_LIFE_MS + 1) === 'residue');
    check('no fond at all is neither', fondState(null) === 'none');

    // Fresh fond is never neutral: dry it scorches, wet it lifts on its own.
    check('cooking dry on top of fresh fond scorches it',
      fondModifier(fresh, { deglazed: false, now: 1_000_001 }) === FOND_NEGLECT_PENALTY);
    check('scorching costs less than dried-on residue',
      FOND_NEGLECT_PENALTY > FOND_RESIDUE_PENALTY, { FOND_NEGLECT_PENALTY, FOND_RESIDUE_PENALTY });
    check('liquid lifts fond whether or not you meant it to',
      fondModifier(fresh, { deglazed: false, hadLiquid: true, now: 1_000_001 }) > 0);
    check('...but scraping it yourself is always worth more',
      fondModifier(fresh, { deglazed: true, now: 1_000_001 })
        > fondModifier(fresh, { deglazed: false, hadLiquid: true, now: 1_000_001 }));
    // The dish that exists FOR fond must not be the one dish that rejects it.
    check('a meat sear belongs in a pan sauce, which contains no meat',
      fondBelongs(makeFond('dense_meat', 'excellent', 1), DISHES.pan_sauce));
    check('...and lifting it there pays rather than penalises',
      fondModifier(makeFond('dense_meat', 'excellent', 1_000_000),
        { deglazed: true, template: DISHES.pan_sauce, now: 1_000_001 }) > 0);
    check('a fruit fond is still wrong in a pan sauce',
      !fondBelongs(makeFond('fruit', 'excellent', 1), DISHES.pan_sauce));
    check('a mismatched fond lifts into the dish passively too, and still ruins it',
      fondModifier(makeFond('dense_meat', 'excellent', 1_000_000),
        { deglazed: false, hadLiquid: true, template: DISHES.compote, now: 1_000_001 }) < 0);
    check("LIFTING it's worth a real bonus", fondModifier(fresh, { deglazed: true, now: 1_000_001 }) === FOND_BONUS);
    check('dried residue is an active penalty on the next cook',
      fondModifier(fresh, { deglazed: true, now: 1_000_000 + FOND_LIFE_MS + 1 }) === FOND_RESIDUE_PENALTY);
    check('a clean pan is neutral', fondModifier(null) === 0);
    check('deglazing beats every seasoning you could add instead',
      FOND_BONUS > MODIFIER_BONUS_CAP, { FOND_BONUS, MODIFIER_BONUS_CAP });
    check('examine describes the pan differently fresh vs dried',
      fondText(fresh, 1_000_001) !== fondText(fresh, 1_000_000 + FOND_LIFE_MS + 1) && !!fondText(fresh, 1_000_001));
    check('a clean pan says nothing about its bottom', fondText(null) === null);

    const sauce = matchDish(signature([
      { tags: { food_profile: 'liquid' } }, { tags: { food_profile: 'aromatic' } },
    ], profileNameFor), 'pan', new Set());
    check('liquid and seasoning in a pan is a pan sauce', sauce?.key === 'pan_sauce', sauce?.key);

    // ── Prep: whole ingredients need a knife ─────────────────────────────────
    const prepProfiles = Object.keys(PROFILES).filter(profileNeedsPrep);
    check('the profiles that arrive whole need prep', prepProfiles.length >= 4, prepProfiles);
    check('a cut of meat needs cutting down', profileNeedsPrep('dense_meat'));
    check('a root needs cutting down', profileNeedsPrep('starchy_vegetable'));
    check('liquids, batter and preserved cuts do not',
      !profileNeedsPrep('liquid') && !profileNeedsPrep('batter') && !profileNeedsPrep('preserved'),
      ['liquid', 'batter', 'preserved'].filter(profileNeedsPrep));
    check("seasoning never needs a knife — it's already dust or oil",
      Object.keys(PROFILES).filter(p => PROFILES[p].modifier).every(p => !profileNeedsPrep(p)));
    check('needsPrep reads off the item, not just the profile name',
      needsPrep({ tags: { food_profile: 'soft_vegetable' } }) && !needsPrep({ tags: { food_profile: 'liquid' } }));

    // Backfill sanity: how much of the catalog this actually touches.
    const touched = Object.entries(DISHES).filter(([, t]) => Object.keys(t.needs).some(profileNeedsPrep));
    check(`prep applies to most of the catalog (${touched.length}/${Object.keys(DISHES).length} dishes)`,
      touched.length >= Object.keys(DISHES).length / 2, touched.length);
    const noPrep = Object.entries(DISHES).filter(([, t]) => !Object.keys(t.needs).some(profileNeedsPrep)).map(([k]) => k);
    check('...but some dishes genuinely need no knife at all', noPrep.length >= 1, noPrep);

    // ── Intermediates: a dish whose output is an INGREDIENT ──────────────────
    const inters = Object.entries(DISHES).filter(([, t]) => t.output);
    check("there's at least one intermediate recipe", inters.length >= 1, inters.map(([k]) => k));
    check('an intermediate names a real item id', inters.every(([, t]) => /^item_/.test(t.output.item)), inters.map(([, t]) => t.output.item));
    const mbRows = [
      { id: 'item_sausage', name: 'sausage', tags: { food_profile: 'dense_meat' }, custom_data: {} },
      { id: 'item_battery_egg', name: 'egg', tags: { food_profile: 'egg' }, custom_data: {} },
      { id: 'item_cracker_meal', name: 'crumb', tags: { food_profile: 'batter' }, custom_data: {} },
    ];
    const mb = matchDish(signature(mbRows, profileNameFor), 'bowl', new Set(mbRows.map(r => r.id)));
    check('meat + egg + crumb in a bowl makes meatballs', mb?.key === 'meatballs', mb?.key);
    check('...and its output is an ingredient, not a meal', mb?.template.output?.item === 'item_meatballs');

    const sugoRows = [
      { id: 'item_meatballs', name: 'meatballs', tags: { food_profile: 'dense_meat' }, custom_data: {} },
      { id: 'item_tinned_tomatoes', name: 'tomatoes', tags: { food_profile: 'liquid' }, custom_data: {} },
    ];
    const sugo = matchDish(signature(sugoRows, profileNameFor), 'pot', new Set(sugoRows.map(r => r.id)));
    check('meatballs simmered in tomato is its own dish', sugo?.key === 'meatball_sugo', sugo?.key);
    check('the same pot with ordinary mince is NOT that dish',
      matchDish(signature(sugoRows, profileNameFor), 'pot', new Set(['item_tinned_tomatoes']))?.key !== 'meatball_sugo');

    // Two named dishes can both fit one pot; the tiebreak must not be catalog order.
    const bothKeys = new Set(['item_meatballs', 'item_ramen_noodles']);
    const bothRows = [
      { tags: { food_profile: 'dense_meat' } }, { tags: { food_profile: 'starchy_vegetable' } }, { tags: { food_profile: 'liquid' } },
    ];
    const contested = matchDish(signature(bothRows, profileNameFor), 'pot', bothKeys);
    check('two named dishes in one pot resolve to the harder one, deterministically',
      contested?.key === 'meatball_sugo', { got: contested?.key, sugo: DISHES.meatball_sugo.difficulty, ramen: DISHES.ramen.difficulty });
    check('the difficulty tiebreak can never overturn real specificity',
      Math.max(...Object.values(DISHES).map(t => (t.difficulty || 0) / 100)) < 1);

    // ── Two-appliance cooking: smoke, then finish over coals ─────────────────
    // A smoked cut is edible as it stands AND can still go back on heat. Every
    // other cooked thing is done; `finishable` is the single exception, and it
    // must be cleared by the finish or a cut could be re-cooked for a free band.
    // NOTE the food_noun: the smoker stamps `smoked ${noun}` onto the instance
    // (endSession in cook.js), so a smoked slab's noun is "smoked pork", not
    // "pork". These fixtures used to say "pork", which quietly hid the fact that
    // smoked_chop's old `smoked {0} chop` format was printing "smoked smoked
    // pork chop" in the actual game.
    const smokedCut = { name: 'smoked pork', tags: { food_profile: 'dense_meat' },
      custom_data: { smoked: 'preserved', food_noun: 'smoked pork', cooked: true, finishable: true } };
    check('a cured cut reads as preserved', profileNameFor(smokedCut) === 'preserved');
    check('a cured cut can go back on the heat',
      !cookTest.prepareCook({ ...smokedCut, weight: 700, quantity: 1 }, { profileName: 'preserved', speed: 1, id: 'x', name: 'grill' }, { tier: 'ambient', delivering: true, ambientTier: 'ambient' }).error);
    check('a browned COMPONENT stays finishable — browning is a step, not the meal',
      !cookTest.prepareCook({ name: 'meatballs', tags: { food_profile: 'dense_meat' }, custom_data: { cooked: true, finishable: true, crafted_quality: 'good' }, weight: 340, quantity: 1 },
        { profileName: 'dense_meat', speed: 1, id: 'x', name: 'pot' }, { tier: 'ambient', delivering: true, ambientTier: 'ambient' }).error);
    check('an ordinary cooked meal cannot',
      /already cooked/.test(cookTest.prepareCook({ name: 'stew', tags: { food_profile: 'liquid' }, custom_data: { cooked: true }, weight: 500, quantity: 1 },
        { profileName: 'liquid', speed: 1, id: 'x', name: 'stove' }, { tier: 'ambient', delivering: true, ambientTier: 'ambient' }).error || ''));

    const chopRows = [
      { id: 'item_pink_slab', name: 'smoked pork', tags: { food_profile: 'dense_meat' }, custom_data: { smoked: 'preserved', food_noun: 'smoked pork' } },
      { id: 'item_bbq_sauce', name: 'sauce', tags: { food_profile: 'fruit' }, custom_data: {} },
    ];
    const chop = matchDish(signature(chopRows, profileNameFor), 'pan', new Set(chopRows.map(r => r.id)));
    check('smoked meat finished with the sauce is its own dish', chop?.key === 'smoked_chop', chop?.key);
    check('...and it names the cut it came from',
      dishName(chop.template, chopRows, profileNameFor) === 'smoked pork chop', dishName(chop.template, chopRows, profileNameFor));
    check("the same cut WITHOUT the sauce isn't that dish",
      matchDish(signature(chopRows, profileNameFor), 'pan', new Set(['item_pink_slab']))?.key !== 'smoked_chop');
    // The overnight cousin of the chop: same smoker, no sauce required, and it
    // takes TWO units of shoulder because a shoulder is not a portion.
    const shoulderRows = [
      { id: 'item_pork_shoulder', name: 'smoked pork', tags: { food_profile: 'dense_meat' }, custom_data: { smoked: 'preserved', food_noun: 'smoked pork' }, weight: 2600, quantity: 1 },
      { id: 'item_pork_shoulder', name: 'smoked pork', tags: { food_profile: 'dense_meat' }, custom_data: { smoked: 'preserved', food_noun: 'smoked pork' }, weight: 2600, quantity: 1 },
    ];
    const pulled = matchDish(signature(shoulderRows, profileNameFor), 'tray', new Set(['item_pork_shoulder']));
    check('two smoked shoulders in a tray are pulled shoulder', pulled?.key === 'pulled_shoulder', pulled?.key);
    check('...and it names the cut', dishName(pulled.template, shoulderRows, profileNameFor) === 'pulled smoked pork',
      pulled && dishName(pulled.template, shoulderRows, profileNameFor));

    // The rub is an intermediate, so its ceiling caps whatever it seasons — it
    // has to be able to reach masterful or it silently caps the chop.
    check('the rub can reach masterful, so it never caps the dish it seasons',
      DISHES.spice_rub.ceiling === 'masterful');
    check('the rub produces the same item the grocery sells',
      DISHES.spice_rub.output?.item === 'item_bbq_rub');

    check("an unsmoked slab can't be a smoked chop, whatever sauce you put on it", (() => {
      const raw = [{ id: 'item_pink_slab', tags: { food_profile: 'dense_meat' }, custom_data: {} }, chopRows[1]];
      return matchDish(signature(raw, profileNameFor), 'pan', new Set(raw.map(r => r.id)))?.key !== 'smoked_chop';
    })());

    // ── Dips: worked in a bowl, never heated ─────────────────────────────────
    check('bowl is a vessel kind', VESSEL_KINDS.includes('bowl'));
    const bowlDishes = Object.entries(DISHES).filter(([, t]) => t.vessel === 'bowl');
    check('there are dip recipes', bowlDishes.length >= 3, bowlDishes.map(([k]) => k));
    check('at least one dip is buildable entirely from ingredients that are good RAW',
      bowlDishes.some(([, t]) => Object.keys(t.needs).every(p => PROFILES[p].modifier || bandIndex(PROFILES[p].targets.raw) >= bandIndex('good'))),
      bowlDishes.map(([k]) => k));
    const dipRows = [
      { id: 'item_tomato', name: 'tomato', tags: { food_profile: 'soft_vegetable', food_noun: 'tomato' }, custom_data: {} },
      { id: 'item_onion', name: 'onion', tags: { food_profile: 'soft_vegetable', food_noun: 'onion' }, custom_data: {} },
      { id: 'item_cooking_oil', name: 'oil', tags: { food_profile: 'fat_or_oil' }, custom_data: {} },
    ];
    const dipHit = matchDish(signature(dipRows, profileNameFor), 'bowl', new Set(dipRows.map(r => r.id)));
    check('two soft vegetables and oil in a bowl is a dip', dipHit?.key === 'mash_dip', dipHit?.key);
    check('the same things in a pan are a different dish entirely',
      matchDish(signature(dipRows, profileNameFor), 'pan', new Set())?.key !== dipHit?.key);

    // ── Doneness targets ─────────────────────────────────────────────────────
    check('dense meat offers a choice of doneness', (donenessLevels(PROFILES.dense_meat) || []).length >= 3, donenessLevels(PROFILES.dense_meat)?.map(l => l.name));
    check("a potato does not — it's cooked or it's not", donenessLevels(PROFILES.starchy_vegetable) === null);
    check('a profile with no doneness block sits at 1.0, exactly as before', donenessAt(PROFILES.starchy_vegetable, 'anything') === 1);

    const mk = target => ({ startedAt: 0, thawMs: 0, cookMs: 60000, doneAt: 60000, profile: 'dense_meat',
      heatTier: 'low', vessel: { d: 0.9, r: 0.8 }, acts: [{ at: 30000 }], target });
    const rareTl = timeline(mk('rare'), PROFILES.dense_meat);
    const medTl = timeline(mk('medium'), PROFILES.dense_meat);
    const wellTl = timeline(mk('well done'), PROFILES.dense_meat);
    check('a rarer target opens its window earlier', rareTl.doneAt < medTl.doneAt, { rare: rareTl.doneAt, medium: medTl.doneAt });
    check('a more-done target opens it later', wellTl.doneAt > medTl.doneAt, { well: wellTl.doneAt, medium: medTl.doneAt });
    check('the default target reproduces the old timeline exactly', medTl.doneAt === 60000, medTl.doneAt);
    check('an unknown target falls back to the default rather than breaking', timeline(mk('nonsense'), PROFILES.dense_meat).doneAt === medTl.doneAt);

    // Each target is genuinely reachable: pulled in ITS window, it reads as peak.
    for (const level of donenessLevels(PROFILES.dense_meat)) {
      const s = mk(level.name), tl2 = timeline(s, PROFILES.dense_meat);
      check(`"${level.name}" is a real, hittable window`, endStateAt(s, PROFILES.dense_meat, tl2.doneAt + tl2.peakMs / 2) === 'peak');
    }

    // What you get is what you MADE, not what you asked for.
    check('pulling early records the rarer level you actually produced',
      achievedDoneness(PROFILES.dense_meat, 0.55) === 'blue', achievedDoneness(PROFILES.dense_meat, 0.55));
    check('leaving it on records the more-done level', achievedDoneness(PROFILES.dense_meat, 1.35) === 'well done');
    check('a fraction between two levels snaps to the nearer one',
      achievedDoneness(PROFILES.dense_meat, 0.78) === 'rare', achievedDoneness(PROFILES.dense_meat, 0.78));

    // Risk is what makes the choice a trade rather than a preference.
    const risky = donenessLevels(PROFILES.dense_meat).filter(l => l.risk > 0).map(l => l.name);
    check('the rare end carries a food-poisoning risk', risky.length >= 1 && risky.includes('blue'), risky);
    check('the default doneness carries no risk', !donenessLevel(PROFILES.dense_meat, 'medium').risk);
    check('rarer is riskier', donenessLevel(PROFILES.dense_meat, 'blue').risk > donenessLevel(PROFILES.dense_meat, 'rare').risk);
    check('the engine eat-path can read the risk off a stamped item',
      cookTest2.donenessRisk({ doneness: 'blue' }) > 0 && cookTest2.donenessRisk({ doneness: 'medium' }) === 0 && cookTest2.donenessRisk({}) === 0,
      [cookTest2.donenessRisk({ doneness: 'blue' }), cookTest2.donenessRisk({ doneness: 'medium' })]);

    const badDefault = validateProfiles({ bad: { ...PROFILES.dense_meat,
      doneness: { default: 'rare', levels: [{ name: 'rare', at: 0.75 }, { name: 'medium', at: 1 }] } } });
    check("the validator rejects a default that isn't at 1.0", !badDefault.ok && /must sit at 1.0/.test(badDefault.errors.join(' ')), badDefault.errors);
    const badOrder = validateProfiles({ bad: { ...PROFILES.dense_meat,
      doneness: { default: 'medium', levels: [{ name: 'medium', at: 1 }, { name: 'rare', at: 0.75 }] } } });
    check("the validator rejects levels that aren't ordered rarest-first", !badOrder.ok, badOrder.errors);

    // ── Temperature curves ───────────────────────────────────────────────────
    const curveSession = (heats, tier) => ({
      startedAt: 0, thawMs: 0, cookMs: 60000, doneAt: 60000, profile: 'dense_meat',
      heatTier: tier, vessel: { d: 0.9, r: 0.8 }, acts: [{ at: 30000 }], heats,
    });
    const heatOf = (heats, tier) => {
      const s = curveSession(heats, tier);
      const t = timeline(s, PROFILES.dense_meat);
      return evaluate(s, PROFILES.dense_meat, t.doneAt + t.peakMs / 2, 20).parts.heat;
    };
    check('dense meat declares a heat curve', Array.isArray(PROFILES.dense_meat.heatCurve), PROFILES.dense_meat.heatCurve);
    const followed = heatOf([{ at: 0, tier: 'high' }, { at: 15000, tier: 'low' }], 'high');
    const flatLow = heatOf(null, 'low');
    const flatMid = heatOf(null, 'mid');
    const lateDrop = heatOf([{ at: 0, tier: 'high' }, { at: 50000, tier: 'low' }], 'high');
    check('searing then dropping the heat beats any flat setting', followed > flatLow && followed > flatMid, { followed, flatLow, flatMid });
    check('holding the curve\'s dominant tier is decent, not optimal', flatLow > 0 && flatLow < followed, { flatLow, followed });
    check('a tier the curve never wants scores worst', flatMid < flatLow && flatMid < lateDrop, { flatMid, flatLow, lateDrop });
    check('dropping the heat far too late is worse than dropping it on time', lateDrop < followed, { lateDrop, followed });
    check('a session with no burner log still scores off its starting tier', Number.isFinite(flatLow), flatLow);
    check('heatSpans covers the whole cook segment exactly once',
      heatSpans(curveSession([{ at: 0, tier: 'high' }, { at: 15000, tier: 'low' }], 'high'))
        .reduce((a, s) => a + (s.to - s.from), 0) === 60000);

    const badCurve = validateProfiles({
      bad: { ...PROFILES.dense_meat, heatTolerance: 'high', heatCurve: [{ until: 0.25, tier: 'high' }, { until: 1, tier: 'low' }] },
    });
    check('the validator rejects a heatTolerance that disagrees with its curve', !badCurve.ok && /must agree/.test(badCurve.errors.join(' ')), badCurve.errors);
    const gapCurve = validateProfiles({ bad: { ...PROFILES.dense_meat, heatCurve: [{ until: 0.5, tier: 'low' }] } });
    check("the validator rejects a curve that doesn't cover the whole cook", !gapCurve.ok, gapCurve.errors);

    // ── Seasoning: under is bland, over is a mistake ──────────────────────────
    check('a dish with no required modifiers wants one', seasoningIdeal(DISHES.roast) === 1, seasoningIdeal(DISHES.roast));
    check('a dish that REQUIRES two aromatics wants two — following the recipe is never over-seasoning',
      seasoningIdeal(DISHES.curry) === 2, seasoningIdeal(DISHES.curry));
    check('no seasoning is a missed bonus, not a penalty', seasoningBonus(DISHES.roast, 0) === 0);
    check('seasoning to the ideal pays', seasoningBonus(DISHES.roast, 1) > 0);
    check('over-seasoning actively costs', seasoningBonus(DISHES.roast, 2) < 0, seasoningBonus(DISHES.roast, 2));
    check('over-seasoning costs more the further past the ideal you go',
      seasoningBonus(DISHES.roast, 3) < seasoningBonus(DISHES.roast, 2));
    check('a curry seasoned to its recipe is rewarded, not punished', seasoningBonus(DISHES.curry, 2) > 0, seasoningBonus(DISHES.curry, 2));

    // ── Dishes: catalog, matcher, naming, composition ────────────────────────
    const dv = validateDishes();
    check('the dish catalog validates', dv.ok, dv.errors);

    const P = r => r.tags.food_profile;
    const ing = (name, profile, noun) => ({ name, tags: { food_profile: profile, ...(noun ? { food_noun: noun } : {}) } });
    const stewRows = [ing('raw meat', 'dense_meat', 'meat'), ing('potato', 'starchy_vegetable', 'potato'), ing('soup base', 'liquid', 'broth')];
    const stewSig = signature(stewRows, P);

    check('signature counts profiles, not items', stewSig.dense_meat === 1 && stewSig.liquid === 1, stewSig);

    const stew = matchDish(stewSig, 'pot');
    check('meat + starch + liquid in a pot is a stew', stew?.key === 'stew', stew?.key);
    check('the same contents in a pan match nothing', matchDish(stewSig, 'pan') === null, matchDish(stewSig, 'pan'));
    check('the same contents with no vessel match nothing', matchDish(stewSig, null) === null, matchDish(stewSig, null));

    // A stray profile the template neither needs nor allows must break the match.
    const strayed = signature([...stewRows, ing('batter', 'batter')], P);
    check('a stray profile drops the match to slop', matchDish(strayed, 'pot') === null, matchDish(strayed, 'pot'));

    // Profile-keyed, not item-keyed: swap the meat, keep the dish.
    const fishRows = [ing('fresh catch', 'dense_meat', 'fish'), ing('potato', 'starchy_vegetable', 'potato'), ing('soup base', 'liquid', 'broth')];
    const fishHit = matchDish(signature(fishRows, P), 'pot');
    check('swapping the meat for fish still matches, with no catalog edit', fishHit?.key === 'stew', fishHit?.key);
    check('the dish name derives from what actually went in',
      dishName(fishHit.template, fishRows, P) === 'fish and potato stew', dishName(fishHit.template, fishRows, P));
    check('food_noun beats the item name', nounFor(ing('coldwater sturgeon', 'dense_meat', 'sturgeon')) === 'sturgeon');

    // Butchered meat carries the creature it came off (plugins/butchering).
    const offDog = { name: 'raw meat', tags: { food_profile: 'dense_meat', food_noun: 'meat' }, custom_data: { name: 'feral dog meat', food_noun: 'feral dog' } };
    check('a per-instance food_noun beats the class one', nounFor(offDog) === 'feral dog', nounFor(offDog));
    const dogRows = [offDog, ing('potato', 'starchy_vegetable', 'potato'), ing('soup base', 'liquid', 'broth')];
    const dogHit = matchDish(signature(dogRows, P), 'pot');
    check('butchered meat names the dish after the creature',
      dishName(dogHit.template, dogRows, P) === 'feral dog and potato stew', dishName(dogHit.template, dogRows, P));
    check('stamped meat is instanced, so two species never stack-merge',
      rowIsInstanced({ custom_data: { name: 'feral dog meat', food_noun: 'feral dog' } }) === true);
    check('unstamped raw meat still stacks', rowIsInstanced({ custom_data: {} }) === false);
    check('a missing food_noun falls back to the name, minus state words',
      nounFor({ name: 'raw meat', tags: {} }) === 'meat', nounFor({ name: 'raw meat', tags: {} }));

    // Specificity: the template demanding more wins, deterministically.
    const curryRows = [...stewRows, ing('onion', 'soft_vegetable', 'onion'), ing('chilli', 'aromatic'), ing('salt', 'aromatic')];
    const curry = matchDish(signature(curryRows, P), 'pot');
    check('a meat-and-spice pot resolves to the more specific meat curry', curry?.key === 'meat_curry', curry?.key);

    // ── The toastie: bread, cheese, fat, one turn ────────────────────────────
    const toastieRows = [ing('flatbread', 'bread', 'bread'), ing('vat cheese', 'dairy', 'vat cheese'), ing('butter', 'fat_or_oil')];
    const toastie = matchDish(signature(toastieRows, P), 'pan');
    check('bread + cheese + fat in a pan is a toastie', toastie?.key === 'toastie', toastie?.key);
    check("...and it's named off the cheese that went in it",
      /vat cheese/.test(dishName(DISHES.toastie, toastieRows, P)), dishName(DISHES.toastie, toastieRows, P));
    // Bread and fat alone used to fall through to a root-vegetable glaze; the
    // cheese is what makes it a toastie, so removing it must NOT still match.
    check("without the cheese it isn't a toastie",
      matchDish(signature([toastieRows[0], toastieRows[2]], P), 'pan')?.key !== 'toastie');
    check('cheese is fine raw but best melted',
      bandIndex(PROFILES.dairy.targets.raw) >= bandIndex('good')
        && bandIndex(PROFILES.dairy.targets.peak) > bandIndex(PROFILES.dairy.targets.raw));
    check("cheese splits fast once it's past — the shortest grace of any real profile",
      PROFILES.dairy.burnFraction < PROFILES.dense_meat.burnFraction
        && PROFILES.dairy.burnFraction < PROFILES.batter.burnFraction);
    check('melting cheese is something you let happen, not something you poke',
      PROFILES.dairy.turns === 0);

    // ── Sandwiches: the one open-ended dish ──────────────────────────────────
    // Bread never makes slop. Anything sensible between two slices is a real
    // sandwich named off what went in it, with no recipe existing for it.
    const breadRow = ing('flatbread', 'bread', 'bread');
    const sandwich = rows => matchDish(signature(rows, P), 'bread');
    const ratRows = [breadRow, ing('rat haunch', 'dense_meat', 'rat meat'), ing('onion', 'soft_vegetable', 'onion')];
    check('a combination with no recipe still matches no named dish', sandwich(ratRows) === null, sandwich(ratRows)?.key);
    check('...and is named off its contents rather than called a mess',
      dishName(GENERIC_SANDWICH, ratRows, P) === 'rat meat and onion sandwich', dishName(GENERIC_SANDWICH, ratRows, P));
    check('the generic sandwich carries NO key, so making one teaches nothing',
      !Object.entries(DISHES).some(([, t]) => t === GENERIC_SANDWICH));
    check('a sandwich is never slop — it beats the unknown-dish ceiling',
      bandIndex(GENERIC_SANDWICH.ceiling) > bandIndex(UNKNOWN_DISH.ceiling));

    // A recipe, where one exists, overrides the generic name.
    const cheeseRows = [breadRow, ing('vat cheese', 'dairy', 'vat cheese')];
    const cheeseHit = sandwich(cheeseRows);
    check('bread + cheese IS a named recipe and overrides the generic', cheeseHit?.key === 'cheese_sandwich', cheeseHit?.key);
    check('...and the recipe name wins over "<contents> sandwich"',
      dishName(cheeseHit.template, cheeseRows, P) === 'vat cheese sandwich', dishName(cheeseHit.template, cheeseRows, P));
    const clubRows = [breadRow, ing('rat haunch', 'dense_meat', 'rat meat'), ing('onion', 'soft_vegetable'), ing('cured strip', 'preserved')];
    check('meat, veg and a cured strip on bread is a club', sandwich(clubRows)?.key === 'club', sandwich(clubRows)?.key);

    // Bread is its own profile now, and the reason is the raw target.
    check("bread arrives baked, so it's GOOD raw — a cold sandwich isn't punished for it",
      bandIndex(PROFILES.bread.targets.raw) >= bandIndex('good'));
    check('bread is no longer a root vegetable',
      !matchDish(signature([breadRow, ing('broth', 'liquid'), ing('meat', 'dense_meat')], P), 'pot'));

    // Butter: an ingredient you apply rather than add.
    // Butter rides the same secondary channel milk does — it satisfies a fat
    // requirement without being a separate ingredient in the pan.
    check('buttered bread carries its own fat',
      (signature([{ ...breadRow, custom_data: { buttered: true } }], P)[ALSO]?.fat_or_oil || 0) === 1);
    check('...so buttered bread and cheese in a pan is a toastie without a second pat of butter',
      matchDish(signature([{ ...breadRow, custom_data: { buttered: true } }, ing('vat cheese', 'dairy')], P), 'pan')?.key === 'toastie');
    check('butter pays a bonus on top of counting as the fat', prepBonus({ buttered: true }) > 0);

    // ── Secondary identities: liquid AND dairy, not liquid OR dairy ──────────
    const milk = { name: 'milk', weight: 400, quantity: 1, tags: { food_profile: 'liquid', food_also: 'dairy' } };
    const milkSig = signature([milk], P);
    check('milk is a liquid in its own right', (milkSig.liquid || 0) === 1, milkSig.liquid);
    check('...and counts as a dairy too', (milkSig[ALSO]?.dairy || 0) === 1, milkSig[ALSO]);
    check('a secondary is counted at the PRIMARY unit, not recounted on its own weight',
      milkSig[ALSO].dairy === milkSig.liquid);
    check('the secondary never appears as a real profile in the signature',
      !Object.keys(milkSig).includes('dairy'), Object.keys(milkSig));

    // The asymmetry that makes this safe: an "also" can help a match, never break one.
    const porridgeRows = [ing('grain', 'starchy_vegetable'), milk];
    check('milk still matches a recipe that wants liquid and has never heard of dairy',
      matchDish(signature(porridgeRows, P), 'pot')?.key === 'porridge',
      matchDish(signature(porridgeRows, P), 'pot')?.key);
    // A `needs: { dairy }` is satisfied by something that merely counts as dairy.
    const MILKY = { noun: 'test', vessel: null, needs: { dairy: 1 }, optional: ['liquid'], nameSlots: [] };
    check('a dairy requirement is satisfied by something that only counts as dairy',
      matchScore(signature([milk], P), MILKY) >= 0, matchScore(signature([milk], P), MILKY));
    // ...but milk is still a LIQUID, and bread does not take liquids. Pouring
    // milk on bread is not a cheese sandwich, and the allowed check says so.
    check('being "also dairy" doesn\'t make milk a sandwich filling',
      matchDish(signature([breadRow, milk], P), 'bread') === null,
      matchDish(signature([breadRow, milk], P), 'bread')?.key);
    check('adding a secondary can never disqualify what already matched',
      matchScore(signature([ing('grain', 'starchy_vegetable'), milk], P), DISHES.porridge)
        === matchScore(signature([ing('grain', 'starchy_vegetable'), ing('broth', 'liquid')], P), DISHES.porridge));

    // ── Named dishes: the only templates that name an ingredient ─────────────
    // A BUDGET, not a limit that happens to be true. Every named dish is one
    // combination a player can no longer invent for themselves, so the cap is
    // meant to be argued with before it's raised. Raised 5 -> 6 on 2026-07-27
    // for penne_alla_gin, which earns its anchor: the gin IS the dish's name,
    // and without the key items it would resolve to generic pasta in sauce.
    // 6 of ~47 templates is still a small minority. Think hard before 7.
    const keyed = Object.entries(DISHES).filter(([, t]) => t.keyItems?.length);
    check('named dishes are a small minority of the catalog', keyed.length > 0 && keyed.length <= 6, keyed.map(([k]) => k));

    const named = (ids, kind, profiles) => {
      const rows = ids.map((id, i) => ({ id, name: id, tags: { food_profile: profiles[i] } }));
      return matchDish(signature(rows, P), kind, new Set(ids));
    };
    const jerk = named(['item_battery_chicken', 'item_jerk_paste'], 'tray', ['dense_meat', 'aromatic']);
    check('meat + jerk paste on a tray is jerk chicken', jerk?.key === 'jerk_chicken', jerk?.key);
    const noPaste = named(['item_battery_chicken', 'item_black_pepper'], 'tray', ['dense_meat', 'aromatic']);
    check('the same thing WITHOUT the key item falls back to the generic dish', noPaste?.key === 'baked_whole', noPaste?.key);

    const ram = named(['item_ramen_noodles', 'item_bone_broth'], 'pot', ['dry_starch', 'liquid']);
    check('ramen noodles in stock is ramen', ram?.key === 'ramen', ram?.key);
    // Pasta is not a root vegetable. `dry_starch` exists because penne, rice,
    // noodles and pulses were all riding `starchy_vegetable`, whose `needsPrep`
    // means "arrives whole, cut it down first" — so the game was asking players
    // to chop dry pasta with a knife, and the recipe card printed "250g of
    // starchy vegetable, cut down" for what is plainly a box of penne.
    // A card must say "penne", not "dry starch". The class name is what makes
    // the catalog extensible and it is not what a person calls dinner — so a
    // keyed dish lends its key item's noun to the class, but ONLY where that
    // class is unambiguously the key item. penne_alla_gin keys on gin, whose
    // profile is `liquid`, and the recipe wants 2–3 liquids (tomato, gin,
    // cream): naming that class "gin" produced "800g–1.2kg of gin", which is
    // not a recipe, it is a warning.
    {
      const info = id => ({ item_penne: { name: 'box of penne', tags: { food_profile: 'dry_starch', food_noun: 'penne' } },
                            item_gin:   { name: 'bottle of gin', tags: { food_profile: 'liquid', food_noun: 'gin' } } })[id];
      const t = DISHES.penne_alla_gin;
      check('card: a single-unit key class is named after its key item',
        keyNounFor(t, 'dry_starch', info) === 'penne', keyNounFor(t, 'dry_starch', info));
      check('card: a COMPOSITE class keeps its class name',
        keyNounFor(t, 'liquid', info) === null, keyNounFor(t, 'liquid', info));
      check('card: an explicit `nouns` override wins over the auto rule',
        keyNounFor(DISHES.ramen, 'dry_starch', info) === 'ramen noodles',
        keyNounFor(DISHES.ramen, 'dry_starch', info));
      check('card: an unkeyed dish never borrows a noun',
        keyNounFor(DISHES.stew, 'dense_meat', info) === null);
    }

    // PLATING IS REWARDED, NEVER REQUIRED. `plate` is the verb that ENDS a
    // cook, so gating it behind an object would strand a player with no
    // dishware over a burning pan. These pin the promise: no plate is a zero,
    // never a refusal, and a platter only pays on a dish big enough to arrange.
    {
      const { platingBonus, PLATE_BONUS, PLATTER_BONUS } = (await import('./index.js'))._plating;
      const none = await platingBonus({ id: '__nobody__', current_zone: null }, 4);
      check('plating: owning no dishware is a zero, not a refusal',
        none && none.bonus === 0, JSON.stringify(none));
      // The fallback CHARACTERISES rather than instructs: a paper plate says
      // something about the cook, where "you should get a plate" would just be
      // the game nagging about a thing they don't own. The distinction is the
      // whole reason the line is allowed to exist at all, so it's pinned.
      check('plating: the fallback says paper plate', /paper plate/i.test(none.note || ''), none.note);
      check('plating: the fallback never tells the player to go and buy one',
        !/should|buy|need a|get a plate|invest/i.test(none.note || ''), none.note);
      check('plating: the improvised line is flagged as such', none.improvised === true);
      check('plating: a platter beats a plate', PLATTER_BONUS > PLATE_BONUS);
      check('plating: a plate is a nudge, not a tier', PLATE_BONUS < 2 * BAND_SCALE);
    }

    check('dry starch is never prepped with a knife', !PROFILES.dry_starch.needsPrep);
    check('dry starch is inedible raw, unlike a root', PROFILES.dry_starch.targets.raw === 'poor');
    check('dry starch is ruined by stirring, not improved', PROFILES.dry_starch.turns === 0);
    check('a portion of dry starch is a portion, not a sack', PROFILES.dry_starch.unitWeight <= 150);

    // Hand-written steps replace the derived method entirely — no profile can
    // express "off the heat BEFORE the gin goes in", and that is the recipe.
    check('card: authored steps beat the derived method',
      methodLines(DISHES.penne_alla_gin).some(l => /off the heat/i.test(l)),
      methodLines(DISHES.penne_alla_gin)[0]);
    check('card: an unauthored dish still derives a method',
      methodLines(DISHES.stew).length > 0 && !DISHES.stew.steps);
    // A note explains what a class is FOR; without it "800g–1.2kg of liquid" is
    // three ingredients hiding inside one number.
    check('card: a note rides along with the weight',
      /cooked down hard/.test(ingredientLine('soft_vegetable', DISHES.penne_alla_gin.needs.soft_vegetable, DISHES.penne_alla_gin)),
      ingredientLine('soft_vegetable', DISHES.penne_alla_gin.needs.soft_vegetable, DISHES.penne_alla_gin));
    // ...and the class gets the dish's own word for it. "One soft vegetable" is
    // true of a cabbage, and this recipe does not mean a cabbage.
    {
      const info = id => ({ item_penne: { name: 'box of penne', tags: { food_profile: 'dry_starch', food_noun: 'penne' } } })[id] || null;
      check('card: a named class says what the dish means by it',
        /of tomato/.test(ingredientLine('soft_vegetable', DISHES.penne_alla_gin.needs.soft_vegetable, DISHES.penne_alla_gin, info)),
        ingredientLine('soft_vegetable', DISHES.penne_alla_gin.needs.soft_vegetable, DISHES.penne_alla_gin, info));
    }

    const rice = named(['item_grey_rice', 'item_bone_broth'], 'pot', ['dry_starch', 'liquid']);
    check("rice in the same stock isn't ramen", rice?.key !== 'ramen', rice?.key);

    // The tie that forced KEY_DISH_FLOOR: a keyed dish must beat a generic one
    // no matter how the counts fall, not merely when it happens to score higher.
    const loaded = named(
      ['item_ramen_noodles', 'item_bone_broth', 'item_offcut', 'item_offcut'], 'pot',
      ['dry_starch', 'liquid', 'dense_meat', 'dense_meat']);
    check('a keyed dish outranks a generic one even when the generic scores higher on classes',
      loaded?.key === 'ramen', loaded?.key);

    const oko = named(['item_pancake_batter', 'item_pale_cabbage', 'item_battery_egg'], 'pan', ['batter', 'soft_vegetable', 'egg']);
    check('batter + cabbage + egg in a pan is okonomiyaki', oko?.key === 'okonomiyaki', oko?.key);
    check('a named dish renders its own name, not "{noun} {parts}"',
      dishName(DISHES.okonomiyaki, [], P) === 'okonomiyaki', dishName(DISHES.okonomiyaki, [], P));
    const jerkRows = [{ name: 'chicken quarter', tags: { food_profile: 'dense_meat', food_noun: 'chicken' } }];
    check('nameFormat fills its slot from what actually went in',
      dishName(DISHES.jerk_chicken, jerkRows, P) === 'jerk chicken', dishName(DISHES.jerk_chicken, jerkRows, P));
    check('nameFormat degrades cleanly when the slot is empty',
      dishName(DISHES.jerk_chicken, [], P) === 'jerk', dishName(DISHES.jerk_chicken, [], P));

    // ── Mac and cheese: a dish anchored by NOUN rather than by key item ──────
    // The only template that names its ingredients without owning a keyItem, so
    // it is the one that proves `requires` can carry an anchor on its own. All
    // three cases below turn on the noun and nothing else: same classes, same
    // counts, same vessel, and the pan either has macaroni and cheese in it or
    // it does not.
    const macRows = ['item_macaroni', 'item_vat_cheese', 'item_ration_cheese', 'item_ration_milk', 'item_battery_egg', 'item_butter_analog'];
    const macProfiles = ['dry_starch', 'dairy', 'dairy', 'liquid', 'egg', 'fat_or_oil'];
    const mac = named(macRows, 'tray', macProfiles);
    check('macaroni, cheese, milk, egg and butter on a tray is mac and cheese', mac?.key === 'mac_and_cheese', mac?.key);
    const macPenne = named(['item_penne', ...macRows.slice(1)], 'tray', macProfiles);
    check("the same tray with penne in it's NOT mac and cheese", macPenne?.key !== 'mac_and_cheese', macPenne?.key);
    const macNoCheese = named(['item_macaroni', 'item_synth_cream', 'item_ration_milk', 'item_water_bottle', 'item_battery_egg', 'item_butter_analog'], 'tray', macProfiles);
    check("dairy that isn't cheese doesn't answer the cheese requirement", macNoCheese?.key !== 'mac_and_cheese', macNoCheese?.key);
    // The method is two vessels and eight steps, and the pasta half of it is the
    // half a player can get wrong: boiled long, it is soft before it ever sees
    // the oven. The card has to say so, or the dish is a list of ingredients.
    check('mac and cheese ships an authored method', (DISHES.mac_and_cheese.steps || []).length >= 6, DISHES.mac_and_cheese.steps?.length);

    const badKey = validateDishes({ bad: { ...DISHES.ramen, keyItems: ['ramen_noodles'] } });
    check("the validator rejects a keyItem that isn't an item id", !badKey.ok, badKey.errors);
    const badFmt = validateDishes({ bad: { ...DISHES.okonomiyaki, nameFormat: '{0} okonomiyaki', nameSlots: [] } });
    check('the validator rejects a nameFormat slot with nothing behind it', !badFmt.ok, badFmt.errors);

    // Exhaustive ambiguity sweep — two dishes tying at top specificity would make
    // the result depend on catalog order, which is the one thing this must never do.
    // Swept both without key items and with all of them present.
    let ties = 0, reachable = new Set();
    const KEY_IDS = keyed.flatMap(([, t]) => t.keyItems);
    const PROFS = Object.keys(PROFILES);
    const sweep = (i, cur, n, out) => {
      if (i === PROFS.length) { if (n > 0) out.push({ ...cur }); return; }
      for (let c = 0; c <= 2 && n + c <= 5; c++) { const nx = { ...cur }; if (c) nx[PROFS[i]] = c; sweep(i + 1, nx, n + c, out); }
    };
    const sigs = []; sweep(0, {}, 0, sigs);
    for (const kind of VESSEL_KINDS) for (const s of sigs) for (const ids of [new Set(), new Set(KEY_IDS)]) {
      const hits = Object.entries(DISHES).filter(([, t]) => !t.vessel || t.vessel === kind).map(([k, t]) => [k, matchScore(s, t, ids)]).filter(([, sc]) => sc >= 0);
      if (!hits.length) continue;
      const top = Math.max(...hits.map(h => h[1]));
      const winners = hits.filter(h => h[1] === top);
      if (winners.length > 1) ties++; else reachable.add(winners[0][0]);
    }
    check('no two dishes ever tie on the same contents', ties === 0, `${ties} ambiguous signatures`);

    // The sweep above caps at 2 units per profile and 5 in total, which covers a
    // catalog authored in ones and twos. `pulled_shoulder` lives outside it on
    // purpose: a unit of `preserved` is 300g and a bone-in shoulder is 2.6kg, so
    // the dish genuinely needs 6–10 units and the sweep can never reach it.
    // Check any such dish directly against its own declared needs, so the
    // reachability assertion stays honest instead of being a statement about
    // the sweep's bounds.
    for (const [key, t] of Object.entries(DISHES)) {
      if (reachable.has(key)) continue;
      const sig = {};
      for (const [p, need] of Object.entries(t.needs || {})) {
        const [lo, hi] = Array.isArray(need) ? need : [need, need];
        sig[p] = (lo + hi) / 2;
      }
      const ids = new Set(t.keyItems || []);
      const hits = Object.entries(DISHES)
        .filter(([, o]) => !o.vessel || o.vessel === t.vessel)
        .map(([k, o]) => [k, matchScore(sig, o, ids)])
        .filter(([, sc]) => sc >= 0);
      if (!hits.length) continue;
      const top = Math.max(...hits.map(h => h[1]));
      const winners = hits.filter(h => h[1] === top);
      if (winners.length === 1 && winners[0][0] === key) reachable.add(key);
    }
    check('every dish in the catalog is reachable', reachable.size === Object.keys(DISHES).length, `${reachable.size}/${Object.keys(DISHES).length}`);

    // Authored TEACH_RECIPE nodes name a dish by KEY, and a key that doesn't
    // exist fails at the worst possible moment: the player works their way up an
    // NPC's trust ladder, picks the option, and the node answers "No such
    // recipe." Nothing else catches this — content:lint doesn't read dialogue
    // actions, and the handler can only find out at runtime. Cheap sweep of the
    // content tree, so a renamed dish takes its authored callers down with it
    // here rather than in front of a player.
    try {
      const { readdirSync, readFileSync } = await import('fs');
      const bad = [];
      for (const file of readdirSync('content/npcs')) {
        if (!file.endsWith('.json')) continue;
        const raw = readFileSync(`content/npcs/${file}`, 'utf8');
        if (!raw.includes('TEACH_RECIPE')) continue;
        const npc = JSON.parse(raw);
        for (const [nodeKey, node] of Object.entries(npc.dialogue_tree || {})) {
          for (const act of node?.actions || []) {
            const a = act.params || act;
            if (a.action !== 'TEACH_RECIPE' && act.action !== 'TEACH_RECIPE') continue;
            if (!DISHES[a.recipe]) bad.push(`${file}:${nodeKey} -> ${a.recipe}`);
          }
        }
      }
      check('every authored TEACH_RECIPE names a real dish', bad.length === 0, bad.join(', '));
    } catch (err) {
      // Running from somewhere without the content tree is not a cooking failure.
      check('TEACH_RECIPE content sweep ran', true, err.message);
    }

    // Composition: mean pulled toward the worst, clamped by the template ceiling.
    const allMasterful = composeBand(['masterful', 'masterful', 'masterful'], DISHES.stew);
    check('three masterful ingredients make a masterful stew', allMasterful === 'masterful', allMasterful);
    const dragged = composeBand(['masterful', 'masterful', 'poor'], DISHES.stew);
    check('one ruined ingredient drags the dish down', bandIndex(dragged) < bandIndex(allMasterful), dragged);
    check('the template ceiling is a hard clamp',
      composeBand(['masterful', 'masterful'], DISHES.broth) === DISHES.broth.ceiling, composeBand(['masterful', 'masterful'], DISHES.broth));
    check('slop can never be better than acceptable',
      bandIndex(composeBand(['masterful', 'masterful'], UNKNOWN_DISH)) <= bandIndex(UNKNOWN_DISH.ceiling));
    check("knowing the recipe helps but can't break the ceiling",
      composeBand(['masterful', 'masterful'], DISHES.broth, 5) === DISHES.broth.ceiling);

    // ── Recipe knowledge ─────────────────────────────────────────────────────
    await query('DELETE FROM player_flags WHERE player_id=$1 AND flag_key LIKE $2', [player.id, `${FLAG_PREFIX}%`]);

    const empty = await knownRecipes(player.id);
    check('a fresh cookbook is empty', empty.size === 0, empty.size);

    // Discovery by repetition: three good-or-better plates, then it's written.
    let att = await recordAttempt(player.id, 'stew', 'good', 0);
    check('the first good plate counts but teaches nothing', !att.learned && att.counted && att.count === 1, att);
    att = await recordAttempt(player.id, 'stew', 'excellent', 1);
    check('the second counts and still teaches nothing', !att.learned && att.count === 2, att);
    att = await recordAttempt(player.id, 'stew', 'good', 2);
    check('the third writes the recipe into the cookbook', att.learned === true && att.count === DISCOVERY_ATTEMPTS, att);

    const afterLearn = await cookbookState(player.id);
    check('learning clears the half-finished tally', !afterLearn.progress.has('stew'), [...afterLearn.progress]);

    // A poor plate is not progress — you can't stumble in by failing repeatedly.
    const bad = await recordAttempt(player.id, 'chowder', 'poor', 1);
    check("a plate below the bar doesn't count toward discovery", !bad.counted && bad.count === 1, bad);
    const weak = await recordAttempt(player.id, 'chowder', 'acceptable', 1);
    check('acceptable is still below the bar', !weak.counted, weak);

    const first = await learnRecipe(player.id, 'roast', 'good');
    check('a taught recipe is written immediately, no repetition', first.learned === true, first);
    const again = await learnRecipe(player.id, 'stew', 'good');
    check("cooking it a second time doesn't re-learn it", again.learned === false, again);

    const book = await knownRecipes(player.id);
    check('the cookbook reads back the band achieved', book.get('stew') === 'good', [...book]);
    check('knowing a recipe is worth a positive bonus', knownBonus(book, 'stew') > 0, knownBonus(book, 'stew'));
    check('an unknown recipe is worth nothing', knownBonus(book, 'pie') === 0);

    check('a better band beats the record', beatsRecorded('good', 'masterful') === true);
    check('a worse band does not', beatsRecorded('good', 'poor') === false);
    await improveRecipe(player.id, 'stew', 'masterful');
    check('improving rewrites the recorded band', (await knownRecipes(player.id)).get('stew') === 'masterful');

    // A recipe learned on paper is known but untried, and the first real cook promotes it.
    const paper = await learnRecipe(player.id, 'pie');
    check('a recipe card teaches without a band', paper.learned && paper.band === UNTRIED, paper);
    check('untried loses to any real band', beatsRecorded(UNTRIED, 'poor') === true);

    check('an unknown dish key is never written', (await learnRecipe(player.id, 'not_a_dish')).learned === false);
    await query('DELETE FROM player_flags WHERE player_id=$1 AND flag_key LIKE $2', [player.id, `${FLAG_PREFIX}%`]);

    // ── Improvised dishes ─────────────────────────────────────────────────
    //
    // The rule that replaced "unmatched ⇒ slop": FOOD MAKES A DISH, NON-FOOD
    // MAKES A MESS. Every one of these combinations has no catalog template
    // behind it, and every one of them should still come out with a name.
    {
      const sig = (o) => ({ ...o });
      const fam = (o, v) => inferDish(sig(o), v)?.family;

      check('liquid, meat and a root in a pot is a stew', fam({ liquid: 1, dense_meat: 1, starchy_vegetable: 2 }, 'pot') === 'stew');
      check('...two aromatics make it a curry instead', fam({ liquid: 1, dense_meat: 1, aromatic: 2 }, 'pot') === 'curry');
      check('...dairy with the meat makes it a chowder', fam({ liquid: 1, dense_meat: 1, dairy: 1 }, 'pot') === 'chowder');
      check("...no meat at all and it's a soup", fam({ liquid: 1, soft_vegetable: 2 }, 'pot') === 'soup');
      check('liquid on its own is a broth', fam({ liquid: 2 }, 'pot') === 'broth');
      check('batter and fruit in a tray is a pie', fam({ batter: 1, fruit: 2 }, 'tray') === 'pie');
      check('meat in a tray is a roast', fam({ dense_meat: 2 }, 'tray') === 'roast');
      check('starch and meat in a pan is a hash', fam({ starchy_vegetable: 2, dense_meat: 1 }, 'pan') === 'hash');
      check('leaves in a bowl are a salad', fam({ soft_vegetable: 2 }, 'bowl') === 'salad');
      check('meat on a bare stove is a grill', fam({ dense_meat: 1 }, null) === 'grill');

      // The one route to a mess that's left, and the reason it's the right one.
      check('something with no food profile in the pan is still a mess',
        inferDish({ liquid: 1, dense_meat: 1, unprofiled: 1 }, 'pot') === null);
      check("seasoning alone isn't a dish", inferDish({ aromatic: 2 }, 'pot') === null);

      // Naming: a dish is called after the thing it is mostly OF.
      const stewT = inferDish({ liquid: 1, dense_meat: 1, starchy_vegetable: 1 }, 'pot');
      check('the primary ingredient leads the generated name',
        stewT.nameSlots[0] === 'dense_meat', JSON.stringify(stewT.nameSlots));
      const pieT = inferDish({ batter: 1, fruit: 2 }, 'tray');
      check('...and a pie is named after its fruit, not its pastry',
        pieT.nameSlots[0] === 'fruit', JSON.stringify(pieT.nameSlots));

      // Complexity buys the ceiling, and stops short of the top rung.
      const simple = inferDish({ dense_meat: 1 }, 'pan');
      const rich = inferDish({ liquid: 1, dense_meat: 1, starchy_vegetable: 1, soft_vegetable: 1, dairy: 1 }, 'pot');
      check('a more complex improvisation has a higher ceiling',
        bandIndex(rich.ceiling) > bandIndex(simple.ceiling), `${simple.ceiling} → ${rich.ceiling}`);
      check("...and it's harder, so the ceiling isn't free",
        rich.difficulty > simple.difficulty, `${simple.difficulty} → ${rich.difficulty}`);
      check('NO improvisation ever reaches masterful — that rung is the catalog\'s',
        bandIndex(improvisedCeiling(99)) < bandIndex('masterful'), improvisedCeiling(99));
      check('...and improvised IP always pays less than discovering a real recipe',
        improvisedIp(99, 'masterful') < DISCOVERY_IP, improvisedIp(99, 'masterful'));
      check('a bad improvisation pays nothing at all', improvisedIp(5, 'poor') === 0);

      // Signature identity: what makes a saved recipe match the next pot.
      const a = recipeSignature({ liquid: 1.1, dense_meat: 0.9 }, 'pot');
      const b = recipeSignature({ dense_meat: 1.2, liquid: 0.8 }, 'pot');
      check('the same pot in a different order is the same recipe', a === b, `${a} vs ${b}`);
      check('...but a different vessel is a different recipe',
        recipeSignature({ liquid: 1, dense_meat: 1 }, 'pan') !== a);
      // Seasoning is not an ingredient — a stew you salted and one you didn't
      // are the same recipe, and a saved one has to match both.
      check("...and seasoning isn't part of the identity",
        recipeSignature({ liquid: 1, dense_meat: 1, aromatic: 1 }, 'pot') === a, a);
    }

    // ── The shopping list ─────────────────────────────────────────────────
    //
    // The rule: it stores what you WANT, never what you have. Every tick is
    // answered against your inventory at read time, so buying the thing crosses
    // it off on its own and there is no write to miss.
    {
      await query('DELETE FROM player_flags WHERE player_id=$1 AND flag_key=$2', [player.id, SHOPLIST_FLAG]);
      await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2', [player.id, TOM]);

      let r = await run('shoplist');
      check('an empty list says how to fill it', /Nothing on your list/.test(r?.message || ''), r?.message);
      r = await run('shoplist add not_a_real_dish');
      check("adding a recipe you don't know is refused", r?.type === 'error', JSON.stringify(r));

      r = await run('shoplist add soup');
      check("adding a recipe writes down what you're SHORT of", /Added to the list/.test(r?.message || ''), r?.message);
      const list = await getList(player.id);
      check('...as ingredient CLASSES, which is what a recipe actually asks for',
        list.length > 0 && list.every(e => e.k === 'p' || e.k === 'i'), JSON.stringify(list));
      // A recipe is not only its food. Soup is a pot on a stove, and a list that
      // sent you home with the vegetables and no pot was two thirds of an errand.
      // The kit is DERIVED at read time, never stored — so it is absent above and
      // present the moment the list is answered.
      const answered = answer(list, await holdings(player.id));
      check("...and the KIT it's made in, derived rather than written down",
        answered.some(e => e.k === 'g' && e.v === 'vessel:pot' && e.derived), JSON.stringify(answered.map(e => [e.k, e.v])));
      check('...never the stove, which is furniture and not a thing you carry out of a shop',
        !answered.some(e => e.v === 'heat'), JSON.stringify(answered.map(e => e.v)));
      check('...remembering which recipe it was for', list.every(e => e.for === 'soup'), JSON.stringify(list));

      r = await run('shoplist');
      check('the list shows unticked boxes for what you lack', /\[ \]/.test(r?.message || ''), r?.message);

      // The shelf, marked — the other half of a shopping list, and the reason
      // entries are CLASSES: "one soft vegetable" is satisfied by whatever this
      // particular shop happens to stock, with no authored mapping anywhere.
      const shelf = [{ item_id: TOM, name: 'test tomato' }, { item_id: STEAK, name: 'test steak' }];
      await markShelf({ stock: shelf, playerId: player.id });
      check('shop stock on your list is marked, by CLASS not by item id',
        shelf.find(s => s.item_id === TOM)?.wanted === true, JSON.stringify(shelf));
      check('...and stock you have no use for is left alone',
        !shelf.find(s => s.item_id === STEAK)?.wanted, JSON.stringify(shelf));

      // A class entry names things you can actually hand over a counter, and
      // every noun it names must be one the entry will ACCEPT — the note on a
      // recipe card says "tomato", but a fresh tomato is a soft_vegetable and
      // the liquid in that sauce is the tinned one.
      {
        // A written-out note, not a dish's — penne alla gin names its tomato and
        // its cream outright now, so the catalog no longer has a note that talks
        // about a class in nouns. The ORDERING rule it proves is unchanged: what
        // the note mentions first, the list offers first.
        const t = { notes: { liquid: 'tomato for the body, a slug of gin, cream to finish' } };
        const ex = buyableExamples('liquid', t);
        check('a class entry names buyable examples', ex.length > 0, JSON.stringify(ex));
        check('...and every one of them really carries that profile',
          ex.every(noun => [...getItemCache().values()].some(i =>
            i.tags?.food_profile === 'liquid' &&
            String(i.tags?.food_noun || i.name || '').toLowerCase() === noun)),
          JSON.stringify(ex));
        check('...ordered so the recipe\'s own note leads (tomato before the spirit)',
          ex.indexOf('tomato') === 0, JSON.stringify(ex));
      }

      // The container hook: the same mark on the box you opened, because half a
      // shop's stock is reached by opening the case rather than by the clerk.
      {
        const view = { containerItems: [
          { item_id: TOM, name: 'test tomato', tags: { food_profile: 'soft_vegetable' } },
          { item_id: STEAK, name: 'test steak', tags: { food_profile: 'dense_meat' } },
        ] };
        await markContainer({ view, playerId: player.id });
        check('a container marks contents that are on your list',
          view.containerItems[0].wanted === true, JSON.stringify(view.containerItems));
        check('...and leaves the rest of the box alone',
          !view.containerItems[1].wanted, JSON.stringify(view.containerItems));
      }

      // HOW MANY, not just whether: the take-listed button acts on `wantedQty`,
      // so a shelf of five tomatoes must not empty itself for a soup that wants
      // one — and a second shelf of the same thing must not claim it twice.
      {
        const view = { containerItems: [
          { item_id: TOM, name: 'test tomato', quantity: 5, tags: { food_profile: 'soft_vegetable' } },
        ], secondary: { containerItems: [
          { item_id: TOM, name: 'test tomato', quantity: 5, tags: { food_profile: 'soft_vegetable' } },
        ] } };
        await markContainer({ view, playerId: player.id });
        check('a marked row says how many the recipe is short of, not the whole stack',
          view.containerItems[0].wantedQty === 1, JSON.stringify(view.containerItems));
        check('...and the shortfall is spent once, across every box of the appliance',
          !view.secondary.containerItems[0].wanted, JSON.stringify(view.secondary.containerItems));
      }

      // Buy the thing. Nothing fires; the box ticks because the box is a
      // question, not a record.
      const softId = randomUUID();
      await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition) VALUES ($1,$2,$3,1,1.0)`, [softId, player.id, TOM]);
      r = await run('shoplist');
      check('acquiring an ingredient ticks it off with no write of any kind',
        /\[x\]/.test(r?.message || ''), r?.message);

      // ...and a finished dish is not an ingredient, so buying dinner never
      // crosses "one soft vegetable" off.
      await query(`UPDATE player_inventory SET custom_data='{"dish":"soup","cooked":true}'::jsonb WHERE id=$1`, [softId]);
      const held = await holdings(player.id);
      check('a cooked dish never counts toward the list', !(held.byProfile.soft_vegetable > 0), JSON.stringify(held.byProfile));
      await query(`UPDATE player_inventory SET custom_data='{}'::jsonb WHERE id=$1`, [softId]);

      // ...and once it's in your hands the shelf stops shouting about it.
      const shelf2 = [{ item_id: TOM, name: 'test tomato' }];
      await markShelf({ stock: shelf2, playerId: player.id });
      check('a shelf stops marking what you have already bought',
        !shelf2[0].wanted, JSON.stringify(shelf2));

      r = await run('shoplist tidy');
      check('tidy crosses off what you have for good', /Crossed off/.test(r?.message || ''), r?.message);
      const after = await getList(player.id);
      check('...and leaves the rest', after.length < list.length, `${list.length} → ${after.length}`);

      // What you're CARRYING, by item id. `holdings` built byItem off a column
      // the query never selected, so it was permanently empty: every key-item
      // line read MISSING no matter what was in your hands.
      {
        const h = await holdings(player.id);
        check("holdings knows which specific items you're carrying", (h.byItem[TOM] || 0) >= 1, JSON.stringify(h.byItem));
      }

      // A key item is mandatory AND it satisfies a unit of its own class, so it
      // must be counted once, not twice. penne alla gin keys on the penne, and
      // the dry_starch line borrows the penne's own noun — writing both put "125g
      // of penne" and "box of penne" on the same list as two separate errands.
      {
        // Empty-handed, or the list quite rightly says nothing about the tomato
        // already in your pocket from the test above.
        await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2', [player.id, TOM]);
        await run('shoplist clear');
        await run('shoplist add penne alla gin');
        const l = await getList(player.id);
        const keys = l.filter(e => e.k === 'i').map(e => e.v);
        check('a recipe\'s key items go on the list by name', keys.includes('item_penne') && keys.includes('item_gin'), JSON.stringify(l));
        check('...and never a second time as the class they already satisfy',
          !l.some(e => e.k === 'p' && e.v === 'dry_starch'), JSON.stringify(l));
        // The sauce is two more errands, not one fungible "liquid" — and each is
        // written down by the word the dish uses for it, so the list says tomato
        // and cream rather than "one soft vegetable" and "one dairy".
        const out = (await run('shoplist'))?.message || '';
        check('...the sauce goes on as its actual parts', /tomato/.test(out) && /cream/.test(out), out);
        check('...and not as a count of interchangeable liquids',
          !l.some(e => e.k === 'p' && e.v === 'liquid'), JSON.stringify(l));

        // Grouped under the dish, because a recipe is several separate purchases
        // and a flat run of ingredients reads as one.
        check('the list groups its lines under the recipe that wanted them', /penne alla gin/.test(out), out);
        check('...saying outright that each one is bought separately', /separately/.test(out), out);
      }

      // A LIST WRITTEN BY AN OLDER BUILD HEALS ITSELF.
      //
      // Entries stored their rendered prose, so a list survived a change to the
      // recipe it came from and went on describing the old one — a `liquid` line
      // penne alla gin no longer wants, the penne asked for twice, and the recipe
      // card's notes on a list whose only job is to say what to buy. Every one of
      // those is re-derived from the template now, on load.
      {
        await run('shoplist clear');
        // Exactly the shape the old build wrote, planted by hand.
        const stale = [
          { k: 'p', v: 'liquid', n: 2, label: '800g–1.2kg of liquid — tomato for the body, a slug of gin, cream to finish', for: 'penne alla gin' },
          { k: 'p', v: 'dry_starch', n: 1, label: '125g of penne — a portion a head, no more', for: 'penne alla gin' },
          { k: 'i', v: 'item_penne', n: 1, label: 'box of penne', for: 'penne alla gin' },
          { k: 'i', v: 'item_gin', n: 1, label: 'bottle of gin', for: 'penne alla gin' },
        ];
        await query(
          `INSERT INTO player_flags (player_id, flag_key, flag_value) VALUES ($1,$2,$3)
             ON CONFLICT (player_id, flag_key) DO UPDATE SET flag_value = EXCLUDED.flag_value`,
          [player.id, SHOPLIST_FLAG, JSON.stringify(stale)]);

        const healed = await getList(player.id);
        check('a class the recipe no longer wants drops off the list',
          !healed.some(e => e.k === 'p' && e.v === 'liquid'), JSON.stringify(healed.map(e => e.label)));
        check('...the class a key item already covers stops being asked for twice',
          !healed.some(e => e.k === 'p' && e.v === 'dry_starch'), JSON.stringify(healed.map(e => e.label)));
        check('...the two bottles you actually go and buy survive untouched',
          healed.filter(e => e.k === 'i').length === 2, JSON.stringify(healed));
        check('...and no recipe-card note rides along on any of it',
          healed.every(e => !/a portion a head|for the body|to finish/.test(e.label)), JSON.stringify(healed.map(e => e.label)));
      }

      // A DECLARED NOUN WINS EVEN WITH NO KEY ITEM. The guard that needs
      // `keyItems` sat ABOVE the declared-noun lookup, so an author who named a
      // class on a dish with no key item — a gratin, a chowder, a custard, most
      // of the catalog — had it silently ignored and the card kept saying "400g
      // of liquid".
      {
        const info = id => { try { return getItem(id); } catch { return null; } };
        check('an authored noun is used on a dish with no key items at all',
          !DISHES.gratin.keyItems && keyNounFor(DISHES.gratin, 'liquid', info) === 'cream',
          JSON.stringify(keyNounFor(DISHES.gratin, 'liquid', info)));
        check('...and it reaches the line the shopping list prints',
          /of cream/.test(ingredientLine('liquid', DISHES.gratin.needs.liquid, DISHES.gratin, info)),
          ingredientLine('liquid', DISHES.gratin.needs.liquid, DISHES.gratin, info));
        // ...but a class nobody named still keeps its alternatives, which is the
        // correct answer for a class that really is open.
        check('a class the author left open still offers its answers',
          !keyNounFor(DISHES.soup, 'liquid', info) && buyableExamples('liquid', DISHES.soup).length > 1,
          JSON.stringify(buyableExamples('liquid', DISHES.soup)));
      }

      // COMPONENTS ARE NOT ALTERNATIVES. Both nest, and a list that renders them
      // alike is telling you to buy one of three things that are all required.
      {
        await run('shoplist clear');
        await run('shoplist add penne alla gin');
        const l = await getList(player.id);
        const sauce = l.filter(e => e.part);
        check('a dish\'s components are stamped with the thing they compose',
          sauce.length >= 2 && sauce.every(e => e.part === 'the sauce'), JSON.stringify(l.map(e => [e.label, e.part])));
        check("...and the pasta isn't one of them", l.some(e => e.v === 'item_penne' && !e.part), JSON.stringify(l.map(e => [e.v, e.part])));

        const shop = await run('tabletnav cookbook Shopping_List __shop');
        const rows = shop?.items || [];
        const parent = rows.findIndex(i => i.label === 'the sauce');
        check('the tablet gives the sauce a parent line of its own', parent >= 0, JSON.stringify(rows.map(i => i.label)));
        check('...with no checkbox on it — you buy its parts, not it',
          !/[☐☑]/.test(rows[parent]?.label || ''), JSON.stringify(rows[parent]));
        check('...saying outright that all of them are needed', /all of them/.test(rows[parent]?.sub || ''), JSON.stringify(rows[parent]?.sub));
        const members = rows.slice(parent + 1).filter(i => i.part);
        check('...and its components keep their own boxes', members.length >= 2 && members.every(i => /[☐☑]/.test(i.label)),
          JSON.stringify(members.map(i => i.label)));
        check('...and each one still opens', members.every(i => String(i.id).startsWith('__ing:')), JSON.stringify(members.map(i => i.id)));
        check('a component is never marked as an alternative', !members.some(i => i.option || i.or), JSON.stringify(members));

        // THINGS YOU JUST BUY COME FIRST. A composed thing is a stop on the walk
        // round the shop rather than an item in the basket, and leading with it
        // buried the one line that WAS a simple purchase.
        const looseAt = rows.findIndex(i => i.child && /box of penne/.test(i.label));
        check('the plain purchase is listed before the thing you assemble',
          looseAt >= 0 && looseAt < parent, JSON.stringify(rows.map(i => i.label)));
        // ...and inside the group, the order is the order you cook in.
        check('components read in the order the dish is made in',
          /fat/i.test(members[0]?.label || '') && /tomato/i.test(members[1]?.label || '')
            && /gin/i.test(members[2]?.label || '') && /cream/i.test(members[3]?.label || ''),
          JSON.stringify(members.map(i => i.label)));

        // A COMPONENT GROUP IS ALL-OR-NOTHING, so an older list that holds only
        // some of it gets completed. This is the screenshot that started it: a
        // list carrying just the two key items rendered "1 things that make it"
        // with the tomato and the cream nowhere on it.
        await run('shoplist clear');
        await query(
          `INSERT INTO player_flags (player_id, flag_key, flag_value) VALUES ($1,$2,$3)
             ON CONFLICT (player_id, flag_key) DO UPDATE SET flag_value = EXCLUDED.flag_value`,
          [player.id, SHOPLIST_FLAG, JSON.stringify([
            { k: 'i', v: 'item_gin', n: 1, label: 'bottle of gin', for: 'penne alla gin' },
            { k: 'i', v: 'item_penne', n: 1, label: 'box of penne', for: 'penne alla gin' },
          ])]);
        const grown = await getList(player.id);
        check('a half-written component group is completed on load',
          grown.filter(e => e.part === 'the sauce').length === 4, JSON.stringify(grown.map(e => [e.v, e.part])));
        check('...with the ingredients the older list never knew about',
          grown.some(e => e.v === 'soft_vegetable') && grown.some(e => e.v === 'dairy'), JSON.stringify(grown.map(e => e.v)));
        check('...and the pasta outside it, still exactly one line',
          grown.filter(e => e.v === 'item_penne' && !e.part).length === 1, JSON.stringify(grown.map(e => [e.v, e.part])));
        // A group nobody asked for is never invented — completing only ever
        // finishes a group this list is already carrying.
        await run('shoplist clear');
        await run('shoplist add soup');
        check('a component group is never added to a list that never wanted it',
          !(await getList(player.id)).some(e => e.part), JSON.stringify(await getList(player.id)));

        // The parent opens onto what it is and how it's made.
        await run('shoplist clear');
        await run('shoplist add penne alla gin');
        const det2 = await run('tabletnav cookbook Shopping_List __part:penne_alla_gin:the_sauce');
        check('the sauce opens its own screen', det2?.view === 'detail', JSON.stringify({ v: det2?.view, m: det2?.message }));
        check('...listing every component it takes',
          (det2?.detail?.rows || []).filter(r => /to buy|in hand/.test(String(r.value))).length === 4,
          JSON.stringify(det2?.detail?.rows));
        check('...and the method, read from the recipe rather than copied beside it',
          (det2?.detail?.rows || []).some(r => DISHES.penne_alla_gin.steps.includes(String(r.value))),
          JSON.stringify((det2?.detail?.rows || []).map(r => r.value)));

        // The other half of the distinction, on a dish that has one.
        await run('shoplist clear');
        await run('shoplist add soup');
        const alt = (await run('tabletnav cookbook Shopping_List __shop'))?.items || [];
        // Per RUN, not across the screen: a dish with two generic classes has two
        // sets of alternatives, and each starts fresh — "tomato or stock" then
        // "cabbage or greens", never one OR bridging the two.
        const runs = [];
        for (const i of alt) {
          if (!i.option) { runs.push([]); continue; }
          (runs[runs.length - 1] || runs[runs.push([]) - 1]).push(i);
        }
        const real = runs.filter(r => r.length >= 2);
        const opts = alt.filter(i => i.option);
        check('alternatives carry an OR from the second one on',
          real.length > 0 && real.every(r => !r[0].or && r.slice(1).every(i => i.or)),
          JSON.stringify(real.map(r => r.map(i => [i.label, !!i.or]))));
        check('...and an OR never bridges two separate sets of them',
          real.every(r => r.every((i, n) => (n === 0) === !i.or)), JSON.stringify(real.map(r => r.map(i => !!i.or))));
        check('...and never a checkbox', !opts.some(i => /[☐☑]/.test(i.label)), JSON.stringify(opts.map(i => i.label)));
        const text = (await run('shoplist'))?.message || '';
        check('...and the text list spells the OR out too', /<b>or<\/b>/.test(text), text);
      }

      // A class the dish has no specific word for is one errand with several
      // possible answers, and those answers nest UNDER it as alternatives —
      // never as more boxes to tick, which would read as "buy all of them".
      {
        await run('shoplist clear');
        await run('shoplist add soup');
        const l = await getList(player.id);
        const cls = l.find(e => e.k === 'p' && (e.ex || []).length);
        const out = (await run('shoplist'))?.message || '';
        check('a class line carries its buyable answers as parts', !!cls, JSON.stringify(l));
        check('...with the bare ask kept separate from them', !!cls?.base && !/—/.test(cls.base), JSON.stringify(cls));
        check('...and they print as alternatives, not as errands', /any one of:/.test(out), out);

        // ON THE TABLET, every one of those rows OPENS. A shopping-list line used
        // to carry an empty id, and an empty id navigates the app with no params —
        // i.e. to the app ROOT. Tapping an ingredient threw you out of the list.
        const shop = await run('tabletnav cookbook Shopping_List __shop');
        const rows = shop?.items || [];
        check('the tablet list is a tree of headings, lines and alternatives',
          rows.some(i => i.group) && rows.some(i => i.child) && rows.some(i => i.option), JSON.stringify(rows.map(i => i.label)));
        // The kit block's own heading is a heading, not a purchase — it opens
        // nothing for the same reason a component group's parent doesn't.
        check('every ingredient line you can buy leads somewhere',
          rows.filter(i => i.child && i.label !== 'To make it in').every(i => String(i.id || '').startsWith('__ing:')),
          JSON.stringify(rows.filter(i => i.child)));
        check('...and no heading or summary pretends to',
          rows.filter(i => i.group).every(i => !i.id), JSON.stringify(rows.filter(i => i.group)));
        const line = rows.find(i => i.child && i.id);
        const det = await run(`tabletnav cookbook Shopping_List ${line.id}`);
        check('opening a line opens the ingredient, not the app root',
          det?.view === 'detail' && det?.detail?.id === line.id, JSON.stringify({ v: det?.view, id: det?.detail?.id, want: line.id }));
        check('...and stays inside the shopping list',
          (det?.breadcrumb || []).includes('Shopping List'), JSON.stringify(det?.breadcrumb));
        check('...telling you how it behaves in a pan', (det?.detail?.rows || []).some(r => r.label === 'Raw'), JSON.stringify(det?.detail?.rows));
      }

      // ── The kit ────────────────────────────────────────────────────────
      //
      // Bought once and bought forever, which is what makes it a different kind
      // of line from an ingredient: owning one pot answers the pot line on every
      // recipe you will ever add, and no list should ask you for a second.
      {
        await run('shoplist clear');
        await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2', [player.id, 'item_casserole_pot']);
        await run('shoplist add soup');
        let text = (await run('shoplist'))?.message || '';
        check('the text list gives the kit its own heading', /to make it in/.test(text), text);
        check('...and never runs it in with the vegetables', /a pot/.test(text), text);

        // The shelf, marked — the same question one aisle over. A hardware shop
        // highlights the pot exactly as the grocer highlights the onion.
        const shelf2 = [{ item_id: 'item_casserole_pot', name: 'test pot' }, { item_id: STEAK, name: 'test steak' }];
        await markShelf({ stock: shelf2, playerId: player.id });
        check('cookware on your list is marked on a shop shelf',
          shelf2[0].wanted === true, JSON.stringify(shelf2));

        // Own one, and the line doesn't tick — it GOES. A pot you own is not an
        // errand you have finished, it is an errand you no longer have, and no
        // recipe you add next month will ask you for a second one.
        const potRow = randomUUID();
        await query(
          `INSERT INTO player_inventory (id,player_id,item_id,quantity,condition) VALUES ($1,$2,$3,1,1.0)`,
          [potRow, player.id, 'item_casserole_pot']);
        text = (await run('shoplist'))?.message || '';
        check('buying the pot takes it off the list on its own', !/a pot/.test(text), text);
        check('...while the kit you still lack stays', /to make it in/.test(text), text);
        check('...and nothing about it was ever written down',
          !(await getList(player.id)).some(e => e.k === 'g'), JSON.stringify(await getList(player.id)));

        // THE BACKFILL, which this costs nothing: a list written before recipes
        // knew what they were cooked in holds food and nothing else, and gains
        // its kit the moment anybody opens it.
        await query('DELETE FROM player_inventory WHERE id=$1', [potRow]);
        await query(
          `INSERT INTO player_flags (player_id, flag_key, flag_value) VALUES ($1,$2,$3)
             ON CONFLICT (player_id, flag_key) DO UPDATE SET flag_value=EXCLUDED.flag_value`,
          [player.id, SHOPLIST_FLAG, JSON.stringify([{ k: 'p', v: 'liquid', n: 1, label: 'liquid', for: 'soup' }])]);
        const healed = answer(await getList(player.id), await holdings(player.id));
        check('an older list grows the kit it never knew to ask for',
          healed.some(e => e.k === 'g' && e.v === 'vessel:pot'), JSON.stringify(healed.map(e => [e.k, e.v])));
        check('...attributed to the recipe that wants it, not floated loose',
          healed.filter(e => e.k === 'g').every(e => e.for === 'soup'), JSON.stringify(healed.map(e => [e.k, e.for])));
        // Two recipes on one list want one pot between them.
        await run('shoplist add stew');
        const both = answer(await getList(player.id), await holdings(player.id));
        check('...and two recipes wanting a pot are still one pot',
          both.filter(e => e.v === 'vessel:pot').length === 1, JSON.stringify(both.filter(e => e.k === 'g').map(e => [e.v, e.for])));
      }

      // DROPPING A WHOLE DISH. `add` is recipe-sized, so `drop` has to be — and
      // it must take only the dish named, leaving the other one's lines alone.
      {
        await run('shoplist clear');
        await run('shoplist add soup');
        await run('shoplist add stew');
        const before = await getList(player.id);
        const soupLines = before.filter(e => e.for === 'soup').length;
        const stewLines = before.filter(e => e.for === 'stew').length;
        let r = await run('shoplist drop soup');
        const after = await getList(player.id);
        check('dropping a recipe takes every line it added',
          soupLines > 0 && after.every(e => e.for !== 'soup'), JSON.stringify(after.map(e => e.for)));
        check('...and leaves the other recipe on the list',
          after.filter(e => e.for === 'stew').length === stewLines, JSON.stringify(after.map(e => e.for)));
        check('...and says so', /soup/i.test(r?.message || '') && r?.type === 'output', JSON.stringify(r));
        r = await run('shoplist drop soup');
        check('dropping one that isn\'t on it\'s an error, not a silent no-op',
          r?.type === 'error', JSON.stringify(r));
        // A number still means a line — the two readings must not collide.
        const n = (await getList(player.id)).length;
        r = await run('shoplist drop 1');
        check('a number still drops a single line',
          r?.type === 'output' && (await getList(player.id)).length === n - 1, JSON.stringify(r));
      }

      await run('shoplist clear');
      check('clear empties it', (await getList(player.id)).length === 0);
      await query('DELETE FROM player_inventory WHERE id=$1', [softId]);
      await query('DELETE FROM player_flags WHERE player_id=$1 AND flag_key=$2', [player.id, SHOPLIST_FLAG]);
    }

    // ── Player recipes: save, rename, share ───────────────────────────────
    {
      await query('DELETE FROM player_flags WHERE player_id=$1 AND flag_key LIKE $2', [player.id, `${SAVED_PREFIX}%`]);

      let r = await run('recipe');
      check('an empty personal book says how to start one', /written nothing down/.test(r?.message || ''), r?.message);
      r = await run('recipe save house special');
      check('saving with nothing invented in hand is refused',
        r?.type === 'error' && /not holding anything you invented/.test(r.message), JSON.stringify(r));

      // The dish itself is the record — hold one and write it down.
      const invented = randomUUID();
      await query(
        `INSERT INTO player_inventory (id,player_id,item_id,quantity,condition,custom_data) VALUES ($1,$2,$3,1,1.0,$4::jsonb)`,
        [invented, player.id, 'item_cooked_dish', JSON.stringify({
          name: 'rat and turnip stew', dish: 'unknown', cooked: true, cook_quality: 'good',
          improv: 'pot|dense_meat:1,liquid:1,starchy_vegetable:2', family: 'stew', complexity: 3,
        })]
      );
      r = await run('recipe save Rat Surprise');
      check('holding something you invented, you can write it down', /Yours now/.test(r?.message || ''), JSON.stringify(r));
      const renamed = (await query('SELECT custom_data FROM player_inventory WHERE id=$1', [invented])).rows[0];
      check('...and the plate in your hands takes the name immediately',
        renamed.custom_data.name === 'Rat Surprise', renamed.custom_data.name);

      r = await run('recipe save Something Else');
      check('the same combination under a second name is refused',
        r?.type === 'error' && /already written that one down/.test(r.message), JSON.stringify(r));

      r = await run('recipe');
      check('it lists in your own book', /Rat Surprise/.test(r?.message || ''), r?.message);

      r = await run('recipe rename Rat Surprise to House Special');
      check('renaming is free', /House Special/.test(r?.message || ''), JSON.stringify(r));
      const saved2 = await savedRecipes(player.id);
      const only = [...saved2.values()][0];
      check("...and it's the same recipe underneath — the signature is the identity",
        only.sig === 'pot|dense_meat:1,liquid:1,starchy_vegetable:2', only.sig);

      r = await run('recipe write House Special');
      check('you can copy it onto a card', /onto a card/.test(r?.message || ''), JSON.stringify(r));
      const card = (await query(`SELECT id,custom_data FROM player_inventory WHERE player_id=$1 AND item_id=$2`, [player.id, 'item_written_recipe'])).rows[0];
      check('...and the card carries the whole recipe, so it travels by ordinary trade',
        card?.custom_data?.recipe?.sig === only.sig, JSON.stringify(card?.custom_data));
      check('...crediting whoever wrote it', card.custom_data.recipe.author === player.handle);

      // Reading your own card back is a no-op, not a duplicate.
      r = await run('read recipe card');
      check('reading a card you already know changes nothing',
        /already know/.test(r?.message || ''), JSON.stringify(r));

      r = await run('recipe forget House Special');
      check('you can scratch one out', /scratch/.test(r?.message || ''), JSON.stringify(r));
      r = await run('read recipe card');
      check('...and read it straight back off the card', /sticks/.test(r?.message || ''), JSON.stringify(r));

      r = await run('recipe teach House Special to nobody');
      check('teaching with nobody around says so',
        r?.type === 'error' && /nobody here/i.test(r.message), JSON.stringify(r));

      await query('DELETE FROM player_inventory WHERE id=$1 OR item_id=$2', [invented, 'item_written_recipe']);
      await query('DELETE FROM player_flags WHERE player_id=$1 AND flag_key LIKE $2', [player.id, `${SAVED_PREFIX}%`]);
    }

    // ── What an ingredient carries onto the plate ────────────────────────────
    // Plating turns a pan into one generic dish row, so anything the eat path
    // reads off item tags is gone. These assert the gather step that stops
    // cooking being a laundry for every bad idea.
    {
      const { gatherHazards } = await import('./hazards.js');

      check('a pan of ordinary food carries nothing', gatherHazards([
        { tags: { food_profile: 'dense_meat', restore_hunger: 20 } },
        { tags: { food_profile: 'soft_vegetable' } },
      ]) === null);

      const filthy = gatherHazards([
        { tags: { food_profile: 'dense_meat' } },
        { tags: { food_profile: 'liquid', status_chance: { food_poisoning: 0.9 }, disease_risk: true },
          custom_data: { donor_id: 'somebody' } },
      ]);
      check('filth in the pan taints the dish', filthy?.status_chance?.food_poisoning === 0.9, JSON.stringify(filthy));
      check('...and carries the disease risk', filthy?.disease_risk === true);
      check('...and remembers whose it was', filthy?.donors?.includes('somebody'), JSON.stringify(filthy?.donors));

      // WORST, never summed: two risky things must not push past certainty, and
      // must never average down into something safer than its worst ingredient.
      const two = gatherHazards([
        { tags: { status_chance: { food_poisoning: 0.9 } } },
        { tags: { status_chance: { food_poisoning: 0.5 } } },
      ]);
      check('two risky ingredients take the worst, not the sum', two.status_chance.food_poisoning === 0.9, JSON.stringify(two));
      check('...and never average down to something safer', two.status_chance.food_poisoning >= 0.9);

      // Dose-like properties DO sum — two irradiated fillets are two doses.
      const hot = gatherHazards([
        { tags: { restore_radiation: 5 } },
        { tags: { restore_radiation: 3 } },
      ]);
      check('irradiated ingredients sum into the dish', hot.radiation === 8, JSON.stringify(hot));

      // The laundering hole: without reading a row's OWN carried hazards, one
      // intermediate step (a paste, a dough) would wash the pan clean.
      const viaPaste = gatherHazards([
        { tags: { food_profile: 'batter' },
          custom_data: { crafted_quality: 'good', hazards: { status_chance: { food_poisoning: 0.9 }, disease_risk: true, donors: ['somebody'] } } },
      ]);
      check("an intermediate can't launder what went into it",
        viaPaste?.status_chance?.food_poisoning === 0.9 && viaPaste.disease_risk === true, JSON.stringify(viaPaste));
      check('...donors included', viaPaste?.donors?.includes('somebody'));

      // custom_data arrives as a jsonb string from some callers; a parse failure
      // must not throw in the middle of plating somebody's dinner.
      check('a string custom_data is read, not thrown on', gatherHazards([
        { tags: {}, custom_data: JSON.stringify({ hazards: { radiation: 4 } }) },
      ])?.radiation === 4);
      check('unparseable custom_data is survivable',
        gatherHazards([{ tags: { food_profile: 'liquid' }, custom_data: '{not json' }]) === null);

      // A laced ingredient makes a laced meal, and one dish takes one drug.
      const laced = gatherHazards([
        { tags: { laced_drug: 'drug_alcohol', laced_potency: 2 } },
        { tags: { laced_drug: 'drug_khole' } },
      ]);
      check('a laced ingredient laces the dish', laced.laced_drug === 'drug_alcohol', JSON.stringify(laced));
      check('...at its authored potency', laced.laced_potency === 2);
    }

    // ── The missing-ingredient list, and where to buy it ─────────────────────
    //
    // The shortfall travels twice — as the recipe card's sentence and as the
    // workspace list's rows — and the whole point of `ingredientParts` is that
    // those are one derivation. If a card can ever say a weight the list doesn't,
    // the two have drifted and a player is reading a lie on one of them.
    {
      const { ingredientParts, ingredientLine } = await import('./dishes.js');
      const { whereToBuy } = await import('./stockists.js');
      let drift = null;
      for (const [key, t] of Object.entries(DISHES)) {
        for (const [profile, need] of Object.entries(t.needs || {})) {
          const p = ingredientParts(profile, need, t, null);
          const line = ingredientLine(profile, need, t, null);
          // The sentence must contain both pieces the column shows, or the column
          // is showing something the card never said.
          if (!line.includes(p.amount) || !line.includes(p.noun)) { drift = `${key}/${profile}: "${line}" vs ${p.amount} / ${p.noun}`; break; }
        }
        if (drift) break;
      }
      check('every recipe line and its parts agree about weight and noun', !drift, drift);

      // THE DISCOVERY GATE. A shop is named only if you know its keeper, and this
      // player has met nobody — so however many grocers stock a soft vegetable,
      // the hint must name none of them. Getting this wrong hands out a directory
      // of every shop in Coldwater to somebody who has just left the vat.
      const noOne = { ...player, _relations: new Map() };
      const hint = await whereToBuy(noOne, { profile: 'soft_vegetable' });
      check('a stranger is told no shop by name', Array.isArray(hint.shops) && hint.shops.length === 0, JSON.stringify(hint));
      check('...but is still told whether anyone sells it', typeof hint.sold === 'boolean', JSON.stringify(hint));
      // A class nothing in the catalogue carries answers cleanly rather than
      // throwing — "nobody sells this" is a real and useful answer.
      const never = await whereToBuy(noOne, { profile: 'not_a_real_profile' });
      check('an unstocked class answers no-shop rather than throwing', never.sold === false && !never.shops.length, JSON.stringify(never));
    }

  } finally {
    const temps = [RAW, OVEN, STEAK, TOM, PAN, TURNER, KNIFE];
    await query('DELETE FROM player_inventory WHERE item_id = ANY($1)', [temps]).catch(() => {});
    await query('DELETE FROM items WHERE id = ANY($1)', [temps]).catch(() => {});
    for (const id of temps) deleteItemCache(id);
    await deleteFurniture(STOVE).catch(() => {});
    await deleteFurniture(STOVE_POWERED).catch(() => {});
    await deleteFurniture(LAB).catch(() => {});
    player.statuses = (player.statuses || []).filter(s => s.name !== 'food_poisoning');
    player.current_zone = saved;
  }
}
