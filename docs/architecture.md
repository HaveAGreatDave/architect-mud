# Architecture Document

## Guiding Principle

**No one touches code to create content.** World builders, writers, and designers work entirely through the dev panel — a browser-based world editor. The codebase is the engine. The content (zones, items, enemies, NPCs) is data living in Postgres. These two things stay separate: publishing a zone edit never requires a deploy.

---

## Stack Overview (As Built)

| Layer | Technology | Role |
|---|---|---|
| **Runtime** | Node.js (ES modules) | Server, game loop, real-time logic |
| **Transport** | `ws` (raw WebSocket) | Real-time bidirectional communication |
| **Frontend** | Vanilla JS, single-file HTML | Player client + Dev panel — no build step |
| **Database** | PostgreSQL via Supabase (free tier) | Persistent world state, players, items — single source of truth |
| **Query layer** | `pg` (node-postgres), raw SQL | No ORM — schema is hand-written in `schema.js` |
| **Auth** | JWT (`jsonwebtoken`) + SHA-256 password hashing | Player accounts, dev/admin roles |
| **Hosting** | Render (free Web Service tier) | Node server, auto-deploys on git push |

### Why this stack, in practice

The original plan considered SQLite for local dev and a VPS for production. That changed early: the build environment has no local network access, so any local-only database needed to also work over the network from the first line of code, which meant going straight to Postgres rather than maintaining two schemas. Supabase's free tier provided that without cost. Render was chosen over Vercel/Netlify/Cloudflare (serverless — no persistent WebSocket support) and over Railway (no permanent free tier) specifically because it supports long-lived WebSocket connections on its free plan.

No ORM was used. The schema is small enough that hand-written SQL in `schema.js` is easier to read and debug than a generated layer, and every query in the codebase is a plain parameterized `pg` call through a single `query()` helper in `models/db.js`.

### Schema and content lifecycle (no startup migrations)

The server **does not** touch the schema or world content on boot. The two are managed separately and deliberately:

- **Schema** lives entirely in `server/models/schema.js` as the exported `SCHEMA_SQL` string (idempotent DDL). Apply it with `npm run db:schema`. The same string is reused by the dev-panel export, so a backup always carries the schema that fits its data.
- **Content** is owned by production. The dev-panel export (`/dev` → Power Tools → *Database Backup*) emits a full `.sql` dump (schema + world content, no player/PII rows). Restore it into a fresh DB with `psql -f` or `npm run db:restore -- dump.sql` to seed local/offline dev or recover a backup.
- **Schema changes** are made by a one-shot script run once against production, plus a matching edit to `SCHEMA_SQL`. There is no auto-run migration path — this is what keeps dev from being disrupted by content-rewriting code firing on every restart (the reason the old startup `migrate()` was removed).

---

## Repository Structure (Actual)

