// DEADBALL · THE BASES. The men on them and the batter, on a ball in play, ball four and a hit
// batsman; and each side's way to and from its dugout at the changeover.
//
// The payload's `moves` say where every man ends up (plugins/broadcast/sports/baseball-gameday.js
// runnerMoves, or sim v2's own): each runner on a bag before the pitch and then the batter, lead
// runner first, as `{ from, to }` (bag 4 is home), `{ from, out }` (forced out at that bag) or
// `{ from, off }` (the inning was over before he got anywhere). Here each one runs it at his own
// legs' pace (play.js legsOf, which is the sim's speedOf), and the play waits on him: a throw to a
// bag a man is safe at gets there after him, a man forced out gets there after the ball, and the
// play lands when every man is on his bag and every run is in.
//
// ROUND THE BAGS. A man going on past a bag bows out before it and crosses it half turned: his way
// is a turn of radius 22 ft through each bag he passes (`basePath`). A run cycle can't bend, so it's
// carried along the turn a few degrees at a time, each stretch the same stride in a new frame,
// crossing the last half way through a short mix (`runAlong`, as bodies.js runTo turns a corner).
// He comes up to speed over his first strides, the cycle changing from the run to the sprint at
// the same point in the stride (the three cycles plant their feet at the same share of a stride),
// so his legs never cross in a mix.
//
// A man who holds stays in his lead (run_lead) on a ball on the ground, and goes back to his bag
// on one in the air, as he'd tag up. A man going home goes on over the plate and pulls up. The
// batter runs through first on a play there, rounds it and comes back on a single to the
// outfield, slides into second or third where the play says he slid (`sl`), and trots round on a
// home run.
//
// BALL FOUR OR A HIT BATSMAN (`planTrot`): the batter trots to first and every man forced trots up
// a bag, after the play's landed; a man not forced walks back to his bag.
//
// THE CHANGEOVER. Each side's dugout is a row of spots in foul ground up the line (`dugoutSpot`).
// The side taking the field runs out from it to its places (`planTakeField`), and on the third out
// every man goes off to his own (`jogToDugout`, which the director plans from the world once the
// play's landed).
//
// Pure: no DOM and no GL.

import { CLIPS } from './clips.js';
import { rootAt, sampleClip } from './anim.js';
import { solvePose } from './rig.js';
import { BAGS, DEG, RUBBER, MOUND } from './geo.js';
import { legsOf, topSpeed } from './play.js';
import {
  clamp, add, sub, mul, flat, faceTo, turn, ahead, wrap, HOME, hashStr, CYCLES, cycleFor, PLAYBACK, FADE, timeFor, STOP, STOP_LEN,
  makeBody, runTo, pullUp, settle,
} from './bodies.js';

export const bagAt = (n) => (n === 0 || n === 4 ? HOME : BAGS[n]);
const unit = (v) => { const l = Math.hypot(v[0], v[2]) || 1; return [v[0] / l, 0, v[2] / l]; };
const CYCLE_IDS = new Set(CYCLES.map((c) => c.id));
export const routeOf = (from, to) => { const r = []; for (let b = from + 1; b <= to; b++) r.push(b); return r; };
// A home run's trot, feet a second.
const TROT = 15.5;
// Over the plate and on: bent off the line to his left, so he goes by the catcher squatting
// behind the plate instead of through him.
const OVER_THE_PLATE = Object.freeze({ past: 16, pastTurn: 40 });
// Where the catcher squats and the plate umpire stands (cast.js), for a man jogging off to go round.
const BEHIND_THE_PLATE = [[0, 0, -2.75], [1.2, 0, -5.4]];
const toSegment = (q, a, b) => { const ab = sub(b, a), L = ab[0] * ab[0] + ab[2] * ab[2], f = L ? clamp(((q[0] - a[0]) * ab[0] + (q[2] - a[2]) * ab[2]) / L, 0, 1) : 0; return flat(q, add(a, mul(ab, f))); };
// A way across the infield kept off the mound: where a leg of it passes within a stride of the
// mound's edge, a point out beside the mound on that leg's side. The slope under a running foot
// bends the ankle past what it can do.
const MOUND_CLEAR = 10.5;
function roundMound(pts) {
  const M = [MOUND[0], 0, MOUND[1]], out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = out[out.length - 1], b = pts[i];
    if (toSegment(M, a, b) < MOUND_CLEAR && flat(b, M) > MOUND_CLEAR && flat(a, M) > MOUND_CLEAR) {
      const ab = sub(b, a), L = ab[0] * ab[0] + ab[2] * ab[2], f = L ? clamp(((M[0] - a[0]) * ab[0] + (M[2] - a[2]) * ab[2]) / L, 0, 1) : 0;
      let d = sub(add(a, mul(ab, f)), M);
      if (Math.hypot(d[0], d[2]) < 0.5) d = [-ab[2], 0, ab[0]];
      out.push(add(M, mul(unit(d), MOUND_CLEAR + 1.5)));
    }
    out.push(b);
  }
  return out;
}
// The clip time pulling up (run_stop) has him within half a foot of where it stops him.
const STOP_ON = (() => { for (let t = 0; t <= STOP.duration; t += 0.01) if (rootAt(STOP, t).at[1] >= STOP_LEN - 0.5) return t; return STOP.duration; })();
const stopSpeed = (v) => clamp(v / 21, 0.5, 1.3);

