// THE BOAT REEL: the minigame you play from an anchored boat's seat (docs/proposals/boat-fishing.md
// §5b, the contract). The server sends one message type, `boatfish`, with a phase; this module keeps
// the reel's state, draws its HUD and sends the verbs back. Every number it plays by comes from
// client/shared/boatfish-rules.js, which the server judges with, so nothing here restates one.
//
// The loop:
//   ready     the seat aims and calls boatFishCast(); with no seat, A/D aim and Space charges.
//   flight    the cast is in the air, waiting for the server's `lure`.
//   wait      the lure sinks. Each tap is a twitch (fishtwitch) that draws it in TWITCH_M. At
//             REEL_IN_M the server sends `reeled` and the line winds in by itself.
//   bite      the float knocks at beatTimes(n) after biteAt, in server time. Hit each knock
//             (fishstrike <beat> <hitServerMs>). A missed one is the server's `spat`.
//   fight     fightBoard's physics: the fish pulls to one side and switches every switchMs; lean
//             the other way. Tension 1 snaps the line (fishresolve boat 0). Tired and inside LAND_M,
//             it winds in (fishresolve boat 1), never sooner than minFightMs.
//   reeling   the line winding in, after `reeled`, a won fight or a snap.
//   landed    the catch card, after `landed` or `full`. Back to ready after it.
//
// The seat (boat-view.js) owns the aim, the landing ring and drawing the rod, line, lure and
// angler; it reads boatFishState() every frame for those. This file owns the HUD over the seat,
// or its own overlay when no seat is attached (the text rung, or before the seat opens).
//
// Time: the server's clock is the client's plus the skew taken from `open`'s serverNow. Every beat
// is judged in server time, so serverNow() is what a hit is stamped with.

import { sendCmdSilent } from '../net.js';
import { sfx, mountOverlay, ensureChassisStyles, deviceHeader } from './minigame-common.js';
import { loadCss } from '../../../shared/dom.js';
import { SPECIES } from '../../../shared/fish.js';
import {
  TWITCH_M, TWITCH_LIFT_M, TWITCH_MIN_MS, REEL_IN_M, SINK_MPS, CAST_MIN_M,
  tempoOf, BEAT_WINDOW_MS, LATENCY_SLACK_MS, beatTimes, onBeat, LAND_M, fightBoard, minFightMs, SURGE_MS,
} from '../../../shared/boatfish-rules.js';

// boatfish.css ships beside this file; see loadCss in client/shared/dom.js.
const BOATFISH_CSS = await loadCss(new URL('./boatfish.css', import.meta.url));

// ── Clock and frame hooks ────────────────────────────────────────────────────────────────────────
// The browser's, unless scripts/client/boatfish-smoke.mjs swaps in a fake clock and frame pump.
const _env = {
  now: () => Date.now(),
  raf: (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : 0),
  caf: (id) => { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id); },
};
/** For the headless gate only: replace the clock and the frame pump. */
export function boatFishTestHooks(over = {}) { Object.assign(_env, over); }

const send = (cmd) => sendCmdSilent(cmd);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fmt1 = (v) => String(Math.round(v * 10) / 10);

// ── Tuning that is the client's alone (feel, not rules) ──────────────────────────────────────────
const LEAN_RATE = 10;         // how fast the angler's lean follows the input, per second
const TURN_MS = 160;          // after the fish changes side, this long before leaning wrong costs you
const DRAG_PX = 140;          // pixels of drag for a full lean
const EARLY_TAP_MS = 2 * BEAT_WINDOW_MS;   // a tap further ahead of a knock than this isn't counted
const REEL_MPS = 9;           // the auto reel-in's speed
const CARD_MS = 3400;         // how long a result card stays
const NOTE_MS = 2200;         // how long a one-off status line stays
const FLIGHT_TIMEOUT_MS = 5000;
const RESOLVE_TIMEOUT_MS = 6000;
const CHARGE_MS = 1400;       // the overlay's range meter, bottom to top

let S = null;                 // the reel, while it's open
let _skew = 0;                // server clock minus ours
let _host = null;             // the seat's root, when it has given us one
let _speciesOf = null;        // optional (schoolId, i) => speciesId, from the seat
let _root = null;             // the HUD's root element
let _E = null;                // its parts, found once at mount
let _overlayClose = null;     // set while mounted as our own overlay
let _serverClosing = false;
let _raf = 0;
let _lastT = 0;
let _listeners = [];
const _out = {};
const _beat = { i: 0, n: 0, nextAtServerMs: null };
const _catch = { species: null, kg: 0 };

/** The server's clock: ours plus the skew from `open`. */
export function serverNow() { return _env.now() + _skew; }
/** True while the reel is open. */
export function boatFishActive() { return !!S; }

