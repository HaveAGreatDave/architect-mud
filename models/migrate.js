import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '../../data/world.db');

export function getDb() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export function migrate() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'player',
      handle TEXT UNIQUE NOT NULL,
      origin_fragment TEXT,
      archetype TEXT,
      stat_str INTEGER DEFAULT 5,
      stat_agi INTEGER DEFAULT 5,
      stat_int INTEGER DEFAULT 5,
      stat_wil INTEGER DEFAULT 5,
      stat_end INTEGER DEFAULT 5,
      stat_cha INTEGER DEFAULT 5,
      hp INTEGER DEFAULT 100,
      hp_max INTEGER DEFAULT 100,
      sanity INTEGER DEFAULT 100,
      sanity_max INTEGER DEFAULT 100,
      hunger INTEGER DEFAULT 100,
      thirst INTEGER DEFAULT 100,
      radiation INTEGER DEFAULT 0,
      current_zone TEXT DEFAULT 'zone_start',
      anchor_zone TEXT DEFAULT 'zone_start',
      credits INTEGER DEFAULT 50,
      created_at INTEGER DEFAULT (unixepoch()),
      last_seen INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS player_skills (
      player_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      rank INTEGER DEFAULT 0,
      xp INTEGER DEFAULT 0,
      PRIMARY KEY (player_id, skill_id),
      FOREIGN KEY (player_id) REFERENCES players(id)
    );

    CREATE TABLE IF NOT EXISTS zones (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      danger_rating TEXT DEFAULT 'safe',
      pvp_enabled INTEGER DEFAULT 0,
      radiation_level INTEGER DEFAULT 0,
      light_level TEXT DEFAULT 'normal',
      is_safe_zone INTEGER DEFAULT 0,
      ambient_events TEXT DEFAULT '[]',
      exits TEXT DEFAULT '{}',
      flags TEXT DEFAULT '{}',
      created_by TEXT,
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      type TEXT NOT NULL,
      subtype TEXT,
      weight REAL DEFAULT 1.0,
      value INTEGER DEFAULT 0,
      rarity TEXT DEFAULT 'common',
      is_stackable INTEGER DEFAULT 0,
      is_unique INTEGER DEFAULT 0,
      is_quest_item INTEGER DEFAULT 0,
      effects TEXT DEFAULT '{}',
      stat_modifiers TEXT DEFAULT '{}',
      requirements TEXT DEFAULT '{}',
      flags TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS player_inventory (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      quantity INTEGER DEFAULT 1,
      condition REAL DEFAULT 1.0,
      is_equipped INTEGER DEFAULT 0,
      slot TEXT,
      custom_data TEXT DEFAULT '{}',
      FOREIGN KEY (player_id) REFERENCES players(id),
      FOREIGN KEY (item_id) REFERENCES items(id)
    );

    CREATE TABLE IF NOT EXISTS enemies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      stat_str INTEGER DEFAULT 5,
      stat_agi INTEGER DEFAULT 5,
      stat_end INTEGER DEFAULT 5,
      hp_max INTEGER DEFAULT 50,
      damage_min INTEGER DEFAULT 3,
      damage_max INTEGER DEFAULT 8,
      armor INTEGER DEFAULT 0,
      xp_reward INTEGER DEFAULT 10,
      credit_reward INTEGER DEFAULT 0,
      loot_table TEXT DEFAULT '[]',
      behavior TEXT DEFAULT 'aggressive',
      faction TEXT,
      death_message TEXT,
      flags TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS zone_spawns (
      id TEXT PRIMARY KEY,
      zone_id TEXT NOT NULL,
      enemy_id TEXT NOT NULL,
      max_count INTEGER DEFAULT 1,
      spawn_weight INTEGER DEFAULT 100,
      respawn_seconds INTEGER DEFAULT 300,
      FOREIGN KEY (zone_id) REFERENCES zones(id),
      FOREIGN KEY (enemy_id) REFERENCES enemies(id)
    );

    CREATE TABLE IF NOT EXISTS npcs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      zone_id TEXT,
      faction TEXT,
      disposition TEXT DEFAULT 'neutral',
      dialogue_tree TEXT DEFAULT '{}',
      vendor_inventory TEXT DEFAULT '[]',
      wanders INTEGER DEFAULT 0,
      flags TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS factions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      color TEXT DEFAULT '#888888',
      hostile_to TEXT DEFAULT '[]',
      friendly_to TEXT DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS player_faction_rep (
      player_id TEXT NOT NULL,
      faction_id TEXT NOT NULL,
      reputation INTEGER DEFAULT 0,
      tier TEXT DEFAULT 'unknown',
      PRIMARY KEY (player_id, faction_id),
      FOREIGN KEY (player_id) REFERENCES players(id),
      FOREIGN KEY (faction_id) REFERENCES factions(id)
    );

    CREATE TABLE IF NOT EXISTS loot_tables (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      entries TEXT DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS world_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      description TEXT NOT NULL,
      zone_id TEXT,
      player_id TEXT,
      data TEXT DEFAULT '{}',
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS player_corpses (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL,
      zone_id TEXT NOT NULL,
      inventory_snapshot TEXT DEFAULT '[]',
      death_message TEXT,
      expires_at INTEGER NOT NULL,
      looted_by TEXT DEFAULT '[]',
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_players_username ON players(username);
    CREATE INDEX IF NOT EXISTS idx_player_inventory_player ON player_inventory(player_id);
    CREATE INDEX IF NOT EXISTS idx_zone_spawns_zone ON zone_spawns(zone_id);
    CREATE INDEX IF NOT EXISTS idx_world_events_zone ON world_events(zone_id);
    CREATE INDEX IF NOT EXISTS idx_world_events_time ON world_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_corpses_zone ON player_corpses(zone_id);
  `);

  db.close();
  console.log('✓ Database migrated');
}

migrate();
