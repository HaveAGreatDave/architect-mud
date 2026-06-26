/**
 * Weapon plugin — routes player-initiated ATTACK through the Action dispatcher
 * (ADR-0001). Enemy targets dispatch the ATTACK Action (which emits enemy.killed
 * / enemy.attacked); the door and empty-target cases return undefined so the
 * built-in cmdAttack fallback handles them. The 1-second enemy-combat tick is
 * never routed here — it stays raw in gameLoop.js.
 */
import { dispatchAction } from '../../server/engine/actions.js';

async function attack(args, raw, player, broadcast) {
  const targetStr = args.join(' ');
  if (!targetStr) return undefined;
  if (targetStr === 'door' || targetStr.startsWith('door ')) return undefined;
  return dispatchAction({ type: 'ATTACK', actor: player, params: { targetStr }, context: { broadcast } });
}

export const specializedActions = [
  { verb: 'attack', handler: attack },
  { verb: 'kill',   handler: attack },
  { verb: 'k',      handler: attack },
];
