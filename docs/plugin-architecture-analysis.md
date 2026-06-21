# Plugin Architecture Analysis

> **STATUS NOTE (2026-06-21):** This document is superseded in part. The "Phase 1" items it recommended — command registration (`registerCommand`/`fireCommand`), route registration (`registerRoutes`/`fireRoutes`), and a unified `effects.js` — are **already implemented**. See `plugins.js` and `server/engine/effects.js`. The ongoing client/content restructuring work is tracked in `docs/future_proofing.md` instead. This document remains accurate for its architecture survey but its roadmap is stale.

---

**Scope:** Architecture review of `architect-mud` to identify which systems can move out of the engine core and into the existing file-drop plugin framework (`server/engine/plugins.js`).

**Method:** Read every engine/model/api module currently in the repo (`server/engine/*.js`, `server/models/*.js`, `server/api/*.js`), the existing plugin loader and its one reference plugin (`plugins/example-weather/`), and the project's own `docs/architecture.md` / `docs/design.md`. This document reflects that code as of this pass. Two caveats worth stating up front: first, several files (`environment.js`, `commands.js`, `routes.js`, `seed.js`, devpanel/client HTML, the migration files) were modified extensively in this same session and are current; the rest (`world.js`, `combat.js`, `skills.js`, `crafting.js`, `factions.js`, `vendor.js`, `apartments.js`, `drugs.js`, `mutations.js`, `gameLoop.js`, `plugins.js`, `db.js`) were read from a reference copy and assumed unedited outside this conversation — worth a quick diff against the live repo before acting on this. Second, `docs/architecture.md` and `docs/design.md` are themselves now stale in places (they predate the power/lighting/weather system and the map-shrink work) and should get a refresh pass independent of this document.

---

## 1. Current Architecture Overview

### Shape of the system

The engine is a single Node process: one HTTP server, one WebSocket server, one Postgres pool, no workers, no queues. `server/index.js` boots everything in a fixed sequence (`initWorld → loadRecipes → loadDrugs → loadMutations → loadPlugins → initEnvironment → startGameLoop`) and the rest of the engine is a flat set of ES modules under `server/engine/` that import each other directly and share two pieces of global mutable state:

- **`world` (`world.js`)** — the in-memory cache of zones/players/enemies/npcs/corpses/spawn timers/apartments. Almost every gameplay module reads or writes this directly (`world.zones.get(id).players`, etc.), not through an abstraction.
- **`state` (`environment.js`)** — a second, parallel in-memory cache (time/weather/power/lighting), populated and refreshed independently of `world`.

Two **independent tick schedulers** exist side by side: `gameLoop.js` runs five of its own `setInterval`s (1s combat/status, 45s ambient, 60s minute, 60s resource, 10s spawn, 30s corpse-cleanup), and `environment.js` runs two more of its own (30-minute, 24-hour). Nothing coordinates them; they just happen to both call `query()` against the same pool. This works today because the process is small, but it's the single biggest piece of accidental complexity in the codebase — see §4.

**Plugin system status: real, but underused.** `plugins.js` is a working file-drop loader (manifest + `index.js` exporting a `hooks` object, scanned once at boot, hook names declared in `plugin.json`). It is wired into both tick systems already — `gameLoop.js` fires `tick.minute`, `zone.describeAmbient`, `player.death`; `environment.js` fires its own five `environment.*` hooks through the same `fireHook` — and `fireHook`'s "last non-undefined return wins" design means a hook call can also be used as a request/response mechanism, not just fire-and-forget notification (this matters for §4 and for the validator built alongside this document). Despite that, exactly one plugin exists (`example-weather`), and — notably — **the gameplay system it demonstrates (weather) was later built for real directly into the engine core** (`environment.js`) instead of as a plugin. That's a concrete, present-tense example of the coupling problem this analysis is meant to catch happening again.

### Coupling that doesn't need to be there

