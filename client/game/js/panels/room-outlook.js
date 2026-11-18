// THE VIEW FROM A ROOM'S WINDOWS. GLASS itself: the city round the building, painted six times (the room's front,
// right, back and left, then down and up, each a 90° square) and handed to the room's renderer as one picture, which
// looks each pane's pixel up by its direction (gl/room.js, uMode 5). Each face is painted from where you stood when it
// was sent (`faceAt`), and the shader corrects every pixel for the step you've taken since, so the city stays placed
// in the world: turning moves you, never it, and a passer-by is their own size from anywhere in the room.
//
// ⚠ IT PAINTS ON ITS OWN THREAD (room-outlook-worker.js), one face at a time: all six as soon as it's up, then, while
// there's glass in view, as fast as the worker goes, the faces you're looking at first (`pick`). One face every
// 250 ms put the traffic at a frame a second. A refresh from where you've walked to moves only what the correction
// had slightly wrong. Where a worker can't do it the paint runs here instead.
// ⚠ THE NEXT FACE IS SENT AS SOON AS THE LAST ONE COMES BACK (`send` from `painted`), not at the room's next frame:
// waiting for the frame left the worker idle for half a frame a paint. And `pick` shares the paints out by how much
// of the screen each face covers (`cover`, the shader's own rule for which face a pixel takes). Its old test, a face
// within 84° of where you look, counted the down and up faces while looking level (they're pitched 83°), so the face
// you were looking through got a quarter of the paints and a balcony's view crawled.
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
// do it: a tile with a building on it is drawn under you, so a roof can be landed on. A room with a balcony is the
// exception (`msg.cut`): it keeps the building, and GLASS 2 leaves out only the room's own spot in it (roomCut).

import { loadWindshield, paintWindshield, disposeWindshield, ensureWindshieldStyles, modelTopZAt, modelFaceAt, viewFocal, viewLatFocal, RENDER_TUNE } from './windshield-lazy.js';
import { eyeBase, facadePaint, lensOf, viewOf } from './room-view.js';

