// GLASS 2 · A GRAND HOTEL'S FITTINGS. The signs, lamps and furniture an old hotel lobby has past what
// room-decor.js gives every finished room: raised brass letters lit from behind, a row of clocks for other
// cities, a lacquered directory board, twin-arm candle sconces in silk shades, standard lamps that light the
// room, picture lights, and the furniture forms (`drawHotelForm`): a key wall of pigeonholes, a buttoned
// leather sofa, a wing chair, a low marble-topped table, a brass luggage cart, and the reception desk as an old
// hotel has it (`dress: 'hotel'`). Pure: batches, no GL.
//
// ⚠ IT'S ALL DATA. A room says what it has (`flags.room.decor`, a row's `flags.look`); nothing here knows
// which hotel it is, so a second game on THOMAS dresses its own lobby with no edit here. Every key is optional.
//
// The frame is the layout's: u across, v back from the front wall, y up, metres. Along a wall `at` is u on the
// front and back walls and v on the sides, as room-decor.js has it. On a wall, x below runs to the viewer's
// RIGHT as they face it (`wallFrame`), so lettering reads the right way round without each caller mirroring it.
//
//   letters    [{ wall, at, y, text, h?, depth?, hex?, halo?, spread? }]   raised metal letters on standoffs, lit from
//              behind so each one stands in a rim of light (`halo: false` for none)
//   clocks     [{ wall, at, y, r?, gap?, list: [{ name, t: 'HH:MM' }], board? }]   a row of wall clocks on a walnut
//              board, each with its name on a plate under it, stopped where `t` says
//   directory  [{ wall, at, y, w?, title?, lines: [{ text, arrow?: 'up'|'down'|'left'|'right' }] }]   a black
//              lacquer board in a brass frame, gilt lines and arrows; arrows are as the reader faces the board
//   standards  [{ at: [u, v], h?, hex?, k?, tint? }]   a brass standard lamp in a pleated silk shade; `k` lights the room
//   art[].lamp  a brass picture light over that picture (room-decor.js draws the picture)
//   piclights  [{ wall, at, y, w, h, k? }]   a picture light alone, over a poster or a mark; `k` lights the room
//   sconces.kind 'twin'  a backplate, two scrolled arms, candle sleeves and a small pleated shade on each

import { MAT } from './ballpark-mesh.js';
import { legend, legendWidth } from '../../../../shared/legend-font.js';

const { GLOSS, METAL, SATIN, CLOTH, MATTE, LEATHER } = MAT;
// the codes gl/room.js reads for a light's own face (room-mesh.js GLOW, LAMP)
const GLOW = 40, LAMP = 42;
const BRASS = '#c9a24a', GILT = '#e2c27a', LACQUER = '#0d0b0a';
const WALNUT = { t: 'roomOak', c: '#5a3a26' }, MAHOGANY = { t: 'roomOak', c: '#4a1e14' }, DARKWOOD = '#2a160c';
const MARBLE = { t: 'roomMarble', c: '#f4efe6' };
const WALLS = ['front', 'back', 'left', 'right'];

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hex6 = (s, d) => (/^#[0-9a-f]{6}$/i.test(s || '') ? s : d);
const num = (x, d, lo = -Infinity, hi = Infinity) => (Number.isFinite(Number(x)) ? Math.max(lo, Math.min(hi, Number(x))) : d);

// A frame standing on a wall at `at` along it, z out into the room, x to the RIGHT of someone facing the wall.
// (A kit frame has +x to the viewer's left on a wall; this one is mirrored so text and arrows come out right.)
function wallFrame(K, L, wall, a) {
  const hu = L.w / 2, D = L.d;
  const [u, v, fu, fv] = wall === 'front' ? [a, 0, 0, 1] : wall === 'back' ? [a, D, 0, -1] : wall === 'left' ? [-hu, a, 1, 0] : [hu, a, -1, 0];
  const F = K.frame(u, v, fu, fv);
  const P = (x, y, z) => F.P(-x, y, z), N = (x, y, z) => F.N(-x, y, z);
  const box = (x0, x1, y0, y1, z0, z1, hex, k = 1, tex = null, surf) => F.pbox(-x1, -x0, y0, y1, z0, z1, hex, k, tex, surf);
  // a flat face on the wall's plane at depth z, its corners [x, y]
  const face = (ps, z, col, surf = MATTE, raw = false) => K.quad(K.solid, ps.map(([x, y]) => P(x, y, z)), N(0, 0, 1), col, surf, null, raw);
  return { P, N, box, face };
}
// A bar between two room points, six-sided (room-decor.js has its own; this one takes the facet count).
function rod(K, a, b, r, hex, k = 1, surf = METAL, n = 6) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(...d) || 1, t = d.map((x) => x / l);
  const up = Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const s = [t[1] * up[2] - t[2] * up[1], t[2] * up[0] - t[0] * up[2], t[0] * up[1] - t[1] * up[0]], sl = Math.hypot(...s);
  const e1 = s.map((x) => x / sl), e2 = [t[1] * e1[2] - t[2] * e1[1], t[2] * e1[0] - t[0] * e1[2], t[0] * e1[1] - t[1] * e1[0]];
  const P = (o, i) => { const g = i / n * Math.PI * 2, c = Math.cos(g) * r, q = Math.sin(g) * r; return [o[0] + e1[0] * c + e2[0] * q, o[1] + e1[1] * c + e2[1] * q, o[2] + e1[2] * c + e2[2] * q]; };
  for (let i = 0; i < n; i++) {
    const g = (i + 0.5) / n * Math.PI * 2, nn = [e1[0] * Math.cos(g) + e2[0] * Math.sin(g), e1[1] * Math.cos(g) + e2[1] * Math.sin(g), e1[2] * Math.cos(g) + e2[2] * Math.sin(g)];
    K.quad(K.solid, [P(a, i), P(a, i + 1), P(b, i + 1), P(b, i)], K.nrmOf(nn[0], nn[2], nn[1]), K.C(hex, k), surf);
  }
}
// a run of rods through room points
const path = (K, pts, r, hex, k, surf, n) => { for (let i = 0; i + 1 < pts.length; i++) rod(K, pts[i], pts[i + 1], r, hex, k, surf, n); };
// A drum of pleated silk round an upright axis at (u, v), r0 at y0 up to r1 at y1: each pleat its own facet, the
// pleats alternately lit, and lit from inside when the lamp's on (drawn raw then, as a lamp's face is).
function pleated(K, u, v, r0, y0, r1, y1, hex, on, n = 28) {
  for (let i = 0; i < n; i++) {
    const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2, am = (a0 + a1) / 2, k = (on ? 1.38 : 0.92) * (i % 2 ? 1 : 1.1);
    const P = (r, a, y) => [u + Math.cos(a) * r, v + Math.sin(a) * r, y];
    const col = K.C(hex, k), nrm = K.nrmOf(Math.cos(am), 0.3, Math.sin(am));
    K.quad(K.solid, [P(r0, a0, y0), P(r0, a1, y0), P(r1, a1, y1), P(r1, a0, y1)], nrm, col, on ? LAMP : CLOTH, null, on);
    // the inside, brighter: you see it from under the shade
    K.quad(K.solid, [P(r1 * 0.98, a0, y1), P(r1 * 0.98, a1, y1), P(r0 * 0.98, a1, y0), P(r0 * 0.98, a0, y0)], K.nrmOf(-Math.cos(am), 0, -Math.sin(am)), K.C(on ? '#fff0d0' : hex, on ? 1.7 : 0.7), on ? LAMP : CLOTH, null, on);
  }
  // a gilt band round the top and the bottom
  K.lathe(u, v, [[r0 + 0.004, y0], [r0 + 0.004, y0 + 0.012]], BRASS, 1.05, n, METAL);
  K.lathe(u, v, [[r1 + 0.004, y1 - 0.01], [r1 + 0.004, y1]], BRASS, 1.05, n, METAL);
}

