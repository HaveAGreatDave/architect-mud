// Place a building by writing CONTENT FILES ONLY. No database, no server.
//
//   node scripts/place-building.mjs --x 920 --y 911 --type shop [--name "Ration Nine"]
//   node scripts/place-building.mjs --x 920 --y 911 --type shop --dry-run
//
// This is the step-2 proof from docs/proposals/map-pipeline-spec.md §10.2: everything
// the dev panel's "New Building" does, done as a git-reviewable diff.
//
// WHY A CLI AND NOT THE ROUTE
// ───────────────────────────
// `POST /maps/build-building` writes six tables with ~15 bare query() calls, has NO
// transaction (a failure at step 5 leaves a half-built building committed and live),
// and syncs ZERO content files — content-sync.js resolves one entity per request and
// that route matches no arm. A building built in the panel therefore exists only in
// the author's local DB. A git commit is strictly more atomic than what ships.
//
// THREE DELIBERATE DIFFERENCES FROM THE ROUTE
// ───────────────────────────────────────────
//  1. ONLY THE FRONTING STREET is wired into the facade. The route gives EVERY
//     standable neighbour a reciprocal exit in (routes.js), which is the audit's
//     BLD-1 — walk-through-wall — by construction: you enter a building through its
//     back wall because a tile happened to be adjacent. A building has one door and
//     the door is `flags.entrance`. This makes BLD-1 unexpressible here rather than
//     fixable afterwards (spec §12).
//  2. IDS ARE DETERMINISTIC. The route mints `npc_${Date.now()}`, so re-running it
//     duplicates the inhabitant. Every id here derives from the placement, so a
//     re-run is an upsert and produces no diff.
//  3. NO LIVE-WORLD SIDE EFFECTS. `installRegionPlant` (the power-building special
//     case) repoints existing buildings across a region — an operation on a running
//     world, not an authored fact. It stays in the dev panel; this prints a note.
//
// The utility room / junction box / lighting comes from the SAME blueprint the route
// uses (tools/lib/utility-room.mjs), run against the file sink instead of a database.

import { loadContentStore } from '../tools/lib/content-store.mjs';
import { templateForType, BUILD_DIR_OFF } from '../tools/lib/building-templates.mjs';
import { authorUtilityRoom } from '../tools/lib/utility-room.mjs';
import { npcTypeForPersonality, pickClothingForPersonality, DEFAULT_VENDOR_SCHEDULE } from '../server/engine/npc-personality.js';
import { decideSex } from '../server/engine/npc-sex.js';
import { uniqueMarkerFor } from '../tools/lib/marker.mjs';

const OPPOSITE = { north: 'south', south: 'north', east: 'west', west: 'east', up: 'down', down: 'up' };

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const toX = Number(flag('x'));
const toY = Number(flag('y'));
const toZ = Number(flag('z', '0'));
const buildingType = String(flag('type', '')).toLowerCase().trim();
const nameArg = flag('name');
const dryRun = has('dry-run');

if (!Number.isFinite(toX) || !Number.isFinite(toY) || !buildingType) {
  console.error('usage: node scripts/place-building.mjs --x <n> --y <n> [--z <n>] --type <building_type> [--name "…"] [--dry-run]');
  process.exit(2);
}

const die = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };

// ── the world, as files ──────────────────────────────────────────────────────
const store = loadContentStore();
const MAP_ID = 'map_world';

const worldTiles = store.all('zones').filter(z => z.map_id === MAP_ID);
const at = (x, y, z) => worldTiles.find(t => t.grid_x === x && t.grid_y === y && (t.grid_z ?? 0) === z);

// Terrain, read the way the engine reads it: authored `flags.terrain` is the SSOT.
// Only the authored half is consulted here — the inference fallbacks in world.js's
// zoneTerrain (bg_color sniffing, icon prefixes) are exactly what this redesign is
// removing, and a placement tool must not depend on one.
const terrainOf = (t) => t?.flags?.terrain || (t?.flags?.water ? 'water' : null);
const isBuildingish = (t) => !!t && !!(
  t.flags?.facade || t.flags?.is_building || t.flags?.is_interior ||
  t.flags?.is_apartment || t.flags?.building_type
);
const standable = (t) => !!t && !isBuildingish(t) && terrainOf(t) !== 'water';

const target = at(toX, toY, toZ);
// Re-running the same placement is an UPSERT, not an error: every id below derives
// from the coordinates, so a second run rewrites the same files. Only a DIFFERENT
// building (or water) on the cell is a refusal.
const occupiedByOther = (isBuildingish(target) || terrainOf(target) === 'water')
  && !(target?.flags?.facade && target.flags?.building_type === buildingType);
