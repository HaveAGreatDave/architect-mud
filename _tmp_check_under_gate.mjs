import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,
});

const NW_ZONES = [
  'zone_up_vellum', 'zone_civ_steps', 'zone_gov_mezzanine',
  'zone_under_commons', 'zone_under_deep', 'zone_under_landing',
];

async function main() {
  // 1. Find the 14-tile NW enclave: govt block + west North City + zone_up_vellum,
  // by grid proximity. Pull everything with id LIKE zone_gov_% or zone_nc_% or zone_up_%
  // or zone_civ_% to be safe, then filter by known enclave membership via exits.
  const { rows: allZones } = await pool.query(
    `SELECT id, name, grid_x, grid_y, grid_z, exits FROM zones
     WHERE id LIKE 'zone_gov_%' OR id LIKE 'zone_nc_%' OR id LIKE 'zone_up_%'
        OR id LIKE 'zone_civ_%' OR id LIKE 'zone_under_%'
     ORDER BY grid_z, grid_y, grid_x`
  );

  console.log(`\n=== Found ${allZones.length} candidate zones (gov_/nc_/up_/civ_/under_ prefixes) ===\n`);
  for (const z of allZones) {
    console.log(`${z.id.padEnd(28)} (${z.grid_x},${z.grid_y},${z.grid_z})  exits=${JSON.stringify(z.exits)}`);
  }

  console.log(`\n=== Under corridor existence check ===`);
  for (const id of ['zone_under_commons', 'zone_under_deep', 'zone_under_landing']) {
    const found = allZones.find(z => z.id === id);
    console.log(`${id}: ${found ? 'EXISTS -> ' + JSON.stringify(found) : 'MISSING'}`);
  }

  console.log(`\n=== Specific zones from the report ===`);
  const { rows: specific } = await pool.query(
    `SELECT id, name, grid_x, grid_y, grid_z, exits FROM zones WHERE id = ANY($1)`,
    [['zone_up_vellum', 'zone_civ_steps']]
  );
  for (const z of specific) {
    console.log(`${z.id}: (${z.grid_x},${z.grid_y},${z.grid_z}) exits=${JSON.stringify(z.exits)}`);
  }

  // Compute all zones bordering the enclave to check surface crossings.
  // Enclave = zones with prefix zone_gov_ / zone_nc_ (west half, x<0 per docs) / zone_up_vellum.
  console.log(`\n=== Cross-reference: for each candidate zone, list exit targets outside the gov_/nc_/up_ prefix set ===`);
  const enclaveIds = new Set(allZones.filter(z => /^zone_(gov_|nc_|up_vellum)/.test(z.id)).map(z => z.id));
  console.log(`Enclave set (${enclaveIds.size}): ${[...enclaveIds].join(', ')}`);
  for (const z of allZones) {
    if (!enclaveIds.has(z.id)) continue;
    const exits = z.exits || {};
    const external = Object.entries(exits).filter(([dir, target]) => {
      const targets = Array.isArray(target) ? target : [target];
      return targets.some(t => typeof t === 'string' && !enclaveIds.has(t));
    });
    if (external.length) {
      console.log(`  ${z.id}: EXTERNAL exits -> ${JSON.stringify(external)}`);
    }
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
