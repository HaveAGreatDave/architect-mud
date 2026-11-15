// The loading veil over a 3D view, a seat or a room: a neon link-up screen laid over it until its first
// frames are drawn. The game's wordmark glitches in a bracketed frame over a scrolling grid floor, with a
// segmented sync bar, a status line and hex rails running down the sides. The renderer isn't named.
//
// There's no build phase ahead of the first frame. Shader compiles, the texture atlas and the city
// mesh are all built lazily inside the first paints, synchronously, and on a cold GPU that's a few
// seconds with a black window. So the veil does two things:
//
//   1. It holds the first two paints back, so the browser gets a frame to put the veil on screen
//      before the main thread goes away to compile.
//   2. Everything that moves on its own (the grid floor, the hex rails, the scan bar, the glitch,
//      the shine on the bar) is a CSS transform or opacity animation, which the compositor runs, so
//      it keeps moving while the main thread is blocked. The bar, the percentage and the status line
//      can only change BETWEEN paints, so they step: each slow paint closes half the remaining gap,
//      and the first fast paint fills the bar and fades the veil.
//
// Engine code: the wordmark is read from the page header (`#header .logo`), not written here, so
// another game on THOMAS gets its own name. Nothing under gl/ is imported, and with no veil element
// in the DOM (the headless smokes, the hangar seat) every call is a Map miss and a null lookup.
import { escapeHtml as esc } from '../../../shared/dom.js';

const HOLD = 2;         // paints skipped so the veil is composited before the first real one
const FAST_MS = 45;     // a paint under this means the builds are done
const SETTLE = 2;       // real paints required before a fast one counts
const MAX_MS = 12000;   // give up and lift the veil regardless
const FADE_MS = 600;    // the bar's fill to the end, then the fade (CSS below), then removal

// The status line, by progress. Read as the bar's caption, so each one covers a stretch of it.
const STAGES = [
  [0.2, 'JACKING IN'],
  [0.5, 'SPINNING UP THE GPU'],
  [0.8, 'PULLING THE CITY OUT OF THE DARK'],
  [1, 'CLEANING UP THE SIGNAL'],
];
const DONE = 'LINK STABLE';
// A room's own captions, for the veil over the Room Stage (`place.room`): what going in through a door takes.
const ROOM_STAGES = [
  [0.2, 'WIPING YOUR FEET'],
  [0.45, 'FINDING THE LIGHT SWITCH'],
  [0.7, 'COUNTING THE FURNITURE'],
  [1, 'PUTTING THE CITY IN THE WINDOWS'],
];
const ROOM_DONE = 'DOOR SHUT BEHIND YOU';
const stageOf = (p, room) => {
  const list = room ? ROOM_STAGES : STAGES;
  return p >= 1 ? (room ? ROOM_DONE : DONE) : (list.find(([to]) => p < to) || list[list.length - 1])[1];
};

// The hex rails never change, so they're built once: a fixed-seed stream of address and byte rows,
// written twice so a translate of exactly half the height loops without a seam.
const RAIL = (() => {
  let x = 0x2f6b9e13;
  const next = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return x >>> 0; };
  const hex = (v, n) => v.toString(16).toUpperCase().padStart(n, '0').slice(-n);
  const rows = [];
  for (let i = 0; i < 28; i++) {
    const b = [next(), next(), next(), next()].map(v => hex(v & 0xff, 2)).join(' ');
    rows.push(`${hex(0x7f000 + i * 16, 5)}  ${b}`);
  }
  const s = rows.join('\n');
  return s + '\n' + s;
})();

const _state = new Map();   // id → { calls, paints, t0, p, worst, done }

function el(id) {
  return typeof document === 'undefined' ? null : document.getElementById(id + '-veil');
}

function wordmark() {
  const t = typeof document !== 'undefined' && document.querySelector('#header .logo')?.textContent;
  return String(t || '').trim() || 'LOADING';
}

