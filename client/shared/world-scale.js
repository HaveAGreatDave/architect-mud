// THE WORLD SCALE: how big a tile is, how fast each mode crosses one, and how a distance or a speed
// is written on screen. docs/proposals/world-scale.md is the design; this file is the only place its
// numbers live. Pure: no DOM, no imports, so the server, the client and the gates all load it.
//
// ⚠ scale:lint (scripts/scale/lint.mjs) fails a new copy of these numbers anywhere else (17.857,
// 17.9, 3.28084, 0.3048, 0.8689, 1.688). Import them from here instead.

// ── The ruler ────────────────────────────────────────────────────────────────
// One storey is 3.5 m and 0.196 tiles, so a tile is 17.857 m. GLASS, the birds, people and trees
// already draw at this size, which is why it isn't rounded to 18: that would move every roof.
export const STOREY_M = 3.5;
export const STOREY_TILES = 0.196;
export const TILE_M = STOREY_M / STOREY_TILES;

export const m2t = (m) => m / TILE_M;
export const t2m = (t) => t * TILE_M;

// ── Conversions to SI ───────────────────────────────────────────────────────
export const FT_M = 0.3048;            // a foot in metres
export const NM_M = 1852;              // a nautical mile in metres
export const MI_M = 1609.344;          // a statute mile in metres
export const KT_MS = NM_M / 3600;      // a knot in m/s
export const MPH_MS = MI_M / 3600;     // a mile an hour in m/s
export const KMH_MS = 1000 / 3600;     // a kilometre an hour in m/s

// ── Paces ───────────────────────────────────────────────────────────────────
// A pace is how many world metres a mode covers for each metre its own instruments say it went:
// the time compression that lets a truck cross Coldwater in minutes. Every number is today's
// behaviour written against the ruler, so nothing here changes a speed. The sims still hold their
// own copies (tileMph in flight-model.js and podracer-model.js, TILE_MPH in trucking/state.js,
// worldPace and AIR_PACE in windshield.js and cockpit.js); phase 5 points them here.
//
//   road      the city: 112 mph on the truck's dial crosses one tile a second (tileMph: 112).
//   corridor  the void highway: three tiles to the mile (the old TILES_PER_MILE), so a 90-tile
//             corridor room is 30 miles of real road. The doc wants this per route one day.
//   sea       95 mph on a boat's dial crosses one tile a second (tileMph: 95).
//   air       RENDER_TUNE.worldPace (0.001 tiles a knot-second) on the ground, and AIR_PACE (2)
//             times that at cruise. Distances to a field are flown at cruise, so labels use it.
// On foot a move is a tile and no speed is shown, so foot has no pace.
export const PACE = Object.freeze({
  road: TILE_M / (112 * MPH_MS),
  corridor: TILE_M / (MI_M / 3),
  sea: TILE_M / (95 * MPH_MS),
  air: Object.freeze({
    ground: (TILE_M * 0.001) / KT_MS,
    cruise: (TILE_M * 0.001 * 2) / KT_MS,
  }),
});

// The pace a distance label uses for a mode, or 1 for a mode drawn at true size.
export function paceOf(mode) {
  const p = PACE[mode];
  if (p == null) return 1;
  return typeof p === 'number' ? p : p.cruise;
}

// World tiles as the vehicle's own instruments read them: world metres divided by the pace. A
// pilot's distance to a field and a trucker's distance to the yard are both honest about the trip;
// the map is just drawn smaller than the trip.
export const tripM = (mode, tiles) => t2m(tiles) / paceOf(mode);

// ── Labels ──────────────────────────────────────────────────────────────────
// What the person in that seat would read (the Units table in world-scale.md):
//   air, sea          nm and knots
//   road, corridor    km and km/h
//   anything else     m or km, and km/h (on foot, rooms, fishing, weather)
const NAUTICAL = new Set(['air', 'sea']);
const ROAD = new Set(['road', 'corridor']);

const tenths = (v) => (Math.round(v * 10) / 10).toFixed(1);

// A distance in metres, as text with its unit. Short distances get a decimal; long ones don't.
export function fmtDistance(mode, m) {
  const d = Math.max(0, Number(m) || 0);
  if (NAUTICAL.has(mode)) {
    const nm = d / NM_M;
    return (nm < 10 ? tenths(nm) : String(Math.round(nm))) + ' nm';
  }
  if (ROAD.has(mode)) return kmOf(d) + ' km';
  if (d < 1000) return Math.round(d) + ' m';
  const km = d / 1000;
  return (km < 10 ? tenths(km) : String(Math.round(km))) + ' km';
}

// A road distance in whole kilometres, floored at 1. A board reading 0 has stopped being a board:
// anything that close is one kilometre and in sight through the windscreen.
export const kmOf = (m) => Math.max(1, Math.round((Number(m) || 0) / 1000));

// A speed in m/s, as text with its unit.
export function fmtSpeed(mode, ms) {
  const v = Math.max(0, Number(ms) || 0);
  if (NAUTICAL.has(mode)) return Math.round(v / KT_MS) + ' kt';
  return Math.round(v / KMH_MS) + ' km/h';
}
