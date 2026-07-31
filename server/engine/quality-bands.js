/**
 * The quality ladder — the vocabulary a crafted consumable's grade is expressed in.
 *
 * This lives in the engine rather than in a plugin because THREE unrelated
 * systems now read it to make decisions: the cooking plugin composes into it,
 * the drinks plugin composes into it, and `applyItemUse` in
 * commands/inventory.js spends it (COOK_QUALITY_MULT scales restores by band).
 * A value multiple unrelated systems read to decide something is a substrate by
 * the boundary doc's first litmus test, so it stops being cooking's private
 * business the moment anything else grades anything.
 *
 * plugins/cooking/profiles.js re-exports these unchanged, so every existing
 * import keeps working and nothing needed rewriting to move them here.
 *
 * This was five bands and is now nine. The five ORIGINAL names are kept and sit
 * at exactly TWICE their old index — poor 0→0, acceptable 1→2, good 2→4,
 * excellent 3→6, masterful 4→8 — so every band already stamped on a plated meal,
 * written into a cookbook, or named as a profile's `targets` ceiling still means
 * precisely what it meant. Nothing needed migrating; the scale just got a
 * halfway house between each pair of rungs.
 *
 * Because the span doubled (4 → 8), every scoring constant expressed in BANDS
 * doubles with it — see BAND_SCALE in plugins/cooking/config.js. That keeps the
 * difficulty curve identical and makes this a change to RESOLUTION, not balance.
 */
export const QUALITY_BANDS = [
  'poor',        // 0
  'grim',        // 1
  'acceptable',  // 2   the baseline: exactly 1.0x restores
  'decent',      // 3
  'good',        // 4
  'very good',   // 5
  'excellent',   // 6
  'superb',      // 7
  'masterful',   // 8
];

// What the scale used to be, and where each rung landed. Asserted by regress:
// if a future edit moves one of these, every stamped meal in the database
// silently changes meaning.
export const LEGACY_BAND_INDEX = { poor: 0, acceptable: 2, good: 4, excellent: 6, masterful: 8 };

export const bandIndex = band => {
  const i = QUALITY_BANDS.indexOf(band);
  return i < 0 ? 0 : i;
};
