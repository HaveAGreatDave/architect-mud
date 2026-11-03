/**
 * One-shot: stand a parked aircraft on the tile its pad is on now.
 *
 * WHY THIS EXISTS. An aircraft row keeps its own `grid_x`/`grid_y` beside `parked_zone_id`, and the
 * flight plugin seats you where the row says she stands. The Threshold Helipad moved off Halcyon
 * Boulevard to 890,904 for the Coliseum at true size (scripts/content/coliseum-resite.mjs), keeping
 * its zone id, so anything parked on it still says 893,909: the open boulevard under the drum.
 *
 * WHAT IT DOES. For every aircraft on the ground whose parked zone is a world tile, it sets the row's
 * grid to that tile's. Only world tiles: a hangar interior sits at grid 0,0 and a row in one keeps
 * whatever the hangar gave it.
 *
 * Local:  node scripts/oneshots/repark-moved-pad-aircraft.mjs
 * Prod:   node --env-file=.env.prod scripts/oneshots/repark-moved-pad-aircraft.mjs
 *
 * Converging: it only touches a row that disagrees with its zone, so once every parked aircraft
 * stands on its pad it's a no-op.
 */
import { query } from '../../server/models/db.js';

const { rows } = await query(
  `UPDATE aircraft a
      SET grid_x = z.grid_x, grid_y = z.grid_y
     FROM zones z
    WHERE a.parked_zone_id = z.id
      AND COALESCE(a.airborne, 0) = 0
      AND z.map_id = 'map_world'
      AND z.grid_x IS NOT NULL AND z.grid_y IS NOT NULL
      AND (a.grid_x IS DISTINCT FROM z.grid_x OR a.grid_y IS DISTINCT FROM z.grid_y)
    RETURNING a.id, a.name, z.id AS zone, z.grid_x, z.grid_y`
);
for (const r of rows) console.log(`[repark-pad] ${r.name || r.id} → ${r.zone} (${r.grid_x},${r.grid_y})`);
console.log(`[repark-pad] ${rows.length} aircraft moved onto their pads`);
process.exit(0);
