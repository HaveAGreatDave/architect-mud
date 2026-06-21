import { handlers as moveHandlers } from './movement.js';
import { handlers as combatHandlers } from './combat.js';
import { handlers as invHandlers } from './inventory.js';
import { handlers as socialHandlers } from './social.js';
import { handlers as economyHandlers } from './economy.js';
import { handlers as housingHandlers } from './housing.js';
import { handlers as worldHandlers } from './world.js';
import { fireCommand } from '../plugins.js';

export { describeZone, describeVoidTeleport } from './describe.js';
export { recomputeArmor, EQUIP_SLOTS } from './inventory.js';
export { resolveAttack } from './combat.js';

const builtins = new Map([
  ...Object.entries(moveHandlers),
  ...Object.entries(combatHandlers),
  ...Object.entries(invHandlers),
  ...Object.entries(socialHandlers),
  ...Object.entries(economyHandlers),
  ...Object.entries(housingHandlers),
  ...Object.entries(worldHandlers),
]);

export async function handleCommand(input, player, broadcast) {
  const raw = input.trim();
  if (!raw) return null;
  const parts = raw.toLowerCase().split(/\s+/);
  const cmd = parts[0];
  const args = parts.slice(1);

  if (player.sleeping && cmd !== 'sleep' && cmd !== 'rest') {
    player.sleeping = null;
    const result = await handleCommand(input, player, broadcast);
    if (result) result.message = `You wake up.\n\n${result.message}`;
    return result;
  }

  const pluginResult = await fireCommand(cmd, args, raw, player, broadcast);
  if (pluginResult !== undefined) return pluginResult;

  const handler = builtins.get(cmd);
  if (handler) return handler(args, raw, player, broadcast);
  return { type:'error', message:`Unknown command: "${cmd}". Type HELP for commands.` };
}
