// THE CLOSE-UP FIGURE'S ARMS AND HANDS, PER CLIP. A clip (actor3d.js) poses an arm by its joints' angles, measured
// once on the average body, so on anybody else, or sat lower, the fork stops short of the mouth or goes through the
// cheek. This finishes the pose: for the clips that take something to the face or the arm, it says how each hand is
// held (gl/figure-hands.js), what it holds, how far its forearm is turned, and where the thing in it has to arrive,
// and as the clip brings the hand near there a two-bone reach (shoulder, elbow, wrist) takes it the rest of the way.
// The elbow stays on the side the clip put it. gl/room-people.js runs it on the posed bones before anything that
// reads a hand (a table, a held glass, the props); gl/room-held.js draws what's held.
//
// What's held is held as gl/figure-grips.js works it out against the thing: the fingers on its surface, and the
// thing where the fingers are. For a phone, a knife and fork and a mug, the thing's place is decided first (the
// phone along the line of the eyes with its screen to them, the tines on the plate) and the hand put round it, the
// arm reaching for the wrist. Between those, the hands move a little on their own clock (`t`): a thumb going on a
// screen, a finger tapping it, a knife sawing.
//
// Every point here is in bind space (figure.js: metres, Y up, facing +Z, the left hand on +X, the arms hanging).

import { FIGURE_BONE as BN, handScaleOf, fingerTipsOf } from '../figure.js';
import { mixShape, shapeOfGrip, handsUniforms, pinchOf, HAND_SHAPES, handPose, bendPoint, POSE_THUMB } from './figure-hands.js';
import { gripOf, GRIPS, fromLocal, thumbOnto, thumbPad, PHONE_SIZE } from './figure-grips.js';
import { dishOf } from '../../../../shared/home-meals.js';

// ── What can be held: where it sits in the hand and the end of it that goes to the mouth (or the arm) ──────────────
// In the hand's own frame from the wrist: `a` across toward the palm, `d` down along the fingers, `f` forward toward
// the thumb, metres before the hand's scale. `axis` is which of those the thing runs along, toward its `tip`.
// `len` and `back` are how far it runs each way from where it's held. A thing with a grip (gl/figure-grips.js) sits
// where its grip puts it and runs along the grip's x; these give only its length then.
export const HELD = Object.freeze({
  bottle: { at: [0.03, 0.075, 0], axis: 'f', len: 0.115, back: 0.105, r: 0.031 },
  // behind a bar: a spirit bottle by its body with a pour spout at the tip, a shaker tin, a pint glass
  liquor: { at: [0.03, 0.075, 0], axis: 'f', len: 0.19, back: 0.1, r: 0.036 },
  shaker: { at: [0.03, 0.07, 0], axis: 'f', len: 0.13, back: 0.06, r: 0.045 },
  pint: { at: [0.03, 0.07, 0], axis: 'f', len: 0.085, back: 0.065, r: 0.04 },
  can: { at: [0.03, 0.07, 0], axis: 'f', len: 0.07, back: 0.05, r: 0.033 },
  glass: { at: [0.03, 0.07, 0], axis: 'f', len: 0.05, back: 0.04, r: 0.036 },
  mug: { at: [0.03, 0.07, 0], axis: 'f', len: 0.048, back: 0.048, r: 0.041 },
  // between the index and middle fingers: the filter out on the palm's side, the lit end out past the back
  cigarette: { at: [0.022, 0.1, 0.02], axis: 'a', len: 0.014, back: 0.068, r: 0.0045 },
  joint: { at: [0.022, 0.1, 0.02], axis: 'a', len: 0.016, back: 0.072, r: 0.006 },
  pill: { pinch: true, r: 0.005 },
  syringe: { at: [0.032, 0.055, 0], axis: '-f', len: 0.075, back: 0.055, r: 0.006 },
  pipe: { at: [0.028, 0.065, 0], axis: 'f', len: 0.07, back: 0.06, r: 0.005 },
  food: { at: [0.035, 0.065, 0], axis: 'f', len: 0.05, back: 0.04, r: 0.03 },
  // a frank in its bun, held round the middle with both ends out; a burger in the palm, the bite toward the mouth
  hotdog: { at: [0.035, 0.065, 0], axis: 'f', len: 0.1, back: 0.07, r: 0.03 },
  burger: { at: [0.04, 0.07, 0], axis: 'f', len: 0.05, back: 0.05, r: 0.055 },
  rag: { at: [0.03, 0.06, 0], axis: 'a', len: 0.01, back: 0, r: 0.04 },
  lighter: { at: [0.03, 0.065, 0.01], axis: 'f', len: 0.03, back: 0.03, r: 0.012 },
  phone: { at: [0.026, 0.085, 0.004], axis: 'd', len: PHONE_SIZE.H / 2, back: PHONE_SIZE.H / 2, r: 0.036 },
  // a fork, spoon or knife from where the index presses: the business end out, the handle back
  forkUp: { len: 0.115, back: 0.125, r: 0.004 }, forkDown: { len: 0.115, back: 0.125, r: 0.004 },
  spoon: { len: 0.07, back: 0.125, r: 0.004 }, knife: { len: 0.09, back: 0.125, r: 0.004 },
  pen: { len: 0.026, back: 0.115, r: 0.0045 },
  note: { len: 0.054, back: 0.014, r: 0.001 }, wad: { len: 0.054, back: 0.014, r: 0.004 }, card: { len: 0.074, back: 0.014, r: 0.001 },
  deck: { len: 0.044, back: 0.044, r: 0.008 }, pad: { len: 0.075, back: 0.075, r: 0.004 },
});
const AXES = { a: (s) => [-s, 0, 0], d: () => [0, -1, 0], f: () => [0, 0, 1] };
const axisOf = (name, s) => (name[0] === '-' ? AXES[name[1]](s).map((v) => -v) : AXES[name](s));
// the wrist, which a hand is scaled about (figure.js handMesh)
const wristOf = (s) => [s * 0.195, 0.868, -0.004];
// a point in the hand's frame as bind space, for side s and a hand scaled by k
export function handPoint(s, [a, d, f], k = 1) {
  const W = wristOf(s);
  return [W[0] + k * -s * a, W[1] - k * d, W[2] + k * f];
}
// Where a held thing is in bind space: its middle, the way it runs, its tip and its far end, and with a grip its
// whole frame (F: o, X its length, Y its face, Z across).
export function heldFrame(kind, s, k = 1, shape = 'cup') {
  const h = HELD[kind], g = GRIPS[kind] ? gripOf(kind, s, k) : null;
  if (g) {
    const F = g.frame, l = h?.len ?? 0.05, b = h?.back ?? 0.05;
    return { c: F.o, dir: F.X, tip: F.o.map((v, i) => v + F.X[i] * l), end: F.o.map((v, i) => v - F.X[i] * b), F };
  }
  if (!h) return null;
  if (h.pinch) { const c = pinchOf(s, shape, k); return { c, dir: [0, 0, 1], tip: c, end: c }; }
  const c = handPoint(s, h.at, k), dir = axisOf(h.axis, s);
  return { c, dir, tip: c.map((v, i) => v + dir[i] * h.len), end: c.map((v, i) => v - dir[i] * h.back) };
}

