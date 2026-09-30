// SEABED — the floor under the water, as one deterministic function of the world coordinate.
//
// The sibling of sea-swell.js one surface down. That module answers "where is the top of the water"
// as a pure function of (position, time); this answers "where is the bottom" as a pure function of
// position and of which tiles are LAND. Nothing is authored and nothing is stored, so the renderer,
// the server and every client agree about a trench without a table, a tick or a byte of egress.
//
// ⚠ LAND IS HANDED IN, NEVER LOOKED UP. The one thing this module cannot derive is where the coast
// is, and the two places that know answer it from different data: the renderer from its per-tile
// LUT, the server from the zones. Reading the LUT here would make the server's seabed depend on the
// renderer having drawn a frame — the sea's own trap, where the hull measured dead flat under the
// DOM stub because the floor had never been entered. So every entry point takes `isLand(ix, iy)`,
// an integer-tile predicate, and the caller supplies whichever answer it has.
//
// ⚠ THE SHORELINE IS A TILE EDGE AND THE DEPTH THERE IS EXACTLY ZERO. Distance is measured from the
// point to the nearest land tile's SQUARE, not its centre, so a coast has no step in it: depth
// rises continuously to 0 at the boundary of the first land tile. Everything added on top of the
// shelf (relief, roughness) is a FRACTION of the shelf depth, which is itself 0 at d = 0, so "zero
// at the shore" is true by arithmetic rather than by a clamp.
//
// ⚠ THE HASH IS landform.js's, ON PURPOSE. Phase 3 draws this floor in GLSL, and `hn2h` is the one
// noise in the codebase that JS and a shader compute identically (a 32-bit integer mix, no Math.sin).
// A seabed on `vnoise2` would put a seam round the camera where the mesh meets anything the shader
// synthesises.
//
// Units: tiles in, METRES out for depth (SEA_TILE_M is 7 m a tile). Metres because every gameplay
// reader — crush depth, hull tiers, the gauge — thinks in metres, and a tile-denominated depth is
// one conversion away from being wrong in one of them.

import { hn2h, hnoise2, fbm2 } from './landform.js';
import { SEA_TILE_M } from './sea-swell.js';

// ── THE SHELF ─────────────────────────────────────────────────────────────────────────────────
//
// Depth as a function of distance from shore alone. An exponential approach to SHELF_M (it is
// steepest at the beach and flattens toward the shelf floor, which is what a real shelf does),
// then a drop-off past SHELF_EDGE into the Deep.
//
// ⚠ GAME SCALE, NOT OCEANOGRAPHY. A real continental shelf is tens of kilometres wide; the whole
// Coldwater map window is a few hundred metres. What matters is that the harbour is diveable on a
// tier-1 hull and the drop-off is visible as a place.
export const SHELF_M = 42;         // the shelf floor far from shore, before the drop
export const SHELF_K = 7;          // tiles: e-folding distance of the approach to SHELF_M
export const SHELF_EDGE = 28;      // tiles from shore where the drop-off begins
export const DROP_W = 18;          // tiles over which the drop-off happens
export const DEEP_M = 820;         // metres added by the drop-off: the Deep's abyssal floor
export const SHORE_SEARCH = 48;    // tiles searched for land; past this a point is "open ocean"
// The beach: over the first few tiles the shelf's distance is eased, d²/(d + BEACH_W), so the
// floor leaves the sand FLAT and steepens into the shelf rather than starting at its steepest.
// The plain exponential put 6.5 m of water one tile (seven metres) out, about 1:1, which is a
// harbour wall and not a beach — and the surf (gl/water.js) breaks where a wave reaches 0.78 of
// the depth, so a 1:1 bottom breaks every sea within a tile of the sand. Eased, the first tile is
// under a metre and 1:10-ish, which gives a surf zone several waves deep.
// ⚠ It only eases the SHELF term, never the drop-off, so the Deep is still where it was; and
// d²/(d + B) is monotone and 0 at 0, so every property of shelfDepth below still holds.
// 0 is the steep shelf as it shipped.
export const BEACH_W = 6;          // tiles

// How far the shelf reaches is not the same everywhere: measured on the depth map, a constant reach
// drew every coast as a uniform halo — the land masses read as rounded rectangles on a blue plate.
// A slow noise stretches or squeezes shore distance by up to ±REACH_A before the shelf reads it, so
// a headland drops straight into the Deep while a bay shoals out for tiles. ⚠ It divides `d`, so
// d = 0 is still 0 and the coast is untouched; `shelfDepth` itself stays monotone in its argument.
export const REACH_F = 0.022, REACH_A = 0.55;
export const shelfReach = (x, y) => 1 + REACH_A * 2 * fbm2(x * REACH_F - 211.3, y * REACH_F + 57.9, 2, 0.5);

