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
import { isResidentOf } from '../../server/engine/apartments.js';

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

export const commands = {};

export const _test = { residentsOnlyGate, DEFAULT_DENY };

console.log('[residency] Plugin loaded.');
