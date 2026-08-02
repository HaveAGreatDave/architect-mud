// Display Mode — the one player preference shared by every system that ships a
// graphical presentation AND a text one for the same thing.
//
// Two systems grew their own switch independently: the flight display (the 3D
// cockpit / cabin window vs. a narrated ride) and the poker table (the felt in
// the area pane vs. the game called out to the log). They are the same question
// asked twice — "do I want the picture layer, or the words?" — and a player who
// answers it for one has answered it for both. This module is that answer:
//
//   visual — use the graphical presentation wherever one exists (the default)
//   text   — use the text presentation everywhere one exists
//
// It is a PREFERENCE, never a lockout. A system may still offer a per-moment
// escape hatch (a passenger's `window`, poker's `text`/`visual`) — those flip
// this same flag or ride over it for one sitting, by that system's own rules.
//
// Tri-state on purpose. `undefined` means the player has never expressed a view,
// which is not the same as "visual": poker opens an old-school felt in text for
// someone who never chose, and can only do that if it can tell the difference.
//
// Read tier: player_flags, hydrated at login (engine/flags.js) — so these are
// awaited but not round trips. Safe on a board/sit path; still not a per-tick one.
import { getFlag, setFlag } from './flags.js';

export const DISPLAY_MODE_FLAG = 'display_mode';   // 'visual' | 'text'

// Each system's original per-system flag, kept as a READ-ONLY fallback so an
// existing player's choice survives the merge with no data migration. Once they
// touch the unified switch, `display_mode` answers and these are never consulted
// again. Nothing writes them any more.
const LEGACY_KEYS = ['flight_text_only', 'poker_text_mode'];

// true (text) / false (visual) / undefined (never chosen).
export async function prefersTextDisplay(player) {
  const v = await getFlag('player', DISPLAY_MODE_FLAG, player).catch(() => undefined);
  if (v === 'text') return true;
  if (v === 'visual') return false;
  for (const k of LEGACY_KEYS) {
    const lv = await getFlag('player', k, player).catch(() => undefined);
    if (lv === 'true' || lv === true) return true;
    if (lv === 'false' || lv === false) return false;
  }
  return undefined;
}

// Convenience for callers with no meaningful "unset" behavior (flight): unset
// means visual, because a graphical client is what a new player gets.
export async function prefersTextDisplayOrDefault(player) {
  return (await prefersTextDisplay(player)) === true;
}

export async function setDisplayMode(player, toText) {
  await setFlag('player', DISPLAY_MODE_FLAG, toText ? 'text' : 'visual', player).catch(() => {});
}
