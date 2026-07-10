// Zone planner — materialize an ASCII blueprint into zones (zone redesign
// Phase 7). Authoring a district stops being one-zone-at-a-time busywork:
// draw a character grid, map each glyph to a template, and this writes the
// zones, the adjacency exits (exits stay the traversability law — the planner
// WRITES them, adjacency alone never connects), and full facade+interior
// wiring for every building glyph.
//
//   node tools/zone-planner/apply.mjs tools/zone-planner/blueprints/<bp>.bp.json           (dry-run)
//   node tools/zone-planner/apply.mjs tools/zone-planner/blueprints/<bp>.bp.json --apply
//   add --force to reassert template fields on existing planner-owned zones
//
// Runs against the LOCAL dev DB (db.js env resolution); output reaches prod
// exclusively through the content pipeline: apply → npm run content:export →
// commit → push. Restart (or reloadZone) a running local server to see it live.
//
// Blueprint format (JSON):
//   {
//     "id": "bp_meridian_east",           // provenance tag on every zone it creates
//     "map": "map_world",
//     "origin": { "x": 40, "y": 12, "z": 0 },
//     "id_prefix": "meridian_e",          // zones become zone_<prefix>_<absX>_<absY>
//     "grid": [ "####B#",                 // top row = origin.y; col 0 = origin.x
//               "#..B##" ],
//     "legend": {
//       "#": { "template": "street", "name": "Meridian Ave — {block} block",
//               "tags": { "artery": ["Meridian Ave"], "street_life": true },
//               "ambient_theme": "city", "marker": "░", "color": "#ccc", "bg_color": "#4a4a52" },
//       ".": { "template": "alley", "name": "Back Alley" },
//       "~": { "template": "water", "name": "Cold Channel", "tags": { "water": true } },
//       "B": { "template": "building", "building_type": "store",
//               "name_pool": ["The Stacked Deck", "Nine Lives Salvage"],
//               "interior": { "lobby_name": "{name} — Ground Floor" } }
//     }
//   }
// Space = no zone. Name patterns accept {x} {y} {block} ({block} = y·100+x) and,
// inside interior.lobby_name, {name} = the building's name.
//
// Idempotency / hand-edit safety (re-running a blueprint on a grown map):
//   • upsert by deterministic id — same grid cell, same zone id, always
//   • always reasserted: map_id + grid coords, planner-drawn exits where BOTH
//     ends are planner-owned (hand-wired exits and exits to foreign zones are
//     merged in, never removed; zone_exit_overrides live elsewhere untouched)
//   • description rewritten only while it still starts with the [PLANNER STUB]
//     sentinel — hand-written prose is never clobbered
//   • name/colors/theme/tags reasserted only with --force
//   • a colliding zone NOT owned by this blueprint is skipped with a warning
//   • deleting a glyph never deletes a zone (dry-run lists the orphans;
//     deletion stays a human act via the dev panel / content files)
import { readFileSync } from 'node:fs';
import { query } from '../../server/models/db.js';
import { validateTags } from '../../server/engine/tags.js';

const args = process.argv.slice(2);
const bpPath = args.find(a => !a.startsWith('--'));
const APPLY = args.includes('--apply');
const FORCE = args.includes('--force');
if (!bpPath) { console.error('Usage: node tools/zone-planner/apply.mjs <blueprint.bp.json> [--apply] [--force]'); process.exit(1); }

const bp = JSON.parse(readFileSync(bpPath, 'utf8'));
// Two authoring formats reach the same internal `cells` model:
//   • v1 (ASCII): { grid: ["#.B"], legend: { "#": {...} } } — one char per cell.
//   • v2 (painter): { palette: { "ST": {...} }, cells: [[{t,bg,fg}|null]] } —
//     multi-char keys + per-cell bg/fg colour overrides (the paint editor writes this).
const IS_V2 = !!(bp.palette && bp.cells);
for (const k of ['id', 'map', 'origin', 'id_prefix', ...(IS_V2 ? ['palette', 'cells'] : ['grid', 'legend'])]) {
  if (!bp[k]) { console.error(`Blueprint missing "${k}"`); process.exit(1); }
}
const SENTINEL = '[PLANNER STUB]';
const zid = (x, y) => `zone_${bp.id_prefix}_${x}_${y}`;
const fillName = (pattern, x, y, name) => String(pattern || '')
  .replaceAll('{x}', x).replaceAll('{y}', y)
  .replaceAll('{block}', y * 100 + x)
  .replaceAll('{name}', name || '');

