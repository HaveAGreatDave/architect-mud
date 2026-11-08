// THE SOUNDER'S SCREEN, over the seat: the sweep on the left and the beam on the right, from one scan
// (sonar-scene.js). boat-view.js owns whether it's on, its range and its gain, and hands it the scan.
// The look is an old colour fish finder: a navy screen, returns running blue to green to yellow to red.
//
// A frame costs a clear and a few hundred small strokes, and the seat asks ten times a second.
import { loadCss } from '../../../shared/dom.js';
import { BEAM_DEG, PROFILE_N, RANGES_M, GAIN_NAMES, inBeam, screenDepth } from './sonar-scene.js';

// sonar-panel.css ships beside this file; see loadCss in client/shared/dom.js.
const SONAR_CSS = await loadCss(new URL('./sonar-panel.css', import.meta.url));

const D2R = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const SWEEP_MS = 3200;   // one turn of the sweep

// Return strength to colour, the finder's own scale.
const RAMP = [[0.0, [30, 70, 200]], [0.3, [40, 190, 220]], [0.5, [80, 230, 110]], [0.72, [250, 225, 70]], [1, [255, 70, 50]]];
function ramp(v) {
  for (let i = 1; i < RAMP.length; i++) {
    if (v <= RAMP[i][0]) {
      const [a, ca] = RAMP[i - 1], [b, cb] = RAMP[i], t = (v - a) / (b - a);
      return [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t];
    }
  }
  return RAMP[RAMP.length - 1][1];
}
const rgba = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

// A small repeatable noise for the clutter, so the screen fizzes without a random source.
const fizz = (i, t) => { const s = Math.sin(i * 12.9898 + t * 78.233) * 43758.5453; return s - Math.floor(s); };

function ensureStyles() {
  if (typeof document === 'undefined' || document.getElementById('sonar-styles')) return;
  const s = document.createElement('style');
  s.id = 'sonar-styles';
  s.textContent = SONAR_CSS;
  document.head.appendChild(s);
}

/** Builds the panel inside `root`. `on(act)` is told 'power', 'range' or 'gain' when a button's pressed. */
export function mountSonar(root, on) {
  ensureStyles();
  const el = document.createElement('div');
  el.className = 'sn-unit';
  el.hidden = true;
  el.innerHTML = `<div class="sn-head"><span class="sn-name">SOUNDER</span><span class="sn-under" data-r="under"></span></div>
    <canvas class="sn-screen" data-r="screen"></canvas>
    <div class="sn-keys">
      <button class="sn-key" data-a="range" type="button" title="how far out it looks"><span data-r="range"></span></button>
      <button class="sn-key" data-a="gain" type="button" title="how faint a return it shows"><span data-r="gain"></span></button>
      <button class="sn-key sn-off" data-a="power" type="button" title="switch it off (M)">OFF</button>
    </div>`;
  root.appendChild(el);
  el.querySelectorAll?.('.sn-key')?.forEach?.((b) => {
    b.addEventListener('click', (e) => { e.stopPropagation?.(); on(b.dataset.a); });
    b.addEventListener('pointerdown', (e) => e.stopPropagation?.());
  });
  const q = (r) => el.querySelector(`[data-r="${r}"]`);
  return { el, cv: q('screen'), under: q('under'), range: q('range'), gain: q('gain') };
}

export function showSonar(P, on) { if (P?.el && P.el.hidden === !!on) P.el.hidden = !on; }

function fit(cv) {
  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const w = Math.round((cv.clientWidth || 340) * dpr), h = Math.round((cv.clientHeight || 172) * dpr);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  return { w, h, k: dpr };
}

