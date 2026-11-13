// GLASS 2 · AN OLD BAR, DRESSED. What a bar with some years on it is fitted and dressed with, past the plain bar
// and back bar gl/room-fittings.js draws: a panelled front under a padded rail with a brass foot rail and the
// spittoons below it, a tap tower and the clutter of a working top, a back bar of arched mirror bays, columns
// and lit shelves of bottles with a till and a wireless on its counter, a run of velvet stools, a jukebox; a
// card table's rail set with drinks and a cigar; and on the room itself neon in tubes, card-room and schoolhouse
// pendants, ceiling fans, a hang of old photographs, a trophy, a chalkboard, a dartboard, a payphone, a coat
// stand and the peanut shells on the floor. Pure: batches, no GL.
//
// ⚠ IT'S ALL DATA. A piece asks for this with `flags.look.dress: 'saloon'` (the bar, the back bar, a card table)
// or by its form ('stools', 'jukebox'); a room by the keys in `flags.room.decor` listed over drawSaloonDecor.
// Nothing here knows which bar it is, so another game's dive gets the same kit with no edit here.
//
// Forms are drawn in their piece's own frame (room-kit.js `frame`): x across it, y up, z out of its front.
// Seen from in front, +x runs to the left. Everything stays inside p.w × p.d × p.h, which is what the walker
// collides with.

import { MAT } from './ballpark-mesh.js';
import { LEGEND_STROKES, legend, legendWidth } from '../../../../shared/legend-font.js';
import { glassLathe, liquidLathe } from './lab-mesh.js';
import { stoolsAlong } from '../../../../shared/room-layout.js';

const { GLOSS, METAL, SATIN, CLOTH, MATTE, LEATHER } = MAT;
// the codes gl/room.js reads for a light's own face (room-mesh.js has them): a glow, and a lamp's lit shade
const GLOW = 40, LAMP = 42;
const BRASS = '#c9a24a', BRASS_DK = '#7a5a2a', OXBLOOD = '#5a161a', VELVET = '#6e1c28', CREAM = '#efe6d2', IVORY = '#e8dcc0';
const MAHOG = '#4e2416', MAHOG_DK = '#2c120a';
const WOOD = { t: 'roomOak', c: '#5a2a18' }, WOOD_DK = { t: 'roomOak', c: '#3a1810' };
const TAU = Math.PI * 2;

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const num = (x, d, lo = -Infinity, hi = Infinity) => (Number.isFinite(Number(x)) ? Math.max(lo, Math.min(hi, Number(x))) : d);
const hex6 = (s, d) => (/^#[0-9a-f]{6}$/i.test(s || '') ? s : d);

// ── the small helpers, on a piece's frame ─────────────────────────────────────────────────────────────
// A rod between two room points ([u, v, y]), as room-mesh.js rodOf draws one.
function rodK(K, a, b, r, hex, k = 1, surf = METAL, n = 6) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(...d) || 1, t = d.map((x) => x / l);
  const up = Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const cx = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
  let s = cx(t, up); const sl = Math.hypot(...s); s = s.map((x) => x / sl);
  const w = cx(t, s), col = K.C(hex, k);
  for (let i = 0; i < n; i++) {
    const a0 = i / n * TAU, a1 = (i + 1) / n * TAU, am = (a0 + a1) / 2;
    const o = (ang) => s.map((x, j) => (x * Math.cos(ang) + w[j] * Math.sin(ang)) * r);
    const o0 = o(a0), o1 = o(a1), nm = s.map((x, j) => x * Math.cos(am) + w[j] * Math.sin(am));
    K.quad(K.solid, [[a[0] + o0[0], a[1] + o0[1], a[2] + o0[2]], [a[0] + o1[0], a[1] + o1[1], a[2] + o1[2]], [b[0] + o1[0], b[1] + o1[1], b[2] + o1[2]], [b[0] + o0[0], b[1] + o0[1], b[2] + o0[2]]],
      K.nrmOf(nm[0], nm[2], nm[1]), col, surf, null, k >= 1.25);
  }
}
// What drawPiece hands a fitting (gl/room-fittings.js `c`), made from a kit and a frame: for the forms drawn from
// gl/room-decor.js, which get only those.
export function saloonCtx(K, F, p, seed = 7) {
  return {
    K, F, p, r: rng(p.seed || seed),
    lat: (x, z, prof, mat, k = 1, n = 14, surf = SATIN) => { const [u, v] = F.P(x, 0, z); K.lathe(u, v, prof, mat, k, n, surf); },
    rod: (a, b, r, hex, k = 1, surf = METAL, n = 6) => rodK(K, a, b, r, hex, k, surf, n),
    R: (...a) => K.rounded(...a),
  };
}
const ball = (c, x, y, z, r, hex, k = 1, n = 10, surf = GLOSS) => { const [u, v, yy] = c.F.P(x, y, z); c.K.ball(u, v, yy, r, hex, k, n, surf); };
// A ring or a sector of one facing along the frame's z at depth z: (x, y) its middle, radii r0 to r1, a0 to a1.
function ringZ(c, x, y, z, r0, r1, a0, a1, hex, k = 1, surf = MATTE, segs = 12) {
  const { K, F } = c, col = K.C(hex, k), n = F.N(0, 0, 1);
  for (let i = 0; i < segs; i++) {
    const b0 = a0 + (a1 - a0) * i / segs, b1 = a0 + (a1 - a0) * (i + 1) / segs, at = (r, a) => F.P(x + Math.cos(a) * r, y + Math.sin(a) * r, z);
    K.quad(K.solid, [at(r0, b0), at(r0, b1), at(r1, b1), at(r1, b0)], n, col, surf, null, k >= 1.25);
  }
}
// Lettering on the frame's front face at depth z, centred at x (as seen from in front) and y, h tall.
function lettering(c, text, x, y, z, h, hex, emis = 0, surf = METAL) {
  const { K, F } = c, n = F.N(0, 0, 1);
  legend({ plate: (ps, col, e) => K.quad(K.solid, ps.map(([a, b]) => F.P(x - a, b, z)), n, col, e > 0.5 ? GLOW : surf, null, true) }, String(text).toUpperCase(), 0, y, h, K.C(hex, emis ? 2 : 1), emis);
}

// ── glasses and the things on a bar top ─────────────────────────────────────────────────────────────────
// A drink stood at (x, z) on a top at y: a pint with its head, a short over ice, a martini with its olive, a coupe.
function drink(c, kind, x, z, y) {
  if (kind === 'pint') {
    liquidLathe(c, x, z, [[0, y + 0.006], [0.028, y + 0.006], [0.034, y + 0.122], [0, y + 0.122]], '#c8801a', 1.15, 12);
    c.lat(x, z, [[0, y + 0.122], [0.0345, y + 0.122], [0.036, y + 0.142], [0.02, y + 0.148], [0, y + 0.149]], '#f2ead6', 1, 12, SATIN);
    glassLathe(c, x, z, [[0.029, y], [0.037, y + 0.15]], 12);
  } else if (kind === 'rocks') {
    c.lat(x, z, [[0, y], [0.036, y], [0.036, y + 0.012], [0, y + 0.012]], '#dfe8ea', 1.1, 12, GLOSS);
    liquidLathe(c, x, z, [[0, y + 0.012], [0.034, y + 0.012], [0.035, y + 0.048], [0, y + 0.048]], '#b0601a', 1.15, 12);
    c.F.pbox(x - 0.014, x + 0.012, y + 0.03, y + 0.058, z - 0.012, z + 0.013, '#e8f4f8', 1.15, null, GLOSS);
    glassLathe(c, x, z, [[0.037, y], [0.039, y + 0.085]], 12);
  } else if (kind === 'martini') {
    c.lat(x, z, [[0.032, y], [0.032, y + 0.004], [0.004, y + 0.012], [0.004, y + 0.1], [0, y + 0.1]], '#dfe8ea', 1.1, 10, GLOSS);
    liquidLathe(c, x, z, [[0, y + 0.102], [0.044, y + 0.148], [0, y + 0.148]], '#e6e2c2', 1.1, 12);
    glassLathe(c, x, z, [[0.002, y + 0.1], [0.056, y + 0.162]], 12);
    ball(c, x + 0.012, y + 0.128, z, 0.009, '#6a7a2a', 1, 8, SATIN);
    c.rod(c.F.P(x + 0.004, y + 0.11, z), c.F.P(x + 0.03, y + 0.18, z), 0.0016, '#e8c84a', 1.05, SATIN, 4);
  } else if (kind === 'coupe') {
    c.lat(x, z, [[0.03, y], [0.03, y + 0.004], [0.004, y + 0.012], [0.004, y + 0.085], [0, y + 0.085]], '#dfe8ea', 1.1, 10, GLOSS);
    liquidLathe(c, x, z, [[0, y + 0.086], [0.036, y + 0.098], [0.046, y + 0.112], [0, y + 0.112]], '#d84a4a', 1.15, 12);
    glassLathe(c, x, z, [[0.004, y + 0.085], [0.04, y + 0.096], [0.05, y + 0.12]], 12);
  } else if (kind === 'shot') {
    liquidLathe(c, x, z, [[0, y + 0.008], [0.019, y + 0.008], [0.021, y + 0.04], [0, y + 0.04]], '#a85a14', 1.1, 10);
    glassLathe(c, x, z, [[0.02, y], [0.023, y + 0.055]], 10);
  }
}
// A beer mat under a glass: a printed card, cream with a red ring, or blue.
function mat(c, x, z, y, seed) {
  const { pbox } = c.F, s = 0.052, blue = seed % 3 === 0;
  pbox(x - s, x + s, y, y + 0.003, z - s, z + s, blue ? '#2a4a8a' : CREAM, 1, null, MATTE);
  pbox(x - s * 0.7, x + s * 0.7, y + 0.003, y + 0.0036, z - s * 0.7, z + s * 0.7, blue ? '#e8e0c8' : '#9a1c22', 0.95, null, MATTE);
  pbox(x - s * 0.55, x + s * 0.55, y + 0.0036, y + 0.0042, z - s * 0.55, z + s * 0.55, blue ? '#2a4a8a' : CREAM, 1, null, MATTE);
}
// A heavy glass ashtray with a couple of butts in it, and a cigarette across one rest, still going.
function ashtray(c, x, z, y, lit = true) {
  c.lat(x, z, [[0, y], [0.058, y], [0.064, y + 0.026], [0.048, y + 0.026], [0.044, y + 0.009], [0, y + 0.009]], '#bcd2da', 1.2, 16, GLOSS);
  for (const [dx, dz, a] of [[-0.016, 0.01, 0.6], [0.012, -0.018, 2.4]]) c.rod(c.F.P(x + dx, y + 0.012, z + dz), c.F.P(x + dx + Math.cos(a) * 0.026, y + 0.013, z + dz + Math.sin(a) * 0.026), 0.0045, '#d9a86a', 1, MATTE, 5);
  if (!lit) return;
  const a = c.F.P(x + 0.06, y + 0.027, z + 0.004), b = c.F.P(x - 0.02, y + 0.03, z + 0.01);
  c.rod(a, c.F.P(x + 0.042, y + 0.0275, z + 0.005), 0.0045, '#c8884a', 1, MATTE, 5);
  c.rod(c.F.P(x + 0.042, y + 0.0275, z + 0.005), b, 0.0045, '#efe8dc', 1, MATTE, 5);
  c.K.ball(b[0], b[1], b[2], 0.005, '#ff6a2a', 1.8, 6, GLOW);
}
// A candle in a red glass on the bar, as an old place keeps one every few stools.
function candle(c, x, z, y) {
  c.lat(x, z, [[0, y], [0.034, y], [0.04, y + 0.05], [0.036, y + 0.085], [0.03, y + 0.09], [0, y + 0.09]], '#b0141e', 1.55, 14, GLOW);
  ball(c, x, y + 0.1, z, 0.008, '#ffd27a', 2.2, 6, GLOW);
}
// A turned wooden bowl heaped with peanuts in the shell.
function peanuts(c, x, z, y) {
  c.lat(x, z, [[0, y], [0.05, y], [0.08, y + 0.03], [0.085, y + 0.05], [0.075, y + 0.05], [0.07, y + 0.035], [0, y + 0.012]], '#6a3a1e', 1, 18, SATIN);
  const r = rng(77);
  for (let i = 0; i < 26; i++) {
    const a = r() * TAU, d = Math.sqrt(r()) * 0.065, hy = y + 0.035 + (0.065 - d) * 0.5 + r() * 0.01;
    const u = x + Math.cos(a) * d, w = z + Math.sin(a) * d, b = a + r();
    c.rod(c.F.P(u - Math.cos(b) * 0.011, hy, w - Math.sin(b) * 0.011), c.F.P(u + Math.cos(b) * 0.011, hy + 0.003, w + Math.sin(b) * 0.011), 0.0075, i % 4 ? '#c89a5e' : '#b0844a', 1, MATTE, 5);
  }
}
// A tip jar: a big jar with the notes and a few coins in it.
function tipJar(c, x, z, y) {
  const { pbox } = c.F, r = rng(31);
  for (let i = 0; i < 6; i++) { const a = r() * TAU; pbox(x - 0.03 + r() * 0.02, x + 0.01 + r() * 0.02, y + 0.004 + i * 0.012, y + 0.04 + i * 0.012, z - 0.025 + Math.cos(a) * 0.01, z - 0.02 + Math.cos(a) * 0.01, i % 3 ? '#6a8a5a' : '#8aa070', 1, null, MATTE); }
  for (let i = 0; i < 5; i++) ball(c, x - 0.02 + r() * 0.04, y + 0.006, z - 0.02 + r() * 0.04, 0.009, i % 2 ? '#c8a050' : '#c0c4c8', 1.1, 8, METAL);
  c.lat(x, z, [[0, y], [0.05, y], [0.05, y + 0.006], [0, y + 0.006]], '#dfe8ea', 1.1, 14, GLOSS);
  glassLathe(c, x, z, [[0.05, y], [0.052, y + 0.14], [0.042, y + 0.15], [0.042, y + 0.16]], 14);
}
// The beer: a brass T on a column, a faucet and a handle for each tap toward whoever pulls it (-z), a drip tray.
function tapTower(c, x, z, y, n = 3) {
  const { pbox, P } = c.F, handles = [['#16141a', BRASS], [IVORY, '#9a1c22'], [OXBLOOD, BRASS], ['#1d4a2a', IVORY]];
  pbox(x - 0.24, x + 0.24, y, y + 0.016, z - 0.17, z - 0.03, '#b8bcc0', 1.05, null, METAL);
  for (let i = 0; i < 12; i++) { const gx = x - 0.21 + i * 0.038; pbox(gx - 0.008, gx + 0.008, y + 0.016, y + 0.018, z - 0.155, z - 0.045, '#3a3c40', 1, null, METAL); }
  c.lat(x, z, [[0.055, y], [0.055, y + 0.02], [0.034, y + 0.045], [0.032, y + 0.31], [0.046, y + 0.33], [0, y + 0.34]], BRASS, 1.1, 18, METAL);
  c.rod(P(x - 0.25, y + 0.33, z), P(x + 0.25, y + 0.33, z), 0.026, BRASS, 1.1, METAL, 12);
  for (const s of [-1, 1]) ball(c, x + s * 0.255, y + 0.33, z, 0.032, BRASS, 1.12, 12, METAL);
  for (let i = 0; i < n; i++) {
    const tx = x + (i - (n - 1) / 2) * 0.15, [hc, cap] = handles[i % handles.length];
    c.rod(P(tx, y + 0.33, z - 0.01), P(tx, y + 0.33, z - 0.085), 0.013, BRASS, 1.12, METAL, 8);
    c.rod(P(tx, y + 0.33, z - 0.085), P(tx, y + 0.27, z - 0.095), 0.009, BRASS, 1.12, METAL, 8);
    // the handle stands up off the faucet, a tall turned piece with a cap, leant a little back toward the pourer
    const h0 = P(tx, y + 0.345, z - 0.08), h1 = P(tx, y + 0.56, z - 0.1), h2 = P(tx, y + 0.6, z - 0.104);
    c.rod(h0, h1, 0.016, hc, 1.05, GLOSS, 8);
    c.rod(h1, h2, 0.021, hc, 1.05, GLOSS, 8);
    c.K.ball(h2[0], h2[1], h2[2], 0.022, cap, 1.1, 10, METAL);
    c.rod(P(tx, y + 0.44, z - 0.11), P(tx, y + 0.5, z - 0.112), 0.019, cap, 1.05, SATIN, 8);
  }
}