// ── signs ─────────────────────────────────────────────────────────────────────────────────────────
// RAISED LETTERS: each stroke of the legend face as a solid bar standing `off` off the wall, its face and its
// returns in the metal, and behind it a rim of light on the wall, two steps out, as a halo-lit letter throws.
function letters(K, L, c, on) {
  if (!c?.text || !WALLS.includes(c.wall)) return;
  const W = wallFrame(K, L, c.wall, num(c.at, 0)), h = num(c.h, 0.3, 0.04, 1.2), y = num(c.y, 2.6);
  const dep = num(c.depth, Math.min(0.05, h * 0.14), 0.006, 0.15), off = num(c.off, 0.025, 0.005, 0.2), metal = hex6(c.hex, BRASS);
  const faceC = K.C(metal, 1.1), retC = K.C(metal, 0.72), spread = num(c.spread, h * 0.035, 0, 0.2);
  const halo = c.halo === false ? null : hex6(c.halo, '#ffc46e'), RGB = [1, 1, 1];
  const plate = (ps, col) => {
    if (col !== RGB) return;   // the comic look's inked drop: a raised letter casts its own
    const cx = ps.reduce((s, p) => s + p[0], 0) / 4, cy = ps.reduce((s, p) => s + p[1], 0) / 4;
    W.face(ps, off + dep, faceC, METAL);
    for (let i = 0; i < 4; i++) {
      const p = ps[i], q = ps[(i + 1) % 4];
      let nx = q[1] - p[1], ny = -(q[0] - p[0]);
      if (nx * ((p[0] + q[0]) / 2 - cx) + ny * ((p[1] + q[1]) / 2 - cy) < 0) { nx = -nx; ny = -ny; }
      const l = Math.hypot(nx, ny) || 1;
      K.quad(K.solid, [W.P(p[0], p[1], off), W.P(q[0], q[1], off), W.P(q[0], q[1], off + dep), W.P(p[0], p[1], off + dep)], W.N(nx / l, ny / l, 0), retC, METAL);
    }
    if (!halo) return;
    // each corner pushed out along both its edges, so a bar grows by the same margin all round
    const grow = (s) => ps.map((p, i) => {
      const a = ps[(i + 3) % 4], b = ps[(i + 1) % 4], la = Math.hypot(p[0] - a[0], p[1] - a[1]) || 1, lb = Math.hypot(p[0] - b[0], p[1] - b[1]) || 1;
      return [p[0] + ((p[0] - a[0]) / la + (p[0] - b[0]) / lb) * s, p[1] + ((p[1] - a[1]) / la + (p[1] - b[1]) / lb) * s];
    });
    W.face(grow(spread), 0.006, K.C(halo, on ? 1.95 : 0.6), on ? GLOW : MATTE, on);
  };
  legend({ plate }, String(c.text), 0, y, h, RGB, 0, 0);
  // the wash the letters throw on the wall round them: a few soft-cornered steps, brightest in the middle, under the rims
  if (halo && on && c.wash !== false) {
    const lw = legendWidth(String(c.text).toUpperCase(), h), steps = 6;
    // each step the wall's own colour as the lamps leave it (washBase), warmed toward the halo's further in, so the
    // outermost meets the wall and the light gathers behind the letters
    const wallC = K.C(hex6(L.spec?.tone?.wall, '#c99aa0'), num(c.washBase, 0.34, 0.05, 1.5)), haloC = K.C(halo, 1.05);
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1), mx = lw / 2 + h * (0.8 - t * 0.62), my = h * (1.1 - t * 0.55), cr = h * 0.4 * (1 - t * 0.5), f = 0.06 + t * t * 0.62;
      const col = wallC.map((w, k) => w * (1 - f) + haloC[k] * f);
      const pts = [];
      for (const [sx, sy, a0] of [[1, 1, 0], [-1, 1, Math.PI / 2], [-1, -1, Math.PI], [1, -1, Math.PI * 1.5]]) for (let j = 0; j <= 3; j++) { const a = a0 + j / 3 * Math.PI / 2; pts.push([sx * (mx - cr) + Math.cos(a) * cr, y + sy * (my - cr) + Math.sin(a) * cr]); }
      // a fan of quads from the middle, as a soft-cornered panel
      for (let j = 0; j < pts.length; j++) { const p = pts[j], q = pts[(j + 1) % pts.length]; W.face([[0, y], p, q, q], 0.002 + i * 0.0005, col, GLOW, true); }
    }
  }
}
// small metal lettering straight onto a face at depth z: centred at x unless `left` says where it starts
function smallText(K, W, text, x, y, z, h, hex, { left = null, maxW = Infinity, raw = true } = {}) {
  const s = String(text).toUpperCase(), w1 = legendWidth(s, 1), hh = Math.min(h, maxW / (w1 || 1));
  const cx = left == null ? x : left + w1 * hh / 2;
  legend({ plate: (ps, col) => W.face(ps, z, col, METAL, raw) }, s, cx, y, hh, K.C(hex, 1.05), 0, 0);
  return w1 * hh;
}
// A flat ring (or a disc, r0 0) on a wall frame at depth z round (x, y)
function ring(K, W, x, y, z, r0, r1, hex, k = 1, surf = MATTE, segs = 28) {
  const col = K.C(hex, k);
  for (let i = 0; i < segs; i++) {
    const a0 = i / segs * Math.PI * 2, a1 = (i + 1) / segs * Math.PI * 2, at = (r, a) => [x + Math.cos(a) * r, y + Math.sin(a) * r];
    W.face([at(r0, a0), at(r1, a0), at(r1, a1), at(r0, a1)], z, col, surf);
  }
}
// a tapered bar on a wall frame at depth z: from (x, y) at angle `a` (clockwise from twelve), `len` out, `tail` back
function hand(K, W, x, y, z, a, len, wid, tail, hex, k = 1) {
  const dx = Math.sin(a), dy = Math.cos(a), px = dy, py = -dx;
  const b = [x - dx * tail, y - dy * tail], t = [x + dx * len, y + dy * len];
  W.face([[b[0] + px * wid / 2, b[1] + py * wid / 2], [t[0] + px * wid * 0.2, t[1] + py * wid * 0.2], [t[0] - px * wid * 0.2, t[1] - py * wid * 0.2], [b[0] - px * wid / 2, b[1] - py * wid / 2]], z, K.C(hex, k), SATIN);
}
// WALL CLOCKS: a walnut board with a gilt edge, and on it a row of brass-bezelled clocks, each with its name on a
// lacquer plate under it, its hands where `t` stopped them.
function clocks(K, L, c) {
  const list = (Array.isArray(c?.list) ? c.list : []).filter((x) => x && x.name).slice(0, 8);
  if (!list.length || !WALLS.includes(c.wall)) return;
  const W = wallFrame(K, L, c.wall, num(c.at, 0)), r = num(c.r, 0.15, 0.06, 0.4), gap = num(c.gap, r * 3.4, r * 2.4, 2), y = num(c.y, 2.6);
  const span = (list.length - 1) * gap, bw = span / 2 + r + 0.14, py = y - r - 0.085, ph = 0.058;
  if (c.board !== false) {
    const y0 = py - ph / 2 - 0.07, y1 = y + r + 0.08;
    W.box(-bw, bw, y0, y1, 0, 0.022, '#5a3a26', 1, WALNUT, SATIN);
    for (const [x0, x1, q0, q1] of [[-bw - 0.012, bw + 0.012, y1, y1 + 0.016], [-bw - 0.012, bw + 0.012, y0 - 0.016, y0], [-bw - 0.012, -bw, y0, y1], [bw, bw + 0.012, y0, y1]]) W.box(x0, x1, q0, q1, 0, 0.03, BRASS, 1.06, null, METAL);
  }
  list.forEach((it, i) => {
    const x = -span / 2 + i * gap;
    ring(K, W, x, y, 0.024, r + 0.012, r + 0.034, '#2a1a10', 1, SATIN);
    ring(K, W, x, y, 0.05, r - 0.004, r + 0.026, BRASS, 1.12, METAL);
    ring(K, W, x, y, 0.046, 0, r - 0.002, '#efe4c8', 1.02, SATIN, 32);
    // the twelve, a heavier bar at the quarters
    for (let q = 0; q < 12; q++) { const a = q / 12 * Math.PI * 2; hand(K, W, x + Math.sin(a) * r * 0.86, y + Math.cos(a) * r * 0.86, 0.047, a, r * (q % 3 ? 0.07 : 0.1), r * (q % 3 ? 0.03 : 0.055), 0, '#1a1410'); }
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(it.t || '')), hh = m ? (+m[1] % 12) : (i * 5 + 3) % 12, mm = m ? +m[2] : (i * 17 + 10) % 60;
    hand(K, W, x, y, 0.048, (hh + mm / 60) / 12 * Math.PI * 2, r * 0.52, r * 0.075, r * 0.12, '#141010');
    hand(K, W, x, y, 0.049, mm / 60 * Math.PI * 2, r * 0.8, r * 0.05, r * 0.14, '#141010');
    ring(K, W, x, y, 0.05, 0, r * 0.06, BRASS, 1.1, METAL, 10);
    // the name plate
    const pw = Math.min(gap * 0.86, r * 2.6);
    W.box(x - pw / 2, x + pw / 2, py - ph / 2, py + ph / 2, 0.022, 0.032, LACQUER, 1, null, GLOSS);
    W.box(x - pw / 2 - 0.006, x + pw / 2 + 0.006, py - ph / 2 - 0.006, py + ph / 2 + 0.006, 0.022, 0.028, BRASS, 1.05, null, METAL);
    smallText(K, W, it.name, x, py, 0.033, ph * 0.52, GILT, { maxW: pw - 0.03 });
  });
}
// an arrow on a wall frame at depth z, pointing `dir`, `s` long, centred at (x, y)
function arrow(K, W, x, y, z, dir, s, hex) {
  const [dx, dy] = dir === 'up' ? [0, 1] : dir === 'down' ? [0, -1] : dir === 'left' ? [-1, 0] : [1, 0], px = -dy, py = dx, t = s * 0.13;
  const at = (a, b) => [x + dx * a + px * b, y + dy * a + py * b], col = K.C(hex, 1.05);
  W.face([at(-s / 2, -t / 2), at(s * 0.1, -t / 2), at(s * 0.1, t / 2), at(-s / 2, t / 2)], z, col, METAL, true);
  W.face([at(s * 0.02, -t * 1.9), at(s / 2, 0), at(s / 2, 0), at(s * 0.02, t * 1.9)], z, col, METAL, true);
}
// A DIRECTORY: black lacquer in a bevelled brass frame, a title over a gilt rule, then each line with its arrow.
function directory(K, L, c) {
  const lines = (Array.isArray(c?.lines) ? c.lines : []).filter((l) => l && l.text).slice(0, 10);
  if (!lines.length || !WALLS.includes(c.wall)) return;
  const W = wallFrame(K, L, c.wall, num(c.at, 0)), w = num(c.w, 0.7, 0.3, 2.4), lh = num(c.lh, 0.055, 0.02, 0.2), pitch = lh * 2;
  const th = lh * 1.3, top = c.title ? th * 2.2 : 0, hgt = lines.length * pitch + top + 0.1, y = num(c.y, 1.6), y0 = y - hgt / 2, y1 = y + hgt / 2, hw = w / 2;
  W.box(-hw, hw, y0, y1, 0, 0.03, LACQUER, 1, null, GLOSS);
  const f = 0.028;
  for (const [x0, x1, q0, q1] of [[-hw - f, hw + f, y1, y1 + f], [-hw - f, hw + f, y0 - f, y0], [-hw - f, -hw, y0, y1], [hw, hw + f, y0, y1]]) W.box(x0, x1, q0, q1, 0, 0.042, BRASS, 1.06, null, METAL);
  let yy = y1 - 0.05;
  if (c.title) {
    yy -= th * 0.7;
    smallText(K, W, c.title, 0, yy, 0.031, th, GILT, { maxW: w - 0.1 });
    yy -= th * 0.95;
    W.face([[-hw + 0.06, yy - 0.003], [hw - 0.06, yy - 0.003], [hw - 0.06, yy + 0.003], [-hw + 0.06, yy + 0.003]], 0.031, K.C(GILT, 1), METAL, true);
    yy -= th * 0.55;
  }
  for (const ln of lines) {
    yy -= pitch / 2;
    const room = ln.arrow ? w - 0.2 - lh * 1.6 : w - 0.12;
    smallText(K, W, ln.text, 0, yy, 0.031, lh, GILT, { left: -hw + 0.06, maxW: room });
    if (['up', 'down', 'left', 'right'].includes(ln.arrow)) arrow(K, W, hw - 0.06 - lh * 0.7, yy, 0.031, ln.arrow, lh * 1.3, GILT);
    yy -= pitch / 2;
  }
}

