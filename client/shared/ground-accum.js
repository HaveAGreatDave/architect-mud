// GROUND ACCUMULATION — how wet the street is, how much water is standing in it, and how deep the
// snow lies. Three quantities on three clocks, integrated from the live precipitation.
//
// ⚠ THIS FILE EXISTS BECAUSE TWO PROCESSES HAVE TO AGREE ABOUT IT. The renderer integrates it at
// 60 fps from the weather it can see out of the window; the server integrates the same thing from
// the day's own precipitation so a player who logs in ten minutes into a blizzard is handed the
// snow that is already lying rather than starting at zero and watching it arrive. Two copies of
// four time constants and one classification is four chances to disagree about what the ground
// looks like, and the disagreement would be invisible to both of them.
//
// ⚠ AND THE STEPS ARE EXACT RATHER THAN EULER, WHICH IS WHAT MAKES THAT AGREEMENT POSSIBLE. A
// linear reservoir dP/dt = a − P/τ has a closed form, so one 30-minute step and a hundred thousand
// 16 ms steps land on the same number. Written as `P += dt * (a − P/τ)` they do not: the renderer
// would be right and the server's seed would be a few per cent adrift every time the sky changed.

// ── HOW WET THE SURFACE IS ────────────────────────────────────────────────────────────────────
//
// A FILM, and the odd one out: it is not a reservoir but a chase toward a target, fast on and slow
// off. Tarmac is wet within seconds of rain starting and stays wet a good while after it stops,
// and that asymmetry is most of what reads as water rather than as a weather flag.
export const WET_RISE_K = 0.8, WET_DRY_K = 0.06;   // 1/s

// ── HOW MUCH IS STANDING ──────────────────────────────────────────────────────────────────────
//
// Seconds of rain at full rate to fill, and the gullies' own time constant. Their RATIO is the
// level a sustained storm settles at (1.57, so a real storm saturates and a shower does not) and
// DRAIN is how long the street holds it afterwards.
export const POND_RISE_S = 70, POND_DRAIN_S = 110;

// ── HOW DEEP THE SNOW LIES ────────────────────────────────────────────────────────────────────
//
// The same reservoir on a much longer thaw. The ratio is the level a sustained fall settles at
// (3.5) and THAW is how long the city keeps it once the sky clears.
export const SNOW_LIE_S = 120, SNOW_THAW_S = 420;

// ⚠ AND RAIN TAKES IT AWAY FAR FASTER THAN STILL AIR DOES. `SNOW_THAW_S` is the clear-sky thaw and
// there was nothing else — so rain fell on lying snow for seven minutes and removed none of it,
// which is half of a report that read as "puddles gathering on the grass in the rain" and was in
// fact a snowfield nobody expected to still be there. A downpour divides the thaw by 1 + this, so
// 420 s becomes 70.
export const SNOW_RAIN_MELT = 5;

// ⚠ THE PRECIPITATION TYPES THAT LAND AS SNOW, AS ONE SET WITH THREE READERS — this file's own
// classification, the renderer's falling-precipitation draw, and the server's accumulator. They
// were two hand-written expressions and they disagreed: `drawWeather` counts sleet as snow and the
// accumulator did not, so sleet fell as white dots out of the window and wet the road underneath.
export const SNOW_PTYPES = new Set(['snow', 'blizzard', 'sleet']);

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * What is falling here, and how hard — asked ONCE, for both channels.
 *
 * ⚠ IT USED TO BE ASKED TWICE AND THE TWO ANSWERS COULD DISAGREE. The wet branch took the headline
 * word OR'd with a cell test that refused snow; the snow branch took the headline word OR'd with a
 * cell test that demanded it. Both headline terms were blind to the cell actually overhead, and the
 * renderer's own precipitation draw is not — it lets a local cell OVERRIDE the headline for what
 * the player sees falling. So a snow HEADLINE with a rain CELL over you drew rain streaks, wet the
 * road AND deepened the snow at full rate, all three at once.
 *
 * ⚠ THE LOCAL CELL DECIDES THE TYPE AND THE HEADLINE ONLY SUPPLIES A RATE IT CANNOT BEAT. The
 * renderer's `sampleWeatherCells` already floors the local rate at the day's own `precipFloor` and
 * names it `floorType`, so wherever the spatial field is plumbed the headline is ALREADY inside the
 * sample; the word is still needed for the case where it is not, which is its own recorded bug (the
 * road stayed dry through rain it was raining). Taking the larger of the two rates leaves every
 * existing figure exactly where it was — nothing gets weaker — and moves only the ATTRIBUTION.
 *
 * @param {string}  headline   the day's weather word ('rain' | 'storm' | 'snow' | anything else)
 * @param {?string} localType  the precipitation type of the cell overhead, or null for none
 * @param {number}  localRate  that cell's 0-1 intensity (0 when there is no field)
 * @returns {{ snow: number, wet: number, pond: number }} 0-1 rates, at most one of snow/wet non-zero
 */
