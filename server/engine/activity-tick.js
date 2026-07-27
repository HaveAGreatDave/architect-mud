// server/engine/activity-tick.js
//
// One 1-second sweep for every posture-driven player activity.
//
// Six plugins (scavenging, mining, fishing, butchering, weightbench, work) had
// each grown the identical tick: register schedule('1s', …), guard reentrancy,
// walk getAllLivePlayers(), and act on the players whose posture matches. Six
// timers, six full sweeps of the same list every second, to serve the handful of
// players actually doing something. The sixfold duplication also meant the
// scheduler's same-cadence stagger had to spread six callbacks across a period
// only one second long.
//
// This collapses them into a single sweep with a registry. Two properties of the
// old arrangement are deliberately preserved, because losing either would be a
// behaviour change:
//
//   * Per-activity reentrancy, not global. Each activity keeps its own busy
//     flag, so a slow scavenge resolution skips the next scavenge tick without
//     also freezing mining.
//   * Concurrency ACROSS activities, but strictly sequential WITHIN one. The six
//     old timers overlapped each other, so scavenging and mining ran at the same
//     time — that is preserved. But each timer walked its own player list with an
//     await per player, so two players doing the SAME activity were serialized,
//     and that is preserved too. It is not a stylistic detail: the per-zone loot
//     tables do a read-modify-write (load stock → compute lazy replenish in JS →
//     write absolute quantities back). Two players scavenging one zone
//     concurrently would both read the same last_replenish, both apply the same
//     catch-up, and both write it — silently duplicating stock. The per-item
//     decrement is atomically guarded (`current_qty>0`, "raced dry"); the
//     replenish path is not.
//
// What a plugin registers:
//   registerActivity({
//     posture:   'scavenging',        // the posture that means "doing this"
//     stateKey:  'scavengeState',     // the per-player state field on the live player
//     onTick:    async (player, st, nowMs) => {…},   // called while the posture holds
//     onAbandon: (player, st) => {…},  // posture cleared out from under us
//   })
//
// onTick owns its own pacing (its ATTEMPT_MS / setMs / countdown check). This
// module deliberately does NOT impose a shared cadence gate — the activities
// genuinely differ, and hiding their timing here would put the pacing rule far
// away from the code that reads it.
//
// onAbandon fires when the player has state but no longer holds the posture —
// they moved, stood, got hit, died. It is the plugin's cleanup + "You stop
// scavenging." message. It is called at most once, because it is expected to
// clear the state key.

import { schedule } from './scheduler.js';
import { getAllLivePlayers } from './world.js';

// posture -> { posture, stateKey, onTick, onAbandon, busy }
const activities = new Map();

export function registerActivity({ posture, stateKey, onTick, onAbandon }) {
  if (!posture || !stateKey) throw new Error('registerActivity needs a posture and a stateKey');
  if (activities.has(posture)) throw new Error(`Activity posture "${posture}" is already registered`);
  activities.set(posture, { posture, stateKey, onTick, onAbandon, busy: false });
}

// Exposed for regress: the sweep is otherwise only reachable via the scheduler.
export async function runActivityTick(nowMs = Date.now()) {
  if (!activities.size) return;

  // Collect first, dispatch second. Collecting synchronously means the player
  // list is walked exactly once and is not being awaited across — a player who
  // logs out mid-sweep can't be half-processed.
  // act -> [{ player, st }, …], so each activity's players stay in one ordered
  // queue that is walked sequentially below.
  const due = new Map();
  for (const player of getAllLivePlayers()) {
    for (const act of activities.values()) {
      const st = player[act.stateKey];
      if (player.posture === act.posture) {
        if (!st || act.busy) continue;
        if (!due.has(act)) due.set(act, []);
        due.get(act).push({ player, st });
      } else if (st) {
        // Abandonment is synchronous cleanup — run it inline rather than
        // deferring it, so the state is gone before anything else looks at it.
        try {
          act.onAbandon?.(player, st);
        } catch (err) {
          console.error(`[activity:${act.posture}] abandon error: ${err.message}`);
        }
      }
    }
  }
  if (!due.size) return;

  // One queue per activity, queues run concurrently, each queue runs in order.
  // That is exactly the shape the six separate timers had.
  for (const act of due.keys()) act.busy = true;
  try {
    await Promise.allSettled([...due.entries()].map(async ([act, queue]) => {
      for (const { player, st } of queue) {
        // A player can stop mid-queue — the player ahead of them in this same
        // queue may have interrupted them (a cave-in, a fight). Re-check rather
        // than acting on a snapshot taken before the awaits started, and take
        // the abandon branch in THIS sweep, as the old per-plugin loops did
        // (they re-read posture per player, after the previous player's await).
        if (!player[act.stateKey]) continue;
        if (player.posture !== act.posture) {
          try { act.onAbandon?.(player, player[act.stateKey]); }
          catch (err) { console.error(`[activity:${act.posture}] abandon error: ${err.message}`); }
          continue;
        }
        try {
          await act.onTick?.(player, st, nowMs);
        } catch (err) {
          console.error(`[activity:${act.posture}] tick error: ${err.message}`);
        }
      }
    }));
  } finally {
    for (const act of due.keys()) act.busy = false;
  }
}

schedule('1s', () => runActivityTick().catch(err =>
  console.error(`[activity-tick] sweep error: ${err.message}`)
));
