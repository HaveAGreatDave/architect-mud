// DEADBALL · A BODY'S PLAN. What one man on the field plays, worked out ahead as the world will
// play it (diamond/world.js): each clip with its start, speed, mix and the frame it starts from,
// and the runs that take him from one to the next. diamond/plays.js plans the fielders with it and
// diamond/bases.js the men running the bases.
//
// Pure: no DOM and no GL.

import { CLIPS } from './clips.js';
import { rootAt, sampleClip } from './anim.js';
import { DEG, groundHeight } from './geo.js';
import { carried, toPark } from './world.js';

export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
export const wrap = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
// facing from p toward q, in degrees about the vertical (0 faces +z), as cast.js has it
export const faceTo = (p, q) => Math.atan2(q[0] - p[0], q[2] - p[2]) / DEG;
// a frame's point turned by its yaw, as world.js toPark turns it
export const turn = (v, yaw) => { const c = Math.cos(yaw * DEG), s = Math.sin(yaw * DEG); return [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]]; };
export const ahead = (yaw, d) => [Math.sin(yaw * DEG) * d, 0, Math.cos(yaw * DEG) * d];
export const HOME = Object.freeze([0, 0, 0]);
export function hashStr(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

// The run cycles and how fast each goes (its root over a lap).
export const CYCLES = ['run_jog', 'run_run', 'run_sprint'].map((id) => { const c = CLIPS[id], end = c.root[c.root.length - 1].at; return { id, v: Math.hypot(end[0], end[1]) / c.duration }; });
export const cycleFor = (v) => CYCLES.reduce((best, c) => (Math.abs(c.v - v) < Math.abs(best.v - v) ? c : best));
// The fastest and slowest a run cycle is played, as a share of its own speed.
export const PLAYBACK = Object.freeze([0.72, 1.3]);
// How long a clip takes to mix into the next, and the most a body turns across one mix: a run
// that has to turn further takes its first strides at half the angle.
export const FADE = 0.2, TURN = 80;
// How long the mix between a turning run's two legs takes.
const BEND_MIX = 0.15;
// The fastest a fielder runs to a ball on the ground, feet a second.
export const RUN_MAX = 27;
// How far short of a clip's start he'd be, L feet from it with T seconds to get there: a step or
// two (3 ft) the mix takes up, and anything more a run, which takes a quarter of a second at least
// (runTo makes no shorter one).
export const shortBy = (L, T) => (L <= 3 ? 0 : T < 0.25 ? L - 2 : Math.max(0, L - 3 - RUN_MAX * T));
// How far a cycle has carried him at clip time `tau`, and the clip time it carries him `L` feet.
export const runOf = (id, tau) => rootAt(CLIPS[id], tau).at[1];
export function timeFor(id, L) {
  let a = 0, b = Math.max(0.05, L / 10 + 1);
  for (let k = 0; k < 40; k++) { const m = (a + b) / 2; if (runOf(id, m) < L) a = m; else b = m; }
  return (a + b) / 2;
}
// How far pulling up (run_stop) carries him.
export const STOP = CLIPS.run_stop, STOP_LEN = rootAt(STOP, STOP.duration).at[1];

// The ground under a frame, as the world has it (world.js groundOf).
export const groundOf = (F) => (x, z) => { const q = toPark(F, [x, 0, z]); return groundHeight(q[0], q[2]) - F.at[1]; };
// the hand a clip names, on a left-hander who does it in a mirror
export const sideOf = (B, h) => (B.mirror ? (h === 'L' ? 'R' : 'L') : h);

// ── a body's plan ──────────────────────────────────────────────────────────────
// What one body plays: each clip with when it starts, its speed, its mix and the frame it starts
// from, worked out as the world will (a clip that travels carries the next one's frame unless it's
// given one). A clip takes over at `on`: when it's issued, which is its start unless it's taken up
// part way through (`from`) or issued early to hold its first frame (`issue`, the ready set from
// the cut in). `free` is when he's next free to be sent somewhere.
export const onOf = (e) => e.issue ?? e.from ?? e.start;
export function makeBody(o) {
  const B = { n: o.n, id: o.id, slot: o.slot, role: o.role, mirror: !!o.mirror, scale: o.scale || 1, base: { at: o.at.slice(), yaw: o.yaw }, clips: [], free: -Infinity, place: !!o.place };
  if (o.clip) B.clips.push({ clip: o.clip, start: o.start, speed: o.speed || 1, fade: 0, F: { at: o.at.slice(), yaw: o.yaw }, prior: true });
  B.play = (clip, start, p = {}) => {
    const last = B.clips[B.clips.length - 1], e = { clip, start, speed: p.speed || 1, fade: p.fade || 0, given: !!p.frame };
    if (p.from != null) e.from = p.from;
    if (p.issue != null) e.issue = p.issue;
    if (p.carry) e.carry = true;
    if (last && onOf(e) < onOf(last) - 1e-6) throw new Error(`plays: ${B.id} plays ${clip} at ${onOf(e).toFixed(3)}, before ${last.clip} at ${onOf(last).toFixed(3)}`);
    e.F = p.frame ? { at: [p.frame.at[0], p.frame.at[1] ?? 0, p.frame.at[2]], yaw: p.frame.yaw }
      : last ? carried(last.F, CLIPS[last.clip], last.start, last.speed, start, B.mirror) : { at: B.base.at.slice(), yaw: B.base.yaw };
    B.clips.push(e);
    return e;
  };
  B.entryAt = (t) => { let e = B.clips[0] || null; for (const c of B.clips) { if (onOf(c) > t + 1e-9) break; e = c; } return e; };
  B.frameAt = (t) => { const e = B.entryAt(t); return e ? carried(e.F, CLIPS[e.clip], e.start, e.speed, t, B.mirror) : { at: B.base.at.slice(), yaw: B.base.yaw }; };
  // his pose at t as the clip alone has it (no mix, no layers), and the frame it's in
  B.poseAt = (t) => {
    const e = B.entryAt(t), F = B.frameAt(t);
    if (!e) return null;
    return { P: sampleClip(CLIPS[e.clip], (t - e.start) * e.speed, { mirror: B.mirror, scale: B.scale, ground: groundOf(F) }), F };
  };
  // where he is on the ground (under his pelvis) and which way he faces
  B.spotAt = (t) => { const s = B.poseAt(t); if (!s) return B.base.at.slice(); const q = toPark(s.F, s.P.pelvis); return [q[0], 0, q[2]]; };
  B.facingAt = (t) => { const s = B.poseAt(t); return s ? s.F.yaw + (s.P.twist || 0) : B.base.yaw; };
  return B;
}

// When his last clip so far is done.
export const endOf = (B) => { const e = B.clips[B.clips.length - 1]; return e.start + CLIPS[e.clip].duration / e.speed; };

// A copy of a body's plan to try something on without touching his own.
export function cloneBody(B) {
  const C = makeBody({ n: B.n, id: B.id, slot: B.slot, role: B.role, mirror: B.mirror, scale: B.scale, at: B.base.at, yaw: B.base.yaw, place: B.place });
  C.clips = B.clips.map((e) => ({ ...e }));
  C.free = B.free;
  return C;
}

// ── moving him ─────────────────────────────────────────────────────────────────
// He runs from where he is at t0 to frame `to` (`{ at, yaw }`), getting there at t1: a run cycle
// at the speed it takes, played no slower or faster than PLAYBACK allows (a run that can't go
// slow enough sets off later; one that can't go fast enough gets as close as it can and the mix
// takes up the rest), facing the way he goes. A turn of more than TURN takes its first strides at
// half the angle, the cycle carried on round the turn. Nothing for a step or two, which the next
// clip's mix takes up.
//
// ⚠ A MIX BETWEEN A MAN AT REST AND A RUN SURGES. Mixed out of a still pose, a run that starts
// where he stands drags him ahead at nearly twice its speed half way through the mix, and a run
// mixed into a clip that starts at rest runs on past it and comes back. So the run's frame starts
// half a mix's travel behind him, and one going into a clip that starts at rest (`o.rest`) ends
// half a mix's travel short of it: the mix then takes him up to speed and down again without a
// surge. One going into a clip that starts running (`o.enter`, its speed) runs in at that speed
// where he has the time, so the mix doesn't change his pace as well as his stride.
// Returns { start, cycle, speed, v } or null.
export function runTo(B, to, t0, t1, o = {}) {
  t0 = Math.max(t0, B.free);
  const P0 = B.spotAt(t0), T = t1 - t0;
  if (flat(P0, to.at) < (o.min ?? 3) || T < 0.25) return null;
  const face0 = B.facingAt(t0), dTurn = wrap(faceTo(P0, to.at) - face0), bend = Math.abs(dTurn) > TURN && flat(P0, to.at) > 12;
  const h1 = bend ? face0 + dTurn / 2 : faceTo(P0, to.at), rest = !!o.rest;
  let v = Math.max(flat(P0, to.at) / T, (o.enter || 0) * 0.95), c = null, speed = 1, S = P0, E = to.at, d1 = 0, total = 0;
  for (let k = 0; k < 3; k++) {
    c = cycleFor(Math.max(v, o.atLeast || 0)); speed = clamp(v / c.v, PLAYBACK[0], PLAYBACK[1]);
    const lead = c.v * speed * (o.fade ?? FADE) / 2;
    S = sub(P0, ahead(h1, lead));
    const hEnd = faceTo(bend ? add(S, ahead(h1, Math.min(8, flat(S, to.at) * 0.3))) : S, to.at);
    E = rest ? sub(to.at, ahead(hEnd, lead)) : to.at;
    d1 = bend ? Math.min(8, flat(S, E) * 0.3) + lead : flat(S, E);
    // the second leg sets off where the first has him half way through the mix between them, a
    // little past the corner: counted from the corner, a sprint round a turn ended 2.8 ft short
    const turned = d1 + c.v * speed * BEND_MIX / 2;
    total = bend ? turned + flat(add(S, ahead(h1, turned)), E) : d1;
    v = Math.max(total / T, (o.enter || 0) * 0.95);
  }
  const start = Math.max(t0, t1 - timeFor(c.id, total) / speed);
  B.play(c.id, start, { frame: { at: S, yaw: bend ? h1 : faceTo(S, E) }, speed, fade: o.fade ?? FADE });
  if (bend) {
    // carried on round the turn: the same stride, the new way, the two legs crossing half way
    // through the mix (crossing where it starts, the mix would swing him wide)
    const s2 = start + timeFor(c.id, d1) / speed, tm = s2 + BEND_MIX / 2, ph = (tm - start) * speed, r = rootAt(CLIPS[c.id], ph), here = B.frameAt(tm).at;
    const yaw = faceTo(here, E) - (r.yaw || 0), at2 = sub(here, turn([r.at[0], 0, r.at[1]], yaw));
    B.play(c.id, start, { frame: { at: [at2[0], 0, at2[2]], yaw }, speed, fade: BEND_MIX, from: s2 });
  }
  return { start, cycle: c.id, speed, v: c.v * speed };
}

// He comes to rest where he is, in a fielder's set (the last fifth of the ready clip), facing `yaw`
// or the way he faces: for a clip that ends moving with nothing after it.
export function settle(B, t, yaw = null) {
  const id = 'field_ready_in', tau = 0.78, r = rootAt(CLIPS[id], tau), y = yaw ?? B.facingAt(t), at = sub(B.spotAt(t), turn([r.at[0], 0, r.at[1]], y));
  return B.play(id, t - tau, { frame: { at: [at[0], 0, at[2]], yaw: y - (r.yaw || 0) }, fade: 0.3, from: t });
}

// He pulls up from a run, at the speed he's going (`v`, feet a second).
export const pullUp = (B, t, v = 21, o = {}) => B.play('run_stop', t, { speed: clamp(v / 21, 0.5, 1.3), fade: o.fade ?? 0.15 });
