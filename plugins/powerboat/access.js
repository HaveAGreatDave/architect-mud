// WHO MAY TAKE A BOAT, AND WHAT IS LYING ON EACH OPEN TILE.
//
// The rule is the shared one in server/engine/vehicle-access.js and isn't restated here: the owner
// always gets in, a stranger only on an open world tile and only if she's unlocked. This file is the
// boat's side of it: the RAM index of hulls left on open tiles, seeded once at boot, kept on our own
// writes, and the latch the `lock`/`unlock` router calls.

import { query } from '../../server/models/db.js';
import { getZone } from '../../server/engine/world.js';
import { noteParked, noteGone, registerVehicleLock } from '../../server/engine/vehicle-access.js';
import { TYPES } from '../../client/game/js/panels/flight-model.js';

const nameOf = (b) => b.name || TYPES[b.type_id]?.name || 'boat';

/** Put a boat row (or the fields of one) in the index where it lies. Not an open tile: dropped. */
export function indexBoat(b) {
  if (!b?.id || !b.berth_zone) return;
  noteParked(b.berth_zone, {
    kind: 'boat', id: b.id, name: nameOf(b), ownerId: b.owner_id,
    locked: b.custom_data?.locked !== false, cmd: 'embark', words: ['boat', 'hull'],
  });
}
export const unindexBoat = (id) => { if (id) noteGone('boat', id); };

/**
 * She's been left where she now lies: the latch goes on and the index learns the tile. One write.
 * Takes the boat id and re-reads nothing but the fields it needs, RETURNING them.
 */
export async function parkLocked(boatId) {
  const r = await query(
    `UPDATE boats SET custom_data = jsonb_set(COALESCE(custom_data, '{}'::jsonb), '{locked}', 'true'::jsonb, true)
     WHERE id = $1 RETURNING id, name, type_id, owner_id, berth_zone, custom_data`, [boatId]).catch(() => null);
  const b = r?.rows?.[0];
  if (b) indexBoat(b); else unindexBoat(boatId);
  return b || null;
}

// ⚠ ONE QUERY AT BOOT. Plugins load after initWorld, so `getZone` answers here; `noteParked` drops
// every row that isn't on an open tile (marina berths under a roof, sheds, cradles).
export const seeded = query('SELECT id, name, type_id, owner_id, berth_zone, custom_data FROM boats WHERE berth_zone IS NOT NULL')
  .then(({ rows }) => { for (const b of rows) if (getZone(b.berth_zone)) indexBoat(b); })
  .catch((e) => console.error('[powerboat] parked seed:', e.message));

// The latch. Guarded on the owner, so the router can only ever turn your own key.
registerVehicleLock('boat', async (id, ownerId, locked) => {
  const r = await query(
    `UPDATE boats SET custom_data = jsonb_set(COALESCE(custom_data, '{}'::jsonb), '{locked}', to_jsonb($3::boolean), true)
     WHERE id = $1 AND owner_id = $2`, [id, ownerId, !!locked]).catch(() => null);
  return (r?.rowCount || 0) > 0;
});
