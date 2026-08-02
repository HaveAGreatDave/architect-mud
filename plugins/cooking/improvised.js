// IMPROVISED DISHES — what a pan full of food becomes when no recipe claims it.
//
// The catalog answers 47 combinations. Everything else used to fall to
// UNKNOWN_DISH: "a mess", capped at `acceptable`, whatever you had actually
// made. That was right when the alternative was enumerating every bad idea, and
// it stayed right for exactly one vessel — bread, where GENERIC_SANDWICH already
// proved the better answer. Put anything sensible between two slices and you
// have made a real thing, and the game should call it what it is.
//
// This generalises that to every vessel. A pot of liquid, meat and turnips with
// no template behind it is not a mess; it is a stew, and specifically it is
// **turnip and rat stew**. The rule that replaces "unmatched ⇒ slop" is:
//
//     FOOD MAKES A DISH. NON-FOOD MAKES A MESS.
//
// So the only route to slop left is putting something with no `food_profile` in
// the pan — motor oil, mutagen, a spanner. That is a genuinely incoherent pot
// and deserves the old answer. Everything made of actual ingredients gets named.
//
// WHY THIS DOESN'T KILL DISCOVERY. An improvised dish is capped BELOW an
// authored one: its ceiling climbs with complexity but stops at `superb`, and
// `masterful` is reachable only through a recipe somebody wrote down. Knowing
// the real thing is still strictly better than inventing near it, which is what
// keeps the cookbook worth filling.
//
// Pure: a signature and a vessel kind in, a template-shaped object out. No DB,
// no clock, no player. Everything here is asserted by regress.
import { PROFILES, QUALITY_BANDS } from './profiles.js';

// How much of a profile is in the pot, ignoring the secondary-identity channel —
// a family is decided by what things ARE, the same rule the matcher's allowed
// check uses. Half a unit is the floor for "there is some of this in here",
// which matches the matcher's own low tolerance.
const PRESENT = 0.5;

function reader(sig) {
  const u = p => Number(sig[p]) || 0;
  return {
    u,
    has: p => u(p) >= PRESENT,
    // Every profile actually present, modifiers excluded — seasoning is not an
    // ingredient, which is the same call `seasoningBonus` makes.
    kinds: Object.keys(sig).filter(k => k !== 'unprofiled' && !PROFILES[k]?.modifier && (Number(sig[k]) || 0) >= PRESENT),
    // Anything in the pan that isn't food at all. The one route to a mess.
    junk: (Number(sig.unprofiled) || 0) > 0 || Object.keys(sig).some(k => k !== 'unprofiled' && !PROFILES[k]),
  };
}

// ── The families ─────────────────────────────────────────────────────────────
//
// Ordered most specific first per vessel; the first `when` that answers true
// wins. Each is a real culinary category rather than a catch-all, which is what
// makes the generated name read like a dish instead of a list of contents.
//
// `lead` is the nameSlots order — the profile whose noun goes in front. This is
// the bit that makes it "beef stew" and "apple pie" rather than "stew (beef,
// turnip, stock)": a dish is named after the thing it is mostly OF.
const V = {
  pot: [
    { noun: 'curry', when: r => r.has('liquid') && r.u('aromatic') >= 2, lead: ['dense_meat', 'soft_vegetable', 'starchy_vegetable', 'dry_starch'] },
    { noun: 'chowder', when: r => r.has('liquid') && r.has('dense_meat') && r.has('dairy'), lead: ['dense_meat', 'soft_vegetable'] },
    { noun: 'stew', when: r => r.has('liquid') && r.has('dense_meat'), lead: ['dense_meat', 'starchy_vegetable', 'soft_vegetable'] },
    { noun: 'porridge', when: r => (r.has('dairy') || r.has('liquid')) && (r.has('dry_starch') || r.has('starchy_vegetable')) && !r.has('dense_meat'), lead: ['dry_starch', 'starchy_vegetable', 'fruit'] },
    { noun: 'soup', when: r => r.has('liquid') && (r.has('soft_vegetable') || r.has('starchy_vegetable') || r.has('preserved') || r.has('egg')), lead: ['soft_vegetable', 'starchy_vegetable', 'preserved'] },
    { noun: 'compote', when: r => r.has('fruit'), lead: ['fruit'] },
    { noun: 'broth', when: r => r.has('liquid'), lead: ['aromatic', 'preserved'] },
    { noun: 'mash', when: r => r.has('starchy_vegetable'), lead: ['starchy_vegetable'] },
    { noun: 'pot', when: () => true, lead: ['dense_meat', 'soft_vegetable', 'starchy_vegetable'] },
  ],
  pan: [
    { noun: 'fry-up', when: r => r.has('egg') && (r.has('dense_meat') || r.has('preserved')), lead: ['dense_meat', 'preserved'] },
    { noun: 'hash', when: r => (r.has('starchy_vegetable') || r.has('dry_starch')) && (r.has('dense_meat') || r.has('preserved')), lead: ['dense_meat', 'starchy_vegetable'] },
    { noun: 'scramble', when: r => r.has('egg'), lead: ['soft_vegetable', 'dairy'] },
    { noun: 'toastie', when: r => r.has('bread') && r.has('dairy'), lead: ['dairy', 'preserved'] },
    { noun: 'sauce', when: r => r.has('liquid') && !r.has('dense_meat'), lead: ['soft_vegetable', 'fruit', 'aromatic'] },
    { noun: 'sear', when: r => r.has('dense_meat') && r.kinds.length === 1, lead: ['dense_meat'] },
    { noun: 'saute', when: r => r.has('soft_vegetable') || r.has('starchy_vegetable'), lead: ['soft_vegetable', 'starchy_vegetable', 'dense_meat'] },
    { noun: 'fry', when: () => true, lead: ['dense_meat', 'preserved', 'fruit'] },
  ],
  tray: [
    { noun: 'pie', when: r => r.has('batter') && (r.has('dense_meat') || r.has('fruit') || r.has('soft_vegetable')), lead: ['fruit', 'dense_meat', 'soft_vegetable'] },
    { noun: 'bake', when: r => r.has('batter') || r.has('bread'), lead: ['fruit', 'dairy', 'dense_meat'] },
    { noun: 'gratin', when: r => r.has('dairy') && (r.has('starchy_vegetable') || r.has('soft_vegetable')), lead: ['starchy_vegetable', 'soft_vegetable'] },
    { noun: 'roast', when: r => r.has('dense_meat'), lead: ['dense_meat', 'starchy_vegetable'] },
    { noun: 'tray bake', when: () => true, lead: ['soft_vegetable', 'starchy_vegetable', 'preserved'] },
  ],
  bowl: [
    { noun: 'mash', when: r => r.has('starchy_vegetable'), lead: ['starchy_vegetable'] },
    { noun: 'fruit salad', when: r => r.has('fruit') && !r.has('dense_meat') && !r.has('soft_vegetable'), lead: ['fruit'] },
    { noun: 'salad', when: r => r.has('soft_vegetable') || r.has('fruit'), lead: ['soft_vegetable', 'fruit', 'preserved'] },
    { noun: 'dip', when: r => r.has('dairy') || r.has('fat_or_oil'), lead: ['dairy', 'aromatic'] },
    { noun: 'bowl', when: () => true, lead: ['dense_meat', 'preserved', 'egg'] },
  ],
  // A bare stove — no vessel at all. You can still cook on one, and what comes
  // off it is not a mess either.
  none: [
    { noun: 'grill', when: r => r.has('dense_meat'), lead: ['dense_meat'] },
    { noun: 'fry', when: () => true, lead: ['soft_vegetable', 'starchy_vegetable', 'preserved', 'egg'] },
  ],
};

