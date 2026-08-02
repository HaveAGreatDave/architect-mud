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
//                 omitWhenNull   — ABSENT-BY-DEFAULT OVERRIDE columns. The column is
//                                  authored, but only when a tile is overriding what
//                                  it would otherwise inherit (resolveDefault, see
//                                  scripts/content/derive.mjs). A null value is not a
//                                  fact worth writing down 5,785 times, so export
//                                  omits the key entirely and lint rejects a
//                                  present-but-null one. Distinct from excludeColumns:
//                                  those are runtime state the pipeline must not
//                                  touch; these ARE authored, they just default.
//                                  Import writes an explicit NULL when the key is
//                                  absent — removing an override has to clear it, or
//                                  a deleted override would linger in every DB that
//                                  ever saw it.
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
    // Absent-by-default OVERRIDES (spec §1.1). Each is a column a tile writes only
    // when it disagrees with what the build would otherwise give it:
    //   audio_theme_id — the song its region supplies (regions.defaults, §1.3)
    //   marker         — the map code deriveMarker computes (§7.4): a building's
    //                    acronym, an apartment's floor, a sewer run's corridor art
    //   color/bg_color — the fill and glyph colour the terrain palette supplies
    // color/bg_color JOINED this list on 2026-08-01. They were held off it on the
    // belief that they were the ROOM's colour identity rather than an override of a
    // derived fill — but nothing renders `zones.bg_color`, every consumer colours
    // from `spec.fill`, and what the column actually held was pre-terrain bulk fill
    // that derive discarded on 3,484 tiles. That fill is cleared and the precedence
    // is authored-first, so they are overrides like the two above and an absent key
    // is how a tile says "whatever the palette gives me".
    // See docs/proposals/tile-presentation-overrides.md.
    omitWhenNull: ['audio_theme_id', 'marker', 'color', 'bg_color'],
    runtimeInserts: 'environment.js power/junction rooms; broadcast studio builder (dev-gated)',
    note: 'exits/tags are authored content but runtime systems may also wire them (power rooms, studios) — a known, drift-report-visible seam' },
  // `parent_zone_id` is the SINGLE place a map's world anchor is decided; every
  // tile on the map carries a copy in zones.parent_zone that content:lint holds
  // to it (scripts/content/map-anchor.mjs). `name` is an override: omit it and an
  // interior map is named after the building it hangs off, so renaming the facade
  // renames the map. Only the parentless maps (map_world, Dreamzones, the
  // Leviathan cabin) have to author one — nothing can be derived for them.
  { table: 'maps', class: 'content', pk: ['id'], readTier: 'boot',
    omitWhenNull: ['name'],
    runtimeInserts: 'environment.js power-room interiors; broadcast studio builder (dev-gated)' },
  // Spatial region metadata (dev-panel World Editor). Member zones link via
  // flags.region_id; bounds derived from members, not stored. Dev-panel-read
  // only — no runtime hot-path reader. Distinct from `districts` land-use, below.
  { table: 'regions', class: 'content', pk: ['id'], readTier: 'cold' },
  // Land-use districts — the neighbourhood a tile reads as, and the mood, colour
  // and sensory pool that come with it. Member zones link via flags.district.
  // 'boot' because districtFor() is called per move, per describe and per ambience
  // beat: the registry is loaded once into memory and read synchronously from there.
  { table: 'districts', class: 'content', pk: ['id'], readTier: 'boot' },
  // Authored connections (spec §1.4) — the things grid geometry cannot say: a link
  // the grid does not imply, a link that runs one way, a WALL between two tiles
  // that touch. Contiguous walkable ground authors nothing, which is why 21,203
  // traversable edges need 271 files. After `zones`, because a/b reference it.
  //
  // name/door are omitWhenNull; the three booleans deliberately are NOT — a file
  // states all three explicitly, so flipping one back to false is an UPDATE the
  // import actually applies rather than a key it simply stops sending.
  { table: 'connections', class: 'content', pk: ['id'], readTier: 'boot',
    omitWhenNull: ['name', 'door'] },
  { table: 'items', class: 'content', pk: ['id'], readTier: 'boot', // items-cache.js write-through Map
    runtimeInserts: 'surveillance evidence datachips (item_datachip_<clip>, reaped on submission/retention); broadcast recorded cassettes (item_cassette_<slug>)' },
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
  // PLAYER data, NOT content. `apartments` is a pure tenancy ledger (owner_id/handle,
  // lock, rent dates) — who has rented what. It must NOT round-trip through git:
  // exporting it stamped ownerless "owner_type=player" phantom rows over every DB
  // (making owned units look vacant and, worse, a file deletion would DELETE real
  // player ownership on prod). Loaded into world.apartments at boot straight from the
  // DB, so it persists across restarts and returns identically — the deploy pipeline
  // never touches it. The one thing that WAS authored — per-unit rent price — moved to
  // the zone as `flags.rent_cost` (content, read via authoredRentCost); lock_difficulty
  // was vestigial (rent resets it to BASE) and building_name is derived from the zone. */
  { table: 'apartments', class: 'player' },
  // Player-owned shops (plugins/storefront) — the deed + mortgage ledger, same law
  // as apartments: exporting it would stamp phantom/ownerless deeds over prod and a
  // deleted file would wipe a real player's shop. The authored side (which units are
  // for sale, and at what price/term) is zone flags, which DO ship as content.
  { table: 'storefronts', class: 'player' },
  // Hired staff and standing buy orders hang off a player's deed and are just as
  // much player data — an exported clerk would be a phantom employee on every DB.
  { table: 'storefront_staff', class: 'player' },
  { table: 'storefront_orders', class: 'player' },
  // Kept companions on retainer (plugins/consort). Player data for the same reason
  // the deed is — and note the consort NPC herself has no `npcs` row at all: she's
  // spawned into world.npcs from this ledger, so the roster can never leak into a
  // content export the way a hired shop clerk would if it were an npcs row.
  { table: 'player_consorts', class: 'player' },
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
  { table: 'script_triggers', class: 'content', pk: ['id'], readTier: 'boot' },      // loadScriptTriggers
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
  { table: 'mis_fit_lines', class: 'content', pk: ['id'], readTier: 'boot' },           // MIS fit prose — cached in memory at boot (plugins/mis/fit-lines.js), re-read only on a dev-panel write
  // Public-domain book texts. 'cold' is load-bearing, not descriptive: these rows
  // are hundreds of KB and MUST NOT join the boot read — a deploy already pulls
  // ~36MB from Neon and that cap has been hit before. Read one chapter per page turn.
  { table: 'books', class: 'content', pk: ['id'], readTier: 'cold' },
  // The gloss layer over those books. Unlike `books` this one IS small enough to
  // cache — a few hundred one-line rows — so it loads once on first reader page
  // and is matched in memory thereafter (plugins/tablet/library-app.js).
  { table: 'glossary', class: 'content', pk: ['id'], readTier: 'boot' },
  // Dream/drug experience rooms. Cold on purpose: the read happens only when an
  // experience actually fires (inside the odds check, once per instance), never on
  // a per-tick path — so the round trip is free and there is no cache to keep
  // valid. See docs/systems-dreams.md.
  { table: 'dream_templates', class: 'content', pk: ['id'], readTier: 'cold' },
  { table: 'dream_presences', class: 'content', pk: ['id'], readTier: 'cold' },
  { table: 'dream_tethers', class: 'content', pk: ['id'], readTier: 'cold' },
  { table: 'drug_transforms', class: 'content', pk: ['id'], readTier: 'cold' },
  { table: 'drug_reactions', class: 'content', pk: ['id'], readTier: 'cold' },
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
  { table: 'player_npc_relations', class: 'player' }, // relations substrate — who a player has met and how it went; accumulated by play, never authored
  { table: 'mis_consents', class: 'player' },         // MIS per-player consent grants — one player's decision about another; never authored, never exported
  { table: 'player_quests', class: 'player' },
  { table: 'player_achievements', class: 'player' }, // record plugin — which entries a player has been observed doing
  { table: 'player_outfits', class: 'player' },      // wardrobe plugin — saved looks, per player per wardrobe
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
  // EVERYTHING THE BUILD RESOLVED (spec + props). Runtime by classification, not by
  // care: content:export never emits a runtime table, so a derived marker — or a
  // terrain-preset property — can never end up in a content file pretending somebody
  // authored it. TRUNCATEd and rebuilt by the derive pass of content:import
  // (map-pipeline-spec §2.1, §9; terrain-property-presets.md).
  { table: 'zone_derived', class: 'runtime' },
  { table: 'zone_edges', class: 'runtime' },      // generated traversal graph — grid geometry + connections (spec §2.2)
  // Trading cards (plugins/cards). Deliberately NOT content, even though the NPC
  // and enemy cards are derived from content: they are regenerated on any DB by
  // `strikeSeries()`, which is idempotent, so exporting them would commit a
  // derived artifact — and the same table holds player-minted cards, which are
  // as private as inventory. One class for one table; the strike rebuilds it.
  { table: 'cards', class: 'runtime', readTier: 'cold',
    runtimeInserts: 'cards plugin — `mint` (player) and strikeSeries() (NPC/enemy, on series open)' },
  { table: 'card_holdings', class: 'player' },   // somebody's shelf; never leaves the DB
  { table: 'script_waits', class: 'runtime' }, // parked long `wait` continuations; deleted on resume
  { table: 'world_events', class: 'runtime' },
  { table: 'void_traces', class: 'runtime' },      // voidwalking — scrawls/corpses left in the void, purged as windows rotate
  { table: 'world_clock', class: 'runtime' },
  { table: 'world_flags', class: 'runtime' },
  { table: 'weather_forecast', class: 'runtime' },
  { table: 'lighting_states', class: 'runtime' },    // fully derived from furniture
  { table: 'zone_exit_overrides', class: 'runtime' }, // play-time exit wiring merged over authored zones.exits at load
  { table: 'zone_graffiti', class: 'runtime' },       // graffiti plugin — one player-sprayed tag per street tile, ages out on its own
  { table: 'player_sprays', class: 'player' },        // graffiti plugin — a player's saved spray-can designs (the `spraycan` dialog's shelf)
  { table: 'economy_snapshots', class: 'runtime' },  // economy-ledger plugin — daily circulation totals
  { table: 'zone_control', class: 'runtime' },
  { table: 'org_assets', class: 'runtime' },          // player-crew territory assets (extractor/turret)
  { table: 'org_ventures', class: 'runtime' },        // player-crew Corporate Assets (owned operating businesses)
  { table: 'org_rackets', class: 'runtime' },         // player-crew protection rackets on NPC shops
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
