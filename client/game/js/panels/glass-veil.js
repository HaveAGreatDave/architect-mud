// The loading veil over a GLASS seat: a glass-faced gauge with GLASS printed on the dial as its
// maker's mark, the game's wordmark under it, laid over the view until its first frames are drawn.
//
// There's no build phase ahead of the first frame. Shader compiles, the texture atlas and the city
// mesh are all built lazily inside the first paints, synchronously, and on a cold GPU that's a few
// seconds with a black window. So the veil does two things:
//
//   1. It holds the first two paints back, so the browser gets a frame to put the veil on screen
//      before the main thread goes away to compile.
//   2. The sweep under the glass turns on the compositor (a CSS transform on an HTML element, not
//      an SVG node), so it keeps moving while the main thread is blocked. The needle, the lit arc
//      and the readout can only move BETWEEN paints, so they step: each slow paint closes half the
//      remaining gap, and the first fast paint swings the needle to the stop and fades the veil.
//
// Engine code: the wordmark is read from the page header (`#header .logo`), not written here, so
// another game on THOMAS gets its own name. GLASS is the renderer's name, so it's fine here. Nothing
// under gl/ is imported, and with no veil element in the DOM (the headless smokes, the hangar seat)
// every call is a Map miss and a null lookup.

const HOLD = 2;         // paints skipped so the veil is composited before the first real one
const FAST_MS = 45;     // a paint under this means the builds are done
const SETTLE = 2;       // real paints required before a fast one counts
const MAX_MS = 12000;   // give up and lift the veil regardless
const FADE_MS = 600;    // the needle's swing to the stop, then the fade (CSS below), then removal

// The dial: a 270 degree scale in a 200-unit box, zero at bottom left, full at bottom right.
const C = 100, ARC_R = 87, ARC_LEN = ARC_R * 1.5 * Math.PI;
const angleOf = v => -135 + 270 * v;                       // degrees clockwise from 12 o'clock
function pt(r, v) {
  const a = angleOf(v) * Math.PI / 180;
  return `${(C + r * Math.sin(a)).toFixed(2)} ${(C - r * Math.cos(a)).toFixed(2)}`;
}
function arc(r, v0, v1) {
  return `M${pt(r, v0)} A${r} ${r} 0 ${(v1 - v0) > 2 / 3 ? 1 : 0} 1 ${pt(r, v1)}`;
}

