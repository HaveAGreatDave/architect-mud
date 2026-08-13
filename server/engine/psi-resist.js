/**
 * PSYCHIC RESISTANCE — how hard your mind is to reach.
 *
 * ── The rule this file exists to enforce ─────────────────────────────────────
 *
 * RESISTANCE IS DERIVED FROM WHO YOU ALREADY ARE. IT IS NEVER AUTHORED TWICE.
 *
 * The obvious build was a second trainable skill — `psi_resistance` beside
 * `psionics` — and it is wrong for the same reason `overclock_max` does double
 * duty in augments rather than a second "hardness" column: the numbers that should
 * decide whether a mind can be read ALREADY EXIST, scattered across five systems
 * that each own their half properly.
 *
 *   - Cool and Brains are literally the stats for composure and mental discipline.
 *   - The Long Watch's whole identity is mental mastery, and plugins/mastery
 *     already ships Cold Mind and Fear Discipline.
 *   - `mut_static_mind` has carried "partial immunity to sanity loss, Architect
 *     signals are louder" since long before this system existed.
 *   - A neural coprocessor is a machine between your thoughts and the world.
 *   - Drugs and status effects already move mental state through effects.js.
 *
 * A second skill would mean a Long Watch monk with a coprocessor and Static Mind
 * is trivially readable unless they ALSO ground an arcane skill they philosophically
 * reject. That is not a balance problem, it is the setting being contradicted by a
 * column. So: contributors register themselves, this file nets them, and nobody
 * writes the same number down twice.
 *
 * It also means resisting psionics costs nothing and requires no opt-in. Everyone
 * has some. That is deliberate — §8 of the brief is explicit that a baseline
 * resistance is what stops a high-rank Exodus trivially owning everyone, and a
 * resistance you have to go and buy is one most players will not have.
 *
 * ── Read tier ────────────────────────────────────────────────────────────────
 *
 * `psiResistance` is SYNC BY CONTRACT — no awaits, no queries. It is called from
 * the compulsion window (once per second, per target), from combat-adjacent
 * strikes and from per-observer detection. Same contract as `getRelation`,
 * `hygieneOf` and `acuitySync`: if this ever needs to await, the caller is wrong.
 */
import { effectiveStat } from './condition.js';
import { PSI_CAP } from './psionics.js';

// owner -> fn(target, ctx) -> number
//
// Keyed by owner, so re-registering replaces rather than stacks, and a thrower is
// skipped rather than taking the caller down. Same shape as every other
// contributor registry in the tree (`registerSanityResistor`,
// `registerAcuityContributor`, `registerBodyPartProvider`).
const resistors = new Map();

/**
 * Cap on what any ONE contributor may add.
 *
 * Bounded per-contributor rather than only in total, because the failure mode
 * this prevents is a single system quietly becoming the whole answer — an augment
 * that returns 40 makes every other source decorative, and nobody notices until
 * psionics stops working on Ascendants entirely.
 */
export const CONTRIBUTOR_CAP = 8;

export function registerPsiResistor(fn, owner = 'unknown') {
  if (typeof fn === 'function') resistors.set(owner, fn);
}
export function getPsiResistors() { return [...resistors.keys()]; }
export function clearPsiResistor(owner) { resistors.delete(owner); }

/**
 * How hard this target is to reach, as a difficulty number the psion must beat.
 *
 * Stats are the floor everyone has. Contributors add on top. `ctx` carries the
 * discipline and ability so a contributor can be SPECIFIC — the Long Watch's
 * training should resist compulsion and fear far better than it resists somebody
 * reading a bloodstain on their boot, and a contributor that ignores ctx and
 * returns a flat number is contributing a worse answer than it could.
 *
 * NPCs pass through here identically to players. §25 of the brief asks for NPC
 * parity and this is most of it: an NPC with stats has resistance, with no roster,
 * no table and no per-NPC authoring.
 */
export function psiResistance(target, ctx = {}) {
  if (!target) return 0;

  // The baseline. Cool is composure under pressure and Brains is the discipline to
  // notice you are being pushed; between them they are what an ordinary person
  // brings to this, and an ordinary person should not be an open book.
  const cool = effectiveStat(target, 'stat_cool');
  const brains = effectiveStat(target, 'stat_brains');
  let total = (cool * 0.6) + (brains * 0.4);

  for (const fn of resistors.values()) {
    try {
      const add = Number(fn(target, ctx)) || 0;
      total += Math.min(CONTRIBUTOR_CAP, Math.max(0, add));
    } catch { /* a broken resistor must not make a mind unreadable */ }
  }

  return Math.max(0, total);
}

/**
 * The same number expressed as the fraction of an effect that gets shrugged off,
 * for callers scaling a duration or a magnitude rather than setting a difficulty.
 *
 * ⚠ Capped at PSI_CAP, never 1. Nothing psionic ever reaches certainty and nothing
 * is ever perfectly immune — the same rule as VEIL_CAP, applied from the other
 * side. A mind that literally cannot be touched has left the game's consequence
 * loop rather than outplayed it, and it would also make the entire Exodus
 * discipline worthless against exactly the characters it is most interesting
 * against.
 */
export function psiResistFraction(target, ctx = {}) {
  const r = psiResistance(target, ctx);
  return Math.min(PSI_CAP, r / (r + 12));
}

/**
 * Contest a psionic effect against a target's mind.
 *
 * `margin` is what the psion won by, already net of resistance — feed it straight
 * to `awardSkillUse` (whose third argument is the MARGIN, not an amount: a BIGGER
 * number pays LESS).
 */
export function contest(checkResult, target, ctx = {}) {
  const resist = psiResistance(target, ctx);
  const margin = (Number(checkResult?.margin) || 0) - resist;
  return { success: margin >= 0, margin, resist };
}
