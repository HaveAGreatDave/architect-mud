/**
 * MIS command handlers — sexual interaction commands, player opt-in toggle,
 * and the wash command.
 *
 * All sexual commands require: server MIS enabled AND player.mis_enabled=1.
 * Players opt in via the hidden Maturity Slider in client settings.
 */
import { query } from '../../models/db.js';
import {
  isMisActive, isAttractedTo, addHorniness, washEjaculate, MIS_TUTORIAL,
  startMisEvent, stopMisEvent, hasMisEvent, getMisEventMeta,
  triggerClimax, triggerGroundClimax,
  MASTURBATE_EVENT_MALE, MASTURBATE_EVENT_FEMALE,
  FUCK_EVENT_MSGS, FUCK_EVENT_PLAYER_MSGS, FUCK_EVENT_TARGET_MSGS, EJACULATE_ZONE_MSGS,
} from '../mis.js';
import { getZonePlayers, getZoneNpcs, getLivePlayer } from '../world.js';
import { stainZone, stainClothing } from '../bodily.js';
import { resolve as siftResolve, createSelectionState, formatSelectionPage } from '../sift.js';

function misGate(player, raw) {
  if (!isMisActive(player)) {
    const cmd = (raw || '').split(/\s+/)[0] || '';
    return { type:'error', message:`Unknown command: "${cmd}". Type HELP for commands.` };
  }
  return null;
}

// Broadcast a zone event only to players who have MIS enabled
function broadcastMis(zoneId, message, broadcast, excludePlayerId = null, alsoTargetId = null) {
  for (const p of getZonePlayers(zoneId)) {
    if (p.id === excludePlayerId) continue;
    if (alsoTargetId && p.id === alsoTargetId) continue; // target gets their own message
    if (isMisActive(p)) broadcast(null, message, null, p.id);
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

// Stop the current repeating MIS action
async function cmdStop(args, player) {
  if (!hasMisEvent(player.id)) return { type:'output', message:`You aren't doing anything to stop.` };
  const meta = stopMisEvent(player.id);
  if (meta?.action) {
    const suffix = meta.target ? `ing ${meta.target}` : `ing`;
    return { type:'output', message:`Stopped ${meta.action}${suffix}.` };
  }
  return { type:'output', message:`You stop.` };
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
      const msg = await triggerGroundClimax(live);
      await stainZone(live.current_zone, 'ejaculate');
      const zoneMsgs = EJACULATE_ZONE_MSGS.ground;
      const zoneText = zoneMsgs[Math.floor(Math.random() * zoneMsgs.length)].replace('{name}', live.handle);
      broadcastMis(live.current_zone, { type: 'zone_event', message: zoneText }, broadcast, live.id);
      // Player sees the zone message too
      broadcast(null, { type: 'zone_event', message: zoneText }, null, playerId);
      broadcast(null, {
        type: 'resource_tick',
        messages: msg,
        player_update: { horniness: live.horniness, erect: live.erect, sanity: live.sanity },
      }, null, playerId);
      return;
    }

    const zoneMsg = eventPool[Math.floor(Math.random() * eventPool.length)].replace('{name}', live.handle);
    broadcastMis(live.current_zone, { type: 'zone_event', message: zoneMsg }, broadcast, live.id);
    // Player sees their own zone message
    broadcast(null, { type: 'zone_event', message: zoneMsg }, null, playerId);

    const climaxMsgs = await addHorniness(live, tickArousal, broadcast);
    broadcast(null, {
      type: 'resource_tick',
      messages: climaxMsgs,
      player_update: { horniness: live.horniness, erect: live.erect, sanity: live.sanity },
    }, null, playerId);
  }, 8000, { action: 'masturbat' });

  const msgs = await addHorniness(player, 10, broadcast);
  if (msgs.length) broadcast(null, { type:'resource_tick', messages: msgs, player_update: { horniness: player.horniness } }, null, player.id);

  return { type:'output', message: startMsg };
}

// jerk off on <target> — masturbate against/on someone
async function cmdJerkOffOn(args, raw, player, broadcast) {
  const gate = misGate(player, raw);
  if (gate) return gate;

  const str = raw.replace(/^(?:jerk(?:\s+off)?(?:\s+on)?|jackoff\s+on?)\s*/i, '').trim();
  if (!str) return { type:'error', message:`Usage: jerk off on <target>` };

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

  return { type:'output', message: actorMsgs[Math.floor(Math.random() * actorMsgs.length)] };
}

