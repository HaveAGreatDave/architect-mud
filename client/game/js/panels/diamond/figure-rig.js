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
import { BONE, BONES, FRAME_FLOATS, boneFrames } from './rig.js';
import { FT_M } from '../../../../shared/world-scale.js';
import { HANDS, BAT_HANDS } from './hands.js';

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

// A hand round a bat: the hole its fingers close round (HAND_HOLD.bat) in the left hand's bind space, palmward of
// the wrist and below it, and the handle's line through it along the knuckle line (+z, the thumb's way) turned
// `tilt` about x, so it lies across the palm on a slant as a real grip's does. The fingers close round it and press
// onto it (GRIP_HOLD: the skin curled into the wood is laid on it, as flesh flattens). Fitted 2026-11-15 with each
// finger's joints for what a camera sees: of the handle along the grip, round it, two 3 mm cells a row show through
// the hand, at the seam and where the hand ends, where five of the 24 did with the fingers bent free and nine with
// the grip before (whose hole was fitted only so no finger went into the handle: from behind the batter you saw
// the bat across his hands). The hand is turned about the handle so the line from the handle to the wrist points
// at Deadball's wrist; the figure's wrist, 4.9 cm out, is a centimetre short of it, and the forearm is drawn to it
// (gripWrist).
export const GRIP_HOLE = Object.freeze({ in: 0.024, down: 0.043, z: 0.0, tilt: -0.3 });
// The hole and the handle's line in the left hand's bind space, and the wrist off the line (its foot on the line
// and how far out it is), for side S.
function gripBind(S) {
  const side = S === 'L' ? 1 : -1, wr = FIG_JOINT['hand' + S];
  const hole = [wr[0] - side * GRIP_HOLE.in, wr[1] - GRIP_HOLE.down, GRIP_HOLE.z], yf = [0, Math.sin(GRIP_HOLE.tilt), Math.cos(GRIP_HOLE.tilt)];
  const v = sub(wr, hole), along = dot(v, yf), foot = hole.map((x, i) => x + yf[i] * along), off = sub(wr, foot);
  return { hole, yf, foot, zf: norm(off), out: len(off) };
}
const GRIP_BIND = { L: gripBind('L'), R: gripBind('R') };
// The bat's handle where the hands go, its radius in feet a unit of scale (ballplayer-mesh.js BAT_DOMED: 0.037 to
// 0.04 ft between the knob's neck and the top hand), and the handle as a hand on it holds it (gl/figure-hands.js
// holdPush): in the left hand's bind space, the line through GRIP_HOLE at that radius, so the skin of a finger
// curled into it is laid on the wood.
export const BAT_HANDLE_R = 0.038;
export const GRIP_HOLD = Object.freeze({ at: Object.freeze(GRIP_BIND.L.hole), dir: Object.freeze(GRIP_BIND.L.yf), r: BAT_HANDLE_R * FT_M });
// Where the figure's wrist is for a hand on the bat (park feet): out from the handle toward Deadball's wrist, by the
// figure's own reach from the handle. figureRows stretches the forearm to it; the gate holds the hand to it.
export function gripWrist(sol, S) {
  const { J, s } = sol, d = J.batDir, toW = sub(J['wr' + S], J['hand' + S]), cA = J['hand' + S].map((v, i) => v + d[i] * dot(toW, d));
  const bk = norm(sub(J['wr' + S], cA)), r = GRIP_BIND[S].out * FT * (s || 1);
  return cA.map((v, i) => v + bk[i] * r);
}
// A gloved hand is tucked into the glove: drawn this much of its size about its palm, so no finger comes out
// through the leather (the glove is ballplayer-mesh.js's, on Deadball's hand)
export const GLOVE_TUCK = 0.7;
const PALM_DOWN = 0.06;

// The figure's rows for a solved pose. `sol` is rig.js solvePose's { J, W, s }, `frames` its boneFrames. `fit` is
// the man's figureFit; `glove` the side his glove is on, if he wears one. Every grown bone (figure.js
// FIGURE_XBONES) rides the pelvis: no ballplayer has one yet.
// A hand round a bat can hold it either way round: its thumb toward the barrel or toward the knob (both hands
// overhand, as on a broom, the thumbs point at each other). The rig says only where the handle and the wrist are, so
// each hand takes whichever way round leaves its wrist the smaller turn on its forearm: held wrong, the top hand stood
// 160° to 180° round from its forearm in the stance and its wrist's skin was blended the long way round into a
// spike. `grip` ({ L, R }, true for thumb-to-knob) is kept per man between frames by the caller and updated here; a
// hand turns over only when the other way is better by GRIP_TURN_HOLD, so it doesn't flicker on the line.
export const GRIP_TURN_HOLD = 40 * Math.PI / 180;
let ALT_ROWS = null;
export function figureRows(sol, frames, fit = null, out = new Float32Array(FIG_ROW_FLOATS), glove = null, grip = null) {
  const g = { L: !!grip?.L, R: !!grip?.R };
  ALT_ROWS ??= new Float32Array(FIG_ROW_FLOATS);
  rowsOnce(sol, frames, out, glove, g);
  if (sol.J.gripL || sol.J.gripR) {
    // each hand both ways round, its wrist's real turn each way (a hand's row depends on nothing of the other's)
    const now = forearmTwist(out), alt = { L: !g.L, R: !g.R }, other = forearmTwist(rowsOnce(sol, frames, ALT_ROWS, glove, alt));
    let again = false;
    for (const S of ['L', 'R']) {
      if (!sol.J['grip' + S]) continue;
      if (Math.abs(other[S]) + GRIP_TURN_HOLD < Math.abs(now[S])) { g[S] = !g[S]; again = true; }
    }
    if (again) rowsOnce(sol, frames, out, glove, g);
    if (grip) Object.assign(grip, g);
  }
  return out;
}

