// An in-memory `content/` tree that authoring code can write to instead of a database.
//
// WHY THIS EXISTS
// ───────────────
// The dev panel's building generator (`apiBuildBuilding`) writes six tables with ~15
// bare `query()` calls and no transaction, and `POST /maps/build-building` syncs ZERO
// content files (content-sync.js resolves one entity per request; that route matches
// no arm). So a building built in the panel exists only in the author's local DB.
//
// The fix is not a better DB writer — it is to make the blueprints write FILES, which
// git already versions, reviews and deploys atomically. This module is that sink.
//
// TWO SURFACES, ONE STORE
// ───────────────────────
//   • the direct API  — get/all/put/patch/flush. Use this in new code.
//   • `store.sql()`   — a `query()`-SHAPED adapter, so existing authoring blueprints
//                       that take `query` as a parameter (tools/lib/utility-room.mjs)
//                       run unchanged against files.
//
// The adapter understands a deliberately CLOSED set of statements and THROWS, naming
// the SQL, on anything else. That is the whole safety property: it can never silently
// half-apply a statement it misread. If someone edits a blueprint's SQL, the CLI fails
// loudly at author time rather than quietly writing a wrong file.
//
// RUNTIME TABLES ARE ACCEPTED AND DISCARDED. `lighting_states` and friends are
// class:'runtime' — the engine recomputes them at boot, and `content:export` never
// emits them. Writes to them are counted and dropped, not errors: the blueprint is
// right to issue them against a live DB and right to have them evaporate here.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REGISTRY } from '../../server/models/content-registry.js';
import { SCHEMA_SQL } from '../../server/models/schema.js';
import { CONTENT_DIR, canonicalJson, fileNameForRow, schemaColumnsOf } from '../../scripts/content/lib.mjs';

// ── Column types from SCHEMA_SQL ─────────────────────────────────────────────
// Needed because the adapter receives jsonb parameters already JSON.stringify'd
// (that is how pg wants them) and files want them parsed back into real objects.
// Exported ONLY so regress can pin it. This function reads SCHEMA_SQL by regex,
// including the four-space column indent, so a reformat of the schema would empty
// it silently — and an empty type map does not fail, it downgrades every jsonb
// column to a pass-through string, so an exits graph or a flags lookup starts
// walking characters instead of keys. A test that it still finds columns is the
// difference between that being caught and being discovered downstream.
const typeCache = new Map();
export function columnTypesOf(table) {
  if (typeCache.has(table)) return typeCache.get(table);
  const types = new Map();
  const block = SCHEMA_SQL.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n  \\);`, 'm'));
  if (block) {
    for (const line of block[1].split('\n')) {
      // Second capture is the FIRST word of the type only — `exits JSONB DEFAULT '{}'`
      // must read as `jsonb`, not `jsonb default`, or every JSON column silently stays
      // a string and anything that walks it (an exits graph, a flags lookup) sees
      // characters instead of keys.
      const m = line.match(/^\s{4}"?([a-z_]+)"?\s+([A-Za-z]+)/);
      if (m && !['primary', 'foreign', 'unique', 'check', 'constraint'].includes(m[1])) {
        types.set(m[1], m[2].toLowerCase());
      }
    }
  }
  for (const m of SCHEMA_SQL.matchAll(new RegExp(`ALTER TABLE ${table}\\s+ADD COLUMN IF NOT EXISTS (\\w+)\\s+([A-Za-z]+)`, 'g'))) {
    types.set(m[1], m[2].toLowerCase());
  }
  typeCache.set(table, types);
  return types;
}

const isJsonCol = (table, col) => /^jsonb?$/.test(columnTypesOf(table).get(col) || '');

// ── SQL fragment parsing ─────────────────────────────────────────────────────
// Splits on commas at paren-depth 0 and outside single-quoted strings, so a comma
// inside a description literal doesn't become a column boundary.
function splitTopLevel(s) {
  const out = [];
  let depth = 0, quoted = false, buf = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === "'" && s[i + 1] === "'") { buf += "''"; i++; continue; }
      if (c === "'") quoted = false;
      buf += c;
      continue;
    }
    if (c === "'") { quoted = true; buf += c; continue; }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) { out.push(buf.trim()); buf = ''; continue; }
    buf += c;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function literalValue(tok, params, sql) {
  const t = tok.trim();
  const ph = t.match(/^\$(\d+)$/);
  if (ph) return params[Number(ph[1]) - 1] ?? null;
  if (/^null$/i.test(t)) return null;
  if (/^true$/i.test(t)) return true;
  if (/^false$/i.test(t)) return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  throw new Error(`content-store: cannot evaluate VALUES token \`${t}\` in:\n${sql}`);
}

// jsonb params arrive as JSON text; files want the parsed value.
function coerce(table, col, v) {
  if (typeof v === 'string' && isJsonCol(table, col)) {
    try { return JSON.parse(v); } catch { return v; }
  }
  return v;
}

