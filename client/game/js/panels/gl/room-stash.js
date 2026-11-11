// GLASS 2 · A HABIT ON THE TABLE, AND THE LACQUERED BOX'S LID. What a resident sat at a table with their habit
// has laid out in front of them (plugins/roomstage/npc-life.js sends `stash`, client/shared/table-stash.js
// keeps its clock): lines on a mirror, a dish of pills, a pipe and a bag, a spoon and rigs, a row of cans, a
// bottle. The kit goes down one at a time as they work through it, on the same clock as the clips, so the
// line goes as the head comes up. And the lid of any lacquered box in the room (gl/room-fittings.js
// `lacquer`), hinged at its back, lifted while its card is up.
//
// Posed every frame into the room's props layer after gl/room-meals.js, into the same batch. Nothing here is
// in the room's own mesh: the kit goes when they get up.

import { vtx, lin, cylinder, ellipsoid, MAT } from './ballpark-mesh.js';
import { FIGURE_BONE } from '../figure.js';
import { facing, LACQUER_BODY } from '../../../../shared/room-layout.js';

const TAU = Math.PI * 2;
const C = (h) => lin(h);
const MIRROR = C('#9aa8b4'), POWDER = C('#f4f2ee'), CARD = C('#2a5ac8'), NOTE = C('#7a9a6a'), STEEL = C('#b8bcc0'), BLACK = C('#141416');
const GLASSW = C('#cfe4ec'), WATER = C('#a8d0e0'), PILL = C('#e8e8f0'), PILL2 = C('#3a6ad8'), ROCK = C('#e8dcc0'), BAG = C('#dce4e8'), TIE = C('#2a2a30');
const CAN = C('#c83a2a'), CAN2 = C('#c8ccd0'), RAG = C('#b8a888'), BOTTLE = C('#3a5a2a'), AMBER = C('#a8641e'), LACQ = C('#0c0b0d'), BRASS = C('#b8924a'), CARDIN = C('#e8e0c8');

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
// a triangle whose normal faces away from `mid` (the middle of what it's a face of), wound to match
function tri(b, a, c, d, col, mat, mid) {
  let n = unit(cross(sub(c, a), sub(d, a)));
  const out = sub(a, mid);
  if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) { n = n.map((x) => -x); [c, d] = [d, c]; }
  vtx(b, a, n, [0, 0], col, mat); vtx(b, c, n, [1, 0], col, mat); vtx(b, d, n, [1, 1], col, mat);
}
function face(b, a, c, d, e, col, mat, mid) { tri(b, a, c, d, col, mat, mid); tri(b, a, d, e, col, mat, mid); }
// A box from its eight corners, in the order a frame's (±x, ±y, ±z) gives them: [x0y0z0, x1y0z0, x1y1z0, x0y1z0, x0y0z1, x1y0z1, x1y1z1, x0y1z1].
function hull(b, k, col, mat) {
  const mid = [0, 1, 2].map((i) => k.reduce((s, p) => s + p[i], 0) / 8);
  face(b, k[4], k[5], k[6], k[7], col, mat, mid); face(b, k[1], k[0], k[3], k[2], col, mat, mid);
  face(b, k[3], k[7], k[6], k[2], col, mat, mid); face(b, k[0], k[1], k[5], k[4], col, mat, mid);
  face(b, k[0], k[4], k[7], k[3], col, mat, mid); face(b, k[5], k[1], k[2], k[6], col, mat, mid);
}
// A box in a frame W(x, y, z): [x0, x1] × [y0, y1] × [z0, z1].
const fbox = (b, W, x0, x1, y0, y1, z0, z1, col, mat) => hull(b, [W(x0, y0, z0), W(x1, y0, z0), W(x1, y1, z0), W(x0, y1, z0), W(x0, y0, z1), W(x1, y0, z1), W(x1, y1, z1), W(x0, y1, z1)], col, mat);
// A rod from A to B, square in section, in the world.
function rod(b, A, B, w, col, mat) {
  const f = unit(sub(B, A)), up = Math.abs(f[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0], s = unit(cross(f, up)), u = cross(s, f);
  const c = (P, i, j) => [P[0] + (s[0] * i + u[0] * j) * w, P[1] + (s[1] * i + u[1] * j) * w, P[2] + (s[2] * i + u[2] * j) * w];
  hull(b, [c(A, -1, -1), c(A, 1, -1), c(A, 1, 1), c(A, -1, 1), c(B, -1, -1), c(B, 1, -1), c(B, 1, 1), c(B, -1, 1)], col, mat);
}
const seeded = (s) => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return () => { h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0; return ((h ^ (h >>> 14)) >>> 0) / 4294967296; }; };

