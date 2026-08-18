// THE LONG HAUL — the bench: condition, tuning, kits and paint.
//
// This is the half of a truck that is not the drive. The road sim was complete a long time before
// any of it existed, and what was missing was not more road: it was a REASON for the truck itself
// to be a thing you have opinions about. A rig you only ever drive is a vehicle; a rig you repair,
// gear for the country you run, and paint is a possession.
//
// THREE RULES, and each is a decision about where a number is allowed to live:
//
//  1. ⚠ SUPERSEDED — see damage.js. This rule used to read "CONDITION IS A SCALAR AND THERE IS NO
//     DAMAGE MODEL", on the reasoning that a truck has one meaningful question (will it do the run)
//     which a list of components answers worse than one number does. That was right until the truck
//     became a thing you CRASH: with real collision geometry, four hundred miles of gravel and a
//     rebound off a wall are the same event to a single scalar, and they are not the same event.
//     There are now four components — engine, wheels, body, trailer — and `condition` is DERIVED
//     from them (`overall`) rather than written directly. It is still a real column and still what
//     resale, the bands, the repair price and the breakdown roll read, so nothing downstream of the
//     truck's health had to learn that components exist. What survives of the old rule, and what
//     matters, is the second sentence: everything the player FEELS is still derived here, in
//     `effTruckParams`, and stored nowhere.
//
//  2. THE CLIENT SIMULATES WITH THE PARAMETERS THE SERVER HANDS IT. `effTruckParams` is the ONLY
//     place a tune, a kit or a worn engine turns into physics, and its output is the `p` object
//     the client model already takes. So the bench cannot drift from the drive: there is no second
//     copy of the tuning maths in cab-view.js, and there is nothing for one to drift from.
//     (This is also what finally fixed a much older bug — the cab was hardcoded to TYPES.hauler,
//     so every truck in the game drove like the 4,200₵ Courier no matter what you had bought.)
//
//  3. A TUNE IS A TRADE, NEVER AN UPGRADE. Every knob here gives with one hand and takes with the
//     other, because a dial whose right answer is always "+1" is not a choice, it is a chore you
//     do once per truck. Kits are the things you BUY that are strictly better — that is what your
//     money is for — and what they mostly buy is a wider range on the dials.

import { TYPES, SURFACES } from '../../client/game/js/panels/flight-model.js';
import { partEffects } from './damage.js';

// ── Tuning ───────────────────────────────────────────────────────────────────
// Four knobs, each one a real trade. `lo`/`hi` name the two poles the way the dial shows them.
export const TUNE_PARAMS = {
  gearing:    { label: 'Final Drive',  lo: 'HAUL',  hi: 'ROAD',
    desc: 'Road (+) is taller: more top end on flat tarmac, and nothing left to pull a grade with. Haul (−) trades speed for the grunt to drag a full box out of a wet yard.' },
  boost:      { label: 'Turbo',        lo: 'SOFT',  hi: 'HARD',
    desc: 'Hard (+) is power everywhere and a thirstier, harder-worked engine that wears faster. Soft (−) is a long-lived motor that takes its time.' },
  suspension: { label: 'Suspension',   lo: 'SOFT',  hi: 'STIFF',
    desc: 'Stiff (+) turns in when you ask it to and skates on gravel. Soft (−) is lazy into a bend and keeps its feet on a bad surface.' },
  brakes:     { label: 'Brake Bias',   lo: 'COOL',  hi: 'HARD',
    desc: 'Hard (+) stops shorter and cooks the drums on a long descent. Cool (−) is a longer stop you can do all day down a mountain.' },
};

// How far the dials go. Mechanics widens the range and so does a fitted kit — the same shape as
// flight's tuneRange, deliberately, because a player who has learned one bench has learned both.
export function tuneRange(fabrication = 0, kits = []) {
  const base = 0.5 + Math.min(1.0, (fabrication || 0) / 60);
  return Math.round((base + (kits.includes('benchkit') ? 0.6 : 0)) * 100) / 100;
}
export function clampTune(val, range) {
  const n = typeof val === 'number' ? val : parseFloat(val);
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.max(-range, Math.min(range, n)) * 100) / 100;
}

