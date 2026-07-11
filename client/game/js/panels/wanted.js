// Wanted-level HUD — neon stars, server-driven, with an invisible-heat flame
// burning behind the stars. Pulses + stings when the star count rises.
//
// Two independent inputs:
//   • stars (0–5, half-steps)  — acute, caught crimes; pushed via `wanted_level`.
//   • heat  (0–100)            — the slow burn of being *noticed*; pushed via
//                                `heat_level`. Below the threshold it shows
//                                nothing (lay low); above it a realistic flame
//                                grows behind the stars. 0 until the heat system
//                                feeds it, so the flame is dormant for now.
let stars = 0;
let heat = 0;
let audioCtx = null;

// Flame dials — tuned in sandbox/heat-flame-lab.html and locked here.
const FLAME = { thresh: 20, density: 0.30, height: 0.50, flick: 0.9, spread: 0.18, psize: 1.15 };
// Fire ramp derived from the theme --accent: dark ember → hot core → near-white tip.
// Falls back to a classic orange fire if the var can't be read.
let RAMP = ['#4a1204', '#6e1a06', '#9a2408', '#c8380d', '#f25311', '#ff7a1e', '#ff9c2c', '#ffc247', '#ffe38c', '#fff6d0'];
let rampKey = '';
const MAX_PARTS = 260;      // hard cap — the particle array can never run away
const FW = 220, FH = 82;    // fixed logical canvas (matches .wanted-flame CSS box)

const hx = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
function accentRamp(hex) {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  // t<0 darkens toward black (embers), t>0 lightens toward white (hot tip).
  const mix = t => t < 0
    ? '#' + hx(r * (1 + t)) + hx(g * (1 + t)) + hx(b * (1 + t))
    : '#' + hx(r + (255 - r) * t) + hx(g + (255 - g) * t) + hx(b + (255 - b) * t);
  return [-0.78, -0.6, -0.4, -0.2, 0, 0.15, 0.3, 0.5, 0.7, 0.9].map(mix);
}
function refreshRamp() {
  try {
    const acc = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    if (!acc || acc === rampKey) return;
    const ramp = accentRamp(acc);
    if (ramp) { RAMP = ramp; rampKey = acc; }
  } catch { /* keep current ramp */ }
}

let flame = null;           // { el, canvas, ctx, starsEl, parts, dpr, litKey } once built
let raf = 0;

function stinger() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    [[440, 0], [590, 0.12]].forEach(([f, dt]) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sawtooth'; o.frequency.value = f; g.gain.value = 0.05;
      o.connect(g); g.connect(audioCtx.destination);
      g.gain.setValueAtTime(0.05, t + dt);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.22);
      o.start(t + dt); o.stop(t + dt + 0.22);
    });
  } catch { /* no audio */ }
}

// ── flame renderer ──────────────────────────────────────────────────────────
const SPR = {};   // one soft sprite per ramp colour
function sprite(hex) {
  if (SPR[hex]) return SPR[hex];
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  rg.addColorStop(0, hex); rg.addColorStop(0.55, hex + '88'); rg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 32, 32); SPR[hex] = c; return c;
}
const flick = (now, speed) => 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(now * 0.02 * speed) + 0.4 * Math.sin(now * 0.05 * speed + 1));

function build() {
  if (flame) return;
  const el = document.getElementById('wanted-hud');
  if (!el) return;
  el.innerHTML =
    `<span class="wanted-label">WANTED</span>` +
    `<canvas class="wanted-flame"></canvas>` +
    `<span class="wanted-stars"></span>`;
  flame = {
    el, canvas: el.querySelector('.wanted-flame'), ctx: el.querySelector('.wanted-flame').getContext('2d'),
    starsEl: el.querySelector('.wanted-stars'), parts: [], dpr: 0, litKey: '',
  };
}

// Anchor the flame's horizontal centre to the STARS, not the whole pill.
function placeFlame() {
  if (!flame) return;
  const s = flame.starsEl, cx = s.offsetLeft + s.offsetWidth / 2;
  if (cx > 0) flame.canvas.style.left = cx + 'px';
}

