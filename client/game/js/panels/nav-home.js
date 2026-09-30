// The HOME marker for anything on or under the sea: an arrow to where you set out, turned against
// the bow, with the bearing and the range. The boat helm and the Drake in boat or sub mode share it.
//
// Home is the launch point the seat was opened at, not a named city, so the engine carries no map
// knowledge. Range is in the sea's metre (SEA_TILE_M), the scale the swell and the helm eye use.
//
// Heading frame: 0 is north (-y), clockwise, the boat sim's and the flight model's.

import { SEA_TILE_M } from '../../../shared/sea-swell.js';

// Close in the harbour is in plain sight and the arrow is clutter.
const SHOW_TILES = 20;

let styled = false;
function ensureStyles() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const s = document.createElement('style');
  s.textContent = `
    .nav-home{ position:absolute; top:14px; left:50%; transform:translateX(-50%); z-index:7;
      display:flex; align-items:center; gap:8px; pointer-events:none;
      font:600 14px/1 ui-monospace,monospace; color:#ffd27a; letter-spacing:.08em;
      text-shadow:0 1px 3px #000; white-space:nowrap; }
    .nav-home[hidden]{ display:none; }
    .nav-home-arrow{ display:inline-block; font-size:18px; }
    body.bigscreen .nav-home{ display:none; }`;
  document.head.appendChild(s);
}

export function navHomeHTML() {
  ensureStyles();
  return '<div class="nav-home" hidden><span class="nav-home-arrow">▲</span><span class="nav-home-txt"></span></div>';
}

// el: the .nav-home element. show: false hides it (off the water, say).
export function drawNavHome(el, { x, y, heading, homeX, homeY, show = true }) {
  if (!el) return;
  const dx = homeX - x, dy = homeY - y;
  const tiles = Math.hypot(dx, dy);
  el.hidden = !show || !(tiles >= SHOW_TILES);
  if (el.hidden) return;
  const brg = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
  const m = tiles * SEA_TILE_M;
  const range = m < 1000 ? Math.round(m / 10) * 10 + ' M' : (m / 1000).toFixed(m < 10000 ? 1 : 0) + ' KM';
  el.querySelector('.nav-home-arrow').style.transform = 'rotate(' + (brg - (heading || 0)).toFixed(1) + 'deg)';
  el.querySelector('.nav-home-txt').textContent = 'HOME ' + String(Math.round(brg) % 360).padStart(3, '0') + '° · ' + range;
}
