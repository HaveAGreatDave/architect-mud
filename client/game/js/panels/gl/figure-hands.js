// THE CLOSE-UP FIGURE'S HANDS. How a hand is held, as numbers gl/figure-hd.js bends the fingers by (handXf), and
// the same bend in JS, so gl/room-people.js can find where a pinch closes or a fork's tines are and put them on a
// mouth.
//
// A shape is { f: [index, middle, ring, little], th, op, sp }: each finger's curl (0 as figure.js models it, 1 a
// fist, below 0 straightened back), the thumb's curl, how far the thumb is brought across the palm to meet the
// fingers, and how far the fingers fan apart. A hand is its shape and its forearm's turn (`tw`, radians, the
// palm toward the front positive).

import { fingerTipsOf, fingerJointsOf } from '../figure.js';

const S = (f, th, op = 0, sp = 0) => Object.freeze({ f: Object.freeze(f), th, op, sp });
export const HAND_SHAPES = Object.freeze({
  // hanging loose: the fingers curled a little more from the index to the little finger
  relax: S([0.2, 0.25, 0.3, 0.34], 0.25, 0.1, 0.05),
  fist: S([1.05, 1.05, 1.05, 1.05], 0.95, 0.55),
  // opened out: the fingers back, fanned, the thumb away
  open: S([-0.5, -0.5, -0.5, -0.5], -0.4, -0.25, 0.8),
  // flat under a plate, or the back of the hand up for a line
  flat: S([-0.12, -0.08, -0.04, 0], -0.25, -0.2, 0.25),
  // round a glass, a bottle or a can
  cup: S([0.62, 0.68, 0.74, 0.8], 0.42, 0.75),
  // the index and the thumb closed on something small: a pill, a rolled note, the bridge of a nose
  pinch: S([0.72, 0.9, 1.0, 1.05], 0.55, 1.0),
  // a cigarette between the index and middle fingers, held straight; the others tucked
  cig: S([0.1, 0.12, 0.78, 0.88], 0.35, 0.55),
  // a fork or a spoon, the handle in the curl and the thumb along it
  tool: S([0.5, 0.72, 0.9, 0.98], 0.5, 0.8),
  // a syringe: the barrel between the fingers and the thumb on the plunger
  syringe: S([0.38, 0.42, 0.88, 0.98], 0.1, 0.35),
  // a glass pipe's stem
  pipe: S([0.55, 0.62, 0.74, 0.82], 0.4, 0.7),
  // a rag or a bag over the mouth: cupped, the fingers together
  rag: S([0.36, 0.38, 0.42, 0.46], 0.22, 0.35),
  point: S([-0.3, 1.05, 1.05, 1.05], 0.8, 0.65),
});
const shapeOf = (s) => (typeof s === 'string' ? HAND_SHAPES[s] || HAND_SHAPES.relax : s || HAND_SHAPES.relax);
// a shape between two, `k` of the way from a to b
export function mixShape(a, b, k) {
  const A = shapeOf(a), B = shapeOf(b);
  if (k <= 0) return A;
  if (k >= 1) return B;
  const m = (x, y) => x + (y - x) * k;
  return { f: A.f.map((v, i) => m(v, B.f[i])), th: m(A.th, B.th), op: m(A.op, B.op), sp: m(A.sp, B.sp) };
}
// The old way of saying a grip, [left, right, left index, right index] (one curl a hand, and the index's extra),
// as a shape for each hand. The thumb's curl is the hand's, as it was.
export function shapeOfGrip(g, side) {
  const c = g[side > 0 ? 0 : 1] ?? 0.22, ix = g[side > 0 ? 2 : 3] ?? 0;
  return { f: [c + ix, c, c, c], th: c, op: 0, sp: 0 };
}
// What gl/figure-hd.js's uniforms get: the two hands' shapes and their forearms' turns.
export function handsUniforms(L, R, twL = 0, twR = 0) {
  const a = shapeOf(L), b = shapeOf(R);
  return { fingL: Float32Array.from(a.f), fingR: Float32Array.from(b.f), thumb: Float32Array.of(a.th, b.th, a.op, b.op), handX: Float32Array.of(a.sp, b.sp, twL, twR) };
}
export const handsOfGrip = (g = [0.2, 0.2, 0, 0]) => handsUniforms(shapeOfGrip(g, 1), shapeOfGrip(g, -1));