// ── THE BAR ─────────────────────────────────────────────────────────────────────────────────────────────
// A saloon bar: a mahogany front in raised panels between carved pilasters on a dark plinth, a thick top under a
// padded oxblood rail along the drinkers' edge, a brass foot rail on brackets, a spittoon at each end. The
// bartender's side has its well: a steel work shelf, an ice bin, a speed rail of bottles and a rubber mat. On top,
// the tap tower and what a night leaves out: drinks on mats, an ashtray, the peanuts, candles, the tip jar, a menu.
// Its front (+z) faces whoever's drinking.
export function saloonBar(c) {
  const { F, p } = c, { pbox, P } = F, hw = p.w / 2, hd = p.d / 2, h = p.h, wear = Math.max(0, Math.min(1, c.wear || 0));
  const zf = hd - 0.16, zb = -hd + 0.34, top = h - 0.055;
  // the plinth, set back, and the carcass
  pbox(-hw + 0.06, hw - 0.06, 0, 0.1, zb, zf - 0.04, '#0e0a08', 0.9, null, SATIN);
  pbox(-hw + 0.04, hw - 0.04, 0.1, top, zb, zf - 0.03, MAHOG_DK, 1, WOOD_DK, SATIN);
  // the front: bays of raised panels between pilasters, a base moulding and a frieze
  const n = Math.max(3, Math.round(p.w / 0.72)), bw = (p.w - 0.08) / n;
  pbox(-hw + 0.03, hw - 0.03, 0.1, 0.2, zf - 0.03, zf + 0.012, MAHOG, 1, WOOD, SATIN);
  pbox(-hw + 0.03, hw - 0.03, 0.2, 0.215, zf - 0.03, zf + 0.02, BRASS, 1.05, null, METAL);
  pbox(-hw + 0.03, hw - 0.03, top - 0.16, top - 0.02, zf - 0.03, zf + 0.012, MAHOG, 1, WOOD, SATIN);
  for (let i = 0; i < n; i++) {
    const x0 = -hw + 0.04 + i * bw, x1 = x0 + bw, m = 0.09;
    // the field: a sunk panel, a bevel round it and the raised middle, darker where hands and knees have been
    pbox(x0 + m, x1 - m, 0.27, top - 0.22, zf - 0.03, zf - 0.012, MAHOG_DK, 1, WOOD_DK, SATIN);
    pbox(x0 + m + 0.03, x1 - m - 0.03, 0.3, top - 0.25, zf - 0.012, zf + 0.004, MAHOG, 1.02, WOOD, SATIN);
    pbox(x0 + m + 0.07, x1 - m - 0.07, 0.34, top - 0.29, zf + 0.004, zf + 0.012, '#5e2c1a', 1.05, WOOD, GLOSS);
    // a brass rosette in the frieze over each bay
    ball(c, (x0 + x1) / 2, top - 0.09, zf + 0.012, 0.022, BRASS, 1.1, 10, METAL);
  }
  // the pilasters: a fluted shaft on a block, a capital, and a carved corbel under the top
  for (let i = 0; i <= n; i++) {
    const x = -hw + 0.04 + i * bw;
    pbox(x - 0.05, x + 0.05, 0.1, 0.28, zf - 0.03, zf + 0.03, MAHOG, 1, WOOD, SATIN);
    for (const fx of [-0.026, 0, 0.026]) pbox(x + fx - 0.008, x + fx + 0.008, 0.28, top - 0.18, zf - 0.03, zf + 0.022, '#5a2a18', 1, WOOD, SATIN);
    pbox(x - 0.04, x + 0.04, 0.28, top - 0.18, zf - 0.03, zf + 0.014, MAHOG_DK, 1, WOOD_DK, SATIN);
    pbox(x - 0.055, x + 0.055, top - 0.18, top - 0.15, zf - 0.03, zf + 0.035, MAHOG, 1.04, WOOD, SATIN);
    pbox(x - 0.035, x + 0.035, top - 0.15, top - 0.03, zf, zf + 0.09, MAHOG, 1, WOOD, SATIN);
    pbox(x - 0.03, x + 0.03, top - 0.13, top - 0.11, zf + 0.04, zf + 0.092, BRASS, 1.05, null, METAL);
  }
  // the top, thick, overhanging the front, its edge rounded; the padded rail along the drinkers' edge, buttoned
  pbox(-hw, hw, top, h - 0.01, -hd, hd, '#3a1a10', 1.05, WOOD_DK, GLOSS);
  c.R(...F.alongX(), -hw, hw, hd - 0.12, hd, h - 0.035, h + 0.02, 0.04, OXBLOOD, 1, LEATHER);
  for (let x = -hw + 0.12; x < hw - 0.08; x += 0.24) ball(c, x, h + 0.016, hd - 0.06, 0.008, '#2a0a0c', 1, 6, LEATHER);
  // worn pale at the elbows, ring marks on the wood
  if (wear > 0.2) for (let i = 0; i < 7; i++) { const x = -hw + 0.4 + i * (p.w - 0.8) / 6; c.lat(x, hd - 0.2, [[0.034, h - 0.0094], [0.04, h - 0.0094]], '#6a4a30', 0.8, 14, MATTE); }
  // the drinkers' foot rail on its brackets, and the spittoons
  c.rod(P(-hw + 0.08, 0.2, hd - 0.05), P(hw - 0.08, 0.2, hd - 0.05), 0.024, BRASS, 1.12, METAL, 10);
  for (const s of [-1, 1]) ball(c, s * (hw - 0.08), 0.2, hd - 0.05, 0.03, BRASS, 1.12, 10, METAL);
  for (let x = -hw + 0.4; x <= hw - 0.3; x += 1.1) {
    c.rod(P(x, 0.2, hd - 0.05), P(x, 0.2, zf), 0.012, BRASS, 1.1, METAL, 6);
    c.rod(P(x, 0.2, zf + 0.02), P(x, 0.12, zf + 0.002), 0.01, BRASS, 1.1, METAL, 6);
    c.lat(x, zf + 0.005, [[0.04, 0.17], [0.04, 0.23], [0, 0.23]], BRASS_DK, 1.05, 12, METAL);
  }
  for (const s of [-1, 1]) {
    const x = s * (hw - 0.45), z = hd - 0.06;
    c.lat(x, z, [[0, 0], [0.09, 0], [0.11, 0.05], [0.1, 0.12], [0.06, 0.15], [0.07, 0.17], [0.09, 0.18], [0.05, 0.18], [0.045, 0.16], [0, 0.155]], '#b8923e', 1.1, 18, METAL);
  }
  // the bartender's side: a steel work shelf under the top, an ice bin in it, a speed rail of bottles and a mat
  pbox(-hw + 0.05, hw - 0.05, 0.78, 0.82, -hd + 0.1, zb, '#a8acb0', 1, null, METAL);
  pbox(-hw + 0.05, hw - 0.05, 0.1, 0.78, zb - 0.01, zb, '#8a8e92', 0.95, null, METAL);
  const ib = [-0.55, 0.15];
  pbox(ib[0], ib[1], 0.6, 0.82, -hd + 0.11, zb - 0.02, '#c8ccd0', 1.05, null, METAL);
  pbox(ib[0] + 0.02, ib[1] - 0.02, 0.8, 0.821, -hd + 0.13, zb - 0.04, '#1a1c1e', 1, null, METAL);
  const r = rng(13);
  for (let i = 0; i < 40; i++) { const x = ib[0] + 0.05 + r() * (ib[1] - ib[0] - 0.1), z = -hd + 0.16 + r() * (zb + hd - 0.2); pbox(x - 0.014, x + 0.014, 0.8, 0.825 + r() * 0.012, z - 0.014, z + 0.014, '#eaf6fa', 1.2, null, GLOSS); }
  c.rod(P(-hw + 0.08, 0.52, -hd + 0.015), P(hw - 0.08, 0.52, -hd + 0.015), 0.01, '#c8ccd0', 1.05, METAL, 6);
  const liq = ['#6a2a12', '#d8d0b0', '#3a5a2a', '#a8641a', '#e8e2d0', '#5a1a2a', '#2a3a5a'];
  for (let x = -hw + 0.25; x < hw - 0.2; x += 0.11) {
    if (x > ib[0] - 0.08 && x < ib[1] + 0.08) continue;
    const col = liq[Math.floor(r() * liq.length)];
    c.lat(x, -hd + 0.05, [[0, 0.44], [0.034, 0.44], [0.034, 0.66], [0.014, 0.7], [0.012, 0.74], [0, 0.74]], col, 0.95, 10, GLOSS);
    c.rod(P(x, 0.74, -hd + 0.05), P(x, 0.775, -hd + 0.035), 0.004, '#c8ccd0', 1.1, METAL, 4);
  }
  // on top, from the bartender's end: the garnish tray and bitters, the tap tower, the drinks and the clutter
  const T = h + 0.004, zt = 0.02;
  pbox(-hw + 0.15, -hw + 0.55, h - 0.01, T + 0.004, -hd + 0.06, -hd + 0.2, '#16161a', 1, null, MATTE);
  for (let i = 0; i < 6; i++) pbox(-hw + 0.17 + i * 0.062, -hw + 0.22 + i * 0.062, T + 0.004, T + 0.03, -hd + 0.08, -hd + 0.18, '#d8dcd8', 1.05, null, METAL);
  for (let i = 0; i < 6; i++) { const gx = -hw + 0.195 + i * 0.062, fruit = ['#8ac03a', '#e8d03a', '#c81a2a', '#8ac03a', '#e8d03a', '#e88a2a'][i]; for (let j = 0; j < 3; j++) ball(c, gx - 0.012 + (j % 2) * 0.02, T + 0.032, -hd + 0.1 + j * 0.03, 0.013, fruit, 1.05, 6, SATIN); }
  for (let i = 0; i < 3; i++) {
    const x = -hw + 0.68 + i * 0.07;
    c.lat(x, -hd + 0.12, [[0, T], [0.024, T], [0.024, T + 0.09], [0.008, T + 0.11], [0.006, T + 0.13], [0, T + 0.13]], ['#5a1a10', '#2a1a0a', '#7a3a10'][i], 1, 10, GLOSS);
    c.lat(x, -hd + 0.12, [[0, T + 0.04], [0.0245, T + 0.04], [0.0245, T + 0.085], [0, T + 0.085]], ['#e8dcb8', '#d8c890', '#f0e8d0'][i], 1, 10, MATTE);
  }
  // the taps in the middle, where whoever's on the bar stands (plugins/roomstage deskPostOf)
  tapTower(c, 0, zt - 0.02, h - 0.006, Math.min(4, Math.max(2, Math.round(p.w / 1.6))));
  const items = [
    [-hw * 0.62, 'candle'], [-hw * 0.44, 'pint', 0], [-hw * 0.27, 'peanuts'], [-0.36, 'ashtray'],
    [hw * 0.46, 'rocks', 1], [hw * 0.6, 'candle'], [hw * 0.72, 'martini', 2], [hw * 0.86, 'tip'],
  ];
  for (const [x, kind, s] of items) {
    const z = 0.08;
    if (kind === 'candle') candle(c, x, z, T);
    else if (kind === 'peanuts') peanuts(c, x, z - 0.02, T);
    else if (kind === 'ashtray') ashtray(c, x, z, T);
    else if (kind === 'tip') tipJar(c, x, -0.06, T);
    else { mat(c, x, z + 0.04, T, s); drink(c, kind, x, z + 0.04, T + 0.004); }
  }
  // a menu folded into a tent, and a stack of napkins with a cup of straws by the taps
  const mx = hw * 0.3;
  for (const s of [-1, 1]) c.K.quad(c.K.solid, [P(mx - 0.07, T, 0.15 + s * 0.04), P(mx + 0.07, T, 0.15 + s * 0.04), P(mx + 0.07, T + 0.13, 0.15), P(mx - 0.07, T + 0.13, 0.15)], F.N(0, 0.3, s), c.K.C(s > 0 ? '#1a2a1e' : '#2a1a14', 1), MATTE);
  lettering(c, 'MENU', -mx, T + 0.07, 0.15 + 0.022, 0.03, '#d8b45a', 0, MATTE);
  pbox(hw * 0.2 - 0.06, hw * 0.2 + 0.06, T, T + 0.04, -0.2, -0.08, '#f4f0e6', 1, null, CLOTH);
  c.lat(hw * 0.2 + 0.12, -0.12, [[0, T], [0.03, T], [0.03, T + 0.09], [0, T + 0.09]], '#1a1a1c', 1, 10, GLOSS);
  for (let i = 0; i < 9; i++) { const a = i / 9 * TAU; c.rod(P(hw * 0.2 + 0.12 + Math.cos(a) * 0.016, T + 0.05, -0.12 + Math.sin(a) * 0.016), P(hw * 0.2 + 0.12 + Math.cos(a) * 0.03, T + 0.19, -0.12 + Math.sin(a) * 0.03), 0.003, i % 2 ? '#d82a2a' : '#1a1a1a', 1, MATTE, 4); }
}

