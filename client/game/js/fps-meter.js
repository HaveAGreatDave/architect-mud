// ── DEBUG FPS METER (F3, or Settings → Layout → Perf Meter) ─────────────────────────────────────
//
// A small overlay in the top-left corner: frames per second, the average and the 1% low over the
// last four seconds, the current frame time, and a rolling frame-time graph with 60 fps and 30 fps
// guide lines. While a 3-D seat is painting it adds the paint's own CPU time, the resolution step,
// the governor and the pacing. F3 toggles it, and so does the tablet's Settings, which is the only
// way to reach it on a phone. The choice is remembered on this browser.
//
// It measures the PAGE's frame interval off its own requestAnimationFrame loop, so it reports what
// the player actually sees, whatever is drawing. It is not the renderer's own `st.frameMs` (the
// time spent inside paintWindshield), which is a different and smaller number.
//
// ⚠ A hidden tab freezes requestAnimationFrame, so the meter reads nothing while the page is in the
// background; it resets its window on return rather than reporting the gap as one enormous frame.
// ⚠ The loop only runs while the meter is shown, so it costs nothing when off.
//
// ── THE SEAT SUMMARY, WHICH RUNS WITH THE METER OFF ─────────────────────────────────────────────
//
// A feedback report from a phone is the only number David gets from one, and nobody presses F3 on
// a phone. So every real paint of a seat also lands in a second ring: its CPU ms and the gap since
// the seat's previous paint. It's fed from the paint itself (glass-veil.js's tap, which windshield.js
// already calls with each paint's wall time), so it runs only while a seat is painting and writes
// two floats a paint, nothing allocated. `glassSummary()` reads it at send time.

import { setPaintTap } from './panels/glass-veil.js';
import { GL_TIER, isLoaded, lastViewState } from './panels/windshield-lazy.js';

const KEY = 'F3';
const STORE = 'thomas.fpsMeter';
const N = 240;                 // samples in the window (~4 s at 60 fps)
const W = 240, H = 64;         // graph size, CSS pixels
const MAX_MS = 50;             // top of the graph; anything slower is pinned there and drawn red
const TEXT_MS = 250;           // the text is rebuilt four times a second; the graph every frame

let el = null, cv = null, g = null, txt = null, raf = 0, last = 0, textAt = 0;
const ms = new Float32Array(N);
let n = 0, head = 0;

function read(k) { try { return localStorage.getItem(k); } catch { return null; } }
function write(k, v) { try { localStorage.setItem(k, v); } catch { /* private window: forget it */ } }

// ── The seat ring ───────────────────────────────────────────────────────────────────────────────
// ⚠ ONE SEAT, CHOSEN BY PAINT COUNT. The tap sees every view that paints: the cab's rear mirror
// paints a few times a second beside the windshield, and the helm mints a fresh id per wheelhouse.
// Once a second the id that painted most becomes the seat, and a new seat starts the ring again.
const SN = 240;
const seatPaint = new Float32Array(SN);   // the paint's CPU ms
const seatGap = new Float32Array(SN);     // ms since the seat's previous paint; 0 when there wasn't one
let seatN = 0, seatHead = 0, seatTotal = 0, seatId = null, seatLastAt = 0;
let winAt = 0;
const winCounts = new Map();

function pickSeat() {
  let best = seatId, bn = -1;
  for (const [k, c] of winCounts) if (c > bn) { bn = c; best = k; }
  winCounts.clear();
  if (best !== seatId) { seatId = best; seatN = 0; seatHead = 0; seatLastAt = 0; }
}

function onPaint(id, paintMs) {
  const now = performance.now();
  // Counts from a seat that closed a while ago would outvote the one that just opened.
  if (now - winAt > 2000) winCounts.clear();
  winCounts.set(id, (winCounts.get(id) || 0) + 1);
  if (now - winAt > 1000) { pickSeat(); winAt = now; }
  if (id !== seatId) return;
  // A gap over a second is a closed seat, a hidden tab or a breakpoint, not a frame.
  const gap = seatLastAt && now - seatLastAt < 1000 ? now - seatLastAt : 0;
  seatLastAt = now;
  seatPaint[seatHead] = paintMs; seatGap[seatHead] = gap;
  seatHead = (seatHead + 1) % SN; if (seatN < SN) seatN++;
  seatTotal++;
}

// Where the seat ring stands, for the bench (glass-bench.js).
export function seatPaints() { return { id: seatId, total: seatTotal, lastAt: seatLastAt }; }

// The last k samples, oldest first, as plain arrays. Allocates; call it at read time only.
export function seatSamples(k) {
  k = Math.min(k, seatN);
  const paint = [], gap = [];
  for (let i = 0; i < k; i++) {
    const j = (seatHead - k + i + SN) % SN;
    paint.push(seatPaint[j]);
    if (seatGap[j] > 0) gap.push(seatGap[j]);
  }
  return { paint, gap };
}

const r1 = (v) => Math.round(v * 10) / 10;
// Median, p90, p95 and max of a list, in ms to one decimal. Null for an empty list.
export function spread(list) {
  if (!list.length) return null;
  const v = list.slice().sort((a, b) => a - b);
  const at = (p) => r1(v[Math.min(v.length - 1, Math.floor(v.length * p))]);
  return { p50: at(0.5), p90: at(0.9), p95: at(0.95), max: r1(v[v.length - 1]) };
}

