// VAULT CRACK, drawn in characters.
//
// The safe is unchanged — same wheel count, same hidden contact points, same
// tolerance, same noisy contact gauge, same sharpen curve, same tamper trickle,
// because it is the same loop in vaultcrack.js with the drawing swapped.
//
// One thing genuinely changes, and it's an improvement rather than a compromise:
// the dial stops being something you DRAG with a pointer and becomes a number you
// STEP. `turn 5` / `turn -1` / `dial 47`, or the ◀ ▶ links. A real safecracker
// works in numbers off a stethoscope, so the character version arguably models
// the job better than the wheel does — and it means the game is playable without
// a pointing device at all, which the drag never was.
//
// The gauge is the whole skill: a contact mic whose amplitude swells as the dial
// nears the true contact point, buried in skill-scaled jitter. It gets the widest
// row on the panel, because reading it IS the game.
import { setAreaPane } from '../render.js';
import { sendCmdSilent } from '../net.js';
import { esc, bar, paintRow, heading, ensureTextUiStyles } from './textui.js';
import {
  setVaultSkin, startVaultGame, stopVaultGame, vaultTurn, vaultSet, vaultBand,
} from './vaultcrack.js';

let _opts = null;
let _status = '';
let _open = false;
let _lastPaint = 0;

export function isTextVaultActive() { return _open; }

const W = 46;
const RING = 50;   // dial cells — 100 units over 50 cells, so one cell is two units

// The dial as a ring of ticks with the pointer on it. Wheels already dropped are
// marked where they were set, which is the same information the graphical dial
// shows and is genuinely useful: a solved contact tells you where NOT to hunt.
function dialRow(st) {
  const cells = [];
  const at = Math.round((st.dial / 100) * RING) % RING;
  const setAt = st.wheels.filter(w => w.set && w.setAt != null)
    .map(w => Math.round((w.setAt / 100) * RING) % RING);
  for (let i = 0; i < RING; i++) {
    if (i === at) { cells.push({ ch: '▼', cls: 'ptr' }); continue; }
    if (setAt.includes(i)) { cells.push({ ch: '┃', cls: 'set' }); continue; }
    cells.push({ ch: i % 5 === 0 ? '│' : '·', cls: 'trk' });
  }
  return paintRow(cells);
}

function paint(st) {
  if (!st) return;
  const dropped = st.wheels.filter(w => w.set).length;
  const heatCls = st.heat > 0.75 ? 'bad' : st.heat > 0.45 ? 'warn' : 'ok';
  // The resonance band — the amplitude a SET would succeed at. Drawn as a marker
  // on the gauge so "in the band" is a thing you can SEE, exactly as the green
  // band does on the graphical gauge.
  const band = vaultBand(st);
  const g = Math.max(0, Math.min(1, st.gauge));
  const inBand = g >= band;

  const gaugeCells = [];
  const GW = 30;
  const gi = Math.round(g * (GW - 1));
  const bi = Math.round(band * (GW - 1));
  for (let i = 0; i < GW; i++) {
    if (i === bi) { gaugeCells.push({ ch: '┋', cls: 'band' }); continue; }
    gaugeCells.push({ ch: i <= gi ? '█' : '░', cls: i <= gi ? (inBand ? 'ok' : 'amp') : 'dim' });
  }

  const lines = [
    `<div class="txui-hd"><span>VAULT CRACK</span><span>${esc(String(_opts.deviceName || 'SAFE').toUpperCase())}</span></div>`,
    heading('DIAL', W),
    dialRow(st),
    `<span class="dim">READING </span><span class="ptr">${String(Math.round(st.dial)).padStart(2, '0')}</span>`
      + `   <span class="dim">WHEELS </span><span class="ok">${dropped}</span><span class="dim">/${st.wheels.length}</span>`,
    heading('CONTACT MIC', W),
    `${paintRow(gaugeCells)} ${inBand ? '<span class="ok">◀ RESONANCE</span>' : ''}`,
    `<span class="dim">TAMPER  </span>${bar(st.heat, 24, heatCls)}`,
    _status ? `\n${_status}` : '',
    heading('ACTIONS', W),
    `<span class="pick" data-vact="-5">[ ◀◀ ]</span> <span class="pick" data-vact="-1">[ ◀ ]</span>  `
      + `<span class="pick" data-vact="set">[ SET ]</span>  `
      + `<span class="pick" data-vact="1">[ ▶ ]</span> <span class="pick" data-vact="5">[ ▶▶ ]</span>  `
      + `<span class="pick" data-vact="abort">[ abort ]</span>`,
    `<span class="dim">← → to step the dial · turn &lt;n&gt; · dial &lt;0-99&gt; · set when the mic sits in the band ┋</span>`,
  ];
  setAreaPane(`<div class="txui txvc">${lines.filter(Boolean).join('\n')}</div>`);
  wire();
}