```
/
├── server/
│   ├── index.js              # HTTP + WebSocket entry point, auth, global error handlers
│   ├── keepalive.js          # Pings Render /health AND runs SELECT 1 against Supabase every 10min
│   ├── engine/
│   │   ├── gameLoop.js       # Tick system: combat tick, minute tick, ambient tick, spawn tick
│   │   ├── combat.js         # Combat resolution, cooldowns, enemy attack timers
│   │   ├── commands/         # Command parser/dispatcher — index.js + per-domain files
│   │   │   ├── index.js      #   Entry point: routes commands to domain handlers + plugin commands
│   │   │   ├── combat.js     #   Attack, flee, steal
│   │   │   ├── describe.js   #   Room description renderer, look/examine
│   │   │   ├── movement.js   #   Move, go (named destinations)
│   │   │   ├── inventory.js  #   Take, drop, use, equip, craft; recomputeArmor
│   │   │   ├── housing.js    #   Rent, lock, pick, upgrade lock, sleep
│   │   │   ├── social.js     #   Say, yell, whisper, talk, who
│   │   │   └── world.js      #   Map, stats, skills, help, switch/flip, open/close windows
│   │   ├── world.js          # In-memory zone/entity cache, DB is still source of truth
│   │   ├── environment.js    # Time/calendar, weather, ambient + artificial light, power grid simulation
│   │   ├── skills.js         # Skill definitions, XP/rank curve, generic skillCheck()
│   │   ├── crafting.js       # Recipes, quality tiers, station requirements
│   │   ├── mutations.js      # Radiation-triggered permanent mutations
│   │   ├── factions.js       # Reputation tiers and effects
│   │   ├── vendor.js         # Buy/sell with faction rep discounts
│   │   ├── apartments.js     # Property ownership, locks, lockpicking, safe sleep
│   │   ├── actions.js        # Canonical mutation path: registerAction / dispatchAction
│   │   ├── events.js         # In-process event bus: on / emit
│   │   ├── flags.js          # Player/world flag store + evalConditions; registers SET_FLAG/CLEAR_FLAG
│   │   ├── graph.js          # Script graph runner (runGraph/runScriptById) + orchestration actions
│   │   ├── tags.js           # Tag helpers (hasTag, tagValue, tagsOf) + re-exports TAG_CATALOG
│   │   ├── supertags.js      # Supertag materialization helpers (materializeItemTags, ownTags)
│   │   ├── specializedActions.js  # Verb-first tag-gated action registry (registerSpecializedAction / fireSpecializedAction)
│   │   ├── ai-behaviour.js   # VINE behaviour tree runtime (tickEntityAI, initBlackboard)
│   │   ├── pathfinding.js    # BFS zone pathfinding (findPath, getZonesInRadius)
│   │   ├── locks.js          # Lock type registry (registerLockType, resolveLockAuth)
│   │   ├── lockAuthHandlers.js  # Auth handlers wired by the doors plugin
│   │   ├── channels.js       # Radio channels: definitions, send, history (CHANNEL_DEFS)
│   │   ├── effects.js        # Timed status effects framework (applyEffect, tickEffects)
│   │   ├── bodily.js         # Digestive/bladder pressure system (tickBodily)
│   │   ├── appearance.js     # Character appearance generation + description helpers
│   │   ├── ip.js             # IP/XP: awardIp roll, raiseStat (spends Net XP), statCost, grantXp
│   │   ├── mis.js            # Mature Interaction System — gated by server + player opt-in
│   │   └── plugins.js        # Hook-based plugin loader
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
│   ├── game/index.html       # Player client — single file, no framework, no build step
│   ├── devpanel/index.html   # Dev panel — same approach
│   └── shared/
│       ├── tagCatalog.js     # Single source of truth for item tag definitions — read by both client and server
│       └── tagSupertags.js   # Supertag registry (TAG_SUPERTAGS) — dual-mode file like tagCatalog.js
├── plugins/
│   ├── factions/             # Faction rep display (`factions`/`rep` commands)
│   ├── mutations/            # Mutation display + radiation-tick mutation check (`mutations` command)
│   ├── weather/              # Deterministic 7-day seeded weather forecast (environment.init + advanceWeather)
│   ├── zone-validator/       # World integrity checks + broken exit repair (worldValidator hooks)
│   ├── crafting/             # Recipe display and crafting (`craft`, `recipes` commands)
│   ├── quests/               # Quest lifecycle (START_QUEST/TURN_IN actions, objective tracking, `quests` command)
│   ├── interactions/         # Posture, emotes, social gestures (`sit`, `wave`, `examine`, etc.)
│   ├── container/            # Container items — open/stow/pull via the OPEN specialized action
│   ├── doors/                # Door open/close/lock/unlock specialized actions
│   ├── weapon/               # ATTACK specialized action (player attack path)
│   ├── food/                 # EAT specialized action for consumable-tagged items
│   ├── drugs/                # USE/INJECT specialized actions for drug-tagged items
│   ├── lighting/             # SWITCH/FLIP/TURN specialized actions for light fixtures
│   └── clothing-wetness/     # Per-item wetness from rain/snow + temperature effects
└── render.yaml                # Render free-plan service config
```

