// DEADBALL · REPLAYS. A big play shown again in slow motion from a second angle, the way a
// broadcast fills the dead time after one (docs/proposals/deadball-glass2.md, Between beats and
// replays): a home run (off the bat from centre field, or from beside the fielder who leapt for it
// at the wall), a walk-off, a double or triple play, a triple, a catch that needed a dive or a
// leap (one at the wall or over the rail is a hit taken away, and says so), a play at the plate, a
// close play at any bag, a man thrown out stealing or a steal the tag just missed, and strike
// three to end an inning with a man on. A home run's waits until the batter's round the bags.
//
// Nothing is recorded. Staging a play is a pure function of its payload, so the play is staged
// again in a world of its own (diamond-smoke checks it's the same play to the micron), stepped to
// just before the moment and played at REPLAY.rate. The view (gameday-grandstand.js) shows that
// world in place of the live one while it runs, silent, under a REPLAY bug, and the live world
// carries on behind it. With reduced motion it's a still of the moment instead.
//
// With the comic look on, the grandstand plays it as a comic would draw it instead: a worm's-eye
// run, a freeze with its sound lettered on, the rest, and a comic page (diamond/comic.js).
//
// `replayOf` decides from the live staging (the director's plan and log) and gives the window
// relative to contact, so a play that earns none is never staged twice; `stageReplay` stages it
// again and steps there.
//
// Pure: no DOM and no GL.

import { createWorld, DT } from './world.js';
import { createDirector } from './director.js';
import { castOf } from './cast.js';
import { onField } from './play.js';
import { bigStrikeout, caughtStealing } from './timing.js';

// rate: how fast it plays, against the live game; after: how long after the play lands it
// starts (s of the game's clock), once the line and the words are up (and later, once a home
// run's or a walk-off's fireworks are out, so it doesn't hide them); still: how long a still
// holds with reduced motion (s); span: the longest stretch of play one replay shows (s); toss: how
// long a home run's runs on after contact, so the bat toss is let go and lands before it cuts (s).
export const REPLAY = Object.freeze({ rate: 0.4, after: 1.8, still: 3.2, span: 3.4, toss: 2.5 });

// The clips that make a catch worth seeing again.
const GREAT = new Set(['catch_dive', 'catch_slide', 'catch_wall', 'catch_rail', 'field_dive_left', 'field_dive_right']);
// The ones that took a hit away, at the wall or over the rail.
const ROBS = new Set(['catch_wall', 'catch_rail']);
// How close a call at a bag has to be to earn one (s between the ball and the runner); at the
// plate, where every one's worth a look, how near the man has to be to the throw; and how nearly
// the tag had a man who stole a base.
const CLOSE = 0.15, PLATE_CLOSE = 0.75, STEAL_CLOSE = 0.16;
const STEALS = new Set(['steal', 'caughtstealing', 'doublesteal']);

// The moment a replay's times are counted from: the bat on the ball, or where there was none (a
// strikeout, a steal) the pitch in the mitt. `rec` is the director's last log entry.
export const anchorOf = (rec) => (Number.isFinite(rec?.contact?.t) ? rec.contact.t : Number.isFinite(rec?.catch?.t) ? rec.catch.t : NaN);

// The camera for a catch: low beside the man as he goes for it and a little nearer the plate, so
// a catch at the wall isn't seen through it, looking at the glove. A shot by name with a track
// that stays put (camera.js shotAt 'fly').
function catchShot(at) {
  const h = Math.hypot(at[0], at[2]) || 1, u = [at[0] / h, 0, at[2] / h];
  // the side with the field under it: by a foul line one of them is up in the seats
  const spot = (k, w) => [at[0] - u[2] * k * w - u[0] * 10, 0, at[2] + u[0] * k * w - u[2] * 10];
  let g = spot(1, 42);
  for (const [k, w] of [[1, 42], [-1, 42], [1, 28], [-1, 28]]) if (onField(spot(k, w), 6)) { g = spot(k, w); break; }
  const eye = [g[0], Math.max(6, at[1] + 6), g[2]];
  const aim = [at[0], Math.max(1.5, at[1]), at[2]];
  return { shot: 'fly', eye, at: aim, fov: 24, follow: 0, track: () => aim };
}

