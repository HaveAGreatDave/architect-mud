// ─── Item facets: the sections a list sorts itself into ──────────────────────
//
// One question, asked in two places that had nothing in common before: what are
// the natural groups in this pile of items? A shop's shelf sections (Ration Nine's
// dry / refrigerated / frozen, a gunsmith's weapons / armor / ammo) and a
// container's compartments are the same problem, so they get the same answer.
//
// Three rules shape this file, and reversing any of them is the failure mode:
//
// 1. CATEGORIES ARE DERIVED, NEVER AUTHORED PER SHOP. Nobody types section names
//    into a vendor's catalogue. Authored sections are content you have to maintain
//    in forty places, and they go stale the moment an item's tags change — the
//    shop would still promise a "Frozen" shelf after the last frozen thing left it.
//
// 2. ONE ITEM HAS SEVERAL ANSWERS, so a single category can't work. A coat is
//    Apparel on one axis and Torso on another and nothing at all on a third. Which
//    axis is the right one depends entirely on what it's sitting next to — which is
//    why the axis is chosen per LIST, not per item and not per shop.
//
// 3. THE STOCK PICKS THE AXIS, NOT THE AUTHOR. Every axis is scored against the
//    actual list and the best partition wins. Ration Nine's stock is all
//    `Consumable` on the class axis, so that axis scores ~0 and loses; `storage`
//    splits it cleanly and wins. A gunsmith is the reverse. Neither was configured,
//    and a shop that changes what it sells re-sections itself for free.
//
// Sync and query-free by contract: everything here reads an already-hydrated
// item's `tags`/`type` and nothing else. It is called from the shop stock builder
// and from container rendering, and must never become a reason to touch the DB.
//
// See docs/reference/item-facets.md.

// ── The axes ─────────────────────────────────────────────────────────────────
// Order matters only as a tie-break: an earlier axis wins an exact score tie, so
// the list reads the way a shopkeeper would arrange it.

// What KIND of thing it is. This is the long-standing `vendorCategory` logic,
// which lived in vendor.js and shipped on every stock entry without ever being
// used to group anything.
export function classFacet(tags = {}, type) {
  if (tags.weapon) return 'Weapons';
  if (tags.armor_soak) return 'Armor';
  const BODY = ['head', 'torso', 'hands', 'legs', 'feet'];
  if (BODY.includes(tags.slot)) return 'Apparel';
  if (tags.slot === 'accessory') return 'Accessories';
  if (tags.drug) return 'Drugs';
  if (tags.consumable) return 'Consumables';
  if (tags.container) return 'Containers';
  if (type === 'furniture') return 'Furniture';
  if (tags.material) return 'Materials';
  if (tags.utensil) return 'Utensils';
  return 'Goods';
}

// How it has to be KEPT — the grocery axis. Derived from perishable + spoil_rate,
// because an item that rots fast is one that lives in a chiller and that fact is
// already in its tags. `storage_tier` overrides, and FROZEN can only ever come
// from the override: nothing about a fish fillet's spoil rate says whether the
// shop sells it fresh or frozen, so a freezer case is authored or it doesn't exist.
//
// Returns null for anything that isn't food-ish, which keeps a hardware store's
// stock off this axis entirely rather than filing it all under "Dry Goods".
export function storageFacet(tags = {}) {
  const tier = tags.storage_tier;
  if (tier === 'frozen') return 'Frozen';
  if (tier === 'refrigerated') return 'Refrigerated';
  if (tier === 'dry') return 'Dry Goods';
  if (tags.perishable) {
    // fast spoilers want a cold box; the slow ones are cured or packaged and sit
    // on an ordinary shelf looking like ambient stock.
    if (tags.spoil_rate === 'slow') return 'Preserved';
    if (tags.spoil_rate === 'fast') return 'Refrigerated';
    return 'Fresh';
  }
  if (tags.food_profile || tags.consumable) return 'Dry Goods';
  return null;
}

