// THERMALS: columns of rising air over sun-heated ground.
//
// One field, read by three things: the client flight sim (lift on the wing), the server's
// reconcile (how much climb an engine-off aircraft may claim), and the red-tail hawk in
// birds.js (where it spirals). All three call the same pure functions, so a hawk circling
// somewhere marks lift an aircraft can use there, and the server agrees about both.
//
// ⚠ A PURE FUNCTION OF PLACE, TIME AND SKY. No state, no tick, nothing on the wire beyond the
// `sky` object flight_ctx already carries. The server's check costs a handful of in-memory
// surfaceAt lookups per reconcile and no query.
//
// ⚠ COLUMN CENTRES DO NOT DEPEND ON THE GROUND. A column sits at a hashed point in each
// THERMAL_CELL block whatever is under it; the ground only sets how STRONG it is. That is what
// lets the hawk use the field with no terrain lookup (it already only lives on hot ground), and
// means a client whose map window is missing a tile gets LESS lift than the server allows,
// never more.
//
// Units: position in map tiles, altitude in feet, lift in ft/min. The flight sim's horizontal
// scale is compressed (RENDER_TUNE.worldPace), so a column 1-2 tiles across is one a light
// aircraft can circle in at 25-35 degrees of bank, which is what a real one takes.

export const THERMAL_CELL = 6;          // tiles between candidate columns (one per block)
const CORE_FPM = 900;                    // core updraft at full sun over the hottest ground (~4.6 m/s)
const SURFACE_FT = 200;                  // lift builds over the lowest layer rather than starting at the deck
const SINK_FPM = 70;                     // broad sink between columns while the sun is up

const frac = (n) => { const x = Math.sin(n) * 43758.5453; return x - Math.floor(x); };
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// How much a tile heats the air over it, 0 (water) to ~1.1 (bare dark rock). Keyed by the
// flight biome, which the client's map cells already carry and the server derives with
// biomeOf, so both sides read the same number.
export const GROUND_HEAT = {
  water: 0, hotspring: 0.3, pier: 0.4, docks: 0.5,
  forest: 0.35, park: 0.5, parkland: 0.55, deadwood: 0.6,
  uptown: 0.75, civic: 0.75, oldcoldwater: 0.8, scrub: 0.8, sinter: 0.8,
  citycore: 0.85, marquee: 0.85, ruins: 0.85, cliff: 0.9, alkali: 0.9, ash: 0.9, infra: 0.9, freight: 0.9, concrete: 0.9,
  badlands: 0.95, industrial: 0.95, redrock: 1.0, plateau: 1.0, asphalt: 1.0, airport: 1.0,
  hardpan: 1.05, basalt: 1.1,
};

/** Heat of a flight map cell ({ biome, road, bt }) or null for unknown ground (no lift). */
export function heatOfCell(c) {
  if (!c || !c.biome) return 0;
  const h = GROUND_HEAT[c.biome] ?? 0.6;
  if (h <= 0) return 0;
  return h + (c.road ? 0.08 : 0) + (c.bt ? 0.04 : 0);
}

// What the weather leaves of the sun's heating. Rain and storms kill convection outright;
// fog means a stable layer; overcast only lets a little through.
const WX_SUN = { clear: 1, cloudy: 0.55, fog: 0.08, rain: 0, snow: 0, storm: 0, none: 1 };

/** The sky's convective strength, 0..1: time of day, weather and wind shear. */
export function thermalSun(sky) {
  if (!sky) return 0;
  const hour = Number.isFinite(sky.hour) ? sky.hour : 12;
  // Ground heating lags the sun: nothing before about 08:30, peak around 14:00, gone by 19:30.
  const day = Math.sin(Math.PI * (hour - 8.5) / 11);
  if (!(day > 0)) return 0;
  const wx = WX_SUN[String(sky.weather || 'clear').toLowerCase()] ?? 0.5;
  // Strong wind tears columns apart before they get organised (kph on the wire).
  const kt = (sky.wind || 0) * 0.54;
  const shear = clamp(1 - (kt - 15) / 25, 0, 1);
  return Math.pow(day, 1.3) * wx * shear;
}

/** The fixed centre and size of the column in block (i, j). Pure, ground-free. */
export function columnOf(i, j) {
  const h1 = frac(i * 12.9898 + j * 78.233), h2 = frac(i * 39.346 + j * 11.135);
  const h3 = frac(i * 73.156 + j * 52.235), h4 = frac(i * 3.717 + j * 91.402);
  return {
    i, j,
    cx: (i + 0.2 + 0.6 * h1) * THERMAL_CELL,
    cy: (j + 0.2 + 0.6 * h2) * THERMAL_CELL,
    r: 0.9 + 0.8 * h3,                 // tiles
    k: 0.6 + 0.6 * h4,                 // this column's own vigour
    period: 900 + 600 * h3,            // seconds per life cycle
    phase: h1 * 7.3 + h2 * 3.1,        // fraction offset into the cycle
  };
}

