// THE CLOSE-UP FIGURE'S HANDS. How a hand is held, as numbers gl/figure-hd.js bends the fingers by (handXf), and
// the same bend in JS, so gl/room-people.js can find where a pinch closes or a fork's tines are and put them on a
// mouth.
//
// A shape is { f: [index, middle, ring, little], th, op, sp }: each finger's curl (0 as figure.js models it, 1 a
// fist, below 0 straightened back), the thumb's curl, how far the thumb is brought across the palm to meet the
// fingers, and how far the fingers fan apart. What the shader takes is a pose, every joint's own angle (handPose:
// three hinges and a swing a finger, three hinges and a swing for the thumb), which a shape is worked out into; a
// shape may give its pose outright (`j`) or its thumb's joints alone (`tj`). A hand is its shape and its forearm's
// turn (`tw`, radians, the palm toward the front positive).

import { fingerTipsOf, fingerJointsOf, thumbJointsOf } from '../figure.js';

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
// a shape between two, `k` of the way from a to b; a shape with its own joints (`j`, a pose) mixes joint by joint
export function mixShape(a, b, k) {
  const A = shapeOf(a), B = shapeOf(b);
  if (k <= 0) return A;
  if (k >= 1) return B;
  const m = (x, y) => x + (y - x) * k;
  if (A.j || B.j || A.tj || B.tj) { const pa = handPose(A), pb = handPose(B); return { j: pa.map((v, i) => m(v, pb[i])) }; }
  return { f: A.f.map((v, i) => m(v, B.f[i])), th: m(A.th, B.th), op: m(A.op, B.op), sp: m(A.sp, B.sp), gk: m(A.gk || 0, B.gk || 0) };
}
// The old way of saying a grip, [left, right, left index, right index] (one curl a hand, and the index's extra),
// as a shape for each hand. The thumb's curl is the hand's, as it was.
export function shapeOfGrip(g, side) {
  const c = g[side > 0 ? 0 : 1] ?? 0.22, ix = g[side > 0 ? 2 : 3] ?? 0;
  return { f: [c + ix, c, c, c], th: c, op: 0, sp: 0 };
}
// What gl/figure-hd.js's uniforms get: each hand's pose (uHandL, uHandR), the forearms' turns (uHandX z, w), and
// what each hand closes round, if anything (uHoldL, uHoldR: a `hold`, below, in the left hand's bind space).
export function handsUniforms(L, R, twL = 0, twR = 0, holdL = null, holdR = null) {
  return { L: handPose(L), R: handPose(R), handX: Float32Array.of(0, 0, twL, twR), holdL: holdUniform(holdL, 1), holdR: holdUniform(holdR, -1) };
}
// A hold is a cylinder a hand's fingers close round, in the left hand's bind space: { at (a point on its axis), dir
// (its axis, a unit), r (its radius) }. Finger and thumb skin bent into it is laid on its surface instead (holdPush),
// as flesh flattens against wood, so a fist closes round a handle as far as a real one does. The right hand's is
// the mirror.
const holdUniform = (h, side) => (h ? Float32Array.of(side * h.at[0], h.at[1], h.at[2], h.r, side * h.dir[0], h.dir[1], h.dir[2], 1) : null);
export function holdPush(p, side, h) {
  if (!h) return p;
  const s = side > 0 ? 1 : -1, at = [s * h.at[0], h.at[1], h.at[2]], dir = [s * h.dir[0], h.dir[1], h.dir[2]];
  const d = [p[0] - at[0], p[1] - at[1], p[2] - at[2]], t = d[0] * dir[0] + d[1] * dir[1] + d[2] * dir[2];
  const q = [d[0] - dir[0] * t, d[1] - dir[1] * t, d[2] - dir[2] * t], l = Math.hypot(q[0], q[1], q[2]);
  return l >= h.r || l < 1e-6 ? p : [0, 1, 2].map((i) => at[i] + dir[i] * t + q[i] * (h.r / l));
}
export const handsOfGrip = (g = [0.2, 0.2, 0, 0]) => handsUniforms(shapeOfGrip(g, 1), shapeOfGrip(g, -1));