// The ingredient/drink CLASS — the axis a kitchen or a bar wants. Reuses the
// cooking and drinks catalogues rather than inventing a parallel vocabulary, so a
// new profile shows up here the day it's authored.
const PROFILE_LABEL = {
  dense_meat: 'Meat', starchy_vegetable: 'Vegetables', dry_starch: 'Starches',
  soft_vegetable: 'Vegetables', fruit: 'Fruit', liquid: 'Liquids', batter: 'Batters',
  egg: 'Eggs', preserved: 'Preserves', fat_or_oil: 'Fats & Oils', aromatic: 'Aromatics',
  dairy: 'Dairy', bread: 'Bread',
  base_spirit: 'Spirits', liqueur: 'Liqueurs', fortified: 'Fortified', wine: 'Wine',
  beer_base: 'Beer', mixer: 'Mixers', juice: 'Juice', syrup: 'Syrups', bitters: 'Bitters',
  dairy_cream: 'Cream', coffee_base: 'Coffee', tea_base: 'Tea', cocoa_base: 'Cocoa',
  ice: 'Ice', garnish: 'Garnishes', hot_water: 'Hot Water',
};
export function profileFacet(tags = {}) {
  const p = tags.food_profile || tags.drink_profile;
  if (!p) return null;
  return PROFILE_LABEL[p] || String(p).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Where it's WORN — the outfitter's axis. Only equipment answers.
const SLOT_LABEL = {
  head: 'Head', torso: 'Torso', hands: 'Hands', legs: 'Legs', feet: 'Feet',
  accessory: 'Accessories', back: 'Back', face: 'Face',
};
export function slotFacet(tags = {}) {
  if (!tags.slot) return null;
  return SLOT_LABEL[tags.slot] || String(tags.slot).replace(/\b\w/g, c => c.toUpperCase());
}

export const AXES = {
  class:   { label: 'Type',     facet: (tags, type) => classFacet(tags, type) },
  storage: { label: 'Storage',  facet: (tags) => storageFacet(tags) },
  profile: { label: 'Class',    facet: (tags) => profileFacet(tags) },
  slot:    { label: 'Worn',     facet: (tags) => slotFacet(tags) },
};
export const AXIS_ORDER = ['storage', 'profile', 'slot', 'class'];

// The one facet lookup everything else goes through.
export function facetOf(item, axis) {
  const a = AXES[axis];
  if (!a) return null;
  return a.facet(item?.tags || {}, item?.type) || null;
}

// ── Choosing the axis ────────────────────────────────────────────────────────
// Scored on how well the axis actually PARTITIONS this list, which is the only
// thing that makes the choice automatic. Three ways an axis is useless, and all
// three have to be rejected or the list gets worse rather than better:
//
//   - it doesn't answer for most of the list  → low coverage
//   - it puts nearly everything in one bucket → no information (the Ration Nine
//     `class` case: 30 items, all "Consumables")
//   - it gives nearly one bucket per item     → a list of headers, not sections
//
// Score is (1 − largest bucket's share) × coverage, so a clean even split beats a
// lopsided one and a partial answer is discounted rather than disqualified.

export const MIN_ITEMS_TO_GROUP = 6;   // below this a flat list is simply nicer
export const MAX_BUCKETS = 6;
export const MIN_COVERAGE = 0.6;       // the axis must answer for most of the list
export const MAX_DOMINANCE = 0.85;     // one bucket holding ~everything is no split
export const MIN_SCORE = 0.15;

export function scoreAxis(items, axis) {
  if (!items?.length) return 0;
  const counts = new Map();
  let answered = 0;
  for (const it of items) {
    const f = facetOf(it, axis);
    if (!f) continue;
    answered++;
    counts.set(f, (counts.get(f) || 0) + 1);
  }
  if (counts.size < 2 || counts.size > MAX_BUCKETS) return 0;
  const coverage = answered / items.length;
  if (coverage < MIN_COVERAGE) return 0;
  const largest = Math.max(...counts.values()) / answered;
  if (largest > MAX_DOMINANCE) return 0;
  // A bucket per item is a header list. Reject once the average bucket is thinner
  // than two, which is where sections stop earning their line of screen space.
  if (answered / counts.size < 1.5) return 0;
  return (1 - largest) * coverage;
}

// Can this axis split this list AT ALL? Deliberately weaker than scoreAxis: no
// dominance test, no thin-bucket test, no minimum score — just "it answers for
// some of the list, and gives more than one answer". This is the bar an author
// override has to clear, because the quality heuristics exist to stop the
// AUTOMATIC choice making a list worse, and an author who names an axis has
// already made that judgement. Splitting nothing is still refused: a single
// section named after the whole shelf is never what anybody meant.
export function canSplit(items, axis) {
  const seen = new Set();
  for (const it of items) {
    const f = facetOf(it, axis);
    if (f) seen.add(f);
    if (seen.size > 1) return true;
  }
  return false;
}

// The axis this list should be grouped by, or null to leave it flat.
// `preferred` is an author override (a shop's `flags.shop_axis`, say) — honoured
// whenever it splits at all, so an author can insist without having to beat the
// scorer. It is the escape hatch, never the main path.
export function pickAxis(items, preferred = null) {
  if (!items || items.length < MIN_ITEMS_TO_GROUP) return null;
  if (preferred && AXES[preferred] && canSplit(items, preferred)) return preferred;
  let best = null, bestScore = MIN_SCORE;
  for (const axis of AXIS_ORDER) {
    const s = scoreAxis(items, axis);
    if (s > bestScore) { best = axis; bestScore = s; }
  }
  return best;
}

// ── Grouping ─────────────────────────────────────────────────────────────────

// Items an axis has no answer for are NOT dropped and NOT scattered — they fall
// into one trailing bucket. A section list that quietly loses items is worse than
// no sections, and this is the bug that would be hardest to notice.
export const OTHER_LABEL = 'Other';

// Stamp `group` onto each entry in place and return the axis used (null = flat).
// In place, because every caller here is decorating an object it already built and
// ships to a client — mirroring the `shop.stock` hook's own convention.
export function assignGroups(entries, { preferred = null, itemOf = (e) => e } = {}) {
  const items = entries.map(itemOf);
  const axis = pickAxis(items, preferred);
  if (!axis) return null;
  entries.forEach((e, i) => { e.group = facetOf(items[i], axis) || OTHER_LABEL; });
  return axis;
}

// Section headers in the order they should be shown: the axis's own declared
// order where it has one (a fridge reads cold → ambient, not alphabetically), then
// anything unlisted alphabetically, then `Other` last — always last, because it's
// the bucket for things that didn't fit and nothing that didn't fit goes on top.
const AXIS_SECTION_ORDER = {
  storage: ['Frozen', 'Refrigerated', 'Fresh', 'Preserved', 'Dry Goods'],
  class: ['Weapons', 'Armor', 'Apparel', 'Accessories', 'Drugs', 'Consumables',
          'Containers', 'Utensils', 'Materials', 'Furniture', 'Goods'],
  slot: ['Head', 'Face', 'Torso', 'Back', 'Hands', 'Legs', 'Feet', 'Accessories'],
};

export function orderGroups(groups, axis) {
  const declared = AXIS_SECTION_ORDER[axis] || [];
  const rank = new Map(declared.map((g, i) => [g, i]));
  return [...groups].sort((a, b) => {
    if (a === OTHER_LABEL) return 1;
    if (b === OTHER_LABEL) return -1;
    const ra = rank.has(a) ? rank.get(a) : declared.length;
    const rb = rank.has(b) ? rank.get(b) : declared.length;
    return ra !== rb ? ra - rb : a.localeCompare(b);
  });
}

// Convenience for the text renderers (container descriptions, the wares board):
// returns [{ group, items }] already ordered, or a single unnamed section when the
// list shouldn't be grouped — so a caller can render one shape either way.
export function sectionize(entries, { preferred = null, itemOf = (e) => e } = {}) {
  const axis = assignGroups(entries, { preferred, itemOf });
  if (!axis) return [{ group: null, items: entries }];
  const byGroup = new Map();
  for (const e of entries) {
    if (!byGroup.has(e.group)) byGroup.set(e.group, []);
    byGroup.get(e.group).push(e);
  }
  return orderGroups([...byGroup.keys()], axis).map(g => ({ group: g, items: byGroup.get(g) }));
}

// ─── Furniture facets: the sections a ROOM's furniture line sorts itself into ─
//
// Same question as above, asked of a different pile. A `furniture` row has no
// `tags`, so none of the item machinery applies to it — but the doctrine does, and
// it lives here so that "how a list sections itself" stays one file rather than two
// that drift.
//
// DERIVED, NEVER AUTHORED, is the whole of it. There is no `area` field on
// furniture and there must not be one: "Kitchen" is a place, and the same
// stove-and-cold-box cluster turns up in a bar galley, a diner and a squat. What
// the row already knows — its `object_type` and the flags the systems that own it
// stamped on it — is enough, and it stays true when a piece is moved.
//
// Sync and query-free, like everything else here: it reads a hydrated row and
// nothing else, and it is called from the room description on every `look`.
const FURNITURE_FACETS = [
  // Order is precedence, and the first two lines are the ones that matter: a fridge
  // is a container that is ALSO an appliance, and a television is furniture that is
  // also a set. Whichever bucket a player would name first, wins.
  ['Media', (f, fl) => ['media_deck', 'tv'].includes(f.object_type)
    || fl.tv || fl.is_tv || fl.media_deck || fl.broadcast_receiver || fl.broadcast_transmitter],
  ['Appliances', (f, fl) => f.object_type === 'cosmetic_machine'
    || fl.stove_tier || fl.microwave || fl.brew_tier || fl.preserves || fl.appliance_grade
    || fl.washing_machine || fl.smoker],
  ['Plumbing', (f, fl) => ['toilet', 'shower', 'sink'].includes(f.object_type) || fl.water_source],
  ['Terminals', (f, fl) => f.object_type === 'terminal'
    || fl.atm || fl.job_board || fl.slot_machine || fl.vends || fl.vends_packs
    || fl.teleporter || fl.chargen || fl.checkout || fl.lending_terminal],
  // Expected to stay EMPTY, and kept anyway. describe.js sends every light to the
  // room prose instead of this list ("the ceiling wash is lit"), so a light only
  // gets here when it's flagged `notable` — or in the dark, where the list is
  // lights and nothing else and the dominance rejection prints it flat regardless.
  // One line, so that the one room with two notable fixtures doesn't file them
  // under Furnishings.
  ['Lighting', (f, fl) => f.object_type === 'light' || fl.is_light],
  ['Storage', (f, fl) => f.object_type === 'container'
    || fl.container || fl.wardrobe || fl.dish_cabinet || fl.trash_bin],
];
// The trailing bucket. Named for what's actually in it — beds, seating, tables —
// rather than "Other", because on this list the remainder is a real category and
// the reader can see that it is.
export const FURNITURE_REMAINDER = 'Furnishings';
const FURNITURE_SECTION_ORDER = ['Appliances', 'Storage', 'Media', 'Terminals', 'Plumbing', 'Lighting', FURNITURE_REMAINDER];

export function furnitureFacet(row) {
  if (!row) return FURNITURE_REMAINDER;
  const fl = (typeof row.flags === 'object' && row.flags) || {};
  for (const [label, test] of FURNITURE_FACETS) if (test(row, fl)) return label;
  return FURNITURE_REMAINDER;
}

// A room has to be BUSY before sections beat a flat line. Below the floor, three
// labels over three short runs is more furniture than the furniture — the labels
// become the clutter they were added to fix.
export const MIN_FURNITURE_TO_SECTION = 8;

// Returns ordered [{ group, items }], or NULL meaning "print the flat line you
// print today". Null is the common answer and a successful one: most rooms in the
// game hold four things.
//
// Four ways sectioning makes a room worse, and each is its own rejection:
//   - too few pieces to be hard to read in the first place
//   - only one section has company, so it's a flat list wearing a hat
//   - one section holds everything, which is the flat list with an extra line
//   - the remainder is most of the room, so the axis didn't answer for it
export function sectionFurniture(entries, { rowOf = (e) => e } = {}) {
  if (!entries || entries.length < MIN_FURNITURE_TO_SECTION) return null;
  const byGroup = new Map();
  for (const e of entries) {
    const g = furnitureFacet(rowOf(e));
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(e);
  }
  if (byGroup.size < 2) return null;
  const sizes = [...byGroup.values()].map((v) => v.length);
  if (sizes.filter((n) => n >= 2).length < 2) return null;
  if (Math.max(...sizes) === entries.length) return null;
  if ((byGroup.get(FURNITURE_REMAINDER)?.length || 0) > entries.length / 2) return null;
  return FURNITURE_SECTION_ORDER
    .filter((g) => byGroup.has(g))
    .map((g) => ({ group: g, items: byGroup.get(g) }));
}
