// THE LONG HAUL — where the truck hurts.
//
// This replaces rule 1 and rule 2 at the top of rig.js ("condition is ONE scalar", "NO DAMAGE
// MODEL"). Those rules were right for what the system was then: a truck you drove until a bar went
// down and then paid to put back up, where a list of broken components genuinely would have been a
// worse answer than one number. What changed is that the truck became a thing you CRASH — the
// collision probe is real geometry now, and a rebound off a wall and four hundred miles of gravel
// are the same event to a single scalar. They are not the same event. One of them is a wing panel
// and one of them is the wheels, and a driver who cannot tell which is which cannot make a decision
// about either.
//
// FOUR COMPONENTS, and each one had to earn its place by answering a question the others cannot:
//
//   engine   — makes power. Wears with DISTANCE and with abuse. When it goes you stop.
//   wheels   — hold the road. Wear with distance and MUCH faster off the tarmac. When they go you
//              stop being able to steer or stop, which is the interesting failure.
//   body     — holds the shape. Does not wear with distance AT ALL; it only ever takes impacts.
//              That is deliberate: it is the one component whose bar is a HISTORY rather than a
//              maintenance schedule, so a battered body is a story about you and not about mileage.
//   trailer  — the box. Its own row (trailers.condition), because a trailer outlives the truck that
//              towed it and is routinely somebody else's problem.
//
// THE HEADLINE NUMBER SURVIVES, and that is the whole reason this was affordable. `trucks.condition`
// is still a column, still persisted, still what resale, the breakdown roll, the repair price, the
// band label and the depot panel read — it is now DERIVED (see `overall`) rather than written
// directly. So nothing downstream of the truck's health had to learn about components at all, and
// there is exactly one place where four numbers become one.
//
// WHY THE WEAKEST LINK AND NOT THE AVERAGE. An average lets a pristine engine hide destroyed
// wheels, and the destroyed wheels are the thing about to end your evening. `overall` is weighted
// toward the worst component hard enough that one dead system reads as a dead truck, because it is
// one. A mean would have made the whole model cosmetic.
//
// STORAGE: `trucks.custom_data.dmg`, not four new columns. `custom_data` is already the truck's
// JSONB bag (tune, kits, paint all live there) and the no-sparse-columns rule is explicit.

export const PARTS = ['engine', 'wheels', 'body'];        // the tractor's three; the trailer is its own row

export const PART_LABELS = {
  engine:  { label: 'ENGINE',  short: 'ENG' },
  wheels:  { label: 'WHEELS',  short: 'WHL' },
  body:    { label: 'BODY',    short: 'BDY' },
  trailer: { label: 'TRAILER', short: 'TRL' },
};

const clamp01 = (n) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 1));

// Read the bag off a truck row (or a rig), tolerating every shape it can legitimately be in: a
// truck bought before this existed has no `dmg` at all, and its single `condition` is the honest
// answer for all three parts — a used truck was worn evenly until we started saying otherwise.
export function damageOf(source) {
  const bag = source?.dmg || source?.cd?.dmg || source?.custom_data?.dmg;
  const fallback = clamp01(source?.condition ?? 1);
  const out = {};
  for (const p of PARTS) out[p] = bag && Number.isFinite(bag[p]) ? clamp01(bag[p]) : fallback;
  return out;
}

// Four numbers to one. Weighted toward the worst — see the note above. At parity with a uniform
// truck this returns exactly that truck's condition, which is the migration invariant: every
// existing rig comes out of this identical to how it went in.
export function overall(dmg) {
  const vals = PARTS.map(p => clamp01(dmg?.[p] ?? 1));
  const worst = Math.min(...vals);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return clamp01(worst * 0.6 + mean * 0.4);
}

