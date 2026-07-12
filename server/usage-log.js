/**
 * Neon usage logger — snapshots total DB size + the biggest tables into
 * neon_usage_log so we get a usage trend line the Neon console won't retain on
 * the free plan.
 *
 * Free-tier-friendly by design: it only ever writes while players are online,
 * which means the compute is already awake for the game — logging never wakes a
 * suspended compute just to record a data point. During genuinely empty stretches
 * (when scale-to-zero kicks in) usage isn't changing anyway, so the gap is fine.
 *
 * Cadence: checks every 30 min, but only takes a new snapshot if the last one is
 * older than SNAPSHOT_INTERVAL_H — so a busy server logs ~daily, not every tick,
 * and the DB row itself is the source of truth (survives reboots correctly).
 * Only runs in production; does nothing in dev.
 */
import { query } from './models/db.js';
import { schedule } from './engine/scheduler.js';
import { hasActivePlayers } from './engine/world.js';

const SNAPSHOT_INTERVAL_H = 20; // ~daily, with slack so reboots don't double-log
const KEEP_ROWS = 400;          // ~13 months of daily snapshots

async function maybeSnapshot() {
  // Never wake a suspended compute just to log. If nobody's online the DB may be
  // scaled to zero; leave it alone.
  if (!hasActivePlayers()) return;

  const { rows } = await query(
    `SELECT captured_at FROM neon_usage_log ORDER BY captured_at DESC LIMIT 1`
  );
  if (rows.length) {
    const ageH = (Date.now() - new Date(rows[0].captured_at).getTime()) / 3_600_000;
    if (ageH < SNAPSHOT_INTERVAL_H) return;
  }

  const { rows: sizeRows } = await query(
    `SELECT pg_database_size(current_database()) AS db_bytes`
  );
  const { rows: tableRows } = await query(
    `SELECT relname AS table, pg_total_relation_size(relid) AS bytes
       FROM pg_catalog.pg_statio_user_tables
      ORDER BY pg_total_relation_size(relid) DESC
      LIMIT 20`
  );

  await query(
    `INSERT INTO neon_usage_log (db_bytes, top_tables) VALUES ($1, $2)`,
    [sizeRows[0].db_bytes, JSON.stringify(tableRows)]
  );
  // Self-prune so the table never grows unbounded.
  await query(
    `DELETE FROM neon_usage_log
      WHERE id NOT IN (SELECT id FROM neon_usage_log ORDER BY captured_at DESC LIMIT ${KEEP_ROWS})`
  );
}

export function startUsageLog() {
  if (process.env.NODE_ENV !== 'production') return;
  schedule('30m', () => maybeSnapshot().catch((e) =>
    console.warn(`Usage-log snapshot error: ${e.message}`)
  ));
  console.log('✓ Neon usage logger started (daily snapshot while players online)');
}
