// Being told to leave, and then actually being made to.
//
// intrusion.js is the words half: a resident challenges a stranger standing in
// their kitchen. It deliberately stopped there, because at the time nothing in
// the game moved a player and inventing that inside a scenery layer would have
// been a mechanic hiding in the furniture. Two things changed that:
//
//   • `shove`/`drag` made moving another body an ordinary, visible thing that
//     goes through cmdMove like any other step, so there IS a real seam now.
//   • NPC lock-up (ai-behaviour.js) turned a soft problem hard: a shopkeeper who
//     shuts up shop around a browsing player has locked a stranger in their
//     stockroom overnight. Telling them to leave and doing nothing about it is
//     the wrong answer when the alternative is a locked door.
//
// So: **the NPC ejects you, it never traps you.** The engine's lock-up marker
// (`_autoLockedInside`) is the safety net underneath; this is the actual beat.
//
// WHO BELONGS — the whole question, asked once in `belongsHere`:
//   • admins/devs — never challenged, same as intrusion.js
//   • the tenant/owner of a unit on either side, and any RESIDENT of the building
//   • a REGULAR — `familiar` or better with this NPC. A shopkeeper who knows you
//     says "closing up, walk you out?"; she doesn't frogmarch you. This is the
//     one rule that makes the relations substrate visible in a doorway.
//   • anybody the NPC is fighting — an eviction is not a way to win a fight, and
//     teleporting a combatant out of the room would be exactly that
//
// Everyone else gets one line and one step through the door. No roll: a refusal
// mechanic here would mean a player could stand in a locked shop indefinitely by
// losing rolls, which is the situation this whole file exists to end.
import { on } from '../../server/engine/events.js';
import { world, getZone, getZonePlayers, getApartment, getLivePlayer, isLivePlayer } from '../../server/engine/world.js';
import { getBroadcast } from '../../server/engine/messaging.js';
import { playerControlsApt, isResidentOf, getBuildingName } from '../../server/engine/apartments.js';
import { getRelation, relationAtLeast } from '../../server/engine/relations.js';
import { allExits } from '../../server/engine/exits.js';
import { cmdMove } from '../../server/engine/commands/movement.js';
import { isNpcAsleep } from '../../server/engine/ai-behaviour.js';

// A warning is worth something only if it can be heeded. After the line lands,
// this long to get moving under your own steam; still standing there and you're
// walked out. Long enough to grab what you were looking at, short enough that
// the NPC doesn't look like scenery.
const GRACE_MS = 20_000;

const rand = arr => arr[Math.floor(Math.random() * arr.length)];

const SHOP_WARN = [
  `{npc} flips the sign and looks pointedly at you. "That's me done. Out you go."`,
  `{npc} kills the counter lights. "We're closed. I'm not locking you in here overnight."`,
  `{npc} jangles a keyring at you. "Closing up. Take it to the street."`,
];
const HOME_WARN = [
  `{npc} holds the door open and waits. "Out. I won't ask twice."`,
  `{npc} jerks a thumb at the door. "This is my home and you're leaving it."`,
  `{npc} stands square in the middle of the room. "Whatever you came for, you're not finding it. Go."`,
];
const ESCORT = [
  `{npc} takes {player} by the elbow and walks them out, firmly and without malice.`,
  `{npc} steers {player} through the door and shuts it behind them.`,
  `{npc} gets a hand between {player}'s shoulder blades and marches them out.`,
];
// A regular doesn't get thrown out, they get walked out — the courtesy version.
const REGULAR = [
  `{npc} nods at you. "Closing up. Don't rush — just pull the door behind you."`,
  `{npc} smiles tiredly. "You're alright. Let yourself out when you're done."`,
];

// The one question. Sync — every ingredient is in memory by contract
// (playerControlsApt reads world.apartments, getRelation reads player._relations).
export function belongsHere(player, npc, insideZoneId) {
  if (!player) return true;
  if (['admin', 'dev'].includes(player.role)) return true;
  const apt = getApartment(insideZoneId);
  if (apt && playerControlsApt(player, apt)) return true;
  const building = getBuildingName(getZone(insideZoneId));
  if (building && isResidentOf(player, building)) return true;
  if (npc && relationAtLeast(getRelation(player, npc.id), 'familiar')) return true;
  if (npc && (npc._combatTargetId === player.id || player.combatTargetId === npc.id)) return true;
  return false;
}

