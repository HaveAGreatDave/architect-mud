# Findings — Content↔Engine Shape & Export-Coverage Sweep (2026-07-04)

A point-in-time sweep triggered by the `quests` bug (dialogue actions authored flat but read
nested, *and* the `quests` table silently dropped from every backup). We chased two seams the
original bug sat across:

1. **Export coverage** — `CONTENT_TABLES` in `server/api/backup.routes.js` is a hand-maintained
   allowlist; any authored content table not in it restores **empty** with no error.
2. **Content shape vs engine reader** — JSON blobs authored in the dev panel in one shape, read by
   the engine in another (flat/nested, singular/array, wrong key, wrong column).

Both are the silent class from [source-of-truth-audit.md](source-of-truth-audit.md): correct in
isolation, broken only across the seam. Findings ranked by player/designer impact. **Not yet fixed
unless noted** — this is the report, not the patch.

---

## Track 1 — Export coverage gaps (`CONTENT_TABLES`)

The allowlist omits entire authored subsystems. On a fresh restore from the git seed these come up
empty. See `server/api/backup.routes.js:18–31` for the current list.

**RESOLVED 2026-07-05 (root cause + tripwire).** The deeper cause was *two* hand-maintained
`CONTENT_TABLES` lists: `backup.routes.js` (dev-panel export, kept current by this audit) and a
second, badly-stale copy in `scripts/export-seed.mjs` — the **git-seed** path teammates actually
publish through (`content:publish`). The stale copy lacked flight (`aircraft_types`/`aa_sites`),
audio, media, security, scavenging, crimes, interface_sfx, atm_networks *and* `quests`, and ignored
the row filters (leaking player crews/apartments into the shared seed). Fixes: (1) `export-seed.mjs`
now reuses `buildDump()` — one list, one dump, for git seed + dev-panel + prod deploy alike;
(2) added `quests` to `CONTENT_TABLES`; (3) added the explicit `EXCLUDED_TABLES` half of the
partition and a **regress guard** (`tests/regress.js` layer 1a) that fails if any `SCHEMA_SQL` table
isn't classified content-or-excluded — so this class can't silently recur. **Re-run
`npm run content:publish` to regenerate `db/seed.sql` with the now-complete table set.**

| Rank | Table(s) | Symptom on fresh restore | Fix |
|---|---|---|---|
| 🔴 1 | `aircraft_types`, `aa_sites` | Declared in flight's `plugin.json` `dataSchema` but never exported — the literal quests bug. Flight unusable: `aircraft.type_id` FK dangles, no AA emplacements. | Add both |
| 🔴 2 | `media_broadcasts`, `media_channels`, `media_channel_playlist`, `media_themes`, `media_graphics`, `media_deck_units`, `media_cameras` | Entire TV/broadcast subsystem gone — no shows, no channels, blank title cards, unbound TVs. | **DONE** — all 7 added; the FK cycle handled by making the two cyclic FKs `DEFERRABLE` in `SCHEMA_SQL` + `SET CONSTRAINTS ALL DEFERRED` in the dump. The Relay deploy applies the `SCHEMA_SQL` change to prod (no separate one-shot needed). |
| 🔴 3 | `audio_instruments`, `audio_songs`, `audio_sfx`, `audio_ambient`, `audio_event_routes`, `audio_samples` | Entire procedural-audio subsystem gone; `zones.audio_theme_id` dangles. | Add all 6 (⚠ ordering) |
| 🔴 4 | `security_networks` (+ filtered `security_devices`) | NPC police surveillance backbone gone → witnessed-crime/wanted loses its seeded police nets. `security_devices` is mixed: player-planted rows are runtime, so filter to seeded/police. | Add networks; filter devices |
| 🟠 5 | `scavenging_tables`, `scavenging_table_items` | All scavenging loot templates gone → scavenging yields nothing until re-authored. | Add both |
| 🟡 6 | `interface_sfx`, `crimes`, `atm_networks` | Designer tuning silently degrades to engine defaults (minigame SFX overrides, crime→star weights, ATM fee/limit/faction config); `atm_units` reference a missing network. | Add all 3 |

