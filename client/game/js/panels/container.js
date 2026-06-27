import { sendCmdSilent } from '../net.js';

let containerDraggedId = null;
let containerDragSource = null; // 'inv' or 'contents'
let dragHandled = false;
let activeContainerId = null;

export function openContainerPanel(data) {
  activeContainerId = data.containerId;
  renderContainerPanel(data);
  document.getElementById('container-panel').classList.add('active');
}

export function refreshContainerPanel(data) {
  if (!document.getElementById('container-panel').classList.contains('active')) return;
  activeContainerId = data.containerId;
  renderContainerPanel(data);
}

export function closeContainerPanel() {
  const cid = activeContainerId;
  document.getElementById('container-panel').classList.remove('active');
  activeContainerId = null;
  if (cid) sendCmdSilent(`closecontainer ${cid}`);
}

export function showContainerNotify(msg) {
  const el = document.getElementById('container-notify');
  if (!el) return;
  el.textContent = msg;
}

export function getActiveContainerId() { return activeContainerId; }

// Format a weight given in grams: "750g" below 1000g, "1.5kg" at/above (trailing .0 trimmed).
function formatWeight(g) {
  g = Number(g) || 0;
  if (g < 1000) return `${Math.round(g)}g`;
  return `${(Math.round(g / 100) / 10).toString()}kg`;
}

function renderContainerPanel(data) {
  document.getElementById('container-title').textContent = data.containerName;
  document.getElementById('container-contents-label').textContent = data.containerName;
  document.getElementById('container-capacity').textContent =
    `Capacity: ${formatWeight(data.usedWeight)} / ${formatWeight(data.capacity)}`;
  const notify = document.getElementById('container-notify');
  if (notify) notify.textContent = data.notify || '';

  renderList('container-inv-list', data.invItems || [], 'inv', data.containerId);
  renderList('container-contents-list', data.containerItems || [], 'contents', data.containerId);
}

function renderList(listId, items, source, containerId) {
  const list = document.getElementById(listId);
  list.innerHTML = '';
  for (const item of items) {
    const card = document.createElement('div');
    card.className = 'ctr-item-card';
    card.setAttribute('draggable', 'true');
    card.setAttribute('data-id', item.id);
    card.setAttribute('data-source', source);
    const qty = item.quantity > 1 ? ` x${item.quantity}` : '';
    const wt = item.weight != null ? ` ${formatWeight(item.weight)}` : '';
    card.innerHTML = `<span class="ctr-name">${item.name}${qty}</span><span class="ctr-meta">${item.rarity || ''}${wt}</span>`;

    if (source === 'inv') {
      const btn = document.createElement('button');
      btn.className = 'ctr-action-btn';
      btn.textContent = 'stow';
      btn.title = 'Put into container';
      btn.onclick = (e) => { e.stopPropagation(); sendCmdSilent(`stowid ${item.id} ${containerId}`); };
      card.appendChild(btn);
    } else {
      const btn = document.createElement('button');
      btn.className = 'ctr-action-btn';
      btn.textContent = 'take';
      btn.title = 'Take from container';
      btn.onclick = (e) => { e.stopPropagation(); sendCmdSilent(`pullid ${item.id}`); };
      card.appendChild(btn);
    }

    card.ondragstart = (e) => {
      containerDraggedId = item.id;
      containerDragSource = source;
      dragHandled = false;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    };
    card.ondragend = () => card.classList.remove('dragging');
    list.appendChild(card);
  }
}

export function initContainerPanel() {
  document.getElementById('container-close').addEventListener('click', closeContainerPanel);
  document.getElementById('container-panel').addEventListener('click', (e) => {
    if (e.target.id === 'container-panel') closeContainerPanel();
  });

  const invList = document.getElementById('container-inv-list');
  const contentsList = document.getElementById('container-contents-list');

  // Drop onto contents list → stow
  contentsList.addEventListener('dragover', (e) => e.preventDefault());
  contentsList.addEventListener('dragenter', () => contentsList.classList.add('ctr-drag-over'));
  contentsList.addEventListener('dragleave', () => contentsList.classList.remove('ctr-drag-over'));
  contentsList.addEventListener('drop', (e) => {
    e.preventDefault();
    contentsList.classList.remove('ctr-drag-over');
    dragHandled = true;
    if (containerDraggedId && containerDragSource === 'inv' && activeContainerId) {
      sendCmdSilent(`stowid ${containerDraggedId} ${activeContainerId}`);
    }
    containerDraggedId = null;
  });

  // Drop onto inv list → pull
  invList.addEventListener('dragover', (e) => e.preventDefault());
  invList.addEventListener('dragenter', () => invList.classList.add('ctr-drag-over'));
  invList.addEventListener('dragleave', () => invList.classList.remove('ctr-drag-over'));
  invList.addEventListener('drop', (e) => {
    e.preventDefault();
    invList.classList.remove('ctr-drag-over');
    dragHandled = true;
    if (containerDraggedId && containerDragSource === 'contents') {
      sendCmdSilent(`pullid ${containerDraggedId}`);
    }
    containerDraggedId = null;
  });

  document.addEventListener('dragend', () => {
    dragHandled = false;
    containerDraggedId = null;
    containerDragSource = null;
  });
}
