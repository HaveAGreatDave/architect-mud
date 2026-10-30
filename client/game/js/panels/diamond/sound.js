// DEADBALL · THE PARK'S EAR. What the Grandstand (gameday-grandstand.js) sounds like.
//
// It listens to the live world rather than being told: each frame, after the world's stepped,
// `hear(W)` finds what happened since the last frame and plays it from the bank
// (client/shared/deadball-sfx.js EVENTS). Every clip in the library says when its catch, throw,
// tag, footstep and umpire's call fall (diamond/clips.js `events`), so a clip a body is playing
// says what he's sounding; the ball's path says where it bounces, hits the wall, the pole or the
// backstop; the spectacle (diamond/spectacle.js) when the trail, the sparks and the fireworks
// go; and the fans in the stands (gl/crowd.js createRoar) how loud the crowd is. The director
// still names the four sounds it plans (crack, mitt, glove, whiff) with `cue()`, and a catch it
// names isn't played a second time off the clip. A replay's world isn't heard: a replay is silent
// but for its sting.
//
// The mix (MIX in the bank): every sound sits so many dB under the booth's voice, and the effects,
// the organ and the crowd duck further while Chip is speaking. The announcer's calls, the umpire,
// the public address and the vendor speak on ORACLE's 'scene' channel, so they never cut the
// booth off; the booth's held line waits for a call (`afterCall`). Sound Detail decides how much
// of it plays (DETAIL in the bank).
//
// Pure but for AudioEngine and timers: the gates run it against a recording engine.

import {
  eventFor, patch, variant, MIX, layerOf, tierAllows, VOICES, CALLS, crowdBed, parkBed,
} from '../../../../shared/deadball-sfx.js';
import { loadSettings, sfxDetail } from '../../../../shared/settings.js';
import { KINDS } from './spectacle.js';
import { fenceDistance } from './geo.js';

const dbGain = (db) => Math.pow(10, (db || 0) / 20);
const SPEED_OF_SOUND = 1125;        // ft/s: a shell bursting over the bleachers is heard late
const CATCH_SAME = 0.15;            // s: a clip's catch this close to one the director named is the same catch
const STEP_GAP = 0.15, STEPS_PER_S = 8;
const hashStr = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; };

// Where the dirt is: the infield's arc round the mound, the circle round the plate, and the
// warning track inside the fence.
export function onDirt(x, z) {
  if (Math.hypot(x, z - 60.5) < 95 || Math.hypot(x, z) < 14) return true;
  const r = Math.hypot(x, z);
  return r > fenceDistance(Math.atan2(x, z)) - 15;
}

// What a clip sounds like beyond the events it carries: a slide comes down on its last step, a
// dive lands as the ball's caught, a man going back to the bag hits it on his last step.
const extraCache = new Map();
function eventsOf(clip) {
  if (!clip) return [];
  let evs = extraCache.get(clip.id);
  if (evs) return evs;
  evs = (clip.events || []).slice();
  const steps = evs.filter((e) => e.kind === 'step'), lastStep = steps.length ? steps[steps.length - 1].t : 0;
  const caught = evs.find((e) => e.kind === 'catch');
  if (/^slide_/.test(clip.id)) evs.push({ t: lastStep + 0.03, kind: 'slide' });
  else if (clip.id === 'run_dive_back') evs.push({ t: lastStep + 0.05, kind: 'diveBack' });
  else if (/dive|catch_slide/.test(clip.id) && caught) evs.push({ t: Math.max(0, caught.t - 0.02), kind: 'dive' });
  if (clip.loop) evs = evs.filter((e) => e.t < clip.duration);
  extraCache.set(clip.id, evs);
  return evs;
}

