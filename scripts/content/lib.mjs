// Shared plumbing for the content pipeline (export / import / lint / status).
//
// The pipeline's contract, end to end:
//   content/<table>/<pk>.json     one file per content row (registry-classified)
//   canonical serialization       recursively sorted keys, 2-space indent, LF,
//                                 trailing newline — so the same row always
//                                 produces the same bytes on every machine
//   excludeColumns                runtime-mutated columns never enter files
//   where-predicates              rows outside a table's content predicate never
//                                 enter files and are never deleted by the pipeline
//
// Everything here derives from server/models/content-registry.js. There is no
// second table list.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { contentEntries } from '../../server/models/content-registry.js';
import { SCHEMA_SQL } from '../../server/models/schema.js';

// Columns SCHEMA_SQL declares for a table (CREATE TABLE body + ADD COLUMN retrofits).
// This is the AUTHORITATIVE column set for content files: prod is built from
// SCHEMA_SQL, so a column the live DB happens to carry but the schema doesn't
// declare (a legacy leftover from an old dump) must never enter a file. Export
// and import serialize through here; content:lint validates against the same
// parse — so the writer and the checker can't drift.
const schemaColsCache = new Map();
export function schemaColumnsOf(table) {
  if (schemaColsCache.has(table)) return schemaColsCache.get(table);
  const cols = new Set();
  const block = SCHEMA_SQL.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n  \\);`, 'm'));
  if (block) {
    for (const line of block[1].split('\n')) {
      const m = line.match(/^\s{4}"?([a-z_]+)"?\s/);
      if (m && !['primary', 'foreign', 'unique', 'check', 'constraint'].includes(m[1])) cols.add(m[1]);
    }
  }
  for (const m of SCHEMA_SQL.matchAll(new RegExp(`ALTER TABLE ${table}\\s+ADD COLUMN IF NOT EXISTS (\\w+)`, 'g'))) {
    cols.add(m[1]);
  }
  schemaColsCache.set(table, cols);
  return cols;
}

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CONTENT_DIR = join(REPO_ROOT, 'content');
export const MARKER_KEY = 'content_pipeline.last_imported_sha';

// ── Target database selection ────────────────────────────────────────────────
// Local commands must stay off prod by accident: the default target is
// DATABASE_URL and must be localhost. --prod switches to PROD_DATABASE_URL,
// prints the host, and requires --yes (CI) or an interactive confirmation.
export function needsSsl(url) {
  try {
    return !/^(localhost|127\.0\.0\.1|::1)$/.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function isLocalUrl(url) {
  try {
    return /^(localhost|127\.0\.0\.1|::1)$/.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

export async function connectTarget({ prod = false, yes = false, purpose = 'operate on' } = {}) {
  const url = prod ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) {
    throw new Error(prod ? 'PROD_DATABASE_URL is not set (check .env / .env.prod).' : 'DATABASE_URL is not set (check your .env).');
  }
  const host = new URL(url).hostname;
  if (!prod && !isLocalUrl(url)) {
    throw new Error(`DATABASE_URL points at "${host}", not localhost. Local content commands refuse remote targets; use --prod deliberately.`);
  }
  if (prod) {
    console.log(`⚠ target: ${host} (PRODUCTION)`);
    if (!yes) {
      const { createInterface } = await import('node:readline/promises');
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await rl.question(`Type the host name to ${purpose} production: `);
      rl.close();
      if (answer.trim() !== host) throw new Error('Confirmation did not match — aborted.');
    }
  }
  const client = new pg.Client({ connectionString: url, ssl: needsSsl(url) ? { rejectUnauthorized: false } : false });
  await client.connect();
  if (prod) meterProdEgress(client, host, purpose);
  return { client, host, url };
}

// ── Prod egress meter ────────────────────────────────────────────────────────
// Every `--prod` script spends from the same 5 GB/month transfer budget the game
// runs on, and until now a one-shot that pulled a whole table said nothing about
// it. The September 2026 investigation is the case for this: egress ran 89 MB
// one day and 600 MB the next, and the only surviving evidence of what did it
// was a seq-scan counter on `zones` — the scripts themselves had been deleted by
// the time anybody looked. A number printed at the time would have named it in
// one line. So measure what leaves Neon, say it out loud, and keep a local trail.
//
// The figure is EXACT WIRE BYTES, not an estimate. `socket.bytesRead` is what the
// kernel handed us, which is the thing Neon bills; stringifying result sets to
// guess their size would cost a full extra copy of every export AND disagree with
// the bill. Where the socket isn't reachable the meter degrades to a row count
// rather than guessing — an absent byte figure is better than a wrong one, since
// the only reason this exists is for somebody to trust it.
//
// ⚠ It reports on process exit, never on `client.end()`. A run that throws half
// way through has still spent the egress, and that is exactly the run you want
// the number for.
const EGRESS_LOG = join(REPO_ROOT, 'data', 'ops', 'prod-reads.log');
// Loud above this. A full content export is ~13.5 MB, so the threshold sits just
// under two of them: routine pipeline work stays quiet, and anything that reads
// the world twice over announces itself.
// PROD_EGRESS_WARN_MB overrides it — which is also how the loud path gets
// exercised without spending 25 MB to see it.
const EGRESS_WARN_BYTES = (Number(process.env.PROD_EGRESS_WARN_MB) || 25) * 1024 * 1024;

function meterProdEgress(client, host, purpose) {
  const socket = client.connection?.stream;
  const startBytes = typeof socket?.bytesRead === 'number' ? socket.bytesRead : null;
  const started = Date.now();
  let queries = 0;
  let rows = 0;

  const origQuery = client.query.bind(client);
  client.query = function meteredQuery(...args) {
    queries++;
    const res = origQuery(...args);
    // pg returns a promise for the callback-free form and a Query object
    // otherwise; only the promise carries a rowCount we can read from here. A
    // rejection is swallowed — the caller still gets the original promise, and
    // this must never turn a query error into an unhandled rejection.
    if (res && typeof res.then === 'function') {
      res.then((r) => { rows += r?.rowCount || 0; }, () => {});
    }
    return res;
  };

  process.on('exit', () => {
    const bytes = startBytes === null || typeof socket?.bytesRead !== 'number'
      ? null
      : socket.bytesRead - startBytes;
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    const size = bytes === null ? `${rows} rows (byte count unavailable)` : formatBytes(bytes);
    const line = `prod egress: ${size} over ${queries} quer${queries === 1 ? 'y' : 'ies'}, ${secs}s — ${host}`;
    if (bytes !== null && bytes >= EGRESS_WARN_BYTES) {
      console.warn(`\n⚠ ${line}\n  That is a material slice of Neon's 5 GB/month transfer budget — see docs/ops-usage-watch.md.`);
    } else {
      console.log(line);
    }
    try {
      mkdirSync(dirname(EGRESS_LOG), { recursive: true });
      appendFileSync(EGRESS_LOG, `${JSON.stringify({
        at: new Date().toISOString(),
        host,
        purpose,
        script: process.argv[1] ? process.argv[1].split(/[\\/]/).pop() : null,
        queries,
        rows,
        bytes,
        seconds: Number(secs),
      })}\n`, 'utf8');
    } catch {
      // A missing trail must never fail the script that was doing the real work.
    }
  });
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

