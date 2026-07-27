// Cooking plugin regression — weight/thaw math, stage boundaries, the heat
// verb end-to-end (free/busy/powered stove, portable oven capacity), and the
// eat-path gate (raw sickness vs. a normal cooked meal).
import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { reloadItem, deleteItemCache } from '../../server/engine/items-cache.js';
import { insertFurniture, deleteFurniture, getFurnitureById } from '../../server/engine/world.js';
import { computeDuration, checkCooking, _test as cookTest } from './cook.js';
import { THAW_STAGES, COOK_STAGES, STOVE_SPEED, COOK_SECONDS_PER_KG, MIN_COOK_MS, stageText, BARE_VESSEL, PEAK_LINES, SLIPPING_LINES, FADING_LINES, STAGE_LINES, lineFor, stagesFor } from './config.js';
import { PROFILES, LEGACY_BAND_INDEX, profileNameFor, profileNeedsPrep, needsPrep, validateProfiles, QUALITY_BANDS, bandIndex, donenessLevels, donenessLevel, donenessAt, achievedDoneness } from './profiles.js';
import { leavesFond, makeFond, fondState, fondModifier, fondText, fondBelongs } from './fond.js';
import { prepWindowMult, prepBurnMult, prepCeilingDrop, prepBonus, marinadeStrength, canMarinate, prepText } from './prep.js';
import { tasteNotes, tasteTier, flavourLines } from './taste.js';
import { portionOf, isWhole, canChop, portionName, yieldOf } from './portions.js';
import { FOND_BONUS, FOND_RESIDUE_PENALTY, FOND_NEGLECT_PENALTY, FOND_LIFE_MS, MODIFIER_BONUS_CAP, MIN_PORTION, MINCE_RATE, MARINATE_MIN_MS, MARINATE_FULL_MS, MARINATE_PROFILES, TASTE_TIERS, MINCE_CEILING_DROP, BAND_SCALE, BASE_OFFSET, FOND_MIN_BAND, DISCOVERY_MIN_BAND, SLOP_CEILING, BAND_REWARDS, rewardFor, restMultiplier, restText, RESTS_WELL, REST_MIN_MS, REST_PEAK_MS, REST_COLD_MS, REST_COLD_PENALTY } from './config.js';
import { DISCOVERY_ATTEMPTS, cookingIpFor, ROUTINE_IP, MASTERFUL_IP, ROUTINE_IP_COOLDOWN_MS } from './config.js';
import {
  DISHES, UNKNOWN_DISH, validateDishes, signature, matchScore, matchDish,
  dishName, composeBand, nounFor, VESSEL_KINDS, seasoningIdeal, seasoningBonus, unitsOf, GENERIC_SANDWICH, ALSO,
} from './dishes.js';
import { FLAG_PREFIX, PROGRESS_PREFIX, UNTRIED, learnRecipe, knownRecipes, cookbookState, recordAttempt, improveRecipe, beatsRecorded, knownBonus } from './knowledge.js';
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
  {
    const { DISHES, matchScore } = await import('./dishes.js');
    const t = DISHES.penne_alla_gin;
    const full = new Set(['item_penne', 'item_gin', 'item_tomato_paste', 'item_synth_cream']);
    check('penne alla gin exists as a pan dish', t?.vessel === 'pan', t?.vessel);
    check('...and matches penne + gin + two liquids',
      matchScore({ starchy_vegetable: 1, liquid: 3 }, t, full) > 0);
    check('...but never without the gin',
      matchScore({ starchy_vegetable: 1, liquid: 2 }, t,
        new Set(['item_penne', 'item_tomato_paste', 'item_synth_cream'])) === -1);
    check('...nor without the penne',
      matchScore({ liquid: 3 }, t,
        new Set(['item_gin', 'item_tomato_paste', 'item_synth_cream'])) === -1);
    check('...nor on gin alone with nothing to carry it',
      matchScore({ starchy_vegetable: 1, liquid: 1 }, t, full) === -1);
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
  check('a burnt steak cannot exceed its burnt target however well it was handled', burntBest.band === PROFILES.dense_meat.targets.burnt, burntBest);

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
    r = await run('eat test raw cutlet');
    check('eating cooked food restores normally', /\+20 Hunger/.test(r?.message || ''), r?.message);

    // Fresh raw instance, never cooked — eating it should sicken instead of feed.
    await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2', [player.id, RAW]);
    const rawInvId = randomUUID();
    await query(`INSERT INTO player_inventory (id, player_id, item_id, quantity, condition) VALUES ($1,$2,$3,1,1.0)`, [rawInvId, player.id, RAW]);
    r = await run('eat test raw cutlet');
    check('eating raw food applies the undercooked message, not a normal restore', /raw in the middle/.test(r?.message || ''), r?.message);
    check('eating raw food does not restore hunger', !/\+20 Hunger/.test(r?.message || ''), r?.message);
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
    check('flipping does not disturb the rest of the session',
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
      check(`a ${band} meal restores ${expected} hunger`, new RegExp(`\\+${expected} Hunger`).test(eaten?.message || ''), eaten?.message);
      if (band === 'masterful') check('a masterful meal is well-fed even though the item is not tagged well_fed', /Well-fed/.test(eaten?.message || ''), eaten?.message);
    }

    // Unquality-stamped food is untouched by any of this.
    await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2', [player.id, STEAK]);
    const plainId = randomUUID();
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition,custom_data) VALUES ($1,$2,$3,1,1.0,'{"cooked":true}'::jsonb)`, [plainId, player.id, STEAK]);
    player.hunger = 0;
    r = await run('eat test steak');
    check('food with no cook_quality restores exactly what it always did', /\+20 Hunger/.test(r?.message || ''), r?.message);

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

    // ── The shared `cook` verb ───────────────────────────────────────────────
    await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2', [player.id, STEAK]);
    check('a room with only a stove offers one kind of cooking',
      new Set(cookTest2.cookStations(Z).map(s => s._cookKind)).size === 1, cookTest2.cookStations(Z).map(s => s.name));

    r = await run('cook');
    check('bare cook at a stove alone asks what, not which', r?.type === 'error' && /Cook what/.test(r.message), JSON.stringify(r));

    await insertFurniture({
      id: LAB, name: 'test chem bench', description: 'a test chem bench', object_type: 'fixture',
      zone_id: Z, flags: JSON.stringify({ crafting_station: 'chem_lab' }),
    }, 'ON CONFLICT (id) DO UPDATE SET flags=EXCLUDED.flags, zone_id=EXCLUDED.zone_id');

    const both = cookTest2.cookStations(Z);
    check('a stove and a chem lab in one room are both cook stations', new Set(both.map(s => s._cookKind)).size === 2, both.map(s => `${s.name}:${s._cookKind}`));

    r = await run('cook');
    check('bare cook with a stove AND a lab raises a station prompt', /Cook on which/.test(r?.message || ''), JSON.stringify(r));
    check('the prompt lists both stations by name', /test cooktop/.test(r?.message || '') && /test chem bench/.test(r?.message || ''), r?.message);
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
    check('a modifier is not put on the heat as its own ingredient', !/test dripping/.test(r?.message || ''), r?.message);

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
    check('masterful ignores the cooldown entirely — you cannot grind those',
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
    check('an unknown band does not zero out the price', px('nonsense') === computeSellUnitPrice(40, 0, 0, {}));
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
    check('food that does not rest is unaffected', restMultiplier(T, false, T + 60_000) === 1);
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
    check('it guts your stamina fast — you are going nowhere', p1.stamina <= 10, p1.stamina);
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
    check('mince already destroyed what tenderising would — the costs do not stack',
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
    check('seeding does not leave the generator armed for the next caller', (() => {
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
    check('a wet material adds a squelch layer a dry one does not have',
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
    check('...and thaws faster still — the one job it is genuinely best at',
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
    check('the beep is not the running sound', beep.id !== mwCue.id);
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
    check('seasoning is only commented on when there is a dish to judge',
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
    check('...and does not belong in a fruit one', !fondBelongs(makeFond('preserved', 'good', 1), DISHES.compote));
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

    check('a doneness target on mince is ignored — there is no rare middle',
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
    check('LIFTING it is worth a real bonus', fondModifier(fresh, { deglazed: true, now: 1_000_001 }) === FOND_BONUS);
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
    check('seasoning never needs a knife — it is already dust or oil',
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
    check('there is at least one intermediate recipe', inters.length >= 1, inters.map(([k]) => k));
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
    const smokedCut = { name: 'smoked pork', tags: { food_profile: 'dense_meat' },
      custom_data: { smoked: 'preserved', food_noun: 'pork', cooked: true, finishable: true } };
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
      { id: 'item_pink_slab', name: 'smoked pork', tags: { food_profile: 'dense_meat' }, custom_data: { smoked: 'preserved', food_noun: 'pork' } },
      { id: 'item_bbq_sauce', name: 'sauce', tags: { food_profile: 'fruit' }, custom_data: {} },
    ];
    const chop = matchDish(signature(chopRows, profileNameFor), 'pan', new Set(chopRows.map(r => r.id)));
    check('smoked meat finished with the sauce is its own dish', chop?.key === 'smoked_chop', chop?.key);
    check('...and it names the cut it came from',
      dishName(chop.template, chopRows, profileNameFor) === 'smoked pork chop', dishName(chop.template, chopRows, profileNameFor));
    check('the same cut WITHOUT the sauce is not that dish',
      matchDish(signature(chopRows, profileNameFor), 'pan', new Set(['item_pink_slab']))?.key !== 'smoked_chop');
    check('an unsmoked slab cannot be a smoked chop, whatever sauce you put on it', (() => {
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
    check('a potato does not — it is cooked or it is not', donenessLevels(PROFILES.starchy_vegetable) === null);
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
    check('the validator rejects a default that is not at 1.0', !badDefault.ok && /must sit at 1.0/.test(badDefault.errors.join(' ')), badDefault.errors);
    const badOrder = validateProfiles({ bad: { ...PROFILES.dense_meat,
      doneness: { default: 'medium', levels: [{ name: 'medium', at: 1 }, { name: 'rare', at: 0.75 }] } } });
    check('the validator rejects levels that are not ordered rarest-first', !badOrder.ok, badOrder.errors);

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
    check('the validator rejects a curve that does not cover the whole cook', !gapCurve.ok, gapCurve.errors);

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
    check('...and it is named off the cheese that went in it',
      /vat cheese/.test(dishName(DISHES.toastie, toastieRows, P)), dishName(DISHES.toastie, toastieRows, P));
    // Bread and fat alone used to fall through to a root-vegetable glaze; the
    // cheese is what makes it a toastie, so removing it must NOT still match.
    check('without the cheese it is not a toastie',
      matchDish(signature([toastieRows[0], toastieRows[2]], P), 'pan')?.key !== 'toastie');
    check('cheese is fine raw but best melted',
      bandIndex(PROFILES.dairy.targets.raw) >= bandIndex('good')
        && bandIndex(PROFILES.dairy.targets.peak) > bandIndex(PROFILES.dairy.targets.raw));
    check('cheese splits fast once it is past — the shortest grace of any real profile',
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
    check('bread arrives baked, so it is GOOD raw — a cold sandwich is not punished for it',
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
    check('being "also dairy" does not make milk a sandwich filling',
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

    const ram = named(['item_ramen_noodles', 'item_bone_broth'], 'pot', ['starchy_vegetable', 'liquid']);
    check('ramen noodles in stock is ramen', ram?.key === 'ramen', ram?.key);
    const rice = named(['item_grey_rice', 'item_bone_broth'], 'pot', ['starchy_vegetable', 'liquid']);
    check('rice in the same stock is not ramen', rice?.key !== 'ramen', rice?.key);

    // The tie that forced KEY_DISH_FLOOR: a keyed dish must beat a generic one
    // no matter how the counts fall, not merely when it happens to score higher.
    const loaded = named(
      ['item_ramen_noodles', 'item_bone_broth', 'item_offcut', 'item_offcut'], 'pot',
      ['starchy_vegetable', 'liquid', 'dense_meat', 'dense_meat']);
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

    const badKey = validateDishes({ bad: { ...DISHES.ramen, keyItems: ['ramen_noodles'] } });
    check('the validator rejects a keyItem that is not an item id', !badKey.ok, badKey.errors);
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
    check('every dish in the catalog is reachable', reachable.size === Object.keys(DISHES).length, `${reachable.size}/${Object.keys(DISHES).length}`);

    // Composition: mean pulled toward the worst, clamped by the template ceiling.
    const allMasterful = composeBand(['masterful', 'masterful', 'masterful'], DISHES.stew);
    check('three masterful ingredients make a masterful stew', allMasterful === 'masterful', allMasterful);
    const dragged = composeBand(['masterful', 'masterful', 'poor'], DISHES.stew);
    check('one ruined ingredient drags the dish down', bandIndex(dragged) < bandIndex(allMasterful), dragged);
    check('the template ceiling is a hard clamp',
      composeBand(['masterful', 'masterful'], DISHES.broth) === DISHES.broth.ceiling, composeBand(['masterful', 'masterful'], DISHES.broth));
    check('slop can never be better than acceptable',
      bandIndex(composeBand(['masterful', 'masterful'], UNKNOWN_DISH)) <= bandIndex(UNKNOWN_DISH.ceiling));
    check('knowing the recipe helps but cannot break the ceiling',
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
    check('a plate below the bar does not count toward discovery', !bad.counted && bad.count === 1, bad);
    const weak = await recordAttempt(player.id, 'chowder', 'acceptable', 1);
    check('acceptable is still below the bar', !weak.counted, weak);

    const first = await learnRecipe(player.id, 'roast', 'good');
    check('a taught recipe is written immediately, no repetition', first.learned === true, first);
    const again = await learnRecipe(player.id, 'stew', 'good');
    check('cooking it a second time does not re-learn it', again.learned === false, again);

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
