import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import pg from 'pg';

// dotenv only loads a .env from the current working directory. The .env is
// git-ignored, so a git worktree (which git populates with tracked files only)
// never receives one — leaving DATABASE_URL undefined and pg falling back to
// localhost:5432. Worktrees live under the repo root (.claude/worktrees/<name>),
// so walk up from cwd to the nearest .env and load that. Falls back to dotenv's
// default lookup when none is found.
function findEnvFile(start) {
  let dir = start;
  for (;;) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
const envPath = findEnvFile(process.cwd());
dotenv.config(envPath ? { path: envPath } : undefined);
const { Pool } = pg;

// SSL is decided by the HOST, not NODE_ENV: a remote DB (the Neon endpoint) requires
// TLS; a local Postgres doesn't do it. Keying off NODE_ENV was a footgun — running a
// one-shot against prod (`node --env-file=.env.prod scripts/x.mjs`) left NODE_ENV as
// 'development' and silently disabled the TLS Supabase demands. Host-based detection
// makes any script Just Work against prod via --env-file, and the reusable prod
// one-shot pattern needs no NODE_ENV juggling.
function needsSsl(url) {
  if (!url) return false; // no URL → pg defaults to localhost (no TLS)
  try {
    return !/^(localhost|127\.0\.0\.1|::1)$/.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

// Single connection pool, reused across all requests
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: needsSsl(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : false,
  // Max simultaneous connections this process holds. Prod is Neon (the old
  // Supabase-pooler cap that forced 5 is gone): even Neon's smallest compute
  // allows ~112 connections, so 10 gives the game server real headroom — every
  // query() is its own checkout, and at 5 the aligned minute-boundary tick
  // convoys could hold all slots while a player's move waited on pool.connect().
  // Override per-process with DB_POOL_MAX — e.g. run scripts with DB_POOL_MAX=1
  // so one-offs never compete with the server for slots.
  max: parseInt(process.env.DB_POOL_MAX, 10) || 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('DB pool error:', err.message);
});

// Pin search_path on every new connection. Neon's pooler endpoint has handed out
// sessions with an EMPTY search_path, under which no unqualified table name
// resolves — every query fails "relation ... does not exist" against tables that
// plainly exist (this took /api/audio/* down in prod on 2026-07-19; the direct
// endpoint was unaffected, so the server default can't be relied on). This fires
// once per new physical connection, not per query, so it costs nothing on the hot
// path. It has to be a SET rather than the `options` startup parameter — the
// pooler rejects that outright with "unsupported startup parameter in options".
pool.on('connect', (client) => {
  client.query('SET search_path TO public').catch(() => { /* surfaces on the caller's own query */ });
});

// Run a query. Automatically acquires + releases a connection.
export async function query(text, params) {
  const client = await pool.connect();
  try {
    const res = await client.query(text, params);
    return res;
  } finally {
    client.release();
  }
}

// Log a server activity event. Caps the table at ~500 rows.
//
// The prune used to run on EVERY log line, which meant two round trips per event
// and a full sort of the table inside a NOT IN for the second one. The cap is a
// housekeeping nicety, not an invariant anything reads, so it now fires roughly
// one time in twenty: the table drifts to at most ~520 rows instead of exactly
// 500, and the common path is a single INSERT.
const PRUNE_ODDS = 0.05;
export async function logActivity(eventType, handle, adminHandle = null, detail = null) {
  query(
    `INSERT INTO server_activity_log (event_type, handle, admin_handle, detail) VALUES ($1, $2, $3, $4)`,
    [eventType, handle, adminHandle, detail]
  ).then(() => {
    if (Math.random() >= PRUNE_ODDS) return;
    // Anti-joining against the keep-set beats NOT IN (SELECT …): the planner can
    // hash the 500-row window once instead of re-checking membership per row,
    // and NOT IN would swallow the whole delete if any id were ever NULL.
    return query(
      `DELETE FROM server_activity_log a
        WHERE NOT EXISTS (
          SELECT 1 FROM (
            SELECT id FROM server_activity_log ORDER BY occurred_at DESC LIMIT 500
          ) keep WHERE keep.id = a.id
        )`
    );
  }).catch(() => {});
}

// For transactions
export async function getClient() {
  return pool.connect();
}

// Run fn inside a single DB transaction. fn receives a `q(text, params)` runner
// bound to the transaction's client — pass it anywhere a `query`-shaped executor
// is accepted (e.g. adjustCredits/transferCredits) so several writes commit as
// one atomic unit. Commits if fn resolves, rolls back if it throws (the error
// then propagates). Returning a value from fn (including a falsy "nothing
// happened" result) commits normally.
export async function withTransaction(fn) {
  const client = await pool.connect();
  const q = (text, params) => client.query(text, params);
  try {
    await client.query('BEGIN');
    const result = await fn(q);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection already broken */ }
    throw err;
  } finally {
    client.release();
  }
}

export default pool;