// ── What each clip does with its hands ──────────────────────────────────────────────────────────────────────────
// Per hand: `grip` its shape; `to` a shape it closes to as it arrives; `hold` what's in it (for somebody doing the
// act with nothing of their own drawn: gl/room-held.js); `at` the point that has to arrive (`tip` of what's held,
// `pinch`, `fork`, `palm`, `knuckle`); `goal` where (`mouth`, `nose`, `crookL`); `near` how close the clip has to
// bring it before the reach takes over (m); `tw` the forearm's turn, all of it once it's there, or always with no goal.
// A hand holding something with a grip (gl/figure-grips.js) is shaped round it, whatever `grip` says.
const H = (grip, o = {}) => ({ grip, ...o });
// `aim` how far the thing in the hand is turned at the wrist to point at the goal (aimHand)
// eating from the hand; with a meal on, mealPlan below does the hands instead
const EAT = { L: H('relax'), R: H('cup', { hold: 'food', at: 'tip', goal: 'mouth', tw: 0.4, aim: 0.8 }), meal: true };
const DRINK = { L: H('relax'), R: H('cup', { hold: 'bottle', at: 'tip', goal: 'mouth', tw: 0.25, aim: 1, pour: 0.5 }) };
const SMOKE = { R: H('cig', { hold: 'cigarette', at: 'tip', goal: 'mouth', tw: 0.35 }) };
const SWALLOW = { L: H('relax'), R: H('pinch', { hold: 'pill', at: 'tip', goal: 'mouth', tw: 0.5, aim: 0.75 }) };
// the left arm held out (the clip does that), the inside of the elbow turned up, and the needle to its crook
const INJECT = { L: H('fist', { tw: 1.1 }), R: H('syringe', { hold: 'syringe', at: 'tip', goal: 'crookL', near: 0.3, full: 0.16, tw: 0.2, aim: 0.8 }) };
const HUFF = { L: H('rag', { at: 'palm', goal: 'mouthL', tw: 0.3 }), R: H('rag', { hold: 'rag', at: 'palm', goal: 'mouthR', tw: 0.3 }) };
// a phone: looked at in front of the face (phonePlan), or held to the ear
const PHONE = { L: H('point'), R: H('cup', { hold: 'phone' }), phone: 'look' };
const CALL = { L: H('relax'), R: H('cup', { hold: 'phone' }), phone: 'ear' };
const SCROLL = { R: H('cup', { hold: 'phone' }), phone: 'thumb' };
// a note held out or up to a dancer
const TIP = { R: H('pinch', { hold: 'note' }) };
export const CLIP_HANDS = Object.freeze({
  eat: EAT, sitEat: EAT,
  drink: DRINK, sitDrink: { ...DRINK, cup: true },
  smoke: SMOKE, sitSmoke: SMOKE, sitBarSmoke: SMOKE, leanSmoke: SMOKE, walkSmoke: SMOKE,
  swallow: SWALLOW, sitPill: SWALLOW,
  inject: INJECT, sitTie: INJECT,
  huff: HUFF, sitHuff: HUFF,
  // behind a bar (actor3d.js pourPose and the rest): the rag in a wipe and a polish, the glass polished, the bottle
  // poured over a glass, the tin shaken, the pint held under the tap, a bottle held to the light
  wipe: { L: H('flat'), R: H('rag', { hold: 'rag' }) },
  polish: { L: H('cup', { hold: 'glass' }), R: H('rag', { hold: 'rag' }) },
  pour: { L: H('cup', { hold: 'glass' }), R: H('cup', { hold: 'liquor' }) },
  shakeTin: { L: H('flat'), R: H('cup', { hold: 'shaker' }) },
  tapPull: { L: H('cup', { hold: 'pint' }), R: H('fist') },
  checkBottle: { L: H('relax'), R: H('cup', { hold: 'liquor' }) },
  slideGlass: { L: H('flat'), R: H('flat') },
  // the left hand's back comes up under the nose; the right pinches it after
  snort: { L: H('flat', { at: 'knuckle', goal: 'nose', near: 0.24, tw: -0.4 }), R: H('relax', { to: 'pinch', at: 'pinch', goal: 'nose', tw: 0.8 }) },
  // at the table: the note in the right hand on the mirror, the left to the nose after
  sitLine: { L: H('relax', { to: 'pinch', at: 'pinch', goal: 'nose', full: 0.17, tw: 0.8 }), R: H('pinch') },
  sitPipe: { L: H('cup', { hold: 'lighter' }), R: H('pipe', { hold: 'pipe', at: 'tip', goal: 'mouth', tw: 0.2, aim: 0.7 }) },
  sitCook: { L: H('tool'), R: H('cup', { hold: 'lighter' }) },
  // a bottle up to somebody else's, then a swig (actor3d.js toastPose)
  toast: { L: H('relax'), R: H('cup', { hold: 'bottle' }) },
  phone: PHONE, sitPhone: PHONE, liePhone: PHONE,
  phoneScroll: SCROLL, sitScroll: SCROLL,
  panicPhone: CALL, sitPanicPhone: CALL,
  // writing on a pad held at the waist; counting a wad of notes, the right thumb going through them
  write: { L: H('flat', { hold: 'pad', tw: 1.25 }), R: H('tool', { hold: 'pen' }), write: true },
  count: { L: H('pinch', { hold: 'wad' }), R: H('relax', { thumb: 'flick' }) },
  tipOffer: TIP, sitTipOffer: TIP, billWave: TIP, sitBillWave: TIP,
  // dealing: the deck in the left, a card pinched off it in the right
  deal: { L: H('cup', { hold: 'deck' }), R: H('pinch', { hold: 'card' }) }, sitDeal: null,
});
// a clip's own name with a man's wide knees taken off (actor3d.js wideKnees)
const baseClip = (c) => String(c || '').replace(/Wide$/, '');
export const clipHands = (c) => { const b = baseClip(c); return CLIP_HANDS[b] || (b === 'sitDeal' ? CLIP_HANDS.deal : null); };