// ── lights ────────────────────────────────────────────────────────────────────────────────────────
// A STANDARD LAMP: a weighted brass foot, a column with a knop, a bulb in a pleated silk drum.
function standard(K, L, s, { lampOn, lamps }) {
  const [u, v] = s.at, h = num(s.h, 1.62, 1, 2.2), on = lampOn !== false, shade = hex6(s.hex, '#ead2a4');
  K.lathe(u, v, [[0, 0], [0.17, 0], [0.17, 0.02], [0.13, 0.045], [0.04, 0.07], [0.02, 0.095], [0, 0.095]], BRASS, 1.04, 22, METAL);
  K.lathe(u, v, [[0.013, 0.095], [0.013, h * 0.55], [0.03, h * 0.56], [0.032, h * 0.58], [0.013, h * 0.6], [0.013, h - 0.24], [0.022, h - 0.24], [0.022, h - 0.2], [0, h - 0.2]], BRASS, 1.08, 10, METAL);
  K.ball(u, v, h - 0.15, 0.042, on ? '#fff4dc' : '#e8e2d4', on ? 2.6 : 0.9, 10, on ? LAMP : MATTE);
  pleated(K, u, v, 0.25, h - 0.3, 0.16, h - 0.02, shade, on);
  K.lathe(u, v, [[0.012, h - 0.02], [0.012, h + 0.03], [0.02, h + 0.04], [0, h + 0.06]], BRASS, 1.1, 8, METAL);
  if (on && lamps && Number(s.k ?? 0.6) > 0) lamps.push({ p: L.world(u, v, h - 0.2), annex: false, k: num(s.k, 0.6, 0.05, 2), tint: Array.isArray(s.tint) ? s.tint : [1.1, 0.94, 0.74] });
}
// A PICTURE LIGHT: a brass hood on two arms over the top of a frame, lit underneath.
function pictureLight(K, L, c, on) {
  const wall = WALLS.includes(c.wall) ? c.wall : 'back', W = wallFrame(K, L, wall, num(c.at, 0)), w = num(c.w, 1.2, 0.3, 6), h = num(c.h, 1.5, 0.3, 4), y = num(c.y, 1.6, 0.4, 6);
  const top = y + h / 2 + 0.07, lw = Math.max(0.3, w * 0.62) / 2;
  W.box(-0.05, 0.05, top - 0.02, top + 0.06, 0, 0.02, BRASS, 1.04, null, METAL);
  for (const s of [-1, 1]) rod(K, W.P(s * 0.03, top + 0.02, 0.02), W.P(s * lw * 0.7, top + 0.08, 0.17), 0.007, BRASS, 1.08);
  W.box(-lw, lw, top + 0.06, top + 0.1, 0.13, 0.21, BRASS, 1.06, null, METAL);
  W.box(-lw - 0.012, lw + 0.012, top + 0.055, top + 0.07, 0.125, 0.215, '#6a5030', 1, null, METAL);
  K.quad(K.solid, [W.P(-lw + 0.01, top + 0.054, 0.135), W.P(lw - 0.01, top + 0.054, 0.135), W.P(lw - 0.01, top + 0.054, 0.205), W.P(-lw + 0.01, top + 0.054, 0.205)], W.N(0, -1, 0), K.C('#fff2d4', on ? 2 : 0.8), on ? LAMP : MATTE, null, on);
}
// A TWIN SCONCE: an oval brass backplate, two scrolled arms, a cup and a candle sleeve on each, and over each
// flame a small pleated silk shade. Called by room-decor.js's sconce() for `kind: 'twin'`.
export function twinSconce(K, L, wall, a, y, { lampOn, hex = BRASS }) {
  const W = wallFrame(K, L, wall, a), on = lampOn !== false, metal = hex6(hex, BRASS);
  W.box(-0.045, 0.045, y - 0.2, y + 0.04, 0, 0.016, metal, 1.04, null, METAL);
  W.box(-0.03, 0.03, y - 0.17, y + 0.01, 0.016, 0.028, metal, 1.1, null, METAL);
  for (const s of [-1, 1]) {
    const p0 = W.P(0, y - 0.11, 0.026), p1 = W.P(s * 0.07, y - 0.15, 0.07), p2 = W.P(s * 0.13, y - 0.12, 0.11), p3 = W.P(s * 0.15, y - 0.04, 0.12);
    path(K, [p0, p1, p2, p3], 0.008, metal, 1.08, METAL, 6);
    const [cu, cv] = W.P(s * 0.15, 0, 0.12);
    K.lathe(cu, cv, [[0, y - 0.045], [0.034, y - 0.04], [0.04, y - 0.028], [0.013, y - 0.02], [0, y - 0.02]], metal, 1.08, 14, METAL);
    K.lathe(cu, cv, [[0.012, y - 0.02], [0.012, y + 0.07], [0, y + 0.07]], '#f2ead8', 1, 10, SATIN);
    K.ball(cu, cv, y + 0.088, 0.011, on ? '#fff3d6' : '#ddd6c8', on ? 2.4 : 0.9, 8, on ? LAMP : MATTE);
    pleated(K, cu, cv, 0.068, y + 0.045, 0.04, y + 0.16, '#f0dcb4', on, 20);
  }
}

