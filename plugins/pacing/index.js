/**
 * pacing — stamina-gated movement pacing (walk cadence + sprint burst), with a
 * per-player MOVE QUEUE so a too-fast step is deferred, not rejected.
 *
 * The map is large but instant to cross, which makes it feel small. This plugin
 * paces travel in two layers, attaching at the movement seams (a move gate + the
 * `zone.entered` event) rather than editing cmdMove:
 *
 *   1. WALK CADENCE — every step has a short cooldown (WALK_COOLDOWN_MS). Tuned so
 *      normal room-reading pace never trips it, but spamming a direction is paced.
 *      Walking is free (no stamina) and never hard-blocked. Roads (and marked
 *      arteries) halve the cooldown (ROAD_SPEEDUP) so travel along the street grid
 *      is ×2 — the same road grid the GPS router hugs. Water is impassable, handled
 *      upstream by the engine:water move gate.
 *   2. RUN — `player.running` (the `run` command / minimap Run toggle, owned by the
 *      gps plugin, which also charges its own per-step stamina toll in movement.js)
 *      shortens the cadence to RUN_COOLDOWN_MS. This is the SAME speed the client's
 *      GPS auto-walker paces itself at while running, so the server no longer queues
 *      its steps out from under it — walk < run < sprint is one shared clock.
 *   3. SPRINT — `sprint on` moves faster still (SPRINT_COOLDOWN_MS) by spending
 *      SPRINT_COST stamina per step. Drop below SPRINT_FLOOR and you're WINDED:
 *      sprint auto-drops and can't be re-enabled until stamina recovers to
 *      WINDED_RECOVER (hysteresis, so it can't flicker at the floor).
 *
 * THE QUEUE: when a step arrives before the cadence elapses, the gate doesn't
 * reject it — it enqueues {direction, opts} (up to MAX_QUEUE) and returns a SILENT
 * block (cmdMove yields no error line). A self-scheduling drain replays each queued
 * move through cmdMove exactly when the cooldown clears, pushing the result to the
 * player's own socket via sendToPlayer. So you can type `n n n e` and be walked
 * along at cadence instead of eating a wall of "catch your breath" errors.
 *
 * System-driven relocations (shove, .gohome, follower drags) pass
 * opts.bypassEncumbrance and are exempt from queueing and the sprint spend.
 *
 * The gate is side-effecting (it enqueues/schedules) — permitted, and consistent
 * with govgate (which sets heat + dispatches arrests from its gate). See the
 * `silent` contract note in server/engine/movement-gates.js.
 *
 * Transient player state (in-memory, like player.posture — never persisted):
 *   player._lastStepAt  — epoch ms of the last committed step (cadence clock)
 *   player._sprinting   — sprint toggle
 *   player._winded      — true after auto-drop; blocks re-enable until WINDED_RECOVER
 *   player._moveQueue   — pending [{direction, opts}] steps
 *   player._moveTimer   — the scheduled drain timeout handle (or null)
 */
import { registerMoveGate } from '../../server/engine/movement-gates.js';
import { on } from '../../server/engine/events.js';
import { sendToPlayer, getBroadcast } from '../../server/engine/messaging.js';
import { getLivePlayer, getZone } from '../../server/engine/world.js';
import { cmdMove } from '../../server/engine/commands/movement.js';

const WALK_COOLDOWN_MS   = 900;   // spam throttle; normal reading pace never hits it
const RUN_COOLDOWN_MS    = 700;   // player.running cadence — must stay under the client's
                                  // on-road run send-rate (minimap.js RUN_STEP_MS ÷ road
                                  // speedup) so running auto-walk steps never get queued
const SPRINT_COOLDOWN_MS = 350;   // burst cadence while sprinting
const SPRINT_COST        = 8;     // stamina per sprint step
const SPRINT_FLOOR       = 15;    // sprint auto-drops when stamina falls below this
const WINDED_RECOVER     = 40;    // stamina needed to sprint again after being winded
const MAX_QUEUE          = 12;    // how many steps you can bank ahead
const ROAD_SPEEDUP       = 2;     // roads move you ×2 — half the step cooldown

