# Dev Panel JS

The dev panel was split out of the old monolithic `index.html` inline script into the
files below. These are **plain classic scripts** (no build step, no ES modules): they all
share one global scope, so a function or top-level `let`/`const` defined in one file is
visible to every file loaded after it. The ~270 inline `on*` handlers in `index.html`
depend on this — handler functions must stay global.

## Load order is a contract — do not reorder the `<script>` tags

`index.html` loads these files in a specific order. Two rules drive it:

1. **`core/panels.js` must load _after_ every `panels/*` and `ui/*` file.** The `PANELS`
   object literal references functions by value at construction time (`render:
   renderDashboard`, `editForm: zoneEditForm`, …). Those function declarations only
   create their global binding when their own script runs, so they must all run first.

2. **`bootstrap.js` must load _last_.** It holds the only code that executes immediately
   on load (auto-auth IIFE, the password-field listener, `applyDevSettings()`, the
   `storage` + `DOMContentLoaded` listeners). It can only run once every function and
   state binding it touches already exists.

Everything else (pure function declarations, top-level state) is order-independent,
because those functions are only *called* at runtime after login.

## Layout

- `core/` — `state.js` (globals), `api.js` (`API`/`directAPI` + staging routing),
  `table.js` (shared list/edit lifecycle), `panels.js` (the `PANELS` registry +
  `showPanel`/`loadPanel`), `auth.js` (`devLogin`/`devpanelLogout`),
  `staging.js` (publish/reject + Changes panel).
- `ui/` — `modal.js` (generic modal + `toast`), `settings.js` (settings + theme editor),
  `whisper.js` (whisper chat).
- `panels/` — one file per dev-panel section (zones, zone-subeditors, enemies, items,
  npcs, furniture, simple-entities, scripts, quests, maps, power, sounds, players,
  timeweather, worldstate, validator, tags, dashboard).
- `bootstrap.js` — all immediately-executing startup code; **loaded last**.
