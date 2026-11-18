// ROOM · TALKING TO SOMEBODY: while a conversation is open on the Room Stage, the camera leaves your eyes and comes in
// on the face of who you're talking to, in the room you're both stood in, and the dialogue panel (dialogue.js) sits
// along the foot of that picture as a lower third. Their mouth moves to ORACLE's voice the way it does for any line
// (npc-bubbles.js `say` -> `npc:voice` -> room-stage.js `mouthOf`), so the shot needs nothing of its own for that.
//
// It decides nothing and sends nothing. dialogue.js says who you're talking to (`npc:talk`), the Stage says where
// their head is and where your eye is, and this works out a camera between them and eases to it and back. Somebody
// it can't find in the room (they're next door, or the Stage isn't up) leaves the panel as it always was.

import { loadCss } from '../../../shared/dom.js';

const CSS = await loadCss(new URL('./room-talk.css', import.meta.url));
function ensureStyles() {
  if (document.getElementById('room-talk-css')) return;
  const s = document.createElement('style');
  s.id = 'room-talk-css'; s.textContent = CSS;
  document.head.appendChild(s);
}

const FOV = 32;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * `head(name)` is their head in the world ([x, y up, z]) or null; `unit` is metres per room unit's metre (1, or feet
 * per metre in a room laid out in feet). `frame(now, seat)` gives the camera, or null when the shot is off.
 */
export function createTalkShot({ head, unit = () => 1 }) {
  ensureStyles();
  let who = null, cur = null, t = 0, leaving = 0;

  const setLive = (on) => document.body.classList.toggle('room-talking', on);

  function set(name) {
    if (name === who) return;
    who = name || null;
    if (!who && cur) leaving = performance.now();
    if (!who) setLive(false);
  }

  // where the camera goes for them: a little to one side of the line from you to them, at their eye height, close
  // enough for head and shoulders, their face in the upper third so the panel along the foot never covers it
  function goalFor(H, seat) {
    const m = unit();
    const dx = H[0] - seat.eye[0], dz = H[2] - seat.eye[2], D = Math.hypot(dx, dz) || 1;
    const fx = dx / D, fz = dz / D;
    const d = clamp(D * 0.7, 1.0 * m, 1.35 * m);
    const side = 0.16 * m;
    const eye = [H[0] - fx * d + fz * side, H[1] + 0.03 * m, H[2] - fz * d - fx * side];
    const look = [H[0], H[1] - 0.1 * d, H[2]];
    const hz = Math.hypot(look[0] - eye[0], look[2] - eye[2]);
    return { eye, yaw: Math.atan2(look[0] - eye[0], look[2] - eye[2]), pitch: Math.atan2(look[1] - eye[1], hz), fov: FOV };
  }

  function ease(goal, k) {
    for (let i = 0; i < 3; i++) cur.eye[i] += (goal.eye[i] - cur.eye[i]) * k;
    cur.yaw += wrap(goal.yaw - cur.yaw) * k;
    cur.pitch += (goal.pitch - cur.pitch) * k;
    cur.fov += (goal.fov - cur.fov) * k;
  }

  function frame(now, seat) {
    const dt = t ? Math.min(0.1, (now - t) / 1000) : 0.016;
    t = now;
    const H = who ? head(who) : null;
    if (H) {
      if (!cur) cur = { eye: [...seat.eye], yaw: seat.yaw, pitch: seat.pitch || 0, fov: seat.fov };
      leaving = 0;
      ease(goalFor(H, seat), 1 - Math.exp(-dt * 5));
      setLive(true);
      return { eye: cur.eye, yaw: cur.yaw, pitch: cur.pitch, fov: cur.fov, mode: 'free' };
    }
    setLive(false);
    if (!cur) return null;
    // back to your own eyes, quickly, then off
    if (!leaving) leaving = now;
    ease({ eye: seat.eye, yaw: seat.yaw, pitch: seat.pitch || 0, fov: seat.fov }, 1 - Math.exp(-dt * 10));
    if (now - leaving > 450) { cur = null; leaving = 0; return null; }
    return { eye: cur.eye, yaw: cur.yaw, pitch: cur.pitch, fov: cur.fov, mode: 'free' };
  }

  // the way somebody stood talking to you turns: to face you
  function faceYou(name, at, seat) {
    if (!who || name !== who || !at) return null;
    // a body faces along (sin yaw, cos yaw) in the world (gl/room-people.js AZ)
    return Math.atan2(seat.eye[0] - at[0], seat.eye[2] - at[2]);
  }

  return { set, frame, faceYou, get who() { return who; }, dispose() { setLive(false); who = null; cur = null; } };
}
