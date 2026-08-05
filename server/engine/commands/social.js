import { getAllLivePlayers, getZonePlayers, getZoneNpcs, getZoneEnemies } from '../world.js';
import { formatBattleCry } from '../combat.js';
import { propagateYell } from '../sounds.js';
import { canAccessChannel, sendToChatChannel } from '../channels.js';
import { renderDialogueNode } from '../dialogue.js';
import { resolve as siftResolve, createSelectionState, formatSelectionPage } from '../sift.js';
import { DEFAULT_CHITCHAT_LINES, formatChitchat, disturbSleeper, isVendorRole, isVendorOffHours, vendorOffHoursLine } from '../ai-behaviour.js';
import { getNpcChitchat } from '../npc-personality.js';
import { fireHook } from '../plugins.js';
import { emit } from '../events.js';
import { findNpcTransformByName } from '../phantoms.js';

async function cmdTalk(targetStr, player, broadcast) {
  if (!targetStr) return { type:'error', message:'Talk to whom?' };
  const npcs = getZoneNpcs(player.current_zone);
  let r = siftResolve(targetStr, npcs);
  if (r.type === 'none') {
    // A psychedelic may be showing this viewer somebody else entirely — the room
    // has been listing them as "a heron in an apron", so that is the name they
    // will type. Resolve it back to the real person and hold the conversation
    // normally: the eyes are lying, the dialogue tree is not.
    const seen = findNpcTransformByName(player.id, targetStr);
    const real = seen && npcs.find(n => n.id === seen.npcId);
    if (real) r = { type: 'match', candidate: real };
  }
  if (r.type === 'none') return { type:'error', message:`Can't find "${targetStr}" here.` };
  if (r.type === 'ambiguous') {
    createSelectionState(player.id, r.candidates, { verb: 'talk' });
    return { type:'output', message: formatSelectionPage({ allCandidates: r.candidates, visibleIndex: 0, pageSize: 5 }) };
  }
  const npc = r.candidate;
  // Asleep? Talking at an unconscious person is its own outcome, and it happens
  // BEFORE any plugin gets to claim the conversation — a dealer who is face down
  // in his own bed is not open for business. They either sleep through it or wake
  // up (annoyed, or confused), and either way this turn ends here: the wake-up is
  // the interaction. Talk to them again now they're up.
  // The room sees it too, but not the actor twice — they get it as their answer.
  const disturbed = disturbSleeper(npc, {
    broadcast: broadcast ? (z, m) => broadcast(z, m, player.id) : null,
  });
  if (disturbed) return { type: 'output', message: disturbed.message };
  // Let a plugin claim this conversation (e.g. the shadow dealer waving in a
  // returning customer who's already learned the passphrase). Returns undefined
  // to fall through to normal dialogue/shop handling.
  const talkHook = await fireHook('npc.talk', { player, npc, broadcast });
  if (talkHook !== undefined) return talkHook;
  // A dealer away from their table's room (their work zone) won't run the poker
  // dialogue tree — off duty, they just make random dealer small talk instead.
  if (npc.npc_type === 'dealer' && npc.work_zone_id && npc.zone_id !== npc.work_zone_id) {
    const lines = getNpcChitchat(npc) || DEFAULT_CHITCHAT_LINES;
    const line = lines[Math.floor(Math.random() * lines.length)];
    const msg = formatChitchat(npc.name, line);
    if (broadcast) broadcast(player.current_zone, msg, player.id);
    return msg;
  }
  // A vendor off the timetable doesn't hold shop conversations. Their dialogue
  // tree IS the shop front — the wares option, the job hand-off, the "what can I
  // do for you" — so leaving it open after hours let a player walk past a closed
  // counter and buy through the panel anyway. Off the clock, they say so and
  // that's the whole interaction. Gated on being an actual SELLER (isVendorRole),
  // never on the schedule alone, or every employed NPC in the city would go mute
  // at night. Covert dealers are exempt (their window is the dealer plugin's).
  if (isVendorRole(npc) && isVendorOffHours(npc)) {
    const msg = vendorOffHoursLine(npc);
    if (broadcast) broadcast(player.current_zone, msg, player.id);
    return { type: 'output', message: msg };
  }
  // Render the root node through the SHARED renderer (engine/dialogue.js) — the
  // same path option-clicks take via handleDialogue — so `talk` and subsequent
  // navigation can never drift on option gating or the vendor shop injection.
  const rendered = npc.dialogue_tree?.root
    ? await renderDialogueNode(npc, 'root', player, { broadcast, npc })
    : null;
  // No dialogue tree (or no root node): the NPC is talkable but scripted only for
  // chitchat — say a random line to the room instead of opening a dialogue panel.
  if (!rendered) {
    const lines = getNpcChitchat(npc) || DEFAULT_CHITCHAT_LINES;
    const line = lines[Math.floor(Math.random() * lines.length)];
    const msg = formatChitchat(npc.name, line);
    if (broadcast) broadcast(player.current_zone, msg, player.id);
    return msg;
  }
  return { type:'dialogue', npcId:npc.id, npcName:npc.name, node:'root', text:rendered.text, options:rendered.options, stage:rendered.stage, mood:rendered.mood };
}

// If the player names an NPC in the room (any part of its name — first or last),
// that NPC pipes up with a random chit-chat line. Broadcast to the whole zone,
// including the speaker, so everyone sees the reaction.
function npcsNamedInSpeech(text, zoneId) {
  const lower = text.toLowerCase();
  return getZoneNpcs(zoneId).filter(npc => {
    const parts = String(npc.name || '').toLowerCase().split(/\s+/).filter(p => p.length >= 2);
    return parts.some(p => new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower));
  });
}

