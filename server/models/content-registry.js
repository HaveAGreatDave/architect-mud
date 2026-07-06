// Content registry — the SINGLE source of truth for what every table in
// SCHEMA_SQL *is*. Every table must appear here exactly once, classified as:
//
//   'content' — authored world data. Owned by git (content/<table>/<pk>.json);
//               exported/imported/deployed by the content pipeline; read-only on
//               production (CONTENT_READONLY gate). Entries carry:
//                 pk             — primary-key column(s); drives file naming and
//                                  ON CONFLICT upserts. Must match SCHEMA_SQL.
//                 where          — SQL predicate selecting the *content* rows of a
//                                  table that also holds runtime rows (e.g. NPC
//                                  factions vs player crews). Rows outside the
//                                  predicate are never exported or deleted.
//                 excludeColumns — columns the ENGINE mutates during normal play
//                                  (verified UPDATE sites, 2026-07-06 census).
//                                  Never exported to files; never touched by an
//                                  import's ON CONFLICT DO UPDATE.
//                 runtimeInserts — note naming gameplay code that INSERTs rows into
//                                  this table at runtime (2026-07-06 census). Those
//                                  rows have no files; the pipeline's git-diff-driven
//                                  deletes can never touch them (deletion requires a
//                                  file to have existed in git).
//   'runtime' — world state regenerated or accumulated at play time. Schema-only in
//               every dump/export; rows never leave the DB they were born in.
//   'player'  — player-owned rows (accounts, inventory, tokens…). Same handling as
//               runtime, called out separately so PII is auditable at a glance.
//
// ORDER of the content entries is FK-safe insertion order — the importer and every
// dump walk it top-to-bottom. When adding a table, place it after everything it
// references. (The media_broadcasts↔media_channels cycle and the two self-
// referential FKs are DEFERRABLE — see schema.js — and every consumer wraps writes
// in one transaction with SET CONSTRAINTS ALL DEFERRED.)
//
// The regress harness (tests/regress.js layer 1a) asserts: every CREATE TABLE in
// SCHEMA_SQL is classified here exactly once, and every pk / excludeColumns entry
// names a real column of its table. Adding a table without classifying it — or
// misspelling a column — is a red build, not a silent data-loss bug.

