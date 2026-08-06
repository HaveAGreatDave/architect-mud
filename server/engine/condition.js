/**
 * Condition — what the state of your body does to the stats you act with.
 *
 * This is the seam the survival systems were missing. Hunger, thirst and body
 * temperature all had meters that filled, drained and printed warnings, and then
 * fed almost nothing: you could be starving and freezing and still swing, dodge,
 * shoot and pick a lock exactly as well as a warm, fed man. The simulation
 * reported upward — to gossip, to surveillance — but nothing pressured sideways.
 *
 * `effectiveStat` is that sideways edge. It sits under `skillStatBonus`, which
 * every skill in the game already funnels through, so one function here reaches
 * to-hit, dodge, blades, firearms, medicine, navigation, scavenging, cooking —
 * everything — without a single call site changing.
 *
 * DESIGN RULES
 *
 *   1. Penalties only. This never makes you better than your sheet says; it is a
 *      description of being in a bad way, not a buff system. Buffs belong in
 *      status effects, which already exist.
 *   2. Bands, not curves. A player has to be able to feel "I am cold" as a
 *      discrete state they can act on, not a continuous drift they can't read.
 *   3. Nothing bottoms out at zero. Being wrecked makes you worse, never
 *      helpless — a stat floor of 1 keeps a desperate player in the fight.
 *   4. The thresholds MATCH the ones the player is already being warned at, so
 *      the warning text is the tutorial for the mechanic.
 */
import { effectStatBonus } from './effects.js';
import { impairmentStatPenalty, impairmentOf } from './impairment.js';
import { getTimeScale } from './gametime.js';

// Cold hands don't do what you tell them. The bands mirror `tempRegenMultiplier`
// in gameLoop.js exactly, so the message that says you're cold is the same
// moment the penalty lands.
//
// Heat is deliberately gentler on REFLEXES than cold: overheating makes you
// tired and stupid rather than clumsy, so it costs Brains, not Reflexes.
const COLD_REFLEX = [
  [30, 3],   // below 30 — freezing. Three points off; you are barely functional
  [34, 2],   // 30–34 — cold
  [36, 1],   // 34–36 — slightly cold
];
const HOT_BRAINS = [
  [42, 3],   // above 42 — overheating
  [40, 2],   // 40–42 — hot
];

// Running on empty. The thresholds are the ones gameLoop already warns at (20),
// with a harder band where apartments already treats you as spent (5).
const STARVED_BRAWN = [
  [5, 2],    // at or below 5 — no strength left
  [20, 1],   // at or below 20 — very hungry
];

// Dehydration, ordered the way it actually arrives. Thirst used to cost Cool,
// which read as a pun rather than a symptom — being parched doesn't make you
// lose your composure, it makes your body quit on you.
//
//   ENDURANCE   the first and largest real cost. Blood volume drops, the heart
//               works harder for the same output, and everything aerobic gets
//               shorter. This is the headline effect of being dehydrated.
//   BRAINS      only once it's severe. Headache, poor concentration, slow
//               decisions — the documented cognitive cost, and deliberately a
//               band later than the endurance hit so the two don't land together.
const PARCHED_ENDURANCE = [
  [5, 2],    // at or below 5 — wrung out
  [20, 1],   // at or below 20 — very thirsty
];
const PARCHED_BRAINS = [
  [5, 1],
];

// ── Cool and sanity: the loop that can catch you ─────────────────────────────
//
// Cool is now purely a composure stat — the only thing that degrades it is
// losing your grip, which is what it means. Two directions, deliberately:
//
//   COOL → SANITY   a cool head resists the city getting into it. High Cool
//                   slows sanity loss; it does not stop it, because a character
//                   who can never crack isn't in this game.
//   SANITY → COOL   and once you HAVE lost your grip, you lose your composure
//                   with it. Losing your cool is the literal phrase.
//
// That is a feedback loop, and feedback loops kill players. So it is bounded on
// both ends: resistance caps well below immunity, the penalty caps at 2, and
// `effectiveStat` floors every stat at 1 — you can spiral, but you cannot spiral
// to zero. High Cool buys you a longer fall, not a floor you can't go through.
const RATTLED_COOL = [
  [15, 2],   // at or below 15 sanity — visibly coming apart
  [35, 1],   // at or below 35 — rattled
];

// How much of a sanity hit a cool head shrugs off. Caps at 50% so the best
// possible composure halves the damage and never negates it.
export const COOL_SANITY_RESIST_PER_POINT = 0.05;
export const COOL_SANITY_RESIST_CAP = 0.5;

/**
 * Scale a sanity LOSS by the player's composure. Pass the raw amount; get back
 * what actually lands. Uses the EFFECTIVE Cool, so a player who is already
 * rattled resists less — that's the loop, and it's the point.
 */
export function resistSanityLoss(player, amount) {
  const loss = Math.abs(Number(amount) || 0);
  if (!loss) return 0;
  const cool = effectiveStat(player, 'stat_cool');
  const resist = Math.min(COOL_SANITY_RESIST_CAP, cool * COOL_SANITY_RESIST_PER_POINT);
  return loss * (1 - resist);
}

