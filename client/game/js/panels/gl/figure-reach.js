// THE CLOSE-UP FIGURE'S ARMS AND HANDS, PER CLIP. A clip (actor3d.js) poses an arm by its joints' angles, measured
// once on the average body, so on anybody else, or sat lower, the fork stops short of the mouth or goes through the
// cheek. This finishes the pose: for the clips that take something to the face or the arm, it says how each hand is
// held (gl/figure-hands.js), what it holds, how far its forearm is turned, and where the thing in it has to arrive,
// and as the clip brings the hand near there a two-bone reach (shoulder, elbow, wrist) takes it the rest of the way.
// The elbow stays on the side the clip put it. gl/room-people.js runs it on the posed bones before anything that
// reads a hand (a table, a held glass, the props); gl/room-held.js draws what's held.
//
// Every point here is in bind space (figure.js: metres, Y up, facing +Z, the left hand on +X, the arms hanging).

import { FIGURE_BONE as BN, handScaleOf } from '../figure.js';
import { mixShape, shapeOfGrip, handsUniforms, pinchOf } from './figure-hands.js';

// ── What can be held: where it sits in the hand and the end of it that goes to the mouth (or the arm) ──────────────
// In the hand's own frame from the wrist: `a` across toward the palm, `d` down along the fingers, `f` forward toward
// the thumb, metres before the hand's scale. `axis` is which of those the thing runs along, toward its `tip`.
// `len` and `back` are how far it runs each way from where it's held.
export const HELD = Object.freeze({
  bottle: { at: [0.03, 0.075, 0], axis: 'f', len: 0.115, back: 0.105, r: 0.031 },
  // behind a bar: a spirit bottle by its body with a pour spout at the tip, a shaker tin, a pint glass
  liquor: { at: [0.03, 0.075, 0], axis: 'f', len: 0.19, back: 0.1, r: 0.036 },
  shaker: { at: [0.03, 0.07, 0], axis: 'f', len: 0.13, back: 0.06, r: 0.045 },
  pint: { at: [0.03, 0.07, 0], axis: 'f', len: 0.085, back: 0.065, r: 0.04 },
  can: { at: [0.03, 0.07, 0], axis: 'f', len: 0.07, back: 0.05, r: 0.033 },
  glass: { at: [0.03, 0.07, 0], axis: 'f', len: 0.05, back: 0.04, r: 0.036 },
  // between the index and middle fingers: the filter out on the palm's side, the lit end out past the back
  cigarette: { at: [0.022, 0.1, 0.02], axis: 'a', len: 0.014, back: 0.068, r: 0.0045 },
  joint: { at: [0.022, 0.1, 0.02], axis: 'a', len: 0.016, back: 0.072, r: 0.006 },
  pill: { pinch: true, r: 0.005 },
  syringe: { at: [0.032, 0.055, 0], axis: '-f', len: 0.075, back: 0.055, r: 0.006 },
  pipe: { at: [0.028, 0.065, 0], axis: 'f', len: 0.07, back: 0.06, r: 0.005 },
  food: { at: [0.035, 0.065, 0], axis: 'f', len: 0.05, back: 0.04, r: 0.03 },
  rag: { at: [0.03, 0.06, 0], axis: 'a', len: 0.01, back: 0, r: 0.04 },
  lighter: { at: [0.03, 0.065, 0.01], axis: 'f', len: 0.03, back: 0.03, r: 0.012 },
  // flat on the fingers, its long side down them; gl/room-held.js turns the screen to the face
  phone: { at: [0.026, 0.085, 0.004], axis: 'd', len: 0.072, back: 0.072, r: 0.036 },
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
// where a held thing is in bind space: its middle, the way it runs, and its tip and its far end
export function heldFrame(kind, s, k = 1, shape = 'cup') {
  const h = HELD[kind];
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
const H = (grip, o = {}) => ({ grip, ...o });
// `aim` how far the thing in the hand is turned at the wrist to point at the goal (aimHand)
// eating from a plate on the left palm with a fork (gl/room-meals.js draws both), or with nothing to eat off, from the hand
const EAT = { L: H('relax'), R: H('cup', { hold: 'food', at: 'tip', goal: 'mouth', tw: 0.4, aim: 0.8 }),
  meal: { L: H('flat'), R: H('tool', { at: 'fork', goal: 'mouth', tw: 0.55, aim: 0.85 }) } };
const DRINK = { L: H('relax'), R: H('cup', { hold: 'bottle', at: 'tip', goal: 'mouth', tw: 0.25, aim: 1, pour: 0.5 }) };
const SMOKE = { R: H('cig', { hold: 'cigarette', at: 'tip', goal: 'mouth', tw: 0.35 }) };
const SWALLOW = { L: H('relax'), R: H('pinch', { hold: 'pill', at: 'pinch', goal: 'mouth', tw: 0.5, aim: 0.75 }) };
// the left arm held out (the clip does that), the inside of the elbow turned up, and the needle to its crook
const INJECT = { L: H('fist', { tw: 1.1 }), R: H('syringe', { hold: 'syringe', at: 'tip', goal: 'crookL', near: 0.3, full: 0.16, tw: 0.2, aim: 0.8 }) };
const HUFF = { L: H('rag', { at: 'palm', goal: 'mouthL', tw: 0.3 }), R: H('rag', { hold: 'rag', at: 'palm', goal: 'mouthR', tw: 0.3 }) };
export const CLIP_HANDS = Object.freeze({
  eat: EAT, sitEat: EAT,
  drink: DRINK, sitDrink: DRINK,
  smoke: SMOKE, sitSmoke: SMOKE, sitBarSmoke: SMOKE,
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
  // looking at a phone, standing, sat or lying: it's in the right hand, the left thumb over it
  phone: { L: H('relax'), R: H('cup', { hold: 'phone' }) },
  sitPhone: { L: H('relax'), R: H('cup', { hold: 'phone' }) },
  liePhone: { L: H('relax'), R: H('cup', { hold: 'phone' }) },
});
// a clip's own name with a man's wide knees taken off (actor3d.js wideKnees)
const baseClip = (c) => String(c || '').replace(/Wide$/, '');
export const clipHands = (c) => CLIP_HANDS[baseClip(c)] || null;

// ── The arithmetic ────────────────────────────────────────────────────────────────────────────────────────────────
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const at = (m, p) => [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);
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
const JOINT_Y = { S: 1.39, E: 1.1, W: 0.85 };
const jointOf = (s, k) => [s * 0.195, JOINT_Y[k], -0.01];

// The forearm's turn, carried by the hand's bone: about the forearm's own line through the wrist. The shader turns
// the forearm itself along its length to meet it (gl/figure-hd.js handXf).
function twistHand(M, s, L, tw) {
  if (!tw) return;
  const f = M[BN['farm' + L]], axis = unit([f[4], f[5], f[6]]);
  turnBones(M, [BN['hand' + L]], axisTurn(axis, s * tw), at(f, jointOf(s, 'W')));
}
// Shoulder, elbow, wrist: the arm bent so the bind point `pt` on the hand lands on `goal` (both in the body's space
// after the pose), the hand kept as it's held. Twice over, since moving the wrist moves where `pt` is.
function reachTo(M, s, L, pt, goal) {
  const iu = BN['uarm' + L], ifa = BN['farm' + L], ih = BN['hand' + L];
  for (let it = 0; it < 2; it++) {
    const S = at(M[iu], jointOf(s, 'S')), E = at(M[ifa], jointOf(s, 'E')), W = at(M[ih], jointOf(s, 'W')), P = at(M[ih], pt);
    const wantW = add(goal, sub(W, P)), a = len(sub(E, S)), b = len(sub(W, E));
    let D = sub(wantW, S), d = len(D);
    if (d < 1e-5) return;
    D = mul(D, 1 / d);
    d = Math.min((a + b) * 0.999, Math.max(Math.abs(a - b) + 1e-3, d));
    // the elbow stays on the side of the shoulder-to-wrist line the clip put it
    let pole = sub(E, S);
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
// Where the goals are, in bind space, on the bone that carries each
const GOALS = {
  mouth: [BN.head, [0, 1.574, 0.104]],
  mouthL: [BN.head, [0.032, 1.574, 0.1]],
  mouthR: [BN.head, [-0.032, 1.574, 0.1]],
  nose: [BN.head, [0, 1.597, 0.118]],
  crookL: [BN.farmL, [0.178, 1.075, 0.042]],
  crookR: [BN.farmR, [-0.178, 1.075, 0.042]],
};
// the middle of the palm's face, in the hand's frame
const PALM = [0.035, 0.07, 0.005];
// a fork or a spoon along the right hand, as gl/room-meals.js draws it: from the heel out past the fingers
const FORK = (s) => ({ c: [s * 0.195, 0.8, 0], tip: [s * 0.195, 0.622, 0.022] });
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
  if (spec.at === 'fork') return FORK(s).tip;
  if (spec.at === 'palm') return handPoint(s, PALM, k);
  if (spec.at === 'knuckle') return handPoint(s, [-0.02, 0.085, 0], k);
  const f = kind && heldFrame(kind, s, k, shape);
  return f ? f.tip : handPoint(s, [0.03, 0.07, 0], k);
}
const ease = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

// Finish a pose. `S` the posed bones (4×4s, bind into the body's space; not changed), `clip` what's playing, `key`
// the figure's key (its build and weight set the hand's size), `grip` the old [L, R, L index, R index] for any clip
// this table doesn't know, `props` what the figure's own mesh has in each hand ({ L: 'cigarette' }), and `holds`
// what the caller is drawing in each hand that the clip doesn't say. Gives the bones, gl/figure-hd.js's hand
// uniforms and what's in each hand for gl/room-held.js (`hold`, by side, and how far each hand has arrived, `on`).
export function finishArms(S, { clip, key = {}, grip = null, props = {}, holds = {}, meal = false } = {}) {
  const spec0 = clipHands(clip), spec = meal && spec0?.meal ? spec0.meal : spec0, shapes = {}, tw = { L: 0, R: 0 }, hold = { L: null, R: null }, on = { L: 0, R: 0 };
  let M = S;
  for (const [L, s] of [['L', 1], ['R', -1]]) {
    const h = spec?.[L], k = handScaleOf(key, s);
    // a glass the figure holds in its own mesh is gripped round; its cigarette is between the fingers
    const own = props[L], base = own ? (own === 'cigarette' ? 'cig' : 'cup') : null;
    shapes[L] = h ? h.grip : base || (grip ? shapeOfGrip(grip, s) : 'relax');
    hold[L] = holds[L] || (own ? null : h?.hold || null);
    if (!h) continue;
    if (M === S) M = Array.from(S);
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
    const fr = h.at === 'fork' ? FORK(s) : h.at === 'pinch' ? { c: jointOf(s, 'W'), tip: pinchOf(s, shapes[L], k) } : h.at === 'tip' && hold[L] ? heldFrame(hold[L], s, k, shapes[L]) : null;
    if (h.aim && fr) aimHand(M, s, L, fr, goal, w * h.aim, h.pour || 0);
    const pt = pointOf(h, s, k, shapes[L], hold[L]), from = at(M[BN['hand' + L]], pt);
    reachTo(M, s, L, pt, add(from, mul(sub(goal, from), w)));
  }
  return { S: M, hands: handsUniforms(shapes.L, shapes.R, tw.L, tw.R), hold, on };
}
