// One-shot: (1) cap every zone's total simultaneous enemy-spawn count at 2
// (sum of zone_spawns.max_count per zone_id) — prefers keeping more distinct
// enemy types over one type's higher count when trimming; (2) clear all
// enemy spawns from a 5x5 (Chebyshev radius 2) block around Franchise Strip
// (zone_city_west) via a flags.no_spawn zone flag, which loadSpawnTemplates()
// in server/engine/world.js now skips. Idempotent (safe to re-run).
//   node scripts/cap-spawns-and-franchise-buffer.js
// then POST /api/world/reload (or restart) so the running world picks up
// the flag and the removed/reduced spawn rows.
import { query } from '../server/models/db.js';

const SPAWN_CAP = 2;
const FRANCHISE_STRIP_ID = 'zone_city_west';
const NO_SPAWN_RADIUS = 2; // Chebyshev tiles -> 5x5 block, diameter 5

async function clearFranchiseStripBuffer() {
  const { rows: center } = await query('SELECT map_id, grid_x, grid_y, grid_z FROM zones WHERE id=$1', [FRANCHISE_STRIP_ID]);
  if (!center.length) throw new Error(`${FRANCHISE_STRIP_ID} not found`);
  const { map_id, grid_x: cx, grid_y: cy, grid_z: cz } = center[0];

  const { rows: zones } = await query('SELECT id, grid_x, grid_y FROM zones WHERE map_id=$1 AND grid_z=$2', [map_id, cz]);
  const nearby = zones.filter(z => Math.max(Math.abs(z.grid_x - cx), Math.abs(z.grid_y - cy)) <= NO_SPAWN_RADIUS);

  for (const z of nearby) {
    const { rows } = await query('SELECT flags FROM zones WHERE id=$1', [z.id]);
    const flags = rows[0].flags || {};
    flags.no_spawn = true;
    await query('UPDATE zones SET flags=$1 WHERE id=$2', [JSON.stringify(flags), z.id]);
  }
  const { rowCount } = await query('DELETE FROM zone_spawns WHERE zone_id = ANY($1::text[])', [nearby.map(z => z.id)]);
  console.log(`Franchise Strip buffer: flagged ${nearby.length} zones no_spawn, removed ${rowCount} zone_spawns rows`);
}

async function capZoneSpawns() {
  const { rows } = await query('SELECT id, zone_id, max_count FROM zone_spawns ORDER BY zone_id, max_count ASC, id');
  const byZone = new Map();
  for (const r of rows) {
    if (!byZone.has(r.zone_id)) byZone.set(r.zone_id, []);
    byZone.get(r.zone_id).push(r);
  }
  let updated = 0, deleted = 0;
  for (const list of byZone.values()) {
    let budget = SPAWN_CAP;
    for (const row of list) {
      const newMax = Math.min(row.max_count, budget);
      if (newMax <= 0) {
        await query('DELETE FROM zone_spawns WHERE id=$1', [row.id]);
        deleted++;
        continue;
      }
      budget -= newMax;
      if (newMax !== row.max_count) {
        await query('UPDATE zone_spawns SET max_count=$1 WHERE id=$2', [newMax, row.id]);
        updated++;
      }
    }
  }
  console.log(`Spawn cap: ${updated} rows reduced, ${deleted} rows removed to keep each zone's total <= ${SPAWN_CAP}`);
}

async function main() {
  await clearFranchiseStripBuffer();
  await capZoneSpawns();
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