// ── Fatigue ──────────────────────────────────────────────────────────────────
//
// DERIVED from `players.last_slept_at`, never stored as a meter. That buys three
// things: no per-tick write for every player, it survives logout for free (time
// logged off is still time awake), and there is no second number that can drift
// out of step with the first.
//
// PACING, in GAME hours. Everything else the body does — hunger, thirst, drug
// tolerance, withdrawal — is measured on the game clock, and a body that got
// hungry three times a day but tired once every real-time third of a day was the
// odd one out.
//
// The curve is written off what a person actually does: twelve hours up is
// nothing, a full day up is unpleasant and survivable — plenty of people do it —
// and it is the SECOND and THIRD nights that take you apart. So the scale runs to
// three days rather than one, which puts the felt bands where they belong:
//
//   12h →  17   nothing yet, just a note on the rail
//   24h →  33   still nothing mechanical. A hard night is meant to be affordable
//   36h →  50   TIRED
//   48h →  67   EXHAUSTED — Brains starts to go
//   72h → 100   RUINED, and the sanity bleed at its worst
// Slowed 4× (2026-08-01) along with hunger/thirst/bladder/bowel: the bands below
// are the same shape, just stretched — multiply each of the hour marks above by 4
// (12h → 48h, 36h → 144h, 72h → 288h). Sleep still clears a full span in
// SLEEP_FULL_CLEAR_MINUTES, since that's expressed as an outcome, not a ratio.
export const FATIGUE_FULL_HOURS = 288;    // awake this long (GAME time) = completely wrecked
export const FATIGUE_TIRED = 50;          // the first band you can feel — ~36h
export const FATIGUE_EXHAUSTED = 65;      // ~47h
export const FATIGUE_RUINED = 85;         // ~61h — past here it costs you your mind

// THE WORDS FOR THOSE BANDS, next to the numbers that define them.
//
// The tablet's Health app had its own inline ladder, which was fine while it was
// the only thing in the game that said how tired you were out loud. The moment
// the Environment pane said it too, two ladders meant one surface could call you
// exhausted while the other still called you tired — the same class of drift the
// wetness HUD avoids by mirroring WETNESS_LABELS. One list, both readers.
//
// `rested` is a real answer and never blank: a rail that shows nothing until you
// are already suffering can't be read as "I am fine", only as "the HUD is
// broken".
const FATIGUE_BANDS = [
  [FATIGUE_RUINED, 'Wrecked'],
  [FATIGUE_EXHAUSTED, 'Exhausted'],
  [FATIGUE_TIRED, 'Tired'],
];

export function fatigueLabel(v) {
  for (const [floor, label] of FATIGUE_BANDS) if (v >= floor) return label;
  return 'Rested';
}

// Real minutes in a bed to clear a full night's fatigue.
//
// Expressed as an OUTCOME rather than a ratio, because the ratio it replaced was
// a fixed multiple of real time and so drifted whenever the game-speed knob
// moved: at 3× the same constant cleared a full night in 1.6 minutes instead of
// the 5 it was tuned for. Five is long enough to be a decision you make — you
// are not playing during it — and short enough that it never costs a player a
// meaningful slice of their evening. The whole mechanic is worthless if the
// optimal play is to sit in a bed, so it is priced as a short errand.
export const SLEEP_FULL_CLEAR_MINUTES = 5;

/** Real ms of "awake" that one minute of sleep undoes, at the current game speed. */
export function sleepRecoveryPerMinute() {
  return fatigueSpanMs() / SLEEP_FULL_CLEAR_MINUTES;
}

/** Real ms of being awake that takes you from fresh to completely wrecked. */
export function fatigueSpanMs() {
  return (FATIGUE_FULL_HOURS * 3600000) / Math.max(0.01, getTimeScale());
}

export function fatigueOf(player, now = Date.now()) {
  const since = Number(player?.last_slept_at);
  if (!Number.isFinite(since) || since <= 0) return 0;   // never slept = treated as fresh
  return Math.max(0, Math.min(100, ((now - since) / fatigueSpanMs()) * 100));
}

// ── Uppers vs. the fatigue clock ─────────────────────────────────────────────
//
// A stimulant does not rest you. It BORROWS: while you are wired the fatigue
// clock runs backwards, and every minute of relief is banked as debt and handed
// back with interest when the drug lets go. Taking speed to finish the night is
// therefore a real option with a real price, rather than either a free bed (dull)
// or nothing at all (which is what it was — an upper couldn't touch fatigue, and
// isWired even blocked you from lying down, so it was strictly worse than water).
//
// Implemented by moving `last_slept_at` itself rather than masking the readout,
// so a wired player reads as less tired EVERYWHERE at once — stats, the Vitals
// rail, the sleep-deprivation sanity bleed — with no second number to drift.
export const STIM_FATIGUE_RELIEF = 12;    // ms of fatigue erased per real ms wired (unit-free ratio)
export const STIM_FATIGUE_INTEREST = 1.25; // ...paid back at this multiple on the crash

