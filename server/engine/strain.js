/**
 * Strain — the seam that lets worn hardware notice it is being worked.
 *
 * `durability.wear()` already answers "the thing you are swinging is being used
 * up". This answers the other half: the machinery INSIDE you is being worked
 * too, and an overclocked actuator gets hot in a fight rather than on a clock.
 *
 * SYNCHRONOUS BY CONTRACT. Every rule here is inherited from `wear()` and every
 * one of them is load-bearing:
 *
 *   1. Never await, never query, never touch the DB. This is called per swing
 *      and per hit from `combat.js`. A contributor that learns to await turns
 *      one round of a fight into a round trip per blow.
 *   2. Contributors are REGISTERED, not imported. Heat belongs to a plugin
 *      (plugins/augments), and the engine must not import a plugin to run its
 *      hot path. This file is the whole of the engine's knowledge of the subject.
 *   3. A throwing contributor is swallowed. A failing implant must not be able
 *      to cancel a sword swing.
 *
 * The durable residue of strain is not stored here and is not stored as strain:
 * heat is a minutes-scale session phenomenon that lives in RAM and cools off on
 * logout, and what survives is the CONDITION it burned. See
 * plugins/augments/overclock.js.
 */

const contributors = new Map();

/**
 * Register a strain observer. `fn(player, event)` is called synchronously on
 * every strain event; `event` is one of the STRAIN_EVENTS keys below.
 */
export function registerStrainContributor(fn, owner = 'unknown') {
  if (typeof fn === 'function') contributors.set(owner, fn);
}

export function getStrainContributors() { return [...contributors.keys()]; }

/**
 * Fire a strain event. Sync, memory-only, safe to call from anywhere including
 * the combat hot path. Returns nothing — callers must never wait on this.
 */
export function strain(player, event) {
  if (!player || !event || !contributors.size) return;
  for (const fn of contributors.values()) {
    try { fn(player, event); } catch { /* a failing implant is not a failed swing */ }
  }
}

// The vocabulary. Kept here rather than in the plugin so the call sites in
// combat/movement read against one list and a typo is visible at the seam.
export const STRAIN_EVENTS = ['swing', 'taken', 'sprint'];
