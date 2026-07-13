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
//                                  ONLY self-healing or ephemeral state qualifies:
//                                  a fresh restore must be correct with the column
//                                  at its schema default (recomputed next tick,
//                                  cleared daily, rebuilt on demand…). A column
//                                  carrying AUTHORED initial state (a door that
//                                  ships locked, a generator's starting fuel, a
//                                  destructible's hp) stays CONTENT even though
//                                  runtime also mutates it — the churn shows up in
//                                  exports as reviewable git diffs, which is the
//                                  honest tradeoff. (Proven by regress: excluding
//                                  doors.lock_state shipped every authored lock
//                                  disengaged on a fresh import.)
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
    // MIXED table: origin='authored' rows are content; origin='player' rows are
    // runtime property (purchases, planted devices, posters, portable
    // generators, corp gear) — never exported, never deleted by the pipeline.
    where: "origin = 'authored'",
    // light_on/light_on_intended: self-healing — the power/day-night tick recomputes
    // them. hp stays CONTENT (no schema default; authored destructibles need it).
    // origin/owner_id: provenance columns, never carried in files (fresh
    // inserts default to 'authored', which is correct for imported content).
    excludeColumns: ['light_on', 'light_on_intended', 'origin', 'owner_id'],
    runtimeInserts: 'environment.js junction-box autobuild (kept authored: deterministic ids, converges with dev-authored fixes); origin=player writers: furniture-shop.js, corps HQ terminal, surveillance planted devices, posters, generator plugin' },
  { table: 'doors', class: 'content', pk: ['id'],
    // is_open/lock_state/is_locked/hp/tags are CONTENT: they carry authored initial
    // state (a vault ships locked; lock_state defaults to NULL = disengaged, which a
    // fresh restore must not inflict on every authored lock). Runtime also mutates
    // them (players open/lock/bash) — that churn appears in exports as reviewable
    // diffs, and an import touching a door file resets that door's live state.
    // Known seam; surfaced by the drift report. Only the apartment forcefield guard
    // is ephemeral enough to exclude.
    excludeColumns: ['forcefield_locked'] },
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
  // Which apartment units NPCs live in — authored alongside npc.home_zone. Placed
  // after npcs + zones (both FK'd). Kept in sync by the NPC create/edit/auto-house
  // endpoints and the reconcile script.
  { table: 'npc_residences', class: 'content', pk: ['zone_id'] },
  { table: 'generators', class: 'content', pk: ['id'],
    // status/remaining_kw: recomputed every power cycle (self-healing). fuel_remaining
    // stays CONTENT: schema default is 0, so excluding it restores every authored
    // generator dead. Burn-tick churn shows in exports as reviewable diffs.
    excludeColumns: ['status', 'remaining_kw'],
    runtimeInserts: 'environment.js city/junction autobuild; generator plugin player-placed units' },
  { table: 'power_zones', class: 'content', pk: ['id'],
    excludeColumns: ['status', 'available_kw', 'current_load_kw'], // recomputed every power cycle
    runtimeInserts: 'environment.js autobuild; broadcast studio builder (dev-gated)' },
  { table: 'climate_profiles', class: 'content', pk: ['id'],
    runtimeInserts: 'environment.js seeds a default profile on first boot if missing' },

  // ── content: scripting / quests / factions ──
  { table: 'scripts', class: 'content', pk: ['id'] },
  { table: 'npc_banter_threads', class: 'content', pk: ['id'] },
  { table: 'ambient_routines', class: 'content', pk: ['id'] },
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
  { table: 'bank_transactions', class: 'player' },   // Tablet OS Bank app deposit ledger
  { table: 'economy_ledger', class: 'player' },      // economy-ledger plugin — per-player credit mutations
  { table: 'insurance_policies', class: 'player' },  // Halcyon Assurance — bought policies
  { table: 'insurance_claims', class: 'player' },    // …and filed claims
  { table: 'org_ranks', class: 'player' },           // player-crew org structure
  { table: 'org_members', class: 'player' },
  { table: 'sports_bets', class: 'player' },
  { table: 'yacht_invites', class: 'player' },       // The Echelon invite list — approved players
  { table: 'password_reset_tokens', class: 'player' },
  { table: 'email_verification_tokens', class: 'player' },

  // ── runtime: world state regenerated / accumulated at play time ──
  { table: 'world_events', class: 'runtime' },
  { table: 'world_clock', class: 'runtime' },
  { table: 'world_flags', class: 'runtime' },
  { table: 'weather_forecast', class: 'runtime' },
  { table: 'lighting_states', class: 'runtime' },    // fully derived from furniture
  { table: 'zone_exit_overrides', class: 'runtime' }, // play-time exit wiring merged over authored zones.exits at load
  { table: 'economy_snapshots', class: 'runtime' },  // economy-ledger plugin — daily circulation totals
  { table: 'zone_control', class: 'runtime' },
  { table: 'org_assets', class: 'runtime' },          // player-crew territory assets (extractor/turret)
  { table: 'org_ventures', class: 'runtime' },        // player-crew Corporate Assets (owned operating businesses)
  { table: 'scavenging_zone_stock', class: 'runtime' },
  { table: 'scavenging_zone_state', class: 'runtime' },
  { table: 'security_clips', class: 'runtime' },
  { table: 'atm_units', class: 'runtime' },          // auto-created per ATM furniture
  { table: 'game_tables', class: 'runtime' },
  { table: 'hangars', class: 'runtime' },
  { table: 'aircraft', class: 'runtime' },
  { table: 'flight_contracts', class: 'runtime' },
  { table: 'cargo_drops', class: 'runtime' },
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
  { table: 'neon_usage_log', class: 'runtime' },
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

// Full content entries (pk/where/excludeColumns), in FK-safe order — the shape the
// content pipeline (scripts/content/*) consumes.
export function contentEntries() {
  return REGISTRY.filter(e => e.class === 'content');
}
