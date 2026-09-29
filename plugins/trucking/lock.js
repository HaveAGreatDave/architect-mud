// THE LONG HAUL — the South Lock.
//
// The South Gate is an airlock now. Outside the Curtain the Glacis road runs under a shed (the Outer
// Lock) with the weigh ramp and the Glacis Weigh under the same roof; inside it, the Gate Road runs
// through two covered tiles (the South Lock) whose lamps tell a driver what the lock wants:
//
//   green  roll on
//   amber  stop in the lock: somebody walks the rig and looks in the cab
//   red    you were amber and you didn't stop. Klaxon, flashing, four stars.
//
// Content marks the tiles (`flags.gate_lock`, with `search: true` on the inner two); this file is
// the law and nothing else. The weighbridge outside is still scale.js, untouched: the lock searches,
// the scale weighs, and neither knows about the other.
//
// ⚠ SELECTION IS SEEDED, NEVER ROLLED PER FRAME. A driver is picked on (player, truck, 20-minute
// window), so turning round and coming back in gets the same answer, and the lights, the log and
// the charge are all telling the same story.
//
// ⚠ RAN IS DECIDED ON THE WAY OUT, like the plaza. The lock arms when the rig enters a search tile
// and settles when it leaves: out the far end with the lamps amber and no search is running it;
// out the end you came in by is turning round, which is not.
//
// ⚠ THE FOUR STARS GO THROUGH WANTED_RAISE, NOT A WITNESS ROLL. The lock is the apparatus. It read
// the plate and it knows; nobody has to happen to see it. `chargeAt(…, true, …)` is that path.

import { sendToPlayer } from '../../server/engine/messaging.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { cabCheckAt, chargeAt } from './scale.js';

const RUN_CRIME = 'running_an_inspection';
const STOPPED_MPH = 3;
const WINDOW_MS = 20 * 60 * 1000;
const SEARCH_RATE = 0.3;
const RED_MS = 30 * 1000;

// Regress can pin the draw.
let forced = null;
export function _forceLockDraw(v) { forced = v; }

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}

export const lockAt = (zone) => {
  const f = zone?.flags?.gate_lock;
  return f && typeof f === 'object' ? f : null;
};
const searchTile = (zone) => !!lockAt(zone)?.search;

// Is this driver pulled for a search this window? Pure.
export function lockSelects(pid, truckId, t = Date.now()) {
  if (forced !== null) return !!forced;
  return hash(`${pid}|${truckId || 'rig'}|${Math.floor(t / WINDOW_MS)}|lock`) < SEARCH_RATE;
}

// Which end of the lock a tile is on. The gate end is the gate tile itself; anything else is town.
const sideOf = (lock, zone) => (zone && lock && zone.id === lock.gate ? 'gate' : 'town');

// Pure: what leaving the lock means. Regress asks this directly.
export function lockVerdict(st, exitSide) {
  if (!st || !st.flagged || st.searched) return 'clear';
  return exitSide === st.from ? 'clear' : 'ran';
}

function signal(rig, st, until = 0) {
  rig._lockSig = { st, until };
}

// What the cab push paints into the lock's cells for this driver. Red lapses back to green.
export function lockSignal(rig) {
  const s = rig?._lockSig;
  if (!s) return null;
  if (s.until && Date.now() > s.until) { rig._lockSig = null; return null; }
  return s.st;
}

// Called on every cab frame in the city leg (sync guard first, so it costs nothing away from the
// gate) and from afterDrive on the text rung. `prev` is the zone the rig was on before this move.
// Returns { stop: true } when a text run has to end.
export async function lockTick(player, rig, zone, prev = null, { text = false } = {}) {
  if (!rig || rig.leg !== 'city') return null;
  const here = searchTile(zone);
  const st = rig._lock;
  if (!here && !st) return null;

  if (here && !st) {
    const lock = lockAt(zone);
    const flagged = lockSelects(player.id, rig.truckId);
    rig._lock = { gate: lock.gate, name: lock.name, from: sideOf(lock, prev), flagged, searched: false, busy: false };
    signal(rig, flagged ? 'amber' : 'green');
    sendToPlayer(player.id, { type: 'emote', message: flagged
      ? `<span class="text-amber">The lamps down both walls of the lock go amber together, and the gantry over the road says <b>STOP — SEARCH</b>.</span>\n`
        + `<span class="text-dim">Stop in the lock and let them walk the rig. Rolling out the far end on amber is a decision, and the lock will write it down.</span>`
      : `<span class="text-dim">The lock's lamps run green from end to end. Nobody steps out. Roll on.</span>` });
    rig._lockPush = true;
    if (flagged && text) {
      // The text rung has no brake pedal to not press. It stops, and the search happens.
      rig.speed = 0;
      await searchIn(player, rig);
      return { stop: true };
    }
    return 'armed';
  }

  if (here && st) {
    if (st.flagged && !st.searched && !st.busy && Math.abs(rig.speed || 0) <= STOPPED_MPH) {
      await searchIn(player, rig);
      return 'searched';
    }
    return null;
  }

  // Left the lock.
  rig._lock = null;
  const verdict = lockVerdict(st, sideOf(st, zone));
  if (verdict === 'ran') {
    signal(rig, 'red', Date.now() + RED_MS);
    rig._lockPush = 'red';
    await runIt(player, st);
  } else if (!rig._lockSig || rig._lockSig.st !== 'red') {
    rig._lockSig = null;
    rig._lockPush = true;
  }
  return verdict;
}

async function searchIn(player, rig) {
  const st = rig._lock;
  if (!st) return;
  st.busy = true;
  sendToPlayer(player.id, { type: 'emote', message:
    `<span class="ambient">You set the brake under the amber. Two officers come out of a door in the plate you hadn't seen was a door: one walks the length of the rig with a lamp on a pole, one goes straight to the cab.</span>` });
  const scan = await dispatchAction({ type: 'CONTRABAND_SCAN', actor: player,
    params: { guards: 'the lock officers', where: st.name || 'the South Lock' } }).catch(() => null);
  await cabCheckAt(player, rig, { name: st.name || 'the South Lock' });
  st.searched = true;
  st.busy = false;
  signal(rig, 'green');
  rig._lockPush = true;
  if (!scan?.caught) {
    sendToPlayer(player.id, { type: 'emote', message:
      `<span class="text-green">The one with the lamp raps twice on the trailer and steps back. The lamps go green.</span>` });
  }
}

async function runIt(player, st) {
  sendToPlayer(player.id, { type: 'emote', message:
    `<span class="text-red">You roll out of the lock on amber, and every lamp in it goes red at once.</span>\n\n`
    + `A klaxon starts behind you, two notes, the kind that is built to be heard through a closed cab at speed. A beacon on the gantry turns and the lamps down both walls pulse with it. Nobody runs after you. A plate reader already has your number, and that was the whole transaction.\n\n`
    + `<span class="text-dim">${st.name || 'The South Lock'}. You were told to stop.</span>` });
  await chargeAt(player, true, RUN_CRIME, `running the search at ${st.name || 'the South Lock'}`);
}

export const _test = { STOPPED_MPH, WINDOW_MS, SEARCH_RATE, RED_MS, RUN_CRIME };
