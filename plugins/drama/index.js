/**
 * Drama — armed dramatic entrances.
 *
 * `drama <text>` stores one line on the player (player_flags: drama_line);
 * `drama` arms it; the next room you walk into hears that line instead of the
 * usual arrival message, and the arming switches off again. Writing a new line
 * arms it too, so setting-then-walking works without a second command.
 *
 * $player in the text is replaced with the walker's handle.
 */
import { getFlag, setFlag, clearFlag } from '../../server/engine/flags.js';

const MAX_LEN = 240;

// Player-authored text lands in other players' output, which renders as HTML.
const sanitize = (s) => s.replace(/[<>]/g, '').slice(0, MAX_LEN).trim();

async function cmdDrama(args, raw, player) {
  const text = (args || []).join(' ').trim();

  if (!text) {
    const line = await getFlag('player', 'drama_line', player);
    if (!line) {
      return { type: 'error', message: 'You have no entrance written. Try: drama $player kicks the door off its hinges.' };
    }
    player._dramaArmed = line;
    return { type: 'output', message: `Entrance armed — the next room you walk into gets:\n<span style="color:var(--accent)">${line.replace(/\$player/g, player.handle)}</span>` };
  }

  if (/^(off|clear|none)$/i.test(text)) {
    await clearFlag('player', 'drama_line', player);
    player._dramaArmed = null;
    return { type: 'output', message: 'Entrance cleared. You go back to arriving like everybody else.' };
  }

  const line = sanitize(text);
  if (!line) return { type: 'error', message: "That's not a line, that's punctuation." };
  await setFlag('player', 'drama_line', line, player);
  player._dramaArmed = line;
  return { type: 'output', message: `Entrance written and armed:\n<span style="color:var(--accent)">${line.replace(/\$player/g, player.handle)}</span>` };
}

export const commands = { drama: cmdDrama };

export const hooks = {
  // One-shot: consume the arming, then hand the movement engine the line.
  'movement.arriveMessage': ({ player }) => {
    const line = player?._dramaArmed;
    if (!line) return undefined;
    player._dramaArmed = null;
    return line.replace(/\$player/g, player.handle);
  },
};
