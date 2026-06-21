# Structural Maintainability Sweep — Architect MUD

## Context

The game works and is cleanly content/engine separated, but several files have crossed the line from "fits in one head" to "unwieldy," and they're the files that grow *fastest* as content scales. At 10–20× the current dozen zones/items/enemies, the friction compounds in three places:

1. **The game client is a 2,174-line monolith** — `client/game/index.html` carries ~1,550 lines of inline JS in one `<script>` block: WebSocket/auth, a 40+-case server-message dispatcher, and ~8 distinct UI panels (whisper, equipment, lightview, minimap, environment HUD, dialogue, who, settings) all sharing implicit globals. Every new server message type or panel adds to the same block. This is the stated #1 pain.
2. **The built-in command dispatcher is a 1,255-line file with a 49-case switch** — `server/engine/commands.js` is also the room renderer and the integration point for every gameplay system. Plugins *can* now register commands (the API exists), but the built-in surface is still one growing switch.
3. **Content authoring scales by hand-editing** — `seed.js` (371 lines) and the dev panel's ~40 hand-written entity form builders (`client/devpanel/index.html`, 3,240 lines) grow linearly per entity type and per field.

**Important reconciliation:** `docs/plugin-architecture-analysis.md` predates recent work and is now **partly stale**. Its headline "Phase 1" asks (command registration, route registration, a unified `effects.js`) are **already implemented** — see `plugins.js` (`registerCommand`/`fireCommand`/`registerRoutes`/`fireRoutes`) and `server/engine/effects.js`. This plan supersedes that doc's roadmap for the *client + content* axis it never really covered, and the doc should be marked updated (Phase 0).

**Decisions locked:**
- Frontend split uses **native ES modules** (`<script type="module">` + `import`) — **no build step**. This honors "no build pipeline" but deliberately relaxes the "single HTML/JS file per client" line in `CLAUDE.md`. CLAUDE.md must be updated to reflect the new rule (Phase 0).
- **Sequence client-first.**
- Dev panel is **included as a later phase**, not deferred to a separate plan.
- A build step (esbuild/Vite) is **not opposed** but deferred to Phase 5+ — noted for the future, not committed now.

**Intended outcome:** No monolith over ~400 lines; new server-message types, panels, commands, and content types each land in a small, named, single-purpose file; one shared client utility layer instead of two divergent copies. Achieved with zero new tooling.

---

## Guiding constraints (apply to every phase)

- **No build step, no framework, no npm deps on the client.** Native ES modules only.
- **Behavior-preserving refactors.** Each phase is a pure restructure — no gameplay or UI change. Verify by playing, not by reading.
- **Surgical per CLAUDE.md.** Move code, don't "improve" it in transit. One concern per module.
- **Land in small commits.** Each module extraction is independently testable and revertable.

---

## Phase 0 — Groundwork (hours; no behavior change)

1. **Update `CLAUDE.md`** — change the "single HTML/JS file per client" rule to: "Each frontend is an HTML entry point plus native ES modules in a sibling directory; no build pipeline." Keep the no-framework / no-build constraints intact.
2. **Mark `docs/plugin-architecture-analysis.md` as superseded-in-part** — add a dated note at the top: command/route registration and `effects.js` now exist; its Phase 1 is largely done; client/content axis is tracked in this plan.
3. **Add a shared-client route** — in `server/index.js` (near the static block at lines 82–89), serve `/shared/*` from `client/shared/`. One `else if`. This lets both clients `import` the same utilities without duplication.
4. **Harden the static fallback** — `server/index.js:86` currently returns `index.html` for *any* missing path, so a typo'd module import silently returns HTML (and fails as a module). Restrict the SPA fallback to extension-less URLs; return a real 404 for missing `.js`/`.css`. This makes module wiring errors visible instead of silent.

---

## Phase 1 — Decompose the game client (the main thrust)

Target layout (new dir `client/game/js/`, plus shared in `client/shared/`):

