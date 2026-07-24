import { sendCmdSilent } from '../net.js';

let containerDraggedId = null;
let containerDragSource = null; // 'inv' or 'contents'
let containerDraggedQty = 1;
let dragHandled = false;
let activeContainerId = null;   // the id used for `closecontainer` on close (whichever box was opened)
let fridgeBoxId = null;         // stow target for the main contents list (== activeContainerId unless paired)
let freezerBoxId = null;        // stow target for the freezer sub-box, null when this container has no pair

export function openContainerPanel(data) {
  activeContainerId = data.containerId;
  renderContainerPanel(data, { isOpen: true });
  document.getElementById('container-panel').classList.add('active');
}

export function refreshContainerPanel(data) {
  if (!document.getElementById('container-panel').classList.contains('active')) return;
  activeContainerId = data.containerId;
  renderContainerPanel(data, { isOpen: false });
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

function renderContainerPanel(data, { isOpen = false } = {}) {
  // A paired container (e.g. a fridge with a separate freezer box) surfaces
  // both boxes in this ONE view — role is decided by `preserves`, not by
  // which one was actually opened, so the layout never swaps sides depending
  // on which box a stow/pull last refreshed.
  const primary = { containerId: data.containerId, name: data.containerName, capacity: data.capacity, usedWeight: data.usedWeight, items: data.containerItems || [], preserves: data.preserves, applianceGrade: data.applianceGrade };
  const secondary = data.secondary ? { containerId: data.secondary.containerId, name: data.secondary.containerName, capacity: data.secondary.capacity, usedWeight: data.secondary.usedWeight, items: data.secondary.containerItems || [], preserves: data.secondary.preserves, applianceGrade: data.secondary.applianceGrade } : null;

  let fridge = primary, freezer = null;
  if (secondary) {
    if (primary.preserves === 'frozen' && secondary.preserves !== 'frozen') { freezer = primary; fridge = secondary; }
    else if (secondary.preserves === 'frozen') { freezer = secondary; fridge = primary; }
  }

  // Cold-appliance theming: only for an actual preserving fridge/freezer, not
  // a normal crate/bag. Grade comes from whichever box has one set.
  const isCold = !!(fridge.preserves || (freezer && freezer.preserves));
  const grade = fridge.applianceGrade || (freezer && freezer.applianceGrade) || null;
  const box = document.getElementById('container-box');
  box.classList.toggle('ctr-theme-consumer', isCold && grade === 'consumer');
  box.classList.toggle('ctr-theme-commercial', isCold && grade === 'commercial');
  const fx = document.getElementById('container-cold-fx');
  if (isOpen && isCold) {
    fx.classList.remove('play');
    void fx.offsetWidth; // restart the animation even if replayed back-to-back
    fx.classList.add('play');
  } else if (!isOpen) {
    fx.classList.remove('play');
  }

  document.getElementById('container-title').textContent = fridge.name;
  document.getElementById('container-contents-label').textContent = fridge.name;
  document.getElementById('container-capacity').textContent =
    `Capacity: ${formatWeight(fridge.usedWeight)} / ${formatWeight(fridge.capacity)}`;
  const notify = document.getElementById('container-notify');
  if (notify) notify.textContent = data.notify || '';

  fridgeBoxId = fridge.containerId;
  freezerBoxId = freezer ? freezer.containerId : null;

  const invItems = (data.invItems || []).filter(i => i.id !== data.containerId && i.id !== data.secondary?.containerId);
  const fridgeItems = fridge.items.filter(i => i.id !== fridge.containerId);
  renderList('container-inv-list', invItems, 'inv', fridge.containerId);
  renderList('container-contents-list', fridgeItems, 'contents', fridge.containerId);

  const freezerBox = document.getElementById('container-freezer-box');
  if (freezer) {
    freezerBox.classList.add('active', 'ctr-frost');
    document.getElementById('container-freezer-label').textContent = freezer.name;
    document.getElementById('container-freezer-capacity').textContent =
      `Capacity: ${formatWeight(freezer.usedWeight)} / ${formatWeight(freezer.capacity)}`;
    const freezerItems = freezer.items.filter(i => i.id !== freezer.containerId);
    renderList('container-freezer-list', freezerItems, 'contents', freezer.containerId);
  } else {
    freezerBox.classList.remove('active', 'ctr-frost');
    document.getElementById('container-freezer-list').innerHTML = '';
  }

  const allContentsCount = fridgeItems.length + (freezer ? freezer.items.length : 0);
  document.getElementById('container-stow-all').style.display = (invItems.length && !freezer) ? '' : 'none'; // ambiguous target when paired — use per-item stow or drag instead
  document.getElementById('container-take-all').style.display = allContentsCount ? '' : 'none';
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
    card.innerHTML = `<span class="ctr-name">${item.name}${qty}</span><span class="ctr-meta">${wt}</span>`;

    if (source === 'inv') {
      const btn = document.createElement('button');
      btn.className = 'ctr-action-btn';
      btn.textContent = 'stow';
      btn.title = 'Put into container';
      btn.onclick = async (e) => {
        e.stopPropagation();
        const qty = await promptQty(item.quantity, 'Stow');
        if (qty != null) {
          const qtyPart = item.quantity > 1 ? ` ${qty}` : '';
          sendCmdSilent(`stowid ${item.id} ${containerId}${qtyPart}`);
        }
      };
      card.appendChild(btn);
    } else {
      const btn = document.createElement('button');
      btn.className = 'ctr-action-btn';
      btn.textContent = 'take';
      btn.title = 'Take from container';
      btn.onclick = async (e) => {
        e.stopPropagation();
        const qty = await promptQty(item.quantity, 'Take');
        if (qty != null) {
          const qtyPart = item.quantity > 1 ? ` ${qty}` : '';
          sendCmdSilent(`pullid ${item.id}${qtyPart}`);
        }
      };
      card.appendChild(btn);
    }

    card.ondragstart = (e) => {
      containerDraggedId = item.id;
      containerDragSource = source;
      containerDraggedQty = item.quantity;
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
  document.getElementById('container-close-btn').addEventListener('click', closeContainerPanel);
  document.getElementById('container-panel').addEventListener('click', (e) => {
    if (e.target.id === 'container-panel') closeContainerPanel();
  });

  document.getElementById('container-stow-all').addEventListener('click', () => {
    if (!fridgeBoxId) return;
    const cards = document.getElementById('container-inv-list').querySelectorAll('.ctr-item-card');
    for (const card of cards) {
      sendCmdSilent(`stowid ${card.getAttribute('data-id')} ${fridgeBoxId}`);
    }
  });

  document.getElementById('container-take-all').addEventListener('click', () => {
    const lists = ['container-contents-list', 'container-freezer-list'];
    for (const listId of lists) {
      const cards = document.getElementById(listId).querySelectorAll('.ctr-item-card');
      for (const card of cards) sendCmdSilent(`pullid ${card.getAttribute('data-id')}`);
    }
  });

  const invList = document.getElementById('container-inv-list');
  const contentsList = document.getElementById('container-contents-list');
  const freezerList = document.getElementById('container-freezer-list');

  // Dropping an inventory item into a contents box stows it in THAT box
  // specifically (fridge vs. freezer) — `getTargetId` is read live at drop
  // time so it always reflects whichever box is currently rendered there.
  function wireStowDropZone(listEl, getTargetId) {
    listEl.addEventListener('dragover', (e) => e.preventDefault());
    listEl.addEventListener('dragenter', () => listEl.classList.add('ctr-drag-over'));
    listEl.addEventListener('dragleave', () => listEl.classList.remove('ctr-drag-over'));
    listEl.addEventListener('drop', async (e) => {
      e.preventDefault();
      listEl.classList.remove('ctr-drag-over');
      dragHandled = true;
      const targetId = getTargetId();
      if (containerDraggedId && containerDragSource === 'inv' && targetId) {
        const dragId = containerDraggedId;
        const dragQty = containerDraggedQty;
        containerDraggedId = null;
        const qty = await promptQty(dragQty, 'Stow');
        if (qty != null) {
          const qtyPart = dragQty > 1 ? ` ${qty}` : '';
          sendCmdSilent(`stowid ${dragId} ${targetId}${qtyPart}`);
        }
      } else {
        containerDraggedId = null;
      }
    });
  }
  wireStowDropZone(contentsList, () => fridgeBoxId);
  wireStowDropZone(freezerList, () => freezerBoxId);

  invList.addEventListener('dragover', (e) => e.preventDefault());
  invList.addEventListener('dragenter', () => invList.classList.add('ctr-drag-over'));
  invList.addEventListener('dragleave', () => invList.classList.remove('ctr-drag-over'));
  invList.addEventListener('drop', async (e) => {
    e.preventDefault();
    invList.classList.remove('ctr-drag-over');
    dragHandled = true;
    if (containerDraggedId && containerDragSource === 'contents') {
      const dragId = containerDraggedId;
      const dragQty = containerDraggedQty;
      containerDraggedId = null;
      const qty = await promptQty(dragQty, 'Take');
      if (qty != null) {
        const qtyPart = dragQty > 1 ? ` ${qty}` : '';
        sendCmdSilent(`pullid ${dragId}${qtyPart}`);
      }
    } else {
      containerDraggedId = null;
    }
  });

  document.addEventListener('dragend', () => {
    dragHandled = false;
    containerDraggedId = null;
    containerDragSource = null;
    containerDraggedQty = 1;
  });
}