function sweepPlan(g, x0, y0, S, D) {
  const { scan, rangeM, bearing, t, grid, n, lure, aimM } = D;
  const cx = x0 + S / 2, cy = y0 + S / 2, R = S / 2 - 3 * D.k;
  g.save();
  g.beginPath(); g.arc(cx, cy, R, 0, 7); g.clip();
  g.fillStyle = '#04122c'; g.fillRect(x0, y0, S, S);
  // The chart: deeper is darker, land is a hatched brown.
  if (grid) {
    const c = (2 * R) / n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const d = grid[j * n + i], X = cx - R + i * c, Y = cy - R + j * c;
      if (d <= 0) { g.fillStyle = '#4a3a22'; g.fillRect(X, Y, c + 1, c + 1); continue; }
      const k = clamp(1 - d / 45, 0, 1);
      g.fillStyle = `rgb(${6 + 8 * k | 0},${22 + 44 * k | 0},${52 + 74 * k | 0})`;
      g.fillRect(X, Y, c + 1, c + 1);
    }
  }
  const px = (right, ahead) => [cx + (right / rangeM) * R, cy - (ahead / rangeM) * R];
  // The rings.
  g.strokeStyle = 'rgba(150,210,230,0.26)'; g.lineWidth = D.k;
  for (const f of [1 / 3, 2 / 3]) { g.beginPath(); g.arc(cx, cy, R * f, 0, 7); g.stroke(); }
  g.beginPath(); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.stroke();
  // The beam, and how far the rod reaches along it.
  const b0 = (bearing - BEAM_DEG - 90) * D2R, b1 = (bearing + BEAM_DEG - 90) * D2R;
  g.fillStyle = 'rgba(255,226,150,0.13)';
  g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, b0, b1); g.closePath(); g.fill();
  if (aimM > 0) {
    const ar = (aimM / rangeM) * R;
    g.strokeStyle = 'rgba(255,226,150,0.8)'; g.lineWidth = 1.5 * D.k;
    g.beginPath(); g.arc(cx, cy, ar, b0, b1); g.stroke();
  }
  // The sweep, with a tail.
  const sw = ((t % SWEEP_MS) / SWEEP_MS) * Math.PI * 2 - Math.PI / 2;
  for (let i = 0; i < 14; i++) {
    g.fillStyle = `rgba(90,230,200,${0.11 * (1 - i / 14)})`;
    g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, sw - (i + 1) * 0.09, sw - i * 0.09); g.closePath(); g.fill();
  }
  g.strokeStyle = 'rgba(150,255,225,0.75)'; g.lineWidth = 1.2 * D.k;
  g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(sw) * R, cy + Math.sin(sw) * R); g.stroke();
  // The wrecks, as a hard square.
  g.fillStyle = '#ff6a4a';
  for (const w of scan.wrecks) {
    const [X, Y] = px(w.right, w.ahead);
    g.fillRect(X - 2.5 * D.k, Y - 2.5 * D.k, 5 * D.k, 5 * D.k);
  }
  // The marks, bright where the sweep has just been.
  for (const m of scan.marks) {
    const a = (Math.atan2(m.ahead, m.right) * -1 + Math.PI * 2) % (Math.PI * 2);
    const age = (((sw + Math.PI * 2) % (Math.PI * 2)) - a + Math.PI * 2) % (Math.PI * 2);
    const fresh = 0.3 + 0.7 * Math.exp(-age * 0.7);
    const [X, Y] = px(m.right, m.ahead);
    g.fillStyle = rgba(ramp(m.s), fresh);
    g.beginPath(); g.arc(X, Y, (1.2 + m.s * 2.4) * D.k, 0, 7); g.fill();
  }
  if (lure) {
    const [X, Y] = px(lure.right, lure.ahead);
    g.strokeStyle = '#fff'; g.lineWidth = 1.5 * D.k;
    g.beginPath(); g.arc(X, Y, 3.5 * D.k, 0, 7); g.stroke();
  }
  // Her.
  g.fillStyle = '#f2ecd8';
  g.beginPath(); g.moveTo(cx, cy - 6 * D.k); g.lineTo(cx + 3 * D.k, cy + 4 * D.k); g.lineTo(cx - 3 * D.k, cy + 4 * D.k); g.closePath(); g.fill();
  g.restore();
  g.strokeStyle = '#2c4a58'; g.lineWidth = 1.5 * D.k;
  g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke();
  g.fillStyle = 'rgba(190,230,240,0.8)'; g.font = `${9 * D.k}px "Courier New", monospace`; g.textAlign = 'left';
  g.fillText(`${rangeM}m`, x0 + 4 * D.k, y0 + 10 * D.k);
}

// A fish on a sounder is an arch: the return is nearest when it's in the middle of the beam.
function arch(g, X, Y, s, c, k) {
  const w = (3 + s * 6) * k, h = (1 + s * 2.2) * k;
  g.strokeStyle = c; g.lineWidth = (1 + s * 1.6) * k; g.lineCap = 'round';
  g.beginPath(); g.moveTo(X - w, Y + h); g.quadraticCurveTo(X, Y - h * 1.2, X + w, Y + h); g.stroke();
}

