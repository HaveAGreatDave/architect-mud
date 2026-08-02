// HOLOLOCK BYPASS, drawn in characters — and the proof that the middle Display
// Mode rung keeps its promise.
//
// This is a TIMING game. A scanner sweeps left↔right across a hidden sweet zone
// and you have to hit it. The text version does not turn that into a dice roll:
// it runs on the same requestAnimationFrame loop, at the same sweep speed, with
// the same sweet-zone width, the same miss penalty and the same ambient feedback
// trickle — because it is literally the same loop, in hololock.js, with the
// drawing swapped (see the skin seam there).
//
// If you can play the glowing one you can play this one, and vice versa. A text
// mode that quietly made the lock easier would be a different game wearing the
// same name (docs/systems-display-mode.md).
//
// The track is 34 cells wide. A cell is ~3% of the sweep, which at the fastest
// difficulty is about 18ms of travel — fine-grained enough that hitting the zone
// is a real act of timing rather than a formality, and coarse enough to read.
import { setAreaPane } from '../render.js';
import { sendCmdSilent } from '../net.js';
import { esc, bar, paintRow, heading, ensureTextUiStyles } from './textui.js';
import {
  setHololockSkin, startHololockGame, stopHololockGame, hololockSet, hololockPos,
} from './hololock.js';

let _opts = null;
let _status = '';
let _open = false;
let _lastPaint = 0;

export function isTextHololockActive() { return _open; }

const TRACK = 34;

// One channel as a row of cells. The sweet zone is drawn ONLY on a pin that is
// already set — on the active pin it stays hidden, exactly as the graphical lock
// hides it until lit. Leaking it here would remove the entire game.
function channelRow(pin, i, active) {
  const cells = [];
  const scan = Math.round(hololockPos(pin) * (TRACK - 1));
  const lo = Math.round((pin.center - pin.width / 2) * (TRACK - 1));
  const hi = Math.round((pin.center + pin.width / 2) * (TRACK - 1));

  for (let c = 0; c < TRACK; c++) {
    const inZone = c >= lo && c <= hi;
    if (pin.set) { cells.push({ ch: inZone ? '█' : '─', cls: 'set' }); continue; }
    if (c === scan) { cells.push({ ch: '▓', cls: active ? 'scan' : 'idle' }); continue; }
    cells.push({ ch: '·', cls: active ? 'trk' : 'idle' });
  }

  const tag = pin.set ? '<span class="set">SET </span>'
    : active ? '<span class="scan">►   </span>'
      : '<span class="idle">    </span>';
  return `${tag}<span class="idle">[</span>${paintRow(cells)}<span class="idle">]</span>`;
}

const W = 44;

function paint(state) {
  if (!state) return;
  const set = state.pins.filter(p => p.set).length;
  const fb = state.feedback;
  const fbCls = fb > 0.75 ? 'bad' : fb > 0.45 ? 'warn' : 'ok';

  const lines = [
    `<div class="txui-hd"><span>HOLOLOCK BYPASS</span><span>${esc(String(_opts.deviceName || 'HOLOLOCK').toUpperCase())}</span></div>`,
    heading('CHANNELS', W),
    ...state.pins.map((p, i) => channelRow(p, i, i === state.active && !p.set)),
    heading('STATUS', W),
    `<span class="dim">PINS     </span><span class="ok">${set}</span><span class="dim">/${state.pins.length}</span>`,
    `<span class="dim">FEEDBACK </span>${bar(fb, 24, fbCls)}`,
    _status ? `\n${_status}` : '',
    heading('ACTIONS', W),
    `<span class="pick" data-hact="set">[ set ]</span>  <span class="pick" data-hact="abort">[ abort ]</span>`,
    `<span class="dim">SPACE or [set] when the scanner ▓ is over the sweet zone — which you cannot see until the pin drops.</span>`,
  ];
  setAreaPane(`<div class="txui txhl">${lines.filter(Boolean).join('\n')}</div>`);
  wire();
}

function wire() {
  const root = document.querySelector('.txhl');
  if (!root) return;
  root.querySelectorAll('[data-hact]').forEach(el => {
    el.addEventListener('click', () => command(el.getAttribute('data-hact')));
  });
}

// SPACE is the primary input on the graphical lock, so it is here too — a timing
// game played by clicking a link would be a worse game, and the keyboard is the
// point. Bound while the board is open and released on close.
function onKey(e) {
  if (!_open) return;
  if (e.code === 'Space' || e.key === ' ') {
    // Don't steal the spacebar from someone typing a command.
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
    e.preventDefault();
    hololockSet();
  }
}

export function command(word) {
  if (!_open) return false;
  const w = String(word || '').toLowerCase();
  if (w === 'set' || w === 'pick') { hololockSet(); return true; }
  if (w === 'abort') { close(); return true; }
  return false;
}

// ── Skin ─────────────────────────────────────────────────────────────────────
// `frame` fires every rAF. Repainting the whole board 60 times a second is what
// paintRow's run-length encoding buys — but there is no reason to redraw faster
// than a person can see, so it is throttled to ~30fps. The SWEEP still advances
// at full rate inside hololock.js; only the drawing is coarser, which is the one
// safe place to economise (the game must not slow down, only the picture).
const SKIN = {
  board: (s) => paint(s),
  hud: () => { /* board and HUD are one pass here */ },
  status: (html) => { _status = html; },
  frame: (s) => {
    const now = performance.now();
    if (now - _lastPaint < 33) return;
    _lastPaint = now;
    paint(s);
  },
  finish: (s, won) => {
    _status = won
      ? '<span class="ok">◇ LOCK DISENGAGED — access granted.</span>'
      : '<span class="bad">✕ SEQUENCE RESET — deck flagged.</span>';
    paint(s);
    setTimeout(() => close(), won ? 1200 : 2200);
  },
};

export function openTextHololock(opts = {}) {
  ensureTextUiStyles();
  ensureStyles();
  _opts = { skill: 4, difficulty: 5, deviceName: 'HOLOLOCK', onResult: null, ...opts };
  _status = '<span class="dim">Work the channels one at a time.</span>';
  setHololockSkin(SKIN);
  const state = startHololockGame(_opts);
  if (!state) { setHololockSkin(null); return false; }
  _open = true;
  window.addEventListener('keydown', onKey);
  paint(state);
  return true;
}

export function close() {
  if (!_open) return;
  _open = false;
  window.removeEventListener('keydown', onKey);
  stopHololockGame();
  setHololockSkin(null);
  sendCmdSilent('look');
}

function ensureStyles() {
  if (document.getElementById('texthololock-styles')) return;
  const st = document.createElement('style');
  st.id = 'texthololock-styles';
  st.textContent = `
    .txhl { line-height:1.4; }
    .txhl .trk  { color:#2f4a5c; }
    .txhl .idle { color:#24323c; }
    .txhl .scan { color:#7fe3ff; font-weight:700; text-shadow:0 0 8px rgba(127,227,255,.8); }
    .txhl .set  { color:#46e05a; }
  `;
  document.head.appendChild(st);
}
