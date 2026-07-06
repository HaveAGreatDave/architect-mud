// The FLEET carousel — a full-pane "lazy susan" of the aircraft you own, mounted in the
// area (look) pane like the flight cockpit so the command pane stays live beneath it.
// The server (flight/hangars.js cmdFleet) pushes the craft you own at this field plus,
// when you own none at a dealer, the buy roster. One big slowly-spinning 3D hero shot in
// the middle (the same aircraft3d.js model the sim draws for air contacts), the previous
// and next planes ghosted to the sides; ‹ ›, the arrow keys, or a horizontal drag spin
// the susan through your fleet. Empty at a dealer → the lot: click a plane to buy it
// (which offers insurance on the spot). Client-only; the server owns the data.
import { sendCmdSilent } from '../net.js';
import { setAreaPane } from '../render.js';
import { drawTurntable } from './aircraft3d.js';

let F = null;     // { data, idx, craft, listeners:[] }
let raf = null;   // spin animation frame
let yaw = 0;      // shared spin angle (radians)

export function isFleetActive() { return !!document.getElementById('fleet-root'); }

export function openFleet(data) {
  closeFleet();
  ensureStyles();
  F = { data: data || {}, idx: 0, craft: (data?.craft || []), listeners: [] };
  render();
}

export function closeFleet() {
  if (raf) { cancelAnimationFrame(raf); raf = null; }
  if (F) { for (const [t, ty, fn] of F.listeners) { try { t.removeEventListener(ty, fn); } catch {} } }
  F = null;
}

const esc = (s) => String(s == null ? '' : s).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));

// A canvas that the spin loop draws one aircraft into (class + livery carried inline).
function acCanvas(cls, livery, size, role) {
  return `<canvas class="fl-ac" data-ac-cls="${esc(cls)}" data-ac-livery="${esc(JSON.stringify(livery || {}))}" data-role="${role}" style="width:${size}px;height:${size}px"></canvas>`;
}

function badge(c) {
  if (c.rental) return '<span class="fl-badge fl-b-rent">RENTAL</span>';
  if (c.location === 'hangar') return '<span class="fl-badge fl-b-bay">IN BAY</span>';
  return '<span class="fl-badge fl-b-ramp">ON RAMP</span>';
}

function render() {
  const d = F.data, craft = F.craft;
  let body;
  if (craft.length) {
    F.idx = ((F.idx % craft.length) + craft.length) % craft.length;
    const c = craft[F.idx];
    const prev = craft[(F.idx - 1 + craft.length) % craft.length];
    const next = craft[(F.idx + 1) % craft.length];
    const many = craft.length > 1;
    const dots = craft.map((_, i) => `<span class="fl-dot${i === F.idx ? ' on' : ''}"></span>`).join('');
    const hullCol = c.hullPct <= 25 ? '#ff5b5b' : c.hullPct <= 55 ? '#ffb23e' : '#46e05a';
    body = `
      <div class="fl-stage" id="fl-stage">
        ${many ? `<button class="fl-arrow fl-prev" data-nav="-1" aria-label="previous">‹</button>` : ''}
        <div class="fl-side fl-side-l">${many ? acCanvas(prev.class, prev.livery, 150, 'side') : ''}</div>
        <div class="fl-center">${acCanvas(c.class, c.livery, 320, 'center')}</div>
        <div class="fl-side fl-side-r">${many ? acCanvas(next.class, next.livery, 150, 'side') : ''}</div>
        ${many ? `<button class="fl-arrow fl-next" data-nav="1" aria-label="next">›</button>` : ''}
      </div>
      <div class="fl-dots">${dots}</div>
      <div class="fl-info">
        <div class="fl-name">${esc(c.tail)} ${badge(c)}</div>
        <div class="fl-type">${esc(c.typeName)}</div>
        <div class="fl-bars">
          <span class="fl-bl">HULL</span><span class="fl-bar"><i style="width:${c.hullPct}%;background:${hullCol}"></i></span>
          <span class="fl-bl">FUEL</span><span class="fl-bar"><i style="width:${c.fuelPct}%;background:#4fb8e0"></i></span>
        </div>
      </div>
      <div class="fl-actions">
        <button class="fl-btn fl-go" data-act="embark" data-tail="${esc(c.tail)}">Embark</button>
        <button class="fl-btn" data-act="paint">Paint bay</button>
        <button class="fl-btn fl-close" data-act="close">Close</button>
      </div>`;
  } else if (d.canBuy && (d.catalog || []).length) {
    const lot = (d.catalog).map(t => `
      <button class="fl-lot" data-buy="${esc(t.id)}">
        <div class="fl-lot-art">${acCanvas(t.class, {}, 120, 'lot')}</div>
        <div class="fl-lot-name">${esc(t.name)}</div>
        <div class="fl-lot-meta">${esc(t.class)} · ${t.seats} seat${t.seats > 1 ? 's' : ''} · ${esc(t.fuel)}</div>
        <div class="fl-lot-price ${d.credits >= t.price ? 'ok' : 'no'}">₵ ${t.price}</div>
      </button>`).join('');
    body = `
      <div class="fl-empty-head">You own no aircraft here yet — the dealer's lot is open. Pick one to buy.</div>
      <div class="fl-lotgrid">${lot}</div>
      <div class="fl-actions"><button class="fl-btn fl-close" data-act="close">Close</button></div>`;
  } else {
    body = `
      <div class="fl-empty-head">None of your aircraft are here${d.canBuy ? '' : ', and there is no dealer at this field'}.</div>
      <div class="fl-actions"><button class="fl-btn fl-close" data-act="close">Close</button></div>`;
  }

  setAreaPane(`<div id="fleet-root">
    <div class="fl-head"><span class="fl-title">✈ FLEET — ${esc(d.field || '')}</span>
      <span class="fl-credits">₵ ${d.credits ?? 0}</span></div>
    <div class="fl-main">${body}</div>
  </div>`);
  wire();
  startSpin();
}

