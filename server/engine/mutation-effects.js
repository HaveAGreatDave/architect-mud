/**
 * The mutation effect VOCABULARY — what an authored `effects` key is allowed to
 * mean, and which engine seam reads it.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────
 *
 * Every mutation in `content/mutations/` shipped with an `effects` JSONB, and
 * until 2026-08 NOTHING ANYWHERE READ IT. Four authored keys — rad_resistance,
 * sanity_drain_reduction, status_on_hit, perception_bonus — sat in the database
 * for months looking exactly like mechanics. The only things that ever did
 * anything were `stat_modifiers` and the `visible` boolean. Authors wrote
 * effects; players got stat stickers.
 *
 * The fix is not "read the JSON". The fix is that an effect key must be
 * DECLARED before it can be authored, so the failure mode inverts: an
 * unrecognised key is logged loudly at boot and a regress case fails the build,
 * instead of being silently ignored forever. `getRegisteredMutationEffects()`
 * exists for exactly that assertion.
 *
 * ── The three fields ─────────────────────────────────────────────────────────
 *
 * kind   — 'number'   summed across mutations (a bonus, a die, a soak point)
 *          'fraction' 0..1, combined multiplicatively as diminishing returns, so
 *                     three sources of cold resistance can never total immunity
 *          'flag'     true if ANY carried mutation asserts it at all
 *
 * scale  — how expression modulates the authored value.
 *          'linear'    value × (expression/100). The default, and right for
 *                      anything continuous: a 40%-expressed carapace soaks less.
 *          'threshold' the full value once expression >= `min`, nothing below.
 *                      Right for anything you either have or don't — you cannot
 *                      breathe 40% underwater.
 *          'none'      the authored value regardless of expression.
 *
 * seam   — which reader consumes it. This is documentation AND dispatch: the
 *          accessors in mutations.js filter this registry by seam, so a key
 *          declared under 'acuity' can never leak into a stat calculation.
 *
 * ── Registered vs consumed ───────────────────────────────────────────────────
 *
 * Everything below is REGISTERED, so it can be authored and validated. Two keys
 * are deliberately not yet CONSUMED by any reader — 'swim' and 'stealth_penalty'
 * — because their seams (the move-gate exemption and the thievery roll) are
 * later-phase work. They are marked `unconsumed: true` and reported by
 * `getUnconsumedMutationEffects()` so this state is visible rather than a second
 * silent-inertness problem wearing a nicer hat. Clear the flag when you wire one.
 */

// key -> { kind, scale, min, seam, unconsumed }
const registry = new Map();

export function registerMutationEffect(key, { kind, scale = 'linear', min = 1, seam, unconsumed = false }) {
  if (!key || !seam) throw new Error('registerMutationEffect: key and seam required');
  if (!['number', 'fraction', 'flag'].includes(kind)) {
    throw new Error(`registerMutationEffect(${key}): kind must be number|fraction|flag`);
  }
  registry.set(key, { kind, scale, min, seam, unconsumed });
}

export function getMutationEffectSpec(key) { return registry.get(key) || null; }
export function getRegisteredMutationEffects() { return [...registry.keys()]; }
export function getUnconsumedMutationEffects() {
  return [...registry.entries()].filter(([, s]) => s.unconsumed).map(([k]) => k);
}
export function mutationEffectsForSeam(seam) {
  return [...registry.entries()].filter(([, s]) => s.seam === seam).map(([k]) => k);
}

/**
 * Apply expression to one authored value, per the key's scale.
 *
 * Expression 100 must return the authored value EXACTLY for 'linear'. That is
 * not cosmetic: scripts/unbake-mutation-stats.mjs sets every legacy row to 100
 * precisely so the move off baked stat columns is arithmetically net-zero on
 * characters who already exist. Break the identity and you re-stat the server.
 */
export function scaleByExpression(key, value, expression) {
  const spec = registry.get(key);
  const n = Number(value);
  if (!spec || !isFinite(n)) return 0;
  const e = Math.max(0, Math.min(100, Number(expression) || 0));

  if (spec.kind === 'flag') return e >= spec.min ? 1 : 0;
  if (spec.scale === 'none') return n;
  if (spec.scale === 'threshold') return e >= spec.min ? n : 0;

  const scaled = n * (e / 100);
  // Round toward zero for whole-number seams so a 20%-expressed +1 is 0 rather
  // than a phantom fractional point that displays as +1 and adds nothing. A
  // fraction keeps its precision — resistances are compared, never displayed raw.
  return spec.kind === 'number' ? Math.trunc(scaled) : scaled;
}

// ── The vocabulary ───────────────────────────────────────────────────────────
//
// Grouped by seam. Adding a key here is the entire cost of making it authorable;
// adding one WITHOUT a reader is how this system failed the first time, so each
// group names its reader.

