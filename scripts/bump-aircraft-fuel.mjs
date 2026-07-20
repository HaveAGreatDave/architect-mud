import { query } from '../server/models/db.js';

// One-shot data transformation: ×4 all aircraft fuel tanks (content JSON already updated).
const NEW = {
  ac_mayfly: 680, ac_grasshopper: 800, ac_mule: 880, ac_locust: 960,
  ac_dragonfly: 1220, ac_carcass: 1360, ac_leviathan: 1760, ac_reaper: 3000,
};

for (const [id, cap] of Object.entries(NEW)) {
  const { rowCount } = await query('UPDATE aircraft_types SET fuel_capacity=$2 WHERE id=$1', [id, cap]);
  console.log(`${id} -> ${cap} (${rowCount} row)`);
}
process.exit(0);