// ── Canonical serialization ──────────────────────────────────────────────────
// Recursive key sort locks jsonb key order regardless of Postgres internals;
// arrays keep their order (order is meaning there). LF + trailing newline.
function sortValue(v) {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortValue(v[k]);
    return out;
  }
  return v;
}

export function canonicalJson(obj) {
  return JSON.stringify(sortValue(obj), null, 2) + '\n';
}

// ── Row ⇄ file-object conversion ─────────────────────────────────────────────
// pg gives us: strings for bigint/numeric/text, numbers for int/real, Date for
// timestamps, parsed JS values for json/jsonb, null for NULL. Dates become ISO
// strings (deterministic, UTC); everything else is already JSON-able.
export function rowToFileObject(entry, row) {
  const excluded = new Set(entry.excludeColumns || []);
  // Absent-by-default override columns: a null means "no override", and a file
  // that spells that out is 5,785 copies of a non-statement. Omit the key; the
  // importer writes an explicit NULL for anything on this list that's missing,
  // so absence still clears a removed override.
  const omitWhenNull = new Set(entry.omitWhenNull || []);
  const schemaCols = schemaColumnsOf(entry.table);
  const out = {};
  for (const [col, v] of Object.entries(row)) {
    if (excluded.has(col)) continue;
    if (v === null && omitWhenNull.has(col)) continue;
    // Drop columns SCHEMA_SQL doesn't declare (legacy leftovers on a Frankenstein
    // local DB): prod never has them and lint rejects them. Fail open if the table
    // isn't found in the schema parse, rather than emptying the file.
    if (schemaCols.size && !schemaCols.has(col)) continue;
    out[col] = v instanceof Date ? v.toISOString() : v;
  }
  return out;
}

