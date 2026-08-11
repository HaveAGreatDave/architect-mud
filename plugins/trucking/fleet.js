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
export const RESALE = 0.55;
export function resaleValue(type, odometer = 0) {
  const wear = Math.min(0.25, (odometer || 0) / 40000);   // caps at a quarter off
  return Math.max(1, Math.round(type.price * (RESALE - wear)));
}

export async function fleetOf(playerId) {
  const { rows } = await query(
    'SELECT id, type_id, name, depot_zone, fuel, odometer, impound_fee FROM trucks WHERE owner_id = $1 ORDER BY created_at', [playerId]
  ).catch(() => ({ rows: [] }));
  // A row whose type has vanished from the fleet table is skipped rather than crashing the yard —
  // renaming a TYPES key should cost somebody a truck, not the ability to open the panel.
  return rows.filter(r => truckType(r.type_id)).map(r => ({ ...r, type: truckType(r.type_id) }));
}

export async function truckAt(playerId, depotZone) {
  const { rows } = await query(
    'SELECT id, type_id, name, depot_zone, fuel, odometer, impound_fee FROM trucks WHERE owner_id = $1 AND depot_zone = $2 LIMIT 1',
    [playerId, depotZone]
  ).catch(() => ({ rows: [] }));
  const r = rows[0];
  return r && truckType(r.type_id) ? { ...r, type: truckType(r.type_id) } : null;
}

export async function getTruck(id, playerId) {
  const { rows } = await query(
    'SELECT id, type_id, name, depot_zone, fuel, odometer, impound_fee FROM trucks WHERE id = $1 AND owner_id = $2', [id, playerId]
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
  return { id, type_id: typeId, name: plate || null, depot_zone: depotZone, fuel: 1, odometer: 0, type };
}

export async function sellTruck(id, playerId) {
  const { rowCount } = await query('DELETE FROM trucks WHERE id = $1 AND owner_id = $2', [id, playerId]);
  return rowCount > 0;
}

// Written back on park/arrive, never per tick — the drive keeps fuel and distance in RAM on the
// live rig, and this is the one coalesced flush.
export async function persistTruck(rig) {
  if (!rig?.truckId) return;
  await query('UPDATE trucks SET fuel = $1, odometer = odometer + $2, depot_zone = $3 WHERE id = $4',
    [Math.max(0, Math.min(1, rig.fuel)), Math.max(0, rig.travelled || 0), rig.zoneId || null, rig.truckId]
  ).catch(() => {});
  rig.travelled = 0;
}
