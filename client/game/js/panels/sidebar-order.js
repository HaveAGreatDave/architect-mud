const ORDER_KEY = 'architect_sidebar_order';
const DEFAULT_ORDER = ['minimap-section', 'vitals-section', 'location-section', 'env-section', 'enemy-section', 'chat-section'];

let locked = true;
let dragSrc = null;

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
  const sidebar = document.getElementById('sidebar');
  order.forEach(id => {
    const el = document.getElementById(id);
    if (el) sidebar.appendChild(el);
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
  clearDropIndicators();
  dragSrc = null;
}

// Find the section immediately after the cursor Y position.
// Returns null to mean "insert at end".
function getInsertionTarget(clientY) {
  const sections = [...document.querySelectorAll('#sidebar .sidebar-section')].filter(s => s !== dragSrc);
  for (const sec of sections) {
    const rect = sec.getBoundingClientRect();
    if (clientY < rect.bottom) return sec;
  }
  return null;
}

function onSidebarDragOver(e) {
  if (!dragSrc) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  clearDropIndicators();
  const target = getInsertionTarget(e.clientY);
  if (target) target.classList.add('drop-before');
  else document.getElementById('sidebar-drop-end')?.classList.add('drop-active');
}

function onSidebarDragLeave(e) {
  if (e.currentTarget.contains(e.relatedTarget)) return;
  clearDropIndicators();
}

function onSidebarDrop(e) {
  e.preventDefault();
  if (!dragSrc) return;
  const target = getInsertionTarget(e.clientY);
  clearDropIndicators();
  if (target && target !== dragSrc) target.before(dragSrc);
  else if (!target) document.getElementById('sidebar-drop-end').before(dragSrc);
  saveOrder();
}

function clearDropIndicators() {
  document.querySelectorAll('.sidebar-section.drop-before').forEach(el => el.classList.remove('drop-before'));
  document.getElementById('sidebar-drop-end')?.classList.remove('drop-active');
}
