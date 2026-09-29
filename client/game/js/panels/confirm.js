// Generic in-browser confirmation dialog, driven by a server { type:'confirm' }
// message. Moveable (drag by the header). Confirming sends the server-supplied
// command back down the wire; cancelling just closes.
import { sendCmd } from '../net.js';
import { playUi } from '../ui-sound.js';

let _el = null;

// THESE WERE NOT DIALOGS AS FAR AS ANY ASSISTIVE TECH WAS CONCERNED.
//
// a11y-focus.js finds modals by a shortlist — `*-panel`, `*-overlay`, `*-modal`,
// `[role="dialog"]`, `[data-a11y-modal]` — and `.confirm-window` is none of those.
// So the four windows in this file, which between them confirm purchases, name
// corps, take poker bets and gate the sign-out, had no focus trap and no Escape:
// Tab walked straight out into the page behind them. They were the exact case the
// comment at the top of a11y-focus.js describes and the one class it missed.
//
// Opting in is the documented route (over growing that selector), and it is done
// here rather than at four call sites so the fifth window somebody adds to this
// file is covered by construction.
function asDialog(el, label) {
  el.setAttribute('data-a11y-modal', '');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  if (label) el.setAttribute('aria-label', label);
  return el;
}

// Exported because the piano panel needs exactly this and a third copy of it
// would be a third copy. (arrest.js still carries its own; fold it in when
// somebody is next in there.) Callers with a panel anchored by `bottom` or
// `right` must clear those themselves — this only ever writes left/top, and a
// box pinned at both edges stretches instead of moving.
export function makeDraggable(win, handle) {
  let ox = 0, oy = 0;
  // ⚠ A TOUCH DRAG NEEDS touch-action:none ON THE HANDLE. preventDefault on pointerdown does not
  // stop a browser claiming the gesture for panning, and once it does it sends pointercancel and
  // the window stops following the thumb after a few pixels. Buttons in the header keep their
  // own taps; this only tells the browser a drag here is ours.
  handle.style.touchAction = 'none';
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    const r = win.getBoundingClientRect();
    ox = e.clientX - r.left;
    oy = e.clientY - r.top;
    win.style.transform = 'none';
    win.style.left = r.left + 'px';
    win.style.top = r.top + 'px';
    handle.setPointerCapture(e.pointerId);
    handle.style.cursor = 'grabbing';
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    const x = Math.max(0, Math.min(globalThis.innerWidth - win.offsetWidth, e.clientX - ox));
    const y = Math.max(0, Math.min(globalThis.innerHeight - win.offsetHeight, e.clientY - oy));
    win.style.left = x + 'px';
    win.style.top = y + 'px';
  });
  handle.addEventListener('pointerup', () => { handle.style.cursor = 'grab'; });
  handle.addEventListener('pointercancel', () => { handle.style.cursor = 'grab'; });
  // A window left low on a portrait screen is off it after a rotate to landscape (342px tall),
  // with its ✕ out of reach. Pull a placed window back inside whenever the viewport changes.
  // Only a window that has been placed (an inline left) is touched; a centred one is the CSS's.
  // The confirm windows are built fresh on every open, so the listener takes itself off once its
  // window has left the page rather than collecting one per dialog for the life of the session.
  const reclamp = () => {
    if (!win.isConnected) { globalThis.removeEventListener('resize', reclamp); return; }
    if (!win.style.left || win.offsetWidth === 0) return;
    const x = Math.max(0, Math.min(globalThis.innerWidth - win.offsetWidth, parseFloat(win.style.left) || 0));
    const y = Math.max(0, Math.min(globalThis.innerHeight - win.offsetHeight, parseFloat(win.style.top) || 0));
    win.style.left = x + 'px';
    win.style.top = y + 'px';
  };
  globalThis.addEventListener?.('resize', reclamp);
}

// A window that sits centred in a flex overlay (the container and loot boxes) and can be picked up by
// its header. The first press takes it out of the flex flow at its current size and place, then the
// ordinary drag moves it; it stays where it was left for the next open. Idempotent per window.
export function makeFloatable(win, handle) {
  if (!win || !handle || win.dataset.floatable) return;
  win.dataset.floatable = '1';
  handle.style.cursor = 'grab';
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    if (win.style.position !== 'fixed') {
      const r = win.getBoundingClientRect();
      win.style.position = 'fixed'; win.style.margin = '0';
      win.style.width = r.width + 'px'; win.style.left = r.left + 'px'; win.style.top = r.top + 'px';
    }
  }, true);
  makeDraggable(win, handle);
}

