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
import { readFile, writeFile } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CONTENT_DIR, canonicalJson, schemaColumnsOf, readPalette } from '../../scripts/content/lib.mjs';
import { deriveWorld, projectEdges, deriveMapName } from '../../scripts/content/derive.mjs';
import { applyAnchor, expectedAnchor } from '../../scripts/content/map-anchor.mjs';
import { lintContentTree } from '../../scripts/content/lint.mjs';
// tags.js pulls in client/shared/tagCatalog.js for its side effect, so the
// catalog the game validates against is the catalog this tool builds forms from.
import { validateTags, validateZoneColumns, zoneColumnCatalog, TAG_CATALOG } from '../../server/engine/tags.js';

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
const TABLES = ['zones', 'maps', 'regions', 'connections', 'doors'];
const tree = {};
let palette = null;
let derived = null;   // { render, edges } — invalidated on every write

function loadTree() {
  for (const t of TABLES) {
    const dir = join(CONTENT_DIR, t);
    const rows = new Map();
    for (const f of readdirSync(dir).filter(n => n.endsWith('.json'))) {
      const row = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      rows.set(row.id, row);
    }
    tree[t] = rows;
  }
  palette = readPalette();
  derived = null;
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
  }
  return derived;
}

// ── Reference targets, for the `ref` shape (§10.1) ───────────────────────────
// The Studio's job ends at "this tile points at that table": it offers a picker
// and complains when a reference does not resolve. It does NOT create the target
// — a loot table or an audio theme is somebody else's entity.
const REF_CACHE = new Map();
function refOptions(table) {
  if (REF_CACHE.has(table)) return REF_CACHE.get(table);
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
function validateZone(row) {
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
  const map = row?.map_id ? tree.maps.get(row.map_id) : null;
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
  // Null override columns are omitted, matching the registry's omitWhenNull — so
  // a Studio save and a content:export produce the same bytes.
  const clean = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null && (k === 'audio_theme_id' || k === 'marker')) continue;
    clean[k] = v;
  }
  await writeFile(join(CONTENT_DIR, 'zones', `${row.id}.json`), canonicalJson(clean), 'utf8');
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

function validateMap(row) {
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
  if (!deriveMapName(row, zoneIndex())) {
    errors.push('no name, and none derivable — this map\'s parent zone carries no building_name. Type a name.');
  }
  return errors;
}

async function saveMap(row) {
  const errors = validateMap(row);
  if (errors.length) return { ok: false, errors };
  const clean = {};
  for (const [k, v] of Object.entries(row)) {
    // An empty name means "derive it", and the registry's omitWhenNull says that
    // is written by ABSENCE — a present null is the bug that rule exists to catch.
    if (k === 'name' && (v == null || String(v).trim() === '')) continue;
    clean[k] = k === 'name' ? String(v).trim() : v;
  }
  await writeFile(join(CONTENT_DIR, 'maps', `${row.id}.json`), canonicalJson(clean), 'utf8');
  tree.maps.set(row.id, clean);

  // The push. Every tile on this map takes the map's anchor; a tile already
  // carrying it is returned by identity and never rewritten, so this is a no-op
  // for a map whose geometry didn't move.
  const pushed = [];
  const failed = [];
  for (const z of [...tree.zones.values()].filter(z => z.map_id === row.id)) {
    const next = applyAnchor(z, clean);
    if (next === z) continue;
    const r = await saveZone(next);
    if (r.ok) pushed.push(z.id); else failed.push(`${z.id}: ${r.errors.join('; ')}`);
  }
  derived = null;
  return { ok: true, pushed, failed };
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
      const zones = mapId
        ? [...tree.zones.values()].filter(z => z.map_id === mapId).map(z => ({
            id: z.id, name: z.name, grid_x: z.grid_x, grid_y: z.grid_y, grid_z: z.grid_z,
            spec: render.get(z.id)?.spec ?? {}, marker: render.get(z.id)?.marker ?? null,
          }))
        : [];
      return json(res, 200, {
        maps: maps.map(m => ({ ...m, tiles: counts.get(m.id) || 0 })).sort((a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0)),
        mapId, zones,
        terrains: Object.entries(palette?.terrains || {}).map(([key, t]) => ({ key, label: t.label || key, fill: t.fill })),
      });
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
        const r = await saveMap(body);
        if (!r.ok) return json(res, 422, r);
        return json(res, 200, { ...r, ...mapView(tree.maps.get(id)) });
      }
    }

    // The authored row itself, for the inspector.
    const zm = path.match(/^\/api\/zone\/(.+)$/);
    if (zm) {
      const id = decodeURIComponent(zm[1]);
      if (req.method === 'GET') {
        const row = tree.zones.get(id);
        if (!row) return json(res, 404, { error: 'no such zone' });
        return json(res, 200, { zone: row, spec: world().render.get(id)?.spec ?? {} });
      }
      if (req.method === 'PUT') {
        let body; try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { errors: ['body is not JSON'] }); }
        if (body.id !== id) return json(res, 400, { errors: ['id in body does not match the URL'] });
        const r = await saveZone(body);
        if (!r.ok) return json(res, 422, r);
        return json(res, 200, { ok: true, spec: world().render.get(id)?.spec ?? {} });
      }
    }

    // A paint stroke: many tiles, one derive, one response.
    if (req.method === 'POST' && path === '/api/paint') {
      const { ids = [], terrain = null } = JSON.parse(await readBody(req) || '{}');
      if (terrain && !palette?.terrains?.[terrain]) return json(res, 400, { errors: [`no palette entry for "${terrain}"`] });
      const errors = [];
      for (const id of ids) {
        const row = tree.zones.get(id);
        if (!row) { errors.push(`${id}: no such zone`); continue; }
        const flags = { ...(row.flags || {}) };
        if (terrain) flags.terrain = terrain; else delete flags.terrain;
        const r = await saveZone({ ...row, flags });
        if (!r.ok) errors.push(`${id}: ${r.errors.join('; ')}`);
      }
      const { render } = world();
      return json(res, errors.length ? 207 : 200, {
        errors,
        specs: Object.fromEntries(ids.filter(i => tree.zones.has(i)).map(i => [i, render.get(i)?.spec ?? {}])),
      });
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