// Tired hands and a tired head. Deliberately spread across two stats rather than
// stacked on one, so exhaustion degrades you broadly instead of gutting a single
// build — and Brains first, because losing your judgement is what being tired
// actually feels like.
// Deliberately gentle. The point is to make sleeping worth doing, not to make
// staying up feel like a punishment — a player who ignores this entirely should
// be slightly worse off, not crippled. The REWARD for sleeping (the Well Rested
// buff) is meant to do more work than the penalty for not.
const FATIGUE_BRAINS = [[FATIGUE_RUINED, 2], [FATIGUE_EXHAUSTED, 1]];
const FATIGUE_REFLEX = [[FATIGUE_RUINED, 1]];

const bandAbove = (bands, value) => {
  for (const [threshold, penalty] of bands) if (value >= threshold) return penalty;
  return 0;
};

const bandPenalty = (bands, value, above = false) => {
  for (const [threshold, penalty] of bands) {
    if (above ? value > threshold : value <= threshold) return penalty;
  }
  return 0;
};

/**
 * How much this stat is currently reduced by the player's physical condition.
 * Positive number = points lost. Exported separately so the UI can explain
 * itself: a player seeing REF 4 when their sheet says 6 deserves to know why.
 */
export function statPenalty(player, stat) {
  if (!player) return 0;
  const temp = Number(player.body_temp_c ?? 37);
  const hunger = Number(player.hunger ?? 100);
  const thirst = Number(player.thirst ?? 100);
  const tired = fatigueOf(player);
  // Anything else currently diminishing this body — injuries first. Registered
  // through impairment.js so a new source needs no edit here.
  const extra = impairmentStatPenalty(player, stat);

  switch (stat) {
    case 'stat_reflexes':
      // Cold is the classic one: numb fingers, slow hands. This is what makes a
      // winter night genuinely dangerous rather than merely atmospheric.
      // Exhaustion stacks on top: cold AND up all night is a bad place to fight.
      return bandPenalty(COLD_REFLEX, temp) + bandAbove(FATIGUE_REFLEX, tired) + extra;
    case 'stat_brains':
      // Overheating, exhaustion, and — only once it's severe — dehydration.
      return bandPenalty(HOT_BRAINS, temp, true)
        + bandAbove(FATIGUE_BRAINS, tired)
        + bandPenalty(PARCHED_BRAINS, thirst) + extra;
    case 'stat_brawn':
      return bandPenalty(STARVED_BRAWN, hunger) + extra;
    case 'stat_endurance':
      // Dehydration's headline cost: you run out of body before you run out of
      // will. This is the stat thirst should always have been taking.
      return bandPenalty(PARCHED_ENDURANCE, thirst) + extra;
    case 'stat_cool': {
      // Composure only. A mind coming apart takes your poise with it, capped at
      // 2 so the Cool→sanity→Cool loop degrades you rather than collapsing you.
      const sanityPct = player.sanity_max ? (player.sanity / player.sanity_max) * 100 : 100;
      return bandPenalty(RATTLED_COOL, sanityPct) + extra;
    }
    default:
      return extra;
  }
}

/**
 * The stat a player is actually acting with, right now. Floored at 1 — being in
 * a terrible way makes you worse, never helpless.
 */
export function effectiveStat(player, stat) {
  const base = Number(player?.[stat]) || 0;
  // Condition takes away; status effects can give back. Well Rested is the first
  // of these — the reward for sleeping properly outweighs the penalty for not,
  // which is the correct shape for an optional chore.
  const net = base - statPenalty(player, stat) + effectStatBonus(player, stat);
  return Math.max(1, net);
}

/**
 * Everything currently dragging on this player, for display. Returns
 * `[{ stat, penalty, why }]`, empty when they're in good order.
 */
export function conditionReport(player) {
  const temp = Number(player?.body_temp_c ?? 37);
  const thirst = Number(player?.thirst ?? 100);
  const out = [];
  const push = (stat, why) => {
    const penalty = statPenalty(player, stat);
    if (penalty) out.push({ stat, penalty, why });
  };
  const tired = fatigueOf(player);
  const tiredWhy = tired >= FATIGUE_RUINED ? 'no sleep' : tired >= FATIGUE_EXHAUSTED ? 'exhausted' : 'tired';
  // Two sources can hit one stat, so name whichever is actually biting.
  push('stat_reflexes', bandPenalty(COLD_REFLEX, temp) ? (temp < 30 ? 'freezing' : 'cold') : tiredWhy);
  push('stat_brains', bandPenalty(HOT_BRAINS, temp, true) ? 'overheating'
    : bandPenalty(PARCHED_BRAINS, thirst) ? 'dehydrated' : tiredWhy);
  push('stat_brawn', 'hunger');
  push('stat_endurance', thirst <= 5 ? 'dehydrated' : 'thirst');
  push('stat_cool', 'rattled');
  // Impairment reasons that aren't stat penalties at all — a refused run, slowed
  // recovery — have nowhere else to surface, so they ride the same rail.
  for (const n of impairmentOf(player).notes) out.push({ stat: null, penalty: 0, why: n.detail, label: n.label });
  return out;
}
