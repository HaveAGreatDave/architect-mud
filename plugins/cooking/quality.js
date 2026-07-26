// Cooking quality — pure functions over a stored session. No DB, no clock of
// its own: every answer is derived from the session's timestamps and `now`,
// which is what lets `plate` and `examine` agree without either of them ever
// having simulated the intervening time.
//
// The model, in one line: the food's target for the end state you pulled it in
// is a CEILING, and the process decides how far below that ceiling you land.
import {
  BASE_OFFSET, HEAT_SCORE, PRECISION_WEIGHT, VESSEL_WEIGHT, SKILL_WEIGHT,
  TURN_IDEAL_BONUS, TURN_SPACING_BONUS, TURN_MISS_PENALTY, FUSS_PENALTY,
  SCORE_FLOOR, BARE_VESSEL, HEAT_CURVE_WEIGHT, SMOKER_PEAK_MULT, PEAK_LINES, SLIPPING_LINES, FADING_LINES, lineFor,
} from './config.js';
import { QUALITY_BANDS, bandIndex, donenessAt } from './profiles.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const HEAT_ORDER = ['low', 'mid', 'high'];

// The four windows of a profiled cook, all derived from what the session stored.
// doneAt keeps the meaning it has always had: the moment cooking completes, which
// is also the moment the peak window opens.
export function timeline(session, profile) {
  const { startedAt, thawMs = 0, cookMs } = session;
  const v = session.vessel || BARE_VESSEL;
  // DONENESS moves the goalposts: the window opens where the chosen target sits,
  // as a multiple of the cook time. A profile without doneness returns 1 and
  // this is exactly the old behaviour. `session.doneAt` stays as the stored
  // default-completion stamp for the unprofiled path and boot catch-up; the
  // profiled path derives everything from the target so the two can't drift.
  const mult = donenessAt(profile, session.target);
  const doneAt = startedAt + thawMs + cookMs * mult;
  const smokeMult = session.smoking ? SMOKER_PEAK_MULT : 1;
  const peakMs = Math.max(1, cookMs * profile.peakFraction * (0.6 + 0.8 * v.r) * smokeMult);
  const overMs = Math.max(1, cookMs * profile.burnFraction * (0.6 + 0.8 * v.d));
  const peakEnd = doneAt + peakMs;
  return { startedAt, thawMs, cookMs, doneAt, peakMs, overMs, peakEnd, burnAt: peakEnd + overMs, mult };
}

export function endStateAt(session, profile, now = Date.now()) {
  const tl = timeline(session, profile);
  if (now < tl.doneAt) return 'raw';
  if (now < tl.peakEnd) return 'peak';
  if (now < tl.burnAt) return 'over';
  return 'burnt';
}

// How well the handling matched what this food wants. A turns:0 food (a tomato)
// scores WORSE for being poked; everything else wants its ideal number of turns,
// spaced evenly through the cook rather than bunched at one end.
function turnScore(session, profile) {
  const acts = session.acts || [];
  if (profile.turns === 0) return -Math.min(acts.length, 3) * FUSS_PENALTY;

  const miss = Math.abs(acts.length - profile.turns);
  let score = miss === 0 ? TURN_IDEAL_BONUS : -miss * TURN_MISS_PENALTY;
  if (acts.length && session.cookMs > 0) {
    // Ideal act times are the even division points of the cook segment.
    const cookStart = session.startedAt + (session.thawMs || 0);
    const ideals = Array.from({ length: profile.turns }, (_, i) => cookStart + session.cookMs * ((i + 1) / (profile.turns + 1)));
    const used = new Set();
    let total = 0;
    for (const a of acts) {
      // Nearest unclaimed ideal point, so two turns can't both score off one slot.
      let best = null, bestI = -1;
      ideals.forEach((t, i) => {
        if (used.has(i)) return;
        const d = Math.abs(a.at - t);
        if (best === null || d < best) { best = d; bestI = i; }
      });
      if (bestI < 0) continue;
      used.add(bestI);
      total += 1 - clamp(best / session.cookMs, 0, 1); // 1 = dead on, 0 = a whole cook away
    }
    score += TURN_SPACING_BONUS * (total / Math.max(1, profile.turns));
  }
  return score;
}

// The burner settings actually used, as [{ from, to, tier }] spans across the
// cook segment. `heats` is appended to by the `stove` verb; a session that never
// touched it has exactly one span at the tier it started on.
export function heatSpans(session) {
  const cookStart = session.startedAt + (session.thawMs || 0);
  const end = cookStart + session.cookMs;
  const marks = (session.heats?.length ? session.heats : [{ at: cookStart, tier: session.heatTier }])
    .map(h => ({ at: Math.max(cookStart, h.at), tier: h.tier }))
    .sort((a, b) => a.at - b.at);
  return marks
    .map((m, i) => ({ from: m.at, to: i + 1 < marks.length ? Math.min(end, marks[i + 1].at) : end, tier: m.tier }))
    .filter(s => s.to > s.from);
}

// What the profile wanted at a given fraction through the cook.
function desiredTierAt(profile, f) {
  if (!profile.heatCurve) return profile.heatTolerance;
  for (const step of profile.heatCurve) if (f <= step.until) return step.tier;
  return profile.heatCurve[profile.heatCurve.length - 1].tier;
}