// Senses — read by senses.js acuitySync(), inside the existing [-3,+5] clamp.
// Numbers, because acuity is an integer ladder shared with stats and gear.
registerMutationEffect('acuity_sight',   { kind: 'number', seam: 'acuity' });
registerMutationEffect('acuity_hearing', { kind: 'number', seam: 'acuity' });
registerMutationEffect('acuity_smell',   { kind: 'number', seam: 'acuity' });
// Threshold, not linear: dark-adapted eyes either are or aren't. A 30% night
// membrane that let you see 30% of the way into a dark room would be a worse
// mechanic than one that does nothing.
registerMutationEffect('lowlight_vision', { kind: 'flag', min: 25, seam: 'acuity' });
// The cost side of the same organ. Positive value, subtracted by the reader —
// keeping every authored number positive means an author never has to reason
// about whether a minus sign helps or hurts.
registerMutationEffect('brightlight_penalty', { kind: 'number', seam: 'acuity' });

// Armour — read through registerArmorContributor, landing in player.soak like
// any worn piece. Typed to match armor_soak, so mutation plate and steel plate
// are the same currency and resolveSoak needs no special case.
for (const t of ['kinetic', 'edged', 'energy', 'fire', 'acid', 'radiation']) {
  registerMutationEffect(`soak_${t}`, { kind: 'number', seam: 'soak' });
}

// Resistances — fractions, combined multiplicatively by mutationResist().
registerMutationEffect('rad_resistance',        { kind: 'fraction', seam: 'resist' });
registerMutationEffect('cold_resistance',       { kind: 'fraction', seam: 'resist' });
registerMutationEffect('heat_resistance',       { kind: 'fraction', seam: 'resist' });
registerMutationEffect('poison_resistance',     { kind: 'fraction', seam: 'resist' });
registerMutationEffect('disease_resistance',    { kind: 'fraction', seam: 'resist' });
registerMutationEffect('sanity_drain_reduction',{ kind: 'fraction', seam: 'resist' });
registerMutationEffect('bleed_resistance',      { kind: 'fraction', seam: 'resist' });

// Combat — read by the weapon plugin's unarmed fallback and the on-hit roll.
registerMutationEffect('unarmed_damage_bonus', { kind: 'number', seam: 'combat' });
registerMutationEffect('unarmed_bleed_chance', { kind: 'fraction', seam: 'combat' });
// Threshold: teeth sharp enough to matter, or teeth.
registerMutationEffect('bite_attack', { kind: 'flag', min: 40, seam: 'combat' });

// Rates — read by the regen and durability ticks. Positive = faster/more.
registerMutationEffect('heal_rate',            { kind: 'fraction', seam: 'rate' });
registerMutationEffect('stamina_regen',        { kind: 'fraction', seam: 'rate' });
registerMutationEffect('sleep_need_reduction', { kind: 'fraction', seam: 'rate' });
// The cost of acidic sweat and the like: ordinary cloth wears faster against
// your own skin. Read as a MULTIPLIER on wear(), so 0.5 means 50% more wear.
registerMutationEffect('wear_acceleration', { kind: 'fraction', seam: 'rate' });

// Carry — read by carryCapacity.
registerMutationEffect('carry_bonus', { kind: 'number', seam: 'derived' });

// Social — read by the warmth adjustment in relations.js, alongside hygiene's
// warmthMultiplier. A FRACTION: how much of a warmth GAIN is lost, so 0.3 means
// people come round to you 30% slower. It can never make anyone like you less,
// only slow how fast they warm — same contract hygiene has, for the same reason.
//
// This is the seam that makes a visible mutation cost you something in a city
// with opinions, without anyone ever writing a rule saying "mutants are hated".
registerMutationEffect('social_penalty', { kind: 'fraction', seam: 'social' });

// ── The mutagen vocabulary (Phase 2) ─────────────────────────────────────────
//
// Everything here has a reader, named in its comment. The discipline that made
// Phase 1 worth doing applies harder now: a Wildblood mutation that is famous in
// the fiction and inert in the code would be the original bug with better prose.
//
// Note how much of the mutagen pool needs NO new key. Chitinous Carapace and
// Biological Armor are `soak_*`. Adaptive Flesh is the four resistances. Spider
// Limbs and Tentacular Arms are `carry_bonus`. Symbiotic Organism is `heal_rate`
// plus `sleep_need_reduction`. Reusing the vocabulary is what keeps 48 mutations
// from becoming 48 special cases.

