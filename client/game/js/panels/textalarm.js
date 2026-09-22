// THE ALARM PANEL, drawn in characters.
//
// Same game as alarmpanel.js — same terminals, same loop, same clock — because
// both files are skins over alarmgame.js and neither owns a rule. What changes is
// that the terminal block is a column of rows instead of a grid of buttons, and
// latching is a word instead of a click.
//
// That is arguably the truer interface here: what you are doing is reading tags
// off a block and calling them out, so `latch c9` is the thing a person would
// actually say. It also means the board is playable with no pointing device,
// which the graphical one never was.
//
// ⚠ Everything coloured goes through `paintRow` — the one performance rule in
// textui.js. This board repaints at a tenth of the defuse board's rate because
// nothing on it MOVES except the clock; a terminal block is static between
// keystrokes and painting it at frame rate would be spending a budget on nothing.
import { setAreaPane } from '../render.js';
import { sendCmdSilent } from '../net.js';
import { esc, padEnd, heading, ensureTextUiStyles } from './textui.js';
import { setAlarmSkin, startAlarm, stopAlarm, alarmState, alarmLatch, alarmSecondsLeft, alarmWanted } from './alarmgame.js';

let _opts = null;
let _status = '';
let _open = false;
let _reported = false;
let _lastPaint = 0;

const W = 46;

export function isTextAlarmActive() { return _open; }

function report(won) {
  if (_reported) return;
  _reported = true;
  _opts?.onResult?.({ won: !!won });
}

function paint(st) {
  const left = alarmSecondsLeft();
  const wanted = alarmWanted();
  const lines = [];
  lines.push(heading('INTRUDER PANEL · DISARM', W));
  lines.push(`<span class="dim">PANEL</span> ${esc(_opts.deviceName || 'panel').toUpperCase()}`);
  lines.push('');
  // The clock goes hot at the same quarter the room's own chirping speeds up at,
  // so the two surfaces are telling one story rather than two.
  lines.push(`   <span class="${left <= st.seconds * 0.25 ? 'hot' : 'dim'}">${left.toFixed(1)}s</span> <span class="dim">before it calls it in</span>`);
  lines.push('');
  const pips = Array.from({ length: st.strikes }, (_, i) => (i < st.strikesLeft ? '◉' : '○')).join(' ');
  lines.push(`   <span class="dim">LOOP</span> ${st.step}/${st.chain.length}    <span class="dim">SEEKING</span> <span class="amb">${wanted || '—'}</span>    <span class="dim">SPARE</span> ${pips}`);
  lines.push('');
  for (const t of st.terminals) {
    const mark = t.live && !t.latched ? '▶' : ' ';
    const state = t.burnt ? '<span class="burnt">BURNT</span>'
      : t.latched ? '<span class="ok">OPEN</span>'
      : t.live ? '<span class="amb">LIVE</span>' : '';
    const tag = t.burnt ? `<span class="burnt">${t.tag}</span>` : `<span class="tag">${t.tag}</span>`;
    lines.push(`  ${mark} ${tag} <span class="dim">runs to</span> <span class="amp">${padEnd(t.next || 'END', 4)}</span> ${state}`);
  }
  lines.push('');
  lines.push(`   <span class="dim">${esc(st.note || 'The live terminal is marked. Follow where it runs.')}</span>`);
  lines.push('');
  lines.push(`   <span class="ok">latch &lt;tag&gt;</span> <span class="dim">— wrong one burns out.</span>`);
  lines.push('');
  lines.push(`<span class="dim">${'─'.repeat(W)}</span>`);
  lines.push(_status);
  lines.push(`<span class="dim">back to take your hands off it.</span>`);
  setAreaPane(`<div class="txal">${lines.join('\n')}</div>`);
}

const SKIN = {
  board: (st) => paint(st),
  status: (html) => { _status = html; },
  frame: (st) => {
    const now = performance.now();
    if (now - _lastPaint < 100) return;   // 10fps; only the clock moves
    _lastPaint = now;
    paint(st);
  },
  finish: (st, won, info) => {
    _status = info?.expired
      ? '<span class="hot">✗ OUT OF TIME.</span>'
      : won
        ? '<span class="ok">◉ LOOP OPEN — the panel goes dark.</span>'
        : '<span class="hot">✗ LATCHED OUT.</span>';
    paint(st);
    // ⚠ Expired reports nothing — the server's sweep owns an alarm whose window
    // ran out, and reporting a loss here would also damage the deck for a race
    // the player never lost.
    if (!info?.expired) report(won);
    setTimeout(() => close(), won ? 1100 : 1900);
  },
};

// ── Typed input ─────────────────────────────────────────────────────────────
// Returns true when the word was ours, which is what stops it reaching the
// server as an unknown command.
export function command(word) {
  if (!_open) return false;
  const w = String(word || '').trim().toLowerCase();
  if (w === 'back' || w === 'abort') { close(); return true; }
  const st = alarmState();
  if (!st) return false;
  const m = /^(?:latch|cut|open)\s+(\w+)$/.exec(w);
  if (m) {
    const i = st.terminals.findIndex(t => t.tag.toLowerCase() === m[1]);
    if (i >= 0) { alarmLatch(i); return true; }
    _status = `<span class="hot">No terminal tagged ${esc(m[1]).toUpperCase()}.</span>`;
    paint(st);
    return true;
  }
  return false;
}

function onKey(e) {
  if (!_open) return;
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
  const st = alarmState();
  if (!st) return;
  const n = Number(e.key);
  if (Number.isInteger(n) && n >= 1 && n <= st.terminals.length) {
    e.preventDefault();
    alarmLatch(n - 1);
  }
}

export function openTextAlarm(opts = {}) {
  ensureTextUiStyles();
  ensureStyles();
  _opts = { skill: 4, difficulty: 5, seconds: 30, deviceName: 'ALARM', onResult: null, ...opts };
  _reported = false;
  _status = '<span class="dim">Follow the loop before it finishes counting.</span>';
  setAlarmSkin(SKIN);
  const st = startAlarm(_opts);
  // FALL BACK UP, NEVER TO NOTHING: a null state here means the graphical board
  // opens instead. A rung with no implementation must never leave a player
  // looking at a panel they cannot touch.
  if (!st) { setAlarmSkin(null); return false; }
  _open = true;
  window.addEventListener('keydown', onKey);
  SKIN.board(st);
  return true;
}

export function close() {
  if (!_open) return;
  _open = false;
  window.removeEventListener('keydown', onKey);
  stopAlarm();
  setAlarmSkin(null);
  sendCmdSilent('look');
}

function ensureStyles() {
  if (document.getElementById('textalarm-styles')) return;
  const st = document.createElement('style');
  st.id = 'textalarm-styles';
  st.textContent = `
    .txal { line-height:1.4; white-space:pre; }
    .txal .amp  { color:#7fe3ff; }
    .txal .amb  { color:#e0a030; }
    .txal .tag  { color:#cfe6d8; font-weight:700; }
    .txal .hot  { color:#ff5a3c; font-weight:700; }
    .txal .ok   { color:#46e05a; }
    .txal .burnt{ color:#5c4038; }
  `;
  document.head.appendChild(st);
}