function staminaOf(player) {
  return player.stamina ?? (player.stamina_max ?? 100);
}

// Terrain movement multiplier for a tile: roads (and marked arteries) carry you
// ×ROAD_SPEEDUP, everything walkable else ×1. Same "this is a road" test the router
// uses (pathfinding.isRoadZone), so the street grid the GPS hugs is the street grid
// you move fast on. Water isn't handled here — it's impassable (engine:water gate).
function roadSpeedFactor(zone) {
  const f = zone?.flags || {};
  const isRoad = /^(road_|runway_)/.test(f.icon || '') || !!f.artery;
  return isRoad ? ROAD_SPEEDUP : 1;
}

// Run only earns the faster cadence while you can still pay the per-step toll. Empty
// the tank and movement.js walks the step for free — so we drop back to walk pace too,
// mirroring the client's autoWalkDelay (minimap.js) so both authorities agree.
const RUN_STEP_STAMINA = 4;   // must match movement.js RUN_STEP_STAMINA

function cadenceMs(player) {
  // walk < run < sprint. Sprint wins if both flags are set (it's the faster gear).
  const canRun = player.running && staminaOf(player) >= RUN_STEP_STAMINA;
  const base = player._sprinting ? SPRINT_COOLDOWN_MS
    : canRun ? RUN_COOLDOWN_MS
    : WALK_COOLDOWN_MS;
  return Math.round(base / roadSpeedFactor(getZone(player.current_zone)));
}

function nextReadyAt(player) {
  return (player._lastStepAt || 0) + cadenceMs(player);
}

// --- The drain: replay queued steps at cadence, pushing each result to the player ---
function scheduleDrain(player) {
  if (player._moveTimer) return;                      // already armed
  const wait = Math.max(0, nextReadyAt(player) - Date.now());
  player._moveTimer = setTimeout(() => { drainOne(player).catch(() => {}); }, wait);
}

// A queued step is intent about ONE room: "from where I am now, go north." The
// queue is only still valid if the player is where the last step left them. Any
// other way of arriving somewhere — waking out of a dream, a jail booking, a
// respawn, an admin teleport — makes every remaining step a walk somebody never
// asked for, in a room they were not standing in when they asked.
function dropQueue(player) {
  player._moveQueue = [];
  player._moveQueueZone = null;
}

async function drainOne(player) {
  player._moveTimer = null;
  if (!player._moveQueue?.length) return;
  // Drop the queue if the player is gone or downed — never sleepwalk a corpse.
  if (getLivePlayer(player.id) !== player || (player.hp ?? 1) <= 0) { dropQueue(player); return; }
  // …and never sleepwalk a SLEEPER. A mind that is not in the room does not get to
  // walk it: queue steps, lie down (or get pulled into a dreamscape) and these
  // would have marched the body out of its own bed.
  if (player.sleeping || player._dissociating) { dropQueue(player); return; }
  // Displaced since the queue was built — see dropQueue. The dream case is the one
  // that motivated this: walk a dreamscape, `wake` before the timer fires, and the
  // steps you took in the dream came true in the waking room.
  if (player._moveQueueZone && player.current_zone !== player._moveQueueZone) { dropQueue(player); return; }

  const wait = nextReadyAt(player) - Date.now();
  if (wait > 0) { player._moveTimer = setTimeout(() => { drainOne(player).catch(() => {}); }, wait); return; }

  const next = player._moveQueue.shift();
  // _pacingDrain tells the gate this step's turn has already come — skip the queue check.
  const opts = { ...(next.opts || {}), _pacingDrain: true };
  let result = null;
  try { result = await cmdMove(next.direction, player, getBroadcast(), opts); } catch { /* swallow */ }
  if (result) sendToPlayer(player.id, result);
  // A wall (locked door, encumbered, no exit) ends the run — drop the rest.
  if (result?.type === 'error') { dropQueue(player); return; }
  // Wherever that step landed us is where the NEXT one is expected to start from.
  player._moveQueueZone = player.current_zone;
  if (player._moveQueue.length) scheduleDrain(player);
  else player._moveQueueZone = null;
}

