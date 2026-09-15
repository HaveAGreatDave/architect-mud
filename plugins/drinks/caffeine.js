// How awake the drink you just made will actually make you.
//
// The sibling of alcohol.js, and built the same way: caffeine is DERIVED from
// what went in the cup, never authored per recipe, so a new caffeinated
// ingredient works in every drink its profile fits with no edit here.
//
// THE DIFFERENCE FROM ALCOHOL, and the reason this file exists at all: booze is
// authored per BOTTLE (`abv`) because a spirit's strength is a fact about that
// bottle, while caffeine is a fact about the CLASS — coffee is coffee. So the
// number lives on the profile and an item overrides it only when it disagrees,
// which is exactly the case that matters: chicory sits in `coffee_base` and has
// no caffeine in it at all, herbal tea sits in `tea_base` and has none either,
// and a cola is caffeinated while every other mixer on the shelf is not. A
// profile-only rule gets all three wrong.
//
// The override is also what lets a machine answer. A rig pulling its own cup has
// no ingredients to read — see drinks.serveVended — so it asks the RECIPE what
// it is made of, which only the profile table can answer.
//
// Pure functions only: no I/O, no world state, no clock.

// Milligrams of caffeine in one pour (25ml) of each class. Absent = none, which
// is every other profile in the game: a thing nobody said was caffeinated isn't.
export const CAFFEINE_MG_PER_POUR = {
  coffee_base: 80,
  tea_base: 40,
};

// A strong cup's worth — the dose that reads as potency 1.0, the way a standard
// unit does for ethanol.
export const CUP_MG = 80;

// Below this, nothing is applied at all. ⚠ LOAD-BEARING: useDrug clamps
// potencyMult UP to 0.1 and still counts a whole dose against the overdose
// threshold, so without a floor a mug of cocoa would be a dose of caffeine and
// ten of them would be an overdose. Same law as alcohol's "potency 0 applies no
// drug" — a drink can never dose you through a rounding error.
export const MIN_MG = 20;

/**
 * The caffeine one pour of this ingredient carries. An item may declare
 * `tags.caffeine_mg` to override its profile, in EITHER direction — 0 for the
 * decaf things sitting in a caffeinated class, a real number for the
 * caffeinated things sitting in an ordinary one.
 */
export function caffeineMgOf(row, profile = null) {
  const bag = row?.tags || row?.flags || {};
  const authored = bag.caffeine_mg == null ? null : Number(bag.caffeine_mg);
  if (Number.isFinite(authored)) return Math.max(0, authored);
  const p = profile || bag.drink_profile;
  return CAFFEINE_MG_PER_POUR[p] || 0;
}

// Total milligrams in a build. The component rows carry their own `caffeine_mg`,
// stamped when the ingredient went in, for the same reason they carry `abv`: the
// build has to survive without re-reading items that may since have changed.
export function caffeineMg(build) {
  let mg = 0;
  for (const c of build || []) {
    const pours = Number(c?.pours) || 0;
    // ⚠ `== null` rather than a finite check: Number(null) is 0 AND finite, so
    // a component carrying an explicit null would read as "authored as decaf"
    // and quietly take the caffeine out of a real coffee. Unstated falls back
    // to the profile; a real 0 (chicory) still wins.
    const per = c?.caffeine_mg == null ? null : Number(c.caffeine_mg);
    mg += pours * (Number.isFinite(per) ? per : (CAFFEINE_MG_PER_POUR[c?.profile] || 0));
  }
  return mg;
}

/**
 * The potency multiplier for a FULL vessel, handed straight to the existing
 * `useDrug(..., { potencyMult })` path so a brewed coffee lands on the caffeine
 * arc exactly the way the bought tin of it does.
 *
 * Returns 0 for anything under MIN_MG, and 0 means no drug is applied at all.
 */
export function deriveCaffeine(build) {
  const mg = caffeineMg(build);
  if (mg < MIN_MG) return 0;
  return Math.min(3, mg / CUP_MG);
}

/**
 * What a machine puts in the cup. A rig has no ingredients, so the recipe is the
 * only thing that can say — read at the LOW end of each range, because that is
 * the least the recipe can be made with and a machine should not be more
 * generous than the book.
 */
export function caffeineFromTemplate(template) {
  let mg = 0;
  for (const [profile, need] of Object.entries(template?.needs || {})) {
    const per = CAFFEINE_MG_PER_POUR[profile];
    if (!per) continue;
    const lo = Array.isArray(need) ? need[0] : need;
    mg += (Number(lo) || 0) * per;
  }
  if (mg < MIN_MG) return 0;
  return Math.min(3, mg / CUP_MG);
}

// The strength a single serving lands. Nursing a mug over two mouthfuls is two
// halves, and they sum back to the whole — the identical split alcohol makes.
export function servingCaffeine(caffeine, capacity) {
  const cap = Number(capacity) > 0 ? Number(capacity) : 1;
  return (Number(caffeine) || 0) / cap;
}

// How it reads on examine. Vague on purpose, like strengthLabel: the game does
// not print milligrams at anyone.
export function kickLabel(caffeine) {
  if (!caffeine) return null;
  if (caffeine < 0.6) return 'a bit of a lift in it';
  if (caffeine < 1.4) return 'enough to open your eyes';
  if (caffeine < 2.2) return 'more than one cup has any business holding';
  return 'a genuinely unwise amount of coffee';
}
