// ── pad-catch — may the deck take us, or are we leaving? ─────────────────────────────────
//
// A rooftop helipad lands you by CATCH VOLUME: fly into the drawn column and the deck flies the
// last few seconds for you (cockpit.js → startRoofLanding). The hard part was never the capture,
// it is telling an ARRIVAL apart from a DEPARTURE, because a lift-off goes straight up through
// the pad's own column and looks identical to flying into it.
//
// ⚠ AND ON A TALL TOWER THAT IS NOT A MOMENT, IT IS A MINUTE. The column is `catchR` wide (0.45
// tiles) and, on the Solenne, 318 ft tall — so a helicopter climbing out at a healthy 800 fpm is
// inside it for 24 seconds, and at a gentle 400 fpm for 48. Holding station inside half a tile for
// that long is not something anybody does, and the old latch treated the first drift outside as
// "departed" and the drift back in as an arrival. The deck grabbed the climb-out and set it down.
//
// So the decision is three answers, not one:
//
//   inCol    — are we inside the drawn window at all
//   departed — a latch, and it needs MARGIN to close. If the edge you arm on is also the edge you
//              depart across, cyclic wander alone re-arms the column you are still climbing through.
//   armed    — inCol, departed, and NOT CLIMBING. This is the buffer that actually holds: a descent
//              or a level hover onto a deck is an arrival and going up is somebody leaving, and it
//              is a fact about the aircraft rather than a latch a stray frame can flip.
//
// Pure and dependency-free on purpose — the radius and the ceiling are the RENDERER's numbers and
// are passed in, so this file holds no second copy of the column you fly into. Gated headlessly by
// scripts/shapes/padcatch.mjs.

export const ROOF_CATCH_VS = 150;   // fpm — above this you are climbing away, not arriving
// Clear the radius by this much, or the ceiling by this many feet, to count as having departed.
// Every real approach comes from several tiles out, so the margin costs an arrival nothing.
export const ROOF_DEPART_R = 1.8, ROOF_DEPART_FT = 60;
// How far BELOW the pad still counts as being at it. Lower than this and you are past the building,
// which is a departure in the one direction a rooftop deck can never be approached from.
export const ROOF_UNDER_FT = 40;

// prev   — the departure latch as it stood last frame (true | false | undefined)
// prox   — { dist, padFt } from padProximity, or null when no pad is in the window
// ceilFt — the column's height above the deck, per pad (padCeilFt)
// s      — { onGround, altitude, vs } from the flight model
// catchR — ROOF_CATCH_R, the renderer's own column radius
export function padCatchStep(prev, prox, ceilFt, s, catchR) {
  if (!prox) return { departed: prev, inCol: false, armed: false };
  const top = prox.padFt + ceilFt, floor = prox.padFt - ROOF_UNDER_FT;
  const inCol = !s.onGround && prox.dist <= catchR && s.altitude <= top && s.altitude >= floor;
  // ⚠ AND AIR UNDER US. A frame where the roof probe finds a taller crown box beneath a drifting
  // climb sets `onGround` while `reportedAirborne` is still true from the frame before — which the
  // old test read as leaving the very deck we are standing on.
  const departed = (!s.onGround && (prox.dist > catchR * ROOF_DEPART_R
    || s.altitude > top + ROOF_DEPART_FT || s.altitude < floor)) ? true : prev;
  // ⚠ POSITIVE, NOT MERELY "NOT FALSE". A pad we have never been outside of has not been departed,
  // and the latch is undefined on any frame where the parked-on-a-deck seed never ran — which the
  // old `!== false` read as clearance to grab the climb-out.
  return { departed, inCol, armed: inCol && departed === true && (s.vs || 0) <= ROOF_CATCH_VS };
}
