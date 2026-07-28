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
  return errors;
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
  // Advisory, never fatal: quest objectives aimed at a tile whose name is shared
  // by others. These still route correctly (GPS prefers a live objective's own
  // zone id), but the desc a player reads is not a name they can look up — so it
  // is worth knowing about when authoring, and worth avoiding in new quests.
  for (const w of warnQuestAmbiguousTargets()) console.warn(`  ! ${w}`);
  const errors = lintContentTree();
  if (errors.length) {
    console.error(`✗ content:lint — ${errors.length} problem(s):`);
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }
  console.log('✓ content:lint clean.');
  process.exit(0);
}
