// The Stacked Deck's carousel ride: a full-window cinematic for 'garage park' (dir 'down')
// and 'garage pull' (dir 'up'). The server sends one carousel_ride message and moves the
// player when msg.ms is up; this only plays the picture for that long and removes itself.
// Click or Esc skips it. Nothing here decides anything.
import { loadCss } from '../../../shared/dom.js';
import { loadAircraft3d, drawTurntable } from './aircraft3d-lazy.js';

const CR_CSS = await loadCss(new URL('./carousel-ride.css', import.meta.url));

const INK = '#020405', CYAN = '#29e6ff', CYAN_DIM = '#0b5b68', WALL = '#07090b', SLAB = '#0d1013';
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
const seg = (f, a, b) => ease((f - a) / (b - a));

let _live = null;

function injectCss() {
  if (document.getElementById('carousel-ride-css')) return;
  const s = document.createElement('style');
  s.id = 'carousel-ride-css';
  s.textContent = CR_CSS;
  document.head.appendChild(s);
}

function offscreen(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}

export async function playCarouselRide(msg) {
  if (_live) _live.close();
  injectCss();
  const ms = Math.max(1000, Number(msg?.ms) || 11000);
  const dir = msg?.dir === 'up' ? 'up' : 'down';
  const look = msg?.look || {};
  const per = Math.max(1, msg?.slotsPerLevel | 0 || 3);
  const levels = Array.isArray(msg?.levels) && msg.levels.length ? msg.levels : [msg?.level ?? 1];
  const roof = Number(msg?.roofLevel ?? (Math.max(...levels) + 1));
  const slot = Math.max(1, msg?.slot | 0 || 1);
  const myJ = (slot - 1) % per;
  const myLevel = Number(msg?.level ?? levels[Math.floor((slot - 1) / per)] ?? levels[0]);
  const D = Math.max(0.5, roof - myLevel);
  const occupied = new Set((msg?.occupied || []).map(Number));
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const root = document.createElement('div');
  root.className = 'cr-overlay';
  const cv = document.createElement('canvas');
  const cap = document.createElement('div');
  cap.className = 'cr-caption';
  const mk = (cls, text) => { const d = document.createElement('div'); d.className = cls; d.textContent = text; cap.appendChild(d); };
  mk('cr-name', msg?.name || '');
  mk('cr-where', 'Slot ' + slot + ' · Level ' + myLevel);
  mk('cr-skip', 'click to skip');
  root.append(cv, cap);
  document.body.appendChild(root);
  const ctx = cv.getContext('2d');

  let W = 0, H = 0, craft = null, parked = [], raf = 0, done = false, frozen = null;
  const t0 = performance.now();
  const step = (Math.PI * 2) / per;
  const thEnd = Math.PI / 2 - myJ * step;          // my slot faces the camera
  const thStart = thEnd - Math.PI * 1.25;          // more than half a turn

  let mod = null;
  try { await loadAircraft3d(); mod = true; } catch (e) { console.error('[carousel]', e?.message); }

  // The lowest painted row of an image, 0..1 down it, so a craft's skids land on the pad or cradle
  // rather than its padded canvas edge.
  function footOf(c) {
    try {
      const g = c.getContext('2d'), { width: w, height: h } = c, px = g.getImageData(0, 0, w, h).data;
      for (let y = h - 1; y > 0; y--) for (let x = 0; x < w; x += 2) if (px[(y * w + x) * 4 + 3] > 40) return (y + 1) / h;
    } catch { /* tainted or empty */ }
    return 0.8;
  }
  let craftFoot = 0.8, parkedFoot = 0.8;
  function bake() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = cv.width = Math.round(innerWidth * dpr);
    H = cv.height = Math.round(innerHeight * dpr);
    if (!mod) return;
    const cs = H * 0.42;
    craft = offscreen(cs * 1.4, cs);
    try { drawTurntable(craft.getContext('2d'), { cls: look.cls || 'heli', armed: !!look.armed, variant: look.variant || '', livery: look.livery, yaw: 0.75, w: craft.width, h: craft.height, zoom: 1, elev: 0.42, floor: false }); }
    catch (e) { craft = null; console.error('[carousel]', e?.message); }
    if (craft) craftFoot = footOf(craft);
    parked = [];
    const ps = H * 0.22;
    for (let k = 0; k < 8; k++) {
      const c = offscreen(ps * 1.4, ps);
      const g = c.getContext('2d');
      try {
        drawTurntable(g, { cls: 'heli', yaw: (k / 8) * Math.PI * 2, w: c.width, h: c.height, zoom: 1, elev: 0.42, floor: false });
        g.globalCompositeOperation = 'source-atop';
        g.fillStyle = 'rgba(6,14,18,0.82)';
        g.fillRect(0, 0, c.width, c.height);
      } catch { /* a silhouette is optional */ }
      parked.push(c);
    }
    if (parked[0]) parkedFoot = footOf(parked[0]);
  }

  // Where the ride stands at fraction f of its time: depth, drum angle, slide, clamp.
  function state(f) {
    const g = dir === 'down' ? f : 1 - f;          // 'up' is the reverse ride
    const d = D * (0.85 * seg(g, 0.1, 0.45) + 0.15 * seg(g, 0.7, 0.85));
    const th = thStart + (thEnd - thStart) * seg(g, 0.45, 0.7);
    const slide = seg(g, 0.85, 0.93);
    const clampT = seg(g, 0.9, 0.95);
    return { g, d, th, slide, clampT };
  }

  function drawSlot(x, y, s, filled, k, clampT) {
    ctx.save();
    ctx.lineWidth = Math.max(1, s * 0.012);
    ctx.fillStyle = '#111619'; ctx.strokeStyle = INK;
    ctx.beginPath(); ctx.ellipse(x, y, s * 0.5, s * 0.12, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = CYAN_DIM; ctx.beginPath(); ctx.ellipse(x, y, s * 0.46, s * 0.1, 0, 0, Math.PI * 2); ctx.stroke();
    if (filled && parked.length) {
      const img = parked[k % parked.length];
      const iw = s * 0.9, ih = iw * img.height / img.width;
      ctx.drawImage(img, x - iw / 2, y - ih * parkedFoot, iw, ih);
    }
    if (clampT != null) {                           // two bars closing on the cradle
      const gap = s * (0.5 - 0.3 * clampT);
      ctx.fillStyle = clampT >= 1 ? CYAN : '#d8a400';
      ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, s * 0.01);
      for (const sx of [-1, 1]) {
        ctx.beginPath(); ctx.rect(x + sx * gap - s * 0.025, y - s * 0.09, s * 0.05, s * 0.18); ctx.fill(); ctx.stroke();
      }
    }
    ctx.restore();
  }

  function frame(f) {
    const { g, d, th, slide, clampT } = state(f);
    const L = H * 0.5, padY = H * 0.6, cx = W / 2;
    const rx = W * 0.36, ry = H * 0.13, slotS = Math.min(W * 0.2, H * 0.32);
    const Y = (z) => padY + (z - d) * L;
    ctx.fillStyle = WALL; ctx.fillRect(0, 0, W, H);
    // Shaft walls: vertical ribs.
    ctx.strokeStyle = '#14191d'; ctx.lineWidth = H * 0.004;
    for (let i = 1; i < 8; i++) { const x = (W * i) / 8; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    // Sky above the roof slab: a square that shrinks away as you go down.
    const roofY = Y(0) - H * 0.18;
    if (roofY > 0) {
      const sw = W * 0.5 * (1 / (1 + d * 0.8));
      const sg = ctx.createLinearGradient(0, 0, 0, roofY);
      sg.addColorStop(0, '#5aa8e6'); sg.addColorStop(1, '#b9dcf4');
      ctx.fillStyle = sg;
      ctx.fillRect(cx - sw, Math.max(0, roofY - sw * 0.9), sw * 2, Math.min(roofY, sw * 0.9));
      ctx.strokeStyle = INK; ctx.lineWidth = H * 0.006;
      ctx.strokeRect(cx - sw, Math.max(0, roofY - sw * 0.9), sw * 2, Math.min(roofY, sw * 0.9));
    }
    // Deck slabs: a black band with a cyan edge light at every level, roof included.
    const zMax = roof - Math.min(...levels) + 1;
    for (let z = 0; z <= zMax; z++) {
      const y = Y(z) - H * 0.18, bh = H * 0.07;
      if (y > H || y + bh < 0) continue;
      ctx.fillStyle = SLAB; ctx.fillRect(0, y, W, bh);
      ctx.fillStyle = INK; ctx.fillRect(0, y + bh - H * 0.006, W, H * 0.006);
      ctx.fillStyle = CYAN; ctx.shadowColor = CYAN; ctx.shadowBlur = H * 0.02;
      ctx.fillRect(0, y + bh * 0.62, W, H * 0.005);
      ctx.shadowBlur = 0;
      if (z > 0) { ctx.fillStyle = CYAN_DIM; ctx.font = (H * 0.03 | 0) + 'px monospace'; ctx.fillText('L' + (roof - z), W * 0.03, y + bh * 0.45); }
    }
    // The drum at every storage level.
    const rings = [];
    for (let li = 0; li < levels.length; li++) {
      const y = Y(roof - levels[li]);
      if (y < -H * 0.3 || y > H * 1.3) continue;
      for (let j = 0; j < per; j++) {
        const s = li * per + j + 1;
        const a = th + j * step;
        const mine = s === slot;
        const filled = occupied.has(s) && !mine;
        rings.push({ x: cx + rx * Math.cos(a), y: y + ry * Math.sin(a), sin: Math.sin(a), s, filled, mine, k: s * 3 + j });
      }
    }
    const lift = (y) => { ctx.strokeStyle = CYAN_DIM; ctx.lineWidth = H * 0.004; ctx.beginPath(); ctx.ellipse(cx, y, rx, ry, 0, 0, Math.PI * 2); ctx.stroke(); };
    for (let li = 0; li < levels.length; li++) lift(Y(roof - levels[li]));
    const sc = (r) => slotS * (0.8 + 0.2 * (r.sin + 1) / 2);
    for (const r of rings.filter((r) => r.sin < 0).sort((a, b) => a.sin - b.sin)) drawSlot(r.x, r.y, sc(r), r.filled, r.k, null);
    // Lift rails and the pad with the player's craft on it.
    ctx.fillStyle = '#0a0d0f'; ctx.fillRect(cx - W * 0.012, 0, W * 0.024, padY);
    const px = cx, py = padY + ry * slide;
    const padS = slotS * 1.15 * (1 + 0.1 * slide);
    ctx.fillStyle = '#151b1f'; ctx.strokeStyle = INK; ctx.lineWidth = H * 0.005;
    ctx.beginPath(); ctx.ellipse(cx, padY, padS * 0.55, padS * 0.13, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // Warning ring: amber flashing at the start of 'down', green at the end of 'up'.
    let ring = CYAN, glow = H * 0.015;
    const flash = (Math.sin(performance.now() / 120) > 0) ? 1 : 0.25;
    if (dir === 'down' && g < 0.12) { ring = flash > 0.5 ? '#ffb300' : '#5a3a00'; glow = H * 0.04 * flash; }
    if (dir === 'up' && g < 0.12) { ring = '#3dff7a'; glow = H * 0.04; }
    if (slide > 0) { ring = CYAN_DIM; glow = 0; ctx.globalAlpha = 1 - 0.7 * slide; }
    ctx.strokeStyle = ring; ctx.shadowColor = ring; ctx.shadowBlur = glow; ctx.lineWidth = H * 0.006;
    ctx.beginPath(); ctx.ellipse(cx, padY, padS * 0.5, padS * 0.11, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    // My cradle: draw it under the craft once the craft is in it.
    const front = rings.find((r) => r.mine);
    if (front && front.sin >= 0) drawSlot(front.x, front.y, sc(front), false, 0, slide > 0 ? clampT : null);
    if (craft) {
      const cw = (padS * 1.25) * (1 - slide) + (front ? sc(front) * 1.05 : padS) * slide, ch = cw * craft.height / craft.width;
      ctx.drawImage(craft, px - cw / 2, py - ch * craftFoot, cw, ch);
    }
    for (const r of rings.filter((r) => r.sin >= 0 && !r.mine).sort((a, b) => a.sin - b.sin)) drawSlot(r.x, r.y, sc(r), r.filled, r.k, null);
    // Up ends in daylight: wash the frame bright over the last stretch.
    if (dir === 'up' && g < 0.1) { ctx.fillStyle = 'rgba(200,230,255,' + (0.35 * (1 - g / 0.1)) + ')'; ctx.fillRect(0, 0, W, H); }
  }

  function close() {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    removeEventListener('keydown', onKey, true);
    removeEventListener('resize', onResize);
    root.remove();
    if (_live === api) _live = null;
    if (window.__carouselAt === seek) delete window.__carouselAt;
  }
  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }
  function onResize() { bake(); tick.drew = false; }
  function seek(f) { frozen = f == null ? null : clamp01(f); if (frozen != null) frame(frozen); }

  function tick() {
    if (done) return;
    const el = performance.now() - t0;
    if (frozen == null && el >= ms) { close(); return; }
    if (frozen == null && el >= ms - 500) root.classList.add('cr-out');
    const f = frozen != null ? frozen : reduced ? (dir === 'down' ? 0.97 : 0.03) : el / ms;
    if (!reduced || frozen != null || !tick.drew) { frame(f); tick.drew = true; }
    raf = requestAnimationFrame(tick);
  }

  const api = { close };
  _live = api;
  window.__carouselAt = seek;
  root.addEventListener('click', close);
  addEventListener('keydown', onKey, true);
  addEventListener('resize', onResize);
  bake();
  raf = requestAnimationFrame(tick);
}
