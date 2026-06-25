/**
 * MIS command handlers — sexual interaction commands, player opt-in toggle,
 * and the wash command.
 *
 * All sexual commands require: server MIS enabled AND player.mis_enabled=1.
 * Players opt in by typing MISON64 in the client settings debug field.
 */
import { query } from '../../models/db.js';
import {
  isMisActive, addHorniness, washEjaculate, MIS_TUTORIAL,
  startMisEvent, stopMisEvent, hasMisEvent,
  triggerClimax, triggerGroundClimax,
  MASTURBATE_EVENT_MALE, MASTURBATE_EVENT_FEMALE,
  FUCK_EVENT_MSGS, EJACULATE_ZONE_MSGS,
} from '../mis.js';
import { getZonePlayers, getZoneNpcs, getLivePlayer } from '../world.js';

function misGate(player) {
  if (!isMisActive(player)) return { type:'error', message:`MIS is not enabled. Use the debug field in settings.` };
  return null;
}

async function cmdMis(args, player, broadcast) {
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'on') {
    if (isMisActive(player)) return { type:'output', message:`MIS is already active.` };
    player.mis_enabled = 1;
    await query('UPDATE players SET mis_enabled=1 WHERE id=$1', [player.id]);
    const { physicalDescription } = await import('../appearance.js');
    const selfDesc = physicalDescription(player, true) || '';
    return { type:'output', message: MIS_TUTORIAL + (selfDesc ? `\n\n${selfDesc}` : ''), player_update: { mis_enabled: 1, horniness: player.horniness || 0 } };
  }
  if (sub === 'off') {
    stopMisEvent(player.id);
    player.mis_enabled = 0;
    player.horniness = 0;
    player.erect = 0;
    await query('UPDATE players SET mis_enabled=0, horniness=0, erect=0 WHERE id=$1', [player.id]);
    return { type:'output', message:`MIS disabled.`, player_update: { mis_enabled: 0, horniness: 0 } };
  }
  return { type:'error', message:`Usage: mis on / mis off` };
}

// Resolve a target (player or NPC) in the current zone by name fragment
function resolveTarget(nameStr, player) {
  const t = nameStr.toLowerCase();
  const others = getZonePlayers(player.current_zone).filter(p => p.id !== player.id);
  const targetPlayer = others.find(p => p.handle.toLowerCase().includes(t));
  if (targetPlayer) return { type: 'player', target: targetPlayer };
  const npcs = getZoneNpcs(player.current_zone);
  const npc = npcs.find(n => n.name.toLowerCase().includes(t));
  if (npc) return { type: 'npc', target: npc };
  return null;
}

function targetName(res) {
  return res.type === 'player' ? res.target.handle : res.target.name;
}

function pickMsg(pool, vars) {
  const tpl = pool[Math.floor(Math.random() * pool.length)];
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] || k);
}