// ── the way round ──────────────────────────────────────────────────────────────
// The way from `from` round the bags in `bags` (each bag he passes, then the one he's going to):
// straight down each line, and at each bag he passes, a turn of radius `o.r` through the bag, its
// centre on the inside of the turn square to the way he crosses it, so he bows out before the bag
// and comes back to the line after it. A point every `o.step` degrees of the turn. `o.past` runs
// him on past the last bag (over the plate), bent `o.pastTurn` degrees to his left. Returns { pts,
// s (the distance along the way at each point), len, bags ({ [bag]: distance along at the bag }),
// at(d) }.
export function basePath(from, bags, o = {}) {
  const r = o.r ?? 22, step = o.step ?? 22.5;
  const pts = [[from[0], 0, from[2]]], at = {};
  let prev = pts[0];
  for (let i = 0; i < bags.length - 1; i++) {
    const B = bagAt(bags[i]), next = bagAt(bags[i + 1]);
    const u = unit(sub(B, prev)), w = unit(sub(next, B));
    // the change of heading, + to his left (round the bags he turns left)
    const by = Math.atan2(u[2] * w[0] - u[0] * w[2], u[0] * w[0] + u[2] * w[2]);
    const m = unit(add(u, w)), inside = by >= 0 ? [m[2], 0, -m[0]] : [-m[2], 0, m[0]];
    const C = add(B, mul(inside, r)), aB = Math.atan2(B[0] - C[0], B[2] - C[2]);
    const n = 2 * Math.max(1, Math.ceil(Math.abs(by) / DEG / step / 2));
    for (let k = 0; k <= n; k++) {
      const a = aB - by / 2 + (by * k) / n;
      pts.push([C[0] + r * Math.sin(a), 0, C[2] + r * Math.cos(a)]);
      if (2 * k === n) at[bags[i]] = pts.length - 1;
    }
    prev = B;
  }
  const end = bagAt(bags[bags.length - 1]);
  pts.push([end[0], 0, end[2]]);
  at[bags[bags.length - 1]] = pts.length - 1;
  if (o.past) pts.push(add(end, mul(turn(unit(sub(end, pts[pts.length - 2])), o.pastTurn || 0), o.past)));
  return wayPath(pts, at);
}
// A way through points (straight between them), for runAlong: { pts, s, len, bags, at(d) }, `marks`
// naming points by bag.
export function wayPath(pts, marks = {}) {
  const s = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + flat(pts[i], pts[i - 1]));
  const seg = (d) => { let i = 1; while (i < pts.length - 1 && s[i] < d) i++; return i; };
  return {
    pts, s, len: s[s.length - 1], bags: Object.fromEntries(Object.entries(marks).map(([b, i]) => [b, s[i]])),
    at: (d) => { const i = seg(d), f = clamp((d - s[i - 1]) / Math.max(1e-9, s[i] - s[i - 1]), 0, 1); return add(pts[i - 1], mul(sub(pts[i], pts[i - 1]), f)); },
  };
}

// How long he takes to cover `d` feet setting off at v0 and coming up (or down) to v at `a` (feet
// a second, and a second squared), and how far he's gone in time t.
function profile(v0, v, a) {
  const k = v >= v0 ? a : -a, tUp = Math.abs(v - v0) / a, sUp = (v * v - v0 * v0) / (2 * k);
  return {
    time: (d) => (d > sUp ? tUp + (d - sUp) / v : k > 0 ? (Math.sqrt(v0 * v0 + 2 * k * d) - v0) / k : (v0 - Math.sqrt(Math.max(0, v0 * v0 + 2 * k * d))) / a),
    dist: (t) => (t <= tUp ? v0 * t + (k * t * t) / 2 : sUp + (t - tUp) * v),
    tUp,
  };
}