if (occupiedByOther) {
  die(`(${toX}, ${toY}, ${toZ}) already holds a ${terrainOf(target) === 'water' ? 'water tile' : `different building (${target.flags?.building_name || target.name})`} — pick an empty or ground tile.`);
}

const neighbours = [];
for (const [dir, off] of Object.entries(BUILD_DIR_OFF)) {
  const n = at(toX + off[0], toY + off[1], toZ);
  if (standable(n)) neighbours.push({ dir, n });
}
if (!neighbours.length) {
  die('No adjacent street to enter from — place the building next to a walkable ground/road tile.');
}
const front = neighbours.find(x => terrainOf(x.n) === 'road') || neighbours[0];

// ── identity ─────────────────────────────────────────────────────────────────
const tmpl = templateForType(buildingType);
const isHangar = buildingType === 'hangar';
const buildingName = (nameArg && nameArg.trim())
  || tmpl.facadeName
  || (buildingType.charAt(0).toUpperCase() + buildingType.slice(1).replace(/_/g, ' '));

const slug = `${toX}_${toY}${toZ ? `_z${toZ}` : ''}`;
const facadeId = target ? target.id : `zone_district_${slug}`;
const interiorMapId = `map_int_bld_${slug}`;
const lobbyId = `zone_bld_${slug}_lobby`;
const regionId = target?.flags?.region_id
  || neighbours.map(x => x.n.flags?.region_id).find(Boolean)
  || null;

// The door side is AUTHORED (world.js's buildingEntranceDir is a straight read of
// flags.entrance) and the interior leaves the SAME way the door faces — the geometry
// all 61 shipped buildings are wired to.
const entranceDir = front.dir;
const backDir = entranceDir;

// ── 1. the facade ────────────────────────────────────────────────────────────
const keepFlags = { ...(target?.flags || {}) };
delete keepFlags.terrain; delete keepFlags.runway; delete keepFlags.pier; delete keepFlags.water;
if (/^(runway_|road_)/.test(keepFlags.icon || '')) delete keepFlags.icon;

const facadeFlags = {
  ...keepFlags,
  is_building: true, facade: true,
  building_name: buildingName, building_type: buildingType,
  entrance: entranceDir, world_exit_zone: front.n.id,
};
if (regionId) facadeFlags.region_id = regionId;
if (isHangar) facadeFlags.hangar_interior_zone = lobbyId;

// The facade's exits are REPLACED, not extended: exactly the entrance-side street and
// the interior link. A ground tile being converted arrives with cardinal exits to all
// its walkable neighbours, and keeping them is precisely BLD-1 — the building becomes
// a walkway you enter through its back wall.
//
// The interior link is the cardinal OPPOSITE the entrance, never `in`: interiorExitDirs()
// only draws way-out arrows for cardinal links, so an `in` link leaves the interior map
// with no arrow home (audit DIR-1). The lobby's exit back out faces the entrance side,
// which makes the pair reciprocal.
const facadeExits = {
  [entranceDir]: front.n.id,
  [OPPOSITE[entranceDir]]: lobbyId,
};

// Markers are authored (36f1b8f3): no renderer derives one, so an unstamped building
// draws no letters at all. Stamp the derived acronym, avoiding codes already in use.
const takenMarkers = new Set(
  store.all('zones')
    .filter(z => z.id !== facadeId && z.flags?.facade && z.marker)
    .map(z => String(z.marker).toUpperCase())
);
const marker = uniqueMarkerFor(buildingName, takenMarkers);

store.patch('zones', facadeId, {
  id: facadeId,
  name: buildingName,
  description: target?.description || `The frontage of ${buildingName}.`,
  exits: facadeExits,
  ambient_events: target?.ambient_events ?? [],
  ambient_theme: target?.ambient_theme ?? 'outdoors',
  flags: facadeFlags,
  map_id: MAP_ID,
  grid_x: toX, grid_y: toY, grid_z: toZ,
  parent_zone: null,
  marker,
});

