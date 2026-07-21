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
import { Flame, refreshRamp } from '../flame.js';

let stars = 0;
let heat = 0;
let audioCtx = null;

// Flame dials — tuned in sandbox/heat-flame-lab.html and locked here.
const FLAME = { thresh: 20, density: 0.30, height: 0.50, flick: 0.9, spread: 0.18, psize: 1.15 };
const FW = 220, FH = 82;    // fixed logical canvas (matches .wanted-flame CSS box)

let flame = null;           // { el, sim, starsEl, litKey } once built
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

function build() {
  if (flame) return;
  const el = document.getElementById('wanted-hud');
  if (!el) return;
  el.innerHTML =
    `<span class="wanted-label">WANTED</span>` +
    `<canvas class="wanted-flame"></canvas>` +
    `<span class="wanted-stars"></span>`;
  const canvas = el.querySelector('.wanted-flame');
  flame = {
    el, canvas, sim: new Flame(canvas, FW, FH, FLAME),
    starsEl: el.querySelector('.wanted-stars'), litKey: '',
  };
}

// Anchor the flame's horizontal centre to the STARS, not the whole pill.
function placeFlame() {
  if (!flame) return;
  const s = flame.starsEl, cx = s.offsetLeft + s.offsetWidth / 2;
  if (cx > 0) flame.canvas.style.left = cx + 'px';
}

function frame(now) {
  if (!flame) { raf = 0; return; }
  const t = Math.max(0, Math.min(1, (heat - FLAME.thresh) / (100 - FLAME.thresh)));
  flame.sim.step(now, t);
  // keep spinning only while there's fuel or embers left; otherwise idle.
  if (heat > FLAME.thresh || flame.sim.parts.length) raf = requestAnimationFrame(frame);
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