// ── running it ─────────────────────────────────────────────────────────────────
// He runs `path` from `o.s0` (0) to `s1`, setting off at t0 and coming up to `o.v` at `o.a`. From
// a standing start (`o.v0` not given) the run's frame starts half a mix's travel behind him, as
// bodies.js runTo has it; out of a clip that isn't a cycle he starts at `o.v0` from where it has
// him; already in a cycle he carries on at the same point in his stride. Each stretch is one
// cycle at one speed in one frame, between the corners of the way and every 0.4 s while he comes
// up to speed; the next crosses it half way through a short mix. Returns { tEnd, vEnd, timeAt(d) }
// (when he passes distance d along the way).
const STRETCH_MIX = 0.15;
export function runAlong(B, path, t0, s1, o = {}) {
  const s0 = o.s0 ?? 0, standing = o.v0 == null, v0 = standing ? 9 : o.v0, P = profile(v0, o.v ?? v0, o.a ?? (o.v < v0 ? 6 : 11));
  const cuts = new Set([s0, s1]);
  for (const d of path.s) if (d > s0 + 0.5 && d < s1 - 0.5) cuts.add(d);
  for (let t = 0.4; t < P.tUp; t += 0.4) { const d = s0 + P.dist(t); if (d < s1 - 0.5) cuts.add(d); }
  // no stretch under a fifth of a second, so two mixes never overlap: a short one is taken in
  // with the next, cutting the corner between them by a little
  const list = [...cuts].sort((x, y) => x - y), minLen = Math.max(4, (o.v ?? v0) * 0.2);
  for (let i = 1; i < list.length - 1;) { if (list[i] - list[i - 1] < minLen || list[list.length - 1] - list[i] < minLen * 0.5) list.splice(i, 1); else i++; }
  const marks = [];
  let t = t0, prev = null, vEnd = v0;
  const was = B.clips[B.clips.length - 1];
  if (!standing && was && CYCLE_IDS.has(was.clip)) prev = { start: was.start, speed: was.speed, dur: CLIPS[was.clip].duration };
  for (let i = 0; i + 1 < list.length; i++) {
    const da = list[i], db = list[i + 1], pa = path.at(da), pb = path.at(db), L = flat(pa, pb), h = faceTo(pa, pb);
    const want = (db - da) / Math.max(1e-3, P.time(db - s0) - P.time(da - s0));
    const c = cycleFor(want), p = clamp(want / c.v, PLAYBACK[0], PLAYBACK[1]), u = c.v * p, dur = CLIPS[c.id].duration;
    if (!prev) {
      const lead = standing ? (u * (o.fade ?? FADE)) / 2 : 0, at = sub(pa, ahead(h, lead));
      B.play(c.id, t, { frame: { at: [at[0], 0, at[2]], yaw: h }, speed: p, fade: o.fade ?? FADE });
      prev = { start: t, speed: p, dur };
      marks.push([da, t + lead / u]);
      t += (L + lead) / u;
    } else {
      // the same point in the stride, the new way and pace, the two crossing half way through the mix
      const tm = t, ph = (((((tm - prev.start) * prev.speed) / prev.dur) % 1) + 1) % 1, st = tm - ((ph + 1) * dur) / p;
      const here = B.frameAt(tm).at, r = rootAt(CLIPS[c.id], (tm - st) * p), at = sub(here, turn([r.at[0], 0, r.at[1]], h));
      B.play(c.id, st, { frame: { at: [at[0], 0, at[2]], yaw: h }, speed: p, fade: STRETCH_MIX, from: tm - STRETCH_MIX / 2 });
      prev = { start: st, speed: p, dur };
      marks.push([da, tm]);
      t = tm + L / u;
    }
    vEnd = u;
  }
  marks.push([s1, t]);
  const timeAt = (d) => {
    for (let i = 1; i < marks.length; i++) {
      if (d <= marks[i][0] + 1e-9) { const [a0, ta] = marks[i - 1], [a1, tb] = marks[i]; return ta + ((tb - ta) * (d - a0)) / Math.max(1e-9, a1 - a0); }
    }
    return t;
  };
  return { tEnd: t, vEnd, timeAt };
}

// ── slides ─────────────────────────────────────────────────────────────────────
// Where each slide touches the bag, in the frame it starts in: the lead foot's toe, or for the
// head-first slide the hands. `z` is how far along, `x` how far to his left, `t` the clip time it
// gets within a tenth of a foot of where it stops, and `v` the speed the slide comes in at.
const SLIDE_TOUCH = { slide_feet: ['toeL'], slide_head: ['wrL', 'wrR'], slide_hook: ['toeL'] };
const SLIDES = new Map();
export function slideOf(id) {
  if (SLIDES.has(id)) return SLIDES.get(id);
  const clip = CLIPS[id], joints = SLIDE_TOUCH[id];
  const point = (t) => {
    const r = rootAt(clip, t), J = solvePose({ ...sampleClip(clip, t), at: [r.at[0], 0, r.at[1]], yaw: r.yaw || 0 }).J;
    const q = joints.map((k) => J[k]);
    return [q.reduce((s, x) => s + x[0], 0) / q.length, 0, q.reduce((s, x) => s + x[2], 0) / q.length];
  };
  const end = point(clip.duration);
  let tT = clip.duration;
  for (let t = 0; t <= clip.duration; t += 1 / 60) if (flat(point(t), end) < 0.1) { tT = t; break; }
  const r0 = rootAt(clip, 0), r1 = rootAt(clip, 0.1);
  const out = { x: end[0], z: end[2], t: tT, v: Math.hypot(r1.at[0] - r0.at[0], r1.at[1] - r0.at[1]) / 0.1 };
  SLIDES.set(id, out);
  return out;
}
// He runs on along `path` and slides in, the touch on the bag at distance `sBag`: returns when.
export function slideIn(B, path, t0, sBag, id, o) {
  const touch = slideOf(id), run = runAlong(B, path, t0, Math.max((o.s0 ?? 0) + 4, sBag - touch.z), o);
  const sp = clamp(run.vEnd / touch.v, 0.8, 1.25);
  B.play(id, run.tEnd, { speed: sp, fade: STRETCH_MIX });
  return { run, touch: run.tEnd + touch.t / sp };
}
// Up off the ground where his slide left him, once it's done and not before `t`: off the chest
// after a head first slide or a dive back, off the hip after a feet first or a hook slide. Each
// get-up is keyed from its slide's last pose (anim-smoke holds them to it); the dive and the hook
// end near enough to theirs for the mix.
const GET_UP = { slide_head: 'slide_up_head', run_dive_back: 'slide_up_head', slide_feet: 'slide_up_feet', slide_hook: 'slide_up_feet' };
export function getUpAfter(B, slide, t) {
  const e = B.clips[B.clips.length - 1], end = e.start + CLIPS[e.clip].duration / e.speed;
  return B.play(GET_UP[slide] || 'slide_up_feet', Math.max(end, t), { fade: 0.25 });
}
// He runs on along `path` and pulls up, coming to rest at distance `sStop`: returns when he's
// there.
export function stopAt(B, path, t0, sStop, o) {
  const run = runAlong(B, path, t0, Math.max((o.s0 ?? 0) + 4, sStop - STOP_LEN), o);
  pullUp(B, run.tEnd, run.vEnd);
  return { run, on: run.tEnd + STOP_ON / stopSpeed(run.vEnd) };
}

