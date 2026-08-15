// A DOM/canvas stub thin enough to import client/game/js/panels/windshield.js in node.
//
// Why this exists. windshield.js is the flight sim's renderer — ~8000 lines and the file the game
// is judged on visually — and until now nothing could execute a line of it outside a browser. Its
// 72 building models were reachable only by a human flying past one, which is exactly how the
// Battery Acid roaster shipped passing a palette KEY where drawFacetDrum wanted a style FUNCTION
// and froze the sim mid-frame the first time that cafe came into view.
//
// The module touches `document` at load (texture canvases) and imports weather-fx/aircraft3d/
// engine-audio, so it needs a global environment before it will even parse-and-run. It does NOT
// need a real one: every consumer here either measures nothing or draws into a sink we throw away.
// So this stub answers the shape of the DOM, not its behaviour.
//
// Deliberately permissive (a Proxy for the 2D context), unlike SHAPE_STUB_CTX inside windshield.js
// which is a strict object literal. The difference is intentional: this stub only has to get the
// MODULE loaded, while that one is the thing under test and must fail loudly on an unknown call.
const gradient = { addColorStop() {} };

function makeCtx() {
  return new Proxy({}, {
    get(t, k) {
      if (k === 'canvas') return { width: 8, height: 8 };
      if (k === 'measureText') return () => ({ width: 0 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createConicGradient') return () => gradient;
      if (k === 'createPattern') return () => null;
      if (k === 'getImageData' || k === 'createImageData') return (x, y, w, h) => {
        const W = Math.max(1, w | 0), H = Math.max(1, h | 0);
        return { data: new Uint8ClampedArray(W * H * 4), width: W, height: H };
      };
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

function makeEl(tag) {
  return {
    tagName: String(tag).toUpperCase(), style: {}, dataset: {}, width: 8, height: 8, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    getContext: () => makeCtx(),
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, remove() {}, setAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {}, insertAdjacentHTML() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 8, height: 8, top: 0, left: 0, right: 8, bottom: 8 }),
    toDataURL: () => 'data:,', focus() {}, blur() {},
  };
}

// Elements a test wants findable BY ID. `getElementById` answers null for everything else, as it
// did before — paintWindshield's first two lines are `getElementById` and a clientWidth/Height
// check, so a view smoke needs one real, sized canvas on the other end of that lookup and nothing
// else does. Registered through `stubCanvas` below rather than by making every id resolve, because
// a stub that answers every lookup hides the "this element isn't there" bugs.
const STUB_ELS = new Map();
export function stubCanvas(id, w = 640, h = 360) {
  const el = makeEl('canvas');
  el.clientWidth = w; el.clientHeight = h; el.width = w; el.height = h;
  STUB_ELS.set(id, el);
  return el;
}

globalThis.document = {
  createElement: (t) => makeEl(t), createElementNS: (ns, t) => makeEl(t),
  body: makeEl('body'), head: makeEl('head'), documentElement: makeEl('html'),
  getElementById: (id) => STUB_ELS.get(id) || null, querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {}, createTextNode: () => ({}),
};
globalThis.window = {
  devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720,
  addEventListener() {}, removeEventListener() {},
  requestAnimationFrame: () => 0, cancelAnimationFrame() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  setTimeout, clearTimeout, setInterval, clearInterval,
};
// node ≥21 ships a read-only `navigator`, so a plain assignment throws. Define over it instead.
try { Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', maxTouchPoints: 0 }, configurable: true }); } catch { /* already fine */ }
// Generic DOM shape the canvas renderers ask for. getComputedStyle answers a
// property bag rather than a cascade — a renderer reading a CSS variable needs a
// value, not the right one.
globalThis.getComputedStyle = () => ({
  color: 'rgb(80, 220, 210)',
  getPropertyValue: () => '',
});
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.localStorage = globalThis.window.localStorage;
globalThis.Image = class { set src(_) {} addEventListener() {} };
globalThis.Path2D = class { addPath() {} };
globalThis.OffscreenCanvas = class {
  constructor(w, h) { this.width = w; this.height = h; }
  getContext() { return makeCtx(); }
};
// engine-audio.js constructs one at module scope on some paths.
globalThis.AudioContext = class {
  constructor() { this.destination = {}; this.currentTime = 0; this.sampleRate = 48000; }
  createGain() { return { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
  createOscillator() { return { type: '', frequency: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, start() {}, stop() {}, disconnect() {} }; }
  createBuffer() { return { getChannelData: () => new Float32Array(1) }; }
  createBufferSource() { return { buffer: null, connect() {}, start() {}, stop() {}, disconnect() {} }; }
  createBiquadFilter() { return { type: '', frequency: { value: 1, setValueAtTime() {} }, Q: { value: 1 }, connect() {}, disconnect() {} }; }
  resume() { return Promise.resolve(); }
};
globalThis.webkitAudioContext = globalThis.AudioContext;

// Import windshield.js with the stub in place. Every shapes script goes through here.
export async function loadWindshield() {
  return import('../../client/game/js/panels/windshield.js');
}
