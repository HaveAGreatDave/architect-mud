import { state } from '../state.js';
import { sendCmdSilent } from '../net.js';

const EQUIP_SLOT_NAMES = ['head','torso','hands','weapon_hand','legs','feet','accessory'];
const LAYER_NAMES = ['', 'Skin', 'Base', 'Mid', 'Outer', 'Shell'];
let equipDraggedId = null;
let dragHandled = false;
let currentLayer = 1;
let lastItems = [];

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

export function renderEquipPanel(items) {
  lastItems = items;
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

  const unequipped = [];
  for (const item of items) {
    if (item.is_equipped && item.slot) {
      const slotEl = document.querySelector(`.equip-slot[data-slot="${item.slot}"] .equip-slot-item`);
      if (slotEl) {
        const vis = itemLayerVisibility(item, currentLayer);
        slotEl.className = 'equip-slot-item filled layer-' + vis;
        slotEl.textContent = item.name + (item.quantity > 1 ? ` x${item.quantity}` : '');
        slotEl.setAttribute('draggable', 'true');
        slotEl.setAttribute('data-id', item.id);
        slotEl.ondragstart = (e) => onItemDragStart(e, item.id);
        slotEl.onclick = () => sendCmdSilent(`unequipid ${item.id}`);
        slotEl.title = 'Click or drag out to unequip';
      }
    } else {
      unequipped.push(item);
    }
  }

  const list = document.getElementById('equip-inv-list');
  list.innerHTML = '';
  for (const item of unequipped) {
    const tags = item.tags || {};
    const equippable = !!tags.slot;
    const vis = itemLayerVisibility(item, currentLayer);
    const card = document.createElement('div');
    card.className = 'equip-item-card' + (equippable ? ' equippable' : '') + ' layer-' + vis;
    if (vis === 'hidden') card.setAttribute('aria-hidden', 'true');
    card.setAttribute('draggable', 'true');
    card.setAttribute('data-id', item.id);
    const qty = item.quantity > 1 ? ` x${item.quantity}` : '';
    const slotLabel = tags.slot ? ` · ${tags.slot.replace('_',' ')}` : '';
    card.innerHTML = `<span class="eic-name">${item.name}${qty}</span><span class="eic-meta">${item.rarity || ''}${slotLabel}</span><button class="eic-drop-btn" title="Drop on ground">↓</button>`;
    card.ondragstart = (e) => onItemDragStart(e, item.id);
    card.ondragend = () => card.classList.remove('dragging');
    if (equippable) card.onclick = () => sendCmdSilent(`equipid ${item.id}`);
    card.querySelector('.eic-drop-btn').onclick = (e) => { e.stopPropagation(); sendCmdSilent(`dropid ${item.id}`); };
    list.appendChild(card);
  }

  document.getElementById('equip-credits-val').textContent = (state.player && state.player.credits) || 0;
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
      if (equipDraggedId) sendCmdSilent(`equipid ${equipDraggedId}`);
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

  // Drop outside any valid target → drop item on the ground.
  document.addEventListener('dragend', () => {
    if (!dragHandled && equipDraggedId) {
      sendCmdSilent(`dropid ${equipDraggedId}`);
    }
    equipDraggedId = null;
    dragHandled = false;
  });
}
