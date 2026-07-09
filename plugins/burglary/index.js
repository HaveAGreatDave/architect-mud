// Burglary alarm — the intrusion state machine that decides whether breaking
// into an occupied home actually earns you wanted stars.
//
// The engine (doors.js) fires `breakin.attempt` when a player picks/bashes a
// door; speech (social.js) fires `player.spoke`; combat fires `npc.attacked`.
// This plugin watches those, decides whether a resident NPC *hears* the
// intrusion, drives their panic cop-call / flee sequence directly (suspending
// their normal AI graph via `_ai.alarm`), and only then reports `burglary` to
// the surveillance/wanted system. Silence every resident before they finish the
// call — or before they flee the unit — and no burglary star lands (the assault
// / murder charge for attacking them still applies).
//
// See docs/systems-jail.md / docs/systems-surveillance.md for the crime side.

import { query } from '../../server/models/db.js';
import { world, getZoneNpcs, getLivePlayer } from '../../server/engine/world.js';
import { sendToZone } from '../../server/engine/messaging.js';
import { on, emit } from '../../server/engine/events.js';
import { setPosture } from '../../server/engine/posture.js';
import { moveEntity } from '../../server/engine/ai-behaviour.js';
import { findPath } from '../../server/engine/pathfinding.js';

// ── Tunables ─────────────────────────────────────────────────────────────────
const TICK_MS       = 5000;             // detection + flee cadence (spec: "every 5 second tick")
const WAKE_PICKING  = 0.20;             // asleep resident, per tick, while the door is being picked
const WAKE_INSIDE   = 0.03;             // asleep resident, per tick, once the intruder is inside (unless noise)
const CALL_MS       = 10000;            // length of the panic cop-call before the charge lands
const FLEE_ESCAPE   = 0.5;              // per-tick chance a fleeing resident dodges past the intruder and moves
const INTRUSION_TTL = 5 * 60 * 1000;    // drop a stale intrusion this long after the last break-in signal
const DOOR_LINE_MS  = 4000;             // gap between defiant "through the door" yells while you're still picking
const INSIDE_LINE_MS = 2000;            // gap between frantic screams once you're inside (denser = more panic)

// ── State ────────────────────────────────────────────────────────────────────
const INTRUSIONS = new Map();  // intruderId -> { intruderId, entranceZoneId, unitZoneIds:Set, lastActivity }
const ALARMS     = new Map();  // npcId -> { npcId, intr, phase:'calling'|'fleeing', timers:[], wasAsleep }

const npcById   = (id) => world.npcs.get(id) || null;
const npcAlive  = (npc) => !npc ? false : (npc.hp == null || npc.hp > 0);

// Every NPC currently standing in the residence unit(s) this intrusion targets.
function unitNpcs(intr) {
  const out = [];
  for (const zid of intr.unitZoneIds) out.push(...getZoneNpcs(zid));
  return out;
}

// A zone counts as "at the intrusion" if it's a targeted unit or the entrance
// the intruder is working from — a yell in the hallway still wakes the resident.
function zoneInIntrusion(intr, zoneId) {
  return intr.unitZoneIds.has(zoneId) || intr.entranceZoneId === zoneId;
}

