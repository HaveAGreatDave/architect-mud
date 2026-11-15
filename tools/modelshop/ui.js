// The editor page's chrome, apart from app.js, which owns what the page shows: the rail's folding
// sections, the rail's width, the view bar's readouts, what this page offers the navigation bar
// (nav.js: its shortcuts and its Go to actions), and the question before you leave with edits
// unsaved. Nothing here draws the model or changes it; every action is a click on a control
// app.js already wires.

import { unsavedFiles } from './editor.js';
import { meshUnsaved } from './mesh-editor.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem('ms.ui.' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('ms.ui.' + k, v); } catch { /* private window */ } },
};

// ── the rail's sections fold by their heading, and the fold is remembered ──────
const shut = new Set((store.get('shut') || '').split(',').filter(Boolean));
for (const sec of document.querySelectorAll('#rail section[data-fold]')) {
  const id = sec.dataset.fold;
  sec.classList.toggle('shut', shut.has(id));
  const h = sec.querySelector(':scope > h2');
  h.setAttribute('role', 'button');
  h.tabIndex = 0;
  const flip = () => {
    sec.classList.toggle('shut');
    if (sec.classList.contains('shut')) shut.add(id); else shut.delete(id);
    h.setAttribute('aria-expanded', String(!sec.classList.contains('shut')));
    store.set('shut', [...shut].join(','));
  };
  h.setAttribute('aria-expanded', String(!sec.classList.contains('shut')));
  h.addEventListener('click', flip);
  h.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); flip(); } });
}

// ── a section with nothing to say about this subject isn't shown ───────────────
// A vehicle or an animal has no cage, no checks and nothing to compare; app.js empties those
// hosts for them, so a section is shown exactly when the host it names has something in it.
const checkBadge = () => {
  const host = $('checks'), badge = $('checkbadge');
  if (!host || !badge) return;
  const n = host.querySelectorAll('.warn, .err').length;
  const text = !host.childElementCount ? '' : n ? n + ' to look at' : 'all clear';
  // only on a change: the badge is inside the rail this observer watches
  if (badge.textContent !== text) badge.textContent = text;
  badge.classList.toggle('ok', !!host.childElementCount && !n);
};
const showWhen = () => {
  for (const sec of document.querySelectorAll('[data-show-when]')) {
    const host = $(sec.dataset.showWhen);
    sec.hidden = !host || !host.childElementCount;
  }
  checkBadge();
};
new MutationObserver(showWhen).observe($('rail'), { childList: true, subtree: true });
showWhen();

// ── the rail's width, by its left edge ─────────────────────────────────────────
const RAIL_MIN = 280, RAIL_DEFAULT = 340;
const setRail = (w) => {
  const max = Math.max(RAIL_MIN, Math.round(innerWidth * 0.6));
  const px = Math.min(max, Math.max(RAIL_MIN, Math.round(w)));
  document.documentElement.style.setProperty('--ms-rail-w', px + 'px');
  return px;
};
setRail(Number(store.get('railw')) || RAIL_DEFAULT);
{
  const grip = $('railgrip');
  let drag = null, raf = 0;
  // the viewport sizes its canvas when it draws, and app.js redraws on resize
  const repaint = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => dispatchEvent(new Event('resize'))); };
  grip.addEventListener('mousedown', (ev) => {
    ev.preventDefault();
    drag = { x: ev.clientX, w: $('rail').getBoundingClientRect().width };
    grip.classList.add('drag');
    document.body.style.cursor = 'col-resize';
  });
  addEventListener('mousemove', (ev) => {
    if (!drag) return;
    setRail(drag.w + (drag.x - ev.clientX));
    repaint();
  });
  addEventListener('mouseup', () => {
    if (!drag) return;
    drag = null;
    grip.classList.remove('drag');
    document.body.style.cursor = '';
    store.set('railw', String(Math.round($('rail').getBoundingClientRect().width)));
  });
  grip.addEventListener('dblclick', () => { store.set('railw', String(setRail(RAIL_DEFAULT))); repaint(); });
}

