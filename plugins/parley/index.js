// parley: talk to people in your own words, Façade-style.
//
// Say a line with somebody's name in it, or say anything while you're already talking
// to them, and parse.js reads what you meant (a greeting, an insult, a question about
// the hotel) and react.js picks their answer: their own `flags.parley` lines first,
// then the generic ones for their personality (generic.js). In the dialogue panel
// (every display mode that has one, the Room Stage included) a box under the options
// sends the same thing as `parley <npcId> <text>`; the answer comes back into the
// panel as a `parley_line` and is voiced there. Everyone else in the room hears it as
// an ordinary say line, which ORACLE voices through npc-bubbles.
//
// Somebody with no parley data of their own answers only a line that was clearly
// read; anything else falls through to the engine's stock chitchat, as before.
//
// No queries, no ticks. Who you're talking to is RAM only (`partners`).

import { getZoneNpcs } from '../../server/engine/world.js';
import { fireHook } from '../../server/engine/plugins.js';
import { emit } from '../../server/engine/events.js';
import { escapeHtml } from '../../server/engine/html.js';
import { npcMoodOf } from '../../server/engine/npc-mood.js';
import { isAnimal } from '../../server/engine/commands/social.js';
import { parse } from './parse.js';
import { react, PARLEY_MS } from './react.js';
import { converse, named } from './company.js';

const partners = new Map();   // playerId → { npcId, zone, at }

const canTalk = (npc) => !!npc && !isAnimal(npc) && npc.flags?.parley !== false;
const authored = (npc) => !!npc?.flags?.parley;
const nameParts = (npc) => String(npc.name || '').split(/\s+/).filter((p) => p.length >= 2);

// Who an unnamed `say` is aimed at: the person you're talking to, if they're still here.
export function partnerOf(player) {
  const p = partners.get(player.id);
  if (!p || p.zone !== player.current_zone || Date.now() - p.at > PARLEY_MS) return null;
  return getZoneNpcs(player.current_zone).find((n) => n.id === p.npcId && canTalk(n)) || null;
}

function remember(player, npc, ended) {
  if (ended) partners.delete(player.id);
  else partners.set(player.id, { npcId: npc.id, zone: player.current_zone, at: Date.now() });
}

// The answer to a line, and its effects on the NPC; null when they'd rather not
// answer (no data of their own and a line nobody could read). `direct` is the
// dialogue box: spoken to their face, they always answer something.
export function answer(npc, player, text, { direct = false } = {}) {
  if (!canTalk(npc)) return null;
  const parsed = parse(text, { topics: npc.flags?.parley?.topics, names: nameParts(npc) });
  if (!direct && !authored(npc) && !parsed.confidence) return null;
  const out = react(npc, player, parsed);
  if (out) remember(player, npc, out.ended);
  return out && { ...out, parsed };
}

// Out loud to the room, as the engine's own chitchat is: an emote line, then speech.
function toRoom(npc, line, zoneId, broadcast, exceptId) {
  if (line.act) broadcast(zoneId, { type: 'zone_event', message: `${npc.name} ${line.act}` }, exceptId);
  if (line.say) broadcast(zoneId, { type: 'output', message: `<span class="speech-line">${npc.name} says, "${escapeHtml(line.say)}"</span>` }, exceptId);
}

// One line in company (company.js): the person it's to answers, then anybody else
// who has something to say, a beat apart so the voices queue rather than cut in.
const EXTRA_GAP_MS = 1100;
const TURN_GAP_MS = 2600;   // a back-and-forth between two of them reads slower
function talkInCompany(player, npc, text, broadcast, { direct = false } = {}) {
  const room = getZoneNpcs(player.current_zone);
  const res = converse({ player, npc, text, room, direct, canTalk, authored });
  if (!res) return null;
  if (res.partner) remember(player, res.partner, false); else partners.delete(player.id);
  const zone = player.current_zone;
  let at = 0;
  res.extra.forEach((x) => { at += String(x.key || '').startsWith('sports:') ? TURN_GAP_MS : EXTRA_GAP_MS; setTimeout(() => toRoom(x.npc, x.line, zone, broadcast, null), at); });
  return res;
}