export function fallRates(headline, localType = null, localRate = 0) {
  const headSnow = headline === 'snow';
  const headFall = headSnow || headline === 'rain' || headline === 'storm';
  const local = localType && localType !== 'none' && localRate > 0 ? localType : null;
  const isSnow = local ? SNOW_PTYPES.has(local) : headSnow;
  // 1.4 opens a cell's own intensity out to the rate this integrates against; a headline word
  // carries no number at all, so it counts as a full fall.
  const fall = clamp01(Math.max(headFall ? 1 : 0, localRate * 1.4));
  // ⚠ PONDING TAKES A SMALLER SHARE OF A BARE HEADLINE. Drizzle wets a road completely and ponds
  // none of it: what makes a puddle is the rate of fall, and a word does not carry one.
  const pond = clamp01(Math.max(headFall ? 0.55 : 0, localRate * 1.4));
  return isSnow
    ? { snow: fall, wet: 0, pond: 0 }
    : { snow: 0, wet: fall, pond };
}

/**
 * Step the three quantities forward by `dt` seconds at a constant rate.
 *
 * `g` is `{ wet, pond, snow, fell }` and is returned mutated, so a caller holding module-level
 * scalars and a caller holding a server-side object both get the same arithmetic.
 *
 * ⚠ `fell` IS NOT `snow`. The depth is a reservoir and it SETTLES — a sustained fall reaches its
 * steady state in a couple of minutes and then stops moving however long it goes on snowing — so it
 * answers "how deep is it" and cannot answer "is it filling in", which is the only question a wheel
 * rut has. This is the inflow alone, integrated and never reduced.
 */
export function stepGround(g, dt, rates) {
  if (!(dt > 0)) return g;
  // The film: already the exact solution of dW/dt = (target − W) · k, so it is dt-independent as it
  // stands and only the two reservoirs below needed rewriting.
  const k = 1 - Math.exp(-dt * (rates.wet > g.wet ? WET_RISE_K : WET_DRY_K));
  g.wet = clamp01(g.wet + (rates.wet - g.wet) * k);

  g.pond = reservoir(g.pond, dt, rates.pond / POND_RISE_S, POND_DRAIN_S);

  // ⚠ THE THAW SHORTENS UNDER RAIN — see SNOW_RAIN_MELT. It reads the wet rate rather than the
  // stored wetness, because what melts snow is water arriving on it, not a road that is still damp.
  const thaw = SNOW_THAW_S / (1 + SNOW_RAIN_MELT * rates.wet);
  g.snow = reservoir(g.snow, dt, rates.snow / SNOW_LIE_S, thaw);
  g.fell += dt * rates.snow / SNOW_LIE_S;
  return g;
}

// dP/dt = inflow − P/tau, solved rather than stepped. The steady state is inflow·tau and the
// approach to it is exponential, so this is exact for any dt at a constant inflow.
function reservoir(p, dt, inflow, tau) {
  const settle = inflow * tau;
  return clamp01(settle + (p - settle) * Math.exp(-dt / tau));
}

/** A fresh, dry, bare ground. */
export const freshGround = () => ({ wet: 0, pond: 0, snow: 0, fell: 0 });
