import { sendCmdSilent } from '../net.js';

// The wardrobe panel: saved outfits on the left, a paper doll in the middle, the
// wardrobe's hanging stock and your carried clothes on the right. Drag a garment
// onto the pad for its slot to compose a look, name it, save it.
//
// Native HTML5 drag/drop, matching panels/container.js — this is an ordinary
// fixed overlay, not the transformed tablet CRT (which is why tablet-os.js has
// to hand-roll pointer dragging and this doesn't).

let activeWardrobeId = null;
let draggedItem = null;              // { itemId, name, slot }
// The look being composed: slot -> { itemId, name }. Accessories stack, so that
// key holds an array; every other slot holds one piece.
let doll = {};
let editingName = '';

// Pads on the mannequin, in render order. `accessory` is the only multi pad.
const PADS = [
  { slot: 'head',      label: 'Head' },
  { slot: 'torso',     label: 'Torso' },
  { slot: 'hands',     label: 'Hands' },
  { slot: 'legs',      label: 'Legs' },
  { slot: 'feet',      label: 'Feet' },
  { slot: 'accessory', label: 'Accessories' },
];

export function openWardrobePanel(data) {
  activeWardrobeId = data.containerId;
  doll = {};
  editingName = '';
  renderWardrobePanel(data);
  document.getElementById('wardrobe-panel').classList.add('active');
}

export function refreshWardrobePanel(data) {
  if (!document.getElementById('wardrobe-panel').classList.contains('active')) return;
  activeWardrobeId = data.containerId;
  renderWardrobePanel(data);
}

export function closeWardrobePanel() {
  const cid = activeWardrobeId;
  document.getElementById('wardrobe-panel').classList.remove('active');
  activeWardrobeId = null;
  doll = {};
  if (cid) sendCmdSilent(`closecontainer ${cid}`);
}

export function getActiveWardrobeId() { return activeWardrobeId; }

export function showWardrobeNotify(msg) {
  const el = document.getElementById('wardrobe-notify');
  if (el) el.textContent = msg;
}

// Only garments belong in a wardrobe panel — everything else in the box or the
// pack is noise here (it's still reachable through the normal container verbs).
function wearable(items) {
  return (items || []).filter(i => i.tags?.slot && i.tags.slot !== 'weapon_hand');
}

function slotOf(item) { return item.tags?.slot || null; }

function renderWardrobePanel(data) {
  document.getElementById('wardrobe-title').textContent = data.containerName || 'Wardrobe';
  document.getElementById('wardrobe-notify').textContent = data.notify || '';

  renderOutfits(data.outfits || []);
  renderStock('wardrobe-hanging-list', wearable(data.containerItems), 'hanging');
  renderStock('wardrobe-carried-list', wearable(data.invItems), 'carried');
  renderDoll();
}

function renderOutfits(outfits) {
  const list = document.getElementById('wardrobe-outfit-list');
  list.innerHTML = '';
  if (!outfits.length) {
    const empty = document.createElement('div');
    empty.className = 'wdr-empty';
    empty.textContent = 'Nothing saved yet. Build a look on the doll and name it.';
    list.appendChild(empty);
    return;
  }
  for (const outfit of outfits) {
    const card = document.createElement('div');
    card.className = 'wdr-outfit' + (outfit.wearable ? '' : ' wdr-outfit-incomplete');
    const pieces = outfit.items.map(i =>
      `<span class="wdr-piece${i.available ? '' : ' wdr-piece-missing'}">${i.name}</span>`).join('');
    card.innerHTML = `
      <div class="wdr-outfit-head">
        <span class="wdr-outfit-name">${outfit.name}</span>
        <span class="wdr-outfit-btns">
          <button class="ctr-action-btn wdr-wear">wear</button>
          <button class="ctr-action-btn wdr-del">✕</button>
        </span>
      </div>
      <div class="wdr-outfit-pieces">${pieces || '<span class="wdr-piece">(empty)</span>'}</div>`;
    card.querySelector('.wdr-wear').onclick = (e) => {
      e.stopPropagation();
      sendCmdSilent(`outfitwearid ${activeWardrobeId} ${outfit.name}`);
    };
    card.querySelector('.wdr-del').onclick = (e) => {
      e.stopPropagation();
      sendCmdSilent(`outfitdelid ${activeWardrobeId} ${outfit.name}`);
    };
    // Clicking the card loads it onto the doll for editing — saving under the
    // same name overwrites, which is how you tweak an existing look.
    card.onclick = () => {
      doll = {};
      for (const i of outfit.items) {
        if (!i.slot) continue;
        if (i.slot === 'accessory') (doll.accessory ||= []).push({ itemId: i.itemId, name: i.name });
        else doll[i.slot] = { itemId: i.itemId, name: i.name };
      }
      editingName = outfit.name;
      document.getElementById('wardrobe-outfit-name').value = outfit.name;
      renderDoll();
    };
    list.appendChild(card);
  }
}

