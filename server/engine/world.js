import { query } from '../models/db.js';
import { neighborZoneIds, primaryExits, allExits, addExit, removeExit } from './exits.js';
import { OPPOSITE, DIR_OFFSET } from './directions.js';
import { titleCaseName } from './text.js';
import { districtFor } from './districts.js';
import { isSanctuary, getZoneRadiation } from './zone-tags.js';
import { hasTag } from './tags.js';
import { registerProtectionProvider } from './protection.js';
import { zoneDanger, enemyThreat, bucketThreat } from './danger.js';
import { resolveTerrain, resolveDefault } from '../../scripts/content/derive.mjs';

// In-memory world state — same as before, DB is source of truth
const world = {
  zones: new Map(),
  players: new Map(),
  enemies: new Map(),
  npcs: new Map(),
  corpses: new Map(),
  spawnTimers: new Map(),
  apartments: new Map(), // zoneId -> apartment row
  doors: new Map(),      // id -> door row
  orgs: new Map(),       // orgId -> org row + { ranks: [...] }
  orgMembers: new Map(), // playerId -> { org_id, rank_id, permissions }  (one corp per player)
  zoneControl: new Map(),// zoneId -> zone_control row (territory: controller + influence grip)
  orgAssets: new Map(),  // zoneId -> [org_assets rows] (corp investment: extractor/turret)
  orgVentures: new Map(),// zoneId -> org_ventures row (Corporate Assets: corp-owned operating businesses)
  maps: new Map(),       // mapId -> maps row (parent_zone_id links an interior to its overworld tile)
  furniture: new Map(),  // id -> furniture row (write funnel below keeps it in sync; DB stays SoT)
  regions: new Map(),    // regionId -> regions row (spatial world-map places; member zones carry flags.region_id)
  transientZones: new Set(), // ids of synthetic (non-DB) zones injected at runtime — see registerTransientZone
  render: new Map(),     // zoneId -> zone_render row (GENERATED presentation; see below)
};

// Last-resort home for an NPC whose current AND home zones were both deleted
// (e.g. by a map conversion): the embassy lobby, the world's stable anchor.
const ORPHAN_NPC_FALLBACK_ZONE = 'zone_residential_lobby';

// Global ambient event pool, keyed by theme.
let globalAmbientPool = {}; // theme -> string[]
// Per-zone: last N ambient event strings shown (to avoid repeats).
const zoneRecentAmbients = new Map(); // zoneId -> string[]
const RECENT_AMBIENT_WINDOW = 5;

// Per-zone: loudness of last loud sound, expires after a few seconds.
// Quieter ambients are suppressed while a loud sound is "in the air".
const zoneInterruptLoudness = new Map(); // zoneId -> { loudness, expiresAt }

// Battlecry type cooldown: if one enemy of a type shouts, suppress others of the same type for 10 s.
const battleCryTypeCooldowns = new Map(); // templateId -> timestamp
// Battlecry zone cooldown: if any enemy in a zone shouts, suppress all zone battle cries for 30 s.
const battleCryZoneCooldowns = new Map(); // zoneId -> timestamp

// Sanctuary zones are combat-protected — published through the generic
// protection substrate so the attack/loot/steal/shove laws never know the
// source (same seam housing forcefields use). This is the enforced PvP law:
// PvP is on everywhere, sanctuary carves out civilization.
registerProtectionProvider((zoneId) => {
  const z = world.zones.get(zoneId);
  if (z && isSanctuary(z)) return { reason: 'sanctuary' };
}, 'engine:sanctuary');

export async function initWorld() {
  await loadZones();
  await applyExitOverrides();
  await loadNpcs();
  await loadSpawnTemplates();
  computeAllZoneDanger();
  await loadApartments();
  await loadGlobalAmbients();
  await loadDoors();
  await loadFurniture();
  await loadOrgs();
  await loadZoneControl();
  await loadOrgAssets();
  await loadOrgVentures();
  await loadMaps();
  await loadRegions();
  await loadZoneRender();
  await loadPlayerCorpses();
  console.log(`✓ World loaded: ${world.zones.size} zones, ${world.npcs.size} NPCs, ${world.apartments.size} apartments, ${world.doors.size} doors, ${world.orgs.size} orgs`);
}

async function loadMaps() {
  const { rows } = await query('SELECT * FROM maps').catch(() => ({ rows: [] }));
  world.maps.clear();
  for (const row of rows) world.maps.set(row.id, row);
}

export function getMap(mapId) { return world.maps.get(mapId) || null; }

// Spatial regions (the World Editor's named world-map places: Coldwater Basin, The
// Reach…). A small, cold table — cached in RAM so runtime readers (e.g. the flight
// target guide) can resolve a member zone's region name without a DB round trip.
// Refreshed on reloadMaps() so a region create/move publish shows up without a reboot.
async function loadRegions() {
  const { rows } = await query('SELECT * FROM regions').catch(() => ({ rows: [] }));
  world.regions.clear();
  for (const row of rows) world.regions.set(row.id, row);
}
// ── Generated presentation (zone_render) ────────────────────────────────────
// Built by content:import's derive pass, never authored. Cached in RAM because
// every minimap frame and every map payload reads it — a per-tile query would be
// the worst kind of hot path. It only changes when a build runs, and the two
// things that run a build (content:import, POST /map/derive) both refresh this.
async function loadZoneRender() {
  const { rows } = await query('SELECT * FROM zone_render').catch(() => ({ rows: [] }));
  world.render.clear();
  for (const row of rows) world.render.set(row.zone_id, row);
  if (!rows.length) {
    console.warn('[world] zone_render is empty — run `npm run map:derive`. Tiles will render with no fill.');
  }
}
export { loadZoneRender };

// The generated presentation for a tile. Renderers read THIS and nothing else:
// falling back to zones.marker here is how a map ends up drawing a marker nobody
// authored (commit 36f1b8f3). Returns null for a transient/synthetic zone, which
// has no row by construction.
export function renderOf(zoneId) { return world.render.get(zoneId) || null; }
export function specOf(zoneId) { return world.render.get(zoneId)?.spec || null; }

export function getRegion(id) { return world.regions.get(id) || null; }
export function getAllRegions() { return [...world.regions.values()]; }

// The region a tile belongs to, for resolveDefault's region rung. Membership is
// flags.region_id (docs/reference/land-taxonomy.md) — outdoor tiles carry it,
// interiors generally don't, and a tile without one simply falls through to the
// global default. Two Map lookups, no query: safe on any path a zone object
// already reached.
export function regionForZone(zone) {
  const id = zone?.flags?.region_id;
  return id ? world.regions.get(id) || null : null;
}

// Maps are loaded at boot; the dev-panel routes that create interior maps
// (add-room, link-interior) call this so a new building becomes enterable
// without a reboot. Region create/move publishes route through here too, so the
// region cache refreshes in lockstep.
export async function reloadMaps() { await loadMaps(); await loadRegions(); await loadZoneRender(); }

// The interior map whose parent tile is this zone (i.e. this zone is a
// building facade). Linear scan — the maps table is tiny.
export function getMapByParentZone(zoneId) {
  for (const m of world.maps.values()) if (m.parent_zone_id === zoneId) return m;
  return null;
}

// A building tile players never stand on: moving onto it auto-forwards into
// its interior map's entry zone (zone redesign Phase 5). OPT-IN via the
// `facade` zone tag — deliberately not inferred from is_building + interior
// map, because every existing building tile in the world is a real street
// zone that HOSTS a building (Tin Lane, Muster Yard, Foundry Cut…); inferring
// would sever the street network. The zone planner stamps `facade` on the
// building tiles it generates; hand-built ones opt in through the Zone Tags
// editor. A facade tag without a linked interior map stays standable.
export function isEnterableFacade(zone) {
  if (!hasTag(zone, 'facade')) return false;
  const m = getMapByParentZone(zone.id);
  return !!(m?.entry_zone_id && world.zones.has(m.entry_zone_id));
}

