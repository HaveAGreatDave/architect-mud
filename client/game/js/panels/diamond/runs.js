// DEADBALL · THE PLAYS ON THE BASES. A play while the batter is up (sim v2's `phase: 'run'`): a
// steal or a man caught stealing, a double steal, a throw over or a pickoff, a wild pitch or a
// passed ball, planned around the one pitch or the one throw over that makes it.
//
// The sim decided how it comes out. A steal's payload carries the clocks its card shows: the
// pitcher's time to the plate (`plate`, his first move to the ball in the mitt) and the catcher's
// pop time (`pop`, the mitt to the glove at the bag). The director plays the delivery at the tempo
// that makes the first (`tempoFor`), and here the catcher throws in what's left of the second once
// the ball's out of his mitt and into his hand. What gives is the runner: he breaks so his slide
// gets to the bag a beat before the tag when he's safe and just after it when he's out, and if no
// jump a man would take does that, his lead does.
//
// Pure: no DOM and no GL.

import { CLIPS } from './clips.js';
import { eventTime, sampleClip, handAt, rootAt } from './anim.js';
import { solvePose } from './rig.js';
import { throwPath, pitchPath, BALL_R } from './flight.js';
import { legsOf, topSpeed, POSITIONS } from './play.js';
import { FOUL_GROUND } from './geo.js';
import { carried, toPark } from './world.js';
import { clamp, add, sub, mul, flat, faceTo, wrap, HOME, hashStr, makeBody, cloneBody, runTo, settle, groundOf, sideOf, FADE, endOf } from './bodies.js';
import { bagAt, basePath, slideIn, slideOf, stopAt, standOn, jogOff, dugoutOf, runnerAt, getUpAfter, stepOff } from './bases.js';
import { READY_STEP, gloveAt, releaseOf, frameOn } from './plays.js';

const STEALS = new Set(['steal', 'caughtstealing', 'doublesteal']);
const THROW_OVERS = new Set(['throwover', 'pickoff']);
const GETS_BY = new Set(['wildpitch', 'passedball']);
const unit = (v) => { const l = Math.hypot(v[0], v[2]) || 1; return [v[0] / l, 0, v[2] / l]; };
// The stretch delivery's first move, in its own time: it holds the set till then.
export const FIRST_MOVE = 0.3;

// The pitch a run play is made on, for the director to fit and throw as it does an at-bat's: a
// fastball away from the hitter for a steal, a breaking ball in the dirt for a wild pitch, one on
// the far corner for a passed ball. None for a throw over. hud.js pitchPoint's x: below 0.5 is the
// third-base side of the plate, where a right-handed hitter stands.
export function runPitch(p) {
  const k = p?.kind;
  if (!k || k === 'pickoff' || k === 'throwover') return null;
  const rand = (s) => (hashStr(`${p.batter}|${p.inning}|${p.half}|${k}|pitch:${s}`) % 10007) / 10007;
  const away = p.bats === 'L' ? 0.3 : 0.7, out = away > 0.5 ? 1 : -1;
  if (k === 'wildpitch') return { n: 0, result: 'ball', type: rand('t') < 0.5 ? 'curveball' : 'slider', velo: 80 + 5 * rand('v'), x: away + 0.22 * out, y: 1 };
  if (k === 'passedball') return { n: 0, result: 'ball', type: 'four-seam fastball', velo: 90 + 5 * rand('v'), x: away + 0.14 * out, y: 0.62 };
  return { n: 0, result: 'ball', type: 'four-seam fastball', velo: 89 + 6 * rand('v'), x: away, y: 0.42 + 0.12 * rand('y') };
}
// The tempo that gets the ball to the mitt `plate` seconds after the delivery's first move, when it
// takes `flight` from the hand to the mitt; kept to what a man's motion can be played at.
export const tempoFor = (delivery, plate, flight) => clamp((eventTime(delivery, 'release') - FIRST_MOVE) / Math.max(0.3, plate - flight), 0.75, 1.5);

