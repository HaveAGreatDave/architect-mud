// NULL INTRUSION, drawn in characters — the middle Display Mode rung's version
// of the Nullcraft board.
//
// It is THE SAME GAME. The board comes out of nullboard.js's own generator, so
// the lattice size, defended density, step budget, alert-per-hit and the free
// intel skill buys all scale off skill-vs-difficulty exactly as they do on the
// graphical panel, and the generator's guarantee still holds: a clean route from
// an interface to the goal always exists inside the budget. Every action goes
// through the same nullMove/nullProbe state machine.
//
// What differs is only how you see it and how you point at it — an equivalent,
// not a description (docs/systems-display-mode.md).
//
// It mounts in the AREA PANE rather than a modal, because a modal that steals
// focus is exactly what the text rungs exist to avoid, and hands the pane back
// on close the way the text cockpit does.
import { setAreaPane } from '../render.js';
import { esc, bar, paintRow, heading, ensureTextUiStyles } from './textui.js';
import { generateNull, setNullSkin, nullActions, stopNullGame, NULL_COLS } from './nullboard.js';

let _state = null;
let _opts = null;
let _mode = 'move';       // 'move' | 'probe' — what picking a node means right now
let _open = false;

export function isTextNullActive() { return _open; }

const W = 44;

// Column letter + row number, so every node has a name a player can type. Read
// in the order they are drawn: 'a1' is leftmost column, top row.
const nodeLabel = (n) => `${String.fromCharCode(97 + n.c)}${n.r + 1}`;

function idFromLabel(state, label) {
  const m = String(label || '').trim().toLowerCase().match(/^([a-z])\s*(\d+)$/);
  if (!m) return null;
  const id = `${m[1].charCodeAt(0) - 97},${Number(m[2]) - 1}`;
  return state.nodes.has(id) ? id : null;
}

// ── The glyphs ───────────────────────────────────────────────────────────────
// An unprobed node is '?' and that IS the game: a defended node is
// indistinguishable from a clean one until you spend a step finding out. The
// character board must not leak what the graphical one hides.
function glyphFor(state, n) {
  if (n.id === state.pos) return { ch: '@', cls: 'me' };
  if (n.id === state.goal) return { ch: '◎', cls: 'hi' };
  if (!n.known) return { ch: '?', cls: 'unk' };
  return n.defended ? { ch: '#', cls: 'bad' } : { ch: '·', cls: 'ok' };
}

function boardRows(state) {
  const cols = nullActions.columns(state);
  const front = new Set(nullActions.frontier(state));
  const height = Math.max(...cols.map(c => c.length));
  const out = [];

  for (let r = 0; r < height; r++) {
    const row = [];
    for (let c = 0; c < NULL_COLS; c++) {
      const n = cols[c][r];
      if (!n) { row.push({ ch: ' ', cls: 'dim' }, { ch: ' ', cls: 'dim' }, { ch: ' ', cls: 'dim' }); continue; }
      const g = glyphFor(state, n);
      // Actionable in probe mode means 'reachable and not yet known' — offering a
      // probe on something already probed would spend a step for nothing.
      const actionable = state.done ? false
        : _mode === 'probe' ? (front.has(n.id) && !n.known)
          : front.has(n.id);
      row.push({ ch: g.ch, cls: actionable ? `${g.cls} pick` : g.cls, node: actionable ? n.id : null });
      // The forward link, so the lattice reads as a graph rather than a grid.
      row.push({ ch: c < NULL_COLS - 1 ? '─' : ' ', cls: 'link' });
      row.push({ ch: ' ', cls: 'link' });
    }
    out.push(row);

    // Labels under the nodes, so a typed 'b2' has something to read off.
    const labels = [];
    for (let c = 0; c < NULL_COLS; c++) {
      const n = cols[c][r];
      const t = n ? nodeLabel(n) : '  ';
      labels.push({ ch: t[0] || ' ', cls: 'dim' }, { ch: t[1] || ' ', cls: 'dim' }, { ch: ' ', cls: 'dim' });
    }
    out.push(labels);
  }
  return out;
}

// Cells may carry a node id, so those spans are emitted separately from the
// run-length-encoded ones. Everything else still goes through paintRow, which is
// what keeps the repaint cheap.
function paintBoardRow(cells) {
  let out = '', run = [];
  const flush = () => { if (run.length) { out += paintRow(run); run = []; } };
  for (const c of cells) {
    if (c.node == null) { run.push(c); continue; }
    flush();
    out += `<span class="${c.cls}" data-nnode="${esc(c.node)}">${esc(c.ch)}</span>`;
  }
  flush();
  return out;
}