// ── The state the seat reads every frame ─────────────────────────────────────────────────────────
// One object, updated in place and returned each call, so a frame allocates nothing. Read what you
// need from it in the frame; don't keep it. Null when the reel is shut.
export function boatFishState() {
  if (!S) return null;
  const o = _out;
  o.phase = S.phase;
  o.bearing = S.bearing;
  o.lineM = S.lineM;
  o.lx = S.lx; o.ly = S.ly;
  o.depthM = depthNow(_env.now());
  o.lean = S.lean; o.pull = S.pull;
  o.tension = S.tension; o.stamina = S.stamina;
  if (S.phase === 'bite' && S.beatN) {
    _beat.i = S.beatI; _beat.n = S.beatN;
    _beat.nextAtServerMs = S.beatI < S.beatN ? S.biteAt + S.times[S.beatI] : null;
    o.beat = _beat;
  } else o.beat = null;
  o.follow = S.follow;
  if (S.catch) { _catch.species = S.catch.species; _catch.kg = S.catch.kg; o.catch = _catch; } else o.catch = null;
  // Added to the contract on 2026-10-27: the seat aims with castM and draws from the anchor.
  o.castM = S.castM; o.skill = S.skill; o.ax = S.ax; o.ay = S.ay;
  // And what the seat needs to draw the same schools the server rolls (fish.js schoolsNear).
  o.env = S.env; o.thinned = S.thinned;
  return o;
}

// ── Messages from the server ─────────────────────────────────────────────────────────────────────
/** dispatch.js hands every `boatfish` message here. */
export function onBoatFishMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  const ph = msg.phase;
  if (ph === 'open') return open(msg);
  if (!S) return;
  if (ph === 'close') return shut(true);
  if (msg.token != null && String(msg.token) !== S.token) return;   // a stale cast's news
  const t = _env.now();
  switch (ph) {
    case 'lure': {
      S.phase = 'wait';
      S.lx = num(msg.lx, S.lx); S.ly = num(msg.ly, S.ly);
      S.lineM = num(msg.lineM, S.lineM);
      setDepth(num(msg.depthM, 0), t);
      S.floorM = num(msg.floorM, Infinity);
      S.lastTapAt = null; S.gap = null; S.follow = [];
      if (!_host) sfx('boatfish-plop');   // the seat plays its own splash
      break;
    }
    case 'twitch': {
      if (S.phase !== 'wait') { if (Array.isArray(msg.follow)) S.follow = msg.follow; break; }
      S.lx = num(msg.lx, S.lx); S.ly = num(msg.ly, S.ly);
      S.lineM = num(msg.lineM, S.lineM);
      setDepth(num(msg.depthM, depthNow(t)), t);
      S.follow = Array.isArray(msg.follow) ? msg.follow : [];
      break;
    }
    case 'reeled':
      startReel(t, 'ready');
      note('Nothing took it. The line\'s in.', t);
      break;
    case 'bite': {
      S.phase = 'bite';
      S.biteSpecies = msg.species || null;
      S.beatN = clamp(msg.beats | 0, 1, 4);
      S.times = beatTimes(S.beatN);
      S.biteAt = num(msg.biteAt, serverNow());
      S.beatI = 0; S.knocked = 0;
      S.beatRes = new Array(S.beatN).fill(null);
      S.biteSeenAt = t;
      sfx('boatfish-plip');
      break;
    }
    case 'fight':
      startFight(msg, t);
      break;
    case 'spat':
      toReady();
      card('It spat the hook.', msg.reason === 'late' ? 'You were late on a knock.'
        : msg.reason === 'missed' || msg.reason === 'miss' ? 'You missed a knock.' : '', t);
      break;
    case 'landed': {
      const name = nameOf(msg.species, msg.name);
      S.phase = 'landed'; S.lineM = 0; S.waitResolve = false;
      S.catch = { species: msg.species || null, kg: num(msg.kg, 0) };
      S.holdKg = num(msg.holdKg, S.holdKg); S.holdCap = num(msg.holdCap, S.holdCap);
      sfx('boatfish-splash');
      card(`${cap(name)}, ${num(msg.kg, 0).toFixed(2)} kg.`,
        `In the box. It's carrying ${S.holdKg.toFixed(2)} of ${fmt1(S.holdCap)} kg.`, t, true);
      break;
    }
    case 'full': {
      const name = nameOf(msg.species, msg.name);
      S.phase = 'landed'; S.lineM = 0; S.waitResolve = false;
      S.catch = { species: msg.species || null, kg: num(msg.kg, 0) };
      sfx('boatfish-splash');
      card(`${cap(name)}, ${num(msg.kg, 0).toFixed(2)} kg.`,
        'The box is full, so it goes back over the side.', t, true);
      break;
    }
    case 'lost': {
      const line = S.snapLine;
      toReady();
      const head = line ? 'The line broke and it got away.' : 'It got away.';
      card(head, msg.snapped ? 'The rod snapped as well.' : '', t);
      break;
    }
    default: break;
  }
  render(t);
}

function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function cap(s) { s = String(s || 'fish'); return s.charAt(0).toUpperCase() + s.slice(1); }
function nameOf(id, name) { return name || SPECIES[id]?.name || 'fish'; }

