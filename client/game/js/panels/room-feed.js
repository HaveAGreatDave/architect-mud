// ROOM · A SECURITY CAMERA'S PICTURE ON A FLAT'S DOOR PANEL (plugins/envcontrol). The panel's Security page
// (envctl.js) used to show the door camera as a line of text. With the Room Stage up and the landing drawn
// through the flat's door (it's a room next door, docs/proposals/building-stage.md), the renderer draws the
// scene again from the camera's eye a few times a second (gl/room.js `light.feed`) and the panel shows that.
//
// It decides nothing. Whether the camera can see at all (painted over, jammed, dark) is the server's, on the
// panel's state; this only asks for a picture when that state says there's one to have. Anywhere the landing
// isn't drawn (the panel popped out in another room, no Stage at all) the page keeps its line of text.

import { feedWanted, feedPixels } from './envctl.js';

// a picture every this many milliseconds, at this size: enough for a door camera, and the read back is small
const FEED_MS = 200, FEED_W = 320, FEED_H = 200;
// where the camera hangs: over the flat's door on the landing side, a little out from the wall, tipped down
// at whoever's stood at the door, with a wide lens
const OUT = 0.25, UP = 2.35, PITCH = -0.42, FOV = 92;

/**
 * The camera's eye in the scene: on the landing (`L`, laid out where the Stage drew it) over its doorway to
 * room `flat`, looking out across the landing. Null when the landing has no opening to that room.
 */
export function doorCamEye(L, flat) {
  const o = (L?.spec?.openings || []).find((x) => x.to === flat && ['front', 'back', 'left', 'right'].includes(x.wall));
  if (!o || !L.bounds) return null;
  const [u0, u1, v0, v1] = L.bounds, c = (o.a + o.b) / 2;
  const at = o.wall === 'front' ? [c, v0 + OUT] : o.wall === 'back' ? [c, v1 - OUT] : o.wall === 'left' ? [u0 + OUT, c] : [u1 - OUT, c];
  const step = o.wall === 'front' ? [0, 1] : o.wall === 'back' ? [0, -1] : o.wall === 'left' ? [1, 0] : [-1, 0];
  const y = Math.min(UP, (L.spec.h || 2.6) - 0.15);
  const p = L.world(at[0], at[1], y), q = L.world(at[0] + step[0], at[1] + step[1], y);
  return { eye: p, yaw: Math.atan2(q[0] - p[0], q[2] - p[2]), pitch: PITCH, fov: FOV };
}

/**
 * What to put on the renderer's `light.feed` this frame, or null. `here` is the room the Stage is in,
 * `nextDoor` the rooms drawn through its doorways ({ zone, L }), `state` this Stage's own { at }.
 */
export function feedRequest(now, here, nextDoor, state) {
  if (now - (state.at || 0) < FEED_MS) return null;
  const want = feedWanted();
  if (!want) return null;
  const n = (nextDoor || []).find((x) => x.zone === want.zone && x.L);
  const cam = n ? doorCamEye(n.L, here) : null;
  if (!cam) return null;
  state.at = now;
  return { cam, w: FEED_W, h: FEED_H, empty: want.empty, out: feedPixels };
}