export const REGISTRY = [
  // ── content: audio (must precede zones: zones.audio_theme_id → audio_songs;
  //    samples first: audio_instruments/audio_event_routes.sample_id → audio_samples) ──
  { table: 'audio_samples', class: 'content', pk: ['id'] },
  { table: 'audio_songs', class: 'content', pk: ['id'] },
  { table: 'audio_instruments', class: 'content', pk: ['id'] },
  { table: 'audio_sfx', class: 'content', pk: ['id'] },
  { table: 'audio_ambient', class: 'content', pk: ['id'] },
  { table: 'audio_event_routes', class: 'content', pk: ['id'] },

  // ── content: world structure ──
  { table: 'zones', class: 'content', pk: ['id'],
    excludeColumns: ['stains'], // bodily.js — blood/vomit, cleared daily
    runtimeInserts: 'environment.js power/junction rooms; broadcast studio builder (dev-gated)',
    note: 'exits/tags are authored content but runtime systems may also wire them (power rooms, studios) — a known, drift-report-visible seam' },
  { table: 'maps', class: 'content', pk: ['id'],
    runtimeInserts: 'environment.js power-room interiors; broadcast studio builder (dev-gated)' },
  { table: 'items', class: 'content', pk: ['id'],
    runtimeInserts: 'doors.js keycard cutting; surveillance crafted gear; broadcast recorded tapes' },
  { table: 'enemies', class: 'content', pk: ['id'] },
  { table: 'zone_spawns', class: 'content', pk: ['id'] },
  { table: 'npcs', class: 'content', pk: ['id'],
    // zone_id: wander/work moves NPCs (home_zone is the authored home).
    // vendor_*: sales balances + auto-managed shelf (vendor_inventory is the authored catalog).
    excludeColumns: ['zone_id', 'vendor_credits', 'vendor_stock', 'vendor_bank_credits'] },
  { table: 'furniture', class: 'content', pk: ['id'],
    // light_on/light_on_intended: power system + player toggles; hp: damage/repair.
    excludeColumns: ['light_on', 'light_on_intended', 'hp'],
    runtimeInserts: 'furniture-shop.js purchases; corps HQ furnishing; surveillance planted devices; posters; generator plugin; environment.js junction boxes' },
  { table: 'doors', class: 'content', pk: ['id'],
    // is_open/lock_state: player+NPC actions; hp: destructible; forcefield_locked: apartment guard.
    // tags stays CONTENT (authored locks/keycards) even though player lock kits also
    // mutate it at runtime — an import that touches a door file reverts player-installed
    // locks on that door. Known seam; surfaced by the drift report.
    excludeColumns: ['is_open', 'lock_state', 'hp', 'forcefield_locked'] },
  { table: 'windows', class: 'content', pk: ['id'] },
  { table: 'sounds', class: 'content', pk: ['id'] },
  { table: 'interface_sfx', class: 'content', pk: ['id'] },
  { table: 'global_ambient_events', class: 'content', pk: ['id'] },

  // ── content: loot / crafting / progression ──
  { table: 'loot_tables', class: 'content', pk: ['id'] },
  { table: 'recipes', class: 'content', pk: ['id'] },
  { table: 'drugs', class: 'content', pk: ['id'] },
  { table: 'mutations', class: 'content', pk: ['id'] },
  { table: 'combat_config', class: 'content', pk: ['key'] },
  { table: 'command_aliases', class: 'content', pk: ['alias'] },
  { table: 'crimes', class: 'content', pk: ['id'] },

  // ── content: housing / power / climate ──
  { table: 'apartments', class: 'content', pk: ['zone_id'],
    // Only personal apartments are content; corp HQs (owner_type='org') reference a
    // player-crew org that isn't exported, which would break a restore's FK.
    where: "owner_type = 'player'",
    // Tenancy state — renting (apartments.js) upserts these on authored units.
    // rent_cost / lock_difficulty / building_name are authored and stay.
    excludeColumns: ['owner_id', 'owner_handle', 'is_locked', 'purchased_at', 'date_rented', 'rent_due_date'],
    runtimeInserts: 'apartments.js renting (upsert); corps plugin org HQs (outside predicate)' },
  { table: 'generators', class: 'content', pk: ['id'],
    excludeColumns: ['status', 'fuel_remaining', 'remaining_kw'], // power tick burns fuel / allocates
    runtimeInserts: 'environment.js city/junction autobuild; generator plugin player-placed units' },
  { table: 'power_zones', class: 'content', pk: ['id'],
    excludeColumns: ['status', 'available_kw', 'current_load_kw'], // recomputed every power cycle
    runtimeInserts: 'environment.js autobuild; broadcast studio builder (dev-gated)' },
  { table: 'climate_profiles', class: 'content', pk: ['id'],
    runtimeInserts: 'environment.js seeds a default profile on first boot if missing' },

  // ── content: scripting / quests / factions ──
  { table: 'scripts', class: 'content', pk: ['id'] },
  { table: 'npc_banter_threads', class: 'content', pk: ['id'] },
  { table: 'quests', class: 'content', pk: ['id'] },
  { table: 'job_boards', class: 'content', pk: ['id'] },
  // NPC factions live in the unified orgs table (is_npc=1); player crews are runtime.
  { table: 'orgs', class: 'content', pk: ['id'], where: 'is_npc = 1',
    runtimeInserts: 'corps plugin creates player crews (outside predicate)' },
  { table: 'org_relations', class: 'content', pk: ['org_id', 'other_org_id'],
    where: 'org_id IN (SELECT id FROM orgs WHERE is_npc = 1)' },

  // ── content: scavenging / security / finance / flight ──
  { table: 'scavenging_tables', class: 'content', pk: ['id'] },
  { table: 'scavenging_table_items', class: 'content', pk: ['id'] },
  // NPC-police surveillance backbone only; player-planted nets/devices are runtime.
  { table: 'security_networks', class: 'content', pk: ['id'], where: 'is_police = 1',
    runtimeInserts: 'surveillance plugin player networks (outside predicate)' },
  { table: 'security_devices', class: 'content', pk: ['id'],
    where: 'network_id IN (SELECT id FROM security_networks WHERE is_police = 1)',
    runtimeInserts: 'surveillance plugin player devices (outside predicate)' },
  { table: 'atm_networks', class: 'content', pk: ['id'] },
  { table: 'aircraft_types', class: 'content', pk: ['id'] },
  { table: 'aa_sites', class: 'content', pk: ['id'] },

  // ── content: broadcast / media (themes first: channels.theme_id → media_themes;
  //    broadcasts↔channels cycle rides deferred constraints; deck/playlist/cameras last) ──
  { table: 'media_themes', class: 'content', pk: ['id'] },
  { table: 'media_broadcasts', class: 'content', pk: ['id'] },
  { table: 'media_channels', class: 'content', pk: ['id'] },
  { table: 'media_deck_units', class: 'content', pk: ['id'] },
  { table: 'media_channel_playlist', class: 'content', pk: ['id'] },
  { table: 'media_cameras', class: 'content', pk: ['id'],
    excludeColumns: ['recording_buffer', 'is_recording', 'is_streaming'] }, // live camera state
  { table: 'media_graphics', class: 'content', pk: ['id'] },

  // ── player: accounts + per-player state (PII lives here — never exported) ──
  { table: 'players', class: 'player' },
  { table: 'player_skills', class: 'player' },
  { table: 'player_inventory', class: 'player' },
  { table: 'player_faction_rep', class: 'player' },
  { table: 'player_corpses', class: 'player' },
  { table: 'player_deaths', class: 'player' },
  { table: 'player_drug_state', class: 'player' },
  { table: 'player_mutations', class: 'player' },
  { table: 'player_flags', class: 'player' },
  { table: 'player_quests', class: 'player' },
  { table: 'insurance_policies', class: 'player' },  // Halcyon Assurance — bought policies
  { table: 'insurance_claims', class: 'player' },    // …and filed claims
  { table: 'org_ranks', class: 'player' },           // player-crew org structure
  { table: 'org_members', class: 'player' },
  { table: 'sports_bets', class: 'player' },
  { table: 'password_reset_tokens', class: 'player' },
  { table: 'email_verification_tokens', class: 'player' },

  // ── runtime: world state regenerated / accumulated at play time ──
  { table: 'world_events', class: 'runtime' },
  { table: 'world_clock', class: 'runtime' },
  { table: 'world_flags', class: 'runtime' },
  { table: 'weather_forecast', class: 'runtime' },
  { table: 'lighting_states', class: 'runtime' },    // fully derived from furniture
  { table: 'zone_control', class: 'runtime' },
  { table: 'scavenging_zone_stock', class: 'runtime' },
  { table: 'scavenging_zone_state', class: 'runtime' },
  { table: 'security_clips', class: 'runtime' },
  { table: 'atm_units', class: 'runtime' },          // auto-created per ATM furniture
  { table: 'game_tables', class: 'runtime' },
  { table: 'hangars', class: 'runtime' },
  { table: 'aircraft', class: 'runtime' },
  { table: 'flight_contracts', class: 'runtime' },
  { table: 'smuggle_orders', class: 'runtime' },
  { table: 'sports_season', class: 'runtime' },      // generated, never authored
  { table: 'sports_standings', class: 'runtime' },
  { table: 'sports_results', class: 'runtime' },
  { table: 'jail_prisoners', class: 'runtime' },
  { table: 'police_evidence', class: 'runtime' },
  { table: 'staged_changes', class: 'runtime' },     // dev-panel staging queue
  { table: 'deployments', class: 'runtime' },
  { table: 'server_settings', class: 'runtime' },    // holds content_pipeline.last_imported_sha
  { table: 'channel_messages', class: 'runtime' },
  { table: 'server_activity_log', class: 'runtime' },
  { table: 'player_count_log', class: 'runtime' },
  { table: 'dev_notes', class: 'runtime' },
  { table: 'dev_identities', class: 'runtime' },
  { table: 'dev_commits', class: 'runtime' },
];

// ── Derived views (legacy shapes — consumers keep working unchanged) ─────────

// FK-safe export list: string, or { table, where } for filtered subsets.
export const CONTENT_TABLES = REGISTRY
  .filter(e => e.class === 'content')
  .map(e => (e.where ? { table: e.table, where: e.where } : e.table));

// The deliberately-not-dumped other half of the partition (player + runtime).
export const EXCLUDED_TABLES = REGISTRY
  .filter(e => e.class !== 'content')
  .map(e => e.table);

// Subset tag of the content entries — NOT a second master list. These six carry
// base64 sample blobs + giant tracker JSON (~92% of a dump's bytes); export-seed
// splits them into db/audio-seed.sql so world diffs stay readable.
export const AUDIO_TABLES = [
  'audio_samples', 'audio_songs', 'audio_instruments', 'audio_sfx', 'audio_ambient', 'audio_event_routes',
];

// Full content entries (pk/where/excludeColumns), in FK-safe order — the shape the
// content pipeline (scripts/content/*) consumes.
export function contentEntries() {
  return REGISTRY.filter(e => e.class === 'content');
}
