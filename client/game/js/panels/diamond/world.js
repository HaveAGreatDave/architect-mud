// DEADBALL · THE WORLD. Who's moving and the ball, on a fixed clock.
//
// The park's people are stills until something plays them a clip (diamond/anim.js); the world
// keeps, for each one that moves, which clip and since when, where he stands and which way he
// faces, and the layers over it (a glove reaching for the ball, the bat turned onto it, a head
// turned to it). It keeps the ball's path too, and a queue of things to happen at given times,
// which is how the director (diamond/director.js) stages a pitch: it works out the whole of it at
// once and the clock plays it out. Stepped at 120 Hz (`DT`), so a slow replay has fine steps to show.
//
// Positions are the park's (diamond/geo.js: feet, home plate at the origin, +z to centre field,
// +x toward third). A body's clip runs in its own frame, placed by `at` and `yaw` as a still is;
// a left-hander's is mirrored, and the ground under him is the park's, so a pitcher's stride
// comes down on the slope of the mound.
//
// Pure: no WebGL and no DOM, so the gates run it.

import { sampleClip, mixPose, reach, lookAt, aimBat, traitsOf } from './anim.js';
import { groundHeight, DEG } from './geo.js';
import { CLIPS } from './clips.js';

export const DT = 1 / 120;
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

// The park's point p in a body's own frame (and back): its yaw undone about its `at`.
export function toLocal(b, p) {
  const c = Math.cos(b.yaw * DEG), s = Math.sin(b.yaw * DEG), dx = p[0] - b.at[0], dz = p[2] - b.at[2];
  return [c * dx - s * dz, p[1] - b.at[1], s * dx + c * dz];
}
export function toPark(b, q) {
  const c = Math.cos(b.yaw * DEG), s = Math.sin(b.yaw * DEG);
  return [b.at[0] + c * q[0] + s * q[2], b.at[1] + q[1], b.at[2] - s * q[0] + c * q[2]];
}

