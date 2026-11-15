// DEADBALL · THE FIGURE ON THE RIG. Phase 1 of docs/proposals/deadball-players-v2.md: a ballplayer's body is
// ROOM's close-up figure (figure.js, drawn by gl/figure-hd.js), hung on Deadball's own skeleton.
//
// Deadball keeps its rig, its pose language and every clip (diamond/rig.js, diamond/anim.js): a pose is solved
// as it always was, and this turns the solve into the figure's bone rows, one 3×4 a figure bone, from the
// figure's bind space (metres, Y up, facing +Z, its left hand on +X) straight into the park (in metres: the
// park's feet over FT). So nothing about how a man moves changes, and anim-smoke still judges it.
//
// Each figure bone hangs from the Deadball bone that does its job, matched axis for axis: a limb's frame runs
// down the limb and turns with the way its knee or elbow points, on both rigs, so the figure's limb is turned
// onto Deadball's and scaled whole to Deadball's length for it (Deadball's man has an athlete's legs, about 9%
// longer than the figure's). The joints meet: every row takes the figure's own joint to Deadball's, so the
// parent's end and the child's start land in the same place. Every row is a turn and one scale, which is all the
// figure's skinning can take (see figureRows). The head is placed exactly where ballplayer-mesh.js puts its own,
// so the caps, helmets and masks it grows off the skull still fit.
//
// A hand round a bat is hung by the hole its fingers close round, on the handle's axis (GRIP_HOLE), in a power
// grip (HAND_HOLD.bat); a gloved hand is tucked into the glove; and each forearm turns along its length to meet
// its hand (forearmTwist), so a wrist doesn't wring.
//
// Pure: no DOM, no GL. The gate (scripts/shapes/figure-rig.mjs) runs every clip through it.

import { FIGURE_BONES, FIGURE_BONE, FIGURE_BONE_COUNT, SCULPT_BUILDS } from '../figure.js';
import { BONE, FRAME_FLOATS } from './rig.js';
import { FT_M } from '../../../../shared/world-scale.js';

const FT = 1 / FT_M;   // feet in a metre
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// The figure's joints in bind space: each bone's head, its parents' offsets summed.
export const FIG_JOINT = (() => {
  const out = {}, at = [];
  FIGURE_BONES.forEach(([name, parent, off], i) => { at[i] = parent < 0 ? off.slice() : at[parent].map((v, k) => v + off[k]); out[name] = at[i]; });
  return Object.freeze(out);
})();

// Deadball's rig: its segment lengths, in feet a unit of scale (diamond/rig.js solvePose), and where its head
// sits on its head joint (ballplayer-mesh.js head: the head's middle, sunk onto the neck, in the head's bind
// metres, at `k` = FT · scale · scale^-0.5).
const RIG_LEN = Object.freeze({ thigh: 1.55, shin: 1.5, uarm: 0.98, farm: 0.9 });
export const HEAD_BIND_C = Object.freeze([0, 1.636, -0.006]);
const HEAD_SINK = 0.028;
export const headScaleOf = (s) => Math.pow(s, -0.5);

// The figure's own frames, matched to Deadball's (rig.js boneFrames): a limb's Y down the limb, Z the way its
// knee or elbow points (forward for a knee, back for an elbow), X = Y × Z; a free hand's Y along the fingers
// and Z out of the palm; a foot's Z to the ball of the foot, its Y up the shin. The figure stands with its
// arms straight down and the palms in.
const frameOf = (Y, Z) => { const y = norm(Y), z = norm(sub(Z, y.map((v) => v * dot(Z, y)))); return [cross(y, z), y, z]; };
const DOWN = [0, -1, 0];
const FIG_FRAME = (() => {
  const toe = norm(sub(FIG_JOINT.toeL, FIG_JOINT.footL));
  const F = {
    thigh: frameOf(DOWN, [0, 0, 1]), shin: frameOf(DOWN, [0, 0, 1]),
    uarm: frameOf(DOWN, [0, 0, -1]), farm: frameOf(DOWN, [0, 0, -1]),
    handL: frameOf(DOWN, [-1, 0, 0]), handR: frameOf(DOWN, [1, 0, 0]),
  };
  // a foot's frame is Z first (to the toe), then Y up the shin square to it
  const fz = toe, fy = norm(sub([0, 1, 0], fz.map((v) => v * fz[1])));
  F.footL = [cross(fy, fz), fy, fz]; F.footR = F.footL;
  return F;
})();
const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