// ── THE BACK BAR ────────────────────────────────────────────────────────────────────────────────────────
// Against the wall behind the bartender: a cabinet of doors under a marble counter, then arched mirror bays
// between turned columns, each bay with two lit glass shelves of bottles, under a dentilled cornice with the
// trade in brass letters on its frieze (`look.trade`; a building's name is on its front, not here) and a clock
// in a broken pediment over the middle. On the counter: the till, a wireless, the shakers and the jiggers, an
// ice bucket with a bottle in it, upturned glasses on a towel and a pyramid of coupes.
export function saloonBackBar(c) {
  const { F, p, r } = c, { pbox, P } = F, hw = p.w / 2, hd = p.d / 2, h = p.h, top = 1.0, zf = hd - 0.02;
  // the cabinet
  pbox(-hw, hw, 0, 0.08, -hd, zf - 0.08, '#0e0a08', 0.9, null, SATIN);
  pbox(-hw, hw, 0.08, top - 0.05, -hd, zf - 0.04, MAHOG_DK, 1, WOOD_DK, SATIN);
  const n = Math.max(2, Math.round(p.w / 0.62)), dw = p.w / n;
  for (let i = 0; i < n; i++) {
    const x0 = -hw + i * dw + 0.012, x1 = x0 + dw - 0.024;
    pbox(x0, x1, 0.1, top - 0.07, zf - 0.04, zf - 0.02, MAHOG, 1, WOOD, SATIN);
    pbox(x0 + 0.05, x1 - 0.05, 0.16, top - 0.13, zf - 0.02, zf - 0.008, '#5e2c1a', 1.04, WOOD, GLOSS);
    c.rod(P(i % 2 ? x0 + 0.05 : x1 - 0.05, 0.6, zf - 0.006), P(i % 2 ? x0 + 0.05 : x1 - 0.05, 0.75, zf - 0.006), 0.008, BRASS, 1.12, METAL, 6);
  }
  pbox(-hw - 0.01, hw + 0.01, top - 0.05, top, -hd, zf + 0.01, '#ffffff', 1.04, { t: 'roomStone', c: '#2a2624' }, GLOSS);
  pbox(-hw - 0.012, hw + 0.012, top - 0.06, top - 0.05, -hd, zf + 0.012, BRASS, 1.1, null, METAL);
  // the bays: a mirror, its arch and the shelves, between columns
  const clock = h >= 2.8, H0 = top, H1 = h - (clock ? 0.74 : 0.42), nb = Math.max(2, Math.round(p.w / 1.6)), bw = p.w / nb, zm = -hd + 0.03;
  pbox(-hw, hw, H0, h - 0.02, -hd, zm, MAHOG_DK, 1, WOOD_DK, SATIN);
  for (let i = 0; i < nb; i++) {
    const x0 = -hw + i * bw, x1 = x0 + bw, xm = (x0 + x1) / 2, rr = (bw - 0.2) / 2, ys = H1 - rr;
    // the mirror: a smoked silvered sheet, with the warm light coming up its sides and down from its arch
    pbox(x0 + 0.1, x1 - 0.1, H0 + 0.02, ys, zm, zm + 0.006, '#4a4440', 1.3, null, GLOSS);
    for (let k = 0; k < 10; k++) {
      const a0 = k / 10 * Math.PI, a1 = (k + 1) / 10 * Math.PI, aw = Math.cos(a0) * rr, bw2 = Math.cos(a1) * rr;
      c.K.quad(c.K.solid, [P(xm + aw, ys + Math.sin(a0) * rr, zm + 0.006), P(xm + bw2, ys + Math.sin(a1) * rr, zm + 0.006), P(xm, ys, zm + 0.006), P(xm, ys, zm + 0.006)], F.N(0, 0, 1), c.K.C('#4a4440', 1.3), GLOSS, null, true);
      // the arch's moulding: a ring of short boxes round the top of the bay
      const am = (a0 + a1) / 2, ax = xm + Math.cos(am) * (rr + 0.025), ay = ys + Math.sin(am) * (rr + 0.025);
      pbox(ax - 0.035, ax + 0.035, ay - 0.035, ay + 0.035, zm, zm + 0.04, MAHOG, 1.02, WOOD, SATIN);
      ball(c, xm + Math.cos(am) * (rr + 0.006), ys + Math.sin(am) * (rr + 0.006), zm + 0.04, 0.008, BRASS, 1.1, 6, METAL);
    }
    // the spandrels over the arch, filled solid to the cornice, and a keystone
    pbox(x0, x0 + 0.1, H0, H1 + 0.04, zm, zm + 0.04, MAHOG, 1, WOOD, SATIN);
    pbox(x1 - 0.1, x1, H0, H1 + 0.04, zm, zm + 0.04, MAHOG, 1, WOOD, SATIN);
    for (const s of [-1, 1]) for (let k = 0; k < 8; k++) { const yy = ys + (k + 0.5) * (H1 + 0.04 - ys) / 8, ww = rr * (1 - Math.sqrt(Math.max(0, 1 - ((yy - ys) / rr) ** 2))) + 0.02; pbox(s < 0 ? x0 + 0.1 : x1 - 0.1 - ww, s < 0 ? x0 + 0.1 + ww : x1 - 0.1, yy - (H1 + 0.04 - ys) / 16, yy + (H1 + 0.04 - ys) / 16, zm, zm + 0.035, MAHOG, 1, WOOD, SATIN); }
    pbox(xm - 0.05, xm + 0.05, H1 - 0.06, H1 + 0.06, zm, zm + 0.07, MAHOG, 1.05, WOOD, SATIN);
    pbox(xm - 0.03, xm + 0.03, H1 - 0.03, H1 + 0.03, zm + 0.07, zm + 0.076, BRASS, 1.1, null, METAL);
    // light up the sides and under each shelf
    for (const x of [x0 + 0.11, x1 - 0.13]) pbox(x, x + 0.02, H0 + 0.04, ys, zm + 0.006, zm + 0.016, '#ffc070', 1.65, null, GLOW);
    for (const [y, deep] of [[H0 + 0.36, 0.26], [H0 + 0.78, 0.2]]) {
      if (y > ys + rr * 0.6) continue;
      // a shelf under the arch is cut to it
      const tb = y + 0.3, sw = (tb > ys ? Math.sqrt(Math.max(0, rr * rr - (tb - ys) ** 2)) : rr) - 0.02, s0 = Math.max(x0 + 0.1, xm - sw), s1 = Math.min(x1 - 0.1, xm + sw);
      pbox(s0, s1, y - 0.012, y, zm, zm + deep, '#cfe0e4', 0.9, null, GLOSS);
      pbox(s0, s1, y - 0.016, y - 0.012, zm + deep - 0.012, zm + deep, '#ffc070', 1.5, null, GLOW);
      c.rod(P(s0, y + 0.05, zm + deep - 0.006), P(s1, y + 0.05, zm + deep - 0.006), 0.005, BRASS, 1.12, METAL, 6);
      liquorRow(c, s0 + 0.03, s1 - 0.03, y, zm + deep * 0.5, Math.round((s1 - s0 - 0.06) / 0.085), r);
    }
  }
  // the columns between the bays: a base, a turned shaft, a brass capital
  for (let i = 0; i <= nb; i++) {
    const x = Math.max(-hw + 0.07, Math.min(hw - 0.07, -hw + i * bw)), z = zm + 0.08;
    c.lat(x, z, [[0, H0], [0.07, H0], [0.07, H0 + 0.08], [0.05, H0 + 0.1], [0.045, H0 + 0.16], [0.055, H0 + 0.2], [0.04, H0 + 0.24], [0.034, H1 - 0.12], [0.05, H1 - 0.08], [0, H1 - 0.08]], MAHOG, 1.02, 14, SATIN);
    for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; c.rod(P(x + Math.cos(a) * 0.036, H0 + 0.26, z + Math.sin(a) * 0.036), P(x + Math.cos(a) * 0.036, H1 - 0.14, z + Math.sin(a) * 0.036), 0.006, '#5e2c1a', 1.05, SATIN, 4); }
    c.lat(x, z, [[0.05, H1 - 0.08], [0.07, H1 - 0.04], [0.07, H1], [0, H1]], BRASS, 1.1, 14, METAL);
  }
  // the entablature: an architrave, the frieze with the trade lettered on it, dentils and the cornice
  const fz = zm + 0.12;
  pbox(-hw, hw, H1, H1 + 0.06, -hd, fz, MAHOG, 1.02, WOOD, SATIN);
  pbox(-hw, hw, H1 + 0.06, H1 + 0.24, -hd, fz - 0.02, MAHOG_DK, 1, WOOD_DK, SATIN);
  const trade = String(p.trade || '').toUpperCase().slice(0, 24);
  if (trade) lettering(c, trade, 0, H1 + 0.15, fz - 0.016, 0.11, '#e0b85a', 0, METAL);
  for (let x = -hw + 0.04; x < hw - 0.02; x += 0.06) pbox(x, x + 0.03, H1 + 0.25, H1 + 0.29, fz - 0.02, fz + 0.01, MAHOG, 1.04, WOOD, SATIN);
  pbox(-hw - 0.02, hw + 0.02, H1 + 0.29, H1 + 0.32, -hd, fz + 0.03, BRASS, 1.08, null, METAL);
  pbox(-hw - 0.03, hw + 0.03, H1 + 0.32, Math.min(h, H1 + 0.38), -hd, fz + 0.05, MAHOG, 1.05, WOOD, GLOSS);
  // a clock in a broken pediment over the middle, if the wall gives it room
  const cy = H1 + 0.38 + 0.17;
  if (clock) {
    pbox(-0.24, 0.24, H1 + 0.38, H1 + 0.42, -hd, fz, MAHOG, 1, WOOD, SATIN);
    for (const s of [-1, 1]) for (let k = 0; k < 5; k++) pbox(s * (0.24 - k * 0.035) - 0.03, s * (0.24 - k * 0.035) + 0.03, H1 + 0.42 + k * 0.035, H1 + 0.46 + k * 0.035, -hd, fz - 0.02, MAHOG, 1.02, WOOD, SATIN);
    ringZ(c, 0, cy, fz - 0.01, 0.13, 0.15, 0, TAU, BRASS, 1.1, METAL, 24);
    ringZ(c, 0, cy, fz - 0.012, 0, 0.13, 0, TAU, '#f2ead6', 1.05, SATIN, 24);
    for (let k = 0; k < 12; k++) { const a = k / 12 * TAU; pbox(Math.cos(a) * 0.11 - 0.006, Math.cos(a) * 0.11 + 0.006, cy + Math.sin(a) * 0.11 - 0.006, cy + Math.sin(a) * 0.11 + 0.006, fz - 0.012, fz - 0.008, '#1a1a1a', 1, null, MATTE); }
    c.rod(P(0, cy, fz - 0.006), P(0.04, cy + 0.065, fz - 0.006), 0.004, '#1a1a1a', 1, MATTE, 4);
    c.rod(P(0, cy, fz - 0.004), P(-0.085, cy + 0.02, fz - 0.004), 0.003, '#1a1a1a', 1, MATTE, 4);
  }
  // on the counter: the till at one end, the wireless at the other, the working kit between
  const T = top, zt = zf - 0.2;
  register(c, hw - 0.42, zt, T);
  wireless(c, -hw + 0.38, zt - 0.02, T);
  // a bar towel with glasses upturned on it, and a pyramid of coupes
  pbox(-0.9, -0.45, T, T + 0.006, zt - 0.1, zt + 0.1, '#e8e4dc', 1, null, CLOTH);
  for (let i = 0; i < 6; i++) { const x = -0.84 + (i % 3) * 0.11, z = zt - 0.05 + Math.floor(i / 3) * 0.1; c.lat(x, z, [[0, T + 0.09], [0.035, T + 0.09], [0.037, T + 0.006], [0, T + 0.006]], '#dfe8ea', 1.12, 10, GLOSS); }
  for (const [x, y, z] of [[-0.25, 0, 0], [-0.14, 0, 0], [-0.03, 0, 0], [-0.195, 0.1, 0], [-0.085, 0.1, 0], [-0.14, 0.2, 0]]) {
    c.lat(x, zt + z, [[0.03, T + y], [0.03, T + y + 0.004], [0.004, T + y + 0.012], [0.004, T + y + 0.07], [0.04, T + y + 0.08], [0.048, T + y + 0.1], [0, T + y + 0.098]], '#dfe8ea', 1.15, 10, GLOSS);
  }
  // shakers, a mixing glass with its spoon, jiggers; an ice bucket with a bottle's neck out of it
  c.lat(0.18, zt, [[0, T], [0.044, T], [0.05, T + 0.17], [0.046, T + 0.175], [0, T + 0.175]], '#c8ccd0', 1.1, 14, METAL);
  c.lat(0.18, zt, [[0, T + 0.175], [0.04, T + 0.175], [0.03, T + 0.22], [0.012, T + 0.24], [0.016, T + 0.26], [0, T + 0.265]], '#c8ccd0', 1.15, 14, METAL);
  c.lat(0.3, zt + 0.03, [[0, T], [0.038, T], [0.045, T + 0.13], [0, T + 0.13]], '#dfe8ea', 1.12, 12, GLOSS);
  c.rod(P(0.31, T + 0.04, zt + 0.03), P(0.35, T + 0.28, zt + 0.02), 0.0035, '#d8dade', 1.2, METAL, 4);
  for (const [x, z] of [[0.42, zt - 0.04], [0.47, zt + 0.02]]) { c.lat(x, z, [[0.022, T], [0.008, T + 0.04], [0.022, T + 0.08], [0, T + 0.08]], '#c8ccd0', 1.12, 10, METAL); }
  c.lat(0.68, zt, [[0, T], [0.08, T], [0.095, T + 0.17], [0.1, T + 0.18], [0, T + 0.18]], '#c8ccd0', 1.12, 18, METAL);
  c.lat(0.68, zt, [[0, T + 0.15], [0.09, T + 0.15], [0, T + 0.155]], '#eaf6fa', 1.3, 12, GLOSS);
  c.lat(0.7, zt, [[0, T + 0.12], [0.03, T + 0.12], [0.03, T + 0.24], [0.012, T + 0.28], [0.012, T + 0.32], [0, T + 0.32]], '#1e3a24', 1.1, 10, GLOSS);
  c.lat(0.7, zt, [[0, T + 0.3], [0.0135, T + 0.3], [0.0135, T + 0.33], [0, T + 0.33]], '#d8b45a', 1.1, 8, METAL);
}
// A shelf of bottles from x0 to x1 standing at y, centred at z: square whiskies, tall gins, round brandies and
// squat liqueurs, each with a label and a steel pour spout, the levels down on the ones in use.
function liquorRow(c, x0, x1, y, z, n, r) {
  const shapes = [
    (x, col) => c.lat(x, z, [[0, y], [0.034, y], [0.036, y + 0.2], [0.03, y + 0.23], [0.013, y + 0.25], [0.012, y + 0.3], [0, y + 0.3]], col, 0.95, 4, GLOSS),
    (x, col) => c.lat(x, z, [[0, y], [0.03, y], [0.031, y + 0.24], [0.02, y + 0.27], [0.011, y + 0.29], [0.011, y + 0.33], [0, y + 0.33]], col, 0.95, 10, GLOSS),
    (x, col) => c.lat(x, z, [[0, y], [0.028, y], [0.045, y + 0.07], [0.04, y + 0.14], [0.016, y + 0.18], [0.013, y + 0.24], [0, y + 0.24]], col, 0.95, 12, GLOSS),
    (x, col) => c.lat(x, z, [[0, y], [0.04, y], [0.042, y + 0.13], [0.022, y + 0.16], [0.016, y + 0.2], [0, y + 0.2]], col, 0.95, 10, GLOSS),
  ];
  const tops = [0.3, 0.33, 0.24, 0.2], cols = ['#7a3a12', '#d8dcd0', '#a8641a', '#5a1a10', '#2a5a3a', '#e8d8b0', '#3a2a6a', '#b84a1a', '#c8c0a0', '#6a1a2a'];
  const labels = ['#efe6d2', '#1a1a1a', '#c9a24a', '#8a1a1a', '#e8e0c8', '#2a3a5a'];
  for (let i = 0; i < n; i++) {
    const x = x0 + (i + 0.5) * (x1 - x0) / n + (r() - 0.5) * 0.012, s = Math.floor(r() * shapes.length), col = cols[Math.floor(r() * cols.length)];
    shapes[s](x, col);
    const lw = [0.026, 0.03, 0.043, 0.041][s], ly = y + 0.06 + r() * 0.03;
    c.F.pbox(x - 0.024, x + 0.024, ly, ly + 0.07, z + lw * 0.97, z + lw * 0.97 + 0.003, labels[Math.floor(r() * labels.length)], 1, null, MATTE);
    c.rod(c.F.P(x, y + tops[s], z), c.F.P(x, y + tops[s] + 0.035, z + 0.012), 0.004, '#d8dcdf', 1.15, METAL, 4);
  }
}
// An old brass till: a cash drawer, a stepped bank of round keys, the crested top with its sale flags, a crank.
function register(c, x, z, y) {
  const { pbox, P } = c.F;
  pbox(x - 0.2, x + 0.2, y, y + 0.1, z - 0.16, z + 0.16, BRASS_DK, 1.05, null, METAL);
  pbox(x - 0.17, x + 0.17, y + 0.02, y + 0.08, z + 0.16, z + 0.17, BRASS, 1.1, null, METAL);
  ball(c, x, y + 0.05, z + 0.18, 0.012, '#1a1a1a', 1, 8, GLOSS);
  // the key bank, five rows stepping back and up
  pbox(x - 0.19, x + 0.19, y + 0.1, y + 0.16, z - 0.14, z + 0.14, BRASS, 1.05, null, METAL);
  pbox(x - 0.19, x + 0.19, y + 0.16, y + 0.24, z - 0.14, z + 0.02, BRASS, 1.05, null, METAL);
  for (let row = 0; row < 4; row++) for (let k = 0; k < 7; k++) {
    const kx = x - 0.15 + k * 0.05, ky = y + 0.17 + row * 0.022, kz = z + 0.12 - row * 0.035;
    c.rod(P(kx, ky - 0.02, kz), P(kx, ky, kz), 0.004, '#3a3a3a', 1, METAL, 4);
    ball(c, kx, ky + 0.004, kz, 0.012, row === 0 ? '#c83a2a' : IVORY, 1.05, 8, GLOSS);
  }
  // the top, a crest with a window of sale flags
  pbox(x - 0.16, x + 0.16, y + 0.24, y + 0.36, z - 0.12, z - 0.02, BRASS, 1.08, null, METAL);
  pbox(x - 0.12, x + 0.12, y + 0.27, y + 0.33, z - 0.02, z - 0.012, '#f2ead6', 1.1, null, SATIN);
  for (let k = 0; k < 4; k++) pbox(x - 0.09 + k * 0.05, x - 0.07 + k * 0.05, y + 0.285, y + 0.315, z - 0.012, z - 0.009, '#1a1a1a', 1, null, MATTE);
  for (let k = 0; k < 5; k++) { const a = Math.PI * (k + 0.5) / 5; ball(c, x + Math.cos(a) * 0.12, y + 0.36 + Math.sin(a) * 0.05, z - 0.07, 0.02, BRASS, 1.12, 8, METAL); }
  // the crank on the right side
  c.rod(P(x + 0.2, y + 0.14, z - 0.02), P(x + 0.25, y + 0.14, z - 0.02), 0.008, BRASS, 1.1, METAL, 6);
  c.rod(P(x + 0.25, y + 0.14, z - 0.02), P(x + 0.25, y + 0.06, z + 0.04), 0.007, BRASS, 1.1, METAL, 6);
  c.rod(P(x + 0.25, y + 0.06, z + 0.04), P(x + 0.29, y + 0.06, z + 0.04), 0.012, '#1a1a1a', 1, GLOSS, 6);
}
// A cathedral wireless in walnut: an arched cabinet, a cloth grille behind fretwork, a lit dial and two knobs.
function wireless(c, x, z, y) {
  const { pbox } = c.F, w = 0.16, hgt = 0.2;
  pbox(x - w, x + w, y, y + hgt, z - 0.11, z + 0.11, '#5a3220', 1, WOOD, GLOSS);
  for (let k = 0; k < 10; k++) {
    const a = k / 10 * Math.PI, a1 = (k + 1) / 10 * Math.PI, xa = Math.cos(a) * w, xb = Math.cos(a1) * w;
    pbox(Math.min(xa, xb) + x - 0.002, Math.max(xa, xb) + x + 0.002, y + hgt, y + hgt + Math.max(Math.sin(a), Math.sin(a1)) * w * 0.9, z - 0.11, z + 0.11, '#5a3220', 1, WOOD, GLOSS);
  }
  pbox(x - w + 0.03, x + w - 0.03, y + 0.09, y + hgt + w * 0.6, z + 0.11, z + 0.112, '#c8a878', 1, null, CLOTH);
  for (const fx of [-0.07, -0.025, 0.025, 0.07]) pbox(x + fx - 0.008, x + fx + 0.008, y + 0.09, y + hgt + w * 0.55 - Math.abs(fx) * 0.8, z + 0.112, z + 0.12, '#4a2818', 1, WOOD, SATIN);
  pbox(x - 0.07, x + 0.07, y + 0.035, y + 0.07, z + 0.11, z + 0.116, '#ffc870', 1.7, null, GLOW);
  for (const s of [-1, 1]) ball(c, x + s * 0.11, y + 0.05, z + 0.12, 0.016, '#2a1a10', 1, 8, GLOSS);
}

