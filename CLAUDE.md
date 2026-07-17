# CLAUDE.md — Architect MUD

## What This Is

Post-singularity browser MUD in the HellMOO tradition. Text-driven, real-time, brutal, and funny. Node.js server with raw WebSockets, vanilla JS frontends (one HTML/JS file per client plus a sibling `styles.css`), PostgreSQL via Supabase. No build step, no ORM, no framework.

## Key Docs

- [README.md](README.md) — deploy instructions, player commands, world overview, what's built and what's next
- [docs/architecture.md](docs/architecture.md) — stack decisions, repo structure, data flows, DB schema, **persistence tiers (when to write the DB) + read tiers (where data lives at runtime — read before adding any `query()` to a hot path)**, lessons learned from deployment bugs
- [docs/design.md](docs/design.md) — game design philosophy, combat feel, skill/faction/economy systems, open design questions
- [docs/items.md](docs/items.md) — item property reference: every `items` field, which JSON keys the engine actually reads, and the working armor format
- [docs/tags.md](docs/tags.md) — the tag system: catalog/helpers/Tag→Action registry, the tag model, and how to add a tag cleanly (property vs. behavior)
- [docs/combat.md](docs/combat.md) — combat **as actually built** (to-hit, body parts, typed soak, cooldowns, enemy AI, loot); the authoritative running source on the combat system
- [docs/systems-survival.md](docs/systems-survival.md) — hunger/thirst, radiation, mutations, drugs, buffs, sleep, status-effect framework (as built)
- [docs/systems-weather-extreme.md](docs/systems-weather-extreme.md) — **extreme weather (steps 1–6 + 7a built; 7b/7c pending)**: severity scalar over the weather field, gear-gated-lethal thermal/wind/blackout/ash-choking channels, no indoor safe-haven, power-stays-out scar, ⚠ forecast telegraph band, named "hero" event framework (approach→peak→passing, in the weather plugin); acid-rain teeth + EMP blackout still to build
- [docs/systems-economy.md](docs/systems-economy.md) — credits/banking, vendors, factions, crafting, IP/stat-raising, housing (as built)
- [docs/systems-world.md](docs/systems-world.md) — world state, movement, ambience, sound propagation, spawning, minimap, scheduler, tunables (as built)
- [docs/server.md](docs/server.md) — the server process: boot sequence, in-memory vs. DB state, tick scheduling, WS message handling (as built)
- [docs/vine.md](docs/vine.md) — the VINE graph editor: file roles, schemas (dialogue/script/AI/broadcast/quest), and editor internals
- [docs/flags-keys.md](docs/flags-keys.md) — registry of `flags` keys across zones/NPCs/items/furniture and which plugin owns each
- [docs/systems-flight.md](docs/systems-flight.md) — flight: aircraft, airfields, hazards, contracts, air combat, hangars/salvage/tuning (as built)
- [docs/reference/world-rendering.md](docs/reference/world-rendering.md) — **flight-sim 3D world rendering**: how a DB tile becomes an extruded building out the cockpit (`plugins/flight/state.js` cell payload → `drawWorldObjects` → `modelFor` → `drawTypeModel`/`NAMED_MODELS`/`TYPE_MODEL` → `draw3DBoxAt`), palettes (`WALL_COL`/`ty_*`), the decoration helpers, and the **three separate "tower" renderers** (world-building vs. deck backdrop vs. hangar-bay diorama). Read before "improving a model" — the ATC tower is built into the `hangar` model, and there is no billboard system for buildings.
- [docs/systems-mining.md](docs/systems-mining.md) — mining: posture-based deposit-working, per-zone ore tables, tool gate (as built)
- [docs/systems-jobboard.md](docs/systems-jobboard.md) — rotating job board: legal early-money gigs over the quests plugin, greeter gate, philosophical encounters (as built)
- [docs/devpanel-js.md](docs/devpanel-js.md) — dev panel JS file reference: what each script in `client/devpanel/js/` holds, which functions live where, and the load-order contract
- [docs/commands.md](docs/commands.md) — command dispatch pipeline, SIFT/FATE target resolution system, rules for using SIFT in new commands, and per-domain targeting reference
- [docs/scripting.md](docs/scripting.md) — action registry (registerAction/dispatchAction), event bus (on/emit), flag store (getFlag/setFlag/evalConditions), and script graph runner (runGraph); the mutation path all content flows through
- [docs/ai-behaviour.md](docs/ai-behaviour.md) — VINE-powered behaviour trees for enemies and NPCs; node types, condition/action catalogue, blackboard, pathfinding
- [docs/plugins.md](docs/plugins.md) — **plugin index**: which plugin owns each verb/mechanic, and the command-precedence rule (plugins win over engine builtins). Check this before editing any player command.
- [docs/systems-macros.md](docs/systems-macros.md) — smartbar macros: player-defined macro buttons (client-only localStorage) with `;`-chained scripts, `delay`/`echo`, live `$values`, `if/else` branching, and macro-calls-macro with loop guards (as built)
- [docs/systems-posture.md](docs/systems-posture.md) — posture/sitting (split engine+plugin system): the `player.posture`/`sittingOn` contract, HP regen, stand-up triggers, look description (as built)
- [docs/npc-clothing.md](docs/npc-clothing.md) — personality-based NPC outfits: the `CLOTHING` table in `npc-personality.js`, auto-injection at `apiCreateNpc` (all future NPCs quietly clothed), the descriptive `flags.clothing_layers` model, and the backfill script
- [docs/systems-broadcast.md](docs/systems-broadcast.md) — broadcast system: channels, playlists, dynamic news, VINE graph scripts, NPC hosts, camera feeds, broadcast-bridge, game client styling (as built)
- [docs/systems-atm.md](docs/systems-atm.md) — ATM terminals: furniture integration, networks, fee/limit/faction logic, hacking, replenish tick, power dependency, dev panel routes (as built)
- [docs/systems-scavenging.md](docs/systems-scavenging.md) — scavenging: posture-based perpetual search, per-zone loot tables + lazy replenish, the 2D8−2D8 Scavenging check, feedback state machine (as built)
- [docs/systems-fishing.md](docs/systems-fishing.md) — fishing: posture-based cast-and-wait (scavenging's water-side cousin) that arms a client tension-bar reel overlay on a bite; new Fishing skill (Reflexes+Cool), rod carry-gate + optional bait, monster hooks + rod-snap; reuses the scavenging table schema via a separate `fishing_table_id` zone flag (as built)
- [docs/systems-surveillance.md](docs/systems-surveillance.md) — SPECTER: player spy networks (plant/hub/record/counterplay/devices) + the witnessed-crime wanted system (as built)
- [docs/systems-jail.md](docs/systems-jail.md) — jail: downed-while-wanted → Precinct 9 Holding (1 min/star), gear confiscated (contraband → shared 50-item evidence locker, 3-day purge), guard release restores legal items, difficulty-10 hackable cell door = jailbreak; `player.respawnZone` engine seam (as built)
- [docs/systems-corps.md](docs/systems-corps.md) — **corporations & player orgs (design, not built)**: corp = faction + owner + treasury + members + territory; influence tug-of-war for zones, single membership, five power levers (economy/territory/subterfuge/aggression/diplomacy), NPC corp AI, Architect-reacts-to-concentration
- [docs/systems-cards.md](docs/systems-cards.md) — **procedural trading cards (renderer built, integration design)**: `client/game/js/card-render.js` draws a character's equipped loadout as per-piece vector art on both Vitruvian silhouettes; ~30 slot→archetype drawers tinted by gear tier, deterministic (store the `{body,item_ids,seed}` spec, not an image). Mint verb/storage/card UI not yet built
- [docs/content-pipeline.md](docs/content-pipeline.md) — **content pipeline (git as source of truth)**: one JSON file per entity under `content/`, the table-classification registry (`server/models/content-registry.js`), export/import/lint/status commands, git-diff-driven deletions, the CONTENT_READONLY prod gate, the CI deploy workflow, and the cutover runbook. **Cutover done (2026-07-08)** — git is the sole writer of prod content; the old seed pipeline is retired and the CODEX flow described under Core Architectural Rules below is authoritative.
- [docs/proposals/engine-plugin-boundary.md](docs/proposals/engine-plugin-boundary.md) — **engine/plugin boundary strategy + implementation log**: substrates/laws/registries vs. systems, the litmus tests, and what's been migrated (Phases 0–2 done, Phase 3 partial). Read before deciding where new code lives.
- [docs/audits/](docs/audits/README.md) — **audit suite**: reusable prompts that challenge the design at its silent seams (engine↔plugin source-of-truth, client↔server protocol, content↔engine fields, UI/CSS standardization, registry naming harmony). Start at the [index](docs/audits/README.md); the seminal one is [source-of-truth-audit.md](docs/audits/source-of-truth-audit.md) (the bug class behind the posture break).

**Before touching any system, read the relevant doc section if there's one applicable to the request.**

**Before editing any player command, check [docs/plugins.md](docs/plugins.md) first** — a plugin may already own that verb, in which case the engine handler for it is dead code.

## Core Architectural Rules

- **Engine vs. content are separate.** The codebase is the engine. World content (zones, items, enemies, NPCs) lives in Postgres and is edited through the dev panel. Don't hardcode content into engine files.
- **No ORM.** All queries go through the single `query()` helper in `server/models/db.js`. Keep it that way.
- **No startup migrations. Schema and content are managed deliberately, never on boot.**
    - **Schema** is the single source of truth in `server/models/schema.js` (`SCHEMA_SQL`, idempotent DDL). `npm run db:schema` applies it to your **local** dev DB. Production gets it through the CODEX deploy (below), not a manual `db:schema` against prod.
    - **Content lives in git (CODEX pipeline).** World content is one JSON file per entity under `content/`, and a **fresh database is built with `npm run db:create-local` (empty DB) → `npm run content:import`** (which applies `SCHEMA_SQL`, then loads the content tree). There is no checked-in `seed.js`/`seed.sql` and no boot-time content rewriting (the old startup `migrate()` was removed precisely because it disrupted dev by mutating content on every restart). The dev-panel `.sql` export (`/dev` → Power Tools → _Database Backup_) + `npm run db:restore -- dump.sql` remains as a **self-contained-SQL escape hatch** (backups, recovery), not the primary seed path.
    - **CODEX is the deploy path (git as source of truth).** World content lives as one JSON file per entity under `content/`; a push to `main` is the deploy — CI applies the full `SCHEMA_SQL` ahead of the additive content, backs prod up first, and is regress-gated. So idempotent schema DDL (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, deferrable-constraint swaps) **and** new content both reach prod through a normal push. See [docs/content-pipeline.md](docs/content-pipeline.md) and the `codex` skill for the authoritative flow.
    - **To change the schema:** edit `SCHEMA_SQL` (idempotent), apply locally with `npm run db:schema`, and ship to prod via the CODEX deploy (push to `main`). Never an auto-run boot migration. **Reserve manual one-shot scripts for _data transformations_** — backfilling or rewriting *existing* rows (e.g. moving data between columns). The additive deploy (`INSERT … ON CONFLICT DO NOTHING`) can never touch existing rows, so those are the only thing it doesn't cover.
    - **Running a one-shot against prod:** `node --env-file=.env.prod scripts/<name>.mjs` (the git-ignored `.env.prod` holds the prod `DATABASE_URL`). `db.js` enables SSL by **host** — remote ⇒ TLS, localhost ⇒ none — so this needs no `NODE_ENV` juggling and any `query()`-based script works against prod this way. Omit the flag to go back to local.
    - The export deliberately excludes player/runtime rows (accounts, inventory, password hashes); it carries schema + world content only.
- **Plugins for extensibility.** New behavior hooks belong in `/plugins/`, not in engine files, unless they're genuinely core.
- **No new sparse columns on `players` (or `npcs`).** New per-player scalar state goes in `player_flags` or its own feature table — never another `players` column. Same for per-tick/derived state: check the persistence tiers in [docs/architecture.md](docs/architecture.md#persistence-tiers-when-to-write-the-db) before adding a runtime DB write.
- **Every `query()` is a remote round trip — decide the read tier before adding one.** Prod Postgres is remote; latency lives in round-trip *count*, not query cost. Check the [read tiers in docs/architecture.md](docs/architecture.md#read-tiers-where-data-lives-at-runtime) before a new feature reads the DB: hot paths (per-move/per-swing/per-tick) never add awaited queries — serve them from the live player object, the world Maps, or a cache tier; never query in a loop (`id = ANY($1)` / `GROUP BY`); `Promise.all` independent reads; coalesce same-row writes; idle-gate scheduled ticks on `hasActivePlayers()` and register them via scheduler.js. **A cache is only as safe as its write funnel — grep every writer before caching a table** (why `furniture` and `npcs` rows are deliberately uncached).
- **UTF-8, always.** Several files (especially `client/game/index.html`) use Unicode glyphs and box-drawing chars (`₵ ⚙ ⏻ ╱ █ ☢`). When editing, preserve UTF-8 without a BOM — never let a tool re-save as Windows-1252 or it double-encodes everything into `â•±â•²` mojibake. After editing such files, sanity-check that the glyphs are still intact.

## Regression Testing — run it, and recommend it

`npm run test:regress` ([tests/regress.js](tests/regress.js)) is the pre-deploy gate. It boots the
world + all plugins (no server), sweeps every plugin manifest against the live registries (declared
commands/hooks actually wired), then drives real commands end-to-end through `handleCommand` with a
fake player — dispatch order, posture, move gates — plus every plugin's own `regress.js` suite.

**Run it without being asked** after any of these, and say so in your summary:

- editing the dispatch pipeline (`commands/index.js`), plugin loader, or any engine registry/seam
  (actions, events, hooks, specialized actions, move gates, posture)
- adding/removing/renaming a plugin verb, or changing a `plugin.json`
- extracting or relocating a system (engine↔plugin moves)
- **before any deploy/push of server code** — recommend it even for changes that look unrelated

Never wire it into production boot (same principle as no startup migrations — boot stays deliberate).

**When you add a plugin or a verb, add a `plugins/<name>/regress.js`** (default-export
`async ({ run, check, getPlayer }) => { … }`; see [plugin-standard.md](docs/plugin-standard.md)).
Test code lives with the plugin and never loads in production.

Caveats: it shares the Supabase session pool (pool_size 15) — if it dies with `EMAXCONNSESSION`,
an orphaned local `node server/index.js` is holding pool connections. A `pretest:regress` hook runs
`scripts/kill-orphans.js` to sweep these automatically before every regress run (and `predev` does
the same before `npm run dev`); run it by hand any time with `npm run kill:orphans`. It's Windows-only,
scoped to this repo's own entrypoints (`server/index.js`, `tests/regress.js`, `sync-commits.js`), and
never runs in production (`npm start` has no pre-hook). If a sweep can't reach it, wait ~90 s. Player
stat columns are `stat_brawn`/`stat_reflexes`/… (not `brawn`).

## VINE Graph Workflow

When asked to create or update an NPC behaviour graph, dialogue tree, or enemy behaviour graph:

1. **Write the JSON** — produce the full graph object (`{ nodes: {}, edges: [] }`) according to the relevant schema (`vine-schema-ai.js`, `vine-schema-dialogue.js`, etc.).
2. **Push it to the DB** via the PATCH API routes (no copy-pasting, no UI required):
   - NPC behaviour: `PATCH /api/npcs/:id/graph` `{ "field": "behaviour_graph", "graph": {...} }`
   - NPC dialogue: `PATCH /api/npcs/:id/graph` `{ "field": "dialogue_tree", "graph": {...} }`
   - Enemy behaviour: `PATCH /api/enemies/:id/graph` `{ "field": "behaviour_graph", "graph": {...} }`
3. **Confirm success** — check the response is `{ ok: true }` and report back. If the route returns an error, diagnose and fix before reporting done.

The VINE modal also has a "📋 Load JSON" button for manual paste-in when needed, but the API route is the standard path.

## Working Agreements

### 1. Think Before Coding

Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.
- Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

Touch only what you must. Clean up only your own mess.

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: every changed line should trace directly to the user's request.

These guidelines are working if: fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
