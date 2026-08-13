// THE READ, drawn in characters.
//
// The reaction beat of the Long Watch's mastery system: three tells arrive one
// after another, a clock runs down, and you commit to one of four answers.
//
// The tells ARE the puzzle. A player who learns that a dropping shoulder means
// sidestep is genuinely better at the game afterwards, which is the whole reason
// mastery has a reaction beat at all rather than another passive — so the tells
// are spelled out plainly here rather than abbreviated into glyphs.
//
// NOT A REFLEX TEST YOU CAN LOSE BY DOING NOTHING. Letting the clock run out
// costs nothing at all: the composure was spent when the window opened. That is
// deliberate, and it is why this board never shouts about the time remaining.
//
// One input, four keys — 1..4, or the arrow-ish first letter of each answer. The
// panel repaints at ~10fps through paintRow, which is the only reason a
// character board can animate at all (see textui.js).
import { setAreaPane } from '../render.js';
import { sendCmdSilent } from '../net.js';
import { esc, bar, heading, rule, ensureTextUiStyles } from './textui.js';

let _open = false;
let _opts = null;
let _timer = null;
let _shown = 0;         // how many tells have arrived
let _started = 0;
let _answered = false;

export function isTextReadActive() { return _open; }

const W = 46;

function paint() {
  if (!_open || !_opts) return;
  const now = Date.now();
  const elapsed = now - _started;
  const frac = Math.max(0, 1 - elapsed / _opts.ttlMs);

  // Tells arrive spread across the first two-thirds of the window, so there is
  // always a beat left to answer in after the last one lands.
  const per = (_opts.ttlMs * 0.66) / Math.max(1, _opts.tells.length);
  _shown = Math.min(_opts.tells.length, Math.floor(elapsed / per) + 1);

  const rows = [heading(`READING ${String(_opts.targetName).toUpperCase()}`, W)];
  rows.push('');
  for (let i = 0; i < _opts.tells.length; i++) {
    if (i < _shown) rows.push(`  <span class="hi">${esc(_opts.tells[i])}</span>`);
    else rows.push(`  <span class="dim">·</span>`);
  }
  rows.push('');
  rows.push(`  ${bar(frac, 30, frac > 0.4 ? 'ok' : frac > 0.2 ? 'warn' : 'bad')}`);
  rows.push('');
  rows.push(rule(W));
  const opts = _opts.options.map((o, i) => `<span class="hi">${i + 1}</span> ${esc(o)}`).join('   ');
  rows.push(`  ${opts}`);
  rows.push(`  <span class="dim">press 1-4 — or do nothing, it costs you nothing</span>`);

  setAreaPane(`<div class="textui">${rows.join('\n')}</div>`);
}

function answer(index) {
  if (!_open || _answered) return;
  const choice = _opts.options[index];
  if (!choice) return;
  _answered = true;
  // The CHOICE goes up, not a verdict — the server decides whether it was right.
  sendCmdSilent(`${_opts.resolveCmd} ${_opts.token} ${choice}`);
  close();
}

function onKey(e) {
  if (!_open) return;
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= _opts.options.length) { e.preventDefault(); answer(n - 1); return; }
  const k = String(e.key || '').toUpperCase();
  const i = _opts.options.findIndex(o => o[0] === k);
  if (i >= 0) { e.preventDefault(); answer(i); }
}

export function openTextRead(opts) {
  if (!opts || !Array.isArray(opts.options) || !opts.options.length) return false;
  ensureTextUiStyles();
  _opts = opts;
  _open = true;
  _answered = false;
  _shown = 0;
  _started = Date.now();
  window.addEventListener('keydown', onKey, true);
  paint();
  _timer = setInterval(() => {
    if (Date.now() - _started >= _opts.ttlMs) { close(); return; }
    paint();
  }, 100);
  return true;
}

export function close() {
  if (!_open) return;
  _open = false;
  clearInterval(_timer);
  _timer = null;
  window.removeEventListener('keydown', onKey, true);
  _opts = null;
  // Hand the pane back — the room repaints itself on the next look or move.
  setAreaPane('');
}
