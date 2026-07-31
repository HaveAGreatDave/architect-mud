// THE STUDIO — a map editor that edits FILES (map-pipeline-spec §10).
//
//   npm run studio            → http://localhost:5180
//   npm run studio -- 5200    → pick another port
//
// Local-only. Do not expose it.
//
// WHAT MAKES IT DIFFERENT FROM THE DEV PANEL
// ──────────────────────────────────────────
// The dev panel's Maps tab edits a live database and syncs files afterwards. This
// reads and writes `content/` and nothing else — there is no database in this
// process at all, so "it looked right in the tool and shipped wrong" has no
// mechanism. Two properties do the work:
//
//   THE PREVIEW IS THE SHIP. Tiles are drawn from the render spec produced by
//   scripts/content/derive.mjs — the same module content:import runs. This server
//   owns no palette, no fill table and no contrast function, so it cannot draw a
//   colour the build would not produce. (That is the §2.3 contract; the dev panel
//   had three private copies of it before step 3 deleted them.)
//
//   THE FORM IS THE CATALOG. Every field in the inspector comes from
//   client/shared/tagCatalog.js — label, shape, group, help, enum options,
//   refTable. There are no hand-written form fields, so a column added to the
//   catalog is editable here immediately and one that isn't catalogued cannot be
//   typed into by accident.
//
// WRITES ARE VALIDATED BEFORE THEY LAND. Every save runs the same shape checks
// content:lint runs (validateZoneColumns / validateTags) plus the schema's own
// column list, and refuses on error. The Studio must not be able to author
// something the deploy gate will reject — finding out at push time is exactly the
// loop this replaces.

import { createServer } from 'node:http';
import { readFile, writeFile, rename, stat } from 'node:fs/promises';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CONTENT_DIR, canonicalJson, schemaColumnsOf, readPalette, assetRefIds } from '../../scripts/content/lib.mjs';
// The registry, for omitWhenNull. NOT a second copy of it: a Studio save and a
// content:export have to produce the same bytes, and the way that stops being an
// aspiration is by reading the rule instead of retyping it. This file used to
// carry `k === 'audio_theme_id' || k === 'marker'` as literals, which meant a
// third omitted column added to the registry would silently make every
// subsequent no-op save produce a diff — quietly voiding the one property the
// whole tool is built on.
import { contentEntries } from '../../server/models/content-registry.js';
import { deriveWorld, projectEdges, deriveMapName, gridKey, featureProvenance } from '../../scripts/content/derive.mjs';
import { applyAnchor, expectedAnchor } from '../../scripts/content/map-anchor.mjs';
// The two structural operations, as pure planners. They live beside derive.mjs and
// map-anchor.mjs for the same reason those do: regress drives them without a server,
// and a rule about what moving a building means must have exactly one home.
import { planMove, planRotate, buildingOf, attachmentsOf, isBuildingish } from '../../scripts/content/transform.mjs';
import { lintContentTree } from '../../scripts/content/lint.mjs';
// tags.js pulls in client/shared/tagCatalog.js for its side effect, so the
// catalog the game validates against is the catalog this tool builds forms from.
import { validateTags, validateZoneColumns, zoneColumnCatalog, districtColumnCatalog, validateDistrictColumns, TAG_CATALOG } from '../../server/engine/tags.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2]) || 5180;

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
};
const json = (res, code, obj) => send(res, code, JSON.stringify(obj));
const readBody = (req) => new Promise((resolve, reject) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => resolve(b)); req.on('error', reject);
});

// ── The content tree, in memory ──────────────────────────────────────────────
// Read once, kept current by every write going through saveZone(). A file the
// Studio did not write (a git pull, a hand edit) needs a restart, which is the
// honest tradeoff for never serving a tile that disagrees with disk.
// Six tables were enough while every edit was a field on a tile. Moving a building
// is not: it repoints roughly a dozen rows that name the facade (the front door, the
// utility generator, every interior tile's anchor), and it has to be able to SEE what
// is standing on the cell it would land on — a streetlight sealed inside a facade is
// a defect nothing else would report. The second group is read for that check and to
// repoint; nothing else in this tool writes them.
//
// `power_zones` is deliberately absent from both. Its id IS the zone id and its row
// is a fact about the cell, so it must not travel with a building — see the note at
// the end of planMove.
const TABLES = [
  'zones', 'maps', 'regions', 'connections', 'doors', 'districts',
  'furniture', 'npcs', 'generators', 'security_devices', 'zone_spawns',
  'job_boards', 'media_cameras', 'media_channels', 'npc_residences', 'aa_sites', 'windows',
];
const tree = {};
let palette = null;
let derived = null;   // { render, edges } — invalidated on every write

// What the tree believes each file looked like when it last saw it: "<table>/<id>"
// → mtimeMs+size. This is what turns "the tree needs a restart after a git pull"
// from a silent data loss into an error — see conflictOf().
const stamps = new Map();
const rowPath = (table, id) => join(CONTENT_DIR, table, `${id}.json`);
const stampOf = (s) => `${s.mtimeMs}:${s.size}`;

function loadTree() {
  stamps.clear();
  for (const t of TABLES) {
    const dir = join(CONTENT_DIR, t);
    const rows = new Map();
    for (const f of readdirSync(dir).filter(n => n.endsWith('.json'))) {
      const p = join(dir, f);
      const row = JSON.parse(readFileSync(p, 'utf8'));
      rows.set(row.id, row);
      stamps.set(`${t}/${row.id}`, stampOf(statSync(p)));
    }
    tree[t] = rows;
  }
  palette = readPalette();
  derived = null;
}

// ── Writing a row ────────────────────────────────────────────────────────────
// THE TREE IS READ ONCE, AND THAT IS ONLY SAFE IF A SAVE CAN TELL. The Studio is
// not the only writer of content/: a git pull writes it, sync-map-anchors.mjs
// writes it, the dev panel's save-hook writes it, and I write it by hand. Without
// this check a save did not merely serve stale data — it overwrote the file from a
// boot-time copy of the row, silently discarding whatever the other writer did.
//
// It is deliberately per-FILE and checked at write time rather than a global "is
// the tree stale" flag: the only question that matters is whether the bytes I am
// about to replace are the bytes I read.
async function conflictOf(table, id) {
  const key = `${table}/${id}`;
  const seen = stamps.get(key);
  if (!seen) return null;                       // never read it; nothing to lose
  let now;
  try { now = stampOf(await stat(rowPath(table, id))); }
  catch { return `content/${table}/${id}.json has been deleted since the Studio read it — restart the Studio`; }
  if (now === seen) return null;
  return `content/${table}/${id}.json changed on disk since the Studio read it `
    + '(a git pull, another tab, sync-map-anchors, or a hand edit). Saving would discard that change. '
    + 'Restart the Studio to pick it up.';
}

