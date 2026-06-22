// server/models/migrate.environment.js
//
// Schema for the Environmental Systems feature (time / weather / power / lighting).
//
// Call this from inside the existing migrate() in server/models/migrate.js:
//
//   import { migrateEnvironment } from './migrate.environment.js';
//   ...
//   await migrateEnvironment(query);
//
// Every statement is idempotent (CREATE TABLE IF NOT EXISTS / ON CONFLICT DO
// NOTHING), matching the rest of this codebase, so re-running it against an
// already-migrated database is always safe.

export async function migrateEnvironment(query) {
  await query(`
    CREATE TABLE IF NOT EXISTS world_clock (
      id INTEGER PRIMARY KEY DEFAULT 1,
      game_date DATE NOT NULL DEFAULT CURRENT_DATE,
      game_time_minutes INTEGER NOT NULL DEFAULT 480,
      day_of_week INTEGER NOT NULL DEFAULT 1,
      season TEXT NOT NULL DEFAULT 'spring',
      last_tick_30m TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_tick_24h TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT world_clock_singleton CHECK (id = 1)
    )
  `);

  await query(`ALTER TABLE world_clock ADD COLUMN IF NOT EXISTS last_tick_1m TIMESTAMPTZ NOT NULL DEFAULT now()`);
  await query(`ALTER TABLE world_clock ADD COLUMN IF NOT EXISTS active_climate_profile_id TEXT`);

  await query(`
    CREATE TABLE IF NOT EXISTS climate_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      monthly_temp_c JSONB NOT NULL DEFAULT '[]',
      monthly_precip_chance JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS weather_forecast (
      forecast_day INTEGER PRIMARY KEY,
      game_date DATE NOT NULL,
      weather_type TEXT NOT NULL,
      temp_c INTEGER NOT NULL,
      locked INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Generators before power_zones — power_zones.generator_id references this table.
  await query(`
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
    )
  `);
  await query(`ALTER TABLE generators ADD COLUMN IF NOT EXISTS name TEXT`);
  await query(`ALTER TABLE generators ADD COLUMN IF NOT EXISTS remaining_kw REAL NOT NULL DEFAULT 0`);
  await query(`ALTER TABLE power_zones ADD COLUMN IF NOT EXISTS available_kw REAL NOT NULL DEFAULT 0`);
  await query(`ALTER TABLE power_zones ADD COLUMN IF NOT EXISTS max_capacity_kw REAL NOT NULL DEFAULT 1000`);
  // Junction boxes route city power to buildings — they don't generate their own.
  await query(`ALTER TABLE generators ADD COLUMN IF NOT EXISTS city_generator_id TEXT REFERENCES generators(id) ON DELETE SET NULL`);
  // Rename building → junction_box.
  await query(`UPDATE generators SET generator_type = 'junction_box' WHERE generator_type = 'building'`);
  // Scale kW → W (only rows still at kW scale, i.e. < 10000 — safe because
  // real values will be 100 000+ after this migration runs).
  await query(`UPDATE generators   SET capacity_kw     = capacity_kw     * 1000 WHERE capacity_kw     < 10000`);
  await query(`UPDATE power_zones  SET capacity_kw     = capacity_kw     * 1000 WHERE capacity_kw     < 10000`);
  await query(`UPDATE power_zones  SET max_capacity_kw = max_capacity_kw * 1000 WHERE max_capacity_kw < 10000`);
  await query(`UPDATE furniture    SET power_draw_kw   = power_draw_kw   * 1000 WHERE power_draw_kw IS NOT NULL AND power_draw_kw < 1000`);

  await query(`
    CREATE TABLE IF NOT EXISTS power_zones (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'city_grid',
      generator_id TEXT REFERENCES generators(id) ON DELETE SET NULL,
      capacity_kw REAL NOT NULL DEFAULT 0,
      current_load_kw REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'powered',
      flags JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS lighting_states (
      zone_id TEXT PRIMARY KEY,
      has_emergency_lighting INTEGER NOT NULL DEFAULT 0,
      artificial_light_level REAL NOT NULL DEFAULT 0,
      fixture_count INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Seed a default city grid + plant only on a fresh database (no generators
  // exist yet). Skipped on subsequent starts so manually deleted generators
  // are not resurrected on every restart.
  const { rows: existingGens } = await query('SELECT 1 FROM generators LIMIT 1');
  if (!existingGens.length) {
    await query(`
      INSERT INTO generators (id, zone_id, generator_type, capacity_kw, fuel_type, status)
      VALUES ('city_plant', NULL, 'city_plant', 500, NULL, 'online')
      ON CONFLICT (id) DO NOTHING
    `);

    await query(`
      INSERT INTO power_zones (id, name, source_type, generator_id, capacity_kw, current_load_kw, status)
      VALUES ('zone_start', 'The Threshold', 'city_grid', 'city_plant', 500, 40, 'powered')
      ON CONFLICT (id) DO NOTHING
    `);
  }
}