// ── the men ────────────────────────────────────────────────────────────────────
// `ctx` is planPlay's; `o` is { tBat, kind, isOut, isHR, outs (before the play), seed, tLegs (when
// the batter's legs get him to first, play.js toFirst) }. Puts the men on base in their leads from
// the cut in and the batter out of the box, then returns { bodies, batter, log, safeAt(bag), lay }:
// `safeAt` is when the first man safe at a bag gets there (none for a man tagging up, who waits on
// the catch), for a throw there to wait for him. `lay(F)` plans the rest once the fielding is
// known: F is { chain (plays.js throwChain), airCatch, dropAt, settled (when the ball's last in a
// glove), firstOff (when the first baseman's off the bag after an out there), forceAt(bag),
// slideAt(bag) (a slide for a runner at a bag a throw is coming to) }. It
// returns { land, calls (base umpires' calls: { ump, out, t }) }.
export function planBases(ctx, o) {
  const p = ctx.p, pl = p.play || {}, tBat = o.tBat;
  const rand = (k) => (hashStr(o.seed + ':bases:' + k) % 10007) / 10007;
  const air = !!pl.t && pl.t !== 'gb', twoOut = (o.outs | 0) >= 2;
  const dug = dugoutOf(p);
  // when the batter's through first and stopped, for a man holding there to go back to it
  let clearOfFirst = -Infinity;
  const offHome = (B, t, k) => jogOff(B, t, k, dug);
  const bodies = [], log = { runners: [], batter: null };
  const moves = Array.isArray(p.moves) ? p.moves : [];

  // the men on base, in their leads from the cut in
  const men = menOn(ctx, moves, Number.isFinite(ctx.tIn) ? ctx.tIn : tBat - 1, rand).map((x) => ({ ...x, v: o.isHR ? TROT : x.v }));
  for (const x of men) bodies.push(x.B);
  // when a man sets off: on contact on the ground or with two out, a beat later on a liner or a
  // fly, and on a home run once it's gone; one tagging up goes from his bag on the catch
  const goOf = (man) => tBat + (o.isHR ? 1.1 : !air || twoOut ? 0.18 + 0.12 * rand('go' + man.m.from) : pl.t === 'ld' ? 0.45 : 0.7);
  const tagging = air && o.isOut && !o.isHR;

  // the batter, out of the box: where the run out leaves him is where the rest of his way starts
  const bm = moves.find((m) => m && m.from === 0) || { from: 0, out: o.isOut ? 1 : 0 };
  const H = ctx.batter ? makeBody({ ...ctx.batter, n: 0, role: 'batter' }) : null;
  const outId = p.bats === 'L' ? 'bat_run_out_lefty' : 'bat_run_out', tOut = tBat + 0.15;
  let tCyc = tOut, here = null;
  if (H) {
    H.play(outId, tOut, { fade: 0.1 });
    tCyc = tOut + CLIPS[outId].duration - 0.12;
    here = H.frameAt(tCyc);
  }
  const hTo = bm.to ?? 0, infield = pl.t === 'gb' && (pl.f?.[0] ?? 9) <= 6 && pl.e !== 'legs';
  // he rounds first on a hit to the outfield or more, and goes on to the bag the play gives him
  const rounds = !!H && !o.isOut && hTo >= 1 && (hTo > 1 || !infield);
  const hRoute = hTo >= 4 ? [1, 2, 3, 4] : hTo === 1 ? [1, 2] : routeOf(0, hTo);
  const hPath = rounds ? basePath(here.at, hRoute, hTo >= 4 ? OVER_THE_PLATE : {}) : null;
  const hSlide = rounds && hTo >= 2 && hTo <= 3 && pl.sl ? (['slide_feet', 'slide_feet', 'slide_head', 'slide_hook'][hashStr(o.seed + ':slide') % 4]) : null;
  // out of the box at the run out's pace, so a trot eases down from it
  const RUN_OUT_V = 24;
  const hNeed = rounds ? (o.isHR ? TROT : hPath.bags[1] / Math.max(0.6, o.tLegs - tCyc)) : 0;
  const hTop = o.isHR ? TROT : Math.max(hNeed, topSpeed(Number.isFinite(pl.sp) ? pl.sp : 0.5));

  // when the first man safe at each bag gets there, as the profile has it, a throw there to wait on
  const safe = {};
  const note = (bag, t) => { safe[bag] = Math.min(safe[bag] ?? Infinity, t); };
  if (!o.isHR) {
    for (const man of men) {
      const to = man.m.to;
      if (to == null || to <= man.m.from || tagging) continue;
      const path = basePath(man.B.base.at, routeOf(man.m.from, to));
      note(to, goOf(man) + profile(9, man.v, 11).time(path.bags[to]));
    }
    if (rounds && hTo >= 2 && hTo <= 3) {
      const d = hPath.bags[hTo] - hPath.bags[1], extra = hSlide ? slideOf(hSlide).t - slideOf(hSlide).z / hTop : 0;
      note(hTo, tCyc + hPath.bags[1] / hNeed + profile(hNeed, hTop, 11).time(d) + extra);
    }
  }

  return {
    bodies: H ? [H, ...bodies] : bodies, batter: H, log,
    safeAt: (bag) => (safe[bag] != null && Number.isFinite(safe[bag]) ? safe[bag] : null),
    lay(F) {
      let land = -Infinity;
      const calls = [], home = [];
      // the batter first: a man holding first waits until he's been through the bag
      if (H) {
        const b = batter(F, calls, home);
        log.batter = b;
        if (b.done != null) land = Math.max(land, b.done);
      }
      for (const man of men) {
        const rec = runner(man, F, calls, home);
        log.runners.push(rec);
        if (!o.isHR && rec.done != null) land = Math.max(land, rec.done);
      }
      // everyone who scored off toward the dugout, the first man in furthest along
      home.sort((a, b) => a.t - b.t).forEach((x, k) => offHome(x.B, x.on, k));
      return { land, calls };
    },
  };

  // One man on base, by his move.
  function runner(man, F, calls, home) {
    const { m, B } = man, to = m.to ?? m.out;
    const rec = { slot: B.slot, id: B.id, from: m.from, to: m.to ?? null, out: m.out ?? null, off: !!m.off, bags: {}, done: null };
    // holding: in his lead on the ground, back to his bag on a ball in the air
    if (m.off || to == null || to <= m.from) {
      if (air && !o.isHR) standOn(B, m.from, tBat + 0.3);
      else if (!o.isHR) standOn(B, m.from, Math.max(tBat + 1, F.settled ?? tBat + 2.5, m.from === 1 ? Math.max(clearOfFirst, (F.firstOff ?? -Infinity)) : -Infinity));
      rec.end = m.from;
      return rec;
    }
    // tagging up: back to the bag, and away on the catch; on a fly he drops, away when it's down
    let t0 = goOf(man), from = null;
    if (tagging) {
      from = standOn(B, m.from, tBat + 0.3);
      t0 = Math.max(from.t, (F.airCatch ?? tBat + 3) + 0.08);
      from = from.at;
    } else if (pl.e === 'drop' && F.dropAt != null) t0 = Math.max(t0, F.dropAt + 0.15);
    const start = from ?? B.spotAt(t0), route = routeOf(m.from, to);
    // forced out: he gets there after the ball and slides in; one beaten by a lot pulls up short
    if (m.out != null) {
      const tForce = F.forceAt ? F.forceAt(m.out) : null, path = basePath(start, route), touch = slideOf('slide_feet');
      let v = man.v;
      const reach = () => profile(9, v, 11).time(Math.max(4, path.len - touch.z)) + touch.t;
      if (tForce != null) while (v > 15 && t0 + reach() < tForce + 0.12) v -= 0.5;
      if (tForce != null && t0 + reach() - tForce > 0.9) {
        const r = stopAt(B, path, t0, Math.max(20, path.len - 12), { v });
        rec.bags[m.out] = null; rec.stop = r.on;
      } else {
        const r = slideIn(B, path, t0, path.len, 'slide_feet', { v });
        rec.bags[m.out] = r.touch;
        getUpAfter(B, 'slide_feet', (tForce ?? r.touch) + 0.6);
      }
      rec.forced = tForce;
      const ump = { 2: 'ump:2B', 3: 'ump:3B' }[m.out];
      if (ump && tForce != null) calls.push({ ump, out: true, t: tForce + 0.2 });
      rec.end = null;
      return rec;
    }
    // safe: round to his bag and pull up on it, slide in where a throw's coming, or over the plate
    const toHome = to === 4, path = basePath(start, route, toHome ? OVER_THE_PLATE : {}), sBag = path.bags[to];
    const slide = F.slideAt ? F.slideAt(to) : null;
    let r;
    if (slide) {
      r = slideIn(B, path, t0, sBag, slide, { v: man.v });
      rec.bags[to] = r.touch;
      getUpAfter(B, slide, r.touch + 0.6);
    } else {
      r = stopAt(B, path, t0, toHome ? path.len : sBag, { v: man.v });
      rec.bags[to] = toHome ? r.run.timeAt(sBag) : r.on;
      if (toHome) home.push({ B, t: rec.bags[to], on: r.on });
    }
    for (const b of route) if (b !== to) rec.bags[b] = r.run.timeAt(path.bags[b]);
    rec.end = toHome ? null : to;
    rec.done = rec.bags[to] + 0.3;
    return rec;
  }

  // The batter: through first on a play there, round it and back on a single to the outfield, on
  // to his bag on more, round them all on a home run.
  function batter(F, calls, home) {
    const rec = { slot: H.slot, out: outId, legs: o.tLegs, to: hTo, bags: {}, done: null };
    if (!rounds) {
      // He gets there at his own pace, but never ahead of the ball on an out at first, or behind it
      // on a throw the server says he beat, where his legs can make it.
      const atFirst = (F.chain || []).find((x) => x.bag === 1 && x.last);
      const toBag = flat(here.at, BAGS[1]);
      let tFirst = o.tLegs;
      if (atFirst && !atFirst.error && o.isOut) tFirst = Math.max(tFirst, atFirst.catch.t + 0.15);
      if (atFirst && !atFirst.error && !o.isOut && pl.th === 'late') tFirst = Math.max(tCyc + toBag / (CYCLES[2].v * PLAYBACK[1]), Math.min(tFirst, atFirst.catch.t - 0.12));
      let need = toBag / Math.max(0.6, tFirst - tCyc);
      // a ball in the air he runs out at a trot if it's routine, and he's not to get within ten
      // feet of a man holding first before it's caught
      if (F.airCatch != null) {
        if (pl.g === 'routine' || !pl.g) need = Math.min(need, 14);
        const holder = men.some((x) => x.m.from === 1);
        if (holder) need = Math.min(need, Math.max(10, (toBag - 12 - STOP_LEN) / Math.max(0.3, F.airCatch + 0.2 - tCyc)));
      }
      const cyc = cycleFor(need), cSpeed = clamp(need / cyc.v, PLAYBACK[0], PLAYBACK[1]);
      // the cycle carried on from where the run out has him (turned to first by the end of it)
      H.play(cyc.id, tCyc, { frame: { at: here.at, yaw: faceTo(here.at, BAGS[1]) }, speed: cSpeed, fade: 0.12 });
      const tReach = tCyc + timeFor(cyc.id, toBag) / cSpeed;
      Object.assign(rec, { cycle: cyc.id, speed: cSpeed, tFirst: tReach });
      if (F.airCatch == null || F.airCatch + 0.2 >= tReach) rec.bags[1] = tReach;
      // a hit isn't over until he's on the bag; he pulls up through it, or when the ball's caught
      if (!o.isOut) rec.done = tReach + 0.3;
      const tStop = F.airCatch != null ? clamp(F.airCatch + 0.2, tCyc + 0.3, tReach) : tReach + 0.05;
      pullUp(H, Math.max(tCyc + 0.2, tStop), cyc.v * cSpeed);
      rec.stop = tStop;
      const still = Math.max(tCyc + 0.2, tStop) + STOP_ON / stopSpeed(cyc.v * cSpeed);
      if (rec.bags[1] != null) clearOfFirst = still;
      // safe, he walks back to the bag
      if (!o.isOut) standOn(H, 1, still + 0.3);
      return rec;
    }
    // to first at the pace his legs get him there, then on at his best
    const s1 = hPath.bags[1];
    const first = runAlong(H, hPath, tCyc, s1, { v0: o.isHR ? RUN_OUT_V : hNeed, v: hNeed, fade: 0.12 });
    rec.tFirst = rec.bags[1] = first.tEnd;
    const on = { s0: s1, v0: first.vEnd, v: hTop };
    if (hTo === 1) {
      // a few strides round toward second, pulled up, and back to the bag
      const r = stopAt(H, hPath, first.tEnd, s1 + 12 + STOP_LEN, { ...on, v: first.vEnd });
      standOn(H, 1, r.on + 0.25);
      rec.done = first.tEnd + 0.3;
    } else if (hTo === 4) {
      const r = stopAt(H, hPath, first.tEnd, hPath.len, on);
      for (const b of [2, 3, 4]) rec.bags[b] = r.run.timeAt(hPath.bags[b]);
      rec.done = o.isHR ? null : rec.bags[4] + 0.3;
      home.push({ B: H, t: rec.bags[4], on: r.on });
    } else if (hSlide) {
      const r = slideIn(H, hPath, first.tEnd, hPath.bags[hTo], hSlide, on);
      for (const b of hRoute) if (b > 1 && b < hTo) rec.bags[b] = r.run.timeAt(hPath.bags[b]);
      rec.bags[hTo] = r.touch; rec.slide = hSlide;
      rec.done = r.touch + 0.3;
      getUpAfter(H, hSlide, r.touch + 0.6);
    } else {
      const r = stopAt(H, hPath, first.tEnd, hPath.bags[hTo], on);
      for (const b of hRoute) if (b > 1 && b < hTo) rec.bags[b] = r.run.timeAt(hPath.bags[b]);
      rec.bags[hTo] = r.on;
      rec.done = r.on + 0.3;
    }
    // a throw to his bag that he only just beats gets the base umpire's call
    const th = (F.chain || []).find((x) => x.bag === hTo && x.last && !x.error);
    const ump = { 2: 'ump:2B', 3: 'ump:3B' }[hTo];
    if (th && ump && rec.bags[hTo] != null && th.catch.t - rec.bags[hTo] < 0.8) calls.push({ ump, out: false, t: Math.max(th.catch.t, rec.bags[hTo]) + 0.2 });
    return rec;
  }
}