// Write, then move into place. A plain writeFile can be interrupted mid-stream and
// leave truncated JSON on disk — and every reader of this tree does a bare
// JSON.parse, so a torn file is not a bad tile, it is a Studio (and an import)
// that will not boot until somebody finds it. rename(2) within a directory is
// atomic, so a reader sees either the old file or the new one.
async function writeRow(table, id, obj) {
  // The one funnel every write goes through, which is the only reason an undo can
  // be complete: the journal does not have to know what a paint stroke is, or that
  // saving a map rewrites 331 tiles. See the action log below.
  record(table, id, obj);
  const p = rowPath(table, id);
  const tmp = `${p}.tmp-${process.pid}`;
  await writeFile(tmp, canonicalJson(obj), 'utf8');
  await rename(tmp, p);
  stamps.set(`${table}/${id}`, stampOf(await stat(p)));
  // A saved name is a ref option somebody is about to pick from. The cache was
  // filled once at first use and never invalidated, so the zone picker and the
  // red NOT IN <table> flagging both went stale within a session.
  REF_CACHE.delete(table);
}

// ── The action log ───────────────────────────────────────────────────────────
// UNDO IS A FILE OPERATION, SO IT LIVES HERE. The obvious place to put Ctrl+Z is
// the client — it knows what you just did — and it would be wrong in both
// directions. It does not know what else the server wrote (saving a map pushes
// the anchor onto every tile; painting one road re-derives four more), and it
// does not survive a reload, while the files it would be apologising for do.
//
// So an action is recorded where the writes happen: every mutation runs inside
// action(), writeRow() reports each file it touches, and the entry keeps the
// WHOLE ROW from both sides — before as the tree held it, after as it was
// written. Undo is then not a reverse-operation ("un-paint", "un-assign", each
// its own inverse to get wrong) but the same write in the other direction.
//
// LIFO, and that is load-bearing. Undoing only the newest entry is what makes it
// sound without a dependency graph: the newest action is, by construction, the
// last writer of every file it touched. A file somebody ELSE wrote in the
// meantime is caught by the same conflictOf() a save is — an undo refuses whole
// rather than reverting half.
const JOURNAL_MAX = 20;
const applied = [];        // oldest → newest; the actions currently in effect
const undoneStack = [];    // index 0 is the newest action undone; redo pops the tail
let seqNo = 0;
let recording = null;

function record(table, id, after) {
  if (!recording) return;
  const key = `${table}/${id}`;
  const seen = recording.files.get(key);
  // One entry per file per action: the first `before` is the state to go back to,
  // and the last `after` is what actually ended up on disk. A stroke that paints
  // the same tile twice is still one thing you did once.
  if (seen) { seen.after = after; return; }
  recording.files.set(key, { table, id, before: tree[table]?.get(id) ?? null, after });
}

// One request is one entry, however many files it turns into. Committed on the way
// out even if the handler reported errors, because a partly-completed paint stroke
// wrote real files and the whole point is to be able to take them back.
async function action(label, fn) {
  if (recording) return fn();   // a nested write joins the action already open
  recording = { label, files: new Map() };
  try {
    return await fn();
  } finally {
    const rec = recording;
    recording = null;
    if (rec.files.size) {
      applied.push({ seq: ++seqNo, at: Date.now(), label: rec.label, files: [...rec.files.values()] });
      undoneStack.length = 0;   // a new action abandons the redo branch, as everywhere
      while (applied.length > JOURNAL_MAX) applied.shift();
    }
  }
}

const publicEntry = (e, undone) => ({
  seq: e.seq, at: e.at, label: e.label, files: e.files.length, undone,
  detail: e.files.slice(0, 8).map(f => f.id).join(', ')
    + (e.files.length > 8 ? `, +${e.files.length - 8} more` : ''),
});
// Newest first in both lists, so the client can concatenate them into one column
// that reads down through time: undone at the top, in effect below.
const journalView = () => ({
  entries: applied.map(e => publicEntry(e, false)).reverse(),
  undone: undoneStack.map(e => publicEntry(e, true)),
  max: JOURNAL_MAX,
});

// Which maps and tiles an entry is about, so the client can go and LOOK at what it
// just took back rather than reporting it into a canvas showing somewhere else.
function touchedBy(entry) {
  const maps = new Set(), zones = [], districts = [];
  for (const f of entry.files) {
    const row = f.before || f.after;
    if (f.table === 'zones') { zones.push(f.id); if (row?.map_id) maps.add(row.map_id); }
    else if (f.table === 'maps') maps.add(f.id);
    else if (f.table === 'districts') districts.push(f.id);
  }
  return { maps: [...maps], zones, districts };
}

// Rewrite every file in an entry to one side of itself. Validation is deliberately
// NOT re-run: this content was on disk, written through the same gate, and refusing
// to restore it because a rule tightened since would leave the tree in the state
// nobody asked for. What IS checked is that the bytes being replaced are the bytes
// this entry left — otherwise an undo silently discards a git pull.
async function applyEntry(entry, side) {
  const objections = [];
  for (const f of entry.files) {
    const conflict = await conflictOf(f.table, f.id);
    if (conflict) objections.push(conflict);
    if (!f[side]) objections.push(`content/${f.table}/${f.id}.json did not exist before this action — the Studio does not create or delete content files`);
  }
  if (objections.length) {
    return { ok: false, errors: [
      `nothing was written — ${objections.length} objection(s) to reverting ${entry.files.length} file(s):`,
      ...objections,
    ] };
  }
  for (const f of entry.files) {
    await writeRow(f.table, f.id, f[side]);   // recording is null here: an undo is not an action
    tree[f.table].set(f.id, f[side]);
  }
  // AS IF IT WERE A FRESH PAINT. derive is whole-map by contract (§7.2) — a
  // building's marker depends on every other building and a road's connector on its
  // neighbours — so the cache is dropped rather than patched, and the next read
  // re-derives the world from the files that now exist. There is no "undo path"
  // through the renderer to get subtly wrong.
  derived = null;
  return { ok: true, entry: publicEntry(entry, side === 'before'), touched: touchedBy(entry) };
}

// The registry's omitWhenNull, per table, read rather than retyped.
const OMIT_WHEN_NULL = new Map(contentEntries()
  .filter(e => Array.isArray(e.omitWhenNull) && e.omitWhenNull.length)
  .map(e => [e.table, new Set(e.omitWhenNull)]));

// An absent-by-default column is written by ABSENCE. A present null is the bug the
// rule exists to catch, and an empty string from a text input is the same
// statement typed differently.
function cleanRow(table, row) {
  const omit = OMIT_WHEN_NULL.get(table) || new Set();
  const clean = {};
  for (const [k, v] of Object.entries(row)) {
    if (omit.has(k)) {
      const blank = v == null || (typeof v === 'string' && v.trim() === '');
      if (blank) continue;
      clean[k] = typeof v === 'string' ? v.trim() : v;
      continue;
    }
    clean[k] = v;
  }
  return clean;
}

