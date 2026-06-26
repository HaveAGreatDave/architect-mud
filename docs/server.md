# Server Overview

## What the Server Is

A single long-lived Node.js process. It owns everything: HTTP file serving, WebSocket connections, the game loop, the in-memory world state, and all database writes. There is no separate worker or job queue — the process is the game.

On startup (`boot()` in `index.js`), it runs in order:

1. `loadMisSettings()` — loads miscellaneous server settings from the DB
2. `initWorld()` — loads zones, NPCs, spawn templates, and apartments from Postgres into memory
3. `loadRecipes()` / `loadDrugs()` / `loadMutations()` — loads content definitions into memory
4. `loadPlugins()` — scans `/plugins/` and wires up hook/command/route registrations
5. `initEnvironment()` — loads the game clock and weather state, fires `environment.init` hooks (non-fatal if schema not yet applied)
6. `startGameLoop()` — starts all the timed intervals
7. `startKeepalive()` — begins pinging Render and Supabase every 10 minutes
8. HTTP server listens

**Note:** there is no `migrate()` call at startup. The server never touches the schema on boot — schema changes are applied deliberately with `npm run db:schema`.

---

## The Two Sources of State

**Postgres (source of truth):** Player accounts, stats, skills, inventory, items on the ground, zone definitions, NPC definitions, enemy templates, spawn rules, the world clock. Anything that needs to survive a server restart lives here.

**In-memory (`world.js`):** The live, fast-moving state the game loop needs every second — which players are in which zone, enemy HP, enemy aggro targets, spawn cooldowns, corpse expiry. This is populated from Postgres at boot and kept in sync during play. Enemy HP is *never* persisted — if the server restarts, all live enemies vanish and `tickSpawns` rebuilds them within 10 seconds.

The in-memory cache is a single module-level object in `world.js`:

```js
const world = {
  zones: new Map(),    // zoneId -> zone object (includes .players, .enemies sets)
  players: new Map(),  // playerId -> live player object
  enemies: new Map(),  // instanceId -> live enemy instance
  npcs: new Map(),
  corpses: new Map(),
  spawnTimers: new Map(),
  apartments: new Map(),
};
```

Any engine file that needs world state imports directly from `world.js`. There is no pub/sub or event bus between engine modules — they call each other synchronously or await shared helpers.

---

## The Game Loop

`gameLoop.js` owns all recurring server-side logic. It uses a thin scheduler (`scheduler.js`) that wraps `setInterval` with named intervals, plus one raw `setInterval` for the latency-critical 1-second combat tick.

| Name | Interval | Responsibility |
|---|---|---|
| `tick()` | 1 second | Enemy AI decisions, enemy attacks on players, auto-retaliation, status effect ticks |
| `minuteTickFn` | 1 minute | Radiation decay, fires `tick.minute` plugin hook |
| `ambientTick` | 45 seconds | Sends flavor text to occupied zones (via plugin hook or zone's own ambient pool) |
| `resourceTick` | 1 minute | Hunger/thirst decay, starvation/dehydration damage, heal-over-time, well-fed regen |
| `tickSpawns` | 10 seconds | Spawns enemy instances into zones that are below their `zone_spawns` max count |
| `cleanCorpses` | 30 seconds | Expires lootable player corpse objects from memory (they never hit the DB) |

The environment system (`environment.js`) runs its own independent intervals outside the game loop: a 30-minute tick for ambient light and street-light toggling, and a 24-hour tick for full power network simulation and weather advancement. These are not coordinated with `gameLoop.js` — they share the same DB pool and fire independently.

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

`handleCommand()` in `commands.js` is the main dispatcher — it parses the command string and routes it to the appropriate function (movement, attack, inventory, crafting, etc.). Plugin-registered commands are checked first via `fireCommand()` before the built-in switch statement.

**Broadcasting:** `broadcast(zoneId, message, excludePlayerId, targetPlayerId)` in `index.js` is the single send function. Pass a `zoneId` to send to everyone in that zone; pass a `targetPlayerId` to send to one player; pass neither to send to all connected players. Every engine module that needs to push messages to clients receives `broadcast` as a passed-in function — nothing imports it directly from `index.js`.

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

### Three extension points

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

**2. Commands** — a plugin can own player-typed commands:

```js
// plugin.json
{ "commands": ["factions", "rep"] }

// index.js
export const commands = {
  "factions": (args, raw, player, broadcast) => ({ type: 'info', message: '...' }),
};
```

`commands.js` calls `fireCommand()` before its own switch statement, so plugin commands take precedence over any future built-in with the same name.

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

### Hook reference

| Hook | Fired by | Args | Return value used? |
|---|---|---|---|
| `tick.minute` | `gameLoop.js` minuteTick | `{ broadcast }` | No |
| `player.enterZone` | `commands.js` move | `(player, zone)` | No |
| `player.death` | `gameLoop.js` handlePlayerDeath | `(player, killer)` | No |
| `combat.hit` | `commands.js` resolveAttack | `(player, enemy, result)` | No |
| `zone.describeRoom` | `commands.js` describeZone | `(zone)` | Yes — appended to room description |
| `zone.describeAmbient` | `gameLoop.js` ambientTick | `(zone)` | Yes — broadcast as ambient text if returned |
| `zone.create` / `zone.update` / `zone.delete` | `api/routes.js` | `(zone)` | No |
| `environment.init` | `environment.js` boot | `{ setWeatherState }` | No |
| `environment.advanceWeather` | `environment.js` 24h tick | `{ setWeatherState, currentForecast, currentDate }` | No |
| `environment.tick30m` / `environment.tick24h` | `environment.js` | — | No |
| `environment.weatherChange` / `environment.sunrise` / `environment.sunset` | `environment.js` | — | No |
| `worldValidator.runFull` / `worldValidator.runZone` | `worldvalidator.routes.js` on demand | — | Yes — used as the HTTP response body |

### Plugins cannot do (yet)

- Register their own dev panel UI tabs without editing `devpanel/index.html`
- Be enabled or disabled at runtime — it's add/remove the folder + restart
- Declare inter-plugin dependencies

---

## Boot Sequence Summary

```
index.js boot()
  ├── migrate()              schema exists
  ├── initWorld()            zones/NPCs/spawns loaded into world.*
  ├── loadRecipes/Drugs/Mutations()
  ├── loadPlugins()          hooks/commands/routes registered
  ├── initEnvironment()      clock + weather loaded, environment.init hook fired
  ├── startGameLoop()        setIntervals begin ticking
  └── httpServer.listen()    accepting connections
```

After boot, nothing re-reads the world from DB unless `world.reloadZone()` (or similar) is called explicitly by an API write. The in-memory cache is the game's working state.
