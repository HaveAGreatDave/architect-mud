/**
 * Doors plugin — registers OPEN/CLOSE/LOCK/UNLOCK as specialized actions for
 * doors, replacing the old hard-coded door pre-intercept in commands/index.js.
 * The handlers (in engine/commands/doors.js) self-gate: they only act when the
 * target is a door ("open door north"), and otherwise return undefined so the
 * dispatcher falls through to containers, housing, and the built-ins.
 *
 * Lock types are registered here so adding a new lock type requires no engine
 * edits — drop a registerLockType() call in any plugin.
 */
import { handlers as doorHandlers } from '../../server/engine/commands/doors.js';
import { registerLockType } from '../../server/engine/locks.js';
import { query } from '../../server/models/db.js';

registerLockType('hololock', {
  tagType: 'lock:hololock',
  kitTag:  'lockkit:hololock',
  defaults: {
    difficulty: 5, canHack: true,
    messages: {
      lock:   'The hololock hums as it engages.',
      unlock: 'The hololock disengages with a soft click.',
      denied: 'The hololock does not recognize your credentials.',
    },
  },
  authFn: async (lockTag, door, player) => {
    const { rows } = await query(
      'SELECT 1 FROM apartments WHERE zone_id=$1 AND owner_id=$2',
      [door.zone_id, player.id]
    );
    return rows.length > 0;
  },
});

registerLockType('keycardlock', {
  tagType: 'lock:keycardlock',
  kitTag:  'lockkit:keycardlock',
  defaults: {
    messages: {
      lock:   'The keycard reader beeps twice as the lock engages.',
      unlock: 'The keycard reader flashes green. The lock disengages.',
      denied: 'The keycard reader flashes red. Access denied.',
    },
  },
  authFn: async (lockTag, door, player) => {
    if (!lockTag.keyItemId) return false;
    const { rows } = await query(
      'SELECT 1 FROM player_inventory WHERE player_id=$1 AND item_id=$2 LIMIT 1',
      [player.id, lockTag.keyItemId]
    );
    return rows.length > 0;
  },
});

export const specializedActions = [
  { verb: 'open',      handler: doorHandlers.open },
  { verb: 'close',     handler: doorHandlers.close },
  { verb: 'lock',      requiredTag: 'lockable', handler: doorHandlers.lock },
  { verb: 'unlock',    requiredTag: 'lockable', handler: doorHandlers.unlock },
  { verb: 'install',   handler: doorHandlers.install },
  { verb: 'uninstall', handler: doorHandlers.uninstall },
];
