# ARCHITECT MUD

Post-singularity browser MUD. The AI won. You survived. Probably.

---

## Free Hosting Stack

| Service | What it does | Cost |
|---|---|---|
| **Render** | Runs the Node.js server + WebSockets | Free |
| **Supabase** | PostgreSQL database | Free tier |

**Free tier trade-offs:**
- Render spins the server down after 15 minutes of no traffic. First connection after a cold start takes ~60 seconds — the client shows a notice and reconnects automatically.
- Supabase pauses a project after 7 days of total inactivity (no queries at all). If your Render server gets any traffic, the keepalive ping covers this automatically — see below.
- The keepalive pings **both** Render (`/health`) and the database (`SELECT 1`) every 10 minutes whenever the server is running, which is enough to keep both awake during any period of active use.

---

## Deploy in 4 Steps

### 1 — Supabase (database, ~5 min)

1. Go to [supabase.com](https://supabase.com) → sign in with GitHub → **New project**
2. Name it whatever you like, set a DB password, save it somewhere safe
3. Wait ~2 min for provisioning
4. Click **Connect** (top of the project page) → select the **Session pooler** tab (or the "Connection pooling" string at port `5432`, **not** port `6543`)
5. Copy the connection string. It looks like:
   ```
   postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-[region].pooler.supabase.com:5432/postgres
   ```

**Why the pooler and not the direct connection:** Supabase's direct connection host resolves to an IPv6-only address on free-tier projects. Render's free compute has no outbound IPv6 route, so a direct connection fails with `ENETUNREACH`. The Session Pooler is IPv4-compatible on every tier and behaves like a normal persistent connection (unlike Transaction mode on port 6543, which recycles connections per-query and can break multi-statement operations like migrations).

### 2 — Push to GitHub

```bash
cd architect-mud
git init
git add .
git commit -m "initial commit"
# Create a repo at github.com then:
git remote add origin https://github.com/YOU/architect-mud.git
git push -u origin main
```

### 3 — Render (server, ~10 min)

1. Go to [render.com](https://render.com) → **New → Web Service**
2. Connect your GitHub repo
3. Render detects Node from `render.yaml` — confirm **Free plan**
4. Add Environment Variables:
   - `DATABASE_URL` → your Supabase **pooler** connection string from step 1
   - `NODE_ENV` → `production`
   - `RENDER_EXTERNAL_URL` → your Render hostname, no protocol (e.g. `architect-mud.onrender.com`)
5. Click **Deploy**

**Renaming the service:** Render's dashboard "Name" field is a display label and does not always update the live `onrender.com` subdomain if the service already has one assigned. If you need a different URL, the most reliable path is creating a new Web Service with the name you want from the start, pointing it at the same repo and the same `DATABASE_URL`, then deleting the old one.

### 4 — Set up the database

The schema script needs to run somewhere that can reach Supabase — Render's free tier doesn't include shell access, so run it from your own machine instead:

```bash
# On your local machine, in the project folder
cp .env.example .env
# Edit .env and paste in the same DATABASE_URL from step 1

npm install
npm run db:schema     # creates all tables (idempotent, safe to re-run)
```

`db:schema` only creates the schema — it does **not** load world content. To populate
a fresh database with content, restore a dump exported from an existing world (see
[Database & Backups](#database--backups) below). The server **does not** touch the
schema or content on boot; both are applied deliberately.

**Windows users:** if `npm` fails with "running scripts is disabled on this system," that's PowerShell's execution policy blocking it (not a Node problem). Fix with:
```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```
or just use Command Prompt (`cmd.exe`) instead of PowerShell, which doesn't have this restriction.

**Done.** Your game is live at `https://[your-service-name].onrender.com`

- Player client: `https://[your-service-name].onrender.com`
- Dev panel: `https://[your-service-name].onrender.com/dev`
- Default login: `admin` / `admin123` ← **change this immediately** (no UI for this yet — direct DB update required)
- Default admin handle is **The Architect**. If your database was seeded before this was added, run `npm run db:rename-admin` once to fix it without a full re-seed.

---

## Local Development

```bash
# Prerequisites: Node 18+, a Supabase project (or local Postgres)

cp .env.example .env
# Edit .env and set DATABASE_URL (the pooler string works fine locally too)

npm install
npm run db:schema                          # create the schema
npm run db:restore -- architect-dump.sql   # load content from a production dump
npm run dev
```

- Player: http://localhost:3000
- Dev panel: http://localhost:3000/dev

---

## Database & Backups

Production is the source of truth for all world content. The schema and content
are managed separately and deliberately — **nothing runs at server startup**.

- **Schema** lives in one place: `server/models/schema.js` (`SCHEMA_SQL`). Apply it
  with `npm run db:schema`. It is idempotent (`CREATE TABLE IF NOT EXISTS` /
  `ADD COLUMN IF NOT EXISTS`), so re-running is always safe.
- **Backups / content snapshots**: in the dev panel (`/dev` → sidebar **Server → 📋 Changes**
  → **Database Backup** section), click **⬇ Export Database (.sql)** (admin only). This
  downloads a full, self-contained SQL dump — the current schema **plus** all world content
  (zones, items, enemies, NPCs, furniture, factions, recipes, etc.). Player/runtime rows
  (accounts, inventory, password hashes) are intentionally excluded.

### Seeding a local dev database from a production dump

The exported `.sql` is self-contained: it carries the schema (`CREATE TABLE IF NOT EXISTS …`)
**and** the content (`INSERT …`), wrapped in `BEGIN/COMMIT`. Restoring it into an empty
database is the entire seed step — you don't need to run `db:schema` first.

1. **Export** from the live panel (see above). You get `architect-dump-<timestamp>.sql`.
2. **Point `.env` at your *local* database**, not production:
   ```
   DATABASE_URL=postgres://localhost:5432/architect_dev
   ```
3. **Restore** — either is equivalent:
   ```bash
   # Option A — psql (fastest, if installed)
   psql "postgres://localhost:5432/architect_dev" -f ~/Downloads/architect-dump-<timestamp>.sql

   # Option B — npm script (no psql needed; uses DATABASE_URL from .env)
   npm run db:restore -- ~/Downloads/architect-dump-<timestamp>.sql
   ```
4. **Run it:** `npm run dev`. Your local world now matches production as of the export.

Notes:
- Only **world content** is seeded — **not** player accounts/inventory. Your local DB starts
  with the world but no characters; register a fresh one (or your admin) locally.
- **Re-running is safe but not a reset.** Inserts use `ON CONFLICT DO NOTHING`, so a second
  restore won't duplicate or overwrite rows. To get an exact fresh copy after mucking up local
  content, drop/recreate the database first, then restore into the empty DB.
- **To refresh local from prod later,** just export again and restore again into a clean DB.

### Changing the schema

There are no startup migrations. To change the schema:

1. Write a deliberate one-shot script (not committed to any boot path, not auto-run)
   and run it once against production.
2. Edit `SCHEMA_SQL` in `server/models/schema.js` to match.

Because the export reuses `SCHEMA_SQL`, the next backup automatically carries the new
schema — there is no separate step to keep them in sync.

---

## Player Commands

| Command | Description |
|---|---|
| `north/south/east/west/up/down` (or `n/s/e/w/u/d`) | Move |
| `look` | Describe your surroundings |
| `look <me/item/player>` / `examine <thing>` (or `ex`/`x`) | Inspect yourself, an inventory item, a player, or room furniture/scenery |
| `map` | Show the ASCII minimap |
| `attack <target>` | Attack a hostile |
| `loot <corpse>` | Loot a dead player or NPC |
| `inventory` / `inv` / `i` | Opens the visual inventory & equipment panel — drag or click items into body slots |
| `take / drop / use` | Item management (`use`/`eat`/`drink` also consumes drugs — with addiction/overdose risk) |
| `switch <light>` (or `flip`) | Toggle a room's overhead light or lamp on/off (needs power; streetlights aren't switchable) |
| `equip <item>` / `unequip <item>` | Equip or unequip by typed name (the visual panel does this too, via drag or click) |
| `recipes` | Show craftable recipes |
| `craft <recipe_id>` | Craft an item |
| `shop <npc>` | Browse a vendor |
| `buy / sell <item>` | Trade with a vendor |
| `balance` | Show carried vs. banked credits |
| `deposit <amount/all>` / `withdraw <amount/all>` | Move credits to/from your bank balance — requires standing at an ATM. Banked credits cannot be stolen. |
| `steal <player>` | Attempt to pick a player's pocket (Deception skill check, carried credits only, not usable in safe zones, 60s cooldown) |
| `rent` | Claim an unowned apartment unit |
| `lock` / `unlock` | Secure or open your apartment door (owner only) |
| `pick` | Attempt to pick a locked door (Security skill check) |
| `upgrade lock` | Spend credits to raise your door's lock difficulty |
| `sleep` / `rest` | Begin gradually resting — restores HP/Sanity over real time, drains hunger/thirst while you're out. Any other command wakes you early. |
| `stats` | Show vitals and stats |
| `skills` | Show skill levels |
| `mutations` | Show your mutations |
| `factions` | Show faction standing |
| `talk <npc>` | Dialogue with an NPC |
| `say <message>` | Speak in the room |
| `who` | List online players |
| `help` | Full command list |

Exits, NPCs, enemies, corpses, and ground items are also clickable directly in the room description — no need to type the command if you'd rather click.

---

## The World

The world is currently a compact **16-zone** map (it was deliberately shrunk from an earlier 5×5 grid down to a tight, fully-populated core). It breaks down as:

- **Safe city core (Coldwater Basin)** — 8 connected PvP-off zones with zero enemy spawns: The Threshold (`zone_start`, the hub) plus Threshold Plaza North, Custodian Row, The Loading Bay, The Clinic Block, The Sprawl Gate, The Under Entrance, and the Franchise Strip. This is where players gather and interact.
- **Badlands** — 2 dangerous zones beyond the western city gate: The Rust Quarter West (`medium`, the buffer where enemies spawn) and The Static Wood (`low`) past it. PvP is on out here.
- **Coldwater Power Station** — a `medium` building west of the Rust Quarter that doubles as the in-world city power plant for the environment system.
- **Embassy Hotel & Bar** — a building reached by going `down` from the Franchise Strip: a lobby/bar (the Embassy Lounge) plus four rentable apartment units. See Apartments below.

Enemies never spawn in the city core under any circumstance — leaving it to find combat is a deliberate choice. (The map is intentionally small right now; full expansion is the next big world pass.)

---

## Apartments & Property

Players can rent apartment units in the Embassy Hotel (go `down` from the Franchise Strip) and secure them with a lock.

- **`rent`** — claim an unowned unit for credits (default 100c)
- **`lock`** / **`unlock`** — owner-only. A locked door blocks entry and sleep for everyone but you.
- **`pick`** — anyone can attempt to pick someone else's locked door. Runs a **Security** skill check (d10 + skill rank + AGI bonus) against the door's lock difficulty. Failing still grants partial skill XP.
- **`upgrade lock`** — owner spends credits to raise the lock's difficulty, making it harder to pick.
- **`sleep`** / **`rest`** — begins a timed sleep that gradually restores HP and Sanity over real time while draining hunger and thirst, same as if you were unconscious rather than resting instantly. Your own locked apartment rests faster and deeper than any other safe zone or an unlocked apartment that isn't yours; sleep doesn't work at all somewhere dangerous. Sending any other command wakes you up early — whatever you'd already recovered is kept. Sleep also auto-ends if you'd starve/dehydrate unconscious, or after 30 in-game minutes regardless.

Apartment zones are just regular zones with the `is_apartment` flag set in their `flags` JSON — togglable on any zone from the dev panel's zone editor.

---

## Inventory & Equipment

- Stackable items merge into a single row with a quantity instead of creating duplicate entries — applies to picking items up off the ground, looting corpses, and crafting output (crafted items only merge with an existing stack of the *same quality tier*; a pristine craft and a scrap craft of the same item stay separate).
- Equipment uses seven body slots: **Head, Torso, Hands, Legs, Feet, Weapon Hand, Accessory**. An item declares its slot via `flags.slot` in its item definition; weapons with no explicit slot default to Weapon Hand.
- The visual panel (opened via `inventory`/`inv`/`i`, or the **inv** button) shows a body-slot diagram next to your unequipped items — drag an item onto a slot to equip it, drag an equipped item back out to unequip, or just click either side as a shortcut for the same thing.

---

## Survival

- **Hunger and thirst deplete slowly** — thirst reaches 0 in roughly 5 hours of real time if never replenished, hunger in roughly 6–7 hours. Both are genuinely lethal if ignored at 0 (small, steady HP loss per minute), not just a discomfort.
- **Food and water do more than refill their own meter**: eating grants a temporary "Well-Fed" buff that speeds up natural HP regeneration; drinking grants a temporary "Hydrated" buff that speeds up radiation decay. Both last 10 minutes and apply automatically to any item with the matching `food`/`drink` subtype.
- **Healing items can be instant or gradual.** An item's `effects` JSON supports a flat `hp` bump (instant) or an `hp_over_time: { amount, duration_seconds }` field (gradual, ticks once a minute, stacks if used again before finishing). Field Bandages and Trauma Kits both use the gradual form.
- **New players start with 3 Field Bandages** in their inventory.
- **Death respawns you fully restored** — HP, Sanity, Hunger, Thirst, and Radiation all reset to full/zero as appropriate, framed as stepping out of a cloning vat. All learned skills carry over untouched; only the body resets.

---

## Time, Weather & Power

The world runs a live environmental simulation (see `docs/architecture.md`):

- **A day/night cycle** advances on a 30-minute real-time tick, moving through dawn → day → dusk → night. Streetlights come on by themselves at dusk and shut off at dawn.
- **Weather and seasons** roll over on a 24-hour tick — sunny/cloudy/rain/fog/storm/snow, each affecting visibility, with a deterministic 7-day forecast.
- **A power grid** feeds every zone from generators (the Coldwater Power Station for the city/streetlights, a backup generator for the Embassy). Blackouts and overloads are simulated; storms can fault generators.
- **Indoor lights** (overhead fixtures, lamps) are switchable with `switch <light>`, but only if the room actually has power. Low light reduces visibility.

---

## Drugs & Addiction

Some consumables are `drug`-type substances handled by a dedicated system rather than the plain consumable path:

- Each dose applies timed effects (stat boosts, sanity/HP/radiation shifts) for a duration.
- Repeated use risks **addiction** (a per-use roll) and, if you take too much too fast, **overdose** — which applies the drug's harsh withdrawal effects instead of its benefits.
- Seeded examples: **Buzz** (cheap stimulant), **Slow** (numbs pain and panic), **Glasshollow** (Architect-adjacent, sanity-shredding).

---

## Economy

- New characters start with **20 credits** — enough for a couple of bar drinks and a ration, not much more.
- Credits exist in two pools: **carried** (on your person, stealable) and **banked** (stored at an ATM, theft-proof until withdrawn).
- ATMs are zone-flagged (`flags.has_atm`) — `deposit`/`withdraw` only work standing in a zone that has one. Currently seeded at The Threshold (`zone_start`); more get placed as the city map is built out.
- **Stealing** targets another player's carried credits only, never their bank balance. It's a Deception skill check against a flat difficulty, has a 60-second cooldown per thief, doesn't work in safe zones, and takes a random 10–30% cut of what the target is carrying. Failing means the whole zone finds out, via a broadcast `zone_event`.
- **Sully**, a barkeep NPC at the starting bar fixture, sells drinks (Basin Swill, Rust Whiskey, Glow Cocktail) and bar food. Drinks count as the `drink` subtype, so they trigger the Hydrated buff from the Survival system on top of their own effects.
- Your carried credit balance is always visible in the header, top-right, regardless of what screen or panel you're looking at.

---

## Plugin System

Drop a folder in `/plugins/` with two files:

**plugin.json**
```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "hooks": ["tick.minute", "player.enterZone", "zone.describeAmbient", "player.death"]
}
```

**index.js**
```js
export const hooks = {
  'tick.minute': async () => { /* runs every minute */ },
  'player.enterZone': async (player) => { /* fires when player enters any zone */ },
  'zone.describeAmbient': async (zone) => { return 'Extra ambient text appended to room.'; },
  'player.death': async (player, killer) => { /* player died */ },
};
```

Restart the server. Plugin loads automatically. No core code changes.

**Available hooks:**
- `tick.minute` — every 60 seconds
- `player.enterZone` (player) — player moves zones
- `player.death` (player, killer) — player dies
- `zone.describeAmbient` (zone) → string — append text to ambient events
- `combat.hit` (attacker, defender, damage) — attack lands
- `environment.tick30m` / `environment.tick24h` — environmental + daily world ticks
- `environment.weatherChange` — weather/temperature changed
- `environment.sunrise` / `environment.sunset` — day/night phase crossed

---

## What's Built

- [x] WebSocket real-time server (Node.js) with `wss://` support over HTTPS
- [x] Player auth (register / login) with connection-state-aware feedback and reconnect handling
- [x] 16 zones — an 8-zone safe city core, 2 badland zones, the Coldwater Power Station, and the Embassy Hotel building (lobby/bar + 4 apartment units)
- [x] Movement with radiation exposure, single-letter direction shortcuts
- [x] Real-time combat with cooldowns, crits, miss rolls (HellMOO-paced: ~3.5s player cooldown, enemy speed scaled by AGI)
- [x] Enemy AI with targeting and attack timers, spawns confined to badlands only
- [x] Status effects (bleeding, burning, irradiated)
- [x] Survival meters — HP, Sanity, Hunger, Thirst, Radiation, balanced for multi-hour real-time depletion, genuinely lethal if neglected
- [x] Full loot PvP — corpses lootable by anyone for 10 minutes
- [x] **Apartments & property** — rent, lock, pick (skill-checked), upgrade, and timed sleep for gradual safe rest
- [x] **Healing** — instant and heal-over-time consumables (bandages, medkits), well-fed/hydrated buffs from food and water
- [x] **Death & respawn** — full stat restore via cloning-vat respawn, all skills retained
- [x] **Crafting system** — quality tiers, skill checks, station requirements, crit crafts
- [x] **Mutation system** — radiation triggers permanent mutations with buffs/drawbacks
- [x] **Drug system** — substances with timed effects, addiction rolls, and overdose/withdrawal
- [x] **Environmental simulation** — day/night cycle, weather + seasons with a 7-day forecast, visibility effects
- [x] **Power grid & lighting** — generators feed zones, simulated blackouts/overloads, switchable indoor lights, auto streetlights
- [x] **Furniture & scenery** — non-takeable, examinable room dressing (bar counters, beds, corkboards, light fixtures)
- [x] **Faction reputation** — 6 tiers, trade discounts, hostile behavior
- [x] **Vendor system** — buy/sell with faction rep discounts
- [x] **Economy** — 20-credit start, dual carried/banked credit pools, ATM deposit/withdraw, player-to-player theft, barkeep NPC
- [x] Skill system — 18 skills (incl. Security for lockpicking), XP-by-use, rank 0–10
- [x] **Inventory & equipment** — stackable items (no more duplicate rows), 7-slot body equipment with a drag/click visual panel
- [x] NPC dialogue trees
- [x] **Plugin system** — hook-based, drop-in extensibility
- [x] Dev panel — Zone, Enemy, Item, NPC editors with live hot-reload and surfaced error toasts
- [x] World state monitor
- [x] Dual keepalive — pings both Render and Supabase to prevent free-tier spin-down/pause
- [x] Cold-start UX — client shows notice, reconnects automatically
- [x] WebSocket heartbeat — kills stale connections
- [x] Settings screen — theme (dark/light/high-contrast), font size, display density, saved to localStorage
- [x] ASCII minimap — colorized by zone danger, BFS-rendered from the live zone graph
- [x] Clickable room text — exits, NPCs, enemies, corpses, and ground items are all underlined and clickable instead of requiring typed commands
- [x] Process-level crash protection — a bug in any single request can no longer take the whole server down

## What's Next

- [ ] Quest system (faction arc storylines)
- [ ] Zone node graph view in dev panel
- [ ] Crafting station placement in zones
- [ ] Player crews / guilds
- [ ] Sanity effects (hallucinated room text)
- [ ] Architect Interface skill events
- [ ] In-game map for dev ghost mode
- [ ] Apartment decor / storage (currently sleep + lock only, no item storage yet)
- [ ] Rent decay or upkeep (currently a one-time purchase with no ongoing cost)
- [ ] More ATMs across the city (currently only one, at The Threshold — full coverage lands with the world-map expansion)
