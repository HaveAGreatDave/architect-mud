// One-shot: reshape the east-side road system for "direction and flow, not a grid".
//   1. Power Plant (Coolant Flats) → south-only dead end.
//   2. Thin selected downtown/Marquee/Yards 4-way crossroads into staggered
//      T-junctions (removes ONE vertical arm per column, alternating which avenue
//      each side-street tees into) so travel follows roads instead of graph-paper.
//   3. Tag a spine-and-ribs artery network (2 E-W avenues + 3 N-S streets) that the
//      client Avenue View renders — heavy on the Marquee + Yards.
//
// Additive/subtractive metadata + exits only; every mid-band tile and building
// entrance stays reachable (verified by a post-change BFS below). Idempotent.
//   node scripts/build-east-flow.js --dry     # print exact diff + connectivity, write nothing
//   node scripts/build-east-flow.js           # apply, then POST /api/world/reload (or restart)
import { query } from '../server/models/db.js';
import { removeExit } from '../server/engine/exits.js';

const DRY = process.argv.includes('--dry');

// ── Reciprocal exit removals (A dir→B, and B's reverse) ──────────────────────
// Each entry cuts the single edge between two grid-adjacent tiles both ways.
const REMOVE = [
  // Power Plant dead end: sever Civic Steps ↔ Coolant Flats (keep Coolant Flats'
  // south link to The Loading Bay + its `in` to the turbine hall).
  ['zone_civ_steps', 'south', 'zone_powerplantnew', 'north'],
  // Downtown/Marquee column thinning (staggered top/bottom tee):
  ['zone_media_plaza',   'south', 'zone_ext_1782953094650', 'north'], // x=0 → tees to Grand
  ['zone_velk_exterior', 'north', 'zone_meridian',          'south'], // x=2 → tees to Quay
  ['zone_dock_slip',     'south', 'zone_up_chrome',         'north'], // x=4 → tees to Grand
  ['zone_mq_precinct',   'north', 'zone_yard_depot',        'south'], // x=5 → tees to Quay
  // Yards stagger:
  ['zone_yard_dray',     'north', 'zone_yard_marshalling',  'south'], // x=7 → tees to Quay
];

// ── Named artery grid (spine-and-ribs). Tile order is along the street. ───────
const ARTERIES = {
  'Grand Avenue': [ // E-W main street: downtown → Marquee → Yards (y=0)
    'zone_city_west', 'zone_threshold', 'zone_thresholdeast', 'zone_velk_exterior',
    'zone_mq_marquee', 'zone_mq_battery', 'zone_mq_precinct',
    'zone_yard_loadout', 'zone_yard_dray', 'zone_yard_weighbridge',
  ],
  'Quay Road': [ // E-W dockside spine: Civic Steps → docks → Yards (y=-3)
    'zone_civ_steps', 'zone_media_plaza', 'zone_dock_wharf', 'zone_dock_quays',
    'zone_dock_fishmarket', 'zone_dock_slip', 'zone_corp_boardroom',
    'zone_yard_container', 'zone_yard_freightworks', 'zone_yard_gantry',
  ],
  'Cathode Street': [ // N-S Marquee cross-street, tees Quay↔Grand (x=3)
    'zone_dock_fishmarket', 'zone_up_skyway', 'zone_mq_cathode', 'zone_mq_marquee',
  ],
  'Boxcar Street': [ // N-S Yards cross-street (x=6)
    'zone_yard_container', 'zone_yard_sidings', 'zone_yard_boxcar', 'zone_yard_loadout',
  ],
  'Reefer Street': [ // N-S east-Yards cross-street (x=8)
    'zone_yard_gantry', 'zone_yard_crane', 'zone_yard_reefer', 'zone_yard_weighbridge',
  ],
};

async function loadZones() {
  const { rows } = await query(`SELECT id,name,grid_x,grid_y,exits,flags FROM zones`);
  return new Map(rows.map(r => [r.id, r]));
}

