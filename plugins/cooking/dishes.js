// Dishes — what a vessel full of cooked ingredients resolves INTO.
//
// The one rule that makes this affordable: a dish template matches on the
// multiset of food PROFILES in the vessel, never on item ids. "One liquid, one
// dense meat, one-to-three starchy vegetables, in a pot" is a stew — whether
// that meat is a steak or a sturgeon, and whether that starch is a potato or a
// root you haven't written yet. Tag a new ingredient with an existing profile
// and every dish its profile fits accepts it that instant, with no edit here.
//
// This is plugin-local balance data, same choice as profiles.js and config.js:
// it describes how CLASSES of food combine, not any individual world item, so
// it isn't content and doesn't want a table.
//
// Nothing is gated. Any combination cooks; combinations no template claims
// resolve to UNKNOWN_DISH at a capped band. That's deliberate — it's the
// failure mode that teaches the system, and it means the catalog never has to
// enumerate the bad combinations.

import { PROFILES, QUALITY_BANDS, bandIndex, instanceNoun } from './profiles.js';
import { WORST_PULL, SLOP_CEILING, KNOWN_RECIPE_BONUS, MODIFIER_BONUS, MODIFIER_BONUS_CAP, OVER_SEASON_PENALTY, DEFAULT_SEASONING } from './config.js';

// Vessel kinds, read from the vessel's `tags.vessel_kind`. A vessel that
// declares none is 'any' and can host any template that doesn't demand one.
export const VESSEL_KINDS = ['pan', 'pot', 'tray'];