function step(now) {
  const f = flame, ctx = f.ctx;
  const d = Math.min(2, window.devicePixelRatio || 1);
  if (d !== f.dpr || !f.canvas.width) {
    f.dpr = d; f.canvas.width = Math.round(FW * d); f.canvas.height = Math.round(FH * d);
    ctx.setTransform(d, 0, 0, d, 0, 0);
  }
  const t = Math.max(0, Math.min(1, (heat - FLAME.thresh) / (100 - FLAME.thresh)));
  const base = FH;
  let n = Math.round(t * t * 8 * FLAME.density * (0.72 + 0.28 * flick(now, FLAME.flick)));
  if (f.parts.length > MAX_PARTS) n = 0;
  for (let i = 0; i < n; i++) {
    const rx = (Math.random() + Math.random() - 1);
    f.parts.push({
      x: FW / 2 + rx * FW * FLAME.spread, y: base - 2, vx: (Math.random() - 0.5) * 0.35,
      vy: (-(0.35 + Math.random() * 0.5) - (t * 1.3)) * FLAME.height, life: 1, dc: 0.020 + Math.random() * 0.016,
      sz: (3 + Math.random() * 3.5) * FLAME.psize, sw: Math.random() * 6.28, ss: 0.03 + Math.random() * 0.05,
    });
  }
  ctx.clearRect(0, 0, FW, FH); ctx.globalCompositeOperation = 'lighter';
  for (let i = f.parts.length - 1; i >= 0; i--) {
    const q = f.parts[i];
    q.life -= q.dc; if (q.life <= 0) { f.parts.splice(i, 1); continue; }
    q.sw += q.ss; q.vy -= 0.028; q.x += q.vx + Math.sin(q.sw) * 0.4; q.y += q.vy;
    const age = 1 - q.life, ci = age < 0.32 ? 8 : age < 0.66 ? 5 : 2, s = q.sz * (0.5 + q.life * 0.8);
    ctx.globalAlpha = Math.min(1, q.life * 0.9) * (0.5 + 0.5 * t);
    ctx.drawImage(sprite(RAMP[ci]), q.x - s / 2, q.y - s / 2, s, s);
  }
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
}

function frame(now) {
  if (!flame) { raf = 0; return; }
  step(now);
  // keep spinning only while there's fuel or embers left; otherwise idle.
  if (heat > FLAME.thresh || flame.parts.length) raf = requestAnimationFrame(frame);
  else raf = 0;
}
function ensureLoop() { if (!raf && flame) raf = requestAnimationFrame(frame); }

// ── stars + visibility ───────────────────────────────────────────────────────
function renderStars() {
  if (!flame) return;
  const full = Math.floor(stars);
  const half = (stars - full) >= 0.5;
  const empty = Math.max(0, 5 - full - (half ? 1 : 0));
  const key = `${full}/${half}/${empty}`;
  if (key === flame.litKey) return;
  flame.litKey = key;
  flame.starsEl.innerHTML = `${'★'.repeat(full)}${half ? '½' : ''}<span class="wanted-empty">${'★'.repeat(empty)}</span>`;
  placeFlame();
}

function updateVisibility() {
  const el = document.getElementById('wanted-hud');
  if (!el) return;
  if (stars > 0 || heat > FLAME.thresh) {
    build();
    refreshRamp();
    el.classList.add('active');
    renderStars();
    ensureLoop();
  } else {
    el.classList.remove('active', 'wanted-pulse');
  }
}

export function updateWantedHud(n) {
  const el = document.getElementById('wanted-hud');
  if (!el) return;
  const prev = stars;
  stars = Math.max(0, Math.min(5, +n || 0));
  const rising = stars > prev;
  updateVisibility();
  if (rising && stars > 0) {
    el.classList.remove('wanted-pulse');
    void el.offsetWidth;           // restart the animation
    el.classList.add('wanted-pulse');
    stinger();
  }
}

// Invisible-heat level (0–100). Drives the flame; server pushes it via `heat_level`.
export function setWantedHeat(h) {
  heat = Math.max(0, Math.min(100, +h || 0));
  updateVisibility();
}

export function initWantedHud() {
  const el = document.getElementById('wanted-hud');
  if (!el) return;
  stars = 0; heat = 0;
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  el.classList.remove('active', 'wanted-pulse');
}

// Current wanted level (0–5, half-steps) — read by the optional "Wanted" custom
// sidebar panel, which re-renders when a wanted_level push arrives.
export function getWantedStars() { return stars; }

// Dev tester: until the heat system pushes real values, drive the flame by hand
// from the browser console — e.g. `heatTest(0)`→invisible, `heatTest(60)`→burn,
// `heatTest(100)`→roaring. Remove once the server owns `heat_level`.
if (typeof window !== 'undefined') window.heatTest = setWantedHeat;
