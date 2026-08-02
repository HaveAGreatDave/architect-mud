// SIGNAL HIJACK, drawn in characters.
//
// The same capture: the same carrier drifting and frequency-hopping across the
// band, the same decoy harmonics mimicking it, the same lock tolerance, the same
// capture fill/drain and TRACE rate — because it is the same loop in
// signalhijack.js with the drawing swapped.
//
// A spectrum analyser is almost the easiest thing in the game to draw in
// characters: a band is a row of cells and a peak is a tall one. What the canvas
// gives you that this doesn't is the smooth gaussian skirt of each peak; what
// this gives you back is that the tuner window is drawn as literal brackets
// around the cells it covers, so "am I on it" is a yes/no you can read rather
// than a distance you have to judge.
//
// It stays REAL-TIME. The carrier moves whether or not you are ready, and that is
// the game.
import { setAreaPane } from '../render.js';
import { sendCmdSilent } from '../net.js';
import { esc, bar, paintRow, heading, ensureTextUiStyles } from './textui.js';
import {
  setSignalSkin, startSignalGame, stopSignalGame, SIGNAL_W,
  signalSweep, signalOverdrive, signalTune,
} from './signalhijack.js';

let _opts = null;
let _status = '';
let _open = false;
let _lastPaint = 0;
let _st = null;

export function isTextSignalActive() { return _open; }

const BAND = 46;                       // cells across the spectrum
const cellOf = (x) => Math.max(0, Math.min(BAND - 1, Math.round((x / SIGNAL_W) * (BAND - 1))));

// The band. Peaks are drawn at their cell; a SWEEP tags the true carrier and dims
// the decoys for ~2s, exactly as it does on the canvas — so during a sweep the
// carrier is `▲` and decoys are `▵`, and outside one they are indistinguishable.
// Leaking which is which the rest of the time would delete the whole game.
function bandRow(s) {
  const cells = Array.from({ length: BAND }, () => ({ ch: '·', cls: 'noise' }));
  const swept = s.swept > 0;

  for (const d of s.decoys) {
    cells[cellOf(d.x)] = { ch: swept ? '▵' : '▲', cls: swept ? 'decoy' : 'peak' };
  }
  cells[cellOf(s.carrier.x)] = { ch: '▲', cls: swept ? 'carrier' : 'peak' };

  // The tuner window, drawn over the top as brackets round what it covers.
  const half = Math.max(1, Math.round((s.tol / 2 / SIGNAL_W) * (BAND - 1)));
  const t = cellOf(s.tuner);
  const lo = Math.max(0, t - half), hi = Math.min(BAND - 1, t + half);
  const out = [];
  for (let i = 0; i < BAND; i++) {
    if (i === lo) out.push({ ch: '[', cls: s.locked ? 'lockon' : 'tuner' });
    out.push(i >= lo && i <= hi && cells[i].ch === '·'
      ? { ch: '·', cls: s.locked ? 'lockon' : 'tuner' }
      : cells[i]);
    if (i === hi) out.push({ ch: ']', cls: s.locked ? 'lockon' : 'tuner' });
  }
  return paintRow(out);
}

const W = 52;

function paint(s) {
  if (!s) return;
  const capCls = s.cap >= 66 ? 'ok' : s.cap >= 33 ? 'warn' : 'amp';
  const trCls = s.trace >= 75 ? 'bad' : s.trace >= 40 ? 'warn' : 'ok';
  // The three capture notches — AUDIO / VIDEO / SCHEDULER — are what tell you a
  // long hold is worth something. Same thresholds the graphical meter marks.
  const notch = (pct, label) => `<span class="${s.cap >= pct ? 'ok' : 'dim'}">${label}</span>`;

  const lines = [
    `<div class="txui-hd"><span>SIGNAL HIJACK</span><span>${esc(String(_opts.stationName || 'STATION').toUpperCase())}</span></div>`,
    heading('SPECTRUM', W),
    bandRow(s),
    `<span class="${s.locked ? 'lockon' : 'dim'}">${s.locked ? '        ●  CARRIER LOCKED' : '        ○  no lock'}</span>`
      + (s.swept > 0 ? '   <span class="carrier">▲ true carrier tagged</span>' : ''),
    heading('CAPTURE', W),
    `<span class="dim">CAPTURE </span>${bar(s.cap / 100, 26, capCls)} <span class="${capCls}">${Math.round(s.cap)}%</span>`,
    `          ${notch(33, 'AUDIO')}  ${notch(66, 'VIDEO')}  ${notch(100, 'SCHEDULER')}`,
    `<span class="dim">TRACE   </span>${bar(s.trace / 100, 26, trCls)} <span class="${trCls}">${Math.round(s.trace)}%</span>`,
    _status ? `\n${_status}` : '',
    heading('ACTIONS', W),
    `<span class="pick" data-sact="-24">[ ◀◀ ]</span> <span class="pick" data-sact="-8">[ ◀ ]</span>  `
      + `<span class="pick" data-sact="8">[ ▶ ]</span> <span class="pick" data-sact="24">[ ▶▶ ]</span>  `
      + `<span class="pick" data-sact="sweep">[ sweep ]</span>  `
      + `<span class="pick" data-sact="over">[ overdrive ]</span>  `
      + `<span class="pick" data-sact="abort">[ abort ]</span>`,
    `<span class="dim">← → to tune · sweep tags the real carrier and costs trace · overdrive fills faster and burns faster</span>`,
  ];
  setAreaPane(`<div class="txui txsg">${lines.filter(Boolean).join('\n')}</div>`);
  wire();
}