// ── the view bar's sliders say their value ─────────────────────────────────────
const FORMAT = { night: (v) => Number(v).toFixed(2) };
const readouts = () => {
  for (const out of document.querySelectorAll('#bar output[data-for]')) {
    const inp = $(out.dataset.for);
    if (inp) out.textContent = (FORMAT[inp.id] || String)(inp.value);
  }
};
$('bar').addEventListener('input', readouts);
// The bar wraps on a narrow window; the viewport's status line sits just above it whatever its height.
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--ms-bar-h', $('bar').offsetHeight + 'px');
}).observe($('bar'));
// app.js moves the floors slider itself when a model comes in, which fires no event; a new model
// always changes the name in the toolbar, so that is when to look again.
new MutationObserver(readouts).observe($('modelname'), { childList: true, characterData: true, subtree: true });
readouts();

// ── what this page offers the navigation bar ───────────────────────────────────
const click = (id) => () => $(id)?.click();
window.msNav?.shortcuts([
  { group: 'Viewport', keys: ['Middle-drag'], does: 'orbit, locked on the model' },
  { group: 'Viewport', keys: ['Shift', 'Middle-drag'], does: 'pan (or right-drag)' },
  { group: 'Viewport', keys: ['Wheel'], does: 'zoom' },
  { group: 'Viewport', keys: ['F'], does: 'frame the model' },
  { group: 'Viewport', keys: ['B'], does: 'grey sky' },
  { group: 'Viewport', keys: ['2'], does: 'GLASS 2' },
  { group: 'Pieces', keys: ['Click'], does: 'select a piece' },
  { group: 'Pieces', keys: ['Alt', 'Click'], does: 'the piece behind it' },
  { group: 'Pieces', keys: ['G'], does: 'move' },
  { group: 'Pieces', keys: ['S'], does: 'scale' },
  { group: 'Pieces', keys: ['R'], does: 'rotate' },
  { group: 'Pieces', keys: ['Shift', 'Drag'], does: 'the vertical of the transform' },
  { group: 'Pieces', keys: ['D'], does: 'duplicate' },
  { group: 'Pieces', keys: ['Del'], does: 'remove' },
  { group: 'Pieces', keys: ['Esc'], does: 'deselect' },
  { group: 'File', keys: ['O'], does: 'open a model' },
  { group: 'File', keys: ['Ctrl', 'S'], does: 'save' },
  { group: 'File', keys: ['Ctrl', 'Z'], does: 'undo' },
  { group: 'File', keys: ['Ctrl', 'Shift', 'Z'], does: 'redo (or Ctrl+Y)' },
  { group: 'Panels', keys: ['T'], does: 'the tool palette' },
]);
window.msNav?.actions([
  { name: 'Open a model…', hint: 'O', sub: 'the model browser', run: click('open') },
  { name: 'Frame the model', hint: 'F', run: click('frame') },
  { name: 'Move', hint: 'G', sub: 'what a drag on a piece does', run: click('mode-move') },
  { name: 'Scale', hint: 'S', sub: 'what a drag on a piece does', run: click('mode-scale') },
  { name: 'Rotate', hint: 'R', sub: 'what a drag on a piece does', run: click('mode-rotate') },
  { name: 'Tool palette', hint: 'T', sub: 'show or hide it', run: click('tools-open') },
  { name: 'Camera: cockpit', sub: 'the eye a pilot has', run: click('preset-cockpit') },
  { name: 'Camera: cab', sub: 'the eye a driver has', run: click('preset-cab') },
  { name: 'Cage', sub: 'what the cold open draws', run: click('wire') },
  { name: 'Grey sky', hint: 'B', run: click('grey') },
  { name: 'Spin', sub: 'turntable', run: click('spin') },
  { name: 'GLASS 2', hint: '2', sub: "the game's own frame", run: click('g2') },
  { name: 'GL spike', sub: 'the WebGL2 spike', run: click('gl') },
]);

// ── don't leave with edits unsaved ─────────────────────────────────────────────
// Every page's tabs now open in this tab, so a slip of the mouse would otherwise throw work away.
addEventListener('beforeunload', (ev) => {
  let files = [];
  try { files = [...unsavedFiles(), ...meshUnsaved()]; } catch { /* nothing to lose */ }
  if (!files.length) return;
  ev.preventDefault();
  ev.returnValue = '';
});