// Where clip `id` from frame `fr` (started at tS) has B's glove at its `kind` event, in the park.
function eventAt(B, id, fr, tS, kind) {
  const clip = CLIPS[id], ev = clip.events.find((x) => x.kind === kind), F = carried(fr, clip, tS, 1, tS + ev.t, B.mirror);
  const P = sampleClip(clip, ev.t, { mirror: B.mirror, scale: B.scale, ground: groundOf(F) });
  return { t: tS + ev.t, at: toPark(F, handAt(P, sideOf(B, ev.hand), B.role === 'catcher' ? 'mitt' : 'glove', B.scale)) };
}
// When the ball goes from the glove to the throwing hand in a catch-and-throw clip: the clip time
// between its catch and its release when the two hands are closest. Kept by clip.
const MEETS = new Map();
function meetOf(id) {
  if (MEETS.has(id)) return MEETS.get(id);
  const clip = CLIPS[id], a = eventTime(clip, 'catch'), b = eventTime(clip, 'release');
  let best = { d: Infinity, t: (a + b) / 2 };
  for (let t = a + 0.05; t <= b - 0.05; t += 0.01) {
    const P = sampleClip(clip, t), d = Math.hypot(...[0, 1, 2].map((i) => handAt(P, 'L', 'mitt')[i] - handAt(P, 'R', 'bare')[i]));
    if (d < best.d) best = { d, t };
  }
  MEETS.set(id, best.t);
  return best.t;
}

// The play. `ctx` is { p (the payload), cast, tIn (the cut in), pitcher, catcher, batter } as
// plays.js has it: the battery as the world has them, the catcher at his setup, each with the clip
// he's in. `o` is the pitch, as the director throws it: { tFirst (the delivery's first move), tRel,
// tMitt (into the mitt), atMitt, box (the receive's reach) }. Returns a plan as plays.js planPlay's
// (bodies, balls, reaches, looks, cuts, sounds, landAt, log), or null for a play it doesn't stage.
export function planRun(ctx, o) {
  const p = ctx.p, kind = p?.kind;
  if (!STEALS.has(kind) && !THROW_OVERS.has(kind) && !GETS_BY.has(kind)) return null;
  const seed = hashStr(`${p.batter}|${p.inning}|${p.half}|${kind}|${p.runner}|${p.base}`);
  const rand = (k) => (hashStr(seed + ':' + k) % 10007) / 10007;
  const fieldTeam = p.fieldingTeam || (p.half === 'top' ? 'Home' : 'Away');
  const plan = { bodies: [], balls: [], reaches: [], looks: [], cuts: [], sounds: [], landAt: o.tMitt + 1, log: { kind, runners: [] } };
  const castOf = (id) => (ctx.cast || []).find((c) => c.id === id);

  // ── the seven set as the pitch comes, as plays.js has them ──
  const fielders = new Map();
  for (let n = 3; n <= 9; n++) {
    const c = castOf(`${fieldTeam}:${POSITIONS[n]}`);
    if (!c) continue;
    const B = makeBody({ n, id: c.id, slot: c.look.slot, role: 'fielder', at: c.at, yaw: c.yaw, mirror: c.mirror, scale: c.scale, place: true });
    // set for the pitch; on a throw over the first baseman's holding the man on at the bag
    if (!(THROW_OVERS.has(kind) && n === 3)) {
      const id = n >= 7 ? 'field_ready_out' : 'field_ready_in', s = (o.tMitt ?? o.tMove + 0.9) - READY_STEP(id);
      B.play(id, s, { frame: B.base, issue: ctx.tIn ?? s });
    }
    fielders.set(n, B);
  }
  if (THROW_OVERS.has(kind)) throwOver(ctx, o, plan, rand, fielders);
  else if (GETS_BY.has(kind)) getsBy(ctx, o, plan, rand, fielders);
  else steal(ctx, o, plan, rand, fielders);
  plan.bodies.push(...fielders.values());
  // every head on the ball from when it's out of the pitcher's hand (there's none before)
  const out = plan.log.release ?? o.tRel;
  for (const B of plan.bodies) if (B.role !== 'catcher') plan.looks.push({ slot: B.slot, from: out + 0.02, full: out + 0.35, hold: plan.landAt + 0.6, to: plan.landAt + 1.2 });
  plan.balls.sort((a, b) => a.from - b.from);
  plan.balls.forEach((s, i) => { s.to = i + 1 < plan.balls.length ? plan.balls[i + 1].from : Infinity; });
  return plan;
}

