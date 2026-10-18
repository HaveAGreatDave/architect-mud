// CHIMERA-9 COOK, drawn in characters: the drug-cook board for the textgames rung.
//
// Same batch: the same family init numbers, the same update functions, the same
// quench ring and the same 0–100 score, on the same requestAnimationFrame clock,
// because it is the loop in synthlab.js with the canvas swapped out (see the skin
// seam there). Five shapes of work, picked from the game object's own state:
//   BAND   (liquid, gel, paste)  — hold to heat, keep the level in the drifting band
//   PRESS  (powder, crystal)     — hold to build force, release in the green, ×3
//   GAS    (gas)                 — tap to vent, keep the needle in the green
//   GRIND  (leaf, pill)          — crack the nugget, hold the pestle on each piece
//   BLOT   (blotter)             — hold the dropper on each tab, move on near full
// then the QUENCH: strike as the ring meets the mark.
//
// Where the interface has to differ it differs in ergonomics, never in numbers:
//   - The pestle and the dropper go where you point them by NUMBER or arrow key
//     rather than by dragging. The pestle moves to the next whole piece when the
//     one under it is powder; grinding scores 1 whatever you do, so that is only
//     the drag you no longer have to make. The dropper does NOT move on by itself:
//     when to lift it off a tab is the whole skill of the blotter.
//   - A tab's soak is drawn with the canvas's own cues and no more: under-dosed
//     until the dosed pip (0.82), darkening past 1, red past 1.25. There is no
//     tick at 1.0, because the canvas doesn't have one.
//   - A hold is SPACE held down. A tap or a click can't hold, so the chip toggles
//     between HOLD and RELEASE, as the fishing and hijack boards do.
import { setAreaPane } from '../render.js';
import { sendCmdSilent } from '../net.js';
import { esc, clamp, paintRow, heading, tap, deck, ensureTextUiStyles, attachBoard, detachBoard } from './textui.js';
import {
  setSynthSkin, startSynthGame, stopSynthGame, synthDown, synthUp, synthAim, synthBandCenter, synthRing,
} from './synthlab.js';

let _opts = null;
let _status = '';
let _open = false;
let _lastPaint = 0;
let _g = null;
let _held = false;
let _piece = 0;          // the piece the pestle is on (grind)
let _tab = 0;            // the tab the dropper is on (blot)

export function isTextSynthActive() { return _open; }

const W = 46;
const N = 40;            // cells across a gauge

// Which shape of work this batch is, read off the state the family init built,
// so this file never repeats synthlab's form → family table.
function shapeOf(g) {
  if (g.tabs) return 'blot';
  if (g.mortar) return 'grind';
  if (g.pressure !== undefined) return 'gas';
  if (g.presses) return 'press';
  return 'band';
}

// ── Gauges ───────────────────────────────────────────────────────────────────
// Two rows: the fill, then a track marking the green band (and the red end, if
// the canvas has one). Horizontal for resolution: 40 cells is 0.025 of the range,
// finer than the narrowest band any difficulty draws.
function gauge(v, max, lo, hi, fillCls, redFrom = null) {
  const filled = Math.round(clamp(v / max, 0, 1) * N);
  const fill = [], track = [];
  for (let i = 0; i < N; i++) {
    const mid = (i + 0.5) / N * max;
    const inb = mid >= lo && mid <= hi;
    const red = redFrom != null && mid >= redFrom;
    fill.push({ ch: i < filled ? '█' : '░', cls: i < filled ? fillCls : 'dim' });
    track.push({ ch: inb ? '━' : red ? '╍' : '·', cls: inb ? 'band' : red ? 'bad' : 'trk' });
  }
  return [paintRow(fill), paintRow(track)];
}
const row = (label, html) => `<span class="dim">${label.padEnd(8)}</span>${html}`;

