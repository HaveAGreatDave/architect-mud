import { getAllLivePlayers, getZonePlayers, getZoneNpcs } from '../world.js';
import { propagateYell } from '../sounds.js';

function cmdTalk(targetStr, player) {
  if (!targetStr) return { type:'error', message:'Talk to whom?' };
  const npcs = getZoneNpcs(player.current_zone);
  const npc = npcs.find(n => n.name.toLowerCase().includes(targetStr));
  if (!npc) return { type:'error', message:`Can't find "${targetStr}" here.` };
  const root = npc.dialogue_tree?.root;
  const options = [...(root?.options || [])];
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
  if (!args.length) return { type:'error', message:'Usage: whisper <player> <message>' };
  const afterCmd = raw.replace(/^\S+\s+/, '');
  const livePlayers = getAllLivePlayers().filter(p => p.id !== player.id);
  const sorted = livePlayers.slice().sort((a,b) => b.handle.length - a.handle.length);
  const target = sorted.find(p => afterCmd.toLowerCase().startsWith(p.handle.toLowerCase()));
  if (!target) return { type:'error', message:`No online player matches "${afterCmd.split(' ')[0]}…".` };
  const msgText = afterCmd.slice(target.handle.length).trim();
  if (!msgText) return { type:'error', message:'Usage: whisper <player> <message>' };
  broadcast(null, { type:'whisper', from: player.handle, message: msgText }, null, target.id);
  return { type:'whisper_sent', to: target.handle, message: msgText };
}

const ADMIN_ROLES = new Set(['admin', 'dev', 'builder', 'designer']);

function cmdZotnet(text, player, broadcast) {
  if (!ADMIN_ROLES.has(player.role)) return { type: 'error', message: 'Access denied.' };
  if (!text.trim()) return { type: 'error', message: 'Say something on #zotnet.' };
  const admins = getAllLivePlayers().filter(p => ADMIN_ROLES.has(p.role));
  for (const admin of admins) {
    broadcast(null, { type: 'zotnet', from: player.handle, message: text.trim() }, null, admin.id);
  }
  return null;
}

async function cmdWho() {
  const online = getAllLivePlayers().filter(p => p.role !== 'admin' && p.role !== 'ghost');
  if (!online.length) return { type:'who', message:'No other survivors currently online.' };
  let msg = '<span class="who-header">SURVIVORS ONLINE</span>\n';
  for (const p of online) msg += `  ${p.handle.padEnd(20)} ${p.current_zone}\n`;
  return { type:'who', message:msg };
}

function cmdObama(targetStr, player, broadcast) {
  if (!targetStr) return { type:'error', message:'Fist bump whom?' };
  const others = getZonePlayers(player.current_zone).filter(p => p.id !== player.id);
  const target = others.find(p => p.handle.toLowerCase().includes(targetStr));
  if (!target) return { type:'error', message:`Can't find "${targetStr}" here to fist bump.` };
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
  zotnet:  (args, raw, player, broadcast) => cmdZotnet(raw.replace(/^zotnet\s*/i, ''), player, broadcast),
  obama:   (args, raw, player, broadcast) => cmdObama(args.join(' '), player, broadcast),
};
