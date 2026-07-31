/**
 * Panic — an NPC that has seen something it cannot handle.
 *
 * TWO THINGS LIVE HERE, and they belong together:
 *
 *   1. THE DRIVER. `_ai.alarm` does NOT contain a panic sequence. All the engine
 *      AI tick does with it is `if (ai.alarm) return;` — it SUSPENDS the graph
 *      and waits for whoever set it to drive the NPC and clear it again
 *      (ai-behaviour.js). The burglary plugin has always done that for itself.
 *      Anything else that set the flag without a driver froze that NPC
 *      permanently, which is exactly what the sneak plugin was doing. So the
 *      driver is engine-owned now: set the flag through `panicNpc` or don't set
 *      it at all.
 *
 *   2. THE LAW. Violence in a room full of people is not ignored by the people.
 *      Before this, a fistfight in a crowded bar was watched by a room of NPCs
 *      who neither moved nor cared — the only violence anyone reacted to was a
 *      stealth knockout, which had it backwards.
 *
 * NO TIMERS PER NPC. Driven from the game loop's existing per-second walk, the
 * same choice tickUnconscious made and for the same reason: a timer per panicking
 * NPC has to survive death, logout, zone reload and a server restart, and a panic
 * is far too short-lived to be worth that bookkeeping.
 *
 * COSTS NOTHING WHEN NOBODY IS PANICKING. The tick returns on an empty Map, and
 * the witness sweep only runs on an attack event, never per swing (panicking is
 * idempotent, so the auto-attack loop re-triggering it is a no-op).
 *
 * See docs/systems-stealth.md.
 */
import { world, getZoneNpcs, getZone } from './world.js';
import { sendToZone } from './messaging.js';
import { setPosture } from './posture.js';
import { moveEntity } from './ai-behaviour.js';
import { neighborZoneIds } from './exits.js';
import { isOut } from './unconscious.js';
import { on, emit } from './events.js';
import { query } from '../models/db.js';

// How long somebody stays frightened. Long enough to clear the room and be
// genuinely gone from it, short enough that a street doesn't stay empty.
export const PANIC_MS = 20000;
// Fleeing every tick outruns anything on foot. Every other tick reads as running.
const FLEE_ODDS = 0.5;

const PANICS = new Map(); // npcId -> { npcId, until, reason, threatName, said }

const SHOUT = [
  n => `${n} screams for help.`,
  n => `${n} shouts, "Somebody call the cops! CALL THE COPS!"`,
  n => `${n} yells, "He's KILLING him — somebody DO something!"`,
  n => `${n} backs away fast, hands up, babbling.`,
  n => `${n} shrieks and shoves past anyone in the way.`,
];
const pick = (pool, n) => pool[Math.floor(Math.random() * pool.length)](n);

export function isPanicking(npc) {
  const id = npc?.id;
  return !!id && PANICS.has(id);
}

/**
 * Frighten an NPC into fleeing.
 *
 * Idempotent — an NPC already panicking is left alone rather than restarted, so
 * a per-swing event source (`npc.attacked` fires on every blow) costs nothing
 * and the first thing they saw stays the thing they are running from.
 *
 * Returns true if this call started the panic.
 */
export function panicNpc(npc, { reason = 'violence', threat = null, ms = PANIC_MS } = {}) {
  if (!npc?.id || PANICS.has(npc.id)) return false;
  if (npc.hp != null && npc.hp <= 0) return false;
  if (isOut(npc) || npc.sleeping) return false;   // they saw nothing

  const ai = npc._ai || (npc._ai = {});
  // Somebody else is already driving this NPC — the burglary alarm, npc-drugs.
  // Two drivers on one suspended graph means whichever finishes first hands it
  // back while the other is still steering it.
  if (ai.alarm || ai.dosedOut) return false;
  ai.homeSleeping = false;
  ai.waitUntil = 0;
  ai.currentNode = null;
  ai.alarm = true;                 // the engine AI tick yields the graph while set
  try { setPosture(npc, 'standing'); } catch { /* posture is best-effort */ }

  PANICS.set(npc.id, {
    npcId: npc.id,
    until: Date.now() + ms,
    reason,
    threatName: threat?.handle || threat?.name || null,
  });
  sendToZone(npc.zone_id, { type: 'zone_event', message: pick(SHOUT, npc.name), refresh: true });
  emit('npc.alarmed', { npc, zoneId: npc.zone_id, reason });
  return true;
}

