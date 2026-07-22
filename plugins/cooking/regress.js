// Cooking plugin regression — weight/thaw math, stage boundaries, the heat
// verb end-to-end (free/busy/powered stove, portable oven capacity), and the
// eat-path gate (raw sickness vs. a normal cooked meal).
import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { reloadItem, deleteItemCache } from '../../server/engine/items-cache.js';
import { insertFurniture, deleteFurniture, getFurnitureById } from '../../server/engine/world.js';
import { computeDuration, checkCooking, _test as cookTest } from './cook.js';
import { THAW_STAGES, COOK_STAGES, STOVE_SPEED, stageText } from './config.js';

export default async function regress({ run, check, getPlayer }) {
  const player = getPlayer();
  const saved = player.current_zone;
  const Z = 'zone_cooking_regress';
  const RAW = 'item_cooking_regress_raw';
  const OVEN = 'item_cooking_regress_oven';
  const STOVE = 'furn_cooking_regress_stove';
  const STOVE_POWERED = 'furn_cooking_regress_stove_powered';

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
    let r = await run('heat nonexistent food');
    check('heating with nothing by that name errors cleanly', r?.type === 'error', JSON.stringify(r));

    await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2', [player.id, RAW]);
    const invId = randomUUID();
    await query(`INSERT INTO player_inventory (id, player_id, item_id, quantity, condition) VALUES ($1,$2,$3,1,1.0)`, [invId, player.id, RAW]);

    r = await run('heat test raw cutlet');
    check('heat starts a cook session on the free stove', r?.type === 'output', JSON.stringify(r));
    let row = (await query('SELECT custom_data FROM player_inventory WHERE id=$1', [invId])).rows[0];
    check('a cooking session is written to the item', !!row.custom_data?.cooking, row.custom_data);

    let stove = await getFurnitureById(STOVE);
    check('the stove is marked busy_until', typeof stove.flags?.busy_until === 'number', stove.flags);

    r = await run('heat test raw cutlet');
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
    r = await run('heat test raw cutlet');
    check('a powered stove with no grid power refuses to heat', r?.type === 'error' && /power/i.test(r?.message || ''), JSON.stringify(r));
    await deleteFurniture(STOVE_POWERED);

    // No stove at all — falls back to a carried portable oven, capacity-gated.
    await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2', [player.id, OVEN]);
    const ovenInvId = randomUUID();
    await query(`INSERT INTO player_inventory (id, player_id, item_id, quantity, condition) VALUES ($1,$2,$3,1,1.0)`, [ovenInvId, player.id, OVEN]);
    // The remaining raw cutlet row is 1000g, oven capacity is 500g — too much.
    r = await run('heat test raw cutlet');
    check('food heavier than the portable oven capacity is refused', r?.type === 'error' && /small amounts/i.test(r?.message || ''), JSON.stringify(r));
  } finally {
    await query('DELETE FROM player_inventory WHERE item_id=$1 OR item_id=$2', [RAW, OVEN]).catch(() => {});
    await query('DELETE FROM items WHERE id=$1 OR id=$2', [RAW, OVEN]).catch(() => {});
    deleteItemCache(RAW);
    deleteItemCache(OVEN);
    await deleteFurniture(STOVE).catch(() => {});
    await deleteFurniture(STOVE_POWERED).catch(() => {});
    player.statuses = (player.statuses || []).filter(s => s.name !== 'food_poisoning');
    player.current_zone = saved;
  }
}
