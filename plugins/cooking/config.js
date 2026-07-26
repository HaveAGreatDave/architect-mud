// Tunable balance knobs for the cooking system — weight/thaw-based duration
// math and the generic (non-item-specific) stage narration. Plugin-local
// config, same choice as the preservation system's decay rates.

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
export const BASE_OFFSET = -2.2;
export const HEAT_SCORE = { exact: 0.4, oneOff: -0.4, twoOff: -1.0 };
export const PRECISION_WEIGHT = 0.5;   // max bonus for pulling it mid-peak
export const VESSEL_WEIGHT = 1.2;      // × (d + r − 1)
export const SKILL_WEIGHT = 0.6;       // × clamp(margin/20, −1, 1)
export const TURN_IDEAL_BONUS = 0.5;   // hitting the ideal number of turns
export const TURN_SPACING_BONUS = 0.3; // …and spacing them evenly
export const TURN_MISS_PENALTY = 0.6;  // per turn over/under the ideal
export const FUSS_PENALTY = 0.7;       // per handling act on a turns:0 food
export const SCORE_FLOOR = -3.0;       // clamp on the summed modifiers

// Dishes (see dishes.js). How a dish's band composes from its ingredients':
// the mean pulled toward the worst ingredient. One mediocre potato dents a
// stew; it shouldn't sink it. 0 = pure mean, 1 = the worst decides everything.
export const WORST_PULL = 0.45;

// A combination no dish template claims still feeds you, and no more than that.
export const SLOP_CEILING = 'acceptable';

// The whole mechanical value of having a recipe in your cookbook: a sub-band
// nudge that tips rounding your way. Deliberately small — knowing a recipe must
// never be worth more than cooking it well, or the cookbook becomes the game.
export const KNOWN_RECIPE_BONUS = 0.4;

// Flat IP for writing a new recipe into the cookbook the hard way (by working
// out the combination yourself). Paper and NPC teaching pay nothing.
export const DISCOVERY_IP = 8;

// Seasoning. Each modifier (fat, aromatics) up to the dish's ideal adds this to
// the composed band; every one PAST the ideal costs OVER_SEASON_PENALTY instead.
// Under-seasoning is merely a missed bonus — bland, not ruined. Over-seasoning
// is an active mistake, and a heavier one than the bonus it replaces, so more is
// not a safe default. A dish declares its ideal as `seasoning`; DEFAULT_SEASONING
// applies to any that doesn't.
export const MODIFIER_BONUS = 0.25;
export const MODIFIER_BONUS_CAP = 0.6;
export const OVER_SEASON_PENALTY = 0.45;
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
export const HEAT_CURVE_WEIGHT = 0.9;   // max score for following the curve exactly

// Learning a recipe by cooking takes REPETITION, not one lucky plate: you must
// turn the combination out at DISCOVERY_MIN_BAND or better this many times
// before it's written down. A cook below that bar teaches you nothing and
// doesn't count — you can't stumble into a recipe by ruining it three times.
export const DISCOVERY_ATTEMPTS = 3;
export const DISCOVERY_MIN_BAND = 'good';

// IP: the per-use roll is the main award (probabilistic, margin-shaped, so
// grinding the same trivial cook has poor odds by construction). These are the
// flat bonuses on top for actually excelling.
export const QUALITY_IP_BONUS = { excellent: 2, masterful: 5 };

export function stageText(stages, fraction) {
  const f = Math.max(0, Math.min(1, fraction));
  for (const s of stages) if (f <= s.max) return s.text;
  return stages[stages.length - 1].text;
}
