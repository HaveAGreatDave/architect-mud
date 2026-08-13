// CALIBRATION RIG — tuning an implant, not breaking into one.
//
// Every other board in the game is an intrusion fiction: you are outside a thing
// that does not want you in it. This one is the opposite — the machine is yours,
// it is already open, and the job is to make it run right. So it reads as a bench
// instrument rather than a deck: two traces on a scope, a phase dial, and a
// tolerance window you are trying to sit inside.
//
// THREE PHASES, each a different hand:
//   PHASE    — a drifting signal against a reference. Nudge it into the window.
//   BALANCE  — two servo traces out of sync. Hold them together.
//   SETTLE   — stop moving and let it converge. Any input here costs you.
//
// It reports a 0-100 SCORE, not a win. Calibration is a graded quantity and a
// boolean would collapse it into a coin flip — which is the whole reason this
// family exists rather than reusing the breach board.
//
// The score is ADVISORY. The server's own electronics check owns the outcome and
// this is worth at most ±15 around it, so a client reporting a perfect run every
// time is buying a bonus, not the result.
//
// NOTE ON QUOTING: this file is one big template literal. Identifiers inside it
// are quoted with 'single quotes', NEVER backticks — a backtick in a comment
// inside a template literal ends the string mid-sentence and kills the client
// boot for every player. See scripts/client/parse-smoke.mjs.

import {
  ensureChassisStyles, deviceHeader, bezelScrews, crtOverlays, deckStrip,
  setDeckLevel, mountOverlay, sfx, clampNum, esc,
} from './minigame-common.js';

const DUR = 5200;          // ms per phase — short enough to run repeatedly
const PHASES = ['PHASE', 'BALANCE', 'SETTLE'];

let g = null;

function ensureStyles() {
  if (document.getElementById('calibration-styles')) return;
  const s = document.createElement('style');
  s.id = 'calibration-styles';
  s.textContent = `
  #calibration-overlay{position:fixed;inset:0;z-index:9996;display:flex;align-items:center;justify-content:center;
    background:rgba(3,6,9,.88);backdrop-filter:blur(3px);font-family:var(--font-mono,monospace);--mg-accent:#5fd0e0;--mg-base:#0b1114}
  #calibration-overlay .cal-body{width:min(620px,95vw);padding:16px;border-radius:20px;
    background:linear-gradient(170deg,#141b1f,#080c0f)}
  #calibration-overlay .cal-screen{position:relative;height:230px;background:linear-gradient(180deg,#04090b,#020506)}
  #calibration-overlay canvas{position:relative;z-index:1;display:block;width:100%;height:230px}
  #calibration-overlay .cal-stats{display:flex;gap:14px;justify-content:space-between;margin:10px 2px 6px;
    font-size:11px;letter-spacing:1px;color:#7fa7b0}
  #calibration-overlay .cal-stats b{color:#5fd0e0}
  #calibration-overlay .cal-hint{font-size:10px;letter-spacing:1px;color:#5d7880;margin:2px 2px 10px;min-height:14px}
  #calibration-overlay .cal-phase{color:#e0b64f}
  #calibration-overlay .cal-done{position:absolute;inset:0;z-index:5;display:flex;flex-direction:column;
    align-items:center;justify-content:center;gap:10px;background:rgba(2,6,8,.9);border-radius:inherit}
  #calibration-overlay .cal-done .cal-score{font-size:34px;letter-spacing:3px;color:#5fd0e0;
    text-shadow:0 0 18px rgba(95,208,224,.6)}
  #calibration-overlay .cal-done .cal-verdict{font-size:12px;letter-spacing:2px;color:#9fc7cc}
  #calibration-overlay .cal-done button{margin-top:6px;background:#0d1a1e;border:1px solid #2b5b63;color:#9fe4ee;
    padding:7px 20px;border-radius:5px;cursor:pointer;font-family:inherit;letter-spacing:2px;font-size:11px}
  #calibration-overlay .cal-done button:hover{border-color:#5fd0e0;color:#d8f6fb}`;
  document.head.appendChild(s);
}

// Difficulty narrows the tolerance window and quickens the drift; skill widens it
// back. Neither can push the window below a floor you could not physically hit.
function tuning(skill, difficulty) {
  const gap = (Number(skill) || 4) - (Number(difficulty) || 5);
  return {
    window: clampNum(0.17 + gap * 0.012, 0.055, 0.30),   // half-width, 0..1 units
    drift:  clampNum(0.52 - gap * 0.03, 0.16, 1.05),     // units per second
  };
}

