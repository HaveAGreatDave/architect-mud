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
| **Query layer** | `pg` (node-postgres), raw SQL | No ORM — schema is hand-written in `migrate.js` |
| **Auth** | JWT (`jsonwebtoken`) + SHA-256 password hashing | Player accounts, dev/admin roles |
| **Hosting** | Render (free Web Service tier) | Node server, auto-deploys on git push |

### Why this stack, in practice

The original plan considered SQLite for local dev and a VPS for production. That changed early: the build environment has no local network access, so any local-only database needed to also work over the network from the first line of code, which meant going straight to Postgres rather than maintaining two schemas. Supabase's free tier provided that without cost. Render was chosen over Vercel/Netlify/Cloudflare (serverless — no persistent WebSocket support) and over Railway (no permanent free tier) specifically because it supports long-lived WebSocket connections on its free plan.

No ORM was used. The schema is small enough that hand-written SQL in `migrate.js` is easier to read and debug than a generated layer, and every query in the codebase is a plain parameterized `pg` call through a single `query()` helper in `models/db.js`.

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
│   │   ├── commands.js       # Command parser/dispatcher, room description rendering
│   │   ├── world.js          # In-memory zone/entity cache, DB is still source of truth
│   │   ├── skills.js         # Skill definitions, XP/rank curve, generic skillCheck()
│   │   ├── crafting.js       # Recipes, quality tiers, station requirements
│   │   ├── mutations.js      # Radiation-triggered permanent mutations
│   │   ├── factions.js       # Reputation tiers and effects
│   │   ├── vendor.js         # Buy/sell with faction rep discounts
│   │   ├── apartments.js     # Property ownership, locks, lockpicking, safe sleep
│   │   └── plugins.js        # Hook-based plugin loader
│   ├── models/
│   │   ├── db.js             # pg.Pool connection, single query() export
│   │   ├── migrate.js        # Full schema, idempotent (CREATE TABLE IF NOT EXISTS)
│   │   ├── seed.js           # World content: zones, items, enemies, NPCs, factions
│   │   └── rename-admin.js   # One-off migration helper for already-seeded DBs
│   └── api/
│       └── routes.js         # REST endpoints for the dev panel (zones/enemies/items/npcs/world state)
├── client/
│   ├── game/index.html       # Player client — single file, no framework, no build step
│   └── devpanel/index.html   # Dev panel — same approach
├── plugins/
│   └── example-weather/      # Reference plugin implementation
├── render.yaml                # Render free-plan service config
└── .env.example
```

There is no `/data/` JSON directory and no separate seed-from-JSON pipeline. World content lives directly as JS object literals inside `seed.js`, which is run once against a fresh database; after that, the database is the only source of truth and further edits go through the dev panel, not the seed file. The seed file is only re-run for entirely new content (e.g. adding a new zone wave), using `ON CONFLICT DO NOTHING` so re-running it is always safe against an already-populated database.

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
- PvP flag, safe-zone flag, **apartment flag** (`flags.is_apartment` — makes a zone rentable via the apartments system)
- Exits as a raw JSON object (`{ north: 'zone_id', ... }`)
- Ambient events as a JSON array of strings
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

#### 📊 World State Monitor
- Live online player count, players-per-zone
- Read-only, polls the REST API

### Not built (originally planned, deprioritized)
- Quest editor — no quest system exists yet
- Loot table editor as a separate named-table concept — loot tables are inlined per-enemy/per-item instead
- Visual node graph for zones — exits are edited as raw JSON, no drag-and-drop graph view
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
factions          -- id, name, description
player_faction_rep -- player_id, faction_id, reputation score
loot_tables       -- named, reusable weighted-drop tables (lightly used; most loot is inlined)
world_events      -- log of significant events
player_corpses    -- lootable death drops, expire after 10 minutes
apartments        -- zone_id (PK), owner_id, owner_handle, is_locked, lock_difficulty, rent_cost
```

Ground-dropped items reuse the `player_inventory` table with a synthetic `player_id` of `_ground_<zone_id>` rather than a separate table — this keeps "take" / "drop" using the same insert/delete logic as normal inventory management.

`apartments` is keyed by `zone_id` rather than having its own surrogate ID — an apartment is 1:1 with a zone, not a separate spatial entity. Ownership and lock state are cached in-memory in `world.js` (`world.apartments`) for fast reads on every room description, with writes going through Postgres first and then patching the cache.

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

---

## Plugin System

Unchanged from the original design — this part was built largely as planned.

```
/plugins/
  └── example-weather/
      ├── plugin.json        # Metadata, hooks declared
      └── index.js           # Plugin logic
```

```javascript
// plugin.json
{
  "name": "weather-system",
  "version": "1.0.0",
  "hooks": ["tick.minute", "player.enterZone", "zone.describeAmbient"]
}

// index.js
export const hooks = {
  "tick.minute": (world) => { /* update weather state */ },
  "player.enterZone": (player, zone) => { /* apply weather effects */ },
  "zone.describeAmbient": (zone) => "A cold wind cuts through the ruins."
}
```

| Hook | Fires When |
|---|---|
| `tick.minute` | Every 60 seconds |
| `player.enterZone` | Player moves into a zone |
| `player.death` | Player dies |
| `combat.hit` | An attack lands |
| `zone.describeAmbient` | Room description is generated — return value appended |

Plugins load at server start by scanning `/plugins/*/plugin.json`. No core code touched to add one. There is no in-panel plugin manager UI yet — enabling/disabling is still done by adding/removing the folder and restarting.

---

## Local Development Setup

```bash
git clone <repo>
cd architect-mud
cp .env.example .env
# Set DATABASE_URL to your Supabase pooler string (or local Postgres)

npm install
npm run db:migrate
npm run db:seed
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

- Quest system — not yet designed in code, only in `design.md`
- Should the in-memory world cache eventually move to Redis if multiple server instances are ever needed? (Not a problem yet — Render free tier is a single instance.)
- Apartment storage (a per-unit inventory) is a natural next step but not built — currently apartments only gate sleep and provide a locked room, no item storage.
- Rate limiting strategy for the WebSocket server under real concurrent load has not been tested past a handful of simultaneous connections.
