// One-shot data fix: make the Precinct 9 cell door unbreakable (can't be bashed
// down), matching the already-unhackable hololock.
//   Run once:  node scripts/lock-cell-unbreakable.js
//   Restart the server (or hit /world/reload) after — doors are cached at boot.
//
// Bashing the door (attack door) eventually zeroes its HP, which permanently
// sets lock_state=NULL and is_open=1 with no repair path — a lasting jailbreak
// hole. This flips the live door's `tags.unbreakable` to true so `attack door`
// is rejected outright, same as a quantum forcefield.
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
if (tags.unbreakable) {
  console.log(`SKIP  ${DOOR_ID} is already unbreakable.`);
  process.exit(0);
}

tags.unbreakable = true;
await query('UPDATE doors SET tags=$2::jsonb WHERE id=$1', [DOOR_ID, JSON.stringify(tags)]);
console.log(`✓ ${DOOR_ID} is now unbreakable (tags.unbreakable=true).`);
console.log('Restart the server (or /world/reload) so the door cache picks it up.');
process.exit(0);