// The rows with each gripping hand held the way round `grip` says ({ L, R }, true for thumb-to-knob), never turned:
// for the tools that key a clip's elbows to its grip (scripts/shapes/elbow-fit.mjs).
export const figureRowsHeld = (sol, frames, out, grip, glove = null) => rowsOnce(sol, frames, out, glove, grip);
function rowsOnce(sol, frames, out, glove, grip) {
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
      // turned over (grip[S]), the thumb points to the knob: half a turn about the line to the wrist
      const bk = norm(sub(J['wr' + S], cA)), dd = grip?.[S] ? d.map((v) => -v) : d, Fd = [cross(dd, bk), dd, bk];
      // the handle's line in the hand on the bat's, the wrist's foot on it at cA
      const G = GRIP_BIND[S];
      put(out, FIGURE_BONE[hd], Fd, cA, [cross(G.yf, G.zf), G.yf, G.zf], G.foot, one(k));
      // and the forearm from Deadball's elbow to the figure's wrist, which is out past Deadball's: turned the least
      // that points it there and stretched whole to reach (a turn and one scale, as the skinning wants)
      const w2 = cA.map((v, i) => v + bk[i] * G.out * k), el = J['el' + S], y0 = norm(sub(J['wr' + S], el)), y1 = norm(sub(w2, el));
      const ax = cross(y0, y1), sn = len(ax), cs = dot(y0, y1), A = axesOf(frames, BONE['forearm' + S]);
      const turn = (v) => (sn < 1e-9 ? v : (() => { const u = ax.map((x) => x / sn), c = dot(u, v), x = cross(u, v); return v.map((q, i) => q * cs + x[i] * sn + u[i] * c * (1 - cs)); })());
      put(out, FIGURE_BONE['farm' + S], A.map(turn), el, FIG_FRAME.farm, FIG_JOINT['farm' + S], one(len(sub(w2, el)) / (FIG_JOINT['farm' + S][1] - FIG_JOINT[hd][1])));
    } else if (glove === S) {
      // in the glove: tucked in about its palm, at the glove's hand
      put(out, FIGURE_BONE[hd], axesOf(frames, BONE[hd]), J[hd], FIG_FRAME[hd], [wr[0], wr[1] - PALM_DOWN, wr[2]], one(k * GLOVE_TUCK));
    } else put(out, FIGURE_BONE[hd], axesOf(frames, BONE[hd]), J['wr' + S], FIG_FRAME[hd], wr, one(k));
  }
  // every bone past the skeleton rides the pelvis, but the collarbones, which the shoulders are weighted to, ride the chest
  for (let b = FIGURE_BONES.length; b < FIGURE_BONE_COUNT; b++) {
    const src = b === FIGURE_BONE.clavL || b === FIGURE_BONE.clavR ? FIGURE_BONE.chest : FIGURE_BONE.pelvis;
    out.set(out.subarray(src * 12, src * 12 + 12), b * 12);
  }
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
// How the hands are held when nothing keys them, from the hand-shape library (diamond/hands.js): round a bat the
// power grip, in a glove a light curl, on the ball a four-seamer, free, loose.
export const HAND_HOLD = Object.freeze({ bat: HANDS.bat, glove: HANDS.glove, ball: HANDS.ball, free: HANDS.free });
// The pitcher's grip for the pitch he's about to throw, by diamond/flight.js's pitch types: the close-up of his
// hand in his set is a live tell, so it's the pitch the server chose. Anything else in a hand (a fielder's throw,
// the warm-ups) is a four-seamer. The fingers on the ball are curled till their tips meet it at BALL_HOLD (fitted
// on the built hand's skin, 2026-11-15; figure-rig.mjs holds every finger out of it): so the grips differ in how the
// fingers spread and which ones are on the ball, not in how hard they're curled. The curve's index is lifted off it.
const G =(f, th, op, sp) => Object.freeze({ f: Object.freeze(f), th, op, sp });
export const PITCH_GRIPS = Object.freeze({
  'four-seam fastball': HAND_HOLD.ball,
  // two-seam: the same two fingers, closer together and along the seams
  sinker: G([0.43, 0.46, 0.85, 0.95], 0.55, 0.9, -0.3),
  // off-centre, the fingers a touch closer: the cutter a little, the slider more and the thumb further under
  cutter: G([0.43, 0.46, 0.88, 0.95], 0.5, 0.85, -0.25),
  slider: G([0.43, 0.46, 0.9, 0.95], 0.45, 0.95, -0.35),
  // the circle change: the index curled right round to meet the thumb, the other three spread over the ball
  changeup: G([1.05, 0.46, 0.56, 0.68], 0.85, 1.0, 0.15),
  // the curve: the middle finger on the seam doing the work, the index lifted off it
  curveball: G([0.35, 0.46, 0.9, 0.95], 0.6, 0.9, -0.05),
  // the splitter: the two fingers forked wide either side of the ball
  splitter: G([0.41, 0.45, 0.9, 0.95], 0.55, 0.9, 0.55),
  // the knuckleball: the fingertips dug into the hide, the knuckles up: a pose joint by joint (the index and middle
  // fingers folded at their middle joints more than their knuckles, fitted till their tips meet the ball), not a curl
  knuckleball: Object.freeze({ j: Object.freeze([0.8, 1.2, 0.72, 0.024, 0.9, 0.9, 0.54, 0.008, 0.975, 0.938, 0.6, -0.008, 1.144, 1.1, 0.704, -0.024, 0.066, 0.81, 0.121, 0.148]) }),
});
export const gripOf = (type) => PITCH_GRIPS[String(type || '').toLowerCase()] || HAND_HOLD.ball;
// Where a ball sits in a hand that holds it, in the left hand's bind space (metres; the right's mirrors x): out on
// the fingers, about 7 cm off the palm and toward the thumb, where the four-seamer's index and middle fingertips
// and the thumb's pad all touch it and nothing goes in. Fitted on the built hand's skin, 2026-11-15. The director
// had it as Deadball's old hand did, 4.6 cm out of the palm on the hand's line, which on the figure put its middle
// 2 cm off the palm and the ring and little fingers 2 to 3 cm into it.
export const BALL_HOLD = Object.freeze([0.108, 0.792, 0.052]);
const HOLD_FRAMES = new Float32Array(BONES.length * FRAME_FLOATS);
// That point in the park (feet) for a solved pose (rig.js solvePose's { J, s }), on hand S, as figureRows hangs a
// free hand: for diamond/director.js pitcherBall, which puts the pitcher's ball in his fingers.
export function ballInHand(sol, S) {
  boneFrames(sol, HOLD_FRAMES);
  const hd = 'hand' + S, A = axesOf(HOLD_FRAMES, BONE[hd]), Ff = FIG_FRAME[hd], h = FIG_JOINT[hd], k = FT * (sol.s || 1);
  const p = S === 'L' ? BALL_HOLD : [-BALL_HOLD[0], BALL_HOLD[1], BALL_HOLD[2]], d = [p[0] - h[0], p[1] - h[1], p[2] - h[2]];
  const c = Ff.map((f) => (f[0] * d[0] + f[1] * d[1] + f[2] * d[2]) * k), wr = sol.J['wr' + S];
  return [0, 1, 2].map((i) => wr[i] + A[0][i] * c[0] + A[1][i] * c[1] + A[2][i] * c[2]);
}
// `ball` is where the ball is (the park's feet), or null: a free hand it's in holds it, in `grip` (a PITCH_GRIPS
// shape) or the four-seam grip. `keyed` is what the clip keys for each hand (hands.js handsAt, on the pose as
// `hands`): a shape by name and how much of it, '' for the hand as it would be. A hand round the bat takes only a
// bat grip from it, a gloved hand and a hand on the ball none; a free hand takes any. Each hand comes back as
// [[shape, weight], ...] (gl/figure-hands.js handPose mixes them).
export const BALL_IN_HAND = 0.45;
export function handHolds(J, glove, ball = null, grip = null, keyed = null) {
  const near = (S) => ball && J['hand' + S] && Math.hypot(ball[0] - J['hand' + S][0], ball[1] - J['hand' + S][1], ball[2] - J['hand' + S][2]) < BALL_IN_HAND;
  const of = (S) => {
    const base = J['grip' + S] ? HAND_HOLD.bat : glove === S ? HAND_HOLD.glove : near(S) ? grip || HAND_HOLD.ball : HAND_HOLD.free;
    const list = keyed?.[S];
    if (!list || glove === S || (!J['grip' + S] && near(S))) return [[base, 1]];
    const ok = (n) => n && HANDS[n] && (!J['grip' + S] || BAT_HANDS.includes(n));
    return list.map(([n, w]) => [ok(n) ? HANDS[n] : base, w]);
  };
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
