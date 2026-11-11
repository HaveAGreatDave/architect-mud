// The formal park dressings: a tiered fountain, a parterre, a pergola walk and a paved forecourt.
//
// They're four more of a park tile's dressings (`park_feature` on a `park` terrain tile), built from
// the same kit as the grove and the pond in windshield.js (`parkGeom` for the solids, `drawParkTile`
// for the ground paint), so both renderers draw them and gl/solids.js keeps each tile as one
// retained group. They're the kept, set-piece end of a park: stone, clipped hedges and gilt, the
// grounds of a building that wants to be looked at. The Hughson Coliseum's gardens and plaza were
// the first (docs/proposals/hughson-gardens.md), but nothing here knows that.
//
// ⚠ THE FORECOURT IS LAID FROM A FOCUS, NOT FROM ITS TILE. Its rings, rays, lamps, benches and flags
// are placed round one point (`flags.park_focus`, the door a plaza fronts), and each tile draws only
// the part that falls on it, clipped to its square. That's what lets five tiles of paving read as one
// sunburst from a gate. `fo` is the focus from the tile's centre in tiles, x east and y south; with no
// focus it's half a tile north, so a lone forecourt tile still draws a whole half-sun on its north edge.
//
// ⚠ NO RENDERER IMPORTS. The caller hands over its kit: `K` the facet builders from parkGeom, `P` the
// ground painters from drawParkTile. Tile-local, the tile spanning ±0.5, z up, a tile about 17.6 m.

export const FORMAL_FEATURES = ['fountain', 'parterre', 'pergola', 'forecourt'];

const LIME = [214, 204, 180], LIME_DK = [172, 162, 142], LIME_LT = [228, 220, 200];
const GRANITE = [98, 96, 104], BRONZE = [150, 100, 58], GILT = [230, 186, 84];
const YEW = [40, 84, 48], BOX = [58, 102, 52], TIMBER = [112, 82, 56];

const DEFAULT_FOCUS = [0, -0.5];
const focusOf = (fo) => (Array.isArray(fo) && Number.isFinite(+fo[0]) && Number.isFinite(+fo[1])) ? [+fo[0], +fo[1]] : DEFAULT_FOCUS;
export const focusKey = (fo) => { const f = focusOf(fo); return Math.round(f[0] * 100) + ',' + Math.round(f[1] * 100); };

// ── THE FORECOURT'S LAYOUT, IN THE FOCUS'S FRAME ─────────────────────────────
// x across the front, y away from it. Every row repeats outward without end, so the plaza can be
// any width and any tile of it draws the right piece.
const RINGS = [0.75, 1.3, 1.95, 2.6, 3.25, 3.9];
const LAMPS = [], BENCHES = [], PLANTERS = [[-0.4, 0.88], [0.4, 0.88]], FLAGS = [], BOLLARDS = [];
for (let k = 0; k < 6; k++) for (const s of [-1, 1]) {
  LAMPS.push([s * (k + 0.75), 0.8]);
  if (k) BENCHES.push([s * (k + 0.25), 0.86]);
}
// The processional walk out from the door: banners down both sides of it, and bollards across its
// far end to keep the traffic off.
for (const y of [1.22, 1.5, 1.78]) for (const s of [-1, 1]) FLAGS.push([s * 0.36, y]);
for (let i = -2; i <= 2; i++) BOLLARDS.push([i * 0.15, 1.95]);

// From the focus's frame to the tile's: the focus is `f` from the centre, and y away from the door is
// y south, which is the way every plaza on the map is built so far.
const toTile = (f, [x, y]) => [f[0] + x, f[1] + y];
const onTile = ([x, y], m = 0.47) => Math.abs(x) <= m && Math.abs(y) <= m;

// Sutherland-Hodgman against the tile square. A convex polygon stays convex, so groundPoly's fan
// stays exact.
function clipSquare(pts, h = 0.5) {
  let out = pts;
  for (const [ax, sgn] of [[0, 1], [0, -1], [1, 1], [1, -1]]) {
    const inside = (p) => sgn * p[ax] <= h;
    const src = out; out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[i], b = src[(i + 1) % src.length];
      const ia = inside(a), ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) {
        const t = (sgn * h - a[ax]) / (b[ax] - a[ax]);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    if (out.length < 3) return null;
  }
  return out;
}

