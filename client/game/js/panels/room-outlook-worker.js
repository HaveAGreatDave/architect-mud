// GLASS ON ITS OWN THREAD, FOR THE VIEW OUT OF A ROOM (room-outlook.js starts it). A city paint takes tens of
// milliseconds and on the main thread froze the room for all of them, so the frame rate flipped between
// 60 and 15. Here it paints on its own canvas and posts each paint back as a bitmap, and the room never waits.
//
// ⚠ windshield.js EXPECTS A PAGE, SO IT GETS A SMALL ONE. Nearly all it asks of `document` is to make canvases,
// and an OffscreenCanvas does that. The rest answers as an empty page. These go in before the renderer is
// imported, because it looks when it loads. A feature that needs the real page has to arrive by message.
// ⚠ ONE FRAME AT A TIME. Each `frame` is answered with `painted`, and the page sends the next only then, so
// this always paints the newest camera and never works through a backlog.

import { eyeBase, viewOf } from './room-view.js';

const ID = 'room-outlook-canvas';
const quiet = () => ({ add() {}, remove() {}, contains: () => false, toggle() {} });
const part = () => ({ style: {}, classList: quiet(), appendChild() {}, remove() {}, setAttribute() {}, getAttribute: () => null, addEventListener() {}, querySelector: () => null });
function asElement(c) {
  Object.assign(c, { style: {}, classList: quiet(), setAttribute() {}, getAttribute: () => null, remove() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: c.width, height: c.height }) });
  Object.defineProperty(c, 'clientWidth', { get: () => c.width });
  Object.defineProperty(c, 'clientHeight', { get: () => c.height });
  return c;
}
function aPage(canvas) {
  self.window = self;
  self.devicePixelRatio = 1;
  self.matchMedia = () => ({ matches: false, addEventListener() {} });
  self.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  self.getComputedStyle = () => ({ getPropertyValue: () => '' });
  self.document = {
    visibilityState: 'visible', hidden: false, head: part(), body: part(), documentElement: part(), fonts: self.fonts || null,
    addEventListener() {}, removeEventListener() {}, getElementById: (id) => (id === ID ? canvas : null), querySelector: () => null, querySelectorAll: () => [],
    createElement: (t) => (t === 'canvas' ? asElement(new OffscreenCanvas(1, 1)) : part()), createElementNS: part,
  };
}

let G = null, msg = null, base = null, main = null, warming = null;

// ⚠ THE RENDERER LOADS BEFORE THE ROOM SAYS WHERE IT IS. Loading windshield.js and GL is most of the seconds a view
// takes to start, and none of it needs `room_outlook`, so room-outlook.js `warmOutlook` sends `warm` as the room opens.
function warm() {
  if (warming) return warming;
  main = asElement(new OffscreenCanvas(1, 1));
  aPage(main);
  warming = (async () => {
    G = await import('./windshield.js');
    await (await import('./gl/install.js')).installGL?.();
  })();
  return warming;
}

async function start(m) {
  msg = m.msg;
  await warm();
  base = eyeBase(msg, G.modelTopZAt);
  self.postMessage({ type: 'ready', eye: base.z, eyeX: base.x, eyeY: base.y, fxK: G.viewLatFocal(1000, null) / 500, vfK: G.viewFocal(1000, 1) / 1000 });
}

// ⚠ GLASS 2 COMES BACK HERE ON ITS OWN. A lost context (a GPU reset, the machine waking from sleep) makes GLASS switch
// itself to GLASS 1 basic, and on a page `visibilitychange` revives it. This page's `document` is a stub that never
// fires, so the view out of the window stayed flat boxes for as long as the building's view lived. So a frame finds
// GL off, says so once, and turns it back on after a wait that doubles each time, a few times at most.
const REVIVE_MS = 1500, REVIVE_MAX = 6;
let glWas = true, revives = 0, reviveAt = 0;
function keepGlass() {
  const on = !!G.RENDER_TUNE.gl, now = performance.now();
  if (on !== glWas) { glWas = on; self.postMessage({ type: 'gl', on, why: on ? null : G.glLastError?.()?.message || null, revives }); }
  if (on) return;
  if (!reviveAt) { reviveAt = now + REVIVE_MS * 2 ** revives; return; }
  if (now >= reviveAt && revives < REVIVE_MAX) { revives++; reviveAt = 0; G.setGlass(true); }
}

async function frame(m) {
  if (main.width !== m.W || main.height !== m.H) { main.width = m.W; main.height = m.H; }
  keepGlass();
  G.paintWindshield(ID, viewOf(msg, base, { ...m, gl: !!G.RENDER_TUNE.gl }));
  const bitmap = await createImageBitmap(main);
  self.postMessage({ type: 'painted', bitmap }, [bitmap]);
}

self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === 'warm') warm().catch(() => { /* `start` meets the same error and reports it */ });
    else if (m.type === 'start') start(m).catch((err) => self.postMessage({ type: 'failed', why: String(err?.message || err) }));
    else if (m.type === 'sky') msg.sky = { ...(msg.sky || {}), ...m.sky };
    // the next room of the same building: the eye moves, the map stays (room-outlook.js `place`)
    else if (m.type === 'place') {
      msg = { ...msg, ...m.msg };
      if (G) { base = eyeBase(msg, G.modelTopZAt); self.postMessage({ type: 'placed', eye: base.z, eyeX: base.x, eyeY: base.y }); }
    }
    else if (m.type === 'frame' && G && base) frame(m).catch((err) => self.postMessage({ type: 'failed', why: String(err?.message || err) }));
    // for a harness: what the worker last painted, whether or not the page is presenting frames
    else if (m.type === 'peek') (main ? main.convertToBlob({ type: 'image/jpeg', quality: 0.9 }) : Promise.resolve(null)).then((blob) => self.postMessage({ type: 'peeked', blob }));
  } catch (err) { self.postMessage({ type: 'failed', why: String(err?.message || err) }); }
};