function render() {
  if (!_state) return;
  const s = _state;
  const alertFrac = s.alert / 100;
  const stepCls = s.steps <= 2 ? 'bad' : s.steps <= 4 ? 'warn' : 'ok';
  const alertCls = alertFrac >= 0.75 ? 'bad' : alertFrac >= 0.4 ? 'warn' : 'ok';

  const lines = [
    `<div class="txui-hd"><span>NULL INTRUSION</span><span>${esc(String(_opts.targetName || 'DEVICE').toUpperCase())}</span></div>`,
    `<span class="dim">OPERATION </span><span class="hi">${esc(String(_opts.operation || '').toUpperCase())}</span>`
      + `   <span class="dim">TARGET </span><span class="warn">${esc(String(_opts.subsystem || '').toUpperCase())}</span>`,
    heading('ROUTE', W),
    ...boardRows(s).map(r => paintBoardRow(r)),
    heading('STATUS', W),
    `<span class="dim">STEPS   </span><span class="${stepCls}">${Math.max(0, s.steps)}</span>`
      + `   <span class="dim">ALERT </span>${bar(alertFrac, 20, alertCls)} <span class="${alertCls}">${Math.round(s.alert)}%</span>`,
    s.message ? `\n<span class="${s.done ? (s.won ? 'ok' : 'bad') : 'dim'}">${esc(s.message)}</span>` : '',
    heading('ACTIONS', W),
    `<span class="pick${_mode === 'move' ? ' hi' : ''}" data-nact="move">[move]</span>  `
      + `<span class="pick${_mode === 'probe' ? ' hi' : ''}" data-nact="probe">[probe]</span>  `
      + `<span class="pick" data-nact="abort">[abort]</span>`,
    `<span class="dim">${_mode === 'probe'
      ? 'pick a node to test it — costs a step, costs no alert'
      : 'pick a lit node to move · ? unknown · # defended · ◎ target'}</span>`,
  ];

  setAreaPane(`<div class="txui txnl">${lines.filter(Boolean).join('\n')}</div>`);
  wire();
}

function wire() {
  const root = document.querySelector('.txnl');
  if (!root) return;
  root.querySelectorAll('[data-nnode]').forEach(el => {
    el.addEventListener('click', () => act(el.getAttribute('data-nnode')));
  });
  root.querySelectorAll('[data-nact]').forEach(el => {
    el.addEventListener('click', () => command(el.getAttribute('data-nact')));
  });
}

// One entry point for a node, whatever mode we are in — so the click path and
// the typed path cannot diverge on what picking a node means.
function act(id) {
  if (!_state || _state.done) return;
  if (_mode === 'probe') { nullActions.probe(_state, id); _mode = 'move'; }
  else nullActions.move(_state, id);
  render();
}

export function openTextNullBoard(opts) {
  let state;
  try { state = generateNull(opts); } catch { return false; }
  if (!state) return false;

  _opts = { targetName: 'DEVICE', subsystem: '', operation: '', ...opts };
  _state = state;
  _mode = 'move';
  _open = true;
  ensureTextUiStyles();
  // The base game calls these back; finish() fires after onResult has already
  // gone to the server, so this only ever decides how long the board stays up.
  setNullSkin({ board: (s) => { _state = s; render(); }, finish: () => { render(); } });
  render();
  return true;
}

export function command(word) {
  if (!_open || !_state) return false;
  const text = String(word || '').trim().toLowerCase();
  if (!text) return false;

  if (text === 'abort') { close(); return true; }
  if (text === 'move' || text === 'probe') { _mode = text; render(); return true; }

  // 'probe b2' and 'move b2' set the mode for that one pick, which is what a
  // player typing the long form obviously means.
  const m = text.match(/^(move|probe)\s+(.+)$/);
  const label = m ? m[2] : text;
  const id = idFromLabel(_state, label);
  if (!id) return false;                 // not ours — let the server answer it
  if (m) _mode = m[1];
  act(id);
  return true;
}

export function close() {
  _open = false;
  _state = null;
  _opts = null;
  setNullSkin(null);
  stopNullGame();
}
