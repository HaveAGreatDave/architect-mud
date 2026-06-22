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

const CADENCE_MS = {
  '10s':  10_000,
  '30s':  30_000,
  '45s':  45_000,
  '1m':   60_000,
  '5m':   5 * 60_000,
  '30m':  30 * 60_000,
  '24h':  24 * 60 * 60_000,
};

// cadenceName -> { timer, callbacks: [] }
const cadences = new Map();

export function schedule(cadence, callback) {
  const ms = CADENCE_MS[cadence];
  if (!ms) throw new Error(`Unknown scheduler cadence: "${cadence}". Valid: ${Object.keys(CADENCE_MS).join(', ')}`);

  if (!cadences.has(cadence)) {
    const entry = { timer: null, callbacks: [] };
    entry.timer = setInterval(() => {
      for (const cb of entry.callbacks) {
        Promise.resolve(cb()).catch(err =>
          console.error(`Scheduler [${cadence}] callback error: ${err.message}`)
        );
      }
    }, ms);
    cadences.set(cadence, entry);
  }
  cadences.get(cadence).callbacks.push(callback);
}

export function stopAll() {
  for (const { timer } of cadences.values()) clearInterval(timer);
  cadences.clear();
}
