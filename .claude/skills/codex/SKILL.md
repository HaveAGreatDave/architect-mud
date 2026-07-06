---
name: codex
description: Ship world content and schema changes cleanly through the CODEX content pipeline (git as source of truth). Use this as the EXIT GATE after creating or editing any world content (NPCs, items, zones, enemies, furniture, drugs, dialogue, media, audio) or after touching SCHEMA_SQL / adding a table — and whenever the user says "ship this", "prep for push", "make sure this is clean", "is this mergeable", or "did I break anything". Guarantees a clean merge, a green regress, and no runtime residue in the commit.
---

# CODEX — shipping content through the pipeline

World content lives in **git as one JSON file per entity** (`content/<table>/<pk>.json`); databases are build artifacts of those files. This skill is the **exit gate**: the discipline that gets content from "sitting in my local DB" to "committed clean, merges without a fight, passes regress, and won't stomp anyone on prod." It is the counterpart to [`_shared/change-gate.md`](../_shared/change-gate.md) — that gate decides *what kind of thing to build*; this one decides *whether it's safe to ship*.

**Read [docs/content-pipeline.md](../../../docs/content-pipeline.md) once per session** before shipping — it's the authoritative pipeline reference; this skill is the operating procedure on top of it.

> **Cutover check (do this first, once per session).** The pipeline may be mid-migration, and the signals are separate — check, don't assume:
> - `git ls-files content/ | head -1` — is the file tree committed? (empty ⇒ baseline not landed yet ⇒ the old seed pipeline is still the only truth; ship via the legacy path and say so.)
> - `git ls-files db/seed.sql` — does the **old** pipeline still exist? If BOTH the content tree and `db/seed.sql` are present, you're in the **transition window**: the baseline landed but the old pipeline isn't retired. Files are the intended truth, but confirm with the user which pipeline they're treating as authoritative before you ship — a stale or un-reconciled `content/` (e.g. seeded from one person's local DB, not the reconciled prod baseline) can still be in flux.
> - `grep -q "^  push:" .github/workflows/deploy-content.yml` — is prod auto-deploy live? If yes, a push to `main` deploys; treat §Prod as real.
>
> Only when `content/` is committed do the steps below apply. When in doubt, ask rather than shipping through a half-migrated pipeline.

## When to invoke

- **Always, after `mud-designer`, `plugin-builder`, or `engine-change` produce content or schema.** Those skills END with rows in your local DB or DDL in `SCHEMA_SQL`. They are not done until CODEX ships them. Treat this as the mandatory Phase-N of each.
- After ANY dev-panel / `design-cli` authoring session, even a one-line tweak.
- On explicit asks: "ship this", "commit the content", "prep for push", "is this clean", "did I break the world".
- Before telling the user a content task is "done." Content in a local DB that isn't exported and committed is **invisible to everyone else and lost on the next rebuild.**

## The ship sequence

Run it in order. Do not skip the diff review — it is the step that catches the mess.

```
1. npm run content:export      # local DB → content/ files
2. git status content/         # what changed?  ← THINK here, don't rubber-stamp
   git diff content/           # read it
3. <discard runtime residue>   # git checkout -- content/<table>/<file>  (see below)
4. npm run content:lint        # JSON valid, real columns, no excluded cols, no dangling FKs
5. npm run test:regress        # the SHIP regress: the shipped world still boots, all suites green
6. git add content/ [code]     # + any SCHEMA_SQL/registry/plugin code in the same commit
   git commit -m "…"
7. report: what shipped (ids), lint/regress result, anything you discarded and why
```

Pushing is the user's call unless they said otherwise. Tell them what a push will do (§Prod), don't do it silently.

**After `content:export`, re-read any content file before you `Edit` it.** Export canonicalizes — it sorts JSON keys and adds runtime columns like `updated_at` — so an `Edit` whose `old_string` you remember from *before* the export will silently fail to match. This is the #1 cause of "why won't my edit apply" mid-ship: Read the file first, then edit.