**⚠ Restore-aborting ordering hazards.** The dump is one `BEGIN…COMMIT`, so a single FK violation
aborts the *entire* restore, not just one table. Naively appending these to the end of the list
breaks the restore:

- **`audio_songs` must precede `zones`** — `zones.audio_theme_id → audio_songs`. `audio_samples`
  must precede `audio_instruments`/`audio_event_routes`.
- **`media_*` has an FK cycle** (`media_channels.theme_id → media_themes`,
  `media_broadcasts.channel_id → media_channels`). Order: `media_themes` → `media_broadcasts`
  (nullable channel_id) → `media_channels` → playlist / deck_units / cameras.
- `scavenging_tables` before `scavenging_table_items`; `security_networks` before `security_devices`.

**Verified correctly excluded (runtime):** all `player_*`, `smuggle_orders`, `aircraft` /
`flight_contracts` / `hangars`, `game_tables`, `atm_units` (auto-created per furniture),
`lighting_states`, `org_members` / `org_ranks`, `zone_control`, `scavenging_zone_stock` / `_state`,
`security_clips`, all logs / tokens / deployments.

---

## Track 2 — Content-shape vs engine-reader mismatches

| Rank | Table/field | Authoring shape | Engine reads | Symptom | One-line fix |
|---|---|---|---|---|---|
| 🔴 A | `npcs.dialogue_tree` actions (**both** option & node) | flat: `{action:'START_QUEST', quest_id:'x'}` | `a.params \|\| {}` at `server/index.js:939` **and** `:978` | The reference bug. Every parameterized dialogue action (quest start/complete/turn-in, grant/remove item, set flag, teleport, goto) no-ops; error swallowed by `console.warn`. | `params: a.params \|\| a` at both sites |
| 🔴 B | `scavenging_tables.messages.fishing` | fishing extras (`monsters[]`, `baitCatches[]`) seeded into a sub-key of the shared `messages` column | fishing reads `table.messages.fishing.*` (`plugins/fishing/index.js:267,280,284`) | Re-saving a fishing table through the **Scavenging** panel rebuilds `messages` from scratch (`client/devpanel/js/panels/scavenging.js:126`) and silently deletes the monsters/bait-catches. No authoring path for them exists in the first place. | Preserve unknown keys on save — **but the real fix is architectural** (see below) |
| 🟠 C | `drugs` overdose | basic form writes the overdose object into `withdrawal_effects.overdose` (`client/devpanel/js/panels/simple-entities.js:108`); its own help text says `effects` | lethality read **only** from `effects.overdose.lethal` (`server/engine/drugs.js:169`) | A drug authored via the basic form **never kills on overdose** — the lethal flag lands where the death path never looks. | Merge overdose sub-object into `effects` on save |
| 🟡 D | `mutations.stat_modifiers` | raw-JSON textarea, any keys accepted | keys interpolated **directly as SQL columns** (`SET ${stat}=…`, `server/engine/mutations.js:44`); needs `stat_brawn` etc. | Legacy/short keys (`{"brawn":3}`) → `UPDATE … SET brawn=…` throws; mutation grants no effect, no author feedback. | Whitelist `stat_*` keys in `saveMutation` |
| 🟡 E | broadcast playlist `conditions` | `item.npc_staff.length ? {npc_staff} : []` — an **array** when empty (`client/devpanel/js/panels/broadcast-schedule.js:944`) | reads `cond.npc_staff`, coerces `[]`→`{}` | Staffless playlist slots skipped in studio staff recompute (masked, no error). | Always emit `{ npc_staff: … }` |
| ⚪ F | VINE `EXECUTE_SCRIPT` `arguments` | catalogue offers the param | `graph.js` reads only `scriptId`/`graph` — never `arguments` | Designer thinks they're parameterizing a reusable script; args silently dropped (no arg mechanism exists). | Remove the phantom param from the catalogue |
| ⚪ G | AI `FLAG_SET`/`SET_FLAG` `scope:'world'` | editor offers `world` | `ai-behaviour.js` treats `world` as `self` (in-memory blackboard); never touches `world_flags` | Designer sets a "world" flag from an enemy graph expecting persistence; per-instance no-op lost on restart. | Drop/relabel `world` until DB writes wired |