// ── Complexity, and what it buys ─────────────────────────────────────────────
//
// The ceiling climbs with how many DIFFERENT things you balanced, not how much
// you piled in — five potatoes is not a more accomplished dish than a potato,
// but potato-meat-stock-greens-cream is. Modifiers don't count: seasoning is
// already paid for separately and counting it twice would make "add every
// aromatic" the way to raise your own ceiling.
//
// It stops at `superb`. `masterful` belongs to recipes somebody wrote down.
const CEILINGS = ['acceptable', 'decent', 'good', 'very good', 'excellent', 'superb'];
export const IMPROVISED_MAX = 'superb';

export function complexityOf(sig) {
  return reader(sig).kinds.length;
}

export function improvisedCeiling(complexity) {
  return CEILINGS[Math.max(0, Math.min(CEILINGS.length - 1, complexity))];
}

// Flat Cooking IP for turning out something improvised and good. Scales with the
// same complexity, and stays below what DISCOVERY_IP pays for writing down a
// real recipe — inventing is worth something; learning the real thing is worth
// more.
export function improvisedIp(complexity, band) {
  if (QUALITY_BANDS.indexOf(band) < QUALITY_BANDS.indexOf('good')) return 0;
  return Math.max(0, Math.min(4, complexity - 1));
}

// ── The generator ────────────────────────────────────────────────────────────
//
// Returns a template-shaped object `plate` can use exactly like a catalog entry,
// or null when the pan holds something that isn't food. It deliberately carries
// no `key`, so making one never writes to the cookbook — the authored catalog is
// what the cookbook is FOR. Improvised dishes are saved by the player instead,
// under whatever name they choose (see knowledge.js `savedRecipes`).
export function inferDish(sig, vesselKind = null) {
  const r = reader(sig);
  if (r.junk) return null;          // non-food in the pan. That really is a mess.
  if (!r.kinds.length) return null; // nothing but seasoning is not a dish.

  const family = (V[vesselKind || 'none'] || V.none).find(f => f.when(r));
  if (!family) return null;

  const complexity = r.kinds.length;
  return {
    noun: family.noun,
    vessel: vesselKind || null,
    needs: {},
    optional: [],
    nameSlots: family.lead,
    ceiling: improvisedCeiling(complexity),
    // Harder the more you're juggling, which is what makes a complicated
    // improvisation a genuine risk rather than a free ceiling raise.
    difficulty: Math.min(10, 3 + complexity),
    blurb: 'Something you worked out yourself.',
    improvised: true,
    family: family.noun,
    complexity,
  };
}

// The stable identity of an improvised dish: the multiset of profiles that made
// it, rounded to whole units, plus the vessel. Two pots of "meat, stock and two
// turnips" produce the same signature key however different the actual animals
// were — which is what lets a player SAVE one and have the save mean something
// the next time they cook it.
//
// Rounded on purpose. Exact unit counts are floats off ingredient masses, and a
// 380g cut versus a 400g one is not a different recipe.
export function recipeSignature(sig, vesselKind = null) {
  const parts = Object.keys(sig)
    // Modifiers are excluded for the same reason they don't count toward
    // complexity: seasoning is not an ingredient. A stew you salted and one you
    // didn't are the same recipe, and a saved one has to match both.
    .filter(k => k !== 'unprofiled' && PROFILES[k] && !PROFILES[k].modifier && (Number(sig[k]) || 0) >= PRESENT)
    .sort()
    .map(k => `${k}:${Math.max(1, Math.round(Number(sig[k])))}`);
  return `${vesselKind || 'none'}|${parts.join(',')}`;
}
