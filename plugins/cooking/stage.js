// The Kitchen Stage's two server-side pieces: who has it open, and the nudge a cook beat sends them.
//
// The Stage (client/game/js/panels/kitchen-stage.js, docs/proposals/kitchen-stage.md) draws the
// workspace payload, which the client re-asks for every five seconds while something cooks. A
// colour change is the cue to plate, and five seconds late is a burnt steak, so when a cook's own
// narration timer fires (cook.js `scheduleNarration`) a player with the Stage open is told to
// re-ask now. No timer, tick or query is added: the beats were already being timed.
//
// RAM only. A restart forgets who had the Stage open; the client says so again on its next open.
import { sendToPlayer } from '../../server/engine/messaging.js';
import { query } from '../../server/models/db.js';
import { prefersTextMinigamesOrDefault } from '../../server/engine/presentation.js';

const watching = new Set();

export function watchStage(playerId, on) {
  if (on) watching.add(String(playerId)); else watching.delete(String(playerId));
}
export const stageOpen = (playerId) => watching.has(String(playerId));

export function pokeStage(playerId, invId) {
  if (watching.has(String(playerId))) sendToPlayer(playerId, { type: 'kitchen_beat', row: invId });
}

// The `workspace.view` hook: offer the Stage on a kitchen payload at `visual` only. Below it the HUD
// is the kitchen, and the client still falls back to the HUD when WebGL2 won't start.
export async function offerStage({ view, player }) {
  if (view?.provider !== 'kitchen' || !player) return;
  view.stage = { offered: !(await prefersTextMinigamesOrDefault(player)) };
}

// `kitchenstow <row> <box>`: put a thing you carry into one of the room's boxes, from the Stage's
// door rack. `stowid` only takes what's loose in your hands, so a row in your own bag comes out
// first, as itself (no merge, so the id still names it), and then it's the ordinary `stowid`.
export async function cmdKitchenStow(args, raw, player, broadcast) {
  const [rowId, boxId] = args || [];
  if (!rowId || !boxId) return { type: 'error', message: 'Put what where?' };
  await query(
    `UPDATE player_inventory pi SET container_id = NULL
       FROM player_inventory bag
      WHERE pi.id = $1 AND pi.player_id = $2 AND bag.id = pi.container_id
        AND bag.player_id = $2 AND bag.container_id IS NULL`,
    [rowId, player.id]
  );
  const { handleCommand } = await import('../../server/engine/commands/index.js');
  return handleCommand(`stowid ${rowId} ${boxId}`, player, broadcast);
}

// `kitchenstage on|off`: the Stage saying it has opened or closed. Not a player verb.
export async function cmdKitchenStage(args, raw, player) {
  const on = String(args?.[0] || '').toLowerCase() !== 'off';
  watchStage(player.id, on);
  return { type: 'noop' };
}