// ── Kits ─────────────────────────────────────────────────────────────────────
// Bolt-on and permanent. Unlike a tune, a kit is meant to be an unambiguous improvement — it is
// what the money is for — and the most valuable one buys nothing but more room on the dials.
export const KITS = {
  aerokit:  { name: 'Cheatline Aero Kit',  price: 2600, desc: 'Roof cap, cab extenders and skirts. Less air to push, at every speed.' },
  bigcam:   { name: 'Long-Duration Cam',   price: 4200, desc: 'More engine, all the way up. It drinks accordingly.' },
  jakeplus: { name: 'Three-Stage Jake',    price: 3100, desc: 'A compression brake with real teeth — hold a loaded grade on the engine.' },
  auxtank:  { name: 'Auxiliary Saddle Tank', price: 1900, desc: 'A second tank on the off side. A quarter again as far between pumps.' },
  benchkit: { name: 'Workshop Instrument Set', price: 5400, desc: "Bench gear that lets you take every dial past where a hand and an ear can safely go." },
};
export const installedKits = (cd) => (Array.isArray(cd?.kits) ? cd.kits.filter(k => KITS[k]) : []);

// ── Condition ────────────────────────────────────────────────────────────────
// Five bands. The top two are mechanically free, exactly as gear durability does it — a truck that
// is merely "used" should not be a chore, or every run ends at a bench instead of a market.
export const BANDS = [
  { at: 0.85, key: 'sound',    label: 'Sound',     text: 'Tight. Nothing on it needs a hand.' },
  { at: 0.65, key: 'worked',   label: 'Worked',    text: 'Used, and honest about it. Everything still does what it should.' },
  { at: 0.40, key: 'tired',    label: 'Tired',     text: 'Down on power, and the brakes want a longer run at it.' },
  { at: 0.18, key: 'ailing',   label: 'Ailing',    text: 'Smoking under load. It will get you there, probably.' },
  { at: 0.00, key: 'derelict', label: 'Derelict',  text: 'It starts when it feels like it, and it stops when it decides to.' },
];
export const bandOf = (c) => BANDS.find(b => (c ?? 1) >= b.at) || BANDS[BANDS.length - 1];

// Wear per tile driven, before the multipliers. Sized so a full tank's worth of running (~1,400
// tiles on a Drayman) costs about a fifth of the bar: a rig crosses the waste four or five times
// between visits to a bench, which is often enough to be a rhythm and rare enough not to be a tax.
const WEAR_PER_TILE = 0.00014;
export function wearFor(tiles, { surface = 'road', tune = {}, condition = 1 } = {}) {
  const rough = surface === 'offroad' ? 2.4 : surface === 'shoulder' ? 1.5 : 1;
  const hot = 1 + Math.max(0, tune.boost || 0) * 0.45;      // a hard turbo is a bill you pay later
  // A tired truck wears FASTER. This is the one compounding term in the system and it is
  // deliberate: it is what turns "I'll fix it next time" into a decision instead of a default.
  const spiral = (condition ?? 1) < 0.4 ? 1.5 : 1;
  return Math.max(0, tiles) * WEAR_PER_TILE * rough * hot * spiral;
}
// A contact at speed. Bogging is friction and a scare; hitting a building at 40 is a bill.
export const wearForImpact = (mph) => Math.min(0.35, Math.max(0.01, (mph || 0) / 190));

// What a repair costs. Priced off the truck's own value, so a Barrow is cheap to keep on the road
// and a Continental is the reason haulage firms exist. Shop work is dearer and certain; a field
// repair is what you can do with what is in the toolbox, and it cannot take a rig past Worked.
export const FIELD_CAP = 0.80;
export function repairCost(type, condition, pro) {
  const missing = Math.max(0, (pro ? 1 : FIELD_CAP) - (condition ?? 1));
  return Math.max(1, Math.ceil((type.price || 4000) * missing * (pro ? 0.42 : 0.16)));
}

