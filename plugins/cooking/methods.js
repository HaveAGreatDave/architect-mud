// METHODS — `boil noodles`, `fry the egg`, `roast the shoulder`.
//
// The system has exactly one heat verb, `cook`, and infers the method from the
// vessel: a pot of stock and meat is a stew, a pan of one cut is a sear, a tray
// is a roast. That is a good inference and none of it changes here.
//
// What it left the player with is a vocabulary problem. To boil pasta you have
// to already know the sequence — find a pot, put the pasta in it, `fill` it at a
// tap, `cook` it, `drain` it — and none of those four words is `boil`. Typing
// the word you actually have in your head got `Unknown command: boil`, which
// reads as "this game cannot boil things" rather than as "this game spells it
// differently". Every ingredient, every dish and every bit of depth was already
// there behind a vocabulary nobody is born knowing.
//
// So a method is a STATEMENT OF INTENT that does the setup. It is the inverse of
// the vessel inference: name the method and it picks the pan, the heat and the
// water, then hands over to the ordinary `cook`.
//
//     THE METHOD DECIDES SETUP. IT NEVER DECIDES OUTCOME.
//
// That line is what stops this becoming a second cooking system. `boil steak`
// works, and produces a grey, sad steak, because `dense_meat` wants a hard sear
// then a drop and a flat rolling boil scores badly against its heat curve —
// arithmetic that was already there. There is no table of wrong methods, no
// refusal, and nothing here that knows what a steak is. Cook it wrong and the
// existing scoring says so, in the band, which is where the game already says
// everything else about how well you cooked.
//
// TWO THINGS IT WILL FETCH FOR YOU, AND A HARD LINE UNDER THEM. It finds
// EQUIPMENT (the pot you own but haven't got out) and it runs the TAP (water is
// free, and `cooking_medium` means it is invisible to the dish anyway). It never
// adds an INGREDIENT. A method that quietly tipped your last oil into the pan
// because a sear wants fat would be spending your things on a guess, and the
// player would find out at the shop.
//
// Pure: a name in, a row out. The orchestration lives in index.js next to the
// verbs it composes, because the whole point is that it composes them rather
// than reimplementing any of them.

// `vessel` is the tags.vessel_kind the method wants, or null for a bare stove.
// `heat` is the burner setting it asks for afterwards — a request, not a
// requirement, because a hotplate that only does `low` should still boil, badly.
// `medium` says the method is one that happens IN water: the pan gets filled if
// it holds nothing wet already.
//
// `needs` is the refusal line for when the vessel isn't to hand, and it is the
// only teaching this file does. It names the pan rather than explaining the
// system, because "roasting wants a tray" is a thing a person says.
export const METHODS = {
  boil: {
    vessel: 'pot', heat: 'high', medium: true,
    gerund: 'Boiling', needs: 'Boiling wants a pot',
    dry: 'Boiling needs water, and there is no tap here and nothing wet in the pot.',
  },
  simmer: {
    vessel: 'pot', heat: 'low', medium: true,
    gerund: 'Simmering', needs: 'A simmer wants a pot',
    dry: 'Nothing to simmer in — no tap here, and the pot is dry.',
  },
  poach: {
    vessel: 'pot', heat: 'low', medium: true,
    gerund: 'Poaching', needs: 'Poaching wants a pot',
    dry: 'Poaching is a thing you do in liquid. There is none here and none in the pot.',
  },
  steam: {
    vessel: 'pot', heat: 'mid', medium: true,
    gerund: 'Steaming', needs: 'Steaming wants a pot',
    dry: 'No water, no steam. There is no tap here and the pot is dry.',
  },
  // A stew is a long low pot, which is what the pot family already infers. The
  // word is here because people type it.
  stew: {
    vessel: 'pot', heat: 'low', medium: true,
    gerund: 'Stewing', needs: 'Stewing wants a pot',
    dry: 'A stew needs stock or water in it, and there is no tap here.',
  },
  fry: {
    vessel: 'pan', heat: 'high', medium: false,
    gerund: 'Frying', needs: 'Frying wants a pan',
  },
  sear: {
    vessel: 'pan', heat: 'high', medium: false,
    gerund: 'Searing', needs: 'Searing wants a pan',
  },
  saute: {
    vessel: 'pan', heat: 'mid', medium: false,
    gerund: 'Sauteing', needs: 'A saute wants a pan',
  },
  bake: {
    vessel: 'tray', heat: 'mid', medium: false,
    gerund: 'Baking', needs: 'Baking wants a tray',
  },
  roast: {
    vessel: 'tray', heat: 'high', medium: false,
    gerund: 'Roasting', needs: 'Roasting wants a tray',
  },
  // The two that want no vessel at all. Bread goes straight on the plate of the
  // stove and so does a chop over a grill — `cook <food>` with no pan has always
  // worked and has always been the worse way to cook most things, which is
  // exactly right for both of these.
  grill: {
    vessel: null, heat: 'high', medium: false,
    gerund: 'Grilling', needs: null,
  },
  toast: {
    vessel: null, heat: 'mid', medium: false,
    gerund: 'Toasting', needs: null,
  },
};

