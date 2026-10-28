// THE BOAT REEL'S RULES, shared by the server (plugins/fishing/boat.js) and the seat's minigame
// (client/game/js/panels/boatfish.js). Pure: no DOM, no world, no clock. Every function takes the time
// it needs, so the server can judge a beat with the same arithmetic the client drew it with.
//
// The loop, from the anchored seat (docs/proposals/boat-fishing.md §5):
//
//   cast     bearing and range from the anchor; the lure lands, then sinks.
//   twitch   each tap draws the lure TWITCH_M closer and lifts it. Fish near it grow interested,
//            more so when the taps keep their species' tempo. At REEL_IN_M the line auto-reels and
//            you cast again.
//   strike   an interested fish takes it. The float knocks in pulses: one beat for a small fish,
//            up to four, quickening, for a big one. Hit every beat inside its window or it spits.
//   fight    the fish runs left or right; lean the other way. Leaning right tires it and eases the
//            tension; wrong or slack and the tension climbs. Tired and inside LAND_M, it auto-reels
//            into the fish box.
//
// Units: metres, kilograms, milliseconds. Bearings in degrees off the bow, starboard positive.

import { SPECIES } from './fish.js';

// ── THE LINE ───────────────────────────────────────────────────────────────────────────────────
export const TWITCH_M = 1.0;          // how far one tap draws the lure in
export const TWITCH_LIFT_M = 0.35;    // how far one tap lifts it
export const TWITCH_MIN_MS = 140;     // taps closer than this are one tap: no machine-gunning
export const REEL_IN_M = 0.5;         // at this much line out it auto-reels, and you cast again
export const SINK_MPS = 0.6;          // a plain lure's sink rate, until a lure item says otherwise
export const CAST_MIN_M = 6;          // the shortest cast that counts as a cast

// ── TEMPO ──────────────────────────────────────────────────────────────────────────────────────
// Each species likes a gap between twitches. Quick fish want quick taps; sulkers want you to wait.
// A row may set `tempo` itself; otherwise it follows from the fight style.
const TEMPO_BY_FIGHT = { runner: 380, jumper: 520, wriggler: 300, steady: 800, sulker: 1500 };
export const tempoOf = (spId) => {
  const sp = SPECIES[spId];
  return (sp && (sp.tempo || TEMPO_BY_FIGHT[sp.fight])) || 800;
};

/** How well one gap between taps matches a species' tempo, 0..1. */
export function tempoMatch(gapMs, spId) {
  const t = tempoOf(spId);
  return Math.exp(-Math.abs(gapMs - t) / (t * 0.35));
}

// ── INTEREST ───────────────────────────────────────────────────────────────────────────────────
export const NOTICE_M = 7;            // a fish this close to the lure (in 3D) can notice it
export const BITE_AT = 1;             // interest at which it takes the lure

/**
 * The interest one twitch adds to one fish. `dist3` is metres from lure to fish in 3D; `gapMs` the
 * gap since the last tap (null for the first); `keen` the species' keenness now (fish.js keenness);
 * `bait` 1 when the bait suits it.
 */
export function interestGain({ dist3, gapMs, spId, keen = 1, bait = 0 }) {
  if (!(dist3 < NOTICE_M)) return 0;
  const near = 1 - dist3 / NOTICE_M;
  const rhythm = gapMs == null ? 0.35 : 0.2 + 0.8 * tempoMatch(gapMs, spId);
  return near * rhythm * keen * (1 + 0.6 * bait) * 0.45;
}
/** Interest fades between taps: a fish that loses the rhythm loses interest. Per ms. */
export const INTEREST_DECAY_MS = 6000;
export const decayInterest = (v, dtMs) => v * Math.exp(-dtMs / INTEREST_DECAY_MS);

// ── THE STRIKE ─────────────────────────────────────────────────────────────────────────────────
export const STRIKE_LEAD_MS = 900;    // the first knock comes this long after the bite message
export const BEAT_WINDOW_MS = 170;    // a hit this close to a beat counts
export const LATENCY_SLACK_MS = 220;  // what the server adds for the round trip

