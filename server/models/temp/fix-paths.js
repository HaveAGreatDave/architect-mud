import 'dotenv/config';
import { query, getClient } from '../db.js';
import { validateMapLayout } from '../../engine/mapValidation.js';

const client = await getClient();
async function setExits(id, mutate) {
  const { rows } = await client.query('SELECT exits FROM zones WHERE id=$1', [id]);
  if (!rows.length) throw new Error(`zone ${id} not found`);
  const exits = { ...(rows[0].exits || {}) };
  mutate(exits);
  await client.query('UPDATE zones SET exits=$1, updated_at=EXTRACT(EPOCH FROM NOW()) WHERE id=$2', [JSON.stringify(exits), id]);
  console.log(`  ${id} exits -> ${JSON.stringify(exits)}`);
}

try {
  await client.query('BEGIN');

  console.log('# Remove broken exits');
  await setExits('zone_velk_exterior', e => { delete e.east; });
  await setExits('zone_deep_waste',    e => { delete e.west; delete e.south; });
  await setExits('zone_ruins',         e => { delete e.north; });
  await setExits('zone_drum_exterior', e => { delete e.south; });
  await setExits('zone_city_north',    e => { delete e.north; });

  console.log('# Add grid-correct exits');
  await setExits('zone_city_west',     e => { e.west = 'zone_outskirts'; });
  await setExits('zone_outskirts',     e => { e.east = 'zone_city_west'; });
  await setExits('zone_thresholdeast', e => { e.east = 'zone_velk_exterior'; e.in = 'zone_furniture_store'; });

  console.log('# Furniture store -> proper interior map');
  await client.query(
    `INSERT INTO maps (id, name, parent_zone_id, entry_zone_id)
     VALUES ('map_int_furniture', 'Dead Space Interiors — Interior', 'zone_thresholdeast', 'zone_furniture_store')
     ON CONFLICT (id) DO UPDATE SET parent_zone_id=EXCLUDED.parent_zone_id, entry_zone_id=EXCLUDED.entry_zone_id`
  );
  await client.query(
    `UPDATE zones SET map_id='map_int_furniture', parent_zone='zone_thresholdeast',
       grid_x=0, grid_y=0, grid_z=0 WHERE id='zone_furniture_store'`
  );
  console.log('  zone_furniture_store -> map_int_furniture @(0,0,0)');

  console.log('# Reposition basements directly below their shops (up/down geometry)');
  await client.query(`UPDATE zones SET grid_x=0, grid_y=0, grid_z=-1 WHERE id='zone_velk_basement'`);
  await client.query(`UPDATE zones SET grid_x=0, grid_y=0, grid_z=-1 WHERE id='zone_drum_basement'`);
  console.log('  zone_velk_basement, zone_drum_basement -> (0,0,-1)');

  console.log('# Fix world map entry zone');
  await client.query(`UPDATE maps SET entry_zone_id='zone_threshold' WHERE id='map_world'`);
  console.log('  map_world.entry_zone_id -> zone_threshold');

  await client.query('COMMIT');
  console.log('\nCOMMITTED.');
} catch (e) {
  await client.query('ROLLBACK');
  console.error('ROLLED BACK:', e.message);
  client.release();
  process.exit(1);
}
client.release();

// Re-validate
const { rows: zones } = await query(`SELECT id, name, map_id, grid_x, grid_y, grid_z, exits FROM zones`);
const { errors, warnings } = validateMapLayout(zones);
console.log(`\n=== POST-FIX VALIDATION ===`);
console.log(`errors: ${errors.length}, warnings: ${warnings.length}`);
const byId = new Map(zones.map(z => [z.id, z]));
const lbl = id => { const z = byId.get(id); return z ? `${id}("${z.name}")` : id; };
errors.forEach(e => console.log(`  ERROR ${e.reason}: ${lbl(e.zoneId)} --${e.direction}--> ${lbl(e.targetId)}`));
warnings.forEach(w => console.log(`  WARN ${w.reason}: ${lbl(w.zoneId)} --${w.direction}--> ${lbl(w.targetId)}`));
process.exit(0);
