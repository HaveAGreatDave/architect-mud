// Somebody frightened, and the police called.
//
// Two things set it off: a stranger who was told to get out of somebody's home and didn't (intrusion.js
// hands over when its grace runs out), and somebody seen working a keypad on a door that isn't theirs
// (`lock.hackAttempt`, fired by the engine's hackDoor for whoever's on the hacker's side of the door; the
// residents on the far side are the burglary plugin's). The NPC startles, gets their phone out and calls
// it in, and the call is surveillance's POLICE_CALL: a star, a patrol on its way, and half a star more for
// every thirty seconds you're still standing there. While you are, they keep reacting: on the phone,
// hands up, backing off, looking for a way out, begging you to go. When you leave they calm down.
//
// ⚠ THE WORDS DRIVE THE BODY. Each line is written so client/shared/npc-acts.js reads an act off it ("calls
// the police", "puts their hands up", "backs off", "screams"), which is how anybody in a room with the
// Stage open is seen doing it. A resident the Room Stage is walking round their flat also gets `npc.panic`,
// so plugins/roomstage npc-life.js stops them, turns them to you and holds the clip between lines.
//
// ⚠ AN ADMIN IS RECOGNISED, NOT REPORTED. The first time an NPC sees an admin or dev somewhere they
// shouldn't be, they get the fright like anybody would, then a proper look: "Oh. It's just you." and
// back to what they were doing. After that, for RECOGNISE_MS, that NPC doesn't react to them at all.
//
// RAM only: who's panicking and who has recognised whom. Nothing here writes.
import { on, emit } from '../../server/engine/events.js';
import { world, getZoneNpcs, getLivePlayer, getZone } from '../../server/engine/world.js';
import { sendToZone } from '../../server/engine/messaging.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { isNpcAsleep } from '../../server/engine/ai-behaviour.js';
import { randInt } from '../../server/engine/util.js';
import { wayOutOf } from './eviction.js';

const PULSE_MS = [7_000, 11_000];       // between one reaction and the next while you're still there
const CALL_AFTER_MS = [2_500, 4_500];   // from the fright to the phone
const MAX_MS = 4 * 60_000;              // nobody stays at full panic longer than this; the call stands
const RECOGNISE_MS = 2 * 3600_000;      // how long an NPC remembers it was only the admin
const HACK_COOLDOWN_MS = 90_000;        // a hacker who jacks in twice on one landing is one scene, not two

const isAdmin = (p) => ['admin', 'dev'].includes(p?.role);
const rand = (a) => a[Math.floor(Math.random() * a.length)];
const say = (zoneId, npc, line) => sendToZone(zoneId, { type: 'zone_event', message: `${npc.name} ${line}` });

// Lines are emotes after the name. Each names what the body does, for npc-acts.js.
const OPEN_HACK = [
  'startles and stares at you. "Hey. That isn\'t your door."',
  'backs up a step. "What are you doing to that lock?"',
  'stops dead and backs off, looking from you to the door. "No. No, you don\'t."',
];
const CALL_HACK = [
  'gets their phone out and calls the police, eyes on you the whole time.',
  'backs off and dials the police. "Somebody\'s breaking into a flat. They\'re right in front of me."',
  'calls the police and reads out the number on the door.',
];
const CALL_HOME = [
  'snatches up their phone and calls the police. "There\'s a stranger in my flat and they won\'t leave."',
  'backs into the corner and calls the police, voice shaking.',
  'calls the police. "I told them to go. They\'re still here."',
];
// While you're still there: on the phone, hands up, backing off, looking for a way out, begging, screaming.
const PULSE = [
  'into the phone: "They\'re still here. Please hurry."',
  'puts their hands up. "Take whatever you want. Just go."',
  'backs off another step, keeping you in sight.',
  'looks wildly round for a way out.',
  'begs you to leave. "Please. I\'ve got nothing."',
  'screams for help.',
  'into the phone, quieter: "No, they haven\'t gone. They\'re just standing there."',
];
const CALM = [
  'sags against the wall, still shaking.',
  'lets out a shaky breath and tells the dispatcher you\'ve gone.',
  'stands with a hand pressed to their chest, listening for you.',
];
// An admin: the fright, then the look.
const ADMIN_START = ['startles badly and backs off a step.', 'jumps a mile and puts their hands up.', 'comes up off their feet with a yelp.'];
const ADMIN_KNOWN = [
  'gets a proper look at you and lets their hands drop. "Oh. It\'s just you."',
  'puts a hand on their chest. "Oh, it\'s you. Don\'t do that." They go back to what they were doing.',
  'recognises you and laughs at themselves. "Sorry. Thought you were somebody else."',
];

