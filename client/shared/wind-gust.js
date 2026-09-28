// GUSTS: HOW THE WIND VARIES FROM SECOND TO SECOND.
//
// The server says how hard it is blowing on a tile (getZoneWindKph in environment.js): the day's
// wind, raised under a storm cell. That is a MEAN. Real wind is never steady: it comes in gusts that
// run a third to a half above the mean for a few seconds, then lulls, and the direction wanders a few
// degrees either side as it does. Without that, a windsock hangs at one angle all afternoon and a
// flag holds one pose, which reads as a picture of wind rather than wind.
//
// ⚠ IT IS A PURE FUNCTION OF THE WALL CLOCK, the same rule the sea runs on. Two players looking at one
// windsock see it lift in the same gust, and a pilot and a driver on one airfield agree about when
// the wind picked up. A per-client random walk would be cheaper to write and would put every client
// in a different gust.
//
// ⚠ THE MEAN IS PRESERVED. The terms are zero-mean sines, so averaged over a minute the multiplier is
// 1 and nothing that integrates wind over time (the sea state reservoir, drift) moves on average.
//
// ⚠ GUSTINESS SCALES WITH THE WEATHER, not with the speed. A steady trade wind at 20 kt is smooth; a
// squall at the same mean is violent. `storm` is 0..1 and a clear day still gusts a little.
//
// The periods are incommensurate (no two share a factor), so the pattern does not visibly repeat.
const TAU = Math.PI * 2;
export const GUST_CALM = 0.12;    // peak share above the mean on a quiet day
export const GUST_STORM = 0.45;   // …and in a squall
export const VEER_CALM = 6;       // degrees the direction wanders on a quiet day
export const VEER_STORM = 22;     // …and in a squall

function phaseSeconds(nowMs) {
  // Wrapped so the sines stay precise however large Date.now() is.
  return (nowMs / 1000) % 86400;
}

// Speed multiplier, mean 1. `nowMs` is WALL-clock milliseconds (Date.now()).
export function windGust(nowMs, storm = 0) {
  const t = phaseSeconds(nowMs);
  const s = Math.max(0, Math.min(1, storm));
  const a = GUST_CALM + (GUST_STORM - GUST_CALM) * s;
  // A slow swell, a gust of a few seconds, and a short flutter, weighted to sum to 1 at their peak.
  const g = 0.55 * Math.sin(t * TAU / 29.3 + 1.3)
          + 0.30 * Math.sin(t * TAU / 11.7 + 0.4)
          + 0.15 * Math.sin(t * TAU / 4.3 + 2.1);
  return Math.max(0.2, 1 + a * g);
}

// Degrees to add to the mean direction. Zero-mean, and slower than the gusts: wind veers over tens of
// seconds, and a direction that twitched as fast as the speed would read as a broken instrument.
export function windVeer(nowMs, storm = 0) {
  const t = phaseSeconds(nowMs);
  const s = Math.max(0, Math.min(1, storm));
  const a = VEER_CALM + (VEER_STORM - VEER_CALM) * s;
  return a * (0.7 * Math.sin(t * TAU / 47.1 + 0.8) + 0.3 * Math.sin(t * TAU / 17.9 + 2.6));
}

// How stormy a sky token is, for the two functions above. The tokens are the renderer's own words.
const STORMINESS = { clear: 0, haze: 0, fog: 0, cloudy: 0.15, overcast: 0.2, rain: 0.45, snow: 0.35, sleet: 0.45, storm: 1, thunderstorm: 1, blizzard: 1 };
export function stormOf(weather) {
  return STORMINESS[String(weather || 'clear').toLowerCase()] ?? 0.2;
}
