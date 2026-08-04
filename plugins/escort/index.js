/**
 * Escort plugin.
 *
 * One NPC walks with one player. That's the whole mechanic — deliberately narrow,
 * because the interesting part isn't the plumbing, it's that the escortee is a
 * REAL live NPC the whole time: it stands in the room, it has HP, and it can be
 * killed out from under you. There is no quest token and no invulnerability.
 *
 * How it moves: the engine already had half of this. `moveEntity` (ai-behaviour)
 * is the single writer for every NPC tile change and handles doors, facades and
 * broadcasts, so an escort step is just `moveEntity(npc, wherePlayerWent)` fired
 * off zone.entered. Nothing new walks; we only pick the destination.
 *
 * How it holds still: an escortee with a behaviour graph would happily wander off
 * to its shift between the player's steps, so it's frozen from the AI tick for the
 * duration via `npc._escorting` — the same freeze `npc._aboard` already gives a
 * charter pilot riding in a cockpit (server/engine/gameLoop.js).
 *
 * Quests are NOT referenced here. This plugin emits `escort.arrived` and the
 * quests plugin's `escort` objective type subscribes to it, exactly like kill /
 * visit / retrieve (ADR-0002: objectives advance by subscribing to Events; the
 * mechanic never knows a quest exists).
 *
 * State is RAM-only and dissolves on restart, like `follow` and parties — an
 * escort is a thing you're doing right now, not a thing you have.
 */
import { getNpc, getZone, getZoneNpcs, getLivePlayer } from '../../server/engine/world.js';
import { moveEntity } from '../../server/engine/ai-behaviour.js';
import { registerAction } from '../../server/engine/actions.js';
import { on, emit } from '../../server/engine/events.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { query } from '../../server/models/db.js';

// One escortee per player and one escorter per NPC — both directions enforced, so
// two players can't walk the same body in opposite directions.
const byNpc = new Map();    // npcId    -> playerId
const byPlayer = new Map(); // playerId -> npcId

export function escorteeOf(playerId) {
  const npcId = byPlayer.get(playerId);
  return npcId ? getNpc(npcId) : null;
}
export function escorterOf(npcId) {
  return byNpc.get(npcId) || null;
}

function tell(playerId, text) {
  sendToPlayer(playerId, { type: 'output', message: `<span class="msg-system">${text}</span>` });
}

/**
 * Begin an escort. Returns { ok, message } — the verb renders it, the Action
 * returns it, so both paths give the same refusal text.
 */
export function startEscort(player, npc) {
  if (!player?.id) return { ok: false, message: 'No one to escort with.' };
  if (!npc) return { ok: false, message: "They aren't here." };
  if (npc._dead) return { ok: false, message: `${npc.name} is in no condition to go anywhere.` };
  const existing = byPlayer.get(player.id);
  if (existing === npc.id) return { ok: false, message: `${npc.name} is already with you.` };
  if (existing) {
    const cur = getNpc(existing);
    return { ok: false, message: `You already have ${cur?.name || 'someone'} in tow. One at a time.` };
  }
  if (byNpc.has(npc.id)) return { ok: false, message: `${npc.name} is already following someone else.` };

  byNpc.set(npc.id, player.id);
  byPlayer.set(player.id, npc.id);
  npc._escorting = player.id;   // freezes the AI tick — see gameLoop.js
  // Drop any pending WAIT so the NPC doesn't resume a stale shift step the moment
  // the escort ends and it starts ticking again.
  if (npc._ai) npc._ai.waitUntil = null;

  sendToZone(npc.zone_id, { type: 'zone_event', message: `${npc.name} falls in behind ${player.handle}.` });
  emit('escort.started', { actor: player, npc });
  return { ok: true, message: `${npc.name} is with you now. Lead the way — they'll follow you room to room.` };
}

/**
 * End an escort by NPC id. `reason` is one of: dismissed | killed | player_gone |
 * lost. Silent when that NPC wasn't being escorted, so every teardown path can
 * call it unconditionally.
 */
