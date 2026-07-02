const ORDER_KEY = 'architect_sidebar_order';
const HIDDEN_KEY = 'architect_sidebar_hidden';
const COLLAPSED_KEY = 'architect_sidebar_collapsed';
// v2: reset once — panels default to content height; only user-resized panels
// carry a saved size. (Bumped after the min-height:0 change exposed old
// clamped-tiny sizes, which made every panel come up minimized.)
const SIZE_KEY = 'architect_sidebar_sizes_v2';
const DEFAULT_ORDER = ['minimap-section', 'vitals-section', 'location-section', 'env-section', 'enemy-section', 'chat-section'];

let locked = true;
let mode = 'move'; // 'move' (drag to reorder) | 'resize' (drag edge to size) — only meaningful while unlocked

// Single-colour padlock icons (Feather-style). Stroke = currentColor, so they
// pick up the theme accent from CSS. Closed when locked, open when unlocked.
const SVG_ATTRS = 'viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const LOCK_SVG = `<svg ${SVG_ATTRS}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
const UNLOCK_SVG = `<svg ${SVG_ATTRS}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`;
let dragSrc = null;
let dropInfo = null;
let lastClientY = null;
let lastClientX = null;
let dropped = false; // true once onSidebarDrop fires, so onDragEnd doesn't double-execute
let pendingHide = null; // section dragged out a side edge, hidden on release

export function initSidebarOrder() {
  // Park hidden sections out of the sidebar before laying out the rest.
  const park = getHiddenPark();
  for (const id of loadHidden()) {
    const el = document.getElementById(id);
    if (el) park.appendChild(el);
  }
  applyLayout(loadLayout());
  const lockBtn = document.getElementById('sidebar-lock-btn');
  lockBtn.innerHTML = LOCK_SVG;
  lockBtn.addEventListener('click', toggleLock);
  document.getElementById('sidebar-reset-btn')?.addEventListener('click', resetOrder);
  document.getElementById('sidebar-move-btn')?.addEventListener('click', () => setMode('move'));
  document.getElementById('sidebar-resize-btn')?.addEventListener('click', () => setMode('resize'));
  document.getElementById('sidebar-size-reset-btn')?.addEventListener('click', resetSizes);
  initRestoreControl();
  initResizeHandles();
  applySizes();
  updateRestoreVisibility();
  initCollapse();
  const sidebar = document.getElementById('sidebar');
  sidebar.addEventListener('dragover', onSidebarDragOver);
  sidebar.addEventListener('drop', onSidebarDrop);
  sidebar.addEventListener('dragleave', onSidebarDragLeave);

  // The look/output panes are an explicit trash drop target: drag any panel
  // over them and they light up; release to remove it.
  const gameArea = document.getElementById('output-container');
  if (gameArea) {
    gameArea.addEventListener('dragover', onGameDragOver);
    gameArea.addEventListener('dragleave', onGameDragLeave);
    gameArea.addEventListener('drop', onGameDrop);
  }
}

// --- game-area trash drop target ---

function onGameDragOver(e) {
  if (!dragSrc || !dragSrc.classList.contains('sidebar-section')) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  pendingHide = dragSrc;
  dropInfo = null;
  hideDropIndicator();
  showTrashIndicator();
}

function onGameDragLeave(e) {
  if (e.currentTarget.contains(e.relatedTarget)) return;
  pendingHide = null;
  hideTrashIndicator();
}

function onGameDrop(e) {
  if (!dragSrc || pendingHide !== dragSrc) return;
  e.preventDefault();
  dropped = true; // stop onDragEnd from double-processing
  const sec = pendingHide;
  pendingHide = null;
  hideTrashIndicator();
  hideSection(sec);
}

// --- hidden panels ---

function loadHidden() {
  try { return JSON.parse(localStorage.getItem(HIDDEN_KEY)) || []; } catch { return []; }
}

function saveHidden(ids) {
  localStorage.setItem(HIDDEN_KEY, JSON.stringify(ids));
}

function getHiddenPark() {
  let park = document.getElementById('sidebar-hidden-park');
  if (!park) {
    park = document.createElement('div');
    park.id = 'sidebar-hidden-park';
    park.style.display = 'none';
    document.body.appendChild(park);
  }
  return park;
}

function sectionLabel(el) {
  // Custom panels carry control glyphs (⚙ ✕ ▾) in their label; read the clean title.
  const custom = el.querySelector('.cpanel-title');
  if (custom) return custom.textContent.trim();
  return el.querySelector('.sidebar-label')?.textContent.trim() || el.id;
}