// ── A RUN OF STOOLS ─────────────────────────────────────────────────────────────────────────────────────
// Bar stools along a bar, one every 0.8 m across the piece (room-layout.js gives it a seat at each): a brass
// pedestal on a weighted foot with a foot ring, a swivel collar, and a buttoned velvet seat, bald where it's sat.
// One in the row stands a little skew: it doesn't swivel any more.
export function stools(c) {
  const { F, p } = c, n = stoolsAlong(p.w), h = p.h, wear = Math.max(0, Math.min(1, c.wear || 0));
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * p.w / n;
    c.lat(x, 0, [[0, 0], [0.2, 0], [0.2, 0.014], [0.15, 0.04], [0.05, 0.06], [0.034, 0.1], [0.028, h - 0.12], [0.05, h - 0.1], [0.06, h - 0.08], [0, h - 0.08]], BRASS_DK, 1.05, 18, METAL);
    c.lat(x, 0, [[0.17, 0.3], [0.182, 0.306], [0.182, 0.322], [0.17, 0.328], [0.16, 0.322], [0.16, 0.306], [0.17, 0.3]], BRASS, 1.1, 20, METAL);
    for (let k = 0; k < 3; k++) { const a = k / 3 * TAU + i; c.rod(F.P(x, 0.28, 0), F.P(x + Math.cos(a) * 0.17, 0.314, Math.sin(a) * 0.17), 0.008, BRASS, 1.1, METAL, 4); }
    // the seat: a round cushion over its brass rim, pleated by its buttons
    c.lat(x, 0, [[0, h - 0.08], [0.2, h - 0.08], [0.205, h - 0.06], [0, h - 0.06]], BRASS, 1.1, 22, METAL);
    c.lat(x, 0, [[0, h - 0.06], [0.205, h - 0.06], [0.215, h - 0.035], [0.2, h - 0.01], [0.15, h], [0, h + 0.004]], VELVET, i === 2 ? 0.86 : 0.95, 22, CLOTH);
    for (let k = 0; k < 6; k++) { const a = k / 6 * TAU + 0.3; ball(c, x + Math.cos(a) * 0.11, h - 0.006, Math.sin(a) * 0.11, 0.008, '#3a0a12', 1, 6, CLOTH); }
    ball(c, x, h + 0.002, 0, 0.009, '#3a0a12', 1, 6, CLOTH);
    if (wear > 0.2 || i % 2) c.lat(x + 0.02, 0.01, [[0, h + 0.0045], [0.07, h + 0.0035], [0.075, h + 0.003]], '#a8707a', 0.85, 14, CLOTH);
  }
}

