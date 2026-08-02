// CIRCUIT BREACH, drawn in characters — the middle Display Mode rung's version
// of the hacking minigame.
//
// It is THE SAME GAME. The board comes out of circuithack.js's own generator, so
// the grid size, hazard density, sensor range, alarm tolerance, cycle budget and
// TRACE rate all scale off skill-vs-difficulty exactly as they do on the glowing
// PCB, and the generator's guarantee still holds: a hazard-free, gate-respecting
// route to the core within the budget always exists. Every move goes through the
// same `moveTo`/`ping`/`scanNode`/`breach` state machine.
//
// What's different is only how you see it and how you point at it. That is what
// the middle rung means — an equivalent, not a description
// (docs/systems-display-mode.md).
//
// It mounts in the AREA PANE rather than a modal overlay, because a modal that
// steals focus is exactly what the text rungs exist to avoid. The pane is handed
// back on close, the way the text cockpit hands it back.
import { setAreaPane } from '../render.js';
import { sendCmdSilent } from '../net.js';
import { esc, bar, paintRow, heading, ensureTextUiStyles } from './textui.js';
import { generateBreach, setBreachSkin, breachActions } from './circuithack.js';

let _state = null;
let _opts = null;
let _status = '';
let _mode = null;        // null | 'scan' | 'breach' — what a click means right now
let _open = false;

export function isTextBreachActive() { return _open; }

// ── The glyphs ───────────────────────────────────────────────────────────────
// Each node type gets ONE character, chosen so the board reads without a legend
// after about two seconds: the core is a target, ICE is a hash (a wall), a snare
// is a spiral, a key is a key, a gate is locked, a sentry is an eye.
//
// An UNKNOWN via is `?` and that is the game — the whole tactical layer is that
// hazards are indistinguishable from plain vias until sensed or scanned. The
// character board must not leak what the PCB hides.
const GLYPH = {
  entry: '▣', core: '◎', normal: '·', firewall: '#', decoy: '@',
  key: '♦', gate: '⌂', sentry: '⊙', boost: '+',
};
const CLS = {
  entry: 'ok', core: 'hi', normal: 'dim', firewall: 'bad', decoy: 'warn',
  key: 'warn', gate: 'warn', sentry: 'bad', boost: 'ok',
};

function glyphFor(state, n) {
  if (n.id === state.pos) return { ch: '@', cls: 'me' };
  if (n.id === state.core) return { ch: GLYPH.core, cls: CLS.core };
  if (n.id === state.entry) return { ch: GLYPH.entry, cls: CLS.entry };
  // Sentries are always visible active guards — the PCB shows them too.
  if (n.type === 'sentry') return { ch: GLYPH.sentry, cls: CLS.sentry };
  if (!breachActions.isKnown(state, n.id)) return { ch: '?', cls: 'unk' };
  return { ch: GLYPH[n.type] || GLYPH.normal, cls: CLS[n.type] || CLS.normal };
}

// ── The board ────────────────────────────────────────────────────────────────
// Two character columns per grid column so a horizontal trace has somewhere to
// live: nodes on the evens, the link between them on the odds. Vertical links sit
// on their own row between node rows. The result is a real graph, not a grid with
// the edges implied — which matters, because the generator does NOT connect every
// neighbour and a player who assumes it does will walk into a dead end.
function boardRows(state) {
  const at = (r, c) => state.nodes.find(n => n.r === r && n.c === c) || null;
  const linked = (a, b) => !!(a && b && breachActions.neighborsOf(state, a.id).has(b.id));
  const out = [];

  for (let r = 0; r < state.rows; r++) {
    const row = [];
    for (let c = 0; c < state.cols; c++) {
      const n = at(r, c);
      if (!n) { row.push({ ch: ' ', cls: 'dim' }, { ch: ' ', cls: 'dim' }); continue; }
      const g = glyphFor(state, n);
      // A node you can act on this turn is a click target. The slots machine is
      // the precedent: clickable text is what stops a character panel feeling
      // like a fallback for people who have a mouse.
      const actionable = _mode === 'scan' ? breachActions.isScannable(state, n.id)
        : _mode === 'breach' ? !!breachActions.breachKind(state, n.id)
          : breachActions.isReachable(state, n.id);
      row.push({ ch: g.ch, cls: actionable ? `${g.cls} pick` : g.cls, node: actionable ? n.id : null });
      const east = at(r, c + 1);
      row.push({ ch: linked(n, east) ? '─' : ' ', cls: 'link' });
    }
    out.push(row);

    if (r < state.rows - 1) {
      const gap = [];
      for (let c = 0; c < state.cols; c++) {
        const n = at(r, c), s = at(r + 1, c);
        gap.push({ ch: linked(n, s) ? '│' : ' ', cls: 'link' }, { ch: ' ', cls: 'link' });
      }
      out.push(gap);
    }
  }
  return out;
}

// Cells carry an optional node id, so the row painter has to emit those spans
// separately from the run-length-encoded ones. Everything else still goes through
// paintRow, which is what keeps the repaint cheap.
function paintBoardRow(cells) {
  let out = '', run = [];
  const flush = () => { if (run.length) { out += paintRow(run); run = []; } };
  for (const c of cells) {
    if (c.node == null) { run.push(c); continue; }
    flush();
    out += `<span class="${c.cls}" data-bnode="${c.node}">${esc(c.ch)}</span>`;
  }
  flush();
  return out;
}