// One row set: x (bind, m) → o + Fd · diag(sc) · Ffᵀ · (x − h), in feet, written as metres. Fd and Ff are
// three column axes each; sc is feet a metre along each of the figure's own axes.
function put(out, b, Fd, o, Ff, h, sc) {
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    let s = 0;
    for (let k = 0; k < 3; k++) s += Fd[k][i] * sc[k] * Ff[k][j];
    M[i][j] = s;
  }
  const r = b * 12;
  for (let i = 0; i < 3; i++) {
    out[r + i * 4] = M[i][0] * FT_M; out[r + i * 4 + 1] = M[i][1] * FT_M; out[r + i * 4 + 2] = M[i][2] * FT_M;
    out[r + i * 4 + 3] = (o[i] - (M[i][0] * h[0] + M[i][1] * h[1] + M[i][2] * h[2])) * FT_M;
  }
}
// a bone's frame out of rig.js boneFrames' twelve floats: its three axes and its origin
const axesOf = (frames, b) => { const k = b * FRAME_FLOATS; return [[frames[k], frames[k + 1], frames[k + 2]], [frames[k + 3], frames[k + 4], frames[k + 5]], [frames[k + 6], frames[k + 7], frames[k + 8]]]; };
const originOf = (frames, b) => { const k = b * FRAME_FLOATS; return [frames[k + 9], frames[k + 10], frames[k + 11]]; };

export const FIG_ROW_FLOATS = FIGURE_BONE_COUNT * 12;

// ⚠ EVERY ROW IS A TURN AND ONE SCALE. gl/figure-hd.js skins with dual quaternions and reads a bone's scale off its
// first row (boneDQ): a row stretched along a limb and not across it came out as a bent rotation, and the arms and
// legs twisted and swelled on screen while every joint here still checked out. So a limb is scaled whole, by
// Deadball's length for it over the figure's, which brings the joints together and leaves an athlete's forearms
// and thighs a little thicker than the figure's own. The gate holds every row to it.

// A hand round a bat: the hole its fingers close round (HAND_HOLD.bat, fitted against a bat's handle) in the left
// hand's bind space, palmward of the wrist and below it, its axis along the knuckle line (+z, the thumb's way).
// The handle's axis goes through it, and the hand is turned about the handle so the line from the hole to the
// wrist points at Deadball's wrist, which it meets within a few millimetres.
export const GRIP_HOLE = Object.freeze({ in: 0.036, down: 0.0445, z: 0.0 });
// A gloved hand is tucked into the glove: drawn this much of its size about its palm, so no finger comes out
// through the leather (the glove is ballplayer-mesh.js's, on Deadball's hand)
export const GLOVE_TUCK = 0.7;
const PALM_DOWN = 0.06;

