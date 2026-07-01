import { getAllLivePlayers, getZone } from '../../server/engine/world.js';
import { findPath } from '../../server/engine/pathfinding.js';
import { query } from '../../server/models/db.js';
import { sendToZone, sendToPlayer } from '../../server/engine/messaging.js';
import { cmdMove } from '../../server/engine/commands/movement.js';

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
  player.sleeping = { restore: { hp: 0.18, sanity: 0.15 }, reason: 'home', minutesSlept: 0 };
  player.posture = 'lying';
  player.sittingOn = null;
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
  const direction = Object.entries(zone?.exits || {}).find(([, id]) => id === nextZoneId)?.[0];
  if (!direction) return null;
  return { nextZoneId, direction };
}

// ---------------------------------------------------------------------------
// tick.minute hook — step everyone walking home
// ---------------------------------------------------------------------------

export const hooks = {
  async 'tick.minute'({ broadcast }) {
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

    // Live players using .gohome
    for (const player of getAllLivePlayers()) {
      if (!player.goingHome) continue;
      if (!player.home_zone) { player.goingHome = false; continue; }

      try {
        if (player.current_zone === player.home_zone) {
          player.goingHome = false;
          await arriveSleepLive(player);
          continue;
        }

        const step = nextStepToward(player.current_zone, player.home_zone);
        if (!step) {
          player.goingHome = false;
          sendToPlayer(player.id, { type: 'output', message: "You can't find a path home from here. Going home cancelled." });
          continue;
        }

        const result = await cmdMove(step.direction, player, broadcast, { bypassEncumbrance: true });
        if (result) sendToPlayer(player.id, result);
      } catch (e) {
        console.error(`[pinch] live gohome tick error for ${player.id}:`, e.message);
        player.goingHome = false;
      }
    }
  },
};

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
// .gohome command
// ---------------------------------------------------------------------------

async function cmdGoHome(args, raw, player, broadcast) {
  if (!player.home_zone) {
    return { type: 'error', message: "You don't have a home set. Use .home in your apartment to bind it." };
  }
  if (player.current_zone === player.home_zone) {
    return { type: 'error', message: "You're already home." };
  }

  if (player.goingHome) {
    player.goingHome = false;
    return { type: 'output', message: 'Going home cancelled.' };
  }

  const path = findPath(player.current_zone, player.home_zone);
  if (!path || path.length < 2) {
    return { type: 'error', message: "Can't find a path home from here." };
  }

  player.goingHome = true;
  broadcast(
    player.current_zone,
    { type: 'zone_event', message: `${player.handle} starts heading home.` },
    player.id,
  );
  return { type: 'output', message: "You start making your way home. (Type .gohome again to cancel.)" };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const commands = {
  pinch: cmdPinch,
  '.gohome': cmdGoHome,
};
