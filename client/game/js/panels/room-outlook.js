// THE VIEW FROM A ROOM'S WINDOWS. GLASS itself, live, on a canvas under the room's own. The room is drawn
// over it with its panes left transparent (gl/room.js `see`), the way a cabin is drawn over the world as a
// viewmodel, so you look through the glass at the city: its sea, its beacons, its traffic and its weather,
// all moving because GLASS is painting them. Nothing out there is drawn twice or copied.
//
// ⚠ IT PAINTS ON ITS OWN THREAD (room-outlook-worker.js). The canvas is handed to a worker, and `tick` sends it the
// newest camera whenever it's free, so the room keeps its frame rate whatever a paint costs. A turn can
// put the city a frame or two behind the room. Where a worker can't do it the paint runs here instead, with a
// budget: a steady view gets about half the time, and a moving one every frame, or a pane slides against its frame.
// ⚠ THE PICTURE IS SLID TO THE ROOM'S CAMERA (`register`). A paint lands late and at an uneven pace, so a turn made
// the city judder inside the window frames. Each frame the canvas moves by the turn made since its paint, which
// holds the two together. It can't fix the eye's own movement, but the city is far enough off for that to be small.
// ⚠ THE SLIDE IS A ROTATION, NOT A TRANSLATION (`turnWarp`). GLASS paints a plane, and turning moves a point off to the
// side further than one in the middle, so a flat shift was right at the screen's centre only: a window near the
// edge drifted against its frame through each paint and snapped back on the next, which read as a hitch in a turn.
// ⚠ THE PICTURE AND ITS SLIDE LAND TOGETHER. The worker hands each paint back as a bitmap and `tick` shows it and sets
// the slide in one task, so they reach the screen in one frame. A canvas the worker presented itself reached the
// compositor on its own clock, so every paint was a frame early or late against the slide, and a turn shook.
// ⚠ SO THE CANVAS IS BIGGER THAN THE ROOM (OVER_X, OVER_Y, and .rs-city in room-stage.css has to agree), or a slide
// shows its edge through a pane. It's wider than it's tall because a turn is what outruns a paint. GLASS sets both
// focals from the width, so the lens is worked out on the room's size and `k` shrinks by OVER_X alone, and a pixel
// covers the same angle as the room's on both axes.
//
// ⚠ TWO CAMERAS, ONE EYE. GLASS's lateral and vertical scales differ (windshield.js viewFocal, viewLatFocal),
// so `tick` hands the room GLASS's own projection scales and the two line up at any window size and any zoom.
// ⚠ NO GLASS IN VIEW, NO PAINT. Facing a wall or in the en-suite, `tick` is told so and the city costs nothing.
// ⚠ THE BUILDING ITSELF ISN'T DRAWN. eyeBase in room-view.js takes it off the centre tile. `self` alone doesn't
// do it: a tile with a building on it is drawn under you, so a roof can be landed on.

import { loadWindshield, paintWindshield, disposeWindshield, ensureWindshieldStyles, modelTopZAt, viewFocal, viewLatFocal } from './windshield-lazy.js';
import { eyeBase, lensOf, viewOf } from './room-view.js';

const OVER_X = 1.5, OVER_Y = 1.2;

// The picture painted at (yaw 0, pitch p0) as the camera at (yaw turn, pitch p1) would see it, all radians,
// with fx and fy its focal lengths in pixels: K R K⁻¹ as a CSS matrix3d about the picture's centre. Exact for
// a planar camera turning on the spot.
export function turnWarp(turn, p0, p1, fx, fy) {
  const basis = (a, p) => { const cp = Math.cos(p), sp = Math.sin(p), sa = Math.sin(a), ca = Math.cos(a); return [[ca, 0, -sa], [-sa * sp, cp, -ca * sp], [sa * cp, sp, ca * cp]]; };
  const A = basis(0, p0), B = basis(turn, p1), dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const K = [fx, -fy, 1], h = B.map((row, i) => A.map((col, j) => dot(row, col) * K[i] / K[j]));
  const n = (v) => String(+v.toPrecision(8));
  return `matrix3d(${[h[0][0], h[1][0], 0, h[2][0], h[0][1], h[1][1], 0, h[2][1], 0, 0, 1, 0, h[0][2], h[1][2], 0, h[2][2]].map(n).join(',')})`;
}

