// THE SHED'S LIFT: a truck brought up from the garage under a depot's shed floor, for the Room Stage
// (docs/systems-trucking.md, "The lift in the shed").
//
// RAM only. The lift says which truck is standing on the shed floor and since when; nothing is written,
// and a restart puts every truck back downstairs, where its row says it always was (`depot_zone`). The
// truck is the same one the counter's Deploy drives out: `drive <id>` from beside it seats you.
//
// The Stage reads it through the sync `room.vehicles` hook and is told of a change by `room.vehiclesChanged`
// (plugins/roomstage), as it is of a room's shutters. Nothing here knows what a Stage is.
import { emit } from '../../server/engine/events.js';

// how long the platform takes to come up or go down, ms; the client plays the same clock
export const HOIST_MS = 9000;
// a truck left standing on the floor goes back down on its own after this long
const STAND_MS = 30 * 60 * 1000;

const lifts = new Map();   // bay zone id -> { truckId, ownerId, name, variant, paint, grime, since, down? }
const hands = new Map();   // player id -> { bay, trucks: [{ id, name }] }: their trucks downstairs, as the counter last dealt them

export const liftAt = (bayId) => {
  const L = lifts.get(bayId);
  if (L && Date.now() - L.since > STAND_MS && !L.down) lower(bayId);
  return lifts.get(bayId) || null;
};

/** The counter dealt this player their hand at this bay; the Stage's lift panel lists it. */
export function noteHand(playerId, bayId, trucks) {
  hands.set(playerId, { bay: bayId, trucks: trucks.map((t) => ({ id: t.id, name: t.name })) });
}
export const forgetHand = (playerId) => hands.delete(playerId);

export function raise(bayId, ownerId, truck) {
  lifts.set(bayId, { ...truck, ownerId, since: Date.now() });
  emit('room.vehiclesChanged', { zoneId: bayId });
}

export function lower(bayId) {
  const L = lifts.get(bayId);
  if (!L || L.down) return;
  L.down = Date.now();
  emit('room.vehiclesChanged', { zoneId: bayId });
  setTimeout(() => { if (lifts.get(bayId) === L) { lifts.delete(bayId); emit('room.vehiclesChanged', { zoneId: bayId }); } }, HOIST_MS).unref?.();
}

/** Driven off the floor: the lift is empty at once, nothing to watch go down. */
export function taken(truckId) {
  for (const [bay, L] of lifts) if (L.truckId === truckId) { lifts.delete(bay); emit('room.vehiclesChanged', { zoneId: bay }); }
}

/**
 * The `room.vehicles` answer for one viewer: what stands on the lift (with how far through its move it is, as an
 * age, so the client's clock needn't agree with ours) and this viewer's own trucks downstairs to call up.
 */
export function roomVehicles(zoneId, player, { isDepot }) {
  if (!isDepot(zoneId)) return undefined;
  const L = liftAt(zoneId), now = Date.now();
  const h = hands.get(player?.id);
  const mine = h && h.bay === zoneId ? h.trucks : [];
  return {
    hoistMs: HOIST_MS,
    lift: L ? { id: L.truckId, name: L.name, variant: L.variant, paint: L.paint, grime: L.grime || 0,
      mine: String(L.ownerId) === String(player?.id), age: now - L.since, ...(L.down ? { down: now - L.down } : {}) } : null,
    mine,
  };
}

export const _resetHoist = () => { lifts.clear(); hands.clear(); };
