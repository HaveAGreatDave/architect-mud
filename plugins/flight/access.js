// WHO MAY TAKE AN AIRCRAFT, AND WHAT IS STANDING ON EACH OPEN TILE.
//
// The rule is the shared one in server/engine/vehicle-access.js and isn't restated here: the owner
// always gets in, a stranger only on an open world tile and only if she's unlocked. This file is the
// aircraft's side of it: the RAM index of owned craft left on open tiles, seeded once at boot and
// kept on our own writes. The latch the `lock`/`unlock` router calls is registered in index.js,
// because it has to reach the live row as well as the table.
//
// Only privately owned craft take part. Rental stock, a renter's hire and a charter keep the rules
// they had: those are a business's aircraft, not somebody's parked plane.

import { query } from '../../server/models/db.js';
import { getZone } from '../../server/engine/world.js';
import { noteParked, noteGone } from '../../server/engine/vehicle-access.js';

export const AIRCRAFT_WORDS = ['plane', 'aircraft', 'craft', 'heli', 'helicopter', 'chopper', 'jet'];

/** A craft somebody owns outright: the only kind the lock applies to. */
export const isPrivateCraft = (r) => !!r?.owner_id && !r.rental && r.custom_data?.charter !== true;

/**
 * Put an aircraft row in the index where it stands, or take it out if it isn't parked in the open
 * (airborne, hangared, a wreck, not private). `tname` is the type name, for an unlettered craft.
 */
export function indexAircraft(r, tname) {
  if (!r?.id) return;
  if (!isPrivateCraft(r) || r.is_wreck || r.airborne || r.hangar_id || !r.parked_zone_id) {
    noteGone('aircraft', r.id);
    return;
  }
  const name = r.name || tname || r.tname || 'aircraft';
  noteParked(r.parked_zone_id, {
    kind: 'aircraft', id: r.id, name, ownerId: r.owner_id,
    locked: r.custom_data?.locked !== false, cmd: `embark ${name}`, words: AIRCRAFT_WORDS,
  });
}
export const unindexAircraft = (id) => { if (id) noteGone('aircraft', id); };

// ONE QUERY AT BOOT. Plugins load after initWorld, so `getZone` answers here; `noteParked` drops
// every row that isn't on an open tile (hangar ramps inside a field's buildings, the Echelon).
export const seeded = query(
  `SELECT a.id, a.name, a.owner_id, a.rental, a.parked_zone_id, a.hangar_id, a.is_wreck, a.airborne, a.custom_data, t.name tname
     FROM aircraft a JOIN aircraft_types t ON t.id = a.type_id
    WHERE a.owner_id IS NOT NULL AND a.rental = 0 AND a.is_wreck = 0 AND a.airborne = 0 AND a.hangar_id IS NULL`)
  .then(({ rows }) => { for (const r of rows) if (getZone(r.parked_zone_id)) indexAircraft(r); })
  .catch((e) => console.error('[flight] parked seed:', e.message));
