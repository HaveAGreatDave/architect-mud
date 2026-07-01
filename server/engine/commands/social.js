import { getAllLivePlayers, getZonePlayers, getZoneNpcs, getZoneEnemies } from '../world.js';
import { formatBattleCry } from '../combat.js';
import { propagateYell } from '../sounds.js';
import { canAccessChannel, broadcastToChannel } from '../channels.js';
import { evalConditions } from '../flags.js';
import { resolve as siftResolve, createSelectionState, formatSelectionPage } from '../sift.js';

async function cmdTalk(targetStr, player) {
  if (!targetStr) return { type:'error', message:'Talk to whom?' };
  const npcs = getZoneNpcs(player.current_zone);
  const r = siftResolve(targetStr, npcs);
  if (r.type === 'none') return { type:'error', message:`Can't find "${targetStr}" here.` };
  if (r.type === 'ambiguous') {
    createSelectionState(player.id, r.candidates, { verb: 'talk' });
    return { type:'output', message: formatSelectionPage({ allCandidates: r.candidates, visibleIndex: 0, pageSize: 5 }) };
  }
  const npc = r.candidate;
  const root = npc.dialogue_tree?.root;
  // Condition-gate root options against the player's Flags (Phase 4).
  const options = [];
  for (const opt of (root?.options || [])) {
    if (!(await evalConditions(opt.conditions || opt.condition, player))) continue;
    options.push(opt);
  }
  if (npc.vendor_inventory?.length) options.push({ label: 'Browse your wares.', next: '__shop__' });
  if (!root && !options.length) return { type:'talk', message:`${npc.name} doesn't want to talk.` };
  return { type:'dialogue', npcId:npc.id, npcName:npc.name, node:'root', text:root?.text || `${npc.name} glances up at you.`, options };
}

function cmdSay(text, player, broadcast) {
  if (!text) return { type:'error', message:'Say what?' };
  if (text.length >= 3 && text === text.toUpperCase() && /[A-Z]/.test(text)) {
    return cmdYell(text, player, broadcast);
  }
  broadcast(player.current_zone, { type:'say', message:`${player.handle} says: "${text}"` }, player.id);
  return { type:'say', message:`You say: "${text}"` };
}

function cmdYell(text, player, broadcast) {
  if (!text.trim()) return { type:'error', message:'Yell what?' };
  propagateYell(player.current_zone, player.id, player.handle, text.trim(), broadcast);
  return { type:'output', message:`<span style="color:var(--yellow);font-weight:bold">You yell: "${text.trim().toUpperCase()}"</span>` };
}

function cmdWhisper(args, raw, player, broadcast) {
  if (!args.length) return { type:'error', message:'Usage: whisper <player|#channel> <message>' };
  const afterCmd = raw.replace(/^\S+\s+/, '');
  const targetWord = args[0];

  // Channel whisper: target starts with #
  if (targetWord.startsWith('#')) {
    const channelId = targetWord.toLowerCase();
    const msgText = afterCmd.slice(targetWord.length).trim();
    if (!msgText) return { type:'error', message:`Usage: whisper ${channelId} <message>` };
    if (!canAccessChannel(channelId, player)) return { type:'error', message:`No such channel: ${channelId}` };
    broadcastToChannel(channelId, { type:'channel_msg', channel: channelId, from: player.handle, message: msgText }, broadcast);
    return null;
  }

  // Player whisper
  const livePlayers = getAllLivePlayers().filter(p => p.id !== player.id);
  const sorted = livePlayers.slice().sort((a,b) => b.handle.length - a.handle.length);
  const target = sorted.find(p => afterCmd.toLowerCase().startsWith(p.handle.toLowerCase()));
  if (!target) return { type:'error', message:`No online player matches "${afterCmd.split(' ')[0]}…".` };
  const msgText = afterCmd.slice(target.handle.length).trim();
  if (!msgText) return { type:'error', message:'Usage: whisper <player> <message>' };
  broadcast(null, { type:'whisper', from: player.handle, message: msgText }, null, target.id);
  return { type:'whisper_sent', to: target.handle, message: msgText };
}

async function cmdWho() {
  const online = getAllLivePlayers().filter(p => p.role !== 'admin' && p.role !== 'ghost');
  if (!online.length) return { type:'who', message:'No other survivors currently online.' };
  let msg = '<span class="who-header">SURVIVORS ONLINE</span>\n';
  for (const p of online) msg += `  ${p.handle.padEnd(20)} ${p.current_zone}\n`;
  return { type:'who', message:msg };
}

