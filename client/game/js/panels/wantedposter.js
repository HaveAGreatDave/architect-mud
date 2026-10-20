// WANTED POSTER — the sheet, on paper.
//
// THE RULE: this panel decides NOTHING and says nothing the log has not already
// been told. The server (plugins/bounty/poster.js) builds the sheet as
// characters and sends both the rendered block AND the fields; the block is
// appended to the log on every rung, and this overlay is the same information
// with paper under it. Close it, never open it, or run at the `log` rung where
// it is suppressed outright, and you have lost the texture and nothing else.
//
// That is why it is allowed to be theatrical. A panel carrying information the
// log doesn't have would have to be sober and complete; this one only has to
// feel like somebody nailed a piece of paper to a wall.
//
// Accessibility, deliberately:
//   • aria-hidden on the whole overlay. The record is in the log, which is the
//     one live region (docs/systems-display-mode.md), and announcing the poster
//     twice is worse than announcing it once.
//   • The close button is NOT aria-hidden and is the first focusable thing, so
//     the shared focus observer (a11y-focus.js) has something to trap onto and
//     Escape has something real to click.
//   • Every size is rem, so the Font Size setting reaches the poster. A poster
//     you cannot enlarge is a poster for people who did not need help.
//   • prefersReducedMotion kills the slam, the sway and the dust. The sheet
//     still arrives; it just stops flying.
//   • The reward is a numeral AND a band word from the server. Never colour alone.
import { mountOverlay } from './minigame-common.js';
import { prefersReducedMotion } from '/shared/settings.js';
import { loadCss } from '../../../shared/dom.js';

// wantedposter.css ships beside this file and is fetched when the module loads, so ensureStyles
// still applies it synchronously on first open. See loadCss in client/shared/dom.js.
const POSTER_CSS = await loadCss(new URL('./wantedposter.css', import.meta.url));

let styled = false;
function ensureStyles() {
  if (styled) return;
  styled = true;
  const el = document.createElement('style');
  el.textContent = POSTER_CSS;
  document.head.appendChild(el);
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function openWantedPoster(msg) {
  const p = msg?.poster;
  if (!p) return;
  ensureStyles();
  const still = prefersReducedMotion();

  // `status` is a WORD on the stamp, never a colour on the border — the sheet
  // has to survive being read by somebody who doesn't separate red from brown.
  const stamp = p.status && p.status !== 'open'
    ? `<div class="wp-stamp">${esc(p.status.toUpperCase())}</div>` : '';

  const html = `
  <div class="wp-sheet ${still ? '' : 'wp-drop'}">
    <button class="wp-close" aria-label="Close the poster">✕</button>
    <div aria-hidden="true">
      <div class="wp-kicker">by private contract</div>
      <div class="wp-word">WANTED</div>
      <div class="wp-sub">alive isn't required</div>
      <hr class="wp-rule">
      <div class="wp-name">${esc(p.target).toUpperCase()}</div>
      <hr class="wp-rule">
      <div class="wp-reward">
        <b>${esc(p.reward)}</b>
        <span class="wp-band">${esc(p.band)}</span>
      </div>
      <div class="wp-charge">${esc(p.charge)}</div>
      <hr class="wp-rule">
      <div class="wp-terms">
        <div><span>Posted by</span>${esc(p.backer)}</div>
        <div><span>Terms</span>head in hand, at a board</div>
        <div><span>Closes</span>${esc(p.deadline)}</div>
      </div>
      ${p.isTarget ? `<div class="wp-you">THIS ONE IS YOU</div>` : ''}
      ${stamp}
    </div>
  </div>`;

  const { overlay, close } = mountOverlay({ id: 'wanted-poster-overlay', html });
  // NOT aria-hidden on the overlay itself: it contains a focusable control, and
  // aria-hidden wrapped around something you can Tab to is the worst of both —
  // reachable and unannounced. The DECORATIVE half carries aria-hidden (it is a
  // duplicate of what is already in the log), and the dialog keeps a name so the
  // close button has a container that makes sense when you land on it.
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', `Wanted poster for ${p.target}. The full text is in the game log.`);
  const btn = overlay.querySelector('.wp-close');
  if (btn) {
    btn.addEventListener('click', close);
    btn.focus({ preventScroll: true });
  }
  return close;
}