function open(msg) {
  if (S) shut(false, true);
  const t = _env.now();
  _skew = Number.isFinite(Number(msg.serverNow)) ? Number(msg.serverNow) - t : 0;
  S = {
    token: String(msg.token ?? ''),
    ax: num(msg.ax, 0), ay: num(msg.ay, 0),
    env: msg.env || null, thinned: msg.thinned || null,
    castM: num(msg.castM, 25), skill: num(msg.skill, 4),
    holdKg: num(msg.holdKg, 0), holdCap: num(msg.holdCap, 0),
    phase: 'ready', bearing: 0, lineM: 0, lx: null, ly: null,
    depthBase: 0, depthAt: t, floorM: Infinity,
    lean: 0, pull: 0, tension: 0, stamina: 1,
    follow: [], catch: null,
    lastTapAt: null, gap: null,
    aimBearing: 0, charging: false, chargeAt: 0,
    beatN: 0, beatI: 0, times: [], biteAt: 0, knocked: 0, beatRes: [],
    board: null, side: 1, nextSwitchAt: 0, jumpUntil: 0, nextJumpAt: 0,
    holdL: false, holdR: false, dragLean: 0, dragging: false, dragX: 0,
    snapLine: false, waitResolve: false, resolveAt: 0,
    reelFrom: 0, reelAt: 0, reelDur: 0, reelThen: null, lastClickAt: 0, lastZingAt: 0,
    card: null, cardUntil: 0, note: null, noteUntil: 0,
  };
  mount();
  _lastT = t;
  if (!_raf) _raf = _env.raf(frame);
  try { window.AudioEngine?.init?.(); } catch { /* no audio */ }
  sfx('boatfish-click');
  render(t);
}

function toReady() {
  if (!S) return;
  Object.assign(S, {
    phase: 'ready', lineM: 0, lx: null, ly: null, depthBase: 0, follow: [], catch: null,
    lean: 0, pull: 0, tension: 0, stamina: 1, board: null, beatN: 0, beatI: 0,
    lastTapAt: null, gap: null, snapLine: false, waitResolve: false, reelThen: null,
    holdL: false, holdR: false, dragLean: 0, dragging: false, charging: false,
  });
}

// ── Casting ──────────────────────────────────────────────────────────────────────────────────────
/** The seat calls this when its aim releases. Degrees off the bow (starboard positive), metres. */
export function boatFishCast(bearingDeg, rangeM) {
  if (!S || (S.phase !== 'ready' && S.phase !== 'landed')) return false;
  const t = _env.now();
  let b = Number(bearingDeg), r = Number(rangeM);
  if (!Number.isFinite(b) || !Number.isFinite(r)) return false;
  b = ((b + 180) % 360 + 360) % 360 - 180;
  r = Math.min(r, S.castM);
  if (r < CAST_MIN_M) { note('Too short to count. Cast again.', t); render(t); return false; }
  if (S.phase === 'landed') toReady();
  S.card = null;
  send(`fishcast boat ${fmt1(b)} ${fmt1(r)} ${S.token}`);
  S.phase = 'flight'; S.bearing = b; S.lineM = r; S.flightAt = t;
  if (!_host) sfx('boatfish-cast');
  render(t);
  return true;
}

// The overlay's own cast, with no seat to aim it: A/D swing the bearing, Space charges the range.
function chargeStart(t) { if (S.charging) return; S.charging = true; S.chargeAt = t; sfx('fishing-charge'); }
function chargeRange(t) {
  const p = ((t - S.chargeAt) / CHARGE_MS) % 2;
  const f = p < 1 ? p : 2 - p;
  return CAST_MIN_M + (S.castM - CAST_MIN_M) * f;
}
function chargeRelease(t) {
  if (!S.charging) return;
  S.charging = false;
  boatFishCast(S.aimBearing, chargeRange(t));
}

// ── The lure ─────────────────────────────────────────────────────────────────────────────────────
function setDepth(d, t) { S.depthBase = d; S.depthAt = t; }
function depthNow(t) {
  if (!S || S.phase !== 'wait') return S ? S.depthBase : 0;
  return Math.min(S.floorM, S.depthBase + SINK_MPS * Math.max(0, t - S.depthAt) / 1000);
}

// Wind the whole line in now, rather than twitching it the rest of the way.
function reelNow() {
  if (!S || S.phase !== 'wait') return;
  send(`fishtwitch ${S.token} reel`);
}

function twitch(t) {
  if (S.lastTapAt != null && t - S.lastTapAt < TWITCH_MIN_MS) return false;   // one tap, not two
  S.gap = S.lastTapAt == null ? null : t - S.lastTapAt;
  S.lastTapAt = t;
  send(`fishtwitch ${S.token}`);
  // Drawn straight away; the server's `twitch` corrects it.
  S.lineM = Math.max(0, S.lineM - TWITCH_M);
  setDepth(Math.max(0, depthNow(t) - TWITCH_LIFT_M), t);
  sfx('boatfish-plip');
  return true;
}