async function cmdSuck(args, raw, player, broadcast) {
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

  // No argument or "on ground" / "on floor"
  if (!str || /^on\s+(?:the\s+)?(?:ground|floor)$/.test(str)) {
    const msg = await triggerGroundClimax(player);
    await stainZone(player.current_zone, 'ejaculate');
    const zonePool = EJACULATE_ZONE_MSGS.ground;
    broadcast(player.current_zone, {
      type: 'zone_event',
      message: zonePool[Math.floor(Math.random() * zonePool.length)].replace('{name}', player.handle),
    }, player.id);
    broadcast(null, {
      type: 'resource_tick',
      messages: msg,
      player_update: { horniness: player.horniness, erect: player.erect, sanity: player.sanity },
    }, null, player.id);
    return { type:'output', message: `You let go and finish on the ground.` };
  }

  // "on <name>'s <part>"
  const playerPartMatch = str.match(/^on\s+(.+?)'s\s+(.+)$/i);
  if (playerPartMatch) {
    const targetStr = playerPartMatch[1].trim();
    const part = playerPartMatch[2].trim();
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
  broadcast(null, {
    type: 'resource_tick',
    messages: msg,
    player_update: { horniness: player.horniness, erect: player.erect, sanity: player.sanity },
  }, null, player.id);
  return { type:'output', message: `You come on the ground.` };
}

// Eat out — cunnilingus or rimjob. Player gains small arousal, target gains a lot.
async function cmdEatOut(args, raw, player, broadcast) {
  const gate = misGate(player, raw);
  if (gate) return gate;

  // Parse: eat out <target>'s [pussy|ass] OR eat out <target> [pussy|ass]
  const str = raw.replace(/^eat\s+out\s*/i, '').trim();
  const apostropheMatch = str.match(/^(.+?)'s\s+(pussy|ass|cunt|vagina|anus|asshole)$/i);
  let targetStr, part;
  if (apostropheMatch) {
    targetStr = apostropheMatch[1].trim();
    part = apostropheMatch[2].toLowerCase();
  } else {
    const words = str.split(/\s+/);
    targetStr = words[0] || '';
    part = words.slice(1).join(' ').toLowerCase() || 'pussy';
  }
  const isPussy = /pussy|cunt|vagina/.test(part);
  const partLabel = isPussy ? 'pussy' : 'ass';

  if (!targetStr) return { type:'error', message:`Usage: eat out <target>'s [pussy/ass]` };

  const { res, error, ambiguous } = resolveTargetMis(targetStr, player);
  if (ambiguous) return ambiguous;
  if (error) return { type:'error', message: error };
  const name = targetName(res);

  const actorMsgs = isPussy ? [
    `You get between ${name}'s legs and go down on them.`,
    `You bury your face in ${name}'s pussy and get to work.`,
    `You drag your tongue through ${name}'s folds slowly.`,
    `You eat ${name} out with focused, deliberate attention.`,
  ] : [
    `You press your face into ${name}'s ass and get to work.`,
    `Your tongue works at ${name}'s ass with slow, deliberate strokes.`,
    `You rim ${name} thoroughly.`,
  ];

  const targetReceiveMsgs = isPussy ? [
    `${player.handle} gets between your legs and goes down on you.`,
    `${player.handle} buries their face in your pussy.`,
    `${player.handle}'s tongue drags through you slowly.`,
    `${player.handle} eats you out with focused attention.`,
  ] : [
    `${player.handle} presses their face into your ass.`,
    `${player.handle}'s tongue works at your ass with deliberate strokes.`,
    `${player.handle} rims you thoroughly.`,
  ];

  const actorMsg = actorMsgs[Math.floor(Math.random() * actorMsgs.length)];

  // Player gains small arousal; target gains a lot
  const actorMsgs2 = await addHorniness(player, 8, broadcast);
  player.sanity = Math.min(player.sanity_max || 100, (player.sanity || 50) + 5);
  await query('UPDATE players SET sanity=$1 WHERE id=$2', [player.sanity, player.id]);
  if (actorMsgs2.length) broadcast(null, { type:'resource_tick', messages: actorMsgs2, player_update: { horniness: player.horniness } }, null, player.id);

  if (res.type === 'player' && isMisActive(res.target)) {
    if (isAttractedTo(res.target, player)) {
      const targetArousals = await addHorniness(res.target, 22, broadcast);
      if (targetArousals.length) broadcast(null, { type:'resource_tick', messages: targetArousals, player_update: { horniness: res.target.horniness } }, null, res.target.id);
    }
    broadcast(null, { type:'output', message: targetReceiveMsgs[Math.floor(Math.random() * targetReceiveMsgs.length)] }, null, res.target.id);
    res.target.sanity = Math.min(res.target.sanity_max || 100, (res.target.sanity || 50) + 10);
    await query('UPDATE players SET sanity=$1 WHERE id=$2', [res.target.sanity, res.target.id]);
  }

  broadcast(player.current_zone, {
    type: 'zone_event',
    message: `${player.handle} goes down on ${name}.`,
  }, player.id, res.type === 'player' ? res.target.id : null);

  return { type:'output', message: actorMsg };
}

// Blowjob: if actor is female performing on a male, route to suck cock
async function cmdBlowjob(args, raw, player, broadcast) {
  const target = args.join(' ');
  if (!target) return { type:'error', message:`Usage: blowjob <target>` };
  // Female actor giving blowjob to male target → suck cock
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

// Handjob shortcut
async function cmdHandjob(args, raw, player, broadcast) {
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

export const handlers = {
  mis:          (args, raw, player, broadcast) => cmdMis(args, player, broadcast),
  stop:         (args, raw, player)            => cmdStop(args, player),
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

// "jerk off on" needs special routing — handled in command index by checking raw input
export function handleJerkOffOn(args, raw, player, broadcast) {
  return cmdJerkOffOn(args, raw, player, broadcast);
}

// "eat out" needs special routing — two-word command
export function handleEatOut(args, raw, player, broadcast) {
  return cmdEatOut(args, raw, player, broadcast);
}
