// DEMOLITION, drawn in characters.
//
// Same two games as demolition.js — same needle, same band, same loom, same
// clock — because both files are skins over demolitiongame.js and neither owns a
// rule. What changes is that the needle is a row of cells instead of a row of
// divs, and the two verbs are words instead of buttons.
//
// That last part is not a compromise. A defusing kit is a meter and a pair of
// snips and a man saying numbers out loud, so `probe blue` / `cut green` is
// arguably the truer interface; it also means the game is playable with no
// pointing device at all, which the graphical one never was.
//
// ⚠ Everything coloured goes through `paintRow`. A span per character, at frame
// rate, on a forty-cell needle track is the difference between a text panel and
// a slideshow — see the one performance rule in textui.js.
import { setAreaPane } from '../render.js';
import { sendCmdSilent } from '../net.js';
import { esc, padEnd, paintRow, heading, ensureTextUiStyles } from './textui.js';
import {
  setDemoSkin, startRig, startDefuse, stop as stopGame, demoState,
  rigFuse, rigCommit, defuseMove, defuseProbe, defuseCut, defuseSecondsLeft,
} from './demolitiongame.js';

let _opts = null;
let _status = '';
let _open = false;
let _reported = false;
let _lastPaint = 0;

const W = 46;
const TRACK = 40;

export function isTextDemolitionActive() { return _open; }

// Reports the chosen fuse alongside the outcome, exactly as the graphical board
// does — the two rungs hand the server the same two facts or they are not the
// same game.
function report(won, st) {
  if (_reported) return;
  _reported = true;
  _opts?.onResult?.({ won: !!won, fuse: st?.kind === 'rig' ? st.fuse : undefined });
}

// ── The needle track ────────────────────────────────────────────────────────
// The band is drawn, not described: you can SEE how much room a practised hand
// has, which is the entire feedback loop of the arming game.
function trackRow(st) {
  const cells = [];
  const lo = Math.round((0.5 - st.band / 2) * TRACK);
  const hi = Math.round((0.5 + st.band / 2) * TRACK);
  const at = Math.round(st.pos * TRACK);
  for (let i = 0; i <= TRACK; i++) {
    if (i === at) cells.push({ ch: '█', cls: 'ndl' });
    else if (i >= lo && i <= hi) cells.push({ ch: '▒', cls: 'band' });
    else cells.push({ ch: '·', cls: 'trk' });
  }
  return paintRow(cells);
}

function paintRig(st) {
  const lines = [];
  lines.push(heading(`CHARGE · ARMING`, W));
  lines.push(`<span class="dim">TARGET</span> ${esc(_opts.deviceName || 'target').toUpperCase()}`);
  lines.push('');
  if (st.phase === 'fuse') {
    lines.push(`   <span class="dim">FUSE</span>   <span class="hot">${String(st.fuse).padStart(3)}</span> <span class="dim">seconds</span>`);
    lines.push('');
    lines.push(`   <span class="dim">fuse +5 / fuse -5 &nbsp;&middot;&nbsp; ${st.fuseMin}-${st.fuseMax}</span>`);
    lines.push(`   <span class="dim">Short is worth more and leaves you less.</span>`);
    lines.push('');
    lines.push(`   <span class="ok">arm</span> <span class="dim">when you have set it.</span>`);
  } else {
    lines.push(`  ${trackRow(st)}`);
    lines.push('');
    const pips = Array.from({ length: 3 }, (_, i) => (i < st.seated ? '◉' : '○')).join(' ');
    lines.push(`   <span class="dim">LEADS</span> ${pips}    <span class="dim">FUMBLES</span> ${st.fumbles}/3`);
    lines.push('');
    lines.push(`   <span class="ok">seat</span> <span class="dim">(or space) when the needle is in the band.</span>`);
  }
  lines.push('');
  lines.push(`<span class="dim">${'─'.repeat(W)}</span>`);
  lines.push(_status);
  lines.push(`<span class="dim">abort to walk away.</span>`);
  setAreaPane(`<div class="txdm">${lines.join('\n')}</div>`);
}

function paintDefuse(st) {
  const left = defuseSecondsLeft();
  const lines = [];
  lines.push(heading(`CHARGE · DISARM`, W));
  lines.push(`<span class="dim">TARGET</span> ${esc(_opts.deviceName || 'target').toUpperCase()}`);
  lines.push('');
  lines.push(`   <span class="${left < 10 ? 'hot' : 'dim'}">${left.toFixed(1)}s</span> <span class="dim">on the clock</span>`);
  lines.push('');
  for (let i = 0; i < st.leads.length; i++) {
    const l = st.leads[i];
    const mark = i === st.cursor ? '▶' : ' ';
    const reading = l.cut ? 'CUT' : l.probed ? `${l.tension} mV` : '— — —';
    lines.push(`  ${mark} <span class="w-${l.colour}">━━</span> ${padEnd(l.colour.toUpperCase(), 7)} <span class="amp">${reading}</span>`);
  }
  lines.push('');
  lines.push(`   <span class="dim">${esc(st.note || 'The shunt reads against the run.')}</span>`);
  lines.push('');
  lines.push(`   <span class="ok">probe &lt;colour&gt;</span> <span class="dim">costs ${st.probeCost}s</span>   <span class="hot">cut &lt;colour&gt;</span>`);
  lines.push('');
  lines.push(`<span class="dim">${'─'.repeat(W)}</span>`);
  lines.push(_status);
  setAreaPane(`<div class="txdm">${lines.join('\n')}</div>`);
}

