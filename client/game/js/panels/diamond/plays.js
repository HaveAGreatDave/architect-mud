// DEADBALL · THE PLAY. A ball put in play, planned for the 3-D park from what the server decided.
//
// synthPlay (plugins/broadcast/sports/baseball.js) decides every ball in play, and the payload
// carries it as `play`: the spray, the exit speed and launch angle, where it's fielded or comes
// down, the fielders it goes through, how the first got to it, the throw and what went wrong. Both
// sides judge it on diamond/play.js, so here the ball gets where the server said, when it said: a
// ball on the ground runs on play.js's own roll (flight.js groundPath), and one in the air comes
// down in its hang time (flyPath).
//
// THE BALL DECIDES, AND EVERYONE MEETS IT. A fielding clip is placed so its catch lands on the
// ball (anim.js catchPoint): its frame faces where the ball comes from, or for a clip that runs
// the way he's running, and stands off it by where the clip has the glove at the catch. The run
// before it is a run cycle at the speed it takes, its playback matched so he gets there as the
// clip begins, and a run with a long way round turns on the way. A throw is turned so the hand's
// own way at the release points at its target; it leaves the hand at the release and is in the
// receiver's glove at his catch. A reach layer takes the glove the last inches to the ball, and
// the ball rides in the hand from the catch to the throw. The batter comes out of the box with
// the clip for his side and runs to first at his own legs' pace (play.js toFirst), and the base
// umpire calls it there.
//
// `planPlay` is arithmetic over the clips: what every body plays, when and from where, the ball's
// flights and holds, the reaches and looks, the cuts, the sounds and when the play lands. The
// director (diamond/director.js) schedules it on the world's clock, and diamond-smoke holds the
// ball to every glove it meets. Not here yet: the runners on the bags and the batter rounding
// first (Phase 3d).
//
// Pure: no DOM and no GL.