// Generic act handler for touching/kissing/etc. — resolves target or defaults to self
async function actHandler({ player, broadcast, rawArgs, defaultPart, selfMessages, targetMessages, horninessGain, sanityGain = 5 }) {
  const gate = misGate(player);
  if (gate) return gate;

  const args = rawArgs.join(' ');
  let targetStr = args;
  let part = defaultPart;

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

  if (!targetStr || targetStr === 'me' || targetStr === 'myself') {
    const msgs = await addHorniness(player, Math.floor(horninessGain * 0.6), broadcast);
    if (sanityGain) {
      player.sanity = Math.min(player.sanity_max || 100, (player.sanity || 50) + sanityGain);
      await query('UPDATE players SET sanity=$1 WHERE id=$2', [player.sanity, player.id]);
    }
    if (msgs.length) broadcast(null, { type:'resource_tick', messages: msgs }, null, player.id);
    return { type:'output', message: pickMsg(selfMessages, { part }) };
  }

  const res = resolveTarget(targetStr, player);
  if (!res) return { type:'error', message:`You don't see "${targetStr}" here.` };
  const name = targetName(res);

  const msgs = await addHorniness(player, horninessGain, broadcast);
  if (res.type === 'player' && isMisActive(res.target)) {
    const targetMsgs = await addHorniness(res.target, Math.floor(horninessGain * 0.8), broadcast);
    if (targetMsgs.length) broadcast(null, { type:'resource_tick', messages: targetMsgs }, null, res.target.id);
    broadcast(null, { type:'output', message: pickMsg(targetMessages || selfMessages, { part, actor: player.handle }) }, null, res.target.id);
  }
  if (sanityGain) {
    player.sanity = Math.min(player.sanity_max || 100, (player.sanity || 50) + sanityGain);
    await query('UPDATE players SET sanity=$1 WHERE id=$2', [player.sanity, player.id]);
  }
  if (msgs.length) broadcast(null, { type:'resource_tick', messages: msgs }, null, player.id);
  broadcast(player.current_zone, { type:'zone_event', message: `${player.handle} and ${name} are getting intimate.` }, player.id, res.type === 'player' ? res.target.id : null);
  return { type:'output', message: pickMsg(targetMessages || selfMessages, { part, actor: player.handle, name }) };
}

// --- Command implementations ---

async function cmdTouch(args, raw, player, broadcast) {
  return actHandler({
    player, broadcast, rawArgs: args,
    defaultPart: 'body',
    selfMessages: [
      `You run your hands over your own {part}.`,
      `You touch your {part}, feeling the warmth of skin.`,
    ],
    targetMessages: [
      `You reach out and touch {name}'s {part}.`,
      `Your hand finds {name}'s {part}.`,
    ],
    horninessGain: 8,
    sanityGain: 3,
  });
}

async function cmdSqueeze(args, raw, player, broadcast) {
  return actHandler({
    player, broadcast, rawArgs: args,
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
    horninessGain: 12,
    sanityGain: 4,
  });
}

async function cmdKiss(args, raw, player, broadcast) {
  return actHandler({
    player, broadcast, rawArgs: args,
    defaultPart: 'lips',
    selfMessages: [`You kiss the back of your own hand. Charming.`],
    targetMessages: [
      `You kiss {name}.`,
      `You lean in and kiss {name} softly.`,
      `You press your lips against {name}'s.`,
    ],
    horninessGain: 6,
    sanityGain: 5,
  });
}

async function cmdLick(args, raw, player, broadcast) {
  return actHandler({
    player, broadcast, rawArgs: args,
    defaultPart: 'neck',
    selfMessages: [`You lick your own {part}. No judgement.`],
    targetMessages: [
      `You drag your tongue slowly across {name}'s {part}.`,
      `You lick {name}'s {part}.`,
    ],
    horninessGain: 12,
    sanityGain: 5,
  });
}

async function cmdFondle(args, raw, player, broadcast) {
  return actHandler({
    player, broadcast, rawArgs: args,
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
    horninessGain: 15,
    sanityGain: 5,
  });
}

// slap <player>'s <body part>
async function cmdSlap(args, raw, player, broadcast) {
  const gate = misGate(player);
  if (gate) return gate;

  // Parse "slap <name>'s <part>" or "slap <name> <part>"
  const str = raw.replace(/^slap\s*/i, '').trim();
  // Try "name's part" form first
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

  const res = resolveTarget(targetStr, player);
  if (!res) return { type:'error', message:`You don't see "${targetStr}" here.` };
  const name = targetName(res);

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

  if (res.type === 'player' && isMisActive(res.target)) {
    const targetMsgs = await addHorniness(res.target, 8, broadcast);
    if (targetMsgs.length) broadcast(null, { type:'resource_tick', messages: targetMsgs }, null, res.target.id);
    broadcast(null, {
      type:'output',
      message: targetMsgPool[Math.floor(Math.random() * targetMsgPool.length)],
    }, null, res.target.id);
  }

  broadcast(player.current_zone, {
    type:'zone_event',
    message: `${player.handle} slaps ${name}'s ${part}.`,
  }, player.id, res.type === 'player' ? res.target.id : null);

  return { type:'output', message: actorMsgs[Math.floor(Math.random() * actorMsgs.length)] };
}

