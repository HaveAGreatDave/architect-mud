// Drink profiles — reusable behaviour classes referenced by an item's
// `tags.drink_profile`. Plugin-local balance data, the same call cooking makes
// for its own profiles: this describes how a CLASS of ingredient behaves in a
// glass, not any individual world item, so it isn't content and doesn't want a
// table.
//
// The deliberate difference from cooking: drinks are DOSED, not weighed. A
// recipe wants two measures of spirit, not 60 grams of it, so there is no
// `unitWeight` here and no gram arithmetic anywhere in this plugin. An item
// declares `tags.pour_units` — how many pours one row is — and that's the unit.
//
// `raw` is the band an ingredient contributes at its own best. Unlike food,
// nothing here is cooked, so there's no peak/over/burnt curve: a drink is only
// ever as good as what went into it and how well it was put together.

import { QUALITY_BANDS, bandIndex } from '../../server/engine/quality-bands.js';

export { QUALITY_BANDS, bandIndex };

export const DRINK_PROFILES = {
  // ── Alcohol ────────────────────────────────────────────────────────────────
  base_spirit: {
    label: 'spirit',
    raw: 'excellent',
    blurb: 'The thing the drink is built on.',
  },
  liqueur: {
    label: 'liqueur',
    raw: 'excellent',
    blurb: 'Sweet, coloured, and load-bearing in more classics than anyone admits.',
  },
  fortified: {
    label: 'fortified wine',
    raw: 'excellent',
    blurb: 'Vermouth and its relatives. Wine that went to finishing school.',
  },
  wine: {
    label: 'wine',
    raw: 'good',
    blurb: 'Drunk as it is far more often than it is mixed.',
  },
  beer_base: {
    label: 'beer',
    raw: 'good',
    blurb: 'Mostly a drink in its own right; occasionally an ingredient.',
  },

  // ── Everything else ────────────────────────────────────────────────────────
  // `dilutes` marks a profile that adds volume without ethanol. It is what makes
  // a long drink weaker per mouthful than a short one — the arithmetic in
  // alcohol.js falls out of it rather than needing a rule.
  mixer: {
    label: 'mixer',
    raw: 'good',
    dilutes: true,
    blurb: 'Fizzy, cold, and the difference between a drink and a dare.',
  },
  juice: {
    label: 'juice',
    raw: 'excellent',
    dilutes: true,
    blurb: 'Pressed from something that was recently alive.',
  },
  dairy_cream: {
    label: 'cream',
    raw: 'excellent',
    dilutes: true,
    blurb: 'Softens everything it touches, including bad decisions.',
  },
  coffee_base: {
    label: 'coffee',
    raw: 'excellent',
    blurb: 'Ground, roasted, and the reason the morning happens at all.',
  },
  tea_base: {
    label: 'tea',
    raw: 'excellent',
    blurb: 'Leaves and hot water. Older than most of the things arguing about it.',
  },
  cocoa_base: {
    label: 'cocoa',
    raw: 'good',
    blurb: 'Bitter until you fix it, and worth fixing.',
  },
  // A MEDIUM is what the drink is IN, not what it is made of. Water and ice
  // have no quality of their own worth scoring — nobody has ever praised a cup
  // of tea for its water — so they count for matching and for volume (and so
  // for dilution) but never compose the band. Without this, hot water dragged
  // excellent tea leaves down to a mediocre cup, which is the wrong answer to
  // the wrong question.
  hot_water: {
    label: 'hot water',
    raw: 'acceptable',
    dilutes: true,
    medium: true,
    blurb: 'Not an ingredient so much as a condition.',
  },
  ice: {
    label: 'ice',
    raw: 'good',
    dilutes: true,
    medium: true,
    blurb: 'Chills, dilutes, and is the only thing in the glass that leaves while you drink.',
  },

  // ── Modifiers ──────────────────────────────────────────────────────────────
  // A MODIFIER seasons a drink rather than being part of it — the same call
  // cooking makes for fat and aromatics. Two dashes of bitters are not an
  // ingredient of a negroni, they're what makes it taste like one, and scoring
  // them as components would make every drink that "optionally" allows them
  // strictly worse for having them. So they never compose a band; they add a
  // flat seasoning term and are excluded from the unit counts.
  syrup: {
    label: 'syrup',
    raw: 'good',
    modifier: true,
    blurb: 'Sugar, dissolved, so it stops sitting in the bottom of the glass.',
  },
  bitters: {
    label: 'bitters',
    raw: 'excellent',
    modifier: true,
    blurb: 'Measured in dashes. The difference between a mix and a drink.',
  },
  garnish: {
    label: 'garnish',
    raw: 'good',
    modifier: true,
    blurb: 'Does more than it looks like it does, and looks like it does nothing.',
  },
};

export const isModifierProfile = name => !!DRINK_PROFILES[name]?.modifier;
export const dilutesProfile = name => !!DRINK_PROFILES[name]?.dilutes;
// A medium (water, ice) fills the glass but contributes no quality of its own.
export const isMediumProfile = name => !!DRINK_PROFILES[name]?.medium;

// The profile an inventory row declares. Unknown or absent reads as null and
// will fail every template — an untagged thing in a glass is sludge, which is
// the honest answer until somebody tags it.
export function profileNameFor(row) {
  const bag = row?.tags || row?.flags || {};
  const name = bag.drink_profile;
  return typeof name === 'string' && DRINK_PROFILES[name] ? name : null;
}

export function profileFor(row) {
  const name = profileNameFor(row);
  return name ? DRINK_PROFILES[name] : null;
}

// How many pours one inventory row is worth. A 700ml bottle declares 14; a can
// of tonic declares 2. A row with no declaration counts as one, so nothing can
// silently vanish from a signature.
export function poursOf(row) {
  const bag = row?.tags || row?.flags || {};
  const n = Number(bag.pour_units);
  const q = Number(row?.quantity);
  const stack = Number.isFinite(q) && q > 0 ? q : 1;
  return (Number.isFinite(n) && n > 0 ? n : 1) * stack;
}

// Sanity gate over the catalogue, asserted by regress — the same discipline as
// validateProfiles, and the thing a generated table would lean on.
export function validateDrinkProfiles(profiles = DRINK_PROFILES) {
  const errors = [];
  for (const [key, p] of Object.entries(profiles)) {
    if (!p.label) errors.push(`${key}.label is missing`);
    if (!QUALITY_BANDS.includes(p.raw)) errors.push(`${key}.raw is not a quality band — got ${p.raw}`);
    if (p.modifier && p.medium) errors.push(`${key} is both a modifier and a medium — pick one`);
    if (p.modifier && p.dilutes) errors.push(`${key} is both a modifier and a diluter — a dash of bitters does not lengthen a drink`);
  }
  return { ok: errors.length === 0, errors };
}
