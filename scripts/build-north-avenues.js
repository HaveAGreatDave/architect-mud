// One-shot: tag new named avenues across the districts the east-flow reshape left
// bare — North City (the affluent NE block), Government Row's top edge, and the
// western Haul Road approach. Purely additive `flags.artery` tags on tiles that are
// ALREADY exit-connected along the street (verified below); no exits or topology are
// touched, so nothing re-grids. Companion to scripts/build-east-flow.js. Idempotent.
//
//   node scripts/build-north-avenues.js --dry   # print the plan + connectivity, write nothing
//   node scripts/build-north-avenues.js         # apply, then POST /api/world/reload (or restart)
//
// Prod: node --env-file=.env.prod scripts/build-north-avenues.js   (then reload prod)
import { query } from '../server/models/db.js';

const DRY = process.argv.includes('--dry');

// ── Named avenues. Tile order is along the street (each pair must be grid-adjacent
//    AND exit-linked both ways, else the road would draw over a wall). ────────────
const ARTERIES = {
  // North City — the affluent NE block, tagged into a small grid:
  'The Concourse': [ // E-W, y=-7: financial terrace
    'zone_nc_concordat', 'zone_nc_meridianheights', 'zone_nc_glass', 'zone_nc_bourse',
  ],
  'Palisade Walk': [ // E-W, y=-5
    'zone_nc_highwater', 'zone_nc_palisade', 'zone_nc_beacon', 'zone_nc_chancery',
  ],
  'Exchange Street': [ // N-S, x=8: crosses both Concourse and Palisade at the Bourse/Chancery
    'zone_nc_bourse', 'zone_nc_tessellate', 'zone_nc_chancery', 'zone_corp_argent',
  ],
  // Government Row + North City's west sliver — the civic top edge:
  'The Ministerial Mile': [ // E-W, y=-7: ties the ministries into Halcyon/Sable
    'zone_gov_ministry', 'zone_gov_assembly', 'zone_gov_prefect', 'zone_nc_halcyon', 'zone_nc_sable',
  ],
  'Sable Walk': [ // N-S, x=-1: NC-west spine, crosses the Ministerial Mile at Halcyon
    'zone_nc_halcyon', 'zone_nc_skyline', 'zone_nc_datum',
  ],
  // Western approach — revives the never-applied Haul Road and continues the existing
  // Grand Avenue west, so the two form one E-W spine clear across the map (x=-7 → 8):
  'The Haul Road': [ // E-W, y=0
    'zone_ashway_wash', 'zone_ashway_ashfall', 'zone_ashway_road', 'zone_ruins',
    'zone_badland_w_gate', 'zone_outskirts', 'zone_city_west', 'zone_threshold',
  ],
};

function link(exits, tgt) {
  for (const v of Object.values(exits || {}))
    for (const t of (Array.isArray(v) ? v : [v])) if (t === tgt) return true;
  return false;
}

async function main() {
  const { rows } = await query(`SELECT id,name,grid_x,grid_y,exits,flags FROM zones WHERE map_id='map_world'`);
  const byId = new Map(rows.map(r => [r.id, r]));

  // Validate every street is a real, walkable corridor before writing anything.
  let broken = 0;
  console.log('# AVENUE PLAN:');
  for (const [street, ids] of Object.entries(ARTERIES)) {
    const missing = ids.filter(id => !byId.get(id));
    console.log(`\n  ${street} (${ids.length} tiles)${missing.length ? '  MISSING: ' + missing.join(',') : ''}`);
    for (const id of ids) {
      const z = byId.get(id);
      if (z) console.log(`     (${String(z.grid_x).padStart(3)},${String(z.grid_y).padStart(3)}) ${id.padEnd(26)} "${z.name}"`);
    }
    for (let i = 0; i < ids.length - 1; i++) {
      const a = byId.get(ids[i]), b = byId.get(ids[i + 1]);
      if (!a || !b) { broken++; continue; }
      const adj = Math.abs(a.grid_x - b.grid_x) + Math.abs(a.grid_y - b.grid_y) === 1;
      const ok = adj && link(a.exits, b.id) && link(b.exits, a.id);
      if (!ok) { broken++; console.log(`     ✗ ${a.id} → ${b.id}: adj=${adj} not walkable both ways`); }
    }
  }
  if (broken) { console.log(`\n!! ABORT: ${broken} segment(s) are not walkable corridors. Not writing.`); process.exit(2); }
  console.log('\n# all segments verified walkable both ways.');

  if (DRY) { console.log('\n(dry run — nothing written)'); return; }

  let tagged = 0;
  for (const [street, ids] of Object.entries(ARTERIES)) {
    for (const id of ids) {
      const z = byId.get(id); if (!z) continue;
      const flags = z.flags || {};
      const artery = Array.isArray(flags.artery) ? flags.artery : (flags.artery ? [flags.artery] : []);
      if (!artery.includes(street)) artery.push(street);
      flags.artery = artery;
      await query('UPDATE zones SET flags=$1 WHERE id=$2', [JSON.stringify(flags), id]);
      tagged++;
    }
  }
  console.log(`\n✓ applied: ${tagged} artery tags written across ${Object.keys(ARTERIES).length} avenues.`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
