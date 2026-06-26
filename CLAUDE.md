# CLAUDE.md — Architect MUD

## What This Is

Post-singularity browser MUD in the HellMOO tradition. Text-driven, real-time, brutal, and funny. Node.js server with raw WebSockets, vanilla JS frontends (one HTML/JS file per client plus a sibling `styles.css`), PostgreSQL via Supabase. No build step, no ORM, no framework.

## Key Docs

- [README.md](README.md) — deploy instructions, player commands, world overview, what's built and what's next
- [docs/architecture.md](docs/architecture.md) — stack decisions, repo structure, data flows, DB schema, lessons learned from deployment bugs
- [docs/design.md](docs/design.md) — game design philosophy, combat feel, skill/faction/economy systems, open design questions
- [docs/items.md](docs/items.md) — item property reference: every `items` field, which JSON keys the engine actually reads, and the working armor format
- [docs/combat.md](docs/combat.md) — combat **as actually built** (to-hit, body parts, typed soak, cooldowns, enemy AI, loot); the authoritative running source on the combat system
- [docs/systems-survival.md](docs/systems-survival.md) — hunger/thirst, radiation, mutations, drugs, buffs, sleep, status-effect framework (as built)
- [docs/systems-economy.md](docs/systems-economy.md) — credits/banking, vendors, factions, crafting, IP/stat-raising, housing (as built)
- [docs/systems-world.md](docs/systems-world.md) — world state, movement, ambience, sound propagation, spawning, minimap, scheduler, tunables (as built)

**Before touching any system, read the relevant doc section if there's one applicable to the request.**

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
