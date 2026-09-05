// Drinks — what a vessel full of poured ingredients resolves INTO.
//
// The rule that makes this affordable is cooking's rule, unchanged: a template
// matches on the multiset of drink PROFILES in the vessel, never on item ids.
// "One spirit, two mixers, over ice, in a tall glass" is a highball — whether
// that spirit is gin or a rum you haven't written yet. Tag a new bottle with an
// existing profile and every drink its profile fits accepts it that instant.
//
// Plugin-local balance data, same call as profiles.js and config.js: it
// describes how CLASSES of ingredient combine, not any world item.
//
// Nothing is gated. Any combination pours; combinations no template claims
// resolve to UNKNOWN_DRINK at a capped band. That's the failure mode that
// teaches the system, and it means the catalogue never enumerates bad ideas.
//
// TWO DIFFERENCES FROM dishes.js, both deliberate:
//   • `vessels` is a LIST, not a scalar. A negroni is a tumbler or a glass; a
//     stew is only ever a pot. Drinkware is far more interchangeable than
//     cookware, and pretending otherwise would refuse obviously-fine drinks.
//   • Units are POURS, not grams. Nothing here weighs anything.

import { DRINK_PROFILES, QUALITY_BANDS, bandIndex, poursOf, profileNameFor, isModifierProfile, isMediumProfile } from './profiles.js';
import {
  WORST_PULL, SLOP_CEILING, KNOWN_RECIPE_BONUS,
  MODIFIER_BONUS, MODIFIER_BONUS_CAP, OVER_SEASON_PENALTY, DEFAULT_SEASONING,
  SHAKEN_BONUS, BREW_TIERS,
} from './config.js';

// The best appliance bonus in the game, for reachability maths.
const BEST_BREW_BONUS = Math.max(...Object.values(BREW_TIERS).map(t => t.bonus));

// Read from the vessel's `tags.drinkware_kind`. A vessel declaring none is
// 'any' and can host any template that doesn't demand a kind.
export const DRINKWARE_KINDS = [
  'cup', 'mug', 'glass', 'tumbler', 'coupe', 'tankard', 'shaker', 'thermos', 'carafe', 'teapot',
];

