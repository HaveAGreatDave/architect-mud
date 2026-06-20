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

### 4 — Seed the database

The migrate/seed scripts need to run somewhere that can reach Supabase — Render's free tier doesn't include shell access, so run them from your own machine instead:

```bash
# On your local machine, in the project folder
cp .env.example .env
# Edit .env and paste in the same DATABASE_URL from step 1

npm install
npm run db:migrate
npm run db:seed
```

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
npm run db:migrate
npm run db:seed
npm run dev
```

- Player: http://localhost:3000
- Dev panel: http://localhost:3000/dev

---

## Player Commands

| Command | Description |
|---|---|
| `north/south/east/west/up/down` (or `n/s/e/w/u/d`) | Move |
| `look` | Describe your surroundings |
| `attack <target>` | Attack a hostile |
| `loot <corpse>` | Loot a dead player or NPC |
| `inventory` | Show inventory |
| `take / drop / use / equip` | Item management |
| `recipes` | Show craftable recipes |
| `craft <recipe_id>` | Craft an item |
| `shop <npc>` | Browse a vendor |
| `buy / sell <item>` | Trade with a vendor |
| `rent` | Claim an unowned apartment unit |
| `lock` / `unlock` | Secure or open your apartment door (owner only) |
| `pick` | Attempt to pick a locked door (Security skill check) |
| `upgrade lock` | Spend credits to raise your door's lock difficulty |
| `sleep` / `rest` | Rest to restore HP/Sanity — full restore in your own locked apartment, partial in any safe zone |
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

The map is a 5×5 grid: a **3×3 safe city core** (Coldwater Basin) surrounded by a **ring of 16 badland zones** where all enemies spawn. The city core is always PvP-off with zero enemy spawns — players gather and interact there. Danger escalates outward: zones bordering the city are `medium`, the next ring is mostly `high`, and the four corners are `lethal`.

A residential block (`down` from the city center) holds rentable apartment units — see Apartments below.

---

## Apartments & Property

Players can rent apartment units in the Residential block and secure them with a lock.

- **`rent`** — claim an unowned unit for credits (default 100c)
- **`lock`** / **`unlock`** — owner-only. A locked door blocks entry and sleep for everyone but you.
- **`pick`** — anyone can attempt to pick someone else's locked door. Runs a **Security** skill check (d10 + skill rank + AGI bonus) against the door's lock difficulty. Failing still grants partial skill XP.
- **`upgrade lock`** — owner spends credits to raise the lock's difficulty, making it harder to pick.
- **`sleep`** / **`rest`** — restores HP and Sanity. Full restore in your own locked apartment; a lesser restore in any safe zone or an unlocked apartment that isn't yours; doesn't work in dangerous zones at all.

Apartment zones are just regular zones with the `is_apartment` flag set in their `flags` JSON — togglable on any zone from the dev panel's zone editor.

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

---

## What's Built

- [x] WebSocket real-time server (Node.js) with `wss://` support over HTTPS
- [x] Player auth (register / login) with connection-state-aware feedback and reconnect handling
- [x] 30 zones — 5×5 grid: 3×3 safe city core + 16-zone badlands ring, plus a 5-zone residential block
- [x] Movement with radiation exposure, single-letter direction shortcuts
- [x] Real-time combat with cooldowns, crits, miss rolls (HellMOO-paced: ~3.5s player cooldown, enemy speed scaled by AGI)
- [x] Enemy AI with targeting and attack timers, spawns confined to badlands only
- [x] Status effects (bleeding, burning, irradiated)
- [x] Survival meters — HP, Sanity, Hunger, Thirst, Radiation
- [x] Full loot PvP — corpses lootable by anyone for 10 minutes
- [x] **Apartments & property** — rent, lock, pick (skill-checked), upgrade, and sleep for safe rest
- [x] **Crafting system** — quality tiers, skill checks, station requirements, crit crafts
- [x] **Mutation system** — radiation triggers permanent mutations with buffs/drawbacks
- [x] **Faction reputation** — 6 tiers, trade discounts, hostile behavior
- [x] **Vendor system** — buy/sell with faction rep discounts
- [x] Skill system — 18 skills (incl. Security for lockpicking), XP-by-use, rank 0–10
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
