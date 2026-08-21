// THE LONG HAUL — the road, on the outside of the truck.
//
// A rig that has just come four hundred miles up a graded shoulder looks exactly like one that
// rolled out of the booth this morning, and that was the last thing about a haul the driver could
// not see. Distance already reached the wear bars, the tank and the breakdown die; none of those
// is a thing you LOOK at. This is: the truck goes brown.
//
// THREE RULES, and each of them is a decision not to build something.
//
// IT IS COSMETIC, AND THAT IS LOAD-BEARING. Grime touches no parameter, no roll and no price
// anywhere in the plugin — it is not a fifth damage component wearing a different label. The moment
// a filthy truck is a SLOWER truck, washing stops being something you do because you want to and
// starts being maintenance you resent, and the damage model already owns "the bar you ignored is
// the die you are rolling". So: `partEffects` never sees this number, `overall` never sees it, and
// `trucks.condition` is untouched. The only readers are painters.
//
// IT IS ONE SCALAR, unlike damage — and for the mirror of the reason damage is four. Damage is four
// because a rebound off a wall and four hundred miles of gravel are genuinely different events that
// a driver must be able to tell apart and price separately. Dirt is not: everything that dirties a
// truck dirties all of it, the answer is always the same hose, and a per-panel filth model would be
// four numbers that always move together and one bill.
//
// IT ACCRUES ON DISTANCE, NEVER ON THE CLOCK — the same rule fuel and wear follow, for the same
// reason. A truck sitting in a shed while you read a job board does not get dirty, because nothing
// is happening to it. Rain is the one thing that moves the number the other way, and it moves it on
// distance too: it is the road throwing water at you, not weather passing over a parked truck.
//
// STORAGE: `trucks.custom_data.grime`, beside `dmg`/`tune`/`paint`. Accrued in RAM on the drive and
// flushed with the same coalesced UPDATE (`persistTruck`) — this is the hot path.

const clamp01 = (n) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

// ── How fast a truck gets dirty ──────────────────────────────────────────────
// Per tile, on the tarmac. Tuned so a full crossing on good road arrives visibly used rather than
// filthy — the highway is the BASELINE and it must not be the thing that maxes the bar, or the
// number saturates on every run and stops saying anything. What saturates it is the verge.
const GRIME_PER_TILE = 0.0011;

// The multiplier is the surface, and it is the same vocabulary `surfaceUnder` already answers in,
// so nothing here has to know what terrain is. It deliberately reads like WHEEL_SURFACE in
// damage.js without being it: tyres care about abrasion and paint cares about what is in the air,
// which is why the graded shoulder is nearly as bad as open country here and half as bad there.
const SURFACE_GRIME = { road: 1, dirt: 3.2, shoulder: 4.4, offroad: 5.5 };

// ⚠ RAIN IS NOT A CAR WASH. It knocks the dust off and it leaves the film — anybody who has driven
// a wet motorway knows a truck comes out of it grey rather than clean. So a downpour can only ever
// pull the bar DOWN TOWARD `RAIN_FLOOR`, never to zero: the hose at the depot is the only thing
// that finishes the job, and if weather could finish it the wash would be a thing you wait out.
const RAIN_FLOOR = 0.34;
const RAIN_WASH = { rain: 0.0016, storm: 0.0030, snow: 0.0008 };
// The other direction: an ashfall or a duststorm is the sky doing the road's job for it.
const AIR_GRIME = { ash: 2.2, dust: 2.6, fog: 1.15 };

// What one tile of driving does to the paint. Returns a SIGNED delta — negative in rain — so the
// caller has one number to apply and no branch of its own.
export function grimeDelta(tiles, { surface = 'road', weather = null, grime = 0 } = {}) {
  const moved = Math.max(0, Number.isFinite(tiles) ? tiles : 0);
  if (!moved) return 0;
  const wash = RAIN_WASH[weather];
  // Rain wins over the surface it is falling on, but only down to the film — and only while there
  // is something above the film to take off. Below it the road is still throwing muck up at you, so
  // a wet dirt track dirties a clean truck exactly as a dry one would.
  if (wash && grime > RAIN_FLOOR) return -Math.min(wash * moved, grime - RAIN_FLOOR);
  const rough = SURFACE_GRIME[surface] ?? 1;
  const air = AIR_GRIME[weather] ?? 1;
  return GRIME_PER_TILE * moved * rough * air;
}

// The RAM-side apply, mirroring `applyDamage`. Lives on the rig; rides home on `park`.
export function accrueGrime(rig, tiles, opts = {}) {
  const now = clamp01(rig.grime);
  rig.grime = clamp01(now + grimeDelta(tiles, { ...opts, grime: now }));
  return rig.grime;
}

// Read the stored number off a truck row (or a rig), tolerating every shape it legitimately takes.
// A truck bought before this existed has no key at all and is CLEAN — which is the kind answer and
// also the honest one: nothing had been dirtying it.
export function grimeOf(source) {
  const bag = source?.cd || source?.custom_data || source;
  return clamp01(bag?.grime);
}

// ── What to call it ──────────────────────────────────────────────────────────
// Bands rather than a percentage, for the same reason the damage HUD has them: nobody makes a
// decision on "0.62". The top band is deliberately unremarkable — a truck that has been driven is
// the normal state of a truck, and only the bottom two are worth a comment.
const BANDS = [
  { at: 0.00, key: 'clean',   label: 'CLEAN',   line: 'clean enough to read the plate off' },
  { at: 0.18, key: 'dusty',   label: 'DUSTY',   line: 'a fine road dust over the paint' },
  { at: 0.42, key: 'dirty',   label: 'DIRTY',   line: 'brown up the flanks, the badges going soft' },
  { at: 0.68, key: 'filthy',  label: 'FILTHY',  line: 'caked, the colour underneath a rumour' },
  { at: 0.88, key: 'buried',  label: 'BURIED',  line: 'you could write your name in it, and someone has' },
];
export function grimeBand(v) {
  const g = clamp01(v);
  let out = BANDS[0];
  for (const b of BANDS) if (g >= b.at) out = b;
  return out;
}

// ── The hose ─────────────────────────────────────────────────────────────────
// Priced off the DIRT and not off the truck: a wash is somebody's time and a tank of water, and a
// Continental is not four times the work of a Krell. That is the whole reason this is not
// `repairCost` with a different constant — a repair scales with what it is putting back, and this
// does not put anything back. Cheap on purpose: it must never compete with diesel for the same
// credits, or the answer to "should I wash it" becomes arithmetic instead of taste.
export const WASH_MIN = 15;
export const WASH_FULL = 120;
export function washCost(grime) {
  const g = clamp01(grime);
  if (g < 0.02) return 0;
  return Math.round(WASH_MIN + (WASH_FULL - WASH_MIN) * g);
}
