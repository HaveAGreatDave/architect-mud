// COLOUR PICKER — the draggable hue-strip + saturation/value popover, shared.
//
// This started life inside the hangar bench, where it replaced the native
// <input type=color> because the OS-level dialog swallows drag gestures and
// closes on the first click. It is lifted out here unchanged in behaviour so the
// spray can uses the SAME wheel the paint shop does, rather than a second one
// that drifts. Nothing about it knows what it is colouring: it takes a value and
// hands back a value, on every drag frame.
//
// The rules it was hardened into, all of which used to eat the drag and none of
// which are optional:
//   • It is mounted on <body> as position:fixed, never inside the control that
//     opened it. Nested in a <label> (a <button> is a labelable element) every
//     click inside the popover was forwarded back to the swatch and toggled it
//     shut; nested in a card it was clipped by that card's overflow.
//   • Every pointerdown inside it is preventDefault()ed, so no synthetic click
//     and no text selection is ever generated.
//   • It stays open until you dismiss it (✕ / Done / Esc). Picking a colour
//     never closes it, so you can nudge the swatch as much as you like.
//
// THEME: the CSS lives here but the LOOK comes from whoever opened it. The rules
// are written against --hb-* / --tos-* custom properties, and `themeFrom` names
// an element to copy them off — the popover lives on <body>, outside any panel
// root, where those properties aren't inherited. So the hangar's picker is brass
// and the spray can's is whatever the can is, with one stylesheet.
//
// The class names keep their original `hb-cp-` prefix on purpose: they are global
// rules that predate this file, and renaming them would be churn in a stylesheet
// nobody is otherwise touching.

const clamp01 = (n) => n < 0 ? 0 : n > 1 ? 1 : n;