// ── The five shapes ──────────────────────────────────────────────────────────
function bandRows(g) {
  const c = synthBandCenter(g), inb = Math.abs(g.level - c) <= g.bandHalf;
  const cls = inb ? 'ok' : g.level > c ? 'warn' : 'bad';
  const [fill, track] = gauge(g.level, 1, c - g.bandHalf, c + g.bandHalf, cls);
  const pct = Math.round(g.inBand / Math.max(0.001, g.t) * 100);
  const word = g.family === 'botanical' ? 'CURED' : 'STABLE';
  const form = g.opts.form;
  const tag = form === 'paste' ? 'THICK PASTE: heats slow, holds steady'
    : form === 'gel' ? 'VISCOUS GEL: sluggish, clings'
    : form === 'liquid' ? 'THIN LIQUID: runny, quick to swing' : '';
  return [
    row('LEVEL', fill),
    row('', track),
    `<span class="dim">${' '.repeat(8)}cool${' '.repeat(N - 7)}hot</span>`,
    row('HEAT', paintRow(Array.from({ length: 12 }, (_, i) => ({ ch: i < Math.round(g.heatS * 12) ? '▮' : '▯', cls: i < Math.round(g.heatS * 12) ? 'warn' : 'dim' })))),
    `<b>${word} ${pct}%</b> <span class="dim">·</span> ${Math.max(0, g.dur - g.t).toFixed(1)}s`
      + (inb ? '  <span class="ok">in the band</span>' : g.level > c ? '  <span class="warn">too hot</span>' : '  <span class="bad">too cool</span>'),
    tag ? `<span class="dim">${esc(tag)}</span>` : '',
  ];
}

function pressRows(g) {
  const inB = Math.abs(g.force - g.target) < g.band;
  const cls = inB ? 'ok' : g.force > g.target + g.band ? 'bad' : 'hi';
  const [fill, track] = gauge(clamp(g.force, 0, 1.08), 1.08, g.target - g.band, g.target + g.band, cls, 1);
  // One word per finished press, at the thresholds the canvas plays its sounds at.
  const pucks = g.scores.map(a => a > 0.85 ? '<span class="ok">clean</span>' : a > 0.5 ? '<span class="hi">good</span>' : a > 0 ? '<span class="warn">rough</span>' : '<span class="bad">over</span>');
  while (pucks.length < g.presses) pucks.push('<span class="dim">·</span>');
  return [
    row('FORCE', fill),
    row('', track),
    `<b>PRESS ${Math.min(g.pressIdx + 1, g.presses)} / ${g.presses}</b>  <span class="dim">force</span> ${Math.round(clamp(g.force, 0, 1.08) * 100)}`,
    row('TRAY', pucks.join('  ')),
    `<span class="hi">${g.rising ? 'RELEASE IN THE GREEN' : 'HOLD TO BUILD FORCE'}</span>`,
  ];
}

function gasRows(g) {
  const inB = Math.abs(g.pressure - g.target) <= g.band;
  const cls = inB ? 'ok' : g.pressure > 0.9 ? 'bad' : 'hi';
  const [fill, track] = gauge(clamp(g.pressure, 0, 1.15), 1.15, g.target - g.band, g.target + g.band, cls, 0.9);
  return [
    row('PRESSURE', fill),
    row('', track),
    `<b>PRESSURE ${Math.round(g.pressure * 100)}</b> <span class="dim">·</span> TAP TO VENT <span class="dim">·</span> ${Math.max(0, g.dur - g.t).toFixed(1)}s`,
    g.pressure > 0.92 ? '<span class="bad">⚠ OVERPRESSURE</span>' : '',
  ];
}

// A piece's size as a four-cell bar; 20 is about the largest a piece spawns at.
const SIZE_MAX = 20;
function grindRows(g) {
  if (!g.nuggetBroken) {
    return [
      '<span class="hi">A whole nugget sits in the mortar.</span>',
      `<span class="dim">Crack it first, then work the pieces down with the pestle.</span>`,
    ];
  }
  const cells = g.pieces.map((pc, i) => {
    const on = i === _piece;
    const label = `${i + 1}`;
    let body;
    if (pc.ground) body = '<span class="ok">dust</span>';
    else if (pc.fall < 0) body = '<span class="dim">····</span>';
    else {
      const n = Math.max(1, Math.round(clamp((pc.r - 3) / (SIZE_MAX - 3), 0, 1) * 4));
      body = `<span class="${on && g.pestle.active ? 'warn' : 'hi'}">${'■'.repeat(n)}</span><span class="dim">${'·'.repeat(4 - n)}</span>`;
    }
    const mark = on ? '<span class="hi">▸</span>' : ' ';
    return `${mark}<span class="pick" data-txcmd="piece ${label}">${label}</span> ${body}`;
  });
  const lines = [];
  for (let i = 0; i < cells.length; i += 3) lines.push(cells.slice(i, i + 3).join('   '));
  lines.push(`<b>${g.groundCount}/${g.pieces.length} GROUND</b>  <span class="dim">pestle</span> ${g.pestle.active ? '<span class="warn">working</span>' : '<span class="dim">resting</span>'}`);
  return lines;
}

