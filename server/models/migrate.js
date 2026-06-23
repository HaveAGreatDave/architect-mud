import { fileURLToPath } from 'url';
import { query } from './db.js';
import { migrateEnvironment } from './migrate.environment.js';

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
    -- Migrate legacy is_light flag to object_type if the column still exists.
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='furniture' AND column_name='is_light') THEN
        UPDATE furniture SET object_type='light' WHERE is_light=1 AND object_type='furniture';
        ALTER TABLE furniture DROP COLUMN is_light;
      END IF;
    END $$;

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
    ALTER TABLE windows ADD COLUMN IF NOT EXISTS handle TEXT;

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

  // Stamina + body temperature columns
  await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS stamina INTEGER DEFAULT 100`);
  await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS stamina_max INTEGER DEFAULT 100`);
  await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS body_temp_c REAL DEFAULT 37.0`);

  // Phase 0 — combat rework schema additions (all idempotent)
  await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS stat_brawn INTEGER DEFAULT 0`);
  await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS stat_reflexes INTEGER DEFAULT 0`);
  await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS stat_endurance INTEGER DEFAULT 0`);
  await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS stat_brains INTEGER DEFAULT 0`);
  await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS stat_senses INTEGER DEFAULT 0`);
  await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS stat_cool INTEGER DEFAULT 0`);
  await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS ip REAL DEFAULT 0`);
  await query(`ALTER TABLE player_skills ADD COLUMN IF NOT EXISTS trained REAL DEFAULT 0`);
  await query(`ALTER TABLE enemies ADD COLUMN IF NOT EXISTS defense INTEGER DEFAULT 0`);
  await query(`ALTER TABLE enemies ADD COLUMN IF NOT EXISTS soak JSONB DEFAULT '{}'`);

  // 2d8 combat rework: monsters use simplified hit/dodge, a typed multi-component
  // weapon, and per-part body_parts (each with its own typed soak).
  await query(`ALTER TABLE enemies ADD COLUMN IF NOT EXISTS hit INTEGER DEFAULT 1`);
  await query(`ALTER TABLE enemies ADD COLUMN IF NOT EXISTS dodge INTEGER DEFAULT 1`);
  await query(`ALTER TABLE enemies ADD COLUMN IF NOT EXISTS weapon JSONB DEFAULT '[]'`);
  await query(`ALTER TABLE enemies ADD COLUMN IF NOT EXISTS body_parts JSONB DEFAULT '[]'`);

  // Player baseline: every stat starts at (at least) 1, and health is a flat 40.
  // GREATEST leaves already-raised stats untouched; the HP update only catches
  // characters still on the old 100-HP default so it won't clobber future tuning.
  await query(`
    UPDATE players SET
      stat_brawn = GREATEST(stat_brawn, 1),
      stat_reflexes = GREATEST(stat_reflexes, 1),
      stat_endurance = GREATEST(stat_endurance, 1),
      stat_brains = GREATEST(stat_brains, 1),
      stat_senses = GREATEST(stat_senses, 1),
      stat_cool = GREATEST(stat_cool, 1)
  `);
  await query(`UPDATE players SET hp_max = 40, hp = LEAST(hp, 40) WHERE hp_max = 100`);
  await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS offline_sleeping BOOLEAN DEFAULT FALSE`);
  await query(`
    CREATE TABLE IF NOT EXISTS combat_config (
      key TEXT PRIMARY KEY,
      value JSONB,
      label TEXT,
      category TEXT
    )
  `);

  console.log('✓ Database migrated (Postgres)');

  await migrateItemTags();
  console.log('✓ Item tags migrated');

  await migrateEnvironment(query);
  console.log('✓ Environment tables migrated');

  await query(`
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
  `);
  console.log('✓ Staging tables migrated');

  // Starter clothing — ensure shoes exist and all three starter items have gets_wet.
  await query(`
    INSERT INTO items (id, name, weight, value, rarity, tags)
    VALUES ('item_basic_shoes', 'Basic Shoes', 0.6, 2, 'common',
      '{"description":"Canvas sneakers, well broken-in. The left sole is starting to peel.","slot":"feet","armor":1,"insulation":3,"gets_wet":true}'::jsonb)
    ON CONFLICT (id) DO NOTHING
  `);
  await query(`
    UPDATE items SET
      tags = tags || '{"gets_wet":true,"auto_equip":true}'::jsonb,
      name = CASE id
        WHEN 'item_basic_shirt' THEN 'Basic T-Shirt'
        ELSE name
      END
    WHERE id IN ('item_basic_shirt','item_basic_pants','item_basic_shoes')
  `);
  console.log('✓ Starter clothing migrated');

  await seedAmbientEvents();
  await seedWeatherAmbients();
  console.log('✓ Ambient events seeded');
}

async function seedWeatherAmbients() {
  // Idempotent: skip if weather themes already exist.
  const { rows: wRows } = await query("SELECT COUNT(*) FROM global_ambient_events WHERE theme LIKE 'weather_%'");
  if (parseInt(wRows[0].count) === 0) {
    const weatherEvents = [
      // Rain — wet, rhythmic, draining
      ['weather_rain', 'Rain hammers the street in shifting curtains.',1.2,100],
      ['weather_rain', 'Water rushes through a clogged gutter somewhere nearby.',0.8,90],
      ['weather_rain', 'The rain intensifies briefly, then eases back.',1.0,100],
      ['weather_rain', 'Rainwater streams off an overhang in a heavy silver sheet.',0.8,90],
      ['weather_rain', 'Puddles spread across the pavement, joining and dividing.',0.5,80],
      ['weather_rain', 'A drain somewhere gurgles as it struggles to keep up.',0.8,90],
      ['weather_rain', 'The smell of wet concrete and rust hangs in the air.',0.3,70],

      // Sleet — nastier than rain, sharp and miserable
      ['weather_sleet', 'Ice pellets ping off metal surfaces in erratic bursts.',1.0,100],
      ['weather_sleet', 'Sleet hisses against every hard surface.',1.0,100],
      ['weather_sleet', 'The ground is treacherous — a thin skim of ice over everything.',0.5,80],
      ['weather_sleet', 'A bitter wind drives the sleet sideways.',1.2,90],
      ['weather_sleet', 'Sleet taps against every surface like bad static.',0.8,90],

      // Thunderstorm — dramatic, loud, violent
      ['weather_thunderstorm', 'Thunder rolls across the sky, close enough to feel.',3.0,100],
      ['weather_thunderstorm', 'Lightning strobes through the clouds, throwing everything into sharp relief.',1.5,100],
      ['weather_thunderstorm', 'A crack of thunder shakes the air — that one was close.',3.5,90],
      ['weather_thunderstorm', 'Rain hammers everything flat.',2.0,100],
      ['weather_thunderstorm', 'Lightning hits something nearby with a sharp crack and a flash.',3.0,80],
      ['weather_thunderstorm', 'Thunder rolls through in a long, grinding wave.',3.0,90],
      ['weather_thunderstorm', 'The storm flares white for a second, and for a moment everything casts a shadow.',1.5,80],

      // Storm — structural, dangerous
      ['weather_storm', 'Wind screams between the buildings, finding every gap.',2.5,100],
      ['weather_storm', 'Something large gets picked up by the wind and slams into a wall.',3.0,90],
      ['weather_storm', 'A sheet of corrugated metal tears loose somewhere and clatters away.',2.5,80],
      ['weather_storm', 'The wind drops for a second, then slams back twice as hard.',2.0,90],
      ['weather_storm', 'Debris skitters across the ground in sudden, sharp rushes.',1.5,90],
      ['weather_storm', 'A sign rips free overhead and vanishes into the dark.',2.0,80],
      ['weather_storm', 'The wind makes the structures groan.',1.5,90],

      // Snow — muffled, heavy, slow
      ['weather_snow', 'Snow falls in thick, slow flakes. Everything goes quiet.',0.5,100],
      ['weather_snow', 'A heavy drift slides off a roof somewhere above and hits the ground.',1.5,90],
      ['weather_snow', 'Snow muffles the city into something almost peaceful. Almost.',0.3,80],
      ['weather_snow', 'Footprints in the snow nearby, filling in fast.',0.5,80],
      ['weather_snow', 'Somewhere, a structure groans under the weight of accumulation.',1.2,80],
      ['weather_snow', 'Snow hisses softly against every surface.',0.5,90],

      // Blizzard — hostile, obliterating
      ['weather_blizzard', 'The blizzard whips snow into a horizontal wall of white.',2.5,100],
      ['weather_blizzard', 'Wind howls through every gap and crevice.',2.5,100],
      ['weather_blizzard', 'Visibility is nearly nothing. You\'re navigating by feel.',0.5,80],
      ['weather_blizzard', 'The cold cuts straight through everything.',0.5,80],
      ['weather_blizzard', 'Drifts are forming fast — in an hour this will be impassable.',0.5,80],
      ['weather_blizzard', 'A gust hits like a wall. It takes effort to stay upright.',2.0,90],

      // Fog — eerie, muffled
      ['weather_fog', 'Sound carries strangely in the fog — distant things seem close.',0.8,100],
      ['weather_fog', 'The fog is thick enough to taste.',0.3,100],
      ['weather_fog', 'Shapes in the fog resolve into buildings only when you\'re almost on top of them.',0.3,80],
      ['weather_fog', 'A foghorn sounds somewhere in the grey — direction impossible to pin.',2.5,80],
      ['weather_fog', 'Moisture condenses on every surface. Everything drips slowly.',0.5,90],
      ['weather_fog', 'Footsteps you can\'t see echo from somewhere in the fog.',1.0,80],

      // Haze — chemical, oppressive
      ['weather_haze', 'The air tastes like metal and chemicals.',0.3,100],
      ['weather_haze', 'Your eyes water. It\'s been worse before, but not by much.',0.3,100],
      ['weather_haze', 'The haze gives everything a sickly orange tint.',0.3,80],
      ['weather_haze', 'Breathing feels faintly wrong, like the air is slightly off.',0.3,90],
      ['weather_haze', 'The horizon has vanished into a flat brown smear.',0.3,80],

      // Ash — post-disaster, choking
      ['weather_ash', 'Ash drifts down like grey snow, coating every surface.',0.5,100],
      ['weather_ash', 'The air smells of sulfur and something burnt — organic, maybe.',0.3,100],
      ['weather_ash', 'Ash settles on your skin. It\'s fine and dry and smells wrong.',0.3,90],
      ['weather_ash', 'A thick layer of ash muffles footsteps, coats the ground grey.',0.5,90],
      ['weather_ash', 'Something is still burning, somewhere upwind.',1.0,80],
      ['weather_ash', 'The sky is the color of a dead monitor.',0.3,80],
    ];

    for (const [theme, message, loudness, weight] of weatherEvents) {
      await query(
        'INSERT INTO global_ambient_events (id, theme, message, loudness, weight, enabled) VALUES (gen_random_uuid()::text, $1, $2, $3, $4, 1)',
        [theme, message, loudness, weight]
      ).catch(() => {});
    }
  }

  // Backfill: exterior zones that still have the default 'indoors' theme get 'city'.
  // Interior zones (is_interior flag) are left alone.
  await query(`
    UPDATE zones
    SET ambient_theme = 'city'
    WHERE ambient_theme = 'indoors'
      AND COALESCE((flags->>'is_interior')::boolean, false) = false
      AND map_id IS NULL
  `).catch(() => {});

  // Any zone with a street light gets the city ambient theme.
  await query(`
    UPDATE zones
    SET ambient_theme = 'city'
    WHERE id IN (SELECT DISTINCT zone_id FROM furniture WHERE light_type = 'streetlight')
      AND ambient_theme != 'city'
  `).catch(() => {});
}

// Collapse all item *behavior* into the single `tags` JSONB column. Adds the
// column, backfills it from the legacy columns (idempotent — only touches rows
// whose tags are still '{}'), and relaxes the now-optional NOT NULLs so the
// API can stop sending description/type. The 7 behavioral columns are dropped
// in a separate, later commit once the engine + panel are verified.
async function migrateItemTags() {
  await query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '{}'`);
  await query(`ALTER TABLE items ALTER COLUMN description DROP NOT NULL`).catch(() => {});
  await query(`ALTER TABLE items ALTER COLUMN type DROP NOT NULL`).catch(() => {});

  const { rows } = await query(`SELECT * FROM items WHERE tags = '{}'::jsonb`);
  for (const r of rows) {
    const tags = buildTagsFromLegacyItem(r);
    if (!Object.keys(tags).length) continue;
    await query(`UPDATE items SET tags = $1 WHERE id = $2`, [JSON.stringify(tags), r.id]);
  }
  if (rows.length) console.log(`  · backfilled tags for ${rows.length} item(s)`);
}

