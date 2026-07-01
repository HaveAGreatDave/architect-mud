import { query } from '../db.js';
async function main() {
  const { rows: gens } = await query(`SELECT * FROM generators ORDER BY generator_type, id`);
  console.log('=== generators ===');
  for (const g of gens) console.log(JSON.stringify(g));

  const { rows: cold } = await query(
    `SELECT id, name, map_id, grid_x, grid_y, grid_z, parent_zone, flags, exits
     FROM zones WHERE id ILIKE '%coldwater%' OR name ILIKE '%coldwater%' OR id ILIKE '%clone%' OR name ILIKE '%clone%' ORDER BY id`
  );
  console.log('\n=== coldwater/clone zones ===');
  for (const z of cold) console.log(`${z.id} | ${z.name} | map=${z.map_id} grid=(${z.grid_x},${z.grid_y},${z.grid_z}) parent=${z.parent_zone} flags=${JSON.stringify(z.flags)} exits=${JSON.stringify(z.exits)}`);

  // zones that contain a city_plant / junction_box generator
  console.log('\n=== zones hosting generators ===');
  for (const g of gens) {
    const { rows } = await query(`SELECT id, name, map_id FROM zones WHERE id=$1`, [g.zone_id]);
    console.log(`gen ${g.id} (${g.generator_type}) -> zone ${g.zone_id} : ${rows[0]?.name || 'MISSING ZONE'} (map ${rows[0]?.map_id})`);
  }

  // furniture columns sample
  const { rows: furnCols } = await query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name='furniture' ORDER BY ordinal_position`
  );
  console.log('\n=== furniture columns ===');
  console.log(furnCols.map(c => `${c.column_name}:${c.data_type}`).join(', '));

  const { rows: genCols } = await query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name='generators' ORDER BY ordinal_position`
  );
  console.log('\n=== generators columns ===');
  console.log(genCols.map(c => `${c.column_name}:${c.data_type}`).join(', '));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