// ── 2. the door, from the street side — and ONLY from there ──────────────────
// Every inbound link from anywhere except the entrance street is a second door the
// author never chose. Strip them at the source, which is the other half of BLD-1.
const sealed = [];
for (const z of store.all('zones')) {
  if (z.id === facadeId) continue;
  // This building's own interior points back at the facade on purpose — that link IS
  // the way out. Only OUTSIDE tiles can hold a second door. (Matters on a re-run,
  // when the interior already exists.)
  if (z.parent_zone === facadeId || z.map_id === interiorMapId) continue;
  const links = Object.entries(z.exits || {}).filter(([, t]) => t === facadeId);
  if (!links.length) continue;
  if (z.id === front.n.id) {
    // The street keeps exactly its door-side link.
    const want = OPPOSITE[entranceDir];
    const exits = { ...z.exits };
    let changed = false;
    for (const [dir] of links) if (dir !== want) { delete exits[dir]; changed = true; }
    if (exits[want] !== facadeId) { exits[want] = facadeId; changed = true; }
    if (changed) store.patch('zones', z.id, { exits });
    continue;
  }
  const exits = { ...z.exits };
  for (const [dir] of links) delete exits[dir];
  store.patch('zones', z.id, { exits });
  sealed.push(`${z.id} (${links.map(([d]) => d).join(', ')})`);
}

// ── 3. the interior map ──────────────────────────────────────────────────────
store.patch('maps', interiorMapId, {
  id: interiorMapId,
  name: `${buildingName} — Interior`,
  parent_zone_id: facadeId,
  entry_zone_id: lobbyId,
});

// ── 4. lobby + template rooms ────────────────────────────────────────────────
const usedDirs = new Set([backDir]);
const rooms = [];
for (const r of (tmpl.rooms || [])) {
  const dir = (BUILD_DIR_OFF[r.dir] && !usedDirs.has(r.dir))
    ? r.dir
    : ['north', 'east', 'west', 'south'].find(d => !usedDirs.has(d));
  if (!dir) break; // out of cardinal slots off the lobby
  usedDirs.add(dir);
  rooms.push({ ...r, dir, id: `zone_bld_${slug}_${r.key}` });
}
const roomIdFor = (key) => (key === 'lobby' ? lobbyId : (rooms.find(r => r.key === key)?.id || null));

const lobbyFlags = { is_building: true, is_interior: true, world_exit_zone: facadeId };
if (isHangar) { lobbyFlags.hangar_interior = true; lobbyFlags.hangar_ramp = facadeId; }
const lobbyExits = { [backDir]: facadeId };
for (const r of rooms) lobbyExits[r.dir] = r.id;

store.patch('zones', lobbyId, {
  id: lobbyId,
  name: tmpl.lobbyName || 'Lobby',
  description: tmpl.lobbyDesc || 'An interior room.',
  exits: lobbyExits,
  ambient_events: [],
  ambient_theme: 'indoors',
  flags: lobbyFlags,
  map_id: interiorMapId,
  grid_x: 0, grid_y: 0, grid_z: 0,
  parent_zone: facadeId,
});

for (const r of rooms) {
  const off = BUILD_DIR_OFF[r.dir] || [0, 0, 0];
  store.patch('zones', r.id, {
    id: r.id,
    name: r.name,
    description: r.desc,
    exits: { [OPPOSITE[r.dir]]: lobbyId },
    ambient_events: [],
    ambient_theme: 'indoors',
    flags: { is_building: true, is_interior: true, world_exit_zone: facadeId },
    map_id: interiorMapId,
    grid_x: off[0], grid_y: off[1], grid_z: 0,
    parent_zone: facadeId,
  });
}

// ── 4b. the front door ───────────────────────────────────────────────────────
// Anchored on the FACADE pointing inward — `exit_dir` = opposite(entrance), pinned to
// the interior entry. That is the shipped convention, measured not assumed: 52 of the
// 56 facade-anchored doors in content/ are exactly this shape, and it is the row
// resolveFacadeTransit looks up as the front door. No door means no lock, no closing
// time, no breaking in — the whole security surface absent (audit DOOR-1).
let doorId = null;
if (!isHangar && !has('no-door')) {
  doorId = `door_basic_${facadeId}_in`;
  store.patch('doors', doorId, {
    id: doorId, zone_id: facadeId, exit_dir: OPPOSITE[entranceDir], target_zone: lobbyId,
    name: null, door_type: 'basic',
    is_open: 0, is_locked: 0, lock_state: null,
    hp: 1000, hp_max: 1000, hololock_difficulty: 5,
    flags: {}, tags: {},
  });
}