function buildTagsFromLegacyItem(r) {
  const tags = {};
  if (r.description) tags.description = r.description;

  // type markers (armor-ness is carried by slot + the armor int, not a marker)
  const typeMarker = { weapon: 'weapon', consumable: 'consumable', drug: 'drug',
    material: 'material', currency: 'currency', misc: 'misc' }[r.type];
  if (typeMarker) tags[typeMarker] = true;

  // subtype hooks
  if (r.subtype === 'food') tags.well_fed = true;
  if (r.subtype === 'drink') tags.hydrating = true;
  if (r.type === 'weapon' && ['blunt', 'bladed', 'energy'].includes(r.subtype)) {
    tags.weapon_skill = r.subtype;
  }

  if (r.is_stackable) tags.stackable = true;
  if (r.is_quest_item) tags.quest_item = true;
  if (r.is_unique) tags.unique = true;

  const fx = r.effects || {};
  if (fx.armor != null) tags.armor = fx.armor;
  if (fx.damage_min != null || fx.damage_max != null) {
    tags.damage = { min: fx.damage_min ?? 0, max: fx.damage_max ?? 0 };
  }
  if (fx.status_chance) tags.status_chance = fx.status_chance;
  if (fx.hp != null) tags.restore_hp = fx.hp;
  if (fx.hunger != null) tags.restore_hunger = fx.hunger;
  if (fx.thirst != null) tags.restore_thirst = fx.thirst;
  if (fx.radiation != null) tags.restore_radiation = fx.radiation;
  if (fx.sanity != null) tags.restore_sanity = fx.sanity;
  if (fx.credits != null) tags.grants_credits = fx.credits;
  if (fx.hp_over_time) tags.heal_over_time = fx.hp_over_time;

  // slot — copy from flags; make the weapon fallback explicit
  const flags = r.flags || {};
  if (flags.slot) tags.slot = flags.slot;
  else if (r.type === 'weapon') tags.slot = 'weapon_hand';

  const reqs = r.requirements || {};
  if (Object.keys(reqs).length) tags.requires = reqs;
  const mods = r.stat_modifiers || {};
  if (Object.keys(mods).length) tags.stat_bonus = mods;

  return tags;
}