function draw() {
  if (!g) return;
  const c = g.ctx, W = g.w, H = g.h;
  c.clearRect(0, 0, W, H);

  const midY = H * 0.5;
  const phase = PHASES[g.phase];

  // Reference trace — where the machine should be.
  c.strokeStyle = 'rgba(95,208,224,0.22)';
  c.lineWidth = 1;
  c.beginPath();
  for (let x = 0; x <= W; x += 3) {
    const y = midY + Math.sin((x / W) * Math.PI * 4 + g.t * 1.6) * (H * 0.18);
    x === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
  }
  c.stroke();

  // The tolerance window — the band you are trying to sit in.
  const winPx = g.tune.window * H * 0.42;
  const targetY = midY + g.target * H * 0.34;
  c.fillStyle = g.inBand ? 'rgba(95,208,224,0.10)' : 'rgba(224,100,79,0.09)';
  c.fillRect(0, targetY - winPx, W, winPx * 2);
  c.strokeStyle = g.inBand ? 'rgba(95,208,224,0.45)' : 'rgba(224,100,79,0.40)';
  c.setLineDash([4, 4]);
  c.beginPath(); c.moveTo(0, targetY - winPx); c.lineTo(W, targetY - winPx);
  c.moveTo(0, targetY + winPx); c.lineTo(W, targetY + winPx); c.stroke();
  c.setLineDash([]);

  // Your trace. In BALANCE there are two, and they must overlap.
  const drawTrace = (offset, colour, width) => {
    c.strokeStyle = colour; c.lineWidth = width;
    c.beginPath();
    for (let x = 0; x <= W; x += 3) {
      const wobble = Math.sin((x / W) * Math.PI * 6 + g.t * 2.3) * (H * 0.03) * (1 - g.settle);
      const y = midY + (g.value + offset) * H * 0.34 + wobble;
      x === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
    }
    c.stroke();
  };
  if (phase === 'BALANCE') {
    drawTrace(-g.split, 'rgba(224,182,79,0.85)', 1.6);
    drawTrace(g.split, 'rgba(95,208,224,0.85)', 1.6);
  } else {
    drawTrace(0, g.inBand ? '#5fd0e0' : '#e0644f', 2);
  }

  // The running quality bar down the left edge.
  const q = clampNum(g.quality, 0, 1);
  c.fillStyle = 'rgba(255,255,255,0.06)'; c.fillRect(6, 10, 5, H - 20);
  c.fillStyle = q > 0.66 ? '#5fd0e0' : q > 0.33 ? '#e0b64f' : '#e0644f';
  c.fillRect(6, 10 + (H - 20) * (1 - q), 5, (H - 20) * q);
}

function step(now) {
  if (!g || g.done) return;
  const dt = Math.min(0.05, (now - g.last) / 1000);
  g.last = now; g.t += dt;
  g.elapsed += dt * 1000;

  const phase = PHASES[g.phase];

  // The machine drifts on its own. That is the thing you are correcting.
  if (phase === 'SETTLE') {
    // Convergence. It comes right BY ITSELF if you leave it alone — and every
    // input you make here shoves it back out. A phase that rewards doing nothing
    // is the one that makes the other two read as work.
    g.settle = Math.min(1, g.settle + dt * 0.5);
    g.value += (g.target - g.value) * dt * 1.6 * g.settle;
  } else {
    g.drift += (Math.random() - 0.5) * dt * 2.2;
    g.drift = clampNum(g.drift, -1, 1);
    g.value += g.drift * g.tune.drift * dt;
    g.value = clampNum(g.value, -1.4, 1.4);
    if (phase === 'BALANCE') {
      g.split += (Math.random() - 0.5) * dt * 0.5;
      g.split = clampNum(g.split - Math.sign(g.split) * g.correcting * dt * 0.9, -0.6, 0.6);
    }
  }

  // Scoring: how much of the run you spent inside tolerance. In BALANCE the
  // traces must also be together, which is a second thing to hold at once.
  const off = Math.abs(g.value - g.target);
  const together = phase !== 'BALANCE' || Math.abs(g.split) < 0.09;
  g.inBand = off < g.tune.window && together;
  g.frames++;
  if (g.inBand) g.hits++;
  g.quality = g.hits / Math.max(1, g.frames);

  if (g.elapsed >= DUR) {
    g.scores.push(g.quality);
    g.phase++;
    if (g.phase >= PHASES.length) return finish();
    // Reset for the next hand.
    g.elapsed = 0; g.hits = 0; g.frames = 0; g.quality = 0;
    g.target = (Math.random() - 0.5) * 0.9;
    g.value = 0; g.drift = 0; g.split = 0.35; g.settle = 0;
    sfx('ui_click');
    paintHud();
  }

  draw();
  paintHud();
  g.raf = requestAnimationFrame(step);
}

const HINTS = {
  PHASE:   'Hold the trace inside the window. &#8593;/&#8595; or W/S.',
  BALANCE: 'Two servos, out of step. SPACE pulls them together while you hold it.',
  SETTLE:  'Let it converge. Touching anything now costs you.',
};

function paintHud() {
  if (!g || !g.overlay) return;
  const phase = PHASES[g.phase] || 'DONE';
  const left = Math.max(0, DUR - g.elapsed) / 1000;
  const el = g.overlay.querySelector('.cal-stats');
  if (el) {
    el.innerHTML =
      `<span>STAGE <b class="cal-phase">${phase}</b> ${g.phase + 1}/${PHASES.length}</span>` +
      `<span>TOLERANCE <b>${g.inBand ? 'IN' : 'OUT'}</b></span>` +
      `<span>${left.toFixed(1)}s</span>`;
  }
  const hint = g.overlay.querySelector('.cal-hint');
  if (hint) hint.innerHTML = HINTS[phase] || '';
  setDeckLevel(g.overlay, 1 - g.quality);
}