// ── 5. thematic furniture + a light in every extra room ──────────────────────
for (const f of (tmpl.furniture || [])) {
  const zid = roomIdFor(f.room);
  if (!zid) continue;
  const fid = `furn_bld_${slug}_${String(f.name || 'x').replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`;
  store.patch('furniture', fid, {
    id: fid, zone_id: zid, name: f.name, description: f.desc || '',
    object_type: f.object_type || 'furniture',
    flags: f.interactions ? { interactions: f.interactions } : {},
  });
}
for (const r of rooms) {
  const fid = `furn_light_${r.id}`;
  if (store.get('furniture', fid)) continue;
  store.patch('furniture', fid, {
    id: fid, zone_id: r.id, name: 'Overhead Light',
    description: 'A recessed ceiling fixture wired to the building panel below.',
    object_type: 'light', light_type: 'overhead',
    power_draw_kw: 0.03, lumen_output: 1200, flags: {},
  });
}

// ── 6. power + lights, through the shipped blueprint ─────────────────────────
// authorUtilityRoom takes `query` as its first parameter, so the file sink drops
// straight in. Its lighting_states writes are accepted and discarded (runtime table,
// recomputed at boot); everything else lands as content.
const util = await authorUtilityRoom(store.sql(), { anchorId: lobbyId });

// ── 7. the inhabitant ────────────────────────────────────────────────────────
let npcId = null;
if (tmpl.npc && !isHangar) {
  const zid = roomIdFor(tmpl.npc.room) || lobbyId;
  npcId = `npc_bld_${slug}_${tmpl.npc.room}`;
  const sex = decideSex(null, tmpl.npc.name, tmpl.npc.description, npcId);
  const flags = { personality: tmpl.npc.personality };
  // Seeded on the id: a re-run must produce the same bytes, or every re-run is a diff.
  const outfit = pickClothingForPersonality(tmpl.npc.personality, sex, npcId);
  if (outfit) flags.clothing_layers = outfit;
  const npcType = npcTypeForPersonality(tmpl.npc.personality) || 'npc';
  store.patch('npcs', npcId, {
    id: npcId, name: tmpl.npc.name, description: tmpl.npc.description,
    // `npcs.zone_id` is excludeColumns (runtime placement) — home_zone is the
    // authored anchor and the engine seeds position from it.
    home_zone: zid,
    faction: null,
    dialogue_tree: {}, vendor_inventory: [],
    wanders: 0, wander_zones: [],
    flags,
    // behaviour_graph left empty on purpose: the default graph is chosen at load
    // from npc_type, and baking a copy of it into content is a second source of
    // truth for behaviour that the VINE editor already owns.
    behaviour_graph: {}, chitchat: [],
    hp: 20, hp_max: 20,
    npc_type: npcType,
    vendor_schedule: npcType === 'unemployed' ? {} : DEFAULT_VENDOR_SCHEDULE,
    home_activities: [], banter: [],
    sex,
  });
}

// ── write ────────────────────────────────────────────────────────────────────
const written = store.flush({ dryRun });
const rel = (p) => p.replace(/\\/g, '/').split('/content/')[1] || p;

console.log(`${dryRun ? 'would write' : 'wrote'} ${written.length} content file${written.length === 1 ? '' : 's'}:`);
for (const p of written) console.log(`  content/${rel(p)}`);
console.log(`\n"${buildingName}" (${buildingType}) at (${toX}, ${toY}${toZ ? `, ${toZ}` : ''})`);
console.log(`  facade    ${facadeId}  marker ${marker}  door → ${entranceDir} onto ${front.n.id}`);
if (sealed.length) console.log(`  sealed    ${sealed.join('; ')}`);
console.log(`  interior  ${lobbyId}${rooms.length ? ` + ${rooms.map(r => r.key).join(', ')}` : ''}`);
if (doorId) console.log(`  door      ${doorId} on ${facadeId} ${OPPOSITE[entranceDir]} → ${lobbyId}`);
if (util) console.log(`  power     ${util.utilityRoomId} (${util.generatorId})`);
if (npcId) console.log(`  npc       ${npcId}`);
if (store.droppedRuntime.length) {
  const counts = store.droppedRuntime.reduce((a, t) => (a[t] = (a[t] || 0) + 1, a), {});
  console.log(`  runtime   dropped ${Object.entries(counts).map(([t, n]) => `${n}× ${t}`).join(', ')} (recomputed at boot)`);
}
if (buildingType === 'power' && regionId) {
  console.log(`\n  note: a region plant for ${regionId} is a live-world operation (installRegionPlant\n        repoints existing buildings) — run it from the dev panel after importing.`);
}
console.log(`\nnext: npm run content:lint && npm run content:import`);