// ── the room's dressing ─────────────────────────────────────────────────────────────────────────────
export function drawHotelDecor(K, L, dc, ctx) {
  const on = ctx.lampOn !== false;
  for (const c of [].concat(dc.letters || [])) letters(K, L, c, on);
  for (const c of [].concat(dc.clocks || [])) clocks(K, L, c);
  for (const c of [].concat(dc.directory || [])) directory(K, L, c);
  for (const s of [].concat(dc.standards || [])) if (Array.isArray(s?.at) && s.at.length === 2 && s.at.every(Number.isFinite)) standard(K, L, s, ctx);
  for (const c of [].concat(dc.art || [])) if (c?.lamp) pictureLight(K, L, c, on);
  // a picture light over something with no frame of its own (a poster pasted to the wall): the hood, and a warm
  // lamp a little out from the wall that lights what's under it
  for (const c of [].concat(dc.piclights || [])) {
    if (!c || !WALLS.includes(c.wall)) continue;
    pictureLight(K, L, c, on);
    if (on && ctx.lamps) { const W = wallFrame(K, L, c.wall, num(c.at, 0)), q = W.P(0, num(c.y, 1.6, 0.4, 6) + num(c.h, 1.5, 0.3, 4) * 0.2, 0.45); ctx.lamps.push({ p: L.world(q[0], q[1], q[2]), annex: false, k: num(c.k, 0.9, 0.05, 3), tint: [1.15, 0.92, 0.7] }); }
  }
}

