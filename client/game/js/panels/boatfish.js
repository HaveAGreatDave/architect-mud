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
//   bite      a fish is at the lure. The float does what the server's script says (floatPose); the
//             lens shows it close up. One strike, stamped in server time (fishstrike <hitServerMs>):
//             on a nibble it's too soon, past the window it's too late, and the server's `spat` puts
//             you back in `wait` with the lure still out. How well it's timed is how well it's hooked.
//   fight     the rules' stepFight: lean against the fish, wind when you can, let it run, wind hard
//             when it swims at you, ease off when it jumps. Tension 1 snaps the line; slack too long
//             and the hook drops out (both fishresolve boat 0). Spent and inside LAND_M, on to `net`.
//   net       it rolls past the boat, and you time the net (fishresolve boat 1), never sooner than
//             minFightMs. A miss sends it off for one more short run.
//   reeling   the line winding in, after `reeled`, a net or a snap.
//   landed    the catch card, after `landed` or `full`. Back to ready after it.
//
// The seat (boat-view.js) owns the aim, the landing ring and drawing the rod, line, lure and
// angler; it reads boatFishState() every frame for those. This file owns the HUD over the seat,
// or its own overlay when no seat is attached (the text rung, or before the seat opens).
//
// Time: the server's clock is the client's plus the skew taken from `open`'s serverNow. Every beat
// is judged in server time, so serverNow() is what a strike is stamped with.

