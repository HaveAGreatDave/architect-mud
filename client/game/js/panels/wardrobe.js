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
// Which silhouette to draw. The server sends it with every view (see the
// wardrobe plugin's decorateView); 'male' is the fallback only because one of
// the two images has to be, never because it is a default about anybody.
let dollSex = 'male';

// ── The doll is LAYERED ──────────────────────────────────────────────────────
// The engine equips one item per slot PER LAYER (underwear < outerwear < armor —
// see the `layer` tag), which is why you can wear a cap under a helmet. The doll
// used to hold a single piece per slot, so composing that outfit was impossible:
// dropping the helmet silently threw the cap away, and the saved look came out
// wrong in a way nothing reported.
//
// Modelling the layers fixes that AND is where hats and helmets get their own
// homes — they are not two slots, they are one slot at two depths.
const LAYERS = ['underwear', 'outerwear', 'armor'];
const layerOf = (item) => {
  const l = item?.tags?.layer;
  return LAYERS.includes(l) ? l : 'outerwear';   // the engine's own default
};

// Per-slot layer captions. Naming the layer for the body part it's on is the
// whole readability win — "Armor" on a head pad means nothing, "Helmet" is
// instantly a thing you own.
const LAYER_LABELS = {
  head:  { underwear: 'Liner',   outerwear: 'Hat',      armor: 'Helmet' },
  torso: { underwear: 'Vest',    outerwear: 'Shirt',    armor: 'Plate'  },
  hands: { underwear: 'Liner',   outerwear: 'Gloves',   armor: 'Gauntlets' },
  legs:  { underwear: 'Shorts',  outerwear: 'Trousers', armor: 'Greaves' },
  feet:  { underwear: 'Socks',   outerwear: 'Shoes',    armor: 'Boots'  },
};
const layerLabel = (slot, layer) => LAYER_LABELS[slot]?.[layer] || layer;

// Pads on the mannequin, in render order. `accessory` is the only multi pad and
// the only one with no layers — the engine ignores layer there.
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
  if (data.sex === 'female' || data.sex === 'male') dollSex = data.sex;
  // Both buttons act on what you're wearing, so neither means anything naked.
  const bare = equippedNow.length === 0;
  const wearingBtn = document.getElementById('wardrobe-wearing');
  const undressBtn = document.getElementById('wardrobe-undress');
  if (wearingBtn) wearingBtn.disabled = bare;
  if (undressBtn) undressBtn.disabled = bare;

  renderOutfits(data.outfits || []);
  renderStock('wardrobe-hanging-list', wearable(data.containerItems), 'hanging');
  renderStock('wardrobe-carried-list', wearable(data.invItems), 'carried');
  // Idempotent — the rails are persistent elements, so this wires them once and
  // no-ops on every later refresh.
  wireRailDrop('wardrobe-hanging-list', 'hanging');
  wireRailDrop('wardrobe-carried-list', 'carried');
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
      // Through placeOnDoll like every other route, so a saved look reloads into
      // the same layered shape it was composed in. Doing it by hand here is what
      // used to write the old flat shape back over the new one.
      for (const i of outfit.items) {
        if (!i.slot) continue;
        placeOnDoll(i.slot, {
          itemId: i.itemId, name: i.name,
          layer: LAYERS.includes(i.layer) ? i.layer : 'outerwear',
        });
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
      // `row` and `source` are what let a garment be dragged between the rails as
      // well as onto the doll — the doll only ever needs the template id, but
      // moving a real garment in or out of the box needs its inventory ROW.
      draggedItem = {
        itemId: item.item_id, name: item.name, slot: slotOf(item), layer: layerOf(item),
        row: item.id, source,
      };
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'copyMove';
      highlightPads(draggedItem.slot);
      highlightRails(source);
    };
    card.ondragend = () => { card.classList.remove('dragging'); highlightPads(null); highlightRails(null); };

    // Tap to arm (tap again to disarm) — the touch route onto the doll.
    card.onclick = () => {
      armedItem = armedItem?.id === item.id
        ? null
        : { id: item.id, itemId: item.item_id, name: item.name, slot: slotOf(item), layer: layerOf(item), row: item.id, source };
      syncArmed();
    };
    if (armedItem?.id === item.id) card.classList.add('wdr-armed');
    card.setAttribute('data-item', item.id);
    list.appendChild(card);
  }
}

// ── Moving garments between the rails ────────────────────────────────────────
// Hang and take were buttons only, which made "put this away" a hunt for a small
// word on a card. The rails are now drop targets too, so a garment can simply be
// thrown at the other side — the same gesture that dresses the doll.
//
// The OPPOSITE rail lights up, never the one it came from: dropping a hanging
// coat back on the rail it is already on should look like nothing, because it is.
function highlightRails(source) {
  const rails = {
    carried: document.getElementById('wardrobe-carried-list')?.closest('.wdr-rail') || document.getElementById('wardrobe-carried-list'),
    hanging: document.getElementById('wardrobe-hanging-list')?.closest('.wdr-rail') || document.getElementById('wardrobe-hanging-list'),
  };
  for (const [name, el] of Object.entries(rails)) {
    if (!el) continue;
    el.classList.toggle('wdr-rail-eligible', !!source && source !== name);
  }
}