// ── A JUKEBOX ───────────────────────────────────────────────────────────────────────────────────────────
// A walnut cabinet with a rounded crown, its pilasters and arch run with lit tubes of coloured light, a domed
// window over the record and the title strips, a row of buttons, a coin slot and a chrome grille below.
export function jukebox(c) {
  const { F, p } = c, { pbox, P } = F, hw = p.w / 2, hd = p.d / 2, h = p.h, R = hw, yc = h - R, zf = hd - 0.02;
  pbox(-hw, hw, 0, 0.06, -hd + 0.02, hd - 0.04, '#141210', 1, null, SATIN);
  pbox(-hw + 0.02, hw - 0.02, 0.06, yc, -hd, hd - 0.04, '#5a3220', 1, WOOD, GLOSS);
  for (let k = 0; k < 14; k++) {
    const a = k / 14 * Math.PI, a1 = (k + 1) / 14 * Math.PI, xa = Math.cos(a) * (R - 0.02), xb = Math.cos(a1) * (R - 0.02);
    pbox(Math.min(xa, xb) - 0.002, Math.max(xa, xb) + 0.002, yc, yc + Math.max(Math.sin(a), Math.sin(a1)) * (R - 0.02), -hd, hd - 0.04, '#5a3220', 1, WOOD, GLOSS);
  }
  // the tubes: up each pilaster and round the arch, through red, amber, green and blue
  const tube = ['#ff3a3a', '#ffa020', '#ffe040', '#40e060', '#3a90ff', '#c040ff'];
  for (const s of [-1, 1]) for (let k = 0; k < 6; k++) {
    const y0 = 0.12 + k * (yc - 0.12) / 6, y1 = y0 + (yc - 0.12) / 6;
    c.rod(P(s * (hw - 0.07), y0, zf), P(s * (hw - 0.07), y1, zf), 0.022, tube[(k + (s > 0 ? 2 : 0)) % tube.length], 1.85, GLOW, 8);
    for (let b = 0; b < 2; b++) ball(c, s * (hw - 0.07), y0 + (b + 0.4) * (y1 - y0) / 2, zf + 0.012, 0.006, '#ffffff', 1.6, 4, GLOW);
  }
  for (let k = 0; k < 12; k++) {
    const a0 = k / 12 * Math.PI, a1 = (k + 1) / 12 * Math.PI, rr = R - 0.07;
    c.rod(P(Math.cos(a0) * rr, yc + Math.sin(a0) * rr, zf), P(Math.cos(a1) * rr, yc + Math.sin(a1) * rr, zf), 0.022, tube[k % tube.length], 1.85, GLOW, 8);
  }
  // the window: a dark domed glass over the record and its arm, a lit band of title strips under it
  const ww = hw - 0.13;
  pbox(-ww, ww, yc - 0.32, yc + R - 0.2, zf - 0.04, zf - 0.03, '#1a1418', 1, null, GLOSS);
  ringZ(c, 0, yc - 0.05, zf - 0.028, 0, 0.16, 0, TAU, '#0e0e10', 1, GLOSS, 24);
  ringZ(c, 0, yc - 0.05, zf - 0.026, 0, 0.05, 0, TAU, '#c83a2a', 1.1, SATIN, 16);
  c.rod(P(0.2, yc + 0.1, zf - 0.025), P(0.06, yc - 0.02, zf - 0.025), 0.007, '#c8ccd0', 1.15, METAL, 4);
  pbox(-ww, ww, yc - 0.48, yc - 0.34, zf - 0.03, zf - 0.02, '#f8ecc8', 1.55, null, GLOW);
  for (let k = 0; k < 10; k++) { const x = -ww + 0.02 + (k % 5) * (2 * ww - 0.04) / 5, yy = yc - 0.36 - Math.floor(k / 5) * 0.06; pbox(x + 0.005, x + (2 * ww - 0.04) / 5 - 0.01, yy - 0.04, yy - 0.012, zf - 0.02, zf - 0.016, k % 3 ? '#c83a2a' : '#2a4a8a', 1.1, null, MATTE); }
  // the buttons and the coin slot, then the grille
  for (let k = 0; k < 10; k++) ball(c, -ww + 0.02 + k * (2 * ww - 0.04) / 9, yc - 0.54, zf - 0.01, 0.014, k % 2 ? IVORY : '#c8ccd0', 1.1, 8, GLOSS);
  pbox(ww - 0.08, ww, yc - 0.66, yc - 0.6, zf - 0.02, zf, '#c8ccd0', 1.15, null, METAL);
  pbox(ww - 0.06, ww - 0.02, yc - 0.635, yc - 0.625, zf, zf + 0.002, '#0a0a0a', 1, null, MATTE);
  pbox(-ww, ww, 0.12, yc - 0.7, zf - 0.03, zf - 0.02, '#1a1410', 1, null, CLOTH);
  for (let k = 0; k < 9; k++) { const x = -ww + (k + 0.5) * 2 * ww / 9; pbox(x - 0.008, x + 0.008, 0.12, yc - 0.7, zf - 0.02, zf - 0.006, '#d8dcdf', 1.15, null, METAL); }
  for (let k = 0; k < 4; k++) { const y = 0.12 + (k + 0.5) * (yc - 0.82) / 4; pbox(-ww, ww, y - 0.006, y + 0.006, zf - 0.016, zf - 0.004, '#d8dcdf', 1.15, null, METAL); }
}

