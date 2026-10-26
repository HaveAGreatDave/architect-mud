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
// runs a little arm-side, a curve drops below it and breaks glove-side, a slider sweeps. A splitter
// has little lift, so the bottom drops out, and runs a bit arm-side; a knuckleball has almost no
// spin, so only gravity pulls it, and it wobbles (`wobble`, feet either way: `knuckle`).
export const SPIN = Object.freeze({
  'four-seam fastball': { up: 15, arm: 7.5 },
  sinker: { up: 7.5, arm: 14 },
  slider: { up: 2, arm: -5 },
  changeup: { up: 4.7, arm: 11 },
  curveball: { up: -6, arm: -5 },
  cutter: { up: 7.7, arm: -2.6 },
  splitter: { up: 3, arm: 8 },
  knuckleball: { up: 0, arm: 0, wobble: 0.22 },
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
  const path = fitPath(from, through, t0, T, acc);
  return spin.wobble ? knuckle(path, spin.wobble, through) : path;
}
// A knuckleball's wobble: a drift across and up and down laid over its path, a whole number of
// half waves between the hand and the plate, so it still leaves the hand and crosses its spot
// exactly. How many, and which way first, come off where it crosses, so the same pitch always
// floats the same way. Its depth is the path's, so `cross` holds.
function knuckle(path, A, through) {
  const h = ((Math.round(through[0] * 1000) * 73856093) ^ (Math.round(through[1] * 1000) * 19349663)) >>> 0;
  const nx = 2 + (h % 2), ny = 3 - (h % 2), sx = h & 4 ? 1 : -1, sy = h & 8 ? 1 : -1;
  const at = (t) => {
    const q = path(t), u = (t - path.t0) / path.T;
    if (!(u > 0)) return q;
    return [q[0] + sx * A * Math.sin(nx * Math.PI * u), Math.max(BALL_R, q[1] + sy * A * 0.6 * Math.sin(ny * Math.PI * u)), q[2]];
  };
  return Object.assign(at, path);
}

// A throw or a lob: from `from` to `to` arriving `T` seconds later under gravity, so it arcs as
// high as it has to.
export function throwPath(from, to, t0, T) {
  return fitPath(from, to, t0, T, [0, -GRAVITY, 0], { bounce: false });
}

// ── balls in play (Phase 3) ────────────────────────────────────────────────────
// The spray direction as a unit vector on the ground: degrees from straightaway centre, negative
// toward the left-field line (+x), as diamond/play.js has it.
export const sprayVec = (dir) => [-Math.sin(dir * Math.PI / 180), 0, Math.cos(dir * Math.PI / 180)];

// A ball on the ground: off the bat at `from` at t0, along the spray `dir`, as far along it at each
// moment as `along(tau)` says (play.js rollAlong, so it reaches a fielder where and when the server
// judged it would). It goes down off the bat at its launch angle, then hops, each about half the
// last, until it rolls; it starts at the bat and is on the spray line through the plate within
// 0.4 s. `mph` and `la` are the exit speed and launch angle. `max` is as far from the plate as it
// can go (the wall on its line): one hit hard down the line stops in the corner, not past it.
export function groundPath(from, dir, mph, la, t0, along, max = Infinity) {
  const u = sprayVec(dir), s0 = Math.hypot(from[0], from[2]);
  const off = [from[0] - u[0] * s0, from[2] - u[2] * s0];
  // down to the dirt: from its height at its launch angle's speed, a chopper straight down
  const vy0 = Math.min(0, mph * MPH * Math.sin(Math.min(0, la) * Math.PI / 180));
  const h = Math.max(0, from[1] - BALL_R), tDown = (vy0 + Math.sqrt(vy0 * vy0 + 2 * GRAVITY * h)) / GRAVITY;
  // the hops: a chopper's first is the time play.js says it loses in the air; otherwise off the
  // speed it comes down at, half of it back up
  const hops = [];
  let t = tDown, air = la < -10 ? 0.45 : Math.min(0.5, (-vy0 + GRAVITY * tDown) * 0.5 * 2 / GRAVITY);
  for (let k = 0; k < 6 && air > 0.03; k++) { hops.push([t, air]); t += air; air *= 0.5; }
  const at = (tt) => {
    const tau = Math.max(0, tt - t0), s = Math.min(max, Math.max(s0 * Math.max(0, 1 - tau / 0.3), along(tau))), k = Math.max(0, 1 - tau / 0.4);
    let y = BALL_R;
    if (tau < tDown) y = Math.max(BALL_R, from[1] + vy0 * tau - 0.5 * GRAVITY * tau * tau);
    else for (const [a, T] of hops) if (tau >= a && tau <= a + T) { const v = tau - a; y = BALL_R + 0.5 * GRAVITY * v * (T - v); break; }
    return [u[0] * s + off[0] * k, y, u[2] * s + off[1] * k];
  };
  at.t0 = t0; at.dir = dir; at.along = along;
  return at;
}

// A ball in the air off the bat at `from` at t0, coming down at `to` (on the ground: y is the
// ball's radius) after T seconds, slowed along its way by the air, and after it lands, if `roll`
// says how, on along the ground to a stop no further than `roll.max` feet from the plate (the
// wall): a ball that drops in for a hit. `at.when(y)` is the time it comes down through height y.
export function flyPath(from, to, t0, T, roll = null) {
  const dx = to[0] - from[0], dz = to[2] - from[2], hl = Math.hypot(dx, dz) || 1, drag = 7;
  const acc = [-dx / hl * drag, -GRAVITY, -dz / hl * drag];
  const fly = fitPath(from, to, t0, T, acc, { bounce: false });
  const v0 = fly.v0, land = t0 + T;
  // off the grass: the speed along the ground it lands with, a third of it kept, slowing to a stop
  const u = [dx / hl, 0, dz / hl], vLand = Math.hypot(v0[0] + acc[0] * T, v0[2] + acc[2] * T) / 3;
  const k = 1.1, d0 = Math.hypot(to[0], to[2]), room = roll ? Math.max(0, (roll.max ?? Infinity) - d0) : 0;
  const along = (tau) => Math.min(room, (vLand / k) * (1 - Math.exp(-k * tau)));
  const at = (t) => {
    if (t <= land || !roll) return fly(Math.min(t, land));
    const tau = t - land, s = along(tau), hop = 0.25 * Math.max(0, 1 - tau / 0.6);
    return [to[0] + u[0] * s, BALL_R + hop * Math.abs(Math.sin(tau * 9)), to[2] + u[2] * s];
  };
  at.t0 = t0; at.T = T; at.v0 = v0; at.acc = acc; at.land = land;
  // when it comes down through height y on its way (or null if it never gets that high)
  at.when = (y) => {
    const a = 0.5 * acc[1], b = v0[1], c = from[1] - y, d = b * b - 4 * a * c;
    if (d < 0) return null;
    const r = Math.max((-b - Math.sqrt(d)) / (2 * a), (-b + Math.sqrt(d)) / (2 * a));
    return r > 0 ? t0 + r : null;
  };
  // where it is along the ground after landing, and when it stops
  at.rollFrom = land; at.rollStop = roll ? land + 3 / k : land;
  return at;
}

// A hit ball: off the bat at `from`, out at `mph` in the direction of `dir` (a unit vector), with
// the air's drag and gravity, for the cosmetic flight of a foul or a ball in play.
export function hitPath(from, dir, mph, t0) {
  const v = mph * MPH, v0 = mul(dir, v), acc = [-dir[0] * 8, -GRAVITY - dir[1] * 8, -dir[2] * 8];
  const T = 1;
  return fitPath(from, [0, 1, 2].map((i) => from[i] + v0[i] * T + 0.5 * acc[i] * T * T), t0, T, acc);
}