// ── a steal ──────────────────────────────────────────────────────────────────────
// The catcher throws to the bag the play's at (`p.base`; third on a double steal), the man
// covering takes it astride the bag and puts the tag down, the runner slides in before it or
// after it as the sim had him, and the base umpire calls it.
function steal(ctx, o, plan, rand, fielders) {
  const p = ctx.p, bag = p.kind === 'doublesteal' ? 3 : (p.base | 0) || 2, moves = Array.isArray(p.moves) ? p.moves : [];
  const pop = Number.isFinite(p.pop) ? p.pop : 2.0;
  // the catcher: the pitch into the mitt as the receive takes it, and the throw down in what's left
  // of the pop time once the ball's in his hand
  const C = makeBody({ ...ctx.catcher, n: 2, role: 'catcher' });
  const throwId = bag === 3 ? 'catch_throw_3b' : 'catch_throw_2b', clip = CLIPS[throwId];
  const evC = eventTime(clip, 'catch'), evR = eventTime(clip, 'release');
  const transfer = clamp(0.36 * pop + (bag === 3 ? 0.08 : 0), 0.6, 0.9), speed = (evR - evC) / transfer;
  const e = C.play(throwId, o.tMitt - evC / speed, { frame: { at: ctx.catcher.at, yaw: 0 }, speed, fade: 0.2 });
  const rel = releaseOf(C, e), tMeet = e.start + meetOf(throwId) / speed;
  plan.reaches.push({ slot: C.slot, hand: 'L', kind: 'mitt', target: o.atMitt.slice(), follow: o.box?.follow ?? 0.8, from: o.tMitt - 0.28, full: o.tMitt - 0.005, hold: o.tMitt + 0.04, to: o.tMitt + 0.22 });
  plan.balls.push({ from: o.tMitt, hold: { slot: C.slot, hand: 'L', kind: 'mitt' }, at: o.atMitt.slice() });
  plan.balls.push({ from: tMeet, hold: { slot: C.slot, hand: 'R', kind: 'bare' }, at: o.atMitt.slice() });
  plan.bodies.push(C);

  // the man covering: the second baseman with a right-hander up, the shortstop with a left-hander,
  // the third baseman at third; to the bag once the pitch is by, and astride it facing the throw
  const coverN = bag === 3 ? 5 : p.bats === 'L' ? 6 : 4, K = fielders.get(coverN);
  const tagId = bag === 3 ? 'tag_side' : 'tag_sweep', tagClip = CLIPS[tagId];
  const tBag = o.tMitt + pop, tS = tBag - eventTime(tagClip, 'catch');
  const B0 = bagAt(bag), fr = { at: [B0[0], 0, B0[2]], yaw: faceTo(B0, ctx.catcher.at) };
  const target = gloveAt(K, tagId, fr, tS);
  runTo(K, fr, o.tMitt + 0.1, tS, { rest: true });
  K.play(tagId, tS, { frame: fr, fade: FADE });
  plan.balls.push({ from: rel.t, path: throwPath(rel.at, target, rel.t, tBag - rel.t) });
  plan.balls.push({ from: tBag, hold: { slot: K.slot, hand: sideOf(K, 'L'), kind: 'glove' }, at: target });
  plan.reaches.push({ slot: K.slot, hand: sideOf(K, 'L'), kind: 'glove', target, follow: 0.6, from: tBag - 0.25, full: tBag - 0.005, hold: tBag + 0.05, to: tBag + 0.2 });
  const tag = eventAt(K, tagId, fr, tS, 'tag');
  plan.sounds.push({ at: tBag, cue: 'glove' });
  plan.cuts.push({ at: rel.t - 0.05, shot: bag === 3 ? 'third' : 'bag' });

  // the runner the throw's for: off his lead so his slide is in a beat before the tag, or just
  // after it; the jump a man takes, and the lead where no jump will do
  const m = moves.find((x) => x && x.from === bag - 1) || { from: bag - 1, to: bag };
  const safe = m.out == null;
  const want = safe ? tag.t - (0.08 + 0.17 * rand('safe')) : tag.t + (0.04 + 0.1 * rand('out'));
  const R = runnerOff(ctx, m.from, bag, want, o, rand);
  plan.bodies.push(R.B);
  plan.log.runners.push({ slot: R.B.slot, from: m.from, to: safe ? bag : null, out: safe ? null : bag, touch: R.touch, go: R.go, lead: R.lead, slide: R.slide, bags: { [bag]: R.touch } });

  // the base umpire: in a few steps to see it, and his call once the tag's down and the man's in
  const call = Math.max(tag.t, R.touch) + 0.2 + 0.1 * rand('call');
  const U = umpire(ctx, bag, call, !safe, o.tMitt);
  if (U) plan.bodies.push(U);
  plan.landAt = call + 0.3;
  plan.log.throw = { release: rel, catch: { t: tBag, at: target }, clip: throwId, speed };
  plan.log.tag = { ...tag, clip: tagId, slot: K.slot };
  plan.log.clocks = { plate: o.tMitt - o.tFirst, pop: tBag - o.tMitt };
  plan.log.call = { t: call, out: !safe, slot: U?.slot ?? null };

  // after it: the runner up; the man covering back to where he plays, and the runner onto the bag
  // if he's safe and off to his dugout if he's out. On the third out the director takes everyone
  // off (offField) from where this leaves them, so the man covering just steps off the bag first.
  const more = (p.outs | 0) < 3;
  getUpAfter(R.B, R.slide, call + 0.25);
  if (more) {
    backTo(K, ctx, endOf(K) - 0.3);
    if (safe) standOn(R.B, bag, endOf(R.B), { on: true });
    else jogOff(R.B, endOf(R.B), 0, dugoutOf(p));
  } else stepOff(K, R.B, bag, endOf(K) - 0.3);

  // the others: on a double steal the man behind goes too, into second with no throw; a man
  // holding a bag goes back to it once the pitch is by
  for (const x of moves) {
    if (!x || x.from === m.from || !(x.from >= 1 && x.from <= 3)) continue;
    if (x.to != null && x.to > x.from) {
      const T = runnerOff(ctx, x.from, x.to, null, o, rand, R.go + 0.05 + 0.1 * rand('trail'));
      getUpAfter(T.B, T.slide, T.slideEnd + 0.2);
      if (more) standOn(T.B, x.to, endOf(T.B), { on: true });
      plan.bodies.push(T.B);
      plan.log.runners.push({ slot: T.B.slot, from: x.from, to: x.to, out: null, touch: T.touch, go: T.go, lead: T.lead, slide: T.slide, bags: { [x.to]: T.touch } });
    } else {
      const c = runnerAt(ctx.cast, x.from);
      if (!c) continue;
      const H = leadBody(c, x.from, null, ctx.tIn, rand);
      standOn(H, x.from, o.tMitt + 0.3 + 0.3 * rand('back' + x.from));
      plan.bodies.push(H);
      plan.log.runners.push({ slot: H.slot, from: x.from, to: x.from, out: null, bags: {} });
    }
  }
}