// The spellings. `sauté` and `saute` are one method; `braise` is a simmer and
// `bake` covers `oven`. Kept as an alias map rather than as duplicate rows so
// there is one row per method and the retune surface stays the row.
export const METHOD_ALIASES = {
  'sauté': 'saute',
  'brown': 'sear',
  'braise': 'simmer',
  'boil up': 'boil',
  'deep fry': 'fry',
  'pan fry': 'fry',
  'stir fry': 'saute',
  'oven': 'bake',
  'barbecue': 'grill',
  'bbq': 'grill',
  'griddle': 'grill',
};

export const methodNames = () => Object.keys(METHODS);

export function methodFor(word) {
  const w = String(word || '').trim().toLowerCase();
  const key = METHOD_ALIASES[w] || w;
  return METHODS[key] ? { key, ...METHODS[key] } : null;
}

// ── WHICH METHODS SUIT A THING ───────────────────────────────────────────────
//
// For the HUD, and for the HUD only. Every method works on everything — that is
// the point of the outcome rule above, and `boil steak` stays a legal sentence
// you can type — so this is not a gate and nothing in the verb path reads it.
// It answers a different and much narrower question: of the twelve, which few
// are worth OFFERING beside a rat haunch.
//
// ⚠ IT HAS TO BE SHORT, and that is a display constraint rather than taste. The
// panel collapses these behind one control, but the two lower Display Mode rungs
// print a row's actions FLAT — so twelve methods on every ingredient is a wall
// of links in the log for somebody who cannot collapse anything. Four-ish per
// profile keeps that rung readable, and the twelfth method is still one typed
// word away.
//
// Keyed on the ingredient's own profile, so a food authored next month with an
// existing profile gets its methods the day it lands, with no edit here.
const BY_PROFILE = {
  dense_meat: ['sear', 'fry', 'roast', 'grill', 'stew'],
  preserved: ['fry', 'grill', 'stew'],
  egg: ['fry', 'poach', 'boil'],
  dry_starch: ['boil'],
  starchy_vegetable: ['boil', 'roast', 'fry', 'mash'],
  soft_vegetable: ['fry', 'saute', 'roast', 'boil'],
  fruit: ['bake', 'poach', 'fry'],
  liquid: ['simmer', 'boil', 'stew'],
  dairy: ['fry', 'bake'],
  batter: ['bake', 'fry'],
  bread: ['toast', 'grill', 'bake'],
  // Modifiers never take a cook session of their own — they season what is
  // cooking beside them — so offering to roast a bulb of garlic on its own is
  // offering to turn it into cinders. Deliberately empty.
  fat_or_oil: [],
  aromatic: [],
};

// The pan decides more than the food does once the food is IN it, so a vessel
// gets its methods from its own kind. A pot of stock and meat wants simmering;
// the same contents in a tray want roasting.
const BY_VESSEL = {
  pot: ['boil', 'simmer', 'stew', 'poach', 'steam'],
  pan: ['fry', 'sear', 'saute'],
  tray: ['bake', 'roast'],
  bread: ['toast', 'grill'],
  // A bowl never sees heat — it is assembled in, and `plate` is its whole ending.
  bowl: [],
};

// `mash` is in the starchy list above and is NOT a method — it is what a bowl
// does, and naming it there would offer a verb that does not exist. Filtered
// here rather than removed from the table, because the table reads as the list
// of things you would actually do to a potato and that is worth keeping true.
const real = keys => keys.filter(k => METHODS[k]);

export const methodsForProfile = profile => real(BY_PROFILE[profile] || []);
export const methodsForVessel = kind => real(BY_VESSEL[kind] || []);

// What the player could have typed instead. Printed dim under every method, and
// it is the whole reason this doesn't just hide the system behind one more verb:
// a player who boils pasta four times has read `fill` and `cook` four times and
// knows the long way round without ever having been made to look it up.
//
// These are the real command strings, built from the real names, so a player can
// copy any line out of the transcript and it will do the same thing.
export function stepLine(step) {
  return `<span class="text-dim">  ${step}</span>`;
}
