// ROOM · A FLAT'S CONTROL PANEL ON ITS WALL (plugins/envcontrol). The panel's OS (envctl.js) laid onto the
// glass of the piece gl/room-envctl.js draws, the way a door's hololock card is laid (room-lock.js): a page
// bent onto four points of the room each frame (`quadMatrix`), so its words are sharp and its buttons are
// real buttons, and you work the flat from where you stand. Its ⧉ pops the same OS out into a window.
//
// It decides nothing. A touch on the sleeping glass is `panel`, and every button is the verb you'd type.
// The glass sleeps again when you walk away from it or leave it alone for a while.

import { facing, roomSees, HUNG_AT } from '../../../shared/room-layout.js';
import { quadMatrix } from './room-lock.js';
import { attachWall, detachWall } from './envctl.js';

// metres per pixel of the page (a hololock's card is 0.0015; this is finer, for its smaller words)
const M_PER_PX = 0.0012;
// the bezel's width, as gl/room-envctl.js draws it, and how far off the glass the page floats
const BEZEL = 0.016, OFF = 0.002;
// how near you have to be to touch it, to see its page at all, and how far away it goes back to sleep, metres;
// and how long it stays awake untouched
const REACH = 2.6, SEEN = 9, WANDER = 4.5, IDLE_MS = 120000;

/** The control panel of one open Stage, if its room has one. `project(p, w, h)` is the renderer's. */
export function createRoomEnvctl({ host, project }) {
  const layer = document.createElement('div');
  layer.className = 'rl-layer';
  host.appendChild(layer);
  const el = document.createElement('div');
  el.style.display = 'none';
  layer.appendChild(el);
  const view = attachWall(el);
  // a touch on the glass is the glass's: dragging its dimmer mustn't also turn your head
  for (const t of ['pointerdown', 'mousedown', 'touchstart', 'wheel']) el.addEventListener(t, (e) => { if (!el.classList.contains('envctl-far')) e.stopPropagation(); }, { passive: true });
  let L = null, quad = null, size = [300, 400], face = null, mid = null, hidden = true, far = null;

  // The room's panel, if it has one: the first piece dressed 'envctl'.
  function load(layout) {
    L = layout;
    const p = (L?.placed || []).find((x) => x.dress === 'envctl');
    if (!p) { quad = null; return; }
    const [fu, fv] = facing(p.turn), su = -fv, sv = fu, hw = p.w / 2 - BEZEL, z = p.d / 2 + OFF;
    const y0 = HUNG_AT + BEZEL, y1 = HUNG_AT + p.h - BEZEL;
    const P = (x, y, zz = z) => L.world(p.u + su * x + fu * zz, p.v + sv * x + fv * zz, y);
    quad = [P(-hw, y1), P(hw, y1), P(hw, y0), P(-hw, y0)];
    size = [Math.round((hw * 2) / M_PER_PX), Math.round((y1 - y0) / M_PER_PX)];
    el.style.width = size[0] + 'px'; el.style.height = size[1] + 'px';
    // where it is on the floor plan, and which way it looks, for whether you can see it
    mid = { local: [p.u + fu * 0.3, p.v + fv * 0.3], world: P(0, (y0 + y1) / 2, 0) };
    const out = P(0, 0, 1), back = P(0, 0, 0);
    face = [out[0] - back[0], out[2] - back[2]];
  }

  // Laid over its four points, every frame. `eye` is the camera's, `at` where you stand on the plan.
  function draw(w, h, eye, at) {
    if (!quad) { hide(); return; }
    const dist = Math.hypot(mid.world[0] - eye[0], mid.world[2] - eye[2]);
    // asleep again once you've walked off, or left it alone
    if (view.awake() && view.page !== 'welcome' && (dist > WANDER || performance.now() - view.touchedAt > IDLE_MS)) view.sleep();
    // read from the room's side only, with no wall in between
    const front = (eye[0] - mid.world[0]) * face[0] + (eye[2] - mid.world[2]) * face[1] > 0.02;
    const here = at || L.local(eye);
    if (!front || dist > SEEN || (here && !roomSees(L, here, mid.local))) { hide(); return; }
    const q = quad.map((p) => project(p, w, h));
    let m = null;
    if (q.every(Boolean)) {
      let pts = q.map((p) => [p.x, p.y]);
      const area = pts.reduce((s, p, i) => { const n = pts[(i + 1) % 4]; return s + p[0] * n[1] - n[0] * p[1]; }, 0);
      if (area < 0) pts = [pts[1], pts[0], pts[3], pts[2]];
      const tall = Math.hypot(pts[3][0] - pts[0][0], pts[3][1] - pts[0][1]);
      if (tall > 22 && pts.every((p) => Math.abs(p[0]) < 6 * w + 2000 && Math.abs(p[1]) < 6 * h + 2000)) m = quadMatrix(size[0], size[1], pts);
    }
    if (!m) { hide(); return; }
    if (hidden) { el.style.display = ''; hidden = false; }
    el.style.transform = m;
    // out of reach, it shows but takes no touches, so a click there still walks you to it
    const isFar = dist > REACH;
    if (far !== isFar) { far = isFar; el.classList.toggle('envctl-far', isFar); }
  }
  function hide() { if (!hidden) { el.style.display = 'none'; hidden = true; } }

  return {
    load, draw,
    get on() { return !!quad; },
    stop() { detachWall(view); layer.remove(); },
  };
}
