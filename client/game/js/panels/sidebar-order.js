const ORDER_KEY = 'architect_sidebar_order';
const DEFAULT_ORDER = ['minimap-section', 'vitals-section', 'location-section', 'env-section', 'enemy-section', 'chat-section'];

let locked = true;
let dragSrc = null;
let grabOffsetY = 0;
let insertBefore = null;

export function initSidebarOrder() {
  applyOrder(loadOrder());
  document.getElementById('sidebar-lock-btn').addEventListener('click', toggleLock);
  document.getElementById('sidebar-reset-btn')?.addEventListener('click', resetOrder);

  const sidebar = document.getElementById('sidebar');
  sidebar.addEventListener('dragover', onSidebarDragOver);
  sidebar.addEventListener('drop', onSidebarDrop);
  sidebar.addEventListener('dragleave', onSidebarDragLeave);
}

function loadOrder() {
  try { return JSON.parse(localStorage.getItem(ORDER_KEY)) || [...DEFAULT_ORDER]; } catch { return [...DEFAULT_ORDER]; }
}

function saveOrder() {
  const sidebar = document.getElementById('sidebar');
  const ids = [...sidebar.querySelectorAll('.sidebar-section')].map(s => s.id).filter(Boolean);
  localStorage.setItem(ORDER_KEY, JSON.stringify(ids));
}

function applyOrder(order) {
  const dropEnd = document.getElementById('sidebar-drop-end');
  order.forEach(id => {
    const el = document.getElementById(id);
    if (el) dropEnd.before(el);
  });
}

export function resetOrder() {
  localStorage.removeItem(ORDER_KEY);
  applyOrder([...DEFAULT_ORDER]);
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
  grabOffsetY = e.offsetY;
  e.dataTransfer.effectAllowed = 'move';
  this.classList.add('dragging');
}

function onDragEnd() {
  this.classList.remove('dragging');
  hideDropIndicator();
  insertBefore = null;
  dragSrc = null;
}

// Ghost top = cursor Y minus the point where the user grabbed the element,
// clamped so the ghost stays inside the sidebar.
function ghostTop(clientY) {
  const sidebar = document.getElementById('sidebar');
  const sr = sidebar.getBoundingClientRect();
  const gh = dragSrc.offsetHeight;
  const raw = clientY - sr.top - grabOffsetY;
  return Math.max(0, Math.min(raw, sr.height - gh));
}

// Insert before the first section whose midpoint is below the ghost's midpoint.
function getInsertionTarget(clientY) {
  const sidebar = document.getElementById('sidebar');
  const sr = sidebar.getBoundingClientRect();
  const gh = dragSrc.offsetHeight;
  const ghostMid = sr.top + ghostTop(clientY) + gh / 2;
  const sections = [...document.querySelectorAll('#sidebar .sidebar-section')].filter(s => s !== dragSrc);
  for (const sec of sections) {
    const r = sec.getBoundingClientRect();
    if (ghostMid < r.top + r.height / 2) return sec;
  }
  return null;
}

function onSidebarDragOver(e) {
  if (!dragSrc) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  insertBefore = getInsertionTarget(e.clientY);
  showDropIndicator(e.clientY);
}

function onSidebarDragLeave(e) {
  if (e.currentTarget.contains(e.relatedTarget)) return;
  hideDropIndicator();
  insertBefore = null;
}

function onSidebarDrop(e) {
  e.preventDefault();
  if (!dragSrc) return;
  hideDropIndicator();
  const target = insertBefore;
  insertBefore = null;
  if (target) target.before(dragSrc);
  else document.getElementById('sidebar-drop-end').before(dragSrc);
  saveOrder();
}

// --- indicator element ---

function getIndicator() {
  let el = document.getElementById('sidebar-drop-indicator');
  if (!el) {
    el = document.createElement('div');
    el.id = 'sidebar-drop-indicator';
    document.getElementById('sidebar').appendChild(el);
  }
  return el;
}

function showDropIndicator(clientY) {
  const el = getIndicator();
  el.style.top = ghostTop(clientY) + 'px';
  el.style.height = dragSrc.offsetHeight + 'px';
  el.style.display = 'block';
}

function hideDropIndicator() {
  const el = document.getElementById('sidebar-drop-indicator');
  if (el) el.style.display = 'none';
}
