// GLASS 2 · THE TONIGHT SHOW'S PIECES. Rows for set-mesh.js's SET_PIECES, first for KSAB-TV's
// Tonight Show (set_tonight): Coldwater at night through a picture window, a dressed host's desk,
// a tufted couch, a band on its riser, a swagged curtain, a parquet deck and a truss full of lamps.
// Each row is a label, its fields and a `draw(K, p, set)` built from the room kit (room-kit.js), in
// metres, as set-mesh.js's own rows are. Nothing here names the show: a piece reads the set's brand
// and palette, so another talk show can take any of them.
//
// set-mesh.js hands in its lettering (`tonightPieces({ letterOn, brandText, letterWidth })`), so this file
// imports nothing from it and there's no import cycle.
//
// ⚠ A PIECE'S +x IS THE VIEWER'S LEFT when it faces the cameras, and K's points are [u, v, y].
// ⚠ `lift` stands a piece on a deck: everything it draws goes up by that much. A mark on the
// same deck needs the same `lift`, and a desk's `table.h` counts from the studio floor.

import { MAT } from './ballpark-mesh.js';

const { GLOSS, METAL, SATIN, CLOTH, LEATHER, EMISSIVE } = MAT;
const TAU = Math.PI * 2;

const num = (v, d) => (Number.isFinite(+v) && v !== '' && v != null ? +v : d);
const facingOf = (yaw) => { const a = (yaw || 0) * Math.PI / 180; return [Math.sin(a), Math.cos(a)]; };
const F = (k, label, type = 'number') => ({ k, label, type });
const frameOf = (K, p, yaw = 180) => { const [fu, fv] = facingOf(p.yaw ?? yaw); return K.frame(p.at[0], p.at[1], fu, fv); };
function arc(n, a0, a1, fn) { for (let i = 0; i < n; i++) fn(a0 + (a1 - a0) * i / n, a0 + (a1 - a0) * (i + 1) / n); }
// A seeded roll, so a backdrop is the same city every time it's built.
function rollOf(seed) { let s = ((Math.abs(Math.round(seed)) * 9301 + 49297) % 2147483646) + 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
// What's drawn inside `fn` stands `lift` up.
function lifted(K, p, fn) { K.lift(num(p.lift, 0)); try { fn(); } finally { K.lift(0); } }
// A colour darker or lighter by `k`, as hex.
function shade(hex, k) {
  const n = parseInt(String(hex).replace('#', ''), 16), c = (s) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * k)));
  return '#' + [c(16), c(8), c(0)].map((v) => v.toString(16).padStart(2, '0')).join('');
}
const brandColour = (set, p) => p.colour || set.brand?.colour || set.palette?.accent || '#e8a040';

// A cylinder between two room points [u, v, y], `n` facets round, capped or not. A bar is one with four.
function tube(K, A, B, r, hex, k = 1, n = 10, mat = METAL, caps = false) {
  const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L = Math.hypot(d[0], d[1], d[2]) || 1, dn = d.map((c) => c / L);
  let e1 = Math.abs(dn[2]) > 0.95 ? [1, 0, 0] : [dn[1], -dn[0], 0];
  const l1 = Math.hypot(e1[0], e1[1], e1[2]); e1 = e1.map((c) => c / l1);
  const e2 = [dn[1] * e1[2] - dn[2] * e1[1], dn[2] * e1[0] - dn[0] * e1[2], dn[0] * e1[1] - dn[1] * e1[0]];
  const col = K.C(hex, k), raw = k >= 1.25;
  const at = (P, a) => [P[0] + (e1[0] * Math.cos(a) + e2[0] * Math.sin(a)) * r, P[1] + (e1[1] * Math.cos(a) + e2[1] * Math.sin(a)) * r, P[2] + (e1[2] * Math.cos(a) + e2[2] * Math.sin(a)) * r];
  const nr = (a) => { const c = Math.cos(a), s = Math.sin(a); return K.nrmOf(e1[0] * c + e2[0] * s, e1[2] * c + e2[2] * s, e1[1] * c + e2[1] * s); };
  arc(n, 0, TAU, (a, b) => {
    K.quad(K.solid, [at(A, a), at(B, a), at(B, b), at(A, b)], nr((a + b) / 2), col, mat, null, raw);
    if (caps) {
      K.quad(K.solid, [A, at(A, b), at(A, a), at(A, a)], K.nrmOf(-dn[0], -dn[2], -dn[1]), col, mat, null, raw);
      K.quad(K.solid, [B, at(B, a), at(B, b), at(B, b)], K.nrmOf(dn[0], dn[2], dn[1]), col, mat, null, raw);
    }
  });
}
const bar = (K, A, B, t, hex, k = 1, mat = METAL) => tube(K, A, B, t, hex, k, 4, mat);
// A flat disc in a piece's frame, facing out of its front (+z) at depth z.
function disc(K, fr, x, y, z, r, hex, k = 1, n = 20, mat = EMISSIVE, raw = true) {
  const col = K.C(hex, k), nz = fr.N(0, 0, 1), c = fr.P(x, y, z), at = (a) => fr.P(x + Math.cos(a) * r, y + Math.sin(a) * r, z);
  arc(n, 0, TAU, (a, b) => K.quad(K.solid, [c, at(a), at(b), at(b)], nz, col, mat, null, raw));
}
// A ring round an upright axis, as a lathe of a small circle: a torus.
const torus = (K, u, v, y, R, r, hex, k = 1, n = 18, mat = METAL) => K.lathe(u, v, Array.from({ length: 9 }, (_, i) => { const a = Math.PI / 2 + i / 8 * TAU; return [R + Math.cos(a) * r, y + Math.sin(a) * r]; }), hex, k, n, mat);

// ── The panelled wall a window is cut in ──
// Raised fields in moulded frames over a backing board, a dado rail and a skirting: walnut, as a
// studio dresses a wall the cameras see.
function panelWall(K, fr, x0, x1, y0, y1, wood, rail = 1.0) {
  if (x1 - x0 < 0.05 || y1 - y0 < 0.05) return;
  const { pbox } = fr, dark = shade(wood, 0.6), field = shade(wood, 1.12);
  pbox(x0, x1, y0, y1, -0.06, 0, wood, 1, null, SATIN);
  const bands = [];
  if (y0 < 0.2) { pbox(x0, x1, y0, 0.16, 0, 0.025, dark, 1, null, SATIN); bands.push([0.22, rail - 0.06]); }
  if (rail > y0 && rail < y1 - 0.1) { pbox(x0, x1, rail - 0.04, rail + 0.04, 0, 0.035, dark, 1, null, SATIN); bands.push([rail + 0.1, y1 - 0.08]); }
  if (!bands.length) bands.push([y0 + 0.08, y1 - 0.08]);
  for (const [a, b] of bands) {
    const lo = Math.max(a, y0 + 0.06), hi = Math.min(b, y1 - 0.06);
    if (hi - lo < 0.12) continue;
    const cols = Math.max(1, Math.round((x1 - x0) / 1.05)), rows = Math.max(1, Math.round((hi - lo) / 1.4)), cw = (x1 - x0) / cols, rh = (hi - lo) / rows;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const px0 = x0 + i * cw + 0.07, px1 = x0 + (i + 1) * cw - 0.07, py0 = lo + j * rh + 0.04, py1 = lo + (j + 1) * rh - 0.04;
      pbox(px0 + 0.04, px1 - 0.04, py0 + 0.04, py1 - 0.04, 0, 0.014, field, 1, null, SATIN);
      pbox(px0, px1, py0, py0 + 0.04, 0, 0.026, dark, 1, null, SATIN);
      pbox(px0, px1, py1 - 0.04, py1, 0, 0.026, dark, 1, null, SATIN);
      pbox(px0, px0 + 0.04, py0, py1, 0, 0.026, dark, 1, null, SATIN);
      pbox(px1 - 0.04, px1, py0, py1, 0, 0.026, dark, 1, null, SATIN);
    }
  }
}

