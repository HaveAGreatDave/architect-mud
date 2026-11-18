// NPCs talking to the player standing near them.
//
// Everything else an NPC says goes to the room: banter, home talk, a chef narrating a meal. This is the one
// thing said TO you: a hello when you come in, if they know you; and now and then, while you're standing
// there, a comment on what they can see (you're bleeding, you stink, you're drunk, you look like the person
// the police are after) or the weather, the hour, or just "alright?". How well they know you (relations.js)
// decides the register: a stranger is guarded, a regular uses your first name, somebody who hates you tells
// you to keep walking.
//
// ⚠ IN MEMORY, ON THE TICK. Every fact read here is sync and in RAM (relations, hygiene, the visible drug,
// hp, the wanted map behind WANTED_STARS); nothing queries, nothing writes. It runs on the ambient-life 30 s
// tick, which is idle-gated, and only for zones with a player in them.
//
// ⚠ IT GIVES WAY. An NPC that's asleep, fighting, frightened, mid-banter or has just spoken says nothing, and
// a household with a stranger in it is intrusion.js's: nobody makes small talk with a burglar.
import { on } from '../../server/engine/events.js';
import { world, getZone, getZoneNpcs, getLivePlayer, getApartment } from '../../server/engine/world.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { isNpcAsleep } from '../../server/engine/ai-behaviour.js';
import { getRelation, relationTier } from '../../server/engine/relations.js';
import { hygieneOf } from '../../server/engine/hygiene.js';
import { visibleIntoxication } from '../../server/engine/drugs.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { getEnvironmentState } from '../../server/engine/environment.js';
import { isBanterBusy } from '../../server/engine/npc-banter.js';
import { isDwellingZone } from '../../server/engine/zone-tags.js';
import { playerControlsApt } from '../../server/engine/apartments.js';
import { randInt } from '../../server/engine/util.js';
import { isTalking } from './home-talk.js';
import { isPanicking } from './panic.js';
import { belongsHere } from './eviction.js';

const TICK_CHANCE = 0.3;                          // per player in a room with somebody to talk to, per 30 s tick
const PLAYER_GAP_MS = [2 * 60_000, 5 * 60_000];   // between one remark to a player and the next
const NPC_GAP_MS = 4 * 60_000;                    // one NPC doesn't keep talking to the same person
const HELLO_CHANCE = 0.5, HELLO_DELAY_MS = [2_000, 5_000], HELLO_GAP_MS = 20 * 60_000;
const QUIET_MS = 45_000;                          // an NPC who's said something lately leaves it

const rand = (a) => a[Math.floor(Math.random() * a.length)];
const nextFor = new Map();   // playerId -> when they can next be spoken to
const lastTo = new Map();    // `${npcId}:${playerId}` -> when that NPC last spoke to them
const helloAt = new Map();   // `${npcId}:${playerId}` -> when that NPC last said hello

