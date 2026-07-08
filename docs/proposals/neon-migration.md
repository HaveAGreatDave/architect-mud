# Supabase → Neon migration

Goal: move production Postgres from Supabase to Neon, **without removing or
touching Supabase until the final cutover step**. Every phase before that is
additive/parallel — Supabase stays the live production database and nothing
about its config, secrets, or CI role changes until Phase 4.

This is safe to do incrementally because `server/models/db.js` is already
fully host-agnostic: it picks TLS on/off by hostname (`needsSsl`), not by
provider, and everything else (`schema.js`, `restore.js`, the content
importer) just runs SQL over `DATABASE_URL`. No Supabase-specific code exists
anywhere in the app — the migration is entirely a config/infra exercise, not
a code rewrite.

## Current state

- Neon project provisioned (`.neon` — project/org id, git-ignored) with a
  `.env.neon` holding pooled + unpooled connection strings (git-ignored).
- `@neondatabase/serverless` added to `package.json` (unused so far — the
  existing `pg.Pool` in `db.js` already works fine against Neon over the
  pooled connection string; only worth switching to the serverless driver
  later if we want edge/serverless compute, not needed for this migration).
- **Done this session:** `npm run db:schema` and a restore of the committed
  `db/seed.sql` (schema + filtered world content, no player rows) both run
  clean against Neon via `node --env-file=.env.neon <script>`. Verified counts
  (zones 352, items 286, npcs 82, enemies 26, players 0 — matches the seed
  dump's intentional exclusion of player/runtime rows).
- Supabase remains completely untouched: `.env`, `render.yaml`,
  `PROD_DATABASE_URL` secret, and the `deploy-content` workflow all still
  point at Supabase exactly as before.

## Phases

### Phase 1 — Local dev parallel target (low risk, reversible)
Neon is usable as a second local-dev target right now via
`node --env-file=.env.neon <script>` or `DATABASE_URL=<neon-url> npm run dev`,
without touching the tracked `.env` (which still points at local Postgres).
Optional next step: flip `.env` itself to point at Neon so day-to-day dev
runs against it instead of local Postgres — purely a developer convenience,
zero effect on prod. **Not done — ask before changing `.env` defaults.**

### Phase 2 — CI regress stays on ephemeral Postgres (no change needed)
`tests/regress.js` in `deploy-content.yml` already runs against a throwaway
`postgres:16` service container in the Actions runner, not Supabase. Nothing
to migrate here.

### Phase 3 — Rehearsal against Neon as a shadow-prod
Before touching real prod config:
1. `npm run db:backup-prod` → get a fresh Supabase prod dump (schema + all
   data, local file only, never committed).
2. Restore that dump into Neon (`node --env-file=.env.neon server/models/restore.js <dump>`).
3. Point `PROD_DATABASE_URL` at Neon **only inside a manually-triggered CI run**
   (repo environment secret override or a temporary `workflow_dispatch` input),
   and run the `deploy-content` workflow end-to-end against it — regress,
   drift report, import, deployments row. Verify counts/drift look right.
4. This proves Neon can serve as prod without the real Supabase prod secret
   ever being touched.

### Phase 4 — Cutover (the only step that touches Supabase config)
1. Final `npm run db:backup-prod` from Supabase, restore into Neon so Neon
   has the latest player data too.
2. Swap Render's `DATABASE_URL` env var (dashboard, not `render.yaml` — it's
   `sync: false`) to the Neon pooled connection string.
3. Swap the `PROD_DATABASE_URL` GitHub secret to Neon.
4. Redeploy / restart Render, smoke-test (login, move, dev panel export).
5. Only **after** a verification window (a few days of stable prod traffic
   on Neon) — pause or delete the Supabase project. This is the sole
   "remove Supabase" action in the whole plan, deliberately last.

## Open questions for the user
- Timeline: do Phase 1 (flip local `.env`) now, or keep Neon parallel-only
  until Phase 3 rehearsal?
- Who triggers Phase 3's rehearsal CI run (needs a temporary secret override
  in GitHub — repo admin action)?
- Neon plan/tier and branch strategy (e.g. use Neon branching for CI
  rehearsal instead of a shared project) — worth deciding before Phase 3.