- **`commands.js` imports nine other engine modules directly** (`world`, `combat`, `skills`, `crafting`, `mutations`, `factions`, `vendor`, `apartments`, `drugs`, `environment`) and is the single largest file in the engine (~60K). It is the de facto command dispatcher *and* the room-description renderer *and* the integration point for every gameplay system. Every new gameplay system that wants a command or wants to inject text into `describeZone()` currently means editing this file.
- **Status effects live inside `combat.js`** (`tickStatuses`), not as their own system, despite being a named candidate system in their own right and despite `drugs.js` and `mutations.js` independently apply their own stat-effect logic with no shared "effect" abstraction between the three.
- **`apartments.js` reaches directly into `world.js`'s cache** (`getApartment`/`setApartmentCache`) rather than going through a generic "zone metadata" extension point — there's no reason a property/housing system needs hand-written cache functions in the entity-cache module itself.
- **Dead code**: a legacy `api/routes.js` exists at the repo root (pre-dates the current `server/api/routes.js`, imports a `getDb()` that no longer exists in `migrate.js`). It isn't imported by `server/index.js` and should simply be deleted — flagging it here since "favor an event-driven approach" analyses tend to skip dead-code findings, but this one actively misleads anyone reading the tree.
- **Two parallel "is this content cached in memory" patterns** exist with no shared interface: `world.js` hand-rolls zone/NPC/apartment caching; `crafting.js`, `drugs.js`, `mutations.js` each hand-roll their own `let CACHE = {}` + `loadX()` + `getXCache()` triplet, independently, with identical shape. This is exactly the kind of repeated pattern a small core "data-driven asset registration" service (see §4) would collapse into one implementation.

### What's *not* a coupling problem

Most of the DB layer is genuinely clean: every module takes `query` from `models/db.js` and nothing else touches Postgres directly outside `models/`. There's no ORM to fight, no class hierarchy to untangle, no circular imports found. The ceiling on "how plugin-able is this" is set by direct-import coupling between gameplay modules, not by the data layer.

---

## 2. Plugin Candidate Matrix

Effort estimates are rough order-of-magnitude for a solo developer, assuming the API additions in §4 exist first. "Migration difficulty" is about *risk of breaking live behavior*, not raw line count.