// The printed face never changes, so it's built once: 50 graduations, a long one every tenth,
// numerals every fifth, and a short green band at the top of the scale where the view comes up.
const FACE = (() => {
  let s = '';
  for (let i = 0; i <= 50; i++) {
    const v = i / 50, major = i % 5 === 0;
    const [x1, y1] = pt(80, v).split(' '), [x2, y2] = pt(major ? 69 : 75, v).split(' ');
    s += `<line class="${major ? 'ws-veil-maj' : 'ws-veil-min'}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
    if (i % 10 === 0) {
      const [x, y] = pt(58, v).split(' ');
      s += `<text class="ws-veil-num" x="${x}" y="${y}">${i * 2}</text>`;
    }
  }
  return `<path class="ws-veil-go" d="${arc(80, 0.9, 1)}"/>` + s;
})();

const _state = new Map();   // id → { calls, paints, t0, p, worst, done }

function el(id) {
  return typeof document === 'undefined' ? null : document.getElementById(id + '-veil');
}

function wordmark() {
  const t = typeof document !== 'undefined' && document.querySelector('#header .logo')?.textContent;
  return String(t || '').trim() || 'LOADING';
}

function esc(s) { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }

export function veilHTML(id) {
  const g = esc(id) + '-veil';   // gradient ids are document-wide, so each seat gets its own
  return `<div class="ws-veil" id="${g}" aria-hidden="true">`
    + `<div class="ws-veil-dial"><div class="ws-veil-face">`
    + `<div class="ws-veil-sweep"></div>`
    + `<svg class="ws-veil-svg" viewBox="0 0 200 200">`
    + `<defs><radialGradient id="${g}-hub" cx="38%" cy="32%" r="75%">`
    + `<stop offset="0" stop-color="#e8f2ff"/><stop offset=".45" stop-color="#7d8ea3"/><stop offset="1" stop-color="#1c2633"/>`
    + `</radialGradient></defs>`
    + `<path class="ws-veil-track" d="${arc(ARC_R, 0, 1)}"/>`
    + `<path class="ws-veil-bar" d="${arc(ARC_R, 0, 1)}" stroke-dasharray="${ARC_LEN.toFixed(2)}" stroke-dashoffset="${ARC_LEN.toFixed(2)}"/>`
    + FACE
    + `<text class="ws-veil-maker" x="101.5" y="74">GLASS</text>`
    + `<text class="ws-veil-read" x="100" y="150"><tspan class="ws-veil-pct">00</tspan><tspan class="ws-veil-unit" dx="1">%</tspan></text>`
    + `<g class="ws-veil-needle" style="transform:rotate(${angleOf(0)}deg)">`
    + `<path d="M100 21 L102.4 98 L101.5 118 L98.5 118 L97.6 98 Z"/></g>`
    + `<circle cx="100" cy="100" r="8" fill="url(#${g}-hub)"/><circle class="ws-veil-pin" cx="100" cy="100" r="2.2"/>`
    + `</svg><div class="ws-veil-glass"></div></div></div>`
    + `<div class="ws-veil-mark">${esc(wordmark())}</div>`
    + `<div class="ws-veil-sub">Geometry · Lights · Aircraft · Streets &amp; Structures</div></div>`;
}

// No backticks inside this string: it's a template literal (CLAUDE.md, client:smoke).
export const VEIL_CSS = `
    .ws-veil { position:absolute; inset:0; z-index:5; display:flex; flex-direction:column; align-items:center;
      justify-content:center; gap:12px; container-type:size; pointer-events:none; transition:opacity .35s ease;
      background:radial-gradient(circle at 50% 42%, #0d1626 0%, #060a12 55%, #020408 100%); }
    .ws-veil.ws-veil-out { opacity:0; transition-delay:.22s; }

    .ws-veil-dial { position:relative; flex:none; aspect-ratio:1; border-radius:50%;
      width:140px; width:clamp(52px, min(44cqh, 40cqw), 176px);
      background:conic-gradient(from 200deg, #3b4a5e, #121a25 18%, #4a5d75 34%, #101722 52%, #36455a 70%, #0f1620 86%, #3b4a5e);
      box-shadow:0 0 0 1px rgba(143,208,255,.22), 0 1px 0 1px rgba(255,255,255,.05) inset,
        0 14px 34px rgba(0,0,0,.65), 0 0 70px rgba(143,208,255,.10); }
    .ws-veil-face { position:absolute; inset:6%; border-radius:50%; overflow:hidden;
      background:radial-gradient(circle at 50% 50%, #102036 0%, #0a1422 48%, #050a12 100%);
      box-shadow:inset 0 0 0 1px rgba(0,0,0,.8), inset 0 6px 16px rgba(0,0,0,.75), inset 0 -2px 10px rgba(143,208,255,.06); }

    .ws-veil-sweep { position:absolute; inset:0; border-radius:50%; will-change:transform;
      background:conic-gradient(rgba(143,208,255,0) 0deg 270deg, rgba(143,208,255,.07) 335deg, rgba(143,208,255,.22) 359deg, rgba(143,208,255,0) 360deg);
      animation:ws-veil-spin 2.6s linear infinite; }
    @keyframes ws-veil-spin { to { transform:rotate(360deg); } }

    .ws-veil-svg { position:absolute; inset:0; width:100%; height:100%; overflow:visible; }
    .ws-veil-svg path, .ws-veil-svg line { fill:none; }
    .ws-veil-track { stroke:rgba(143,208,255,.10); stroke-width:3; }
    .ws-veil-bar { stroke:#8fd0ff; stroke-width:3; stroke-linecap:round; transition:stroke-dashoffset .35s ease-out;
      filter:drop-shadow(0 0 3px rgba(143,208,255,.7)); }
    .ws-veil-go { stroke:rgba(110,230,160,.55); stroke-width:4; }
    .ws-veil-maj { stroke:rgba(214,234,255,.85); stroke-width:2.2; }
    .ws-veil-min { stroke:rgba(143,208,255,.38); stroke-width:1; }
    .ws-veil-num { fill:rgba(214,234,255,.72); font:600 11px/1 monospace; text-anchor:middle; dominant-baseline:central; }
    .ws-veil-maker { fill:rgba(143,208,255,.62); font:700 10px/1 monospace; letter-spacing:3px; text-anchor:middle; }
    .ws-veil-read { fill:#d6eaff; font:600 17px/1 monospace; text-anchor:middle; }
    .ws-veil-unit { fill:rgba(143,208,255,.6); font-size:10px; }
    .ws-veil-needle { transform-box:view-box; transform-origin:100px 100px;
      transition:transform .45s cubic-bezier(.34,1.45,.64,1); filter:drop-shadow(0 0 3px rgba(255,160,70,.55)); }
    .ws-veil-needle path { fill:#ffad5c; stroke:#ffd9a8; stroke-width:.6; }
    .ws-veil-pin { fill:#0a111b; }

    /* The glass is a bubble, not a flat pane: the edge darkens where the dome curves away, light
       caught inside pools at the bottom rim, a gloss cap sits over the top half and one hard
       hotspot marks the light source. All of it sits over the face, so the needle reads through it. */
    .ws-veil-glass { position:absolute; inset:0; border-radius:50%;
      background:radial-gradient(circle at 50% 112%, rgba(143,208,255,.34) 0%, rgba(143,208,255,.10) 24%, rgba(143,208,255,0) 42%),
        radial-gradient(circle at 50% 46%, rgba(2,6,12,0) 56%, rgba(2,6,12,.32) 84%, rgba(2,6,12,.62) 100%);
      box-shadow:inset 0 0 0 1px rgba(255,255,255,.14), inset 0 -7px 10px -3px rgba(170,225,255,.42),
        inset 0 3px 6px rgba(255,255,255,.10), 0 0 0 1px rgba(0,0,0,.6); }
    .ws-veil-glass::before { content:''; position:absolute; left:13%; right:13%; top:2.5%; height:47%;
      border-radius:50% 50% 48% 48% / 62% 62% 38% 38%;
      background:linear-gradient(180deg, rgba(255,255,255,.52) 0%, rgba(255,255,255,.18) 40%, rgba(255,255,255,.04) 82%, rgba(255,255,255,0) 100%); }
    .ws-veil-glass::after { content:''; position:absolute; left:22%; top:11%; width:17%; height:9%; border-radius:50%;
      background:radial-gradient(closest-side, rgba(255,255,255,.95), rgba(255,255,255,.35) 55%, rgba(255,255,255,0));
      transform:rotate(-32deg); filter:blur(.6px); }

    .ws-veil-mark { font:600 13px/1 monospace; letter-spacing:6px; padding-left:6px; color:rgba(143,208,255,.88);
      text-shadow:0 0 12px rgba(143,208,255,.35); }
    .ws-veil-sub { margin-top:-4px; font:500 9px/1.3 monospace; letter-spacing:2px; padding-left:2px; text-align:center;
      text-transform:uppercase; color:rgba(143,208,255,.42); }
    @container (max-height: 230px) { .ws-veil-sub { display:none; } }
    @container (max-height: 130px) { .ws-veil-mark { display:none; } }

    @media (prefers-reduced-motion: reduce) { .ws-veil-sweep { animation:none; } .ws-veil-needle, .ws-veil-bar { transition:none; } }
    [data-motion="off"] .ws-veil-sweep { animation:none; }
    [data-motion="off"] .ws-veil-needle, [data-motion="off"] .ws-veil-bar { transition:none; }`;

function setProgress(node, p) {
  const bar = node.querySelector('.ws-veil-bar');
  if (bar) bar.setAttribute('stroke-dashoffset', (ARC_LEN * (1 - p)).toFixed(2));
  const needle = node.querySelector('.ws-veil-needle');
  if (needle) needle.style.transform = `rotate(${angleOf(p).toFixed(1)}deg)`;
  const pct = node.querySelector('.ws-veil-pct');
  if (pct) pct.textContent = String(Math.min(100, Math.round(p * 100))).padStart(2, '0');
}

function lift(node) {
  setProgress(node, 1);
  node.classList.add('ws-veil-out');
  setTimeout(() => node.remove(), FADE_MS);
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