function beamSlice(g, x0, y0, W, H, D) {
  const { scan, rangeM, bearing, t, lure, follow, hooked, k, gain } = D;
  const deep = screenDepth(scan.bottomM);
  const top = y0 + 2 * k, h = H - 4 * k;
  const X = (m) => x0 + 2 * k + (m / rangeM) * (W - 26 * k);
  const Y = (d) => top + (d / deep) * h;
  const gr = g.createLinearGradient(0, top, 0, top + h);
  gr.addColorStop(0, '#0a2a5a'); gr.addColorStop(1, '#030e22');
  g.fillStyle = gr; g.fillRect(x0, y0, W, H);
  // The surface clutter and a scatter of plankton, more of it on a high gain.
  const nz = [14, 34, 70][gain];
  for (let i = 0; i < nz; i++) {
    const a = fizz(i, (t / 300) | 0), b = fizz(i + 99, (t / 300) | 0);
    g.fillStyle = `rgba(70,150,220,${0.15 + 0.3 * b})`;
    g.fillRect(x0 + a * (W - 26 * k), top + b * b * h * 0.7, 1.4 * k, 1.4 * k);
  }
  g.fillStyle = 'rgba(120,200,240,0.55)';
  for (let i = 0; i < 40; i++) g.fillRect(x0 + (i / 40) * (W - 26 * k), top + fizz(i, (t / 200) | 0) * 3 * k, 2 * k, 1.5 * k);
  // The floor: a hot line and a cooling band under it.
  const pts = [];
  for (let i = 0; i < PROFILE_N; i++) pts.push([X((i / (PROFILE_N - 1)) * rangeM), Y(Math.max(0.2, scan.profile[i]))]);
  const trace = (off) => { g.beginPath(); pts.forEach(([a, b], i) => (i ? g.lineTo(a, b + off) : g.moveTo(a, b + off))); };
  const under = g.createLinearGradient(0, top, 0, top + h);
  under.addColorStop(0, '#7a3a14'); under.addColorStop(1, '#2a1208');
  trace(0); g.lineTo(X(rangeM), top + h + 2); g.lineTo(X(0), top + h + 2); g.closePath(); g.fillStyle = under; g.fill();
  for (const [off, c, lw] of [[5 * k, 'rgba(80,230,110,0.7)', 3], [2.6 * k, 'rgba(250,225,70,0.9)', 2.2], [0.6 * k, 'rgba(255,70,50,1)', 2]]) {
    trace(off); g.strokeStyle = c; g.lineWidth = lw * k; g.stroke();
  }
  // The depth scale.
  g.font = `${9 * k}px "Courier New", monospace`; g.textAlign = 'right';
  g.fillStyle = 'rgba(190,230,240,0.85)'; g.strokeStyle = 'rgba(190,230,240,0.16)'; g.lineWidth = k;
  const step = deep > 30 ? 10 : 5;
  for (let d = step; d < deep; d += step) {
    g.beginPath(); g.moveTo(x0, Y(d)); g.lineTo(x0 + W - 22 * k, Y(d)); g.stroke();
    g.fillText(String(d), x0 + W - 3 * k, Y(d) + 3 * k);
  }
  // The fish in the beam.
  for (const m of scan.marks) {
    const a = inBeam(m, bearing);
    if (a < 0) continue;
    const px = X(a), py = Y(m.depth);
    const f = follow && follow.has(m.key);
    arch(g, px, py, m.s, f ? '#fff' : rgba(ramp(m.s)), k);
    if (m.key === hooked) { g.strokeStyle = '#ff5a4a'; g.lineWidth = 1.5 * k; g.beginPath(); g.arc(px, py, 7 * k, 0, 7); g.stroke(); }
  }
  // The lure: its line down from the surface, and its depth beside it.
  if (lure && lure.along >= 0) {
    const lx = X(lure.along), ly = Y(lure.depth);
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = k; g.setLineDash([3 * k, 3 * k]);
    g.beginPath(); g.moveTo(lx, top); g.lineTo(lx, ly); g.stroke();
    g.setLineDash([]);
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(lx, ly, 2.6 * k, 0, 7); g.fill();
    g.textAlign = 'left'; g.fillText(`${lure.depth.toFixed(0)}m`, lx + 5 * k, ly + 3 * k);
  }
}

/**
 * Paints one frame. `D`: { scan, rangeM, gain, bearing, t, grid, n, lure: { right, ahead, along, depth }
 * or null, aimM, follow: Set of mark keys, hooked: a mark key }.
 */
export function paintSonar(P, D) {
  const cv = P?.cv, g = cv?.getContext?.('2d');
  if (!g) return;
  const { w, h, k } = fit(cv);
  D.k = k;
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#02070f'; g.fillRect(0, 0, w, h);
  const compact = w < 280 * k;
  if (compact) beamSlice(g, 0, 0, w, h, D);
  else { sweepPlan(g, 0, 0, h, D); beamSlice(g, h + 3 * k, 0, w - h - 3 * k, h, D); }
  const txt = `${D.scan.underM.toFixed(1)} m`;
  if (P.under && P.under.textContent !== txt) P.under.textContent = txt;
  const rg = `RANGE ${RANGES_M[D.rangeIdx] ?? D.rangeM}`, gn = `GAIN ${GAIN_NAMES[D.gain]}`;
  if (P.range && P.range.textContent !== rg) P.range.textContent = rg;
  if (P.gain && P.gain.textContent !== gn) P.gain.textContent = gn;
}
