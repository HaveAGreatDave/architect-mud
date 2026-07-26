// Tunable balance knobs for the cooking system — weight/thaw-based duration
// math and the generic (non-item-specific) stage narration. Plugin-local
// config, same choice as the preservation system's decay rates.

// BAND_SCALE — how many rungs of the quality ladder one "point" of score buys.
// The scale went from 5 bands (span 4) to 9 (span 8), so every constant in this
// file denominated in BANDS doubles with it. Expressed as a factor rather than
// baked into the numbers so the original hand-tuned values stay readable, and a
// future change of resolution is one edit instead of seventeen.
//
// Declared FIRST because half the constants below multiply by it, and a `const`
// referenced above its own declaration is a temporal-dead-zone throw at import.
export const BAND_SCALE = 2;

// Cooking is timed in REAL seconds, not game-minutes — same convention as the
// combat tick and the minigame windows, and deliberately off the `timeScale`
// seam (docs/systems-world.md). At the world's 3x clock that means a 2-minute
// roast already spans ~6 game-minutes, which reads right in fiction while
// staying a real decision at the keyboard rather than a reflex.
//
// This is the master duration knob: everything else — the peak window, the
// forgiving band, the burn point — is a fraction of the cook time, so raising
// it lengthens the windows in proportion and makes timing less twitchy, not
// more punishing.
export const COOK_SECONDS_PER_KG = 360;  // a 1kg cut takes 6 min on a 1.0x (low) stove
export const THAW_SECONDS_PER_KG = 180;  // frozen food thaws before the cook clock starts

// PORTIONS — half an onion is an onion cut in half.
//
// A portioned ingredient is a fraction of the whole: it weighs proportionally
// less, so it COOKS proportionally faster, and it feeds you proportionally less.
// That second half is what stops chopping being a free doubling of your larder —
// two halves are exactly one onion however you slice them.
//
// The first half is the point of the feature: cook time scales with weight, so
// chopping is how you make a slow ingredient finish alongside a fast one. It's
// the difference between staging (start it earlier) and prep (make it smaller).
export const PORTION_NAMES = { 0.5: 'half', 0.25: 'a quarter of', 0.125: 'an eighth of' };
export const MIN_PORTION = 0.125;      // past this it's mince, and mince is its own item
export const MAX_CHOP_PIECES = 4;      // one cut into halves, quarters, or eighths

// FOND — the browned residue a good sear leaves in a pan, and the first thing
// in this system that connects one cook to the next. Everything else is
// self-contained: a vessel has no memory of what was in it five minutes ago.
// Fond is that memory, and it is why the order you cook things in starts to
// matter across vessels and not just within one.
//
// It forms when something BROWNS: a meat or a batter, on real heat, cooked at
// least reasonably well. Boiling a broth leaves nothing behind.
export const FOND_PROFILES = ['dense_meat', 'preserved', 'batter'];
export const FOND_MIN_BAND = 'good';       // a burnt sear leaves carbon, not fond
export const FOND_VESSELS = ['pan', 'tray'];
export const FOND_BONUS = 0.75 * BAND_SCALE;            // worth more than any seasoning: it is a technique
export const FOND_RESIDUE_PENALTY = -0.5 * BAND_SCALE;  // what NOT lifting it costs the next cook

// Fond does not keep. Left in the pan it dries to residue, and residue is a
// penalty until the pan is scoured. Long enough to finish the dish you were
// making, nowhere near long enough to save it for tomorrow.
export const FOND_LIFE_MS = 15 * 60 * 1000;

// SMOKING. A smoker is not a slow stove — it's a different process with a
// different output: meat goes in raw and comes out PRESERVED, which is what
// makes it worth the wait. Very low and very long, and correspondingly hard to
// ruin: the window is enormous, so it's the one cook you can start and leave.
export const SMOKER_SPEED = 0.12;        // ~8x longer than the slowest stove
export const SMOKER_PEAK_MULT = 2.5;     // and a window to match
export const SMOKER_PROFILE = 'preserved';

// Appliance speed multipliers — higher is faster.
export const STOVE_SPEED = { low: 1.0, mid: 1.5, high: 2.5 };
export const PORTABLE_OVEN_SPEED = 0.8;   // slower than even the low-end stove
export const PORTABLE_OVEN_CAPACITY_G = 1500; // hard cap — "small amounts only"