// Soak, by the canvas's own cues only: under until the dosed pip, darkening past 1,
// red past 1.25 (where the canvas's pip turns red). No mark at 1.0.
function soakCls(s) { return s < 0.01 ? 'trk' : s < 0.82 ? 'warn' : s <= 1 ? 'ok' : s <= 1.25 ? 'deep' : 'bad'; }
function soakGlyph(s) { return s < 0.01 ? '····' : s < 0.82 ? '▒'.repeat(Math.max(1, Math.round(s / 0.82 * 3))).padEnd(4, '░') : '████'; }
function blotRows(g) {
  const s = g.sheet, lines = [];
  for (let cy = 0; cy < s.rows; cy++) {
    let out = '';
    for (let cx = 0; cx < s.cols; cx++) {
      const i = cy * s.cols + cx, tb = g.tabs[i], on = i === _tab;
      out += `<span class="${on ? 'hi' : 'rule'}">${on ? '[' : ' '}</span>`
        + `<span class="pick ${soakCls(tb.soak)}" data-txcmd="tab ${i + 1}">${soakGlyph(tb.soak)}</span>`
        + `<span class="${on ? 'hi' : 'rule'}">${on ? ']' : ' '}</span>`;
    }
    lines.push('  ' + out);
  }
  const tb = g.tabs[_tab], dosed = g.tabs.filter(t => t.done).length;
  // The tab under the dropper as a wider bar over the whole soak range, so a
  // darkening tab is visibly still filling. Coloured as the grid is.
  const n = Math.round(clamp(tb.soak / 1.7, 0, 1) * 24);
  lines.push(row(`TAB ${_tab + 1}`, `<span class="${soakCls(tb.soak)}">${'█'.repeat(n)}</span><span class="dim">${'░'.repeat(24 - n)}</span> ${tb.done ? (tb.soak > 1.25 ? '<span class="bad">over</span>' : '<span class="ok">dosed</span>') : '<span class="dim">dry</span>'}`));
  lines.push(`<b>DOSED ${dosed}/${g.tabs.length}</b>  <span class="dim">dropper</span> ${g.dropper.active ? '<span class="warn">dripping</span>' : '<span class="dim">lifted</span>'}`);
  return lines;
}

function quenchRows(g) {
  const { r, target, max } = synthRing(g);
  const ringAt = Math.round(clamp(r / max, 0, 1) * (N - 1)), markAt = Math.round(target / max * (N - 1));
  const cells = [];
  for (let i = 0; i < N; i++) {
    if (i === ringAt && !g.quenchTapped && r > 2) cells.push({ ch: '◆', cls: 'ring' });
    else if (i === markAt) cells.push({ ch: '┃', cls: 'ok' });
    else cells.push({ ch: '·', cls: 'trk' });
  }
  return [
    row('RING', paintRow(cells)),
    `<span class="hi">◄ SET ON THE MARK ►</span>  <span class="dim">strike as ◆ meets ┃</span>`,
  ];
}

function doneRows(g) {
  const sc = g.result.score, win = sc >= 60;
  return [
    `<span class="${win ? 'ok' : 'warn'}"><b>${esc(g.result.grade)}: ${sc}%</b></span>`,
    `<span class="dim">${sc >= 75 ? 'CLEAN BATCH' : sc >= 45 ? 'PASSABLE' : 'MESSY'}</span>`,
  ];
}

// ── Painting ─────────────────────────────────────────────────────────────────
const holdChip = () => tap(_held ? 'release' : 'hold', _held ? 'RELEASE' : 'HOLD', { press: true, cls: 'big' });

