// Drinks balance knobs. Everything tunable lives here so the rest of the plugin
// reads as logic rather than as numbers — same arrangement as cooking/config.js.

import { QUALITY_BANDS } from '../../server/engine/quality-bands.js';

// ── Composition ──────────────────────────────────────────────────────────────
// How hard the worst ingredient drags the result down. A drink is a blend, so
// this is gentler than cooking's: one cheap mixer doesn't ruin good gin the way
// one burnt component ruins a plate of food.
export const WORST_PULL = 0.35;

// What an unmatched pile of liquid can ever be.
export const SLOP_CEILING = 'acceptable';

// Knowing the recipe is worth a sub-band nudge, not a free tier.
export const KNOWN_RECIPE_BONUS = 0.6;

// Modifiers: bitters, syrup, garnish. Bonus per dash up to the ideal, penalty
// for every one past it. Over-sweetening is a real way to ruin a drink and it
// should cost more than under-seasoning does.
export const MODIFIER_BONUS = 0.5;
export const MODIFIER_BONUS_CAP = 1.2;
export const OVER_SEASON_PENALTY = 0.9;
export const DEFAULT_SEASONING = 1;

// ── Alcohol ──────────────────────────────────────────────────────────────────
// One pour, in millilitres, and what counts as one standard unit of ethanol.
// These two numbers are the whole conversion — everything else is arithmetic.
export const POUR_ML = 25;
export const STANDARD_UNIT_ML = 10;   // ml of pure ethanol per standard unit

// The potency multiplier handed to the existing drug_alcohol path is clamped
// here. The floor stops a drink with a splash of something in it registering as
// nothing at all; the ceiling stops a glass of neat spirit outrunning what the
// intoxication plugin was tuned against.
export const POTENCY_MIN = 0.4;
export const POTENCY_MAX = 3.0;

// ── Hot drinks ───────────────────────────────────────────────────────────────
// Brewed drinks are best on arrival and worth progressively less as they sit.
// This is derived from `hot_at` at DRINK time and never baked into the stamped
// band — a cold flat white is a cold flat white, and reheating isn't a thing you
// can do to a cup you already poured.
export const HOT_PEAK_MS = 4 * 60 * 1000;    // this long at its best
export const HOT_COLD_MS = 20 * 60 * 1000;   // fully cold by here
export const HOT_COLD_PENALTY = 0.45;        // multiplier on restores when stone cold
export const INSULATED_MULT = 3.5;           // a thermos stretches both windows

// ── Appliance tiers ──────────────────────────────────────────────────────────
// Furniture `flags.brew_tier`, mirroring cooking's stove_tier: a band bonus and
// a hard ceiling. A kettle makes tea beautifully; it can put grounds in hot
// water and call it an espresso, and the ceiling is what stops anyone believing it.
export const BREW_TIERS = {
  kettle:  { bonus: 0,   ceiling: 'excellent',  label: 'kettle' },
  machine: { bonus: 0.6, ceiling: 'superb',     label: 'machine' },
  barista: { bonus: 1.2, ceiling: 'masterful',  label: 'bar rig' },
};

// ── What a serving is worth ──────────────────────────────────────────────────
// The restore arithmetic every stamped drink carries, in the one place it can
// be tuned. Read only by vessel.js makeDrink(), which is the only thing that
// builds a drink object.
export const THIRST_PER_SERVING = 14;
export const BAND_MULT_BASE = 0.6;    // what poor is worth
export const BAND_MULT_STEP = 0.08;   // per rung up the ladder

// ── Technique and state ──────────────────────────────────────────────────────
// A shaken drink built in an actual shaker. Small, because the shaker's real
// reward is that shaken templates are unreachable without one.
export const SHAKEN_BONUS = 0.8;

// Drinking out of a dirty glass. The residue penalty is on top, and only when
// what was in there last has no business in what's in there now — the same
// shape as cooking's fond: a coffee cup that last held coffee is fine.
export const DIRTY_PENALTY = 0.7;
export const RESIDUE_MISMATCH_PENALTY = 1.1;

// Difficulty is checked against the COOKING skill — see README. This scales the
// margin into a sub-band nudge.
export const SKILL_BAND_SCALE = 0.12;

export const bandsList = () => QUALITY_BANDS;

// ── What a machine serves, and what it charges ───────────────────────────────
// A rig that pulls its own drink (furniture `flags.vend_drink`) hands over a cup
// with something already in it. Two numbers per tier, and both are the tier's
// luxury saying the same thing twice in the two places a player feels it.
//
// The band is DELIBERATELY a rung or two under the tier's own ceiling. Pushing a
// button gets you a consistent cup; the top of the ladder is what a pair of
// hands is for, and a player brewing at the same rig with good grounds and a
// good roll can beat it. A machine that served masterful would end the argument
// for ever making anything yourself.
export const VEND_BANDS = {
  kettle:  'acceptable',   // an urn. It was made at some point.
  machine: 'good',
  barista: 'excellent',
};

// Charged ON TOP of the cup's own `value`, because you keep the cup — a rig that
// handed out ₵45 porcelain for the price of a coffee would be a money faucet
// wearing an apron. Cup + charge is also why "luxury" needs nothing new
// authored: the salon's brass lever puts a demitasse in your hand and the urn
// at the Flashpoint puts a paper cup in it, and the price already knows.
export const VEND_CHARGE = {
  kettle:  2,
  machine: 5,
  barista: 8,
};
