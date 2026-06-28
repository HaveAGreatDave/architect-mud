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
    // backwards compat: old format was plain array of id strings
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
  // Place any sections missing from saved layout at the end
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

// Compute where a drop at clientY should land.
// Returns one of:
//   {kind:'before', el, lineY}        — insert before a section
//   {kind:'after',  el, lineY}        — insert after a section
//   {kind:'spacer', el, frac, flex, lineY} — split an existing spacer
//   {kind:'end',    lineY}            — drop in the empty tail zone
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

  for (const el of items) {
    const r = el.getBoundingClientRect();
    if (clientY > r.bottom) continue;

    if (el.classList.contains('sidebar-section')) {
      if (clientY <= r.top + r.height / 2) {
        return {kind: 'before', el, lineY: r.top - sr.top};
      }
      return {kind: 'after', el, lineY: r.bottom - sr.top};
    }

    if (el.classList.contains('sidebar-spacer')) {
      const frac = r.height > 0 ? (clientY - r.top) / r.height : 0.5;
      const flex = parseFloat(el.style.flexGrow) || 1;
      return {kind: 'spacer', el, frac, flex, lineY: clientY - sr.top};
    }
  }

  // Cursor is in the empty tail zone (sidebar-drop-end area)
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
  } else if (info.kind === 'spacer') {
    // Split the spacer at the cursor position
    const {el, frac, flex} = info;
    const topFlex = flex * frac;
    const botFlex = flex * (1 - frac);
    if (topFlex > 0.05) el.before(makeSpacer(topFlex));
    el.before(dragSrc);
    if (botFlex > 0.05) el.before(makeSpacer(botFlex));
    el.remove();
  } else {
    // 'end' — user dropped in the empty zone; push section to the visual bottom
    // Use a large flex value so this spacer dominates any others and fills the gap
    dropEnd.before(makeSpacer(1000));
    dropEnd.before(dragSrc);
  }

  cleanupSpacers();
  saveLayout();
}

// Merge spacers that are adjacent in the DOM (no elements between them)
function cleanupSpacers() {
  const sidebar = document.getElementById('sidebar');
  let prev = null;
  [...sidebar.querySelectorAll('.sidebar-spacer')].forEach(sp => {
    if (prev && prev.nextElementSibling === sp) {
      prev.style.flexGrow = (parseFloat(prev.style.flexGrow) || 1) + (parseFloat(sp.style.flexGrow) || 1);
      sp.remove();
    } else {
      prev = sp;
    }
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
