// THE FOOT DOCK: your pack and your tablet, on foot in 3D. The same two buttons, in the same corner, on the same keys,
// in a room (room-stage.js, the Room Stage and the Building Stage) and out on the street (freelook-view.js on foot),
// so walking out of a door doesn't move where your hands go.
//
//   · Pack, or I: what you carry and wear (room-pack.js). P opens it on what you can eat and drink.
//   · the tablet, or T: the `tablet` verb, the same tablet the text game opens.
//
// It holds no logic of its own: each view says what opening the pack and the tablet means there.
//
//   footDockHTML()                       the markup, for the view's own template
//   bindFootDock(root, { pack, tablet }) → { key(e), setPack(open), hidden(on) }
//     pack(tab)   open or shut the pack; tab is 'eat' for P, or undefined for I and the button
//     tablet()    open the tablet
//     key(e)      a keydown: true if it was one of the dock's, which the view then swallows
//     setPack     the Pack button shows as pressed while the pack is open

import { loadCss } from '../../../shared/dom.js';

// (both views that import it are lazy, so the sheet is in before either draws)
const DOCK_CSS = await loadCss(new URL('./foot-dock.css', import.meta.url));
function ensureStyles() {
  if (document.getElementById('foot-dock-css')) return;
  const s = document.createElement('style'); s.id = 'foot-dock-css'; s.textContent = DOCK_CSS; document.head.appendChild(s);
}

const TABLET_ICO = '<svg class="fd-ico" viewBox="0 0 24 32" aria-hidden="true"><rect x="1.5" y="1.5" width="21" height="29" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><rect x="4.5" y="5" width="15" height="20" rx="1" fill="currentColor" opacity="0.35"/><rect x="7" y="8" width="4" height="4" rx="1" fill="currentColor"/><rect x="13" y="8" width="4" height="4" rx="1" fill="currentColor"/><rect x="7" y="14" width="4" height="4" rx="1" fill="currentColor"/><rect x="13" y="14" width="4" height="4" rx="1" fill="currentColor"/><circle cx="12" cy="27.8" r="1.3" fill="currentColor"/></svg>';

export function footDockHTML() {
  return '<div class="foot-dock">'
    + '<button type="button" class="fd-pack" title="Your pack: what you carry and what you\'re wearing, to dress, undress, eat and drink (I, or P for food and drink)" aria-label="Your pack" aria-expanded="false">Pack<kbd>I</kbd></button>'
    + `<button type="button" class="fd-tablet" title="Open your tablet (T)" aria-label="Open your tablet">${TABLET_ICO}<kbd>T</kbd></button>`
    + '</div>';
}

const plain = (e) => !e.ctrlKey && !e.metaKey && !e.altKey;

export function bindFootDock(root, { pack, tablet }) {
  ensureStyles();
  const dock = root.querySelector('.foot-dock');
  const packBtn = dock.querySelector('.fd-pack'), tabBtn = dock.querySelector('.fd-tablet');
  // a press on the dock is the dock's: the view under it doesn't start a drag-to-look
  for (const b of [packBtn, tabBtn]) b.addEventListener('pointerdown', (e) => e.stopPropagation());
  packBtn.addEventListener('click', (e) => { e.currentTarget.blur(); pack(); });
  tabBtn.addEventListener('click', (e) => { e.currentTarget.blur(); tablet(); });
  return {
    key(e) {
      const k = e.key;
      if (!plain(e)) return false;
      if (k === 't' || k === 'T') { if (!e.repeat) tablet(); return true; }
      if (k === 'p' || k === 'P') { if (!e.repeat) pack('eat'); return true; }
      if (k === 'i' || k === 'I') { if (!e.repeat) pack(); return true; }
      return false;
    },
    setPack(open) { packBtn.setAttribute('aria-expanded', String(!!open)); },
    hidden(on) { dock.hidden = !!on; },
  };
}