// ── Parse into cells ─────────────────────────────────────────────────────────
// Both formats normalize to a "x,y" -> { x, y, glyph, leg } map, where `leg`
// carries the same fields the planner reads (template/name/tags/interior/marker/
// color/bg_color/...). v2 folds per-cell colour overrides into that leg.
const cells = new Map();
if (IS_V2) {
  bp.cells.forEach((row, ry) => {
    (row || []).forEach((cell, rx) => {
      if (!cell || !cell.t) return; // null / empty = no zone (the v1 space)
      const pal = bp.palette[cell.t];
      if (!pal) { console.error(`Cell (${rx},${ry}) references palette key "${cell.t}" with no palette entry`); process.exit(1); }
      // Palette entry defines the type; the cell may override just its colours.
      const leg = {
        ...pal,
        color: cell.fg ?? pal.color ?? null,
        bg_color: cell.bg ?? pal.bg_color ?? pal.bg ?? null,
      };
      const x = bp.origin.x + rx, y = bp.origin.y + ry;
      cells.set(`${x},${y}`, { x, y, glyph: cell.t, leg });
    });
  });
} else {
  bp.grid.forEach((row, ry) => {
    [...row].forEach((glyph, rx) => {
      if (glyph === ' ') return;
      const leg = bp.legend[glyph];
      if (!leg) { console.error(`Grid glyph "${glyph}" at (${rx},${ry}) has no legend entry`); process.exit(1); }
      const x = bp.origin.x + rx, y = bp.origin.y + ry;
      cells.set(`${x},${y}`, { x, y, glyph, leg });
    });
  });
}
const at = (x, y) => cells.get(`${x},${y}`);
const ORTHO = [['north', 0, -1], ['south', 0, 1], ['east', 1, 0], ['west', -1, 0]];