const panics = new Map();       // npcId -> { playerId, zoneId, timers, until }
const recognised = new Map();   // `${npcId}:${playerId}` -> when
const lastHackScene = new Map(); // `${playerId}:${zoneId}` -> when

// Who in a room could panic at you: awake, not fighting, not a cop (surveillance's cop branch makes you
// there), not an animal, not already frightened, and not somebody who'd never ring the law.
export function bystanders(zoneId) {
  return getZoneNpcs(zoneId).filter((n) => n && !n._dead && !n._combatTargetId && !n.flags?.animal && !n.flags?.police
    && !n.flags?.wont_call_police && !n._ai?.alarm && !isNpcAsleep(n) && !panics.has(n.id));
}

const clipFor = (line) => (/into the phone|calls the police|dials the police/.test(line) ? 'panicPhone'
  : /hands up/.test(line) ? 'handsUp' : /backs? (off|up|into)/.test(line) ? 'backAway' : /way out/.test(line) ? 'panicLook'
  : /begs/.test(line) ? 'plead' : /screams/.test(line) ? 'scream' : /startles|jumps|comes up off/.test(line) ? 'startle' : null);
// The body for the Room Stage (npc-life.js `panic`): a clip, and who to look at. Null ends it.
function body(npc, clip, playerId) { emit('npc.panic', { npc, clip, toward: playerId || null }); }

function end(npcId, calm) {
  const p = panics.get(npcId);
  if (!p) return;
  for (const t of p.timers) clearTimeout(t);
  panics.delete(npcId);
  const npc = world.npcs.get(npcId);
  if (!npc) return;
  if (calm && !npc._dead && npc.zone_id === p.zoneId) {
    const line = rand(CALM);
    say(p.zoneId, npc, line);
    body(npc, 'shaken', null);
    const t = setTimeout(() => body(npc, null, null), randInt(10_000, 16_000));
    t.unref?.();
  } else body(npc, null, null);
}

// Still a threat: the player's live and in the same room as the NPC, and the NPC's still there and up.
function threat(p, npc) {
  const pl = getLivePlayer(p.playerId);
  return !!pl && pl.current_zone === p.zoneId && !!npc && !npc._dead && npc.zone_id === p.zoneId && !npc._combatTargetId && !isNpcAsleep(npc);
}

function pulse(npcId) {
  const p = panics.get(npcId), npc = world.npcs.get(npcId);
  if (!p) return;
  if (!threat(p, npc)) { end(npcId, !!npc && !npc._dead && !npc._combatTargetId); return; }
  if (Date.now() > p.until) { end(npcId, true); return; }
  const line = rand(PULSE.filter((l) => l !== p.last));
  p.last = line;
  say(p.zoneId, npc, line);
  body(npc, clipFor(line), p.playerId);
  p.timers.push(setTimeout(() => pulse(npcId), randInt(...PULSE_MS)));
}

/**
 * Frighten `npc` with `player` in `zoneId`, and have them call it in.
 * `kind` 'home' (a stranger who wouldn't leave) or 'hack' (somebody working a lock); `opened` true when a line
 * has already been said (intrusion.js's challenge), so this goes straight to the phone.
 */