// A template's `needs` maps a profile name to a count: either an exact number
// or a [min, max] range. `optional` lists profiles that may be present without
// breaking the match but are not required — this is how fat and aromatics ride
// along on anything. Any profile in the vessel that is neither needed nor
// optional makes the match fail (you cannot smuggle a pancake into a stew).
//
// `nameSlots` are the profiles that contribute a noun to the derived name, in
// order, capped at two: {nouns} + {noun}. "meat and potato stew".
export const DISHES = {
  // ── Pot: things that get wet ───────────────────────────────────────────────
  stew: {
    noun: 'stew', vessel: 'pot',
    needs: { liquid: 1, dense_meat: [1, 2], starchy_vegetable: [1, 3] },
    optional: ['soft_vegetable', 'aromatic', 'fat_or_oil'],
    nameSlots: ['dense_meat', 'starchy_vegetable'],
    ceiling: 'masterful', difficulty: 8,
    blurb: 'Meat and starch given hours in liquid until neither argues.',
  },
  chowder: {
    noun: 'chowder', vessel: 'pot',
    needs: { liquid: 1, dense_meat: [1, 2], soft_vegetable: [1, 2] },
    optional: ['fat_or_oil', 'aromatic'],
    nameSlots: ['dense_meat', 'soft_vegetable'],
    ceiling: 'masterful', difficulty: 7,
    blurb: 'Thick, pale, and far better than the sum of what went in.',
  },
  soup: {
    noun: 'soup', vessel: 'pot',
    needs: { liquid: 1, soft_vegetable: [1, 3] },
    optional: ['starchy_vegetable', 'aromatic'],
    nameSlots: ['soft_vegetable'],
    ceiling: 'excellent', difficulty: 5,
    blurb: 'Vegetables, liquid, patience. The first thing anyone learns.',
  },
  // Two curries, deliberately. Folding meat in as an *optional* would let a
  // meat-and-aromatic pot tie with chowder at equal specificity; requiring it in
  // its own template makes the meat case strictly more specific, so the match
  // stays deterministic without weighting the scorer.
  curry: {
    noun: 'curry', vessel: 'pot',
    needs: { liquid: 1, soft_vegetable: [1, 2], aromatic: [2, 3] },
    optional: ['starchy_vegetable', 'fat_or_oil'],
    nameSlots: ['soft_vegetable'],
    ceiling: 'excellent', difficulty: 8,
    blurb: 'Enough spice to stop being seasoning and start being the point.',
  },
  meat_curry: {
    noun: 'curry', vessel: 'pot',
    needs: { liquid: 1, dense_meat: [1, 2], soft_vegetable: [1, 2], aromatic: [2, 3] },
    optional: ['starchy_vegetable', 'fat_or_oil'],
    nameSlots: ['dense_meat', 'soft_vegetable'],
    ceiling: 'masterful', difficulty: 9,
    blurb: 'The long version: meat given time to surrender to the spice.',
  },
  broth: {
    noun: 'broth', vessel: 'pot',
    needs: { liquid: 1, aromatic: [1, 2] },
    optional: ['fat_or_oil'],
    nameSlots: ['aromatic'],
    ceiling: 'good', difficulty: 3,
    blurb: 'Hot, salted, and honest about being mostly water.',
  },
  stock: {
    noun: 'stock', vessel: 'pot',
    needs: { dense_meat: [1, 2], liquid: [1, 2] },
    optional: ['aromatic'],
    nameSlots: ['dense_meat'],
    ceiling: 'excellent', difficulty: 5,
    blurb: 'Bones and time. Not a meal — the thing that makes meals.',
  },
  mash: {
    noun: 'mash', vessel: 'pot',
    needs: { starchy_vegetable: [2, 3], liquid: 1 },
    optional: ['fat_or_oil', 'aromatic'],
    nameSlots: ['starchy_vegetable'],
    ceiling: 'excellent', difficulty: 4,
    blurb: 'Boiled soft and beaten smooth. Fat is not optional, whatever the tag says.',
  },
  porridge: {
    noun: 'porridge', vessel: 'pot',
    needs: { starchy_vegetable: 1, liquid: [1, 2] },
    optional: ['aromatic', 'fat_or_oil'],
    nameSlots: ['starchy_vegetable'],
    ceiling: 'good', difficulty: 3,
    blurb: 'Grain and liquid at a low simmer. Grim, warm, keeps you upright.',
  },

  // ── Pan: things that get hot and loud ──────────────────────────────────────
  seared_cut: {
    noun: 'sear', vessel: 'pan',
    needs: { dense_meat: 1, fat_or_oil: 1 },
    optional: ['aromatic'],
    nameSlots: ['dense_meat'],
    ceiling: 'masterful', difficulty: 6,
    blurb: 'Hot fat, one cut, one turn. Nowhere to hide.',
  },
  cutlet: {
    noun: 'cutlet', vessel: 'pan',
    needs: { dense_meat: 1, batter: 1, fat_or_oil: 1 },
    optional: ['aromatic'],
    nameSlots: ['batter', 'dense_meat'],
    ceiling: 'masterful', difficulty: 7,
    blurb: 'Coated, fried, and golden enough to lie about what it covers.',
  },
  hash: {
    noun: 'hash', vessel: 'pan',
    needs: { starchy_vegetable: [1, 2], soft_vegetable: [1, 2], fat_or_oil: 1 },
    optional: ['dense_meat', 'aromatic'],
    nameSlots: ['starchy_vegetable', 'soft_vegetable'],
    ceiling: 'excellent', difficulty: 5,
    blurb: 'Everything diced, everything in, pressed down and left to crust.',
  },
  saute: {
    noun: 'saute', vessel: 'pan',
    needs: { soft_vegetable: [2, 3], fat_or_oil: 1 },
    optional: [],
    nameSlots: ['soft_vegetable'],
    ceiling: 'good', difficulty: 4,
    blurb: 'Quick heat, constant motion, nothing allowed to sit still.',
  },
  scorched_greens: {
    noun: 'scorch', vessel: 'pan',
    needs: { soft_vegetable: [1, 2], aromatic: [1, 2], fat_or_oil: 1 },
    optional: [],
    nameSlots: ['soft_vegetable', 'aromatic'],
    ceiling: 'excellent', difficulty: 6,
    blurb: 'Taken deliberately past brown. A hair further and it is bin food.',
  },
  glazed_root: {
    noun: 'glaze', vessel: 'pan',
    needs: { starchy_vegetable: [1, 2], fat_or_oil: 1, aromatic: 1 },
    optional: [],
    nameSlots: ['starchy_vegetable'],
    ceiling: 'excellent', difficulty: 6,
    blurb: 'Root, fat, and seasoning cooked down until it shines.',
  },
  stack: {
    noun: 'stack', vessel: 'pan',
    needs: { batter: [1, 3], fat_or_oil: 1 },
    optional: ['aromatic'],
    nameSlots: ['batter'],
    ceiling: 'excellent', difficulty: 5,
    blurb: 'Poured, bubbled, flipped once. Breakfast in any century.',
  },

  // ── Tray: things that go in and are left alone ─────────────────────────────
  roast: {
    noun: 'roast', vessel: 'tray',
    needs: { dense_meat: [1, 2], starchy_vegetable: [1, 3] },
    optional: ['soft_vegetable', 'fat_or_oil', 'aromatic'],
    nameSlots: ['dense_meat', 'starchy_vegetable'],
    ceiling: 'masterful', difficulty: 7,
    blurb: 'The whole meal on one tray, cooked in its own dripping.',
  },
  baked_whole: {
    noun: 'bake', vessel: 'tray',
    needs: { dense_meat: [1, 2], aromatic: [1, 2] },
    optional: ['fat_or_oil'],
    nameSlots: ['dense_meat'],
    ceiling: 'masterful', difficulty: 6,
    blurb: 'Seasoned, laid out whole, and left to the heat.',
  },
  tray_veg: {
    noun: 'tray', vessel: 'tray',
    needs: { starchy_vegetable: [1, 2], soft_vegetable: [1, 2], fat_or_oil: 1 },
    optional: ['aromatic'],
    nameSlots: ['starchy_vegetable', 'soft_vegetable'],
    ceiling: 'excellent', difficulty: 4,
    blurb: 'Oiled, spread out, and turned once halfway if you remember.',
  },
  gratin: {
    noun: 'gratin', vessel: 'tray',
    needs: { starchy_vegetable: [1, 3], liquid: 1 },
    optional: ['fat_or_oil', 'aromatic', 'soft_vegetable'],
    nameSlots: ['starchy_vegetable'],
    ceiling: 'excellent', difficulty: 6,
    blurb: 'Layered, drowned, and baked until the top goes brown and tight.',
  },
  pie: {
    noun: 'pie', vessel: 'tray',
    needs: { batter: 1, dense_meat: [1, 2] },
    optional: ['soft_vegetable', 'starchy_vegetable', 'fat_or_oil', 'aromatic'],
    nameSlots: ['dense_meat'],
    ceiling: 'masterful', difficulty: 8,
    blurb: 'A lid of pastry over something that was recently a stew.',
  },
  loaf: {
    noun: 'loaf', vessel: 'tray',
    needs: { batter: [1, 2] },
    optional: ['fat_or_oil', 'aromatic', 'soft_vegetable'],
    nameSlots: ['batter'],
    ceiling: 'excellent', difficulty: 5,
    blurb: 'Proved, slashed, and baked. The smell alone is worth the flour.',
  },

  // ── Egg, fruit and preserved: the second half of the book ─────────────────
  omelette: {
    noun: 'omelette', vessel: 'pan',
    needs: { egg: [2, 3], fat_or_oil: 1 },
    optional: ['soft_vegetable', 'aromatic', 'preserved'],
    nameSlots: ['soft_vegetable'],
    ceiling: 'masterful', difficulty: 7,
    blurb: 'Low heat, fast hands, folded before it thinks about browning.',
  },
  scramble: {
    noun: 'scramble', vessel: 'pan',
    needs: { egg: 1, fat_or_oil: 1, liquid: 1 },
    optional: ['aromatic'],
    nameSlots: [],
    ceiling: 'excellent', difficulty: 6,
    blurb: 'Loosened with something wet and pulled off the heat too early on purpose.',
  },
  spiced_eggs: {
    noun: 'spiced eggs', vessel: 'pan',
    needs: { egg: [1, 2], aromatic: [2, 3], fat_or_oil: 1 },
    optional: [],
    nameSlots: [],
    ceiling: 'masterful', difficulty: 8,
    blurb: 'Enough spice that the eggs are the medium, not the message.',
  },
  french_toast: {
    noun: 'fried bread', vessel: 'pan',
    needs: { batter: 1, egg: 1, fat_or_oil: 1 },
    optional: ['fruit', 'aromatic'],
    nameSlots: ['batter'],
    ceiling: 'excellent', difficulty: 5,
    blurb: 'Soaked, fried, and better than either half deserved.',
  },
  mixed_fry: {
    noun: 'fry', vessel: 'pan',
    needs: { preserved: [1, 2], egg: [1, 2], fat_or_oil: 1 },
    optional: ['starchy_vegetable', 'aromatic'],
    nameSlots: ['preserved'],
    ceiling: 'excellent', difficulty: 5,
    blurb: 'Everything salted and everything fried, in one pan, at speed.',
  },
  crisped_strips: {
    noun: 'crisp', vessel: 'pan',
    needs: { preserved: [1, 2], fat_or_oil: 1 },
    optional: ['aromatic'],
    nameSlots: ['preserved'],
    ceiling: 'good', difficulty: 3,
    blurb: 'Salt meat taken to the edge of burnt, which is where it wants to be.',
  },
  caramelised_fruit: {
    noun: 'caramel', vessel: 'pan',
    needs: { fruit: [1, 3], fat_or_oil: 1 },
    optional: ['aromatic'],
    nameSlots: ['fruit'],
    ceiling: 'excellent', difficulty: 6,
    blurb: 'Sugar, fat, and about nine seconds between perfect and ruined.',
  },
  glazed_preserved: {
    noun: 'glazed cut', vessel: 'pan',
    needs: { preserved: [1, 2], fruit: [1, 2], fat_or_oil: 1 },
    optional: ['aromatic'],
    nameSlots: ['preserved', 'fruit'],
    ceiling: 'masterful', difficulty: 7,
    blurb: 'Salt against sweet, cooked down until they stop being two things.',
  },

  compote: {
    noun: 'compote', vessel: 'pot',
    needs: { fruit: [2, 3], liquid: 1 },
    optional: [],
    nameSlots: ['fruit'],
    ceiling: 'excellent', difficulty: 4,
    blurb: 'Fruit cooked down to something that keeps, and spreads, and consoles.',
  },
  marmalade: {
    noun: 'marmalade', vessel: 'pot',
    needs: { fruit: [1, 3], liquid: 1, aromatic: [1, 2] },
    optional: [],
    nameSlots: ['fruit'],
    ceiling: 'masterful', difficulty: 8,
    blurb: 'Bitter peel, long heat, and a set you either hit or you do not.',
  },
  egg_drop: {
    noun: 'egg soup', vessel: 'pot',
    needs: { liquid: 1, egg: [1, 2] },
    optional: ['aromatic', 'soft_vegetable'],
    nameSlots: [],
    ceiling: 'excellent', difficulty: 5,
    blurb: 'Beaten egg poured into moving stock, where it turns to ribbons.',
  },
  brined_pot: {
    noun: 'brine pot', vessel: 'pot',
    needs: { preserved: [1, 3], liquid: 1 },
    optional: ['aromatic'],
    nameSlots: ['preserved'],
    ceiling: 'good', difficulty: 3,
    blurb: 'Salt cuts loosened in hot liquid until they remember being food.',
  },
  bone_soup: {
    noun: 'salt broth', vessel: 'pot',
    needs: { liquid: [1, 2], preserved: 1, aromatic: [1, 2] },
    optional: [],
    nameSlots: ['preserved'],
    ceiling: 'excellent', difficulty: 5,
    blurb: 'Thin, salty, and the only warm thing for a long way in any direction.',
  },
  bean_stew: {
    noun: 'pulse stew', vessel: 'pot',
    needs: { starchy_vegetable: [2, 3], liquid: 1, preserved: [1, 2] },
    optional: ['aromatic', 'soft_vegetable'],
    nameSlots: ['starchy_vegetable', 'preserved'],
    ceiling: 'excellent', difficulty: 6,
    blurb: 'Cheap, slow, filling, and the reason anyone got through last winter.',
  },

  fruit_tart: {
    noun: 'tart', vessel: 'tray',
    needs: { batter: 1, fruit: [1, 3] },
    optional: ['fat_or_oil', 'aromatic'],
    nameSlots: ['fruit'],
    ceiling: 'excellent', difficulty: 6,
    blurb: 'Pastry, fruit, heat. Three things that have never needed a fourth.',
  },
  crumble: {
    noun: 'crumble', vessel: 'tray',
    needs: { batter: 1, fruit: [2, 3], fat_or_oil: 1 },
    optional: ['aromatic'],
    nameSlots: ['fruit'],
    ceiling: 'masterful', difficulty: 6,
    blurb: 'Rubbed topping over collapsing fruit. Nobody has ever left any.',
  },
  quiche: {
    noun: 'quiche', vessel: 'tray',
    needs: { batter: 1, egg: [1, 2] },
    optional: ['soft_vegetable', 'preserved', 'fat_or_oil', 'aromatic'],
    nameSlots: ['preserved', 'soft_vegetable'],
    ceiling: 'excellent', difficulty: 6,
    blurb: 'A pastry case carrying set egg and whatever else needed using up.',
  },
  baked_pudding: {
    noun: 'pudding', vessel: 'tray',
    needs: { batter: 1, egg: 1, liquid: 1 },
    optional: ['fruit', 'aromatic', 'fat_or_oil'],
    nameSlots: ['fruit'],
    ceiling: 'masterful', difficulty: 7,
    blurb: 'Set slow in a low oven until it barely holds its own shape.',
  },
  frittata: {
    noun: 'frittata', vessel: 'tray',
    needs: { egg: [2, 3], soft_vegetable: [1, 2] },
    optional: ['fat_or_oil', 'aromatic', 'preserved'],
    nameSlots: ['soft_vegetable'],
    ceiling: 'excellent', difficulty: 5,
    blurb: 'Poured over the vegetables and baked flat. Good cold, which matters.',
  },
  salt_gratin: {
    noun: 'salt gratin', vessel: 'tray',
    needs: { preserved: [1, 2], starchy_vegetable: [1, 3], liquid: 1 },
    optional: ['fat_or_oil', 'aromatic'],
    nameSlots: ['preserved', 'starchy_vegetable'],
    ceiling: 'excellent', difficulty: 7,
    blurb: 'Layered with salt cuts and drowned, then baked until the top tightens.',
  },
  fruited_roast: {
    noun: 'roast', vessel: 'tray',
    needs: { dense_meat: [1, 2], fruit: [1, 2] },
    optional: ['fat_or_oil', 'aromatic'],
    nameSlots: ['dense_meat', 'fruit'],
    ceiling: 'masterful', difficulty: 7,
    blurb: 'Meat cooked under fruit until the fruit gives up and becomes sauce.',
  },
  // ── Named dishes ──────────────────────────────────────────────────────────
  // The only three templates that name an ingredient. Everything else in this
  // catalog is class-matched and always will be; these exist because a real
  // dish is defined by a specific thing in it, and "any meat with a lot of
  // spice on a tray" is not jerk chicken. `keyItems` is the anchor and
  // `nameFormat` keeps the name reading as the dish rather than as its parts.
  jerk_chicken: {
    noun: 'jerk', vessel: 'tray',
    keyItems: ['item_jerk_paste'],
    needs: { dense_meat: [1, 2], aromatic: [1, 3] },
    optional: ['starchy_vegetable', 'soft_vegetable', 'fat_or_oil', 'fruit'],
    nameSlots: ['dense_meat'],
    nameFormat: 'jerk {0}',
    seasoning: 2,
    ceiling: 'masterful', difficulty: 8,
    blurb: 'Scored to the bone, packed with paste, and left in the heat until the skin goes black and lacquered.',
  },
  okonomiyaki: {
    noun: 'okonomiyaki', vessel: 'pan',
    keyItems: ['item_pale_cabbage'],
    needs: { batter: 1, soft_vegetable: [1, 2], egg: [1, 2] },
    optional: ['preserved', 'fat_or_oil', 'aromatic', 'dense_meat'],
    nameSlots: [],
    nameFormat: 'okonomiyaki',
    // Sauce, bonito, and whatever else goes on top — a dish that is largely garnish.
    seasoning: 3,
    ceiling: 'masterful', difficulty: 7,
    blurb: 'Cabbage and batter bound with egg, pressed flat, turned once, and finished in a lattice of sauce.',
  },
  ramen: {
    noun: 'ramen', vessel: 'pot',
    keyItems: ['item_ramen_noodles'],
    needs: { liquid: [1, 2], starchy_vegetable: [1, 2] },
    optional: ['dense_meat', 'egg', 'soft_vegetable', 'preserved', 'aromatic', 'fat_or_oil'],
    nameSlots: ['dense_meat'],
    nameFormat: '{0} ramen',
    seasoning: 2,
    ceiling: 'masterful', difficulty: 8,
    blurb: 'Stock held at a whisper, noodles in for three minutes, everything else arranged on top like it matters. It does.',
  },

  preserved_loaf: {
    noun: 'terrine', vessel: 'tray',
    needs: { batter: [1, 2], preserved: [1, 2] },
    optional: ['fat_or_oil', 'aromatic'],
    nameSlots: ['preserved'],
    ceiling: 'excellent', difficulty: 5,
    blurb: 'Salt meat pressed into dough and baked into something sliceable.',
  },
};

