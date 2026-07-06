// Rebuild your LOCAL development database from the shared snapshot in db/seed.sql.
//
//   npm run db:setup-local
//
// Reads DATABASE_URL from .env, drops & recreates that database, and loads the
// committed world snapshot (schema + content, no player/account rows). Uses the
// `pg` driver directly, so no `psql` on PATH is required.
//
// Safety: refuses to run against a remote host — this only ever touches localhost.
import 'dotenv/config';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('✗ DATABASE_URL is not set. Copy .env and point it at your local Postgres, e.g.\n  DATABASE_URL=postgresql://postgres:postgres@localhost:5432/architect_dev');
  process.exit(1);
}

const target = new URL(url);
const host = target.hostname;
if (!/^(localhost|127\.0\.0\.1|::1)$/.test(host)) {
  console.error(`✗ Refusing to run: DATABASE_URL points at "${host}", not localhost.\n  This command DROPS and recreates the database — it must only touch your local machine.`);
  process.exit(1);
}
const dbName = decodeURIComponent(target.pathname.replace(/^\//, '')) || 'architect_dev';
const ident = (n) => '"' + n.replace(/"/g, '""') + '"';

// The world snapshot is two files: audio-seed.sql (bulky base64 audio, loaded FIRST
// because zones.audio_theme_id → audio_songs is an immediate FK) then seed.sql (the
// rest). See scripts/export-seed.mjs. audio-seed.sql predates neither — fall back to
// a legacy single seed.sql if the audio file isn't present.
const dbDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'db');
const audioSeed = existsSync(join(dbDir, 'audio-seed.sql'))
  ? readFileSync(join(dbDir, 'audio-seed.sql'), 'utf8')
  : null;
const seed = readFileSync(join(dbDir, 'seed.sql'), 'utf8');

const adminUrl = new URL(url);
adminUrl.pathname = '/postgres'; // maintenance DB — can't DROP the DB you're connected to

// The seed carries schema + world content but NO accounts, so a naive rebuild
// wipes your local login every time the shared world changes. Snapshot the
// runtime rows that are yours (not content) before the DROP, and re-insert them
// after the seed loads, so accounts/settings survive a `content:sync`.
const PRESERVE_TABLES = ['players', 'server_settings'];

// Turn a result set into idempotent INSERTs to replay after the reseed.
function rowsToInserts(table, res) {
  if (!res.rows.length) return [];
  const cols = Object.keys(res.rows[0]);
  const jsonCast = new Map((res.fields || [])
    .filter(f => f.dataTypeID === 3802 || f.dataTypeID === 114)
    .map(f => [f.name, f.dataTypeID === 114 ? 'json' : 'jsonb']));
  const lit = (v, cast) => {
    if (v === null || v === undefined) return 'NULL';
    if (cast) return `'${String(JSON.stringify(v)).replace(/'/g, "''")}'::${cast}`;
    if (typeof v === 'number') return String(v);
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (v instanceof Date) return `'${v.toISOString()}'`;
    if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
    return `'${String(v).replace(/'/g, "''")}'`;
  };
  const colList = cols.map(c => `"${c}"`).join(', ');
  return res.rows.map(row => {
    const vals = cols.map(c => lit(row[c], jsonCast.get(c))).join(', ');
    return `INSERT INTO ${ident(table)} (${colList}) VALUES (${vals}) ON CONFLICT DO NOTHING;`;
  });
}

async function snapshotPreserved() {
  const inserts = [];
  const existing = new pg.Client({ connectionString: url });
  try {
    await existing.connect();
  } catch {
    return inserts; // DB doesn't exist yet (first run) — nothing to preserve.
  }
  for (const table of PRESERVE_TABLES) {
    try {
      const res = await existing.query(`SELECT * FROM ${ident(table)}`);
      const rows = rowsToInserts(table, res);
      if (rows.length) {
        inserts.push(...rows);
        console.log(`  ↳ preserving ${rows.length} row(s) from ${table}`);
      }
    } catch { /* table absent in old DB — skip */ }
  }
  await existing.end();
  return inserts;
}

async function main() {
  const preserved = await snapshotPreserved();

  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  // Kick off any existing connections (e.g. a running dev server) so DROP succeeds.
  await admin.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()`,
    [dbName]
  );
  await admin.query(`DROP DATABASE IF EXISTS ${ident(dbName)}`);
  await admin.query(`CREATE DATABASE ${ident(dbName)}`);
  await admin.end();

  const db = new pg.Client({ connectionString: url });
  await db.connect();
  // Audio first (committed) so content's zones.audio_theme_id FK resolves.
  if (audioSeed) await db.query(audioSeed);
  await db.query(seed); // schema + content in one batch
  if (preserved.length) {
    await db.query(preserved.join('\n'));
    console.log(`✓ Re-applied ${preserved.length} preserved account/settings row(s)`);
  }
  await db.end();
  console.log(`✓ Local database "${dbName}" rebuilt from db/seed.sql`);
}

main().catch((e) => { console.error('✗ setup-local failed:', e.message); process.exit(1); });
