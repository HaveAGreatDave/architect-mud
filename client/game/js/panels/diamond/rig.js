// DEADBALL · THE RIG. A player's skeleton: the pose language a clip is keyed in, the solver that
// turns a pose into joints, and the bones a skinned body hangs from.
//
// A pose (POSES) says where a man stands and how: the pelvis and its tilt and twist, the spine,
// chest, neck and head as small turns, and his hands and feet as targets in his own frame, with a
// direction for each knee and elbow to point. `solvePose` works the torso and head out by forward
// kinematics and the limbs by two-bone IK to those targets; a bat in two hands decides where the
// hands go. Each shoulder rides its collarbone toward where its hand is going (the girdle), and
// the arms are kept out of the body: a hand or a bat that would sink into it is moved off, and
// each elbow swings clear (HULL). That's the language the clips are keyed in (diamond/anim.js), so
// the IK is in every frame and a hand on a bat stays on it.
//
// The bones (BONES) are what the GPU skins by (gl/skin.js): twenty-two frames, from the pelvis to
// the bat and the collarbones. `boneFrames` reads them off a solved pose, and a body built once in
// the bind pose (gl/ballplayer-mesh.js buildBody) follows them. A fist and the bat have bones of
// their own, folded away to nothing when the hands aren't on a bat, and the open hands fold away
// when they are.
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

// The pelvis and the hips, by forward kinematics: where the torso starts, and all that
// anim.js fitPlants needs, which runs on every sample.
function pelvisOf(P) {
  const s = P.scale || 1, at = P.at || [0, 0, 0];
  const Yw = RY(P.yaw || 0);
  const toW = (v) => add(at, m3v(Yw, v));
  const W = m3m(Yw, m3m(RY(P.twist || 0), m3m(RX(P.pitch || 0), RZ(P.roll || 0)))), pelvis = toW(P.pelvis);
  const hip = (sg) => add(pelvis, m3v(W, [sg * 0.31 * s, -0.10 * s, 0]));
  return { s, Yw, toW, W, pelvis, hipL: hip(1), hipR: hip(-1) };
}
export function solveHips(P) {
  const H = pelvisOf(P);
  return { pelvis: H.pelvis, hipL: H.hipL, hipR: H.hipR };
}

// The torso and head alone, by forward kinematics, with the shoulders and hips: what a layer that
// needs only the hips, the chest or the eyes can have without solving the limbs.
export function solveTorso(P) {
  const H = pelvisOf(P), { s, Yw, toW } = H;
  const J = {}, W = {};
  W.pelvis = H.W;
  J.pelvis = H.pelvis;
  W.spine = m3m(W.pelvis, EUL(P.spine)); J.spine = add(J.pelvis, m3v(W.pelvis, [0, 0.35 * s, 0]));
  W.chest = m3m(W.spine, EUL(P.chest)); J.chest = add(J.spine, m3v(W.spine, [0, 0.55 * s, -0.02 * s]));
  W.neck = m3m(W.chest, EUL(P.neck)); J.neck = add(J.chest, m3v(W.chest, [0, 0.60 * s, 0]));
  W.head = m3m(W.neck, EUL(P.head)); J.head = add(J.neck, m3v(W.neck, [0, 0.34 * s, 0.03 * s]));
  for (const [S, sg] of [['L', 1], ['R', -1]]) {
    J['sh' + S] = add(J.chest, m3v(W.chest, [sg * SHOULDER[0] * s, SHOULDER[1] * s, SHOULDER[2] * s]));
    J['hip' + S] = H['hip' + S];
  }
  return { J, W, s, Yw, toW };
}