// Building type → top-down rooftop footprint SVG (client/game/assets/zone-icons/
// bldg_*.svg). Now that a zone is one building, a facade tile with no authored
// flags.icon falls back to the footprint for its building_type, so every building
// reads as itself on the 1:1 map. Synonyms collapse (store/grocery → shop); an
// unrecognised-but-present type gets a plain office block. Gated on the `facade`
// tag so interior tiles (also is_building) never wear a rooftop.
//
// STANDARD: a new building_type needs BOTH a 2-D footprint here AND a 3-D shape in
// BLDG_TYPE_3D (client/game/js/panels/windshield.js) so it reads consistently on the
// map and from the air. Each registry has its own fallback, so an unlisted type still
// renders something rather than nothing.
const BUILDING_TYPE_ICON = {
  residential: 'bldg_residential', apartment: 'bldg_apartment',
  shop: 'bldg_shop', store: 'bldg_shop', grocery: 'bldg_shop',
  bar: 'bldg_bar', club: 'bldg_club', nightclub: 'bldg_club', boutique: 'bldg_shop', police: 'bldg_police',
  corporate_office: 'bldg_office', hotel: 'bldg_hotel', power: 'bldg_power',
  hangar: 'bldg_hangar', studio: 'bldg_studio', clinic: 'bldg_clinic', diner: 'bldg_diner',
  gun_shop: 'bldg_gunshop', casino: 'bldg_casino', fence: 'bldg_fence', chem_supply: 'bldg_chem',
  // The Yards — semi-industrial freight district (docs/proposals/yards.md).
  warehouse: 'bldg_warehouse', container_yard: 'bldg_container', fuel_yard: 'bldg_fuel', cold_storage: 'bldg_cold',
  fabrication: 'bldg_fab', wharf: 'bldg_wharf', freight_office: 'bldg_freightoffice', freight_forwarder: 'bldg_forwarder',
  // The Ascendant Stronghold (docs/proposals/ascendant-stronghold.md) — reuse the nearest existing
  // glyphs so the campus reads on the 2-D map this build; bespoke SVGs are an optional polish pass.
  asc_spire: 'bldg_office', asc_gate: 'bldg_police', asc_clinic: 'bldg_clinic',
  asc_weave: 'bldg_fab', asc_vats: 'bldg_cold', asc_shrine: 'bldg_power',
};
export function buildingIconSvg(zone) {
  if (!zone || !hasTag(zone, 'facade')) return null;
  const bt = (zone.flags?.building_type || '').toLowerCase();
  return BUILDING_TYPE_ICON[bt] || (bt ? 'bldg_office' : null);
}
// The tile's own building type (facade-gated), for the map's labels/icons overlay —
// null for streets, water, interiors and anything that isn't a building facade.
export function buildingTypeOf(zone) {
  if (!zone || !hasTag(zone, 'facade')) return null;
  return (zone.flags?.building_type || '').toLowerCase() || null;
}

// Which side a building's entrance is on, for the map's entrance arrow. This is an
// AUTHORED property (flags.entrance), baked once from the road graph by
// scripts/bake-building-entrances.mjs and hand-corrected where inference can't
// decide — NOT derived at runtime. A door is a property of the building, not a
// function of what's currently painted around it: inferring it from the road graph
// let unrelated terrain painting silently relocate doors (Dave painting a dirt
// track west of Pawn & Pity moved its door off Marrow Street). 'north'|'south'|
// 'east'|'west'|null.
//
// The one legitimately dynamic entrance is the Echelon: her exterior tile sails, so
// the yacht plugin writes flags.entrance as she docks (next to flags.heading).
export function buildingEntranceDir(zone) {
  if (!zone || !hasTag(zone, 'facade')) return null;
  return zone.flags?.entrance || null;
}

// The front door of an enterable facade: the doors row on the facade↔interior seam,
// whichever side it is anchored on. Null when the building has no door.
//
// This exists because a building's front door is NOT on the link a player standing
// outside is about to traverse. A facade is never stood on — stepping onto it forwards
// you through the seam in one move (resolveFacadeTransit) — so from the street the door
// is one hop further in than any near/far-side lookup reaches. Every consumer that
// wants "the front door of that building over there" has to reach through the facade,
// and each one that reimplemented that reached differently:
//
//   • movement.js got it right (cardinal entrances AND legacy in/out),
//   • ai-behaviour.js only ever looked for 'in'/'out', so it missed the 52 buildings
//     whose seam is labelled with a cardinal,
//   • the door verbs (open/close/lock/unlock/hack/knock/attack) never looked at all,
//     which is why `open door` from the street returns null for every building.
//
// One implementation, so the door a player can walk through is the door they can also
// operate. Direction is read from the actual exits rather than assumed: buildings
// reworked to cardinal entrances label the seam e.g. 'west'/'east', legacy ones 'in'.
export function frontDoorOf(facade) {
  if (!isEnterableFacade(facade)) return null;
  const interior = getMapByParentZone(facade.id);
  const entryId = interior?.entry_zone_id;
  const entry = entryId ? world.zones.get(entryId) : null;
  if (!entry) return null;
  const toInteriorDir = allExits(facade).find((e) => e.target === entryId)?.dir;
  const toFacadeDir = allExits(entry).find((e) => e.target === facade.id)?.dir;
  return (toInteriorDir && getDoorForExit(facade.id, toInteriorDir, entryId))
    || (toFacadeDir && getDoorForExit(entryId, toFacadeDir, facade.id))
    || null;
}

// Cardinal directions from an interior room that lead OUT of the building — an exit to
// a zone on a different map (the facade / exterior). The interior-side mirror of
// buildingEntranceDir: drives the interior map's exit arrows the way that one drives
// the overworld map's entrance arrows. Returns null for exterior tiles, facades, and
// interiors whose only way out is non-cardinal (legacy in/out), which the arrow set
// can't point.
const INTERIOR_EXIT_DIRS = new Set(['north', 'south', 'east', 'west']);
export function interiorExitDirs(zone) {
  if (!zone || isEnterableFacade(zone)) return null;
  if (!(zone.flags?.is_interior || zone.flags?.is_apartment || zone.flags?.is_building)) return null;
  const dirs = [];
  for (const [dir, target] of Object.entries(primaryExits(zone))) {
    if (!INTERIOR_EXIT_DIRS.has(dir)) continue;
    const t = world.zones.get(target);
    if (t && (t.map_id || null) !== (zone.map_id || null)) dirs.push(dir);
  }
  return dirs.length ? dirs : null;
}

// Terrain class for the map/minimap surfaces: 'road' | 'water' | 'grass' | null.
// Drives the client's tileable water/grass fill and the grey-asphalt / yellow-markings
// road recolour. Grass = parkland, detected by an authored green surface colour (the
// way parks are painted). Buildings and ordinary street tiles return null.
export function zoneTerrain(zone) {
  // Moved to scripts/content/derive.mjs so the BUILD resolves terrain exactly the
  // way the engine always has — there is one rule, and the generated zone_render
  // rows and any runtime caller cannot disagree about what a tile is standing on.
  // The legacy inferences (flags.water, flags.pier, road icons, a green authored
  // surface = parkland) moved with it, comments and all.
  return resolveTerrain(zone);
}

// The road-connector SVG for a road tile, auto-tiled from which orthogonal neighbors are
// also road terrain — so painting roads next to each other forms straights / turns / T-
// junctions / crossroads with no hand-picked piece (mirrors tools/zone-planner apply.mjs
// roadIcon, but computed live from adjacency). `at(x,y,z)` returns the neighbor zone at a
// grid coord (null when out of the caller's window). Returns a `road_<nesw>` name, `road_x`
// when isolated, or null for a non-grid tile.
// A tile reads as road-for-connectivity if it's paved road OR a graded dirt road — the two
// auto-tile together (a dirt lane meets a paved street at a proper junction), and both draw
// the same road_<nesw> connector piece (dirt_road just recolours it to a packed-dirt track).
export function isRoadTerrain(t) { return t === 'road' || t === 'dirt_road'; }
export function roadConnector(zone, at) {
  if (!zone || zone.grid_x == null || zone.grid_y == null) return null;
  const x = zone.grid_x, y = zone.grid_y, z = zone.grid_z ?? 0;
  const isRoad = (nx, ny) => isRoadTerrain(zoneTerrain(at(nx, ny, z)));
  let s = '';
  if (isRoad(x, y - 1)) s += 'n';
  if (isRoad(x + 1, y)) s += 'e';
  if (isRoad(x, y + 1)) s += 's';
  if (isRoad(x - 1, y)) s += 'w';
  return s ? 'road_' + s : 'road_x';
}

