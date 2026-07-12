// Neon usage report — prints the DB-size trend from neon_usage_log plus the
// latest table breakdown. Local by default; against prod:
//   node --env-file=.env.prod scripts/usage-report.mjs
import { query } from '../server/models/db.js';

const fmt = (bytes) => {
  const b = Number(bytes);
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, n = b;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
};
const delta = (bytes) => {
  const d = Number(bytes);
  const sign = d > 0 ? '+' : d < 0 ? '-' : ' ';
  return d === 0 ? '     —' : `${sign}${fmt(Math.abs(d))}`;
};

const { rows } = await query(
  `SELECT captured_at, db_bytes, top_tables FROM neon_usage_log ORDER BY captured_at ASC`
);
if (!rows.length) {
  console.log('No usage snapshots yet. The logger writes one ~daily while players are online.');
  process.exit(0);
}

console.log(`\nNeon usage history — ${rows.length} snapshot(s)\n`);
console.log('  DATE               DB SIZE        Δ SINCE PREV');
console.log('  ' + '-'.repeat(48));
let prev = null;
for (const r of rows) {
  const when = new Date(r.captured_at).toISOString().slice(0, 16).replace('T', ' ');
  const d = prev === null ? 0 : Number(r.db_bytes) - prev;
  console.log(`  ${when}   ${fmt(r.db_bytes).padEnd(12)}   ${delta(d)}`);
  prev = Number(r.db_bytes);
}

// Latest breakdown — top_tables is a JSONB array of { table, bytes }.
const latest = rows[rows.length - 1];
const tables = Array.isArray(latest.top_tables) ? latest.top_tables : [];
if (tables.length) {
  console.log(`\nBiggest tables (latest snapshot):\n`);
  for (const t of tables.slice(0, 20)) {
    console.log(`  ${fmt(t.bytes).padStart(9)}  ${t.table}`);
  }
}
console.log();
process.exit(0);