// ── RELIEF ────────────────────────────────────────────────────────────────────────────────────
//
// Two terms kept apart for cliffrelief's reason: one is WHICH basin you are in (low frequency, big
// swing), the other is how BROKEN the floor is (high frequency, small). Written as one weighted
// mean they trade against each other.
export const RELIEF_F = 0.045;     // ~22-tile basins and ridges
export const RELIEF_A = 0.32;      // ± fraction of the local depth
export const ROUGH_F = 0.34;       // ~3-tile rock
export const ROUGH_A = 0.07;
export const RIDGE_F = 0.11;       // ridged noise: trenches and outcrop lines
export const RIDGE_A = 0.18;

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Distance, in tiles, from (x, y) to the nearest land tile's square, capped at `R`. Tile (i, j)
// occupies [i, i+1) × [j, j+1). ⚠ A point ON land returns 0, not a negative — the seabed is not
// defined under land and every reader clamps to the water side.
export function shoreDistance(x, y, isLand, R = SHORE_SEARCH) {
  const ix = Math.floor(x), iy = Math.floor(y);
  if (isLand(ix, iy)) return 0;
  let best = R;
  // Ring search outward; once a ring's nearest possible distance exceeds the best found, stop.
  for (let r = 1; r <= R; r++) {
    if (r - 1 >= best) break;
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = ix + dx, ty = iy + dy;
        if (!isLand(tx, ty)) continue;
        const ex = x < tx ? tx - x : (x > tx + 1 ? x - (tx + 1) : 0);
        const ey = y < ty ? ty - y : (y > ty + 1 ? y - (ty + 1) : 0);
        const d = Math.hypot(ex, ey);
        if (d < best) best = d;
      }
    }
  }
  return best;
}

// ── THE SHORE FIELD ───────────────────────────────────────────────────────────────────────────
//
// `shoreDistance` is a ring search per point: right for one query (a server building one room),
// and hopeless for a whole window — measured, a map-sized sweep hung the page. This is the same
// question answered once for a rectangle, by an exact Euclidean distance transform on the tile
// grid (Felzenszwalb & Huttenlocher's two 1-D passes), then read back bilinearly.
//
// ⚠ THE FIELD IS SIGNED SO THE COAST INTERPOLATES TO ZERO. Tile centres carry: land −0.5, water
// (distance from its centre to the nearest land centre) − 0.5. Midway between a land centre and
// the first water centre — which is the shared tile EDGE — bilinear interpolation gives exactly 0,
// so "zero at the shoreline" survives the move from exact squares to a sampled field. Readers clamp
// negatives to 0.
//
// ⚠ PAD THE WINDOW. Land just outside the rectangle is invisible to the transform, so a caller
// wanting correct distances within R of its edge builds the field `R` larger all round. The field
// is still deterministic in (rectangle, isLand); two callers asking about the same rectangle agree.
const INF = 1e20;
function edt1d(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const dq = q - v[k]; d[q] = dq * dq + f[v[k]]; }
}

export function shoreField(x0, y0, w, h, isLand, R = SHORE_SEARCH) {
  const n = w * h, sq = new Float64Array(n);
  let anyLand = false;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const l = isLand(x0 + i, y0 + j); if (l) anyLand = true;
    sq[j * w + i] = l ? 0 : INF;
  }
  const m = Math.max(w, h), f = new Float64Array(m), d = new Float64Array(m);
  const v = new Int32Array(m), z = new Float64Array(m + 1);
  for (let i = 0; i < w; i++) {                                   // columns
    for (let j = 0; j < h; j++) f[j] = sq[j * w + i];
    edt1d(f, h, d, v, z);
    for (let j = 0; j < h; j++) sq[j * w + i] = d[j];
  }
  for (let j = 0; j < h; j++) {                                   // rows
    for (let i = 0; i < w; i++) f[i] = sq[j * w + i];
    edt1d(f, w, d, v, z);
    for (let i = 0; i < w; i++) sq[j * w + i] = d[i];
  }
  const data = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    if (sq[k] === 0) data[k] = -0.5;
    else data[k] = anyLand ? Math.min(R, Math.sqrt(sq[k])) - 0.5 : R;
  }
  // Bilinear over tile CENTRES, which sit at (x0 + i + 0.5, y0 + j + 0.5).
  const at = (x, y) => {
    const fx = Math.min(w - 1, Math.max(0, x - x0 - 0.5)), fy = Math.min(h - 1, Math.max(0, y - y0 - 0.5));
    const i = Math.min(w - 2, Math.floor(fx)), j = Math.min(h - 2, Math.floor(fy));
    const tx = fx - i, ty = fy - j, a = data[j * w + i], b = data[j * w + i + 1];
    const c = data[(j + 1) * w + i], e = data[(j + 1) * w + i + 1];
    const s = a + (b - a) * tx + (c - a) * ty + (a - b - c + e) * tx * ty;
    return s > 0 ? s : 0;
  };
  return { x0, y0, w, h, data, at };
}

