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

// MASS_EXPONENT — why a joint isn't ten times a steak.
//
// Cooking is heat diffusing inward, so the clock is set by how far the middle is
// from the surface, not by how much there is. Characteristic thickness goes as
// m^(1/3) and diffusion time as thickness², which lands on **t ∝ m^(2/3)**. It's
// the reason a 5kg roast is a couple of hours rather than half a day, and the
// reason a thin cutlet is quick out of all proportion to how little it weighs.
//
// Calibrated so 1kg is the fixed point: at exactly 1kg this changes nothing, and
// every constant above keeps the value it was hand-tuned to. Below 1kg food takes
// LONGER than the old linear law said, above it SHORTER.
//
//   0.25kg   linear 0.25×  →  now 0.40×    (a small piece is not that fast)
//   0.5kg    linear 0.50×  →  now 0.63×
//   1kg      linear 1.00×  →  now 1.00×    ← unchanged, the calibration point
//   2kg      linear 2.00×  →  now 1.59×
//   5kg      linear 5.00×  →  now 2.92×    (a big roast is ~3x a steak, not 5x)
//
// Applies to thawing too, which is the same physics with a worse conductor.
export const MASS_EXPONENT = 2 / 3;

// MIN_COOK_MS — the floor under the whole timing game.
//
// Every window in this system is a FRACTION of cookMs: the peak band, the
// forgiving stretch, the burn point. That works beautifully at 6 minutes and
// collapses at 6 seconds — a cook shorter than a player's reaction time isn't a
// test of attention, it's a coin flip decided by rounding. Before this floor the
// true minimum was glassberries, minced and cut to an eighth, at ~1 SECOND.
//
// The `egg` profile is the evidence this was already biting: its cookRateMult
// was deliberately inflated away from a realistic value because a 60g egg
// otherwise had a 1.6-second peak window "no player can act inside". That was
// the right diagnosis and a local fix for a global problem — this is the global
// one. (The egg's rate is left alone here; unwinding that hack is a balance
// change, not a bug fix.)
//
// 20s is chosen so the TIGHTEST profile still gets a playable band: batter peaks
// for 5.0s, egg for 6.0s, and the roomy profiles get 12–14s. Fast food stays
// fast — it just stops being faster than anyone can watch.
//
// Deliberately floors cookMs ONLY, not thaw. Thawing isn't graded, so a 2-second
// thaw on a berry is fine; it's the quality window that needs room to exist.
//
// Consequence, accepted: at or under the floor, stove tier and mincing stop
// mattering. That is honest — you cannot meaningfully sear a berry faster than
// you can look at it — but it does mean those levers no-op on the lightest food.
export const MIN_COOK_MS = 20_000;

// PORTIONS — half an onion is an onion cut in half.
//
// A portioned ingredient is a fraction of the whole: it weighs proportionally
// less, so it cooks FASTER, and it feeds you proportionally less. That second
// half is what stops chopping being a free doubling of your larder — two halves
// are exactly one onion however you slice them.
//
// Faster, but NOT proportionally faster: cook time goes as m^(2/3) (MASS_EXPONENT
// above), so halving an ingredient buys ~0.63x the clock, not 0.5x. That is the
// honest physics and it deliberately weakens chopping as a speed lever — halving
// a thing does not halve how long heat takes to reach its middle. Chopping is
// still how you make a slow ingredient finish alongside a fast one; it just isn't
// a free way to make anything arbitrarily quick. If you want a real collapse in
// cook time, MINCE it — destroying the structure is what actually does that, and
// it charges you a ceiling drop for the privilege.
export const PORTION_NAMES = { 0.5: 'half', 0.25: 'a quarter of', 0.125: 'an eighth of' };
export const MIN_PORTION = 0.125;      // past this it's mince, and mince is its own item
export const MAX_CHOP_PIECES = 4;      // one cut into halves, quarters, or eighths

// MINCING — the opposite trade to chopping.
//
// Chopping buys speed by making a thing smaller, so it also feeds you less.
// Mincing buys speed by destroying the STRUCTURE: it cooks in a third of the
// time and still feeds you everything it did, but it can never be as good.
// There is no crust on mince, no rare middle, nothing to rest — so its ceiling
// drops a full band and its doneness choice goes away entirely.
//
// That makes mince the practical answer rather than the optimal one, which is
// exactly what it is in a real kitchen.
export const MINCE_RATE = 0.35;        // cooks in about a third the time
export const MINCE_CEILING_DROP = 2;   // ...but two rungs off the top, always