// ── furniture ─────────────────────────────────────────────────────────────────────────────────────
const LEATHERS = { oxblood: '#5e1d17', green: '#1f3a2c', tan: '#8a5a32', black: '#1c1816' };
const VELVETS = { emerald: '#1f4d3c', rose: '#8a3a4a', gold: '#a8823a', navy: '#1f2e4a', claret: '#5a1a26' };

// The forms an old hotel's rows take. True when it drew the piece. `F` is the piece's own frame (room-kit.js):
// x across, y up, z out of its front.
export function drawHotelForm(K, F, p) {
  const { P, pbox, alongX, alongZ } = F, w = p.w, d = p.d, h = p.h, hw = w / 2, hd = d / 2, dress = p.dress || '';
  const R = (...a) => K.rounded(...a), lat = (x, z, prof, mat, k = 1, n = 14, surf = SATIN) => { const [u, v] = P(x, 0, z); K.lathe(u, v, prof, mat, k, n, surf); };
  const r = rng(p.seed || 7);
  switch (p.form) {
    case 'reception': {
      if (dress !== 'hotel') return false;
      // an old hotel's desk: a mahogany front in raised panels between pilasters, a brass kick plate, a marble top
      // on a brass band; on it the register open at today, a bell, a pen in its stand and a banker's lamp
      pbox(-hw + 0.05, hw - 0.05, 0, 0.1, -hd + 0.04, hd - 0.07, '#140e0a', 1, null, SATIN);
      pbox(-hw + 0.04, hw - 0.04, 0.1, h - 0.06, -hd + 0.04, hd - 0.05, '#4a1e14', 1, MAHOGANY, SATIN);
      pbox(-hw + 0.05, hw - 0.05, 0.1, 0.17, hd - 0.05, hd - 0.036, BRASS, 1.02, null, METAL);
      const n = Math.max(3, Math.round(w / 0.72)), pw = (w - 0.08) / n;
      for (let i = 0; i <= n; i++) {
        const x = -hw + 0.04 + i * pw;
        pbox(x - 0.035, x + 0.035, 0.17, h - 0.07, hd - 0.05, hd - 0.012, '#4a1e14', 0.92, MAHOGANY, SATIN);
        pbox(x - 0.045, x + 0.045, h - 0.13, h - 0.085, hd - 0.05, hd - 0.006, BRASS, 1.04, null, METAL);
      }
      for (let i = 0; i < n; i++) {
        const x0 = -hw + 0.04 + i * pw + 0.07, x1 = x0 + pw - 0.14, y0 = 0.26, y1 = h - 0.2;
        pbox(x0, x1, y0, y1, hd - 0.05, hd - 0.03, '#4a1e14', 1.06, MAHOGANY, SATIN);
        pbox(x0 + 0.05, x1 - 0.05, y0 + 0.05, y1 - 0.05, hd - 0.03, hd - 0.02, '#4a1e14', 1.14, MAHOGANY, SATIN);
        for (const [a0, a1, b0, b1] of [[x0, x1, y1 - 0.008, y1], [x0, x1, y0, y0 + 0.008], [x0, x0 + 0.008, y0, y1], [x1 - 0.008, x1, y0, y1]]) pbox(a0, a1, b0, b1, hd - 0.03, hd - 0.024, BRASS, 1.06, null, METAL);
      }
      pbox(-hw, hw, h - 0.075, h - 0.05, -hd + 0.02, hd + 0.02, BRASS, 1.06, null, METAL);
      pbox(-hw - 0.03, hw + 0.03, h - 0.05, h, -hd - 0.02, hd + 0.05, '#ffffff', 1.04, MARBLE, GLOSS);
      pbox(-hw + 0.1, hw - 0.1, 0.72, 0.76, -hd - 0.38, -hd + 0.02, '#4a1e14', 1, MAHOGANY, SATIN);
      // the register: red boards, two pages, a ribbon, the day's lines
      const bx = -0.15;
      pbox(bx - 0.25, bx + 0.25, h, h + 0.012, -0.17, 0.17, '#5a1418', 1, null, LEATHER);
      for (const s of [-1, 1]) pbox(s < 0 ? bx - 0.235 : bx + 0.006, s < 0 ? bx - 0.006 : bx + 0.235, h + 0.012, h + 0.024, -0.155, 0.155, '#f2ead6', 1.02, null, MATTE);
      for (let i = 0; i < 6; i++) { const z = -0.12 + i * 0.045; pbox(bx - 0.21, bx - 0.04 - (i % 3) * 0.03, h + 0.0245, h + 0.026, z, z + 0.004, '#3a3040', 0.9, null, MATTE); if (i < 4) pbox(bx + 0.03, bx + 0.2 - (i % 2) * 0.05, h + 0.0245, h + 0.026, z, z + 0.004, '#3a3040', 0.9, null, MATTE); }
      pbox(bx - 0.006, bx + 0.006, h + 0.018, h + 0.026, 0.15, 0.24, '#8a1a20', 1, null, CLOTH);
      // the pen in its stand
      lat(bx + 0.36, 0.06, [[0, h], [0.04, h], [0.04, h + 0.015], [0.012, h + 0.025], [0, h + 0.025]], BRASS, 1.06, 12, METAL);
      rod(K, P(bx + 0.36, h + 0.02, 0.06), P(bx + 0.33, h + 0.16, 0.0), 0.005, '#141010', 1, GLOSS);
      // the bell
      lat(-hw + 0.32, 0.08, [[0, h], [0.05, h], [0.05, h + 0.01], [0, h + 0.01]], '#2a2420', 1, 14);
      K.ball(...P(-hw + 0.32, h + 0.012, 0.08).slice(0, 2), h + 0.012, 0.042, BRASS, 1.12, 14, METAL);
      lat(-hw + 0.32, 0.08, [[0.005, h + 0.05], [0.005, h + 0.07], [0.011, h + 0.072], [0, h + 0.075]], BRASS, 1.1, 8, METAL);
      // the banker's lamp: a brass foot, an arm, a green glass shade lit underneath
      const lx = hw - 0.45, lz = -0.05, on = true;
      R(...alongX(), lx - 0.11, lx + 0.11, lz - 0.07, lz + 0.07, h, h + 0.035, 0.02, BRASS, 1.06, METAL);
      rod(K, P(lx, h + 0.035, lz), P(lx, h + 0.3, lz), 0.009, BRASS, 1.08);
      R(...alongX(), lx - 0.16, lx + 0.16, lz - 0.075, lz + 0.075, h + 0.3, h + 0.37, 0.035, '#1d5a3c', 1.05, GLOSS);
      K.quad(K.solid, [P(lx - 0.14, h + 0.299, lz - 0.055), P(lx + 0.14, h + 0.299, lz - 0.055), P(lx + 0.14, h + 0.299, lz + 0.055), P(lx - 0.14, h + 0.299, lz + 0.055)], F.N(0, -1, 0), K.C('#fff0c8', on ? 2.2 : 0.8), on ? LAMP : MATTE, null, on);
      rod(K, P(lx + 0.08, h + 0.3, lz + 0.06), P(lx + 0.08, h + 0.22, lz + 0.06), 0.002, BRASS, 1.1, METAL, 4);
      return true;
    }
    case 'pigeonholes': {
      // A KEY WALL: a run of walnut drawers to counter height, and over it a grid of pigeonholes under a cornice, a
      // brass number under each, and in most a key on its fob; a letter waits in a few, and some stand empty
      pbox(-hw, hw, 0, 0.08, -hd, hd - 0.03, '#1a120c', 1, null, SATIN);
      pbox(-hw, hw, 0.08, 0.92, -hd, hd, '#5a3a26', 1, WALNUT, SATIN);
      const nd = Math.max(2, Math.round(w / 0.62)), dw = w / nd;
      for (let i = 0; i < nd; i++) for (const [y0, y1] of [[0.14, 0.5], [0.54, 0.88]]) {
        const x0 = -hw + i * dw + 0.025, x1 = x0 + dw - 0.05;
        pbox(x0, x1, y0, y1, hd, hd + 0.014, '#5a3a26', 1.08, WALNUT, SATIN);
        pbox((x0 + x1) / 2 - 0.05, (x0 + x1) / 2 + 0.05, (y0 + y1) / 2 - 0.008, (y0 + y1) / 2 + 0.008, hd + 0.014, hd + 0.03, BRASS, 1.1, null, METAL);
      }
      pbox(-hw - 0.02, hw + 0.02, 0.92, 0.955, -hd, hd + 0.03, '#3a2214', 1, { t: 'roomOak', c: '#3a2214' }, GLOSS);
      const g0 = 1.0, g1 = h - 0.18, zb = -hd, zf = hd - 0.12, t = 0.009;
      pbox(-hw, hw, g0, g1, zb, zb + 0.015, '#1c120c', 1, null, MATTE);
      const cols = Math.max(4, Math.round((w - 0.08) / 0.2)), rows = Math.max(3, Math.round((g1 - g0) / 0.2)), cw = (w - 0.08) / cols, rh = (g1 - g0) / rows;
      for (const s of [-1, 1]) pbox(s < 0 ? -hw : hw - 0.04, s < 0 ? -hw + 0.04 : hw, g0, g1, zb, zf, '#5a3a26', 1, WALNUT, SATIN);
      for (let i = 1; i < cols; i++) { const x = -hw + 0.04 + i * cw; pbox(x - t, x + t, g0, g1, zb, zf, '#5a3a26', 0.96, WALNUT, SATIN); }
      for (let j = 0; j <= rows; j++) { const y = g0 + j * rh; pbox(-hw + 0.04, hw - 0.04, y - t, y + t, zb, zf, '#5a3a26', 1.02, WALNUT, SATIN); }
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const cx = -hw + 0.04 + (i + 0.5) * cw, y0 = g0 + j * rh + t, y1 = g0 + (j + 1) * rh - t, roll = r();
        pbox(cx - 0.028, cx + 0.028, y0 - t - 0.002, y0 - t + 0.014, zf, zf + 0.004, BRASS, 1.08, null, METAL);
        if (roll < 0.64) {
          // the key on its hook: a brass ring, the fob, the key's bit hanging below it
          const kx = cx + (r() - 0.5) * 0.04, kz = zf - 0.03 - r() * 0.04;
          pbox(kx - 0.003, kx + 0.003, y1 - 0.03, y1 - 0.002, kz - 0.003, kz + 0.003, BRASS, 1.1, null, METAL);
          pbox(kx - 0.016, kx + 0.016, y1 - 0.095, y1 - 0.03, kz - 0.004, kz + 0.004, roll < 0.32 ? BRASS : '#8a2a22', roll < 0.32 ? 1.12 : 0.95, null, roll < 0.32 ? METAL : GLOSS);
          pbox(kx - 0.004, kx + 0.004, y1 - 0.15, y1 - 0.095, kz - 0.002, kz + 0.002, '#a08a5a', 1.02, null, METAL);
        } else if (roll < 0.8) {
          // a letter left for somebody, stood up against the back
          const lw = 0.06 + r() * 0.03;
          pbox(cx - lw, cx + lw, y0, y0 + 0.085 + r() * 0.03, zb + 0.02, zb + 0.026, r() < 0.5 ? '#efe6d2' : '#d8c8a0', 1, null, MATTE);
        }
      }
      pbox(-hw - 0.03, hw + 0.03, g1, g1 + 0.05, zb, zf + 0.04, '#5a3a26', 1.04, WALNUT, SATIN);
      pbox(-hw - 0.03, hw + 0.03, g1 + 0.045, g1 + 0.056, zf + 0.04, zf + 0.046, BRASS, 1.08, null, METAL);
      pbox(-hw - 0.06, hw + 0.06, g1 + 0.05, h, zb, zf + 0.07, '#5a3a26', 1.08, WALNUT, SATIN);
      return true;
    }
    case 'chesterfield': {
      // A CHESTERFIELD: buttoned leather, the back and the arms one height and rolled over, bun feet, a row of
      // brass nails along the front
      const col = LEATHERS[dress] || LEATHERS.oxblood, sy = 0.37;
      for (const [x, z] of [[-hw + 0.1, -hd + 0.1], [hw - 0.1, -hd + 0.1], [-hw + 0.1, hd - 0.1], [hw - 0.1, hd - 0.1]]) lat(x, z, [[0, 0], [0.035, 0], [0.045, 0.03], [0.04, 0.08], [0.03, 0.1], [0, 0.1]], DARKWOOD, 1, 12, SATIN);
      R(...alongX(), -hw + 0.03, hw - 0.03, -hd + 0.03, hd - 0.02, 0.1, sy - 0.01, 0.035, col, 0.88, LEATHER);
      for (let x = -hw + 0.06; x <= hw - 0.06; x += 0.04) pbox(x - 0.006, x + 0.006, 0.12, 0.132, hd - 0.022, hd - 0.012, BRASS, 1.12, null, METAL);
      R(...alongX(0.05, sy), -hw + 0.2, hw - 0.2, -hd + 0.03, -hd + 0.3, sy - 0.02, h - 0.06, 0.04, col, 0.97, LEATHER);
      R(...alongX(), -hw + 0.04, hw - 0.04, -hd, -hd + 0.26, h - 0.13, h, 0.065, col, 1.02, LEATHER);
      for (const s of [-1, 1]) {
        R(...alongZ(), -hd + 0.03, hd - 0.01, s < 0 ? -hw + 0.01 : hw - 0.22, s < 0 ? -hw + 0.22 : hw - 0.01, 0.1, h - 0.08, 0.04, col, 0.93, LEATHER);
        R(...alongZ(), -hd + 0.01, hd + 0.03, s < 0 ? -hw - 0.03 : hw - 0.25, s < 0 ? -hw + 0.25 : hw + 0.03, h - 0.15, h, 0.07, col, 1.0, LEATHER);
        // a line of nails round the arm's front, an inch in from its edge
        const ax = s * (hw - 0.11);
        for (let y = 0.16; y < h - 0.2; y += 0.05) for (const dx of [-0.075, 0.075]) pbox(ax + dx - 0.005, ax + dx + 0.005, y, y + 0.01, hd - 0.012, hd - 0.004, BRASS, 1.02, null, METAL);
      }
      const n = Math.max(2, Math.min(3, Math.round((w - 0.44) / 0.6))), inner = w - 0.46, third = inner / n;
      for (let i = 0; i < n; i++) { const a0 = -inner / 2 + i * third + 0.006; R(...alongX(), a0, a0 + third - 0.012, -hd + 0.27, hd + 0.015, sy - 0.03, sy + 0.08, 0.05, col, 1.04, LEATHER); }
      // the buttons, set in a diamond over the back's face and down the arms inside
      for (let row = 0; row < 3; row++) {
        const y = sy + 0.14 + row * 0.09, z = -hd + 0.305 + (y - sy) * 0.05, off = row % 2 ? 0.09 : 0;
        for (let x = -hw + 0.3 + off; x < hw - 0.28; x += 0.18) pbox(x - 0.01, x + 0.01, y - 0.01, y + 0.01, z - 0.004, z + 0.006, '#1a0c0a', 1, null, LEATHER);
      }
      for (const s of [-1, 1]) for (let row = 0; row < 2; row++) for (let zi = 0; zi < 3; zi++) {
        const x = s * (hw - 0.225), y = sy + 0.14 + row * 0.1, z = -hd + 0.38 + zi * 0.17 + (row % 2) * 0.085;
        pbox(x - 0.004, x + 0.004, y - 0.01, y + 0.01, z - 0.01, z + 0.01, '#1a0c0a', 1, null, LEATHER);
      }
      return true;
    }
    case 'wingback': {
      // A WING CHAIR: turned legs, a deep seat with its cushion, a high back, wings each side of the head and
      // arms rolled over, all in velvet with a line of brass nails down each arm's front
      const fab = { t: 'roomWeave', c: VELVETS[dress] || VELVETS.emerald };
      for (const [x, z] of [[-hw + 0.08, hd - 0.08], [hw - 0.08, hd - 0.08], [-hw + 0.08, -hd + 0.08], [hw - 0.08, -hd + 0.08]]) lat(x, z, [[0, 0], [0.018, 0], [0.024, 0.05], [0.02, 0.1], [0.03, 0.16], [0.03, 0.18], [0, 0.18]], DARKWOOD, 1, 10, SATIN);
      R(...alongX(), -hw + 0.03, hw - 0.03, -hd + 0.04, hd - 0.03, 0.17, 0.38, 0.03, fab, 0.9, CLOTH);
      R(...alongX(0.12, 0.38), -hw + 0.11, hw - 0.11, -hd + 0.02, -hd + 0.18, 0.36, h, 0.06, fab, 1, CLOTH);
      for (const s of [-1, 1]) {
        const x0 = s < 0 ? -hw + 0.01 : hw - 0.12, x1 = s < 0 ? -hw + 0.12 : hw - 0.01;
        // the wing: thin, standing proud of the arm, swept forward from the back and rounded over at the top
        const wx0 = s < 0 ? -hw - 0.01 : hw - 0.06, wx1 = s < 0 ? -hw + 0.06 : hw + 0.01;
        R(...alongZ(), -hd + 0.02, -hd + 0.3, wx0, wx1, 0.6, h - 0.04, 0.03, fab, 0.95, CLOTH);
        R(...alongZ(), -hd + 0.28, -hd + 0.5, wx0, wx1, 0.6, h - 0.2, 0.03, fab, 0.95, CLOTH);
        R(...alongZ(), -hd + 0.48, -hd + 0.6, wx0, wx1, 0.6, h - 0.38, 0.03, fab, 0.95, CLOTH);
        R(...alongZ(), -hd + 0.04, hd - 0.02, x0, x1, 0.17, 0.6, 0.035, fab, 0.93, CLOTH);
        R(...alongZ(), -hd + 0.3, hd + 0.02, s < 0 ? -hw : hw - 0.14, s < 0 ? -hw + 0.14 : hw, 0.54, 0.67, 0.06, fab, 1.0, CLOTH);
        const ax = s * (hw - 0.07);
        for (let y = 0.22; y < 0.5; y += 0.05) pbox(ax - 0.005, ax + 0.005, y, y + 0.01, hd - 0.02, hd - 0.012, BRASS, 1.02, null, METAL);
      }
      R(...alongX(), -hw + 0.13, hw - 0.13, -hd + 0.17, hd + 0.01, 0.37, 0.47, 0.045, fab, 1.05, CLOTH);
      return true;
    }
    case 'cocktail': {
      // A LOW TABLE: a marble top on a walnut apron, turned legs in brass toe caps, a shelf under it with the
      // day's paper, and on top an ashtray, a book or two and a dish
      for (const [x, z] of [[-hw + 0.07, -hd + 0.07], [hw - 0.07, -hd + 0.07], [-hw + 0.07, hd - 0.07], [hw - 0.07, hd - 0.07]]) {
        lat(x, z, [[0, 0], [0.022, 0], [0.022, 0.04], [0, 0.04]], BRASS, 1.08, 10, METAL);
        lat(x, z, [[0.018, 0.04], [0.026, 0.2], [0.03, h - 0.12], [0.034, h - 0.1], [0, h - 0.1]], '#5a3a26', 1, 10, SATIN);
      }
      pbox(-hw + 0.04, hw - 0.04, h - 0.11, h - 0.035, -hd + 0.04, hd - 0.04, '#5a3a26', 1, WALNUT, SATIN);
      pbox(-hw - 0.01, hw + 0.01, h - 0.043, h - 0.035, -hd - 0.01, hd + 0.01, BRASS, 1.06, null, METAL);
      pbox(-hw, hw, h - 0.035, h, -hd, hd, '#ffffff', 1.04, MARBLE, GLOSS);
      pbox(-hw + 0.08, hw - 0.08, 0.12, 0.14, -hd + 0.08, hd - 0.08, '#5a3a26', 1, WALNUT, SATIN);
      pbox(-0.25, 0.12, 0.14, 0.16, -0.12, 0.14, '#e8e0cc', 0.98, null, MATTE);
      lat(hw * 0.45, 0.02, [[0, h], [0.07, h], [0.075, h + 0.02], [0.06, h + 0.024], [0.055, h + 0.008], [0, h + 0.008]], '#c8d8e0', 1.1, 16, GLOSS);
      pbox(-hw * 0.55 - 0.11, -hw * 0.55 + 0.11, h, h + 0.03, -0.08, 0.07, '#2a3a4a', 1, null, SATIN);
      pbox(-hw * 0.55 - 0.09, -hw * 0.55 + 0.1, h + 0.03, h + 0.055, -0.07, 0.06, '#6a2420', 1, null, SATIN);
      lat(0.02, -0.12, [[0, h], [0.05, h], [0.09, h + 0.035], [0.085, h + 0.04], [0.045, h + 0.008], [0, h + 0.008]], BRASS, 1.08, 18, METAL);
      return true;
    }
    case 'trolley': {
      // A LUGGAGE CART: a carpeted deck on four casters, a brass hoop at each end, a hanging rail between them and
      // a rail down each side; on it two suitcases, a hatbox, and a garment bag on the rail
      const tube = (a, b, rr = 0.013) => rod(K, a, b, rr, BRASS, 1.1, METAL, 8);
      for (const [x, z] of [[-hw + 0.08, -hd + 0.08], [hw - 0.08, -hd + 0.08], [-hw + 0.08, hd - 0.08], [hw - 0.08, hd - 0.08]]) {
        K.ball(...P(x, 0, z).slice(0, 2), 0.05, 0.05, '#1a1816', 1, 10, SATIN);
        pbox(x - 0.03, x + 0.03, 0.07, 0.12, z - 0.012, z + 0.012, BRASS, 1.04, null, METAL);
      }
      pbox(-hw, hw, 0.12, 0.17, -hd, hd, '#7a1e22', 1, { t: 'roomWool', c: '#7a1e22' }, CLOTH);
      for (const s of [-1, 1]) { tube(P(-hw, 0.18, s * hd), P(hw, 0.18, s * hd), 0.011); tube(P(s * hw, 0.18, -hd), P(s * hw, 0.18, hd), 0.011); }
      const top = h - 0.04, arc = 0.36;
      for (const s of [-1, 1]) {
        const x = s * (hw - 0.02), pts = [];
        for (let i = 0; i <= 10; i++) { const a = Math.PI - i / 10 * Math.PI; pts.push(P(x, top - arc + Math.sin(a) * arc, Math.cos(a) * (hd - 0.02))); }
        tube(P(x, 0.17, -hd + 0.02), pts[0]); tube(P(x, 0.17, hd - 0.02), pts[10]);
        path(K, pts, 0.013, BRASS, 1.1, METAL, 8);
        K.ball(...P(x, 0, 0).slice(0, 2), top + 0.03, 0.025, BRASS, 1.12, 10, METAL);
      }
      tube(P(-hw + 0.02, top, 0), P(hw - 0.02, top, 0), 0.015);
      for (const s of [-1, 1]) tube(P(-hw + 0.02, 0.75, s * (hd - 0.02)), P(hw - 0.02, 0.75, s * (hd - 0.02)), 0.011);
      // the cases: tan leather with straps and brass corners, a blue one on it
      const cs = (x0, x1, y0, y1, z0, z1, hex) => {
        pbox(x0, x1, y0, y1, z0, z1, hex, 1, null, LEATHER);
        for (const xs of [x0 + (x1 - x0) * 0.25, x0 + (x1 - x0) * 0.75]) pbox(xs - 0.02, xs + 0.02, y0 - 0.002, y1 + 0.003, z0 - 0.003, z1 + 0.003, '#2a1a10', 1, null, LEATHER);
        for (const xc of [x0, x1 - 0.035]) for (const yc of [y0, y1 - 0.035]) pbox(xc - 0.002, xc + 0.037, yc - 0.002, yc + 0.037, z1, z1 + 0.004, BRASS, 1.1, null, METAL);
      };
      cs(-hw + 0.06, 0.18, 0.17, 0.4, -hd + 0.06, hd - 0.12, '#7a4a24');
      cs(-hw + 0.12, 0.08, 0.4, 0.56, -hd + 0.1, hd - 0.18, '#2a3a52');
      const [hu, hv] = P(0.38, 0, 0.02);
      K.lathe(hu, hv, [[0, 0.17], [0.16, 0.17], [0.16, 0.39], [0, 0.39]], '#d8c8a8', 1, 20, CLOTH);
      K.lathe(hu, hv, [[0.162, 0.33], [0.162, 0.36]], '#7a1e22', 1, 20, CLOTH);
      K.lathe(hu, hv, [[0.165, 0.38], [0.165, 0.41], [0, 0.41]], '#d8c8a8', 1.05, 20, CLOTH);
      rod(K, P(-0.05, top, 0), P(-0.05, top - 0.07, 0), 0.004, '#3a3a3a', 1, METAL, 4);
      R(...alongX(), -0.2, 0.1, -0.05, 0.05, top - 0.92, top - 0.07, 0.03, '#26262c', 1, CLOTH);
      return true;
    }
    default: return false;
  }
}
