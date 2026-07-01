import {
  getZone,
  getZonePlayers,
  getZoneCorpses,
  getLivePlayer,
  getApartment,
  moveCorpse,
} from '../../server/engine/world.js';
import { cmdMove } from '../../server/engine/commands/movement.js';
import { computeCarriedWeight } from '../../server/engine/commands/inventory.js';
import {
  isOnCooldown,
  setCooldown,
  getCooldownRemaining,
} from '../../server/engine/combat.js';
import {
  resolve as siftResolve,
  createSelectionState,
  formatSelectionPage,
} from '../../server/engine/sift.js';
import { query } from '../../server/models/db.js';

const DIR_ALIASES = {
  n: 'north', s: 'south', e: 'east', w: 'west', u: 'up', d: 'down',
  north: 'north', south: 'south', east: 'east', west: 'west',
  up: 'up', down: 'down', in: 'in', out: 'out',
};

// 2d8 − 2d8 swing, matching the contested-roll convention used in skills.js.
function rollSwing() {
  const r2 = () => (1 + Math.floor(Math.random() * 8)) + (1 + Math.floor(Math.random() * 8));
  return r2() - r2();
}

async function corpseWeight(corpseId) {
  const { rows } = await query(
    `SELECT COALESCE(SUM(i.weight*pi.quantity),0) AS w
     FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1`,
    [corpseId],
  );
  return Number(rows[0].w) || 0;
}

function resolveCorpse(targetStr, player) {
  const corpses = getZoneCorpses(player.current_zone);
  if (!targetStr) return corpses.length === 1 ? corpses[0] : null;
  const t = targetStr.toLowerCase();
  return corpses.find((c) => c.name.toLowerCase().includes(t)) || null;
}

async function cmdShove(args, raw, player, broadcast) {
  const verb = (raw || 'shove').trim().split(/\s+/)[0].toLowerCase();
  if (isOnCooldown(player.id, 'shove')) {
    return { type: 'error', message: `You're catching your breath. (${(getCooldownRemaining(player.id, 'shove') / 1000).toFixed(1)}s)` };
  }

  const words = (args || []).filter(Boolean);
  if (words.length < 2) {
    return { type: 'error', message: `${verb === 'drag' ? 'Drag' : 'Shove'} whom, and which way? (e.g. "${verb} <target> to north")` };
  }
  const dirWord = words[words.length - 1].toLowerCase();
  const direction = DIR_ALIASES[dirWord];
  if (!direction) {
    return { type: 'error', message: `"${words[words.length - 1]}" isn't a direction.` };
  }
  // Drop the direction and an optional trailing "to" filler to get the target text.
  let targetWords = words.slice(0, -1);
  if (targetWords.length && targetWords[targetWords.length - 1].toLowerCase() === 'to') {
    targetWords = targetWords.slice(0, -1);
  }
  const targetStr = targetWords.join(' ').trim();
  if (!targetStr) {
    return { type: 'error', message: `${verb === 'drag' ? 'Drag' : 'Shove'} whom?` };
  }

  // Validate the exit BEFORE attempting the contested roll.
  const zone = getZone(player.current_zone);
  if (!zone) return { type: 'error', message: 'Your zone is missing.' };
  const targetId = zone.exits?.[direction];
  if (!targetId) {
    const cardinal = ['north', 'south', 'east', 'west'].includes(direction);
    return { type: 'error', message: cardinal ? `No exit to the ${direction}.` : `No exit ${direction}.` };
  }
  if (!getZone(targetId)) return { type: 'error', message: 'That exit leads nowhere yet.' };

  // Resolve the target: prefer a live player in the zone, then a corpse.
  const pool = getZonePlayers(player.current_zone)
    .filter((p) => p.id !== player.id)
    .map((p) => ({ ...p, name: p.handle }));
  const r = siftResolve(targetStr, pool);
  if (r.type === 'ambiguous') {
    createSelectionState(player.id, r.candidates, { verb });
    return { type: 'output', message: formatSelectionPage({ allCandidates: r.candidates, visibleIndex: 0, pageSize: 5 }) };
  }

  let targetPlayer = r.type === 'match' ? (getLivePlayer(r.candidate.id) || r.candidate) : null;
  let corpse = null;
  let sleeper = null;
  if (!targetPlayer) corpse = resolveCorpse(targetStr, player);
  if (!targetPlayer && !corpse) {
    const { rows } = await query(
      `SELECT * FROM players WHERE LOWER(handle) LIKE $1 AND current_zone=$2 AND offline_sleeping=TRUE LIMIT 1`,
      [`%${targetStr.toLowerCase()}%`, player.current_zone],
    );
    if (rows.length) sleeper = rows[0];
  }
  if (!targetPlayer && !corpse && !sleeper) {
    return { type: 'error', message: `Can't find "${targetStr}" here.` };
  }

  // Mirror attack's effective PvP gating: forcefielded apartments block reach.
  if (targetPlayer && getApartment(targetPlayer.current_zone)?.forcefield_active) {
    return { type: 'error', message: `A quantum forcefield crackles between you and ${targetPlayer.handle}. You can't reach them.` };
  }

  const targetName = targetPlayer ? targetPlayer.handle : (sleeper ? sleeper.handle : corpse.name);
  const pastVerb = verb === 'drag' ? 'drags' : 'shoves';

  // Sleeping players offer no resistance — skip the contested roll.
  if (!sleeper) {
    const grams = targetPlayer ? await computeCarriedWeight(targetPlayer) : await corpseWeight(corpse.id);
    const difficulty = Math.ceil((grams / 1000) / 3);
    const swing = rollSwing();
    const margin = ((Number(player.stat_brawn) || 0) - difficulty) + swing;

    if (margin < 0) {
      setCooldown(player.id, 'shove');
      broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} tries to ${verb} ${targetName} ${direction}, but can't budge ${targetPlayer ? 'them' : 'it'}.` }, player.id, null, targetPlayer ? targetPlayer.id : null);
      if (targetPlayer) {
        broadcast(null, { type: 'output', message: `${player.handle} tries to ${verb} you ${direction}, but fails.` }, null, targetPlayer.id);
      }
      return { type: 'output', message: `You try to ${verb} ${targetName} ${direction}, but can't budge ${targetPlayer ? 'them' : 'it'}.` };
    }
  }

  // Success: announce, then move the target and the actor (encumbrance bypassed).
  broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} ${pastVerb} ${targetName} ${direction}!`, refresh: true }, player.id, null, targetPlayer ? targetPlayer.id : null);

  if (targetPlayer) {
    const tRes = await cmdMove(direction, targetPlayer, broadcast, { bypassEncumbrance: true });
    broadcast(null, { type: 'output', message: `${player.handle} ${pastVerb} you ${direction}!` }, null, targetPlayer.id);
    if (tRes) broadcast(null, tRes, null, targetPlayer.id);
  } else if (sleeper) {
    await query(`UPDATE players SET current_zone=$1 WHERE id=$2`, [targetId, sleeper.id]);
    broadcast(targetId, { type: 'zone_event', message: `${sleeper.handle} is dragged in, fast asleep.`, refresh: true });
  } else {
    await moveCorpse(corpse.id, targetId);
    broadcast(targetId, { type: 'zone_event', message: `${corpse.name} slides in.`, refresh: true });
  }

  const res = await cmdMove(direction, player, broadcast, { bypassEncumbrance: true });
  return res;
}

export const commands = { shove: cmdShove, drag: cmdShove };