// ── Build the desired zone set ───────────────────────────────────────────────
const plan = []; // { id, row: {...zone columns}, kind, ownExits: {dir: id} }
let poolCursor = new Map(); // glyph -> next name_pool index
for (const c of cells.values()) {
  const isBuilding = !!c.leg.interior;
  const id = zid(c.x, c.y);
  // adjacency exits — every orthogonal neighbour cell gets a two-way exit
  const ownExits = {};
  for (const [dir, dx, dy] of ORTHO) {
    const n = at(c.x + dx, c.y + dy);
    if (n) ownExits[dir] = zid(n.x, n.y);
  }
  if (!isBuilding) {
    const name = fillName(c.leg.name || c.leg.template || 'Unnamed', c.x, c.y) || `Zone ${c.x},${c.y}`;
    plan.push({
      id, kind: c.leg.template || 'zone', ownExits,
      row: {
        id, name,
        description: `${SENTINEL} ${name} — a ${c.leg.template || 'place'} awaiting its prose.`,
        map_id: bp.map, grid_x: c.x, grid_y: c.y, grid_z: bp.origin.z ?? 0,
        marker: c.leg.marker ?? null, color: c.leg.color ?? null, bg_color: c.leg.bg_color ?? null,
        ambient_theme: c.leg.ambient_theme || 'city',
        flags: { ...(c.leg.tags || {}), ...(c.leg.icon ? { icon: c.leg.icon } : {}), planner: bp.id },
        parent_zone: null,
      },
    });
    continue;
  }
  // Building glyph ⇒ facade (non-standable, auto-forwarding) + interior map + lobby.
  const cursor = poolCursor.get(c.glyph) || 0;
  poolCursor.set(c.glyph, cursor + 1);
  const bName = (c.leg.name_pool || [])[cursor] || fillName(c.leg.name, c.x, c.y) || `Building ${c.x},${c.y}`;
  // Front door: the street tile OUT spills onto — first orthogonal non-building
  // neighbour, preferring south (door faces the camera-south street).
  const streetNeighbor = [['south', 0, 1], ['north', 0, -1], ['west', -1, 0], ['east', 1, 0]]
    .map(([, dx, dy]) => at(c.x + dx, c.y + dy)).find(n => n && !n.leg.interior);
  if (!streetNeighbor) { console.error(`Building "${bName}" at (${c.x},${c.y}) has no adjacent street cell — a facade needs a front door.`); process.exit(1); }
  const streetId = zid(streetNeighbor.x, streetNeighbor.y);
  const lobbyId = `${id}_lobby`;
  const mapId = `map_int_${id}`;
  plan.push({
    id, kind: 'facade', ownExits: { ...ownExits, in: lobbyId },
    interiorMap: { id: mapId, name: `${bName} — Interior`, parent_zone_id: id, entry_zone_id: lobbyId },
    row: {
      id, name: bName,
      description: `${SENTINEL} The face of ${bName}.`,
      map_id: bp.map, grid_x: c.x, grid_y: c.y, grid_z: bp.origin.z ?? 0,
      marker: c.leg.marker ?? '▣', color: c.leg.color ?? null, bg_color: c.leg.bg_color ?? null,
      ambient_theme: c.leg.ambient_theme || 'indoors',
      flags: { ...(c.leg.tags || {}), ...(c.leg.icon ? { icon: c.leg.icon } : {}),
               is_building: true, facade: true, building_name: bName,
               ...(c.leg.building_type ? { building_type: c.leg.building_type } : {}),
               world_exit_zone: streetId, planner: bp.id },
      parent_zone: null,
    },
  });
  const lobbyName = fillName(c.leg.interior.lobby_name || '{name} — Ground Floor', c.x, c.y, bName);
  plan.push({
    id: lobbyId, kind: 'lobby', ownExits: { out: id },
    row: {
      id: lobbyId, name: lobbyName,
      description: `${SENTINEL} Inside ${bName} — a ground floor awaiting its prose.`,
      map_id: mapId, grid_x: 0, grid_y: 0, grid_z: 0,
      marker: null, color: null, bg_color: null,
      ambient_theme: 'indoors',
      flags: { is_interior: true, world_exit_zone: streetId, planner: bp.id },
      parent_zone: id,
    },
  });
}

// Validate every flags bag before touching anything.
for (const p of plan) {
  const v = validateTags(p.row.flags);
  if (!v.ok) { console.error(`${p.id}: flags fail catalog validation — unknown: ${v.unknown.join(',') || '—'}; shapes: ${v.badShape.join('; ') || '—'}`); process.exit(1); }
}

// ── Diff against the DB ──────────────────────────────────────────────────────
const planIds = plan.map(p => p.id);
const { rows: existingRows } = await query('SELECT * FROM zones WHERE id = ANY($1::text[])', [planIds]);
const existing = new Map(existingRows.map(r => [r.id, r]));
const { rows: orphanRows } = await query(
  `SELECT id FROM zones WHERE flags->>'planner' = $1 AND NOT (id = ANY($2::text[]))`, [bp.id, planIds]);

const creates = [], updates = [], skips = [];
for (const p of plan) {
  const cur = existing.get(p.id);
  if (!cur) { creates.push(p); continue; }
  if (cur.flags?.planner !== bp.id && !FORCE) { skips.push(p.id); continue; }
  updates.push(p);
}

console.log(`Blueprint ${bp.id} → ${bp.map} @ (${bp.origin.x},${bp.origin.y},${bp.origin.z ?? 0})`);
console.log(`  cells: ${cells.size}  zones planned: ${plan.length} (${plan.filter(p => p.kind === 'facade').length} buildings)`);
console.log(`  create: ${creates.length}   update (planner-owned): ${updates.length}   skip (foreign id collision): ${skips.length}`);
skips.forEach(id => console.log(`    ⚠ SKIP ${id} — exists and is not owned by this blueprint (use --force to take it over)`));
orphanRows.forEach(r => console.log(`    ⚠ ORPHAN ${r.id} — owned by this blueprint but no longer in the grid (delete by hand if unwanted)`));
if (!APPLY) { console.log('\n[dry-run] nothing written. Re-run with --apply.'); process.exit(0); }