// The "how many?" dialog for moving part of a stack (container, corpse). Shared here because
// the container and the corpse panels each carried the same copy.
//
// ⚠ ON A PHONE THE FIELD IS NOT FOCUSED, AND THE COMMON ANSWERS ARE BUTTONS. Focusing the number
// field threw the soft keyboard over the dialog on every stack moved, to type a number that is
// almost always one, half, or all of it. Those are taps now; the field is still there (and still
// takes Enter) for the other answers. A desktop keeps the focus, where it costs nothing.
export function promptQty(max, action) {
  if (max <= 1) return Promise.resolve(max);
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'qty-dialog-overlay';
    const half = Math.max(1, Math.floor(max / 2));
    const picks = [...new Set([1, half, max])];
    overlay.innerHTML = `
      <div class="qty-dialog">
        <div class="qty-dialog-label">How many? (1–${max})</div>
        <div class="qty-dialog-picks">${picks.map(n => `<button type="button" class="qty-dialog-pick" data-n="${n}">${n === max ? `all ${n}` : n}</button>`).join('')}</div>
        <input class="qty-dialog-input" type="number" inputmode="numeric" min="1" max="${max}" value="${max}">
        <div class="qty-dialog-btns">
          <button class="qty-dialog-ok">${action || 'OK'}</button>
          <button class="qty-dialog-cancel">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('.qty-dialog-input');
    if (document.documentElement.dataset.density !== 'compact') {
      input.focus();
      input.select();
    }
    const finish = (qty) => { overlay.remove(); resolve(qty); };
    overlay.querySelector('.qty-dialog-ok').onclick = () => {
      const v = Math.min(max, Math.max(1, parseInt(input.value, 10) || 1));
      finish(v);
    };
    overlay.querySelector('.qty-dialog-cancel').onclick = () => finish(null);
    for (const b of overlay.querySelectorAll('.qty-dialog-pick')) b.onclick = () => finish(Number(b.dataset.n));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') overlay.querySelector('.qty-dialog-ok').click();
      if (e.key === 'Escape') finish(null);
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(null); });
  });
}

function close() {
  _el?.remove();
  _el = null;
}

// msg: { prompt, command, confirmLabel?, title? }
// onConfirm (optional): a client-side callback fired on confirm instead of
// sending `msg.command` down the wire — used by the Tablet's corp screens.
export function showConfirmDialog(msg, onConfirm) {
  close();
  const el = document.createElement('div');
  el.className = 'confirm-window';
  asDialog(el, msg.title || 'Confirm');
  el.innerHTML = `
    <div class="confirm-drag-handle">
      <span class="confirm-title">${msg.title || 'Confirm'}</span>
      <button class="confirm-x" title="Cancel">✕</button>
    </div>
    <div class="confirm-body">
      <p class="confirm-prompt"></p>
      <div class="confirm-actions">
        <button class="confirm-cancel">Cancel</button>
        <button class="confirm-ok">${msg.confirmLabel || 'Confirm'}</button>
      </div>
    </div>`;
  el.querySelector('.confirm-prompt').textContent = msg.prompt || 'Are you sure?';
  document.body.appendChild(el);
  _el = el;

  makeDraggable(el, el.querySelector('.confirm-drag-handle'));
  el.querySelector('.confirm-x').addEventListener('click', close);
  el.querySelector('.confirm-cancel').addEventListener('click', close);
  const go = () => {
    close();
    if (onConfirm) onConfirm();
    else if (msg.command) sendCmd(msg.command, msg.confirmLabel || msg.command);
  };
  const ok = el.querySelector('.confirm-ok');
  // `hold` (from a caller, or on a server { type:'confirm' }) makes OK a hold-to-confirm, and puts
  // the first focus on Cancel, as the danger dialog does: Enter on arrival must not be the answer.
  if (msg.hold) { holdToConfirm(ok, go); el.querySelector('.confirm-cancel').focus(); }
  else { ok.addEventListener('click', go); ok.focus(); }
}

// A high-stakes confirm: red danger banners top and bottom, each with a skull
// and crossbones, and a client-side callback instead of a server command (used
// for the sign-out warning). opts: { title?, prompt?, confirmLabel? }
export function showDangerDialog(opts, onConfirm) {
  close();
  const el = document.createElement('div');
  el.className = 'confirm-window confirm-danger';
  asDialog(el, opts.title || 'Warning');
  el.innerHTML = `
    <div class="confirm-danger-banner">☠ DANGER ☠</div>
    <div class="confirm-drag-handle">
      <span class="confirm-title">${opts.title || 'Warning'}</span>
      <button class="confirm-x" title="Cancel">✕</button>
    </div>
    <div class="confirm-body">
      <p class="confirm-prompt"></p>
      <div class="confirm-actions">
        <button class="confirm-cancel">Cancel</button>
        <button class="confirm-ok confirm-ok-danger">${opts.confirmLabel || 'Confirm'}</button>
      </div>
    </div>
    <div class="confirm-danger-banner">☠ DANGER ☠</div>`;
  el.querySelector('.confirm-prompt').textContent = opts.prompt || 'Are you sure?';
  document.body.appendChild(el);
  _el = el;

  makeDraggable(el, el.querySelector('.confirm-drag-handle'));
  el.querySelector('.confirm-x').addEventListener('click', close);
  el.querySelector('.confirm-cancel').addEventListener('click', close);
  // The danger dialog is always a hold: it exists for the choices that cost you.
  holdToConfirm(el.querySelector('.confirm-ok'), () => { close(); onConfirm(); });
  el.querySelector('.confirm-cancel').focus();
}

// ── HOLD TO CONFIRM ─────────────────────────────────────────────────────────
//
// A confirm window with OK and Cancel is a web page asking. For the things that can't be undone
// (selling an aircraft, dropping everything, signing out where your body is exposed) the button
// wants holding instead: it fills as you hold it, ticks three times on the way, and fires when
// it's full. Let go early and nothing happens, and the button says to hold. Nobody sells an
// aircraft by double-clicking through a dialog.
//
// It never locks anybody out:
//   · keyboard: hold Enter or Space, the same as the pointer.
//   · a screen reader's virtual cursor sends a bare click with no press behind it, and can't
//     hold. A bare click arms the button instead ("Press again to confirm") and a second one
//     within four seconds fires it. The label says both ways.
const HOLD_MS = 900;
export function holdToConfirm(btn, fire) {
  const label = btn.textContent;
  btn.classList.add('confirm-hold');
  btn.innerHTML = '<span class="hold-fill" aria-hidden="true"></span><span class="hold-label"></span>';
  const lab = btn.querySelector('.hold-label');
  lab.textContent = label;
  btn.setAttribute('aria-label', `${label}: press and hold, or press twice`);
  let t0 = 0, raf = 0, ticks = 0, holding = false, fromPointer = false, armedAt = 0;
  const reset = () => { holding = false; cancelAnimationFrame(raf); btn.classList.remove('holding'); btn.style.setProperty('--hold', 0); };
  const done = () => { reset(); btn.style.setProperty('--hold', 1); playUi('ui-confirm'); fire(); };
  const frame = (now) => {
    if (!holding) return;
    const k = Math.min(1, (now - t0) / HOLD_MS);
    btn.style.setProperty('--hold', k);
    const q = Math.floor(k * 3);
    if (q > ticks && q < 3) { ticks = q; playUi('ui-tab', 0.7 + 0.3 * q); }
    if (k >= 1) { done(); return; }
    raf = requestAnimationFrame(frame);
  };
  const start = () => {
    if (holding) return;
    holding = true; ticks = 0; t0 = performance.now();
    btn.classList.add('holding'); lab.textContent = label;
    playUi('ui-tab', 0.6);
    raf = requestAnimationFrame(frame);
  };
  const stop = () => {
    if (!holding) return;
    reset();
    lab.textContent = 'Hold to confirm';
  };
  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    fromPointer = true;
    try { btn.setPointerCapture(e.pointerId); } catch { /* a synthetic event has no pointer to capture */ }
    start();
  });
  btn.addEventListener('pointerup', stop);
  btn.addEventListener('pointercancel', stop);
  btn.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();   // no synthetic click: the hold is the activation
    if (!e.repeat) start();
  });
  btn.addEventListener('keyup', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    stop();
  });
  btn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopImmediatePropagation();
    // The click that ends a pointer press, held or not, is already answered.
    if (fromPointer) { fromPointer = false; return; }
    if (armedAt && performance.now() - armedAt < 4000) { armedAt = 0; done(); return; }
    armedAt = performance.now();
    lab.textContent = 'Press again to confirm';
  });
}

let _promptEl = null;

function closePrompt() {
  _promptEl?.remove();
  _promptEl = null;
}

// Same themed window as showConfirmDialog, but collects free text and hands it
// to a client-side callback — the in-browser replacement for window.prompt()
// (used by the Tablet's corp screens: name a corp, invite a player, etc.).
// opts: { title?, prompt?, placeholder?, value?, confirmLabel? }, onConfirm: (text) => void
export function showPromptDialog(opts, onConfirm) {
  closePrompt();
  const el = document.createElement('div');
  el.className = 'confirm-window';
  asDialog(el, opts.title || 'Enter text');
  el.innerHTML = `
    <div class="confirm-drag-handle">
      <span class="confirm-title">${opts.title || 'Enter text'}</span>
      <button class="confirm-x" title="Cancel">✕</button>
    </div>
    <div class="confirm-body">
      <p class="confirm-prompt"></p>
      <input class="confirm-input" type="text" autocomplete="off">
      <div class="confirm-actions">
        <button class="confirm-cancel">Cancel</button>
        <button class="confirm-ok">${opts.confirmLabel || 'Confirm'}</button>
      </div>
    </div>`;
  el.querySelector('.confirm-prompt').textContent = opts.prompt || '';
  document.body.appendChild(el);
  _promptEl = el;

  const input = el.querySelector('.confirm-input');
  if (opts.placeholder) input.placeholder = opts.placeholder;
  if (opts.value) input.value = opts.value;
  const submit = () => {
    const v = input.value.trim();
    if (!v) return;
    onConfirm(v);
    closePrompt();
  };

  makeDraggable(el, el.querySelector('.confirm-drag-handle'));
  el.querySelector('.confirm-x').addEventListener('click', closePrompt);
  el.querySelector('.confirm-cancel').addEventListener('click', closePrompt);
  el.querySelector('.confirm-ok').addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  input.focus();
}

let _selectEl = null;

function closeSelect() {
  _selectEl?.remove();
  _selectEl = null;
}

// Same themed window, but offers a list of options to pick from (a tap, not
// typing) — used by the Tablet's corp Invite flow to choose from online players.
// opts: { title?, prompt?, options: [string | {label, value}], empty? },
// onSelect: (value) => void
export function showSelectDialog(opts, onSelect) {
  closeSelect();
  const el = document.createElement('div');
  el.className = 'confirm-window';
  asDialog(el, opts.title || 'Choose');
  const options = opts.options || [];
  el.innerHTML = `
    <div class="confirm-drag-handle">
      <span class="confirm-title">${opts.title || 'Choose'}</span>
      <button class="confirm-x" title="Cancel">✕</button>
    </div>
    <div class="confirm-body">
      ${opts.prompt ? `<p class="confirm-prompt"></p>` : ''}
      <div class="confirm-select-list"></div>
      <div class="confirm-actions"><button class="confirm-cancel">Cancel</button></div>
    </div>`;
  if (opts.prompt) el.querySelector('.confirm-prompt').textContent = opts.prompt;
  const list = el.querySelector('.confirm-select-list');
  if (!options.length) {
    const p = document.createElement('p');
    p.className = 'confirm-empty';
    p.textContent = opts.empty || 'Nothing to choose from.';
    list.appendChild(p);
  } else {
    for (const o of options) {
      const b = document.createElement('button');
      b.className = 'confirm-select-opt';
      b.textContent = o.label ?? String(o);
      b.addEventListener('click', () => { closeSelect(); onSelect(o.value ?? o); });
      list.appendChild(b);
    }
  }
  document.body.appendChild(el);
  _selectEl = el;

  makeDraggable(el, el.querySelector('.confirm-drag-handle'));
  el.querySelector('.confirm-x').addEventListener('click', closeSelect);
  el.querySelector('.confirm-cancel').addEventListener('click', closeSelect);
}

let _amountEl = null;

function closeAmount() {
  _amountEl?.remove();
  _amountEl = null;
}

// Same themed window as showConfirmDialog, but collects a number instead of
// firing a fixed command — used wherever we need an amount from the player
// (poker bet/raise) instead of a plain browser prompt().
// opts: { title?, prompt?, confirmLabel?, min?, value? }, onConfirm: (amount) => void
export function showAmountDialog(opts, onConfirm) {
  closeAmount();
  const el = document.createElement('div');
  el.className = 'confirm-window';
  asDialog(el, opts.title || 'Enter amount');
  el.innerHTML = `
    <div class="confirm-drag-handle">
      <span class="confirm-title">${opts.title || 'Enter amount'}</span>
      <button class="confirm-x" title="Cancel">✕</button>
    </div>
    <div class="confirm-body">
      <p class="confirm-prompt"></p>
      <input class="confirm-input" type="number" min="${opts.min ?? 1}" step="1">
      <div class="confirm-actions">
        <button class="confirm-cancel">Cancel</button>
        <button class="confirm-ok">${opts.confirmLabel || 'Confirm'}</button>
      </div>
    </div>`;
  el.querySelector('.confirm-prompt').textContent = opts.prompt || 'How much?';
  document.body.appendChild(el);
  _amountEl = el;

  const input = el.querySelector('.confirm-input');
  // Prefill (e.g. the poker minimum bet) so the player only edits up from it.
  if (opts.value != null) input.value = opts.value;
  const submit = () => {
    const n = parseInt(input.value, 10);
    if (!n || n < (opts.min ?? 1)) return;
    onConfirm(n);
    closeAmount();
  };

  makeDraggable(el, el.querySelector('.confirm-drag-handle'));
  el.querySelector('.confirm-x').addEventListener('click', closeAmount);
  el.querySelector('.confirm-cancel').addEventListener('click', closeAmount);
  el.querySelector('.confirm-ok').addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  input.focus();
  input.select();
}