// The named zone-icon SVG for a tile's map payload: an authored `flags.icon` / building
// rooftop wins (so hand-tuned roads are untouched); otherwise a painted `road` terrain
// auto-tiles into the right connector piece. `at` is the caller's coord lookup (see
// roadConnector); omit it to skip road auto-tiling.
export function tileIconSvg(zone, at) {
  const authored = zone.flags?.icon || buildingIconSvg(zone);
  if (authored) return authored;
  if (at && isRoadTerrain(zoneTerrain(zone))) return roadConnector(zone, at);
  return null;
}

// The street tile a facade spills you onto when you leave. The facade is
// non-standable, so exiting has to resolve the real overworld tile behind it:
// the authored entrance side (buildingEntranceDir, from the exit graph) first,
// then any cardinal exit off the facade that leads back to a non-interior tile,
// and finally the planner's world_exit_zone hint. Null ⇒ no usable street tile.
// Shared by movement (the exit hop) and describe (labeling the interior's exit
// with the street it lands on rather than the building you're standing in).
export function facadeStreetTile(facade) {
  const interior = getMapByParentZone(facade.id);
  const dir = buildingEntranceDir(facade);
  if (dir && facade.exits?.[dir]) return facade.exits[dir];
  for (const [d, target] of Object.entries(facade.exits || {})) {
    if (!['north', 'south', 'east', 'west'].includes(d)) continue;
    const t = world.zones.get(target);
    if (t && (!interior || t.map_id !== interior.id)) return target;
  }
  return facade.flags?.world_exit_zone || null;
}

// Where a direct landing (teleport, respawn, .gohome, NPC placement) actually
// puts an actor: enterable facades forward to their interior entry zone;
// everything else lands as-is.
export function resolveLanding(zoneId) {
  const z = world.zones.get(zoneId);
  if (z && isEnterableFacade(z)) return getMapByParentZone(z.id).entry_zone_id;
  return zoneId;
}

export async function loadPlayerCorpses() {
  const now = Date.now();
  const { rows } = await query(
    `SELECT id, zone_id, death_message, expires_at, capacity FROM player_corpses WHERE expires_at > $1`,
    [now]
  ).catch(() => ({ rows: [] }));
  for (const row of rows) {
    const c = { id: row.id, name: row.death_message, zoneId: row.zone_id, expiresAt: Number(row.expires_at), capacity: row.capacity != null ? Number(row.capacity) : null };
    world.corpses.set(c.id, c);
    world.zones.get(c.zoneId)?.corpses.add(c.id);
  }
  if (rows.length) console.log(`✓ Restored ${rows.length} player corpse(s) from DB`);
}

async function loadGlobalAmbients() {
  const { rows } = await query('SELECT * FROM global_ambient_events').catch(() => ({ rows: [] }));
  globalAmbientPool = {};
  for (const row of rows) {
    if (!globalAmbientPool[row.theme]) globalAmbientPool[row.theme] = [];
    globalAmbientPool[row.theme].push(row); // store full row (message, loudness, weight, enabled)
  }
}

export async function reloadGlobalAmbients() {
  await loadGlobalAmbients();
}

// ── Exit overrides ───────────────────────────────────────────────────────────
// zones.exits is authored content — a content re-deploy overwrites it, which
// used to orphan exits wired at play time (generator installs creating utility
// rooms). Play-time wiring lives in zone_exit_overrides and is merged over the
// authored exits here (and in reloadZone), so a re-deploy can never unwire it.

async function applyExitOverrides(onlyZoneId = null) {
  const { rows } = onlyZoneId
    ? await query('SELECT * FROM zone_exit_overrides WHERE zone_id=$1', [onlyZoneId])
    : await query('SELECT * FROM zone_exit_overrides');
  for (const r of rows) {
    const z = world.zones.get(r.zone_id);
    if (!z || !world.zones.has(r.target_zone)) continue; // target gone — stale override, harmless
    z.exits = addExit(z.exits, r.direction, r.target_zone);
  }
}

// Wire an exit at play time: persists the override and updates the live zone.
export async function addExitOverride(zoneId, direction, targetZone, source = null) {
  await query(
    `INSERT INTO zone_exit_overrides (zone_id, direction, target_zone, source)
     VALUES ($1,$2,$3,$4) ON CONFLICT (zone_id, direction, target_zone) DO NOTHING`,
    [zoneId, direction, targetZone, source]
  );
  const z = world.zones.get(zoneId);
  if (z) z.exits = addExit(z.exits, direction, targetZone);
}

// Unwire: deletes the override row and removes the exit from the live zone.
// Also strips a matching AUTHORED exit if one exists (legacy installs wrote
// zones.exits directly) so removal works for pre-override wiring too.
export async function removeExitOverride(zoneId, direction, targetZone) {
  await query(
    'DELETE FROM zone_exit_overrides WHERE zone_id=$1 AND direction=$2 AND target_zone=$3',
    [zoneId, direction, targetZone]
  );
  const z = world.zones.get(zoneId);
  if (z) z.exits = removeExit(z.exits, direction, targetZone);
}

async function loadZones() {
  const { rows } = await query('SELECT * FROM zones');
  for (const zone of rows) {
    world.zones.set(zone.id, {
      ...zone,
      exits: zone.exits || {},
      ambient_events: zone.ambient_events || [],
      flags: zone.flags || {},
      stains: zone.stains || {},
      players: new Set(),
      enemies: new Set(),
      npcs: new Set(),
      corpses: new Set(),
    });
  }
}

async function loadNpcs() {
  const { rows } = await query('SELECT * FROM npcs');
  for (const npc of rows) {
    const live = {
      ...npc,
      dialogue_tree: npc.dialogue_tree || {},
      vendor_inventory: npc.vendor_inventory || [],
      wander_zones: npc.wander_zones || [],
      behaviour_graph: npc.behaviour_graph || {},
      flags: npc.flags || {},
      banter: npc.banter || [],
      _ai: { currentNode: null, waitUntil: null, patrolPath: [], patrolTarget: null, patrolMode: 'walk', patrolIndex: 0, alertCooldown: 0, lastSay: 0, flags: {} },
    };
    world.npcs.set(npc.id, live);
    // Position is RAM-only at runtime (autonomous movement never persists
    // zone_id) — the DB value is either the last deliberate placement
    // (dev-panel move) or null on a freshly-imported NPC. Place there if the
    // zone still exists, else fall back to the authored home_zone so a stale
    // zone_id pointing at a deleted zone can't make the NPC invisible. If BOTH
    // are dead (e.g. a zone deleted by a map conversion), the NPC would land
    // nowhere and vanish — return it to the embassy as a last resort.
    let placeZone = (live.zone_id && world.zones.has(live.zone_id)) ? live.zone_id : live.home_zone;
    if (!placeZone || !world.zones.has(placeZone)) {
      if (world.zones.has(ORPHAN_NPC_FALLBACK_ZONE)) {
        console.warn(`[npc] ${npc.name} [${npc.id}] has no valid zone (zone_id=${npc.zone_id}, home_zone=${live.home_zone}); returning to the embassy.`);
        placeZone = ORPHAN_NPC_FALLBACK_ZONE;
      } else {
        placeZone = null;
      }
    }
    if (placeZone && world.zones.has(placeZone)) {
      live.zone_id = placeZone;
      world.zones.get(placeZone).npcs.add(npc.id);
    }
  }
}

// ── npcs write funnel ────────────────────────────────────────────────────────
// world.npcs is the authoritative live copy; the DB row is its persistence.
// EVERY `UPDATE npcs` in gameplay code goes through updateNpc (DB + Map in one
// call) or, for SQL-side increments inside a transaction, writes with
// `RETURNING` and passes the returned value to syncNpc. Dev-panel routes that
// already Object.assign the live entry are equivalent. Grep the write surface
// before adding a writer that skips this — a bypassed write is invisible to
// every reader on the Map (the furniture/npcs stale-cache bug class).