// PREP — what you do to an ingredient BEFORE it meets heat.
//
// Each one is a trade, never a flat bonus. The rule the whole system runs on is
// that a technique buys you something and costs you something else, so the
// question is always "is this the right thing to do to this, today" rather than
// "have I remembered to press all the buttons".
//
//   score      — cut the fat cap. Renders better and takes seasoning deeper, but
//                the cuts let moisture out: a wider window, a lower ceiling if
//                you then overcook it.
//   marinate   — time in something acid or oily. Real, large quality gain, but
//                it takes REAL TIME and the meat is doing nothing while it sits.
//   tenderise  — beat it flat. Cooks much faster and forgives a bad cook, at the
//                cost of the top band — the same shape as mince, less extreme.
export const SCORE_WINDOW_BONUS = 1.35;   // widens the peak window
export const SCORE_SEASON_BONUS = 0.3 * BAND_SCALE;
// ...and the price. Cutting the fat open is also the way OUT for the moisture,
// so once you're past the peak a scored cut dries and chars markedly faster than
// an untouched one. Scoring is a wider window followed by a shorter grace — not
// free upside, which is the house rule for every prep verb.
export const SCORE_DRYNESS = 0.6;         // over/burn window, as a fraction
// Butter on the bread. Counts as the dish's fat (see `signature`) AND pays this
// on top — it is the whole difference between toasted bread and a toastie.
export const BUTTER_BONUS = 0.35 * BAND_SCALE;
export const BUTTER_PORTION = 0.25;       // how much of a block one spread takes
export const MARINATE_MIN_MS = 3 * 60 * 1000;   // under this it has done nothing
export const MARINATE_FULL_MS = 12 * 60 * 1000; // full value at this soak
export const MARINATE_BONUS = 0.8 * BAND_SCALE;
export const MARINATE_PROFILES = ['dense_meat', 'preserved'];
export const TENDERISE_RATE = 0.6;        // cooks noticeably faster
export const TENDERISE_CEILING_DROP = 1;  // one rung, where mince costs two
export const TENDERISE_FORGIVENESS = 1.5; // and a wider window to land in

// TASTING — the one channel that reaches what looking cannot.
//
// What a mouthful TELLS you scales with Cooking skill. That's the point: until
// now the skill only ever changed the outcome, never what the player knew. A
// novice tastes "it needs something"; an expert tastes what, and how much.
export const TASTE_TIERS = { competent: 3, expert: 6 };
export const TASTE_BITE = 0.03;   // each taste costs a little of the finished dish
export const HEAT_ORDER_TEXT = { low: 'too gently', mid: 'at a middling heat', high: 'too hard' };

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

// Fond REMEMBERS what made it. Lifting the bottom of a pan you seared fish in
// into a fruit dish does not give you a better fruit dish — it gives you fruit
// that tastes of fish. The bonus is only a bonus when the origin belongs in what
// you are making now; when it doesn't, the same scrape works against you.
export const FOND_MISMATCH_PENALTY = -0.4 * BAND_SCALE;

// Fresh fond is never NEUTRAL. Left dry under a second cook it keeps cooking,
// and what was brown and sweet goes black and bitter — a smaller version of the
// residue penalty, because you're only scorching it now rather than having
// baked it on hours ago.
export const FOND_NEGLECT_PENALTY = -0.25 * BAND_SCALE;

// Liquid in the pan lifts fond whether or not anybody meant it to — that's all
// deglazing physically is. So a sauce made over an unlifted pan still collects
// some of it. Not all: you didn't scrape, so some of it stays welded to the
// bottom. This is what keeps `deglaze` worth typing without making the passive
// case a punishment for cooking a stew.
export const FOND_PASSIVE_FRACTION = 0.5;

// Fond does not keep. Left in the pan it dries to residue, and residue is a
// penalty until the pan is scoured. Long enough to finish the dish you were
// making, nowhere near long enough to save it for tomorrow.
export const FOND_LIFE_MS = 15 * 60 * 1000;

// SMOKING. A smoker is not a slow stove — it's a different process with a
// different output: meat goes in raw and comes out PRESERVED, which is what
// makes it worth the wait. Very low and very long, and correspondingly hard to
// ruin: the window is enormous, so it's the one cook you can start and leave.
// MICROWAVE — the anti-stove.
//
// Not a faster hob. A microwave is defined by what it CANNOT do: it agitates
// water, so it heats things through without ever browning them. No crust, no
// sear, no fond, no Maillard anything. That single physical fact is the whole
// design:
//
//   • fastest thing in the kitchen, and unmatched at thawing — this is the one
//     job it is genuinely the right tool for
//   • a hard CEILING no skill can lift. A microwave meal is warm, not good, and
//     no amount of Cooking skill changes that
//   • an enormous window — it is very hard to burn anything, so it forgives
//     completely at the low end of the ladder it has trapped you on
//   • no handling. The door is shut and it is going round; you cannot flip or
//     stir what you cannot reach
//
// So it is the correct answer for leftovers, thawing and being in a hurry, and
// the wrong answer for anything you wanted to be proud of. That trade is the
// point — it must never be the optimal way to cook.
export const MICROWAVE_SPEED = 3.2;      // faster than any stove tier
export const MICROWAVE_THAW_SPEED = 6.0; // and far and away the best defroster
export const MICROWAVE_CEILING = 'decent';   // hard cap: warm, never good
export const MICROWAVE_PEAK_MULT = 2.2;      // an enormous, forgiving window
export const MICROWAVE_BURN_MULT = 2.5;      // and it barely burns at all

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
  // Dry starch does not brown. It swells, clouds the water, and softens from
  // the outside in — a completely different set of tells from a root, which is
  // half the reason it stopped being one.
  dry_starch: [
    { max: 0.20, text: 'hard as gravel, sitting where it was dropped' },
    { max: 0.45, text: 'loosening and starting to move about on its own' },
    { max: 0.70, text: 'swelling, and the water going cloudy around it' },
    { max: 1.00, text: 'soft outside with a thread of chalk still at the centre' },
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
  bread: [
    { max: 0.20, text: 'pale and soft' },
    { max: 0.45, text: 'drying out, the surface going tight' },
    { max: 0.70, text: 'taking colour in patches' },
    { max: 1.00, text: 'gold across the face and crisp at the corners' },
  ],
  // Cheese is the one ingredient whose whole story is a change of state, so the
  // stages track the slump rather than any colour.
  dairy: [
    { max: 0.20, text: 'cold and firm, sweating slightly where it meets the heat' },
    { max: 0.45, text: 'going soft at the corners and losing its edges' },
    { max: 0.70, text: 'slumping, with the first bright bead of fat on top' },
    { max: 1.00, text: 'flowing, and pulling into threads when it moves' },
  ],
};

