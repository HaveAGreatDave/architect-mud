// ROOM · A THING CLOSE UP: something on a stand you turn and lean into, as you would a trophy in a case (the Cup,
// gl/room-cup.js). While it's open the camera leaves your eyes and goes round the thing's upright axis: a drag across
// turns it, a drag up and down moves along it, the wheel takes you closer or further off, and Escape or the button
// steps you back. Your body stays where you were stood; the room is drawn from this camera (room-stage.js render).
//
// It decides nothing and sends nothing: what it looks at is `target()`, asked every frame, so a room rebuilt under it
// (a winner cut into the Cup) keeps the view, and a thing that's gone closes it.
//
// ⚠ THE LAYER TAKES EVERY POINTER EVENT. It's over the room's canvas and stops them there, so a drag that turns the
// Cup never turns your head or walks you, and `key` takes every key while it's open for the same reason.

import { loadCss } from '../../../shared/dom.js';

const CSS = await loadCss(new URL('./room-closeup.css', import.meta.url));
function ensureStyles() {
  if (document.getElementById('room-closeup-css')) return;
  const s = document.createElement('style');
  s.id = 'room-closeup-css'; s.textContent = CSS;
  document.head.appendChild(s);
}

const FOV = 38;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/**
 * `target()` is { c: [x, z] the axis in the world, y0, y1 its foot and top (world y), front (the world yaw you look
 * along to see its front), near, far (metres from the axis), ceil (the highest the eye goes, or null) } or null when
 * it's gone. `onClose` runs when it shuts.
 */
export function createCloseup({ host, target, onClose = null }) {
  ensureStyles();
  const layer = document.createElement('div');
  layer.className = 'rc-layer';
  layer.hidden = true;
  layer.innerHTML = `<div class="rc-bar"><b class="rc-name"></b><span>Drag to turn it and to move up and down it · scroll to look closer · arrows and W A S D too</span><button type="button" class="rc-back" title="Step back (Esc)">Step back</button></div>`;
  host.appendChild(layer);
  const nameEl = layer.querySelector('.rc-name'), bar = layer.querySelector('.rc-bar');
  // `goal` is where the camera is going, `now` where it is: a drag moves the goal and the camera eases after it
  let on = false, goal = null, cur = null, t = 0, drag = null;

  function open(name) {
    const T = target();
    if (!T) return false;
    nameEl.textContent = name || '';
    // a little above the middle, from in front, at arm's length
    goal = { yaw: T.front, h: T.y0 + (T.y1 - T.y0) * 0.62, d: clamp(0.62, T.near, T.far) };
    cur = { ...goal, d: Math.min(T.far, goal.d * 1.8) };
    t = 0; on = true; layer.hidden = false;
    return true;
  }
  function close() {
    if (!on) return;
    on = false; layer.hidden = true; drag = null; layer.classList.remove('rc-drag');
    onClose?.();
  }
  function nudge(dYaw = 0, dH = 0, zoom = 1) {
    const T = on && target();
    if (!T || !goal) return;
    goal.yaw += dYaw;
    goal.h = clamp(goal.h + dH, T.y0 - 0.05, T.y1 + 0.08);
    goal.d = clamp(goal.d * zoom, T.near, T.far);
  }

  // the drag: across turns it, up and down moves along it, further when you're further off
  const stop = (e) => e.stopPropagation();
  layer.addEventListener('pointerdown', (e) => {
    stop(e);
    if (bar.contains(e.target)) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    layer.setPointerCapture?.(e.pointerId);
    layer.classList.add('rc-drag');
  });
  layer.addEventListener('pointermove', (e) => {
    stop(e);
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    const k = (goal?.d || 0.6) / 0.6;
    nudge(-dx * 0.008, dy * 0.0016 * k);
  });
  const up = (e) => { stop(e); if (drag && e.pointerId === drag.id) { drag = null; layer.classList.remove('rc-drag'); } };
  layer.addEventListener('pointerup', up);
  layer.addEventListener('pointercancel', up);
  layer.addEventListener('click', stop);
  layer.addEventListener('wheel', (e) => { e.preventDefault(); stop(e); nudge(0, 0, e.deltaY > 0 ? 1.1 : 1 / 1.1); }, { passive: false });
  layer.querySelector('.rc-back').addEventListener('click', (e) => { stop(e); close(); });

  // every key while it's open, so nothing walks or acts behind it
  function key(e) {
    if (!on) return false;
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const k = String(e.key || '');
    if (k === 'Escape') { if (!e.repeat) close(); return true; }
    if (k === 'ArrowLeft' || k === 'a' || k === 'A' || k === 'q' || k === 'Q') nudge(0.12);
    else if (k === 'ArrowRight' || k === 'd' || k === 'D' || k === 'e' || k === 'E') nudge(-0.12);
    else if (k === 'ArrowUp' || k === 'w' || k === 'W') nudge(0, 0.025);
    else if (k === 'ArrowDown' || k === 's' || k === 'S') nudge(0, -0.025);
    else if (k === '=' || k === '+') nudge(0, 0, 1 / 1.12);
    else if (k === '-' || k === '_') nudge(0, 0, 1.12);
    return true;
  }

  // The camera: on a circle round the axis at the goal's distance, at the height it's looking at, lifted and tipped
  // down as it goes over the top, so past the bowl you look down into it and onto the emblem.
  function frame(now) {
    if (!on) return null;
    const T = target();
    if (!T) { close(); return null; }
    const dt = t ? Math.min(0.1, (now - t) / 1000) : 0.016, k = 1 - Math.exp(-dt * 9);
    t = now;
    cur.yaw += (goal.yaw - cur.yaw) * k; cur.h += (goal.h - cur.h) * k; cur.d += (goal.d - cur.d) * k;
    const over = clamp((cur.h - (T.y1 - 0.12)) / 0.2, 0, 1), tilt = 0.1 + over * 0.75;
    const look = [T.c[0], cur.h, T.c[1]];
    // the camera stands behind where it looks: yaw is the way it looks (gl/room.js roomView, 0 along +z)
    const hz = Math.cos(tilt) * cur.d;
    const eye = [look[0] - Math.sin(cur.yaw) * hz, look[1] + Math.sin(tilt) * cur.d, look[2] - Math.cos(cur.yaw) * hz];
    // never up through the lid of what it stands in: held under `ceil`, still looking at the same point
    let pitch = -tilt;
    if (T.ceil != null && eye[1] > T.ceil) { eye[1] = T.ceil; pitch = Math.atan2(look[1] - eye[1], hz); }
    return { eye, yaw: cur.yaw, pitch, fov: FOV, mode: 'free' };
  }

  return { open, close, key, frame, get on() { return on; }, dispose() { layer.remove(); } };
}
