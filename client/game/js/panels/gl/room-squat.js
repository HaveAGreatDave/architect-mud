// GLASS 2 · A ROOM GONE TO SEED. What a place nobody looks after has on its floor and ceiling: rubbish dropped
// where people finished with it, magazines read to pieces, damp stains on the ceiling, and a leak with a bucket
// under it that drips while it rains. Pure: batches, no GL.
//
// ⚠ IT'S ALL DATA. A room asks for this with keys in `flags.room.decor`; nothing here knows whose room it is:
//   rubbish  [{ at: [u, v], r: [ru, rv], n?, seed? }]   cans, crisp packets, bottles, butts, cartons, newspaper
//   mags     [{ at: [u, v], n?, seed?, turn? }]          a slumped pile of magazines, the top few fanned out
//   damp     [{ at: [u, v], r? }]                        a brown water stain on the ceiling
//   leaks    [{ at: [u, v], catch?: 'bucket'|'pan'|'none', r? }]
//            a stain on the ceiling over something set to catch it, and a wet patch round that. While the
//            weather is rain (precip-look.js precipKind) leaksProps drips it, every frame, on the props layer.
//   torn     [{ wall, along, y?, n?, seed? }]            flyers and posters pasted over each other, torn, some peeling
//   kit      [{ at: [u, v], seed?, turn? }]              what a user leaves: syringes, a burnt spoon, foil, a lighter, a pipe, baggies
//   bags     [{ at: [u, v], n?, seed? }]                 a heap of tied black bin bags, some split
//
// Positions are roomLayout's u and v in metres; y is up from the floor.

import { MAT, box, lin } from './ballpark-mesh.js';
import { precipKind } from '../../../../shared/precip-look.js';
import { FT_M } from '../../../../shared/world-scale.js';

const { GLOSS, METAL, SATIN, MATTE } = MAT;
const TAU = Math.PI * 2;

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const num = (x, d, lo = -Infinity, hi = Infinity) => (Number.isFinite(Number(x)) ? Math.max(lo, Math.min(hi, Number(x))) : d);
const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];
const isAt = (c) => Array.isArray(c?.at) && c.at.length >= 2 && c.at.every(Number.isFinite);

// how high the thing under a leak stands, and how wide it is (metres): the drip lands on its water
export const LEAK_CATCH = Object.freeze({ bucket: { top: 0.27, r: 0.15 }, pan: { top: 0.07, r: 0.2 }, none: { top: 0.002, r: 0.25 } });
const catchOf = (c) => LEAK_CATCH[c?.catch] || LEAK_CATCH.bucket;

// What on the floor somebody would walk into, for room-layout.js decorSolids: a bucket or a pan under a leak
export function squatSolids(dc) {
  const out = [];
  for (const c of [].concat(dc?.leaks || [])) {
    if (!isAt(c) || c.catch === 'none') continue;
    const r = catchOf(c).r + 0.03;
    out.push([c.at[0] - r, c.at[0] + r, c.at[1] - r, c.at[1] + r]);
  }
  return out;
}

export function drawSquatDecor(K, L, dc, ctx) {
  const H = ctx?.H || L.spec?.h || 2.7;
  for (const c of [].concat(dc.rubbish || [])) if (isAt(c)) rubbish(K, c);
  for (const c of [].concat(dc.mags || [])) if (isAt(c)) mags(K, c);
  for (const c of [].concat(dc.damp || [])) if (isAt(c)) stain(K, c.at[0], c.at[1], num(c.r, 0.6, 0.1, 3), H, 0x5a11 + Math.round(c.at[0] * 97 + c.at[1] * 31));
  for (const c of [].concat(dc.leaks || [])) if (isAt(c)) leak(K, c, H);
  for (const c of [].concat(dc.torn || [])) if (c && WALLS.has(c.wall) && Number.isFinite(c.along)) torn(K, L, c);
  for (const c of [].concat(dc.kit || [])) if (isAt(c)) kit(K, c);
  for (const c of [].concat(dc.bags || [])) if (isAt(c)) bags(K, c);
}

