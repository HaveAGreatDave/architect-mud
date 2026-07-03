// One-shot: normalize locked-yet-open doors. A door stored as
// lock_state='locked' AND is_open=1 is an inconsistent state — a locked door
// that reads as standing open. The move gate blocks on lock_state so it's
// harmless in play, but it's wrong data. A locked door should be shut.
// Run once: node server/models/temp/normalize-locked-open-doors.js
import { query } from '../db.js';

const { rows } = await query(
  "SELECT id, zone_id, exit_dir FROM doors WHERE lock_state='locked' AND is_open=1"
);
if (!rows.length) {
  console.log('No locked-yet-open doors. Nothing to do.');
  process.exit(0);
}
console.log(`Closing ${rows.length} locked-yet-open door(s):`);
for (const r of rows) console.log(`  ${r.id} (${r.zone_id} ${r.exit_dir})`);
await query("UPDATE doors SET is_open=0 WHERE lock_state='locked' AND is_open=1");
console.log('Done.');
process.exit(0);
