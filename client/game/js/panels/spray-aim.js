// WHICH 3-D VIEW A SPRAY CAN IS AIMED FROM, if any. A leaf, so the Room Stage, the street view and
// the can's dialog can all reach it without pulling in each other.
//
// A view that's up says so with `setSprayStage(host)` and takes it back with `clearSprayStage(host)`.
// The can's dialog (spraycan.js) asks `sprayStage()` when SPRAY IT is pressed: with a host it runs the
// spray session (spray-session.js) over the view and sends at the end of it, without one it sends at
// once, as the text rungs always have.
//
// host: {
//   label    the wall it's at, for the session's corner ('the wall', 'the street')
//   ground   'plaster' or 'brick', what the session's close-up is painted on
//   aim()    where on the wall the can points ({ u, v, y, n }, room-tags.js aimWall), or null
//   bake(text, runs, face)          the piece as this wall will have it (optional; the can's preview otherwise)
//   preview(canvas | null, fresh, length)   the paint so far, on the real wall; null takes it down
//   done()   the session finished and the tag's been sent
// }

let host = null;

export function setSprayStage(h) { host = h || null; }
export function clearSprayStage(h) { if (!h || host === h) host = null; }
export const sprayStage = () => host;