export function endEscort(npcId, reason = 'dismissed') {
  const playerId = byNpc.get(npcId);
  if (!playerId) return false;
  byNpc.delete(npcId);
  byPlayer.delete(playerId);
  const npc = getNpc(npcId);
  if (npc) delete npc._escorting;   // AI resumes on the next tick
  emit('escort.ended', { npc, playerId, reason });
  // A LOSS is its own event, carrying the live player rather than an id, because
  // it's the one ending something else needs to react to — quests' `escort_lost`
  // failure condition is the consumer. Dismissing someone is not losing them, and
  // neither is logging out; only death and separation-with-no-way-back are.
  if (reason === 'killed' || reason === 'lost') {
    const actor = getLivePlayer(playerId);
    if (actor) emit('escort.lost', { actor, npc, reason });
  }
  return true;
}

// --- Movement --------------------------------------------------------------
//
// The player stepped; walk the escortee after them. Only from the room the player
// just LEFT — an escortee that got separated (shut behind a locked door, or left
// standing while the player rode an elevator) stays where it is rather than
// teleporting across the map, and the player has to go back for them.
on('zone.entered', ({ actor, zone, from }) => {
  if (!actor?.id) return;
  const npcId = byPlayer.get(actor.id);
  if (!npcId) return;
  const npc = getNpc(npcId);
  if (!npc || npc._dead) { endEscort(npcId, 'lost'); return; }
  if (npc._aboard) return;                          // riding in the back — flight lands them
  // Anything that moved you while you're aboard an aircraft (climbing into a cabin,
  // touching down at the far end) is not a step you walked, and an escortee must
  // never walk it: they either boarded with you or they're still on that ramp.
  if (actor.aircraftId) return;
  if (npc.zone_id === zone) return;                 // already here (nothing to do)
  if (from && npc.zone_id !== from) {               // separated — wait to be collected
    tell(actor.id, `${npc.name} isn't with you. They were left behind somewhere back the way you came.`);
    return;
  }

  // sendToZone matches the (zoneId, payload) broadcast contract moveEntity wants.
  const moved = moveEntity(npc, zone, sendToZone, query);
  if (!moved) {
    tell(actor.id, `${npc.name} can't follow you through there.`);
    emit('escort.blocked', { actor, npc, zone });
    return;
  }
  emit('escort.arrived', { actor, npc, zone });
});

// --- By air ----------------------------------------------------------------
//
// An escortee gets in the plane with you. Flight owns the mechanics (out of the
// world, frozen, set back down on landing — the same treatment a charter pilot
// riding in a cockpit already got); this plugin only answers WHO climbs aboard,
// through flight's `aircraft.companions` gather-hook. Neither plugin imports the
// other, exactly as with quests.
//
// Nothing here is a special case for flight: it's the ordinary escort contract
// read one level up. They must be standing with you (a separated escortee is
// still never teleported), they take a real seat, and if the aircraft goes in
// they die in it — flight emits `npc.killed`, which the teardown below already
// turns into `escort.lost`.
function companionFor(player) {
  const npc = escorteeOf(player?.id);
  if (!npc || npc._dead) return undefined;
  if (npc.zone_id !== player.current_zone) {
    tell(player.id, `${npc.name} isn't here to get aboard with you.`);
    return undefined;
  }
  return { npc };
}

// They were set down at the far end. That's an arrival — the same event a walked
// step emits, so an escort objective completes whether you drove them there on
// foot or flew them.
on('npc.transported', ({ npc, zone, playerId }) => {
  if (!npc?.id || byNpc.get(npc.id) !== playerId) return;
  const actor = getLivePlayer(playerId);
  if (actor) tell(playerId, `${npc.name} climbs down after you.`);
  emit('escort.arrived', { actor, npc, zone });
});

// --- Teardown paths --------------------------------------------------------
//
// Every way an escort can end other than being dismissed. The escortee dying is
// the load-bearing one: it's a live body walking through hostile rooms, and losing
// it is the whole tension of the job.
on('npc.killed', ({ npc }) => {
  if (!npc?.id) return;
  const playerId = byNpc.get(npc.id);
  if (!playerId) return;
  tell(playerId, `${npc.name} is dead. Whatever you were walking them to, they aren't getting there.`);
  endEscort(npc.id, 'killed');
});