// Where a palm is, from the posed rows (gl/room-people.js figurePeople), as gl/room-meals.js reads it.
const PALM = { L: [FIGURE_BONE.handL, [0.195, 0.77, 0.01]], R: [FIGURE_BONE.handR, [-0.195, 0.77, 0.01]] };
function palmOf(rec, side = 'R', pt = null) {
  const [bone, p0] = PALM[side], m = rec.rows, o = bone * 12, [x, y, z] = pt || p0;
  return [0, 1, 2].map((r) => m[o + r * 4] * x + m[o + r * 4 + 1] * y + m[o + r * 4 + 2] * z + m[o + r * 4 + 3]);
}

// The table's frame for one sitter: x to their right, z away from them over the top, y up, at `at`.
function tableFrame(L, at, dir) {
  const [u, v, y] = at, d = unit([dir[0], dir[1], 0]), r = [-d[1], d[0]];
  return (x, yy, z) => L.world(u + r[0] * x + d[0] * z, v + r[1] * x + d[1] * z, y + yy);
}

// One kit, worked down: `s` the session ({ k, of }), `now` table-stash.js stashAt's answer.
function kit(b, L, s, now, W, rec, seed) {
  const R = seeded(seed), of = Math.max(1, s.of | 0), left = Math.max(0, now.left), taking = !now.done && now.set, p = now.phase;
  const pt = (x, y, z) => W(x, y, z);
  if (s.k === 'snort') {
    // a mirror, a pile going down as it's cut, the lines cut and not yet taken, a card, a rolled note
    fbox(b, W, -0.12, 0.12, 0, 0.006, -0.08, 0.1, MIRROR, MAT.GLOSS);
    fbox(b, W, -0.122, 0.122, 0, 0.004, -0.082, 0.102, BLACK, MAT.SATIN);
    const cut = now.done ? of : Math.min(of, now.i + (now.set ? 1 : p)), pile = 1 - cut / of;
    if (pile > 0.02) ellipsoid(b, pt(0.07, 0.006 + 0.004 * pile, 0.05), [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0.035 * Math.sqrt(pile), 0.012 * pile + 0.003, 0.03 * Math.sqrt(pile)], 5, 10, POWDER, MAT.MATTE);
    const taken = of - left, whole = Math.floor(cut) - taken;
    for (let i = 0; i < Math.max(0, whole); i++) { const z = -0.055 + (taken + i) * 0.026; fbox(b, W, -0.08, 0.04, 0.006, 0.01, z, z + 0.009, POWDER, MAT.MATTE); }
    if (!now.set && !now.done) { const z = -0.055 + Math.floor(cut) * 0.026, l = 0.12 * (cut % 1); if (l > 0.005) fbox(b, W, -0.08, -0.08 + l, 0.006, 0.01, z, z + 0.009, POWDER, MAT.MATTE); }
    // the card chops while they cut, and lies by the mirror otherwise
    const cx = !now.set && !now.done ? 0.01 + 0.025 * Math.sin(p * TAU * 7) : 0.15;
    fbox(b, W, cx - 0.027, cx + 0.027, 0.0065, 0.0085, -0.02, 0.023, CARD, MAT.GLOSS);
    if (taking && rec) { const a = palmOf(rec, 'R', [-0.195, 0.83, 0.0]), e = palmOf(rec, 'R', [-0.195, 0.71, 0.03]); rod(b, a, e, 0.0045, NOTE, MAT.SATIN); }
    else rod(b, pt(-0.16, 0.005, -0.04), pt(-0.16, 0.005, 0.04), 0.0045, NOTE, MAT.SATIN);
  } else if (s.k === 'swallow') {
    cylinder(b, pt(0, 0, 0.04), 0.014, 0.06, C('#e8e4da'), MAT.GLOSS, 20);
    for (let i = 0; i < left; i++) { const a = R() * TAU, r = Math.sqrt(R()) * 0.04; ellipsoid(b, pt(Math.cos(a) * r, 0.018, 0.04 + Math.sin(a) * r), [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0.006, 0.0035, 0.004], 4, 8, i % 3 ? PILL : PILL2, MAT.GLOSS); }
    const full = 0.25 + 0.75 * left / of;
    cylinder(b, pt(0.13, 0, -0.02), 0.11 * full, 0.028, WATER, MAT.GLOSS, 16);
    cylinder(b, pt(0.13, 0, -0.02), 0.11, 0.031, GLASSW, MAT.GLOSS, 16);
  } else if (s.k === 'smoke') {
    // a bag with what's left in it, a lighter, an ashtray, and the pipe on the table or in the hand
    fbox(b, W, -0.04, 0.04, 0, 0.004, 0.02, 0.09, BAG, MAT.GLOSS);
    for (let i = 0; i < left; i++) ellipsoid(b, pt(-0.025 + (i % 3) * 0.022, 0.008, 0.035 + Math.floor(i / 3) * 0.02), [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0.007, 0.005, 0.006], 4, 6, ROCK, MAT.SATIN);
    cylinder(b, pt(0.15, 0, 0.05), 0.012, 0.045, C('#3a3a40'), MAT.METAL, 16);
    const lighter = now.set && !now.done && rec ? palmOf(rec, 'L') : pt(0.08, 0.012, -0.03);
    fbox(b, (x, y, z) => [lighter[0] + x, lighter[1] + y, lighter[2] + z], -0.01, 0.01, -0.02, 0.02, -0.006, 0.006, C('#d84a2a'), MAT.GLOSS);
    const [a, e] = taking && rec ? [palmOf(rec, 'R', [-0.195, 0.8, 0.0]), palmOf(rec, 'R', [-0.195, 0.66, 0.03])] : [pt(-0.15, 0.008, -0.05), pt(-0.15, 0.008, 0.06)];
    rod(b, a, e, 0.004, GLASSW, MAT.GLOSS);
    ellipsoid(b, e, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0.012, 0.012, 0.012], 5, 8, GLASSW, MAT.GLOSS);
  } else if (s.k === 'inject') {
    // a spoon and a lighter under it while they cook, a tie, and the rigs left laid in a row
    const spoon = !now.set && !now.done && rec ? palmOf(rec, 'L') : pt(0.02, 0.006, 0.04);
    ellipsoid(b, spoon, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0.017, 0.005, 0.022], 4, 10, STEEL, MAT.METAL);
    rod(b, spoon, [spoon[0] + 0.0, spoon[1] + 0.004, spoon[2] + 0.08], 0.003, STEEL, MAT.METAL);
    fbox(b, W, 0.09, 0.11, 0, 0.04, -0.03, -0.018, C('#2a8a3a'), MAT.GLOSS);
    rod(b, pt(-0.18, 0.004, -0.06), pt(-0.06, 0.004, 0.08), 0.005, TIE, MAT.SATIN);
    for (let i = 0; i < left - (taking ? 0 : 0); i++) { const x = 0.14 + i * 0.018; rod(b, pt(x, 0.004, -0.05), pt(x, 0.004, 0.04), 0.0035, C('#e8eef2'), MAT.GLOSS); }
    if (taking && rec) { const a = palmOf(rec, 'R', [-0.195, 0.84, 0.0]), e = palmOf(rec, 'R', [-0.195, 0.7, 0.04]); rod(b, a, e, 0.0035, C('#e8eef2'), MAT.GLOSS); }
  } else if (s.k === 'huff') {
    for (let i = 0; i < of; i++) {
      const x = -0.12 + i * 0.06;
      if (i < of - left) { const c = pt(x, 0.025, 0.07); rod(b, [c[0], c[1], c[2]], pt(x + 0.04, 0.025, 0.09), 0.022, CAN2, MAT.METAL); }
      else cylinder(b, pt(x, 0, -0.02), 0.13, 0.026, i % 2 ? CAN : CAN2, MAT.METAL, 14);
    }
    const rag = taking && rec ? palmOf(rec, 'R') : pt(0.16, 0.01, 0.06);
    ellipsoid(b, rag, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0.04, 0.012, 0.035], 4, 8, RAG, MAT.CLOTH);
  } else {
    // a bottle going down, and the glass on the table or in the hand
    const full = left / of;
    cylinder(b, pt(0.12, 0, 0.04), 0.2, 0.037, BOTTLE, MAT.GLOSS, 16);
    cylinder(b, pt(0.12, 0.2, 0.04), 0.08, 0.013, BOTTLE, MAT.GLOSS, 12);
    if (full > 0.02) cylinder(b, pt(0.12, 0.002, 0.04), 0.19 * full, 0.0375, AMBER, MAT.GLOSS, 16);
    const g = taking && rec ? palmOf(rec, 'R') : pt(-0.06, 0, -0.02);
    cylinder(b, g, 0.08, 0.032, GLASSW, MAT.GLOSS, 14);
    cylinder(b, [g[0], g[1] + 0.003, g[2]], 0.035, 0.03, AMBER, MAT.GLOSS, 14);
  }
}