async function seedAmbientEvents() {
  const { rows } = await query('SELECT COUNT(*) FROM global_ambient_events');
  if (parseInt(rows[0].count) > 0) return; // already seeded

  const events = [
    // Outdoors — low loudness, heard locally
    ['outdoors','A cool breeze brushes past.',1.0,100],
    ['outdoors','Leaves rustle softly nearby.',0.8,100],
    ['outdoors','A crow caws somewhere overhead.',1.2,120],
    ['outdoors','The wind shifts, carrying the smell of smoke from somewhere distant.',1.0,80],
    ['outdoors','Something skitters through the underbrush nearby.',0.8,90],
    ['outdoors','A distant dog barks twice and goes quiet.',1.5,80],
    ['outdoors','The sky above is the color of a bruise.',0.5,60],
    ['outdoors','A gust of wind sends litter skidding across the ground.',1.0,90],
    ['outdoors','You hear something mechanical grinding, far away.',1.5,70],
    ['outdoors','The silence stretches long enough to feel deliberate.',0.5,60],
    ['outdoors','A bird takes flight nearby, wings beating hard.',1.0,80],

    // City — medium loudness, urban feel
    ['city','A distant siren briefly echoes across the city.',2.5,100],
    ['city','You hear traffic somewhere far away.',1.5,100],
    ['city','A door slams shut in a nearby building.',2.0,110],
    ['city','Someone shouts in the distance, then falls silent.',2.0,90],
    ['city','A car horn blares several blocks away.',2.5,90],
    ['city','Glass breaks somewhere nearby. No one reacts.',2.0,80],
    ['city','A helicopter passes overhead, searchlight sweeping.',2.5,70],
    ['city','Music thumps from a building somewhere above.',1.5,80],
    ['city','You can hear the hiss of a pressurized something releasing nearby.',1.5,70],
    ['city','Somewhere close, someone is arguing in a language you don\'t recognize.',2.0,80],
    ['city','A burst of static from a radio or speaker crackles nearby.',1.5,90],
    ['city','The smell of fried food drifts from somewhere you can\'t see.',0.5,60],
    ['city','A trash can gets knocked over somewhere out of sight.',2.0,80],

    // Indoors — quiet, claustrophobic
    ['indoors','The building settles with a quiet creak.',0.8,100],
    ['indoors','Somewhere nearby, something metallic clatters before falling silent.',1.2,100],
    ['indoors','You hear muffled footsteps from another room.',1.0,110],
    ['indoors','An old ventilation fan hums softly.',0.5,100],
    ['indoors','A faint drip echoes somewhere out of sight.',0.5,90],
    ['indoors','The fluorescent lights buzz and flicker briefly.',0.5,80],
    ['indoors','A door opens and closes somewhere above you.',1.2,80],
    ['indoors','You catch a brief, sharp smell — antiseptic or chemicals.',0.3,60],
    ['indoors','Pipes in the wall groan and tick as something moves through them.',0.8,90],
    ['indoors','A phone rings distantly and isn\'t answered.',1.0,70],
    ['indoors','Something scurries behind the walls.',0.8,100],
    ['indoors','A distant hum that you can feel more than hear.',0.3,70],

    // Industrial — machinery, heavy
    ['industrial','Heavy machinery drones somewhere beyond the walls.',2.0,100],
    ['industrial','A pressure valve releases with a sharp hiss.',2.5,90],
    ['industrial','Metal impacts metal — a rhythmic hammering from deeper inside.',2.0,100],
    ['industrial','Something large shifts overhead. Structural, probably.',1.5,80],
    ['industrial','Sparks cascade briefly from a junction box across the room.',1.0,80],
    ['industrial','A conveyor belt squeals and then stops.',1.5,70],
    ['industrial','Coolant or fluid drips from overhead piping into a spreading puddle.',0.8,80],
    ['industrial','Warning lights pulse orange through a distant corridor.',0.5,70],
    ['industrial','An alarm sounds briefly, three notes, then cuts off.',3.0,60],
    ['industrial','You can feel vibration in the floor from something enormous running below.',0.5,80],

    // Underground — eerie, geological
    ['underground','Water drips in the darkness ahead.',0.5,100],
    ['underground','The walls carry a low rumble — the surface world, distant.',0.8,90],
    ['underground','Something shifts in the rock above. The ceiling holds.',1.0,80],
    ['underground','A colony of insects moves somewhere nearby, just out of sight.',0.5,90],
    ['underground','Your own breathing sounds too loud down here.',0.3,70],
    ['underground','The air pressure shifts, as if something large moved far away.',0.5,80],
    ['underground','A slow grinding noise rolls through the stone, then fades.',1.5,70],
    ['underground','The darkness ahead seems to shift, though you can\'t tell why.',0.3,60],
    ['underground','Something brushes past overhead in the dark — wings, maybe.',1.0,80],
    ['underground','The smell changes: mineral, damp, old.',0.3,70],

    // Waterfront — wet, industrial, open
    ['waterfront','Waves lap against something nearby.',0.8,100],
    ['waterfront','A buoy bell clanks irregularly with the water.',1.2,90],
    ['waterfront','Seabirds argue somewhere overhead.',1.5,80],
    ['waterfront','A foghorn sounds in the distance — long and hollow.',3.0,80],
    ['waterfront','The smell of salt and diesel drifts past.',0.3,70],
    ['waterfront','A chain drags across concrete somewhere nearby.',1.5,80],
    ['waterfront','A boat engine starts up and idles, then throttles away.',2.5,70],
    ['waterfront','Something large surfaces briefly in the water nearby and sinks.',1.0,60],
    ['waterfront','Cargo shifts in a container somewhere close with a dull boom.',2.0,70],

    // Forest — quiet, organic
    ['forest','A branch snaps somewhere in the treeline.',1.5,100],
    ['forest','Birds fall quiet all at once. Then, slowly, start again.',0.5,80],
    ['forest','The undergrowth moves nearby. Too large for a small animal.',1.5,90],
    ['forest','Wind moves through the canopy above like a long exhale.',0.8,100],
    ['forest','Something calls from deeper in — it doesn\'t sound like any animal you know.',1.5,70],
    ['forest','An insect lands on you and is gone before you can look.',0.3,70],
    ['forest','Leaves overhead filter the light into shifting patterns.',0.3,60],
    ['forest','The forest has a smell here: rot and growth, inseparable.',0.3,60],
    ['forest','Something large watches from the treeline. You can\'t prove it.',0.5,70],

    // Ruins — desolate, post-collapse
    ['ruins','A section of ceiling crumbles nearby, raining dust.',1.5,100],
    ['ruins','Wind moves through collapsed walls with a low moan.',1.0,100],
    ['ruins','Old newspaper or debris skitters across the floor.',0.8,90],
    ['ruins','A structure somewhere close shifts and settles.',2.0,80],
    ['ruins','The floor is uneven here — evidence of something that happened below.',0.3,70],
    ['ruins','Broken glass grinds underfoot somewhere nearby.',1.0,80],
    ['ruins','Exposed rebar has rusted into the color of dried blood.',0.3,60],
    ['ruins','Something has been nesting here. Whatever it was, it left recently.',0.5,70],
    ['ruins','Graffiti covers the walls in multiple layers. The oldest is illegible.',0.3,60],

    // Commercial — shops, malls, service areas
    ['commercial','A PA system crackles somewhere — no words, just static.',1.5,90],
    ['commercial','Muzak leaks from a vent above. The song is unidentifiable and wrong.',0.8,80],
    ['commercial','A security camera tracks slowly across the space.',0.3,70],
    ['commercial','Automatic doors open and close for no one somewhere nearby.',1.5,80],
    ['commercial','A cash register drawer slides open and shut.',1.0,70],
    ['commercial','Refrigeration units hum behind locked staff doors.',0.5,80],
    ['commercial','Something on a shelf falls over. Nothing else moves.',1.2,90],
    ['commercial','The floor wax is cracked here. No one has maintained this in a while.',0.3,60],

    // Residential — human scale, intimate
    ['residential','Someone coughs in a nearby unit.',0.8,100],
    ['residential','A TV plays through a wall — voices, then laughter, then silence.',1.0,100],
    ['residential','A baby cries briefly and is hushed.',1.2,90],
    ['residential','Cooking smells drift under a door somewhere close.',0.3,70],
    ['residential','Upstairs, someone paces back and forth.',0.8,90],
    ['residential','A toilet flushes in a nearby unit.',1.0,80],
    ['residential','An argument bleeds through the walls — low, tense, unresolved.',1.0,80],
    ['residential','A dog scratches at a door and whines quietly.',0.8,80],
    ['residential','Keys jangle outside. Whoever it was, they moved on.',1.0,70],
    ['residential','The building\'s heating ticks and pops as temperature shifts.',0.5,80],
  ];

  for (const [theme, message, loudness, weight] of events) {
    await query(
      'INSERT INTO global_ambient_events (id, theme, message, loudness, weight, enabled) VALUES (gen_random_uuid()::text, $1, $2, $3, $4, 1)',
      [theme, message, loudness, weight]
    ).catch(() => {}); // skip on duplicate/error
  }

  // Backfill: interior maps that have no entry_zone_id set — find the zone at
  // grid 0,0,0 in that map (where apiLinkInterior always places the entry zone)
  // and record it so the validator and unplaced-tray queries can use it.
  await query(`
    UPDATE maps m
    SET entry_zone_id = z.id
    FROM zones z
    WHERE m.entry_zone_id IS NULL
      AND m.parent_zone_id IS NOT NULL
      AND z.map_id = m.id
      AND z.grid_x = 0 AND z.grid_y = 0 AND COALESCE(z.grid_z, 0) = 0
  `).catch(() => {});

  // Rename plural light object names to singular (e.g. "Street Lights" → "Street Light").
  await query(`
    UPDATE furniture SET name = REGEXP_REPLACE(name, E'\\mLights\\M', 'Light', 'gi')
    WHERE object_type = 'light' AND name ~* E'\\mLights\\M'
  `).catch(() => {});

  // Cleanup: strip is_building / is_interior / world_exit_zone from any zone
  // that has those flags but is NOT the actual entry zone of an interior map it
  // belongs to. Covers zones with map_id=NULL, zones on exterior maps, and zones
  // pointed at by dirty maps rows where entry_zone_id doesn't match map_id.
  await query(`
    UPDATE zones z
    SET flags = z.flags - 'is_building' - 'is_interior' - 'world_exit_zone'
    WHERE (
      COALESCE((z.flags->>'is_building')::boolean, false) = true
      OR COALESCE((z.flags->>'is_interior')::boolean, false) = true
    )
    AND NOT EXISTS (
      SELECT 1 FROM maps m
      WHERE m.entry_zone_id = z.id
        AND m.parent_zone_id IS NOT NULL
        AND z.map_id = m.id
    )
  `).catch(() => {});

  // Backfill: any zone that is the entry_zone_id of an interior map AND is
  // actually assigned to that map (z.map_id = m.id) gets is_building:true and
  // world_exit_zone. The z.map_id = m.id guard prevents dirty maps rows (where
  // entry_zone_id points to a zone that lives on a different map) from
  // incorrectly stamping building flags onto exterior zones.
  await query(`
    UPDATE zones z
    SET flags = COALESCE(z.flags, '{}'::jsonb)
      || '{"is_building": true}'::jsonb
      || jsonb_build_object('world_exit_zone', m.parent_zone_id)
    FROM maps m
    WHERE m.entry_zone_id = z.id
      AND m.parent_zone_id IS NOT NULL
      AND z.map_id = m.id
      AND (z.flags->>'world_exit_zone' IS NULL
        OR COALESCE((z.flags->>'is_building')::boolean, false) = false)
  `).catch(() => {});
}

// Only auto-run when invoked directly (npm run db:migrate), not when imported.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  migrate().catch(e => { console.error(e); process.exit(1); });
}
