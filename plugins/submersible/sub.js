// THE DIVE, AS ARITHMETIC — one step of a submerged Drake with no I/O in it, so regress can drive
// it second by second and assert what depth, air and the hull actually do. index.js is the thin
// layer that reads the live aircraft, calls this, and says what happened.

// Five hull ratings, refitted at the yard (Sub Standard). `depth` is the rated crush depth in
// metres; `air` is seconds of cabin air and power. Cheap to start, steep at the top: tier 1 covers
// all of Coldwater's own water (it is never deeper than about 23 m) and tier 5 reaches the trenches.
export const HULL_TIERS = [
  { tier: 1, depth: 25,   air: 240 },
  { tier: 2, depth: 60,   air: 360 },
  { tier: 3, depth: 180,  air: 540 },
  { tier: 4, depth: 450,  air: 780 },
  { tier: 5, depth: 1100, air: 1080 },
];
export const tierOf = (n) => HULL_TIERS[Math.min(HULL_TIERS.length, Math.max(1, n | 0 || 1)) - 1];

export const DESCEND_MS = 1.5;     // metres per second, flooding
export const ASCEND_MS = 3.0;      // metres per second, blowing ballast
// THE BALLAST. The tanks take FLOOD_S to fill and BLOW_S to empty, and how full they are scales how
// fast she sinks: a dive starts slowly while the vents are still gulping, and a blow lifts her
// harder as the water goes. The client animates the same two figures, which ride `drake_sub`.
export const FLOOD_S = 4;
export const BLOW_S = 3;
export const TRIM_UP_MS = 1.2;     // metres per second, rising on an order with the tanks still full
// THE DIVE PLANES. With the tanks flooded the stick flies her depth: `planes` is -1 (rise) to +1
// (dive), sent by the client and already scaled by how much way she has on. An order older than
// PLANES_STALE_S is ignored, so a client that goes quiet leaves her holding depth, not diving.
// Diving is scaled by the ballast (she needs the weight to go down); rising on the planes is not.
export const PLANE_MS = 5;       // m/s at full planes: the trim wheel's straight dive or rise, and the ceiling for the yoke
export const PLANES_STALE_S = 2.5;
export const PLANES_DEAD = 0.05;
export const FLOOR_CLEAR = 0.8;    // metres she keeps off the bottom when told to sit on it
export const SUB_CEIL = 1;          // metres: flown up on the planes she holds here; only `surface` (BOAT mode) brings her up
export const MIN_WATER = 3;        // metres of water under her before she can go down at all
// Crush: hull damage per second past the rating, as a fraction of the whole hull. A little over
// is survivable for a while; a long way over is quick. ⚠ It is DAMAGE, the same `row.damage` a wave
// strike adds, so a hull that took a beating on the surface has less to give below it.
export const CRUSH_BASE = 0.004, CRUSH_K = 0.06;
export const crushRate = (depth, rating) => depth <= rating ? 0 : CRUSH_BASE + CRUSH_K * (depth - rating) / rating;
export const EMERGENCY_BLOW_DMG = 0.05;   // running out of air forces a hard ascent

// ── THE AIR SUPPLY ────────────────────────────────────────────────────────────────────────────
//
// The tanks belong to the DRAKE, not to the dive: a second dive starts with whatever the first one
// left, and they refill only while she is up and the engine is running (the compressor is on the
// engine). So a quick bounce under and back out costs nothing, and a long one means sitting on the
// surface with the engine burning fuel before you can go again.
export const REGEN_S = 90;          // seconds, engine running, to refill empty tanks
export const MIN_AIR_FRAC = 0.15;   // she will not go under with less than this in the tanks
export const regenAir = (air, max, dt) => Math.min(max, air + (max / REGEN_S) * dt);

// `air` is what is in the tanks now; omitted, they are full.
export function newSub(tier, target, air) {
  const t = tierOf(tier);
  const a = air == null ? t.air : Math.min(t.air, Math.max(0, air));
  return { depth: 0, target, air: a, ballast: 0, blow: false, planes: 0, planesAt: 0, airMax: t.air, rating: t.depth,
    // Warnings already passed at the start of the dive do not fire again at once.
    warned: { air50: a / t.air <= 0.5, air25: a / t.air <= 0.25, air10: a / t.air <= 0.1 }, emergency: false };
}

// Advance one step. `floor` is the seabed depth under her now. Returns a list of event names the
// caller narrates, plus the hull damage to add. Mutates `sub`.
// `nowS` is the clock the planes order is stamped against (seconds); omitted, any order is stale.
export function stepSub(sub, dt, floor, nowS = -Infinity) {
  const ev = [];
  let damage = 0;
  // She cannot go below the bottom, and drifting over a shoal pushes her up with it.
  const lowest = Math.max(0, floor - FLOOR_CLEAR);
  if (floor < MIN_WATER && sub.target > 0) { sub.target = 0; ev.push('shoal'); }
  if (sub.target === 0) sub.blow = true;
  // The tanks fill or empty; the mean fill over the step is what moves her.
  const b0 = sub.ballast ?? 1;
  sub.ballast = Math.max(0, Math.min(1, b0 + (sub.blow ? -dt / BLOW_S : dt / FLOOD_S)));
  const bal = (b0 + sub.ballast) / 2;
  const planing = !sub.blow && Math.abs(sub.planes || 0) > PLANES_DEAD && nowS - (sub.planesAt || 0) <= PLANES_STALE_S;
  if (planing) {
    // The stick has her, and wherever it leaves her is where she holds.
    const rate = sub.planes > 0 ? sub.planes * PLANE_MS * bal : sub.planes * PLANE_MS;
    sub.depth = Math.max(Math.min(SUB_CEIL, lowest), Math.min(lowest, sub.depth + rate * dt));
    sub.target = sub.depth;   // flown up to the ceiling she stays under; she surfaces only on a blow
  } else {
    const want = Math.min(sub.target, lowest);
    if (sub.depth < want) sub.depth = Math.min(want, sub.depth + DESCEND_MS * bal * dt);
    else if (sub.depth > want) sub.depth = Math.max(want, sub.depth - (sub.blow ? ASCEND_MS * Math.max(0.25, 1 - bal) : TRIM_UP_MS) * dt);
  }

  if (sub.depth > 0) {
    sub.air = Math.max(0, sub.air - dt);
    const frac = sub.air / sub.airMax;
    for (const [k, at] of [['air50', 0.5], ['air25', 0.25], ['air10', 0.1]]) {
      if (frac <= at && !sub.warned[k]) { sub.warned[k] = true; ev.push(k); }
    }
    if (sub.air <= 0 && !sub.emergency) {
      sub.emergency = true; sub.target = 0; sub.blow = true; damage += EMERGENCY_BLOW_DMG; ev.push('emergency');
    }
    const r = crushRate(sub.depth, sub.rating);
    if (r > 0) {
      damage += r * dt;
      if (!sub.warned.creak) { sub.warned.creak = true; ev.push('creak'); }
      if (sub.depth > sub.rating * 1.25 && !sub.warned.rivet) { sub.warned.rivet = true; ev.push('rivet'); }
    } else if (sub.depth < sub.rating * 0.9) {
      sub.warned.creak = false; sub.warned.rivet = false;   // back inside her rating: warn again next time
    }
  }
  if (sub.depth === 0 && sub.target === 0) ev.push('surfaced');
  return { ev, damage };
}

// Compass bearing (8-point) from one tile position to another. Map y grows SOUTH.
const POINTS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export function bearing(dx, dy) {
  const deg = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
  return POINTS[Math.round(deg / 45) % 8];
}
