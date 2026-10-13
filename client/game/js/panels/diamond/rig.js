// DEADBALL · THE RIG. A player's skeleton: the pose language a clip is keyed in, the solver that
// turns a pose into joints, and the bones a skinned body hangs from.
//
// A pose (POSES) says where a man stands and how: the pelvis and its tilt and twist, the spine,
// chest, neck and head as small turns, and his hands and feet as targets in his own frame, with a
// direction for each knee and elbow to point. `solvePose` works the torso and head out by forward
// kinematics and the limbs by two-bone IK to those targets; a bat in two hands decides where the
// hands go. That's the language the clips are keyed in (diamond/anim.js), so the IK is in every
// frame and a hand on a bat stays on it.
//
// The bones (BONES) are what the GPU skins by (gl/skin.js): twenty frames, from the pelvis to the
// bat. `boneFrames` reads them off a solved pose, and a body built once in the bind pose
// (gl/ballplayer-mesh.js buildBody) follows them. A fist and the bat have bones of their own,
// folded away to nothing when the hands aren't on a bat, and the open hands fold away when they
// are.
//
// Pure: no WebGL and no DOM, so the gates run it. Feet, in the park's frame (diamond/geo.js);
// a pose's own frame has x to the player's left, y up and z his forward.

import { groundHeight, DEG } from './geo.js';

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
// 3×3 matrices as three column vectors
const m3v = (m, v) => [m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2], m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2], m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2]];
const m3m = (a, b) => [m3v(a, b[0]), m3v(a, b[1]), m3v(a, b[2])];
const RX = (d) => { const t = d * DEG, c = Math.cos(t), s = Math.sin(t); return [[1, 0, 0], [0, c, s], [0, -s, c]]; };
const RY = (d) => { const t = d * DEG, c = Math.cos(t), s = Math.sin(t); return [[c, 0, -s], [0, 1, 0], [s, 0, c]]; };
const RZ = (d) => { const t = d * DEG, c = Math.cos(t), s = Math.sin(t); return [[c, s, 0], [-s, c, 0], [0, 0, 1]]; };
const EUL = (e) => (e ? m3m(RZ(e[2] || 0), m3m(RX(e[0] || 0), RY(e[1] || 0))) : [[1, 0, 0], [0, 1, 0], [0, 0, 1]]);

// ── the solver ─────────────────────────────────────────────────────────────────
// Local pose space: x is the player's left, y up, z his forward. A foot given as [x, z] stands on
// the ground; given as [x, y, z] it's where it is.
//
// A limb by two-bone IK: from the joint at A toward the target T, bending toward `pole`. Near full
// stretch the reach is softened: past IK_SOFT short of the limb's length the distance eases toward
// full length rather than meeting it, so a knee or elbow straightens smoothly as a target moves
// out of reach and never snaps, at the cost of falling a hair short of a target at arm's length
// (0.02 ft for a leg asked for exactly its length). A target inside that is met exactly.
export const IK_SOFT = 0.02;
function ik2(A, T, l1, l2, pole) {
  const d = sub(T, A), dist = Math.max(1e-4, len(d)), dir = mul(d, 1 / dist);
  const L = l1 + l2, sw = L * IK_SOFT, da = L - sw;
  const D = clamp(dist > da ? da + sw * (1 - Math.exp(-(dist - da) / sw)) : dist, Math.abs(l1 - l2) + 1e-3, L - 1e-5);
  const a = Math.acos(clamp((l1 * l1 + D * D - l2 * l2) / (2 * l1 * D), -1, 1));
  let p = sub(pole, mul(dir, dot(pole, dir)));
  if (len(p) < 1e-5) p = Math.abs(dir[1]) < 0.9 ? cross(dir, [0, 1, 0]) : cross(dir, [1, 0, 0]);
  p = norm(p);
  const mid = add(A, add(mul(dir, l1 * Math.cos(a)), mul(p, l1 * Math.sin(a))));
  return [mid, add(mid, mul(norm(sub(T, mid)), l2))];
}