**Step 5 is the *ship* regress, not the *code* regress — and it does NOT replace the build skills' gates.** `codex` runs `test:regress` as the last gate before commit to prove the shipped world boots and every suite is green. It is not a substitute for what `plugin-builder`/`engine-change` do earlier: `plugin-builder` writes and runs the mechanic's own `regress.js` (proving routing/gating), and `engine-change` runs a **mandatory source-of-truth audit** that has no counterpart here. If you arrived from one of those skills, you've already done that work — codex is the final ship gate on top. If you arrive at codex with content that was authored but the code path wasn't gated (e.g. a raw dev-panel session), the ship regress still runs, but it only proves the world boots, not that a new mechanic is correct. Same command running here and there is intentional layering, not redundancy.

## Step 2–3: review the diff — discard runtime residue

`content:export` dumps every content row in your local DB. Your DB has been *played* — the server, your testing, and background sims created rows and mutated state that are **not authored content**. The registry auto-excludes runtime *columns* (door open/closed, npc wander position, generator fuel level), but entire runtime-*created rows* still surface as brand-new files. Committing them is the "nothing stinks" failure.

**Read every new/changed file in the diff and ask: did I author this, or did the running game?** Discard (`git checkout -- <file>`) anything you didn't deliberately create:

- `furniture/furn_<8-hex>.json` you didn't place — bought/spawned during play
- `generators/gen_*_<timestamp>.json`, `power_zones/*_<timestamp>.json` — the power sim's auto-built junction boxes
- `zones/zone_studio_*`, `zone_util_*`, `zone_ext_*` with timestamp suffixes — runtime-constructed rooms
- `items/*` that are recorded tapes, cut keycards, or crafted-gear instances — player artifacts, not catalog items
- `apartments/*` with an `owner_id` set — a rented unit (the registry excludes tenancy columns, but if a whole personal-apartment row is new, scrutinize it)
- media camera/recording rows that accreted while the server ran

If the diff is *only* the entity you meant to create/edit (plus its legitimately-authored furniture/dialogue), you're clean. If you're unsure whether a row is content or residue, `content:status` and the file's `id` prefix usually tell you; when still unsure, ask the user rather than committing a guess.

**Never `git add content/` blindly (`git add -A`, `git add .`).** Add the specific files you authored.

## New table? Classify it in the registry — this is where "door state" bites

If your work added a table to `SCHEMA_SQL` (you came from `plugin-builder` Phase 3 or `engine-change`), it **must** be classified in [`server/models/content-registry.js`](../../../server/models/content-registry.js) or regress goes red (layer 1a). Decide three things:

1. **class** — `content` (authored, git-owned), `runtime` (regenerated/accumulated at play time), or `player` (player-owned rows/PII). Most new *authorable* content is `content`; per-player or auto-generated state is `runtime`/`player`.
2. **pk** — the primary key column(s). Composite keys list all parts.
3. **excludeColumns** — for a `content` table, the columns gameplay mutates at runtime that must **not** be serialized as authored state.

**The excludeColumns rule (the door-state lesson — get this exactly right):** exclude a column **only if it is self-healing or ephemeral** — a fresh restore is correct with that column at its schema default because the engine recomputes it next tick, clears it daily, or rebuilds it on demand. Examples that qualify: `power_zones.current_load_kw` (recomputed every cycle), `furniture.light_on` (day/night tick resets it), `media_cameras.recording_buffer` (live buffer).

**Do NOT exclude a column that carries authored initial state**, even though gameplay also mutates it. This is the trap: `doors.lock_state` *looks* like runtime state (players lock/unlock), but its authored value is what makes a vault ship *locked* — excluding it shipped every authored lock disengaged on a fresh world. Same for `generators.fuel_remaining` (default 0 → excluding it restores every generator dead) and `furniture.hp` (no default → destructibles need it). These stay **content**; the churn they produce in exports is reviewable diff noise, which is the honest, safe tradeoff.

> Litmus: *"If this column were blank on a brand-new production database, would the world be correct?"* Yes → exclude. No → it's authored content, keep it. When unsure, **keep it** (over-exclusion is silent data loss; over-inclusion is only diff noise).

Regress validates that every excludeColumns/pk entry names a real column and that the table is classified — so a bad guess fails loud, not silent. Read the registry's header comment; it states this rule in full.

