/**
 * residency — "residents only" as a law.
 *
 * A room carrying `flags.residents_only: "<building name>"` may only be entered
 * by someone who holds a unit in that building. That's the whole plugin: one
 * move gate over the engine's `isResidentOf()` query (which reads the in-memory
 * apartments cache, so no DB round trip on a step).
 *
 * The shipped use is the Solenne Residences' private roof pad — a helipad the
 * tower's residents get and nobody else does. Any future amenity floor (a
 * residents' spa, a members' vault) inherits it by carrying the flag; there is
 * nothing to author but the string.
 *
 * The prose is content: an optional `flags.residents_only_deny` on the same tile
 * replaces the default refusal line, so each building can be turned away in its
 * own voice.
 *
 * Note the elevator: a floor selection is a teleport, not a step, so the
 * elevator plugin runs the same gate chain before it seals the doors — a gated
 * floor is refused at the panel rather than the doorway.
 */
import { registerMoveGate } from '../../server/engine/movement-gates.js';
import { isResidentOf, playerControlsApt } from '../../server/engine/apartments.js';
import { getApartment } from '../../server/engine/world.js';

const DEFAULT_DENY = 'A discreet reader blinks red and holds. Residents only.';

// The gate proper. Undefined = not our business (the overwhelmingly common case,
// so this costs one flag read per step).
export function residentsOnlyGate({ player, to }) {
  const building = to?.flags?.residents_only;
  if (!building) return;
  if (['admin', 'dev'].includes(player?.role)) return;
  if (isResidentOf(player, building)) return;
  return { block: true, message: to.flags.residents_only_deny || DEFAULT_DENY };
}

registerMoveGate(residentsOnlyGate, 'residency:residents-only');

// A room private to one flat: `flags.private_to: "<the flat's zone id>"`. The Solenne's whole-floor flats are
// entered from a landing the lift opens onto, and their east rooms and the floors up their stairs are off that
// landing or the flat, so the landing and those rooms carry the flat's id. Only whoever holds the flat (or a corp
// that does, playerControlsApt) gets past it; a flat nobody holds is open, so it can be seen and rented. The lift runs
// the same gate, so a private floor is refused at the panel. RAM only: the apartments cache, no query.
const PRIVATE_DENY = 'The doors stay shut. A small screen says this floor is private.';
export function privateToGate({ player, to, getApt = getApartment }) {
  const flat = to?.flags?.private_to;
  if (!flat) return;
  if (['admin', 'dev'].includes(player?.role)) return;
  const apt = getApt(flat);
  if (!apt?.owner_id || playerControlsApt(player, apt)) return;
  return { block: true, message: to.flags.private_to_deny || PRIVATE_DENY };
}
registerMoveGate(privateToGate, 'residency:private-to');

export const commands = {};

export const _test = { residentsOnlyGate, DEFAULT_DENY, privateToGate, PRIVATE_DENY };

console.log('[residency] Plugin loaded.');