// ── TORN POSTERS: layers of paste-ups on a wall, ripped back, a corner or two hanging off ───────────────
const WALLS = new Set(['front', 'back', 'left', 'right']);
const SHEETS = ['#d8d0b4', '#b8a448', '#9a3a30', '#3a5a82', '#b8708a', '#e0d8c4', '#3a3632', '#b8743a', '#c8c0a8'];
function torn(K, L, c) {
  const hu = L.w / 2, D = L.d, a = c.along;
  const [u, v, fu, fv] = c.wall === 'front' ? [a, 0, 0, 1] : c.wall === 'back' ? [a, D, 0, -1] : c.wall === 'left' ? [-hu, a, 1, 0] : [hu, a, -1, 0];
  const F = K.frame(u, v, fu, fv), r = rng(num(c.seed, 1) * 389 + 17), n = Math.round(num(c.n, 6, 1, 30)), y = num(c.y, 1.45, 0.4, 3);
  for (let i = 0; i < n; i++) {
    const w = 0.4 + r() * 0.35, h = w * (1.2 + r() * 0.3), x = (r() - 0.5) * 1.3, yy = y + (r() - 0.5) * 0.5, z = 0.002 + i * 0.0012;
    const hex = pick(r, SHEETS), cut = r();
    // the sheet, with its bottom ripped away where somebody pulled at it, the tear ragged
    const keep = cut < 0.4 ? 0.45 + r() * 0.3 : 1, bot = yy - h / 2 + h * (1 - keep);
    F.pbox(x - w / 2, x + w / 2, bot, yy + h / 2, z, z + 0.001, hex, 0.95, null, MATTE);
    if (keep < 1) for (let j = 0; j < 4; j++) { const sx = x - w / 2 + (j + r()) * w / 4; F.pbox(sx - 0.03, sx + 0.03, bot - 0.02 - r() * 0.05, bot, z, z + 0.001, hex, 0.9, null, MATTE); }
    // its print: a block of colour and a few lines of type, faded
    if (keep > 0.6) {
      F.pbox(x - w * 0.36, x + w * 0.36, yy + h * 0.05, yy + h * 0.38, z + 0.001, z + 0.0016, pick(r, SHEETS), 0.8, null, MATTE);
      for (let j = 0; j < 3; j++) F.pbox(x - w * 0.34, x + w * (0.1 + r() * 0.24), yy - h * 0.1 - j * 0.04, yy - h * 0.1 - j * 0.04 + 0.016, z + 0.001, z + 0.0016, '#2a2622', 0.9, null, MATTE);
    }
    // a corner peeled off the wall and hanging forward
    if (r() < 0.45) { const sd = r() < 0.5 ? -1 : 1, ex = x + sd * w / 2; F.pbox(Math.min(ex, ex - sd * 0.12), Math.max(ex, ex - sd * 0.12), yy + h / 2 - 0.14, yy + h / 2 - 0.02, z + 0.01, z + 0.03, '#d8d0bc', 0.75, null, MATTE); }
    // tape at the top corners, gone yellow
    if (r() < 0.5) for (const sx of [-1, 1]) F.pbox(x + sx * w / 2 - 0.025, x + sx * w / 2 + 0.025, yy + h / 2 - 0.02, yy + h / 2 + 0.015, z + 0.0015, z + 0.002, '#c8b070', 0.9, null, GLOSS);
  }
}

