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
// An entry may be a table name, or { table, where } to dump a filtered subset.
const CONTENT_TABLES = [
  'zones', 'maps', 'items', 'enemies', 'zone_spawns',
  'npcs', 'furniture', 'doors', 'windows', 'sounds', 'global_ambient_events',
  'loot_tables', 'recipes', 'drugs', 'mutations', 'combat_config', 'command_aliases',
  // Only personal apartments are content; corp HQs (owner_type='org') reference a
  // player-crew org that isn't exported, which would break the restore's FK.
  { table: 'apartments', where: "owner_type = 'player'" },
  'generators', 'power_zones', 'climate_profiles',
  'scripts', 'npc_banter_threads',
  // NPC factions live in the unified orgs table (is_npc=1); their inter-org
  // stances live in org_relations. Player crews (is_npc=0) are runtime, excluded.
  { table: 'orgs', where: 'is_npc = 1' },
  { table: 'org_relations', where: 'org_id IN (SELECT id FROM orgs WHERE is_npc = 1)' },
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

export async function buildDump() {
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

  for (const entry of CONTENT_TABLES) {
    const table = typeof entry === 'string' ? entry : entry.table;
    const where = typeof entry === 'string' ? '' : ` WHERE ${entry.where}`;
    const { rows } = await query(`SELECT * FROM ${table}${where}`);
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
