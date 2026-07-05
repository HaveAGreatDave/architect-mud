// One-shot data fix: make the Precinct 9 cell door un-hackable (police-only).
//   Run once:  node scripts/lock-cell-hololock.js
//   Restart the server (or hit /world/reload) after — doors are cached at boot.
//
// The cell door was seeded with a difficulty-10 HACKABLE hololock, which let a
// player deck their way out (a jailbreak). Ground policing now happens only on
// the police's terms: this flips the live door's `lock:hololock.canHack` to false
// so no player can bypass it. Release is the guard walking you out (a teleport),
// which never touches the lock — so nobody but the police gets you out.
//
// A data transformation on an existing row (the additive deploy can't touch it),
// so it's a deliberate one-shot per CLAUDE.md.
import { query } from '../server/models/db.js';

const DOOR_ID = 'door_precinct_cell';

const { rows } = await query('SELECT tags FROM doors WHERE id=$1', [DOOR_ID]);
if (!rows.length) {
  console.log(`SKIP  ${DOOR_ID} not found — run scripts/create-jail.js first.`);
  process.exit(0);
}

const tags = rows[0].tags || {};
const lock = tags['lock:hololock'];
if (!lock) {
  console.log(`SKIP  ${DOOR_ID} has no hololock tag; nothing to change.`);
  process.exit(0);
}

lock.canHack = false;
await query('UPDATE doors SET tags=$2::jsonb WHERE id=$1', [DOOR_ID, JSON.stringify(tags)]);
console.log(`✓ ${DOOR_ID} hololock is now un-hackable (canHack=false).`);
console.log('Restart the server (or /world/reload) so the door cache picks it up.');
process.exit(0);
