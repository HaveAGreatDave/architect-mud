// DEADBALL · THE GROUNDS CREW. In the middle of the fifth (the break before the bottom of the fifth,
// when it holds long enough: cast.js crewDue) four of them drag the infield: two to a mat, the two
// pairs side by side, in from foul ground beyond third, round the skirt of the infield past second
// base and off into foul ground beyond first, the inner pair's mat clear of the bags and the outer
// pair's clear of the grass (cast.js CREW_ARCS). Each pair turns onto its arc and off it rather
// than on the spot. Behind each mat the dirt is as it was painted again: the game's marks there are
// gone (gl/ballpark.js smoothDirt). The battery comes out and warms up while they drag; the
// infielders wait by their dugout till the mats are off the dirt.
//
// The crew are people like the rest (cast.js puts them in their lanes beyond third in work clothes,
// in the batting side's empty slots), walking with run_walk and pulling with crew_drag, each pair
// abreast all the way (`walkTimed`). A mat isn't a body: the director hands the view each mat's
// way and times (`drags`), `matAt` says where it is at any moment and which way it lies, and the
// renderer draws it (ballpark.js setMats), its ropes up over each man's right shoulder to his hands.
//
// The leaders' table comes down a few seconds into the drag and a camera in a well across the field
// follows the crew round, from first base's side while they're on third's half and from third's
// on first's (`crewShots`), and the high camera has them going off.
//
// Pure: no DOM and no GL.

import { CLIPS } from './clips.js';
import { rootAt } from './anim.js';
import { DEG } from './geo.js';
import { clamp, add, sub, mul, flat, faceTo, turn, makeBody } from './bodies.js';
import { CREW_ARCS, CREW_TURN, CREW_GATE, CREW_GAP, crewLane } from './cast.js';
import { restAt } from './between.js';

// The drag: the arcs' points this many degrees apart at most; how far behind its pair a mat's
// middle trails, and its size across and along (ft); how fast the pairs walk in, pull (the outer
// pair; the inner keeps abreast of it) and walk off (ft/s); how long into the pull the table comes
// down (s); and how much the crew camera takes in (ft, top to bottom), following the crew and
// holding still, and from where.
export const CREW = Object.freeze({
  step: 3, lag: 4.5, mat: Object.freeze([6, 3]),
  walkIn: 3.6, pull: 3.7, walkOff: 4.0, table: 6, wide: 6, frame: 16, still: 34,
  eye: Object.freeze([56, 22, 14]),
});
const RUBBER_Z = 60.5;
const unitOf = (v) => { const l = Math.hypot(v[0], v[2]) || 1; return [v[0] / l, 0, v[2] / l]; };
const arcPoint = (r, th) => [r * Math.sin(th * DEG), 0, RUBBER_Z + r * Math.cos(th * DEG)];

// The way of a pair's middle (`i`, 0 the inner pair, 1 the outer): along its lane from the gate
// beyond third, round its turn onto the arc, round the arc to first's side, round the turn off it
// and along its lane out to the gate beyond first. Returns { pts, s (the distance along at each),
// i0, i1 (the arc's start and end) }.
export function wayOf(i) {
  const a = CREW_ARCS[i], R = CREW_TURN, k = a.r + R, lane = crewLane(a), c = Math.cos(a.th * DEG), sn = Math.sin(a.th * DEG);
  // points round a turn's middle, on third's side (x = 1) or first's (-1), from angle `from` to
  // `to` in degrees in the ground's plane, 15 or fewer apart, the first left out
  const round = (x, from, to) => {
    const o = [x * k * sn, 0, RUBBER_Z + k * c], out = [], n = Math.max(1, Math.ceil(Math.abs(to - from) / 15));
    for (let j = 1; j <= n; j++) { const g = (from + ((to - from) * j) / n) * DEG; out.push([o[0] + R * Math.cos(g), 0, o[2] + R * Math.sin(g)]); }
    return out;
  };
  const pts = [[CREW_GATE, 0, lane], [k * sn, 0, lane], ...round(1, -90, -90 - a.th)];
  const i0 = pts.length - 1, n = Math.ceil((2 * a.th) / CREW.step);
  for (let j = 1; j <= n; j++) pts.push(arcPoint(a.r, a.th - (2 * a.th * j) / n));
  const i1 = pts.length - 1;
  pts.push(...round(-1, a.th - 90, -90), [-CREW_GATE, 0, lane]);
  const s = [0];
  for (let j = 1; j < pts.length; j++) s.push(s[j - 1] + flat(pts[j - 1], pts[j]));
  return { pts, s, i0, i1 };
}