/** Hand the NPC back its graph. Safe on anyone who was never panicking. */
export function calmNpc(npc) {
  if (!npc?.id) return false;
  const had = PANICS.delete(npc.id);
  if (npc._ai) { npc._ai.alarm = false; npc._ai.currentNode = null; npc._ai.waitUntil = 0; }
  return had;
}

const fleeBroadcast = (zoneId, payload, excludeId) => sendToZone(zoneId, payload, excludeId);

/**
 * One second of being frightened: shout, and try to get out of the room.
 *
 * Called from the game loop. Any NPC that has died, been knocked out or gone
 * missing is released rather than left holding a suspended graph — the flag
 * outliving its driver is the whole failure mode this module exists to close.
 */
export function tickPanic() {
  if (!PANICS.size) return;
  const now = Date.now();
  for (const [npcId, state] of PANICS) {
    const npc = world.npcs.get(npcId);
    if (!npc || (npc.hp != null && npc.hp <= 0)) { PANICS.delete(npcId); continue; }
    if (now >= state.until || isOut(npc)) {
      sendToZone(npc.zone_id, { type: 'zone_event', message: `${npc.name} is still shaking, but the running has stopped.` });
      calmNpc(npc);
      continue;
    }
    if (Math.random() >= FLEE_ODDS) continue;
    const zone = getZone(npc.zone_id);
    const exits = zone ? neighborZoneIds(zone) : [];
    if (!exits.length) {
      sendToZone(npc.zone_id, { type: 'zone_event', message: `${npc.name} presses into a corner with nowhere to go.` });
      continue;
    }
    moveEntity(npc, exits[Math.floor(Math.random() * exits.length)], fleeBroadcast, query);
  }
}

/**
 * THE WITNESS LAW. Everyone else in the room saw that.
 *
 * Deliberately not a roll. Violence in front of people is loud by definition,
 * and letting dice hide it would make a crowded room no riskier than an empty
 * one — which is the opposite of what a witness system is for. The victim is
 * skipped (they have their own problems) and so is anyone out cold or asleep.
 */
export function panicWitnesses(zoneId, { attacker = null, victim = null, reason = 'violence' } = {}) {
  if (!zoneId) return 0;
  const victimId = victim?.id || victim?.instanceId || null;
  let n = 0;
  for (const npc of getZoneNpcs(zoneId) || []) {
    if (npc.id === victimId) continue;
    // Police don't run from a fight, they walk toward one. Their own dispatch
    // path (surveillance/wanted) already handles what they do about it.
    if (npc.flags?.police) continue;
    if (panicNpc(npc, { reason, threat: attacker })) n++;
  }
  return n;
}

// Combat noise, from wherever it comes: the weapon plugin emits both of these on
// the ACT rather than the hit, which is the right grain — witnessing a swing is
// witnessing the assault whether or not it connected.
on('npc.attacked', ({ actor, npc }) => {
  try { panicWitnesses(npc?.zone_id, { attacker: actor, victim: npc, reason: 'assault' }); }
  catch (e) { console.error('[panic] npc.attacked:', e.message); }
});
on('player.attacked', ({ attacker, target }) => {
  try { panicWitnesses(target?.current_zone, { attacker, victim: target, reason: 'assault' }); }
  catch (e) { console.error('[panic] player.attacked:', e.message); }
});

export const _test = { PANICS };
