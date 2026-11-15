// Painted lenses: a camera somebody has sprayed over.
//
// The paint lives on the device's own row, in `security_devices.status_flags.painted`
// ({ by, handle, at, maint }), so it's in the device snapshot every reader already
// holds (allDevices in index.js) and survives a restart. Nothing here queries: the
// readers are the witness gate and the 5 s hub tick, and both are hot.
//
// `maint` is set when the camera was on the police network at the moment it was
// painted. A city crew comes round for those: the paint counts as gone once
// LENS_MAINT_GAME_MS of game time has passed, read lazily here, and the 10-minute
// sweep in index.js clears the row and says so in the room. A private camera has
// no crew. Its owner, or anybody with a rag and solvent, has to `clean` it.

import { gameMsToReal } from '../../server/engine/gametime.js';

// Four game hours. Long enough that blinding a PD camera buys you an evening on
// that corner, short enough that it isn't a permanent hole in the grid.
export const LENS_MAINT_GAME_MS = 4 * 60 * 60 * 1000;

// What a painted camera shows: the hub tile, the TV patch, the flat's door panel.
export const PAINTED_FRAME = 'Paint on the lens. A smear of light where the room was.';

export function paintOf(d) {
  const p = d?.status_flags?.painted;
  return p && typeof p === 'object' ? p : null;
}

// Is this lens painted right now? Sync and query-free: it's read by the witness gate.
export function isLensPainted(d, now = Date.now()) {
  const p = paintOf(d);
  if (!p) return false;
  if (p.maint && Number.isFinite(p.at) && now - p.at >= gameMsToReal(LENS_MAINT_GAME_MS)) return false;
  return true;
}

// A police lens whose paint the crew has had time to deal with: the row still says
// painted, but isLensPainted already says it isn't. The sweep tidies these.
export function lensDueForCrew(d, now = Date.now()) {
  return !!paintOf(d)?.maint && !isLensPainted(d, now);
}