// The torso and head alone, by forward kinematics, with the shoulders and hips: what a layer that
// needs only the hips, the chest or the eyes can have without solving the limbs.
export function solveTorso(P) {
  const s = P.scale || 1, at = P.at || [0, 0, 0];
  const Yw = RY(P.yaw || 0);
  const toW = (v) => add(at, m3v(Yw, v));
  const J = {}, W = {};
  W.pelvis = m3m(Yw, m3m(RY(P.twist || 0), m3m(RX(P.pitch || 0), RZ(P.roll || 0))));
  J.pelvis = toW(P.pelvis);
  W.spine = m3m(W.pelvis, EUL(P.spine)); J.spine = add(J.pelvis, m3v(W.pelvis, [0, 0.35 * s, 0]));
  W.chest = m3m(W.spine, EUL(P.chest)); J.chest = add(J.spine, m3v(W.spine, [0, 0.55 * s, -0.02 * s]));
  W.neck = m3m(W.chest, EUL(P.neck)); J.neck = add(J.chest, m3v(W.chest, [0, 0.60 * s, 0]));
  W.head = m3m(W.neck, EUL(P.head)); J.head = add(J.neck, m3v(W.neck, [0, 0.34 * s, 0.03 * s]));
  for (const [S, sg] of [['L', 1], ['R', -1]]) {
    J['sh' + S] = add(J.chest, m3v(W.chest, [sg * 0.64 * s, 0.43 * s, -0.04 * s]));
    J['hip' + S] = add(J.pelvis, m3v(W.pelvis, [sg * 0.31 * s, -0.10 * s, 0]));
  }
  return { J, W, s, Yw, toW };
}

// The whole pose: the torso, then each leg and arm by two-bone IK to its target. `J.anT` and
// `J.wrT` are where each ankle and wrist was asked to be, so a gate can see a limb fall short.
export function solvePose(P) {
  const { J, W, s, Yw, toW } = solveTorso(P);
  const dirW = (v) => norm(m3v(Yw, v));
  for (const S of ['L', 'R']) {
    const a = P['ank' + S];
    let an;
    if (a.length === 2) { const w = toW([a[0], 0, a[1]]); an = [w[0], groundHeight(w[0], w[2]) + 0.28 * s, w[2]]; }
    else an = toW(a);
    const kp = dirW(P['knee' + S] || [0, 0, 1]);
    const [kn, an2] = ik2(J['hip' + S], an, 1.55 * s, 1.50 * s, kp);
    J['kn' + S] = kn; J['an' + S] = an2; J['anT' + S] = an; J['kpole' + S] = kp;
    const td = dirW(P['toe' + S] || [0, 0, 1]);
    const toe = add(an2, mul(td, 0.62 * s));
    if (P['plant' + S] !== false && a.length === 2) toe[1] = groundHeight(toe[0], toe[2]) + 0.07;
    else if (P['plant' + S] !== false) toe[1] = Math.min(toe[1], an2[1]);
    J['toe' + S] = toe;
  }
  // a bat in two hands decides where the hands go: the bottom hand against the knob, the top
  // hand touching it, as a hitter holds a bat
  const hands = {};
  if (P.bat) {
    const knob = toW(P.bat.knob), bd = dirW(P.bat.dir);
    J.batKnob = knob; J.batDir = bd; J.batBottom = P.bat.bottom || 'L';
    const lo = add(knob, mul(bd, 0.17 * s)), hi = add(knob, mul(bd, 0.45 * s));
    const bottom = P.bat.bottom || 'L', top = bottom === 'L' ? 'R' : 'L';
    const chestC = add(J.chest, m3v(W.chest, [0, 0.2 * s, 0.25 * s]));
    for (const [S, hc] of [[bottom, lo], [top, hi]]) {
      let v = sub(chestC, hc); v = norm(sub(v, mul(bd, dot(v, bd))));
      J['hand' + S] = hc; J['grip' + S] = true;
      hands[S] = add(add(hc, mul(v, 0.19 * s)), mul(bd, -0.06 * s));
    }
  }
  for (const [S, sg] of [['L', 1], ['R', -1]]) {
    const T = hands[S] || toW(P['wr' + S]);
    const ep = dirW(P['elb' + S] || [sg * 0.4, -0.2, -1]);
    const [el, wr] = ik2(J['sh' + S], T, 0.98 * s, 0.90 * s, ep);
    J['el' + S] = el; J['wr' + S] = wr; J['wrT' + S] = T; J['epole' + S] = ep;
    if (!J['hand' + S]) {
      const hd = P['hand' + S] ? dirW(P['hand' + S]) : norm(sub(wr, el));
      J['hand' + S] = add(wr, mul(hd, 0.17 * s));
      J['hdir' + S] = hd;
      J['palm' + S] = P['palm' + S] ? dirW(P['palm' + S]) : norm(cross(hd, m3v(W.chest, [0, 1, 0])));
    }
  }
  return { J, W, s };
}