// The figure's rows for a solved pose. `sol` is rig.js solvePose's { J, W, s }, `frames` its boneFrames. `fit` is
// the man's figureFit; `glove` the side his glove is on, if he wears one. Every grown bone (figure.js
// FIGURE_XBONES) rides the pelvis: no ballplayer has one yet.
export function figureRows(sol, frames, fit = null, out = new Float32Array(FIG_ROW_FLOATS), glove = null) {
  const { J, W, s } = sol, k = FT * s;
  const one = (x) => [x, x, x];
  // the torso: each bone's own frame, the figure's joint on Deadball's
  put(out, FIGURE_BONE.pelvis, W.pelvis, J.pelvis, I3, FIG_JOINT.pelvis, one(k));
  put(out, FIGURE_BONE.spine, W.spine, J.spine, I3, FIG_JOINT.spine, one(k));
  put(out, FIGURE_BONE.chest, W.chest, J.chest, I3, FIG_JOINT.chest, one(k));
  put(out, FIGURE_BONE.neck, W.neck, J.neck, I3, FIG_JOINT.neck, one(k));
  // the head where ballplayer-mesh.js builds its own, so a cap grown off that skull sits on this one
  const kh = k * headScaleOf(s), c = J.head.map((v, i) => v + W.head[1][i] * (0.31 * s - HEAD_SINK * kh) + W.head[2][i] * 0.03 * s);
  put(out, FIGURE_BONE.head, W.head, c, I3, HEAD_BIND_C, one(kh));
  for (const S of ['L', 'R']) {
    const side = S === 'L' ? 1 : -1;
    // a limb, from its joint, scaled whole by Deadball's length for it over the figure's
    const limb = (fb, rb, at, F, a, b, L) => put(out, FIGURE_BONE[fb], axesOf(frames, BONE[rb]), at, F, FIG_JOINT[fb], one(L * s / (FIG_JOINT[a][1] - FIG_JOINT[b][1])));
    // the legs: hip to knee to ankle, the foot off the ankle
    limb('thigh' + S, 'thigh' + S, J['hip' + S], FIG_FRAME.thigh, 'thigh' + S, 'shin' + S, RIG_LEN.thigh);
    limb('shin' + S, 'shin' + S, J['kn' + S], FIG_FRAME.shin, 'shin' + S, 'foot' + S, RIG_LEN.shin);
    const foot = axesOf(frames, BONE['foot' + S]);
    put(out, FIGURE_BONE['foot' + S], foot, J['an' + S], FIG_FRAME['foot' + S], FIG_JOINT['foot' + S], one(k));
    put(out, FIGURE_BONE['toe' + S], foot, J['an' + S], FIG_FRAME['foot' + S], FIG_JOINT['foot' + S], one(k));
    // the arms: shoulder to elbow to wrist
    const hd = 'hand' + S, wr = FIG_JOINT[hd];
    limb('uarm' + S, 'upperArm' + S, J['sh' + S], FIG_FRAME.uarm, 'uarm' + S, 'farm' + S, RIG_LEN.uarm);
    limb('farm' + S, 'forearm' + S, J['el' + S], FIG_FRAME.farm, 'farm' + S, hd, RIG_LEN.farm);
    if (J['grip' + S]) {
      // round the bat: the grip's hole on the handle's axis, where it passes the wrist
      const d = J.batDir, toW = sub(J['wr' + S], J['hand' + S]), cA = J['hand' + S].map((v, i) => v + d[i] * dot(toW, d));
      const bk = norm(sub(J['wr' + S], cA)), Fd = [cross(d, bk), d, bk];
      const hole = [wr[0] - side * GRIP_HOLE.in, wr[1] - GRIP_HOLE.down, GRIP_HOLE.z];
      const zf = norm([side * GRIP_HOLE.in, GRIP_HOLE.down, 0]), yf = [0, 0, 1];
      put(out, FIGURE_BONE[hd], Fd, cA, [cross(yf, zf), yf, zf], hole, one(k));
    } else if (glove === S) {
      // in the glove: tucked in about its palm, at the glove's hand
      put(out, FIGURE_BONE[hd], axesOf(frames, BONE[hd]), J[hd], FIG_FRAME[hd], [wr[0], wr[1] - PALM_DOWN, wr[2]], one(k * GLOVE_TUCK));
    } else put(out, FIGURE_BONE[hd], axesOf(frames, BONE[hd]), J['wr' + S], FIG_FRAME[hd], wr, one(k));
  }
  // every bone past the skeleton rides the pelvis
  for (let b = FIGURE_BONES.length; b < FIGURE_BONE_COUNT; b++) out.set(out.subarray(FIGURE_BONE.pelvis * 12, FIGURE_BONE.pelvis * 12 + 12), b * 12);
  return out;
}

