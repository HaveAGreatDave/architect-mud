// plugins/stands/crew.js
//
// THE ICE CREW AT EACH INTERMISSION. An NPC with `flags.ice_crew` watches the game from a post in their
// bay, and at each break in the game on the air they walk to the resurfacer, climb on, drive it out
// through the door, do the ice, drive it back, climb down and go back to their post. The Room Stage
// draws all of it (`room.npcStage` for them, `room.vehicles` for the machine), and the text world hears
// each moment as a line in the room.
//
//   flags.ice_crew = { sport, bay, post, machine, out, say? }
//   - `sport`: whose breaks ('hockey'); `bay`: the zone they keep the machine in; `post`: the piece they
//     sit at (a stool at a window); `machine`: the resurfacer's piece in the bay; `out`: the zone the ice
//     is seen from, where they are while it's out; `say`: lines for the moments, `{name}` their first name
//     (each falls back to a plain one here).
//
// ⚠ RAM AND THE CLOCK. The break comes from the broadcast's own state (sportsBreakNow: the live channel's
// last Gameday payload and its `resume` cue), read every 2 s by a scheduler tick idle-gated on players.
// Nothing is written. A restart mid-break puts them back at their post, and the machine in the bay.
// ⚠ ONLY AN AWAITED-FREE PATH. The hooks are sync; the tick moves the NPC in RAM (moveNpcToZone) and
// emits for the Stage to send again.

import { world, moveNpcToZone, getZoneFurniture } from '../../server/engine/world.js';
import { sendToZone } from '../../server/engine/messaging.js';
import { emit } from '../../server/engine/events.js';
import { schedule } from '../../server/engine/scheduler.js';
import { sportsBreakNow, sportsGamesAhead } from '../broadcast/index.js';
import { CREW, crewStep, crewPhaseMs } from '../../client/shared/stadium.js';

const SAY = {
  board: '{name} puts down his cup, gets off his stool and climbs up onto the resurfacer.',
  leave: 'The roller door rattles up, and {name} drives the resurfacer out onto the ice.',
  arrive: 'The gate swings open and {name} drives the resurfacer out onto the ice.',
  depart: '{name} brings the resurfacer off the ice and back through the gate.',
  return: 'The roller door goes up and {name} drives the resurfacer back in.',
  alight: '{name} parks it, cuts the engine, climbs down and goes back to his stool by the window.',
};

const state = new Map();   // npcId -> { phase, t0 }
// every crew NPC, found once and again when the NPC count changes
let crew = null, crewN = -1;
function crewNpcs() {
  if (crewN !== world.npcs.size) { crew = [...world.npcs.values()].filter((n) => n?.flags?.ice_crew?.bay); crewN = world.npcs.size; }
  return crew;
}
// moved in RAM, and told, so a Stage open in either room sees them go or come
function move(n, to) { const from = n.zone_id; if (moveNpcToZone(n.id, to)) emit('npc.moved', { npc: n, from, to }); }
const firstName = (n) => String(n.name || '').split(/\s+/)[0] || 'He';
function say(n, key, zoneId) {
  const line = String(n.flags.ice_crew.say?.[key] || SAY[key]).replace(/\{name\}/g, firstName(n));
  if (zoneId) sendToZone(zoneId, { type: 'zone_event', message: line });
}
function set(n, phase, now) {
  state.set(n.id, { phase, t0: now });
  const c = n.flags.ice_crew;
  emit('room.peopleChanged', { zoneId: c.bay });
  emit('room.vehiclesChanged', { zoneId: c.bay });
}

// One step of the routine for each crew NPC. `now` and `brk` are for the regress, which stages a break.
export function crewTick(now = Date.now(), brkOf = sportsBreakNow) {
  for (const n of crewNpcs()) {
    if (n._dead) continue;
    const c = n.flags.ice_crew, s = state.get(n.id) || { phase: 'post', t0: now }, brk = brkOf(c.sport || 'hockey', now);
    const ms = now - s.t0, done = ms >= crewPhaseMs(s.phase);
    // a step inside a phase has its own picture: tell the Stage when it changes (walk to climb, alight to back)
    const step = crewStep(s.phase, ms).step;
    if (s.step && s.step !== step) emit('room.peopleChanged', { zoneId: c.bay });
    s.step = step;
    state.set(n.id, s);
    if (s.phase === 'post') {
      // off at the start of a break long enough to do the ice in, and only from the bay
      if (brk?.inBreak && brk.msLeft > CREW.least && n.zone_id === c.bay) { say(n, 'board', c.bay); set(n, 'board', now); }
    } else if (s.phase === 'board' && done) {
      say(n, 'leave', c.bay); set(n, 'leave', now);
    } else if (s.phase === 'leave' && done) {
      if (c.out) { move(n, c.out); say(n, 'arrive', c.out); }
      set(n, 'away', now);
    } else if (s.phase === 'away' && (!brk?.inBreak || brk.msLeft < CREW.lead)) {
      if (c.out) say(n, 'depart', c.out);
      move(n, c.bay);
      say(n, 'return', c.bay); set(n, 'return', now);
    } else if (s.phase === 'return' && done) {
      say(n, 'alight', c.bay); set(n, 'alight', now);
    } else if (s.phase === 'alight' && done) {
      set(n, 'post', now);
    }
  }
}
schedule('2s', () => crewTick());