export function hex2hsv(hex) {
  const n = parseInt((hex || '#808080').replace('#', ''), 16);
  const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsv2hex(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  return '#' + [r, g, b].map(ch => Math.round(clamp01(ch + m) * 255).toString(16).padStart(2, '0')).join('');
}

function drawSV(canvas, hue) {
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  ctx.fillStyle = hsv2hex(hue, 1, 1); ctx.fillRect(0, 0, w, h);
  let g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}

// The theme tokens carried onto the detached popover when it opens.
const CP_VARS = ['--hb-atm-accent', '--hb-surf', '--hb-surf-lo', '--hb-surf-mid', '--hb-bevel-hi',
  '--hb-bevel-lo', '--tos-fg', '--tos-fg-dim', '--tos-fg-dim2', '--bg', '--bg2', '--border', '--text', '--text-dim'];

// The stock rattle-can rack — one-tap colours, and the drag rig is untouched by them.
export const CP_QUICK = ['#e8e8e8', '#b9c2c8', '#7d858c', '#2b3036', '#0d0f12', '#8e1f1f', '#d4531f', '#e0a52a',
  '#3f7a2e', '#1f6f8e', '#22304f', '#5b2f7a', '#c05a8e', '#c9a227', '#d8cdb4', '#4a3b2a'];

let cpState = null;   // { key, pop, anchor, hue, sat, val, reposition, onKey, onChange, onClose }

function ensureStyles() {
  if (document.getElementById('cp-shared-styles')) return;
  const st = document.createElement('style');
  st.id = 'cp-shared-styles';
  st.textContent = `
  .hb-cp-pop { position:fixed; z-index:100000; padding:12px; width:264px; border-radius:12px;
    font-family:inherit; animation:hbCpIn .14s ease-out;
    background:linear-gradient(165deg, var(--hb-surf), var(--hb-surf-lo));
    border:1px solid color-mix(in srgb, var(--hb-atm-accent) 40%, transparent);
    box-shadow:inset 0 1px 0 var(--hb-bevel-hi), inset 0 -2px 3px var(--hb-bevel-lo), 0 16px 40px rgba(0,0,0,0.55),
      0 0 22px color-mix(in srgb, var(--hb-atm-accent) 18%, transparent); }
  @keyframes hbCpIn { from { opacity:0; transform:translateY(-6px) scale(0.97); } to { opacity:1; transform:none; } }
  .hb-cp-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:9px; }
  .hb-cp-title { font-size:0.5625rem; letter-spacing:2px; text-transform:uppercase; color:var(--tos-fg-dim); }
  .hb-cp-close { width:1.833em; height:1.833em; padding:0; line-height:1; font-family:inherit; font-size:0.75rem; cursor:pointer;
    color:var(--tos-fg-dim); background:linear-gradient(165deg, var(--hb-surf), var(--hb-surf-lo));
    border:1px solid color-mix(in srgb, var(--hb-atm-accent) 30%, transparent); border-radius:6px;
    box-shadow:inset 0 1px 0 var(--hb-bevel-hi); transition:filter .12s, color .12s; }
  .hb-cp-close:hover { filter:brightness(1.15); color:var(--tos-fg); border-color:var(--hb-atm-accent); }
  .hb-cp-close:active { transform:translateY(1px); box-shadow:inset 0 1px 3px var(--hb-bevel-lo); }
  .hb-cp-foot { display:flex; gap:8px; margin-top:10px; }
  .hb-cp-done { flex:1 1 auto; padding:8px; font-family:inherit; font-size:0.6875rem; font-weight:bold; letter-spacing:1px; text-transform:uppercase; cursor:pointer;
    color:var(--tos-fg); border:1px solid var(--hb-atm-accent); border-radius:7px;
    background:linear-gradient(165deg, color-mix(in srgb, var(--hb-atm-accent) 32%, var(--bg2)), color-mix(in srgb, var(--hb-atm-accent) 15%, var(--bg2)));
    box-shadow:inset 0 1px 0 var(--hb-bevel-hi), inset 0 -2px 4px var(--hb-bevel-lo), 0 2px 5px rgba(0,0,0,0.28), 0 0 12px color-mix(in srgb, var(--hb-atm-accent) 30%, transparent);
    transition:filter .12s, box-shadow .12s, transform .05s; }
  .hb-cp-done:hover { filter:brightness(1.12); box-shadow:inset 0 1px 0 var(--hb-bevel-hi), inset 0 -2px 4px var(--hb-bevel-lo), 0 3px 8px rgba(0,0,0,0.3), 0 0 14px color-mix(in srgb, var(--hb-atm-accent) 40%, transparent); }
  .hb-cp-done:active { transform:translateY(1px); box-shadow:inset 0 2px 6px var(--hb-bevel-lo); }
  .hb-cp-svwrap { position:relative; width:100%; height:132px; }
  .hb-cp-sv { display:block; width:100%; height:132px; border-radius:7px; cursor:crosshair; touch-action:none;
    box-shadow:inset 0 0 0 1px rgba(0,0,0,0.3); }
  .hb-cp-svcursor { position:absolute; top:0; left:0; width:14px; height:14px; margin:-7px 0 0 -7px; border-radius:50%;
    border:2px solid #fff; box-shadow:0 0 4px rgba(0,0,0,0.9), 0 0 0 1px rgba(0,0,0,0.5); pointer-events:none; }
  .hb-cp-hue { position:relative; width:100%; height:15px; margin-top:11px; border-radius:6px; cursor:pointer; touch-action:none;
    box-shadow:inset 0 0 0 1px rgba(0,0,0,0.25);
    background:linear-gradient(to right,#ff0000,#ffff00,#00ff00,#00ffff,#0000ff,#ff00ff,#ff0000); }
  .hb-cp-huecursor { position:absolute; top:-3px; left:0; width:7px; height:21px; margin-left:-3.5px; border-radius:3px; background:#fff;
    box-shadow:0 0 4px rgba(0,0,0,0.9), 0 0 0 1px rgba(0,0,0,0.4); pointer-events:none; }
  .hb-cp-quick { display:grid; grid-template-columns:repeat(8,1fr); gap:4px; margin-top:11px; padding:6px; border-radius:8px;
    background:var(--hb-surf-lo); box-shadow:inset 0 1px 3px var(--hb-bevel-lo), inset 0 0 0 1px var(--border); }
  .hb-cp-q { height:16px; padding:0; border-radius:4px; cursor:pointer; border:1px solid rgba(0,0,0,0.35);
    box-shadow:inset 0 1px 0 rgba(255,255,255,0.3); transition:transform .1s, box-shadow .1s; }
  .hb-cp-q:hover { transform:scale(1.18); box-shadow:0 0 8px color-mix(in srgb, var(--hb-atm-accent) 60%, transparent); }
  .hb-cp-hex-input { flex:0 0 92px; box-sizing:border-box; padding:6px 8px; font-family:inherit; font-size:0.6875rem; text-align:center; letter-spacing:1px;
    color:var(--tos-fg); background:color-mix(in srgb, var(--hb-atm-accent) 8%, var(--bg2));
    border:1px solid color-mix(in srgb, var(--hb-atm-accent) 30%, transparent); border-radius:7px; outline:none; }
  .hb-cp-hex-input:focus { border-color:var(--hb-atm-accent); box-shadow:0 0 0 2px color-mix(in srgb, var(--hb-atm-accent) 22%, transparent); }
  @media (max-width:620px) { .hb-cp-pop { width:min(264px, calc(100vw - 24px)); } }
  `;
  document.head.appendChild(st);
}

function teardown() {
  if (!cpState) return;
  if (cpState.reposition) {
    window.removeEventListener('resize', cpState.reposition);
    window.removeEventListener('scroll', cpState.reposition, true);
  }
  if (cpState.onKey) window.removeEventListener('keydown', cpState.onKey, true);
  cpState.pop.remove();
  cpState = null;
}

/**
 * Dismiss the picker. Safe to call when nothing is open.
 *
 * `{ silent: true }` tears it down WITHOUT firing onClose, and it is not a nicety:
 * a host whose onClose re-renders the panel must be able to drop a stale popover
 * from inside that very render, and firing onClose there is unbounded recursion.
 * Silent is "this popover's node is about to stop existing"; the ordinary call is
 * "the player put it away".
 */
export function closeColorPicker({ silent = false } = {}) {
  const done = cpState?.onClose;
  teardown();
  if (!silent) done?.();
}

/** Is a picker up? Used by callers whose Esc handling has to yield to it. */
export function colorPickerOpen() { return !!cpState; }

/**
 * Open the picker under `anchor`.
 *
 * Opening it a second time on the SAME key toggles it shut — clicking a swatch
 * twice should put it away, and that only works if the caller's key is stable.
 *
 *   key        stable id for the thing being coloured (toggle identity)
 *   anchor     element to sit under; flips above / clamps to stay on screen
 *   value      starting #rrggbb
 *   title      the popover's small-caps header
 *   quick      optional swatch rack, defaults to the stock rattle-cans
 *   themeFrom  element (or its id) whose custom properties set the look
 *   onChange   (hex) => void, called on EVERY drag frame — live, not on commit
 *   onClose    () => void, once, on dismissal
 */
export function openColorPicker({ key, anchor, value, title, quick, themeFrom, onChange, onClose } = {}) {
  ensureStyles();
  const reopening = cpState && cpState.key === key;
  closeColorPicker();
  if (reopening) return;

  const start = /^#[0-9a-fA-F]{6}$/.test(value || '') ? value : '#ffffff';
  const { h, s, v } = hex2hsv(start);
  const rack = Array.isArray(quick) && quick.length ? quick : CP_QUICK;

  const pop = document.createElement('div');
  pop.className = 'hb-cp-pop';
  pop.innerHTML = `
    <div class="hb-cp-head"><span class="hb-cp-title">${String(title || 'colour').replace(/[<>&]/g, '')}</span><button type="button" class="hb-cp-close" title="Close">✕</button></div>
    <div class="hb-cp-svwrap"><canvas class="hb-cp-sv" width="320" height="200"></canvas><div class="hb-cp-svcursor"></div></div>
    <div class="hb-cp-hue"><div class="hb-cp-huecursor"></div></div>
    <div class="hb-cp-quick">${rack.map(q => `<button type="button" class="hb-cp-q" data-q="${q}" style="background:${q}" title="${q}"></button>`).join('')}</div>
    <div class="hb-cp-foot"><input type="text" class="hb-cp-hex-input" maxlength="7" value="${start}"><button type="button" class="hb-cp-done">Done</button></div>`;

  const src = typeof themeFrom === 'string' ? document.getElementById(themeFrom) : themeFrom;
  if (src) { const cs = getComputedStyle(src); CP_VARS.forEach(k => pop.style.setProperty(k, cs.getPropertyValue(k))); }
  document.body.appendChild(pop);

  // Anchor under the control, flipping above / clamping horizontally so it always
  // lands fully on screen whatever corner of the pane it was opened from.
  const reposition = () => {
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth, hgt = pop.offsetHeight;
    let left = r.right - w, top = r.bottom + 8;
    if (top + hgt > window.innerHeight - 8) top = Math.max(8, r.top - hgt - 8);
    pop.style.left = Math.max(8, Math.min(left, window.innerWidth - w - 8)) + 'px';
    pop.style.top = top + 'px';
  };
  cpState = { key, pop, anchor, hue: h, sat: s, val: v, reposition, onChange, onClose };
  reposition();
  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, true);
  // Esc is the third way out, alongside ✕ and Done — captured so it never reaches
  // the game's own key handling (or the host overlay's) while a picker is up.
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); closeColorPicker(); } };
  cpState.onKey = onKey;
  window.addEventListener('keydown', onKey, true);

  const svCanvas = pop.querySelector('.hb-cp-sv'), svCursor = pop.querySelector('.hb-cp-svcursor');
  const svWrap = pop.querySelector('.hb-cp-svwrap');
  const hueBar = pop.querySelector('.hb-cp-hue'), hueCursor = pop.querySelector('.hb-cp-huecursor');
  const hexInput = pop.querySelector('.hb-cp-hex-input');
  // Cursor placement is measured off the live boxes, never hard-coded pixel sizes —
  // the SV square and hue strip are both fluid (width:100% of the popover).
  const placeCursors = () => {
    const sv = svWrap.getBoundingClientRect(), hb = hueBar.getBoundingClientRect();
    svCursor.style.left = `${cpState.sat * sv.width}px`;
    svCursor.style.top = `${(1 - cpState.val) * sv.height}px`;
    svCursor.style.background = hsv2hex(cpState.hue, cpState.sat, cpState.val);
    hueCursor.style.left = `${(cpState.hue / 360) * hb.width}px`;
  };
  drawSV(svCanvas, cpState.hue);
  placeCursors();
  const emit = (hex) => {
    if (hexInput && document.activeElement !== hexInput) hexInput.value = hex;
    cpState.onChange?.(hex);
  };
  const updateFromHsv = () => { emit(hsv2hex(cpState.hue, cpState.sat, cpState.val)); placeCursors(); };

  // One shared drag rig for both the SV square and the hue strip. Pointer capture keeps
  // the gesture alive when the pointer leaves the element, and preventDefault on the
  // initial press stops the browser starting a text selection or synthesising a click.
  const dragArea = (el, onAt) => {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      const move = (ev) => { const r = el.getBoundingClientRect(); onAt(ev, r); };
      move(e);
      const end = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', end); el.removeEventListener('pointercancel', end); };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
    });
  };
  dragArea(svCanvas, (ev, r) => {
    cpState.sat = clamp01((ev.clientX - r.left) / r.width);
    cpState.val = clamp01(1 - (ev.clientY - r.top) / r.height);
    updateFromHsv();
  });
  dragArea(hueBar, (ev, r) => {
    cpState.hue = clamp01((ev.clientX - r.left) / r.width) * 360;
    drawSV(svCanvas, cpState.hue);
    updateFromHsv();
  });
  const applyHex = (v2) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(v2)) return;
    const hsv = hex2hsv(v2);
    cpState.hue = hsv.h; cpState.sat = hsv.s; cpState.val = hsv.v;
    drawSV(svCanvas, cpState.hue);
    emit(v2.toLowerCase());
    placeCursors();
  };
  hexInput.addEventListener('change', () => applyHex(hexInput.value.trim()));
  pop.querySelectorAll('[data-q]').forEach(q => q.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation(); applyHex(q.getAttribute('data-q'));
  }));
  // Belt and braces: nothing that happens inside the popover ever reaches the page —
  // no bubbled click can re-trigger the control that opened it, and no press starts
  // a selection drag.
  pop.addEventListener('pointerdown', (e) => { if (e.target === pop || e.target.classList.contains('hb-cp-head') || e.target.classList.contains('hb-cp-title')) e.preventDefault(); e.stopPropagation(); });
  pop.addEventListener('click', (e) => e.stopPropagation());
  pop.querySelector('.hb-cp-close').addEventListener('click', closeColorPicker);
  pop.querySelector('.hb-cp-done').addEventListener('click', closeColorPicker);
}