// ── Where the miles go ───────────────────────────────────────────────────────
// One tile of driving, split across the parts that a mile actually touches. The BODY is absent on
// purpose (see above) and that absence is the design: nothing you can do with the throttle will
// ever dent a panel.
//
// The split is not even. Wheels take the surface — that is what a tyre IS — so gravel and the verge
// land almost entirely on them, which is what finally gives the "stay on the road" rule teeth
// beyond a speed cap. The engine takes the distance and the abuse, evenly, because an engine does
// not care what it is rolling over.
// ⚠ OFF-ROAD IS BRUTAL ON TYRES, and it is meant to be the loudest number in this file. Open
// country is now somewhere you can genuinely drive rather than a stall (see OFFROAD_R in
// corridor.js), so the reason to stay on the tarmac cannot be "you are not allowed" any more — it
// has to be the bill. At 7x, a stretch of verge that saves you a few minutes costs a set of
// housings, which is a trade a driver can weigh and sometimes take. The engine multiplier is
// deliberately absent: a diesel does not care what it is rolling over.
const WHEEL_SURFACE = { road: 1, shoulder: 2.4, offroad: 7 };
export function wearSplit(amount, { surface = 'road' } = {}) {
  const rough = WHEEL_SURFACE[surface] ?? 1;
  return {
    engine: amount * 0.55,
    wheels: amount * 0.45 * rough,
    body: 0,
  };
}

// ── Where a missed shift goes ────────────────────────────────────────────────
// A grind is dog teeth being asked to mesh at two different speeds, and what pays for it is the
// gearbox — which this model does not have as its own bar, and deliberately should not: a fourth
// component would need its own label, its own item, its own repair price and its own line in the
// HUD, all to say a thing the ENGINE bar already says legibly ("the driveline is tired, and it is
// your fault"). So it lands on the engine, whole, and on nothing else. It is not an impact: no
// sheet metal moved.
//
// The amount is deliberately SMALL — a fluffed shift is a wince, not an incident — and the whole
// mechanic is in the accumulation. One grind is nothing. A driver who grinds every shift for a
// whole leg arrives with a bill, which is the correct relationship between a bad habit and money.
const GRIND_WEAR = 0.004;
export function grindSplit(mult = 1) {
  return { engine: GRIND_WEAR * Math.max(0.25, Math.min(4, mult)), wheels: 0, body: 0 };
}

// ── Where a crash goes ───────────────────────────────────────────────────────
// `area` is what the CLIENT observed about the contact — which end of the truck met the wall — and
// it is the one fact the server genuinely cannot work out, because the server has no geometry. It
// is also unforgeable in any way that helps: every area routes most of the damage into the body,
// and the differences between them are which SECOND component gets the rest. A client claiming a
// gentler area still eats the same total.
//
// The totals are the caller's (`wearForImpact` clamps the speed); this only decides where it lands.
const IMPACT_SPLIT = {
  // Nose first: the radiator, the fan and everything behind it. The classic way to end a haul.
  front: { body: 0.62, engine: 0.28, wheels: 0.10 },
  // Backed into something. The body takes nearly all of it — there is nothing back there to break
  // on a bobtail tractor, which is exactly why reversing is cheap to get wrong and expensive to get
  // very wrong (the trailer, if there is one, is handled separately by the caller).
  rear:  { body: 0.85, engine: 0.02, wheels: 0.13 },
  // A scrape down the flank: sheet metal and, overwhelmingly, the wheels — a kerb strike at an
  // angle is how a truck loses a tyre, and it is the case a single scalar could never express.
  side:  { body: 0.48, engine: 0.04, wheels: 0.48 },
};
export const IMPACT_AREAS = Object.keys(IMPACT_SPLIT);
export function impactSplit(amount, area = 'front') {
  const w = IMPACT_SPLIT[area] || IMPACT_SPLIT.front;
  return { engine: amount * w.engine, wheels: amount * w.wheels, body: amount * w.body };
}

// Apply a split to a bag, in place, and hand back the new headline number. Every writer in the
// system goes through this one function, which is what stops the derived `condition` and the parts
// it is derived from ever disagreeing.
export function applyDamage(rig, split) {
  const dmg = rig.dmg || (rig.dmg = damageOf(rig));
  for (const p of PARTS) if (split[p]) dmg[p] = clamp01(dmg[p] - split[p]);
  rig.condition = overall(dmg);
  return rig.condition;
}

// ── What a broken part actually does to the truck ────────────────────────────
// Returned as MULTIPLIERS on the parameter set `effTruckParams` already builds, so this is a second
// pass over the same object rather than a second physics model. Each one is the honest consequence
// of the part it names and nothing else:
//
//   a tired engine makes less power and less of it low down (`thrustMax`)
//   tired wheels find less grip and take longer to stop (`brake`, and grip via the surface pass)
//   a battered body does NOTHING mechanical, and that is the point — it costs you resale and it
//   costs you the way people look at the truck, and it must never quietly make you slower, or
//   "body" becomes a second engine bar with a different name.
//
// The floors matter more than the curves. Nothing here can reach zero: a rig at the bottom of every
// bar is slow and vague and frightening, and it still MOVES, because the thing that stops you is
// the breakdown roll and the terminal gate, which are decisions — not a multiplier quietly
// approaching zero until the truck stops for reasons nobody can see.
export function partEffects(dmg) {
  const eng = clamp01(dmg?.engine ?? 1), whl = clamp01(dmg?.wheels ?? 1);
  return {
    thrustMax: 0.55 + 0.45 * eng,
    brake: 0.60 + 0.40 * whl,
    grip: 0.65 + 0.35 * whl,
  };
}

