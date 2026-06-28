import { sendCmdSilent } from '../net.js';

let activeCorpseId = null;
let activeCorpseName = null;
let lootDraggedId = null;
let lootDraggedCorpseId = null;
let lootDraggedQty = 1;

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

// Resolve to qty or null (cancelled). Skips dialog for non-stacked items.
function promptQty(max) {
  if (max <= 1) return Promise.resolve(max);
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'qty-dialog-overlay';
    overlay.innerHTML = `
      <div class="qty-dialog">
        <div class="qty-dialog-label">How many? (1–${max})</div>
        <input class="qty-dialog-input" type="number" min="1" max="${max}" value="${max}">
        <div class="qty-dialog-btns">
          <button class="qty-dialog-ok">Take</button>
          <button class="qty-dialog-cancel">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('.qty-dialog-input');
    input.focus();
    input.select();
    const finish = (qty) => { overlay.remove(); resolve(qty); };
    overlay.querySelector('.qty-dialog-ok').onclick = () => {
      const v = Math.min(max, Math.max(1, parseInt(input.value, 10) || 1));
      finish(v);
    };
    overlay.querySelector('.qty-dialog-cancel').onclick = () => finish(null);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') overlay.querySelector('.qty-dialog-ok').click();
      if (e.key === 'Escape') finish(null);
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(null); });
  });
}

function lootCmd(itemId, corpseId, qty) {
  const name = activeCorpseName ? ' ' + activeCorpseName : '';
  const qtyPart = qty != null ? ` ${qty}` : '';
  sendCmdSilent(`lootid ${itemId} ${corpseId}${qtyPart}${name}`);
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
    btn.onclick = async (e) => {
      e.stopPropagation();
      const qty = await promptQty(item.quantity);
      if (qty != null) lootCmd(item.id, corpseId, item.quantity > 1 ? qty : null);
    };
    card.appendChild(btn);
    card.ondragstart = (e) => {
      lootDraggedId = item.id;
      lootDraggedCorpseId = corpseId;
      lootDraggedQty = item.quantity;
      e.dataTransfer.effectAllowed = 'move';
    };
    card.ondragend = () => { lootDraggedId = null; lootDraggedCorpseId = null; lootDraggedQty = 1; };
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
  invList.addEventListener('drop', async (e) => {
    e.preventDefault();
    invList.classList.remove('ctr-drag-over');
    if (lootDraggedId && lootDraggedCorpseId) {
      const dragId = lootDraggedId;
      const dragCorpseId = lootDraggedCorpseId;
      const dragQty = lootDraggedQty;
      lootDraggedId = null;
      lootDraggedCorpseId = null;
      lootDraggedQty = 1;
      const qty = await promptQty(dragQty);
      if (qty != null) lootCmd(dragId, dragCorpseId, dragQty > 1 ? qty : null);
    }
  });
}
