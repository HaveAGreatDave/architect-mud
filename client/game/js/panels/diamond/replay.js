// DEADBALL · REPLAYS. A big play shown again in slow motion from a second angle, the way a
// broadcast fills the dead time after one (docs/proposals/deadball-glass2.md, Between beats and
// replays): a home run, a walk-off, a double or triple play, a triple, a catch that needed a dive
// or a leap, and a close play at first.
//
// Nothing is recorded. Staging a play is a pure function of its payload, so the play is staged
// again in a world of its own (diamond-smoke checks it's the same play to the micron), stepped to
// just before the moment and played at REPLAY.rate. The view (gameday-grandstand.js) shows that
// world in place of the live one while it runs, silent, under a REPLAY bug, and the live world
// carries on behind it. With reduced motion it's a still of the moment instead.
//
// `replayOf` decides from the live staging (the director's plan and log) and gives the window
// relative to contact, so a play that earns none is never staged twice; `stageReplay` stages it
// again and steps there.
//
// Pure: no DOM and no GL.

import { createWorld, DT } from './world.js';
import { createDirector } from './director.js';
import { castOf } from './cast.js';

// rate: how fast it plays, against the live game; after: how long after the play lands it
// starts (s of the game's clock), once the line and the words are up (and later, once a home
// run's or a walk-off's fireworks are out, so it doesn't hide them); still: how long a still
// holds with reduced motion (s); span: the longest stretch of play one replay shows (s).
export const REPLAY = Object.freeze({ rate: 0.4, after: 1.8, still: 3.2, span: 3.4 });

// The clips that make a catch worth seeing again.
const GREAT = new Set(['catch_dive', 'catch_slide', 'catch_wall', 'catch_rail', 'field_dive_left', 'field_dive_right']);
// How close a call at first has to be to earn one (s between the ball and the runner).
const CLOSE = 0.15;

// The camera for a catch: low beside the man as he goes for it and a little nearer the plate, so
// a catch at the wall isn't seen through it, looking at the glove. A shot by name with a track
// that stays put (camera.js shotAt 'fly').
function catchShot(at) {
  const h = Math.hypot(at[0], at[2]) || 1, u = [at[0] / h, 0, at[2] / h], side = [-u[2], 0, u[0]];
  const eye = [at[0] + side[0] * 42 - u[0] * 10, Math.max(6, at[1] + 6), at[2] + side[2] * 42 - u[2] * 10];
  const aim = [at[0], Math.max(1.5, at[1]), at[2]];
  return { shot: 'fly', eye, at: aim, fov: 24, follow: 0, track: () => aim };
}

// Whether a play earns a replay, and which: { kind, shot, from, key, to }, the times in seconds
// from contact (`key` the moment itself), or null. `plan` and `log` are the live director's
// (D.play, D.log). A walk-off first, then a home run, a triple play, a double play, a great
// catch, a triple and a close play at first.
export function replayOf(p, plan, log) {
  const rec = log?.[log.length - 1], tBat = rec?.contact?.t;
  if (!p || p.phase || !plan || !Number.isFinite(tBat)) return null;
  const L = plan.log || {};
  const span = (kind, shot, key, before, after) => {
    const from = Math.max(key - before, key - REPLAY.span + after, -1.2), to = Math.min(key + after, from + REPLAY.span);
    return { kind, shot, from, key, to };
  };
  if (p.kind === 'homerun') return span(p.walkoff ? 'walkoff' : 'homerun', 'cf', 0, 1.1, 1.3);
  if (p.walkoff) {
    // the winning run over the plate
    const home = (L.runners || []).map((r) => r.bags?.[4]).filter(Number.isFinite);
    if (home.length) return span('walkoff', 'plate', Math.max(...home) - tBat, 2.2, 0.8);
  }
  const chain = (L.throws || []).filter((x) => x.release && x.catch && !x.error);
  if ((p.kind === 'tripleplay' || p.kind === 'doubleplay') && chain.length >= 2) {
    const first = chain[0].release.t - tBat, last = chain[chain.length - 1].catch.t - tBat;
    return span(p.kind, 'bag', chain[0].catch.t - tBat, (chain[0].catch.t - tBat) - first + 0.6, last - (chain[0].catch.t - tBat) + 0.5);
  }
  const great = p.out ? (L.fielders || []).find((f) => !f.miss && GREAT.has(f.clip)) : null;
  if (great && Array.isArray(great.at)) return { ...span('catch', null, great.t - tBat, 1.6, 0.7), shot: catchShot(great.at) };
  if (p.kind === 'triple' && Number.isFinite(L.batter?.bags?.[3])) return span('triple', 'third', L.batter.bags[3] - tBat, 2.0, 0.7);
  const atFirst = (L.throws || []).find((x) => x.bag === 1 && x.last && !x.error && x.catch);
  if (atFirst && Number.isFinite(L.batter?.tFirst) && Math.abs(atFirst.catch.t - L.batter.tFirst) < CLOSE) {
    return span('close', 'first', atFirst.catch.t - tBat, 1.6, 0.6);
  }
  return null;
}

// The play staged again in a world of its own and stepped to where the replay starts (its
// moment, for a still): { W, D, kind, shot, from, key, to, still }, in that world's times, or
// null if it couldn't be. `o`: { cast, motion (false for a still) }. Its director says nothing:
// the replay is silent and keeps its own camera.
export function stageReplay(p, spec, o = {}) {
  if (!spec) return null;
  const W = createWorld(), D = createDirector(W, {});
  D.stage(p, o.cast || castOf(p), { motion: o.motion });
  const rec = D.log[D.log.length - 1], tBat = rec?.contact?.t;
  if (!D.play || !Number.isFinite(tBat)) { D.stop(); return null; }
  const still = o.motion === false;
  const R = { W, D, kind: spec.kind, shot: spec.shot, from: tBat + spec.from, key: tBat + spec.key, to: tBat + spec.to, still };
  const start = still ? R.key : R.from;
  while (W.t < start - 1e-9) W.step(DT);
  return R;
}