// Patch the live NPC only (values are plain JS objects, not JSON strings).
export function syncNpc(id, cols) {
  const live = world.npcs.get(id);
  if (live) Object.assign(live, cols);
  return live;
}

// Write the given columns to the DB and patch the live NPC together.
// Object/array values are stringified for JSONB columns but assigned raw.
export async function updateNpc(id, cols) {
  const keys = Object.keys(cols);
  if (!keys.length) return;
  const set = keys.map((k, i) => `${k}=$${i + 1}`).join(',');
  const vals = keys.map(k => {
    const v = cols[k];
    return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
  });
  await query(`UPDATE npcs SET ${set} WHERE id=$${keys.length + 1}`, [...vals, id]);
  syncNpc(id, cols);
}

async function loadSpawnTemplates() {
  const { rows } = await query(`
    SELECT e.*, zs.id as spawn_id, zs.zone_id, zs.max_count, zs.spawn_weight, zs.respawn_seconds
    FROM zone_spawns zs JOIN enemies e ON e.id = zs.enemy_id
  `);
  const now = Date.now();
  for (const t of rows) {
    const zone = world.zones.get(t.zone_id);
    if (zone?.flags?.no_spawn || isSanctuary(zone)) continue;
    if (zone) {
      const count = [...zone.enemies].filter(eid => world.enemies.get(eid)?.templateId === t.id).length;
      for (let i = count; i < t.max_count; i++) spawnEnemySync(t, t.zone_id);
    }
    world.spawnTimers.set(t.spawn_id, { ...t, nextSpawn: now + t.respawn_seconds * 1000 });
  }
}

// Refresh (or insert) one spawn template in the live cache straight from the
// DB, keyed exactly as loadSpawnTemplates does (zs.id → { ...enemy, spawn_id,
// zone_id, counts, nextSpawn }). The dev-panel spawn routes call this after a
// mutation so tickSpawns can iterate world.spawnTimers instead of re-querying
// the zone_spawns⋈enemies join every 10s. Preserves an existing timer's
// nextSpawn so an edit doesn't reset the respawn clock.
export async function reloadSpawn(spawnId) {
  const prev = world.spawnTimers.get(spawnId);
  const { rows } = await query(`
    SELECT e.*, zs.id as spawn_id, zs.zone_id, zs.max_count, zs.spawn_weight, zs.respawn_seconds
    FROM zone_spawns zs JOIN enemies e ON e.id = zs.enemy_id WHERE zs.id = $1
  `, [spawnId]);
  const t = rows[0];
  if (!t) {
    world.spawnTimers.delete(spawnId);
    if (prev?.zone_id) computeZoneDanger(prev.zone_id);
    return;
  }
  world.spawnTimers.set(spawnId, { ...t, nextSpawn: prev?.nextSpawn ?? Date.now() });
  computeZoneDanger(t.zone_id);
  // If the spawn moved zones, the old zone's inference changes too.
  if (prev?.zone_id && prev.zone_id !== t.zone_id) computeZoneDanger(prev.zone_id);
}

export function removeSpawn(spawnId) {
  const prev = world.spawnTimers.get(spawnId);
  world.spawnTimers.delete(spawnId);
  if (prev?.zone_id) computeZoneDanger(prev.zone_id);
}

// Inferred danger: max threat among the zone's spawn templates, bucketed.
// Cached on the world zone object; zoneDanger() (danger.js) reads the cache
// under its tag-override/sanctuary precedence. Recomputed at boot (initWorld)
// and by the reloadSpawn/removeSpawn hooks above — never per-tick.
export function computeZoneDanger(zoneId) {
  const zone = world.zones.get(zoneId);
  if (!zone) return;
  let maxThreat = 0, hasSpawn = false;
  for (const t of world.spawnTimers.values()) {
    if (t.zone_id !== zoneId) continue;
    hasSpawn = true;
    maxThreat = Math.max(maxThreat, enemyThreat(t));
  }
  zone._dangerInferred = hasSpawn ? bucketThreat(maxThreat) : 'safe';
}

function computeAllZoneDanger() {
  for (const zoneId of world.zones.keys()) computeZoneDanger(zoneId);
}

async function loadApartments() {
  const { rows } = await query('SELECT * FROM apartments');
  for (const apt of rows) {
    world.apartments.set(apt.zone_id, apt);
  }
}

async function loadDoors() {
  const { rows } = await query('SELECT * FROM doors').catch(() => ({ rows: [] }));
  world.doors.clear();
  for (const door of rows) {
    const tags = (door.tags && !Array.isArray(door.tags)) ? door.tags : {};
    const lockCount = Object.keys(tags).filter(k => k.startsWith('lock:')).length;
    if (lockCount > 1) console.warn(`[doors] ${door.id} has ${lockCount} lock tags — using first`);
    world.doors.set(door.id, { ...door, flags: door.flags || {}, tags, is_open: door.is_open ?? 0 });
  }
}

export function getDoorById(id) { return world.doors.get(id) || null; }
export function getZoneDoors(zoneId) { return [...world.doors.values()].filter(d => d.zone_id === zoneId); }
export function getDoorForExit(zoneId, exitDir, targetId = null) {
  const matches = [...world.doors.values()].filter(d => d.zone_id === zoneId && d.exit_dir === exitDir);
  if (!matches.length) return null;
  if (targetId) {
    // Prefer a door pinned to this specific exit; else an unpinned (legacy) door.
    return matches.find(d => d.target_zone === targetId) || matches.find(d => d.target_zone == null) || null;
  }
  return matches[0];
}
export function setDoorCache(id, door) { world.doors.set(id, door); }
export function deleteDoorCache(id) { world.doors.delete(id); }

// ─── Furniture ───────────────────────────────────────────────────────────────
// world.furniture mirrors the furniture table (id -> row) so describeZone's
// per-look/per-move read never hits the DB. DB stays source of truth: EVERY
// runtime writer goes through the funnel below, which writes the DB and then
// re-caches whatever Postgres says it actually touched (via RETURNING). Bulk
// writers that can't collapse to one row (the environment.js light sweeps) hand
// their SQL to updateFurnitureWhere / deleteFurnitureWhere rather than mirroring
// the predicate by hand. Direct `query('... furniture ...')` writes anywhere
// else are a bug — the cache would go visibly stale in room descriptions.

// zoneId -> Set<furnitureId>. describeZone asks for one zone's rows on every
// look and move, so that read must not scan the whole table.
const furnitureByZone = new Map();

function _cacheFurnitureRow(row) {
  const prev = world.furniture.get(row.id);
  if (prev && prev.zone_id && prev.zone_id !== row.zone_id) {
    furnitureByZone.get(prev.zone_id)?.delete(row.id);
  }
  if (row.zone_id) {
    let ids = furnitureByZone.get(row.zone_id);
    if (!ids) furnitureByZone.set(row.zone_id, (ids = new Set()));
    ids.add(row.id);
  }
  world.furniture.set(row.id, { ...row, flags: row.flags || {} });
}

function _uncacheFurniture(id) {
  const row = world.furniture.get(id);
  if (row?.zone_id) furnitureByZone.get(row.zone_id)?.delete(id);
  world.furniture.delete(id);
}

async function loadFurniture() {
  const { rows } = await query('SELECT * FROM furniture').catch(() => ({ rows: [] }));
  world.furniture.clear();
  furnitureByZone.clear();
  for (const row of rows) _cacheFurnitureRow(row);
}

export function getFurnitureById(id) { return world.furniture.get(id) || null; }
export function getZoneFurniture(zoneId) {
  const ids = furnitureByZone.get(zoneId);
  if (!ids) return [];
  const out = [];
  for (const id of ids) { const f = world.furniture.get(id); if (f) out.push(f); }
  return out;
}

