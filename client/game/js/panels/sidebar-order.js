const ORDER_KEY = 'architect_sidebar_order';
const DEFAULT_ORDER = ['minimap-section', 'vitals-section', 'location-section', 'env-section', 'enemy-section', 'chat-section'];

let locked = true;
let dragSrc = null;

export function initSidebarOrder() {
  applyOrder(loadOrder());
  document.getElementById('sidebar-lock-btn').addEventListener('click', toggleLock);
  document.getElementById('sidebar-reset-btn')?.addEventListener('click', resetOrder);

  const dropEnd = document.getElementById('sidebar-drop-end');
  dropEnd.addEventListener('dragover', (e) => {
    if (!dragSrc) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearDropIndicators();
    dropEnd.classList.add('drop-active');
  });
  dropEnd.addEventListener('dragleave', () => dropEnd.classList.remove('drop-active'));
  dropEnd.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!dragSrc) return;
    dropEnd.classList.remove('drop-active');
    dropEnd.before(dragSrc);
    saveOrder();
  });
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
  el.addEventListener('dragover', onDragOver);
  el.addEventListener('dragleave', onDragLeave);
  el.addEventListener('drop', onDrop);
  el.addEventListener('dragend', onDragEnd);
}

function detachDragHandlers(el) {
  el.removeEventListener('dragstart', onDragStart);
  el.removeEventListener('dragover', onDragOver);
  el.removeEventListener('dragleave', onDragLeave);
  el.removeEventListener('drop', onDrop);
  el.removeEventListener('dragend', onDragEnd);
}

function onDragStart(e) {
  dragSrc = this;
  e.dataTransfer.effectAllowed = 'move';
  this.classList.add('dragging');
}

function onDragOver(e) {
  if (!dragSrc || dragSrc === this) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  clearDropIndicators();
  const rect = this.getBoundingClientRect();
  const midY = rect.top + rect.height / 2;
  if (e.clientY < midY) this.classList.add('drop-before');
  else this.classList.add('drop-after');
}

function onDragLeave() {
  this.classList.remove('drop-before', 'drop-after');
}

function onDrop(e) {
  e.preventDefault();
  if (!dragSrc || dragSrc === this) return;
  const isAfter = this.classList.contains('drop-after');
  clearDropIndicators();
  if (isAfter) this.after(dragSrc);
  else this.before(dragSrc);
  saveOrder();
}

function onDragEnd() {
  this.classList.remove('dragging');
  clearDropIndicators();
  dragSrc = null;
}

function clearDropIndicators() {
  document.querySelectorAll('.sidebar-section.drop-before, .sidebar-section.drop-after').forEach(el => {
    el.classList.remove('drop-before', 'drop-after');
  });
  document.getElementById('sidebar-drop-end')?.classList.remove('drop-active');
}
