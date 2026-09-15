// THE BURNER DIAL — what a hob knob actually is, and what turning it does.
//
// Before this, heat was three words (`stove low|mid|high`) that wrote one line
// into a session's burner log and changed nothing else. The cook ran at a speed
// fixed by the stove's `stove_tier` — its CEILING — for as long as it was on,
// whatever the dial said. So a player who turned the heat down watched a pan
// that was still cooking at exactly the rate it always had, and found out at
// plating that the number had mattered to the score. That is a control you
// cannot read, which is the same complaint this file's siblings keep answering.
//
// A dial has eleven positions here, 0 to 10, and the three named tiers are
// MARKINGS ON IT rather than the whole of it:
//
//     0    off
//     1-3  low       centre 2
//     4-7  mid       centre 5
//     8-10 high      centre 9
//
// ⚠ THE SCORING AXIS IS STILL THE TIER, AND THAT IS DELIBERATE. Every profile
// states what it wants as `heatTolerance`/`heatCurve` in tier words, quality.js
// scores time-weighted spans of tiers, and none of that moves. A finer scoring
// axis would mean re-tuning every profile against a grid nobody has cooked on.
// What the fine level buys is SPEED and PROSE — the two things a cook actually
// perceives standing at a hob — and it decides which tier you are in, so it is
// mechanically load-bearing at every position rather than at three of them.
//
// ⚠ AND THE NAMED TIERS REPRODUCE TODAY'S NUMBERS EXACTLY. `LEVEL_SPEED` at each
// tier's centre IS `STOVE_SPEED` for that tier, and a stove with nobody touching
// its dial sits at the centre of its own ceiling. So the entire existing corpus
// of cooks — every regress case, every band anybody has ever earned — runs
// bit-for-bit as it did. Nothing here is a retune; it is a control surface over
// numbers that were already there.
//
// ── THE CLOCK ────────────────────────────────────────────────────────────────
//
// A cooking session is timestamp-derived with no tick (see cook.js): every
// answer is `now` against `startedAt`. Turning the dial has to change the RATE
// that clock advances at, and it has to do it without a tick and without
// re-deriving the past wrongly.
//
// Two pieces, and they are both necessary:
//
//   APPARENT TIME. `apparentNow` maps real time to the session's own clock,
//   running at `rate` since `rateAt`. At rate 1 it is the identity, which is why
//   an untouched session behaves identically.
//
//   TRANSLATION. On a rate change the WHOLE session — `startedAt`, `plainDoneAt`
//   and every recorded `heats[].at` and `acts[].at` — is shifted forward so that
//   apparent time and real time coincide again at that instant. Translation
//   preserves every fraction exactly, which is what stops a turn made at 50%
//   through the cook from silently becoming a turn at 70% because you turned the
//   gas down afterwards.
//
// ⚠ CONVERT EXACTLY ONCE. `apparentNow` is not idempotent — feeding it its own
// output advances the clock a second time. The rule is that quality.js's entry
// points (`endStateAt`, `evaluate`, `overStageText`) take REAL time and convert
// inside, and the two functions in cook.js that do their own timestamp
// arithmetic convert into a local and never pass that local back out. Anything
// else passes `Date.now()`.
//
// ⚠ RATE 0 IS A REAL STATE. A ring turned off is a pan sitting there not
// cooking: the clock freezes, no narration beat fires, nothing burns, and the
// stove stays held because the pan is still on it. That is the one thing the
// old three-word verb could not say, and `workspace.js` had a comment naming it
// as a gap — "off the heat before the gin goes in" was a sentence the sim could
// not express.
//
// Pure except for the burner registry, which is RAM by decision — see below.
import { STOVE_SPEED } from './config.js';

export const MAX_LEVEL = 10;

// The three markings, in order. `mid` is the notch a named tier lands on, and it
// is the ONLY place `STOVE_SPEED` is re-stated — see the identity assertion in
// regress, which is what keeps the two tables from drifting.
export const TIER_BANDS = [
  { tier: 'low', from: 1, to: 3, notch: 2 },
  { tier: 'mid', from: 4, to: 7, notch: 5 },
  { tier: 'high', from: 8, to: 10, notch: 9 },
];