// Both pairs' ways on the clock from `t0`: the pair with the longer way in sets off at t0 and the
// other as much later as puts them on their arcs together; the outer pair pulls at CREW.pull and
// the inner as fast as keeps it abreast, so they come off their arcs together too, and each walks
// off at its own pace. Returns each way with `T` (the time at each point), `arc` (the distances
// along it the arc runs between) and `end`.
export function dragWays(t0) {
  const ways = CREW_ARCS.map((_, i) => wayOf(i));
  const tOn = t0 + Math.max(...ways.map((w) => w.s[w.i0])) / CREW.walkIn;
  const tOff = tOn + Math.max(...ways.map((w) => w.s[w.i1] - w.s[w.i0])) / CREW.pull;
  return ways.map((w) => {
    const pace = (w.s[w.i1] - w.s[w.i0]) / (tOff - tOn);
    const T = w.s.map((x, j) => (j <= w.i0 ? tOn - (w.s[w.i0] - x) / CREW.walkIn : j <= w.i1 ? tOn + (x - w.s[w.i0]) / pace : tOff + (x - w.s[w.i1]) / CREW.walkOff));
    return { ...w, T, arc: [w.s[w.i0], w.s[w.i1]], end: T[T.length - 1] };
  });
}

// A man's way beside his pair's middle, `off` feet to its right (+) or left (-): each point moved
// across the way it's going there (the mean of the legs either side at a corner).
function beside(pts, off) {
  return pts.map((q, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], d = unitOf(sub(b, a)), n = [-d[2], 0, d[0]];
    return add(q, mul(n, off));
  });
}

// He goes along `pts`, at each one at its time in `T`, in `clip` for each leg (`clips[i]` for the
// leg into point i): a stretch of the cycle a leg, each aimed from where the last left him at the
// next point and played as fast as that takes (0.75 to 1.35 of the cycle's own pace), handed on at
// the same point in the stride half way through a short mix, as between.js walkAlong does. Returns
// when he's at the last point.
export function walkTimed(B, pts, T, clips, o = {}) {
  let start = null, prevDur = 0, prevP = 1, t = T[0];
  for (let i = 1; i < pts.length; i++) {
    const clip = CLIPS[clips[i]], v = rootAt(clip, clip.duration).at[1] / clip.duration;
    const here = start == null ? pts[i - 1] : B.frameAt(t).at, L = flat(here, pts[i]), h = faceTo(here, pts[i]);
    if (L < 0.05) continue;
    const want = L / Math.max(0.05, T[i] - t), p = clamp(want / v, 0.75, 1.35), u = v * p;
    if (start == null) {
      const fade = o.fade ?? 0.35, lead = (u * fade) / 2, at = sub(here, mul(unitOf(sub(pts[i], here)), lead));
      B.play(clip.id, t, { frame: { at: [at[0], 0, at[2]], yaw: h }, speed: p, fade });
      start = t;
      t += (L + lead) / u;
    } else {
      const ph = (((((t - start) * prevP) / prevDur) % 1) + 1) % 1, st = t - ((ph + 1) * clip.duration) / p;
      const r = rootAt(clip, (t - st) * p), at = sub(here, turn([r.at[0], 0, r.at[1]], h));
      B.play(clip.id, st, { frame: { at: [at[0], 0, at[2]], yaw: h }, speed: p, fade: 0.2, from: t - 0.1 });
      start = st;
      t += L / u;
    }
    prevDur = clip.duration; prevP = p;
  }
  return t;
}