// Filename from pk values: parts joined with '__', each sanitized for the
// filesystem. The full pk also lives INSIDE the file — the filename is only an
// address, never parsed back into a key.
export function fileNameForRow(entry, row) {
  const parts = entry.pk.map(col => {
    const v = row[col];
    if (v === null || v === undefined) throw new Error(`${entry.table}: row has NULL pk column "${col}"`);
    return String(v).replace(/[^A-Za-z0-9._-]/g, '_');
  });
  return parts.join('__') + '.json';
}

// ── Export core ──────────────────────────────────────────────────────────────
// Dumps every content row of `client`'s database into targetDir as canonical
// files, then removes stale files (rows that vanished). Collision-checks the
// whole run before writing anything. Returns per-table stats.
export async function exportContent(client, targetDir) {
  const stats = [];
  const plan = []; // [{ entry, dir, files: Map<name, json> }]

  for (const entry of contentEntries()) {
    const where = entry.where ? ` WHERE ${entry.where}` : '';
    const orderBy = entry.pk.map(c => `"${c}"`).join(', ');
    const { rows } = await client.query(`SELECT * FROM ${entry.table}${where} ORDER BY ${orderBy}`);
    const files = new Map();
    for (const row of rows) {
      // Runtime rows living in content tables must NEVER become git files, or git
      // starts owning transient state (deploys overwrite it; a file deletion deletes
      // it). Player-bought furniture and SPECTER surveillance recordings both mint
      // rows during play — skip them at the source.
      if (isRuntimeResidueId(entry.table, row.id)) {
        console.warn(`  ⚠ ${entry.table}/${row.id}: runtime row (not authored content), not exported.`);
        continue;
      }
      const name = fileNameForRow(entry, row);
      if (files.has(name)) {
        throw new Error(`${entry.table}: filename collision "${name}" — two rows sanitize to the same file. Rename one id.`);
      }
      files.set(name, canonicalJson(rowToFileObject(entry, row)));
    }
    plan.push({ entry, dir: join(targetDir, entry.table), files });
  }

  for (const { entry, dir, files } of plan) {
    mkdirSync(dir, { recursive: true });
    let created = 0, updated = 0, unchanged = 0, removed = 0;
    const existing = new Set(readdirSync(dir).filter(f => f.endsWith('.json')));
    for (const [name, json] of files) {
      const path = join(dir, name);
      if (existing.has(name)) {
        const prev = readFileSync(path, 'utf8');
        if (prev === json) unchanged++;
        else { writeFileSync(path, json); updated++; }
        existing.delete(name);
      } else {
        writeFileSync(path, json);
        created++;
        // System code creates rows in content tables under these id shapes
        // (furn_light_*/furn_sl_*/furn_jbox_* power autobuild, furn_schd_*
        // schedule boards, keycard_* lock installs). Sometimes that IS content
        // (a studio built in dev), sometimes runtime residue — a new file
        // here deserves a look before committing. (Player-bought furniture
        // furn_<8-hex-uuid> is excluded from export entirely, above.)
        if (/^(furn_(light|sl|jbox|schd)_|keycard_)/.test(name)) {
          console.warn(`  ⚠ ${entry.table}/${name}: runtime-prefixed id — likely a runtime row, review before committing.`);
        }
      }
    }
    for (const stale of existing) {
      rmSync(join(dir, stale));
      removed++;
    }
    stats.push({ table: entry.table, rows: files.size, created, updated, unchanged, removed });
  }
  return stats;
}

// Player-purchased furniture id shape (furniture-shop.js: `furn_${uuid8}`).
export function isPlayerFurnitureId(table, id) {
  return table === 'furniture' && /^furn_[0-9a-f]{8}$/.test(String(id ?? ''));
}

// Runtime rows that live in content tables but must never become git files. Shared
// by export (never emit a file) and the import deletion pass (never delete the prod
// row even if a leaked file is removed from git). Covers:
//   - player-purchased furniture (furn_<8-hex>)
//   - SPECTER surveillance recordings: a captured clip mints a media_broadcasts
//     `bc_clip_clip_<ts>_<hex>` and, when chipped, an items `item_datachip_clip_<ts>_<hex>`.
export function isRuntimeResidueId(table, id) {
  const s = String(id ?? '');
  if (isPlayerFurnitureId(table, s)) return true;
  if (table === 'media_broadcasts' && /^bc_clip_clip_\d+_[0-9a-f]+$/.test(s)) return true;
  if (table === 'items' && /^item_datachip_clip_\d+_[0-9a-f]+$/.test(s)) return true;
  return false;
}

