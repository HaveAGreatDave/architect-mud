# Content Pipeline — git as the source of truth for world content

World content (zones, NPCs, items, audio, media, …) lives in git as **one JSON
file per entity** under `content/<table>/<pk>.json`. Databases — yours, Dave's,
production — are build artifacts of those files. Git is the merge engine:
concurrent work on different entities merges automatically; the same entity
becomes an ordinary, visible git conflict instead of a silent overwrite.

> **MIGRATION STATUS (2026-07-06):** the pipeline is built and verified, but the
> cutover has NOT happened yet. The old seed pipeline (db/seed.sql +
> content:publish/sync + Relay) is still authoritative until the [cutover
> runbook](#cutover-runbook) below is executed. Do not run both pipelines side
> by side beyond the cutover window.

## The one table that rules them all

[server/models/content-registry.js](../server/models/content-registry.js)
classifies **every** table in SCHEMA_SQL as `content`, `runtime`, or `player`,
and for content tables declares the pk, FK-safe order, the row predicate (for
tables that mix content with runtime rows, e.g. NPC factions vs player crews),
and `excludeColumns` — runtime-mutated columns that never enter files.

**excludeColumns admits only self-healing state** (recomputed next tick, cleared
daily, rebuilt on demand). A column carrying *authored initial state* stays
content even though runtime also mutates it — a door ships locked, a generator
ships fueled. The churn those columns produce in exports is reviewable diff
noise; a fresh restore that unlocks every vault is data loss. Regress layer 1a
fails the build if any table is unclassified or any declared column doesn't
exist — the "forgot to add scavenging tables to the backup" bug class is dead.

## Daily loop

```
session start:   git pull            # post-merge hook auto-imports content changes
work:            build in the dev panel / design-cli against your LOCAL db
session end:     npm run content:export
                 git diff content/   # review what you actually changed
                 git add content/ && git commit && git push
any time:        npm run content:status   # "do files match my DB?"
```

- `content:export` — local DB → files. Deletes files whose rows vanished
  locally; **that is how content deletions enter git** (review, then commit).
- `content:import` — files → DB. Applies SCHEMA_SQL first, then one
  transaction: registry-order upserts (`ON CONFLICT (pk) DO UPDATE`, no-op when
  identical), then the deletion pass (below). Never drops the DB; player rows
  are untouched.
- `content:lint` — no DB needed: JSON validity, schema-column agreement, no
  excluded columns, pk/filename agreement, dangling content→content FK refs.
  Runs in the pre-push hook and CI.
- `content:status` — exports your DB to a temp dir and diffs against
  `content/`. Exit 1 = you have unexported work (or unimported files).

The pre-push hook lints content and skips local regress for content-only pushes
(CI regresses the merged main). The post-merge hook imports pulled content with
`--guard-wip`: if a pulled commit touches an entity you edited locally but
haven't exported, the whole import aborts and tells you to export/resolve — a
silent local overwrite becomes a visible git conflict.

## Deletions: git-diff-driven, never absence-based

Content tables also receive rows **at runtime** (players buy furniture, record
tapes, cut keycards; the power system builds junction boxes; renting upserts
apartments). Those rows never had files, so "delete any row without a file"
would destroy player property. Instead:

- Every import records the imported commit in the target DB
  (`server_settings` key `content_pipeline.last_imported_sha`).
- The deletion pass lists files **deleted in git** between that marker and
  HEAD, recovers each row's pk from the old blob (`git show <sha>:<path>`),
  and deletes exactly those rows — scoped to the table's content predicate.
  Every deletion is logged. A missing marker skips deletions loudly.

Consequence: **`git revert` of a bad content commit is a complete rollback** —
re-imported, it restores overwritten values, removes the rows the bad commit
added, and resurrects the rows it deleted. Verified in the Phase-2 drill.

## Production

- Prod content is **read-only over HTTP** (`CONTENT_READONLY=1` on Render): the
  dev panel on live is an ops console (player admin, weather/power, live
  spawns, ATM cash, gametables, crime log all stay live) and a viewer for
  content. The gate sits ahead of ALL HTTP dispatch including plugin routes;
  gameplay (WebSocket) is unaffected.
- The **only** writer of content to prod is
  [.github/workflows/deploy-content.yml](../.github/workflows/deploy-content.yml),
  on push to main: regress against a throwaway Postgres built purely from
  `content/` → `pg_dump` backup (14-day artifact) → drift report (surfaces any
  manual prod edits the deploy is about to overwrite) → `content:import --prod`
  → `deployments` row → Render deploy-hook restart (fresh world cache).
- Secrets: `PROD_DATABASE_URL` (Supabase **session-mode**, port 5432 — pg_dump
  and `SET CONSTRAINTS` don't work through the transaction pooler),
  `RENDER_DEPLOY_HOOK_URL` (optional but recommended).
- Emergency prod work stays possible: one-shot scripts via
  `node --env-file=.env.prod` (data transformations, incident response). If you
  hand-edit prod content in an emergency, export it back into git afterwards or
  the next deploy's drift report will warn — and the deploy will overwrite it.

## Merge conflicts

Per-entity files with sorted keys make conflicts rare and small (two devs
editing the *same* entity). Resolve like any git conflict; when the JSON is
fiddly, the escape hatch is: pick either side, import, re-make your change in
the dev panel, re-export. `content:lint` in the pre-push hook catches botched
resolutions before they reach main.

## Schema changes

Edit `SCHEMA_SQL` (idempotent DDL) as always. `content:import` applies it
before touching rows, so a content commit that needs a new column carries it —
locally via the post-merge import, on prod via CI. After adding a column, run
a local import then `content:export`: files repopulate with the new key
(expect one mechanical diff across that table's files). Classify any new table
in the registry — regress is red until you do.

## Known seams (accepted, documented)

- **zones.exits / zones.tags** are authored content that runtime systems also
  wire (power rooms, studio construction attach exits to authored zones). An
  import that changes an authored zone's file resets that zone's exits, which
  can orphan a runtime-wired connection. The CI drift report surfaces it.
- **doors.\*** (is_open, lock_state, tags…) are authored initial state that
  players also mutate; an import touching a door's file resets that door's
  live state. Bounded: only doors whose files changed in the deployed range.
- **Local runtime rows get exported.** Furniture you bought or junk the power
  system built in YOUR local world shows up in `content:export` as new files.
  That's the review step's job: `git diff content/` before committing, drop
  what isn't content. On prod these rows are safe regardless (deletion needs a
  git-tracked file).

## One-off authoring scripts

The `scripts/add-*` / `scripts/seed-*` pattern stays valid: they write your
LOCAL DB, then `content:export` captures the rows as files. Never point them at
prod — content reaches prod through git only.

## Cutover runbook

Executed once, deliberately, with both devs available:

1. **Freeze content edits.** Both devs run the OLD pipeline end-to-end one last
   time (export-seed → content:publish; Relay deploy to prod) so prod ≈ seed ≈
   both locals.
2. **Baseline from prod** (on a branch):
   `node scripts/content/export.mjs --prod --yes` → commit `content/` —
   "Content baseline from production".
3. **Reconcile.** Each dev checks out the branch and runs
   `npm run content:status` — the output IS the reconcile report (rows only in
   your DB = unpublished WIP; rows only in files = prod-only content you lack).
   Dispatch every line: keep (export + commit) or drop. Repeat until both devs'
   status runs are clean or consist only of understood runtime rows.
4. **Merge to main.** Both devs `git pull` (hook imports; markers get set).
5. **CI secrets + rehearsal.** Add `PROD_DATABASE_URL` + `RENDER_DEPLOY_HOOK_URL`
   repo secrets. Restore the latest prod pg_dump into a scratch DB, point a
   temporary secret at it, run the workflow via *Run workflow* (dispatch), and
   verify: regress green, drift ≈ 0, counts sane, marker written. Then point
   the secret at real prod and dispatch once more — the real first deploy.
6. **Enable the push trigger** (uncomment in deploy-content.yml), **flip
   `CONTENT_READONLY=1`** on Render (uncomment in render.yaml / set in
   dashboard), and **retire the old pipeline**: `git rm` relay-server.mjs,
   content-publish/sync, export-seed, setup-local-db, deploy-content-to-prod,
   content-pull/diff-prod, content-merge-media, db/seed.sql, db/audio-seed.sql,
   their npm scripts, and the relay docs. `backup-prod.mjs`, `db:restore`, and
   the dev-panel export button stay (self-contained-SQL escape hatch).
7. **Docs sweep**: update CLAUDE.md, README, architecture.md, plugin-standard.md
   and the skills to point here.
