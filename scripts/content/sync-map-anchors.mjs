// Push every map's anchor down onto its tiles, and let interior maps take their
// name from the building they hang off.
//
//   node scripts/content/sync-map-anchors.mjs [--dry-run]
//
// IDEMPOTENT — a second run writes nothing. Files only; there is no database in
// this process. Re-run it rather than hand-editing after adding a map or moving
// a building.
//
// TWO PASSES
// ──────────
// 1. ANCHOR. `maps.parent_zone_id` is where a map's world anchor is decided, and
//    every tile on the map carries a copy in `parent_zone` (plus, where it has
//    one, `flags.world_exit_zone`). The copies had drifted two ways: 154 tiles
//    across 12 hand-built maps used `parent_zone` for ROOM NESTING instead —
//    Halcyon's Elevator naming its Grand Lobby — and three utility rooms still
//    named the world tile their building stood on before it moved. The rule and
//    the reasoning live in map-anchor.mjs; this just applies them.
//
//    Tiles on NO map are untouched. `parent_zone` there is the dev panel's room
//    tree and means what it says.
//
// 2. NAME. An interior map named itself once, at creation, and then the building
//    got renamed — so The Cherry Pit's interior was still filed under "Cathode
//    Row", Ampersand Electronics under "The Overpass", Ration Nine under
//    "Battery Square". Dropping the authored `name` makes the map take the
//    facade's `building_name` from then on (registry omitWhenNull + deriveMapName),
//    so the rename can only ever happen in one place.
//
//    `maps.name` reaches the dev panel's map list, the Studio's map list and the
//    audit scripts. Nothing player-facing reads it, which is what makes deriving
//    it safe.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT_DIR, canonicalJson } from './lib.mjs';
import { deriveMapName } from './derive.mjs';
import { applyAnchor, anchorViolations } from './map-anchor.mjs';

const DRY = process.argv.includes('--dry-run');

// Maps that keep an authored name because deriving one would make it WORSE: in
// each of these the facade is named for a ROOM rather than for the building, so
// the derived name inherits the room. Renaming the facade instead is not the fix
// — a facade's name is player-facing prose and these read correctly in-game.
const KEEP_AUTHORED_NAME = new Map([
  ['map_int_1782953094650', 'facade is "KSAB-TV Studio Stage" — the stage, not the studio'],
  ['map_int_coldwater_power', 'facade is "Coldwater Power Plant — Turbine Hall"'],
  ['map_int_meridian', 'facade is "The Meridian - Lobby"'],
  ['map_int_longwatch', 'facade is "The Watch Threshold" — the way in, not the place'],
]);

const readDir = (t) => readdirSync(join(CONTENT_DIR, t)).filter(n => n.endsWith('.json'))
  .map(n => ({ file: join(CONTENT_DIR, t, n), name: n, data: JSON.parse(readFileSync(join(CONTENT_DIR, t, n), 'utf8')) }));

const maps = readDir('maps');
const zones = readDir('zones');
const mapById = new Map(maps.map(m => [m.data.id, m.data]));
const zoneById = new Map(zones.map(z => [z.data.id, z.data]));

const write = (rec, next) => {
  const bytes = canonicalJson(next);
  if (bytes === canonicalJson(rec.data)) return false;
  if (!DRY) writeFileSync(rec.file, bytes, 'utf8');
  rec.data = next;
  return true;
};

// ── Pass 1: the anchor ───────────────────────────────────────────────────────
const before = anchorViolations({ maps: maps.map(m => m.data), zones: zones.map(z => z.data) });
let anchored = 0;
for (const rec of zones) {
  const map = rec.data.map_id ? mapById.get(rec.data.map_id) : null;
  if (!map) continue;
  const next = applyAnchor(rec.data, map);
  if (next !== rec.data && write(rec, next)) anchored++;
}

console.log(`— anchor — ${before.length} violation(s), ${anchored} file(s) ${DRY ? 'would be ' : ''}rewritten`);
for (const v of before.slice(0, 12)) {
  console.log(`   ${v.zone_id}  ${v.field}: ${v.is ?? 'null'} → ${v.want ?? 'null'}`);
}
if (before.length > 12) console.log(`   … and ${before.length - 12} more`);

// ── Pass 2: the name ─────────────────────────────────────────────────────────
let renamed = 0, kept = 0;
for (const rec of maps) {
  const m = rec.data;
  if (!m.parent_zone_id) continue;                       // nothing to derive from
  if (KEEP_AUTHORED_NAME.has(m.id)) { kept++; continue; }
  if (m.name == null) continue;                          // already deriving
  const derived = deriveMapName({ ...m, name: null }, zoneById);
  if (!derived) { kept++; continue; }
  const { name, ...rest } = m;
  if (write(rec, rest)) {
    renamed++;
    if (name !== derived) console.log(`   ${rec.name}  "${name}" → "${derived}"`);
  }
}
console.log(`— name — ${renamed} map(s) now derive their name; ${kept} keep an authored override`);

const after = anchorViolations({ maps: maps.map(m => m.data), zones: zones.map(z => z.data) });
console.log(after.length ? `\n✗ ${after.length} anchor violation(s) remain` : '\n✓ anchors consistent');
if (DRY) console.log('(dry run — nothing written)');
process.exit(after.length && !DRY ? 1 : 0);
