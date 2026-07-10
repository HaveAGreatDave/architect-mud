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
// onConfirm (optional): a client-side callback fired on confirm instead of
// sending `msg.command` down the wire — used by the Tablet's corp screens.
export function showConfirmDialog(msg, onConfirm) {
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
    close();
    if (onConfirm) onConfirm();
    else if (msg.command) sendCmd(msg.command, msg.confirmLabel || msg.command);
  });
  el.querySelector('.confirm-ok').focus();
}

// A high-stakes confirm: red danger banners top and bottom, each with a skull
// and crossbones, and a client-side callback instead of a server command (used
// for the sign-out warning). opts: { title?, prompt?, confirmLabel? }
export function showDangerDialog(opts, onConfirm) {
  close();
  const el = document.createElement('div');
  el.className = 'confirm-window confirm-danger';
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
  el.querySelector('.confirm-ok').addEventListener('click', () => { close(); onConfirm(); });
  el.querySelector('.confirm-cancel').focus();
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