// ── the shoulder girdle ────────────────────────────────────────────────────────
// A shoulder rides its collarbone: up when the arm goes up, forward and in when the hand reaches
// forward or across the body, back when it reaches behind. Each shoulder moves toward where its
// hand is asked to be, by up to GIRDLE's feet each way, more the further the hand is, its
// collarbone turning about the sternoclavicular joint (SC_JOINT, in the chest's frame, x the left
// side's) to take it there: a hitter's front shoulder tucks in under his chin, a thrower's rides up
// and through, and an arm across the chest crosses in front of it rather than through it. The
// move is always toward the hand, so it never stretches an arm the pose had in reach, and there's
// none for a hand tucked in close, which it would only fold tighter than an elbow goes. The
// collarbones are bones of their own (clavL, clavR): the top of each arm hangs from its own.
// SHOULDER is the joint at rest, in the chest's frame.
export const SHOULDER = Object.freeze([0.64, 0.43, -0.04]);
export const SC_JOINT = Object.freeze([0.10, 0.52, 0.17]);
export const GIRDLE = Object.freeze({ up: 0.22, fwd: 0.24, back: 0.12, in: 0.06 });
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// x eased into (-m, m): about x itself while it's small, never past m
const soft = (x, m) => x / Math.sqrt(1 + (x / m) * (x / m));
// the turn taking unit vector a to unit vector b, as three columns
function turnTo(a, b) {
  const v = cross(a, b), c = dot(a, b), k = 1 / (1 + Math.max(c, -0.999));
  const col = (i) => {
    const e = [0, 0, 0]; e[i] = 1;
    // Rodrigues: e·c + (v × e) + v (v·e) k
    const vx = cross(v, e);
    return [e[0] * c + vx[0] + v[0] * v[i] * k, e[1] * c + vx[1] + v[1] * v[i] * k, e[2] * c + vx[2] + v[2] * v[i] * k];
  };
  return [col(0), col(1), col(2)];
}
function girdle(J, W, S, T, s) {
  const sg = S === 'L' ? 1 : -1, C = W.chest;
  const rest = [sg * SHOULDER[0] * s, SHOULDER[1] * s, SHOULDER[2] * s], sc = [sg * SC_JOINT[0] * s, SC_JOINT[1] * s, SC_JOINT[2] * s];
  // where the hand is asked to be from the shoulder at rest, in the chest's frame
  const d = sub(T, add(J.chest, m3v(C, rest)));
  const lx = dot(d, C[0]), ly = dot(d, C[1]), lz = dot(d, C[2]), l = Math.hypot(lx, ly, lz) || 1e-6;
  const ux = lx / l, uy = ly / l, uz = lz / l, across = Math.max(0, -sg * ux);
  const far = sstep(0.7 * s, 1.6 * s, l) * s;
  const on = SOLVER.girdle ? 1 : 0;
  const m = [-sg * GIRDLE.in * across * far * on, GIRDLE.up * sstep(0.05, 1, uy) * far * on,
    clamp(GIRDLE.fwd * (Math.max(0, uz) + 0.5 * across) - GIRDLE.back * Math.max(0, -uz), -GIRDLE.back, GIRDLE.fwd) * far * on];
  // on round the collarbone, the same length from its joint as at rest
  const a0 = sub(rest, sc), a = norm(a0), b = norm(add(a0, m)), G = turnTo(a, b);
  J['clav' + S] = add(J.chest, m3v(C, sc));
  W['clav' + S] = m3m(C, G);
  J['sh' + S] = add(J['clav' + S], m3v(C, mul(b, len(a0))));
}