// ── the shared pieces ──────────────────────────────────────────────────────────
// The batting side's dugout, +1 on the third-base side (the visitors', as cast.js has it) and -1
// on the first-base side.
export const dugoutOf = (p) => (p.half === 'top' ? 1 : -1);
// The men on base for `moves`, in their leads from the cut in (tIn): [{ m, B, v }], `v` his top speed.
function menOn(ctx, moves, tIn, rand) {
  const men = [];
  for (const m of moves) {
    if (!m || !(m.from >= 1 && m.from <= 3)) continue;
    const c = runnerAt(ctx.cast, m.from);
    if (!c) continue;
    const B = makeBody({ n: 10 + m.from, id: c.id, slot: c.look.slot, role: 'runner', at: c.at, yaw: c.yaw, mirror: c.mirror, scale: c.scale, place: true });
    B.play('run_lead', tIn - rand('lap' + m.from) * CLIPS.run_lead.duration, { frame: B.base, issue: tIn });
    men.push({ m, B, v: topSpeed(legsOf(c.id)) });
  }
  return men;
}
// He's scored: from where he's pulled up past the plate he jogs off toward his dugout (`dug`, the
// side), the k-th man in a stride short of the last, so nobody who scores after him runs through
// him; his way goes round behind the umpire where it would pass the catcher or the umpire.
export function jogOff(B, t, k, dug) {
  const spot = [dug * (37 - 6 * k), 0, -21 + 2.5 * k], from = B.spotAt(t);
  if (flat(from, spot) < STOP_LEN + 6) return;
  const pts = [from];
  if (BEHIND_THE_PLATE.some((q) => toSegment(q, from, spot) < 5)) pts.push([0, 0, -17]);
  pts.push(spot);
  const way = wayPath(roundMound(pts)), run = runAlong(B, way, t + 0.2, way.len - STOP_LEN, { v: 11 });
  pullUp(B, run.tEnd, run.vEnd);
}