// ── The joints the shader folds a finger at ─────────────────────────────────────────────────────────────────────
// The left hand's, at a typical hand's scale (figure.js handScaleOf is about 1.1 to 1.2); the right is the mirror.
const HAND_K = 1.15;
const JOINTS = fingerJointsOf(HAND_K), THUMB = thumbJointsOf(HAND_K);
// How each finger was modelled bent at its knuckle and its two joints (figure.js handSculpt's F `bend`), which a
// curl under nothing takes out again, with a little more at the knuckle so an open hand bends back.
const MODELLED = [[0.1, 0.34, 0.26], [0.14, 0.4, 0.3], [0.2, 0.46, 0.32], [0.28, 0.52, 0.34]].map(([a, b, c]) => [a + 0.25, b + 0.05, c]);
// How far each joint folds, past as modelled, for a curl of 1: a closed fist.
export const HAND_FLEX = [1.3, 1.25, 0.8];
// The same for a power grip round a handle (a bat): the knuckle bends less and the two finger joints more, so the
// fingers wrap round what's in the palm instead of their first bones sweeping through it. A shape's `gk` (0 to 1)
// is how far toward this its fingers fold; fitted against a bat's handle (diamond/figure-rig.js HAND_HOLD.bat).
export const GRIP_FLEX = [0.6, 1.7, 1.1];
// ── The hand's joints ─────────────────────────────────────────────────────────────────────────────────────────────
// A pose is twenty angles, radians, each how far a joint is folded past as modelled (under nothing it straightens):
// for the index, middle, ring and little fingers in turn the knuckle, the middle joint, the last joint and how far
// the finger is swung forward of its neighbours at the knuckle (POSE_FINGER of them each); then the thumb's root,
// how far it's swung across the palm there, its knuckle and its last joint. The left hand's, as positive folds it;
// gl/figure-hd.js mirrors them onto the right. Fifteen hinges a hand, which every figure has: ROOM's people as well
// as the ballplayers.
export const POSE_FINGER = 4, POSE_THUMB = 16, POSE_LEN = 20;
// How a shape's thumb curl (`th`) shares out over the thumb's three joints, and its swing (`op`) at the root. As one
// curl it was a bend growing along the whole thumb, 0.61 rad at the tip, which can't wrap a handle or a ball.
export const THUMB_SPLIT = [0.12, 0.22, 0.27], THUMB_SWING = 0.9;
// A shape as a pose: one with its own joints (`j`) is that, and one in curls is worked out as the shader used to;
// a shape in curls may still set its thumb joint by joint (`tj`: the root, the swing, the knuckle, the last joint).
export function handPose(shape) {
  const H = shapeOf(shape);
  if (H.j) return H.j instanceof Float32Array && H.j.length === POSE_LEN ? H.j : Float32Array.from({ length: POSE_LEN }, (_, i) => +H.j[i] || 0);
  const out = new Float32Array(POSE_LEN), gk = H.gk || 0, sp = H.sp || 0;
  for (let fi = 0; fi < 4; fi++) {
    const g = H.f[fi], o = fi * POSE_FINGER;
    const a = g >= 0 ? HAND_FLEX.map((x, i) => (x + (GRIP_FLEX[i] - x) * gk) * g) : MODELLED[fi].map((x) => x * g);
    out[o] = a[0]; out[o + 1] = a[1]; out[o + 2] = a[2]; out[o + 3] = -sp * (1.5 - fi) * 0.16;
  }
  const c = H.th || 0;
  out[POSE_THUMB] = c * THUMB_SPLIT[0]; out[POSE_THUMB + 1] = (H.op || 0) * THUMB_SWING; out[POSE_THUMB + 2] = c * THUMB_SPLIT[1]; out[POSE_THUMB + 3] = c * THUMB_SPLIT[2];
  if (H.tj) for (let i = 0; i < 4; i++) out[POSE_THUMB + i] = H.tj[i];
  return out;
}
// Several shapes at once, each with its weight ([[shape, w], ...]), as one: a lone shape is itself, more are their
// poses mixed joint by joint.
export function shapeMix(list) {
  if (!list || !list.length) return HAND_SHAPES.relax;
  if (list.length === 1) return list[0][0];
  const out = new Float32Array(POSE_LEN);
  let sum = 0;
  for (const [sh, w] of list) { const P = handPose(sh); for (let i = 0; i < POSE_LEN; i++) out[i] += P[i] * w; sum += w; }
  if (sum > 1e-6) for (let i = 0; i < POSE_LEN; i++) out[i] /= sum;
  return { j: out };
}
// Where the thumb swings across the palm about: an upright line by its root.
export const THUMB_SWING_AT = [0.188, 0, 0.026];

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
  // the thumb's root, knuckle and last joint, where along it the two fall, and the line it swings across the palm on
  `const vec3 THK = ${vec(THUMB.j[0])}, THM = ${vec(THUMB.j[1])}, THI = ${vec(THUMB.j[2])}, THS = ${vec(THUMB_SWING_AT)};`,
  `const vec2 THT = ${vec(THUMB.t)};`,
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
// (a shape or a pose)
export function bendPoint(p, side, fi, t, shape) {
  const A = shape instanceof Float32Array ? shape : handPose(shape), s = side > 0 ? 1 : -1, m = (q) => [q[0] * s, q[1], q[2]];
  if (fi === 4) {
    const o = POSE_THUMB;
    let q = turnAbout(p, 'z', -s * A[o + 3] * sstep(THUMB.t[1] - 0.06, THUMB.t[1] + 0.04, t), m(THUMB.j[2]));
    q = turnAbout(q, 'z', -s * A[o + 2] * sstep(THUMB.t[0] - 0.07, THUMB.t[0] + 0.05, t), m(THUMB.j[1]));
    q = turnAbout(q, 'z', -s * A[o] * sstep(0, 0.12, t), m(THUMB.j[0]));
    if (A[o + 1]) q = turnAbout(q, 'y', -s * A[o + 1], m(THUMB_SWING_AT));
    return q;
  }
  const J = JOINTS[fi], [K, P, D] = J.j.map(m), o = fi * POSE_FINGER;
  let q = turnAbout(p, 'z', -s * A[o + 2] * sstep(J.t[1] - 0.06, J.t[1] + 0.04, t), D);
  q = turnAbout(q, 'z', -s * A[o + 1] * sstep(J.t[0] - 0.07, J.t[0] + 0.05, t), P);
  q = turnAbout(q, 'z', -s * A[o] * sstep(0, 0.14, t), K);
  if (A[o + 3]) q = turnAbout(q, 'x', A[o + 3], [0, K[1], K[2]]);
  return q;
}
// Where a hand bent to `shape` closes, in bind space: halfway between the tips of the index and the thumb. `k` is the
// hand's scale (figure.js handScaleOf).
export function pinchOf(side, shape, k) {
  const tips = fingerTipsOf(side, k), a = bendPoint(tips[0], side, 0, 1, shape), b = bendPoint(tips[4], side, 4, 1, shape);
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}
