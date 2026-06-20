# CLAUDE.md — Architect MUD

## What This Is

Post-singularity browser MUD in the HellMOO tradition. Text-driven, real-time, brutal, and funny. Node.js server with raw WebSockets, vanilla JS single-file frontends, PostgreSQL via Supabase. No build step, no ORM, no framework.

## Key Docs

- [README.md](README.md) — deploy instructions, player commands, world overview, what's built and what's next
- [docs/architecture.md](docs/architecture.md) — stack decisions, repo structure, data flows, DB schema, lessons learned from deployment bugs
- [docs/design.md](docs/design.md) — game design philosophy, combat feel, skill/faction/economy systems, open design questions

**Before touching any system, read the relevant doc section if there's one applicable to the request.** The architecture doc especially has real deployment bugs documented — don't relearn them.

## Core Architectural Rules

- **Engine vs. content are separate.** The codebase is the engine. World content (zones, items, enemies, NPCs) lives in Postgres and is edited through the dev panel. Don't hardcode content into engine files.
- **No ORM.** All queries go through the single `query()` helper in `server/models/db.js`. Keep it that way.
- **No frameworks.** Frontend is single-file HTML/CSS/JS. No build pipeline to add.
- **Plugins for extensibility.** New behavior hooks belong in `/plugins/`, not in engine files, unless they're genuinely core.

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
