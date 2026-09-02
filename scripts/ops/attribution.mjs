// Attribution — the half of the report that says WHAT TO CHANGE.
//
// A percentage does not tell you what to do. The August 2026 overrun is on
// record with an exact shape:
//
//   "egress is `boot payload × world loads per day`. The July work cut the
//    second factor; NOTHING WAS WATCHING THE FIRST, and the deploy workflow's
//    header still said ~4.7MB months after it was ~30MB."
//
// So this module measures both factors directly and multiplies them, giving a
// modelled egress figure to sit beside the one Neon reports.
//
// THE DIVERGENCE IS THE POINT. If model ≈ API, the world boot is the budget and
// the lever is the payload. If the API is much higher, something OTHER than boot
// is leaking and the payload is a red herring — which is a finding you cannot
// get from either number alone. That is why this is not just a payload printout.
//
// Cost of running it: three aggregate queries, a few KB of result. It reads
// prod, so it does spend from the budget it measures — but at ~0.001% of the
// 5 GB cycle it is not a factor. `--no-db` skips it entirely.
// ⚠ THIS MUST READ PRODUCTION, AND IT WILL NOT DO SO BY ACCIDENT.
// server/models/db.js connects to DATABASE_URL, which in a developer's .env is
// the LOCAL database. Reading that answers a question nobody asked: the local
// world drifts from prod (memory: "Local dev DB drift"), and its
// player_count_log is empty, so world-loads/day silently comes back null and
// the whole attribution model evaporates without an error. So this module owns
// its own pool, pointed at PROD_DATABASE_URL, and says loudly when it has had
// to fall back.
import pg from 'pg';
import { REGISTRY } from '../../server/models/content-registry.js';

let pool = null;
export const connection = { target: null, note: null };

function getPool() {
  if (pool) return pool;
  const url = process.env.PROD_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('neither PROD_DATABASE_URL nor DATABASE_URL is set');
  if (!process.env.PROD_DATABASE_URL) {
    connection.note = 'PROD_DATABASE_URL not set — attribution read the LOCAL database, so boot payload and world-loads describe your dev world, not production';
  }
  const parsed = new URL(url);
  connection.target = parsed.hostname;
  // Same host-based TLS rule as db.js: remote ⇒ TLS, localhost ⇒ none.
  const remote = !/^(localhost|127\.0\.0\.1|::1)$/.test(connection.target);
  // Drop sslmode from the URL: we set `ssl` explicitly below, and leaving both
  // in makes pg emit a multi-paragraph deprecation warning on every run that
  // buries the report's actual notes.
  parsed.searchParams.delete('sslmode');
  pool = new pg.Pool({
    connectionString: parsed.toString(),
    ssl: remote ? { rejectUnauthorized: false } : false,
    max: 1, // a reporter needs one connection; never compete with the game server
  });
  return pool;
}

async function query(text, params) {
  return getPool().query(text, params);
}

/** Release the reporter's own connection. Safe to call when never opened. */
export async function closeAttribution() {
  if (pool) { await pool.end(); pool = null; }
}

/**
 * Content tables a cold start pulls OUT OF NEON: `readTier: 'boot'` minus the ones
 * whose loader reads the checkout instead (`bootSource: 'files'`).
 *
 * ⚠ The subtraction is the point, and leaving it out is how this measured the
 * wrong thing for months. `readTier` says "in memory at boot", not "fetched from
 * the DB at boot" — the six audio tables are both, and in production they are
 * loaded off disk. Summing them anyway put 14.2MB of untouchable audio at the top
 * of a report whose one job is naming the next thing to trim, 11.5MB of it the
 * audio_samples.data blob, which no boot read has ever selected in any
 * environment. Model minus reality is not a rounding error here: it was about
 * half the modelled payload, and it lands on the model-vs-API divergence this
 * whole module exists to make readable.
 */
export function bootTables() {
  return REGISTRY
    .filter((e) => e.class === 'content' && e.readTier === 'boot' && e.bootSource !== 'files')
    .map((e) => ({ table: e.table, where: e.where || null }));
}

/** Boot-tier tables deliberately left out of the payload, for the report to name. */
export function bootTablesOffDb() {
  return REGISTRY
    .filter((e) => e.class === 'content' && e.readTier === 'boot' && e.bootSource === 'files')
    .map((e) => e.table);
}

/**
 * Total on-the-wire size of everything a cold start loads.
 *
 * ONE query, not one per table: the read-tier rules forbid querying in a loop,
 * and ~45 boot tables would otherwise be 45 remote round trips against the very
 * budget this is measuring. pg_column_size(t.*) approximates wire size closely
 * enough for a trend — we care about 15MB → 30MB, not about ±3%.
 */
export async function bootPayload() {
  const tables = bootTables();
  const parts = tables.map(({ table, where }) =>
    `SELECT '${table}' AS table_name, COALESCE(SUM(pg_column_size(t.*)), 0)::bigint AS bytes, COUNT(*)::bigint AS rows
       FROM ${table} t${where ? ` WHERE ${where}` : ''}`);
  const { rows } = await query(`${parts.join('\nUNION ALL\n')}\nORDER BY bytes DESC`);
  const total = rows.reduce((a, r) => a + Number(r.bytes), 0);
  return {
    totalBytes: total,
    tables: rows.map((r) => ({ table: r.table_name, bytes: Number(r.bytes), rows: Number(r.rows) })),
  };
}

