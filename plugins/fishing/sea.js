// THE SEA AS THE SEAT SEES IT: what a boat's client needs to draw the same fish the server rolls.
//
// fish.js is pure: given the place, the moment, the weather and the land, it gives the same schools
// on the server and in every browser. So the server sends the moment and the land, never the fish.
// Four things, worked out here once and sent on the boat's own `boat_ctx` (the anchor push, the
// boarding context and the window recentre) and on the reel's `open`:
//
//   serverNow  the server's clock; the seat keeps skew = serverNow - Date.now() and runs fish.js on
//              Date.now() + skew, because a school cruising at a metre a second puts a shadow three
//              metres off for a clock three seconds out.
//   env        fish.js's { hour, doy, weather, rough }, a snapshot. The reel's `open` takes a fresh
//              one and the server bites on that, so the seat swaps to it while the reel is open.
//   thinned    { schoolId: taken } for every school fished down in the last game day. RAM only.
//   land       a bitmask of land round the point, from the server's own isLand. ⚠ THE SEAT'S MAP
//              WINDOW IS NOT ENOUGH. A school's habitat asks how far the nearest shore is, out to
//              48 tiles, and the seat only holds 33 tiles round where the window last centred. With
//              the window alone one school in a dozen came out a different species or depth on the
//              client (measured over 161 points of the Coldwater water, 2026-11-03); with this mask
//              none did. 65 x 65 tiles is 529 bytes.
//
// Both plugins use this: fishing/boat.js for the reel, and powerboat/anchor.js and helm.js for the
// pushes. ⚠ IT IMPORTS NOTHING FROM powerboat. anchor.js imports this file, and boat.js imports
// anchor.js, so a powerboat import here would be a cycle. The land test is handed in.

import { getEnvironmentState } from '../../server/engine/environment.js';
import { landMask } from '../../client/shared/fish.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const r2 = (v) => Math.round(v * 100) / 100;

// ── THE MOMENT AT SEA ─────────────────────────────────────────────────────────
export function dayOfYear(date) {
  const d = date ? new Date(`${date}T00:00:00Z`) : null;
  if (!d || Number.isNaN(d.getTime())) return 100;
  return Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1;
}
/** fish.js's env from the engine's clock and weather. RAM only. */
export function seaEnv() {
  let e = {};
  try { e = getEnvironmentState() || {}; } catch { /* no clock yet */ }
  const hour = e.minutes != null ? e.minutes / 60 : (e.hour ?? 12);
  const wind = Number(e.windKph) || 0;
  return {
    hour: r2(hour), doy: dayOfYear(e.date),
    weather: String(e.currentWeatherType || e.weatherType || 'clear'),
    rough: r2(clamp((wind - 15) / 45, 0, 1)),
  };
}

// ── THE TAKE ──────────────────────────────────────────────────────────────────
// What's been landed from each school, as landing times. A fish comes back a game day after it was
// taken, so nothing needs sweeping: the count is the times still inside the day. RAM only, so a
// restart refills the sea.
export const taken = new Map();     // school id -> [ms, …]
export function gameDayMs() {
  let ts = 1;
  try { ts = Number(getEnvironmentState()?.timeScale) || 1; } catch { /* default */ }
  return 86_400_000 / ts;
}
export function thinnedNow(t) {
  const day = gameDayMs(), res = {};
  for (const [id, list] of taken) {
    const keep = list.filter((at) => t - at < day);
    if (keep.length) { taken.set(id, keep); res[id] = keep.length; } else taken.delete(id);
  }
  return res;
}
export function takeFrom(schoolId, t) {
  const list = taken.get(schoolId) || [];
  list.push(t);
  taken.set(schoolId, list);
}

// ── THE LAND ──────────────────────────────────────────────────────────────────
// fish.js `landMask`, so the encoding and the seat's decoding (`maskedLand`) are one file.

/** Everything the seat needs to run fish.js on the server's terms, for a boat at (x, y). */
export function seaContext(x, y, isLand, t = Date.now()) {
  return { serverNow: t, env: seaEnv(), thinned: thinnedNow(t), land: landMask(x, y, isLand) };
}