// ── The arithmetic ────────────────────────────────────────────────────────────────────────────────────────────────
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const at = (m, p) => [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);
const dirOf = (m, v) => [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2]);
// a turn of `ang` about the unit axis u, as rows
function axisTurn(u, ang) {
  const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c, [x, y, z] = u;
  return [[t * x * x + c, t * x * y - s * z, t * x * z + s * y], [t * x * y + s * z, t * y * y + c, t * y * z - s * x], [t * x * z - s * y, t * y * z + s * x, t * z * z + c]];
}
// the least turn that takes unit a onto unit b
function turnOnto(a, b) {
  const ax = cross(a, b), s = len(ax), c = dot(a, b);
  if (s < 1e-7) return null;
  return axisTurn(mul(ax, 1 / s), Math.atan2(s, c));
}
// turn the bones' matrices (4×4, columns) by the rows R about the point p
function turnBones(M, bones, R, p) {
  if (!R) return;
  for (const i of bones) {
    const m = (M[i] = Float32Array.from(M[i]));
    for (let c = 0; c < 3; c++) { const v = [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]]; for (let r = 0; r < 3; r++) m[c * 4 + r] = dot(R[r], v); }
    const t = [m[12] - p[0], m[13] - p[1], m[14] - p[2]];
    for (let r = 0; r < 3; r++) m[12 + r] = p[r] + dot(R[r], t);
  }
}
// 4×4s, columns: a frame's (its ways and its origin), one after another, and a rigid one undone
const frameMat = (F) => Float64Array.of(...F.X, 0, ...F.Y, 0, ...F.Z, 0, ...F.o, 1);
function mulM(a, b) {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
function invRigid(m) {
  const o = new Float64Array(16);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[c * 4 + r] = m[r * 4 + c];
  for (let r = 0; r < 3; r++) o[12 + r] = -(o[r] * m[12] + o[4 + r] * m[13] + o[8 + r] * m[14]);
  o[15] = 1;
  return o;
}
// a turn's quaternion from a matrix's columns, and back; and the shorter way between two
function quatOf(m) {
  const [a, b, c, d, e, f, g, h, i] = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]], tr = a + e + i;
  let q;
  if (tr > 0) { const S = Math.sqrt(tr + 1) * 2; q = [(h - f) / S, (c - g) / S, (d - b) / S, 0.25 * S]; }
  else if (a > e && a > i) { const S = Math.sqrt(1 + a - e - i) * 2; q = [0.25 * S, (b + d) / S, (c + g) / S, (h - f) / S]; }
  else if (e > i) { const S = Math.sqrt(1 + e - a - i) * 2; q = [(b + d) / S, 0.25 * S, (f + h) / S, (c - g) / S]; }
  else { const S = Math.sqrt(1 + i - a - e) * 2; q = [(c + g) / S, (f + h) / S, 0.25 * S, (d - b) / S]; }
  const l = Math.hypot(...q);
  return q.map((v) => v / l);
}
function slerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const bb = d < 0 ? b.map((v) => -v) : b;
  d = Math.abs(d);
  if (d > 0.9995) { const q = a.map((v, i) => v + (bb[i] - v) * t), l = Math.hypot(...q); return q.map((v) => v / l); }
  const th = Math.acos(d), s = Math.sin(th), wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return a.map((v, i) => v * wa + bb[i] * wb);
}
function rotOf(q) {
  const [x, y, z, w] = q;
  return [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)];
}
const JOINT_Y = { S: 1.39, E: 1.1, W: 0.85 };
const jointOf = (s, k) => [s * 0.195, JOINT_Y[k], -0.01];