// The shelf profile: metres below mean sea level as a function of shore distance alone.
// Monotone non-decreasing in d, and exactly 0 at d = 0.
export function shelfDepth(d) {
  if (d <= 0) return 0;
  const de = BEACH_W > 0 ? d * d / (d + BEACH_W) : d;
  return SHELF_M * (1 - Math.exp(-de / SHELF_K)) + DEEP_M * smooth(SHELF_EDGE, SHELF_EDGE + DROP_W, d);
}

// Relief as a FRACTION of the local depth. ⚠ Proportional, not additive, and that is what keeps the
// shore at exactly 0: the shelf is 0 there, so any fraction of it is too. An additive relief would
// need its own ramp to fade out at the beach, which is a second thing to keep in step with the
// first. It also keeps a harbour's lumps harbour-sized and a trench's trench-sized.
function reliefAt(x, y) {
  const basin = fbm2(x * RELIEF_F + 13.1, y * RELIEF_F - 40.7, 3, 0.5) * 2;          // ≈ ±1
  const rough = (hnoise2(x * ROUGH_F + 5.3, y * ROUGH_F + 91.2) - 0.5) * 2;           // ≈ ±1
  const rn = hnoise2(x * RIDGE_F - 61.9, y * RIDGE_F + 2.4);
  const ridge = Math.pow(1 - Math.abs(2 * rn - 1), 3);                               // 0..1, sharp crests
  return RELIEF_A * basin + ROUGH_A * rough + RIDGE_A * (ridge - 0.25);
}

// Depth of the seabed at (x, y), in METRES below mean sea level. ≥ 0 always; 0 on land and at the
// shoreline. `d` may be passed when the caller already has the shore distance (a cached field),
// which is what makes a mesh affordable.
export function seabedDepth(x, y, isLand, d = shoreDistance(x, y, isLand)) {
  if (d <= 0) return 0;
  const base = shelfDepth(d / shelfReach(x, y));
  const z = base * (1 + reliefAt(x, y));
  return z > 0 ? z : 0;
}

export const seabedDepthTiles = (x, y, isLand, d) => seabedDepth(x, y, isLand, d) / SEA_TILE_M;

// Gradient in metres per TILE, by central difference. ⚠ Not analytic, deliberately: the shore
// distance is a min over squares and has no closed-form derivative worth writing, and nothing here
// is lit per fragment on the CPU. The GLSL twin (phase 3) will do the same on the GPU.
export function seabedSlope(x, y, isLand, h = 0.05, dist = null) {
  const D = (px, py) => seabedDepth(px, py, isLand, dist ? dist(px, py) : shoreDistance(px, py, isLand));
  const dx = (D(x + h, y) - D(x - h, y)) / (2 * h);
  const dy = (D(x, y + h) - D(x, y - h)) / (2 * h);
  return { dx, dy, grade: Math.hypot(dx, dy) };
}

// ── MATERIAL ──────────────────────────────────────────────────────────────────────────────────
//
// What the floor is made of: sand in the shallows, silt in still deep water, rock where it is
// steep or on a ridge crest, debris near the city. Read by the room prose and by salvage odds.
export const MATERIALS = ['sand', 'silt', 'rock', 'debris'];
// `dist` is an optional (x, y) → shore distance function, typically a `shoreField(...).at`, so a
// whole window of materials costs one transform rather than five ring searches a tile.
export function seabedMaterial(x, y, isLand, d = null, dist = null) {
  if (d == null) d = dist ? dist(x, y) : shoreDistance(x, y, isLand);
  if (d <= 0) return null;
  const depth = seabedDepth(x, y, isLand, d);
  const { grade } = seabedSlope(x, y, isLand, 0.05, dist);
  const n = hnoise2(x * 0.21 + 300.5, y * 0.21 - 17.8);
  // Steep in METRES per metre: grade is m/tile, so divide by the tile.
  if (grade / SEA_TILE_M > 0.6 || n > 0.82) return 'rock';
  if (d < 6 && n < 0.30) return 'debris';          // the city throws things in the harbour
  return depth < 30 ? 'sand' : 'silt';
}

