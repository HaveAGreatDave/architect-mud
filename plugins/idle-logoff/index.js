/**
 * idle-logoff — disconnects players who stop driving their client.
 *
 * Hooks:
 *   tick.minute — sweeps live players; 15 min without deliberate input warns,
 *                 20 min disconnects via the same 'kicked' path as an admin
 *                 kick (the client closes the socket, the normal ws-close
 *                 logout cleanup runs server-side).
 *
 * Contract (split-system): server/index.js stamps player._lastInputAt
 * (ms epoch, runtime-only — never persisted) on deliberate WS messages:
 * typed/clicked commands, dialogue, and NPC shop actions. Client automation
 * (sendCmdSilent — post-move look refresh, tablet re-nav polls) tags itself
 * silent:true and is excluded, so an unattended client still reads as idle.
 * This plugin owns the read side and the thresholds. Applies to everyone —
 * no role or combat exemptions, by design.
 */
import { getAllLivePlayers } from '../../server/engine/world.js';

export const IDLE_WARN_MS = 15 * 60 * 1000;
export const IDLE_KICK_MS = 20 * 60 * 1000;

export const hooks = {
  'tick.minute': async ({ broadcast } = {}) => {
    if (!broadcast) return;
    const now = Date.now();
    for (const player of getAllLivePlayers()) {
      // First sighting (covers login/reconnect before any input): start the clock.
      if (player._lastInputAt == null) { player._lastInputAt = now; continue; }
      const idle = now - player._lastInputAt;
      if (idle >= IDLE_KICK_MS) {
        // Re-broadcasts each minute if a client ignores 'kicked' — harmless.
        broadcast(null, {
          type: 'kicked',
          message: 'Idle for 20 minutes — the Architect reclaims your bandwidth. Link severed.',
        }, null, player.id);
      } else if (idle >= IDLE_WARN_MS && !(player._idleWarnedAt > player._lastInputAt)) {
        // Warn once per idle stretch: a fresh input moves _lastInputAt past
        // the latch, re-arming the warning for the next stretch.
        player._idleWarnedAt = now;
        broadcast(null, {
          type: 'system',
          message: '<span class="msg-error">⚠ You have been idle for 15 minutes. Five more and your link gets severed.</span>',
        }, null, player.id);
      }
    }
  },
};
