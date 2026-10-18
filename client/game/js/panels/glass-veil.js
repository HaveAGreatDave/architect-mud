// The loading veil over a 3D seat: a neon link-up screen laid over the view until its first frames
// are drawn. The game's wordmark glitches in a bracketed frame over a scrolling grid floor, with a
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
const stageOf = p => p >= 1 ? DONE : (STAGES.find(([to]) => p < to) || STAGES[STAGES.length - 1])[1];

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

function esc(s) { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }

// A four-digit tag from the seat id, so each seat reads as its own feed. Flavour, not an address.
function feedTag(id) {
  let h = 0x811c9dc5;
  for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  return ((h >>> 0) & 0xffff).toString(16).toUpperCase().padStart(4, '0');
}

export function veilHTML(id) {
  const name = esc(wordmark());
  return `<div class="ws-veil" id="${esc(id)}-veil" aria-hidden="true">`
    + `<div class="ws-veil-horizon"></div>`
    + `<div class="ws-veil-grid"><div class="ws-veil-plane"><div class="ws-veil-floor"></div></div></div>`
    + `<pre class="ws-veil-rail ws-veil-rail-l"><span>${RAIL}</span></pre>`
    + `<pre class="ws-veil-rail ws-veil-rail-r"><span>${RAIL}</span></pre>`
    + `<div class="ws-veil-core">`
    + `<div class="ws-veil-tag"><span>// NEURAL LINK</span><span>FEED ${feedTag(id)}<i class="ws-veil-blink"></i></span></div>`
    + `<div class="ws-veil-mark" data-text="${name}">${name}</div>`
    + `<div class="ws-veil-bar"><div class="ws-veil-fill"></div><div class="ws-veil-shine"></div></div>`
    + `<div class="ws-veil-foot"><span class="ws-veil-msg">${STAGES[0][1]}</span><span class="ws-veil-pct">00%</span></div>`
    + `</div>`
    + `<div class="ws-veil-scan"></div><div class="ws-veil-lines"></div></div>`;
}