// ── Waking & the panic cop-call ──────────────────────────────────────────────
const WAKE_LINES = [
  name => `${name} jolts awake — "Who's there?!"`,
  name => `${name} sits bolt upright, breath catching in the dark.`,
];
const NOTICE_LINES = [
  name => `${name} freezes — "...someone's in the house."`,
  name => `${name} spins toward the noise, eyes wide.`,
];
// Lower urgency: the intruder is still on the far side of a locked door, so the
// resident is defiant — banging back, shouting through it, calling it in. These
// carry to the intruder's side too (they're at the door working the lock).
const DOOR_YELL_LINES = [
  name => `${name} pounds on the door: "I've CALLED THE COPS — you hear me?!"`,
  name => `${name} shouts through the door: "Get the hell away from my home!"`,
  name => `${name} snarls through the door: "I know you're out there, you piece of—"`,
  name => `${name} yells: "Precinct Nine's on the line RIGHT NOW, you're finished!"`,
  name => `${name} bangs something heavy against the door: "Try it. TRY it and see."`,
];
// High urgency: the intruder is inside the unit. Terror — screaming for help,
// begging, wailing into the comm.
const SCREAM_LINES = [
  name => `${name} SCREAMS: "SOMEBODY HELP — HE'S IN MY HOUSE!"`,
  name => `${name} shrieks and scrambles back — "Please, please don't, PLEASE—"`,
  name => `${name} wails into the comm: "HE'S INSIDE, HE'S RIGHT HERE, HURRY—"`,
  name => `${name} screams for help at the top of their lungs.`,
  name => `${name}, voice shattering: "TAKE anything — just don't— DON'T—"`,
];
const pick = (pool, name) => pool[Math.floor(Math.random() * pool.length)](name);

// True once the intruder has actually crossed into the unit (vs. still picking
// the door from outside) — the threat level that drives which lines play.
function intruderInside(intr) {
  const p = getLivePlayer(intr.intruderId);
  return !!p && intr.unitZoneIds.has(p.current_zone);
}

// Broadcast an alarm line to the unit, and — while the intruder is still outside
// working the door — to their side too, so the burglar hears the yelling.
function alarmSay(npc, intr, message, throughDoor) {
  sendToZone(npc.zone_id, { type: 'zone_event', message });
  if (throughDoor && intr.entranceZoneId && intr.entranceZoneId !== npc.zone_id) {
    sendToZone(intr.entranceZoneId, { type: 'zone_event', message });
  }
}

// One reaction line, then reschedule itself — cadence and pool both escalate
// the moment the intruder gets inside (denser, and screaming instead of yelling).
function alarmPulse(npc, state) {
  if (ALARMS.get(npc.id) !== state || state.phase !== 'calling') return;
  const live = npcById(state.npcId);
  if (!live || !npcAlive(live)) { endAlarm(live || npc); return; }

  const inside = intruderInside(state.intr);
  alarmSay(live, state.intr, pick(inside ? SCREAM_LINES : DOOR_YELL_LINES, live.name), !inside);
  state.timers.push(setTimeout(() => alarmPulse(live, state), inside ? INSIDE_LINE_MS : DOOR_LINE_MS));
}

// Take an NPC over: wake it, suspend its graph, and start the ~10s cop-call.
function startAlarm(npc, intr) {
  if (ALARMS.has(npc.id) || !npcAlive(npc)) return;
  const ai = npc._ai || (npc._ai = {});
  const wasAsleep = !!ai.homeSleeping;

  ai.homeSleeping = false;
  ai.waitUntil = 0;
  ai.currentNode = null;
  ai.alarm = true;                 // engine AI tick skips this NPC while set
  try { setPosture(npc, 'standing'); } catch { /* posture is best-effort */ }

  const state = { npcId: npc.id, intr, phase: 'calling', timers: [], wasAsleep,
                  chargeAt: Date.now() + CALL_MS, charged: false };
  ALARMS.set(npc.id, state);

  // Opening beat: startled awake, or (if already up) first realising the threat.
  alarmSay(npc, intr, pick(wasAsleep ? WAKE_LINES : NOTICE_LINES, npc.name), true);

  // Then an escalating stream of reactions (through-the-door yells → screams once
  // the intruder is inside). The charge + calm-down are driven by the tick, so
  // the resident keeps reacting for as long as the intruder is actually there.
  state.timers.push(setTimeout(() => alarmPulse(npc, state), 700));
}

// Is the intruder still a threat to this NPC — inside the unit, or at the door
// working the lock? Once they wander off, the resident can finally calm down.
function threatPresent(intr) {
  const p = getLivePlayer(intr.intruderId);
  return !!p && (intr.unitZoneIds.has(p.current_zone) || p.current_zone === intr.entranceZoneId);
}