// A four-digit tag from the seat id, so each seat reads as its own feed. Flavour, not an address.
function feedTag(id) {
  let h = 0x811c9dc5;
  for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  return ((h >>> 0) & 0xffff).toString(16).toUpperCase().padStart(4, '0');
}

// Where you're going, under the wordmark: `place` is { kicker, title, sub, blurb, room }, all optional, all the
// caller's (the game's names and prose come from the server; nothing here knows a building).
function placeHTML(place) {
  if (!place || !(place.title || place.sub || place.blurb)) return '<div class="ws-veil-place" hidden></div>';
  return `<div class="ws-veil-place">`
    + (place.kicker ? `<span class="ws-veil-kicker">${esc(place.kicker)}</span>` : '')
    + (place.title ? `<b class="ws-veil-title">${esc(place.title)}</b>` : '')
    + (place.sub ? `<span class="ws-veil-sub">${esc(place.sub)}</span>` : '')
    + (place.blurb ? `<p class="ws-veil-blurb">${esc(place.blurb)}</p>` : '')
    + `</div>`;
}

export function veilHTML(id, place = null) {
  const name = esc(wordmark());
  return `<div class="ws-veil${place?.room ? ' ws-veil-room' : ''}" id="${esc(id)}-veil" aria-hidden="true">`
    + `<div class="ws-veil-horizon"></div>`
    + `<div class="ws-veil-grid"><div class="ws-veil-plane"><div class="ws-veil-floor"></div></div></div>`
    + `<pre class="ws-veil-rail ws-veil-rail-l"><span>${RAIL}</span></pre>`
    + `<pre class="ws-veil-rail ws-veil-rail-r"><span>${RAIL}</span></pre>`
    + `<div class="ws-veil-core">`
    + `<div class="ws-veil-tag"><span>// NEURAL LINK</span><span>FEED ${feedTag(id)}<i class="ws-veil-blink"></i></span></div>`
    + `<div class="ws-veil-mark" data-text="${name}">${name}</div>`
    + placeHTML(place)
    + `<div class="ws-veil-bar"><div class="ws-veil-fill"></div><div class="ws-veil-shine"></div></div>`
    + `<div class="ws-veil-foot"><span class="ws-veil-msg">${stageOf(0, place?.room)}</span><span class="ws-veil-pct">00%</span></div>`
    + `</div>`
    + `<div class="ws-veil-scan"></div><div class="ws-veil-lines"></div></div>`;
}

