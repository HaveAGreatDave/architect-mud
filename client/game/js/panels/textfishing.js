// REEL, drawn in characters — the last of the reflex games to get a text board.
//
// Same water: the same sweeping aim, the same charging power, the same darting
// catch, the same gaff physics (LIFT/GRAVITY/DAMP), the same creel-versus-tension
// race, all scaled off skill-vs-difficulty — because it is the same loop in
// fishing.js with the drawing swapped.
//
// TWO STAGES, ONE INPUT. Press and release, exactly as the graphical board:
//   AIM      — a tick sweeps left↔right. Press to lock the lane.
//   CHARGE   — hold; the power meter ping-pongs shallow↔deep. Release to cast.
//   REEL     — hold to lift the gaff, let go and it sinks. Bracket the catch.
//
// The gaff is VERTICAL on the graphical board and vertical here too: a column,
// not a row. That is not decoration — depth is the axis the whole game is about
// (deep water hides the better catches), and rotating it to a horizontal bar to
// save lines would quietly throw that away.
import { setAreaPane } from '../render.js';
import { sendCmdSilent } from '../net.js';
import { esc, bar, paintRow, heading, ensureTextUiStyles } from './textui.js';
import {
  setFishingSkin, startFishingGame, stopFishingGame, fishingDown, fishingUp,
} from './fishing.js';

let _opts = null;
let _status = '';
let _open = false;
let _lastPaint = 0;
let _st = null;
let _held = false;

export function isTextFishingActive() { return _open; }

const W = 46;
const COL = 14;          // rows in the water column
const LANES = 30;        // cells across the aim sweep

// ── The cast ─────────────────────────────────────────────────────────────────
// A lane ruler with the sweeping tick, and a depth meter that only appears once
// you're charging — before that there is nothing to show and a dead meter would
// imply there is.
function castRows(s) {
  const tick = Math.round((s.phase === 'charging' ? s.angle : s.aim) * (LANES - 1));
  const lane = [];
  for (let i = 0; i < LANES; i++) {
    if (i === tick) lane.push({ ch: '▼', cls: s.phase === 'charging' ? 'lock' : 'aim' });
    else lane.push({ ch: i % 5 === 0 ? '┊' : '·', cls: 'trk' });
  }
  const out = [
    `<span class="dim">LANE   </span>${paintRow(lane)}`,
  ];
  if (s.phase === 'charging') {
    // Depth reads in feet, as the graphical board's scale does — "0.62" is a
    // number about the meter; "37 ft" is a number about the water.
    const ft = Math.round(s.power * 60);
    out.push(`<span class="dim">DEPTH  </span>${bar(s.power, 26, s.power > 0.66 ? 'bad' : s.power > 0.33 ? 'warn' : 'ok')} <b>${ft} ft</b>`);
    out.push(`<span class="dim">       shallow${' '.repeat(12)}deep</span>`);
  }
  return out;
}

// ── The fight ────────────────────────────────────────────────────────────────
// The water column, top (surface) to bottom (deep). The gaff is a band; the catch
// is a single mark. Bracketed = the catch sits inside the band.
function fightRows(s) {
  const rowOf = (v) => Math.max(0, Math.min(COL - 1, Math.round(v * (COL - 1))));
  const fishRow = rowOf(s.fish);
  const gaffLo = rowOf(s.gaff - s.gaffH / 2);
  const gaffHi = rowOf(s.gaff + s.gaffH / 2);
  const bracketed = Math.abs(s.fish - s.gaff) <= s.gaffH / 2;

  const rows = [];
  for (let r = 0; r < COL; r++) {
    const inGaff = r >= gaffLo && r <= gaffHi;
    const isFish = r === fishRow;
    let ch, cls;
    if (isFish && inGaff) { ch = '◆'; cls = 'hit'; }
    else if (isFish) { ch = '◆'; cls = 'fish'; }
    else if (inGaff) { ch = '│'; cls = bracketed ? 'hit' : 'gaff'; }
    else { ch = '·', cls = 'water'; }
    // A depth label every few rows, so the column is a place and not a bar.
    const label = r === 0 ? ' surface' : r === COL - 1 ? ' deep' : '';
    rows.push(`       <span class="${cls}">${ch}</span><span class="dim">${label}</span>`);
  }
  return rows;
}

