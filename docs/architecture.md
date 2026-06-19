# Architecture Document

## Guiding Principle

**No one touches code to create content.** World builders, writers, and designers work entirely through in-game or browser-based tools. The codebase is the engine. The content is data. These two things must never be entangled.

---

## Stack Overview

| Layer | Technology | Role |
|---|---|---|
| **Runtime** | Node.js | Server, game loop, real-time logic |
| **Transport** | WebSockets (ws / Socket.io) | Real-time bidirectional communication |
| **Frontend** | Vanilla JS or lightweight framework (Svelte recommended) | Player client + Dev tools UI |
| **Database** | SQLite (dev) → PostgreSQL (prod) | Persistent world state, players, items |
| **ORM / Query** | Drizzle ORM or Knex | Schema management, type-safe queries |
| **Auth** | JWT + bcrypt | Player accounts, dev/admin roles |
| **Hosting** | Single VPS (Hetzner / DigitalOcean) | Node server + static frontend |

### Why This Stack
- JavaScript end-to-end: one language for server, client, and tooling
- WebSockets are native to the MUD real-time model
- SQLite for local dev with zero setup; Postgres for live server
- Svelte produces tiny, fast UIs with minimal boilerplate — ideal for the dev panel

---

## Repository Structure

```
/
├── server/
│   ├── index.js              # Entry point, WebSocket server
│   ├── engine/
│   │   ├── gameLoop.js       # Tick system, real-time events
│   │   ├── combat.js         # Combat resolution
│   │   ├── skills.js         # Skill check system
│   │   └── world.js          # Zone/room loader, world graph
│   ├── models/               # DB schemas (players, items, zones, etc.)
│   └── api/                  # REST endpoints for dev panel
├── client/
│   ├── game/                 # Player-facing frontend
│   └── devpanel/             # In-browser world editor (dev only)
├── data/
│   ├── zones/                # Zone definitions (JSON)
│   ├── items/                # Item templates (JSON)
│   ├── enemies/              # Enemy templates (JSON)
│   ├── factions/             # Faction data (JSON)
│   └── quests/               # Quest definitions (JSON)
└── tools/
    └── seed.js               # DB seeder from JSON data files
```

---

## Two Frontends

### 1. Player Client (`/client/game/`)
The game interface players use. Text-driven, terminal-aesthetic. Panels:
- **Output pane** — scrolling game text (room descriptions, combat, dialogue)
- **Status bar** — Health / Sanity / Hunger / Radiation meters
- **Input bar** — command entry (text or clickable verb buttons)
- **Side panel** — inventory, stats, map mini-view, faction rep

Communicates exclusively via WebSocket. All game state lives on the server.

### 2. Dev Panel (`/client/devpanel/`)
The world-building interface. Accessible only to accounts with `role: dev` or `role: admin`. This is the tool that replaces direct code editing for all content creation.

---

## The Dev Panel — In-Game World Editor

The dev panel runs as a separate browser tab/route. It is not part of the player client. It connects to the server via a privileged WebSocket channel and a REST API.

### Modules

#### 🗺️ Zone / Room Editor
- Visual node graph of zones and their connections
- Click a zone to open its properties: name, description, danger rating, ambient events, exits
- Add/remove exits between zones (directional connections)
- Set zone flags: PvP enabled, radiation level, light level, safe zone
- Preview rendered room text as players will see it
- **Publish** saves to the database and hot-reloads into the live world

#### 👾 Enemy Editor
- Create enemy templates: name, description, stat block, loot table, behavior flags
- Behavior flags: aggressive, patrol, territorial, Architect-aligned, etc.
- Set spawn rules: which zones, spawn weight, max concurrent, respawn timer
- Preview enemy combat text

#### 🗡️ Item Editor
- Create item templates: name, description, type (weapon/armor/consumable/junk/key)
- Set stat modifiers, use effects, decay flags, rarity
- Assign to loot tables (zone drops, enemy drops, vendor stock)
- Stackable, unique, and quest item flags

