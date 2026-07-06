// Additive content pull: PROD → LOCAL. Reads named content tables from production
// and inserts any missing rows into your local DB with ON CONFLICT DO NOTHING — so
// it ADDS prod-only content and NEVER overwrites or deletes what you have locally
// (your flight work, local authoring, etc. are safe). Read-only against prod.
//
//   node scripts/content-pull-prod.mjs                 # pulls the default "clean" set
//   node scripts/content-pull-prod.mjs quests audio_songs   # pull specific tables
//
// Tables are pulled in CONTENT_TABLES order (FK-safe) inside one deferred-constraint
// transaction. Honors each table's CONTENT_TABLES WHERE filter (so it won't drag in
// player/runtime rows from mixed tables like security_devices). Only touches LOCAL.
import 'dotenv/config';
import pg from 'pg';
import { CONTENT_TABLES } from '../server/api/backup.routes.js';

// Default: the buckets that are prod-only and safe (no local rows at risk). The
// forked media_* / furniture / recipes tables are deliberately EXCLUDED — they need
// a human merge decision, not a blind additive pull.
const DEFAULT_SET = [
  'audio_samples', 'audio_songs', 'audio_instruments', 'audio_sfx', 'audio_ambient', 'audio_event_routes',
  'zone_spawns', 'quests', 'scavenging_tables', 'scavenging_table_items',
  'security_networks', 'security_devices', 'atm_networks',
];

const requested = new Set(process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_SET);

const LOCAL = process.env.DATABASE_URL, PROD = process.env.PROD_DATABASE_URL;
if (!LOCAL || !PROD) { console.error('✗ Need DATABASE_URL (local) + PROD_DATABASE_URL in .env'); process.exit(1); }
if (/^(localhost|127\.0\.0\.1|::1)$/.test(new URL(PROD).hostname)) { console.error('✗ PROD_DATABASE_URL is not remote — aborting.'); process.exit(1); }
if (!/^(localhost|127\.0\.0\.1|::1)$/.test(new URL(LOCAL).hostname)) { console.error('✗ DATABASE_URL must be localhost — this writes to it.'); process.exit(1); }

const prod = new pg.Client({ connectionString: PROD, ssl: { rejectUnauthorized: false } });
const local = new pg.Client({ connectionString: LOCAL });
await prod.connect();
await local.connect();

const escapeStr = (s) => s.replace(/'/g, "''");
function sqlValue(v, jsonCast) {
  if (v === null || v === undefined) return 'NULL';
  if (jsonCast) return `'${escapeStr(JSON.stringify(v))}'::${jsonCast}`;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (typeof v === 'object') return `'${escapeStr(JSON.stringify(v))}'::jsonb`;
  return `'${escapeStr(String(v))}'`;
}

await local.query('BEGIN');
await local.query('SET CONSTRAINTS ALL DEFERRED');
let grandInserted = 0;
try {
  for (const entry of CONTENT_TABLES) {            // iterate in FK-safe order
    const table = typeof entry === 'string' ? entry : entry.table;
    if (!requested.has(table)) continue;
    const where = typeof entry === 'string' ? '' : ` WHERE ${entry.where}`;
    const res = await prod.query(`SELECT * FROM ${table}${where}`);
    if (!res.rows.length) { console.log(`  ${table.padEnd(26)} prod has 0 rows — skip`); continue; }
    const cols = Object.keys(res.rows[0]);
    const jsonCast = new Map((res.fields || [])
      .filter(f => f.dataTypeID === 3802 || f.dataTypeID === 114)
      .map(f => [f.name, f.dataTypeID === 114 ? 'json' : 'jsonb']));
    const colList = cols.map(c => `"${c}"`).join(', ');
    let inserted = 0;
    for (const row of res.rows) {
      const vals = cols.map(c => sqlValue(row[c], jsonCast.get(c))).join(', ');
      const r = await local.query(`INSERT INTO ${table} (${colList}) VALUES (${vals}) ON CONFLICT DO NOTHING`);
      inserted += r.rowCount;
    }
    grandInserted += inserted;
    console.log(`  ${table.padEnd(26)} prod ${String(res.rows.length).padStart(4)} → inserted ${String(inserted).padStart(4)} (skipped ${res.rows.length - inserted} already present)`);
  }
  await local.query('COMMIT');
  console.log(`\n✓ Pulled ${grandInserted} new row(s) into local. Nothing local was overwritten or deleted.`);
} catch (e) {
  await local.query('ROLLBACK');
  console.error('✗ Pull failed, rolled back:', e.message);
  process.exitCode = 1;
}
await prod.end();
await local.end();
