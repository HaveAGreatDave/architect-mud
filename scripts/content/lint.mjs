// content:lint — validate the content file tree WITHOUT a database.
//
//   npm run content:lint
//
// Runs in the pre-push hook and in CI before anything touches a DB. Catches the
// classes of breakage that used to reach production silently:
//   • unparseable JSON / unknown content directory
//   • file keys that aren't columns of the table (stale file after a column drop,
//     or a missing SCHEMA_SQL change)
//   • runtime-mutated columns (registry excludeColumns) smuggled into files
//   • pk missing from the file, or filename not matching the pk
//   • dangling FK references between content tables (a zone_spawn pointing at an
//     enemy that has no file would restore broken on a fresh DB)
import { contentEntries } from '../../server/models/content-registry.js';
import { SCHEMA_SQL } from '../../server/models/schema.js';
import { validateTags } from '../../server/engine/tags.js';
import { readContentTree, fileNameForRow, schemaColumnsOf as columnsOf } from './lib.mjs';

// ── SCHEMA_SQL parsing (content→content FKs), no DB required ─────────────────
// Column parsing lives in lib.mjs (schemaColumnsOf) so the export writer and this
// checker validate against the exact same parse and can never drift.

function fksOf(table) {
  const fks = [];
  const block = SCHEMA_SQL.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n  \\);`, 'm'));
  if (block) {
    for (const line of block[1].split('\n')) {
      const m = line.match(/^\s{4}"?([a-z_]+)"?\s.*REFERENCES\s+(\w+)\s*\((\w+)\)/i);
      if (m) fks.push({ col: m[1], refTable: m[2], refCol: m[3] });
    }
  }
  // ADD COLUMN … REFERENCES retrofits + named-constraint swaps (deferrable FKs)
  for (const m of SCHEMA_SQL.matchAll(new RegExp(`ALTER TABLE ${table}\\s+ADD COLUMN IF NOT EXISTS (\\w+)[^;]*REFERENCES\\s+(\\w+)\\s*\\((\\w+)\\)`, 'g'))) {
    fks.push({ col: m[1], refTable: m[2], refCol: m[3] });
  }
  for (const m of SCHEMA_SQL.matchAll(new RegExp(`ALTER TABLE ${table}\\s+ADD CONSTRAINT \\w+\\s+FOREIGN KEY \\((\\w+)\\) REFERENCES (\\w+)\\s*\\((\\w+)\\)`, 'g'))) {
    fks.push({ col: m[1], refTable: m[2], refCol: m[3] });
  }
  return fks;
}

export function lintContentTree(baseDir) {
  const errors = [];
  let tree;
  try {
    tree = readContentTree(baseDir);
  } catch (e) {
    return [e.message];
  }
  const { entries, unknownDirs } = tree;
  for (const d of unknownDirs) errors.push(`content/${d}/ is not a content table (classify it in server/models/content-registry.js or remove the directory)`);

  const contentTables = new Set(contentEntries().map(e => e.table));
  const pkSets = new Map(); // table -> Set of refCol values present in files
  for (const { entry, files } of entries) {
    const set = new Map(); // refCol -> Set(values) — pk cols only, which covers every content FK target
    for (const c of entry.pk) set.set(c, new Set(files.map(f => String(f.data[c]))));
    pkSets.set(entry.table, set);
  }

  for (const { entry, files } of entries) {
    const cols = columnsOf(entry.table);
    const excluded = new Set(entry.excludeColumns || []);
    const omitWhenNull = new Set(entry.omitWhenNull || []);
    const fks = fksOf(entry.table).filter(fk => contentTables.has(fk.refTable) && !excluded.has(fk.col));
    for (const f of files) {
      const label = `${entry.table}/${f.name}`;
      for (const c of entry.pk) {
        if (f.data[c] === undefined || f.data[c] === null) errors.push(`${label}: missing pk column "${c}"`);
      }
      if (cols.size) {
        for (const k of Object.keys(f.data)) {
          if (!cols.has(k)) errors.push(`${label}: key "${k}" is not a column of ${entry.table} (stale file or missing SCHEMA_SQL change)`);
        }
      }
      for (const k of Object.keys(f.data)) {
        if (excluded.has(k)) errors.push(`${label}: runtime column "${k}" must not be in content files (registry excludeColumns)`);
        // An absent-by-default override written out as null is a tool still
        // treating "no opinion" as a fact worth recording. Caught here rather
        // than tolerated, because tolerating it is how 5,785 of them accumulated.
        if (f.data[k] === null && omitWhenNull.has(k)) {
          errors.push(`${label}: "${k}" is null — omit the key instead (registry omitWhenNull: it defaults through regions.defaults, see scripts/content/derive.mjs)`);
        }
      }
      try {
        const expected = fileNameForRow(entry, f.data);
        if (expected !== f.name) errors.push(`${label}: filename should be "${expected}" (derived from pk)`);
      } catch { /* pk error already reported */ }
      for (const fk of fks) {
        const v = f.data[fk.col];
        if (v === null || v === undefined) continue;
        const refSet = pkSets.get(fk.refTable)?.get(fk.refCol);
        if (refSet && !refSet.has(String(v))) {
          errors.push(`${label}: ${fk.col}="${v}" references ${fk.refTable}.${fk.refCol} but no such content file exists (dangling FK — would break a fresh restore)`);
        }
      }
      // Item tags must exist in the tag catalog with the right value shape —
      // the engine gates on tag names, so a typo here is silently inert in prod.
      if (entry.table === 'items' && f.data.tags) {
        const tv = validateTags(f.data.tags);
        for (const k of tv.unknown) errors.push(`${label}: tag "${k}" is not in the tag catalog (client/shared/tagCatalog.js)`);
        for (const s of tv.badShape) errors.push(`${label}: tag value shape — ${s}`);
      }
      // Zone flags are the catalog-validated zone tag bag (scope 'zone') —
      // same silent-typo bug class as item tags.
      if (entry.table === 'zones' && f.data.flags) {
        const tv = validateTags(f.data.flags);
        for (const k of tv.unknown) errors.push(`${label}: zone flag "${k}" is not in the tag catalog (client/shared/tagCatalog.js)`);
        for (const s of tv.badShape) errors.push(`${label}: zone flag value shape — ${s}`);
      }
    }
  }

  // Facade invariants: a `facade`-tagged zone must have an interior map
  // parented on it with a real entry zone, plus a real world_exit_zone — the
  // auto-forward seam's dependencies (tools/zone-planner/lint.mjs checks the
  // live DB; this covers hand-authored content files in CI).
  {
    const zoneFiles = entries.find(e => e.entry.table === 'zones')?.files || [];
    const mapFiles = entries.find(e => e.entry.table === 'maps')?.files || [];
    const zoneIds = new Set(zoneFiles.map(f => f.data.id));
    const mapByParent = new Map(mapFiles.filter(f => f.data.parent_zone_id).map(f => [f.data.parent_zone_id, f.data]));
    for (const f of zoneFiles) {
      if (!f.data.flags?.facade) continue;
      const label = `zones/${f.name}`;
      const m = mapByParent.get(f.data.id);
      if (!m) errors.push(`${label}: facade tag but no interior map file with parent_zone_id="${f.data.id}" (tile would stay standable)`);
      else if (!m.entry_zone_id || !zoneIds.has(m.entry_zone_id)) errors.push(`${label}: interior map ${m.id} has no valid entry_zone_id`);
      const wez = f.data.flags?.world_exit_zone;
      if (!wez || !zoneIds.has(wez)) errors.push(`${label}: facade needs a valid world_exit_zone (got "${wez ?? ''}")`);
    }
  }
  // regions.defaults holds the region-level rung of resolveDefault (spec §1.3),
  // and its keys are ZONE columns — so a default inherits whatever FK that column
  // has. Postgres cannot enforce a reference living inside a JSONB value, which
  // means without this check one typo in one file silently mutes 4,837 tiles and
  // nothing anywhere reports it.
  {
    const zoneCols = columnsOf('zones');
    const zoneFks = new Map(fksOf('zones').map(fk => [fk.col, fk]));
    const overridable = new Set(contentEntries().find(e => e.table === 'zones')?.omitWhenNull || []);
    for (const f of entries.find(e => e.entry.table === 'regions')?.files || []) {
      const d = f.data.defaults;
      if (d === null || d === undefined) continue;
      if (typeof d !== 'object' || Array.isArray(d)) {
        errors.push(`regions/${f.name}: "defaults" must be an object keyed by zone column`);
        continue;
      }
      for (const [k, v] of Object.entries(d)) {
        const label = `regions/${f.name}: defaults."${k}"`;
        if (zoneCols.size && !zoneCols.has(k)) {
          errors.push(`${label} is not a column of zones — a region can only default something a tile could have overridden`);
          continue;
        }
        if (!overridable.has(k)) {
          errors.push(`${label} is not an absent-by-default column of zones (registry omitWhenNull) — every tile carries a value, so this default can never fire`);
          continue;
        }
        if (v === null) {
          errors.push(`${label} is null — omit the key; a default of "nothing" is the absence of a default`);
          continue;
        }
        const fk = zoneFks.get(k);
        if (!fk || !contentTables.has(fk.refTable)) continue;
        const refSet = pkSets.get(fk.refTable)?.get(fk.refCol);
        if (refSet && !refSet.has(String(v))) {
          errors.push(`${label}="${v}" references ${fk.refTable}.${fk.refCol} but no such content file exists (dangling default — the whole region would resolve to something that isn't there)`);
        }
      }
    }
  }

  return errors;
}

// CLI entry
import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const errors = lintContentTree();
  if (errors.length) {
    console.error(`✗ content:lint — ${errors.length} problem(s):`);
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }
  console.log('✓ content:lint clean.');
  process.exit(0);
}
