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
//                 readTier       — where the table's rows live at RUNTIME (the read
//                                  side; see docs/architecture.md → Read Tiers).
//                                  Required on every content entry; regress layer 1a
//                                  fails a content table that hasn't decided this:
//                                    'boot'  — loaded into memory at boot, reloaded on
//                                              dev edit (world.js Maps, module caches,
//                                              plugin write-through caches)
//                                    'ttl'   — TTL cache (dev CRUD invalidates; TTL
//                                              bounds out-of-band writers)
//                                    'cold'  — query-fresh, but only on rare paths
//                                              (per-craft, per-interaction, dev panel);
//                                              caching wouldn't pay for itself
//                                    'fresh' — deliberately query-fresh on gameplay
//                                              paths: writers are uncoordinated, so a
//                                              cache would go stale (build the write
//                                              funnel before promoting to 'boot')
//                                    'dead'  — zero runtime readers
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
  // All six audio tables live in the audio plugin's boot caches (loadAudioLibrary,
  // refreshed on CRUD). The audio_samples.data blob is deliberately NOT cached —
  // served on demand per client (disk in prod, DB in dev).
  { table: 'audio_samples', class: 'content', pk: ['id'], readTier: 'boot' },
  { table: 'audio_songs', class: 'content', pk: ['id'], readTier: 'boot' },
  { table: 'audio_instruments', class: 'content', pk: ['id'], readTier: 'boot' },
  { table: 'audio_sfx', class: 'content', pk: ['id'], readTier: 'boot' },
  { table: 'audio_ambient', class: 'content', pk: ['id'], readTier: 'boot' },
  { table: 'audio_event_routes', class: 'content', pk: ['id'], readTier: 'boot' },

  // ── content: world structure ──
  { table: 'zones', class: 'content', pk: ['id'], readTier: 'boot',
    // stains: blood/vomit — accumulates in RAM (world.zones); the DB column is only
    // ever bulk-cleared by the daily maintenance tick (gameLoop.js), never written rich.
    excludeColumns: ['stains'],
    runtimeInserts: 'environment.js power/junction rooms; broadcast studio builder (dev-gated)',
    note: 'exits/tags are authored content but runtime systems may also wire them (power rooms, studios) — a known, drift-report-visible seam' },
  { table: 'maps', class: 'content', pk: ['id'], readTier: 'boot',
    runtimeInserts: 'environment.js power-room interiors; broadcast studio builder (dev-gated)' },
  // Spatial district metadata (dev-panel World Editor). Member zones link via
  // flags.district_id; bounds derived from members, not stored. Dev-panel-read
  // only — no runtime hot-path reader. Distinct from engine/districts.js land-use.
  { table: 'districts', class: 'content', pk: ['id'], readTier: 'cold' },
  { table: 'items', class: 'content', pk: ['id'], readTier: 'boot', // items-cache.js write-through Map
    runtimeInserts: 'doors.js keycard cutting (keycard_<door>); surveillance evidence datachips (item_datachip_<clip>, reaped on submission/retention); broadcast recorded cassettes (item_cassette_<slug>)' },
  { table: 'enemies', class: 'content', pk: ['id'], readTier: 'boot' },      // via world.spawnTimers join
  { table: 'zone_spawns', class: 'content', pk: ['id'], readTier: 'boot' },  // via world.spawnTimers join
  { table: 'npcs', class: 'content', pk: ['id'], readTier: 'boot', // world.npcs + write funnel (updateNpc/syncNpc in world.js)
    // zone_id: wander/work moves NPCs (home_zone is the authored home).
    // vendor_*: sales balances + auto-managed shelf (vendor_inventory is the authored catalog).
    excludeColumns: ['zone_id', 'vendor_credits', 'vendor_stock', 'vendor_bank_credits'],
    // Runtime ALSO mutates these AUTHORED columns (2026-07-15 census) — they stay
    // content because they carry authored initial state; churn shows in exports:
    //   hp (gameLoop save tick), home_zone (apartments eviction/relocation),
    //   flags.poker_bankroll (gametable), behaviour_graph/work_zone_id/name/description
    //   (broadcast studio staffing self-heal). dialogue_tree is authoring-only.
    note: 'runtime-mutated authored columns: hp, home_zone, flags.poker_bankroll, behaviour_graph, work_zone_id, name, description' },
  { table: 'furniture', class: 'content', pk: ['id'], readTier: 'boot', // world.furniture + write funnel (insertFurniture/updateFurniture/deleteFurniture in world.js)
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
  { table: 'doors', class: 'content', pk: ['id'], readTier: 'boot',
    // is_open/lock_state/is_locked/hp/tags are CONTENT: they carry authored initial
    // state (a vault ships locked; lock_state defaults to NULL = disengaged, which a
    // fresh restore must not inflict on every authored lock), read once into
    // world.doors at boot. Runtime NEVER writes these back — all live door state
    // (open/close/lock/bash/wander/forcefield) mutates the in-memory cache only, so
    // doors reset to authored state on reboot and exports show no runtime churn.
    // Durable apartment locks are re-derived from apartments.is_locked at boot
    // (reconcileApartmentDoorLocks). forcefield_locked is a purely ephemeral runtime
    // guard, never authored — excluded so it's never carried in files.
    excludeColumns: ['forcefield_locked'] },
  { table: 'windows', class: 'content', pk: ['id'], readTier: 'boot', // environment.js state.windows, reloaded on dev edit
    // curtain_open/glass_state are runtime-mutated (environment.js) but carry
    // authored initial state, so they stay content.
    note: 'runtime-mutated authored columns: curtain_open, glass_state' },
  // sounds is near-dead: only the dev-panel CRUD reads it — the sound engine
  // (propagateSound et al.) takes literal loudness/message values, never this table.
  { table: 'sounds', class: 'content', pk: ['id'], readTier: 'cold' },
  { table: 'interface_sfx', class: 'content', pk: ['id'], readTier: 'cold' }, // served per client connect, not per gameplay tick
  { table: 'global_ambient_events', class: 'content', pk: ['id'], readTier: 'boot' },

  // ── content: loot / crafting / progression ──
  // loot_tables has zero runtime readers — loot resolves from enemies.loot_table JSONB.
  { table: 'loot_tables', class: 'content', pk: ['id'], readTier: 'dead' },
  { table: 'recipes', class: 'content', pk: ['id'], readTier: 'boot' },        // RECIPE_CACHE (crafting.js)
  { table: 'drugs', class: 'content', pk: ['id'], readTier: 'boot' },          // DRUG_CACHE (drugs.js)
  { table: 'mutations', class: 'content', pk: ['id'], readTier: 'boot' },      // MUTATION_CACHE (mutations.js)
  { table: 'augments', class: 'content', pk: ['id'], readTier: 'boot' },       // AUGMENT_CACHE (plugins/augments)
  { table: 'combat_config', class: 'content', pk: ['key'], readTier: 'boot' }, // tunables.js
  { table: 'command_aliases', class: 'content', pk: ['alias'], readTier: 'boot' }, // aliases.js
  { table: 'crimes', class: 'content', pk: ['id'], readTier: 'boot' },         // crimes.js

  // ── content: housing / power / climate ──
  { table: 'apartments', class: 'content', pk: ['zone_id'], readTier: 'boot', // world.apartments
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
  { table: 'npc_residences', class: 'content', pk: ['zone_id'], readTier: 'cold' },
  // generators/power_zones: the power sim re-queries both every cycle and rewrites
  // them — derived per-zone status lives in environment state, never a table cache.
  { table: 'generators', class: 'content', pk: ['id'], readTier: 'fresh',
    // status/remaining_kw: recomputed every power cycle (self-healing). fuel_remaining
    // stays CONTENT: schema default is 0, so excluding it restores every authored
    // generator dead. Burn-tick churn shows in exports as reviewable diffs.
    excludeColumns: ['status', 'remaining_kw'],
    runtimeInserts: 'environment.js city/junction autobuild; generator plugin player-placed units' },
  { table: 'power_zones', class: 'content', pk: ['id'], readTier: 'fresh',
    excludeColumns: ['status', 'available_kw', 'current_load_kw'], // recomputed every power cycle
    runtimeInserts: 'environment.js autobuild; broadcast studio builder (dev-gated)' },
  { table: 'climate_profiles', class: 'content', pk: ['id'], readTier: 'boot', // active profile loaded at env boot
    runtimeInserts: 'environment.js seeds a default profile on first boot if missing' },

  // ── content: scripting / quests / factions ──
  { table: 'scripts', class: 'content', pk: ['id'], readTier: 'cold' },              // one row per graph run
  { table: 'npc_banter_threads', class: 'content', pk: ['id'], readTier: 'boot' },   // loadBanterLibrary
  { table: 'ambient_routines', class: 'content', pk: ['id'], readTier: 'boot' },     // ambient-life plugin cache
  { table: 'quests', class: 'content', pk: ['id'], readTier: 'ttl', // plugins/quests 30s definition cache
    runtimeInserts: 'flight contract board (plugins/flight/contracts.js) generates/prunes quest_type=flight rows (id quest_flight_<8-hex>) from the authored quest_flight_* templates; also UPDATEs rewards/meta on accept' },
  { table: 'job_boards', class: 'content', pk: ['id'], readTier: 'cold' }, // per board interaction; quest-id set has its own 60s TTL
  // NPC factions live in the unified orgs table (is_npc=1); player crews are runtime.
  { table: 'orgs', class: 'content', pk: ['id'], where: 'is_npc = 1', readTier: 'boot', // world.orgs
    runtimeInserts: 'corps plugin creates player crews (outside predicate)' },
  { table: 'org_relations', class: 'content', pk: ['org_id', 'other_org_id'],
    where: 'org_id IN (SELECT id FROM orgs WHERE is_npc = 1)', readTier: 'cold' },

  // ── content: scavenging / security / finance / flight ──
  { table: 'scavenging_tables', class: 'content', pk: ['id'], readTier: 'cold' },       // per scavenge/fish/mine action
  { table: 'scavenging_table_items', class: 'content', pk: ['id'], readTier: 'cold' },
  // NPC-police surveillance backbone only; player-planted nets/devices are runtime.
  { table: 'security_networks', class: 'content', pk: ['id'], where: 'is_police = 1', readTier: 'fresh',
    runtimeInserts: 'surveillance plugin player networks (outside predicate)' },
  { table: 'security_devices', class: 'content', pk: ['id'], readTier: 'fresh', // runtime-mutated, read live on movement/tick paths
    where: 'network_id IN (SELECT id FROM security_networks WHERE is_police = 1)',
    runtimeInserts: 'surveillance plugin player devices (outside predicate)' },
  { table: 'atm_networks', class: 'content', pk: ['id'], readTier: 'cold' },   // per ATM interaction
  { table: 'aircraft_types', class: 'content', pk: ['id'], readTier: 'cold' }, // per flight operation
  { table: 'aa_sites', class: 'content', pk: ['id'], readTier: 'fresh', // firing path honors the live `active` toggle
    // active is toggled at runtime (shot down: flight/combat.js; engineer repair:
    // aa-sites plugin) but carries authored initial state, so it stays content.
    note: 'runtime-mutated authored column: active' },

  // ── content: broadcast / media (themes first: channels.theme_id → media_themes;
  //    broadcasts↔channels cycle rides deferred constraints; deck/playlist/cameras last) ──
  // media_* readTier 'boot' = the broadcast plugin's channelRuntime/graphics caches,
  // rebuilt at boot and after every mutation; the 1 Hz tick reads memory only.
  { table: 'media_themes', class: 'content', pk: ['id'], readTier: 'boot' },
  // bc_clip_* rows are runtime artifacts (surveillance datachips loaded into decks,
  // minted by broadcast ensureClipBroadcast, reaped on evidence submission / 3-day
  // retention) — never exported, never deleted by the pipeline. Runtime also toggles
  // tags.cassette_ejected on authored broadcasts (export churn, accepted).
  { table: 'media_broadcasts', class: 'content', pk: ['id'], readTier: 'boot',
    where: "id NOT LIKE 'bc_clip_%'",
    runtimeInserts: 'broadcast ensureClipBroadcast mints bc_clip_* rows (outside predicate); surveillance reaps them' },
  { table: 'media_channels', class: 'content', pk: ['id'], readTier: 'boot' },
  // DEAD SCHEMA: zero readers/writers anywhere — deck state actually lives in
  // furniture.flags (deck_cassettes, pirate_*, channel_id). Candidate for removal.
  { table: 'media_deck_units', class: 'content', pk: ['id'], readTier: 'dead' },
  // Cassette eject DELETEs a channel's slots for that broadcast (stashed into
  // furniture.flags.deck_ejected_slots) and re-INSERTs them on reload — authored
  // slot rows can be legitimately absent from a live DB while a tape is ejected.
  { table: 'media_channel_playlist', class: 'content', pk: ['id'], readTier: 'boot',
    runtimeInserts: 'broadcast cassette load re-INSERTs slots stashed at eject' },
  { table: 'media_cameras', class: 'content', pk: ['id'], readTier: 'boot', // roster cached in channelRuntime; live recording_buffer ops hit the DB fresh
    // streaming_channel_id is also runtime-written (CAMERA_STREAM action) but stays
    // content: it carries the authored studio-camera binding.
    excludeColumns: ['recording_buffer', 'is_recording', 'is_streaming'] }, // live camera state
  { table: 'media_graphics', class: 'content', pk: ['id'], readTier: 'boot' }, // graphicsCache

  // ── player: accounts + per-player state (PII lives here — never exported) ──
  { table: 'players', class: 'player' },
  { table: 'player_skills', class: 'player' },
  { table: 'player_inventory', class: 'player' },
  { table: 'player_ideology_rep', class: 'player' },
  { table: 'player_corpses', class: 'player' },
  { table: 'player_deaths', class: 'player' },
  { table: 'player_drug_state', class: 'player' },
  { table: 'player_mutations', class: 'player' },
  { table: 'player_augments', class: 'player' },     // installed cybernetics (plugins/augments)
  { table: 'player_backups', class: 'player' },      // cortical-backup snapshots + prepaid restores (plugins/augments)
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