const FACE_PX = 1024;      // a face's height in pixels: 90° over the room's screen height, so 512 showed soft
const LIVE_SLOW_MS = 9;
// ⚠ A MACHINE THAT CAN'T AFFORD LIVE GIVES IT UP (`slow`, room-stage.js `toFaces`). Shrinking the canvas only helps
// a GPU that's short of pixels; the city's cost is mostly the main thread building it, and that didn't move from
// 1600 px wide to 400. So past LIVE_GIVE_UP_MS a paint, for LIVE_GIVE_UP_N paints in a row
// (an occasional slow one is forgiven a step at a time), live says it's slow, and in the meantime it paints no
// faster than every LIVE_SLOW_EVERY_MS so the room keeps its frame rate while the six faces come.
const LIVE_GIVE_UP_MS = 14, LIVE_GIVE_UP_N = 30, LIVE_SLOW_EVERY_MS = 30;
const FACES = 6;           // front, right, back, left, down, up
const TILT = 1.45;         // the down and up faces' pitch: as far as GLASS turns (windshield.js clamps at 1.45)
// ⚠ AND THEY'RE WIDER THAN 90°: POLE is the tan of half their span (about 109°). Pitched 83° and 90° wide, the down face
// left a hole below the level faces behind you and to the back corners (down to 52° under the horizon straight back),
// where the shader read past a face's edge and the clamped edge streaked under the buildings. 1.28 closes it; the rest
// is room for the seam's blend. gl/room.js reads the same number (PANO_POLE).
const POLE = 1.4;
const STALE_EVERY = 8;
// ⚠ THE FIRST SET OF FACES IS HALF A CITY. GLASS builds its water, the street kit's lanes and walkways and some of its
// tables over its first seconds, so the first paint of each face had green ground where the Basin and the streets
// should be, and a face you weren't looking through kept that picture for minutes (only STALE_EVERY reached it).
// So once all six are up, every face is painted again at each of these times after, seen or not.
const SETTLE_MS = [1500, 4000, 9000];     // every this many paints, the face longest unpainted, seen or not
// face i's pose about the room's bearing: [yaw offset in degrees, pitch in radians]
const POSE = [[0, 0], [90, 0], [180, 0], [270, 0], [0, -TILT], [0, TILT]];
// and the way it looks, in pick's frame: [along the bearing, a quarter turn on, up]
const FACE_DIR = POSE.map(([a, p]) => { const r = (a * Math.PI) / 180; return [Math.cos(r) * Math.cos(p), Math.sin(r) * Math.cos(p), Math.sin(p)]; });
const COVER_X = 9, COVER_Y = 7;   // the grid `cover` samples the screen on, edges included
const SLIVER = 0.2;        // a face on screen at all gets paints as if it covered this much more of it
const PIPE_MS = 120;       // the next face is sent straight from the last one's return only while the room is ticking
export const PANO_TILT = TILT, PANO_POLE = POLE;
// ⚠ THE LOOK PICTURE: GLASS PAINTED IN THE WORKER WHERE YOU'RE LOOKING. The six faces are painted a face at a time, so
// what you looked through was repainted at a share of the worker's rate, and a helicopter passing a balcony moved in
// steps. So once the six are up, the worker mostly paints one picture along your own line of sight, LOOK_MARGIN wider
// than your lens each way, and the room reads it by direction (gl/room.js uLook) like a face: a turn made while it
// was painting is right in it, which a picture slid to cover the lag never was (the old worker view, above). Past its
// edge, a turn faster than a paint, the faces show. Every LOOK_FACE_EVERY-th paint is still a face, so they keep up.
// It's what replaced painting the city on the main thread (`live`), which cost the room a GLASS frame a frame.
const LOOK = FACES, LOOK_MARGIN = 14, LOOK_FACE_EVERY = 8, LOOK_W = 1280;   // a face every 8th: each is a big upload on the main thread

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
// ⚠ `live` IS THE MAIN-THREAD VIEW, AND SINCE 2026-11-17 ONLY ON ASK (`__roomLive`, room-stage.js): the worker's
// faces and its look picture (LOOK) stand in for it, so the room's frames never wait on GLASS. What follows is how it works. The city is painted here, on the main
// thread, every frame there's glass in view, from exactly the room's eye: where you stand, how high, your yaw, pitch and
// lens. The room is drawn over it with its panes as holes (gl/room.js `see`) through GLASS's own projection (the
// lens `tick` returns). So nothing out there is a picture: near buildings move past the glass as you walk, and nothing
// lags a turn. It costs a GLASS frame a frame, what the street on foot already costs. Without `live` it's the six
// faces painted in the worker, for a device that can't afford that.
export function createOutlook(msg, { host, onEye, onFail, onPano, feed, live = false }) {
  const id = 'room-outlook-' + Math.random().toString(36).slice(2, 8);
  let alive = true, el = null, painted = 0, K = null, worker = null, free = false, base = null, peek = null;
  let F = null, next = 0, filled = 0, sentFace = 0, nPaint = 0, lastAt = new Array(FACES).fill(0), fullAt = 0, postedAt = 0, lag = 33, gl = true;
  // `lastAt` is when each face was last SENT to be painted, so a face on its way back isn't asked for twice
  // paints back from the worker and not yet handed to the room, the newest per face
  const faces = [], fresh = new Map();
  // what the next paint is for: the room's last `tick`, while there's something to paint, and when it came
  let want = null, wantAt = 0;
  // ⚠ EACH FACE IS PAINTED FROM WHERE YOU STOOD WHEN IT WAS SENT (`cap`), and handed to the room with that spot
  // (`faceAt`, [u, v] in the room's metres). The room's shader corrects every pixel for the step between that spot and
  // your eye now (gl/room.js uPanoEye). Painted from one spot on the front glass, as they were, a person a pace outside
  // was drawn the size they'd be from the glass however far back you stood: two or three times too big from the
  // middle of a shop. `cap` is the last spot the room said you were at; before it has said, the front glass's middle.
  let cap = { at: [0, 0], room: [1, 1] }, sentCap = cap, sentLook = null, lookPic = null;
  const faceAt = [], freshAt = new Map();
  // ⚠ ONE SPOT FOR THE WHOLE ROOM: ITS MIDDLE. Moved with you, every repaint came from a new spot, and the correction
  // (gl/room.js PANO_PROXY, uPanoGround) is right only at one distance, so the old picture and the new one never quite
  // agreed: the view jittered in pieces as you walked, and every time the spot moved the fade put two cities over each
  // other. From one fixed spot every repaint lines up with the last, and your walking is the shader's correction alone,
  // which is smooth. It moves only when the room does.
  const capOf = (look) => {
    if (!Array.isArray(look?.room)) return cap;
    if (cap.room[0] !== look.room[0] || cap.room[1] !== look.room[1]) cap = { at: [0, look.room[1] / 2], room: look.room };
    return cap;
  };

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
  const ready = (m) => { K = { fxK: m.fxK, vfK: m.vfK }; onEye?.({ eye: m.eye, eyeX: m.eyeX, eyeY: m.eyeY, paint: m.paint || null }); };
  // the eye, and for a balcony room the paint on its building's face there (room-view.js facadePaint)
  const based = () => { const b = eyeBase(msg, modelTopZAt); try { b.paint = facadePaint(msg, b, modelFaceAt); } catch { b.paint = null; } return b; };
  // a face's size and lens: 90° tall, and wide enough to be 90° across as well
  const face = () => {
    const fh = FACE_PX, fw = Math.max(64, Math.round(K.fxK * fh / (2 * K.vfK))), { k, lens } = lensOf(K.fxK, K.vfK, fw, fh, 90);
    return { fw, fh, k, lens };
  };
  const give = (i, pic) => {
    filled = Math.min(FACES, filled + 1);
    if (filled === FACES && !fullAt) fullAt = performance.now();
    try { onPano?.(i, pic, F.lens, faceAt[i] || null); } catch (e) { console.warn('[room] the city face', e?.message); }
  };

  // the fallback: the same paint, here
  // ⚠ A RENDERER THAT WON'T LOAD IS TRIED AGAIN, every few seconds up to RETRY_MAX_MS, for as long as the room is open.
  // The usual cause is the server restarting (--watch, a deploy): every fetch is refused for a few seconds, and the
  // server sends no new `room_outlook` when the socket comes back, so giving up left the windows black until a reload.
  // `onFail` still goes at the first miss, so the veil lifts and the room shows meanwhile.
  let retryMs = 0, retryTimer = 0;
  const RETRY_MAX_MS = 30000;
  function here() {
    worker?.terminate();
    worker = null; free = false; K = null;
    canvas();
    loadWindshield().then(() => {
      if (!alive) return;
      retryMs = 0;
      ensureWindshieldStyles();
      base = based();
      ready({ eye: base.z, eyeX: base.x, eyeY: base.y, paint: base.paint, fxK: viewLatFocal(1000, null) / 500, vfK: viewFocal(1000, 1) / 1000 });
    }).catch((e) => {
      if (!alive) return;
      if (!retryMs) { console.warn('[room] no view from the window yet, trying again:', e?.message); onFail?.(); }
      retryMs = Math.min(RETRY_MAX_MS, (retryMs || 1000) * 2);
      retryTimer = setTimeout(() => { if (alive) here(); }, retryMs);
    });
  }

  try {
    if (live) throw new Error('live: painted here');
    canvas();
    if (typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function') throw new Error('no offscreen canvas');
    worker = takeWarm();
    worker.onmessage = ({ data: m }) => {
      if (m.type === 'ready') { base = { x: m.eyeX, y: m.eyeY, z: m.eye, paint: m.paint || null }; ready(m); free = true; }
      else if (m.type === 'placed') { base = { x: m.eyeX, y: m.eyeY, z: m.eye, paint: m.paint || null }; onEye?.({ eye: m.eye, eyeX: m.eyeX, eyeY: m.eyeY, paint: base.paint }); }
      else if (m.type === 'painted') { painted++; if (postedAt) lag += (performance.now() - postedAt - lag) * 0.3; free = true; fresh.get(sentFace)?.close(); fresh.set(sentFace, m.bitmap); freshAt.set(sentFace, sentFace === LOOK ? { at: sentCap.at, pose: sentLook } : sentCap.at); send(); }
      else if (m.type === 'peeked') peek?.(m.blob);
      else if (m.type === 'gl') { gl = m.on; if (m.on) console.info('[room] the view from the window is back on GLASS 2'); else console.warn('[room] the view from the window dropped to GLASS 1:', m.why || 'no reason given', '- trying GLASS 2 again shortly'); }
      else if (m.type === 'failed') { console.warn('[room] the view\'s worker failed:', m.why); here(); }
    };
    worker.onerror = (e) => { console.warn('[room] the view\'s worker failed:', e?.message); e?.preventDefault?.(); if (worker) here(); };
    worker.postMessage({ type: 'start', msg });
  } catch (e) { here(); }
  let lens0 = null;
  // ⚠ LIVE COSTS A GLASS FRAME A FRAME, so it's kept in hand two ways. A head that hasn't moved is repainted every
  // other frame once a paint is dear: only what's moving out there changes, and at 30 a second it reads as smooth.
  // And with no glass in view there's no paint at all.
  // ⚠ NEVER SIZE THE CANVAS HERE. GLASS sizes it every paint from its CSS box and its own resolution dial
  // (windshield.js resStep; viewOf pins it with resFloor 1). This used to shrink it to a `scale` that followed the
  // paint's cost: GLASS put it straight back, so each paint reallocated the canvas twice and the picture never
  // changed. The scale fell as soon as a turn made the paint dear (the near buildings run live off their kept pose),
  // so turning was when it happened: the hitches while turning round a room.
  let cost = 0, lastPose = '', lastPaint = 0, slowN = 0, stillN = 0;
  function livePaint(hour, wx, look, warming) {
    const W = Math.max(2, el.clientWidth), H = Math.max(2, el.clientHeight), { k, lens } = lensOf(K.fxK, K.vfK, W, H, look?.fov ?? lens0?.fov);
    if (look) lens0 = { fov: look.fov };
    if (!look && painted > 2) return lens;
    const t0 = performance.now(), pose = look ? [look.yaw, look.pitch, look.fov, look.at?.[0], look.at?.[1]].join() : '';
    // a still head is painted every other frame once a paint isn't cheap: where it is, every frame, or the traffic
    // out there ran at half the room's rate. Every other FRAME, by count, not by clock: a 33 ms clock against a
    // 16.7 ms frame skipped one frame or two as the timing fell, and the paint/skip frames came uneven (a hitch)
    // Only once a paint is properly dear (LIVE_SLOW_MS): halving past 5 ms put the aircraft out there at 30 a
    // second on most machines, and they read as choppy.
    if (!warming && pose === lastPose && cost > LIVE_SLOW_MS && (++stillN & 1)) return lens;
    if (pose !== lastPose) stillN = 0;
    // on its way to giving up (slowN), no faster than LIVE_SLOW_EVERY_MS, so the room keeps its rate while the faces come
    if (!warming && slowN > 0 && cost > LIVE_SLOW_MS && t0 - lastPaint < LIVE_SLOW_EVERY_MS) return lens;
    lastPose = pose; lastPaint = t0;
    try { paintWindshield(id, viewOf(msg, base, { hour, wx, look, fed: feed?.(), k, gl: !!RENDER_TUNE?.gl })); painted++; } catch (e) { fail(e?.message); return lens; }
    cost += (performance.now() - t0 - cost) * 0.15;
    // a paint dear on the main thread is too slow here; a smaller canvas wouldn't change it
    if (!warming && painted > 20) slowN = cost > LIVE_GIVE_UP_MS ? slowN + 1 : Math.max(0, slowN - 1);
    return lens;
  }

  // how much of the screen each face covers: a grid of rays through the room's camera, each given to the face it's
  // most nearly facing, as the room's shader does a pixel (gl/room.js uMode 5). The room's own walls and rail are
  // counted too; it's the shares that matter.
  const share = new Float32Array(FACES);
  function cover(look) {
    share.fill(0);
    const ya = ((look.yaw - (msg.bearing || 0)) * Math.PI) / 180, p = look.pitch || 0;
    const cy = Math.cos(ya), sy = Math.sin(ya), cp = Math.cos(p), sp = Math.sin(p);
    const fwd = [cy * cp, sy * cp, sp], rt = [-sy, cy, 0], up = [-cy * sp, -sy * sp, cp];
    const tv = Math.tan(((look.fov || 60) * Math.PI) / 360), th = (tv * (host?.clientWidth || 16)) / (host?.clientHeight || 9);
    for (let j = 0; j < COVER_Y; j++) for (let i = 0; i < COVER_X; i++) {
      const x = ((2 * i) / (COVER_X - 1) - 1) * th, y = ((2 * j) / (COVER_Y - 1) - 1) * tv;
      const d0 = fwd[0] + x * rt[0] + y * up[0], d1 = fwd[1] + x * rt[1] + y * up[1], d2 = fwd[2] + y * up[2];
      let best = 0, bf = -Infinity;
      for (let k = 0; k < FACES; k++) { const f = FACE_DIR[k], v = d0 * f[0] + d1 * f[1] + d2 * f[2]; if (v > bf) { bf = v; best = k; } }
      share[best] += 1 / (COVER_X * COVER_Y);
    }
  }
  // the face to paint next: of those on screen, the one longest unpainted, weighted by how much of the screen it
  // covers, so the face you're looking through comes round most often. Now and then the oldest of all of them.
  const pickSeen = (look, now) => {
    cover(look);
    let best = -1, bs = -1;
    for (let i = 0; i < FACES; i++) {
      if (!share[i]) continue;
      const s = (now - lastAt[i] + 1) * (share[i] + SLIVER);
      if (s > bs) { best = i; bs = s; }
    }
    return best < 0 ? 0 : best;
  };
  const pick = (look, now) => {
    if (nPaint % STALE_EVERY) return pickSeen(look, now);
    let best = 0;
    for (let i = 1; i < FACES; i++) if (lastAt[i] < lastAt[best]) best = i;
    return best;
  };
  // the first round: the face you're looking through before the ones behind you, so the glass in view isn't empty
  // for five paints; then the unpainted rest in turn. `lastAt` 0 is a face not sent since the last `place`.
  // a face still holding a paint from before the latest settle time that's passed (SETTLE_MS), or -1
  const settling = (now) => {
    if (!fullAt) return -1;
    let due = 0;
    for (const ms of SETTLE_MS) if (now >= fullAt + ms) due = fullAt + ms;
    if (!due) return -1;
    for (let k = 0; k < FACES; k++) { const j = (next + k) % FACES; if (lastAt[j] < due) return j; }
    return -1;
  };
  const choose = (look, now) => { if (filled < FACES) return firstPass(look, now); const j = settling(now); if (j >= 0) return j; if (look) return pick(look, now);
    // settling with no glass in view: the face painted longest ago
    let o = 0; for (let k = 1; k < FACES; k++) if (lastAt[k] < lastAt[o]) o = k; return o; };
  const firstPass = (look, now) => {
    if (look) { const p = pickSeen(look, now); if (!lastAt[p]) return p; }
    for (let k = 0; k < FACES; k++) { const j = (next + k) % FACES; if (!lastAt[j]) return j; }
    return next;
  };
  // the next face to the worker, if it's free and the room still wants one: from `tick`, and straight from the last
  // paint's return while the room is ticking (PIPE_MS), so the worker never sits waiting for a frame
  function send() {
    if (!alive || !worker || !free || !want || !F) return;
    const t = performance.now();
    if (t - wantAt > PIPE_MS) return;
    const { hour, wx, look } = want;
    if (look && filled >= FACES && settling(t) < 0 && nPaint % LOOK_FACE_EVERY) {
      const c = capOf(look), W = Math.min(LOOK_W, Math.max(64, host?.clientWidth || 960)), H = Math.max(36, Math.round(W * ((host?.clientHeight || 540) / (host?.clientWidth || 960))));
      const fov = Math.min(150, (look.fov || 72) + 2 * LOOK_MARGIN), { k, lens } = lensOf(K.fxK, K.vfK, W, H, fov);
      const pose = { yaw: look.yaw, pitch: look.pitch || 0, fov, at: c.at, room: c.room, deck: !!look.deck };
      sentLook = { lens, ap: [((look.yaw - (msg.bearing || 0)) * Math.PI) / 180, look.pitch || 0] };
      free = false; postedAt = t; sentFace = LOOK; sentCap = c; nPaint++;
      worker.postMessage({ type: 'frame', hour, wx, look: pose, fed: feed?.(), k, W, H });
      return;
    }
    const i = choose(look, t), c = capOf(look);
    const pose = { yaw: (((msg.bearing || 0) + POSE[i][0]) % 360 + 360) % 360, pitch: POSE[i][1], fov: 90, at: c.at, room: c.room, deck: !!look?.deck };
    free = false; postedAt = t; sentFace = i; sentCap = c; lastAt[i] = t; next = (i + 1) % FACES; nPaint++;
    worker.postMessage({ type: 'frame', hour, wx, look: pose, fed: feed?.(), k: i >= 4 ? F.k / POLE : F.k, W: F.fw, H: F.fh });
  }

  return {
    get live() { return live; },
    // live and too dear for this machine: the room should swap to the six faces (LIVE_GIVE_UP_MS)
    // `__roomLiveKeep` (a harness) holds it live however slow, so a lab on a slow pane can look through it
    get slow() { return live && !globalThis.__roomLiveKeep && slowN >= LIVE_GIVE_UP_N; },
    // where it's looking from now (`place` replaces it), for a view of the same place started in its stead
    get spot() { return msg; },
    // live: a paint with no glass in view, for warming the city where you're about to be (a lift's next floor, behind
    // its shut doors), so its first frames have built what they need before anybody sees them
    warm(hour, wx, look) { if (alive && K && live) livePaint(hour, wx, look, true); },
    get painted() { return live ? painted > 8 : filled >= FACES && painted > 8; },   // every face, and past the provisional floor LUT
    // all four faces up: the loading veil waits for this, not for `painted`
    get shown() { return live ? painted > 0 : filled >= FACES; },
    // for a harness: how many paints, a paint's round trip in ms, and how many faces are up
    get stats() { return { paints: painted, lag: Math.round(lag), worker: !!worker, gl, faces: filled, live, cost: +cost.toFixed(1) }; },
    // what the worker's canvas holds, as a blob, for a harness
    peek: () => new Promise((res) => { peek = res; worker?.postMessage({ type: 'peek' }); }),
    // once a frame. `look` is non-null while there's glass in view. Returns null: the room keeps its own lens.
    tick(hour, wx, look) {
      if (!alive || !K) return null;
      if (live) return livePaint(hour, wx, look, false);
      F ||= face();
      for (const [i, b] of fresh) {
        if (i === LOOK) {
          const f = freshAt.get(i);
          lookPic?.close?.(); lookPic = b;
          try { onPano?.(LOOK, b, f.pose.lens, f.at, f.pose.ap); } catch (e) { console.warn('[room] the look picture', e?.message); }
          continue;
        }
        faces[i]?.close?.(); faces[i] = b; faceAt[i] = freshAt.get(i) || null; give(i, b);
      }
      fresh.clear(); freshAt.clear();
      const t = performance.now();
      // every face once, then, while there's glass in view, as fast as the worker goes: the faces you're looking
      // at first, so what moves out there moves at the frame rate, and the rest now and then
      want = filled < FACES || look || settling(t) >= 0 ? { hour, wx, look } : null; wantAt = t;
      if (!want) return null;
      if (worker) { send(); return null; }
      const i = choose(look, t), c = capOf(look);
      const pose = { yaw: (((msg.bearing || 0) + POSE[i][0]) % 360 + 360) % 360, pitch: POSE[i][1], fov: 90, at: c.at, room: c.room, deck: !!look?.deck };
      faceAt[i] = c.at;
      if (el.width !== F.fw || el.height !== F.fh) { el.width = F.fw; el.height = F.fh; }
      postedAt = t; lastAt[i] = t; next = (i + 1) % FACES; nPaint++;
      try { paintWindshield(id, viewOf(msg, base, { hour, wx, look: pose, fed: feed?.(), k: i >= 4 ? F.k / POLE : F.k, gl: !!RENDER_TUNE?.gl })); painted++; give(i, el); } catch (e) { fail(e?.message); }
      return null;
    },
    // the tile this view was started on: a room on another tile needs a view of its own
    get tile() { return `${msg.gx},${msg.gy}`; },
    // the next room's Stage takes this view over: its host, who it tells, and the faces already painted
    adopt(nx) {
      host = nx.host; onEye = nx.onEye; onFail = nx.onFail; onPano = nx.onPano; feed = nx.feed;
      if (el) host.prepend(el);
      if (K && base) onEye?.({ eye: base.z, eyeX: base.x, eyeY: base.y, paint: base.paint || null });
      if (F && worker && filled >= FACES) faces.forEach((b, i) => { if (b) try { onPano?.(i, b, F.lens, faceAt[i] || null); } catch { /* the room's renderer is gone */ } });
    },
    // a new room of the same building: where it stands, the way it faces, how high. All four faces again.
    place(m) {
      // the same storey facing the same way keeps its faces until they're repainted; anything else starts again
      // (and the same balcony or none: a room with one keeps its own building in view, room-view.js roomCut)
      const same = m.bearing === msg.bearing && m.storey === msg.storey && !!m.cut === !!msg.cut;
      msg = { ...msg, storey: m.storey, storeys: m.storeys, bearing: m.bearing, frame: m.frame || null, cut: m.cut || null, sky: { ...(msg.sky || {}), ...(m.sky || {}) } };
      if (!same) { filled = 0; fullAt = 0; lastAt.fill(0); }
      next = 0;
      // the spots the kept faces were painted from are the last room's metres: drawn uncorrected until repainted
      faceAt.fill(null); cap = sentCap = { at: [0, 0], room: [1, 1] };
      if (worker) { worker.postMessage({ type: 'place', msg: { storey: msg.storey, storeys: msg.storeys, bearing: msg.bearing, frame: msg.frame, cut: msg.cut } }); return; }
      if (base) { base = based(); onEye?.({ eye: base.z, eyeX: base.x, eyeY: base.y, paint: base.paint }); }
    },
    // the weather's moved on
    setSky(sky) { msg.sky = { ...(msg.sky || {}), ...sky }; worker?.postMessage({ type: 'sky', sky }); },
    stop() {
      alive = false;
      clearTimeout(retryTimer);
      for (const b of fresh.values()) b.close(); fresh.clear(); want = null;
      for (const b of faces) b?.close?.();
      worker?.terminate();
      if (!worker) try { disposeWindshield(id); } catch { /* the renderer may never have loaded */ }
      el?.remove();
    },
  };
}