// The words the umpire shouts for a call.
function umpireSays(call, s) {
  if (call !== 'strike') return CALLS.umpire[call] || null;
  const q = s.pitch, p = s.p;
  return p?.kind === 'strikeout' && q && (q.strikes | 0) >= 2 ? CALLS.umpire.strikethree : CALLS.umpire.strike;
}
// The announcer's call for a play that's landed, or null.
export function callFor(p, lastPitch) {
  if (!p || p.phase) return null;
  const A = CALLS.announcer;
  if (p.walkoff) return A.walkoff;
  if (p.kind === 'homerun') return (p.rbi | 0) >= 4 ? A.grandslam : A.homerun;
  if (p.kind === 'tripleplay') return A.tripleplay;
  if (p.kind === 'doubleplay') return A.doubleplay;
  // a called third strike is the umpire's to call; a swinging one is the announcer's
  if (p.kind === 'strikeout' && lastPitch?.result !== 'called') return A.strikeout;
  return null;
}
// The pitch the bat touched on a payload's nth crack (1 the first): the director names the crack
// as the bat meets the ball and the pitch only once it's decided just after, so the graphics' pitch
// is still the one before. Fouls and the ball put in play are the pitches that crack.
export function crackPitch(p, n) {
  const hit = (p?.pitches || []).filter((q) => q.result === 'foul' || q.result === 'inplay');
  return hit[n - 1] || null;
}
// The contact the bat makes, from what the payload says of the ball.
function contactOf(s, seed) {
  const q = s.pitch, pl = s.p?.play;
  if (q?.result === 'foul') return { foul: true, ev: (seed % 3) ? 82 : 68 };
  const ev = +pl?.ev || 88;
  return { ev, t: pl?.t, bunt: ev < 60, broken: ev >= 60 && ev < 80 && pl?.t === 'gb' && seed % 14 === 0 };
}

// How much the next pitch matters to the crowd, 0 to 1: late, close, men on (more in scoring
// position), two out, two strikes or three balls, and a final. The bed's floor follows it, and the
// crowd murmurs before a pitch past 0.6.
export function tension(p, S) {
  if (!p || p.phase === 'half') return 0;
  const inn = p.inning | 0, margin = Math.abs((p.homeScore | 0) - (p.awayScore | 0));
  const bags = Array.isArray(p.basesBefore) ? p.basesBefore : [];
  const outs = Math.max(0, Math.min(2, (p.outs | 0) - (p.out ? 1 : 0)));
  const q = S?.pitch || {};
  let x = 0;
  x += inn >= 9 ? 0.25 : inn >= 7 ? 0.15 : 0.05;
  x += margin === 0 ? 0.2 : margin === 1 ? 0.15 : margin <= 3 ? 0.07 : 0;
  x += (bags[0] ? 0.06 : 0) + (bags[1] ? 0.1 : 0) + (bags[2] ? 0.14 : 0);
  x += outs === 2 ? 0.1 : 0;
  x += ((q.strikes | 0) >= 2 ? 0.08 : 0) + ((q.balls | 0) >= 3 ? 0.08 : 0);
  if (S?.gold) x += 0.1;
  // a blowout empties the noise out of the park whatever the count
  if (margin >= 6) x *= 0.4;
  return Math.max(0, Math.min(1, x));
}