function paint(s) {
  if (!s) return;
  _st = s;
  const fighting = s.phase === 'fight';
  const stage = fighting ? 'REEL' : s.phase === 'charging' ? 'CHARGE' : 'AIM';

  const lines = [
    `<div class="txui-hd"><span>REEL — ${esc(stage)}</span><span>${esc(String(_opts.deviceName || 'THE LINE').toUpperCase())}</span></div>`,
    heading(fighting ? 'THE WATER' : 'THE CAST', W),
    ...(fighting ? fightRows(s) : castRows(s)),
    heading('LINE', W),
  ];

  if (fighting) {
    const cCls = s.creel > 0.66 ? 'ok' : s.creel > 0.33 ? 'warn' : 'bad';
    const tCls = s.tension > 0.75 ? 'bad' : s.tension > 0.45 ? 'warn' : 'ok';
    lines.push(`<span class="dim">CREEL  </span>${bar(s.creel, 26, cCls)}`);
    lines.push(`<span class="dim">TENSION</span>${bar(s.tension, 26, tCls)}`);
  } else {
    lines.push('<span class="dim">Press to lock the lane, hold to charge the depth, let go to cast.</span>');
  }

  if (_status) lines.push(`\n${_status}`);
  lines.push(heading('ACTIONS', W));
  lines.push(`<span class="pick" data-fact="${_held ? 'up' : 'down'}">[ ${_held ? 'RELEASE' : 'PRESS'} ]</span>  `
    + `<span class="pick" data-fact="abort">[ cut line ]</span>`);
  lines.push('<span class="dim">SPACE — hold and release. ◆ the catch · │ the gaff</span>');

  setAreaPane(`<div class="txui txfs">${lines.filter(Boolean).join('\n')}</div>`);
  wire();
}

function wire() {
  const root = document.querySelector('.txfs');
  if (!root) return;
  root.querySelectorAll('[data-fact]').forEach(el => {
    el.addEventListener('click', () => command(el.getAttribute('data-fact')));
  });
}

// SPACE is press-AND-release on the graphical board, and a hold is the whole
// mechanic at both stages — so it is a real keydown/keyup here, not a toggle.
// `e.repeat` is filtered or a held key would re-fire press forever.
function onKeyDown(e) {
  if (!_open || (e.key !== ' ' && e.code !== 'Space')) return;
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
  e.preventDefault();
  if (e.repeat) return;
  _held = true; fishingDown();
}
function onKeyUp(e) {
  if (!_open || (e.key !== ' ' && e.code !== 'Space')) return;
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
  e.preventDefault();
  _held = false; fishingUp();
}

export function command(word) {
  if (!_open) return false;
  const w = String(word || '').trim().toLowerCase();
  if (w === 'abort' || w === 'cut') { close(); return true; }
  // Clicking is a press and a release, since a mouse cannot express a hold here
  // without dragging. `down`/`up` are exposed separately so the button can show
  // which half it is offering.
  if (w === 'down' || w === 'press') { _held = true; fishingDown(); paint(_st); return true; }
  if (w === 'up' || w === 'release') { _held = false; fishingUp(); paint(_st); return true; }
  return false;
}

const SKIN = {
  status: (html) => { _status = String(html || '').replace(/<[^>]*>/g, ''); },
  frame: (s) => {
    const now = performance.now();
    if (now - _lastPaint < 33) { _st = s; return; }
    _lastPaint = now;
    paint(s);
  },
  finish: (s, won) => {
    _status = won
      ? '<span class="ok">◇ LANDED — it\'s yours.</span>'
      : '<span class="bad">✕ LINE SNAPPED — it threw the hook.</span>';
    paint(s);
    setTimeout(() => close(), won ? 1200 : 2000);
  },
};

export function openTextFishing(opts = {}) {
  ensureTextUiStyles();
  ensureStyles();
  _opts = { skill: 4, difficulty: 5, deviceName: 'THE LINE', onResult: null, onCast: null, ...opts };
  _status = '';
  _held = false;
  setFishingSkin(SKIN);
  const s = startFishingGame(_opts);
  if (!s) { setFishingSkin(null); return false; }
  _st = s; _open = true;
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  paint(s);
  return true;
}

export function close() {
  if (!_open) return;
  _open = false; _st = null; _held = false;
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  stopFishingGame();
  setFishingSkin(null);
  sendCmdSilent('look');
}

function ensureStyles() {
  if (document.getElementById('textfishing-styles')) return;
  const st = document.createElement('style');
  st.id = 'textfishing-styles';
  st.textContent = `
    .txfs { line-height:1.35; }
    .txfs .trk   { color:#24403a; }
    .txfs .water { color:#153029; }
    .txfs .aim   { color:#7fe3ff; font-weight:700; text-shadow:0 0 8px rgba(127,227,255,.8); }
    .txfs .lock  { color:#ffb63a; font-weight:700; }
    .txfs .gaff  { color:#4fe0a0; }
    .txfs .fish  { color:#cfe9d8; font-weight:700; }
    .txfs .hit   { color:#46e05a; font-weight:700; text-shadow:0 0 8px rgba(70,224,90,.8); }
  `;
  document.head.appendChild(st);
}