// `cmdSay` asks once per NPC named in a line; the whole line is worked out on the
// first ask and the rest are told whether it was theirs.
const lastLine = new Map();   // playerId → { text, at, handled }

// Who a `say` naming people is to: the person you're already talking to if they're
// here, else the first named who has lines of their own, else the first named.
function addresseeOf(player, text, room) {
  const p = partnerOf(player);
  if (p) return p;
  const namedHere = room.filter((n) => canTalk(n) && named(text, n));
  return namedHere.find(authored) || namedHere[0] || null;
}

// `npc.heard` (sync, from cmdSay): somebody was named in a `say`. True claims the line.
function onHeard({ player, npc, text, broadcast }) {
  const seen = lastLine.get(player.id);
  if (seen && seen.text === text && Date.now() - seen.at < 2000) return seen.handled.has(npc.id) || undefined;
  const room = getZoneNpcs(player.current_zone);
  const to = addresseeOf(player, text, room) || npc;
  const res = broadcast ? talkInCompany(player, to, text, broadcast) : null;
  const handled = res ? res.handled : new Set();
  if (res) toRoom(to, res.out.line, player.current_zone, broadcast, null);
  lastLine.set(player.id, { text, at: Date.now(), handled });
  return handled.has(npc.id) || undefined;
}

// `player.say`: a line with nobody's name in it goes to whoever you're talking to.
function onSay({ player, text, zoneId, broadcast, parleyHandled }) {
  if (parleyHandled || !broadcast) return;
  if (getZoneNpcs(zoneId).some((n) => canTalk(n) && named(text, n))) return;   // npc.heard has it
  const npc = partnerOf(player);
  if (!npc) return;
  const res = talkInCompany(player, npc, text, broadcast);
  if (res) toRoom(npc, res.out.line, zoneId, broadcast, null);
}

// Opening a conversation makes them the one your next lines go to. Never claims it:
// the dialogue tree still opens.
function onTalk({ player, npc }) {
  if (canTalk(npc)) remember(player, npc, false);
  return undefined;
}

// `parley <npcId> <text>`: the dialogue panel's text box.
async function cmdParley(args, _raw, player, broadcast) {
  const [npcId, ...rest] = args || [];
  const text = rest.join(' ').trim();
  if (!text) return { type: 'error', message: 'Say what?' };
  const npc = getZoneNpcs(player.current_zone).find((n) => n.id === npcId);
  if (!npc) return { type: 'error', message: "They aren't here any more." };
  if (!canTalk(npc)) return { type: 'error', message: `${npc.name} isn't one for conversation.` };
  const spoken = (await fireHook('speech.transform', { player, text })) ?? text;
  broadcast(null, { type: 'say', message: `You say, "${spoken}"` }, null, player.id);
  broadcast(player.current_zone, { type: 'say', message: `${player.handle} says, "${spoken}"` }, player.id);
  // Other plugins still hear it (a dealer's passphrase works from the box too).
  fireHook('player.say', { player, text, zoneId: player.current_zone, broadcast, parleyHandled: true }).catch(() => {});
  emit('player.spoke', { player, zoneId: player.current_zone, loud: false });
  const { out } = talkInCompany(player, npc, text, broadcast, { direct: true });
  toRoom(npc, out.line, player.current_zone, broadcast, player.id);
  return {
    type: 'parley_line', npcId: npc.id, npcName: npc.name, npcSex: npc.sex || null,
    say: out.line.say, stage: out.line.act ? `${npc.name} ${out.line.act}` : '',
    mood: npcMoodOf(npc)?.m || null, ended: out.ended,
  };
}

export const commands = { parley: cmdParley };
export const hooks = {
  'npc.heard': (p) => { try { return onHeard(p); } catch (e) { console.error('[parley] heard:', e.message); return undefined; } },
  'player.say': (p) => { try { onSay(p); } catch (e) { console.error('[parley] say:', e.message); } },
  'npc.talk': (p) => onTalk(p),
};
export const _test = { partners };
