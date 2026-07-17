// server/engine/scheduler.js
//
// Unified interval scheduler. Replaces the independent setInterval calls
// scattered across gameLoop.js and environment.js with a single source of
// truth. Named cadences mean multiple modules can share an interval without
// each spinning their own timer, and plugins can subscribe to any cadence
// with registerScheduledTask() instead of managing their own setIntervals.
//
// Usage:
//   import { schedule } from './scheduler.js';
//   schedule('1m', myCallback);           // fires every 60 s
//   schedule('30m', environmentCallback); // fires every 30 min
//
// The 1-second combat tick is intentionally NOT routed through this module —
// it's hot-path, per-enemy, latency-critical, and benefits from a raw
// setInterval with no dispatch overhead.
//
// Idle-gating (why this module owns the gate, not each callback): a clock-driven
// tick that awaits query() on an empty world keeps a pool connection alive inside
// its idle window, which stops Neon's compute from ever suspending (scale-to-zero)
// — the whole server bills 24/7 for nobody. So every scheduled task is gated on
// hasActivePlayers() BY DEFAULT: the callback simply doesn't fire when the world
// is empty. A task that genuinely must run on an empty server (e.g. a settlement
// sweep) opts out explicitly with { runWhenEmpty: true }. This inverts the old
// convention — authors used to have to REMEMBER to type the guard, and one
// forgotten guard (surveillance's camera refresh) pinned the compute awake. Now
// forgetting is safe; running-while-empty is the deliberate act.

import { hasActivePlayers } from './world.js';

const CADENCE_MS = {
  '4s':   4_000,
  '5s':   5_000,
  '6s':   6_000,
  '10s':  10_000,
  '15s':  15_000,
  '30s':  30_000,
  '45s':  45_000,
  '1m':   60_000,
  '5m':   5 * 60_000,
  '10m':  10 * 60_000,
  '30m':  30 * 60_000,
  '1h':   60 * 60_000,
  '24h':  24 * 60 * 60_000,
};


// cadenceName -> { timer, callbacks: [] }
const cadences = new Map();

export function schedule(cadence, callback, opts = {}) {
  const ms = CADENCE_MS[cadence];
  if (!ms) throw new Error(`Unknown scheduler cadence: "${cadence}". Valid: ${Object.keys(CADENCE_MS).join(', ')}`);

  // Idle-gate by default. runWhenEmpty:true is the deliberate opt-out for the
  // rare task that must fire on an empty server (see module header).
  const gated = opts.runWhenEmpty
    ? callback
    : () => (hasActivePlayers() ? callback() : undefined);
  // Tag the wrapper so unschedule() can still be called with the original fn.
  if (gated !== callback) gated.__original = callback;

  if (!cadences.has(cadence)) {
    const entry = { timer: null, callbacks: [] };
    const fire = () => {
      entry.callbacks.forEach((cb, i) => {
        // Spread same-cadence subscribers ~200 ms apart: a dozen '1m' ticks all
        // checking out DB connections in the same instant could hold every pool
        // slot while a player command waited on pool.connect().
        setTimeout(() => {
          Promise.resolve(cb()).catch(err =>
            console.error(`Scheduler [${cadence}] callback error: ${err.message}`)
          );
        }, i * 200);
      });
    };
    // Random phase per cadence: every cadence used to start at boot, so their
    // boundaries aligned (each minute fired the '1m' + '30s' + '15s' + '5s'
    // convoys together). The interval spacing is unchanged — only the phase
    // shifts. Capped at 60 s so a long cadence ('24h') isn't deferred by up to
    // a full period on boot; a minute of decorrelation is all the pool needs.
    entry.timer = setTimeout(() => {
      fire();
      entry.timer = setInterval(fire, ms);
    }, Math.floor(Math.random() * Math.min(ms, 60_000)));
    cadences.set(cadence, entry);
  }
  cadences.get(cadence).callbacks.push(gated);
}

// Remove a previously scheduled callback (e.g. a plugin tearing down).
// The shared interval keeps running for the cadence's other subscribers.
export function unschedule(cadence, callback) {
  const entry = cadences.get(cadence);
  if (!entry) return false;
  const idx = entry.callbacks.findIndex(cb => cb === callback || cb.__original === callback);
  if (idx === -1) return false;
  entry.callbacks.splice(idx, 1);
  return true;
}

export function stopAll() {
  for (const { timer } of cadences.values()) clearInterval(timer);
  cadences.clear();
}