// ── WRECKS ────────────────────────────────────────────────────────────────────────────────────
//
// Points of interest are hashed per coarse CELL, the flock-anchor idiom: everyone sees the same
// wreck in the same place with nothing stored. Density and size both rise with depth, so the best
// finds are always one hull tier further down.
//
// ⚠ A player-lost Drake is NOT one of these — it is player-made, so it is stored (a small table
// keyed on cell). This is only the world's own wrecks.
export const WRECK_CELL = 14;      // tiles per cell side
export const WRECK_KINDS = [
  // kind, minimum depth (m), relative weight
  { kind: 'skiff',           min: 4,   w: 5 },
  { kind: 'container_stack', min: 18,  w: 3 },
  { kind: 'freighter',       min: 35,  w: 2 },
  { kind: 'server_farm',     min: 120, w: 1.5 },
  { kind: 'hero',            min: 400, w: 0.5 },
];
// Probability that a cell holds a wreck, as a function of the depth at its candidate site.
// ⚠ Capped well under 1: a first cut at 0.85 put a wreck in nearly every abyssal cell, and a find
// that is everywhere is not a find.
export const WRECK_MAX_CHANCE = 0.4;
export const wreckChance = (depthM) => depthM < 4 ? 0 : Math.min(WRECK_MAX_CHANCE, 0.14 + depthM / 2600);

// Where a cell's wreck would lie, if it has one: hashed, so it needs no land or depth.
function wreckSite(cx, cy) {
  const jx = hn2h(cx + 101, cy - 77), jy = hn2h(cx - 311, cy + 29);
  return [(cx + 0.15 + 0.7 * jx) * WRECK_CELL, (cy + 0.15 + 0.7 * jy) * WRECK_CELL];
}

export function wreckInCell(cx, cy, isLand) {
  const r0 = hn2h(cx * 7 + 11, cy * 13 - 5);
  // ⚠ THE ROLL BEFORE THE SEARCH. The chance never passes WRECK_MAX_CHANCE, so a roll at or over it
  // is no wreck at any depth, and the shore search (48 rings out at sea) is skipped for 60% of cells
  // with the same answer.
  if (r0 >= WRECK_MAX_CHANCE) return null;
  const [x, y] = wreckSite(cx, cy);
  const d = shoreDistance(x, y, isLand);
  if (d <= 0) return null;
  const depth = seabedDepth(x, y, isLand, d);
  if (r0 >= wreckChance(depth)) return null;
  const pool = WRECK_KINDS.filter(k => depth >= k.min);
  if (!pool.length) return null;
  const tot = pool.reduce((s, k) => s + k.w, 0);
  let pick = hn2h(cx * 3 - 9, cy * 5 + 41) * tot;
  let kind = pool[pool.length - 1].kind;
  for (const k of pool) { if ((pick -= k.w) < 0) { kind = k.kind; break; } }
  const heading = Math.floor(hn2h(cx + 7, cy + 3) * 360);
  return { id: `wreck_${cx}_${cy}`, kind, x, y, depth, heading };
}

// Every wreck within `radius` tiles of (x, y).
export function wrecksNear(x, y, radius, isLand) {
  const out = [];
  const c0x = Math.floor((x - radius) / WRECK_CELL), c1x = Math.floor((x + radius) / WRECK_CELL);
  const c0y = Math.floor((y - radius) / WRECK_CELL), c1y = Math.floor((y + radius) / WRECK_CELL);
  for (let cx = c0x; cx <= c1x; cx++) for (let cy = c0y; cy <= c1y; cy++) {
    const [sx, sy] = wreckSite(cx, cy);
    if (Math.hypot(sx - x, sy - y) > radius) continue;   // out of range: no need to ask
    const w = wreckInCell(cx, cy, isLand);
    if (w) out.push(w);
  }
  return out;
}

// The stable id of the synthesised underwater room at an integer tile. ⚠ STABLE is the point:
// scavenging keys its stock on zone id, so a room minted with a fresh id every visit is a wreck
// that restocks on re-entry — an infinite loot faucet.
export const seabedZoneId = (ix, iy) => `seabed_${ix}_${iy}`;