// ── The joints the shader folds a finger at ─────────────────────────────────────────────────────────────────────
// The left hand's, at a typical hand's scale (figure.js handScaleOf is about 1.1 to 1.2); the right is the mirror.
const HAND_K = 1.15;
const JOINTS = fingerJointsOf(HAND_K);
// How each finger was modelled bent at its knuckle and its two joints (figure.js handSculpt's F `bend`), which a
// curl under nothing takes out again, with a little more at the knuckle so an open hand bends back.
const MODELLED = [[0.1, 0.34, 0.26], [0.14, 0.4, 0.3], [0.2, 0.46, 0.32], [0.28, 0.52, 0.34]].map(([a, b, c]) => [a + 0.25, b + 0.05, c]);
// How far each joint folds, past as modelled, for a curl of 1: a closed fist.
export const HAND_FLEX = [1.3, 1.25, 0.8];
// ⚠ PICKED BY A CHAIN OF SELECTS, NEVER BY INDEXING A CONST ARRAY WITH A VARIABLE. ANGLE's D3D back end turns
// a variable index into a const array into a function per array, and the figure's ~114k-character shader then
// took the driver minutes to compile and failed to link with an empty log, hanging the page meanwhile.
const vec = (p) => `vec${p.length}(${p.map((x) => x.toFixed(5)).join(', ')})`;
const pick = (name, type, vals) => `${type} ${name}(int i) { return i == 0 ? ${vec(vals[0])} : i == 1 ? ${vec(vals[1])} : i == 2 ? ${vec(vals[2])} : ${vec(vals[3])}; }`;
export const FINGER_GLSL = [
  pick('fjK', 'vec3', JOINTS.map((J) => J.j[0])),
  pick('fjP', 'vec3', JOINTS.map((J) => J.j[1])),
  pick('fjD', 'vec3', JOINTS.map((J) => J.j[2])),
  pick('fjT', 'vec2', JOINTS.map((J) => J.t)),
  pick('fjB', 'vec3', MODELLED),
].join('\n');

// ── The bend in JS, point for point as gl/figure-hd.js handXf does it ──────────────────────────────────────────
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function turnAbout(p, axis, a, c) {
  const co = Math.cos(a), s = Math.sin(a), d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
  if (axis === 'z') return [c[0] + co * d[0] - s * d[1], c[1] + s * d[0] + co * d[1], p[2]];
  if (axis === 'x') return [p[0], c[1] + co * d[1] - s * d[2], c[2] + s * d[1] + co * d[2]];
  return [c[0] + co * d[0] + s * d[2], p[1], c[2] - s * d[0] + co * d[2]];
}
// a point on finger `fi` (0 the index to 3 the little finger, 4 the thumb), `t` of the way along it, bent to `shape`
export function bendPoint(p, side, fi, t, shape) {
  const H = shapeOf(shape), s = side > 0 ? 1 : -1;
  if (fi === 4) {
    let q = turnAbout(p, 'z', -s * H.th * 0.61 * t * t, [s * 0.19, 0.838, 0]);
    if (H.op) q = turnAbout(q, 'y', -s * H.op * 0.9, [s * 0.188, 0, 0.026]);
    return q;
  }
  const J = JOINTS[fi], m = (q) => [q[0] * s, q[1], q[2]], [K, P, D] = J.j.map(m), g = H.f[fi];
  const a = g >= 0 ? HAND_FLEX.map((x) => x * g) : MODELLED[fi].map((x) => x * g);
  let q = turnAbout(p, 'z', -s * a[2] * sstep(J.t[1] - 0.06, J.t[1] + 0.04, t), D);
  q = turnAbout(q, 'z', -s * a[1] * sstep(J.t[0] - 0.07, J.t[0] + 0.05, t), P);
  q = turnAbout(q, 'z', -s * a[0] * sstep(0, 0.14, t), K);
  if (H.sp) q = turnAbout(q, 'x', -H.sp * (1.5 - fi) * 0.16, [0, K[1], K[2]]);
  return q;
}
// Where a hand bent to `shape` closes, in bind space: halfway between the tips of the index and the thumb. `k` is the
// hand's scale (figure.js handScaleOf).
export function pinchOf(side, shape, k) {
  const tips = fingerTipsOf(side, k), a = bendPoint(tips[0], side, 0, 1, shape), b = bendPoint(tips[4], side, 4, 1, shape);
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}
