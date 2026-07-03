import { state } from '../state.js';
import { sendCmd, sendCmdSilent } from '../net.js';

const EQUIP_SLOT_NAMES = ['head','torso','hands','weapon_hand','legs','feet','accessory'];
const LAYER_NAMES = ['', 'Skin', 'Base', 'Mid', 'Outer', 'Shell'];
let equipDraggedId = null;
let dragHandled = false;
let currentLayer = 1;
let lastItems = [];
let lastWeight = null;
let lastCapacity = null;

function formatWeight(g) {
  g = Number(g) || 0;
  if (g < 1000) return `${Math.round(g)}g`;
  return `${(Math.round(g / 100) / 10).toString()}kg`;
}

export function getEquippedWeaponName() {
  const w = lastItems.find(item => item.is_equipped && item.slot === 'weapon_hand');
  return w?.name || null;
}

export function openEquipPanel() {
  import('../net.js').then(m => m.sendCmd('inventory'));
}

export function closeEquipPanel() {
  document.getElementById('equip-panel').classList.remove('active');
}

function itemLayerRange(item) {
  const lr = (item.tags || {}).allowed_layer_range;
  if (lr && typeof lr === 'object') return lr;
  return null;
}

// Returns 'bright' | 'dim' | 'hidden'
function itemLayerVisibility(item, layer) {
  const lr = itemLayerRange(item);
  if (!lr) return 'bright';
  if (layer === lr.max) return 'bright';
  if (layer >= lr.min && layer < lr.max) return 'dim';
  return 'hidden';
}

function updateLayerDisplay() {
  document.getElementById('equip-layer-name').textContent = `Layer ${currentLayer} — ${LAYER_NAMES[currentLayer]}`;
}

function rerenderLayer() { renderEquipPanel(lastItems); }

export function renderEquipPanel(items, weight, capacity) {
  lastItems = items;
  if (weight !== undefined) lastWeight = weight;
  if (capacity !== undefined) lastCapacity = capacity;
  updateLayerDisplay();

  for (const slotName of EQUIP_SLOT_NAMES) {
    const slotEl = document.querySelector(`.equip-slot[data-slot="${slotName}"] .equip-slot-item`);
    if (slotEl) {
      slotEl.className = 'equip-slot-item empty';
      slotEl.textContent = '(empty)';
      slotEl.removeAttribute('draggable');
      slotEl.removeAttribute('data-id');
    }
  }

  // For slots with multiple layers, show the item at currentLayer if present,
  // otherwise the highest-layer item at or below currentLayer.
  const equippedBySlot = {};
  const unequipped = [];
  for (const item of items) {
    if (item.is_equipped && item.slot) {
      // Only show the item in the slot if it's on the current layer exactly
      if ((item.layer || 1) === currentLayer) {
        equippedBySlot[item.slot] = item;
      }
    } else {
      unequipped.push(item);
    }
  }

  for (const [slotName, item] of Object.entries(equippedBySlot)) {
    const slotEl = document.querySelector(`.equip-slot[data-slot="${slotName}"] .equip-slot-item`);
    if (slotEl) {
      slotEl.className = 'equip-slot-item filled';
      slotEl.textContent = item.name + (item.quantity > 1 ? ` x${item.quantity}` : '');
      slotEl.setAttribute('draggable', 'true');
      slotEl.setAttribute('data-id', item.id);
      slotEl.ondragstart = (e) => onItemDragStart(e, item.id);
      slotEl.onclick = () => sendCmdSilent(`unequipid ${item.id}`);
      slotEl.title = 'Click or drag out to unequip';
    }
  }

  const list = document.getElementById('equip-inv-list');
  list.innerHTML = '';
  for (const item of unequipped) {
    const tags = item.tags || {};
    const equippable = !!tags.slot;
    const vis = itemLayerVisibility(item, currentLayer);
    const layerOk = vis !== 'hidden';
    const card = document.createElement('div');
    card.className = 'equip-item-card' + (equippable ? ' equippable' : '') + (layerOk ? '' : ' layer-incompat');
    card.setAttribute('draggable', 'true');
    card.setAttribute('data-id', item.id);
    const qty = item.quantity > 1 ? ` x${item.quantity}` : '';
    const slotLabel = tags.slot ? ` · ${tags.slot.replace('_',' ')}` : '';
    const layerIcon = equippable
      ? `<span class="eic-layer-icon ${layerOk ? 'compat' : 'incompat'}" title="${layerOk ? 'Can equip on this layer' : 'Wrong layer'}">${layerOk ? '✓' : '✗'}</span>`
      : '';
    card.innerHTML = `<span class="eic-name">${layerIcon}${item.name}${qty}</span><span class="eic-meta">${slotLabel}</span><button class="eic-drop-btn" title="Drop on ground"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="1" width="6" height="4" rx="0.5" stroke="currentColor" stroke-width="1.3"/><line x1="7" y1="5" x2="7" y2="8.5" stroke="currentColor" stroke-width="1.3"/><path d="M4.5 7.5 L7 10.5 L9.5 7.5" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round" stroke-linecap="round"/><line x1="2" y1="13" x2="12" y2="13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></button>`;
    card.ondragstart = (e) => onItemDragStart(e, item.id);
    card.ondragend = () => card.classList.remove('dragging');
    card.onclick = () => showItemDetail(item);
    card.querySelector('.eic-drop-btn').onclick = (e) => { e.stopPropagation(); dropItem(item); };
    list.appendChild(card);
  }

  document.getElementById('equip-credits-val').textContent = (state.player && state.player.credits) || 0;
  const wtEl = document.getElementById('equip-weight-val');
  if (wtEl && lastCapacity != null) {
    wtEl.textContent = `${formatWeight(lastWeight)}/${formatWeight(lastCapacity)}`;
  }
}