const ANIMAL_KEYWORDS = ['cat', 'dog', 'kitten', 'puppy', 'hound', 'feline', 'canine', 'wolf', 'fox', 'rabbit', 'rat', 'bird', 'parrot', 'snake', 'lizard'];

function isAnimal(name) {
  const lower = name.toLowerCase();
  return ANIMAL_KEYWORDS.some(k => lower.includes(k));
}

function cmdPet(targetStr, player, broadcast) {
  if (!targetStr) return { type: 'error', message: 'Pet what?' };

  const npcs    = getZoneNpcs(player.current_zone).map(n => ({ ...n, _kind: 'npc' }));
  const enemies = getZoneEnemies(player.current_zone).map(e => ({ ...e, _kind: 'enemy' }));
  const animals = [...npcs, ...enemies].filter(e => isAnimal(e.name));

  if (!animals.length) return { type: 'error', message: "There's nothing here worth petting." };

  const r = siftResolve(targetStr, animals);
  if (r.type === 'none')      return { type: 'error', message: `Can't find "${targetStr}" here.` };
  if (r.type === 'ambiguous') {
    createSelectionState(player.id, r.candidates, { verb: 'pet' });
    return { type: 'output', message: formatSelectionPage({ allCandidates: r.candidates, visibleIndex: 0, pageSize: 5 }) };
  }

  const target = r.candidate;

  if (target._kind === 'enemy') {
    // Emit a battlecry and bump threat level by 3 (≈ +15% aggro chance)
    const cries = target.flags?.battle_cries;
    if (Array.isArray(cries) && cries.length) {
      const cry = cries[Math.floor(Math.random() * cries.length)]
        .replace(/\$enemy/g, target.name)
        .replace(/\$player/g, player.handle);
      broadcast(player.current_zone, { type: 'output', message: formatBattleCry(target.name, cry) });
    } else {
      broadcast(player.current_zone, { type: 'output', message: `${target.name} snaps angrily at your hand!` });
    }
    target._threatLevel = (target._threatLevel || 0) + 3;
    broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} reaches out to pet ${target.name}. Bad idea.` }, player.id);
    return { type: 'output', message: `You reach out to pet ${target.name}. It does not appreciate this.` };
  }

  // NPC animal — wholesome
  broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} pets ${target.name}.` }, player.id);
  return { type: 'output', message: `You pet ${target.name}. It seems to enjoy the attention.` };
}

function cmdObama(targetStr, player, broadcast) {
  if (!targetStr) return { type:'error', message:'Fist bump whom?' };
  const others = getZonePlayers(player.current_zone).filter(p => p.id !== player.id);
  const candidates = others.map(p => ({ ...p, name: p.handle }));
  const r = siftResolve(targetStr, candidates);
  if (r.type === 'none') return { type:'error', message:`Can't find "${targetStr}" here to fist bump.` };
  if (r.type === 'ambiguous') {
    createSelectionState(player.id, r.candidates, { verb: 'obama' });
    return { type:'output', message: formatSelectionPage({ allCandidates: r.candidates, visibleIndex: 0, pageSize: 5 }) };
  }
  const target = r.candidate;
  broadcast(player.current_zone, { type:'zone_event', message:`${player.handle} fist bumps ${target.handle}. Yes, we can.` }, null);
  return { type:'emote', message:`You fist bump ${target.handle}.` };
}

export const handlers = {
  talk:    (args, raw, player) => cmdTalk(args.join(' '), player),
  speak:   (args, raw, player) => cmdTalk(args.join(' '), player),
  say:     (args, raw, player, broadcast) => cmdSay(raw.replace(/^say\s*/i,''), player, broadcast),
  yell:    (args, raw, player, broadcast) => cmdYell(raw.replace(/^(yell|shout)\s*/i,''), player, broadcast),
  shout:   (args, raw, player, broadcast) => cmdYell(raw.replace(/^(yell|shout)\s*/i,''), player, broadcast),
  whisper: (args, raw, player, broadcast) => cmdWhisper(args, raw, player, broadcast),
  tell:    (args, raw, player, broadcast) => cmdWhisper(args, raw, player, broadcast),
  t:       (args, raw, player, broadcast) => cmdWhisper(args, raw, player, broadcast),
  who:     () => cmdWho(),
  obama:   (args, raw, player, broadcast) => cmdObama(args.join(' '), player, broadcast),
  pet:     (args, raw, player, broadcast) => cmdPet(args.join(' '), player, broadcast),
};
