// HIJACK — the one door into the cab.
//
// `enemyAttackPlayer` refuses to swing at a driver (see its ⚠ in server/engine/combat.js), so a
// truck is a box nothing reaches into. That is the right default — a rig at sixty is not something
// you mug — but a box with no door is a place to hide, and a driver who stops for the night in the
// middle of the waste should not be safer than one asleep in a rented room.
//
// So there is exactly one way in, and it works the same whether the hand on the door handle belongs
// to a player or to something that came out of the haze:
//
//   1. It only exists when the truck is STOPPED. Nothing here can touch a rolling truck, which
//      makes driving on the answer to every threat in this file and makes the throttle a defensive
//      control. That is deliberate: the interesting decision is whether to stop, not whether to win
//      a roll after you did.
//   2. It is a CONTEST, not a takeover. A success drags the driver out and starts a fight; it never
//      awards the truck. Whoever is standing afterwards is the one who can drive it away, and that
//      is decided by the combat system that already exists rather than by anything written here.
//   3. It usually fails. A cab door is steel and a driver is holding it shut, so an attempt is a
//      long shot on purpose — the enemy version rolls once every few seconds and expects to lose
//      most of them, which is what gives a woken driver time to find a gear and go. A door that
//      opened first time would make stopping unsurvivable rather than risky.
//
// ⚠ THE VERB IS NOT REGISTERED HERE, and it cannot be: `hijack` already belongs to the surveillance
// plugin (breaching a camera), plugin verbs are first-come, and a second registration would simply
// never run. Instead surveillance's own handler, when the name you typed is not a device it can
// find, gathers `hijack.target` and hands the attempt to whoever claims it. So one verb keeps
// meaning "break into the thing you named" for both systems, nobody learns a second word for it,
// and neither plugin imports the other.

import { getZone, getLivePlayer } from '../../server/engine/world.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { emit } from '../../server/engine/events.js';
import { rigs, rigOf, dismountRig } from './state.js';
import { effectiveSkill } from '../../server/engine/skills.js';

// A truck is STOPPED below this. Not zero: a rig rolling at a walking pace in a yard is a rig
// somebody can walk alongside and get a hand to, and a hard zero would mean an idling truck rocking
// a tenth of a mile an hour was untouchable on a technicality.
export const STOPPED_MPH = 4;
// How often a hijacker tries the door, and how often it works. Read the header before tuning:
// these two numbers together are the window a driver has to wake up and drive off, and the design
// wants that window to be REAL — at these values a door holds for about half a minute on average.
export let ATTEMPT_MS = 4200;
export let BREAK_CHANCE = 0.16;
// The flag that makes an enemy one of these. Anything without it never touches a cab, which is why
// the waste's ordinary vermin still cannot reach a driver — they have no idea what a door is.
export const HIJACKER_FLAG = 'hijacker';

// What it sounds like from inside, in the order it escalates. A failed attempt has to be LOUD:
// the whole point of a low break chance is the warning it buys, and a silent failed attempt is not
// a warning, it is a coin flip you were not told about.
const KNOCKS = [
  'Something hits the door hard enough to move the whole cab on its mounts.',
  'A hand slaps flat against the driver\'s glass, then drags away.',
  'The door handle jerks against the lock. Once. Twice.',
  'Metal shrieks somewhere behind you — a bar, going into the door seam.',
  'The cab rocks. Whatever is out there has got both hands on it now.',
];
const line = (a) => a[Math.floor(Math.random() * a.length)];

// Is this player currently reachable through the door? The one predicate, so the enemy tick and the
// player verb can never disagree about what "stopped" means.
export function cabIsOpenTo(player) {
  const rig = rigOf(player);
  if (!rig) return null;
  return Math.abs(rig.speed || 0) <= STOPPED_MPH ? rig : null;
}

// THE DRAG-OUT. Everything above is about whether this happens; this is what happening means, and
// it is deliberately short — because it ends by handing the situation to systems that already
// exist. The driver is dismounted (which drops `_inCab`, which reopens them to every ordinary
// attack in the game), the room is told, and the attacker is aimed at them.
//
// The truck is left exactly where it is, still owned by whoever owned it. It is not a prize this
// function awards: it is a vehicle standing in the road with its door open, and the fight decides
// who walks back to it.
export function dragOut(victim, attacker, { attackerName }) {
  const rig = rigOf(victim);
  if (!rig) return false;
  dismountRig(victim.id);
  victim._hijackedAt = Date.now();
  sendToPlayer(victim.id, { type: 'combat', message:
    `<span class="msg-combat">The door goes. A hand gets your collar before you get a gear, and the road comes up to meet you.</span>`,
    refresh: true });
  sendToZone(victim.current_zone, { type: 'zone_event', refresh: true,
    message: `${attackerName} hauls <b>${victim.handle}</b> out of the cab and puts them in the dirt.` }, victim.id);
  // An enemy gets its target set here rather than waiting for the aggro pass, because the whole act
  // was a decision to attack this specific person and re-rolling for a target would throw that away.
  if (attacker && attacker.instanceId) { attacker.targetId = victim.id; attacker.aggroedAt = Date.now(); }
  emit('truck.hijacked', { victim, attacker, rig });
  return true;
}

