import { getAllLivePlayers, getLivePlayer, getZone, getApartment } from '../../server/engine/world.js';
import { on } from '../../server/engine/events.js';
import { stepCadenceMs } from '../pacing/index.js';
import { cmdSetHome, isApartmentZone } from '../../server/engine/apartments.js';
import { allExits } from '../../server/engine/exits.js';
import { findPath } from '../../server/engine/pathfinding.js';
import { query } from '../../server/models/db.js';
import { sendToZone, sendToPlayer, getBroadcast } from '../../server/engine/messaging.js';
import { cmdMove } from '../../server/engine/commands/movement.js';
import { setPosture } from '../../server/engine/posture.js';
import { schedule } from '../../server/engine/scheduler.js';

// Offline players walking home after being pinched.
// Map<playerId, { handle: string, homeZone: string }>
const offlineWalkers = new Map();

const BED_NAMES = /\b(bed|cot|bunk|mattress|couch|sofa|futon|hammock|pallet|bedroll|sleeping bag|lounger)\b/i;

async function findLieSpot(zoneId) {
  const { rows } = await query(`SELECT name, flags FROM furniture WHERE zone_id=$1 LIMIT 20`, [zoneId]);
  return rows.find(f => f.flags?.interactions?.includes?.('lie') || BED_NAMES.test(f.name)) || null;
}

async function arriveSleepOffline(playerId, handle, zoneId) {
  const spot = await findLieSpot(zoneId);
  const whereMsg = spot ? `onto the ${spot.name}` : 'onto the floor';
  await query(
    `UPDATE players SET offline_sleeping=TRUE, posture='lying', current_zone=$1 WHERE id=$2`,
    [zoneId, playerId],
  );
  sendToZone(zoneId, {
    type: 'zone_event',
    message: `${handle} stumbles in and collapses ${whereMsg}, fast asleep.`,
    refresh: true,
  });
}

async function arriveSleepLive(player) {
  const spot = await findLieSpot(player.current_zone);
  const whereMsg = spot ? `onto the ${spot.name}` : 'onto the floor';
  player.sleeping = { restore: { hp: 0.18, sanity: 0.15, stamina: 0.5 }, reason: 'home', minutesSlept: 0 };
  setPosture(player, 'lying');
  player.goingHome = false;
  sendToZone(player.current_zone, {
    type: 'zone_event',
    message: `${player.handle} stumbles in and collapses ${whereMsg}, fast asleep.`,
    refresh: true,
  }, player.id);
  sendToPlayer(player.id, { type: 'sleep', message: `You arrive home and collapse ${whereMsg}. Finally.` });
}

function nextStepToward(currentZone, homeZone) {
  const path = findPath(currentZone, homeZone);
  if (!path || path.length < 2) return null;
  const nextZoneId = path[1];
  const zone = getZone(currentZone);
  const direction = allExits(zone).find(e => e.target === nextZoneId)?.dir;
  if (!direction) return null;
  return { nextZoneId, direction };
}

// ---------------------------------------------------------------------------
// 5s cadence — step everyone walking home
// ---------------------------------------------------------------------------

schedule('5s', async () => {
  // Offline walkers (pinched sleepers)
  for (const [playerId, { handle, homeZone }] of offlineWalkers) {
    try {
      const { rows } = await query(`SELECT current_zone FROM players WHERE id=$1`, [playerId]);
      if (!rows.length) { offlineWalkers.delete(playerId); continue; }

      const currentZone = rows[0].current_zone;
      if (currentZone === homeZone) {
        offlineWalkers.delete(playerId);
        await arriveSleepOffline(playerId, handle, homeZone);
        continue;
      }

      const step = nextStepToward(currentZone, homeZone);
      if (!step) { offlineWalkers.delete(playerId); continue; }

      await query(`UPDATE players SET current_zone=$1 WHERE id=$2`, [step.nextZoneId, playerId]);
      sendToZone(currentZone, { type: 'zone_event', message: `${handle} shuffles ${step.direction}, still in a daze.`, refresh: true });
      sendToZone(step.nextZoneId, { type: 'zone_event', message: `${handle} stumbles in, eyes glazed, heading home.`, refresh: true });
    } catch (e) {
      console.error(`[pinch] offline walker tick error for ${playerId}:`, e.message);
      offlineWalkers.delete(playerId);
    }
  }

  // A live `home` walk is NOT driven here — it paces itself off the movement clock
  // (see homeWalkStep below). This tick is the offline sleeper's shuffle only.
});

// ---------------------------------------------------------------------------
// Live `home` walk — one step per movement cadence
// ---------------------------------------------------------------------------
//
// This used to ride the 5s tick above, alongside the offline sleepers, which meant
// walking yourself home crawled at one room per five seconds — five times slower
// than walking the same rooms by hand, and slower still than running them. The
// sleeper's shuffle is meant to look like that; your own legs are not.
//
// So a live walk steps on its own timer at `stepCadenceMs(player)` — the pacing
// plugin's own answer for how long a step takes you right now. Because that reads
// walk/run/sprint and the tile underfoot on every step, toggling `run` mid-journey
// speeds the walk home up, and hitting a road speeds it up again, with nothing here
// knowing any of those rules.
//
// The steps stay `bypassEncumbrance` (a system-driven relocation, same as before):
// we are already the thing pacing them, so they must not ALSO be queued by the
// pacing gate — that would pace one walk twice.

function stopHomeWalk(player) {
  if (!player) return;
  if (player._homeWalkTimer) { clearTimeout(player._homeWalkTimer); player._homeWalkTimer = null; }
  player.goingHome = false;
}

