// DEADBALL · THE DIRECTOR. One at-bat in, the pitches it was made of out, in the 3-D park.
//
// The sim already decided everything: each pitch's type, speed, where it crossed the plate and
// what came of it, and how the at-bat ended. This file stages it in the world (diamond/world.js):
// the pitcher's delivery, the ball flown to its exact spot at its real speed (diamond/flight.js),
// the hitter's load and his take or swing, the catcher's mitt meeting the ball, the umpire's call;
// between pitches the throw back and the walk up to the rubber; and at the end the strikeout, the
// walk or the hit batsman in full, or the ball put in play.
//
// THE OUTCOME IS NEVER IN DOUBT. Every clip is lined up on the ball: the catch on the moment it
// reaches the mitt, the swing's contact on the moment it reaches the bat, the flinch on the moment
// it reaches him. It's all worked out when the payload arrives, as times on the world's clock
// (`timeline`), and the clock plays it.
//
// THE PITCHES GET THE TIME FIRST. The budget is 0.45 of the line's hold, kept between 13 and 26
// seconds (`budgetOf`), and `planViews` spends it in the plan's order: every pitch at real speed,
// cut in at the stride; then each one's reaction, the hitter in close-up; then the pitcher's motion
// from its start, and the set before it; then the throw back and the walk up to the rubber. A long
// at-bat on a short hold leaves pitches out of the middle, and the count goes through them. A ball
// in play is never hurried to fit: a play that needs more than the budget leaves out the first
// pitch too, and if the last pitch and the play still don't fit, they run over (`floor`). Every
// jump from one moment to another is under a cut (`shot`), so nobody pops.
//
// A BALL IN PLAY IS PLAYED OUT (diamond/plays.js): the fielders set as the last pitch comes, the
// ball where the server sent it, the man who fields it, the throws and the catches, every man on
// the bases and the batter round to where the play leaves them (diamond/bases.js), and the base
// umpires' calls, with the high camera following the ball and the first-base camera on a play
// there. The play is planned once for the budget and again on the clock; it's the same plan both
// times, moved. On ball four or a hit batsman the batter trots to first and the men forced trot up
// a bag (bases.js planTrot).
//
// THE CHANGEOVER. On the third out, once the play's landed, every man on the field jogs off to his
// side's dugout from where the world has him (`offField`) and the high camera watches them go. A
// half payload (`D.changeover`) runs the side taking the field out to its places and has the
// pitcher throw his warm-ups to the catcher, as many as the hold has room for. In the middle of the
// fifth the grounds crew drag the infield first (crew.js), the infielders waiting by their dugout
// till the mats are off the dirt, and the cameras go to them once the leaders' table comes down.
//
// A PICTURE THAT DISAGREES WITH THE NEXT PAYLOAD IS FIXED ON A CUTAWAY. The booth doesn't call
// every at-bat, so the bags the picture last showed and the ones the next payload starts from
// often differ; then the at-bat opens on the wide shot over the city for a beat (`cutaway`), and
// everyone is in their new places when it cuts in. A game's first at-bat opens on the main gate from
// the street instead, the crowd still going in (`cutaway: 'street'`).
//
// `onLand` fires when the play lands: the umpire's call on a called third strike, the ball in the
// mitt on a swinging one or on ball four, the ball hitting him, or the ball put in play resolved.
// The view holds the booth's line and the card until then.
//
// BETWEEN AT-BATS (diamond/between.js). The on-deck hitter swings in his circle through every
// at-bat. Once a play's landed the view asks for the dead time till the next payload's due
// (`between`): the field walks back to its places, the pitcher rubs up the ball behind the rubber,
// a man who's out goes off, and the cameras go round the park; not after a third out or a walk-off.
//
// THE DIRT KEEPS THE GAME (diamond/marks.js). Every pitch leaves the pitcher's stride where his
// front foot lands and the batter's back foot dug in, and every slide or dive its scar, said as
// they're made ('mark'), and a pitch left out leaves its marks as the next one cuts in.
//
// Pure: no DOM and no GL, so the gates run it.