function renderStock(listId, items, source) {
  const list = document.getElementById(listId);
  list.innerHTML = '';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'wdr-empty';
    empty.textContent = source === 'hanging' ? 'Nothing hanging.' : 'No clothes on you.';
    list.appendChild(empty);
    return;
  }
  for (const item of items) {
    const card = document.createElement('div');
    card.className = 'ctr-item-card wdr-garment';
    card.setAttribute('draggable', 'true');
    card.innerHTML = `<span class="ctr-name">${item.name}</span><span class="ctr-meta wdr-slot-tag">${slotOf(item)}</span>`;

    const btn = document.createElement('button');
    btn.className = 'ctr-action-btn';
    if (source === 'carried') {
      btn.textContent = 'hang';
      btn.title = 'Put into the wardrobe';
      btn.onclick = (e) => { e.stopPropagation(); sendCmdSilent(`stowid ${item.id} ${activeWardrobeId}`); };
    } else {
      btn.textContent = 'take';
      btn.title = 'Take out of the wardrobe';
      btn.onclick = (e) => { e.stopPropagation(); sendCmdSilent(`pullid ${item.id}`); };
    }
    card.appendChild(btn);

    card.ondragstart = (e) => {
      draggedItem = { itemId: item.item_id, name: item.name, slot: slotOf(item) };
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'copy';
      highlightPads(draggedItem.slot);
    };
    card.ondragend = () => { card.classList.remove('dragging'); highlightPads(null); };
    list.appendChild(card);
  }
}

// Light up the pad a dragged garment can actually land on, so a mis-drop is
// obvious before it happens rather than after.
function highlightPads(slot) {
  for (const pad of document.querySelectorAll('.wdr-pad')) {
    pad.classList.toggle('wdr-pad-eligible', !!slot && pad.getAttribute('data-slot') === slot);
  }
}

function renderDoll() {
  const stage = document.getElementById('wardrobe-doll');
  stage.innerHTML = '<div class="wdr-figure" aria-hidden="true"><span class="wdr-fig-head"></span><span class="wdr-fig-torso"></span><span class="wdr-fig-legs"></span></div>';

  for (const { slot, label } of PADS) {
    const pad = document.createElement('div');
    pad.className = `wdr-pad wdr-pad-${slot}`;
    pad.setAttribute('data-slot', slot);

    const filled = slot === 'accessory' ? (doll.accessory || []) : (doll[slot] ? [doll[slot]] : []);
    const worn = filled.map((p, idx) =>
      `<span class="wdr-worn" data-idx="${idx}" title="Click to remove">${p.name}</span>`).join('');
    pad.innerHTML = `<span class="wdr-pad-label">${label}</span><span class="wdr-pad-items">${worn || '<span class="wdr-pad-empty">—</span>'}</span>`;

    for (const el of pad.querySelectorAll('.wdr-worn')) {
      el.onclick = () => {
        const idx = Number(el.getAttribute('data-idx'));
        if (slot === 'accessory') doll.accessory.splice(idx, 1);
        else delete doll[slot];
        renderDoll();
      };
    }

    pad.addEventListener('dragover', (e) => {
      if (draggedItem?.slot === slot) e.preventDefault();
    });
    pad.addEventListener('dragenter', () => {
      if (draggedItem?.slot === slot) pad.classList.add('ctr-drag-over');
    });
    pad.addEventListener('dragleave', () => pad.classList.remove('ctr-drag-over'));
    pad.addEventListener('drop', (e) => {
      e.preventDefault();
      pad.classList.remove('ctr-drag-over');
      if (!draggedItem || draggedItem.slot !== slot) return;
      const piece = { itemId: draggedItem.itemId, name: draggedItem.name };
      if (slot === 'accessory') {
        const acc = (doll.accessory ||= []);
        if (!acc.some(p => p.itemId === piece.itemId) && acc.length < 3) acc.push(piece);
      } else {
        doll[slot] = piece;   // one piece per slot — a drop replaces what's there
      }
      draggedItem = null;
      renderDoll();
    });

    stage.appendChild(pad);
  }

  const count = dollItemIds().length;
  document.getElementById('wardrobe-doll-label').textContent =
    editingName ? `Editing "${editingName}"` : (count ? 'New Outfit' : 'Drag clothes onto the doll');
}

function dollItemIds() {
  const ids = [];
  for (const { slot } of PADS) {
    if (slot === 'accessory') for (const p of (doll.accessory || [])) ids.push(p.itemId);
    else if (doll[slot]) ids.push(doll[slot].itemId);
  }
  return ids;
}

export function initWardrobePanel() {
  document.getElementById('wardrobe-close').addEventListener('click', closeWardrobePanel);
  document.getElementById('wardrobe-close-btn').addEventListener('click', closeWardrobePanel);
  document.getElementById('wardrobe-panel').addEventListener('click', (e) => {
    if (e.target.id === 'wardrobe-panel') closeWardrobePanel();
  });

  document.getElementById('wardrobe-clear').addEventListener('click', () => {
    doll = {};
    editingName = '';
    document.getElementById('wardrobe-outfit-name').value = '';
    renderDoll();
  });

  const nameInput = document.getElementById('wardrobe-outfit-name');
  const save = () => {
    const name = nameInput.value.trim();
    const ids = dollItemIds();
    const notify = document.getElementById('wardrobe-notify');
    if (!name) { notify.textContent = 'Name the outfit first.'; nameInput.focus(); return; }
    if (!ids.length) { notify.textContent = 'Drag at least one piece onto the doll.'; return; }
    // The name can contain spaces, so it goes in front of a `|` separator and the
    // ids follow — the server splits on the first pipe.
    sendCmdSilent(`outfitsetid ${activeWardrobeId} ${name}|${ids.join(',')}`);
    editingName = name;
  };
  document.getElementById('wardrobe-save').addEventListener('click', save);
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });

  document.addEventListener('dragend', () => { draggedItem = null; highlightPads(null); });
}
