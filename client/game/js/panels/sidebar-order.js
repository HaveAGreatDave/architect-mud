const ORDER_KEY = 'architect_sidebar_order';
const DEFAULT_ORDER = ['minimap-section', 'vitals-section', 'location-section', 'env-section', 'enemy-section', 'chat-section'];

let locked = true;
let dragSrc = null;
let dropInfo = null;
let lastClientY = null;
let dropped = false; // true once onSidebarDrop fires, so onDragEnd doesn't double-execute

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

export function placeDpadPanel() {
  const sidebar = document.getElementById('sidebar');
  const section = document.getElementById('dpad-section');
  if (!section) return false;
  const spacer = sidebar.querySelector('.sidebar-spacer');
  // Prefer an existing flexible gap; otherwise drop it at the bottom of the sidebar.
  if (spacer) spacer.before(section);
  else document.getElementById('sidebar-drop-end').before(section);
  if (!locked) { section.draggable = true; attachDragHandlers(section); }
  saveLayout();
  return true;
}

export function removeDpadPanel() {
  const section = document.getElementById('dpad-section');
  if (!section) return;
  const park = document.getElementById('dpad-section-park');
  section.draggable = false;
  detachDragHandlers(section);
  park.appendChild(section);
  saveLayout();
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
    if (!sidebar.contains(sec)) return;
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
  dropped = false;
  e.dataTransfer.effectAllowed = 'move';
  this.classList.add('dragging');
}

function onDragEnd() {
  this.classList.remove('dragging');
  hideDropIndicator();

  // If the cursor slipped off a vertical edge, dropInfo was clamped in dragleave.
  // Execute that clamped drop now (only if onSidebarDrop didn't already handle it).
  if (!dropped && dropInfo) {
    executeDrop(dropInfo);
    saveLayout();
  }

  dropped = false;
  dropInfo = null;
  lastClientY = null;
  dragSrc = null;
}


function computeDropInfo(clientY) {
  const sidebar = document.getElementById('sidebar');
  const dropEnd = document.getElementById('sidebar-drop-end');
  const sr = sidebar.getBoundingClientRect();

  const items = [...sidebar.children].filter(el =>
    el !== dragSrc &&
    el !== dropEnd &&
    !el.classList.contains('sidebar-header') &&
    el.id !== 'sidebar-drop-indicator'
  );

  for (let i = 0; i < items.length; i++) {
    const el = items[i];
    const r = el.getBoundingClientRect();
    if (clientY > r.bottom) continue;

    if (el.classList.contains('sidebar-section')) {
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
  dropInfo = computeDropInfo(e.clientY);
  showDropIndicator(dropInfo.lineY, dropInfo.kind === 'before' || dropInfo.kind === 'after');
}

function onSidebarDragLeave(e) {
  if (e.currentTarget.contains(e.relatedTarget)) return;

  const sidebar = document.getElementById('sidebar');
  const sr = sidebar.getBoundingClientRect();

  // Clamp to top/bottom if cursor exited via a vertical edge so the drop still
  // fires at the boundary when the user releases outside the sidebar.
  // Side exits (left/right) cancel the pending drop.
  if (lastClientY !== null) {
    if (lastClientY >= sr.bottom) {
      dropInfo = computeDropInfo(sr.bottom); // snaps to 'end'
    } else if (lastClientY <= sr.top) {
      dropInfo = computeDropInfo(sr.top);    // snaps to before first section
    } else {
      dropInfo = null; // side exit — cancel
    }
  } else {
    dropInfo = null;
  }

  hideDropIndicator();
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
