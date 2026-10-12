// DEADBALL · THE BALL IN FLIGHT. A pitched, thrown or hit ball's path, fitted so it gets exactly
// where the play says, exactly when.
//
// A path is a parabola under a steady pull: gravity, the drag of the air, and for a pitch the
// spin's lift and break by its type (`SPIN`), turned for the pitcher's hand. Given where it leaves
// from, the point it has to pass and how long it takes to get there, the speed it leaves with is
// solved, so the ball passes the point to the hundredth of a foot (diamond-smoke holds it to 0.05)
// and the time is the pitch's real speed: 54 ft at 95 mph is 0.39 s, and the ball is never slowed
// to fit a hold. It runs on past the point the same way, so a pitch carries through the plate to
// the catcher; a ball that reaches the ground bounces, losing half its height each time.
//
// Positions are the park's (diamond/geo.js: feet, home plate at the origin, +z to centre field,
// +x toward third); times are seconds on the world's clock (diamond/world.js).
//
// Pure: no DOM and no GL.

export const GRAVITY = 32.17;
export const BALL_R = 0.12;            // a baseball's radius, feet
export const MPH = 5280 / 3600;        // feet a second in a mile an hour
// How much a pitch slows on the way: a quarter of a second at 95 mph loses about 8% of its speed.
const DRAG = 26;
// The spin's pull, feet a second each second, by pitch type: `up` lifts (backspin) or drops it
// (topspin), `arm` moves it toward the pitcher's throwing side (negative is toward his glove side).
// Off the movement a broadcast shows: a four-seamer rides about a foot over gravity's drop and
// runs a little arm-side, a curve drops below it and breaks glove-side, a slider sweeps.
export const SPIN = Object.freeze({
  'four-seam fastball': { up: 15, arm: 7.5 },
  sinker: { up: 7.5, arm: 14 },
  slider: { up: 2, arm: -5 },
  changeup: { up: 4.7, arm: 11 },
  curveball: { up: -6, arm: -5 },
  cutter: { up: 7.7, arm: -2.6 },
});
const spinOf = (type) => SPIN[String(type || '').toLowerCase()] || { up: 0, arm: 0 };

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

// A path through `through` at time t0 + T, leaving `from` at t0 under the pull `acc`. Returns a
// function of world time (the ball's centre), with its parts on it: `t0`, `T`, `v0`, `acc`, and
// `cross(z)`, the time it reaches the plane at depth z on its way.
export function fitPath(from, through, t0, T, acc, opts = {}) {
  const v0 = [0, 1, 2].map((i) => (through[i] - from[i] - 0.5 * acc[i] * T * T) / T);
  const bounce = opts.bounce !== false;
  // where it first comes down onto the ground, if it does: y(τ) = BALL_R
  let tGround = Infinity;
  if (bounce) {
    const a = 0.5 * acc[1], b = v0[1], c = from[1] - BALL_R, d = b * b - 4 * a * c;
    if (a < 0 && d >= 0) { const r = (-b - Math.sqrt(d)) / (2 * a); if (r > 1e-6) tGround = r; }
  }
  const raw = (tau) => [from[0] + v0[0] * tau + 0.5 * acc[0] * tau * tau, from[1] + v0[1] * tau + 0.5 * acc[1] * tau * tau, from[2] + v0[2] * tau + 0.5 * acc[2] * tau * tau];
  const at = (t) => {
    const tau = t - t0;
    if (tau < tGround) return raw(tau);
    // off the ground: half the height, the same way on, and so on (two bounces is plenty)
    let p = raw(tGround), v = add(v0, mul(acc, tGround)), left = tau - tGround;
    for (let k = 0; k < 3; k++) {
      v = [v[0] * 0.8, -v[1] * 0.5, v[2] * 0.8];
      const up = 2 * v[1] / -acc[1];
      if (!(up > 1e-3) || left <= up || k === 2) {
        const s = Math.min(left, Math.max(up, 0));
        return [p[0] + v[0] * left, Math.max(BALL_R, p[1] + v[1] * s + 0.5 * acc[1] * s * s), p[2] + v[2] * left];
      }
      p = [p[0] + v[0] * up, BALL_R, p[2] + v[2] * up]; left -= up;
    }
    return p;
  };
  at.t0 = t0; at.T = T; at.v0 = v0; at.acc = acc; at.from = from; at.through = through; at.tGround = t0 + tGround;
  // when it reaches depth z, by its own speed along z (the drag never turns it round)
  at.cross = (z) => {
    const a = 0.5 * acc[2], b = v0[2], c = from[2] - z;
    if (Math.abs(a) < 1e-9) return t0 + -c / b;
    const d = b * b - 4 * a * c;
    if (d < 0) return null;
    const r1 = (-b - Math.sqrt(d)) / (2 * a), r2 = (-b + Math.sqrt(d)) / (2 * a);
    const r = [r1, r2].filter((x) => x > 0).sort((p, q) => p - q)[0];
    return r == null ? null : t0 + r;
  };
  return at;
}

// A pitch: from the release point to `through` (where it crosses the plate, hud.js pitchPoint) at
// `mph`, by `type`, thrown by a right- (`hand` 'R') or left-hander. The time is the distance over
// the speed it averages after the drag.
export function pitchPath({ from, through, t0, mph, type, hand = 'R' }) {
  const spin = spinOf(type), v = Math.max(40, mph || 90) * MPH;
  const dist = Math.hypot(through[0] - from[0], through[1] - from[1], through[2] - from[2]);
  // the drag takes off DRAG ft/s each second, so it averages v - DRAG·T/2 over T
  const T = (v - Math.sqrt(Math.max(0, v * v - 2 * DRAG * dist))) / DRAG || dist / v;
  // the arm side of a pitcher facing the plate (-z) is +x for a right-hander
  const side = hand === 'L' ? -1 : 1;
  const acc = [spin.arm * side, -GRAVITY + spin.up, DRAG];
  return fitPath(from, through, t0, T, acc);
}

// A throw or a lob: from `from` to `to` arriving `T` seconds later under gravity, so it arcs as
// high as it has to.
export function throwPath(from, to, t0, T) {
  return fitPath(from, to, t0, T, [0, -GRAVITY, 0], { bounce: false });
}

// A hit ball: off the bat at `from`, out at `mph` in the direction of `dir` (a unit vector), with
// the air's drag and gravity, for the cosmetic flight of a foul or a ball in play.
export function hitPath(from, dir, mph, t0) {
  const v = mph * MPH, v0 = mul(dir, v), acc = [-dir[0] * 8, -GRAVITY - dir[1] * 8, -dir[2] * 8];
  const T = 1;
  return fitPath(from, [0, 1, 2].map((i) => from[i] + v0[i] * T + 0.5 * acc[i] * T * T), t0, T, acc);
}
