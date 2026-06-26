# Architect MUD — Architecture Rework: Phased Implementation Plan

## Context

The rework doc (`C:\Users\johna\Downloads\Architect_MUD_Architecture_Rework.md`) proposes a
server-authoritative, plugin-driven, event-driven, data-driven (tag/component) architecture for
better scalability and richer system interactions.

**Key finding:** ~half the doc already exists (plugin domains, `registerCommand`/`registerRoutes`,
item tags via `tagCatalog.js`/`hasTag`/`tagValue`, unified `scheduler.js`, server authority). So
this is **not a greenfield rewrite**. Per grilling, the approach is **Hybrid: build the new core
abstractions fresh and complete, then port existing domains onto them gradually** — keeping the game
playable throughout. This plan *subsumes and extends* the live roadmap in
`docs/plugin-architecture-analysis.md` §6 (economy/inventory consolidation, player lifecycle hooks,
lighting/crafting/drugs extraction).

## Decisions Locked (via /grill-with-docs)

1. **Framing** — Hybrid: new core fresh, gradual domain port.
2. **Action layer** — An **Action** is the *canonical state-mutation path*: `{type, actor, params, context}`,
   validated + routed by the Action Dispatcher, emitting events on success. **Commands** are one
   *source* of Actions (dialogue, scripts, NPC AI are others). Commands-that-mutate become thin
   parsers → dispatch an Action. Read-only commands (`look`, `map`, inventory display) stay plain handlers.
3. **Messaging** — Two distinct mechanisms: **Hooks** (`fireHook`, keep as-is) = request/response
   ("give me a value / transform this"); **Events** (new `emit`/`on`) = fire-and-forget ("this happened",
   past-tense names, errors isolated, order-independent). Existing notification-hooks (`tick.minute`,
   `player.death`, `zone.*`) migrate to events during the port.
4. **Object model** — Unify the tag *mechanism* (catalog + `hasTag`/`tagValue` + tag→Action registration)
   across all entities, folding `flags` into the tag system. Furniture + doors become tag-driven
   interactables. **Keep** `body_parts`/`dialogue_tree`/`loot_table`/`exits` as typed columns — tags are
   behavior markers, not a dumping ground.
5. **Specialized actions** — Verb-first dispatch over a tag-gated registry: plugin registers
   `{verb, requiredTag, handler}`; dispatcher resolves target → checks tag → routes. Same registry read
   in reverse yields "available actions" for an object (clickable UI + `examine` hints). Generic verbs
   core & always-on; specialized verbs tag-gated.
6. **Scripts** — Build the visual node editor **and** runtime together as one major phase (sequenced
   after the Action layer + flag store). Scripts call Actions only — never touch state directly.
7. **Quests / graph engine** — Build shared primitives (flag store, lifecycle hooks, events,
   `EXECUTE_SCRIPT`) + **one shared graph engine** for dialogue *and* scripts into core now. Ship the
   actual **Quest plugin as a fast-follow**; quest dialogue-actions stubbed until then.
8. **Plugin standards** — Adopt richer `plugin.json` (declared actions/events/config/schema) + per-plugin
   README + auto-doc generation now. **Defer** plugin client modules / UI-registration; build the new
   editors into the existing monolithic `devpanel.html` for this rework.

## Terminology (→ seed `CONTEXT.md` in Phase 0)

- **Command** — raw player text; one *source* of intent, parsed into an Action.
- **Action** — server-validated, structured intent that *mutates state*; the single canonical mutation
  path. Generic (core) or specialized (tag-gated, plugin-registered).
- **Source** — anything that produces Actions: command parser, dialogue node, script step, NPC AI.
- **Hook** — request/response extension point (`fireHook`); caller uses the return value.
- **Event** — fire-and-forget notification (`emit`/`on`); past-tense; subscribers react, no return used.
- **Tag** — catalog-defined marker (optionally data-bearing) on an entity; plugins register behavior/Actions for it.
- **Script** — a reusable graph asset of steps that call Actions; runtime-executed; visually authored.
- **Flag** — persisted key/value state (player- or world-scoped) read by conditions in dialogue/scripts/quests.

---

## Phased Implementation

> Every phase ships independently and leaves the game playable. Each domain port runs **behind a stable
> dispatcher with the old handler as fallback** until ported — no big-bang cutover.

### Phase 0 — Foundations & docs (no behavior change)
- Create `CONTEXT.md` (glossary above) and `docs/adr/`:
  - ADR-0001 Action as canonical mutation path
  - ADR-0002 Events vs Hooks (two mechanisms, the rule)
  - ADR-0003 Tag-mechanism unification (keep typed columns)
  - ADR-0004 Shared graph engine for dialogue + scripts
- Define the richer `plugin.json` schema (actions, events emitted/consumed, tick usage, deps, config,
  data schema, extension points) + per-plugin `README.md` standard + a doc-gen convention.
- Verify/delete any dead `api/routes.js` per prior analysis §1.

### Phase 1 — Core spine: Event Bus + Action Dispatcher
- `server/engine/events.js` — `emit(name, payload)` / `on(name, handler)`, error-isolated fan-out.
- `server/engine/actions.js` — `registerAction({type, requiredTag?, validate?, handler})` and
  `dispatchAction({type, actor, params, context})` → validate → handler → `emit` resulting events.
  Define the generic action set: `TAKE DROP GIVE EQUIP UNEQUIP MOVE EXAMINE`.
