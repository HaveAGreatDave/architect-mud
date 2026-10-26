// DEADBALL · THE BODY'S OWN WEIGHT. What a clip doesn't key, laid over each pose as it's drawn: the
// upper body carried on a beat when a man pulls up and held back a beat when he sets off, a lean
// into every turn he runs, the head steadied against both, the head's turns eased rather than
// snapped onto the ball, and a breath in the chest while he's still.
//
// Drawing only. The view runs each pose through `settle` between the world's pose (diamond/world.js
// W.pose) and the renderer, so nothing here reaches the staging, the gates' checks of it or the
// sound, and a replay staged again plays the same play. It keeps a little state a body, so it's
// worked out frame to frame and starts over wherever time jumps or a man is moved on a cut.
//
// Only the angles of the chest, neck and head change. The pelvis, the feet, the wrists and the bat
// are where the pose put them, so a planted foot stays planted, a glove stays on the ball and both
// hands stay on the bat; the arms take up the chest's lean through their own solve.
//
// Pure: no DOM and no GL.

import { DEG } from './geo.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// How the body answers its frame's speeding up, slowing and turning: a critically damped spring at
// `carry` rad/s follows the frame's speed over the ground, and what it's behind by (about twice the
// acceleration over `carry`, in ft/s) tips the chest `fwd` degrees a ft/s forward and back and `side`
// to the side, at most `most` degrees. The head takes back `steady` of the chest's tip, so his eyes
// stay level. The head's own turn follows the pose's at `look` rad/s, about a sixth of a second to
// settle. `breath` is the chest's rise at rest, in degrees. A frame further than `jump` feet from
// the last, or a frame further than `gap` s from the last, starts the body over.
export const SETTLE = Object.freeze({ carry: 9, fwd: 1.2, side: 1.6, most: 5, steady: 0.6, look: 24, breath: 0.7, jump: 4, gap: 0.12 });

// A critically damped spring at w rad/s from x (moving at v) toward target over dt, solved exactly,
// so its step doesn't depend on the frame rate.
function spring(x, v, target, w, dt) {
  const e = Math.exp(-w * dt), d = x - target, k = v + w * d;
  return [target + (d + k * dt) * e, (v - w * k * dt) * e];
}

// One a world: the live one and a replay's each have their own, since a replay's men are other
// bodies in the same slots.
export function createSettle(o = SETTLE) {
  const state = new Map();
  return {
    // Forgets every body, as after a replay or a new game.
    reset() { state.clear(); },
    // Pose P of the body in `slot` drawn at world time t: P with the tip, the steadied head, the
    // eased look and the breath. A new object; P isn't touched.
    settle(slot, P, t) {
      if (!P || !P.chest || !P.head || !P.neck || !P.at) return P;
      const at = P.at;
      let S = state.get(slot);
      const dt = S ? t - S.t : 0;
      if (!S || !(dt >= 0) || dt > o.gap || Math.hypot(at[0] - S.at[0], at[2] - S.at[2]) > o.jump) {
        // start where he is: nothing carried, the look as the pose has it
        S = { t, at: at.slice(), v: [0, 0], u: [0, 0], du: [0, 0], neck: P.neck.slice(0, 2), head: P.head.slice(0, 2), nv: [0, 0], hv: [0, 0], fresh: true };
        state.set(slot, S);
      } else if (dt > 1e-6) {
        // the frame's own speed over the ground this frame; the first frame after a start only
        // takes it up, so a man starting over mid-stride isn't thrown
        const v = [(at[0] - S.at[0]) / dt, (at[2] - S.at[2]) / dt];
        if (S.fresh) { S.u = v.slice(); S.fresh = false; }
        for (let i = 0; i < 2; i++) [S.u[i], S.du[i]] = spring(S.u[i], S.du[i], v[i], o.carry, dt);
        S.v = v;
        for (let i = 0; i < 2; i++) {
          [S.neck[i], S.nv[i]] = spring(S.neck[i], S.nv[i], P.neck[i], o.look, dt);
          [S.head[i], S.hv[i]] = spring(S.head[i], S.hv[i], P.head[i], o.look, dt);
        }
        S.t = t; S.at = at.slice();
      }
      // what the followed speed is behind the frame's by, in his own frame (x his left, z forward,
      // as world.js toPark turns a frame's point into the park)
      const y = (P.yaw || 0) * DEG, c = Math.cos(y), s = Math.sin(y);
      const dx = S.u[0] - S.v[0], dz = S.u[1] - S.v[1];
      const fwd = s * dx + c * dz, left = c * dx - s * dz;
      // Speeding up leaves the followed speed behind (fwd < 0) and holds the chest back; pulling up
      // carries it on forward. A turn to his left leaves it behind to his left (left < 0) and leans
      // him into the turn. The chest's pitch tips him forward as it rises, and its roll to his right
      // (diamond/rig.js EUL).
      const pitch = clamp(fwd * o.fwd, -o.most, o.most), roll = clamp(left * o.side, -o.most, o.most);
      // still enough to breathe: under about 2 ft/s over the ground
      const speed = Math.hypot(S.v[0], S.v[1]), still = 1 - clamp((speed - 1) / 3, 0, 1);
      const breath = Math.sin(t * Math.PI * 2 / 3.9 + slot * 1.7) * o.breath * still;
      const ch = P.chest;
      return {
        ...P,
        chest: [ch[0] + pitch + breath, ch[1] || 0, (ch[2] || 0) + roll],
        neck: [S.neck[0] - pitch * o.steady * 0.5, S.neck[1], P.neck[2] || 0],
        head: [S.head[0] - pitch * o.steady * 0.5 - breath * 0.6, S.head[1], (P.head[2] || 0) - roll * o.steady],
      };
    },
  };
}