// Perception organs. Read by mutationSeesInDark() in mutations.js, which the
// describe path and detectMutations both consult — these are what let a
// Wildblood see in a room that is dark for everyone else.
registerMutationEffect('thermal_vision', { kind: 'flag', min: 25, seam: 'acuity' });
registerMutationEffect('echolocation',   { kind: 'flag', min: 30, seam: 'acuity' });

// Underwater breathing. Read by plugins/swimming breathMax() alongside the
// `rebreather` item tag, so gills and a bought rebreather answer the same
// question in the same place rather than forking the drowning rules.
registerMutationEffect('gills', { kind: 'flag', min: 30, seam: 'movement' });

// Natural weapons. Read by plugins/weapon resolveAttack's UNARMED branch, which
// is why none of this is a parallel combat system: a mutated fist is a
// weaponStats object exactly like a pipe is, and everything downstream (soak,
// crits, body parts, injury, durability) treats it identically.
//
// `unarmed_edged` retypes the damage: claws and blades CUT, and edged has a low
// injury bar and a shallow climb (see plugins/injury/tables.js), so this changes
// what your hands do to a body rather than only how much.
registerMutationEffect('unarmed_edged',  { kind: 'flag',     min: 30, seam: 'combat' });
registerMutationEffect('venom_potency',  { kind: 'fraction',         seam: 'combat' });

// Active organs. Each is a verb (plugins/mutations/organs.js) rather than a
// passive modifier, because a discharge you cannot choose to fire is just a
// damage number with a story attached.
registerMutationEffect('shock_attack', { kind: 'number', seam: 'combat' });
registerMutationEffect('sonic_attack', { kind: 'number', seam: 'combat' });
registerMutationEffect('morph',        { kind: 'flag', min: 40, seam: 'combat' });

// Camouflage. Read by engine/stealth.js concealment(), so it stacks with the
// darkness and the crouch the sneak system already scores rather than replacing
// the roll with a special case.
registerMutationEffect('camouflage', { kind: 'number', seam: 'stealth' });

// Limb regrowth. Read by plugins/injury's decay, which accelerates healing on
// LIMB parts specifically. Distinct from heal_rate, which is HP.
registerMutationEffect('limb_regrowth', { kind: 'fraction', seam: 'rate' });

// How likely a grown part is to be struck. Read by hitWeightsForPlayer — a
// mutation that authors this makes its own limb a target, which is the cost of
// having one. Absent or zero keeps the part unhittable.
registerMutationEffect('part_hit_weight', { kind: 'number', scale: 'none', seam: 'derived' });

// Swimming. Read by plugins/swimming, folded into the EFFECTIVE SKILL rather
// than discounted off the stroke cost, so it can never walk through the
// MIN_STROKE floor and make swimming free.
registerMutationEffect('swim', { kind: 'flag', min: 30, seam: 'movement' });

// The counterpart to `camouflage`, read on the same line of engine/stealth.js
// concealment(). A body that glows, clicks or reeks is worse at not being seen.
registerMutationEffect('stealth_penalty', { kind: 'number', seam: 'stealth' });

/**
 * Flight — read by FOUR seams, none of which is fall damage.
 *
 * This key spent two phases registered-and-unconsumed because the obvious
 * reading of "wings" is falling more slowly, and this game has no fall-damage
 * system to ride. Building one for a single mutation would have been the
 * parallel-system trap this whole file exists to prevent.
 *
 * The fix was to stop asking what wings do to gravity and ask what they do to
 * a MAP and a FIGHT, both of which the game already models:
 *
 *   cliffs   engine:impassable-terrain (commands/movement.js) — the one named
 *            exemption that gate's own comment always anticipated. Not a gear
 *            exemption and it cannot become one: nothing purchasable opens a
 *            cliff, only a body that grew wings.
 *   water    plugins/swimming — you cross dry, on the same path a boat uses, so
 *            every downstream check (submersion, breath, wetness, cold, stamina)
 *            comes for free. Not underwater; wings are no help once you are under.
 *   fleeing  playerFleeRoll (combat.js) — going up is the oldest way out. Applied
 *            to the flee contest ONLY, never the in-fight dodge: wings help you
 *            LEAVE, they do not make you harder to hit while you stay.
 *   swoop    plugins/mutations/organs.js — the power move. Positional rather than
 *            stronger: one hit from above, then you are on the ground in the
 *            middle of them.
 */
registerMutationEffect('flight', { kind: 'flag', min: 60, seam: 'movement' });

// ── Registered, not yet consumed ─────────────────────────────────────────────
// Currently EMPTY, and the regress suite asserts that. Anything added here must
// carry a comment saying why the key cannot have a reader yet, and the cap in
// plugins/mutations/regress.js must be raised deliberately in the same commit.
// That friction is the entire discipline keeping this system out of the
// inert-JSONB state it started in.
