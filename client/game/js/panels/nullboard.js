/**
 * NULL INTRUSION — the Nullcraft board.
 *
 * You are inside somebody else's machine, routing a signal from an exposed
 * interface to the subsystem you came for, past the parts built to stop you.
 *
 * ── Why this one is TURN-BASED ───────────────────────────────────────────────
 *
 * Every other minigame in this client is a reflex game, and the Display Mode doc
 * says plainly what that costs: at the `log` rung a reflex board cannot be
 * played at all, so `resolveForLogRung` rolls one dice check instead and calls
 * itself "an interim shape", explicitly waiting for somebody to write "a
 * turn-based breach".
 *
 * This is that breach. It has no clock. Nothing moves unless the player moves
 * it, which means the SAME game is playable at all three rungs — mouse at the
 * top, characters in the middle, and (once a resolve path is written for it) as
 * a paced exchange at the bottom. A Null intrusion is meant to feel like
 * thinking, not like twitching, so the fiction and the accessibility argument
 * happen to want the same thing.
 *
 * ── The board ────────────────────────────────────────────────────────────────
 *
 * A layered DAG. Column 0 is the interfaces you can reach from outside; the last
 * column is the subsystem you named. Every node connects forward to a couple of
 * nodes in the next column, so the shape reads as "route through the machine"
 * rather than "walk a maze".
 *
 * Some nodes are DEFENDED. Stepping on one spikes ALERT. Alert at 100 and the
 * interface closes on you.
 *
 * Two actions, and the tension is entirely between them:
 *
 *   PROBE  — costs a step, reveals whether an adjacent node is defended
 *   MOVE   — costs a step, and if you were wrong it costs alert
 *
 * Steps are finite. So you cannot probe everything, and probing the whole
 * frontier is exactly as fatal as walking in blind — just slower. That is the
 * whole game.
 *
 * ── The guarantee ────────────────────────────────────────────────────────────
 *
 * A clean path from column 0 to the goal ALWAYS exists and is always walkable
 * within the step budget. An unsolvable board is not a hard board, it is a bug
 * that reads as difficulty, and the player cannot tell the two apart.
 */

// ── Skin seam ────────────────────────────────────────────────────────────────
// One game, two faces — the same rule circuithack.js follows. A skin swaps the
// renderer; the generator, the difficulty scaling, the alert model and every
// fail state stay here. A skin that needs to change one of those is not a skin.
let _skin = null;
export function setNullSkin(skin) { _skin = skin; }

let _opts = null;
let _state = null;

export const NULL_COLS = 4;

// ── Difficulty ───────────────────────────────────────────────────────────────
// Skill buys STEPS and STARTING KNOWLEDGE, never a lower alert cost. High skill
// should make the board more legible and more forgiving to plan on, not make the
// machine's defences weaker — the target's security is the target's, and a
// better Null is better at reading it, not at wishing it away.
export function nullParams(skill = 4, difficulty = 5) {
  const s = Math.max(0, Number(skill) || 0);
  const d = Math.max(1, Number(difficulty) || 1);
  return {
    rows: Math.min(5, 2 + Math.round(d / 4)),          // wider machine = more choices
    steps: Math.max(5, 8 + Math.round(s / 2) - Math.round(d / 3)),
    defendedFrac: Math.min(0.55, 0.15 + d * 0.035),
    alertPerHit: Math.min(60, 18 + d * 2.5),
    freeIntel: Math.max(0, Math.min(6, Math.round(s / 2) - 1)),  // nodes revealed at open
  };
}

const key = (c, r) => `${c},${r}`;

/**
 * Build a board. Exported so a skin can generate without opening the overlay —
 * the difficulty scaling MUST be identical for both faces or they are two games
 * sharing a name.
 */
export function generateNull(opts) {
  _opts = { skill: 4, difficulty: 5, targetName: 'DEVICE', subsystem: 'SUBSYSTEM',
            operation: 'JAM', onResult: null, ...opts };
  return generate();
}