// The forecourt's paving as polygons on this tile: [{ p, k }], where `k` names the stone. Cached per
// focus, because it's trig and clipping and it never changes.
const PAVE_CACHE = new Map();
function forecourtPaving(fo) {
  const key = focusKey(fo);
  let hit = PAVE_CACHE.get(key);
  if (hit) return hit;
  const f = focusOf(fo), out = [];
  const put = (rel, k) => { const c = clipSquare(rel.map((p) => toTile(f, p))); if (c) out.push({ p: c, k }); };
  const at = (r, t) => [Math.sin(t) * r, Math.cos(t) * r];
  // The rings: granite bands round the door, in arcs of three degrees.
  for (const r of RINGS) {
    const w = 0.018;
    for (let i = -30; i < 30; i++) {
      const t0 = i * Math.PI / 60, t1 = (i + 1) * Math.PI / 60;
      put([at(r - w, t0), at(r - w, t1), at(r + w, t1), at(r + w, t0)], 'ring');
    }
  }
  // The rays: paler courses out from the door every ten degrees, in pieces so each stays small.
  for (let i = -8; i <= 8; i++) {
    const t = i * Math.PI / 18, c = Math.cos(t), s = Math.sin(t), w = 0.007;
    for (let r = 0.5; r < 4.6; r += 0.25) {
      const r1 = r + 0.25;
      put([[s * r - c * w, c * r + s * w], [s * r1 - c * w, c * r1 + s * w], [s * r1 + c * w, c * r1 - s * w], [s * r + c * w, c * r - s * w]], 'ray');
    }
  }
  // The sun at the door: a bronze half-disc on the threshold and gilt rays out of it, the gate's own
  // sun laid in the paving.
  const SUN = [];
  for (let i = 0; i <= 16; i++) SUN.push(at(0.3, -Math.PI / 2 + i * Math.PI / 16));
  put([[0, 0], ...SUN], 'sun');
  for (let i = 0; i < 9; i++) {
    const t = -Math.PI / 2 + (i + 0.5) * Math.PI / 9, half = Math.PI / 40, R = i % 2 ? 0.44 : 0.54;
    put([at(0.3, t - half), at(R, t), at(0.3, t + half)], 'gilt');
  }
  if (PAVE_CACHE.size > 64) PAVE_CACHE.clear();
  out.lights = LAMPS.map((p) => toTile(f, p)).filter((p) => onTile(p));
  PAVE_CACHE.set(key, out);
  return out;
}