const SKIN = {
  board: (st) => (st.kind === 'rig' ? paintRig(st) : paintDefuse(st)),
  status: (html) => { _status = html; },
  frame: (st) => {
    const now = performance.now();
    if (now - _lastPaint < 33) return;   // ~30fps; the needle needs it, nothing else does
    _lastPaint = now;
    if (st.kind === 'rig') paintRig(st); else paintDefuse(st);
  },
  finish: (st, won, info) => {
    _status = info?.expired
      ? '<span class="hot">✗ OUT OF TIME.</span>'
      : won
        ? `<span class="ok">◉ ${st.kind === 'rig' ? 'SEATED — walk away.' : 'SHUNT CUT — the count stops.'}</span>`
        : `<span class="hot">✗ ${st.kind === 'rig' ? 'The charge is scrap.' : 'Wrong lead.'}</span>`;
    if (st.kind === 'rig') paintRig(st); else paintDefuse(st);
    // Expired reports nothing — the server owns a charge whose fuse ran out.
    if (!info?.expired) report(won, st);
    setTimeout(() => close(), won ? 1100 : 1900);
  },
};

// ── Typed input ─────────────────────────────────────────────────────────────
// Returns true when the word was ours, which is what stops it reaching the
// server as an unknown command.
export function command(word) {
  if (!_open) return false;
  const w = String(word || '').trim().toLowerCase();
  const st = demoState();
  if (w === 'abort') { close(); return true; }
  if (!st) return false;

  if (st.kind === 'rig') {
    if (w === 'arm' || w === 'seat') { rigCommit(); return true; }
    const m = /^fuse\s+([+-]?\d+)$/.exec(w);
    if (m) { rigFuse(parseInt(m[1], 10)); return true; }
    return false;
  }

  const byColour = (name) => st.leads.findIndex(l => l.colour === name);
  let m = /^probe\s+(\w+)$/.exec(w);
  if (m) { const i = byColour(m[1]); if (i >= 0) { defuseMove(i - st.cursor); defuseProbe(i); } return true; }
  m = /^cut\s+(\w+)$/.exec(w);
  if (m) { const i = byColour(m[1]); if (i >= 0) { defuseMove(i - st.cursor); defuseCut(i); } return true; }
  if (w === 'probe') { defuseProbe(); return true; }
  if (w === 'cut') { defuseCut(); return true; }
  return false;
}

function onKey(e) {
  if (!_open) return;
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
  const st = demoState();
  if (!st) return;
  if (st.kind === 'rig' && e.code === 'Space') { e.preventDefault(); rigCommit(); }
  else if (st.kind === 'defuse' && e.key === 'ArrowUp') { e.preventDefault(); defuseMove(-1); }
  else if (st.kind === 'defuse' && e.key === 'ArrowDown') { e.preventDefault(); defuseMove(1); }
}

function open(kind, opts) {
  ensureTextUiStyles();
  ensureStyles();
  _opts = { skill: 4, difficulty: 5, deviceName: 'CHARGE', onResult: null, ...opts };
  _reported = false;
  _status = kind === 'rig'
    ? '<span class="dim">Set the fuse, then catch the needle.</span>'
    : '<span class="dim">Probe costs time you don\'t have.</span>';
  setDemoSkin(SKIN);
  const st = kind === 'rig' ? startRig(_opts) : startDefuse(_opts);
  // FALL BACK UP, NEVER TO NOTHING: a null state here means the graphical board
  // opens instead. A rung with no implementation must never leave a player
  // looking at a bomb they cannot touch.
  if (!st) { setDemoSkin(null); return false; }
  _open = true;
  window.addEventListener('keydown', onKey);
  SKIN.board(st);
  return true;
}

export function openTextBombRig(opts = {}) { return open('rig', opts); }
export function openTextBombDefuse(opts = {}) { return open('defuse', opts); }

export function close() {
  if (!_open) return;
  _open = false;
  window.removeEventListener('keydown', onKey);
  stopGame();
  setDemoSkin(null);
  sendCmdSilent('look');
}

function ensureStyles() {
  if (document.getElementById('textdemolition-styles')) return;
  const st = document.createElement('style');
  st.id = 'textdemolition-styles';
  st.textContent = `
    .txdm { line-height:1.4; white-space:pre; }
    .txdm .trk  { color:#2c3f4d; }
    .txdm .band { color:#46e05a; }
    .txdm .ndl  { color:#ff5a3c; text-shadow:0 0 7px rgba(255,90,60,.85); }
    .txdm .amp  { color:#7fe3ff; }
    .txdm .hot  { color:#ff5a3c; font-weight:700; }
    .txdm .ok   { color:#46e05a; }
    .txdm .w-red{color:#e0453a}.txdm .w-blue{color:#4a90d9}.txdm .w-green{color:#46e05a}
    .txdm .w-amber{color:#e0a030}.txdm .w-white{color:#e8e8e8}.txdm .w-grey{color:#7e8a99}
  `;
  document.head.appendChild(st);
}