| Module | Current location | Dependencies | Plugin suitability | Recommended architecture | Required engine API additions | Migration difficulty | Effort | Maintenance benefit |
|---|---|---|---|---|---|---|---|---|
| **Time & calendar** | `environment.js` (core) | `db.js`, `plugins.js` (emits hooks) | Engine service + plugin | Keep the clock itself (`world_clock`, tick scheduling) in core — it's load-bearing for everything else on this list. Already emits good hooks. | None — already exposes `environment.tick30m/24h`, `getHUDPayload()` | N/A (stays) | — | — |
| **Weather** | `environment.js` (core) | Time/calendar, `db.js` | **Full plugin** (ironically already proven possible — see `example-weather`) | Extract weather generation/forecast entirely into a plugin subscribed to `environment.tick24h`; core keeps only `weatherType`/`tempC` as a value other systems can read via a small accessor | `engine.getWeather()` read accessor so power/visibility plugins don't need to import the weather plugin directly | Medium — `simulatePowerNetwork`'s `SNOW_LOAD_MULTIPLIER` and visibility's `WEATHER_VISIBILITY_FACTOR`/`FOG_FACTOR` currently read `state.weatherType` directly and need to switch to the accessor | 1–2 days | High — this is the system that's *already* duplicated (real impl in core, stale example in plugins/); collapsing to one removes the confusion entirely |
| **Environmental simulation** (ambient light, ticks) | `environment.js` (core) | Time/calendar | Stays core (thin) | Keep `ambientLightForMinutes`/phase calculation in core as a tick-timing primitive; everything that *reacts* to it (lighting, visibility, power) becomes a plugin subscriber | Tick-with-payload hooks already exist | N/A (stays, but shrinks) | — | — |
| **Lighting** | `environment.js` + `furniture` table + `commands.js` (`describeLightLevel`, the `switch` command) | Power grid, environmental sim, `commands.js`, `db.js` | Split — engine service + plugin | `computeArtificialLight`/`lighting_states` table access can move to a plugin; `describeLightLevel` and the `switch` command logic in `commands.js` are command-registration candidates (see §4) rather than core | Command registration hook, `zone.describeAmbient`-style room-text injection (already exists) | Medium-high — `commands.js`'s `describeZone` calls `getZoneVisibility` inline; needs the room-text injection point formalized first | 2–3 days | Medium — mostly untangles `commands.js`, doesn't reduce runtime work |
| **Visibility** | `environment.js` (core) | Lighting, weather | Plugin | `getZoneVisibility`/`describeVisibilityTransition` are pure functions of state already cached elsewhere — good plugin candidate once weather/lighting are also plugins | Read accessors for weather + power status | Low — already isolated, few callers (`commands.js`, one line) | 0.5 day | Low-medium |
| **Power grid** | `environment.js` (core) + `routes.js`/`environment.routes.js` (admin endpoints) | Generators table, time/calendar | Split — small core service + plugin | The simulation math (`simulatePowerNetwork`, `installGenerator`'s building-network BFS) is self-contained and could be a plugin reacting to `environment.tick24h` plus a new on-demand hook for installs; the HTTP routes that expose it stay in core (networking is core's job) per the project's own stated boundary | On-demand hook-with-return-value pattern (already works via `fireHook`'s last-non-undefined-wins — proven in this session's zone-validator addition, see companion deliverable) | Medium — `getZonePowerStatus`/`recomputePower` are called synchronously from `commands.js`'s `switch` command; a plugin needs a stable accessor, not a direct import | 2–3 days | Medium |
| **Sound propagation** | Doesn't exist yet | — | Plugin from day one | No retrofit needed | Needs: a `zone.describeAmbient`-style hook (already exists) plus a "zone adjacency" read accessor (already exists via `getZone().exits`) | N/A | 2–4 days greenfield | High — exactly the kind of system the "Future gameplay systems" goal is for |
| **NPC behaviors** | `world.js` (cache) + `gameLoop.js` (no NPC AI tick exists yet — only enemy AI) | `world.js` | Plugin (once a tick hook exists for it) | NPCs are currently static (dialogue tree + vendor inventory, no movement/behavior loop). Any future NPC AI tick should be plugin-owned from the start, subscribing to a new `tick.npc` hook rather than getting added to `gameLoop.js`'s `tick()` | New `tick.npc` hook (or reuse `tick.minute` if cadence is coarse enough) | N/A (greenfield) | 3–5 days | High |
| **AI systems (enemy combat AI)** | `gameLoop.js`'s `tick()` (core) | `combat.js`, `world.js` | **Stays core** | This is the 1-second latency-critical loop (target acquisition, attack timing, first-strike delay). Moving it to a plugin adds an `await fireHook` per enemy per second for no benefit — this is exactly the "latency-critical, keep in core" case the brief asks to identify | None | N/A (stays) | — | — |
| **Combat mechanics** | `combat.js` (core) | `world.js` | **Stays core** (mostly) | `rollAttack`/cooldowns are latency-critical and called from the 1s tick. The *loot table resolution* (`resolveEnemyLoot`) is pure and could be a plugin hook (`combat.resolveLoot`) without touching the hot path | Optional `combat.resolveLoot` hook for moddable loot tables | Low for the extraction, since it's already a pure function | 0.5 day for the loot-hook extraction only | Low-medium |
| **Skills & progression** | `skills.js` (core) | `db.js` | Split | The rank/XP curve and `skillCheck()` are used by nearly everything (combat, crafting, apartments/lockpicking) — keep as a thin core *service* (it's closer to a math utility than gameplay content). The *skill definitions themselves* (`SKILLS` object — names, categories, stat mapping) are data and could be plugin/data-registered | Data-driven asset registration (new skill defs without editing `skills.js`) | Medium — `SKILLS` is imported by name (`stat_str` etc.) in several places | 1–2 days | Medium — mainly useful once non-core content packs want to add skills |
| **Status effects** | Inside `combat.js` (`tickStatuses`) — *not* its own module today | `combat.js` only | **Extract to its own plugin first, then evaluate** | This is the clearest "should not be where it is" finding in the whole pass — it's named as a candidate system but doesn't even have a file. Pull it out to `effects.js` and register `bleeding`/`burning`/`irradiated` as data, so drugs/mutations effects (currently separate, ad hoc) and combat statuses share one applicator instead of three | A generic `player.applyEffect(name, duration)` API + one shared tick hook | Medium — touches `combat.js`, `drugs.js`, and `mutations.js`'s independent effect-application code | 2–3 days | High — removes three parallel, slightly-inconsistent effect systems |
| **Inventory extensions** | Spread across `commands.js`/`vendor.js`/`crafting.js` (no dedicated `inventory.js`) | `db.js` | Plugin-friendly once consolidated | No single inventory module exists yet — `player_inventory` is queried directly from several files. Worth consolidating into an `inventory.js` core service (CRUD + stacking rules) before anything plugs into it | `inventory.onAdd`/`onRemove` hooks | Medium | 2 days to consolidate, then incremental | Medium |
| **Crafting** | `crafting.js` (core) | `skills.js`, `db.js` | Split | Recipe *definitions* are already DB-driven and dev-panel editable (good); the *resolution algorithm* (margin → quality tier, critical chance) is a reasonable core service since other systems may want to call into it later (e.g., a future "field repair" or "scavenging" action), but could equally be a plugin reacting to a `command.craft` hook | Command registration (see §4) | Low — already well-isolated behind `attemptCraft()` | 1 day | Medium |
| **Factions** | `factions.js` (core) | `db.js` | Plugin | Rep tiers/discounts are pure, self-contained, and only consumed by `vendor.js` and `commands.js`'s faction display. Good extraction candidate. | Read accessor `engine.getFactionRep(playerId, factionId)` for vendor.js to depend on instead of importing factions.js directly | Low | 1 day | Medium |
| **Economy** (credits, banking, theft) | Spread across `commands.js`/`vendor.js`, no dedicated module | `db.js` | Plugin-friendly once consolidated | Same shape as inventory — no `economy.js` exists; credits are mutated ad hoc (`player.credits -= cost`) in at least five files. Consolidate first | `player.adjustCredits(delta, reason)` API so every system stops hand-rolling the same three lines | Medium | 1–2 days to consolidate | High — this is a real correctness risk today, not just a style issue: nothing currently centralizes "don't let credits go negative" |
| **World events** | `world_events` table exists in schema; no code reads/writes it found in the engine modules reviewed | — | Plugin | Table is provisioned but unused — greenfield, build as plugin from the start | `world.broadcastEvent()` accessor (broadcast fn already exists, just needs exposing) | N/A | 1–3 days | High |
| **Quest systems** | Doesn't exist (confirmed absent in both code and `docs/architecture.md`'s own "Not built" list) | — | Plugin from day one | No retrofit risk since there's nothing to migrate | Needs: entity lifecycle hooks (`player.create`), save/load hooks, dialogue-tree hook into `apartments`-style NPC dialogue, world-state read access | N/A | Large (this is genuinely a new system, not a refactor) | Highest — getting the hooks right *before* a quest system exists avoids ever coupling it to `commands.js` the way every other system did |
| **Vehicles** | Doesn't exist | — | Plugin from day one | — | Needs a "zone container" concept (an entity that holds players, not a zone) — currently not modeled at all | N/A | Large | High |
| **Mutations** | `mutations.js` (core) | `db.js` | Plugin | Self-contained, DB-cached like crafting/drugs, only touches player stats through a generic update path. One of the cleanest extraction candidates in the codebase as-is. | Same effect-application API as Status Effects, above | Low | 1 day | Medium |
| **Cybernetics** | Doesn't exist (mentioned in candidate list, not in design.md) | — | Plugin from day one | Likely shares structure with Mutations (permanent stat-modifying installs) — could literally share the effect-application API once that exists | Same as Mutations | N/A | Medium (once mutations' API exists, this is mostly data) | Medium |
| **Developer tools** | `routes.js`/`environment.routes.js` (core, HTTP) + `client/devpanel/` | `db.js`, `world.js` | **Stays core** (the HTTP surface) but **individual panels should be plugin-registered** | Networking/auth is correctly core. But every new dev-panel feature today means hand-editing `routes.js`'s route list and `devpanel.html`'s `PANELS` object — there's no "register a dev-panel tab" extension point, so every plugin that wants a dev tool has to ask the maintainer to wire it into core by hand | UI registration + command registration (see §4) — this is the single highest-leverage API addition for *this specific codebase*, since dev-panel growth is constant and currently 100%-core-coupled | N/A for what exists; new work should target the new API once built | Ongoing | High — directly reduces the "every feature touches routes.js + devpanel.html" pattern visible throughout this session's own work |
| **Admin tools** | Same as Developer tools | Same | Same | Same | Same | Same | — | Same |
| **Scripting systems** | Doesn't exist | — | N/A yet | If ever built, should be the plugin loader's own self-hosting case — a "plugin that lets non-JS scripts register hooks" | Sandboxed hook-registration API | N/A | Large, speculative | — |
| **UI extensions** | `devpanel.html` (`PANELS` object) | — | Needs new extension point | See Developer Tools above and §4's "UI registration" | UI registration | N/A (greenfield API) | — | — |
| **Procedural generation** | Doesn't exist (zones are 100% hand-authored in `seed.js`) | — | Plugin from day one | — | World-generation hooks (new), zone-creation API (`apiCreateZone` already exists and is reusable) | N/A | Large | High |
| **Future gameplay systems** | — | — | Plugin by default | Default stance per the design goals: anything new is a plugin unless it's provably latency-critical (the AI-tick/combat-roll bar set above) | — | — | — | — |

