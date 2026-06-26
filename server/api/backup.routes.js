// Database backup / export API.
//
// Produces a full, self-contained SQL dump (schema + content data) of the live
// database. The schema half is SCHEMA_SQL — the single source of schema truth
// (server/models/schema.js) — so every backup automatically carries the exact
// schema needed to restore it; a schema change made via a one-shot script + a
// SCHEMA_SQL edit needs no separate bookkeeping here.
//
// The data half dumps only world/content tables (zones, items, enemies, ...).
// Player and runtime tables get their schema but NOT their rows, so backups
// never leak password hashes / emails and stay small.

import { query } from '../models/db.js';
import { SCHEMA_SQL } from '../models/schema.js';

// World/content tables whose rows are dumped, in FK-safe insertion order.
const CONTENT_TABLES = [
  'zones', 'maps', 'factions', 'items', 'enemies', 'zone_spawns',
  'npcs', 'furniture', 'doors', 'windows', 'sounds', 'global_ambient_events',
  'loot_tables', 'recipes', 'drugs', 'mutations', 'combat_config',
  'apartments', 'generators', 'power_zones', 'climate_profiles',
  'scripts',
];

export async function handleBackupApi(path, method, body, auth) {
  if (path !== '/admin/export-dump') return null;
  if (method !== 'GET') return null;
  if (!auth || auth.role !== 'admin') {
    return { status: 403, body: { error: 'Admin access required' } };
  }
  const sql = await buildDump();
  return { status: 200, body: { sql, filename: `architect-dump.sql` } };
}

async function buildDump() {
  const parts = [];
  parts.push('-- Architect MUD database dump');
  parts.push('-- Schema + world content. Player/runtime rows are intentionally excluded.');
  parts.push('-- Restore into an empty database: psql "$DATABASE_URL" -f this-file.sql');
  parts.push('');
  parts.push('BEGIN;');
  parts.push('');
  parts.push('-- ── SCHEMA ─────────────────────────────────────────────────────────────────');
  parts.push(SCHEMA_SQL.trim());
  parts.push('');
  parts.push('-- ── CONTENT ────────────────────────────────────────────────────────────────');

  for (const table of CONTENT_TABLES) {
    const { rows } = await query(`SELECT * FROM ${table}`);
    if (!rows.length) continue;
    parts.push('');
    parts.push(`-- ${table} (${rows.length} row${rows.length === 1 ? '' : 's'})`);
    const cols = Object.keys(rows[0]);
    for (const row of rows) {
      parts.push(rowToInsert(table, cols, row));
    }
  }

  parts.push('');
  parts.push('COMMIT;');
  parts.push('');
  return parts.join('\n');
}

function rowToInsert(table, cols, row) {
  const colList = cols.map(c => `"${c}"`).join(', ');
  const valList = cols.map(c => sqlValue(row[c])).join(', ');
  // ON CONFLICT DO NOTHING so the dump is also safe to apply to a populated DB.
  return `INSERT INTO ${table} (${colList}) VALUES (${valList}) ON CONFLICT DO NOTHING;`;
}

function sqlValue(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (typeof v === 'object') {
    // jsonb columns come back from node-pg already parsed into objects/arrays.
    return `'${escapeStr(JSON.stringify(v))}'::jsonb`;
  }
  return `'${escapeStr(String(v))}'`;
}

// Postgres single-quote escaping (double the quote). The dump is plain SQL, so
// this is all that's needed for string literals.
function escapeStr(s) {
  return s.replace(/'/g, "''");
}
