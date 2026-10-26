// THE PURCHASE MOMENT: what a counter does when you've just paid for something.
//
// The till (`ui-purchase`), a sweep of light across the panel, the label of what you bought and
// its price stamped over the work, and the balance counting from what it was to what it is. It
// started in the vehicle depots (depot-shell.js) and lives here so any counter can answer a
// purchase the same way: the depots, the shop counter (dialogue.js) and, tick only, the header
// balance (render.js).
//
// ⚠ NOTHING HERE KNOWS WHAT WAS BOUGHT. A caller says what was pressed (`noteAct`) and, when the
// server's answer shows fewer credits, calls `celebrate` with the amount and `takeAct()`. A drop
// in credits is not always a purchase (a deposit, a fine, a mugging), so only a caller that knows
// the drop answered a purchase may call `celebrate`. The header only ever ticks.
//
// Styles are in styles.css under "The purchase moment", so a counter in the core client and a
// lazy depot get the same sheet.

import { playUi } from '../ui-sound.js';
import { escapeHtml as esc } from '../../../shared/dom.js';

/** The one money format: the glyph first, thousands separated. The log prints credits this way. */
export const money = (n) => `₵${Math.round(Number(n) || 0).toLocaleString()}`;

export const motionOff = () => document.documentElement.dataset.motion === 'off'
  || document.body?.dataset?.motion === 'off'
  || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// What was pressed last, so the stamp can name it when the push comes back. Kept for 8 seconds:
// a server slower than that is answering something else.
let lastAct = null;     // { label, at }
/** A button (its hold label or text is the name) or a label string. */
export function noteAct(btnOrLabel) {
  const raw = typeof btnOrLabel === 'string'
    ? btnOrLabel
    : (btnOrLabel?.querySelector?.('.hold-label')?.textContent || btnOrLabel?.textContent || '');
  const label = raw.replace(/\s+/g, ' ').trim();
  lastAct = label ? { label, at: performance.now() } : null;
}
/** The label `noteAct` left, if it's recent, and forget it. */
export function takeAct() {
  const act = lastAct && performance.now() - lastAct.at < 8000 ? lastAct.label : '';
  lastAct = null;
  return act;
}

/**
 * The balance counts from what it was to what it is, the way a garage menu's does, and carries
 * `spend` or `earn` while it moves. A second tick on the same element takes over from the first,
 * so two pushes close together end on the newer number. `fmt` formats each frame.
 */
export function tickCredits(el, from, to, fmt = money) {
  if (!el) return;
  const token = (el._pmTick = (el._pmTick || 0) + 1);
  el.classList.remove('spend', 'earn');
  if (motionOff() || from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now(), ms = Math.min(900, 300 + Math.abs(to - from) * 0.4);
  el.classList.add(to < from ? 'spend' : 'earn');
  const step = (now) => {
    if (!el.isConnected || el._pmTick !== token) return;
    const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
    else setTimeout(() => { if (el._pmTick === token) el.classList.remove('spend', 'earn'); }, 400);
  };
  requestAnimationFrame(step);
}

/**
 * The till, the sweep and the stamp over `root`, which must be positioned (relative or absolute)
 * and outlive a re-render for 2 seconds. `label` may be empty: the price alone is still news.
 */
export function celebrate(root, { amount = 0, label = '' } = {}) {
  if (!root) return;
  playUi('ui-purchase');
  root.querySelector(':scope > .pm-stamp')?.remove();
  const s = document.createElement('div');
  s.className = 'pm-stamp';
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `${label ? `<b>${esc(label)}</b>` : ''}<span>−${money(amount)}</span>`;
  root.appendChild(s);
  root.classList.remove('pm-sheen');
  void root.offsetWidth;   // restart the sweep if two purchases land close together
  root.classList.add('pm-sheen');
  setTimeout(() => { s.remove(); root.classList.remove('pm-sheen'); }, motionOff() ? 1600 : 2200);
}
