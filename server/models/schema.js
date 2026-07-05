import { fileURLToPath } from 'url';
import { query } from './db.js';

// Single source of schema truth for Architect MUD.
//
// SCHEMA_SQL holds every table/column/index definition. It is:
//   - applied deliberately via `npm run db:schema` (NOT on server boot), and
//   - prepended to every dev-panel database export, so a backup always carries
//     the exact schema needed to restore it.
//
// Everything here is idempotent (CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT
// EXISTS), so re-running it against a populated database is always safe.
//
// IMPORTANT: this file is DDL ONLY. No content seeding, no data backfills, no
// renames. World content lives in Postgres (source of truth = production) and
// is restored from a dump produced by the dev panel's export button. If a
// schema change is needed, run a deliberate one-shot script against production
// AND edit SCHEMA_SQL here to match — the export will then stay in sync
// automatically.

export const SCHEMA_SQL = `
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
    ip INTEGER DEFAULT 0,
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
    is_safe_zone INTEGER DEFAULT 0,
    ambient_events JSONB DEFAULT '[]',
    exits JSONB DEFAULT '{}',
    flags JSONB DEFAULT '{}',
    created_by TEXT,
    updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
  );

  -- Maps are grid containers. The world is one map (map_world); each
  -- building interior is its own map, so a building takes a single cell on
  -- its parent map but can hold many interior cells. parent_zone_id is the
  -- zone on the parent map this interior belongs to (NULL for the world
  -- map); entry_zone_id is where a player lands when diving into the map.
  CREATE TABLE IF NOT EXISTS maps (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_zone_id TEXT,
    entry_zone_id TEXT,
    created_by TEXT,
    updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
  );

  -- Grid coordinates + map membership for every zone. Additive: exits stay
  -- the source of truth for traversability (adjacency never implies a
  -- connection); these only position zones on a map for display/editing.
  -- marker is a <=2-char map glyph, color a CSS color for character.
  ALTER TABLE zones ADD COLUMN IF NOT EXISTS map_id TEXT;
  ALTER TABLE zones ADD COLUMN IF NOT EXISTS parent_zone TEXT REFERENCES zones(id);
  ALTER TABLE zones ADD COLUMN IF NOT EXISTS grid_x INTEGER;
  ALTER TABLE zones ADD COLUMN IF NOT EXISTS grid_y INTEGER;
  ALTER TABLE zones ADD COLUMN IF NOT EXISTS grid_z INTEGER DEFAULT 0;
  ALTER TABLE zones ADD COLUMN IF NOT EXISTS marker TEXT;
  ALTER TABLE zones ADD COLUMN IF NOT EXISTS color TEXT;
  ALTER TABLE zones ADD COLUMN IF NOT EXISTS bg_color TEXT;
  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    type TEXT NOT NULL,
    subtype TEXT,
    weight REAL DEFAULT 1000,
    value INTEGER DEFAULT 0,
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
    custom_data JSONB DEFAULT '{}',
    container_id TEXT
  );
  ALTER TABLE player_inventory ADD COLUMN IF NOT EXISTS container_id TEXT;
  ALTER TABLE player_inventory ADD COLUMN IF NOT EXISTS layer INTEGER DEFAULT 1;
  ALTER TABLE player_inventory ADD COLUMN IF NOT EXISTS equipped_at TIMESTAMPTZ;

  CREATE TABLE IF NOT EXISTS enemies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    hp_max INTEGER DEFAULT 50,
    loot_table JSONB DEFAULT '[]',
    behavior TEXT DEFAULT 'aggressive',
    faction TEXT,
    death_message TEXT,
    flags JSONB DEFAULT '{}'
  );
  ALTER TABLE enemies ADD COLUMN IF NOT EXISTS behaviour_graph JSONB DEFAULT '{}';

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
    dialogue_tree JSONB DEFAULT '{}',
    vendor_inventory JSONB DEFAULT '[]',
    wanders INTEGER DEFAULT 0,
    flags JSONB DEFAULT '{}'
  );
  ALTER TABLE npcs ADD COLUMN IF NOT EXISTS behaviour_graph JSONB DEFAULT '{}';
  ALTER TABLE npcs ADD COLUMN IF NOT EXISTS home_zone TEXT DEFAULT 'zone_residential_lobby';
  ALTER TABLE npcs ALTER COLUMN home_zone SET DEFAULT 'zone_residential_lobby';
  ALTER TABLE npcs ADD COLUMN IF NOT EXISTS studio_zone_id TEXT;
  ALTER TABLE npcs ADD COLUMN IF NOT EXISTS work_zone_id TEXT;
  ALTER TABLE npcs ADD COLUMN IF NOT EXISTS chitchat JSONB DEFAULT '[]';
  ALTER TABLE npcs ADD COLUMN IF NOT EXISTS hp INTEGER DEFAULT 20;
  ALTER TABLE npcs ADD COLUMN IF NOT EXISTS hp_max INTEGER DEFAULT 20;
  UPDATE npcs SET hp=20, hp_max=20 WHERE hp IS NULL OR hp_max IS NULL;
  ALTER TABLE npcs ADD COLUMN IF NOT EXISTS sex TEXT DEFAULT 'male';
  UPDATE npcs SET sex='male' WHERE sex IS NULL;
  -- Vendor stock system:
  --   vendor_inventory  = catalogue (all items this vendor can sell; managed in dev panel)
  --   vendor_stock      = active shelf (auto-managed subset; what players actually buy from)
  --   vendor_stock_size = max items on shelf at once
  --   vendor_restock_rate = items added to shelf per 24 h tick
  --   vendor_credits    = credits earned from sales; physically stored in the zone's hackable vendor safe
  ALTER TABLE npcs ADD COLUMN IF NOT EXISTS vendor_stock JSONB DEFAULT '[]';
  ALTER TABLE npcs ADD COLUMN IF NOT EXISTS vendor_stock_size INTEGER DEFAULT 10;
  ALTER TABLE npcs ADD COLUMN IF NOT EXISTS vendor_restock_rate INTEGER DEFAULT 1;
  ALTER TABLE npcs ADD COLUMN IF NOT EXISTS vendor_credits INTEGER DEFAULT 0;
  ALTER TABLE npcs ADD COLUMN IF NOT EXISTS npc_type TEXT DEFAULT 'npc';
  ALTER TABLE npcs ADD COLUMN IF NOT EXISTS vendor_schedule JSONB DEFAULT '{}';
  ALTER TABLE npcs ADD COLUMN IF NOT EXISTS vendor_bank_credits INTEGER DEFAULT 0;
  ALTER TABLE npcs ADD COLUMN IF NOT EXISTS vendor_shop_name TEXT;
  ALTER TABLE npcs ADD COLUMN IF NOT EXISTS home_activities JSONB DEFAULT '[]';
  -- Per-NPC ambient-banter scripts (array of threads; each thread is an array of
  -- turn strings). Added to the shared library pool when this NPC starts a scene.
  ALTER TABLE npcs ADD COLUMN IF NOT EXISTS banter JSONB DEFAULT '[]';

  -- Shared ambient-banter library: little back-and-forth scenes idle NPCs play
  -- out when they share a witnessed zone. personality NULL/'' = generic (fits any
  -- NPC); a slug limits the thread to that archetype's initiator. lines = ordered
  -- turns, spoken by alternating participants.
  CREATE TABLE IF NOT EXISTS npc_banter_threads (
    id TEXT PRIMARY KEY,
    personality TEXT,
    lines JSONB NOT NULL DEFAULT '[]',
    enabled BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 0
  );

  -- Non-takeable scenery (bar counters, stools, beds, tables...). Distinct
  -- from items: items live in player_inventory (including the
  -- "_ground_<zoneId>" ground-item hack) and are takeable; furniture is
  -- permanent room dressing, examine-only, never enters an inventory.
  CREATE TABLE IF NOT EXISTS furniture (
    id TEXT PRIMARY KEY,
    zone_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    flags JSONB DEFAULT '{}'
  );
  ALTER TABLE furniture ALTER COLUMN flags SET DEFAULT '{}';
  -- object_type classifies the furniture piece. 'light' replaces the old is_light flag.
  -- Valid values: 'furniture', 'light', 'fixture', 'appliance', 'decoration', 'terminal', 'container'
  ALTER TABLE furniture ADD COLUMN IF NOT EXISTS object_type TEXT DEFAULT 'furniture';
  ALTER TABLE furniture ADD COLUMN IF NOT EXISTS light_on INTEGER DEFAULT 0;
  -- 'overhead' (room's main light, switch-operated), 'lamp' (individually
  -- switched, same as overhead mechanically — distinct mainly for flavor),
  -- or 'streetlight' (outdoor, NOT player-switchable — toggled
  -- automatically at dusk/dawn by the environment system instead).
  ALTER TABLE furniture ADD COLUMN IF NOT EXISTS light_type TEXT DEFAULT 'lamp';
  -- Power draw when active. NULL = use type default (lamp=5W, overhead=20W, streetlight=200W).
  ALTER TABLE furniture ADD COLUMN IF NOT EXISTS power_draw_kw REAL DEFAULT NULL;
  -- Player-intended light state, preserved across power outages so lights
  -- restore correctly when power returns. NULL = not currently overridden.
  ALTER TABLE furniture ADD COLUMN IF NOT EXISTS light_on_intended INTEGER DEFAULT NULL;
  ALTER TABLE furniture ADD COLUMN IF NOT EXISTS lumen_output INTEGER;
  -- Nominal worth in credits (room dressing is examine-only, so this is flavour/
  -- appraisal value, not a shop price). 0 = worthless/unpriced.
  ALTER TABLE furniture ADD COLUMN IF NOT EXISTS price INTEGER DEFAULT 0;
  -- Destructible furniture HP (NULL = indestructible room dressing).
  ALTER TABLE furniture ADD COLUMN IF NOT EXISTS hp INTEGER;
  ALTER TABLE furniture ADD COLUMN IF NOT EXISTS hp_max INTEGER;

  -- Triggered sound definitions (gunshot, explosion, bark, etc.).
  -- Associated with objects/events via tags; loudness determines tile range.
  CREATE TABLE IF NOT EXISTS sounds (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'misc',
    descriptions JSONB NOT NULL DEFAULT '[]',
    loudness REAL NOT NULL DEFAULT 3.0,
    enabled INTEGER NOT NULL DEFAULT 1
  );
  ALTER TABLE sounds ADD COLUMN IF NOT EXISTS propagation TEXT NOT NULL DEFAULT 'both';

  -- Interface / game SFX overrides. The built-in procedural cues for the poker
  -- table and the hacking/lock minigames live in client/shared/sfx-catalog.js;
  -- rows here override a cue by its catalog id (edited via the dev panel's Sounds
  -- tab → Interface / Game SFX). Only overridden cues have a row — the game boot
  -- fetches these and layers them over the built-ins. grp is a display bucket.
  CREATE TABLE IF NOT EXISTS interface_sfx (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    grp TEXT NOT NULL DEFAULT 'misc',
    config JSONB NOT NULL DEFAULT '{}',
    priority INTEGER NOT NULL DEFAULT 5,
    enabled INTEGER NOT NULL DEFAULT 1
  );

  -- Global ambient event pool, organized by theme. Zones reference a theme
  -- via the ambient_theme column; the ambient tick pulls from this pool when
  -- zone-specific events would repeat too soon.
  CREATE TABLE IF NOT EXISTS global_ambient_events (
    id TEXT PRIMARY KEY,
    theme TEXT NOT NULL DEFAULT 'indoors',
    message TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1
  );
  ALTER TABLE global_ambient_events ADD COLUMN IF NOT EXISTS loudness REAL NOT NULL DEFAULT 1.0;
  ALTER TABLE global_ambient_events ADD COLUMN IF NOT EXISTS weight INTEGER NOT NULL DEFAULT 100;
  ALTER TABLE zones ADD COLUMN IF NOT EXISTS ambient_theme TEXT DEFAULT 'indoors';

  -- Passive window light sources. zone_exterior = NULL means the window
  -- faces the outdoors; non-NULL links two interior zones together.
  CREATE TABLE IF NOT EXISTS windows (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT 'window',
    description TEXT NOT NULL DEFAULT 'A window.',
    zone_interior TEXT NOT NULL,
    zone_exterior TEXT,
    curtain_open INTEGER NOT NULL DEFAULT 1,
    glass_state TEXT NOT NULL DEFAULT 'intact',
    light_transmission FLOAT NOT NULL DEFAULT 0.8,
    visibility_transmission FLOAT NOT NULL DEFAULT 0.8,
    flags JSONB DEFAULT '{}'
  );
  ALTER TABLE windows ADD COLUMN IF NOT EXISTS handle TEXT;

  CREATE TABLE IF NOT EXISTS doors (
    id TEXT PRIMARY KEY,
    zone_id TEXT NOT NULL,
    exit_dir TEXT NOT NULL,
    door_type TEXT DEFAULT 'basic',
    is_open INTEGER DEFAULT 0,
    hp INTEGER DEFAULT 1000,
    hp_max INTEGER DEFAULT 1000,
    hololock_difficulty INTEGER DEFAULT 5,
    flags JSONB DEFAULT '{}'
  );

  -- doors columns/constraints. These live AFTER CREATE TABLE doors — they were
  -- historically placed above it, which broke a fresh empty-DB bootstrap.
  ALTER TABLE doors ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '{}';
  ALTER TABLE doors ADD COLUMN IF NOT EXISTS lock_state TEXT DEFAULT NULL;
  ALTER TABLE doors ADD COLUMN IF NOT EXISTS is_locked INTEGER DEFAULT 0;
  UPDATE doors SET is_open=0 WHERE is_open IS NULL;
  ALTER TABLE doors ALTER COLUMN is_open SET NOT NULL;
  ALTER TABLE doors ALTER COLUMN is_open SET DEFAULT 0;

  ALTER TABLE doors ADD COLUMN IF NOT EXISTS name TEXT DEFAULT NULL;
  -- Pins a door to one specific exit when its direction has multiple exits
  -- (see server/engine/exits.js). NULL = legacy single-exit door, resolves by
  -- (zone_id, exit_dir) alone.
  ALTER TABLE doors ADD COLUMN IF NOT EXISTS target_zone TEXT DEFAULT NULL;
  ALTER TABLE npcs ADD COLUMN IF NOT EXISTS wander_zones JSONB DEFAULT '[]';

  -- NPC factions folded into the unified orgs table (is_npc=1) — see the orgs
  -- block below. The legacy factions table was dropped (npm run db:drop-factions).
  -- player_faction_rep stays: faction_id now references orgs.id (ids preserved).
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
    capacity INTEGER,
    created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
  );

  -- Append-only log of player deaths, catalogued by the deaths plugin from the
  -- player.death broadcast. real_ts sorts; game_date/game_time are the in-world
  -- stamp; cause_label is the human string shown by the deaths command.
  CREATE TABLE IF NOT EXISTS player_deaths (
    id BIGSERIAL PRIMARY KEY,
    player_id TEXT NOT NULL,
    real_ts BIGINT NOT NULL,
    game_date TEXT,
    game_time TEXT,
    zone_id TEXT,
    cause_type TEXT,
    cause_label TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_player_deaths_player ON player_deaths(player_id, real_ts DESC);

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
  ALTER TABLE apartments ADD COLUMN IF NOT EXISTS date_rented BIGINT;
  -- Rent billing runs on the GAME calendar (advances with the game-speed knob), not
  -- real time: the game-date the next rent payment is due. Lazily initialised for
  -- pre-existing rentals on the first game-day rollover after this column lands.
  ALTER TABLE apartments ADD COLUMN IF NOT EXISTS rent_due_date DATE;
  ALTER TABLE apartments ADD COLUMN IF NOT EXISTS building_name TEXT;
  ALTER TABLE apartments ADD COLUMN IF NOT EXISTS forcefield_active INTEGER DEFAULT 0;
  ALTER TABLE doors ADD COLUMN IF NOT EXISTS forcefield_locked INTEGER DEFAULT 0;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS home_zone TEXT DEFAULT NULL;

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
    base_difficulty INTEGER DEFAULT 3,
    craft_time INTEGER DEFAULT 3
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
    tolerance REAL DEFAULT 0,
    addiction REAL DEFAULT 0,
    PRIMARY KEY (player_id, drug_id)
  );

  -- Black-market raw-drug orders (smuggle plugin, Phase 2): a placed order that a
  -- MULE drop delivers to a far hangar after deliver_at, then the player smuggles in.
  CREATE TABLE IF NOT EXISTS smuggle_orders (
    id TEXT PRIMARY KEY,
    player_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    item_name TEXT,
    qty INTEGER DEFAULT 1,
    drop_zone TEXT NOT NULL,
    deliver_at BIGINT NOT NULL,
    status TEXT DEFAULT 'pending',
    vendor_id TEXT
  );
  ALTER TABLE smuggle_orders ADD COLUMN IF NOT EXISTS vendor_id TEXT;

  -- Crime → wanted-star weights. Dev-panel editable; the engine ships defaults
  -- (server/engine/crimes.js) so a fresh DB works before any rows are authored.
  CREATE TABLE IF NOT EXISTS crimes (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    stars REAL NOT NULL DEFAULT 1,
    description TEXT DEFAULT ''
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

  -- Stamina + body temperature
  ALTER TABLE players ADD COLUMN IF NOT EXISTS stamina INTEGER DEFAULT 100;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS stamina_max INTEGER DEFAULT 100;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS body_temp_c REAL DEFAULT 37.0;

  -- Combat rework stats
  ALTER TABLE players ADD COLUMN IF NOT EXISTS stat_brawn INTEGER DEFAULT 0;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS stat_reflexes INTEGER DEFAULT 0;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS stat_endurance INTEGER DEFAULT 0;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS stat_brains INTEGER DEFAULT 0;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS stat_cool INTEGER DEFAULT 0;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS stat_senses INTEGER DEFAULT 0;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS bonus_xp INTEGER DEFAULT 0;
  ALTER TABLE player_skills ADD COLUMN IF NOT EXISTS trained REAL DEFAULT 0;
  ALTER TABLE player_corpses ADD COLUMN IF NOT EXISTS capacity INTEGER;
  ALTER TABLE enemies ADD COLUMN IF NOT EXISTS hit INTEGER DEFAULT 1;
  ALTER TABLE enemies ADD COLUMN IF NOT EXISTS dodge INTEGER DEFAULT 1;
  ALTER TABLE enemies ADD COLUMN IF NOT EXISTS weapon JSONB DEFAULT '[]';
  ALTER TABLE enemies ADD COLUMN IF NOT EXISTS body_parts JSONB DEFAULT '[]';
  ALTER TABLE enemies ADD COLUMN IF NOT EXISTS butcher_table JSONB DEFAULT '[]';
  ALTER TABLE enemies ADD COLUMN IF NOT EXISTS butcher_difficulty INTEGER DEFAULT 5;

  ALTER TABLE players ADD COLUMN IF NOT EXISTS offline_sleeping BOOLEAN DEFAULT FALSE;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS died_offline BOOLEAN DEFAULT FALSE;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS bank_credits INTEGER DEFAULT 0;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS origin_fragment TEXT;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS archetype TEXT;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS visibly_mutated INTEGER DEFAULT 0;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS covered_in_blood INTEGER DEFAULT 0;

  -- Drug tolerance + addiction accumulation (phased-effect drug system)
  ALTER TABLE player_drug_state ADD COLUMN IF NOT EXISTS tolerance REAL DEFAULT 0;
  ALTER TABLE player_drug_state ADD COLUMN IF NOT EXISTS addiction REAL DEFAULT 0;

  CREATE TABLE IF NOT EXISTS combat_config (
    key TEXT PRIMARY KEY,
    value JSONB,
    label TEXT,
    category TEXT
  );

  -- Verb aliases: shortcut → canonical verb, rewritten before command dispatch.
  -- Engine ships defaults (server/engine/commands/aliases.js); rows add/override.
  CREATE TABLE IF NOT EXISTS command_aliases (
    alias TEXT PRIMARY KEY,
    verb TEXT NOT NULL
  );

  -- Item behavior consolidated into the single tags JSONB column.
  ALTER TABLE items ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '{}';
  ALTER TABLE items ALTER COLUMN description DROP NOT NULL;
  ALTER TABLE items ALTER COLUMN type DROP NOT NULL;

  -- Staging / deployment workflow (dev panel)
  CREATE TABLE IF NOT EXISTS staged_changes (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    entity_name TEXT,
    change_type TEXT NOT NULL DEFAULT 'update',
    method TEXT NOT NULL DEFAULT 'PUT',
    api_path TEXT NOT NULL,
    staged_data JSONB,
    description TEXT,
    author TEXT NOT NULL DEFAULT 'unknown',
    staged_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(entity_type, entity_id)
  );

  CREATE TABLE IF NOT EXISTS deployments (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    deployed_at TIMESTAMPTZ DEFAULT NOW(),
    deployed_by TEXT NOT NULL,
    change_count INTEGER NOT NULL DEFAULT 0,
    changes_summary JSONB DEFAULT '[]'
  );

  -- Biological accuracy systems
  ALTER TABLE players ADD COLUMN IF NOT EXISTS biological_sex TEXT DEFAULT 'male';
  ALTER TABLE players ADD COLUMN IF NOT EXISTS hair_style TEXT DEFAULT 'short';
  ALTER TABLE players ADD COLUMN IF NOT EXISTS hair_length TEXT DEFAULT 'short';
  ALTER TABLE players ADD COLUMN IF NOT EXISTS hair_color TEXT DEFAULT 'brown';
  ALTER TABLE players ADD COLUMN IF NOT EXISTS eye_color TEXT DEFAULT 'brown';
  ALTER TABLE players ADD COLUMN IF NOT EXISTS height_cm INTEGER DEFAULT 170;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS weight_kg REAL DEFAULT 70.0;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS appearance_free_used INTEGER DEFAULT 0;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS mis_enabled INTEGER DEFAULT 0;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS horniness INTEGER DEFAULT 0;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS erect INTEGER DEFAULT 0;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS digestive_load REAL DEFAULT 0;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS hydration_load REAL DEFAULT 0;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS appearance_data JSONB DEFAULT '{}';
  ALTER TABLE players ADD COLUMN IF NOT EXISTS clothing_contamination JSONB DEFAULT '{}';
  ALTER TABLE players ADD COLUMN IF NOT EXISTS sexuality TEXT DEFAULT 'Male';

  ALTER TABLE zones ADD COLUMN IF NOT EXISTS stains JSONB DEFAULT '{}';

  CREATE TABLE IF NOT EXISTS server_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Password reset infrastructure
  ALTER TABLE players ADD COLUMN IF NOT EXISTS email TEXT;
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    player_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    token      TEXT NOT NULL UNIQUE,
    expires_at BIGINT NOT NULL,
    used       BOOLEAN NOT NULL DEFAULT FALSE
  );
  CREATE INDEX IF NOT EXISTS idx_prt_token ON password_reset_tokens(token);

  -- ── Environmental systems (time / weather / power / lighting) ──────────────

  CREATE TABLE IF NOT EXISTS generators (
    id TEXT PRIMARY KEY,
    zone_id TEXT,
    owner_id TEXT,
    generator_type TEXT NOT NULL DEFAULT 'building',
    capacity_kw REAL NOT NULL DEFAULT 0,
    fuel_type TEXT,
    fuel_remaining REAL NOT NULL DEFAULT 0,
    fuel_burn_rate REAL NOT NULL DEFAULT 0,
    connection_range INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'online',
    flags JSONB NOT NULL DEFAULT '{}'::jsonb
  );
  ALTER TABLE generators ADD COLUMN IF NOT EXISTS name TEXT;
  ALTER TABLE generators ADD COLUMN IF NOT EXISTS remaining_kw REAL NOT NULL DEFAULT 0;
  ALTER TABLE generators ADD COLUMN IF NOT EXISTS city_generator_id TEXT REFERENCES generators(id) ON DELETE SET NULL;

  CREATE TABLE IF NOT EXISTS power_zones (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'city_grid',
    generator_id TEXT REFERENCES generators(id) ON DELETE SET NULL,
    capacity_kw REAL NOT NULL DEFAULT 0,
    current_load_kw REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'powered',
    flags JSONB NOT NULL DEFAULT '{}'::jsonb
  );
  ALTER TABLE power_zones ADD COLUMN IF NOT EXISTS available_kw REAL NOT NULL DEFAULT 0;
  ALTER TABLE power_zones ADD COLUMN IF NOT EXISTS max_capacity_kw REAL NOT NULL DEFAULT 1000;

  CREATE TABLE IF NOT EXISTS world_clock (
    id INTEGER PRIMARY KEY DEFAULT 1,
    game_date DATE NOT NULL DEFAULT CURRENT_DATE,
    game_time_minutes INTEGER NOT NULL DEFAULT 480,
    day_of_week INTEGER NOT NULL DEFAULT 1,
    season TEXT NOT NULL DEFAULT 'spring',
    last_tick_30m TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_tick_24h TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT world_clock_singleton CHECK (id = 1)
  );
  ALTER TABLE world_clock ADD COLUMN IF NOT EXISTS last_tick_1m TIMESTAMPTZ NOT NULL DEFAULT now();
  ALTER TABLE world_clock ADD COLUMN IF NOT EXISTS active_climate_profile_id TEXT;
  ALTER TABLE world_clock ADD COLUMN IF NOT EXISTS weather_override_active BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE world_clock ADD COLUMN IF NOT EXISTS weather_override_backup JSONB;
  ALTER TABLE world_clock ADD COLUMN IF NOT EXISTS lightning_kills JSONB NOT NULL DEFAULT '[]';
  ALTER TABLE world_clock ADD COLUMN IF NOT EXISTS time_scale REAL NOT NULL DEFAULT 1;

  CREATE TABLE IF NOT EXISTS climate_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    monthly_temp_c JSONB NOT NULL DEFAULT '[]',
    monthly_precip_chance JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ALTER TABLE climate_profiles ADD COLUMN IF NOT EXISTS monthly_wind_kph JSONB NOT NULL DEFAULT '[]';
  ALTER TABLE climate_profiles ADD COLUMN IF NOT EXISTS monthly_humidity JSONB NOT NULL DEFAULT '[]';

  CREATE TABLE IF NOT EXISTS weather_forecast (
    forecast_day INTEGER PRIMARY KEY,
    game_date DATE NOT NULL,
    weather_type TEXT NOT NULL,
    temp_c INTEGER NOT NULL,
    locked INTEGER NOT NULL DEFAULT 0
  );
  ALTER TABLE weather_forecast ADD COLUMN IF NOT EXISTS wind_kph INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE weather_forecast ADD COLUMN IF NOT EXISTS humidity_pct INTEGER NOT NULL DEFAULT 60;

  CREATE TABLE IF NOT EXISTS lighting_states (
    zone_id TEXT PRIMARY KEY,
    has_emergency_lighting INTEGER NOT NULL DEFAULT 0,
    artificial_light_level REAL NOT NULL DEFAULT 0,
    fixture_count INTEGER NOT NULL DEFAULT 0
  );
  ALTER TABLE lighting_states ADD COLUMN IF NOT EXISTS total_lumens INTEGER NOT NULL DEFAULT 0;

  -- ── Flag store + Script graphs (Phase 4: graph engine) ─────────────────────
  -- Flags are persisted conditional state read by Conditions in Dialogue,
  -- Scripts, and Quests. NOT the legacy 'flags' JSONB tag bag (see ADR-0003 /
  -- CONTEXT.md). Player-scoped flags key off the player; world flags are global.
  -- Values are stored as TEXT; numeric comparisons coerce at eval time.
  CREATE TABLE IF NOT EXISTS player_flags (
    player_id TEXT NOT NULL,
    flag_key TEXT NOT NULL,
    flag_value TEXT NOT NULL DEFAULT 'true',
    updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
    PRIMARY KEY (player_id, flag_key)
  );
  CREATE TABLE IF NOT EXISTS world_flags (
    flag_key TEXT PRIMARY KEY,
    flag_value TEXT NOT NULL DEFAULT 'true',
    updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
  );

  -- Reusable Script graph assets. The 'graph' JSONB is the exact node format the
  -- shared graph runtime (server/engine/graph.js) executes — hand-authorable, and
  -- edited by the devpanel node editor. Dialogue stays on npcs.dialogue_tree; both
  -- run through the same engine.
  CREATE TABLE IF NOT EXISTS scripts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    graph JSONB NOT NULL DEFAULT '{}',
    updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
  );

  -- ── Quests (Phase 5: quest plugin) ─────────────────────────────────────────
  -- A Quest is a goal whose objectives advance by the quest plugin subscribing to
  -- Events (enemy.killed, item.given, zone.entered) — the give/kill/move code never
  -- references quests (CONTEXT.md). 'objectives' is a JSONB array of
  --   { type: 'kill'|'give'|'visit', target?, item_id?, zone?, count?, desc }
  -- and 'rewards' is { credits?, items?:[{item_id,quantity}], flags?:[{scope,flag,value}] }.
  CREATE TABLE IF NOT EXISTS quests (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    objectives JSONB NOT NULL DEFAULT '[]',
    rewards JSONB NOT NULL DEFAULT '{}',
    repeatable INTEGER NOT NULL DEFAULT 0,
    updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
  );

  -- Per-player quest state. 'progress' is an integer array index-aligned to the
  -- quest's objectives. status: active → completed (all objectives met) → turned_in.
  CREATE TABLE IF NOT EXISTS player_quests (
    player_id TEXT NOT NULL,
    quest_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    progress JSONB NOT NULL DEFAULT '[]',
    started_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
    updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
    PRIMARY KEY (player_id, quest_id)
  );

  -- Channel chat history (arcnet etc). Runtime data: schema is exported, rows are not.
  -- Only the most recent messages per channel are retained; older rows are pruned.
  CREATE TABLE IF NOT EXISTS channel_messages (
    id         BIGSERIAL PRIMARY KEY,
    channel_id TEXT NOT NULL,
    from_handle TEXT NOT NULL,
    message    TEXT NOT NULL,
    created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())
  );
  CREATE INDEX IF NOT EXISTS idx_channel_messages_channel ON channel_messages(channel_id, id);

  -- Server activity log (connects, disconnects, deaths, kicks). Capped at 500 rows.
  CREATE TABLE IF NOT EXISTS server_activity_log (
    id         BIGSERIAL PRIMARY KEY,
    event_type TEXT NOT NULL,
    handle     TEXT NOT NULL,
    admin_handle TEXT,
    detail     TEXT,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ALTER TABLE server_activity_log ADD COLUMN IF NOT EXISTS detail TEXT;
  CREATE INDEX IF NOT EXISTS idx_server_activity_log_time ON server_activity_log(occurred_at DESC);

  -- Player count history (sampled every minute, kept for 7 days)
  CREATE TABLE IF NOT EXISTS player_count_log (
    id          BIGSERIAL PRIMARY KEY,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    count       INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_player_count_log_time ON player_count_log(recorded_at DESC);

  -- Dev Log: team heads-ups / important changes shown at check-in.
  -- kind: change | heads-up | action-required (the last needs an action, e.g. restart/migration).
  CREATE TABLE IF NOT EXISTS dev_notes (
    id         BIGSERIAL PRIMARY KEY,
    author     TEXT NOT NULL,
    title      TEXT NOT NULL,
    body       TEXT DEFAULT '',
    kind       TEXT NOT NULL DEFAULT 'change',
    resolved   BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_dev_notes_time ON dev_notes(created_at DESC);

  -- Maps a git author identity (lowercased author email, or 'name:<name>' when
  -- no email) to an admin account, so the Dev Log shows handles (Cyd) instead of
  -- raw git names (HaveAGreatDave).
  CREATE TABLE IF NOT EXISTS dev_identities (
    git_key    TEXT PRIMARY KEY,
    git_name   TEXT,
    player_id  TEXT REFERENCES players(id) ON DELETE CASCADE,
    handle     TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- Synced git commit history, so the Dev Log works on hosts whose checkout is
  -- shallow or absent (populated by scripts/sync-commits.js from a full repo).
  CREATE TABLE IF NOT EXISTS dev_commits (
    hash          TEXT PRIMARY KEY,
    author_name   TEXT NOT NULL,
    author_email  TEXT DEFAULT '',
    author_key    TEXT NOT NULL,
    authored_at   TIMESTAMPTZ NOT NULL,
    subject       TEXT DEFAULT '',
    files_changed INTEGER DEFAULT 0,
    lines_added   INTEGER DEFAULT 0,
    lines_deleted INTEGER DEFAULT 0,
    core_lines    INTEGER DEFAULT 0,
    core_files    JSONB DEFAULT '[]'
  );
  CREATE INDEX IF NOT EXISTS idx_dev_commits_time ON dev_commits(authored_at DESC);
  CREATE INDEX IF NOT EXISTS idx_dev_commits_author ON dev_commits(author_key);

  -- Kill / death counters
  ALTER TABLE players ADD COLUMN IF NOT EXISTS mob_kills INTEGER DEFAULT 0;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS player_kills INTEGER DEFAULT 0;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS deaths INTEGER DEFAULT 0;

  -- ── Broadcast system ────────────────────────────────────────────────────────
  -- Reusable media content assets (scripted shows, recorded footage, news templates).
  -- playback_mode: scripted | dynamic_news | live_camera | recorded
  -- messages: [{ text: '...' }, ...] — delivered sequentially at message_interval.
  -- override_duration: if set, supersedes (message_count × message_interval).
  CREATE TABLE IF NOT EXISTS media_broadcasts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    category TEXT DEFAULT 'general',
    tags JSONB DEFAULT '[]',
    playback_mode TEXT DEFAULT 'scripted',
    messages JSONB DEFAULT '[]',
    message_interval REAL DEFAULT 5,
    override_duration REAL,
    loop INTEGER DEFAULT 0,
    enabled INTEGER DEFAULT 1,
    created_by TEXT,
    updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
    broadcast_graph JSONB
  );
  ALTER TABLE media_broadcasts ADD COLUMN IF NOT EXISTS broadcast_graph JSONB;

  -- Broadcast channels (TV/radio stations). Devices tune to a channel number.
  -- channel_type: playlist | news | mixed | live | emergency
  -- idle_broadcast_id: played when no playlist item covers the current time.
  -- news_categories: JSONB array of category strings the channel covers.
  CREATE TABLE IF NOT EXISTS media_channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    number INTEGER UNIQUE,
    description TEXT DEFAULT '',
    enabled INTEGER DEFAULT 1,
    loop_playlist INTEGER DEFAULT 1,
    priority INTEGER DEFAULT 0,
    channel_type TEXT DEFAULT 'playlist',
    idle_broadcast_id TEXT REFERENCES media_broadcasts(id),
    news_categories JSONB DEFAULT '[]',
    updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
  );

  -- Physical deck/player units bound to a channel (cassette-driven TVs, etc.).
  CREATE TABLE IF NOT EXISTS media_deck_units (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES media_channels(id),
    active_cassette_item_id TEXT,
    light_state TEXT NOT NULL DEFAULT 'red'
  );
  CREATE INDEX IF NOT EXISTS idx_media_deck_units_channel ON media_deck_units(channel_id);

  -- Playlist timeline items. start_time is seconds from the start of the loop.
  -- duration_override replaces the broadcast's calculated duration for this slot.
  CREATE TABLE IF NOT EXISTS media_channel_playlist (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES media_channels(id) ON DELETE CASCADE,
    broadcast_id TEXT REFERENCES media_broadcasts(id) ON DELETE CASCADE,
    start_time INTEGER NOT NULL DEFAULT 0,
    duration_override REAL,
    priority INTEGER DEFAULT 0,
    conditions JSONB DEFAULT '[]'
  );

  -- Camera placement and state. Cameras are independent of channels; channels
  -- reference cameras for live/recorded feeds.
  -- recording_buffer: [{ ts, text }, ...] capped at storage_limit entries.
  CREATE TABLE IF NOT EXISTS media_cameras (
    id TEXT PRIMARY KEY,
    zone_id TEXT REFERENCES zones(id),
    direction TEXT DEFAULT 'north',
    is_powered INTEGER DEFAULT 1,
    is_recording INTEGER DEFAULT 0,
    is_streaming INTEGER DEFAULT 0,
    streaming_channel_id TEXT REFERENCES media_channels(id),
    recording_buffer JSONB DEFAULT '[]',
    storage_limit INTEGER DEFAULT 200,
    permissions TEXT DEFAULT 'public',
    flags JSONB DEFAULT '{}'
  );
  ALTER TABLE media_cameras ADD COLUMN IF NOT EXISTS is_damaged INTEGER DEFAULT 0;

  CREATE INDEX IF NOT EXISTS idx_media_playlist_channel ON media_channel_playlist(channel_id, start_time);
  CREATE INDEX IF NOT EXISTS idx_media_cameras_zone ON media_cameras(zone_id);

  -- TV presentation themes. CSS variable overrides applied to the in-game TV panel.
  -- preset: named style preset for special CSS effects (corporate|crt|emergency|security|pirate).
  -- Individual color fields override the matching CSS variable; blank = use CSS default.
  -- scanlines: 0 = off, 1 = subtle (default), 2 = heavy.
  CREATE TABLE IF NOT EXISTS media_themes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    preset TEXT DEFAULT 'corporate',
    bg_color TEXT DEFAULT '',
    border_color TEXT DEFAULT '',
    text_color TEXT DEFAULT '',
    header_color TEXT DEFAULT '',
    accent_color TEXT DEFAULT '',
    live_color TEXT DEFAULT '',
    ticker_color TEXT DEFAULT '',
    scanlines INTEGER DEFAULT 1,
    flags JSONB DEFAULT '{}',
    created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
    updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
  );
  ALTER TABLE media_channels ADD COLUMN IF NOT EXISTS theme_id TEXT REFERENCES media_themes(id);
  ALTER TABLE media_channels ADD COLUMN IF NOT EXISTS station_name TEXT DEFAULT '';
  ALTER TABLE media_channels ADD COLUMN IF NOT EXISTS schedule_mode TEXT DEFAULT 'loop';
  ALTER TABLE media_broadcasts ADD COLUMN IF NOT EXISTS channel_id TEXT REFERENCES media_channels(id) ON DELETE SET NULL;
  ALTER TABLE media_channels  ADD COLUMN IF NOT EXISTS studio_zone_id TEXT;
  ALTER TABLE media_channels  ADD COLUMN IF NOT EXISTS offline_graphic_id TEXT;
  ALTER TABLE media_broadcasts ADD COLUMN IF NOT EXISTS fallback_messages JSONB DEFAULT '[]';
  -- Weather broadcasts (playback_mode='weather') store line pools here: { pools:{key:[…]}, host }
  ALTER TABLE media_broadcasts ADD COLUMN IF NOT EXISTS weather_pools JSONB;
  -- Sports broadcasts (playback_mode='sports') store a line library + team/player pools here: { sport, announcer, teams:[…], players:[…], pools:{key:[…]} }
  ALTER TABLE media_broadcasts ADD COLUMN IF NOT EXISTS sports_pools JSONB;
  ALTER TABLE media_channels ADD COLUMN IF NOT EXISTS commercial_pool JSONB DEFAULT '[]';
  ALTER TABLE media_channel_playlist ADD COLUMN IF NOT EXISTS slot_type TEXT DEFAULT 'broadcast';

  -- Broadcast graphics library. ASCII art referenced by VINE title_card nodes.
  -- type: 'ascii' | 'svg'; tags: JSONB array of labels for dev-panel filtering.
  CREATE TABLE IF NOT EXISTS media_graphics (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    type TEXT DEFAULT 'ascii',
    content TEXT NOT NULL DEFAULT '',
    tags JSONB DEFAULT '[]',
    created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
    updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
  );

  -- ── ATM system ──────────────────────────────────────────────────────────────
  -- ATM networks define the banking faction: fee rates, withdrawal limits,
  -- faction rep gates, and UI accent color.
  CREATE TABLE IF NOT EXISTS atm_networks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#00ff88',
    fee_rate NUMERIC DEFAULT 0.0,
    withdrawal_limit INTEGER DEFAULT 500,
    min_faction_rep INTEGER DEFAULT -200,
    faction_id TEXT DEFAULT NULL
  );

  -- ATM units link to furniture rows (id matches furniture.id).
  -- cash_stock is the physical cash cassette; drained by withdrawals, replenished
  -- by the scheduled tick up to cash_max.
  CREATE TABLE IF NOT EXISTS atm_units (
    id TEXT PRIMARY KEY,
    network_id TEXT REFERENCES atm_networks(id),
    cash_stock INTEGER DEFAULT 5000,
    cash_max INTEGER DEFAULT 5000,
    replenish_interval_hours INTEGER DEFAULT 6,
    last_replenish BIGINT DEFAULT 0,
    hack_difficulty INTEGER DEFAULT 5,
    is_broken INTEGER DEFAULT 0
  );

  -- SPECTER surveillance: player/NPC-deployable spy networks. See docs/systems-surveillance.md.
  -- Distinct from media_cameras (studio broadcast cams): these carry ownership, batteries,
  -- device families, concealment, and network membership. A planted device also owns a
  -- furniture row with the same id (mirrors atm_units <-> furniture).
  CREATE TABLE IF NOT EXISTS security_networks (
    id TEXT PRIMARY KEY,
    owner_id TEXT,                    -- player id or npc/faction id that controls the net
    name TEXT NOT NULL DEFAULT 'Unnamed Network',
    color TEXT DEFAULT '#00ff88',    -- hub accent
    is_police INTEGER DEFAULT 0,      -- 1 = an NPC-police network
    encryption INTEGER DEFAULT 5     -- hack difficulty to join/hijack the whole net
  );

  CREATE TABLE IF NOT EXISTS security_devices (
    id TEXT PRIMARY KEY,             -- matches furniture.id when planted
    network_id TEXT REFERENCES security_networks(id),
    owner_id TEXT,
    device_kind TEXT DEFAULT 'sticky_cam', -- sticky_cam|relay|motion_sensor|audio_sensor|drone|jammer|spoofer
    zone_id TEXT REFERENCES zones(id),
    direction TEXT DEFAULT 'north',
    tier INTEGER DEFAULT 1,
    concealment INTEGER DEFAULT 5,   -- vs a finder's Security/Perception check
    battery INTEGER DEFAULT 864,
    battery_max INTEGER DEFAULT 864,
    wired INTEGER DEFAULT 0,         -- 1 = taps zone power instead of battery
    is_powered INTEGER DEFAULT 1,
    is_damaged INTEGER DEFAULT 0,
    is_recording INTEGER DEFAULT 0,
    recording_buffer JSONB DEFAULT '[]',
    storage_limit INTEGER DEFAULT 200,
    status_flags JSONB DEFAULT '{}', -- { jammed, spoofed, hijacked_by, looping, blinded }
    hack_difficulty INTEGER DEFAULT 5,
    placed_at BIGINT DEFAULT 0
  );

  -- Exported evidence clips (the datachip payload). See Phase 3.
  CREATE TABLE IF NOT EXISTS security_clips (
    id TEXT PRIMARY KEY,             -- item_datachip_<id>; matches a spawned item
    device_id TEXT,
    zone_id TEXT,
    owner_id TEXT,
    frames JSONB DEFAULT '[]',
    captured_at BIGINT DEFAULT 0,
    crime_tags JSONB DEFAULT '[]'
  );

  CREATE INDEX IF NOT EXISTS idx_security_devices_zone ON security_devices(zone_id);
  CREATE INDEX IF NOT EXISTS idx_security_devices_network ON security_devices(network_id);
  CREATE INDEX IF NOT EXISTS idx_security_devices_owner ON security_devices(owner_id);

  -- Procedural Audio system (browser-generated playback via Web Audio API).
  -- Wholly separate from the text-based "sounds" table above — that system
  -- produces ambient prose ("You hear footsteps nearby"), this system produces
  -- actual synthesized audio (music, SFX, ambience). Never merge the two.
  CREATE TABLE IF NOT EXISTS audio_instruments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT DEFAULT 'misc',
    waveform TEXT DEFAULT 'square',
    config JSONB DEFAULT '{}',
    enabled INTEGER DEFAULT 1
  );

  -- channels: tracker-style pattern data — array of channels, each an array of
  -- step objects ({note, instrument, vol} or null). instrument_ids references
  -- audio_instruments.id values used by the pattern. priority feeds the voice
  -- manager's stealing decisions (higher wins).
  CREATE TABLE IF NOT EXISTS audio_songs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT DEFAULT 'misc',
    tempo INTEGER DEFAULT 120,
    channels JSONB DEFAULT '[]',
    loop_start INTEGER DEFAULT 0,
    loop_end INTEGER DEFAULT 0,
    instrument_ids JSONB DEFAULT '[]',
    priority INTEGER DEFAULT 5,
    enabled INTEGER DEFAULT 1
  );

  -- Per-channel stereo pan (-1..1), parallel to channels[]. Empty = mono playback.
  -- Set by the .MOD importer (Amiga L-R-R-L); hand-authored songs leave it empty.
  ALTER TABLE audio_songs ADD COLUMN IF NOT EXISTS channel_pan JSONB DEFAULT '[]';

  -- config is a self-contained synth recipe (oscillator/noise layers + envelope
  -- + pitch curve) — a one-shot sound effect, independent of audio_instruments.
  CREATE TABLE IF NOT EXISTS audio_sfx (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT DEFAULT 'misc',
    priority INTEGER DEFAULT 5,
    config JSONB DEFAULT '{}',
    enabled INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS audio_ambient (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT DEFAULT 'misc',
    priority INTEGER DEFAULT 1,
    config JSONB DEFAULT '{}',
    loop INTEGER DEFAULT 1,
    enabled INTEGER DEFAULT 1
  );

  -- Zone-level adaptive music assignment: which audio_songs row plays while a
  -- player is in this zone. NULL = no music change on entering this zone.
  ALTER TABLE zones ADD COLUMN IF NOT EXISTS audio_theme_id TEXT REFERENCES audio_songs(id);

  -- Event-driven audio routing: maps a game event name to optional SFX,
  -- ambient loop, or song change. scope='zone' broadcasts to the event's zone;
  -- scope='player' sends only to the triggering player. When a route is set for
  -- an event, it takes precedence over any hardcoded fallback in the plugin.
  CREATE TABLE IF NOT EXISTS audio_event_routes (
    id TEXT PRIMARY KEY,
    event_name TEXT NOT NULL,
    sfx_id TEXT,
    ambient_id TEXT,
    song_id TEXT,
    scope TEXT NOT NULL DEFAULT 'zone',
    enabled INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS idx_audio_event_routes_event_name ON audio_event_routes(event_name);

  -- SNES-style sample playback. base64 audio data stored in the DB; the data
  -- column is intentionally excluded from the standard list GET — fetch it via
  -- GET /audio/samples/:id/data. snes_rate and snes_bits control the BRR-like
  -- downsampling + bit-crush applied in the browser at load time.
  CREATE TABLE IF NOT EXISTS audio_samples (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    category   TEXT DEFAULT 'misc',
    priority   INTEGER DEFAULT 5,
    data       TEXT,
    mime_type  TEXT DEFAULT 'audio/mpeg',
    base_note  INTEGER DEFAULT 60,
    loop_start REAL DEFAULT 0,
    loop_end   REAL DEFAULT 0,
    snes_rate  INTEGER DEFAULT 16000,
    snes_bits  INTEGER DEFAULT 4,
    echo_mix   REAL DEFAULT 0,
    config     JSONB DEFAULT '{}',
    enabled    INTEGER DEFAULT 1
  );

  ALTER TABLE audio_instruments ADD COLUMN IF NOT EXISTS sample_id TEXT REFERENCES audio_samples(id);
  ALTER TABLE audio_event_routes ADD COLUMN IF NOT EXISTS sample_id TEXT REFERENCES audio_samples(id);

  -- ── Email verification ───────────────────────────────────────────────────────
  ALTER TABLE players ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false;
  CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    player_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    token      TEXT NOT NULL UNIQUE,
    expires_at BIGINT NOT NULL,
    used       BOOLEAN NOT NULL DEFAULT FALSE
  );
  CREATE INDEX IF NOT EXISTS idx_evt_token ON email_verification_tokens(token);

  -- ── Scavenging system ────────────────────────────────────────────────────────
  -- A scavenging_tables row is a reusable *template*: a named loot pool with a
  -- replenish cadence and optional per-table message overrides. A zone opts in via
  -- zones.flags.scavenging_table_id. Depletion/replenish is tracked PER-ZONE (see
  -- scavenging_zone_stock / scavenging_zone_state), so the same template can be
  -- shared across many zones without them sharing a stock pool.
  -- messages: nullable JSONB { "player": [...], "broadcast": [...] } — empty/absent
  -- keys fall back to the plugin's built-in default pools.
  CREATE TABLE IF NOT EXISTS scavenging_tables (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    replenish_interval_seconds INTEGER NOT NULL DEFAULT 300,
    messages JSONB DEFAULT '{}',
    flags JSONB DEFAULT '{}'
  );

  -- Template loot entries. difficulty plays the role of an opposing skill in the
  -- 2d8-2d8 scavenging check; weight biases both the per-attempt pick and the
  -- replenish pick; max_qty caps how much of this item a zone can hold.
  CREATE TABLE IF NOT EXISTS scavenging_table_items (
    id TEXT PRIMARY KEY,
    table_id TEXT NOT NULL REFERENCES scavenging_tables(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL,
    difficulty INTEGER NOT NULL DEFAULT 5,
    weight INTEGER NOT NULL DEFAULT 10,
    max_qty INTEGER NOT NULL DEFAULT 3
  );
  CREATE INDEX IF NOT EXISTS idx_scav_items_table ON scavenging_table_items(table_id);

  -- Per-zone live stock. One row per (zone, item); current_qty is the remaining
  -- count a scavenger can still pull. Initialised to the template's max_qty the
  -- first time a zone is scavenged.
  CREATE TABLE IF NOT EXISTS scavenging_zone_stock (
    zone_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    current_qty INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (zone_id, item_id)
  );

  -- Per-zone replenish clock. last_replenish is the epoch-seconds anchor the lazy
  -- catch-up computation advances from (one table per zone via zones.flags).
  CREATE TABLE IF NOT EXISTS scavenging_zone_state (
    zone_id TEXT PRIMARY KEY,
    table_id TEXT NOT NULL,
    last_replenish BIGINT NOT NULL DEFAULT 0
  );

  -- ── GameTable (poker / card games) ──────────────────────────────────────────
  -- One row per physical table. config stores table rules; state stores the full
  -- serialized in-progress hand (seats, hands, community cards, pot, phase, etc.).
  -- All mutable game state lives in the JSONB blob — no per-action DB writes;
  -- persisted at hand end, on player leave, and on the 10-second recovery tick.
  CREATE TABLE IF NOT EXISTS game_tables (
    id          TEXT PRIMARY KEY,
    zone_id     TEXT NOT NULL,
    name        TEXT NOT NULL,
    game_type   TEXT NOT NULL DEFAULT 'holdem',
    config      JSONB NOT NULL DEFAULT '{}',
    state       JSONB NOT NULL DEFAULT '{}',
    phase       TEXT NOT NULL DEFAULT 'WaitingForPlayers',
    updated_at  TIMESTAMPTZ DEFAULT NOW()
  );

  -- Organizations (corps). One unified table: NPC factions are owner-less rows
  -- (is_npc=1); player crews have an owner. Player reputation continues to key
  -- off orgs.id via player_faction_rep.faction_id (ids preserved by the fold).
  CREATE TABLE IF NOT EXISTS orgs (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    color       TEXT DEFAULT '#888888',
    is_npc      INTEGER NOT NULL DEFAULT 0,   -- 1 = owner-less NPC faction
    owner_id    TEXT,                          -- player id; NULL for NPC factions
    treasury    INTEGER NOT NULL DEFAULT 0,    -- carried credits held by the org
    founded_at  BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
    flags       JSONB NOT NULL DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS idx_orgs_owner ON orgs(owner_id);

  -- Custom ranks per corp. permissions is an integer bitmask (see org-perms.js).
  CREATE TABLE IF NOT EXISTS org_ranks (
    id          TEXT PRIMARY KEY,
    org_id      TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    rank_order  INTEGER NOT NULL DEFAULT 0,    -- higher = more senior
    permissions INTEGER NOT NULL DEFAULT 0,    -- bitmask
    is_default  INTEGER NOT NULL DEFAULT 0     -- auto-assigned to new joiners
  );
  CREATE INDEX IF NOT EXISTS idx_org_ranks_org ON org_ranks(org_id);

  CREATE TABLE IF NOT EXISTS org_members (
    org_id    TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    player_id TEXT NOT NULL,
    rank_id   TEXT NOT NULL REFERENCES org_ranks(id),
    joined_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
    PRIMARY KEY (org_id, player_id)
  );
  CREATE INDEX IF NOT EXISTS idx_org_members_player ON org_members(player_id);

  -- Inter-org stances (receives folded hostile_to/friendly_to). No Phase 0 runtime reader.
  CREATE TABLE IF NOT EXISTS org_relations (
    org_id       TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    other_org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    stance       TEXT NOT NULL,   -- 'hostile' | 'friendly'
    PRIMARY KEY (org_id, other_org_id)
  );

  -- HQ reuses the apartment ownership substrate. owner_type defaults 'player' so
  -- every existing apartment row is unchanged; an org HQ sets owner_type='org'.
  ALTER TABLE apartments ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'player';
  ALTER TABLE apartments ADD COLUMN IF NOT EXISTS owner_org_id TEXT REFERENCES orgs(id) ON DELETE SET NULL;

  -- Territory control (Phase 1). One controller per zone with a 0..100 grip
  -- (influence); a challenger erodes it and takes the zone when it hits 0. Income
  -- and upkeep flow to/from the controller's treasury on the 24h tick.
  CREATE TABLE IF NOT EXISTS zone_control (
    zone_id           TEXT PRIMARY KEY REFERENCES zones(id) ON DELETE CASCADE,
    org_id            TEXT REFERENCES orgs(id) ON DELETE SET NULL,   -- controller; NULL = uncontrolled
    influence         INTEGER NOT NULL DEFAULT 50,                   -- controller's grip 0..100
    challenger_org_id TEXT REFERENCES orgs(id) ON DELETE SET NULL,   -- top contester
    base_income       INTEGER NOT NULL DEFAULT 100,                  -- credits/day to the controller
    base_upkeep       INTEGER NOT NULL DEFAULT 40,                   -- credits/day cost to hold
    captured_at       BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
  );
  CREATE INDEX IF NOT EXISTS idx_zone_control_org ON zone_control(org_id);

  -- ── Jail system (jail plugin) ──────────────────────────────────────────────
  -- Runtime tables: schema is exported, rows are not. Written by plugins/jail.
  -- A jailed player's legal gear is snapshotted into held_items (JSONB array of
  -- player_inventory rows) and returned when the guard releases them; contraband
  -- goes to police_evidence instead. On-hand cash is emptied at booking into
  -- held_credits and returned (minus the fine) at release. release_at is the
  -- timed-release deadline.
  CREATE TABLE IF NOT EXISTS jail_prisoners (
    player_id   TEXT PRIMARY KEY,
    cell_zone   TEXT NOT NULL,
    release_zone TEXT NOT NULL,
    release_at  TIMESTAMPTZ NOT NULL,
    stars       INTEGER NOT NULL DEFAULT 1,
    held_items  JSONB NOT NULL DEFAULT '[]',
    held_credits INTEGER NOT NULL DEFAULT 0,
    fine        INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ALTER TABLE jail_prisoners ADD COLUMN IF NOT EXISTS held_credits INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE jail_prisoners ADD COLUMN IF NOT EXISTS fine INTEGER NOT NULL DEFAULT 0;

  -- Global police evidence locker: confiscated contraband (weapons/drugs/hacking
  -- gear). Capped at 50 rows (oldest evicted on insert); the whole locker purges
  -- rows older than 3 days on a timer. No reclaim path — this is a graveyard.
  CREATE TABLE IF NOT EXISTS police_evidence (
    id          TEXT PRIMARY KEY,
    item_id     TEXT NOT NULL,
    quantity    INTEGER NOT NULL DEFAULT 1,
    condition   REAL NOT NULL DEFAULT 1.0,
    custom_data JSONB NOT NULL DEFAULT '{}',
    source_handle TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_police_evidence_time ON police_evidence(created_at ASC);

  -- ── Flight system (flight plugin, docs/systems-flight.md) ──────────────────
  -- aircraft_types is CONTENT: one row per craft template (ultralight, scout
  -- heli, bush plane…), read by the flight plugin, editable via seed/dev panel.
  -- Never hardcode these into engine files.
  CREATE TABLE IF NOT EXISTS aircraft_types (
    id                 TEXT PRIMARY KEY,
    name               TEXT NOT NULL,
    class              TEXT NOT NULL DEFAULT 'heli',   -- ultralight|heli|prop|heavy|gunship|wreck
    takeoff_mode       TEXT NOT NULL DEFAULT 'vtol',   -- vtol|stol|strip
    seats              INTEGER NOT NULL DEFAULT 1,
    cargo_capacity     INTEGER NOT NULL DEFAULT 0,
    max_takeoff_weight INTEGER NOT NULL DEFAULT 300,
    fuel_capacity      REAL    NOT NULL DEFAULT 40,
    fuel_burn_base     REAL    NOT NULL DEFAULT 1.0,   -- base drain per tile at full throttle
    fuel_type          TEXT    NOT NULL DEFAULT 'avgas',
    altitude_ceiling   INTEGER NOT NULL DEFAULT 2,     -- 1 low | 2 cruise | 3 high
    cruise_speed       REAL    NOT NULL DEFAULT 1,     -- tiles/tick at full throttle
    handling           REAL    NOT NULL DEFAULT 0,     -- piloting-difficulty modifier
    hull_hp            INTEGER NOT NULL DEFAULT 20,
    hardpoints         INTEGER NOT NULL DEFAULT 0,
    noise              INTEGER NOT NULL DEFAULT 2,
    price_buy          INTEGER NOT NULL DEFAULT 0,
    price_rent_hourly  INTEGER NOT NULL DEFAULT 0,
    engines            INTEGER NOT NULL DEFAULT 1,     -- powerplant count (per-engine gauges + run-up)
    data               JSONB   NOT NULL DEFAULT '{}'
  );
  ALTER TABLE aircraft_types ADD COLUMN IF NOT EXISTS engines INTEGER NOT NULL DEFAULT 1;

  -- aircraft is RUNTIME state: one row per physical craft in the world. Schema is
  -- exported, rows are not (production-owned, like generators/atm_units). The
  -- aircraft owns its occupant set at runtime (in-memory, mirroring live-zone
  -- membership) -- there is deliberately NO cabin zones row; being aboard is
  -- player state and the cabin is synthesized. parked_zone_id is null when airborne.
  CREATE TABLE IF NOT EXISTS aircraft (
    id            TEXT PRIMARY KEY,
    type_id       TEXT NOT NULL REFERENCES aircraft_types(id),
    name          TEXT,                                 -- tail number / owner name
    owner_id      TEXT,                                 -- player id; null = rental/unowned stock
    corp_id       TEXT,
    map_id        TEXT NOT NULL DEFAULT 'map_world',
    grid_x        INTEGER,
    grid_y        INTEGER,
    altitude_band TEXT    NOT NULL DEFAULT 'ground',    -- ground|low|cruise|high
    heading       TEXT    NOT NULL DEFAULT 'n',
    parked_zone_id TEXT,
    fuel          REAL    NOT NULL DEFAULT 0,
    throttle      INTEGER NOT NULL DEFAULT 0,
    engine_temp   REAL    NOT NULL DEFAULT 20,
    damage        REAL    NOT NULL DEFAULT 0,           -- 0 pristine .. 1 destroyed
    airborne      INTEGER NOT NULL DEFAULT 0,
    engine_on     INTEGER NOT NULL DEFAULT 0,
    is_wreck      INTEGER NOT NULL DEFAULT 0,
    rental        INTEGER NOT NULL DEFAULT 0,           -- rental stock returns to its home field
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_aircraft_parked ON aircraft(parked_zone_id);
  CREATE INDEX IF NOT EXISTS idx_aircraft_owner ON aircraft(owner_id);
  -- Phase B–D additions: weapons state, per-instance customization (tune/parts/
  -- livery in custom_data), and which hangar (if any) the craft is secured in.
  ALTER TABLE aircraft ADD COLUMN IF NOT EXISTS weapons_hot INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE aircraft ADD COLUMN IF NOT EXISTS custom_data JSONB NOT NULL DEFAULT '{}';
  ALTER TABLE aircraft ADD COLUMN IF NOT EXISTS hangar_id TEXT;
  ALTER TABLE aircraft ADD COLUMN IF NOT EXISTS insured INTEGER NOT NULL DEFAULT 0;

  -- Cargo/passenger contracts (flight contracts.js). A row is a live job: open
  -- on a board, then accepted (bound to a player + craft) and flown origin→dest.
  CREATE TABLE IF NOT EXISTS flight_contracts (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL DEFAULT 'cargo',   -- cargo | passenger
    origin_zone TEXT NOT NULL,                   -- airfield zone id
    dest_zone   TEXT NOT NULL,                   -- airfield zone id
    cargo_name  TEXT NOT NULL,                   -- what's being hauled / who
    item_id     TEXT,                            -- optional real item delivered
    weight      INTEGER NOT NULL DEFAULT 40,
    payout      INTEGER NOT NULL DEFAULT 100,
    risk        INTEGER NOT NULL DEFAULT 1,      -- 1..5
    contraband  INTEGER NOT NULL DEFAULT 0,      -- must fly dark (transponder off)
    status      TEXT NOT NULL DEFAULT 'open',    -- open | active | delivered | failed
    player_id   TEXT,
    aircraft_id TEXT,
    accepted_at BIGINT,
    deadline_s  INTEGER NOT NULL DEFAULT 1800,   -- seconds after accept to deliver
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ALTER TABLE flight_contracts ADD COLUMN IF NOT EXISTS job_type TEXT;   -- authored job flavour (freight/medevac/smuggle/exfil/…)
  CREATE INDEX IF NOT EXISTS idx_flight_contracts_origin ON flight_contracts(origin_zone, status);
  CREATE INDEX IF NOT EXISTS idx_flight_contracts_player ON flight_contracts(player_id, status);

  -- Ground anti-aircraft emplacements (flight combat.js). Fire on low/slow craft
  -- overflying within range. CONTENT: seeded, editable.
  CREATE TABLE IF NOT EXISTS aa_sites (
    id        TEXT PRIMARY KEY,
    zone_id   TEXT NOT NULL,                     -- surface cell it sits on (map_world)
    name      TEXT NOT NULL,
    range     INTEGER NOT NULL DEFAULT 1,        -- tiles
    damage    REAL NOT NULL DEFAULT 0.2,         -- hull fraction per hit
    accuracy  INTEGER NOT NULL DEFAULT 6,        -- opposing value in the piloting evade check
    faction   TEXT,
    active    INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS idx_aa_sites_zone ON aa_sites(zone_id);

  -- Hangars (flight hangars.js) — ownable/rentable secure storage at a field.
  -- Reuses the rent cadence idea from apartments; a stored aircraft is safe.
  CREATE TABLE IF NOT EXISTS hangars (
    id            TEXT PRIMARY KEY,
    field_zone    TEXT NOT NULL,                 -- airfield zone id
    name          TEXT NOT NULL,
    owner_id      TEXT,
    owner_org_id  TEXT,
    rent_paid_until BIGINT,
    rent_per_period INTEGER NOT NULL DEFAULT 200,
    tier          INTEGER NOT NULL DEFAULT 1,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_hangars_field ON hangars(field_zone);
  CREATE INDEX IF NOT EXISTS idx_hangars_owner ON hangars(owner_id);
`;

export async function applySchema() {
  await query(SCHEMA_SQL);
  console.log('✓ Schema applied (Postgres)');
}

// Only auto-run when invoked directly (npm run db:schema), not when imported.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  applySchema()
    .then(() => process.exit(0))
    .catch(e => { console.error(e); process.exit(1); });
}
