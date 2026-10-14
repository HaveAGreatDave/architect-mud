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
// comes down on the slope of the mound. A clip that travels (anim.js rootAt) carries its frame on
// from there, and the next clip starts where it got to.
//
// Pure: no WebGL and no DOM, so the gates run it.

import { sampleClip, mixPose, reach, lookAt, aimBat, traitsOf, rootAt, rebase } from './anim.js';
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

// Where a clip started at `start` and played at `speed` has carried a frame `base` (`{ at, yaw }`)
// by world time t: the base itself for a clip that doesn't travel. The Pose Lab carries its player
// with it too.
export function carried(base, clip, start, speed, t, mirror) {
  if (!clip?.root) return base;
  const r = rootAt(clip, Math.max(0, (t - start) * speed), { mirror });
  const p = toPark(base, [r.at[0], 0, r.at[1]]);
  return { at: [p[0], base.at[1], p[2]], yaw: base.yaw + r.yaw };
}

export function createWorld() {
  const W = { t: 0, bodies: new Map(), ball: null, queue: [], seq: 0 };

  // A body: who he is and where he stands. `slot` is his kit slot (diamond/cast.js), which the
  // renderer knows him by. Placing him again puts him there as a still until something plays
  // him: a clip left running would carry him on from the new spot by however far it had already
  // taken him. A new man in the slot gets his own way of doing things.
  W.place = (slot, o) => {
    const b = W.bodies.get(slot) || { slot, clip: null, start: 0, speed: 1, prev: null, layers: {} };
    const id = o.id ?? b.id;
    b.clip = null; b.prev = null;
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
  // doing over `fade` seconds (0 for a clip that starts where the last one ends), from `from` if
  // he takes it up part way through (a run carried on round a turn). It starts where the last one
  // had carried him by then (a clip that travels), or from `frame` ({ at, yaw }) if given (a
  // fielder sent off toward a ball), and the last one mixes out from where it carries him on to.
  // With `carry`, the last one rides the new clip's frame through the mix instead, where it was
  // when the mix began: a man at rest taking up a clip already moving goes with it from the
  // first frame, where mixing him in place would leave him behind and then surge him after it.
  W.play = (slot, clipId, o = {}) => {
    const b = W.bodies.get(slot), clip = CLIPS[clipId];
    if (!b || !clip) return null;
    const start = o.at ?? W.t, base = { at: b.at, yaw: b.yaw }, from = o.from ?? start;
    b.prev = b.clip && o.fade > 0 ? { clip: b.clip, start: b.start, speed: b.speed, from, fade: o.fade, base } : null;
    const here = o.frame ? { at: [o.frame.at[0], o.frame.at.length === 3 ? o.frame.at[1] : b.at[1], o.frame.at[o.frame.at.length - 1]], yaw: o.frame.yaw } : carried(base, b.clip, b.start, b.speed, start, b.mirror);
    if (b.prev && o.carry) b.prev.rel = relOf(carried(base, b.clip, b.start, b.speed, from, b.mirror), carried(here, clip, start, o.speed || 1, from, b.mirror));
    b.at = here.at.slice(); b.yaw = here.yaw;
    b.clip = clip; b.start = start; b.speed = o.speed || 1;
    return clip;
  };
  // Where his frame is at world time t: where he was placed, carried on by his clip.
  W.frame = (slot, t = W.t) => { const b = W.bodies.get(slot); return b ? carried({ at: b.at, yaw: b.yaw }, b.clip, b.start, b.speed, t, b.mirror) : null; };
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

  // the ground under a body, in his own frame F: the park's, less the height he stands at. toPark
  // worked out once a frame, as a sample asks it of every foot of every key.
  const groundOf = (F) => {
    const c = Math.cos(F.yaw * DEG), s = Math.sin(F.yaw * DEG), [x0, y0, z0] = F.at;
    return (x, z) => groundHeight(x0 + c * x + s * z, z0 - s * x + c * z) - y0;
  };
  const optsOf = (b, F) => ({ ground: groundOf(F), scale: b.scale, traits: b.traits, mirror: b.mirror });
  // frame A as frame B sees it, for anim.js rebase
  const relOf = (A, B) => { const q = toLocal(B, A.at); return { at: [q[0], q[2]], y: q[1], yaw: A.yaw - B.yaw }; };

  // His pose at world time t (now if not given): the clip, mixed out of the last one, with his own
  // way and his mirror, then the layers. Ready for the renderer with `at`, `yaw` and `scale`, his
  // frame where his clip has carried him. `o.look: false` leaves the head as the clip has it: the
  // ball in his own hand asks where the hand is, and his head looking at the ball would ask back.
  W.pose = (slot, t = W.t, o = {}) => {
    const b = W.bodies.get(slot);
    if (!b || !b.clip) return null;
    const F = carried({ at: b.at, yaw: b.yaw }, b.clip, b.start, b.speed, t, b.mirror), opts = optsOf(b, F);
    let P = sampleClip(b.clip, (t - b.start) * b.speed, opts);
    if (b.prev && t < b.prev.from + b.prev.fade) {
      const pv = b.prev, G = carried(pv.base, pv.clip, pv.start, pv.speed, t, b.mirror);
      const Q = rebase(sampleClip(pv.clip, (t - pv.start) * pv.speed, optsOf(b, G)), pv.rel || relOf(G, F));
      P = mixPose(Q, P, smooth((t - pv.from) / pv.fade), opts);
    }
    const r = b.layers.reach;
    if (r) {
      const w = weight(r, t);
      if (w > 0) P = reach(P, r.hand, toLocal(F, targetOf(r, t)), w, { kind: r.kind, follow: r.follow, scale: b.scale, ground: opts.ground });
    }
    const a = b.layers.aim;
    if (a && P.bat) {
      const w = weight(a, t);
      if (w > 0) P = aimBat(P, toLocal(F, targetOf(a, t)), w, { reach: a.reach, follow: a.follow, scale: b.scale, ground: opts.ground });
    }
    const l = o.look !== false && b.layers.look;
    if (l) {
      // nothing to look at in a world started after the ball's gone (a replay that opens once a
      // throw's in the stands)
      const w = weight(l, t), q = w > 0 ? targetOf(l, t) : null;
      if (q) P = lookAt(P, toLocal(F, q), w, b.scale);
    }
    return { ...P, at: F.at, yaw: F.yaw, scale: b.scale };
  };
  // A clip's pose for a body at clip time `tau`, as he'd do it from where he stands, without
  // touching what he's doing: for working out ahead where a hand or a chest will be. A clip that
  // travels has him where it's carried him by then.
  W.sample = (slot, clipId, tau) => {
    const b = W.bodies.get(slot), clip = CLIPS[clipId];
    if (!b || !clip) return null;
    const F = carried({ at: b.at, yaw: b.yaw }, clip, 0, 1, tau, b.mirror);
    return { ...sampleClip(clip, tau, optsOf(b, F)), at: F.at, yaw: F.yaw, scale: b.scale };
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
