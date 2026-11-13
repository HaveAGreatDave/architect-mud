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
//
// A COMIC REPLAY (rink/comic.js) is either of those with a `comic` spec: it holds its own clock
// on the moment for the freeze and at the end for the page, so the stand-in world stands still
// under them, and `left` counts them in. One on a goalie leaves out the men in front of him
// (`clearView`).

import { lerp } from './util.js';
import { PANELS } from './geo.js';
import { XRAY_FOCUS } from '../gl/arena-xray.js';
import { COMIC } from '../comic-print.js';

const HZ = 30, KEEP = 10;

// THE X-RAY CUT (gl/arena-xray.js draws it). A clip played with `xray` slows from its own
// speed to SLOW over EASE replay seconds either side of the window round the impact, and
// the X-ray fades in as it gets there and out after the break. Both hold until he's on the
// ice: his chest and pelvis under DOWN_Z, found in the clip itself (`landAt`), or `after`
// past the impact when the clip ends with him still up.
const XR = { slow: 0.16, before: 0.25, after: 0.5, ease: 0.2, kIn: [-0.55, -0.3], kOut: [0.55, 0.8] };
const DOWN_Z = 1.2;
function landAt(F, X) {
  for (const f of F) {
    if (f.t < X.t) continue;
    const b = f.bodies.find((q) => q.seed === X.seed && q.side === X.side);
    if (b && b.J[0] && b.J[1] && b.J[0][2] < DOWN_Z && b.J[1][2] < DOWN_Z) return f.t - X.t;
  }
  return 0;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function createReplay(W) {
  const frames = [];
  let lastRec = -1;
  const R = { active: false, from: 0, to: 0, rt: 0, speed: 0.5, count: 0, kind: null, clip: null, follow: null, xray: null, comic: null };

  // the world as the renderers see it, while a replay is on
  const src = {
    t: 0, replayOn: true, kits: W.kits, rand: Math.random,
    cam: { mode: 'replay', focus: [100, 42], cut: 0, net: null, since: 0 },
    puck: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, hidden: false, tail: null, carrier: null, held: null, inNet: null, rot: 0 },
    debris: [], limbs: [], parts: [], glassBlood: [], cracks: [],
    flex: new Array(PANELS).fill(0), broken: new Set(), netBulge: { a: 0, h: 0 },
    lamp: 0, lampSide: null, crowd: 0.5, mourning: 0, shake: 0, boardShake: 0,
    zamboni: null, stretcher: null, fight: null, banner: null, label: null, xray: null, comic: null, _bodies: [], live: W,
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

  // A comic replay's state, from the director's `comic` ({ spec, key, mid, page, at, focus, by }):
  // the moment `key` kept inside the window, and the beats from the run.
  const PAST_FT = 8, PAST_LATE = 0.05;
  const comicOf = (c) => {
    if (!c || !c.spec) return null;
    const F = R.clip || frames;
    let k0 = c.key;
    // A SHOT'S FLIGHT (`pathFrom`, the world second it left the stick): the puck's path from there
    // is kept for the freeze to ink in, and with `past` (the goalie's seed and side) the freeze moves
    // on from the release to the puck going by him, so the big frame is the shot beating him with its
    // whole line behind it. No pass within PAST_FT of him (a tip, a scramble): the release it stays.
    let path = null;
    if (c.pathFrom != null) {
      const fl = F.filter((f) => f.t >= c.pathFrom - 1 / HZ && f.t <= R.to);
      if (c.past) {
        let best = null, bd = Infinity;
        for (const f of fl) {
          const gk = f.bodies.find((q) => q.seed === c.past.seed && q.side === c.past.side);
          if (!gk || f.puck.hidden) continue;
          const d = Math.hypot(f.puck.x - gk.x, f.puck.y - gk.y);
          if (d < bd) { bd = d; best = f; } else if (best && d > bd + 2) break;
        }
        if (best && bd < PAST_FT) k0 = best.t + PAST_LATE;
      }
      path = fl.filter((f) => f.t <= k0 + 1e-6 && !f.puck.hidden).map((f) => [f.puck.x, f.puck.y, Math.max(0.15, f.puck.z || 0)]);
      if (path.length < 2) path = null;
    }
    const key = Math.min(R.to - 0.2, Math.max(R.from + 0.3, k0));
    return { ...c, key, path, from: R.from, to: R.to, beat: 'run', bt: 0, rt: R.from, shots: null, world: null };
  };
  // Play `from`..`to` (world seconds already recorded) at `speed`.
  R.start = (from, to, speed = 0.5, comic = null) => {
    if (!frames.length) return false;
    R.from = Math.max(from, frames[0].t); R.to = Math.min(to, frames[frames.length - 1].t);
    if (R.to - R.from < 1) return false;
    R.rt = R.from; R.speed = speed; R.active = true; R.count++;
    R.kind = 'goal'; R.clip = null; R.follow = null; R.xray = null; src.label = null; src.xray = null;
    R.comic = src.comic = comicOf(comic);
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
  // the puck, with `label` under the REPLAY bug. With `xray` ({ t, bone, seed, side }) it
  // slows right down round `t` and the renderer sees through the man (see XR).
  R.play = (clip, speed, follow = null, label = null, xray = null, comic = null) => {
    if (!clip || clip.to - clip.from < 1) return false;
    R.clip = clip.frames; R.from = clip.from; R.to = clip.to; R.rt = R.from; R.speed = speed;
    R.active = true; R.count++; R.kind = 'hit'; R.follow = follow; src.label = label;
    // (an X-ray is its own show: never a comic one too)
    R.comic = src.comic = xray ? null : comicOf(comic);
    // (`hold`: how much later than `after` he lands, which pushes the slow-motion and the fade out back)
    R.xray = xray ? { ...xray, hold: Math.max(0, landAt(clip.frames, xray) + 0.1 - XR.after) } : null;
    src.xray = R.xray ? { ...R.xray, k: 0, d: R.from - xray.t } : null;
    src.cam.cut++; src.cam.since = 0;
    return true;
  };
  R.stop = () => { R.active = false; };
  // the speed at replay time `rt`: its own, or slowed round an X-ray's impact
  const rate = (rt) => {
    if (!R.xray) return R.speed;
    const d = rt - R.xray.t, a = XR.after + R.xray.hold;
    const w = smooth(-XR.before - XR.ease, -XR.before, d) * (1 - smooth(a, a + XR.ease, d));
    return R.speed + (XR.slow - R.speed) * w;
  };
  // world seconds until it ends by itself (a comic one's freeze and page included)
  R.left = () => {
    if (!R.active) return 0;
    const C = R.comic;
    const held = !C ? 0 : (C.beat === 'run' ? COMIC.freeze : C.beat === 'freeze' ? Math.max(0, COMIC.freeze - C.bt) : 0)
      + (C.page ? (C.beat === 'page' ? Math.max(0, COMIC.page - C.bt) : COMIC.page) : 0);
    if (!R.xray) return Math.max(0, (R.to - R.rt) / R.speed) + held;
    let s = 0;
    for (let rt = R.rt; rt < R.to; rt += 1 / HZ) s += Math.min(1 / HZ, R.to - rt) / rate(rt);
    return s;
  };
  // advance with the world's clock; true while it's still playing. A comic replay stops its clock
  // on the moment for the freeze, and at the end for the page.
  R.tick = (dt) => {
    if (!R.active) return false;
    const C = R.comic;
    // (what's left of a step past a change of beat carries into the next, so it ends on time)
    if (C) {
      C.bt += dt;
      if (C.beat === 'freeze') {
        if (C.bt < COMIC.freeze) return true;
        dt = C.bt - COMIC.freeze; C.beat = 'after'; C.bt = dt;
      } else if (C.beat === 'page') { if (C.bt >= COMIC.page) R.active = false; return R.active; }
    }
    const r = rate(R.rt);
    R.rt += dt * r;
    if (C && C.beat === 'run' && R.rt >= C.key) { C.beat = 'freeze'; C.bt = (R.rt - C.key) / r; R.rt = C.key; }
    else if (R.rt >= R.to) {
      if (C && C.page) { C.beat = 'page'; C.bt = (R.rt - R.to) / r; R.rt = R.to; } else R.active = false;
    }
    if (C) C.rt = R.rt;
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
    src._bodies = clearView(R.comic, bodies);
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
    // (a skater, or the goalie a comic replay of a save is on). A comic replay's `then` is who the
    // camera's on from the freeze: it swings there under the printed frame, so what follows is
    // framed on him (a goal's goalie: on the puck, a slapshot left the camera behind it)
    const C = R.comic, fol = (C && C.then && C.beat !== 'run' && C.then) || R.follow;
    const fb = fol && bodies.find((q) => q.seed === fol.seed && q.side === fol.side && (q.kind === 'skater' || q.kind === 'goalie'));
    src.cam.focus = fb ? [fb.rag ? fb.rag.pts[0].x : fb.x, fb.rag ? fb.rag.pts[0].y : fb.y] : [src.puck.x, src.puck.y];
    // the X-ray: how strong, how far past the impact, and the camera in close on the bone
    if (src.xray) {
      const X = src.xray, d = R.rt - X.t;
      X.d = d; X.k = smooth(XR.kIn[0], XR.kIn[1], d) * (1 - smooth(XR.kOut[0] + X.hold, XR.kOut[1] + X.hold, d));
      const xb = bodies.find((q) => q.seed === X.seed && q.side === X.side), j = xb && xb._J[XRAY_FOCUS[X.bone] ?? 1];
      if (j) src.cam.focus = [lerp(src.cam.focus[0], j[0], X.k), lerp(src.cam.focus[1], j[1], X.k)];
      src.cam.mode = 'xray'; src.cam.xk = X.k; src.cam.xz = j ? j[2] : 2;
    } else src.cam.mode = 'replay';
    if (R.comic) R.comic.world = momentOf(R.comic, bodies, src.puck);
    return src;
  };
  // Where a comic replay's moment is in the stand-in world now, for the freeze's burst and its
  // lines: `at` the puck, the hit (between the two chests) or the punch (the head it lands on);
  // `dir` the way it's going; and the man at it, his head and his feet (the man it's on, or for the
  // puck the goalie nearest it).
  // A COMIC REPLAY ON A GOALIE (`clear`: his seed and side) LEAVES OUT THE MEN IN FRONT OF HIM:
  // anybody on the ice between the replay camera's eye (`src.eye`, which the renderer leaves there
  // each frame) and him, within CLEAR_W ft of the line, so the crowd at his crease doesn't hide the
  // save. With `after`, only from the freeze on (a goal: the shot itself keeps everybody). Nothing
  // without an eye, so nothing drawn, nothing left out.
  const CLEAR_W = 4;
  function clearView(C, bodies) {
    const K = C && C.clear, E = src.eye;
    if (!K || !E || (K.after && C.beat === 'run')) return bodies;
    const gb = bodies.find((q) => q.seed === K.seed && q.side === K.side);
    if (!gb) return bodies;
    const at = (q) => (q.rag ? q.rag.pts[0] : q), g = at(gb);
    const dx = g.x - E[0], dy = g.y - E[1], L2 = dx * dx + dy * dy;
    if (!(L2 > 1)) return bodies;
    const L = Math.sqrt(L2);
    return bodies.filter((q) => {
      if (q === gb) return true;
      const p = at(q), t = ((p.x - E[0]) * dx + (p.y - E[1]) * dy) / L2;
      // (behind the camera, or level with him and beyond: kept)
      if (t <= 0 || t * L > L - 0.5) return true;
      return Math.abs((p.x - E[0]) * dy - (p.y - E[1]) * dx) / L > CLEAR_W;
    });
  }
  const CHEST = 0, HEAD = 3, TOES = [16, 17];
  function momentOf(C, bodies, puck) {
    const find = (who) => who && bodies.find((q) => q.seed === who.seed && q.side === who.side);
    const on = find(C.focus), by = find(C.by);
    let at = null, dir = null, man = on;
    if (C.at === 'puck' || !on) {
      at = [puck.x, puck.y, Math.max(0.3, puck.z || 0)]; dir = [puck.vx || 0, puck.vy || 0, puck.vz || 0];
      if (!man) {
        let bd = Infinity;
        for (const q of bodies) { if (q.kind !== 'goalie') continue; const d = Math.hypot(q.x - puck.x, q.y - puck.y); if (d < bd) { bd = d; man = q; } }
        if (bd > 30) man = null;
      }
    } else {
      const j = on._J, from = by && by._J && by._J[CHEST];
      const p = (C.at === 'head' ? j[HEAD] : j[CHEST]) || j[CHEST] || [on.x, on.y, 3];
      at = C.at === 'hit' && from ? [(p[0] + from[0]) / 2, (p[1] + from[1]) / 2, (p[2] + from[2]) / 2] : p.slice(0, 3);
      if (from) dir = [p[0] - from[0], p[1] - from[1], p[2] - from[2]];
    }
    const path = C.path;
    if (!man || !man._J) return { at, dir, path, head: null, foot: null };
    const J = man._J, hd = J[HEAD] || J[CHEST];
    let foot = null;
    for (const i of TOES) if (J[i] && (!foot || J[i][2] < foot[2])) foot = J[i];
    return { at, dir, path, head: hd ? [hd[0], hd[1], hd[2] + 0.6] : null, foot: foot || [man.x, man.y, 0] };
  }
  R.frames = frames;
  return R;
}