on('player.death', ({ player }) => {
  const npcId = player?.id && byPlayer.get(player.id);
  if (!npcId) return;
  const npc = getNpc(npcId);
  if (npc) sendToZone(npc.zone_id, { type: 'zone_event', message: `${npc.name} looks down at the body and stops following.` });
  endEscort(npcId, 'player_gone');
});

on('player.logout', ({ id }) => {
  const npcId = id && byPlayer.get(id);
  if (npcId) endEscort(npcId, 'player_gone');
});

// --- Actions ---------------------------------------------------------------
//
// The intended authoring route: an NPC's own dialogue node fires ESCORT_START with
// no params at all — `context.npc` is the speaker, so "get me out of here" on the
// tree is the whole wiring. `npc_id` overrides it for scripts.
registerAction({
  type: 'ESCORT_START',
  handler: async ({ actor, params, context }) => {
    const npcId = params?.npc_id || params?.npc || context?.npc?.id;
    const npc = npcId ? getNpc(npcId) : null;
    if (!npc) return { type: 'error', message: 'ESCORT_START: no NPC resolved (pass npc_id, or fire it from that NPC\'s dialogue).' };
    const res = startEscort(actor, npc);
    return res.ok ? { type: 'escort', npc_id: npc.id, message: res.message } : { type: 'error', message: res.message };
  },
});

registerAction({
  type: 'ESCORT_END',
  handler: async ({ actor, params, context }) => {
    const npcId = params?.npc_id || params?.npc || context?.npc?.id || byPlayer.get(actor?.id);
    if (!npcId) return { type: 'error', message: 'ESCORT_END: nobody is being escorted.' };
    endEscort(npcId, params?.reason || 'dismissed');
    return { type: 'escort', npc_id: npcId };
  },
});

// --- Verb ------------------------------------------------------------------

function cmdEscort(args, raw, player, broadcast) {
  const sub = args.join(' ').trim().toLowerCase();
  const current = escorteeOf(player.id);

  if (!sub) {
    if (!current) return { type: 'output', message: 'You are not escorting anyone. Type "escort <name>" to walk someone out.' };
    if (current._aboard) return { type: 'output', message: `You are escorting ${current.name} — strapped in behind you.` };
    const z = getZone(current.zone_id);
    const here = current.zone_id === player.current_zone;
    return { type: 'output', message: `You are escorting ${current.name}${here ? ' — right behind you.' : ` — but they're back at ${z?.name || 'somewhere else'}.`}` };
  }

  if (sub === 'stop' || sub === 'dismiss' || sub === 'leave') {
    if (!current) return { type: 'output', message: 'You are not escorting anyone.' };
    endEscort(current.id, 'dismissed');
    broadcast(player.current_zone, { type: 'zone_event', message: `${current.name} stops following ${player.handle}.` }, player.id);
    return { type: 'output', message: `${current.name} stops following you.` };
  }

  const npc = getZoneNpcs(player.current_zone).find(n =>
    n.name?.toLowerCase().includes(sub) || String(n.id).toLowerCase() === sub);
  if (!npc) return { type: 'error', message: `There's no "${args.join(' ')}" here to escort.` };

  // Consent: an NPC only walks with you if something in the world said it could —
  // a dialogue node fires ESCORT_START, which sets this. Otherwise the verb is
  // just a way to re-collect an escortee you already agreed to walk.
  if (!npc.flags?.escortable) {
    return { type: 'emote', message: `${npc.name} has no intention of going anywhere with you.` };
  }
  const res = startEscort(player, npc);
  return { type: res.ok ? 'output' : 'error', message: res.message };
}

export const commands = {
  escort: cmdEscort,
};

export const hooks = {
  'aircraft.companions': (player) => companionFor(player),
};

export const _test = { byNpc, byPlayer };

console.log('[escort] Plugin loaded.');
