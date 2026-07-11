/**
 * Read-only audit: NPCs whose current (zone_id), home (home_zone), work
 * (work_zone_id) or studio (studio_zone_id) zone no longer exists in `zones`.
 *
 *   node scripts/audit-npc-dead-zones.mjs                 # local dev DB
 *   node --env-file=.env.prod scripts/audit-npc-dead-zones.mjs   # prod
 */
import 'dotenv/config';
import { query } from '../server/models/db.js';

async function main() {
  const { rows: npcs } = await query(
    `SELECT id, name, npc_type, zone_id, home_zone, work_zone_id, studio_zone_id
       FROM npcs`
  );
  const { rows: zoneRows } = await query(`SELECT id FROM zones`);
  const zones = new Set(zoneRows.map(z => z.id));

  const cols = [
    ['zone_id', 'current'],
    ['home_zone', 'home'],
    ['work_zone_id', 'work'],
    ['studio_zone_id', 'studio'],
  ];

  const dead = [];
  for (const n of npcs) {
    const bad = [];
    for (const [col, label] of cols) {
      const val = n[col];
      if (val && !zones.has(val)) bad.push({ col, label, val });
    }
    if (bad.length) dead.push({ n, bad });
  }

  console.log(`Scanned ${npcs.length} NPCs against ${zones.size} zones.`);
  console.log(`${dead.length} NPC(s) reference a missing zone.\n`);

  // Tally which dead zone ids are referenced, to spot the map-conversion pattern.
  const tally = new Map();
  for (const { bad } of dead) for (const b of bad) tally.set(b.val, (tally.get(b.val) || 0) + 1);

  for (const { n, bad } of dead) {
    console.log(`${n.name} [${n.id}] (${n.npc_type || 'npc'})`);
    for (const b of bad) console.log(`   ${b.label.padEnd(7)} ${b.col} = ${b.val}  (MISSING)`);
    console.log('');
  }

  if (tally.size) {
    console.log('--- Missing zone ids by reference count ---');
    for (const [id, count] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`   ${String(count).padStart(3)}  ${id}`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