// Is a break-in actively underway at this zone (intruder present)? Consulted by
// the housing forcefield gate — a victim (player or NPC unit) can't raise the
// safe-sleep forcefield, or disconnect to safety, mid-burglary. This is the
// player-side effect of the same presence check the NPC alarms use.
function zoneUnderThreat(zoneId) {
  for (const intr of INTRUSIONS.values()) {
    if (intr.unitZoneIds.has(zoneId) && threatPresent(intr)) return true;
  }
  return false;
}

// Housing asks before sealing the forcefield; a reason string vetoes it.
export const hooks = {
  'forcefield.gate': ({ zoneId }) => (zoneUnderThreat(zoneId) ? 'a break-in is in progress' : undefined),
};

// Attacked mid-call → drop the phone and run for it.
function beginFlee(npc) {
  const state = ALARMS.get(npc.id);
  if (!state || state.phase === 'fleeing') return;
  for (const t of state.timers) clearTimeout(t);
  state.timers = [];
  state.phase = 'fleeing';
  sendToZone(npc.zone_id, { type: 'zone_event', message: `${npc.name} drops everything and bolts for the door!` });
}

// One flee step per tick: dodge-roll to slip past the intruder toward the exit.
// Clearing the unit = raising the alarm outside → burglary charged.
const fleeBroadcast = (zoneId, payload, excludeId) => sendToZone(zoneId, payload, excludeId);
function stepFlee(npc, state) {
  if (!npcAlive(npc)) { endAlarm(npc); return; }

  // Left the unit (and reached the entrance / beyond) — escaped to sound the alarm.
  if (!state.intr.unitZoneIds.has(npc.zone_id)) {
    sendToZone(npc.zone_id, { type: 'zone_event', message: `${npc.name} scrambles clear, screaming for help!` });
    reportBurglary(state.intr, npc.zone_id);
    endAlarm(npc);
    return;
  }

  if (Math.random() >= FLEE_ESCAPE) {
    sendToZone(npc.zone_id, { type: 'zone_event', message: `${npc.name} tries to bolt — the intruder's in the way!` });
    return;
  }

  const path = findPath(npc.zone_id, state.intr.entranceZoneId);
  const next = path && path.length >= 2 ? path[1] : null;
  if (!next) return;
  moveEntity(npc, next, fleeBroadcast, query);
}

// Release the NPC back to its normal AI graph (graph restarts from _start).
function endAlarm(npc) {
  const state = ALARMS.get(npc.id);
  if (state) { for (const t of state.timers) clearTimeout(t); ALARMS.delete(npc.id); }
  if (npc && npc._ai) { npc._ai.alarm = false; npc._ai.currentNode = null; npc._ai.waitUntil = 0; }
}

function reportBurglary(intr, zoneId) {
  const player = getLivePlayer(intr.intruderId);
  if (player) emit('burglary.reported', { player, zoneId });
}

// ── Signals in ───────────────────────────────────────────────────────────────

// Door being picked/bashed. Awake residents hear it at once; a bash is loud
// enough to wake sleepers on the spot. Sleepers otherwise roll on the tick.
on('breakin.attempt', ({ intruderId, entranceZoneId, unitZoneIds, method }) => {
  if (!intruderId || !unitZoneIds?.length) return;
  let intr = INTRUSIONS.get(intruderId);
  if (!intr) {
    intr = { intruderId, entranceZoneId, unitZoneIds: new Set() };
    INTRUSIONS.set(intruderId, intr);
  }
  intr.entranceZoneId = entranceZoneId;
  for (const z of unitZoneIds) intr.unitZoneIds.add(z);
  intr.lastActivity = Date.now();

  for (const npc of unitNpcs(intr)) {
    if (ALARMS.has(npc.id)) continue;
    const asleep = !!npc._ai?.homeSleeping;
    if (!asleep || method === 'bash') startAlarm(npc, intr);
  }
});