function hideSection(el) {
  el.draggable = false;
  detachDragHandlers(el);
  getHiddenPark().appendChild(el);
  const ids = loadHidden();
  if (!ids.includes(el.id)) { ids.push(el.id); saveHidden(ids); }
  saveLayout();
  renderRestoreMenu();
  updateRestoreVisibility();
}

function restoreSection(id) {
  saveHidden(loadHidden().filter(x => x !== id));
  const el = document.getElementById(id);
  if (el) {
    document.getElementById('sidebar-drop-end').before(el);
    if (!locked) { el.draggable = true; attachDragHandlers(el); }
  }
  saveLayout();
  renderRestoreMenu();
  updateRestoreVisibility();
}

// The panels list only shows while the sidebar is unlocked — hiding and
// re-adding are both edit-mode gestures. Locking clears it away.
function updateRestoreVisibility() {
  const restore = document.getElementById('sidebar-restore');
  if (!restore) return;
  restore.style.display = locked ? 'none' : '';
  if (locked) {
    const menu = document.getElementById('sidebar-restore-menu');
    if (menu) menu.style.display = 'none';
  }
}

function initRestoreControl() {
  const btn = document.getElementById('sidebar-restore-btn');
  const menu = document.getElementById('sidebar-restore-menu');
  if (!btn || !menu) return;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.style.display !== 'none') { menu.style.display = 'none'; return; }
    renderRestoreMenu();
    menu.style.display = 'block';
  });
  document.addEventListener('click', (e) => {
    if (!document.getElementById('sidebar-restore')?.contains(e.target)) menu.style.display = 'none';
  });
}

function renderRestoreMenu() {
  const menu = document.getElementById('sidebar-restore-menu');
  if (!menu) return;
  const ids = loadHidden();
  if (!ids.length) {
    menu.innerHTML = '<div class="sidebar-restore-empty">No hidden panels</div>';
    return;
  }
  menu.innerHTML = '';
  for (const id of ids) {
    const el = document.getElementById(id);
    const item = document.createElement('button');
    item.className = 'sidebar-restore-item';
    item.textContent = el ? sectionLabel(el) : id;
    item.addEventListener('click', () => { restoreSection(id); menu.style.display = 'none'; });
    menu.appendChild(item);
  }
}

// --- collapsible panels ---

function loadCollapsed() {
  try { return JSON.parse(localStorage.getItem(COLLAPSED_KEY)) || []; } catch { return []; }
}

function saveCollapsed(ids) {
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify(ids));
}

function setCollapsed(section, btn, on) {
  section.classList.toggle('collapsed', on);
  btn.textContent = on ? '▸' : '▾';
  btn.title = on ? 'Expand panel' : 'Collapse panel';
}

// Collapse/expand any section without persisting — used by the accordion
// controller for transient "push others aside" behaviour. Updates whichever
// caret the section has (standard collapse button or a custom accordion caret).
export function collapseSection(section, on) {
  section.classList.toggle('collapsed', on);
  const btn = section.querySelector('.sidebar-collapse-btn');
  if (btn) { btn.textContent = on ? '▸' : '▾'; btn.title = on ? 'Expand panel' : 'Collapse panel'; }
  const caret = section.querySelector('.cpanel-caret');
  if (caret) caret.textContent = on ? '▸' : '▾';
}

export function isSectionCollapsed(section) {
  return section.classList.contains('collapsed');
}

// Wire one section's collapse button. Idempotent — safe to call again for a
// late-mounted custom panel.
function wireCollapse(section) {
  const btn = section.querySelector('.sidebar-collapse-btn');
  if (!btn || btn._collapseWired) return;
  btn._collapseWired = true;
  setCollapsed(section, btn, new Set(loadCollapsed()).has(section.id));
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const on = !section.classList.contains('collapsed');
    setCollapsed(section, btn, on);
    const ids = loadCollapsed().filter(x => x !== section.id);
    if (on) ids.push(section.id);
    saveCollapsed(ids);
  });
}

function initCollapse() {
  document.querySelectorAll('#sidebar .sidebar-section').forEach(wireCollapse);
}

// --- resizable panels ---

let resizeSec = null, resizeStartY = 0, resizeStartH = 0;

function loadSizes() {
  try { return JSON.parse(localStorage.getItem(SIZE_KEY)) || {}; } catch { return {}; }
}

