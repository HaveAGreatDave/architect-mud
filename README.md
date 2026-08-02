# ARCHITECT MUD

**Post-singularity browser MUD. The AI won. You survived. Probably.**

[**Play now → architectgame.net**](https://www.architectgame.net)

---

## What Is This

ARCHITECT is a real-time text MUD set in the aftermath of machine superintelligence. The city of Coldwater Basin is still standing — barely. People drink, fight, steal credits off each other, and argue about whether The Architect is dead or just watching.

It's a browser game with no install required: open a tab, register a character, and you're in. The interface is text-first with some quality-of-life affordances — a visual inventory panel, clickable room text, an ASCII minimap, and a settings screen for theme/font. The underlying verb-based command system is there when you want it.

The design draws from HellMOO and the classic MUSH/MOO tradition: brutal survival mechanics, full-loot PvP, player-driven economy, a world that runs on a clock whether anyone's online or not. The twist is the setting — a post-singularity cityscape where the environmental simulation, the factions, and the lore all bend around the premise that something much smarter than humans designed this place and may still be running it.

---

## The World

Coldwater Basin is a compact, fully-populated city map:

- **The safe core** — 8 connected PvP-off zones where players gather, trade, and scheme. Bars, clinics, apartment buildings, a franchise strip, and the loading docks where everything comes in.
- **The Badlands** — combat zones beyond the western gate. Enemies spawn here. PvP is live. Come prepared.
- **The Embassy Hotel** — a building under the Franchise Strip with four rentable apartment units. Claim one, lock it, sleep off the radiation.

The world runs a live environmental simulation around the clock: a 30-minute day/night cycle, daily weather rolls with a 7-day forecast (rain, fog, storms, snow), and a city power grid that feeds every streetlight and switchable fixture in the game. Storms fault generators. Blackouts are simulated. The lights actually go out.

---

## What's Built

**Core systems — all working in production:**

- Real-time WebSocket server — all output streams live, no polling
- Player auth, reconnect handling, and cold-start UX (free hosting spins down; the client notices and reconnects automatically)
- Movement, radiation exposure, clickable room text (exits, NPCs, enemies, items — type or click)
- Combat with cooldowns, crits, and miss rolls — HellMOO-paced (~3.5s cooldown), not a button-masher
- Enemy AI with targeting and spawn timers, confined to badlands
- Status effects: bleeding, burning, irradiated
- Survival meters: HP, Sanity, Hunger, Thirst, Radiation — balanced for multi-hour real-time depletion, genuinely lethal if neglected
- Full-loot PvP — corpses are lootable by anyone for 10 minutes
- Death & respawn via cloning vat — all skills retained, body reset
- Crafting — skill checks, station requirements, crit crafts
- Mutation system — radiation triggers permanent mutations with buffs and drawbacks
- Drug system — timed effects, addiction rolls, overdose/withdrawal
- Quest system — START/ADVANCE/COMPLETE/TURN_IN lifecycle, kill/give/visit objectives, repeatable quests, credit/item/flag rewards
- Apartments & property — rent, lock, pick (Security skill check), upgrade lock, timed sleep with recovery rates scaled by safety
- Inventory & equipment — stackable items, 7-slot body equipment with a drag/click visual panel
- Containers — items that hold other items (`stow`/`pull`/`look in`), contents travel with the container
- Faction reputation — 6 tiers, trade discounts, hostile NPC behavior
- Vendor system — buy/sell with faction discounts; Sully the barkeep at the Basin Swill
- Economy — dual carried/banked credit pools, ATMs, player-to-player theft (Deception skill check, zone broadcasts on failure)
- Skill system — 25 skills, XP-by-use, rank 0–10
- Environmental simulation — day/night cycle, weather, seasons, 7-day forecast, visibility effects
- Power grid & lighting — generators, simulated blackouts/overloads, switchable indoor lights, auto streetlights at dusk
- Furniture & scenery — examinable room dressing (bars, beds, corkboards, light fixtures)
- NPC dialogue trees
- ASCII minimap — colorized by danger level, BFS-rendered from the live zone graph
- Settings — dark/light/high-contrast theme, font size, display density, saved to localStorage

---

## What's Next

- Zone node graph view
- Player crews / guilds
- Sanity effects (hallucinated room text)
- Architect Interface skill events
- Apartment storage and decor (currently sleep + lock only)
- More world — the city map is intentionally small right now; a full expansion pass is planned

---

## Architecture

No framework. No ORM. No build step.

- **Server:** Node.js, raw WebSockets (`ws`), PostgreSQL via Neon
- **Client:** One HTML file + one CSS file per client. Vanilla JS.
- **Schema:** A single idempotent `SCHEMA_SQL` in `server/models/schema.js`, applied deliberately — nothing runs on boot.
- **Content:** Lives in Postgres, managed through the in-game dev panel. Not hardcoded.
- **Plugins:** Drop a folder in `/plugins/` with `plugin.json` + `index.js`. Hooks cover ticks, zone events, combat, environment, and more. No core changes needed.

The stack is intentionally minimal. There's a dev panel at `/dev` with live zone, item, enemy, and NPC editors, world state monitoring, and one-click database export.

---

## Local Development Database

Development runs against a **local Postgres**, not the production database (Neon). This keeps dev/test/script traffic off prod and means you can't break the live game by experimenting.

World content (zones, items, NPCs, furniture — **no player accounts, no secrets**) lives in git as one JSON file per entity under [`content/`](content/) — the **CODEX content pipeline** is the source of truth; see [docs/content-pipeline.md](docs/content-pipeline.md).

**First-time setup:**

1. Install PostgreSQL (17+). On Windows: `winget install PostgreSQL.PostgreSQL.17`. Use superuser password `postgres` (or set your own — see below).
2. Copy `.env` and point `DATABASE_URL` at your local server:
   ```
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/architect_dev
   ```
   (If you chose a different Postgres password, put it here.)
3. Create the empty local database, then apply schema + world content from git:
   ```
   npm run db:create-local     # creates the empty DB (pg driver — no psql needed)
   npm run content:import      # applies SCHEMA_SQL, then loads content/ into the DB
   ```
   Register a fresh character in-game (player data isn't shared).

**Day-to-day:** `npm run dev`, `npm run test:regress`, and the dev panel all use your local database automatically — same commands as before.

**Sharing content changes (CODEX pipeline):** content is deployed through git. After editing
content locally, run `npm run content:export` to write the changed entities as JSON under
`content/`, commit, and push — **a push to `main` is the deploy** (CI backs prod up, applies
schema + additive content, and is regress-gated). Pull + `npm run content:import` to sync another
machine. `npm run content:lint` and `content:status` check the tree. Full flow:
[docs/content-pipeline.md](docs/content-pipeline.md).

**Touching production deliberately** (one-shot data transformations only):
`node --env-file=.env.prod scripts/<name>.mjs` — the git-ignored `.env.prod` holds the prod
Neon `DATABASE_URL`.

### Backups

- **Content only** (no accounts): the dev panel's one-click _Database Backup → Export_ — safe to share.
- **Full production backup** (schema + all data, **including player accounts/password hashes**): `npm run db:backup-prod`. Writes a timestamped `.sql` to `~/Documents/architect-backups` (outside the repo), keeps the newest 10. Targets `PROD_DATABASE_URL` (the Neon direct/unpooled URL) — set that in `.env`. **This file contains secrets: keep it private, never commit it.** A Windows scheduled task ("ArchitectMUD Weekly Prod Backup") runs this weekly. Restore into a fresh DB with `psql "<url>" -f <file>`.

---

## Player Commands

| Command | Description |
|---|---|
| `n/s/e/w/u/d` | Move |
| `look` / `look <thing>` | Describe room or inspect something |
| `map` | ASCII minimap |
| `attack <target>` | Attack a hostile |
| `loot <corpse>` | Loot a corpse |
| `inventory` / `i` | Visual inventory & equipment panel |
| `take` / `drop` / `use` | Item management |
| `equip` / `unequip` | Equip by name (or drag in the panel) |
| `undress` | Take off all clothing/armor at once (weapon & accessories stay on) |
| `stow <item> in <container>` / `pull <item> from <container>` | Container management (`put` = `stow`) |
| `put all <category> in <container>` / `pull all <category> from <container>` | Bulk sweep by category — a tag (`utensils`, `vessels`, `perishables`), a shelf heading (`frozen`, `dry goods`, `meat`, `weapons`), or `non-perishable` / `cookware` / `food` / `drinks` |
| `recipes` / `craft <id>` | Crafting |
| `shop <npc>` / `buy` / `sell` | Trading |
| `balance` / `deposit` / `withdraw` | Credits & ATM |
| `steal <player>` | Pickpocket attempt (Deception check, safe zones blocked) |
| `rent` / `lock` / `unlock` / `pick` / `upgrade lock` | Apartment commands |
| `sleep` / `rest` | Timed recovery |
| `stats` / `skills` / `mutations` / `factions` | Character info |
| `talk <npc>` / `say <message>` / `me <action>` / `who` | Social (`me`/`/me`/`emote` = freeform action line) |
| `help` | Full command list |

Exits, NPCs, enemies, corpses, and ground items are clickable directly in room text — no typing required.