// ── a throw over ─────────────────────────────────────────────────────────────────
// From the set the pitcher turns and throws to first (his pickoff move, a right-hander's or a
// left-hander's), the first baseman holding the man on takes it and sweeps the tag down onto the
// far side of the bag, and the runner dives back for it: in time on a throw over, a beat late on
// a pickoff, caught leaning the wrong way. The runner's lead is where the dive back's hand lands
// on the bag, and the first baseman stands where his tag comes down on it.
function throwOver(ctx, o, plan, rand, fielders) {
  const p = ctx.p, out = p.kind === 'pickoff', bag = 1;
  const B1 = bagAt(bag), toward = unit(sub(bagAt(2), B1)), hand = add(B1, mul(toward, 0.45));
  // the pitcher's move, from his set
  const Pp = makeBody({ ...ctx.pitcher, n: 1, role: 'pitcher' });
  const moveId = p.throws === 'L' ? 'pitch_pickoff_lefty' : 'pitch_pickoff';
  const em = Pp.play(moveId, o.tMove, { frame: { at: ctx.pitcher.at, yaw: ctx.pitcher.yaw }, fade: 0.15 });
  const rel = releaseOf(Pp, em);
  plan.bodies.push(Pp);
  plan.log.release = rel.t;
  // the first baseman at the bag, turned to the pitcher, his tag on the runner's side of it
  const K = fielders.get(3), tagId = 'tag_first';
  const yaw = faceTo(B1, ctx.pitcher.at), tagLocal = eventAt({ ...K, mirror: false }, tagId, { at: [0, 0, 0], yaw: 0 }, 0, 'tag').at;
  const off = [Math.cos(yaw * Math.PI / 180) * tagLocal[0] + Math.sin(yaw * Math.PI / 180) * tagLocal[2], 0, -Math.sin(yaw * Math.PI / 180) * tagLocal[0] + Math.cos(yaw * Math.PI / 180) * tagLocal[2]];
  const fr = { at: [hand[0] - off[0], 0, hand[2] - off[2]], yaw };
  K.base = { at: fr.at.slice(), yaw };
  const flight = flat(rel.at, fr.at) / (78 + 14 * rand('zip')), tC = rel.t + flight, tS = tC - eventTime(CLIPS[tagId], 'catch');
  K.play(tagId, tS, { frame: fr, issue: ctx.tIn, fade: 0 });
  const target = gloveAt(K, tagId, fr, tS), tag = eventAt(K, tagId, fr, tS, 'tag');
  plan.balls.push({ from: rel.t, path: throwPath(rel.at, target, rel.t, tC - rel.t) });
  plan.balls.push({ from: tC, hold: { slot: K.slot, hand: sideOf(K, 'L'), kind: 'glove' }, at: target });
  plan.reaches.push({ slot: K.slot, hand: sideOf(K, 'L'), kind: 'glove', target, follow: 0.6, from: tC - 0.2, full: tC - 0.005, hold: tC + 0.04, to: tC + 0.15 });
  plan.sounds.push({ at: tC, cue: 'glove' });
  plan.cuts.push({ at: rel.t - 0.05, shot: 'first' });
  // the runner, his lead where the dive back's hand comes down on the bag; in time, or a beat late
  const c = runnerAt(ctx.cast, bag), dv = diveOf();
  let lead = c.at, ry = c.yaw;
  for (let k = 0; k < 4; k++) {
    const q = [Math.cos(ry * Math.PI / 180) * dv.x + Math.sin(ry * Math.PI / 180) * dv.z, 0, -Math.sin(ry * Math.PI / 180) * dv.x + Math.cos(ry * Math.PI / 180) * dv.z];
    lead = [hand[0] - q[0], 0, hand[2] - q[2]];
    ry = faceTo(lead, ctx.pitcher.at) + 25;
  }
  const R = makeBody({ n: 10 + bag, id: c.id, slot: c.look.slot, role: 'runner', at: lead, yaw: ry, mirror: c.mirror, scale: c.scale, place: true });
  R.play('run_lead', ctx.tIn - rand('lap') * CLIPS.run_lead.duration, { frame: R.base, issue: ctx.tIn });
  const touchWant = out ? tag.t + 0.04 + 0.1 * rand('late') : Math.min(tag.t - 0.12, o.tMove + 0.12 + 0.15 * rand('jump') + dv.t);
  const tDive = Math.max(o.tMove + 0.05, touchWant - dv.t);
  R.play('run_dive_back', tDive, { frame: R.base, fade: 0.15 });
  const touch = tDive + dv.t;
  plan.bodies.push(R);
  plan.log.runners.push({ slot: R.slot, from: bag, to: out ? null : bag, out: out ? bag : null, touch, go: tDive, lead: flat(lead, B1), slide: 'run_dive_back', bags: { [bag]: touch } });
  // the umpire's call once the tag's down and the hand's in, and the runner up off the ground
  const call = Math.max(tag.t, touch) + 0.2 + 0.1 * rand('call');
  const U = umpire(ctx, bag, call, out, rel.t);
  if (U) plan.bodies.push(U);
  plan.landAt = call + 0.3;
  // the runner up, back on the bag or off to his dugout, and the first baseman back to where he
  // plays, unless the side's going off
  getUpAfter(R, 'run_dive_back', call + 0.3);
  if ((p.outs | 0) < 3) {
    backTo(K, ctx, endOf(K) - 0.3);
    if (out) jogOff(R, endOf(R), 0, dugoutOf(p));
    else standOn(R, bag, endOf(R), { on: true });
  } else stepOff(K, R, bag, endOf(K) - 0.3);
  plan.log.throw = { release: rel, catch: { t: tC, at: target }, clip: moveId };
  plan.log.tag = { ...tag, clip: tagId, slot: K.slot };
  plan.log.call = { t: call, out, slot: U?.slot ?? null };
}
// Where the dive back's right hand comes down, in the frame it starts in, and when it gets within a
// tenth of a foot of there: { x, z, t }.
let DIVE = null;
function diveOf() {
  if (DIVE) return DIVE;
  const clip = CLIPS.run_dive_back;
  const point = (t) => { const r = rootAt(clip, t), J = solvePose({ ...sampleClip(clip, t), at: [r.at[0], 0, r.at[1]], yaw: r.yaw || 0 }).J; return J.wrR; };
  const end = point(clip.duration);
  let tT = clip.duration;
  for (let t = 0; t <= clip.duration; t += 1 / 120) if (flat(point(t), end) < 0.1) { tT = t; break; }
  return (DIVE = { x: end[0], z: end[2], t: tT });
}

