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
//
// Order matters: the whole dump is one BEGIN…COMMIT, and FKs are checked
// immediately (none are DEFERRABLE), so any row that references a not-yet-
// inserted parent aborts the ENTIRE restore, not just that table. When adding a
// table, place it after everything it references.
//
// media_* has a true FK cycle (media_broadcasts.channel_id ↔
// media_channels.idle_broadcast_id). Those two constraints are now DEFERRABLE
// (schema.js) and buildDump() emits SET CONSTRAINTS ALL DEFERRED, so the cycle
// restores regardless of insert order — see docs/audits/findings-2026-07-content-shape.md.
const CONTENT_TABLES = [
  // Audio must precede zones: zones.audio_theme_id → audio_songs(id). samples
  // first (audio_instruments/audio_event_routes.sample_id → audio_samples).
  'audio_samples', 'audio_songs', 'audio_instruments', 'audio_sfx', 'audio_ambient', 'audio_event_routes',
  'zones', 'maps', 'items', 'enemies', 'zone_spawns',
  'npcs', 'furniture', 'doors', 'windows', 'sounds', 'interface_sfx', 'global_ambient_events',
  'loot_tables', 'recipes', 'drugs', 'mutations', 'combat_config', 'command_aliases', 'crimes',
  // Only personal apartments are content; corp HQs (owner_type='org') reference a
  // player-crew org that isn't exported, which would break the restore's FK.
  { table: 'apartments', where: "owner_type = 'player'" },
  'generators', 'power_zones', 'climate_profiles',
  'scripts', 'npc_banter_threads',
  // NPC factions live in the unified orgs table (is_npc=1); their inter-org
  // stances live in org_relations. Player crews (is_npc=0) are runtime, excluded.
  { table: 'orgs', where: 'is_npc = 1' },
  { table: 'org_relations', where: 'org_id IN (SELECT id FROM orgs WHERE is_npc = 1)' },
  // Scavenging/fishing loot templates (items reference scavenging_tables).
  'scavenging_tables', 'scavenging_table_items',
  // NPC-police surveillance backbone only; player-planted nets/devices are runtime.
  { table: 'security_networks', where: 'is_police = 1' },
  { table: 'security_devices', where: 'network_id IN (SELECT id FROM security_networks WHERE is_police = 1)' },
  'atm_networks',
  // Flight content: aircraft_types + ground AA emplacements. aircraft itself is
  // player/runtime. Declared in flight's plugin.json dataSchema but was unexported.
  'aircraft_types', 'aa_sites',
  // Broadcast/TV. themes first (channels.theme_id → media_themes); the
  // broadcasts↔channels cycle is handled by deferred constraints (see header).
  // deck_units/playlist/cameras reference channels+broadcasts, so they come last.
  'media_themes', 'media_broadcasts', 'media_channels',
  'media_deck_units', 'media_channel_playlist', 'media_cameras', 'media_graphics',
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
  // Defer FK checks to COMMIT so the media_broadcasts↔media_channels cycle (both
  // DEFERRABLE, see schema.js) can be inserted in any order within this transaction.
  parts.push('SET CONSTRAINTS ALL DEFERRED;');
  parts.push('');
  parts.push('-- ── SCHEMA ─────────────────────────────────────────────────────────────────');
  parts.push(SCHEMA_SQL.trim());
  parts.push('');
  parts.push('-- ── CONTENT ────────────────────────────────────────────────────────────────');

  for (const entry of CONTENT_TABLES) {
    const table = typeof entry === 'string' ? entry : entry.table;
    const where = typeof entry === 'string' ? '' : ` WHERE ${entry.where}`;
    const res = await query(`SELECT * FROM ${table}${where}`);
    const rows = res.rows;
    if (!rows.length) continue;
    parts.push('');
    parts.push(`-- ${table} (${rows.length} row${rows.length === 1 ? '' : 's'})`);
    const cols = Object.keys(rows[0]);
    // Map json/jsonb columns to their cast keyword. node-pg parses these into JS
    // values, so a jsonb column holding a scalar (a JSON number/bool/string) is
    // indistinguishable from a numeric/text column by value alone — we must cast
    // by the column's actual type (OID 3802=jsonb, 114=json), or Postgres rejects
    // e.g. a bare `5` for a jsonb column ("type jsonb but expression is numeric").
    const jsonCast = new Map((res.fields || [])
      .filter(f => f.dataTypeID === 3802 || f.dataTypeID === 114)
      .map(f => [f.name, f.dataTypeID === 114 ? 'json' : 'jsonb']));
    for (const row of rows) {
      parts.push(rowToInsert(table, cols, row, jsonCast));
    }
  }

  parts.push('');
  parts.push('COMMIT;');
  parts.push('');
  return parts.join('\n');
}

function rowToInsert(table, cols, row, jsonCast) {
  const colList = cols.map(c => `"${c}"`).join(', ');
  const valList = cols.map(c => sqlValue(row[c], jsonCast && jsonCast.get(c))).join(', ');
  // ON CONFLICT DO NOTHING so the dump is also safe to apply to a populated DB.
  return `INSERT INTO ${table} (${colList}) VALUES (${valList}) ON CONFLICT DO NOTHING;`;
}

function sqlValue(v, jsonCast) {
  if (v === null || v === undefined) return 'NULL';
  // json/jsonb column: JSON-encode + cast so scalars ("x", 5, true) and structured
  // values alike produce a valid literal. Driven by the column's real type, not v's.
  if (jsonCast) return `'${escapeStr(JSON.stringify(v))}'::${jsonCast}`;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (typeof v === 'object') {
    // Defensive: an object from a non-json column (shouldn't happen) still serializes.
    return `'${escapeStr(JSON.stringify(v))}'::jsonb`;
  }
  return `'${escapeStr(String(v))}'`;
}

// Postgres single-quote escaping (double the quote). The dump is plain SQL, so
// this is all that's needed for string literals.
function escapeStr(s) {
  return s.replace(/'/g, "''");
}