// ── ball four, or hit by the pitch ─────────────────────────────────────────────
// The batter trots to first once his clip has him away (bat_walk or bat_hbp, `o.clip` from
// `o.start`, which the director plays), and every man forced trots up a bag, setting off at
// `o.tFour` (ball four, or the pitch hitting him); a man not forced walks back to his bag. All of
// it after the play's landed. Returns { bodies, log } as planBases does (the batter's clip is his
// prior entry, played by the director).
const JOG = 11.5;
export function planTrot(ctx, o) {
  const p = ctx.p, moves = Array.isArray(p.moves) ? p.moves : [], dug = dugoutOf(p);
  const rand = (k) => (hashStr(`${p.batter}|${p.inning}|${p.half}|trot:${k}`) % 10007) / 10007;
  const men = menOn(ctx, moves, Number.isFinite(ctx.tIn) ? ctx.tIn : o.tFour - 2, rand), log = { runners: [], batter: null }, home = [];
  for (const { m, B } of men) {
    const rec = { slot: B.slot, id: B.id, from: m.from, to: m.to ?? null, out: null, off: false, bags: {}, done: null, end: m.from };
    log.runners.push(rec);
    // a man not forced walks back to his bag
    if (m.to == null || m.to <= m.from) { standOn(B, m.from, o.tFour + 1 + 0.5 * rand('back' + m.from)); continue; }
    const toHome = m.to === 4, path = basePath(B.base.at, routeOf(m.from, m.to), toHome ? OVER_THE_PLATE : {});
    const r = stopAt(B, path, o.tFour + 0.5 + 0.3 * rand('go' + m.from), toHome ? path.len : path.bags[m.to], { v: JOG });
    rec.bags[m.to] = toHome ? r.run.timeAt(path.bags[4]) : r.on;
    rec.end = toHome ? null : m.to;
    if (toHome) home.push({ B, on: r.on });
  }
  home.forEach((x, k) => jogOff(x.B, x.on, k, dug));
  const H = ctx.batter ? makeBody({ ...ctx.batter, n: 0, role: 'batter', clip: o.clip, start: o.start }) : null;
  if (H) {
    const tGo = o.start + CLIPS[o.clip].duration - 0.25, path = basePath(H.spotAt(tGo), [1]);
    const r = stopAt(H, path, tGo, path.bags[1], { v: JOG });
    log.batter = { slot: H.slot, to: 1, end: 1, bags: { 1: r.on }, done: null };
  }
  return { bodies: [...(H ? [H] : []), ...men.map((x) => x.B)], log };
}