// The last `__glassBench()` result, carried into the next feedback report.
let lastBench = null;
export function setLastBench(b) { lastBench = b || null; }

// What the renderer's dials say right now. `GL_TIER` is a live binding: undefined until the first
// seat loads windshield.js. `LAST_VIEW` is the last view painted, which can be the mirror.
function dials() {
  const tune = window.__wsTune;
  let resStep = null;
  try {
    const lv = isLoaded() ? lastViewState() : null;
    if (lv && lv.id === seatId && lv.resStep != null) resStep = r1(lv.resStep);
  } catch { /* diagnostic only */ }
  const pace = window.__wsPace;
  return {
    glass: tune ? (tune.gl ? 2 : 1) : null,
    tier: GL_TIER || null,
    resStep,
    gov: window.__wsGov != null ? Math.round(window.__wsGov * 1000) / 1000 : null,
    // Only written while RENDER_TUNE.pace30 is on; `step` 2 means every second refresh.
    pace: pace && tune && tune.pace30 ? pace.step : null,
  };
}

// The seat summary for a feedback report. Works with the meter off; null fields until a seat has
// painted. `ageS` says how long ago the seat last painted, since a report is often filed after it.
export function glassSummary() {
  const out = { ...dials(), seat: null, bench: lastBench };
  if (seatN) {
    const { paint, gap } = seatSamples(SN);
    const f = spread(gap), p = spread(paint);
    const mean = gap.length ? gap.reduce((a, b) => a + b, 0) / gap.length : 0;
    out.seat = {
      id: seatId, samples: seatN, ageS: Math.round((performance.now() - seatLastAt) / 100) / 10,
      fps: mean ? Math.round(1000 / mean) : null,
      frameMs: f && { p50: f.p50, p95: f.p95, max: f.max },
      paintMs: p && { p50: p.p50, p95: p.p95, max: p.max },
    };
  }
  return out;
}

// ── The overlay ─────────────────────────────────────────────────────────────────────────────────

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
  return `GLASS ${t.gl ? 2 : 1}${GL_TIER ? ' · ' + GL_TIER + ' tier' : ''} · clouds: ${cloud}`;
}

// The seat line: the paint's CPU time over its last 30 paints and the dials. Empty with no seat up.
function seatLine(now) {
  if (!seatN || now - seatLastAt > 1000) return '';
  const k = Math.min(30, seatN);
  let sum = 0, worst = 0;
  for (let i = 0; i < k; i++) { const v = seatPaint[(seatHead - 1 - i + SN) % SN]; sum += v; if (v > worst) worst = v; }
  const d = dials();
  return `<br>paint ${(sum / k).toFixed(1)} ms · worst ${worst.toFixed(0)}`
    + (d.resStep != null ? ` · res ${d.resStep}` : '')
    + (d.gov != null ? ` · gov ${d.gov.toFixed(2)}` : '')
    + (d.pace > 1 ? ` · ÷${d.pace}` : '');
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

  // The text costs a sort and an innerHTML; on a phone that is enough to move the number it reports.
  if (now - textAt >= TEXT_MS) {
    textAt = now;
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
      + seatLine(now)
      + `<br><span style="color:#8a94a0">${renderer()}</span>`;
  }

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

// A summary of the meter's own window for the feedback report, or null while the meter is off.
// The seat summary above is the one that runs regardless.
export function fpsSummary() {
  if (!raf || !n) return null;
  const v = Array.from({ length: n }, (_, i) => ms[(head - n + i + N) % N]).sort((a, b) => a - b);
  const mean = v.reduce((a, b) => a + b, 0) / n;
  return { fps: Math.round(1000 / mean), p95ms: Math.round(v[Math.floor(n * 0.95)] * 10) / 10, samples: n, renderer: renderer() };
}

export function fpsMeterOn() { return !!(el && el.style.display !== 'none'); }

export function setFpsMeter(on) {
  if (on) {
    if (!el) build();
    el.style.display = '';
    if (!raf) { last = performance.now(); n = 0; head = 0; textAt = 0; raf = requestAnimationFrame(frame); }
  } else {
    if (el) el.style.display = 'none';
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
  }
  write(STORE, on ? '1' : '0');
}

export function installFpsMeter() {
  if (typeof window === 'undefined' || window.__fpsMeterInstalled) return;
  window.__fpsMeterInstalled = true;
  setPaintTap(onPaint);
  // The bench is loaded on the first call, so a session that never asks for it never fetches it.
  window.__glassBench = (opts) => import('./glass-bench.js').then((m) => m.glassBench(opts));
  // Capture phase, so a seat that owns the keyboard (the cab, the cockpit) cannot swallow the toggle.
  window.addEventListener('keydown', (e) => {
    if (e.key !== KEY || e.repeat) return;
    e.preventDefault();     // F3 is the browser's "find next"
    setFpsMeter(!fpsMeterOn());
  }, true);
  if (read(STORE) === '1') setFpsMeter(true);
}