// ── A USER'S KIT, left where they sat: syringes, a spoon burnt black, foil, a lighter, a pipe, baggies ────
function kit(K, c) {
  const [u, v] = c.at, r = rng(num(c.seed, 2) * 733 + 5), b = num(c.turn, r() * 360) * Math.PI / 180;
  const at = (dx, dz, t) => { const ca = Math.cos(b), sa = Math.sin(b), a = b + t; return K.frame(u + ca * dx - sa * dz, v + sa * dx + ca * dz, Math.cos(a), Math.sin(a)); };
  // two or three syringes, orange caps off
  const ns = 2 + Math.floor(r() * 2);
  for (let i = 0; i < ns; i++) {
    const F = at((r() - 0.5) * 0.35, (r() - 0.5) * 0.3, r() * TAU);
    F.pbox(-0.045, 0.035, 0, 0.012, -0.006, 0.006, '#e8eef0', 1, null, GLOSS);
    F.pbox(0.035, 0.05, 0.002, 0.01, -0.004, 0.004, '#e86a1a', 1, null, GLOSS);
    F.pbox(0.05, 0.075, 0.005, 0.007, -0.001, 0.001, '#c0c4c8', 1, null, METAL);
    F.pbox(-0.06, -0.045, 0, 0.016, -0.009, 0.009, '#e8eef0', 1, null, GLOSS);
  }
  // a spoon with its bowl burnt black
  { const F = at(0.1, -0.08, r() * TAU); F.pbox(-0.07, 0.02, 0, 0.004, -0.007, 0.007, '#b0b4b8', 1, null, METAL); F.pbox(0.02, 0.06, 0, 0.008, -0.02, 0.02, '#2a2420', 1, null, METAL); }
  // a square of foil, crumpled, with a brown run down it
  { const F = at(-0.12, 0.1, r() * TAU); F.pbox(-0.07, 0.07, 0, 0.003, -0.05, 0.05, '#c8ccd0', 1.05, null, METAL); F.pbox(-0.05, 0.04, 0.003, 0.0034, -0.006, 0.006, '#5a3412', 1, null, MATTE); }
  // a disposable lighter
  { const F = at(0.16, 0.08, r() * TAU); F.pbox(-0.04, 0.04, 0, 0.012, -0.012, 0.012, pick(r, ['#c8202a', '#2a6ac8', '#e8c020', '#3aa848']), 1, null, GLOSS); F.pbox(0.03, 0.045, 0.002, 0.014, -0.01, 0.01, '#9ea4a8', 1, null, METAL); }
  // a glass pipe, the bowl smoked brown
  { const F = at(-0.04, -0.14, r() * TAU); F.pbox(-0.08, 0.04, 0.004, 0.012, -0.004, 0.004, '#d8e4e8', 1, null, GLOSS); const [pu, pv] = F.P(0.055, 0, 0); K.lathe(pu, pv, [[0, 0], [0.012, 0.002], [0.016, 0.014], [0.012, 0.024], [0, 0.024]], '#6a4a2a', 0.9, 10, GLOSS); }
  // little zip bags, emptied
  for (let i = 0; i < 4; i++) { const F = at((r() - 0.5) * 0.45, (r() - 0.5) * 0.4, r() * TAU); F.pbox(-0.02, 0.02, 0, 0.002, -0.025, 0.025, '#e4ecee', 0.9, null, GLOSS); F.pbox(-0.02, 0.02, 0.002, 0.0026, 0.018, 0.022, pick(r, ['#c8202a', '#2a6ac8', '#1a1a1a']), 1, null, GLOSS); }
  // a belt for tying off, left lying
  { const F = at(0.02, 0.18, r() * TAU); F.pbox(-0.16, 0.16, 0, 0.005, -0.016, 0.016, '#3a2418', 1, null, SATIN); F.pbox(0.16, 0.2, 0, 0.008, -0.02, 0.02, '#a8a090', 1, null, METAL); }
}

// ── BIN BAGS, heaped where the last person gave up carrying them down ─────────────────────────────────
function bags(K, c) {
  const [u, v] = c.at, n = Math.round(num(c.n, 4, 1, 16)), r = rng(num(c.seed, 3) * 457 + 3);
  for (let i = 0; i < n; i++) {
    const a = r() * TAU, d = Math.sqrt(r()) * 0.35, x = u + Math.cos(a) * d, z = v + Math.sin(a) * d, s = 0.28 + r() * 0.1, y0 = i > 2 && r() < 0.6 ? s * 0.5 : 0;
    const hex = r() < 0.8 ? '#141517' : '#2a3a5a';
    K.lathe(x, z, [[0, y0], [s * 0.95, y0 + 0.02], [s * 1.1, y0 + s * 0.4], [s * 0.85, y0 + s * 0.85], [0.05, y0 + s * 1.05], [0.06, y0 + s * 1.22], [0, y0 + s * 1.25]], hex, 1, 7, SATIN);
    // a split one has let a can roll out of the tear
    if (r() < 0.35) { const F = K.frame(x + Math.cos(a) * s * 1.2, z + Math.sin(a) * s * 1.2, Math.cos(a), Math.sin(a)); F.pbox(-0.06, 0.06, 0, 0.066, -0.033, 0.033, pick(r, CANS), 0.8, null, METAL); }
  }
}