export const UNKNOWN_DISH = {
  noun: 'mess',
  vessel: null,
  needs: {},
  optional: [],
  nameSlots: [],
  ceiling: SLOP_CEILING,
  difficulty: 3,
  blurb: 'Edible. That is the whole of the praise available.',
};

// ---------------------------------------------------------------------------
// Signature
// ---------------------------------------------------------------------------

// The multiset of profiles in a vessel, as { profileName: count }. Rows whose
// profile is missing or unknown are counted under `null` and will fail every
// template — an unprofiled ingredient in a vessel means slop, which is the
// honest answer until somebody tags it.
export function signature(rows, profileNameOf) {
  const sig = {};
  for (const r of rows) {
    const name = profileNameOf(r);
    const key = name && PROFILES[name] ? name : 'unprofiled';
    sig[key] = (sig[key] || 0) + 1;
  }
  return sig;
}

const range = need => (Array.isArray(need) ? need : [need, need]);

// A named dish outranks EVERY class-matched one, unconditionally. This is a
// floor rather than a per-key weight because a weight only wins when the counts
// happen to fall your way — a pot holding ramen noodles, broth and two cuts of
// meat tied `stew` against `ramen` at 4 apiece. If you put ramen noodles in it,
// it is ramen. Keyed dishes then tie-break among themselves on key count.
export const KEY_DISH_FLOOR = 100;