// ── The one place a tune becomes physics ─────────────────────────────────────
// Returns the `p` object the CLIENT MODEL takes (flight-model.js step/stepTruck), which is why
// nothing downstream of here has to know that tuning exists at all.
// `dmg` is the per-component bag (damage.js). Passing it is OPTIONAL and its absence reproduces the
// old behaviour exactly — `partEffects` on a full bag returns 1.0 across the board — which is the
// migration invariant that made the component model net-zero for every truck already on the road.
//
// The split of responsibility: `condition` (the derived headline) still does the broad, legible
// thing it always did, and the components then say WHICH of those penalties you actually earned. A
// truck with a good engine and destroyed wheels now stops badly and pulls fine, where before it was
// simply "worn" in both directions at once — and the driver could not have told you which, because
// there was nothing to tell.
export function effTruckParams(typeId, cd = {}, condition = 1, dmg = null) {
  const base = TYPES[typeId]?.ground ? TYPES[typeId] : TYPES.hauler;
  const pe = partEffects(dmg || {});
  const t = cd.tune || {}, kits = installedKits(cd);
  const g = t.gearing || 0, b = t.boost || 0, s = t.suspension || 0, br = t.brakes || 0;
  // Condition bites POWER and BRAKES and nothing else. A worn truck is not a truck that steers
  // badly — it is one that will not pull the hill and will not stop at the bottom of it, which is
  // legible from the driver's seat without a single instrument.
  const c = Math.max(0, Math.min(1, condition ?? 1));
  const health = 0.55 + 0.45 * c;                       // derelict still moves; it just isn't worth much
  const p = { ...base };
  p.thrustMax = base.thrustMax * (1 - g * 0.14) * (1 + b * 0.16) * (1 + (kits.includes('bigcam') ? 0.09 : 0)) * health * pe.thrustMax;
  p.topSpeed  = Math.round(base.topSpeed * (1 + g * 0.10));
  p.dragP     = base.dragP * (kits.includes('aerokit') ? 0.90 : 1);
  p.rollFric  = base.rollFric * (kits.includes('aerokit') ? 0.96 : 1);
  p.wheelbase = base.wheelbase * (1 - s * 0.12);        // stiffer = quicker turn-in (a shorter effective base)
  p.brake     = base.brake * (1 + br * 0.14) * (0.7 + 0.3 * c) * pe.brake;
  p.jake      = base.jake * (kits.includes('jakeplus') ? 1.25 : 1);
  p.tank      = Math.round(base.tank * (kits.includes('auxtank') ? 1.25 : 1));
  p.engineLag = base.engineLag * (1 + Math.max(0, -b) * 0.10) * (1 + (1 - c) * 0.35);
  // THE SURFACE INVARIANT, ENFORCED HERE RATHER THAN TRUSTED. `thrustMax × drive` must clear
  // `rollFric × drag` on the verge, or the edge of the road quietly stops being a law and becomes a
  // wall — a truck that cannot move off the pavement is blocked, whatever the tuning table calls it.
  //
  // The first cut of this function simply asserted that in a comment and was WRONG: a derelict,
  // road-geared, soft-turbo Barrow came out at 2.07 against a rolling resistance of 3.52 and would
  // have sat on the verge with the throttle buried, unable to move, with nothing on screen to
  // explain why. (The regress case caught it, which is the entire reason it is written as an
  // invariant and not as a paragraph.)
  //
  // So the penalties are real right up to the floor and then they stop. What that costs is the
  // bottom of the wear curve — a derelict is not quite as feeble as the multipliers alone would
  // make it — and what it buys is that no combination of purchases, choices and neglect can ever
  // produce a rig that is stuck. Being slow is a consequence; being immobile is a bug.
  const v = SURFACES.offroad;
  p.thrustMax = Math.max(p.thrustMax, (base.rollFric * v.drag / v.drive) * 1.12);
  return p;
}
// How thirsty the tune made it. Fuel burn is the server's number (index.js burns on distance),
// so it is derived here rather than living on the client's `p`.
export const burnMul = (cd = {}) => 1 + Math.max(0, cd.tune?.boost || 0) * 0.18 + (installedKits(cd).includes('bigcam') ? 0.06 : 0);

// Does it catch? Only ever a question for the bottom band, and even then it is a delay and a
// noise rather than a dead run — a truck that simply refuses to start strands a player at a yard
// with money tied up in it and nothing to do, which is a punishment with no play in it.
export const startTrouble = (condition) => (condition ?? 1) < 0.18 && Math.random() < 0.35;