// ── A STAIN on the ceiling: rings of brown laid one inside another, darker at the tide line ───────────
function stain(K, u, v, R, H, seed) {
  const r = rng(seed), n = 5;
  for (let i = 0; i < n; i++) {
    const s = R * (1 - i / n), du = (r() - 0.5) * R * 0.25, dv = (r() - 0.5) * R * 0.25, el = 0.7 + r() * 0.5;
    const hex = i === 0 ? '#6a4e2a' : i % 2 ? '#8a7048' : '#7a5e36';
    // a few overlapping round patches at odd sizes and offsets, so the edge is lobed rather than a circle
    for (let j = 0; j < 4; j++) {
      const cu = u + du + (r() - 0.5) * s * 0.6, cv = v + dv + (r() - 0.5) * s * 0.6 * el, rr = s * (0.4 + r() * 0.25);
      const y = H - 0.004 - i * 0.0006;
      K.lathe(cu, cv, [[0, y - 0.0005], [rr, y - 0.0005], [rr, y], [0, y]], hex, 0.55 + i * 0.05, 16, MATTE);
    }
  }
}

// ── A LEAK: the stain, what's set under it, and the wet round that ────────────────────────────────────
function leak(K, c, H) {
  const [u, v] = c.at, C = catchOf(c), seed = 0x1eac + Math.round(u * 131 + v * 71);
  stain(K, u, v, num(c.r, 0.5, 0.15, 2), H, seed);
  // the wet on the floor: a dark sheen, wider than what catches it, for the splashes that miss
  const wet = C.r + 0.22;
  K.lathe(u, v, [[0, 0.0015], [wet, 0.0015], [wet, 0.0025], [0, 0.0025]], '#2a2a2e', 0.6, 20, GLOSS);
  if (c.catch === 'none') return;
  if (c.catch === 'pan') {
    // a roasting tin, enamel chipped black at the rim
    K.box(u - C.r, u + C.r, v - C.r * 0.7, v + C.r * 0.7, 0.003, C.top, '#d8d4c8', 0.9, null, GLOSS);
    K.box(u - C.r + 0.015, u + C.r - 0.015, v - C.r * 0.7 + 0.015, v + C.r * 0.7 - 0.015, C.top - 0.03, C.top - 0.012, '#5a6a72', 0.8, null, GLOSS);
    return;
  }
  // a galvanised bucket, a bail handle laid over, and the water three-quarters up it
  const r0 = C.r * 0.8, r1 = C.r, t = C.top;
  K.lathe(u, v, [[0, 0.004], [r0, 0.004], [r1, t], [r1 - 0.008, t], [r0 - 0.008, 0.012], [0, 0.012]], '#8e9498', 1, 18, METAL);
  K.lathe(u, v, [[0, t * 0.72], [r0 + (r1 - r0) * 0.72 - 0.01, t * 0.72], [r0 + (r1 - r0) * 0.72 - 0.01, t * 0.73], [0, t * 0.73]], '#4a5a62', 0.85, 18, GLOSS);
  K.box(u - r1, u - r1 + 0.012, v - 0.01, v + 0.01, t - 0.04, t + 0.01, '#6a7074', 1, null, METAL);
  K.box(u + r1 - 0.012, u + r1, v - 0.01, v + 0.01, t - 0.04, t + 0.01, '#6a7074', 1, null, METAL);
  K.box(u - r1, u + r1, v + 0.02, v + 0.03, t + 0.004, t + 0.012, '#6a7074', 1, null, METAL);
}

