import { query } from './server/models/db.js';
const ids = ['zone_district_924_903','zone_district_893_908'];
for (const id of ids) {
  const { rows } = await query(`SELECT id, name, exits, flags FROM zones WHERE id=$1`, [id]);
  const z = rows[0];
  console.log(`\n### ${z.id}  "${z.name}"`);
  console.log(`  exits: ${JSON.stringify(z.exits)}`);
  console.log(`  flags: ${JSON.stringify(z.flags)}`);
  // interior map behind this facade
  const { rows: m } = await query(`SELECT id, entry_zone_id FROM maps WHERE parent_zone_id=$1`, [id]);
  for (const mp of m) {
    const { rows: ez } = await query(`SELECT id, name, flags FROM zones WHERE id=$1`, [mp.entry_zone_id]);
    console.log(`  interior map ${mp.id} entry=${mp.entry_zone_id} flags=${JSON.stringify(ez[0]?.flags)}`);
  }
}
// tiles adjacent to runway centreline column x=925 and the hangar row y=903
console.log('\n### tiles near runway/hangar (x 923-926, y 902-904) ###');
const { rows: near } = await query(`SELECT id, name, grid_x gx, grid_y gy, marker, color, flags->>'airfield_id' af, flags->>'is_building' ib
  FROM zones WHERE map_id='map_world' AND grid_x BETWEEN 923 AND 926 AND grid_y BETWEEN 902 AND 904 ORDER BY grid_y, grid_x`);
for (const r of near) console.log(`  (${r.gx},${r.gy}) ${r.id}  "${r.name}" mark=${r.marker} af=${r.af} bld=${r.ib}`);
process.exit(0);