// The crew's drag, planned from `t0`: each pair in along its lane, round its arc and out, abreast,
// and stood easy at the gate beyond first after; stood easy where the cast has him from `from`
// till his pair sets off. `cast` is the half payload's. Returns { bodies, drags (a pair each,
// dragWays's, with `men`: each man's slot and which side of the mat he pulls, +1 its right), off
// (when the mats are off the dirt), done (when the crew are at the gate) } or null when the crew
// aren't in the cast, or couldn't be at the gate by `by` with the mats off the dirt `room` seconds
// before it.
export function planCrew({ cast, t0, from = t0, by, room = 0 }) {
  const crew = (cast || []).filter((c) => c.look.role === 'crew').sort((a, b) => a.look.slot - b.look.slot);
  if (crew.length < 2 * CREW_ARCS.length) return null;
  const drags = dragWays(t0).map((w) => ({ ...w, men: [] }));
  const done = Math.max(...drags.map((d) => d.end)) + 0.6, off = Math.max(...drags.map((d) => d.T[d.i1]));
  if (done > by || off + room > by) return null;
  const bodies = [];
  drags.forEach((d, i) => {
    // the pair's first man walks on its right, his mate on its left
    crew.slice(2 * i, 2 * i + 2).forEach((c, k) => {
      const off = k ? -CREW_GAP : CREW_GAP, pts = beside(d.pts, off);
      pts[0] = [c.at[0], 0, c.at[2]];
      const clips = pts.map((_, j) => (j > d.i0 && j <= d.i1 ? 'crew_drag' : 'run_walk'));
      const B = makeBody({ n: 70 + c.look.slot, id: c.id, slot: c.look.slot, role: 'crew', at: c.at, yaw: c.yaw, mirror: false, scale: c.scale, place: true });
      B.play('stand_idle', from, { frame: { at: pts[0], yaw: c.yaw } });
      const end = walkTimed(B, pts, d.T, clips), last = pts[pts.length - 1];
      restAt(B, last, faceTo(pts[pts.length - 2], last), end - 0.2);
      d.men.push({ slot: c.look.slot, side: Math.sign(off) });
      bodies.push(B);
    });
  });
  return { bodies, drags, off, done };
}

// Where a drag's mat is at t: its middle `CREW.lag` behind the pair's along their way (before they
// set off it lies behind them in their lane), the way it lies, and the two points its ropes run up
// to (the pair's hands, near enough, for a renderer that hasn't their poses), right then left. `on`
// while its middle's on the arc, where the dirt goes back to as painted behind it. Returns
// { at, yaw, w, l, ropes, men, on, s }.
export function matAt(d, t) {
  const n = d.pts.length;
  let s;
  if (t <= d.T[0]) s = 0;
  else if (t >= d.T[n - 1]) s = d.s[n - 1];
  else { let i = 1; while (i < n - 1 && d.T[i] < t) i++; s = d.s[i - 1] + ((d.s[i] - d.s[i - 1]) * (t - d.T[i - 1])) / Math.max(1e-6, d.T[i] - d.T[i - 1]); }
  const along = (x) => {
    if (x <= 0) { const u = unitOf(sub(d.pts[1], d.pts[0])); return { q: add(d.pts[0], mul(u, x)), u }; }
    let i = 1; while (i < n - 1 && d.s[i] < x) i++;
    const u = unitOf(sub(d.pts[i], d.pts[i - 1])), f = clamp((x - d.s[i - 1]) / Math.max(1e-6, d.s[i] - d.s[i - 1]), 0, 1);
    return { q: add(d.pts[i - 1], mul(sub(d.pts[i], d.pts[i - 1]), f)), u };
  };
  const m = along(s - CREW.lag), head = along(s), side = [-head.u[2], 0, head.u[0]];
  const hands = (k) => { const q = add(head.q, mul(side, k * CREW_GAP)); return [q[0], 3.9, q[2]]; };
  return {
    at: [m.q[0], 0, m.q[2]], yaw: Math.atan2(m.u[0], m.u[2]) / DEG, w: CREW.mat[0], l: CREW.mat[1],
    ropes: [hands(1), hands(-1)], men: d.men || [], on: s - CREW.lag >= d.arc[0] && s - CREW.lag <= d.arc[1], s: s - CREW.lag,
  };
}