// ── keeping the limbs out of the body ──────────────────────────────────────────
// The body as the arms see it (HULL): the hips, the belly, the chest and the top of it, and the
// head, each an ellipsoid in a torso frame, a little inside the jersey (gl/ballplayer-mesh.js
// TORSO) so that an arm kept off them can lie against the cloth without sinking into it. The
// solver keeps a free hand's target off the hull, and a bat in two hands with its hands; then it
// swings each elbow about the line from the shoulder to the wrist, from where the pose points it,
// until the upper arm and forearm are clear (ARM_BALLS, balls along each). Every push eases in
// over SINK_SOFT feet, so the arm slides along the body rather than bouncing off it, and the solve
// stays as smooth in time as the pose it's given.
export const HULL = Object.freeze([
  Object.freeze({ frame: 'pelvis', c: Object.freeze([0, -0.08, -0.03]), r: Object.freeze([0.56, 0.33, 0.40]) }),
  Object.freeze({ frame: 'pelvis', c: Object.freeze([0, 0.24, 0.0]), r: Object.freeze([0.54, 0.2, 0.36]) }),
  Object.freeze({ frame: 'spine', c: Object.freeze([0, 0.12, 0.0]), r: Object.freeze([0.52, 0.40, 0.37]) }),
  Object.freeze({ frame: 'chest', c: Object.freeze([0, 0.20, 0.03]), r: Object.freeze([0.57, 0.36, 0.42]) }),
  Object.freeze({ frame: 'chest', c: Object.freeze([0, 0.46, 0.0]), r: Object.freeze([0.46, 0.17, 0.34]) }),
  Object.freeze({ frame: 'head', c: Object.freeze([0, 0.31, 0.03]), r: Object.freeze([0.31, 0.42, 0.37]), head: true }),
]);
// [segment ('up' the upper arm, 'fore' the forearm), share of the way down it, radius]
export const ARM_BALLS = Object.freeze([['up', 0.55, 0.18], ['up', 0.8, 0.165], ['up', 1, 0.15], ['fore', 0.3, 0.15], ['fore', 0.6, 0.13], ['fore', 0.85, 0.11]].map(Object.freeze));
// how much the balls move, all told, as the elbow swings: each by its share of the elbow's move
const ARM_K2 = ARM_BALLS.reduce((t, [seg, f]) => t + (seg === 'up' ? f : 1 - f) ** 2, 0);
// the hand's balls from the wrist along the hand, and the bat's from the knob along it
const HAND_BALLS = Object.freeze([[0, 0.1], [0.12, 0.085], [0.25, 0.07]]);
const BAT_BALLS = Object.freeze([[0.17, 0.09], [0.45, 0.09], [0.8, 0.05], [1.2, 0.06], [1.6, 0.075], [2.0, 0.095], [2.4, 0.105], [2.7, 0.1]]);
export const SINK_SOFT = 0.03;
// The girdle and the hull, each on unless switched off here: for the Pose Lab and the gates to see
// what they add, never for the game.
export const SOLVER = { girdle: true, hull: true, steps: 1, gain: 2 };
// the most an elbow swings off where the pose points it, in radians, and the furthest a push
// takes a wrist from its shoulder (at rest): short of where the IK starts to soften
const SWING_MOST = 1.4, ARM_REACH = 0.95 * (0.98 + 0.90);
const softplus = (x) => (x > 12 * SINK_SOFT ? x : SINK_SOFT * Math.log1p(Math.exp(x / SINK_SOFT)));
// The legs, once they're solved, as capsules round each thigh (from a little below the hip, where
// it runs into the seat) and shin (LEG_HULL: [from, to, radius] along hip to knee and knee to
// ankle), a little inside the pants and socks, so a glove taking a grounder or a forearm in a
// crouch rests against the leg rather than through it.
export const LEG_HULL = Object.freeze([[0.3, 1, 0.25], [0, 0.88, 0.165]].map(Object.freeze));
export function hullOf(J, W, s) {
  if (!SOLVER.hull) return [];
  const out = HULL.map((h) => { const M = W[h.frame]; return { c: add(J[h.frame], m3v(M, mul(h.c, s))), M, r: mul(h.r, s), head: !!h.head }; });
  if (J.knL) for (const S of ['L', 'R']) {
    const [th, sh] = LEG_HULL, hip = J['hip' + S], kn = J['kn' + S], an = J['an' + S];
    out.push({ cap: true, a: lerp3(hip, kn, th[0]), b: lerp3(hip, kn, th[1]), r: th[2] * s, leg: true });
    out.push({ cap: true, a: lerp3(kn, an, sh[0]), b: lerp3(kn, an, sh[1]), r: sh[2] * s, leg: true });
  }
  return out;
}
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
// a point's distance from a capsule's surface (inside negative), and the way out in `out`
function capsuleAt(h, p, out) {
  const ab = [h.b[0] - h.a[0], h.b[1] - h.a[1], h.b[2] - h.a[2]], ap = [p[0] - h.a[0], p[1] - h.a[1], p[2] - h.a[2]];
  const t = clamp((ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / ((ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2]) || 1e-9), 0, 1);
  const dx = ap[0] - ab[0] * t, dy = ap[1] - ab[1] * t, dz = ap[2] - ab[2] * t, d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
  out[0] = dx / d; out[1] = dy / d; out[2] = dz / d;
  return d - h.r;
}
const CAP_N = [0, 0, 0];
// How far a ball of radius r at p sinks into the hull: the sum over its parts, each eased by
// softplus, and in `out` the way out, each part's normal by how far it sinks.
export function sinkInto(hull, p, r, out) {
  out[0] = 0; out[1] = 0; out[2] = 0;
  let tot = 0;
  for (let i = 0; i < hull.length; i++) {
    const h = hull[i];
    if (h.cap) {
      const v = r - capsuleAt(h, p, CAP_N);
      if (v < -8 * SINK_SOFT) continue;
      const w = softplus(v);
      out[0] += w * CAP_N[0]; out[1] += w * CAP_N[1]; out[2] += w * CAP_N[2];
      tot += w;
      continue;
    }
    const M = h.M, R = h.r;
    const qx = p[0] - h.c[0], qy = p[1] - h.c[1], qz = p[2] - h.c[2];
    const ax = (qx * M[0][0] + qy * M[0][1] + qz * M[0][2]) / R[0], ay = (qx * M[1][0] + qy * M[1][1] + qz * M[1][2]) / R[1], az = (qx * M[2][0] + qy * M[2][1] + qz * M[2][2]) / R[2];
    const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
    const bx = ax / R[0], by = ay / R[1], bz = az / R[2], k1 = Math.sqrt(bx * bx + by * by + bz * bz);
    // the ellipsoid's distance, good near its surface (k0 (k0 - 1) / k1), and how far in the ball is
    const v = r - (k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -Math.min(R[0], R[1], R[2]));
    if (v < -8 * SINK_SOFT || k1 <= 1e-9) continue;
    const w = softplus(v) / k1;
    out[0] += w * (M[0][0] * bx + M[1][0] * by + M[2][0] * bz);
    out[1] += w * (M[0][1] * bx + M[1][1] * by + M[2][1] * bz);
    out[2] += w * (M[0][2] * bx + M[1][2] * by + M[2][2] * bz);
    tot += softplus(v);
  }
  return tot;
}
// How deep the solver reaches in, by the centre of the deepest ball: a limb only touching the
// body or lying a little into it is moved clear, and one keyed right through it is left as it is
// (it eases off between DEEP[0] and DEEP[1] feet in), because the way out of the middle of the
// body flips as a limb crosses it, and a pose that flips pops. A clip that does that is the gate's
// to refuse (anim-smoke's clearance checks).
export const DEEP = Object.freeze([0.12, 0.3]);
// A point's depth in each part of the hull, each to the power DEEP_P and summed: callers add these
// up over their balls and take the root, a max that bends smoothly where one part or ball takes
// over from another, so the fade that hangs off it has no corner to kink a limb's path.
const DEEP_P = 8;
function depthPow(hull, p) {
  let sum = 0;
  for (let i = 0; i < hull.length; i++) {
    const h = hull[i];
    if (h.cap) { const d = -capsuleAt(h, p, CAP_N); if (d > 0) sum += d ** DEEP_P; continue; }
    const M = h.M, R = h.r;
    const qx = p[0] - h.c[0], qy = p[1] - h.c[1], qz = p[2] - h.c[2];
    const ax = (qx * M[0][0] + qy * M[0][1] + qz * M[0][2]) / R[0], ay = (qx * M[1][0] + qy * M[1][1] + qz * M[1][2]) / R[1], az = (qx * M[2][0] + qy * M[2][1] + qz * M[2][2]) / R[2];
    const k0 = Math.sqrt(ax * ax + ay * ay + az * az), k1 = Math.hypot(ax / R[0], ay / R[1], az / R[2]);
    const d = k1 > 1e-9 ? -k0 * (k0 - 1) / k1 : Math.min(R[0], R[1], R[2]);
    if (d > 0) sum += d ** DEEP_P;
  }
  return sum;
}
// A move that takes a set of balls off the hull: each ball's way out, weighted by how far in it
// is, three times over, all of it scaled by how shallow the deepest one is to start with. `reach`
// says how far the move may take each of a set of points from where it starts, as [point, shoulder,
// most]: a push that would stretch an arm past `most` from its shoulder is cut short.
function clearOf(hull, balls, s, move, reach = []) {
  const out = [0, 0, 0], off = [0, 0, 0];
  let deep = 0;
  for (const [p] of balls(off)) deep += depthPow(hull, p);
  deep **= 1 / DEEP_P;
  const g = 1 - sstep(DEEP[0] * s, DEEP[1] * s, deep);
  if (g <= 0) return move(off);
  for (let it = 0; it < 3; it++) {
    let wx = 0, wy = 0, wz = 0, wt = 0;
    for (const [p, r] of balls(off)) {
      const k = sinkInto(hull, p, r * s, out);
      if (k <= 0) continue;
      const n = Math.hypot(out[0], out[1], out[2]) || 1;
      wx += out[0] / n * k * k; wy += out[1] / n * k * k; wz += out[2] / n * k * k; wt += k;
    }
    if (wt <= 1e-9) break;
    off[0] += g * wx / wt; off[1] += g * wy / wt; off[2] += g * wz / wt;
  }
  // no further from a shoulder than an arm reaches, or than the pose already had it
  let f = 1;
  for (const [p, sh, most] of reach) {
    const d0 = len(sub(p, sh)), d1 = len(sub(add(p, off), sh)), lim = Math.max(most, d0);
    if (d1 > lim && d1 > d0 + 1e-9) f = Math.min(f, (lim - d0) / (d1 - d0));
  }
  return move(mul(off, clamp(f, 0, 1)));
}
// A free hand's wrist target t0 kept off the hull, with the hand on the end of it pointing `hd`, by
// `w` of the push: a pose's `clearL` and `clearR` (1 unless it says), which the clip player eases in
// over the segment after a bat is let go and out before one's taken up (anim.js batHandoff), as the
// bat keeps its hands off the body in its own way. A hand with no way of its own to point goes on
// along the forearm, which the girdle and the elbow haven't settled yet, so its balls are taken
// from the chest out through the wrist.
function pushHand(hull, J, W, s, S, t0, hd, w = 1) {
  if (!(w > 0)) return t0;
  const sg = S === 'L' ? 1 : -1;
  const along = hd || norm(sub(t0, add(J.chest, m3v(W.chest, [sg * 0.3 * s, 0.3 * s, 0]))));
  // the torso only: a hand near the head is often meant to be (a throw past the ear, the sign), and a
  // glove near the legs is going for a ball by the shins, which it has to get to
  const body = hull.filter((h) => !h.head && !h.leg);
  const T = clearOf(body, (off) => { const p = add(t0, off); return HAND_BALLS.map(([at, r]) => [add(p, mul(along, at * s)), r]); }, s, (off) => add(t0, off), [[t0, J['sh' + S], ARM_REACH * s]]);
  return w >= 1 ? T : [t0[0] + (T[0] - t0[0]) * w, t0[1] + (T[1] - t0[1]) * w, t0[2] + (T[2] - t0[2]) * w];
}
// The arm from shoulder A to wrist target T (lengths l1, l2), its elbow pointing toward `pole` and
// swung clear of the hull: [elbow, wrist, the way the elbow points].
function armClear(A, T, l1, l2, pole, hull, s) {
  const d = sub(T, A), dist = Math.max(1e-4, len(d)), dir = mul(d, 1 / dist);
  const L = l1 + l2, sw = L * IK_SOFT, da = L - sw;
  const D = clamp(dist > da ? da + sw * (1 - Math.exp(-(dist - da) / sw)) : dist, Math.abs(l1 - l2) + 1e-3, L - 1e-5);
  const a = Math.acos(clamp((l1 * l1 + D * D - l2 * l2) / (2 * l1 * D), -1, 1));
  let p = sub(pole, mul(dir, dot(pole, dir)));
  if (len(p) < 1e-5) p = Math.abs(dir[1]) < 0.9 ? cross(dir, [0, 1, 0]) : cross(dir, [1, 0, 0]);
  p = norm(p);
  const q = cross(dir, p), ca = l1 * Math.cos(a), sa = l1 * Math.sin(a), Wr = add(A, mul(dir, D));
  const elbowAt = (phi) => { const c = Math.cos(phi), sn = Math.sin(phi); return [p[0] * c + q[0] * sn, p[1] * c + q[1] * sn, p[2] * c + q[2] * sn]; };
  const out = [0, 0, 0], P = [0, 0, 0];
  // the deepest ball's centre where the pose has the elbow, for how much say the hull gets
  let deep = 0;
  {
    const E = [A[0] + dir[0] * ca + p[0] * sa, A[1] + dir[1] * ca + p[1] * sa, A[2] + dir[2] * ca + p[2] * sa];
    for (const [seg, f] of ARM_BALLS) {
      const from = seg === 'up' ? A : E, to = seg === 'up' ? E : Wr;
      P[0] = from[0] + (to[0] - from[0]) * f; P[1] = from[1] + (to[1] - from[1]) * f; P[2] = from[2] + (to[2] - from[2]) * f;
      deep += depthPow(hull, P);
    }
    deep **= 1 / DEEP_P;
  }
  // and nothing for an arm near straight, whose elbow has nowhere to swing to: there the swing would
  // only turn the arm about itself
  const g = (1 - sstep(DEEP[0] * s, DEEP[1] * s, deep)) * sstep(0.05, 0.2, Math.sin(a));
  // Steps down the slope of the balls' sinking, each the same share of how far a swing moves them
  // (ARM_K2), whatever's in the body, so the swing grows from nothing as the arm comes into it
  let phi = 0;
  for (let it = 0; it < SOLVER.steps && g > 0; it++) {
    const pe = elbowAt(phi), c = Math.cos(phi), sn = Math.sin(phi);
    const E = [A[0] + dir[0] * ca + pe[0] * sa, A[1] + dir[1] * ca + pe[1] * sa, A[2] + dir[2] * ca + pe[2] * sa];
    const dE = [(-p[0] * sn + q[0] * c) * sa, (-p[1] * sn + q[1] * c) * sa, (-p[2] * sn + q[2] * c) * sa], dE2 = dot(dE, dE);
    if (dE2 < 1e-9) break;
    let num = 0;
    for (const [seg, f, r] of ARM_BALLS) {
      const up = seg === 'up', k = up ? f : 1 - f;
      const from = up ? A : E, to = up ? E : Wr;
      P[0] = from[0] + (to[0] - from[0]) * f; P[1] = from[1] + (to[1] - from[1]) * f; P[2] = from[2] + (to[2] - from[2]) * f;
      if (sinkInto(hull, P, r * s, out) > 0) num += k * (out[0] * dE[0] + out[1] * dE[1] + out[2] * dE[2]);
    }
    phi += g * clamp(SOLVER.gain * num / (ARM_K2 * dE2), -0.4, 0.4);
  }
  phi = soft(phi, SWING_MOST);
  const pe = elbowAt(phi), mid = add(A, add(mul(dir, ca), mul(pe, sa)));
  return [mid, add(mid, mul(norm(sub(T, mid)), l2)), pe];
}