// ── Coldwater at night, as a painted backdrop ──
// West is glass and money, east is brick and work (docs/reference/building-styles.md), so the
// Glasshouse burns cyan on the viewer's left and the works sodium on the right, the Meridian's
// verdigris crown between them. In front: the Basin, the quay with its two cranes, the pier and
// The Beacon at its end. Layers stand at their own depths, so the city moves as a camera does.
function coldwater(K, p, letterOn) {
  const w = num(p.w, 15), H = num(p.h, 4.4), D = num(p.depth, 3.2), y0 = num(p.horizon, 1.45), fr = frameOf(K, p), { P, N } = fr, rnd = rollOf(num(p.seed, 4));
  const lit = (x0, x1, a, b, z, hex, k = 1) => fr.front(K.solid, x0, x1, a, b, z, K.C(hex, k), EMISSIVE);
  const tri = (a, b, c, z, hex, k = 1) => K.quad(K.solid, [P(a[0], a[1], z), P(b[0], b[1], z), P(c[0], c[1], z), P(c[0], c[1], z)], N(0, 0, 1), K.C(hex, k), EMISSIVE, null, true);
  const X = (t) => -w / 2 + t * w;   // t = 0 is the east end, the viewer's right
  const SHORE = 1.84, wy = (z) => y0 - Math.max(0, (z - SHORE) / Math.max(0.3, D - SHORE)) * 0.55;
  const refl = [];

  // the sky, in flat bands: warm where the city lights it, black at the top
  const SKY = ['#5c2c50', '#48264e', '#38214c', '#2a1d48', '#1e1942', '#15163a', '#0f1231', '#0a0e28', '#070a20', '#05071a'];
  let ya = y0 - 1;
  SKY.forEach((c, i) => { const yb = i === SKY.length - 1 ? y0 + H : y0 + H * ((i + 1) / SKY.length) ** 1.6; lit(-w / 2, w / 2, ya, yb, 0, c); ya = yb; });
  for (let i = 0; i < 110; i++) {
    const x = (rnd() - 0.5) * w, y = y0 + H * (0.38 + rnd() * 0.6), s = 0.006 + rnd() ** 4 * 0.018, c = rnd() < 0.2 ? '#ffe6c0' : '#dfe8ff', k = 0.7 + rnd() * 1.1;
    lit(x - s, x + s, y - s, y + s, 0.004, c, k);
    if (s > 0.014) { lit(x - s * 3, x + s * 3, y - 0.002, y + 0.002, 0.004, c, k * 0.7); lit(x - 0.002, x + 0.002, y - s * 3, y + s * 3, 0.004, c, k * 0.7); }
  }
  // the moon over the Glasshouse, its halo, and its seas
  const mx = w * 0.3, my = y0 + H * 0.66, mr = 0.27;
  disc(K, fr, mx, my, 0.001, mr * 2.4, '#1a1a48', 1, 28);
  disc(K, fr, mx, my, 0.002, mr * 1.55, '#2a2a5c', 1, 28);
  disc(K, fr, mx, my, 0.003, mr, '#f2ead0', 1.5, 28);
  for (const [dx, dy, r] of [[-0.08, 0.06, 0.07], [0.06, -0.04, 0.09], [0.1, 0.1, 0.04], [-0.05, -0.12, 0.05]]) disc(K, fr, mx + dx, my + dy, 0.0035, r, '#cdc2a2', 1.45, 14);
  refl.push([mx, '#e8e0c8', 0.55, 0.16, 'moon']);
  // cloud, lit from under by the town
  for (let i = 0; i < 6; i++) {
    const cx = (rnd() - 0.5) * w * 0.9, cy = y0 + H * (0.42 + rnd() * 0.42), L = 0.9 + rnd() * 2.4, t = 0.035 + rnd() * 0.05;
    lit(cx - L / 2, cx + L / 2, cy, cy + t, 0.006, '#1c1840');
    lit(cx - L / 2 + 0.2, cx + L / 2 - 0.1, cy + t, cy + t * 1.6, 0.006, '#1c1840');
    lit(cx - L / 2 + 0.12, cx + L / 2 - 0.15, cy - 0.016, cy, 0.006, '#5a3460');
  }
  // two aircraft, a light ahead and a red one behind
  for (const [ax, ay] of [[-w * 0.18, y0 + H * 0.66], [w * 0.05, y0 + H * 0.88]]) { lit(ax - 0.012, ax + 0.012, ay - 0.012, ay + 0.012, 0.007, '#ffffff', 2); lit(ax + 0.07, ax + 0.086, ay - 0.008, ay + 0.008, 0.007, '#ff3020', 1.8); }

  // the Curtain on the horizon, the Architect's wall: a violet shimmer behind the far shore
  for (let x = -w / 2; x < w / 2; x += 0.025 + rnd() * 0.05) {
    const hh = 0.3 + rnd() * 0.85, c = rnd() < 0.3 ? '#8a70e8' : '#6a52c0', cw = 0.008 + rnd() * 0.018;
    lit(x, x + cw, y0, y0 + hh * 0.5, 0.05, c, 0.7 + rnd() * 0.3);
    lit(x, x + cw, y0 + hh * 0.5, y0 + hh, 0.05, c, 0.42);
  }

  // window helpers: cool in the west, warm in the middle, sodium in the east
  const WIN = [['#ffb050', '#ffc878', '#ffdc9a', '#ff9a3a'], ['#ffe8b8', '#fff2d8', '#cfe8ff', '#ffe0a0'], ['#bfe6ff', '#8fd0ff', '#e6f6ff', '#c8b0ff']];
  const winOf = (x) => { const t = (x + w / 2) / w, s = WIN[t > 0.6 ? 2 : t > 0.34 ? 1 : 0]; return s[Math.floor(rnd() * s.length)]; };
  const windows = (x0, x1, b0, b1, z, cw, ch, gx, gy, odds, k, hex = null) => {
    for (let yy = b0 + gy; yy < b1 - ch - gy * 0.5; yy += ch + gy) {
      const row = odds * (0.3 + rnd() * 1.3);
      for (let xx = x0 + gx; xx < x1 - cw - gx * 0.5; xx += cw + gx) if (rnd() < row) lit(xx, xx + cw, yy, yy + ch, z, hex || winOf(xx), k * (0.7 + rnd() * 0.5));
    }
  };
  // a cut-out with sides, so a camera off to one side sees it has depth
  const block = (x0, x1, b0, b1, z, hex, dz = 0.12) => {
    lit(x0, x1, b0, b1, z, hex);
    const side = shade(hex, 0.7);
    for (const x of [x0, x1]) K.quad(K.solid, [P(x, b0, z), P(x, b0, z - dz), P(x, b1, z - dz), P(x, b1, z)], N(Math.sign(x - (x0 + x1) / 2), 0, 0), K.C(side), EMISSIVE, null, true);
    K.quad(K.solid, [P(x0, b1, z), P(x1, b1, z), P(x1, b1, z - dz), P(x0, b1, z - dz)], N(0, 1, 0), K.C(side), EMISSIVE, null, true);
  };
  const redLight = (x, y, z) => { lit(x - 0.011, x + 0.011, y - 0.011, y + 0.011, z + 0.003, '#ff2a18', 2.4); lit(x - 0.03, x + 0.03, y - 0.03, y + 0.03, z + 0.002, '#4a1830', 1); };
  const mast = (x, y, h, z) => { lit(x - 0.006, x + 0.006, y, y + h, z, '#0a0c14'); redLight(x, y + h, z); redLight(x, y + h * 0.55, z); };

  // the far shore: a low town to the horizon
  for (let x = -w / 2; x < w / 2;) {
    const bw = 0.07 + rnd() * 0.24, bh = 0.08 + rnd() ** 1.7 * 0.7 * (1 - Math.abs(x) / w * 0.8);
    lit(x, x + bw, y0 - 0.05, y0 + bh, 0.3, '#0d1228');
    windows(x, x + bw, y0, y0 + bh, 0.302, 0.011, 0.013, 0.011, 0.016, 0.24, 0.85);
    x += bw;
  }

  // the city behind the waterfront: fillers, then the landmarks over them
  for (let x = -w / 2; x < w / 2;) {
    const bw = 0.18 + rnd() * 0.32, bh = 0.5 + rnd() ** 1.3 * 1.5, z = 0.62 + rnd() * 0.1;
    block(x, x + bw, y0 - 0.1, y0 + bh, z, '#0b0f1e', 0.08);
    windows(x, x + bw, y0, y0 + bh, z + 0.002, 0.016, 0.02, 0.014, 0.022, 0.3, 0.95);
    if (rnd() < 0.18) mast(x + bw * 0.5, y0 + bh, 0.16, z);
    x += bw + rnd() * 0.05;
  }
  const tower = (t, bw, bh, z, o = {}) => {
    const x = X(t), body = o.body || '#0c1120', tiers = o.tiers || [[1, 1]];
    let yb = y0 - 0.15, wNow = bw;
    for (const [frac, kw] of tiers) {
      const yt = y0 + bh * frac, hw = (bw * kw) / 2;
      block(x - hw, x + hw, yb, yt, z, body, o.dz || 0.14);
      if (o.bands) for (let yy = yb + 0.25; yy < yt - 0.03; yy += o.bands) lit(x - hw + 0.012, x + hw - 0.012, yy, yy + 0.008, z + 0.002, o.band || '#5fd8ff', o.bk || 1.25);
      if (o.bands && o.mull) for (let xx = x - hw + o.mull; xx < x + hw - 0.01; xx += o.mull) lit(xx, xx + 0.004, yb + 0.2, yt - 0.02, z + 0.003, shade(body, 0.6));
      if (!o.bands || o.wins) windows(x - hw, x + hw, Math.max(yb, y0 + 0.05), yt, z + 0.002, o.cw || 0.017, o.ch || 0.022, o.gx || 0.013, o.gy || 0.02, o.odds ?? 0.4, o.wk || 1.1, o.win || null);
      yb = yt; wNow = bw * kw;
    }
    if (o.crown) lit(x - wNow / 2, x + wNow / 2, yb - 0.035, yb - 0.012, z + 0.004, o.crown, 2);
    if (o.spire) { tri([x - 0.025, yb], [x + 0.025, yb], [x, yb + o.spire], z, body); redLight(x, yb + o.spire, z); }
    if (o.mast) mast(x + wNow * 0.25, yb, o.mast, z);
    if (o.tank) {
      const tx = x - wNow * 0.22, ty = yb, [u, v] = P(tx, 0, z - 0.06);
      for (const s of [-1, 1]) lit(tx + s * 0.03, tx + s * 0.03 + 0.005, ty, ty + 0.07, z + 0.001, '#0a0c12');
      K.lathe(u, v, [[0.035, ty + 0.07], [0.035, ty + 0.13], [0.03, ty + 0.14], [0, ty + 0.16]], '#14100e', 1, 10, EMISSIVE);
    }
    refl.push([x, o.refl || (o.band && o.bands ? o.band : t > 0.6 ? '#9ad8ff' : t > 0.34 ? '#ffe0a0' : '#ffb050'), 0.5, bw * 0.28]);
    return { x, top: yb, w: wNow };
  };

  // east: brick and work, sodium windows, water tanks, a stack
  tower(0.03, 0.5, 1.0, 1.2, { body: '#140f0e', odds: 0.45, tank: 1, win: null });
  {
    const x = X(0.085), [u, v] = P(x, 0, 1.0);
    K.lathe(u, v, [[0.075, y0 - 0.1], [0.07, y0 + 1.6], [0.055, y0 + 2.2], [0.06, y0 + 2.24], [0, y0 + 2.24]], '#1a1210', 1, 12, EMISSIVE);
    for (const hy of [1.4, 1.85, 2.18]) K.lathe(u, v, [[0.074 - hy * 0.008, y0 + hy], [0.074 - hy * 0.008, y0 + hy + 0.02]], '#ff3020', 2.2, 12);
    for (let i = 0; i < 9; i++) disc(K, fr, x + 0.04 + i * 0.09, y0 + 2.28 + i * 0.035 + Math.sin(i) * 0.02, 0.62 - i * 0.005, 0.05 + i * 0.012, ['#4a3a52', '#3e3450', '#342e4c', '#2a2848', '#24234a', '#202046', '#1d1d44', '#1b1b42', '#191a40'][i], 1, 12);
    refl.push([x, '#ff3020', 0.5, 0.02]);
  }
  tower(0.13, 0.45, 1.6, 1.3, { body: '#16100e', tiers: [[0.8, 1], [1, 0.7]], odds: 0.42, tank: 1 });
  tower(0.18, 0.6, 0.9, 1.1, { body: '#120e0e', odds: 0.5, tank: 1 });
  tower(0.225, 0.38, 2.0, 1.0, { body: '#10101a', tiers: [[0.85, 1], [1, 0.75]], odds: 0.38, mast: 0.35 });
  tower(0.27, 0.55, 1.2, 1.36, { body: '#151010', odds: 0.48 });
  tower(0.31, 0.3, 1.5, 0.86, { body: '#0f0f18', odds: 0.35 });
  // the middle: the Lucky Bastard's sign, warm towers, and the Meridian
  {
    const c = tower(0.365, 0.78, 1.0, 1.3, { body: '#120c16', odds: 0.25 });
    const sy = c.top + 0.03, sw = 0.7, z = 1.31;
    lit(c.x - sw / 2 - 0.03, c.x + sw / 2 + 0.03, sy, sy + 0.17, z, '#1a0a14');
    for (let xx = c.x - sw / 2; xx <= c.x + sw / 2 + 0.001; xx += 0.035) for (const yy of [sy + 0.012, sy + 0.158]) lit(xx - 0.005, xx + 0.005, yy - 0.005, yy + 0.005, z + 0.003, '#ffd890', 2.2);
    letterOn(K, fr, 'LUCKY BASTARD', { cx: c.x, y: sy + 0.045, z: z + 0.004, h: 0.08, maxW: sw - 0.04, hex: '#ff2e8e', k: 2.3 });
    lit(c.x + c.w / 2 - 0.03, c.x + c.w / 2 - 0.012, y0 + 0.2, c.top - 0.05, z + 0.004, '#ff2e8e', 2);
    refl.push([c.x, '#ff2e8e', 0.6, 0.16]);
  }
  tower(0.41, 0.4, 2.3, 0.95, { body: '#0d0e1a', odds: 0.4, tiers: [[0.9, 1], [1, 0.8]], crown: '#ffc070' });
  tower(0.47, 0.36, 1.8, 1.25, { body: '#0e0f1a', odds: 0.44 });
  {
    // the Meridian: limestone and reeded piers, stepped to a verdigris crown and a gilt spire
    const x = X(0.525), z = 1.05, stone = '#2c2820', lit1 = '#d8c898';
    const tiers = [[2.0, 0.62], [2.42, 0.5], [2.72, 0.38], [2.92, 0.26]];
    let yb = y0 - 0.15;
    tiers.forEach(([top, bw], i) => {
      const yt = y0 + top, hw = bw / 2;
      block(x - hw, x + hw, yb, yt, z, stone, 0.18);
      if (i === 0) {
        for (let xx = x - hw + 0.03; xx < x + hw - 0.03; xx += 0.07) {
          lit(xx, xx + 0.012, y0 + 0.1, yt - 0.08, z + 0.002, '#4a4232');
          for (let yy = y0 + 0.14; yy < yt - 0.12; yy += 0.065) if (rnd() < 0.55) lit(xx + 0.02, xx + 0.05, yy, yy + 0.038, z + 0.003, rnd() < 0.8 ? '#ffe0a0' : '#fff4d8', 1 + rnd() * 0.3);
        }
      } else {
        // floodlit from the setback below: bright at the foot, fading up
        lit(x - hw, x + hw, yb, yb + (yt - yb) * 0.55, z + 0.003, lit1, 1.35);
        lit(x - hw, x + hw, yb + (yt - yb) * 0.55, yt, z + 0.003, shade(lit1, 0.7), 1.3);
        for (let xx = x - hw + 0.025; xx < x + hw - 0.02; xx += 0.05) lit(xx, xx + 0.01, yb + 0.02, yt - 0.02, z + 0.004, '#8a7a58', 1.3);
      }
      lit(x - hw - 0.012, x + hw + 0.012, yt - 0.03, yt, z + 0.005, '#5ab49a', 1.45);
      // a row of gilt chevrons along each setback
      for (let xx = x - hw + 0.02; xx < x + hw - 0.03; xx += 0.045) tri([xx, yt - 0.03], [xx + 0.04, yt - 0.03], [xx + 0.02, yt - 0.065], z + 0.006, '#e8c060', 1.5);
      yb = yt;
    });
    tri([x - 0.06, yb], [x + 0.06, yb], [x, yb + 0.22], z + 0.003, '#5ab49a', 1.4);
    tri([x - 0.014, yb + 0.1], [x + 0.014, yb + 0.1], [x, yb + 0.48], z + 0.004, '#e8c060', 1.5);
    redLight(x, yb + 0.48, z + 0.004);
    refl.push([x, '#e8d4a0', 0.7, 0.14]);
  }
  tower(0.575, 0.32, 2.0, 1.35, { body: '#0d1120', odds: 0.42, mast: 0.25 });
  // west: the Glasshouse, curtain walls banded in cyan and violet, magenta for punctuation
  tower(0.625, 0.3, 2.5, 1.0, { body: '#0a1424', bands: 0.06, band: '#7fe0ff', bk: 1.3, mull: 0.05 });
  lit(X(0.625) - 0.15 - 0.012, X(0.625) - 0.15, y0 + 0.4, y0 + 2.4, 1.004, '#ff2e8e', 2);
  {
    // Voltage: a tapering drum with a lid
    const x = X(0.685), z = 1.15, [u, v] = P(x, 0, z), top = y0 + 3.3;
    K.lathe(u, v, [[0.21, y0 - 0.15], [0.17, top], [0, top]], '#081220', 1, 24, EMISSIVE);
    for (let yy = y0 + 0.25, i = 0; yy < top - 0.05; yy += 0.07, i++) K.lathe(u, v, [[0.212 - (yy - y0) / 3.3 * 0.04, yy], [0.212 - (yy - y0) / 3.3 * 0.04, yy + 0.012]], i % 9 === 4 ? '#c8a8ff' : '#6fdcff', 1.5, 24);
    K.lathe(u, v, [[0.17, top], [0.25, top + 0.03], [0.25, top + 0.06], [0, top + 0.07]], '#0c1424', 1, 24, EMISSIVE);
    K.lathe(u, v, [[0.251, top + 0.032], [0.251, top + 0.05]], '#ff2e8e', 2.2, 24);
    mast(x, top + 0.07, 0.35, z - 0.1);
    refl.push([x, '#6fdcff', 0.7, 0.1]);
  }
  tower(0.75, 0.55, 2.8, 0.9, { body: '#0b1426', bands: 0.055, band: '#5fd8ff', bk: 1.25, mull: 0.06, tiers: [[0.88, 1], [1, 0.72]], crown: '#ff2e8e', spire: 0.3 });
  tower(0.81, 0.4, 2.0, 1.3, { body: '#100c22', bands: 0.06, band: '#b49cff', bk: 1.3, mull: 0.05 });
  tower(0.87, 0.6, 3.0, 1.05, { body: '#0a1222', bands: 0.065, band: '#9ae8ff', bk: 1.25, mull: 0.07, tiers: [[0.78, 1], [0.92, 0.75], [1, 0.5]], spire: 0.35 });
  tower(0.93, 0.5, 1.6, 1.25, { body: '#0c1424', odds: 0.4, win: '#bfe6ff' });
  tower(0.98, 0.45, 2.2, 0.95, { body: '#0a1020', bands: 0.06, band: '#7fe0ff', bk: 1.2, mull: 0.05, crown: '#c8a8ff' });

  // the waterfront: warehouses along the quay, its lamps, the cranes, the pier and The Beacon
  for (let x = -w / 2; x < w / 2;) {
    const bw = 0.25 + rnd() * 0.6, bh = 0.08 + rnd() * 0.22;
    block(x, x + bw, y0 - 0.02, y0 + bh, 1.78, '#0a0c12', 0.1);
    windows(x, x + bw, y0 + 0.02, y0 + bh, 1.782, 0.02, 0.018, 0.04, 0.03, 0.15, 1.1);
    if (rnd() < 0.3) tri([x, y0 + bh], [x + bw, y0 + bh], [x + bw / 2, y0 + bh + 0.06], 1.78, '#0a0c12');
    x += bw;
  }
  lit(-w / 2, w / 2, y0 - 0.03, y0 + 0.02, SHORE + 0.005, '#161820');
  for (let x = -w / 2 + 0.1; x < w / 2; x += 0.24) {
    lit(x - 0.003, x + 0.003, y0 + 0.02, y0 + 0.13, SHORE + 0.006, '#0a0b10');
    lit(x - 0.012, x + 0.012, y0 + 0.125, y0 + 0.14, SHORE + 0.007, x < X(0.4) ? '#ffb040' : '#fff0d0', 2.2);
    refl.push([x, x < X(0.4) ? '#ffb040' : '#fff0d0', 0.8, 0.012, 'lamp']);
  }
  // two quay cranes on the east quay, booms out over the water
  for (const t of [0.14, 0.235]) {
    const x = X(t), z = 1.82, apex = y0 + 0.58, red = '#7a2e1c';
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bar(K, P(x + sx * 0.1, y0, z + sz * 0.08), P(x + sx * 0.05, apex, z + sz * 0.04), 0.008, red, 0.9);
    bar(K, P(x - 0.05, apex - 0.25, z), P(x + 0.05, apex - 0.25, z), 0.006, red, 0.9);
    fr.pbox(x - 0.03, x + 0.03, apex - 0.02, apex + 0.02, z - 0.45, z + 0.75, red, 0.85, null, METAL);
    fr.pbox(x - 0.06, x + 0.06, apex + 0.02, apex + 0.12, z - 0.3, z - 0.05, '#6a2a1a', 0.8, null, METAL);
    for (const zz of [z + 0.2, z + 0.5, z + 0.73]) { fr.pbox(x - 0.015, x + 0.015, apex - 0.04, apex - 0.025, zz - 0.02, zz + 0.02, '#ffd080', 2.2); refl.push([x, '#ffc070', 0.6, 0.03, 'lamp']); }
    bar(K, P(x, apex + 0.12, z - 0.15), P(x, apex + 0.3, z - 0.15), 0.006, red, 0.85);
    bar(K, P(x, apex + 0.3, z - 0.15), P(x, apex + 0.02, z + 0.7), 0.003, '#3a1a12', 1);
    const tip = P(x, apex + 0.31, z - 0.15);
    K.ball(tip[0], tip[1], tip[2], 0.014, '#ff2a18', 2.4, 8);
  }
  // the pier and The Beacon at its end: a black hexagonal foot, a waist thinner than a man, a flared collar and a drum of dark glass
  {
    const x = X(0.605), z1 = 2.5;
    fr.pbox(x - 0.06, x + 0.06, y0 - 0.02, y0 + 0.025, SHORE, z1 + 0.05, '#1a1c24', 1, null, SATIN);
    for (let z = SHORE + 0.06; z < z1; z += 0.13) {
      bar(K, P(x + 0.055, y0 + 0.025, z), P(x + 0.055, y0 + 0.1, z), 0.003, '#0a0b10', 1);
      const q = P(x + 0.055, y0 + 0.104, z); K.ball(q[0], q[1], q[2], 0.008, '#ffe8c0', 2.2, 6);
      refl.push([x + 0.055, '#ffe8c0', 0.5, 0.008, 'lamp', z]);
    }
    const [u, v] = P(x, 0, z1), b = y0 + 0.025;
    K.lathe(u, v, [[0.085, b], [0.085, b + 0.05], [0.06, b + 0.075], [0.026, b + 0.26], [0.014, b + 0.33], [0.024, b + 0.4], [0.08, b + 0.45], [0.08, b + 0.475], [0, b + 0.475]], '#0c0d12', 1, 6, METAL);
    for (let i = 0; i < 3; i++) { const a = i * TAU / 3 + 0.3; bar(K, [u + Math.cos(a) * 0.075, v + Math.sin(a) * 0.075, b + 0.05], [u + Math.cos(a) * 0.022, v + Math.sin(a) * 0.022, b + 0.4], 0.006, '#1a1c22', 1); }
    K.lathe(u, v, [[0.048, b + 0.475], [0.055, b + 0.53], [0.05, b + 0.6], [0.025, b + 0.64], [0, b + 0.65]], '#1a2c3e', 1, 8, GLOSS);
    K.ball(u, v, b + 0.55, 0.03, '#fff6d8', 3.2, 10);
    // its light, caught as it comes round to you: a flare, a halo and four points
    const lz = z1 + 0.07, ly = b + 0.55;
    disc(K, fr, x, ly, lz, 0.14, '#2a2c5a', 1, 18);
    disc(K, fr, x, ly, lz + 0.001, 0.07, '#8a8cc0', 1, 18);
    disc(K, fr, x, ly, lz + 0.002, 0.035, '#fff4d0', 2.4, 14);
    for (const [dx, dy] of [[0.42, 0.006], [0.006, 0.2]]) lit(x - dx, x + dx, ly - dy, ly + dy, lz + 0.003, '#e8e4ff', 1.5);
    refl.push([x, '#fff6d8', 1.1, 0.04, 'beacon', z1]);
  }
  // a few boats out on the Basin, riding lights on
  for (const [t, z] of [[0.3, 2.25], [0.46, 2.75], [0.8, 2.15], [0.92, 2.6]]) {
    const x = X(t), yb = wy(z);
    fr.pbox(x - 0.07, x + 0.07, yb, yb + 0.03, z - 0.025, z + 0.025, '#0c0e14', 1, null, SATIN);
    fr.pbox(x - 0.03, x + 0.02, yb + 0.03, yb + 0.06, z - 0.018, z + 0.018, '#14161e', 1, null, SATIN);
    lit(x - 0.025, x + 0.015, yb + 0.04, yb + 0.05, z + 0.019, '#ffe0a0', 1.6);
    bar(K, P(x + 0.01, yb + 0.06, z), P(x + 0.01, yb + 0.16, z), 0.002, '#0a0a0e', 1);
    const m = P(x + 0.01, yb + 0.165, z); K.ball(m[0], m[1], m[2], 0.007, '#ffffff', 2.4, 6);
    lit(x + 0.06, x + 0.07, yb + 0.02, yb + 0.03, z + 0.026, '#ff3020', 2.2);
    lit(x - 0.07, x - 0.06, yb + 0.02, yb + 0.03, z + 0.026, '#30ff60', 2.2);
    refl.push([x, '#ffe0a0', 0.6, 0.02, 'boat', z]);
  }

  // the Basin: raked toward the window so the cameras see it, black, and broken lights on it
  K.quad(K.solid, [P(-w / 2, wy(SHORE), SHORE), P(w / 2, wy(SHORE), SHORE), P(w / 2, wy(D), D), P(-w / 2, wy(D), D)], N(0, 1, 0), K.C('#060914'), EMISSIVE, null, true);
  for (let i = 0; i < 260; i++) { const x = (rnd() - 0.5) * w, z = SHORE + rnd() * (D - SHORE), L = 0.1 + rnd() * 0.35; lineOnWater(x - L / 2, x + L / 2, z, 0.004, '#141a30', 1); }
  function lineOnWater(xa, xb, z, dz, hex, k) { K.quad(K.solid, [P(xa, wy(z) + 0.002, z), P(xb, wy(z) + 0.002, z), P(xb, wy(z + dz) + 0.002, z + dz), P(xa, wy(z + dz) + 0.002, z + dz)], N(0, 1, 0), K.C(hex, k), EMISSIVE, null, true); }
  for (const [x, hex, k, wid, kind, from] of refl) {
    const z0 = (from ?? SHORE) + 0.01, len = kind === 'moon' ? D - z0 : kind === 'lamp' ? 0.5 + rnd() * 0.4 : kind === 'boat' ? 0.25 : D - z0;
    for (let z = z0; z < Math.min(D - 0.02, z0 + len);) {
      const dz = 0.012 + rnd() * 0.04, f = (z - z0) / Math.max(0.1, len), hw = wid * (0.35 + rnd() * 0.9) * (1 + f * 0.8), jx = (rnd() - 0.5) * wid * 0.9;
      if (rnd() < (kind === 'moon' ? 0.55 : 0.72)) lineOnWater(x + jx - hw, x + jx + hw, z, dz, hex, k * (1 - f * 0.65) * (0.7 + rnd() * 0.5));
      z += dz + 0.008 + rnd() * 0.03;
    }
  }
}