**Finding B is an architecture violation, not just a save bug.** The `messages` column is
scavenging's free-text flavor bag (newline `player`/`broadcast` lines). Fishing smuggled structured
gameplay data into a `messages.fishing` sub-key of a column it doesn't own and can't author. Two
rules broken: *own your content's home* (engine-read content belongs in a table/column the plugin
owns via `dataSchema`, not a neighbor's column) and *structured data ≠ free-text blob*. This lesson
is now codified in the plugin-builder skill and `docs/plugin-standard.md`.

**RESOLVED 2026-07-04 (Option A).** Fishing's two pools moved to dedicated
`scavenging_tables.fishing_monsters` / `fishing_bait_catches` JSONB columns (empty `[]` for
pure-scavenging rows). The scavenging panel's `messages` rebuild can no longer touch them. Changes:
`SCHEMA_SQL` columns; `plugins/fishing/index.js` reader; `scripts/seed-fishing.js`; a backfill
one-shot `scripts/migrate-fishing-extras-to-columns.js`; `docs/systems-fishing.md`. A dev-panel
authoring section for these pools is still absent (they remain seed-script-authored) — the deferred
"give it a real home" work is done at the data layer; the editor UI is the remaining follow-up.

**Verified clean** (checked, aligned): enemy `loot_table`/`butcher_table`/`weapon`/`body_parts`,
item `damage`/`armor_soak`/`stat_bonus`/`requires`/`status_chance`, AI behaviour graphs (kept in
explicit lockstep), quest/script graph shapes, furniture `interactions`, zone flags, ATM columns,
NPC `clothing_layers`/vendor/banter/schedule, flight `aircraft_types` stat keys, weather
`climate_profiles`, recipe `base_output`.

**Also noted** (not shape bugs): recipe `ingredients` and the drug basic form use unguarded raw-JSON
textareas (same `itemId` vs `item_id` trap class); `fishing_table_id` has **no** dev-panel authoring
path at all (seed-script only), compounding finding B.

---

## Recommended sequencing

1. **A** (dialogue params, both call sites) + add **`'quests'`** to `CONTENT_TABLES` — fixed on
   another branch; verify *both* dialogue sites got `|| a`.
2. **Track 1 exports** — biggest blast radius (whole subsystems). Do it deliberately: a bad FK order
   aborts the whole restore, so verify a restore actually *completes*, don't blind-append.
   **Verified 2026-07-04:** a local round-trip test (seed a worst-case `broadcast↔channel` cycle →
   `buildDump()` → restore into a fresh DB) COMMITs cleanly with the deferred-constraint dump; the
   `broadcasts` INSERT precedes `channels` and the cycle survives to COMMIT. The deferrable-constraint
   change lives in `SCHEMA_SQL`, so the Relay's _Deploy content → Production_ lane applies it to prod
   as part of a normal deploy — no separate schema one-shot needed.
3. **B** (fishing) — do the architectural fix (own the content), not just the save patch.
4. **C–E**, then cleanups **F/G**.

## Method note

Static read-only code audit, fanned out across five domains (export coverage · dialogue/VINE ·
combat/items · world/economy/survival). Supabase MCP was unauthenticated this session, so no live
DB row inspection or `npm run test:regress` run — blast radii are inferred from code, not measured.
A regression test driving a dialogue `START_QUEST` end-to-end would confirm finding A fast.
