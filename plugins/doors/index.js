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
import { world, getApartment, getZone, setDoorCache } from '../../server/engine/world.js';
import { exitTargets } from '../../server/engine/exits.js';
import { playerControlsApt } from '../../server/engine/apartments.js';
import { schedule } from '../../server/engine/scheduler.js';
import { sendToZone } from '../../server/engine/messaging.js';
import { getReputation } from '../../server/engine/ideologies.js';
import { getFlagById } from '../../server/engine/flags.js';

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
    // A door may be anchored on either side of the exit (see doorFarIds in
    // apartments.js) — check the apartment whichever side it's on.
    const farIds = door.target_zone ? [door.target_zone] : exitTargets(getZone(door.zone_id), door.exit_dir);
    for (const zid of [door.zone_id, ...farIds]) {
      const apt = getApartment(zid);
      if (apt && playerControlsApt(player, apt)) return true;
    }
    return false;
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

// The Long Watch bunker blast door — opens only for members the Watch trusts.
// The gate is LIVE reputation, not a one-way flag: earn 'trusted' standing through
// the vetting arc and the door knows you; betray the Watch and your rep falls back
// below the line and it stops. Reuses the exact player_ideology_rep read the ATM
// network gate runs (plugins/atm). Not hackable and the door is marked unbreakable
// in content — there is no lockpick or bash path in, by design.
const LW_TRUSTED_REP = 500;   // the 'trusted' tier floor (server/engine/ideologies.js)
registerLockType('longwatch', {
  tagType: 'lock:longwatch',
  kitTag:  'lockkit:longwatch',
  defaults: {
    canHack: false,
    messages: {
      lock:   'The blast door seats itself with a pneumatic sigh.',
      unlock: 'The blast door unseals and swings inward.',
      denied: 'The blast door does not know you. It does not move.',
    },
  },
  authFn: async (lockTag, door, player) => {
    // getReputation, not a raw SELECT — standing decays, and this gate has to
    // read the same number the ideology app shows or the door and the sheet
    // disagree (see systems-ideologies.md).
    const need = Number(lockTag.minRep) > 0 ? Number(lockTag.minRep) : LW_TRUSTED_REP;
    if ((await getReputation(player.id, 'ideology_long_watch')) < need) return false;
    // Compartmentalization: the inner doors of the bunker ask for a specific
    // flag on top of standing, so "trusted enough to sit by the stove" and
    // "trusted enough to see the operation" are two different answers. Rep
    // alone still opens the outer blast door — a tag with no requireFlag
    // behaves exactly as before.
    if (lockTag.requireFlag && !(await getFlagById(player.id, lockTag.requireFlag))) return false;
    return true;
  },
});

// Privacy lock — a simple bathroom-stall bolt. Anyone standing on the door's
// `privacySide` (the bathroom side, auto-detected at placement or set via the
// zone editor's lock-side switch) can lock AND unlock it; the other side is
// simply shut out while it's occupied. It's a manual bolt, so the door won't
// open for anyone while it's shut (passWhileLocked:false) — you slide it open to
// leave, which means you can't lock it behind you from the far side. Not
// hackable — bashing the door is the only forced entry, and the 10-minute
// auto-unlock sweep frees anyone who nodded off in a public stall.
registerLockType('privacylock', {
  tagType: 'lock:privacylock',
  kitTag:  'lockkit:privacylock',
  passWhileLocked: false,
  defaults: {
    messages: {
      lock:   'You slide the privacy bolt shut.',
      unlock: 'You slide the privacy bolt open.',
      denied: 'The privacy bolt only works from the other side.',
    },
  },
  authFn: async (lockTag, door, player) => player.current_zone === lockTag.privacySide,
});

// Every 10 minutes, spring every engaged privacy lock — a courtesy release so a
// player who fell asleep on the toilet doesn't seal a public bathroom forever.
schedule('10m', () => {
  // Door lock state lives only in world.doors (never persisted) — sweep the live
  // cache, not the DB, or engaged privacy bolts would be invisible here.
  for (const door of world.doors.values()) {
    if (door.lock_state !== 'locked' || !door.tags?.['lock:privacylock']) continue;
    door.lock_state = 'unlocked';
    setDoorCache(door.id, door);
    for (const zid of [door.zone_id, door.target_zone].filter(Boolean)) {
      sendToZone(zid, { type: 'zone_event', message: 'The privacy bolt clicks open on its timer.', refresh: true });
    }
  }
});

export const specializedActions = [
  { verb: 'open',      handler: doorHandlers.open },
  { verb: 'close',     handler: doorHandlers.close },
  { verb: 'lock',      requiredTag: 'lockable', handler: doorHandlers.lock },
  { verb: 'unlock',    requiredTag: 'lockable', handler: doorHandlers.unlock },
  { verb: 'hack',      handler: doorHandlers.hack },
  { verb: 'install',   handler: doorHandlers.install },
  { verb: 'uninstall', handler: doorHandlers.uninstall },
];

export const commands = {
  hackresolve: doorHandlers.hackresolve,
};