function step(n) { if (F && F.craft.length) { F.idx += n; render(); } }

function wire() {
  const root = document.getElementById('fleet-root'); if (!root || !F) return;
  const add = (t, ty, fn) => { if (!t) return; t.addEventListener(ty, fn); F.listeners.push([t, ty, fn]); };
  const q = (s) => root.querySelector(s);

  root.querySelectorAll('[data-nav]').forEach(el => add(el, 'click', () => step(parseInt(el.getAttribute('data-nav'), 10))));
  root.querySelectorAll('[data-buy]').forEach(el => add(el, 'click', () => {
    sendCmdSilent(`buy ${el.getAttribute('data-buy')}`);
    // Give the purchase a beat to land, then refresh into the owned view.
    setTimeout(() => sendCmdSilent('fleet'), 450);
  }));
  root.querySelectorAll('[data-act]').forEach(el => add(el, 'click', () => {
    const act = el.getAttribute('data-act');
    if (act === 'close') { closeFleet(); sendCmdSilent('look'); }
    else if (act === 'embark') { sendCmdSilent(`board ${el.getAttribute('data-tail')}`); closeFleet(); }
    else if (act === 'paint') { closeFleet(); sendCmdSilent('hangar'); }
  }));

  // Arrow keys cycle the susan while it's up.
  add(window, 'keydown', (e) => {
    if (!isFleetActive()) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    else if (e.key === 'Escape') { closeFleet(); sendCmdSilent('look'); }
  });

  // Horizontal drag on the stage spins the lazy susan through the fleet.
  const stage = q('#fl-stage');
  if (stage && F.craft.length > 1) {
    let downX = null;
    add(stage, 'pointerdown', (e) => { downX = e.clientX; try { stage.setPointerCapture(e.pointerId); } catch {} });
    add(stage, 'pointerup', (e) => {
      if (downX == null) return;
      const dx = e.clientX - downX; downX = null;
      if (dx <= -40) step(1); else if (dx >= 40) step(-1);
    });
  }
}

