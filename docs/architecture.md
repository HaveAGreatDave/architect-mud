# Architecture Document

## Guiding Principle

**No one touches code to create content.** World builders, writers, and designers work entirely through the dev panel — a browser-based world editor. The codebase is the engine. The content (zones, items, enemies, NPCs) is data living in Postgres. These two things stay separate: publishing a zone edit never requires a deploy.

### The two names

The separation above has names on both sides of it.

| | Name | What it is | Where it lives |
|---|---|---|---|
| Platform | **THOMAS** | The Hypermedia Online Multiplayer Adventure System — the client and engine | `client/`, `server/engine/`, the dev panel, the plugin loader, the CODEX pipeline |
| Game | **Architect** (Architect MUD) | One game built on THOMAS | Postgres + `content/` — Coldwater, the Basin, the orders, the prose |

THOMAS is a **platform**, not this game's front end: with modification — through the dev panel, which is the surface built for it — somebody could stand up a **different MUD** on the same engine and client. That possibility is the reason the guiding principle is a rule rather than a preference. Every piece of Coldwater that ends up hardcoded in an engine or client file is a thing a second game would have to unpick, so "engine vs. content are separate" is not tidiness — it is what keeps THOMAS reusable.

⚠ The name appears nowhere in the codebase except the dev panel's boot splash, so a grep suggests it names the dev panel. It names the platform the splash is booting.

---

## Stack Overview (As Built)

| Layer | Technology | Role |
|---|---|---|
| **Runtime** | Node.js (ES modules) | Server, game loop, real-time logic |
| **Transport** | `ws` (raw WebSocket) | Real-time bidirectional communication |
| **Frontend** | Vanilla JS, single-file HTML | Player client + Dev panel — no build step |
| **Database** | PostgreSQL via Neon | Persistent world state, players, items — single source of truth |
| **Query layer** | `pg` (node-postgres), raw SQL | No ORM — schema is hand-written in `schema.js` |
| **Auth** | Opaque random session tokens (`crypto.randomBytes(32)`) + SHA-256 password hashing | Player accounts, dev/admin roles. **Not JWT** — this row said `jsonwebtoken` for months while nothing imported it; the dependency was removed 2026-08-18 |
| **Hosting** | Render (free Web Service tier) | Node server, auto-deploys on git push |

### Why this stack, in practice

Postgres (not SQLite) for dev as well as prod, so there is only ever one schema. **Neon** provides that managed Postgres for both. Render was chosen over Vercel/Netlify/Cloudflare (serverless — no persistent WebSocket support) and over Railway (no permanent free tier) specifically because it supports long-lived WebSocket connections on its free plan.

No ORM. Every query in the codebase is a plain parameterized `pg` call through a single `query()` helper in `models/db.js`.

### Schema and content lifecycle (no startup migrations)

The server **does not** touch the schema or world content on boot. The two are managed separately and deliberately:

- **Schema** lives entirely in `server/models/schema.js` as the exported `SCHEMA_SQL` string (idempotent DDL). Apply it locally with `npm run db:schema`; production gets it through the CODEX deploy (CI applies the full `SCHEMA_SQL` ahead of content on every push to `main`).
- **Content** lives in git — one JSON file per entity under `content/`, exported/imported via `npm run content:export`/`content:import` (the **CODEX pipeline**, see [content-pipeline.md](content-pipeline.md)). A push to `main` is the deploy: CI backs prod up, applies schema + additive content, and is regress-gated. The dev-panel `.sql` export (`/dev` → Power Tools → *Database Backup*) remains as a backup/restore mechanism.
- **One-shot scripts** against production are reserved for *data transformations* on existing rows (the additive deploy can't touch them): `node --env-file=.env.prod scripts/<name>.mjs`. There is no auto-run migration path — this is what keeps dev from being disrupted by content-rewriting code firing on every restart (the reason the old startup `migrate()` was removed).

---

## Repository Structure (Actual)

```
/
├── server/
│   ├── index.js              # HTTP + WebSocket entry point, auth, global error handlers
│   ├── keepalive.js          # Pings Render /health every 10min (deliberately never touches the DB — lets Neon sleep)
│   ├── engine/
│   │   ├── gameLoop.js       # Tick system: combat tick, minute tick, ambient tick, spawn tick
│   │   ├── combat.js         # Combat resolution, cooldowns, enemy attack timers
│   │   ├── commands/         # Command dispatcher — index.js + per-domain builtin files
│   │   │   ├── index.js      #   Dispatch pipeline: SIFT → input matchers → plugin commands → specialized actions → builtins
│   │   │   ├── combat.js     #   Loot corpses/sleepers (steal lives in the thievery plugin)
│   │   │   ├── describe.js   #   Room description renderer, look/examine
│   │   │   ├── movement.js   #   Move/go + the engine move-gate laws (door lock, encumbrance)
│   │   │   ├── inventory.js  #   Take, drop, use, equip, containers; recomputeArmor
│   │   │   ├── housing.js    #   Rent, lock, pick, upgrade lock, sleep, curtains
│   │   │   ├── social.js     #   Say, yell, whisper, talk, who
│   │   │   ├── world.js      #   Examine, stats, skills, help, raise, admin tools
│   │   │   ├── doors.js      #   Door open/close/lock/unlock + lock install
│   │   │   ├── infrastructure.js  # Destructible power devices (attack/repair)
│   │   │   └── ghost.js      #   Ghost session mode (driven from index.js WS layer, not the dispatcher)
│   │   ├── world.js          # In-memory zone/entity cache, DB is still source of truth
│   │   ├── environment.js    # Time/calendar, weather, ambient + artificial light, power grid simulation
│   │   ├── skills.js         # Skill definitions, XP/rank curve, generic skillCheck()
│   │   ├── crafting.js       # Recipes, station requirements
│   │   ├── mutations.js      # Radiation-triggered permanent mutations
│   │   ├── ideologies.js     # Ideology reputation tiers + stance/path lean (was factions.js)
│   │   ├── vendor.js         # Buy/sell with ideology rep discounts
│   │   ├── apartments.js     # Property ownership, locks, lockpicking, safe sleep
│   │   ├── actions.js        # Canonical mutation path: registerAction / dispatchAction
│   │   ├── events.js         # In-process event bus: on / emit
│   │   ├── flags.js          # Player/world flag store + evalConditions; registers SET_FLAG/CLEAR_FLAG
│   │   ├── graph.js          # Script graph runner (runGraph/runScriptById) + orchestration actions
│   │   ├── tags.js           # Tag helpers (hasTag, tagValue, tagsOf) + re-exports TAG_CATALOG
│   │   ├── supertags.js      # Legacy supertag bookkeeping-key stripping (ownTags) — see docs/tags.md
│   │   ├── specializedActions.js  # Verb-first tag-gated action registry (registerSpecializedAction / fireSpecializedAction)
│   │   ├── ai-behaviour.js   # VINE behaviour tree runtime (tickEntityAI, initBlackboard)
│   │   ├── pathfinding.js    # BFS zone pathfinding (findPath, getZonesInRadius)
│   │   ├── locks.js          # Lock type registry (registerLockType, resolveLockAuth) — types live in plugins
│   │   ├── scheduler.js      # Named-cadence interval registry; idle-gates every callback by default
│   │   ├── channels.js       # Radio channels: definitions, send, history (CHANNEL_DEFS)
│   │   ├── effects.js        # Timed status-effect registry (registerStatusEffect, applyEffect, tickEffects)
│   │   ├── bodily.js         # Substrate: stains + digestion loads (pressure sim lives in plugins/bodily)
│   │   ├── posture.js        # Substrate: setPosture/forceStand — the only sanctioned posture writes
│   │   ├── protection.js     # Substrate: zone protection providers (forcefields; corps/wards later)
│   │   ├── movement-gates.js # Move veto chain (registerMoveGate) — engine laws + plugin gates
│   │   ├── directions.js     # Shared OPPOSITE/DIR_OFFSET constants
│   │   ├── appearance.js     # Character appearance generation + description helpers
│   │   ├── ip.js             # IP/XP: awardIp roll, raiseStat (spends Net XP), statCost, grantXp
│   │   ├── mis.js            # Consent substrate: isMisActive/isAttractedTo (the MIS system lives in plugins/mis)
│   │   └── plugins.js        # Plugin loader: hooks, commands, routes, specialized actions, input matchers
│   ├── models/
│   │   ├── db.js             # pg.Pool connection, single query() export
│   │   ├── schema.js         # SCHEMA_SQL — the single source of schema truth; `npm run db:schema`
│   │   ├── restore.js        # Apply an exported .sql dump; `npm run db:restore -- dump.sql`
│   │   └── temp/             # One-off utility scripts — safe to delete once used
│   │       ├── rename-admin.js   # Renames admin handle to "The Architect" on pre-existing DBs
│   │       └── reset-chars.js    # Resets character stats for combat-rework rollout
│   └── api/
│       ├── routes.js              # REST endpoints for the dev panel (zones/enemies/items/npcs/apartments/world state)
│       ├── backup.routes.js       # GET /admin/export-dump — full schema+content SQL dump (admin only)
│       ├── environment.routes.js  # REST endpoints for time/weather/power dev tools, mounted from routes.js
│       └── worldvalidator.routes.js  # REST endpoint that fires the zone-validator plugin's hooks
├── client/
│   ├── game/                 # Player client — index.html + styles.css + js/ modules, no framework, no build step
│   ├── devpanel/             # Dev panel — same approach; see docs/devpanel-js.md for the js/ file reference
│   └── shared/
│       ├── tagCatalog.js     # Single source of truth for item AND zone tag definitions — read by both client and server
│       └── tagSupertags.js   # Supertag registry (TAG_SUPERTAGS) — dual-mode file like tagCatalog.js
├── plugins/                   # One folder per plugin (97 as of 2026-07) — see docs/plugins.md
│                              # for the authoritative catalogue; don't duplicate it here.
├── content/                   # World content as one JSON file per entity — the CODEX pipeline
│                              # (git is source of truth for prod content); see docs/content-pipeline.md
├── tests/regress.js           # Pre-deploy regression gate (`npm run test:regress`) — see CLAUDE.md
└── render.yaml                # Render free-plan service config
```

World content is edited through the dev panel and versioned in git under `content/` (one JSON file per entity — the CODEX pipeline, [content-pipeline.md](content-pipeline.md)); a push to `main` deploys it.

---

## Two Frontends

### 1. Player Client (`/client/game/index.html`)
Single-file HTML/CSS/JS, no build step, no framework. Panels:
- **Output pane** — scrolling game text (room descriptions, combat, dialogue), with exits/NPCs/enemies/corpses/items rendered as clickable underlined spans
- **Sidebar** — ASCII minimap (top), vitals, location info, hostiles list
- **Input bar** — command entry, single-letter direction shortcuts (n/s/e/w/u/d)
- **Settings modal** — theme (dark/light/high-contrast), font size, display density; persisted to `localStorage`

Communicates exclusively via WebSocket for gameplay (`wss://` when served over HTTPS — the protocol is detected from `location.protocol` rather than hardcoded, since a hardcoded `ws://` is silently blocked by browsers on an HTTPS page). Registration goes through a small REST endpoint before the WebSocket auth handshake.

### 2. Dev Panel (`/client/devpanel/index.html`)
The world-building interface. Accessible to accounts with `role: dev`/`admin`/`builder`/`designer` (`api/routes.js:132`). REST-only (no WebSocket) — every save/delete goes through `api/routes.js` and triggers an in-memory hot-reload via `world.reloadZone()` or equivalent. Every API call is wrapped with proper error handling: network failures, non-2xx statuses, and unreadable responses all surface as a toast instead of failing silently.

---

## The Dev Panel — In-Game World Editor

### Modules (Built)

#### 🗺️ Zone Editor
- Name, description; danger shown read-only (inferred from spawns + radiation — override via the `danger` zone tag)
- **Zone Tags editor** (radiation, sanctuary, street_life, … — the catalog-validated `flags` bag), plus structured widgets: **apartment flag** (`flags.is_apartment` — makes a zone rentable; saving a zone with this checked auto-registers an `apartments` table row if one doesn't exist yet), **building flag** (`flags.is_building`, drives entrance-discovery text in neighboring zones) and **interior flag** (`flags.is_interior`)
- **Exits** — a direction + destination-zone picker (list of current exits with Remove buttons, plus an add-exit form), not a hand-edited JSON blob
- Ambient events as a JSON array of strings
- **Rooms / NPCs / Furniture sub-sections** — add, edit, and delete a zone's child rooms (apartments/interiors attached via a single exit back to this zone), NPCs, and furniture without leaving the zone's own edit panel
- **Generator sub-section** — install or remove a power generator on this zone (see Environment System below); installing one auto-wires power to every connected room in the building (or every outdoor zone, for a city-plant generator)
- **Apartment Details sub-section** — shown only when the apartment flag is set; edit lock state/difficulty/rent and view the current owner, replacing the old standalone Apartments tab (see "Retired" below)
- A **🗺 View Big Map** button opens a clickable grid of the whole outdoor city — click any tile to jump straight into editing that zone
- **Save & Publish** writes to Postgres and calls `world.reloadZone(id)` — live immediately, no restart

#### 👾 Enemy Editor
- Stat block, damage range, armor, XP/credit rewards
- Loot table as weighted JSON
- Behavior flag (aggressive / patrol / territorial), faction affiliation

#### 🗡️ Item Editor
- Type, subtype, weight, value
- Stackable / unique / quest-item flags
- Effects and stat modifiers as JSON

#### 🧑 NPC Editor
- Dialogue tree as JSON (root node + branching options)
- Vendor inventory (item, price, stock)
- Zone assignment, faction, disposition

#### 🪑 Furniture Editor
- Name, description, zone assignment
- Light flags (`is_light`, `light_type`: overhead / lamp / streetlight, `light_on`) — see Environment System below

#### ⚗ Recipes / ☢ Mutations / 💊 Drugs Editors
- Same CRUD-table pattern as Enemy/Item — definitions are dev-panel-editable data, not hardcoded in `crafting.js`/`mutations.js`/`drugs.js`

#### ⚡ Power Tab
- A color-graded version of the same big-map grid, toggleable between **power status** (unpowered / city grid / building generator / overloaded / offline) and the regular **danger-rating** coloring
- Generator list with live capacity/draw/status and a one-click Remove

#### 📊 World State Monitor
- Live online player count, players-per-zone
- Read-only, polls the REST API

#### ⚙ Settings
- High-contrast theme toggle, log out (separate from the player client's own settings modal)

This list is the structural core, not the full tab inventory — the panel has since grown
Maps/Terrain, World Editor, Power, Flight, Broadcast, Audio, Quests, Scavenging, Validator
and more. [devpanel-js.md](devpanel-js.md) is the authoritative per-file reference.

### Retired
- **Standalone Apartments tab** — removed. Apartment-specific fields (owner, lock state/difficulty, rent) moved into the Zone Editor's Apartment Details sub-section. The underlying `apiBuildApartmentBlock` route still exists server-side (`api/routes.js:359,2866`) but isn't surfaced in the UI.

### Not built (originally planned, deprioritized)
- Loot table editor as a separate named-table concept — loot tables are inlined per-enemy/per-item instead
- Multi-builder conflict detection / presence indicators — single-admin assumption in practice so far

---

## Data Flow: Creating or Editing a Zone

```
Admin opens Zone Editor in Dev Panel
  → Fills in / edits fields, including is_apartment if it should be rentable
  → Clicks "Save & Publish"

POST/PUT /api/zones(/:id)
  → apiCreateZone / apiUpdateZone in routes.js
  → Coerces booleans to the INTEGER columns Postgres expects (0/1)
  → Writes to DB, wrapped in try/catch — a bad request returns an error,
    it can no longer crash the whole server (see Lessons Learned below)
  → Calls world.reloadZone(id) — patches the in-memory zone cache
  → Live immediately for every connected player
```

---

## Data Flow: Player Action (Example — Attack)

```
Player types "attack mutant" or clicks the enemy's name in the room text
  → WebSocket message: { type: "command", command: "attack mutant" }

Server (handleGameCommand in index.js)
  → Looks up the live player object by session
  → handleCommand() parses; the weapon plugin's specialized action wins
    dispatch and fires the ATTACK Action → cmdAttack() (plugins/weapon/)
  → Combat engine resolves the hit (cooldown check, roll, damage)
  → Updates player/enemy state, persists relevant fields to DB
  → Returns a result object; if it includes player_update, that's
    auto-forwarded to the client to refresh the vitals UI

Server sends the result back over the same WebSocket connection.
Enemy retaliation happens on its own timer in the next combat tick,
independent of the player's action — you are never safe standing still
next to something hostile.
```

---

## Database Schema (Core Tables)

This is an illustrative core subset — the full schema (113 tables) is `SCHEMA_SQL` in
`server/models/schema.js`, and the content/runtime/player classification of every table lives in
`server/models/content-registry.js`.

```sql
players           -- account, stats, skills location, credits, bank_credits, anchor/current zone
player_skills     -- player_id, skill_id, rank, xp
zones             -- id, name, description, exits (JSONB), flags (JSONB — catalog-validated zone tag bag: radiation/sanctuary/danger/…)
items             -- template definitions: type, effects, stat_modifiers
player_inventory  -- player_id (or "_ground_<zone_id>" for dropped items), item_id, quantity
enemies           -- template definitions: stat block, loot_table, behavior, faction
zone_spawns       -- zone_id, enemy_id, max_count, spawn_weight, respawn_seconds
npcs              -- id, name, zone_id, dialogue_tree (JSONB), vendor_inventory (JSONB)
furniture         -- id, zone_id, name, description, flags; is_light/light_on/light_type for switchable lights
orgs              -- NPC ideologies (is_npc=1) + player orgs (the old `factions` table was folded in)
player_ideology_rep -- player_id, ideology_id (references orgs.id), reputation score
loot_tables       -- named, reusable weighted-drop tables (lightly used; most loot is inlined)
world_events      -- log of significant events
player_corpses    -- lootable death drops, expire after 60 minutes (gameLoop.js:421)
apartments        -- zone_id (PK), owner_id, owner_handle, is_locked, lock_difficulty, rent_cost

-- Environment system (schema in server/models/schema.js)
world_clock       -- single-row clock: game_date, game_time_minutes, day_of_week, season, last tick timestamps
weather_forecast  -- 7-day deterministic seeded forecast (per-day weather_type, temp, wind_kph, humidity_pct)
generators        -- id, zone_id, name, generator_type (city_plant/junction_box/player), capacity_kw, status;
                   -- city_plant + junction_box are permanent (no fuel); only 'player' type consumes fuel.
                   -- junction_box links to its parent city_plant via city_generator_id
power_zones       -- id (= a zone id), source_type, generator_id (FK), capacity_kw, current_load_kw, status
                   -- (powered/overloaded/offline) — a zone with no row here is simply unpowered
lighting_states   -- zone_id (PK), has_emergency_lighting, artificial_light_level, fixture_count
```

Ground-dropped items reuse the `player_inventory` table with a synthetic `player_id` of `_ground_<zone_id>` rather than a separate table — this keeps "take" / "drop" using the same insert/delete logic as normal inventory management.

`apartments` is keyed by `zone_id` rather than having its own surrogate ID — an apartment is 1:1 with a zone, not a separate spatial entity. Ownership and lock state are cached in-memory in `world.js` (`world.apartments`) for fast reads on every room description, with writes going through Postgres first and then patching the cache.

`power_zones` is similarly keyed by zone id rather than a surrogate one — a zone either has a power record (it's connected to some generator's network) or it doesn't, and "no row" is the unpowered state rather than a separate boolean flag.

---

## Environment System (Time, Weather, Power & Lighting)

`environment.js` owns a second in-memory cache (`state`), parallel to and independent of `world.js`'s entity cache.

**Time & weather.** A single-row game clock (`world_clock`) advances in-game minutes, tracks day/night phase (dawn/day/dusk/night) and season, and drives a 7-day deterministic seeded weather forecast (owned by the **weather** plugin — see [plugins.md](plugins.md)). Three cadences register on the shared `scheduler.js` alongside `gameLoop.js`'s: a **1-minute** tick (advance the game clock + step indoor HVAC temperatures + broadcast), a **30-second** tick (advect the moving weather field, push per-zone weather, reconcile streetlights for occupied zones), and a **5-minute** tick (brownout rotation, only while a zone is overloaded or a storm is faulting the grid). The **30-minute** (ambient-light recalculation, full streetlight sweep) and **24-hour** (weather advancement, power re-simulation) ticks are *not* real cadences — the 1-minute driver fires them on **game**-minute boundaries so they track the game-speed knob (`environment.js:422-430,841-871`).

**Power grid.** Generators come in three types: `city_plant` and `junction_box` are permanent (no fuel, never run dry), `player` is fuel-consuming (portable generators). Distribution is hierarchical — city_plant → junction_box → zone (`simulatePowerNetwork` runs it in phases):
- A `city_plant` feeds every outdoor zone plus the junction boxes wired to it (via `city_generator_id`).
- A `junction_box` powers one building's interior zones (those grouped by the `is_building` flag), with a capped throughput drawn from its parent city_plant.
- There is **no** `building` generator type; a building is powered by its junction box.

Each zone in the network gets a `power_zones` row and a `lighting_states` row. Status (`powered`/`overloaded`/`offline`, gated by `POWER_OVERLOAD_RATIO`) comes from each consumer's **allocated-vs-demanded** power across the city_plant→junction_box→zone phases, re-simulated on every 24-hour tick and immediately on any install/remove via an exported `recomputePower()` rather than waiting for the next tick.

**Lighting.** Two kinds of light fixture exist as `furniture` rows (`is_light`, `light_on`, `light_type`):
- **Overhead / lamp** — indoor, player-switchable via the `switch`/`flip` command, blocked if the room has no power record at all.
- **Streetlight** — outdoor, *not* player-switchable; reconciled **per-zone against each zone's local ambient visibility** (time-of-day light attenuated by that zone's local weather cell, `vis < VISIBILITY_DIM`), so a storm cell rolling over one block lights it while clear blocks stay dark. Swept on the 30-minute tick and re-reconciled every 30 seconds for occupied zones; also re-synced on every server boot.

**Visibility.** `getZoneVisibility(zoneId)` combines ambient light (time of day) with artificial light (power status + lit fixture count) and weather/fog factors into a `clear`/`dim`/`dark` category, appended as a flavor line to every room description. Deliberately informational only — darkness does not hide exits, items, or NPCs.

**Dev tools.** `environment.routes.js` exposes time/weather overrides, forced ticks, generator install/remove, and load/failure simulation, all gated to the same `dev`/`admin`/`builder`/`designer` roles as the rest of the dev panel.

---

## Persistence Tiers (When to Write the DB)

The engine keeps live state in RAM (`world.js` Maps, `environment.js` `state`) and writes Postgres selectively. Every field a system mutates belongs to exactly one tier — decide the tier **before** adding a write:

| Tier | Meaning | Write policy | On crash |
|---|---|---|---|
| **Durable** | must survive any death | write-through at the mutation site (as most code does today) | intact |
| **Checkpoint** | must survive a clean restart; bounded loss on a crash is fine | write at logout/despawn and coarse event boundaries — never per-tick | loses ≤ one interval, always in a benign direction |
| **Derived / ephemeral** | recomputed or irrelevant at boot | never written from ticks or transits | recomputed / reset at boot |

Examples as built: **durable** — credits/bank, inventory moves, deaths/kills, door `lock_state`/`hp`/installed-lock `tags`, `generators.fuel_remaining` + wiring/destroyed/recover flags, `furniture.hp`, apartments/rent. **Checkpoint** — surveillance heat (written on raise, on zero, and at logout; decay is RAM-only), `body_temp_c` (0.5 °C write granularity), and the coalesced hot-path player fields: `current_zone`, combat `hp`/`stamina`, survival `hunger`/`thirst` (all written off the hot path via a dirty flag + batched flush — see [Coalesced hot-path writes](#coalesced-hot-path-writes-dirty-flag--batched-flush) below). **Derived** — door `is_open` during movement transits (DB always holds the resting state; explicit `open`/`close` verbs still persist), NPC live position (`npcs.zone_id` — boot places at last deliberate placement or `home_zone`; permanent relocation = edit `home_zone` or use the dev-panel move), power-derived columns (`power_zones.status/available_kw/current_load_kw`, `generators.remaining_kw`, `lighting_states` counts — all diff-gated and rebuilt by `recomputePower()` at boot), `zoneTemps`, the moving weather field, and the `world_clock` anchor (persisted only on 30-game-minute/day boundaries; boot catch-up math reconstructs exact time from any anchor).

Rules of thumb:
- **New per-tick or per-transit state starts at derived/checkpoint unless it's money or inventory.** A decaying meter never needs a per-tick write — write it where it's raised, zeroed, and at logout.
- There is deliberately **no** generic dirty-flag/flush *framework* and **no** shutdown flush: every checkpoint/derived field must be *crash-benign by construction* (restored slightly stale in a direction that doesn't reward crashing). If a field can't tolerate crash loss, it's durable — write it through. (The coalesced hot-path fields below carry their own ad-hoc `_*Dirty` flags — that's per-field plumbing, not a framework.)
- Diff-gate any recurring bulk UPDATE (`IS DISTINCT FROM` in SQL, or a last-saved stamp in JS) so a stable world writes nothing.

### Coalesced hot-path writes (dirty flag + batched flush)

The highest-frequency player writes — position (per step), combat `hp` (per swing), and
the survival/regen resources (per tick) — do **not** issue a round trip at the mutation
site. Live state is authoritative in RAM (`world.players`), so the mutation site sets a
per-field **dirty flag** and a low-frequency **batched flush** persists every dirty player
in **one** `UPDATE … FROM (VALUES …)` round trip. This decouples DB round-trip *count* from
player count × action-rate on exactly the paths that scale worst — a busy zone of 200
players is the same handful of writes/interval as a quiet one (the payload grows; the
round-trip count doesn't). It is the write-side mirror of the [Read Tiers](#read-tiers-where-data-lives-at-runtime).

As built (all in `server/engine/`):

| Field(s) | Dirty flag | Flush | Cadence | Crash-rewind bound |
|---|---|---|---|---|
| player `current_zone` (+ move `stamina`) | `_posDirty` | `flushDirtyPositions` (commands/movement.js) | `'1m'` scheduler | ≤ ~1 min, **plus** an immediate write-through on interior/building **threshold** crossings |
| combat `hp` (+ `stamina`) | `_resDirty` | `flushDirtyResources` (combat.js), called at end of `tick()` | 1 s (combat tick) | ≤ ~1 s |
| survival `hunger`/`thirst`/`hp`/`stamina`/`body_temp_c` | deferred into a local `Set` | inline batch at end of `resourceTick` (gameLoop.js) | `'1m'` scheduler | ≤ ~1 min |

`restRegenTick` (hp/stamina regen) writes nothing of its own — it sets `_resDirty` and rides
`flushDirtyResources`. Position also folds `stamina` into its flush; combat also carries
`stamina`; the same value written by more than one flush is a harmless last-writer-wins no-op.

**Invariants — the cost of this pattern is discipline, and a violation fails *silently*
(no error, just an un-persisted change). Preserve all of these:**

1. **Set the dirty flag at *every* mutation site.** Any new place that damages a player, moves
   them, or drains a resource must set the matching `_*Dirty` flag (or add to the deferred
   `Set`). A new damage source that forgets `_resDirty` deals damage that never persists.
2. **Never mutate a coalesced field *after* its flush runs in the same tick.** `flushDirtyResources`
   is the last statement in `tick()` on purpose. Code added after it that changes hp/stamina
   won't be seen until the next tick's flush (usually fine — ≤1 s — but know it).
3. **Write-through + clear the flag on death and graceful logout.** `handlePlayerDeath` and the
   disconnect handler (`server/index.js`) both write the full row and clear `_posDirty`/`_resDirty`,
   so those authoritative writes aren't re-clobbered by a later stale flush. Graceful logout also
   persists `hp`/`stamina`, which closes the ≤1 s combat-log window for clean exits (only a hard
   crash keeps it).
4. **A player written through mid-loop must be dropped from that cycle's batch.** `resourceTick`
   `.delete()`s a player from `dirtyResources` right after `handlePlayerDeath`, or the post-loop
   batch would overwrite the fresh respawn row with pre-death stats. Any future "write this row now,
   inside the loop" branch must do the same.
5. **Offline players are DB rows, not live players — they keep direct writes.** `pvpSwingSleeping`
   attacks an offline defender's row directly; it is not in `world.players` and must not be routed
   through a flag/flush.
6. **The batch persists RAM verbatim; stamps update only on success.** `resourceTick`'s diff-gate
   stamp (`_lastSavedResources`) and no-write tripwire counters are set *after* the batched write
   succeeds, so the stamp always reflects the last *successful* persist (a thrown batch leaves rows
   dirty to retry next cycle).

**What this trades:** the DB is no longer a live mirror of RAM — anything reading `players`
out-of-band (admin dashboards, analytics, one-shot scripts) sees data stale by up to the flush
interval. In-process reads are unaffected (RAM is authoritative). Money, inventory, deaths, and
kills stay durable write-through, so none of that carries crash exposure.

---

## Read Tiers (Where Data Lives at Runtime)

The mirror of Persistence Tiers, for the read side. Prod Postgres is **remote** (Neon), so every
`query()` is a pool checkout plus a network round trip — tens of milliseconds each. The latency
problem is never query cost (indexing is thorough) but **round-trip count**: hot paths chaining
single-row reads serially, and background ticks holding pool slots the moment a player command
needs one. Before a new feature reads anything, decide which tier the value lives in — same
discipline as deciding a write's persistence tier:

| Tier | What lives here | Correctness contract | As built |
|---|---|---|---|
| **Boot-loaded world Map** | content + live entity state read constantly | **every** writer funnels through a helper that updates Map + DB together | `world.zones/npcs/doors/orgs/furniture/spawnTimers…` (world.js) |
| **Write-through module cache** | small global tables | all writers live in the one module that owns the cache | world flags (flags.js), per-player skill IP (ip.js), **item templates (items-cache.js — every items writer calls reloadItem/deleteItemCache; runtime minters: keycards, datachips, cassettes)** |
| **Event-bust + TTL cache** | derived per-player values | main mutation paths emit an event that busts; a short TTL bounds the writers that don't; staleness must be **benign** | carried weight, equipped weapon (`inventory.changed` + 5 s) |
| **TTL content cache** | authored content, static at runtime | dev CRUD invalidates; TTL covers out-of-band writers | quest definitions (plugins/quests, 30 s); `security_devices` (plugins/surveillance, 12 s — every in-file writer calls `invalidateDeviceCache()`, the TTL only bounds regress + offline scripts) |
| **Query fresh** | anything gameplay-critical with uncoordinated writers | none needed — the DB is the only truth | `wanted`/`heat` player flags; `generators`/`power_zones` (the power sim re-reads both every cycle) |

**The cache-safety test: a cache is only as safe as its write funnel.** Before caching a table,
grep *every* `INSERT/UPDATE/DELETE` against it. If writers are scattered and don't (or can't)
maintain the cache, either build the write funnel first or stay on "query fresh" — a stale cache
that misrenders lights or sells from a phantom shelf is strictly worse than a round trip. This is
the same bug class as [the source-of-truth audit](audits/source-of-truth-audit.md). `furniture` and
`npcs` are the two tables that had to earn their funnel before they could be cached; both are now
boot-loaded Maps:

- `furniture` — ~40 scattered writers funneled through `insertFurniture`/`updateFurniture`/
  `deleteFurniture` (`world.js:594,605,616`), which is what let describeZone's per-move furniture
  read move onto the `world.furniture` Map (indexed by zone, so a room render is a Set lookup, not
  a scan). **Bulk writers (the environment.js light sweeps) hand their SQL to `updateFurnitureWhere`
  / `deleteFurnitureWhere`** (`world.js:628,633`), which append `RETURNING` and re-cache exactly the
  rows Postgres says it touched. Never hand-write a JS mirror of a `WHERE` clause or a `SET`
  transform to re-cache yourself — that's a second source of truth for the predicate, and drift
  between the two silently stales the cache.
- `npcs` — every writer (vendor credits/stock, AI safe runs, hp saves, evictions, broadcast
  staffing, poker bankrolls) funneled through `updateNpc`/`syncNpc` (`world.js:422,430`); SQL-side
  increments inside a transaction use `RETURNING` + `syncNpc`.

Any new writer to either table MUST use its funnel — a raw `query('UPDATE furniture …')` now
silently desyncs room descriptions, and a raw `UPDATE npcs` desyncs shop shelves. Every content
table's decided read tier is machine-readable as `readTier` in
`server/models/content-registry.js` — regress fails a content table that hasn't declared one.

Rules of thumb when building features:

- **Hot paths (per-move, per-swing, per-condition, per-tick) must not add awaited round trips.**
  Derive from the live player object / world Maps, or pick a cache tier above. A value recomputed
  unchanged on every step (the old per-move carried-weight scan) is a tier decision that defaulted
  to "query fresh" by accident.
- **Never query inside a loop.** Batch with `WHERE id = ANY($1)` or a `GROUP BY` aggregate
  (vendor shelves, container weights, media-deck playlists were all per-row loops once).
  **This includes looping over players.** A per-minute tick that calls a single-player helper for
  each live player is the same bug wearing a hat: it costs one remote round trip per player per
  tick whether or not that player owns anything relevant. Two engine helpers exist so you never
  have to hand-roll it — [`resolveInventoryForPlayers(ids, opts)`](../server/engine/inventory.js)
  (the batched twin of `resolveInventoryItem`, returns `Map<playerId, rows[]>`) and
  [`patchInventoryCustomData([[invId, patch], …])`](../server/engine/inventory.js) (one multi-row
  `VALUES` UPDATE, the write-side twin). Measured: `clothing-wetness` and `flashlight` between them
  were ~6 round trips per player per minute — **and `clothing-wetness` sits inside the awaited
  `tick.minute` hook**, so at 50 players those serial waits stall radiation and drug decay behind
  them while holding a pool slot.
- **Independent reads issue together** (`Promise.all` — describeZone's 4-way batch, dialogue
  option gating); **same-row writes coalesce into one UPDATE** (cmdMove's
  current_zone/radiation/stamina).
- **Resolve a shared value once per tick, not once per player.** Weather, the world clock and the
  power map are identical for everyone in a given tick, so deriving them inside a per-player loop
  multiplies their cost by the player count for no gain. `resourceTick` called
  `getEnvironmentState()` *per player* to read one string — and that function spreads
  `getHUDPayload()` + `getForecast()` + `getPowerMap()`, the last of which allocates an object per
  power-model zone. A 50-player world rebuilt a thousands-of-zones map fifty times a minute for one
  field. Hoist it above the loop.
- **A write that changes nothing is still a round trip.** Compare against what you last wrote and
  skip (the card tables' `_persistedJson`, `logActivity`'s probabilistic prune). But keep the
  comparison to state *you* own — coalescing against a shared read cache promotes that cache into a
  write authority, which is why player-flag writes are deliberately **not** coalesced (see the note
  in `server/engine/flags.js`).
- **A TTL equal to the tick period that reads it is not a cache.** If a snapshot holds for 4000 ms
  and the tick that reads it runs on the `'4s'` cadence, `now - ts < ttl` is false on every single
  pass — you pay the full round trip *and* the bookkeeping, and nothing in the code looks wrong.
  Surveillance's device snapshot sat like that and measured **25% of all database traffic** on a
  one-player session. Size a TTL clear of every cadence that reads it (it now spans the 4s/5s/6s
  ticks at 12 s), and remember the TTL is only ever a backstop for out-of-band writers when the
  in-process writers all invalidate.
- **Distinguish "polls the DB" from "runs periodically" before event-driving a tick.** A tick
  whose trigger is the *game clock* (media decks aligning to the current playlist slot) can't be
  event-driven — no edit event fires when time rolls into the next slot. The fix there is to make
  the tick's *reads* come from a cache tier while keeping the cadence, not to remove the tick.
  Only ticks that exist purely to notice *edits* (a device planted, a camera repaired) are
  candidates for replacement by an invalidation event — and only if every writer is funneled.
- **Don't find rows by `flags::text LIKE '%"key"%'`.** It casts every row's JSONB to text
  (unindexable full scan) and matches keys *and* values alike. For boot-loaded tables, filter the
  world Map by key presence (`'media_deck' in f.flags`); for query-fresh tables, use a JSONB
  operator (`flags ? 'key'`).
- **Scheduled work idle-gates by default.** `scheduler.js` skips every registered callback when
  `hasActivePlayers()` is false — a recurring tick that reads the DB on an empty world keeps a pool
  connection alive inside its idle window, which stops Neon's compute from ever suspending
  (scale-to-zero) and bills 24/7 for nobody. Registering through scheduler.js also jitters cadence
  phase and spreads same-cadence subscribers so tick convoys can't hold every pool slot at a minute
  boundary. A raw `setInterval` that awaits `query()` bypasses the gate entirely — that's the bug
  that pinned the compute awake (surveillance camera refresh). Opt a tick out with
  `{ runWhenEmpty: true }` only when it genuinely must run empty; settlement by `resolve_at`
  timestamps and clock-derived state both catch up fine on the first tick after a login, so the
  opt-out is reserved for pure in-memory continuity work with no DB round trip.
- **Narrow the column list on wide tables.** `items`/`npcs`/`zones` carry fat JSONB
  (`dialogue_tree`, `behaviour_graph`, tag bags) and `audio_samples.data` is base64 audio —
  `SELECT *` on these repeatedly is how the Neon egress budget died once already.
- **Every `query()` costs a pool slot for its full round trip** — fire-and-forget event
  subscribers contend with player commands even though nothing awaits them. Cheap queries in
  event handlers still count against the hot path.

---

## Measuring Runtime Cost (before optimising anything)

Every claim in the tiers above is measurable in a couple of minutes with a throwaway script in the
repo root. Write it, run it, **delete it** — do not commit profilers. Two recipes cover almost
everything:

**DB round trips.** Patch the driver *before* anything imports the pool, so every query — including
transaction bodies — is counted exactly once:

```js
import pg from 'pg';
const orig = pg.Client.prototype.query;
pg.Client.prototype.query = function (...a) {
  const t = typeof a[0] === 'string' ? a[0] : a[0]?.text || '?';
  if (counting && !/^SET search_path/.test(t)) { total++; bySql.set(t, (bySql.get(t) || 0) + 1); }
  return orig.apply(this, a);
};
// then: await initWorld(); loadItems/Drugs/Recipes/MisSettings; loadPlugins(); initEnvironment();
// place synthetic live players via setLivePlayer(); startGameLoop(fn); sample for 60-75s.
```

**Outbound socket bytes.** Pass your own function to `startGameLoop()` **and**
`messaging.setBroadcast()`, and sum `Buffer.byteLength(JSON.stringify(payload))` bucketed by
`payload.type`. For per-command payloads, call `handleCommand(input, player, broadcast)` directly
and measure the returned object — that is what `index.js` sends.

Three rules learned the hard way doing this:

- **Sample at 1, 5 and 20 synthetic players, and compare the *slope*.** Batching work changes the
  gradient, not the intercept; a single-player measurement cannot confirm it. Idle DB traffic
  measured 45 → 112 → 163 round trips/min at 1/5/20 players — i.e. ~6 per player per minute, which
  is the number that matters, not the total.
- **Check the profiler actually exercised the thing.** An early run reported "0 queries per
  command" — the commands were throwing, because `handleCommand(input, player, broadcast)` takes
  the input *first* and the calls had the arguments swapped. Assert on real output before trusting
  a zero.
- **Know what your synthetic players don't have.** Ones cloned from a template own no inventory, so
  any code path gated on carrying something never runs and its cost never shows up.

Beware `pg_stat_user_tables` seq-scan counts as a signal: `furniture` (886 rows) showed 291k
sequential scans, which looks alarming and is simply the planner being right — on tables that
small a seq scan beats the index that already exists. `EXPLAIN (ANALYZE, BUFFERS)` before adding
any index.

---

## Lessons Learned (Worth Reading Before Changing Infra)

These are real bugs hit during deployment, kept here so they don't get relearned:

- **`pg.Pool` needs `DATABASE_URL` actually loaded into `process.env`.** Node does not read `.env` files on its own, and dotenv's default lookup only checks the *current working directory* — which a git worktree never has, since `.env` is git-ignored and worktrees get tracked files only. `db.js:12-23` walks up from cwd to the nearest `.env` and loads that. Break this and local dev fails with `ECONNREFUSED ::1:5432` / `127.0.0.1:5432` — pg falling back to a local Postgres that doesn't exist.
- **The content pipeline requires Neon's direct/unpooled endpoint**, not the pooled connection string. Point the importer at the direct endpoint; the runtime server can use either.
- **A boolean sent to an INTEGER column crashes `pg`, not just that query.** Postgres columns like `pvp_enabled`/`is_safe_zone`/`is_locked` are `INTEGER` (0/1), but JS naturally sends `true`/`false`. Every write path that accepts a boolean from client input coerces it explicitly (`value ? 1 : 0`) rather than trusting the caller.
- **An uncaught error in one request handler can take down the entire process**, not just fail that one request — Node doesn't isolate requests from each other the way a forked-process server would. Every database-writing route handler is wrapped in try/catch, and `index.js` also registers `process.on('uncaughtException'/'unhandledRejection')` as a last-resort net so an unforeseen bug logs instead of crashing the game for every connected player.
- **A hardcoded `ws://` URL breaks the moment the page is served over HTTPS** — browsers block insecure WebSocket connections from a secure page (`Mixed Content` error). The client detects `location.protocol` and picks `wss://` or `ws://` accordingly instead of assuming one.
- **Render's dashboard "Name" field doesn't reliably change the live subdomain** if the service already has one. Treat the URL as fixed at creation time.
- **Neon snapshot branches count against a cap and don't self-clean fast enough.** The content deploy takes an instant copy-on-write `predeploy-*` branch of prod before touching it. `expires_at` (14 days) is too slow at real deploy cadence — they pile up past the branch cap. The workflow prunes all but the newest 5 *before* each snapshot. Anything creating Neon branches needs an active prune, not just an expiry.
- **The content deploy's deletion pass needs deferrable, ownership-correct FKs — and can't reconcile un-git-tracked drift.** The first real prod deploys hit a cascade of these; the full writeup lives in [content-pipeline.md → Deploy lessons](content-pipeline.md). In short: content-parent FKs must be `DEFERRABLE INITIALLY DEFERRED` with `ON DELETE CASCADE` (owned children) / `SET NULL` (loose refs); a `CREATE TABLE IF NOT EXISTS` never alters a drifted existing table so re-assert constraints via `DROP`+`ADD`; a git baseline seeded from a local DB with divergent PKs needs a deliberate one-shot to reconcile ("git wins"); and a mid-import `deadlock detected` is just the live server contending — retry the deploy.
- **Primary keys are `TEXT` (UUIDs), never integers — never `parseInt()` an id.** Every `id` column in the schema is `TEXT PRIMARY KEY`, populated with `randomUUID()`. A command that takes a row id from the client (e.g. `stowid <id>`, `closecontainer <id>`) must pass the string straight through to the query. `parseInt()` on a UUID silently corrupts it: a UUID starting with a letter becomes `NaN`, and one starting with a digit is truncated to its leading digits — either way the `WHERE id=$1` matches nothing and the handler fails quietly (it returns `null`, so the player sees no message at all rather than an error). This bit the container close path; the symptom is "the action just does nothing sometimes" because whether it works depends on the random first character of the id.

---

## Plugin System

The loader itself (`plugins.js`) is a file-drop manifest + `index.js` exporting `hooks`, `commands`, and optionally `routeHandler`/`specializedActions`. Plugins can also register Actions, input matchers, and Event subscriptions imperatively in their `index.js`. **97 plugins exist — the authoritative catalogue is [plugins.md](plugins.md); it is deliberately not duplicated here.**

```javascript
// plugin.json (quests as example of richer manifest)
{
  "name": "quests",
  "version": "1.0.0",
  "description": "Quest domain: lifecycle Actions plus event-driven objective tracking.",
  "commands": ["quests", "quest", "ql"],
  "routePrefix": "/quests",
  "actions": { "registers": ["START_QUEST", "ADVANCE", "COMPLETE", "TURN_IN"] },
  "events": {
    "emits": ["quest.started", "quest.advanced", "quest.completed", "quest.turned_in"],
    "consumes": ["enemy.killed", "item.given", "zone.entered"]
  }
}

// index.js
export const commands = {
  "quests": (args, raw, player) => { /* render quest log */ },
};
export const routeHandler = (path, method, body, auth) => { /* dev CRUD */ };
// Actions registered imperatively at module load via registerAction(...)
// Events subscribed at module load via on('enemy.killed', handler)
```

**The hook reference — every hook the engine fires, its firing site, args and whether its return is used — lives in [server.md → Hook reference](server.md#hook-reference).** Not duplicated here.

**Hooks can be called into, not just reacted to.** `fireHook`'s "last non-undefined return wins" behavior means a hook isn't only a notification — a route handler can `fireHook('worldValidator.runFull')` and use the plugin's return value directly as the HTTP response. That is how the zone-validator's dev-panel button works end to end with zero changes to `plugins.js`.

Plugins load at server start by scanning `/plugins/*/plugin.json`. There is no in-panel plugin manager UI yet — enabling/disabling is still done by adding/removing the folder and restarting. Plugins own player-typed commands (a `commands` export + `plugin.json` declaration; plugin commands win dispatch over engine builtins), dev-panel routes (`routeHandler` + `routePrefix`), specialized actions, and input matchers. See [reference/plugin-architecture-analysis.md](reference/plugin-architecture-analysis.md) for the historical extraction review and [plugin-standard.md](plugin-standard.md) for the current plugin contract.

---

## Local Development Setup

```bash
git clone <repo>
cd architect-mud
# Create .env with DATABASE_URL pointing at your local Postgres
# (e.g. postgresql://postgres:postgres@localhost:5432/architect_dev)

npm install
npm run db:schema        # create the schema
npm run content:import   # load world content from the git content/ tree
npm run dev
```

Visit:
- `localhost:3000` — Player client
- `localhost:3000/dev` — Dev panel (`admin` / `admin123` by default)

---

## Deployment (Actual)

Render free Web Service, not a VPS:
- `git push` to the connected GitHub repo triggers an automatic build + deploy
- No PM2/Nginx — Render's platform handles process supervision and HTTPS termination
- `render.yaml` pins the free plan and start command
- Schema + content reach prod through the CODEX content-deploy CI on push to `main` ([content-pipeline.md](content-pipeline.md)); one-shot data transformations run from a developer's machine against the live Neon database (`node --env-file=.env.prod …`), since Render's free tier has no shell access

---

## Open Architecture Questions

- Should the in-memory world cache eventually move to Redis if multiple server instances are ever needed? (Not a problem yet — Render free tier is a single instance.)
- Apartment storage (a per-unit inventory) is a natural next step but not built — currently apartments only gate sleep and provide a locked room, no item storage.
- Rate limiting strategy for the WebSocket server under real concurrent load has not been tested past a handful of simultaneous connections.
- No dev-panel-UI-registration API exists yet — a new gameplay system that wants its own editor tab still requires editing `devpanel/index.html` directly.
- Should darkness/unpowered visibility ever gate gameplay (hidden exits, items, NPCs) beyond the current flavor-text-only treatment? Deliberately deferred when the power/lighting system was built.