// `hot: true` means the template needs a hot-water appliance (flags.brew_tier)
// and is unreachable with `mix` alone. `shaken: true` means it wants a shaker,
// and rewards one — it is the only reason to carry the thing.
export const DRINKS = {
  // ── Hot: the reason a kettle is worth owning ───────────────────────────────
  black_tea: {
    noun: 'tea', vessels: ['mug', 'cup', 'teapot'], hot: true,
    needs: { tea_base: 1, hot_water: [1, 3] },
    optional: ['dairy_cream', 'syrup'],
    nameSlots: ['tea_base'],
    ceiling: 'masterful', difficulty: 3,
    blurb: 'Leaves, hot water, and an argument about the order they went in.',
  },
  cocoa: {
    noun: 'cocoa', vessels: ['mug', 'cup'], hot: true,
    needs: { cocoa_base: 1, dairy_cream: [1, 2] },
    optional: ['syrup', 'hot_water'],
    nameSlots: [],
    ceiling: 'excellent', difficulty: 4,
    blurb: 'Thick enough to stand a spoon in, if you did it properly.',
  },
  black_coffee: {
    noun: 'coffee', vessels: ['mug', 'cup', 'carafe'], hot: true,
    needs: { coffee_base: 1, hot_water: [1, 3] },
    optional: ['syrup'],
    nameSlots: [],
    ceiling: 'excellent', difficulty: 4,
    blurb: 'Black, bitter, and the first honest thing of the day.',
  },
  flat_white: {
    noun: 'flat white', vessels: ['cup', 'mug'], hot: true,
    needs: { coffee_base: [1, 2], dairy_cream: 1 },
    optional: ['syrup'],
    nameSlots: [], nameFormat: 'flat white',
    ceiling: 'masterful', difficulty: 7,
    blurb: 'Two shots and a whisper of foam. The line between this and a latte is real.',
  },
  latte: {
    noun: 'latte', vessels: ['mug', 'cup'], hot: true,
    needs: { coffee_base: 1, dairy_cream: [2, 3] },
    optional: ['syrup', 'cocoa_base'],
    nameSlots: [], nameFormat: 'latte',
    ceiling: 'superb', difficulty: 5,
    blurb: 'Mostly milk, and unashamed about it.',
  },
  // Coffee with a shot in it. Its own template rather than an optional spirit on
  // black_coffee, so the boozy case is strictly MORE specific and the match
  // stays deterministic — the same trick dishes.js pulls with meat_curry.
  laced_coffee: {
    noun: 'coffee', vessels: ['mug', 'cup'], hot: true,
    needs: { coffee_base: 1, base_spirit: [1, 2], hot_water: [1, 2] },
    optional: ['dairy_cream', 'syrup'],
    nameSlots: ['base_spirit'],
    ceiling: 'masterful', difficulty: 6,
    blurb: 'The drink that decides what kind of day this is going to be.',
  },
  toddy: {
    noun: 'hot toddy', vessels: ['mug', 'glass', 'cup'], hot: true,
    needs: { base_spirit: 1, hot_water: [1, 2], juice: [1, 2] },
    optional: ['syrup', 'garnish'],
    nameSlots: [],
    ceiling: 'excellent', difficulty: 5,
    blurb: 'Medicinal in the way that means "I have decided this counts as medicine".',
  },

  // ── Cold, no alcohol required, none forbidden ──────────────────────────────
  // These match on structure, so the same template covers the soft version and
  // the hard one — a "tall juice" and a screwdriver are the same shape, and the
  // strength is derived from what you actually poured. This is the payoff of
  // deriving alcohol instead of authoring it.
  pressed_juice: {
    noun: 'juice', vessels: ['glass', 'tumbler', 'carafe', 'cup'],
    needs: { juice: [2, 4] },
    optional: ['ice', 'syrup', 'garnish'],
    nameSlots: ['juice'],
    ceiling: 'excellent', difficulty: 2,
    blurb: 'Pressed, poured, cold. Nothing clever has been done to it.',
  },
  iced_tea: {
    noun: 'iced tea', vessels: ['glass', 'tumbler'],
    needs: { tea_base: 1, ice: [1, 3] },
    optional: ['juice', 'syrup', 'garnish'],
    nameSlots: [],
    ceiling: 'excellent', difficulty: 3,
    blurb: 'Brewed, chilled, and improved by exactly one slice of something sour.',
  },
  cream_soda: {
    noun: 'float', vessels: ['glass', 'tumbler', 'tankard'],
    needs: { mixer: [2, 3], dairy_cream: [1, 2] },
    optional: ['ice', 'syrup'],
    nameSlots: [],
    ceiling: 'good', difficulty: 3,
    blurb: 'Fizz and cream, doing something structurally alarming and tasting fine.',
  },
  milkshake: {
    noun: 'shake', vessels: ['shaker', 'glass', 'tumbler'], shaken: true,
    needs: { dairy_cream: [2, 4] },
    optional: ['syrup', 'cocoa_base', 'juice', 'ice'],
    nameSlots: [],
    ceiling: 'excellent', difficulty: 4,
    blurb: 'Shaken until it stops being a liquid and starts being a commitment.',
  },
  soda_water: {
    noun: 'soda', vessels: ['glass', 'tumbler', 'cup'],
    needs: { mixer: [1, 3] },
    optional: ['ice', 'garnish', 'syrup'],
    nameSlots: ['mixer'],
    ceiling: 'good', difficulty: 1,
    blurb: 'Cold, loud, and over in a minute.',
  },

  // ── Mixed, and meant to be ─────────────────────────────────────────────────
  highball: {
    noun: 'highball', vessels: ['glass', 'tumbler', 'tankard'],
    needs: { base_spirit: 1, mixer: [2, 4] },
    optional: ['ice', 'garnish', 'juice'],
    nameSlots: ['base_spirit', 'mixer'],
    ceiling: 'excellent', difficulty: 3,
    blurb: 'Spirit, something fizzy, ice. The drink that needs no explaining.',
  },
  sour: {
    noun: 'sour', vessels: ['shaker', 'coupe', 'glass'], shaken: true,
    needs: { base_spirit: [1, 2], juice: [1, 2] },
    optional: ['syrup', 'ice', 'garnish', 'bitters'],
    nameSlots: ['base_spirit'],
    ceiling: 'masterful', difficulty: 7,
    blurb: 'Strong, sour, sweet, in that order and in that proportion.',
  },
  negroni: {
    noun: 'negroni', vessels: ['tumbler', 'glass'],
    keyItems: ['item_gin', 'item_bitter_red'],
    needs: { base_spirit: 1, liqueur: 1, fortified: 1 },
    optional: ['ice', 'garnish'],
    nameSlots: [], nameFormat: 'negroni',
    ceiling: 'masterful', difficulty: 9,
    blurb: 'Equal parts, stirred over one big rock, bitter enough to mean it.',
  },
  martini: {
    noun: 'martini', vessels: ['coupe', 'glass'],
    needs: { base_spirit: [2, 3], fortified: 1 },
    optional: ['garnish', 'bitters', 'ice'],
    nameSlots: [], nameFormat: 'martini',
    ceiling: 'masterful', difficulty: 8,
    blurb: 'Cold, dry, and mostly an excuse to look at a glass.',
  },
  old_fashioned: {
    noun: 'old fashioned', vessels: ['tumbler'],
    needs: { base_spirit: [1, 2], bitters: [1, 2] },
    optional: ['syrup', 'ice', 'garnish'],
    nameSlots: [], nameFormat: 'old fashioned',
    seasoning: 2,
    ceiling: 'masterful', difficulty: 8,
    blurb: 'Spirit, sugar, bitters, ice. Everything else is a different drink.',
  },
  spritz: {
    noun: 'spritz', vessels: ['glass', 'tumbler', 'coupe'],
    needs: { fortified: 1, mixer: [2, 3] },
    optional: ['ice', 'garnish', 'juice'],
    nameSlots: [],
    ceiling: 'excellent', difficulty: 4,
    blurb: 'Bitter, bubbly, and the correct answer to a hot afternoon.',
  },
  creamy_liqueur: {
    noun: 'flip', vessels: ['coupe', 'tumbler', 'shaker'], shaken: true,
    needs: { liqueur: [1, 2], dairy_cream: [1, 2] },
    optional: ['ice', 'syrup', 'cocoa_base'],
    nameSlots: ['liqueur'],
    ceiling: 'superb', difficulty: 6,
    blurb: 'Dessert wearing a drink as a disguise, and fooling nobody.',
  },
  neat_pour: {
    noun: 'measure', vessels: ['tumbler', 'glass', 'coupe'],
    needs: { base_spirit: [1, 3] },
    optional: ['ice'],
    nameSlots: ['base_spirit'],
    ceiling: 'excellent', difficulty: 1,
    blurb: 'No mixing was involved and none was wanted.',
  },
  wine_pour: {
    noun: 'glass of wine', vessels: ['coupe', 'glass', 'carafe'],
    needs: { wine: [1, 4] },
    optional: ['ice'],
    nameSlots: [],
    ceiling: 'excellent', difficulty: 1,
    blurb: 'Poured with the confidence of someone not being asked about the vintage.',
  },
  beer_pour: {
    noun: 'pint', vessels: ['tankard', 'glass'],
    needs: { beer_base: [1, 4] },
    optional: [],
    nameSlots: ['beer_base'],
    ceiling: 'excellent', difficulty: 2,
    blurb: "Poured badly it's foam; poured well it carries the evening.",
  },
};

