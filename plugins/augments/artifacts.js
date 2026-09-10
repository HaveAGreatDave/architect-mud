/**
 * Print artifacts — what a copy of a copy looks like.
 *
 * Fidelity is a number, and a number on a policy screen is not a consequence.
 * These are the number made visible: as fidelity falls, the body the vats hand
 * back is progressively, legibly wrong, and OTHER PLAYERS CAN SEE IT. A
 * twelve-times-restored Ascendant reads as one on sight, with no stat panel
 * involved and nothing announcing itself.
 *
 * WHY VISIBLE AND NOT JUST MECHANICAL. The calibration cap in state.js is the
 * real cost, but a cap is invisible — a player who never compares numbers never
 * learns it happened. These give the cap a face. They are also the only part of
 * the Ascendant fantasy that argues with it: the faction sells immortality, and
 * the immortal are quietly identifiable as secondhand.
 *
 * ⚠ TONE. Nothing here is body horror and nothing is a joke. The wrongness is
 * SMALL and manufacturing-flavoured — seams, tolerances, a mismatch against a
 * file — because the fiction is a very good factory rather than a curse. Nobody
 * in the world ever remarks on one out loud.
 *
 * Registry, not a switch, for the reason mutation-effects is: an artifact key
 * that nothing renders is a thing an author can write and never see, so the
 * suite asserts every registered key is reachable from a surface.
 */

const registry = new Map();

/**
 * @param key    stable id, kebab-free snake_case
 * @param at     the fidelity you must have fallen BELOW to carry it
 * @param self   second person — read once, at emergence
 * @param other  third person — read on `look <handle>`, forever
 */
export function registerPrintArtifact(key, { at, self, other }) {
  if (registry.has(key)) throw new Error(`[augments] duplicate print artifact "${key}"`);
  if (!Number.isFinite(at) || !self || !other) throw new Error(`[augments] print artifact "${key}" is incomplete`);
  registry.set(key, { key, at, self, other });
}

// Five rungs. The thresholds are strictly descending and the suite checks it —
// two artifacts at the same fidelity would arrive together and read as one
// event, which wastes a rung.
registerPrintArtifact('seam_lines', {
  at: 88,
  self: 'There are faint seams on the inside of your forearms, where one pass of you met the next.',
  other: 'Faint seams run the inside of their forearms, seen only at the wrong angle.',
});
registerPrintArtifact('mismatched_iris', {
  at: 75,
  self: 'Your eyes no longer quite agree on a colour. Nobody at the Vats mentions it.',
  other: "Their eyes don't quite match each other, and neither quite matches the file.",
});
registerPrintArtifact('wrong_hands', {
  at: 60,
  self: 'Your fingerprints have stopped matching the ones on your own record. The Registry has amended the record.',
  other: 'Their hands are subtly the wrong hands — the whorls too clean, too newly cut.',
});
registerPrintArtifact('static_voice', {
  at: 45,
  self: "There's a hiss under your voice now, faint as a room tone, and it's in every recording of you from here on.",
  other: 'A thin static rides under their voice, the way a room tone rides under a recording.',
});
registerPrintArtifact('flinch_delay', {
  at: 35,
  self: 'You arrive at your own reactions a half-beat late, as though relayed.',
  other: 'They flinch a half-beat after the thing that should have made them flinch.',
});

/** Every artifact a body at this fidelity carries. */
export function artifactsFor(fidelity) {
  const f = Number(fidelity ?? 100);
  return [...registry.values()].filter(a => f < a.at).sort((a, b) => b.at - a.at);
}

/** Only the ones newly acquired crossing from `before` down to `after`. */
export function artifactsBetween(before, after) {
  const had = new Set(artifactsFor(before).map(a => a.key));
  return artifactsFor(after).filter(a => !had.has(a.key));
}

/** Exposed for the suite: the whole vocabulary, for the reachability check. */
export function allPrintArtifacts() {
  return [...registry.values()].sort((a, b) => b.at - a.at);
}