// ── a wild pitch or a passed ball ───────────────────────────────────────────────
// The pitch gets by the catcher: a breaking ball into the dirt in front of the plate that skips
// past his block, or one he should have had, off the end of his mitt. It rolls to the backstop;
// he turns, goes after it and picks it up where it stops, and every man moves up a bag while he
// does, the pitcher in to cover the plate when a man's coming home from third.
function getsBy(ctx, o, plan, rand, fielders) {
  const p = ctx.p, wild = p.kind === 'wildpitch', moves = Array.isArray(p.moves) ? p.moves : [];
  const C = makeBody({ ...ctx.catcher, n: 2, role: 'catcher' }), side = o.atMitt[0] >= 0 ? 1 : -1;
  const zPast = ctx.catcher.at[2] + 1.2;
  let path0, tPast, at0;
  if (wild) {
    // into the dirt three feet in front of the plate, wide, and off it past the block
    const bounce = [o.atMitt[0] + side * 0.6, BALL_R, 3 + rand('dirt')];
    path0 = pitchPath({ from: o.from, through: bounce, t0: o.tRel, mph: o.pitch.velo, type: o.pitch.type, hand: o.hand });
    const tB = o.tRel + path0.T;
    const skip = [bounce[0] + side * (2.2 + 0.8 * rand('skip')), 0.9, zPast];
    const hop = throwPath(bounce, skip, tB, 0.16);
    tPast = tB + 0.16; at0 = skip;
    const blk = CLIPS.catch_block, ev = eventTime(blk, 'catch');
    C.play('catch_block', tPast - ev, { frame: { at: ctx.catcher.at, yaw: 0 }, fade: 0.2 });
    plan.balls.push({ from: o.tRel, path: (t) => (t < tB ? path0(t) : hop(t)) });
  } else {
    // a catchable one, off the end of the mitt as it closes: on its way past him
    path0 = o.path; tPast = o.tMitt; at0 = o.atMitt;
    const recv = CLIPS.catch_receive, ev = eventTime(recv, 'catch');
    C.play('catch_receive', o.tMitt - ev, { frame: { at: ctx.catcher.at, yaw: 0 }, fade: 0.2 });
    plan.reaches.push({ slot: C.slot, hand: 'L', kind: 'mitt', target: add(o.atMitt, [side * 0.55, -0.15, 0]), follow: 0.5, from: o.tMitt - 0.28, full: o.tMitt - 0.01, hold: o.tMitt + 0.04, to: o.tMitt + 0.25 });
  }
  // off his gear or the end of his mitt
  plan.sounds.push({ at: tPast, cue: 'glove' });
  // on to the backstop, slowing on the dirt, and lying there
  const rest = [side * (5 + 12 * rand('rest')), BALL_R, -(FOUL_GROUND.back - 6) - 4 * rand('deep')];
  const T = flat(at0, rest) / (wild ? 24 : 30), tRest = tPast + T;
  const roll = rollTo(at0, rest, tPast, T);
  plan.balls.push({ from: tPast + (wild ? 0 : 0.0001), path: roll });
  // the catcher after it: up out of his crouch, turned, and over to pick it up
  const yaw = faceTo(ctx.catcher.at, rest), fr = frameOn(C, 'pick_up', rest, yaw);
  // a block has him up off his knees going after it; a receive brings the mitt in to his chest first
  const tS0 = tPast + (wild ? 0.35 : 0.6), dRun = flat(ctx.catcher.at, fr.at), tPick = Math.max(tRest + 0.2, tS0 + dRun / 19 + eventTime(CLIPS.pick_up, 'catch'));
  const tS = tPick - eventTime(CLIPS.pick_up, 'catch');
  runTo(C, fr, tS0, tS, { rest: true });
  C.play('pick_up', tS, { frame: fr, fade: FADE });
  plan.reaches.push({ slot: C.slot, hand: 'R', kind: 'bare', target: rest.slice(), follow: 0.35, from: tPick - 0.25, full: tPick - 0.005, hold: tPick + 0.05, to: tPick + 0.3 });
  plan.balls.push({ from: tPick, hold: { slot: C.slot, hand: 'R', kind: 'bare' }, at: rest.slice() });
  plan.bodies.push(C);
  plan.log.release = o.tRel;
  plan.log.ball = { past: tPast, rest: tRest, at: rest, pick: tPick };
  // every man up a bag once it's by him; a man from third home over the plate and off
  const tGo = tPast + 0.2;
  let land = tPick + 0.3, home = null;
  for (const m of moves) {
    if (!m || !(m.from >= 1 && m.from <= 3) || !(m.to > m.from)) continue;
    const c = runnerAt(ctx.cast, m.from);
    if (!c) continue;
    const B = leadBody(c, m.from, null, ctx.tIn, rand), v = topSpeed(legsOf(c.id)) * 0.85;
    const toHome = m.to === 4, path = basePath(B.base.at, [m.to], toHome ? { past: 16, pastTurn: 40 } : {});
    const r = stopAt(B, path, tGo + 0.15 * rand('go' + m.from), toHome ? path.len : path.bags[m.to], { v });
    const on = toHome ? r.run.timeAt(path.bags[4]) : r.on;
    if (toHome) { home = on; jogOff(B, r.on, 0, dugoutOf(p)); }
    land = Math.max(land, on + 0.2);
    plan.bodies.push(B);
    plan.log.runners.push({ slot: B.slot, from: m.from, to: m.to, out: null, go: tGo, bags: { [m.to]: on } });
  }
  // the pitcher in to cover the plate when a man's coming home
  if (home != null) {
    const Pp = makeBody({ ...ctx.pitcher, n: 1, role: 'pitcher' }), spot = [2.5 * side, 0, 3.5];
    const t0 = Math.max(ctx.pitcher.start + CLIPS[ctx.pitcher.clip].duration / ctx.pitcher.speed - 0.4, o.tRel + 0.6);
    if (runTo(Pp, { at: spot, yaw: faceTo(spot, rest) }, t0, Math.max(t0 + 1.6, home - 0.2), { rest: true })) settle(Pp, Math.max(t0 + 1.6, home - 0.2), faceTo(spot, rest));
    plan.bodies.push(Pp);
  }
  plan.landAt = land;
  plan.cuts.push({ at: tPast + 0.2, shot: home != null ? 'backstop' : 'high' });
}
// A ball from `from` to rest at `to` in T seconds, slowing evenly along the ground with a last low
// hop off the dirt as it goes, and lying there after.
function rollTo(from, to, t0, T) {
  const at = (t) => {
    const u = clamp((t - t0) / T, 0, 1), k = 1 - (1 - u) * (1 - u);
    const y = BALL_R + Math.max(0, from[1] - BALL_R) * Math.max(0, 1 - u * 6) + 0.5 * Math.max(0, Math.sin(Math.PI * clamp((u - 0.12) / 0.22, 0, 1)));
    return [from[0] + (to[0] - from[0]) * k, y, from[2] + (to[2] - from[2]) * k];
  };
  at.t0 = t0; at.T = T;
  return at;
}

