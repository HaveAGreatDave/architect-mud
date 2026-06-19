import { getDb } from '../models/migrate.js';

// In-memory world state
const world = {
  zones: new Map(),       // zoneId -> zone data + live state
  players: new Map(),     // playerId -> live player state
  enemies: new Map(),     // instanceId -> live enemy instance
  npcs: new Map(),        // npcId -> npc data
  corpses: new Map(),     // corpseId -> corpse data
  spawnTimers: new Map(), // spawnId -> next spawn time
};

let db;

export function initWorld() {
  db = getDb();
  loadZones();
  loadNpcs();
  loadSpawnTemplates();
  console.log(`✓ World loaded: ${world.zones.size} zones, ${world.npcs.size} NPCs`);
}

function loadZones() {
  const zones = db.prepare('SELECT * FROM zones').all();
  for (const zone of zones) {
    world.zones.set(zone.id, {
      ...zone,
      exits: JSON.parse(zone.exits || '{}'),
      ambient_events: JSON.parse(zone.ambient_events || '[]'),
      flags: JSON.parse(zone.flags || '{}'),
      players: new Set(),
      enemies: new Set(),
      npcs: new Set(),
      corpses: new Set(),
    });
  }
}

function loadNpcs() {
  const npcs = db.prepare('SELECT * FROM npcs').all();
  for (const npc of npcs) {
    const parsed = {
      ...npc,
      dialogue_tree: JSON.parse(npc.dialogue_tree || '{}'),
      vendor_inventory: JSON.parse(npc.vendor_inventory || '[]'),
      flags: JSON.parse(npc.flags || '{}'),
    };
    world.npcs.set(npc.id, parsed);
    if (npc.zone_id && world.zones.has(npc.zone_id)) {
      world.zones.get(npc.zone_id).npcs.add(npc.id);
    }
  }
}

function loadSpawnTemplates() {
  const spawns = db.prepare('SELECT * FROM zone_spawns').all();
  for (const spawn of spawns) {
    world.spawnTimers.set(spawn.id, {
      ...spawn,
      nextSpawn: Date.now(),
      loot_table: [],
    });
  }
}

// --- Zone queries ---

export function getZone(zoneId) {
  return world.zones.get(zoneId) || null;
}

export function getZonePlayers(zoneId) {
  const zone = world.zones.get(zoneId);
  if (!zone) return [];
  return [...zone.players].map(pid => world.players.get(pid)).filter(Boolean);
}

export function getZoneEnemies(zoneId) {
  const zone = world.zones.get(zoneId);
  if (!zone) return [];
  return [...zone.enemies].map(eid => world.enemies.get(eid)).filter(Boolean);
}

export function getZoneNpcs(zoneId) {
  const zone = world.zones.get(zoneId);
  if (!zone) return [];
  return [...zone.npcs].map(nid => world.npcs.get(nid)).filter(Boolean);
}

export function getZoneCorpses(zoneId) {
  const zone = world.zones.get(zoneId);
  if (!zone) return [];
  return [...zone.corpses].map(cid => world.corpses.get(cid)).filter(Boolean);
}

// --- Player world position ---

export function addPlayerToZone(playerId, zoneId) {
  const zone = world.zones.get(zoneId);
  if (zone) zone.players.add(playerId);
}

export function removePlayerFromZone(playerId, zoneId) {
  const zone = world.zones.get(zoneId);
  if (zone) zone.players.delete(playerId);
}

export function setLivePlayer(playerId, data) {
  world.players.set(playerId, data);
}

export function getLivePlayer(playerId) {
  return world.players.get(playerId) || null;
}

export function removeLivePlayer(playerId) {
  world.players.delete(playerId);
}

// --- Enemy instance management ---

