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

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { contentEntries } from '../../server/models/content-registry.js';

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
  return { client, host, url };
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
  const out = {};
  for (const [col, v] of Object.entries(row)) {
    if (excluded.has(col)) continue;
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
export function readContentTree(baseDir = CONTENT_DIR) {
  if (!existsSync(baseDir)) return { entries: [], unknownDirs: [] };
  const byTable = new Map(contentEntries().map(e => [e.table, e]));
  const unknownDirs = readdirSync(baseDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !byTable.has(d.name))
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