// ── A CARD TABLE'S RAIL, DRESSED ─────────────────────────────────────────────────────────────────────────
// What a regular game leaves on a card table's rail (gl/room-decor.js poker): brass nailheads round the padded
// rail, a drink in a cup holder at most of the places, an ashtray with a cigar going at one end, and a cut-glass
// decanter by the dealer. The felt stays clear: gl/room-poker.js deals on it.
export function dressCardTable(c, { h, hw, hd, R }) {
  const y = h + 0.034;
  // round the rail's outer edge, a nailhead every eleven centimetres
  const path = (t) => {
    // a point round a racetrack of half-length hw and half-depth hd, t 0..1 round it
    const straight = 2 * (hw - R), arc = Math.PI * R, all = 2 * straight + 2 * arc;
    let s = t * all;
    if (s < straight) return [hw - R - s, hd];
    s -= straight;
    if (s < arc) { const a = Math.PI / 2 + s / R; return [-(hw - R) + Math.cos(a) * R, Math.sin(a) * R]; }
    s -= arc;
    if (s < straight) return [-(hw - R) + s, -hd];
    s -= straight;
    const a = -Math.PI / 2 + s / R; return [(hw - R) + Math.cos(a) * R, Math.sin(a) * R];
  };
  const per = (2 * (hw - R) * 2 + 2 * Math.PI * R) / 0.11;
  for (let i = 0; i < per; i++) { const [x, z] = path(i / per), m = Math.hypot(x, z) || 1, q = (m + 0.004) / m; ball(c, x * q, h - 0.012, z * q, 0.009, BRASS, 1.12, 6, METAL); }
  // cup holders let into the race, and the drinks in some of them
  const holders = [[0.36, 'rocks'], [0.5, null], [0.62, 'pint'], [0.12, 'rocks'], [0.88, null], [0.76, 'shot']];
  for (const [t, kind] of holders) {
    const [x, z] = path(t), k = 1 - 0.165 / Math.hypot(x, z), hx = x * k, hz = z * k;
    c.lat(hx, hz, [[0.042, y - 0.004], [0.046, y + 0.002], [0.038, y + 0.002], [0.038, y - 0.03], [0, y - 0.03]], BRASS, 1.1, 14, METAL);
    if (kind) drink(c, kind, hx, hz, y - 0.028);
  }
  // the cigar end: an ashtray on the rail, and the dealer's decanter
  const [ax, az] = path(0.25), ka = 1 - 0.165 / Math.hypot(ax, az);
  ashtray(c, ax * ka, az * ka, y, true);
  const [dx, dz] = path(0.02), kd = 1 - 0.165 / Math.hypot(dx, dz);
  c.lat(dx * kd, dz * kd, [[0, y], [0.05, y], [0.06, y + 0.06], [0.05, y + 0.14], [0.02, y + 0.17], [0.018, y + 0.21], [0.026, y + 0.22], [0, y + 0.225]], '#a8641a', 1.12, 8, GLOSS);
  ball(c, dx * kd, y + 0.24, dz * kd, 0.022, '#dfe6e8', 1.15, 8, GLOSS);
}

// ── THE ROOM'S DRESSING ─────────────────────────────────────────────────────────────────────────────────
// From the room's `flags.room.decor`, every key optional, all of it placed by the content file:
//   neon      [{ wall, at, y, text, h?, hex?, lamp? }]    lettering bent in lit tube on standoffs, with its transformer
//   pendants  [{ at: [u, v], y, kind: 'card'|'school', len?, along?: 'u'|'v', hex?, k? }]
//             a card-room lamp (a long green shade on two chains) or a schoolhouse globe on a rod; `k` lights the room
//   fans      [[u, v, r?]]                               a ceiling fan on its downrod, four cane blades and a light kit
//   salon     [{ wall, at, y, w, h, seed? }]              a hang of old photographs in mismatched frames
//   trophy    [{ wall, at, y }]                          antlers on an oak shield
//   chalk     [{ wall, at, y, w, h, title? }]             a chalkboard in a frame with its tray, the day's offers on it
//   darts     [{ wall, at, y }]                          a dartboard in its cabinet, three darts in, the score chalked up
//   payphone  [{ wall, at, y, note? }]                    a coin phone on the wall, the handset on its cord, a note taped on
//   hatstand  [[u, v]]                                   a bentwood coat stand with a coat, a hat and an umbrella
//   litter    [{ at: [u, v], r: [ru, rv], n?, seed? }]     peanut shells, butts and a dropped beer mat on the floor
export function drawSaloonDecor(K, L, dc, ctx) {
  const lamps = ctx.lamps, lampOn = ctx.lampOn, H = ctx.H;
  for (const c of [].concat(dc.neon || [])) if (c?.text && WALLS.includes(c.wall)) neon(K, L, c, lamps, lampOn);
  for (const c of [].concat(dc.pendants || [])) if (Array.isArray(c?.at)) pendant(K, L, c, H, lamps, lampOn);
  for (const c of [].concat(dc.fans || [])) if (Array.isArray(c) && c.length >= 2) fan(K, L, c, H, lampOn);
  for (const c of [].concat(dc.salon || [])) if (WALLS.includes(c?.wall)) salon(K, L, c);
  for (const c of [].concat(dc.trophy || [])) if (WALLS.includes(c?.wall)) trophy(K, L, c);
  for (const c of [].concat(dc.chalk || [])) if (WALLS.includes(c?.wall)) chalkboard(K, L, c);
  for (const c of [].concat(dc.darts || [])) if (WALLS.includes(c?.wall)) darts(K, L, c);
  for (const c of [].concat(dc.payphone || [])) if (WALLS.includes(c?.wall)) payphone(K, L, c);
  for (const c of [].concat(dc.hatstand || [])) if (Array.isArray(c) && c.length >= 2) hatstand(K, L, c);
  for (const c of [].concat(dc.litter || [])) if (Array.isArray(c?.at)) litter(K, L, c);
}
const WALLS = ['front', 'back', 'left', 'right'];
// A frame standing on a wall at `a` along it (u on the front and back, v on the sides), z out into the room. Seen
// from the room +x is to the left, so lettering and anything handed is drawn at -x.
function onWallCtx(K, L, wall, a, seed = 7) {
  const hu = L.w / 2, D = L.d;
  const [u, v, fu, fv] = wall === 'front' ? [a, 0, 0, 1] : wall === 'back' ? [a, D, 0, -1] : wall === 'left' ? [-hu, a, 1, 0] : [hu, a, -1, 0];
  const F = K.frame(u, v, fu, fv);
  return saloonCtx(K, F, { seed }, seed);
}

// NEON: each stroke of the legend face bent in tube, round at its ends, on clear standoffs, a little off the wall.
function neon(K, L, n, lamps, lampOn) {
  const c = onWallCtx(K, L, n.wall, num(n.at, 0)), h = num(n.h, 0.36, 0.08, 1.5), y = num(n.y, 2.6), hex = hex6(n.hex, '#ff4f8a'), on = lampOn !== false;
  const u = h / 6, W = legendWidth(n.text, h), z = 0.06, tr = Math.max(0.006, h * 0.028), k = on ? 2.3 : 0.9;
  let x0 = -W / 2 + 0.62 * u;
  const { P } = c.F;
  const pt = (gx, gy) => [-(x0 + gx * u), y - h / 2 + gy * u];
  for (const ch of String(n.text).toUpperCase()) {
    for (const s of LEGEND_STROKES[ch] || []) {
      const [ax, ay] = pt(s[0], s[1]), [bx, by] = pt(s[2], s[3]);
      c.rod(P(ax, ay, z), P(bx, by, z), tr, hex, k, GLOW, 6);
      for (const [qx, qy] of [[ax, ay], [bx, by]]) ball(c, qx, qy, z, tr, hex, k, 6, GLOW);
    }
    x0 += 5.4 * u;
  }
  // standoffs at each end of the run, and the transformer box on the wall under one end
  for (const s of [-1, 1]) for (const dy of [-0.3, 0.3]) c.rod(P(s * (W / 2 - u), y + dy * h, 0.004), P(s * (W / 2 - u), y + dy * h, z), 0.004, '#dfe8ea', 1.1, GLOSS, 4);
  c.F.pbox(W / 2 - 0.2, W / 2 - 0.02, y - h / 2 - 0.14, y - h / 2 - 0.04, 0.004, 0.07, '#2a2c30', 1, null, METAL);
  c.rod(P(W / 2 - 0.11, y - h / 2 - 0.04, 0.04), P(W / 2 - u, y - h / 2 + 0.02, z), 0.004, '#1a1a1a', 1, MATTE, 4);
  if (on && Number(n.lamp) > 0 && lamps) {
    const [lu, lv] = c.F.P(0, 0, 0.5), t = lin3(hex);
    lamps.push({ p: L.world(lu, lv, y), annex: false, k: num(n.lamp, 0.4, 0.05, 1.5), tint: t });
  }
}
// a lamp's tint from a colour: its channels over their mean, so it shifts the hue and not the strength
function lin3(hex) { const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255); const m = (v[0] + v[1] + v[2]) / 3 || 1; return v.map((x) => +(x / m).toFixed(3)); }