// No backticks inside this string: it's a template literal (CLAUDE.md, client:smoke).
export const VEIL_CSS = `
    .ws-veil { --vc:#00f0ff; --vm:#ff2bd6; --vy:#f5e663;
      position:absolute; inset:0; z-index:5; overflow:hidden; display:flex; align-items:center; justify-content:center;
      container-type:size; pointer-events:none; transition:opacity .35s ease;
      font-family:ui-monospace, 'Cascadia Mono', Consolas, monospace;
      background:radial-gradient(ellipse 70% 50% at 50% 62%, rgba(255,43,214,.16), rgba(255,43,214,0) 70%),
        radial-gradient(ellipse 60% 45% at 50% 30%, rgba(0,240,255,.10), rgba(0,240,255,0) 70%),
        linear-gradient(180deg, #05020c 0%, #0b0418 58%, #12031a 100%); }
    .ws-veil.ws-veil-out { opacity:0; transition-delay:.22s; }

    /* The horizon: a hard magenta line where the floor meets the sky, and its bloom. */
    .ws-veil-horizon { position:absolute; left:0; right:0; top:62%; height:1px;
      background:linear-gradient(90deg, rgba(255,43,214,0), var(--vm) 20%, #ffd0f4 50%, var(--vm) 80%, rgba(255,43,214,0));
      box-shadow:0 0 18px 3px rgba(255,43,214,.55), 0 0 60px 10px rgba(255,43,214,.18); }

    /* The floor: a grid on a plane tipped back in perspective. The plane itself never moves; a tall
       sheet inside it slides one cell toward the viewer and loops, which is a transform, so the
       compositor keeps it running through a blocked main thread. */
    .ws-veil-grid { position:absolute; left:-40%; right:-40%; top:62%; bottom:0; perspective:220px; perspective-origin:50% 0;
      overflow:hidden; -webkit-mask-image:linear-gradient(180deg, transparent 0%, #000 35%); mask-image:linear-gradient(180deg, transparent 0%, #000 35%); }
    .ws-veil-plane { position:absolute; left:0; right:0; top:0; height:300%; transform-origin:50% 0; transform:rotateX(68deg); overflow:hidden; }
    .ws-veil-floor { position:absolute; left:0; right:0; top:-40px; bottom:0; will-change:transform;
      background:repeating-linear-gradient(90deg, rgba(255,43,214,.75) 0 2px, transparent 2px 40px),
        repeating-linear-gradient(0deg, rgba(255,43,214,.75) 0 2px, transparent 2px 40px);
      animation:ws-veil-drive 0.9s linear infinite; }
    @keyframes ws-veil-drive { to { transform:translateY(40px); } }

    /* Hex rails: a fixed byte dump scrolling up each side, half the height per loop. */
    .ws-veil-rail { position:absolute; top:0; bottom:0; margin:0; overflow:hidden; font-size:9px; line-height:13px;
      color:rgba(0,240,255,.28); white-space:pre; letter-spacing:1px;
      -webkit-mask-image:linear-gradient(180deg, transparent, #000 15%, #000 85%, transparent);
      mask-image:linear-gradient(180deg, transparent, #000 15%, #000 85%, transparent); }
    .ws-veil-rail span { display:block; will-change:transform; animation:ws-veil-rise 14s linear infinite; }
    .ws-veil-rail-l { left:14px; }
    .ws-veil-rail-r { right:14px; text-align:right; color:rgba(255,43,214,.24); }
    .ws-veil-rail-r span { animation-duration:19s; animation-direction:reverse; }
    @keyframes ws-veil-rise { to { transform:translateY(-50%); } }

    /* The frame: corner brackets drawn by the two pseudo-elements, a dark glass panel behind. */
    .ws-veil-core { position:relative; width:min(440px, 78cqw); padding:18px 22px 16px;
      display:flex; flex-direction:column; gap:10px;
      background:linear-gradient(180deg, rgba(8,4,20,.72), rgba(8,4,20,.55));
      box-shadow:0 0 0 1px rgba(0,240,255,.12), 0 0 40px rgba(0,240,255,.08), inset 0 0 30px rgba(255,43,214,.06); }
    .ws-veil-core::before, .ws-veil-core::after { content:''; position:absolute; width:18px; height:18px; border:2px solid var(--vc);
      filter:drop-shadow(0 0 4px rgba(0,240,255,.8)); }
    .ws-veil-core::before { top:-3px; left:-3px; border-right:0; border-bottom:0; }
    .ws-veil-core::after { bottom:-3px; right:-3px; border-left:0; border-top:0; }

    .ws-veil-tag { display:flex; justify-content:space-between; gap:12px; font-size:9px; letter-spacing:2px; color:rgba(0,240,255,.6); }
    .ws-veil-tag span:last-child { color:var(--vy); }
    .ws-veil-blink { display:inline-block; width:6px; height:9px; margin-left:4px; vertical-align:-1px; background:var(--vy);
      animation:ws-veil-blink 1s steps(1) infinite; }
    @keyframes ws-veil-blink { 50% { opacity:0; } }

    /* The wordmark, with a magenta and a cyan copy behind it that jump out of register now and then.
       Both are translated, never clipped, so the glitch is compositor work too. */
    .ws-veil-mark { position:relative; align-self:center; padding-left:.32em; font-weight:800; font-style:italic;
      font-size:clamp(16px, 8cqw, 40px); line-height:1.1; letter-spacing:.32em; color:#eafcff;
      text-shadow:0 0 10px rgba(0,240,255,.75), 0 0 28px rgba(0,240,255,.35); }
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
    .ws-veil-bar { position:relative; height:12px; overflow:hidden; background:rgba(0,240,255,.07);
      box-shadow:0 0 0 1px rgba(0,240,255,.35), 0 0 12px rgba(0,240,255,.15); }
    .ws-veil-fill { position:absolute; inset:0; transform-origin:0 50%; transform:scaleX(0);
      background:linear-gradient(90deg, var(--vc), var(--vm)); box-shadow:0 0 12px rgba(255,43,214,.6);
      transition:transform .35s ease-out; }
    .ws-veil-bar::after { content:''; position:absolute; inset:0;
      background:repeating-linear-gradient(90deg, transparent 0 9px, #08041a 9px 12px); }
    .ws-veil-shine { position:absolute; top:0; bottom:0; left:0; width:30%; will-change:transform;
      background:linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,.35), rgba(255,255,255,0));
      animation:ws-veil-shine 1.6s ease-in-out infinite; }
    @keyframes ws-veil-shine { from { transform:translateX(-100%); } to { transform:translateX(340%); } }

    .ws-veil-foot { display:flex; justify-content:space-between; align-items:baseline; gap:12px; }
    .ws-veil-msg { font-size:10px; letter-spacing:2px; color:rgba(234,252,255,.78); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .ws-veil-msg::before { content:'> '; color:var(--vm); }
    .ws-veil-pct { font-size:15px; font-weight:700; color:var(--vy); text-shadow:0 0 8px rgba(245,230,99,.55); }

    /* A bright band rolling down the screen, then fixed scanlines and a vignette over everything. */
    .ws-veil-scan { position:absolute; left:0; right:0; top:0; height:18%; will-change:transform;
      background:linear-gradient(180deg, rgba(0,240,255,0), rgba(0,240,255,.06) 80%, rgba(0,240,255,.14));
      animation:ws-veil-roll 3.8s linear infinite; }
    @keyframes ws-veil-roll { from { transform:translateY(-100%); } to { transform:translateY(560%); } }
    .ws-veil-lines { position:absolute; inset:0;
      background:repeating-linear-gradient(180deg, rgba(0,0,0,.22) 0 1px, transparent 1px 3px),
        radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(0,0,0,.6) 100%); }

    @container (max-width: 520px) { .ws-veil-rail { display:none; } }
    @container (max-height: 230px) { .ws-veil-tag { display:none; } .ws-veil-core { padding:12px 16px 10px; gap:8px; } }
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
  if (msg) msg.textContent = stageOf(p);
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
