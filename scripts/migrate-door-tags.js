// One-shot migration: populate tags + lock_state on existing doors from legacy columns.
// Run once: node scripts/migrate-door-tags.js
import { query } from '../server/models/db.js';

const DEFAULT_HOLOLOCK = (difficulty) => ({
  type: 'lock:hololock',
  difficulty,
  canHack: true,
  requiresItem: false,
  permissions: { ownerId: null, authorizedUsers: [] },
  messages: {
    lock: 'The hololock hums as it engages.',
    unlock: 'The hololock disengages with a soft click.',
    hackSuccess: "You bypass the hololock's security matrix.",
    hackFail: 'The hololock resists your intrusion.'
  },
  handlers: {
    onLock: 'default_lock_handler',
    onUnlock: 'default_unlock_handler',
    onHack: 'default_hack_handler'
  }
});

const { rows: doors } = await query('SELECT * FROM doors');
let migrated = 0;

for (const door of doors) {
  // Skip if already migrated
  if (door.tags && Array.isArray(door.tags) && door.tags.length > 0) continue;
  if (door.lock_state !== null) continue;

  let tags = [];
  let lock_state = null;

  if (door.door_type !== 'shoddy') {
    const difficulty = door.hololock_difficulty ?? 5;
    tags = [DEFAULT_HOLOLOCK(difficulty)];
    lock_state = door.is_locked ? 'locked' : 'unlocked';
  }

  await query(
    'UPDATE doors SET tags=$1, lock_state=$2 WHERE id=$3',
    [JSON.stringify(tags), lock_state, door.id]
  );
  migrated++;
  console.log(`  ${door.id} (${door.door_type}) → tags:${tags.length} lock_state:${lock_state}`);
}

console.log(`\nDone. Migrated ${migrated}/${doors.length} doors.`);
process.exit(0);