const SLOT_LABELS = {
  head: 'Head', torso: 'Torso', hands: 'Hands', weapon_hand: 'Weapon hand',
  legs: 'Legs', feet: 'Feet', accessory: 'Accessory',
};

// Human labels for verbs that come back from the server (availableActions).
const VERB_LABELS = { eat: 'Eat', drink: 'Drink', use: 'Use', open: 'Open', read: 'Read' };

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Build the conditional stat rows for the detail panel from the item's tags.
function itemStatRows(item) {
  const t = item.tags || {};
  const rows = [];
  rows.push(['Weight', formatWeight(item.weight) + (item.quantity > 1 ? ` (each)` : '')]);
  if (item.sell_value != null) rows.push(['Sell value', `₵${item.sell_value}${item.quantity > 1 ? ' each' : ''}`]);
  if (t.slot) rows.push(['Slot', SLOT_LABELS[t.slot] || t.slot.replace('_', ' ')]);
  if (t.armor != null) {
    let soak = '';
    if (t.armor_soak && typeof t.armor_soak === 'object') {
      const parts = Object.entries(t.armor_soak).map(([k, v]) => `${k} ${v}`);
      if (parts.length) soak = ` (${parts.join(', ')})`;
    }
    rows.push(['Armor', `${t.armor}${soak}`]);
  }
  if (t.damage && typeof t.damage === 'object' && (t.damage.min != null || t.damage.max != null)) {
    rows.push(['Damage', `${t.damage.min ?? '?'}–${t.damage.max ?? '?'}`]);
  }
  if (t.container != null) rows.push(['Capacity', formatWeight(t.container)]);
  const restores = [
    ['restore_hp', 'HP'], ['restore_hunger', 'Hunger'], ['restore_thirst', 'Thirst'],
    ['restore_radiation', 'Radiation'], ['restore_sanity', 'Sanity'],
  ];
  for (const [key, label] of restores) {
    if (t[key] != null) rows.push([`Restores ${label}`, `${t[key] > 0 ? '+' : ''}${t[key]}`]);
  }
  if (t.stat_bonus && typeof t.stat_bonus === 'object') {
    const parts = Object.entries(t.stat_bonus).map(([k, v]) => `${k.replace('stat_', '')} ${v > 0 ? '+' : ''}${v}`);
    if (parts.length) rows.push(['Bonus', parts.join(', ')]);
  }
  if (t.requires && typeof t.requires === 'object') {
    const parts = Object.entries(t.requires).map(([k, v]) => `${k.replace('stat_', '')} ${v}`);
    if (parts.length) rows.push(['Requires', parts.join(', ')]);
  }
  return rows;
}

