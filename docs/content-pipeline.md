# Content Pipeline — git as the source of truth for world content

World content (zones, NPCs, items, audio, media, …) lives in git as **one JSON
file per entity** under `content/<table>/<pk>.json`. Databases — yours, Dave's,
production — are build artifacts of those files. Git is the merge engine:
concurrent work on different entities merges automatically; the same entity
becomes an ordinary, visible git conflict instead of a silent overwrite.

> **MIGRATION STATUS — CUTOVER DONE (2026-07-08):** git is now the sole writer
> of world content to production. Prod content is read-only over HTTP
> (`CONTENT_READONLY=1` on Render); a push to `main` runs the `deploy-content`
> CI, which is the only path that mutates prod content. The old seed pipeline
> (db/seed.sql + content:publish/sync) is retired. This pipeline is authoritative
> — the [cutover runbook](#cutover-runbook) below is kept for reference only.
>
> As of 2026-07-11 the pipeline has shipped real content at scale: the 888-zone
> district (see [systems-world.md](systems-world.md#the-district-a-generated-slice-of-map_world))
> deployed additively through a normal push, with the airfield relocation and its
> door/map rewiring handled as reviewable git diffs.

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
  `content/` → **prune old Neon snapshot branches** (keep newest 5) → **Neon
  snapshot branch** `predeploy-<run>-<sha>` (instant copy-on-write, self-expiring
  in 14 days; the catastrophe net — recovery = Neon instant-restore from it) →
  drift report (surfaces any manual prod edits the deploy is about to overwrite)
  → `content:import --prod` → `deployments` row → Render deploy-hook restart
  (fresh world cache).
- The snapshot replaced the old `pg_dump`-to-artifact backup when prod moved to
  Neon. Branches are near-free (data-only, no compute endpoint) but count against
  the project's branch cap — hence the prune step. `expires_at` alone was not
  enough: at any real deploy cadence 14 days of snapshots pile up past the cap
  before any expire, so the deploy actively deletes all but the newest 5 *before*
  taking the new one (its own branch never counts against the keep-5). A prune
  failure is `continue-on-error` — it must never block a deploy.
- Secrets: `PROD_DATABASE_URL` (Neon **direct/unpooled** endpoint, not `-pooler`
  — the import runs one transaction with `SET CONSTRAINTS ALL DEFERRED`, which the
  transaction pooler breaks), `NEON_API_KEY` (creates/prunes snapshot branches;
  project id is read from the committed `.neon` file, not a secret),
  `RENDER_DEPLOY_HOOK_URL` (optional but recommended).
- **Reading live prod state (FKs, drifted rows) during an incident needs explicit
  approval** — the auto-mode classifier blocks direct `PROD_DATABASE_URL` reads
  unless the user has named prod as a read target. Ask first.
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

- **zones.exits / zones.tags** are authored content that runtime systems used
  to wire directly. **Play-time exit wiring now goes through the
  `zone_exit_overrides` runtime table** (merged over authored exits at world
  load — `addExitOverride`/`removeExitOverride` in `server/engine/world.js`),
  so a zone re-deploy can no longer orphan generator utility rooms. Legacy
  wiring written into `zones.exits` before the override table existed keeps
  working (and `removeGenerator` still cleans it up); studio construction is
  dev-panel authoring (blocked on prod by CONTENT_READONLY) and legitimately
  writes authored exits. The CI drift report still surfaces any residual direct
  writes.
- **doors.\*** (is_open, lock_state, tags…) are authored initial state that
  players also mutate; an import touching a door's file resets that door's
  live state. Bounded: only doors whose files changed in the deployed range.
- **Local runtime rows get exported.** Furniture you bought or junk the power
  system built in YOUR local world shows up in `content:export` as new files.
  That's the review step's job: `git diff content/` before committing, drop
  what isn't content. On prod these rows are safe regardless (deletion needs a
  git-tracked file). `content:export` now warns on new files matching the
  runtime id shapes so they're hard to miss.
- **Furniture provenance is a column, not a convention.** `furniture.origin`
  (`'authored'` | `'player'`, CHECK-constrained) plus `owner_id` make furniture
  a **mixed table** like apartments/orgs: the registry scopes it to
  `origin='authored'`, so export never emits player property and the deletion
  pass can never delete it — structurally, not by id-shape luck. Every
  play-time placement writer stamps `origin='player'` (+ the placing player in
  `owner_id`): furniture-shop purchases, planted surveillance devices, hung
  posters, portable generators, corp HQ terminals. `origin`/`owner_id` are
  excludeColumns — files never carry them; imported content lands on the
  `'authored'` default. Backfill for pre-column rows:
  `scripts/backfill-furniture-origin.mjs` (run on prod once, after the push
  that adds the column). Two id-shape guards remain as defense-in-depth
  tripwires for a writer that forgets to stamp origin: export warns-and-skips
  `furn_<8-hex-uuid>` rows, and the import deletion pass refuses to delete
  them. Environment junction-box autobuild rows stay `authored` deliberately —
  their ids are deterministic, so a dev-authored power fix and a prod-side
  self-heal converge on the same row instead of forking.

## Deploy lessons (hard-won 2026-07-08, the first real prod deploys)

The first deploys to exercise the deletion pass against prod surfaced a chain of
issues. All are fixed on main; documented here so they don't get relearned:

- **Content-parent FKs must be `DEFERRABLE` with an ownership-correct `ON DELETE`.**
  The deletion pass removes content rows (zones, furniture, media/audio catalog,
  aircraft/atm/security defs) that child rows still reference. A child FK left at
  the inline-created default (`ON DELETE NO ACTION`, non-deferrable) aborts that
  delete the instant a child exists. `SCHEMA_SQL` re-asserts every content-parent
  FK idempotently (`DROP CONSTRAINT IF EXISTS` + `ADD … DEFERRABLE INITIALLY
  DEFERRED`) with `ON DELETE CASCADE` for **owned** children (a camera lives in its
  zone; a deck unit *is* a furniture row; an audio route/instrument is meaningless
  without its sample) and `ON DELETE SET NULL` for **loose** references (a player's
  aircraft/apartment/spy-device outlives the retired type/zone it pointed at). When
  you add a content table with children, add its swap to that block at the end of
  `SCHEMA_SQL` (after every table exists).
- **`CREATE TABLE IF NOT EXISTS` never alters a *drifted existing* table.** If prod's
  table predates a clause you later added inline (e.g. `ON DELETE SET NULL`), the
  idempotent create won't fix it — you must re-assert via `DROP CONSTRAINT` +
  `ADD CONSTRAINT`. This is why the FK swaps above exist as explicit `ALTER`s.
- **Never write the literal `CREATE TABLE IF NOT EXISTS <word>` inside a SCHEMA_SQL
  comment.** The registry-classification regress test parses that pattern out of
  `SCHEMA_SQL` and will flag a phantom unclassified table. Reword the prose.
- **The additive import cannot reconcile rows that were never git-tracked.** If
  `content/` was seeded from a local DB whose ids diverge from prod's (same logical
  entity, different PK — e.g. the same TV channel under two timestamped ids), the
  id-keyed upsert can't match them and collides on a secondary unique key. The
  git-diff deletion pass won't remove prod's stray row either (no file was ever
  removed). Fix is a deliberate one-shot data transformation — the sanctioned path
  for rows the additive deploy can't touch — deleting prod's non-git rows so git's
  authoritative set lands ("git wins"). Dry-run it first.
- **A `deadlock detected` (`40P01`) mid-import is transient — just retry the deploy.**
  It's the live Render game server mutating content rows while the import holds locks
  on the same rows; a second dispatch with different timing succeeds. Retrying the
  deploy is preferred over pausing the server (no added Neon egress, no Render
  rebuild); a deadlock-retry wrapper around the import transaction is the standing
  fix if it recurs.

## One-off authoring scripts

The `scripts/add-*` / `scripts/seed-*` pattern stays valid: they write your
LOCAL DB, then `content:export` captures the rows as files. Never point them at
prod — content reaches prod through git only.

## Cutover runbook

Executed once, deliberately, with both devs available:

1. **Freeze content edits.** Both devs run the OLD pipeline end-to-end one last
   time (export-seed → content:publish → deploy to prod) so prod ≈ seed ≈
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
   dashboard), and **retire the old pipeline**: `git rm`
   content-publish/sync, export-seed, setup-local-db, deploy-content-to-prod,
   content-pull/diff-prod, content-merge-media, db/seed.sql, db/audio-seed.sql,
   and their npm scripts. `backup-prod.mjs`, `db:restore`, and
   the dev-panel export button stay (self-contained-SQL escape hatch).
7. **Docs sweep**: update CLAUDE.md, README, architecture.md, plugin-standard.md
   and the skills to point here.
