// The SIFT disambiguation picker, as a dialog.
//
// WHY THIS EXISTS. "Which one? [1] rusty pipe [2] lead pipe" was printed into the
// log and nowhere else. That is a modal state — the next thing you type means
// something different than it did a second ago — rendered as scrollback. It
// scrolls away, nothing announces it as a decision, and there is no control to
// focus. Sixty-eight call sites open one of these.
//
// The text still prints. This is additive: the log keeps the record, the decision
// gets a control. See the note over `pendingPayload` in server/engine/sift.js for
// why the server stamps this on the way out rather than at sixty-eight sites.
//
// EVERY CONTROL IS A COMMAND THE PLAYER COULD HAVE TYPED — the numbers, `next`,
// `prev`, `cancel`. The dialog holds no logic of its own and the server cannot
// tell it apart from someone typing (the workspace-HUD rule). That is also what
// makes it safe to leave the command box working while it is up.
//
// NO DRAG, NOTHING TO POINT AT. A pick is a list and a keypress. The panel is
// `#sift-panel`, which is enough for a11y-focus.js to trap focus and wire Escape
// to the close control by itself.
import { sendCmd } from '../net.js';

let _el = null;

export function closeSiftPanel() {
  if (!_el) return;
  _el.remove();
  _el = null;
}

// True while the picker is up — the smartbar and anything else that wants to know
// whether a bare number is currently spoken for can ask.
export function isSiftPanelOpen() { return !!_el; }

// Send one of the picker's own words and let the server answer. We never close
// on click: the server's reply carries either a fresh page or an explicit close,
// so the panel's lifetime is decided in one place rather than guessed at here.
function pick(cmd, label) {
  sendCmd(cmd, label);
}

// msg: { verb, total, from, to, options:[{n,label,command}], hasPrev, hasNext }
export function openSiftPanel(msg) {
  const first = !_el;
  if (!_el) {
    _el = document.createElement('div');
    _el.id = 'sift-panel';
    _el.className = 'sift-panel';
    _el.setAttribute('role', 'dialog');
    _el.setAttribute('aria-modal', 'true');
    _el.setAttribute('aria-labelledby', 'sift-title');
    document.body.appendChild(_el);
  }

  const range = msg.total > msg.options.length ? ` (${msg.from}–${msg.to} of ${msg.total})` : '';
  // The verb is what makes this answerable without the log. "Which one?" alone
  // tells a player who cannot see the line above it nothing about what they are
  // about to do — and several of these spend money.
  const what = msg.verb ? `Which one do you want to ${msg.verb}?` : 'Which one?';

  _el.innerHTML = `
    <div class="sift-head">
      <span class="sift-title" id="sift-title"></span>
      <button class="sift-x" type="button" aria-label="Cancel">✕</button>
    </div>
    <div class="sift-range"></div>
    <div class="sift-list" role="group" aria-labelledby="sift-title"></div>
    <div class="sift-nav"></div>`;
  _el.querySelector('.sift-title').textContent = what;
  _el.querySelector('.sift-range').textContent = range.trim();

  const list = _el.querySelector('.sift-list');
  for (const o of msg.options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sift-opt';
    b.dataset.n = String(o.n);
    // The number is read as part of the label deliberately — it is also the way
    // to pick this row from the command box, and the two must not disagree.
    b.textContent = `${o.n}. ${o.label}`;
    b.addEventListener('click', () => pick(o.command, o.label));
    list.appendChild(b);
  }

  const nav = _el.querySelector('.sift-nav');
  const addNav = (cmd, label) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sift-navbtn';
    b.textContent = label;
    b.addEventListener('click', () => pick(cmd, label));
    nav.appendChild(b);
  };
  if (msg.hasPrev) addNav('prev', 'Previous');
  if (msg.hasNext) addNav('next', 'More');
  addNav('cancel', 'Cancel');

  _el.querySelector('.sift-x').addEventListener('click', () => pick('cancel', 'cancel'));

  // Digits pick, arrows walk. Both are what a player would try first, and the
  // digit path means the picker answers to the same keystroke whether focus is
  // in here or in the command box.
  _el.onkeydown = (e) => {
    if (/^[1-9]$/.test(e.key)) {
      const b = list.querySelector(`.sift-opt[data-n="${e.key}"]`);
      if (b) { e.preventDefault(); b.click(); }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const opts = [...list.querySelectorAll('.sift-opt')];
      const i = opts.indexOf(document.activeElement);
      const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
      if (opts[next]) { e.preventDefault(); opts[next].focus(); }
    }
  };

  // On a page turn the panel is rebuilt under a focus that no longer exists, so
  // focus is taken every time, not only on open. `first` is kept for the caller's
  // benefit — a re-render should not feel like a new window opening.
  const target = list.querySelector('.sift-opt');
  if (target) target.focus();
  return first;
}