// ── Breakdowns ───────────────────────────────────────────────────────────────
// The thing that makes condition matter ON THE ROAD rather than only at a bench. Until this
// existed, a derelict truck was slow and thirsty and would occasionally decline to start, and
// every one of those is a number you read in a yard — nothing the bar did could ever happen to
// you at sixty miles an hour with a hundred tiles of nothing in each direction.
//
// FOUR RULES, and each is a decision not to build the obvious version:
//
//  1. IT IS ALWAYS THE CONDITION BAR'S FAULT, AND YOU WERE TOLD. The chance is zero above Tired
//     and climbs as the square of how far below it you are, so a breakdown is never a bolt from a
//     clear sky — it is the bill for a decision you made at the last bench you drove past. A
//     random failure on a Sound truck would make every haul feel arbitrary and every repair feel
//     pointless, which is the opposite of what condition is for.
//  2. NO DAMAGE MODEL. `key` picks the PROSE, not a broken component — condition stays one scalar
//     (rule 1 of this file) and a fix is a fix. What the table buys is that the road tells you a
//     different story each time, not that a hose and a turbo behave differently.
//  3. A FIX BUYS DISTANCE, NOT HEALTH. Roadside work gets you rolling again and grants a stretch
//     of immunity; it does not move the bar. So a broken rig limps to a town and gets fixed
//     properly, instead of being repaired to full strength by a driver with a spanner in the
//     middle of a waste — and the bench keeps its job.
//  4. IT NEVER STRANDS ANYBODY FOREVER. Attempts always come good eventually (see `fixOdds`), and
//     a driver who has had enough can climb down and walk: the drive IS the crossing, so leaving
//     the truck finishes the journey on foot exactly as it always has.
export const BREAKDOWNS = {
  hose:   { label: 'a coolant hose', broke: 'Something lets go under the cab with a bang, and the mirrors fill with white. The temperature needle is already off the top of its arc.', fixed: 'You get a clamp round the split and enough water back in her to matter. It will do. It will not do forever.' },
  lifter: { label: 'a lifter pod', broke: 'The nearside drops half a foot and stays there, and the whole rig slews as the pod under it stops holding anything up. The emitter band is dark.', fixed: 'You get the pod cycling again — it comes up ragged, and it is holding, and you have stopped asking for more than that.' },
  fuel:   { label: 'the fuel line', broke: 'She surges, catches, surges again, and quits. Somewhere between the tank and the motor there is air where there should be diesel.', fixed: 'You bleed the line by hand until the air stops coming through, and she catches on the fourth turn.' },
  turbo:  { label: 'the turbo', broke: 'A shriek from behind the cab climbs somewhere it should never reach and then stops dead. Everything after that is very quiet and very slow.', fixed: 'You cannot fix a turbo on a shoulder. You can strap it, blank it off, and drive the rest of it on what is left of the motor.' },
  brakes: { label: 'a brake line', broke: 'The pedal goes soft, then goes to the floor. Air is getting out somewhere and the whole system knows it.', fixed: 'You cap off the line that was leaking. You have fewer brakes than you started with, and you have brakes.' },
};
const BREAK_KEYS = Object.keys(BREAKDOWNS);