// A pose for the other hand: the same stance seen in a mirror, left for right. A left-handed
// batter stands in the other box with this; a left-handed pitcher throws with it.
export function mirrorPose(P) {
  const fx = (v) => (v ? [-v[0], ...v.slice(1)] : v);
  const fe = (e) => (e ? [e[0] || 0, -(e[1] || 0), -(e[2] || 0)] : e);
  const out = { ...P, twist: -(P.twist || 0), roll: -(P.roll || 0), pelvis: fx(P.pelvis), spine: fe(P.spine), chest: fe(P.chest), neck: fe(P.neck), head: fe(P.head) };
  for (const k of ['ank', 'toe', 'knee', 'wr', 'elb', 'hand', 'palm', 'plant']) {
    const L = P[k + 'L'], R = P[k + 'R'];
    const f = k === 'plant' ? (x) => x : (v) => (v && v.length === 2 ? [-v[0], v[1]] : fx(v));
    out[k + 'L'] = f(R); out[k + 'R'] = f(L);
    if (out[k + 'L'] === undefined) delete out[k + 'L'];
    if (out[k + 'R'] === undefined) delete out[k + 'R'];
  }
  if (P.bat) out.bat = { knob: fx(P.bat.knob), dir: fx(P.bat.dir), bottom: (P.bat.bottom || 'L') === 'L' ? 'R' : 'L' };
  return out;
}


