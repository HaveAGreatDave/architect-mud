// GLASS 2 · MEALS IN A ROOM. What a resident cooking or eating has in front of them or in their hand
// (plugins/roomstage/npc-life.js sends it as `meal`, client/shared/home-meals.js says what the dish is):
// a pan on the hob, a camping stove on the floor with its pan and its flame, a packet carried from the
// fridge, and the plate, bowl or tin they eat from. Posed every frame into the room's props layer
// (gl/room.js setProps), the held things off the hand bone of the figure gl/room-people.js posed.
//
// Nothing here is in the room's own mesh: the stove goes when the meal is over.

import { createBatch, vtx, lin, box, cylinder, ellipsoid, grid, MAT } from './ballpark-mesh.js';
import { FIGURE_BONE } from '../figure.js';
import { dishOf } from '../../../../shared/home-meals.js';

const UNLIT = 40;
const UP = [0, 1, 0], DOWN = [0, -1, 0];
const STEEL = lin('#8e9296'), IRON = lin('#2a2b2e'), BLACK = lin('#151517'), CERAMIC = lin('#e8e4da'), ENAMEL = lin('#c8d4dc');
const CAN = lin('#c03a2a'), CARD = lin('#d8c8a0'), BRASS = lin('#a08440');

function seeded(s) {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0; h ^= h + Math.imul(h ^ (h >>> 7), 61); return ((h ^ (h >>> 14)) >>> 0) / 4294967296; };
}
// a flat disc facing up (or down)
function disc(b, c, r, col, mat, n = UP, segs = 18) {
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
    const p0 = [c[0] + Math.sin(a0) * r, c[1], c[2] + Math.cos(a0) * r], p1 = [c[0] + Math.sin(a1) * r, c[1], c[2] + Math.cos(a1) * r];
    if (n[1] > 0) { vtx(b, c, n, [0.5, 0.5], col, mat); vtx(b, p0, n, [0, 0], col, mat); vtx(b, p1, n, [1, 0], col, mat); }
    else { vtx(b, c, n, [0.5, 0.5], col, mat); vtx(b, p1, n, [1, 0], col, mat); vtx(b, p0, n, [0, 0], col, mat); }
  }
}
// an open bowl, round-bottomed: `r` across the rim, `d` deep, its rim at c + d
function dish(b, c, r, d, col, mat, segs = 16) {
  grid(b, 5, segs, (i, j) => {
    const th = (i / 4) * Math.PI / 2, a = (j / segs) * Math.PI * 2, rr = r * Math.sin(th) + 0.004;
    return [c[0] + Math.sin(a) * rr, c[1] + d - d * Math.cos(th), c[2] + Math.cos(a) * rr];
  }, { col, mat, flip: true });
}
// a handle straight out from c along the yaw, `l` long
function handle(b, c, yaw, l, col) {
  box(b, [c[0] + Math.sin(yaw) * l / 2, c[1], c[2] + Math.cos(yaw) * l / 2], [0.012, 0.008, l / 2], (yaw * 180) / Math.PI, col, MAT.SATIN);
}
// The food: its first colour as the surface, and lumps of the others over it, more for a lumpier dish.
// `full` 0..1 is how much is left.
function food(b, c, r, d, seed, full = 1) {
  if (full <= 0.02) return;
  const R = seeded(d.id + seed), cols = d.food.map(lin), rr = r * (0.6 + 0.4 * full);
  // a domed surface rather than a flat one, a little darker at its edge
  grid(b, 4, 24, (i, j) => { const a = (j / 24) * Math.PI * 2, k = 1 - i / 3, r = rr * Math.max(0.02, k); return [c[0] + Math.sin(a) * r, c[1] + 0.012 * full * (1 - k * k), c[2] + Math.cos(a) * r]; },
    { col: (p) => { const e = Math.hypot(p[0] - c[0], p[2] - c[2]) / rr; return cols[0].map((v) => v * (1 - 0.25 * e)); }, mat: MAT.SATIN, flip: true });
  // flecks of the garnish over it
  for (let i = 0; i < 10 * full; i++) {
    const a = R() * Math.PI * 2, at = Math.sqrt(R()) * rr * 0.85;
    box(b, [c[0] + Math.sin(a) * at, c[1] + 0.013 * full, c[2] + Math.cos(a) * at], [0.004, 0.0015, 0.003], R() * 180, cols[cols.length - 1], MAT.SATIN);
  }
  const n = Math.round((5 + 22 * d.bits) * full);
  for (let i = 0; i < n; i++) {
    const a = R() * Math.PI * 2, at = Math.sqrt(R()) * rr * 0.8, s = 0.008 + 0.014 * d.bits * (0.6 + R());
    const col = cols[1 + (i % Math.max(1, cols.length - 1))] || cols[0];
    ellipsoid(b, [c[0] + Math.sin(a) * at, c[1] + s * 0.3 + 0.01 * full * (1 - (at / rr) ** 2), c[2] + Math.cos(a) * at], [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [s, s * 0.6, s * (0.8 + 0.5 * R())], 5, 8, col, MAT.SATIN);
  }
}

// a flat ring facing up, r0 to r1 across, at height c
function ring(b, c, r0, r1, col, mat, segs = 28) {
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
    const P = (a, r) => [c[0] + Math.sin(a) * r, c[1], c[2] + Math.cos(a) * r];
    vtx(b, P(a0, r0), UP, [0, 0], col, mat); vtx(b, P(a0, r1), UP, [0, 1], col, mat); vtx(b, P(a1, r1), UP, [1, 1], col, mat);
    vtx(b, P(a0, r0), UP, [0, 0], col, mat); vtx(b, P(a1, r1), UP, [1, 1], col, mat); vtx(b, P(a1, r0), UP, [1, 0], col, mat);
  }
}
// a thin rod from A to B, square in section
function stick(b, A, B, w, col, mat) {
  const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], l = Math.hypot(...d) || 1, f = d.map((x) => x / l);
  // two sides square to the rod, then its four faces between them
  const up = Math.abs(f[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const cr = (a, c) => [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]];
  const nz = (v) => { const k = Math.hypot(...v) || 1; return v.map((x) => x / k); };
  const s = nz(cr(f, up)), u = cr(s, f);
  const corner = (P, i) => { const a = (i / 4) * Math.PI * 2 + Math.PI / 4, cs = Math.cos(a) * w * 1.41, sn = Math.sin(a) * w * 1.41; return [P[0] + s[0] * cs + u[0] * sn, P[1] + s[1] * cs + u[1] * sn, P[2] + s[2] * cs + u[2] * sn]; };
  for (let i = 0; i < 4; i++) {
    const a = (((i + 0.5) / 4) * Math.PI * 2) + Math.PI / 4, n = nz([s[0] * Math.cos(a) + u[0] * Math.sin(a), s[1] * Math.cos(a) + u[1] * Math.sin(a), s[2] * Math.cos(a) + u[2] * Math.sin(a)]);
    const p0 = corner(A, i), p1 = corner(B, i), p2 = corner(B, i + 1), p3 = corner(A, i + 1);
    vtx(b, p0, n, [0, 0], col, mat); vtx(b, p1, n, [0, 1], col, mat); vtx(b, p2, n, [1, 1], col, mat);
    vtx(b, p0, n, [0, 0], col, mat); vtx(b, p2, n, [1, 1], col, mat); vtx(b, p3, n, [1, 0], col, mat);
  }
}
const WOOD = lin('#8a6038'), SPOON = lin('#b8bcc0');
// What it's cooked in, its base at c. `cooking` puts the food in it, and a spoon or a spatula, going round.
function cookware(b, kind, c, yaw, d, seed, cooking, t = 0) {
  const stir = (y, r) => {
    if (!cooking) return;
    const a = t * 2.4 + seeded(seed)() * 6, p = [c[0] + Math.sin(a) * r * 0.45, c[1] + y, c[2] + Math.cos(a) * r * 0.45];
    stick(b, p, [p[0] + Math.sin(a + 0.6) * 0.06, p[1] + 0.2, p[2] + Math.cos(a + 0.6) * 0.06], 0.005, WOOD, MAT.SATIN);
    ellipsoid(b, p, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0.02, 0.006, 0.026], 4, 8, WOOD, MAT.SATIN);
  };
  if (kind === 'pot') {
    cylinder(b, c, 0.13, 0.1, STEEL, MAT.METAL, 32); disc(b, c, 0.1, STEEL, MAT.METAL, DOWN, 32);
    ring(b, [c[0], c[1] + 0.13, c[2]], 0.094, 0.106, STEEL, MAT.METAL);
    cylinder(b, [c[0], c[1] + 0.005, c[2]], 0.12, 0.094, IRON, MAT.SATIN, 32);
    for (const s of [-1, 1]) {
      const h = [c[0] + Math.cos(yaw) * 0.118 * s, c[1] + 0.112, c[2] - Math.sin(yaw) * 0.118 * s];
      box(b, h, [0.022, 0.006, 0.014], (yaw * 180) / Math.PI, IRON, MAT.SATIN);
      box(b, [h[0], h[1] - 0.012, h[2]], [0.006, 0.01, 0.01], (yaw * 180) / Math.PI, STEEL, MAT.METAL);
    }
    if (cooking) { food(b, [c[0], c[1] + 0.1, c[2]], 0.094, d, seed); stir(0.1, 0.094); }
    else disc(b, [c[0], c[1] + 0.006, c[2]], 0.094, STEEL, MAT.METAL, UP, 32);
  } else if (kind === 'wok') {
    dish(b, c, 0.15, 0.07, IRON, MAT.METAL, 32);
    ring(b, [c[0], c[1] + 0.07, c[2]], 0.148, 0.158, IRON, MAT.METAL, 32);
    const hy = yaw + Math.PI / 2;
    handle(b, [c[0] + Math.sin(hy) * 0.15, c[1] + 0.07, c[2] + Math.cos(hy) * 0.15], hy, 0.07, STEEL);
    handle(b, [c[0] + Math.sin(hy) * 0.22, c[1] + 0.07, c[2] + Math.cos(hy) * 0.22], hy, 0.16, lin('#5a3a22'));
    box(b, [c[0] - Math.sin(hy) * 0.162, c[1] + 0.07, c[2] - Math.cos(hy) * 0.162], [0.012, 0.012, 0.012], (hy * 180) / Math.PI, STEEL, MAT.METAL);
    if (cooking) { food(b, [c[0], c[1] + 0.04, c[2]], 0.1, d, seed); stir(0.045, 0.1); }
  } else {
    cylinder(b, c, 0.04, 0.12, IRON, MAT.METAL, 32); disc(b, c, 0.12, IRON, MAT.METAL, DOWN, 32);
    ring(b, [c[0], c[1] + 0.04, c[2]], 0.113, 0.125, IRON, MAT.METAL);
    cylinder(b, [c[0], c[1] + 0.004, c[2]], 0.036, 0.113, BLACK, MAT.SATIN, 32);
    const hy = yaw + Math.PI / 2;
    handle(b, [c[0] + Math.sin(hy) * 0.12, c[1] + 0.034, c[2] + Math.cos(hy) * 0.12], hy, 0.06, STEEL);
    handle(b, [c[0] + Math.sin(hy) * 0.18, c[1] + 0.036, c[2] + Math.cos(hy) * 0.18], hy, 0.14, BLACK);
    if (cooking) { food(b, [c[0], c[1] + 0.012, c[2]], 0.11, d, seed); stir(0.015, 0.11); }
    else disc(b, [c[0], c[1] + 0.005, c[2]], 0.113, IRON, MAT.METAL, UP, 32);
  }
}
// What it's eaten from, its base at c.
function tableware(b, kind, c, d, seed, full) {
  if (kind === 'bowl') {
    cylinder(b, c, 0.01, 0.035, CERAMIC, MAT.GLOSS, 24);
    dish(b, [c[0], c[1] + 0.006, c[2]], 0.078, 0.052, CERAMIC, MAT.GLOSS, 28);
    ring(b, [c[0], c[1] + 0.058, c[2]], 0.074, 0.084, lin('#3a5a8a'), MAT.GLOSS);
    food(b, [c[0], c[1] + 0.042, c[2]], 0.068, d, seed, full);
  } else if (kind === 'tin') {
    cylinder(b, c, 0.07, 0.04, STEEL, MAT.METAL, 20); disc(b, c, 0.04, STEEL, MAT.METAL, DOWN, 20);
    cylinder(b, [c[0], c[1] + 0.02, c[2]], 0.035, 0.0405, lin('#5a6a3a'), MAT.SATIN, 20);
    ring(b, [c[0], c[1] + 0.07, c[2]], 0.036, 0.042, STEEL, MAT.METAL, 20);
    food(b, [c[0], c[1] + 0.058, c[2]], 0.036, d, seed, full);
  } else {
    cylinder(b, c, 0.008, 0.075, CERAMIC, MAT.GLOSS, 28); disc(b, c, 0.075, CERAMIC, MAT.GLOSS, DOWN, 28);
    disc(b, [c[0], c[1] + 0.008, c[2]], 0.08, CERAMIC, MAT.GLOSS, UP, 32);
    // the rim, raised and with a line round it
    grid(b, 2, 32, (i, j) => { const a = (j / 32) * Math.PI * 2, r = i ? 0.115 : 0.08; return [c[0] + Math.sin(a) * r, c[1] + (i ? 0.02 : 0.008), c[2] + Math.cos(a) * r]; }, { col: CERAMIC, mat: MAT.GLOSS, flip: true });
    ring(b, [c[0], c[1] + 0.0145, c[2]], 0.096, 0.099, lin('#b04a3a'), MAT.GLOSS, 32);
    food(b, [c[0], c[1] + 0.01, c[2]], 0.075, d, seed, full);
  }
}
// A camping stove on the floor at c: a flat steel box, a burner with a pot stand, and a gas canister
// beside it. Lit, a blue ring of flame under whatever's on it.
function stove(b, c, yaw, lit, t) {
  const deg = (yaw * 180) / Math.PI, side = [Math.cos(yaw), 0, -Math.sin(yaw)];
  box(b, [c[0], c[1] + 0.044, c[2]], [0.16, 0.036, 0.13], deg, ENAMEL, MAT.SATIN);
  // a black band round its foot, four rubber feet, and a grille in the top round the burner
  box(b, [c[0], c[1] + 0.008, c[2]], [0.162, 0.006, 0.132], deg, BLACK, MAT.SATIN);
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) box(b, [c[0] + side[0] * 0.14 * x + Math.sin(yaw) * 0.11 * z, c[1] + 0.003, c[2] + side[2] * 0.14 * x + Math.cos(yaw) * 0.11 * z], [0.012, 0.003, 0.012], deg, BLACK, MAT.SATIN);
  ring(b, [c[0], c[1] + 0.0805, c[2]], 0.056, 0.075, STEEL, MAT.METAL, 24);
  cylinder(b, [c[0], c[1] + 0.074, c[2]], 0.01, 0.05, IRON, MAT.METAL, 24);
  disc(b, [c[0], c[1] + 0.084, c[2]], 0.05, BLACK, MAT.METAL, UP, 24);
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; box(b, [c[0] + Math.sin(a) * 0.04, c[1] + 0.0845, c[2] + Math.cos(a) * 0.04], [0.003, 0.001, 0.003], 0, lin('#4a4a4e'), MAT.METAL); }
  // a stripe of print on the front, as camping stoves have
  box(b, [c[0] + Math.sin(yaw) * 0.131, c[1] + 0.06, c[2] + Math.cos(yaw) * 0.131], [0.08, 0.008, 0.001], deg, lin('#d04030'), MAT.SATIN);
  for (let i = 0; i < 4; i++) {
    const a = yaw + (i * Math.PI) / 2 + Math.PI / 4;
    box(b, [c[0] + Math.sin(a) * 0.07, c[1] + 0.095, c[2] + Math.cos(a) * 0.07], [0.006, 0.014, 0.035], (a * 180) / Math.PI, IRON, MAT.METAL);
  }
  // the knob on the front and the canister off the side
  box(b, [c[0] + Math.sin(yaw) * 0.135, c[1] + 0.04, c[2] + Math.cos(yaw) * 0.135], [0.015, 0.015, 0.012], deg, BLACK, MAT.SATIN);
  const can = [c[0] + side[0] * 0.24, c[1], c[2] + side[2] * 0.24];
  cylinder(b, can, 0.14, 0.045, CAN, MAT.GLOSS, 24); disc(b, [can[0], can[1] + 0.14, can[2]], 0.045, CAN, MAT.GLOSS, UP, 24);
  cylinder(b, [can[0], can[1] + 0.05, can[2]], 0.045, 0.0455, lin('#e8e0d0'), MAT.SATIN, 24);
  cylinder(b, [can[0], can[1] + 0.14, can[2]], 0.02, 0.012, BRASS, MAT.METAL, 12);
  // the hose to the stove
  stick(b, [can[0], can[1] + 0.155, can[2]], [c[0] + side[0] * 0.16, c[1] + 0.05, c[2] + side[2] * 0.16], 0.005, BLACK, MAT.SATIN);
  if (!lit) return;
  // the flame: a ring of little blue tongues, flickering, with yellow tips
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2, f = 0.75 + 0.25 * Math.sin(t * 23 + i * 2.1) * Math.sin(t * 7.3 + i), h = 0.022 * f;
    const p = [c[0] + Math.sin(a) * 0.04, c[1] + 0.084, c[2] + Math.cos(a) * 0.04];
    const blue = [0.15, 0.35 * f, 1.6 * f], tip = [1.4 * f, 0.8 * f, 0.25];
    const out = [Math.sin(a), 0, Math.cos(a)], w = 0.006;
    const q0 = [p[0] - out[2] * w, p[1], p[2] + out[0] * w], q1 = [p[0] + out[2] * w, p[1], p[2] - out[0] * w], top = [p[0] + out[0] * 0.006, p[1] + h, p[2] + out[2] * 0.006];
    vtx(b, q0, UP, [0, 0], blue, UNLIT); vtx(b, q1, UP, [1, 0], blue, UNLIT); vtx(b, top, UP, [0.5, 1], tip, UNLIT);
  }
}
// Where a palm is, from the posed rows (gl/room-people.js figurePeople): a point in bind space (figure.js
// FIGURE_BONES puts the wrist at 0.85 up and 0.195 out) carried into the room by that hand's bone.
const PALM = { L: [FIGURE_BONE.handL, [0.195, 0.77, 0.01]], R: [FIGURE_BONE.handR, [-0.195, 0.77, 0.01]] };
function palmOf(rec, side = 'L', pt = null) {
  const [bone, p0] = PALM[side], m = rec.rows, o = bone * 12, [x, y, z] = pt || p0;
  return [0, 1, 2].map((r) => m[o + r * 4] * x + m[o + r * 4 + 1] * y + m[o + r * 4 + 2] * z + m[o + r * 4 + 3]);
}
// The props for everyone with a meal on: `bodies` as room-stage.js hands figurePeople, each with its
// `meal` ({ d, s, stove, pan }) and its yaw, and `recs` what figurePeople gave back, one for one.
export function mealProps(L, bodies, recs, t) {
  const b = createBatch(4096);
  bodies.forEach((body, i) => {
    const m = body.meal;
    if (!m) return;
    const d = dishOf(m.d), seed = body.id, rec = recs[i];
    const yaw = body.yaw || 0, cooking = m.s === 'cook';
    if (m.stove) {
      // turned its own way off where it stands, so it doesn't turn with the cook when they walk off
      const [u, v] = m.stove, c = L.world(u, v, L.baseAt?.(u, v) || 0), sy = ((u * 7.13 + v * 3.31) % 1) * Math.PI * 2;
      stove(b, c, sy, cooking, t);
      cookware(b, d.cook, [c[0], c[1] + 0.1, c[2]], sy, d, seed, cooking, t);
    }
    if (m.pan && cooking) cookware(b, d.cook, L.world(m.pan[0], m.pan[1], m.pan[2]), yaw, d, seed, true, t);
    if (!rec) return;
    if (m.s === 'carry' || m.s === 'get') {
      // what they took out: a packet in the hand on the way to the stove, once they've stood up from the fridge
      if (m.s === 'get') return;
      const p = palmOf(rec);
      const deg = (yaw * 180) / Math.PI;
      box(b, [p[0], p[1] + 0.03, p[2]], [0.06, 0.035, 0.045], deg, CARD, MAT.SATIN);
      // its label, in the dish's own colour, and a lid
      box(b, [p[0], p[1] + 0.034, p[2]], [0.061, 0.016, 0.046], deg, lin(d.food[0]), MAT.SATIN);
      box(b, [p[0], p[1] + 0.067, p[2]], [0.055, 0.003, 0.04], deg, lin('#e8e8e4'), MAT.GLOSS);
    } else if (m.s === 'serve' || m.s === 'eat') {
      const p = palmOf(rec);
      // half eaten by the time they've sat a while: the amount goes down on their own clock
      const full = m.s === 'serve' ? 1 : 0.35 + 0.65 * (0.5 + 0.5 * Math.cos(((t + seeded(seed)() * 60) / 60) * Math.PI));
      tableware(b, d.serve, [p[0], p[1] + 0.01, p[2]], d, seed, full);
      // a fork, or a spoon for anything in a bowl or a tin, along the right hand: from the heel of it out past the fingers
      const a = palmOf(rec, 'R', [-0.195, 0.80, 0.0]), e = palmOf(rec, 'R', [-0.195, 0.64, 0.02]);
      stick(b, a, e, 0.0035, SPOON, MAT.METAL);
      const dir = [e[0] - a[0], e[1] - a[1], e[2] - a[2]], l = Math.hypot(...dir) || 1;
      ellipsoid(b, [e[0] + dir[0] / l * 0.018, e[1] + dir[1] / l * 0.018, e[2] + dir[2] / l * 0.018], [[1, 0, 0], [0, 1, 0], [0, 0, 1]], d.serve === 'plate' ? [0.008, 0.008, 0.008] : [0.013, 0.013, 0.013], 4, 8, SPOON, MAT.METAL);
    }
  });
  return b;
}
