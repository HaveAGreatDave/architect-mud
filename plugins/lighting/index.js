/**
 * Lighting plugin — owns the SWITCH/FLIP/TURN specialized actions for switchable
 * light furniture (the `switch` interaction tag). Handlers delegate to the engine
 * logic (cmdSwitch/cmdTurn), which resolves the named light, checks power, and
 * recomputes zone lighting. `switch`/`flip` toggle or take an on/off direction;
 * `turn` requires a direction (turn on/off <light>).
 */
import { cmdSwitch, cmdTurn } from '../../server/engine/commands/world.js';

const doSwitch = (args, raw, player, broadcast) => cmdSwitch(args.join(' '), player, broadcast);
const doTurn = (args, raw, player, broadcast) => cmdTurn(args, player, broadcast);

export const specializedActions = [
  { verb: 'switch', requiredTag: 'switch', handler: doSwitch },
  { verb: 'flip',   requiredTag: 'switch', handler: doSwitch },
  { verb: 'turn',   requiredTag: 'switch', handler: doTurn },
];