// ── SCATTER ───────────────────────────────────────────────────────────────────────────────────
//
// The small stuff on the bottom: what the city dropped, lost and threw off the quay, plus what
// grew on it. Hashed per TILE and SLOT like the wrecks are per cell, so every client puts the same
// tyre in the same place with nothing stored. Scenery only: nothing here is lootable, which is
// what keeps it out of the server's business (wrecks are the finds).
//
// Each kind has a depth band. Shallow water is the harbour's rubbish; the shelf is where things
// settle and get colonised; the Deep keeps only what sank a long way and the animals that live on it.
export const SCATTER_SLOTS = 2;    // candidate sites per tile
export const SCATTER_KINDS = [
  // kind, min/max depth (m), relative weight
  { kind: 'tyre',      min: 1.5, max: 40,   w: 5 },
  { kind: 'cone',      min: 1.5, max: 25,   w: 2 },
  { kind: 'trolley',   min: 1.5, max: 30,   w: 2 },
  { kind: 'bottles',   min: 1.5, max: 60,   w: 3 },
  { kind: 'shells',    min: 1.5, max: 80,   w: 4 },
  { kind: 'barrel',    min: 4,   max: 300,  w: 3 },
  { kind: 'crate',     min: 4,   max: 200,  w: 3 },
  { kind: 'pipe',      min: 8,   max: 400,  w: 2 },
  { kind: 'anchor',    min: 10,  max: 900,  w: 1 },
  { kind: 'car',       min: 10,  max: 120,  w: 0.7 },
  { kind: 'coral',     min: 3,   max: 60,   w: 4 },
  { kind: 'sponge',    min: 20,  max: 500,  w: 3 },
  { kind: 'urchins',   min: 2,   max: 50,   w: 2 },
  { kind: 'monitor',   min: 30,  max: 900,  w: 1 },
  { kind: 'tubeworms', min: 200, max: 900,  w: 3 },
  { kind: 'glassrope', min: 300, max: 900,  w: 2 },
  { kind: 'bike',      min: 1.5, max: 20,   w: 2 },
  { kind: 'fridge',    min: 2,   max: 40,   w: 1.5 },
  { kind: 'mannequin', min: 3,   max: 60,   w: 1 },
  { kind: 'pallet',    min: 2,   max: 80,   w: 2.5 },
  { kind: 'lobsterpot',min: 3,   max: 50,   w: 2 },
  { kind: 'starfish',  min: 1.5, max: 120,  w: 3 },
  { kind: 'anemones',  min: 2,   max: 70,   w: 3 },
  { kind: 'braincoral',min: 3,   max: 40,   w: 2 },
  { kind: 'chain',     min: 6,   max: 600,  w: 2 },
  { kind: 'drone',     min: 5,   max: 400,  w: 1.5 },
  { kind: 'dish',      min: 15,  max: 700,  w: 1 },
  { kind: 'mine',      min: 25,  max: 500,  w: 0.6 },
  { kind: 'cablespool',min: 40,  max: 900,  w: 1.5 },
  { kind: 'whalefall', min: 150, max: 900,  w: 0.5 },
  { kind: 'nodules',   min: 350, max: 900,  w: 3 },
  { kind: 'chimney',   min: 500, max: 900,  w: 1.2 },
];

// The scatter object at slot k of tile (tx, ty), or null. `d` is the shore distance if known.
export function scatterAt(tx, ty, k, isLand, d = null) {
  if (hn2h(tx * 41 + k * 5, ty * 23 - k * 3) >= 0.18) return null;
  const x = tx + 0.1 + 0.8 * hn2h(tx * 3 + k, ty + 61), y = ty + 0.1 + 0.8 * hn2h(tx - 17, ty * 5 + k);
  const dist = d == null ? shoreDistance(x, y, isLand) : (typeof d === 'function' ? d(x, y) : d);
  if (dist <= 0) return null;
  const depth = seabedDepth(x, y, isLand, dist);
  const pool = SCATTER_KINDS.filter(s => depth >= s.min && depth <= s.max);
  if (!pool.length) return null;
  const tot = pool.reduce((s, q) => s + q.w, 0);
  let pick = hn2h(tx * 9 - k, ty * 7 + 19) * tot, kind = pool[pool.length - 1].kind;
  for (const q of pool) { if ((pick -= q.w) < 0) { kind = q.kind; break; } }
  return { kind, x, y, depth, yaw: hn2h(tx + 3, ty * 11 + k) * Math.PI * 2, seed: hn2h(tx * 5 + k, ty * 3 - 1) };
}