// Chance per tile, and the whole tuning of the feature. Zero above Tired (0.5) so the top three
// bands are mechanically clean; quadratic below it so Ailing is a gamble and Derelict is a matter
// of when. Roughly: 500 tiles (about a crossing) at Derelict ≈ 60%, at Ailing ≈ 20%, at the very
// bottom of Tired ≈ 1%. Bad ground doubles it — a rig shaken to pieces on the verge is the driver's
// own doing and should read that way.
const BREAK_PER_TILE = 0.011;
// THE BOTTOM OF THE BAR IS A WALL, NOT A STEEPER SLOPE. The quadratic alone made a completely worn
// out truck a ~60% chance over a full crossing, which meant the honest way to read the condition
// bar was "keep driving and hope" — and a player who did that and got away with it had learned
// exactly the wrong lesson. At or below `TERMINAL_CONDITION` the rig is finished: the next tile it
// turns a wheel on breaks it, every time, and that breakdown cannot be fixed at the roadside (see
// the terminal gate in `fix`). A truck at zero is not a truck with bad luck, it is scrap that is
// still moving, and the only thing left to decide is who pays to drag it in.
export const TERMINAL_CONDITION = 0.04;
export function breakChance(tiles, { condition = 1, surface = 'road' } = {}) {
  if ((condition ?? 1) <= TERMINAL_CONDITION) return Math.max(0, tiles) > 0 ? 1 : 0;
  const deficit = Math.max(0, 0.5 - (condition ?? 1));
  if (deficit <= 0) return 0;
  const rough = surface === 'offroad' ? 2 : surface === 'shoulder' ? 1.4 : 1;
  return Math.max(0, tiles) * BREAK_PER_TILE * deficit * deficit * rough;
}
// Is this breakdown one a driver can do anything about? Terminal ones are not — there is no clamp,
// no bleed and no strap that puts a scrapped rig back on the road, and pretending otherwise would
// make the bottom of the condition bar mean nothing again.
export const isTerminal = (condition) => (condition ?? 1) <= TERMINAL_CONDITION;
export function breakdownRoll(tiles, opts = {}) {
  const p = breakChance(tiles, opts);
  if (p <= 0 || Math.random() >= p) return null;
  return BREAK_KEYS[Math.floor(Math.random() * BREAK_KEYS.length)];
}
// How likely a roadside attempt is to take. Fabrication is the skill that already widens the
// bench's dials, so it is the one a driver has been building for exactly this. The ESCALATION is
// the important half: every failed attempt makes the next one likelier, so the tail is bounded and
// nobody sits on a shoulder rolling dice into the dark. By the fourth go it is certain.
export function fixOdds(fabrication = 0, attempts = 0) {
  return Math.min(1, 0.34 + (fabrication || 0) / 160 + attempts * 0.22);
}
// WHAT A ROADSIDE FIX COSTS YOU BEFORE THE DICE. Two gates, and they are the reason the tow exists
// at all: without them `fix` came good by the fourth attempt for anybody, free, forever, so a
// breakdown was a delay and never a decision. Now it is a decision made at the depot, hours
// earlier, about whether to spend money on a box of spares you might not need.
//
// The SKILL floor is low on purpose — this is not a Fabrication gate on the trucking career, it is
// the difference between somebody who can hold a spanner and somebody who cannot. The PART is the
// real one, because a part is a thing you have to have thought of.
export const FIX_MIN_FAB = 12;
export const SPARES_ITEM = 'item_truck_spares';
// What a successful roadside fix buys: tiles of immunity, not condition. Enough to reach the far
// side of a crossing from about half way, and never enough to make a bench optional.
export const FIX_GRACE_TILES = 260;