// Whole-map, because derive is whole-map (§7.2) — a building's marker depends on
// every other building, so there is no correct per-tile recompute. 5,788 tiles is
// a few milliseconds; the cache exists so a paint stroke doesn't pay it per tile.
function world() {
  if (!derived) {
    const zones = [...tree.zones.values()];
    derived = deriveWorld({
      zones,
      regions: [...tree.regions.values()],
      connections: [...tree.connections.values()],
      palette,
    });
    derived.portals = indexPortals(derived.edges);
  }
  return derived;
}

// WHY this tile draws what it draws — from derive's own precedence, never a second
// copy of it here. The canvas badges an authored pin and the inspector explains it,
// including when a pin has gone stale against the lanes painted since (§7.7).
function provOf(zone) {
  if (!zone) return { source: null, name: null, implied: null };
  return featureProvenance(zone, world().render.get(zone.id)?.spec?.auto_tile ?? null);
}

// The four tiles orthogonally touching this one, on its own map and floor. The
// coordinate index hangs off the derive cache so it is rebuilt exactly when that
// is — a paint stroke is many tiles and one derive, and this must not be the thing
// that makes it many scans of 5,788 files.
const ORTHO = [[0, -1], [1, 0], [0, 1], [-1, 0]];
function coordIndex() {
  const w = world();
  if (!w.byCellId) {
    const m = new Map();
    for (const z of tree.zones.values()) {
      if (z.grid_x == null || z.grid_y == null) continue;
      m.set(gridKey(z.map_id, z.grid_x, z.grid_y, z.grid_z), z.id);
    }
    w.byCellId = m;
  }
  return w.byCellId;
}
function orthoNeighbours(id) {
  const z = tree.zones.get(id);
  if (!z || z.grid_x == null || z.grid_y == null) return [];
  const at = coordIndex();
  return ORTHO
    .map(([dx, dy]) => at.get(gridKey(z.map_id, z.grid_x + dx, z.grid_y + dy, z.grid_z)))
    .filter(Boolean);
}

// ── Portals: the seams between maps ──────────────────────────────────────────
// A warp is not a special kind of tile. It is an edge whose two ends are on
// different maps — which is exactly what projectEdges already decides and labels
// `kind: 'portal'` (§7.5). Reading it from there instead of asking "does this
// look like a front door" is what makes the marking complete: the 150 seams the
// tool draws are the 150 rows the build writes into `zone_edges`, so a facade, a
// bunker hatch, an elevator shaft and a connection authored tomorrow all appear
// here without this file knowing what any of those are.
//
// Both ends are indexed, because a seam is a fact about two tiles and the map you
// happen to be looking at might be the far one. `twoWay` is resolved here rather
// than in the client so a one-way drop is visibly a one-way drop.
function indexPortals(edges) {
  const idx = new Map();
  const bag = (id) => { if (!idx.has(id)) idx.set(id, { out: [], in: [] }); return idx.get(id); };
  const pairs = new Set();
  for (const e of edges) if (e.kind === 'portal') pairs.add(`${e.from_zone}|${e.to_zone}`);
  for (const e of edges) {
    if (e.kind !== 'portal') continue;
    const twoWay = pairs.has(`${e.to_zone}|${e.from_zone}`);
    bag(e.from_zone).out.push({ ...e, twoWay });
    bag(e.to_zone).in.push({ ...e, twoWay });
  }
  return idx;
}

// The far end of a seam, resolved far enough to label it AND to land on it: the
// client must never have to load the other map to find out where it would go.
// `map: null` is a real answer and stays visible — 12 of the 150 lead to a tile
// filed on no map at all (the Echelon suite's bathroom, Solenne's apartments),
// which the build calls a portal because it crosses a map boundary in the only
// sense it can measure. Saying so is more useful than hiding it.
function farEnd(zoneId, mapNames) {
  const z = tree.zones.get(zoneId);
  if (!z) return null;
  return {
    zone: zoneId,
    name: z.name ?? null,
    map: z.map_id ?? null,
    mapName: z.map_id ? (mapNames.get(z.map_id) || z.map_id) : null,
    x: z.grid_x ?? null, y: z.grid_y ?? null, z: z.grid_z ?? 0,
  };
}

// Every seam touching one map, keyed by the tile on THIS side. An inbound edge
// that mirrors an outbound one is dropped — 148 of 150 are two-way, and listing
// both halves would double every entry to say the same thing twice.
function portalsOnMap(mapId, mapNames) {
  const { portals } = world();
  const out = {};
  for (const z of tree.zones.values()) {
    if (z.map_id !== mapId) continue;
    const p = portals.get(z.id);
    if (!p) continue;
    const list = [];
    for (const e of p.out) {
      list.push({ way: 'out', dir: e.direction, twoWay: e.twoWay, connection_id: e.connection_id, far: farEnd(e.to_zone, mapNames) });
    }
    for (const e of p.in) {
      if (e.twoWay) continue;   // the outbound entry above already says it
      list.push({ way: 'in', dir: e.direction, twoWay: false, connection_id: e.connection_id, far: farEnd(e.from_zone, mapNames) });
    }
    const usable = list.filter(e => e.far);
    if (usable.length) out[z.id] = usable;
  }
  return out;
}