// ── the poses ──────────────────────────────────────────────────────────────────
// Local: x is the player's left, z his forward. The pitcher's are drawn side-on with +x toward the
// plate (yaw 90), a right-hander facing third base with first behind him, all in one frame, as
// the look-dev posed them. These are the stills
// the 1c players stood in and the blocking the first clips are keyed from.
export const POSES = {
  stand: () => ({ pelvis: [0, 3.42, 0], pitch: 2, spine: [2, 0, 0], chest: [2, 0, 0],
    ankL: [0.42, 0.05], ankR: [-0.42, 0.05], toeL: [0.15, 0, 1], toeR: [-0.15, 0, 1],
    wrL: [0.84, 2.95, 0.12], wrR: [-0.84, 2.95, 0.12], handL: [0.05, -1, 0.1], palmL: [-1, 0, 0], handR: [-0.05, -1, 0.1], palmR: [1, 0, 0] }),
  batStance: () => ({ pelvis: [0.05, 3.08, -0.08], pitch: 12, twist: -6, spine: [8, -4, 2], chest: [6, -8, 0], neck: [-6, 32, 0], head: [2, 44, 6],
    ankL: [1.32, 0.18], ankR: [-1.32, -0.02], toeL: [0.3, 0, 1], toeR: [0.05, 0, 1], kneeL: [0.25, 0.2, 1], kneeR: [-0.25, 0.2, 1],
    bat: { knob: [-0.62, 4.5, 1.02], dir: [-0.3, 0.86, -0.42] }, elbL: [0.45, -1, 0.75], elbR: [-1, 0.15, -0.35] }),
  batLoad: () => ({ pelvis: [-0.1, 3.0, -0.1], pitch: 13, twist: -14, spine: [8, -8, 2], chest: [6, -14, 0], neck: [-6, 38, 0], head: [2, 46, 6],
    ankL: [1.95, 0.22], ankR: [-1.3, -0.02], toeL: [0.6, 0, 1], toeR: [0.05, 0, 1], kneeL: [-0.1, 0.2, 1], kneeR: [-0.25, 0.2, 1],
    bat: { knob: [-0.82, 4.55, 0.82], dir: [-0.45, 0.76, -0.47] }, elbL: [0.5, -1, 0.7], elbR: [-1, 0.2, -0.4] }),
  catcher: () => ({ pelvis: [0, 1.55, -0.3], pitch: 16, spine: [12, 0, 0], chest: [8, 0, 0], neck: [-22, 0, 0], head: [-14, 0, 0],
    ankL: [1.05, 0.1], ankR: [-1.05, 0.1], toeL: [0.45, 0, 1], toeR: [-0.45, 0, 1], kneeL: [0.7, 0.5, 1], kneeR: [-0.7, 0.5, 1],
    wrL: [0.42, 2.45, 1.55], elbL: [1, -0.6, -0.2], handL: [0.05, 1, 0.25], palmL: [0, 0.1, 1],
    wrR: [-0.6, 2.25, -0.55], elbR: [-1, 0, 0.2], handR: [0, -1, -0.3], palmR: [1, 0, 0] }),
  umpire: () => ({ pelvis: [0, 2.35, -0.45], pitch: 34, spine: [10, 0, 0], chest: [6, 0, 0], neck: [-30, 0, 0], head: [-22, 0, 0],
    ankL: [1.15, -0.1], ankR: [-1.05, -0.3], toeL: [0.4, 0, 1], toeR: [-0.4, 0, 1], kneeL: [0.6, 0.2, 1], kneeR: [-0.6, 0.2, 1],
    wrL: [0.88, 2.15, 0.55], wrR: [-0.86, 2.15, 0.5], elbL: [1, 0, -0.4], elbR: [-1, 0, -0.4], handL: [0, -1, 0.4], palmL: [0, 0, -1], handR: [0, -1, 0.4], palmR: [0, 0, -1] }),
  infield: () => ({ pelvis: [0, 2.55, -0.15], pitch: 28, spine: [14, 0, 0], chest: [8, 0, 0], neck: [-26, 0, 0], head: [-20, 0, 0],
    ankL: [1.3, 0.2], ankR: [-1.3, 0.2], toeL: [0.45, 0, 1], toeR: [-0.45, 0, 1], kneeL: [0.55, 0.2, 1], kneeR: [-0.55, 0.2, 1],
    wrL: [0.5, 2.15, 1.5], elbL: [1, -0.3, -0.2], handL: [0.1, -0.6, 1], palmL: [0, 0.5, 0.9], wrR: [-0.45, 2.2, 1.45], elbR: [-1, -0.3, -0.2], handR: [0, -0.6, 1], palmR: [0.5, 0.3, 0.8] }),
  outfield: () => ({ pelvis: [0, 3.0, -0.1], pitch: 20, spine: [10, 0, 0], neck: [-18, 0, 0], head: [-12, 0, 0],
    ankL: [0.95, 0.15], ankR: [-0.95, 0.15], toeL: [0.3, 0, 1], toeR: [-0.3, 0, 1], kneeL: [0.4, 0.2, 1], kneeR: [-0.4, 0.2, 1],
    wrL: [0.72, 2.3, 0.82], wrR: [-0.72, 2.3, 0.82], elbL: [1, 0, -0.3], elbR: [-1, 0, -0.3], handL: [0, -1, 0.3], palmL: [-0.3, 0, -1], handR: [0, -1, 0.3], palmR: [0.3, 0, -1] }),
  runner: () => ({ pelvis: [0, 2.65, -0.1], pitch: 26, spine: [10, 0, 0], neck: [-24, 0, 0], head: [-16, 0, 0],
    ankL: [1.55, 0.1], ankR: [-1.55, 0.0], toeL: [0.5, 0, 1], toeR: [-0.4, 0, 1], kneeL: [0.6, 0.2, 1], kneeR: [-0.6, 0.2, 1],
    wrL: [0.55, 2.35, 0.95], wrR: [-0.55, 2.35, 0.95], handL: [0, -1, 0.2], handR: [0, -1, 0.2] }),
  coach: () => ({ pelvis: [0, 3.38, 0], pitch: 5, spine: [3, 0, 0], neck: [0, 0, 0],
    ankL: [0.6, 0.0], ankR: [-0.6, 0.0], toeL: [0.25, 0, 1], toeR: [-0.25, 0, 1],
    wrL: [0.12, 4.05, 0.82], wrR: [-0.12, 4.05, 0.84], elbL: [1, -0.5, 0], elbR: [-1, -0.5, 0], handL: [-0.3, 0.8, 0.3], palmL: [-1, 0, 0], handR: [0.3, 0.8, 0.3], palmR: [1, 0, 0] }),
  ondeck: () => ({ pelvis: [0, 1.95, -0.35], pitch: 6, spine: [4, 0, 0], neck: [-4, -10, 0],
    ankL: [0.6, 0.55], ankR: [-0.5, 0.3, -1.55], plantR: false, toeL: [0.2, 0, 1], toeR: [0, -0.4, -1], kneeL: [0.2, 0.6, 1], kneeR: [0, -1, 0.6],
    bat: { knob: [-0.1, 2.9, 0.85], dir: [-0.15, 0.92, -0.38] }, elbL: [0.6, -1, 0.3], elbR: [-0.8, -1, 0.2] }),
  // the pitcher, set: yaw 90, so +x local is toward the plate
  pSet: () => ({ pelvis: [0.3, 3.4, 0], pitch: 3, spine: [2, 0, 0], neck: [-2, 48, 0], head: [0, 40, 0],
    ankL: [1.3, 0.08], ankR: [-0.2, 0.0], toeL: [0.35, 0, 1], toeR: [0, 0, 1], kneeL: [0.2, 0.2, 1], kneeR: [0, 0.2, 1],
    wrL: [0.42, 3.95, 0.72], wrR: [0.18, 3.92, 0.7], elbL: [1, -0.4, -0.3], elbR: [-1, -0.4, -0.3], handL: [-0.6, 0.6, 0.5], palmL: [-1, 0, 0.2], handR: [0.6, 0.5, 0.4], palmR: [1, 0, 0] }),
  // the rest of the delivery, the look-dev's six frames: the leg lift, the stride, the arm cocked,
  // the release and the follow-through
  pLift: () => ({ pelvis: [0.05, 3.48, -0.05], pitch: 2, twist: -8, spine: [-2, -4, 0], chest: [-2, -8, 0], neck: [-2, 50, 0], head: [0, 45, 0],
    ankL: [0.4, 2.05, 0.55], plantL: false, ankR: [-0.2, 0.0], toeL: [0, -0.7, 1], toeR: [0, 0, 1], kneeL: [0, 0.7, 1], kneeR: [0, 0.2, 1],
    wrL: [0.3, 4.55, 0.68], wrR: [0.1, 4.5, 0.66], elbL: [1, -0.4, -0.3], elbR: [-1, -0.4, -0.3], handL: [-0.6, 0.6, 0.5], palmL: [-1, 0, 0.2], handR: [0.6, 0.5, 0.4], palmR: [1, 0, 0] }),
  pStride: () => ({ pelvis: [1.25, 3.18, 0.0], pitch: 4, twist: 8, spine: [2, 0, 0], chest: [0, -6, 6], neck: [-4, 45, 0], head: [0, 40, 0],
    ankL: [3.6, 0.95, 0.35], plantL: false, ankR: [-0.15, 0.0], toeL: [1, -0.35, 0.1], toeR: [0.2, -0.2, 1], kneeL: [1, 0.3, 0.3], kneeR: [0.5, 0.2, 1],
    wrL: [2.35, 4.55, -0.15], elbL: [0.2, -0.4, 1], handL: [1, 0.1, -0.2], palmL: [0, -0.3, -1],
    wrR: [-0.75, 3.75, 0.85], elbR: [-0.5, 0.3, 1], handR: [-1, -0.2, 0], palmR: [0, -1, 0] }),
  pCocked: () => ({ pelvis: [2.5, 3.0, 0.1], pitch: 8, twist: 44, spine: [4, 6, 0], chest: [2, -8, 10], neck: [-6, 34, 0], head: [-4, 22, 0],
    ankL: [5.05, 0.3], ankR: [0.05, 0.05], toeL: [1, 0, -0.15], toeR: [0.5, -0.3, 1], kneeL: [1, 0.3, 0], kneeR: [1, -0.1, 0.4],
    wrL: [4.1, 4.75, -0.5], elbL: [0.2, -0.6, -1], handL: [1, 0.2, 0], palmL: [0, 0, -1],
    wrR: [1.15, 5.12, 1.38], elbR: [-0.77, -0.3, 0.64], handR: [-0.1, 1, 0.05], palmR: [-1, 0, 0.1] }),
  pRelease: () => ({ pelvis: [3.6, 2.88, 0.18], pitch: 27, twist: 82, spine: [12, 12, -8], chest: [10, 16, -14], neck: [-18, -8, 0], head: [-16, -10, 0],
    ankL: [5.45, 0.32], ankR: [2.1, 1.25, 0.05], plantR: false, toeL: [1, 0, -0.1], toeR: [0.6, -0.9, 0.1], kneeL: [1, 0.25, 0], kneeR: [1, -0.45, 0.2],
    wrL: [4.45, 3.95, -0.85], elbL: [-0.2, -0.6, -1], handL: [0.2, 0.6, -0.6], palmL: [0.2, 0, 1],
    wrR: [6.25, 5.3, 1.15], elbR: [-0.2, -0.35, 1], handR: [1, 0.2, -0.05], palmR: [0.1, -0.2, -1] }),
  pFollow: () => ({ pelvis: [4.0, 2.72, 0.32], pitch: 36, twist: 96, spine: [18, 10, 0], chest: [10, 10, 0], neck: [-28, 0, 0], head: [-28, 0, 0],
    ankL: [5.4, 0.42], ankR: [2.6, 2.0, -0.55], plantR: false, toeL: [1, 0, -0.1], toeR: [-0.4, -0.8, -0.2], kneeL: [1, 0.2, 0], kneeR: [1, -0.4, 0],
    wrL: [4.75, 3.65, -0.6], elbL: [-0.3, -0.5, -1], handL: [0.4, 0.8, 0], palmL: [-1, 0, 0],
    wrR: [5.15, 2.05, -0.95], elbR: [-0.3, 0.6, 1], handR: [0.3, -1, -0.2], palmR: [0, 0, 1] }),
  // a bent-leg slide, feet first: lying back on the right hip, the lead leg straight at the bag, the
  // trail leg folded under it, both hands up out of the way of the tag
  slide: () => ({ pelvis: [0, 0.92, 0], pitch: -58, roll: 14, spine: [12, 0, 0], chest: [12, 0, 0], neck: [34, 0, 0], head: [16, 0, 0],
    ankL: [0.3, 0.42, 2.95], plantL: false, ankR: [0.05, 0.3, 1.25], plantR: false, toeL: [0, 0.7, 0.7], toeR: [0.4, -0.2, 1], kneeL: [0, 1, 0.15], kneeR: [-1, 0.5, 0.4],
    wrL: [0.85, 3.25, -0.35], elbL: [1, 0, -0.2], handL: [0.1, 1, 0.1], palmL: [0, 0, 1],
    wrR: [-1.0, 2.95, -1.35], elbR: [-1, 0, -0.2], handR: [-0.1, 1, -0.1], palmR: [0, 0, 1] }),
  // a fielder astride the bag, the glove swept down in front of it, the bare hand covering
  tag: () => ({ pelvis: [0, 2.3, -0.3], pitch: 44, spine: [16, 0, 0], chest: [10, 0, 0], neck: [-8, 0, 0], head: [-6, 0, 0],
    ankL: [1.45, 0.25], ankR: [-1.45, 0.1], toeL: [0.6, 0, 1], toeR: [-0.6, 0, 1], kneeL: [0.7, 0.2, 1], kneeR: [-0.7, 0.2, 1],
    wrL: [0.3, 0.95, 1.8], elbL: [1, 0.2, 0.2], handL: [0.15, -0.85, 0.5], palmL: [-0.3, -0.4, -0.85],
    wrR: [-0.15, 1.2, 1.6], elbR: [-1, 0.2, 0.2], handR: [0.4, -0.7, 0.6], palmR: [0.9, 0.4, -0.1] }),
  // a base umpire's safe: arms flat out to the sides
  safe: () => ({ pelvis: [0, 3.25, 0], pitch: 10, spine: [4, 0, 0], chest: [2, 0, 0], neck: [-14, 0, 0], head: [-16, 0, 0],
    ankL: [0.95, 0.1], ankR: [-0.95, 0.05], toeL: [0.3, 0, 1], toeR: [-0.3, 0, 1], kneeL: [0.3, 0.2, 1], kneeR: [-0.3, 0.2, 1],
    wrL: [2.8, 4.55, 0.45], elbL: [0, -1, 0], handL: [1, 0, 0.05], palmL: [0, -1, 0],
    wrR: [-2.8, 4.55, 0.45], elbR: [0, -1, 0], handR: [-1, 0, 0.05], palmR: [0, -1, 0] }),
  // the pose a skinned body is built in: standing straight, arms down and out at about forty
  // degrees, elbows a touch bent, so the shoulders and elbows bend least on the way to anything
  bind: () => ({ pelvis: [0, 3.42, 0], pitch: 0, spine: [0, 0, 0], chest: [0, 0, 0],
    ankL: [0.42, 0.05], ankR: [-0.42, 0.05], toeL: [0.1, 0, 1], toeR: [-0.1, 0, 1], kneeL: [0, 0, 1], kneeR: [0, 0, 1],
    wrL: [1.82, 3.4, 0.22], wrR: [-1.82, 3.4, 0.22], elbL: [0.25, -0.3, -1], elbR: [-0.25, -0.3, -1],
    handL: [0.55, -0.8, 0.1], palmL: [-0.8, -0.5, 0.2], handR: [-0.55, -0.8, 0.1], palmR: [0.8, -0.5, 0.2] }),
};