// ── THE SOLIDS ───────────────────────────────────────────────────────────────
export function formalParkGeom(feature, K, fo) {
  const { face, box, lathe, ringWall, tree, shrub, bench, spike, lod, night } = K;
  const lit = night > 0.3;
  const WATER = night ? [26, 50, 70] : [92, 148, 168];
  const JET = lit ? [150, 196, 240] : [214, 232, 240];
  // A clipped yew cone in a square stone planter.
  const cone = (x, y, s = 1) => {
    box(x, y, 0.04 * s, 0.04 * s, 0, 0.03 * s, 0, LIME_DK);
    lathe(x, y, [[0.03 * s, 0.03 * s], [0.034 * s, 0.055 * s], [0, 0.19 * s]], lod ? 5 : 8, YEW, { jit: 0.18 });
  };
  // A flat gilt diamond in a vertical plane, both faces: one ray of a sunburst. `ax` 0 is the plane
  // facing north and south, 1 the one facing east and west.
  const ray = (cx, cy, cz, ang, r0, r1, w, ax) => {
    const pt = (r, side) => {
      const u = Math.cos(ang) * r - Math.sin(ang) * side, z = cz + Math.sin(ang) * r + Math.cos(ang) * side;
      return ax ? [cx, cy + u, z] : [cx + u, cy, z];
    };
    const P = [pt(r0, 0), pt((r0 + r1) / 2, w), pt(r1, 0), pt((r0 + r1) / 2, -w)];
    const n = ax ? [0.01, 0, 0] : [0, 0.01, 0];
    face(P, GILT, [cx - n[0], cy - n[1], cz]);
    face(P.slice().reverse(), GILT, [cx + n[0], cy + n[1], cz]);
  };
  const sunburst = (x, y, z, r) => {
    lathe(x, y, [[0, z - r * 0.36], [r * 0.25, z - r * 0.3], [r * 0.36, z], [r * 0.25, z + r * 0.3], [0, z + r * 0.36]], lod ? 5 : 8, GILT);
    if (lod) return;
    for (const ax of [0, 1]) for (let i = 0; i < 12; i++) ray(x, y, z, i * Math.PI / 6, r * 0.38, r * (i % 2 ? 0.8 : 1), r * 0.11, ax);
  };
  // A water jet: up from a nozzle and down to where it lands, as two blades.
  const jet = (x0, y0, z0, xa, ya, za, x1, y1, z1, w = 0.005) => {
    const o = lit ? { emis: 1 } : {};
    spike(x0, y0, w, z0, xa, ya, za, JET, o);
    spike(xa, ya, w * 0.8, za, x1, y1, z1, JET, o);
  };
  switch (feature) {
    case 'fountain': {   // A stepped octagonal basin, two tiers, a gilt sun on top; yews and benches round it
      ringWall(0, 0, 0.372, 0.345, 0, 0.018, 8, LIME_DK);
      ringWall(0, 0, 0.345, 0.31, 0.018, 0.046, 8, LIME, { topRgb: LIME_LT, inRgb: LIME_DK, zIn: 0.02 });
      lathe(0, 0, [[0.075, 0.02], [0.075, 0.05], [0.06, 0.05], [0.06, 0.075], [0.045, 0.075], [0.04, 0.11]], 8, LIME);
      lathe(0, 0, [[0.04, 0.11], [0.118, 0.128], [0.134, 0.142]], 8, LIME, { capRgb: WATER });
      lathe(0, 0, [[0.03, 0.142], [0.024, 0.2]], 8, LIME_LT);
      lathe(0, 0, [[0.024, 0.2], [0.066, 0.212], [0.076, 0.222]], 8, LIME, { capRgb: WATER });
      lathe(0, 0, [[0.016, 0.222], [0.011, 0.25], [0.017, 0.256], [0.006, 0.272]], lod ? 5 : 8, GILT);
      sunburst(0, 0, 0.3, 0.06);
      // The water: a sheet off each tier, and a ring of jets from the basin's rim arching in.
      for (let i = 0; i < 8; i++) {
        const a = (i + 0.5) / 8 * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        if (!lod) jet(c * 0.076, s * 0.076, 0.222, c * 0.1, s * 0.1, 0.205, c * 0.118, s * 0.118, 0.145, 0.004);
        jet(c * 0.3, s * 0.3, 0.046, c * 0.24, s * 0.24, 0.19, c * 0.16, s * 0.16, 0.032);
        if (!lod) jet(c * 0.134, s * 0.134, 0.142, c * 0.155, s * 0.155, 0.11, c * 0.17, s * 0.17, 0.032, 0.004);
      }
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) cone(sx * 0.42, sy * 0.42);
      bench(0.445, 0, Math.PI);
      bench(-0.445, 0, 0);
      break;
    }
    case 'parterre': {   // Four beds of fanned box hedge round a gilt-tipped obelisk
      const B0 = 0.045, B1 = 0.4, HT = 0.03, TH = 0.011;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        const mid = (B0 + B1) / 2, half = (B1 - B0) / 2;
        box(sx * mid, sy * B1, half + TH, TH, 0, HT, 0, BOX, { jit: 0.14 });
        box(sx * mid, sy * B0, half + TH, TH, 0, HT, 0, BOX, { jit: 0.14 });
        box(sx * B1, sy * mid, TH, half, 0, HT, 0, BOX, { jit: 0.14 });
        box(sx * B0, sy * mid, TH, half, 0, HT, 0, BOX, { jit: 0.14 });
        // The fan: three hedges out from the bed's inner corner, the sun again.
        for (const t of [Math.PI / 8, Math.PI / 4, Math.PI * 3 / 8]) {
          const L = (B1 - B0) / Math.max(Math.cos(t), Math.sin(t)), dx = sx * Math.cos(t), dy = sy * Math.sin(t);
          box(sx * B0 + dx * L / 2, sy * B0 + dy * L / 2, L / 2 - 0.012, TH * 0.75, 0, HT * 0.8, Math.atan2(dy, dx), BOX, { jit: 0.14 });
        }
        cone(sx * B1, sy * B1, 0.75);
      }
      box(0, 0, 0.05, 0.05, 0, 0.02, 0, LIME_DK);
      box(0, 0, 0.037, 0.037, 0.02, 0.038, 0, LIME);
      lathe(0, 0, [[0.021, 0.038], [0.014, 0.235]], 4, LIME_LT, { ph: Math.PI / 4 });
      lathe(0, 0, [[0.014, 0.235], [0, 0.268]], 4, GILT, { ph: Math.PI / 4 });
      bench(0.445, 0, Math.PI);
      bench(-0.445, 0, 0);
      break;
    }
    case 'pergola': {   // A pergola walk north to south: stone piers, timber over, wisteria hanging
      const PX = 0.14, YS = [-0.375, -0.125, 0.125, 0.375];
      for (const sx of [-1, 1]) {
        for (const y of YS) {
          box(sx * PX, y, 0.026, 0.026, 0, 0.022, 0, LIME_DK);
          box(sx * PX, y, 0.019, 0.019, 0.022, 0.172, 0, LIME);
          box(sx * PX, y, 0.026, 0.026, 0.172, 0.186, 0, LIME_LT);
        }
        box(sx * PX, 0, 0.012, 0.49, 0.186, 0.2, 0, TIMBER);
      }
      for (let i = 0, n = lod ? 7 : 13; i < n; i++) {
        const y = -0.45 + i * 0.9 / (n - 1);
        box(0, y, 0.19, 0.0065, 0.2, 0.211, 0, TIMBER);
      }
      // Wisteria along the top, and its flowers hanging through.
      const LEAF = [70, 118, 60], FLOWER = [168, 128, 206];
      for (const sx of [-1, 1]) for (let i = 0, n = lod ? 3 : 6; i < n; i++) {
        const y = -0.42 + (i + K.q(300 + i + (sx > 0 ? 10 : 0)) * 0.6) * 0.84 / n, x = sx * (PX - 0.02 + K.q(320 + i) * 0.05);
        lathe(x, y, [[0.03, 0.205], [0.045, 0.218], [0.03, 0.236], [0, 0.242]], lod ? 5 : 7, LEAF, { jit: 0.24, under: 1, ph: i });
        if (lod) continue;
        for (let j = 0; j < 3; j++) {
          const hx = x + (K.q(340 + i * 3 + j) - 0.5) * 0.06, hy = y + (K.q(360 + i * 3 + j) - 0.5) * 0.06;
          spike(hx, hy, 0.007, 0.206, hx, hy, 0.135 + K.q(380 + i * 3 + j) * 0.03, FLOWER, { jit: 0.15 });
        }
      }
      bench(0.098, 0, Math.PI);
      bench(-0.098, 0, 0);
      for (const sx of [-1, 1]) {
        tree(sx * 0.35, -0.22, 0.95, sx > 0 ? 401 : 411);
        shrub(sx * 0.36, 0.2, 0.034, BOX);
        shrub(sx * 0.4, 0.34, 0.028, YEW);
      }
      break;
    }
    case 'forecourt': {   // The plaza's furniture, from its focus
      const f = focusOf(fo);
      for (const p of LAMPS) {
        const [x, y] = toTile(f, p);
        if (!onTile([x, y])) continue;
        // A deco lamp standard: stepped granite base, a fluted bronze shaft, a tall ribbed torch and
        // a gilt crown. Taller than the park's lamp, because a plaza is lit for a crowd.
        box(x, y, 0.024, 0.024, 0, 0.014, 0, GRANITE);
        box(x, y, 0.017, 0.017, 0.014, 0.034, 0, GRANITE);
        lathe(x, y, [[0.009, 0.034], [0.0065, 0.25], [0.011, 0.258]], lod ? 4 : 8, BRONZE);
        const GL = lit ? [255, 222, 160] : [222, 220, 200];
        lathe(x, y, [[0.011, 0.258], [0.017, 0.28], [0.017, 0.33], [0.011, 0.345]], lod ? 4 : 8, GL, lit ? { emis: 1 } : {});
        lathe(x, y, [[0.013, 0.345], [0.004, 0.362], [0, 0.372]], 6, GILT);
      }
      for (const p of BENCHES) {
        const [x, y] = toTile(f, p);
        if (onTile([x, y], 0.42)) bench(x, y, -Math.PI / 2);
      }
      for (const p of PLANTERS) {
        const [x, y] = toTile(f, p);
        if (!onTile([x, y], 0.44)) continue;
        box(x, y, 0.05, 0.05, 0, 0.024, 0, GRANITE);
        box(x, y, 0.042, 0.042, 0.024, 0.05, 0, LIME);
        shrub(x, y, 0.04, BOX);
        if (!lod) lathe(x, y, [[0.012, 0.06], [0.014, 0.1], [0, 0.17]], 6, YEW, { jit: 0.18 });
      }
      for (let i = 0; i < FLAGS.length; i++) {
        const [x, y] = toTile(f, FLAGS[i]);
        if (!onTile([x, y], 0.48)) continue;
        lathe(x, y, [[0.012, 0], [0.012, 0.012], [0.006, 0.014], [0.0045, 0.42]], lod ? 4 : 6, BRONZE);
        lathe(x, y, [[0.007, 0.42], [0.007, 0.43], [0, 0.442]], 5, GILT);
        // The banner hangs off an arm toward the walk, flat to anyone walking up it, both faces.
        const out = FLAGS[i][0] > 0 ? -1 : 1, x1 = x + out * 0.075;
        box(x + out * 0.04, y, 0.04, 0.003, 0.398, 0.404, 0, BRONZE);
        const COLS = [[152, 34, 44], [28, 84, 104]], col = COLS[i % 4 < 2 ? 0 : 1];
        const P = [[x + out * 0.008, y, 0.396], [x1, y, 0.396], [x1, y, 0.24], [(x + x1) / 2, y, 0.215], [x + out * 0.008, y, 0.24]];
        face(P, col, [x, y + 0.01, 0.3]);
        face(P.slice().reverse(), col, [x, y - 0.01, 0.3]);
        if (!lod) {
          const G = [[x + out * 0.012, y, 0.37], [x1 - out * 0.004, y, 0.37], [x1 - out * 0.004, y, 0.358], [x + out * 0.012, y, 0.358]];
          face(G, GILT, [x, y + 0.012, 0.36]);
          face(G.slice().reverse(), GILT, [x, y - 0.012, 0.36]);
        }
      }
      for (const p of BOLLARDS) {
        const [x, y] = toTile(f, p);
        if (onTile([x, y], 0.49)) lathe(x, y, [[0.012, 0], [0.011, 0.05], [0.014, 0.054], [0.01, 0.064], [0, 0.07]], lod ? 5 : 8, BRONZE);
      }
      break;
    }
  }
}

