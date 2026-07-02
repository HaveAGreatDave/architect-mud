---
name: plugin-builder
description: Add a new mechanic, verb, or system to Architect MUD as a plugin — the safe path that doesn't break the existing stack. Use when you're about to create a plugins/<name>/ folder, add a player verb, hook into an engine flow, or extract a system out of the engine. Runs the engine-vs-plugin-vs-content decision gate FIRST, then scaffolds against the real seams, then runs the regression gate.
---

# Plugin Builder

You are adding a system to Architect MUD without breaking what exists. This skill is a **router first, builder second**. Most of the damage from a new feature happens *before* any code is written — by building the wrong *kind* of thing. So you gate first.

**Do not skip to scaffolding.** Work the phases in order. The gate in Phase 0 can and should stop you.

## Read these before deciding anything

The skill delegates to the living docs rather than restating them (they'd drift). Read the relevant ones for the request — don't work from memory:

- [docs/proposals/engine-plugin-boundary.md](../../../docs/proposals/engine-plugin-boundary.md) — **the boundary thesis, litmus tests, substrate/law/registry model.** This is the whole basis for the gate.
- [docs/plugins.md](../../../docs/plugins.md) — the plugin catalogue + **command-precedence rule** (plugins beat builtins). Check whether a plugin already owns the verb/mechanic you're about to build.
- [docs/plugin-standard.md](../../../docs/plugin-standard.md) — manifest schema, file layout, README + `regress.js` conventions. This is your build reference; don't duplicate it here.
- [docs/scripting.md](../../../docs/scripting.md) — actions/events/flags/graph: the mutation path all content flows through.
- CLAUDE.md — "Regression testing" (when to run the gate), "Core Architectural Rules" (no ORM, no startup migrations, engine≠content, UTF-8).

---

## Phase 0 — The gate: is this even a plugin? (HARD STOP)

Run [the change gate](../_shared/change-gate.md) and answer its litmus tests out loud. This skill only
proceeds when the verdict is **a system/verb** (a leaf). If the gate routes elsewhere, **stop and reroute** —
do not scaffold:

- **substrate or law → `engine-change` skill** (shared state / a universal rule belongs in the engine).
- **content → `mud-designer` skill** (NPC/item/zone/drug/graph belongs in the DB via the dev API — never hardcode content into a plugin).
- **already owned → extend the existing owner** (check the [plugins.md](../../../docs/plugins.md) catalogue + `getRegisteredCommands()`).

**It IS a plugin when it passes the leaf test:** nothing outside the system reads its state, and it's
something a player *does* (a verb) or a reaction that plugs into an existing seam (hook/tick/event). Size
doesn't matter — MIS is 1,600 lines and a correct leaf. If the plugin needs a *new* substrate to exist
first, split the work: do the `engine-change` for the substrate, then come back here to build the system
on top.

The gate's **interaction rule** and **don't-over-extract** rule bind here too — re-read them in the shared
file before designing cross-system coupling.

---

## Phase 1 — Pick the seam(s)

A plugin couples to the game **only** through registered channels. Choose the minimum set — most plugins use one or two:

| You need to… | Seam | Export / call |
|---|---|---|
| Add a single-word player verb | **command** | `export const commands = { verb: (args, raw, player, broadcast) => … }` + `"commands"` in manifest |
| Add a verb gated on an item/furniture **tag** | **specialized action** | `export const specializedActions = [{ verb, requiredTag, handler }]` |
| Add a multi-word / raw-input verb ("jerk off on") | **input matcher** | `registerInputMatcher(regex, handler, owner)` |
| React inside an engine flow (describe room, appearance, death) | **hook** | `export const hooks = { 'zone.describeRoom': fn }` + `"hooks"` in manifest |
| Run on a cadence | **tick** | subscribe a scheduler cadence (`scheduler.js`); declare in `"ticks"` |
| Be triggered by / replay a SIFT pick / let another system call you | **Action** | `registerAction({ type, handler })` + `dispatchAction(...)` |
| Fire-and-forget signal others can consume | **event** | `emit(name, payload)` / `on(name, fn)` |
| Feed the engine a value it samples every tick (weather field, combat provider) | **provider injection** | `registerXProvider(fn)` (sync-by-contract) |
| REST surface (usually dev-panel or client) | **route** | `export const routeHandler` + `"routePrefix"` |

**SIFT replay trap:** if your verb resolves an ambiguous target with SIFT, the builtin replay path can't reach plugin verbs. Replay through an Action (`createSelectionState(..., { dispatchType, dispatchParam })` + a `registerAction`). See [thievery/index.js](../../../plugins/thievery/index.js) for the canonical pattern.

**Split-system contract:** if the plugin owns *state* the engine *reacts* to (posture is the archetype), the plugin and engine **must agree on the field name and shape exactly**. Prefer writing through an engine substrate API (`setPosture`/`forceStand`) over raw `player.x` pokes. Document the contract in the relevant `docs/systems-*.md`.

---

## Phase 2 — Scaffold

Follow [docs/plugin-standard.md](../../../docs/plugin-standard.md) for the exact file/manifest/README spec. Concretely:

1. **Check for collisions first.** Is your verb already registered? (`getRegisteredCommands()`, the [plugins.md](../../../docs/plugins.md) catalogue.) If you intentionally override another plugin's verb, declare `"after": ["thatPlugin"]` in the manifest — the loader warns on every undeclared collision at boot. If you shadow an engine builtin, that builtin becomes dead code by dispatch order (SIFT → input matchers → plugin commands → specialized actions → builtins) — that's fine but make it deliberate.
2. **Create `plugins/<name>/`** with `plugin.json` (name/version/description + only the seams you use) and `index.js`. Copy the shape from a small clean plugin — [thievery](../../../plugins/thievery/) (command + Action + SIFT replay) or a `specializedActions` one from the catalogue. Import engine services from `../../server/engine/...`; all DB access goes through the single `query()` in `server/models/db.js` (no ORM).
3. **Mark `"critical": true`** only if the game is unplayable without it (registers a provider the engine calls every tick, like weapon). A critical plugin's load failure aborts boot.
4. **Own your tables.** If the plugin needs new DB tables, list them in `"dataSchema"`. See Phase 3 for the schema ceremony — never auto-migrate on boot.
5. **UTF-8, no BOM.** If you touch client files with glyphs (`₵ ⚙ ☢ █ ╱`), preserve encoding — re-saving as Windows-1252 double-encodes into mojibake.
6. **Write `README.md`** per the standard (Purpose prose + the machine-listable sections from `plugin.json`).
7. **Update [docs/plugins.md](../../../docs/plugins.md)** — add your row to the catalogue table. This is the map everyone checks before editing verbs; an unlisted plugin is an invisible one.

---

## Phase 3 — Dev-panel / schema integration (only if genuinely needed — escalation, not default)

**Most plugins need none of this.** They read substrates and existing content. Reach for dev-panel/schema work only when the plugin introduces *new editable content* (a new content type someone will author) — and be sure that content couldn't live in an existing table first.

When it's truly required:

- **Schema:** add the DDL to `SCHEMA_SQL` in `server/models/schema.js` (idempotent), AND run a deliberate one-shot against production. **Never add a boot-time migration** — boot stays deliberate (same rule as no startup content rewriting). Apply with `npm run db:schema`. Because the dev-panel export reuses `SCHEMA_SQL`, backups stay in sync automatically.
- **Dev-panel UI:** lives in `client/devpanel/` (see [docs/devpanel-js.md](../../../docs/devpanel-js.md) for the file map + load-order contract) with a REST route behind your plugin's `routePrefix`. Match the existing panel's CRUD idiom; writes go through API handlers (they fire live reloads), not raw SQL.
- **Content is production-owned:** a fresh DB is populated by restoring a dev-panel export, not by a seed file. Don't ship a `seed.js`.

If a request wants dev-panel authoring for something that's really just *content*, stop — that's `mud-designer` + existing tables, not a new plugin panel.

---

## Phase 4 — Regression gate (MANDATORY — do not report done without it)

1. **Write `plugins/<name>/regress.js`** — a default-exported `async ({ run, check, getPlayer }) => {…}`. Assert routing, gating, and state transitions for every verb; keep it fast and side-effect-free (no row creation — DB writes against the fake player's id are no-ops). An untested verb is an unguarded verb. Pattern: [thievery/regress.js](../../../plugins/thievery/regress.js).
2. **Run it:** `npm run test:regress`. This sweeps every manifest against the live registries (your declared commands/hooks actually wired) AND runs every plugin's suite — so it also proves you didn't break another plugin's seam.
3. **Report the result** in your summary — green count, or the failure and your fix. This is the pre-deploy gate; treat a red result as blocking.
4. **Kill any background server you started** before finishing. The harness shares the Supabase pool (pool_size 15); orphaned `node server/index.js` processes exhaust it (`EMAXCONNSESSION`) and time out real users. If the harness dies with that error, hunt orphans or wait ~90s.

Caveat: player stat columns are `stat_brawn`/`stat_reflexes`/… (not `brawn`) if your suite touches stats.

---

## Hard-won gotchas

- **Plugins win over builtins, always.** A verb with both a plugin and an engine handler runs the plugin; the builtin is dead code. When "the engine code says X but the game does Y," check the plugin registry *first*. (This exact trap caused the posture/HP-regen bug.)
- **Load order is filesystem-alphabetical** unless a manifest declares `after:`. The collision detector caught interactions silently stealing `watch` from gametable this way — a whole feature dead at runtime with no error. Declare `after:` for every intentional override.
- **A hook's last non-undefined return wins.** If two plugins hook the same point, order matters and a `return undefined` yields to the next. Don't return a value from a hook you only meant to observe.
- **`specializedActions` gate on a tag** from the catalog (`client/shared/tagCatalog.js`, [docs/tags.md](../../../docs/tags.md)) — don't invent a tag; a verb gated on a tag nothing has is a verb that never fires.
- **Forward `broadcast`.** Zone-visible effects (combat, overdose death, teleports) need the `broadcast` fn threaded through — dropping it makes the mechanic silent to everyone else in the room.
- **Provider injection is sync-by-contract.** The engine calls it as a raw function ref on the tick; if it throws or returns the wrong shape, the tick breaks for everyone. Match the existing provider's signature exactly (see weather's `registerWeatherField`, weapon's `registerPlayerCombat`).
- **Don't extract a hub.** If pulling something out of the engine forces you to add a provider callback so the engine can still reach it every tick, it's a hub — leave it. The boundary doc's "what deliberately stays" list is load-bearing.