// Which way is out. The lock-up event names the outside zone, so this is a plain
// lookup rather than a guess — and if the two rooms aren't directly linked (a
// facade seam), cmdMove's targetZoneId still lands them in the right place.
function directionOut(insideZoneId, outsideZoneId) {
  return allExits(getZone(insideZoneId)).find(e => e.target === outsideZoneId)?.dir || 'out';
}

async function escort(npc, player, insideZoneId, outsideZoneId) {
  const broadcast = getBroadcast();
  if (!isLivePlayer(player) || player.current_zone !== insideZoneId) return false;
  if (!getZone(outsideZoneId)) return false;
  broadcast(insideZoneId, {
    type: 'zone_event',
    message: rand(ESCORT).replace(/\{npc\}/g, npc.name).replace(/\{player\}/g, player.handle),
    refresh: true,
  });
  // Same seam `shove` uses: a real move through cmdMove, so every gate, hook and
  // arrival description runs exactly as if they'd walked it themselves. The
  // encumbrance bypass is the same named exemption — being carried out doesn't
  // care what's in your pockets.
  const res = await cmdMove(directionOut(insideZoneId, outsideZoneId), player, broadcast,
    { bypassEncumbrance: true, targetZoneId: outsideZoneId });
  if (res) broadcast(null, res, null, player.id);
  return true;
}

// The way out of a room somebody's being thrown out of, when the caller doesn't
// already know it (the intrusion path, where nobody locked anything). Prefer a
// neighbour that isn't itself somebody's home — you get put in the hall, not in
// the next bedroom along.
export function wayOutOf(zoneId) {
  const exits = allExits(getZone(zoneId));
  const outside = exits.find(e => {
    const z = getZone(e.target);
    return z && !z.flags?.is_apartment && !z.flags?.is_dwelling;
  });
  return (outside || exits[0])?.target || null;
}

// Escort if they're still standing there when the grace lapses. The timer
// re-validates everything (still live, still in the room, NPC still awake and
// still around) — a warning is not a scheduled teleport.
export function scheduleEscort(npc, player, insideZoneId, outsideZoneId) {
  if (!npc || !player || !outsideZoneId) return;
  setTimeout(() => {
    try {
      const live = getLivePlayer(player.id);
      if (!live || live.current_zone !== insideZoneId) return;      // they took the hint
      const stillHere = world.npcs.get(npc.id);
      if (!stillHere || stillHere._dead || isNpcAsleep(stillHere)) return;
      escort(stillHere, live, insideZoneId, outsideZoneId)
        .catch(e => console.error('[ambient-life] escort:', e.message));
    } catch (e) {
      console.error('[ambient-life] eviction timer:', e.message);
    }
  }, GRACE_MS).unref?.();
}

// The full beat: told to leave, then made to. Used by the lock-up path; the
// intrusion path speaks its own challenge line and only wants the second half.
function warnThenEscort(npc, player, insideZoneId, outsideZoneId, reason) {
  const broadcast = getBroadcast();
  const lines = reason === 'home' ? HOME_WARN : SHOP_WARN;
  broadcast(null, {
    type: 'output',
    message: `<span class="speech-line">${rand(lines).replace(/\{npc\}/g, npc.name)}</span>`,
  }, null, player.id);
  broadcast(insideZoneId, { type: 'zone_event', message: `${npc.name} tells ${player.handle} to leave.` }, player.id);
  scheduleEscort(npc, player, insideZoneId, outsideZoneId);
}

on('npc.lockup', ({ npc, reason, insideZoneId, outsideZoneId }) => {
  try {
    if (!npc || !insideZoneId || !outsideZoneId) return;
    const broadcast = getBroadcast();
    for (const player of getZonePlayers(insideZoneId)) {
      if (belongsHere(player, npc, insideZoneId)) {
        // A regular is told, not moved — and only about a shop closing; nobody
        // announces their own front door to a person who lives behind it.
        if (reason === 'shop' && !['admin', 'dev'].includes(player.role)) {
          broadcast(null, { type: 'output', message: `<span class="speech-line">${rand(REGULAR).replace(/\{npc\}/g, npc.name)}</span>` }, null, player.id);
        }
        continue;
      }
      warnThenEscort(npc, player, insideZoneId, outsideZoneId, reason);
    }
  } catch (e) {
    console.error('[ambient-life] npc.lockup:', e.message);
  }
});

// Test seam.
export const _eviction = { belongsHere, directionOut, wayOutOf, escort, warnThenEscort, scheduleEscort, GRACE_MS, SHOP_WARN, HOME_WARN, ESCORT };