// ── Reference targets, for the `ref` shape (§10.1) ───────────────────────────
// The Studio's job ends at "this tile points at that table": it offers a picker
// and complains when a reference does not resolve. It does NOT create the target
// — a loot table or an audio theme is somebody else's entity.
const REF_CACHE = new Map();
// The zone-icon assets are a DIRECTORY OF SVGs, not a content table — but the picker
// wants the same shape a ref gives it, so the catalog names `zone_icons` as a refTable
// and this supplies the rows. Grouped by family in the label so a 100-entry list reads
// as "roads / buildings / runways / one-offs" rather than an alphabet soup.
function iconOptions() {
  const family = (n) => /^road_/.test(n) ? 'road' : /^bldg_/.test(n) ? 'building'
    : /^runway_/.test(n) ? 'runway' : 'other';
  return (assetRefIds('zone_icons') || [])
    .map(id => ({ id, name: `${family(id)} · ${id}` }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function refOptions(table) {
  if (REF_CACHE.has(table)) return REF_CACHE.get(table);
  if (table === 'zone_icons') { const o = iconOptions(); REF_CACHE.set(table, o); return o; }
  let out = [];
  try {
    const dir = join(CONTENT_DIR, table);
    out = readdirSync(dir).filter(n => n.endsWith('.json')).map(n => {
      const row = JSON.parse(readFileSync(join(dir, n), 'utf8'));
      return { id: row.id, name: row.name ?? row.title ?? null };
    }).sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
  } catch { out = []; }
  REF_CACHE.set(table, out);
  return out;
}

// ── Validation: the Studio cannot author what the deploy gate would reject ───
const ZONE_COLS = schemaColumnsOf('zones');
// `mapForAnchor` is the map to hold this tile's anchor against. It defaults to the
// one in the tree, and saveMap passes the map it is ABOUT to write: the anchor push
// validates every tile before writing anything, so at that moment the tree still
// holds the old map and every planned tile would look wrong against it. (The old
// code avoided this by writing the map first and validating tiles afterwards —
// which is precisely how a half-applied push became possible.)
function validateZone(row, mapForAnchor = undefined) {
  const errors = [];
  if (!row?.id) errors.push('no id');
  for (const k of Object.keys(row || {})) {
    if (ZONE_COLS.size && !ZONE_COLS.has(k)) errors.push(`"${k}" is not a column of zones`);
  }
  const cols = validateZoneColumns(row);
  errors.push(...cols.badShape.map(s => `column shape — ${s}`));
  const tags = validateTags(row.flags || {}, 'zone');
  errors.push(...tags.unknown.map(k => `flag "${k}" is not in the field catalog`));
  errors.push(...tags.badShape.map(s => `flag shape — ${s}`));
  // A ref that doesn't resolve is inert in the game and invisible in review —
  // the one thing §10.1 asks this tool to refuse rather than silently accept.
  for (const [col, def] of Object.entries(zoneColumnCatalog())) {
    const v = row[col];
    if (v == null || v === '' || !def.refTable) continue;
    if (!refOptions(def.refTable).some(o => o.id === v)) errors.push(`${col}="${v}" is not a row of ${def.refTable}`);
  }
  // The map owns the anchor. A tile on a map does not get to disagree with it —
  // that is a content:lint ERROR, and the Studio's whole point is that you find
  // that out here rather than at push time. Change it on the map, not the tile.
  const map = mapForAnchor !== undefined ? mapForAnchor : (row?.map_id ? tree.maps.get(row.map_id) : null);
  if (map) {
    const want = expectedAnchor(map);
    if ((row.parent_zone ?? null) !== want) {
      errors.push(`parent_zone is owned by map ${map.id} (anchored on "${want ?? 'nothing'}") — edit the map, not the tile`);
    }
    const wez = row.flags?.world_exit_zone ?? null;
    if (want != null && !row.flags?.facade && wez != null && wez !== want) {
      errors.push(`flags.world_exit_zone="${wez}" disagrees with map ${map.id}'s anchor "${want}" — edit the map, not the tile`);
    }
  }
  return errors;
}

async function saveZone(row) {
  const errors = validateZone(row);
  if (errors.length) return { ok: false, errors };
  const conflict = await conflictOf('zones', row.id);
  if (conflict) return { ok: false, errors: [conflict] };
  const clean = cleanRow('zones', row);
  await writeRow('zones', row.id, clean);
  tree.zones.set(row.id, clean);
  derived = null;
  return { ok: true };
}

// ── Maps: the properties a whole map owns ────────────────────────────────────
// A map hangs off one world tile, and `parent_zone_id` is the ONLY place that is
// decided. Editing it here pushes the new anchor onto every tile on the map in
// the same action, because the alternative — 331 tiles each holding their own
// opinion — is what put Halcyon's Elevator inside its own lobby and left three
// utility rooms pointing at where their building used to stand.
//
// Its name works the same way: omit it and the map is named after the building
// it hangs off, so a rename has one home instead of two.
const MAP_COLS = schemaColumnsOf('maps');
const zoneIndex = () => new Map([...tree.zones.values()].map(z => [z.id, z]));

function mapView(m) {
  const zones = [...tree.zones.values()].filter(z => z.map_id === m.id);
  const idx = zoneIndex();
  const anchor = expectedAnchor(m);
  return {
    map: m,
    // What the list shows and the build will store. Authored wins; otherwise the
    // facade's building_name — the same call content:import makes.
    resolvedName: deriveMapName(m, idx),
    derivedName: deriveMapName({ ...m, name: null }, idx),
    nameIsAuthored: !!(typeof m.name === 'string' && m.name.trim()),
    tiles: zones.length,
    // Offered as the entry-zone picker: an entry zone that isn't on the map is a
    // dive that lands nowhere, which plugins/zone-validator already reports.
    zonesOnMap: zones.map(z => ({ id: z.id, name: z.name })).sort((a, b) =>
      String(a.name || a.id).localeCompare(String(b.name || b.id))),
    // How many tiles a save would rewrite — shown before you commit to it.
    drifted: zones.filter(z => applyAnchor(z, m) !== z).length,
    anchor,
  };
}

// `idx` is the zone index to resolve the derived name against. It defaults to the
// tree's, and a plan passes one with its own pending rows merged in: a move repoints
// this map at the tile that is ABOUT to become the facade, and against the stale tree
// that tile is still plain ground carrying no building_name — so the map would be
// refused for having no derivable name at the exact moment it grew one.
function validateMap(row, idx = zoneIndex()) {
  const errors = [];
  if (!row?.id) errors.push('no id');
  for (const k of Object.keys(row || {})) {
    if (MAP_COLS.size && !MAP_COLS.has(k)) errors.push(`"${k}" is not a column of maps`);
  }
  for (const k of ['parent_zone_id', 'entry_zone_id']) {
    const v = row[k];
    if (v == null || v === '') continue;
    if (!tree.zones.has(v)) errors.push(`${k}="${v}" is not a row of zones`);
  }
  if (row.entry_zone_id && tree.zones.has(row.entry_zone_id)
      && tree.zones.get(row.entry_zone_id).map_id !== row.id) {
    errors.push(`entry_zone_id="${row.entry_zone_id}" is on map ${tree.zones.get(row.entry_zone_id).map_id}, not this one — a dive would land off the map`);
  }
  // `name` is NOT NULL in the schema and absent-by-default in the file: omitting
  // it is a statement ("name me after my building"), and it has to resolve.
  if (!deriveMapName(row, idx)) {
    errors.push('no name, and none derivable — this map\'s parent zone carries no building_name. Type a name.');
  }
  return errors;
}

// SAVING A MAP IS ONE ACTION ACROSS MANY FILES, so it either happens or it does
// not. It used to write the map, then push the anchor tile by tile, and report
// `{ok: true, pushed, failed}` with HTTP 200 when tiles had failed — so the client
// printed "Saved." over a half-applied push, and the half that landed was whichever
// tiles happened to sort first. A pre-existing uncatalogued flag on one tile was
// enough to trigger it, because the push re-validates the whole row.
//
// So every row is validated and conflict-checked BEFORE anything is written, and
// any objection refuses the whole save with nothing touched. That removes the
// realistic partial failure entirely rather than reporting it.
//
// Honest about what remains: N renames are not one atomic operation, so a crash
// between them still leaves some tiles pushed. Each file is individually complete
// (writeRow renames into place), content:lint errors on any tile that disagrees
// with its map, and sync-map-anchors.mjs repairs it idempotently. A journal to
// close that last gap would be more machinery than the failure deserves.
async function saveMap(row) {
  const errors = validateMap(row);
  if (errors.length) return { ok: false, errors };
  const clean = cleanRow('maps', row);

  // What the push would rewrite. A tile already carrying the anchor comes back by
  // identity, so a map whose geometry didn't move plans no writes at all.
  const plan = [];
  for (const z of [...tree.zones.values()].filter(z => z.map_id === row.id)) {
    const next = applyAnchor(z, clean);
    if (next !== z) plan.push(next);
  }

  const objections = [];
  for (const next of plan) {
    const bad = validateZone(next, clean);   // against the map being written, not the stale one
    if (bad.length) objections.push(`${next.id}: ${bad.join('; ')}`);
  }
  for (const [table, id] of [['maps', row.id], ...plan.map(z => ['zones', z.id])]) {
    const conflict = await conflictOf(table, id);
    if (conflict) objections.push(conflict);
  }
  if (objections.length) {
    return { ok: false, errors: [
      `nothing was written — ${objections.length} objection(s) to a save that would have touched ${plan.length + 1} file(s):`,
      ...objections,
    ] };
  }

  await writeRow('maps', row.id, clean);
  tree.maps.set(row.id, clean);
  const pushed = [];
  for (const next of plan) {
    const written = cleanRow('zones', next);
    await writeRow('zones', next.id, written);
    tree.zones.set(next.id, written);
    pushed.push(next.id);
  }
  derived = null;
  return { ok: true, pushed };
}

// ── Districts: the neighbourhood a tile reads as ─────────────────────────────
// A district is not a shape on the map — it is a property every tile claims, and
// until now the only way to claim it was to type a key into a text box on one tile
// at a time, with nothing checking the key was real. So the districts get a VIEW:
// the same canvas, tinted by membership, with the list on the left and a brush.
//
// Resolution mirrors the engine's districtFor(), minus one rung. The engine falls
// back to `hazard` for a tile with lethal danger, and danger is computed from live
// world state the Studio has no access to (and no business simulating). So a tile
// with no district resolves here as UNASSIGNED rather than guessing — which is the
// honest answer for an editor anyway: "nothing says what this is" is the thing you
// want to see on the map, not a fallback painted over it.
const DISTRICT_COLS = schemaColumnsOf('districts');
const FALLBACK_DISTRICT = 'residential';

function prefixIndex() {
  const idx = new Map();
  for (const d of tree.districts.values()) {
    for (const p of Array.isArray(d.prefixes) ? d.prefixes : []) idx.set(p, d.id);
  }
  return idx;
}

// → { id, source } — 'authored' (flags.district), 'prefix' (legacy id rung), or
// null/'none'. The source is half the point: it says whether a tile is where it is
// because somebody put it there, or because its id happens to start with 'slag'.
function districtOfZone(zone, prefixes) {
  const authored = zone?.flags?.district;
  if (authored && tree.districts.has(authored)) return { id: authored, source: 'authored' };
  // An authored key naming no district is a defect, not an assignment — surfaced
  // rather than silently falling through to the prefix rung.
  if (authored) return { id: authored, source: 'unknown' };
  const p = (zone?.id || '').match(/^zone_([a-z0-9]+)/)?.[1] || '';
  const byPrefix = prefixes.get(p);
  if (byPrefix) return { id: byPrefix, source: 'prefix' };
  return { id: null, source: 'none' };
}

function districtsView() {
  const prefixes = prefixIndex();
  const counts = new Map();
  let unassigned = 0;
  const unknown = new Map();
  for (const z of tree.zones.values()) {
    const d = districtOfZone(z, prefixes);
    if (d.source === 'none') { unassigned++; continue; }
    if (d.source === 'unknown') { unknown.set(d.id, (unknown.get(d.id) || 0) + 1); continue; }
    const c = counts.get(d.id) || { authored: 0, prefix: 0 };
    c[d.source]++;
    counts.set(d.id, c);
  }
  const rows = [...tree.districts.values()]
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.id).localeCompare(String(b.id)))
    .map(d => ({
      ...d,
      tiles: (counts.get(d.id)?.authored || 0) + (counts.get(d.id)?.prefix || 0),
      authoredTiles: counts.get(d.id)?.authored || 0,
      prefixTiles: counts.get(d.id)?.prefix || 0,
      // The engine's last rung before hazard. Worth stating on the one district
      // that silently absorbs every tile nobody classified.
      isFallback: d.id === FALLBACK_DISTRICT,
    }));
  return {
    districts: rows,
    unassigned,
    unknown: [...unknown].map(([id, n]) => ({ id, tiles: n })),
  };
}

function validateDistrict(row) {
  const errors = [];
  if (!row?.id) errors.push('no id');
  for (const k of Object.keys(row || {})) {
    if (DISTRICT_COLS.size && !DISTRICT_COLS.has(k)) errors.push(`"${k}" is not a column of districts`);
  }
  const cols = validateDistrictColumns(row);
  errors.push(...cols.badShape.map(s => `column shape — ${s}`));
  // NOT NULL in the schema, and player-facing: an unnamed district would render as
  // a blank neighbourhood in the room header.
  if (!String(row?.name ?? '').trim()) errors.push('name is required — it is what a player reads');
  // A landmark naming a dead zone is SHOWN, not refused. 11 of the 14 districts
  // that have one point at zones the legacy-world purge deleted, so refusing here
  // would mean this tool declining to save prose the deploy gate accepts — the one
  // thing §10 says it must never do. The ref control renders it red and says NOT IN
  // zones, and content:lint warns; fixing them is authoring work, not a save error.
  // Two halves of one sentence ("To the north, <skyline>."). One without the other
  // is a line that can never be built, which is not an error the game reports.
  if (row.landmark && !String(row.skyline ?? '').trim()) errors.push('landmark is set but skyline is empty — no line can be composed from half of it');
  if (row.skyline && !row.landmark) errors.push('skyline is set but no landmark zone — nothing to point at');
  for (const p of Array.isArray(row.prefixes) ? row.prefixes : []) {
    if (!/^[a-z0-9]+$/.test(p)) errors.push(`prefix "${p}" is not a zone-id prefix (lowercase letters and digits, no underscore)`);
    for (const other of tree.districts.values()) {
      if (other.id === row.id) continue;
      if ((other.prefixes || []).includes(p)) errors.push(`prefix "${p}" is already claimed by ${other.id}`);
    }
  }
  return errors;
}

async function saveDistrict(row) {
  const errors = validateDistrict(row);
  if (errors.length) return { ok: false, errors };
  const conflict = await conflictOf('districts', row.id);
  if (conflict) return { ok: false, errors: [conflict] };
  const clean = cleanRow('districts', row);
  // The two list columns are NOT NULL arrays in the schema, so an absent one is a
  // missing value rather than an omitted override — normalized, not dropped.
  for (const k of ['signature', 'prefixes']) clean[k] = Array.isArray(row[k]) ? row[k] : [];
  await writeRow('districts', row.id, clean);
  tree.districts.set(row.id, clean);
  return { ok: true };
}

// Assignment is a paint stroke over flags.district. `district: null` clears the
// flag, which is how a tile is handed back to the legacy prefix rung (or to
// nothing) rather than being stuck in whatever it was last painted.
async function assignDistrict(ids, district) {
  const errors = [];
  const changed = {};
  if (district && !tree.districts.has(district)) return { errors: [`"${district}" is not a district`], changed };
  for (const id of ids) {
    const z = tree.zones.get(id);
    if (!z) { errors.push(`${id}: no such tile`); continue; }
    const flags = { ...(z.flags || {}) };
    if (district) flags.district = district; else delete flags.district;
    const next = { ...z, flags };
    const r = await saveZone(next);
    if (!r.ok) { errors.push(`${id}: ${r.errors.join('; ')}`); continue; }
    changed[id] = district || null;
  }
  return { errors, changed };
}

// ── Structural operations: moving and turning a building ─────────────────────
// The rules live in scripts/content/transform.mjs; this half is the gate they pass
// through. It is saveMap's shape, generalised: validate and conflict-check EVERY
// file the plan would touch, refuse the whole thing on any objection, and only then
// write — wrapped in one `action`, so a move that rewrote 80 files is one Ctrl+Z.
const TABLE_COLS = new Map();
const columnsFor = (table) => {
  if (!TABLE_COLS.has(table)) TABLE_COLS.set(table, schemaColumnsOf(table));
  return TABLE_COLS.get(table);
};

// zones and maps have real invariants and keep their own checkers. Everything else
// the plan touches is rewritten in ONE id-valued or direction-valued field, so the
// schema's column list is the whole of what can go wrong — and it is still read from
// the schema rather than trusted.
function validateRow(table, row, ctx) {
  if (table === 'zones') {
    return validateZone(row, ctx.maps.has(row.map_id) ? ctx.maps.get(row.map_id) : undefined);
  }
  if (table === 'maps') return validateMap(row, ctx.zones);
  const errors = [];
  if (!row?.id) errors.push('no id');
  const cols = columnsFor(table);
  for (const k of Object.keys(row || {})) {
    if (cols.size && !cols.has(k)) errors.push(`"${k}" is not a column of ${table}`);
  }
  return errors;
}

/** The plan's writes, cleaned and deduped — last write to a file wins, as on disk. */
function planFiles(plan) {
  const out = new Map();
  for (const w of plan.writes) out.set(`${w.table}/${w.id}`, { ...w, row: cleanRow(w.table, w.row) });
  return [...out.values()];
}

async function applyPlan(plan) {
  if (plan.errors.length) return { ok: false, errors: plan.errors };
  const files = planFiles(plan);

  // The plan's own pending rows, so each file is judged against the tree the write
  // is about to produce rather than the one it is replacing.
  const ctx = { maps: new Map(), zones: zoneIndex() };
  for (const f of files) {
    if (f.table === 'maps') ctx.maps.set(f.id, f.row);
    if (f.table === 'zones') ctx.zones.set(f.id, f.row);
  }

  const objections = [];
  for (const f of files) {
    if (!tree[f.table]) { objections.push(`${f.table} is not a table the Studio holds`); continue; }
    // The same rule every other route here keeps (spec §10.1): this tool edits
    // content, it does not bring it into existence. A plan naming a file that is not
    // there is a bug in the planner, not a file to create.
    if (!tree[f.table].has(f.id)) { objections.push(`content/${f.table}/${f.id}.json does not exist — the Studio does not create content files`); continue; }
    const bad = validateRow(f.table, f.row, ctx);
    if (bad.length) objections.push(`${f.table}/${f.id}: ${bad.join('; ')}`);
  }
  for (const f of files) {
    const conflict = await conflictOf(f.table, f.id);
    if (conflict) objections.push(conflict);
  }
  if (objections.length) {
    return { ok: false, errors: [
      `nothing was written — ${objections.length} objection(s) to a change that would have touched ${files.length} file(s):`,
      ...objections,
    ] };
  }

  for (const f of files) {
    await writeRow(f.table, f.id, f.row);
    tree[f.table].set(f.id, f.row);
  }
  derived = null;
  return { ok: true, files: files.map(f => `${f.table}/${f.id}`), warnings: plan.warnings };
}

/**
 * What arming the Move tool needs to draw an honest ghost without a round trip per
 * hover: which cells are already built on, and which have something standing on
 * them. Both lists are short (62 and 178 world-wide) and both are the CHEAP half of
 * the refusals — the authoritative answer is still the plan, on click.
 */
function moveArm(facadeId) {
  const b = buildingOf(tree, facadeId);
  if (b.error) return { error: b.error };
  const built = [], occupied = [];
  for (const z of tree.zones.values()) {
    if (z.map_id !== b.facade.map_id) continue;
    if (isBuildingish(z)) { built.push(z.id); continue; }
    if (attachmentsOf(tree, z.id).length) occupied.push(z.id);
  }
  return {
    facade: b.facade.id,
    name: b.facade.flags?.building_name || b.facade.name,
    entrance: b.facade.flags?.entrance ?? null,
    interior: b.interior.length,
    built, occupied,
  };
}

/** Which door sides this building could turn to, so the inspector can offer them. */
function turnOptions(facadeId) {
  const b = buildingOf(tree, facadeId);
  if (b.error) return { error: b.error };
  const sides = [];
  for (let k = 1; k <= 3; k++) {
    const p = planRotate(tree, facadeId, k);
    sides.push({ k, to: p.to ?? null, ok: !p.errors.length, why: p.errors[0] ?? null });
  }
  return { facade: b.facade.id, entrance: b.facade.flags?.entrance ?? null, sides };
}

// ── Server ───────────────────────────────────────────────────────────────────
loadTree();

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const path = url.pathname;

    if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
      return send(res, 200, await readFile(join(HERE, 'index.html')), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && path === '/studio.js') {
      return send(res, 200, await readFile(join(HERE, 'studio.js')), 'text/javascript; charset=utf-8');
    }

    // The game's own zone-icon assets, served so the canvas rasterises the SAME file
    // the minimap masks rather than a canvas impression of it. Name-restricted to
    // `[A-Za-z0-9_-]` and joined onto a fixed directory, so the path cannot climb out
    // of it — the Studio is local-only, but a traversal here would read any file on
    // the machine and that is not a bet worth taking for one route.
    const icon = /^\/zone-icons\/([A-Za-z0-9_-]+)\.svg$/.exec(path);
    if (req.method === 'GET' && icon) {
      try {
        const buf = await readFile(join(HERE, '..', '..', 'client', 'game', 'assets', 'zone-icons', `${icon[1]}.svg`));
        return send(res, 200, buf, 'image/svg+xml; charset=utf-8');
      } catch { return send(res, 404, 'no such icon', 'text/plain; charset=utf-8'); }
    }

    // The catalog IS the form. Shipped whole so the client renders fields it has
    // never heard of, which is what stops this tool needing an edit per column.
    if (req.method === 'GET' && path === '/api/catalog') {
      const columns = zoneColumnCatalog();
      const flags = Object.fromEntries(Object.entries(TAG_CATALOG).filter(([, d]) => d?.scope === 'zone'));
      const refs = {};
      for (const def of [...Object.values(columns), ...Object.values(flags)]) {
        if (def.refTable && !refs[def.refTable]) refs[def.refTable] = refOptions(def.refTable);
      }
      return json(res, 200, { columns, flags, refs });
    }

    // One map's tiles plus the DERIVED spec for each — never a colour this server
    // decided on.
    if (req.method === 'GET' && path === '/api/world') {
      const mapId = url.searchParams.get('map');
      const { render } = world();
      const idx = zoneIndex();
      // The RESOLVED name, not the authored one: a map that derives its name has
      // no `name` key at all, and a list showing its id instead would be the tool
      // disagreeing with the build about what the thing is called.
      const maps = [...tree.maps.values()].map(m => ({
        id: m.id, name: deriveMapName(m, idx) || m.id, parent_zone_id: m.parent_zone_id,
      }));
      const counts = new Map();
      for (const z of tree.zones.values()) counts.set(z.map_id, (counts.get(z.map_id) || 0) + 1);
      const mapNames = new Map(maps.map(m => [m.id, m.name]));
      const prefixes = prefixIndex();
      const zones = mapId
        ? [...tree.zones.values()].filter(z => z.map_id === mapId).map(z => ({
            // No `marker`: the canvas letters a tile from `spec.label` and nothing
            // reads a marker here (regress asserts draw() doesn't). A second copy
            // of the glyph shipped to a non-consumer is how the next reader
            // concludes there are two ways to letter a tile.
            id: z.id, name: z.name, grid_x: z.grid_x, grid_y: z.grid_y, grid_z: z.grid_z,
            spec: render.get(z.id)?.spec ?? {},
            prov: provOf(z),
            // Which district this tile reads as, and WHY — the district view tints
            // from this, and the tile inspector states it. Shipped with the tile
            // rather than fetched per district so switching views is instant.
            district: districtOfZone(z, prefixes),
          }))
        : [];
      return json(res, 200, {
        maps: maps.map(m => ({ ...m, tiles: counts.get(m.id) || 0 })).sort((a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0)),
        mapId, zones,
        portals: mapId ? portalsOnMap(mapId, mapNames) : {},
        terrains: Object.entries(palette?.terrains || {}).map(([key, t]) => ({ key, label: t.label || key, fill: t.fill })),
      });
    }

    // Every district, with how many tiles claim it and how. Also the two things a
    // list of districts cannot show by itself: tiles claiming a district that does
    // not exist, and tiles claiming nothing at all.
    if (req.method === 'GET' && path === '/api/districts') {
      return json(res, 200, { ...districtsView(), catalog: districtColumnCatalog() });
    }

    // One district's authored row. PUT writes content/districts/<id>.json.
    const dm = path.match(/^\/api\/district\/(.+)$/);
    if (dm) {
      const id = decodeURIComponent(dm[1]);
      const row = tree.districts.get(id);
      if (!row) return json(res, 404, { error: 'no such district' });
      if (req.method === 'GET') return json(res, 200, { district: row });
      if (req.method === 'PUT') {
        let body; try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { errors: ['body is not JSON'] }); }
        if (body.id !== id) return json(res, 400, { errors: ['id in body does not match the URL'] });
        const r = await action(`District ${row.name || id}`, () => saveDistrict(body));
        if (!r.ok) return json(res, 422, r);
        return json(res, 200, { district: tree.districts.get(id), ...districtsView(), journal: journalView() });
      }
    }

    // Assignment: paint flags.district across a stroke of tiles. Same shape as
    // /api/paint, and deliberately the same gesture — a district is a region of
    // the map, so it is painted like one.
    if (req.method === 'POST' && path === '/api/assign') {
      let body; try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { errors: ['body is not JSON'] }); }
      const ids = Array.isArray(body.ids) ? body.ids : [];
      const into = body.district || null;
      const label = into
        ? `Assign ${tree.districts.get(into)?.name || into} — ${ids.length} tile(s)`
        : `Clear district — ${ids.length} tile(s)`;
      const r = await action(label, () => assignDistrict(ids, into));
      return json(res, 200, { ...r, ...districtsView(), journal: journalView() });
    }

    // A map's own properties. PUT writes content/maps/<id>.json and pushes the
    // anchor onto every tile in the same action.
    const mm = path.match(/^\/api\/map\/(.+)$/);
    if (mm) {
      const id = decodeURIComponent(mm[1]);
      const row = tree.maps.get(id);
      if (!row) return json(res, 404, { error: 'no such map' });
      if (req.method === 'GET') return json(res, 200, mapView(row));
      if (req.method === 'PUT') {
        let body; try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { errors: ['body is not JSON'] }); }
        if (body.id !== id) return json(res, 400, { errors: ['id in body does not match the URL'] });
        const r = await action(`Map ${deriveMapName(row, zoneIndex()) || id}`, () => saveMap(body));
        if (!r.ok) return json(res, 422, r);
        return json(res, 200, { ...r, ...mapView(tree.maps.get(id)), journal: journalView() });
      }
    }

    // The authored row itself, for the inspector.
    const zm = path.match(/^\/api\/zone\/(.+)$/);
    if (zm) {
      const id = decodeURIComponent(zm[1]);
      if (req.method === 'GET') {
        const row = tree.zones.get(id);
        if (!row) return json(res, 404, { error: 'no such zone' });
        return json(res, 200, { zone: row, spec: world().render.get(id)?.spec ?? {}, prov: provOf(row) });
      }
      if (req.method === 'PUT') {
        // Only a zone that exists can be saved. This is the same rule the map and
        // district routes enforce, and it is carrying more than symmetry: the id
        // becomes a filename in saveZone, so an id this tree has never heard of is
        // either a new entity (which the Studio deliberately does not create — spec
        // §10.1) or a path pointed somewhere it must not write.
        if (!tree.zones.has(id)) return json(res, 404, { error: 'no such zone' });
        let body; try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { errors: ['body is not JSON'] }); }
        if (body.id !== id) return json(res, 400, { errors: ['id in body does not match the URL'] });
        const was = tree.zones.get(id);
        const r = await action(`Edit ${was?.name || id}`, () => saveZone(body));
        if (!r.ok) return json(res, 422, r);
        // spec AND prov: setting Map Icon changes which rung wins, so the inspector's
        // explanation and the canvas badge have to move with the save that caused it.
        return json(res, 200, { ok: true, spec: world().render.get(id)?.spec ?? {},
          prov: provOf(tree.zones.get(id)), journal: journalView() });
      }
    }

    // A paint stroke: many tiles, one derive, one response.
    if (req.method === 'POST' && path === '/api/paint') {
      const { ids = [], terrain = null } = JSON.parse(await readBody(req) || '{}');
      if (terrain && !palette?.terrains?.[terrain]) return json(res, 400, { errors: [`no palette entry for "${terrain}"`] });
      const errors = [];
      await action(terrain
        ? `Paint ${palette.terrains[terrain].label || terrain} — ${ids.length} tile(s)`
        : `Clear terrain — ${ids.length} tile(s)`, async () => {
        for (const id of ids) {
          const row = tree.zones.get(id);
          if (!row) { errors.push(`${id}: no such zone`); continue; }
          // A BUILDING IS NOT GROUND. Painting one is silently destructive: the tile
          // keeps its rooftop but loses its map code, because derive suppresses a label
          // on painted ground and resolveTerrain reads flags.terrain before its own
          // "a building footprint is not ground" rung. Hall of Records and Halloran's
          // Fix-It were both in that state, codeless and looking untouched. Refused
          // here so the brush cannot do it, and content:lint errors if it arrives any
          // other way. CLEARING terrain on one is always allowed — that is the repair.
          const fl = row.flags || {};
          if (terrain && row.map_id === 'map_world' && (fl.facade || fl.is_building)) {
            errors.push(`${id} (${row.name || 'unnamed'}): a building tile cannot carry ground — painting it would remove its map code`);
            continue;
          }
          const flags = { ...fl };
          if (terrain) flags.terrain = terrain; else delete flags.terrain;
          const r = await saveZone({ ...row, flags });
          if (!r.ok) errors.push(`${id}: ${r.errors.join('; ')}`);
        }
      });
      const { render } = world();
      // The stroke plus everything it changed the LOOK of. A tile the palette
      // auto-tiles draws a connector derived from its neighbours, so painting one
      // road tile re-draws the four around it — and returning only the painted ids
      // would leave a new lane meeting an old one that still thinks it is a dead
      // end, until you reloaded the map. One tile of radius is the whole blast
      // radius of deriveAutoTile, so this is complete rather than generous.
      const touched = new Set(ids.filter(i => tree.zones.has(i)));
      for (const id of [...touched]) for (const n of orthoNeighbours(id)) touched.add(n);
      return json(res, errors.length ? 207 : 200, {
        errors,
        specs: Object.fromEntries([...touched].map(i => [i, render.get(i)?.spec ?? {}])),
        provs: Object.fromEntries([...touched].map(i => [i, provOf(tree.zones.get(i))])),
        journal: journalView(),
      });
    }

    // ── Move a building ──────────────────────────────────────────────────────
    // Arming: the cheap half of the refusals, once, so the ghost can be honest
    // while the cursor moves instead of one POST per hovered cell.
    const arm = path.match(/^\/api\/move-arm\/(.+)$/);
    if (req.method === 'GET' && arm) {
      const r = moveArm(decodeURIComponent(arm[1]));
      return json(res, r.error ? 400 : 200, r);
    }

    // A PLAN WRITES NOTHING. It is the same call the commit makes, so what the
    // panel lists is what would land — not a description of it maintained beside
    // the thing it describes.
    if (req.method === 'POST' && path === '/api/move-plan') {
      const { facadeId, toX, toY, donorId = null } = JSON.parse(await readBody(req) || '{}');
      const plan = planMove(tree, facadeId, Number(toX), Number(toY), { donorId });
      const donor = plan.donorId ? tree.zones.get(plan.donorId) : null;
      return json(res, 200, {
        errors: plan.errors, warnings: plan.warnings, label: plan.label,
        files: planFiles(plan).map(f => `${f.table}/${f.id}`),
        donor: donor ? { id: donor.id, name: donor.name, terrain: donor.flags?.terrain ?? null } : null,
        // What the eyedropper may pick instead: the plain ground touching the hole.
        donorOptions: (() => {
          const f = tree.zones.get(facadeId);
          if (!f) return [];
          const out = [];
          for (const id of orthoNeighbours(facadeId)) {
            const z = tree.zones.get(id);
            if (z && !isBuildingish(z)) out.push({ id, name: z.name, terrain: z.flags?.terrain ?? null });
          }
          return out;
        })(),
      });
    }

    if (req.method === 'POST' && path === '/api/move') {
      const { facadeId, toX, toY, donorId = null } = JSON.parse(await readBody(req) || '{}');
      const plan = planMove(tree, facadeId, Number(toX), Number(toY), { donorId });
      const r = await action(plan.label, () => applyPlan(plan));
      if (!r.ok) return json(res, 422, r);
      // `facadeId` comes back because it CHANGED: the destination row is the
      // building now, and a client still holding the old id would open a tile that
      // is a patch of street.
      return json(res, 200, { ...r, facadeId: plan.facadeId, journal: journalView() });
    }

    // ── Turn a building ──────────────────────────────────────────────────────
    const turn = path.match(/^\/api\/turn-options\/(.+)$/);
    if (req.method === 'GET' && turn) {
      const r = turnOptions(decodeURIComponent(turn[1]));
      return json(res, r.error ? 400 : 200, r);
    }

    if (req.method === 'POST' && path === '/api/rotate') {
      const { facadeId, k = 1 } = JSON.parse(await readBody(req) || '{}');
      const plan = planRotate(tree, facadeId, Number(k));
      const r = await action(plan.label, () => applyPlan(plan));
      if (!r.ok) return json(res, 422, r);
      return json(res, 200, { ...r, from: plan.from, to: plan.to, journal: journalView() });
    }

    // ── Undo / redo ──────────────────────────────────────────────────────────
    // The log itself, so a reloaded tab still knows what this session did — the
    // files it is apologising for outlive the page.
    if (req.method === 'GET' && path === '/api/journal') return json(res, 200, journalView());

    if (req.method === 'POST' && (path === '/api/undo' || path === '/api/redo')) {
      const back = path === '/api/undo';
      const entry = back ? applied[applied.length - 1] : undoneStack[undoneStack.length - 1];
      if (!entry) return json(res, 409, { errors: [back ? 'nothing to undo' : 'nothing to redo'] });
      const r = await applyEntry(entry, back ? 'before' : 'after');
      // 409, not 422: nothing is wrong with the request — the world moved under it,
      // and the entry stays exactly where it is so the next attempt is the same one.
      if (!r.ok) return json(res, 409, { ...r, journal: journalView() });
      if (back) { applied.pop(); undoneStack.push(entry); }
      else { undoneStack.pop(); applied.push(entry); }
      return json(res, 200, { ...r, direction: back ? 'undo' : 'redo', journal: journalView() });
    }

    // The authored half of the audit, live (§8.4). It reads the tree from DISK, so
    // it is answering about what would actually ship — and the derived half is not
    // pretended at: those rules need an import and say so in the UI.
    if (req.method === 'GET' && path === '/api/lint') {
      const { errors, warnings } = lintContentTree();
      const { undeclaredOneWays } = projectEdges([...tree.zones.values()], [...tree.connections.values()]);
      return json(res, 200, { errors, warnings, undeclaredOneWays: undeclaredOneWays.length });
    }

    return json(res, 404, { error: 'not found' });
  } catch (err) {
    return json(res, 500, { error: String(err?.message || err) });
  }
});

server.listen(PORT, () => {
  console.log(`Studio → http://localhost:${PORT}`);
  console.log(`Editing files under ${CONTENT_DIR} — no database in this process.`);
});