// Generic stage narration, shared by every food item (no item-specific text).
// Checked top-down by elapsed fraction of the relevant segment; first match wins.
export const THAW_STAGES = [
  { max: 0.5, text: 'still frozen solid' },
  { max: 1.0, text: 'thawing out, edges gone soft' },
];
export const COOK_STAGES = [
  { max: 0.20, text: 'raw, glistening' },
  { max: 0.45, text: 'starting to sizzle at the edges' },
  { max: 0.70, text: 'browning nicely, the smell filling the room' },
  { max: 1.00, text: 'cooked through, a faint char forming' },
];

// What a food LOOKS like at each point in its life on the heat, per profile.
//
// Two rules hold across every table here:
//
//  1. They are COMPLEMENTS, not sentences — "dark and tight at the edges", never
//     "it has gone dark". The same string has to read correctly as "It's <x>."
//     on examine and as "The beef offcut is <x>." in a push, so it cannot carry
//     its own subject or verb.
//  2. They are observational, never instructional. Nothing here says "ready" or
//     "take it off". The player is told what they can see and decides what it
//     means, which is the difference between a cooking system and a progress bar.

// During the cook, by fraction elapsed. Falls back to COOK_STAGES for any
// profile without its own set (and for unprofiled food, which has no profile).
export const STAGE_LINES = {
  dense_meat: [
    { max: 0.20, text: 'raw and glistening' },
    { max: 0.45, text: 'starting to sizzle at the edges' },
    { max: 0.70, text: 'browning hard, the fat beginning to render' },
    { max: 1.00, text: 'seared through, a crust forming' },
  ],
  liquid: [
    { max: 0.20, text: 'cold and still' },
    { max: 0.45, text: 'ticking as it warms, a thread of steam coming off it' },
    { max: 0.70, text: 'rolling, with a scum rising at the rim' },
    { max: 1.00, text: 'down to a working simmer' },
  ],
  starchy_vegetable: [
    { max: 0.20, text: 'raw and waxy' },
    { max: 0.45, text: 'darkening at the cut faces' },
    { max: 0.70, text: 'softening, and giving off a floury smell' },
    { max: 1.00, text: 'tender near the edge, firm at the centre' },
  ],
  soft_vegetable: [
    { max: 0.20, text: 'crisp and raw' },
    { max: 0.45, text: 'wilting at the edges' },
    { max: 0.70, text: 'slackening, giving up water into the pan' },
    { max: 1.00, text: 'limp and gone half translucent' },
  ],
  batter: [
    { max: 0.20, text: 'wet and slack' },
    { max: 0.45, text: 'bubbling across the surface' },
    { max: 0.70, text: 'setting from the outside in' },
    { max: 1.00, text: 'firm at the rim and gold underneath' },
  ],
  egg: [
    { max: 0.20, text: 'clear and running' },
    { max: 0.45, text: 'going opaque at the edges' },
    { max: 0.70, text: 'setting inward from the rim' },
    { max: 1.00, text: 'nearly matt across the top' },
  ],
  fruit: [
    { max: 0.20, text: 'firm and raw' },
    { max: 0.45, text: 'softening, sweating a little juice' },
    { max: 0.70, text: 'slumping, and the juice is thickening' },
    { max: 1.00, text: 'catching gold where it touches the metal' },
  ],
  preserved: [
    { max: 0.20, text: 'hard and salt-crusted' },
    { max: 0.45, text: 'softening, giving up its salt' },
    { max: 0.70, text: 'plumping as it takes the heat' },
    { max: 1.00, text: 'warmed through and gone glossy' },
  ],
};

// The window opens.
export const PEAK_LINES = {
  dense_meat: 'dark and tight at the edges, the fat running clear',
  liquid: 'settled into a slow, clouded simmer',
  starchy_vegetable: 'soft enough to take a knife without argument',
  soft_vegetable: 'slumped and glossy',
  batter: 'set around the rim and no longer bubbling in the middle',
  egg: 'just turned from wet to matt',
  fruit: 'collapsing a little, catching gold where it touches the metal',
  preserved: 'softened, and letting go of some of its salt',
  _: 'holding steady',
};

