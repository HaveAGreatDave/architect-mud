// THE MARINA DESK — where a hull is bought or hired, and only while somebody is behind it.
//
// Buying and hiring used to answer anywhere a walk of the exit graph reached a `boat_dealer` room,
// so the dock, the pontoons and the counter all sold hulls and the screen that came up on the dock
// carried the dealer's tabs. The desk is the one place that does it now: `use desk` in the room the
// desk stands in, with a clerk on shift standing there. The dock keeps the hand of cards you drive.
//
// ⚠ THE CLERK IS ASKED, NEVER ASSUMED. `isVendorClosed` is both halves at once — off the timetable,
// or on it and not in the room — so a clerk walking in late or gone home leaves the desk shut with
// nothing authored beside it. `work_zone_id` is what makes somebody THIS desk's clerk rather than a
// customer who happens to be standing at it.

import { getZone, getZoneFurniture, getZoneNpcs } from '../../server/engine/world.js';
import { isVendorClosed } from '../../server/engine/ai-behaviour.js';

/** The desk furniture in this room, or null. */
export function deskIn(zoneId) {
  if (!zoneId) return null;
  return getZoneFurniture(zoneId).find((f) => f?.flags?.marina_desk) || null;
}

/** The clerk on shift behind this room's desk, or null. */
export function clerkAt(zoneId) {
  if (!deskIn(zoneId)) return null;
  return getZoneNpcs(zoneId).find((n) => n.work_zone_id === zoneId && !isVendorClosed(n)) || null;
}

/**
 * Why the desk will not serve this player, or null when it will. One sentence per refusal so the
 * typed verbs and `use desk` say the same thing.
 */
export function deskRefusal(player) {
  const zid = player?.current_zone;
  if (!deskIn(zid)) return 'Hulls are sold and hired at the marina desk, in the lobby.';
  if (!clerkAt(zid)) return 'There is nobody behind the desk right now. Somebody will be back.';
  return null;
}

export const deskReady = (player) => !deskRefusal(player);

export function deskZoneName(zoneId) { return getZone(zoneId)?.name || ''; }

/**
 * `use desk` — the sale and hire screen, or the same lists as text on the log rung. Falls through
 * (undefined) anywhere without a marina desk so every other `use` keeps working.
 */
export async function doUseDesk(args, raw, player) {
  const hint = args.join(' ').trim().toLowerCase();
  if (hint && !/desk|counter|clerk/.test(hint)) return undefined;
  const desk = deskIn(player?.current_zone);
  if (!desk) return undefined;
  const refusal = deskRefusal(player);
  if (refusal) return { type: 'output', message: `<span class="text-dim">${refusal}</span>` };
  const clerk = clerkAt(player.current_zone);
  const { pushMarina } = await import('./shopfront.js');
  const shown = await pushMarina(player, player.current_zone, 'dealer');
  const greet = `<span class="text-dim">${clerk.name} squares the berth book and turns it round to face you.</span>`;
  if (shown) return { type: 'output', message: greet };
  // The log rung: the lists the screen would have shown.
  const { cmdBoat } = await import('./yard.js');
  const sale = await cmdBoat([], 'boat', player);
  const hire = await cmdBoat(['rent'], 'boat rent', player);
  return { type: 'output', message: [greet, sale?.message, hire?.message].filter(Boolean).join('\n\n') };
}
