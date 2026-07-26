// Cooking plugin regression — weight/thaw math, stage boundaries, the heat
// verb end-to-end (free/busy/powered stove, portable oven capacity), and the
// eat-path gate (raw sickness vs. a normal cooked meal).
import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { reloadItem, deleteItemCache } from '../../server/engine/items-cache.js';
import { insertFurniture, deleteFurniture, getFurnitureById } from '../../server/engine/world.js';
import { computeDuration, checkCooking, _test as cookTest } from './cook.js';
import { THAW_STAGES, COOK_STAGES, STOVE_SPEED, stageText, BARE_VESSEL, PEAK_LINES, SLIPPING_LINES, FADING_LINES, STAGE_LINES, lineFor, stagesFor } from './config.js';
import { PROFILES, validateProfiles, QUALITY_BANDS, bandIndex, donenessLevels, donenessLevel, donenessAt, achievedDoneness } from './profiles.js';
import { DISCOVERY_ATTEMPTS } from './config.js';
import {
  DISHES, UNKNOWN_DISH, validateDishes, signature, matchScore, matchDish,
  dishName, composeBand, nounFor, VESSEL_KINDS, seasoningIdeal, seasoningBonus,
} from './dishes.js';
import { FLAG_PREFIX, PROGRESS_PREFIX, UNTRIED, learnRecipe, knownRecipes, cookbookState, recordAttempt, improveRecipe, beatsRecorded, knownBonus } from './knowledge.js';
import { evaluate, endStateAt, timeline, heatSpans } from './quality.js';
import { rowIsInstanced } from '../../server/engine/inventory.js';
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

  const heavier = computeDuration(2000, STOVE_SPEED.low, false);
  check('double the weight takes roughly double the time', Math.abs(heavier.cookMs - unfrozen.cookMs * 2) < 5, { heavier, unfrozen });

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
    ]) {
      await query(
        `INSERT INTO items (id,name,description,type,value,weight,tags) VALUES ($1,$2,$2,'misc',1,$4,$3)
         ON CONFLICT (id) DO UPDATE SET tags=$3, weight=$4`, [id, name, JSON.stringify(tags), weight]);
      await reloadItem(id);
    }

    const panId = randomUUID(), steakId = randomUUID(), turnerId = randomUUID();
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition) VALUES ($1,$2,$3,1,1.0)`, [panId, player.id, PAN]);
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition) VALUES ($1,$2,$3,1,1.0)`, [turnerId, player.id, TURNER]);
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition,container_id) VALUES ($1,$2,$3,1,1.0,$4)`, [steakId, player.id, STEAK, panId]);

    // Heating the vessel heats what's in it.
    r = await run('cook test pan');
    check('heating a vessel starts a session on the food inside it', r?.type === 'output' && /test steak/.test(r.message), JSON.stringify(r));
    let sRow = (await query('SELECT custom_data FROM player_inventory WHERE id=$1', [steakId])).rows[0];
    const live = sRow.custom_data?.cooking;
    check('a profiled session records its profile, heat tier and vessel', live?.profile === 'dense_meat' && live.heatTier === 'mid' && live.vessel?.d === 0.7, live);
    check('a profiled session starts with an empty handling log', Array.isArray(live.acts) && live.acts.length === 0, live);

    // The stove is held until it's plated or burns off, not merely until done.
    let heldStove = await getFurnitureById(STOVE);
    check('a profiled cook holds the stove past doneAt', heldStove.flags.busy_until > live.doneAt, { busy: heldStove.flags.busy_until, doneAt: live.doneAt });

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

    // ── Named dishes: the only templates that name an ingredient ─────────────
    const keyed = Object.entries(DISHES).filter(([, t]) => t.keyItems?.length);
    check('named dishes are a small minority of the catalog', keyed.length > 0 && keyed.length <= 5, keyed.map(([k]) => k));

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
    const temps = [RAW, OVEN, STEAK, TOM, PAN, TURNER];
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