// The always-available fallback, and the reason the catalogue can stay small.
// One spirit and one mixer in anything is ALWAYS a real drink, named off its
// parts. It has NO key, which is what keeps it out of the recipe book — nothing
// is learned by pouring rum into cola, and rightly so. Named drinks outrank it
// by the ordinary specificity rule.
export const GENERIC_MIXED = {
  noun: 'mixed drink',
  vessels: null,
  needs: {},
  optional: null,   // null, not [] — see matchScore: the fallback allows anything
  nameSlots: ['base_spirit', 'mixer', 'juice', 'liqueur', 'tea_base', 'coffee_base'],
  seasoning: 1,
  ceiling: 'very good',
  difficulty: 2,
  blurb: 'Two things in a glass that get on well enough.',
};

export const UNKNOWN_DRINK = {
  noun: 'sludge',
  vessels: null,
  needs: {},
  optional: null,
  nameSlots: [],
  ceiling: SLOP_CEILING,
  difficulty: 2,
  blurb: "Wet. Drinkable in the sense that it'll go down.",
};

// ---------------------------------------------------------------------------
// Signature
// ---------------------------------------------------------------------------

// The multiset of profiles in a vessel, as { profileName: pours }. Rows whose
// profile is missing or unknown are counted under `unprofiled` and fail every
// template — an untagged thing in a glass means sludge, which is the honest
// answer until somebody tags it.
//
// There is no `ALSO` channel here, unlike cooking. Cooking needed one because
// milk is genuinely two things at once on two different clocks; nothing in a
// glass has that problem yet, and inventing the channel before something needs
// it would be inventing a rule with no case behind it.
export function signature(rows) {
  const sig = {};
  for (const r of rows || []) {
    const name = profileNameFor(r);
    const key = name || 'unprofiled';
    sig[key] = (sig[key] || 0) + poursOf(r);
  }
  return sig;
}