export const HEAT_ORDER = ['low', 'mid', 'high'];

// Speed by level. Piecewise-linear between the three notches, so the curve is
// smooth and the notches are exact. Level 10 sits ABOVE the named `high` — a
// ring wound past its marking, which cooks faster and is the wrong side of every
// profile's tolerance, so it is fast and it costs you.
export const LEVEL_SPEED = [
  0,                    // 0 — off
  0.80,                 // 1
  STOVE_SPEED.low,      // 2 — the `low` notch
  1.17,                 // 3
  1.33,                 // 4
  STOVE_SPEED.mid,      // 5 — the `mid` notch
  1.75,                 // 6
  2.00,                 // 7
  2.25,                 // 8
  STOVE_SPEED.high,     // 9 — the `high` notch
  2.90,                 // 10 — wound past the marking
];

// What the ring LOOKS like at each position. Said by the verb, printed by the
// HUD, and the only feedback a player gets that is about the burner rather than
// about the food.
export const LEVEL_TEXT = [
  'out',
  'a bare blue flicker',
  'a low steady flame',
  'a gentle heat',
  'a working flame',
  'a steady middle',
  'a brisk heat',
  'a hard flame',
  'a roaring ring',
  'wide open',
  'wound past the stop, the burner howling',
];

export const clampLevel = n => Math.max(0, Math.min(MAX_LEVEL, Math.round(Number(n) || 0)));

// 0 is OFF and is not a tier. Everything reading this has to handle null, which
// is the point: "off" is a fourth answer, not a quieter `low`.
export function tierOfLevel(level) {
  const l = clampLevel(level);
  if (l <= 0) return null;
  return (TIER_BANDS.find(b => l >= b.from && l <= b.to) || TIER_BANDS[TIER_BANDS.length - 1]).tier;
}

export function levelOfTier(tier) {
  return (TIER_BANDS.find(b => b.tier === tier) || TIER_BANDS[0]).notch;
}

export const speedOfLevel = level => LEVEL_SPEED[clampLevel(level)];
export const levelText = level => LEVEL_TEXT[clampLevel(level)];

// The ceiling a stove's own `stove_tier` puts on its dial: the TOP of that
// tier's band, never its notch. A `mid` cooktop reaches 7, so there is somewhere
// to go above the marking without pretending it is a range.
export const ceilingLevel = tier => (TIER_BANDS.find(b => b.tier === tier) || TIER_BANDS[0]).to;

// ── The burner registry ──────────────────────────────────────────────────────
//
// WHERE A DIAL POSITION LIVES, AND WHY IT IS NOT IN THE DATABASE.
//
// `furniture.flags` is a CONTENT column — not in the furniture entry's
// `excludeColumns` — so a value written there is carried into `content/` by the
// next export and becomes part of the world. A knob somebody left on `7` is not
// world content, and a hob that shipped in git remembering the last thing a
// player boiled is exactly the runtime residue the pipeline exists to keep out.
//
// So it is RAM, with the same reasoning as zone stains and Null trace: a restart
// is the kitchen being reset, and nothing durable is lost because the part that
// MATTERS — what the burner was doing during a cook — is recorded in the
// session's own `heats` log, which is in the DB on the food. Boot restore seeds
// this map back from live sessions (see cook.js), so a pan paused across a
// restart comes back paused.
const burners = new Map(); // applianceId -> level

// The dial's resting position: the centre of the stove's own ceiling tier. A
// `high` range sits at 9, a `low` hotplate at 2 — which is the tier and the
// speed `cook` used before this file existed, for every stove in the game.
export function defaultLevel(stoveTier) {
  return levelOfTier(stoveTier || 'low');
}

export function burnerLevel(applianceId, stoveTier) {
  const v = burners.get(String(applianceId));
  return v === undefined ? defaultLevel(stoveTier) : v;
}

export function setBurnerLevel(applianceId, level) {
  const l = clampLevel(level);
  burners.set(String(applianceId), l);
  return l;
}