```
client/shared/
  dom.js          escapeHtml(), el() helper, safe innerHTML wrapper
  settings.js     theme/font/density localStorage (used by both clients)
  ws.js           connect + reconnect/backoff + ping (parameterized)
client/game/js/
  main.js         entry: <script type="module"> imports + wires everything
  state.js        single client-state object (vitals, current zone, convos)
  net.js          auth, command send, message receive (wraps shared/ws.js)
  dispatch.js     handleServerMsg: routes by msg.type to handlers (table, not switch)
  render.js       appendMsg/appendHtml + message classification + sanitization
  input.js        command input, history, global focus
  panels/equipment.js  whisper.js  lightview.js  minimap.js
  panels/environment.js  dialogue.js  who.js  forecast.js
```

**Method — one module at a time, lowest-coupling first so the file shrinks monotonically:**
1. Stand up `main.js` as `<script type="module">`; move the existing inline JS into it verbatim first (proves module loading end-to-end before any split).
2. Extract leaf utilities: `shared/dom.js`, `shared/settings.js`, `state.js`. Replace implicit globals with explicit imports/exports as each moves.
3. Extract the panels (each is already a near-self-contained block per the audit): equipment, whisper, lightview, minimap, environment, dialogue, who, forecast.
4. Extract `net.js` and `render.js`.
5. **Convert the 40+-case `handleServerMsg` switch into a dispatch table** in `dispatch.js`: `const handlers = { look: onLook, combat: onCombat, ... }`. Each handler imported from its owning panel/module. Adding a server message type becomes "add one key," not "edit a switch." This is the single highest-leverage change for scale.

**Sanitization (fold in during render extraction, not a separate pass):** `appendHtml()` currently trusts server HTML; loot/whisper/dialogue can carry player-authored strings → stored-XSS risk. In `render.js`, route any field that originates from player input through `shared/dom.js`'s `escapeHtml()`. Keep server-authored markup (zone prose) as-is. This is a real correctness fix, scoped to the module that owns output.

**Acceptance for Phase 1:** `index.html` drops to an HTML skeleton + one `<script type="module" src="js/main.js">`; no JS file over ~250 lines; game plays identically (login, move, combat, loot, equip, whisper, minimap, environment HUD, dialogue, settings persistence).

---

## Phase 2 — Modularize the built-in command dispatcher

`server/engine/commands.js` (1,255 lines) splits into a `server/engine/commands/` directory by domain, mirroring the panel approach:

```
server/engine/commands/
  index.js      builds the builtin registry + handleCommand (keeps fireCommand-first order)
  movement.js   look, go/move, n/s/e/w/u/d, map
  combat.js     attack, loot, steal
  inventory.js  inventory, take, drop, use, equip/unequip(+ById)
  social.js     say, yell, whisper, talk, who
  economy.js    shop, buy, sell, deposit, withdraw, balance, craft, recipes
  housing.js    rent, lock/unlock, pick, sleep, upgrade lock, lightview, curtain
  world.js      examine, switch, stats, skills, help, teleport, obama
```

- Replace the 49-case `switch` with a **builtin command registry** (`Map<alias, handler>`) built by merging each domain module's exported handler map. Aliases (`l`→look, `k`→attack) are map keys.
- **Preserve dispatch order exactly:** plugin `fireCommand` first (commands.js:333), then the builtin registry, then "unknown command." Do not change the sleep-wake interception (commands.js:326).
- Keep the room-renderer helpers (`describeZone`, building-flavor banks at commands.js:24–159) in a `commands/describe.js` or `world.js` module — these are shared by `look`/`move`.
- This makes the builtin surface structurally identical to the plugin surface (both are handler maps), which is the right end-state.

**Acceptance:** every existing command + alias works; new commands are "add a key to a domain module's map."

---

## Phase 3 — Content-authoring & data-layer scale