// ── The strike ───────────────────────────────────────────────────────────────────────────────────
function strike(t) {
  if (S.beatI >= S.beatN) return false;
  const sn = t + _skew;
  const i = S.beatI;
  const due = S.biteAt + S.times[i];
  if (sn < due - EARLY_TAP_MS) return false;   // nowhere near a knock yet
  send(`fishstrike ${i} ${Math.round(sn)} ${S.token}`);
  S.beatRes[i] = onBeat(sn - S.biteAt, i, S.beatN) ? 'hit' : 'off';
  S.beatI++;
  sfx('boatfish-click');
  return true;
}

function stepBite(t) {
  const sn = t + _skew;
  while (S.knocked < S.beatN && sn >= S.biteAt + S.times[S.knocked]) { S.knocked++; sfx('boatfish-knock'); }
  const i = S.beatI;
  if (i < S.beatN && sn > S.biteAt + S.times[i] + BEAT_WINDOW_MS + LATENCY_SLACK_MS) {
    S.beatRes[i] = 'miss';
    S.beatI = S.beatN;            // the server spits it; nothing more to hit
    note('Missed.', t);
  }
  // No word from the server long after the last knock: don't leave the float hanging.
  if (sn > S.biteAt + S.times[S.beatN - 1] + RESOLVE_TIMEOUT_MS) toReady();
}

// ── The fight ────────────────────────────────────────────────────────────────────────────────────
function startFight(msg, t) {
  const kg = num(msg.kg, 1), difficulty = num(msg.difficulty, 5), skill = num(msg.skill, S.skill);
  const lineM = num(msg.lineM, S.lineM);
  const fight = msg.fight || SPECIES[msg.species]?.fight || 'steady';
  const b = fightBoard({ kg, difficulty, fight, skill, lineM });
  S.phase = 'fight';
  S.board = b;
  S.stamina = b.stamina; S.tension = b.tension; S.lineM = b.lineM;
  S.lineCap = Math.max(S.castM, lineM) * 1.4;
  S.side = Math.random() < 0.5 ? -1 : 1;
  S.pull = 0; S.pullMag = 0; S.lean = 0; S.dragLean = 0;
  S.switchedAt = t;
  S.nextSwitchAt = t + b.switchMs;
  S.nextJumpAt = b.jumps ? t + 2500 + Math.random() * 2500 : Infinity;
  S.jumpUntil = 0;
  S.fightAt = t;
  S.minEnd = t + minFightMs({ kg, difficulty, skill, lineM }) + 150;
  S.catch = { species: msg.species || null, kg };
  S.catchName = nameOf(msg.species, msg.name);
  S.snapLine = false;
  sfx('fishing-bite');
}

function stepFight(t, dt) {
  const b = S.board;
  if (S.stamina > 0 && t >= S.nextSwitchAt) {
    S.side = -S.side;
    S.switchedAt = t;
    S.nextSwitchAt = t + b.switchMs * (0.75 + Math.random() * 0.5);
    if (b.surge && Math.random() < b.surge) { S.surgeUntil = t + SURGE_MS; note('It surges. Give it line.', t); sfx('boatfish-zing'); }
  }
  if (t >= S.nextJumpAt) { S.jumpUntil = t + 550; S.nextJumpAt = t + 3000 + Math.random() * 3000; note('It jumps.', t); sfx('boatfish-plop'); }
  const jumping = t < S.jumpUntil;
  const surging = t < (S.surgeUntil || 0);
  const target = S.holdL && !S.holdR ? -1 : S.holdR && !S.holdL ? 1 : S.dragLean;
  S.lean += clamp(target - S.lean, -LEAN_RATE * dt, LEAN_RATE * dt);
  const mag = S.stamina > 0 ? b.pull * (0.45 + 0.55 * S.stamina) * (jumping ? 1.6 : surging ? 1.8 : 1) : 0;
  // The side shows at once (the player reacts to it); only the strength eases in.
  S.pullMag += (mag - S.pullMag) * Math.min(1, dt * 8);
  S.pull = S.side * S.pullMag;
  if (S.stamina > 0) {
    const q = clamp(-S.lean * S.side, 0, 1);    // how hard you're leaning against it
    if (surging) {
      // A surge: leaning into it strains the line; easing off gives it line and it tires itself.
      if (q > 0.25) S.tension += b.strain * 1.6 * q * dt;
      else S.stamina = Math.max(0, S.stamina - b.tire * 0.6 * dt);
      S.lineM += b.runMps * mag * dt;
      if (S.lineM > S.lineCap) { S.lineM = S.lineCap; S.tension += 0.6 * dt; }
    } else if (q > 0.25) {
      S.stamina = Math.max(0, S.stamina - b.tire * q * dt);
      S.tension = Math.max(0, S.tension - 0.5 * q * dt + (b.heavy || 0) * dt);
      S.lineM = Math.max(0, S.lineM - b.gainMps * q * dt);
    } else if (t - S.switchedAt < TURN_MS) {
      // The fish is still turning. A wriggler switches every 600 ms, and without this the time it
      // takes anyone to see the switch and lean across was most of every run, so it never landed.
    } else {
      const wrong = S.lean * S.side > 0.25 ? 1.6 : 1;
      S.tension += b.strain * mag * wrong * dt;
      S.lineM += b.runMps * mag * dt;
      if (S.lineM > S.lineCap) { S.lineM = S.lineCap; S.tension += 0.6 * dt; }
    }
  } else {
    // Spent: it comes in on the reel, and the strain comes off.
    S.tension = Math.max(0, S.tension - 0.4 * dt);
    S.lineM = Math.max(0, S.lineM - b.gainMps * 0.8 * dt);
  }
  if (S.tension > 0.7 && t - S.lastZingAt > 380) { S.lastZingAt = t; sfx('boatfish-zing'); }
  if (S.tension >= 1) {
    S.tension = 1; S.snapLine = true;
    send(`fishresolve boat 0 ${S.token}`);
    sfx('boatfish-snap');
    startReel(t, null, 600);
    S.waitResolve = true; S.resolveAt = t;
  } else if (S.stamina <= 0 && S.lineM <= LAND_M) {
    // Never finish sooner than the server's minFightMs, or it refuses the win.
    startReel(t, 'resolve', Math.max(S.lineM / REEL_MPS * 1000, S.minEnd - t, 700));
  }
}