export function forgetBurner(applianceId) { burners.delete(String(applianceId)); }

// Test/boot seam only. Never call this from a verb — a dial is set by turning it.
export function _resetBurners() { burners.clear(); }

// ── The session clock ────────────────────────────────────────────────────────

// The multiplier the session is currently running at, relative to the speed it
// was BUILT at. 1 for every session that has never been retuned, which is what
// makes `apparentNow` the identity for them.
export const sessionRate = session => (session?.rate == null ? 1 : Number(session.rate));

// Real time → the session's own clock. The identity at rate 1.
//
// ⚠ NOT IDEMPOTENT. See the header. One conversion per read, at the boundary.
export function apparentNow(session, now = Date.now()) {
  const rate = sessionRate(session);
  if (rate === 1) return now;
  const from = session?.rateAt ?? session?.startedAt ?? now;
  if (now <= from) return now;
  return from + (now - from) * rate;
}

// The inverse: when does the session's clock reach `target`? Null when it never
// will, which is a paused ring — and a null is what stops a timer being armed
// for a beat that is not coming.
export function realTimeFor(session, target, now = Date.now()) {
  const rate = sessionRate(session);
  if (rate === 1) return target;
  const from = session?.rateAt ?? session?.startedAt ?? now;
  if (target <= from) return target;
  if (rate <= 0) return null;
  return from + (target - from) / rate;
}

// Shift the WHOLE session forward in time. Every absolute stamp moves together,
// so every fraction — how far through the cook a turn was, which slice of the
// heat curve a burner span covered — is preserved exactly.
//
// ⚠ Every stamp. A missed one is a turn that silently drifts to a different
// point in the cook, which is invisible and changes the band.
export function shiftSession(session, delta) {
  if (!delta) return session;
  session.startedAt += delta;
  if (session.plainDoneAt != null) session.plainDoneAt += delta;
  if (session.doneAt != null) session.doneAt += delta;       // pre-rename sessions
  if (session.stopAt != null) session.stopAt += delta;
  if (session.scorched != null) session.scorched += delta;
  if (session.wet?.since != null) session.wet.since += delta;
  for (const h of session.heats || []) h.at += delta;
  for (const a of session.acts || []) a.at += delta;
  return session;
}

// Put the session on a new rate, keeping its clock continuous. Returns the
// session, mutated — the caller writes it back.
export function retuneSession(session, rate, now = Date.now()) {
  const old = sessionRate(session);
  const from = session.rateAt ?? session.startedAt ?? now;
  // The span that just ended ran at `old`; the difference between the real time
  // it took and the apparent time it bought is what the session owes.
  if (now > from) shiftSession(session, (now - from) * (1 - old));
  session.rate = rate;
  session.rateAt = now;
  return session;
}

// ── Reading the burner against the food ──────────────────────────────────────
//
// THE COMFY BAND: what this pan wants RIGHT NOW.
//
// `desiredTierAt` in quality.js has always known this — it is how a curved
// profile is scored — and it has never been said out loud. A player could only
// learn a steak wants a hard sear then a drop by cooking several badly. Saying
// it is not giving the game away: the timing, the turning, the seasoning and
// when to plate are all still yours, and a cook standing over a pan can see
// perfectly well whether it is sitting too hot.
//
// It is prose and a tier, never a number, for the same reason the cook meter is
// pips: the answer is "wind it down", not "you are at 0.62 of ideal".
export function heatVerdict(level, wantTier) {
  const tier = tierOfLevel(level);
  if (!wantTier) return null;
  if (tier === null) return { state: 'off', text: 'the ring is out' };
  const at = HEAT_ORDER.indexOf(tier);
  const want = HEAT_ORDER.indexOf(wantTier);
  if (at === want) return { state: 'good', text: 'sitting right where it wants to be' };
  if (at < want) return { state: at + 1 === want ? 'cool' : 'cold', text: at + 1 === want ? 'a shade too gentle' : 'far too gentle for this' };
  return { state: at - 1 === want ? 'warm' : 'hot', text: at - 1 === want ? 'running a little hot' : 'far too fierce for this' };
}
