import { sendCmdSilent } from '../net.js';

let activeCorpseId = null;
let activeCorpseName = null;
let lootDraggedId = null;
let lootDraggedSource = null; // 'corpse' or 'inv'
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

function promptQty(max, action) {
  if (max <= 1) return Promise.resolve(max);
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'qty-dialog-overlay';
    overlay.innerHTML = `
      <div class="qty-dialog">
        <div class="qty-dialog-label">How many? (1–${max})</div>
        <input class="qty-dialog-input" type="number" min="1" max="${max}" value="${max}">
        <div class="qty-dialog-btns">
          <button class="qty-dialog-ok">${action || 'OK'}</button>
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
      const q = await promptQty(item.quantity, 'Take');
      if (q != null) lootCmd(item.id, corpseId, item.quantity > 1 ? q : null);
    };
    card.appendChild(btn);
    card.ondragstart = (e) => {
      lootDraggedId = item.id;
      lootDraggedSource = 'corpse';
      lootDraggedCorpseId = corpseId;
      lootDraggedQty = item.quantity;
      e.dataTransfer.effectAllowed = 'move';
    };
    card.ondragend = () => { lootDraggedId = null; lootDraggedSource = null; lootDraggedCorpseId = null; lootDraggedQty = 1; };
  } else {
    card.setAttribute('draggable', 'true');
    const btn = document.createElement('button');
    btn.className = 'ctr-action-btn';
    btn.textContent = 'stow';
    btn.title = 'Put on corpse';
    btn.onclick = async (e) => {
      e.stopPropagation();
      const q = await promptQty(item.quantity, 'Stow');
      if (q != null) {
        const qtyPart = item.quantity > 1 ? ` ${q}` : '';
        sendCmdSilent(`stowid ${item.id} ${corpseId}${qtyPart}`);
      }
    };
    card.appendChild(btn);
    card.ondragstart = (e) => {
      lootDraggedId = item.id;
      lootDraggedSource = 'inv';
      lootDraggedCorpseId = corpseId;
      lootDraggedQty = item.quantity;
      e.dataTransfer.effectAllowed = 'move';
    };
    card.ondragend = () => { lootDraggedId = null; lootDraggedSource = null; lootDraggedCorpseId = null; lootDraggedQty = 1; };
  }
  return card;
}

function renderLootPanel(data) {
  document.getElementById('loot-title').textContent = data.corpseName;
  document.getElementById('loot-contents-label').textContent = data.corpseName;
  document.getElementById('loot-notify').textContent = data.notify || '';

  const corpseItems = (data.items || []).filter(i => i.id !== data.corpseId);
  const invItems = (data.invItems || []).filter(i => i.id !== data.corpseId);

  const corpseList = document.getElementById('loot-contents-list');
  corpseList.innerHTML = '';
  for (const item of corpseItems) {
    corpseList.appendChild(buildItemCard(item, 'corpse', data.corpseId));
  }
  if (!corpseItems.length) {
    const empty = document.createElement('div');
    empty.className = 'ctr-meta';
    empty.textContent = 'Nothing left to loot.';
    corpseList.appendChild(empty);
  }

  const invList = document.getElementById('loot-inv-list');
  invList.innerHTML = '';
  for (const item of invItems) {
    invList.appendChild(buildItemCard(item, 'inv', data.corpseId));
  }

  document.getElementById('loot-butcher').style.display = data.butcherable ? '' : 'none';
  document.getElementById('loot-take-all').style.display = corpseItems.length ? '' : 'none';
  document.getElementById('loot-stow-all').style.display = invItems.length ? '' : 'none';
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
    if (!activeCorpseId) return;
    sendCmdSilent(`lootall ${activeCorpseId}${activeCorpseName ? ' ' + activeCorpseName : ''}`);
  });
  document.getElementById('loot-stow-all').addEventListener('click', () => {
    if (!activeCorpseId) return;
    const cards = document.getElementById('loot-inv-list').querySelectorAll('.ctr-item-card');
    for (const card of cards) {
      sendCmdSilent(`stowid ${card.getAttribute('data-id')} ${activeCorpseId}`);
    }
  });

  const invList = document.getElementById('loot-inv-list');
  const corpseList = document.getElementById('loot-contents-list');

  // Drop corpse item onto inv → take
  invList.addEventListener('dragover', (e) => e.preventDefault());
  invList.addEventListener('dragenter', () => invList.classList.add('ctr-drag-over'));
  invList.addEventListener('dragleave', () => invList.classList.remove('ctr-drag-over'));
  invList.addEventListener('drop', async (e) => {
    e.preventDefault();
    invList.classList.remove('ctr-drag-over');
    if (lootDraggedId && lootDraggedSource === 'corpse') {
      const dragId = lootDraggedId;
      const dragCorpseId = lootDraggedCorpseId;
      const dragQty = lootDraggedQty;
      lootDraggedId = null; lootDraggedSource = null; lootDraggedCorpseId = null; lootDraggedQty = 1;
      const q = await promptQty(dragQty, 'Take');
      if (q != null) lootCmd(dragId, dragCorpseId, dragQty > 1 ? q : null);
    }
  });

  // Drop inv item onto corpse → stow
  corpseList.addEventListener('dragover', (e) => e.preventDefault());
  corpseList.addEventListener('dragenter', () => corpseList.classList.add('ctr-drag-over'));
  corpseList.addEventListener('dragleave', () => corpseList.classList.remove('ctr-drag-over'));
  corpseList.addEventListener('drop', async (e) => {
    e.preventDefault();
    corpseList.classList.remove('ctr-drag-over');
    if (lootDraggedId && lootDraggedSource === 'inv') {
      const dragId = lootDraggedId;
      const dragCorpseId = lootDraggedCorpseId;
      const dragQty = lootDraggedQty;
      lootDraggedId = null; lootDraggedSource = null; lootDraggedCorpseId = null; lootDraggedQty = 1;
      const q = await promptQty(dragQty, 'Stow');
      if (q != null) {
        const qtyPart = dragQty > 1 ? ` ${q}` : '';
        sendCmdSilent(`stowid ${dragId} ${dragCorpseId}${qtyPart}`);
      }
    }
  });
}