// INSERT via a column map. Passes JSON columns (flags) as the site already
// stringifies them; the cache takes the RETURNING row so it holds parsed jsonb
// exactly as a SELECT would. `conflictSql` carries a site's ON CONFLICT clause;
// a DO NOTHING conflict returns no row and correctly leaves the cache alone.
export async function insertFurniture(cols, conflictSql = '') {
  const keys = Object.keys(cols);
  const { rows } = await query(
    `INSERT INTO furniture (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) ${conflictSql} RETURNING *`,
    keys.map(k => cols[k])
  );
  if (rows[0]) _cacheFurnitureRow(rows[0]);
  return rows[0] || null;
}

// Single-row UPDATE via a column map — the standard write path.
export async function updateFurniture(id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return getFurnitureById(id);
  const { rows } = await query(
    `UPDATE furniture SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')} WHERE id=$1 RETURNING *`,
    [id, ...keys.map(k => fields[k])]
  );
  if (rows[0]) _cacheFurnitureRow(rows[0]);
  return rows[0] || null;
}

export async function deleteFurniture(id) {
  await query('DELETE FROM furniture WHERE id=$1', [id]);
  _uncacheFurniture(id);
}

// Bulk writers keep their own SQL (ANY() arrays, COALESCE transforms) but route
// it through here: the helper appends RETURNING and re-caches exactly the rows
// Postgres reports it touched. The predicate — and any SET transform — therefore
// lives EXACTLY ONCE, in the SQL. (These replaced hand-written JS mirrors of the
// same WHERE clause; any drift between the two silently staled the cache, which
// is the bug class the funnel exists to prevent.) Pass SQL WITHOUT a RETURNING
// clause; params as usual.
export async function updateFurnitureWhere(sql, params = []) {
  const { rows } = await query(`${sql} RETURNING *`, params);
  for (const row of rows) _cacheFurnitureRow(row);
  return rows;
}
export async function deleteFurnitureWhere(sql, params = []) {
  const { rows } = await query(`${sql} RETURNING id`, params);
  for (const row of rows) _uncacheFurniture(row.id);
  return rows;
}

// Full re-sync of one zone's rows from the DB — the escape hatch for writers
// whose SQL transforms rows in ways not worth expressing through the helpers.
export async function refreshZoneFurniture(zoneId) {
  const { rows } = await query('SELECT * FROM furniture WHERE zone_id=$1', [zoneId]);
  for (const f of getZoneFurniture(zoneId)) _uncacheFurniture(f.id);
  for (const row of rows) _cacheFurnitureRow(row);
  return rows;
}

export function getApartment(zoneId) { return world.apartments.get(zoneId) || null; }
export function setApartmentCache(zoneId, apt) { world.apartments.set(zoneId, apt); }

// ─── Orgs (corps) ──────────────────────────────────────────────────────────
// world.orgs holds each org row plus its ranks[]; world.orgMembers maps a
// player to their single membership with the rank's permission bitmask resolved
// for O(1) gate checks. DB stays source of truth; every mutating corp command
// re-syncs via reloadOrg()/removeOrgFromCache().

async function loadOrgs() {
  world.orgs.clear();
  world.orgMembers.clear();
  const { rows: orgs } = await query('SELECT * FROM orgs');
  for (const o of orgs) world.orgs.set(o.id, { ...o, ranks: [] });
  const { rows: ranks } = await query('SELECT * FROM org_ranks');
  const rankById = new Map();
  for (const r of ranks) {
    rankById.set(r.id, r);
    world.orgs.get(r.org_id)?.ranks.push(r);
  }
  const { rows: members } = await query('SELECT * FROM org_members');
  for (const m of members) {
    world.orgMembers.set(m.player_id, {
      org_id: m.org_id, rank_id: m.rank_id, permissions: rankById.get(m.rank_id)?.permissions || 0,
    });
  }
}

// Re-read one org (row + ranks + members) into the cache after a mutation.
export async function reloadOrg(orgId) {
  const { rows: orgs } = await query('SELECT * FROM orgs WHERE id=$1', [orgId]);
  if (!orgs.length) { removeOrgFromCache(orgId); return null; }
  const { rows: ranks } = await query('SELECT * FROM org_ranks WHERE org_id=$1', [orgId]);
  const org = { ...orgs[0], ranks };
  world.orgs.set(orgId, org);
  const rankById = new Map(ranks.map(r => [r.id, r]));
  for (const [pid, m] of world.orgMembers) if (m.org_id === orgId) world.orgMembers.delete(pid);
  const { rows: members } = await query('SELECT * FROM org_members WHERE org_id=$1', [orgId]);
  for (const m of members) {
    world.orgMembers.set(m.player_id, {
      org_id: orgId, rank_id: m.rank_id, permissions: rankById.get(m.rank_id)?.permissions || 0,
    });
  }
  return org;
}

export function removeOrgFromCache(orgId) {
  world.orgs.delete(orgId);
  for (const [pid, m] of world.orgMembers) if (m.org_id === orgId) world.orgMembers.delete(pid);
}

export function getOrg(orgId) { return world.orgs.get(orgId) || null; }
export function getPlayerMembership(playerId) { return world.orgMembers.get(playerId) || null; }
export function getOrgByName(name) {
  const wanted = (name || '').trim().toLowerCase();
  if (!wanted) return null;
  for (const o of world.orgs.values()) if ((o.name || '').toLowerCase() === wanted) return o;
  return null;
}

// ─── Territory control ───────────────────────────────────────────────────────
// world.zoneControl mirrors the zone_control table (controller + influence grip).
// DB stays source of truth; corp commands write DB then setZoneControlCache().
async function loadZoneControl() {
  world.zoneControl.clear();
  const { rows } = await query('SELECT * FROM zone_control').catch(() => ({ rows: [] }));
  for (const r of rows) world.zoneControl.set(r.zone_id, r);
}
export function getZoneControl(zoneId) { return world.zoneControl.get(zoneId) || null; }
export function setZoneControlCache(zoneId, row) { if (row) world.zoneControl.set(zoneId, row); else world.zoneControl.delete(zoneId); }
export function getAllZoneControl() { return [...world.zoneControl.values()]; }
export function getOrgZones(orgId) { return [...world.zoneControl.values()].filter(z => z.org_id === orgId); }

// ─── Corp assets (Phase 2 investment) ────────────────────────────────────────
// world.orgAssets: zoneId -> [org_assets rows]. Corp commands write DB then
// reloadZoneAssets(zoneId) to re-sync a single zone's assets.
async function loadOrgAssets() {
  world.orgAssets.clear();
  const { rows } = await query('SELECT * FROM org_assets').catch(() => ({ rows: [] }));
  for (const r of rows) {
    if (!world.orgAssets.has(r.zone_id)) world.orgAssets.set(r.zone_id, []);
    world.orgAssets.get(r.zone_id).push(r);
  }
}
export async function reloadZoneAssets(zoneId) {
  const { rows } = await query('SELECT * FROM org_assets WHERE zone_id=$1', [zoneId]);
  if (rows.length) world.orgAssets.set(zoneId, rows); else world.orgAssets.delete(zoneId);
  return rows;
}
export function getZoneAssets(zoneId) { return world.orgAssets.get(zoneId) || []; }
export function getOrgAssets(orgId) { return [...world.orgAssets.values()].flat().filter(a => a.org_id === orgId); }

// ─── Corp ventures (Corporate Assets) ────────────────────────────────────────
// world.orgVentures: zoneId -> org_ventures row (one owned operating business per
// interior zone). Corp commands write DB then reloadVenture(zoneId). DB stays SoT.
async function loadOrgVentures() {
  world.orgVentures.clear();
  const { rows } = await query('SELECT * FROM org_ventures').catch(() => ({ rows: [] }));
  for (const r of rows) world.orgVentures.set(r.zone_id, r);
}
export async function reloadVenture(zoneId) {
  const { rows } = await query('SELECT * FROM org_ventures WHERE zone_id=$1', [zoneId]);
  if (rows.length) world.orgVentures.set(zoneId, rows[0]); else world.orgVentures.delete(zoneId);
  return rows[0] || null;
}
export function getVenture(zoneId) { return world.orgVentures.get(zoneId) || null; }
export function getAllVentures() { return [...world.orgVentures.values()]; }
export function getOrgVentures(orgId) { return [...world.orgVentures.values()].filter(v => v.org_id === orgId); }
export function getVentureByVendor(npcId) { return [...world.orgVentures.values()].find(v => v.vendor_id === npcId) || null; }
export function removeVentureFromCache(zoneId) { world.orgVentures.delete(zoneId); }

