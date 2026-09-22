// MOUNTING A SEAT HEADLESSLY — the shared half of every seat smoke.
//
// WHY THIS EXISTS. `freelook-smoke.mjs`'s header states the gap it was written for: no gate in this
// repo had ever MOUNTED a panel. Every shapes script calls `paintWindshield` directly with a
// hand-built view, so a panel's own open → frame → close path is the class that "passes
// `client:smoke` (it parses), `imports:smoke` (every named import resolves) and all 26 shape gates,
// and then kills the view on the first real frame". That is still true of `cockpit.js`,
// `cab-view.js`, `helm-view.js`, `truck-depot.js` and `hangar-bay.js`.
//
// It became worth extracting the moment there was a second seat. The setup is ~80 lines of browser
// furniture, none of it behaviour under test, and three copies of it is three things to keep in
// step — the argument the blank-scanner makes one layer down, and the reason `emitWho` was lifted
// out of `emitFace` rather than pasted into `pushStroke`.
//
// ⚠ IT IS THE SHARED STUB WITH A TALLY ON IT, NOT A SECOND STUB. `dom-stub.mjs`'s context is a
// Proxy answering every method with a no-op; this is that Proxy with a counter hung off it, so the
// module under test cannot tell the difference.
//
//   import { installSeatDom, fakeEl, TALLY, step, pending } from './seat-harness.mjs';
//   const h = await installSeatDom(['helm-chase-']);

export const TALLY = { ops: {}, text: [] };
export function resetTally() { TALLY.ops = {}; TALLY.text = []; }

const gradient = { addColorStop() {} };
export function makeCtx() {
  return new Proxy({}, {
    get(t, k) {
      if (k === 'canvas') return { width: 640, height: 360 };
      if (k === 'measureText') return (txt) => ({ width: String(txt == null ? '' : txt).length * 20 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createConicGradient') return () => gradient;
      if (k === 'createPattern') return () => null;
      // ⚠ Two arities, and they are not the same one — see the dom-stub's own ⚠ on this pair.
      if (k === 'getImageData' || k === 'createImageData') return (...a) => {
        const [w, h] = a.length >= 4 ? [a[2], a[3]] : [a[0], a[1]];
        const W = Math.max(1, w | 0), H = Math.max(1, h | 0);
        return { data: new Uint8ClampedArray(W * H * 4), width: W, height: H };
      };
      if (k in t) return t[k];
      return (...a) => {
        TALLY.ops[k] = (TALLY.ops[k] || 0) + 1;
        if (k === 'fillText' || k === 'strokeText') TALLY.text.push(String(a[0]));
      };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

// ⚠ THE PANEL WRITES ITS MARKUP WITH innerHTML AND THEN FINDS ITS OWN PARTS WITH querySelector. A
// browser parses that string into findable elements; the stub answers null for every lookup, so the
// panel dies on a dereference that is correct in a browser. An element answering every lookup
// stands in for the PARSE — the DOM's job, not the panel's logic.
export function fakeEl(tag = 'DIV') {
  return {
    tagName: tag, style: {}, dataset: {}, children: [], innerHTML: '', textContent: '',
    clientWidth: 640, clientHeight: 360, width: 640, height: 360,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    getContext: () => makeCtx(),
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, remove() {}, setAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {},
    querySelector: () => fakeEl(), querySelectorAll: () => [],
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 640, height: 360, top: 0, left: 0, right: 640, bottom: 360 }),
    focus() {}, blur() {},
  };
}

let _pending = null;
/** The frame callback the seat armed. The stub's rAF never fires, so a test steps it by hand. */
export function pending() { return _pending; }
/** Run one frame. Returns false if the seat has not armed one. */
export function step(now = 16) {
  const fn = _pending;
  if (typeof fn !== 'function') return false;
  _pending = null;
  fn(now);
  return true;
}

/**
 * Install the browser furniture a seat needs. `prefixes` are the canvas-id prefixes the panel
 * mints per open (e.g. 'helm-chase-') — they cannot be pre-registered, so they are answered lazily.
 */
export async function installSeatDom(prefixes = [], extraIds = ['marks-ws']) {
  await import('../shapes/dom-stub.mjs');   // installs document / window / canvas globals

  // Every panel that takes the area pane fires these, and the stub has no dispatchEvent / Event.
  globalThis.Event = class { constructor(type) { this.type = type; } };
  globalThis.window.dispatchEvent = () => true;
  globalThis.dispatchEvent = globalThis.window.dispatchEvent;
  // ⚠ AND THE BARE GLOBALS, WHICH ARE NOT THE SAME THING AS `window`'s. A browser puts
  // `addEventListener` on the global object, so a module that calls it unqualified is writing
  // perfectly ordinary DOM code — `helm-wheel.js` does, to release a drag that left the canvas.
  // Without these, mounting any seat that owns a wheel is a ReferenceError before the first frame.
  globalThis.addEventListener = globalThis.window.addEventListener = () => {};
  globalThis.removeEventListener = globalThis.window.removeEventListener = () => {};

  const realGet = globalThis.document.getElementById;
  const canvases = new Map();
  globalThis.document.getElementById = (id) => {
    const want = typeof id === 'string'
      && (extraIds.includes(id) || prefixes.some((p) => id.startsWith(p)));
    if (want) {
      if (!canvases.has(id)) canvases.set(id, fakeEl('CANVAS'));
      return canvases.get(id);
    }
    return realGet(id);
  };

  globalThis.requestAnimationFrame = (fn) => { _pending = fn; return 1; };
  globalThis.cancelAnimationFrame = () => { _pending = null; };
  globalThis.window.requestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.window.cancelAnimationFrame = globalThis.cancelAnimationFrame;

  return { canvases, fakeEl, TALLY, step, pending };
}

/** The usual check printer. Returns a `fails` reader so the caller can set its own exit code. */
export function checker() {
  let fails = 0;
  const ck = (name, ok, note) => {
    console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || note === undefined ? '' : ' — ' + note));
    if (!ok) fails++;
  };
  ck.fails = () => fails;
  return ck;
}