There is no `/data/` JSON directory and no separate seed-from-JSON pipeline. World content lives only in Postgres (production is the source of truth) and is edited through the dev panel. A fresh database is populated by restoring a `.sql` dump exported from the dev panel — not from a checked-in seed file. (Historically content lived as JS literals in a `seed.js`; that drifted from the live DB and was retired in favor of export/restore.)

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
The world-building interface. Accessible only to accounts with `role: dev`/`admin`. REST-only (no WebSocket) — every save/delete goes through `api/routes.js` and triggers an in-memory hot-reload via `world.reloadZone()` or equivalent. Every API call is wrapped with proper error handling: network failures, non-2xx statuses, and unreadable responses all surface as a toast instead of failing silently.

---

## The Dev Panel — In-Game World Editor

### Modules (Built)

#### 🗺️ Zone Editor
- Name, description, danger rating, radiation level
- PvP flag, safe-zone flag, **apartment flag** (`flags.is_apartment` — makes a zone rentable; saving a zone with this checked auto-registers an `apartments` table row if one doesn't exist yet), **building flag** (`flags.is_building`, drives entrance-discovery text in neighboring zones) and **interior flag** (`flags.is_interior`)
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
- Type, subtype, weight, value, rarity
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
- High-contrast theme toggle, log out
- The dev panel previously had no settings screen at all; this is new, separate from the player client's own settings modal

### Retired
- **Standalone Apartments tab** — removed. Apartment-specific fields (owner, lock state/difficulty, rent) moved into the Zone Editor's Apartment Details sub-section, and the old 4-unit batch-builder UI was dropped as redundant with adding rooms one at a time and checking the apartment flag. The underlying `apiBuildApartmentBlock` route still exists server-side but isn't surfaced in the UI.

### Not built (originally planned, deprioritized)
- Quest editor in the dev panel UI — quests are authored via the REST API (`/quests` CRUD, owned by the quests plugin) but there's no visual editor tab in `devpanel/index.html` yet
- Loot table editor as a separate named-table concept — loot tables are inlined per-enemy/per-item instead
- Ghost mode — no invisible/invulnerable admin walk-through mode
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
  → handleCommand() parses + dispatches to cmdAttack()
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

## Database Schema (Actual Tables)

```sql
players           -- account, stats, skills location, credits, bank_credits, anchor/current zone
player_skills     -- player_id, skill_id, rank, xp
zones             -- id, name, description, exits (JSONB), flags (JSONB), danger_rating, radiation_level
items             -- template definitions: type, rarity, effects, stat_modifiers
player_inventory  -- player_id (or "_ground_<zone_id>" for dropped items), item_id, quantity
enemies           -- template definitions: stat block, loot_table, behavior, faction
zone_spawns       -- zone_id, enemy_id, max_count, spawn_weight, respawn_seconds
npcs              -- id, name, zone_id, dialogue_tree (JSONB), vendor_inventory (JSONB)
furniture         -- id, zone_id, name, description, flags; is_light/light_on/light_type for switchable lights
factions          -- id, name, description
player_faction_rep -- player_id, faction_id, reputation score
loot_tables       -- named, reusable weighted-drop tables (lightly used; most loot is inlined)
world_events      -- log of significant events
player_corpses    -- lootable death drops, expire after 10 minutes
apartments        -- zone_id (PK), owner_id, owner_handle, is_locked, lock_difficulty, rent_cost

-- Environment system (schema in server/models/schema.js)
world_clock       -- single-row clock: game_date, game_time_minutes, day_of_week, season, last tick timestamps
weather_forecast  -- 7-day deterministic seeded forecast
generators        -- id, zone_id, name, generator_type (building/city_plant/player), capacity_kw, status; only
                   -- 'player' type consumes fuel — building/city_plant generators are permanent, no fuel
power_zones       -- id (= a zone id), source_type, generator_id (FK), capacity_kw, current_load_kw, status
                   -- (powered/overloaded/offline) — a zone with no row here is simply unpowered
lighting_states   -- zone_id (PK), has_emergency_lighting, artificial_light_level, fixture_count
```

Ground-dropped items reuse the `player_inventory` table with a synthetic `player_id` of `_ground_<zone_id>` rather than a separate table — this keeps "take" / "drop" using the same insert/delete logic as normal inventory management.

`apartments` is keyed by `zone_id` rather than having its own surrogate ID — an apartment is 1:1 with a zone, not a separate spatial entity. Ownership and lock state are cached in-memory in `world.js` (`world.apartments`) for fast reads on every room description, with writes going through Postgres first and then patching the cache.

`power_zones` is similarly keyed by zone id rather than a surrogate one — a zone either has a power record (it's connected to some generator's network) or it doesn't, and "no row" is the unpowered state rather than a separate boolean flag.

---

---

## Environment System (Time, Weather, Power & Lighting)

`environment.js` owns a second in-memory cache (`state`), parallel to and independent of `world.js`'s entity cache. It's populated and refreshed on its own schedule rather than through the main game loop.

**Time & weather.** A single-row game clock (`world_clock`) advances in-game minutes, tracks day/night phase (dawn/day/dusk/night) and season, and drives a 7-day deterministic seeded weather forecast. Two ticks run independently of `gameLoop.js`'s own timers: a 30-minute tick (ambient light recalculation, street light toggling) and a 24-hour tick (full power network simulation, weather advancement).

**Power grid.** Generators are either permanent (`building` and `city_plant` types — no fuel, never run dry) or fuel-consuming (`player` type, for future portable generators). Installing a generator from the Zone Editor's Generator sub-section computes a "network" of zones it powers:
- A `city_plant` generator's network is every zone that isn't flagged `is_apartment`/`is_interior` — i.e. every outdoor zone gets city power from one source.
- A `building` generator's network is found by a BFS that walks exits in both directions, only crossing into zones flagged `is_apartment`/`is_interior` — i.e. it powers exactly the rooms that belong to that building, no further.

Each zone in the network gets a `power_zones` row and a `lighting_states` row. A simple load-vs-capacity ratio per zone decides `powered`/`overloaded`/`offline` (`POWER_OVERLOAD_RATIO`/`POWER_BLACKOUT_RATIO`), re-simulated on every 24-hour tick and immediately on any install/remove via an exported `recomputePower()` rather than waiting for the next tick.

**Lighting.** Two kinds of light fixture exist as `furniture` rows (`is_light`, `light_on`, `light_type`):
- **Overhead / lamp** — indoor, player-switchable via the `switch`/`flip` command, blocked if the room has no power record at all.
- **Streetlight** — outdoor, *not* player-switchable; toggled automatically by the 30-minute tick on dusk/dawn phase transitions, and re-synced to the current phase on every server boot in case of a restart at night.

**Visibility.** `getZoneVisibility(zoneId)` combines ambient light (time of day) with artificial light (power status + lit fixture count) and weather/fog factors into a `clear`/`dim`/`dark` category, appended as a flavor line to every room description. This is deliberately informational only — darkness doesn't currently hide exits, items, or NPCs; that's flagged as a possible future extension, not something this pass built.

**Dev tools.** `environment.routes.js` exposes time/weather overrides, forced ticks, generator install/remove, and load/failure simulation, all gated to the same `dev`/`admin`/`builder`/`designer` roles as the rest of the dev panel.

---

## Lessons Learned (Worth Reading Before Changing Infra)

These are real bugs hit during deployment, kept here so they don't get relearned:

- **`pg.Pool` needs `DATABASE_URL` actually loaded into `process.env`.** Node does not read `.env` files on its own. `db.js` imports `'dotenv/config'` at the very top specifically to fix this — removing that import silently breaks local development (you'll see `ECONNREFUSED ::1:5432` / `127.0.0.1:5432`, i.e. it's trying to connect to a local Postgres that doesn't exist, instead of Supabase).
- **Supabase's direct connection is IPv6-only on free tier.** Always use the Session Pooler connection string (port `5432`) for any environment without guaranteed IPv6 egress, which includes Render's free compute.
- **A boolean sent to an INTEGER column crashes `pg`, not just that query.** Postgres columns like `pvp_enabled`/`is_safe_zone`/`is_locked` are `INTEGER` (0/1), but JS naturally sends `true`/`false`. Every write path that accepts a boolean from client input coerces it explicitly (`value ? 1 : 0`) rather than trusting the caller.
- **An uncaught error in one request handler can take down the entire process**, not just fail that one request — Node doesn't isolate requests from each other the way a forked-process server would. Every database-writing route handler is wrapped in try/catch, and `index.js` also registers `process.on('uncaughtException'/'unhandledRejection')` as a last-resort net so an unforeseen bug logs instead of crashing the game for every connected player.
- **A hardcoded `ws://` URL breaks the moment the page is served over HTTPS** — browsers block insecure WebSocket connections from a secure page (`Mixed Content` error). The client detects `location.protocol` and picks `wss://` or `ws://` accordingly instead of assuming one.
- **Render's dashboard "Name" field doesn't reliably change the live subdomain** if the service already has one. Treat the URL as fixed at creation time.
- **Supabase free-tier projects can come back from a pause/restore cycle with empty tables**, even though the project itself shows "Active" again. This isn't expected/guaranteed Supabase behavior, but it's been observed; treat world data on the free tier as reproducible-via-reseed rather than precious, or upgrade before it matters.
- **Primary keys are `TEXT` (UUIDs), never integers — never `parseInt()` an id.** Every `id` column in the schema is `TEXT PRIMARY KEY`, populated with `randomUUID()`. A command that takes a row id from the client (e.g. `stowid <id>`, `closecontainer <id>`) must pass the string straight through to the query. `parseInt()` on a UUID silently corrupts it: a UUID starting with a letter becomes `NaN`, and one starting with a digit is truncated to its leading digits — either way the `WHERE id=$1` matches nothing and the handler fails quietly (it returns `null`, so the player sees no message at all rather than an error). This bit the container close path; the symptom is "the action just does nothing sometimes" because whether it works depends on the random first character of the id.

---

## Plugin System

The loader itself (`plugins.js`) is a file-drop manifest + `index.js` exporting `hooks`, `commands`, and optionally `routeHandler`. Plugins can also register Actions and subscribe to Events imperatively in their `index.js`. 15 plugins exist:

```
/plugins/
  ├── factions/           # Faction rep display (factions/rep commands)
  ├── mutations/          # Radiation mutation system: mutations command + tick.minute check
  ├── weather/            # 7-day seeded weather forecast (environment.init + advanceWeather hooks)
  ├── zone-validator/     # World integrity: validates zone exits, repairs broken ones on save
  ├── crafting/           # Item crafting (craft, recipes commands)
  ├── quests/             # Quest lifecycle: START_QUEST/ADVANCE/COMPLETE/TURN_IN actions,
  │                       # event-driven objective tracking, quests/quest/ql commands, dev CRUD
  ├── interactions/       # Posture + emotes: sit, stand, lie, wave, examine, etc.
  ├── container/          # Container items — OPEN specialized action gated on container tag
  ├── doors/              # Door OPEN/CLOSE/LOCK/UNLOCK specialized actions
  ├── weapon/             # ATTACK specialized action (player combat path)
  ├── food/               # EAT specialized action gated on consumable tag
  ├── drugs/              # USE/INJECT specialized actions gated on drug tag
  ├── lighting/           # SWITCH/FLIP/TURN specialized actions for light fixtures
  └── clothing-wetness/   # Per-item wetness from rain/snow + body temperature effects
```

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

| Hook | Fires When |
|---|---|
| `tick.minute` | Every 60 seconds — receives `{ broadcast }` |
| `player.enterZone` | Player moves into a zone |
| `player.death` | Player dies |
| `combat.hit` | An attack lands |
| `zone.describeRoom` | Room description is generated — return value appended to the description text |
| `zone.describeAmbient` | Periodic ambient tick (45s) for occupied zones — return value broadcast as ambient flavor |
| `zone.create` / `zone.update` / `zone.delete` | Zone lifecycle events from the dev panel API |
| `environment.init` | Fired once at server boot after the clock is initialized — receives `{ setWeatherState }` |
| `environment.advanceWeather` | Fired at the start of each 24h tick BEFORE power simulation — receives `{ setWeatherState, currentForecast, currentDate }` |
| `environment.tick30m` / `environment.tick24h` | Environment system's own ticks (ambient light/street lights; full power simulation) |
| `environment.weatherChange` / `environment.sunrise` / `environment.sunset` | Fired from inside the environment ticks above |
| `worldValidator.runFull` / `worldValidator.runZone` | On-demand only — fired by a dev-panel button via `worldvalidator.routes.js`, not on a tick |

**Hooks can be called into, not just reacted to.** `fireHook`'s "last non-undefined return wins" behavior means a hook isn't only a notification — a route handler can `fireHook('worldValidator.runFull')` and use the plugin's return value directly as the HTTP response. This is how the zone-validator's dev-panel button works end to end with zero changes to `plugins.js` itself, and it's worth calling out explicitly here since nothing previously documented that this was possible.

Plugins load at server start by scanning `/plugins/*/plugin.json`. There is no in-panel plugin manager UI yet — enabling/disabling is still done by adding/removing the folder and restarting. There is also no `registerCommand`/`registerRoute`/UI-registration API yet — every plugin so far reaches the engine only through already-exported functions (`query()`, `world.js`'s `reloadZone()`) plus hooks, which is enough for an on-demand tool like the validator but would not yet be enough for a plugin that wants to own a player-typed command or its own dev-panel tab without a core code change. See `docs/plugin-architecture-analysis.md` for the full review of which systems are good extraction candidates and what API gaps block them.

---

## Local Development Setup

```bash
git clone <repo>
cd architect-mud
cp .env.example .env
# Set DATABASE_URL to your Supabase pooler string (or local Postgres)

npm install
npm run db:schema                          # create the schema
npm run db:restore -- architect-dump.sql   # load content from a dev-panel export
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
- Migrations are **not** run automatically on deploy — they're a manual, one-time (or occasional) step run from a developer's machine against the live Supabase database, since Render's free tier has no shell access

---

## Open Architecture Questions

- Should the in-memory world cache eventually move to Redis if multiple server instances are ever needed? (Not a problem yet — Render free tier is a single instance.)
- Apartment storage (a per-unit inventory) is a natural next step but not built — currently apartments only gate sleep and provide a locked room, no item storage.
- Rate limiting strategy for the WebSocket server under real concurrent load has not been tested past a handful of simultaneous connections.
- `gameLoop.js` and `environment.js` run independent `setInterval` schedulers against the same DB pool with nothing coordinating them — works today at this scale, but a unified scheduler is the prerequisite for most of the plugin-extraction work in `docs/reference/plugin-architecture-analysis.md`.
- No dev-panel-UI-registration API exists yet — a new gameplay system that wants its own editor tab still requires editing `devpanel/index.html` directly.
- Should darkness/unpowered visibility ever gate gameplay (hidden exits, items, NPCs) beyond the current flavor-text-only treatment? Deliberately deferred when the power/lighting system was built.
