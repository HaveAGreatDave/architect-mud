// Generic in-browser confirmation dialog, driven by a server { type:'confirm' }
// message. Moveable (drag by the header). Confirming sends the server-supplied
// command back down the wire; cancelling just closes.
import { sendCmd } from '../net.js';

let _el = null;

function makeDraggable(win, handle) {
  let ox = 0, oy = 0;
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
}

function close() {
  _el?.remove();
  _el = null;
}

// msg: { prompt, command, confirmLabel?, title? }
export function showConfirmDialog(msg) {
  close();
  const el = document.createElement('div');
  el.className = 'confirm-window';
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
  el.querySelector('.confirm-ok').addEventListener('click', () => {
    if (msg.command) sendCmd(msg.command, msg.confirmLabel || msg.command);
    close();
  });
  el.querySelector('.confirm-ok').focus();
}

let _amountEl = null;

function closeAmount() {
  _amountEl?.remove();
  _amountEl = null;
}

// Same themed window as showConfirmDialog, but collects a number instead of
// firing a fixed command — used wherever we need an amount from the player
// (poker bet/raise) instead of a plain browser prompt().
// opts: { title?, prompt?, confirmLabel?, min? }, onConfirm: (amount) => void
export function showAmountDialog(opts, onConfirm) {
  closeAmount();
  const el = document.createElement('div');
  el.className = 'confirm-window';
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
}
