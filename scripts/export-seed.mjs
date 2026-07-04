// Regenerate the shared world snapshot (db/seed.sql) from your LOCAL database.
// Run this after you change content locally, then commit db/seed.sql so your
// teammate gets the same world with `git pull` + `npm run db:setup-local`.
//
//   npm run db:export-seed
//
// Requires the PostgreSQL client tools (pg_dump), which ship with the Postgres
// install. If pg_dump isn't on PATH, set PG_DUMP to its full path.
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SCHEMA_SQL } from '../server/models/schema.js';

const url = process.env.DATABASE_URL;
if (!url) { console.error('✗ DATABASE_URL is not set (check your .env).'); process.exit(1); }
const host = new URL(url).hostname;
if (!/^(localhost|127\.0\.0\.1|::1)$/.test(host)) {
  console.error(`✗ DATABASE_URL points at "${host}", not localhost. Export the seed from your LOCAL db only.`);
  process.exit(1);
}

// World/content tables only — mirrors server/api/backup.routes.js. The schema
// dump still covers ALL tables (the server needs them); only DATA is restricted,
// so player/runtime rows (and test artifacts) never end up in the shared seed.
const CONTENT_TABLES = [
  'zones', 'maps', 'items', 'enemies', 'zone_spawns', 'npcs', 'furniture', 'doors',
  'windows', 'sounds', 'global_ambient_events', 'loot_tables', 'recipes', 'drugs',
  'mutations', 'combat_config', 'command_aliases', 'apartments', 'generators',
  'power_zones', 'climate_profiles', 'scripts', 'npc_banter_threads', 'orgs', 'org_relations',
];

function resolvePgDump() {
  if (process.env.PG_DUMP) return process.env.PG_DUMP;
  const guesses = [];
  for (const v of ['18', '17', '16', '15']) guesses.push(`C:/Program Files/PostgreSQL/${v}/bin/pg_dump.exe`);
  for (const g of guesses) if (existsSync(g)) return g;
  return 'pg_dump'; // rely on PATH (Mac/Linux, or Windows with bin on PATH)
}
const pgDump = resolvePgDump();

function dump(args) {
  return execFileSync(pgDump, [url, '-n', 'public', '--no-owner', '--no-privileges', ...args],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}
const noBackslash = (s) => s.split('\n').filter(l => l[0] !== '\\').join('\n');

// Collect the INSERT statements from pg_dump --column-inserts output, preserving
// pg_dump's natural row order (dump order is stable across runs because the
// content tables aren't modified between exports). We deliberately DON'T re-sort
// rows: the regress harness picks fixtures by DB scan order (e.g. "first door-free
// zone with exits"), so re-ordering rows silently breaks content-sensitive tests.
// An INSERT can span lines when a value contains a newline, so we reassemble whole
// statements (terminated by a line ending in ';').
function stableData(raw) {
  const groups = new Map(); // table -> [statements] in first-seen order
  let buf = '';
  for (const line of raw.split('\n')) {
    if (!buf && !line.startsWith('INSERT INTO')) continue; // skip SET/comment/blank noise between statements
    buf += (buf ? '\n' : '') + line;
    if (/;\s*$/.test(line)) {
      const m = buf.match(/^INSERT INTO (\S+)/);
      if (m) { if (!groups.has(m[1])) groups.set(m[1], []); groups.get(m[1]).push(buf); }
      buf = '';
    }
  }
  const out = [];
  for (const t of CONTENT_TABLES) {
    const stmts = groups.get(`public.${t}`);
    if (stmts && stmts.length) { out.push(`-- ${t} (${stmts.length} rows)`, ...stmts, ''); }
  }
  return out.join('\n');
}

try {
  // Schema comes from SCHEMA_SQL — the codebase's single source of schema truth
  // (stable + versioned). Dumping schema from a running/used local DB is
  // non-deterministic (plugins add functions/tables at boot), so we don't.
  const schema = SCHEMA_SQL.trim();
  const tableArgs = CONTENT_TABLES.flatMap(t => ['-t', `public.${t}`]);
  // --column-inserts (not --inserts): names each column so rows load correctly
  // regardless of the physical column order SCHEMA_SQL produces vs the dump's.
  const data = stableData(noBackslash(dump(['--data-only', '--column-inserts', ...tableArgs])));

  const seed = [
    '-- Architect MUD — shared local seed (schema + world content). NO player/account rows, no secrets.',
    '-- Rebuild your local DB from this with:  npm run db:setup-local  (or npm run content:sync)',
    '-- Regenerate this file after content changes with:  npm run db:export-seed  (or npm run content:publish)',
    '',
    schema,
    '',
    '-- ── world content (FK checks disabled for the bulk load) ──',
    'SET session_replication_role = replica;',
    data,
    'SET session_replication_role = DEFAULT;',
    '',
  ].join('\n');

  const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'seed.sql');
  writeFileSync(out, seed, 'utf8');
  console.log(`✓ Wrote db/seed.sql (${(seed.length / 1024).toFixed(0)} KB). Commit it to share the world.`);
  process.exit(0);
} catch (e) {
  console.error('✗ export-seed failed:', e.message);
  if (e.stderr) console.error(String(e.stderr).trim());
  if (/ENOENT/.test(e.message)) console.error('  Could not find pg_dump. Set PG_DUMP to its full path.');
  process.exit(1);
}