function actions(g, shape) {
  if (g.phase === 'quench') return [tap('strike', 'STRIKE', { press: true, cls: 'big' })];
  if (g.phase !== 'work') return [];
  if (shape === 'gas') return [tap('vent', 'VENT', { press: true, cls: 'big' })];
  if (shape === 'grind' && !g.nuggetBroken) return [tap('crack', 'CRACK IT', { cls: 'big' })];
  if (shape === 'blot') return [holdChip(), tap('prev', '◄'), tap('next', '►')];
  return [holdChip()];
}

function keysLine(shape) {
  if (shape === 'gas') return 'SPACE: vent.';
  if (shape === 'grind') return 'C: crack · 1–9: pick a piece · SPACE: hold the pestle on it.';
  if (shape === 'blot') return 'arrows: move the dropper · SPACE: hold it on the tab.';
  return 'SPACE: hold and release.';
}

function paint(g) {
  if (!g || !_open) return;
  const shape = shapeOf(g);
  if (g.phase !== 'work') _held = false;
  const stage = g.phase === 'quench' ? 'QUENCH' : g.phase === 'liquid' ? 'BINDING' : g.phase === 'done' ? 'DONE' : shape.toUpperCase();
  const body = g.phase === 'done' ? doneRows(g)
    : g.phase === 'quench' ? quenchRows(g)
    : g.phase === 'liquid' ? ['<span class="hi">ADDING BINDING LIQUID…</span>']
    : shape === 'band' ? bandRows(g) : shape === 'press' ? pressRows(g) : shape === 'gas' ? gasRows(g)
    : shape === 'grind' ? grindRows(g) : blotRows(g);

  const lines = [
    `<div class="txui-hd"><span>COOK: ${esc(stage)}</span><span>${esc(String(_opts.recipeName || 'BATCH').toUpperCase())}</span></div>`,
    heading(String(g._label || 'CHIMERA-9').split(':')[0], W),
    ...body,
  ];
  if (_status) lines.push(`\n<span class="dim">&gt;</span> ${esc(_status)}`);
  lines.push(heading('ACTIONS', W));
  lines.push(deck([...actions(g, shape), tap('abort', 'abort', { cls: 'hot' })]));
  if (g.phase === 'work' || g.phase === 'quench') lines.push(`<span class="dim">${esc(g.phase === 'quench' ? 'SPACE: strike.' : keysLine(shape))}</span>`);

  setAreaPane(`<div class="txui txsy">${lines.filter(Boolean).join('\n')}</div>`);
}

// Point the tool at whatever the player has picked. Runs every frame, unthrottled,
// because pieces drift in the mortar and the pestle has to stay on its piece.
function aim(g) {
  if (g.phase !== 'work') return;
  if (g.mortar && g.nuggetBroken && g.pieces.length) {
    const cur = g.pieces[_piece];
    if (!cur || cur.ground) {
      const next = g.pieces.findIndex(pc => !pc.ground);
      if (next >= 0) _piece = next;
    }
    const pc = g.pieces[_piece];
    if (pc) synthAim({ x: pc.x, y: pc.y + Math.min(0, pc.fall) });
  } else if (g.tabs) {
    const s = g.sheet;
    synthAim({ x: s.x + ((_tab % s.cols) + 0.5) * s.cw, y: s.y + (Math.floor(_tab / s.cols) + 0.5) * s.ch });
  }
}

// ── Input ────────────────────────────────────────────────────────────────────
function press() {
  const g = _g; if (!g) return;
  if (g.phase === 'work' && shapeOf(g) !== 'gas') _held = true;
  synthDown();
}
function release() { _held = false; synthUp(); }
function crack() {
  const g = _g;
  if (g && g.phase === 'work' && g.mortar && !g.nuggetBroken) synthDown({ x: g.nugget.x, y: g.nugget.y });
}
function moveTab(d) {
  const g = _g; if (!g || !g.tabs) return;
  const s = g.sheet, n = g.tabs.length;
  if (d === 'left') _tab = (_tab + n - 1) % n;
  else if (d === 'right') _tab = (_tab + 1) % n;
  else if (d === 'up') _tab = (_tab - s.cols + n) % n;
  else if (d === 'down') _tab = (_tab + s.cols) % n;
  aim(g);
}

