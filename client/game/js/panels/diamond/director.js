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
// at-bat on a short hold leaves pitches out of the middle, and the count goes through them. Every
// jump from one moment to another is under a cut (`shot`), so nobody pops.
//
// A BALL IN PLAY IS PLAYED OUT (diamond/plays.js): the fielders set as the last pitch comes, the
// ball where the server sent it, the man who fields it, the throws and the catches, the batter
// down the line and the base umpire's call, with the high camera following the ball and the
// first-base camera on a play there. The play is planned once for the budget and again on the
// clock; it's the same plan both times, moved.
//
// A PICTURE THAT DISAGREES WITH THE NEXT PAYLOAD IS FIXED ON A CUTAWAY. The booth doesn't call
// every at-bat and Phase 3c doesn't move the runners, so the bags the picture last showed and the
// ones the next payload starts from often differ; then the at-bat opens on the wide shot over the
// city for a beat (`cutaway`), and everyone is in their new places when it cuts in.
//
// `onLand` fires when the play lands: the umpire's call on a called third strike, the ball in the
// mitt on a swinging one or on ball four, the ball hitting him, or the ball put in play resolved.
// The view holds the booth's line and the card until then.
//
// Pure: no DOM and no GL, so the gates run it.

import { eventTime, SWEET_SPOT, handPoint } from './anim.js';
import { solvePose } from './rig.js';
import { pitchPoint } from './hud.js';
import { pitchPath, throwPath, hitPath, BALL_R } from './flight.js';
import { CLIPS } from './clips.js';
import { castOf } from './cast.js';
import { toPark } from './world.js';
import { planPlay } from './plays.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
function hashStr(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

// The budget, in seconds, for a payload: 0.45 of its hold (milliseconds), between 13 and 26.
export const BUDGET = Object.freeze({ share: 0.45, min: 13, max: 26 });
export const budgetOf = (p) => clamp(BUDGET.share * (Number.isFinite(p?.hold) ? p.hold / 1000 : 0), BUDGET.min, BUDGET.max);

// The pieces of a pitch's time, in seconds: from the payload to the first cut (`in`); a quick
// pitch cut in this long before the release (`quick`); after a pitch with no reaction, to the next
// (`after`); after one with its reaction, the hitter in close-up from `reactCut` on (`react`); the
// pitcher on the rubber before a windup (`windupHold`); the throw back's flight (`lob`), how long
// before it reaches the pitcher the ritual's shot comes in (`ritualIn`), and the wide shot an
// at-bat opens on when the picture disagrees with it (`cutaway`).
export const PACE = Object.freeze({ in: 0.05, quick: 0.5, after: 0.55, react: 1.35, reactCut: 0.3, windupHold: 1.0, lob: 0.95, ritualIn: 0.4, cutaway: 1.4 });
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
function playCtx(S, tRel, tIn) {
  const sh = S.shapes[S.shapes.length - 1], who = (b) => ({ slot: b.slot, id: b.id, at: b.at.slice(), yaw: b.yaw, mirror: b.mirror, scale: b.scale });
  return {
    p: S.p, cast: S.cast, tIn, tBat: tRel + sh.tBat, at: sh.path(sh.tBat),
    pitcher: { ...who(S.P), clip: S.delivery.id, start: tRel - S.REL, speed: S.tempo },
    catcher: { ...who(S.C), at: [CATCHER_AT[0] + sh.setupX, CATCHER_AT[1], CATCHER_AT[2]], clip: sh.catchClip.id, start: tRel + sh.tMitt - sh.catchT, speed: 1 },
    batter: who(S.H),
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
  // a long at-bat on a short hold: pitches out of the middle, from the end, until the rest fit
  for (let i = N - 2; i >= 1 && total() > budget + 1e-9; i--) views[i].show = false;
  const fuller = (i, k, val) => { const was = views[i][k]; views[i][k] = val; if (total() > budget + 1e-9) views[i][k] = was; };
  for (const i of order) if (i < N - 1 && views[i].show) fuller(i, 'react', true);
  for (const i of order) if (views[i].show) fuller(i, 'lead', 'core');
  for (const i of [0, ...order.filter((x) => x !== 0)]) if (views[i].show) fuller(i, 'lead', 'set');
  for (const i of order) if (i > 0 && views[i].show && views[i].lead === 'set' && views[i - 1].show) fuller(i, 'ritual', true);
  return views;
}

// ── staging ────────────────────────────────────────────────────────────────────
// `opts.onLand()` when the play lands; `opts.emit(name, data)` for what the view shows and plays:
// 'shot' (a camera by name, diamond/camera.js), 'pitch' ({ i, pitch } as each pitch is decided,
// for the count and the graphics) and 'sound' (a cue in client/shared/deadball-sfx.js, on the
// moment: the mitt's pop, the bat's crack, a miss's whiff, the ball into a glove).
export function createDirector(W, opts = {}) {
  const emit = (n, d) => opts.emit?.(n, d);
  const D = { log: [], played: [], views: null, landed: true, landAt: 0, until: 0, t0: 0, budget: 0, payload: null };

  // `o.cutaway`: the picture disagrees with this payload (pictureAfter), so it opens on the wide
  // shot while everyone takes their places.
  D.stage = (p, cast = castOf(p), o = {}) => {
    D.payload = p; D.log = []; D.played = []; D.views = null; D.landed = false; D.play = null;
    W.clearQueue();
    const S = prepare(W, p, cast || []);
    if (!S) { D.landed = true; D.landAt = D.until = W.t; opts.onLand?.(); return; }
    // the cutaway gives way to the play: shortened where the at-bat can't fit round it, and left
    // out (`squeezed`) where even a third of a second won't fit
    const budget = budgetOf(p);
    let lead = o.cutaway ? PACE.cutaway : 0, views = planViews(S, budget, lead);
    const over = timeline(S, views, PACE.in + lead).landAt - budget;
    if (lead && over > 0) {
      lead = lead - over >= 0.3 ? lead - over : 0;
      views = planViews(S, budget, lead);
    }
    const t0 = W.t + PACE.in + lead;
    D.views = views;
    const TL = timeline(S, views, t0);
    Object.assign(D, { t0, budget, landAt: TL.landAt, cutaway: !!lead, squeezed: !!o.cutaway && !lead });
    if (lead) W.at(W.t, () => emit('shot', 'sky'));
    const { P, C, H, U, tempo, delivery, hand, bats, from } = S;
    const side = sideShot(bats);
    let until = TL.landAt + 0.5;
    // a clip started at world time `start`, from the moment `at` (a cut can come in on one already
    // under way); noted for the gate
    const play = (b, clipId, at, start = at, o = {}) => {
      if (!b) return;
      const speed = o.speed || 1;
      until = Math.max(until, start + CLIPS[clipId].duration / speed);
      W.at(at, () => { W.play(b.slot, clipId, { at: start, speed, fade: o.fade, frame: o.frame, from: o.from, carry: o.carry }); D.played.push({ t: at, role: b.role, slot: b.slot, clip: clipId, start }); });
    };
    const cut = (at, shot) => W.at(at, () => emit('shot', shot));
    // the ball on a path until `end`, when it's gone unless something else has it by then
    const ballFor = (path, end) => { W.setBall(path); W.at(end, () => { if (W.ball === path) W.setBall(null); }); };
    const count = (at, i) => W.at(at, () => emit('pitch', { i, pitch: S.pitches[i] }));
    const sound = (at, cue) => W.at(at, () => emit('sound', cue));
    let skipped = [];

    TL.list.forEach((T) => {
      const i = T.i, q = S.pitches[i], sh = S.shapes[i], v = views[i], last = i === S.pitches.length - 1;
      if (!T.show) { skipped.push(i); D.log.push({ i, n: q.n ?? i + 1, result: q.result, shown: false }); return; }
      // a pitch left out goes on the count as the next one cuts in
      for (const k of skipped) count(T.tIn, k);
      skipped = [];
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
        W.at(start, () => W.layer(H.slot, 'aim', { target: aim, reach: 1.25, follow: 1.0, from: T.tBat - 0.1, full: T.tBat - 0.01, hold: T.tBat + 0.02, to: T.tBat + 0.12 }));
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
        const plan = last && q.result === 'inplay' && S.playSpan != null ? planPlay(playCtx(S, T.tRel, T.tIn)) : null;
        if (plan) {
          stagePlay(plan, T);
          rec.play = plan;
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
      W.at(TL.landAt, () => { if (!D.landed) { D.landed = true; opts.onLand?.(); } });
    });
    D.until = until;

    // The ball in play, from its plan: the seven placed at the cut in and set, every clip at its
    // time from its frame, the hands' reaches and the heads on the ball, the ball's flights and the
    // hands it rides in, the cuts and the sounds.
    function stagePlay(plan, T) {
      D.play = plan;
      for (const B of plan.bodies) {
        if (B.place) W.at(T.tIn, () => { W.place(B.slot, { id: B.id, role: B.role, at: B.base.at, yaw: B.base.yaw, scale: B.scale, mirror: B.mirror }); W.clearLayers(B.slot); });
        for (const e of B.clips) {
          if (e.prior) continue;
          play({ slot: B.slot, role: B.role }, e.clip, e.issue ?? e.from ?? e.start, e.start, { speed: e.speed, fade: e.fade, frame: e.given ? e.F : undefined, from: e.from, carry: e.carry });
        }
      }
      for (const r of plan.reaches) W.at(Math.max(T.tIn, r.from - 0.02), () => W.layer(r.slot, 'reach', { hand: r.hand, kind: r.kind, target: r.target, follow: r.follow, from: r.from, full: r.full, hold: r.hold, to: r.to }));
      // every head on the field asks where the ball is each frame: once a frame is enough
      let seen = null, seenAt = NaN;
      const ballNow = (t) => { if (t !== seenAt) { seenAt = t; seen = W.ballAt(t) || seen; } return seen; };
      for (const l of plan.looks) W.at(Math.max(T.tIn, l.from - 0.02), () => W.layer(l.slot, 'look', { target: ballNow, from: l.from, full: l.full, hold: l.hold, to: l.to }));
      for (const b of plan.balls) {
        const fn = b.path || ((t) => { const Q = W.pose(b.hold.slot, t, { look: false }); return Q ? toPark(Q, handPoint(Q, b.hold.hand, b.hold.kind, Q.scale)) : b.at; });
        W.at(b.from, () => W.setBall(fn));
      }
      for (const c of plan.cuts) cut(c.at, c.shot);
      for (const x of plan.sounds) sound(x.at, x.cue);
    }
  };

  D.busy = () => !D.landed || W.t < D.until;
  // Stop: nothing more happens, and nothing lands (a payload that replaces this one lands itself).
  D.stop = () => { W.clearQueue(); D.landed = true; D.until = W.t; };
  return D;
}

// The bags the picture shows taken once a payload has played: the runners where they started
// (Phase 3c doesn't move them) and the batter on first if he got there. The view opens the next
// at-bat on a cutaway when its bags differ (`stage`'s `o.cutaway`).
const REACHED = new Set(['single', 'double', 'triple', 'error', 'fielderschoice', 'walk', 'hitbypitch']);
export function pictureAfter(p) {
  const bags = [0, 1, 2].map((i) => !!(Array.isArray(p?.basesBefore) && p.basesBefore[i]));
  if (p?.phase === 'half') return [false, false, false];
  if (!p?.phase && REACHED.has(p?.kind)) bags[0] = true;
  return bags;
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