// ── Paint ────────────────────────────────────────────────────────────────────
// A truck wears SEVEN colours, a paint job over them, a finish coat and a picture on the door.
//
// It used to wear two and a choice of four flashes, which was written down as "deliberately thinner
// than an aircraft's livery". That was the wrong comparison. An aeroplane's paint is a UNIFORM —
// it says whose it is — and a truck's paint is the opposite: it is the one thing in this game a
// driver owns outright, sees from the outside every time they walk up to it, and cannot be talked
// out of. A rig somebody has spent money on should be recognisable across a yard, and two colours
// and a stripe cannot do that.
//
// THE FOUR COLOURS ARE FOUR DIFFERENT SURFACES, not four slots. Each one is a place a real signwriter
// treats separately, and each is a different set of faces in the mesh — which is why adding them
// cost the renderer four lines rather than a system:
//   base — the cab. What people mean when they say what colour your truck is.
//   trim — whatever the paint job puts ON the cab: the flash, the scallop, the flame.
//   hw   — the hardware. Chassis, tanks, bumper, mirror arms, steps, lifter housings. Black on most
//          working rigs, and the single change that makes a truck look kept rather than new.
//   deck — the box on the back. A tractor and its trailer are two vehicles that happen to be
//          coupled, and they are very often not the same colour.
//
// ── AND THEN THE THREE THAT WERE NOT COLOURS AT ALL ──────────────────────────
// Four was still not the whole truck, and the tell was that a player could see the gap without
// knowing any of this: paint a rig black and it still had a WHITE spear down the flank and a BLUE
// strip under the glass, because both of those were hardcoded arrays in the mesh that no paint job
// could reach. A colour the booth cannot sell is a colour the booth is refusing to sell, and on a
// possession that is the one thing the bench is for.
//
//   bright — the brightwork. Grille teeth, bullets, the spear down the flank, hubcap bands, stack
//            mouths, horns, the lamp brows, the step rungs.  (below) still says whether it
//            is POLISHED at all; this says what colour it is when it is.
//   glow   — the running lights that are decoration rather than lamp: the beltline strip at the
//            base of the glass and the roof scanner. ⚠ NOT THE LIFTER EMITTER BANDS, which stay
//            the machine's own blue-white — those are the propulsion showing, the way an exhaust
//            flame is, and the road wash under them is painted from the same fact. A truck whose
//            thrust you could paint pink would be a truck whose thrust was jewellery.
//   glass  — the tint in the panes. Scaled per pane rather than flooded, so the windscreen stays
//            lighter than the sleeper porthole exactly as it always was.
//
// ⚠ `chrome` IS STILL A SWITCH AND IT FINALLY DOES SOMETHING. It has been stored, handed to the
// renderer and read by nothing at all — the box you ticked changed no pixel on any truck. It now
// decides whether brightwork takes `bright` or falls back to the HARDWARE colour, which is the
// blacked-out rig the `nightrun` scheme has been asking for and never got.
//
// THE DOOR NAME IS STILL THE PLATE the fleet already stores, and is deliberately not duplicated
// here. `art` is a picture, not lettering.
export const FLASHES = [
  { id: 'none',     label: 'Plain' },
  { id: 'stripe',   label: 'Flash' },
  { id: 'wave',     label: 'Wave' },
  { id: 'fade',     label: 'Fade' },
  { id: 'candy',    label: 'Candy Bands' },
  { id: 'scallop',  label: 'Scallops' },
  { id: 'flame',    label: 'Flames' },
  { id: 'split',    label: 'Beltline Split' },
  { id: 'pinstripe', label: 'Twin Pinstripe' },
  { id: 'chevron',  label: 'Chevrons' },
  { id: 'checker',  label: 'Checkerflag' },
  { id: 'roof',     label: 'Painted Roof' },
  { id: 'lower',    label: 'Skirted' },
  { id: 'panel',    label: 'Panel Van' },
  { id: 'rust',     label: 'Patina' },
];
// The finish coat. This is the one that answers "metallic" — and it is a real per-facet effect
// rather than a word on a sheet, because it is applied inside `faceBaseRgb`, which every renderer
// of this mesh colours through (see the note there). One implementation, four views.
export const FINISHES = [
  { id: 'gloss',     label: 'Gloss' },
  { id: 'satin',     label: 'Satin' },
  { id: 'matte',     label: 'Matte' },
  { id: 'metallic',  label: 'Metallic Flake' },
  { id: 'pearl',     label: 'Pearl' },
  { id: 'candy',     label: 'Candy Coat' },
  { id: 'weathered', label: 'Weathered' },
  { id: 'primer',    label: 'Primer' },
];
// What goes on the door. A truck's door is the flat panel a haulier signwrites, and it is the one
// surface on the whole rig at eye level when you are standing next to it.
export const ARTS = [
  { id: 'none',     label: 'Bare' },
  { id: 'crest',    label: 'Haulage Crest' },
  { id: 'eagle',    label: 'Spread Eagle' },
  { id: 'skull',    label: 'Skull & Pistons' },
  { id: 'pinup',    label: 'Pin-Up' },
  { id: 'wolf',     label: "Wolf's Head" },
  { id: 'flames',   label: 'Door Flames' },
  { id: 'eye',      label: "The Architect's Eye" },
  { id: 'route',    label: 'Route Shield' },
  { id: 'saint',    label: 'Saint of the Road' },
  { id: 'dice',     label: 'Lucky Dice' },
];
// One-click schemes, the hangar's own idea (livery.js PRESETS) applied to a truck. They exist
// because a four-colour picker with fifteen paint jobs behind it is a worse experience than two
// colours was, unless there is a way to get something that looks deliberate in one click.
export const PAINT_PRESETS = [
  { id: 'workhorse', label: 'Workhorse',    base: '#7d3f2a', trim: '#d8cfc0', hw: '#23262b', deck: '#b9bec6', bright: '#e2e8f0', glow: '#60c4d6', glass: '#324a5c', flash: 'stripe',    finish: 'satin',     chrome: 1 },
  { id: 'nightrun',  label: 'Night Run',    base: '#14171c', trim: '#3a4048', hw: '#1a1d22', deck: '#1b1f25', bright: '#4a5058', glow: '#3f6f7a', glass: '#141c24', flash: 'lower',     finish: 'matte',     chrome: 0 },
  { id: 'candyapple', label: 'Candy Apple', base: '#8e0f18', trim: '#f0d97a', hw: '#1c1e22', deck: '#8e0f18', bright: '#f4ead2', glow: '#ffb45c', glass: '#3a2a30', flash: 'scallop',   finish: 'candy',     chrome: 1 },
  { id: 'showrig',   label: 'Show Rig',     base: '#123f6b', trim: '#e9eef4', hw: '#0e1216', deck: '#e9eef4', bright: '#eef3f8', glow: '#7fd6ff', glass: '#2a4258', flash: 'pinstripe', finish: 'metallic',  chrome: 1 },
  { id: 'hotrod',    label: 'Hot Rod',      base: '#101216', trim: '#e2701e', hw: '#26282d', deck: '#101216', bright: '#e8dfc8', glow: '#ff7a2e', glass: '#2c1f1a', flash: 'flame',     finish: 'gloss',     chrome: 1 },
  { id: 'haulier',   label: 'Company Fleet', base: '#e8e9ec', trim: '#1f4f2e', hw: '#2b2e33', deck: '#e8e9ec', bright: '#9aa2ab', glow: '#63c98a', glass: '#2e4038', flash: 'split',     finish: 'gloss',     chrome: 0 },
  { id: 'wasteland', label: 'Wasteland',    base: '#7a6a4c', trim: '#4a3f2c', hw: '#2a2620', deck: '#6a5c42', bright: '#8a7f68', glow: '#c9a24a', glass: '#3a382c', flash: 'rust',      finish: 'weathered', chrome: 0 },
  { id: 'hazard',    label: 'Hazard',       base: '#f2b01e', trim: '#191919', hw: '#191919', deck: '#f2b01e', bright: '#dfe4ea', glow: '#ffd54a', glass: '#2f2a1e', flash: 'chevron',   finish: 'gloss',     chrome: 1 },
  { id: 'shop',      label: 'In Primer',    base: '#6b6f74', trim: '#5a5e63', hw: '#2f3237', deck: '#6b6f74', bright: '#7c8189', glow: '#6f8790', glass: '#33383d', flash: 'none',      finish: 'primer',    chrome: 0 },
];
const idsOf = (rows) => new Set(rows.map(r => r.id));
const FLASH_IDS = idsOf(FLASHES), FINISH_IDS = idsOf(FINISHES), ART_IDS = idsOf(ARTS);
// ⚠ THE DEFAULTS ARE THE MESH'S OWN HARDCODED ARRAYS, TO THE BYTE. `bright` is the CHROME const
// in buildTruck (226,232,240), `glow` is the beltline strip (96,196,214) and `glass` is the door
// pane (50,74,92) every other pane is scaled against. That is what makes the widening invisible:
// a truck nobody has repainted comes out of `sanitizePaint` wearing exactly the colours the
// renderer was already drawing it in, so no row is rewritten and nothing changes on deploy day.
export const PAINT_DEFAULT = { base: '#7d3f2a', trim: '#d8cfc0', hw: '#23262b', deck: '#b9bec6', bright: '#e2e8f0', glow: '#60c4d6', glass: '#324a5c', flash: 'stripe', finish: 'gloss', art: 'none', chrome: 1 };
const HEX = /^#[0-9a-f]{6}$/i;
// ⚠ EVERY NEW FIELD FALLS BACK THROUGH `prev` TO THE DEFAULT, which is what makes the widening
// invisible to a truck painted before it. A rig in the database carries `{base, trim, flash,
// chrome}` and nothing else; read back through here it comes out with hardware, a box colour, a
// gloss coat and a bare door — which is exactly what it has always been drawn as.
export function sanitizePaint(next = {}, prev = {}) {
  const col = (v, d) => (HEX.test(String(v || '')) ? String(v).toLowerCase() : d);
  const pick = (set, v, d) => (set.has(v) ? v : d);
  return {
    base: col(next.base, prev.base || PAINT_DEFAULT.base),
    trim: col(next.trim, prev.trim || PAINT_DEFAULT.trim),
    hw: col(next.hw, prev.hw || PAINT_DEFAULT.hw),
    deck: col(next.deck, prev.deck || PAINT_DEFAULT.deck),
    bright: col(next.bright, prev.bright || PAINT_DEFAULT.bright),
    glow: col(next.glow, prev.glow || PAINT_DEFAULT.glow),
    glass: col(next.glass, prev.glass || PAINT_DEFAULT.glass),
    flash: pick(FLASH_IDS, next.flash, FLASH_IDS.has(prev.flash) ? prev.flash : PAINT_DEFAULT.flash),
    finish: pick(FINISH_IDS, next.finish, FINISH_IDS.has(prev.finish) ? prev.finish : PAINT_DEFAULT.finish),
    art: pick(ART_IDS, next.art, ART_IDS.has(prev.art) ? prev.art : PAINT_DEFAULT.art),
    chrome: next.chrome == null ? (prev.chrome ?? 1) : (next.chrome ? 1 : 0),
  };
}
// A named scheme, expanded into a paint. Unknown name → null, so the verb can say so rather than
// quietly respraying the truck the wrong colour.
export function presetPaint(name, prev = {}) {
  const p = PAINT_PRESETS.find(r => r.id === String(name || '').toLowerCase());
  return p ? sanitizePaint(p, prev) : null;
}
// A respray is priced on the truck, not the colour — a big cab is a lot of surface. The FINISH is
// the one thing that moves it, because it is the one thing that is genuinely more work: flake and
// candy are laid down in coats over a base nobody ever sees again, and primer is the absence of the
// job. Deliberately NOT priced per colour or per paint job — a bench that charged more for a
// scallop than a stripe would make the interesting half of this cost money to look at.
const FINISH_MUL = { gloss: 1, satin: 1, matte: 1, metallic: 1.45, pearl: 1.6, candy: 1.75, weathered: 0.8, primer: 0.35 };
export const paintCost = (type, paint = null) =>
  Math.max(60, Math.round(Math.max(120, Math.round((type.price || 4000) * 0.035)) * (FINISH_MUL[paint?.finish] ?? 1)));

