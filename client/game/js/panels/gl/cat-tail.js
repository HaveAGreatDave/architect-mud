// THE TAIL'S PHYSICS: a cat's tail is a chain of about twenty small bones with its own muscles, carried on a body that
// moves. The pose says where the cat means its tail to be (cat-kit.js tailTarget); this is how the tail actually gets
// there, in the room, frame by frame.
//
// Each point down the tail is a mass on a spring to where the pose wants it, stiff at the root (the big muscles at the
// base hold it) and loose toward the tip, with damping that lets the tip overshoot and settle. Gravity pulls on it,
// scaled by the muscles' tone: an awake cat carries its tail, a sleeping one lets it lie. Its length is kept by
// follow-the-leader constraints from the root out, and it can't go through what's under it (the floor, or the top
// he's sat on, with the edge where it can hang over).
//
// What that buys: the tail trails when he sets off and swings on when he stops, sweeps round after him as he turns,
// lifts and counterbalances through a jump and bounces on the landing, drapes over the edge of a counter, and settles
// on the floor round him when he sits, without a clip saying any of it.
//
// World space, metres, Y up. One sim per cat (gl/room-beasts.js keeps it on the cat's actor). Pure but for the state
// it's handed.

const G = 9.81;
// springs to the pose, per second squared: the root's, the tip's (the tail softens along its length)
const K_ROOT = 1600, K_TIP = 55;
// damping as a fraction of critical, root and tip: a whip at the tip, none of it at the root
const Z_ROOT = 0.9, Z_TIP = 0.32;
const STEP = 1 / 120;       // seconds a substep; a slow frame is cut into as many as it takes (up to MAX_SUB)
const MAX_SUB = 12;

/** A tail of `n` + 1 points. Empty until its first step, which lays it on the pose. */
export function createTail(n) {
  return { n, p: null, v: null, len: null };
}

/**
 * Move the tail `dt` seconds on toward `target` (n + 1 points, world, root first). `o`:
 *   tone   0..1, how much it holds itself up against gravity (1 awake, about 0.3 asleep)
 *   r(i)   the tail's radius at point i, metres, so it rests on what's under it rather than in it
 *   under(x, z, y) the height of whatever's under (x, z) at or below y, metres
 *   reset  true to lay it on the pose now (he's jumped rooms, or this is the first frame)
 *   kTip, zTip  the tip's spring (per second squared) and damping ratio, for this cat (gl/room-beasts.js motionOf)
 * Returns the points (world), the same arrays each call.
 */
export function stepTail(T, target, dt, o = {}) {
  const n = T.n;
  if (!T.p || o.reset || !(dt > 0)) {
    T.p = target.map((q) => q.slice());
    T.v = target.map(() => [0, 0, 0]);
    T.len = [];
    for (let i = 1; i <= n; i++) T.len.push(Math.hypot(target[i][0] - target[i - 1][0], target[i][1] - target[i - 1][1], target[i][2] - target[i - 1][2]));
    return T.p;
  }
  const tone = o.tone ?? 1, g = G * (1 - 0.88 * tone), r = o.r || (() => 0.01), under = o.under || (() => 0);
  const kTip = o.kTip ?? K_TIP, zTip = o.zTip ?? Z_TIP;
  const sub = Math.min(MAX_SUB, Math.max(1, Math.ceil(dt / STEP))), h = Math.min(dt, MAX_SUB * STEP) / sub;
  // the pose's segment lengths can change as it stretches the line; the tail's own length doesn't
  for (let s = 0; s < sub; s++) {
    // the root goes where the pelvis puts it
    for (let k = 0; k < 3; k++) T.p[0][k] = target[0][k];
    for (let i = 1; i <= n; i++) {
      const f = i / n, K = K_ROOT * Math.pow(kTip / K_ROOT, Math.pow(f, 0.7)), Z = Z_ROOT + (zTip - Z_ROOT) * f;
      const C = 2 * Z * Math.sqrt(K), P = T.p[i], V = T.v[i], Q = target[i];
      // semi-implicit Euler: the spring to the pose, the damping, the weight
      for (let k = 0; k < 3; k++) V[k] += h * (K * (Q[k] - P[k]) - C * V[k] - (k === 1 ? g : 0));
      for (let k = 0; k < 3; k++) P[k] += h * V[k];
    }
    // its length, from the root out; then whatever it's lying on
    for (let i = 1; i <= n; i++) {
      const A = T.p[i - 1], P = T.p[i], dx = P[0] - A[0], dy = P[1] - A[1], dz = P[2] - A[2], l = Math.hypot(dx, dy, dz) || 1e-9, L = T.len[i - 1];
      const nx = A[0] + dx / l * L, ny = A[1] + dy / l * L, nz = A[2] + dz / l * L, V = T.v[i];
      V[0] += (nx - P[0]) / h * 0.5; V[1] += (ny - P[1]) / h * 0.5; V[2] += (nz - P[2]) / h * 0.5;
      P[0] = nx; P[1] = ny; P[2] = nz;
      const floor = under(P[0], P[2], P[1]) + r(i);
      if (P[1] < floor) {
        P[1] = floor;
        if (V[1] < 0) V[1] = 0;
        // fur on wood: it slides, but not far
        V[0] *= 0.82; V[2] *= 0.82;
      }
    }
  }
  return T.p;
}