`seed.js` is currently doing **two unrelated jobs in one file**, and only one of them should survive as-is:
- **Job 1 — fresh-DB bootstrap** (zones/factions/enemies/items/recipes/drugs/mutations/NPCs/furniture/lights/power/admin, all `ON CONFLICT DO NOTHING`). This is legitimate baseline data: needed to stand up a new environment, recover from the documented Supabase "came back empty" failure, and reset dev/test DBs. But it is **frozen reference data, not a growth surface** — new content is authored in the dev panel, not by editing this file.
- **Job 2 — ad-hoc data migrations** (`seed.js:33–88`: deleting the old Embassy zone, the 15-zone "map shrink" with its hand-written FK-safe `DELETE` cascade and player rescue, exit repointing). This is migration logic wearing a seed script's clothes. It accretes forever, re-runs on every seed against every environment, and the FK-safe delete ordering is itself a symptom of the integrity gap in item 3 below.

Steps:

1. **Split Job 1 by entity** into `server/models/seed/{zones,enemies,items,npcs,recipes,...}.js`, each exporting its rows; `seed.js` becomes a thin orchestrator. Removes merge-conflict pain and keeps bootstrap data append-only.
2. **Extract Job 2 into a real migration mechanism** — a `schema_migrations` ledger table + a `migrations/` folder of dated, run-once scripts that record themselves as applied. You already have `migrate.js` + `migrate.environment.js`, so versioned *schema* steps exist conceptually; this extends the same idea to *data* changes (like the map shrink) so each runs exactly once instead of re-executing on every seed forever. Also retires the inline `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` sprinkle (`migrate.js:80–86, 169–175, 198–200`) in favor of recorded steps.
3. **Add the missing foreign keys + `ON DELETE CASCADE`.** Most reference columns are bare `TEXT` with no FK: `player_inventory.player_id/item_id`, `npcs.zone_id`, `zone_spawns.zone_id/enemy_id`, `enemies.faction`. The hand-written multi-table cleanup in the map shrink exists *only because* the DB won't cascade — adding the constraints makes deleting a zone automatically clean up its spawns/NPCs/furniture/apartments, and makes orphaned rows impossible rather than a thing you remember to delete. Do this as a Job-2 migration. (Audit first for existing orphans the constraints would reject.)
4. **Centralize + lightly validate the content JSON-blob schema** — document the JSON keys the engine actually reads on `items.effects/stat_modifiers/flags`, `enemies.loot_table/flags`, `zones.exits/flags` (extend `docs/items.md` to enemies/zones). Add a boot-time validator that *logs, never crashes* on unknown/malformed keys, so authoring mistakes surface early instead of as silent no-ops.
5. **Auto-validate zone connectivity on save** — the `/api/worldvalidator` logic exists but runs ad hoc; fire it on zone create/update so orphaned/one-way exits are caught at author time.

### Backend assessment — is Postgres right, and does the schema scale?

**Postgres is the correct backend; it is not the bottleneck and should not be changed.** The data is genuinely relational (players↔skills/factions/mutations/drug-state are proper composite-key junctions), and the column-for-scalars + JSONB-for-content hybrid is exactly Postgres's strength. A MUD is a low-throughput workload — "10–20× content" is a content-*volume* question, not a concurrency one, and most reads hit the in-memory world cache, not the DB. Postgres is over-provisioned for this game. Switching to Mongo (loses the junctions), SQLite (violates network-first/hosted-multiplayer), or a graph DB (the zone graph is tiny and `exits`-as-JSONB already models it) would all be regressions. Redis is viable later as a *cache/pub-sub* layer, never as the primary store.

The schema is fundamentally sound (normalized, sensible junctions, indexes on hot paths, deliberate boolean-as-INTEGER per the documented `pg` lesson). The real scaling risks live **outside the database choice** and are addressed above (FK/cascade integrity = step 3; migration discipline = step 2). One ceiling is explicitly out of scope here and worth naming: **all world state lives in a single Node process's RAM**, mutated in place and written through — there is no two-instance/shared-state story, so the eventual cap on *concurrent players* (not content) is the server process, not Postgres. Flagging it; not solving it in this plan.

---

## Phase 4 — Dev panel (later phase, same plan)

`client/devpanel/index.html` (3,240 lines, ~40 hand-written form builders) is the worst per-field scaling cost. Two moves, reusing Phase 0–1 output:

1. **Adopt the shared client lib** — point the dev panel at `client/shared/` (auth, settings, dom, ws) and delete its duplicated copies. Modularize its JS the same way as the game client (`client/devpanel/js/`).
2. **Schema-driven entity forms** — replace per-entity `zoneEditForm()`/`itemEditForm()`/… with a single form generator driven by a field-schema object per entity type (`{ name, type, options }[]`). Adding a field becomes a one-line schema edit; adding an entity type becomes one schema object instead of a 60–200-line bespoke builder. The map editor stays bespoke (genuinely custom UI).

**Acceptance:** dev panel feature-identical; adding a field to any entity touches one schema line.

---

## Phase 5+ — Optional build step (future, not committed)

The no-build native-module approach above is the right first move: it removes the monolith with zero tooling and keeps the deploy story simple. But once the client is *already* split into modules, adding a bundler later is cheap and non-disruptive — the module boundaries are the hard part, and Phases 1/4 do that work. Note for the future, to revisit only if real pain shows up:

- **What a build step would buy:** true shared-code bundling without the `/shared/` route hack, minification (fewer round-trips than ~15 unbundled module requests), dead-code elimination, optional TS/JSX, source maps for debugging. `esbuild` is a single dependency and sub-second; `vite` adds hot-reload dev DX.
- **What it costs:** a `package.json` build script, a `dist/` artifact the server serves instead of raw `client/`, and a deploy step — i.e. it crosses the "no build pipeline" line in `CLAUDE.md` deliberately. Worth it only when unbundled request count, the lack of minification, or wanting types becomes a measured problem.
- **Triggers to actually do it:** client module count climbs past ~20–30 files; first-load latency on the unbundled imports becomes noticeable; or a desire for TypeScript on the client. Until one of those bites, native modules win on simplicity.
- **Why it sequences last:** it's purely additive once modules exist. Doing the split first (Phases 1/4) is the prerequisite either way, so there's no rework — a bundler just consumes the modules already produced.

## Critical files

- `client/game/index.html` — split (Phase 1); becomes skeleton + module entry.
- `server/index.js` — `/shared/*` route + static-fallback hardening (Phase 0).
- `server/engine/commands.js` — split into `commands/` (Phase 2).
- `server/models/seed.js` — split into `seed/` (Phase 3).
- `client/devpanel/index.html` — modularize + schema forms (Phase 4).
- `CLAUDE.md`, `docs/plugin-architecture-analysis.md` — rule + status updates (Phase 0).

## Reuse (already present — don't rebuild)

- `plugins.js` command/route registration + `fireHook` request/response — the plugin-side extension points already exist; Phase 2 mirrors their handler-map shape for builtins.
- `server/engine/effects.js` — unified status effects already done; the analysis doc's "extract effects" item is complete.
- `server/index.js` MIME map already serves `.js` as `application/javascript` — native modules load with no server change beyond Phase 0's two edits.

## Verification (per phase — play, don't just read)

- **Run locally:** `node server/index.js` (needs `DATABASE_URL`); open `http://localhost:<port>/` for game, `/dev` for panel.
- **Phase 1:** full play loop — register/login, move between zones, attack an enemy to death, loot, equip/unequip, open whisper + send, minimap renders, environment HUD ticks, an NPC dialogue, change theme/font/density and reload (persists). Watch the browser console for module/import errors (Phase 0's fallback fix makes these loud).
- **Phase 2:** exercise one command from each domain module + a couple of aliases (`l`, `k`, `i`); confirm a plugin-registered command still shadows builtins; confirm unknown-command text unchanged.
- **Phase 3:** run the bootstrap seed against a fresh DB and confirm identical row counts; run migrations twice and confirm the second run is a no-op (ledger prevents re-execution); delete a test zone and confirm its spawns/NPCs/furniture/apartment cascade away with no hand-written cleanup; trigger the boot validator with a deliberately malformed item flag and confirm it logs without crashing.
- **Phase 4:** edit one of each entity type via the panel, publish, confirm it appears in-game; add a throwaway field to one schema and confirm the form renders it.
- **Regression guard each phase:** diff player-visible behavior against `main` before the phase — a behavior-preserving refactor should show none.
