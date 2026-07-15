// One-shot: give every vendor whose shop is an interior building network but has
// no power source its own authored utility room + junction box + lights.
//
// "Missing power/utility" only — vendors already served by a junction box (with
// its utility room) or sitting on the city grid (outdoor stalls) are left alone.
// Outdoor/non-interior stalls are skipped entirely: junction boxes go in building
// interiors, and the city plant already feeds the street they stand on.
//
// Authored content (not a runtime self-heal): the down-exit into the utility room
// is written to zones.exits so it survives `npm run content:export` → git → prod.
//
//   node scripts/backfill-vendor-utility.mjs            # dry-run (report only)
//   node scripts/backfill-vendor-utility.mjs --apply    # write to the local dev DB
//
// Then: npm run content:export → review the diff → commit → push (CODEX deploy).

import { query } from '../server/models/db.js';
import { authorUtilityRoom, buildingHasPower } from '../tools/lib/utility-room.mjs';

const APPLY = process.argv.includes('--apply');

// BFS a building's interior network (mirrors environment.js getBuildingNetwork).
async function network(startId) {
  const { rows: allZones } = await query('SELECT id, exits, flags FROM zones');
  const byId = new Map(allZones.map(z => [z.id, z]));
  const nbr = (z) => {
    const out = [];
    for (const t of Object.values(z?.exits || {})) { if (Array.isArray(t)) out.push(...t); else if (t) out.push(t); }
    return out;
  };
  const isInt = (z) => !!(z?.flags?.is_apartment || z?.flags?.is_interior);
  const seen = new Set([startId]), q = [startId];
  while (q.length) {
    const id = q.shift();
    const ns = new Set(nbr(byId.get(id)));
    for (const o of allZones) if (nbr(o).includes(id)) ns.add(o.id);
    for (const n of ns) if (!seen.has(n) && isInt(byId.get(n))) { seen.add(n); q.push(n); }
  }
  return [...seen];
}

async function main() {
  const { rows: vendors } = await query(
    `SELECT id, name, zone_id, work_zone_id FROM npcs WHERE npc_type='vendor'`
  );

  const targets = [];   // { vendor, anchorId }
  const visited = new Set();
  for (const v of vendors) {
    const anchorId = v.work_zone_id || v.zone_id;
    if (!anchorId || visited.has(anchorId)) continue;
    const { rows: zRows } = await query('SELECT flags FROM zones WHERE id=$1', [anchorId]);
    const flags = zRows[0]?.flags || {};
    const net = await network(anchorId);
    for (const z of net) visited.add(z);
    // Only interior building networks are candidates. Outdoor stalls (no is_interior
    // anywhere in the reachable set) live on the city grid — nothing to dig.
    const isInteriorBuilding = flags.is_interior || flags.is_apartment;
    if (!isInteriorBuilding) continue;
    if (await buildingHasPower(query, anchorId)) continue;
    targets.push({ vendor: v.name, anchorId });
  }

  console.log(`Vendors scanned: ${vendors.length}`);
  console.log(`Missing power/utility (interior buildings): ${targets.length}`);
  targets.forEach(t => console.log(`  - ${t.vendor}  →  ${t.anchorId}`));

  if (!targets.length) { console.log('\nNothing to do.'); process.exit(0); }
  if (!APPLY) { console.log('\n[dry-run] nothing written. Re-run with --apply.'); process.exit(0); }

  for (const t of targets) {
    const made = await authorUtilityRoom(query, { anchorId: t.anchorId });
    console.log(`  ✓ ${t.vendor}: authored ${made.utilityRoomId} + ${made.generatorId}`);
  }
  console.log('\nNext: npm run content:export → review the diff → commit → push.');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
