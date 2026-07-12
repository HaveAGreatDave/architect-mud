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
import { CONTENT_TABLES, EXCLUDED_TABLES } from '../models/content-registry.js';

// Table classification (what is content vs runtime vs player, FK order, filters,
// runtime-mutated columns) lives in server/models/content-registry.js — the single
// source of truth for table semantics. This module re-exports the legacy derived
// shapes so existing consumers (regress) keep importing from here unchanged. New
// code should import the registry directly.
export { CONTENT_TABLES, EXCLUDED_TABLES };

export async function handleBackupApi(path, method, body, auth) {
  if (path !== '/admin/export-dump') return null;
  if (method !== 'GET') return null;
  if (!auth || auth.role !== 'admin') {
    return { status: 403, body: { error: 'Admin access required' } };
  }
  const sql = await buildDump();
  return { status: 200, body: { sql, filename: `architect-dump.sql` } };
}

// opts.only  — dump only these tables (still schema-first, FK-safe order preserved).
// opts.skip  — dump every content table EXCEPT these.
// No opts → the full combined dump (unchanged) that dev-panel/db:restore use.
// only/skip only filter which content rows are emitted; SCHEMA_SQL is always embedded
// (idempotent), so a filtered file is still self-contained and restorable on its own.
export async function buildDump(opts = {}) {
  const { only, skip } = opts;
  const onlySet = only ? new Set(only) : null;
  const skipSet = skip ? new Set(skip) : null;
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
    if (onlySet && !onlySet.has(table)) continue;
    if (skipSet && skipSet.has(table)) continue;
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
