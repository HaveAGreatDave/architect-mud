# Architecture audit follow-ups (October 2026)

**Status: proposal.** The contained fixes from the 4 October audit shipped in six commits (server robustness, deploy durability, account and socket holes, the deploy pipeline, the client's first load, plugin order). What's left needs a plan, a decision, or a fact only prod can supply. Each item says which.

## Settings to make on prod

- **`TRUSTED_PROXY_HOPS`** on the Render service. The rate limiter keys on the leftmost `X-Forwarded-For` entry until it's set, and a client controls that entry. After the next deploy, read the `[rate-limit] X-Forwarded-For carries N address(es)` line from the Render log and set the variable to N. Don't guess it: a count that's too high keys every player on one edge address and locks out logins.
- **`CONTENT_READONLY` and `AUTH_SECRET`.** Boot now warns on Render when either is missing. If the log shows the warning, set them in the dashboard; render.yaml doesn't reach the live service.

## Decisions

### The deploy cron

GitHub fires `37 */4 * * *` three or four times a day instead of six, often hours late. The daily usage watch now opens an issue when deployable commits wait more than 8 hours, which makes a stall visible but doesn't prevent it. Two ways to stop relying on GitHub's cron:

- **A push-triggered trailing debounce.** On push, a job sleeps for a quiet period inside a `cancel-in-progress` concurrency group, so each new push restarts the wait, then hands off to the deploy job, with a minimum gap since the last deploy to keep the egress budget. No external pieces; Actions minutes are free on a public repo. Recommended.
- **An external scheduler** (a Cloudflare Workers cron or cron-job.org) calling `workflow_dispatch` with a fine-grained token scoped to Actions on this repo.

### Snapshot retention

The deploy keeps the newest five Neon snapshot branches, about a day and a half at the current cadence, because of the free plan's branch cap. A snapshot a day for a week needs either a paid plan or a different recovery point, such as a nightly `pg_dump` kept privately.

### `makeitrain` before launch

It's open to every role on purpose for playtesting (plugins/dev-tools/index.js). Its own comment says to restore the `['admin', 'dev']` check before launch; put it on the launch checklist.

## Plans

### 1. Stop the whole room re-looking on every step

Arrive and depart both set `refresh: true`, and the client answers every refresh with a full `look`: three or four queries, a 34 KB minimap and a scan of all 17,000 zones. A step into a room of N players costs about 3N queries.

1. Send an occupant change (`{ type: 'occupants', add, remove }`) for arrive and depart instead of `refresh`, and have the client patch the room panel.
2. Serve sleepers, ground items and junction boxes from RAM, so a look that does happen costs no queries.
3. Index zones by grid, so the minimap stops scanning every zone.
4. Then audit the other ~150 `refresh: true` sites; most want a targeted update too.

### 2. A plugin loader that knows dependencies

There are 88 runtime plugin-to-plugin imports and 22 are declared. A plugin that fails to load takes its importers with it, and plugins register at module scope, so importing another plugin's `index.js` runs its gates and ticks even when the loader never loaded it.

1. Read `dependencies` (or a new `requires`) in plugins.js: load dependencies first, and skip a dependent of a failed plugin with a message that names the root failure.
2. Add an optional `init()` export that the loader calls, and move module-scope registration into it plugin by plugin.
3. Add a gate comparing declared dependencies against the actual `../<plugin>/` imports.

### 3. Move the world-surface code out of flight

`surfaceAt`, `mapWindow`, `skyState`, `isRoadCell` and `registerCellOverlay` in plugins/flight/state.js are imported 24 times by eight other plugins. Move them to `server/engine/surface.js` and have flight re-export them for one release.

### 4. Let a verb fall through between plugins

The command map has no fall-through, so the plugin that wins a verb imports the loser's `commands` to delegate (15 sites; flight imports the 11,400-line broadcast index just for `tune` and `eject`). Keep a handler stack per verb in plugins.js, where returning `undefined` passes to the previous owner.

### 5. Split the god files

- `server/index.js`: static serving, the HTTP server, a WebSocket router built as a `{ type: handler }` table, auth, the session lifecycle (with the close handler's `try/finally`), shop dialogue, ghosts, client sync. Boot and shutdown stay.
- `server/api/routes.js`: a declarative `[method, pattern, role, handler]` table in place of the 183-branch if-chain, then auth, world authoring, generic CRUD driven by content-registry.js, NPCs, admin and dev tools as their own modules.
- `plugins/broadcast/index.js`: peel the 1,200-line CRUD API (`routes.js`) first, then shows, the VINE walker, the deck and piracy, with an `api.js` for outside importers.
- `client/game/js/panels/tablet-os.js`: ship its 338 KB of CSS as a stylesheet, then move each app behind a view map, with arcade, wallpaper and the world map loaded on first use.

### 6. Give `drawWorldObjects` a frame-state object

It assigns about 40 of windshield.js's module variables every frame (the sinks, `ADORN_TIER`, the GL state), so it can't move to its own module: an imported binding can't be assigned. Gathering that state into one object is what makes the world pass, and most of the rest of windshield.js, movable. The churn data says splitting buys size and readability, not fewer collisions; the collision fix is one worktree per session.

## Smaller items

- Move the `/thermals` and flight-snapshot routes out of routes.js into flight's own `routeHandler`, updating the dev panel's Thermals and Maps tabs to the `/flight/` prefix.
- Add a `registerClientMessage` seam for the dozen plugin message types hardcoded in server/index.js (`tv_*`, `deck_*`, `instrument_note`, feedback).
- One shared `escapeHtml` with a lint against local copies, then move the two inline scripts out of index.html and switch the CSP from report-only to enforced.
- Replace `main.js`'s `window._apply*` callbacks with a small settings event module.
- Check each declared verb's owner per plugin in regress layer 1.