async function cmdSay(text, player, broadcast) {
  if (!text) return { type:'error', message:'Say what?' };
  if (text.length >= 3 && text === text.toUpperCase() && /[A-Z]/.test(text)) {
    return cmdYell(text, player, broadcast);
  }
  // Let a plugin mangle the *spoken* line (e.g. drunk slurring). The transform
  // only affects what's displayed — NPC-name detection below still keys off the
  // real text. Returns undefined (unchanged) when no plugin claims it.
  const spoken = (await fireHook('speech.transform', { player, text })) ?? text;
  // Echo the speaker's own line first, then let the room hear it — so any NPC
  // reaction below lands *after* the player's say line, never before it.
  // `says,` not `says:` — a comma reads as prose, a colon reads as a chat log.
  broadcast(null, { type:'say', message:`You say, "${spoken}"` }, null, player.id);
  broadcast(player.current_zone, { type:'say', message:`${player.handle} says, "${spoken}"` }, player.id);
  // Let plugins react to speech (e.g. the shadow dealer's passphrase). Fire-and-forget.
  fireHook('player.say', { player, text, zoneId: player.current_zone, broadcast }).catch(() => {});
  // Audible speech is noise — systems keying off sound (e.g. the burglary alarm)
  // listen here rather than re-deriving it from the say path.
  emit('player.spoke', { player, zoneId: player.current_zone, loud: false });
  for (const npc of npcsNamedInSpeech(text, player.current_zone)) {
    const lines = getNpcChitchat(npc) || DEFAULT_CHITCHAT_LINES;
    broadcast(player.current_zone, formatChitchat(npc.name, lines[Math.floor(Math.random() * lines.length)]));
  }
  return null;
}

function cmdYell(text, player, broadcast) {
  if (!text.trim()) return { type:'error', message:'Yell what?' };
  propagateYell(player.current_zone, player.id, player.handle, text.trim(), broadcast);
  emit('player.spoke', { player, zoneId: player.current_zone, loud: true });
  return { type:'output', message:`<span class="speech-line">You yell, "${text.trim().toUpperCase()}"</span>` };
}

// IRC-style freeform emote: `me leans on the bar`, `/me` and `.me` too (the
// dispatcher strips a leading slash/dot). It goes out as its own `emote_custom`
// type rather than `emote` for exactly one reason — so the client can tint it
// apart from the emotes the engine writes for you. Nothing else about it differs.
//
// Any quotes the player puts in the line are coloured as dialogue client-side,
// which is the whole point of painting speech at render time: `me mutters
// "not again"` is speech AND an action, and shouldn't have to pick one.
function cmdMe(text, player, broadcast) {
  const line = String(text || '').trim();
  if (!line) return { type:'error', message:'Usage: me <what you do>  —  e.g. me leans on the bar and waits.' };
  // Leading punctuation ("me's hands shake") joins the handle directly; anything
  // else gets the space it obviously wants.
  const body = /^['’,.!?]/.test(line) ? line : ` ${line}`;
  const message = `${player.handle}${body}`;
  broadcast(player.current_zone, { type:'emote_custom', message }, player.id);
  emit('player.emoted', { player, zoneId: player.current_zone, text: line });
  return { type:'emote_custom', message };
}

function cmdWhisper(args, raw, player, broadcast) {
  if (!args.length) return { type:'error', message:'Usage: whisper <player|#channel> <message>' };
  const afterCmd = raw.replace(/^\S+\s+/, '');
  const targetWord = args[0];

  // Channel whisper: target starts with #
  if (targetWord.startsWith('#')) {
    const channelId = targetWord.toLowerCase();
    const msgText = afterCmd.slice(targetWord.length).trim();
    if (!msgText) return { type:'error', message:`Usage: whisper ${channelId} <message>`, whisperFailed: afterCmd };
    if (!canAccessChannel(channelId, player)) return { type:'error', message:`No such channel: ${channelId}`, whisperFailed: afterCmd };
    sendToChatChannel(channelId, { type:'channel_msg', channel: channelId, from: player.handle, message: msgText }, broadcast);
    return null;
  }

  // Player whisper
  const livePlayers = getAllLivePlayers().filter(p => p.id !== player.id);
  const sorted = livePlayers.slice().sort((a,b) => b.handle.length - a.handle.length);
  const target = sorted.find(p => afterCmd.toLowerCase().startsWith(p.handle.toLowerCase()));
  if (!target) return { type:'error', message:`No online player matches "${afterCmd.split(' ')[0]}…".`, whisperFailed: afterCmd };
  const msgText = afterCmd.slice(target.handle.length).trim();
  if (!msgText) return { type:'error', message:'Usage: whisper <player> <message>', whisperFailed: afterCmd };
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
  talk:    (args, raw, player, broadcast) => cmdTalk(args.join(' '), player, broadcast),
  say:     (args, raw, player, broadcast) => cmdSay(raw.replace(/^say\s*/i,''), player, broadcast),
  yell:    (args, raw, player, broadcast) => cmdYell(raw.replace(/^yell\s*/i,''), player, broadcast),
  me:      (args, raw, player, broadcast) => cmdMe(raw.replace(/^me\s*/i,''), player, broadcast),
  emote:   (args, raw, player, broadcast) => cmdMe(raw.replace(/^emote\s*/i,''), player, broadcast),
  whisper: (args, raw, player, broadcast) => cmdWhisper(args, raw, player, broadcast),
  who:     () => cmdWho(),
  obama:   (args, raw, player, broadcast) => cmdObama(args.join(' '), player, broadcast),
  pet:     (args, raw, player, broadcast) => cmdPet(args.join(' '), player, broadcast),
};
