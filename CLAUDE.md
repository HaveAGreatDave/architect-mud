# CLAUDE.md — Architect MUD

## What This Is

Post-singularity browser MUD in the HellMOO tradition. Text-driven, real-time, brutal, and funny. Node.js server with raw WebSockets, vanilla JS frontends (one HTML/JS file per client plus a sibling `styles.css`), PostgreSQL via Supabase. No build step, no ORM, no framework.

## Key Docs

- [README.md](README.md) — deploy instructions, player commands, world overview, what's built and what's next
- [docs/architecture.md](docs/architecture.md) — stack decisions, repo structure, data flows, DB schema, lessons learned from deployment bugs
- [docs/design.md](docs/design.md) — game design philosophy, combat feel, skill/faction/economy systems, open design questions
- [docs/items.md](docs/items.md) — item property reference: every `items` field, which JSON keys the engine actually reads, and the working armor format
- [docs/tags.md](docs/tags.md) — the tag system: catalog/helpers/Tag→Action registry, the tag model, and how to add a tag cleanly (property vs. behavior)
- [docs/combat.md](docs/combat.md) — combat **as actually built** (to-hit, body parts, typed soak, cooldowns, enemy AI, loot); the authoritative running source on the combat system
- [docs/systems-survival.md](docs/systems-survival.md) — hunger/thirst, radiation, mutations, drugs, buffs, sleep, status-effect framework (as built)
- [docs/systems-weather-extreme.md](docs/systems-weather-extreme.md) — **extreme weather (steps 1–6 built; 7 pending)**: severity scalar over the weather field, gear-gated-lethal thermal/wind/blackout/ash-choking channels, no indoor safe-haven, power-stays-out scar, ⚠ forecast telegraph band; EMP hero event + acid rain still to build
- [docs/systems-economy.md](docs/systems-economy.md) — credits/banking, vendors, factions, crafting, IP/stat-raising, housing (as built)
- [docs/systems-world.md](docs/systems-world.md) — world state, movement, ambience, sound propagation, spawning, minimap, scheduler, tunables (as built)
- [docs/devpanel-js.md](docs/devpanel-js.md) — dev panel JS file reference: what each script in `client/devpanel/js/` holds, which functions live where, and the load-order contract
- [docs/commands.md](docs/commands.md) — command dispatch pipeline, SIFT/FATE target resolution system, rules for using SIFT in new commands, and per-domain targeting reference
- [docs/scripting.md](docs/scripting.md) — action registry (registerAction/dispatchAction), event bus (on/emit), flag store (getFlag/setFlag/evalConditions), and script graph runner (runGraph); the mutation path all content flows through
- [docs/ai-behaviour.md](docs/ai-behaviour.md) — VINE-powered behaviour trees for enemies and NPCs; node types, condition/action catalogue, blackboard, pathfinding
- [docs/plugins.md](docs/plugins.md) — **plugin index**: which plugin owns each verb/mechanic, and the command-precedence rule (plugins win over engine builtins). Check this before editing any player command.
- [docs/systems-posture.md](docs/systems-posture.md) — posture/sitting (split engine+plugin system): the `player.posture`/`sittingOn` contract, HP regen, stand-up triggers, look description (as built)
- [docs/systems-broadcast.md](docs/systems-broadcast.md) — broadcast system: channels, playlists, dynamic news, VINE graph scripts, NPC hosts, camera feeds, broadcast-bridge, game client styling (as built)
- [docs/systems-atm.md](docs/systems-atm.md) — ATM terminals: furniture integration, networks, fee/limit/faction logic, hacking, replenish tick, power dependency, dev panel routes (as built)
- [docs/systems-scavenging.md](docs/systems-scavenging.md) — scavenging: posture-based perpetual search, per-zone loot tables + lazy replenish, the 2D8−2D8 Scavenging check, feedback state machine (as built)
- [docs/systems-corps.md](docs/systems-corps.md) — **corporations & player orgs (design, not built)**: corp = faction + owner + treasury + members + territory; influence tug-of-war for zones, single membership, five power levers (economy/territory/subterfuge/aggression/diplomacy), NPC corp AI, Architect-reacts-to-concentration
- [docs/audits/](docs/audits/README.md) — **audit suite**: reusable prompts that challenge the design at its silent seams (engine↔plugin source-of-truth, client↔server protocol, content↔engine fields, UI/CSS standardization, registry naming harmony). Start at the [index](docs/audits/README.md); the seminal one is [source-of-truth-audit.md](docs/audits/source-of-truth-audit.md) (the bug class behind the posture break).