// --- Layer 1: walk cadence — queue a too-fast step instead of rejecting it ---
export function cadenceGate({ player, direction, opts }) {
  if (opts?.bypassEncumbrance) return;                // system move — never paced
  if (opts?._pacingDrain) return;                     // a drained step — its turn has come
  if (Date.now() >= nextReadyAt(player)) return;      // cadence elapsed — go now

  player._moveQueue = player._moveQueue || [];
  if (player._moveQueue.length >= MAX_QUEUE) {
    return { block: true, message: `You're moving as fast as your legs will carry you. (${MAX_QUEUE} steps already queued)` };
  }
  // Stamp the room this queue belongs to as it opens, so the drain can tell
  // "I walked here" from "something moved me".
  if (!player._moveQueue.length) player._moveQueueZone = player.current_zone;
  player._moveQueue.push({ direction, opts: opts ? { ...opts } : {} });
  scheduleDrain(player);
  return { block: true, silent: true };               // deferred — no error line now
}
registerMoveGate(cadenceGate, 'pacing:cadence');

// --- Layer 2: spend + winded transition + HUD push, after a step commits ---
// Gates can't broadcast; the committed move fires zone.entered, so the stamina
// spend, the cadence-clock stamp, and the sta HUD push live here.
on('zone.entered', async ({ actor: player, opts }) => {
  if (!player || opts?.bypassEncumbrance) return;     // system move — no stamp, no spend
  player._lastStepAt = Date.now();
  if (!player._sprinting) return;                     // walking is free

  const before = staminaOf(player);
  player.stamina = Math.max(0, before - SPRINT_COST);
  const messages = [];
  if (player.stamina < SPRINT_FLOOR) {
    player._sprinting = false;
    player._winded = true;
    messages.push('Your lungs are burning — you drop back to a walk, chest heaving.');
  }
  sendToPlayer(player.id, { type: 'resource_tick', messages, player_update: { stamina: player.stamina } });
  // Stamina is CHECKPOINT-tier, not write-through (see cmdMove in
  // engine/commands/movement.js): live value is authoritative in RAM, and
  // flushDirtyPositions already persists `stamina` alongside `current_zone` in
  // one batched UPDATE for every dirty player. Writing it here too was both a
  // round trip on the hottest path in the game AND redundant with that flush —
  // marking dirty is all this needs to do.
  player._posDirty = true;
});

// --- The sprint toggle ---
async function sprint(args, raw, player) {
  if (!player) return { type: 'error', message: 'No character.' };
  const arg = String(args || '').trim().toLowerCase();
  const wantOn = arg === 'on' ? true : arg === 'off' ? false : !player._sprinting;

  if (!wantOn) {
    player._sprinting = false;
    return { type: 'output', message: 'You ease back down to a walk.' };
  }

  const sta = staminaOf(player);
  if (player._winded) {
    if (sta < WINDED_RECOVER) {
      return { type: 'error', message: `You're still winded — catch your breath first. (need ${WINDED_RECOVER} stamina, have ${sta})` };
    }
    player._winded = false;
  }
  if (sta < SPRINT_FLOOR) {
    return { type: 'error', message: "You're too exhausted to break into a sprint." };
  }
  player._sprinting = true;
  return { type: 'output', message: 'You break into a sprint, pushing the pace.' };
}

export const commands = { sprint };

export const _test = {
  WALK_COOLDOWN_MS, SPRINT_COOLDOWN_MS, SPRINT_COST, SPRINT_FLOOR, WINDED_RECOVER, MAX_QUEUE,
  ROAD_SPEEDUP, roadSpeedFactor, drainOne,
  // Cancel any armed drain + clear the queue (regress hygiene — no real timers left running).
  cancelQueue(player) {
    if (player._moveTimer) { clearTimeout(player._moveTimer); player._moveTimer = null; }
    player._moveQueue = [];
    player._moveQueueZone = null;
  },
};
