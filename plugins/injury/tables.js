// Injury tables — the whole tunable surface of the system, in one file.
//
// Two independent lists (7 parts, 5 damage types) and a name table, never a
// 7x5 grid of mechanics. See docs/proposals/injury-system.md §3: the PART owns
// what an injury does; the TYPE owns how likely, how bad, how long and what it
// reads like. Keep it that way — the moment `fire` to the leg does something
// mechanically different from `edged` to the leg, this becomes a matrix nobody
// can balance.

// The parts combat actually rolls (server/engine/combat.js:254). Arms and legs
// are lateralized, which the naming layer gets for free.
export const PARTS = ['head', 'torso', 'left_arm', 'right_arm', 'left_leg', 'right_leg', 'feet'];

export const PART_LABELS = {
  head: 'head', torso: 'torso',
  left_arm: 'left arm', right_arm: 'right arm',
  left_leg: 'left leg', right_leg: 'right leg',
  feet: 'feet',
};

// Severity is an integer so it can be compared and stepped. 0 is "no injury".
export const BRUISED = 1;
export const HURT = 2;
export const MAIMED = 3;

export const SEVERITY_LABELS = { 1: 'Bruised', 2: 'Hurt', 3: 'Maimed' };

// Band vocabulary shared with the Vitals app, so the tablet never has to decide
// what "bad" means (client/game/js/panels/tablet-os.js:3991).
export const SEVERITY_BANDS = { 0: 'good', 1: 'warn', 2: 'bad', 3: 'crit' };

// ── Damage types ─────────────────────────────────────────────────────────────
//
// threshold  — fraction of max HP a POST-SOAK hit must exceed to injure at all.
//              Armour that did its job prevents the wound outright.
// step       — how many MULTIPLES of the threshold buy the next severity rung.
//              SMALL = steep. See the balance note below for why this is
//              geometric rather than a flat additive slice.
// healMins   — real minutes to shed one rung of severity.
// cumulative — an already-injured part is easier to injure again.
//
// Read the `kinetic` row: a high bar that most blunt hits fail, and a steep climb
// once cleared. A pipe glances off your ribs eleven times and the twelfth breaks
// something. `edged` is the deliberate opposite — a low bar and a shallow climb,
// so a blade wounds constantly and ruins rarely. Neither is strictly better.
//
// ── Balance note (2026-07-29 tuning pass) ────────────────────────────────────
// These rungs used to be ADDITIVE — `(frac - threshold) / escalation` — which
// made severity linear in a quantity that is not bounded. Damage in this game
// runs from 2 to 100 while `hp_max` is a flat 40, so `frac` spans 0.05 to 2.5
// against a maim bar of 0.38: every weapon above about 15 average damage maimed
// on 100% of its hits, THROUGH heavy armour, which broke the system's own rule
// that armour doing its job prevents the wound. Measured before the change:
// SMG 55% maim per hit (92% of head hits), breacher shotgun / sledgehammer /
// thermal lance 100%. Expected wounds in a normal fight were 2.5–3.8, against a
// design target of "zero or one".
//
// Geometric rungs fix the saturation: each rung costs a MULTIPLE of the bar, so
// overwhelming damage tapers instead of guaranteeing the worst outcome. Values
// below come from a grid search against explicit targets (~1.2 wounds/fight,
// ~1.2% maim per hit, ~12% of head hits) over the real authored weapon set.
// The character is a CONSTRAINT on these numbers, not an outcome of tuning them:
// edged must keep the lower bar AND the shallower climb, kinetic the higher bar
// AND the steeper one. A tuning pass that inverts that has mis-tuned, however
// good its rates look — an early pass did exactly that, because identical targets
// applied to types wielded by very different weapons quietly swap their roles.
export const TYPES = {
  edged:     { threshold: 0.16, step: 2.00, healMins: 90,  cumulative: false },
  kinetic:   { threshold: 0.28, step: 1.45, healMins: 45,  cumulative: true  },
  energy:    { threshold: 0.22, step: 1.60, healMins: 90,  cumulative: false },
  fire:      { threshold: 0.22, step: 2.10, healMins: 150, cumulative: true  },
  radiation: { threshold: 0.10, step: 2.60, healMins: 300, cumulative: false },
};

export const DEFAULT_TYPE = 'kinetic';

export function typeRules(type) { return TYPES[type] || TYPES[DEFAULT_TYPE]; }

// A crit is a hit that found a gap — it lowers the bar rather than adding a rung,
// so it makes an injury LIKELIER without making every crit catastrophic.
//
// This is now the ONLY way a crit reaches the injury system. It used to ALSO
// arrive as inflated damage (crit multiplies the blow by 1.5 before the check),
// so a crit both lowered the bar and raised the number cleared against it —
// counted twice. Combat now passes `baseDamage` alongside `damage`, and this
// system scores the base. Same for the head multiplier, below.
export const CRIT_THRESHOLD_SCALE = 0.7;

// A head hit is easier to wound, and that is ALL it is now. The engine still
// multiplies head damage by 1.5 for HP purposes — that is untouched — but that
// multiplier no longer also feeds the injury check, where it was compounding
// with crit and `cumulative` to produce a 92%-of-head-hits maim rate on an SMG.
export const HEAD_THRESHOLD_SCALE = 0.7;

// How much easier a `cumulative` type finds an already-wounded part.
export const CUMULATIVE_THRESHOLD_SCALE = 0.6;

// Sleeping heals faster. Implemented as backdating (see index.js) so the lazy
// decay model needs no tick of its own.
export const SLEEP_HEAL_MULTIPLIER = 3;

// ── Names ────────────────────────────────────────────────────────────────────
//
// Purely cosmetic. `(type, severity, part)` picks a name; the engine sees only a
// severity integer. This is the granularity budget: mechanics stay fixed at
// 3 rungs x 7 parts forever, while perceived variety is unbounded and made of
// strings.
//
// UNAUTHORED IS A VALID STATE. Lookup falls back
//   type.severity.part -> type.severity -> severity -> generic
// exactly the way `text_by_relation` falls back to a node's ordinary text. Never
// feel obliged to fill this in; add a name when a combination reads flat.
const NAMES = {
  'kinetic.2.head': 'concussed',
  'kinetic.3.head': 'skull-cracked',
  'kinetic.2': 'bruised deep',
  'kinetic.3': 'fractured',
  'edged.2': 'gashed',
  'edged.3': 'laid open',
  'energy.2': 'seared',
  'energy.3': 'burned through',
  'fire.2': 'scorched',
  'fire.3': 'charred',
  'radiation.2': 'blistering',
  'radiation.3': 'sloughing',
  '1': 'bruised',
  '2': 'hurt',
  '3': 'ruined',
};

export function injuryName(type, severity, part) {
  return NAMES[`${type}.${severity}.${part}`]
      ?? NAMES[`${type}.${severity}`]
      ?? NAMES[String(severity)]
      ?? 'injured';
}