// Still in the window, but the back half of it. The tell is subtle on purpose:
// this is the only signal for WHERE inside the peak window you are, and reading
// it is worth about 0.4 of the 0.5 available for precision.
export const SLIPPING_LINES = {
  dense_meat: 'still dark and glossy, though the edges have begun to draw in',
  liquid: 'thickening, and the simmer has gone quiet at the rim',
  starchy_vegetable: 'soft all the way through, the skin starting to split',
  soft_vegetable: 'glossy still, but a shade duller than it was',
  batter: 'gold underneath and darkening where it meets the pan',
  egg: 'matt through, and just starting to firm at the rim',
  fruit: 'holding its shape, but only just, and the pan is browning',
  preserved: 'soft right through and gone a deeper brown',
  _: 'about as good as it is going to get',
};

// The window has closed.
export const FADING_LINES = {
  dense_meat: 'tightening up, and the smell has gone from rich to sharp',
  liquid: 'reduced past thick, and starting to catch on the bottom',
  starchy_vegetable: 'going floury at the edges and losing its shape',
  soft_vegetable: 'gone from glossy to grey',
  batter: 'gone from gold to brown, and still going',
  egg: 'gone rubbery, and beginning to weep',
  fruit: 'giving off sugar that has turned from sweet to acrid',
  preserved: 'gone leathery and dark at the edges',
  _: 'past whatever it was',
};

export const lineFor = (table, profileName) => table[profileName] || table._;
export const stagesFor = (profileName) => STAGE_LINES[profileName] || COOK_STAGES;

// Stages *past* the peak window — only reachable by profiled food, which is the
// only food that has a peak window to be past. Same shape as the two above.
export const OVER_STAGES = [
  { max: 0.5, text: 'past its best, going dry' },
  { max: 1.0, text: 'starting to char, smoke curling off it' },
];

// Vessels. A pan or pot is an ordinary carried container with tags.vessel;
// `heat_distribution` widens the forgiving band past the peak, `heat_retention`
// widens the peak window itself. Cooking straight on the stove with no vessel
// works, but these are the numbers it gets — noticeably worse than a cheap pan.
export const BARE_VESSEL = { d: 0.35, r: 0.30 };
export const DEFAULT_VESSEL = { d: 0.60, r: 0.50 }; // a vessel that declares neither

// Quality scoring weights (see quality.js). BASE_OFFSET is what every cook
// starts down by: the target band is a ceiling, and this is how far below it you
// begin before heat/vessel/handling/timing/skill claw you back up.
export const BASE_OFFSET = -2.2 * BAND_SCALE;
export const HEAT_SCORE = { exact: 0.4 * BAND_SCALE, oneOff: -0.4 * BAND_SCALE, twoOff: -1.0 * BAND_SCALE };
export const PRECISION_WEIGHT = 0.5 * BAND_SCALE;   // max bonus for pulling it mid-peak
export const VESSEL_WEIGHT = 1.2 * BAND_SCALE;      // × (d + r − 1)
export const SKILL_WEIGHT = 0.6 * BAND_SCALE;       // × clamp(margin/20, −1, 1)
export const TURN_IDEAL_BONUS = 0.5 * BAND_SCALE;   // hitting the ideal number of turns
export const TURN_SPACING_BONUS = 0.3 * BAND_SCALE; // …and spacing them evenly
export const TURN_MISS_PENALTY = 0.6 * BAND_SCALE;  // per turn over/under the ideal
export const FUSS_PENALTY = 0.7 * BAND_SCALE;       // per handling act on a turns:0 food
export const SCORE_FLOOR = -3.0 * BAND_SCALE;       // clamp on the summed modifiers

// Dishes (see dishes.js). How a dish's band composes from its ingredients':
// the mean pulled toward the worst ingredient. One mediocre potato dents a
// stew; it shouldn't sink it. 0 = pure mean, 1 = the worst decides everything.
export const WORST_PULL = 0.45;

// A combination no dish template claims still feeds you, and no more than that.
export const SLOP_CEILING = 'acceptable';

