/**
 * MIS command handlers — sexual interaction commands, player opt-in toggle,
 * and the wash command.
 *
 * All sexual commands require: server MIS enabled AND player.mis_enabled=1.
 * Players opt in by typing MISON64 in the client settings debug field.
 */
import { query } from '../../models/db.js';
import { isMisServerEnabled, isMisActive, addHorniness, washEjaculate, MIS_TUTORIAL } from '../mis.js';
import { getZonePlayers, getZoneNpcs } from '../world.js';

function misGate(player) {
  if (!isMisServerEnabled()) return { type:'error', message:`That feature isn't available on this server.` };
  if (!isMisActive(player)) return { type:'error', message:`MIS is not enabled. Use the debug field in settings.` };
  return null;
}

async function cmdMis(args, player, broadcast) {
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'on') {
    if (!isMisServerEnabled()) return { type:'error', message:`MIS is not enabled on this server.` };
    if (isMisActive(player)) return { type:'output', message:`MIS is already active.` };
    player.mis_enabled = 1;
    await query('UPDATE players SET mis_enabled=1 WHERE id=$1', [player.id]);
    // Tutorial + self-examination
    const { physicalDescription } = await import('../appearance.js');
    const selfDesc = physicalDescription(player, true) || '';
    return { type:'output', message: MIS_TUTORIAL + (selfDesc ? `\n\n${selfDesc}` : '') };
  }
  if (sub === 'off') {
    player.mis_enabled = 0;
    player.horniness = 0;
    player.erect = 0;
    await query('UPDATE players SET mis_enabled=0, horniness=0, erect=0 WHERE id=$1', [player.id]);
    return { type:'output', message:`MIS disabled.` };
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

// Generic act handler: pick a description, add horniness, restore sanity
async function actHandler({ player, broadcast, rawArgs, defaultPart, actVerb, selfMessages, targetMessages, horninessGain, sanityGain = 5 }) {
  const gate = misGate(player);
  if (gate) return gate;

  const args = rawArgs.join(' ');
  let targetStr = args;
  let part = defaultPart;

  // "touch breasts" → self; "touch bob chest" → target=bob part=chest
  const words = args.split(/\s+/);
  const firstWord = words[0] || '';

  const others = getZonePlayers(player.current_zone).filter(p => p.id !== player.id);
  const npcs = getZoneNpcs(player.current_zone);
  const allNames = [...others.map(p => p.handle.toLowerCase()), ...npcs.map(n => n.name.toLowerCase())];
  const matchedName = allNames.find(n => firstWord.startsWith(n.split(' ')[0]));

  if (!matchedName && words.length === 1) {
    // Could be a body part on self
    part = firstWord || defaultPart;
    targetStr = '';
  } else if (matchedName) {
    targetStr = firstWord;
    part = words.slice(1).join(' ') || defaultPart;
  }

  if (!targetStr || targetStr === 'me' || targetStr === 'myself') {
    // Self act
    const msgs = await addHorniness(player, Math.floor(horninessGain * 0.6), broadcast);
    if (sanityGain) {
      player.sanity = Math.min(player.sanity_max || 100, (player.sanity || 50) + sanityGain);
      await query('UPDATE players SET sanity=$1 WHERE id=$2', [player.sanity, player.id]);
    }
    const selfMsg = pickMsg(selfMessages, { part });
    if (msgs.length) broadcast(null, { type:'resource_tick', messages: msgs }, null, player.id);
    return { type:'output', message: selfMsg };
  }

  const res = resolveTarget(targetStr, player);
  if (!res) return { type:'error', message:`You don't see "${targetStr}" here.` };
  const name = targetName(res);

  const msgs = await addHorniness(player, horninessGain, broadcast);
  if (res.type === 'player' && isMisActive(res.target)) {
    const targetMsgs = await addHorniness(res.target, Math.floor(horninessGain * 0.8), broadcast);
    if (targetMsgs.length) broadcast(null, { type:'resource_tick', messages: targetMsgs }, null, res.target.id);
    // Notify target
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

function pickMsg(pool, vars) {
  const tpl = pool[Math.floor(Math.random() * pool.length)];
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] || k);
}

// --- Command implementations ---

async function cmdTouch(args, raw, player, broadcast) {
  return actHandler({
    player, broadcast, rawArgs: args,
    defaultPart: 'body',
    actVerb: 'touch',
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

async function cmdKiss(args, raw, player, broadcast) {
  return actHandler({
    player, broadcast, rawArgs: args,
    defaultPart: 'lips',
    selfMessages: [`You kiss the back of your own hand. Charming.`],
    targetMessages: [
      `You kiss {name}.`,
      `You lean in and kiss {name} softly.`,
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
      `You touch yourself there.`,
    ],
    targetMessages: [
      `You cup {name}'s chest with both hands.`,
      `Your hands find {name}'s {part}.`,
    ],
    horninessGain: 15,
    sanityGain: 5,
  });
}

async function cmdStroke(args, raw, player, broadcast) {
  const gate = misGate(player);
  if (gate) return gate;
  const msgs = await addHorniness(player, 18, broadcast);
  player.sanity = Math.min(player.sanity_max || 100, (player.sanity || 50) + 6);
  await query('UPDATE players SET sanity=$1 WHERE id=$2', [player.sanity, player.id]);
  if (msgs.length) broadcast(null, { type:'resource_tick', messages: msgs }, null, player.id);
  return { type:'output', message: `You take a private moment. The tension eases, slightly.` };
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

async function cmdInsert(args, raw, player, broadcast) {
  const gate = misGate(player);
  if (gate) return gate;

  // Parse: "insert <what> into <target/location>"
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

  // Accepts: a sink in the zone OR a water item in inventory
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
  mis:        (args, raw, player, broadcast) => cmdMis(args, player, broadcast),
  touch:      (args, raw, player, broadcast) => cmdTouch(args, raw, player, broadcast),
  grope:      (args, raw, player, broadcast) => cmdTouch(args, raw, player, broadcast),
  kiss:       (args, raw, player, broadcast) => cmdKiss(args, raw, player, broadcast),
  lick:       (args, raw, player, broadcast) => cmdLick(args, raw, player, broadcast),
  fondle:     (args, raw, player, broadcast) => cmdFondle(args, raw, player, broadcast),
  stroke:     (args, raw, player, broadcast) => cmdStroke(args, raw, player, broadcast),
  masturbate: (args, raw, player, broadcast) => cmdStroke(args, raw, player, broadcast),
  suck:       (args, raw, player, broadcast) => cmdSuck(args, raw, player, broadcast),
  insert:     (args, raw, player, broadcast) => cmdInsert(args, raw, player, broadcast),
  wash:       (args, raw, player)            => cmdWash(args, raw, player),
};
