// THE LONG HAUL — the fleet: trucks you own, and the dealer who sells them.
//
// A truck is a `trucks` row with an owner and a place, exactly as an aircraft is — everything ABOUT
// the model (speed, deck capacity, tank, price) lives in the TYPES table in flight-model.js and
// nothing about it is duplicated here. The row is the ownership; the type is the truck.
//
// OWNERSHIP IS THE GATE, and that is a deliberate change to what the system means. Phase 1 handed
// anybody standing in a yard a free rig, because the question then was whether the DRIVE was worth
// doing. It is, so the question now is whether the run is worth OWNING — and that only bites if the
// truck was a real purchase with a real opportunity cost. It also gives the economy somewhere to
// go: the first 1,300₵ buys a Bolt-and-Pray, and 31,000₵ buys a market's worth of deck.
//
// READ TIER: cold. A player's fleet is fetched when they open the yard or mount a truck, never on a
// tick and never on the drive — the live rig carries the type in RAM once mounted, and fuel is
// written back on `park`, coalesced, exactly like the zone flush.

import { query } from '../../server/models/db.js';
import { TYPES, TRUCK_TYPES } from '../../client/game/js/panels/flight-model.js';
import { randomUUID } from 'crypto';

export { TRUCK_TYPES };
export const truckType = (id) => (TYPES[id]?.ground ? TYPES[id] : null);

// Resale is deliberately harsh. A truck is a commitment, not a savings account you can shuffle
// money through — and a generous buy-back would make the ladder a free elevator you ride up and
// down. Wear is on the odometer, so a truck that has done real distance is worth less than one
// that hasn't, which is the only place lifetime tiles currently mean anything.
// CONDITION IS PART OF THE PRICE. A dealer looks at the thing, and a rig you drove into the
// ground is worth what it looks like — which is also the honest reason not to sell instead of
// repairing: you take the hit either way, and the repair leaves you with a truck.
export const RESALE = 0.55;
export function resaleValue(type, odometer = 0, condition = 1) {
  const wear = Math.min(0.25, (odometer || 0) / 40000);   // caps at a quarter off
  const cond = 0.55 + 0.45 * Math.max(0, Math.min(1, condition ?? 1));
  return Math.max(1, Math.round(type.price * (RESALE - wear) * cond));
}

export async function fleetOf(playerId) {
  const { rows } = await query(
    'SELECT id, type_id, name, depot_zone, fuel, odometer, impound_fee, condition, custom_data FROM trucks WHERE owner_id = $1 ORDER BY created_at', [playerId]
  ).catch(() => ({ rows: [] }));
  // A row whose type has vanished from the fleet table is skipped rather than crashing the yard —
  // renaming a TYPES key should cost somebody a truck, not the ability to open the panel.
  return rows.filter(r => truckType(r.type_id)).map(r => ({ ...r, type: truckType(r.type_id) }));
}

// `depotZone` takes ONE zone id or a LIST of them, and the list is what a walk-in depot needs: a
// bay and the hardstand outside its door are two zones and one place, so a rig parked on either
// answers "is my truck here". One query with `= ANY`, never one per candidate — the read-tier rule
// is about round trips, and a depot with a yard would otherwise have doubled them.
export async function truckAt(playerId, depotZone) {
  const zones = (Array.isArray(depotZone) ? depotZone : [depotZone]).filter(Boolean);
  if (!zones.length) return null;
  const { rows } = await query(
    'SELECT id, type_id, name, depot_zone, fuel, odometer, impound_fee, condition, custom_data FROM trucks WHERE owner_id = $1 AND depot_zone = ANY($2) LIMIT 1',
    [playerId, zones]
  ).catch(() => ({ rows: [] }));
  const r = rows[0];
  return r && truckType(r.type_id) ? { ...r, type: truckType(r.type_id) } : null;
}

export async function getTruck(id, playerId) {
  const { rows } = await query(
    'SELECT id, type_id, name, depot_zone, fuel, odometer, impound_fee, condition, custom_data FROM trucks WHERE id = $1 AND owner_id = $2', [id, playerId]
  ).catch(() => ({ rows: [] }));
  const r = rows[0];
  return r && truckType(r.type_id) ? { ...r, type: truckType(r.type_id) } : null;
}

