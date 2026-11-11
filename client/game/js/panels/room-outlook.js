// THE VIEW FROM A ROOM'S WINDOWS. GLASS itself: the city round the building, painted six times from one fixed eye
// (the room's front, right, back and left, then down and up, each a 90° square) and handed to the room's renderer
// as one picture, which looks each pane's pixel up by its direction (gl/room.js, uMode 5). So the city is placed in
// the world: turning and walking move you, never it, and nothing is repainted to follow your head.
//
// ⚠ IT PAINTS ON ITS OWN THREAD (room-outlook-worker.js), one face at a time: all six as soon as it's up, then, while
// there's glass in view, as fast as the worker goes, the faces you're looking at first (`pick`). One face every
// 250 ms put the traffic at a frame a second. A face is repainted from the same pose, so a refresh never moves
// anything. Where a worker can't do it the paint runs here instead.
// ⚠ THE DOWN AND UP FACES ARE PITCHED TILT (1.45), NOT 90°: GLASS turns no further. A 90° face that far down still
// covers straight down. With only the four level faces, looking down off a high floor ran off their bottoms and the
// street below smeared into streaks.
// ⚠ A FACE IS 90° EACH WAY. GLASS's lateral and vertical scales differ (windshield.js viewFocal, viewLatFocal), so
// a face's width is chosen to make its two projection scales equal (`face`); what a rounding leaves goes to the
// shader as uPanoLens.
// ⚠ AN EARLIER VERSION PAINTED ONE VIEW TO MATCH THE ROOM'S CAMERA IN THE WORKER and slid it to cover the paint's lag.
// However it was tuned, the late picture never sat still. `live` (below) paints to the room's camera in the same frame
// as the room, so there's no lag to cover; never paint to the camera a frame late again.
// ⚠ NO GLASS IN VIEW, NO REFRESH. Facing a wall or in the en-suite, `tick` is told so and the city costs nothing.
// ⚠ THE BUILDING ITSELF ISN'T DRAWN. eyeBase in room-view.js takes it off the centre tile. `self` alone doesn't
// do it: a tile with a building on it is drawn under you, so a roof can be landed on.

import { loadWindshield, paintWindshield, disposeWindshield, ensureWindshieldStyles, modelTopZAt, viewFocal, viewLatFocal } from './windshield-lazy.js';
import { eyeBase, lensOf, viewOf } from './room-view.js';

const FACE_PX = 1024;      // a face's height in pixels: 90° over the room's screen height, so 512 showed soft
const LIVE_SLOW_MS = 9, LIVE_FAST_MS = 5, LIVE_MIN_SCALE = 0.6, LIVE_STILL_MS = 33;
// ⚠ A MACHINE THAT CAN'T AFFORD LIVE GIVES IT UP (`slow`, room-stage.js `toFaces`). Shrinking the canvas only helps
// a GPU that's short of pixels; the city's cost is mostly the main thread building it, and that didn't move from
// 1600 px wide to 400. So past LIVE_GIVE_UP_MS a paint at the smallest scale, for LIVE_GIVE_UP_N paints in a row
// (an occasional slow one is forgiven a step at a time), live says it's slow, and in the meantime it paints no
// faster than every LIVE_SLOW_EVERY_MS so the room keeps its frame rate while the six faces come.
const LIVE_GIVE_UP_MS = 14, LIVE_GIVE_UP_N = 30, LIVE_SLOW_EVERY_MS = 30;
const FACES = 6;           // front, right, back, left, down, up
const TILT = 1.45;         // the down and up faces' pitch: as far as GLASS turns (windshield.js clamps at 1.45)
const STALE_EVERY = 5;     // every this many paints, the face longest unpainted, seen or not
// face i's pose about the room's bearing: [yaw offset in degrees, pitch in radians]
const POSE = [[0, 0], [90, 0], [180, 0], [270, 0], [0, -TILT], [0, TILT]];
export const PANO_TILT = TILT;