function finish() {
  if (!g || g.done) return;
  g.done = true;
  cancelAnimationFrame(g.raf);
  const mean = g.scores.reduce((a, b) => a + b, 0) / Math.max(1, g.scores.length);
  const score = Math.round(clampNum(mean, 0, 1) * 100);
  const verdict = score >= 90 ? 'DEAD ON'
    : score >= 70 ? 'WELL INSIDE'
    : score >= 45 ? 'ACCEPTABLE'
    : score >= 20 ? 'LOOSE'
    : 'ALL OVER THE PLACE';
  sfx(score >= 60 ? 'ui_confirm' : 'ui_error');

  const done = document.createElement('div');
  done.className = 'cal-done';
  done.innerHTML =
    `<div class="cal-score">${score}</div>` +
    `<div class="cal-verdict">${verdict}</div>` +
    `<button type="button">CLOSE</button>`;
  const screen = g.overlay.querySelector('.cal-screen');
  if (screen) screen.appendChild(done);
  const cb = g.opts.onResult;
  const closeAndReport = () => { const c = g.close; g.reported = true; c(); if (cb) cb({ score }); };
  done.querySelector('button').onclick = closeAndReport;
  g.autoReport = closeAndReport;
}

/**
 * Open the board. `onResult({score})` fires exactly once, with a 0-100 number.
 * Closing early still reports — an abandoned tune is a bad tune, not a free
 * retry, and the server has already spent the calibration rig either way.
 */
export function openCalibration(opts = {}) {
  ensureChassisStyles();
  ensureStyles();
  closeCalibration();

  const tune = tuning(opts.skill, opts.difficulty);
  const html =
    `<div class="cal-body mg-chassis">` +
      deviceHeader('&#9678;', 'CALIBRATION RIG', esc(String(opts.deviceName || 'IMPLANT')).toUpperCase()) +
      `<div class="mg-bezel">` + bezelScrews() +
        `<div class="mg-screen cal-screen"><canvas></canvas>` + crtOverlays() + `</div>` +
      `</div>` +
      `<div class="cal-stats"></div>` +
      `<div class="cal-hint"></div>` +
      deckStrip('BENCH', 'DEVIATION') +
    `</div>`;

  const { overlay, close } = mountOverlay({
    id: 'calibration-overlay',
    html,
    closeOnBackdrop: false,      // a stray click must not throw away a run
    onKey: (e) => {
      if (!g || g.done) return;
      const phase = PHASES[g.phase];
      if (e.key === ' ') {
        e.preventDefault();
        g.correcting = 1;
        if (phase === 'SETTLE') g.settle = Math.max(0, g.settle - 0.35);
        return;
      }
      const up = e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W';
      const down = e.key === 'ArrowDown' || e.key === 's' || e.key === 'S';
      if (!up && !down) return;
      e.preventDefault();
      g.value += (up ? -1 : 1) * 0.055;
      g.drift *= 0.55;                                   // a correction damps the drift
      if (phase === 'SETTLE') g.settle = Math.max(0, g.settle - 0.35);
    },
    onClose: () => {
      if (!g) return;
      cancelAnimationFrame(g.raf);
      window.removeEventListener('keyup', g.keyUp);
      // Report whatever was achieved. Abandoning is an outcome, not an escape.
      if (!g.reported && g.opts.onResult) {
        g.reported = true;
        const runs = g.scores.concat(g.done ? [] : [g.quality]);
        const mean = runs.reduce((a, b) => a + b, 0) / Math.max(1, PHASES.length);
        g.opts.onResult({ score: Math.round(clampNum(mean, 0, 1) * 100) });
      }
      g = null;
    },
  });

  const canvas = overlay.querySelector('canvas');
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(320, Math.round(rect.width * dpr));
  canvas.height = Math.round(230 * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  g = {
    overlay, close, opts, ctx, tune,
    w: canvas.width / dpr, h: 230,
    phase: 0, elapsed: 0, t: 0, last: performance.now(),
    value: 0, target: (Math.random() - 0.5) * 0.9, drift: 0,
    split: 0.35, settle: 0, correcting: 0,
    hits: 0, frames: 0, quality: 0, inBand: false,
    scores: [], done: false, reported: false, raf: 0,
  };
  g.keyUp = (e) => { if (e.key === ' ' && g) g.correcting = 0; };
  window.addEventListener('keyup', g.keyUp);

  overlay.querySelector('.mg-close').onclick = () => close();
  paintHud();
  g.raf = requestAnimationFrame(step);
  return { close };
}

export function closeCalibration() {
  const old = document.getElementById('calibration-overlay');
  if (old) old.remove();
  if (g) { cancelAnimationFrame(g.raf); window.removeEventListener('keyup', g.keyUp); g = null; }
}