// Masturbation — ongoing event version
async function cmdMasturbate(args, raw, player, broadcast) {
  const gate = misGate(player);
  if (gate) return gate;

  if (hasMisEvent(player.id)) {
    stopMisEvent(player.id);
    return { type:'output', message:`You stop.` };
  }

  const isMale = player.biological_sex === 'male';
  const startMsgs = isMale
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

  const startMsg = startMsgs[Math.floor(Math.random() * startMsgs.length)];
  const eventPool = isMale ? MASTURBATE_EVENT_MALE : MASTURBATE_EVENT_FEMALE;
  const playerId = player.id;

  startMisEvent(playerId, async () => {
    const live = getLivePlayer(playerId);
    if (!live || !isMisActive(live)) { stopMisEvent(playerId); return; }

    if (live.horniness >= 100) {
      stopMisEvent(playerId);
      const msg = await triggerGroundClimax(live);
      const zoneMsgs = EJACULATE_ZONE_MSGS.ground;
      broadcast(live.current_zone, {
        type: 'zone_event',
        message: zoneMsgs[Math.floor(Math.random() * zoneMsgs.length)].replace('{name}', live.handle),
      }, live.id);
      broadcast(null, {
        type: 'resource_tick',
        messages: msg,
        player_update: { horniness: live.horniness, erect: live.erect, sanity: live.sanity },
      }, null, playerId);
      return;
    }

    const zoneMsg = eventPool[Math.floor(Math.random() * eventPool.length)].replace('{name}', live.handle);
    broadcast(live.current_zone, { type: 'zone_event', message: zoneMsg }, live.id);

    const climaxMsgs = await addHorniness(live, 18, broadcast);
    broadcast(null, {
      type: 'resource_tick',
      messages: climaxMsgs,
      player_update: { horniness: live.horniness, erect: live.erect, sanity: live.sanity },
    }, null, playerId);
  });

  const msgs = await addHorniness(player, 10, broadcast);
  if (msgs.length) broadcast(null, { type:'resource_tick', messages: msgs, player_update: { horniness: player.horniness } }, null, player.id);

  return { type:'output', message: startMsg };
}

// jerk off on <target> — masturbate against/on someone
async function cmdJerkOffOn(args, raw, player, broadcast) {
  const gate = misGate(player);
  if (gate) return gate;

  const str = raw.replace(/^(?:jerk(?:\s+off)?(?:\s+on)?|jackoff\s+on?)\s*/i, '').trim();
  if (!str) return { type:'error', message:`Usage: jerk off on <target>` };

  const res = resolveTarget(str, player);
  if (!res) return { type:'error', message:`You don't see "${str}" here.` };
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
    player, broadcast, rawArgs: args,
    defaultPart: 'fingers',
    selfMessages: [`You suck on your own {part}.`],
    targetMessages: [
      `You take {name}'s {part} into your mouth.`,
      `Your mouth finds {name}'s {part}.`,
    ],
    horninessGain: 18,
    sanityGain: 8,
  });
}

