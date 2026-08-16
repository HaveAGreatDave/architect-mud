/**
 * One-shot: migrate live player_backups rows onto the pattern model.
 *
 * WHY THIS CANNOT RIDE THE CODEX DEPLOY. The content pipeline rewrites rows in
 * tables it OWNS, and `player_backups` is runtime state — no file describes it,
 * so the import never touches it. The new value also cannot be derived from any
 * file: it comes from a column that already exists on rows only prod has.
 *
 * TWO HALVES, and the second is the load-bearing one:
 *
 *   1. Drop the dead weight. `snapshot.inventory` (and the older `credits` key)
 *      are no longer read by anything. Harmless if left, but they are a fossil
 *      of exactly the exploit this release removed, and somebody will find them
 *      in a year and wonder whether they still fire.
 *
 *   2. ⚠ BACKFILL `pattern_at`. The restore gate moved off `snapshot` and onto
 *      this column. Without the backfill, every player who has already paid for
 *      a policy AND taken a scan silently stops being covered until they walk
 *      back to the Registry — with no message telling them so, because from the
 *      code's point of view they simply never scanned. `saved_at` is the honest
 *      value: it is when that scan was taken.
 *
 * `copy_fidelity` needs no backfill — the column defaults to 100, which is the
 * no-op, and 100 is the correct starting fidelity for a body that has never been
 * re-printed.
 *
 * Converging and safe to re-run: the WHERE clauses match nothing on a second
 * pass, and neither half overwrites a value the game has since written.
 *
 *   local: node scripts/backfill-cortical-pattern.mjs
 *   prod:  node --env-file=.env.prod scripts/backfill-cortical-pattern.mjs
 */
import { query } from '../server/models/db.js';

const cleaned = await query(
  `UPDATE player_backups
      SET snapshot = (snapshot - 'inventory' - 'credits')
    WHERE snapshot IS NOT NULL AND (snapshot ? 'inventory' OR snapshot ? 'credits')`,
);

// Only rows that actually carry a scan. A row created by `assurance buy` alone
// has no pattern on it and must stay ungated — buying a policy is not scanning.
const gated = await query(
  `UPDATE player_backups
      SET pattern_at = saved_at
    WHERE pattern_at IS NULL AND saved_at IS NOT NULL AND snapshot IS NOT NULL`,
);

const { rows } = await query(
  `SELECT COUNT(*)::int AS total,
          COUNT(pattern_at)::int AS with_pattern,
          COALESCE(SUM(restores_remaining), 0)::int AS restores
     FROM player_backups`,
);

console.log(`✓ snapshots pruned:      ${cleaned.rowCount}`);
console.log(`✓ pattern_at backfilled: ${gated.rowCount}`);
console.log(`  ${rows[0].total} backup row(s), ${rows[0].with_pattern} with a pattern, ${rows[0].restores} restore(s) on account.`);
process.exit(0);