// A man in his lead off `from` toward the next bag, `lead` feet off it (the cast's lead if not
// given), from the cut in.
function leadBody(c, from, lead, tIn, rand) {
  const b = bagAt(from), next = bagAt(from + 1), at = lead == null ? c.at : add(b, mul(unit(sub(next, b)), lead));
  const B = makeBody({ n: 10 + from, id: c.id, slot: c.look.slot, role: 'runner', at: [at[0], 0, at[2]], yaw: c.yaw, mirror: c.mirror, scale: c.scale, place: true });
  B.play('run_lead', tIn - rand('lap' + from) * CLIPS.run_lead.duration, { frame: B.base, issue: tIn });
  return B;
}
// The man off `from` running for `to` and sliding in: his slide's touch on the bag at `want` (null:
// he goes at `go`). He takes the jump a man would, from just before the first move to a third of
// a second after it; where none gets him there his lead does, between 7 and 16 feet.
function runnerOff(ctx, from, to, want, o, rand, go) {
  const c = runnerAt(ctx.cast, from);
  const v = topSpeed(legsOf(c.id)), slide = rand('slide' + from) < 0.4 ? 'slide_head' : 'slide_feet';
  const trial = (lead, tGo) => {
    const B = leadBody(c, from, lead, ctx.tIn, rand), path = basePath(B.base.at, [to]);
    const r = slideIn(B, path, tGo, path.bags[to], slide, { v });
    return { B, touch: r.touch, path, slideStart: r.run.tEnd };
  };
  const cast0 = flat(c.at, bagAt(from));
  if (want == null) {
    const r = trial(null, go);
    return { ...r, go, lead: cast0, slide, slideEnd: slideEndOf(r.B) };
  }
  // the jump for a lead: the touch is later the later he goes, so halve the way to it
  const jumpFor = (lead) => { let a = o.tFirst - 1.5, b = o.tFirst + 1.5; for (let k = 0; k < 30; k++) { const m = (a + b) / 2; if (trial(lead, m).touch < want) a = m; else b = m; } return (a + b) / 2; };
  let lead = cast0, tGo = jumpFor(lead);
  const lo = o.tFirst - 0.1, hi = o.tFirst + 0.35;
  for (let k = 0; k < 18 && tGo < lo && lead < 16; k++) { lead = Math.min(16, lead + 0.5); tGo = jumpFor(lead); }
  for (let k = 0; k < 18 && tGo > hi && lead > 7; k++) { lead = Math.max(7, lead - 0.5); tGo = jumpFor(lead); }
  tGo = clamp(tGo, o.tFirst - 0.25, o.tFirst + 0.6);
  const r = trial(lead === cast0 ? null : lead, tGo);
  return { ...r, go: tGo, lead, slide, slideEnd: slideEndOf(r.B) };
}
// A fielder off the bag once the play's done: a jog back to where he started, and his set there
// facing home, or as near it as 60 degrees from the way he comes in (turned further in the mix, his
// legs cross, as standOn's do).
function backTo(B, ctx, t) {
  const c = (ctx.cast || []).find((x) => x.id === B.id);
  if (!c) return;
  const spot = [c.at[0], 0, c.at[2]], want = faceTo(spot, HOME), T = Math.max(1.2, flat(B.spotAt(t), spot) / 11);
  if (!runTo(B, { at: spot, yaw: want }, t, t + T, { rest: true })) return;
  const came = B.facingAt(t + T);
  settle(B, t + T, came + clamp(wrap(want - came), -60, 60));
}
const slideEndOf = endOf;
// The base umpire at `bag`: a few steps in to an angle on it as the throw comes, and his call at
// `call` (the safe or the out). Null where the cast has none.
function umpire(ctx, bag, call, out, tPitch) {
  const id = bag === 1 ? 'ump:1B' : bag === 3 ? 'ump:3B' : 'ump:2B', c = (ctx.cast || []).find((x) => x.id === id);
  if (!c) return null;
  const U = makeBody({ n: -1, id: c.id, slot: c.look.slot, role: 'ump', at: c.at, yaw: c.yaw, mirror: c.mirror, scale: c.scale, place: true });
  const b = bagAt(bag), from = unit(sub(c.at, b)), spot = add(b, mul(from, 13)), yaw = faceTo(spot, b);
  const clipId = out ? 'ump_out_base' : 'ump_safe_base', ev = eventTime(CLIPS[clipId], 'call'), start = call - ev;
  if (runTo(U, { at: spot, yaw }, tPitch + 0.2, start - 0.1, { rest: true })) U.play(clipId, start, { frame: { at: spot, yaw }, fade: 0.25 });
  else U.play(clipId, start, { frame: { at: c.at, yaw: faceTo(c.at, b) }, fade: 0.25 });
  return U;
}