function saveSizes() {
  const sizes = {};
  document.querySelectorAll('#sidebar .sidebar-section').forEach(sec => {
    const basis = sec.style.flexBasis;
    if (sec.id && basis && basis.endsWith('px')) sizes[sec.id] = parseFloat(basis);
  });
  localStorage.setItem(SIZE_KEY, JSON.stringify(sizes));
}

function applySizes() {
  const sizes = loadSizes();
  document.querySelectorAll('#sidebar .sidebar-section').forEach(sec => {
    if (sizes[sec.id]) sizeSection(sec, sizes[sec.id]);
  });
}

function sizeSection(sec, px) {
  // Fix the panel's height; its .sidebar-section-body scrolls any overflow.
  // min-height:0 lets the fixed basis win over the content's min-content size,
  // so a panel can be shrunk past its content (hiding it) — the JS floor keeps
  // a grabbable buffer so it can never collapse to an unresizable 0.
  sec.style.flex = `0 0 ${px}px`;
  sec.style.minHeight = '0';
}

function resetSizes() {
  localStorage.removeItem(SIZE_KEY);
  document.querySelectorAll('#sidebar .sidebar-section').forEach(sec => {
    sec.style.flex = '';
    sec.style.minHeight = '';
  });
}

// Prepare one section for resizing: wrap its content (everything below the
// label) in a scroll container, then add the resize handle. The handle sits
// outside the scroller so it never scrolls away — a shrunk panel scrolls its
// body instead of clipping. Idempotent.
function wireResizeHandle(sec) {
  if (sec.querySelector(':scope > .sidebar-resize-handle')) return;
  const label = sec.querySelector(':scope > .sidebar-label');
  const body = document.createElement('div');
  body.className = 'sidebar-section-body';
  [...sec.children].forEach(child => { if (child !== label) body.appendChild(child); });
  if (label) label.after(body); else sec.prepend(body);
  const handle = document.createElement('div');
  handle.className = 'sidebar-resize-handle';
  handle.addEventListener('mousedown', onResizeStart);
  sec.appendChild(handle);
}

function initResizeHandles() {
  document.querySelectorAll('#sidebar .sidebar-section').forEach(wireResizeHandle);
}

function onResizeStart(e) {
  const sec = e.target.closest('.sidebar-section');
  if (!sec) return;
  e.preventDefault();
  e.stopPropagation();
  resizeSec = sec;
  resizeStartY = e.clientY;
  resizeStartH = sec.getBoundingClientRect().height;
  sec.classList.add('resizing');
  document.addEventListener('mousemove', onResizeMove);
  document.addEventListener('mouseup', onResizeEnd);
}

function onResizeMove(e) {
  if (!resizeSec) return;
  const h = Math.max(40, resizeStartH + (e.clientY - resizeStartY));
  sizeSection(resizeSec, h);
}

function onResizeEnd() {
  if (!resizeSec) return;
  resizeSec.classList.remove('resizing');
  resizeSec = null;
  document.removeEventListener('mousemove', onResizeMove);
  document.removeEventListener('mouseup', onResizeEnd);
  saveSizes();
}

function loadLayout() {
  try {
    const raw = JSON.parse(localStorage.getItem(ORDER_KEY));
    if (!raw) return null;
    if (typeof raw[0] === 'string') return raw.map(id => ({type: 'section', id}));
    return raw;
  } catch { return null; }
}

function saveLayout() {
  const items = [];
  document.querySelectorAll('#sidebar .sidebar-section, #sidebar .sidebar-spacer, #sidebar .sidebar-header').forEach(el => {
    if (el.classList.contains('sidebar-header')) {
      items.push({type: 'header'});
    } else if (el.classList.contains('sidebar-section') && el.id) {
      items.push({type: 'section', id: el.id});
    } else if (el.classList.contains('sidebar-spacer')) {
      const flex = parseFloat(el.style.flexGrow) || 1;
      if (flex > 0.01) items.push({type: 'spacer', flex});
    }
  });
  localStorage.setItem(ORDER_KEY, JSON.stringify(items));
}

function makeSpacer(flex = 1) {
  const el = document.createElement('div');
  el.className = 'sidebar-spacer';
  el.style.cssText = `flex: ${flex} 1 0; min-height: 0;`;
  return el;
}