const isTyping = () => { const el = document.activeElement; return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'); };
const ARROWS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

// SPACE is a real hold on the canvas bench, so it is a real keydown/keyup here.
// `e.repeat` is filtered or a held key would re-press every few milliseconds,
// which on the gas board would vent the cylinder flat.
function onKeyDown(e) {
  if (!_open || isTyping()) return;
  const g = _g; if (!g) return;
  if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); if (!e.repeat) press(); return; }
  if (e.key === 'Escape') { close(); return; }
  if (ARROWS[e.key] && g.tabs) { e.preventDefault(); moveTab(ARROWS[e.key]); paint(g); return; }
  if ((e.key === 'c' || e.key === 'C') && !e.repeat) { crack(); return; }
  if (/^[1-9]$/.test(e.key) && g.pieces?.length) { _piece = clamp(+e.key - 1, 0, g.pieces.length - 1); aim(g); paint(g); }
}
function onKeyUp(e) {
  if (!_open || isTyping()) return;
  if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); release(); }
}

export function command(word) {
  if (!_open) return false;
  const g = _g;
  const w = String(word || '').trim().toLowerCase();
  const [verb, arg] = w.split(/\s+/);
  if (verb === 'abort' || verb === 'quit') { close(); return true; }
  if (!g) return false;
  if (verb === 'hold' || verb === 'press') { press(); paint(g); return true; }
  if (verb === 'release' || verb === 'let') { release(); paint(g); return true; }
  if (verb === 'vent' || verb === 'strike' || verb === 'set' || verb === 'quench') { synthDown(); paint(g); return true; }
  if (verb === 'crack') { crack(); paint(g); return true; }
  if (verb === 'piece' && g.pieces?.length && +arg >= 1) { _piece = clamp(+arg - 1, 0, g.pieces.length - 1); aim(g); paint(g); return true; }
  if (verb === 'tab' && g.tabs && +arg >= 1) { _tab = clamp(+arg - 1, 0, g.tabs.length - 1); aim(g); paint(g); return true; }
  if ((verb === 'next' || verb === 'prev') && g.tabs) { moveTab(verb === 'next' ? 'right' : 'left'); paint(g); return true; }
  return false;
}

const SKIN = {
  status: (text) => { _status = String(text || '').replace(/<[^>]*>/g, ''); },
  frame: (g) => {
    _g = g;
    aim(g);
    const now = performance.now();
    if (now - _lastPaint < 33) return;
    _lastPaint = now;
    paint(g);
  },
  // The score has already gone to onResult; leave the verdict up briefly, as the
  // canvas does, then hand the pane back.
  // The guard keeps a late timer from closing a cook started inside that window.
  finish: (g) => { paint(g); setTimeout(() => { if (_g === g) close(); }, 900); },
};

export function openTextSynth(opts = {}) {
  ensureTextUiStyles();
  ensureStyles();
  _opts = { difficulty: 5, recipeName: 'COMPOUND', onResult: null, ...opts };
  _status = ''; _held = false; _piece = 0; _tab = 0;
  setSynthSkin(SKIN);
  const g = startSynthGame(_opts);
  if (!g) { setSynthSkin(null); return false; }
  _g = g; _open = true;
  attachBoard(command);   // claim #area-pane: a phone keeps it shut until an app says it owns it
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  paint(g);
  return true;
}

export function close() {
  if (!_open) return;
  _open = false; _held = false;
  detachBoard(command);   // hand the pane back to the phone layout
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  stopSynthGame();
  setSynthSkin(null);
  _g = null;
  sendCmdSilent('look');
}

function ensureStyles() {
  if (document.getElementById('textsynth-styles')) return;
  const st = document.createElement('style');
  st.id = 'textsynth-styles';
  st.textContent = `
    .txsy { line-height:1.35; }
    .txsy .trk  { color:#24403a; }
    .txsy .band { color:#4fe08a; }
    .txsy .deep { color:#2f9a5e; font-weight:700; }
    .txsy .ring { color:#5fd0e0; font-weight:700; text-shadow:0 0 8px rgba(95,208,224,.8); }
  `;
  document.head.appendChild(st);
}