// No backticks inside this string: it's a template literal (CLAUDE.md, client:smoke).
export const VEIL_CSS = `
    .ws-veil { --vc:var(--cyan, #00f0ff); --vm:var(--accent, #ff2bd6); --vy:#f5e663;
      position:absolute; inset:0; z-index:5; overflow:hidden; display:flex; align-items:center; justify-content:center;
      container-type:size; pointer-events:none; transition:opacity .35s ease;
      font-family:ui-monospace, 'Cascadia Mono', Consolas, monospace;
      background:radial-gradient(ellipse 70% 50% at 50% 62%, color-mix(in srgb, var(--vm) 16%, transparent), color-mix(in srgb, var(--vm) 0%, transparent) 70%),
        radial-gradient(ellipse 60% 45% at 50% 30%, color-mix(in srgb, var(--vc) 10%, transparent), color-mix(in srgb, var(--vc) 0%, transparent) 70%),
        linear-gradient(180deg, color-mix(in srgb, var(--bg, #05050a) 80%, #000) 0%, var(--bg, #05050a) 58%, color-mix(in srgb, var(--vm) 6%, var(--bg, #05050a)) 100%); }
    .ws-veil.ws-veil-out { opacity:0; transition-delay:.22s; }

    /* The horizon: a hard magenta line where the floor meets the sky, and its bloom. */
    .ws-veil-horizon { position:absolute; left:0; right:0; top:62%; height:1px;
      background:linear-gradient(90deg, color-mix(in srgb, var(--vm) 0%, transparent), var(--vm) 20%, color-mix(in srgb, var(--vm) 30%, #fff) 50%, var(--vm) 80%, color-mix(in srgb, var(--vm) 0%, transparent));
      box-shadow:0 0 18px 3px color-mix(in srgb, var(--vm) 55%, transparent), 0 0 60px 10px color-mix(in srgb, var(--vm) 18%, transparent); }

    /* The floor: a grid on a plane tipped back in perspective. The plane itself never moves; a tall
       sheet inside it slides one cell toward the viewer and loops, which is a transform, so the
       compositor keeps it running through a blocked main thread. */
    .ws-veil-grid { position:absolute; left:-40%; right:-40%; top:62%; bottom:0; perspective:220px; perspective-origin:50% 0;
      overflow:hidden; -webkit-mask-image:linear-gradient(180deg, transparent 0%, #000 35%); mask-image:linear-gradient(180deg, transparent 0%, #000 35%); }
    .ws-veil-plane { position:absolute; left:0; right:0; top:0; height:300%; transform-origin:50% 0; transform:rotateX(68deg); overflow:hidden; }
    .ws-veil-floor { position:absolute; left:0; right:0; top:-40px; bottom:0; will-change:transform;
      background:repeating-linear-gradient(90deg, color-mix(in srgb, var(--vm) 75%, transparent) 0 2px, transparent 2px 40px),
        repeating-linear-gradient(0deg, color-mix(in srgb, var(--vm) 75%, transparent) 0 2px, transparent 2px 40px);
      animation:ws-veil-drive 0.9s linear infinite; }
    @keyframes ws-veil-drive { to { transform:translateY(40px); } }

    /* Hex rails: a fixed byte dump scrolling up each side, half the height per loop. */
    .ws-veil-rail { position:absolute; top:0; bottom:0; margin:0; overflow:hidden; font-size:9px; line-height:13px;
      color:color-mix(in srgb, var(--vc) 28%, transparent); white-space:pre; letter-spacing:1px;
      -webkit-mask-image:linear-gradient(180deg, transparent, #000 15%, #000 85%, transparent);
      mask-image:linear-gradient(180deg, transparent, #000 15%, #000 85%, transparent); }
    .ws-veil-rail span { display:block; will-change:transform; animation:ws-veil-rise 14s linear infinite; }
    .ws-veil-rail-l { left:14px; }
    .ws-veil-rail-r { right:14px; text-align:right; color:color-mix(in srgb, var(--vm) 24%, transparent); }
    .ws-veil-rail-r span { animation-duration:19s; animation-direction:reverse; }
    @keyframes ws-veil-rise { to { transform:translateY(-50%); } }

    /* The frame: corner brackets drawn by the two pseudo-elements, a dark glass panel behind. */
    .ws-veil-core { position:relative; width:min(440px, 78cqw); padding:18px 22px 16px;
      display:flex; flex-direction:column; gap:10px;
      background:linear-gradient(180deg, rgba(8,4,20,.72), rgba(8,4,20,.55));
      box-shadow:0 0 0 1px color-mix(in srgb, var(--vc) 12%, transparent), 0 0 40px color-mix(in srgb, var(--vc) 8%, transparent), inset 0 0 30px color-mix(in srgb, var(--vm) 6%, transparent); }
    .ws-veil-core::before, .ws-veil-core::after { content:''; position:absolute; width:18px; height:18px; border:2px solid var(--vc);
      filter:drop-shadow(0 0 4px color-mix(in srgb, var(--vc) 80%, transparent)); }
    .ws-veil-core::before { top:-3px; left:-3px; border-right:0; border-bottom:0; }
    .ws-veil-core::after { bottom:-3px; right:-3px; border-left:0; border-top:0; }

    .ws-veil-tag { display:flex; justify-content:space-between; gap:12px; font-size:9px; letter-spacing:2px; color:color-mix(in srgb, var(--vc) 60%, transparent); }
    .ws-veil-tag span:last-child { color:var(--vy); }
    .ws-veil-blink { display:inline-block; width:6px; height:9px; margin-left:4px; vertical-align:-1px; background:var(--vy);
      animation:ws-veil-blink 1s steps(1) infinite; }
    @keyframes ws-veil-blink { 50% { opacity:0; } }

    /* The wordmark, with a magenta and a cyan copy behind it that jump out of register now and then.
       Both are translated, never clipped, so the glitch is compositor work too. */
    .ws-veil-mark { position:relative; align-self:center; padding-left:.32em; font-weight:800; font-style:italic;
      font-size:clamp(16px, 8cqw, 40px); line-height:1.1; letter-spacing:.32em; color:color-mix(in srgb, var(--vc) 12%, #fff);
      text-shadow:0 0 10px color-mix(in srgb, var(--vc) 75%, transparent), 0 0 28px color-mix(in srgb, var(--vc) 35%, transparent); }
    .ws-veil-mark::before, .ws-veil-mark::after { content:attr(data-text); position:absolute; left:0; top:0; padding-left:.32em;
      opacity:.8; mix-blend-mode:screen; text-shadow:none; will-change:transform; }
    .ws-veil-mark::before { color:var(--vm); animation:ws-veil-glitch-a 3.1s steps(1) infinite; }
    .ws-veil-mark::after { color:var(--vc); animation:ws-veil-glitch-b 2.3s steps(1) infinite; }
    @keyframes ws-veil-glitch-a { 0% { transform:translate(-2px, 0); } 7% { transform:translate(5px, -2px); } 9% { transform:translate(-2px, 0); }
      52% { transform:translate(-7px, 1px); } 54% { transform:translate(2px, 0); } 56% { transform:translate(-2px, 0); } }
    @keyframes ws-veil-glitch-b { 0% { transform:translate(2px, 0); } 31% { transform:translate(-5px, 2px); } 33% { transform:translate(2px, 0); }
      78% { transform:translate(6px, -1px); } 79% { transform:translate(-3px, 1px); } 81% { transform:translate(2px, 0); } }

    /* The sync bar: a cyan-to-magenta fill scaled from the left, cut into segments by the gaps laid
       over it, with a white shine running across it on the compositor. */
    .ws-veil-bar { position:relative; height:12px; overflow:hidden; background:color-mix(in srgb, var(--vc) 7%, transparent);
      box-shadow:0 0 0 1px color-mix(in srgb, var(--vc) 35%, transparent), 0 0 12px color-mix(in srgb, var(--vc) 15%, transparent); }
    .ws-veil-fill { position:absolute; inset:0; transform-origin:0 50%; transform:scaleX(0);
      background:linear-gradient(90deg, var(--vc), var(--vm)); box-shadow:0 0 12px color-mix(in srgb, var(--vm) 60%, transparent);
      transition:transform .35s ease-out; }
    .ws-veil-bar::after { content:''; position:absolute; inset:0;
      background:repeating-linear-gradient(90deg, transparent 0 9px, #08041a 9px 12px); }
    .ws-veil-shine { position:absolute; top:0; bottom:0; left:0; width:30%; will-change:transform;
      background:linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,.35), rgba(255,255,255,0));
      animation:ws-veil-shine 1.6s ease-in-out infinite; }
    @keyframes ws-veil-shine { from { transform:translateX(-100%); } to { transform:translateX(340%); } }

    /* Where you're going: a kicker, the building's name, the room and its street, and a line of its own description,
       quoted, under the wordmark. The wordmark steps down a size over a place, so the name is what reads. */
    .ws-veil-place { display:flex; flex-direction:column; align-items:center; gap:3px; text-align:center; padding:2px 0 4px;
      animation:ws-veil-in .5s ease-out backwards; }
    .ws-veil-place[hidden] { display:none; }
    .ws-veil-room .ws-veil-mark { font-size:clamp(12px, 4.6cqw, 22px); }
    .ws-veil-kicker { font-size:9px; letter-spacing:3px; color:var(--vm); }
    .ws-veil-kicker::before, .ws-veil-kicker::after { content:'\\2014\\2002'; color:color-mix(in srgb, var(--vm) 45%, transparent); }
    .ws-veil-kicker::after { content:'\\2002\\2014'; }
    .ws-veil-title { font-family:Georgia, 'Times New Roman', serif; font-weight:700; font-size:clamp(15px, 5.4cqw, 26px); line-height:1.15;
      letter-spacing:.04em; color:#f6ead2; text-shadow:0 0 14px color-mix(in srgb, var(--vy) 30%, transparent); }
    .ws-veil-sub { font-size:10px; letter-spacing:2px; text-transform:uppercase; color:color-mix(in srgb, var(--vc) 70%, #fff); }
    .ws-veil-blurb { margin:6px 0 0; max-width:38em; font-family:Georgia, 'Times New Roman', serif; font-style:italic; font-size:12px; line-height:1.45;
      color:rgba(234,236,240,.72); display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
    .ws-veil-blurb::before { content:'\\201C'; color:var(--vy); } .ws-veil-blurb::after { content:'\\201D'; color:var(--vy); }
    @keyframes ws-veil-in { from { opacity:0; transform:translateY(4px); } }
    /* Before the room's own code is in (preVeil): fixed over the pane it will cover, and faded in after the black. */
    .ws-veil-pre { position:fixed; z-index:9002; pointer-events:none; overflow:hidden; background:#000; }
    .ws-veil-pre > .ws-veil { animation:ws-veil-in .3s ease-out backwards; }

    .ws-veil-foot { display:flex; justify-content:space-between; align-items:baseline; gap:12px; }
    .ws-veil-msg { font-size:10px; letter-spacing:2px; color:rgba(234,252,255,.78); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .ws-veil-msg::before { content:'> '; color:var(--vm); }
    .ws-veil-pct { font-size:15px; font-weight:700; color:var(--vy); text-shadow:0 0 8px rgba(245,230,99,.55); }

    /* A bright band rolling down the screen, then fixed scanlines and a vignette over everything. */
    .ws-veil-scan { position:absolute; left:0; right:0; top:0; height:18%; will-change:transform;
      background:linear-gradient(180deg, color-mix(in srgb, var(--vc) 0%, transparent), color-mix(in srgb, var(--vc) 6%, transparent) 80%, color-mix(in srgb, var(--vc) 14%, transparent));
      animation:ws-veil-roll 3.8s linear infinite; }
    @keyframes ws-veil-roll { from { transform:translateY(-100%); } to { transform:translateY(560%); } }
    .ws-veil-lines { position:absolute; inset:0;
      background:repeating-linear-gradient(180deg, rgba(0,0,0,.22) 0 1px, transparent 1px 3px),
        radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(0,0,0,.6) 100%); }

    @container (max-width: 520px) { .ws-veil-rail { display:none; } }
    @container (max-height: 360px) { .ws-veil-blurb { display:none; } }
    @container (max-height: 230px) { .ws-veil-tag, .ws-veil-sub { display:none; } .ws-veil-core { padding:12px 16px 10px; gap:8px; } }
    @container (max-height: 130px) { .ws-veil-mark, .ws-veil-grid, .ws-veil-horizon { display:none; } .ws-veil-core { padding:8px 12px; } }

    @media (prefers-reduced-motion: reduce) {
      .ws-veil-floor, .ws-veil-rail span, .ws-veil-blink, .ws-veil-mark::before, .ws-veil-mark::after, .ws-veil-shine, .ws-veil-scan { animation:none; }
      .ws-veil-fill { transition:none; } .ws-veil-scan, .ws-veil-shine { display:none; } }
    [data-motion="off"] .ws-veil-floor, [data-motion="off"] .ws-veil-rail span, [data-motion="off"] .ws-veil-blink,
    [data-motion="off"] .ws-veil-mark::before, [data-motion="off"] .ws-veil-mark::after { animation:none; }
    [data-motion="off"] .ws-veil-shine, [data-motion="off"] .ws-veil-scan { display:none; }
    [data-motion="off"] .ws-veil-fill { transition:none; }`;

