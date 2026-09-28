// THE MARINA DESK — where a hull is bought or hired, and only while somebody is behind it.
//
// Buying and hiring used to answer anywhere a walk of the exit graph reached a `boat_dealer` room,
// so the dock, the pontoons and the counter all sold hulls and the screen that came up on the dock
// carried the dealer's tabs. The desk is the one place that does it now, with a clerk standing
// there: by talking to the clerk (the BOAT_QUOTE/BOAT_SELL/BOAT_HIRE/BOAT_RETURN dialogue actions in
// index.js), or `use desk` and the typed `boat` verbs. The dock keeps the hand of cards you drive.
//
// ⚠ THE CLERK IS ASKED, NEVER ASSUMED. Somebody has to be standing in the room, and `work_zone_id`
// is what makes them THIS desk's clerk rather than a customer who happens to be standing at it.
//
// ⚠ AND THE DESK IS NEVER LEFT EMPTY, which is the promise that makes the clerk the way to buy.
// Two clerks share the day, and they live across town. On the vendor default a shift ends with the
// clerk walking off and the relief only setting out once their own shift has started, so every
// handover left the lobby empty for the length of the walk. The clerks run their own graph instead
// (content, on each NPC): off duty, `DESK_SHIFT_DUE` sends them in early enough to arrive before the
// hour; at the end of a shift, `DESK_RELIEVED` holds them at the desk until the relief is standing
// there on shift. `clerkAt` counts whichever of them is in the room, so the one holding over past
// their hour still serves.

import { getZone, getZoneFurniture, getZoneNpcs } from '../../server/engine/world.js';
import { isVendorClosed, isVendorWorkTime, hoursUntilOpen, registerAICondition, COMMUTE_TILES_PER_REAL_MIN } from '../../server/engine/ai-behaviour.js';
import { getEnvironmentState } from '../../server/engine/environment.js';
import { findPath } from '../../server/engine/pathfinding.js';
import { getTimeScale } from '../../server/engine/gametime.js';

/** The desk furniture in this room, or null. */
export function deskIn(zoneId) {
  if (!zoneId) return null;
  return getZoneFurniture(zoneId).find((f) => f?.flags?.marina_desk) || null;
}

/**
 * The clerk behind this room's desk, or null: the one on shift if they are in, otherwise a desk
 * clerk standing here past their hour (holding for a late relief) or ahead of it.
 */
export function clerkAt(zoneId) {
  if (!deskIn(zoneId)) return null;
  const staff = getZoneNpcs(zoneId).filter((n) => n.work_zone_id === zoneId);
  return staff.find((n) => !isVendorClosed(n)) || staff[0] || null;
}

// ── THE HANDOVER ─────────────────────────────────────────────────────────────

/** Is somebody else on shift and standing at this NPC's desk? True for anyone not holding a desk. */
export function deskRelieved(npc, zoneId) {
  const work = npc?.work_zone_id;
  if (!work || zoneId !== work || !deskIn(work)) return true;
  const env = getEnvironmentState();
  return getZoneNpcs(work).some((n) => n.id !== npc.id && n.work_zone_id === work && isVendorWorkTime(n, env).working);
}

/**
 * Game-minutes a desk clerk needs to set off before their shift: the walk, the way the commute
 * measures it, twice over for the ticks and the doors, and a quarter of an hour on top. Measured
 * from wherever they are, and remembered until they move.
 */
export function deskLeadMinutes(npc, zoneId) {
  const ai = npc._ai || {};
  if (ai._deskLead?.from === zoneId) return ai._deskLead.minutes;
  const path = findPath(zoneId, npc.work_zone_id, { roads: true });
  const tiles = path ? path.length - 1 : 60;
  const walk = (tiles / COMMUTE_TILES_PER_REAL_MIN) * getTimeScale();
  const minutes = Math.ceil(walk * 2 + 15);
  if (npc._ai) npc._ai._deskLead = { from: zoneId, minutes };
  return minutes;
}

/** Is this desk clerk's shift close enough that they should be walking in (or staying put)? */
export function deskShiftDue(npc, zoneId) {
  if (!npc?.work_zone_id || !deskIn(npc.work_zone_id)) return false;
  const until = hoursUntilOpen(npc);
  if (until == null) return false;
  return until * 60 <= deskLeadMinutes(npc, zoneId);
}

registerAICondition('DESK_RELIEVED', (entity, params, { zoneId }) => deskRelieved(entity, zoneId));
registerAICondition('DESK_SHIFT_DUE', (entity, params, { zoneId }) => deskShiftDue(entity, zoneId));

/**
 * Why the desk will not serve this player, or null when it will. One sentence per refusal so the
 * typed verbs and `use desk` say the same thing.
 */
export function deskRefusal(player) {
  const zid = player?.current_zone;
  if (!deskIn(zid)) return 'Hulls are sold and hired by the clerk at the marina desk, in the lobby.';
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