export function getZone(id) { return world.zones.get(id) || null; }

// ── Transient zones (docs/systems-overland-void-travel.md) ───────────────────
// Synthetic zones that live in the world store WITHOUT a DB row. The void-
// crossing rooms are generated in memory and injected here so that movement,
// describe, and the per-player minimap treat them like any other zone (they all
// read world.zones). They are the ONE class of zone with no DB backing, so the
// never-persist guarantee is load-bearing:
//   • Nothing writes world.zones back to the DB — loadZones only reads, and the
//     content export queries the DB directly, never the live Map. So a transient
//     zone is inherently invisible to persistence/export.
//   • getAllZones() (the bulk scan corps/gps/work/etc. run) EXCLUDES them via the
//     transientZones marker set, so no wholesale reader treats a void room as a
//     real tile.
//   • Callers give void rooms a non-`map_world` map_id, so the flag/map-filtered
//     direct `world.zones.values()` iterators skip them naturally.
// Mirrors the setDoorCache / setZoneControlCache cache-setter idiom. Caller owns
// lifecycle: move players out before removing.
export function registerTransientZone(zone) {
  if (!zone?.id) throw new Error('registerTransientZone: zone.id required');
  const existing = world.zones.get(zone.id);
  world.zones.set(zone.id, {
    ...zone,
    // describeZone hard-requires a string description; a generated room that
    // forgets one would crash the arrival render. Default it like the rest.
    description: zone.description ?? '',
    exits: zone.exits || {},
    ambient_events: zone.ambient_events || [],
    flags: zone.flags || {},
    stains: zone.stains || {},
    // Preserve occupant sets across a re-register (relog re-derivation regenerates
    // the same room id) so a player already placed here isn't orphaned.
    players: existing?.players || new Set(),
    enemies: existing?.enemies || new Set(),
    npcs:    existing?.npcs    || new Set(),
    corpses: existing?.corpses || new Set(),
  });
  world.transientZones.add(zone.id);
  return world.zones.get(zone.id);
}

// Only ever removes a zone the transient registry owns — guards against a caller
// accidentally evicting a real DB-backed zone from the live world.
export function removeTransientZone(id) {
  if (!world.transientZones.has(id)) return false;
  world.zones.delete(id);
  world.transientZones.delete(id);
  return true;
}

export function isTransientZone(id) { return world.transientZones.has(id); }

// Build a small graph snapshot for the minimap: current zone + everything
// reachable within `depth` hops, with enough info to render an ASCII grid.
// Per-viewer minimap node filters. A plugin registers fn(zone, viewer) → boolean;
// a node is dropped if any filter returns false. Sync by design (getMinimapData is
// sync and hot) — a plugin backs its predicate with an in-memory cache, not a DB
// hit. This is how the yacht hides itself from players not on its invite list
// without the engine importing the plugin.
const minimapNodeFilters = [];
export function registerMinimapNodeFilter(fn) { if (typeof fn === 'function') minimapNodeFilters.push(fn); }

// Filter a list of zone objects for what `viewer` may see on any map surface, and
// resolve the yacht-over-water overlap (a visible yacht tile hides the water tile at
// the same cell; when the yacht is filtered out, the water underneath shows through).
// Shared by getMinimapData (sidebar) and the bigmap builder so both hide the Echelon
// from non-invitees identically.
export function applyMinimapVisibility(zones, viewer = null) {
  let vis = zones;
  if (minimapNodeFilters.length) {
    vis = zones.filter((z) => minimapNodeFilters.every((f) => { try { return f(z, viewer); } catch { return true; } }));
  }
  const yachtCells = new Set();
  for (const z of vis) if (z?.flags?.yacht) yachtCells.add(`${z.grid_x},${z.grid_y},${z.grid_z ?? 0}`);
  if (yachtCells.size) {
    vis = vis.filter((z) => z?.flags?.yacht || !yachtCells.has(`${z.grid_x},${z.grid_y},${z.grid_z ?? 0}`));
  }
  return vis;
}

export function getMinimapData(centerZoneId, depth = 8, viewer = null) {
  const centerZone = world.zones.get(centerZoneId);
  const centerMapId = centerZone?.map_id || null;

  const visited = new Map(); // zoneId -> distance
  const queue = [{ id: centerZoneId, distance: 0 }];
  visited.set(centerZoneId, 0);

  while (queue.length) {
    const { id, distance } = queue.shift();
    if (distance >= depth) continue;
    const zone = world.zones.get(id);
    if (!zone) continue;
    for (const neighborId of neighborZoneIds(zone)) {
      if (visited.has(neighborId)) continue;
      // Stay within the same map — prevents exterior zones bleeding into
      // an interior minimap and vice versa.
      if (centerMapId) {
        const neighbor = world.zones.get(neighborId);
        if (!neighbor || neighbor.map_id !== centerMapId) continue;
      }
      visited.set(neighborId, distance + 1);
      queue.push({ id: neighborId, distance: distance + 1 });
    }
  }

  // Beyond the reachable set, also surface the nearby-but-unreachable tiles that
  // fall inside the client's 9×9 render window (Chebyshev radius 4, same map/floor).
  // They render dimmed so it's clear there are tiles there you just can't reach in
  // `depth` hops. Only possible when the map is grid-placed. Keep WIN = the
  // client's R in minimap.js.
  const WIN = 4;
  const ids = new Set(visited.keys());
  if (centerMapId && centerZone.grid_x != null && centerZone.grid_y != null) {
    const cx = centerZone.grid_x, cy = centerZone.grid_y, cz = centerZone.grid_z ?? 0;
    for (const [id, zone] of world.zones) {
      if (ids.has(id)) continue;
      if (zone.map_id !== centerMapId || (zone.grid_z ?? 0) !== cz) continue;
      if (zone.grid_x == null || zone.grid_y == null) continue;
      if (Math.abs(zone.grid_x - cx) <= WIN && Math.abs(zone.grid_y - cy) <= WIN) ids.add(id);
    }
  }

  // Resolve per-viewer visibility (hides the yacht from non-invitees) before building
  // node payloads.
  const zoneObjs = applyMinimapVisibility([...ids].map((id) => world.zones.get(id)).filter(Boolean), viewer);

  // Coord index over this map/floor so road tiles can auto-tile their connector from
  // neighbors (roadConnector). One pass, then O(1) lookups per node.
  const roadIndex = new Map();
  if (centerMapId) for (const z of world.zones.values())
    if (z.map_id === centerMapId && z.grid_x != null && z.grid_y != null)
      roadIndex.set(`${z.grid_x},${z.grid_y},${z.grid_z ?? 0}`, z);
  const roadAt = (x, y, z) => roadIndex.get(`${x},${y},${z}`) || null;

  const nodes = [];
  for (const zone of zoneObjs) {
    // Building name(s) reachable from this tile — for the hover tooltip (same rule
    // as the full map's buildingsAt: an exit into an is_building zone).
    const buildings = [];
    for (const { target } of allExits(zone)) {
      const t = world.zones.get(target);
      if (t?.flags?.is_building) buildings.push(t.flags.building_name || t.name);
    }
    nodes.push({
      id: zone.id,
      name: zone.name,
      buildings,
      danger: zoneDanger(zone),
      sanctuary: isSanctuary(zone),
      radiation: getZoneRadiation(zone),
      // Pass-through building tile: rendered as an enterable marker, not a room.
      enterable: isEnterableFacade(zone),
      building_name: zone.flags?.building_name || null,
      exits: primaryExits(zone),
      map_id: zone.map_id || null,
      grid_x: zone.grid_x, grid_y: zone.grid_y, grid_z: zone.grid_z,
      // spec is the GENERATED presentation (zone_render.spec) and the only thing a
      // renderer should colour a tile from. marker/color/bg_color stay in the
      // payload for the tooltip and for a transient zone, which has no derived row.
      spec: specOf(zone.id),
      marker: zone.marker || null, color: zone.color || null, bg_color: zone.bg_color || null,
      icon_svg: tileIconSvg(zone, roadAt), // named SVG in client/game/assets/zone-icons/ (authored icon / rooftop, or an auto-tiled road connector)
      building_type: buildingTypeOf(zone), // facade tile's type — drives the sidebar/full-map labels/icons overlay
      entrance: buildingEntranceDir(zone), // which edge the door faces — drives the map entrance arrow
      exit_dirs: interiorExitDirs(zone), // interior room's ways out — drives the interior map's exit arrows
      terrain: zoneTerrain(zone), // 'road' | 'water' | 'grass' | null — tileable terrain styling
      district: (() => { const d = districtFor(zone); return { key: d.key, name: d.name, color: d.color }; })(),
      artery: Array.isArray(zone.flags?.artery) ? zone.flags.artery : (zone.flags?.artery ? [zone.flags.artery] : null),
      void_crossing: zone.flags?.void_crossing ? true : null, // a transient waste-crossing room → client renders the "crossing" trail view
      void_detour: zone.flags?.void_detour ? true : null,     // a risk-for-loot dead-end gamble off the trail
      void_hard: zone.flags?.void_hard ? true : null,         // a seeded hard node — rougher ambush lives here
      curtain: zone.flags?.curtain ? true : null, // the Architect's perimeter wall edge
      perimeter_gate: zone.flags?.perimeter_gate ? true : null, // the one break in the Curtain
      glacis: zone.flags?.glacis ? true : null, // turret killing-ground outside the gate
      is_current: zone.id === centerZoneId,
      reachable: visited.has(zone.id),
      player_count: zone.players.size,
    });
  }
  return nodes;
}

