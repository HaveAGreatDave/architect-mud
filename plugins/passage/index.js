// Passage: furniture you go through (README.md).
//
// `use grate` on a tile with a `flags.passage: "down"` piece walks you down the
// zone's own `down` exit with cmdMove, so locks, gates and the arrival text are
// the ordinary move's. The furniture never names a target zone; the exit does.
// ⚠ `use` is shared by half the game, so this returns undefined unless a
// passage piece in the room matches what was typed.
import { getZoneFurniture } from '../../server/engine/world.js';
import { cmdMove } from '../../server/engine/commands/movement.js';
import { sendToZone } from '../../server/engine/messaging.js';

const SKIP = new Set(['the', 'a', 'an']);

export function passageHere(zoneId, typed = '') {
  const words = String(typed).toLowerCase().split(/\s+/).filter(w => w && !SKIP.has(w));
  return getZoneFurniture(zoneId).find(f => {
    if (!f.flags?.passage) return false;
    const name = (f.name || '').toLowerCase();
    return words.length > 0 && words.every(w => name.includes(w));
  }) || null;
}

export const specializedActions = [{
  verb: 'use', requiredFlag: 'passage',
  handler: async (args, raw, player, broadcast) => {
    const piece = passageHere(player.current_zone, args.join(' '));
    if (!piece) return undefined;
    const from = player.current_zone;
    const res = await cmdMove(piece.flags.passage, player, broadcast);
    if (res?.type !== 'error' && player.current_zone !== from && piece.flags.passage_emote) {
      sendToZone(from, { type: 'output', message: piece.flags.passage_emote.replace('{who}', player.name) }, player.id);
    }
    return res;
  },
}];

export const commands = {};
console.log('[passage] Plugin loaded.');
