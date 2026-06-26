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
    custom_data JSONB DEFAULT '{}',
    container_id TEXT
  );
  ALTER TABLE player_inventory ADD COLUMN IF NOT EXISTS container_id TEXT;
  ALTER TABLE player_inventory ADD COLUMN IF NOT EXISTS layer INTEGER DEFAULT 1;

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

  -- Triggered sound definitions (gunshot, explosion, bark, etc.).
  -- Associated with objects/events via tags; loudness determines tile range.
  CREATE TABLE IF NOT EXISTS sounds (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'misc',
    descriptions JSONB NOT NULL DEFAULT '[]',
    loudness REAL NOT NULL DEFAULT 3.0,
    tags JSONB DEFAULT '{}',
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
  ALTER TABLE doors ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]';
  ALTER TABLE doors ADD COLUMN IF NOT EXISTS lock_state TEXT DEFAULT NULL;
  ALTER TABLE windows ADD COLUMN IF NOT EXISTS handle TEXT;

  CREATE TABLE IF NOT EXISTS doors (
    id TEXT PRIMARY KEY,
    zone_id TEXT NOT NULL,
    exit_dir TEXT NOT NULL,
    door_type TEXT DEFAULT 'basic',
    is_open INTEGER DEFAULT 0,
    is_locked INTEGER DEFAULT 0,
    hp INTEGER DEFAULT 1000,
    hp_max INTEGER DEFAULT 1000,
    hololock_difficulty INTEGER DEFAULT 5,
    flags JSONB DEFAULT '{}'
  );

  ALTER TABLE npcs ADD COLUMN IF NOT EXISTS wander_zones JSONB DEFAULT '[]';

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
  ALTER TABLE apartments ADD COLUMN IF NOT EXISTS date_rented BIGINT;
  ALTER TABLE apartments ADD COLUMN IF NOT EXISTS building_name TEXT;

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

  -- Stamina + body temperature
  ALTER TABLE players ADD COLUMN IF NOT EXISTS stamina INTEGER DEFAULT 100;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS stamina_max INTEGER DEFAULT 100;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS body_temp_c REAL DEFAULT 37.0;

  -- Combat rework stats
  ALTER TABLE players ADD COLUMN IF NOT EXISTS stat_brawn INTEGER DEFAULT 0;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS stat_reflexes INTEGER DEFAULT 0;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS stat_endurance INTEGER DEFAULT 0;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS stat_brains INTEGER DEFAULT 0;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS stat_senses INTEGER DEFAULT 0;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS stat_cool INTEGER DEFAULT 0;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS ip REAL DEFAULT 0;
  ALTER TABLE player_skills ADD COLUMN IF NOT EXISTS trained REAL DEFAULT 0;
  ALTER TABLE enemies ADD COLUMN IF NOT EXISTS defense INTEGER DEFAULT 0;
  ALTER TABLE enemies ADD COLUMN IF NOT EXISTS soak JSONB DEFAULT '{}';
  ALTER TABLE enemies ADD COLUMN IF NOT EXISTS hit INTEGER DEFAULT 1;
  ALTER TABLE enemies ADD COLUMN IF NOT EXISTS dodge INTEGER DEFAULT 1;
  ALTER TABLE enemies ADD COLUMN IF NOT EXISTS weapon JSONB DEFAULT '[]';
  ALTER TABLE enemies ADD COLUMN IF NOT EXISTS body_parts JSONB DEFAULT '[]';

  ALTER TABLE players ADD COLUMN IF NOT EXISTS offline_sleeping BOOLEAN DEFAULT FALSE;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS bank_credits INTEGER DEFAULT 0;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS origin_fragment TEXT;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS archetype TEXT;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS visibly_mutated INTEGER DEFAULT 0;

  CREATE TABLE IF NOT EXISTS combat_config (
    key TEXT PRIMARY KEY,
    value JSONB,
    label TEXT,
    category TEXT
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

  CREATE TABLE IF NOT EXISTS climate_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    monthly_temp_c JSONB NOT NULL DEFAULT '[]',
    monthly_precip_chance JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS weather_forecast (
    forecast_day INTEGER PRIMARY KEY,
    game_date DATE NOT NULL,
    weather_type TEXT NOT NULL,
    temp_c INTEGER NOT NULL,
    locked INTEGER NOT NULL DEFAULT 0
  );

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