// The window opens.
export const PEAK_LINES = {
  dense_meat: 'dark and tight at the edges, the fat running clear',
  liquid: 'settled into a slow, clouded simmer',
  starchy_vegetable: 'soft enough to take a knife without argument',
  dry_starch: 'yielding but with a thread of resistance at the core',
  soft_vegetable: 'slumped and glossy',
  batter: 'set around the rim and no longer bubbling in the middle',
  egg: 'just turned from wet to matt',
  fruit: 'collapsing a little, catching gold where it touches the metal',
  preserved: 'softened, and letting go of some of its salt',
  bread: 'gold right across and crisp at the edge',
  dairy: 'fully melted and moving as one thing when the pan tilts',
  _: 'holding steady',
};

// Still in the window, but the back half of it. The tell is subtle on purpose:
// this is the only signal for WHERE inside the peak window you are, and reading
// it is worth about 0.4 of the 0.5 available for precision.
export const SLIPPING_LINES = {
  dense_meat: 'still dark and glossy, though the edges have begun to draw in',
  liquid: 'thickening, and the simmer has gone quiet at the rim',
  starchy_vegetable: 'soft all the way through, the skin starting to split',
  dry_starch: 'soft right through now, and starting to swell past itself',
  soft_vegetable: 'glossy still, but a shade duller than it was',
  batter: 'gold underneath and darkening where it meets the pan',
  egg: 'matt through, and just starting to firm at the rim',
  fruit: 'holding its shape, but only just, and the pan is browning',
  preserved: 'soft right through and gone a deeper brown',
  bread: 'gold going on brown, and hard when you press it',
  dairy: 'still molten, though a thin slick of oil has come up at the edge',
  _: 'about as good as it is going to get',
};

// The window has closed.
export const FADING_LINES = {
  dense_meat: 'tightening up, and the smell has gone from rich to sharp',
  liquid: 'reduced past thick, and starting to catch on the bottom',
  starchy_vegetable: 'going floury at the edges and losing its shape',
  dry_starch: 'bloated and slack, sticking to itself in clumps',
  soft_vegetable: 'gone from glossy to grey',
  batter: 'gone from gold to brown, and still going',
  egg: 'gone rubbery, and beginning to weep',
  fruit: 'giving off sugar that has turned from sweet to acrid',
  preserved: 'gone leathery and dark at the edges',
  bread: 'black at the corners, and the kitchen smells of it',
  dairy: 'split — oil pooling on top, and something rubbery under it',
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

// WHICH stage, rather than what it reads like. Same table, same fraction, same
// clamp — the two must never disagree about where a cook has got to, which is
// why `stageText` is written in terms of this one rather than looping again.
export function stageIndex(stages, fraction) {
  const f = Math.max(0, Math.min(1, fraction));
  for (let i = 0; i < stages.length; i++) if (f <= stages[i].max) return i;
  return stages.length - 1;
}

export function stageText(stages, fraction) {
  return stages[stageIndex(stages, fraction)].text;
}

// FOLLOWING A REAL RECIPE, WELL, IS THE BEST-PAID THING IN THE KITCHEN.
//
// Improvised dishes (improvised.js) reach `superb`, which is close enough to the
// top that the authored catalog needed something improvisation can't have. Two
// things do that job: the last rung — only an authored recipe can be plated
// `masterful` — and this flat bonus for executing a recipe you actually know at
// or above RECIPE_MASTERY_BAND. Comfortably more than the most complex
// improvisation pays (improvisedIp caps at 4), so knowing the real thing is
// always the better play.
export const RECIPE_MASTERY_IP = 6;
export const RECIPE_MASTERY_BAND = 'excellent';