// The whole mechanical value of having a recipe in your cookbook: a sub-band
// nudge that tips rounding your way. Deliberately small — knowing a recipe must
// never be worth more than cooking it well, or the cookbook becomes the game.
export const KNOWN_RECIPE_BONUS = 0.4 * BAND_SCALE;

// Flat IP for writing a new recipe into the cookbook the hard way (by working
// out the combination yourself). Paper and NPC teaching pay nothing.
export const DISCOVERY_IP = 8;

// Seasoning. Each modifier (fat, aromatics) up to the dish's ideal adds this to
// the composed band; every one PAST the ideal costs OVER_SEASON_PENALTY instead.
// Under-seasoning is merely a missed bonus — bland, not ruined. Over-seasoning
// is an active mistake, and a heavier one than the bonus it replaces, so more is
// not a safe default. A dish declares its ideal as `seasoning`; DEFAULT_SEASONING
// applies to any that doesn't.
export const MODIFIER_BONUS = 0.25 * BAND_SCALE;
export const MODIFIER_BONUS_CAP = 0.6 * BAND_SCALE;
export const OVER_SEASON_PENALTY = 0.45 * BAND_SCALE;
export const DEFAULT_SEASONING = 1;

// Staging: `cook <vessel>` again after adding something puts the NEW ingredient
// on the same burner the vessel is already sitting on, so a slow broth and a
// fast leaf can be started at different times and peak together. Without this,
// any dish mixing a heavy slow ingredient with a light fast one has no instant
// at which both are good — which is most of the pot dishes.
export const STAGING = true;

// Temperature curves. A profile may declare `heatCurve` — the settings it wants
// and when — instead of a single `heatTolerance`. The player drives the burner
// with `stove <low|mid|high>`; the score is the fraction of the cook spent at
// the setting the food actually wanted.
//
// SIMPLIFICATION, deliberate and documented: changing the burner changes the
// QUALITY score, not the cook rate. Cook duration stays fixed at the rate set
// when the session started. Making the rate vary would mean integrating a
// piecewise clock to answer "when is this done", and the whole architecture
// rests on doneAt being a single stored timestamp (see the no-tick section of
// the README). Not worth trading that away for it.
export const HEAT_CURVE_WEIGHT = 0.9 * BAND_SCALE;   // max score for following the curve exactly

// Learning a recipe by cooking takes REPETITION, not one lucky plate: you must
// turn the combination out at DISCOVERY_MIN_BAND or better this many times
// before it's written down. A cook below that bar teaches you nothing and
// doesn't count — you can't stumble into a recipe by ruining it three times.
export const DISCOVERY_ATTEMPTS = 3;
export const DISCOVERY_MIN_BAND = 'good';

// IP: the per-use roll is the main award (probabilistic, margin-shaped, so
// grinding the same trivial cook has poor odds by construction). These are the
// flat bonuses on top for actually excelling.

// RESTING — the cheap half of carry-over cooking, and the reason not to eat a
// steak standing over the pan.
//
// A plated meal carries the instant it was plated. Everything else is derived
// from that and `now`, exactly like a cook session: too soon and the juices run
// out of it, too late and it's gone cold. No tick, no integral, one timestamp.
export const REST_MIN_MS = 20 * 1000;    // before this it hasn't settled
export const REST_PEAK_MS = 75 * 1000;   // the sweet spot
export const REST_COLD_MS = 6 * 60 * 1000; // past this it's a cold plate
export const REST_BONUS = 0.25;          // +25% restores, eaten at the right moment
export const REST_COLD_PENALTY = 0.8;    // ...and a cold one gives 80%

// How much of the meal is worth resting. A stew does not care; a cut does.
export const RESTS_WELL = ['dense_meat', 'preserved', 'batter'];

// IP for the act of cooking a meal.
//
// An ordinary meal is worth 1 IP, but only once per ROUTINE_IP_COOLDOWN_MS —
// otherwise the optimal play is to stand at a stove flipping the cheapest thing
// you own forever. A masterful meal is worth 3 and ignores the cooldown
// entirely: you can't grind those, because grinding them is the skill.
export const ROUTINE_IP = 1;
export const MASTERFUL_IP = 3;
export const ROUTINE_IP_COOLDOWN_MS = 10 * 60 * 1000;