import { eventTime, SWEET_SPOT, handPoint } from './anim.js';
import { solvePose } from './rig.js';
import { pitchPoint } from './hud.js';
import { pitchPath, throwPath, hitPath, BALL_R } from './flight.js';
import { CLIPS } from './clips.js';
import { castOf, crewDue } from './cast.js';
import { toPark } from './world.js';
import { planPlay } from './plays.js';
import { planRun, runPitch, tempoFor, FIRST_MOVE } from './runs.js';
import { planSpectacle, KINDS as FX_KINDS } from './spectacle.js';
import { planTrot, planTakeField, jogToDugout, dugoutOf, dugoutSpot as dugoutSpotOf } from './bases.js';
import { makeBody, cloneBody, onOf, flat } from './bodies.js';
import { strideOf, digOf, scarsOf } from './marks.js';
import { planBetween, deckPlan, shotsBetween, BETWEEN } from './between.js';
import { planCrew, crewShots } from './crew.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
// How near the ground's origin a point moving straight from a to b comes, across the ground.
const nearest = (a, b) => { const d = sub(b, a), L = d[0] * d[0] + d[2] * d[2], f = L ? clamp(-(a[0] * d[0] + a[2] * d[2]) / L, 0, 1) : 0; return Math.hypot(a[0] + d[0] * f, a[2] + d[2] * f); };
function hashStr(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

// How long the infielders take to come out once the grounds crew's mats are off the dirt (the
// furthest of them from the dugout across the field, and a beat), in seconds. cast.js CREW_HOLD
// leaves room for it after the drag.
const CREW_ROOM = 12.5;

// The budget, in seconds, for a payload: 0.45 of its hold (milliseconds), between 13 and 26.
export const BUDGET = Object.freeze({ share: 0.45, min: 13, max: 26 });
export const budgetOf = (p) => clamp(BUDGET.share * (Number.isFinite(p?.hold) ? p.hold / 1000 : 0), BUDGET.min, BUDGET.max);

// The pieces of a pitch's time, in seconds: from the payload to the first cut (`in`); a quick
// pitch cut in this long before the release (`quick`); after a pitch with no reaction, to the next
// (`after`); after one with its reaction, the hitter in close-up from `reactCut` on (`react`); the
// pitcher on the rubber before a windup (`windupHold`); the throw back's flight (`lob`), how long
// before it reaches the pitcher the ritual's shot comes in (`ritualIn`), the wide shot an at-bat
// opens on when the picture disagrees with it (`cutaway`), and the street outside the main gate a
// game opens on (`street`, no shorter than `streetMin`).
export const PACE = Object.freeze({ in: 0.05, quick: 0.5, after: 0.55, react: 1.35, reactCut: 0.3, windupHold: 1.0, lob: 0.95, ritualIn: 0.4, cutaway: 1.4, street: 4.2, streetMin: 2.2 });
// How long from the bat to the play's landing for a ball in play the payload doesn't describe
// (one from before synthPlay): about a grounder's time to an infielder and his throw to first, a
// fly's hang time, a home run's carry. A payload's `play` is played out instead (plays.js).
const GROUND = new Set(['groundout', 'doubleplay', 'tripleplay', 'productout', 'error', 'fielderschoice']);
const flightOf = (kind) => (kind === 'homerun' ? 4.2 : GROUND.has(kind) ? 2.4 : 3.0);
// The umpire's ways of ringing up strike three; each umpire has his own, off the game.
export const PUNCHOUTS = Object.freeze(['ump_punchout_hammer', 'ump_punchout_bow', 'ump_punchout_point']);
// Where the catcher squats, and the plane his receive's catch is keyed in, 1.57 ft in front of
// him; the hitter's swings meet the ball 0.73 ft in front of where he stands.
const CATCHER_AT = Object.freeze([0, 0, -2.75]);
const MITT_DZ = 1.57, BAT_DZ = 0.73;
// The camera on the hitter: the first-base side for a right-hander, the third for a left-hander.
const sideShot = (bats) => (bats === 'L' ? 'sideL' : 'side');

// ── the at-bat, worked out ─────────────────────────────────────────────────────
// Who plays the pitch and where everything goes, before anything is scheduled: the battery placed
// in the world, the pitcher's delivery and where the ball leaves his hand, and each pitch's flight
// from a release at time 0 (its path's shape doesn't depend on when). Null when there's nothing to
// stage (no pitches, or nobody to throw them).
function prepare(W, p, cast) {
  const pitches = Array.isArray(p?.pitches) ? p.pitches : [];
  const by = (role) => cast.find((c) => c.look.role === role) || null;
  const who = { pitcher: by('pitcher'), catcher: by('catcher'), batter: by('batter'), ump: cast.find((c) => c.id === 'ump:plate') || null };
  if (!pitches.length || !who.pitcher || !who.catcher || !who.batter) return null;
  const place = (c) => (c ? W.place(c.look.slot, { id: c.id, role: c.look.role, at: c.at, yaw: c.yaw, scale: c.scale, mirror: c.mirror }) : null);
  const P = place(who.pitcher), C = place(who.catcher), H = place(who.batter), U = place(who.ump);
  // nobody else is the world's: a slot changes hands at a changeover (cast.js), and whoever has it
  // now is a still until something plays him
  for (const slot of [...W.bodies.keys()]) if (![P, C, H, U].some((b) => b && b.slot === slot)) W.drop(slot);
  const hand = p.throws === 'L' ? 'L' : 'R', bats = p.bats === 'L' ? 'L' : 'R';
  const windup = !(Array.isArray(p.basesBefore) && p.basesBefore.some(Boolean));
  const tempo = P.traits.tempo;
  const delivery = CLIPS[`pitch_${windup ? 'windup' : 'stretch'}_${P.traits.armSlot}`];
  // where the ball leaves his hand: the clip's release, done his way where he stands
  const relJ = solvePose(W.sample(P.slot, delivery.id, eventTime(delivery, 'release'))).J;
  const from = add(relJ['wr' + hand], mul(relJ['hdir' + hand], 0.2));
  const zBat = H.at[2] + BAT_DZ, zMitt = CATCHER_AT[2] + MITT_DZ;
  // a pitch that hits him meets his back where the flinch has turned it, at his chest's height
  let hbpAt = null;
  const hbpPoint = () => {
    if (hbpAt) return hbpAt;
    const hj = solvePose(W.sample(H.slot, 'bat_hbp', eventTime(CLIPS.bat_hbp, 'hit'))).J;
    return (hbpAt = [hj.chest[0] + (H.at[0] > 0 ? -0.35 : 0.35), hj.chest[1], hj.chest[2] + 0.25]);
  };
  // where his hands have the knob at each swing's contact
  const knobs = {};
  const knobAt = (id) => (knobs[id] ??= toPark(H, W.sample(H.slot, id, eventTime(CLIPS[id], 'contact')).bat.knob));
  const swingFor = (y) => (y < 2.5 ? 'bat_swing_low' : y > 3.45 ? 'bat_swing_high' : 'bat_swing_mid');
  const recv = CLIPS.catch_receive, blk = CLIPS.catch_block;
  const shapes = pitches.map((q) => {
    const hbp = q.result === 'hbp', contact = q.result === 'foul' || q.result === 'inplay';
    const through = hbp ? hbpPoint() : pitchPoint(q, bats);
    const path = pitchPath({ from, through, t0: 0, mph: q.velo, type: q.type, hand });
    const tMitt = path.cross(zMitt);
    // a swing meets it where it's the sweet spot's length from his hands: out in front for a pitch
    // in on him, deeper for one away, as a hitter lets an outside pitch travel; the swing for its
    // height there. What the plane can't do, his hands do (the bat layer's reach).
    let tBat = path.cross(zBat), swing = null;
    if (q.result === 'swinging' || contact) {
      swing = swingFor(path(tBat)[1]);
      for (let pass = 0; pass < 2; pass++) {
        const knob = knobAt(swing);
        let best = tBat, err = Infinity;
        for (let z = zBat - 0.4; z <= zBat + 2.0 + 1e-9; z += 0.05) {
          const tz = path.cross(z);
          if (tz == null) continue;
          const e = Math.abs(Math.hypot(...path(tz).map((v, k) => v - knob[k])) - SWEET_SPOT);
          if (e < err) { err = e; best = tz; }
        }
        tBat = best;
        const again = swingFor(path(tBat)[1]);
        if (again === swing) break;
        swing = again;
      }
    }
    const atMitt = path(tMitt);
    // the catcher's clip: the block for a ball in the dirt that gets to him, the receive otherwise
    const caught = !contact && !hbp;
    const clip = caught && atMitt[1] < recv.events[0].reach.y[0] ? blk : recv;
    const box = clip.events.find((e) => e.kind === 'catch');
    // he sets up across from it, so the ball comes into his clip's box
    const setupX = caught ? clamp(clamp(0, atMitt[0] - box.reach.x[1], atMitt[0] - box.reach.x[0]), -0.8, 0.8) : 0;
    return {
      q, path, hbp, contact, caught, tBat, tMitt, atMitt, through, swing, catchClip: clip, catchT: box.t, setupX,
      // when it's decided, from the release: the bat, the batter or the mitt
      decided: hbp ? path.T : contact ? tBat : tMitt,
    };
  });
  const S = {
    p, cast, pitches, who, P, C, H, U, hand, bats, windup, tempo, delivery, from, zBat, zMitt, shapes,
    // where his front foot lands and the hitter's back foot digs in (marks.js)
    stride: strideOf(W, P.slot, delivery, hand), dig: digOf(W, H.slot, bats),
    REL: eventTime(delivery, 'release') / tempo, MOTION: (windup ? 0 : 0.3) / tempo,
    setLen: windup ? PACE.windupHold : CLIPS.pitch_set.duration / tempo,
    retCatch: eventTime(CLIPS.pitch_return, 'catch') / tempo, retDur: CLIPS.pitch_return.duration / tempo,
    throwRel: eventTime(CLIPS.catch_throwback, 'release'),
    umpStyle: PUNCHOUTS[hashStr('ump:' + (p.fieldingTeam || '') + '|' + (p.battingTeam || '') + '|' + (p.inning | 0)) % PUNCHOUTS.length],
  };
  // a ball in play: the play worked out with the last pitch released at 0, for how long it runs
  const last = shapes[shapes.length - 1];
  if (last.q.result === 'inplay' && p.play) {
    const probe = planPlay(playCtx(S, 0, -1));
    if (probe) S.playSpan = probe.landAt - last.tBat;
  }
  return S;
}

// What plays.js needs to plan the ball in play off the last pitch released at `tRel` and cut in at
// `tIn`: the battery and the hitter as the world has them, and the clips the pitcher and catcher
// are in when it's hit.
// A world body as the planners take it.
const whoOf = (b) => ({ slot: b.slot, id: b.id, at: b.at.slice(), yaw: b.yaw, mirror: b.mirror, scale: b.scale });
function playCtx(S, tRel, tIn) {
  const sh = S.shapes[S.shapes.length - 1];
  return {
    p: S.p, cast: S.cast, tIn, tBat: tRel + sh.tBat, at: sh.path(sh.tBat),
    pitcher: { ...whoOf(S.P), clip: S.delivery.id, start: tRel - S.REL, speed: S.tempo },
    catcher: { ...whoOf(S.C), at: [CATCHER_AT[0] + sh.setupX, CATCHER_AT[1], CATCHER_AT[2]], clip: sh.catchClip.id, start: tRel + sh.tMitt - sh.catchT, speed: 1 },
    batter: whoOf(S.H),
  };
}

// The umpire's clip after a pitch, and how long after it's decided he starts it.
function callOf(S, i) {
  const q = S.pitches[i], last = i === S.pitches.length - 1;
  if (q.result === 'called') return { clip: last && S.p.kind === 'strikeout' ? S.umpStyle : 'ump_strike', after: 0.18 };
  if (q.result === 'foul') return { clip: 'ump_foul', after: 0.25 };
  if (q.result === 'hbp') return { clip: 'ump_dead', after: 0.15 };
  return { clip: 'ump_rise', after: q.result === 'inplay' ? 0.3 : 0.18 };
}

// From the last pitch's being decided to the play's landing, by how the at-bat ended.
function terminalOf(S) {
  const i = S.pitches.length - 1, q = S.pitches[i], kind = S.p.kind;
  if (kind === 'strikeout' && q.result === 'called') { const c = callOf(S, i); return c.after + eventTime(CLIPS[c.clip], 'call'); }
  if (kind === 'strikeout') return 0.2;
  if (kind === 'walk') return 0.4;
  if (kind === 'hitbypitch') return 0.1;
  if (q.result === 'inplay') return S.playSpan ?? flightOf(kind);
  return 0.5;
}

// Every time in the at-bat, for a choice of views, starting at t0: when each pitch cuts in, when
// the ritual and the set start, the release, when it's decided, and when the play lands. One
// pitch's view is { show, lead: 'quick' | 'core' | 'set', react, ritual }.
function timeline(S, views, t0 = 0) {
  const list = [];
  let cursor = t0, prev = null;
  S.pitches.forEach((q, i) => {
    const v = views[i], sh = S.shapes[i], last = i === S.pitches.length - 1;
    if (!v.show) { list.push({ i, show: false, tIn: cursor }); prev = null; return; }
    const T = { i, show: true, tIn: cursor, ritual: false };
    // the throw back: from the end of the catcher's last catch to the pitcher's glove as he takes it
    // in his walk back, which ends on the rubber where the set starts
    let tSet = cursor;
    if (v.ritual && prev) {
      const arrive = Math.max(prev.catcherFree + 0.05 + S.throwRel + PACE.lob, cursor + PACE.ritualIn);
      Object.assign(T, { ritual: true, throwStart: arrive - PACE.lob - S.throwRel, lobAt: arrive - PACE.lob, arrive, retStart: arrive - S.retCatch });
      tSet = T.retStart + S.retDur;
    }
    T.tSet = tSet;
    T.tRel = v.lead === 'quick' ? cursor + PACE.quick : v.lead === 'core' ? cursor + S.REL - S.MOTION : tSet + S.setLen + S.REL;
    T.pStart = T.tRel - S.REL;
    T.decided = T.tRel + sh.decided;
    T.tCatch = T.tRel + sh.tMitt;
    T.tBat = T.tRel + sh.tBat;
    T.catcherFree = T.tCatch - sh.catchT + sh.catchClip.duration;
    T.after = last ? terminalOf(S) : v.react ? PACE.react : PACE.after;
    cursor = T.decided + T.after;
    list.push(T);
    prev = T;
  });
  const end = list[list.length - 1];
  return { list, landAt: end.decided + end.after, t0 };
}

// How each pitch is shown, given the at-bat and the budget, in the plan's order (see the top of
// the file). Pure arithmetic over the clips' own timings and the pitches' flights.
function planViews(S, budget, lead = 0) {
  const N = S.pitches.length;
  const views = S.pitches.map(() => ({ show: true, lead: 'quick', react: false, ritual: false }));
  const total = () => timeline(S, views, PACE.in + lead).landAt;
  // the last pitch, the first, then the rest from the end
  const order = [N - 1, 0, ...Array.from({ length: Math.max(0, N - 2) }, (_, k) => N - 2 - k)].filter((i, k, a) => i >= 0 && a.indexOf(i) === k);
  // a long at-bat on a short hold: pitches out of the middle, from the end, until the rest fit,
  // and the first one too for a play that needs the time
  for (let i = N - 2; i >= 1 && total() > budget + 1e-9; i--) views[i].show = false;
  if (N > 1 && total() > budget + 1e-9) views[0].show = false;
  const fuller = (i, k, val) => { const was = views[i][k]; views[i][k] = val; if (total() > budget + 1e-9) views[i][k] = was; };
  for (const i of order) if (i < N - 1 && views[i].show) fuller(i, 'react', true);
  for (const i of order) if (views[i].show) fuller(i, 'lead', 'core');
  for (const i of [0, ...order.filter((x) => x !== 0)]) if (views[i].show) fuller(i, 'lead', 'set');
  for (const i of order) if (i > 0 && views[i].show && views[i].lead === 'set' && views[i - 1].show) fuller(i, 'ritual', true);
  return views;
}

// A plan (plays.js, runs.js) on the world's clock: the bodies placed at the cut in and every clip at
// its time, the glove reaching for the ball at each catch, every head on the ball, the ball and the
// hands it rides in, the cuts and the sounds. `h` is the director's { play, cut, sound }.
function stagePlan(W, plan, tIn, h) {
  stageBodiesOf(W, plan.bodies, tIn, h.play);
  for (const r of plan.reaches) W.at(Math.max(tIn, r.from - 0.02), () => W.layer(r.slot, 'reach', { hand: r.hand, kind: r.kind, target: r.target, follow: r.follow, from: r.from, full: r.full, hold: r.hold, to: r.to }));
  // every head on the field asks where the ball is each frame: once a frame is enough
  let seen = null, seenAt = NaN;
  const ballNow = (t) => { if (t !== seenAt) { seenAt = t; seen = W.ballAt(t) || seen; } return seen; };
  for (const l of plan.looks) W.at(Math.max(tIn, l.from - 0.02), () => W.layer(l.slot, 'look', { target: ballNow, from: l.from, full: l.full, hold: l.hold, to: l.to }));
  for (const b of plan.balls) {
    const fn = b.path || ((t) => { const Q = W.pose(b.hold.slot, t, { look: false }); return Q ? toPark(Q, handPoint(Q, b.hold.hand, b.hold.kind, Q.scale)) : b.at; });
    W.at(b.from, () => W.setBall(fn));
  }
  for (const c of plan.cuts) h.cut(c.at, c.shot);
  for (const x of plan.sounds) h.sound(x.at, x.cue);
  if (h.mark) for (const m of scarsOf(plan.bodies, h.salt)) h.mark(m);
}
// Planned bodies (plays.js, bases.js, runs.js): those to be placed placed at the cut in, and every
// clip played at its time from its frame (a body's prior clip is already the director's).
function stageBodiesOf(W, bodies, tIn, play) {
  for (const B of bodies) {
    if (B.place) W.at(tIn, () => { W.place(B.slot, { id: B.id, role: B.role, at: B.base.at, yaw: B.base.yaw, scale: B.scale, mirror: B.mirror }); W.clearLayers(B.slot); });
    for (const e of B.clips) {
      if (e.prior) continue;
      play({ slot: B.slot, role: B.role }, e.clip, e.issue ?? e.from ?? e.start, e.start, { speed: e.speed, fade: e.fade, frame: e.given ? e.F : undefined, from: e.from, carry: e.carry });
    }
  }
}

// ── staging ────────────────────────────────────────────────────────────────────
// `opts.onLand()` when the play lands; `opts.emit(name, data)` for what the view shows and plays:
// 'shot' (a camera by name, diamond/camera.js), 'pitch' ({ i, pitch } as each pitch is decided,
// for the count and the graphics) and 'sound' (a cue in client/shared/deadball-sfx.js, on the
// moment: the mitt's pop, the bat's crack, a miss's whiff, the ball into a glove).
export function createDirector(W, opts = {}) {
  const emit = (n, d) => opts.emit?.(n, d);
  // `fx`: the payload's spectacle (diamond/spectacle.js), which the view hands the renderer
  const D = { log: [], played: [], views: null, landed: true, landAt: 0, until: 0, t0: 0, budget: 0, payload: null, fx: [], marks: [], queued: new Map(), drags: [], crew: null };
  // the last clip the director has queued for each body (`D.queued`, by slot: { clip, at, start,
  // speed, frame }), so the dead time starts each man from what he'll be doing, not what he's doing
  // now: a strikeout's walk off starts after the call's landed
  const queue = (slot, clip, at, start, speed, frame) => {
    const q = D.queued.get(slot);
    if (!q || at >= q.at) D.queued.set(slot, { clip, at, start, speed, frame });
  };
  // a mark in the dirt (marks.js), said as it's made and kept for the gate
  const mark = (m) => { D.marks.push(m); W.at(m.t, () => emit('mark', m)); };
  // the marks a pitch leaves: the hitter's back foot dug in as it cuts in, the stride as it lands
  const pitchMarks = (S, salt, i, tIn, tStride) => {
    if (S.dig) mark({ t: tIn, kind: 'dig', i, at: S.dig.at, dir: S.dig.dir, seed: hashStr(`dig|${salt}|${i}`) });
    if (S.stride) mark({ t: tStride, kind: 'stride', i, at: S.stride.at, dir: S.stride.dir, seed: hashStr(`stride|${salt}|${i}`) });
  };

  // `o.cutaway`: the picture disagrees with this payload (pictureAfter), so it opens on the wide
  // shot while everyone takes their places; 'street', the game's first at-bat, on the main gate from
  // the street (shorter where the at-bat needs the time, and the wide shot under PACE.streetMin).
  // `o.motion` false: the viewer has asked for less motion, so no camera rides with a home run and
  // nothing bursts or sparks.
  D.stage = (p, cast = castOf(p), o = {}) => {
    D.payload = p; D.cast = cast; D.log = []; D.played = []; D.views = null; D.landed = false; D.play = null; D.trot = null; D.inningOver = false; D.fx = []; D.marks = []; D.between = null; D.queued = new Map(); D.drags = []; D.crew = null; D.opening = null;
    W.clearQueue();
    const motion = o.motion !== false;
    if (p?.phase === 'run') { stageRun(p, cast, o); return; }
    const S = prepare(W, p, cast || []);
    if (!S) { D.landed = true; D.landAt = D.until = W.t; opts.onLand?.(); return; }
    // the cutaway gives way to the play: shortened where the at-bat can't fit round it, and left
    // out (`squeezed`) where even a third of a second won't fit
    const budget = budgetOf(p);
    let lead = o.cutaway ? (o.cutaway === 'street' ? PACE.street : PACE.cutaway) : 0, views = planViews(S, budget, lead);
    const over = timeline(S, views, PACE.in + lead).landAt - budget;
    if (lead && over > 0) {
      lead = lead - over >= 0.3 ? lead - over : 0;
      views = planViews(S, budget, lead);
    }
    const t0 = W.t + PACE.in + lead;
    D.views = views;
    const TL = timeline(S, views, t0);
    // the shortest this at-bat can be: its last pitch and what comes of it, from the cut in
    const floor = timeline(S, S.pitches.map((q, i) => ({ show: i === S.pitches.length - 1, lead: 'quick', react: false, ritual: false })), PACE.in).landAt;
    const opening = lead ? (o.cutaway === 'street' && lead >= PACE.streetMin ? 'street' : 'sky') : null;
    Object.assign(D, { t0, budget, floor, landAt: TL.landAt, cutaway: !!lead, opening, squeezed: !!o.cutaway && !lead });
    if (lead) W.at(W.t, () => emit('shot', opening));
    const { P, C, H, U, tempo, delivery, hand, bats, from } = S;
    const side = sideShot(bats);
    let until = TL.landAt + 0.5;
    onDeck(cast, W.t, TL.landAt, `${p.batter}|${p.inning}|${p.half}`);
    // a clip started at world time `start`, from the moment `at` (a cut can come in on one already
    // under way); noted for the gate
    const play = (b, clipId, at, start = at, o = {}) => {
      if (!b) return;
      const speed = o.speed || 1;
      until = Math.max(until, start + CLIPS[clipId].duration / speed);
      queue(b.slot, clipId, at, start, speed, o.frame);
      W.at(at, () => { W.play(b.slot, clipId, { at: start, speed, fade: o.fade, frame: o.frame, from: o.from, carry: o.carry }); D.played.push({ t: at, role: b.role, slot: b.slot, clip: clipId, start }); });
    };
    const cut = (at, shot) => W.at(at, () => emit('shot', shot));
    // the ball on a path until `end`, when it's gone unless something else has it by then
    const ballFor = (path, end) => { W.setBall(path); W.at(end, () => { if (W.ball === path) W.setBall(null); }); };
    const count = (at, i) => W.at(at, () => emit('pitch', { i, pitch: S.pitches[i] }));
    const sound = (at, cue) => W.at(at, () => emit('sound', cue));
    const salt = `${p.batter}|${p.inning}|${p.half}`;
    let skipped = [];

    TL.list.forEach((T) => {
      const i = T.i, q = S.pitches[i], sh = S.shapes[i], v = views[i], last = i === S.pitches.length - 1;
      if (!T.show) { skipped.push(i); D.log.push({ i, n: q.n ?? i + 1, result: q.result, shown: false }); return; }
      // a pitch left out goes on the count, and leaves its marks, as the next one cuts in
      for (const k of skipped) { count(T.tIn, k); pitchMarks(S, salt, k, T.tIn, T.tIn); }
      skipped = [];
      pitchMarks(S, salt, i, T.tIn, T.pStart + (S.stride?.tau ?? 0) / tempo);
      const path = pitchPath({ from, through: sh.through, t0: T.tRel, mph: q.velo, type: q.type, hand });
      const ballOr = (end) => (t) => (t < T.tRel ? from : path(Math.min(t, end)));

      // ── the cut in: everyone where this pitch has them ──
      cut(T.tIn, T.ritual ? 'mound' : 'bat');
      W.at(T.tIn, () => {
        for (const b of [P, C, H, U]) if (b) W.clearLayers(b.slot);
        // the catcher sets up across from where it's coming, while nobody's looking
        C.at = [CATCHER_AT[0] + sh.setupX, CATCHER_AT[1], CATCHER_AT[2]];
        if (!T.ritual) W.setBall(null);
      });
      // the pitcher: the walk back and the set, or straight into his motion
      if (T.ritual) {
        play(P, 'pitch_return', T.retStart, T.retStart, { speed: tempo });
        cut(T.tSet, 'bat');
      }
      if (v.lead === 'set' && !S.windup) play(P, 'pitch_set', T.tSet, T.tSet, { speed: tempo });
      play(P, delivery.id, v.lead === 'set' ? (S.windup ? T.tSet : T.pStart) : T.tIn, T.pStart, { speed: tempo });
      // the catcher: the throw back (seen from the hitter's camera, or off it), the signs ending on
      // his target as the pitcher starts, then the receive or the block, lined up on the ball
      if (T.ritual) {
        play(C, 'catch_throwback', T.throwStart, T.throwStart, { fade: 0.25 });
        // out of the catcher's right hand as he lets it go, into the pitcher's glove as he takes it
        W.at(T.lobAt, () => {
          const cj = solvePose(W.pose(C.slot, T.lobAt)).J;
          const glove = hand === 'L' ? 'R' : 'L', pj = solvePose(W.sample(P.slot, 'pitch_return', eventTime(CLIPS.pitch_return, 'catch'))).J;
          ballFor(throwPath(add(cj.wrR, mul(cj.hdirR, 0.2)), add(pj['wr' + glove], mul(pj['hdir' + glove], 0.3)), T.lobAt, PACE.lob), T.arrive + 0.02);
        });
        sound(T.arrive, 'glove');
      }
      const tReady = T.tCatch - sh.catchT;
      const signEnd = Math.min(tReady, T.pStart + S.MOTION + 0.2);
      play(C, 'catch_sign', Math.max(T.tIn, T.ritual ? T.throwStart + CLIPS.catch_throwback.duration : T.tIn), signEnd - CLIPS.catch_sign.duration);
      play(C, sh.catchClip.id, Math.max(T.tIn, tReady), tReady);
      if (sh.caught) {
        const box = sh.catchClip.events.find((e) => e.kind === 'catch');
        W.at(Math.max(T.tIn, T.tCatch - 0.3), () => W.layer(C.slot, 'reach', { hand: 'L', kind: 'mitt', target: sh.atMitt.slice(), follow: box.reach.follow, from: T.tCatch - 0.28, full: T.tCatch - 0.005, hold: T.tCatch + 0.3, to: T.tCatch + 0.7 }));
      }
      W.at(T.tIn, () => W.layer(C.slot, 'look', { target: ballOr(T.decided), from: T.tRel - 0.5, full: T.tRel - 0.2, hold: T.decided + 0.1, to: T.decided + 0.5 }));

      // the hitter: the stance, the load, then the take, the swing or the flinch
      const tLoad = T.tRel - 0.6;
      if (T.tIn < tLoad) play(H, 'bat_stance', T.tIn, T.tIn);
      play(H, 'bat_load', Math.max(T.tIn, tLoad), tLoad, { fade: T.tIn < tLoad ? 0.15 : 0 });
      W.at(T.tIn, () => W.layer(H.slot, 'look', { target: ballOr(T.decided), from: T.tRel - 0.5, full: T.tRel - 0.15, hold: T.decided, to: T.decided + 0.45 }));
      let swing = null;
      if (sh.hbp) {
        play(H, 'bat_hbp', T.decided - eventTime(CLIPS.bat_hbp, 'hit'), T.decided - eventTime(CLIPS.bat_hbp, 'hit'));
      } else if (sh.swing) {
        const atBat = path(T.tBat);
        swing = CLIPS[sh.swing];
        // a miss is a touch early or late, and the bat goes over or under it
        const miss = q.result === 'swinging';
        const off = miss ? ((hashStr('sw' + i + p.batter) & 1) ? 0.03 : -0.03) : 0;
        const start = T.tBat - eventTime(swing, 'contact') + off;
        play(H, swing.id, start, start);
        const aim = [atBat[0], atBat[1] + (miss ? (atBat[1] < 2.5 ? 0.38 : -0.38) : 0), atBat[2]];
        W.at(start, () => W.layer(H.slot, 'aim', { target: aim, reach: 1.25, follow: 1.5, from: T.tBat - 0.1, full: T.tBat - 0.01, hold: T.tBat + 0.02, to: T.tBat + 0.12 }));
      } else {
        const check = (q.result === 'ball' || q.result === 'called') && hashStr('ck' + i + p.batter) % 4 === 0;
        play(H, check ? 'bat_check' : 'bat_take', T.tRel + 0.1, T.tRel + 0.1);
      }

      // the umpire: set, following it in, then his call
      if (U) {
        play(U, 'ump_set', T.tIn, T.tIn);
        W.at(T.tIn, () => W.layer(U.slot, 'look', { target: ballOr(T.decided), from: T.tRel - 0.4, full: T.tRel - 0.1, hold: T.decided + 0.1, to: T.decided + 0.5 }));
      }
      const call = callOf(S, i), uAt = T.decided + call.after;
      play(U, call.clip, uAt, uAt, { fade: 0.12 });

      // the ball: out of the hand at the release, on its path, into the mitt, off the bat or off him
      W.at(T.tRel, () => ballFor(path, sh.caught ? T.tCatch + 0.02 : T.decided + 0.02));
      const rec = {
        i, n: q.n ?? i + 1, result: q.result, shown: true, view: { ...v }, tIn: T.tIn, release: T.tRel, decided: T.decided,
        from, through: sh.through, path, tPlate: sh.hbp ? null : path.cross(0.7), call: { clip: call.clip, t: uAt + (eventTime(CLIPS[call.clip], 'call') ?? 0) },
      };
      rec.plateAt = rec.tPlate != null ? path(rec.tPlate) : null;
      if (sh.contact) {
        // off the bat: back over the screen for a foul, out into the park for a ball in play,
        // played out where the payload says (plays.js)
        const at = path(T.tBat);
        const plan = last && q.result === 'inplay' && S.playSpan != null ? planPlay({ ...playCtx(S, T.tRel, T.tIn), motion }) : null;
        if (plan) {
          stagePlay(plan, T);
          rec.play = plan;
          // the tail on a ball hit hard or out, the sparks off the bat, the fireworks once it's gone
          D.fx = planSpectacle({ p, tBat: T.tBat, at, path: plan.balls[0]?.path, end: plan.balls[1]?.from, landAt: plan.landAt, motion });
        } else {
          const dir = q.result === 'foul' ? norm([(hashStr('f' + i + p.batter) & 1) ? 0.35 : -0.35, 0.75, -0.55]) : dirFor(p.kind, hashStr('ip' + p.batter + i));
          const out = hitPath(at, dir, q.result === 'foul' ? 70 : 95, T.tBat);
          W.at(T.tBat, () => ballFor(out, q.result === 'foul' ? T.tBat + 1.2 : TL.landAt + 0.5));
        }
        sound(T.tBat, 'crack');
        rec.contact = { t: T.tBat, at, swing: swing.id };
      } else if (sh.hbp) {
        const at = path(T.decided);
        rec.hit = { t: T.decided, at };
        W.at(T.decided, () => ballFor(throwPath(at, [at[0] + (H.at[0] > 0 ? -2.5 : 2.5), BALL_R, at[2] + 3], T.decided, 0.55), T.decided + 0.6));
        sound(T.decided, 'glove');
      } else {
        rec.catch = { t: T.tCatch, at: sh.atMitt, clip: sh.catchClip.id, setupX: sh.setupX };
        if (swing) { rec.swing = { t: T.tBat, clip: swing.id }; sound(T.tBat, 'whiff'); }
        sound(T.tCatch, 'mitt');
      }
      count(last ? Math.min(T.decided + 0.15, TL.landAt) : T.decided + 0.15, i);
      D.log.push(rec);

      // ── after it: the reaction, or the at-bat's end ──
      if (!last) {
        if (v.react) cut(T.decided + PACE.reactCut, side);
        return;
      }
      const kind = p.kind;
      if (kind === 'strikeout') {
        cut(T.decided + (q.result === 'called' ? 0.25 : 0.35), side);
        const walkOff = T.decided + (q.result === 'called' ? 0.9 : 0.6);
        play(H, 'bat_strikeout', walkOff, walkOff, { fade: 0.35 });
      } else if (kind === 'walk') {
        cut(T.decided + 0.35, side);
        play(H, 'bat_walk', T.tRel + 1.3, T.tRel + 1.3, { fade: 0.1 });
      } else if (kind === 'hitbypitch') {
        cut(T.decided + 0.3, side);
      }
      // ball four or a hit batsman: he trots to first and every man forced trots up a bag, after
      // the landing (bases.js planTrot)
      if (kind === 'walk' || kind === 'hitbypitch') {
        const clip = kind === 'walk' ? 'bat_walk' : 'bat_hbp', start = kind === 'walk' ? T.tRel + 1.3 : T.decided - eventTime(CLIPS.bat_hbp, 'hit');
        const trot = planTrot({ p, cast: S.cast, tIn: T.tIn, batter: whoOf(H) }, { clip, start, tFour: T.decided });
        stageBodies(trot.bodies, T);
        rec.trot = D.trot = trot;
      }
      W.at(TL.landAt, () => { if (!D.landed) { D.landed = true; opts.onLand?.(); } });
    });
    // the third out: once it's landed, everyone off the field, and the picture wide to see them go
    // (after they've set off, so a man who was a still starts running off the screen)
    D.inningOver = (p.outs | 0) >= 3 && !p.walkoff;
    if (D.inningOver) {
      W.at(TL.landAt + 0.6, () => offField(p, cast, W.t + 0.05));
      cut(TL.landAt + 1.4, 'high');
      until = Math.max(until, TL.landAt + 1.5);
    }
    // a walk-off without a ball out of the park still gets its fireworks
    if (!D.fx.length && p.walkoff) D.fx = planSpectacle({ p, landAt: TL.landAt, motion });
    until = Math.max(until, fireworks(D.fx, cut));
    D.until = until;

    function stagePlay(plan, T) { D.play = plan; stagePlan(W, plan, T.tIn, { play, cut, sound, mark, salt }); }
    function stageBodies(bodies, T) { stageBodiesOf(W, bodies, T.tIn, play); }
  };

  // ── a play on the bases ──
  // A run payload (sim v2's steals, throws over and wild pitches): the pitch it's made on, thrown
  // from the stretch as an at-bat's are, and the play round it (runs.js planRun). A steal's
  // delivery is played at the tempo that gets the ball to the mitt on the card's time to the plate.
  function stageRun(p, cast, o) {
    // a throw over has no pitch: the stand-in just puts the battery where a pitch would have them
    const over = p.kind === 'throwover' || p.kind === 'pickoff';
    const q = runPitch(p) || { n: 0, result: 'ball', type: 'four-seam fastball', velo: 90, x: 0.5, y: 0.5 };
    const S = prepare(W, { ...p, pitches: [q] }, cast || []);
    if (!S) { D.landed = true; D.landAt = D.until = W.t; opts.onLand?.(); return; }
    const lead = o.cutaway ? PACE.cutaway : 0, t0 = W.t + PACE.in + lead;
    const sh = S.shapes[0], { P, C, H, U, delivery, from, hand } = S;
    const tempo = Number.isFinite(p.plate) ? tempoFor(delivery, p.plate, sh.tMitt) : S.tempo;
    const rand = (k) => (hashStr(`${p.batter}|${p.inning}|${p.half}|${p.kind}|run:${k}`) % 10007) / 10007;
    // he's coming set as it cuts in, holds it a beat and goes: to the plate, or over to first
    const tFirst = t0 + 1.6 + 0.6 * rand('hold'), pStart = tFirst - FIRST_MOVE / tempo;
    const tRel = pStart + eventTime(delivery, 'release') / tempo, tMitt = tRel + sh.tMitt;
    const path = pitchPath({ from, through: sh.through, t0: tRel, mph: q.velo, type: q.type, hand });
    if (over) return stageThrowOver(p, cast, S, t0, lead, tFirst, rand);
    let until = tMitt + 1;
    const play = (b, clipId, at, start = at, oo = {}) => {
      if (!b) return;
      const speed = oo.speed || 1;
      until = Math.max(until, start + CLIPS[clipId].duration / speed);
      queue(b.slot, clipId, at, start, speed, oo.frame);
      W.at(at, () => { W.play(b.slot, clipId, { at: start, speed, fade: oo.fade, frame: oo.frame, from: oo.from, carry: oo.carry }); D.played.push({ t: at, role: b.role, slot: b.slot, clip: clipId, start }); });
    };
    const cut = (at, shot) => W.at(at, () => emit('shot', shot));
    const sound = (at, cue) => W.at(at, () => emit('sound', cue));
    if (lead) W.at(W.t, () => emit('shot', 'sky'));
    cut(t0, 'bat');
    onDeck(cast, W.t, tMitt + 1, `${p.batter}|${p.inning}|${p.half}|${p.kind}`);
    const setup = [CATCHER_AT[0] + sh.setupX, CATCHER_AT[1], CATCHER_AT[2]];
    W.at(t0, () => { for (const b of [P, C, H, U]) if (b) W.clearLayers(b.slot); C.at = setup.slice(); W.setBall(null); });
    play(P, 'pitch_set', t0, t0 - 1.0);
    play(P, delivery.id, pStart, pStart, { speed: tempo });
    // the catcher's signs, done as the pitcher comes set; the plan has him from there
    const signStart = Math.min(tMitt - 0.6, pStart + 0.2) - CLIPS.catch_sign.duration;
    play(C, 'catch_sign', t0, signStart);
    const ballOr = (t) => (t < tRel ? from : path(Math.min(t, tMitt)));
    W.at(t0, () => W.layer(C.slot, 'look', { target: ballOr, from: tRel - 0.5, full: tRel - 0.2, hold: tMitt + 0.1, to: tMitt + 0.5 }));
    // the hitter takes it; the umpire follows it in and comes up to watch
    play(H, 'bat_stance', t0, t0);
    play(H, 'bat_load', tRel - 0.6, tRel - 0.6, { fade: 0.15 });
    play(H, 'bat_take', tRel + 0.1, tRel + 0.1);
    if (U) {
      play(U, 'ump_set', t0, t0);
      W.at(t0, () => W.layer(U.slot, 'look', { target: ballOr, from: tRel - 0.4, full: tRel - 0.1, hold: tMitt + 0.1, to: tMitt + 0.5 }));
      play(U, 'ump_rise', tMitt + 0.35, tMitt + 0.35, { fade: 0.15 });
    }
    W.at(tRel, () => W.setBall(path));
    // a steal's pitch is caught; one that gets by makes its own sounds (runs.js)
    const by = p.kind === 'wildpitch' || p.kind === 'passedball';
    if (!by) sound(tMitt, 'mitt');
    const box = sh.catchClip.events.find((e) => e.kind === 'catch').reach;
    const ctx = {
      p, cast: S.cast, tIn: t0,
      pitcher: { ...whoOf(P), clip: delivery.id, start: pStart, speed: tempo },
      catcher: { ...whoOf(C), at: setup, clip: 'catch_sign', start: signStart, speed: 1 },
      batter: whoOf(H),
    };
    const plan = planRun(ctx, { tFirst, tRel, tMitt, atMitt: sh.atMitt, box, path, from, pitch: q, hand });
    const salt = `${p.batter}|${p.inning}|${p.half}|${p.kind}`;
    pitchMarks(S, salt, 0, t0, pStart + (S.stride?.tau ?? 0) / tempo);
    if (plan) { D.play = plan; stagePlan(W, plan, t0, { play, cut, sound, mark, salt }); }
    const landAt = plan ? plan.landAt : tMitt + 0.8;
    Object.assign(D, { t0, budget: budgetOf(p), floor: landAt - W.t, landAt, cutaway: !!lead, squeezed: false });
    D.log.push({ i: 0, n: 0, result: q.result, shown: true, run: true, release: tRel, from, through: sh.through, path, tFirst, tempo, tPlate: path.cross(0.7), catch: { t: tMitt, at: sh.atMitt, setupX: sh.setupX }, play: plan });
    W.at(landAt, () => { if (!D.landed) { D.landed = true; opts.onLand?.(); } });
    // the third out on the bases: everyone off, as after an at-bat's
    D.inningOver = (p.outs | 0) >= 3 && !p.walkoff;
    if (D.inningOver) {
      W.at(landAt + 0.6, () => offField(p, cast, W.t + 0.05));
      cut(landAt + 1.4, 'high');
      until = Math.max(until, landAt + 1.5);
    }
    // a run home on a pitch that got by can win it
    if (p.walkoff) { D.fx = planSpectacle({ p, landAt, motion: o.motion !== false }); until = Math.max(until, fireworks(D.fx, cut)); }
    D.until = Math.max(until, landAt + 0.5);
  }
  // A throw over: he comes set and, instead of pitching, turns and throws to first (runs.js). The
  // high camera from home has the pitcher and the man leading off in the one shot.
  function stageThrowOver(p, cast, S, t0, lead, tMove, rand) {
    const { P, C, H, U } = S;
    let until = tMove + 2;
    const play = (b, clipId, at, start = at, oo = {}) => {
      if (!b) return;
      const speed = oo.speed || 1;
      until = Math.max(until, start + CLIPS[clipId].duration / speed);
      queue(b.slot, clipId, at, start, speed, oo.frame);
      W.at(at, () => { W.play(b.slot, clipId, { at: start, speed, fade: oo.fade, frame: oo.frame, from: oo.from, carry: oo.carry }); D.played.push({ t: at, role: b.role, slot: b.slot, clip: clipId, start }); });
    };
    const cut = (at, shot) => W.at(at, () => emit('shot', shot));
    const sound = (at, cue) => W.at(at, () => emit('sound', cue));
    if (lead) W.at(W.t, () => emit('shot', 'sky'));
    cut(t0, 'high');
    W.at(t0, () => { for (const b of [P, C, H, U]) if (b) W.clearLayers(b.slot); C.at = CATCHER_AT.slice(); W.setBall(null); });
    play(P, 'pitch_set', t0, t0 - 1.0);
    play(C, 'catch_sign', t0, t0 - 0.4);
    play(H, 'bat_stance', t0, t0);
    if (U) play(U, 'ump_set', t0, t0);
    const ctx = {
      p, cast: S.cast, tIn: t0,
      pitcher: { ...whoOf(P), clip: 'pitch_set', start: t0 - 1.0, speed: 1 },
      catcher: { ...whoOf(C), at: CATCHER_AT.slice(), clip: 'catch_sign', start: t0 - 0.4, speed: 1 },
      batter: whoOf(H),
    };
    const plan = planRun(ctx, { tMove });
    if (plan) { D.play = plan; stagePlan(W, plan, t0, { play, cut, sound, mark, salt: `${p.batter}|${p.inning}|${p.half}|${p.kind}` }); }
    const landAt = plan ? plan.landAt : tMove + 1.5;
    Object.assign(D, { t0, budget: budgetOf(p), floor: landAt - W.t, landAt, cutaway: !!lead, squeezed: false });
    D.log.push({ i: 0, n: 0, shown: true, run: true, over: true, tMove, play: plan });
    W.at(landAt, () => { if (!D.landed) { D.landed = true; opts.onLand?.(); } });
    D.inningOver = (p.outs | 0) >= 3 && !p.walkoff;
    if (D.inningOver) {
      W.at(landAt + 0.6, () => offField(p, cast, W.t + 0.05));
      cut(landAt + 1.4, 'high');
      until = Math.max(until, landAt + 1.5);
    }
    D.until = Math.max(until, landAt + 0.5);
  }


  // ── the changeover ──
  // A half payload: the side taking the field runs out from its dugout (bases.js planTakeField),
  // the catcher to the plate and the pitcher to the rubber, and the pitcher throws his warm-ups,
  // the ball into the catcher's mitt and back. Nothing lands: there's no play. In the middle of the
  // fifth the grounds crew drag the infield (crew.js) and the infielders come out once the mats are
  // off the dirt; the leaders' table comes down for the crew camera (a 'table' emit) and the high
  // camera has them going off. `o.motion` false holds the crew camera still.
  D.changeover = (p, cast = castOf(p), o = {}) => {
    D.payload = p; D.cast = cast; D.log = []; D.played = []; D.views = null; D.play = null; D.trot = null; D.cutaway = false; D.opening = null; D.fx = []; D.marks = []; D.drags = []; D.crew = null;
    W.clearQueue();
    for (const slot of [...W.bodies.keys()]) W.drop(slot);
    const t0 = W.t + PACE.in;
    Object.assign(D, { t0, landAt: t0, floor: 0, budget: 0, landed: true });
    let until = t0;
    const play = (slot, role, clipId, at, start = at, o = {}) => {
      const speed = o.speed || 1;
      until = Math.max(until, start + CLIPS[clipId].duration / speed);
      W.at(at, () => { W.play(slot, clipId, { at: start, speed, fade: o.fade, frame: o.frame, from: o.from, carry: o.carry }); D.played.push({ t: at, role, slot, clip: clipId, start }); });
    };
    // the crew, off the dirt in time for the infielders to be out a beat before the next payload's due
    const crew = crewDue(p) ? planCrew({ cast, t0: t0 + 1, from: t0, by: W.t + p.hold / 1000 - BETWEEN.margin, room: CREW_ROOM }) : null;
    const plan = planTakeField({ p, cast }, { t0, infield: crew ? crew.off + 0.5 : undefined });
    for (const B of [...plan.bodies, ...(crew?.bodies || [])]) {
      W.place(B.slot, { id: B.id, role: B.role, at: B.base.at, yaw: B.base.yaw, scale: B.scale, mirror: B.mirror });
      for (const e of B.clips) play(B.slot, B.role, e.clip, e.issue ?? e.from ?? e.start, e.start, { speed: e.speed, fade: e.fade, frame: e.given ? e.F : undefined, from: e.from, carry: e.carry });
    }
    if (crew) {
      const cam = crewShots(crew, { motion: o.motion });
      W.at(cam.table, () => emit('table', false));
      for (const x of cam.shots) W.at(x.at, () => emit('shot', x.shot));
      D.drags = crew.drags;
      D.crew = { drags: crew.drags, off: crew.off, done: crew.done, table: cam.table, shots: cam.shots, at: plan.at };
    }
    // the warm-ups, as many as the hold has room for
    const cP = cast.find((c) => c.look.role === 'pitcher'), cC = cast.find((c) => c.look.role === 'catcher');
    if (cP && cC && plan.at.has(cP.look.slot) && plan.at.has(cC.look.slot)) {
      const sP = cP.look.slot, sC = cC.look.slot, hand = p.throws === 'L' ? 'L' : 'R', glove = hand === 'L' ? 'R' : 'L';
      // where his release is from the rubber, sampled with him stood there a moment
      const P0 = W.bodies.get(sP), was = { at: P0.at.slice(), yaw: P0.yaw };
      W.place(sP, { at: cP.at, yaw: cP.yaw });
      const traits = P0.traits, tempo = traits?.tempo || 1, delivery = CLIPS[`pitch_windup_${traits?.armSlot || 'over'}`];
      const relJ = solvePose(W.sample(sP, delivery.id, eventTime(delivery, 'release'))).J, from = add(relJ['wr' + hand], mul(relJ['hdir' + hand], 0.2));
      const pj = solvePose(W.sample(sP, 'pitch_return', eventTime(CLIPS.pitch_return, 'catch'))).J, returnAt = add(pj['wr' + glove], mul(pj['hdir' + glove], 0.3));
      const stride = strideOf(W, sP, delivery, hand);
      W.place(sP, was);
      const REL = eventTime(delivery, 'release') / tempo, recv = CLIPS.catch_receive, box = recv.events.find((e) => e.kind === 'catch');
      const room = Number.isFinite(p.hold) ? t0 + p.hold / 1000 - 3 : t0 + 20;
      let tRel = Math.max(plan.at.get(sP) + 0.8 + REL, plan.at.get(sC) + 1.6);
      for (let k = 0; k < 4; k++) {
        const path = pitchPath({ from, through: [0, 2.55, 0.7], t0: tRel, mph: 74, type: 'FF', hand });
        const tCatch = path.cross(CATCHER_AT[2] + MITT_DZ), atMitt = path(tCatch);
        const throwStart = tCatch + 0.9, lobAt = throwStart + eventTime(CLIPS.catch_throwback, 'release'), arrive = lobAt + PACE.lob;
        const retStart = arrive - eventTime(CLIPS.pitch_return, 'catch') / tempo, done = retStart + CLIPS.pitch_return.duration / tempo;
        if (k > 0 && done > room) break;
        const setupX = clamp(clamp(0, atMitt[0] - box.reach.x[1], atMitt[0] - box.reach.x[0]), -0.8, 0.8);
        play(sP, 'pitcher', delivery.id, tRel - REL, tRel - REL, { speed: tempo, fade: 0.4, frame: { at: cP.at, yaw: cP.yaw } });
        if (stride) mark({ t: tRel - REL + stride.tau / tempo, kind: 'stride', at: stride.at, dir: stride.dir, seed: hashStr(`warm|${p.pitcher}|${p.inning}|${p.half}|${k}`) });
        play(sC, 'catcher', recv.id, tCatch - box.t, tCatch - box.t, { fade: 0.35, frame: { at: [CATCHER_AT[0] + setupX, CATCHER_AT[1], CATCHER_AT[2]], yaw: 0 } });
        W.at(tCatch - 0.3, () => W.layer(sC, 'reach', { hand: 'L', kind: 'mitt', target: atMitt.slice(), follow: box.reach.follow, from: tCatch - 0.28, full: tCatch - 0.005, hold: tCatch + 0.3, to: tCatch + 0.7 }));
        W.at(tRel, () => W.setBall(path));
        W.at(tCatch + 0.02, () => { if (W.ball === path) W.setBall(null); emit('sound', 'mitt'); });
        // back to him: out of the catcher's right hand, into his glove as he takes it walking back
        play(sC, 'catcher', 'catch_throwback', throwStart, throwStart, { fade: 0.25 });
        W.at(lobAt, () => {
          const cj = solvePose(W.pose(sC, lobAt)).J, lob = throwPath(add(cj.wrR, mul(cj.hdirR, 0.2)), returnAt, lobAt, PACE.lob);
          W.setBall(lob);
          W.at(arrive + 0.02, () => { if (W.ball === lob) W.setBall(null); });
        });
        play(sP, 'pitcher', 'pitch_return', retStart, retStart, { speed: tempo });
        D.log.push({ warmup: k, release: tRel, catch: { t: tCatch, at: atMitt }, from, lob: { t: lobAt, arrive } });
        tRel = done + 0.9 + REL;
      }
    }
    D.until = until;
  };

  // The inning's over: once the play's landed every man on the field jogs off, the side in the
  // field to its dugout and the side batting to its own, from wherever the world has him then;
  // the picture goes wide to see them go.
  function offField(p, cast, t) {
    const batting = dugoutOf(p);
    let until = D.until;
    const men = [], planned = new Map([...(D.play?.bodies || []), ...(D.trot?.bodies || [])].map((B) => [B.slot, B]));
    for (const c of cast) {
      const role = c.look.role, field = role === 'pitcher' || role === 'catcher' || role === 'fielder';
      if (!field && role !== 'batter' && role !== 'runner') continue;
      const slot = c.look.slot, b = W.bodies.get(slot);
      // a man the play planned goes on from his plan's last clip (once he's up, if it's a get-up
      // off the ground, and no sooner than the plan holds him, `offAfter`); anyone else from what
      // the world has him doing now, or a still where he stands
      const P = planned.get(slot), last = P?.clips[P.clips.length - 1];
      const B = P || (b && b.clip
        ? makeBody({ n: 50, id: b.id, slot, role, at: b.at, yaw: b.yaw, mirror: b.mirror, scale: b.scale, clip: b.clip.id, start: b.start, speed: b.speed })
        : makeBody({ n: 50, id: c.id, slot, role, at: b ? b.at : c.at, yaw: b ? b.yaw : c.yaw, mirror: c.mirror, scale: c.scale }));
      if (!b) W.place(slot, { id: c.id, role, at: c.at, yaw: c.yaw, scale: c.scale, mirror: c.mirror });
      const up = last && /^slide_up_/.test(last.clip) ? last.start + CLIPS[last.clip].duration / last.speed - 0.25 : null;
      const go = Math.max(t, up ?? (last ? onOf(last) + 0.3 : t), P?.offAfter ?? -Infinity), done = B.clips.length;
      men.push({ B, slot, side: field ? -batting : batting, go, done, at: B.spotAt(go) });
    }
    // each side's spots handed out by when the men get there: the first man in to the end of the
    // row furthest from the field, so nobody coming in after him goes by a man already stood there
    for (const side of [-1, 1]) {
      const mine = men.filter((m) => m.side === side), arrive = (m) => m.go + flat(m.at, dugoutSpotOf(side, 0)) / 13;
      mine.sort((a, b) => arrive(a) - arrive(b)).forEach((m, i) => { m.k = mine.length - 1 - i; });
    }
    // The deepest spots first. Each man after is held back a beat at a time until, standing and
    // then running, he keeps 3.5 ft clear of everyone planned before him (or, from nearer, within
    // half a foot of where they start, and never under 2.1 ft), and gets there after everyone going
    // deeper in his row; where no wait up to ten seconds does, the one that leaves him the most
    // room. Two men who start nearer than 3.5 ft, as the batter and the catcher do after a play on
    // the bases, never passed a plain 3.5 ft, and a man the one gone first went by while he stood
    // never passed at all: each stood ten seconds.
    // How close T comes to the men in `others`, less the room each needs: taken every 0.2 s, and
    // between two takes as the nearest the two come moving straight (two men crossing the diamond
    // the opposite ways close at 25 ft/s, and a pass 0.44 ft apart fell between two takes).
    const roomOf = (T, end, others) => {
      const q0 = T.frameAt(t).at, room = others.map((f) => Math.max(2.1, Math.min(3.5, flat(q0, f.B.frameAt(t).at) - 0.5)));
      let least = Infinity, was = null;
      for (let u = t, to = Math.max(end, t, ...others.map((f) => f.end + 0.5)); u <= to; u += 0.2) {
        const q = T.frameAt(u).at, rel = others.map((f) => sub(q, f.B.frameAt(u).at));
        for (let i = 0; i < others.length; i++) least = Math.min(least, nearest(was?.[i] ?? rel[i], rel[i]) - room[i]);
        was = rel;
      }
      return least;
    };
    const place = (m, others) => {
      m.B.clips.length = m.done;
      const deeper = Math.max(-Infinity, ...others.filter((g) => g.side === m.side && g.k > m.k).map((g) => g.end + 0.3));
      let wait = 0, best = null;
      for (; wait <= 10; wait += 0.4) {
        const T = cloneBody(m.B), end = jogToDugout(T, m.go + wait, m.side, m.k), room = roomOf(T, end + 0.5, others);
        if (end < deeper) continue;
        if (room >= 0) break;
        if (!best || room > best.room + 1e-9) best = { wait, room };
      }
      if (wait > 10) wait = best ? best.wait : 10;
      m.wait = wait;
      m.end = jogToDugout(m.B, m.go + wait, m.side, m.k);
    };
    const deep = men.slice().sort((a, b) => b.k - a.k), gone = [];
    for (const m of deep) { place(m, gone); gone.push(m); }
    // Then every man again, deepest first, against everyone else's plan, for as long as that leaves
    // more room (three rounds at most), keeping the round that left the most. A man planned first
    // knows nothing of the men still to go, and the first baseman's way to his dugout ran through
    // the batter, pulled up 2.7 ft from him, who was still standing there when he went by.
    const leastOf = () => Math.min(...men.map((m) => roomOf(m.B, m.end + 0.5, men.filter((x) => x !== m))));
    let kept = { least: leastOf(), waits: deep.map((m) => m.wait) };
    for (let round = 0; round < 3 && kept.least < 0; round++) {
      for (const m of deep) place(m, men.filter((x) => x !== m));
      const least = leastOf();
      if (least <= kept.least + 1e-9) break;
      kept = { least, waits: deep.map((m) => m.wait) };
    }
    for (const [i, m] of deep.entries()) {
      if (m.wait === kept.waits[i]) continue;
      m.B.clips.length = m.done;
      m.wait = kept.waits[i];
      m.end = jogToDugout(m.B, m.go + m.wait, m.side, m.k);
    }
    for (const m of men) {
      const { B, slot } = m;
      for (const e of B.clips.slice(m.done)) {
        if (e.prior) continue;
        until = Math.max(until, e.start + CLIPS[e.clip].duration / e.speed);
        W.at(e.issue ?? e.from ?? e.start, () => W.play(slot, e.clip, { at: e.start, speed: e.speed, fade: e.fade, frame: e.given ? e.F : undefined, from: e.from, carry: e.carry }));
      }
    }
    D.until = until;
  }
  D.offField = offField;

  // The on-deck hitter in his circle from t0 to t1: placed there (unless `o.place` is false, when
  // he carries on), in his stance with a practice swing now and then (between.js deckPlan), facing
  // the field as a hitter in the box does; `o.at` are times a swing's wanted.
  function onDeck(cast, t0, t1, salt, o = {}) {
    const c = (cast || []).find((x) => x.look.role === 'ondeck');
    if (!c || !(t1 > t0)) return null;
    const slot = c.look.slot, yaw = c.mirror ? 90 : -90;
    if (o.place !== false) W.at(t0, () => W.place(slot, { id: c.id, role: 'ondeck', at: c.at, yaw, scale: c.scale, mirror: c.mirror }));
    const plan = deckPlan(t0, t1, salt, o.at || []);
    for (const e of o.place === false ? plan.slice(1) : plan) {
      W.at(e.t, () => { W.play(slot, e.clip, { at: e.t, fade: e.fade }); D.played.push({ t: e.t, role: 'ondeck', slot, clip: e.clip, start: e.t }); });
    }
    return c;
  }

  // ── between at-bats ──
  // The dead time after a play's landed, till the next payload's due (`o.until`, the world's time):
  // every man the play can have moved is seeded from his plan or the world, or stood where the cast
  // has him, as offField does, and between.js puts the field back; the on-deck hitter swings on, and
  // the cameras go round from `o.from` (after a replay, if there is one), the first cut wide, so a
  // man who was a still and starts to move does it under a cut. Nothing after a third out (everyone's
  // going off) or a walk-off, or with no time to fill. Returns what it planned ({ gone, shots,
  // from, until, by }), kept as D.between.
  D.planBetween = (o = {}) => {
    const p = D.payload, cast = D.cast || [];
    if (!p || p.phase === 'half' || D.inningOver || p.walkoff || !Number.isFinite(o.until)) return null;
    const t = W.t, from = Math.max(t + BETWEEN.settle, o.from ?? -Infinity), by = o.until - BETWEEN.margin;
    if (by - from < 3) return null;
    const planned = new Map([...(D.play?.bodies || []), ...(D.trot?.bodies || [])].map((B) => [B.slot, B]));
    const men = [];
    for (const c of cast) {
      const role = c.look.role;
      if (!['pitcher', 'catcher', 'fielder', 'batter', 'runner', 'ump'].includes(role)) continue;
      const slot = c.look.slot, b = W.bodies.get(slot), P = planned.get(slot), last = P?.clips[P.clips.length - 1];
      // what the world has him doing, or what the director's queued for him after it
      const q = D.queued.get(slot), cur = b && b.clip && !(q && q.at > t) ? { clip: b.clip.id, start: b.start, speed: b.speed, frame: null } : q;
      const B = P || (b && cur
        ? makeBody({ n: 60, id: b.id, slot, role, at: cur.frame?.at ?? b.at, yaw: cur.frame?.yaw ?? b.yaw, mirror: b.mirror, scale: b.scale, clip: cur.clip, start: cur.start, speed: cur.speed })
        : makeBody({ n: 60, id: c.id, slot, role, at: b ? b.at : c.at, yaw: b ? b.yaw : c.yaw, mirror: c.mirror, scale: c.scale }));
      // free once his last clip's done (a loop or a rest at once), up off the ground once he's up
      const e = P ? last : B.clips[0], clip = e && CLIPS[e.clip];
      const done = !e ? t : clip.loop ? onOf(e) + 0.3 : e.start + clip.duration / e.speed;
      const go = !b ? from : Math.max(t, done, P?.offAfter ?? -Infinity);
      men.push({ B, slot, role, go, done: B.clips.length, still: !b, c });
    }
    const gone = planBetween({ p, cast, men, by });
    const at = new Map(gone.map((g) => [g.slot, g]));
    for (const m of men) {
      if (!at.has(m.slot)) continue;
      // a still goes into the world as the first cut comes in, where the cast stands him
      if (m.still) W.at(from, () => W.place(m.slot, { id: m.c.id, role: m.role, at: m.c.at, yaw: m.c.yaw, scale: m.c.scale, mirror: m.c.mirror }));
      for (const e of m.B.clips.slice(m.done)) {
        if (e.prior) continue;
        W.at(e.issue ?? e.from ?? e.start, () => { W.play(m.slot, e.clip, { at: e.start, speed: e.speed, fade: e.fade, frame: e.given ? e.F : undefined, from: e.from, carry: e.carry }); D.played.push({ t: e.start, role: m.role, slot: m.slot, clip: e.clip, start: e.start }); });
      }
    }
    // the cameras, and the on-deck hitter's swings with one for his shot
    const deck = cast.find((c) => c.look.role === 'ondeck');
    const rub = gone.find((g) => g.role === 'pitcher');
    const shots = shotsBetween({ from, until: by, deck: deck ? (deck.at[0] > 0 ? 'deck3' : 'deck1') : null, rubAt: rub?.end });
    for (const x of shots) W.at(x.at, () => emit('shot', x.shot));
    if (deck) onDeck(cast, t, o.until, `${p.batter}|${p.inning}|${p.half}|between`, { place: false, at: shots.filter((x) => x.swing).map((x) => x.swing) });
    W.at(from, () => W.setBall(null));
    D.until = Math.max(D.until, o.until);
    D.between = { gone, shots, from, until: o.until, by, men: men.map((m) => ({ slot: m.slot, role: m.role, still: m.still })) };
    return D.between;
  };

  // The fireworks: the wide shot over the outfield as the first shell goes up, and back to the
  // high camera once the last has burst. Returns when the last spark's out (0 for none).
  function fireworks(fx, cut) {
    const bursts = (fx || []).filter((e) => e.kind === 'burst');
    if (!bursts.length) return 0;
    const first = Math.min(...bursts.map((e) => e.t)), last = Math.max(...bursts.map((e) => e.t)), K = FX_KINDS.burst;
    cut(first - K.rise + 0.15, 'sky');
    cut(last + 1.6, 'high');
    return last + K.life * 1.22 + 0.1;
  }

  D.busy = () => !D.landed || W.t < D.until;
  // Stop: nothing more happens, and nothing lands (a payload that replaces this one lands itself).
  D.stop = () => { W.clearQueue(); D.landed = true; D.until = W.t; };
  return D;
}

// The bags the picture shows taken once a payload has played: on a ball in play, a walk, a hit
// batsman or a play on the bases every man runs his move (bases.js, runs.js), so the bags the play
// left; otherwise the runners where they started and the batter on first if he got there. The view
// opens the next at-bat on a cutaway when its bags differ (`stage`'s `o.cutaway`).
const REACHED = new Set(['single', 'double', 'triple', 'error', 'fielderschoice', 'walk', 'hitbypitch']);
export function pictureAfter(p) {
  if (p?.phase === 'half') return [false, false, false];
  if (p?.phase === 'run' && Array.isArray(p.basesAfter)) return [0, 1, 2].map((i) => !!p.basesAfter[i]);
  const ran = !!p?.play || p?.kind === 'walk' || p?.kind === 'hitbypitch';
  if (!p?.phase && ran && Array.isArray(p.basesAfter)) return [0, 1, 2].map((i) => !!p.basesAfter[i]);
  const bags = [0, 1, 2].map((i) => !!(Array.isArray(p?.basesBefore) && p.basesBefore[i]));
  if (!p?.phase && REACHED.has(p?.kind)) bags[0] = true;
  return bags;
}

// Whether a payload is a game's first at-bat, which the view opens on the street outside the main
// gate (`stage`'s `o.cutaway` 'street'): the top of the first, nobody out or on before it, and
// nothing scored.
export function opensGame(p) {
  if (!p || p.phase || (p.inning | 0) !== 1 || p.half !== 'top') return false;
  const outsAfter = Math.max(0, Math.min(3, p.outs | 0)), outsBy = p.kind === 'tripleplay' ? 3 : p.kind === 'doubleplay' ? 2 : 1;
  const runs = Number.isFinite(p.runs) ? p.runs : (p.rbi | 0);
  return outsAfter - (p.out ? outsBy : 0) <= 0 && !(Array.isArray(p.basesBefore) && p.basesBefore.some(Boolean))
    && Math.max(0, (p.awayScore | 0) - runs) === 0 && (p.homeScore | 0) === 0;
}

// which way a ball put in play goes, roughly by what came of it, for the second or two before it
// lands, for a payload from before synthPlay
function dirFor(kind, h) {
  const across = ((h % 1000) / 1000 - 0.5) * 1.2;
  if (kind === 'homerun' || kind === 'flyout' || kind === 'sacfly') return norm([across, 0.62, 1]);
  if (kind === 'popout') return norm([across * 0.3, 2.4, 0.5]);
  if (GROUND.has(kind)) return norm([across, -0.06, 1]);
  return norm([across, 0.18, 1]);
}
