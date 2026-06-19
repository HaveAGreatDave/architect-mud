import { query } from '../models/db.js';

// In-memory world state — same as before, DB is source of truth
const world = {
  zones: new Map(),
  players: new Map(),
  enemies: new Map(),
  npcs: new Map(),
  corpses: new Map(),
  spawnTimers: new Map(),
};

export async function initWorld() {
  await loadZones();
  await loadNpcs();
  await loadSpawnTemplates();
  console.log(`✓ World loaded: ${world.zones.size} zones, ${world.npcs.size} NPCs`);
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

export function getZone(id) { return world.zones.get(id) || null; }
export function getAllZones() {
  return [...world.zones.values()].map(z => ({
    id: z.id, name: z.name, description: z.description,
    danger_rating: z.danger_rating, pvp_enabled: z.pvp_enabled,
    radiation_level: z.radiation_level, is_safe_zone: z.is_safe_zone,
    exits: z.exits, ambient_events: z.ambient_events, flags: z.flags,
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
export function removeLivePlayer(pid) { world.players.delete(pid); }

export function getEnemyInstance(id) { return world.enemies.get(id) || null; }
export function removeEnemyInstance(id) {
  const e = world.enemies.get(id);
  if (e) world.zones.get(e.zoneId)?.enemies.delete(id);
  world.enemies.delete(id);
}

function spawnEnemySync(template, zoneId) {
  const id = `ei_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  const instance = {
    instanceId: id, templateId: template.id,
    name: template.name, description: template.description,
    hp: template.hp_max, hp_max: template.hp_max,
    stat_str: template.stat_str, stat_agi: template.stat_agi, stat_end: template.stat_end,
    damage_min: template.damage_min, damage_max: template.damage_max,
    armor: template.armor, xp_reward: template.xp_reward, credit_reward: template.credit_reward,
    loot_table: template.loot_table || [],
    behavior: template.behavior, faction: template.faction,
    death_message: template.death_message, flags: template.flags || {},
    zoneId, targetId: null, lastAttack: 0, statuses: [],
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

export function getRandomAmbient(zoneId) {
  const z = world.zones.get(zoneId);
  if (!z?.ambient_events?.length) return null;
  return z.ambient_events[Math.floor(Math.random() * z.ambient_events.length)];
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