## Schema change: everything travels in ONE commit

When the ship includes a schema change, the SCHEMA_SQL edit, the registry classification, the plugin/engine code, and the content files go in the **same commit**. CI applies SCHEMA_SQL to prod before importing rows, so the schema and the content that depends on it arrive together — that's the structural fix for "nobody ran the migration on live." A content file referencing a column that isn't in the same commit's schema will fail lint (`unknown column`) — which is the gate doing its job. After editing SCHEMA_SQL, `npm run content:import` locally applies it, then re-`export` repopulates files with the new key (expect one mechanical diff across that table).

## Pulling teammate content (the merge side of "clean")

- `git pull` → the post-merge hook auto-runs `content:import --guard-wip`. If it **aborts** naming an entity, you edited that entity locally without exporting — the pull would have stomped it. Resolve: `content:export` your version → `git diff` (you'll see both) → resolve like any git conflict → `git add` + commit → `content:import`.
- Before pulling, `npm run content:status` tells you if you have unexported work sitting in your DB. Clean status = safe pull.
- Merge conflicts in `content/*.json` are per-entity and small. When the JSON is fiddly, the escape hatch is: accept either side, import, re-make the change in the dev panel, re-export.

## Deleting content locally — the two traps the deletion pass sets

`content:import`'s deletion pass is **git-diff-driven**: it deletes rows for files removed between the last-imported marker and HEAD (`marker..HEAD`), not for files simply absent from disk. During local iteration that bites two ways:

1. **`rm`-ing a content file does NOT remove its row from your local DB.** An uncommitted deletion isn't in `marker..HEAD`, so `content:import` leaves the row untouched (it only upserts files that still exist). To actually drop it while iterating: **commit the deletion, then `content:import`** — or delete the row directly (`DELETE FROM <table> WHERE id=…` via a scratchpad script; a data change, which is allowed).

2. **Restoring a file you deleted-and-committed earlier on the SAME branch keeps getting re-deleted.** HEAD still shows it deleted, so every `content:import` inserts it from the working file *then the deletion pass removes it again* — the log reads `1 inserted, … 1 deleted` and the row ends up gone. Fix: **commit the restoration first**, then `content:import`. Now `marker..HEAD` no longer shows it deleted and the row sticks.

Symptom of both: a content file exists on disk but its row is missing from the DB — which surfaces as a broken `examine`/`look`, a dangling inventory reference, or a lint FK warning. Confirm with `SELECT id FROM <table> WHERE id=…`; the fix is always commit-then-import.

## Prod: what a push means, and the cautions

After cutover, **pushing to `main` deploys to production** (CI applies content; Render redeploys code — same push). You rarely push (that's the user's call), but when you prepare a push, know and relay:

- **Deletions propagate.** A content file you removed and committed **deletes that row from prod** (scoped to the table's content predicate; logged in the deploy). If you didn't mean to retire content, don't delete its file. `git revert` + push is a full rollback.
- **The drift report will flag prod hotfixes.** CI reports any prod rows that differ from files before overwriting them. If you know someone hand-edited prod, export+commit that first or the deploy erases it.
- **Never propose hand-editing prod content.** It's HTTP-blocked (`CONTENT_READONLY`) and the drift report tattles on SQL sneaks. Urgent fix = fix locally, ship, live in minutes.
- The pre-deploy `pg_dump` backup is the catastrophe net; you never invoke it, it just exists.

## The "nothing stinks" checklist (report against this)

Before you call it done, confirm out loud:

- [ ] `content:export` run; `git diff content/` **read**, not rubber-stamped
- [ ] runtime residue discarded (or: diff was clean, nothing to discard — say which)
- [ ] new tables classified in the registry; excludeColumns follows the self-healing-only rule
- [ ] schema + registry + code + content in **one** commit if a schema change is involved
- [ ] `content:lint` clean
- [ ] `npm run test:regress` green (report the count)
- [ ] only the files you authored are staged — no `git add -A`
- [ ] reported: ids created, what was discarded and why, lint/regress results, and (if relevant) what a push will deploy/delete

A green regress and a reviewed diff are the two things that mean "the wheels stay on the bus." Don't report a content task done without both.