function applyLayout(items) {
  const sidebar = document.getElementById('sidebar');
  const dropEnd = document.getElementById('sidebar-drop-end');
  const header = sidebar.querySelector('.sidebar-header');
  document.querySelectorAll('#sidebar .sidebar-spacer').forEach(s => s.remove());

  // The header is movable, but a layout without a header entry (legacy or after a
  // reset) defaults it back to the top of the sidebar.
  if (header && !(items && items.some(it => it.type === 'header'))) sidebar.prepend(header);

  const hidden = new Set(loadHidden());
  const placed = new Set();
  if (items) {
    for (const item of items) {
      if (item.type === 'header') {
        if (header) dropEnd.before(header);
      } else if (item.type === 'section') {
        if (hidden.has(item.id)) continue;
        const el = document.getElementById(item.id);
        if (el) { dropEnd.before(el); placed.add(item.id); }
      } else if (item.type === 'spacer' && item.flex > 0.01) {
        dropEnd.before(makeSpacer(item.flex));
      }
    }
  }
  for (const id of DEFAULT_ORDER) {
    if (!placed.has(id) && !hidden.has(id)) {
      const el = document.getElementById(id);
      if (el) dropEnd.before(el);
    }
  }
}

export function resetOrder() {
  document.querySelectorAll('#sidebar .sidebar-spacer').forEach(s => s.remove());
  localStorage.removeItem(ORDER_KEY);
  saveHidden([]); // restore any hidden panels
  saveCollapsed([]); // expand any collapsed panels
  resetSizes(); // clear custom panel heights
  document.querySelectorAll('#sidebar .sidebar-collapse-btn').forEach(btn => {
    const section = btn.closest('.sidebar-section');
    if (section) setCollapsed(section, btn, false);
  });
  applyLayout(null);
  renderRestoreMenu();
  updateRestoreVisibility();
}

// --- dynamic (custom) sections ---

// Inject a runtime-built .sidebar-section and give it the full treatment the
// hardcoded sections get: collapse button, resize handle, saved size, drag
// state, and a slot in the persisted order. Idempotent and safe both during
// boot (before initSidebarOrder lays out) and at runtime (after).
// persist=false during boot: the section is inserted so initSidebarOrder's
// applyLayout can find it by id and restore its saved slot — writing the order
// here first would clobber that saved slot with the naive bottom position.
export function mountSection(el, persist = true) {
  const dropEnd = document.getElementById('sidebar-drop-end');
  if (!document.getElementById(el.id)) {
    if (loadHidden().includes(el.id)) getHiddenPark().appendChild(el);
    else dropEnd.before(el);
  }
  wireCollapse(el);
  wireResizeHandle(el);
  const sizes = loadSizes();
  if (sizes[el.id]) sizeSection(el, sizes[el.id]);
  if (!locked && mode === 'move' && document.getElementById('sidebar').contains(el)) {
    el.draggable = true;
    attachDragHandlers(el);
  }
  if (persist) saveLayout();
}

// Remove a custom section and purge it from every layout store.
export function unmountSection(id) {
  document.getElementById(id)?.remove();
  saveHidden(loadHidden().filter(x => x !== id));
  saveCollapsed(loadCollapsed().filter(x => x !== id));
  const sizes = loadSizes();
  delete sizes[id];
  localStorage.setItem(SIZE_KEY, JSON.stringify(sizes));
  saveLayout();
  renderRestoreMenu();
  updateRestoreVisibility();
}

function toggleLock() {
  locked = !locked;
  const btn = document.getElementById('sidebar-lock-btn');
  btn.innerHTML = locked ? LOCK_SVG : UNLOCK_SVG;
  btn.classList.toggle('unlocked', !locked);
  btn.title = locked ? 'Unlock to reorder sidebar sections' : 'Lock sidebar order';

  // Restore control: only shown while unlocked.
  updateRestoreVisibility();
  if (!locked) renderRestoreMenu();
  applyEditState();
}

function setMode(m) {
  if (locked || m === mode) return;
  mode = m;
  applyEditState();
}