// ── the bones ──────────────────────────────────────────────────────────────────
// Twenty frames a body hangs from. A frame is an origin and three axes; `boneFrames` writes each as
// twelve floats, the x, y and z axes and then the origin.
export const BONES = Object.freeze(['pelvis', 'spine', 'chest', 'neck', 'head',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR',
  'upperArmL', 'forearmL', 'handL', 'upperArmR', 'forearmR', 'handR',
  'fistL', 'fistR', 'bat']);
export const BONE = Object.freeze(Object.fromEntries(BONES.map((n, i) => [n, i])));
export const FRAME_FLOATS = 12;

// `v` with its part along the unit `y` taken out, as a unit. Where `v` runs nearly along `y` its
// direction means little, so `alt` is blended in, smoothly, and a frame never flips as a limb
// swings through its pole.
function across(v, y, alt) {
  const a = sub(v, mul(y, dot(v, y))), la = len(a);
  if (la > 0.35) return mul(a, 1 / la);
  const b = norm(sub(alt, mul(y, dot(alt, y)))), k = la / 0.35;
  const c = la > 1e-9 ? add(mul(a, k / la), mul(b, 1 - k)) : b;
  return len(c) > 1e-6 ? norm(c) : b;
}

// The bones' frames for a solved pose (`solvePose`). A limb's frame runs down the limb and turns
// with the way its knee or elbow points, so the hinge is always about the frame's own x. The open
// hands fold away while they grip a bat, and the fists and the bat while they don't.
export function boneFrames(sol, out = new Float32Array(BONES.length * FRAME_FLOATS)) {
  const { J, W } = sol;
  const put = (b, X, Y, Z, o) => {
    const k = b * FRAME_FLOATS;
    out[k] = X[0]; out[k + 1] = X[1]; out[k + 2] = X[2];
    out[k + 3] = Y[0]; out[k + 4] = Y[1]; out[k + 5] = Y[2];
    out[k + 6] = Z[0]; out[k + 7] = Z[1]; out[k + 8] = Z[2];
    out[k + 9] = o[0]; out[k + 10] = o[1]; out[k + 11] = o[2];
  };
  const limb = (b, a, c, pole, alt) => { const Y = norm(sub(c, a)), Z = across(pole, Y, alt); put(b, cross(Y, Z), Y, Z, a); };
  const hide = (b) => put(b, [0, 0, 0], [0, 0, 0], [0, 0, 0], J.pelvis);
  put(BONE.pelvis, ...W.pelvis, J.pelvis); put(BONE.spine, ...W.spine, J.spine); put(BONE.chest, ...W.chest, J.chest);
  put(BONE.neck, ...W.neck, J.neck); put(BONE.head, ...W.head, J.head);
  const fwdP = W.pelvis[2], backC = mul(W.chest[2], -1);
  for (const S of ['L', 'R']) {
    limb(BONE['thigh' + S], J['hip' + S], J['kn' + S], J['kpole' + S], fwdP);
    limb(BONE['shin' + S], J['kn' + S], J['an' + S], J['kpole' + S], fwdP);
    { const Z = norm(sub(J['toe' + S], J['an' + S])), Y = across(sub(J['kn' + S], J['an' + S]), Z, W.pelvis[1]); put(BONE['foot' + S], cross(Y, Z), Y, Z, J['an' + S]); }
    limb(BONE['upperArm' + S], J['sh' + S], J['el' + S], J['epole' + S], backC);
    limb(BONE['forearm' + S], J['el' + S], J['wr' + S], J['epole' + S], backC);
    if (J['grip' + S]) {
      hide(BONE['hand' + S]);
      const c = J['hand' + S], d = J.batDir, bk = across(sub(J['wr' + S], c), d, backC);
      put(BONE['fist' + S], cross(d, bk), d, bk, c);
    } else {
      const Y = J['hdir' + S], Z = across(J['palm' + S], Y, backC);
      put(BONE['hand' + S], cross(Y, Z), Y, Z, J['hand' + S]);
      hide(BONE['fist' + S]);
    }
  }
  if (J.batKnob) {
    const d = J.batDir, S = J.batBottom, Z = across(sub(J['wr' + S], J['hand' + S]), d, backC);
    put(BONE.bat, cross(d, Z), d, Z, J.batKnob);
  } else hide(BONE.bat);
  return out;
}

