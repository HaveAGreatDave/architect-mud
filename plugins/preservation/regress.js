// Preservation plugin regression — pure decay math (no DB/zone dependency)
// plus an integration check that untouched items never get a second write.
import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { reloadItem, deleteItemCache } from '../../server/engine/items-cache.js';
import { insertFurniture, deleteFurniture } from '../../server/engine/world.js';
import { computeCheckpoint, resolveEnvironment, ensureFreshnessCurrent } from './decay.js';
import { TIER_FACTOR, BASE_DECAY_PER_HOUR, POWER_LOSS_BUFFER_MIN, STATE_CUTOFFS, stateFor, ADDITIVE_FACTOR } from './config.js';

const HOUR = 3600000;

export default async function regress({ run, check, getPlayer }) {
  const player = getPlayer();
  const ITEM = 'item_preservation_regress';

  // ── Pure math: room-temp / refrigerated / frozen decay rates ──────────────
  const base = { value: 100, checkpointAt: 0, envBucket: 'ambient', powerLostAt: null };
  const sixHoursMs = 6 * HOUR;

  const ambient = computeCheckpoint(base, { tier: 'ambient', delivering: true, ambientTier: 'ambient', powerLostAt: null }, 'normal', sixHoursMs);
  const expectedAmbientDecay = 6 * BASE_DECAY_PER_HOUR * TIER_FACTOR.ambient;
  check('room-temp decay matches the ambient tier factor', Math.abs((100 - ambient.value) - expectedAmbientDecay) < 0.01, ambient.value);

  const fridge = computeCheckpoint(base, { tier: 'refrigerated', delivering: true, ambientTier: 'ambient', powerLostAt: null }, 'normal', sixHoursMs);
  check('refrigerated decays slower than ambient', (100 - fridge.value) < (100 - ambient.value), fridge.value);
  check('refrigerated decay matches its tier factor', Math.abs((100 - fridge.value) - 6 * BASE_DECAY_PER_HOUR * TIER_FACTOR.refrigerated) < 0.01, fridge.value);

  const freezer = computeCheckpoint(base, { tier: 'frozen', delivering: true, ambientTier: 'ambient', powerLostAt: null }, 'normal', sixHoursMs);
  check('frozen decays slower than refrigerated', (100 - freezer.value) < (100 - fridge.value), freezer.value);

  // ── Powered refrigeration holds its tier under a long elapsed span ────────
  const longSpanMs = 1000 * HOUR;
  const heldCold = computeCheckpoint({ ...base, checkpointAt: 0 }, { tier: 'frozen', delivering: true, ambientTier: 'hot', powerLostAt: null }, 'normal', longSpanMs);
  check('powered refrigeration holds its rated tier even over a huge elapsed span', heldCold.value > 0 && heldCold.value < 100, heldCold.value);

  // ── Power failure: buffer window at the rated tier, then ambient rate ─────
  const bufferMs = POWER_LOSS_BUFFER_MIN.refrigerated * 60000;
  const withinBuffer = computeCheckpoint(base, { tier: 'refrigerated', delivering: false, ambientTier: 'ambient', powerLostAt: 0 }, 'normal', bufferMs / 2);
  const expectedWithinBuffer = (bufferMs / 2 / HOUR) * BASE_DECAY_PER_HOUR * TIER_FACTOR.refrigerated;
  check('within the power-loss buffer, decay still runs at the rated tier', Math.abs((100 - withinBuffer.value) - expectedWithinBuffer) < 0.01, withinBuffer.value);

  const pastBuffer = computeCheckpoint(base, { tier: 'refrigerated', delivering: false, ambientTier: 'ambient', powerLostAt: 0 }, 'normal', bufferMs + HOUR);
  const expectedPastBuffer = (bufferMs / HOUR) * BASE_DECAY_PER_HOUR * TIER_FACTOR.refrigerated + 1 * BASE_DECAY_PER_HOUR * TIER_FACTOR.ambient;
  check('once the buffer is exhausted, the remainder decays at the ambient rate', Math.abs((100 - pastBuffer.value) - expectedPastBuffer) < 0.01, pastBuffer.value);

  // ── The BHT dose: a rate multiplier that survives re-checkpointing ────────
  const env = { tier: 'ambient', delivering: true, ambientTier: 'ambient', powerLostAt: null };
  const dosed = computeCheckpoint({ ...base, additive: ADDITIVE_FACTOR }, env, 'normal', sixHoursMs);
  check('a dosed item decays by exactly the additive factor', Math.abs((100 - dosed.value) - expectedAmbientDecay * ADDITIVE_FACTOR) < 0.01, dosed.value);
  check('the dose is carried forward onto the new checkpoint', dosed.additive === ADDITIVE_FACTOR, dosed);
  check('an undosed item carries no additive key at all', computeCheckpoint(base, env, 'normal', sixHoursMs).additive === undefined, ambient);

  const dosedCold = computeCheckpoint({ ...base, additive: ADDITIVE_FACTOR }, { ...env, tier: 'refrigerated' }, 'normal', sixHoursMs);
  check('the dose stacks with refrigeration rather than replacing it', (100 - dosedCold.value) < (100 - fridge.value) && (100 - dosedCold.value) < (100 - dosed.value), dosedCold.value);

  // ── Freshness never goes below zero ───────────────────────────────────────
  const wayGone = computeCheckpoint(base, { tier: 'ambient', delivering: true, ambientTier: 'ambient', powerLostAt: null }, 'fast', 1000 * HOUR);
  check('freshness floors at zero, never negative', wayGone.value === 0, wayGone.value);

  // ── State transitions ─────────────────────────────────────────────────────
  check('state cutoffs are monotonic', STATE_CUTOFFS.every((c, i) => i === 0 || c.min < STATE_CUTOFFS[i - 1].min), STATE_CUTOFFS);
  check('boundary values land in the expected state', stateFor(60) === 'fresh' && stateFor(59) === 'aging' && stateFor(25) === 'aging' && stateFor(24) === 'spoiling' && stateFor(0) === 'spoiled', {
    a: stateFor(60), b: stateFor(59), c: stateFor(25), d: stateFor(24), e: stateFor(0),
  });

  // ── Moving between environments: correctness comes from checkpointing AT the
  // transition (the stow/pull call-outs do this before the row's container_id
  // changes), not from a single computeCheckpoint call spanning the whole gap.
  // Two calls, each resolving the tier live at ITS moment, is what the engine
  // call-outs actually produce.
  let moving = { value: 100, checkpointAt: 0, envBucket: 'refrigerated', powerLostAt: null };
  moving = computeCheckpoint(moving, { tier: 'refrigerated', delivering: true, ambientTier: 'ambient', powerLostAt: null }, 'normal', 5 * HOUR); // pulled from the fridge at t=5h
  moving = computeCheckpoint(moving, { tier: 'ambient', delivering: true, ambientTier: 'ambient', powerLostAt: null }, 'normal', 8 * HOUR); // examined at t=8h, now sitting at ambient
  const expectedMoving = 100 - 5 * BASE_DECAY_PER_HOUR * TIER_FACTOR.refrigerated - 3 * BASE_DECAY_PER_HOUR * TIER_FACTOR.ambient;
  check('moving between environments: each segment decays at its own tier across successive checkpoint calls', Math.abs(moving.value - expectedMoving) < 0.01, moving.value);

  // ── Nested/one-hop container resolution: no container_id → falls to ambient zone ──
  const noContainer = await resolveEnvironment({ container_id: null }, player);
  check('an item with no container resolves via ambient zone temperature', typeof noContainer.tier === 'string' && noContainer.delivering === true, noContainer);

  // ── Integration: no write on two immediate no-elapsed-time calls ──────────
  // Housed in a self-contained (no power_draw_kw) preserving container so its
  // resolved environment never touches live ambient zone temperature — that
  // reads real, ticking world state (weather/diurnal), which is genuinely free
  // to change mid-suite and would otherwise make this check flaky, not wrong.
  const FURN = 'furn_preservation_regress_box';
  try {
    await query(
      `INSERT INTO items (id,name,description,type,value,weight,tags) VALUES ($1,'test perishable','test perishable','consumable',1,10,$2)
       ON CONFLICT (id) DO UPDATE SET tags=$2`,
      [ITEM, JSON.stringify({ consumable: true, perishable: true, spoil_rate: 'normal', restore_hunger: 5 })]
    );
    await reloadItem(ITEM);
    await insertFurniture({
      id: FURN, name: 'test cold box', description: 'a test cold box', object_type: 'container',
      zone_id: player.current_zone, flags: JSON.stringify({ preserves: 'refrigerated' }),
    }, 'ON CONFLICT (id) DO UPDATE SET flags=EXCLUDED.flags, zone_id=EXCLUDED.zone_id');
    const invId = randomUUID();
    await query(
      `INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, container_id) VALUES ($1,$2,$3,1,1.0,$4)`,
      [invId, player.id, ITEM, FURN]
    );
    const rowFor = async () => (await query(
      `SELECT pi.id, pi.custom_data, pi.container_id, i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.id=$1`,
      [invId]
    )).rows[0];

    let row = await rowFor();
    check('a fresh perishable has no checkpoint until first evaluated', !row.custom_data?.freshness, row.custom_data);

    // Two calls back-to-back on the SAME in-memory row (no DB re-fetch between
    // them, to keep the elapsed real time between checkpoints negligible) —
    // ensureFreshnessCurrent mutates row.custom_data in place when it writes.
    await ensureFreshnessCurrent(row, player);
    const firstCheckpointAt = row.custom_data?.freshness?.checkpointAt;
    check('first evaluation writes a checkpoint', !!firstCheckpointAt, row.custom_data);

    await ensureFreshnessCurrent(row, player);
    check("a second immediate call with no elapsed time doesn't rewrite the in-memory checkpoint", row.custom_data?.freshness?.checkpointAt === firstCheckpointAt, row.custom_data);

    row = await rowFor();
    check('the DB reflects only the first write, not a second', row.custom_data?.freshness?.checkpointAt === firstCheckpointAt, row.custom_data);

    await query('DELETE FROM player_inventory WHERE id=$1', [invId]);

    // ── The clock starts at the MINT, not at the first look ────────────────
    //
    // The whole point of the created_at column. Before it, the seed stamped
    // checkpointAt = now on first evaluation, so a perishable nobody had ever
    // examined was immortal: a steak could sit on an apartment floor for a
    // month and still read "fresh" the moment somebody finally looked at it.
    //
    // Deliberately projected WITHOUT pi.created_at (rowFor doesn't select it),
    // so this also exercises mintedAtOf's fallback SELECT — the path every call
    // site that hasn't been taught the column takes.
    const agedId = randomUUID();
    const AGED_HOURS = 120;
    await query(
      `INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, container_id, created_at)
       VALUES ($1,$2,$3,1,1.0,$4, now() - ($5 || ' hours')::interval)`,
      [agedId, player.id, ITEM, FURN, String(AGED_HOURS)]
    );
    const agedRow = (await query(
      `SELECT pi.id, pi.custom_data, pi.container_id, i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.id=$1`,
      [agedId]
    )).rows[0];
    check('an unexamined perishable carries no checkpoint however old it is', !agedRow.custom_data?.freshness, agedRow.custom_data);

    const aged = await ensureFreshnessCurrent(agedRow, player);
    // The box is refrigerated and draws no power, so the tier is deterministic
    // here — no dependence on live zone temperature.
    const expectedAged = 100 - AGED_HOURS * BASE_DECAY_PER_HOUR * TIER_FACTOR.refrigerated;
    check('first look charges the whole span since the row was minted', Math.abs(aged.value - expectedAged) < 0.5, { got: aged.value, expected: expectedAged });
    check('an item minted five days ago does not read fresh', aged.state !== 'fresh', aged);

    // Back-compat: a row that predates the column reads NULL and starts its
    // clock now, so nothing already in somebody's pack rots at deploy.
    const legacyId = randomUUID();
    await query(
      `INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, container_id, created_at)
       VALUES ($1,$2,$3,1,1.0,$4,NULL)`,
      [legacyId, player.id, ITEM, FURN]
    );
    const legacyRow = (await query(
      `SELECT pi.id, pi.custom_data, pi.container_id, i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.id=$1`,
      [legacyId]
    )).rows[0];
    const legacy = await ensureFreshnessCurrent(legacyRow, player);
    check('a row predating created_at falls back to now rather than rotting at deploy', legacy.value === 100 && legacy.state === 'fresh', legacy);

    // A caller whose own projection carried the column must get the same answer
    // as one that made mintedAtOf go and read it — otherwise the fallback and
    // the fast path are two different clocks.
    const carriedId = randomUUID();
    await query(
      `INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, container_id, created_at)
       VALUES ($1,$2,$3,1,1.0,$4, now() - ($5 || ' hours')::interval)`,
      [carriedId, player.id, ITEM, FURN, String(AGED_HOURS)]
    );
    const carriedRow = (await query(
      `SELECT pi.id, pi.custom_data, pi.container_id, pi.created_at, i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.id=$1`,
      [carriedId]
    )).rows[0];
    const carried = await ensureFreshnessCurrent(carriedRow, player);
    check('a projection carrying created_at agrees with the fallback read', Math.abs(carried.value - aged.value) < 0.5, { carried: carried.value, fallback: aged.value });

    await query('DELETE FROM player_inventory WHERE id = ANY($1::text[])', [[agedId, legacyId, carriedId]]);
  } finally {
    await query('DELETE FROM player_inventory WHERE item_id=$1', [ITEM]).catch(() => {});
    await query('DELETE FROM items WHERE id=$1', [ITEM]).catch(() => {});
    deleteItemCache(ITEM);
    await deleteFurniture(FURN).catch(() => {});
  }
}