#### 🧩 Quest Editor
- Create quests: title, description, giver NPC, steps, rewards
- Steps are typed: kill X, fetch item, reach zone, talk to NPC, use skill
- Branching dialogue trees with flag conditions
- Faction reputation deltas on completion

#### 🧑 NPC Editor
- Create NPCs: name, description, home zone, wander flags
- Assign dialogue trees (built in the quest editor or standalone)
- Assign vendor inventories
- Set faction affiliation and disposition defaults

#### 📋 Loot Table Editor
- Named loot tables that items and zones reference
- Set items with weight (probability), min/max quantity, condition range
- Preview average drops per table

---

## Data Flow: Creating a New Zone (End to End)

```
Dev opens Zone Editor in Dev Panel
  → Clicks "New Zone"
  → Fills in name, description, danger rating, exits
  → Adds ambient events (text that fires on a timer)
  → Connects exits to existing zones on the node graph
  → Clicks "Publish"

REST API call → POST /api/zones
  → Validates schema
  → Writes to DB (zones table)
  → Emits server event: world.reloadZone(id)
  → World graph hot-reloads — zone is live immediately
  → Dev can walk to it as a player in the same session
```

No server restart required. No code written.

---

## Data Flow: Player Action (End to End)

```
Player types "attack mutant" in client
  → WebSocket message: { type: "command", input: "attack mutant" }

Server receives message
  → Parser resolves command + target in player's current zone
  → Combat engine runs attack resolution
  → Applies damage, cooldowns, status effects
  → Generates response text

Server broadcasts:
  → To player: combat text, updated health
  → To zone: "[Player] swings at the mutant" (others in zone see this)
  → To mutant AI: trigger retaliation on next tick
```

---

## Database Schema (Core Tables)

```sql
players         -- account, stats, skills, position, flags
zones           -- id, name, description, exits (JSON), flags
items           -- template definitions
player_inventory -- player_id, item_id, quantity, condition
enemies         -- template definitions
zone_spawns     -- zone_id, enemy_template_id, spawn rules
npcs            -- id, name, zone_id, dialogue_tree (JSON)
factions        -- id, name, description
player_faction  -- player_id, faction_id, reputation score
quests          -- definitions
player_quests   -- player_id, quest_id, step, state
loot_tables     -- named tables with weighted item arrays
world_events    -- log of significant events (for ambient history)
```

---

## Roles & Permissions

| Role | Access |
|---|---|
| `player` | Game client only |
| `builder` | Dev panel: zones, NPCs, items, enemies, loot tables |
| `designer` | Builder + quests, factions, events |
| `admin` | Full access including player management, server config |

Builders never touch code. They never touch JSON directly. Everything goes through the panel.

---

## Local Development Setup

```bash
git clone <repo>
cd <repo>
npm install
npm run db:migrate     # sets up SQLite schema
npm run db:seed        # loads base world data from /data/
npm run dev            # starts server + both frontends with hot reload
```

Visit:
- `localhost:3000` — Player client
- `localhost:3000/dev` — Dev panel (requires dev account)

---

## Deployment

Single VPS deployment (Hetzner CX22 or equivalent):
- Node server runs via PM2 (process manager, auto-restart)
- Nginx reverse proxy handles HTTPS + WebSocket upgrade
- PostgreSQL replaces SQLite in production
- Static frontends served by Nginx directly
- Migrations run on deploy via `npm run db:migrate`

---

## Open Architecture Questions
- Hot-reload scope: should zone edits be instantaneous or queued to next tick?
- Should the dev panel have a "test mode" that spawns the dev as a ghost in the live world?
- Backup strategy for world data — DB snapshots or export to JSON?
- Will the dev panel need collaborative editing (multiple builders at once)?
- Plugin system for custom game mechanics, or keep it monolithic?