import { sendCmdSilent } from '../net.js';
import { sfx, mountOverlay, ensureChassisStyles, deviceHeader } from './minigame-common.js';
import { loadCss } from '../../../shared/dom.js';
import { SPECIES } from '../../../shared/fish.js';
import { paintFloat, paintFight, paintNet } from './float-cam.js';
import { paintCatch } from './fish-portrait.js';
import {
  TWITCH_M, TWITCH_LIFT_M, TWITCH_MIN_MS, SINK_MPS, CAST_MIN_M,
  tempoOf, LATENCY_SLACK_MS, floatPose, setWords, fightBoard, fightState, stepFight, minFightMs, netSwing,
  LAND_M, SLACK_AT, NET_TRIES, JUMP_MS,
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
/** For a headless gate or a test page: replace the clock, the frame pump or the wire. */
export function boatFishTestHooks(over = {}) { Object.assign(_env, over); }

const send = (cmd) => (_env.send ? _env.send(cmd) : sendCmdSilent(cmd));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fmt1 = (v) => String(Math.round(v * 10) / 10);

// ── Tuning that is the client's alone (feel, not rules) ──────────────────────────────────────────
const DRAG_PX = 140;          // pixels of drag for a full lean
// A tap this soon after the bite is the last of the twitches, still on its way down, not a strike.
const STRIKE_GRACE_MS = 450;
const REEL_MPS = 9;           // the auto reel-in's speed
const NET_READY_MS = 900;     // from the fish coming alongside to the net being in the water
const NET_FLASH_MS = 420;     // how long a missed net shows
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
const _pose = {};
const _catch = { species: null, kg: 0 };
const _fish = { school: null, i: 0, species: null };

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
  // What the fish is doing, and the moments the seat draws: the take, the jump, the net.
  o.mode = S.F ? S.F.mode : null;
  o.wind = !!S.windHeld;
  o.set = S.set || 0;
  o.jumpAt = S.jumpAt || 0;
  o.struckAt = S.struckAt || 0;
  o.pose = S.phase === 'bite' && S.script ? floatPose(S.script, _env.now() + _skew - S.biteAt, _pose) : null;
  o.net = S.phase === 'net' ? netPos(_env.now()) : null;
  o.netAt = S.netAt || 0;
  if (S.biteFish) { _fish.school = S.biteFish.school; _fish.i = S.biteFish.i; _fish.species = S.biteFish.species; o.fish = _fish; } else o.fish = null;
  o.follow = S.follow;
  if (S.catch) { _catch.species = S.catch.species; _catch.kg = S.catch.kg; o.catch = _catch; } else o.catch = null;
  // Added to the contract on 2026-10-27: the seat aims with castM and draws from the anchor.
  o.castM = S.castM; o.skill = S.skill; o.ax = S.ax; o.ay = S.ay;
  o.holdKg = S.holdKg; o.holdCap = S.holdCap;
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
      if (msg.thinned && typeof msg.thinned === 'object') S.thinned = msg.thinned;   // the take at the cast, for the shadows
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
      S.biteFish = { school: msg.school ?? null, i: msg.i | 0, species: msg.species || null };
      S.script = msg.script || null;
      S.biteAt = num(msg.biteAt, serverNow());
      S.biteSeenAt = t;
      S.nibbled = 0; S.took = false; S.struckAt = 0; S.struck = false;
      sfx('boatfish-plip');
      break;
    }
    case 'fight':
      startFight(msg, t);
      break;
    case 'spat': {
      // The fish has gone. The lure's still out unless a strike pulled it home.
      const early = msg.reason === 'early';
      S.script = null; S.struck = false; S.biteFish = null;
      if (msg.reeled) toReady();
      else {
        S.phase = 'wait';
        S.lx = num(msg.lx, S.lx); S.ly = num(msg.ly, S.ly); S.lineM = num(msg.lineM, S.lineM);
        setDepth(num(msg.depthM, S.depthBase), t);
        S.lastTapAt = null; S.gap = null; S.follow = [];
      }
      card(early ? 'Too soon.' : 'Too slow.', early ? 'You pulled it out of its mouth.' : 'It dropped the lure and left.', t, true);
      break;
    }
    case 'landed': {
      const name = nameOf(msg.species, msg.name);
      S.phase = 'landed'; S.lineM = 0; S.waitResolve = false;
      S.catch = { species: msg.species || null, kg: num(msg.kg, 0) };
      S.holdKg = num(msg.holdKg, S.holdKg); S.holdCap = num(msg.holdCap, S.holdCap);
      if (msg.thinned && typeof msg.thinned === 'object') S.thinned = msg.thinned;   // one fewer in that school's shadow
      sfx('boatfish-splash');
      card(`${cap(name)}, ${num(msg.kg, 0).toFixed(2)} kg.`,
        `In the box. It's carrying ${S.holdKg.toFixed(2)} of ${fmt1(S.holdCap)} kg.`, t, true);
      showCatch(msg.species, num(msg.kg, 0));
      break;
    }
    case 'full': {
      const name = nameOf(msg.species, msg.name);
      S.phase = 'landed'; S.lineM = 0; S.waitResolve = false;
      S.catch = { species: msg.species || null, kg: num(msg.kg, 0) };
      sfx('boatfish-splash');
      card(`${cap(name)}, ${num(msg.kg, 0).toFixed(2)} kg.`,
        'The box is full, so it goes back over the side.', t, true);
      showCatch(msg.species, num(msg.kg, 0));
      break;
    }
    case 'lost': {
      const line = S.snapLine, threw = S.threw;
      toReady();
      const head = line ? 'The line broke and it got away.' : threw ? 'The hook pulled out and it got away.' : 'It got away.';
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
    script: null, biteAt: 0, biteFish: null, nibbled: 0, took: false, struck: false, struckAt: 0, set: 0,
    board: null, F: null, jumpAt: 0, netAt: 0, netOpenAt: 0, netTries: 0, netFlashAt: 0,
    holdL: false, holdR: false, windHeld: false, dragLean: 0, dragging: false, dragX: 0,
    snapLine: false, threw: false, waitResolve: false, resolveAt: 0,
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
    lean: 0, pull: 0, tension: 0, stamina: 1, board: null, F: null, script: null, biteFish: null, set: 0,
    lastTapAt: null, gap: null, snapLine: false, threw: false, waitResolve: false, reelThen: null,
    holdL: false, holdR: false, windHeld: false, dragLean: 0, dragging: false, charging: false,
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
// One, and the server judges it. It goes whenever you press, because pressing on a nibble is the
// mistake the whole phase is about. The tap that was already on its way down isn't a strike.
function strike(t) {
  if (S.struck || !S.script) return false;
  if (t - S.biteSeenAt < STRIKE_GRACE_MS) return false;
  S.struck = true; S.struckAt = t;
  send(`fishstrike ${Math.round(t + _skew)} ${S.token}`);
  sfx('boatfish-strike');
  return true;
}

function stepBite(t) {
  const rel = t + _skew - S.biteAt, K = S.script;
  if (!K) return;
  while (S.nibbled < K.nibbles.length && rel >= K.nibbles[S.nibbled].at) { S.nibbled++; sfx('boatfish-nibble'); }
  if (!S.took && rel >= K.takeAt) { S.took = true; sfx(K.kind === 'lift' ? 'boatfish-plip' : 'boatfish-take'); }
  // No word from the server long after the window: don't leave the float hanging.
  if (rel > K.takeAt + K.windowMs + LATENCY_SLACK_MS * 2 + RESOLVE_TIMEOUT_MS) toReady();
}

// ── The fight ────────────────────────────────────────────────────────────────────────────────────
function startFight(msg, t) {
  const kg = num(msg.kg, 1), difficulty = num(msg.difficulty, 5), skill = num(msg.skill, S.skill);
  const lineM = num(msg.lineM, S.lineM), set = num(msg.set, 0.6);
  const fight = msg.fight || SPECIES[msg.species]?.fight || 'steady';
  const b = fightBoard({ kg, difficulty, fight, skill, lineM, set });
  S.phase = 'fight';
  S.board = b;
  S.F = fightState(b);
  S.set = set;
  S.stamina = 1; S.tension = b.tension; S.lineM = b.lineM;
  S.pull = 0; S.lean = 0; S.dragLean = 0;
  S.fightAt = t;
  S.minEnd = t + minFightMs({ kg, difficulty, skill, lineM }) + 150;
  S.catch = { species: msg.species || null, kg };
  S.catchName = nameOf(msg.species, msg.name);
  S.snapLine = false; S.threw = false; S.jumpAt = 0;
  S.script = null;
  sfx('fishing-bite');
  note(setWords(set) === 'solid' ? 'Hooked solid.' : setWords(set) === 'good' ? 'Hooked.' : 'Only just hooked. Keep the line tight.', t);
}

function mirror() {
  const F = S.F;
  S.stamina = F.stamina; S.tension = F.tension; S.lineM = F.lineM; S.lean = F.lean; S.pull = F.pull;
}

function stepFightFrame(t, dt) {
  const F = S.F;
  const lean = S.holdL && !S.holdR ? -1 : S.holdR && !S.holdL ? 1 : S.dragLean;
  const end = stepFight(F, S.board, { lean, wind: S.windHeld }, dt);
  mirror();
  if (F.fired === 'run') { note('It runs. Let it go.', t); sfx('boatfish-drag'); S.lastDragAt = t; }
  else if (F.fired === 'charge') { note('It\'s swimming at you. Wind.', t); sfx('boatfish-plip'); }
  else if (F.fired === 'jump') { S.jumpAt = t; note('It jumps. Ease off.', t); sfx('boatfish-jump'); }
  if (F.mode === 'run' && t - (S.lastDragAt || 0) > 340) { S.lastDragAt = t; sfx('boatfish-drag'); }
  if (S.windHeld && F.mode !== 'run' && t - S.lastClickAt > 95) { S.lastClickAt = t; sfx('boatfish-click'); }
  if (S.tension > 0.72 && t - S.lastZingAt > 380) { S.lastZingAt = t; sfx('boatfish-zing'); }
  if (end === 'snap') {
    S.snapLine = true; S.windHeld = false;
    sfx('boatfish-snap');
    settle(t, 0, 600);
  } else if (end === 'thrown') {
    throwHook(t);
  } else if (end === 'tired') {
    startNet(t);
  }
}

function throwHook(t) {
  S.threw = true; S.windHeld = false;
  sfx('boatfish-plip');
  settle(t, 0, 600);
}

// The line comes in while the server says what happened. Its answer can land at any moment after
// this, so the state's set before the verb goes.
function settle(t, won, ms) {
  startReel(t, null, ms);
  S.waitResolve = true; S.resolveAt = t;
  send(`fishresolve boat ${won} ${S.token}`);
}

// ── The net ──────────────────────────────────────────────────────────────────────────────────────
// Beside the boat and spent. It rolls past on the swell and you've three goes. Never sooner than the
// server's minFightMs, or it refuses the win.
function startNet(t) {
  S.phase = 'net';
  S.netAt = t; S.netTries = 0; S.netFlashAt = 0;
  S.netOpenAt = Math.max(t + NET_READY_MS, S.minEnd);
  S.windHeld = false; S.lineM = Math.min(S.lineM, LAND_M);
  sfx('boatfish-click');
}
function netPos(t) { return netSwing(t - S.netAt, S.netTries); }
function netTry(t) {
  if (t < S.netOpenAt) return;
  if (Math.abs(netPos(t)) <= S.board.netWidth) {
    sfx('boatfish-net');
    settle(t, 1, 500);
    return;
  }
  S.netTries++;
  S.netFlashAt = t;
  if (S.netTries >= NET_TRIES) { note('It rolls off the rim and the hook pulls.', t); throwHook(t); return; }
  // It kicks off the rim and takes a little line.
  note('It kicks off the rim. Bring it back.', t);
  sfx('boatfish-jump');
  const F = S.F;
  F.stamina = 0.08; F.lineM = LAND_M + 2.5; F.tension = 0.45; F.side = -F.side;
  S.phase = 'fight';
  mirror();
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
  if (p >= 1 && S.reelThen) { S.reelThen = null; toReady(); }
  if (S.waitResolve && t - S.resolveAt > RESOLVE_TIMEOUT_MS) toReady();
}

// ── Status lines and cards ───────────────────────────────────────────────────────────────────────
function note(text, t) { S.note = text; S.noteUntil = t + NOTE_MS; }
function card(title, body, t, keepPhase = false) {
  S.card = { title, body };
  S.cardUntil = t + CARD_MS;
  S.cardPhase = keepPhase;
}

// The catch's picture on the card, drawn once.
function showCatch(id, kg) {
  const cv = _E?.cfish;
  if (!cv) return;
  try { paintCatch(cv, id, kg); } catch (e) { console.error('[boatfish] card:', e?.message); }
}

const COUNT = ['', 'One', 'Two', 'Three', 'Four', 'Five'];
function tempoWords(ms) { return ms < 1500 ? 'Twitch, short pause.' : ms < 2000 ? 'Twitch and wait.' : ms < 3000 ? 'Twitch, then let it sit.' : 'Twitch, then leave it a good while.'; }
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
    case 'wait': return 'Twitch it, then let it sit. Fish gather to a lure worked slowly. Reel in to cast again.';
    case 'bite': return S.struck ? '' : TAKE_WORDS[S.script?.kind] || TAKE_WORDS.slide;
    case 'fight': {
      const F = S.F;
      if (F.mode === 'spent') return 'It\'s done. Wind it in.';
      if (F.mode === 'run') return 'It\'s taking line. Stop winding.';
      if (F.mode === 'charge') return 'It\'s swimming at you. Wind.';
      if (F.mode === 'jump') return 'It\'s jumping. Ease off.';
      if (S.tension < SLACK_AT) return 'Slack line. Wind.';
      return S.pull < 0 ? 'It\'s pulling to port. Lean to starboard and wind.' : 'It\'s pulling to starboard. Lean to port and wind.';
    }
    case 'net': return t < S.netOpenAt ? 'It\'s alongside. Get the net under it.' : 'Net it as it rolls past.';
    case 'reeling': return S.snapLine || S.threw ? 'The line\'s gone slack.' : S.waitResolve ? 'Lifting it aboard.' : 'Reeling in.';
    case 'landed': return '';
    default: return '';
  }
}
// What you're told when a fish comes to the lure. It's the kind of fish, not when to strike.
const TAKE_WORDS = {
  slide: 'Something\'s mouthing it. Let it take the float down.',
  slam: 'Something\'s at it. It\'ll be quick.',
  lift: 'Something heavy. Watch the float for a lift.',
  rattle: 'It\'s shivering. Wait for the dip.',
};
const PHASE_LABEL = { ready: 'READY', flight: 'CAST', wait: 'LURE', bite: 'BITE', fight: 'ON THE LINE', net: 'ALONGSIDE', reeling: 'REELING', landed: 'LANDED' };
// The big button is the verb you'd type: fish <bearing> <metres>, fish twitch, fish strike. The CSS
// hides it in the phases where it has no verb.
const ACT_LABEL = { ready: 'Cast', wait: 'Twitch', bite: 'Strike', fight: 'Wind', net: 'Net' };

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
    else if (S.phase === 'fight') stepFightFrame(t, dt);
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
    // The reel handle: held, not tapped, so a key repeat is the same turn of the handle.
    if (ph === 'fight') { S.windHeld = !!down; return true; }
    if (!down) S.windHeld = false;
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
    case 'fight': S.windHeld = true; break;
    case 'net': netTry(t); break;
    case 'landed': S.card = null; toReady(); break;
    default: break;
  }
}
function actUp(t) {
  if (!S) return;
  S.windHeld = false;
  if (S.phase === 'ready' && !_host) chargeRelease(t);
}