// ── Write ────────────────────────────────────────────────────────────────────
for (const p of creates) {
  const r = p.row;
  await query(
    `INSERT INTO zones (id,name,description,exits,ambient_events,ambient_theme,flags,created_by,map_id,grid_x,grid_y,grid_z,marker,color,bg_color,parent_zone)
     VALUES ($1,$2,$3,$4,'[]',$5,$6,'zone-planner',$7,$8,$9,$10,$11,$12,$13,$14)`,
    [r.id, r.name, r.description, JSON.stringify(p.ownExits), r.ambient_theme, JSON.stringify(r.flags),
     r.map_id, r.grid_x, r.grid_y, r.grid_z, r.marker, r.color, r.bg_color, r.parent_zone]);
}
const planOwned = new Set(planIds);
for (const p of updates) {
  const cur = existing.get(p.id);
  // Merge exits: reassert planner edges (both ends planner-owned), keep every
  // exit whose target isn't part of this blueprint (hand-wired connections).
  const mergedExits = {};
  for (const [dir, tgt] of Object.entries(cur.exits || {})) {
    const targets = (Array.isArray(tgt) ? tgt : [tgt]).filter(t => !planOwned.has(t));
    if (targets.length) mergedExits[dir] = targets.length === 1 ? targets[0] : targets;
  }
  for (const [dir, tgt] of Object.entries(p.ownExits)) {
    if (!mergedExits[dir]) mergedExits[dir] = tgt;
    else {
      const cur2 = Array.isArray(mergedExits[dir]) ? mergedExits[dir] : [mergedExits[dir]];
      if (!cur2.includes(tgt)) mergedExits[dir] = [...cur2, tgt];
    }
  }
  const keepDescription = !String(cur.description || '').startsWith(SENTINEL);
  if (FORCE) {
    const r = p.row;
    await query(
      `UPDATE zones SET name=$2, description=$3, exits=$4, ambient_theme=$5, flags=$6, map_id=$7,
              grid_x=$8, grid_y=$9, grid_z=$10, marker=$11, color=$12, bg_color=$13, parent_zone=$14 WHERE id=$1`,
      [r.id, r.name, keepDescription ? cur.description : r.description, JSON.stringify(mergedExits), r.ambient_theme,
       JSON.stringify({ ...cur.flags, ...r.flags }), r.map_id, r.grid_x, r.grid_y, r.grid_z, r.marker, r.color, r.bg_color, r.parent_zone]);
  } else {
    const r = p.row;
    await query(
      `UPDATE zones SET description=$2, exits=$3, map_id=$4, grid_x=$5, grid_y=$6, grid_z=$7 WHERE id=$1`,
      [r.id, keepDescription ? cur.description : r.description, JSON.stringify(mergedExits), r.map_id, r.grid_x, r.grid_y, r.grid_z]);
  }
}
// Interior map rows (idempotent upsert).
for (const p of plan) {
  if (!p.interiorMap) continue;
  const m = p.interiorMap;
  await query(
    `INSERT INTO maps (id, name, parent_zone_id, entry_zone_id, created_by) VALUES ($1,$2,$3,$4,'zone-planner')
     ON CONFLICT (id) DO UPDATE SET parent_zone_id=$3, entry_zone_id=$4`,
    [m.id, m.name, m.parent_zone_id, m.entry_zone_id]);
}
console.log(`\n✓ applied: ${creates.length} created, ${updates.length} updated, ${plan.filter(p => p.interiorMap).length} interior maps upserted.`);
console.log('  Next: npm run content:export  → review the diff → commit. Restart a running local server to walk it.');
process.exit(0);
