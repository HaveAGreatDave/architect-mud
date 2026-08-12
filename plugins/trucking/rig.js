// THE LONG HAUL — the bench: condition, tuning, kits and paint.
//
// This is the half of a truck that is not the drive. The road sim was complete a long time before
// any of it existed, and what was missing was not more road: it was a REASON for the truck itself
// to be a thing you have opinions about. A rig you only ever drive is a vehicle; a rig you repair,
// gear for the country you run, and paint is a possession.
//
// THREE RULES, and each is a decision about where a number is allowed to live:
//
//  1. CONDITION IS A SCALAR AND EVERY CONSEQUENCE IS DERIVED FROM IT. There is no damage model
//     with parts in it, because a truck has one meaningful question — will it do the run — and a
//     list of broken components answers it worse than one number does. Wear comes off distance and
//     off contact, and everything the player feels (power, brakes, the chance it won't catch) is
//     derived here rather than stored anywhere.
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
export function effTruckParams(typeId, cd = {}, condition = 1) {
  const base = TYPES[typeId]?.ground ? TYPES[typeId] : TYPES.hauler;
  const t = cd.tune || {}, kits = installedKits(cd);
  const g = t.gearing || 0, b = t.boost || 0, s = t.suspension || 0, br = t.brakes || 0;
  // Condition bites POWER and BRAKES and nothing else. A worn truck is not a truck that steers
  // badly — it is one that will not pull the hill and will not stop at the bottom of it, which is
  // legible from the driver's seat without a single instrument.
  const c = Math.max(0, Math.min(1, condition ?? 1));
  const health = 0.55 + 0.45 * c;                       // derelict still moves; it just isn't worth much
  const p = { ...base };
  p.thrustMax = base.thrustMax * (1 - g * 0.14) * (1 + b * 0.16) * (1 + (kits.includes('bigcam') ? 0.09 : 0)) * health;
  p.topSpeed  = Math.round(base.topSpeed * (1 + g * 0.10));
  p.dragP     = base.dragP * (kits.includes('aerokit') ? 0.90 : 1);
  p.rollFric  = base.rollFric * (kits.includes('aerokit') ? 0.96 : 1);
  p.wheelbase = base.wheelbase * (1 - s * 0.12);        // stiffer = quicker turn-in (a shorter effective base)
  p.brake     = base.brake * (1 + br * 0.14) * (0.7 + 0.3 * c);
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
export function breakChance(tiles, { condition = 1, surface = 'road' } = {}) {
  const deficit = Math.max(0, 0.5 - (condition ?? 1));
  if (deficit <= 0) return 0;
  const rough = surface === 'offroad' ? 2 : surface === 'shoulder' ? 1.4 : 1;
  return Math.max(0, tiles) * BREAK_PER_TILE * deficit * deficit * rough;
}
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
// What a successful roadside fix buys: tiles of immunity, not condition. Enough to reach the far
// side of a crossing from about half way, and never enough to make a bench optional.
export const FIX_GRACE_TILES = 260;

// ── Paint ────────────────────────────────────────────────────────────────────
// Deliberately thinner than an aircraft's livery: a truck wears a colour, a flash down the flank
// and a name on the door. The door name is the plate the fleet already stores, so it is not
// duplicated here.
export const FLASHES = ['none', 'stripe', 'wave', 'fade', 'candy'];
const HEX = /^#[0-9a-f]{6}$/i;
export function sanitizePaint(next = {}, prev = {}) {
  const col = (v, d) => (HEX.test(String(v || '')) ? String(v).toLowerCase() : d);
  return {
    base: col(next.base, prev.base || '#7d3f2a'),
    trim: col(next.trim, prev.trim || '#d8cfc0'),
    flash: FLASHES.includes(next.flash) ? next.flash : (prev.flash || 'stripe'),
    chrome: next.chrome == null ? (prev.chrome ?? 1) : (next.chrome ? 1 : 0),
  };
}
// A respray is priced on the truck, not the colour — a big cab is a lot of surface.
export const paintCost = (type) => Math.max(120, Math.round((type.price || 4000) * 0.035));
