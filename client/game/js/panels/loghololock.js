// HOLOLOCK BYPASS at the `log` Display Mode rung: the lock, played a move at a
// time, entirely in the game log.
//
// The log rung is the screen-reader rung, so this board draws nothing. Every move
// appends lines to #output (role="log", so they're read out as they land), each
// line says everything you need to decide the next move, and nothing ever
// repaints. There's no clock. You type `probe 4`, `set 4`, or just `4`.
//
// The rules live in client/shared/hololock-turns.js, which the odds script also
// imports: best play here wins exactly as often as the dice roll it replaced
// (docs/proposals/hololock-turn-based.md). This file only says the game.
//
// The result goes out through `onResult`, and the caller fires the same
// `hackresolve <door> <0|1>` every other rung fires, so the server's
// authoritative path doesn't know or care which board was used.
//
// ⚠ ABANDONING A LOCK IS TRIPPING IT. The capacity is announced before the first
// move, so a player who could walk away from a bad roll and jack in again would
// always play the good one, and beat the dice. `abort`, and opening another lock
// over this one, both report a loss. The server holds the same line for a player
// who just stops typing (doors.js, `pendingHack.turns`).
import { appendHtml } from '../render.js';
import { boardFor, newLock, act } from '../../../shared/hololock-turns.js';

let _lock = null;
let _opts = null;
let _queue = [];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// net.js prints the player's own echo AFTER the board's handler returns, so a
// reply written straight away would sit above the command that caused it. Lines
// queue and land a microtask later, in order.
function say(html) {
  _queue.push(html);
  if (_queue.length === 1) queueMicrotask(flush);
}
function flush() {
  const lines = _queue; _queue = [];
  for (const html of lines) appendHtml(`<span class="msg-system">${html}</span>`, 'system');
}

const cellName = (i) => String(i + 1);
const feedbackLine = (lock) => `Feedback ${lock.feedback} of ${lock.capacity}.`;
function where(lock) {
  const { lo, hi } = lock.known;
  return lo === hi ? `it can only be cell ${cellName(lo)}` : `cells ${cellName(lo)} to ${cellName(hi)}`;
}
function pinLine(lock) {
  return `Pin ${lock.pin + 1} of ${lock.pins}: ${where(lock)}. ${feedbackLine(lock)}`;
}

const HELP = [
  'Each pin hides in one cell from 1 to 10.',
  '<b>probe 4</b> costs 1 feedback. If 4 is the cell, the pin holds; if not, you learn which way it is.',
  '<b>set 4</b> costs nothing if 4 is right and 3 if it\'s wrong, and a wrong one still tells you which way.',
  'A number on its own is a probe. Fill the meter and the lock trips.',
  'Rule of thumb: probe the fourth cell of what\'s left, or just below the middle when fewer than seven are left. Once the feedback you can still take is no more than the pins left, stop probing and set.',
  '<b>status</b> repeats where you are. <b>abort</b> pulls the deck, and counts as tripping the lock.',
];

export function openLogHololock(opts = {}) {
  // Opening a lock over a live one abandons the first, and that's a trip (above).
  if (_lock) finish(false, 'You pull the deck mid-sequence. The first lock trips behind you.');
  _opts = { skill: 4, difficulty: 5, deviceName: 'hololock', onResult: null, ...opts };
  _lock = newLock(boardFor(_opts.skill, _opts.difficulty));
  const name = esc(_opts.deviceName);
  if (_lock.over) {
    // capacity 0: the dice never win from this far down, and neither can you
    finish(false, `You jack into the ${name}, and it flags your deck before you've touched a pin.`);
    return true;
  }
  say(`You jack into the ${name}. ${_lock.pins} pins, each hiding in one of cells 1 to 10. It takes ${_lock.capacity} feedback before it trips.`);
  say(`${pinLine(_lock)} Probe or set a cell. <b>help</b> for how.`);
  return true;
}

function finish(won, line) {
  const cb = _opts?.onResult;
  _lock = null;
  if (line) say(line);
  // after the lines, so the server's reply lands below them
  queueMicrotask(() => cb?.({ won }));
}

function move(kind, cell) {
  const lock = _lock;
  const at = cellName(cell);
  const answer = act(lock, kind, cell);
  if (answer === 'set' || answer === 'here') {
    const caught = answer === 'set' ? `It catches at ${at} and holds.` : `It's ${at}. The pin bites and holds.`;
    if (lock.won) return finish(true, `${caught} All ${lock.pins} pins hold, and the bolt is yours.`);
    return say(`${caught} ${pinLine(lock)}`);
  }
  const way = answer === 'right' ? 'higher' : 'lower';
  const what = kind === 'set' ? `The pin springs back at ${at}.` : `Nothing at ${at}.`;
  if (lock.over) return finish(false, `${what} ${feedbackLine(lock)} The lock trips and resets.`);
  say(`${what} It's ${way}: ${where(lock)}. ${feedbackLine(lock)}`);
}

// Words typed into the command line while the lock is open. Anything it doesn't
// recognise goes on to the server as normal, so `say` and `look` still work.
export function command(raw) {
  if (!_lock) return false;
  const words = String(raw || '').trim().toLowerCase().split(/\s+/);
  let [verb, arg] = words;
  if (/^\d+$/.test(verb) && words.length === 1) { arg = verb; verb = 'probe'; }
  if (verb === 'help') { HELP.forEach(say); return true; }
  if (verb === 'status') { say(pinLine(_lock)); return true; }
  if (verb === 'abort') { finish(false, 'You pull the deck. The lock trips and resets.'); return true; }
  const kind = verb === 'probe' || verb === 'p' ? 'probe' : verb === 'set' || verb === 's' ? 'set' : null;
  if (!kind) return false;
  // 0 is cell 10, so every cell is one key
  const n = arg === '0' ? 10 : Number(arg);
  if (!Number.isInteger(n) || n < 1 || n > 10) { say(`Which cell? ${kind} and a number from 1 to 10, like <b>${kind} 4</b>.`); return true; }
  move(kind, n - 1);
  return true;
}