// ── Trim ─────────────────────────────────────────────────────────────────────
// The INSIDE of the same job. `paint` is what other drivers see; this is what YOU see, for twenty
// minutes at a stretch, and it is the only thing on the bench bought purely for the person buying
// it.
//
// The vocabulary is imported rather than restated — see client/shared/cab-trim.js, which the
// renderer reads too. A list here as well is a list that drifts, and the symptom would be a trim a
// player paid for that the cab cannot draw.
//
// ⚠ SURFACE ONLY. A retrim reaches the dash's MATERIAL and its COLOURWAY and nothing else. It can
// put walnut and brass in a scrapyard Barrow; it can never put a rev counter in one, because
// `dials`/`band`/`lamps` are the fleet ladder and the ladder's teeth are INFORMATION. The renderer
// enforces the same boundary independently (cabTrim reads two keys by name rather than spreading
// the override), so this is stated twice on purpose.
export { DASH_MATERIALS, DASH_COLOURWAYS, sanitizeTrim, isDashMaterial, isDashColourway } from '../../client/shared/cab-trim.js';
// Cheaper than a respray and flatter across the fleet: an interior is an interior, and the surface
// area of a dashboard does not scale with the size of the truck the way a cab's panels do. A floor
// keeps it from being free on the cheapest rig, where it is the change that matters most.
export const trimCost = (type) => Math.max(240, Math.round((type.price || 4000) * 0.018));
