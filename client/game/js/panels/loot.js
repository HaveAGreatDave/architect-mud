import { sendCmdSilent } from '../net.js';

let activeCorpseId = null;
let activeCorpseName = null;
let lootDraggedId = null;
let lootDraggedCorpseId = null;

export function openLootPanel(data) {
  activeCorpseId = data.corpseId;
  activeCorpseName = data.corpseName || null;
  renderLootPanel(data);
  document.getElementById('loot-panel').classList.add('active');
}

export function refreshLootPanel(data) {
  if (!document.getElementById('loot-panel').classList.contains('active')) return;
  activeCorpseId = data.corpseId;
  activeCorpseName = data.corpseName || null;
  renderLootPanel(data);
}

export function closeLootPanel() {
  const cid = activeCorpseId;
  document.getElementById('loot-panel').classList.remove('active');
  activeCorpseId = null;
  activeCorpseName = null;
  if (cid) sendCmdSilent(`closeloot ${cid}`);
}

export function getActiveCorpseId() { return activeCorpseId; }

function formatWeight(g) {
  g = Number(g) || 0;
  if (g < 1000) return `${Math.round(g)}g`;
  return `${(Math.round(g / 100) / 10).toString()}kg`;
}

function buildItemCard(item, source, corpseId) {
  const card = document.createElement('div');
  card.className = 'ctr-item-card';
  card.setAttribute('data-id', item.id);
  const qty = item.quantity > 1 ? ` x${item.quantity}` : '';
  const wt = item.weight != null ? ` ${formatWeight(item.weight)}` : '';
  card.innerHTML = `<span class="ctr-name">${item.name}${qty}</span><span class="ctr-meta">${item.rarity || ''}${wt}</span>`;

  if (source === 'corpse') {
    card.setAttribute('draggable', 'true');
    const btn = document.createElement('button');
    btn.className = 'ctr-action-btn';
    btn.textContent = 'take';
    btn.title = 'Take from corpse';
    btn.onclick = (e) => { e.stopPropagation(); sendCmdSilent(`lootid ${item.id} ${corpseId}${activeCorpseName ? ' ' + activeCorpseName : ''}`); };
    card.appendChild(btn);
    card.ondragstart = (e) => {
      lootDraggedId = item.id;
      lootDraggedCorpseId = corpseId;
      e.dataTransfer.effectAllowed = 'move';
    };
    card.ondragend = () => { lootDraggedId = null; lootDraggedCorpseId = null; };
  }
  return card;
}

function renderLootPanel(data) {
  document.getElementById('loot-title').textContent = data.corpseName;
  document.getElementById('loot-contents-label').textContent = data.corpseName;
  document.getElementById('loot-notify').textContent = data.notify || '';

  // Left column: corpse contents
  const corpseList = document.getElementById('loot-contents-list');
  corpseList.innerHTML = '';
  for (const item of data.items || []) {
    corpseList.appendChild(buildItemCard(item, 'corpse', data.corpseId));
  }
  if (!(data.items || []).length) {
    const empty = document.createElement('div');
    empty.className = 'ctr-meta';
    empty.textContent = 'Nothing left to loot.';
    corpseList.appendChild(empty);
  }

  // Right column: player inventory
  const invList = document.getElementById('loot-inv-list');
  invList.innerHTML = '';
  for (const item of data.invItems || []) {
    invList.appendChild(buildItemCard(item, 'inv', null));
  }

  document.getElementById('loot-butcher').style.display = data.butcherable ? '' : 'none';
}

function moveAllLootToInv() {
  const corpseList = document.getElementById('loot-contents-list');
  const invList = document.getElementById('loot-inv-list');
  const cards = [...corpseList.querySelectorAll('.ctr-item-card')];
  for (const card of cards) {
    card.querySelector('.ctr-action-btn')?.remove();
    card.removeAttribute('draggable');
    invList.appendChild(card);
  }
  if (cards.length) {
    corpseList.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'ctr-meta';
    empty.textContent = 'Nothing left to loot.';
    corpseList.appendChild(empty);
  }
}

export function initLootPanel() {
  document.getElementById('loot-close').addEventListener('click', closeLootPanel);
  document.getElementById('loot-close-btn').addEventListener('click', closeLootPanel);
  document.getElementById('loot-panel').addEventListener('click', (e) => {
    if (e.target.id === 'loot-panel') closeLootPanel();
  });
  document.getElementById('loot-butcher').addEventListener('click', () => {
    if (activeCorpseId) sendCmdSilent(`butcher ${activeCorpseId}`);
  });
  document.getElementById('loot-take-all').addEventListener('click', () => {
    if (activeCorpseId) { moveAllLootToInv(); sendCmdSilent(`lootall ${activeCorpseId}${activeCorpseName ? ' ' + activeCorpseName : ''}`); }
  });
  document.getElementById('loot-transfer-all').addEventListener('click', () => {
    if (activeCorpseId) { moveAllLootToInv(); sendCmdSilent(`lootall ${activeCorpseId}${activeCorpseName ? ' ' + activeCorpseName : ''}`); }
  });

  // Drag corpse item (left) → drop on inventory (right) → take it
  const invList = document.getElementById('loot-inv-list');
  invList.addEventListener('dragover', (e) => e.preventDefault());
  invList.addEventListener('dragenter', () => invList.classList.add('ctr-drag-over'));
  invList.addEventListener('dragleave', () => invList.classList.remove('ctr-drag-over'));
  invList.addEventListener('drop', (e) => {
    e.preventDefault();
    invList.classList.remove('ctr-drag-over');
    if (lootDraggedId && lootDraggedCorpseId) {
      sendCmdSilent(`lootid ${lootDraggedId} ${lootDraggedCorpseId}${activeCorpseName ? ' ' + activeCorpseName : ''}`);
    }
    lootDraggedId = null;
    lootDraggedCorpseId = null;
  });
}