/** How many beats a fish of this weight and difficulty takes: 1 to 4. */
export function beatCount(kg, difficulty) {
  return Math.max(1, Math.min(4, 1 + Math.floor(Math.log2(1 + kg) * 0.55 + Math.max(0, difficulty - 5) * 0.3)));
}

/**
 * The beats' times, as offsets in ms from the bite. They quicken: each gap is shorter than the last.
 * Deterministic from the count, so the client draws exactly what the server judges.
 */
export function beatTimes(n) {
  const out = [];
  let t = STRIKE_LEAD_MS, gap = 720;
  for (let i = 0; i < n; i++) { out.push(t); t += gap; gap *= 0.78; }
  return out;
}

/** Does a hit at `hitMs` (ms after the bite) land on beat `i` of `n`? `slack` widens it for the server. */
export function onBeat(hitMs, i, n, slack = 0) {
  const b = beatTimes(n)[i];
  return b != null && Math.abs(hitMs - b) <= BEAT_WINDOW_MS + slack;
}

// ── THE FIGHT ──────────────────────────────────────────────────────────────────────────────────
//
// The fight is played on the client, as every minigame here is: winning it is the gate, and the
// server checks it was possible. The board below is the client's physics; `minFightMs` is the
// server's check.
export const LAND_M = 6;              // tired and this close, it auto-reels in

/** The fight's starting figures for a fish. `skill` is the player's fishing skill. */
export function fightBoard({ kg, difficulty, fight, skill = 4, lineM }) {
  const edge = skill - difficulty;
  return {
    stamina: 1,
    tension: 0.15,
    lineM,
    // How hard it pulls and how often it changes side.
    pull: Math.min(1, 0.35 + Math.cbrt(kg) * 0.22 + difficulty * 0.03),
    switchMs: fight === 'runner' ? 900 : fight === 'wriggler' ? 600 : fight === 'sulker' ? 2600 : fight === 'jumper' ? 1300 : 1700,
    // Stamina lost per second while you lean right; tension gained per second while you don't.
    tire: Math.max(0.05, 0.16 + edge * 0.02 - Math.cbrt(kg) * 0.03),
    strain: Math.min(0.9, 0.28 + difficulty * 0.03 - edge * 0.015),
    // Line won per second while you lean right; line lost while it runs and you don't.
    // A light fish comes in quicker: a herring is a few turns of the handle, not a fight.
    gainMps: 1.2 + Math.max(0, edge) * 0.08 + Math.max(0, 1 / Math.cbrt(kg) - 1) * 1.2,
    runMps: 0.8 + Math.cbrt(kg) * 0.5,
    jumps: fight === 'jumper',
    // A sulker that outclasses you surges: on a change of side it may run hard for SURGE_MS, and
    // leaning into a surge strains the line. Give it line (ease off) and it tires itself. Without
    // this a sulker only switched every 2.6 s and a skill-4 angler beat a difficulty-10 sturgeon
    // every time (measured by the reel's builder with a simulated angler).
    surge: fight === 'sulker' ? Math.min(0.85, Math.max(0.15, 0.25 + (difficulty - skill) * 0.08)) : 0,
    // An outclassed fish keeps a little strain on even while you lean the right way.
    heavy: Math.max(0, difficulty - skill) * 0.04,
  };
}
export const SURGE_MS = 1200;

/** The shortest a fair fight could be, in ms: the server refuses a win faster than this. */
export function minFightMs({ kg, difficulty, skill = 4, lineM }) {
  const b = fightBoard({ kg, difficulty, fight: 'steady', skill, lineM });
  const tireS = 1 / b.tire, reelS = Math.max(0, lineM - LAND_M) / (b.gainMps * 1.5);
  return Math.round(Math.max(tireS, reelS) * 1000 * 0.55);
}