function on(target, type, fn, opts) { target.addEventListener(type, fn, opts); _listeners.push([target, type, fn, opts]); }
function offAll() { for (const [tg, ty, fn, o] of _listeners) { try { tg.removeEventListener(ty, fn, o); } catch { /* gone */ } } _listeners = []; }

function wire() {
  const E = _E;
  const now = () => _env.now();
  on(E.act, 'pointerdown', (e) => { e.preventDefault?.(); actDown(now()); render(now()); });
  on(window, 'pointerup', () => { actUp(now()); if (S) { S.holdL = false; S.holdR = false; S.dragging = false; } });
  on(window, 'pointercancel', () => { if (S) { S.holdL = false; S.holdR = false; S.windHeld = false; S.dragging = false; } });
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
  // The lens is a tap target too: on a phone you strike at the float you're looking at.
  on(E.lens, 'pointerdown', (e) => { e.preventDefault?.(); actDown(now()); render(now()); });
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

function hudHtml() {
  return `<div class="bf-read">
      <div class="bf-phase" data-r="phase">READY</div>
      <div class="bf-linegauge"><span class="bf-boat"></span><span class="bf-track"><i class="bf-lure" data-r="lure"></i></span></div>
      <div class="bf-nums"><span data-r="out"></span><span data-r="depth"></span></div>
      <div class="bf-follow" data-r="follow"></div>
      <div class="bf-tempo"><span class="bf-lamp" data-r="lamp"></span><span data-r="tempo"></span></div>
    </div>
    <div class="bf-lens" data-r="lens"><canvas class="bf-lenscv" data-r="lenscv"></canvas><span class="bf-lensname" data-r="lensname">FLOAT</span></div>
    <div class="bf-fight" data-r="fight">
      <div class="bf-fightrow"><span class="bf-mode" data-r="mode"></span><span class="bf-lineout" data-r="lineout"></span></div>
      <div class="bf-meter"><span class="bf-mlabel">LINE</span><span class="bf-bar bf-tension"><i data-r="tension"></i><b class="bf-needle" data-r="needle"></b></span></div>
      <div class="bf-meter"><span class="bf-mlabel">FISH</span><span class="bf-bar bf-stamina"><i data-r="stamina"></i></span></div>
      <div class="bf-leanpad" data-r="leanpad"><span class="bf-port">PORT</span><span class="bf-stbd">STBD</span><i class="bf-pull" data-r="pull"></i><i class="bf-lean" data-r="lean"></i></div>
    </div>
    <div class="bf-status" data-r="status"></div>
    <div class="bf-card" data-r="card"><canvas class="bf-cfish" data-r="cfish" width="320" height="130"></canvas><div class="bf-card-title" data-r="ctitle"></div><div class="bf-card-body" data-r="cbody"></div></div>
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
  for (const r of ['phase', 'lure', 'out', 'depth', 'follow', 'lamp', 'tempo', 'lens', 'lenscv', 'lensname', 'fight', 'mode', 'lineout',
    'tension', 'needle', 'stamina', 'leanpad', 'pull', 'lean', 'status', 'card', 'ctitle', 'cbody', 'cfish', 'left', 'act', 'reel', 'right', 'stow']) E[r] = q(r);
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

// How light it is on the water, from the seat, for the lens. Daylight by default.
let _light = () => 1;
/** The seat tells the lens how much daylight there is: a function returning 0..1. */
export function setBoatFishLight(fn) { _light = typeof fn === 'function' ? fn : () => 1; }
function lightNow() { try { return _light(); } catch { return 1; } }

const LENS_MS = 33;
let _lensAt = 0;
const MODE_LABEL = { pull: 'PULLING', run: 'RUNNING', charge: 'COMING AT YOU', jump: 'JUMPING', spent: 'SPENT' };

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
    if (!T && S.gap) tempo = `Last pause ${fmt1(S.gap / 1000)} s.`;
  }
  put('follow', E.follow, fol);
  put('tempo', E.tempo, tempo);
  if (E.lamp) {
    // Lit once the pause has been long enough for whoever's following: twitch again any time after.
    const lit = T > 0 && S.lastTapAt != null && t - S.lastTapAt >= T;
    if (E.last.lamp !== lit) { E.last.lamp = lit; E.lamp.classList.toggle('on', lit); }
  }

  // The lens: the float while there's a lure in the water, the fish while it's alongside.
  const lensOn = S.phase === 'wait' || S.phase === 'bite' || S.phase === 'fight' || S.phase === 'net';
  if (lensOn && E.lenscv && t - (_lensAt || 0) >= LENS_MS) {
    _lensAt = t;
    const day = lightNow();
    if (S.phase === 'net') {
      paintNet(E.lenscv, { t, day, swing: netPos(t), width: t < S.netOpenAt ? 0 : S.board.netWidth, species: S.catch?.species, kg: S.catch?.kg, tries: S.netTries,
        flash: t - S.netFlashAt < NET_FLASH_MS ? 'miss' : null });
    } else if (S.phase === 'fight') {
      const js = S.jumpAt && t - S.jumpAt < JUMP_MS ? (t - S.jumpAt) / JUMP_MS : null;
      paintFight(E.lenscv, { t, day, species: S.catch?.species, kg: S.catch?.kg, mode: S.F?.mode, pull: S.pull, tension: S.tension, jump: js });
    } else {
      paintFloat(E.lenscv, { t, day, script: S.phase === 'bite' ? S.script : null, rel: S.phase === 'bite' ? t + _skew - S.biteAt : null,
        twitchAge: S.lastTapAt != null ? t - S.lastTapAt : null });
    }
  }
  put('lensname', E.lensname, S.phase === 'net' ? 'NET' : S.phase === 'fight' ? 'LINE' : 'FLOAT');

  // The fight's meters. The tension's needle sits on a track with a green band: under it the line's
  // slack, over it it's about to go.
  if (S.phase === 'fight' || S.phase === 'reeling' || S.phase === 'net') {
    const T = clamp(S.tension, 0, 1);
    setStyle(E.tension, 'width', `${Math.round(T * 100)}%`);
    setStyle(E.needle, 'left', `${(T * 100).toFixed(1)}%`);
    setStyle(E.stamina, 'width', `${Math.round(clamp(S.stamina, 0, 1) * 100)}%`);
    setStyle(E.pull, 'left', `${(50 + S.pull * 45).toFixed(1)}%`);
    setStyle(E.lean, 'left', `${(50 + S.lean * 45).toFixed(1)}%`);
    const hot = S.tension > 0.72, slack = S.tension < SLACK_AT;
    if (E.last.hot !== hot) { E.last.hot = hot; E.tension?.classList.toggle('hot', hot); }
    if (E.last.slack !== slack) { E.last.slack = slack; E.tension?.classList.toggle('slack', slack); }
    const m = S.F ? S.F.mode : '';
    if (_root.dataset && _root.dataset.mode !== m) _root.dataset.mode = m;
    put('mode', E.mode, MODE_LABEL[m] || '');
    put('lineout', E.lineout, `${Math.round(S.lineM)} m out`);
  }

  if (S.card) {
    put('ctitle', E.ctitle, S.card.title);
    put('cbody', E.cbody, S.card.body);
  }
}
