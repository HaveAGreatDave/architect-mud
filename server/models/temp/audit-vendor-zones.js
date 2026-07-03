/**
 * Read-only diagnostic: find shop vendors whose zone_id / work_zone_id points at
 * an EXTERIOR tile (a zone on a world map with grid coords / is_building flag)
 * rather than the building interior attached to it.
 *
 *   node server/models/temp/audit-vendor-zones.js
 */
import 'dotenv/config';
import { query } from '../db.js';

function parseJson(v, fallback) {
  if (v == null) return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

async function main() {
  // All vendor NPCs
  const { rows: vendors } = await query(
    `SELECT id, name, npc_type, zone_id, work_zone_id, home_zone
       FROM npcs
      WHERE npc_type = 'vendor' OR vendor_shop_name IS NOT NULL`
  );

  // All zones we might touch, keyed by id
  const { rows: zoneRows } = await query(
    `SELECT id, name, map_id, grid_x, grid_y, parent_zone, exits, flags, ambient_theme FROM zones`
  );
  const zones = new Map(zoneRows.map(z => [z.id, z]));

  const isExterior = (z) => {
    if (!z) return false;
    const flags = parseJson(z.flags, {});
    // Heuristic: on a world/overworld map with grid coords, or explicitly is_building,
    // and NOT is_interior.
    if (flags.is_interior) return false;
    if (flags.is_building) return true;
    const onWorld = z.map_id && z.grid_x != null && z.grid_y != null && !String(z.map_id).startsWith('map_int');
    return !!onWorld;
  };

  console.log(`Found ${vendors.length} vendor NPC(s).\n`);
  for (const v of vendors) {
    const zz = zones.get(v.zone_id);
    const wz = zones.get(v.work_zone_id);
    const zExt = isExterior(zz);
    const wExt = isExterior(wz);

    // For an exterior zone, find the interior it connects to via `in` exit.
    const interiorOf = (z) => {
      if (!z) return null;
      const ex = parseJson(z.exits, {});
      const target = Array.isArray(ex.in) ? ex.in[0] : ex.in;
      return target || null;
    };

    const flag = (zExt || wExt) ? '  <-- WORKS ON EXTERIOR' : '';
    console.log(`${v.name} [${v.id}] (${v.npc_type})${flag}`);
    console.log(`   zone_id      = ${v.zone_id}  ${zz ? `(${zz.name})` : '(MISSING)'}  exterior=${zExt}`);
    console.log(`   work_zone_id = ${v.work_zone_id}  ${wz ? `(${wz.name})` : '(none/MISSING)'}  exterior=${wExt}`);
    if (zExt) console.log(`   zone.in  -> ${interiorOf(zz)}`);
    if (wExt) console.log(`   work.in  -> ${interiorOf(wz)}`);
    console.log('');
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