function closeItemDetail() {
  const o = document.getElementById('item-detail-overlay');
  if (o) o.style.display = 'none';
}

function showItemDetail(item) {
  const tags = item.tags || {};
  let overlay = document.getElementById('item-detail-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'item-detail-overlay';
    overlay.classList.add('modal-overlay');
    overlay.style.cssText = 'background:rgba(0,0,0,0.75);z-index:600;display:flex';
    overlay.addEventListener('click', e => { if (e.target === overlay) closeItemDetail(); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && overlay.style.display === 'flex') closeItemDetail();
    });
    document.body.appendChild(overlay);
  }

  // Header badges: quality, instance flags, equipped state.
  const badges = [];
  // 'common' is the baseline crafting tier — only badge the notable qualities.
  if (item.custom_data?.quality && item.custom_data.quality !== 'common') badges.push(`<span class="idp-badge quality">${escapeHtml(item.custom_data.quality)}</span>`);
  for (const f of ['broken', 'cursed']) {
    if (item.custom_data && item.custom_data[f]) badges.push(`<span class="idp-badge flag">${f}</span>`);
  }
  if (item.is_equipped) badges.push(`<span class="idp-badge equipped">equipped</span>`);
  const badgeHtml = badges.length ? `<div class="idp-badges">${badges.join('')}</div>` : '';

  const desc = tags.description ? escapeHtml(tags.description) : '<span class="idp-nodesc">No description.</span>';
  const statHtml = itemStatRows(item).map(([k, v]) =>
    `<div class="idp-stat"><span class="idp-stat-k">${escapeHtml(k)}</span><span class="idp-stat-v">${escapeHtml(v)}</span></div>`
  ).join('');

  // Verb buttons: Equip (if equippable) + server-provided actions + Drop.
  const verbs = [];
  if (tags.slot && !item.is_equipped) verbs.push({ label: 'Equip', kind: 'equip' });
  for (const v of (item.actions || [])) {
    if (v === 'drop' || v === 'equip' || v === 'wear' || v === 'wield') continue;
    verbs.push({ label: VERB_LABELS[v] || (v.charAt(0).toUpperCase() + v.slice(1)), kind: 'verb', verb: v });
  }
  verbs.push({ label: 'Drop', kind: 'drop' });

  overlay.innerHTML = `
    <div class="idp-box">
      <div class="idp-header">
        <span class="idp-name">${escapeHtml(item.name)}${item.quantity > 1 ? ` <span class="idp-qty">x${item.quantity}</span>` : ''}</span>
        <button class="idp-close" title="Close">✕</button>
      </div>
      ${badgeHtml}
      <div class="idp-desc">${desc}</div>
      <div class="idp-stats">${statHtml}</div>
      <div class="idp-verbs"></div>
    </div>`;
  overlay.style.display = 'flex';

  overlay.querySelector('.idp-close').addEventListener('click', closeItemDetail);
  const verbRow = overlay.querySelector('.idp-verbs');
  for (const v of verbs) {
    const btn = document.createElement('button');
    btn.className = 'idp-verb' + (v.kind === 'drop' ? ' danger' : '');
    btn.textContent = v.label;
    btn.addEventListener('click', () => {
      if (v.kind === 'equip') { closeItemDetail(); sendCmdSilent(`equipid ${item.id} ${currentLayer}`); }
      else if (v.kind === 'drop') { closeItemDetail(); dropItem(item); }
      else { closeItemDetail(); sendCmd(`${v.verb} ${item.name}`); }
    });
    verbRow.appendChild(btn);
  }
}