export function spawnEnemyInstance(template, zoneId) {
  const { randomUUID } = await import('crypto');
  // Can't use await in sync — use crypto sync approach
  const id = `enemy_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  const instance = {
    instanceId: id,
    templateId: template.id,
    name: template.name,
    description: template.description,
    hp: template.hp_max,
    hp_max: template.hp_max,
    stat_str: template.stat_str,
    stat_agi: template.stat_agi,
    stat_end: template.stat_end,
    damage_min: template.damage_min,
    damage_max: template.damage_max,
    armor: template.armor,
    xp_reward: template.xp_reward,
    credit_reward: template.credit_reward,
    loot_table: JSON.parse(template.loot_table || '[]'),
    behavior: template.behavior,
    faction: template.faction,
    death_message: template.death_message,
    flags: JSON.parse(template.flags || '{}'),
    zoneId,
    targetId: null,
    lastAttack: 0,
    statuses: [],
  };
  world.enemies.set(id, instance);
  const zone = world.zones.get(zoneId);
  if (zone) zone.enemies.add(id);
  return instance;
}

export function getEnemyInstance(instanceId) {
  return world.enemies.get(instanceId) || null;
}

export function removeEnemyInstance(instanceId) {
  const enemy = world.enemies.get(instanceId);
  if (enemy) {
    const zone = world.zones.get(enemy.zoneId);
    if (zone) zone.enemies.delete(instanceId);
  }
  world.enemies.delete(instanceId);
}

// --- Corpse management ---

export function createCorpse(corpseData) {
  world.corpses.set(corpseData.id, corpseData);
  const zone = world.zones.get(corpseData.zoneId);
  if (zone) zone.corpses.add(corpseData.id);
}

export function getCorpse(corpseId) {
  return world.corpses.get(corpseId) || null;
}

export function removeCorpse(corpseId) {
  const corpse = world.corpses.get(corpseId);
  if (corpse) {
    const zone = world.zones.get(corpse.zoneId);
    if (zone) zone.corpses.delete(corpseId);
  }
  world.corpses.delete(corpseId);
}

// --- Zone hot-reload (for dev panel) ---

export function reloadZone(zoneId) {
  if (!db) return;
  const zone = db.prepare('SELECT * FROM zones WHERE id = ?').get(zoneId);
  if (!zone) return;

  const existing = world.zones.get(zoneId) || { players: new Set(), enemies: new Set(), npcs: new Set(), corpses: new Set() };
  world.zones.set(zoneId, {
    ...zone,
    exits: JSON.parse(zone.exits || '{}'),
    ambient_events: JSON.parse(zone.ambient_events || '[]'),
    flags: JSON.parse(zone.flags || '{}'),
    players: existing.players,
    enemies: existing.enemies,
    npcs: existing.npcs,
    corpses: existing.corpses,
  });
  return world.zones.get(zoneId);
}

export function reloadAllZones() {
  loadZones();
}

// --- Spawn tick (called by game loop) ---

export function tickSpawns() {
  const now = Date.now();
  const templates = db ? db.prepare('SELECT e.*, zs.id as spawn_id, zs.zone_id, zs.max_count, zs.spawn_weight, zs.respawn_seconds FROM zone_spawns zs JOIN enemies e ON e.id = zs.enemy_id').all() : [];

  for (const template of templates) {
    const timer = world.spawnTimers.get(template.spawn_id);
    if (!timer || now < timer.nextSpawn) continue;

    const zone = world.zones.get(template.zone_id);
    if (!zone) continue;

    const currentCount = [...zone.enemies].filter(eid => {
      const e = world.enemies.get(eid);
      return e && e.templateId === template.id;
    }).length;

    if (currentCount < template.max_count) {
      if (Math.random() * 100 < template.spawn_weight) {
        spawnEnemyInstanceSync(template, template.zone_id);
      }
    }

    world.spawnTimers.set(template.spawn_id, {
      ...timer,
      nextSpawn: now + (template.respawn_seconds * 1000),
    });
  }
}

function spawnEnemyInstanceSync(template, zoneId) {
  const id = `ei_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  const instance = {
    instanceId: id,
    templateId: template.id,
    name: template.name,
    description: template.description,
    hp: template.hp_max,
    hp_max: template.hp_max,
    stat_str: template.stat_str,
    stat_agi: template.stat_agi,
    stat_end: template.stat_end,
    damage_min: template.damage_min,
    damage_max: template.damage_max,
    armor: template.armor,
    xp_reward: template.xp_reward,
    credit_reward: template.credit_reward,
    loot_table: JSON.parse(template.loot_table || '[]'),
    behavior: template.behavior,
    faction: template.faction,
    death_message: template.death_message,
    flags: JSON.parse(template.flags || '{}'),
    zoneId,
    targetId: null,
    lastAttack: 0,
    statuses: [],
  };
  world.enemies.set(id, instance);
  const zone = world.zones.get(zoneId);
  if (zone) zone.enemies.add(id);
  return instance;
}

// --- Ambient event tick ---

export function getRandomAmbient(zoneId) {
  const zone = world.zones.get(zoneId);
  if (!zone || !zone.ambient_events.length) return null;
  return zone.ambient_events[Math.floor(Math.random() * zone.ambient_events.length)];
}

export function getAllZones() {
  return [...world.zones.values()].map(z => ({
    id: z.id, name: z.name, description: z.description,
    danger_rating: z.danger_rating, pvp_enabled: z.pvp_enabled,
    radiation_level: z.radiation_level, is_safe_zone: z.is_safe_zone,
    exits: z.exits, ambient_events: z.ambient_events, flags: z.flags,
    player_count: z.players.size, enemy_count: z.enemies.size,
  }));
}

export { world };
