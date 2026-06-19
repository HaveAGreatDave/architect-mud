# ARCHITECT MUD

Post-singularity browser MUD. The AI won. You survived. Probably.

---

## Free Hosting Stack

| Service | What it does | Cost |
|---|---|---|
| **Render** | Runs the Node.js server + WebSockets | Free |
| **Supabase** | PostgreSQL database | Free forever |

**Free tier trade-off:** Render spins the server down after 15 minutes of no traffic.
The server self-pings every 10 minutes to prevent this during active play.
First connection after a true cold start takes ~60 seconds. The client shows a notice.

---

## Deploy in 4 Steps

### 1 — Supabase (database, ~5 min)

1. Go to [supabase.com](https://supabase.com) → sign in with GitHub → **New project**
2. Name: `architect-mud`, set a DB password, save it
3. Wait ~2 min for provisioning
4. **Settings → Database → URI** — copy the connection string:
   ```
   postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres
   ```

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
   - `DATABASE_URL` → your Supabase connection string
   - `NODE_ENV` → `production`
   - `RENDER_EXTERNAL_URL` → your Render URL (e.g. `architect-mud.onrender.com`)
5. Click **Deploy**

### 4 — Seed the database

Once deployed, open the Render **Shell** tab and run:
```bash
npm run db:migrate
npm run db:seed
```

**Done.** Your game is live at `https://architect-mud.onrender.com`

- Player client: `https://architect-mud.onrender.com`
- Dev panel: `https://architect-mud.onrender.com/dev`
- Default login: `admin` / `admin123` ← **change this immediately**

---

## Local Development

```bash
# Prerequisites: Node 18+, a Supabase project (or local Postgres)

cp .env.example .env
# Edit .env and set DATABASE_URL

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
| `north/south/east/west/up/down` | Move |
| `look` | Describe your surroundings |
| `attack <target>` | Attack a hostile |
| `loot <corpse>` | Loot a dead player or NPC |
| `inventory` | Show inventory |
| `take / drop / use / equip` | Item management |
| `recipes` | Show craftable recipes |
| `craft <recipe_id>` | Craft an item |
| `shop <npc>` | Browse a vendor |
| `buy / sell <item>` | Trade with a vendor |
| `stats` | Show vitals and stats |
| `skills` | Show skill levels |
| `mutations` | Show your mutations |
| `factions` | Show faction standing |
| `talk <npc>` | Dialogue with an NPC |
| `say <message>` | Speak in the room |
| `who` | List online players |
| `help` | Full command list |

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

- [x] WebSocket real-time server (Node.js)
- [x] Player auth (register / login)
- [x] 8 zones with descriptions, exits, ambient events, danger ratings
- [x] Movement with radiation exposure
- [x] Real-time combat with cooldowns, crits, miss rolls
- [x] Enemy AI with targeting and attack timers
- [x] Status effects (bleeding, burning, irradiated)
- [x] Survival meters — HP, Sanity, Hunger, Thirst, Radiation
- [x] Full loot PvP — corpses lootable by anyone for 10 minutes
- [x] **Crafting system** — quality tiers, skill checks, station requirements, crit crafts
- [x] **Mutation system** — radiation triggers permanent mutations with buffs/drawbacks
- [x] **Faction reputation** — 6 tiers, trade discounts, hostile behavior
- [x] **Vendor system** — buy/sell with faction rep discounts
- [x] Skill system — 17 skills, XP-by-use, rank 0–10
- [x] NPC dialogue trees
- [x] **Plugin system** — hook-based, drop-in extensibility
- [x] Dev panel — Zone, Enemy, Item, NPC editors with live hot-reload
- [x] World state monitor
- [x] Keepalive — prevents Render free tier spin-down during play
- [x] Cold-start UX — client shows notice, reconnects automatically
- [x] WebSocket heartbeat — kills stale connections

## What's Next

- [ ] Quest system (faction arc storylines)
- [ ] Zone node graph in dev panel
- [ ] Crafting station placement in zones
- [ ] Player crews / guilds
- [ ] Sanity effects (hallucinated room text)
- [ ] Architect Interface skill events
- [ ] In-game map for dev ghost mode