/** Nearest column centre to (x, y), for the hawk. Ground- and clock-free. */
export function nearestColumn(x, y) {
  const bi = Math.floor(x / THERMAL_CELL), bj = Math.floor(y / THERMAL_CELL);
  let best = null, bd = Infinity;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const c = columnOf(bi + di, bj + dj);
    const d = Math.hypot(c.cx - x, c.cy - y);
    if (d < bd) { bd = d; best = c; }
  }
  return best ? { ...best, d: bd } : null;
}

/**
 * The nearest column within `reach` tiles that is well into its life at `atMs`, or null. The
 * hawk asks this once per flight, at the flight's start, so it commits to a column that is
 * actually working and does not swap columns mid-spiral.
 */
export function liveColumnNear(x, y, atMs, reach, minLife = 0.3) {
  const bi = Math.floor(x / THERMAL_CELL), bj = Math.floor(y / THERMAL_CELL);
  let best = null, bd = Infinity;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const c = columnOf(bi + di, bj + dj);
    const d = Math.hypot(c.cx - x, c.cy - y);
    if (d > reach || d >= bd || lifeOf(c, atMs) < minLife) continue;
    bd = d; best = c;
  }
  return best ? { ...best, d: bd } : null;
}

// Life of a column at wall-clock `nowMs`, 0..1. Each column builds, holds and collapses over its
// own period, then is dead for the last quarter of it, so the lift moves around the sky.
export function columnLife(c, nowMs) { return lifeOf(c, nowMs); }
function lifeOf(c, nowMs) {
  const u = ((nowMs / 1000) / c.period + c.phase) % 1;
  if (u >= 0.75) return 0;
  return Math.sin(Math.PI * u / 0.75);
}

/**
 * Columns near (x, y) with their strength at this instant.
 * heatAt(tx, ty) → 0..~1.1 is the caller's ground source (map cells client-side, surfaceAt
 * server-side). Returns [{ cx, cy, r, w, top }] with w in ft/min and top in feet.
 */
export function thermalsNear(x, y, nowMs, sky, heatAt) {
  const sun = thermalSun(sky);
  if (sun <= 0) return [];
  const bi = Math.floor(x / THERMAL_CELL), bj = Math.floor(y / THERMAL_CELL);
  const out = [];
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const c = columnOf(bi + di, bj + dj);
    const life = lifeOf(c, nowMs);
    if (life <= 0) continue;
    const heat = heatAt ? heatAt(Math.round(c.cx), Math.round(c.cy)) : 0;
    if (!(heat > 0)) continue;
    const w = CORE_FPM * heat * sun * life * c.k;
    // Hotter ground and a stronger sun push the convective layer higher: 1,500 to ~7,500 ft.
    const top = 1500 + 6000 * sun * Math.min(1, heat) * (0.5 + 0.5 * c.k / 1.2);
    out.push({ cx: c.cx, cy: c.cy, r: c.r, w, top });
  }
  return out;
}

/**
 * Vertical air movement at (x, y, altFt), ft/min: positive in a core, a sink ring round each
 * column and a broad sink between them while the sun is up. Zero at night and over water.
 */
export function thermalLift(x, y, altFt, nowMs, sky, heatAt) {
  const sun = thermalSun(sky);
  if (sun <= 0) return 0;
  const cols = thermalsNear(x, y, nowMs, sky, heatAt);
  let v = 0, inAny = false;
  for (const c of cols) {
    const cap = profile(altFt, c.top);
    if (cap <= 0) continue;
    const q = Math.hypot(x - c.cx, y - c.cy) / c.r;
    if (q < 1.2) inAny = true;
    v += c.w * cap * Math.exp(-2.5 * q * q);
    v -= 0.25 * c.w * cap * Math.exp(-(((q - 1.4) / 0.5) ** 2));
  }
  if (!inAny) v -= SINK_FPM * sun * clamp(altFt / SURFACE_FT, 0, 1);
  return v;
}

// Vertical profile of a column's strength, 0..1, after the mixed-layer shape Allen (2006, NASA
// "Updraft Model for Development of Autonomous Soaring Uninhabited Air Vehicles") uses:
// w ∝ (z/zi)^(1/3) · (1 − 1.1 z/zi). It rises quickly off the ground, peaks about a quarter of
// the way up the convective layer and dies just under its top. 0.458 is its peak, so this is 1
// at the best height. The (1/3) root also makes lift near the deck small but not zero.
const PROFILE_PEAK = 0.458;
function profile(altFt, topFt) {
  if (!(altFt > 0) || !(topFt > 0)) return 0;
  const q = altFt / topFt;
  if (q >= 1 / 1.1) return 0;
  return Math.cbrt(q) * (1 - 1.1 * q) / PROFILE_PEAK;
}

/** Most lift the field could give anywhere near (x, y) at altFt: the server's lenient bound. */
export function thermalLiftMax(x, y, altFt, nowMs, sky, heatAt) {
  const cols = thermalsNear(x, y, nowMs, sky, heatAt);
  let best = 0;
  for (const c of cols) {
    if (Math.hypot(x - c.cx, y - c.cy) > c.r * 2) continue;
    best = Math.max(best, c.w * profile(altFt, c.top));
  }
  return best;
}
