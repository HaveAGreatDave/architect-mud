// One-shot: hand Deadball's Tuesday and Thursday evenings to Cluster Puck.
//
// The CPhL broadcast, its title graphic and its playlist row are all NEW rows, so the
// additive CODEX deploy ships them on a normal push. This is the one thing it can't do:
// Deadball's existing playlist row has to STOP claiming those two nights, or the 18:00
// window has two shows in it and whichever the scheduler reaches first wins the slot.
// `INSERT … ON CONFLICT DO NOTHING` never touches an existing row, so this runs by hand
// once per database — that's exactly the data-transformation case CLAUDE.md reserves
// one-shots for.
//
// Day mask: bit 0 = Mon … bit 6 = Sun.
//   95 = Mon Tue Wed Thu Fri · Sun   (Saturday already belongs to The Open Signal)
//   85 = Mon     Wed     Fri · Sun   (Tue + Thu = 10 go to the CPhL)
//
//   local: node scripts/cluster-puck-schedule.mjs
//   prod : node --env-file=.env.prod scripts/cluster-puck-schedule.mjs
//
// Idempotent: re-running finds the row already at 85 and does nothing.
import { query } from '../server/models/db.js';

const DEADBALL_PLAYLIST_ID = 'ksab-16-1800-95';
const OLD_DAYS = 95;
const NEW_DAYS = 85;

const dayNames = (mask) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  .filter((_, i) => mask & (1 << i)).join(' ');

const { rows } = await query(
  `SELECT id, days, start_time FROM media_channel_playlist WHERE id = $1`,
  [DEADBALL_PLAYLIST_ID],
);

if (!rows.length) {
  console.log(`· No row ${DEADBALL_PLAYLIST_ID} in this database — nothing to do.`);
} else if (Number(rows[0].days) === NEW_DAYS) {
  console.log(`· Already split: Deadball airs ${dayNames(NEW_DAYS)}. Nothing to do.`);
} else if (Number(rows[0].days) !== OLD_DAYS) {
  console.error(`✗ Refusing to touch it: expected days=${OLD_DAYS}, found ${rows[0].days}.`);
  console.error(`  Someone has rescheduled Deadball since this was written — re-derive the`);
  console.error(`  split by hand rather than letting this stamp over their change.`);
  process.exitCode = 1;
} else {
  await query(`UPDATE media_channel_playlist SET days = $1 WHERE id = $2`, [NEW_DAYS, DEADBALL_PLAYLIST_ID]);
  console.log(`✓ Deadball 18:00 → ${dayNames(NEW_DAYS)}  (was ${dayNames(OLD_DAYS)})`);
  console.log(`  Cluster Puck now has ${dayNames(10)} on KSAB-TV.`);
}

const { rows: cp } = await query(
  `SELECT id, days FROM media_channel_playlist WHERE broadcast_id = 'bc_cluster_puck'`,
).catch(() => ({ rows: [] }));
if (!cp.length) {
  console.log(`\n! No Cluster Puck playlist row here yet — run \`npm run content:import\` (local)`);
  console.log(`  or wait for the deploy (prod), or the 18:00 Tue/Thu window will simply be empty.`);
}
process.exit(0);