// "say" is speech, "act" an emote; {name} is your first name, {you} is "you" to you and your handle to the room.
const S = (say) => ({ say }), E = (act) => ({ act });
const HELLO = {
  close: [S('{name}! Come here, how are you?'), S('There you are. I was just thinking about you.'), E('lights up when {you} comes in.')],
  familiar: [S('Hey, {name}.'), S('Oh good, it\'s you.'), S('Alright, {name}? Long time.'), E('lifts a hand to {you}.')],
  known: [S('You again.'), E('nods at {you}.'), S('Alright?')],
  wary: [E('watches {you} come in and doesn\'t say anything.'), S('Oh. It\'s you.')],
  hostile: [S('Not you.'), E('turns their back on {you}.')],
};
const ABOUT = {
  wanted: [S('Weren\'t you on the news?'), S('There\'s police out looking for somebody who looks a lot like you.'), E('looks at {you}, then at the door, and says nothing.')],
  hurt: [S('You\'re bleeding. You want to sit down?'), S('What happened to you?'), S('You should get that looked at.')],
  filthy: [S('No offence, but when did you last have a wash?'), E('wrinkles their nose at {you}.'), S('Is that smell you?')],
  drunk: [S('How much have you had?'), S('You alright? You look a bit far gone.'), E('steadies {you} by the elbow. "Easy."')],
  high: [S('Your pupils are massive. You know that?'), S('What are you on?')],
  wet: [S('Hey buddy, you\'re getting soaked!')],
  wet_in: [S('Still coming down out there?'), S('You\'re dripping on the floor.')],
  night: [S('You\'re up late.'), S('Can\'t sleep either?')],
  morning: [S('Morning.'), S('You\'re up early.')],
};
const CHAT = {
  close: [S('{name}, you have to hear this. Actually, later.'), S('Stay a bit. I\'ll put the kettle on.'), S('You eating properly, {name}?')],
  familiar: [S('How\'s things, {name}?'), S('Busy day?'), S('You heard the rent\'s going up again?'), S('Did you see the game?')],
  known: [S('Alright?'), S('Cold one today.'), S('You live round here?')],
  stranger: [E('looks {you} up and down.'), S('Can I help you?'), S('Alright?'), E('gives {you} a short nod.')],
  wary: [S('Something you want?'), E('keeps an eye on {you}.')],
  hostile: [S('Keep walking.'), S('I\'ve got nothing to say to you.')],
};

// Somebody who could say something: awake, not busy, not a cop, not an animal, not frightened, quiet a while.
export function talkers(zoneId) {
  const now = Date.now();
  return getZoneNpcs(zoneId).filter((n) => n && !n._dead && !n._combatTargetId && !n.flags?.animal && !n.flags?.no_remarks
    && !n._ai?.alarm && !isPanicking(n.id) && !isNpcAsleep(n) && now - (n._ai?.lastSay || 0) > QUIET_MS);
}

// What they'd say to this player now: the most pressing thing they can see, or else small talk. Null for
// nothing. `stars` is the player's wanted level (WANTED_STARS). Pure apart from the dice.
export function remarkFor(npc, player, { stars = 0, hello = false, env = {} } = {}) {
  const tier = relationTier(getRelation(player, npc.id));
  if (hello) return HELLO[tier] ? rand(HELLO[tier]) : null;
  const facts = [];
  if (tier !== 'hostile') {
    if (stars >= 1) facts.push('wanted');
    if (player.hp_max > 0 && player.hp / player.hp_max < 0.4) facts.push('hurt');
    const band = hygieneOf(player).band;
    if (band === 'filthy' || band === 'biohazard' || band === 'rank') facts.push('filthy');
    const v = visibleIntoxication(player);
    if (v) facts.push(/alcohol|booze/i.test(String(v.drugClass || '')) || /beer|ale|lager|wine|whisk|vodka|gin|rum|cider|spirit|moonshine/i.test(String(v.name || '')) ? 'drunk' : 'high');
    if (env.precip && env.precip !== 'none') facts.push(env.indoors ? 'wet_in' : 'wet');
    if (env.phase === 'night') facts.push('night');
    if (env.phase === 'morning' || env.phase === 'dawn') facts.push('morning');
  }
  // what they can see wins most of the time; the hour and the weather only now and then
  const seen = facts.filter((f) => !['night', 'morning', 'wet', 'wet_in'].includes(f));
  if (seen.length && Math.random() < 0.75) return rand(ABOUT[rand(seen)]);
  if (facts.length && Math.random() < 0.3) return rand(ABOUT[rand(facts)]);
  return rand(CHAT[tier] || CHAT.stranger);
}

