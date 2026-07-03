/**
 * Debug plugin.
 *
 * A testing aid that reveals normally-hidden dice rolls to the player. The
 * on/off state lives purely in the client's localStorage (not the DB) — the
 * server has no idea whether any given player has it on, so it always emits the
 * roll detail and the client decides whether to render it.
 *
 * `.debug` sends a `debug_toggle` message; the client flips its localStorage
 * flag and echoes the new state. For each IP-award roll (engine `ip.roll`
 * event) we push a `debug_roll` line that the client shows only when enabled.
 *
 * To reveal another hidden roll later: emit it as an event in the engine and
 * add another `on(...)` here that formats a `debug_roll` line.
 */
import { on } from '../../server/engine/events.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { SKILLS } from '../../server/engine/skills.js';

on('ip.roll', ({ playerId, skillId, chance, roll, hit }) => {
  if (!playerId) return;
  const name = SKILLS[skillId]?.name || skillId;
  const rolled = (roll * 100).toFixed(1);
  const need = (Math.min(1, chance) * 100).toFixed(1);
  sendToPlayer(playerId, {
    type: 'debug_roll',
    message: `<span class="debug-roll">[debug] IP roll — ${name}: rolled ${rolled} vs ${need}% → ${hit ? 'HIT (+1 IP)' : 'miss'}</span>`,
  });
});

function cmdDebug() {
  // The client owns the flag (localStorage); this just asks it to flip.
  return { type: 'debug_toggle' };
}

export const commands = { debug: cmdDebug };