// ── SCRATCH, FAULT, FAILURE ──────────────────────────────────────────────────
// The bands above say how BAD a component is. This says what KIND of bad, which is a different
// question and the one that decides whether a repair is a bill or an errand.
//
//   scratch    the top of the bar. Cosmetic and mechanically NOTHING — `partEffects` is already
//              flat up here, so this is not a new rule, it is a name for a rule that existed and
//              had no word. What it costs you is resale and how the truck looks, and choosing to
//              live with it is a legitimate way to run a truck.
//   fault      the middle. It works worse. Credits and labour put it right; nothing physical is
//              needed, because this is wear rather than a part that has let go.
//   broken     the bottom. The component has FAILED, and no amount of money is a camshaft. A
//              repair from here needs the actual part — in your hands for the ones a person can
//              carry, and merely in the same room for the one nobody can.
//
// ⚠ BROKEN IS PER COMPONENT, NOT PER TRUCK. Wheels can be finished while the engine is only tired,
// and the repair path has to be able to say so — a whole-truck gate would make the parts economy
// fire all at once or never, and both of those are less interesting than the truck telling you
// exactly which one thing it is waiting for.
export const BROKEN_AT = 0.15;      // at or below: the part has failed and must be replaced
export const COSMETIC_AT = 0.85;    // at or above: scratches and dents, no mechanical effect

export function severityOf(v) {
  const n = clamp01(v);
  return n >= COSMETIC_AT ? 'scratch' : n > BROKEN_AT ? 'fault' : 'broken';
}
export const isBroken = (v) => severityOf(v) === 'broken';
export const isCosmetic = (v) => severityOf(v) === 'scratch';

// WHAT A FAILED COMPONENT NEEDS, and the one asymmetry in it that carries the whole idea.
//
// `carry: false` on the engine is not a weight rule dressed up — it is the design. A wheel set and
// a body panel are freight you can throw in the cab, so a prepared driver is one who bought spares
// before they left. An engine is a crate on a pallet: it cannot be in your pockets, so replacing
// one is a question about WHERE YOU ARE rather than about what you packed. That turns the worst
// failure in the game from a credits problem into a place problem, which is the interesting one,
// and it is why a dead engine at the far end of a corridor still ends in a tow.
export const PART_ITEMS = {
  engine: { item: 'item_truck_engine', label: 'a replacement engine', carry: false },
  wheels: { item: 'item_wheel_set',    label: 'a set of wheels',      carry: true },
  body:   { item: 'item_body_panel',   label: 'body panels',          carry: true },
};

// What a component costs to put right, as a SHARE of the whole-truck bill. An engine is half the
// money in a truck and a body panel is not, and pricing all three at a third each (which is what
// the first cut did) meant the cheapest possible repair and the dearest possible repair were the
// same price. The three sum to 1, so three targeted repairs still come to one whole one and there
// is no arbitrage in either direction.
export const PART_SHARE = { engine: 0.50, wheels: 0.32, body: 0.18 };
// Cosmetic work is cheap, and deliberately so: a panel beaten out and resprayed is an afternoon,
// not a rebuild. This multiplies the share above when the damage never got past a scratch.
export const COSMETIC_MUL = 0.35;

// The words the HUD and the log use. Deliberately the same five bands the truck's overall condition
// already uses, so a driver reads one vocabulary rather than two.
export function partBand(v) {
  const n = clamp01(v);
  if (n >= 0.85) return { key: 'sound', label: 'SOUND' };
  if (n >= 0.62) return { key: 'worked', label: 'WORKED' };
  if (n >= 0.40) return { key: 'tired', label: 'TIRED' };
  if (n >= 0.15) return { key: 'ailing', label: 'AILING' };
  return { key: 'derelict', label: 'DERELICT' };
}