function generate() {
  const p = nullParams(_opts.skill, _opts.difficulty);
  const nodes = new Map();

  for (let c = 0; c < NULL_COLS; c++) {
    const rows = c === NULL_COLS - 1 ? 1 : p.rows;      // the goal is a single node
    for (let r = 0; r < rows; r++) {
      nodes.set(key(c, r), {
        id: key(c, r), c, r,
        defended: false,
        known: false,          // has the player probed or entered it
        visited: false,
      });
    }
  }

  // Forward edges: each node reaches the row across from it and its neighbours,
  // so the graph is dense enough that a blocked route is never a dead end.
  const edges = new Map();
  for (const n of nodes.values()) {
    if (n.c === NULL_COLS - 1) { edges.set(n.id, []); continue; }
    const nextRows = n.c + 1 === NULL_COLS - 1 ? 1 : p.rows;
    const out = [];
    for (let dr = -1; dr <= 1; dr++) {
      const r = nextRows === 1 ? 0 : n.r + dr;
      if (r < 0 || r >= nextRows) continue;
      const id = key(n.c + 1, r);
      if (nodes.has(id) && !out.includes(id)) out.push(id);
    }
    edges.set(n.id, out);
  }

  // THE GUARANTEE: carve one clean path first, then scatter defences among
  // everything else. Doing it the other way round and re-rolling until solvable
  // is how a board ends up unsolvable in the one case nobody tested.
  const safe = new Set();
  let cur = key(0, Math.floor(Math.random() * p.rows));
  safe.add(cur);
  while (nodes.get(cur).c < NULL_COLS - 1) {
    const outs = edges.get(cur);
    cur = outs[Math.floor(Math.random() * outs.length)];
    safe.add(cur);
  }

  const candidates = [...nodes.values()].filter(n => !safe.has(n.id) && n.c !== NULL_COLS - 1);
  const wanted = Math.round(candidates.length * p.defendedFrac);
  for (let i = candidates.length - 1; i > 0; i--) {          // Fisher-Yates
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  for (let i = 0; i < wanted && i < candidates.length; i++) candidates[i].defended = true;

  // Free intel from skill: reveal a few nodes up front. Defended ones first —
  // knowing where the guns are is what expertise actually looks like here.
  const revealable = [...nodes.values()].filter(n => n.c > 0 && n.c < NULL_COLS - 1);
  revealable.sort((a, b) => (b.defended ? 1 : 0) - (a.defended ? 1 : 0));
  for (let i = 0; i < p.freeIntel && i < revealable.length; i++) revealable[i].known = true;

  _state = {
    nodes, edges, params: p,
    pos: null,                      // null until the first move: you are outside
    alert: 0,
    steps: p.steps,
    done: false,
    won: false,
    goal: key(NULL_COLS - 1, 0),
    entries: [...nodes.values()].filter(n => n.c === 0).map(n => n.id),
    message: 'Pick an interface.',
  };
  return _state;
}

// ── Rules ────────────────────────────────────────────────────────────────────

export function nullReachable(state, id) {
  if (!state || state.done) return false;
  const n = state.nodes.get(id);
  if (!n) return false;
  if (state.pos === null) return n.c === 0;
  return (state.edges.get(state.pos) || []).includes(id);
}

function finish(state, won, message) {
  state.done = true;
  state.won = won;
  state.message = message;
  _skin?.finish?.(state);
  _opts?.onResult?.({ won });
}

export function nullMove(state, id) {
  if (!nullReachable(state, id)) return state;
  const n = state.nodes.get(id);
  state.steps--;
  state.pos = id;
  n.visited = true;
  n.known = true;

  if (n.defended) {
    state.alert = Math.min(100, state.alert + state.params.alertPerHit);
    state.message = 'Countermeasure. It knows something is in here.';
  } else {
    state.message = 'Through.';
  }

  if (state.alert >= 100) { finish(state, false, 'LOCKED OUT. The interface closed on you.'); return state; }
  if (id === state.goal) { finish(state, true, 'ACCESS. The subsystem is yours.'); return state; }
  // Out of steps is a loss, but only once you have actually run out — a board
  // that ends ON the winning move would be maddening and is a real off-by-one.
  if (state.steps <= 0) { finish(state, false, 'Out of room. The session times out around you.'); return state; }
  return state;
}

export function nullProbe(state, id) {
  if (!nullReachable(state, id) || state.done) return state;
  const n = state.nodes.get(id);
  if (n.known) { state.message = 'You already know that one.'; return state; }
  state.steps--;
  n.known = true;
  state.message = n.defended ? 'Defended. Something is watching that node.' : 'Clean.';
  if (state.steps <= 0) { finish(state, false, 'Out of room. The session times out around you.'); return state; }
  return state;
}

// Read-only helpers a renderer needs to decide what it may offer.
export const nullActions = {
  move: nullMove,
  probe: nullProbe,
  reachable: nullReachable,
  frontier: (state) => {
    if (!state || state.done) return [];
    return state.pos === null ? state.entries : (state.edges.get(state.pos) || []);
  },
  columns: (state) => {
    const cols = [];
    for (let c = 0; c < NULL_COLS; c++) {
      cols.push([...state.nodes.values()].filter(n => n.c === c).sort((a, b) => a.r - b.r));
    }
    return cols;
  },
};

export function stopNullGame() {
  const el = document.getElementById('null-board');
  if (el) el.remove();
  _state = null;
}

// ── The graphical face ───────────────────────────────────────────────────────

export function openNullBoard(opts) {
  stopNullGame();
  const state = generateNull(opts);
  const wrap = document.createElement('div');
  wrap.id = 'null-board';
  wrap.innerHTML = shell(_opts);
  document.body.appendChild(wrap);
  ensureNullStyles();
  paint(state);
  wrap.addEventListener('click', (e) => {
    const cell = e.target.closest('[data-node]');
    if (cell && !state.done) {
      const id = cell.getAttribute('data-node');
      const probing = e.shiftKey || document.getElementById('null-mode-probe')?.checked;
      paint(probing ? nullProbe(state, id) : nullMove(state, id));
      return;
    }
    if (e.target.closest('[data-null-close]')) stopNullGame();
  });
  return true;
}

function shell(o) {
  // NOTE: identifiers in these comments are quoted with 'single quotes', never
  // backticks — a backtick inside a template literal ends the string mid-file and
  // takes the whole client boot with it (see client:smoke).
  return `
    <div class="null-panel" role="dialog" aria-label="Null intrusion">
      <div class="null-hdr">
        <span class="null-op">${escapeText(o.operation)}</span>
        <span class="null-tgt">${escapeText(o.targetName)} / ${escapeText(o.subsystem)}</span>
        <button class="null-x" data-null-close aria-label="Abort intrusion">✕</button>
      </div>
      <div class="null-hud"></div>
      <div class="null-grid"></div>
      <div class="null-msg"></div>
      <label class="null-mode"><input type="checkbox" id="null-mode-probe"> probe (or hold Shift)</label>
    </div>`;
}

const escapeText = (s) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function paint(state) {
  const root = document.getElementById('null-board');
  if (!root || !state) return;
  if (_skin) { _skin.board?.(state); return; }

  root.querySelector('.null-hud').innerHTML =
    `<span>STEPS <b>${state.steps}</b></span>`
    + `<span class="null-alert${state.alert >= 60 ? ' hot' : ''}">ALERT <b>${Math.round(state.alert)}%</b></span>`;

  const front = new Set(nullActions.frontier(state));
  const cols = nullActions.columns(state).map(col => {
    const cells = col.map(n => {
      const cls = ['null-node'];
      if (n.id === state.pos) cls.push('here');
      if (n.visited) cls.push('seen');
      if (front.has(n.id)) cls.push('open');
      if (n.known) cls.push(n.defended ? 'bad' : 'safe');
      if (n.id === state.goal) cls.push('goal');
      const label = n.id === state.goal ? '◈' : n.known ? (n.defended ? '✕' : '·') : '?';
      const clickable = front.has(n.id) && !state.done;
      return `<div class="${cls.join(' ')}"${clickable ? ` data-node="${n.id}" tabindex="0"` : ''}>${label}</div>`;
    }).join('');
    return `<div class="null-col">${cells}</div>`;
  }).join('');
  root.querySelector('.null-grid').innerHTML = cols;
  root.querySelector('.null-msg').textContent = state.message;
}

function ensureNullStyles() {
  if (document.getElementById('null-board-styles')) return;
  const s = document.createElement('style');
  s.id = 'null-board-styles';
  // Positioned art: sizes stay in px deliberately. The accessible path off this
  // panel is 'displaymode textgames', not a bigger board — the same split
  // systems-display-mode.md documents for the cockpit and the other boards.
  s.textContent = `
    #null-board { position: fixed; inset: 0; display: grid; place-items: center;
      background: rgba(0,0,0,.72); z-index: 900; }
    #null-board .null-panel { background: var(--bg, #0b0d10); border: 1px solid var(--accent, #4ae);
      padding: 14px 16px; min-width: 320px; font-family: var(--font-mono, monospace); }
    #null-board .null-hdr { display: flex; gap: 10px; align-items: center; margin-bottom: 8px; }
    #null-board .null-op { color: var(--accent, #4ae); font-weight: bold; }
    #null-board .null-tgt { color: #8a949e; font-size: 11px; flex: 1; }
    #null-board .null-x { background: none; border: none; color: #8a949e; cursor: pointer; }
    #null-board .null-hud { display: flex; gap: 16px; font-size: 11px; margin-bottom: 8px; }
    #null-board .null-alert.hot { color: #e5484d; }
    #null-board .null-grid { display: flex; gap: 26px; justify-content: center; margin: 10px 0; }
    #null-board .null-col { display: flex; flex-direction: column; gap: 8px; }
    #null-board .null-node { width: 30px; height: 30px; display: grid; place-items: center;
      border: 1px solid #2a3138; color: #4c565f; }
    #null-board .null-node.open { border-color: var(--accent, #4ae); color: var(--accent, #4ae); cursor: pointer; }
    #null-board .null-node.safe { color: #30a46c; }
    #null-board .null-node.bad { color: #e5484d; border-color: #e5484d; }
    #null-board .null-node.here { background: var(--accent, #4ae); color: #000; }
    #null-board .null-node.goal { border-style: dashed; }
    #null-board .null-msg { font-size: 11px; color: #8a949e; min-height: 16px; }
    #null-board .null-mode { font-size: 11px; color: #8a949e; display: block; margin-top: 6px; }`;
  document.head.appendChild(s);
}

export function command() { return false; }
export function close() { stopNullGame(); }