function wire() {
  const root = document.querySelector('.txsg');
  if (!root) return;
  root.querySelectorAll('[data-sact]').forEach(el => {
    el.addEventListener('click', () => command(el.getAttribute('data-sact')));
  });
}

// OVERDRIVE is a HOLD on the graphical board. A hold is a poor fit for a text
// panel (and impossible from a command line), so here it TOGGLES — same effect,
// same costs, just latched. That's a genuine interface difference and it is
// deliberately in the player's favour only in ergonomics, never in numbers.
let _over = false;

function onKey(e) {
  if (!_open) return;
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); signalTune(-8); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); signalTune(8); }
  else if (e.code === 'Space') { e.preventDefault(); command('over'); }
}

export function command(word) {
  if (!_open) return false;
  const w = String(word || '').trim().toLowerCase();
  if (w === 'abort') { close(); return true; }
  if (w === 'sweep') { signalSweep(); return true; }
  if (w === 'over' || w === 'overdrive') { _over = !_over; signalOverdrive(_over); return true; }
  let m = /^tune\s+(-?\d+)$/.exec(w);
  if (m) { signalTune(parseInt(m[1], 10)); return true; }
  if (/^-?\d+$/.test(w) && w.length <= 4) { signalTune(parseInt(w, 10)); return true; }
  return false;
}

const SKIN = {
  board: (s) => { _st = s; paint(s); },
  hud: (s) => { _st = s; },
  status: (html) => { _status = html; },
  frame: (s) => {
    _st = s;
    const now = performance.now();
    if (now - _lastPaint < 33) return;
    _lastPaint = now;
    paint(s);
  },
  finish: (s, won, text) => {
    _status = `<span class="${won ? 'ok' : 'bad'}">&gt;&gt; ${esc(String(text).replace(/<[^>]*>/g, ''))}</span>`;
    paint(s);
    setTimeout(() => close(), won ? 1200 : 2200);
  },
};

export function openTextSignal(opts = {}) {
  ensureTextUiStyles();
  ensureStyles();
  _opts = { skill: 4, difficulty: 5, stationName: 'STATION', onResult: null, ...opts };
  _status = '<span class="dim">Find the real carrier and hold the lock. Decoys mimic it.</span>';
  _over = false;
  setSignalSkin(SKIN);
  const s = startSignalGame(_opts);
  if (!s) { setSignalSkin(null); return false; }
  _st = s; _open = true;
  window.addEventListener('keydown', onKey);
  paint(s);
  return true;
}

export function close() {
  if (!_open) return;
  _open = false; _st = null; _over = false;
  window.removeEventListener('keydown', onKey);
  stopSignalGame();
  setSignalSkin(null);
  sendCmdSilent('look');
}

function ensureStyles() {
  if (document.getElementById('textsignal-styles')) return;
  const st = document.createElement('style');
  st.id = 'textsignal-styles';
  st.textContent = `
    .txsg { line-height:1.4; }
    .txsg .noise   { color:#26333d; }
    .txsg .peak    { color:#9fb4c4; }
    .txsg .decoy   { color:#3f5260; }
    .txsg .carrier { color:#ff5ad0; font-weight:700; text-shadow:0 0 8px rgba(255,90,208,.8); }
    .txsg .tuner   { color:#5d7f96; }
    .txsg .lockon  { color:#46e05a; font-weight:700; text-shadow:0 0 8px rgba(70,224,90,.7); }
    .txsg .amp     { color:#7fe3ff; }
  `;
  document.head.appendChild(st);
}