function wire() {
  const root = document.querySelector('.txvc');
  if (!root) return;
  root.querySelectorAll('[data-vact]').forEach(el => {
    el.addEventListener('click', () => command(el.getAttribute('data-vact')));
  });
}

function onKey(e) {
  if (!_open) return;
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); vaultTurn(-1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); vaultTurn(1); }
  else if (e.code === 'Space') { e.preventDefault(); vaultSet(); }
}

export function command(word) {
  if (!_open) return false;
  const w = String(word || '').trim().toLowerCase();
  if (w === 'abort') { close(); return true; }
  if (w === 'set') { vaultSet(); return true; }
  // `turn <n>` steps by n; `dial <n>` goes to an absolute reading. Both are the
  // same underlying `turn`, so the state machine has one entry point.
  let m = /^turn\s+(-?\d+)$/.exec(w);
  if (m) { vaultTurn(parseInt(m[1], 10)); return true; }
  m = /^dial\s+(\d{1,2})$/.exec(w);
  if (m) { vaultTurn(parseInt(m[1], 10) - _lastDial()); return true; }
  if (/^-?\d+$/.test(w) && w.length <= 3) { vaultTurn(parseInt(w, 10)); return true; }
  return false;
}

let _st = null;
const _lastDial = () => (_st ? _st.dial : 0);

const SKIN = {
  board: (s) => { _st = s; paint(s); },
  hud: (s) => { _st = s; },
  status: (html) => { _status = html; },
  frame: (s) => {
    _st = s;
    const now = performance.now();
    if (now - _lastPaint < 33) return;   // ~30fps is plenty for a gauge
    _lastPaint = now;
    paint(s);
  },
  finish: (s, won) => {
    _status = won
      ? '<span class="ok">◉ BOLT RETRACTED — safe open.</span>'
      : '<span class="bad">✗ LOCK RE-SEATED — rig flagged.</span>';
    paint(s);
    setTimeout(() => close(), won ? 1200 : 2200);
  },
};

export function openTextVault(opts = {}) {
  ensureTextUiStyles();
  ensureStyles();
  _opts = { skill: 4, difficulty: 5, deviceName: 'VENDOR SAFE', onResult: null, ...opts };
  _status = '<span class="dim">Hunt the contact point. The mic swells as you close on it.</span>';
  setVaultSkin(SKIN);
  const st = startVaultGame(_opts);
  if (!st) { setVaultSkin(null); return false; }
  _st = st; _open = true;
  window.addEventListener('keydown', onKey);
  paint(st);
  return true;
}

export function close() {
  if (!_open) return;
  _open = false; _st = null;
  window.removeEventListener('keydown', onKey);
  stopVaultGame();
  setVaultSkin(null);
  sendCmdSilent('look');
}

function ensureStyles() {
  if (document.getElementById('textvault-styles')) return;
  const st = document.createElement('style');
  st.id = 'textvault-styles';
  st.textContent = `
    .txvc { line-height:1.4; }
    .txvc .trk  { color:#2c3f4d; }
    .txvc .ptr  { color:#ffb63a; font-weight:700; text-shadow:0 0 7px rgba(255,150,40,.8); }
    .txvc .set  { color:#46e05a; }
    .txvc .amp  { color:#7fe3ff; }
    .txvc .band { color:#46e05a; font-weight:700; }
  `;
  document.head.appendChild(st);
}