// Does this signature satisfy this template? Returns the specificity (how many
// required items the template accounts for) on a match, or -1 on no match.
// Specificity is the tiebreak when several templates match the same vessel:
// the one demanding the most wins, so a stew beats a soup that ignores meat.
//
// `itemIds` is the set of item ids actually in the vessel, and only NAMED dishes
// look at it. Class matching is still the rule — 44 of the 47 templates never
// name an ingredient — but a real-world dish is defined by a specific thing in
// it. Ramen without ramen noodles is soup; jerk without jerk paste is a roast.
// `keyItems` is that anchor, and every id listed must be present.
export function matchScore(sig, template, itemIds = new Set()) {
  if (template.keyItems?.length) {
    for (const id of template.keyItems) if (!itemIds.has(id)) return -1;
  }
  let required = template.keyItems?.length ? KEY_DISH_FLOOR + template.keyItems.length : 0;
  for (const [profile, need] of Object.entries(template.needs)) {
    const [min, max] = range(need);
    const have = sig[profile] || 0;
    if (have < min || have > max) return -1;
    required += have;
  }
  const allowed = new Set([...Object.keys(template.needs), ...(template.optional || [])]);
  for (const profile of Object.keys(sig)) {
    if (!allowed.has(profile)) return -1;
  }
  return required;
}

