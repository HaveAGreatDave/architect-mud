const ORDER_KEY = 'architect_sidebar_order';
const DEFAULT_ORDER = ['minimap-section', 'vitals-section', 'location-section', 'env-section', 'enemy-section', 'chat-section'];

let locked = true;
let dragSrc = null;
let insertBefore = null; // the section to insert before (null = end)

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
  e.dataTransfer.effectAllowed = 'move';
  this.classList.add('dragging');
}

function onDragEnd() {
  this.classList.remove('dragging');
  hideDropIndicator();
  insertBefore = null;
  dragSrc = null;
}

// Returns true if clientY falls inside any visible section (excluding dragSrc).
function overSection(clientY) {
  const sections = document.querySelectorAll('#sidebar .sidebar-section');
  for (const sec of sections) {
    if (sec === dragSrc) continue;
    const r = sec.getBoundingClientRect();
    if (clientY >= r.top && clientY <= r.bottom) return true;
  }
  return false;
}

// Find the section to insert before based on cursor Y (null = end).
function getInsertionTarget(clientY) {
  const sections = [...document.querySelectorAll('#sidebar .sidebar-section')].filter(s => s !== dragSrc);
  for (const sec of sections) {
    const r = sec.getBoundingClientRect();
    if (clientY < r.top) return sec;
  }
  return null;
}

function onSidebarDragOver(e) {
  if (!dragSrc) return;
  e.preventDefault();

  if (overSection(e.clientY)) {
    e.dataTransfer.dropEffect = 'none';
    hideDropIndicator();
    insertBefore = null;
    return;
  }

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
  if (!dragSrc || overSection(e.clientY)) return;
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
  const sidebar = document.getElementById('sidebar');
  const sidebarRect = sidebar.getBoundingClientRect();
  const el = getIndicator();
  el.style.top = (clientY - sidebarRect.top) + 'px';
  el.style.display = 'block';
}

function hideDropIndicator() {
  const el = document.getElementById('sidebar-drop-indicator');
  if (el) el.style.display = 'none';
}
