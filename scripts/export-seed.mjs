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

try {
  const schema = noBackslash(dump(['--schema-only']))
    .split('\n')
    .filter(l => !/^CREATE SCHEMA public;|^COMMENT ON SCHEMA public/.test(l))
    .join('\n');
  const tableArgs = CONTENT_TABLES.flatMap(t => ['-t', `public.${t}`]);
  const data = noBackslash(dump(['--data-only', '--inserts', ...tableArgs]));

  const seed = [
    '-- Architect MUD — shared local seed (schema + world content). NO player/account rows, no secrets.',
    '-- Rebuild your local DB from this with:  npm run db:setup-local',
    '-- Regenerate this file after content changes with:  npm run db:export-seed',
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
} catch (e) {
  console.error('✗ export-seed failed:', e.message);
  if (/ENOENT/.test(e.message)) console.error('  Could not find pg_dump. Set PG_DUMP to its full path.');
  process.exit(1);
}
