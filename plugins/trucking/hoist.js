// THE SHED'S LIFT: a truck brought up from the garage under a depot's shed floor, for the Room Stage
// (docs/systems-trucking.md, "The lift in the shed").
//
// It's the truck's half of the vehicle stand (server/engine/vehicle-stand.js), which every depot shares: a
// truck on the lift is a stand of kind `truck`, coming up from `below`. RAM only. The lift says which truck is
// standing on the shed floor and since when; nothing is written, and a restart puts every truck back
// downstairs, where its row says it always was (`depot_zone`). The truck is the same one the counter's Deploy
// drives out: `drive <id>` from beside it seats you.
//
// These are the names trucking has always used; they read and write the shared stand.
import { standAt, raiseStand, lowerStand, standTaken, noteStandHand, forgetStandHand, standVehicles, _resetStands } from '../../server/engine/vehicle-stand.js';

// how long the platform takes to come up or go down, ms; the client plays the same clock
export const HOIST_MS = 9000;

const asLift = (S) => (S && S.kind === 'truck' ? { ...S, truckId: S.id, variant: S.look?.variant, paint: S.look?.paint, grime: S.look?.grime || 0 } : null);
export const liftAt = (bayId) => asLift(standAt(bayId));

/** The counter dealt this player their hand at this bay; the Stage's lift panel lists it. */
export const noteHand = (playerId, bayId, trucks) => noteStandHand(playerId, bayId, trucks);
export const forgetHand = (playerId) => forgetStandHand(playerId);

/** `truck` is `{ truckId, name, variant, paint, grime }`, as the shed has always said it. */
export function raise(bayId, ownerId, truck) {
  const look = { cls: 'truck', variant: truck.variant, paint: truck.paint || null, grime: truck.grime || 0 };
  raiseStand(bayId, ownerId, { kind: 'truck', id: truck.truckId, name: truck.name, look: { ...look, legacy: { variant: look.variant, paint: look.paint, grime: look.grime } } });
}
export const lower = (bayId) => lowerStand(bayId);
/** Driven off the floor: the lift is empty at once, nothing to watch go down. */
export const taken = (truckId) => standTaken(truckId, 'truck');

/**
 * The `room.vehicles` answer for one viewer: what stands on the lift and this viewer's own trucks downstairs
 * to call up. Undefined in a room that isn't a depot shed.
 */
export function roomVehicles(zoneId, player, { isDepot, shop = null }) {
  if (!isDepot(zoneId)) return undefined;
  const out = standVehicles(zoneId, player, 'truck');
  // what this depot's lot sells, so the lift's panel can offer it (`yard buy <id>`, the counter's own verb)
  const sale = out && shop ? shop(zoneId, player) : null;
  return sale?.length ? { ...out, shop: sale } : out;
}

export const _resetHoist = () => _resetStands();