// The lid of a lacquered box: `k` 0 shut to 1 open, about its back edge, with the price card inside it.
function lid(b, L, p, k) {
  const [fu, fv] = facing(p.turn), su = -fv, sv = fu, base = (p.y0 || 0) + (p.rise || 0), hw = p.w / 2, hd = p.d / 2;
  const yb = base + p.h * LACQUER_BODY, lt = p.h * (1 - LACQUER_BODY), a = k * 1.75;
  const ca = Math.cos(a), sa = Math.sin(a);
  // a point on the lid: x across, zz back to front from the hinge, yy up through its thickness
  const W = (x, yy, zz) => { const z = -hd + zz * ca - yy * sa, y = yb + zz * sa + yy * ca; return L.world(p.u + su * x + fu * z, p.v + sv * x + fv * z, y); };
  fbox(b, W, -hw, hw, 0.0045, lt, 0, p.d, LACQ, MAT.GLOSS);
  // a brass edge along its front, where a finger lifts it
  fbox(b, W, -hw * 0.3, hw * 0.3, lt * 0.3, lt * 0.7, p.d, p.d + 0.003, BRASS, MAT.METAL);
  // the price card on its underside, and a brass card slot beside it
  fbox(b, W, -hw * 0.6, hw * 0.35, 0.0015, 0.004, 0.04, p.d - 0.04, CARDIN, MAT.SATIN);
  fbox(b, W, hw * 0.5, hw * 0.8, 0.0015, 0.004, p.d * 0.4, p.d * 0.6, BRASS, MAT.METAL);
}

// Into `b` (gl/room-meals.js mealProps' batch): every sitter's kit, and every lacquered box's lid. `bodies`
// as room-stage.js hands figurePeople, each with its `stash` and `stashAt`; `recs` what that gave back.
export function stashProps(b, L, bodies, recs, t, open = { id: null, k: 0 }) {
  bodies.forEach((body, i) => {
    const s = body.stash, now = body.stashAt, dir = body.seat?.dir;
    if (!s || !now || !dir || !Array.isArray(s.at)) return;
    kit(b, L, s, now, tableFrame(L, s.at, dir), recs[i], body.id);
  });
  for (const p of L.placed || []) if (p.form === 'lacquer') lid(b, L, p, p.id === open.id ? open.k : 0);
  return b;
}
