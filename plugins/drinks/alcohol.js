// How strong the drink you just made actually is.
//
// Alcohol is DERIVED, never authored. A drink template has no opinion about
// whether it contains any — alcoholic and non-alcoholic recipes sit in the same
// catalogue — because the answer is arithmetic over what went in the glass. Tag
// a new bottle with an `abv` and every recipe it fits gets the right strength
// that instant, with no edit here and no per-drink potency to keep in sync.
//
// Pure functions only: no I/O, no world state, no clock. This whole file is
// unit-testable from regress with plain objects, and it is.

import { POUR_ML, STANDARD_UNIT_ML, POTENCY_MIN, POTENCY_MAX } from './config.js';

// The ABV an ingredient declares, as a fraction. Absent reads as zero — a thing
// nobody said was alcoholic isn't.
export function abvOf(row) {
  const bag = row?.tags || row?.flags || {};
  const n = Number(bag.abv);
  return Number.isFinite(n) && n > 0 ? Math.min(100, n) / 100 : 0;
}

// Millilitres of pure ethanol in a build.
export function ethanolMl(build) {
  let ml = 0;
  for (const c of build || []) {
    const pours = Number(c?.pours) || 0;
    const abv = Number(c?.abv) || 0;   // stored as a fraction on the component
    ml += pours * POUR_ML * abv;
  }
  return ml;
}

// Total liquid volume, which is what makes a long drink weaker per mouthful
// than a short one. Nothing special-cases dilution — the mixers and the ice are
// simply volume, and the division does the rest.
export function volumeMl(build) {
  let ml = 0;
  for (const c of build || []) ml += (Number(c?.pours) || 0) * POUR_ML;
  return ml;
}

/**
 * The potency multiplier for a FULL vessel of this build, in standard units.
 * Handed straight to the existing `useDrug(..., { potencyMult })` path, so a
 * mixed drink lands on intoxication exactly the way a bottled one does.
 *
 * Returns 0 for a build with no alcohol in it at all — and 0 means the drink is
 * simply a drink: no drug is applied, nothing is logged, and a cup of tea can
 * never make anyone tipsy through a rounding error.
 */
export function derivePotency(build) {
  const ml = ethanolMl(build);
  if (ml <= 0) return 0;
  const units = ml / STANDARD_UNIT_ML;
  return Math.max(POTENCY_MIN, Math.min(POTENCY_MAX, units));
}

// The strength a single serving lands, given how many servings the full vessel
// holds. Nursing a pint over three mouthfuls is three small doses, not one
// triple — and the three of them sum back to the whole, which regress asserts.
export function servingPotency(potency, capacity) {
  const cap = Number(capacity) > 0 ? Number(capacity) : 1;
  return (Number(potency) || 0) / cap;
}

// Roughly how strong this reads, for the examine line. Deliberately vague: the
// game does not print an ABV at anyone, it tells them what they're holding.
export function strengthLabel(potency) {
  if (!potency) return null;
  if (potency < 0.8) return 'barely there';
  if (potency < 1.5) return 'gentle';
  if (potency < 2.2) return 'stiff';
  return 'a bad idea';
}