// ── the changeover ─────────────────────────────────────────────────────────────
// Each side's dugout, where a side takes the field from and goes off to: in foul ground 30 ft up
// the line, a row of spots five feet apart running out across the way the men come and go, the
// k-th man's the k-th.
export const dugoutSpot = (side, k) => [side * (42 + 5 * k), 0, 30];
// The spots for men at `from` (points), handed out so the ways to them are shortest in all, a pair
// swapped while that shortens them: then no two straight ways cross. Returns each man's spot index.
export function spotsFor(from, side) {
  const ks = from.map((_, j) => j), d = (i, k) => flat(from[i], dugoutSpot(side, k));
  for (let better = true; better;) {
    better = false;
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
      if (d(i, ks[j]) + d(j, ks[i]) < d(i, ks[i]) + d(j, ks[j]) - 1e-6) { [ks[i], ks[j]] = [ks[j], ks[i]]; better = true; }
    }
  }
  return ks;
}
// The side taking the field (`ctx.cast`, a half payload's), out of its dugout to its spots at a
// jog, a man every third of a second: the catcher to his spot behind the plate and the pitcher to
// a stride short of the rubber, the rest turned to the plate in their sets once they're there.
// From `o.t0`. Returns { bodies, at: Map(slot -> when he's there) }.
export function planTakeField(ctx, o) {
  const side = -dugoutOf(ctx.p), t0 = o.t0;
  const order = ['catcher', 'pitcher', 'fielder'], men = (ctx.cast || []).filter((c) => order.includes(c.look?.role))
    .sort((a, b) => order.indexOf(a.look.role) - order.indexOf(b.look.role));
  const bodies = [], at = new Map(), ks = spotsFor(men.map((c) => [c.at[0], 0, c.at[2]]), side);
  men.forEach((c, k) => {
    const start = dugoutSpot(side, ks[k]), spot = [c.at[0], 0, c.at[2]];
    const to = c.look.role === 'pitcher' ? sub(spot, mul(unit(sub(spot, start)), 2.5)) : spot;
    const B = makeBody({ n: 30 + k, id: c.id, slot: c.look.slot, role: c.look.role, at: start, yaw: faceTo(start, to), mirror: c.mirror, scale: c.scale, place: true });
    const way = wayPath(c.look.role === 'pitcher' ? [start, to] : roundMound([start, to])), r = stopAt(B, way, t0 + 0.3 + 0.33 * k, way.len, { v: flat(start, to) > 150 ? 17 : 13 });
    if (c.look.role === 'fielder') settle(B, r.on + 0.4, faceTo(spot, HOME));
    at.set(c.look.slot, r.on);
    bodies.push(B);
  });
  return { bodies, at };
}
// The inning's over: a man jogs off from where he is at t to his side's dugout (`side`, +1 the
// third-base side), the k-th man's spot in the crowd there. `B` is his plan so far (a body
// seeded with whatever he's playing). Returns when he's there.
export function jogToDugout(B, t, side, k) {
  const from = B.spotAt(t), spot = dugoutSpot(side, k), pts = [from];
  if (BEHIND_THE_PLATE.some((q) => toSegment(q, from, spot) < 5)) pts.push([0, 0, -17]);
  pts.push(spot);
  const way = wayPath(roundMound(pts));
  if (way.len < STOP_LEN + 4) return t;
  return stopAt(B, way, t, way.len, { v: way.len > 150 ? 16 : 12 }).on;
}

