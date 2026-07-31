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
import { readContentTree, fileNameForRow, schemaColumnsOf as columnsOf, readPalette, assetRefIds } from './lib.mjs';
import { assignBuildingMarkers, projectEdges, OPPOSITE, CARDINAL, deriveMapName, PROP_DEFAULTS } from './derive.mjs';
import { anchorViolations } from './map-anchor.mjs';

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
const PROP_KEYS = Object.keys(PROP_DEFAULTS);

export function lintContentTree(baseDir) {
  const errors = [];
  const warnings = [];
  // Read once, up here, because two rules need it: the palette reconciliation
  // further down, and the property-override checks inside the per-file loop.
  let palette = null;
  let paletteErr = null;
  try { palette = readPalette(baseDir); } catch (e) { paletteErr = e.message; }
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
      // Enemy anatomy: `body_parts[].grants` is read by the injury plugin, and
      // every failure mode here is SILENT — a component index that is a string,
      // or points past the end of the weapon array, simply never fires, and the
      // enemy looks perfectly correct while its arc can never be shot out. Same
      // silent-typo bug class as item tags below, so it fails the same way.
      if (entry.table === 'enemies' && Array.isArray(f.data.body_parts)) {
        const weaponLen = Array.isArray(f.data.weapon) ? f.data.weapon.length : 0;
        const ROLES = new Set(['attack', 'mobility', 'none']);
        for (const p of f.data.body_parts) {
          if (!p || typeof p !== 'object') continue;
          if (p.role !== undefined && !ROLES.has(p.role)) {
            errors.push(`${label}: body part "${p.part}" has role "${p.role}" — must be attack, mobility or none`);
          }
          const g = p.grants;
          if (g === undefined) continue;
          if (g === null || typeof g !== 'object' || Array.isArray(g)) {
            errors.push(`${label}: body part "${p.part}" has a grants that is not an object`);
            continue;
          }
          for (const k of Object.keys(g)) {
            if (!['component', 'dodge', 'capability'].includes(k)) {
              errors.push(`${label}: body part "${p.part}" grants unknown key "${k}" (component, dodge or capability)`);
            }
          }
          if (g.component !== undefined) {
            if (!Number.isInteger(g.component)) {
              errors.push(`${label}: body part "${p.part}" grants component "${g.component}" — must be an integer index, not a ${typeof g.component}`);
            } else if (g.component < 0 || g.component >= weaponLen) {
              errors.push(`${label}: body part "${p.part}" grants component ${g.component}, but this enemy has ${weaponLen} weapon component(s) — it could never be silenced`);
            }
          }
          if (g.dodge !== undefined && (typeof g.dodge !== 'number' || !(g.dodge > 0))) {
            errors.push(`${label}: body part "${p.part}" grants dodge "${g.dodge}" — must be a positive number`);
          }
          if (g.capability !== undefined && (typeof g.capability !== 'string' || !g.capability.trim())) {
            errors.push(`${label}: body part "${p.part}" grants capability "${g.capability}" — must be a non-empty string`);
          }
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
      // PROPERTY OVERRIDES (docs/proposals/terrain-property-presets.md). These two
      // warnings are the guard that replaced the export exclusion: the invariant is
      // that a terrain PRESET never gets written into a tile's flags, and the way
      // that invariant dies is one redundant override at a time.
      //
      // This is the `flags.water` failure re-armed: on 2026-07-21 the flag was
      // migrated to terrain and its readers were left behind, so 945 tiles and 12
      // `if`s disagreed silently for nine days. A preset baked into content is the
      // same divergence with the arrow reversed — the day the preset changes, every
      // baked tile keeps the old answer and nothing says so.
      if (entry.table === 'zones' && f.data.flags && palette) {
        const fl = f.data.flags;
        const terrain = fl.terrain || null;
        const preset = (terrain && palette.terrains?.[terrain]?.props) || {};
        for (const key of PROP_KEYS) {
          if (!(key in fl)) continue;
          if (key in preset && fl[key] === preset[key])
            warnings.push(`${label}: ${key}=${fl[key]} is REDUNDANT — terrain "${terrain}" already presets it. Delete the override; a preset baked into content stops tracking the palette`);
          else if (!terrain)
            warnings.push(`${label}: ${key}=${fl[key]} overrides nothing — the tile has no terrain, so it only restates the global default`);
        }
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
      // An asset ref resolves against a DIRECTORY OF FILES, not a content table. Without
      // this it fell through the "nothing to check against" door below and a typo'd icon
      // name stayed inert forever — which is precisely what this section exists to catch.
      const assets = assetRefIds(table);
      if (assets) return assets.includes(String(value));
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
      // `preset: true` entries are EXEMPT, and the exemption is the point. A
      // property override is supposed to be absent from almost every tile — the
      // terrain presets it and the flag only appears where an author disagreed.
      // Listing them as "catalogued but on no tile" would invite exactly the
      // cleanup this whole mechanism is built to prevent: someone deletes the
      // catalog entry, the palette keeps presetting a key nothing validates, and
      // the preset and its readers drift apart again.
      const dead = Object.entries(CATALOG)
        .filter(([k, d]) => d?.scope === 'zone' && !d.preset && !usedFlags.has(k))
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

  // NPC names are identity — two NPCs answering to the same name break
  // targeting, dialogue references, and the player's mental map of the world.
  // Exact (case-insensitive) collisions are a hard error, forever.
  {
    const npcFiles = entries.find(e => e.entry.table === 'npcs')?.files || [];
    const byName = new Map();
    for (const f of npcFiles) {
      const n = String(f.data.name ?? '').trim().toLowerCase();
      if (!n) continue;
      (byName.get(n) || byName.set(n, []).get(n)).push(f.name);
    }
    for (const [n, files] of byName) {
      if (files.length > 1) errors.push(`npcs: duplicate NPC name "${n}" in ${files.join(', ')} — every NPC needs a unique name`);
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

    // A BUILDING IS NOT GROUND, so it cannot carry a ground surface. resolveTerrain
    // says exactly that in its own comment — but it reads flags.terrain first, so a
    // stray paint stroke wins and the tile silently loses its navigable code
    // (deriveLabel suppresses a label on painted ground, by design). Hall of Records
    // sat as `terrain: road` and Halloran's Fix-It as `grass`, both codeless on the
    // map and the tablet, with nothing to see: a missing label looks like a tile that
    // never had one. Scoped exactly as derive's isBuildingTile is, so lint and the
    // build agree on which tiles wear a code.
    for (const f of zoneFiles) {
      const fl = f.data.flags || {};
      if (f.data.map_id !== 'map_world' || !(fl.facade || fl.is_building)) continue;
      if (!fl.terrain) continue;
      errors.push(`zones/${f.name}: building tile carries flags.terrain="${fl.terrain}" — a building footprint is not ground, and painted ground suppresses the tile's map code (it would vanish from the map and the tablet). Remove the terrain.`);
    }
  }

  // THE MAP ANCHOR. A map hangs off one world tile and `maps.parent_zone_id` is
  // the only place that is decided; the copy each tile carries in `parent_zone`
  // (and in `flags.world_exit_zone`, where it has one) has to agree. The reason
  // this is an ERROR and not a warning is that a stale copy resolves — it names a
  // real tile, just the wrong one — so nothing downstream can notice. Three of
  // them shipped that way, pointing at where their building used to stand.
  // See scripts/content/map-anchor.mjs; the fixer is sync-map-anchors.mjs.
  {
    const mapFiles = entries.find(e => e.entry.table === 'maps')?.files || [];
    const zoneFiles = entries.find(e => e.entry.table === 'zones')?.files || [];
    const bad = anchorViolations({
      maps: mapFiles.map(f => f.data),
      zones: zoneFiles.map(f => f.data),
    });
    for (const v of bad) {
      errors.push(`zones/${v.zone_id}.json: ${v.field}="${v.is ?? ''}" but map ${v.map_id} is anchored on "${v.want ?? ''}" — run node scripts/content/sync-map-anchors.mjs`);
    }

    // A map has to end up with a name: the column is NOT NULL and the key is an
    // absent-by-default override, so "omitted AND underivable" is the one
    // combination the import cannot resolve. Caught here rather than at the
    // INSERT, where the message would be a constraint violation.
    const zoneById = new Map(zoneFiles.map(f => [f.data.id, f.data]));
    for (const f of mapFiles) {
      if (deriveMapName(f.data, zoneById)) continue;
      errors.push(`maps/${f.name}: no "name" and none derivable — parent_zone_id "${f.data.parent_zone_id ?? ''}" names no zone carrying a building_name. Author a name, or fix the anchor.`);
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
    if (paletteErr) errors.push(paletteErr);
    // A typo in a terrain's `props` block (`swimable`) presets NOTHING, silently, on
    // every tile of that terrain — and unlike a bad flag it never reaches validateTags,
    // because it lives in the palette rather than in a content file. So check it here.
    for (const [name, entry] of Object.entries(palette?.terrains || {})) {
      for (const key of Object.keys(entry?.props || {})) {
        if (!PROP_KEYS.includes(key))
          errors.push(`content/map/terrain.json: terrain "${name}" presets unknown property "${key}" — not one of ${PROP_KEYS.join('/')}. It would preset nothing, on every tile of that terrain`);
        // Typed by its DEFAULT, so a numeric property (speed_mult) and a boolean one
        // are checked by the same rule without either being special-cased here.
        else if (typeof entry.props[key] !== typeof PROP_DEFAULTS[key])
          errors.push(`content/map/terrain.json: terrain "${name}".props.${key} is ${JSON.stringify(entry.props[key])} — expected a ${typeof PROP_DEFAULTS[key]}`);
      }
    }
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

  // ── Districts (the land-use neighbourhood a tile reads as) ─────────────────
  // Same two questions the terrain palette gets asked: does every tile's claim name
  // something real, and does every entry get used.
  {
    const districtFiles = entries.find(e => e.entry.table === 'districts')?.files || [];
    const zoneFilesD = entries.find(e => e.entry.table === 'zones')?.files || [];
    if (districtFiles.length) {
      const known = new Map(districtFiles.map(f => [f.data.id, f.data]));
      const claimed = new Map();
      for (const f of zoneFilesD) {
        const d = f.data.flags?.district;
        if (d) claimed.set(d, (claimed.get(d) || 0) + 1);
      }
      // A tile naming no district at all is FINE — it falls back to the engine
      // default. A tile naming one that doesn't exist is not: it looks assigned in
      // every tool and resolves to the default anyway.
      for (const [d, n] of claimed) {
        if (!known.has(d)) errors.push(`no district "${d}", claimed by ${n} tile(s) — those tiles silently read as the default neighbourhood`);
      }
      // Warnings, because each of these ships today and is authoring work, not a
      // broken build. The landmark one is real: 11 of the 14 districts that name a
      // landmark point at zones the legacy-world purge deleted, and describe.js
      // simply shows no skyline line when getZone() comes back empty.
      const zoneIds = new Set(zoneFilesD.map(f => f.data.id));
      for (const d of known.values()) {
        if (d.landmark && !zoneIds.has(d.landmark)) {
          warnings.push(`districts/${d.id}: landmark "${d.landmark}" is not a zone — this district shows no skyline line at all`);
        }
        if (!Array.isArray(d.signature) || !d.signature.length) {
          warnings.push(`districts/${d.id}: no sensory lines — outdoor tiles here get no district ambience`);
        }
      }
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

  // ── Connections and the projected graph (spec §1.4, §7.5) ──────────────────
  // The gate that makes §11 step 6's "cut over only when they agree" a check
  // rather than a hope: project the whole traversal graph from geometry plus the
  // connection files and hold it to zones.exits, edge for edge. Until `exits`
  // leaves content (§5) the two are redundant, and redundancy nobody checks is
  // just two sources of truth waiting to disagree.
  {
    const zoneFiles = entries.find(e => e.entry.table === 'zones')?.files || [];
    const connFiles = entries.find(e => e.entry.table === 'connections')?.files || [];
    const connections = connFiles.map(f => f.data);
    const zoneIds = new Set(zoneFiles.map(f => f.data.id));

    for (const f of connFiles) {
      const c = f.data;
      const label = `connections/${f.name}`;
      if (!OPPOSITE[c.dir]) {
        // A direction with no reverse can still be authored, but only one-way: the
        // build has nothing to project back along.
        if (!c.dir) errors.push(`${label}: no "dir"`);
        else if (!c.one_way) errors.push(`${label}: dir "${c.dir}" has no opposite — a two-way connection needs a direction the build can reverse`);
      }
      if (c.a === c.b) errors.push(`${label}: connects ${c.a} to itself`);
      if (c.blocked && c.one_way) errors.push(`${label}: blocked and one_way — a wall has no direction; drop one_way`);
      if (c.blocked && (c.lockable || c.door)) errors.push(`${label}: blocked but carries a lock/door — there is no opening here to fit one to`);
      // a/b resolution is covered by the FK sweep above; this catches the case
      // where the schema FK is missing so the sweep has nothing to follow.
      for (const end of ['a', 'b']) {
        if (c[end] && zoneIds.size && !zoneIds.has(c[end])) errors.push(`${label}: ${end}="${c[end]}" is not a zone`);
      }
    }

    // ── The curtain is closed (the city↔wilds frontier) ──────────────────────
    // The frontier used to be a rule in derive.mjs reading `flags.district`, which
    // meant a district edit could delete a wall with no diff to show for it — and
    // walking out of Coldwater anywhere but The South Gate skips the gate warning,
    // the wanted/contraband check, and lands a player in country with no clone-vat.
    // It is 133 authored walls now (scripts/content/mint-curtain-walls.mjs), so
    // THIS is what keeps it shut: every frontier adjacency must be spoken for by a
    // file — a wall, or the gate that deliberately opens one.
    //
    // Knowing what "wilds" means is fine HERE. Lint is authoring-side bookkeeping
    // that never ships; the engine is what was not allowed to hold this rule.
    if (zoneFiles.length) {
      const isWilds = (z) => z?.flags?.district === 'wilds';
      const facadeBlocks = (z, dir) => !!z?.flags?.facade && z.flags.entrance !== dir;
      const cells = new Map();
      for (const f of zoneFiles) {
        const z = f.data;
        if (z.map_id == null || z.grid_x == null || z.grid_y == null) continue;
        const k = `${z.map_id}|${z.grid_x},${z.grid_y},${z.grid_z ?? 0}`;
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(z);
      }
      const spoken = new Set(connections.map(c => [c.a, c.b].sort().join('~')));
      const open = [];
      for (const f of zoneFiles) {
        const z = f.data;
        if (z.map_id == null || z.grid_x == null || z.grid_y == null) continue;
        for (const [dir, [dx, dy]] of Object.entries(CARDINAL)) {
          for (const n of cells.get(`${z.map_id}|${z.grid_x + dx},${z.grid_y + dy},${z.grid_z ?? 0}`) || []) {
            if (isWilds(z) === isWilds(n)) continue;
            if (facadeBlocks(z, dir) || facadeBlocks(n, OPPOSITE[dir])) continue;
            if (spoken.has([z.id, n.id].sort().join('~'))) continue;
            open.push(`${z.id} —${dir}→ ${n.id}`);
          }
        }
      }
      for (const o of open.slice(0, 10)) {
        errors.push(`the city↔wilds curtain is open at ${o} — a player walks into the waste there without passing a gate. Author a wall (blocked: true) or run node scripts/content/mint-curtain-walls.mjs --write`);
      }
      if (open.length > 10) errors.push(`…and ${open.length - 10} more open curtain crossing(s)`);
    }

    if (zoneFiles.length) {
      const zones = zoneFiles.map(f => f.data);
      const { edges, undeclaredOneWays, unusedBlocks } = projectEdges(zones, connections);

      // The undeclared one-way (§7.5): a step that projects one way and does not
      // come back, with no file saying so. A warp the map cannot draw and nobody
      // chose. Declaring it (one_way: true) is how you say you meant it.
      for (const e of undeclaredOneWays.slice(0, 20)) {
        errors.push(`undeclared one-way: ${e.from_zone} —${e.direction}→ ${e.to_zone} projects but the return does not; author a connection with "one_way": true if that is deliberate`);
      }
      if (undeclaredOneWays.length > 20) errors.push(`…and ${undeclaredOneWays.length - 20} more undeclared one-way(s)`);

      // A wall that walls nothing: the tiles moved apart, or a rule now covers the
      // pair. Harmless, but it is a file whose reason has been edited away.
      for (const id of unusedBlocks) warnings.push(`connections/${id}.json: blocked, but geometry projects nothing between those tiles — the wall is redundant`);

      // The agreement gate.
      const authored = new Set();
      for (const z of zones) {
        for (const [dir, v] of Object.entries(z.exits || {})) {
          for (const t of (Array.isArray(v) ? v : [v])) if (t) authored.add(`${z.id}|${dir}|${t}`);
        }
      }
      const projected = new Set(edges.map(e => `${e.from_zone}|${e.direction}|${e.to_zone}`));
      const show = (k) => { const [a, d, b] = k.split('|'); return `${a} —${d}→ ${b}`; };
      const gaps = [...authored].filter(k => !projected.has(k)).sort();
      const walls = [...projected].filter(k => !authored.has(k)).sort();
      for (const k of gaps.slice(0, 10)) errors.push(`zone_edges would lose an exit: ${show(k)} is authored in zones.exits but nothing projects it — author a connection file`);
      if (gaps.length > 10) errors.push(`…and ${gaps.length - 10} more exit(s) the projection cannot reach`);
      for (const k of walls.slice(0, 10)) errors.push(`zone_edges would invent an exit: ${show(k)} projects from geometry but zones.exits does not have it — author a connection file with "blocked": true`);
      if (walls.length > 10) errors.push(`…and ${walls.length - 10} more exit(s) the projection would invent`);
    }

    // ── One fixture per connection (spec §6.3, §11 step 7) ───────────────────
    // A door is a fixture ON a link, so it is anchored by the link's authored id
    // and there is exactly one of it. Before this, doors were identified by
    // (zone_id, exit_dir) — a coordinate — and 56 of 117 seams carried two rows
    // free to drift into "open in look, locked on move".
    const doorFiles = entries.find(e => e.entry.table === 'doors')?.files || [];
    const connById = new Map(connections.map(c => [c.id, c]));
    const byConnection = new Map();
    for (const f of doorFiles) {
      const d = f.data;
      const label = `doors/${f.name}`;
      if (!d.connection_id) {
        errors.push(`${label}: no connection_id — a door is a fixture on a link and must name it (run scripts/content/anchor-doors.mjs)`);
        continue;
      }
      const conn = connById.get(d.connection_id);
      if (!conn) { errors.push(`${label}: connection_id="${d.connection_id}" is not a connection`); continue; }
      if (conn.blocked) errors.push(`${label}: sits on ${conn.id}, which is a WALL — there is no opening here to hang a door on`);
      if (d.zone_id !== conn.a && d.zone_id !== conn.b) {
        errors.push(`${label}: zone_id="${d.zone_id}" is neither end of ${conn.id} (${conn.a} ↔ ${conn.b})`);
      }
      const prior = byConnection.get(d.connection_id);
      if (prior) errors.push(`${label}: ${conn.id} already carries door ${prior} — one fixture per connection, or the two sides drift apart`);
      else byConnection.set(d.connection_id, d.id);
    }
  }

  // Quest objectives must point somewhere a player can actually be SENT.
  //
  // Coldwater's street names repeat by design — 19 tiles are "Kessler Street",
  // 366 are "Grasslands" — so an objective whose `desc` is a bare place name is
  // not routable: `gps <desc>` resolves to the nearest tile of that name, which
  // is almost never the objective's. A player then walks somewhere plausible and
  // the quest sits still with nothing explaining why.
  //
  // This landed for real: a repair one-shot (scripts/salvage-legacy-world.mjs)
  // repointed 17 job-board gigs and set each `desc` from the DISTRICT CLASS
  // rather than the tile name, sending two quests to an apartment interior
  // labelled "Residential Area" — a name it does not have and 19 other tiles do.
  //
  // Two rules, both about the same failure:
  //   1. a bare-place-name desc must BE the target tile's name (prose descs, which
  //      read as instructions, are exempt — they were never meant to be typed);
  //   2. that name must be unique, or the desc is unroutable even when correct.
  {
    const questFiles = entries.find(e => e.entry.table === 'quests')?.files || [];
    const zoneFiles = entries.find(e => e.entry.table === 'zones')?.files || [];
    if (questFiles.length && zoneFiles.length) {
      const zoneName = new Map(zoneFiles.map(f => [f.data.id, f.data.name]));
      const nameCount = new Map();
      for (const f of zoneFiles) nameCount.set(f.data.name, (nameCount.get(f.data.name) || 0) + 1);
      // Only the ACTIVE TRAP is an error, and it is narrow on purpose: a desc that
      // is the real name of one or more OTHER tiles, but not of its own target.
      // That is the shape that misroutes — the player types it, the name resolves
      // to genuine tiles, and every one of them is the wrong place.
      //
      // A desc naming nothing on the map ("The apron", "Check the drain") is NOT
      // flagged: it can't misresolve, and it reads as an instruction anyway. Nor
      // is a merely duplicated target name, which is a warning below — GPS now
      // prefers a live objective's own zone, so those still route correctly.
      const nameToIds = new Map();
      for (const f of zoneFiles) {
        const k = String(f.data.name || '').trim().toLowerCase();
        if (!nameToIds.has(k)) nameToIds.set(k, []);
        nameToIds.get(k).push(f.data.id);
      }
      for (const f of questFiles) {
        for (const o of f.data.objectives || []) {
          if (!o?.zone) continue;
          const label = `quests/${f.name} ${o.id || '?'}`;
          const real = zoneName.get(o.zone);
          if (real === undefined) {
            errors.push(`${label}: zone "${o.zone}" has no content file (objective can never be reached)`);
            continue;
          }
          const desc = String(o.desc || '').trim();
          if (!desc) continue;
          if (desc.toLowerCase() === String(real).trim().toLowerCase()) continue;   // desc names its own target: fine
          const elsewhere = nameToIds.get(desc.toLowerCase());
          if (elsewhere && elsewhere.length) {
            errors.push(`${label}: desc "${desc}" is the real name of ${elsewhere.length} OTHER tile(s) but not of its target ${o.zone} ("${real}") — a player routing by that name is sent to the wrong place and the quest never advances`);
          }
        }
      }
    }
  }
  return { errors, warnings };
}

/**
 * Advisory (non-fatal): quest objectives pointing at a tile whose name several
 * tiles share. Not an error — GPS resolves a live objective by zone id, so these
 * route correctly — but the desc the player reads isn't a name they can look up,
 * so new quests should prefer a uniquely-named tile where one exists.
 */
export function warnQuestAmbiguousTargets() {
  const warnings = [];
  try {
    const { entries } = readContentTree();
    const questFiles = entries.find(e => e.entry.table === 'quests')?.files || [];
    const zoneFiles = entries.find(e => e.entry.table === 'zones')?.files || [];
    if (!questFiles.length || !zoneFiles.length) return warnings;
    const zoneName = new Map(zoneFiles.map(f => [f.data.id, f.data.name]));
    const nameCount = new Map();
    for (const f of zoneFiles) nameCount.set(f.data.name, (nameCount.get(f.data.name) || 0) + 1);
    for (const f of questFiles) {
      for (const o of f.data.objectives || []) {
        if (!o?.zone) continue;
        const real = zoneName.get(o.zone);
        const n = nameCount.get(real) || 0;
        if (n > 1) warnings.push(`quests/${f.name} ${o.id || '?'}: target ${o.zone} is named "${real}", shared by ${n} tiles`);
      }
    }
  } catch (e) { warnings.push(`(objective-ambiguity scan skipped: ${e.message})`); }
  return warnings;
}

// CLI entry
import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { errors, warnings } = lintContentTree();
  for (const w of warnings) console.warn(`  ⚠ ${w}`);
  // Advisory, never fatal: quest objectives aimed at a tile whose name is shared
  // by others. These still route correctly (GPS prefers a live objective’s own
  // zone id), but the desc a player reads is not a name they can look up — so it
  // is worth knowing about when authoring, and worth avoiding in new quests.
  for (const w of warnQuestAmbiguousTargets()) console.warn(`  ! ${w}`);
  if (errors.length) {
    console.error(`✗ content:lint — ${errors.length} problem(s):`);
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }
  console.log(`✓ content:lint clean${warnings.length ? ` (${warnings.length} warning(s))` : ''}.`);
  process.exit(0);
}
