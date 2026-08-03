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

import { PROFILES, QUALITY_BANDS, bandIndex, instanceNoun, HANDLING_VERB } from './profiles.js';
import { portionOf } from './portions.js';
import { gearLine } from './gear.js';
import { WORST_PULL, SLOP_CEILING, KNOWN_RECIPE_BONUS, MODIFIER_BONUS, MODIFIER_BONUS_CAP, OVER_SEASON_PENALTY, DEFAULT_SEASONING } from './config.js';

// Vessel kinds, read from the vessel's `tags.vessel_kind`. A vessel that
// declares none is 'any' and can host any template that doesn't demand one.
// A BOWL is the odd one out: you work in it rather than cook in it. Dips are
// mashed, mixed and seasoned, never heated — which is why every bowl dish sits
// on ingredients that are excellent RAW and why the bowl holds no heat at all.
// `bread` is a vessel the same way a bowl is: a thing you assemble in. It's the
// only EDIBLE one — the bread goes into the dish it made, which is what a
// sandwich is — and that's declared per-item as `tags.edible_vessel`.
export const VESSEL_KINDS = ['pan', 'pot', 'tray', 'bowl', 'bread'];

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
    // Thick and pale is a commitment: a chowder's liquid is milk.
    nouns: { liquid: 'milk' },
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
    // Stock is bones and water. Offering "brandy or broth" as answers to a
    // stock's liquid would be worse than useless.
    nouns: { liquid: 'water' },
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
  // Bread, cheese, fat, one turn. The simplest real dish in the book and the
  // one most people can actually cook — which is the point of it being here:
  // every other pan dish assumes you own meat.
  toastie: {
    noun: 'toastie', vessel: 'pan',
    needs: { bread: [1, 2], dairy: 1, fat_or_oil: 1 },
    optional: ['aromatic', 'preserved'],
    nameSlots: ['dairy'],
    seasoning: 1,
    // Not masterful, and deliberately. A toastie done perfectly is a very good
    // toastie; the ceiling is where the catalog says what a dish IS.
    ceiling: 'excellent', difficulty: 4,
    blurb: 'Bread, cheese, a hot pan and one turn. Hard to better, easy to ruin.',
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
    // Layered, drowned, browned. The thing it's drowned in is cream.
    nouns: { liquid: 'cream' },
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
    // Salt and sweet, both capped at excellent on their own — the pair composes
    // to superb and no further. The finer scale can finally say that exactly.
    ceiling: 'superb', difficulty: 7,
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
    ceiling: 'superb', difficulty: 8,
    blurb: 'Bitter peel, long heat, and a set you either hit or you do not.',
  },
  egg_drop: {
    noun: 'egg soup', vessel: 'pot',
    needs: { liquid: 1, egg: [1, 2] },
    optional: ['aromatic', 'soft_vegetable'],
    nameSlots: [],
    // The blurb commits outright — "beaten egg poured into moving stock".
    nouns: { liquid: 'stock' },
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
    ceiling: 'superb', difficulty: 6,
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
    // A baked pudding is a custard set slowly — batter, egg and milk.
    nouns: { liquid: 'milk' },
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
    // Same dish with salt cuts through it, and the same answer.
    nouns: { liquid: 'cream' },
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
  // A sauce built on what a sear left behind. Almost nothing in it — liquid and
  // seasoning — which is the point: without the fond it is hot brown water, and
  // that's what the `deglaze` bonus is paying for.
  pan_sauce: {
    noun: 'pan sauce', vessel: 'pan',
    needs: { liquid: [1, 2], aromatic: [1, 3] },
    optional: ['fat_or_oil', 'soft_vegetable'],
    nameSlots: [],
    nameFormat: 'pan sauce',
    // What it's built on, which is deliberately NOT what's in it. Any savoury
    // sear belongs in a pan sauce; a fruit fond still tastes wrong in one.
    fondFrom: ['dense_meat', 'preserved', 'batter'],
    seasoning: 2,
    ceiling: 'excellent', difficulty: 6,
    blurb: 'Wine or stock into a hot pan, and everything the meat left behind comes up with it.',
  },

  // ── Intermediates: dishes whose output is an INGREDIENT ───────────────────
  // A template with `output` doesn't produce a meal — it produces a component
  // you then cook. That's the difference between a recipe with two steps and a
  // recipe with two recipes, and it's what lets a real dish like meatballs in
  // sauce exist: mix and roll, brown, then simmer for hours.
  //
  // How well you made the intermediate becomes the CEILING of whatever it ends
  // up in. Sloppy meatballs cap the sauce they go into, however well you simmer.
  meatballs: {
    noun: 'meatballs', vessel: 'bowl',
    needs: { dense_meat: [1, 2], egg: [1, 2], batter: 1 },
    optional: ['aromatic', 'fat_or_oil', 'soft_vegetable'],
    nameSlots: [],
    nameFormat: 'meatballs',
    output: { item: 'item_meatballs' },
    seasoning: 3,
    ceiling: 'masterful', difficulty: 7,
    blurb: 'Meat, egg and crumb worked together by hand and rolled out. Not dinner yet.',
  },
  // The rub. Nothing but seasoning, mixed dry, and its output is the same
  // `item_bbq_rub` the grocery sells — buying it and making it are the same
  // thing, which is the point: the shop version is the floor, and yours can be
  // better than the shop's.
  //
  // The ceiling has to be `masterful` even though this is five powders in a
  // bowl. An intermediate's band CAPS whatever it ends up in (see above), so a
  // rub capped at `excellent` would quietly make a masterful smoked chop
  // impossible for anyone who rubbed it — which is the opposite of the intent.
  spice_rub: {
    noun: 'rub', vessel: 'bowl',
    needs: { aromatic: [3, 5] },
    nameSlots: [],
    nameFormat: 'spice rub',
    output: { item: 'item_bbq_rub' },
    // Every ingredient IS the seasoning, so there's no separate seasoning step
    // to reward — the balance is the recipe.
    seasoning: 0,
    notes: {
      aromatic: 'salt and pepper, garlic, brown sugar, paprika, cayenne — and the salt is not the flavour, it is the vehicle',
    },
    steps: [
      'Everything dry and everything ground. A lump of anything in a rub is a lump of that thing in your dinner.',
      'Salt first and by weight, because it is the only one you cannot walk back.',
      'Sugar next. It is not there to sweeten it, it is there to burn — that is where the bark comes from.',
      'Paprika for colour, cayenne for the argument, garlic for the rest of it.',
      'Mix until the colour is one colour. If you can still see the salt, keep going.',
    ],
    ceiling: 'masterful', difficulty: 5,
    blurb: 'Five powders and a bowl. The salt is the vehicle, the sugar is the bark, and the rest is an argument you get to settle yourself.',
  },

  // ── Bowl: dips. Nothing here goes on the heat ─────────────────────────────
  // These are the only dishes made from ingredients at their RAW target, which
  // is why they lean on soft vegetables and fruit (both `raw: excellent`) and
  // why fat and aromatics carry so much of the result. Mashed, not cooked.
  mash_dip: {
    noun: 'dip', vessel: 'bowl',
    needs: { soft_vegetable: [2, 3], fat_or_oil: 1 },
    optional: ['aromatic', 'liquid'],
    nameSlots: ['soft_vegetable'],
    seasoning: 2,
    ceiling: 'excellent', difficulty: 4,
    blurb: 'Mashed to a rough paste with a stone, loosened with oil, and eaten with anything flat.',
  },
  pulse_dip: {
    noun: 'paste', vessel: 'bowl',
    needs: { starchy_vegetable: [1, 2], fat_or_oil: 1, aromatic: [1, 3] },
    optional: ['liquid'],
    nameSlots: ['starchy_vegetable'],
    seasoning: 3,
    ceiling: 'excellent', difficulty: 5,
    blurb: 'Ground smooth, slackened with oil, and seasoned well past where you would stop.',
  },
  salsa: {
    noun: 'salsa', vessel: 'bowl',
    needs: { soft_vegetable: [1, 2], fruit: [1, 2], aromatic: [1, 3] },
    optional: ['fat_or_oil', 'liquid'],
    nameSlots: ['fruit', 'soft_vegetable'],
    seasoning: 2,
    ceiling: 'excellent', difficulty: 5,
    blurb: 'Chopped fine, salted, and left ten minutes to become one thing instead of four.',
  },
  cream_dip: {
    noun: 'dip', vessel: 'bowl',
    needs: { liquid: 1, aromatic: [2, 3] },
    optional: ['soft_vegetable', 'fat_or_oil'],
    nameSlots: ['aromatic'],
    // The seasoning is the name slot and stays variable; the thick thing it gets
    // stirred into does not. "90g of liquid" was the shopping list at its least
    // helpful.
    nouns: { liquid: 'cream' },
    seasoning: 3,
    ceiling: 'good', difficulty: 3,
    blurb: 'Something thick, something sharp, and a great deal more seasoning than seems wise.',
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
    // "Cabbage and batter bound with egg" — the batter and the egg are one
    // thing, and the cabbage is the other. THE RULE FOR A `parts` GROUP: it has
    // to leave something outside itself. A group that swallows every ingredient
    // is a heading with nothing to distinguish, which is noise, not structure.
    parts: [{ label: 'the batter', of: ['batter', 'egg'] }],
    nameFormat: 'okonomiyaki',
    // Keyed on the cabbage and the blurb commits to it, so the list can say
    // cabbage instead of "one soft vegetable". Display only — any soft vegetable
    // still matches, exactly as before.
    nouns: { soft_vegetable: 'cabbage' },
    // Sauce, bonito, and whatever else goes on top — a dish that is largely garnish.
    seasoning: 3,
    ceiling: 'masterful', difficulty: 7,
    blurb: 'Cabbage and batter bound with egg, pressed flat, turned once, and finished in a lattice of sauce.',
  },
  // Smoked first, then finished hot and fast over coals — the one dish that
  // spans two appliances. The sauce is the key: apple butter is `fruit`, so it
  // caramelises and chars the way the recipe wants rather than just seasoning.
  //
  // The name does NOT say "smoked" itself. The intended route into this dish is
  // the smoker, and the smoker already renames what comes off it (`smoked pork`,
  // via SMOKER_PROFILE in index.js) — so a hardcoded "smoked {0}" printed
  // "smoked smoked pork chop". The preserved slot brings its own adjective;
  // let it. A cured strip cooked this way is a "cured meat chop", which is
  // exactly what it is.
  smoked_chop: {
    noun: 'chop', vessel: 'pan',
    keyItems: ['item_bbq_sauce'],
    needs: { preserved: [1, 2], fruit: [1, 2] },
    optional: ['aromatic', 'fat_or_oil'],
    nameSlots: ['preserved'],
    // The sauce and the fruit are the glaze; the chop is the chop.
    parts: [{ label: 'the glaze', of: ['item_bbq_sauce', 'fruit'], steps: [4] }],
    nameFormat: '{0} chop',
    seasoning: 3,
    notes: {
      preserved: 'a slab an inch and a half thick, smoked first — that is not optional',
      fruit: 'the sauce, and Malcolm will tell you which one',
    },
    steps: [
      'Score the fat cap in a diamond, a quarter inch deep and no more. You are opening it up, not carving it.',
      'Mustard all over it. You will not taste the mustard. That is not what the mustard is for.',
      'Rub on heavy. Heavier than that.',
      'Into the smoke, low, for an hour and a half. Go and do something else. Do not open the lid to look at it.',
      'Grates as hot as they go, sauce on, and down until the fat cap chars and crisps.',
      'Off at a hundred and fifty and not a degree over. Past that you have made a shoe.',
    ],
    ceiling: 'masterful', difficulty: 8,
    blurb: 'Hours in the smoke, then minutes over coals with the sauce going black at the edges.',
  },
  // The overnight one. Same smoker as the chop and the same rub, but where the
  // chop is an hour and a half and then your full attention over coals, this is
  // ten to fourteen hours and then no attention at all.
  //
  // The count looks enormous against the rest of the catalog and is correct: a
  // unit of `preserved` is 300g, and a bone-in shoulder is 2.6kg — nearly nine
  // units on its own. The range spans one shoulder to two, which is the real
  // choice being made. There is no small version of this dish; that is the dish.
  //
  // No `keyItems`: the chop is anchored on the sauce because the sauce IS that
  // dish, but pulled shoulder is a method, and anything you smoke that long and
  // pull apart is the thing. Sauce and rub are welcome and neither is required.
  pulled_shoulder: {
    noun: 'pulled shoulder', vessel: 'tray',
    needs: { preserved: [6, 10] },
    optional: ['aromatic', 'fruit', 'fat_or_oil', 'liquid'],
    nameSlots: ['preserved'],
    nameFormat: 'pulled {0}',
    seasoning: 3,
    notes: {
      preserved: 'a whole shoulder, bone in, smoked — one feeds a room, two feeds a week',
    },
    steps: [
      'Score the fat cap. Mustard, then rub, and far more rub than looks reasonable.',
      'Two twenty-five, and then ten to fourteen hours. That is not a range you get to choose from — it is done when it is done.',
      'It will stop climbing in temperature partway through and sit there for hours, sulking. This is normal. Do not turn the heat up. Do not.',
      'Take it off when the bone comes away from it without an argument.',
      'Rest it, then pull it apart with two forks and your hands, and put the bark back through the middle so everybody gets some.',
    ],
    ceiling: 'masterful', difficulty: 9,
    blurb: 'On overnight and off when the bone gives up. Pulled apart by hand with the bark stirred back through it.',
  },
  meatball_sugo: {
    noun: 'sugo', vessel: 'pot',
    keyItems: ['item_meatballs'],
    needs: { liquid: [1, 3], dense_meat: [1, 2] },
    optional: ['soft_vegetable', 'aromatic', 'fat_or_oil', 'starchy_vegetable'],
    nameSlots: [],
    nameFormat: 'meatballs in sauce',
    // A sugo is tomato, and the meat is the meatballs it's keyed on. Neither
    // fills a name slot, so neither is variable — the list can name both.
    nouns: { liquid: 'tomato', dense_meat: 'meatballs' },
    seasoning: 3,
    ceiling: 'masterful', difficulty: 9,
    blurb: 'Browned first, then hours on the lowest heat you have, stirred whenever you remember.',
  },
  // Penne alla gin — the vodka sauce with the wrong bottle in it, which is what
  // you make when the right bottle costs a week's rent. Anchored on penne and
  // gin: penne and tomato in a pan is just pasta in sauce, and the gin is the
  // entire point of the name. The juniper is why this isn't penne alla vodka —
  // vodka adds nothing but heat and alcohol, gin brings a whole hedge with it.
  //
  // THE SAUCE IS NAMED, NOT COUNTED. This asked for `liquid: [2,3]` — any two or
  // three liquids — which made penne, gin and two bottles of water a valid pan of
  // it, and told the shopping list the sauce was one errand with interchangeable
  // answers. It isn't: it's tomato cooked down HARD and then cream off the heat,
  // in that order, and the steps below have always said so. So the two of them
  // are required by class in their own right, and `liquid` drops to optional —
  // every liquid in the pan is now something already named, and counting them a
  // second time was the double-count that put the sauce on a shopping list twice.
  //
  // By CLASS and not by `keyItems`, because keyItems are exact ids and all
  // mandatory: naming the tin would forbid the paste, and the paste cooked down
  // is the same sauce. The tin, the tube and a fresh tomato all carry
  // `soft_vegetable` (two of them as `food_also`), so all three still work.
  penne_alla_gin: {
    noun: 'penne alla gin', vessel: 'pan',
    keyItems: ['item_penne', 'item_gin'],
    // The tomato band is wide on purpose — a 200g tube of concentrate is half a
    // unit and a fresh one is a quarter over, and both are a legitimate way to
    // make this. The requirement is that there IS tomato, not how much.
    needs: { dry_starch: 1, soft_vegetable: [0.5, 1.5], dairy: 1 },
    optional: ['liquid', 'aromatic', 'fat_or_oil', 'preserved'],
    nameSlots: [],
    nameFormat: 'penne alla gin',
    seasoning: 2,
    // The classes are right but the WORDS are generic, and this dish means one
    // specific thing by each. `nouns` is where an author says so — it's what
    // makes the card read "a tomato" rather than "one soft vegetable".
    nouns: { soft_vegetable: 'tomato', dairy: 'cream' },
    // THE SAUCE IS ONE THING MADE OF THREE. Tomato, gin and cream are not three
    // unrelated errands that happen to share a recipe — they are the sauce, and a
    // list that files them flat beside the pasta says nothing about that. `parts`
    // is where a dish says which of its ingredients COMPOSE something, and the
    // shopping list nests them under it.
    //
    // Components, not alternatives — you buy all three. That distinction is the
    // whole reason this is a separate field from the buyable examples a generic
    // class carries: those are answers to ONE errand and you pick one. Nesting
    // both the same way would have made "buy all of these" and "buy any of these"
    // look identical, which is the one thing a shopping list must never do.
    // `of` is ONE ordered list, profiles and item ids together, because the order
    // is the cooking order and it runs straight through both: tomato, then gin,
    // then cream. Two parallel arrays could not express that — the gin sat in the
    // other list and always sorted after both classes, so the sauce read back in
    // an order nobody would ever cook it in.
    //
    // `steps` are INDICES into this dish's own steps, never copied text: the
    // sauce's method is already written below and pointing at it means the two
    // can't drift apart.
    parts: [{ label: 'the sauce', of: ['soft_vegetable', 'item_gin', 'dairy'], steps: [1, 2, 3] }],
    notes: {
      dry_starch: 'a portion a head, no more',
      soft_vegetable: 'cooked down hard, before anything else goes in',
      dairy: 'in last, off the heat, once the alcohol has gone',
    },
    steps: [
      'Salt the water heavily and get the penne in. Do not stir it about.',
      'Tomato into hot fat and cook it down hard, until it darkens and stops being a sauce made of water.',
      'Off the heat — genuinely off it — in with the gin. It will hiss and try to catch. That is why it is off the heat.',
      'Back on low. Cream in last, and only once the alcohol has gone.',
      'Drain the penne short of done and finish it in the pan, so the sauce catches in the ridges.',
    ],
    ceiling: 'masterful', difficulty: 9,
    blurb: 'Tomato cooked down hard, a slug of gin off the heat, cream in last. The alcohol goes, the juniper stays, and the sauce clings to the ridges the way it is supposed to.',
  },
  ramen: {
    noun: 'ramen', vessel: 'pot',
    keyItems: ['item_ramen_noodles'],
    needs: { liquid: [1, 2], dry_starch: [1, 2] },
    optional: ['dense_meat', 'egg', 'soft_vegetable', 'preserved', 'aromatic', 'fat_or_oil'],
    nameSlots: ['dense_meat'],
    nameFormat: '{0} ramen',
    seasoning: 2,
    // The blurb commits to it — "stock held at a whisper". The meat is the name
    // slot and stays variable; the broth never was.
    nouns: { dry_starch: 'ramen noodles', liquid: 'stock' },
    notes: {
      liquid: 'stock, and it is the whole dish, so make it properly',
      dry_starch: 'in last, and barely cooked',
    },
    steps: [
      'Get the stock hot and hold it at a whisper. Boiling it is how you get cloudy, bitter stock.',
      'Everything that needs cooking goes in the stock, not the bowl.',
      'Noodles in for three minutes. Three. They keep cooking in the bowl.',
      'Arrange the toppings on top rather than stirring them through. It matters, and you know it matters.',
    ],
    ceiling: 'masterful', difficulty: 8,
    blurb: 'Stock held at a whisper, noodles in for three minutes, everything else arranged on top like it matters. It does.',
  },

  // ── Bread: assembled, not cooked ──────────────────────────────────────────
  // These are the sandwiches worth having a NAME for. Everything else bread can
  // do falls to GENERIC_SANDWICH and is named off its contents — which is the
  // design, not a gap. Add one here only when the combination is a real dish in
  // its own right, because every entry added is one fewer thing a player can
  // invent for themselves.
  cheese_sandwich: {
    noun: 'cheese sandwich', vessel: 'bread',
    needs: { bread: [1, 2], dairy: [1, 2] },
    optional: ['aromatic', 'soft_vegetable', 'fat_or_oil'],
    nameSlots: ['dairy'],
    nameFormat: '{0} sandwich',
    seasoning: 1,
    ceiling: 'excellent', difficulty: 3,
    blurb: 'Cheese, bread, and nothing clever. Perfect about one time in five.',
  },
  club: {
    noun: 'club', vessel: 'bread',
    needs: { bread: [1, 2], dense_meat: [1, 2], soft_vegetable: [1, 2], preserved: 1 },
    optional: ['dairy', 'egg', 'aromatic', 'fat_or_oil'],
    nameSlots: ['dense_meat'],
    nameFormat: '{0} club',
    seasoning: 2,
    ceiling: 'masterful', difficulty: 7,
    blurb: 'Stacked past the point of structural sense and held together on faith.',
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

// A sandwich that isn't any particular sandwich — which is most of them.
//
// Every other unmatched combination in this catalog falls to UNKNOWN_DISH and is
// capped at slop, because "meat, jam and three onions in a pot" genuinely is a
// mess. Bread does not work that way. Put anything sensible between two slices
// and you have made a real thing, and it should be called what it is: a rat meat
// and onion sandwich, with no recipe existing for it and none created by making
// it. That's the whole point — the sandwich is the one open-ended dish, so it is
// the one template that names itself from whatever went in.
//
// It has NO key, which is what keeps it out of the cookbook: `plate` only
// records a discovery when the match came back with one. Named sandwiches are
// ordinary DISHES entries with `vessel: 'bread'` and they outrank this by the
// normal specificity rule, so a recipe always wins where one exists.
export const GENERIC_SANDWICH = {
  noun: 'sandwich',
  vessel: 'bread',
  needs: {},
  optional: [],
  // Two nouns max, which `dishName` already enforces — "rat meat and onion
  // sandwich" reads; "rat meat and onion and cheese and pickle sandwich" does not.
  nameSlots: ['dense_meat', 'preserved', 'dairy', 'egg', 'soft_vegetable', 'fruit', 'starchy_vegetable'],
  seasoning: 1,
  // Below the named sandwiches and well above slop. A good sandwich is a good
  // thing; it is not the best thing you will eat this year.
  ceiling: 'very good',
  difficulty: 3,
  blurb: 'Bread, and whatever was to hand. The oldest idea in food.',
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
// Counted in PORTIONS, not rows: a whole onion is 1, half an onion is 0.5, and
// two halves are exactly one onion again. Every count in the catalog was already
// authored as "how many of this ingredient", so nothing needed rewriting — a
// recipe asking for 1 soft vegetable still means one, it just now also means
// two halves of one, and no longer means half of one.
//
// Every portion is a dyadic fraction (½, ¼, ⅛), so these sums are exact in
// floating point and two halves really do make 1.0, not 0.9999999.
// ...and counted by MASS, not by how many things you happened to put in.
//
// Each profile declares a `unitWeight`: the grams that count as "one" of it in a
// recipe. A 700g slab of pork is nearly three units of meat; a 200g sausage is
// four-fifths of one. Recipes keep their plain integer counts — "one liquid" is
// still one liquid — they just now mean "about 400g of liquid" rather than "one
// object that happens to be liquid".
//
// Portions ride on top: half a 120g onion is 60g, so half a unit. Two halves are
// exactly one onion again, and the arithmetic stays exact because every portion
// is a dyadic fraction.
//
// A row without a weight (a synthetic test row, a malformed item) falls back to
// counting as one, so nothing can silently vanish from a signature.
// A STACK is not one ingredient. Three sausages in one inventory row weigh
// three sausages and cook for three sausages' worth of time (`prepareCook`
// already multiplies by quantity), so the recipe has to see three of them too —
// otherwise the same row means one thing to the clock and another to the
// matcher, and a pot of five potatoes matches a one-potato recipe while taking
// five times as long.
const stackOf = row => {
  const q = Number(row?.quantity);
  return Number.isFinite(q) && q > 0 ? q : 1;
};

export function unitsOf(row, profileName) {
  const profile = PROFILES[profileName];
  // MODIFIERS are dosed, not weighed. A jar of mustard is forty uses of mustard,
  // and weighing it would make one jar count as four units of seasoning — which
  // would both blow every aromatic range in the catalog and read as catastrophic
  // over-seasoning. You use a spoonful, so it counts as one thing.
  if (profile?.modifier) return portionOf(row) * stackOf(row);
  const unit = profile?.unitWeight;
  const grams = Number(row?.weight);
  if (!unit || !Number.isFinite(grams) || grams <= 0) return portionOf(row) * stackOf(row);
  return (grams * portionOf(row) * stackOf(row)) / unit;
}

// SECONDARY IDENTITIES — what a thing also counts as, without being it.
//
// An ingredient's profile has to stay singular, because it drives a CLOCK: milk
// has one cook timeline, one set of stage prose, one set of targets, and it
// behaves like a liquid in a pan whatever else it is. But "what is this made of"
// and "what does this satisfy in a recipe" are different questions, and only the
// first one needs a single answer. Milk is a liquid AND a dairy; butter on bread
// is fat that is not a separate ingredient.
//
// So a secondary identity rides in its own channel: it can SATISFY a `needs`
// entry, but it never counts toward the allowed-profile check. That asymmetry is
// the whole design — an "also" can only ever help a match, never break one.
// Without it, tagging milk as dairy would silently stop it matching `mash` and
// `porridge`, which allow liquid and have no opinion about dairy.
//
// A Symbol key so it can never collide with a profile name and never appears in
// the Object.keys sweep that the allowed check walks.
export const ALSO = Symbol('also');

// A secondary contributes the SAME unit count as the primary, not a recount
// against its own unitWeight — a 400g carton is one liquid, so it's one dairy.
// Recounting would make it 4.4 dairy on cheese's 90g unit and blow every range.
export function signature(rows, profileNameOf) {
  const sig = {};
  const also = {};
  const add = (map, key, n) => { map[key] = (map[key] || 0) + n; };
  for (const r of rows) {
    const name = profileNameOf(r);
    const key = name && PROFILES[name] ? name : 'unprofiled';
    const units = name && PROFILES[name] ? unitsOf(r, name) : portionOf(r) * stackOf(r);
    add(sig, key, units);

    // Declared on the item: `tags.food_also`. Milk is the case this exists for.
    const second = (r?.tags || {}).food_also;
    if (second && PROFILES[second] && second !== key) add(also, second, units);

    // BUTTERED bread carries its own fat. Without this, buttering a slice and
    // putting it in a pan would fail to match a toastie for want of a fat that
    // is visibly right there on the bread — and the player would have to drop a
    // second pat of butter in the pan to satisfy a recipe they'd already met.
    if (r?.custom_data?.buttered) add(also, 'fat_or_oil', 1);
  }
  sig[ALSO] = also;
  return sig;
}

const range = need => (Array.isArray(need) ? need : [need, need]);

// Every count in this catalog was authored as "how many of this ingredient",
// back when one ingredient was one unit. Now that a unit is a MASS, almost
// nothing weighs exactly one — a 400g steak is 1.6 units, a rat haunch is 0.8.
// So an authored count means "about this much", not "precisely this much", and
// matching uses a tolerance band around it. Without this, `dense_meat: 1` could
// only be satisfied by an ingredient that happened to weigh exactly 250g.
export const UNIT_TOLERANCE_LOW = 0.6;
export const UNIT_TOLERANCE_HIGH = 1.8;
const matchRange = need => {
  const [lo, hi] = range(need);
  return [lo * UNIT_TOLERANCE_LOW, hi * UNIT_TOLERANCE_HIGH];
};

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
  const also = sig[ALSO] || {};
  let required = template.keyItems?.length ? KEY_DISH_FLOOR + template.keyItems.length : 0;
  for (const [profile, need] of Object.entries(template.needs)) {
    const [min, max] = matchRange(need);
    // A secondary identity can SATISFY a requirement — milk is the dairy in a
    // dish that asks for one.
    const have = (sig[profile] || 0) + (also[profile] || 0);
    if (have < min - 1e-9 || have > max + 1e-9) return -1;
    required += have;
  }
  // ...but it is deliberately NOT part of this check. Only what a thing actually
  // IS can disqualify it, or milk would stop matching every liquid recipe that
  // has no opinion about dairy. Object.keys skips the Symbol by construction.
  const allowed = new Set([...Object.keys(template.needs), ...(template.optional || [])]);
  for (const profile of Object.keys(sig)) {
    if (!allowed.has(profile)) return -1;
  }
  // Fractional tiebreak on difficulty: when two templates are equally specific —
  // which happens when a pot holds the key ingredients of two different named
  // dishes — the more demanding one wins. Always under 1, so it can never
  // overturn a genuine specificity difference, which is always a whole number.
  // Divided by 1000, not 100: specificity is now fractional (portions), and the
  // smallest real difference is one eighth. The tiebreak has to stay well under
  // that or it could overturn a genuine difference rather than just breaking a
  // tie between two dishes that are equally specific.
  return required + Math.min(999, template.difficulty || 0) / 1000;
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

// ---------------------------------------------------------------------------
// How a recipe READS
// ---------------------------------------------------------------------------
//
// The catalog is stored as CLASSES — `dense_meat: [1,2], liquid: 1` — because
// that is what makes it extensible: tag a new ingredient and every dish its
// profile fits accepts it. But nobody wants to read a recipe that way.
//
// Everything needed to print a real one is already here and has been all along:
// a profile's `unitWeight` is the grams that count as one, `cookRateMult` and
// COOK_SECONDS_PER_KG are the clock, `turns` is the handling, `needsPrep` is the
// knife work, `heatTolerance` is the setting, and `doneness` is the target. So
// this is presentation over the same data the cook actually runs on — not a
// second copy of the recipe that can drift away from the first.

const G = n => (n >= 1000 ? `${(n / 1000).toFixed(n % 1000 ? 1 : 0)}kg` : `${Math.round(n)}g`);
const MINS = ms => {
  const m = ms / 60000;
  if (m < 1) return `${Math.round(ms / 1000)}s`;
  if (m < 10) return `${Math.round(m * 2) / 2} min`;
  return `${Math.round(m)} min`;
};

// "500g–1kg of dense meat, cut down" — real weights, from the profile's own
// unitWeight, which is the exact number the matcher counts against.
export function ingredientLine(profileName, need, template = null, itemInfo = null) {
  const p = PROFILES[profileName];
  const label = p?.label || profileName;
  const [lo, hi] = range(need);
  if (p?.modifier) {
    return lo === hi
      ? `${lo} of ${label} — to season`
      : `${lo}–${hi} of ${label} — to season`;
  }
  const unit = p?.unitWeight || 0;
  const grams = unit ? (lo === hi ? G(lo * unit) : `${G(lo * unit)}–${G(hi * unit)}`) : (lo === hi ? `${lo}` : `${lo}–${hi}`);
  const prep = p?.needsPrep ? ', cut down' : '';
  // SAY PENNE, NOT "DRY STARCH".
  //
  // A keyed dish already names the exact ingredient that class stands for —
  // penne_alla_gin declares item_penne — so when a key item's own profile is the
  // one being printed, use ITS noun instead of the class label. "125g of penne"
  // rather than "125g of dry starch", automatically, with no per-dish authoring:
  // the template said which bottle it means, so the card can simply read it.
  //
  // Class matching is untouched — this is the display layer looking up a noun
  // the template already committed to. Dishes with no key item for that class
  // keep the class label, which is correct: a stew's meat really is any meat.
  const keyNoun = keyNounFor(template, profileName, itemInfo);
  const shown = keyNoun || label;

  // A named dish may also say what its classes are FOR. Class matching is what
  // makes the catalog extensible, but "800g–1.2kg of liquid" is not a recipe
  // anyone can follow — that's three ingredients in one number, and the note is
  // where the author says which three.
  const note = template?.notes?.[profileName];
  return `${grams} of ${shown}${prep}${note ? ` — ${note}` : ''}`;
}

// The noun a template's key item lends to the class it belongs to, if any.
// `itemInfo(id)` returns the item row (or anything carrying name + tags); absent,
// this answers null and everything falls back to the class label.
export function keyNounFor(template, profileName, itemInfo) {
  // A DECLARED NOUN IS CHECKED FIRST, because it needs nothing to resolve it.
  // This guard used to sit above it and required a dish to have `keyItems` at
  // all — so an author who wrote `nouns: { liquid: 'stock' }` on a dish with no
  // key item (a gratin, a chowder, a custard: most of the catalog) had it
  // silently ignored, and the card went on saying "400g of liquid". The comment
  // below has always claimed an explicit override wins; now it does.
  const declaredFirst = template?.nouns?.[profileName];
  if (typeof declaredFirst === 'string' && declaredFirst.trim()) return declaredFirst.trim().toLowerCase();
  if (!template?.keyItems?.length || typeof itemInfo !== 'function') return null;
  // ONLY when the key item IS the whole of that class. penne_alla_gin keys on
  // gin, whose profile is `liquid` — but the recipe wants 2–3 liquids, of which
  // the gin is one alongside tomato and cream. Naming the whole class after one
  // of them produced "800g–1.2kg of gin", which is not a recipe, it's a warning.
  // A class the dish wants exactly ONE of is unambiguously the key item; any
  // more and it's a composite and keeps its class name.
  // An explicit override always wins. Ramen wants 1–2 dry_starch and both of
  // them are noodles, so the auto-rule below is too shy for it — but the author
  // knows, and `nouns` is where they say so.
  const declared = template.nouns?.[profileName];
  if (typeof declared === 'string' && declared.trim()) return declared.trim().toLowerCase();

  const [lo, hi] = range(template.needs?.[profileName] ?? 0);
  if (lo !== 1 || hi !== 1) return null;
  for (const id of template.keyItems) {
    const row = itemInfo(id);
    const tags = row?.tags || {};
    if (tags.food_profile !== profileName) continue;
    const noun = tags.food_noun || row?.name;
    if (noun) return String(noun).toLowerCase();
  }
  return null;
}

// Roughly how long the longest thing in this dish takes on an ordinary stove,
// at the required minimum. An estimate and labelled as one — the real clock
// depends on the vessel, the heat setting and how much you actually put in.
export function estimateCookMs(template, secondsPerKg = 360) {
  let worst = 0;
  for (const [profileName, need] of Object.entries(template.needs || {})) {
    const p = PROFILES[profileName];
    if (!p || p.modifier) continue;
    const grams = (p.unitWeight || 250) * range(need)[0];
    const ms = (grams / 1000) * secondsPerKg * (p.cookRateMult || 1) * 1000;
    if (ms > worst) worst = ms;
  }
  return worst;
}

// The method, derived rather than authored — the handling the profiles already
// declare, read back as instructions.
export function methodLines(template) {
  // A named dish can carry its own steps, and where it does they WIN. The
  // derived method below reads a profile's turns/heat/doneness back as generic
  // instructions, which is right for the 40-odd class-matched templates and
  // useless for a dish with actual technique in it: no profile can express
  // "off the heat before the gin goes in", and that is the entire recipe.
  if (Array.isArray(template.steps) && template.steps.length) return [...template.steps];

  const out = [];
  const profiles = Object.keys(template.needs || {})
    .map(n => [n, PROFILES[n]]).filter(([, p]) => p && !p.modifier);
  if (!profiles.length) return [`Assemble it. Nothing here wants heat.`];

  if (template.vessel === 'bowl') return [`Work it together in the bowl. No heat — everything here is better raw.`];
  if (template.vessel === 'bread') return [`Build it on the bread. Heat is optional and changes what it is.`];

  const anyPrep = profiles.some(([, p]) => p.needsPrep);
  if (anyPrep) out.push(`Cut everything down first — you'll want a knife.`);

  // Heat: a profile with a heatCurve is telling you to change the setting.
  const curved = profiles.find(([, p]) => p.heatCurve?.length > 1);
  if (curved) {
    const [, p] = curved;
    const first = p.heatCurve[0], rest = p.heatCurve[p.heatCurve.length - 1];
    out.push(`Start it ${first.tier}, then drop to ${rest.tier} and leave it there.`);
  } else {
    const tiers = [...new Set(profiles.map(([, p]) => p.heatTolerance))];
    out.push(`Keep it ${tiers.length === 1 ? tiers[0] : tiers.join('/')} the whole way.`);
  }

  const turns = Math.max(...profiles.map(([, p]) => p.turns || 0));
  if (turns === 0) out.push(`Don't fuss it. Turning this makes it worse.`);
  else {
    const verb = profiles.some(([n]) => HANDLING_VERB[n] === 'stir') ? 'Stir' : 'Turn';
    out.push(`${verb} it ${turns === 1 ? 'once' : `${turns} times`}, no more.`);
  }

  // Doneness is a choice you make over direct heat. Nobody asks how you'd like
  // your stew — it went in a pot and it's done when it's done — so the line only
  // appears where the choice is actually meaningful.
  const done = ['pot'].includes(template.vessel) ? null : profiles.find(([, p]) => p.doneness);
  if (done) {
    const [, p] = done;
    out.push(`Choose your doneness: ${p.doneness.levels.map(l => l.name).join(', ')}. Default is ${p.doneness.default}.`);
  }
  return out;
}

/**
 * A full, readable recipe card. `secondsPerKg` is injected rather than imported
 * so this stays free of config coupling and regress can assert the arithmetic.
 */
export function describeDish(key, template, secondsPerKg = 360, itemInfo = null) {
  const t = template || DISHES[key];
  if (!t) return null;
  const lines = [];
  lines.push(`<span class="text-accent">${t.noun.toUpperCase()}</span>`);
  lines.push(`<span class="text-dim">${t.blurb}</span>`);
  lines.push('');
  for (const [profileName, need] of Object.entries(t.needs || {})) {
    lines.push(`  · ${ingredientLine(profileName, need, t, itemInfo)}`);
  }
  const opt = (t.optional || []).map(n => PROFILES[n]?.label || n);
  if (opt.length) lines.push(`  <span class="text-dim">optional: ${opt.join(', ')}</span>`);
  lines.push('');
  lines.push(`<span class="text-dim">Method:</span>`);
  for (const l of methodLines(t)) lines.push(`  ${l}`);
  lines.push('');
  const ms = estimateCookMs(t, secondsPerKg);
  if (ms > 0) lines.push(`<span class="text-dim">Roughly:</span> ${MINS(ms)} <span class="text-dim">on an ordinary stove — the pan and the heat move it either way.</span>`);
  // THE KIT, not just the pan. A card that named the vessel and stopped left the
  // stove and the spoon as things you found out you needed halfway through.
  lines.push(`<span class="text-dim">Make it with:</span> ${gearLine(t) || 'anything, or straight on the heat'}`);
  // NAME the key items. Being coy about them is right on the LIST (working out
  // what a dish is made of is the cooking game) but wrong on a card for a
  // recipe you have already earned — at that point "the right ingredient" is
  // just withholding, and a real cookbook names the bottle.
  if (t.keyItems?.length) {
    const named = t.keyItems.map(id => (itemInfo?.(id)?.name || id.replace(/^item_/, '').replace(/_/g, ' ')));
    lines.push(`<span class="text-dim">Will not work without:</span> ${named.join(' and ')} — no substitutions, that is what makes it this dish`);
  }
  lines.push(`<span class="text-dim">Difficulty:</span> ${t.difficulty}/10 · <span class="text-dim">best possible:</span> ${bestPossibleBand(t, KNOWN_RECIPE_BONUS) || '—'}`);
  return lines.join('\n');
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
      // Whole numbers WERE the rule, back when one ingredient was one unit. A
      // unit is a mass now, so "half a unit" is a thing an author can mean and a
      // pan can hold: penne alla gin wants tomato in it without caring whether
      // that's a 200g tube or a 400g tin, and the integer floor of 1 could only
      // say the tin. Still guarded — a need must be a positive, ordered range;
      // it just no longer has to be a whole ingredient.
      if (!Number.isFinite(min) || !Number.isFinite(max)) errors.push(`${at(`needs.${profile}`)} must be a number or [min, max] — got ${JSON.stringify(need)}`);
      else if (min <= 0 || max < min) errors.push(`${at(`needs.${profile}`)} range must be 0 < min <= max — got ${JSON.stringify(need)}`);
    }

    for (const profile of t.optional || []) {
      if (!PROFILES[profile]) errors.push(`${at('optional')} lists unknown profile "${profile}"`);
      if (needs[profile]) errors.push(`${at('optional')} lists "${profile}", which is already required`);
    }

    // `notes` explains what a CLASS is for in this particular dish; `steps`
    // replaces the derived method wholesale. Both are presentation, but a note
    // about an ingredient the dish doesn't use would print advice for something
    // that isn't in the recipe — which is exactly the kind of leftover an edit
    // produces and nobody notices.
    for (const profile of Object.keys(t.notes || {})) {
      if (!PROFILES[profile]) errors.push(`${at('notes')} names unknown profile "${profile}"`);
      else if (!needs[profile] && !(t.optional || []).includes(profile)) {
        errors.push(`${at('notes')} explains "${profile}", which this dish neither needs nor allows`);
      }
    }
    // `parts` says which ingredients COMPOSE something — the sauce, the glaze,
    // the batter — so a shopping list can nest them under it instead of filing
    // them flat. Same failure mode as `notes`: a group naming an ingredient the
    // dish doesn't have is the leftover an edit produces and nobody notices,
    // except here it would silently drop a real errand off the list, because a
    // stamped part groups whatever it matches and nothing else.
    for (const [n, part] of (t.parts || []).entries()) {
      const where = at(`parts[${n}]`);
      if (!part?.label || typeof part.label !== 'string') errors.push(`${where} needs a label — it becomes the line its members sit under`);
      const members = part.of || [];
      if (!Array.isArray(members)) errors.push(`${where}.of must be an ordered array of profiles and item ids`);
      if (members.length < 2) errors.push(`${where} groups ${members.length} thing(s); a component group of one is a line with an extra level on top`);
      for (const m of members) {
        // One list, two kinds of member, told apart by the `item_` prefix the
        // whole catalog already uses for ids. The order of this list is the
        // order the thing is made in, which is why it can't be two arrays.
        if (String(m).startsWith('item_')) {
          if (!(t.keyItems || []).includes(m)) errors.push(`${where} composes "${m}", which is not one of this dish's keyItems`);
        } else if (!needs[m]) {
          errors.push(`${where} composes "${m}", which this dish doesn't require`);
        }
      }
      // A group that swallows every ingredient is a heading with nothing to
      // distinguish — every line indented under one parent says no more than the
      // flat list did. There has to be something outside it.
      const outside = Object.keys(needs).filter(p => !members.includes(p)).length
        + (t.keyItems || []).filter(id => !members.includes(id)).length;
      if (!outside) errors.push(`${where} groups everything the dish has; a part must leave something outside it or it adds a level and no information`);
      // Steps are INDICES into this dish's own steps, never copied prose — an
      // index can't drift from the method, and a copy always does.
      for (const i of part.steps || []) {
        if (!Number.isInteger(i) || i < 0 || i >= (t.steps || []).length) {
          errors.push(`${where}.steps[${i}] is not an index into this dish's ${(t.steps || []).length} steps`);
        }
      }
    }

    if (t.steps !== undefined) {
      if (!Array.isArray(t.steps) || !t.steps.length) errors.push(`${at('steps')} must be a non-empty array when present`);
      else if (t.steps.some(s => typeof s !== 'string' || !s.trim())) errors.push(`${at('steps')} contains an empty step`);
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
