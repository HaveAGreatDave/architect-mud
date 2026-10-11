// One-shot: start the CPhL's eight-club league on a fresh season.
//
// The standings are folded from the schedule with whatever clubs the league has now
// (plugins/sportsleague, broadcast.computeStandings), so after the eight-club roster
// deploys, the season in progress is recomputed as if these eight had played it all
// along. That works and needs nothing. Two reasons you might run this anyway:
//
//   - the Coldwater Cup final is already seeded: its finalists are clubs that no longer
//     exist, and the final would put two of them on the ice;
//   - you'd rather the new league start at 0-0 than inherit a recomputed half-season.
//
// It closes the current hockey season with no champion (the champions history lists
// only seasons with one), and the sportsleague tick opens the next season at the slot
// it next runs in. Baseball is not touched.
//
// Dry run by default; it changes nothing without --apply.
//
//   node --env-file=.env.prod scripts/cphl-new-league-season.mjs           show what it would do
//   node --env-file=.env.prod scripts/cphl-new-league-season.mjs --apply   close the season
//
// A running server caches the season row, so run it just before the deploy that restarts
// the server, or restart the server after.
import pool, { query } from '../server/models/db.js';

const apply = process.argv.includes('--apply');
try {
  const { rows } = await query(
    `SELECT season_no, phase, start_slot, finalist_a, finalist_b, ws_slot FROM sports_season
      WHERE sport = 'hockey' AND phase <> 'complete' ORDER BY season_no DESC LIMIT 1`,
  );
  const s = rows[0];
  if (!s) {
    console.log('No open hockey season. The next sportsleague tick opens one; nothing to do.');
  } else {
    console.log(`Hockey season ${s.season_no}: phase ${s.phase}, from slot ${s.start_slot}` +
      (s.phase === 'worldseries' ? `, Cup final ${s.finalist_a} vs ${s.finalist_b} at slot ${s.ws_slot}` : ''));
    if (!apply) {
      console.log('Dry run. With --apply this season closes with no champion and the next opens on the next tick.');
    } else {
      await query(
        `UPDATE sports_season SET phase = 'complete', decided_at = NOW()
          WHERE sport = 'hockey' AND season_no = $1 AND phase <> 'complete'`,
        [s.season_no],
      );
      console.log(`Closed hockey season ${s.season_no}. Restart the server (or deploy) so it reads the new season.`);
    }
  }
} finally {
  await pool?.end?.();
}