// Noise inside/at the unit instantly wakes any still-asleep resident (bypasses
// the 3%/tick inside roll). Only the intruder's own racket counts.
function onNoise(zoneId, actorId) {
  for (const intr of INTRUSIONS.values()) {
    if (intr.intruderId !== actorId || !zoneInIntrusion(intr, zoneId)) continue;
    intr.lastActivity = Date.now();
    for (const npc of unitNpcs(intr)) if (!ALARMS.has(npc.id)) startAlarm(npc, intr);
  }
}
on('player.spoke', ({ player, zoneId }) => { if (player?.id) onNoise(zoneId, player.id); });
on('player.attacked', ({ attacker }) => { if (attacker?.id) onNoise(attacker.current_zone, attacker.id); });
on('npc.attacked', ({ actor, npc }) => {
  if (npc && ALARMS.has(npc.id)) beginFlee(npc);   // a resident under attack runs
  if (actor?.id) onNoise(actor.current_zone, actor.id);
});
on('npc.killed', ({ npc }) => { if (npc && ALARMS.has(npc.id)) endAlarm(npc); });

// ── Tick: detection rolls, flee steps, expiry ────────────────────────────────
function alarmTick() {
  const now = Date.now();

  for (const intr of [...INTRUSIONS.values()]) {
    const intruder = getLivePlayer(intr.intruderId);
    const hasAlarms = [...ALARMS.values()].some(a => a.intr === intr);

    // While the intruder is still at the unit, keep the intrusion fresh — even a
    // silent break-in of a player-owned unit (no NPC alarms) must keep the
    // forcefield gate closed for as long as they're actually there.
    if (intruder && threatPresent(intr)) intr.lastActivity = now;

    // Expire once the intruder's gone/idle and no resident is still reacting.
    if ((!intruder || now - intr.lastActivity > INTRUSION_TTL) && !hasAlarms) {
      INTRUSIONS.delete(intr.intruderId);
      continue;
    }
    if (!intruder) continue;

    const inside = intr.unitZoneIds.has(intruder.current_zone);
    const chance = inside ? WAKE_INSIDE : WAKE_PICKING;
    for (const npc of unitNpcs(intr)) {
      if (ALARMS.has(npc.id)) continue;
      const asleep = !!npc._ai?.homeSleeping;
      if (!asleep) startAlarm(npc, intr);            // awake: hears it (100%)
      else if (Math.random() < chance) startAlarm(npc, intr);
    }
  }

  for (const state of [...ALARMS.values()]) {
    const npc = npcById(state.npcId);
    if (!npc) { ALARMS.delete(state.npcId); continue; }
    if (!npcAlive(npc)) { endAlarm(npc); continue; }

    if (state.phase === 'fleeing') { stepFlee(npc, state); continue; }

    // 'calling': keep reacting while the intruder is a threat. Charge burglary
    // once they've been at it long enough for the call to land, and let the
    // resident calm down (alarm ends) the moment the intruder clears off.
    if (!threatPresent(state.intr)) {
      sendToZone(npc.zone_id, {
        type: 'zone_event',
        message: state.charged
          ? `${npc.name} sags against the wall, shaking — the police are on their way.`
          : `${npc.name} goes still, listening hard... whoever it was is gone.`,
      });
      endAlarm(npc);
      continue;
    }
    // Burglary needs an actual entry: someone still rattling the lock from the
    // hallway who never gets in is at most an attempt (no charge). Once they've
    // been inside and the call has had time to land, the stars are earned.
    if (intruderInside(state.intr)) state.everInside = true;
    if (!state.charged && state.everInside && now >= state.chargeAt) {
      state.charged = true;
      reportBurglary(state.intr, npc.zone_id);
    }
  }
}
setInterval(() => { try { alarmTick(); } catch (e) { console.error('[burglary] tick error:', e.message); } }, TICK_MS);