// ── RUBBISH, where it was dropped ───────────────────────────────────────────────────────────────────
const CANS = ['#b8222a', '#1a5aa8', '#e8c020', '#2a8a3a', '#c0c4c8', '#e86a1a'];
const PACKETS = ['#e8c020', '#c82a2a', '#2a6ac8', '#3aa848', '#8a2ac8', '#e8e4d8'];
function rubbish(K, c) {
  const [u, v] = c.at, [ru, rv] = Array.isArray(c.r) ? c.r : [1, 0.6], n = Math.round(num(c.n, 14, 0, 120)), r = rng(num(c.seed, 3) * 977 + 11);
  for (let i = 0; i < n; i++) {
    const a = r() * TAU, d = Math.sqrt(r()), x = u + Math.cos(a) * d * ru, z = v + Math.sin(a) * d * rv, b = r() * TAU, kind = r();
    const F = K.frame(x, z, Math.cos(b), Math.sin(b));
    if (kind < 0.24) {
      // a drinks can on its side, some of them stood on
      const flat = r() < 0.35 ? 0.45 : 1, hex = pick(r, CANS);
      F.pbox(-0.06, 0.06, 0, 0.066 * flat, -0.033, 0.033, hex, 1, null, METAL);
      F.pbox(0.06, 0.066, 0.008, 0.058 * flat, -0.028, 0.028, '#c0c4c8', 1, null, METAL);
    } else if (kind < 0.42) {
      // a crisp packet, crumpled flat
      const hex = pick(r, PACKETS);
      F.pbox(-0.08, 0.08, 0, 0.012, -0.06, 0.06, hex, 1, null, GLOSS);
      F.pbox(-0.05, 0.02, 0.012, 0.022, -0.04, 0.03, hex, 0.85, null, GLOSS);
    } else if (kind < 0.54) {
      // a bottle, lying down, green or brown
      const hex = r() < 0.5 ? '#2e5a2a' : '#5a3412';
      F.pbox(-0.1, 0.06, 0, 0.07, -0.035, 0.035, hex, 1, null, GLOSS);
      F.pbox(0.06, 0.13, 0.02, 0.05, -0.014, 0.014, hex, 1, null, GLOSS);
    } else if (kind < 0.72) {
      // fag ends, a few together where somebody sat
      for (let j = 0; j < 3; j++) {
        const ox = (r() - 0.5) * 0.12, oz = (r() - 0.5) * 0.12;
        F.pbox(ox - 0.016, ox + 0.016, 0, 0.008, oz - 0.004, oz + 0.004, j ? '#efe8dc' : '#d9a86a', 1, null, MATTE);
      }
    } else if (kind < 0.84) {
      // a takeaway carton, the lid half open
      F.pbox(-0.1, 0.1, 0, 0.05, -0.08, 0.08, '#e8e4d8', 1, null, MATTE);
      F.pbox(-0.1, 0.1, 0.05, 0.056, 0.08, 0.2, '#e0dccc', 1, null, MATTE);
      F.pbox(-0.07, 0.04, 0.05, 0.056, -0.05, 0.04, '#a8541a', 0.8, null, GLOSS);
    } else if (kind < 0.89) {
      // a sheet of newspaper, folded open on the floor
      F.pbox(-0.19, 0.19, 0, 0.003, -0.14, 0.14, '#b8b096', 0.8, null, MATTE);
      for (let j = 0; j < 4; j++) F.pbox(-0.16, 0.04, 0.003, 0.0034, -0.1 + j * 0.055, -0.08 + j * 0.055, '#5a564e', 0.9, null, MATTE);
    } else {
      // a black bag, tied, that never made it down the stairs
      const s = 0.18 + r() * 0.06;
      K.lathe(x, z, [[0, 0], [s * 0.8, 0.02], [s, s * 0.6], [s * 0.7, s * 1.2], [0.03, s * 1.45], [0.04, s * 1.6], [0, s * 1.62]], '#151618', 1, 10, GLOSS);
    }
  }
}

// ── MAGAZINES, read to pieces ─────────────────────────────────────────────────────────────────────────
const COVERS = ['#c8202a', '#e8d020', '#1a6ac8', '#e85a9a', '#2a2a2a', '#3aa858', '#e8e4dc', '#e86a1a'];
function mags(K, c) {
  const [u, v] = c.at, n = Math.round(num(c.n, 8, 1, 40)), r = rng(num(c.seed, 5) * 613 + 29), base = num(c.turn, r() * 360) * Math.PI / 180;
  const T = 0.006, W = 0.21, D = 0.28;
  // the pile slumps: each one a little off the one below
  let du = 0, dv = 0;
  const pile = Math.max(1, n - 3);
  for (let i = 0; i < pile; i++) {
    du += (r() - 0.5) * 0.03; dv += (r() - 0.5) * 0.03;
    const b = base + (r() - 0.5) * 0.5, F = K.frame(u + du, v + dv, Math.cos(b), Math.sin(b));
    F.pbox(-W / 2, W / 2, i * T, (i + 1) * T - 0.0005, -D / 2, D / 2, pick(r, COVERS), 0.9 + r() * 0.15, null, SATIN);
    // the page edges show along one side
    F.pbox(-W / 2 + 0.003, W / 2 - 0.003, i * T + 0.0008, (i + 1) * T - 0.0012, D / 2, D / 2 + 0.001, '#ece6d6', 1, null, MATTE);
  }
  // and the last few slid off it, fanned across the floor, one open on its spine
  for (let i = 0; i < n - pile; i++) {
    const a = base + (r() - 0.5) * 2, d = 0.24 + r() * 0.25, x = u + Math.cos(a) * d, z = v + Math.sin(a) * d, b = r() * TAU;
    const F = K.frame(x, z, Math.cos(b), Math.sin(b)), hex = pick(r, COVERS);
    if (i === 0) {
      // open: two pages either side of the spine, a block of print and a picture on each
      F.pbox(-W, 0, 0, 0.003, -D / 2, D / 2, '#ece6d6', 1, null, MATTE);
      F.pbox(0, W, 0, 0.003, -D / 2, D / 2, '#ece6d6', 1, null, MATTE);
      F.pbox(-W + 0.02, -0.02, 0.003, 0.0034, 0.0, D / 2 - 0.02, pick(r, COVERS), 0.8, null, MATTE);
      for (let j = 0; j < 5; j++) F.pbox(0.02, W - 0.02, 0.003, 0.0034, -D / 2 + 0.02 + j * 0.045, -D / 2 + 0.035 + j * 0.045, '#5a564e', 1, null, MATTE);
    } else {
      F.pbox(-W / 2, W / 2, 0, T, -D / 2, D / 2, hex, 0.9, null, SATIN);
      // the masthead, a band of colour across the top of the cover
      F.pbox(-W / 2 + 0.01, W / 2 - 0.01, T, T + 0.0005, D / 2 - 0.055, D / 2 - 0.012, hex === '#e8e4dc' ? '#c8202a' : '#f2eee4', 1, null, SATIN);
    }
  }
}

