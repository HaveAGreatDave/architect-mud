// HOLD TO CONFIRM, on its own so a panel can use it without the confirm windows (and net.js
// with them). confirm.js re-exports it.

import { playUi } from '../ui-sound.js';

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
