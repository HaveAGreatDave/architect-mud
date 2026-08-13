// CALIBRATION RIG, drawn in characters.
//
// The same instrument as calibration.js, and deliberately the SAME GAME rather
// than a different one wearing the name: the same three stages, the same drift,
// the same tolerance window scaled off skill-versus-difficulty, the same 0-100
// score out of the same arithmetic. Only the drawing changes.
//
// That equivalence is the rule the Display Mode ladder rests on. A text rung
// that quietly played something easier would make the preference a difficulty
// setting, which is not what anybody chose it for.
//
// ONE INPUT, because a character board has no cursor to chase: the trace is
// nudged with up/down (arrow keys, W/S, or the two on-screen buttons), and SPACE
// pulls the servos together in BALANCE. In SETTLE, doing nothing is the play.
import { setAreaPane } from '../render.js';
import { sendCmdSilent } from '../net.js';
import { esc, bar, centreBar, paintRow, heading, meter, ensureTextUiStyles, clamp } from './textui.js';

const W = 46;
const LANES = 34;
const DUR = 5200;
const PHASES = ['PHASE', 'BALANCE', 'SETTLE'];

let _open = false;
let s = null;

export function isTextCalibrationActive() { return _open; }

function tuning(skill, difficulty) {
  const gap = (Number(skill) || 4) - (Number(difficulty) || 5);
  return {
    window: clamp(0.17 + gap * 0.012, 0.055, 0.30),
    drift: clamp(0.52 - gap * 0.03, 0.16, 1.05),
  };
}

// The scope line: a ruler with the tolerance window marked and the trace on it.
function traceRow() {
  const cell = (v) => Math.round(((clamp(v, -1.4, 1.4) + 1.4) / 2.8) * (LANES - 1));
  const lo = cell(s.target - s.tune.window);
  const hi = cell(s.target + s.tune.window);
  const me = cell(s.value);
  const cells = [];
  for (let i = 0; i < LANES; i++) {
    if (i === me) cells.push({ ch: '#', cls: s.inBand ? 'ok' : 'bad' });
    else if (i === lo || i === hi) cells.push({ ch: '|', cls: 'hi' });
    else if (i > lo && i < hi) cells.push({ ch: '-', cls: 'ok' });
    else cells.push({ ch: '.', cls: 'dim' });
  }
  return paintRow(cells);
}

// In BALANCE the two servo traces are shown apart; bringing them together is the
// second thing you are holding at once.
function splitRow() {
  const half = Math.round(Math.abs(s.split) * 12);
  const a = ' '.repeat(Math.max(0, 12 - half)) + '=';
  const b = '=' + ' '.repeat(Math.max(0, 12 - half));
  const together = Math.abs(s.split) < 0.09;
  return `<span class="${together ? 'ok' : 'bad'}">  SERVO A ${esc(a)}${esc(b)} B  ${together ? 'LOCKED' : 'DRIFTING'}</span>`;
}

const HINTS = {
  PHASE: 'Hold the trace between the bars.',
  BALANCE: 'SPACE pulls the servos together while held.',
  SETTLE: 'Let it converge. Any input now costs you.',
};

function render() {
  if (!_open || !s) return;
  const phase = PHASES[s.phase] || 'DONE';
  const left = Math.max(0, DUR - s.elapsed) / 1000;
  const lines = [
    heading(`CALIBRATION RIG — ${String(s.opts.deviceName || 'IMPLANT').toUpperCase()}`, W),
    '',
    `  STAGE <span class="hi">${esc(phase)}</span>  ${s.phase + 1}/${PHASES.length}` +
      `      ${left.toFixed(1)}s      ${s.inBand ? '<span class="ok">IN TOLERANCE</span>' : '<span class="bad">OUT</span>'}`,
    '',
    '  ' + traceRow(),
    phase === 'BALANCE' ? splitRow() : '',
    '',
    meter('QUALITY', s.quality, `${Math.round(s.quality * 100)}%`, { w: 16, labelW: 8 }),
    '',
    `  <span class="dim">${esc(HINTS[phase] || '')}</span>`,
    '',
    `  <span class="btn" data-cact="up">[ &#9650; UP ]</span>  ` +
    `<span class="btn" data-cact="down">[ &#9660; DOWN ]</span>  ` +
    `<span class="btn" data-cact="sync">[ SYNC ]</span>  ` +
    `<span class="btn" data-cact="abort">[ ABORT ]</span>`,
    s.status ? '' : null,
    s.status || null,
  ];
  setAreaPane(`<div class="txui txcal">${lines.filter(l => l !== null).join('\n')}</div>`);
  const root = document.querySelector('.txcal');
  if (root) {
    root.querySelectorAll('[data-cact]').forEach(el => {
      el.addEventListener('click', () => command(el.getAttribute('data-cact')));
    });
  }
}