export async function buyTruck(playerId, typeId, depotZone, plate) {
  const type = truckType(typeId);
  if (!type) return null;
  const id = `truck_${randomUUID().slice(0, 8)}`;
  await query(
    'INSERT INTO trucks (id, type_id, name, owner_id, depot_zone, fuel) VALUES ($1,$2,$3,$4,$5,1)',
    [id, typeId, plate || null, playerId, depotZone]
  );
  return { id, type_id: typeId, name: plate || null, depot_zone: depotZone, fuel: 1, odometer: 0,
    condition: 1, custom_data: {}, type };
}

export async function sellTruck(id, playerId) {
  const { rowCount } = await query('DELETE FROM trucks WHERE id = $1 AND owner_id = $2', [id, playerId]);
  return rowCount > 0;
}

// Written back on park/arrive, never per tick — the drive keeps fuel and distance in RAM on the
// live rig, and this is the one coalesced flush.
export async function persistTruck(rig) {
  if (!rig?.truckId) return;
  // Condition rides the SAME coalesced write as fuel and the odometer. It is accrued in RAM on
  // the drive (state.js, off distance and off contact) exactly as durability's `wear()` is, for
  // the same reason: a wear tick that wrote the DB would be a query per second per driver.
  //
  // THE PER-COMPONENT BAG RIDES THE SAME STATEMENT, merged into `custom_data` rather than written
  // over it — `jsonb_set` on the one key means a flush cannot clobber a tune, a kit or a paint job
  // that was committed at a bench while the rig was out. `condition` stays the DERIVED headline
  // (damage.js `overall`) and stays a real column, so resale, the bands and the breakdown roll all
  // keep reading the thing they always read.
  const dmg = rig.dmg || null;
  await query(
    `UPDATE trucks SET fuel = $1, odometer = odometer + $2, depot_zone = $3, condition = $4,
       custom_data = CASE WHEN $6::jsonb IS NULL THEN custom_data
                          ELSE jsonb_set(COALESCE(custom_data,'{}'::jsonb), '{dmg}', $6::jsonb, true) END
     WHERE id = $5`,
    [Math.max(0, Math.min(1, rig.fuel)), Math.max(0, rig.travelled || 0), rig.zoneId || null,
      Math.max(0, Math.min(1, rig.condition ?? 1)), rig.truckId,
      dmg ? JSON.stringify(dmg) : null]
  ).catch(() => {});
  rig.travelled = 0;
}

// The bench's two writers. Both are guarded on ownership in the statement rather than by a read
// first — a check-then-write is two round trips and a race, and there is nothing here that a
// single UPDATE cannot express.
export async function setCondition(id, playerId, condition) {
  const { rowCount } = await query('UPDATE trucks SET condition = $1 WHERE id = $2 AND owner_id = $3',
    [Math.max(0, Math.min(1, condition)), id, playerId]).catch(() => ({ rowCount: 0 }));
  return rowCount > 0;
}
export async function saveTruckData(id, playerId, cd) {
  const { rowCount } = await query('UPDATE trucks SET custom_data = $1 WHERE id = $2 AND owner_id = $3',
    [JSON.stringify(cd || {}), id, playerId]).catch(() => ({ rowCount: 0 }));
  return rowCount > 0;
}
// THE RECOVERY WRITE. One statement moves the rig and clears whatever the lot was holding it for,
// because a truck that has been dragged home on a hook is out of the impound by definition — you
// paid somebody to take it out. Guarded on ownership AND on the zone it was last seen in, so two
// clicks on a slow connection cannot bill a second tow for a truck that is already home.
export async function recoverTruckTo(id, playerId, fromZone, toZone) {
  const { rowCount } = await query(
    'UPDATE trucks SET depot_zone = $1, impound_fee = 0 WHERE id = $2 AND owner_id = $3 AND depot_zone IS NOT DISTINCT FROM $4',
    [toZone, id, playerId, fromZone]
  ).catch(() => ({ rowCount: 0 }));
  return rowCount > 0;
}

export async function setFuel(id, playerId, fuel) {
  const { rowCount } = await query('UPDATE trucks SET fuel = $1 WHERE id = $2 AND owner_id = $3',
    [Math.max(0, Math.min(1, fuel)), id, playerId]).catch(() => ({ rowCount: 0 }));
  return rowCount > 0;
}
