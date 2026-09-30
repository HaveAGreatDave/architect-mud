// The loading veil over a GLASS seat: the game's wordmark and a ring, laid over the view until
// its first frames are drawn.
//
// There's no build phase ahead of the first frame. Shader compiles, the texture atlas and the city
// mesh are all built lazily inside the first paints, synchronously, and on a cold GPU that's a few
// seconds with a black window. So the veil does two things:
//
//   1. It holds the first two paints back, so the browser gets a frame to put the veil on screen
//      before the main thread goes away to compile.
//   2. It spins on the compositor (a CSS transform animation), which keeps turning while the main
//      thread is blocked. The progress arc can only move BETWEEN paints, so it steps: each slow
//      paint closes half the remaining gap, and the first fast paint fills it and fades the veil.
//
// Engine code: the wordmark is read from the page header (`#header .logo`), not written here, so
// another game on THOMAS gets its own name. Nothing under gl/ is imported, and with no veil element
// in the DOM (the headless smokes, the hangar seat) every call is a Map miss and a null lookup.

const HOLD = 2;         // paints skipped so the veil is composited before the first real one
const FAST_MS = 45;     // a paint under this means the builds are done
const SETTLE = 2;       // real paints required before a fast one counts
const MAX_MS = 12000;   // give up and lift the veil regardless
const R = 34, CIRC = 2 * Math.PI * R;

const _state = new Map();   // id → { calls, paints, t0, p, done }

function el(id) {
  return typeof document === 'undefined' ? null : document.getElementById(id + '-veil');
}

function wordmark() {
  const t = typeof document !== 'undefined' && document.querySelector('#header .logo')?.textContent;
  return String(t || '').trim() || 'LOADING';
}

function esc(s) { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }

export function veilHTML(id) {
  return `<div class="ws-veil" id="${id}-veil" aria-hidden="true">`
    + `<svg class="ws-veil-ring" viewBox="0 0 80 80">`
    + `<circle class="ws-veil-track" cx="40" cy="40" r="${R}"/>`
    + `<circle class="ws-veil-bar" cx="40" cy="40" r="${R}" stroke-dasharray="${CIRC.toFixed(2)}" stroke-dashoffset="${CIRC.toFixed(2)}"/>`
    + `<g class="ws-veil-spin"><circle class="ws-veil-arc" cx="40" cy="40" r="${R + 5}" stroke-dasharray="14 ${(2 * Math.PI * (R + 5) - 14).toFixed(2)}"/></g>`
    + `</svg><div class="ws-veil-mark">${esc(wordmark())}</div></div>`;
}

export const VEIL_CSS = `
    .ws-veil { position:absolute; inset:0; z-index:5; display:flex; flex-direction:column; align-items:center;
      justify-content:center; gap:14px; background:radial-gradient(circle at 50% 45%, #0b1320 0%, #04070c 70%);
      pointer-events:none; transition:opacity .35s ease; }
    .ws-veil.ws-veil-out { opacity:0; }
    .ws-veil-ring { width:84px; height:84px; transform:rotate(-90deg); overflow:visible; }
    .ws-veil-ring circle { fill:none; }
    .ws-veil-track { stroke:rgba(143,208,255,0.12); stroke-width:4; }
    .ws-veil-bar { stroke:#8fd0ff; stroke-width:4; stroke-linecap:round; transition:stroke-dashoffset .25s ease-out; }
    .ws-veil-arc { stroke:rgba(143,208,255,0.55); stroke-width:2; stroke-linecap:round; }
    .ws-veil-spin { transform-origin:40px 40px; animation:ws-veil-spin 1.1s linear infinite; will-change:transform; }
    @keyframes ws-veil-spin { to { transform:rotate(360deg); } }
    .ws-veil-mark { font:600 13px/1 monospace; letter-spacing:6px; padding-left:6px; color:rgba(143,208,255,0.8); }
    @media (prefers-reduced-motion: reduce) { .ws-veil-spin { animation:none; } }`;

function setProgress(node, p) {
  const bar = node.querySelector('.ws-veil-bar');
  if (bar) bar.setAttribute('stroke-dashoffset', (CIRC * (1 - p)).toFixed(2));
}

function lift(node) {
  setProgress(node, 1);
  node.classList.add('ws-veil-out');
  setTimeout(() => node.remove(), 400);
}

// Called at the top of paintWindshield. True means skip this paint.
export function veilHold(id) {
  let s = _state.get(id);
  if (s && s.done) {
    // A seat that re-renders its markup puts a fresh veil in; the builds are done, so drop it.
    const n = el(id); if (n && !n.classList.contains('ws-veil-out')) n.remove();
    return false;
  }
  const node = el(id);
  if (!node) return false;
  if (!s) { s = { calls: 0, paints: 0, t0: performance.now(), p: 0.06, worst: 0, done: false }; _state.set(id, s); setProgress(node, s.p); }
  return ++s.calls <= HOLD;
}

// Called after a real paint with its cost in ms.
export function veilPainted(id, ms) {
  const s = _state.get(id);
  if (!s || s.done) return;
  const node = el(id);
  if (!node) { s.done = true; return; }
  s.paints++;
  // Fast is relative too: a weak GPU never paints under FAST_MS, but its steady frame is still a
  // fraction of the first one, which carried every compile.
  if (ms > s.worst) s.worst = ms;
  if ((s.paints > SETTLE && ms < Math.max(FAST_MS, s.worst * 0.25)) || performance.now() - s.t0 > MAX_MS) { s.done = true; lift(node); return; }
  s.p += (0.92 - s.p) * 0.5;
  setProgress(node, s.p);
}

// Called when a seat closes, so the next entry shows the veil again (its GL context is rebuilt).
export function veilReset(id) { _state.delete(id); }