// Where a crew NPC is drawn in their bay (`room.npcStage`): at their post, walking to the machine, up on it,
// gone with it, or walking back. Null when it isn't theirs to say.
export function crewStage(n, zoneId, pieces) {
  const c = n?.flags?.ice_crew;
  if (!c || zoneId !== c.bay) return null;
  const s = state.get(n.id) || { phase: 'post', t0: Date.now() };
  const { step, k } = crewStep(s.phase, Date.now() - s.t0);
  const post = pieces.find((p) => p.id === c.post), machine = pieces.find((p) => p.id === c.machine);
  // beside the machine on the driver's side, where he climbs on and off
  const side = machine && Array.isArray(machine.spot?.at) ? besideMachine(machine) : null;
  const front = post && Array.isArray(post.spot?.at) ? inFront(post) : null;
  const left = (ms) => Math.max(400, Math.round(ms));
  if (s.phase === 'leave' || s.phase === 'away' || s.phase === 'return') return { hide: true };
  if (s.phase === 'board' && step === 'walk' && front && side) return { posture: 'standing', on: null, at: front, route: { path: [front, side], ms: left(CREW.walk * (1 - k)) } };
  if ((s.phase === 'board' && step === 'climb') || (s.phase === 'alight' && step === 'alight')) return machine ? { posture: 'sitting', on: machine.id, clip: 'sitDrive' } : null;
  if (s.phase === 'alight' && step === 'back' && front && side) return { posture: 'standing', on: null, at: side, route: { path: [side, front], ms: left(CREW.back * (1 - k)) } };
  return post ? { posture: 'sitting', on: post.id } : null;
}
// a step out from a stool's front, and a step out from the machine's driver's side (its left, as it faces)
const fac = (turn) => { const a = (turn || 0) * Math.PI / 180; return [Math.sin(a), -Math.cos(a)]; };
function inFront(p) { const [fu, fv] = fac(p.spot.turn), d = (p.dims?.[1] || 0.4) / 2 + 0.45; return [+(p.spot.at[0] + fu * d).toFixed(2), +(p.spot.at[1] + fv * d).toFixed(2)]; }
function besideMachine(p) { const [fu, fv] = fac(p.spot.turn), su = fv, sv = -fu, d = (p.dims?.[0] || 2.3) / 2 + 0.45; return [+(p.spot.at[0] + su * d).toFixed(2), +(p.spot.at[1] + sv * d).toFixed(2)]; }

// What stands in the bay (`room.vehicles`): the machine, and where it is in its trip. `age` is ms into the
// phase; the client plays the drive from it. Cup final night (`final`) dresses it in the Cup trim.
export function crewVehicles(zoneId) {
  for (const n of crewNpcs()) {
    const c = n.flags.ice_crew;
    if (c.bay !== zoneId || !c.machine) continue;
    const s = state.get(n.id) || { phase: 'post', t0: Date.now() };
    const phase = s.phase === 'leave' ? 'leaving' : s.phase === 'away' ? 'away' : s.phase === 'return' ? 'returning' : 'parked';
    const machine = getZoneFurniture(zoneId).find((f) => f.id === c.machine);
    return { machine: { kind: 'resurfacer', piece: c.machine, phase, age: Date.now() - s.t0, ms: CREW.drive, door: machine?.flags?.machine_door || 'front',
      driver: n.id, final: finalNight(c.sport || 'hockey') } };
  }
  return null;
}
// Cup final night: the game on now is the final
const finalNight = (sport) => { const g = sportsGamesAhead(sport, 1)[0]; return !!(g?.now && g.final); };

export const _test = { state, crewTick, crewStage, crewVehicles, reset: () => { state.clear(); crewN = -1; } };