// What each band is WORTH to the player, beyond the restore multiplier.
//
// Nine rungs of feedback are worthless if only the top one changes what happens
// to you. Before this, well-fed was masterful-or-nothing and every band below it
// paid identical IP — so `superb` was three more hunger than `excellent` and
// literally nothing else. The ladder now pays all the way up.
//
//   wellFedMs — faster HP regen for this long (0 = none)
//   ip        — flat Cooking IP for the plate
//   cooled    — whether that IP is subject to the routine cooldown
export const BAND_REWARDS = {
  poor:        { wellFedMs: 0,                 ip: ROUTINE_IP, cooled: true },
  grim:        { wellFedMs: 0,                 ip: ROUTINE_IP, cooled: true },
  acceptable:  { wellFedMs: 0,                 ip: ROUTINE_IP, cooled: true },
  decent:      { wellFedMs: 0,                 ip: ROUTINE_IP, cooled: true },
  good:        { wellFedMs: 2 * 60 * 1000,     ip: ROUTINE_IP, cooled: true },
  'very good': { wellFedMs: 4 * 60 * 1000,     ip: ROUTINE_IP + 1, cooled: true },
  excellent:   { wellFedMs: 6 * 60 * 1000,     ip: ROUTINE_IP + 1, cooled: false },
  superb:      { wellFedMs: 8 * 60 * 1000,     ip: ROUTINE_IP + 1, cooled: false },
  masterful:   { wellFedMs: 12 * 60 * 1000,    ip: MASTERFUL_IP, cooled: false },
};
export const rewardFor = band => BAND_REWARDS[band] || BAND_REWARDS.acceptable;


// What a plate is worth, given the band and when you last earned routine IP.
// `lastAt` is an epoch ms (0 = never). Returns { ip, cooled } — `cooled` true
// means the cooldown swallowed it, so the caller can say so.
export function cookingIpFor(band, lastAt = 0, now = Date.now()) {
  const { ip, cooled } = rewardFor(band);
  // A cook good enough to be worth teaching is worth paying every time. Only
  // the routine end is rate-limited, because only the routine end is grindable.
  if (!cooled) return { ip, cooled: false, resets: false };
  // `lastAt` 0 means NEVER, not "at the epoch" — a first-ever meal must pay.
  if (lastAt && now - lastAt < ROUTINE_IP_COOLDOWN_MS) return { ip: 0, cooled: true, resets: false };
  return { ip, cooled: false, resets: true };
}

// How much a plated meal is worth now, given when it was plated. Pure, derived,
// and the whole of carry-over cooking: rest it and it's better, forget it and
// it's a cold plate. Returns 1 for anything that doesn't rest.
export function restMultiplier(platedAt, restsWell, now = Date.now()) {
  if (!restsWell || !platedAt) return 1;
  const age = now - platedAt;
  if (age < REST_MIN_MS) return 1;                       // hasn't settled yet
  if (age >= REST_COLD_MS) return REST_COLD_PENALTY;     // stone cold
  if (age <= REST_PEAK_MS) {
    // Climbing into the sweet spot.
    const t = (age - REST_MIN_MS) / (REST_PEAK_MS - REST_MIN_MS);
    return 1 + REST_BONUS * t;
  }
  // Past the peak, sliding toward cold.
  const t = (age - REST_PEAK_MS) / (REST_COLD_MS - REST_PEAK_MS);
  return (1 + REST_BONUS) + t * (REST_COLD_PENALTY - (1 + REST_BONUS));
}

// What examine says about a plate that's sitting there.
export function restText(platedAt, restsWell, now = Date.now()) {
  if (!restsWell || !platedAt) return null;
  const age = now - platedAt;
  if (age < REST_MIN_MS) return 'still spitting — it hasn\'t settled';
  if (age <= REST_PEAK_MS) return 'resting, and about as good as it is going to get';
  if (age < REST_COLD_MS) return 'still warm, but going off the boil';
  return 'gone cold';
}

export function stageText(stages, fraction) {
  const f = Math.max(0, Math.min(1, fraction));
  for (const s of stages) if (f <= s.max) return s.text;
  return stages[stages.length - 1].text;
}