// PENDANTS: a card-room lamp hung low over a table, a long shade in green cased glass, white inside, on two chains
// from a brass bar; or a schoolhouse globe on a brass rod.
function pendant(K, L, c, H, lamps, lampOn) {
  const [u, v] = c.at, y = num(c.y, 1.8, 0.8, H - 0.3), kind = c.kind === 'school' ? 'school' : 'card', on = lampOn !== false;
  const F = K.frame(u, v, c.along === 'v' ? 1 : 0, c.along === 'v' ? 0 : 1), cx = saloonCtx(K, F, { seed: 3 }), { P, pbox } = F;
  const hex = hex6(c.hex, kind === 'card' ? '#1d5a34' : '#efe2c0');
  if (kind === 'card') {
    const len = num(c.len, 1.3, 0.5, 3), hl = len / 2;
    // the ceiling plate, the chains to a brass bar, the shade
    for (const s of [-1, 1]) {
      const x = s * (hl - 0.18);
      K.lathe(...P(x, 0, 0).slice(0, 2), [[0, H - 0.04], [0.06, H - 0.04], [0.07, H], [0, H]], BRASS, 1.05, 14, METAL);
      for (let yy = H - 0.06; yy > y + 0.14; yy -= 0.05) { cx.rod(P(x, yy, 0), P(x, yy - 0.04, 0), 0.0045, BRASS, 1.1, METAL, 4); ball(cx, x, yy - 0.045, 0, 0.007, BRASS, 1.1, 6, METAL); }
    }
    cx.rod(P(-hl + 0.1, y + 0.13, 0), P(hl - 0.1, y + 0.13, 0), 0.012, BRASS, 1.1, METAL, 8);
    // the shade: a long trough, sloped sides out over the light, a brass band along its rim and its ends
    const sw = 0.2, sh = 0.13;
    for (const s of [-1, 1]) K.quad(K.solid, [P(-hl, y, s * sw), P(hl, y, s * sw), P(hl, y + sh, s * sw * 0.45), P(-hl, y + sh, s * sw * 0.45)], F.N(0, 0.55, s), K.C(hex, 1.05), GLOSS);
    for (const s of [-1, 1]) K.quad(K.solid, [P(-hl, y, s * sw * 0.98), P(hl, y, s * sw * 0.98), P(hl, y + sh * 0.98, s * sw * 0.44), P(-hl, y + sh * 0.98, s * sw * 0.44)], F.N(0, -0.55, -s), K.C('#fff2d8', on ? 1.6 : 0.9), on ? LAMP : MATTE, null, on);
    for (const s of [-1, 1]) K.quad(K.solid, [P(s * hl, y, -sw), P(s * hl, y, sw), P(s * hl, y + sh, sw * 0.45), P(s * hl, y + sh, -sw * 0.45)], F.N(s, 0, 0), K.C(hex, 1), GLOSS);
    pbox(-hl, hl, y + sh - 0.006, y + sh + 0.01, -sw * 0.47, sw * 0.47, BRASS, 1.08, null, METAL);
    for (const s of [-1, 1]) pbox(-hl - 0.006, hl + 0.006, y - 0.004, y + 0.008, s * sw - 0.006, s * sw + 0.006, BRASS, 1.1, null, METAL);
    for (const x of [-hl * 0.5, hl * 0.5]) ball(cx, x, y + 0.04, 0, 0.04, on ? '#fff4d8' : '#d8d4c8', on ? 2.4 : 0.9, 10, on ? LAMP : MATTE);
  } else {
    K.lathe(u, v, [[0, H - 0.03], [0.07, H - 0.03], [0.08, H], [0, H]], BRASS, 1.05, 14, METAL);
    K.lathe(u, v, [[0.009, y + 0.24], [0.009, H - 0.03], [0, H - 0.03]], BRASS, 1.08, 8, METAL);
    K.lathe(u, v, [[0.035, y + 0.2], [0.045, y + 0.24], [0, y + 0.25]], BRASS, 1.08, 14, METAL);
    K.lathe(u, v, [[0.05, y + 0.2], [0.11, y + 0.14], [0.13, y + 0.06], [0.11, y - 0.02], [0.07, y - 0.06], [0, y - 0.065]], hex, on ? 1.75 : 1, 20, on ? LAMP : GLOSS);
  }
  if (on && lamps && Number(c.k) > 0) lamps.push({ p: L.world(u, v, y - 0.05), annex: false, k: num(c.k, 0.8, 0.05, 2), ...(c.tint ? { tint: c.tint } : {}) });
}
// A CEILING FAN: a canopy and downrod, a brass motor housing, four cane-and-wood blades on brass irons, and an
// opal glass under it. It stands still: it was put up for the look, and the look was the point.
function fan(K, L, [u, v, r0], H, lampOn) {
  const r = num(r0, 0.65, 0.4, 1), y = H - 0.55, F = K.frame(u, v, 0, 1), c = saloonCtx(K, F, { seed: 5 });
  K.lathe(u, v, [[0, H - 0.05], [0.07, H - 0.05], [0.08, H], [0, H]], BRASS, 1.05, 16, METAL);
  K.lathe(u, v, [[0.014, y + 0.12], [0.014, H - 0.05], [0, H - 0.05]], BRASS, 1.08, 8, METAL);
  K.lathe(u, v, [[0, y], [0.09, y], [0.12, y + 0.04], [0.12, y + 0.08], [0.08, y + 0.12], [0, y + 0.13]], BRASS_DK, 1.05, 20, METAL);
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * TAU + 0.4, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(a + Math.PI / 2), sb = Math.sin(a + Math.PI / 2);
    c.rod([u + ca * 0.08, v + sa * 0.08, y + 0.03], [u + ca * 0.2, v + sa * 0.2, y + 0.02], 0.012, BRASS, 1.1, METAL, 6);
    const q = (t, w, dy = 0) => [u + ca * t + cb * w, v + sa * t + sb * w, y + 0.02 + dy];
    // a blade, pitched a few degrees, walnut on top and cane under
    K.quad(K.solid, [q(0.2, -0.065, 0.006), q(r, -0.075, 0.012), q(r, 0.075, -0.012), q(0.2, 0.065, -0.006)], K.nrmOf(-cb * 0.1, 1, -sb * 0.1), K.C('#5a3220', 1), SATIN);
    K.quad(K.solid, [q(0.2, -0.065, 0.002), q(r, -0.075, 0.008), q(r, 0.075, -0.016), q(0.2, 0.065, -0.01)], K.nrmOf(0, -1, 0), K.C('#c8a878', 0.95), CLOTH);
  }
  K.lathe(u, v, [[0.07, y], [0.1, y - 0.05], [0.08, y - 0.11], [0, y - 0.12]], '#f2ecdc', lampOn !== false ? 1.45 : 1, 18, lampOn !== false ? LAMP : GLOSS);
}
// A SALON HANG: a dozen old photographs packed together, mismatched frames, mostly portraits in sepia and silver.
function salon(K, L, c) {
  const w = num(c.w, 1.6, 0.4, 4), h = num(c.h, 1.1, 0.3, 3), y = num(c.y, 2.2), cx = onWallCtx(K, L, c.wall, num(c.at, 0)), r = rng(num(c.seed, 4) * 997 + 1), { pbox } = cx.F;
  const frames = ['#1a1412', '#5a3220', '#c9a24a', '#2a2a2a', '#7a5a3a'], tints = [['#d8c8a0', '#5a4630'], ['#d8d8d0', '#3a3a3c'], ['#c8b088', '#4a3420'], ['#e0d4b8', '#6a5038']];
  // fill the area in rows of frames of random widths, a small gap between
  let yy = y + h / 2;
  while (yy > y - h / 2 + 0.12) {
    const rh = 0.16 + r() * 0.2;
    let x = -w / 2;
    while (x < w / 2 - 0.1) {
      const fw = Math.min(w / 2 - x, 0.12 + r() * 0.24), fh = rh - r() * 0.06, f = frames[Math.floor(r() * frames.length)], [paper, ink] = tints[Math.floor(r() * tints.length)];
      const x0 = x + 0.015, x1 = x + fw - 0.015, y1 = yy - 0.015, y0 = yy - fh;
      const d0 = 0.012 + r() * 0.008, b = 0.012 + r() * 0.012;
      pbox(-x1, -x0, y0, y1, 0.004, d0 + 0.02, f, 1, null, f === '#c9a24a' ? METAL : SATIN);
      pbox(-x1 + b, -x0 - b, y0 + b, y1 - b, d0 + 0.02, d0 + 0.022, paper, 1, null, MATTE);
      // a portrait: a head and shoulders, or two of them; or a street and a sky
      const mx = -(x0 + x1) / 2, my = (y0 + y1) / 2, pw = (x1 - x0 - 2 * b), ph = (y1 - y0 - 2 * b);
      if (r() < 0.75) {
        const people = r() < 0.3 ? 2 : 1;
        for (let k = 0; k < people; k++) {
          const ox = people > 1 ? (k - 0.5) * pw * 0.42 : 0;
          pbox(mx + ox - pw * 0.24 / people * 1.4, mx + ox + pw * 0.24 / people * 1.4, my - ph / 2 + 0.002, my - ph * 0.12, d0 + 0.022, d0 + 0.023, ink, 1, null, MATTE);
          const [hu2, hv2, hy] = cx.F.P(mx + ox, my + ph * 0.1, d0 + 0.023);
          cx.K.ball(hu2, hv2, hy, Math.min(pw, ph) * 0.13 / Math.sqrt(people), ink, 1, 8, MATTE);
        }
      } else {
        pbox(mx - pw / 2, mx + pw / 2, my - ph / 2, my - ph * 0.05, d0 + 0.022, d0 + 0.023, ink, 0.9, null, MATTE);
        for (let k = 0; k < 4; k++) { const bx = mx - pw / 2 + (k + 0.2) * pw / 4; pbox(bx, bx + pw * 0.16, my - ph * 0.05, my + ph * (0.1 + r() * 0.3), d0 + 0.022, d0 + 0.0232, ink, 0.8, null, MATTE); }
      }
      x += fw;
    }
    yy -= rh;
  }
}
// A TROPHY: a stag's antlers on a carved oak shield, the skull plate bleached.
function trophy(K, L, c) {
  const cx = onWallCtx(K, L, c.wall, num(c.at, 0)), y = num(c.y, 2.8), { pbox, P } = cx.F;
  for (let k = 0; k < 8; k++) { const t = k / 8, hw = 0.2 * Math.sin(Math.PI * (0.15 + t * 0.85)) + 0.04; pbox(-hw, hw, y - 0.26 + t * 0.5, y - 0.26 + (t + 1 / 8) * 0.5, 0.004, 0.04, '#6a4024', 1, WOOD, GLOSS); }
  pbox(-0.08, 0.08, y - 0.05, y + 0.12, 0.04, 0.08, '#e8e0cc', 1, null, MATTE);
  const beam = (s) => {
    const pts = [[0.06, 0.1], [0.18, 0.2], [0.26, 0.38], [0.24, 0.56], [0.18, 0.7]];
    let prev = [s * 0.04, y + 0.08, 0.08];
    for (const [ax, ay] of pts) { const nx = [s * ax, y + ay, 0.12 + ay * 0.1]; cx.rod(P(...prev), P(...nx), 0.014 - ay * 0.012, '#d8c8a0', 1, SATIN, 6); prev = nx; }
    for (const [ax, ay, tx, ty] of [[0.16, 0.18, 0.08, 0.36], [0.25, 0.36, 0.14, 0.5], [0.24, 0.54, 0.32, 0.72], [0.2, 0.66, 0.1, 0.82]]) cx.rod(P(s * ax, y + ay, 0.12 + ay * 0.1), P(s * tx, y + ty, 0.16 + ty * 0.08), 0.008, '#e0d4b0', 1, SATIN, 5);
  };
  beam(-1); beam(1);
}
// A CHALKBOARD: slate in an oak frame with a chalk tray, a title and the lines of the day's offers in chalk.
function chalkboard(K, L, c) {
  const cx = onWallCtx(K, L, c.wall, num(c.at, 0)), w = num(c.w, 0.8, 0.3, 3), h = num(c.h, 1, 0.3, 2), y = num(c.y, 1.6), { pbox } = cx.F, r = rng(23);
  pbox(-w / 2 - 0.04, w / 2 + 0.04, y - h / 2 - 0.04, y + h / 2 + 0.04, 0.004, 0.03, '#6a4024', 1, WOOD, SATIN);
  pbox(-w / 2, w / 2, y - h / 2, y + h / 2, 0.03, 0.034, '#1e2422', 1, null, MATTE);
  pbox(-w / 2 - 0.02, w / 2 + 0.02, y - h / 2 - 0.05, y - h / 2 - 0.03, 0.004, 0.08, '#6a4024', 1, WOOD, SATIN);
  pbox(-0.1, -0.05, y - h / 2 - 0.03, y - h / 2 - 0.018, 0.04, 0.052, '#efe8dc', 1, null, MATTE);
  if (c.title) lettering(cx, c.title, 0, y + h / 2 - 0.1, 0.035, Math.min(0.08, h * 0.1), '#e8e4dc', 0, MATTE);
  // the lines: a word's worth of chalk strokes and a price at the end, each at its own slight slant
  for (let i = 0; i < 6; i++) {
    const ly = y + h / 2 - 0.22 - i * (h - 0.32) / 6, len = w * (0.45 + r() * 0.3);
    for (let s = 0; s < 6; s++) { const x0 = -w / 2 + 0.06 + s * len / 6; if (r() < 0.15) continue; pbox(-(x0 + len / 6 - 0.012), -x0, ly - 0.012 + r() * 0.006, ly + 0.012, 0.0345, 0.0355, '#d8d4cc', 0.85 + r() * 0.15, null, MATTE); }
    pbox(-(w / 2 - 0.05), -(w / 2 - 0.13), ly - 0.014, ly + 0.014, 0.0345, 0.0355, '#e8c8a0', 0.95, null, MATTE);
  }
}
// DARTS: a sisal board in a hinged cabinet, its doors open; the twenty segments, the bull, three darts in it, and
// the score chalked on the left door.
function darts(K, L, c) {
  const cx = onWallCtx(K, L, c.wall, num(c.at, 0)), y = num(c.y, 1.73), { pbox, P } = cx.F, R = 0.225;
  pbox(-0.3, 0.3, y - 0.32, y + 0.32, 0.004, 0.07, '#3a2214', 1, WOOD_DK, SATIN);
  pbox(-0.27, 0.27, y - 0.29, y + 0.29, 0.07, 0.072, '#141210', 1, null, MATTE);
  for (const s of [-1, 1]) {
    pbox(s * 0.3 + (s < 0 ? -0.56 : 0), s * 0.3 + (s < 0 ? 0 : 0.56), y - 0.32, y + 0.32, 0.004, 0.024, '#3a2214', 1, WOOD_DK, SATIN);
    pbox(s * 0.3 + (s < 0 ? -0.53 : 0.03), s * 0.3 + (s < 0 ? -0.03 : 0.53), y - 0.29, y + 0.29, 0.024, 0.026, '#1e2422', 1, null, MATTE);
  }
  const z = 0.09, S = 20;
  ringZ(cx, 0, y, z - 0.004, 0, R + 0.03, 0, TAU, '#141210', 1, MATTE, 40);
  for (let i = 0; i < S; i++) {
    const a0 = (i - 0.5) / S * TAU + Math.PI / 2, a1 = (i + 0.5) / S * TAU + Math.PI / 2, odd = i % 2;
    ringZ(cx, 0, y, z, 0.016, R * 0.58, a0, a1, odd ? '#efe2c4' : '#16120e', 1, MATTE, 2);
    ringZ(cx, 0, y, z, R * 0.58, R * 0.63, a0, a1, odd ? '#2a7a3a' : '#c0242a', 1, MATTE, 2);
    ringZ(cx, 0, y, z, R * 0.63, R * 0.94, a0, a1, odd ? '#efe2c4' : '#16120e', 1, MATTE, 2);
    ringZ(cx, 0, y, z, R * 0.94, R, a0, a1, odd ? '#2a7a3a' : '#c0242a', 1, MATTE, 2);
  }
  ringZ(cx, 0, y, z + 0.0005, 0.006, 0.016, 0, TAU, '#2a7a3a', 1, MATTE, 12);
  ringZ(cx, 0, y, z + 0.0005, 0, 0.0065, 0, TAU, '#c0242a', 1, MATTE, 8);
  for (const rr of [R * 0.58, R * 0.63, R * 0.94, R]) ringZ(cx, 0, y, z + 0.001, rr - 0.002, rr + 0.002, 0, TAU, '#c8ccd0', 1.1, METAL, 40);
  for (const [dx, dy] of [[0.03, 0.07], [-0.05, 0.1], [0.08, -0.03]]) {
    const tip = P(dx, y + dy, z), tail = P(dx + 0.02, y + dy + 0.03, z + 0.13);
    cx.rod(tip, tail, 0.005, '#c8ccd0', 1.1, METAL, 5);
    const [fu, fv, fy] = tail;
    K.quad(K.solid, [[fu, fv, fy - 0.02], [fu, fv, fy + 0.02], [fu + (tail[0] - tip[0]) * 0.2, fv + (tail[1] - tip[1]) * 0.2, fy + 0.03], [fu + (tail[0] - tip[0]) * 0.2, fv + (tail[1] - tip[1]) * 0.2, fy - 0.01]], K.nrmOf(1, 0, 0), K.C('#c81a2a', 1), MATTE);
  }
  // the score on the left door (as seen): two columns of chalked numbers, crossed out as they went down
  for (let i = 0; i < 7; i++) for (const col of [0, 1]) { const x = 0.36 + 0.14 * col, yy = y + 0.22 - i * 0.065; pbox(x, x + 0.08, yy - 0.012, yy + 0.012, 0.0265, 0.0275, '#d8d4cc', 0.9, null, MATTE); if (i < 6) pbox(x - 0.005, x + 0.085, yy - 0.002, yy + 0.002, 0.0275, 0.028, '#d8d4cc', 0.9, null, MATTE); }
}
// A PAYPHONE: a steel box on the wall, a coin slot and return, a keypad, the handset hung on its hook with its
// armoured cord, and a handwritten note taped across it.
function payphone(K, L, c) {
  const cx = onWallCtx(K, L, c.wall, num(c.at, 0)), y = num(c.y, 1.4), { pbox, P } = cx.F;
  pbox(-0.13, 0.13, y - 0.32, y + 0.24, 0.004, 0.13, '#8a8e92', 1.02, null, METAL);
  pbox(-0.14, 0.14, y + 0.24, y + 0.3, 0.004, 0.16, '#3a3c40', 1, null, METAL);
  pbox(-0.1, 0.06, y - 0.12, y + 0.08, 0.13, 0.136, '#b0b4b8', 1.05, null, METAL);
  for (let k = 0; k < 12; k++) { const kx = -0.07 + (k % 3) * 0.05, ky = y + 0.04 - Math.floor(k / 3) * 0.045; pbox(kx - 0.016, kx + 0.016, ky - 0.014, ky + 0.014, 0.136, 0.146, '#d8dcdf', 1.1, null, METAL); }
  pbox(0.07, 0.11, y + 0.12, y + 0.18, 0.13, 0.14, '#2a2c30', 1, null, METAL);
  pbox(0.08, 0.1, y + 0.145, y + 0.155, 0.14, 0.142, '#0a0a0a', 1, null, MATTE);
  pbox(-0.06, 0.06, y - 0.28, y - 0.2, 0.13, 0.15, '#2a2c30', 1, null, METAL);
  // the handset on its hook at the left side (as seen), and the cord down and back up
  const hx = 0.17;
  pbox(hx - 0.04, hx + 0.04, y - 0.04, y + 0.18, 0.08, 0.14, '#16161a', 1, null, GLOSS);
  for (const dy of [-0.06, 0.2]) pbox(hx - 0.05, hx + 0.05, y + dy - 0.03, y + dy + 0.03, 0.08, 0.15, '#16161a', 1, null, GLOSS);
  let prev = P(hx, y - 0.09, 0.11);
  for (let k = 1; k <= 8; k++) { const t = k / 8, nx = P(hx - 0.02 * Math.sin(t * Math.PI), y - 0.09 - 0.22 * Math.sin(t * Math.PI), 0.11), q = k === 8 ? P(0.13, y - 0.26, 0.08) : nx; cx.rod(prev, q, 0.007, '#c8ccd0', 1.05, METAL, 5); prev = q; }
  // the note: a sheet torn off a pad, two strips of tape, a line of writing
  if (c.note !== false) {
    pbox(-0.12, 0.03, y + 0.1, y + 0.22, 0.146, 0.148, '#f4ecd0', 1.05, null, MATTE);
    for (const x of [-0.11, 0.0]) pbox(x - 0.005, x + 0.035, y + 0.2, y + 0.235, 0.148, 0.149, '#e8e4c8', 1.15, null, GLOSS);
    for (let k = 0; k < 3; k++) pbox(-0.105, 0.0 - k * 0.02, y + 0.17 - k * 0.025, y + 0.18 - k * 0.025, 0.148, 0.1485, '#2a2a6a', 1, null, MATTE);
  }
}
// A HATSTAND: a bentwood stand on four splayed feet, its hooks curling out, with a coat, a hat and an umbrella.
function hatstand(K, L, [u, v]) {
  const F = K.frame(u, v, 0, 1), c = saloonCtx(K, F, { seed: 9 }), { P } = F, W = '#3a2214';
  for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + 0.4; c.rod(P(0, 0.3, 0), P(Math.cos(a) * 0.28, 0.02, Math.sin(a) * 0.28), 0.018, W, 1, SATIN, 6); ball(c, Math.cos(a) * 0.28, 0.02, Math.sin(a) * 0.28, 0.022, W, 1, 6, SATIN); }
  c.lat(0, 0, [[0.03, 0.25], [0.025, 1.7], [0.04, 1.74], [0, 1.78]], W, 1, 10, SATIN);
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * TAU, yh = i % 2 ? 1.62 : 1.5;
    c.rod(P(0, yh - 0.1, 0), P(Math.cos(a) * 0.14, yh, Math.sin(a) * 0.14), 0.011, W, 1, SATIN, 5);
    c.rod(P(Math.cos(a) * 0.14, yh, Math.sin(a) * 0.14), P(Math.cos(a) * 0.17, yh + 0.06, Math.sin(a) * 0.17), 0.011, W, 1, SATIN, 5);
  }
  // a long coat hung off one hook, hanging to the knee
  c.R(...F.alongY(), 0.62, 1.5, 0.04, 0.3, -0.06, 0.1, 0.06, { t: 'roomWeave', c: '#3a3430' }, 0.95, CLOTH);
  c.R(...F.alongY(), 1.38, 1.52, 0.06, 0.24, -0.08, 0.1, 0.04, { t: 'roomWeave', c: '#3a3430' }, 0.95, CLOTH);
  // a trilby on the top hook, an umbrella leant in
  c.lat(-0.12, -0.12, [[0, 1.62], [0.15, 1.62], [0.15, 1.632], [0.09, 1.64], [0.085, 1.74], [0.06, 1.76], [0, 1.76]], '#2a2420', 1, 16, CLOTH);
  c.lat(-0.12, -0.12, [[0.088, 1.65], [0.091, 1.67], [0.088, 1.69]], '#6a1a1a', 1, 16, SATIN);
  c.rod(P(0.2, 0.02, 0.12), P(0.08, 0.9, 0.04), 0.03, '#1a1a1e', 1, CLOTH, 8);
  c.rod(P(0.08, 0.9, 0.04), P(0.06, 1.0, 0.03), 0.008, '#3a2214', 1, SATIN, 5);
}
// LITTER: what a busy night leaves on the floor in front of a bar: shells, a few butts, a dropped beer mat.
function litter(K, L, c) {
  const [u, v] = c.at, [ru, rv] = Array.isArray(c.r) ? c.r : [1, 0.5], n = Math.round(num(c.n, 40, 0, 200)), r = rng(num(c.seed, 9) * 131 + 7);
  for (let i = 0; i < n; i++) {
    const a = r() * TAU, d = Math.sqrt(r()), x = u + Math.cos(a) * d * ru, z = v + Math.sin(a) * d * rv, b = r() * TAU, kind = r();
    if (kind < 0.72) {
      // half a peanut shell
      const l = 0.012 + r() * 0.006;
      rodK(K, [x - Math.cos(b) * l, z - Math.sin(b) * l, 0.005], [x + Math.cos(b) * l, z + Math.sin(b) * l, 0.006], 0.0055, r() < 0.5 ? '#c89a5e' : '#a8804a', 1, MATTE, 5);
    } else if (kind < 0.9) {
      rodK(K, [x, z, 0.004], [x + Math.cos(b) * 0.024, z + Math.sin(b) * 0.024, 0.004], 0.0042, r() < 0.5 ? '#d9a86a' : '#efe8dc', 1, MATTE, 5);
    } else if (kind < 0.95) {
      K.lathe(x, z, [[0, 0.001], [0.013, 0.001], [0.0135, 0.005], [0, 0.005]], r() < 0.5 ? '#c8a050' : '#c0c4c8', 1.1, 10, METAL);
    } else {
      const F = K.frame(x, z, Math.cos(b), Math.sin(b));
      F.pbox(-0.05, 0.05, 0.001, 0.003, -0.05, 0.05, CREAM, 0.95, null, MATTE);
      F.pbox(-0.035, 0.035, 0.003, 0.0034, -0.035, 0.035, '#9a1c22', 0.9, null, MATTE);
    }
  }
}

// The forms gl/room-fittings.js takes whole: drawn from the piece's form alone
export const SALOON_FORMS = Object.freeze({ stools, jukebox });
