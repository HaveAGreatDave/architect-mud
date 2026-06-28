const ORDER_KEY = 'architect_sidebar_order';
const DEFAULT_ORDER = ['minimap-section', 'vitals-section', 'location-section', 'env-section', 'enemy-section', 'chat-section'];

let locked = true;
let dragSrc = null;
let dropInfo = null;

export function initSidebarOrder() {
  applyLayout(loadLayout());
  document.getElementById('sidebar-lock-btn').addEventListener('click', toggleLock);
  document.getElementById('sidebar-reset-btn')?.addEventListener('click', resetOrder);
  const sidebar = document.getElementById('sidebar');
  sidebar.addEventListener('dragover', onSidebarDragOver);
  sidebar.addEventListener('drop', onSidebarDrop);
  sidebar.addEventListener('dragleave', onSidebarDragLeave);
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
  document.querySelectorAll('#sidebar .sidebar-section, #sidebar .sidebar-spacer').forEach(el => {
    if (el.classList.contains('sidebar-section') && el.id) {
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
  const dropEnd = document.getElementById('sidebar-drop-end');
  document.querySelectorAll('#sidebar .sidebar-spacer').forEach(s => s.remove());

  const placed = new Set();
  if (items) {
    for (const item of items) {
      if (item.type === 'section') {
        const el = document.getElementById(item.id);
        if (el) { dropEnd.before(el); placed.add(item.id); }
      } else if (item.type === 'spacer' && item.flex > 0.01) {
        dropEnd.before(makeSpacer(item.flex));
      }
    }
  }
  for (const id of DEFAULT_ORDER) {
    if (!placed.has(id)) {
      const el = document.getElementById(id);
      if (el) dropEnd.before(el);
    }
  }
}

export function resetOrder() {
  document.querySelectorAll('#sidebar .sidebar-spacer').forEach(s => s.remove());
  localStorage.removeItem(ORDER_KEY);
  applyLayout(null);
}

function toggleLock() {
  locked = !locked;
  const btn = document.getElementById('sidebar-lock-btn');
  const sidebar = document.getElementById('sidebar');
  btn.textContent = locked ? '🔒' : '🔓';
  btn.classList.toggle('unlocked', !locked);
  btn.title = locked ? 'Unlock to reorder sidebar sections' : 'Lock sidebar order';
  sidebar.classList.toggle('drag-mode', !locked);
  sidebar.querySelectorAll('.sidebar-section').forEach(sec => {
    sec.draggable = !locked;
    if (!locked) attachDragHandlers(sec);
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
  dragSrc = this;
  e.dataTransfer.effectAllowed = 'move';
  this.classList.add('dragging');
}

function onDragEnd() {
  this.classList.remove('dragging');
  hideDropIndicator();
  dropInfo = null;
  dragSrc = null;
}

function findPrevSection(items, fromIndex) {
  for (let i = fromIndex - 1; i >= 0; i--) {
    if (items[i].classList.contains('sidebar-section')) return items[i];
  }
  return null;
}

function findNextSection(items, fromIndex) {
  for (let i = fromIndex + 1; i < items.length; i++) {
    if (items[i].classList.contains('sidebar-section')) return items[i];
  }
  return null;
}

// Compute where a drop at clientY should land.
// Over a section  → snap to its top (before) or bottom (after) based on which half the cursor is in.
// Over a spacer   → snap to the nearest section boundary (no free-floating in gaps).
// In the tail zone → free-float; will create a spacer to push section to that position.
function computeDropInfo(clientY) {
  const sidebar = document.getElementById('sidebar');
  const dropEnd = document.getElementById('sidebar-drop-end');
  const sr = sidebar.getBoundingClientRect();

  const items = [...sidebar.children].filter(el =>
    el !== dragSrc &&
    el !== dropEnd &&
    el.id !== 'sidebar-lock-btn' &&
    el.id !== 'sidebar-drop-indicator'
  );

  for (let i = 0; i < items.length; i++) {
    const el = items[i];
    const r = el.getBoundingClientRect();
    if (clientY > r.bottom) continue;

    if (el.classList.contains('sidebar-section')) {
      if (clientY <= r.top + r.height / 2) {
        return {kind: 'before', el, lineY: r.top - sr.top};
      }
      return {kind: 'after', el, lineY: r.bottom - sr.top};
    }

    if (el.classList.contains('sidebar-spacer')) {
      // Snap to the nearest section boundary rather than free-floating inside the gap.
      const inUpperHalf = r.height > 0 && (clientY - r.top) / r.height <= 0.5;
      const prevSec = findPrevSection(items, i);
      const nextSec = findNextSection(items, i);

      if (inUpperHalf && prevSec) {
        const pr = prevSec.getBoundingClientRect();
        return {kind: 'after', el: prevSec, lineY: pr.bottom - sr.top};
      }
      if (nextSec) {
        const nr = nextSec.getBoundingClientRect();
        return {kind: 'before', el: nextSec, lineY: nr.top - sr.top};
      }
      if (prevSec) {
        const pr = prevSec.getBoundingClientRect();
        return {kind: 'after', el: prevSec, lineY: pr.bottom - sr.top};
      }
      return {kind: 'end', lineY: r.bottom - sr.top};
    }
  }

  // Cursor is past all elements — free-float in the tail zone
  return {kind: 'end', lineY: clientY - sr.top};
}

function onSidebarDragOver(e) {
  if (!dragSrc) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  dropInfo = computeDropInfo(e.clientY);
  showDropIndicator(dropInfo.lineY);
}

function onSidebarDragLeave(e) {
  if (e.currentTarget.contains(e.relatedTarget)) return;
  hideDropIndicator();
  dropInfo = null;
}

function onSidebarDrop(e) {
  e.preventDefault();
  if (!dragSrc || !dropInfo) return;
  hideDropIndicator();

  const info = dropInfo;
  dropInfo = null;
  const dropEnd = document.getElementById('sidebar-drop-end');

  if (info.kind === 'before') {
    info.el.before(dragSrc);
  } else if (info.kind === 'after') {
    info.el.after(dragSrc);
  } else {
    // 'end' — dropped in the tail zone; push section to the visual bottom with a spacer
    dropEnd.before(makeSpacer(1000));
    dropEnd.before(dragSrc);
  }

  cleanupSpacers();
  saveLayout();
}

// Merge adjacent spacers; remove spacers that have no section after them (trailing gaps are redundant).
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

  // Remove spacers with no section following them — they're just trailing dead space
  [...sidebar.querySelectorAll('.sidebar-spacer')].forEach(sp => {
    let next = sp.nextElementSibling;
    while (next && !next.classList.contains('sidebar-section')) next = next.nextElementSibling;
    if (!next) sp.remove();
  });
}

// --- drop indicator (thin horizontal line) ---

function getIndicator() {
  let el = document.getElementById('sidebar-drop-indicator');
  if (!el) {
    el = document.createElement('div');
    el.id = 'sidebar-drop-indicator';
    document.getElementById('sidebar').appendChild(el);
  }
  return el;
}

function showDropIndicator(lineY) {
  const el = getIndicator();
  el.style.top = lineY + 'px';
  el.style.display = 'block';
}

function hideDropIndicator() {
  const el = document.getElementById('sidebar-drop-indicator');
  if (el) el.style.display = 'none';
}
