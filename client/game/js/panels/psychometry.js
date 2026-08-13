// THE OBJECT REMEMBERS — the psychometry board.
//
// Four meters and one decision: which fragment do you push on, knowing that
// pushing costs you the others. That is the whole game, and it is deliberately
// over in about four seconds — the brief asked for quick interactions rather than
// lengthy ones, and a psychic impression that takes a minute to have is not an
// impression.
//
// ── The client decides nothing ──────────────────────────────────────────────
//
// The four fragment strengths arrive from the server, computed before this board
// was ever drawn (see `fragmentsFor` in plugins/psionics/psychometry.js). This
// file picks WHICH one to reveal and reports that choice back; it never invents a
// value and never decides whether the read succeeded. A client that lies can only
// choose among fragments the server already authorised.
//
// IDENTITY is capped at 4/10 on the server and can therefore never fill. That is
// not a bug to tune out — psychometry answers WHAT HAPPENED HERE and never WHO,
// because the surveillance plugin owns WHO and has counterplay this does not.
// The permanently short bar is the rule made visible.
import { setAreaPane } from '../render.js';
import { sendCmdSilent } from '../net.js';
import { esc, bar, heading, ensureTextUiStyles } from './textui.js';

let _open = false;
let _opts = null;

export function isPsychometryActive() { return _open; }

const W = 44;
const ORDER = ['image', 'emotion', 'location', 'identity'];
const LABEL = {
  image:    'IMAGE',
  emotion:  'EMOTION',
  location: 'LOCATION',
  identity: 'IDENTITY',
};

function paint(selected) {
  const f = _opts?.fragments || {};
  // ⚠ Pad the PLAIN text before appending the bar. `bar()` returns HTML spans, so
  // padEnd on a row that already contains one counts markup as characters and the
  // column silently drifts. Everything left of the bar is padded; nothing right
  // of it is.
  const rows = ORDER.map((k, i) => {
    const v = Math.max(0, Math.min(10, Number(f[k]) || 0));
    const mark = i === selected ? '>' : ' ';
    const left = `${mark} ${LABEL[k].padEnd(9)} `;
    return left + bar(v / 10, 10, i === selected ? 'hi' : '');
  });

  const lines = [
    heading('THE OBJECT REMEMBERS', W),
    '',
    `  ${esc(_opts?.itemName || 'it')}`,
    '',
    ...rows,
    '',
    '  [1-4] focus    [W] withdraw',
  ];
  setAreaPane(`<pre class="text-ui">${lines.join('\n')}</pre>`);
}

function finish(focus) {
  if (!_open) return;
  _open = false;
  window.removeEventListener('keydown', onKey, true);
  setAreaPane('');
  // Withdrawing is a real choice, not a cancel: you keep your resonance and learn
  // nothing. It reports the same way a focus does so the server always closes the
  // interaction rather than leaving it dangling.
  sendCmdSilent(`${_opts.resolveCmd} ${_opts.itemId} ${focus || 'withdraw'}`);
  _opts = null;
}

function onKey(e) {
  if (!_open) return;
  const k = e.key.toLowerCase();
  if (k >= '1' && k <= '4') {
    e.preventDefault(); e.stopPropagation();
    const i = Number(k) - 1;
    paint(i);
    setTimeout(() => finish(ORDER[i]), 220);
    return;
  }
  if (k === 'w' || k === 'escape') {
    e.preventDefault(); e.stopPropagation();
    finish('withdraw');
  }
}

export function openPsychometry(opts) {
  ensureTextUiStyles();
  _opts = opts;
  _open = true;
  paint(-1);
  window.addEventListener('keydown', onKey, true);
  return true;
}

// The text rung and the graphical rung are the same board here, deliberately.
// This surface is four bars and a keypress: there is no canvas version that would
// be a better experience, so shipping one skin honestly beats shipping two that
// differ only in font. The ladder still works — `autoResolved` handles the bottom
// rung before either is reached.
export const openTextPsychometry = openPsychometry;