// Penetrative sex — ongoing event version
async function cmdFuck(args, raw, player, broadcast) {
  const gate = misGate(player);
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
    stopMisEvent(player.id);
    return { type:'output', message:`You stop.` };
  }

  const res = resolveTarget(targetStr, player);
  if (!res) return { type:'error', message:`You don't see "${targetStr}" here.` };
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
  broadcast(player.current_zone, { type:'zone_event', message: `${player.handle} and ${name} start having sex.` }, player.id, res.type === 'player' ? res.target.id : null);

  // Start ongoing event
  const playerId = player.id;
  const targetId = res.type === 'player' ? res.target.id : null;
  const eventPool = FUCK_EVENT_MSGS[location] || FUCK_EVENT_MSGS.default;
  const ejacPart = location === 'mouth' ? 'throat' : location === 'ass' ? 'ass' : location === 'pussy' ? 'pussy' : 'body';

  startMisEvent(playerId, async () => {
    const live = getLivePlayer(playerId);
    if (!live || !isMisActive(live)) { stopMisEvent(playerId); return; }

    if (live.horniness >= 100) {
      stopMisEvent(playerId);
      const climaxMsgs = await triggerClimax(live, broadcast, ejacPart);
      const zonePool = EJACULATE_ZONE_MSGS.into_player;
      broadcast(live.current_zone, {
        type: 'zone_event',
        message: zonePool[Math.floor(Math.random() * zonePool.length)]
          .replace('{name}', live.handle)
          .replace('{target}', name)
          .replace('{part}', ejacPart),
      }, live.id);
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

    const tpl = eventPool[Math.floor(Math.random() * eventPool.length)];
    const zoneMsg = tpl.replace('{name}', live.handle).replace('{target}', name);
    broadcast(live.current_zone, { type: 'zone_event', message: zoneMsg }, live.id);

    const climaxMsgs = await addHorniness(live, 18, broadcast);
    broadcast(null, {
      type: 'resource_tick',
      messages: climaxMsgs,
      player_update: { horniness: live.horniness, erect: live.erect },
    }, null, playerId);

    if (targetId) {
      const liveTarget = getLivePlayer(targetId);
      if (liveTarget && isMisActive(liveTarget)) {
        const targetClimaxMsgs = await addHorniness(liveTarget, 14, broadcast);
        broadcast(null, {
          type: 'resource_tick',
          messages: targetClimaxMsgs,
          player_update: { horniness: liveTarget.horniness },
        }, null, targetId);
      }
    }
  });

  return { type:'output', message: actorMsg };
}

