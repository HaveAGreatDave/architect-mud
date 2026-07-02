import { query } from '../server/models/db.js';

// Vendors = NPCs with a non-empty vendor_inventory OR npc_type vendor OR a vendor_schedule.
const { rows: vendors } = await query(`
  SELECT id, name, npc_type, work_zone_id, home_zone,
         (vendor_inventory IS NOT NULL AND vendor_inventory::text NOT IN ('[]','null','')) AS has_stock,
         vendor_schedule IS NOT NULL AND vendor_schedule::text NOT IN ('{}','null','') AS has_sched
    FROM npcs
   WHERE npc_type='vendor'
      OR (vendor_inventory IS NOT NULL AND vendor_inventory::text NOT IN ('[]','null',''))
      OR (vendor_schedule IS NOT NULL AND vendor_schedule::text NOT IN ('{}','null',''))
   ORDER BY work_zone_id NULLS LAST, name`);

console.log(`Vendors: ${vendors.length}\n`);
for (const v of vendors) {
  const wz = v.work_zone_id;
  let zoneName = '—', exits = {}, doorInfo = 'no work zone';
  if (wz) {
    const { rows: z } = await query(`SELECT name, exits FROM zones WHERE id=$1`, [wz]);
    zoneName = z[0]?.name || wz;
    exits = z[0]?.exits || {};
    // find entrance edge: a door in wz, or a door leading into wz from a neighbour
    const { rows: doors } = await query(
      `SELECT id, zone_id, exit_dir, name FROM doors WHERE zone_id=$1`, [wz]);
    // neighbours whose exit points to wz
    const { rows: nbrs } = await query(
      `SELECT id, name, exits FROM zones WHERE exits::text LIKE '%'||$1||'%'`, [wz]);
    const inbound = [];
    for (const n of nbrs) for (const [dir,t] of Object.entries(n.exits||{})) if (t===wz) inbound.push(`${n.id}:${dir}`);
    const { rows: inboundDoors } = await query(
      `SELECT d.id,d.zone_id,d.exit_dir FROM doors d WHERE d.zone_id = ANY($1)`,
      [nbrs.map(n=>n.id)]);
    doorInfo = `wzDoors=[${doors.map(d=>d.exit_dir+(d.name?`(${d.name})`:'')).join(',')||'none'}] inbound=[${inbound.join(',')}] inboundDoors=[${inboundDoors.map(d=>d.zone_id+':'+d.exit_dir).join(',')||'none'}]`;
  }
  console.log(`• ${v.name} <${v.id}> type=${v.npc_type} stock=${v.has_stock} sched=${v.has_sched}`);
  console.log(`    work=${wz||'—'} (${zoneName}) home=${v.home_zone||'—'}`);
  if (wz) console.log(`    exits=${JSON.stringify(exits)}`);
  if (wz) console.log(`    ${doorInfo}`);
}
process.exit(0);
