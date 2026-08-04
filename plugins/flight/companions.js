// Flight — NPC companions that ride along with a player.
//
// The charter pilot already proved the shape: an NPC can be pulled out of the
// world (no zone), frozen from the AI tick (`_aboard`, honoured by gameLoop) and
// set back down when the aircraft comes to rest. This module generalises exactly
// that half of charter.js so somebody OTHER than the pilot can be aboard — the
// case that forced it is walking an escortee to a field and flying them out.
//
// Flight knows nothing about escorts. Who climbs in is asked for through the
// `aircraft.companions` gather-hook: a plugin that has an NPC attached to a
// player answers with it, and gets `npc.transported` back when they're set down.
// Neither plugin imports the other (same seam rule as escort↔quests, ADR-0002).
//
// Deliberately NOT a seat reservation: a companion boards if there's room at the
// moment the hatch closes, and is left standing on the ramp if there isn't. The
// player is told; nothing is held.
import { gatherHook } from '../../server/engine/plugins.js';
import { emit } from '../../server/engine/events.js';
import { getNpc, getZone, moveNpcToZone } from '../../server/engine/world.js';
import { killNpcInstance } from '../../server/engine/combat.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { forceStand } from '../../server/engine/posture.js';

// aircraftId -> [{ npcId, playerId }]. Kept here rather than derived from
// live.occupants because the recovery paths (flushAirborne's ghost prune) strip
// unknown ids out of the occupant set, and a companion must still be landed.
const riders = new Map();

function tell(playerId, text) {
  sendToPlayer(playerId, { type: 'output', message: `<span class="msg-system">${text}</span>` });
}

export function companionsAboard(aircraftId) {
  return (riders.get(aircraftId) || []).map(r => getNpc(r.npcId)).filter(Boolean);
}

/**
 * Ask every plugin who's climbing aboard with this player, and board them.
 * `seats` is the craft's effective seat count (the caller owns effLoadout, so
 * this module needs no state.js import — and state.js can import this one).
 * Returns the NPCs that made it aboard.
 */
export async function boardCompanions(player, live, { seats = 1 } = {}) {
  if (!player?.id || !live?.row) return [];
  const found = await gatherHook('aircraft.companions', player, live);
  if (!found.length) return [];
  const list = riders.get(live.row.id) || [];
  const boarded = [];
  for (const entry of found) {
    const npc = entry?.npc || (entry?.npc_id ? getNpc(entry.npc_id) : null);
    if (!npc || npc._dead || npc._aboard) continue;
    // Only someone standing in the room with you gets in. A separated escortee is
    // not teleported to the ramp — same rule the walk obeys.
    if (npc.zone_id !== player.current_zone) continue;
    if (live.occupants.size >= seats) {
      tell(player.id, `There's no room aboard for ${npc.name} — they stay on the ground.`);
      continue;
    }
    live.occupants.add(npc.id);
    npc._aboard = live.row.id;
    getZone(npc.zone_id)?.npcs.delete(npc.id);
    npc.zone_id = null;
    forceStand(npc, 'flight.companion');
    if (npc._ai) npc._ai.waitUntil = null;
    list.push({ npcId: npc.id, playerId: player.id });
    boarded.push(npc);
    tell(player.id, `${npc.name} climbs in after you and straps into a seat.`);
  }
  if (list.length) riders.set(live.row.id, list);
  return boarded;
}

/**
 * Put companions back on the ground at `zoneId`. With `playerId` only that
 * player's companions get out (one rider climbing down while the craft keeps its
 * others); without it, everyone aboard does — which is what a landing is.
 */
export function setDownCompanions(live, zoneId, { playerId = null } = {}) {
  const list = riders.get(live?.row?.id);
  if (!list?.length || !zoneId) return [];
  const kept = [], dropped = [];
  for (const r of list) {
    if (playerId && r.playerId !== playerId) { kept.push(r); continue; }
    live.occupants.delete(r.npcId);
    const npc = getNpc(r.npcId);
    if (!npc) continue;
    delete npc._aboard;
    moveNpcToZone(npc.id, zoneId);
    dropped.push(npc);
    sendToZone(zoneId, { type: 'zone_event', message: `${npc.name} climbs down out of the aircraft.` });
    // Past-tense, for whoever was walking them: this is the arrival, and it is the
    // only way an escort objective can tick over on a flight.
    emit('npc.transported', { npc, zone: zoneId, playerId: r.playerId });
  }
  if (kept.length) riders.set(live.row.id, kept); else riders.delete(live.row.id);
  return dropped;
}

/**
 * The aircraft went in. Everyone in the back goes in with it — a companion is a
 * real body aboard a real airframe, not a token that survives the fireball.
 * Called from crash() BEFORE the occupant death loop, so nothing sets them down
 * on the wreck tile first.
 */
export function killCompanions(live) {
  const list = riders.get(live?.row?.id);
  if (!list?.length) return [];
  riders.delete(live.row.id);
  const dead = [];
  for (const r of list) {
    live.occupants.delete(r.npcId);
    const npc = getNpc(r.npcId);
    if (npc) delete npc._aboard;
    const killed = killNpcInstance(r.npcId);
    if (killed) { dead.push(killed); emit('npc.killed', { npc: killed }); }
  }
  return dead;
}