const range = need => (Array.isArray(need) ? need : [need, need]);

// Pours are counted, not weighed, so an authored count means what it says and
// the tolerance is much tighter than cooking's. Two measures is two measures;
// four is a different drink.
export const POUR_TOLERANCE_LOW = 0.9;
export const POUR_TOLERANCE_HIGH = 1.4;
const matchRange = need => {
  const [lo, hi] = range(need);
  return [lo * POUR_TOLERANCE_LOW, hi * POUR_TOLERANCE_HIGH];
};

// A named drink outranks every class-matched one, unconditionally — the same
// floor dishes.js uses, and for the same reason: a real-world drink is defined
// by a specific thing being in it. A negroni without the red bitter is a martini
// with ideas.
export const KEY_DRINK_FLOOR = 100;

// Does this signature satisfy this template? Returns specificity on a match
// (how much the template accounts for), or -1 on no match. Specificity is the
// tiebreak: the template demanding the most wins, so a negroni beats a
// neat_pour that ignores the vermouth.
export function matchScore(sig, template, itemIds = new Set()) {
  if (template.keyItems?.length) {
    for (const id of template.keyItems) if (!itemIds.has(id)) return -1;
  }
  let required = template.keyItems?.length ? KEY_DRINK_FLOOR + template.keyItems.length : 0;
  for (const [profile, need] of Object.entries(template.needs)) {
    const [min, max] = matchRange(need);
    const have = sig[profile] || 0;
    if (have < min - 1e-9 || have > max + 1e-9) return -1;
    required += have;
  }
  // Anything in the glass that is neither needed nor optional fails the match.
  // You cannot smuggle cream into a negroni.
  //
  // `optional: null` means "anything goes" and is the fallback template's whole
  // trick — it has no requirements to satisfy and no opinion about what else is
  // in there, so it can catch a combination the catalogue has never heard of.
  if (template.optional !== null) {
    const allowed = new Set([...Object.keys(template.needs), ...(template.optional || [])]);
    for (const profile of Object.keys(sig)) {
      if (!allowed.has(profile)) return -1;
    }
  } else if (sig.unprofiled) {
    return -1;   // even the fallback draws the line at a brick in the glass
  }
  // Fractional tiebreak on difficulty, always under 1 so it can never overturn a
  // genuine specificity difference.
  return required + Math.min(999, template.difficulty || 0) / 1000;
}

/**
 * The best template for a vessel's contents, or null for sludge.
 *
 * `opts.kind`  — the vessel's tags.drinkware_kind. A template naming kinds
 *                requires one of them; `vessels: null` accepts any.
 * `opts.hot`   — whether this was brewed at an appliance. A `hot` template is
 *                unreachable without one, which is the whole appliance gate.
 */