// ── File-tree reading (import / lint side) ───────────────────────────────────
// Reads content/<table>/*.json for every registry table, in registry (FK-safe)
// order. Throws on unparseable JSON or directories that aren't content tables.
// Content directories that are NOT one-file-per-row tables. `map/` holds the
// terrain palette (and, later, the coordinate atlas): authored, committed, git-
// owned like everything else here, but read whole rather than upserted, so the
// unknown-directory guard has to know about it by name.
// Directories under content/ that are NOT content tables. An unclassified directory here is a hard
// content:lint error, which is right — it is how a typo'd table name gets caught instead of quietly
// never importing.
//
// `building_models` holds authored GLASS building models (scripts/shapes/model-schema.mjs). They are
// content in every sense that matters — hand-authored, versioned in git, deployed by a push — but
// they have no table and never reach the database: `npm run models:bake` compiles them into
// client/shared/building-models.js, which the renderer imports. The CODEX pipeline must therefore
// leave them alone, and `shapes:smoke` owns their gate instead of `content:lint`.
export const NON_TABLE_DIRS = new Set(['map', 'building_models', 'vehicle_models']);

// ── Asset refs ──────────────────────────────────────────────────────────────
//
// A catalog `ref` means "an id in another collection". For almost every field that
// collection is a content table; for these it is a DIRECTORY OF FILES, and the id is
// the filename without its extension.
//
// Declared once, on purpose. Three separate things need to agree about what
// `zone_icons` means — the Studio's picker populates from it, content:lint resolves
// against it, and regress's "every ref names a real table" gate has to know it is
// legitimate rather than a typo. Special-casing the string in three files is how they
// start disagreeing, and a ref nobody can resolve is silently inert forever, which is
// the exact failure that check exists to prevent.
export const ASSET_REFS = Object.freeze({
  zone_icons: { dir: join('client', 'game', 'assets', 'zone-icons'), ext: '.svg' },
});

export function isAssetRef(table) {
  return Object.prototype.hasOwnProperty.call(ASSET_REFS, table);
}

/** Every id in an asset-ref collection, or null if `table` is not one. */
export function assetRefIds(table) {
  const def = ASSET_REFS[table];
  if (!def) return null;
  try {
    return readdirSync(join(REPO_ROOT, def.dir))
      .filter(n => n.endsWith(def.ext))
      .map(n => n.slice(0, -def.ext.length))
      .sort();
  } catch { return []; }
}

export function readPalette(baseDir = CONTENT_DIR) {
  const path = join(baseDir, 'map', 'terrain.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`content/map/terrain.json: invalid JSON — ${e.message}`);
  }
}

export function readContentTree(baseDir = CONTENT_DIR) {
  if (!existsSync(baseDir)) return { entries: [], unknownDirs: [] };
  const byTable = new Map(contentEntries().map(e => [e.table, e]));
  const unknownDirs = readdirSync(baseDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !byTable.has(d.name) && !NON_TABLE_DIRS.has(d.name))
    .map(d => d.name);
  const entries = [];
  for (const entry of contentEntries()) {
    const dir = join(baseDir, entry.table);
    if (!existsSync(dir)) continue;
    const files = [];
    for (const name of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
      const path = join(dir, name);
      let data;
      try {
        data = JSON.parse(readFileSync(path, 'utf8'));
      } catch (e) {
        throw new Error(`${entry.table}/${name}: invalid JSON — ${e.message}`);
      }
      files.push({ name, path, data });
    }
    entries.push({ entry, files });
  }
  return { entries, unknownDirs };
}

// ── Column metadata for a live target ────────────────────────────────────────
// json/jsonb columns need their file values JSON.stringify'd as parameters;
// everything else passes through (pg parses ISO dates, numeric strings, etc.).
export async function columnTypes(client, table) {
  const { rows } = await client.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1`, [table]);
  return new Map(rows.map(r => [r.column_name, r.data_type]));
}

export function paramFor(value, dataType) {
  if (value === null || value === undefined) return null;
  if (dataType === 'json' || dataType === 'jsonb') return JSON.stringify(value);
  return value;
}