// The ground a mat has gone over since it was at `from` (an earlier matAt): its footprint stretched
// back along the way to where it was, as four corners [x, z] for the renderer to put the dirt back
// inside (gl/ballpark.js smoothDirt).
export function swept(from, to) {
  const u = unitOf(sub(to.at, from.at)), d = flat(from.at, to.at) > 0.01 ? u : [Math.sin(to.yaw * DEG), 0, Math.cos(to.yaw * DEG)];
  const n = [-d[2], 0, d[0]], hw = to.w / 2, hl = to.l / 2;
  const back = sub(from.at, mul(d, hl)), front = add(to.at, mul(d, hl));
  return [add(back, mul(n, hw)), add(front, mul(n, hw)), sub(front, mul(n, hw)), sub(back, mul(n, hw))].map((q) => [q[0], q[2]]);
}
// The ground a drag's mat goes over on its arc between t0 and t1, a step of about a foot and a half
// at a time, so a long gap (a tab that was hidden) follows the curve rather than cutting across it.
export function sweptAlong(d, t0, t1) {
  const out = [];
  if (!(t1 > t0)) return out;
  let a = matAt(d, t0);
  const n = Math.max(1, Math.ceil(Math.abs(matAt(d, t1).s - a.s) / 1.5));
  for (let k = 1; k <= n; k++) {
    const b = matAt(d, t0 + ((t1 - t0) * k) / n);
    if (a.on || b.on) out.push(swept(a, b));
    a = b;
  }
  return out;
}

// The crew camera (diamond/camera.js 'crew') from `eye`, on both pairs and their mats, CREW.frame
// feet top to bottom; held still for a viewer who's asked for less motion, on where they'll be
// half way through the shot (from `at` to `end`), with more in it so they walk through.
function follow(drags, eye, at, end, motion) {
  const track = (t) => {
    let x = 0, z = 0;
    for (const d of drags) {
      const m = matAt(d, t);
      x += m.at[0] + (m.ropes[0][0] + m.ropes[1][0]) / 2; z += m.at[2] + (m.ropes[0][2] + m.ropes[1][2]) / 2;
    }
    return [x / (2 * drags.length), 2.8, z / (2 * drags.length)];
  };
  if (motion !== false) return { shot: 'crew', eye, frame: CREW.frame, track };
  const aim = track((at + end) / 2);
  return { shot: 'crew', eye, frame: CREW.still, track: () => aim };
}
// The cameras on the drag: the leaders' table comes down CREW.table seconds into the pull, the crew
// camera follows the crew from the well on first base's side to half way round, the high camera
// has them going past second for CREW.wide seconds, the camera in third base's well follows them
// on to first, and the high camera has them going off. `o.motion` false holds the crew camera
// still. Returns { table, shots: [{ at, shot }] } on the world's clock.
export function crewShots(plan, o = {}) {
  const d = plan.drags[0], on = d.T[d.i0], off = d.T[d.i1], half = (on + off) / 2;
  const table = on + CREW.table, wide0 = half - CREW.wide / 2, wide1 = half + CREW.wide / 2, out = off + 0.5;
  const eye = (x) => [x * CREW.eye[0], CREW.eye[1], CREW.eye[2]];
  return {
    table,
    shots: [
      { at: table, shot: follow(plan.drags, eye(-1), table, wide0, o.motion) },
      { at: wide0, shot: 'high' },
      { at: wide1, shot: follow(plan.drags, eye(1), wide1, out, o.motion) },
      { at: out, shot: 'high' },
    ],
  };
}