// A worker already loading the renderer, for the next view to take (room-outlook-worker.js `warm`). The room's
// Stage calls this as soon as `room_view` says the room has a view, so the seconds of loading run beside the room's
// own build instead of after `room_outlook`. One at most; an unclaimed one is dropped after WARM_MS.
let warmWorker = null, warmTimer = 0;
const WARM_MS = 30000;
export function warmOutlook() {
  if (warmWorker || typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function') return;
  try {
    warmWorker = new Worker(new URL('./room-outlook-worker.js', import.meta.url), { type: 'module' });
    warmWorker.postMessage({ type: 'warm' });
    warmTimer = setTimeout(() => { warmWorker?.terminate(); warmWorker = null; }, WARM_MS);
  } catch { warmWorker = null; }
}
function takeWarm() {
  const w = warmWorker;
  warmWorker = null; clearTimeout(warmTimer);
  return w || new Worker(new URL('./room-outlook-worker.js', import.meta.url), { type: 'module' });
}

// msg is `room_outlook`: { gx, gy, storey, storeys, bearing, map, skyline, sky, roads, regions }. `host` is
// the element the hidden paint canvas goes in. `onEye({ eye, eyeX, eyeY })` says where the eye is, once.
// `onPano(i, picture, lens)` hands the room face i (0 front, 1 right, 2 back, 3 left). `feed()` is what's moving now.
// ⚠ ONE VIEW FOR A WHOLE BUILDING. Starting GLASS costs seconds (a fresh worker loads the renderer and builds its
// tables), so a Stage that closes onto the next room of the same building hands its view on (`adopt`) instead of
// stopping it, and `place` moves the eye to the new room. Every room of a building stands on the same tile, so
// the map it was started with is still the right one.
// ⚠ `live` IS THE ONE-WORLD VIEW, AND THE DEFAULT ON A DESKTOP (room-stage.js). The city is painted here, on the main
// thread, every frame there's glass in view, from exactly the room's eye: where you stand, how high, your yaw, pitch and
// lens. The room is drawn over it with its panes as holes (gl/room.js `see`) through GLASS's own projection (the
// lens `tick` returns). So nothing out there is a picture: near buildings move past the glass as you walk, and nothing
// lags a turn. It costs a GLASS frame a frame, what the street on foot already costs. Without `live` it's the six
// faces painted in the worker, for a device that can't afford that.
export function createOutlook(msg, { host, onEye, onFail, onPano, feed, live = false }) {
  const id = 'room-outlook-' + Math.random().toString(36).slice(2, 8);
  let alive = true, el = null, painted = 0, K = null, worker = null, free = false, base = null, peek = null, fresh = null;
  let F = null, next = 0, filled = 0, sentFace = 0, nPaint = 0, lastAt = new Array(FACES).fill(0), postedAt = 0, lag = 33, gl = true;
  const faces = [];

  const canvas = () => {
    el?.remove();
    el = document.createElement('canvas');
    el.id = id;
    el.className = 'rs-city';
    // live, it's the view under the room, the room's own size; otherwise a hidden page for the faces
    if (live) Object.assign(el.style, { left: '0', top: '0', width: '100%', height: '100%' });
    else el.style.visibility = 'hidden';
    el.setAttribute('aria-hidden', 'true');
    host.prepend(el);
    return el;
  };
  const fail = (why) => { console.warn('[room] no view from the window:', why); alive = false; onFail?.(); };
  const ready = (m) => { K = { fxK: m.fxK, vfK: m.vfK }; onEye?.({ eye: m.eye, eyeX: m.eyeX, eyeY: m.eyeY }); };
  // a face's size and lens: 90° tall, and wide enough to be 90° across as well
  const face = () => {
    const fh = FACE_PX, fw = Math.max(64, Math.round(K.fxK * fh / (2 * K.vfK))), { k, lens } = lensOf(K.fxK, K.vfK, fw, fh, 90);
    return { fw, fh, k, lens };
  };
  const give = (i, pic) => {
    filled = Math.min(FACES, filled + 1); lastAt[i] = performance.now();
    try { onPano?.(i, pic, F.lens); } catch (e) { console.warn('[room] the city face', e?.message); }
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
    if (live) throw new Error('live: painted here');
    canvas();
    if (typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function') throw new Error('no offscreen canvas');
    worker = takeWarm();
    worker.onmessage = ({ data: m }) => {
      if (m.type === 'ready') { base = { x: m.eyeX, y: m.eyeY, z: m.eye }; ready(m); free = true; }
      else if (m.type === 'placed') { base = { x: m.eyeX, y: m.eyeY, z: m.eye }; onEye?.({ eye: m.eye, eyeX: m.eyeX, eyeY: m.eyeY }); }
      else if (m.type === 'painted') { painted++; if (postedAt) lag += (performance.now() - postedAt - lag) * 0.3; free = true; fresh?.bitmap.close(); fresh = { bitmap: m.bitmap, face: sentFace }; }
      else if (m.type === 'peeked') peek?.(m.blob);
      else if (m.type === 'gl') { gl = m.on; if (m.on) console.info('[room] the view from the window is back on GLASS 2'); else console.warn('[room] the view from the window dropped to GLASS 1:', m.why || 'no reason given', '- trying GLASS 2 again shortly'); }
      else if (m.type === 'failed') { console.warn('[room] the view\'s worker failed:', m.why); here(); }
    };
    worker.onerror = (e) => { console.warn('[room] the view\'s worker failed:', e?.message); e?.preventDefault?.(); if (worker) here(); };
    worker.postMessage({ type: 'start', msg });
  } catch (e) { here(); }
  let lens0 = null;
  // ⚠ LIVE COSTS A GLASS FRAME A FRAME, so it's kept in hand three ways. The canvas is drawn at `scale` of the room's
  // size and stretched (the lens depends on the shape alone, so nothing moves), and `scale` follows what a paint costs:
  // down when one takes over LIVE_SLOW_MS, back up when they're under LIVE_FAST_MS. A head that hasn't moved is
  // repainted every LIVE_STILL_MS, not every frame: only what's moving out there changes, and at 30 a second it
  // reads as smooth. And with no glass in view there's no paint at all.
  let scale = 1, cost = 0, lastPose = '', lastPaint = 0, slowN = 0;
  function livePaint(hour, wx, look, warming) {
    const W = Math.max(2, el.clientWidth), H = Math.max(2, el.clientHeight), { k, lens } = lensOf(K.fxK, K.vfK, W, H, look?.fov ?? lens0?.fov);
    if (look) lens0 = { fov: look.fov };
    if (!look && painted > 2) return lens;
    const t0 = performance.now(), pose = look ? [look.yaw, look.pitch, look.fov, look.at?.[0], look.at?.[1]].join() : '';
    // a still head is painted at 30 a second only on a machine already shrinking the canvas: where a paint is cheap,
    // every frame, or the traffic out there ran at half the room's rate and paint/skip frames came uneven (a hitch)
    if (!warming && scale < 1 && pose === lastPose && t0 - lastPaint < LIVE_STILL_MS) return lens;
    if (!warming && scale <= LIVE_MIN_SCALE && cost > LIVE_SLOW_MS && t0 - lastPaint < LIVE_SLOW_EVERY_MS) return lens;
    lastPose = pose; lastPaint = t0;
    const cw = Math.max(2, Math.round(W * scale)), ch = Math.max(2, Math.round(H * scale));
    if (el.width !== cw || el.height !== ch) { el.width = cw; el.height = ch; }
    try { paintWindshield(id, viewOf(msg, base, { hour, wx, look, fed: feed?.(), k })); painted++; } catch (e) { fail(e?.message); return lens; }
    cost += (performance.now() - t0 - cost) * 0.15;
    // a step at a time, and only past a margin, so the canvas isn't reallocated every frame
    if (!warming && painted > 20) {
      if (cost > LIVE_SLOW_MS && scale > LIVE_MIN_SCALE) scale = Math.max(LIVE_MIN_SCALE, scale - 0.1);
      else if (cost < LIVE_FAST_MS && scale < 1) scale = Math.min(1, scale + 0.05);
      slowN = scale <= LIVE_MIN_SCALE && cost > LIVE_GIVE_UP_MS ? slowN + 1 : Math.max(0, slowN - 1);
    }
    return lens;
  }

  // the face to paint next: the one longest unpainted of those in view, or now and then of all of them
  const pick = (look) => {
    const ya = ((look.yaw - (msg.bearing || 0)) * Math.PI) / 180, cp = Math.cos(look.pitch || 0);
    const fwd = [Math.cos(ya) * cp, Math.sin(ya) * cp, Math.sin(look.pitch || 0)];
    let best = -1, bestAt = Infinity;
    for (let i = 0; i < FACES; i++) {
      const a = (POSE[i][0] * Math.PI) / 180, q = Math.cos(POSE[i][1]), f = [Math.cos(a) * q, Math.sin(a) * q, Math.sin(POSE[i][1])];
      const seen = nPaint % STALE_EVERY === 0 || fwd[0] * f[0] + fwd[1] * f[1] + fwd[2] * f[2] > 0.1;
      if (seen && lastAt[i] < bestAt) { best = i; bestAt = lastAt[i]; }
    }
    return best < 0 ? 0 : best;
  };
  // the first round: the face you're looking through before the ones behind you, so the glass in view isn't empty
  // for five paints; then the unpainted rest in turn. `lastAt` 0 is a face not painted since the last `place`.
  const firstPass = (look) => {
    if (look) { const p = pick(look); if (!lastAt[p]) return p; }
    for (let k = 0; k < FACES; k++) { const j = (next + k) % FACES; if (!lastAt[j]) return j; }
    return next;
  };

  return {
    get live() { return live; },
    // live and too dear for this machine: the room should swap to the six faces (LIVE_GIVE_UP_MS)
    get slow() { return live && slowN >= LIVE_GIVE_UP_N; },
    // where it's looking from now (`place` replaces it), for a view of the same place started in its stead
    get spot() { return msg; },
    // live: a paint with no glass in view, for warming the city where you're about to be (a lift's next floor, behind
    // its shut doors), so its first frames have built what they need before anybody sees them
    warm(hour, wx, look) { if (alive && K && live) livePaint(hour, wx, look, true); },
    get painted() { return live ? painted > 8 : filled >= FACES && painted > 8; },   // every face, and past the provisional floor LUT
    // all four faces up: the loading veil waits for this, not for `painted`
    get shown() { return live ? painted > 0 : filled >= FACES; },
    // for a harness: how many paints, a paint's round trip in ms, and how many faces are up
    get stats() { return { paints: painted, lag: Math.round(lag), worker: !!worker, gl, faces: filled, live, scale, cost: +cost.toFixed(1) }; },
    // what the worker's canvas holds, as a blob, for a harness
    peek: () => new Promise((res) => { peek = res; worker?.postMessage({ type: 'peek' }); }),
    // once a frame. `look` is non-null while there's glass in view. Returns null: the room keeps its own lens.
    tick(hour, wx, look) {
      if (!alive || !K) return null;
      if (live) return livePaint(hour, wx, look, false);
      F ||= face();
      if (fresh) { const b = fresh.bitmap, i = fresh.face; fresh = null; faces[i]?.close?.(); faces[i] = b; give(i, b); }
      const t = performance.now();
      // every face once, then, while there's glass in view, as fast as the worker goes: the faces you're looking
      // at first, so what moves out there moves at the frame rate, and the rest now and then
      if (!(filled < FACES || look)) return null;
      const i = filled < FACES ? firstPass(look) : pick(look);
      const pose = { yaw: (((msg.bearing || 0) + POSE[i][0]) % 360 + 360) % 360, pitch: POSE[i][1], fov: 90, at: [0, 0], room: [1, 1] };
      if (worker) {
        if (!free) return null;
        free = false; postedAt = t; sentFace = i; next = (i + 1) % FACES; nPaint++;
        worker.postMessage({ type: 'frame', hour, wx, look: pose, fed: feed?.(), k: F.k, W: F.fw, H: F.fh });
        return null;
      }
      if (el.width !== F.fw || el.height !== F.fh) { el.width = F.fw; el.height = F.fh; }
      postedAt = t; next = (i + 1) % FACES; nPaint++;
      try { paintWindshield(id, viewOf(msg, base, { hour, wx, look: pose, fed: feed?.(), k: F.k })); painted++; give(i, el); } catch (e) { fail(e?.message); }
      return null;
    },
    // the tile this view was started on: a room on another tile needs a view of its own
    get tile() { return `${msg.gx},${msg.gy}`; },
    // the next room's Stage takes this view over: its host, who it tells, and the faces already painted
    adopt(nx) {
      host = nx.host; onEye = nx.onEye; onFail = nx.onFail; onPano = nx.onPano; feed = nx.feed;
      if (el) host.prepend(el);
      if (K && base) onEye?.({ eye: base.z, eyeX: base.x, eyeY: base.y });
      if (F && worker && filled >= FACES) faces.forEach((b, i) => { if (b) try { onPano?.(i, b, F.lens); } catch { /* the room's renderer is gone */ } });
    },
    // a new room of the same building: where it stands, the way it faces, how high. All four faces again.
    place(m) {
      // the same storey facing the same way keeps its faces until they're repainted; anything else starts again
      const same = m.bearing === msg.bearing && m.storey === msg.storey;
      msg = { ...msg, storey: m.storey, storeys: m.storeys, bearing: m.bearing, frame: m.frame || null, sky: { ...(msg.sky || {}), ...(m.sky || {}) } };
      if (!same) { filled = 0; lastAt.fill(0); }
      next = 0;
      if (worker) { worker.postMessage({ type: 'place', msg: { storey: msg.storey, storeys: msg.storeys, bearing: msg.bearing, frame: msg.frame } }); return; }
      if (base) { base = eyeBase(msg, modelTopZAt); onEye?.({ eye: base.z, eyeX: base.x, eyeY: base.y }); }
    },
    // the weather's moved on
    setSky(sky) { msg.sky = { ...(msg.sky || {}), ...sky }; worker?.postMessage({ type: 'sky', sky }); },
    stop() {
      alive = false;
      fresh?.bitmap.close(); fresh = null;
      for (const b of faces) b?.close?.();
      worker?.terminate();
      if (!worker) try { disposeWindshield(id); } catch { /* the renderer may never have loaded */ }
      el?.remove();
    },
  };
}