// ejaculate / cum [on <target>'s <part> | on <furniture> | on ground | (no arg = ground)]
async function cmdEjaculate(args, raw, player, broadcast) {
  const gate = misGate(player);
  if (gate) return gate;

  stopMisEvent(player.id); // cancel any ongoing event

  const str = raw.replace(/^(?:ejaculate|cum|come)\s*/i, '').trim().toLowerCase();

  // No argument or "on ground" / "on floor"
  if (!str || /^on\s+(?:the\s+)?(?:ground|floor)$/.test(str)) {
    const msg = await triggerGroundClimax(player);
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
    const res = resolveTarget(targetStr, player);
    if (!res) return { type:'error', message:`You don't see "${targetStr}" here.` };
    const name = targetName(res);

    player.horniness = 0;
    player.erect = 0;
    player.sanity = Math.min(player.sanity_max || 100, (player.sanity || 50) + 10);
    player.horniness_last_increased = null;
    await query('UPDATE players SET horniness=$1, erect=$2, sanity=$3 WHERE id=$4',
      [player.horniness, player.erect, player.sanity, player.id]);

    const zonePool = EJACULATE_ZONE_MSGS.on_player;
    broadcast(player.current_zone, {
      type: 'zone_event',
      message: zonePool[Math.floor(Math.random() * zonePool.length)]
        .replace('{name}', player.handle)
        .replace('{target}', name)
        .replace('{part}', part),
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

// Blowjob shortcut: blowjob <target> → fuck <target> in mouth
async function cmdBlowjob(args, raw, player, broadcast) {
  const target = args.join(' ');
  if (!target) return { type:'error', message:`Usage: blowjob <target>` };
  return cmdFuck(args, `fuck ${target} in mouth`, player, broadcast);
}

// Handjob shortcut
async function cmdHandjob(args, raw, player, broadcast) {
  return actHandler({
    player, broadcast, rawArgs: args,
    defaultPart: 'cock',
    selfMessages: [`You work your own {part} with your hand.`],
    targetMessages: [
      `You wrap your hand around {name}'s {part} and stroke.`,
      `You give {name} a slow, deliberate handjob.`,
      `Your hand finds {name}'s {part} and gets to work.`,
    ],
    horninessGain: 16,
    sanityGain: 6,
  });
}

// Generic insert command
async function cmdInsert(args, raw, player, broadcast) {
  const gate = misGate(player);
  if (gate) return gate;

  const str = raw.replace(/^insert\s+/i, '');
  const intoIdx = str.toLowerCase().indexOf(' into ');
  if (intoIdx === -1) return { type:'error', message:`Usage: insert <body part> into <target or location>` };

  const what = str.slice(0, intoIdx).trim();
  const where = str.slice(intoIdx + 6).trim();

  const res = resolveTarget(where, player);
  const locationName = res ? targetName(res) : where;

  const msgs = await addHorniness(player, 22, broadcast);
  player.sanity = Math.min(player.sanity_max || 100, (player.sanity || 50) + 10);
  await query('UPDATE players SET sanity=$1 WHERE id=$2', [player.sanity, player.id]);

  if (res?.type === 'player' && isMisActive(res.target)) {
    const targetMsgs = await addHorniness(res.target, 18, broadcast);
    if (targetMsgs.length) broadcast(null, { type:'resource_tick', messages: targetMsgs }, null, res.target.id);
    broadcast(null, { type:'output', message: `${player.handle} pushes their ${what} inside you.` }, null, res.target.id);
    res.target.sanity = Math.min(res.target.sanity_max || 100, (res.target.sanity || 50) + 10);
    await query('UPDATE players SET sanity=$1 WHERE id=$2', [res.target.sanity, res.target.id]);
  }
  if (msgs.length) broadcast(null, { type:'resource_tick', messages: msgs }, null, player.id);
  if (res) broadcast(player.current_zone, { type:'zone_event', message: `${player.handle} and ${locationName} are having sex.` }, player.id, res.type === 'player' ? res.target.id : null);
  return { type:'output', message: `You press your ${what} into ${locationName}.` };
}

async function cmdWashHands(player) {
  const { rows } = await query(
    `SELECT id FROM furniture WHERE zone_id=$1 AND object_type='sink' LIMIT 1`,
    [player.current_zone]
  );
  if (!rows.length) return { type:'error', message:`There's no sink here.` };

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
    `SELECT id FROM furniture WHERE zone_id=$1 AND object_type='sink' LIMIT 1`,
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
  if (!washed) return { type:'output', message:`You're already clean.` };

  if (waterRow) {
    if (waterRow.quantity > 1) await query('UPDATE player_inventory SET quantity=quantity-1 WHERE id=$1', [waterRow.id]);
    else await query('DELETE FROM player_inventory WHERE id=$1', [waterRow.id]);
  }

  const src = hasSink ? `the sink` : `the water`;
  return { type:'output', message:`You use ${src} to clean yourself off. Better.` };
}

export const handlers = {
  mis:          (args, raw, player, broadcast) => cmdMis(args, player, broadcast),
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
  insert:       (args, raw, player, broadcast) => cmdInsert(args, raw, player, broadcast),
  ejaculate:    (args, raw, player, broadcast) => cmdEjaculate(args, raw, player, broadcast),
  cum:          (args, raw, player, broadcast) => cmdEjaculate(args, raw, player, broadcast),
  come:         (args, raw, player, broadcast) => cmdEjaculate(args, raw, player, broadcast),
  wash:         (args, raw, player)            => cmdWash(args, raw, player),
};

// "jerk off on" needs special routing — handled in command index by checking raw input
export function handleJerkOffOn(args, raw, player, broadcast) {
  return cmdJerkOffOn(args, raw, player, broadcast);
}
