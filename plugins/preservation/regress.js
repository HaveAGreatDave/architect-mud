// Preservation plugin regression — pure decay math (no DB/zone dependency)
// plus an integration check that untouched items never get a second write.
import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { reloadItem, deleteItemCache } from '../../server/engine/items-cache.js';
import { computeCheckpoint, resolveEnvironment, ensureFreshnessCurrent } from './decay.js';
import { TIER_FACTOR, BASE_DECAY_PER_HOUR, POWER_LOSS_BUFFER_MIN, STATE_CUTOFFS, stateFor } from './config.js';

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
  try {
    await query(
      `INSERT INTO items (id,name,description,type,value,weight,tags) VALUES ($1,'test perishable','test perishable','consumable',1,10,$2)
       ON CONFLICT (id) DO UPDATE SET tags=$2`,
      [ITEM, JSON.stringify({ consumable: true, perishable: true, spoil_rate: 'normal', restore_hunger: 5 })]
    );
    await reloadItem(ITEM);
    const invId = randomUUID();
    await query(
      `INSERT INTO player_inventory (id, player_id, item_id, quantity, condition) VALUES ($1,$2,$3,1,1.0)`,
      [invId, player.id, ITEM]
    );
    const rowFor = async () => (await query(
      `SELECT pi.id, pi.custom_data, pi.container_id, i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.id=$1`,
      [invId]
    )).rows[0];

    let row = await rowFor();
    check('a fresh perishable has no checkpoint until first evaluated', !row.custom_data?.freshness, row.custom_data);

    await ensureFreshnessCurrent(row, player);
    row = await rowFor();
    const firstCheckpointAt = row.custom_data?.freshness?.checkpointAt;
    check('first evaluation writes a checkpoint', !!firstCheckpointAt, row.custom_data);

    await ensureFreshnessCurrent(row, player);
    row = await rowFor();
    check('a second immediate call with no elapsed time does not rewrite the checkpoint', row.custom_data?.freshness?.checkpointAt === firstCheckpointAt, row.custom_data);

    await query('DELETE FROM player_inventory WHERE id=$1', [invId]);
  } finally {
    await query('DELETE FROM player_inventory WHERE item_id=$1', [ITEM]).catch(() => {});
    await query('DELETE FROM items WHERE id=$1', [ITEM]).catch(() => {});
    deleteItemCache(ITEM);
  }
}