export function getAllZones() {
  // Transient (synthetic, non-DB) zones are excluded from the bulk scan — the
  // void-crossing rooms must never be seen as real tiles by corps/gps/work/etc.
  // The per-player minimap uses getMinimapData (exit-BFS from the center), not
  // this, so a player standing in a void room still sees it.
  return [...world.zones.values()].filter(z => !world.transientZones.has(z.id)).map(z => ({
    id: z.id, name: z.name, description: z.description,
    sanctuary: isSanctuary(z), radiation: getZoneRadiation(z), danger: zoneDanger(z),
    exits: z.exits, ambient_events: z.ambient_events, ambient_theme: z.ambient_theme, flags: z.flags,
    map_id: z.map_id, grid_x: z.grid_x, grid_y: z.grid_y, grid_z: z.grid_z,
    marker: z.marker, color: z.color, bg_color: z.bg_color, spec: specOf(z.id),
    player_count: z.players.size, enemy_count: z.enemies.size,
  }));
}

export function getZoneEnemies(zoneId) {
  const z = world.zones.get(zoneId);
  if (!z) return [];
  return [...z.enemies].map(id => world.enemies.get(id)).filter(Boolean);
}

export function getZoneNpcs(zoneId) {
  const z = world.zones.get(zoneId);
  if (!z) return [];
  return [...z.npcs].map(id => world.npcs.get(id)).filter(Boolean);
}

// Live NPCs carrying a given flag key — presence-independent (used e.g. by the
// charter system to find a field's assigned pilot even when they're off-site).
export function getNpcsByFlag(flagKey) {
  return [...world.npcs.values()].filter(n => n?.flags && n.flags[flagKey]);
}

// Relocate an NPC between zones in-memory (mirrors the ai-behaviour move seam).
export function moveNpcToZone(npcId, toZoneId) {
  const npc = world.npcs.get(npcId);
  if (!npc || npc.zone_id === toZoneId) return false;
  if (npc.zone_id) world.zones.get(npc.zone_id)?.npcs.delete(npcId);
  npc.zone_id = toZoneId;
  world.zones.get(toZoneId)?.npcs.add(npcId);
  return true;
}

export function getZoneCorpses(zoneId) {
  const z = world.zones.get(zoneId);
  if (!z) return [];
  return [...z.corpses].map(id => world.corpses.get(id)).filter(Boolean);
}

export function getZonePlayers(zoneId) {
  const z = world.zones.get(zoneId);
  if (!z) return [];
  return [...z.players].map(id => world.players.get(id)).filter(Boolean);
}

export function addPlayerToZone(pid, zid) { world.zones.get(zid)?.players.add(pid); }
export function removePlayerFromZone(pid, zid) { world.zones.get(zid)?.players.delete(pid); }
export function setLivePlayer(pid, data) { world.players.set(pid, data); }
export function getLivePlayer(pid) { return world.players.get(pid) || null; }
export function getAllLivePlayers() { return [...world.players.values()]; }
export function removeLivePlayer(pid) { world.players.delete(pid); }

// Is this player object STILL the live session, by identity — not just by id?
// A reconnect builds a brand-new live player object and replaces the old one, so
// any deferred callback (a setTimeout captured mid-drink, a queued write) can be
// holding a discarded object whose stats are frozen at the moment the old socket
// died. Persisting from it silently rolls the new session back. Anything that
// mutates or writes a player from a timer must gate on this first.
export function isLivePlayer(player) {
  return !!player && world.players.get(player.id) === player;
}

// True while at least one session is connected. O(1) — world.players is filled
// at login (setLivePlayer) and cleared at logout (removeLivePlayer). The shared
// idle gate for schedule-driven ticks that only matter when players are online.
export function hasActivePlayers() { return world.players.size > 0; }

export function getEnemyInstance(id) { return world.enemies.get(id) || null; }
export function removeEnemyInstance(id) {
  const e = world.enemies.get(id);
  if (e) world.zones.get(e.zoneId)?.enemies.delete(id);
  world.enemies.delete(id);
}

const SPAWN_MESSAGES = [
  n => `A ${n} drags itself out of the shadows.`,
  n => `A ${n} materializes from nowhere you can pinpoint.`,
  n => `Something wet hits the floor. A ${n} has arrived.`,
  n => `A ${n} shoulders through like it owns the place.`,
  n => `A ${n} drops from the ceiling with a hollow thud.`,
  n => `A ${n} rounds the corner, already looking for trouble.`,
  n => `You hear it before you see it. A ${n} emerges.`,
  n => `A ${n} crawls up through a floor grate and shakes itself off.`,
  n => `A ${n} squeezes through a gap that shouldn't be big enough.`,
  n => `A ${n} steps into the light, blinking slowly.`,
  n => `A ${n} pushes through, trailing something dark.`,
  n => `A ${n} appears at the edge of the room, sniffing.`,
  n => `There's a sound like tearing plastic. A ${n} is here.`,
  n => `A ${n} skitters in from somewhere you'd rather not think about.`,
  n => `A ${n} staggers in looking hungrier than you'd like.`,
  n => `The lights flicker. When they come back, a ${n} is standing there.`,
  n => `A ${n} unfolds itself from the corner.`,
  n => `A faint chemical smell precedes the ${n}.`,
  n => `You catch movement in your peripheral. A ${n}.`,
  n => `A ${n} peels away from the wall.`,
];

function pickSpawnMessage(name) {
  return SPAWN_MESSAGES[Math.floor(Math.random() * SPAWN_MESSAGES.length)](name);
}

