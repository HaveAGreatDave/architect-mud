// Tasting, and what a mouthful tells you.
//
// Every other readout in this system is something you can SEE — the colour of a
// crust, a simmer gone quiet, fat running clear. Tasting is the one channel that
// reaches what looking can't: seasoning, and whether the thing is actually good.
//
// The design rule that makes it interesting: WHAT YOU LEARN SCALES WITH SKILL.
// A novice gets "it needs something" and has to guess what. A good cook gets
// "it's flat — it wants salt". An expert gets that plus the timing and the heat.
// Cooking skill has, until now, only ever changed the OUTCOME. This is the first
// place it changes what you know, which is what a skill should mostly do.
//
// Pure functions over a session and a dish match. No DB, no clock of its own.
import { seasoningIdeal } from './dishes.js';
import { endStateAt } from './quality.js';
import { HEAT_ORDER_TEXT, TASTE_TIERS } from './config.js';

// How many observations a taste yields, and how precise they are. Three tiers,
// keyed off effective Cooking skill.
export function tasteTier(skill) {
  if (skill >= TASTE_TIERS.expert) return 'expert';
  if (skill >= TASTE_TIERS.competent) return 'competent';
  return 'novice';
}

// ── The individual readings ─────────────────────────────────────────────────

// `raw` arrives as a sum of PORTIONS — half a bulb of garlic is 0.5 — so the
// arithmetic is fractional but the sentence must not be. Nobody is
// "under-seasoned by about 0.5 things".
function seasoningNote(raw, ideal, tier) {
  const count = Math.round(raw);
  if (count === ideal) return tier === 'novice' ? 'It tastes like something.' : 'The seasoning is where it should be.';
  const under = count < ideal;
  if (tier === 'novice') return under ? 'It needs something. You are not sure what.' : 'Something in it is too strong.';
  if (tier === 'competent') return under ? 'It is flat. It wants seasoning.' : 'It is over-seasoned.';
  const by = Math.abs(count - ideal);
  return under
    ? `It is under-seasoned by about ${by === 1 ? 'one thing' : `${by} things`}.`
    : `There is ${by === 1 ? 'one thing' : `${by} things`} too much in it.`;
}

function timingNote(state, tier) {
  if (tier === 'novice') {
    if (state === 'raw') return 'It is not there yet.';
    if (state === 'peak') return 'It tastes about right.';
    return 'You have left it too long.';
  }
  const MAP = {
    raw: 'Still raw in the middle — it needs longer.',
    peak: 'This is it. Take it off.',
    over: 'It is past its best and drying out.',
    burnt: 'It is ruined. There is nothing to save here.',
  };
  return MAP[state];
}

function heatNote(profile, session, tier) {
  if (tier !== 'expert' || !profile) return null;
  const want = profile.heatCurve ? profile.heatCurve[0].tier : profile.heatTolerance;
  const got = session.heatTier;
  if (want === got) return null;
  return `It has been cooking ${HEAT_ORDER_TEXT[got] || got} when it wanted ${HEAT_ORDER_TEXT[want] || want}.`;
}

// ── The whole mouthful ──────────────────────────────────────────────────────

// `parts` is whatever the caller could work out: the session being tasted, the
// profile it's cooking under, and (for a vessel) the dish match and how many
// modifiers went in. Anything absent is simply not commented on.
export function tasteNotes({ session, profile, template, modifierCount, skill = 0, now = Date.now() }) {
  const tier = tasteTier(skill);
  const notes = [];

  if (session && profile) {
    notes.push(timingNote(endStateAt(session, profile, now), tier));
    const heat = heatNote(profile, session, tier);
    if (heat) notes.push(heat);
  }
  if (template && modifierCount != null) {
    notes.push(seasoningNote(modifierCount, seasoningIdeal(template), tier));
  }
  // A novice gets one thing to think about; better cooks get the picture.
  const limit = tier === 'novice' ? 1 : tier === 'competent' ? 2 : 4;
  return notes.filter(Boolean).slice(0, limit);
}

// ── Eating ──────────────────────────────────────────────────────────────────

// What a finished dish is like in the mouth. Built from what's stamped on it —
// band, doneness, how long it sat — so it says something true rather than
// generic. This is the payoff for the whole quality ladder: nine bands are only
// worth having if the player can feel the difference between two of them.
const BAND_FLAVOUR = {
  poor: 'It is barely food. You get it down and that is the most that can be said.',
  grim: 'Grim work. You eat it because you are hungry, not because you want to.',
  acceptable: 'It is fine. It does the job and asks nothing of you.',
  decent: 'Decent. Somebody paid a bit of attention to this.',
  good: 'Good — properly good. You slow down a little without meaning to.',
  'very good': 'Very good. There is a moment near the middle where you stop and notice it.',
  excellent: 'Excellent. Whoever made this knew exactly what they were doing.',
  superb: 'Superb. You eat the last of it far more slowly than the first.',
  masterful: 'Masterful. You will think about this later, in a quiet moment, for no reason at all.',
};

const DONENESS_FLAVOUR = {
  blue: 'Barely warmed through, and it fights you a little.',
  rare: 'Red at the centre, and all the better for it.',
  medium: 'Pink in the middle, exactly as it should be.',
  'well done': 'Cooked right through — no pink, no argument.',
  runny: 'The yolk goes everywhere.',
  soft: 'Just set, and still soft.',
  hard: 'Set hard the whole way through.',
};

export function flavourLines(cd = {}, restState = null) {
  const lines = [];
  const band = cd.cook_quality;
  if (band && BAND_FLAVOUR[band]) lines.push(BAND_FLAVOUR[band]);
  if (cd.doneness && DONENESS_FLAVOUR[cd.doneness]) lines.push(DONENESS_FLAVOUR[cd.doneness]);
  if (restState === 'cold') lines.push('It has gone cold, which takes the edge off it.');
  else if (restState === 'rested') lines.push('It sat exactly as long as it wanted to.');
  if (cd.minced) lines.push('No texture to speak of — but it was quick.');
  return lines;
}