// ── Reeling in ───────────────────────────────────────────────────────────────────────────────────
function startReel(t, then, durMs) {
  S.phase = 'reeling';
  S.reelFrom = S.lineM; S.reelAt = t;
  S.reelDur = durMs ?? Math.max(500, S.lineM / REEL_MPS * 1000);
  S.reelThen = then;
  S.follow = [];
}
function stepReel(t) {
  const p = clamp((t - S.reelAt) / S.reelDur, 0, 1);
  S.lineM = S.reelFrom * (1 - p);
  S.lean *= 0.9; S.pull *= 0.85;
  if (p < 1 && t - S.lastClickAt > 110) { S.lastClickAt = t; sfx('boatfish-click'); }
  if (p >= 1 && S.reelThen) {
    const then = S.reelThen;
    S.reelThen = null;
    if (then === 'ready') toReady();
    else if (then === 'resolve') { send(`fishresolve boat 1 ${S.token}`); S.waitResolve = true; S.resolveAt = t; }
  }
  if (S.waitResolve && t - S.resolveAt > RESOLVE_TIMEOUT_MS) toReady();
}

// ── Status lines and cards ───────────────────────────────────────────────────────────────────────
function note(text, t) { S.note = text; S.noteUntil = t + NOTE_MS; }
function card(title, body, t, keepPhase = false) {
  S.card = { title, body };
  S.cardUntil = t + CARD_MS;
  S.cardPhase = keepPhase;
}

const COUNT = ['', 'One', 'Two', 'Three', 'Four', 'Five'];
function tempoWords(ms) { return ms < 450 ? 'Quick taps.' : ms < 700 ? 'Steady taps.' : ms < 1100 ? 'Slow taps.' : 'Long pauses.'; }
function followSpecies() {
  for (const f of S.follow) {
    const id = f?.species || f?.sp || (_speciesOf ? safe(() => _speciesOf(f.school, f.i)) : null);
    if (id && SPECIES[id]) return id;
  }
  return null;
}
function safe(fn) { try { return fn(); } catch { return null; } }

function statusLine(t) {
  if (S.note && t < S.noteUntil) return S.note;
  switch (S.phase) {
    case 'ready': return _host ? 'Cast when you\'re ready.' : 'Aim with A and D. Hold Cast or Space, then let go.';
    case 'flight': return 'The line\'s out.';
    case 'wait': return 'Tap to twitch it in. Keep a rhythm. Reel in to cast again.';
    case 'bite': return 'Bite. Hit each knock.';
    case 'fight':
      if (S.stamina <= 0) return 'It\'s tired. Bring it in.';
      return S.side < 0 ? 'It\'s running to port. Lean to starboard.' : 'It\'s running to starboard. Lean to port.';
    case 'reeling': return S.snapLine ? 'The line\'s gone slack.' : 'Reeling in.';
    case 'landed': return '';
    default: return '';
  }
}
const PHASE_LABEL = { ready: 'READY', flight: 'CAST', wait: 'LURE', bite: 'BITE', fight: 'ON THE LINE', reeling: 'REELING', landed: 'LANDED' };
// The big button is the verb you'd type: fish <bearing> <metres>, fish twitch, fish strike. The CSS
// hides it in the phases where it has no verb.
const ACT_LABEL = { ready: 'Cast', wait: 'Twitch', bite: 'Strike' };