const W = 44;

function render() {
  if (!_state) return;
  const s = _state;
  const tracePct = s.traceMax ? s.trace / s.traceMax : 0;
  const cycCls = s.movesLeft <= 2 ? 'bad' : s.movesLeft <= 4 ? 'warn' : 'ok';
  const trCls = tracePct >= 0.75 ? 'bad' : tracePct >= 0.4 ? 'warn' : 'ok';

  const lines = [
    `<div class="txui-hd"><span>CIRCUIT BREACH</span><span>${esc(String(_opts.deviceName || 'TERMINAL').toUpperCase())}</span></div>`,
    heading('BOARD', W),
    ...boardRows(s).map(r => paintBoardRow(r)),
    heading('STATUS', W),
    `<span class="dim">CYCLES  </span><span class="${cycCls}">${Math.max(0, s.movesLeft)}</span><span class="dim">/${s.movesMax}</span>`
      + `   <span class="dim">ALARM </span><span class="warn">${'◆'.repeat(Math.max(0, s.alarmsLeft))}${'◇'.repeat(Math.max(0, s.alarmsMax - Math.max(0, s.alarmsLeft)))}</span>`
      + `   <span class="dim">SENSOR r${s.sensor}</span>${s.keys ? '   <span class="warn">♔ KEY</span>' : ''}`,
    `<span class="dim">TRACE   </span>${bar(tracePct, 22, trCls)}`,
    _status ? `\n${_status}` : '',
    heading('ACTIONS', W),
    `<span class="pick" data-bact="ping">[ping]</span>  `
      + `<span class="pick" data-bact="scan">[scan]</span>  `
      + `<span class="pick" data-bact="breach">[breach]</span>  `
      + `<span class="pick" data-bact="abort">[abort]</span>`,
    `<span class="dim">${_mode ? `pick a via to ${_mode}, or [${_mode}] again to cancel` : 'click a lit via to move · ? is unknown · # ice · @ snare · ⊙ sentry · ⌂ gate · ◎ core'}</span>`,
  ];

  setAreaPane(`<div class="txui txbr">${lines.filter(Boolean).join('\n')}</div>`);
  wire();
}

function wire() {
  const root = document.querySelector('.txbr');
  if (!root) return;
  root.querySelectorAll('[data-bnode]').forEach(el => {
    el.addEventListener('click', () => act(parseInt(el.getAttribute('data-bnode'), 10)));
  });
  root.querySelectorAll('[data-bact]').forEach(el => {
    el.addEventListener('click', () => command(el.getAttribute('data-bact')));
  });
}

// One entry point for a node, whatever mode we're in — so the click path and the
// typed path can't diverge on what "pick that via" means.
function act(id) {
  if (!_state || _state.over) return;
  if (_mode === 'scan') { breachActions.scan(_state, id); _mode = null; }
  else if (_mode === 'breach') { breachActions.breach(_state, id); _mode = null; }
  else breachActions.move(_state, id);
  if (_state && !_state.over) render();
}

export function command(word) {
  if (!_open || !_state) return false;
  const w = String(word || '').toLowerCase();
  if (w === 'ping') { _mode = null; breachActions.ping(_state); if (!_state.over) render(); return true; }
  if (w === 'scan' || w === 'breach') { _mode = _mode === w ? null : w; render(); return true; }
  if (w === 'abort') { close(); return true; }
  return false;
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

const SKIN = {
  board: () => render(),
  hud: () => { /* the character board draws HUD and board in one pass */ },
  status: (html) => { _status = html; },
  finish: (state, won, text) => {
    _status = `<span class="${won ? 'ok' : 'bad'}">&gt;&gt; ${esc(text.replace(/<[^>]*>/g, ''))}</span>`;
    render();
    // Leave the resolved board up for a beat — the hazards are revealed on
    // resolution and that reveal is most of what you learn from a loss.
    setTimeout(() => close(), won ? 1400 : 2600);
  },
};

export function openTextBreach(opts = {}) {
  ensureTextUiStyles();
  ensureStyles();
  _opts = { skill: 4, difficulty: 4, deviceName: 'TERMINAL', onResult: null, ...opts };
  _status = '';
  _mode = null;
  setBreachSkin(SKIN);
  _state = generateBreach({ ..._opts, atmName: _opts.deviceName });
  if (!_state) { setBreachSkin(null); return false; }
  _open = true;
  _status = '<span class="dim">Route to the CORE. ping/scan to scout, breach to force a gate, ice or sentry.</span>';
  render();
  return true;
}

export function close() {
  if (!_open) return;
  _open = false; _state = null; _mode = null;
  setBreachSkin(null);
  // Hand the pane back to the room, the way the text cockpit does.
  sendCmdSilent('look');
}

function ensureStyles() {
  if (document.getElementById('textbreach-styles')) return;
  const st = document.createElement('style');
  st.id = 'textbreach-styles';
  st.textContent = `
    .txbr { line-height:1.35; letter-spacing:1px; }
    .txbr .me   { color:#ffb63a; font-weight:700; text-shadow:0 0 6px rgba(255,150,40,.8); }
    .txbr .unk  { color:#586e78; }
    .txbr .link { color:#1d4436; }
  `;
  document.head.appendChild(st);
}
