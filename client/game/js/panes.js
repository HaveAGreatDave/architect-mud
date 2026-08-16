// Output panes — the useful half of "split windows".
//
// Other clients let you route some output to a second window: chat in one pane,
// combat in the main log. The OTHER half of that feature — a fixed input area so
// incoming text does not shove what you are typing off the screen — is a
// terminal-era problem this client never had, because `#cmd-input` is a DOM
// element that does not scroll. So only the routing half is built.
//
// A pane is a small floating window with a name. Routing rules (automation.js,
// the `route` verb) decide what goes in one; this file only knows how to hold
// lines and be moved around.
//
// ⚠ Panes are DERIVED, never authored. There is no "create a pane" command: a
// pane exists because a routing rule names it, and disappears when no rule does.
// A separate lifecycle would mean two things to keep in step and a way to have an
// empty pane nobody can explain.
const POS_KEY = 'architect_pane_pos';
const MAX_LINES = 400;   // per pane; the main log keeps the long scrollback

const _panes = new Map();   // name → { el, body }

function loadPos() {
  try { return JSON.parse(localStorage.getItem(POS_KEY) || '{}') || {}; } catch { return {}; }
}

function savePos(name, pos) {
  const all = loadPos();
  all[name] = pos;
  try { localStorage.setItem(POS_KEY, JSON.stringify(all)); } catch { /* quota */ }
}

// Drag by the title bar. Deliberately not a library and not the devpanel's
// `dp-float-drag`: that lives in the dev panel's own stylesheet and script, which
// the game client does not load.
function makeDraggable(el, bar, name) {
  let startX = 0, startY = 0, baseX = 0, baseY = 0, dragging = false;
  const down = (e) => {
    if (e.target.closest('.pane-x')) return;    // the close button is not a handle
    dragging = true;
    const p = e.touches ? e.touches[0] : e;
    startX = p.clientX; startY = p.clientY;
    baseX = el.offsetLeft; baseY = el.offsetTop;
    e.preventDefault();
  };
  const move = (e) => {
    if (!dragging) return;
    const p = e.touches ? e.touches[0] : e;
    // Clamped so a pane can never be dragged fully off-screen — one that is gone
    // but still receiving lines is indistinguishable from the routing being
    // broken, and there is no menu to bring it back from.
    const x = Math.max(0, Math.min(window.innerWidth - 60, baseX + p.clientX - startX));
    const y = Math.max(0, Math.min(window.innerHeight - 40, baseY + p.clientY - startY));
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  };
  const up = () => {
    if (!dragging) return;
    dragging = false;
    savePos(name, { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
  };
  bar.addEventListener('mousedown', down);
  bar.addEventListener('touchstart', down, { passive: false });
  window.addEventListener('mousemove', move);
  window.addEventListener('touchmove', move, { passive: false });
  window.addEventListener('mouseup', up);
  window.addEventListener('touchend', up);
}

function ensurePane(name) {
  const key = String(name).toLowerCase();
  const existing = _panes.get(key);
  if (existing && document.body.contains(existing.el)) return existing;

  const el = document.createElement('div');
  el.className = 'out-pane';
  el.setAttribute('role', 'log');
  el.setAttribute('aria-label', `${name} pane`);

  const bar = document.createElement('div');
  bar.className = 'pane-bar';
  const title = document.createElement('span');
  title.className = 'pane-title';
  title.textContent = name;
  const x = document.createElement('button');
  x.className = 'pane-x';
  x.type = 'button';
  x.textContent = '✕';
  // Closing HIDES; it does not delete the routing rule. `route off <pattern>` is
  // how you stop routing. A close button that silently unpicked a rule would be
  // the kind of destructive shortcut nobody expects from an ✕.
  x.title = 'Hide (the routing rule stays — use "route off" to remove it)';
  x.addEventListener('click', () => { el.style.display = 'none'; });
  bar.append(title, x);

  const body = document.createElement('div');
  body.className = 'pane-body';

  el.append(bar, body);
  document.body.appendChild(el);

  const saved = loadPos()[key];
  if (saved) {
    el.style.left = `${saved.x}px`;
    el.style.top = `${saved.y}px`;
    if (saved.w) el.style.width = `${saved.w}px`;
    if (saved.h) el.style.height = `${saved.h}px`;
  } else {
    // Stagger new panes so a second one does not land exactly on the first.
    const n = _panes.size;
    el.style.left = `${Math.min(window.innerWidth - 300, 60 + n * 28)}px`;
    el.style.top = `${80 + n * 28}px`;
  }
  // The CSS `resize` handle does not fire an event we can hook, so the size is
  // captured on the next drag. Good enough: a resize without a later move is not
  // a case worth a ResizeObserver.
  makeDraggable(el, bar, key);

  const pane = { el, body };
  _panes.set(key, pane);
  return pane;
}

/**
 * Write a line into each named pane. Called from render.js's append path via
 * `setPaneWriter`, so it must stay cheap and must not throw.
 */
export function writeToPanes(names, text, cls) {
  for (const name of names) {
    const pane = ensurePane(name);
    pane.el.style.display = '';           // a routed line un-hides its pane
    const line = document.createElement('div');
    line.className = `pane-line msg-${cls || ''}`;
    line.textContent = text;
    pane.body.appendChild(line);
    while (pane.body.childElementCount > MAX_LINES) pane.body.removeChild(pane.body.firstElementChild);
    // Panes always follow the tail. They are small and glanceable; the scroll
    // lock exists for the main log, which is the one you read back through.
    pane.body.scrollTop = pane.body.scrollHeight;
  }
}

// Remove any pane no rule names any more, so a `route off` does not leave a dead
// window on screen collecting nothing.
export function reconcilePanes(activeNames) {
  const live = new Set([...activeNames].map(n => String(n).toLowerCase()));
  for (const [key, pane] of [..._panes]) {
    if (live.has(key)) continue;
    pane.el.remove();
    _panes.delete(key);
  }
}

export function initPanes() { /* nothing to do at boot — panes are derived */ }
