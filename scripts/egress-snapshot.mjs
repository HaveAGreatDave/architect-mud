import { query } from '../server/models/db.js';
const pats = {
  power_zone_update:    `UPDATE power_zone%SET status%`,
  power_zone_update2:   `UPDATE power_zone%capacity_kw = $2%`,
  resource_save:        `UPDATE players SET hunger=$1,thirst=$2,hp=$3,stamina=$4,body_temp_c=$5%`,
  spawn_join:           `SELECT e.%zone_spawns%`,
  flicker_furniture:    `SELECT name FROM furniture WHERE zone_id=$1 AND object_type=$2 AND light_on=$3%`,
  recording_buffer_upd: `UPDATE security_devices SET recording_buffer%`,
};
const snap = {};
for (const [k, p] of Object.entries(pats)) {
  const { rows } = await query(
    `SELECT COALESCE(SUM(calls),0)::bigint AS calls, COALESCE(SUM(total_exec_time),0)::int AS total_ms
       FROM pg_stat_statements WHERE query ILIKE $1`, [p]);
  snap[k] = { calls: Number(rows[0].calls), total_ms: rows[0].total_ms };
}
console.log(JSON.stringify(snap, null, 2));
process.exit(0);
