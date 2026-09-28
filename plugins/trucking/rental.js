// THE LONG HAUL — THE HIRE DESK.
//
// A truck used to be bought or it was not driven. That was the right line while the question was
// whether a run is worth owning a rig for; it left nothing between a new driver with 900₵ and a
// Continental they cannot afford for a month, and nothing for somebody who owns a Barrow and has
// one job that needs a real deck.
//
// ── ⚠ A HIRE TRUCK IS A REAL `trucks` ROW, STAMPED ───────────────────────────
// The road test's loaner is the precedent and this copies its shape: a row made by `buyTruck`,
// carrying `custom_data.rental`, which mounts, steers, wears, fuels and parks through the ordinary
// code with nothing special-cased. What the stamp changes is only what the owner may DO with it —
// sell it, paint it, fit it — and when it goes back.
//
// ── ⚠ IT RUNS OUT LAZILY, NEVER ON A TICK ────────────────────────────────────
// The term is a timestamp, and it is asked at the moments the answer matters: opening the yard,
// reaching for the keys, and parking. A hire that ran out while you were driving is not snatched
// out from under you on the road — it finishes the run and goes back when it stops. A stale row for
// a player who never comes back harms nobody.
//
// ── ⚠ ONE AT A TIME ──────────────────────────────────────────────────────────
// The desk hires you one truck. Two would let the hire line stand in for a fleet at a fraction of
// the price, which is the thing owning is for.
import { query } from '../../server/models/db.js';
import { TRUCK_TYPES, truckType, buyTruck, fleetOf } from './fleet.js';

// Two real hours. Long enough to take a job across the waste and back; short enough that it is a
// hire and not a lease.
export const RENT_TERM_MS = 2 * 60 * 60 * 1000;
// A fraction of the list price, with a floor — a Barrow for 78₵ would be an insult to the Barrow.
export const RENT_RATE = 0.06;
export const RENT_MIN = 90;

export const rentFee = (type) => Math.max(RENT_MIN, Math.round((type?.price || 0) * RENT_RATE));
export const rentalOf = (truck) => truck?.custom_data?.rental || null;
export const isRental = (truck) => !!rentalOf(truck);
export function rentalExpired(truck, now = Date.now()) {
  const r = rentalOf(truck);
  return !!r && Number(r.until) <= now;
}
/** Time left on a hire in ms, or null if it is not one. Never negative. */
export function rentalLeft(truck, now = Date.now()) {
  const r = rentalOf(truck);
  return r ? Math.max(0, Number(r.until) - now) : null;
}
export function fmtLeft(ms) {
  if (ms == null) return '';
  const m = Math.ceil(ms / 60000);
  if (m <= 0) return 'due back now';
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m left` : `${m}m left`;
}

/** The hire line, in the shape the panel and the text rung both read. */
export function rentStock(credits = 0) {
  return TRUCK_TYPES.map((t) => ({
    id: t.id, name: t.name, tier: t.tier, fee: rentFee(t), hours: RENT_TERM_MS / 3600000,
    variant: t.id, kg: t.kg, tank: t.tank, top: t.topSpeed, blurb: t.blurb,
    afford: credits >= rentFee(t),
  }));
}

/**
 * Put a hire truck in the yard. The caller has already decided the driver may (licence, one hire
 * at a time, money); this only writes. Returns the new row.
 */
export async function makeRental(playerId, typeId, bayId, fee) {
  const type = truckType(typeId);
  if (!type) return null;
  const until = Date.now() + RENT_TERM_MS;
  const t = await buyTruck(playerId, typeId, bayId, `HIRE ${type.name.split(' ').pop().toUpperCase()}`);
  const cd = { rental: { until, fee, from: bayId } };
  await query('UPDATE trucks SET custom_data = $1 WHERE id = $2', [JSON.stringify(cd), t.id]);
  return { ...t, custom_data: cd };
}

/** The live hire this player already has, if any (expired or not). */
export async function activeRental(playerId) {
  const fleet = await fleetOf(playerId);
  return fleet.find((t) => isRental(t)) || null;
}

/**
 * Take a hire truck back. Anything on its pin is dropped where the truck is standing, because the
 * box is the driver's and the tractor is not — a trailer must never leave with the hire company.
 */
export async function reclaimRental(truckId, playerId) {
  await query(
    `UPDATE trailers SET towed_by = NULL,
       parked_zone = COALESCE(parked_zone, (SELECT depot_zone FROM trucks WHERE id = $1))
     WHERE towed_by = $1`, [truckId]).catch(() => {});
  const { rowCount } = await query(
    "DELETE FROM trucks WHERE id = $1 AND owner_id = $2 AND custom_data->'rental' IS NOT NULL", [truckId, playerId],
  ).catch(() => ({ rowCount: 0 }));
  return rowCount > 0;
}

/**
 * Every hire of this player's that has run out and is not being driven goes back. Returns the names
 * of what went, so the caller can say so once.
 */
export async function sweepRentals(playerId, drivingId = null) {
  const fleet = await fleetOf(playerId);
  const gone = [];
  for (const t of fleet) {
    if (!rentalExpired(t) || t.id === drivingId) continue;
    if (await reclaimRental(t.id, playerId)) gone.push(t.name || t.type.name);
  }
  return gone;
}

export const RENT_REFUSE = "It's a hire truck. The company wants it back the way it went out: paint, parts and all.";
