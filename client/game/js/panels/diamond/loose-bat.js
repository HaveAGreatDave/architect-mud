// DEADBALL · THE LOOSE BAT. A bat let go of (the run out's drop, a home run's flip) used to fold
// away to nothing in the air. Now it carries on: from how the hands had it going in the last
// frame they held it, it flies, turning end over end, comes down in the dirt, skids and lies
// there till the next at-bat clears it.
//
// `batRelease(clip)` is the clip time a clip lets go of its bat (the last key that has one, before
// one that hasn't), or null. `launch(a, b, dt)` takes the bat in two solved frames dt apart, each
// { knob, dir } in the park, and gives the throw: `batAt(throw, t)` is where it is at t seconds
// after it, as { knob, dir }. Pure in time, so a replay or a stopped clock draws the same bat.
//
// Pure: no DOM and no GL.

import { groundHeight } from './geo.js';

export const BAT_LEN = 2.8;
// half the bat's length (its middle, near enough its balance), the barrel's radius as it lies,
// feet a second squared of gravity, the most it may be thrown (ft/s) and turned (turns a second),
// how fast a skid dies, and how long it takes to settle flat once it's down
export const LOOSE = Object.freeze({ mid: 1.55, lie: 0.11, g: 32.2, top: 45, spin: 3.2, drag: 5, flat: 0.18 });

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
// v turned about unit axis k by angle a (Rodrigues)
const rot = (v, k, a) => { const c = Math.cos(a), s = Math.sin(a); return add(add(mul(v, c), mul(cross(k, v), s)), mul(k, dot(k, v) * (1 - c))); };

export function batRelease(clip) {
  const ks = clip?.keys || [];
  for (let i = ks.length - 2; i >= 0; i--) if (ks[i].pose.bat && !ks[i + 1].pose.bat) return ks[i].t;
  return null;
}

export function launch(a, b, dt) {
  const mid = (q) => add(q.knob, mul(q.dir, LOOSE.mid));
  const c0 = mid(b);
  let v = mul(sub(c0, mid(a)), 1 / dt);
  const sp = Math.hypot(v[0], v[1], v[2]);
  if (sp > LOOSE.top) v = mul(v, LOOSE.top / sp);
  // the turn it had: about the axis across its two directions, at the rate they turned
  const ax = cross(a.dir, b.dir), s = Math.hypot(ax[0], ax[1], ax[2]);
  const axis = s > 1e-5 ? mul(ax, 1 / s) : norm(cross(b.dir, [0, 1, 0]));
  const w = Math.min(LOOSE.spin * 2 * Math.PI, Math.asin(Math.min(1, s)) / dt);
  // when its middle's down to lying height: c0.y + v.y t - g t²/2 = ground + lie
  const g0 = groundHeight(c0[0], c0[2]) + LOOSE.lie, h = Math.max(0, c0[1] - g0);
  const tLand = (v[1] + Math.sqrt(v[1] * v[1] + 2 * LOOSE.g * h)) / LOOSE.g;
  const dLand = rot(norm(b.dir), axis, w * tLand), dFlat = norm([dLand[0], 0, dLand[2]]);
  return { c0, v, axis, w, d0: norm(b.dir), tLand, dLand, dFlat: Math.hypot(dLand[0], dLand[2]) > 1e-4 ? dFlat : [1, 0, 0] };
}

export function batAt(T, t) {
  t = Math.max(0, t);
  if (t < T.tLand) {
    const c = [T.c0[0] + T.v[0] * t, T.c0[1] + T.v[1] * t - LOOSE.g * t * t / 2, T.c0[2] + T.v[2] * t];
    const dir = rot(T.d0, T.axis, T.w * t);
    return { knob: sub(c, mul(dir, LOOSE.mid)), dir };
  }
  // down: it skids on along the ground, slowing, and settles flat
  const s = t - T.tLand, k = (1 - Math.exp(-LOOSE.drag * s)) / LOOSE.drag;
  const cx = T.c0[0] + T.v[0] * T.tLand + T.v[0] * 0.35 * k, cz = T.c0[2] + T.v[2] * T.tLand + T.v[2] * 0.35 * k;
  const f = Math.min(1, s / LOOSE.flat), e = f * f * (3 - 2 * f);
  const dir = norm(add(mul(T.dLand, 1 - e), mul(T.dFlat, e)));
  const c = [cx, groundHeight(cx, cz) + LOOSE.lie, cz];
  return { knob: sub(c, mul(dir, LOOSE.mid)), dir };
}
