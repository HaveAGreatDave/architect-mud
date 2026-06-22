import { query } from '../models/db.js';

// In-memory world state — same as before, DB is source of truth
const world = {
  zones: new Map(),
  players: new Map(),
  enemies: new Map(),
  npcs: new Map(),
  corpses: new Map(),
  spawnTimers: new Map(),
  apartments: new Map(), // zoneId -> apartment row
};

// Global ambient event pool, keyed by theme.
let globalAmbientPool = {}; // theme -> string[]
// Per-zone: last N ambient event strings shown (to avoid repeats).
const zoneRecentAmbients = new Map(); // zoneId -> string[]
const RECENT_AMBIENT_WINDOW = 5;

// Per-zone: loudness of last loud sound, expires after a few seconds.
// Quieter ambients are suppressed while a loud sound is "in the air".
const zoneInterruptLoudness = new Map(); // zoneId -> { loudness, expiresAt }

export async function initWorld() {
  await loadZones();
  await loadNpcs();
  await loadSpawnTemplates();
  await loadApartments();
  await loadGlobalAmbients();
  console.log(`✓ World loaded: ${world.zones.size} zones, ${world.npcs.size} NPCs, ${world.apartments.size} apartments`);
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

async function loadZones() {
  const { rows } = await query('SELECT * FROM zones');
  for (const zone of rows) {
    world.zones.set(zone.id, {
      ...zone,
      exits: zone.exits || {},
      ambient_events: zone.ambient_events || [],
      flags: zone.flags || {},
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
    world.npcs.set(npc.id, {
      ...npc,
      dialogue_tree: npc.dialogue_tree || {},
      vendor_inventory: npc.vendor_inventory || [],
      flags: npc.flags || {},
    });
    if (npc.zone_id && world.zones.has(npc.zone_id)) {
      world.zones.get(npc.zone_id).npcs.add(npc.id);
    }
  }
}

async function loadSpawnTemplates() {
  const { rows } = await query('SELECT * FROM zone_spawns');
  for (const spawn of rows) {
    world.spawnTimers.set(spawn.id, { ...spawn, nextSpawn: Date.now() });
  }
}

async function loadApartments() {
  const { rows } = await query('SELECT * FROM apartments');
  for (const apt of rows) {
    world.apartments.set(apt.zone_id, apt);
  }
}

export function getApartment(zoneId) { return world.apartments.get(zoneId) || null; }
export function setApartmentCache(zoneId, apt) { world.apartments.set(zoneId, apt); }

export function getZone(id) { return world.zones.get(id) || null; }

// Build a small graph snapshot for the minimap: current zone + everything
// reachable within `depth` hops, with enough info to render an ASCII grid.
export function getMinimapData(centerZoneId, depth = 4) {
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
    for (const neighborId of Object.values(zone.exits || {})) {
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

  const nodes = [];
  for (const [id] of visited) {
    const zone = world.zones.get(id);
    if (!zone) continue;
    nodes.push({
      id: zone.id,
      name: zone.name,
      danger_rating: zone.danger_rating,
      is_safe_zone: !!zone.is_safe_zone,
      pvp_enabled: !!zone.pvp_enabled,
      exits: zone.exits || {},
      map_id: zone.map_id || null,
      grid_x: zone.grid_x, grid_y: zone.grid_y, grid_z: zone.grid_z,
      marker: zone.marker || null, color: zone.color || null, bg_color: zone.bg_color || null,
      is_current: zone.id === centerZoneId,
      player_count: zone.players.size,
    });
  }
  return nodes;
}

export function getAllZones() {
  return [...world.zones.values()].map(z => ({
    id: z.id, name: z.name, description: z.description,
    danger_rating: z.danger_rating, pvp_enabled: z.pvp_enabled,
    radiation_level: z.radiation_level, is_safe_zone: z.is_safe_zone,
    exits: z.exits, ambient_events: z.ambient_events, flags: z.flags,
    map_id: z.map_id, grid_x: z.grid_x, grid_y: z.grid_y, grid_z: z.grid_z,
    marker: z.marker, color: z.color, bg_color: z.bg_color,
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

export function getEnemyInstance(id) { return world.enemies.get(id) || null; }
export function removeEnemyInstance(id) {
  const e = world.enemies.get(id);
  if (e) world.zones.get(e.zoneId)?.enemies.delete(id);
  world.enemies.delete(id);
}

function spawnEnemySync(template, zoneId) {
  const id = `ei_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  const flags = template.flags || {};
  const instance = {
    instanceId: id, templateId: template.id,
    name: template.name, description: template.description,
    hp: template.hp_max, hp_max: template.hp_max,
    stat_str: template.stat_str, stat_agi: template.stat_agi, stat_end: template.stat_end,
    damage_min: template.damage_min, damage_max: template.damage_max,
    armor: template.armor, defense: template.defense || 0, soak: template.soak || {},
    xp_reward: template.xp_reward, credit_reward: template.credit_reward,
    loot_table: template.loot_table || [],
    behavior: template.behavior, faction: template.faction,
    death_message: template.death_message, flags,
    zoneId, targetId: null, lastAttack: 0, statuses: [],
    // Lore-appropriate enemies (skittish scavengers, slow lumbering mutants)
    // hesitate before their FIRST attack after aggroing — set the moment they
    // acquire a target, checked separately from the normal attack-interval pace.
    aggroedAt: null,
  };
  world.enemies.set(id, instance);
  world.zones.get(zoneId)?.enemies.add(id);
  return instance;
}

export async function tickSpawns() {
  const now = Date.now();
  const { rows } = await query(`
    SELECT e.*, zs.id as spawn_id, zs.zone_id, zs.max_count, zs.spawn_weight, zs.respawn_seconds
    FROM zone_spawns zs JOIN enemies e ON e.id = zs.enemy_id
  `);
  for (const t of rows) {
    const timer = world.spawnTimers.get(t.spawn_id);
    if (!timer || now < timer.nextSpawn) continue;
    const zone = world.zones.get(t.zone_id);
    if (!zone) continue;
    const count = [...zone.enemies].filter(eid => world.enemies.get(eid)?.templateId === t.id).length;
    if (count < t.max_count && Math.random() * 100 < t.spawn_weight) {
      spawnEnemySync(t, t.zone_id);
    }
    world.spawnTimers.set(t.spawn_id, { ...timer, nextSpawn: now + t.respawn_seconds * 1000 });
  }
}

export function createCorpse(c) {
  world.corpses.set(c.id, c);
  world.zones.get(c.zoneId)?.corpses.add(c.id);
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
  });
}

export { world };
