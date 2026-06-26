import { handlers as moveHandlers } from './movement.js';
import { handlers as combatHandlers } from './combat.js';
import { handlers as invHandlers } from './inventory.js';
import { handlers as socialHandlers } from './social.js';
import { handlers as economyHandlers } from './economy.js';
import { handlers as housingHandlers } from './housing.js';
import { handlers as worldHandlers } from './world.js';
import { handlers as bodilyHandlers } from './bodily.js';
import { handlers as misHandlers, handleJerkOffOn, handleEatOut } from './mis.js';
import { handlers as appearanceHandlers } from './appearance.js';
import { fireCommand } from '../plugins.js';
import { fireSpecializedAction } from '../specializedActions.js';

export { describeZone, describeVoidTeleport } from './describe.js';
export { recomputeArmor, recomputeInsulation, EQUIP_SLOTS } from './inventory.js';
export { resolveAttack } from './combat.js';

// Appearance handlers: `use` returns null when not targeting a cosmetic machine.
// Strip it out here so we can try it as a pre-pass before falling back to inventory.
const { use: appearanceUseHandler, ...appearanceOtherHandlers } = appearanceHandlers;

const builtins = new Map([
  ...Object.entries(moveHandlers),
  ...Object.entries(combatHandlers),
  ...Object.entries(invHandlers),
  ...Object.entries(socialHandlers),
  ...Object.entries(economyHandlers),
  ...Object.entries(housingHandlers),
  ...Object.entries(worldHandlers),
  ...Object.entries(bodilyHandlers),
  ...Object.entries(misHandlers),
  ...Object.entries(appearanceOtherHandlers),
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

  // Multi-word MIS commands
  if (/^jerk\s+off\s+on\b/i.test(raw)) return handleJerkOffOn(args, raw, player, broadcast);
  if (/^eat\s+out\b/i.test(raw)) return handleEatOut(args, raw, player, broadcast);

  const pluginResult = await fireCommand(cmd, args, raw, player, broadcast);
  if (pluginResult !== undefined) return pluginResult;

  // Tag-gated specialized actions (doors, containers, food, weapons, …). Each
  // handler self-resolves its target and returns undefined to fall through to
  // the built-in handler below — keeping every verb playable mid-port.
  const specialResult = await fireSpecializedAction(cmd, args, raw, player, broadcast);
  if (specialResult !== undefined) return specialResult;

  // Cosmetic machine pre-intercepts `use` before inventory gets it
  if (cmd === 'use' && appearanceUseHandler) {
    const appResult = await appearanceUseHandler(args, raw, player, broadcast);
    if (appResult !== null) return appResult;
  }

  const handler = builtins.get(cmd);
  if (handler) return handler(args, raw, player, broadcast);
  return { type:'error', message:`Unknown command: "${cmd}". Type HELP for commands.` };
}