export function spawnEnemySync(template, zoneId) {
  const id = `ei_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  const flags = template.flags || {};
  const instance = {
    instanceId: id, templateId: template.id,
    name: titleCaseName(template.name), description: template.description,
    hp: template.hp_max, hp_max: template.hp_max,
    hit: template.hit ?? 1, dodge: template.dodge ?? 1,
    weapon: Array.isArray(template.weapon) ? template.weapon : [],
    body_parts: Array.isArray(template.body_parts) ? template.body_parts : [],
    loot_table: template.loot_table || [],
    butcher_table: Array.isArray(template.butcher_table) ? template.butcher_table : [],
    butcher_difficulty: template.butcher_difficulty ?? 5,
    behavior: template.behavior, faction: template.faction,
    death_message: template.death_message, flags,
    behaviour_graph: template.behaviour_graph || {},
    zoneId, targetId: null, lastAttack: 0, statuses: [],
    // Lore-appropriate enemies (skittish scavengers, slow lumbering mutants)
    // hesitate before their FIRST attack after aggroing — set the moment they
    // acquire a target, checked separately from the normal attack-interval pace.
    aggroedAt: null,
    _ai: { currentNode: null, waitUntil: null, patrolPath: [], patrolTarget: null, patrolMode: 'walk', patrolIndex: 0, alertCooldown: 0, lastSay: 0, flags: {} },
  };
  world.enemies.set(id, instance);
  world.zones.get(zoneId)?.enemies.add(id);
  return instance;
}

export async function tickSpawns(broadcast) {
  // Skip entirely while idle (Phase 7b). nextSpawn timers are wall-clock based,
  // so due respawns simply fire on the next pass once a player reconnects — the
  // existing timer design catches up for free, no accumulation math needed.
  if (!hasActivePlayers()) return;
  const now = Date.now();
  // Iterate the in-memory cache — zone_spawns/enemies are static content the
  // dev-panel routes keep in sync via reloadSpawn/removeSpawn, so there's no
  // need to re-query the join every 10s. Each cached entry carries both the
  // enemy template and its nextSpawn clock.
  for (const t of world.spawnTimers.values()) {
    if (now < t.nextSpawn) continue;
    const zone = world.zones.get(t.zone_id);
    if (!zone) continue;
    // Sanctuary carve-out: no hostile spawns (checked per-tick, not just at
    // load, so tagging a zone takes effect without a reboot).
    if (zone.flags?.no_spawn || isSanctuary(zone)) { t.nextSpawn = now + t.respawn_seconds * 1000; continue; }
    const count = [...zone.enemies].filter(eid => world.enemies.get(eid)?.templateId === t.id).length;
    if (count < t.max_count && Math.random() * 100 < t.spawn_weight) {
      const instance = spawnEnemySync(t, t.zone_id);
      if (broadcast && zone.players.size > 0) {
        broadcast(t.zone_id, { type: 'zone_event', message: pickSpawnMessage(instance.name), refresh: true });
      }
    }
    t.nextSpawn = now + t.respawn_seconds * 1000;
  }
}

export function createCorpse(c) {
  world.corpses.set(c.id, c);
  world.zones.get(c.zoneId)?.corpses.add(c.id);
}

export function getCorpse(id) { return world.corpses.get(id) || null; }

// Relocate a corpse to another zone (used by shove/drag). Loot rows live in
// player_inventory keyed by the corpse id and carry no zone, so only the zone
// membership and the persisted zone_id move.
export async function moveCorpse(id, newZoneId) {
  const c = world.corpses.get(id);
  if (!c) return;
  world.zones.get(c.zoneId)?.corpses.delete(id);
  c.zoneId = newZoneId;
  world.zones.get(newZoneId)?.corpses.add(id);
  await query('UPDATE player_corpses SET zone_id=$1 WHERE id=$2', [newZoneId, id]).catch(() => {});
}

// Remove a corpse from the world and delete any loot rows owned by it so the
// DB doesn't accumulate orphaned _corpse loot. Called on loot/butcher and expiry.
export async function removeCorpse(id) {
  const c = world.corpses.get(id);
  if (!c) return;
  world.zones.get(c.zoneId)?.corpses.delete(id);
  world.corpses.delete(id);
  await query('DELETE FROM player_inventory WHERE player_id=$1', [id]);
  await query('DELETE FROM player_corpses WHERE id=$1', [id]).catch(() => {});
}

// Returns { message, loudness } or null.
export function getRandomAmbient(zoneId) {
  const z = world.zones.get(zoneId);
  const recent = zoneRecentAmbients.get(zoneId) || [];

  // Try zone-specific events first (no weight — they're hand-authored per zone).
  const zoneEvents = z?.ambient_events || [];
  const freshZone = zoneEvents.filter(e => !recent.includes(e));
  if (freshZone.length) {
    const pick = freshZone[Math.floor(Math.random() * freshZone.length)];
    _trackAmbient(zoneId, pick, recent);
    return { message: pick, loudness: 1.0 };
  }

  // Fall back to the global weighted pool for this zone's theme.
  const theme = z?.ambient_theme || 'indoors';
  const pool = (globalAmbientPool[theme] || []).filter(e => e.enabled);
  if (!pool.length) return null;
  const fresh = pool.filter(e => !recent.includes(e.message));
  const source = fresh.length ? fresh : pool;

  // Weighted random selection.
  const totalWeight = source.reduce((s, e) => s + (e.weight || 100), 0);
  let rand = Math.random() * totalWeight;
  let pick = source[source.length - 1];
  for (const e of source) {
    rand -= (e.weight || 100);
    if (rand <= 0) { pick = e; break; }
  }
  _trackAmbient(zoneId, pick.message, recent);
  return { message: pick.message, loudness: pick.loudness ?? 1.0 };
}

// Returns a weather-themed ambient event for outdoor use, or null if none available.
export function getWeatherAmbient(zoneId, weatherTheme) {
  const pool = (globalAmbientPool[weatherTheme] || []).filter(e => e.enabled);
  if (!pool.length) return null;
  const recent = zoneRecentAmbients.get(zoneId) || [];
  const fresh = pool.filter(e => !recent.includes(e.message));
  const source = fresh.length ? fresh : pool;
  const totalWeight = source.reduce((s, e) => s + (e.weight || 100), 0);
  let rand = Math.random() * totalWeight;
  let pick = source[source.length - 1];
  for (const e of source) { rand -= (e.weight || 100); if (rand <= 0) { pick = e; break; } }
  _trackAmbient(zoneId, pick.message, recent);
  return { message: pick.message, loudness: pick.loudness ?? 1.0 };
}

function _trackAmbient(zoneId, message, recent) {
  const next = [...recent, message].slice(-RECENT_AMBIENT_WINDOW);
  zoneRecentAmbients.set(zoneId, next);
}

// Register a loud sound in a zone so quieter ambients are suppressed temporarily.
export function registerInterrupt(zoneId, loudness, durationMs = 8000) {
  const existing = zoneInterruptLoudness.get(zoneId);
  if (!existing || loudness > existing.loudness) {
    zoneInterruptLoudness.set(zoneId, { loudness, expiresAt: Date.now() + durationMs });
  }
}

// Returns the current interrupt loudness for a zone, or 0 if none active.
export function getInterruptLoudness(zoneId) {
  const entry = zoneInterruptLoudness.get(zoneId);
  if (!entry) return 0;
  if (Date.now() > entry.expiresAt) { zoneInterruptLoudness.delete(zoneId); return 0; }
  return entry.loudness;
}

export async function reloadZone(zoneId) {
  const { rows } = await query('SELECT * FROM zones WHERE id = $1', [zoneId]);
  if (!rows.length) return;
  const zone = rows[0];
  const existing = world.zones.get(zoneId) || { players: new Set(), enemies: new Set(), npcs: new Set(), corpses: new Set() };
  world.zones.set(zoneId, {
    ...zone,
    exits: zone.exits || {},
    ambient_events: zone.ambient_events || [],
    flags: zone.flags || {},
    players: existing.players,
    enemies: existing.enemies,
    npcs: existing.npcs,
    corpses: existing.corpses,
    // Carry the inferred-danger cache forward — it's derived from spawnTimers,
    // not the zones row, and recomputed only at boot and on spawn edits. A
    // zone save must not zero it until the next reboot.
    _dangerInferred: existing._dangerInferred,
  });
  await applyExitOverrides(zoneId);
}

// Returns true and records the cooldown if this enemy type can shout; false if suppressed.
// zoneId: if provided, also enforces a 30-second per-zone cooldown across all enemy types.
export function tryBattleCry(templateId, zoneId, cooldownMs = 10000) {
  const now = Date.now();
  const lastType = battleCryTypeCooldowns.get(templateId) || 0;
  if (now - lastType < cooldownMs) return false;
  if (zoneId) {
    const lastZone = battleCryZoneCooldowns.get(zoneId) || 0;
    if (now - lastZone < 30000) return false;
    battleCryZoneCooldowns.set(zoneId, now);
  }
  battleCryTypeCooldowns.set(templateId, now);
  return true;
}

export { world };