function scheduleHomeWalk(player) {
  if (player._homeWalkTimer) clearTimeout(player._homeWalkTimer);
  player._homeWalkTimer = setTimeout(() => { homeWalkStep(player).catch(() => {}); }, stepCadenceMs(player));
}

async function homeWalkStep(player) {
  player._homeWalkTimer = null;
  // Cancelled, logged out, downed, or asleep — a walk home is something you're
  // doing, and every one of those means you've stopped doing it.
  if (!player.goingHome) return;
  if (getLivePlayer(player.id) !== player || (player.hp ?? 1) <= 0 || player.sleeping) { stopHomeWalk(player); return; }
  if (!player.home_zone) { stopHomeWalk(player); return; }

  const broadcast = getBroadcast();
  if (!broadcast) { scheduleHomeWalk(player); return; }   // pre-boot; try again next step

  try {
    if (player.current_zone === player.home_zone) {
      stopHomeWalk(player);
      await arriveSleepLive(player);
      return;
    }

    const step = nextStepToward(player.current_zone, player.home_zone);
    if (!step) {
      stopHomeWalk(player);
      sendToPlayer(player.id, { type: 'output', message: "You can't find a path home from here. Going home cancelled." });
      return;
    }

    const result = await cmdMove(step.direction, player, broadcast, { bypassEncumbrance: true });
    if (result) sendToPlayer(player.id, result);
    // A wall — a locked door, a gate — ends the walk rather than hammering it every
    // cadence for the rest of the night.
    if (result?.type === 'error') { stopHomeWalk(player); return; }
  } catch (e) {
    console.error(`[pinch] home walk step error for ${player.id}:`, e.message);
    stopHomeWalk(player);
    return;
  }
  scheduleHomeWalk(player);
}

// Anything that ends the journey without the player typing `home` again: dying
// mid-walk, or dropping. Left un-cancelled, the timer walks a corpse (or a ghost)
// the rest of the way home.
on('player.death', ({ player }) => stopHomeWalk(player));
on('player.logout', ({ id }) => stopHomeWalk(getAllLivePlayers().find((p) => p.id === id)));

// ---------------------------------------------------------------------------
// pinch command
// ---------------------------------------------------------------------------

async function cmdPinch(args, raw, player, broadcast) {
  const targetStr = args.join(' ').trim();
  if (!targetStr) return { type: 'error', message: 'Pinch whom?' };

  const { rows } = await query(
    `SELECT * FROM players WHERE LOWER(handle) LIKE $1 AND current_zone=$2 AND offline_sleeping=TRUE LIMIT 1`,
    [`%${targetStr.toLowerCase()}%`, player.current_zone],
  );
  if (!rows.length) return { type: 'error', message: `There's no sleeping ${targetStr} here to pinch.` };

  const target = rows[0];

  if (!target.home_zone) {
    return { type: 'error', message: `${target.handle} has nowhere to call home. They sleep where they fall.` };
  }
  if (target.current_zone === target.home_zone) {
    return { type: 'error', message: `${target.handle} is already home.` };
  }
  if (offlineWalkers.has(target.id)) {
    return { type: 'error', message: `${target.handle} is already stumbling home.` };
  }

  const path = findPath(target.current_zone, target.home_zone);
  if (!path || path.length < 2) {
    return { type: 'error', message: `There's no path from here to ${target.handle}'s home.` };
  }

  await query(`UPDATE players SET offline_sleeping=FALSE WHERE id=$1`, [target.id]);
  offlineWalkers.set(target.id, { handle: target.handle, homeZone: target.home_zone });

  broadcast(
    player.current_zone,
    {
      type: 'zone_event',
      message: `${player.handle} pinches ${target.handle}. ${target.handle} jolts awake with a wild look, mutters something about home, and staggers toward the door.`,
      refresh: true,
    },
    player.id,
  );

  return { type: 'output', message: `You pinch ${target.handle}. They stagger upright and start making their way home.` };
}

// ---------------------------------------------------------------------------
// home command — one verb, two jobs. Standing in a place you own, it binds your
// HoloLock (set home). Anywhere else, it makes your own way home the same way
// pinch walks an offline sleeper — a repeat press cancels.
// ---------------------------------------------------------------------------

async function cmdHome(args, raw, player, broadcast) {
  const zone = getZone(player.current_zone);
  const apt = isApartmentZone(zone) ? getApartment(zone.id) : null;
  // In an apartment you own → (re)bind home here. Otherwise → head home.
  if (apt?.owner_id === player.id) return cmdSetHome(player);
  return cmdGoHome(args, raw, player, broadcast);
}

async function cmdGoHome(args, raw, player, broadcast) {
  if (!player.home_zone) {
    return { type: 'error', message: "You don't have a home set. Use home in an apartment you own to bind it." };
  }
  if (player.current_zone === player.home_zone) {
    return { type: 'error', message: "You're already home." };
  }

  if (player.goingHome) {
    stopHomeWalk(player);
    return { type: 'output', message: 'Going home cancelled.' };
  }

  const path = findPath(player.current_zone, player.home_zone);
  if (!path || path.length < 2) {
    return { type: 'error', message: "Can't find a path home from here." };
  }

  player.goingHome = true;
  // First step comes on the cadence, not instantly — you set off, you don't teleport
  // a room. Everything after it is scheduled by the step itself.
  scheduleHomeWalk(player);
  broadcast(
    player.current_zone,
    { type: 'zone_event', message: `${player.handle} starts heading home.` },
    player.id,
  );
  return { type: 'output', message: "You start making your way home. (Type home again to cancel.)" };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const commands = {
  pinch: cmdPinch,
  home: cmdHome,
};