// ── The enemy half ───────────────────────────────────────────────────────────
// One tick over the rigs that exist, which is a handful at the very most — never over enemies or
// zones, because the set of people sitting in a truck is always the smaller list and it is already
// in RAM. Idle-gated for free: no rigs, no work.
let lastTick = new Map();   // playerId -> ts of the last attempt against them

export function tickHijackers(now = Date.now()) {
  if (!rigs.size) return 0;
  let dragged = 0;
  for (const [playerId, rig] of rigs) {
    if (Math.abs(rig.speed || 0) > STOPPED_MPH) { lastTick.delete(playerId); continue; }
    if (now - (lastTick.get(playerId) || 0) < ATTEMPT_MS) continue;
    const player = getLivePlayer(playerId);
    if (!player) { lastTick.delete(playerId); continue; }
    const zone = getZone(player.current_zone);
    if (!zone?.enemies?.size) continue;
    // The first hijacker in the room does the work. A second pair of hands on the same door would
    // double the break chance without doubling anything the driver can see, and a door either opens
    // or it does not.
    let foe = null;
    for (const e of zone.enemies.values()) {
      if (e?.flags?.[HIJACKER_FLAG] && !e.isDead) { foe = e; break; }
    }
    if (!foe) continue;
    lastTick.set(playerId, now);
    if (Math.random() < BREAK_CHANCE) {
      lastTick.delete(playerId);
      if (dragOut(player, foe, { attackerName: `<b>${foe.name}</b>` })) dragged++;
    } else {
      sendToPlayer(playerId, { type: 'output', message: `<span class="msg-danger">${line(KNOCKS)}</span>` });
    }
  }
  return dragged;
}

// ── The player half ──────────────────────────────────────────────────────────
// Reached through surveillance's `hijack` verb (see the header). Returns null when the name does
// not resolve to a driver here, which is what lets the verb fall back to its own error message
// rather than this plugin inventing a worse one.
export async function playerHijack(player, nameHint) {
  const zone = getZone(player.current_zone);
  if (!zone?.players?.size) return null;
  const want = String(nameHint || '').toLowerCase();
  let victim = null;
  for (const id of zone.players) {
    if (id === player.id) continue;
    const p = getLivePlayer(id);
    if (!p || !rigOf(p)) continue;
    // Matched on the handle OR on the word for the thing they are sitting in, because "hijack the
    // rig" is what somebody looking at a truck would type and the driver's name may not be visible
    // from outside a cab at all.
    if (!want || p.handle?.toLowerCase().includes(want) || 'truck rig cab'.includes(want)) { victim = p; break; }
  }
  if (!victim) return null;
  if (player._inCab) return { type: 'error', message: 'Not from in here. You would have to get out first.' };
  if (!cabIsOpenTo(victim)) {
    return { type: 'error', message: `${victim.handle}'s rig is still rolling. You are not getting a hand to a moving truck.` };
  }
  // A contest, and the driver's side of it is real: they are braced against the door with the
  // advantage of being the one holding it. Brawn against Brawn, with the defender favoured — the
  // attacker is expected to need more than one go at this, exactly as an enemy is.
  const mine = await effectiveSkill(player, 'melee');
  const theirs = await effectiveSkill(victim, 'melee');
  const margin = (mine - theirs) + (Math.random() * 20 - 10) - 4;
  sendToPlayer(victim.id, { type: 'output', message: `<span class="msg-danger">${line(KNOCKS)}</span>` });
  if (margin <= 0) {
    sendToZone(player.current_zone, { type: 'zone_event',
      message: `<b>${player.handle}</b> wrenches at the cab door and it holds.`, refresh: false }, player.id);
    return { type: 'success', message: 'You get a hand to the door and it does not give. They know you are out here now.' };
  }
  dragOut(victim, null, { attackerName: `<b>${player.handle}</b>` });
  return { type: 'success', message: `You get the door open and haul ${victim.handle} out onto the road.` };
}

// Regress reach-in: the two dice this file rolls, so a suite can test the CONSEQUENCE without
// testing the RNG. Never called in production.
export function _setOdds({ breakChance, attemptMs } = {}) {
  if (breakChance != null) BREAK_CHANCE = breakChance;
  if (attemptMs != null) ATTEMPT_MS = attemptMs;
}