- Wire `server/engine/commands/index.js`: mutating builtins parse → `dispatchAction`; read-only stay.
- Migrate notification hooks (`tick.minute`, `player.death`, `zone.create/update/delete`) to events;
  keep request/response hooks (`zone.describeRoom`, `worldValidator.*`) as hooks.
- Emit player lifecycle events (`player.created/login/logout`) from auth/registration paths in
  `server/index.js` / `server/api/routes.js`.

### Phase 2 — Consolidate mutation services (clean Actions need single owners)
- `server/engine/inventory.js` — CRUD + stacking; consolidate scattered `player_inventory` queries.
- `server/engine/economy.js` — `adjustCredits(player, delta, reason)` with a non-negative guard
  (fixes a real correctness risk; credits mutated ad hoc in ~5 files today).
- Port generic Actions onto these services; each emits events (`inventory.changed`, `item.given`, …).
- Representative files: `server/engine/commands/inventory.js`, `economy.js`, `vendor.js`.

### Phase 3 — Tag-mechanism unification + tag→Action registry
- Extend `server/engine/tags.js` + `client/shared/tagCatalog.js` to enemies/NPCs/furniture/zones;
  read `flags` as tags for back-compat.
- Make **furniture + doors** tag-driven interactables.
- Build the verb-first, tag-gated specialized-action registry + reverse "available actions" lookup
  (replaces the ad-hoc `open` container/door pre-intercepts in `commands/index.js`).
- Port specialized actions to plugins: **Food** (`edible→Eat`), **Container** (`container→Open/Put/Take`),
  **Lock** (`lockable→Lock/Unlock`), **Weapon** (`weapon→Attack`, player path only), **Drugs** (`drug→Use/Inject`).
- Continue prior roadmap as plugin-owned actions: lighting `switch`, `craft`.
- Player `ATTACK` becomes an Action dispatched from `cmdAttack`; **enemy attacks stay in the raw 1-second
  tick** (`gameLoop.js`) — latency-critical, never routed through the dispatcher.

### Phase 4 — Flag store + shared graph engine + visual editor
- Flag store: `player_flags` / `world_flags` key-value tables; `SET_FLAG`/`CLEAR_FLAG` Actions; condition eval.
- Shared graph runtime (`server/engine/graph.js`): node types for dialogue (`say`, `option`) and scripts
  (`action`, `branch`, `wait`, `setflag`, `condition`); `EXECUTE_SCRIPT` Action. Scripts call Actions only.
- Expand dialogue node actions → Actions: `Give/Remove Item`, `Teleport`, `Open Bank/Storage/Crafting`
  (client-directed "open UI" Action), `Trigger Event` (`emit`), `Set/Clear Flag`, `Execute Script`.
- Visual node editor built into `client/devpanel/index.html`, editing the shared JSON graph format;
  powers both dialogue and scripts. JSON remains hand-authorable in the interim.

### Phase 5 — Quest plugin (fast-follow)
- `quests` / `player_quests` tables; `START_QUEST`/`ADVANCE`/`COMPLETE`/`TURN_IN` Actions.
- Objective tracking by **subscribing to events** (`item.given`, `enemy.killed`, `zone.entered`) — the
  give/kill/move code never references quests. Un-stub the quest dialogue-actions.

### Opportunistic (fold in where a phase already touches the code)
- Unify drug/mutation/combat status effects through `effects.js` `applyEffect` as an event/Action consumer
  (closes the three-parallel-effect-systems gap noted in `plugin-architecture-analysis.md` §6).

---

## Concerns & Mitigations (voiced per the ask)

- **Biggest mechanical cost is porting every mutating command to Actions.** Mitigate by porting
  domain-by-domain behind a stable dispatcher, old handler as fallback until each verb is ported.
- **Visual graph editor is the riskiest single client build.** Mitigate by making it edit the *exact JSON
  the runtime already runs*, so hand-authoring works before the editor is polished (as `dialogue_tree` is today).
- **Scope is large.** Mitigate by strict phase independence — each phase is shippable and playable; we can
  stop after any phase with a coherent system.
- **Event/Action layering must not leak into the 1s combat tick.** Keep enemy AI + per-tick combat raw;
  only player-initiated combat becomes an Action.

## Verification

No automated test harness exists (only `docs/temp/qa-audit-2026-06.md`). Per phase, verify by running the
server (`npm run db:migrate && npm run db:seed && npm run dev`), connecting a test character at
`localhost:3000`, and the dev panel at `localhost:3000/dev`, then smoke-testing:
- **P1:** a ported mutating command (e.g. `drop`) still works *and* fires an observable event subscriber.
- **P2:** take/drop/give/equip across players; credits cannot go negative.
- **P3:** `eat`/`open chest`/`lock`/`attack` resolve via tag-gated registry; `examine` lists available actions.
- **P4:** a dialogue node that gives an item + sets a flag; a script invoked from dialogue that branches on it.
- **P5:** accept a quest from an NPC, kill the target, turn it in.
Keep an eye on UTF-8 glyph integrity in `client/**/*.html` after every client edit (CLAUDE.md rule).