// ── The frame ────────────────────────────────────────────────────────────────────────────────────
function frame() {
  _raf = 0;
  if (!S) return;
  const t = _env.now();
  const dt = clamp((t - _lastT) / 1000 || 0, 0, 0.05);
  _lastT = t;
  try {
    if (S.phase === 'flight' && t - S.flightAt > FLIGHT_TIMEOUT_MS) { toReady(); note('The cast didn\'t take.', t); }
    else if (S.phase === 'bite') stepBite(t);
    else if (S.phase === 'fight') stepFight(t, dt);
    else if (S.phase === 'reeling') stepReel(t);
    if (S && S.card && t >= S.cardUntil) {
      S.card = null;
      if (S.phase === 'landed') toReady();
    }
    if (S) render(t);
  } catch (e) {
    console.error('[boatfish] frame:', e?.message);
  }
  if (S) _raf = _env.raf(frame);
}

// ── Input ────────────────────────────────────────────────────────────────────────────────────────
function keyOf(e) {
  const c = e.code || '', k = e.key || '';
  if (c === 'Space' || k === ' ' || k === 'Spacebar') return 'space';
  if (c === 'KeyA' || c === 'ArrowLeft' || k === 'ArrowLeft' || k === 'a' || k === 'A') return 'left';
  if (c === 'KeyD' || c === 'ArrowRight' || k === 'ArrowRight' || k === 'd' || k === 'D') return 'right';
  return null;
}

/**
 * The seat's capture-phase key handler offers every key here first while the reel is open.
 * Returns true when the reel used it, so the seat doesn't also act on it.
 */
export function boatFishKey(e, down) {
  if (!S || !e) return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  const k = keyOf(e);
  if (!k) return false;
  const t = _env.now();
  const ph = S.phase;
  if (k === 'space') {
    if (ph === 'ready') {
      if (_host) return false;              // the seat's aim owns Space while you're aiming
      if (down && !e.repeat) chargeStart(t); else if (!down) chargeRelease(t);
      render(t);
      return true;
    }
    if (down && !e.repeat) actDown(t);
    render(t);
    return true;
  }
  const isL = k === 'left';
  if (ph === 'fight' || (!down && (isL ? S.holdL : S.holdR))) {
    if (isL) S.holdL = !!down; else S.holdR = !!down;
    return true;
  }
  if (ph === 'ready' && !_host) {
    if (down) { S.aimBearing = clamp(S.aimBearing + (isL ? -5 : 5), -170, 170); render(t); }
    return true;
  }
  return false;
}

function actDown(t) {
  if (!S) return;
  switch (S.phase) {
    case 'ready': if (!_host) chargeStart(t); break;
    case 'wait': twitch(t); break;
    case 'bite': strike(t); break;
    case 'landed': S.card = null; toReady(); break;
    default: break;
  }
}
function actUp(t) { if (S && S.phase === 'ready' && !_host) chargeRelease(t); }

function on(target, type, fn, opts) { target.addEventListener(type, fn, opts); _listeners.push([target, type, fn, opts]); }
function offAll() { for (const [tg, ty, fn, o] of _listeners) { try { tg.removeEventListener(ty, fn, o); } catch { /* gone */ } } _listeners = []; }

function wire() {
  const E = _E;
  const now = () => _env.now();
  on(E.act, 'pointerdown', (e) => { e.preventDefault?.(); actDown(now()); render(now()); });
  on(window, 'pointerup', () => { actUp(now()); if (S) { S.holdL = false; S.holdR = false; S.dragging = false; } });
  on(window, 'pointercancel', () => { if (S) { S.holdL = false; S.holdR = false; S.dragging = false; } });
  // The thumb buttons lean in the fight. In the overlay's ready, with no seat to aim, they aim.
  const thumb = (isL) => (e) => {
    e.preventDefault?.();
    if (!S) return;
    if (S.phase === 'ready' && !_host) { S.aimBearing = clamp(S.aimBearing + (isL ? -5 : 5), -170, 170); render(now()); return; }
    if (isL) S.holdL = true; else S.holdR = true;
  };
  on(E.left, 'pointerdown', thumb(true));
  on(E.right, 'pointerdown', thumb(false));
  on(E.left, 'pointerleave', () => { if (S) S.holdL = false; });
  on(E.right, 'pointerleave', () => { if (S) S.holdR = false; });
  // A drag on the lean bar moves the lean by how far you drag, and it stays where you leave it.
  on(E.leanpad, 'pointerdown', (e) => { if (!S) return; e.preventDefault?.(); S.dragging = true; S.dragX = e.clientX || 0; });
  on(window, 'pointermove', (e) => {
    if (!S || !S.dragging) return;
    const x = e.clientX || 0;
    S.dragLean = clamp(S.dragLean + (x - S.dragX) / DRAG_PX, -1, 1);
    S.dragX = x;
  });
  // The strike pad is a tap target too, the size of a thumb.
  on(E.strike, 'pointerdown', (e) => { e.preventDefault?.(); actDown(now()); render(now()); });
  on(E.reel, 'click', () => reelNow());
  on(E.stow, 'click', () => send('stand'));
  if (!_host) {
    on(window, 'keyup', (e) => { if (boatFishKey(e, false)) e.preventDefault?.(); });
  }
}

