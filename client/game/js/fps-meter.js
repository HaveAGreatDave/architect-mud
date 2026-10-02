// ── DEBUG FPS METER (F3) ──────────────────────────────────────────────────────────────────────
//
// A small overlay in the top-left corner: frames per second, the average and the 1% low over the
// last four seconds, the current frame time, and a rolling frame-time graph with 60 fps and 30 fps
// guide lines. F3 toggles it and the choice is remembered on this browser.
//
// It measures the PAGE's frame interval off its own requestAnimationFrame loop, so it reports what
// the player actually sees, whatever is drawing. It is not the renderer's own `st.frameMs` (the
// time spent inside paintWindshield), which is a different and smaller number.
//
// ⚠ A hidden tab freezes requestAnimationFrame, so the meter reads nothing while the page is in the
// background; it resets its window on return rather than reporting the gap as one enormous frame.
// ⚠ The loop only runs while the meter is shown, so it costs nothing when off.

const KEY = 'F3';
const STORE = 'thomas.fpsMeter';
const N = 240;                 // samples in the window (~4 s at 60 fps)
const W = 240, H = 64;         // graph size, CSS pixels
const MAX_MS = 50;             // top of the graph; anything slower is pinned there and drawn red

let el = null, cv = null, g = null, txt = null, raf = 0, last = 0;
const ms = new Float32Array(N);
let n = 0, head = 0;

function read(k) { try { return localStorage.getItem(k); } catch { return null; } }
function write(k, v) { try { localStorage.setItem(k, v); } catch { /* private window: forget it */ } }

function build() {
  el = document.createElement('div');
  el.id = 'fps-meter';
  el.setAttribute('aria-hidden', 'true');   // a debug readout, not something to read aloud
  el.style.cssText = 'position:fixed;left:8px;top:8px;z-index:100000;pointer-events:none;'
    + 'background:rgba(8,10,14,0.82);border:1px solid rgba(255,255,255,0.15);border-radius:4px;'
    + 'padding:6px 8px;font:11px/1.35 ui-monospace,Consolas,monospace;color:#cfd6df;';
  txt = document.createElement('div');
  cv = document.createElement('canvas');
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  cv.width = W * dpr; cv.height = H * dpr;
  cv.style.cssText = `display:block;width:${W}px;height:${H}px;margin-top:4px`;
  g = cv.getContext('2d');
  g.scale(dpr, dpr);
  el.append(txt, cv);
  document.body.append(el);
}

function renderer() {
  const t = window.__wsTune;
  if (!t) return '';
  let cloud = 'cards';
  try {
    const v = window.__cloudVol && window.__cloudVol();
    if (v && v.running) cloud = 'volume';
    else if (v && v.setting) cloud = 'cards (' + ((v.failed) || (!v.device?.ok && v.device?.reason) || 'volume off') + ')';
  } catch { /* the status call is diagnostic; never let it break the meter */ }
  return `GLASS ${t.gl ? 2 : 1} · clouds: ${cloud}`;
}