// The cast's man leading off `bag` (cast.js puts him at leadOff(bag)).
export function runnerAt(cast, bag) {
  let best = null, d = Infinity;
  for (const c of cast || []) {
    if (c.look?.role !== 'runner') continue;
    const k = flat(c.at, BAGS[bag]);
    if (k < d) { d = k; best = c; }
  }
  return d < 20 ? best : null;
}

// He goes back to his bag from where he is at t and stands on it facing the pitcher, ready to
// go: a man holding on a ball in the air, or tagging up, a step off it; with `o.on`, a man up from a
// slide he was safe on, a foot on it. Returns { at, t } where and when he's there.
// His lead's stance is turned no more than 60 degrees from the way he comes in: mixed further, the
// wide stance's legs cross on the way round.
export function standOn(B, bag, t, o = {}) {
  const b = bagAt(bag), next = bagAt(Math.min(4, bag + 1)), spot = add(b, mul(unit(sub(next, b)), o.on ? 0.6 : 1.2));
  const want = faceTo(spot, [RUBBER[0], 0, RUBBER[2]]), d = flat(B.spotAt(t), spot), near = o.on ? 1 : 2;
  if (d <= (o.on ? near : 2.5)) return { at: spot, t };
  const T = Math.max(0.6, d / 13), r = runTo(B, { at: spot, yaw: want }, t, t + T, { rest: true, min: near });
  const tOn = r ? t + T : t, came = B.facingAt(tOn), yaw = came + clamp(wrap(want - came), -60, 60);
  B.play('run_lead', tOn, { frame: { at: spot, yaw }, fade: 0.3 });
  return { at: spot, t: tOn };
}
