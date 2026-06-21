import { state } from '../state.js';
import { sendCmdSilent } from '../net.js';

const EQUIP_SLOT_NAMES = ['head','torso','hands','weapon_hand','legs','feet','accessory'];
let equipDraggedId = null;

export function openEquipPanel() {
  import('../net.js').then(m => m.sendCmd('inventory'));
}

export function closeEquipPanel() {
  document.getElementById('equip-panel').classList.remove('active');
}

export function renderEquipPanel(items) {
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
        slotEl.className = 'equip-slot-item filled';
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
    const card = document.createElement('div');
    card.className = 'equip-item-card' + (equippable ? ' equippable' : '');
    card.setAttribute('draggable', 'true');
    card.setAttribute('data-id', item.id);
    const qty = item.quantity > 1 ? ` x${item.quantity}` : '';
    const slotLabel = tags.slot ? ` · ${tags.slot.replace('_',' ')}` : '';
    card.innerHTML = `<span class="eic-name">${item.name}${qty}</span><span class="eic-meta">${item.rarity || ''}${slotLabel}</span>`;
    card.ondragstart = (e) => onItemDragStart(e, item.id);
    card.ondragend = () => card.classList.remove('dragging');
    if (equippable) card.onclick = () => sendCmdSilent(`equipid ${item.id}`);
    list.appendChild(card);
  }

  document.getElementById('equip-credits-val').textContent = (state.player && state.player.credits) || 0;
}

function onItemDragStart(e, id) {
  equipDraggedId = id;
  e.target.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

export function initEquipPanel() {
  document.getElementById('equip-close').addEventListener('click', closeEquipPanel);
  document.getElementById('equip-panel').addEventListener('click', (e) => {
    if (e.target.id === 'equip-panel') closeEquipPanel();
  });

  document.querySelectorAll('.equip-slot').forEach(slotEl => {
    slotEl.addEventListener('dragover', e => e.preventDefault());
    slotEl.addEventListener('drop', (e) => {
      e.preventDefault();
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
    if (equipDraggedId) sendCmdSilent(`unequipid ${equipDraggedId}`);
    equipDraggedId = null;
  });
}
