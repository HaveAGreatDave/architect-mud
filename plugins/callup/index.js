// CALL IT UP: `callup [vehicle]` brings one of yours out onto the depot floor you're standing on, and
// `callup back` sends it away again (docs/reference/depot-shell.md, "Call it up").
//
// The verb only. What a bay is, what's kept in it and how you climb in belong to each vehicle's plugin, which
// registers its kind with server/engine/vehicle-stand.js; the stand itself is RAM in that module. In a truck
// shed this is the same as `hoist`.
import { callUp } from '../../server/engine/vehicle-stand.js';

export const commands = {
  callup: (args, raw, player) => callUp(player, args || []),
};