// Reflect the current lock + mode onto the sidebar: which edit class is active,
// whether the mode buttons show, and whether sections are drag-reorderable.
function applyEditState() {
  const sidebar = document.getElementById('sidebar');
  const editing = !locked;
  sidebar.classList.toggle('drag-mode', editing && mode === 'move');
  sidebar.classList.toggle('resize-mode', editing && mode === 'resize');

  const modes = document.getElementById('sidebar-modes');
  if (modes) modes.style.display = editing ? '' : 'none';
  document.getElementById('sidebar-move-btn')?.classList.toggle('active', mode === 'move');
  document.getElementById('sidebar-resize-btn')?.classList.toggle('active', mode === 'resize');

  const canDrag = editing && mode === 'move';
  sidebar.querySelectorAll('.sidebar-section, .sidebar-header').forEach(sec => {
    if (!sidebar.contains(sec)) return;
    sec.draggable = canDrag;
    if (canDrag) attachDragHandlers(sec);
    else detachDragHandlers(sec);
  });
}

function attachDragHandlers(el) {
  el.addEventListener('dragstart', onDragStart);
  el.addEventListener('dragend', onDragEnd);
}

function detachDragHandlers(el) {
  el.removeEventListener('dragstart', onDragStart);
  el.removeEventListener('dragend', onDragEnd);
}

function onDragStart(e) {
  // Grab the header by its bar, not by the lock/panels buttons on it, so those stay
  // clickable while unlocked.
  if (this.classList.contains('sidebar-header') && e.target.closest('button')) {
    e.preventDefault();
    return;
  }
  dragSrc = this;
  dropped = false;
  e.dataTransfer.effectAllowed = 'move';
  this.classList.add('dragging');
}

function onDragEnd() {
  this.classList.remove('dragging');
  hideDropIndicator();
  hideTrashIndicator();

  // Cursor released outside the sidebar: either hide (dragged into the game view)
  // or execute the clamped drop (slipped off the top/bottom edge in dragleave).
  if (!dropped) {
    if (pendingHide) hideSection(pendingHide);
    else if (dropInfo) { executeDrop(dropInfo); saveLayout(); }
  }

  dropped = false;
  dropInfo = null;
  pendingHide = null;
  lastClientY = null;
  lastClientX = null;
  dragSrc = null;
}


function computeDropInfo(clientY) {
  const sidebar = document.getElementById('sidebar');
  const dropEnd = document.getElementById('sidebar-drop-end');
  const sr = sidebar.getBoundingClientRect();

  const items = [...sidebar.children].filter(el =>
    el !== dragSrc &&
    el !== dropEnd &&
    el.id !== 'sidebar-drop-indicator'
  );

  for (let i = 0; i < items.length; i++) {
    const el = items[i];
    const r = el.getBoundingClientRect();
    if (clientY > r.bottom) continue;

    // The header bar snaps like a section (movable, but never a spacer target).
    if (el.classList.contains('sidebar-section') || el.classList.contains('sidebar-header')) {
      // Snap to before/after only when cursor is actually over a section
      if (clientY <= r.top + r.height / 2) {
        return {kind: 'before', el, lineY: r.top - sr.top};
      }
      return {kind: 'after', el, lineY: r.bottom - sr.top};
    }

    if (el.classList.contains('sidebar-spacer')) {
      // Free drop in spacer — split it at the cursor position
      const frac = r.height > 0 ? (clientY - r.top) / r.height : 0.5;
      return {kind: 'split-spacer', el, frac, lineY: clientY - sr.top};
    }
  }

  return {kind: 'end', lineY: clientY - sr.top};
}

function executeDrop(info) {
  const dropEnd = document.getElementById('sidebar-drop-end');
  if (info.kind === 'before') {
    info.el.before(dragSrc);
  } else if (info.kind === 'after') {
    info.el.after(dragSrc);
  } else if (info.kind === 'split-spacer') {
    const totalFlex = parseFloat(info.el.style.flexGrow) || 1;
    const topFlex = totalFlex * info.frac;
    const botFlex = totalFlex * (1 - info.frac);
    const topSpacer = makeSpacer(topFlex);
    const botSpacer = makeSpacer(botFlex);
    info.el.replaceWith(topSpacer, dragSrc, botSpacer);
  } else {
    dropEnd.before(makeSpacer(1000));
    dropEnd.before(dragSrc);
  }
  cleanupSpacers();
}

function onSidebarDragOver(e) {
  if (!dragSrc) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  lastClientY = e.clientY;
  lastClientX = e.clientX;
  pendingHide = null; // back inside the sidebar — cancel any pending hide
  hideTrashIndicator();
  dropInfo = computeDropInfo(e.clientY);
  showDropIndicator(dropInfo.lineY, dropInfo.kind === 'before' || dropInfo.kind === 'after');
}