// One rAF loop spins the centre plane and holds the side ghosts at a ¾ angle.
function startSpin() {
  if (raf) return;
  let last = 0;
  const loop = (t) => {
    const root = document.getElementById('fleet-root');
    if (!root) { raf = null; return; }
    if (last) yaw += Math.min(0.05, (t - last) / 1000) * 0.5;
    last = t;
    root.querySelectorAll('canvas[data-ac-cls]').forEach(cv => {
      if (!cv._cw) sizeCanvas(cv);
      const ctx = cv.getContext('2d'); if (!ctx) return;
      ctx.setTransform(cv._dpr, 0, 0, cv._dpr, 0, 0);
      let lv = {}; try { lv = JSON.parse(cv.getAttribute('data-ac-livery') || '{}'); } catch {}
      const role = cv.getAttribute('data-role');
      const a = role === 'center' ? yaw : 0.7;   // sides sit at a static hero angle
      drawTurntable(ctx, { cls: cv.getAttribute('data-ac-cls'), livery: lv, yaw: a, w: cv._cw, h: cv._ch });
    });
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}
function sizeCanvas(cv) {
  const dpr = window.devicePixelRatio || 1;
  const cw = parseFloat(cv.style.width), ch = parseFloat(cv.style.height);
  cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
  cv._dpr = dpr; cv._cw = cw; cv._ch = ch;
}

function ensureStyles() {
  if (document.getElementById('fleet-styles')) return;
  const st = document.createElement('style'); st.id = 'fleet-styles';
  st.textContent = `
  #area-content:has(#fleet-root) { height:100%; }
  #fleet-root { display:flex; flex-direction:column; height:100%; min-height:420px; color:#a9d4ec;
    font-family:'Courier New',monospace; background:radial-gradient(120% 90% at 50% 8%,#1a2530,#0a0e12 70%); border-radius:8px; overflow:hidden; }
  #fleet-root .fl-head { display:flex; align-items:center; gap:12px; padding:9px 14px; border-bottom:1px solid #2a3540; flex:0 0 auto; }
  #fleet-root .fl-title { color:#eaf6ff; font-weight:bold; letter-spacing:2px; }
  #fleet-root .fl-credits { margin-left:auto; color:#ffcf3e; letter-spacing:1px; }
  #fleet-root .fl-main { flex:1 1 auto; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:6px 12px 12px; min-height:0; }
  #fleet-root .fl-stage { position:relative; display:flex; align-items:center; justify-content:center; gap:6px; width:100%; max-width:760px; flex:1 1 auto; min-height:0; touch-action:pan-y; user-select:none; }
  #fleet-root .fl-center { flex:0 0 auto; }
  #fleet-root .fl-side { flex:0 0 auto; opacity:0.4; filter:brightness(0.7); }
  #fleet-root .fl-ac { display:block; }
  #fleet-root .fl-arrow { position:absolute; top:50%; transform:translateY(-50%); z-index:2; width:44px; height:44px; border-radius:50%;
    background:rgba(10,20,28,0.7); border:1px solid #2a3540; color:#a9d4ec; font-size:26px; line-height:1; cursor:pointer; }
  #fleet-root .fl-arrow:hover { border-color:#4fb8e0; color:#eaf6ff; }
  #fleet-root .fl-prev { left:4px; } #fleet-root .fl-next { right:4px; }
  #fleet-root .fl-dots { display:flex; gap:6px; margin:2px 0 8px; }
  #fleet-root .fl-dot { width:7px; height:7px; border-radius:50%; background:#2a3540; }
  #fleet-root .fl-dot.on { background:#4fb8e0; box-shadow:0 0 6px #4fb8e0; }
  #fleet-root .fl-info { text-align:center; margin-bottom:8px; }
  #fleet-root .fl-name { color:#eaf6ff; font-weight:bold; letter-spacing:1px; font-size:15px; }
  #fleet-root .fl-type { color:#7fae99; font-size:12px; margin:2px 0 6px; }
  #fleet-root .fl-badge { font-size:8px; letter-spacing:1px; padding:1px 5px; border-radius:3px; margin-left:6px; vertical-align:middle; }
  #fleet-root .fl-b-ramp { background:#14324a; color:#7fc0ff; } #fleet-root .fl-b-bay { background:#143a2a; color:#6fe0a0; } #fleet-root .fl-b-rent { background:#3a3414; color:#e0c86f; }
  #fleet-root .fl-bars { display:inline-grid; grid-template-columns:auto 120px; gap:4px 8px; align-items:center; font-size:9px; letter-spacing:1px; color:#8fb0c6; }
  #fleet-root .fl-bar { height:6px; background:#0a1620; border-radius:3px; overflow:hidden; } #fleet-root .fl-bar i { display:block; height:100%; }
  #fleet-root .fl-actions { display:flex; gap:8px; flex:0 0 auto; }
  #fleet-root .fl-btn { font-family:inherit; font-size:12px; letter-spacing:1px; color:#a9d4ec; cursor:pointer; padding:8px 16px;
    background:linear-gradient(160deg,#2a333c,#12171c); border:1px solid #2a3540; border-radius:6px; }
  #fleet-root .fl-btn:hover { border-color:#4fb8e0; color:#eaf6ff; }
  #fleet-root .fl-go { border-color:#3f6d8c; } #fleet-root .fl-close { border-color:#3a2530; }
  #fleet-root .fl-empty-head { color:#8fb0c6; font-size:13px; text-align:center; padding:16px 10px; }
  #fleet-root .fl-lotgrid { display:flex; flex-wrap:wrap; gap:12px; justify-content:center; overflow-y:auto; padding:4px; max-height:100%; }
  #fleet-root .fl-lot { width:180px; background:linear-gradient(160deg,#222b33,#12171c); border:1px solid #2a3540; border-radius:8px; padding:8px; cursor:pointer; font-family:inherit; color:#a9d4ec; }
  #fleet-root .fl-lot:hover { border-color:#4fb8e0; }
  #fleet-root .fl-lot-art { display:flex; justify-content:center; }
  #fleet-root .fl-lot-name { color:#eaf6ff; font-weight:bold; letter-spacing:1px; text-align:center; margin-top:4px; }
  #fleet-root .fl-lot-meta { color:#7fae99; font-size:10px; text-align:center; margin:2px 0 4px; }
  #fleet-root .fl-lot-price { text-align:center; letter-spacing:1px; } #fleet-root .fl-lot-price.ok { color:#ffcf3e; } #fleet-root .fl-lot-price.no { color:#e08a6f; }
  @media (max-width:620px) { #fleet-root .fl-side { display:none; } }
  `;
  document.head.appendChild(st);
}
