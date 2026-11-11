// THE SEAT LADDER: how much of the page a view in #area-pane takes.
//
// ◧ hides the sidebar, ⊟ folds the scrollback and keeps the command box, ⛶ folds both, ⤢ is big
// screen (bigscreen.js). ⊟ and ⛶ are the body classes `seat-hidepanel` and `seat-fullscreen`,
// laid out once in styles.css; a seat's own stylesheet adds what its root does under them
// (`body.seat-fullscreen .cab-wrap`). One view is up at a time, so the classes are the page's, and
// closing the view takes them down.
//
// Every seat uses this: the flight sim and the charter cabin (cockpit.js), the cab, the boat, the
// podracer, free look and the Room Stage. A seat that draws its own buttons hands them to
// `bindSeatRungs`; one that doesn't puts `seatLadderHTML` in its bar and calls `bindSeatLadder`.

import { bindBigScreenButton, exitBigScreen, setSidebarHidden, bindSidebarButton,
  BIGSCREEN_GLYPH, BIGSCREEN_TITLE, SIDEBAR_GLYPH, SIDEBAR_TITLE } from './bigscreen.js';

export const SEAT_HIDE = 'seat-hidepanel', SEAT_FULL = 'seat-fullscreen';

// The four buttons, each with `cls` plus its own class (seat-side, seat-hide, seat-fs, seat-big).
export function seatLadderHTML(cls) {
  return `<button class="${cls} seat-side" type="button" title="${SIDEBAR_TITLE}">${SIDEBAR_GLYPH}</button>`
    + `<button class="${cls} seat-hide" type="button" title="hide the text panel, more picture">⊟</button>`
    + `<button class="${cls} seat-fs" type="button" title="fullscreen, the log and the command box too">⛶</button>`
    + `<button class="${cls} seat-big" type="button" title="${BIGSCREEN_TITLE}">${BIGSCREEN_GLYPH}</button>`;
}

// ⊟ and ⛶ on the seat's own buttons (either may be missing). The two exclude each other. Opens on
// `start`: 'hide' (⊟, every seat's default: the view is the point, the command box one key away),
// 'full' (⛶) or 'none'. `stop` keeps a click from reaching a seat that listens on its root.
export function bindSeatRungs({ hide, fs, start = 'hide', stop = false } = {}) {
  const set = (which) => {
    const b = document.body.classList;
    b.toggle(SEAT_HIDE, which === 'hide'); b.toggle(SEAT_FULL, which === 'full');
    hide?.classList.toggle('on', which === 'hide');
    fs?.classList.toggle('on', which === 'full');
  };
  hide?.addEventListener('click', (e) => { if (stop) e.stopPropagation(); set(document.body.classList.contains(SEAT_HIDE) ? 'none' : 'hide'); });
  fs?.addEventListener('click', (e) => { if (stop) e.stopPropagation(); set(document.body.classList.contains(SEAT_FULL) ? 'none' : 'full'); });
  set(start);
  return set;
}

// The whole ladder from `seatLadderHTML`'s buttons under `root`, and the pane claimed (a phone
// keeps #area-pane shut until a view says it owns it).
export function bindSeatLadder(root, { start = 'hide' } = {}) {
  // one view handing the pane to the next (keepSeatRung): the page stays laid out as it was
  if (kept && performance.now() - kept.t < KEEP_MS) start = kept.which;
  kept = null;
  window.dispatchEvent(new Event('pane:claimed'));
  bindBigScreenButton(root.querySelector('.seat-big'));
  bindSidebarButton(root.querySelector('.seat-side'));
  return bindSeatRungs({ hide: root.querySelector('.seat-hide'), fs: root.querySelector('.seat-fs'), start });
}

// A view that's about to hand the pane to another (the Room Stage to the street outside its door, and
// back) calls this instead of releaseSeatLadder: the rung stays on the page, and the next
// bindSeatLadder within KEEP_MS opens on it. The caller releases the ladder itself if nothing comes.
const KEEP_MS = 4000;
let kept = null;
export function keepSeatRung() {
  const b = document.body.classList;
  kept = { which: b.contains(SEAT_FULL) ? 'full' : b.contains(SEAT_HIDE) ? 'hide' : 'none', t: performance.now() };
}

// ⊟ and ⛶ off, and big screen with them. A seat that hides the sidebar uses releaseSeatLadder.
export function clearSeatRungs() {
  document.body.classList.remove(SEAT_HIDE, SEAT_FULL);
  exitBigScreen();
}

// Gives the whole page back and releases the pane: bindSeatLadder's undo.
export function releaseSeatLadder() {
  clearSeatRungs();
  setSidebarHidden(false);
  window.dispatchEvent(new Event('pane:released'));
}
