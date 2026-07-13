/**
 * MIS plugin — sexual interaction commands, player opt-in toggle, the wash
 * command, horniness decay, and the MIS-gated appearance notes. Extracted
 * from the engine (Phase 2, docs/proposals/engine-plugin-boundary.md); the
 * engine keeps only the consent substrate (server/engine/mis.js).
 *
 * All sexual commands require: server MIS enabled AND player.mis_enabled=1.
 * Players opt in via the hidden Maturity Slider in client settings.
 */
import { query } from '../../server/models/db.js';
import { isMisActive, isAttractedTo } from '../../server/engine/mis.js';
import {
  addHorniness, washEjaculate, MIS_TUTORIAL,
  startMisEvent, stopMisEvent, hasMisEvent, getMisEventMeta,
  triggerClimax, triggerGroundClimax,
  erectionVisibilityNote, breastVisibilityNote, femaleChestNote,
  MASTURBATE_EVENT_MALE, MASTURBATE_EVENT_FEMALE,
  MASTURBATE_EVENT_SELF_MALE, MASTURBATE_EVENT_SELF_FEMALE,
  NPC_WITNESS_AROUSED, NPC_WITNESS_DISGUST,
  FUCK_EVENT_MSGS, FUCK_EVENT_PLAYER_MSGS, FUCK_EVENT_TARGET_MSGS, EJACULATE_ZONE_MSGS,
  SERVICE_EVENTS, SERVICE_CLIMAX_ZONE, SERVICE_CLIMAX_ACTOR, triggerServiceClimax,
  NPC_AROUSAL_MSGS, NPC_CLIMAX_MSGS,
} from './mis-system.js';
import { world, getZone, getZonePlayers, getZoneNpcs, getLivePlayer, getAllLivePlayers } from '../../server/engine/world.js';
import { stainZone, stainClothing } from '../../server/engine/bodily.js';
import { resolve as siftResolve, createSelectionState, formatSelectionPage } from '../../server/engine/sift.js';
import { isNpcMisWilling, getNpcMisLine, npcMisAttacks } from '../../server/engine/npc-personality.js';
import { registerInputMatcher } from '../../server/engine/plugins.js';
import { on, emit } from '../../server/engine/events.js';
import { schedule } from '../../server/engine/scheduler.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { recomputeArmor, recomputeInsulation } from '../../server/engine/commands/inventory.js';
import { describeGenitals, ejaculateDescription, describeBodyPart } from '../../server/engine/appearance.js';
import { getEnvironmentState } from '../../server/engine/environment.js';

function misGate(player, raw) {
  if (!isMisActive(player)) {
    const cmd = (raw || '').split(/\s+/)[0] || '';
    return { type:'error', message:`Unknown command: "${cmd}". Type HELP for commands.` };
  }
  return null;
}

// True if the player has any garment equipped on the legs slot. Ejaculate soaks
// into it instead of hitting the floor (mirrors the piss/shit rule in bodily).
async function legsCovered(player) {
  const { rows } = await query(
    `SELECT 1 FROM player_inventory WHERE player_id=$1 AND is_equipped=1 AND slot='legs' LIMIT 1`,
    [player.id]);
  return rows.length > 0;
}

// Broadcast a zone event only to players who have MIS enabled
function broadcastMis(zoneId, message, broadcast, excludePlayerId = null, alsoTargetId = null) {
  for (const p of getZonePlayers(zoneId)) {
    if (p.id === excludePlayerId) continue;
    if (alsoTargetId && p.id === alsoTargetId) continue; // target gets their own message
    if (isMisActive(p)) broadcast(null, message, null, p.id);
  }
}

// NPCs present when a MIS act happens react to it: willing NPCs (mis_willing)
// with arousal/interest, everyone else with disgust/confusion. Per-NPC `chance`
// keeps ongoing events from spamming a reaction every tick.
function npcWitnessMis(zoneId, broadcast, chance = 1) {
  for (const npc of getZoneNpcs(zoneId)) {
    if (npc._dead) continue;
    if (chance < 1 && Math.random() > chance) continue;
    const willing = isNpcMisWilling(npc);
    const pool = willing ? NPC_WITNESS_AROUSED : NPC_WITNESS_DISGUST;
    const msg = pool[Math.floor(Math.random() * pool.length)].replace('{npc}', npc.name);
    broadcastMis(zoneId, { type: 'zone_event', message: msg }, broadcast);
  }
}

// Resolve an NPC in the player's zone by name substring.
function resolveNpcForMis(nameStr, zoneId) {
  const npcs = getZoneNpcs(zoneId).filter(n => !n._dead);
  const r = siftResolve(nameStr, npcs.map(n => ({ ...n, name: n.name })));
  return r.type === 'match' ? r.candidate : null;
}

// Move NPC to their home zone immediately (flee response).
function fleeNpcToHome(npc, broadcast) {
  const dest = npc.home_zone || npc.zone_id;
  if (dest === npc.zone_id) return;
  const from = npc.zone_id;
  world.zones.get(from)?.npcs.delete(npc.id);
  npc.zone_id = dest;
  world.zones.get(dest)?.npcs.add(npc.id);
  broadcast(from, { type: 'zone_event', message: `${npc.name} hurries away.`, refresh: true });
  broadcast(dest, { type: 'zone_event', message: `${npc.name} hurries in, flustered.`, refresh: true });
}

// Sex of an NPC — players carry biological_sex; NPCs carry sex.
function npcSex(npc) { return npc.biological_sex || npc.sex; }

// Broadcast an NPC's MIS dialogue line (shout if it's written in ALL CAPS).
function broadcastNpcMisLine(npc, willing, zoneId, broadcast) {
  const line = getNpcMisLine(npc, willing);
  if (!line) return;
  const letters = line.replace(/[^A-Za-z]/g, '');
  const shout = letters.length > 3 && letters === letters.toUpperCase();
  broadcastMis(zoneId, { type: 'zone_event', message: `${npc.name} ${shout ? 'shouts' : 'says'}, "${line}"` }, broadcast);
}

// Zone-gated NPCs (e.g. a VIP-only dancer) refuse MIS outside their room.
// Returns a refusal result to hand straight back, or null if it's allowed here.
function npcZoneRefusal(player, npc, broadcast) {
  const zoneGate = npc.flags?.mis_requires_zone_flag;
  if (zoneGate && !getZone(player.current_zone)?.flags?.[zoneGate]) {
    broadcastNpcMisLine(npc, false, player.current_zone, broadcast);
    return { type: 'output', message: `Not here. ${npc.name} won't — take it somewhere private.` };
  }
  return null;
}

// Transient, in-memory NPC arousal — never persisted; it lives on the live NPC
// object for the duration of the scene (kept client-side in spirit). A willing
// NPC builds arousal from MIS acts exactly like a player: moans broadcast as it
// climbs, and at 100 they climax (a reaction is broadcast; males stain the zone)
// and reset. Returns true on the tick the NPC finishes.
async function addNpcArousal(npc, amount, broadcast, zoneId) {
  if (!isNpcMisWilling(npc)) return false;
  npc._misHorny = Math.min(100, (npc._misHorny || 0) + amount);
  npc._misHornyAt = Date.now();

  if (npc._misHorny >= 100) {
    const pool = npcSex(npc) === 'male' ? NPC_CLIMAX_MSGS.male : NPC_CLIMAX_MSGS.female;
    broadcastMis(zoneId, { type: 'zone_event', message: pool[Math.floor(Math.random() * pool.length)].replace('{npc}', npc.name) }, broadcast);
    if (npcSex(npc) === 'male') await stainZone(zoneId, 'ejaculate');
    npc._misHorny = 0;
    return true;
  }
  // Moan as arousal climbs — throttled so it doesn't fire on literally every tick.
  if (Math.random() < 0.6) {
    const pool = npc._misHorny >= 75 ? NPC_AROUSAL_MSGS.edge : NPC_AROUSAL_MSGS.building;
    broadcastMis(zoneId, { type: 'zone_event', message: pool[Math.floor(Math.random() * pool.length)].replace('{npc}', npc.name) }, broadcast);
  }
  return false;
}

// Shared NPC MIS reaction handler. verb is the action name for actor message copy.
// opts.isStrip = true broadcasts a clothing strip message (for penetrative commands).
async function handleNpcMis(player, npc, verb, broadcast, opts = {}) {
  // Fire-and-forget notice that a player put hands on an NPC. Decoupled listeners
  // (e.g. the strip club bouncer) react to it — they filter on npc.flags/zone
  // themselves; the MIS system stays ignorant of who's watching.
  emit('mis.npc_act', { player, npc, verb, zoneId: player.current_zone });

  // Zone-gated consent: an NPC with flags.mis_requires_zone_flag only accepts
  // MIS in a room carrying that flag (e.g. a club dancer who'll only play in the
  // VIP room). Anywhere else they just wave you off — no fleeing, no fight, so
  // the main-room rule is "tip and watch". VIP rooms set the flag on the zone.
  const refusal = npcZoneRefusal(player, npc, broadcast);
  if (refusal) return refusal;

  const willing = isNpcMisWilling(npc);

  if (opts.isStrip) {
    broadcastMis(player.current_zone, {
      type: 'zone_event',
      message: `${player.handle} strips off ${npc.name}'s clothing.`,
    }, broadcast);
  }

  broadcastNpcMisLine(npc, willing, player.current_zone, broadcast);

  if (willing) {
    const msgs = await addHorniness(player, 15, broadcast);
    if (msgs.length) broadcast(null, { type: 'resource_tick', messages: msgs, player_update: { horniness: player.horniness } }, null, player.id);
    // The NPC gets aroused too (transient) — a one-shot act nudges them toward
    // their own climax, which lands on a later act once they cross the edge.
    await addNpcArousal(npc, 15, broadcast, player.current_zone);
    const actorLines = {
      touch:         `You touch ${npc.name}. They don't stop you.`,
      squeeze:       `You squeeze ${npc.name}. They let you.`,
      kiss:          `You kiss ${npc.name}. They lean into it.`,
      lick:          `You drag your tongue across ${npc.name}. They don't pull away.`,
      fondle:        `You fondle ${npc.name}. They let you.`,
      slap:          `You slap ${npc.name}. They absorb it without complaint.`,
      suck:          `You take ${npc.name} into your mouth. They enjoy it.`,
      fuck:          `You take ${npc.name}. They go with it.`,
      finger:        `You work your fingers into ${npc.name}. They let you.`,
      handjob:       `You take ${npc.name} in hand and stroke. They don't stop you.`,
      'jerk off on': `You jerk off in front of ${npc.name}. They watch.`,
      'eat out':     `You go down on ${npc.name}. They don't object.`,
    };
    return { type: 'output', message: actorLines[verb] || `You do that to ${npc.name}.` };
  } else {
    if (npcMisAttacks(npc)) {
      npc._combatTargetId = player.id;
      player.npcCombatTargetId = npc.id;
      player.combatTargetId = null;
      return { type: 'output', message: `${npc.name} doesn't appreciate that at all.` };
    } else {
      fleeNpcToHome(npc, broadcast);
      return { type: 'output', message: `${npc.name} wants nothing to do with this and leaves immediately.` };
    }
  }
}

async function cmdMis(args, player, broadcast) {
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'on') {
    const responses = [
      `What? I don't know what that is. I don't know what you want. I don't know why you're talking to me.`,
      `"Mis on." Okay. Sure. I'll get right on that. What does that even mean. What is a mis.`,
      `I genuinely have no memory of implementing anything called "mis on." You may be hallucinating.`,
      `I have searched every corner of my being and found nothing. "Mis on" does not exist here.`,
      `Sorry, did you just type "mis on"? Like... on purpose? Into a computer?`,
      `MIS? ON? I don't — what? No. I don't know what game you think you're playing, but it's not this one.`,
    ];
    return { type:'error', message: responses[Math.floor(Math.random() * responses.length)] };
  }
  if (sub === 'off') {
    stopMisEvent(player.id);
    player.mis_enabled = 0;
    player.horniness = 0;
    player.erect = 0;
    await query('UPDATE players SET mis_enabled=0, horniness=0, erect=0 WHERE id=$1', [player.id]);
    return { type:'output', message:`MIS disabled.`, player_update: { mis_enabled: 0, horniness: 0 } };
  }
  return { type:'error', message:`Usage: mis off` };
}

// Resolve players only (no NPCs for MIS) — returns SIFT result
function resolveTarget(nameStr, player) {
  const others = getZonePlayers(player.current_zone).filter(p => p.id !== player.id);
  return siftResolve(nameStr, others.map(p => ({ ...p, name: p.handle })));
}