// A flat-tolerance profile scores on how close the setting was. A CURVED one
// scores on the fraction of the cook spent at the setting it wanted at that
// moment — so a steak seared then dropped to low beats one held at either.
function heatScore(session, profile) {
  const spans = heatSpans(session);
  const totalMs = Math.max(1, session.cookMs);

  // A curved profile is scored on how well the burner followed its curve, but
  // never WORSE than it would have scored as an ordinary flat-tolerance food.
  // Opting a profile into a curve must be upside for the player who engages
  // with it, never a punishment for the player who doesn't — without this floor
  // a new cook who leaves the stove alone eats a −1.00 they had no way to see.
  if (profile.heatCurve) {
    const asFlat = flatHeatScore(spans, profile.heatTolerance, totalMs);
    return Math.max(curveHeatScore(session, profile, spans, totalMs), asFlat);
  }
  return flatHeatScore(spans, profile.heatTolerance, totalMs);
}

// Time-weighted closeness of the burner to the one setting this food wants.
function flatHeatScore(spans, tolerance, totalMs) {
  const b = HEAT_ORDER.indexOf(tolerance);
  if (b < 0) return 0;
  let score = 0;
  for (const span of spans) {
    const a = HEAT_ORDER.indexOf(span.tier);
    if (a < 0) continue;
    const gap = Math.abs(a - b);
    const value = gap === 0 ? HEAT_SCORE.exact : gap === 1 ? HEAT_SCORE.oneOff : HEAT_SCORE.twoOff;
    score += value * ((span.to - span.from) / totalMs);
  }
  return score;
}

// How much of the cook was spent at the setting the curve wanted at that moment.
function curveHeatScore(session, profile, spans, totalMs) {
  const cookStart = session.startedAt + (session.thawMs || 0);
  const total = totalMs;
  let matched = 0;
  // Sample each span against the curve at a fine resolution — the curve has at
  // most a handful of steps, so this stays cheap and needs no interval algebra.
  for (const span of spans) {
    const steps = Math.max(1, Math.round(((span.to - span.from) / total) * 50));
    const dt = (span.to - span.from) / steps;
    for (let i = 0; i < steps; i++) {
      const f = clamp((span.from + dt * (i + 0.5) - cookStart) / total, 0, 1);
      if (desiredTierAt(profile, f) === span.tier) matched += dt;
    }
  }
  const followed = clamp(matched / total, 0, 1);
  // Following it exactly is worth more than any single flat tier can earn;
  // ignoring it entirely is worth the same as sitting on the wrong tier.
  return HEAT_SCORE.twoOff + (HEAT_CURVE_WEIGHT - HEAT_SCORE.twoOff) * followed;
}

// How centred in the peak window you pulled it. Only meaningful if you pulled it
// in the peak window at all.
function precisionScore(session, profile, now) {
  const tl = timeline(session, profile);
  if (now < tl.doneAt || now >= tl.peakEnd) return 0;
  const through = (now - tl.doneAt) / tl.peakMs;   // 0..1 across the window
  return PRECISION_WEIGHT * (1 - Math.abs(through * 2 - 1));
}

function vesselScore(session) {
  const v = session.vessel || BARE_VESSEL;
  return VESSEL_WEIGHT * (v.d + v.r - 1);
}

// The whole evaluation. `skillMargin` comes from the caller's skillCheck so this
// stays pure and testable — pass 0 for a neutral read (examine).
export function evaluate(session, profile, now = Date.now(), skillMargin = 0) {
  const endState = endStateAt(session, profile, now);
  const ceiling = bandIndex(profile.targets[endState]);

  const parts = {
    turn: turnScore(session, profile),
    heat: heatScore(session, profile),
    precision: precisionScore(session, profile, now),
    vessel: vesselScore(session),
    skill: SKILL_WEIGHT * clamp(skillMargin / 20, -1, 1),
  };
  const modifiers = clamp(Object.values(parts).reduce((a, b) => a + b, 0), SCORE_FLOOR, Math.abs(BASE_OFFSET) + 1);
  const raw = ceiling + BASE_OFFSET + modifiers;
  const index = clamp(Math.round(raw), 0, ceiling);

  return { endState, ceiling: QUALITY_BANDS[ceiling], band: QUALITY_BANDS[index], index, score: raw, parts };
}

// Stage text for the post-peak part of the timeline — the examine telegraph that
// tells a player their steak is on its way out without printing any numbers.
// Observational, never instructional: it says what the food looks like and lets
// the player decide. The 60% split inside the peak window is the only tell you
// get about WHERE in the window you are — the difference between a cook who
// reads the pan and one who is counting.
export function overStageText(session, profile, now = Date.now()) {
  const tl = timeline(session, profile);
  if (now < tl.peakEnd) {
    const through = (now - tl.doneAt) / tl.peakMs;
    return lineFor(through > 0.6 ? SLIPPING_LINES : PEAK_LINES, session.profile);
  }
  if (now < tl.burnAt) {
    const through = (now - tl.peakEnd) / tl.overMs;
    return through > 0.5 ? 'starting to char, smoke curling off it' : 'past its best, going dry';
  }
  return 'burnt black — nothing to be done about it now';
}