// Wire one rail as a drop target. `into` is what a garment landing here becomes.
function wireRailDrop(listId, into) {
  const list = document.getElementById(listId);
  if (!list || list._wdrWired) return;
  const zone = list.closest('.wdr-rail') || list;
  const moveHere = () => {
    if (!draggedItem || draggedItem.source === into || !draggedItem.row) return false;
    // stowid pushes a carried row into the box; pullid takes one out. Both are the
    // same commands the hang/take buttons send — this is a second route to them,
    // not a second implementation.
    sendCmdSilent(into === 'hanging'
      ? `stowid ${draggedItem.row} ${activeWardrobeId}`
      : `pullid ${draggedItem.row}`);
    draggedItem = null;
    highlightPads(null); highlightRails(null);
    return true;
  };
  zone.addEventListener('dragover', (e) => { if (draggedItem && draggedItem.source !== into) e.preventDefault(); });
  zone.addEventListener('dragenter', () => { if (draggedItem && draggedItem.source !== into) zone.classList.add('ctr-drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('ctr-drag-over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('ctr-drag-over'); moveHere(); });
  // Touch route: arm a garment, tap the far rail. Mirrors the doll's tap-to-place
  // exactly, because HTML5 drag fires nothing on a phone.
  zone.addEventListener('click', (e) => {
    if (!armedItem || armedItem.source === into || !armedItem.row) return;
    if (e.target.closest('.wdr-garment')) return;   // a tap ON a card is arm/disarm
    sendCmdSilent(into === 'hanging'
      ? `stowid ${armedItem.row} ${activeWardrobeId}`
      : `pullid ${armedItem.row}`);
    armedItem = null;
    syncArmed();
  });
  list._wdrWired = true;
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
// the tap handler so the two routes can never drift apart. A piece replaces only
// what shares its LAYER, so a helmet no longer evicts the cap under it.
function placeOnDoll(slot, piece) {
  if (slot === 'accessory') {
    const acc = (doll.accessory ||= []);
    if (!acc.some(p => p.itemId === piece.itemId) && acc.length < 3) acc.push(piece);
    return;
  }
  const byLayer = (doll[slot] ||= {});
  byLayer[piece.layer || 'outerwear'] = piece;
}

function renderDoll() {
  const stage = document.getElementById('wardrobe-doll');
  // The REAL silhouette, not the three grey boxes that used to stand in for one.
  // Same alpha-mask technique and the same two source images as the tablet's Gear
  // doll (/assets/paperdoll-mask.png, /assets/femsil-mask.png), so a character is
  // the same body in both screens rather than a mannequin here and a person
  // there. The mask is tinted by CSS, which is why one image serves every skin.
  stage.className = `wdr-doll-${dollSex}`;
  stage.innerHTML = '<div class="wdr-figure" aria-hidden="true"></div>';

  for (const { slot, label } of PADS) {
    const pad = document.createElement('div');
    pad.className = `wdr-pad wdr-pad-${slot}`;
    pad.setAttribute('data-slot', slot);

    if (slot === 'accessory') {
      const worn = (doll.accessory || []).map((p, idx) =>
        `<span class="wdr-worn" data-idx="${idx}" title="Click to remove">${p.name}</span>`).join('');
      pad.innerHTML = `<span class="wdr-pad-label">${label}</span>`
        + `<span class="wdr-pad-items">${worn || '<span class="wdr-pad-empty">—</span>'}</span>`;
    } else {
      // One ROW PER LAYER, innermost first, so the pad reads the way the body is
      // dressed — and an empty row is a visible invitation rather than a hidden
      // capability. Rows only appear for layers this slot can actually take.
      const byLayer = doll[slot] || {};
      const rows = LAYERS.map(layer => {
        const p = byLayer[layer];
        const cell = p
          ? `<span class="wdr-worn" data-layer="${layer}" title="Click to remove">${p.name}</span>`
          : `<span class="wdr-pad-empty">—</span>`;
        return `<span class="wdr-layer-row${p ? ' on' : ''}" data-layer="${layer}">`
          + `<span class="wdr-layer-name">${layerLabel(slot, layer)}</span>${cell}</span>`;
      }).join('');
      pad.innerHTML = `<span class="wdr-pad-label">${label}</span><span class="wdr-pad-layers">${rows}</span>`;
    }

    for (const el of pad.querySelectorAll('.wdr-worn')) {
      el.onclick = (e) => {
        e.stopPropagation();   // don't let a remove double as a place on the pad below
        if (slot === 'accessory') doll.accessory.splice(Number(el.getAttribute('data-idx')), 1);
        else delete (doll[slot] || {})[el.getAttribute('data-layer')];
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
      placeOnDoll(slot, { itemId: draggedItem.itemId, name: draggedItem.name, layer: draggedItem.layer });
      draggedItem = null;
      renderDoll();
    });

    // Tap route: an armed garment lands on any pad that matches its slot.
    pad.onclick = () => {
      if (!armedItem || armedItem.slot !== slot) return;
      placeOnDoll(slot, { itemId: armedItem.itemId, name: armedItem.name, layer: armedItem.layer });
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
      placeOnDoll(p.slot, { itemId: p.itemId, name: p.name, layer: LAYERS.includes(p.layer) ? p.layer : 'outerwear' });
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