function setProgress(node, p) {
  const fill = node.querySelector('.ws-veil-fill');
  if (fill) fill.style.transform = `scaleX(${Math.min(1, p).toFixed(3)})`;
  const pct = node.querySelector('.ws-veil-pct');
  if (pct) pct.textContent = String(Math.min(100, Math.round(p * 100))).padStart(2, '0') + '%';
  const msg = node.querySelector('.ws-veil-msg');
  if (msg) msg.textContent = stageOf(p, node.classList.contains('ws-veil-room'));
  node._p = p;
}

function lift(node) {
  setProgress(node, 1);
  node.classList.add('ws-veil-out');
  // a pre-veil goes with its fixed holder
  const gone = node.parentElement?.classList.contains('ws-veil-pre') ? node.parentElement : node;
  setTimeout(() => gone.remove(), FADE_MS);
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
  // (a veil that went up before its view did, preVeil, carries on from where its bar had got to)
  if (!s) { s = { calls: 0, paints: 0, t0: performance.now(), p: Math.max(0.06, node._p || 0), worst: 0, done: false }; _state.set(id, s); setProgress(node, s.p); }
  return ++s.calls <= HOLD;
}

// One listener for every real paint and its cost, for the frame summary in fps-meter.js. This is
// the only place outside windshield.js that is handed each paint's wall time, and a module the game
// client can import without loading the renderer. Null until the client sets it.
let _paintTap = null;
export function setPaintTap(fn) { _paintTap = fn || null; }

