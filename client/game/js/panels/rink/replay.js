// Rinkside · the instant replay. The last few seconds of play, kept, and shown again slowly
// from down at ice level, the way a broadcast replays a goal.
//
// THE RECORDER keeps what the renderers draw and nothing else, thirty times a second, for
// the last ten seconds: every man's 21 joints and his kit, the puck and its tail, the loose
// gear, the lamp and the crowd. It doesn't keep the sim, so a replay can't change anything:
// the world plays on underneath it (the celebration, the line change) and the picture comes
// back to it when the replay ends.
//
// THE SOURCE is one object shaped like the world as far as a renderer reads it (`bodies()`,
// `rigOf()`, `puck`, `debris`, `cam`, ...). While a replay runs the renderers draw it
// instead of the world, with a camera of their own pointed at it; between frames it is
// interpolated, so a slow-motion replay is smooth rather than a slideshow at fifteen frames
// a second.
//
// The director starts one on a goal, on the booth's `replay` cue, and any new play stops it.
// A HIT THE PICTURE MISSED is kept as a clip (`save`) and shown at the next stoppage
// (`play`), with the replay's camera on the man who was hit rather than on the puck.

import { lerp } from './util.js';
import { PANELS } from './geo.js';

const HZ = 30, KEEP = 10;

export function createReplay(W) {
  const frames = [];
  let lastRec = -1;
  const R = { active: false, from: 0, to: 0, rt: 0, speed: 0.5, count: 0, kind: null, clip: null, follow: null };

  // the world as the renderers see it, while a replay is on
  const src = {
    t: 0, replayOn: true, kits: W.kits, rand: Math.random,
    cam: { mode: 'replay', focus: [100, 42], cut: 0, net: null, since: 0 },
    puck: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, hidden: false, tail: null, carrier: null, held: null, inNet: null, rot: 0 },
    debris: [], limbs: [], parts: [], glassBlood: [], cracks: [],
    flex: new Array(PANELS).fill(0), broken: new Set(), netBulge: { a: 0, h: 0 },
    lamp: 0, lampSide: null, crowd: 0.5, mourning: 0, shake: 0, boardShake: 0,
    zamboni: null, stretcher: null, fight: null, banner: null, label: null, _bodies: [], live: W,
    bodies() { return this._bodies; },
    rigOf(b) { return b._J; },
  };
  R.source = src;

  const copyJ = (J) => {
    const out = J.map((p) => (p ? [p[0], p[1], p[2]] : p));
    if (J.meta) out.meta = { bend: J.meta.bend ? J.meta.bend.slice() : null, look: J.meta.look ? J.meta.look.slice() : null, bottle: J.meta.bottle ? J.meta.bottle.slice() : null };
    return out;
  };

  // Keep this instant. Called every step; takes a frame thirty times a second.
  R.record = () => {
    if (R.active || W.t - lastRec < 1 / HZ - 1e-9) return;
    lastRec = W.t;
    const pk = W.puck;
    const f = {
      t: W.t,
      bodies: W.bodies().map((b) => ({
        seed: b.seed, kind: b.kind, side: b.side, num: b.num, name: b.name, skin: b.skin, hair: b.hair,
        gloves: b.gloves, helmet: b.helmet, jerseyUp: b.jerseyUp || 0, react: b.react || 0, blood: b.blood || 0,
        faceGear: b.faceGear, missing: { ...(b.missing || {}) }, x: b.x, y: b.y,
        rag: b.rag ? { pts: [{ x: b.rag.pts[0].x, y: b.rag.pts[0].y }] } : null,
        J: copyJ(W.rigOf(b)),
      })),
      puck: { x: pk.x, y: pk.y, z: pk.z, vx: pk.vx, vy: pk.vy, vz: pk.vz, hidden: !!pk.hidden, inNet: pk.inNet, rot: pk.rot || 0,
        tail: pk.tail && pk.tail.pts.length ? { k: pk.tail.k, fade: pk.tail.fade || 0, pts: pk.tail.pts.map((q) => q.slice()) } : null },
      debris: W.debris.map((d) => ({ kind: d.kind, x: d.x, y: d.y, z: d.z, rot: d.rot, side: d.side })),
      limbs: W.limbs.map((l) => ({ part: l.part, side: l.side, rot: l.rot, owner: l.owner, pts: l.pts.map((q) => ({ x: q.x, y: q.y, z: q.z, r: q.r })) })),
      lamp: W.lamp, lampSide: W.lampSide, crowd: W.crowd, mourning: W.mourning,
      netBulge: { a: W.netBulge.a, h: W.netBulge.h }, flex: W.flex.slice(), broken: [...W.broken],
      glassBlood: W.glassBlood.slice(), cracks: W.cracks.slice(),
    };
    frames.push(f);
    while (frames.length && frames[0].t < W.t - KEEP) frames.shift();
  };

  // Play `from`..`to` (world seconds already recorded) at `speed`.
  R.start = (from, to, speed = 0.5) => {
    if (!frames.length) return false;
    R.from = Math.max(from, frames[0].t); R.to = Math.min(to, frames[frames.length - 1].t);
    if (R.to - R.from < 1) return false;
    R.rt = R.from; R.speed = speed; R.active = true; R.count++;
    R.kind = 'goal'; R.clip = null; R.follow = null; src.label = null;
    // the replay's camera starts on its framing (the switch is behind the director's wipe)
    src.cam.cut++; src.cam.since = 0;
    return true;
  };
  // Keep `from`..`to` for later: the frames as they are now (a frame is never changed once
  // taken, so keeping it is keeping a reference). Null when there's too little of it.
  R.save = (from, to) => {
    const f = frames.filter((q) => q.t >= from - 1 / HZ && q.t <= to + 1 / HZ);
    return f.length >= HZ ? { frames: f, from: f[0].t, to: f[f.length - 1].t } : null;
  };
  // Play a kept clip at `speed`, the camera on `follow` (a man's seed and side) instead of
  // the puck, with `label` under the REPLAY bug.
  R.play = (clip, speed, follow = null, label = null) => {
    if (!clip || clip.to - clip.from < 1) return false;
    R.clip = clip.frames; R.from = clip.from; R.to = clip.to; R.rt = R.from; R.speed = speed;
    R.active = true; R.count++; R.kind = 'hit'; R.follow = follow; src.label = label;
    src.cam.cut++; src.cam.since = 0;
    return true;
  };
  R.stop = () => { R.active = false; };
  // world seconds until it ends by itself
  R.left = () => (R.active ? Math.max(0, (R.to - R.rt) / R.speed) : 0);
  // advance with the world's clock; true while it's still playing
  R.tick = (dt) => {
    if (!R.active) return false;
    R.rt += dt * R.speed;
    if (R.rt >= R.to) R.active = false;
    return R.active;
  };

  // Fill the source for the replay's current instant, between the two frames either side.
  R.frame = () => {
    const F = R.clip || frames;
    if (!F.length) return src;
    let i = F.findIndex((f) => f.t > R.rt);
    if (i <= 0) i = i === 0 ? 1 : F.length - 1;
    const a = F[Math.max(0, i - 1)], b = F[Math.min(F.length - 1, i)];
    const k = b.t > a.t ? Math.min(1, Math.max(0, (R.rt - a.t) / (b.t - a.t))) : 0;
    const L3 = (p, q) => (p && q ? [lerp(p[0], q[0], k), lerp(p[1], q[1], k), lerp(p[2], q[2], k)] : p || q);
    const bodies = [];
    for (const ba of a.bodies) {
      const bb = b.bodies.find((x) => x.seed === ba.seed && x.kind === ba.kind) || ba;
      const J = ba.J.map((p, j) => L3(p, bb.J[j]));
      // ⚠ A STICK DOESN'T SHRINK IN A REPLAY. Lerped straight across a fast swing the shaft cut
      // the corner and got shorter between frames; it goes back to its own length off the
      // hand, pointing where the lerp says.
      const d3 = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      // the top hand is the one at the knob: the right on a lefty, the left on a righty
      const th = ba.J[18] && ba.J[6] && ba.J[9] && d3(ba.J[6], ba.J[18]) < d3(ba.J[9], ba.J[18]) ? 6 : 9;
      if (J[th] && J[18] && J[19] && ba.J[th] && ba.J[18] && ba.J[19] && bb.J[th] && bb.J[18] && bb.J[19]) {
        const len = lerp(d3(ba.J[19], ba.J[th]), d3(bb.J[19], bb.J[th]), k), bu = lerp(d3(ba.J[18], ba.J[th]), d3(bb.J[18], bb.J[th]), k);
        const h = J[th], s0 = [J[19][0] - h[0], J[19][1] - h[1], J[19][2] - h[2]], sl = Math.hypot(s0[0], s0[1], s0[2]) || 1, u = [s0[0] / sl, s0[1] / sl, s0[2] / sl];
        const toe = J[20] ? [J[20][0] - J[19][0], J[20][1] - J[19][1], J[20][2] - J[19][2]] : null;
        J[19] = [h[0] + u[0] * len, h[1] + u[1] * len, h[2] + u[2] * len];
        J[18] = [h[0] - u[0] * bu, h[1] - u[1] * bu, h[2] - u[2] * bu];
        if (toe) J[20] = [J[19][0] + toe[0], J[19][1] + toe[1], J[19][2] + toe[2]];
      }
      if (ba.J.meta) J.meta = { bend: L3(ba.J.meta.bend, bb.J.meta && bb.J.meta.bend), look: ba.J.meta.look, bottle: L3(ba.J.meta.bottle, bb.J.meta && bb.J.meta.bottle) };
      bodies.push({ ...ba, x: lerp(ba.x, bb.x, k), y: lerp(ba.y, bb.y, k), rag: ba.rag && bb.rag ? { pts: [{ x: lerp(ba.rag.pts[0].x, bb.rag.pts[0].x, k), y: lerp(ba.rag.pts[0].y, bb.rag.pts[0].y, k) }] } : ba.rag, _J: J });
    }
    src._bodies = bodies;
    const pa = a.puck, pb = b.puck, jump = Math.hypot(pb.x - pa.x, pb.y - pa.y) > 6;
    Object.assign(src.puck, jump ? pb : { ...pa, x: lerp(pa.x, pb.x, k), y: lerp(pa.y, pb.y, k), z: lerp(pa.z, pb.z, k) });
    src.puck.tail = k < 0.5 ? pa.tail : pb.tail;
    const near = k < 0.5 ? a : b;
    src.debris = near.debris; src.limbs = near.limbs; src.glassBlood = near.glassBlood; src.cracks = near.cracks;
    src.lamp = near.lamp; src.lampSide = near.lampSide; src.crowd = near.crowd; src.mourning = near.mourning;
    src.netBulge.a = near.netBulge.a; src.netBulge.h = near.netBulge.h;
    for (let p = 0; p < PANELS; p++) src.flex[p] = near.flex[p] || 0;
    src.broken = new Set(near.broken);
    src.kits = W.kits;
    src.t = R.rt;
    const fb = R.follow && bodies.find((q) => q.seed === R.follow.seed && q.side === R.follow.side && q.kind === 'skater');
    src.cam.focus = fb ? [fb.rag ? fb.rag.pts[0].x : fb.x, fb.rag ? fb.rag.pts[0].y : fb.y] : [src.puck.x, src.puck.y];
    return src;
  };
  R.frames = frames;
  return R;
}
