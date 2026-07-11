// One-shot content seed: the opening board of the drug war.
//
//   node scripts/seed-drugwar-turf.mjs
//
// Gives each of the three factions its natural district turf as zone_control
// rows so the drugwar plugin's tick has a board to play on. Idempotent: a zone
// that already has a controller is left as-is (players may have taken it), only
// its income/upkeep are kept current. Never seeds on boot (deliberate content).
//
// Mirrors the NATURAL map in plugins/drugwar/index.js. Zones are filtered against
// the live `zones` table, so a stale id is dropped with a warning rather than
// creating an orphan control row. A server restart (or /world reload) loads the
// rows into world.zoneControl.
import { query } from '../server/models/db.js';

// faction, zones, starting grip, income/day, upkeep/day
const TURF = [
  ['faction_franchise', ['zone_district_912_909', 'zone_district_907_908', 'zone_district_894_904', 'zone_district_912_912'], 65, 110, 40],
  ['faction_breakers',  ['zone_mq_pigeon_bar', 'zone_mq_cherry_floor', 'zone_district_902_908', 'zone_mq_sump_bar'], 65, 110, 40],
  ['faction_glitch',    ['zone_district_908_908', 'zone_district_916_909', 'zone_district_908_913', 'zone_district_909_906', 'zone_district_909_907'], 65, 110, 40],
];

async function seed() {
  const wanted = TURF.flatMap(([, zones]) => zones);
  const { rows: have } = await query('SELECT id FROM zones WHERE id = ANY($1)', [wanted]);
  const present = new Set(have.map(r => r.id));
  const missing = wanted.filter(z => !present.has(z));
  if (missing.length) console.warn(`⚠ dropping ${missing.length} unknown zone(s): ${missing.join(', ')}`);

  let seeded = 0;
  for (const [org, zones, grip, income, upkeep] of TURF) {
    for (const zone of zones) {
      if (!present.has(zone)) continue;
      // Insert the opening controller, but never stomp an existing controller
      // (a zone a player already claimed keeps its owner — only $ stays current).
      const res = await query(
        `INSERT INTO zone_control (zone_id, org_id, influence, challenger_org_id, base_income, base_upkeep)
         VALUES ($1,$2,$3,NULL,$4,$5)
         ON CONFLICT (zone_id) DO UPDATE SET base_income=$4, base_upkeep=$5`,
        [zone, org, grip, income, upkeep]
      );
      if (res.rowCount) seeded++;
    }
    console.log(`✓ ${org} — ${zones.filter(z => present.has(z)).length} zone(s) @ ${grip}% grip`);
  }
  console.log(`\n✓ Seeded/updated ${seeded} turf row(s). Restart the server (or /world reload) to load the board.`);
}

seed().then(() => process.exit(0)).catch(e => { console.error('✗ seed failed:', e); process.exit(1); });
