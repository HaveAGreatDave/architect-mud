// How high an aircraft is, in the tiles the world is drawn in.
//
// The canopy puts the eye at `eh + climbLift * height`, where height is sqrt(altitude / 3000 ft)
// capped at 1 (windshield.js, cockpit.js). Anything that has to compare an aircraft with something
// else in the sky, like a bird strike, needs that same mapping, and a second copy of the numbers
// in the server would be a bird the pilot flew through on screen and missed on the server. The
// renderer's RENDER_TUNE defaults are read from here for the same reason. The curve itself is
// heightToZ in world-scale.js; this file is the part of it that stops at the top, the eye.
import { EYE_Z, CLIMB_Z, CURVE_TOP_FT } from './world-scale.js';

export const FLIGHT_EYE_H = EYE_Z;          // tiles, the eye on the ground
export const FLIGHT_CLIMB_LIFT = CLIMB_Z;   // tiles added across the height scale
export const FLIGHT_HEIGHT_FT = CURVE_TOP_FT;   // the altitude at which the height scale reaches 1

/** The canopy's 0..1 height for an altitude in feet. */
export const flightHeight = (ft) => Math.min(1, Math.sqrt(Math.max(0, ft || 0) / FLIGHT_HEIGHT_FT));

/** The aircraft's height above the ground in tiles, as the canopy draws it. */
export const altitudeTiles = (ft, eh = FLIGHT_EYE_H, lift = FLIGHT_CLIMB_LIFT) => eh + lift * flightHeight(ft);