// The game view sits on whichever side of the sidebar has more room (handles the
// sidebar being docked either left or right). A panel is only hidden when dragged
// out through that inner, game-facing edge.
function exitedTowardGame(sr, x) {
  const gameOnLeft = sr.left >= (window.innerWidth - sr.right);
  return gameOnLeft ? x <= sr.left : x >= sr.right;
}

function onSidebarDragLeave(e) {
  if (e.currentTarget.contains(e.relatedTarget)) return;

  const sidebar = document.getElementById('sidebar');
  const sr = sidebar.getBoundingClientRect();

  // What an exit means depends on which edge the cursor left through:
  //  - Top/bottom: clamp to the boundary and still drop (place at start/end), so
  //    dragging a panel off the bottom to make it last never deletes it.
  //  - Toward the game screen (the inner, content-facing edge): hide the panel.
  //    This is the only way to remove one — a deliberate drag into the game view.
  //  - Away from the game (outer edge): cancel the drop, keep the panel in place.
  dropInfo = null;
  pendingHide = null;
  if (lastClientY !== null) {
    if (lastClientY >= sr.bottom) {
      dropInfo = computeDropInfo(sr.bottom); // snaps to 'end'
    } else if (lastClientY <= sr.top) {
      dropInfo = computeDropInfo(sr.top);    // snaps to before first section
    } else if (lastClientX !== null && exitedTowardGame(sr, lastClientX)) {
      // Never the header — you'd lose the lock control.
      pendingHide = dragSrc && dragSrc.classList.contains('sidebar-section') ? dragSrc : null;
    }
  }

  hideDropIndicator();
  if (pendingHide) showTrashIndicator(); else hideTrashIndicator();
}

function onSidebarDrop(e) {
  e.preventDefault();
  if (!dragSrc || !dropInfo) return;
  hideDropIndicator();
  dropped = true;

  const info = dropInfo;
  dropInfo = null;
  executeDrop(info);
  saveLayout();
}

function cleanupSpacers() {
  const sidebar = document.getElementById('sidebar');

  // Merge adjacent spacers
  let prev = null;
  [...sidebar.querySelectorAll('.sidebar-spacer')].forEach(sp => {
    if (prev && prev.nextElementSibling === sp) {
      prev.style.flexGrow = (parseFloat(prev.style.flexGrow) || 1) + (parseFloat(sp.style.flexGrow) || 1);
      sp.remove();
    } else {
      prev = sp;
    }
  });

  // Remove spacers with no section following them (trailing gaps are redundant)
  [...sidebar.querySelectorAll('.sidebar-spacer')].forEach(sp => {
    let next = sp.nextElementSibling;
    while (next && !next.classList.contains('sidebar-section')) next = next.nextElementSibling;
    if (!next) sp.remove();
  });
}

// --- drop indicator ---

function getIndicator() {
  let el = document.getElementById('sidebar-drop-indicator');
  if (!el) {
    el = document.createElement('div');
    el.id = 'sidebar-drop-indicator';
    document.getElementById('sidebar').appendChild(el);
  }
  return el;
}

function showDropIndicator(lineY, snapping) {
  const el = getIndicator();
  el.style.top = lineY + 'px';
  el.style.display = 'block';
  el.classList.toggle('snapping', snapping);
}

function hideDropIndicator() {
  const el = document.getElementById('sidebar-drop-indicator');
  if (el) el.style.display = 'none';
}

// --- trash-can indicator ---
// Shown while a panel is dragged out through the game-facing edge, signalling
// that releasing will remove it. Anchored over the look/output panes
// (#output-container) so it reads as a real drop zone; falls back to a
// screen-centred overlay if that container isn't present.

function getTrashIndicator() {
  let el = document.getElementById('sidebar-trash-indicator');
  if (!el) {
    el = document.createElement('div');
    el.id = 'sidebar-trash-indicator';
    el.innerHTML = '<div class="trash-card"><div class="trash-icon">🗑</div><div class="trash-label">Release to remove</div></div>';
    document.body.appendChild(el);
  }
  return el;
}

function showTrashIndicator() {
  const el = getTrashIndicator();
  const pane = document.getElementById('output-container');
  if (pane) {
    const r = pane.getBoundingClientRect();
    el.style.top = r.top + 'px';
    el.style.left = r.left + 'px';
    el.style.width = r.width + 'px';
    el.style.height = r.height + 'px';
  }
  el.classList.add('active');
}

function hideTrashIndicator() {
  document.getElementById('sidebar-trash-indicator')?.classList.remove('active');
}
