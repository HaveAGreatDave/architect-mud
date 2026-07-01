/**
 * One-shot: backfill maps.parent_zone_id for all building interior maps.
 *
 * For each interior map with no parent_zone_id set, this script tries to
 * find the correct parent zone by:
 *   1. Looking at zones in the map that have apartment entries — using
 *      building_name to derive the expected lobby zone id.
 *   2. Falling back to zone-id prefix matching (zone_X_* → zone_X_lobby).
 *
 * Meridian is handled explicitly: zone_meridian_lobby.
 *
 * Run once: node server/models/temp/backfill-map-parent-zones.js
 */

import { query } from '../db.js';

async function main() {
  // 1. Get all interior maps (everything except map_world, or maps without a parent).
  const { rows: maps } = await query(
    `SELECT id, name, parent_zone_id, entry_zone_id FROM maps ORDER BY id`
  );

  console.log(`Found ${maps.length} map(s) total.`);

  for (const map of maps) {
    if (map.parent_zone_id) {
      console.log(`  [skip] ${map.id} — already has parent_zone_id=${map.parent_zone_id}`);
      continue;
    }

    // Get all zones on this map.
    const { rows: zones } = await query(
      `SELECT z.id, z.name, a.building_name
       FROM zones z
       LEFT JOIN apartments a ON a.zone_id = z.id
       WHERE z.map_id = $1`,
      [map.id]
    );

    if (!zones.length) {
      console.log(`  [skip] ${map.id} — no zones`);
      continue;
    }

    // Try to determine parent from apartment building_name → convention: zone_{name}_lobby
    const buildingNames = [...new Set(zones.map(z => z.building_name).filter(Boolean))];

    let parentZoneId = null;

    if (buildingNames.length === 1) {
      // single building: derive lobby from building_name
      const slug = buildingNames[0].toLowerCase().replace(/\s+/g, '_');
      parentZoneId = `zone_${slug}_lobby`;
    } else {
      // fall back to common prefix of zone ids
      const ids = zones.map(z => z.id);
      const prefix = commonPrefix(ids);
      // strip trailing _ or _ separator
      const clean = prefix.replace(/_[^_]*$/, '');
      if (clean && clean !== 'zone') {
        parentZoneId = `${clean}_lobby`;
      }
    }

    if (!parentZoneId) {
      console.log(`  [warn] ${map.id} (${map.name}) — could not determine parent zone (zones: ${zones.map(z=>z.id).join(', ')})`);
      continue;
    }

    // Verify the derived zone exists.
    const { rows: check } = await query(`SELECT 1 FROM zones WHERE id=$1`, [parentZoneId]);
    if (!check.length) {
      console.log(`  [warn] ${map.id} (${map.name}) — derived parent ${parentZoneId} does not exist in zones table`);
      continue;
    }

    await query(`UPDATE maps SET parent_zone_id=$1 WHERE id=$2`, [parentZoneId, map.id]);
    console.log(`  [ok]   ${map.id} (${map.name}) → parent_zone_id=${parentZoneId}`);
  }

  console.log('Done.');
  process.exit(0);
}

function commonPrefix(strs) {
  if (!strs.length) return '';
  let prefix = strs[0];
  for (const s of strs.slice(1)) {
    while (!s.startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  return prefix;
}

main().catch(err => { console.error(err); process.exit(1); });
