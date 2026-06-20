import { query } from './db.js';

import { migrateEnvironment } from './migrate.environment.js';
await migrateEnvironment(query);

export async function migrate() {
  await query(`
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
      credits INTEGER DEFAULT 20,
      bank_credits INTEGER DEFAULT 0,
      visibly_mutated INTEGER DEFAULT 0,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
      last_seen BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
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
      ambient_events JSONB DEFAULT '[]',
      exits JSONB DEFAULT '{}',
      flags JSONB DEFAULT '{}',
      created_by TEXT,
      updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
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
      effects JSONB DEFAULT '{}',
      stat_modifiers JSONB DEFAULT '{}',
      requirements JSONB DEFAULT '{}',
      flags JSONB DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS player_inventory (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      quantity INTEGER DEFAULT 1,
      condition REAL DEFAULT 1.0,
      is_equipped INTEGER DEFAULT 0,
      slot TEXT,
      custom_data JSONB DEFAULT '{}'
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
      loot_table JSONB DEFAULT '[]',
      behavior TEXT DEFAULT 'aggressive',
      faction TEXT,
      death_message TEXT,
      flags JSONB DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS zone_spawns (
      id TEXT PRIMARY KEY,
      zone_id TEXT NOT NULL,
      enemy_id TEXT NOT NULL,
      max_count INTEGER DEFAULT 1,
      spawn_weight INTEGER DEFAULT 100,
      respawn_seconds INTEGER DEFAULT 300
    );

    CREATE TABLE IF NOT EXISTS npcs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      zone_id TEXT,
      faction TEXT,
      disposition TEXT DEFAULT 'neutral',
      dialogue_tree JSONB DEFAULT '{}',
      vendor_inventory JSONB DEFAULT '[]',
      wanders INTEGER DEFAULT 0,
      flags JSONB DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS factions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      color TEXT DEFAULT '#888888',
      hostile_to JSONB DEFAULT '[]',
      friendly_to JSONB DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS player_faction_rep (
      player_id TEXT NOT NULL,
      faction_id TEXT NOT NULL,
      reputation INTEGER DEFAULT 0,
      tier TEXT DEFAULT 'unknown',
      PRIMARY KEY (player_id, faction_id)
    );

    CREATE TABLE IF NOT EXISTS loot_tables (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      entries JSONB DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS world_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      description TEXT NOT NULL,
      zone_id TEXT,
      player_id TEXT,
      data JSONB DEFAULT '{}',
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
    );

    CREATE TABLE IF NOT EXISTS player_corpses (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL,
      zone_id TEXT NOT NULL,
      inventory_snapshot JSONB DEFAULT '[]',
      death_message TEXT,
      expires_at BIGINT NOT NULL,
      looted_by JSONB DEFAULT '[]',
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
    );

    CREATE TABLE IF NOT EXISTS apartments (
      zone_id TEXT PRIMARY KEY,
      owner_id TEXT,
      owner_handle TEXT,
      is_locked INTEGER DEFAULT 0,
      lock_difficulty INTEGER DEFAULT 1,
      rent_cost INTEGER DEFAULT 100,
      purchased_at BIGINT,
      FOREIGN KEY (zone_id) REFERENCES zones(id)
    );

    CREATE TABLE IF NOT EXISTS recipes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT DEFAULT 'misc',
      requires_station TEXT,
      skill_req JSONB DEFAULT '{}',
      ingredients JSONB DEFAULT '[]',
      base_output JSONB NOT NULL,
      skill_id TEXT NOT NULL,
      base_difficulty INTEGER DEFAULT 3
    );

    CREATE TABLE IF NOT EXISTS drugs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      item_id TEXT,
      duration_seconds INTEGER DEFAULT 300,
      effects JSONB DEFAULT '{}',
      addiction_chance REAL DEFAULT 0,
      overdose_threshold INTEGER DEFAULT 3,
      withdrawal_effects JSONB DEFAULT '{}',
      flags JSONB DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS player_drug_state (
      player_id TEXT NOT NULL,
      drug_id TEXT NOT NULL,
      active_until BIGINT,
      doses_in_system INTEGER DEFAULT 0,
      times_used INTEGER DEFAULT 0,
      is_addicted INTEGER DEFAULT 0,
      last_used_at BIGINT,
      PRIMARY KEY (player_id, drug_id)
    );

    CREATE TABLE IF NOT EXISTS mutations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      polarity TEXT DEFAULT 'mixed',
      visible INTEGER DEFAULT 1,
      stat_modifiers JSONB DEFAULT '{}',
      effects JSONB DEFAULT '{}',
      drawbacks JSONB DEFAULT '[]',
      rarity TEXT DEFAULT 'uncommon',
      radiation_threshold INTEGER DEFAULT 40
    );

    CREATE TABLE IF NOT EXISTS player_mutations (
      player_id TEXT NOT NULL,
      mutation_id TEXT NOT NULL,
      acquired_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
      PRIMARY KEY (player_id, mutation_id)
    );

    CREATE INDEX IF NOT EXISTS idx_players_username ON players(username);
    CREATE INDEX IF NOT EXISTS idx_player_inventory_player ON player_inventory(player_id);
    CREATE INDEX IF NOT EXISTS idx_zone_spawns_zone ON zone_spawns(zone_id);
    CREATE INDEX IF NOT EXISTS idx_world_events_zone ON world_events(zone_id);
    CREATE INDEX IF NOT EXISTS idx_world_events_time ON world_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_apartments_owner ON apartments(owner_id);
  `);

  console.log('✓ Database migrated (Postgres)');
}

migrate().catch(e => { console.error(e); process.exit(1); });