// The whole pose: the torso, then each leg and arm by two-bone IK to its target, the arms kept
// clear of the body. `J.anT` and `J.wrT` are where each ankle and wrist was asked to be (the wrist
// after the hull has had its say), so a gate can see a limb fall short.
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
  // hand touching it, as a hitter holds a bat; and the bat and its hands are kept off the body
  const hands = {}, hull = hullOf(J, W, s);
  if (P.bat) {
    const bd = dirW(P.bat.dir), bottom = P.bat.bottom || 'L', top = bottom === 'L' ? 'R' : 'L';
    const chestC = add(J.chest, m3v(W.chest, [0, 0.2 * s, 0.25 * s]));
    const grip = (knob) => {
      const g = {};
      for (const [S, at] of [[bottom, 0.17], [top, 0.45]]) {
        const hc = add(knob, mul(bd, at * s));
        let v = sub(chestC, hc); v = norm(sub(v, mul(bd, dot(v, bd))));
        g[S] = { hc, wr: add(add(hc, mul(v, 0.19 * s)), mul(bd, -0.06 * s)) };
      }
      return g;
    };
    const knob0 = toW(P.bat.knob), g0 = grip(knob0);
    const knob = clearOf(hull.filter((h) => !h.leg), (off) => {
      const k = add(knob0, off), g = grip(k);
      return [...BAT_BALLS.map(([at, r]) => [add(k, mul(bd, at * s)), r]), [g.L.wr, 0.1], [g.R.wr, 0.1]];
    }, s, (off) => add(knob0, off), ['L', 'R'].map((S) => [g0[S].wr, J['sh' + S], ARM_REACH * s]));
    J.batKnob = knob; J.batDir = bd; J.batBottom = bottom;
    const g = grip(knob);
    for (const S of ['L', 'R']) { J['hand' + S] = g[S].hc; J['grip' + S] = true; hands[S] = g[S].wr; }
  }
  // a free hand's target, kept off the body along with the hand on the end of it
  const T = {}, hdir = {};
  for (const S of ['L', 'R']) {
    if (hands[S]) { T[S] = hands[S]; continue; }
    hdir[S] = P['hand' + S] ? dirW(P['hand' + S]) : null;
    T[S] = pushHand(hull, J, W, s, S, toW(P['wr' + S]), hdir[S], P['clear' + S] ?? 1);
  }
  for (const S of ['L', 'R']) girdle(J, W, S, T[S], s);
  for (const [S, sg] of [['L', 1], ['R', -1]]) {
    const ep = dirW(P['elb' + S] || [sg * 0.4, -0.2, -1]);
    const [el, wr, pe] = armClear(J['sh' + S], T[S], 0.98 * s, 0.90 * s, ep, hull, s);
    J['el' + S] = el; J['wr' + S] = wr; J['wrT' + S] = T[S]; J['epole' + S] = pe;
    if (!J['hand' + S]) {
      const hd = hdir[S] || norm(sub(wr, el));
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
  for (const k of ['ank', 'toe', 'knee', 'wr', 'elb', 'hand', 'palm', 'plant', 'clear']) {
    const L = P[k + 'L'], R = P[k + 'R'];
    const f = k === 'plant' || k === 'clear' ? (x) => x : (v) => (v && v.length === 2 ? [-v[0], v[1]] : fx(v));
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
// Twenty-two frames a body hangs from. A frame is an origin and three axes; `boneFrames` writes
// each as twelve floats, the x, y and z axes and then the origin. The collarbones came last, so
// they're at the end.
export const BONES = Object.freeze(['pelvis', 'spine', 'chest', 'neck', 'head',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR',
  'upperArmL', 'forearmL', 'handL', 'upperArmR', 'forearmR', 'handR',
  'fistL', 'fistR', 'bat', 'clavL', 'clavR']);
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
    put(BONE['clav' + S], ...W['clav' + S], J['clav' + S]);
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