// ── THE GROUND ───────────────────────────────────────────────────────────────
// `P`: { poly(pts, rgb, a, z), disc(r, rgb, a, ox, oy, n, z), glow(x, y, wz, rgbStr, s0, a), A, night, now, waterZ }
export function formalParkPaint(feature, P, fo) {
  const { poly, disc, glow, A, night } = P;
  const dk = (c) => night ? [c[0] * 0.48, c[1] * 0.5, c[2] * 0.54] : c;
  switch (feature) {
    case 'fountain': {
      const FLAG = dk([184, 176, 158]), JOINT = dk([150, 142, 126]);
      const oct = (r) => { const o = []; for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; o.push([Math.cos(a) * r, Math.sin(a) * r]); } return o; };
      poly(oct(0.47), FLAG, A);
      for (let i = 0; i < 8; i++) {
        const a = (i + 0.5) / 8 * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), w = 0.004;
        poly([[c * 0.37 - s * w, s * 0.37 + c * w], [c * 0.47 - s * w, s * 0.47 + c * w], [c * 0.47 + s * w, s * 0.47 - c * w], [c * 0.37 + s * w, s * 0.37 - c * w]], JOINT, A * 0.8);
      }
      // The water, deeper toward the middle, and the white water where the jets come down.
      const wz = P.waterZ;
      poly(oct(0.312), night ? [16, 40, 58] : [70, 128, 150], A, wz);
      poly(oct(0.25), night ? [14, 34, 52] : [56, 112, 140], A * 0.8, wz);
      const t = (P.now || 0) * 0.002;
      for (let i = 0; i < 16; i++) {
        const a0 = i / 16 * Math.PI * 2, a1 = (i + 1) / 16 * Math.PI * 2, r0 = 0.15, r1 = 0.185 + Math.sin(t + i * 1.7) * 0.008;
        poly([[Math.cos(a0) * r0, Math.sin(a0) * r0], [Math.cos(a1) * r0, Math.sin(a1) * r0], [Math.cos(a1) * r1, Math.sin(a1) * r1], [Math.cos(a0) * r1, Math.sin(a0) * r1]],
          night ? [120, 160, 200] : [224, 238, 242], A * 0.55, wz + 0.0003);
      }
      if (night) glow(0, 0, 0.03, '150,200,255', 18, A * 0.4);
      break;
    }
    case 'parterre': {
      poly([[-0.46, -0.46], [0.46, -0.46], [0.46, 0.46], [-0.46, 0.46]], dk([182, 170, 140]), A);   // raked gravel
      const B0 = 0.045, B1 = 0.4, IN = 0.012;
      const COLS = [dk([196, 50, 62]), dk([236, 232, 224]), dk([234, 186, 64]), dk([236, 232, 224])];
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        poly([[sx * B0, sy * B0], [sx * B1, sy * B0], [sx * B1, sy * B1], [sx * B0, sy * B1]], dk([66, 50, 38]), A, 0.0124);
        // The fan's four wedges of bedding between the hedges, from the bed's inner corner.
        const pt = (t) => { const c = Math.cos(t), s = Math.sin(t), L = (B1 - B0 - IN) / Math.max(c, s); return [sx * (B0 + c * L), sy * (B0 + s * L)]; };
        for (let i = 0; i < 4; i++) {
          const t0 = i * Math.PI / 8 + 0.07, t1 = (i + 1) * Math.PI / 8 - 0.07;
          const mid = (t0 + t1) / 2, cx = sx * (B0 + Math.cos(mid) * 0.05), cy = sy * (B0 + Math.sin(mid) * 0.05);
          const pts = [[cx, cy], pt(t0)];
          if (t0 < Math.PI / 4 && t1 > Math.PI / 4) pts.push([sx * (B1 - IN), sy * (B1 - IN)]);
          pts.push(pt(t1));
          poly(pts, COLS[i], A * 0.92, 0.0128);
        }
      }
      disc(0.075, dk(LIME), A, 0, 0, 16, 0.0124);
      break;
    }
    case 'pergola': {
      const FLAG = dk([192, 184, 166]), JOINT = dk([156, 148, 132]);
      poly([[-0.112, -0.5], [0.112, -0.5], [0.112, 0.5], [-0.112, 0.5]], FLAG, A);
      for (let i = -4; i <= 4; i++) { const y = i * 0.11; poly([[-0.112, y - 0.003], [0.112, y - 0.003], [0.112, y + 0.003], [-0.112, y + 0.003]], JOINT, A * 0.8); }
      // Lavender along both edges of the walk.
      for (const sx of [-1, 1]) {
        poly([[sx * 0.112, -0.47], [sx * 0.168, -0.47], [sx * 0.168, 0.47], [sx * 0.112, 0.47]], dk([70, 54, 40]), A);
        for (let i = 0; i < 12; i++) disc(0.02, dk(i % 3 ? [150, 124, 190] : [128, 104, 172]), A * 0.9, sx * 0.14, -0.43 + i * 0.078, 7, 0.006);
      }
      if (night) glow(0, 0, 0.004, '255,214,150', 12, A * 0.18);
      break;
    }
    case 'forecourt': {
      const S = { ring: dk([104, 100, 106]), ray: dk([166, 160, 150]), sun: dk([168, 118, 62]), gilt: dk([218, 172, 78]) };
      poly([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]], dk([192, 186, 172]), A);
      // A faint square grid of flag joints, under the pattern.
      for (let i = -4; i <= 4; i++) {
        const u = i * 0.125, J = dk([176, 170, 158]);
        poly([[u - 0.002, -0.5], [u + 0.002, -0.5], [u + 0.002, 0.5], [u - 0.002, 0.5]], J, A * 0.7);
        poly([[-0.5, u - 0.002], [0.5, u - 0.002], [0.5, u + 0.002], [-0.5, u + 0.002]], J, A * 0.7);
      }
      const pave = forecourtPaving(fo);
      for (const k of ['ray', 'ring', 'sun', 'gilt']) for (const s of pave) if (s.k === k) poly(s.p, S[k], A);
      if (night) for (const [x, y] of pave.lights) glow(x, y, 0.004, '255,222,160', 16, A * 0.26);
      break;
    }
  }
}