// The forearm's turn, carried by the hand's bone: about the forearm's own line through the wrist. The shader turns
// the forearm itself along its length to meet it (gl/figure-hd.js handXf).
function twistHand(M, s, L, tw) {
  if (!tw) return;
  const f = M[BN['farm' + L]], axis = unit([f[4], f[5], f[6]]);
  turnBones(M, [BN['hand' + L]], axisTurn(axis, s * tw), at(f, jointOf(s, 'W')));
}
// How far the hand's turned about the forearm's line from where the forearm alone would have it
function twistOf(M, L) {
  const r = mulM(invRigid(M[BN['farm' + L]]), M[BN['hand' + L]]), q = quatOf(r);
  let a = 2 * Math.atan2(q[1], q[3]);
  if (a > Math.PI) a -= 2 * Math.PI;
  if (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
// Shoulder, elbow, wrist: the arm bent so the bind point `pt` on the hand lands on `goal` (both in the body's space
// after the pose), the hand kept as it's held. Twice over, since moving the wrist moves where `pt` is.
// `elbow`, if given, is the way the elbow should point instead (body space).
function reachTo(M, s, L, pt, goal, elbow = null) {
  const iu = BN['uarm' + L], ifa = BN['farm' + L], ih = BN['hand' + L];
  for (let it = 0; it < 2; it++) {
    const S = at(M[iu], jointOf(s, 'S')), E = at(M[ifa], jointOf(s, 'E')), W = at(M[ih], jointOf(s, 'W')), P = at(M[ih], pt);
    const wantW = add(goal, sub(W, P)), a = len(sub(E, S)), b = len(sub(W, E));
    let D = sub(wantW, S), d = len(D);
    if (d < 1e-5) return;
    D = mul(D, 1 / d);
    d = Math.min((a + b) * 0.999, Math.max(Math.abs(a - b) + 1e-3, d));
    // the elbow stays on the side of the shoulder-to-wrist line the clip put it
    let pole = elbow || sub(E, S);
    pole = sub(pole, mul(D, dot(pole, D)));
    pole = len(pole) < 1e-4 ? [s * 0.4, -0.6, -0.3] : pole;
    pole = unit(sub(pole, mul(D, dot(pole, D))));
    const ca = Math.max(-1, Math.min(1, (a * a + d * d - b * b) / (2 * a * d))), sa = Math.sqrt(1 - ca * ca);
    const E2 = add(S, add(mul(D, a * ca), mul(pole, a * sa)));
    turnBones(M, [iu, ifa, ih], turnOnto(unit(sub(E, S)), unit(sub(E2, S))), S);
    const W1 = at(M[ih], jointOf(s, 'W')), W2 = add(S, mul(D, d));
    turnBones(M, [ifa, ih], turnOnto(unit(sub(W1, E2)), unit(sub(W2, E2))), E2);
  }
}
// The hand put where `D` says (a 4×4, its bind space into the body's), `w` of the way from where the clip has it:
// the arm reaches for the wrist and the hand is turned to D at it. Gives how much more the hand's turned about the
// forearm than before, for the shader's forearm.
function placeHand(M, s, L, D, w = 1, elbow = null) {
  const ih = BN['hand' + L], C = M[ih], before = twistOf(M, L);
  if (w <= 0) return 0;
  const qc = quatOf(C), qd = quatOf(D), q = slerp(qc, qd, Math.min(1, w)), R = rotOf(q), W = jointOf(s, 'W');
  const goalW = lerp3(at(C, W), at(D, W), Math.min(1, w));
  reachTo(M, s, L, W, goalW, elbow);
  // the hand's turn set outright about the wrist the arm reached
  const Wr = at(M[ih], W), m = new Float32Array(16);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) m[c * 4 + r] = R[c * 3 + r];
  const RW = [0, 1, 2].map((r) => m[r] * W[0] + m[4 + r] * W[1] + m[8 + r] * W[2]);
  m[12] = Wr[0] - RW[0]; m[13] = Wr[1] - RW[1]; m[14] = Wr[2] - RW[2]; m[15] = 1;
  M[ih] = m;
  return twistOf(M, L) - before;
}
// The hand matrix that puts a grip's thing at the frame G (body space)
const handFor = (grip, G) => mulM(frameMat(G), invRigid(frameMat(grip.frame)));
// Where the goals are, in bind space, on the bone that carries each
const GOALS = {
  mouth: [BN.head, [0, 1.574, 0.104]],
  mouthL: [BN.head, [0.032, 1.574, 0.1]],
  mouthR: [BN.head, [-0.032, 1.574, 0.1]],
  nose: [BN.head, [0, 1.597, 0.118]],
  crookL: [BN.farmL, [0.178, 1.075, 0.042]],
  crookR: [BN.farmR, [-0.178, 1.075, 0.042]],
};
// between the eyes, and each ear's hole
const EYES = [0, 1.62, 0.09], EAR = (s) => [s * 0.078, 1.6, 0.0];
// the middle of the palm's face, in the hand's frame
const PALM = [0.035, 0.07, 0.005];
// Turn the hand at the wrist, `k` of the way, so what it holds points from where it's held to the goal. Something
// drunk from (`pour`) comes in from above instead, its base tipped up that far over the line into the face, in the
// head's own frame, so a head thrown back takes the bottle with it.
function aimHand(M, s, L, fr, goal, k, pour = 0) {
  const m = M[BN['hand' + L]], c = at(m, fr.c), cur = unit(sub(at(m, fr.tip), c)), hd = M[BN.head];
  const want = pour ? unit(add(mul(unit([hd[8], hd[9], hd[10]]), -1), mul(unit([hd[4], hd[5], hd[6]]), -pour))) : unit(sub(goal, c));
  const ax = cross(cur, want), sn = len(ax);
  if (sn < 1e-6) return;
  turnBones(M, [BN['hand' + L]], axisTurn(mul(ax, 1 / sn), Math.atan2(sn, dot(cur, want)) * k), at(m, jointOf(s, 'W')));
}
// the point on a hand that has to arrive
function pointOf(spec, s, k, shape, kind) {
  if (spec.at === 'pinch') return pinchOf(s, shape, k);
  if (spec.at === 'palm') return handPoint(s, PALM, k);
  if (spec.at === 'knuckle') return handPoint(s, [-0.02, 0.085, 0], k);
  const f = kind && heldFrame(kind, s, k, shape);
  return f ? f.tip : handPoint(s, [0.03, 0.07, 0], k);
}
const ease = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
// a number in 0..1 from somebody's id and a salt, the same every frame
function hashOf(id, salt) {
  let h = 2166136261 ^ salt;
  for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
// a frame from its origin and two ways, squared up
function frame(o, X, Y) {
  const x = unit(X), y = unit(sub(Y, mul(x, dot(Y, x))));
  return { o, X: x, Y: y, Z: cross(x, y) };
}
// the body's own ways, and the head's
const UP = [0, 1, 0], FWD = [0, 0, 1];
const headWays = (M) => { const h = M[BN.head]; return { up: unit([h[4], h[5], h[6]]), fwd: unit([h[8], h[9], h[10]]), side: unit([h[0], h[1], h[2]]) }; };

// ── The phone ─────────────────────────────────────────────────────────────────────────────────────────────────────
// Looked at: a third of a metre along the line of the eyes, which look a little further down than the face points,
// its screen square to them and its top up the face. Held to the ear: its screen on the cheek, its top past the ear.
// The right hand round it; the left's index on the glass (`look`), or the right thumb going (`thumb`). What the
// thumb or the finger does comes off the person's id and the clock: a run of scrolls up the screen, a few taps, and
// a rest, over and over.
function phoneFrame(M, how) {
  const { up, fwd, side } = headWays(M), eye = at(M[BN.head], EYES);
  if (how === 'ear') {
    const ear = at(M[BN.head], EAR(-1));
    // the screen against the right cheek, its top (the speaker) at the ear and its foot by the corner of the mouth,
    // which puts the wrist under and behind it and the elbow down by the side
    const top = unit(add(mul(up, 0.45), mul(fwd, -0.9)));
    return frame(add(add(ear, mul(side, -0.024)), mul(top, -0.058)), top, side);
  }
  const gaze = unit(add(fwd, mul(up, -0.38)));
  return frame(add(eye, mul(gaze, 0.31)), up, mul(gaze, -1));
}
// what a finger or thumb is doing on the glass at time t: where on it (u up the screen, v across, -1..1) and how
// far off it (m)
function screenTouch(t, seed) {
  const cyc = 7 + 5 * hashOf(seed, 3), p = ((t + hashOf(seed, 5) * 40) % cyc) / cyc;
  // scrolling for the first half: a swipe up, the finger lifted, back down, again
  if (p < 0.5) {
    const sw = (p / 0.5) * 5, q = sw % 1;
    const u = q < 0.55 ? -0.45 + 0.9 * ease(q / 0.55) : 0.45 - 0.9 * ease((q - 0.55) / 0.45);
    return { u, v: 0.1, h: q < 0.55 ? 0 : 0.012 * Math.sin(((q - 0.55) / 0.45) * Math.PI) + 0.002 };
  }
  // then a few taps here and there, and a rest with the finger off the glass
  if (p < 0.78) {
    const n = Math.floor(((p - 0.5) / 0.28) * 4), q = (((p - 0.5) / 0.28) * 4) % 1;
    return { u: 0.6 * (hashOf(seed, 20 + n) * 2 - 1), v: 0.6 * (hashOf(seed, 40 + n) * 2 - 1), h: q < 0.3 ? 0 : 0.014 * Math.sin(((q - 0.3) / 0.7) * Math.PI) + 0.001 };
  }
  return { u: -0.3, v: 0.2, h: 0.018 };
}
// The right thumb's pose with its pad at (u, v) on the glass (as screenTouch has them) and h off it. The phone
// doesn't move in the hand, so a pose depends on those alone: each is solved once on a grid (a tenth of the screen
// across, 4 mm off it) and kept, and a point between is the eight round it mixed. A solve is about half a
// millisecond; mixing kept ones is nothing, where solving every frame was most of a millisecond a person.
const THUMB_GRID = new Map(), GRID_UV = 0.1, GRID_H = 0.004;
function thumbOnGlass(g, u, v, h) {
  const solve = (i, j, l) => {
    const key = g.side + ':' + g.k + ':' + i + ':' + j + ':' + l;
    let P = THUMB_GRID.get(key);
    if (!P) {
      if (THUMB_GRID.size > 6000) THUMB_GRID.clear();
      P = thumbOnto(g.pose, g.side, g.k, fromLocal(g.frame, [i * GRID_UV * PHONE_SIZE.H * 0.42, PHONE_SIZE.T / 2 + l * GRID_H + thumbPad, j * GRID_UV * PHONE_SIZE.W * 0.4]), g.dist);
      THUMB_GRID.set(key, P);
    }
    return P;
  };
  const cell = (x, st) => { const f = x / st, i = Math.floor(f); return [i, f - i]; };
  const [iu, fu] = cell(u, GRID_UV), [iv, fv] = cell(v, GRID_UV), [ih, fh] = cell(Math.max(0, h), GRID_H), out = new Float32Array(g.pose.length);
  for (let c = 0; c < 8; c++) {
    const a = c & 1, b = (c >> 1) & 1, d = (c >> 2) & 1, w = (a ? fu : 1 - fu) * (b ? fv : 1 - fv) * (d ? fh : 1 - fh);
    if (w < 1e-4) continue;
    const P = solve(iu + a, iv + b, ih + d);
    for (let i = 0; i < out.length; i++) out[i] += P[i] * w;
  }
  return out;
}
function phonePlan(M, spec, out, { t, id, keyOf }) {
  const how = spec.phone, gR = gripOf('phone', -1, keyOf(-1));
  const G = phoneFrame(M, how === 'ear' ? 'ear' : 'look');
  // every phone clip holds it up throughout, so the hand goes all the way
  const want = handFor(gR, G), w = 1;
  // on a call the arm's folded tight and the elbow hangs down, forward and out
  out.tw.R = placeHand(M, -1, 'R', want, w, how === 'ear' ? [-0.45, -0.7, 0.55] : null);
  out.hold.R = 'phone';
  let pose = gR.pose;
  const touch = screenTouch(t, id);
  const onGlass = (u, v, h) => fromLocal(G, [u * PHONE_SIZE.H * 0.42, PHONE_SIZE.T / 2 + h, v * PHONE_SIZE.W * 0.4]);
  if (how === 'thumb' || (how === 'look' && hashOf(id, 9) < 0.35)) {
    // the right thumb on the glass, over the half of it nearer the hand
    pose = thumbOnGlass(gR, -0.1 + touch.u * 0.55, 0.1 + touch.v * 0.4, touch.h);
    out.shapes.L = 'relax';
  } else if (how === 'look' || how === 'ear') {
    // the right thumb resting on the edge by the hand, off the glass the other finger's using (on a call, the same)
    pose = thumbOnGlass(gR, -0.05, 1.1, 0);
  }
  if (how === 'look' && hashOf(id, 9) >= 0.35) {
    // the left index's tip onto the glass, pointing into it
    const kL = keyOf(1), tipL = bendPoint(fingerTipsOf(1, kL)[0], 1, 0, 0.999, 'point'), goal = onGlass(touch.u, touch.v, touch.h + 0.008);
    const iw = w * (1 - 0.15 * Math.max(0, touch.h - 0.01) / 0.01);
    // the finger comes up to the glass from below and the left, tipped in to it, the hand under the phone
    const from = add(add(add(goal, mul(G.X, -0.07)), mul(G.Y, 0.03)), mul(G.Z, -0.03));
    aimFinger(M, 1, 'L', tipL, from, goal, iw);
    for (let i = 0; i < 2; i++) reachTo(M, 1, 'L', tipL, goal);
    out.shapes.L = 'point';
  }
  out.shapes.R = { j: pose };
  out.on.R = w;
}
// turn a hand at the wrist so the line from its wrist to `tip` (bind) points from `from` to `goal`
function aimFinger(M, s, L, tip, from, goal, k) {
  const m = M[BN['hand' + L]], W = at(m, jointOf(s, 'W')), cur = unit(sub(at(m, tip), W)), want = unit(sub(goal, from));
  const ax = cross(cur, want), sn = len(ax);
  if (sn < 1e-6) return;
  turnBones(M, [BN['hand' + L]], axisTurn(mul(ax, 1 / sn), Math.atan2(sn, dot(cur, want)) * k), W);
}

// ── A meal ────────────────────────────────────────────────────────────────────────────────────────────────────────
// How somebody eats (their id decides, once): with the fork in the left and the knife in the right throughout
// (`euro`), cutting that way and then the knife down and the fork over to the right to eat with (`zigzag`), or
// with a fork or spoon in the right alone (`fork`). Sat at a table the plate's on it (`meal.at`'s height, the
// server's); anywhere else it's on the flat of the left hand and it's a fork or spoon in the right whoever they are.
// When they take a bite follows the clip's own: how near it brings the right hand to the mouth.
export const eatStyleOf = (id) => { const h = hashOf(id, 77); return h < 0.4 ? 'euro' : h < 0.75 ? 'zigzag' : 'fork'; };
const PLATE_REACH = 0.36;
function mealPlan(M, out, { t, id, keyOf, meal, lift, bite, table }) {
  const serve = meal?.d ? dishOf(meal.d)?.serve : null, spoon = serve === 'bowl' || serve === 'tin';
  // the plate: off the left palm, or on the table in front of them
  let plate;
  if (table == null) {
    const gp = M[BN.handL];
    plate = { o: at(gp, handPoint(1, [PALM_A_PLATE, 0.07, 0.01], keyOf(1))), onHand: true };
  } else {
    const hip = at(M[BN.thighL], [0.095, 0.92, 0]), hipR = at(M[BN.thighR], [-0.095, 0.92, 0]), mid = lerp3(hip, hipR, 0.5);
    // the floor under them, from the soles as figurePeople finds it
    const floor = Math.min(at(M[BN.footL], [0.095, 0.02, 0.0])[1], at(M[BN.footR], [-0.095, 0.02, 0.0])[1], at(M[BN.toeL], [0.095, 0.0, 0.12])[1], at(M[BN.toeR], [-0.095, 0.0, 0.12])[1]);
    plate = { o: [mid[0], floor + table - (lift || 0), mid[2] + PLATE_REACH], onHand: false };
  }
  out.plate = plate;
  const mouth = at(M[BN.head], GOALS.mouth[1]);
  const style = plate.onHand ? 'fork' : eatStyleOf(id);
  // zigzag: cutting for the first part of a slow cycle, eating with the fork in the right for the rest
  const cyc = 26 + 10 * hashOf(id, 11), ph = ((t + hashOf(id, 12) * 60) % cyc) / cyc;
  const cutting = style === 'euro' || (style === 'zigzag' && ph < 0.3);
  const eatHand = style === 'euro' ? 'L' : 'R';
  // a sawing stroke: two a second, a couple of centimetres
  const saw = Math.sin(t * Math.PI * 4 + hashOf(id, 13) * 6) * 0.012;
  const toFood = (side, dx) => add(plate.o, [side * dx, plate.onHand ? 0.012 : 0.016, -0.01]);
  const placeTool = (L, kind, G, w = 1) => {
    const s = L === 'L' ? 1 : -1, g = gripOf(kind, s, keyOf(s));
    out.tw[L] = placeHand(M, s, L, handFor(g, G), w);
    out.shapes[L] = { j: g.pose };
    out.hold[L] = kind;
    out.on[L] = w;
  };
  // the tines (or the bowl of a spoon) at p: the handle up and back toward the hand's side, tipped down `pitch`
  // (from the hand's side in toward the plate's middle; the handle's top up, rolled out `roll`)
  const toolAt = (kind, p, side, pitch, roll = 0) => {
    const along = unit(add(add(mul(FWD, Math.cos(pitch)), mul(UP, -Math.sin(pitch))), [-side * 0.35, 0, 0]));
    const reach = (HELD[kind]?.len ?? 0.1) - 0.02;
    return frame(sub(p, mul(along, reach)), along, add(UP, [side * roll, 0, 0]));
  };
  // to the mouth: the business end in, level, from in front and below
  const toMouth = (kind, s) => {
    const along = unit(add(sub(mouth, add(mouth, [s * 0.05, -0.1, 0.22])), [0, 0, 0]));
    const reach = (HELD[kind]?.len ?? 0.1) - 0.03, up = kind === 'forkDown' ? mul(UP, -1) : UP;
    return frame(sub(mouth, mul(along, reach)), along, up);
  };
  const mixFrame = (A, B, k) => (k <= 0 ? A : k >= 1 ? B : frame(lerp3(A.o, B.o, k), lerp3(A.X, B.X, k), lerp3(A.Y, B.Y, k)));
  if (cutting) {
    // the fork pinning in the left, tines down; the knife in the right, sawing behind it
    const fG = toolAt('forkDown', toFood(1, 0.025), 1, 0.6), kG = toolAt('knife', add(toFood(-1, 0.0), [0, -0.004, saw]), -1, 0.42);
    const biting = style === 'euro' ? bite : 0;
    placeTool('L', 'forkDown', mixFrame(fG, toMouth('forkDown', 1), biting));
    // the knife rests while the fork's at the mouth
    placeTool('R', 'knife', biting > 0.05 ? toolAt('knife', toFood(-1, 0.03), -1, 0.4) : kG);
    return;
  }
  // a fork (or spoon) in the right, tines up: scooped off the plate, up to the mouth, back
  const kind = spoon ? 'spoon' : 'forkUp';
  const dip = toolAt(kind, toFood(-1, 0.01), -1, 0.5, 0.2);
  placeTool(eatHand, kind, mixFrame(dip, toMouth(kind, -1), bite));
  if (plate.onHand) { out.shapes.L = 'flat'; return; }
  // the other hand on the table beside the plate, or the knife put down on the plate's rim (zigzag)
  if (style === 'zigzag') out.knifeDown = true;
  // laid flat by the plate: the palm down a few millimetres off the top, the fingers forward and in
  const gl = gripOf('pad', 1, keyOf(1));
  out.tw.L = placeHand(M, 1, 'L', handFor(gl, frame(add(plate.o, [0.19, 0.004, -0.06]), [-1, 0, 0.35], mul(UP, -1))), 1);
  out.shapes.L = 'flat';
}
const PALM_A_PLATE = 0.035;

// ── Small motions with nothing to place ───────────────────────────────────────────────────────────────────────────
// A thumb flicking through a wad (counting), and the thumb idling on whatever the hand's round
function thumbFlick(pose, t, seed) {
  const P = Float32Array.from(handPose(pose)), f = Math.max(0, Math.sin(t * Math.PI * 2 * 2.6 + hashOf(seed, 2) * 6));
  P[POSE_THUMB + 2] += 0.5 * f; P[POSE_THUMB + 3] += 0.4 * f; P[POSE_THUMB + 1] += 0.15 * f;
  return { j: P };
}

// Finish a pose. `S` the posed bones (4×4s, bind into the body's space; not changed), `clip` what's playing, `key`
// the figure's key (its build and weight set the hand's size), `grip` the old [L, R, L index, R index] for any clip
// this table doesn't know, `props` what the figure's own mesh has in each hand ({ L: 'cigarette' }), and `holds`
// what the caller is drawing in each hand that the clip doesn't say. `meal` is the body's meal (gl/room-meals.js)
// and `lift` how far its seat raises it, `table` the height of the top of the table it's eaten at (metres, or null); `t` the clock and `id` who it is, for the hands' own motions. Gives the
// bones, gl/figure-hd.js's hand uniforms, what's in each hand for gl/room-held.js (`hold`, by side, and how far each
// hand has arrived, `on`), and, eating, where the plate is (`plate`, body space) and whether the knife's been put down.
export function finishArms(S, { clip, key = {}, grip = null, props = {}, holds = {}, meal = false, t = 0, id = '', lift = 0, table = null } = {}) {
  const spec = clipHands(clip), shapes = {}, tw = { L: 0, R: 0 }, hold = { L: null, R: null }, on = { L: 0, R: 0 }, gripHold = { L: null, R: null };
  const keyOf = (s) => handScaleOf(key, s);
  let M = S;
  const out = { shapes, tw, hold, on, plate: null, knifeDown: false };
  // how near the clip brings the right palm to the mouth: when a bite is taken
  const biteOf = () => { const [gb, gp] = GOALS.mouth, d = len(sub(at(S[BN.handR], handPoint(-1, PALM, keyOf(-1))), at(S[gb], gp))); return ease((0.24 - d) / 0.11); };
  for (const [L, s] of [['L', 1], ['R', -1]]) {
    const h = spec?.[L], k = keyOf(s);
    // a glass the figure holds in its own mesh is gripped round; its cigarette is between the fingers
    const own = props[L], base = own ? (own === 'cigarette' ? 'cig' : 'cup') : null;
    shapes[L] = h ? h.grip : base || (grip ? shapeOfGrip(grip, s) : 'relax');
    hold[L] = holds[L] || (own ? null : h?.hold || null);
    // sat with a drink and nothing said of what: a mug, a can or a bottle, by who they are
    if (L === 'R' && spec?.cup && !holds.R && !own) hold.R = ['mug', 'bottle', 'can', 'mug'][Math.floor(hashOf(id, 31) * 4)];
    const g = hold[L] && GRIPS[hold[L]] ? gripOf(hold[L], s, k) : null;
    if (g) { shapes[L] = { j: g.pose }; gripHold[L] = g.hold; }
  }
  // the clips whose hands are placed by what they hold
  if (spec?.phone) {
    M = Array.from(S);
    phonePlan(M, spec, out, { t, id, keyOf });
  } else if (spec?.meal && meal) {
    M = Array.from(S);
    mealPlan(M, out, { t, id, keyOf, meal: typeof meal === 'object' ? meal : null, lift, bite: biteOf(), table });
  } else {
    for (const [L, s] of [['L', 1], ['R', -1]]) {
      const h = spec?.[L], k = keyOf(s);
      if (!h) continue;
      if (M === S) M = Array.from(S);
      if (h.thumb === 'flick') shapes[L] = thumbFlick(HAND_SHAPES.relax, t, id);
      if (!h.goal) { twistHand(M, s, L, h.tw || 0); tw[L] = h.tw || 0; on[L] = 1; continue; }
      // how near the clip has brought the palm decides how much of the rest the reach does: none past `near`, all of
      // it inside `full`. At rest a hand hangs about a third of a metre from the mouth, and at it the clips bring the
      // palm within about ten centimetres.
      const [gb, gp] = GOALS[h.goal], goal = at(M[gb], gp);
      const dist = len(sub(at(M[BN['hand' + L]], handPoint(s, PALM, k)), goal)), near = h.near || 0.24, full = h.full || 0.13;
      const w = ease((near - dist) / (near - full));
      on[L] = w;
      if (h.to) shapes[L] = mixShape(h.grip, h.to, w);
      if (w <= 0) continue;
      twistHand(M, s, L, (h.tw || 0) * w);
      tw[L] = (h.tw || 0) * w;
      // a thing with a length (a bottle, a fork, a needle) is turned at the wrist to point at where it's going, and
      // a pinch is turned so the fingers point into the mouth rather than the hand standing up across the face
      const fr = h.at === 'pinch' ? { c: jointOf(s, 'W'), tip: pinchOf(s, shapes[L], k) } : h.at === 'tip' && hold[L] ? heldFrame(hold[L], s, k, shapes[L]) : null;
      if (h.aim && fr) aimHand(M, s, L, fr, goal, w * h.aim, h.pour || 0);
      const pt = pointOf(h, s, k, shapes[L], hold[L]), from = at(M[BN['hand' + L]], pt);
      reachTo(M, s, L, pt, add(from, mul(sub(goal, from), w)));
    }
  }
  // writing: the pen's point on the pad the left hand holds up, going along a line and back to the next
  if (spec?.write && hold.L === 'pad' && hold.R === 'pen') {
    const pad = heldFrame('pad', 1, keyOf(1)).F, m = M[BN.handL], W = (x, z) => at(m, fromLocal(pad, [x, 0.0045, z]));
    const line = ((t * 0.45 + hashOf(id, 4) * 9) % 1), row = Math.floor(t * 0.45 + hashOf(id, 4) * 9) % 6;
    const x = 0.045 - row * 0.016, z = -0.035 + 0.07 * line + 0.004 * Math.sin(t * 23);
    const pen = heldFrame('pen', -1, keyOf(-1));
    reachTo(M, -1, 'R', pen.tip, add(W(x, z), [0, 0.0015 * Math.max(0, Math.sin(t * 11)), 0]));
  }
  // a grip worked out afresh this frame (a meal's tools, the phone) carries its own contact cylinder
  for (const [L, s] of [['L', 1], ['R', -1]]) if (hold[L] && GRIPS[hold[L]] && !gripHold[L]) gripHold[L] = gripOf(hold[L], s, keyOf(s)).hold;
  return { S: M, hands: handsUniforms(shapes.L, shapes.R, tw.L, tw.R, gripHold.L, gripHold.R), hold, on, plate: out.plate, knifeDown: out.knifeDown };
}
