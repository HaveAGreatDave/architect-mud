import { query } from '../server/models/db.js';

const groups = {
  'power_zones (Phase 1)':        `%power_zones%`,
  'recording_buffer (Phase 4)':   `%security_devices%recording_buffer%`,
  'resource save (Phase 6)':      `%UPDATE players SET hunger%`,
  'spawn join (Phase 5)':         `%zone_spawns%enemies%`,
  'flicker furniture (Phase 8)':  `%furniture%light_on%`,
};

try {
  const chk = await query(`SELECT extname FROM pg_extension WHERE extname='pg_stat_statements'`);
  if (!chk.rows.length) { console.log('pg_stat_statements NOT installed on this DB.'); process.exit(0); }
} catch (e) { console.log('cannot read pg_extension:', e.message); process.exit(1); }

for (const [label, pat] of Object.entries(groups)) {
  const { rows } = await query(
    `SELECT calls, total_exec_time::int AS total_ms, left(regexp_replace(query,'\s+',' ','g'),90) AS q
       FROM pg_stat_statements WHERE query ILIKE $1 ORDER BY calls DESC LIMIT 5`, [pat]);
  console.log(`\n=== ${label} ===`);
  if (!rows.length) { console.log('  (no matching statements)'); continue; }
  for (const r of rows) console.log(`  calls=${String(r.calls).padStart(9)}  total_ms=${String(r.total_ms).padStart(9)}  ${r.q}`);
}
process.exit(0);