// Whether a play earns a replay, and which: { kind, shot, from, key, to }, the times in seconds
// from contact (`key` the moment itself), or null. `plan` and `log` are the live director's
// (D.play, D.log). A walk-off first, then a home run, a triple play, a double play, a great
// catch, a triple and a close play at first.
export function replayOf(p, plan, log) {
  const rec = log?.[log.length - 1], tBat = anchorOf(rec);
  if (!p || !Number.isFinite(tBat)) return null;
  const L = plan?.log || {};
  const span = (kind, shot, key, before, after, most = REPLAY.span) => {
    const from = Math.max(key - before, key - most + after, -1.2), to = Math.min(key + after, from + most);
    return { kind, shot, from, key, to };
  };
  // on the bases: a man thrown out stealing, and a steal the tag only just missed
  if (p.phase === 'run') {
    const th = L.throw, tag = L.tag, touch = (L.runners || [])[0]?.touch;
    if (!plan || !STEALS.has(p.kind) || !th?.catch || !Number.isFinite(tag?.t)) return null;
    const caught = caughtStealing(p);
    if (!caught && !(Number.isFinite(touch) && tag.t - touch < STEAL_CLOSE)) return null;
    const bag = p.kind === 'doublesteal' ? 3 : (p.base | 0) || 2;
    return span(caught ? 'caught' : 'steal', bag === 3 ? 'third' : 'bag', th.catch.t - tBat, 1.7, 0.8);
  }
  if (p.phase) return null;
  // strike three with something on it (timing.js bigStrikeout, which the server leaves room for):
  // from the side the hitter faces, through the umpire's call
  if (p.kind === 'strikeout') {
    if (!bigStrikeout(p)) return null;
    const call = Number.isFinite(rec.call?.t) ? rec.call.t - tBat : 0.5;
    return { ...span('strikeout', p.bats === 'L' ? 'sideL' : 'side', 0, 1.3, Math.max(0.9, Math.min(1.7, call + 0.9))), bare: true };
  }
  if (!plan) return null;
  if (p.kind === 'homerun') {
    // one that went just over a fielder's glove at the wall is seen again from beside him there;
    // any other off the bat, from centre field
    const leap = (L.misses || []).find((m) => m.clip === 'catch_wall' && Array.isArray(m.at));
    if (leap) return { ...span(p.walkoff ? 'walkoff' : 'homerun', null, leap.t - tBat, 1.8, 0.9), shot: catchShot(leap.at) };
    // it runs on past the swing long enough to see him let the bat go and see it land
    return span(p.walkoff ? 'walkoff' : 'homerun', 'cf', 0, 1.1, REPLAY.toss, 1.1 + REPLAY.toss);
  }
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
  // a catch at the wall or over the rail took a hit away: its own kind, for its own words
  const great = p.out ? (L.fielders || []).find((f) => !f.miss && GREAT.has(f.clip)) : null;
  if (great && Array.isArray(great.at)) return { ...span(ROBS.has(great.clip) ? 'robbed' : 'catch', null, great.t - tBat, 1.6, 0.7), shot: catchShot(great.at) };
  if (p.kind === 'triple' && Number.isFinite(L.batter?.bags?.[3])) return span('triple', 'third', L.batter.bags[3] - tBat, 2.0, 0.7);
  // a play at the plate: a throw home taken there with a man coming in on it, safe or out
  const sent = [...(L.runners || []), ...(L.batter ? [L.batter] : [])];
  const atHome = (L.throws || []).find((x) => x.bag === 4 && !x.error && x.catch);
  if (atHome && sent.some((r) => r.bags && 4 in r.bags && (r.bags[4] == null || Math.abs(r.bags[4] - atHome.catch.t) < PLATE_CLOSE))) {
    return span('plate', 'plate', atHome.catch.t - tBat, 2.0, 0.8);
  }
  const atFirst = (L.throws || []).find((x) => x.bag === 1 && x.last && !x.error && x.catch);
  if (atFirst && Number.isFinite(L.batter?.tFirst) && Math.abs(atFirst.catch.t - L.batter.tFirst) < CLOSE) {
    return span('close', 'first', atFirst.catch.t - tBat, 1.6, 0.6);
  }
  // and a close one at second or third: the throw and the man there together
  for (const bag of [3, 2]) {
    const th = (L.throws || []).find((x) => x.bag === bag && !x.error && x.catch);
    if (th && sent.some((r) => Number.isFinite(r.bags?.[bag]) && Math.abs(r.bags[bag] - th.catch.t) < CLOSE)) {
      return span('close', bag === 3 ? 'third' : 'bag', th.catch.t - tBat, 1.6, 0.6);
    }
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
  const rec = D.log[D.log.length - 1], tBat = anchorOf(rec);
  // (a strikeout has no play to plan: `bare`)
  if ((!D.play && !spec.bare) || !Number.isFinite(tBat)) { D.stop(); return null; }
  const still = o.motion === false;
  const R = { W, D, kind: spec.kind, shot: spec.shot, from: tBat + spec.from, key: tBat + spec.key, to: tBat + spec.to, still };
  const start = still ? R.key : R.from;
  while (W.t < start - 1e-9) W.step(DT);
  return R;
}