// msg is `room_outlook`: { gx, gy, storey, storeys, bearing, map, skyline, sky, roads, regions }. `host` is
// the element to go in, under the room's canvas. `onEye({ eye, eyeX, eyeY })` says where the eye is, once.
// `feed()` is what's moving now, { actors, contacts }, asked for at every paint.
export function createOutlook(msg, { host, onEye, onFail, feed }) {
  const id = 'room-outlook-' + Math.random().toString(36).slice(2, 8);
  let alive = true, el = null, painted = 0, K = null, worker = null, free = false, base = null, cost = 0, last = 0, was = '', peek = null, sent = null, shown = null, slid = '', pane = null, fresh = null;

  const canvas = () => {
    el?.remove();
    el = document.createElement('canvas');
    el.id = id;
    el.className = 'rs-city';
    el.setAttribute('aria-hidden', 'true');
    host.prepend(el);
    return el;
  };
  const fail = (why) => { console.warn('[room] no view from the window:', why); alive = false; onFail?.(); };
  const ready = (m) => { K = { fxK: m.fxK, vfK: m.vfK }; onEye?.({ eye: m.eye, eyeX: m.eyeX, eyeY: m.eyeY }); };

  // moves the canvas from the pose it was painted at to the room's, in the room's pixels
  const register = (look, k, lens, W, H) => {
    if (!look || !shown) return;
    const rw = W / OVER_X, rh = H / OVER_Y, fx = lens[0] * rw / 2, fy = lens[1] * rh / 2, keep = (v, m) => Math.max(-m, Math.min(m, v));
    // as far as the spare picture round the room goes, which an off-centre point uses up first
    const turn = keep(((look.yaw - shown.yaw + 540) % 360 - 180) * Math.PI / 180, Math.atan((W - rw) / 2 / fx / 1.6));
    const p1 = shown.pitch + keep(look.pitch - shown.pitch, Math.atan((H - rh) / 2 / fy / 1.6));
    const css = `scale(${(k / shown.k).toFixed(4)}) ${turnWarp(turn, shown.pitch, p1, fx, fy)}`;
    if (css !== slid) el.style.transform = slid = css;
  };

  // the fallback: the same paint, here
  function here() {
    worker?.terminate();
    worker = null; free = false; K = null;
    canvas();
    loadWindshield().then(() => {
      if (!alive) return;
      ensureWindshieldStyles();
      base = eyeBase(msg, modelTopZAt);
      ready({ eye: base.z, eyeX: base.x, eyeY: base.y, fxK: viewLatFocal(1000, null) / 500, vfK: viewFocal(1000, 1) / 1000 });
    }).catch((e) => fail(e?.message));
  }

  try {
    pane = canvas().getContext('bitmaprenderer');
    if (typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function' || !pane) throw new Error('no offscreen canvas');
    worker = new Worker(new URL('./room-outlook-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data: m }) => {
      if (m.type === 'ready') { ready(m); free = true; }
      else if (m.type === 'painted') { painted++; free = true; fresh?.bitmap.close(); fresh = { bitmap: m.bitmap, pose: sent }; }
      else if (m.type === 'peeked') peek?.(m.blob);
      else if (m.type === 'failed') { console.warn('[room] the view\'s worker failed:', m.why); here(); }
    };
    worker.onerror = (e) => { console.warn('[room] the view\'s worker failed:', e?.message); e?.preventDefault?.(); if (worker) here(); };
    worker.postMessage({ type: 'start', msg });
  } catch (e) { here(); }

  return {
    get painted() { return painted > 8; },   // past the provisional floor LUT, which shows the sea as land
    // what the worker's canvas holds, as a blob, for a harness
    peek: () => new Promise((res) => { peek = res; worker?.postMessage({ type: 'peek' }); }),
    // once a frame. `look` is { yaw (degrees on the compass), pitch (radians), fov (vertical degrees), at: [u, v], room: [w, d] }
    // or null with no glass in view. Returns the room's `lens` for this frame.
    tick(hour, wx, look) {
      if (!alive || !K) return null;
      if (fresh) {
        const b = fresh.bitmap;
        if (el.width !== b.width || el.height !== b.height) { el.width = b.width; el.height = b.height; }
        pane.transferFromImageBitmap(b); shown = fresh.pose; fresh = null;
      }
      const W = Math.max(2, el.clientWidth), H = Math.max(2, el.clientHeight), { k, lens } = lensOf(K.fxK, K.vfK, W / OVER_X, H / OVER_Y, look?.fov);
      if (!look && painted > 2) return lens;
      if (worker) {
        if (free) { free = false; sent = look ? { yaw: look.yaw, pitch: look.pitch, k } : null; worker.postMessage({ type: 'frame', hour, wx, look, fed: feed?.(), k: k / OVER_X, W, H }); }
        register(look, k, lens, W, H);
        return lens;
      }
      if (el.width !== W || el.height !== H) { el.width = W; el.height = H; }
      const pose = look ? [look.yaw, look.pitch, look.fov, look.at?.[0], look.at?.[1]].join() : '', t0 = performance.now();
      if (pose === was && t0 - last < cost * 2) return lens;
      was = pose; last = t0;
      try {
        paintWindshield(id, viewOf(msg, base, { hour, wx, look, fed: feed?.(), k: k / OVER_X }));
        painted++;
        cost += (performance.now() - t0 - cost) * 0.2;
      } catch (e) { fail(e?.message); }
      return lens;
    },
    // the weather's moved on
    setSky(sky) { msg.sky = { ...(msg.sky || {}), ...sky }; worker?.postMessage({ type: 'sky', sky }); },
    stop() {
      alive = false;
      fresh?.bitmap.close(); fresh = null;
      worker?.terminate();
      if (!worker) try { disposeWindshield(id); } catch { /* the renderer may never have loaded */ }
      el?.remove();
    },
  };
}