// ── Mounting ─────────────────────────────────────────────────────────────────────────────────────
function ensureStyles() {
  if (document.getElementById('boatfish-styles')) return;
  const s = document.createElement('style');
  s.id = 'boatfish-styles';
  s.textContent = BOATFISH_CSS;
  document.head.appendChild(s);
}

const RINGS = '<span class="bf-ring"></span><span class="bf-ring"></span><span class="bf-ring"></span><span class="bf-ring"></span>';
function hudHtml() {
  return `<div class="bf-read">
      <div class="bf-phase" data-r="phase">READY</div>
      <div class="bf-linegauge"><span class="bf-boat"></span><span class="bf-track"><i class="bf-lure" data-r="lure"></i></span></div>
      <div class="bf-nums"><span data-r="out"></span><span data-r="depth"></span></div>
      <div class="bf-follow" data-r="follow"></div>
      <div class="bf-tempo"><span class="bf-lamp" data-r="lamp"></span><span data-r="tempo"></span></div>
    </div>
    <div class="bf-strike" data-r="strike"><span class="bf-mark"></span>${RINGS}</div>
    <div class="bf-fight" data-r="fight">
      <div class="bf-meter"><span class="bf-mlabel">LINE</span><span class="bf-bar bf-tension"><i data-r="tension"></i></span></div>
      <div class="bf-meter"><span class="bf-mlabel">FISH</span><span class="bf-bar bf-stamina"><i data-r="stamina"></i></span></div>
      <div class="bf-leanpad" data-r="leanpad"><span class="bf-port">PORT</span><span class="bf-stbd">STBD</span><i class="bf-pull" data-r="pull"></i><i class="bf-lean" data-r="lean"></i></div>
    </div>
    <div class="bf-status" data-r="status"></div>
    <div class="bf-card" data-r="card"><div class="bf-card-title" data-r="ctitle"></div><div class="bf-card-body" data-r="cbody"></div></div>
    <div class="bf-controls">
      <button class="bf-btn bf-thumb bf-left" data-r="left" aria-label="Lean to port">&#9664; Port</button>
      <button class="bf-btn bf-act" data-r="act">Twitch</button>
      <button class="bf-btn bf-reel" data-r="reel" title="fish reel">Reel in</button>
      <button class="bf-btn bf-thumb bf-right" data-r="right" aria-label="Lean to starboard">Stbd &#9654;</button>
    </div>
    <button class="bf-btn bf-stow" data-r="stow" title="stand">Stow</button>`;
}

function findParts(root) {
  const q = (r) => root.querySelector(`[data-r="${r}"]`);
  const E = {};
  for (const r of ['phase', 'lure', 'out', 'depth', 'follow', 'lamp', 'tempo', 'strike', 'fight', 'tension', 'stamina',
    'leanpad', 'pull', 'lean', 'status', 'card', 'ctitle', 'cbody', 'left', 'act', 'reel', 'right', 'stow']) E[r] = q(r);
  E.rings = Array.from(root.querySelectorAll('.bf-ring') || []);
  E.last = {};
  return E;
}

function mount() {
  unmount();
  ensureStyles();
  if (_host) {
    _root = document.createElement('div');
    _root.className = 'bf-hud bf-hosted';
    _root.innerHTML = hudHtml();
    _host.appendChild(_root);
  } else {
    ensureChassisStyles();
    const m = mountOverlay({
      id: 'boatfish-overlay',
      html: `<div class="bf-panel mg-chassis">${deviceHeader('&#127907;', 'THE BOAT REEL', 'AT ANCHOR')}<div class="bf-hud bf-standalone">${hudHtml()}</div></div>`,
      closeOnBackdrop: false,
      onKey: (e) => { if (boatFishKey(e, true)) e.preventDefault?.(); },
      onClose: () => {
        _overlayClose = null;
        // Closed by the player (the close button or Escape), not by the server: stop fishing for
        // real, and shut here too in case the server's `close` never comes.
        if (!_serverClosing && S) { send('stand'); shut(false, true); }
      },
    });
    _overlayClose = m.close;
    _root = m.overlay.querySelector('.bf-hud');
    m.overlay.querySelector('.mg-close')?.addEventListener('click', () => m.close());
  }
  _E = findParts(_root);
  wire();
}

function unmount() {
  offAll();
  if (_overlayClose) { _serverClosing = true; const c = _overlayClose; _overlayClose = null; c(); _serverClosing = false; }
  if (_root && _root.parentNode) _root.remove();
  _root = null; _E = null;
}

function shut(fromServer, quiet = false) {
  if (_raf) { _env.caf(_raf); _raf = 0; }
  _serverClosing = !!fromServer || quiet;
  unmount();
  _serverClosing = false;
  S = null;
}

/** The seat gives its root to mount the HUD in. Options: { speciesOf(schoolId, i) } for the tempo cue. */
export function attachBoatFishHost(el, opts = {}) {
  _host = el || null;
  _speciesOf = typeof opts?.speciesOf === 'function' ? opts.speciesOf : null;
  if (S) { mount(); render(_env.now()); }
}
/** The seat is going: fall back to our own overlay if the reel is still open. */
export function detachBoatFishHost() {
  if (!_host) return;
  _host = null; _speciesOf = null;
  if (S) { mount(); render(_env.now()); }
  else unmount();
}