function tick() {
  if (!_open || !s || s.done) return;
  const now = performance.now();
  const dt = Math.min(0.06, (now - s.last) / 1000);
  s.last = now;
  s.elapsed += dt * 1000;
  const phase = PHASES[s.phase];

  if (phase === 'SETTLE') {
    s.settle = Math.min(1, s.settle + dt * 0.5);
    s.value += (s.target - s.value) * dt * 1.6 * s.settle;
  } else {
    s.drift += (Math.random() - 0.5) * dt * 2.2;
    s.drift = clamp(s.drift, -1, 1);
    s.value = clamp(s.value + s.drift * s.tune.drift * dt, -1.4, 1.4);
    if (phase === 'BALANCE') {
      s.split += (Math.random() - 0.5) * dt * 0.5;
      s.split = clamp(s.split - Math.sign(s.split) * s.correcting * dt * 0.9, -0.6, 0.6);
    }
  }

  const off = Math.abs(s.value - s.target);
  const together = phase !== 'BALANCE' || Math.abs(s.split) < 0.09;
  s.inBand = off < s.tune.window && together;
  s.frames++;
  if (s.inBand) s.hits++;
  s.quality = s.hits / Math.max(1, s.frames);

  if (s.elapsed >= DUR) {
    s.scores.push(s.quality);
    s.phase++;
    if (s.phase >= PHASES.length) return finish();
    s.elapsed = 0; s.hits = 0; s.frames = 0; s.quality = 0;
    s.target = (Math.random() - 0.5) * 0.9;
    s.value = 0; s.drift = 0; s.split = 0.35; s.settle = 0;
  }
  render();
  s.timer = setTimeout(tick, 90);   // ~11fps — legible in characters, not a strobe
}

function finish() {
  if (!s || s.done) return;
  s.done = true;
  clearTimeout(s.timer);
  const mean = s.scores.reduce((a, b) => a + b, 0) / Math.max(1, s.scores.length);
  const score = Math.round(clamp(mean, 0, 1) * 100);
  const verdict = score >= 90 ? 'DEAD ON' : score >= 70 ? 'WELL INSIDE'
    : score >= 45 ? 'ACCEPTABLE' : score >= 20 ? 'LOOSE' : 'ALL OVER THE PLACE';
  s.status = `  <span class="${score >= 45 ? 'ok' : 'bad'}">&gt;&gt; ${score} — ${verdict}</span>`;
  render();
  report(score);
  setTimeout(() => close(), 1600);
}

function report(score) {
  if (!s || s.reported) return;
  s.reported = true;
  const cb = s.opts.onResult;
  if (cb) cb({ score });
}

export function command(word) {
  if (!_open || !s) return false;
  const w = String(word || '').toLowerCase();
  const phase = PHASES[s.phase];
  if (w === 'up' || w === 'down') {
    s.value += (w === 'up' ? -1 : 1) * 0.055;
    s.drift *= 0.55;
    if (phase === 'SETTLE') s.settle = Math.max(0, s.settle - 0.35);
    render();
    return true;
  }
  if (w === 'sync') {
    // No keyup on a clicked button, so a tap is a short pulse rather than a hold.
    s.correcting = 1;
    clearTimeout(s.syncTimer);
    s.syncTimer = setTimeout(() => { if (s) s.correcting = 0; }, 320);
    if (phase === 'SETTLE') s.settle = Math.max(0, s.settle - 0.35);
    return true;
  }
  if (w === 'abort') { close(); return true; }
  return false;
}

function onKey(e) {
  if (!_open || !s) return;
  if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') { e.preventDefault(); command('up'); }
  else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') { e.preventDefault(); command('down'); }
  else if (e.key === ' ') { e.preventDefault(); s.correcting = 1; if (PHASES[s.phase] === 'SETTLE') s.settle = Math.max(0, s.settle - 0.35); }
  else if (e.key === 'Escape') { close(); }
}
function onKeyUp(e) { if (e.key === ' ' && s) s.correcting = 0; }

export function openTextCalibration(opts = {}) {
  ensureTextUiStyles();
  close();
  s = {
    opts: { skill: 4, difficulty: 5, deviceName: 'IMPLANT', onResult: null, ...opts },
    tune: tuning(opts.skill, opts.difficulty),
    phase: 0, elapsed: 0, last: performance.now(),
    value: 0, target: (Math.random() - 0.5) * 0.9, drift: 0,
    split: 0.35, settle: 0, correcting: 0,
    hits: 0, frames: 0, quality: 0, inBand: false,
    scores: [], done: false, reported: false, status: '', timer: 0, syncTimer: 0,
  };
  _open = true;
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  render();
  s.timer = setTimeout(tick, 90);
  return true;
}

export function close() {
  if (!_open) { s = null; return; }
  _open = false;
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('keyup', onKeyUp);
  if (s) {
    clearTimeout(s.timer);
    clearTimeout(s.syncTimer);
    // Abandoning still reports — the rig is already spent, so an unreported
    // abort would be a free retry the graphical board doesn't get either.
    if (!s.reported) {
      const runs = s.scores.concat(s.done ? [] : [s.quality]);
      const mean = runs.reduce((a, b) => a + b, 0) / Math.max(1, PHASES.length);
      report(Math.round(clamp(mean, 0, 1) * 100));
    }
    s = null;
  }
  sendCmdSilent('look');   // hand the pane back to the room
}