export function createWorld() {
  const W = { t: 0, bodies: new Map(), ball: null, queue: [], seq: 0 };

  // A body: who he is and where he stands. `slot` is his kit slot (diamond/cast.js), which the
  // renderer knows him by. Placing him again moves his frame and leaves his clip running; a new
  // man in the slot gets his own way of doing things.
  W.place = (slot, o) => {
    const b = W.bodies.get(slot) || { slot, clip: null, start: 0, speed: 1, prev: null, layers: {} };
    const id = o.id ?? b.id;
    Object.assign(b, {
      id, role: o.role ?? b.role, at: (o.at ?? b.at ?? [0, 0, 0]).slice(), yaw: o.yaw ?? b.yaw ?? 0,
      scale: o.scale ?? b.scale ?? 1, mirror: !!(o.mirror ?? b.mirror),
      traits: o.traits ?? (id !== b.id || !b.traits ? (id ? traitsOf(id) : null) : b.traits),
    });
    W.bodies.set(slot, b);
    return b;
  };
  W.drop = (slot) => W.bodies.delete(slot);

  // He starts `clipId` at world time `at` (now if not given), at `speed`, mixing out of what he was
  // doing over `fade` seconds (0 for a clip that starts where the last one ends).
  W.play = (slot, clipId, o = {}) => {
    const b = W.bodies.get(slot), clip = CLIPS[clipId];
    if (!b || !clip) return null;
    const start = o.at ?? W.t;
    b.prev = b.clip && o.fade > 0 ? { clip: b.clip, start: b.start, speed: b.speed, from: start, fade: o.fade } : null;
    b.clip = clip; b.start = start; b.speed = o.speed || 1;
    return clip;
  };
  // the clip time a body is at, at world time t
  W.clipTime = (b, t = W.t) => (t - b.start) * b.speed;

  // A layer over a body's clip: `reach` brings a hand to a point, `aim` turns the bat's barrel
  // through one and `look` turns the head to one, each with a weight that comes up from `from` to
  // full at `full`, holds to `hold` and is gone by `to` (world times). `target` is a park point, or
  // a function of time giving one.
  W.layer = (slot, kind, spec) => { const b = W.bodies.get(slot); if (b) b.layers[kind] = spec; };
  W.clearLayers = (slot) => { const b = W.bodies.get(slot); if (b) b.layers = {}; };
  const weight = (L, t) => (t < L.from || t > L.to ? 0 : t < L.full ? smooth((t - L.from) / Math.max(1e-6, L.full - L.from)) : t <= L.hold ? 1 : 1 - smooth((t - L.hold) / Math.max(1e-6, L.to - L.hold)));
  const targetOf = (L, t) => (typeof L.target === 'function' ? L.target(t) : L.target);

  // the ground under a body, in his own frame: the park's, less the height he stands at
  const groundOf = (b) => (x, z) => { const p = toPark(b, [x, 0, z]); return groundHeight(p[0], p[2]) - b.at[1]; };
  const optsOf = (b) => ({ ground: groundOf(b), scale: b.scale, traits: b.traits, mirror: b.mirror });

  // His pose at world time t (now if not given): the clip, mixed out of the last one, with his own
  // way and his mirror, then the layers. Ready for the renderer with `at`, `yaw` and `scale`.
  W.pose = (slot, t = W.t) => {
    const b = W.bodies.get(slot);
    if (!b || !b.clip) return null;
    const opts = optsOf(b);
    let P = sampleClip(b.clip, (t - b.start) * b.speed, opts);
    if (b.prev && t < b.prev.from + b.prev.fade) {
      const Q = sampleClip(b.prev.clip, (t - b.prev.start) * b.prev.speed, opts);
      P = mixPose(Q, P, smooth((t - b.prev.from) / b.prev.fade), opts);
    }
    const r = b.layers.reach;
    if (r) {
      const w = weight(r, t);
      if (w > 0) P = reach(P, r.hand, toLocal(b, targetOf(r, t)), w, { kind: r.kind, follow: r.follow, scale: b.scale, ground: opts.ground });
    }
    const a = b.layers.aim;
    if (a && P.bat) {
      const w = weight(a, t);
      if (w > 0) P = aimBat(P, toLocal(b, targetOf(a, t)), w, { reach: a.reach, follow: a.follow, scale: b.scale, ground: opts.ground });
    }
    const l = b.layers.look;
    if (l) {
      const w = weight(l, t);
      if (w > 0) P = lookAt(P, toLocal(b, targetOf(l, t)), w, b.scale);
    }
    return { ...P, at: b.at, yaw: b.yaw, scale: b.scale };
  };
  // A clip's pose for a body at clip time `tau`, as he'd do it where he stands, without touching
  // what he's doing: for working out ahead where a hand or a chest will be.
  W.sample = (slot, clipId, tau) => {
    const b = W.bodies.get(slot), clip = CLIPS[clipId];
    if (!b || !clip) return null;
    return { ...sampleClip(clip, tau, optsOf(b)), at: b.at, yaw: b.yaw, scale: b.scale };
  };

  // Things to happen at world times, in order (ties in the order they were asked for).
  W.at = (t, fn) => {
    const item = { t, fn, n: W.seq++ };
    let i = W.queue.length;
    while (i > 0 && (W.queue[i - 1].t > t || (W.queue[i - 1].t === t && W.queue[i - 1].n > item.n))) i--;
    W.queue.splice(i, 0, item);
  };
  W.clearQueue = () => { W.queue.length = 0; };

  // The ball: a path, a function of world time giving a park point, or null when nobody's
  // throwing it (it's in a hand or out of the picture).
  W.setBall = (path) => { W.ball = path; };
  W.ballAt = (t = W.t) => (W.ball ? W.ball(t) : null);

  W.step = (dt = DT) => {
    W.t += dt;
    while (W.queue.length && W.queue[0].t <= W.t + 1e-9) W.queue.shift().fn(W);
  };
  return W;
}