// ── Drawing the HUD ──────────────────────────────────────────────────────────────────────────────
function put(key, el, text) {
  if (!el || _E.last[key] === text) return;
  _E.last[key] = text;
  el.textContent = text;
}
function setStyle(el, prop, v) { if (el && el.style[prop] !== v) el.style[prop] = v; }

function render(t) {
  if (!S || !_E || !_root) return;
  const E = _E;
  if (_root.dataset && _root.dataset.phase !== S.phase) _root.dataset.phase = S.phase;
  if (_root.dataset) {
    const c = S.card ? '1' : '0';
    if (_root.dataset.card !== c) _root.dataset.card = c;
  }
  put('phase', E.phase, PHASE_LABEL[S.phase] || '');
  put('act', E.act, S.phase === 'ready' && S.charging ? 'Casting' : (ACT_LABEL[S.phase] || ''));
  put('status', E.status, statusLine(t));

  // The line gauge: the lure's distance from the boat against the rod's reach.
  const reach = Math.max(S.castM, S.lineM, 1);
  const lineShown = S.phase === 'ready' && S.charging ? chargeRange(t) : S.lineM;
  setStyle(E.lure, 'left', `${(clamp(lineShown / reach, 0, 1) * 100).toFixed(1)}%`);
  if (S.phase === 'ready') {
    const b = Math.round(S.aimBearing);
    put('out', E.out, _host ? `Reach ${Math.round(S.castM)} m` : `${b === 0 ? 'Dead ahead' : `${Math.abs(b)}° ${b < 0 ? 'port' : 'starboard'}`}, ${Math.round(lineShown)} m`);
    put('depth', E.depth, '');
  } else {
    put('out', E.out, `${Math.round(S.lineM)} m out`);
    put('depth', E.depth, S.phase === 'wait' || S.phase === 'flight' ? `${Math.round(depthNow(t))} m deep` : '');
  }

  // Who's following, and the tempo they like.
  let fol = '', tempo = '', T = 0;
  if (S.phase === 'wait') {
    const n = S.follow.length;
    const sp = followSpecies();
    if (sp) { T = tempoOf(sp); fol = `${cap(SPECIES[sp].name)}${n > 1 ? ` and ${n - 1} more` : ''} following.`; tempo = tempoWords(T); }
    else if (n) fol = `${COUNT[n] || n} following.`;
    if (!T && S.gap) { T = S.gap; tempo = `You're tapping every ${fmt1(S.gap / 1000)} s.`; }
  }
  put('follow', E.follow, fol);
  put('tempo', E.tempo, tempo);
  if (E.lamp) {
    const lit = T > 0 && S.lastTapAt != null && ((t - S.lastTapAt) % T) < 110;
    if (E.last.lamp !== lit) { E.last.lamp = lit; E.lamp.classList.toggle('on', lit); }
  }

  // The knocks: a ring for each closes on the mark and meets it on the beat.
  if (S.phase === 'bite') {
    const sn = t + _skew;
    for (let k = 0; k < E.rings.length; k++) {
      const el = E.rings[k];
      if (k >= S.beatN) { setStyle(el, 'opacity', '0'); continue; }
      const dtb = S.biteAt + S.times[k] - sn;
      const res = S.beatRes[k];
      const shown = !res && dtb < 1400 && dtb > -BEAT_WINDOW_MS * 2;
      setStyle(el, 'opacity', shown ? (dtb > 1000 ? ((1400 - dtb) / 400).toFixed(2) : '1') : (res ? '0.35' : '0'));
      setStyle(el, 'transform', `scale(${(1 + Math.max(dtb, 0) / 1400 * 2.4).toFixed(3)})`);
      const cls = res || (Math.abs(dtb) <= BEAT_WINDOW_MS ? 'now' : '');
      if (E.last['ring' + k] !== cls) {
        E.last['ring' + k] = cls;
        for (const c of ['hit', 'off', 'miss', 'now']) el.classList.toggle(c, c === cls);
      }
    }
  }

  // The fight's meters.
  if (S.phase === 'fight' || S.phase === 'reeling') {
    setStyle(E.tension, 'width', `${Math.round(clamp(S.tension, 0, 1) * 100)}%`);
    setStyle(E.stamina, 'width', `${Math.round(clamp(S.stamina, 0, 1) * 100)}%`);
    setStyle(E.pull, 'left', `${(50 + S.pull * 45).toFixed(1)}%`);
    setStyle(E.lean, 'left', `${(50 + S.lean * 45).toFixed(1)}%`);
    const hot = S.tension > 0.7;
    if (E.last.hot !== hot) { E.last.hot = hot; E.tension?.classList.toggle('hot', hot); }
  }

  if (S.card) {
    put('ctitle', E.ctitle, S.card.title);
    put('cbody', E.cbody, S.card.body);
  }
}