function showDropQtyDialog(item, onConfirm) {
  let overlay = document.getElementById('drop-qty-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'drop-qty-overlay';
    overlay.classList.add('modal-overlay'); overlay.style.cssText = 'background:rgba(0,0,0,0.75);z-index:600;display:flex';
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.style.display = 'none'; });
    document.body.appendChild(overlay);
  }
  const btnStyle = (color) => `background:transparent;border:1px solid ${color};color:${color};font-family:var(--font-mono);font-size:11px;padding:4px 14px;cursor:pointer;border-radius:2px`;
  overlay.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:2px;padding:20px;width:260px;font-family:var(--font-mono)">
      <div style="font-size:11px;color:var(--accent);text-transform:uppercase;letter-spacing:2px;margin-bottom:14px">Drop Item</div>
      <div style="font-size:12px;color:var(--text-bright);margin-bottom:2px">${item.name}</div>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:12px">You have ${item.quantity}. How many to drop?</div>
      <input id="drop-qty-input" type="number" min="1" max="${item.quantity}" value="${item.quantity}"
        style="width:100%;background:var(--bg3);border:1px solid var(--border);color:var(--text-bright);font-family:var(--font-mono);font-size:14px;padding:6px 8px;box-sizing:border-box;margin-bottom:14px;border-radius:2px">
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button id="drop-qty-cancel" style="${btnStyle('var(--text-dim)')}">Cancel</button>
        <button id="drop-qty-confirm" style="${btnStyle('var(--red)')}">Drop</button>
      </div>
    </div>`;
  overlay.style.display = 'flex';

  const input = document.getElementById('drop-qty-input');
  input.select();
  input.focus();

  function doConfirm() {
    const qty = Math.min(Math.max(1, parseInt(input.value) || 1), item.quantity);
    overlay.style.display = 'none';
    onConfirm(qty);
  }

  input.addEventListener('keydown', e => { if (e.key === 'Enter') doConfirm(); if (e.key === 'Escape') { overlay.style.display = 'none'; } });
  document.getElementById('drop-qty-cancel').addEventListener('click', () => { overlay.style.display = 'none'; });
  document.getElementById('drop-qty-confirm').addEventListener('click', doConfirm);
}

function dropItem(item) {
  if (item.quantity > 1) {
    showDropQtyDialog(item, qty => sendCmdSilent(`dropid ${item.id} ${qty}`));
  } else {
    sendCmdSilent(`dropid ${item.id}`);
  }
}

function onItemDragStart(e, id) {
  equipDraggedId = id;
  dragHandled = false;
  e.target.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

export function initEquipPanel() {
  document.getElementById('equip-close').addEventListener('click', closeEquipPanel);
  document.getElementById('equip-panel').addEventListener('click', (e) => {
    if (e.target.id === 'equip-panel') closeEquipPanel();
  });

  const btnUp = document.getElementById('equip-layer-up');
  const btnDown = document.getElementById('equip-layer-down');
  function updateLayerButtons() {
    btnUp.disabled = currentLayer >= 5;
    btnDown.disabled = currentLayer <= 1;
  }
  btnUp.addEventListener('click', () => {
    if (currentLayer < 5) { currentLayer++; updateLayerDisplay(); updateLayerButtons(); rerenderLayer(); }
  });
  btnDown.addEventListener('click', () => {
    if (currentLayer > 1) { currentLayer--; updateLayerDisplay(); updateLayerButtons(); rerenderLayer(); }
  });
  updateLayerButtons();

  document.querySelectorAll('.equip-slot').forEach(slotEl => {
    slotEl.addEventListener('dragover', e => e.preventDefault());
    slotEl.addEventListener('drop', (e) => {
      e.preventDefault();
      dragHandled = true;
      slotEl.classList.remove('drag-over');
      if (equipDraggedId) sendCmdSilent(`equipid ${equipDraggedId} ${currentLayer}`);
      equipDraggedId = null;
    });
    slotEl.addEventListener('dragenter', () => slotEl.classList.add('drag-over'));
    slotEl.addEventListener('dragleave', () => slotEl.classList.remove('drag-over'));
  });

  document.getElementById('equip-inv-list').addEventListener('dragover', e => e.preventDefault());
  document.getElementById('equip-inv-list').addEventListener('drop', (e) => {
    e.preventDefault();
    dragHandled = true;
    if (equipDraggedId) sendCmdSilent(`unequipid ${equipDraggedId}`);
    equipDraggedId = null;
  });

  // Drop outside any valid target → same behaviour as the drop button (prompt for stacks).
  document.addEventListener('dragend', () => {
    if (!dragHandled && equipDraggedId) {
      const item = lastItems.find(i => i.id == equipDraggedId);
      if (item) dropItem(item);
      else sendCmdSilent(`dropid ${equipDraggedId}`);
    }
    equipDraggedId = null;
    dragHandled = false;
  });
}