// The frames a body is built in: the bind pose for the body, and a batting stance for the fists
// and the bat, which have nowhere to be in the bind pose. gl/ballplayer-mesh.js builds each part
// from the same two solves.
export const bindPoses = (scale = 1) => ({ body: { ...POSES.bind(), at: [0, 0, 0], yaw: 0, scale }, grip: { ...POSES.batStance(), at: [0, 0, 0], yaw: 0, scale } });
export function bindFrames(scale = 1) {
  const { body, grip } = bindPoses(scale);
  const out = boneFrames(solvePose(body)), g = boneFrames(solvePose(grip));
  for (const b of [BONE.fistL, BONE.fistR, BONE.bat]) out.set(g.subarray(b * FRAME_FLOATS, (b + 1) * FRAME_FLOATS), b * FRAME_FLOATS);
  return out;
}

// Each bone's skin transform, its frame now after the inverse of its frame in the bind pose, as
// three rows of four (the rotation's row and the move): the layout gl/skin.js uploads. A folded
// bone's rows are all move, so what hangs from it shrinks to a point inside the body.
export function skinRows(frames, bind, out = new Float32Array(BONES.length * 12)) {
  for (let b = 0; b < BONES.length; b++) {
    const p = b * FRAME_FLOATS, q = b * FRAME_FLOATS, o = b * 12;
    for (let i = 0; i < 3; i++) {
      // R = Rp · Rbᵀ: column k of a frame is its axis k
      let r0 = 0, r1 = 0, r2 = 0;
      for (let k = 0; k < 3; k++) {
        const pk = frames[p + k * 3 + i];
        r0 += pk * bind[q + k * 3]; r1 += pk * bind[q + k * 3 + 1]; r2 += pk * bind[q + k * 3 + 2];
      }
      out[o + i * 4] = r0; out[o + i * 4 + 1] = r1; out[o + i * 4 + 2] = r2;
      out[o + i * 4 + 3] = frames[p + 9 + i] - (r0 * bind[q + 9] + r1 * bind[q + 10] + r2 * bind[q + 11]);
    }
  }
  return out;
}