export function matchDrink(sig, opts = {}) {
  const { kind = null, hot = false, itemIds = new Set() } = opts;
  const ids = itemIds instanceof Set ? itemIds : new Set(itemIds || []);
  let best = null, bestScore = -1, bestKey = null;
  for (const [key, t] of Object.entries(DRINKS)) {
    if (t.hot && !hot) continue;             // needs a kettle you haven't got
    if (!t.hot && hot) { /* brewing a cold recipe is fine — it's just warm */ }
    if (t.vessels && kind && !t.vessels.includes(kind)) continue;
    if (t.vessels && !kind) continue;        // a bare pour is not a coupe
    const score = matchScore(sig, t, ids);
    if (score > bestScore) { best = t; bestScore = score; bestKey = key; }
  }
  if (best) return { key: bestKey, template: best, specificity: bestScore };
  // The generic fallback, if the glass at least holds two things that mix.
  const g = matchScore(sig, GENERIC_MIXED, ids);
  const parts = Object.keys(sig).filter(k => k !== 'unprofiled' && !isModifierProfile(k));
  if (g >= 0 && parts.length >= 2) return { key: null, template: GENERIC_MIXED, specificity: g };
  return null;
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

const STATE_WORDS = /\b(bottle of|can of|carton of|chilled|cold|iced)\b\s*/gi;

export function nounFor(row) {
  const declared = (row?.tags || {}).drink_noun;
  if (typeof declared === 'string' && declared.trim()) return declared.trim().toLowerCase();
  return String(row?.name || 'something').replace(STATE_WORDS, '').trim().toLowerCase();
}

// "gin and tonic highball". At most two nouns, in nameSlots order, deduped.
export function drinkName(template, rows) {
  const byProfile = new Map();
  for (const r of rows || []) {
    const p = profileNameFor(r);
    if (!p) continue;
    if (!byProfile.has(p)) byProfile.set(p, []);
    byProfile.get(p).push(r);
  }
  const nouns = [];
  for (const slot of template.nameSlots || []) {
    for (const r of byProfile.get(slot) || []) {
      const n = nounFor(r);
      if (n && !nouns.includes(n)) { nouns.push(n); break; }
    }
    if (nouns.length >= 2) break;
  }
  if (template.nameFormat) {
    return template.nameFormat
      .replace(/\{(\d+)\}/g, (_, i) => nouns[Number(i)] || '')
      .replace(/\s+/g, ' ').trim();
  }
  if (!nouns.length) return template.noun;
  return `${nouns.join(' and ')} ${template.noun}`;
}

// ---------------------------------------------------------------------------
// Quality composition
// ---------------------------------------------------------------------------

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

export function seasoningIdeal(template) {
  if (Number.isInteger(template.seasoning)) return template.seasoning;
  let required = 0;
  for (const [profile, need] of Object.entries(template.needs || {})) {
    if (isModifierProfile(profile)) required += range(need)[0];
  }
  return Math.max(DEFAULT_SEASONING, required);
}

export function seasoningBonus(template, count) {
  const ideal = seasoningIdeal(template);
  const under = Math.min(count, ideal);
  const over = Math.max(0, count - ideal);
  return Math.min(MODIFIER_BONUS_CAP, under * MODIFIER_BONUS) - over * OVER_SEASON_PENALTY;
}

// The best band a drink can possibly reach: every required ingredient at its own
// profile's ceiling, composed, with every bonus a player could actually earn on
// that drink. A template whose stated ceiling sits above this advertises a band
// nobody can ever pour, which the recipe card would then display as a target
// forever.
//
// The bonuses counted here are exactly the ones the resolve path applies, and
// each is genuinely earnable: knowing the recipe, a good skill roll, seasoning
// it right, shaking a shaken drink in a real shaker, and brewing a hot one on
// the best appliance in the game. Nothing here is theoretical.
export function bestPossibleBand(template, bonus = KNOWN_RECIPE_BONUS, opts = {}) {
  const { maxSkill = 2, shaken = SHAKEN_BONUS, brew = BEST_BREW_BONUS } = opts;
  const bands = [];
  let mods = 0;
  for (const [profile, need] of Object.entries(template.needs || {})) {
    const p = DRINK_PROFILES[profile];
    if (!p) return null;
    const [min] = range(need);
    if (p.modifier) { mods += min; continue; }
    if (p.medium) continue;   // water and ice fill the glass; they don't score it
    for (let i = 0; i < Math.max(1, Math.round(min)); i++) bands.push(p.raw);
  }
  if (!bands.length) return null;
  let earned = bonus + seasoningBonus(template, mods) + maxSkill;
  if (template.shaken) earned += shaken;
  if (template.hot) earned += brew;
  return composeBand(bands, template, earned);
}

// ---------------------------------------------------------------------------
// How a recipe READS
// ---------------------------------------------------------------------------
//
// The catalogue is stored as classes — `base_spirit: 1, mixer: [2,4]` — because
// that is what makes it extensible. But nobody wants to read that. A pour is a
// defined 25ml (config.POUR_ML), so a `needs` entry converts to real measures
// with no extra authoring, and the method line falls out of the flags a template
// already carries. This is presentation over the same data, not a second copy of
// the recipe that can drift out of step with the first.

const MEASURE_WORD = n => (n === 1 ? 'measure' : 'measures');

// "2 measures (50ml) of spirit", or "2–4 measures (50–100ml) of mixer".
export function measureLine(profile, need, pourMl) {
  const [lo, hi] = range(need);
  const label = DRINK_PROFILES[profile]?.label || profile;
  const count = lo === hi ? `${lo} ${MEASURE_WORD(lo)}` : `${lo}–${hi} measures`;
  const ml = lo === hi ? `${lo * pourMl}ml` : `${lo * pourMl}–${hi * pourMl}ml`;
  // Modifiers are dashes, not measures. Two dashes of bitters is not 50ml of
  // bitters and printing it that way would teach the wrong lesson.
  if (isModifierProfile(profile)) {
    return lo === hi ? `${lo} dash${lo === 1 ? '' : 'es'} of ${label}` : `${lo}–${hi} dashes of ${label}`;
  }
  return `${count} (${ml}) of ${label}`;
}

// The method, derived rather than authored: hot means brewed, `shaken` means
// shaken, a bitters-forward short drink is stirred, everything else is built in
// the glass. Same rules a real bar runs on, and no template had to say so.
export function methodOf(template) {
  if (template.hot) return 'Brewed';
  if (template.shaken) return 'Shaken';
  const short = Object.values(template.needs || {}).every(n => range(n)[1] <= 2);
  const hasBitters = Object.keys(template.needs || {}).some(isModifierProfile);
  return (short && hasBitters) ? 'Stirred' : 'Built in the glass';
}

/**
 * A full, readable recipe card. `pourMl` is injected rather than imported so
 * this file stays free of config coupling and regress can assert the arithmetic
 * against a known measure.
 */
export function describeRecipe(key, template, pourMl = 25) {
  const t = template || DRINKS[key];
  if (!t) return null;
  const lines = [];
  const glass = t.vessels ? t.vessels.join(' or ') : 'anything to hand';
  lines.push(`<span class="text-accent">${t.noun.toUpperCase()}</span>`);
  lines.push(`<span class="text-dim">${t.blurb}</span>`);
  lines.push('');
  for (const [profile, need] of Object.entries(t.needs || {})) {
    lines.push(`  · ${measureLine(profile, need, pourMl)}`);
  }
  const opt = (t.optional || []).map(p => DRINK_PROFILES[p]?.label || p);
  if (opt.length) lines.push(`  <span class="text-dim">optional: ${opt.join(', ')}</span>`);
  lines.push('');
  lines.push(`<span class="text-dim">Method:</span> ${methodOf(t)}`);
  lines.push(`<span class="text-dim">Serve in:</span> ${glass}`);
  if (t.hot) lines.push(`<span class="text-dim">Needs:</span> a kettle or better`);
  if (t.keyItems?.length) lines.push(`<span class="text-dim">Won't work without:</span> the right bottle`);
  lines.push(`<span class="text-dim">Difficulty:</span> ${t.difficulty}/10 · <span class="text-dim">best possible:</span> ${bestPossibleBand(t) || '—'}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Validation — the sanity gate regress asserts. This is what a hand-edited or
// generated catalogue gets checked against.
// ---------------------------------------------------------------------------
export function validateDrinks(drinks = DRINKS) {
  const errors = [];
  const fingerprints = new Map();

  for (const [key, t] of Object.entries(drinks)) {
    const at = f => `${key}.${f}`;
    if (!t.noun) errors.push(`${at('noun')} is missing`);
    if (!QUALITY_BANDS.includes(t.ceiling)) errors.push(`${at('ceiling')} isn't a quality band — got ${t.ceiling}`);
    if (!Number.isFinite(t.difficulty) || t.difficulty < 1) errors.push(`${at('difficulty')} must be >= 1 — got ${t.difficulty}`);
    if (!t.blurb) errors.push(`${at('blurb')} is missing — every drink says something about itself`);

    if (t.vessels !== null && t.vessels !== undefined) {
      if (!Array.isArray(t.vessels) || !t.vessels.length) errors.push(`${at('vessels')} must be a non-empty array or null`);
      else for (const v of t.vessels) {
        if (!DRINKWARE_KINDS.includes(v)) errors.push(`${at('vessels')} names an unknown drinkware kind "${v}"`);
      }
    }
    // A shaken template that can't be built in a shaker rewards a bonus nobody
    // can ever earn.
    if (t.shaken && Array.isArray(t.vessels) && !t.vessels.includes('shaker')) {
      errors.push(`${at('shaken')} is set but 'shaker' isn't among its vessels — the bonus would be unreachable`);
    }

    for (const [profile, need] of Object.entries(t.needs || {})) {
      if (!DRINK_PROFILES[profile]) errors.push(`${at('needs')} names an unknown profile "${profile}"`);
      const [lo, hi] = range(need);
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo <= 0 || hi < lo) {
        errors.push(`${at('needs')}.${profile} must be a positive count or [min,max] — got ${JSON.stringify(need)}`);
      }
    }
    for (const profile of t.optional || []) {
      if (!DRINK_PROFILES[profile]) errors.push(`${at('optional')} names an unknown profile "${profile}"`);
      if (t.needs?.[profile]) errors.push(`${at('optional')} lists "${profile}", which it already requires`);
    }

    // At most two nouns read as a name; a third is never reached and hides a
    // mistake about which slot the author meant.
    if ((t.nameSlots || []).length > 2 && !t.nameFormat) {
      errors.push(`${at('nameSlots')} has more than two entries and no nameFormat — only the first two can ever be used`);
    }
    for (const slot of t.nameSlots || []) {
      if (!DRINK_PROFILES[slot]) errors.push(`${at('nameSlots')} names an unknown profile "${slot}"`);
    }
    if (t.nameFormat) {
      const wanted = [...String(t.nameFormat).matchAll(/\{(\d+)\}/g)].map(m => Number(m[1]));
      for (const i of wanted) {
        if (i >= (t.nameSlots || []).length) errors.push(`${at('nameFormat')} uses {${i}} but only ${(t.nameSlots || []).length} nameSlots are declared`);
      }
    }

    // A ceiling nobody can reach is a promise the Cookbook would display forever.
    const best = bestPossibleBand(t);
    if (best && bandIndex(best) < bandIndex(t.ceiling)) {
      errors.push(`${at('ceiling')} is ${t.ceiling}, but the best reachable band is ${best} — no player could ever pour it`);
    }

    // Two templates with the same vessels AND the same needs can never both be
    // reached: one of them is dead the day it's written.
    const fp = JSON.stringify([[...(t.vessels || ['*'])].sort(), Object.entries(t.needs || {}).sort(), !!t.hot]);
    if (fingerprints.has(fp)) errors.push(`${key} is unreachable — it has the same vessels+needs as ${fingerprints.get(fp)}`);
    else fingerprints.set(fp, key);
  }
  return { ok: errors.length === 0, errors };
}