// ⚠ WHILE A 3-D SEAT IS PAINTING, THE METER COUNTS ITS PAINTS, NOT THE PAGE'S REFRESHES. The
// windshield can hold an even 30 by painting every second refresh (RENDER_TUNE.pace30), and the
// refreshes it skips cost nothing — so a refresh counter reads ~60 while the view the player is
// looking at updates at 30. `window.__wsPaints` is bumped once per real paint of a seat's main view
// (paintWindshield); while it has moved in the last second, a frame is the gap between two paints.
// With no seat up it never moves and the meter measures refreshes exactly as before.
let lastPaints = -1, lastPaintAt = 0;
function frame(now) {
  raf = requestAnimationFrame(frame);
  const pc = window.__wsPaints;
  if (pc != null && now - (window.__wsPaintAt || 0) < 1000) {
    if (pc === lastPaints) return;          // a refresh the seat skipped: not a frame the player saw
    lastPaints = pc;
    if (!lastPaintAt) { lastPaintAt = now; last = now; return; }
  } else lastPaints = -1;
  const dt = now - last;
  last = now;
  lastPaintAt = now;
  // A gap longer than a second is a hidden tab or a breakpoint, not a frame: start the window again.
  if (dt > 1000) { n = 0; head = 0; return; }
  ms[head] = dt; head = (head + 1) % N; if (n < N) n++;
  if (!n) return;

  let sum = 0;
  const sorted = new Float32Array(n);
  for (let i = 0; i < n; i++) { const v = ms[(head - n + i + N) % N]; sum += v; sorted[i] = v; }
  sorted.sort();
  const avg = sum / n;
  // The 1% low is the frame rate of the slowest 1% of frames, which is what a stutter feels like.
  const worst = sorted[Math.max(0, Math.floor(n * 0.99) - 1)];
  const cur = ms[(head - 1 + N) % N];
  txt.innerHTML = `<b style="color:#fff;font-size:13px">${(1000 / Math.max(cur, 0.01)).toFixed(0)} fps</b>`
    + `  ${cur.toFixed(1)} ms<br>avg ${(1000 / avg).toFixed(0)} · 1% low ${(1000 / worst).toFixed(0)} · worst ${sorted[n - 1].toFixed(0)} ms`
    + `<br><span style="color:#8a94a0">${renderer()}</span>`;

  // The graph: newest on the right, height = frame time, guide lines at 16.7 and 33.3 ms.
  g.clearRect(0, 0, W, H);
  const y = (v) => H - Math.min(v, MAX_MS) / MAX_MS * H;
  g.strokeStyle = 'rgba(120,200,140,0.35)'; g.beginPath(); g.moveTo(0, y(1000 / 60)); g.lineTo(W, y(1000 / 60)); g.stroke();
  g.strokeStyle = 'rgba(230,180,90,0.35)'; g.beginPath(); g.moveTo(0, y(1000 / 30)); g.lineTo(W, y(1000 / 30)); g.stroke();
  const bw = W / N;
  for (let i = 0; i < n; i++) {
    const v = ms[(head - n + i + N) % N];
    g.fillStyle = v > 1000 / 30 ? '#e0605a' : v > 1000 / 55 ? '#e6b45a' : '#6cc98a';
    const top = y(v);
    g.fillRect((N - n + i) * bw, top, Math.max(1, bw), H - top);
  }
  g.fillStyle = '#8a94a0';
  g.fillText('60', W - 14, y(1000 / 60) - 2);
  g.fillText('30', W - 14, y(1000 / 30) - 2);
}

// A summary of the current window for the feedback report, or null while the
// meter is off and so has nothing to say.
export function fpsSummary() {
  if (!raf || !n) return null;
  const v = Array.from({ length: n }, (_, i) => ms[(head - n + i + N) % N]).sort((a, b) => a - b);
  const mean = v.reduce((a, b) => a + b, 0) / n;
  return { fps: Math.round(1000 / mean), p95ms: Math.round(v[Math.floor(n * 0.95)] * 10) / 10, samples: n, renderer: renderer() };
}

export function setFpsMeter(on) {
  if (on) {
    if (!el) build();
    el.style.display = '';
    if (!raf) { last = performance.now(); n = 0; head = 0; raf = requestAnimationFrame(frame); }
  } else {
    if (el) el.style.display = 'none';
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
  }
  write(STORE, on ? '1' : '0');
}

export function installFpsMeter() {
  if (typeof window === 'undefined' || window.__fpsMeterInstalled) return;
  window.__fpsMeterInstalled = true;
  // Capture phase, so a seat that owns the keyboard (the cab, the cockpit) cannot swallow the toggle.
  window.addEventListener('keydown', (e) => {
    if (e.key !== KEY || e.repeat) return;
    e.preventDefault();     // F3 is the browser's "find next"
    setFpsMeter(!(el && el.style.display !== 'none'));
  }, true);
  if (read(STORE) === '1') setFpsMeter(true);
}
