// BOILING DRY — the reader water never had.
//
// `cooking_medium` is the tag that makes water count for every question about
// the PAN and no question about the DISH, and that split is right. Its cost was
// that the AMOUNT of water had nothing reading it: a pot held water or it did
// not, and `fill`/`empty` were its whole vocabulary. Adding a level would have
// been state nothing consumed — which is how a codebase ends up with two ideas
// of how full a pot is and no way to tell which is lying.
//
// This is the reader. A pot on a hard boil loses its water, and when it is gone
// what is in it starts to catch. That gives the amount a consequence, and it
// gives the new burner dial something to be dangerous ABOUT: the same hard ring
// that cooks a stew fast is the one that boils it dry.
//
// ── NO TICK, AS EVER ─────────────────────────────────────────────────────────
//
// Nothing here is simulated. How much water has gone is an integral over the
// burner log the session already keeps — `heats` is a list of [time, level]
// marks, which is exactly the data an evaporation rate needs — so the answer at
// any moment is arithmetic over stamps that were written when the player acted.
//
//     boiled = Σ over spans of (duration × level) / BOIL_FULL_MS
//
// ⚠ IT READS THE FINE LEVEL, NOT THE TIER. Everywhere else the tier is the axis
// and the fine position buys only speed and prose (see heat.js). Here the level
// is exactly right: a ring wound past the stop boils harder than one at the
// notch, and this is a physical rate rather than a score. Pre-dial marks carry
// no `level` and fall back to their tier's notch, the same way boot restore
// does.
//
// ⚠ AND IT RUNS ON THE SESSION'S OWN CLOCK. A pan sitting off the heat is a pan
// not boiling — `rate: 0` freezes `apparentNow`, and every span here is measured
// in that frame, so an hour with the gas off costs no water at all. That falls
// out of using the session's marks rather than the wall clock; it is not a
// special case.
//
// Pure: a session and a time in, a number out. No DB, no player, no clock of its
// own. Everything below is asserted by regress.
import { BOIL_FULL_MS, BOIL_WARN_AT, WATER_LINES } from './config.js';
import { apparentNow, levelOfTier, sessionRate, MAX_LEVEL } from './heat.js';

// The marks, as [{ from, to, level }] spans from when the water went in to
// `until`. Deliberately NOT `heatSpans` from quality.js: that one clamps to the
// cook window, because a heat score is only about the cook. Water goes on
// boiling after the food is done, and the whole mechanic lives in that gap.
export function boilSpans(session, until) {
  const since = session?.wet?.since;
  if (since == null) return [];
  const marks = (session.heats?.length ? session.heats : [{ at: since, tier: session.heatTier }])
    .map(h => ({ at: h.at, level: h.level ?? levelOfTier(h.tier) }))
    .sort((a, b) => a.at - b.at);

  // The level in force when the water went in — the last mark at or before it.
  // Without this, filling a pot that is already on a high ring would start its
  // evaporation from the NEXT time somebody touched the dial, which is usually
  // never.
  const open = marks.filter(m => m.at <= since).pop() || marks[0] || { level: 0 };
  const out = [];
  let at = since, level = open.level;
  for (const m of marks) {
    if (m.at <= since) continue;
    if (m.at >= until) break;
    out.push({ from: at, to: m.at, level });
    at = m.at; level = m.level;
  }
  if (until > at) out.push({ from: at, to: until, level });
  return out.filter(s => s.to > s.from && s.level > 0);
}

// How much of the pot has gone, 0 (full) to 1 (dry). Uncapped above 1 would be
// meaningless — a dry pot cannot get drier — so it clamps.
export function boiledFraction(session, now = Date.now()) {
  if (!session?.wet) return 0;
  const until = apparentNow(session, now);
  let gone = 0;
  for (const s of boilSpans(session, until)) gone += ((s.to - s.from) * s.level) / BOIL_FULL_MS;
  return Math.max(0, Math.min(1, gone));
}

// The level the ring is at RIGHT NOW, as the burner log records it.
export function currentLevel(session) {
  const marks = session?.heats || [];
  const last = marks[marks.length - 1];
  if (last) return last.level ?? levelOfTier(last.tier);
  return levelOfTier(session?.heatTier || 'low');
}

// WHEN IT RUNS DRY, in the session's own clock, IF THE BURNER STAYS WHERE IT IS.
//
// Null when it never will — the ring is off, or there is no water in the pan. A
// null is what stops a timer being armed for an event that is not coming, and it
// is the same answer `realTimeFor` gives for a paused session.
//
// ⚠ It is a PREDICTION, and predictions go stale. Every burner change reschedules
// (see `applyBurner` → `rescheduleNarration`), which is what keeps this honest
// without anything having to tick.
export function dryAt(session, now = Date.now()) {
  if (!session?.wet) return null;
  // ⚠ A FROZEN CLOCK NEVER REACHES ANYTHING. In the game these two go together —
  // `applyBurner` writes a level-0 mark AND a rate of 0 in one act — but they are
  // separate facts, and answering a time for a session whose apparent clock does
  // not advance is answering a moment that will never come.
  if (sessionRate(session) <= 0) return null;
  const level = currentLevel(session);
  if (level <= 0) return null;
  const left = 1 - boiledFraction(session, now);
  if (left <= 0) return apparentNow(session, now);
  return apparentNow(session, now) + (left * BOIL_FULL_MS) / level;
}

// When the pan is worth warning about, same units and the same null.
export function warnAt(session, now = Date.now()) {
  if (!session?.wet) return null;
  if (sessionRate(session) <= 0) return null;
  const level = currentLevel(session);
  if (level <= 0) return null;
  const gone = boiledFraction(session, now);
  if (gone >= BOIL_WARN_AT) return null;         // already past it; the warning is spent
  return apparentNow(session, now) + ((BOIL_WARN_AT - gone) * BOIL_FULL_MS) / level;
}

// What the pot LOOKS like. Prose and never a number, the same rule the cook
// meter follows: a cook standing over a pan can see the level dropping, and how
// many millilitres are left is not something anybody reads off a stove.
export function waterText(fraction) {
  if (fraction >= 1) return null;                // gone — the caller says so louder
  const band = WATER_LINES.find(l => fraction < l.max);
  return band ? band.text : WATER_LINES[WATER_LINES.length - 1].text;
}

// For the suite, and for anybody sanity-checking the tuning: how long a full pot
// lasts at each position, in seconds.
export const dryOutSeconds = level => (level <= 0 ? Infinity : Math.round(BOIL_FULL_MS / level / 1000));
export const _levels = () => Array.from({ length: MAX_LEVEL + 1 }, (_, n) => n);