// ── The rows ──────────────────────────────────────────────────────────────────────────────────
export function tonightPieces({ letterOn, brandText, letterWidth }) {
  const words = (K, fr, str, o) => letterOn(K, fr, str, o);

  // a chair, a couch and a wing chair share one upholsterer
  function upholstered(K, p, set, { w, wings = false, cushions = 3, tufts = true }) {
    const fr = frameOf(K, p), { pbox, alongX, alongZ, P } = fr, c = p.colour || set.palette?.sofa || '#20384a', dark = shade(c, 0.7), leg = '#2a1a10', pillow = set.palette?.pillow || '#c8a040';
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const q = P(sx * (w / 2 - 0.08), 0, sz * 0.34); K.lathe(q[0], q[1], [[0.03, 0], [0.04, 0.03], [0.045, 0.07], [0.035, 0.1], [0.04, 0.12], [0, 0.12]], leg, 1, 10, GLOSS); }
    pbox(-w / 2 + 0.02, w / 2 - 0.02, 0.12, 0.3, -0.42, 0.4, c, 1, null, CLOTH);
    K.rounded(...alongX(), -w / 2 + 0.04, w / 2 - 0.04, 0.36, 0.43, 0.26, 0.31, 0.02, dark, 1, CLOTH);
    // the seat cushions, piped along the front
    const inner = w - 0.34, n = Math.max(1, cushions);
    for (let i = 0; i < n; i++) {
      const x0 = -inner / 2 + (inner * i) / n + 0.008, x1 = -inner / 2 + (inner * (i + 1)) / n - 0.008;
      K.rounded(...alongX(), x0, x1, -0.28, 0.41, 0.3, 0.47, 0.05, c, 1.04, CLOTH);
      pbox(x0 + 0.03, x1 - 0.03, 0.455, 0.465, 0.408, 0.418, dark, 1, null, CLOTH);
    }
    // the back, leaning, rolled along its top
    K.rounded(...alongX(-0.1, 0.3), -w / 2 + 0.15, w / 2 - 0.15, -0.44, -0.26, 0.3, 0.84, 0.05, c, 1, CLOTH);
    K.rounded(...alongX(), -w / 2 + 0.12, w / 2 - 0.12, -0.53, -0.37, 0.8, 0.9, 0.05, c, 0.96, CLOTH);
    if (tufts) {
      const btn = (x, y) => { const z = -0.26 + (y - 0.3) * -0.1 + 0.004, q = P(x, y, z); K.ball(q[0], q[1], q[2], 0.011, shade(c, 0.5), 1, 6, CLOTH); return P(x, y, z + 0.002); };
      const pts = [];
      for (let r = 0, y = 0.52; y < 0.8; r++, y += 0.1) {
        const row = [];
        for (let x = -w / 2 + 0.26 + (r % 2) * 0.09; x < w / 2 - 0.22; x += 0.18) row.push(btn(x, y));
        pts.push(row);
      }
      for (let r = 0; r + 1 < pts.length; r++) for (const a of pts[r]) for (const b of pts[r + 1]) if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.13) bar(K, a, b, 0.003, shade(c, 0.55), 1, CLOTH);
    }
    // rolled arms, a scroll on each front
    for (const s of [-1, 1]) {
      const xa = s * (w / 2 - 0.17), xb = s * w / 2;
      pbox(Math.min(xa, xb), Math.max(xa, xb), 0.3, 0.6, -0.45, 0.38, c, 1, null, CLOTH);
      K.rounded(...alongZ(), -0.47, 0.4, Math.min(xa, xb) - 0.02, Math.max(xa, xb) + 0.02, 0.56, 0.7, 0.065, c, 1.02, CLOTH);
      disc(K, fr, (xa + xb) / 2, 0.62, 0.405, 0.075, dark, 1, 14, CLOTH, false);
      if (wings) pbox(Math.min(xa, xb), Math.max(xa, xb), 0.6, 1.02, -0.5, -0.22, c, 0.98, null, CLOTH);
    }
    // two cushions thrown against the arms
    if (w > 1.2) for (const s of [-1, 1]) K.rounded(...alongX(-0.45, 0.47), s * (w / 2 - 0.36) - 0.19, s * (w / 2 - 0.36) + 0.19, -0.26, -0.14, 0.47, 0.84, 0.05, pillow, 1, CLOTH);
  }

  return {
    cw_skyline: {
      label: 'Coldwater at night (painted backdrop in layers)', fields: [F('w', 'Width'), F('h', 'Height over the water'), F('depth', 'Depth of the layers'), F('horizon', 'Water line off the floor'), F('yaw', 'Facing (°)'), F('seed', 'Seed')],
      make: { at: [0, 0], yaw: 180, w: 15, h: 4.4, depth: 3.2, horizon: 1.45, seed: 4 },
      draw(K, p) { coldwater(K, p, letterOn); },
    },
    picture_window: {
      label: 'Panelled wall with a picture window', fields: [F('w', 'Opening width (0 for none)'), F('h', 'Opening height'), F('y', 'Sill off the floor'), F('off', 'Opening off centre (+ is toward the viewer\'s left)'), F('wall', 'Wall width'), F('top', 'Wall height'), F('pane', 'Pane width'), F('yaw', 'Facing (°)'), F('colour', 'Panelling colour', 'text')],
      make: { at: [0, 0], yaw: 180, w: 8, h: 3.5, y: 1, off: 0, wall: 12, top: 5.2, pane: 1.4 },
      draw(K, p, set) {
        const w = Math.max(0, num(p.w, 8)), h = num(p.h, 3.5), y = num(p.y, 1), top = num(p.top, 5.2), pane = Math.max(0.4, num(p.pane, 1.4)), fr = frameOf(K, p), { pbox, P } = fr;
        const W = num(p.wall, 12), c = Math.max(-W / 2 + w / 2 + 0.6, Math.min(W / 2 - w / 2 - 0.6, num(p.off, 0))), xa = c - w / 2, xb = c + w / 2;
        const wood = p.colour || set.palette?.panel || '#4a2c1c', dark = shade(wood, 0.55), brass = set.palette?.brass || '#c8a050', bronze = '#1e1812', cornice = top - 0.45;
        if (!w) {
          panelWall(K, fr, -W / 2, W / 2, 0, cornice, wood);
        } else {
          panelWall(K, fr, xb + 0.5, W / 2, 0, cornice, wood);
          panelWall(K, fr, -W / 2, xa - 0.5, 0, cornice, wood);
          panelWall(K, fr, xa - 0.5, xb + 0.5, 0, y - 0.08, wood, 9);
          panelWall(K, fr, xa - 0.5, xb + 0.5, y + h + 0.16, cornice, wood, 99);
          // the reveal: bronze jambs and head, a lit cove inside the head, a sill with a brass nosing
          pbox(xb, xb + 0.12, y - 0.08, y + h + 0.16, -0.36, 0.05, bronze, 1, null, METAL);
          pbox(xa - 0.12, xa, y - 0.08, y + h + 0.16, -0.36, 0.05, bronze, 1, null, METAL);
          pbox(xa - 0.12, xb + 0.12, y + h, y + h + 0.16, -0.36, 0.05, bronze, 1, null, METAL);
          pbox(xa, xb, y + h - 0.015, y + h, -0.3, -0.12, '#e8b878', 1.45);
          pbox(xa - 0.14, xb + 0.14, y - 0.1, y, -0.36, 0.12, dark, 1, null, GLOSS);
          pbox(xa - 0.14, xb + 0.14, y - 0.105, y - 0.08, 0.12, 0.135, brass, 1, null, METAL);
          // the mullions and a transom, in the glass line
          const n = Math.max(1, Math.round(w / pane)), yt = y + h * 0.8;
          for (let i = 1; i < n; i++) { const x = xa + (w * i) / n; pbox(x - 0.03, x + 0.03, y, y + h, -0.33, -0.26, bronze, 1, null, METAL); }
          pbox(xa, xb, yt - 0.025, yt + 0.025, -0.33, -0.26, bronze, 1, null, METAL);
          // fluted pilasters either side, with a brass sconce each
          for (const cx of [xb + 0.31, xa - 0.31]) {
            pbox(cx - 0.22, cx + 0.22, 0, 0.32, 0, 0.16, dark, 1, null, SATIN);
            pbox(cx - 0.18, cx + 0.18, 0.32, cornice - 0.3, 0, 0.12, wood, 1.05, null, SATIN);
            for (let i = -2; i <= 2; i++) pbox(cx + i * 0.065 - 0.012, cx + i * 0.065 + 0.012, 0.42, cornice - 0.4, 0.12, 0.124, dark, 1, null, SATIN);
            pbox(cx - 0.21, cx + 0.21, cornice - 0.3, cornice - 0.22, 0, 0.15, dark, 1, null, SATIN);
            pbox(cx - 0.23, cx + 0.23, cornice - 0.22, cornice - 0.19, 0, 0.17, brass, 1, null, METAL);
            pbox(cx - 0.06, cx + 0.06, 2.1, 2.42, 0.124, 0.14, brass, 1, null, METAL);
            bar(K, P(cx, 2.2, 0.14), P(cx, 2.28, 0.26), 0.008, brass, 1);
            const q = P(cx, 0, 0.27);
            K.lathe(q[0], q[1], [[0.025, 2.26], [0.07, 2.32], [0.085, 2.44], [0, 2.44]], '#ffe2b0', 1.8, 14);
            K.lathe(q[0], q[1], [[0.086, 2.44], [0.086, 2.452], [0, 2.452]], brass, 1, 14, METAL);
          }
        }
        // the cornice, a brass line, and a cove that washes the ceiling
        pbox(-W / 2, W / 2, cornice, cornice + 0.12, 0, 0.1, dark, 1, null, SATIN);
        pbox(-W / 2, W / 2, cornice + 0.12, cornice + 0.15, 0, 0.13, brass, 1, null, METAL);
        pbox(-W / 2, W / 2, cornice + 0.15, cornice + 0.32, 0, 0.18, dark, 1, null, SATIN);
        pbox(-W / 2, W / 2, cornice + 0.32, cornice + 0.34, 0.02, 0.16, '#ffcf90', 1.5);
        pbox(-W / 2, W / 2, cornice + 0.34, top, -0.06, 0, wood, 0.8, null, SATIN);
      },
    },
    stage_deck: {
      label: 'Stage deck (chevron parquet)', fields: [F('w', 'Width'), F('depth', 'Depth'), F('h', 'Height'), F('yaw', 'Facing (°)'), F('step', 'Front step width (0 for none)'), F('colour', 'Wood colour', 'text')],
      make: { at: [0, 0], yaw: 180, w: 8, depth: 3.6, h: 0.3, step: 2.4 },
      draw(K, p, set) {
        const w = num(p.w, 8), dp = num(p.depth, 3.6), h = num(p.h, 0.3), st = num(p.step, 2.4), fr = frameOf(K, p), { pbox, P } = fr, brass = set.palette?.brass || '#c8a050', wood = p.colour || '#6a3e22';
        pbox(-w / 2, w / 2, 0, h - 0.02, -dp / 2, dp / 2, '#120e0c', 1, null, SATIN);
        pbox(-w / 2, w / 2, h - 0.02, h, -dp / 2, dp / 2, shade(wood, 0.4), 1, null, SATIN);
        // the chevron: columns of slanted planks, each column the other way
        const tones = [wood, shade(wood, 1.12), shade(wood, 0.88), shade(wood, 1.2), shade(wood, 0.8)], cw = 0.32, pw = 0.11, B = 0.16, up = fr.N(0, 1, 0);
        let i = 0;
        for (let x = -w / 2 + B; x < w / 2 - B - 0.01; x += cw, i++) {
          const x1 = Math.min(x + cw, w / 2 - B), s = i % 2 ? 1 : -1, rise = s * (x1 - x);
          // a plank the border cuts is trimmed to it, as a floor layer would
          const lo = -dp / 2 + B, hi = dp / 2 - B;
          for (let z = lo - Math.abs(rise) - pw, j = 0; z < hi + Math.abs(rise); z += pw, j++) {
            const zs = [z, z + rise, z + rise + pw - 0.006, z + pw - 0.006].map((q) => Math.max(lo, Math.min(hi, q)));
            if (zs[3] - zs[0] < 0.004 && zs[2] - zs[1] < 0.004) continue;
            K.quad(K.solid, [P(x + 0.003, h + 0.002, zs[0]), P(x1 - 0.003, h + 0.002, zs[1]), P(x1 - 0.003, h + 0.002, zs[2]), P(x + 0.003, h + 0.002, zs[3])], up, K.C(tones[(i * 3 + j * 7) % tones.length]), GLOSS);
          }
        }
        // the border, straight boards round the edge, and the brass nosing with a light under it
        const bd = shade(wood, 0.75);
        pbox(-w / 2, w / 2, h, h + 0.004, dp / 2 - B, dp / 2, bd, 1, null, GLOSS);
        pbox(-w / 2, w / 2, h, h + 0.004, -dp / 2, -dp / 2 + B, bd, 1, null, GLOSS);
        pbox(-w / 2, -w / 2 + B, h, h + 0.004, -dp / 2 + B, dp / 2 - B, bd, 1, null, GLOSS);
        pbox(w / 2 - B, w / 2, h, h + 0.004, -dp / 2 + B, dp / 2 - B, bd, 1, null, GLOSS);
        pbox(-w / 2, w / 2, h - 0.04, h + 0.006, dp / 2, dp / 2 + 0.03, brass, 1, null, METAL);
        pbox(-w / 2 + 0.03, w / 2 - 0.03, h - 0.075, h - 0.055, dp / 2 + 0.003, dp / 2 + 0.022, '#ffc878', 1.9);
        for (const s of [-1, 1]) pbox(s > 0 ? w / 2 : -w / 2 - 0.03, s > 0 ? w / 2 + 0.03 : -w / 2, h - 0.04, h + 0.006, -dp / 2, dp / 2 + 0.03, brass, 1, null, METAL);
        if (st > 0) {
          pbox(-st / 2, st / 2, 0, h / 2, dp / 2, dp / 2 + 0.34, shade(wood, 0.5), 1, null, GLOSS);
          pbox(-st / 2, st / 2, h / 2 - 0.03, h / 2 + 0.004, dp / 2 + 0.34, dp / 2 + 0.365, brass, 1, null, METAL);
          pbox(-st / 2 + 0.03, st / 2 - 0.03, h / 2 - 0.06, h / 2 - 0.045, dp / 2 + 0.343, dp / 2 + 0.36, '#ffc878', 1.9);
        }
      },
    },
    tonight_desk: {
      label: "Host's desk, dressed (mug, cards, mic)", fields: [F('w', 'Width'), F('depth', 'Depth'), F('h', 'Height'), F('yaw', 'Facing (°)'), F('text', 'Front lettering', 'text'), F('colour', 'Wood colour', 'text'), F('mug', 'Mug colour', 'text'), F('lift', 'Stood on (height)')],
      make: { at: [0, 0], yaw: 180, w: 2.3, depth: 0.85, h: 0.8, text: '{brand.name}', lift: 0 },
      draw(K, p, set) {
        lifted(K, p, () => {
          const w = num(p.w, 2.3), dp = num(p.depth, 0.85), h = num(p.h, 0.8), fr = frameOf(K, p), { pbox, P, alongX } = fr, pal = set.palette || {};
          const wood = p.colour || pal.desk || '#5a3420', lite = shade(wood, 1.18), dark = shade(wood, 0.6), brass = pal.brass || '#c8a050', f = dp / 2, ped = 0.5;
          // two pedestals and a modesty panel, so the host's knees have somewhere to go
          for (const s of [-1, 1]) {
            const a = s > 0 ? w / 2 - ped : -w / 2, b = s > 0 ? w / 2 : -w / 2 + ped;
            pbox(a + 0.04, b - 0.04, 0, 0.07, -f + 0.05, f - 0.05, '#0c0a08', 1, null, SATIN);
            pbox(a, b, 0.07, h - 0.06, -f, f, wood, 1, null, SATIN);
            // drawers on the host's side
            for (let d = 0; d < 3; d++) { const y0 = 0.12 + d * 0.19; pbox(a + 0.04, b - 0.04, y0, y0 + 0.16, -f - 0.012, -f, lite, 1, null, SATIN); pbox((a + b) / 2 - 0.05, (a + b) / 2 + 0.05, y0 + 0.07, y0 + 0.09, -f - 0.03, -f - 0.012, brass, 1, null, METAL); }
          }
          pbox(-w / 2 + ped, w / 2 - ped, 0.12, h - 0.06, f - 0.05, f, wood, 1, null, SATIN);
          pbox(-w / 2 + ped, w / 2 - ped, h - 0.18, h - 0.06, -f, f, wood, 1, null, SATIN);
          pbox(-w / 2 + 0.06, w / 2 - 0.06, 0.004, 0.02, f - 0.06, f - 0.04, '#ffcf80', 1.8);
          // the front: raised fields either side, and a black band in the middle for the lettering
          const bay = w * 0.21;
          for (const [a, b] of [[bay, w / 2 - 0.08], [-w / 2 + 0.08, -bay]]) {
            pbox(a + 0.05, b - 0.05, 0.16, h - 0.17, f, f + 0.014, lite, 1, null, SATIN);
            pbox(a, b, 0.11, 0.15, f, f + 0.026, dark, 1, null, SATIN);
            pbox(a, b, h - 0.17, h - 0.13, f, f + 0.026, dark, 1, null, SATIN);
            pbox(a, a + 0.04, 0.11, h - 0.13, f, f + 0.026, dark, 1, null, SATIN);
            pbox(b - 0.04, b, 0.11, h - 0.13, f, f + 0.026, dark, 1, null, SATIN);
          }
          pbox(-bay + 0.03, bay - 0.03, 0.11, h - 0.13, f, f + 0.01, '#120e0a', 1, null, GLOSS);
          pbox(-bay + 0.03, bay - 0.03, h * 0.62, h * 0.62 + 0.012, f + 0.01, f + 0.016, brass, 1, null, METAL);
          pbox(-bay + 0.03, bay - 0.03, h * 0.2, h * 0.2 + 0.012, f + 0.01, f + 0.016, brass, 1, null, METAL);
          words(K, fr, brandText(p.text ?? '{brand.name}', set), { y: h * 0.33, z: f + 0.017, h: 0.11, maxW: bay * 2 - 0.12, hex: brandColour(set, {}), k: 1.7 });
          // turned columns at the front corners, banded in brass
          for (const s of [-1, 1]) { const q = P(s * (w / 2 - 0.01), 0, f - 0.01); K.lathe(q[0], q[1], [[0.05, 0.07], [0.05, 0.12], [0.04, 0.14], [0.04, h - 0.14], [0.05, h - 0.12], [0.05, h - 0.06], [0, h - 0.06]], dark, 1, 12, GLOSS); for (const yy of [0.13, h - 0.13]) K.lathe(q[0], q[1], [[0.046, yy - 0.008], [0.046, yy + 0.008]], brass, 1, 12, METAL); }
          // a thick top with a rounded front, a leather blotter
          K.rounded(...alongX(), -w / 2 - 0.05, w / 2 + 0.05, -f - 0.03, f + 0.05, h - 0.06, h, 0.025, shade(wood, 0.8), 1, GLOSS);
          pbox(-w / 2 - 0.04, w / 2 + 0.04, h - 0.068, h - 0.06, f + 0.035, f + 0.05, brass, 1, null, METAL);
          pbox(-w * 0.3, w * 0.18, h, h + 0.004, -f + 0.08, f - 0.22, '#1c3428', 1, null, LEATHER);
          pbox(-w * 0.3 - 0.01, w * 0.18 + 0.01, h, h + 0.006, -f + 0.07, -f + 0.1, '#3a2418', 1, null, LEATHER);
          // the mug, the network's colour, with a band and coffee in it
          const mugC = p.mug || brandColour(set, {}), mp = P(-w * 0.32, 0, -0.06), mf = K.frame(mp[0], mp[1], ...facingOf((p.yaw ?? 180) + 60));
          K.lathe(mp[0], mp[1], [[0.04, h], [0.044, h + 0.006], [0.045, h + 0.105], [0.04, h + 0.105], [0.039, h + 0.015], [0, h + 0.015]], mugC, 1, 18, GLOSS);
          K.lathe(mp[0], mp[1], [[0.0455, h + 0.045], [0.0455, h + 0.07]], '#f4ecd8', 1, 18, GLOSS);
          K.lathe(mp[0], mp[1], [[0.039, h + 0.088], [0, h + 0.088]], '#2a1408', 1, 14, GLOSS);
          mf.pbox(0.04, 0.078, h + 0.025, h + 0.035, -0.008, 0.008, mugC, 1, null, GLOSS);
          mf.pbox(0.068, 0.078, h + 0.025, h + 0.085, -0.008, 0.008, mugC, 1, null, GLOSS);
          mf.pbox(0.04, 0.078, h + 0.075, h + 0.085, -0.008, 0.008, mugC, 1, null, GLOSS);
          // a cup of pencils
          const pc = P(-w * 0.42, 0, -0.2);
          K.lathe(pc[0], pc[1], [[0.035, h], [0.035, h + 0.1], [0.031, h + 0.1], [0.031, h + 0.01], [0, h + 0.01]], '#1a1a1c', 1, 14, LEATHER);
          for (let i = 0; i < 7; i++) {
            const a = i * 2.4, r = 0.012 + (i % 3) * 0.006, top = h + 0.17 + (i % 3) * 0.02, lean = 0.025 + (i % 2) * 0.015;
            const A = [pc[0] + Math.cos(a) * r, pc[1] + Math.sin(a) * r, h + 0.02], Bp = [pc[0] + Math.cos(a) * (r + lean), pc[1] + Math.sin(a) * (r + lean), top];
            bar(K, A, Bp, 0.0035, i === 3 ? '#c82020' : '#e8b820', 1, SATIN);
            const Ep = [Bp[0] + (Bp[0] - A[0]) * 0.1, Bp[1] + (Bp[1] - A[1]) * 0.1, top + 0.015];
            bar(K, Bp, Ep, 0.0037, '#e898a0', 1, SATIN);
          }
          // the blue cards, squared up badly
          for (let i = 0; i < 6; i++) {
            const cp = P(w * 0.02 + i * 0.004, 0, -0.08 - i * 0.003), cf = K.frame(cp[0], cp[1], ...facingOf((p.yaw ?? 180) + (i % 2 ? 4 : -3) * (i * 0.5 + 1)));
            cf.pbox(-0.11, 0.11, h + 0.004 + i * 0.003, h + 0.007 + i * 0.003, -0.07, 0.07, i === 5 ? '#d8e2f4' : '#5a7ac8', 1, null, CLOTH);
            if (i === 5) for (let l = 0; l < 5; l++) cf.pbox(-0.09, 0.05 - (l % 2) * 0.04, h + 0.0225, h + 0.0235, -0.05 + l * 0.022, -0.046 + l * 0.022, '#1a2a6a', 1, null, CLOTH);
          }
          // the microphone, an old chrome one on a short stand
          const mic = P(w * 0.3, 0, -0.04);
          K.lathe(mic[0], mic[1], [[0.065, h], [0.065, h + 0.012], [0.02, h + 0.022], [0.009, h + 0.03], [0.009, h + 0.16], [0, h + 0.16]], '#2a2a2e', 1, 16, METAL);
          K.lathe(mic[0], mic[1], [[0, h + 0.15], [0.026, h + 0.16], [0.04, h + 0.2], [0.042, h + 0.245], [0.036, h + 0.28], [0.02, h + 0.295], [0, h + 0.3]], '#c8ccd4', 1.05, 16, METAL);
          for (let i = 0; i < 6; i++) K.lathe(mic[0], mic[1], [[0.0425, h + 0.2 + i * 0.008], [0.0425, h + 0.204 + i * 0.008]], '#3a3c42', 1, 16, METAL);
          // a guest's book and a glass of water on a coaster
          const bk = P(w * 0.4, 0, -0.18), bf = K.frame(bk[0], bk[1], ...facingOf((p.yaw ?? 180) - 8));
          bf.pbox(-0.08, 0.08, h, h + 0.03, -0.11, 0.11, '#e8e0cc', 1, null, CLOTH);
          bf.pbox(-0.082, 0.082, h + 0.0, h + 0.004, -0.112, 0.112, '#a82a20', 1, null, CLOTH);
          bf.pbox(-0.082, 0.082, h + 0.03, h + 0.034, -0.112, 0.112, '#a82a20', 1, null, CLOTH);
          bf.pbox(-0.082, -0.078, h, h + 0.034, -0.112, 0.112, '#8a2018', 1, null, CLOTH);
          const gl = P(-w * 0.12, 0, -0.26);
          K.lathe(gl[0], gl[1], [[0.045, h], [0.045, h + 0.004], [0, h + 0.004]], '#2a1a10', 1, 14, LEATHER);
          K.lathe(gl[0], gl[1], [[0.03, h + 0.004], [0.034, h + 0.12], [0.031, h + 0.12], [0.028, h + 0.01], [0, h + 0.01]], '#a8c4dc', 1, 16, GLOSS);
          K.lathe(gl[0], gl[1], [[0.029, h + 0.012], [0.032, h + 0.085], [0, h + 0.085]], '#5a8ab0', 1, 16, GLOSS);
        });
      },
    },
    exec_chair: {
      label: "Host's chair (tufted, swivel)", fields: [F('yaw', 'Facing (°)'), F('seat', 'Seat height'), F('colour', 'Leather colour', 'text'), F('lift', 'Stood on (height)')],
      make: { at: [0, 0], yaw: 180, seat: 0.52, lift: 0 },
      draw(K, p, set) {
        lifted(K, p, () => {
          const s = num(p.seat, 0.52), fr = frameOf(K, p), { alongX, alongZ, P } = fr, c = p.colour || set.palette?.chair || '#4a1a16', chrome = '#b8bcc4', [u, v] = p.at;
          for (let i = 0; i < 5; i++) {
            const a = i * TAU / 5 + 0.3, e = [u + Math.cos(a) * 0.32, v + Math.sin(a) * 0.32, 0.05];
            bar(K, [u, v, 0.09], e, 0.018, chrome, 1);
            K.ball(e[0], e[1], 0.028, 0.028, '#1a1a1a', 1, 8, GLOSS);
          }
          K.lathe(u, v, [[0.06, 0.08], [0.05, 0.12], [0.03, 0.14], [0.028, s - 0.12], [0.06, s - 0.1], [0.08, s - 0.08], [0, s - 0.08]], chrome, 1, 14, METAL);
          K.rounded(...alongX(), -0.27, 0.27, -0.26, 0.26, s - 0.08, s + 0.05, 0.05, c, 1, LEATHER);
          K.rounded(...alongX(-0.14, s), -0.26, 0.26, -0.37, -0.25, s + 0.02, s + 0.88, 0.06, c, 1, LEATHER);
          K.rounded(...alongX(-0.14, s), -0.24, 0.24, -0.4, -0.33, s + 0.82, s + 0.93, 0.035, shade(c, 0.85), 1, LEATHER);
          for (let r = 0; r < 5; r++) for (let i = -2; i <= 2; i++) {
            const x = i * 0.1 + (r % 2) * 0.05, y = s + 0.2 + r * 0.13;
            if (Math.abs(x) > 0.2) continue;
            const q = P(x, y, -0.25 + (y - s) * -0.14 + 0.006);
            K.ball(q[0], q[1], q[2], 0.012, shade(c, 0.5), 1, 6, LEATHER);
          }
          for (const sx of [-1, 1]) {
            bar(K, P(sx * 0.25, s, 0), P(sx * 0.3, s + 0.2, 0.02), 0.014, chrome, 1);
            K.rounded(...alongZ(), -0.22, 0.2, sx * 0.3 - 0.04, sx * 0.3 + 0.04, s + 0.2, s + 0.25, 0.02, c, 1, LEATHER);
          }
        });
      },
    },
    chesterfield: {
      label: 'Tufted couch (rolled arms)', fields: [F('w', 'Width'), F('yaw', 'Facing (°)'), F('colour', 'Colour', 'text'), F('lift', 'Stood on (height)')],
      make: { at: [0, 0], yaw: 180, w: 2.4, lift: 0 },
      draw(K, p, set) { lifted(K, p, () => upholstered(K, p, set, { w: num(p.w, 2.4), cushions: num(p.w, 2.4) > 1.9 ? 3 : 2 })); },
    },
    wing_chair: {
      label: 'Guest chair (wing back)', fields: [F('yaw', 'Facing (°)'), F('colour', 'Colour', 'text'), F('lift', 'Stood on (height)')],
      make: { at: [0, 0], yaw: 180, lift: 0 },
      draw(K, p, set) { lifted(K, p, () => upholstered(K, p, set, { w: 0.98, wings: true, cushions: 1, tufts: true })); },
    },
    side_table: {
      label: 'Side table (glasses, a lamp)', fields: [F('h', 'Height'), F('r', 'Radius'), F('lamp', 'Lamp (1 or 0)'), F('glasses', 'Glasses'), F('lift', 'Stood on (height)')],
      make: { at: [0, 0], h: 0.58, r: 0.3, lamp: 1, glasses: 2, lift: 0 },
      draw(K, p, set) {
        lifted(K, p, () => {
          const h = num(p.h, 0.58), r = num(p.r, 0.3), [u, v] = p.at, wood = set.palette?.desk || '#5a3420', brass = set.palette?.brass || '#c8a050';
          K.lathe(u, v, [[r * 0.6, 0], [r * 0.6, 0.03], [0.07, 0.07], [0.045, 0.14], [0.06, h * 0.45], [0.035, h - 0.07], [0.09, h - 0.045], [0, h - 0.045]], shade(wood, 0.8), 1, 18, GLOSS);
          K.lathe(u, v, [[r, h - 0.045], [r + 0.012, h - 0.025], [r, h], [0, h]], wood, 1, 28, GLOSS);
          K.lathe(u, v, [[r + 0.013, h - 0.03], [r + 0.013, h - 0.02]], brass, 1, 28, METAL);
          const n = Math.min(4, Math.max(0, num(p.glasses, 2) | 0));
          for (let i = 0; i < n; i++) {
            const a = 2.3 + i * 0.8, gu = u + Math.cos(a) * r * 0.55, gv = v + Math.sin(a) * r * 0.55;
            K.lathe(gu, gv, [[0.042, h], [0.042, h + 0.004], [0, h + 0.004]], '#2a1a10', 1, 12, LEATHER);
            K.lathe(gu, gv, [[0.028, h + 0.004], [0.033, h + 0.12], [0.03, h + 0.12], [0.026, h + 0.01], [0, h + 0.01]], '#a8c4dc', 1, 14, GLOSS);
            K.lathe(gu, gv, [[0.027, h + 0.012], [0.031, h + 0.07 + i * 0.02], [0, h + 0.07 + i * 0.02]], '#5a8ab0', 1, 14, GLOSS);
          }
          if (num(p.lamp, 1)) {
            const lu = u - r * 0.25, lv = v + r * 0.2;
            K.lathe(lu, lv, [[0.06, h], [0.1, h + 0.08], [0.11, h + 0.17], [0.08, h + 0.27], [0.04, h + 0.31], [0.016, h + 0.33], [0.016, h + 0.36], [0, h + 0.36]], '#1c3c64', 1, 18, GLOSS);
            K.lathe(lu, lv, [[0.111, h + 0.12], [0.111, h + 0.135]], '#e8e0d0', 1, 18, GLOSS);
            K.lathe(lu, lv, [[0.008, h + 0.36], [0.008, h + 0.52], [0, h + 0.52]], brass, 1, 8, METAL);
            K.lathe(lu, lv, [[0.2, h + 0.37], [0.13, h + 0.6], [0, h + 0.6]], '#f2d8a8', 1.7, 24);
            for (let i = 0; i < 12; i++) { const a = i * TAU / 12; bar(K, [lu + Math.cos(a) * 0.2, lv + Math.sin(a) * 0.2, h + 0.37], [lu + Math.cos(a) * 0.13, lv + Math.sin(a) * 0.13, h + 0.6], 0.0025, '#d8b880', 1.5, SATIN); }
            K.lathe(lu, lv, [[0.201, h + 0.365], [0.201, h + 0.38]], brass, 1, 24, METAL);
          }
        });
      },
    },
    stage_curtain: {
      label: 'Swagged stage curtain', fields: [F('w', 'Width'), F('h', 'Height'), F('yaw', 'Facing (°)'), F('colour', 'Colour', 'text'), F('stripe', 'Stripe colour', 'text'), F('every', 'Stripe every (0 for none)'), F('swags', 'Swags across')],
      make: { at: [0, 0], yaw: 180, w: 3, h: 4, every: 0.55, swags: 3 },
      draw(K, p, set) {
        const w = num(p.w, 3), h = num(p.h, 4), fr = frameOf(K, p), { pbox, P, N } = fr, c = p.colour || set.palette?.curtain || '#1c2a5a', gold = p.stripe || set.palette?.brass || '#c8a050', every = num(p.every, 0.55);
        const n = Math.max(16, Math.round(w / 0.055)), A = 0.055, hem = 0.12;
        const zAt = (i) => A * Math.sin(i * Math.PI / 2) + A * 0.4 * Math.sin(i * 0.9);
        for (let i = 0; i < n; i++) {
          const x0 = -w / 2 + (w * i) / n, x1 = x0 + w / n, z0 = zAt(i), z1 = zAt(i + 1), dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
          const facing = dx / L, stripe = every > 0 && ((x0 + w / 2) % every) < every * 0.12, col = stripe ? gold : c;
          const k = 0.5 + 0.55 * facing ** 2 * (dz <= 0 ? 1 : 0.8);
          K.quad(K.solid, [P(x0, hem, z0), P(x1, hem, z1), P(x1, h, z1), P(x0, h, z0)], N(-dz / L, 0, dx / L), K.C(col, k), stripe ? METAL : CLOTH);
          K.quad(K.solid, [P(x0, 0.015, z0 + 0.015), P(x1, 0.015, z1 + 0.015), P(x1, hem, z1), P(x0, hem, z0)], N(-dz / L, 0, dx / L), K.C(col, k * 0.85), stripe ? METAL : CLOTH);
        }
        // bullion along the hem
        for (let x = -w / 2 + 0.01; x < w / 2; x += 0.028) { const i = ((x + w / 2) / w) * n, z = zAt(i) + 0.02; pbox(x - 0.006, x + 0.006, 0.02, 0.1, z - 0.006, z + 0.006, gold, 1, null, METAL); }
        // the pelmet, swags draped across it with fringe under them, and tails at the ends
        const top = h + 0.5;
        pbox(-w / 2 - 0.12, w / 2 + 0.12, h - 0.05, top, -0.16, 0.1, shade(c, 0.6), 1, null, CLOTH);
        const S = Math.max(1, num(p.swags, 3) | 0), sw = (w + 0.2) / S;
        for (let j = 0; j < S; j++) {
          const cx = -w / 2 - 0.1 + sw * (j + 0.5), m = 16;
          for (let i = 0; i < m; i++) {
            const t0 = i / m * 2 - 1, t1 = (i + 1) / m * 2 - 1, xa = cx + t0 * sw / 2, xb = cx + t1 * sw / 2;
            const dip = (t) => 0.42 * (1 - t * t), za = 0.12 + 0.05 * (1 - t0 * t0), zb = 0.12 + 0.05 * (1 - t1 * t1);
            for (let band = 0; band < 3; band++) {
              const ya0 = top - 0.04 - dip(t0) * (0.4 + band * 0.25) - band * 0.06, yb0 = top - 0.04 - dip(t1) * (0.4 + band * 0.25) - band * 0.06;
              K.quad(K.solid, [P(xa, ya0 - 0.09, za + band * 0.01), P(xb, yb0 - 0.09, zb + band * 0.01), P(xb, yb0, zb + band * 0.01), P(xa, ya0, za + band * 0.01)], N(0, 0, 1), K.C(c, 0.75 + band * 0.12), CLOTH);
            }
            const ya = top - 0.04 - dip(t0) * 0.9 - 0.12 - 0.09, yb = top - 0.04 - dip(t1) * 0.9 - 0.12 - 0.09;
            for (let f = 0; f < 3; f++) { const xf = xa + (xb - xa) * (f + 0.5) / 3, yf = ya + (yb - ya) * (f + 0.5) / 3; pbox(xf - 0.004, xf + 0.004, yf - 0.08, yf, za + 0.03, za + 0.036, gold, 1, null, METAL); }
          }
          const q = P(cx + sw / 2, top - 0.05, 0.2); K.ball(q[0], q[1], q[2], 0.05, gold, 1, 10, METAL);
        }
        for (const s of [-1, 1]) for (let i = 0; i < 5; i++) {
          const x = s * (w / 2 + 0.06 - i * 0.07), len = 1.1 - i * 0.12;
          pbox(x - 0.035, x + 0.035, top - 0.05 - len, top - 0.02, 0.1 + (i % 2) * 0.03, 0.13 + (i % 2) * 0.03, c, 0.7 + (i % 2) * 0.25, null, CLOTH);
          pbox(x - 0.035, x + 0.035, top - 0.11 - len, top - 0.05 - len, 0.1 + (i % 2) * 0.03, 0.13 + (i % 2) * 0.03, gold, 1, null, METAL);
        }
      },
    },
    floor_sunburst: {
      label: 'Sunburst inlaid in the floor', fields: [F('r', 'Radius'), F('rays', 'Rays'), F('spread', 'Spread (°, 360 for a whole ring)'), F('inner', 'Starts at (radius)'), F('yaw', 'Opens toward (°)'), F('colour', 'Stone colour', 'text')],
      make: { at: [0, 0], yaw: 180, r: 5, rays: 22, spread: 150, inner: 0.3 },
      draw(K, p, set) {
        const R = num(p.r, 5), n = Math.max(4, Math.min(64, num(p.rays, 22) | 0)), spread = Math.min(360, num(p.spread, 150)) * Math.PI / 180, r0 = num(p.inner, 0.3), fr = frameOf(K, p), { P } = fr;
        const stone = p.colour || set.palette?.floor || '#141016', a = shade(stone, 1.25), b = shade(stone, 1.75), brass = set.palette?.brass || '#c8a050', up = fr.N(0, 1, 0);
        const at = (ang, r, y) => P(Math.sin(ang) * r, y, Math.cos(ang) * r);
        const band = (r1, r2, a0, a1, y, hex, k, mat) => arc(Math.max(6, Math.round((a1 - a0) * r2 / 0.3)), a0, a1, (x, z) => K.quad(K.solid, [at(x, r1, y), at(z, r1, y), at(z, r2, y), at(x, r2, y)], up, K.C(hex, k), mat));
        const a0 = -spread / 2;
        for (let i = 0; i < n; i++) {
          const x = a0 + (spread * i) / n, z = a0 + (spread * (i + 1)) / n;
          for (const [q0, q1] of [[r0, R * 0.36], [R * 0.36, R * 0.7], [R * 0.7, R]]) band(q0, q1, x, z, 0.002, i % 2 ? a : b, 1, GLOSS);
          // a brass line down each ray's edge, a thin wedge
          const e = 0.006 / Math.max(0.5, R);
          K.quad(K.solid, [at(x - e * 4, r0, 0.003), at(x + e * 4, r0, 0.003), at(x + e, R, 0.003), at(x - e, R, 0.003)], up, K.C(brass, 0.9), METAL);
        }
        for (const r of [r0, R * 0.36, R * 0.7, R]) band(r - 0.02, r + 0.02, a0, a0 + spread, 0.0035, brass, 1, METAL);
      },
    },
    floor_star: {
      label: 'Brass star in the floor (a mark)', fields: [F('r', 'Size'), F('lift', 'Stood on (height)')],
      make: { at: [0, 0], r: 0.4, lift: 0 },
      draw(K, p, set) {
        lifted(K, p, () => {
          const r = num(p.r, 0.4), [u, v] = p.at, brass = set.palette?.brass || '#c8a050', pt = (a, rr, y) => [u + Math.cos(a) * rr, v + Math.sin(a) * rr, y];
          K.lathe(u, v, [[r * 1.25, 0.002], [r * 1.25, 0.004], [0, 0.004]], '#0c0a0c', 1, 36, GLOSS);
          K.lathe(u, v, [[r * 1.18, 0.0045], [r * 1.18, 0.005], [r * 1.12, 0.005], [r * 1.12, 0.0045]], brass, 1, 36, METAL);
          for (let i = 0; i < 5; i++) {
            const a = -Math.PI / 2 + i * TAU / 5, b = a + TAU / 10, c = a - TAU / 10;
            for (const [s, lite] of [[b, 1.15], [c, 0.85]]) K.quad(K.solid, [pt(0, 0, 0.006), pt(a, r, 0.006), pt(s, r * 0.4, 0.006), pt(s, r * 0.4, 0.006)], [0, 1, 0], K.C(brass, lite), METAL);
          }
        });
      },
    },
    bandstand: {
      label: 'Band riser with stand fronts', fields: [F('w', 'Width'), F('tiers', 'Tiers'), F('fronts', 'Stand fronts on the front tier'), F('yaw', 'Facing (°)'), F('text', 'Lettering on the fronts', 'text'), F('colour', 'Front colour', 'text')],
      make: { at: [0, 0], yaw: 180, w: 3.2, tiers: 2, fronts: 3, text: 'TS' },
      draw(K, p, set) {
        const w = num(p.w, 3.2), n = Math.max(1, Math.min(4, num(p.tiers, 2) | 0)), m = Math.max(0, Math.min(8, num(p.fronts, 3) | 0)), fr = frameOf(K, p), { pbox, P } = fr, pal = set.palette || {}, th = 0.22, td = 0.95;
        const deck = pal.riser || '#1a1418', accent = brandColour(set, p.colour ? {} : p), front = p.colour || '#e8e0cc', brass = pal.brass || '#c8a050';
        for (let i = 0; i < n; i++) {
          pbox(-w / 2, w / 2, 0, (i + 1) * th, -(i + 1) * td, -i * td, deck, 1, null, SATIN);
          pbox(-w / 2, w / 2, (i + 1) * th - 0.002, (i + 1) * th + 0.004, -(i + 1) * td, -i * td, '#2a2026', 1, null, GLOSS);
          pbox(-w / 2 + 0.02, w / 2 - 0.02, (i + 1) * th - 0.05, (i + 1) * th - 0.035, -i * td, -i * td + 0.012, accent, 1.9);
        }
        const text = brandText(p.text ?? 'TS', set);
        for (let j = 0; j < m; j++) {
          const x = -w / 2 + (w * (j + 0.5)) / m, y0 = th, z = -0.12, hw = Math.min(0.29, w / m / 2 - 0.03);
          pbox(x - hw, x + hw, y0, y0 + 0.78, z - 0.05, z, front, 1, null, GLOSS);
          pbox(x - hw - 0.01, x + hw + 0.01, y0 + 0.78, y0 + 0.81, z - 0.055, z + 0.005, brass, 1, null, METAL);
          arc(10, 0, Math.PI, (a, b) => K.quad(K.solid, [P(x, y0 + 0.81, z + 0.001), P(x + Math.cos(a) * hw, y0 + 0.81 + Math.sin(a) * hw * 0.55, z + 0.001), P(x + Math.cos(b) * hw, y0 + 0.81 + Math.sin(b) * hw * 0.55, z + 0.001), P(x + Math.cos(b) * hw, y0 + 0.81 + Math.sin(b) * hw * 0.55, z + 0.001)], fr.N(0, 0, 1), K.C(accent, 1), GLOSS));
          // a sunburst on the face in brass, under the letters
          for (let r = 0; r < 7; r++) { const a = Math.PI * (r + 0.5) / 7; bar(K, P(x, y0 + 0.81, z + 0.004), P(x + Math.cos(a) * hw * 0.85, y0 + 0.81 + Math.sin(a) * hw * 0.5, z + 0.004), 0.004, brass, 1); }
          pbox(x - hw + 0.04, x + hw - 0.04, y0 + 0.1, y0 + 0.13, z, z + 0.008, accent, 1.6);
          words(K, fr, text, { cx: x, y: y0 + 0.3, z: z + 0.006, h: 0.17, maxW: hw * 1.6, hex: '#1a1418', k: 1 });
          // the stand's own lamp, and a chair and a music stand behind it
          const q = P(x, 0, z - 0.03);
          K.lathe(q[0], q[1], [[0.015, y0 + 0.97], [0.07, y0 + 1.02], [0, y0 + 1.02]], '#1a1a1c', 1, 10, METAL);
          K.lathe(q[0], q[1], [[0.06, y0 + 1.0], [0, y0 + 1.0]], '#fff0c8', 1.8, 10);
          const ch = P(x, 0, z - 0.6);
          K.lathe(ch[0], ch[1], [[0.2, y0 + 0.44], [0.2, y0 + 0.47], [0, y0 + 0.47]], '#1a1a1c', 1, 12, SATIN);
          for (let k = 0; k < 4; k++) { const a = k * TAU / 4 + 0.78; bar(K, [ch[0] + Math.cos(a) * 0.15, ch[1] + Math.sin(a) * 0.15, y0], [ch[0] + Math.cos(a) * 0.15, ch[1] + Math.sin(a) * 0.15, y0 + 0.44], 0.01, '#3a3a3e', 1); }
          bar(K, P(x, y0, z - 0.3), P(x, y0 + 1.0, z - 0.3), 0.008, '#1a1a1c', 1);
          bar(K, P(x - 0.2, y0 + 1.0, z - 0.3), P(x + 0.2, y0 + 1.0, z - 0.26), 0.012, '#f4f0e4', 1, CLOTH);
        }
      },
    },
    drum_kit: {
      label: 'Drum kit', fields: [F('yaw', 'Facing (°)'), F('text', 'On the bass drum', 'text'), F('colour', 'Shell colour', 'text'), F('lift', 'Stood on (height)')],
      make: { at: [0, 0], yaw: 180, text: '{brand.name}', lift: 0 },
      draw(K, p, set) {
        lifted(K, p, () => {
          const fr = frameOf(K, p), { pbox, P } = fr, shell = p.colour || '#7a1a20', chrome = '#c0c4cc', head = '#ece6d8', brass = '#c8a048';
          // the bass drum on its side, its front head lettered
          tube(K, P(0, 0.28, -0.25), P(0, 0.28, 0.14), 0.28, shell, 1, 22, GLOSS);
          for (const z of [-0.26, 0.135]) tube(K, P(0, 0.28, z), P(0, 0.28, z + 0.025), 0.29, '#1a1a1e', 1, 22, METAL);
          disc(K, fr, 0, 0.28, 0.161, 0.27, head, 1, 24, SATIN, false);
          disc(K, fr, 0, 0.28, 0.163, 0.2, '#14141a', 1, 24, SATIN, false);
          words(K, fr, brandText(p.text ?? '{brand.name}', set), { y: 0.25, z: 0.165, h: 0.05, maxW: 0.34, hex: brandColour(set, {}), k: 1.6 });
          for (let i = 0; i < 8; i++) { const a = i * TAU / 8; pbox(Math.cos(a) * 0.285 - 0.012, Math.cos(a) * 0.285 + 0.012, 0.28 + Math.sin(a) * 0.285 - 0.012, 0.28 + Math.sin(a) * 0.285 + 0.012, 0.05, 0.1, chrome, 1, null, METAL); }
          for (const s of [-1, 1]) bar(K, P(s * 0.22, 0.18, 0.05), P(s * 0.34, 0, 0.16), 0.008, chrome, 1);
          // rack toms on the bass drum, a floor tom, the snare
          const drum = (x, z, r, y0, y1, col) => { const q = P(x, 0, z); K.lathe(q[0], q[1], [[r, y0], [r, y1], [0, y1]], col, 1, 18, GLOSS); K.lathe(q[0], q[1], [[r * 0.94, y1 + 0.002], [0, y1 + 0.002]], head, 1, 18, SATIN); K.lathe(q[0], q[1], [[r + 0.006, y1 - 0.012], [r + 0.006, y1 + 0.004]], chrome, 1, 18, METAL); };
          bar(K, P(0, 0.56, -0.08), P(0, 0.66, -0.08), 0.012, chrome, 1);
          drum(0.14, -0.04, 0.1, 0.62, 0.8, shell);
          drum(-0.14, -0.06, 0.11, 0.63, 0.82, shell);
          drum(-0.46, -0.2, 0.16, 0.2, 0.6, shell);
          for (let i = 0; i < 3; i++) { const a = i * TAU / 3, q = P(-0.46, 0, -0.2); bar(K, [q[0] + Math.cos(a) * 0.17, q[1] + Math.sin(a) * 0.17, 0.42], [q[0] + Math.cos(a) * 0.24, q[1] + Math.sin(a) * 0.24, 0], 0.007, chrome, 1); }
          drum(0.36, -0.22, 0.17, 0.55, 0.68, chrome);
          // stands and brass: hi-hat, crash, ride
          const stand = (x, z, top) => { const q = P(x, 0, z); bar(K, [q[0], q[1], 0.3], [q[0], q[1], top], 0.008, chrome, 1); for (let i = 0; i < 3; i++) { const a = i * TAU / 3 + 0.4; bar(K, [q[0], q[1], 0.32], [q[0] + Math.cos(a) * 0.22, q[1] + Math.sin(a) * 0.22, 0], 0.007, chrome, 1); } return q; };
          const cymbal = (q, y, r) => K.lathe(q[0], q[1], [[r, y], [r * 0.3, y + 0.025], [0.04, y + 0.03], [0.02, y + 0.045], [0, y + 0.045]], brass, 1.05, 22, METAL);
          let q = stand(0.64, -0.1, 0.96); cymbal(q, 0.9, 0.18); cymbal(q, 0.93, 0.18);
          q = stand(0.42, 0.12, 1.22); cymbal(q, 1.2, 0.22);
          q = stand(-0.58, 0.06, 1.12); cymbal(q, 1.1, 0.26);
          q = stand(-0.2, 0.22, 1.32); cymbal(q, 1.3, 0.19);
          // the throne
          const t = P(0, 0, -0.62);
          K.lathe(t[0], t[1], [[0.17, 0.48], [0.18, 0.53], [0.15, 0.56], [0, 0.57]], '#1a1a1a', 1, 16, LEATHER);
          for (let i = 0; i < 3; i++) { const a = i * TAU / 3 + 0.5; bar(K, [t[0], t[1], 0.46], [t[0] + Math.cos(a) * 0.25, t[1] + Math.sin(a) * 0.25, 0], 0.01, chrome, 1); }
          pbox(-0.05, 0.05, 0, 0.04, -0.4, -0.18, '#2a2a2e', 1, null, METAL);
        });
      },
    },
    keyboard: {
      label: 'Electric piano on legs', fields: [F('yaw', 'Facing (°)'), F('w', 'Width'), F('text', 'Name on the case', 'text'), F('lift', 'Stood on (height)')],
      make: { at: [0, 0], yaw: 180, w: 1.2, text: '', lift: 0 },
      draw(K, p, set) {
        lifted(K, p, () => {
          const w = num(p.w, 1.2), fr = frameOf(K, p), { pbox, P } = fr, k0 = 0.74;
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) bar(K, P(sx * (w / 2 - 0.08), 0, sz * 0.12 - 0.12), P(sx * (w / 2 - 0.06), 0.62, sz * 0.1 - 0.12), 0.014, '#b8bcc4', 1);
          pbox(-w / 2, w / 2, 0.62, 0.8, -0.34, -0.14, '#141414', 1, null, SATIN);
          pbox(-w / 2, w / 2, 0.62, k0, -0.14, 0.05, '#141414', 1, null, SATIN);
          for (const s of [-1, 1]) pbox(s > 0 ? w / 2 - 0.06 : -w / 2, s > 0 ? w / 2 : -w / 2 + 0.06, k0, 0.82, -0.14, 0.05, '#1c1c1c', 1, null, SATIN);
          pbox(-w / 2 + 0.06, w / 2 - 0.06, 0.8, 0.83, -0.34, -0.14, '#c8c8cc', 1, null, METAL);
          const kw = 0.0235, n = Math.floor((w - 0.12) / kw), x0 = -w / 2 + 0.06 + ((w - 0.12) - n * kw) / 2;
          for (let i = 0; i < n; i++) {
            const x = x0 + i * kw;
            pbox(x + 0.001, x + kw - 0.001, k0, k0 + 0.03, -0.13, 0.045, '#ece8dc', 1, null, GLOSS);
            if ([0, 1, 3, 4, 5].includes(i % 7) && i < n - 1) pbox(x + kw * 0.65, x + kw * 1.35, k0 + 0.03, k0 + 0.048, -0.13, -0.035, '#121212', 1, null, GLOSS);
          }
          const t = brandText(p.text, set);
          if (t) words(K, fr, t, { y: 0.66, z: 0.051, h: 0.04, maxW: w * 0.4, hex: '#d8d8d8', k: 1 });
          pbox(-w / 2 + 0.1, w / 2 - 0.1, 0.83, 1.06, -0.3, -0.29, '#1a1a1a', 1, null, SATIN);
          pbox(-w / 2 + 0.2, -0.05, 0.86, 1.04, -0.288, -0.284, '#f4f0e4', 1, null, CLOTH);
          pbox(0.05, w / 2 - 0.2, 0.86, 1.04, -0.288, -0.284, '#f4f0e4', 1, null, CLOTH);
        });
      },
    },
    amp: {
      label: 'Guitar amp', fields: [F('yaw', 'Facing (°)'), F('w', 'Width'), F('lift', 'Stood on (height)')],
      make: { at: [0, 0], yaw: 180, w: 0.6, lift: 0 },
      draw(K, p) {
        lifted(K, p, () => {
          const w = num(p.w, 0.6), h = w * 0.85, fr = frameOf(K, p), { pbox, P } = fr;
          pbox(-w / 2, w / 2, 0.02, h, -0.27, 0, '#18181a', 1, null, LEATHER);
          pbox(-w / 2 + 0.03, w / 2 - 0.03, 0.05, h * 0.68, 0, 0.006, '#4a3e30', 1, null, CLOTH);
          for (let y = 0.07; y < h * 0.66; y += 0.025) pbox(-w / 2 + 0.03, w / 2 - 0.03, y, y + 0.006, 0.006, 0.008, '#2e2620', 1, null, CLOTH);
          pbox(-w / 2 + 0.03, w / 2 - 0.03, h * 0.71, h - 0.03, 0, 0.006, '#c8b890', 1, null, METAL);
          for (let i = 0; i < 7; i++) { const q = P(-w / 2 + 0.08 + i * (w - 0.16) / 6, h * 0.8, 0.02); K.ball(q[0], q[1], q[2], 0.016, '#141414', 1, 8, GLOSS); }
          pbox(w / 2 - 0.07, w / 2 - 0.05, h * 0.86, h * 0.88, 0.006, 0.012, '#ff2020', 2.2);
          for (const s of [-1, 1]) for (const yy of [0.02, h - 0.04]) pbox(s * w / 2 - 0.025, s * w / 2 + 0.025, yy, yy + 0.04, -0.01, 0.012, '#c0c4cc', 1, null, METAL);
          pbox(-0.1, 0.1, h, h + 0.03, -0.15, -0.12, '#141414', 1, null, LEATHER);
          // a bass leaning on its stand beside it
          const bx = -w / 2 - 0.32, lean = 0.22, at = (x, y, z) => P(bx + x, y, z - 0.05 - y * lean);
          const body = '#a81c18', pick = '#efe8d8';
          for (const [cx, cy, r, col, zz] of [[0, 0.3, 0.19, body, 0], [0.02, 0.56, 0.14, body, 0], [0.06, 0.36, 0.09, pick, 0.012]]) {
            const c = at(cx, cy, zz + 0.02);
            arc(20, 0, TAU, (a, b) => K.quad(K.solid, [c, at(cx + Math.cos(a) * r, cy + Math.sin(a) * r, zz + 0.02), at(cx + Math.cos(b) * r, cy + Math.sin(b) * r, zz + 0.02), at(cx + Math.cos(b) * r, cy + Math.sin(b) * r, zz + 0.02)], fr.N(0, lean, 1), K.C(col), GLOSS));
            if (!zz) arc(20, 0, TAU, (a, b) => K.quad(K.solid, [at(cx + Math.cos(a) * r, cy + Math.sin(a) * r, -0.02), at(cx + Math.cos(b) * r, cy + Math.sin(b) * r, -0.02), at(cx + Math.cos(b) * r, cy + Math.sin(b) * r, 0.02), at(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0.02)], fr.N(Math.cos(a), Math.sin(a), 0), K.C(shade(col, 0.7)), GLOSS));
          }
          K.quad(K.solid, [at(-0.03, 0.62, 0.025), at(0.03, 0.62, 0.025), at(0.025, 1.25, 0.025), at(-0.025, 1.25, 0.025)], fr.N(0, lean, 1), K.C('#3a2010'), SATIN);
          for (let i = 0; i < 12; i++) { const y = 0.66 + i * 0.05 * (1 - i * 0.02); K.quad(K.solid, [at(-0.026, y, 0.027), at(0.026, y, 0.027), at(0.026, y + 0.003, 0.027), at(-0.026, y + 0.003, 0.027)], fr.N(0, lean, 1), K.C('#d8d8d8'), METAL); }
          K.quad(K.solid, [at(-0.04, 1.25, 0.02), at(0.04, 1.25, 0.02), at(0.05, 1.42, 0.02), at(-0.03, 1.42, 0.02)], fr.N(0, lean, 1), K.C(body), GLOSS);
          for (let i = 0; i < 4; i++) { const q = at(i % 2 ? 0.06 : -0.045, 1.29 + Math.floor(i / 2) * 0.08, 0.02); K.ball(q[0], q[1], q[2], 0.012, '#c0c4cc', 1, 6, METAL); }
          for (let i = 0; i < 4; i++) { const x = -0.012 + i * 0.008; bar(K, at(x, 0.24, 0.03), at(x * 0.8, 1.24, 0.03), 0.0012, '#e8e8e8', 1); }
          for (const s of [-1, 1]) bar(K, P(bx + s * 0.16, 0, 0.1), P(bx, 0.62, -0.12), 0.01, '#1a1a1a', 1);
          bar(K, P(bx - 0.16, 0.12, -0.02), P(bx + 0.16, 0.12, -0.02), 0.012, '#1a1a1a', 1);
        });
      },
    },
    mic_stand: {
      label: 'Mic on a stand', fields: [F('h', 'Mic height'), F('yaw', 'Facing (°)'), F('lift', 'Stood on (height)')],
      make: { at: [0, 0], yaw: 180, h: 1.5, lift: 0 },
      draw(K, p) {
        lifted(K, p, () => {
          const h = num(p.h, 1.5), [u, v] = p.at, fr = frameOf(K, p), chrome = '#b8bcc4';
          for (let i = 0; i < 3; i++) { const a = i * TAU / 3 + 0.3; bar(K, [u, v, 0.14], [u + Math.cos(a) * 0.26, v + Math.sin(a) * 0.26, 0.01], 0.009, '#1a1a1c', 1); }
          K.lathe(u, v, [[0.012, 0.12], [0.012, h - 0.06], [0, h - 0.06]], chrome, 1, 10, METAL);
          const a = fr.P(0, h - 0.06, 0), b = fr.P(0, h + 0.02, 0.1);
          bar(K, a, b, 0.012, '#1a1a1c', 1);
          const c = fr.P(0, h + 0.05, 0.18);
          tube(K, b, c, 0.018, '#1a1a1c', 1, 12, METAL);
          K.ball(c[0] + (c[0] - b[0]) * 0.3, c[1] + (c[1] - b[1]) * 0.3, c[2] + (c[2] - b[2]) * 0.3, 0.03, '#a8acb4', 1, 12, METAL);
        });
      },
    },
    truss_grid: {
      label: 'Box truss with lamps', fields: [F('w', 'Width'), F('depth', 'Depth'), F('y', 'Height'), F('top', 'Ceiling height'), F('lamps', 'Lamps on a side')],
      make: { at: [0, 0], w: 12, depth: 6, y: 5.2, top: 6, lamps: 7 },
      draw(K, p, set) {
        const w = num(p.w, 12), d = num(p.depth, 6), y = num(p.y, 5.2), top = num(p.top, 6), nL = Math.max(2, Math.min(12, num(p.lamps, 7) | 0)), [u, v] = p.at, s = 0.15, steel = '#9a9ea6';
        const aim = set.focus ? [set.focus[0], set.focus[2], set.focus[1]] : [u, v + d / 2, 1];
        const truss = (A, B) => {
          const L = Math.hypot(B[0] - A[0], B[1] - A[1]), du = (B[0] - A[0]) / L, dv = (B[1] - A[1]) / L, nu = -dv, nv = du;
          const C = (t, a, b) => [A[0] + du * t + nu * a * s, A[1] + dv * t + nv * a * s, y + b * s];
          for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) bar(K, C(0, a, b), C(L, a, b), 0.016, steel, 1);
          for (let t = 0, i = 0; t < L - 0.01; t += 0.3, i++) {
            const t1 = Math.min(L, t + 0.3);
            for (const [a0, b0, a1, b1] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) bar(K, C(i % 2 ? t : t1, a0, b0), C(i % 2 ? t1 : t, a1, b1), 0.006, steel, 1);
          }
        };
        const c = [[u - w / 2, v - d / 2], [u + w / 2, v - d / 2], [u + w / 2, v + d / 2], [u - w / 2, v + d / 2]];
        for (let i = 0; i < 4; i++) truss(c[i], c[(i + 1) % 4]);
        truss([u - w / 2, v], [u + w / 2, v]);
        // a chain motor up to the roof at each corner
        for (const [cu, cv] of c) { bar(K, [cu, cv, y + s], [cu, cv, top - 0.25], 0.012, '#5a5c60', 1); K.box(cu - 0.1, cu + 0.1, cv - 0.08, cv + 0.08, top - 0.3, top - 0.05, '#1e1f22', 1, null, METAL); }
        // the lamps: fresnels with barn doors, cans and profiles, each turned to the floor
        const lamp = (lu, lv, kind) => {
          const hang = [lu, lv, y - s - 0.02], dir = [aim[0] - lu, aim[1] - lv, aim[2] - hang[2]], L = Math.hypot(...dir), dn = dir.map((q) => q / L);
          bar(K, [lu, lv, y - s], [lu, lv, y - s - 0.12], 0.012, '#1a1a1c', 1);
          const at = (t) => [hang[0] + dn[0] * t, hang[1] + dn[1] * t, hang[2] - 0.12 + dn[2] * t];
          const len = kind === 2 ? 0.48 : 0.3, r = kind === 0 ? 0.1 : kind === 1 ? 0.08 : 0.065;
          tube(K, at(-len * 0.4), at(len * 0.6), r, '#16171a', 1, 12, METAL, true);
          tube(K, at(len * 0.6), at(len * 0.6 + 0.012), r * 0.82, '#fff1d0', 2.2, 12, EMISSIVE, true);
          if (kind === 0) {
            let e1 = [dn[1], -dn[0], 0]; const l1 = Math.hypot(...e1) || 1; e1 = e1.map((q) => q / l1);
            const e2 = [dn[1] * e1[2] - dn[2] * e1[1], dn[2] * e1[0] - dn[0] * e1[2], dn[0] * e1[1] - dn[1] * e1[0]], o = at(len * 0.6 + 0.02);
            for (const [a, b] of [[e1, e2], [e2, e1]]) for (const sg of [-1, 1]) {
              const P0 = (k1, k2, ex) => [o[0] + a[0] * r * k1 + b[0] * r * k2 + dn[0] * ex, o[1] + a[1] * r * k1 + b[1] * r * k2 + dn[1] * ex, o[2] + a[2] * r * k1 + b[2] * r * k2 + dn[2] * ex];
              K.quad(K.solid, [P0(sg, -1, 0), P0(sg, 1, 0), P0(sg * 1.6, 1.1, 0.14), P0(sg * 1.6, -1.1, 0.14)], K.nrmOf(a[0] * sg, a[2] * sg, a[1] * sg), K.C('#1a1a1c'), METAL);
            }
          }
        };
        for (const vv of [v - d / 2, v, v + d / 2]) for (let i = 0; i < nL; i++) lamp(u - w / 2 + w * (i + 0.5) / nL, vv, (i + Math.round(vv)) % 3);
      },
    },
    studio_cam: {
      label: 'Studio camera (pedestal, prompter)', fields: [F('yaw', 'Facing (°)'), F('h', 'Lens height'), F('text', 'Number', 'text')],
      make: { at: [0, 0], yaw: 0, h: 1.35, text: '1' },
      draw(K, p, set) {
        const h = num(p.h, 1.35), fr = frameOf(K, p, 0), { pbox, P } = fr, [u, v] = p.at, grey = '#3a3c42', dark = '#16171a';
        K.lathe(u, v, [[0.42, 0.02], [0.45, 0.06], [0.44, 0.16], [0.32, 0.22], [0.12, 0.26], [0, 0.26]], grey, 1, 20, METAL);
        for (let i = 0; i < 3; i++) { const a = i * TAU / 3; K.ball(u + Math.cos(a) * 0.38, v + Math.sin(a) * 0.38, 0.04, 0.04, '#1a1a1a', 1, 8, GLOSS); }
        K.lathe(u, v, [[0.1, 0.26], [0.1, 0.8], [0.08, 0.82], [0.08, h - 0.22], [0, h - 0.22]], '#6a6e76', 1, 16, METAL);
        torus(K, u, v, 0.78, 0.3, 0.016, '#a8acb4', 1, 24);
        for (let i = 0; i < 3; i++) { const a = i * TAU / 3 + 0.5; bar(K, [u + Math.cos(a) * 0.1, v + Math.sin(a) * 0.1, 0.78], [u + Math.cos(a) * 0.29, v + Math.sin(a) * 0.29, 0.78], 0.01, '#a8acb4', 1); }
        pbox(-0.13, 0.13, h - 0.22, h - 0.09, -0.15, 0.15, dark, 1, null, METAL);
        pbox(-0.14, 0.14, h - 0.09, h + 0.17, -0.42, 0.12, '#2a2c32', 1, null, SATIN);
        tube(K, P(0, h + 0.03, 0.12), P(0, h + 0.03, 0.42), 0.09, '#121214', 1, 14, METAL);
        pbox(-0.26, 0.26, h - 0.16, h + 0.26, 0.42, 0.8, '#141416', 1, null, SATIN);
        K.quad(K.solid, [P(-0.24, h - 0.14, 0.81), P(0.24, h - 0.14, 0.81), P(0.24, h + 0.24, 0.81), P(-0.24, h + 0.24, 0.81)], fr.N(0, 0, 1), K.C('#0a0c12'), GLOSS);
        for (let i = 0; i < 6; i++) fr.front(K.solid, -0.18 + (i % 2) * 0.03, 0.15 - (i % 3) * 0.05, h + 0.16 - i * 0.05, h + 0.18 - i * 0.05, 0.812, K.C('#c8d8e8', 1.4), EMISSIVE);
        pbox(-0.11, 0.11, h + 0.17, h + 0.32, -0.32, -0.06, '#121214', 1, null, SATIN);
        fr.front(K.solid, -0.09, 0.09, h + 0.19, h + 0.3, -0.322, K.C('#5a7a9a', 1.3), EMISSIVE);
        K.quad(K.solid, [P(0.09, h + 0.19, -0.3225), P(-0.09, h + 0.19, -0.3225), P(-0.09, h + 0.3, -0.3225), P(0.09, h + 0.3, -0.3225)], fr.N(0, 0, -1), K.C('#5a7a9a', 1.3), EMISSIVE, null, true);
        pbox(-0.04, 0.04, h + 0.32, h + 0.36, 0.0, 0.08, '#ff2020', 2.4);
        pbox(-0.03, 0.03, h + 0.26, h + 0.28, 0.79, 0.805, '#ff2020', 2.4);
        for (const sx of [-1, 1]) { bar(K, P(sx * 0.1, h - 0.15, -0.12), P(sx * 0.26, h - 0.1, -0.85), 0.014, '#2a2a2e', 1); bar(K, P(sx * 0.26, h - 0.1, -0.85), P(sx * 0.26, h - 0.1, -0.98), 0.022, '#1a1a1a', 1, LEATHER); }
        words(K, K.frame(...P(0.141, 0, -0.15).slice(0, 2), ...facingOf((p.yaw ?? 0) - 90)), brandText(p.text ?? '1', set), { y: h + 0.0, z: 0.001, h: 0.1, hex: '#e8e8e8', k: 1.3 });
        let prev = P(0, 0.2, -0.35);
        for (let i = 1; i <= 6; i++) { const nxt = P(Math.sin(i * 0.9) * 0.15, i < 2 ? 0.08 : 0.015, -0.35 - i * 0.3); bar(K, prev, nxt, 0.014, '#0c0c0e', 1, SATIN); prev = nxt; }
      },
    },
    potted_palm: {
      label: 'Potted palm', fields: [F('h', 'Height'), F('seed', 'Seed'), F('lift', 'Stood on (height)')],
      make: { at: [0, 0], h: 2, seed: 1, lift: 0 },
      draw(K, p, set) {
        lifted(K, p, () => {
          const H = num(p.h, 2), [u, v] = p.at, rnd = rollOf(num(p.seed, 1) * 7 + 3), brass = set.palette?.brass || '#c8a050', pot = 0.62;
          K.lathe(u, v, [[0.18, 0], [0.22, 0.04], [0.24, pot - 0.04], [0.26, pot - 0.02], [0.26, pot], [0.22, pot], [0, pot - 0.06]], '#141214', 1, 20, GLOSS);
          K.lathe(u, v, [[0.241, 0.1], [0.241, 0.13]], brass, 1, 20, METAL);
          K.lathe(u, v, [[0.225, pot - 0.05], [0, pot - 0.05]], '#2a1a10', 1, 16, CLOTH);
          const greens = ['#2e6a3a', '#3a7a42', '#24582e', '#467e3a'];
          const fronds = 11;
          for (let f = 0; f < fronds; f++) {
            const a = f * 2.4 + rnd() * 0.5, up = 0.55 + rnd() * 0.9, len = H * (0.45 + rnd() * 0.3), base = [u + Math.cos(a) * 0.03, v + Math.sin(a) * 0.03, pot - 0.02];
            const at = (t) => { const rr = t * len * (0.45 + 0.4 * (1 - up / 1.6)); return [base[0] + Math.cos(a) * rr, base[1] + Math.sin(a) * rr, base[2] + Math.sin(t * Math.PI * 0.55) * len * up * 0.75 - t * t * len * 0.25]; };
            let prev = at(0);
            const col = greens[f % greens.length];
            for (let i = 1; i <= 12; i++) {
              const t = i / 12, q = at(t);
              bar(K, prev, q, 0.006 * (1.4 - t), '#4a5a2a', 1, SATIN);
              if (t > 0.25) for (const sd of [-1, 1]) {
                const L = 0.2 * Math.sin(t * Math.PI) + 0.04, side = [-Math.sin(a) * sd, Math.cos(a) * sd], tip = [q[0] + side[0] * L * 0.8 + Math.cos(a) * L * 0.35, q[1] + side[1] * L * 0.8 + Math.sin(a) * L * 0.35, q[2] - L * 0.55];
                K.quad(K.solid, [q, [q[0] + Math.cos(a) * 0.03, q[1] + Math.sin(a) * 0.03, q[2] + 0.006], tip, tip], K.nrmOf(0, 1, 0), K.C(col, 0.9 + rnd() * 0.25), CLOTH);
              }
              prev = q;
            }
          }
        });
      },
    },
    arc_lamp: {
      label: 'Arc floor lamp', fields: [F('h', 'Height'), F('reach', 'Reach'), F('yaw', 'Facing (°)'), F('lift', 'Stood on (height)')],
      make: { at: [0, 0], yaw: 180, h: 2.1, reach: 1.3, lift: 0 },
      draw(K, p, set) {
        lifted(K, p, () => {
          const H = num(p.h, 2.1), R = num(p.reach, 1.3), fr = frameOf(K, p), { pbox, P } = fr, brass = set.palette?.brass || '#c8a050';
          pbox(-0.18, 0.18, 0, 0.09, -0.13, 0.13, '#e8e2d8', 1, null, GLOSS);
          let prev = P(0, 0.09, 0);
          for (let i = 1; i <= 16; i++) { const t = i / 16, a = t * Math.PI * 0.62, q = P(0, 0.09 + Math.sin(a) * (H - 0.1), R * (1 - Math.cos(a)) / (1 - Math.cos(Math.PI * 0.62))); bar(K, prev, q, 0.012, brass, 1); prev = q; }
          const tip = P(0, 0, R), y = 0.09 + Math.sin(Math.PI * 0.62) * (H - 0.1) - 0.06;
          K.lathe(tip[0], tip[1], [[0.2, y - 0.19], [0.19, y - 0.13], [0.135, y - 0.03], [0.05, y + 0.02], [0, y + 0.025]], brass, 1, 22, METAL);
          K.lathe(tip[0], tip[1], [[0.18, y - 0.185], [0, y - 0.16]], '#fff0c8', 2.2, 18);
        });
      },
    },
    bulb_sign: {
      label: 'Sign framed in bulbs', fields: [F('text', 'Text ({brand.name} is the network)', 'text'), F('sub', 'Second line', 'text'), F('h', 'Letter height'), F('y', 'Bottom off the floor'), F('yaw', 'Facing (°)'), F('colour', 'Letter colour', 'text'), F('bulbs', 'Bulbs every (0 for none)'), F('hang', 'Hung from (ceiling height, 0 for the wall)')],
      make: { at: [0, 0], yaw: 180, text: '{brand.name}', sub: '', h: 0.36, y: 4.6, bulbs: 0.11, hang: 0 },
      draw(K, p, set) {
        const text = brandText(p.text ?? '{brand.name}', set), sub = brandText(p.sub || '', set), h = num(p.h, 0.36), y = num(p.y, 4.6), fr = frameOf(K, p), { pbox, P } = fr, brass = set.palette?.brass || '#c8a050', col = brandColour(set, p), every = num(p.bulbs, 0.11), hang = num(p.hang, 0);
        const W = Math.max(0.6, letterWidth(text, h) + h * 1.4), Hh = h * (sub ? 2.15 : 1.7), y1 = y + Hh;
        pbox(-W / 2, W / 2, y, y1, -0.14, 0, '#0e0a0c', 1, null, SATIN);
        pbox(-W / 2 - 0.03, W / 2 + 0.03, y - 0.03, y, -0.15, 0.04, brass, 1, null, METAL);
        pbox(-W / 2 - 0.03, W / 2 + 0.03, y1, y1 + 0.03, -0.15, 0.04, brass, 1, null, METAL);
        for (const s of [-1, 1]) pbox(s > 0 ? W / 2 : -W / 2 - 0.03, s > 0 ? W / 2 + 0.03 : -W / 2, y, y1, -0.15, 0.04, brass, 1, null, METAL);
        words(K, fr, text, { y: y1 - h * 1.32, z: 0.004, h, maxW: W - h * 0.8, hex: col, k: 2.1 });
        if (sub) words(K, fr, sub, { y: y + h * 0.24, z: 0.004, h: h * 0.42, maxW: W - h, hex: '#f4ecd8', k: 1.6 });
        if (every > 0) {
          const bulb = (x, yy) => { const q = P(x, yy, 0.03), r = 0.024; K.lathe(q[0], q[1], [[0, q[2] - r], [r * 0.8, q[2] - r * 0.5], [r, q[2] + r * 0.2], [r * 0.6, q[2] + r * 0.85], [0, q[2] + r]], '#ffe6b0', 2.8, 7); };
          for (let x = -W / 2 + every / 2; x < W / 2; x += every) { bulb(x, y - 0.015); bulb(x, y1 + 0.015); }
          for (let yy = y + every / 2; yy < y1; yy += every) { bulb(-W / 2 - 0.015, yy); bulb(W / 2 + 0.015, yy); }
        }
        if (hang > y1) for (const s of [-1, 1]) bar(K, P(s * W * 0.38, y1 + 0.03, -0.07), P(s * W * 0.38, hang, -0.07), 0.004, '#3a3a3e', 1);
      },
    },
  };
}
