import { sendCmdSilent } from '../net.js';

// The wardrobe panel: saved outfits on the left, a paper doll in the middle, the
// wardrobe's hanging stock and your carried clothes on the right. Drag a garment
// onto the pad for its slot to compose a look, name it, save it.
//
// Native HTML5 drag/drop, matching panels/container.js — this is an ordinary
// fixed overlay, not the transformed tablet CRT (which is why tablet-os.js has
// to hand-roll pointer dragging and this doesn't).
//
// HTML5 drag fires no events on touch, so composing a look would be impossible
// on a phone with drag alone (the hang/take buttons only move a garment in and
// out of the box — they don't dress the doll). So every garment also ARMS on a
// tap: tap the card, the pads it can land on light up, tap one to place it.
// Same code path as the drop handler, and harmless on desktop where drag still
// works as before.

let activeWardrobeId = null;
let draggedItem = null;              // { itemId, name, slot }
let armedItem = null;                // tap-to-place selection — same shape as draggedItem
// The look being composed: slot -> { itemId, name }. Accessories stack, so that
// key holds an array; every other slot holds one piece.
let doll = {};
let editingName = '';
// What the server says is on the player's body right now — the seed for the
// "Wearing" button. Refreshed with every view, so it can't go stale mid-session.
let equippedNow = [];

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
  armedItem = null;
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
  armedItem = null;
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

  equippedNow = data.equipped || [];
  // Both buttons act on what you're wearing, so neither means anything naked.
  const bare = equippedNow.length === 0;
  const wearingBtn = document.getElementById('wardrobe-wearing');
  const undressBtn = document.getElementById('wardrobe-undress');
  if (wearingBtn) wearingBtn.disabled = bare;
  if (undressBtn) undressBtn.disabled = bare;

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

    // Tap to arm (tap again to disarm) — the touch route onto the doll.
    card.onclick = () => {
      armedItem = armedItem?.id === item.id
        ? null
        : { id: item.id, itemId: item.item_id, name: item.name, slot: slotOf(item) };
      syncArmed();
    };
    if (armedItem?.id === item.id) card.classList.add('wdr-armed');
    card.setAttribute('data-item', item.id);
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

// Reflect the armed garment without a full re-render: mark its card and light
// the pads it fits. Called on every arm/disarm and after the doll redraws.
function syncArmed() {
  for (const card of document.querySelectorAll('.wdr-garment')) {
    card.classList.toggle('wdr-armed', card.getAttribute('data-item') === String(armedItem?.id));
  }
  highlightPads(armedItem?.slot || null);
  updateDollLabel();
}

// The one place a garment lands on the doll — shared by the drop handler and
// the tap handler so the two routes can never drift apart.
function placeOnDoll(slot, piece) {
  if (slot === 'accessory') {
    const acc = (doll.accessory ||= []);
    if (!acc.some(p => p.itemId === piece.itemId) && acc.length < 3) acc.push(piece);
  } else {
    doll[slot] = piece;   // one piece per slot — a drop replaces what's there
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
      el.onclick = (e) => {
        e.stopPropagation();   // don't let a remove double as a place on the pad below
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
      placeOnDoll(slot, { itemId: draggedItem.itemId, name: draggedItem.name });
      draggedItem = null;
      renderDoll();
    });

    // Tap route: an armed garment lands on any pad that matches its slot.
    pad.onclick = () => {
      if (!armedItem || armedItem.slot !== slot) return;
      placeOnDoll(slot, { itemId: armedItem.itemId, name: armedItem.name });
      armedItem = null;
      renderDoll();
    };

    stage.appendChild(pad);
  }

  syncArmed();
}

// The doll's caption doubles as the instruction — it tells you what to do next,
// which differs once a garment is armed.
function updateDollLabel() {
  const count = dollItemIds().length;
  const hint = armedItem
    ? `Place "${armedItem.name}" — tap its pad`
    : (count ? 'New Outfit' : 'Drag or tap a garment, then its pad');
  document.getElementById('wardrobe-doll-label').textContent =
    editingName && !armedItem ? `Editing "${editingName}"` : hint;
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

  // "Wearing" — load the current look onto the doll. This is the one-click route to
  // "save what I've got on": seed, type a name, Save. It fills the doll rather than
  // saving outright so the look stays editable (drop the hat, then name it), and it
  // reuses the same outfitsetid path as any hand-composed outfit.
  document.getElementById('wardrobe-wearing').addEventListener('click', () => {
    doll = {};
    for (const p of equippedNow) {
      if (!p.slot) continue;
      placeOnDoll(p.slot, { itemId: p.itemId, name: p.name });
    }
    editingName = '';
    nameInput.value = '';
    renderDoll();
    if (!equippedNow.length) showWardrobeNotify("You're not wearing anything.");
    else nameInput.focus();
  });

  document.getElementById('wardrobe-undress').addEventListener('click', () => {
    sendCmdSilent(`undressid ${activeWardrobeId}`);
  });

  document.addEventListener('dragend', () => { draggedItem = null; highlightPads(null); });
}
