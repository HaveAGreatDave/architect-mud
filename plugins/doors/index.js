/**
 * Doors plugin — registers OPEN/CLOSE/LOCK/UNLOCK as specialized actions for
 * doors, replacing the old hard-coded door pre-intercept in commands/index.js.
 * The handlers (in engine/commands/doors.js) self-gate: they only act when the
 * target is a door ("open door north"), and otherwise return undefined so the
 * dispatcher falls through to containers, housing, and the built-ins.
 */
import { handlers as doorHandlers } from '../../server/engine/commands/doors.js';

export const specializedActions = [
  { verb: 'open',   handler: doorHandlers.open },
  { verb: 'close',  handler: doorHandlers.close },
  { verb: 'lock',   requiredTag: 'lockable', handler: doorHandlers.lock },
  { verb: 'unlock', requiredTag: 'lockable', handler: doorHandlers.unlock },
];