---

## 3. Core Engine Responsibilities

What stays, and why each one fails the "could this be a plugin" test:

| Stays in core | Why |
|---|---|
| **Networking** (`index.js` HTTP+WS, `api/routes.js` dispatch) | Every plugin's surface area to the outside world goes through this; it can't depend on the thing it's hosting. |
| **ECS/entity management** (`world.js`'s zone/player/enemy/NPC cache) | Read by every other module in the engine; this *is* the shared substrate plugins extend, not something that sits on top of it. |
| **Database layer** (`models/db.js`) | Single connection pool; correctly the one place that touches `pg` directly already. |
| **Serialization** | Implicit today (`JSON.stringify` at insert time) — fine to leave implicit rather than build a formal layer for a schema this size. |
| **Resource management** (`pool` lifecycle, `pool.on('error')`) | Process-lifetime concern. |
| **Plugin loader** (`plugins.js`) | Can't be a plugin of itself. |
| **Event bus** (`fireHook`/`hooks` Map inside `plugins.js`) | Same module as the loader; already correctly placed. |
| **Configuration** (`.env` / `dotenv`) | Process-boot concern, needed before any plugin code runs. |
| **Authentication** (`verifyToken`/JWT handling in `routes.js`+`index.js`) | Security boundary — should not be something a dropped-in plugin folder can bypass or redefine. |
| **Logging** | Currently `console.log`/`console.error` scattered through every module — not actually centralized today despite being a "core" concern; worth a real logger module (see §5 quick wins) even though it doesn't change plugin boundaries. |
| **Scheduling / tick management** | The mechanism needs to be core (see §4's proposed unification) even though most of what runs *on* the ticks should not be. |
| **The 1-second combat/AI loop specifically** | Performance-justified core exception — every enemy, every tick, an `await fireHook` round-trip is real overhead for zero current benefit. Re-evaluate only if/when AI needs to be moddable per-enemy-type. |

Everything else in the candidate list is challenged in §2 above; nothing else met the bar for "compelling architectural reason to stay."

---

## 4. Required Plugin API Improvements

In rough priority order — these are the gaps that block the §2 recommendations from actually being doable, not a wish list:

1. **Command registration.** Today, adding a player-typed command means adding a `case` to the giant `switch` in `commands.js`'s dispatcher and a new function in the same file. There's no `registerCommand(name, handler)` a plugin can call. This is the single biggest blocker to making Crafting/Status Effects/Power/Lighting genuinely plugin-owned, since several of them need their own commands (`craft`, `switch`, etc.). **Proposed:** `plugins.js` gains a `commands` registry alongside `hooks`; `plugin.json` gains an optional `commands: ["switch", "flip"]` array; the dispatcher tries the registry before falling through to its built-in `switch` statement.

2. **On-demand hooks with return values (already usable today — confirm and document it).** `fireHook`'s "last non-undefined return wins" behavior already supports request/response, not just notification — this session used exactly that pattern to let a dev-panel button trigger a plugin and get a report back, with zero changes to `plugins.js` itself. This isn't a gap so much as an *undocumented capability* — `docs/architecture.md`'s Plugin System section should be updated to show this pattern explicitly, since it's the difference between "plugins can only react to things" and "plugins can also be called into," and right now nothing in the docs tells a future contributor that's possible.

3. **UI registration (dev panel).** No mechanism exists for a plugin to add a nav tab, a panel, or a subsection of an existing panel (e.g., the Zone Editor's per-zone subsections). Every dev-panel feature built this session — Rooms/NPCs/Furniture/Generator/Apartment-Details sub-sections, the Power tab, the Big Map — required hand-editing `devpanel.html`'s `PANELS` object and `zoneEditForm()` directly. **Proposed:** a small client-side registry (`registerDevPanelTab({id, title, render})` and `registerZoneEditSection({test(zone), render(zone)})`) that core's `devpanel.html` reads from, with plugin-contributed JS files served alongside the core bundle.

4. **Network packet / route registration.** Currently every new REST surface means adding `if (path === ...)` to `routes.js` directly (see `environment.routes.js` for the *cleanest* existing version of this pattern — a separate dispatcher file, mounted with one line in the core router). **Proposed:** formalize that pattern into a real API: `registerRoutes(prefix, handler)` that core's `handleApiRequest` consults, so a plugin ships its own `*.routes.js` without a core edit at all — `environment.routes.js`'s shape is already 90% of the way there, it just isn't generic yet.

5. **Tick hooks at more granularities.** `tick.minute` exists; nothing exists between 1 second (hardcoded combat loop) and 60 seconds (`tick.minute`/resource tick) except the two new 30-minute/24-hour environment ticks, which aren't exposed as generically-named hooks the way `tick.minute` is (they're `environment.tick30m`/`environment.tick24h` specifically, which is fine, but a generic `tick.30m`/`tick.24h` alias would let non-environment plugins subscribe without caring that environment.js happens to be the thing that currently owns that cadence). **Proposed:** unify all `setInterval` calls behind one scheduler in `plugins.js` or a new `scheduler.js`, with named cadences (`'1s'`, `'1m'`, `'30m'`, `'24h'`) plugins request by string instead of each subsystem managing its own `setInterval`.

6. **Entity lifecycle hooks.** `player.enterZone` and `player.death` exist; `player.create` (registration), `player.login`, `player.logout`, `zone.create`, `zone.update`, `zone.delete` do not. These are needed for Quest systems, World events, and the "auto-run validation after map edits" feature requested alongside this analysis — right now a plugin has no way to know a zone was just edited except polling.

7. **World generation hooks.** Needed for Procedural Generation specifically — `worldgen.beforeZoneCreate`/`worldgen.afterZoneCreate` so a plugin can intercept or react to programmatic zone creation, as opposed to the dev-panel-driven single-zone creation that exists today.

8. **Save/load hooks.** No formal save/load *event* exists today — persistence happens inline, per-field, at the point of mutation (`UPDATE players SET hp=$1 ...`). This is fine for the current scale but means a plugin can't hook "a player's data was just persisted" without polling. Lower priority than the above; flagging for completeness since it's in the requested checklist, not because anything currently needs it.

9. **Configuration registration.** Plugins currently have no declared-and-validated config surface — `example-weather` hardcodes its weights in JS. A `plugin.json` `"config"` schema (read once at load, validated, exposed to the plugin's `index.js`) would let dev-panel-editable plugin settings exist without each plugin inventing its own DB table.

10. **Data-driven asset registration.** The repeated `let CACHE = {}` / `loadX()` / `getXCache()` pattern in `crafting.js`/`drugs.js`/`mutations.js` (and the proposed Skills extraction) should collapse into one generic `registerAssetType(tableName, cacheKey)` the engine exposes, so a plugin adding a new data-driven content type (e.g., Cybernetics) gets caching "for free" instead of copy-pasting the triplet a fourth time.

---

## 5. Migration Roadmap

### Phase 0 — Quick wins (hours, not days; no behavior change)
- Delete the dead root-level `api/routes.js`.
- Document the "hook return value = request/response" pattern in `docs/architecture.md`'s Plugin System section (item 2 above) — zero code, pure documentation, unblocks future plugin authors immediately.
- Refresh `docs/architecture.md`'s "Repository Structure" and `docs/design.md`'s "Map Shape" sections — both are now inaccurate (predate the power/lighting system and the map shrink respectively). Not a plugin-architecture task per se, but anyone using this analysis as onboarding material will hit stale docs immediately otherwise.

### Phase 1 — Foundational API work (the prerequisites everything else needs)
1. Command registration (§4.1)
2. Route registration, generalized from `environment.routes.js`'s existing shape (§4.4)
3. Unified scheduler (§4.5) — this one is riskier than it sounds (touches every `setInterval` in `gameLoop.js` and `environment.js`) so budget real testing time, not just implementation time
4. Entity lifecycle hooks for zone create/update/delete (§4.6) — small, and unblocks the "auto-run validation after map edits" feature requested alongside this analysis

### Phase 2 — Medium-complexity extractions (clean, self-contained, low risk)
- Factions → plugin
- Mutations → plugin
- Visibility → plugin (after Lighting/Power, since it reads both)
- Status Effects → new `effects.js`, then plugin (touches three existing files, but each touch point is small)
- Weather → plugin (retire `example-weather`, replace with the real implementation moved out of `environment.js`)

### Phase 3 — Larger/riskier extractions
- Power grid (HTTP routes stay core per §3; simulation logic moves)
- Lighting (depends on Power + the command-registration API existing first, for `switch`)
- Crafting (low technical risk, but touches a system players actively use — test thoroughly)
- Inventory/Economy consolidation *before* their eventual plugin extraction — these aren't plugin-ready yet because they don't exist as single modules to extract

### Phase 4 — Greenfield, plugin-first from day one
- Sound propagation, NPC behaviors/AI, Quest systems, Vehicles, Cybernetics, World events, Procedural generation, Scripting systems

None of these have legacy code to migrate, so the "migration difficulty" column in §2 doesn't really apply — the only risk here is *not* building them as plugins out of habit, the way Weather was.

### Stays in the engine, permanently (no migration planned)
- Networking, entity cache (`world.js`), DB layer, plugin loader/event bus, auth, the 1-second combat/AI tick, scheduling mechanism itself (as opposed to what runs on it)

---

## Summary

The plugin system works and is already proven (it's load-bearing for the environment system's hook emission today, whether or not anyone's written a third-party plugin against it yet). The gap isn't capability, it's **discoverability and a handful of missing extension points** — specifically command registration and UI registration. Every gameplay system built this session (apartments-as-rooms, the power grid, the dev-panel Power tab, the zone validator built alongside this document) hit the same wall: there was no way to add a command or a dev-panel section without editing a core file by hand, so it got added to the core file by hand. Building the Phase 1 APIs first, before doing any of the Phase 2/3 extractions, is what actually changes that pattern going forward — extracting Factions or Mutations into plugins today, without those APIs, would just move the code without removing the coupling.