**Before touching any system, read the relevant doc section if there's one applicable to the request.**

**Before editing any player command, check [docs/plugins.md](docs/plugins.md) first** — a plugin may already own that verb, in which case the engine handler for it is dead code.

## Core Architectural Rules

- **Engine vs. content are separate.** The codebase is the engine. World content (zones, items, enemies, NPCs) lives in Postgres and is edited through the dev panel. Don't hardcode content into engine files.
- **No ORM.** All queries go through the single `query()` helper in `server/models/db.js`. Keep it that way.
- **No startup migrations. Schema and content are managed deliberately, never on boot.**
    - **Schema** is the single source of truth in `server/models/schema.js` (`SCHEMA_SQL`, idempotent DDL). Apply it with `npm run db:schema`.
    - **Content** belongs to production. A fresh database is populated by restoring a `.sql` dump exported from the dev panel (`/dev` → Power Tools → _Database Backup_ → Export). Restore via `psql -f` or `npm run db:restore -- dump.sql`. There is no checked-in `seed.js` and no boot-time content rewriting (the old startup `migrate()` was removed precisely because it disrupted dev by mutating content on every restart).
    - **To change the schema:** run a deliberate one-shot script once against production, **and** edit `SCHEMA_SQL` to match. Never add an auto-run migration. Because the export reuses `SCHEMA_SQL`, backups stay in sync automatically — no separate bookkeeping.
    - The export deliberately excludes player/runtime rows (accounts, inventory, password hashes); it carries schema + world content only.
- **Plugins for extensibility.** New behavior hooks belong in `/plugins/`, not in engine files, unless they're genuinely core.
- **UTF-8, always.** Several files (especially `client/game/index.html`) use Unicode glyphs and box-drawing chars (`₵ ⚙ ⏻ ╱ █ ☢`). When editing, preserve UTF-8 without a BOM — never let a tool re-save as Windows-1252 or it double-encodes everything into `â•±â•²` mojibake. After editing such files, sanity-check that the glyphs are still intact.

## VINE Graph Workflow

When asked to create or update an NPC behaviour graph, dialogue tree, or enemy behaviour graph:

1. **Write the JSON** — produce the full graph object (`{ nodes: {}, edges: [] }`) according to the relevant schema (`vine-schema-ai.js`, `vine-schema-dialogue.js`, etc.).
2. **Push it to the DB** via the PATCH API routes (no copy-pasting, no UI required):
   - NPC behaviour: `PATCH /api/npcs/:id/graph` `{ "field": "behaviour_graph", "graph": {...} }`
   - NPC dialogue: `PATCH /api/npcs/:id/graph` `{ "field": "dialogue_tree", "graph": {...} }`
   - Enemy behaviour: `PATCH /api/enemies/:id/graph` `{ "field": "behaviour_graph", "graph": {...} }`
3. **Confirm success** — check the response is `{ ok: true }` and report back. If the route returns an error, diagnose and fix before reporting done.

The VINE modal also has a "📋 Load JSON" button for manual paste-in when needed, but the API route is the standard path.

## Working Agreements

### 1. Think Before Coding

Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.
- Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

Touch only what you must. Clean up only your own mess.

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: every changed line should trace directly to the user's request.

These guidelines are working if: fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
