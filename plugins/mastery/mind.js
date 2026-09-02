/**
 * Mind — Fear Discipline.
 *
 * The Watch's answer to the thing in the alley. Not courage as a personality
 * trait: a trained response to having seen worse, which is why it is taught
 * rather than rolled.
 *
 * It rides `registerSanityResistor` in `server/engine/condition.js`, a seam that
 * already existed and whose header names this as its first customer. The engine
 * owns the arithmetic — resistors combine multiplicatively, each is individually
 * capped at `RESISTOR_CAP`, and no stack of them can reach immunity — so this
 * file returns one fraction and nothing else.
 *
 * ⚠ IT RESISTS WHAT YOU WITNESSED, NEVER WHAT YOU DID TO YOURSELF, and that
 * split is the whole design. Most sanity loss in this game is self-inflicted:
 * a drug, a botched splice, a synthesis byproduct, psionic strain, the
 * Purifier, going without sleep. Discipline is not a defence against a choice
 * you made, and a Fear Discipline that softened all of it would be "take less
 * sanity damage", which is a flat passive on the one resource with no other
 * defence — the exact thing the system's founding rule forbids. So the gate is
 * an allow-list and it FAILS CLOSED: an unrecognised reason gets nothing.
 *
 * ⚠ THE LIST IS SHORT BECAUSE THE GAME IS. As of 2026-09-02 `adjustSanity` has
 * about twenty call sites and only two are losses this discipline should touch.
 * That is a fact about how much horror is currently wired, not a gap here, and
 * it is why the set below is exported: a new grotesque thing opts in by naming
 * its reason here, in one place, rather than by this file trying to guess from
 * a substring. Adding a horror source and forgetting this line is the failure
 * mode to watch for, and it is a cheap one to fix.
 */
import { effectiveRank } from './purity.js';

export const FEAR_MIN_RANK = 20;

// The engine's own RESISTOR_CAP is 0.5 and would clamp anything higher; stating
// it here as well means the number this file returns is the number it means.
export const FEAR_MAX_RESIST = 0.5;

/**
 * Sanity losses that come from having SEEN something.
 *
 * ⚠ 'you watched that' is in and 'you killed the stray' is deliberately not.
 * Watching an animal killed in front of you is horror. Killing it yourself is
 * guilt, and no amount of training is a defence against what you chose to do —
 * which is the same line the rest of this file is drawn on.
 */
export const FEAR_REASONS = new Set([
  'haunt',              // server/engine/commands/ghost.js — a dead player leaning on you
  'you watched that',   // plugins/strays — the cat, killed in front of you
]);

/** Is this loss the kind a trained nerve helps with? */
export function isFear(reason) {
  return typeof reason === 'string' && FEAR_REASONS.has(reason);
}

/**
 * The fraction of a fear-shaped sanity loss this body shrugs off.
 *
 * SYNC BY CONTRACT — `adjustSanity` is called from ticks and from the combat
 * path, so this reads the hydrated rank and does arithmetic. No query, ever.
 */
export function fearResist(player, reason) {
  if (!player || !isFear(reason)) return 0;
  const rank = effectiveRank(player, 'mind');
  if (rank < FEAR_MIN_RANK) return 0;
  // Rank 100 lands exactly on the engine's cap rather than sailing past it, so
  // the ceiling is a designed number here and not an accident of the clamp.
  return Math.min(FEAR_MAX_RESIST, (rank - FEAR_MIN_RANK) / 160);
}

export const _test = { FEAR_MIN_RANK, FEAR_MAX_RESIST };
