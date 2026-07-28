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
import { validateTags, validateZoneColumns, TAG_CATALOG as CATALOG, ZONE_COLUMN_PREFIX } from '../../server/engine/tags.js';
import { readContentTree, fileNameForRow, schemaColumnsOf as columnsOf, readPalette } from './lib.mjs';
import { assignBuildingMarkers } from './derive.mjs';

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
  // One entry per column. A deferrable-constraint swap (ADD COLUMN … REFERENCES
  // followed by DROP CONSTRAINT / ADD CONSTRAINT) declares the same FK twice, and
  // without this every violation on such a column is reported twice.
  return [...new Map(fks.map(fk => [fk.col, fk])).values()];
}

// Returns { errors, warnings }. An error fails the gate; a warning is a fact the
// author should see and decide about — a catalogued field nothing uses, an
// ambient theme with no pool behind it. Warnings exist so those stop being
// invisible without becoming a reason the deploy can't ship.
export function lintContentTree(baseDir) {
  const errors = [];
  const warnings = [];
  let tree;
  try {
    tree = readContentTree(baseDir);
  } catch (e) {
    return { errors: [e.message], warnings };
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
      // The other half of a tile: the COLUMNS. Validated by the same shape rules
      // as the flags, against the `zone:<column>` catalog entries (spec §3.2), so
      // the whole tile is checked by one mechanism instead of half of it.
      if (entry.table === 'zones') {
        for (const s of validateZoneColumns(f.data).badShape) errors.push(`${label}: zone column value shape — ${s}`);
      }
    }
  }

  // ── Reference resolution (shape 'ref') ─────────────────────────────────────
  // Every `ref` field names a row in another table with no foreign key behind it
  // — flags live in JSONB, and the zone columns that are refs are TEXT. So a typo
  // is inert forever and nothing complains. This is the check that pays for the
  // shape existing (spec §3.1.2).
  {
    const refDefs = Object.entries(CATALOG).filter(([, d]) => d?.shape === 'ref' && d.refTable);
    const flagRefs = refDefs.filter(([k, d]) => d.scope === 'zone' && !k.startsWith(ZONE_COLUMN_PREFIX));
    // A column that has a real SQL foreign key is already checked above. Its
    // catalog `refTable` is there to give the editor a picker, not a second
    // opinion — checking it again would report every violation twice.
    const sqlFkCols = new Set(fksOf('zones').map(fk => fk.col));
    const colRefs = refDefs.filter(([k]) => k.startsWith(ZONE_COLUMN_PREFIX))
      .map(([k, d]) => [k.slice(ZONE_COLUMN_PREFIX.length), d])
      .filter(([col]) => !sqlFkCols.has(col));
    const resolves = (table, value) => {
      const set = pkSets.get(table);
      if (!set) return true;                       // not a content table — nothing to check against
      const first = set.values().next().value;
      return !first || first.has(String(value));
    };
    for (const f of entries.find(e => e.entry.table === 'zones')?.files || []) {
      const label = `zones/${f.name}`;
      const check = (field, def, value) => {
        if (value === null || value === undefined || value === '') return;
        if (!resolves(def.refTable, value)) {
          errors.push(`${label}: ${field}="${value}" references ${def.refTable} but no such content file exists (dangling reference — silently inert in the game)`);
        }
      };
      for (const [key, def] of flagRefs) check(`flags.${key}`, def, f.data.flags?.[key]);
      for (const [col, def] of colRefs) check(col, def, f.data[col]);
    }
  }

  // ── Catalog reconciliation (spec §3.3) ─────────────────────────────────────
  // A catalogued field on no tile is a UI option nothing uses — the same rot the
  // dead-palette-entry rule catches. A warning, not an error: it's a decision to
  // make (author it or delete it), not a broken build.
  {
    const zoneFiles = entries.find(e => e.entry.table === 'zones')?.files || [];
    const usedFlags = new Set();
    const usedThemes = new Map();
    for (const f of zoneFiles) {
      for (const k of Object.keys(f.data.flags || {})) usedFlags.add(k);
      const t = f.data.ambient_theme;
      if (t) usedThemes.set(t, (usedThemes.get(t) || 0) + 1);
    }
    if (zoneFiles.length) {
      const dead = Object.entries(CATALOG)
        .filter(([k, d]) => d?.scope === 'zone' && !usedFlags.has(k))
        .map(([k]) => k);
      if (dead.length) warnings.push(`${dead.length} zone flag(s) catalogued but on no tile: ${dead.join(', ')}`);
    }
    // An ambient_theme with no global_ambient_events behind it fires no ambience,
    // ever. It passes the enum (the value is legal) and passes every other check,
    // which is exactly why it needed naming.
    const pools = new Set((entries.find(e => e.entry.table === 'global_ambient_events')?.files || [])
      .map(f => f.data.theme).filter(Boolean));
    if (pools.size) {
      for (const [theme, count] of [...usedThemes].sort((a, b) => b[1] - a[1])) {
        if (!pools.has(theme)) warnings.push(`ambient_theme "${theme}" is on ${count} tile(s) but has no global_ambient_events pool — those tiles get no ambience unless they carry their own ambient_events`);
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

  // ── The terrain palette (spec §1.2) ────────────────────────────────────────
  // The only place a terrain's look is written down, so a value on a tile with no
  // entry behind it paints nothing and says nothing. Same two rules as every other
  // reconciliation in this file: unresolvable is an error, unused is a warning.
  {
    let palette = null;
    try { palette = readPalette(baseDir); } catch (e) { errors.push(e.message); }
    const zoneFiles = entries.find(e => e.entry.table === 'zones')?.files || [];
    if (palette && zoneFiles.length) {
      const known = new Set(Object.keys(palette.terrains || {}));
      const painted = new Map();
      for (const f of zoneFiles) {
        const t = f.data.flags?.terrain;
        if (t) painted.set(t, (painted.get(t) || 0) + 1);
      }
      for (const [t, n] of painted) {
        if (!known.has(t)) errors.push(`content/map/terrain.json: no entry for terrain "${t}", painted on ${n} tile(s) — those tiles resolve to no fill at all`);
      }
      const unused = [...known].filter(t => !painted.has(t));
      if (unused.length) warnings.push(`${unused.length} palette entry(ies) on no tile: ${unused.join(', ')}`);
      // A palette entry that can't paint anything is worse than an unused one: the
      // brush exists, you can click it, and the tile comes out with no fill.
      const noFill = [...known].filter(t => !palette.terrains[t]?.fill);
      if (noFill.length) errors.push(`content/map/terrain.json: entry(ies) with no fill: ${noFill.join(', ')}`);
    }
  }

  // ── Building map codes (spec §7.4) ─────────────────────────────────────────
  // The build assigns a unique code to every building that didn't author one, so a
  // DERIVED collision is impossible by construction. An AUTHORED one is a human
  // decision two people made independently, and derive must not paper over it.
  //
  // §7.4 says fail the build on these. It is a WARNING for now because 8 exist in
  // shipped content, and turning them into an error would blockade every push until
  // eight buildings are renamed — a flag day, which the migration shape (redesign
  // §14) exists to avoid. Promote it to an error once the backlog is clear.
  {
    const zoneFiles = entries.find(e => e.entry.table === 'zones')?.files || [];
    if (zoneFiles.length) {
      const { collisions } = assignBuildingMarkers(zoneFiles.map(f => f.data));
      for (const c of collisions) {
        warnings.push(`zones/${c.id}: map code "${c.marker}" is already authored on ${c.with} — two buildings wearing one code are indistinguishable on the map (audit MARK-4)`);
      }
    }
  }

  return { errors, warnings };
}

// CLI entry
import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { errors, warnings } = lintContentTree();
  for (const w of warnings) console.warn(`  ⚠ ${w}`);
  if (errors.length) {
    console.error(`✗ content:lint — ${errors.length} problem(s):`);
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }
  console.log(`✓ content:lint clean${warnings.length ? ` (${warnings.length} warning(s))` : ''}.`);
  process.exit(0);
}
