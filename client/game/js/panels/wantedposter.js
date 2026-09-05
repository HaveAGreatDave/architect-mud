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

let styled = false;
function ensureStyles() {
  if (styled) return;
  styled = true;
  const el = document.createElement('style');
  el.textContent = `
  #wanted-poster-overlay {
    position: fixed; inset: 0; z-index: 9400;
    display: flex; align-items: center; justify-content: center;
    background: radial-gradient(ellipse at center, rgba(0,0,0,.55), rgba(0,0,0,.86));
    backdrop-filter: blur(2px);
  }
  #wanted-poster-overlay .wp-sheet {
    position: relative;
    /* Paper, not a panel: warm off-white with the blotch of cheap thermal stock.
       Both themes get the SAME paper — a WANTED poster that politely turns dark
       grey in dark mode is a UI element pretending to be an object. */
    background:
      radial-gradient(circle at 22% 18%, rgba(120,90,40,.10), transparent 42%),
      radial-gradient(circle at 78% 82%, rgba(120,90,40,.13), transparent 46%),
      linear-gradient(178deg, #efe6d2, #e2d6bd 60%, #d8caae);
    color: #241d13;
    padding: 1.9rem 2.1rem 1.5rem;
    max-width: min(34rem, 92vw); max-height: 88vh; overflow: auto;
    box-shadow: 0 1.4rem 3rem rgba(0,0,0,.7), inset 0 0 4rem rgba(90,60,20,.18);
    /* The torn/creased edge. A clip-path rather than an image so it costs nothing
       and survives any size the type scale asks for. */
    clip-path: polygon(0 1%, 4% 0, 22% 1.2%, 47% 0.2%, 73% 1.4%, 96% 0.1%, 100% 1.6%,
                       99.2% 30%, 100% 62%, 99% 99%, 74% 98.6%, 51% 100%, 27% 98.4%,
                       3% 99.6%, 0.6% 70%, 1.2% 34%);
    transform-origin: 50% 0;
  }
  #wanted-poster-overlay .wp-sheet.wp-drop { animation: wp-slam .5s cubic-bezier(.2,1.5,.4,1) both, wp-sway 5.5s ease-in-out 0.5s infinite; }
  @keyframes wp-slam {
    0%   { transform: translateY(-46vh) rotate(-7deg) scale(1.08); opacity: 0; }
    70%  { transform: translateY(0) rotate(1.4deg) scale(1); opacity: 1; }
    100% { transform: translateY(0) rotate(-.5deg) scale(1); opacity: 1; }
  }
  /* It hangs off two staples, so it never quite settles. */
  @keyframes wp-sway {
    0%,100% { transform: rotate(-.5deg); }
    50%     { transform: rotate(.45deg); }
  }
  /* The staples. Pseudo-elements, so a screen reader never meets them. */
  #wanted-poster-overlay .wp-sheet::before,
  #wanted-poster-overlay .wp-sheet::after {
    content: ''; position: absolute; top: .85rem; width: .78rem; height: .2rem;
    background: linear-gradient(#e8e8ea, #8d8f96 60%, #55575d);
    box-shadow: 0 .12rem .18rem rgba(0,0,0,.45);
    transform: rotate(-6deg);
  }
  #wanted-poster-overlay .wp-sheet::before { left: 14%; }
  #wanted-poster-overlay .wp-sheet::after  { right: 14%; transform: rotate(5deg); }

  #wanted-poster-overlay .wp-kicker { text-align: center; font-size: .68rem; letter-spacing: .42em; text-transform: uppercase; color: #6a5334; }
  #wanted-poster-overlay .wp-word {
    text-align: center; font-size: 2.9rem; line-height: 1; letter-spacing: .18em;
    font-weight: 800; margin: .25rem 0 .1rem; color: #17120b;
    text-shadow: 0 .08rem 0 rgba(255,255,255,.35);
  }
  #wanted-poster-overlay .wp-sub { text-align: center; font-size: .72rem; letter-spacing: .3em; text-transform: uppercase; color: #6a5334; }
  #wanted-poster-overlay .wp-rule { border: 0; border-top: 2px solid #2b2318; opacity: .5; margin: .85rem 0; }
  #wanted-poster-overlay .wp-name {
    text-align: center; font-size: 1.85rem; line-height: 1.1; font-weight: 800;
    letter-spacing: .06em; word-break: break-word; margin: .2rem 0;
  }
  #wanted-poster-overlay .wp-reward { text-align: center; margin: .6rem 0 .2rem; }
  #wanted-poster-overlay .wp-reward b { display: block; font-size: 2.15rem; line-height: 1.05; letter-spacing: .04em; }
  #wanted-poster-overlay .wp-band { font-size: .78rem; font-style: italic; color: #5c4830; }
  #wanted-poster-overlay .wp-charge {
    text-align: center; font-size: .86rem; line-height: 1.5; letter-spacing: .04em;
    margin: .7rem .4rem; color: #2b2318;
  }
  #wanted-poster-overlay .wp-terms { font-size: .74rem; line-height: 1.75; color: #4a3b26; margin-top: .6rem; }
  #wanted-poster-overlay .wp-terms span { display: inline-block; min-width: 6.5rem; letter-spacing: .16em; text-transform: uppercase; color: #7a6039; }
  #wanted-poster-overlay .wp-stamp {
    position: absolute; right: 1.4rem; bottom: 3.1rem;
    border: .22rem solid #8d1f1f; color: #8d1f1f; opacity: .72;
    padding: .18rem .55rem; font-size: .92rem; font-weight: 800; letter-spacing: .18em;
    transform: rotate(-13deg); border-radius: .2rem;
  }
  #wanted-poster-overlay .wp-you {
    text-align: center; margin-top: .8rem; padding: .35rem;
    border: 2px dashed #8d1f1f; color: #8d1f1f; font-size: .8rem; letter-spacing: .1em;
  }
  #wanted-poster-overlay .wp-close {
    position: absolute; top: .5rem; right: .6rem;
    background: none; border: 0; color: #6a5334; cursor: pointer;
    font: inherit; font-size: 1.15rem; line-height: 1; padding: .3rem .45rem;
  }
  #wanted-poster-overlay .wp-close:hover { color: #17120b; }
  @media (prefers-reduced-motion: reduce) {
    #wanted-poster-overlay .wp-sheet.wp-drop { animation: none; }
  }`;
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