// ── The store ────────────────────────────────────────────────────────────────
export function loadContentStore({ baseDir = CONTENT_DIR } = {}) {
  const entries = new Map(REGISTRY.filter(e => e.class === 'content').map(e => [e.table, e]));
  const runtimeTables = new Set(REGISTRY.filter(e => e.class !== 'content').map(e => e.table));
  const rows = new Map();       // table -> Map(pkString -> object)
  const dirty = new Map();      // table -> Set(pkString)
  const droppedRuntime = [];    // [table, ...] writes we accepted and discarded

  const keyOf = (table, obj) => entries.get(table).pk.map(c => String(obj[c])).join('\u0000');

  for (const [table] of entries) {
    const dir = join(baseDir, table);
    const map = new Map();
    if (existsSync(dir)) {
      for (const name of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
        const obj = JSON.parse(readFileSync(join(dir, name), 'utf8'));
        map.set(keyOf(table, obj), obj);
      }
    }
    rows.set(table, map);
    dirty.set(table, new Set());
  }

  const assertContent = (table, sql) => {
    if (entries.has(table)) return true;
    if (runtimeTables.has(table)) { droppedRuntime.push(table); return false; }
    throw new Error(`content-store: table "${table}" is not in the content registry.\n${sql}`);
  };

  const store = {
    baseDir,
    droppedRuntime,

    get(table, id) {
      return rows.get(table)?.get(String(id)) || null;
    },
    all(table) {
      return [...(rows.get(table)?.values() || [])];
    },
    put(table, obj) {
      if (!entries.has(table)) throw new Error(`content-store: "${table}" is not a content table.`);
      const key = keyOf(table, obj);
      rows.get(table).set(key, obj);
      dirty.get(table).add(key);
      return obj;
    },
    // Upsert semantics: merge `changes` onto the existing row, or create it.
    patch(table, id, changes) {
      const existing = store.get(table, id);
      return store.put(table, { ...(existing || {}), ...changes });
    },

    // Write every touched entity as a canonical content file. Returns the paths.
    flush({ dryRun = false } = {}) {
      const written = [];
      for (const [table, keys] of dirty) {
        if (!keys.size) continue;
        const entry = entries.get(table);
        const schemaCols = schemaColumnsOf(table);
        const excluded = new Set(entry.excludeColumns || []);
        const dir = join(baseDir, table);
        if (!dryRun) mkdirSync(dir, { recursive: true });
        for (const key of keys) {
          const obj = rows.get(table).get(key);
          const out = {};
          for (const [col, v] of Object.entries(obj)) {
            if (excluded.has(col)) continue;
            if (schemaCols.size && !schemaCols.has(col)) continue;
            out[col] = v;
          }
          const path = join(dir, fileNameForRow(entry, obj));
          const json = canonicalJson(out);
          const unchanged = existsSync(path) && readFileSync(path, 'utf8') === json;
          if (!unchanged && !dryRun) writeFileSync(path, json);
          if (!unchanged) written.push(path);
        }
      }
      return written;
    },

    // ── The `query()`-shaped adapter ──────────────────────────────────────────
    // Closed statement set. Anything unrecognised throws with the SQL in the message.
    sql() {
      return async function query(text, params = []) {
        const sql = String(text).replace(/\s+/g, ' ').trim();

        // INSERT INTO <t> (cols) VALUES (vals) [ON CONFLICT …]
        const ins = sql.match(/^INSERT INTO (\w+) \(([^)]*)\) VALUES /i);
        if (ins) {
          const [, table, colList] = ins;
          // Scan the VALUES list by hand rather than by regex: a description literal
          // may legitimately contain ')' and a lazy regex would cut the row in half.
          const open = ins[0].length;
          let depth = 0, quoted = false, close = -1;
          for (let i = open; i < sql.length; i++) {
            const c = sql[i];
            if (quoted) { if (c === "'" && sql[i + 1] === "'") i++; else if (c === "'") quoted = false; continue; }
            if (c === "'") { quoted = true; continue; }
            if (c === '(') depth++;
            else if (c === ')' && --depth === 0) { close = i; break; }
          }
          if (close < 0) throw new Error(`content-store: unbalanced VALUES list in:\n${sql}`);
          const valList = sql.slice(open + 1, close);
          const conflict = sql.slice(close + 1).replace(/^\s*ON CONFLICT\s*/i, '');
          if (!assertContent(table, sql)) return { rows: [] };
          const cols = colList.split(',').map(c => c.trim().replace(/"/g, ''));
          const vals = splitTopLevel(valList);
          if (cols.length !== vals.length) {
            throw new Error(`content-store: ${cols.length} columns but ${vals.length} values in:\n${sql}`);
          }
          const incoming = {};
          cols.forEach((c, i) => { incoming[c] = coerce(table, c, literalValue(vals[i], params, sql)); });
          const pk = entries.get(table).pk;
          const existing = pk.length === 1 ? store.get(table, incoming[pk[0]]) : null;
          if (existing && /DO NOTHING/i.test(conflict)) return { rows: [] };
          if (existing && /DO UPDATE/i.test(conflict)) {
            // Honour the SET list: a DO UPDATE deliberately refreshes only some columns.
            const setPart = conflict.match(/DO UPDATE SET (.*)$/i);
            const merged = { ...existing };
            for (const assign of splitTopLevel(setPart[1])) {
              const m = assign.match(/^(\w+)\s*=\s*(.+)$/);
              if (!m) throw new Error(`content-store: bad ON CONFLICT assignment \`${assign}\` in:\n${sql}`);
              merged[m[1]] = coerce(table, m[1], literalValue(m[2], params, sql));
            }
            store.put(table, merged);
            return { rows: [] };
          }
          store.put(table, existing ? { ...existing, ...incoming } : incoming);
          return { rows: [] };
        }

        // UPDATE <t> SET col=$n[, …] WHERE <pk>=$m
        const upd = sql.match(/^UPDATE (\w+) SET (.*) WHERE (\w+)\s*=\s*\$(\d+)$/i);
        if (upd) {
          const [, table, setList, whereCol, whereIdx] = upd;
          if (!assertContent(table, sql)) return { rows: [] };
          const id = params[Number(whereIdx) - 1];
          const row = store.all(table).find(r => String(r[whereCol]) === String(id));
          if (!row) return { rows: [] };
          const merged = { ...row };
          for (const assign of splitTopLevel(setList)) {
            const m = assign.match(/^(\w+)\s*=\s*(.+)$/);
            if (!m) throw new Error(`content-store: bad SET assignment \`${assign}\` in:\n${sql}`);
            merged[m[1]] = coerce(table, m[1], literalValue(m[2], params, sql));
          }
          store.put(table, merged);
          return { rows: [] };
        }

        // ── SELECTs: named shapes only ──────────────────────────────────────
        // Each of these mirrors one call in an authoring blueprint. New shapes are
        // added deliberately, here, with the blueprint that needs them.

        // whole-table column reads: SELECT <cols> FROM <t>
        let m = sql.match(/^SELECT ([\w, ]+) FROM (\w+)$/i);
        if (m) return { rows: store.all(m[2]) };

        // single row by id: SELECT <cols> FROM <t> WHERE id=$1
        m = sql.match(/^SELECT ([\w, .]+) FROM (\w+) WHERE id\s*=\s*\$1$/i);
        if (m) {
          const row = store.get(m[2], params[0]);
          return { rows: row ? [row] : [] };
        }

        // existence probe: SELECT 1 FROM furniture WHERE zone_id=$1 AND object_type='light' LIMIT 1
        m = sql.match(/^SELECT 1 FROM (\w+) WHERE zone_id\s*=\s*\$1 AND object_type\s*=\s*'(\w+)' LIMIT 1$/i);
        if (m) {
          const hit = store.all(m[1]).some(r => r.zone_id === params[0] && r.object_type === m[2]);
          return { rows: hit ? [{ '?column?': 1 }] : [] };
        }

        // power probe: SELECT 1 FROM generators WHERE zone_id = ANY($1::text[]) AND generator_type IN (…) LIMIT 1
        m = sql.match(/^SELECT 1 FROM generators WHERE zone_id = ANY\(\$1::text\[\]\) AND generator_type IN \(([^)]*)\) LIMIT 1$/i);
        if (m) {
          const kinds = new Set(m[1].split(',').map(s => s.trim().replace(/'/g, '')));
          const ids = new Set(params[0] || []);
          const hit = store.all('generators').some(g => ids.has(g.zone_id) && kinds.has(g.generator_type));
          return { rows: hit ? [{ '?column?': 1 }] : [] };
        }

        // city plants with their coords (the nearestCityPlant join)
        if (/^SELECT g\.id, z\.grid_x, z\.grid_y FROM generators g LEFT JOIN zones z ON z\.id = g\.zone_id WHERE g\.generator_type = 'city_plant'$/i.test(sql)) {
          return {
            rows: store.all('generators')
              .filter(g => g.generator_type === 'city_plant')
              .map(g => {
                const z = store.get('zones', g.zone_id);
                return { id: g.id, grid_x: z?.grid_x ?? null, grid_y: z?.grid_y ?? null };
              }),
          };
        }

        // fixture tally for lighting_states (a runtime table — the caller's INSERT is dropped)
        if (/^SELECT COUNT\(\*\)::int AS cnt, COALESCE\(SUM\(COALESCE\(lumen_output,0\)\),0\)::int AS lm FROM furniture WHERE zone_id=\$1 AND object_type='light'$/i.test(sql)) {
          const lights = store.all('furniture').filter(f => f.zone_id === params[0] && f.object_type === 'light');
          return { rows: [{ cnt: lights.length, lm: lights.reduce((a, f) => a + (f.lumen_output || 0), 0) }] };
        }

        throw new Error(
          `content-store: unrecognised SQL. The file sink understands a closed set of\n` +
          `statements on purpose — add this shape deliberately in tools/lib/content-store.mjs\n` +
          `rather than letting it be half-applied:\n  ${sql}`
        );
      };
    },
  };

  return store;
}