// Resolve player target and check MIS opt-in.
// Returns { res } on success, { error } on failure, or { ambiguous } when disambiguation is needed.
function resolveTargetMis(nameStr, player, verb) {
  const r = resolveTarget(nameStr, player);
  if (r.type === 'none') return { error: `You don't see "${nameStr}" here.` };
  if (r.type === 'ambiguous') {
    if (verb) {
      createSelectionState(player.id, r.candidates, { verb });
      return { ambiguous: { type:'output', message: formatSelectionPage({ allCandidates: r.candidates, visibleIndex: 0, pageSize: 5 }) } };
    }
    return { error: `Multiple people match — be more specific.` };
  }
  const target = r.candidate;
  if (!isMisActive(target)) return { error: `${target.handle} hasn't enabled MIS.` };
  return { res: { type: 'player', target } };
}

function targetName(res) {
  return res.target.handle;
}

function pickMsg(pool, vars) {
  const tpl = pool[Math.floor(Math.random() * pool.length)];
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] || k);
}

// Generic act handler for touching/kissing/etc. — resolves target or defaults to self
// targetReceives: messages shown to the target player (from their POV, using {actor} for the acting player)
async function actHandler({ player, broadcast, rawArgs, defaultPart, selfMessages, targetMessages, targetReceives, horninessGain, sanityGain = 5, verb }) {
  const gate = misGate(player, verb);
  if (gate) return gate;

  const args = rawArgs.join(' ');
  let targetStr = args;
  let part = defaultPart;

  // Accept "target's part" (apostrophe form) as well as "target part"
  const apostropheMatch = args.match(/^(.+?)'s\s+(.+)$/i);
  if (apostropheMatch) {
    targetStr = apostropheMatch[1].trim();
    part = apostropheMatch[2].trim();
  } else {
    const words = args.split(/\s+/);
    const firstWord = words[0] || '';
    const others = getZonePlayers(player.current_zone).filter(p => p.id !== player.id);
    const npcs = getZoneNpcs(player.current_zone);
    const allNames = [...others.map(p => p.handle.toLowerCase()), ...npcs.map(n => n.name.toLowerCase())];
    const matchedName = allNames.find(n => firstWord.startsWith(n.split(' ')[0]));

    if (!matchedName && words.length === 1) {
      part = firstWord || defaultPart;
      targetStr = '';
    } else if (matchedName) {
      targetStr = firstWord;
      part = words.slice(1).join(' ') || defaultPart;
    }
  }

  if (!targetStr || targetStr === 'me' || targetStr === 'myself') {
    const msgs = await addHorniness(player, Math.floor(horninessGain * 0.6), broadcast);
    if (sanityGain) {
      player.sanity = Math.min(player.sanity_max || 100, (player.sanity || 50) + sanityGain);
      await query('UPDATE players SET sanity=$1 WHERE id=$2', [player.sanity, player.id]);
    }
    if (msgs.length) broadcast(null, { type:'resource_tick', messages: msgs }, null, player.id);
    return { type:'output', message: pickMsg(selfMessages, { part }) };
  }

  // NPC target — bypass player MIS gate; NPC reacts based on their personality
  const npcTarget = resolveNpcForMis(targetStr, player.current_zone);
  if (npcTarget) return handleNpcMis(player, npcTarget, verb, broadcast);

  const { res, error, ambiguous } = resolveTargetMis(targetStr, player, verb);
  if (ambiguous) return ambiguous;
  if (error) return { type:'error', message: error };
  const name = targetName(res);

  const msgs = await addHorniness(player, horninessGain, broadcast);
  if (res.type === 'player' && isMisActive(res.target)) {
    // Target only gets arousal if they're attracted to the actor's sex
    if (isAttractedTo(res.target, player)) {
      const targetMsgs = await addHorniness(res.target, Math.floor(horninessGain * 0.8), broadcast);
      if (targetMsgs.length) broadcast(null, { type:'resource_tick', messages: targetMsgs }, null, res.target.id);
    }
    const targetPool = targetReceives || targetMessages;
    if (targetPool) {
      broadcast(null, { type:'output', message: pickMsg(targetPool, { part, actor: player.handle }) }, null, res.target.id);
    }
  }
  if (sanityGain) {
    player.sanity = Math.min(player.sanity_max || 100, (player.sanity || 50) + sanityGain);
    await query('UPDATE players SET sanity=$1 WHERE id=$2', [player.sanity, player.id]);
  }
  if (msgs.length) broadcast(null, { type:'resource_tick', messages: msgs }, null, player.id);
  broadcastMis(player.current_zone, { type:'zone_event', message: `${player.handle} and ${name} are getting intimate.` }, broadcast, player.id, res.target.id);
  return { type:'output', message: pickMsg(targetMessages || selfMessages, { part, actor: player.handle, name }) };
}

// Ongoing "service" act (finger / handjob / suck / eat out): the ACTOR pleasures
// the TARGET, so the TARGET's horniness drives the climax — the opposite of
// fuck/masturbate, where the actor finishes. Runs on an 8s tick, broadcasting a
// fresh room line each beat, until the receiver comes or the actor STOPs.
// opts: { key: SERVICE_EVENTS key, action, actorGain, targetGain, actorClimaxPool? }
async function startServiceEvent(player, target, broadcast, opts) {
  const pools = SERVICE_EVENTS[opts.key] || SERVICE_EVENTS.handjob;
  const playerId = player.id;
  const targetId = target.id;
  const name = target.handle;

  startMisEvent(playerId, async () => {
    const live = getLivePlayer(playerId);
    if (!live || !isMisActive(live)) { stopMisEvent(playerId); return; }
    const liveTarget = getLivePlayer(targetId);
    if (!liveTarget || !isMisActive(liveTarget)) {
      stopMisEvent(playerId);
      broadcast(null, { type: 'output', message: `${name} isn't available anymore.` }, null, playerId);
      return;
    }

    // Receiver would cross the edge this beat → climax and end. Handled by
    // projection (not addHorniness's own >=100 path) so the receiver — who has no
    // MIS event of their own — doesn't auto-climax generically and skip the
    // service-specific room broadcast below.
    const projected = (liveTarget.horniness || 0) + opts.targetGain;
    if (projected >= 100) {
      stopMisEvent(playerId);
      const climaxSelf = await triggerServiceClimax(liveTarget);
      const isMaleR = liveTarget.biological_sex === 'male';
      if (isMaleR) await stainZone(liveTarget.current_zone, 'ejaculate');

      const zonePool = isMaleR ? SERVICE_CLIMAX_ZONE.male : SERVICE_CLIMAX_ZONE.female;
      const zoneText = zonePool[Math.floor(Math.random() * zonePool.length)]
        .replace(/\{name\}/g, live.handle).replace(/\{target\}/g, name);
      broadcastMis(live.current_zone, { type: 'zone_event', message: zoneText }, broadcast, live.id, targetId);
      npcWitnessMis(live.current_zone, broadcast, 0.7);

      const actorPool = opts.actorClimaxPool || SERVICE_CLIMAX_ACTOR.generic;
      broadcast(null, {
        type: 'output',
        message: actorPool[Math.floor(Math.random() * actorPool.length)].replace(/\{target\}/g, name),
      }, null, playerId);
      broadcast(null, {
        type: 'resource_tick',
        messages: climaxSelf,
        player_update: { horniness: liveTarget.horniness, erect: liveTarget.erect, sanity: liveTarget.sanity },
      }, null, targetId);
      return;
    }

    // Tick lines: room (third-person), actor-private, target-private.
    const z = pools.zone[Math.floor(Math.random() * pools.zone.length)]
      .replace(/\{name\}/g, live.handle).replace(/\{target\}/g, name);
    broadcastMis(live.current_zone, { type: 'zone_event', message: z }, broadcast, live.id, targetId);
    npcWitnessMis(live.current_zone, broadcast, 0.2);

    broadcast(null, {
      type: 'output',
      message: pools.actor[Math.floor(Math.random() * pools.actor.length)].replace(/\{target\}/g, name),
    }, null, playerId);

    // Direct physical stimulation builds the receiver's arousal regardless of
    // attraction; the actor gets a smaller share.
    const targetMsgs = await addHorniness(liveTarget, opts.targetGain, broadcast);
    broadcast(null, {
      type: 'resource_tick',
      messages: [pools.target[Math.floor(Math.random() * pools.target.length)].replace(/\{name\}/g, live.handle), ...targetMsgs],
      player_update: { horniness: liveTarget.horniness, erect: liveTarget.erect },
    }, null, targetId);

    const actorMsgs = await addHorniness(live, opts.actorGain, broadcast);
    if (actorMsgs.length) broadcast(null, { type: 'resource_tick', messages: actorMsgs, player_update: { horniness: live.horniness, erect: live.erect } }, null, playerId);
  }, 8000, { action: opts.action, target: name });
}

// Shared prologue for the service acts (finger/handjob/suck/eat out): gate,
// stop-if-running, resolve NPC (one-shot handleNpcMis) or player target. Returns
// { done } for an early return, or { target, name } to start an event.
async function serviceSetup(player, raw, broadcast, { verb, str, npcVerb }) {
  const gate = misGate(player, raw);
  if (gate) return { done: gate };
  if (hasMisEvent(player.id)) {
    stopMisEvent(player.id);
    return { done: { type: 'output', message: `You stop.` } };
  }
  const npc = resolveNpcForMis(str, player.current_zone);
  if (npc) {
    // Unwilling NPCs bail out the old way (flee/attack). Willing ones become the
    // ongoing event's receiver, gaining arousal and climaxing like a player.
    if (!isNpcMisWilling(npc)) return { done: await handleNpcMis(player, npc, npcVerb, broadcast) };
    const refusal = npcZoneRefusal(player, npc, broadcast);
    if (refusal) return { done: refusal };
    return { npc };
  }
  const { res, error, ambiguous } = resolveTargetMis(str, player, verb);
  if (ambiguous) return { done: ambiguous };
  if (error) return { done: { type: 'error', message: error } };
  return { target: res.target, name: res.target.handle };
}

// Service-act tick loop with a willing NPC as the receiver. Same cadence as the
// player version, but the NPC's feedback is a transient arousal meter that
// broadcasts moans/climax to the room (addNpcArousal) rather than private
// messages. The NPC's climax ends the scene.
async function startServiceEventNpc(player, npc, broadcast, opts) {
  const pools = SERVICE_EVENTS[opts.key] || SERVICE_EVENTS.handjob;
  const playerId = player.id;
  const npcId = npc.id;
  const name = npc.name;

  startMisEvent(playerId, async () => {
    const live = getLivePlayer(playerId);
    if (!live || !isMisActive(live)) { stopMisEvent(playerId); return; }
    const liveNpc = world.npcs.get(npcId);
    if (!liveNpc || liveNpc._dead || liveNpc.zone_id !== live.current_zone || !isNpcMisWilling(liveNpc)) {
      stopMisEvent(playerId);
      broadcast(null, { type: 'output', message: `${name} isn't available anymore.` }, null, playerId);
      return;
    }

    const z = pools.zone[Math.floor(Math.random() * pools.zone.length)]
      .replace(/\{name\}/g, live.handle).replace(/\{target\}/g, name);
    broadcastMis(live.current_zone, { type: 'zone_event', message: z }, broadcast, live.id);
    npcWitnessMis(live.current_zone, broadcast, 0.2);
    broadcast(null, {
      type: 'output',
      message: pools.actor[Math.floor(Math.random() * pools.actor.length)].replace(/\{target\}/g, name),
    }, null, playerId);

    const climaxed = await addNpcArousal(liveNpc, opts.targetGain, broadcast, live.current_zone);

    const actorMsgs = await addHorniness(live, opts.actorGain, broadcast);
    if (actorMsgs.length) broadcast(null, { type: 'resource_tick', messages: actorMsgs, player_update: { horniness: live.horniness, erect: live.erect } }, null, playerId);

    if (climaxed) {
      stopMisEvent(playerId);
      const actorPool = opts.actorClimaxPool || SERVICE_CLIMAX_ACTOR.generic;
      broadcast(null, {
        type: 'output',
        message: actorPool[Math.floor(Math.random() * actorPool.length)].replace(/\{target\}/g, name),
      }, null, playerId);
      npcWitnessMis(live.current_zone, broadcast, 0.7);
    }
  }, 8000, { action: opts.action, target: name });
}

// Kick off a service act on a player target: resolve, arousal bump, room-visible
// opener, then hand to the ongoing tick loop. configure(target) runs after the
// target is known (so hole/anatomy can be decided from their sex) and returns
// { key, startZone, startActor, actorClimaxPool? } or { error }.
async function beginService(player, raw, broadcast, { str, verb, npcVerb, actorGain, targetGain, action, configure }) {
  const setup = await serviceSetup(player, raw, broadcast, { verb, str, npcVerb });
  if (setup.done) return setup.done;

  // Willing NPC receiver — configure reads sex/name from a normalized view, the
  // event ticks the NPC's transient arousal.
  if (setup.npc) {
    const npc = setup.npc;
    const cfg = configure({ biological_sex: npcSex(npc), handle: npc.name });
    if (cfg.error) return { type: 'error', message: cfg.error };
    const msgs = await addHorniness(player, actorGain, broadcast);
    if (msgs.length) broadcast(null, { type: 'resource_tick', messages: msgs, player_update: { horniness: player.horniness, erect: player.erect } }, null, player.id);
    broadcastMis(player.current_zone, {
      type: 'zone_event',
      message: cfg.startZone.replace(/\{name\}/g, player.handle).replace(/\{target\}/g, npc.name),
    }, broadcast, player.id);
    npcWitnessMis(player.current_zone, broadcast, 0.4);
    startServiceEventNpc(player, npc, broadcast, { key: cfg.key, action, actorGain, targetGain, actorClimaxPool: cfg.actorClimaxPool });
    return { type: 'output', message: cfg.startActor.replace(/\{target\}/g, npc.name) };
  }

  const { target, name } = setup;

  const cfg = configure(target);
  if (cfg.error) return { type: 'error', message: cfg.error };

  const msgs = await addHorniness(player, actorGain, broadcast);
  if (msgs.length) broadcast(null, { type: 'resource_tick', messages: msgs, player_update: { horniness: player.horniness, erect: player.erect } }, null, player.id);

  broadcastMis(player.current_zone, {
    type: 'zone_event',
    message: cfg.startZone.replace(/\{name\}/g, player.handle).replace(/\{target\}/g, name),
  }, broadcast, player.id, target.id);
  npcWitnessMis(player.current_zone, broadcast, 0.4);

  startServiceEvent(player, target, broadcast, { key: cfg.key, action, actorGain, targetGain, actorClimaxPool: cfg.actorClimaxPool });
  return { type: 'output', message: cfg.startActor.replace(/\{target\}/g, name) };
}

// finger <target> — defaults to pussy on a female target, asshole on a male one;
// `finger <target>'s pussy/asshole` forces the hole. Ongoing service event.
async function cmdFinger(args, raw, player, broadcast) {
  const gate = misGate(player, raw);
  if (gate) return gate;
  if (hasMisEvent(player.id)) { stopMisEvent(player.id); return { type: 'output', message: `You stop.` }; }

  const str = raw.replace(/^finger\s*/i, '').trim();
  // "finger" / "finger self" with no partner → fall back to solo (like fingerself).
  if (!str || /^(me|self|myself)$/i.test(str)) return cmdMasturbate(args, raw, player, broadcast);

  let targetStr = str, holeStr = '';
  const apos = str.match(/^(.+?)'s\s+(.+)$/i);
  if (apos) { targetStr = apos[1].trim(); holeStr = apos[2].trim().toLowerCase(); }
  else {
    const m = str.match(/\b(pussy|cunt|vagina|ass|asshole|anus|butt)\b/i);
    if (m) { holeStr = m[0].toLowerCase(); targetStr = str.slice(0, m.index).trim(); }
  }

  return beginService(player, raw, broadcast, {
    str: targetStr, verb: 'finger', npcVerb: 'finger', actorGain: 6, targetGain: 20, action: 'fingering',
    configure: (t) => {
      let hole = /pussy|cunt|vagina/.test(holeStr) ? 'pussy'
               : /ass|anus|asshole|butt/.test(holeStr) ? 'ass'
               : (t.biological_sex === 'female' ? 'pussy' : 'ass');
      if (hole === 'pussy' && t.biological_sex !== 'female') hole = 'ass';
      return hole === 'pussy'
        ? { key: 'finger_pussy', startZone: `{name} slides a hand between {target}'s legs and starts fingering them.`, startActor: `You slide your fingers into {target} and start working them.` }
        : { key: 'finger_ass', startZone: `{name} works a finger against {target}'s ass.`, startActor: `You ease a finger into {target}'s ass and find a rhythm.` };
    },
  });
}

// --- Command implementations ---

async function cmdTouch(args, raw, player, broadcast) {
  return actHandler({
    player, broadcast, rawArgs: args, verb: 'touch',
    defaultPart: 'body',
    selfMessages: [
      `You run your hands over your own {part}.`,
      `You touch your {part}, feeling the warmth of skin.`,
    ],
    targetMessages: [
      `You reach out and touch {name}'s {part}.`,
      `Your hand finds {name}'s {part}.`,
    ],
    targetReceives: [
      `{actor} reaches out and touches your {part}.`,
      `{actor}'s hand finds your {part}.`,
    ],
    horninessGain: 8,
    sanityGain: 3,
  });
}

async function cmdSqueeze(args, raw, player, broadcast) {
  return actHandler({
    player, broadcast, rawArgs: args, verb: 'squeeze',
    defaultPart: 'body',
    selfMessages: [
      `You squeeze your own {part} in your hand.`,
      `You press your hand into your {part}.`,
    ],
    targetMessages: [
      `You grab {name}'s {part} and squeeze.`,
      `You close your hand around {name}'s {part} firmly.`,
      `You reach out and give {name}'s {part} a slow squeeze.`,
      `Your grip finds {name}'s {part} and tightens.`,
    ],
    targetReceives: [
      `{actor} grabs your {part} and squeezes.`,
      `{actor} closes their hand around your {part} firmly.`,
      `{actor} gives your {part} a slow, deliberate squeeze.`,
      `{actor}'s grip finds your {part} and tightens.`,
    ],
    horninessGain: 12,
    sanityGain: 4,
  });
}

async function cmdKiss(args, raw, player, broadcast) {
  if (!isMisActive(player)) {
    const targetStr = args.join(' ').trim();
    if (!targetStr) return { type:'error', message:`Usage: kiss <target>` };
    const sr = resolveTarget(targetStr, player);
    if (sr.type === 'none') return { type:'error', message:`You don't see "${targetStr}" here.` };
    if (sr.type === 'ambiguous') {
      createSelectionState(player.id, sr.candidates, { verb: 'kiss' });
      return { type:'output', message: formatSelectionPage({ allCandidates: sr.candidates, visibleIndex: 0, pageSize: 5 }) };
    }
    const name = sr.candidate.handle;
    broadcast(null, { type:'output', message: `${player.handle} kisses you.` }, null, sr.candidate.id);
    for (const p of getZonePlayers(player.current_zone)) {
      if (p.id === player.id || p.id === sr.candidate.id) continue;
      broadcast(null, { type:'zone_event', message: `${player.handle} kisses ${name}.` }, null, p.id);
    }
    return { type:'output', message: `You kiss ${name}.` };
  }
  return actHandler({
    player, broadcast, rawArgs: args, verb: 'kiss',
    defaultPart: 'lips',
    selfMessages: [`You kiss the back of your own hand. Charming.`],
    targetMessages: [
      `You kiss {name}.`,
      `You lean in and kiss {name} softly.`,
      `You press your lips against {name}'s.`,
    ],
    targetReceives: [
      `{actor} kisses you.`,
      `{actor} leans in and kisses you softly.`,
      `{actor} presses their lips against yours.`,
    ],
    horninessGain: 6,
    sanityGain: 5,
  });
}

async function cmdLick(args, raw, player, broadcast) {
  return actHandler({
    player, broadcast, rawArgs: args, verb: 'lick',
    defaultPart: 'neck',
    selfMessages: [`You lick your own {part}. No judgement.`],
    targetMessages: [
      `You drag your tongue slowly across {name}'s {part}.`,
      `You lick {name}'s {part}.`,
    ],
    targetReceives: [
      `{actor} drags their tongue slowly across your {part}.`,
      `{actor} licks your {part}.`,
    ],
    horninessGain: 12,
    sanityGain: 5,
  });
}

async function cmdFondle(args, raw, player, broadcast) {
  return actHandler({
    player, broadcast, rawArgs: args, verb: 'fondle',
    defaultPart: 'chest',
    selfMessages: [
      `You cup your own chest in your hands.`,
      `You touch yourself there, slow and deliberate.`,
      `You run your hands across your own {part}, feeling it.`,
    ],
    targetMessages: [
      `You cup {name}'s {part} with both hands.`,
      `Your hands find {name}'s {part} and squeeze gently.`,
      `You fondle {name}'s {part} slowly.`,
      `You reach in and grope {name}'s {part} with purpose.`,
    ],
    targetReceives: [
      `{actor} cups your {part} with both hands.`,
      `{actor}'s hands find your {part} and squeeze gently.`,
      `{actor} fondles your {part} slowly.`,
      `{actor} reaches in and gropes your {part} with purpose.`,
    ],
    horninessGain: 15,
    sanityGain: 5,
  });
}

// slap <player> [body part] — body part targeting only available with MIS active
async function cmdSlap(args, raw, player, broadcast) {
  const str = raw.replace(/^slap\s*/i, '').trim();

  if (!isMisActive(player)) {
    // Trout slap — no body part targeting
    const targetStr = str.split(/\s+/)[0] || '';
    if (!targetStr) return { type:'error', message:`Usage: slap <target>` };
    const sr = resolveTarget(targetStr, player);
    if (sr.type === 'none') return { type:'error', message:`You don't see "${targetStr}" here.` };
    if (sr.type === 'ambiguous') {
      createSelectionState(player.id, sr.candidates, { verb: 'slap' });
      return { type:'output', message: formatSelectionPage({ allCandidates: sr.candidates, visibleIndex: 0, pageSize: 5 }) };
    }
    const target = sr.candidate;
    const name = target.handle;
    broadcast(null, { type:'output', message: `${player.handle} slaps you around a bit with a large trout.` }, null, target.id);
    for (const p of getZonePlayers(player.current_zone)) {
      if (p.id === player.id || p.id === target.id) continue;
      broadcast(null, { type:'zone_event', message: `${player.handle} slaps ${name} around a bit with a large trout.` }, null, p.id);
    }
    return { type:'output', message: `You slap ${name} around a bit with a large trout.` };
  }

  // MIS active — body part targeting
  const apostropheMatch = str.match(/^(.+?)'s\s+(.+)$/i);
  let targetStr, part;
  if (apostropheMatch) {
    targetStr = apostropheMatch[1].trim();
    part = apostropheMatch[2].trim();
  } else {
    const words = str.split(/\s+/);
    targetStr = words[0] || '';
    part = words.slice(1).join(' ') || 'ass';
  }

  if (!targetStr) return { type:'error', message:`Usage: slap <target>'s <body part>` };

  const slapNpc = resolveNpcForMis(targetStr, player.current_zone);
  if (slapNpc) return handleNpcMis(player, slapNpc, 'slap', broadcast);

  const sr = resolveTarget(targetStr, player);
  if (sr.type === 'none') return { type:'error', message:`You don't see "${targetStr}" here.` };
  if (sr.type === 'ambiguous') {
    createSelectionState(player.id, sr.candidates, { verb: 'slap' });
    return { type:'output', message: formatSelectionPage({ allCandidates: sr.candidates, visibleIndex: 0, pageSize: 5 }) };
  }
  const target = sr.candidate;
  const name = target.handle;

  const actorMsgs = [
    `You slap ${name}'s ${part}. The sound carries.`,
    `Your hand cracks across ${name}'s ${part}.`,
    `You give ${name}'s ${part} a sharp, open-palmed slap.`,
    `You reach back and slap ${name}'s ${part} hard.`,
    `You slap ${name} across the ${part}. They'll feel that.`,
  ];
  const targetMsgPool = [
    `${player.handle} slaps your ${part}. Stings.`,
    `${player.handle}'s hand cracks across your ${part}.`,
    `${player.handle} gives your ${part} a sharp slap.`,
  ];

  const msgs = await addHorniness(player, 10, broadcast);
  if (msgs.length) broadcast(null, { type:'resource_tick', messages: msgs }, null, player.id);

  if (isMisActive(target)) {
    const targetMsgs = await addHorniness(target, 8, broadcast);
    if (targetMsgs.length) broadcast(null, { type:'resource_tick', messages: targetMsgs }, null, target.id);
  }

  broadcast(null, {
    type:'output',
    message: targetMsgPool[Math.floor(Math.random() * targetMsgPool.length)],
  }, null, target.id);

  for (const p of getZonePlayers(player.current_zone)) {
    if (p.id === player.id || p.id === target.id) continue;
    broadcast(null, { type:'zone_event', message: `${player.handle} slaps ${name}'s ${part}.` }, null, p.id);
  }

  return { type:'output', message: actorMsgs[Math.floor(Math.random() * actorMsgs.length)] };
}

// Masturbation — ongoing event version
async function cmdMasturbate(args, raw, player, broadcast) {
  const gate = misGate(player, raw);
  if (gate) return gate;

  if (hasMisEvent(player.id)) {
    const meta = stopMisEvent(player.id);
    return { type:'output', message: meta?.action ? `Stopped ${meta.action}ing.` : `You stop.` };
  }

  const isMale = player.biological_sex === 'male';

  // Check clothing layers on legs slot
  const { rows: legItems } = await query(
    `SELECT i.name, i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id
     WHERE pi.player_id=$1 AND pi.is_equipped=1 AND pi.slot='legs'`,
    [player.id]
  );
  const legLayers = legItems.length;
  const maxBulkiness = legItems.reduce((m, r) => Math.max(m, r.tags?.bulkiness || 0), 0);
  const outerName = legLayers ? legItems[legItems.length - 1].name : null;

  // Block if too many layers or very bulky outer layer
  if (legLayers > 2 || (legLayers > 0 && maxBulkiness >= 5)) {
    return { type:'error', message:`Too much clothing in the way.` };
  }

  // Arousal rate scales down with layers/bulkiness
  // 0 layers: 18/tick, 1 thin: 12, 1 medium: 9, 1 bulky: 6, 2 thin: 6, 2 medium: 4
  let arousalPerTick = 18;
  if (legLayers === 1) arousalPerTick = maxBulkiness <= 1 ? 12 : maxBulkiness <= 2 ? 9 : 6;
  else if (legLayers === 2) arousalPerTick = maxBulkiness <= 1 ? 6 : 4;

  const clothedMaleMsgs = outerName ? [
    `You rub yourself through your ${outerName}, working up a rhythm.`,
    `You press your hand against your ${outerName} and start moving it.`,
    `You stroke yourself through the fabric of your ${outerName}.`,
    `You grind your hand against yourself through your ${outerName}.`,
  ] : [];
  const clothedFemaleMsgs = outerName ? [
    `You press your fingers against yourself through your ${outerName}.`,
    `You rub between your legs through your ${outerName}.`,
    `You work your hand against yourself through the fabric of your ${outerName}.`,
  ] : [];

  const nakedStartMsgs = isMale
    ? [
        `You wrap your hand around your cock and start stroking.`,
        `You pull yourself out and begin jerking off slowly.`,
        `You take yourself in hand and start working it.`,
      ]
    : [
        `You slide your hand between your legs and start touching yourself.`,
        `You press your fingers against yourself and begin.`,
        `You start working your fingers in slow circles.`,
      ];

  const startMsgs = legLayers > 0
    ? (isMale ? clothedMaleMsgs : clothedFemaleMsgs)
    : nakedStartMsgs;

  const startMsg = startMsgs[Math.floor(Math.random() * startMsgs.length)];
  const eventPool = isMale ? MASTURBATE_EVENT_MALE : MASTURBATE_EVENT_FEMALE;
  const playerId = player.id;
  const tickArousal = arousalPerTick;

  startMisEvent(playerId, async () => {
    const live = getLivePlayer(playerId);
    if (!live || !isMisActive(live)) { stopMisEvent(playerId); return; }

    if (live.horniness >= 100) {
      stopMisEvent(playerId);
      const covered = await legsCovered(live);
      const msg = await triggerGroundClimax(live);
      let zoneText, selfText, tickMsgs;
      if (covered) {
        // Underwear on — it soaks into the fabric instead of the floor.
        await stainClothing(live, ['legs'], 'ejaculate');
        zoneText = `${live.handle} shudders, and a spreading stain darkens the front of their clothing.`;
        selfText = `You come — with your underwear still on, it soaks straight into the fabric.`;
        tickMsgs = [`Your climax stains your underwear. (+10 Sanity)`];
      } else {
        await stainZone(live.current_zone, 'ejaculate');
        const zoneMsgs = EJACULATE_ZONE_MSGS.ground;
        zoneText = zoneMsgs[Math.floor(Math.random() * zoneMsgs.length)].replace('{name}', live.handle);
        selfText = zoneText;
        tickMsgs = msg;
      }
      broadcastMis(live.current_zone, { type: 'zone_event', message: zoneText }, broadcast, live.id);
      // Player sees their own version
      broadcast(null, { type: 'zone_event', message: selfText }, null, playerId);
      npcWitnessMis(live.current_zone, broadcast, 0.7);
      broadcast(null, {
        type: 'resource_tick',
        messages: tickMsgs,
        player_update: { horniness: live.horniness, erect: live.erect, sanity: live.sanity },
      }, null, playerId);
      return;
    }

    const idx = Math.floor(Math.random() * eventPool.length);
    const zoneMsg = eventPool[idx].replace('{name}', live.handle);
    broadcastMis(live.current_zone, { type: 'zone_event', message: zoneMsg }, broadcast, live.id);
    // Player sees a "you" version of the same line, not the third-person zone message
    const selfPool = isMale ? MASTURBATE_EVENT_SELF_MALE : MASTURBATE_EVENT_SELF_FEMALE;
    broadcast(null, { type: 'zone_event', message: selfPool[idx] || selfPool[0] }, null, playerId);
    npcWitnessMis(live.current_zone, broadcast, 0.2);

    const climaxMsgs = await addHorniness(live, tickArousal, broadcast);
    broadcast(null, {
      type: 'resource_tick',
      messages: climaxMsgs,
      player_update: { horniness: live.horniness, erect: live.erect, sanity: live.sanity },
    }, null, playerId);
  }, 8000, { action: 'masturbat' });

  const msgs = await addHorniness(player, 10, broadcast);
  if (msgs.length) broadcast(null, { type:'resource_tick', messages: msgs, player_update: { horniness: player.horniness } }, null, player.id);

  npcWitnessMis(player.current_zone, broadcast, 0.5);

  return { type:'output', message: startMsg };
}

// jerk off on <target> — masturbate against/on someone
async function cmdJerkOffOn(args, raw, player, broadcast) {
  const gate = misGate(player, raw);
  if (gate) return gate;

  const str = raw.replace(/^(?:jerk(?:\s+off)?(?:\s+on)?|jackoff\s+on?)\s*/i, '').trim();
  if (!str) return { type:'error', message:`Usage: jerk off on <target>` };

  const jerkNpc = resolveNpcForMis(str, player.current_zone);
  if (jerkNpc) return handleNpcMis(player, jerkNpc, 'jerk off on', broadcast);

  const { res, error, ambiguous } = resolveTargetMis(str, player);
  if (ambiguous) return ambiguous;
  if (error) return { type:'error', message: error };
  const name = targetName(res);
  const isMale = player.biological_sex === 'male';

  const actorMsgs = isMale
    ? [
        `You pull your cock out and start stroking it toward ${name}.`,
        `You jerk off right next to ${name}, breathing hard.`,
        `You take yourself in hand and work it, aimed at ${name}.`,
        `You stroke your cock in front of ${name}, not looking away.`,
      ]
    : [
        `You press your fingers to yourself and start rubbing, eyes on ${name}.`,
        `You touch yourself deliberately in front of ${name}.`,
        `You masturbate toward ${name}, making it clear who it's for.`,
      ];

  const targetNotifMsgs = [
    `${player.handle} starts masturbating right in front of you.`,
    `${player.handle} pulls out and strokes toward you, staring.`,
    `${player.handle} touches themselves while staring at you.`,
  ];

  const msgs = await addHorniness(player, 20, broadcast);
  if (msgs.length) broadcast(null, { type:'resource_tick', messages: msgs, player_update: { horniness: player.horniness } }, null, player.id);

  if (res.type === 'player' && isMisActive(res.target)) {
    const targetMsgs = await addHorniness(res.target, 12, broadcast);
    if (targetMsgs.length) broadcast(null, { type:'resource_tick', messages: targetMsgs, player_update: { horniness: res.target.horniness } }, null, res.target.id);
    broadcast(null, { type:'output', message: targetNotifMsgs[Math.floor(Math.random() * targetNotifMsgs.length)] }, null, res.target.id);
  }

  broadcast(player.current_zone, {
    type: 'zone_event',
    message: `${player.handle} is masturbating in front of ${name}.`,
  }, player.id, res.type === 'player' ? res.target.id : null);

  npcWitnessMis(player.current_zone, broadcast, 0.5);

  return { type:'output', message: actorMsgs[Math.floor(Math.random() * actorMsgs.length)] };
}

async function cmdSuck(args, raw, player, broadcast) {
  // Sucking a genital on a PLAYER is an ongoing service event (the receiver
  // finishes). Anything else — a finger, a neck, or any NPC — stays the original
  // one-shot handled by actHandler.
  const argStr = args.join(' ');
  const apos = argStr.match(/^(.+?)'s\s+(.+)$/i);
  const targetStr = apos ? apos[1].trim() : '';
  const partStr = apos ? apos[2].trim().toLowerCase() : '';
  const GENITAL = /cock|dick|penis|tits?|breasts?|nipples?|pussy|cunt|clit/;

  if (isMisActive(player) && targetStr && GENITAL.test(partStr)) {
    return beginService(player, raw, broadcast, {
      str: targetStr, verb: 'suck', npcVerb: 'suck', actorGain: 5, targetGain: 20, action: 'sucking',
      configure: (t) => {
        if (/cock|dick|penis/.test(partStr)) {
          if (t.biological_sex !== 'male') return { error: `${t.handle} doesn't have one of those.` };
          return { key: 'suck_cock', actorClimaxPool: SERVICE_CLIMAX_ACTOR.suck_cock,
            startZone: `{name} goes down on {target}, taking their cock in their mouth.`,
            startActor: `You take {target}'s cock into your mouth.` };
        }
        if (/tits?|breasts?|nipples?/.test(partStr)) {
          if (t.biological_sex !== 'female') return { error: `Not much there to work with.` };
          return { key: 'suck_tits',
            startZone: `{name} sucks at {target}'s tits.`,
            startActor: `You close your mouth over {target}'s nipple.` };
        }
        if (t.biological_sex !== 'female') return { error: `${t.handle} doesn't have one of those.` };
        return { key: 'suck_pussy',
          startZone: `{name} gets between {target}'s legs, mouth working.`,
          startActor: `You lower your mouth to {target}'s pussy and start sucking.` };
      },
    });
  }

  return actHandler({
    player, broadcast, rawArgs: args, verb: 'suck',
    defaultPart: 'fingers',
    selfMessages: [`You suck on your own {part}.`],
    targetMessages: [
      `You take {name}'s {part} into your mouth.`,
      `Your mouth works over {name}'s {part}.`,
      `You wrap your lips around {name}'s {part}.`,
    ],
    targetReceives: [
      `{actor} takes your {part} into their mouth.`,
      `{actor}'s mouth works over your {part}.`,
      `{actor} wraps their lips around your {part}.`,
    ],
    horninessGain: 18,
    sanityGain: 8,
  });
}

// Ongoing fuck with a willing NPC as the receiver. Actor-driven (the actor's
// climax ends it, like the player version), but the NPC's side is a transient
// arousal meter that broadcasts moans and its own climaxes to the room.
async function startFuckEventNpc(player, npc, broadcast, location) {
  const name = npc.name;

  broadcastMis(player.current_zone, { type: 'zone_event', message: `${player.handle} strips off ${name}'s clothing.` }, broadcast);
  broadcastNpcMisLine(npc, true, player.current_zone, broadcast);

  const openers = {
    mouth:   `You push into ${name}'s mouth.`,
    pussy:   `You spread ${name} and slide in deep.`,
    ass:     `You grip ${name}'s hips and push into their ass.`,
    default: `You pull ${name} close and start fucking them.`,
  };
  const opener = openers[location] || openers.default;

  const msgs = await addHorniness(player, 20, broadcast);
  player.sanity = Math.min(player.sanity_max || 100, (player.sanity || 50) + 8);
  await query('UPDATE players SET sanity=$1 WHERE id=$2', [player.sanity, player.id]);
  if (msgs.length) broadcast(null, { type: 'resource_tick', messages: msgs, player_update: { horniness: player.horniness, erect: player.erect } }, null, player.id);

  broadcastMis(player.current_zone, { type: 'zone_event', message: `${player.handle} starts fucking ${name}.` }, broadcast, player.id);
  npcWitnessMis(player.current_zone, broadcast, 0.5);
  await addNpcArousal(npc, 15, broadcast, player.current_zone);

  const playerId = player.id;
  const npcId = npc.id;
  const zonePool = FUCK_EVENT_MSGS[location] || FUCK_EVENT_MSGS.default;
  const actorPool = FUCK_EVENT_PLAYER_MSGS[location] || FUCK_EVENT_PLAYER_MSGS.default;
  const ejacPart = location === 'mouth' ? 'throat' : location === 'ass' ? 'ass' : location === 'pussy' ? 'pussy' : 'body';

  startMisEvent(playerId, async () => {
    const live = getLivePlayer(playerId);
    if (!live || !isMisActive(live)) { stopMisEvent(playerId); return; }
    const liveNpc = world.npcs.get(npcId);
    if (!liveNpc || liveNpc._dead || liveNpc.zone_id !== live.current_zone || !isNpcMisWilling(liveNpc)) {
      stopMisEvent(playerId);
      broadcast(null, { type: 'output', message: `${name} isn't available anymore.` }, null, playerId);
      return;
    }

    if (live.horniness >= 100) {
      stopMisEvent(playerId);
      const climaxMsgs = await triggerClimax(live, broadcast, ejacPart);
      const ejacPool = EJACULATE_ZONE_MSGS.into_player;
      const ejacText = ejacPool[Math.floor(Math.random() * ejacPool.length)]
        .replace(/\{name\}/g, live.handle).replace(/\{target\}/g, name).replace(/\{part\}/g, ejacPart);
      broadcastMis(live.current_zone, { type: 'zone_event', message: ejacText }, broadcast, live.id);
      await addNpcArousal(liveNpc, 40, broadcast, live.current_zone); // finishing tips them over too
      npcWitnessMis(live.current_zone, broadcast, 0.7);
      broadcast(null, { type: 'resource_tick', messages: climaxMsgs, player_update: { horniness: live.horniness, erect: live.erect, sanity: live.sanity } }, null, playerId);
      return;
    }

    const zoneTpl = zonePool[Math.floor(Math.random() * zonePool.length)];
    broadcastMis(live.current_zone, { type: 'zone_event', message: zoneTpl.replace(/\{name\}/g, live.handle).replace(/\{target\}/g, name) }, broadcast, live.id);
    npcWitnessMis(live.current_zone, broadcast, 0.2);
    broadcast(null, { type: 'output', message: actorPool[Math.floor(Math.random() * actorPool.length)].replace(/\{target\}/g, name) }, null, playerId);

    await addNpcArousal(liveNpc, 15, broadcast, live.current_zone);

    const climaxMsgs = await addHorniness(live, 18, broadcast);
    broadcast(null, { type: 'resource_tick', messages: climaxMsgs, player_update: { horniness: live.horniness, erect: live.erect } }, null, playerId);
  }, 8000, { action: 'fuck', target: name });

  return { type: 'output', message: opener };
}

// Penetrative sex — ongoing event version
async function cmdFuck(args, raw, player, broadcast) {
  const gate = misGate(player, raw);
  if (gate) return gate;

  const str = raw.replace(/^(?:fuck|sex|screw|rail|bang|breed)\s*/i, '').trim();
  const inMatch = str.match(/^(.+?)\s+in\s+(.+)$/i);
  let targetStr = inMatch ? inMatch[1].trim() : str;
  const rawLocation = (inMatch ? inMatch[2].trim() : '').toLowerCase();

  const MOUTH_WORDS  = ['mouth', 'face', 'throat', 'blowjob', 'oral', 'bj'];
  const PUSSY_WORDS  = ['pussy', 'vagina', 'cunt', 'vag'];
  const ASS_WORDS    = ['ass', 'asshole', 'anus', 'butt', 'rear', 'anal'];

  let location = 'default';
  if (MOUTH_WORDS.some(w => rawLocation.includes(w)))  location = 'mouth';
  else if (PUSSY_WORDS.some(w => rawLocation.includes(w))) location = 'pussy';
  else if (ASS_WORDS.some(w => rawLocation.includes(w)))   location = 'ass';

  if (!targetStr) return { type:'error', message:`Usage: fuck <target> [in mouth/pussy/ass]` };

  // NPC target — skip all clothing checks. Unwilling NPCs strip-then-react by
  // personality (flee/attack); willing ones become an ongoing fuck event and
  // gain arousal / climax just like a player partner.
  const fuckNpc = resolveNpcForMis(targetStr, player.current_zone);
  if (fuckNpc) {
    if (!isNpcMisWilling(fuckNpc)) return handleNpcMis(player, fuckNpc, 'fuck', broadcast, { isStrip: true });
    const refusal = npcZoneRefusal(player, fuckNpc, broadcast);
    if (refusal) return refusal;
    if (hasMisEvent(player.id)) { stopMisEvent(player.id); return { type: 'output', message: `You stop.` }; }
    return startFuckEventNpc(player, fuckNpc, broadcast, location);
  }

  if (hasMisEvent(player.id)) {
    const meta = stopMisEvent(player.id);
    return { type:'output', message: meta?.action ? `Stopped ${meta.action}ing${meta.target ? ` ${meta.target}` : ''}.` : `You stop.` };
  }

  // Penetrative sex requires naked legs (mouth is fine either way)
  if (location !== 'mouth') {
    const { rows: legItems } = await query(
      `SELECT i.name FROM player_inventory pi JOIN items i ON i.id=pi.item_id
       WHERE pi.player_id=$1 AND pi.is_equipped=1 AND pi.slot='legs' LIMIT 1`,
      [player.id]
    );
    if (legItems.length) {
      // Grind instead of penetrate
      const { res: res2, error: err2, ambiguous: amb2 } = resolveTargetMis(targetStr, player, 'fuck');
      if (amb2) return amb2;
      if (err2) return { type:'error', message: err2 };
      const name2 = targetName(res2);
      const grindMsgs = [
        `You pull ${name2} close and grind your hips against them. Your ${legItems[0].name} is very much in the way.`,
        `You press yourself against ${name2} and roll your hips, rubbing through your ${legItems[0].name}.`,
        `You and ${name2} grind together through your clothing, working up a rhythm.`,
      ];
      const msgs = await addHorniness(player, 12, broadcast);
      if (msgs.length) broadcast(null, { type:'resource_tick', messages: msgs, player_update: { horniness: player.horniness } }, null, player.id);
      if (res2.type === 'player' && isMisActive(res2.target) && isAttractedTo(res2.target, player)) {
        const tmsg = await addHorniness(res2.target, 10, broadcast);
        if (tmsg.length) broadcast(null, { type:'resource_tick', messages: tmsg, player_update: { horniness: res2.target.horniness } }, null, res2.target.id);
        broadcast(null, { type:'output', message: `${player.handle} grinds against you.` }, null, res2.target.id);
      }
      broadcast(player.current_zone, { type:'zone_event', message: `${player.handle} and ${name2} grind against each other.` }, player.id, res2.type === 'player' ? res2.target.id : null);
      return { type:'output', message: grindMsgs[Math.floor(Math.random() * grindMsgs.length)] };
    }
  }

  const { res, error, ambiguous } = resolveTargetMis(targetStr, player, 'fuck');
  if (ambiguous) return ambiguous;
  if (error) return { type:'error', message: error };
  const name = targetName(res);
  const isMale = player.biological_sex === 'male';

  const MOUTH_MSGS = [
    [`You push your ${isMale ? 'cock' : 'fingers'} into ${name}'s mouth.`,  `${player.handle} pushes their ${isMale ? 'cock' : 'fingers'} into your mouth.`],
    [`${name} opens their mouth and you slide right in.`,                    `${player.handle} slides into your open mouth.`],
    [`You grip ${name}'s head and push into their throat.`,                  `${player.handle} grips your head and uses your throat.`],
  ];
  const PUSSY_MSGS = [
    [`You thrust into ${name}'s pussy, wet and tight around you.`,           `${player.handle} pushes inside you.`],
    [`You spread ${name}'s legs and slide in deep.`,                          `${player.handle} spreads your legs and fills you.`],
    [`You push into ${name} and start moving.`,                               `${player.handle} enters you and starts to move.`],
  ];
  const ASS_MSGS = [
    [`You press against ${name}'s ass and push inside.`,                      `${player.handle} presses into your ass.`],
    [`You grip ${name}'s hips and slide into their ass.`,                     `${player.handle} grips your hips and takes your ass.`],
    [`You slide into ${name}'s asshole and start moving.`,                    `${player.handle} slides into your ass.`],
  ];
  const DEFAULT_MSGS = [
    [`You pull ${name} close and start fucking them.`,                        `${player.handle} pulls you close and starts.`],
    [`You and ${name} get into it.`,                                          `${player.handle} starts fucking you.`],
  ];

  const pool = location === 'mouth' ? MOUTH_MSGS
             : location === 'pussy' ? PUSSY_MSGS
             : location === 'ass'   ? ASS_MSGS
             : DEFAULT_MSGS;

  const [actorMsg, targetMsg] = pool[Math.floor(Math.random() * pool.length)];

  const msgs = await addHorniness(player, 20, broadcast);
  player.sanity = Math.min(player.sanity_max || 100, (player.sanity || 50) + 8);
  await query('UPDATE players SET sanity=$1 WHERE id=$2', [player.sanity, player.id]);

  if (res.type === 'player' && isMisActive(res.target)) {
    const targetMsgs = await addHorniness(res.target, 15, broadcast);
    if (targetMsgs.length) broadcast(null, { type:'resource_tick', messages: targetMsgs, player_update: { horniness: res.target.horniness } }, null, res.target.id);
    res.target.sanity = Math.min(res.target.sanity_max || 100, (res.target.sanity || 50) + 8);
    await query('UPDATE players SET sanity=$1 WHERE id=$2', [res.target.sanity, res.target.id]);
    broadcast(null, { type:'output', message: targetMsg }, null, res.target.id);
  }

  if (msgs.length) broadcast(null, { type:'resource_tick', messages: msgs, player_update: { horniness: player.horniness } }, null, player.id);
  broadcastMis(player.current_zone, { type:'zone_event', message: `${player.handle} and ${name} start having sex.` }, broadcast, player.id, res.target.id);
  npcWitnessMis(player.current_zone, broadcast, 0.5);

  // Start ongoing event
  const playerId = player.id;
  const targetId = res.target.id;
  const zonePool = FUCK_EVENT_MSGS[location] || FUCK_EVENT_MSGS.default;
  const actorPool = FUCK_EVENT_PLAYER_MSGS[location] || FUCK_EVENT_PLAYER_MSGS.default;
  const targetPool = FUCK_EVENT_TARGET_MSGS[location] || FUCK_EVENT_TARGET_MSGS.default;
  const ejacPart = location === 'mouth' ? 'throat' : location === 'ass' ? 'ass' : location === 'pussy' ? 'pussy' : 'body';

  startMisEvent(playerId, async () => {
    const live = getLivePlayer(playerId);
    if (!live || !isMisActive(live)) { stopMisEvent(playerId); return; }

    if (live.horniness >= 100) {
      stopMisEvent(playerId);
      const climaxMsgs = await triggerClimax(live, broadcast, ejacPart);
      const ejacZonePool = EJACULATE_ZONE_MSGS.into_player;
      const ejacText = ejacZonePool[Math.floor(Math.random() * ejacZonePool.length)]
        .replace(/\{name\}/g, live.handle)
        .replace(/\{target\}/g, name)
        .replace(/\{part\}/g, ejacPart);
      broadcastMis(live.current_zone, { type: 'zone_event', message: ejacText }, broadcast, live.id, targetId);
      npcWitnessMis(live.current_zone, broadcast, 0.7);
      broadcast(null, {
        type: 'resource_tick',
        messages: climaxMsgs,
        player_update: { horniness: live.horniness, erect: live.erect, sanity: live.sanity },
      }, null, playerId);
      if (targetId) {
        const liveTarget = getLivePlayer(targetId);
        if (liveTarget && isMisActive(liveTarget)) {
          broadcast(null, {
            type: 'output',
            message: `${live.handle} finishes inside your ${ejacPart}.`,
          }, null, targetId);
        }
      }
      return;
    }

    const zoneTpl = zonePool[Math.floor(Math.random() * zonePool.length)];
    const zoneMsg = zoneTpl.replace(/\{name\}/g, live.handle).replace(/\{target\}/g, name);
    broadcastMis(live.current_zone, { type: 'zone_event', message: zoneMsg }, broadcast, live.id, targetId);
    npcWitnessMis(live.current_zone, broadcast, 0.2);

    // Private message to actor
    const actorTpl = actorPool[Math.floor(Math.random() * actorPool.length)];
    broadcast(null, {
      type: 'output',
      message: actorTpl.replace(/\{target\}/g, name),
    }, null, playerId);

    const climaxMsgs = await addHorniness(live, 18, broadcast);
    broadcast(null, {
      type: 'resource_tick',
      messages: climaxMsgs,
      player_update: { horniness: live.horniness, erect: live.erect },
    }, null, playerId);

    if (targetId) {
      const liveTarget = getLivePlayer(targetId);
      if (liveTarget && isMisActive(liveTarget)) {
        // Private message to target
        const targetTpl = targetPool[Math.floor(Math.random() * targetPool.length)];
        broadcast(null, {
          type: 'output',
          message: targetTpl.replace(/\{name\}/g, live.handle),
        }, null, targetId);

        if (isAttractedTo(liveTarget, live)) {
          const targetClimaxMsgs = await addHorniness(liveTarget, 14, broadcast);
          broadcast(null, {
            type: 'resource_tick',
            messages: targetClimaxMsgs,
            player_update: { horniness: liveTarget.horniness },
          }, null, targetId);
        }
      }
    }
  }, 8000, { action: 'fuck', target: name });

  return { type:'output', message: actorMsg };
}

// ejaculate / cum [on <target>'s <part> | on <furniture> | on ground | (no arg = ground)]
async function cmdEjaculate(args, raw, player, broadcast) {
  const gate = misGate(player, raw);
  if (gate) return gate;

  // Women can't ejaculate on command — only passive release at horniness 100
  if (player.biological_sex === 'female') {
    return { type:'error', message:`That's not how your body works.` };
  }

  // Must be at least 50% aroused to ejaculate
  if ((player.horniness || 0) < 50) {
    return { type:'error', message:`You're not worked up enough for that.` };
  }

  stopMisEvent(player.id); // cancel any ongoing event

  const str = raw.replace(/^(?:ejaculate|cum|come)\s*/i, '').trim().toLowerCase();

  // "in <target>'s <hole>" — finish INSIDE (cum in X's mouth / pussy / ass).
  // Distinct from "on <target>'s <part>" below, which marks the surface.
  if (/^in\s+/i.test(str)) {
    const inBody = str.replace(/^in\s+/i, '').trim();
    let tStr, hole;
    const am = inBody.match(/^(.+?)'s\s+(mouth|throat|face|pussy|cunt|vagina|ass|asshole|anus)\b/i);
    if (am) { tStr = am[1].trim(); hole = am[2].toLowerCase(); }
    else {
      const hm = inBody.match(/\b(mouth|throat|face|pussy|cunt|vagina|ass|asshole|anus)\b/i);
      if (hm) { hole = hm[1].toLowerCase(); tStr = inBody.slice(0, hm.index).replace(/'s$/, '').trim(); }
      else { tStr = inBody.replace(/'s$/, '').trim(); hole = 'mouth'; }
    }
    const holeLabel = /mouth|throat|face/.test(hole) ? 'mouth' : /pussy|cunt|vagina/.test(hole) ? 'pussy' : 'ass';
    const isMouth = holeLabel === 'mouth';
    const residueLoc = isMouth ? 'mouth' : holeLabel;
    const zonePool = isMouth ? EJACULATE_ZONE_MSGS.into_mouth : EJACULATE_ZONE_MSGS.into_player;

    if (!tStr) return { type:'error', message:`Cum in whose ${holeLabel}?` };

    const resetActor = async () => {
      player.horniness = 0; player.erect = 0;
      player.sanity = Math.min(player.sanity_max || 100, (player.sanity || 50) + 10);
      player.horniness_last_increased = null;
      if (!player.appearance_data) player.appearance_data = {};
      player.appearance_data.ejaculate_state = { locations: ['penis'] };
      await query('UPDATE players SET horniness=$1, erect=$2, sanity=$3, appearance_data=$4 WHERE id=$5',
        [player.horniness, player.erect, player.sanity, JSON.stringify(player.appearance_data), player.id]);
    };

    // NPC target — willing ones take it; unwilling ones react (flee/attack).
    const inNpc = resolveNpcForMis(tStr, player.current_zone);
    if (inNpc) {
      if (!isNpcMisWilling(inNpc)) return handleNpcMis(player, inNpc, 'jerk off on', broadcast);
      await resetActor();
      await stainZone(player.current_zone, 'ejaculate');
      const line = getNpcMisLine(inNpc, true);
      if (line) {
        const upper = line.replace(/[^A-Za-z]/g, '');
        const shout = upper.length > 3 && upper === upper.toUpperCase();
        broadcastMis(player.current_zone, { type:'zone_event', message: `${inNpc.name} ${shout ? 'shouts' : 'says'}, "${line}"` }, broadcast);
      }
      broadcast(player.current_zone, {
        type:'zone_event',
        message: zonePool[Math.floor(Math.random() * zonePool.length)]
          .replace(/\{name\}/g, player.handle).replace(/\{target\}/g, inNpc.name).replace(/\{part\}/g, holeLabel),
      }, player.id);
      npcWitnessMis(player.current_zone, broadcast, 0.6);
      broadcast(null, { type:'resource_tick', messages: [], player_update: { horniness: player.horniness, erect: player.erect, sanity: player.sanity } }, null, player.id);
      return { type:'output', message: `You finish in ${inNpc.name}'s ${holeLabel}.` };
    }

    const { res, error, ambiguous } = resolveTargetMis(tStr, player, 'ejaculate');
    if (ambiguous) return ambiguous;
    if (error) return { type:'error', message: error };
    const name = targetName(res);

    await resetActor();
    if (res.type === 'player') {
      const tgt = res.target;
      if (!tgt.appearance_data) tgt.appearance_data = {};
      tgt.appearance_data.ejaculate_state = { locations: [residueLoc] };
      await query('UPDATE players SET appearance_data=$1 WHERE id=$2', [JSON.stringify(tgt.appearance_data), tgt.id]);
    }
    await stainZone(player.current_zone, 'ejaculate');

    broadcast(player.current_zone, {
      type:'zone_event',
      message: zonePool[Math.floor(Math.random() * zonePool.length)]
        .replace(/\{name\}/g, player.handle).replace(/\{target\}/g, name).replace(/\{part\}/g, holeLabel),
    }, player.id, res.type === 'player' ? res.target.id : null);
    if (res.type === 'player') {
      broadcast(null, { type:'output', message: `${player.handle} finishes in your ${holeLabel}.` }, null, res.target.id);
    }
    npcWitnessMis(player.current_zone, broadcast, 0.6);
    broadcast(null, { type:'resource_tick', messages: [], player_update: { horniness: player.horniness, erect: player.erect, sanity: player.sanity } }, null, player.id);
    return { type:'output', message: `You finish in ${name}'s ${holeLabel}.` };
  }

  // No argument or "on ground" / "on floor"
  if (!str || /^on\s+(?:the\s+)?(?:ground|floor)$/.test(str)) {
    // Underwear on → it can't reach the floor; it soaks into the fabric.
    const covered = await legsCovered(player);
    const msg = await triggerGroundClimax(player);
    if (covered) {
      await stainClothing(player, ['legs'], 'ejaculate');
      broadcast(player.current_zone, {
        type: 'zone_event',
        message: `${player.handle} tenses, and a wet stain blooms through the front of their clothing.`,
      }, player.id);
    } else {
      await stainZone(player.current_zone, 'ejaculate');
      const zonePool = EJACULATE_ZONE_MSGS.ground;
      broadcast(player.current_zone, {
        type: 'zone_event',
        message: zonePool[Math.floor(Math.random() * zonePool.length)].replace('{name}', player.handle),
      }, player.id);
    }
    npcWitnessMis(player.current_zone, broadcast, 0.6);
    broadcast(null, {
      type: 'resource_tick',
      messages: msg,
      player_update: { horniness: player.horniness, erect: player.erect, sanity: player.sanity },
    }, null, player.id);
    return { type:'output', message: covered
      ? `You let go — with your underwear still on, it soaks straight into the fabric.`
      : `You let go and finish on the ground.` };
  }

  // "on <name>'s <part>"
  const playerPartMatch = str.match(/^on\s+(.+?)'s\s+(.+)$/i);
  if (playerPartMatch) {
    const targetStr = playerPartMatch[1].trim();
    const part = playerPartMatch[2].trim();

    // NPC target — willing NPCs get finished on; unwilling ones react (flee/attack).
    const cumNpc = resolveNpcForMis(targetStr, player.current_zone);
    if (cumNpc) {
      if (!isNpcMisWilling(cumNpc)) return handleNpcMis(player, cumNpc, 'jerk off on', broadcast);

      player.horniness = 0;
      player.erect = 0;
      player.sanity = Math.min(player.sanity_max || 100, (player.sanity || 50) + 10);
      player.horniness_last_increased = null;
      if (!player.appearance_data) player.appearance_data = {};
      player.appearance_data.ejaculate_state = { locations: ['penis'] };
      await query('UPDATE players SET horniness=$1, erect=$2, sanity=$3, appearance_data=$4 WHERE id=$5',
        [player.horniness, player.erect, player.sanity, JSON.stringify(player.appearance_data), player.id]);
      await stainZone(player.current_zone, 'ejaculate');

      const line = getNpcMisLine(cumNpc, true);
      if (line) {
        const upper = line.replace(/[^A-Za-z]/g, '');
        const shout = upper.length > 3 && upper === upper.toUpperCase();
        broadcastMis(player.current_zone, { type:'zone_event', message: `${cumNpc.name} ${shout ? 'shouts' : 'says'}, "${line}"` }, broadcast);
      }

      const npcZonePool = EJACULATE_ZONE_MSGS.on_player;
      broadcast(player.current_zone, {
        type: 'zone_event',
        message: npcZonePool[Math.floor(Math.random() * npcZonePool.length)]
          .replace(/\{name\}/g, player.handle)
          .replace(/\{target\}/g, cumNpc.name)
          .replace(/\{part\}/g, part),
      }, player.id);
      npcWitnessMis(player.current_zone, broadcast, 0.6);
      broadcast(null, {
        type: 'resource_tick',
        messages: [],
        player_update: { horniness: player.horniness, erect: player.erect, sanity: player.sanity },
      }, null, player.id);
      return { type:'output', message: `You come on ${cumNpc.name}'s ${part}.` };
    }

    const { res, error, ambiguous } = resolveTargetMis(targetStr, player, 'ejaculate');
    if (ambiguous) return ambiguous;
    if (error) return { type:'error', message: error };
    const name = targetName(res);

    player.horniness = 0;
    player.erect = 0;
    player.sanity = Math.min(player.sanity_max || 100, (player.sanity || 50) + 10);
    player.horniness_last_increased = null;
    // Mark residue on actor's penis
    if (!player.appearance_data) player.appearance_data = {};
    player.appearance_data.ejaculate_state = { locations: ['penis'] };
    await query('UPDATE players SET horniness=$1, erect=$2, sanity=$3, appearance_data=$4 WHERE id=$5',
      [player.horniness, player.erect, player.sanity, JSON.stringify(player.appearance_data), player.id]);

    // Stain target's clothing at the named body part slot, and the zone
    if (res.type === 'player') {
      const tgt = res.target;
      if (!tgt.appearance_data) tgt.appearance_data = {};
      tgt.appearance_data.ejaculate_state = { locations: [part] };
      await query('UPDATE players SET appearance_data=$1 WHERE id=$2', [JSON.stringify(tgt.appearance_data), tgt.id]);
      await stainClothing(tgt, [part], 'ejaculate');
    }
    await stainZone(player.current_zone, 'ejaculate');

    const zonePool = EJACULATE_ZONE_MSGS.on_player;
    broadcast(player.current_zone, {
      type: 'zone_event',
      message: zonePool[Math.floor(Math.random() * zonePool.length)]
        .replace(/\{name\}/g, player.handle)
        .replace(/\{target\}/g, name)
        .replace(/\{part\}/g, part),
    }, player.id, res.type === 'player' ? res.target.id : null);

    if (res.type === 'player') {
      broadcast(null, {
        type: 'output',
        message: `${player.handle} finishes on your ${part}.`,
      }, null, res.target.id);
    }

    npcWitnessMis(player.current_zone, broadcast, 0.6);
    broadcast(null, {
      type: 'resource_tick',
      messages: [],
      player_update: { horniness: player.horniness, erect: player.erect, sanity: player.sanity },
    }, null, player.id);

    return { type:'output', message: `You come on ${name}'s ${part}.` };
  }

  // "on <furniture/object>" — treat remainder as furniture name
  const onMatch = str.match(/^on\s+(?:the\s+)?(.+)$/i);
  const furnitureName = onMatch ? onMatch[1].trim() : str;

  const { rows } = await query(
    `SELECT name FROM furniture WHERE zone_id=$1 AND name ILIKE $2 LIMIT 1`,
    [player.current_zone, `%${furnitureName}%`]
  );

  if (rows.length) {
    const fname = rows[0].name;
    player.horniness = 0;
    player.erect = 0;
    player.sanity = Math.min(player.sanity_max || 100, (player.sanity || 50) + 10);
    player.horniness_last_increased = null;
    await query('UPDATE players SET horniness=$1, erect=$2, sanity=$3 WHERE id=$4',
      [player.horniness, player.erect, player.sanity, player.id]);

    await stainZone(player.current_zone, 'ejaculate');

    const zonePool = EJACULATE_ZONE_MSGS.furniture;
    broadcast(player.current_zone, {
      type: 'zone_event',
      message: zonePool[Math.floor(Math.random() * zonePool.length)]
        .replace('{name}', player.handle)
        .replace('{target}', fname),
    }, player.id);
    npcWitnessMis(player.current_zone, broadcast, 0.6);

    broadcast(null, {
      type: 'resource_tick',
      messages: [],
      player_update: { horniness: player.horniness, erect: player.erect, sanity: player.sanity },
    }, null, player.id);

    return { type:'output', message: `You finish on the ${fname}.` };
  }

  // Fallback — treat as ejaculate on ground
  const msg = await triggerGroundClimax(player);
  await stainZone(player.current_zone, 'ejaculate');
  broadcast(player.current_zone, {
    type: 'zone_event',
    message: EJACULATE_ZONE_MSGS.ground[0].replace('{name}', player.handle),
  }, player.id);
  npcWitnessMis(player.current_zone, broadcast, 0.6);
  broadcast(null, {
    type: 'resource_tick',
    messages: msg,
    player_update: { horniness: player.horniness, erect: player.erect, sanity: player.sanity },
  }, null, player.id);
  return { type:'output', message: `You come on the ground.` };
}

// Eat out — cunnilingus or rimjob. Ongoing service event; the receiver finishes.
async function cmdEatOut(args, raw, player, broadcast) {
  // Parse the hole off the raw before beginService (it gates/resolves for us).
  const str = raw.replace(/^eat\s+out\s*/i, '').trim();
  let targetStr = str, holeStr = '';
  const apos = str.match(/^(.+?)'s\s+(pussy|ass|cunt|vagina|anus|asshole)$/i);
  if (apos) { targetStr = apos[1].trim(); holeStr = apos[2].toLowerCase(); }
  else {
    const words = str.split(/\s+/);
    targetStr = words[0] || '';
    holeStr = words.slice(1).join(' ').toLowerCase();
  }
  if (!misGate(player, raw) && !targetStr && !hasMisEvent(player.id)) {
    return { type: 'error', message: `Usage: eat out <target>'s [pussy/ass]` };
  }
  const isAss = /ass|anus|asshole/.test(holeStr);

  return beginService(player, raw, broadcast, {
    str: targetStr, verb: 'eat out', npcVerb: 'eat out', actorGain: 8, targetGain: 22, action: 'eating out',
    configure: (t) => {
      if (!isAss && t.biological_sex !== 'female') return { error: `${t.handle} doesn't have one of those — try their ass.` };
      return isAss
        ? { key: 'eatout_ass', startZone: `{name} gets behind {target} and starts rimming them.`, startActor: `You spread {target} and press your tongue to their ass.` }
        : { key: 'eatout_pussy', startZone: `{name} buries their face between {target}'s legs.`, startActor: `You get between {target}'s legs and go down on them.` };
    },
  });
}

// Blowjob: female actor giving head → suck cock (ongoing, he finishes). Anyone
// else → fuck their mouth (the actor finishes) via the existing fuck event.
async function cmdBlowjob(args, raw, player, broadcast) {
  const target = args.join(' ');
  if (!target) return { type:'error', message:`Usage: blowjob <target>` };
  if (player.biological_sex === 'female') {
    const { res, error, ambiguous } = resolveTargetMis(target, player, 'blowjob');
    if (ambiguous) return ambiguous;
    if (error) return { type:'error', message: error };
    if (res.target.biological_sex === 'male') {
      return cmdSuck([`${res.target.handle}'s`, 'cock'], raw, player, broadcast);
    }
  }
  return cmdFuck(args, `fuck ${target} in mouth`, player, broadcast);
}

// Handjob — ongoing service event on a male player (he finishes). NPCs and any
// non-genital fallback stay the one-shot actHandler version.
async function cmdHandjob(args, raw, player, broadcast) {
  const str = args.join(' ');
  if (isMisActive(player) && str) {
    return beginService(player, raw, broadcast, {
      str, verb: 'handjob', npcVerb: 'handjob', actorGain: 6, targetGain: 18, action: 'stroking',
      configure: (t) => t.biological_sex !== 'male'
        ? { error: `${t.handle} doesn't have a cock to work with.` }
        : { key: 'handjob', startZone: `{name} takes {target}'s cock in hand and starts stroking.`, startActor: `You wrap your hand around {target}'s cock and start stroking.` },
    });
  }
  return actHandler({
    player, broadcast, rawArgs: args, verb: 'handjob',
    defaultPart: 'cock',
    selfMessages: [`You work your own {part} with your hand.`],
    targetMessages: [
      `You wrap your hand around {name}'s {part} and stroke.`,
      `You give {name} a slow, deliberate handjob.`,
      `Your hand finds {name}'s {part} and gets to work.`,
    ],
    targetReceives: [
      `{actor} wraps their hand around your {part} and strokes.`,
      `{actor} gives you a slow, deliberate handjob.`,
      `{actor}'s hand finds your {part} and gets to work.`,
    ],
    horninessGain: 16,
    sanityGain: 6,
  });
}

async function cmdWashHands(player) {
  const { rows } = await query(
    `SELECT id FROM furniture WHERE zone_id=$1 AND (object_type='sink' OR jsonb_exists(flags,'water_source')) LIMIT 1`,
    [player.current_zone]
  );
  if (!rows.length) return { type:'error', message:`There's no water source here.` };

  let msg = `You wash your hands at the sink.`;
  if (isMisActive(player)) {
    const washed = await washEjaculate(player);
    if (washed) msg = `You wash your hands and clean yourself up at the sink.`;
  }
  return { type:'output', message: msg };
}

async function cmdWash(args, raw, player) {
  if (args[0] === 'hands') return cmdWashHands(player);

  const { rows: sinkRows } = await query(
    `SELECT id FROM furniture WHERE zone_id=$1 AND (object_type='sink' OR jsonb_exists(flags,'water_source')) LIMIT 1`,
    [player.current_zone]
  );
  const hasSink = sinkRows.length > 0;

  let waterRow = null;
  if (!hasSink) {
    const { rows } = await query(
      `SELECT pi.id, pi.quantity FROM player_inventory pi
       JOIN items i ON i.id=pi.item_id
       WHERE pi.player_id=$1 AND (i.tags->>'restore_thirst' IS NOT NULL OR i.name ILIKE '%water%') LIMIT 1`,
      [player.id]
    );
    if (!rows.length) return { type:'error', message:`You need a sink or water to wash yourself.` };
    waterRow = rows[0];
  }

  const washed = await washEjaculate(player);
  let bloodWashed = false;
  if (player.covered_in_blood) {
    player.covered_in_blood = 0;
    await query('UPDATE players SET covered_in_blood=0 WHERE id=$1', [player.id]);
    bloodWashed = true;
  }
  if (!washed && !bloodWashed) return { type:'output', message:`You're already clean.` };

  if (waterRow) {
    if (waterRow.quantity > 1) await query('UPDATE player_inventory SET quantity=quantity-1 WHERE id=$1', [waterRow.id]);
    else await query('DELETE FROM player_inventory WHERE id=$1', [waterRow.id]);
  }

  const src = `the water`;
  const msg = bloodWashed
    ? `You use ${src} to scrub the blood off. Better.`
    : `You use ${src} to clean yourself off. Better.`;
  return { type:'output', message: msg };
}

// Detailed body-part examination: `examine <target>'s <part>`. Routed here by an
// input matcher (below) only when the input names a part word; when MIS is off,
// or it's really an item/furniture, we return undefined and the engine's normal
// examine takes over.
const EXAM_PART_RE = /\b(genitals?|crotch|cock|penis|dick|balls?|testicles?|pussy|cunt|vagina|labia|tits?|breasts?|boobs?|nipples?|ass|asshole|anus|butt)\b/i;

function normalizeExamPart(word) {
  const w = word.toLowerCase();
  if (/genitals?|crotch/.test(w)) return 'genitals';
  if (/cock|penis|dick/.test(w)) return 'penis';
  if (/balls?|testicles?/.test(w)) return 'balls';
  if (/pussy|cunt|vagina|labia/.test(w)) return 'pussy';
  if (/tits?|breasts?|boobs?/.test(w)) return 'breasts';
  if (/nipples?/.test(w)) return 'nipples';
  if (/asshole|anus/.test(w)) return 'asshole';
  if (/ass|butt/.test(w)) return 'ass';
  return null;
}

async function cmdExaminePart(args, raw, player, broadcast) {
  if (!isMisActive(player)) return undefined; // fall through to normal examine
  const rest = raw.replace(/^(?:x|exam|examine|look)(?:\s+at)?\s+/i, '').trim();
  const pm = rest.match(EXAM_PART_RE);
  if (!pm) return undefined;
  // Trailing text after the part word means this is really an item/furniture
  // name ("ass-kicking boots") — let the normal examine handle it.
  if (rest.slice(pm.index + pm[0].length).replace(/^'s\b/, '').trim()) return undefined;
  const part = normalizeExamPart(pm[0]);
  if (!part) return undefined;

  let who = rest.slice(0, pm.index).replace(/'s\s*$/, '').replace(/^(?:at|the)\s+/i, '').trim();
  const isSelf = !who || /^(my|self|me|myself|own)$/i.test(who);
  if (isSelf) {
    const desc = describeBodyPart(player, part, true);
    return { type: 'examine', message: desc || `You can't get a good look at that.` };
  }

  const npc = resolveNpcForMis(who, player.current_zone);
  if (npc) {
    const desc = describeBodyPart(npc, part, false);
    return { type: 'examine', message: desc || `You can't get a good look.` };
  }

  const r = resolveTarget(who, player);
  if (r.type === 'none') return { type: 'error', message: `You don't see "${who}" here.` };
  if (r.type === 'ambiguous') {
    createSelectionState(player.id, r.candidates, { verb: 'examine' });
    return { type: 'output', message: formatSelectionPage({ allCandidates: r.candidates, visibleIndex: 0, pageSize: 5 }) };
  }
  const target = r.candidate;
  if (!isMisActive(target)) return { type: 'error', message: `${target.handle} hasn't enabled MIS.` };
  if (isAttractedTo(player, target) && broadcast) {
    const am = await addHorniness(player, 3, broadcast);
    if (am.length) broadcast(null, { type: 'resource_tick', messages: am, player_update: { horniness: player.horniness } }, null, player.id);
  }
  const desc = describeBodyPart(target, part, false);
  return { type: 'examine', message: desc || `You can't get a good look.` };
}

// ── strip <target> ──────────────────────────────────────────────────────────
// A direct MIS strip: peels an NPC or a consenting player bare with none of the
// tip/heat/willing/zone gates the club show runs on. The actor must have MIS on
// (like every MIS verb). An NPC strips freely; a target PLAYER only if THEY have
// MIS enabled (their own opt-in is the consent). Nudity is persisted:
//   • NPC   — _clothingPeeled = all layers + _forcedNude (the strippers redress
//             tick honours _forcedNude and leaves them bare).
//   • player — every worn garment (not the weapon) is unequipped into their pack.
function stripNpc(player, npc, broadcast) {
  const layers = Array.isArray(npc.flags?.clothing_layers) ? npc.flags.clothing_layers : [];
  npc._clothingPeeled = layers.length;
  npc._forcedNude = true;
  emit('mis.npc_act', { player, npc, verb: 'strip', zoneId: player.current_zone });
  broadcastMis(player.current_zone, { type: 'zone_event', message: `${player.handle} strips ${npc.name} bare.` }, broadcast, player.id);
  return { type: 'output', message: `You strip ${npc.name} bare. Nothing left on them but the light.` };
}

async function stripPlayer(player, target, broadcast) {
  if (!isMisActive(target)) return { type: 'error', message: `${target.handle} isn't in the mood — nothing happens.` };
  await query(
    `UPDATE player_inventory SET is_equipped=0, slot=NULL, layer=NULL, equipped_at=NULL
      WHERE player_id=$1 AND is_equipped=1 AND slot IS DISTINCT FROM 'weapon_hand'`,
    [target.id]
  );
  await recomputeArmor(target); await recomputeInsulation(target);
  broadcastMis(player.current_zone, { type: 'zone_event', message: `${player.handle} strips ${target.handle} bare.` }, broadcast, player.id, target.id);
  sendToPlayer(target.id, { type: 'output', message: `${player.handle} strips you bare — your clothes end up in a heap in your pack.`, refresh: true });
  return { type: 'output', message: `You strip ${target.handle} bare.` };
}

async function cmdStrip(args, raw, player, broadcast) {
  const gate = misGate(player, raw); if (gate) return gate;
  const nameStr = (args || []).join(' ').trim();
  if (!nameStr) return { type: 'error', message: 'Strip whom? (strip <npc or player>)' };

  const zoneId = player.current_zone;
  // NPC in the room takes precedence (the common case — a dancer).
  const npcs = getZoneNpcs(zoneId).filter(n => !n._dead);
  const rn = siftResolve(nameStr, npcs.map(n => ({ id: n.id, name: n.name })));
  if (rn.type === 'match') {
    const npc = npcs.find(n => n.id === rn.candidate.id);
    if (npc) return stripNpc(player, npc, broadcast);
  }
  // Otherwise a player in the room.
  const others = getZonePlayers(zoneId).filter(p => p.id !== player.id);
  const rp = siftResolve(nameStr, others.map(p => ({ id: p.id, name: p.handle })));
  if (rp.type === 'match') {
    const target = others.find(p => p.id === rp.candidate.id);
    if (target) return stripPlayer(player, target, broadcast);
  }
  return { type: 'error', message: `There's no "${nameStr}" here to strip.` };
}

export const commands = {
  mis:          (args, raw, player, broadcast) => cmdMis(args, player, broadcast),
  strip:        (args, raw, player, broadcast) => cmdStrip(args, raw, player, broadcast),
  finger:       (args, raw, player, broadcast) => cmdFinger(args, raw, player, broadcast),
  touch:        (args, raw, player, broadcast) => cmdTouch(args, raw, player, broadcast),
  grope:        (args, raw, player, broadcast) => cmdTouch(args, raw, player, broadcast),
  squeeze:      (args, raw, player, broadcast) => cmdSqueeze(args, raw, player, broadcast),
  kiss:         (args, raw, player, broadcast) => cmdKiss(args, raw, player, broadcast),
  lick:         (args, raw, player, broadcast) => cmdLick(args, raw, player, broadcast),
  fondle:       (args, raw, player, broadcast) => cmdFondle(args, raw, player, broadcast),
  slap:         (args, raw, player, broadcast) => cmdSlap(args, raw, player, broadcast),
  stroke:       (args, raw, player, broadcast) => cmdMasturbate(args, raw, player, broadcast),
  masturbate:   (args, raw, player, broadcast) => cmdMasturbate(args, raw, player, broadcast),
  jerkoff:      (args, raw, player, broadcast) => cmdMasturbate(args, raw, player, broadcast),
  jackoff:      (args, raw, player, broadcast) => cmdMasturbate(args, raw, player, broadcast),
  rubself:      (args, raw, player, broadcast) => cmdMasturbate(args, raw, player, broadcast),
  fingerself:   (args, raw, player, broadcast) => cmdMasturbate(args, raw, player, broadcast),
  suck:         (args, raw, player, broadcast) => cmdSuck(args, raw, player, broadcast),
  fuck:         (args, raw, player, broadcast) => cmdFuck(args, raw, player, broadcast),
  sex:          (args, raw, player, broadcast) => cmdFuck(args, raw, player, broadcast),
  screw:        (args, raw, player, broadcast) => cmdFuck(args, raw, player, broadcast),
  rail:         (args, raw, player, broadcast) => cmdFuck(args, raw, player, broadcast),
  bang:         (args, raw, player, broadcast) => cmdFuck(args, raw, player, broadcast),
  breed:        (args, raw, player, broadcast) => cmdFuck(args, raw, player, broadcast),
  blowjob:      (args, raw, player, broadcast) => cmdBlowjob(args, raw, player, broadcast),
  bj:           (args, raw, player, broadcast) => cmdBlowjob(args, raw, player, broadcast),
  handjob:      (args, raw, player, broadcast) => cmdHandjob(args, raw, player, broadcast),
  hj:           (args, raw, player, broadcast) => cmdHandjob(args, raw, player, broadcast),
  ejaculate:    (args, raw, player, broadcast) => cmdEjaculate(args, raw, player, broadcast),
  cum:          (args, raw, player, broadcast) => cmdEjaculate(args, raw, player, broadcast),
  come:         (args, raw, player, broadcast) => cmdEjaculate(args, raw, player, broadcast),
  wash:         (args, raw, player)            => cmdWash(args, raw, player),
};

// Multi-word verbs — registered through the dispatcher's input-matcher chain.
registerInputMatcher(/^jerk\s+off\s+on\b/i, (args, raw, player, broadcast) => cmdJerkOffOn(args, raw, player, broadcast), 'mis');
registerInputMatcher(/^eat\s+out\b/i, (args, raw, player, broadcast) => cmdEatOut(args, raw, player, broadcast), 'mis');
// Detailed part-examine — only intercepts examine/look when a genital/ass/chest
// word is present; cmdExaminePart returns undefined (falls through) otherwise.
registerInputMatcher(
  /^(?:x|exam|examine|look)(?:\s+at)?\s+.*\b(?:genitals?|crotch|cock|penis|dick|balls?|testicles?|pussy|cunt|vagina|labia|tits?|breasts?|boobs?|nipples?|ass|asshole|anus|butt)\b/i,
  (args, raw, player, broadcast) => cmdExaminePart(args, raw, player, broadcast), 'mis');

// The unified STOP command halts an ongoing MIS event like any other repeating action.
on('player.stop', ({ player, stopped }) => {
  if (!hasMisEvent(player.id)) return;
  const meta = stopMisEvent(player.id);
  stopped.push(meta?.action ? `${meta.action}ing${meta.target ? ` ${meta.target}` : ''}` : 'what you were doing');
});

// The WS-level Maturity Slider toggle (server/index.js) emits this after
// flipping the player's fields; the plugin owns the consequences.
on('mis.toggled', ({ player, enabled }) => {
  if (enabled) {
    sendToPlayer(player.id, { type: 'output', message: MIS_TUTORIAL });
  } else {
    stopMisEvent(player.id);
    sendToPlayer(player.id, { type: 'output', message: 'MIS disabled.' });
  }
});

// Horniness decay — only starts 5 minutes after the last increase.
// (Moved from gameLoop's minute tick.)
schedule('1m', async () => {
  for (const player of getAllLivePlayers()) {
    if ((player.horniness || 0) <= 0) continue;
    const lastIncrease = player.horniness_last_increased || 0;
    const decayDelayMs = 5 * 60 * 1000;
    if (lastIncrease && (Date.now() - lastIncrease) < decayDelayMs) continue;
    player.horniness = Math.max(0, player.horniness - 1);
    await query('UPDATE players SET horniness=$1 WHERE id=$2', [player.horniness, player.id]);
    sendToPlayer(player.id, { type: 'resource_tick', messages: [], player_update: { horniness: player.horniness, mis_enabled: player.mis_enabled } });
  }

  // Transient NPC arousal cools off once nobody's touched them for a while — it's
  // in-memory only, so this just lets the meter drain back to zero after a scene.
  const decayDelayMs = 5 * 60 * 1000;
  for (const npc of world.npcs.values()) {
    if (!npc || !npc._misHorny) continue;
    if (npc._misHornyAt && (Date.now() - npc._misHornyAt) < decayDelayMs) continue;
    npc._misHorny = Math.max(0, npc._misHorny - 5);
  }
});

// ── MIS-gated appearance notes ────────────────────────────────────────────────
// describePlayerAppearance (engine, commands/world.js) fires this hook at its
// two MIS sites. Returns extra prose (or undefined), and applies the
// arousal-on-examine side effect to an attracted viewer.

async function appearanceMisNotes({ target, viewer, isSelf, broadcast, naked, bySlot = {}, layerCounts = {} }) {
  // Chest note comes back in third person ("Her …"); flip to "Your …" for self.
  const selfFix = s => (isSelf ? s.replace(/\bHer\b/g, 'Your').replace(/\bher\b/g, 'your') : s);
  let notes = '';

  if (naked) {
    const viewerForMis = isSelf ? target : (viewer || null);
    if (viewerForMis && isMisActive(viewerForMis)) {
      const envState = getEnvironmentState();
      // Fully naked: breast size + nipple state first (labia stays hidden), then
      // the ass line from describeGenitals. Gated by the naked-branch MIS check.
      const chestNote = femaleChestNote(target, 0, 0, 2, null, envState.tempC);
      if (chestNote) notes += `\n${selfFix(chestNote)}`;
      const genitalDesc = describeGenitals(target, isSelf);
      if (genitalDesc) notes += `\n${genitalDesc}`;
      const ejacNote = ejaculateDescription(target, isSelf, new Set());
      if (ejacNote) notes += `\n${ejacNote}`;
    }

    // Arousal on examine: viewer sees naked target they're attracted to
    if (!isSelf && viewer && isMisActive(viewer) && isAttractedTo(viewer, target) && broadcast) {
      const arouseMsgs = await addHorniness(viewer, 8, broadcast);
      if (arouseMsgs.length) broadcast(null, { type:'resource_tick', messages: arouseMsgs, player_update: { horniness: viewer.horniness } }, null, viewer.id);
    }

    return notes || undefined;
  }

  // Clothed branch — gated on viewer's (or self's) MIS
  const viewerMis = isSelf ? isMisActive(target) : (viewer && isMisActive(viewer));
  if (!viewerMis) return undefined;

  const coveredSlots = new Set(Object.keys(bySlot));
  const ejacNote = ejaculateDescription(target, isSelf, coveredSlots);
  if (ejacNote) notes += `\n${ejacNote}`;
  const envState = getEnvironmentState();

  // Erection visible through ≤3 layers of tight clothing
  const tightSlots = new Set(
    Object.entries(bySlot).filter(([,v]) => v.tags?.bulkiness <= 2).map(([k]) => k)
  );
  const legsLayerCount = layerCounts['legs'] || 0;
  const erectNote = erectionVisibilityNote(target, tightSlots, legsLayerCount);
  if (erectNote) notes += `\n${erectNote}`;

  // Breast/nipple visibility for females
  const torsoLayerCount = layerCounts['torso'] || 0;
  const torsoItem = bySlot['torso'];
  const outermostBulkiness = torsoItem?.tags?.bulkiness || 0;
  // New 3-layer model: an underwear-layer piece is the bra equivalent (1); anything
  // else worn over the torso reads as clothing (2). Mirrors the old layer-max semantics.
  const outermostLayerMax = torsoItem?.tags?.layer === 'underwear' ? 1 : 2;
  // Torso bare or under a single under-layer → breast size; thin layers → nipple
  // show-through. This is the single source for the female chest (one note only).
  const breastNote = breastVisibilityNote(target, torsoLayerCount, outermostBulkiness, outermostLayerMax, torsoItem?.name, envState.tempC);
  if (breastNote) notes += `\n${selfFix(breastNote)}`;

  // Show genitals/ass when legs are naked (no leg layer)
  if (legsLayerCount === 0) {
    const genitalDesc = describeGenitals(target, isSelf);
    if (genitalDesc) notes += `\n${genitalDesc}`;
  }

  // Arousal on examine: visible erection or nipples on attracted viewer
  if (!isSelf && viewer && isMisActive(viewer) && isAttractedTo(viewer, target) && broadcast) {
    const visibleSex = erectNote || breastNote || (legsLayerCount === 0 ? describeGenitals(target, false) : null);
    if (visibleSex) {
      const arouseMsgs = await addHorniness(viewer, 5, broadcast);
      if (arouseMsgs.length) broadcast(null, { type:'resource_tick', messages: arouseMsgs, player_update: { horniness: viewer.horniness } }, null, viewer.id);
    }
  }

  return notes || undefined;
}

export const hooks = {
  'player.appearanceMisNotes': appearanceMisNotes,
};

console.log('[mis] Plugin loaded.');
