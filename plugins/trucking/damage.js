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
const WHEEL_SURFACE = { road: 1, shoulder: 2.4, offroad: 4.2 };
export function wearSplit(amount, { surface = 'road' } = {}) {
  const rough = WHEEL_SURFACE[surface] ?? 1;
  return {
    engine: amount * 0.55,
    wheels: amount * 0.45 * rough,
    body: 0,
  };
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