// Called after a real paint with its cost in ms.
export function veilPainted(id, ms) {
  if (_paintTap) _paintTap(id, ms);
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

// The veil over a 3-D view that isn't a windshield: a flat, a box at the ballpark, the Kitchen Stage.
// `host` is what it covers. It watches the view's frames from outside rather than being called by
// them, because the veil only has to know one thing: the main thread has stopped being held up. A
// frame that took a long time is a build still going on, and a run of short ones is the view up.
// `ready` holds it down for longer, for a view with more to fetch than its first frame.
const COVER_MAX_MS = 25000;
function ensureCss() {
  if (document.getElementById('glass-veil-css')) return;
  const s = document.createElement('style');
  s.id = 'glass-veil-css'; s.textContent = VEIL_CSS;
  document.head.appendChild(s);
}
// the fixed holder a pre-veil stands in, or null for a veil inside its host
const preOf = (node) => (node?.parentElement?.classList.contains('ws-veil-pre') ? node.parentElement : null);
const fit = (wrap, r) => Object.assign(wrap.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
export function coverWithVeil(host, id, { ready = () => true, place = null } = {}) {
  if (typeof document === 'undefined' || !host) return;
  ensureCss();
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  veilReset(id);
  // a veil put up before this view's code was in (preVeil) is taken over where it stands, not drawn again, so its
  // floor and its bar run on unbroken; it follows the host's box from here
  const pre = preOf(el(id));
  if (pre) { clearTimeout(pre._ttl); pre._adopted = true; if (place) placeVeil(id, place); }
  else host.insertAdjacentHTML('beforeend', veilHTML(id, place));
  const t0 = performance.now();
  let last = t0;
  const step = (now) => {
    const node = el(id), s = _state.get(id);
    if (!node || s?.done) return;
    if (pre && pre.isConnected) { const r = host.getBoundingClientRect(); if (r.width && r.height) fit(pre, r); }
    const ms = now - last;
    last = now;
    if (!veilHold(id)) {
      const st = _state.get(id);
      if (!ready() && now - t0 < COVER_MAX_MS) { st.p += (0.92 - st.p) * 0.015; setProgress(node, st.p); }
      else if (now - t0 > COVER_MAX_MS) { st.done = true; lift(node); return; }
      else veilPainted(id, ms);
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Called when a seat closes, so the next entry shows the veil again (its GL context is rebuilt).
export function veilReset(id) { _state.delete(id); }

// ── THE VEIL BEFORE THE VIEW ─────────────────────────────────────────────────
// A view that loads lazily (the Room Stage: the server's answer, then its module) showed nothing for the second or
// more that took. This puts the veil up at once, fixed over `rect` (the pane it will cover), its bar creeping on its
// own, and coverWithVeil takes it over when the view comes in. If nobody does within `ttl` ms (the server said no),
// it goes. `delay` holds it back, for a cover that fades to black first. Returns the holder, or null.
const PRE_CREEP_MS = 120, PRE_TOP = 0.55;
export function preVeil(id, rect, { place = null, ttl = 9000, delay = 0, z = 9002 } = {}) {
  if (typeof document === 'undefined' || !rect || !(rect.width > 0) || !(rect.height > 0)) return null;
  const had = el(id);
  if (had && !preOf(had)) return null;   // the view's own veil is up already
  dropPreVeil(id, true);
  ensureCss();
  const wrap = document.createElement('div');
  wrap.className = 'ws-veil-pre'; wrap.setAttribute('aria-hidden', 'true');
  wrap.style.zIndex = String(z);
  fit(wrap, rect);
  wrap.innerHTML = veilHTML(id, place);
  const node = wrap.firstElementChild;
  if (delay) node.style.animationDelay = delay + 'ms';
  document.body.appendChild(wrap);
  setProgress(node, 0.04);
  const creep = () => {
    if (!wrap.isConnected || wrap._adopted) return;
    setProgress(node, (node._p || 0) + (PRE_TOP - (node._p || 0)) * 0.06);
    wrap._creep = setTimeout(creep, PRE_CREEP_MS);
  };
  wrap._creep = setTimeout(creep, PRE_CREEP_MS + delay);
  wrap._ttl = setTimeout(() => dropPreVeil(id), ttl);
  return wrap;
}
// A pre-veil nobody took, faded off (or gone at once).
export function dropPreVeil(id, now = false) {
  const wrap = preOf(el(id));
  if (!wrap || wrap._adopted) return;
  clearTimeout(wrap._ttl); clearTimeout(wrap._creep);
  if (now) { wrap.remove(); return; }
  wrap.style.transition = 'opacity .3s ease'; wrap.style.opacity = '0';
  setTimeout(() => wrap.remove(), 350);
}
// The place on a veil that's up, filled in when the server's answer brings it (the description, the street).
export function placeVeil(id, place) {
  const node = el(id), old = node?.querySelector('.ws-veil-place');
  if (!old || !place) return;
  const was = old.querySelector('.ws-veil-title')?.textContent || '';
  old.outerHTML = placeHTML(place);
  // the same name again isn't a new arrival: no second fade in
  if (was && was === (place.title || '')) { const n = node.querySelector('.ws-veil-place'); if (n) n.style.animation = 'none'; }
  node.classList.toggle('ws-veil-room', !!place.room);
}
// The bar to the end on a veil whose holder is about to fade it off (the street door's cover, room-stage.js arrive).
export function finishVeil(id) {
  const node = el(id);
  if (!node) return;
  const wrap = preOf(node);
  if (wrap) { clearTimeout(wrap._ttl); clearTimeout(wrap._creep); }
  setProgress(node, 1);
}
