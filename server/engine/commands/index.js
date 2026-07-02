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
import { deactivateForcefield } from '../apartments.js';
import { fireSpecializedAction } from '../specializedActions.js';
import { getSelectionState, advanceSelectionState, formatSelectionPage } from '../sift.js';
import { getLivePlayer } from '../world.js';
import { hasMisEvent, stopMisEvent } from '../mis.js';
import { emit } from '../events.js';

export { describeZone, describeVoidTeleport } from './describe.js';
export { recomputeArmor, recomputeInsulation, EQUIP_SLOTS } from './inventory.js';

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

// Unified STOP: one verb ends every ongoing/recurring action at once — combat,
// MIS (sexual) actions, and following. It overrides the per-system `stop`
// handlers that combat.js and mis.js each register (whichever merged last would
// otherwise win and stop only its own system).
async function cmdStopAll(args, raw, player, broadcast) {
  const stopped = [];

  if (player.combatTargetId || player.pvpTargetId || player.npcCombatTargetId) {
    if (player.pvpTargetId) {
      const opponent = getLivePlayer(player.pvpTargetId);
      if (opponent) {
        opponent.pvpTargetId = null;
        broadcast(null, { type: 'output', message: `${player.handle} disengages. Combat ends.` }, null, opponent.id);
      }
    }
    player.combatTargetId = null;
    player.pvpTargetId = null;
    player.npcCombatTargetId = null;
    // Grace window so enemy/NPC retaliation and aggro don't instantly re-arm our
    // target on the next combat tick — long enough to actually break off and flee.
    player.disengagedUntil = Date.now() + 6000;
    stopped.push('fighting');
  }

  if (hasMisEvent(player.id)) {
    const meta = stopMisEvent(player.id);
    stopped.push(meta?.action ? `${meta.action}ing${meta.target ? ` ${meta.target}` : ''}` : 'what you were doing');
  }

  if (player.following) {
    player.following = null;
    stopped.push('following');
  }

  // Let plugins halt their own repeating actions (e.g. scavenging). Synchronous
  // subscribers push a label onto `stopped` before this returns.
  emit('player.stop', { player, broadcast, stopped });

  if (!stopped.length) return { type: 'output', message: "You aren't doing anything to stop." };
  return { type: 'output', message: `You stop ${stopped.join(', ')}.` };
}

builtins.set('stop', cmdStopAll);
builtins.set('disengage', cmdStopAll);

export async function handleCommand(input, player, broadcast) {
  const raw = input.trim();
  if (!raw) return null;

  // SIFT selection-state intercept — runs before all routing.
  const _sel = getSelectionState(player.id);
  if (_sel) {
    const adv = advanceSelectionState(player.id, raw);
    if (!adv) {
      // State expired — fall through to normal pipeline
    } else if (adv.type === 'cancel') {
      return { type: 'output', message: 'Selection cancelled.' };
    } else if (adv.type === 'page') {
      return { type: 'output', message: formatSelectionPage(adv.state) };
    } else if (adv.type === 'selected') {
      const { verb, dispatchType, dispatchParam } = _sel.context;
      if (dispatchType && dispatchParam) {
        const { dispatchAction } = await import('../actions.js');
        return dispatchAction({
          type: dispatchType,
          actor: player,
          params: { [dispatchParam]: adv.candidate },
          context: { broadcast },
        });
      }
      const handler = builtins.get(verb);
      if (handler) return handler([adv.candidate.name.toLowerCase()], `${verb} ${adv.candidate.name}`, player, broadcast);
      return { type: 'error', message: 'Selection handler lost.' };
    }
    // adv.type === 'refine': fall through — treat as fresh command
  }

  const parts = raw.toLowerCase().split(/\s+/);
  const cmd = parts[0];
  const args = parts.slice(1);

  if (player.sleeping && cmd !== 'sleep' && cmd !== 'rest') {
    const wasHome = player.sleeping.reason === 'home';
    player.sleeping = null;
    player.posture = 'standing';
    const WAKE_MESSAGES = [
      'jolts awake, eyes wild.',
      'snaps awake with a grunt.',
      'wakes with a start, disoriented.',
      'lurches upright, suddenly conscious.',
      'stirs and opens their eyes.',
    ];
    const roomMsg = WAKE_MESSAGES[Math.floor(Math.random() * WAKE_MESSAGES.length)];
    broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} ${roomMsg}` }, player.id);
    if (wasHome) await deactivateForcefield(player.id, player.home_zone, broadcast);
    const result = await handleCommand(input, player, broadcast);
    if (result) result.message = `You wake up.\n\n${result.message ?? ''}`.trimEnd();
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
