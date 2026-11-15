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
// onto Deadball's and stretched along it to Deadball's length (Deadball's man has an athlete's legs, about 9%
// longer than the figure's) and scaled across it by the man's size. The joints meet: every row takes the
// figure's own joint to Deadball's, so the parent's end and the child's start land in the same place. The head
// is placed exactly where ballplayer-mesh.js puts its own, so the caps, helmets and masks it grows off the
// skull still fit.
//
// A hand round a bat hangs from the fist Deadball works out for it: the thumb up the handle toward the barrel,
// the back of the hand toward the wrist. How the fingers close is the record's `hands` (gl/figure-hands.js),
// which `handsOf` says.
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
    // round a bat: the thumb (forward, as the figure stands) up the handle, the back of the hand toward the wrist
    grip: [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
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

// The figure's rows for a solved pose. `sol` is rig.js solvePose's { J, W, s }, `frames` its boneFrames. `fit`
// is the man's figureFit (his widths). Every grown bone (figure.js FIGURE_XBONES) rides the pelvis: no
// ballplayer has one yet.
export function figureRows(sol, frames, fit = null, out = new Float32Array(FIG_ROW_FLOATS)) {
  const { J, W, s } = sol, k = FT * s, wide = fit?.wide ?? 1, sh = fit?.sh ?? 1, limbK = fit?.limb ?? 1;
  // the torso: each bone's own frame, the figure's joint on Deadball's, as wide as his shoulders or hips
  const hipW = len(sub(J.hipL, J.hipR)) / (2 * FIG_JOINT.thighL[0]) / k;
  put(out, FIGURE_BONE.pelvis, W.pelvis, J.pelvis, I3, FIG_JOINT.pelvis, [k * hipW * wide, k, k * wide]);
  put(out, FIGURE_BONE.spine, W.spine, J.spine, I3, FIG_JOINT.spine, [k * wide * (hipW + sh) / 2, k, k * wide]);
  put(out, FIGURE_BONE.chest, W.chest, J.chest, I3, FIG_JOINT.chest, [k * sh * wide, k, k * wide]);
  put(out, FIGURE_BONE.neck, W.neck, J.neck, I3, FIG_JOINT.neck, [k, k, k]);
  // the head where ballplayer-mesh.js builds its own, so a cap grown off that skull sits on this one
  const kh = k * headScaleOf(s), c = J.head.map((v, i) => v + W.head[1][i] * (0.31 * s - HEAD_SINK * kh) + W.head[2][i] * 0.03 * s);
  put(out, FIGURE_BONE.head, W.head, c, I3, HEAD_BIND_C, [kh, kh, kh]);
  for (const S of ['L', 'R']) {
    const lk = k * limbK;
    // the legs: hip to knee to ankle, the foot off the ankle
    put(out, FIGURE_BONE['thigh' + S], axesOf(frames, BONE['thigh' + S]), J['hip' + S], FIG_FRAME.thigh, FIG_JOINT['thigh' + S], [lk, RIG_LEN.thigh * s / (FIG_JOINT['thigh' + S][1] - FIG_JOINT['shin' + S][1]), lk]);
    put(out, FIGURE_BONE['shin' + S], axesOf(frames, BONE['shin' + S]), J['kn' + S], FIG_FRAME.shin, FIG_JOINT['shin' + S], [lk, RIG_LEN.shin * s / (FIG_JOINT['shin' + S][1] - FIG_JOINT['foot' + S][1]), lk]);
    const foot = axesOf(frames, BONE['foot' + S]);
    put(out, FIGURE_BONE['foot' + S], foot, J['an' + S], FIG_FRAME['foot' + S], FIG_JOINT['foot' + S], [k, k, k]);
    put(out, FIGURE_BONE['toe' + S], foot, J['an' + S], FIG_FRAME['foot' + S], FIG_JOINT['foot' + S], [k, k, k]);
    // the arms: shoulder to elbow to wrist, the hand off the wrist
    const ua = 'uarm' + S, fa = 'farm' + S, hd = 'hand' + S;
    put(out, FIGURE_BONE[ua], axesOf(frames, BONE['upperArm' + S]), J['sh' + S], FIG_FRAME.uarm, FIG_JOINT[ua], [lk, RIG_LEN.uarm * s / (FIG_JOINT[ua][1] - FIG_JOINT[fa][1]), lk]);
    put(out, FIGURE_BONE[fa], axesOf(frames, BONE['forearm' + S]), J['el' + S], FIG_FRAME.farm, FIG_JOINT[fa], [lk, RIG_LEN.farm * s / (FIG_JOINT[fa][1] - FIG_JOINT[hd][1]), lk]);
    if (J['grip' + S]) put(out, FIGURE_BONE[hd], axesOf(frames, BONE['fist' + S]), J['wr' + S], FIG_FRAME.grip, FIG_JOINT[hd], [k, k, k]);
    else put(out, FIGURE_BONE[hd], axesOf(frames, BONE['hand' + S]), J['wr' + S], FIG_FRAME['hand' + S], FIG_JOINT[hd], [k, k, k]);
  }
  // every bone past the skeleton rides the pelvis
  for (let b = FIGURE_BONES.length; b < FIGURE_BONE_COUNT; b++) out.set(out.subarray(FIGURE_BONE.pelvis * 12, FIGURE_BONE.pelvis * 12 + 12), b * 12);
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
  bat: Object.freeze({ f: Object.freeze([0.9, 0.94, 0.98, 1.02]), th: 0.7, op: 0.75, sp: 0 }),
  glove: Object.freeze({ f: Object.freeze([0.25, 0.25, 0.25, 0.25]), th: 0.2, op: 0.15, sp: 0 }),
  free: Object.freeze({ f: Object.freeze([0.22, 0.27, 0.32, 0.36]), th: 0.25, op: 0.1, sp: 0.05 }),
});
export function handHolds(J, glove) {
  const of = (S) => (J['grip' + S] ? HAND_HOLD.bat : glove === S ? HAND_HOLD.glove : HAND_HOLD.free);
  return { L: of('L'), R: of('R') };
}

// His body as the figure's build: how heavy (figure.js somaOf, ectomorph to endomorph, in tenths so men share
// meshes), which sculpted build, and the widths his rows add (`wide` all round, `sh` the shoulders, `limb`
// round the arms and legs). Off his build from diamond/cast.js buildOf and his role.
const WEIGHT_OF_ROLE = { pitcher: 0.42, catcher: 0.62, coach: 0.66, ump: 0.62, crew: 0.56 };
export function figureFit(look) {
  const girth = look?.girth ?? 0, belly = look?.belly ?? 0, role = look?.role || 'player';
  const w0 = WEIGHT_OF_ROLE[role] ?? 0.5;
  const weight = Math.round(Math.max(0.2, Math.min(0.9, w0 + 2.5 * girth + 4 * belly)) * 10) / 10;
  const build = belly > 0.012 && SCULPT_BUILDS.dadbod ? 'dadbod' : 'average';
  return { weight, build, wide: 1, sh: look?.shoulders ?? 1, limb: 1 };
}