function bfsReachable(zmap, startId) {
  const seen = new Set([startId]); const q = [startId];
  while (q.length) {
    const z = zmap.get(q.shift()); if (!z) continue;
    for (const v of Object.values(z.exits || {}))
      for (const t of (Array.isArray(v) ? v : [v]))
        if (t && zmap.get(t) && !seen.has(t)) { seen.add(t); q.push(t); }
  }
  return seen;
}

async function main() {
  const zmap = await loadZones();

  // Simulate all removals on an in-memory copy of exits so we can BFS the RESULT.
  const sim = new Map([...zmap].map(([id, z]) => [id, { ...z, exits: JSON.parse(JSON.stringify(z.exits || {})) }]));
  const planned = [];
  for (const [a, dirA, b, dirB] of REMOVE) {
    for (const [zid, dir, tgt] of [[a, dirA, b], [b, dirB, a]]) {
      const z = sim.get(zid);
      if (!z) { console.log(`  ! missing zone ${zid}`); continue; }
      const had = JSON.stringify(z.exits[dir]);
      removeExit(z.exits, dir, tgt);
      if (had !== JSON.stringify(z.exits[dir])) planned.push(`  − ${zid} ${dir} ✗→ ${tgt}`);
    }
  }

  // Connectivity of the resulting graph (global, from the spawn tile).
  const before = bfsReachable(zmap, 'zone_city_west');
  const after = bfsReachable(sim, 'zone_city_west');
  const newlyStranded = [...before].filter(id => !after.has(id));

  // Every building/interior entrance (in/up/down exit target) must stay reachable.
  const entranceTiles = [...sim.values()].filter(z =>
    z.map_id !== undefined && Object.keys(z.exits || {}).some(d => ['in', 'up', 'down'].includes(d)));
  const strandedEntrances = entranceTiles.filter(z => !after.has(z.id)).map(z => z.id);

  console.log('# EXIT REMOVALS (reciprocal):');
  planned.forEach(l => console.log(l));
  console.log(`\n# CONNECTIVITY: before ${before.size} → after ${after.size} reachable (of ${zmap.size})`);
  console.log(`# newly unreachable: ${newlyStranded.length}${newlyStranded.length ? ' → ' + newlyStranded.join(', ') : ''}`);
  console.log(`# stranded building/stair entrances: ${strandedEntrances.length}${strandedEntrances.length ? ' → ' + strandedEntrances.join(', ') : ''}`);

  console.log('\n# ARTERY TAGS:');
  for (const [street, ids] of Object.entries(ARTERIES)) {
    const missing = ids.filter(id => !zmap.get(id));
    console.log(`  ${street}: ${ids.length} tiles${missing.length ? '  MISSING: ' + missing.join(',') : ''}`);
  }

  if (newlyStranded.length || strandedEntrances.length) {
    console.log('\n!! ABORT: change would strand tiles. Not writing.');
    process.exit(2);
  }

  if (DRY) { console.log('\n(dry run — nothing written)'); return; }

  // ── Apply ──────────────────────────────────────────────────────────────────
  for (const [a, dirA, b, dirB] of REMOVE) {
    for (const [zid, dir, tgt] of [[a, dirA, b], [b, dirB, a]]) {
      const z = zmap.get(zid); if (!z) continue;
      const exits = JSON.parse(JSON.stringify(z.exits || {}));
      removeExit(exits, dir, tgt);
      await query('UPDATE zones SET exits=$1 WHERE id=$2', [JSON.stringify(exits), zid]);
    }
  }
  let tagged = 0;
  for (const [street, ids] of Object.entries(ARTERIES)) {
    for (const id of ids) {
      const z = zmap.get(id); if (!z) continue;
      const flags = z.flags || {};
      const artery = Array.isArray(flags.artery) ? flags.artery : (flags.artery ? [flags.artery] : []);
      if (!artery.includes(street)) artery.push(street);
      flags.artery = artery;
      await query('UPDATE zones SET flags=$1 WHERE id=$2', [JSON.stringify(flags), id]);
      tagged++;
    }
  }
  console.log(`\n✓ applied: ${REMOVE.length} edges cut, ${tagged} artery tags written.`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