// `state()` gives { p (the payload playing), S (the graphics' state: pitch, splash, tableRace,
// replay, matchup, homeTeam, gold) }. `detail` pins Sound Detail (the gates); otherwise it's the
// player's. `seat` (stands.js) puts the ear in the stands rather than the booth: see `fromSeat`.
export function createParkSound({ win = globalThis, state = () => ({}), detail = null, seat = null } = {}) {
  const AE = () => win?.AudioEngine || null;
  let tier = detail || sfxDetail(loadSettings());
  let world = null, lastT = 0;
  let ball = { path: null };
  let lastCatchCue = -9, lastCrackT = -9, cracks = 0;
  const stepAt = new Map();
  let stepWindow = { t: -9, n: 0 };
  const seen = { pitch: null, splash: null, table: null, replay: false, roarA: 0, roarH: 0, batter: null };
  let crowd = null, park = null, timers = [];
  const log = [];       // what's played, for the gates: [key, id] and ['say', who, text]
  const later = (ms, fn) => { timers.push(setTimeout(fn, Math.max(0, ms))); };
  const booth = () => AE()?.speechLeft?.('tv') || 0;
  const scene = () => AE()?.speechLeft?.('scene') || 0;

  // A seat in the stands hears the field, not the broadcast. There are no graphics to sting and
  // no booth, so the play is the mix: the bat, the gloves, the feet and the slides come up, each
  // as loud as it is near the seat and late by the time sound takes to reach it, and the umpires
  // are men shouting a long way off. `fromSeat(at)` is { gain, ms } for a sound at `at` (the
  // field's feet, as the seat's eye is).
  const SEAT_NEAR = 70, SEAT_LIFT = { impact: 1.6, fx: 1.7 };
  function fromSeat(at) {
    const eye = seat?.eye;
    if (!eye || !at) return { gain: 1, ms: 0 };
    const d = Math.hypot(at[0] - eye[0], (at[1] ?? 0) - eye[1], at[at.length - 1] - eye[2]);
    return { gain: Math.max(0.25, Math.min(1.4, SEAT_NEAR / Math.max(1, d))), ms: (d / SPEED_OF_SOUND) * 1000 };
  }
  // where the plate umpire, the catcher and the batter are
  const PLATE = [0, 4, -3];

  // One sound from the bank: `what` is its Sound Detail tier, `t` the world time it's for (its
  // seed), `o` the event's data and { gain, pan, at }; `at` is only read from a seat.
  function play(key, o = {}, what = 'event', t = world ? world.t : 0) {
    if (seat && o.at) {
      const { gain, ms } = fromSeat(o.at);
      const near = { ...o, at: null, gain: (o.gain ?? 1) * gain };
      if (ms > 15) { later(ms, () => play(key, near, what, t)); return null; }
      o = near;
    }
    if (!tierAllows(tier, what)) return null;
    const pick = eventFor(key, o);
    if (!pick) return null;
    const d = patch(pick.id);
    if (!d) return null;                                   // muted in the dev panel
    log.push([key, pick.id]);
    const ae = AE();
    if (!ae?.playSfx) return null;
    const m = MIX[layerOf(pick.id)];
    let g = dbGain(m.db) * (o.gain ?? 1) * (seat ? SEAT_LIFT[layerOf(pick.id)] || 1 : 1);
    if (m.duck && booth() > 0) g *= dbGain(m.duck);
    const seed = (hashStr(key) ^ Math.round(t * 1000)) >>> 0;
    const pan = Number.isFinite(o.pan) ? Math.max(-0.35, Math.min(0.35, o.pan)) : 0;
    return ae.playSfx(variant(d, seed, 1, pick.intensity), g, pan ? { pan } : {});
  }
  // A voice on the scene channel.
  function say(who, text, o = {}) {
    if (!text || !tierAllows(tier, o.tier || 'call')) return null;
    // a voice in the picture never starts over the booth: the booth's already saying it
    if (booth() > 0.15) { log.push(['quiet', who, text]); return null; }
    log.push(['say', who, text]);
    const db = who === 'announcer' ? MIX.call.db : who === 'vendor' ? MIX.vendor.db : MIX.scene.db;
    return AE()?.speak?.(text, { channel: 'scene', seed: who, voice: VOICES[who], gain: dbGain(db) * (o.gain ?? 1), excite: o.excite ?? 0, pa: who === 'pa' }) || null;
  }
  // an umpire from a seat: further off is quieter and later
  function umpire(text, at, gain) {
    if (!seat) { say('umpire', text, { gain, excite: 0.25 }); return; }
    const f = fromSeat(at);
    later(f.ms, () => say('umpire', text, { gain: gain * Math.max(0.35, Math.min(1, f.gain)), excite: 0.35 }));
  }
  // pan by where it happened: +x is toward third, on the left of the picture from behind the plate
  const panAt = (q) => (q ? -q[0] / 250 : 0);

  // ── the clips ──────────────────────────────────────────────────────────────
  function clipEvent(W, b, e, at) {
    const role = b.clip.role, where = W.frame?.(b.slot, at)?.at || b.at || [0, 0, 0];
    const pan = panAt(where);
    switch (e.kind) {
      case 'catch':
        if (Math.abs(at - lastCatchCue) < CATCH_SAME) return;
        play('glove', { role, stretch: b.clip.id === 'field_stretch', pan, at: where }, 'event', at);
        return;
      case 'tag': play('tag', { pan, at: where }, 'event', at); return;
      case 'hit': play('hit', { pan, at: where }, 'event', at); later(60, () => play('gasp', {}, 'event', at + 0.06)); return;
      case 'release':
        if (role !== 'pitcher' || /pickoff/.test(b.clip.id)) play('release', { pan, at: where }, 'step', at);
        return;
      case 'step': {
        // a fielder creeping in as the pitch comes isn't heard; a man running is
        if (/^field_ready/.test(b.clip.id)) return;
        if (at - (stepAt.get(b.slot) ?? -9) < STEP_GAP) return;
        if (at - stepWindow.t > 1) stepWindow = { t: at, n: 0 };
        if (++stepWindow.n > STEPS_PER_S) return;
        stepAt.set(b.slot, at);
        play('step', { dirt: onDirt(where[0], where[where.length - 1]), hard: role === 'runner' || role === 'batter', pan, at: where }, seat && role === 'runner' ? 'event' : 'step', at);
        return;
      }
      case 'call': {
        const s = state() || {};
        // a base umpire is further from the microphones than the plate umpire
        umpire(umpireSays(e.call, s), where, b.id === 'ump:plate' ? 1 : 0.8);
        return;
      }
      case 'slide': play('slide', { pan, at: where, gain: seat ? 1.3 : 1 }, 'event', at); return;
      case 'diveBack': play('diveBack', { pan, at: where }, 'event', at); return;
      case 'dive': play('dive', { dirt: onDirt(where[0], where[where.length - 1]), pan, at: where }, 'event', at); return;
      default: // contact is the director's crack; the clip's fires on a miss too
    }
  }
  function hearClips(W, t0, t1) {
    for (const b of W.bodies.values()) {
      if (!b.clip) continue;
      for (const e of eventsOf(b.clip)) {
        const at = b.start + e.t / (b.speed || 1);
        if (at > t0 && at <= t1) clipEvent(W, b, e, at);
      }
    }
  }

  // ── the ball ───────────────────────────────────────────────────────────────
  // Sampled at the frame's own times, so a bounce between two frames is found from the vertical
  // speed changing sign, and the wall from the ball coming back toward the plate.
  function hearBall(W, t0, t1) {
    const path = W.ball;
    // a new path (a throw, a ball off the bat) only says where it's going on its first frame
    const fresh = path !== ball.path;
    if (fresh) ball = { path, done: {} };
    if (!path) return;
    const at = (t) => { try { return path(t); } catch { return null; } };
    const q0 = at(t0), q1 = at(t1), qa = at(t1 - 0.004);
    if (!q0 || !q1 || !qa) return;
    const vy1 = (q1[1] - qa[1]) / 0.004, vy0 = ball.vy;
    const r0 = Math.hypot(q0[0], q0[2]), r1 = Math.hypot(q1[0], q1[2]);
    const dr = r1 - r0, speed = Math.hypot(q1[0] - q0[0], q1[1] - q0[1], q1[2] - q0[2]) / (t1 - t0);
    if (fresh) { ball.vy = vy1; ball.dr = dr; return; }
    const s = state() || {}, p = s.p || {};
    // a bounce: falling, then rising, near the ground
    if (vy0 != null && vy0 < -2 && vy1 > 0 && Math.min(q0[1], q1[1]) < 2) {
      const dirt = onDirt(q1[0], q1[2]);
      if ((p.kind === 'wildpitch' || p.kind === 'passedball') && Math.hypot(q1[0], q1[2]) < 25) play('dirt', { pan: panAt(q1), at: q1 }, 'event', t1);
      else play('hop', { dirt, speed, pan: panAt(q1), at: q1 }, 'event', t1);
    }
    // the wall: going out, then coming back, out there
    if (ball.dr != null && ball.dr > 0 && dr < 0 && r1 > 200 && q1[1] < 14 && !ball.done.wall) { ball.done.wall = 1; play('wall', { pan: panAt(q1), at: q1 }, 'event', t1); }
    // past the fence: the pole, or the seats as it comes down
    const fence = fenceDistance(Math.atan2(q1[0], q1[2]));
    if (p.kind === 'homerun') {
      if (r0 < fence && r1 >= fence && p.play?.hr === 'pole' && !ball.done.pole) { ball.done.pole = 1; play('pole', { pan: panAt(q1), at: q1 }, 'event', t1); }
      // a home run's path knows where it comes down (flight.js `land`, which the fireworks use too)
      if (Number.isFinite(path.land) && path.land > t0 && path.land <= t1 && p.play?.hr !== 'pole' && !ball.done.seats) { ball.done.seats = 1; play('seats', { pan: panAt(q1) }, 'event', path.land); }
    }
    // behind the plate: the backstop low; high, there's no net, so it's into the club's seats
    if (q1[2] < -50 && q0[2] >= -50 && !ball.done.back) { ball.done.back = 1; play(q1[1] < 10 ? 'backstop' : 'seats', {}, 'event', t1); }
    // rolling through the grass
    if (q1[1] < 0.6 && speed > 10 && !onDirt(q1[0], q1[2]) && t1 - (ball.rolled ?? -9) > 0.6) { ball.rolled = t1; play('roll', { pan: panAt(q1), at: q1 }, 'step', t1); }
    ball.vy = vy1; ball.dr = dr;
  }

  // ── the spectacle ──────────────────────────────────────────────────────────
  function hearFx(fx, t0, t1) {
    const due = (t) => t > t0 && t <= t1;
    for (const e of fx || []) {
      if (e.kind === 'trail' && due(e.from)) play('trail', {}, 'event', e.from);
      else if (e.kind === 'sparks' && due(e.t)) play('sparks', {}, 'event', e.t);
      else if (e.kind === 'burst') {
        const late = Math.hypot(...(e.at || [0, 0, 0])) / SPEED_OF_SOUND, launch = e.t - KINDS.burst.rise;
        if (due(launch)) play('launch', { pan: panAt(e.at) }, 'event', launch);
        if (due(e.t + late)) play('burst', { pan: panAt(e.at) }, 'event', e.t + late);
        if (due(e.t + late + 0.25)) play('crackle', { pan: panAt(e.at) }, 'event', e.t + late + 0.25);
      }
    }
  }

  // ── the crowd ──────────────────────────────────────────────────────────────
  // The fans in the stands say how loud: the home side getting up is a cheer (a roar once
  // they're all up), the away side getting up with the home side sitting is the home crowd's
  // groan. The bed follows the louder side.
  function hearCrowd(roar, t) {
    if (!roar) return;
    const [h, a] = roar, s = state() || {};     // createRoar's side 0 is the home fans
    if (seen.roarH < 0.4 && h >= 0.4) play('cheer', {}, 'event', t);
    if (seen.roarH < 0.8 && h >= 0.8) play('roar', {}, 'event', t);
    if (seen.roarA < 0.4 && a >= 0.4 && h < 0.25) play('groan', {}, 'event', t);
    if (s.S?.gold && seen.roarH < 0.8 && h >= 0.8) play('towels', {}, 'bed', t);
    seen.roarA = a; seen.roarH = h;
    if (crowd) {
      // the floor is how much the next pitch matters: a tie in the ninth with men on hums
      crowd.setLevel(Math.max(0.1 + 0.32 * tension(s.p, s.S), 0.85 * Math.max(a, h)));
      const left = booth();
      if (left > 0.1 && !crowd.ducked) { crowd.duck(-MIX.crowd.duck, left); crowd.ducked = true; later(left * 1000, () => { if (crowd) crowd.ducked = false; }); }
    }
  }

  // ── the graphics ───────────────────────────────────────────────────────────
  // What goes up over the picture is heard as it goes up: the count lamps and the speed readout
  // with each pitch, a splash word, the leaders' table, the replay's sting. And with two strikes
  // on an away batter, the home crowd claps him down.
  function hearGraphics(t) {
    const s = state() || {}, S = s.S || {}, p = s.p || {};
    if (S.pitch && S.pitch !== seen.pitch) {
      if (!seat) play('click', {}, 'event', t);
      if (S.pitch.velo && !seat) later(180, () => play('beep', {}, 'event', t + 0.18));
      const x = tension(p, S), twoOut = (p.outs | 0) - (p.out ? 1 : 0) >= 2;
      if ((S.pitch.strikes | 0) >= 2 && p.half === 'top' && tierAllows(tier, 'bed')) {
        // two strikes and two out on a visitor: the stands stamp him down; otherwise they clap
        if (twoOut && x >= 0.45) later(250, () => play('stomp', {}, 'bed', t + 0.25));
        else for (let k = 0; k < 3; k++) later(300 + 450 * k, () => play('clap', {}, 'bed', t + k));
      }
      if (x >= 0.6) later(400, () => play('murmur', { gain: Math.min(1, x + 0.1) }, 'event', t + 0.4));
    }
    seen.pitch = S.pitch || null;
    // a seat has no graphics, so nothing goes up to be heard
    if (seat) { seen.splash = S.splash || null; seen.table = S.tableRace || null; seen.replay = !!S.replay; return; }
    if (S.splash && S.splash !== seen.splash && !['homerun', 'grandslam'].includes(S.splash.kind)) play('splash', {}, 'event', t);
    seen.splash = S.splash || null;
    if (S.tableRace && !seen.table) play('table', {}, 'event', t);
    seen.table = S.tableRace || null;
    if (S.replay && !seen.replay) play('rewind', {}, 'event', t);
    seen.replay = !!S.replay;
  }

  // ── the beds and the park ──────────────────────────────────────────────────
  function beds(p) {
    if (!tierAllows(tier, 'bed')) { stopBeds(); return; }
    if (!crowd) { crowd = crowdBed(); crowd?.start().setLevel(0.12); }
    if (!park) { park = parkBed(); park?.start(); }
    const hr = Number.isFinite(p.clock) ? p.clock / 60 : 20, wx = p.wx || {}, word = String(wx.word || '');
    const wet = /rain|storm|drizzle|acid|sleet|snow/.test(word) || wx.event === 'acid_rain';
    park?.set({ night: hr >= 18 || hr < 6 ? 1 : 0, wind: /storm|wind|gale|ion/.test(word) || wx.event === 'ion_storm' ? 0.8 : 0.25, rain: wet ? Math.max(0.3, +wx.rate || 0.6) : 0 });
  }
  function stopBeds() { crowd?.stop(); park?.stop(); crowd = null; park = null; }

  return {
    // The director's planned sounds, on their moment.
    cue(name) {
      const s = state() || {}, t = world ? world.t : 0, seed = hashStr(`${s.p?.batter}|${s.p?.inning}|${cracks}`);
      if (name === 'crack') {
        lastCrackT = t;
        const q = crackPitch(s.p, ++cracks);
        const how = contactOf({ p: s.p, pitch: q }, seed);
        play('crack', { ...how, at: PLATE }, 'event', t);
        // the crowd comes up off the bat before anyone knows where it's going; not for a pop-up
        if (q?.result === 'inplay' && how.t !== 'pu' && !how.bunt) later(90, () => play('swell', how, 'event', t + 0.09));
        // the booth's call as the ball comes off the bat (baseball.js contactCall), on the pitch
        // that's put in play: his line about how it ended waits for it (afterCall)
        const c = s.p?.contact;
        if (!seat && c?.text && q?.result === 'inplay' && tierAllows(tier, 'call') && booth() <= 0.15) {
          log.push(['say', 'booth', c.text]);
          AE()?.speak?.(c.text, { channel: 'scene', seed: c.by || 'booth', gain: dbGain(MIX.call.db), excite: (+s.p.play?.ev || 0) >= 100 ? 0.8 : 0.45 });
        }
        return;
      }
      if (name === 'mitt' || name === 'glove') {
        lastCatchCue = t;
        if (name === 'mitt') play('mitt', { velo: s.S?.pitch?.velo, tip: t - lastCrackT < 0.3, at: PLATE }, 'event', t);
        else play('glove', {}, 'event', t);
        return;
      }
      play(name, name === 'whiff' ? { at: PLATE } : {}, 'event', t);
    },
    // After the live world's stepped: everything that happened since the last frame.
    hear(W, { fx = null, roar = null } = {}) {
      if (!W) return;
      if (W !== world || W.t < lastT) { world = W; lastT = W.t; ball = { path: W.ball }; return; }
      const t0 = lastT, t1 = W.t;
      lastT = t1;
      if (t1 <= t0) return;
      hearClips(W, t0, t1);
      hearBall(W, t0, t1);
      hearFx(fx, t0, t1);
      hearCrowd(roar, t1);
      hearGraphics(t1);
    },
    // A payload's come in: the beds and the park follow it, a half-inning break gets its sweep and
    // the organ, a new man up the public address, and now and then the streets or a vendor.
    payload(p) {
      if (!p) return;
      cracks = 0;
      // what the last payload had still to come (its organ, the streets, a vendor) gives way
      timers.forEach(clearTimeout); timers = [];
      tier = detail || sfxDetail(loadSettings());
      beds(p);
      const h = hashStr(`${p.inning}|${p.half}|${p.batter}|${p.kind}|${p.phase}`);
      const t = world ? world.t : 0;
      if (p.phase === 'half') {
        play('sweep', {}, 'event', t);
        later(1400, () => { if (booth() < 0.5) play('dirge', {}, 'music', t + 1.4); });
      } else if (p.batter && p.batter !== seen.batter) {
        seen.batter = p.batter;
        // the home side up with men on and the game to win: the bleachers' drum
        const bags = Array.isArray(p.basesBefore) ? p.basesBefore : [];
        if (p.half === 'bottom' && bags.some(Boolean) && tension(p, state()?.S) >= 0.45) later(2400, () => { if (booth() < 0.5) play('drum', {}, 'bed', t + 2.4); });
        later(700, () => {
          if (booth() > 0.1 || scene() > 0.1) return;
          const num = state()?.S?.matchup?.bNum;
          say('pa', (num ? CALLS.pa.batter : 'Now batting, {batter}.').replace('{num}', num).replace('{batter}', p.batter), { tier: 'pa' });
        });
      } else if (h % 7 === 3) {
        later(2500, () => { if (booth() < 0.1 && scene() < 0.1) say('vendor', CALLS.vendor[h % CALLS.vendor.length], { tier: 'vendor', excite: 0.3 }); });
      }
      if (h % 5 === 1) later(3000 + (h % 4000), () => play('horn', {}, 'park', t + 3));
      if (h % 13 === 5) later(5000 + (h % 3000), () => play('foghorn', {}, 'park', t + 5));
      if (h % 11 === 2 && Number.isFinite(p.clock) && p.clock >= 18 * 60) later(1500 + (h % 5000), () => play('lamp', {}, 'park', t + 1.5));
    },
    // The play's landed: its sting, the announcer's call, and the crowd's word on an error at home
    // or a ball caught at the wall.
    land(p) {
      if (!p) return;
      const s = state() || {}, t = world ? world.t : 0;
      const outs = p.kind === 'tripleplay' ? 3 : p.kind === 'doubleplay' ? 2 : 1;
      // the stings are the broadcast's
      if (seat) { /* none */ }
      else if (p.kind === 'homerun') play('homer', {}, 'event', t);
      else if (p.rbi > 0 || (p.phase === 'run' && p.runs > 0)) play('run', {}, 'event', t);
      else if (p.kind === 'strikeout') play('strikeout', {}, 'event', t);
      else if (p.out) for (let k = 0; k < outs; k++) later(150 * k, () => play('out', {}, 'event', t + 0.15 * k));
      else play('base', {}, 'event', t);
      const homeFielding = p.half === 'top';
      if (p.kind === 'error' && homeFielding) play('boo', {}, 'event', t);
      else if (p.out && ['leaping', 'rail'].includes(p.play?.g)) play('ooh', {}, 'event', t);
      if (!homeFielding && (p.runs > 0 || p.rbi > 0) && tierAllows(tier, 'music')) later(900, () => play('rally', {}, 'music', t + 0.9));
      // the park's own hype: the air horn and the videoboard for a home run or a walk-off at home,
      // then the bleachers' drum; a whistle for a run in, a strikeout or a double play by the home side
      const h = hashStr(`${p.inning}|${p.half}|${p.batter}|${p.kind}`);
      if (!homeFielding && (p.kind === 'homerun' || p.walkoff)) {
        play('boom', {}, 'event', t);
        later(250, () => play('airhorn', {}, 'event', t + 0.25));
        later(2600, () => play('drum', {}, 'bed', t + 2.6));
      } else if (!homeFielding && (p.runs > 0 || p.rbi > 0)) later(500, () => play('whistle', {}, 'event', t + 0.5));
      else if (homeFielding && (['doubleplay', 'tripleplay'].includes(p.kind) || (p.kind === 'strikeout' && h % 2 === 0))) later(350, () => play('whistle', {}, 'event', t + 0.35));
      if (homeFielding && p.kind === 'strikeout' && (p.outs | 0) >= 3 && tension(p, s.S) >= 0.4) later(200, () => play('airhorn', {}, 'event', t + 0.2));
      // sold, but not to the top of his range: an all-caps shout already leans on its last word, and
      // at full excitement "THREE" went up nine semitones and shrill
      // the announcer is the broadcast's; a seat hears the umpire and the crowd
      if (!seat) say('announcer', callFor(p, s.S?.pitch), { excite: 0.4 });
      // the last out of a final: once the moment's held, the announcer crowns them
      if (p.end?.champion && !seat) later(1300, () => say('announcer', CALLS.announcer.champions, { excite: 0.5 }));
    },
    // Before a final's first pitch: the anthem, and the public address reading each man as his
    // card goes up (gameday-grandstand.js introduce).
    anthem() { play('anthem', {}, 'music', world ? world.t : 0); },
    introduce(it) {
      if (!it) return;
      const ord = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth'][it.i] || String(it.i);
      const line = it.num != null ? CALLS.pa.lineup : 'Batting {ord}, {name}.';
      say('pa', line.replace('{ord}', ord).replace('{num}', it.num).replace('{name}', it.name), { tier: 'pa' });
    },
    // The booth's held line, once the announcer's call has had its say.
    afterCall(fn) {
      const left = scene();
      if (left > 0.05) later(left * 1000 + 120, fn); else fn();
    },
    dispose() {
      timers.forEach(clearTimeout); timers = [];
      stopBeds();
      AE()?.cancelSpeech?.('scene');
      world = null;
    },
    get tier() { return tier; },
    _log: log,
  };
}
