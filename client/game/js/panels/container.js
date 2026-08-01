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

// Holding temperature shown on a compartment's little LED readout, keyed by
// the `preserves` tier the server reports for that box. A compartment with no
// tier (an ordinary crate) shows nothing at all.
// The reading is split into digits + unit so the display can size them
// separately — big tabular numerals, small unit — the way an appliance panel
// does it. `mode` names the setpoint the way the unit's own controls would.
const TIER_TEMP = {
  refrigerated: { value: '4', unit: '°C', mode: 'chill' },
  frozen: { value: '-18', unit: '°C', mode: 'freeze' },
};

function setTemp(elId, preserves) {
  const el = document.getElementById(elId);
  if (!el) return;
  const t = TIER_TEMP[preserves];
  el.innerHTML = t
    ? `<span class="ctr-temp-mode">${t.mode}</span>` +
      `<span class="ctr-temp-val">${t.value}</span>` +
      `<span class="ctr-temp-unit">${t.unit}</span>`
    : '';
  el.classList.toggle('active', !!t);
  el.classList.toggle('ctr-temp-frozen', preserves === 'frozen');
}

// Capacity readout + its load gauge (the `--fill` the CSS bar draws to).
function setCapacity(elId, used, capacity) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = `Capacity: ${formatWeight(used)} / ${formatWeight(capacity)}`;
  const pct = capacity > 0 ? Math.min(100, Math.round((used / capacity) * 100)) : 0;
  el.style.setProperty('--fill', `${pct}%`);
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