// How far each forearm is turned to meet its hand (gl/figure-hd.js handXf, uHandX z and w): the hand's turn on its
// forearm about the forearm's own line, as the shader turns the forearm along its length so the wrist doesn't wring
// like a sweet wrapper. Radians, { L, R }, in the shader's sense (`side` times the turn about bind y).
const rotOf = (rows, b) => {
  const r = b * 12, sc = Math.hypot(rows[r], rows[r + 1], rows[r + 2]) || 1;
  return [0, 1, 2].map((i) => [rows[r + i * 4] / sc, rows[r + i * 4 + 1] / sc, rows[r + i * 4 + 2] / sc]);
};
export function forearmTwist(rows) {
  const out = {};
  for (const [S, side] of [['L', 1], ['R', -1]]) {
    const F = rotOf(rows, FIGURE_BONE['farm' + S]), H = rotOf(rows, FIGURE_BONE['hand' + S]);
    // Fᵀ H, the hand's turn in the forearm's bind space; its twist about y is the quaternion's y part
    const R = [0, 1, 2].map((i) => [0, 1, 2].map((j) => F[0][i] * H[0][j] + F[1][i] * H[1][j] + F[2][i] * H[2][j]));
    const qw = Math.sqrt(Math.max(0, 1 + R[0][0] + R[1][1] + R[2][2])) / 2, qy = (R[0][2] - R[2][0]) / (4 * Math.max(qw, 1e-6));
    let a = 2 * Math.atan2(qy, qw);
    if (a > Math.PI) a -= 2 * Math.PI;
    if (a < -Math.PI) a += 2 * Math.PI;
    out[S] = side * a;
  }
  return out;
}

// A bind point carried by one bone's rows, in the park's feet (for the gate, and for anything laid on him).
export function atRow(rows, b, p) {
  const r = b * 12;
  return [0, 1, 2].map((i) => (rows[r + i * 4] * p[0] + rows[r + i * 4 + 1] * p[1] + rows[r + i * 4 + 2] * p[2] + rows[r + i * 4 + 3]) * FT);
}

// ── who he is, as the figure ──────────────────────────────────────────────────────────────────────────
// How the hands are held, as gl/figure-hands.js shapes: round a bat the fingers closed on the handle and the
// thumb across them; in a glove a light curl, so nothing comes out through the leather; free, loose.
export const HAND_HOLD = Object.freeze({
  // a power grip (`gk`, gl/figure-hands.js GRIP_FLEX): fitted so the handle runs through GRIP_HOLE clear of every
  // finger. The figure's thumb bends only at its root, too far from the handle to wrap it, so it's laid up the bat's
  // line (about 30° off it, clear of the handle) rather than across it, where it stood out sideways like a spike
  bat: Object.freeze({ f: Object.freeze([0.95, 0.98, 1.01, 1.04]), th: 1.0, op: -1.0, sp: 0, gk: 1 }),
  glove: Object.freeze({ f: Object.freeze([0.25, 0.25, 0.25, 0.25]), th: 0.2, op: 0.15, sp: 0 }),
  free: Object.freeze({ f: Object.freeze([0.22, 0.27, 0.32, 0.36]), th: 0.25, op: 0.1, sp: 0.05 }),
});
export function handHolds(J, glove) {
  const of = (S) => (J['grip' + S] ? HAND_HOLD.bat : glove === S ? HAND_HOLD.glove : HAND_HOLD.free);
  return { L: of('L'), R: of('R') };
}

// His body as the figure's build: how heavy (figure.js somaOf, ectomorph to endomorph, in tenths so men share
// meshes) and which sculpted build, off his build from diamond/cast.js buildOf and his role. His widths are the
// figure's own (a row can't widen a body: see figureRows).
const WEIGHT_OF_ROLE = { pitcher: 0.42, catcher: 0.62, coach: 0.66, ump: 0.62, crew: 0.56 };
export function figureFit(look) {
  const girth = look?.girth ?? 0, belly = look?.belly ?? 0, role = look?.role || 'player';
  const w0 = WEIGHT_OF_ROLE[role] ?? 0.5;
  const weight = Math.round(Math.max(0.2, Math.min(0.9, w0 + 2.5 * girth + 4 * belly)) * 10) / 10;
  const build = belly > 0.012 && SCULPT_BUILDS.dadbod ? 'dadbod' : 'average';
  return { weight, build };
}