export function startPanic(npc, player, zoneId, { kind = 'home', opened = false } = {}) {
  if (!npc || !player?.id || panics.has(npc.id)) return false;
  const key = `${npc.id}:${player.id}`, now = Date.now();
  if (isAdmin(player)) {
    // known already: nothing happened
    if (now - (recognised.get(key) || 0) < RECOGNISE_MS) return false;
    recognised.set(key, now);
    const p = { playerId: player.id, zoneId, timers: [], until: now + 10_000 };
    panics.set(npc.id, p);
    say(zoneId, npc, rand(ADMIN_START));
    body(npc, 'startle', player.id);
    p.timers.push(setTimeout(() => {
      const n = world.npcs.get(npc.id);
      if (n && !n._dead && n.zone_id === zoneId) say(zoneId, n, rand(ADMIN_KNOWN));
      panics.delete(npc.id);
      body(n || npc, null, null);
    }, randInt(2_200, 3_500)));
    return true;
  }
  const p = { playerId: player.id, zoneId, timers: [], until: now + MAX_MS };
  panics.set(npc.id, p);
  if (!opened) {
    say(zoneId, npc, rand(kind === 'hack' ? OPEN_HACK : ['startles badly. "Who are you? Get out!"']));
    body(npc, 'startle', player.id);
  }
  p.timers.push(setTimeout(async () => {
    const n = world.npcs.get(npc.id);
    if (panics.get(npc.id) !== p) return;
    if (!threat(p, n)) { end(npc.id, !!n && !n._dead); return; }
    const line = rand(kind === 'hack' ? CALL_HACK : CALL_HOME);
    say(zoneId, n, line);
    body(n, 'panicPhone', player.id);
    const pl = getLivePlayer(player.id);
    if (pl) {
      try {
        await dispatchAction({ type: 'POLICE_CALL', actor: pl, params: { zoneId, caller: n.name, muster: wayOutOf(zoneId), reason: kind === 'hack' ? 'somebody breaking into a flat' : 'an intruder who won\'t leave' } });
      } catch (e) { console.error('[ambient-life] police call:', e.message); }
    }
    p.timers.push(setTimeout(() => pulse(npc.id), randInt(...PULSE_MS)));
  }, opened ? randInt(800, 1_600) : randInt(...CALL_AFTER_MS)));
  return true;
}

export const isPanicking = (npcId) => panics.has(npcId);
// Seen once and recognised: an admin this NPC already knows is here (intrusion.js asks before it says anything).
export const knowsAdmin = (npc, player) => isAdmin(player) && Date.now() - (recognised.get(`${npc.id}:${player.id}`) || 0) < RECOGNISE_MS;

// Somebody working a keypad on this side of a door: whoever's standing there sees it. One of them reacts
// (two on a busy landing), and the rest leave it to them.
on('lock.hackAttempt', ({ player, zoneId }) => {
  try {
    if (!player?.id || !zoneId || getZone(zoneId)?.flags?.lawless) return;
    const k = `${player.id}:${zoneId}`, now = Date.now();
    if (now - (lastHackScene.get(k) || 0) < HACK_COOLDOWN_MS) return;
    const folk = bystanders(zoneId).sort(() => Math.random() - 0.5).slice(0, 2);
    if (!folk.length) return;
    lastHackScene.set(k, now);
    folk.forEach((n, i) => {
      const t = setTimeout(() => startPanic(n, getLivePlayer(player.id) || player, zoneId, { kind: 'hack' }), i * randInt(1_200, 2_500));
      t.unref?.();
    });
  } catch (e) { console.error('[ambient-life] hack witness:', e.message); }
});
// Attacked or killed mid-call: that's the fight's, not this.
on('npc.attacked', ({ npc }) => { if (npc && panics.has(npc.id)) end(npc.id, false); });
on('npc.killed', ({ npc }) => { if (npc && panics.has(npc.id)) end(npc.id, false); });
on('player.logout', ({ id }) => { for (const [nid, p] of panics) if (p.playerId === id) end(nid, true); });

// Test seam.
export const _panic = { panics, recognised, lastHackScene, clipFor, PULSE, CALL_HOME, CALL_HACK, OPEN_HACK, ADMIN_START, ADMIN_KNOWN, CALM, RECOGNISE_MS };