// One tab per compartment of the piece of furniture you have open. The server
// sends the whole set with `active` marked; there is no client-side selection
// state, because switching just re-opens and the next payload is the truth.
function renderCompartmentTabs(compartments) {
  const strip = document.getElementById('container-tabs');
  if (!strip) return;
  strip.innerHTML = '';
  const tabs = compartments || [];
  strip.classList.toggle('active', tabs.length > 1);
  if (tabs.length < 2) return;
  for (const c of tabs) {
    const b = document.createElement('button');
    b.className = 'ctr-tab' + (c.active ? ' active' : '');
    b.textContent = c.label;
    b.title = c.name;
    // Re-opening the shelf you're already on would just re-render the same
    // thing over the network; ignore it.
    if (!c.active) b.onclick = () => sendCmdSilent(`opencontainer ${c.id}`);
    strip.appendChild(b);
  }
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
  setTemp('container-temp', isCold ? fridge.preserves : null);
  setTemp('container-freezer-temp', freezer ? freezer.preserves : null);
  const fx = document.getElementById('container-cold-fx');
  if (isOpen && isCold) {
    fx.classList.remove('play');
    void fx.offsetWidth; // restart the animation even if replayed back-to-back
    fx.classList.add('play');
  } else if (!isOpen) {
    fx.classList.remove('play');
  }

  // Compartments — the shelves of one cabinet, one tab each. Switching is an
  // ordinary `opencontainer`, the same round trip every stow already makes, so
  // there is no second state to keep in sync: whatever comes back IS the view.
  const tabs = data.compartments || [];
  renderCompartmentTabs(tabs);

  // Title the PIECE, not the shelf: the parent is always the first tab, so a
  // cabinet stays "Wall Cabinet" whichever shelf you're looking at, and the
  // shelf names itself on its tab and over its list.
  document.getElementById('container-title').textContent = tabs.length ? tabs[0].name : fridge.name;
  // The unit's name is already the panel title; repeating it over every
  // compartment just reads as noise. Inside a cold cabinet the compartments
  // name themselves, the way the labels on a real appliance do. Ordinary
  // containers keep the server-supplied name.
  document.getElementById('container-contents-label').textContent =
    tabs.length ? (tabs.find(t => t.active)?.label || fridge.name)
    : isCold ? (fridge.preserves === 'frozen' ? 'Freezer' : 'Fresh Food')
    : fridge.name;
  setCapacity('container-capacity', fridge.usedWeight, fridge.capacity);
  const notify = document.getElementById('container-notify');
  if (notify) notify.textContent = data.notify || '';

  fridgeBoxId = fridge.containerId;
  freezerBoxId = freezer ? freezer.containerId : null;

  const invItems = (data.invItems || []).filter(i => i.id !== data.containerId && i.id !== data.secondary?.containerId);
  const fridgeItems = fridge.items.filter(i => i.id !== fridge.containerId);
  renderList('container-inv-list', invItems, 'inv', fridge.containerId);
  // A cold box lists only what spoils (the server filters it), so the column
  // says why rather than reading as an empty pack.
  const invLabel = document.querySelector('#container-inv-col .container-section-label');
  if (invLabel) invLabel.textContent = data.invNote ? 'Your Inventory — perishables' : 'Your Inventory';
  const invNote = document.getElementById('container-inv-note');
  if (invNote) invNote.textContent = data.invNote || '';
  renderList('container-contents-list', fridgeItems, 'contents', fridge.containerId);

  const freezerBox = document.getElementById('container-freezer-box');
  if (freezer) {
    freezerBox.classList.add('active', 'ctr-frost');
    document.getElementById('container-freezer-label').textContent =
      isCold ? 'Freezer' : freezer.name;
    setCapacity('container-freezer-capacity', freezer.usedWeight, freezer.capacity);
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

// ── The item action menu ─────────────────────────────────────────────────────
// What you can do with the thing you just clicked, derived from its TAGS rather
// than from a hardcoded list — the same tags the engine gates its specialized
// actions on, so the menu can't offer a verb the server will refuse, and a new
// tagged item type gets its verb here for free.
//
// Everything routes through ordinary commands. This is a shortcut to typing, not
// a second implementation of anything, which is why an unknown item still gets
// Examine and Drop and nothing is ever unreachable.
const ITEM_ACTIONS = [
  // tag            label        command builder                 needs to be held?
  { tag: 'consumable', label: 'Eat',      cmd: (n) => `eat ${n}`,      held: true },
  { tag: 'drug',       label: 'Use',      cmd: (n) => `use ${n}`,      held: true },
  { tag: 'drinkware',  label: 'Drink',    cmd: (n) => `drink ${n}`,    held: true },
  { tag: 'fillable',   label: 'Fill',     cmd: (n) => `fill ${n}`,     held: true },
  { tag: 'slot',       label: 'Wear',     cmd: (n) => `wear ${n}`,     held: true },
  { tag: 'readable',   label: 'Read',     cmd: (n) => `read ${n}`,     held: false },
  { tag: 'container',  label: 'Open',     cmd: (n) => `open ${n}`,     held: false },
];

function closeItemActions() {
  document.querySelector('.ctr-actions-pop')?.remove();
  document.removeEventListener('click', onDocCloseActions, true);
}
function onDocCloseActions(e) {
  if (e.target.closest('.ctr-actions-pop') || e.target.closest('.ctr-item-card')) return;
  closeItemActions();
}

function openItemActions(item, source, containerId, anchor) {
  closeItemActions();
  const tags = item.tags || {};
  const inBox = source !== 'inv';
  const name = item.name;

  const rows = [];
  // Move first: it is what the panel is for, and it is what most clicks want.
  rows.push(inBox
    ? { label: 'Take out', run: async () => {
        const q = await promptQty(item.quantity, 'Take');
        if (q != null) sendCmdSilent(`pullid ${item.id}${item.quantity > 1 ? ` ${q}` : ''}`);
      } }
    : { label: 'Put in', run: async () => {
        const q = await promptQty(item.quantity, 'Stow');
        if (q != null) sendCmdSilent(`stowid ${item.id} ${containerId}${item.quantity > 1 ? ` ${q}` : ''}`);
      } });

  for (const a of ITEM_ACTIONS) {
    if (!tags[a.tag]) continue;
    // A verb that acts on something you're HOLDING can't reach into the box, so
    // it takes the item out first and then acts. Stating that in the label beats
    // offering a button that quietly does nothing.
    rows.push(a.held && inBox
      ? { label: `${a.label} (take out first)`, run: () => { sendCmdSilent(`pullid ${item.id}`); setTimeout(() => sendCmdSilent(a.cmd(name)), 120); } }
      : { label: a.label, run: () => sendCmdSilent(a.cmd(name)) });
  }
  rows.push({ label: 'Examine', run: () => sendCmdSilent(`examine ${name}`) });
  if (!inBox) rows.push({ label: 'Drop', run: () => sendCmdSilent(`drop ${name}`) });

  const pop = document.createElement('div');
  pop.className = 'ctr-actions-pop';
  pop.innerHTML = `<div class="ctr-actions-head">${name}</div>`;
  for (const r of rows) {
    const b = document.createElement('button');
    b.className = 'ctr-actions-item';
    b.textContent = r.label;
    b.onclick = (e) => { e.stopPropagation(); closeItemActions(); r.run(); };
    pop.appendChild(b);
  }
  anchor.appendChild(pop);
  // Deferred, or the click that opened this menu closes it on the way back up.
  setTimeout(() => document.addEventListener('click', onDocCloseActions, true), 0);
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
    // Quantity is its own badge rather than inline text, so a stack reads at a
    // glance and the name keeps a single clean baseline.
    const qty = item.quantity > 1 ? `<span class="ctr-qty">×${item.quantity}</span>` : '';
    const wt = item.weight != null ? `<span class="ctr-meta">${formatWeight(item.weight)}</span>` : '';
    card.innerHTML = `<span class="ctr-name">${item.name}</span>${qty}${wt}`;

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

    // Clicking the item itself opens what you can DO with it. A container panel
    // that only knows "stow" and "take" makes you close it, type `examine`, and
    // open it again to do anything real — so the box became a filing cabinet
    // instead of a place your things live.
    card.onclick = (e) => {
      if (e.target.closest('.ctr-action-btn')) return;   // the move button owns its own click
      openItemActions(item, source, containerId, card);
    };

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