// The best template for a vessel's contents, or null for slop. `vesselKind` is
// the vessel's tags.vessel_kind; a template naming a kind requires it, a
// template with vessel:null accepts any.
export function matchDish(sig, vesselKind = null, itemIds = new Set()) {
  const ids = itemIds instanceof Set ? itemIds : new Set(itemIds || []);
  let best = null, bestScore = -1, bestKey = null;
  for (const [key, t] of Object.entries(DISHES)) {
    if (t.vessel && vesselKind && t.vessel !== vesselKind) continue;
    if (t.vessel && !vesselKind) continue; // a bare stove is not a pot
    const score = matchScore(sig, t, ids);
    if (score > bestScore) { best = t; bestScore = score; bestKey = key; }
  }
  return best ? { key: bestKey, template: best, specificity: bestScore } : null;
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

// The noun an ingredient lends to a dish name. An item may declare
// `tags.food_noun` ("beef", "root"); otherwise we take its name and strip the
// state words that stop being true the moment it's cooked.
const STATE_WORDS = /\b(raw|fresh|frozen|dried)\b\s*/gi;

export function nounFor(row, tagValue) {
  // Per-instance first: butchered meat carries the creature it came off.
  const perInstance = instanceNoun(row);
  if (perInstance) return perInstance.toLowerCase();
  const declared = tagValue ? tagValue(row, 'food_noun', null) : (row?.tags || {}).food_noun;
  if (typeof declared === 'string' && declared.trim()) return declared.trim().toLowerCase();
  return String(row?.name || 'something').replace(STATE_WORDS, '').trim().toLowerCase();
}

// "meat and potato stew". At most two nouns, in nameSlots order, deduped —
// three fish in a pot is a "fish stew", not a "fish and fish and fish stew".
export function dishName(template, rows, profileNameOf, tagValue) {
  const byProfile = new Map();
  for (const r of rows) {
    const p = profileNameOf(r);
    if (!p) continue;
    if (!byProfile.has(p)) byProfile.set(p, []);
    byProfile.get(p).push(r);
  }
  const nouns = [];
  for (const slot of template.nameSlots || []) {
    for (const r of byProfile.get(slot) || []) {
      const n = nounFor(r, tagValue);
      if (n && !nouns.includes(n)) { nouns.push(n); break; }
    }
    if (nouns.length >= 2) break;
  }
  // A named dish declares how its name is built — "jerk {0}" gives "jerk
  // chicken", "jerk beef", and plain "jerk" if there's no meat to name. The
  // generic templates use the default "{nouns} {noun}" shape below.
  if (template.nameFormat) {
    return template.nameFormat
      .replace(/\{(\d+)\}/g, (_, i) => nouns[Number(i)] || '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  if (!nouns.length) return template.noun;
  return `${nouns.join(' and ')} ${template.noun}`;
}

// ---------------------------------------------------------------------------
// Quality composition
// ---------------------------------------------------------------------------

// Compose the dish band from its ingredients' bands, then clamp to the
// template's ceiling. Mean pulled toward the worst by WORST_PULL. `bonus` is
// the sub-band nudge from knowing the recipe (see knowledge.js).
export function composeBand(bands, template, bonus = 0) {
  if (!bands.length) return QUALITY_BANDS[0];
  const idx = bands.map(bandIndex);
  const mean = idx.reduce((a, b) => a + b, 0) / idx.length;
  const worst = Math.min(...idx);
  const blended = mean * (1 - WORST_PULL) + worst * WORST_PULL + bonus;
  const ceiling = bandIndex(template.ceiling);
  const i = Math.max(0, Math.min(ceiling, Math.round(blended)));
  return QUALITY_BANDS[i];
}

// ---------------------------------------------------------------------------
// Validation — the same sanity gate profiles.js has, asserted by regress.
// This is what a generated or hand-edited catalog gets checked against.
// ---------------------------------------------------------------------------

// The best band a dish can possibly reach: every required ingredient plated at
// its own profile's peak ceiling, composed, with the known-recipe bonus applied.
// A dish whose stated ceiling sits above this is advertising a band no player
// can ever cook — which the Cookbook would then display as a target forever.
// How much seasoning this dish wants. A recipe that REQUIRES modifiers (a curry
// needs two aromatics to be a curry) must want at least that many, or following
// the recipe would itself read as over-seasoning. Otherwise one flourish.
// A template may override with an explicit `seasoning`.
export function seasoningIdeal(template) {
  if (Number.isInteger(template.seasoning)) return template.seasoning;
  let required = 0;
  for (const [profile, need] of Object.entries(template.needs || {})) {
    if (PROFILES[profile]?.modifier) required += range(need)[0];
  }
  return Math.max(DEFAULT_SEASONING, required);
}

// The seasoning term: bonus up to the ideal, penalty for every one past it.
export function seasoningBonus(template, count) {
  const ideal = seasoningIdeal(template);
  const under = Math.min(count, ideal);
  const over = Math.max(0, count - ideal);
  return Math.min(MODIFIER_BONUS_CAP, under * MODIFIER_BONUS) - over * OVER_SEASON_PENALTY;
}

export function bestPossibleBand(template, bonus = 0) {
  const bands = [];
  let mods = 0;
  for (const [profile, need] of Object.entries(template.needs || {})) {
    const p = PROFILES[profile];
    if (!p) return null;
    const [min] = range(need);
    // Modifiers season rather than compose — they add a flat bonus, never a band.
    if (p.modifier) { mods += min; continue; }
    for (let i = 0; i < min; i++) bands.push(p.targets.peak);
  }
  if (!bands.length) return null;
  const seasoning = seasoningBonus(template, Math.max(mods, seasoningIdeal(template)));
  return composeBand(bands, { ...template, ceiling: QUALITY_BANDS[QUALITY_BANDS.length - 1] }, bonus + seasoning);
}

// `bonus` defaults to the known-recipe nudge: the bar is "reachable by a player
// who has this recipe in their cookbook", not "reachable by a stranger". First
// discovery is automatic on a successful plate, so that bonus is always earnable
// — and it makes topping out a dish something the cookbook is genuinely for.
export function validateDishes(dishes = DISHES, bonus = KNOWN_RECIPE_BONUS) {
  const errors = [];
  const seen = new Map();

  for (const [key, t] of Object.entries(dishes)) {
    const at = f => `${key}.${f}`;

    if (typeof t.noun !== 'string' || !t.noun.trim()) errors.push(`${at('noun')} must be a non-empty string`);
    if (t.vessel !== null && !VESSEL_KINDS.includes(t.vessel)) errors.push(`${at('vessel')} must be null or one of ${VESSEL_KINDS.join('/')} — got ${t.vessel}`);
    if (!QUALITY_BANDS.includes(t.ceiling)) errors.push(`${at('ceiling')} is not a quality band — got ${t.ceiling}`);
    if (!Number.isFinite(t.difficulty) || t.difficulty < 1) errors.push(`${at('difficulty')} must be >= 1 — got ${t.difficulty}`);

    const needs = t.needs || {};
    if (!Object.keys(needs).length) errors.push(`${at('needs')} is empty — a dish that requires nothing matches everything`);

    for (const [profile, need] of Object.entries(needs)) {
      if (!PROFILES[profile]) errors.push(`${at(`needs.${profile}`)} is not a known food profile`);
      const [min, max] = range(need);
      if (!Number.isInteger(min) || !Number.isInteger(max)) errors.push(`${at(`needs.${profile}`)} must be an integer or [min, max] — got ${JSON.stringify(need)}`);
      else if (min < 1 || max < min) errors.push(`${at(`needs.${profile}`)} range must be 1 <= min <= max — got ${JSON.stringify(need)}`);
    }

    for (const profile of t.optional || []) {
      if (!PROFILES[profile]) errors.push(`${at('optional')} lists unknown profile "${profile}"`);
      if (needs[profile]) errors.push(`${at('optional')} lists "${profile}", which is already required`);
    }

    if (t.keyItems !== undefined) {
      if (!Array.isArray(t.keyItems) || !t.keyItems.length) errors.push(`${at('keyItems')} must be a non-empty array of item ids when present`);
      else for (const id of t.keyItems) {
        if (typeof id !== 'string' || !id.startsWith('item_')) errors.push(`${at('keyItems')} entry "${id}" is not an item id`);
      }
    }
    if (t.nameFormat !== undefined && typeof t.nameFormat !== 'string') errors.push(`${at('nameFormat')} must be a string`);
    // Every {n} placeholder must have a nameSlot behind it, or the name renders
    // with a hole in it the first time somebody cooks the dish.
    for (const m of String(t.nameFormat || '').matchAll(/\{(\d+)\}/g)) {
      if (Number(m[1]) >= (t.nameSlots || []).length) errors.push(`${at('nameFormat')} references {${m[1]}} but only ${(t.nameSlots || []).length} nameSlots are declared`);
    }

    for (const slot of t.nameSlots || []) {
      if (!needs[slot] && !(t.optional || []).includes(slot)) errors.push(`${at('nameSlots')} names "${slot}", which the dish neither needs nor allows`);
    }
    if ((t.nameSlots || []).length > 2) errors.push(`${at('nameSlots')} may name at most 2 profiles`);

    // A ceiling nobody can reach is a promise the system can't keep.
    if (!errors.length) {
      const best = bestPossibleBand(t, bonus);
      if (best && bandIndex(t.ceiling) > bandIndex(best)) {
        errors.push(`${at('ceiling')} is ${t.ceiling}, but the best its required ingredients can compose is ${best} — no player could ever reach it`);
      }
    }

    // Two templates that demand exactly the same thing in the same vessel are
    // unreachable-by-one: whichever sorts later can never win a tiebreak.
    const fingerprint = `${t.vessel}|${Object.entries(needs).map(([p, n]) => `${p}:${JSON.stringify(range(n))}`).sort().join(',')}`;
    if (seen.has(fingerprint)) errors.push(`${key} has the same vessel+needs as ${seen.get(fingerprint)} — one of them is unreachable`);
    else seen.set(fingerprint, key);
  }

  return { ok: errors.length === 0, errors };
}