// Said: to the player as "says to you", and to the room as "says to <handle>".
function deliver(npc, player, line, zoneId) {
  const first = String(player.handle || 'you').split(/\s+/)[0];
  const fill = (t, you) => t.replace(/\{name\}/g, first).replace(/\{you\}/g, you);
  if (line.say) {
    const words = fill(line.say, first);
    sendToPlayer(player.id, { type: 'output', message: `<span class="speech-line">${npc.name} says to you, "${words}"</span>` });
    sendToZone(zoneId, { type: 'output', message: `<span class="speech-line">${npc.name} says to ${player.handle}, "${words}"</span>` }, player.id);
  } else {
    sendToPlayer(player.id, { type: 'zone_event', message: `${npc.name} ${fill(line.act, 'you')}` });
    sendToZone(zoneId, { type: 'zone_event', message: `${npc.name} ${fill(line.act, player.handle)}` }, player.id);
  }
  if (npc._ai) npc._ai.lastSay = Date.now();
  lastTo.set(`${npc.id}:${player.id}`, Date.now());
  nextFor.set(player.id, Date.now() + randInt(...PLAYER_GAP_MS));
}

// A stranger in somebody's home is intrusion.js's; nobody chats to them.
function intruding(player, zoneId, npc) {
  const z = getZone(zoneId);
  if (!isDwellingZone(z)) return false;
  const apt = getApartment(zoneId);
  if (apt && playerControlsApt(player, apt)) return false;
  return !belongsHere(player, npc, zoneId);
}
const roomBusy = (zoneId) => isTalking(zoneId) || isBanterBusy(zoneId);

export async function remarksTick() {
  const now = Date.now();
  let env = null;
  for (const player of world.players.values()) {
    const zoneId = player.current_zone;
    if (!zoneId || player.hp <= 0 || player.posture === 'sleeping' || player.combatTargetId) continue;
    if ((nextFor.get(player.id) || 0) > now || Math.random() > TICK_CHANCE || roomBusy(zoneId)) continue;
    const folk = talkers(zoneId).filter((n) => now - (lastTo.get(`${n.id}:${player.id}`) || 0) > NPC_GAP_MS && !intruding(player, zoneId, n));
    if (!folk.length) continue;
    const npc = rand(folk);
    if (!env) { const e = getEnvironmentState(); env = { phase: e.timePhase, precip: e.currentPrecip }; }
    let stars = 0;
    try { stars = (await dispatchAction({ type: 'WANTED_STARS', actor: player }))?.stars || 0; } catch { /* no surveillance: no stars */ }
    const line = remarkFor(npc, player, { stars, env: { ...env, indoors: !!getZone(zoneId)?.flags?.indoors || isDwellingZone(getZone(zoneId)) } });
    if (line) deliver(npc, player, line, zoneId);
  }
}

// Coming in: somebody who knows you says hello, a moment after you're through the door.
on('zone.entered', ({ actor, zone }) => {
  try {
    if (!actor?.id || !zone || actor.role === 'npc') return;
    const now = Date.now();
    const folk = talkers(zone).filter((n) => {
      const tier = relationTier(getRelation(actor, n.id));
      return tier !== 'stranger' && now - (helloAt.get(`${n.id}:${actor.id}`) || 0) > HELLO_GAP_MS && !intruding(actor, zone, n);
    });
    if (!folk.length || Math.random() > HELLO_CHANCE) return;
    const npc = rand(folk);
    helloAt.set(`${npc.id}:${actor.id}`, now);
    const t = setTimeout(() => {
      const p = getLivePlayer(actor.id), n = world.npcs.get(npc.id);
      if (!p || p.current_zone !== zone || !n || n.zone_id !== zone || isNpcAsleep(n) || isPanicking(n.id) || roomBusy(zone)) return;
      const line = remarkFor(n, p, { hello: true });
      if (line) deliver(n, p, line, zone);
    }, randInt(...HELLO_DELAY_MS));
    t.unref?.();
  } catch (e) { console.error('[ambient-life] hello:', e.message); }
});
on('player.logout', ({ id }) => { nextFor.delete(id); });

// Test seam.
export const _remarks = { HELLO, ABOUT, CHAT, remarkFor, talkers, nextFor, lastTo, helloAt };