// ── THE DRIP, while it rains (posed every frame into the room's props layer, gl/room.js setProps) ────
const WATER = lin('#cfe4f2'), SPLASH = lin('#e8f2fa');
const PERIOD = 0.85;
const hash = (i, salt = 0) => { const s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453; return s - Math.floor(s); };
const unitsPerM = (L) => (L.ft || FT_M) / FT_M;

// Whether a room has a leak and it's raining: `wx` is the weather word (room-stage.js liveWx)
export function leaksLive(L, wx) {
  const ls = L?.spec?.decor?.leaks;
  return !!(Array.isArray(ls) && ls.length && precipKind(wx) === 'rain');
}

export function leaksProps(b, L, t) {
  const ls = L?.spec?.decor?.leaks, H = L?.spec?.h || 2.7, k = unitsPerM(L);
  if (!Array.isArray(ls)) return b;
  ls.forEach((c, i) => {
    if (!isAt(c)) return;
    const [u, v] = c.at, C = catchOf(c), fall = H - C.top;
    // two drops on the go a little apart, each on its own clock, so the leaks don't drip in step
    for (let j = 0; j < 2; j++) {
      const per = PERIOD * (0.8 + hash(i, 3) * 0.6) * (j ? 1.7 : 1), ph = ((t + hash(i, 5 + j) * per) / per) % 1;
      // it gathers on the ceiling for the first part of its clock, then falls under gravity
      const hang = 0.45, y = ph < hang ? H - 0.01 - (ph / hang) * 0.012 : Math.max(C.top, H - 0.022 - 4.9 * ((ph - hang) * per) ** 2);
      const s = ph < hang ? 0.005 + (ph / hang) * 0.005 : 0.008;
      if (y > C.top + 0.005) box(b, L.world(u * k, v * k, y * k), [s * k, (ph < hang ? s : s * 2.2) * k, s * k], 0, WATER, GLOSS);
      // where it lands: a ring spreading on the water, and a few flecks thrown up
      const landed = ph >= hang && H - 0.022 - 4.9 * ((ph - hang) * per) ** 2 <= C.top;
      if (landed) {
        const since = ((ph - hang) * per) - Math.sqrt((fall - 0.022) / 4.9), q = Math.min(1, since / 0.35);
        const rr = (0.01 + q * C.r * 0.7);
        for (let a = 0; a < 8; a++) {
          const ang = a / 8 * TAU;
          box(b, L.world((u + Math.cos(ang) * rr) * k, (v + Math.sin(ang) * rr) * k, (C.top + 0.002) * k), [0.006 * k, 0.0012 * k, 0.006 * k], 0, SPLASH, GLOSS);
        }
        if (q < 0.4) for (let a = 0; a < 3; a++) {
          const ang = hash(i * 7 + a, 9) * TAU, d = q * 0.06;
          box(b, L.world((u + Math.cos(ang) * d) * k, (v + Math.sin(ang) * d) * k, (C.top + q * 0.05 * (1 - q)) * k * 1), [0.003 * k, 0.003 * k, 0.003 * k], 0, SPLASH, GLOSS);
        }
      }
    }
  });
  return b;
}
