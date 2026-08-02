# Server Overview

## What the Server Is

A single long-lived Node.js process. It owns everything: HTTP file serving, WebSocket connections, the game loop, the in-memory world state, and all database writes. There is no separate worker or job queue — the process is the game.

On startup (`boot()` in `index.js`), it runs in order:

1. `loadMisSettings()` / `loadEmailVerificationSetting()` — server settings from the DB
2. `initWorld()` — loads zones, NPCs, doors, furniture, orgs, spawn templates, and apartments from Postgres into memory, then reconciles apartment door locks and NPC homes vs. ownership
3. `loadRecipes()` / `loadDrugs()` / `loadItems()` / `reloadCrimes()` / `reloadAliases()` / `loadMutations()` / `loadBanterLibrary()` — content definitions into memory (`loadItems` populates the `items-cache.js` write-through cache)
4. `loadPlugins()` — scans `/plugins/` and wires up hook/command/route registrations
5. `initEnvironment()` — loads the game clock and weather state, fires `environment.init` hooks (non-fatal if schema not yet applied)
6. `startGameLoop()` — starts all the timed intervals
7. `startKeepalive()` — begins pinging Render `/health` every 10 minutes (deliberately does **not** touch the database, so the Neon compute can sleep)
8. HTTP server listens — behind an `EADDRINUSE` guard that exits rather than lingering as a zombie holding pool connections

**Note:** there is no `migrate()` call at startup. The server never touches the schema on boot — schema changes are applied deliberately with `npm run db:schema`.

---

## The Two Sources of State

**Postgres (source of truth):** Player accounts, stats, skills, inventory, items on the ground, zone definitions, NPC definitions, enemy templates, spawn rules, the world clock. Anything that needs to survive a server restart lives here.

**In-memory (`world.js`):** The live, fast-moving state the game loop needs every second — which players are in which zone, enemy HP, enemy aggro targets, spawn cooldowns, corpse expiry. This is populated from Postgres at boot and kept in sync during play. Enemy instance HP is *never* persisted — if the server restarts, all live enemies vanish and `tickSpawns` rebuilds them within 10 seconds. Player corpses *are* persisted (`player_corpses`, 60-minute expiry) and reloaded at boot.

The in-memory cache is a single module-level object in `world.js`:

```js
const world = {
  zones: new Map(),      // zoneId -> zone object (includes .players, .enemies sets)
  players: new Map(),    // playerId -> live player object
  enemies: new Map(),    // instanceId -> live enemy instance
  npcs: new Map(),
  corpses: new Map(),
  spawnTimers: new Map(),
  apartments: new Map(), // zoneId -> apartment row
  doors: new Map(),      // id -> door row; ONE fixture per connection (see getDoorForEdge)
  connections: new Map(),// id -> connections row (authored links; anchors every door)
  orgs: new Map(),       // + orgMembers / zoneControl / orgAssets / orgVentures
  maps: new Map(),       // mapId -> maps row (parent_zone_id links interior to overworld tile)
  furniture: new Map(),  // id -> furniture row (write funnel keeps it in sync; DB stays SoT)
  regions: new Map(),
  transientZones: new Set(), // synthetic non-DB zones injected at runtime
};
```

**Doors resolve through `doorOnLink(fromId, direction, toId)` / `getDoorForEdge(fromId, toId)` in
`world.js` — never by scanning `(zone_id, exit_dir)` yourself.** A door is a fixture on an authored
connection, so a link has exactly one and both of its endpoints find the same one; the near-then-far
fallback that used to be written out at every call site is inside those two functions now, kept only
for transient zones, which have no connection rows by construction. See
[map-pipeline-spec §6.3](proposals/map-pipeline-spec.md).