/**
 * World loads per day, inferred from gaps in player_count_log.
 *
 * The log samples once a minute while the server is up, so a gap is the server
 * being down — a Render spin-down or a deploy reboot — and the far side of every
 * gap is a cold start that re-read the whole boot payload. This is the technique
 * the August incident used to land on "~7.5/day".
 *
 * GAP_MIN is 3, not 1: a single missed minute is a slow tick or a GC pause, not
 * a reboot, and counting those would inflate the load count by an order of
 * magnitude and make the model useless.
 */
export async function worldLoadsPerDay({ days = 7 } = {}) {
  const GAP_MIN = 3;
  const { rows } = await query(
    `WITH samples AS (
       SELECT recorded_at,
              LAG(recorded_at) OVER (ORDER BY recorded_at) AS prev
         FROM player_count_log
        WHERE recorded_at > NOW() - ($1 || ' days')::interval
     )
     SELECT COUNT(*)::int AS gaps,
            MIN(recorded_at) AS first_sample,
            MAX(recorded_at) AS last_sample
       FROM samples
      WHERE prev IS NOT NULL
        AND recorded_at - prev > ($2 || ' minutes')::interval`,
    [String(days), String(GAP_MIN)],
  );
  const { rows: span } = await query(
    `SELECT MIN(recorded_at) AS first_sample, MAX(recorded_at) AS last_sample
       FROM player_count_log WHERE recorded_at > NOW() - ($1 || ' days')::interval`,
    [String(days)],
  );

  const first = span[0]?.first_sample ? new Date(span[0].first_sample) : null;
  const last = span[0]?.last_sample ? new Date(span[0].last_sample) : null;
  const observedDays = first && last ? Math.max((last - first) / 86_400_000, 0.5) : null;
  const gaps = rows[0]?.gaps ?? 0;

  return {
    gaps,
    observedDays,
    // Each gap ends in a cold start, plus the one currently running.
    loadsPerDay: observedDays ? (gaps + 1) / observedDays : null,
  };
}

/**
 * Storage trend from the table the server already keeps.
 *
 * server/usage-log.js has been snapshotting pg_database_size + the top 20 tables
 * roughly daily since it shipped. Re-deriving that here would be a second copy
 * of a number that already exists, so this just reads it — and it gives real
 * history from before this report existed.
 *
 * ⚠ db_bytes is pg_database_size, NOT Neon's synthetic_storage_size (which is
 * what the 0.5 GB plan limit counts). Use it for the SHAPE of the trend, never
 * as the quota figure.
 */
export async function storageTrend({ days = 30 } = {}) {
  const { rows } = await query(
    `SELECT captured_at, db_bytes, top_tables
       FROM neon_usage_log
      WHERE captured_at > NOW() - ($1 || ' days')::interval
      ORDER BY captured_at ASC`,
    [String(days)],
  );
  if (!rows.length) return { samples: 0 };
  const first = rows[0];
  const last = rows[rows.length - 1];
  const spanDays = (new Date(last.captured_at) - new Date(first.captured_at)) / 86_400_000;
  return {
    samples: rows.length,
    firstAt: new Date(first.captured_at),
    lastAt: new Date(last.captured_at),
    firstBytes: Number(first.db_bytes),
    lastBytes: Number(last.db_bytes),
    bytesPerDay: spanDays > 0.5 ? (Number(last.db_bytes) - Number(first.db_bytes)) / spanDays : null,
    topTables: (last.top_tables || []).slice(0, 5).map((t) => ({ table: t.table, bytes: Number(t.bytes) })),
  };
}

/**
 * Everything above, plus the modelled egress the divergence check compares.
 *
 * ⚠ `coldStartsPerDay` (from Render's CPU timeline) is preferred over this
 * module's own player_count_log figure whenever it is available, and the
 * difference is not small — measured 2026-09-01, Render said 13.4/day and
 * player_count_log said 6.8. The log is written by `schedule('1m', …)` in
 * server/api/routes.js, and scheduler.js idle-gates every callback by default,
 * so the log simply STOPS when nobody is online: its gaps mean "down OR empty",
 * and an idle stretch either side of a restart merges into one gap. It therefore
 * undercounts, which for a budget alarm is the dangerous direction. Render's
 * timeline is the platform's own record of when the instance was running and
 * does not depend on the game server having booted at all.
 */
export async function collectAttribution({ days = 7, coldStartsPerDay = null } = {}) {
  const [payload, loads, storage] = await Promise.all([
    bootPayload(),
    worldLoadsPerDay({ days }),
    storageTrend(),
  ]);
  const usePerDay = coldStartsPerDay ?? loads.loadsPerDay;
  const resolved = {
    ...loads,
    loadsPerDay: usePerDay,
    source: coldStartsPerDay !== null ? 'Render CPU timeline' : 'player_count_log gaps (undercounts — see note)',
    fallbackComparison: coldStartsPerDay !== null ? loads.loadsPerDay : null,
  };
  const modelledEgressPerDay = usePerDay !== null ? payload.totalBytes * usePerDay : null;
  return { payload, loads: resolved, storage, modelledEgressPerDay };
}
