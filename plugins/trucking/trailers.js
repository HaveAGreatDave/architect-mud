// THE LONG HAUL — trailers, as things in the world.
//
// Phase 2.9. A trailer used to be a boolean on a rig: `hitch` set it true, `unhitch` set it false,
// and the box you dropped ceased to exist. That is fine for physics — the articulation angle only
// needs to know something is back there — and wrong for everything else, because the whole point of
// a fifth wheel is that the box and the truck are SEPARATE things. You drop a loaded one and come
// back for it. You run bobtail to somewhere and pick one up. You find one standing in a yard that
// is not yours.
//
// So a trailer is a row: `trailers`, with an owner, a place, and what is on it.
//
// TWO RULES, and both are decisions about where a trailer is allowed to BE:
//
//  1. `parked_zone` and `towed_by` are exclusive, and the DATABASE enforces it. A partial unique
//     index on `towed_by` means one trailer per truck is a constraint rather than a code path that
//     has to remember to check. Two players racing to hitch the same box is a lost UPDATE, not a
//     duplicated trailer.
//
//  2. A trailer can only stand where a ZONE still exists tomorrow. Depots and ordinary city tiles
//     are fine. A transient void room is not — it is torn down when the crossing ends, and a
//     trailer parked in one would be a row pointing at nothing, which is to say somebody's freight
//     silently deleted. `canDrop` is the whole of that rule and it is why `unhitch` on the corridor
//     answers no.
//
// READ TIER: cold, like the fleet. A trailer is read when you open a yard, hitch, or look at a
// tile — never on a tick and never on the drive. Once hitched, the live rig carries the row in RAM
// and the only write is on unhitch/park.

import { query } from '../../server/models/db.js';
import { randomUUID } from 'crypto';

// The dealer's line of boxes. Deliberately short: a trailer is not a second fleet ladder to climb,
// it is the thing that makes the truck you already bought useful. Rated capacity is what the weigh
// station measures you against (see the scale house), so it is the number that matters.
export const TRAILER_TYPES = [
  { id: 'flat', name: 'a flatbed', kg: 900, rated: 2200, price: 900,
    blurb: 'Open deck, chained load, nothing to hide behind. Light, cheap, and everybody can see what you are carrying.' },
  { id: 'box', name: 'a dry box', kg: 1400, rated: 3600, price: 2400,
    blurb: 'The ordinary one. Doors at the back, a seal you can break, and nobody can tell what is in it from the road.' },
  { id: 'reefer', name: 'a reefer', kg: 2100, rated: 4200, price: 5200,
    blurb: 'Insulated, and the unit on the nose runs whether you want it to or not. Heavy for what it holds, and worth it for what it holds.' },
  { id: 'tank', name: 'a tanker', kg: 2600, rated: 6000, price: 8800,
    blurb: 'A long steel cylinder on a frame. It carries more than anything else on the lot and it does not like corners.' },
];
export const trailerType = (id) => TRAILER_TYPES.find(t => t.id === id) || null;

const SELECT = 'id, name, owner_id, kg, rated_kg, parked_zone, towed_by, cargo, stash';

const shape = (r) => r && ({
  id: r.id, name: r.name, ownerId: r.owner_id,
  kg: r.kg, ratedKg: r.rated_kg,
  parkedZone: r.parked_zone, towedBy: r.towed_by,
  cargo: r.cargo || null, stash: r.stash || null,
});

export async function trailersAt(zoneId) {
  const { rows } = await query(`SELECT ${SELECT} FROM trailers WHERE parked_zone = $1 ORDER BY created_at`, [zoneId])
    .catch(() => ({ rows: [] }));
  return rows.map(shape);
}
export async function trailersOf(playerId) {
  const { rows } = await query(`SELECT ${SELECT} FROM trailers WHERE owner_id = $1 ORDER BY created_at`, [playerId])
    .catch(() => ({ rows: [] }));
  return rows.map(shape);
}
export async function getTrailer(id) {
  const { rows } = await query(`SELECT ${SELECT} FROM trailers WHERE id = $1`, [id]).catch(() => ({ rows: [] }));
  return shape(rows[0]);
}
export async function trailerOnTruck(truckId) {
  const { rows } = await query(`SELECT ${SELECT} FROM trailers WHERE towed_by = $1`, [truckId]).catch(() => ({ rows: [] }));
  return shape(rows[0]);
}

export async function buyTrailer(playerId, typeId, zoneId) {
  const t = trailerType(typeId);
  if (!t) return null;
  const id = `trl_${randomUUID().slice(0, 12)}`;
  await query(
    'INSERT INTO trailers (id, name, owner_id, kg, rated_kg, parked_zone) VALUES ($1,$2,$3,$4,$5,$6)',
    [id, t.name, playerId, t.kg, t.rated, zoneId]
  );
  return getTrailer(id);
}

// HITCH. Guarded on `parked_zone` so two drivers going for the same box is decided by the database
// rather than by whoever's round trip came back first — the loser's UPDATE matches zero rows and
// they are told somebody beat them to it, which is a better outcome than two trucks towing one
// trailer. Returns the row, or null if it was taken.
export async function hitchTrailer(trailerId, truckId, fromZone) {
  const { rowCount } = await query(
    'UPDATE trailers SET towed_by = $1, parked_zone = NULL WHERE id = $2 AND parked_zone = $3 AND towed_by IS NULL',
    [truckId, trailerId, fromZone]
  ).catch(() => ({ rowCount: 0 }));
  return rowCount ? getTrailer(trailerId) : null;
}

// DROP. The zone has to be one that still exists tomorrow — see rule 2 at the top.
export async function dropTrailer(trailerId, zoneId) {
  await query('UPDATE trailers SET towed_by = NULL, parked_zone = $1 WHERE id = $2', [zoneId, trailerId]);
  return getTrailer(trailerId);
}

// The load, written back as one statement. `cargo` is the DECLARED load and `stash` is what is not
// on the manifest; keeping them in two columns rather than one list is the entire reason the weigh
// station can ask a question the driver might be lying about the answer to.
export async function saveLoad(trailerId, cargo, stash) {
  await query('UPDATE trailers SET cargo = $1, stash = $2 WHERE id = $3',
    [cargo ? JSON.stringify(cargo) : null, stash?.length ? JSON.stringify(stash) : null, trailerId]);
}

// What the scale reads. The truck's own mass is not in here — a weighbridge under the trailer axles
// weighs the trailer, and that is also the only weight the driver has any control over.
export const declaredKg = (t) => (t?.kg || 0) + (t?.cargo?.kg || 0);
export const actualKg = (t) => declaredKg(t) + stashKg(t);
export const stashKg = (t) => (t?.stash || []).reduce((n, s) => n + (s.kg || 0), 0);

// A zone a trailer may be left in. Transient void rooms carry no coordinates and are deleted with
// the crossing, so a trailer dropped in one would be a row pointing at a zone that no longer
// exists — somebody's freight, gone, with no message. The coordinate test is the honest one: it is
// exactly "is this a place on the map".
export function canDrop(zone) {
  return !!zone && zone.grid_x != null && zone.grid_y != null;
}
