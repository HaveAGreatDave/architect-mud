// The pantry: which food is in the game right now, and which aisle it's on.
//
// Phase 1 of docs/proposals/cooking-basics.md cut what a grocer sells to a
// handful of staples. Everything else is shelved with `tags.shelved` on its
// item row, never deleted, so a copy somebody already holds still cooks and
// still eats. Shelved food is gone from the Stock up sheet and the stockist
// hints, and a dish nothing in the pantry can make is left out of the
// cookbook's untried list and the recipe assistant until its food comes back.
import { getItemCache } from '../../server/engine/items-cache.js';

// The aisles of the Stock up sheet and the shopping list, in the order they're shown.
export const AISLES = [
  ['dairy', 'Dairy'],
  ['meat', 'Meat'],
  ['bakery', 'Bakery'],
  ['staples', 'Staples'],
  ['seasoning', 'Seasoning'],
];

// A profile's aisle when the item doesn't say (`tags.aisle` wins).
const AISLE_OF_PROFILE = {
  dairy: 'dairy', egg: 'dairy', fat_or_oil: 'dairy',
  dense_meat: 'meat', preserved: 'meat',
  bread: 'bakery', batter: 'bakery',
  aromatic: 'seasoning',
};

export const isShelved = (item) => !!item?.tags?.shelved;

export function aisleOf(item) {
  const t = item?.tags || {};
  if (t.aisle && AISLES.some(([k]) => k === t.aisle)) return t.aisle;
  return AISLE_OF_PROFILE[t.food_profile] || 'staples';
}

// Profiles that at least one unshelved item answers to, rebuilt when the item
// cache is replaced (it's replaced whole on a content reload).
let memo = { cache: null, profiles: null };
export function pantryProfiles() {
  const cache = getItemCache();
  if (memo.cache === cache && memo.profiles) return memo.profiles;
  const profiles = new Set();
  for (const item of cache.values()) {
    if (isShelved(item)) continue;
    const t = item?.tags || {};
    if (t.food_profile) profiles.add(t.food_profile);
    if (t.food_also) profiles.add(t.food_also);
  }
  memo = { cache, profiles };
  return profiles;
}

// Can the pantry make this dish? Every class it needs must be on sale somewhere
// or held by somebody. Optional classes don't count.
export function dishInPantry(template) {
  const have = pantryProfiles();
  return Object.keys(template?.needs || {}).every((p) => have.has(p));
}