Several of these Maps are read tiers with a **mandatory write funnel** — a raw `UPDATE furniture`/`UPDATE npcs` silently desyncs them. See [architecture.md → Read Tiers](architecture.md#read-tiers-where-data-lives-at-runtime).

Any engine file that needs world state imports directly from `world.js`. There is no pub/sub or event bus between engine modules — they call each other synchronously or await shared helpers.

---

## The Game Loop

`gameLoop.js` owns all recurring server-side logic. It uses a thin scheduler (`scheduler.js`) that wraps `setInterval` with named cadences, plus one raw `setInterval` for the latency-critical 1-second combat tick.

| Name | Interval | Responsibility |
|---|---|---|
| `tick()` | 1 second | Enemy AI decisions, enemy attacks on players, auto-retaliation, status effect ticks; ends by calling `flushDirtyResources` |
| `stormTick` | 5 seconds | Lightning across the storm field (the server is the single strike authority) |
| `tickSpawns` | 10 seconds | Spawns enemy instances into zones that are below their `zone_spawns` max count |
| `restRegenTick` | 15 seconds | HP/stamina regen while resting — sets `_resDirty`, writes nothing itself |
| `npcBanterTick` | 30 seconds | Two-NPC ambient banter in occupied zones |
| `ambientTick` | 45 seconds | Sends flavor text to occupied zones (via plugin hook or zone's own ambient pool) |
| `minuteTickFn` | 1 minute | Radiation decay, drug decay, fires the `tick.minute` plugin hook |
| `resourceTick` | 1 minute | Hunger/thirst decay, starvation/dehydration damage, heal-over-time, well-fed regen |
| `npcWanderTick` | 15 s | NPC behaviour graphs + idle wandering (`NPC_TICK_SECONDS` in `ai-behaviour.js` mirrors this) |
| `flushDirtyPositions` | 1 minute | Batched write of every moved player's `current_zone`/`stamina` |

Only `tick()` is a raw `setInterval`, and it carries its own `hasActivePlayers` guard because it does not inherit the scheduler's. Everything else registers through `scheduler.js` and is idle-gated automatically (`gameLoop.js:46-70`).

**Same-cadence stagger.** `scheduler.js` spreads subscribers sharing a cadence so a convoy of ticks can't check out every pool connection in the same instant. The gap is `min(200 ms, period / (subscribers + 1))` — **the cap matters**: a flat 200 ms was fine at `'1m'`, but `'1s'` grew to ten subscribers, and 10 × 200 ms is a 2-second spread on a 1-second period. The tail of that list was being scheduled to fire *after* the next tick had already started, so it silently ran at half rate against its own reentrancy guard. Dividing by `(n + 1)` keeps the last subscriber strictly inside the period however many subscribe.

### Posture-driven activities (`activity-tick.js`)

A plugin whose mechanic is "hold a posture and something happens every so often" must **not** register its own `schedule('1s', …)`. It registers with the activity substrate instead:

```js
import { registerActivity } from '../../server/engine/activity-tick.js';

registerActivity({
  posture:   'mining',      // the posture that means "doing this"
  stateKey:  'mineState',   // per-player state field on the live player object
  onTick:    async (player, st, nowMs) => { … },  // while the posture holds
  onAbandon: (player, st) => { … },               // posture lost → clean up + narrate
});
```

One 1-second sweep of `getAllLivePlayers()` serves every registered activity, replacing the six identical timers that scavenging, mining, fishing, butchering, weightbench and work each ran (crafting registered here too, rather than growing a seventh). `onTick` owns its own pacing (its `ATTEMPT_MS` / countdown check) — the substrate deliberately imposes no shared cadence, because the activities genuinely differ. Reentrancy is guarded **per activity**, and activities dispatch concurrently, so a slow resolution in one can't stall the others. Within a single activity, players are processed **in order**, one await at a time — the per-zone loot tables read stock, compute a lazy replenish in JS and write absolute quantities back, so two players working one zone concurrently would both apply the same replenish and duplicate the stock.

`onAbandon` fires when a player still has state but no longer holds the posture (moved, stood, was hit, died). It runs synchronously and is expected to clear the state key, so it fires exactly once.

### Ticks that poll for work (`worklist.js`)

A tick that asks the database "is there anything due?" on a loop is the quietest way to keep a server busy doing nothing. Measured on an idle world, `script_waits`, `jail_prisoners` and `smuggle_orders` were each being polled on a schedule while holding **zero rows between them** — every poll a remote round trip, and round trips on a quiet server are exactly what stops Neon's compute suspending.

Gate those ticks instead:

```js
import { createWorkGate } from './worklist.js';

const gate = createWorkGate({
  name: 'script_waits',
  probe: async () => (await query('SELECT COUNT(*)::int AS n FROM script_waits')).rows[0].n,
});

// in the tick
if (!await gate.shouldRun()) return;

// wherever a row is written
gate.noteWork();
```

**The counter is an optimisation; the probe is the correctness.** The naive version of this — a counter incremented by writers — fails silently and permanently the moment one writer isn't wired: jail sentences never end, parked scripts never resume, and nothing errors. So the gate never trusts the counter indefinitely. Even believing the count is zero it re-probes on `reconcileMs` (default 5 min), which turns a missed `noteWork()` into a bounded **delay** rather than a stall, while still skipping the vast majority of polls. A probe that throws **fails open** and runs the tick.

`noteWork()` is cheap and forgiving — it just marks the gate dirty, so callers never maintain a running total and double-calling is harmless. `noteDrained(n)` is the optional fast path when a tick knows it emptied the queue.

`dailyMaintenance` and `rentCollectionTick` run on the **game** calendar rather than a real interval — both subscribe to the `environment.dayRollover` event, so they track the game-speed knob.

The environment system (`environment.js`) registers on the same scheduler: a **1-minute** clock driver, a **5-minute** brownout check (only while a zone is overloaded or a storm is faulting the grid), and a **30-second** flicker + weather-field advection pass. Its 30-minute and 24-hour ticks are *not* real cadences — the 1-minute driver fires them on **game**-minute boundaries, so date, day-phase and streetlights stay in lockstep with a sped-up day (`environment.js:422-430,841-871`).

---

## Handling Player Input

All player communication goes over a single persistent WebSocket connection. `index.js` manages two maps: `clients` (ws → session) and `playerSockets` (playerId → ws).

Incoming messages are dispatched by `type`:

| Message type | Handler | What it does |
|---|---|---|
| `auth` | `handleAuth()` | Validates credentials, builds the in-memory player object, sends room description |
| `auth_token` | `handleAuthToken()` | Same, but for dev-panel account-switching via a one-time token |
| `command` | `handleGameCommand()` | Looks up the live player, calls `handleCommand()` in `commands.js` |
| `dialogue` | `handleDialogue()` | Looks up NPC, resolves the chosen dialogue node, optionally grants items |
| `ping` | inline | Responds with `pong`, also resets the socket liveness flag |

Four more families sit alongside these in the same `msg.type` chain (`server/index.js:308-380`): shop (`buy_npc`/`sell_npc`/`sell_all_npc`/`shop_close`), ghost session (`auth_ghost`/`ghost_command`/`ghost_jump`/`ghost_refresh`), client panels (`panel_data`/`panel_watch`/`panel_catalog`), and broadcast viewing (`tv_watch`/`tablet_tv_watch`/`deck_watch`/`tv_schedule`/…).

`handleCommand()` in `engine/commands/index.js` is the main dispatcher — see [commands.md](commands.md) for the full dispatch pipeline. Plugin-registered commands are checked via `fireCommand()` ahead of the engine builtins.

**Broadcasting:** `broadcast(zoneId, message, excludePlayerId, targetPlayerId, excludePlayerId2, excludeSet)` in `index.js` is the single send function (`server/index.js:99-106`). Pass a `zoneId` to send to everyone in that zone; pass a `targetPlayerId` to send to one player; pass neither to send to all connected players. Engine modules receive `broadcast` as a passed-in function or via `setBroadcast()` (`engine/messaging.js:12`) — nothing imports it directly from `index.js`.

**Pointing a player at a thing (`engine/messaging.js`).** Three escalating levels, all
cosmetic — every one of them is a hint the client is free to ignore (motion off, an old
bundle), so the prose must always still read on its own:

| Call | Wire | Lifetime | Use it for |
|---|---|---|---|
| `teachVerb(verb, action, target)` | inline `<span class="verb-teach">` in your own message | shimmers 3× then settles | the **first mention of a verb**, anywhere. The house convention |
| `pointAt(id, action, target)` | `point_at` | rings ripple out of the room-pane link, ~3.6s, then gone | "click *that* one, up there" — announcing a target the prose just named |
| `beaconOn(id, action, target)` / `beaconOff` / `beaconClear(id)` | `beacon` | **sticky** — shimmers until turned off, and is re-stamped after every room re-render (`render.js applyBeacons`) | the object an **onboarding step** is steering you toward, where a player who looked away has nothing left on screen telling them what to do |

**Light ONE thing.** A beacon is a highlight, not a strobe. Two shimmering objects at
once stop reading as "this one" and start reading as decoration, and the player is back
to guessing — which is the problem beacons exist to solve. The prologue's rule: the
attendant shimmers until you talk to him, the terminal doesn't shimmer until his dialogue
has said what it's for (a `PROLOGUE_BEACON` action on that node), and it goes out the
moment it's used.

`action`/`target` must match a room-pane link's `data-action`/`data-target` — furniture is
`examine <name>`, NPCs `talk <name>`, exits `go <dir>`, ground items `take <name>` (see
`commands/describe.js`). A beacon for a link that isn't in the pane yet retries briefly, then
gives up quietly. **Always pair a `beaconOn` with the `beaconOff` on the step that completes
it** — the prologue (`plugins/prologue/index.js`) does this through one `setBeacons(player, […])`
helper that diffs against the previous step, which is the pattern to copy.

---

## Serving the Client (assets + socket)

There is no build step, so `server/index.js` is also the static file server and the only thing
standing between `client/` and the browser. Both halves of that are compressed and cached
deliberately — this is a Render free-plan box whose event loop also carries every WebSocket
message, so a blocking read or an uncompressed megabyte is paid for by everyone already playing.

**Static assets** (`server/index.js`, the `assetCache` block). Files are read **once**, compressed
once, and held in memory keyed by mtime:

- **Brotli (quality 5) with a gzip fallback**, negotiated off `Accept-Encoding`. Quality 5, not 11
  — 11 is for build-time pipelines and can block the loop for seconds; 5 lands within a few percent
  for a fraction of the cost, and only runs once per file version.
- **Only text types**, and only files ≥ 1 KB. Running deflate over a `.png`/`.ico` burns CPU to make
  it marginally bigger.
- **`Vary: Accept-Encoding` on anything compressible**, not just what was actually compressed —
  otherwise a shared cache can hand a brotli body to a client that never asked for one.
- **mtime-keyed**, so an edited file is picked up without a restart, and `304` revalidation still
  works off `Last-Modified`.

Measured: the `client/game` + `client/shared` tree is **4.93 MB raw → 1.32 MB brotli (3.7×)**. The
previous code did a synchronous `readFileSync` + `statSync` **per request** — ~82 blocking syscalls
per cold load, each a micro-stall for every connected player.

**The WebSocket** (`new WebSocketServer(...)` in `server/index.js`). `perMessageDeflate` is enabled
and **configured**, not set to bare `true` — `ws`'s own docs warn its defaults fragment memory under
load. A `threshold` of 1 KB lets small status/vitals ticks skip deflate; `memLevel: 7` and a
`concurrencyLimit` keep per-connection memory and zlib work bounded; `clientNoContextTakeover` is on
because clients only ever send tiny commands, so an inbound context costs memory and buys nothing.
Server-side context takeover stays **on** deliberately: consecutive minimaps share ~90% of their
bytes.

Why it matters: a `look` payload measures **34 KB, of which ~97% is the minimap node array** — the
most repetitive JSON in the system. It compresses **17.9× with gzip, 24.3× with brotli**. Idle
socket chatter, by contrast, is noise (~18 KB/min at 20 players), so the win is entirely in
room/movement payloads.

> **Still outstanding:** the minimap is *over-fetched* — every move sends a depth-8 BFS while the
> sidebar renders a 9×9 window. Before trimming it, note the same payload also feeds the
> reachability dimming **and** the void-crossing journey view (`movement.js`, `crossingInnerHtml`),
> so depth cannot simply be lowered.

---

## REST and the Dev Panel

The dev panel communicates exclusively via REST, not WebSocket. All routes are handled by `api/routes.js`, dispatched through the HTTP server's `handleApiRequest()`. Authenticated via a base64 token issued at WebSocket login for users with `dev`/`admin`/`builder`/`designer` roles.

Dev panel writes (zone saves, enemy edits, etc.) go to Postgres first and then call the appropriate `world.reload*()` function to patch the in-memory cache — changes are live for all connected players immediately without a restart.

---

## The Plugin System

Plugins live in `/plugins/`. Each plugin is a folder with two files:

```
plugins/
  my-plugin/
    plugin.json    -- manifest: name, version, which hooks/commands/routes it owns
    index.js       -- exports: hooks, commands, routeHandler
```

`loadPlugins()` scans the directory at boot, imports each `index.js`, and wires up whatever the plugin declares.

### Extension points

Four are wired by the loader (`engine/plugins.js`), plus specialized actions and Events
registered imperatively at module load. [plugin-standard.md](plugin-standard.md) owns the
full manifest contract; the three below are the ones the loader reads off the manifest.

**1. Hooks** — the most common. A plugin subscribes to named events fired by the engine:

```js
// plugin.json
{ "hooks": ["tick.minute", "zone.describeRoom"] }

// index.js
export const hooks = {
  "tick.minute": ({ broadcast }) => { /* runs every minute */ },
  "zone.describeRoom": (zone) => "A cold wind cuts through the ruins.", // appended to room text
};
```

`fireHook(name, ...args)` calls all subscribers in load order. If any handler returns a non-undefined value, the last such return is passed back to the caller — hooks can inject content, not just react to events.

`gatherHook(name, ...args)` calls the same subscribers but keeps **every** non-undefined return, flattened one level. Use it wherever the question is "what does everyone have to contribute" rather than "what is this value" — senses, and the room description. `zone.describeRoom` was moved to `gatherHook` on 2026-08-01: seven plugins register it and they can co-occur (a tagged wall on an airfield tile is both things at once), so under `fireHook` the last-loaded plugin silently ate the others' line. The hook table below marks which shape each hook uses.

**2. Commands** — a plugin can own player-typed commands:

```js
// plugin.json
{ "commands": ["ideologies", "rep"] }

// index.js
export const commands = {
  "ideologies": (args, raw, player, broadcast) => ({ type: 'info', message: '...' }),
};
```

`engine/commands/index.js` calls `fireCommand()` ahead of the engine builtins, so a plugin command shadows a builtin of the same name (which becomes dead code — see [plugins.md](plugins.md)).

**3. Route handlers** — a plugin can handle REST requests under a path prefix:

```js
// plugin.json
{ "routePrefix": "/api/myroute" }

// index.js
export function routeHandler(path, method, body, auth) {
  if (method === 'GET') return { status: 200, body: { ... } };
  return null; // fall through to built-in routes
}
```

`routes.js` calls `fireRoutes()` before its own route matching. Return `null` to pass through.

**4. Input matchers** — `registerInputMatcher(pattern, handler)` runs against the raw input line before single-word command routing, for multi-word verbs a `commandName` can't express ("jerk off on", "eat out"). First matching pattern wins.

### Hook reference

Every hook the engine fires. **A name not in this table is not a hook** — subscribing to
one costs nothing and does nothing, silently. (Zone *entry* and combat *hits* are Events,
not hooks: `zone.entered` is emitted on the event bus at `commands/movement.js:441` — see
[scripting.md](scripting.md).)

| Hook | Fired by | Args | Return value used? |
|---|---|---|---|
| `tick.minute` | `gameLoop.js:372` | `{ broadcast }` | No |
| `player.death` | `gameLoop.js:614` | `(player, killer)` | No |
| `player.respawnZone` | `gameLoop.js:523` | `(player, killer)` | Yes — overrides the respawn zone |
| `zone.describeAmbient` | `gameLoop.js:632` ambientTick | `(zone)` | Yes — broadcast as ambient text |
| `zone.describeRoom` | `commands/describe.js:1029` | `(zone, player)` | **GATHERED** — every contributor's line is appended to the room description, newline-joined |
| `zone.introLore` | `commands/describe.js:568` | `(zone, player)` | Yes |
| `zone.furniturePanel` | `commands/describe.js:487` | `(zone, furniture, player)` | Yes |
| `visibility.perceive` | `commands/describe.js:363`, `combat.js:25`, `environment.routes.js:82` | `(perceiver, vis, zone?)` | Yes — the perceiver's effective light |
| `movement.edge` | `commands/movement.js:356` | `{ player, zone, direction, broadcast, opts }` | Yes |
| `movement.arriveMessage` | `commands/movement.js:478` | `{ player, fromZone, toZoneId, direction, arrivalDir, defaultMessage }` | Yes |
| `npc.talk` | `commands/social.js:25` | `{ player, npc, broadcast }` | Yes |
| `dialogue.synthetic` | `index.js` `handleDialogue` | `{ player, npcId, choice, optionIndex, broadcast }` | Yes — the next dialogue frame, sent verbatim. Fired only for an `npcId` containing `:`, i.e. one no `npcs` row can own, so a plugin can hold a conversation with something that does not exist (see plugins/trip). Claim your own prefix and return `undefined` for anyone else's. |
| `speech.transform` | `commands/social.js:73` | `{ player, text }` | Yes — replaces the spoken text |
| `player.say` | `commands/social.js:79` | `{ player, text, zoneId, broadcast }` | No |
| `player.appearanceNotes` | `commands/world.js:312` | `{ target, viewer, isSelf }` | Yes |
| `item.consumed` | `commands/inventory.js` (consumable path) | `(player, tags)` | Yes — a line appended to the use output |
| `player.appearanceMisNotes` | `commands/world.js:351,386` | `{ target, viewer, isSelf, broadcast, naked, … }` | Yes |
| `furniture.describe` | `commands/world.js:476` | `(furniture, player)` | Yes |
| `forcefield.gate` | `apartments.js:144` | `{ player, zoneId }` | Yes — a non-empty return blocks the forcefield |
| `drug.used` / `drug.overdose` | `drugs.js:520,541,570` / `:479` | `{ player, drug, potency\|lethal, broadcast }` | No |
| `player.create` / `player.login` | `api/routes.js:496,523` | `{ id, handle, username?, role }` | No |
| `zone.create` / `zone.update` / `zone.delete` | `api/routes.js:658,686,711,1668` | `(id, body)` / `(id, deletedIds)` | No |
| `environment.init` | `environment.js:361` boot | `{ setWeatherState, setCurrentPrecip, climateProfile, registerWeatherField, registerWeatherFieldSnapshot, registerWeatherFieldAdvance, registerWeatherEventStep, registerWeatherEventTrigger, registerWeatherRegionRefresh }` | No |
| `environment.advanceWeather` | `environment.js:1039` 24h tick | `{ setWeatherState, rollAndSetCurrentPrecip, getHUDPayload, broadcast, currentForecast, currentDate, climateProfile }` | No |
| `environment.tick30m` / `environment.tick24h` | `environment.js:1002,1047` | payload + `{ setCurrentPrecip, getHUDPayload, broadcast }` on 30m | No |
| `environment.sunrise` / `environment.sunset` | `environment.js:1004,1005` | payload | No |
| `environment.weatherChange` | `environment.js:1048` | `{ weatherType, tempC }` | No |
| `environment.recalculateForecast` | `environment.js:2284,2324` | `{ setWeatherState, climateProfile, currentDate }` | No |
| `environment.scheduleForecastDay` | `environment.js:2341` | `{ forecastDay, weatherType, tempC, windKph, humidityPct, setWeatherState, currentForecast }` | No |
| `environment.weatherFieldSync` | `environment.js:2310` | `{ forecast0 }` | No |
| `worldValidator.runFull` / `worldValidator.runZone` | `worldvalidator.routes.js:25,34` on demand | `(body)` / `(zoneId, opts)` | Yes — used as the HTTP response body |

### Plugins cannot do (yet)

- Register their own dev panel UI tabs without editing `devpanel/index.html`
- Be enabled or disabled at runtime — it's add/remove the folder + restart
- Declare inter-plugin dependencies

---

## After Boot

Nothing re-reads the world from the DB unless `world.reloadZone()` (or similar) is called explicitly by an API write. The in-memory cache is the game's working state.