import { CLIPS } from './clips.js';
import { catchPoint, handAt, rootAt, sampleClip } from './anim.js';
import { solvePose } from './rig.js';
import { BAGS, DEG, groundHeight } from './geo.js';
import { toPark as onLine, rollAlong, rollTime, hangTime, toFirst, fenceAt, throwTime, firstStep, POSITIONS } from './play.js';
import { groundPath, flyPath, throwPath, fitPath, BALL_R, GRAVITY } from './flight.js';
import { carried, toPark } from './world.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const wrap = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
// facing from p toward q, in degrees about the vertical (0 faces +z), as cast.js has it
const faceTo = (p, q) => Math.atan2(q[0] - p[0], q[2] - p[2]) / DEG;
// a frame's point turned by its yaw, as world.js toPark turns it
const turn = (v, yaw) => { const c = Math.cos(yaw * DEG), s = Math.sin(yaw * DEG); return [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]]; };
const ahead = (yaw, d) => [Math.sin(yaw * DEG) * d, 0, Math.cos(yaw * DEG) * d];
const HOME = Object.freeze([0, 0, 0]);
function hashStr(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

// The run cycles and how fast each goes (its root over a lap).
const CYCLES = ['run_jog', 'run_run', 'run_sprint'].map((id) => { const c = CLIPS[id], end = c.root[c.root.length - 1].at; return { id, v: Math.hypot(end[0], end[1]) / c.duration }; });
const cycleFor = (v) => CYCLES.reduce((best, c) => (Math.abs(c.v - v) < Math.abs(best.v - v) ? c : best));
// The fastest and slowest a run cycle is played, as a share of its own speed.
const PLAYBACK = Object.freeze([0.72, 1.3]);
// How long a clip takes to mix into the next, and the most a body turns across one mix: a run
// that has to turn further takes its first strides at half the angle.
const FADE = 0.2, TURN = 80;
// The fastest a fielder runs to a ball on the ground, feet a second.
const RUN_MAX = 27;
// How far short of a clip's start he'd be, L feet from it with T seconds to get there: a step or
// two (3 ft) the mix takes up, and anything more a run, which takes a quarter of a second at least
// (runTo makes no shorter one).
const shortBy = (L, T) => (L <= 3 ? 0 : T < 0.25 ? L - 2 : Math.max(0, L - 3 - RUN_MAX * T));
// How far a cycle has carried him at clip time `tau`, and the clip time it carries him `L` feet.
const runOf = (id, tau) => rootAt(CLIPS[id], tau).at[1];
function timeFor(id, L) {
  let a = 0, b = Math.max(0.05, L / 10 + 1);
  for (let k = 0; k < 40; k++) { const m = (a + b) / 2; if (runOf(id, m) < L) a = m; else b = m; }
  return (a + b) / 2;
}
// How far pulling up (run_stop) carries him, and when the ready set's hop lands (its last step).
const STOP = CLIPS.run_stop, STOP_LEN = rootAt(STOP, STOP.duration).at[1];
const READY_STEP = (id) => Math.max(...CLIPS[id].events.filter((e) => e.kind === 'step').map((e) => e.t));

// The ground under a frame, as the world has it (world.js groundOf).
const groundOf = (F) => (x, z) => { const q = toPark(F, [x, 0, z]); return groundHeight(q[0], q[2]) - F.at[1]; };
// A ball on the ground that comes up off its last hop to height y at tC, into a glove keyed to
// take it there (every fielding clip's catch is a little off the grass), and down again after it
// for one that gets by him: `path` as it was everywhere else.
function hopped(path, tC, y) {
  const h = Math.sqrt(2 * Math.max(0.01, y - BALL_R) / GRAVITY);
  const at = (t) => {
    const q = path(t);
    if (t < tC - h || t > tC + h) return q;
    const u = (t - tC) / h;
    return [q[0], Math.max(q[1], BALL_R + (y - BALL_R) * (1 - u * u)), q[2]];
  };
  return Object.assign(at, path);
}
// A ball popped from `from` to rest on the ground at `to` in T seconds, and lying there after.
function toRest(from, to, t0, T) {
  const down = [to[0], BALL_R, to[2]], arc = fitPath(from, down, t0, T, [0, -GRAVITY, 0], { bounce: false });
  const at = (t) => (t >= t0 + T ? down.slice() : arc(t));
  at.t0 = t0; at.T = T;
  return at;
}
// the hand a clip names, on a left-hander who does it in a mirror
const sideOf = (B, h) => (B.mirror ? (h === 'L' ? 'R' : 'L') : h);

// ── a body's plan ──────────────────────────────────────────────────────────────
// What one body plays: each clip with when it starts, its speed, its mix and the frame it starts
// from, worked out as the world will (a clip that travels carries the next one's frame unless it's
// given one). A clip takes over at `on`: when it's issued, which is its start unless it's taken up
// part way through (`from`) or issued early to hold its first frame (`issue`, the ready set from
// the cut in). `free` is when he's next free to be sent somewhere.
const onOf = (e) => e.issue ?? e.from ?? e.start;
function makeBody(o) {
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

// Where clip `id`'s catch puts the glove for B, in the frame it starts from (kept: the planner
// asks for it hundreds of times a play).
const CATCHES = new Map();
const catchOf = (B, id) => {
  const key = `${id}|${B.mirror ? 1 : 0}|${B.scale}`;
  if (!CATCHES.has(key)) CATCHES.set(key, catchPoint(CLIPS[id], { mirror: B.mirror, scale: B.scale }));
  return CATCHES.get(key);
};
// The frame clip `id` starts from for its catch to put the glove on `ball`, facing `yaw`.
function frameOn(B, id, ball, yaw) {
  const c = catchOf(B, id), q = turn(c.at, yaw);
  return { at: [ball[0] - q[0], 0, ball[2] - q[2]], yaw, t: c.t, glove: c.at };
}
// Where clip `id` from frame `fr` (started at tS) has the glove at its catch in the park, on the
// ground under him as the world has it: on the mound's slope a pitcher's glove isn't where the
// flat ground puts it.
function gloveAt(B, id, fr, tS) {
  const clip = CLIPS[id], ev = clip.events.find((x) => x.kind === 'catch'), F = carried(fr, clip, tS, 1, tS + ev.t, B.mirror);
  const P = sampleClip(clip, ev.t, { mirror: B.mirror, scale: B.scale, ground: groundOf(F) });
  return toPark(F, handAt(P, sideOf(B, ev.hand), ev.hand === 'R' ? 'bare' : B.role === 'catcher' ? 'mitt' : 'glove', B.scale));
}
// The same for a clip that runs into its catch: facing the way he runs to it from `from`. A ball
// nearer him than the clip runs puts its start behind him, facing the ball through him; he takes
// it up part way through (runInto).
function frameRunning(B, id, ball, from) {
  let yaw = faceTo(from, ball), fr = frameOn(B, id, ball, yaw);
  const behind = (f) => (f.at[0] - from[0]) * Math.sin(yaw * DEG) + (f.at[2] - from[2]) * Math.cos(yaw * DEG) < 0;
  if (behind(fr)) return fr;
  for (let k = 0; k < 4; k++) { yaw = faceTo(from, fr.at); fr = frameOn(B, id, ball, yaw); }
  return fr;
}

// Where the clip in entry `e` has his throwing hand at its release: the hand's centre a fifth of a
// foot out along it, as the director's pitches have it.
function releaseOf(B, e) {
  const clip = CLIPS[e.clip], ev = clip.events.find((x) => x.kind === 'release'), t = e.start + ev.t / e.speed;
  const F = carried(e.F, clip, e.start, e.speed, t, B.mirror);
  const P = sampleClip(clip, ev.t, { mirror: B.mirror, scale: B.scale, ground: groundOf(F) });
  const J = solvePose({ ...P, at: F.at, yaw: F.yaw, scale: B.scale }).J, h = sideOf(B, ev.hand);
  return { t, at: add(J['wr' + h], mul(J['hdir' + h], 0.2)), hand: h };
}
// Which way a clip throws, in degrees off the way its start frame faces: the throwing hand's way
// along the ground at the release.
const HEADINGS = new Map();
function throwHeading(id, mirror) {
  const key = id + (mirror ? '|m' : '');
  if (HEADINGS.has(key)) return HEADINGS.get(key);
  const clip = CLIPS[id], ev = clip.events.find((x) => x.kind === 'release'), h = mirror ? (ev.hand === 'L' ? 'R' : 'L') : ev.hand;
  const hand = (t) => { const r = rootAt(clip, t, { mirror }); return solvePose({ ...sampleClip(clip, t, { mirror }), at: [r.at[0], 0, r.at[1]], yaw: r.yaw }).J['wr' + h]; };
  const a = hand(ev.t - 1 / 60), b = hand(ev.t + 1 / 60), v = Math.atan2(b[0] - a[0], b[2] - a[2]) / DEG;
  HEADINGS.set(key, v);
  return v;
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
function runTo(B, to, t0, t1, o = {}) {
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
    total = bend ? d1 + flat(add(S, ahead(h1, d1)), E) : d1;
    v = Math.max(total / T, (o.enter || 0) * 0.95);
  }
  const start = Math.max(t0, t1 - timeFor(c.id, total) / speed);
  B.play(c.id, start, { frame: { at: S, yaw: bend ? h1 : faceTo(S, E) }, speed, fade: o.fade ?? FADE });
  if (bend) {
    // carried on round the turn: the same stride, the new way, the two legs crossing half way
    // through the mix (crossing where it starts, the mix would swing him wide)
    const s2 = start + timeFor(c.id, d1) / speed, tm = s2 + 0.075, ph = (tm - start) * speed, r = rootAt(CLIPS[c.id], ph), here = B.frameAt(tm).at;
    const yaw = faceTo(here, E) - (r.yaw || 0), at2 = sub(here, turn([r.at[0], 0, r.at[1]], yaw));
    B.play(c.id, start, { frame: { at: [at2[0], 0, at2[2]], yaw }, speed, fade: 0.15, from: s2 });
  }
  return { start, cycle: c.id, speed, v: c.v * speed };
}

// He runs from where he is at t0 into clip `id` from frame `fr` for its catch at tC: taken from
// its start where he can get there in time, or taken up part way through (`from`), as late as
// the run needs and no later than a third of a second before the catch. A clip that starts
// running he runs into at its own speed. Returns the clip's entry.
function runInto(B, id, fr, tC, t0) {
  const clip = CLIPS[id], tS = tC - fr.t, s0 = B.spotAt(Math.max(t0, B.free));
  const speedAt = (tau) => { const a = rootAt(clip, Math.max(0, tau - 0.02)), b = rootAt(clip, tau + 0.02); return Math.hypot(b.at[0] - a.at[0], b.at[1] - a.at[1]) / 0.04; };
  // somewhere he can get to in time and not behind him on the clip's way: the first such, or the
  // nearest thing to it
  const fwd = [Math.sin(fr.yaw * DEG), Math.cos(fr.yaw * DEG)], from = Math.max(t0, B.free);
  const miss = (t) => {
    const q = carried(fr, clip, tS, 1, t, B.mirror).at;
    return shortBy(flat(q, s0), t - from) + Math.max(0, -1.5 - ((q[0] - s0[0]) * fwd[0] + (q[2] - s0[2]) * fwd[1]));
  };
  let on = Math.max(tS, t0), best = { t: on, m: Infinity };
  for (let t = on; t <= tC - 0.3 + 1e-9; t += 0.02) {
    const m = miss(t);
    if (m < best.m - 1e-9) best = { t, m };
    if (!m) break;
  }
  on = best.t;
  const there = carried(fr, clip, tS, 1, on, B.mirror);
  const v = speedAt(on - tS);
  const ran = runTo(B, { at: there.at, yaw: there.yaw }, t0, on, { atLeast: v > 8 ? Math.min(20, v) : 0, enter: v > 8 ? v : 0, rest: v <= 8 });
  return B.play(id, tS, { frame: fr, fade: FADE, ...(on > tS + 1e-6 ? { from: on, carry: !ran } : {}) });
}

// He comes to rest where he is, in a fielder's set (the last fifth of the ready clip), facing `yaw`
// or the way he faces: for a clip that ends moving with nothing after it.
function settle(B, t, yaw = null) {
  const id = 'field_ready_in', tau = 0.78, r = rootAt(CLIPS[id], tau), y = yaw ?? B.facingAt(t), at = sub(B.spotAt(t), turn([r.at[0], 0, r.at[1]], y));
  return B.play(id, t - tau, { frame: { at: [at[0], 0, at[2]], yaw: y - (r.yaw || 0) }, fade: 0.3, from: t });
}

// He pulls up from a run, at the speed he's going (`v`, feet a second).
const pullUp = (B, t, v = 21, o = {}) => B.play('run_stop', t, { speed: clamp(v / 21, 0.5, 1.3), fade: o.fade ?? 0.15 });

// ── the plan ───────────────────────────────────────────────────────────────────
// `ctx` is { p (the payload), cast (cast.js castOf), tIn (the last pitch's cut in), tBat (contact),
// at (the ball at contact), pitcher, catcher, batter }: the battery and the hitter as the world has
// them ({ slot, id, at, yaw, mirror, scale }, and for the pitcher and catcher the clip they're in:
// { clip, start, speed }). Returns null for a payload with no play, else:
//
//   bodies   [{ n, id, slot, role, mirror, scale, base, place, clips: [{ clip, start, speed, fade,
//            F, given, from?, issue? }] }]: a body with `place` is placed in the world at the cut
//            in; a clip is played at `issue` if it has one, else at its start
//   balls    the ball's way, in order: [{ from, to, path }] in flight, [{ from, to, hold: { slot,
//            hand, kind }, at }] in a hand (`at` where it was caught)
//   reaches  [{ slot, hand, kind, target, follow, from, full, hold, to }]
//   looks    [{ slot, from, full, hold, to }]: heads turned to the ball
//   cuts     [{ at, shot }]; sounds [{ at, cue }]; landAt; and `log`, what the gate checks
export function planPlay(ctx) {
  const p = ctx.p, pl = p && p.play;
  if (!pl || !Array.isArray(pl.f) || !ctx.batter) return null;
  const tBat = ctx.tBat, kind = p.kind, bats = p.bats === 'L' ? 'L' : 'R';
  const fieldTeam = p.fieldingTeam || (p.half === 'top' ? 'Home' : 'Away');
  const seed = hashStr(`${p.batter}|${p.inning}|${p.half}|${kind}|${pl.dir}|${pl.d}`);
  const rand = (k) => ((hashStr(seed + ':' + k) % 10007) / 10007);
  const fence = fenceAt(pl.dir);

  // ── the bodies: the seven set as the pitch comes, the battery as they are ──
  const bodies = new Map();
  const fielder = (n) => {
    if (bodies.has(n)) return bodies.get(n);
    let B = null;
    if (n === 1 && ctx.pitcher) B = makeBody({ ...ctx.pitcher, n, role: 'pitcher' });
    else if (n === 2 && ctx.catcher) B = makeBody({ ...ctx.catcher, n, role: 'catcher' });
    else if (n >= 3) {
      const c = (ctx.cast || []).find((x) => x.id === `${fieldTeam}:${POSITIONS[n]}`);
      if (c) {
        B = makeBody({ n, id: c.id, slot: c.look.slot, role: 'fielder', at: c.at, yaw: c.yaw, mirror: c.mirror, scale: c.scale, place: true });
        // the ready set: the creep in as the pitch comes, the hop landing as it's hit, from the cut in
        const id = n >= 7 ? 'field_ready_out' : 'field_ready_in', s = tBat - READY_STEP(id);
        B.play(id, s, { frame: B.base, issue: ctx.tIn ?? s });
      }
    }
    if (B) bodies.set(n, B);
    return B;
  };
  // the battery too: they watch the ball, and either may field it
  for (let n = 1; n <= 9; n++) fielder(n);
  const react = (n) => tBat + firstStep(n);

  const balls = [], reaches = [], looks = [], sounds = [];
  // the high camera from home takes every ball in play, following it
  const cuts = [{ at: tBat + 0.25, shot: 'high' }];
  const log = { kind, t: pl.t, f: pl.f.slice(), fielders: [], throws: [], batter: null, ump: null, misses: [] };
  let land = tBat + 1.5;
  const fly = (from, path, extra = {}) => { balls.push({ from, path, ...extra }); return path; };
  // the ball on the ground hopping up to height y at tC (hopped), in whichever flight has it then
  const riseInto = (tC, y) => {
    const seg = balls.filter((b) => b.path && b.from <= tC + 1e-9).pop();
    if (!seg || seg.path(tC)[1] > y) return seg ? seg.path(tC) : null;
    seg.path = hopped(seg.path, tC, y);
    if (seg === balls[0]) path0 = seg.path;
    return seg.path(tC);
  };
  const hold = (from, B, hand, kind, at) => balls.push({ from, hold: { slot: B.slot, hand, kind }, at: at.slice() });
  const glove = (B) => (B.role === 'catcher' ? 'mitt' : 'glove');
  // a catch: the reach that brings his hand to the ball, its sound, and the ball in the hand after
  const caught = (B, e, at, t, o = {}) => {
    const ev = CLIPS[e.clip].events.find((x) => x.kind === 'catch'), hand = sideOf(B, ev.hand), k = ev.hand === 'R' ? 'bare' : glove(B);
    // gone before the clip's own throw, which the reach would pull back toward the catch
    const rel = CLIPS[e.clip].events.find((x) => x.kind === 'release');
    const to = Math.min(t + (o.hold ?? 0.1) + 0.4, rel ? e.start + rel.t / e.speed - 0.04 : Infinity), keep = Math.min(t + (o.hold ?? 0.1), to - 0.08);
    reaches.push({ slot: B.slot, hand, kind: k, target: at.slice(), follow: ev.reach?.follow ?? 0.3, from: t - 0.28, full: t - 0.008, hold: Math.max(t, keep), to: Math.max(t + 0.06, to) });
    sounds.push({ at: t, cue: 'glove' });
    if (!o.miss) hold(t, B, hand, k, at);
    log.fielders.push({ n: B.n, slot: B.slot, clip: e.clip, t, at: at.slice(), hand, kind: k, miss: !!o.miss });
  };

  // ── off the bat ──
  const from = ctx.at, ground = pl.t === 'gb', isHR = kind === 'homerun';
  const OUTS = new Set(['groundout', 'productout', 'doubleplay', 'tripleplay', 'flyout', 'sacfly', 'popout']);
  const isOut = OUTS.has(kind);
  const n0 = pl.f[0], F0 = fielder(n0);
  let path0;
  if (ground) path0 = groundPath(from, pl.dir, pl.ev, pl.la, tBat, rollAlong(pl.ev, pl.la));
  else if (isHR) {
    // into the seats: the bleachers rise from 11 ft, four feet back of the wall
    const y = clamp(11 + 0.6 * Math.max(0, pl.d - fence - 4), BALL_R, 34);
    path0 = flyPath(from, onLine(pl.dir, pl.d, y), tBat, hangTime(pl.ev, pl.la) * (1 - y / 120));
  } else {
    const hit = !isOut && !pl.e;
    path0 = flyPath(from, onLine(pl.dir, pl.x === 'wall' ? Math.min(pl.d, fence - 1.5) : pl.d, BALL_R), tBat, hangTime(pl.ev, pl.la), hit && pl.x !== 'wall' ? { max: fence - 3 } : null);
  }
  fly(tBat, path0);

  // when the hitter gets to first at his own pace (play.js toFirst): a throw that has to be late
  // waits for it, and he's held to it below
  const tLegs = tBat + toFirst(Number.isFinite(pl.sp) ? pl.sp : 0.5, bats);

  // ── the plays ──
  const throwChain = [];
  if (isHR) homeRun();
  else if (!ground && isOut) airOut();
  else if (ground) groundBall();
  else airHit();

  // ── the hitter: out of the box and down the line ──
  // He gets there at his own pace, but never ahead of the ball on an out at first, or behind it
  // on a throw the server says he beat, where his legs can make it.
  const atFirst = throwChain.find((x) => x.bag === 1 && x.last);
  const H = makeBody({ ...ctx.batter, n: 0, role: 'batter' });
  const outId = bats === 'L' ? 'bat_run_out_lefty' : 'bat_run_out', tOut = tBat + 0.15;
  H.play(outId, tOut, { fade: 0.1 });
  const tCyc = tOut + CLIPS[outId].duration - 0.12, here = H.frameAt(tCyc), toBag = flat(here.at, BAGS[1]);
  let tFirst = tLegs;
  if (atFirst && !atFirst.error && isOut) tFirst = Math.max(tFirst, atFirst.catch.t + 0.15);
  if (atFirst && !atFirst.error && !isOut && pl.th === 'late') tFirst = Math.max(tCyc + toBag / (CYCLES[2].v * PLAYBACK[1]), Math.min(tFirst, atFirst.catch.t - 0.12));
  const need = toBag / Math.max(0.6, tFirst - tCyc);
  const cyc = isHR ? CYCLES[0] : cycleFor(need), cSpeed = isHR ? 1 : clamp(need / cyc.v, PLAYBACK[0], PLAYBACK[1]);
  // the cycle carried on from where the run out has him (turned to first by the end of it)
  H.play(cyc.id, tCyc, { frame: { at: here.at, yaw: faceTo(here.at, BAGS[1]) }, speed: cSpeed, fade: 0.12 });
  const tReach = tCyc + timeFor(cyc.id, toBag) / cSpeed;
  log.batter = { slot: H.slot, out: outId, cycle: cyc.id, speed: cSpeed, tFirst: tReach, legs: tLegs };
  // a hit isn't over until he's on the bag; he pulls up through it, or when the ball's caught
  if (!isOut && !isHR) land = Math.max(land, tReach + 0.3);
  if (!isHR) {
    const tStop = log.airCatch != null ? clamp(log.airCatch + 0.2, tCyc + 0.3, tReach) : tReach + 0.05;
    pullUp(H, Math.max(tCyc + 0.2, tStop), cyc.v * cSpeed);
    log.batter.stop = tStop;
  }

  // ── the base umpire's call at first, on a play there ──
  const U1 = (ctx.cast || []).find((c) => c.id === 'ump:1B');
  let UB = null;
  if (U1 && atFirst && !atFirst.error) {
    const out = isOut, tCall = Math.max(atFirst.catch.t, tReach) + 0.15;
    UB = makeBody({ n: -1, id: U1.id, slot: U1.look.slot, role: 'ump', at: U1.at, yaw: U1.yaw, mirror: U1.mirror, scale: U1.scale, place: true });
    const id = out ? 'ump_out_base' : 'ump_safe_base', ev = CLIPS[id].events.find((e) => e.kind === 'call').t;
    UB.play(id, tCall - ev, { frame: UB.base });
    log.ump = { slot: UB.slot, clip: id, t: tCall, out };
    land = Math.max(land, tCall + 0.25);
  }

  // every head on the field follows the ball from the crack to the landing
  for (const B of [...bodies.values(), ...(UB ? [UB] : [])]) looks.push({ slot: B.slot, from: tBat - 0.05, full: tBat + 0.35, hold: land + 0.6, to: land + 1.2 });
  // the ball's segments run end to end, and the cameras that follow it follow them
  balls.sort((a, b) => a.from - b.from);
  balls.forEach((s, i) => { s.to = i + 1 < balls.length ? balls[i + 1].from : Infinity; });
  const track = trackOf(balls);
  const shots = cuts.filter((c) => c.at < land).sort((a, b) => a.at - b.at)
    .map((c) => ({ at: c.at, shot: c.shot === 'high' ? { shot: 'high', track } : typeof c.shot === 'object' ? { ...c.shot, track } : c.shot }));
  log.throws = throwChain;
  return {
    bodies: [H, ...bodies.values(), ...(UB ? [UB] : [])].filter((b) => b.clips.some((c) => !c.prior)),
    balls, reaches, looks, cuts: shots, sounds, landAt: land, log, track,
  };

  // ── on the ground ──
  function groundBall() {
    const B = F0;
    if (!B) return;
    const tServer = tBat + rollTime(pl.ev, pl.la, pl.d);
    const outfield = n0 >= 7;
    // which side of him it goes: his left as he faces home is +x of a frame facing home
    const set = B.spotAt(react(n0)), side = turn(sub(path0(tServer), set), -faceTo(set, HOME))[0];
    if (outfield) {
      // through the infield: the outfielder charges and meets it as soon as he can get to it (a
      // slow one can take as long as the server's spot says to roll there), and throws it in
      if (pl.mi && pl.mi !== n0) diveMiss(pl.mi, true);
      pickUp(B, path0, tBat + 0.8, pl.f[1] ?? null);
      return;
    }
    // a throw the batter beats has to wait for him, so not the barehanded pickup's own
    const id = groundClip(pl.g === 'barehand' && pl.th === 'late' ? 'routine' : pl.g, side);
    // Where his clip would have him when it takes over, for a catch at t: it starts catchT before
    // the ball gets there, taken up part way through where that's what lets him get to it in time
    // (a hard one at him, or one he has to charge), never later than a third of a second before
    // the catch. A clip he runs into he takes from its start.
    const r0 = react(n0), moving = CLIPS[id].moving === 'start', clip = CLIPS[id], set0 = B.spotAt(r0);
    // A ball on him before he's had time to react (a comebacker) he takes on reflex: the clip in
    // by 0.45 s before the catch, so its mix is done when the ball gets there.
    const plan = (t) => {
      const q = path0(t), f = frameOn(B, id, q, faceTo(q, HOME)), tS = t - f.t;
      let on = moving ? tS : Math.max(tS, tBat + 0.1, Math.min(r0, t - 0.45)), there, short;
      for (;;) {
        there = carried(f, clip, tS, 1, on, B.mirror).at;
        short = shortBy(flat(there, set0), on - r0);
        if (!short || moving || on >= t - 0.3) break;
        on += 0.02;
      }
      return { t, q, f, tS, on, there, short };
    };
    let tM = Number.isFinite(tServer) ? tServer : path0.t0 + 2, best = plan(tM);
    // he meets it where his clip has the glove, near the server's spot, or further along its roll
    // if he couldn't have got there (a dribbler the catcher has to come out for)
    {
      let cost = Infinity;
      for (let t = tM - 0.35; t <= tM + 1.5 + 1e-9; t += 0.01) {
        const c = plan(t), d = c.short * 4 + flat(c.there, set0) * 0.25 + Math.abs(t - tM) * 2;
        if (d < cost) { cost = d; best = c; }
      }
    }
    // one he can't get to anywhere along its roll (the server's dribblers don't ask whether the
    // catcher can get out to them) is a softer one: the same roll slowed until he can
    if (best.short > 0.5 && Number.isFinite(tServer)) {
      const q = path0(tServer), f = frameOn(B, id, q, faceTo(q, HOME));
      const fits = (t) => { for (let on = Math.max(t - f.t, r0); on <= t - 0.3 + 1e-9; on += 0.02) { if (!shortBy(flat(carried(f, clip, t - f.t, 1, on, B.mirror).at, set0), on - r0)) return true; } return false; };
      let tq = tServer;
      while (tq < tServer + 4 && !fits(tq)) tq += 0.02;
      const k = (tServer - tBat) / (tq - tBat), along = rollAlong(pl.ev, pl.la);
      path0 = balls[0].path = groundPath(from, pl.dir, pl.ev, pl.la, tBat, (tau) => along(tau * k));
      best = plan(tq);
    }
    tM = best.t;
    const fr = best.f, tS = best.tS;
    // the frame moved by however far the ground under him moves the glove, and the ball off its
    // last hop up into it (a ball through his legs stays down)
    const g0 = gloveAt(B, id, fr, tS);
    fr.at = [fr.at[0] + best.q[0] - g0[0], 0, fr.at[2] + best.q[2] - g0[2]];
    best.there = carried(fr, clip, tS, 1, best.on, B.mirror).at;
    const ball = pl.e === 'legs' ? best.q : riseInto(tM, gloveAt(B, id, fr, tS)[1]);
    const ran = runTo(B, { at: best.there, yaw: fr.yaw }, r0, best.on, { atLeast: moving ? 20 : 0, rest: !moving && best.on <= tS + 0.05 });
    // taken up part way from where he stands, he goes with it from the first frame
    const e = B.play(id, tS, { frame: fr, fade: FADE, ...(best.on > tS + 1e-6 ? { from: best.on, carry: !ran } : {}) });
    const err = pl.e === 'boot' || pl.e === 'legs';
    // through his legs: the glove comes down to just over it
    caught(B, e, pl.e === 'legs' ? add(ball, [0, 0.6, 0]) : ball, tM, { miss: err });
    land = tM + 0.5;
    // a man who dove for it on the way and missed
    if (pl.mi && pl.mi !== n0) diveMiss(pl.mi, true);
    if (pl.e === 'legs') {
      // through his legs and on into the outfield, where the man behind him picks it up
      settle(B, tS + CLIPS[id].duration - 0.15);
      const back = [7, 8, 9].map((n) => fielder(n)).filter(Boolean).sort((a, b) => flat(a.base.at, ball) - flat(b.base.at, ball))[0];
      if (back) pickUp(back, path0, tM + 0.3, null);
      return;
    }
    if (pl.e === 'boot') {
      // off the glove: it kicks a few feet away, and he goes and gets it
      const kick = add(ball, ahead(faceTo(HOME, ball) + (rand('kick') - 0.5) * 140, 5 + 4 * rand('far')));
      fly(tM + 1e-4, toRest(add(ball, [0, 0.3, 0]), kick, tM, 0.55));
      afterField(B, e, id);
      const tFree = tS + CLIPS[id].duration, me = B.spotAt(tFree);
      const again = frameOn(B, 'field_gb', [kick[0], BALL_R, kick[2]], faceTo(me, kick));
      const tP = tFree + 0.3 + again.t + flat(me, again.at) / 14;
      runTo(B, again, tFree, tP - again.t, { min: 2, rest: true });
      const e3 = B.play('field_gb', tP - again.t, { frame: again, fade: 0.25 });
      caught(B, e3, [kick[0], BALL_R, kick[2]], tP);
      // too late: he throws on to first anyway
      throwOn(B, e3, 'field_gb', 3, { late: true });
      return;
    }
    // the throws, man to man
    let thrower = B, entry = e, prev = n0;
    for (let k = 1; k < pl.f.length; k++) {
      // a throw to himself (3-3 on the wire) is the first baseman's to the pitcher covering
      const n = pl.f[k] === prev ? 1 : pl.f[k], last = k === pl.f.length - 1;
      const leg = throwOn(thrower, entry, entry.clip, n, { last, k });
      if (!leg) break;
      thrower = leg.R; entry = leg.recv; prev = n;
    }
    if (pl.f.length === 1 && n0 === 3) toBagHimself(B, e, id);
    else if (pl.f.length === 1) settle(B, tS + CLIPS[id].duration - 0.12);
  }

  // The clip that follows a fielding clip that ends moving (a throw follows it, or he settles).
  function afterField(B, e, id) {
    const at = e.start + CLIPS[id].duration - 0.15;
    if (CLIPS[id].moving === 'end' || CLIPS[id].moving === 'both') return id === 'field_barehand' ? pullUp(B, at, 11) : settle(B, at);
    return null;
  }

  // The first baseman takes it to the bag himself and the batter's out there.
  function toBagHimself(B, e, id) {
    const tF = e.start + CLIPS[id].duration - 0.15, bag = [BAGS[1][0], 0, BAGS[1][2]];
    const far = flat(B.spotAt(tF), bag);
    let tTag = tF + 0.3;
    if (far > 3) {
      const r = runTo(B, { at: add(bag, ahead(faceTo(B.spotAt(tF), bag), 2)), yaw: 0 }, tF, tF + Math.max(0.5, far / 18), { min: 2 });
      tTag = r ? tF + Math.max(0.5, far / 18) - 2 / 18 : tTag;
      pullUp(B, tF + Math.max(0.5, far / 18), r ? r.v : 14);
    } else settle(B, tF);
    throwChain.push({ from: 3, to: 3, bag: 1, last: true, self: true, catch: { t: tTag, at: bag } });
    land = Math.max(land, tTag + 0.3);
  }

  // B, in entry `e` of clip `id`, throws on to fielder n: the throw that follows the clip (or the
  // one in it), the receiver at his bag or spot, his catch, and the ball between them. Returns the
  // receiver and his clip.
  function throwOn(B, e, id, n, o = {}) {
    const R = fielder(n);
    if (!R) return null;
    const dp = (kind === 'doubleplay' || kind === 'tripleplay') && !o.last;
    const bag = n === 3 || (n === 1 && o.last) ? 1 : dp ? 2 : n === 5 && kind === 'triple' ? 3 : null;
    // the cutoff on a ball to the outfield stands out between the ball and the infield, as far
    // out on that line as he can get before a throw in the outfielder's own clip arrives
    const ownThrow = CLIPS[id].events.some((x) => x.kind === 'release');
    const cutoffSpot = () => {
      const s = B.spotAt(e.start + 0.5), to = BAGS[2], d = flat(s, to), at = (f) => add(to, mul(sub(s, to), f));
      const want = Math.min(0.42, 70 / Math.max(d, 1));
      if (!ownThrow) return at(want);
      const rel = releaseOf(B, e), t0 = Math.max(react(n), R.free), me = R.spotAt(t0);
      let best = null;
      for (let f = want; f >= 0; f -= 0.02) {
        const q = at(f), late = t0 + timeFor('run_sprint', flat(me, q) * 1.08) / PLAYBACK[1] + 0.25 - (rel.t + throwTime(B.n, rel.at, q) - 0.3);
        if (!best || late < best.late) best = { q, late };
        if (late <= 0) break;
      }
      // nowhere on the line in time (he's getting up from a dive): he takes it where he is
      return best.late <= 0 ? best.q : me;
    };
    const target = bag ? [BAGS[bag][0], 0, BAGS[bag][2]] : cutoffSpot();
    // the receiver: on his bag facing the throw, or out where the cutoff stands
    const recvId = n === 3 || (bag === 1) ? (pl.th === 'dirt' && o.last ? 'field_scoop' : n === 1 ? 'catch_run' : 'field_stretch') : bag === 2 ? (n === 6 ? 'pivot_ss' : 'pivot_2b') : 'field_stretch';
    const ct = catchOf(R, recvId);
    // where he takes it, for a throw from `src`: the frame his clip starts from and the glove
    const receive = (src) => {
      if (recvId === 'catch_run') {
        // the pitcher covering takes it on the run, a stride short of the bag
        const yaw = faceTo(R.spotAt(Math.max(react(n), R.free)), target), ball = add(target, add(ahead(yaw, -2.5), [0, ct.at[1], 0]));
        return { frR: frameOn(R, recvId, ball, yaw), gl: ball };
      }
      if (recvId === 'pivot_ss' || recvId === 'pivot_2b') {
        // the pivot: across the bag as it comes, turned so his throw goes to first, but no more
        // than 60 degrees off facing the feed where the clip can't do both
        const r = rootAt(CLIPS[recvId], ct.t, { mirror: R.mirror });
        let yaw = faceTo(target, BAGS[1]) - throwHeading(recvId, R.mirror);
        const miss = wrap(faceTo(target, src) - (yaw + Math.atan2(ct.at[0], ct.at[2]) / DEG));
        if (Math.abs(miss) > 60) yaw += miss - Math.sign(miss) * 60;
        const q = turn([r.at[0], 0, r.at[1]], yaw), frR = { at: [target[0] - q[0], 0, target[2] - q[2]], yaw };
        return { frR, gl: toPark(frR, ct.at) };
      }
      const yaw = faceTo(target, src);
      let frR = { at: target.slice(), yaw };
      if (bag) {
        // his foot on the bag (the stretch keeps it at [-0.45, -0.45] in its frame); a wide throw
        // pulls him off it toward the plate
        const off = pl.th === 'wide' && o.last ? ahead(faceTo(target, HOME), 4.5) : [0, 0, 0], q = turn([-0.45, 0, -0.45], yaw);
        frR = { at: add([target[0] - q[0], 0, target[2] - q[2]], off), yaw };
      }
      return { frR, gl: toPark(frR, ct.at) };
    };
    // the soonest he can be there to take it: at a sprint from when he's free
    const readyAt = (frR) => {
      const t0 = Math.max(react(n), R.free), L = flat(R.spotAt(t0), frR.at);
      return L < 2.5 ? t0 : t0 + timeFor('run_sprint', L * 1.08) / PLAYBACK[1] + (CLIPS[recvId].moving ? 0 : 0.2);
    };
    // the throw: in the fielding clip (the barehand, the outfielder's, a pivot's) or after it, from
    // where he is, turned to it, and held until the man taking it can be there
    let te = e;
    if (!ownThrow) {
      const tEnd = e.start + CLIPS[id].duration, src = B.spotAt(tEnd - 0.2), short = flat(src, target) < 34;
      const tid = id === 'field_dive_left' || id === 'field_dive_right' ? 'throw_knees' : short ? 'throw_flip' : B.n >= 7 ? 'throw_crow' : 'throw_over';
      let t0 = tEnd - (tid === 'throw_knees' ? 0.1 : 0.15) + (o.late ? 0.35 : 0);
      const relT = CLIPS[tid].events.find((x) => x.kind === 'release').t, guess = receive(src);
      // a throw the batter beats (th: late) arrives just after he does
      const due = Math.max(readyAt(guess.frR) + ct.t + 0.05, o.last && pl.th === 'late' && bag === 1 ? tLegs + 0.15 : -Infinity);
      const wait = due - (t0 + relT + throwTime(B.n, src, guess.gl));
      if (wait > 0.05) { settle(B, t0); t0 += wait; }
      te = throwFrom(B, tid, t0, target);
    }
    const rel = releaseOf(B, te);
    B.free = rel.t + 0.3;
    const { frR, gl } = receive(rel.at);
    const tC = recvId === 'catch_run' ? Math.max(rel.t + throwTime(B.n, rel.at, gl), readyAt(frR) + ct.t) : rel.t + throwTime(B.n, rel.at, gl);
    const tRs = tC - ct.t;
    runTo(R, frR, Math.max(react(n), R.free), tRs, { min: 2.5, atLeast: CLIPS[recvId].moving ? 20 : 0, rest: !CLIPS[recvId].moving });
    const recv = R.play(recvId, tRs, { frame: frR, fade: FADE });
    // the ball: from the hand to the glove, or wild past him
    let error = null;
    if (o.last && (pl.e === 'past' || pl.e === 'stands')) {
      error = pl.e;
      const by = pl.e === 'stands' ? [0, 7, 0] : add(ahead(faceTo(rel.at, gl) + 90, 3.5), [0, -1.5, 0]);
      const wild = fitPath(rel.at, add(gl, by), rel.t, tC - rel.t, [0, -GRAVITY, 0], { bounce: pl.e !== 'stands' });
      fly(rel.t, pl.e === 'stands' ? (t) => (t > tC + 0.5 ? null : wild(t)) : wild);
      log.fielders.push({ n: R.n, slot: R.slot, clip: recvId, t: tC, at: gl.slice(), miss: true });
      land = Math.max(land, tC + 0.8);
    } else {
      fly(rel.t, throwPath(rel.at, gl, rel.t, tC - rel.t));
      caught(R, recv, gl, tC);
      land = Math.max(land, tC + 0.4);
    }
    if (recvId === 'catch_run') pullUp(R, tRs + 0.95, 21);
    else if (recvId === 'field_stretch' || recvId === 'field_scoop') R.free = tC + 0.3;
    throwChain.push({ from: B.n, to: n, bag, last: !!o.last, error, clip: recvId, throwClip: te.clip, release: rel, catch: { t: tC, at: gl } });
    if (bag === 1 && o.last) cuts.push({ at: Math.max(rel.t - 0.05, tBat + 0.8), shot: 'first' });
    return { R, recv };
  }

  // He throws clip `id` from where he is at t0 to `target`, turned so the throw goes at it.
  function throwFrom(B, id, t0, target) {
    const at = B.spotAt(t0), h = throwHeading(id, B.mirror);
    let yaw = faceTo(at, target) - h;
    for (let k = 0; k < 3; k++) { const r = releaseOf(B, { clip: id, start: t0, speed: 1, F: { at, yaw } }); yaw = faceTo(r.at, target) - h; }
    return B.play(id, t0, { frame: { at, yaw }, fade: 0.15 });
  }

  // A man who dove for it and missed: his dive put just short of the ball as it goes by.
  function diveMiss(n, onGround) {
    const M = fielder(n);
    if (!M) return;
    const s = M.spotAt(react(n));
    // when it passes nearest him
    let tN = tBat + 0.3, dN = Infinity;
    for (let t = tBat + 0.2; t < tBat + 3; t += 0.01) { const d = flat(path0(t), s); if (d < dN) { dN = d; tN = t; } }
    const q = path0(tN), side = turn(sub(q, s), -faceTo(s, HOME))[0];
    // a dive at a ball nearly at him is the dive to the side, in the air or on the ground
    const id = onGround || dN < 9 ? (side > 0 ? 'field_dive_left' : 'field_dive_right') : 'catch_dive';
    // the glove a foot and a half short of it, on his side of it
    const short = add(q, mul(sub(s, q), 1.5 / Math.max(1.5, flat(s, q))));
    const fr = id !== 'catch_dive' ? frameOn(M, id, short, faceTo(short, HOME)) : frameRunning(M, id, short, s);
    if (tN - react(n) < 0.35) return;
    // on the ground it hops past just under the glove
    if (id !== 'catch_dive' && path0(tN)[1] < 1) riseInto(tN, Math.max(0.6, catchOf(M, id).at[1] - 0.5));
    const e = runInto(M, id, fr, tN, react(n));
    // down on the grass: he takes a moment, and gets up into whatever's next slowly
    M.free = e.start + CLIPS[id].duration + 0.15; M.down = true;
    log.misses.push({ n, slot: M.slot, clip: e.clip, t: tN, at: short, ball: q });
  }

  // An outfielder runs a ball down where it rolls and throws it in: `path` from `after` on.
  function pickUp(B, path, after, then) {
    const n = B.n, t0 = Math.max(react(n), B.free), s = B.spotAt(t0), id = 'field_of_throw';
    // the first moment he can be at the clip's start for it, at a comfortable sprint
    let tP = after, fr = null;
    for (let t = Math.max(after, t0 + 0.7); t < after + 8; t += 0.02) {
      tP = t; fr = frameRunning(B, id, path(t), s);
      if (flat(fr.at, s) <= (t - fr.t - t0) * RUN_MAX - (B.down ? 14 : 2)) break;
    }
    const ball = path(tP)[1] < 0.5 ? riseInto(tP, catchOf(B, id).at[1]) : path(tP);
    runTo(B, fr, t0, tP - fr.t, { atLeast: 20, enter: 20.9, fade: B.down ? 0.5 : FADE });
    const e = B.play(id, tP - fr.t, { frame: fr, fade: FADE });
    caught(B, e, ball, tP);
    land = Math.max(land, tP + 0.5);
    if (then != null) throwOn(B, e, id, then, { last: true });
    return e;
  }

  // ── caught in the air ──
  function airOut() {
    const B = F0;
    if (!B) return;
    const inField = n0 <= 6;
    const start = B.spotAt(react(n0));
    let id = n0 === 2 ? 'catch_pop_c' : pl.g === 'diving' ? 'catch_dive' : pl.g === 'sliding' ? 'catch_slide' : pl.g === 'leaping' ? 'catch_wall'
      : pl.g === 'rail' ? 'catch_rail' : pl.g === 'ranging' && !inField ? 'catch_run' : 'catch_camp';
    // the catcher's own pop-up clip turns him round on his spot; one he has to go after he runs to
    if (id === 'catch_pop_c') {
      const cp = catchOf(B, id), gl = Math.hypot(cp.at[0], cp.at[2]), land0 = path0(path0.land);
      if (Math.abs(flat(land0, B.spotAt(tBat)) - gl) > 5) id = 'catch_camp';
    }
    const cp = catchOf(B, id);
    const tC = path0.when(cp.at[1]) ?? path0.land;
    const ball = path0(tC), back = path0(tC - 0.05);
    const RUNS = new Set(['catch_dive', 'catch_slide', 'catch_rail', 'catch_run', 'catch_wall']);
    let fr;
    if (id === 'catch_pop_c') {
      // turned on his spot so the glove comes round to it
      const spot = B.spotAt(tBat), want = faceTo(spot, ball), has = Math.atan2(cp.at[0], cp.at[2]) / DEG;
      fr = frameOn(B, id, ball, want - has);
    } else if (id === 'catch_wall') fr = frameOn(B, id, ball, faceTo(HOME, ball));
    else if (RUNS.has(id)) fr = frameRunning(B, id, ball, start);
    else fr = frameOn(B, id, ball, faceTo(ball, back));
    const tS = tC - fr.t;
    let e;
    if (RUNS.has(id) || id === 'catch_pop_c') e = runInto(B, id, fr, tC, react(n0));
    else { campUnder(B, fr, react(n0), tS); e = B.play(id, tS, { frame: fr, fade: FADE }); }
    const drop = pl.e === 'drop';
    caught(B, e, ball, tC, { miss: drop });
    if (id === 'catch_run') pullUp(B, tS + 1.0, 21);
    log.airCatch = tC;
    land = tC + 0.5;
    if (drop) {
      // it pops out of the glove and drops at his feet
      fly(tC + 1e-4, toRest(ball, add(ball, ahead(fr.yaw, 1.5)), tC, Math.sqrt(2 * Math.max(0.2, ball[1]) / GRAVITY) + 0.05));
      land = tC + 1.2;
      log.airCatch = null;
    }
    const hang = path0.land - tBat;
    if (n0 >= 7 && hang >= 3 && !drop) cuts.push({ at: tC - 1.5, shot: flyShot(ball) });
  }

  // He gets under a ball he has time for, runs in early and pulls up, and waits for it.
  function campUnder(B, fr, t0, tS) {
    t0 = Math.max(t0, B.free);
    const s = B.spotAt(t0), L = flat(s, fr.at);
    if (L < 3) return;
    const T = tS - t0;
    // as fast as a man settling under it goes, and pulled up the last stride or two
    const v = clamp(L / Math.max(0.5, T - STOP.duration * 0.7), 12, 27);
    const c = cycleFor(v), speed = clamp(v / c.v, PLAYBACK[0], PLAYBACK[1]);
    if (L <= STOP_LEN + 4 || T < STOP.duration + 0.6) { runTo(B, fr, t0, tS, { rest: true }); return; }
    const dir = faceTo(s, fr.at), pre = { at: sub(fr.at, ahead(dir, STOP_LEN)), yaw: dir };
    const tStop = Math.min(tS - STOP.duration * 0.8, t0 + timeFor(c.id, L - STOP_LEN) / speed + 0.05);
    const r = runTo(B, pre, t0, tStop);
    if (r) pullUp(B, tStop, c.v * speed);
  }

  // The camera from behind the man under a long fly, as it comes down.
  function flyShot(ball) {
    const out = faceTo(HOME, ball), eye = add([ball[0], 0, ball[2]], add(ahead(out, 85), [0, 26, 0]));
    return { shot: 'fly', eye, at: [ball[0], 5, ball[2]], fov: 30, follow: 0.45 };
  }

  // ── a ball in the air that falls in ──
  function airHit() {
    const B = F0;
    if (!B) return;
    if (pl.mi) diveMiss(pl.mi, false);
    // off the wall on the fly it comes back off it; otherwise it rolls on from where it lands
    let path = path0;
    if (pl.x === 'wall') {
      const tW = path0.land, w = path0(tW), back = add(w, ahead(faceTo(w, HOME), 26 + 16 * rand('carom')));
      const carom = fitPath(w, [back[0], BALL_R, back[2]], tW, 0.9, [0, -GRAVITY, 0]);
      fly(tW + 1e-4, carom);
      path = (t) => (t <= tW ? path0(t) : carom(t));
    }
    pickUp(B, path, path0.land + (pl.x === 'wall' ? 0.5 : 0.25), pl.f[1] ?? null);
    if (pl.e === 'stands' || pl.e === 'past') land += 0.5;
  }

  // ── over the fence ──
  function homeRun() {
    const B = F0;
    land = path0.land + 0.4;
    if (!B) return;
    const start = B.spotAt(react(n0)), wallAt = onLine(pl.dir, fence - 3);
    if (pl.hr === 'leap') {
      // he jumps at the wall and it goes just over his glove
      const cp = catchOf(B, 'catch_wall'), tW = path0.when(cp.at[1] + 1.2) ?? path0.land - 0.2;
      const near = path0(tW), at = [wallAt[0], near[1] - 1.2, wallAt[2]];
      const fr = frameOn(B, 'catch_wall', at, faceTo(HOME, at));
      const e = runInto(B, 'catch_wall', fr, tW, react(n0));
      log.misses.push({ n: n0, slot: B.slot, clip: e.clip, t: tW, at, ball: near });
      return;
    }
    // back toward the track, as far as he gets before it's gone, and he watches it go
    const r = rootAt(CLIPS.watch_hr, CLIPS.watch_hr.duration), yaw = faceTo(start, wallAt);
    const tW = clamp(path0.land - 1.6, react(n0) + 0.4, path0.land - 0.5);
    const far = Math.min(flat(start, wallAt), r.at[1] + RUN_MAX * Math.max(0, tW - react(n0) - 0.1));
    const stop = add(start, ahead(yaw, far)), fr = { at: sub(stop, turn([r.at[0], 0, r.at[1]], yaw)), yaw };
    if (flat(fr.at, start) > 3) runTo(B, fr, react(n0), tW, { atLeast: 14 });
    B.play('watch_hr', tW, { frame: fr, fade: FADE });
    log.fielders.push({ n: n0, slot: B.slot, clip: 'watch_hr', t: tW, at: fr.at, miss: true });
  }
}

// The fielding clip on the ground by the grade, and which side of him it goes (+ his left).
function groundClip(g, side) {
  if (g === 'barehand') return 'field_barehand';
  if (g === 'diving') return side > 0 ? 'field_dive_left' : 'field_dive_right';
  if (g === 'ranging') return side > 0 ? 'field_gb_forehand' : 'field_gb_backhand';
  return 'field_gb';
}

// Where the play's camera looks at time t: the ball's way, smoothed over the last third of a
// second, so the camera leads into a throw rather than snapping to it; a ball in a hand is where
// it was caught.
export function trackOf(balls) {
  const at = (t) => {
    let s = balls[0];
    for (const b of balls) { if (b.from > t) break; s = b; }
    if (!s) return null;
    return s.path ? s.path(Math.max(t, s.from)) : s.at;
  };
  return (t) => {
    let x = 0, y = 0, z = 0, n = 0;
    for (let k = 0; k < 8; k++) { const q = at(t - k * 0.045); if (q) { x += q[0]; y += q[1]; z += q[2]; n++; } }
    return n ? [x / n, y / n, z / n] : null;
  };
}
