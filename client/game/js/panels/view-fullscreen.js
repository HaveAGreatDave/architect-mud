// A fullscreen button for a sports view (Deadball's park, the CPhL's rink).
//
// The view puts it on its picture, and it takes the view's own host fullscreen: the TV's
// sub-screen in the game, the tablet's, or the demo page's box, whichever mounted it. Esc or the
// button again comes back. A browser that can't take an element fullscreen (an iPhone) gets no
// button. The look is `.view-fs` in styles.css.

const ICON_ON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
const ICON_OFF = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6 2v4H2M14 6h-4V2M10 14v-4h4M2 10h4v4" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';

const isFull = (host) => host.ownerDocument?.fullscreenElement === host;

function paint(btn, host) {
  const on = isFull(host);
  btn.innerHTML = on ? ICON_OFF : ICON_ON;
  btn.title = on ? 'Leave full screen (Esc)' : 'Full screen';
  btn.setAttribute('aria-label', btn.title);
  btn.setAttribute('aria-pressed', String(on));
}

// Adds the button to `into` (the picture's box) for `host`. Returns it, or null where there's no
// fullscreen to be had.
export function addFullscreenButton(into, host) {
  const doc = host?.ownerDocument;
  if (!into || !doc?.fullscreenEnabled || typeof host.requestFullscreen !== 'function') return null;
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = 'view-fs';
  paint(btn, host);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isFull(host)) doc.exitFullscreen?.().catch(() => {});
    else host.requestFullscreen().catch(() => {});
  });
  // the view rebuilds its page on a fresh mount, so the listener goes when the button does
  const sync = () => { if (!btn.isConnected) doc.removeEventListener('fullscreenchange', sync); else paint(btn, host); };
  doc.addEventListener('fullscreenchange', sync);
  into.appendChild(btn);
  return btn;
}

// Leaves fullscreen if `host` has it: a view clearing itself doesn't leave an empty box filling
// the screen.
export function leaveFullscreen(host) {
  if (host && isFull(host)) host.ownerDocument.exitFullscreen?.().catch(() => {});
}
