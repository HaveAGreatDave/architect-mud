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

// ── The layer selector ───────────────────────────────────────────────────────
// The Gear app's model, adopted wholesale (GEAR_LAYER_DEFS in tablet-os.js): the
// doll shows ONE layer at a time and three buttons switch between them. A short
// experiment with all three shown at once — a strip of pips on every pad — got
// the information across but cost the geometry: the pads are centred on their
// anchors, so anything that grows them expands outward from the anchor and walks
// the boxes over the figure. Showing one layer is what keeps a pad the size Gear
// draws it.
//
// The two rules that make a single-layer view workable, both lifted from Gear:
//   1. A pad whose selected layer is EMPTY falls back to the outermost piece on
//      another layer, with a sub-line naming it — so an item on the doll always
//      reads as a filled pad, whichever layer you happen to be looking at.
//   2. Placing a garment JUMPS the selector to that garment's layer, exactly as
//      gearEquipShowLayer does. So a drop is never refused for being on the
//      "wrong" layer; the view follows the clothes.
const LAYER_DEFS = [
  { layer: 'underwear', label: 'Under' },
  { layer: 'outerwear', label: 'Over' },
  { layer: 'armor',     label: 'Armor' },
];
// Armor first, matching Gear's `let _gearLayer = 2` — the outermost layer is what
// the world sees, so it's the one you're usually dressing.
let dollLayer = 'armor';

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

// How many accessories a body can carry at once. Mirrors ACCESSORY_MAX in
// server/engine/commands/inventory.js, and it is NOT a display choice: the engine
// stores the accessory INDEX in the `layer` column (1..3) and `equipAccessory`
// evicts the oldest-equipped one when a fourth arrives. Composing a four-piece
// look here would build an outfit whose fourth accessory silently kicks out its
// first the moment you wore it. If this ever needs to be higher, it moves there
// first and follows here — never the other way round.
const ACCESSORY_MAX = 3;

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
  dollLayer = 'armor';
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

// The equipped list retyped into the shape the rails render. `rowId` is the real
// inventory row, so a worn garment is a thing you can MOVE — drag it to Hanging
// and it comes off and goes in the box in one gesture (`hangwornid`), drag it to
// Carried and it just comes off (`unequipid`).
function wornStock() {
  return equippedNow
    .filter(p => p.slot)
    .map(p => ({ id: p.rowId, item_id: p.itemId, name: p.name, tags: { slot: p.slot, layer: p.layer } }));
}

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
  // What's on your back, under what's in your hands. The two rails above list
  // is_equipped=0 rows only, so without this the clothes you are visibly wearing
  // are the one wardrobe full of garments you cannot drag onto the doll — you had
  // to strip first to compose a look around a coat you already had on.
  renderStock('wardrobe-worn-list', wornStock(), 'worn');
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
    empty.textContent = source === 'hanging' ? 'Nothing hanging.'
      : source === 'worn' ? 'Not wearing anything.'
      : 'No clothes in your pack.';
    list.appendChild(empty);
    return;
  }
  for (const item of items) {
    const card = document.createElement('div');
    card.className = 'ctr-item-card wdr-garment' + (source === 'worn' ? ' wdr-garment-worn' : '');
    card.setAttribute('draggable', 'true');
    // The layer is named on a worn card — the whole reason to see this rail is to
    // know which of the three coats on you is the one under the armour.
    const tag = source === 'worn' && item.tags.layer
      ? `${slotOf(item)} · ${layerLabel(slotOf(item), item.tags.layer)}` : slotOf(item);
    card.innerHTML = `<span class="ctr-name">${item.name}</span><span class="ctr-meta wdr-slot-tag">${tag}</span>`;

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
    // Nothing to hang or take on a worn card — it's on you. Dressing the doll
    // with it is the only thing it's for.
    if (source !== 'worn') card.appendChild(btn);

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
      highlightRails(draggedItem);
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
// The command that moves one garment from `source` to `into`, or null when the
// move is meaningless (a rail onto itself). One table rather than a branch at
// each of the four call sites — drag-drop, tap, and the two rails — so the drop
// handler, the tap handler and the highlighter can't disagree about what is
// possible, which is exactly how "worn → hanging" ended up lit but inert.
function moveCmd(source, into, row) {
  if (!row || source === into) return null;
  if (into === 'hanging') {
    // Off the body AND into the box in one action. `stowid` can't: it only sees
    // rows that are already unequipped.
    return source === 'worn' ? `hangwornid ${activeWardrobeId} ${row}` : `stowid ${row} ${activeWardrobeId}`;
  }
  // NOT the engine's `unequipid`: that answers with an unequip result, not a
  // container view, so the panel would never redraw and the garment would sit in
  // the Worn rail looking like the drag failed.
  if (into === 'carried') return source === 'worn' ? `takeoffid ${activeWardrobeId} ${row}` : `pullid ${row}`;
  return null;   // nothing moves INTO the worn rail — dressing is the doll's job
}

function highlightRails(g) {
  const rails = {
    carried: document.getElementById('wardrobe-carried-list')?.closest('.wdr-rail') || document.getElementById('wardrobe-carried-list'),
    hanging: document.getElementById('wardrobe-hanging-list')?.closest('.wdr-rail') || document.getElementById('wardrobe-hanging-list'),
  };
  // Lit exactly when the drop would DO something — driven by moveCmd, the same
  // function the drop handler calls, so a rail can never light up for a move it
  // will then silently refuse.
  for (const [name, el] of Object.entries(rails)) {
    if (!el) continue;
    el.classList.toggle('wdr-rail-eligible', !!g && !!moveCmd(g.source, name, g.row));
  }
}

// Wire one rail as a drop target. `into` is what a garment landing here becomes.
function wireRailDrop(listId, into) {
  const list = document.getElementById(listId);
  if (!list || list._wdrWired) return;
  const zone = list.closest('.wdr-rail') || list;
  const accepts = (g) => !!g && !!moveCmd(g.source, into, g.row);
  const moveHere = () => {
    const cmd = draggedItem && moveCmd(draggedItem.source, into, draggedItem.row);
    if (!cmd) return false;
    sendCmdSilent(cmd);
    draggedItem = null;
    highlightPads(null); highlightRails(null);
    return true;
  };
  zone.addEventListener('dragover', (e) => { if (accepts(draggedItem)) e.preventDefault(); });
  zone.addEventListener('dragenter', () => { if (accepts(draggedItem)) zone.classList.add('ctr-drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('ctr-drag-over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('ctr-drag-over'); moveHere(); });
  // Touch route: arm a garment, tap the far rail. Mirrors the doll's tap-to-place
  // exactly, because HTML5 drag fires nothing on a phone.
  zone.addEventListener('click', (e) => {
    if (e.target.closest('.wdr-garment')) return;   // a tap ON a card is arm/disarm
    const cmd = armedItem && moveCmd(armedItem.source, into, armedItem.row);
    if (!cmd) return;
    sendCmdSilent(cmd);
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
  // The rails light for the tap route too — arming a garment should show every
  // place it can go, not just the pads.
  highlightRails(armedItem);
  updateDollLabel();
}

// The one place a garment lands on the doll — shared by the drop handler, the
// tap handler, the "Wearing" seed and outfit-card editing, so no two routes can
// layer differently.
//
// The LAYER IS THE GARMENT'S OWN, never the pad you aimed at: a piece carries a
// `layer` tag (underwear/outerwear/armor, defaulting to outerwear) and the doll
// resolves it exactly the way the engine's `bodyLayer` does when it equips. So a
// helmet dropped on a head already wearing a cap lands ON TOP of it — there is
// nothing to aim at and nothing to get wrong, and the pad's sub-line ("Helmet
// +1") is the confirmation.
//
// `announce` is off for the bulk seeds (loading a saved look, "Wearing"), which
// would otherwise fire a line per piece for something the player did once.
function placeOnDoll(slot, piece, announce = false) {
  if (slot === 'accessory') {
    const acc = (doll.accessory ||= []);
    if (acc.some(p => p.itemId === piece.itemId)) {
      if (announce) showWardrobeNotify(`${piece.name} is already on.`);
    } else if (acc.length >= 3) {
      if (announce) showWardrobeNotify(`Only three accessories — take one off first.`);
    } else {
      acc.push(piece);
      if (announce) showWardrobeNotify(`${piece.name} → Accessories.`);
    }
    return;
  }
  const layer = LAYERS.includes(piece.layer) ? piece.layer : 'outerwear';
  const byLayer = (doll[slot] ||= {});
  // One item per (slot, layer) — the engine's rule, so the doll enforces it here
  // rather than letting a look be composed that can't actually be worn. Naming
  // what got displaced is the point: otherwise a second shirt silently deletes
  // the first and the saved outfit is quietly short a piece.
  const displaced = byLayer[layer];
  byLayer[layer] = { ...piece, layer };
  // Follow the clothes. Gear does exactly this on equip (gearEquipShowLayer): the
  // piece you just placed is the piece you want to be looking at, and without it
  // a garment dropped while another layer is selected would appear to vanish —
  // it'd be a fallback on a pad, one layer away from where you're standing.
  if (announce) {
    dollLayer = layer;   // renderDoll() redraws the selector off this
    showWardrobeNotify(displaced && displaced.itemId !== piece.itemId
      ? `${piece.name} → ${layerLabel(slot, layer)}, replacing ${displaced.name}.`
      : `${piece.name} → ${layerLabel(slot, layer)}.`);
  }
}

// The Under/Over/Armor selector. Rebuilt rather than diffed — three buttons.
function renderLayerBar() {
  const bar = document.getElementById('wardrobe-layers');
  if (!bar) return;
  bar.innerHTML = '';
  for (const { layer, label } of LAYER_DEFS) {
    const btn = document.createElement('button');
    btn.className = 'wdr-layer-btn' + (layer === dollLayer ? ' active' : '');
    btn.textContent = label;
    // How many pieces sit on this layer across the whole body — the one thing
    // Gear's selector doesn't say and this panel needs to, because composing a
    // look means knowing there IS something under the armour before you go and
    // look for it.
    const n = LAYER_COUNT_SLOTS.filter(s => doll[s]?.[layer]).length;
    if (n) {
      const dot = document.createElement('span');
      dot.className = 'wdr-layer-count';
      dot.textContent = n;
      btn.appendChild(dot);
    }
    btn.title = `Show the ${label.toLowerCase()} layer${n ? ` — ${n} piece${n === 1 ? '' : 's'}` : ' (empty)'}`;
    btn.onclick = () => {
      if (layer === dollLayer) return;
      dollLayer = layer;
      renderDoll();
    };
    bar.appendChild(btn);
  }
}
const LAYER_COUNT_SLOTS = ['head', 'torso', 'hands', 'legs', 'feet'];

function renderDoll() {
  // The selector is drawn from the same pass as the pads, so the active button
  // and what the body shows can never disagree.
  renderLayerBar();
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
      // Accessories are a LIST, not a stack of layers, and the pad shows all of
      // them at once — one line each, each removable on its own. Gear shows only
      // the first, which is fine for reading a loadout and useless for composing
      // one: "+2 more" can't tell you whether the rings you want are already on.
      // The pad is anchored off to the side of the figure (right: -56px), so the
      // extra rows cost the body nothing.
      const acc = doll.accessory || [];
      pad.classList.toggle('filled', acc.length > 0);
      pad.innerHTML = `<span class="wdr-pad-label">${label}</span>`;
      if (!acc.length) {
        pad.innerHTML += '<span class="wdr-pad-item">—</span>';
      } else {
        for (const piece of acc) {
          const row = document.createElement('span');
          row.className = 'wdr-pad-item wdr-acc-row';
          row.textContent = piece.name;
          row.title = `${piece.name} — click to take off`;
          row.onclick = (e) => {
            if (armedItem) return;              // a tap with a garment in hand places it
            e.stopPropagation();
            doll.accessory = acc.filter(p => p.itemId !== piece.itemId);
            showWardrobeNotify(`Took off ${piece.name}.`);
            renderDoll();
          };
          pad.appendChild(row);
        }
      }
      // The cap is the ENGINE's (ACCESSORY_MAX = 3): a fourth accessory doesn't
      // stack, it evicts the oldest-equipped one. Saying so on the pad is the
      // difference between a full slot and a broken one.
      if (acc.length >= ACCESSORY_MAX) {
        const full = document.createElement('span');
        full.className = 'wdr-pad-sub';
        full.textContent = 'full';
        pad.appendChild(full);
      }
      wirePad(pad, slot);
      stage.appendChild(pad);
      continue;
    }
    // A body pad: the Gear app's compact box, exactly — LABEL / the piece on the
    // SELECTED layer / a sub-line. `fellBack` is a piece shown from a layer OTHER
    // than the selected one (Gear's rule, so nothing on the doll is ever
    // invisible). It changes what a click means: on a fallback the pad JUMPS to
    // that piece's layer rather than taking it off, which is how a buried piece
    // stays reachable without hunting the selector for it.
    let sub = '', fellBack = null;
    const byLayer = doll[slot] || {};
    let shown = byLayer[dollLayer] || null;
    if (!shown) {
      // Outermost first — armour over clothes over underwear, the way it's seen.
      const hidden = [...LAYERS].reverse().filter(l => byLayer[l]);
      if (hidden.length) {
        fellBack = hidden[0];
        shown = byLayer[fellBack];
        sub = layerLabel(slot, fellBack) + (hidden.length > 1 ? ` +${hidden.length - 1}` : '');
      }
    }
    if (shown) pad.classList.add('filled');
    if (fellBack) pad.classList.add('wdr-pad-fallback');
    pad.innerHTML = `<span class="wdr-pad-label">${label}</span>`
      + `<span class="wdr-pad-item">${shown ? shown.name : '—'}</span>`
      + (sub ? `<span class="wdr-pad-sub">${sub}</span>` : '');
    pad.title = !shown
      ? `Drop any ${label.toLowerCase()} piece here — it lands on its own layer`
      : fellBack
        ? `${shown.name} is on the ${layerLabel(slot, fellBack)} layer — click to go there`
        : `${shown.name} — click to take off`;

    wirePad(pad, slot, fellBack);
    stage.appendChild(pad);
  }

  syncArmed();
}

// Drop/tap wiring for one pad. Shared by both pad shapes so the accessory pad and
// the body pads can never take a garment by different rules — the accessory pad
// is the one that used to fall behind, because it renders in its own branch.
//
// `fellBack`, when set, is the layer the shown piece really lives on; a bare tap
// then NAVIGATES there instead of removing anything (see renderDoll).
function wirePad(pad, slot, fellBack = null) {
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
    placeOnDoll(slot, { itemId: draggedItem.itemId, name: draggedItem.name, layer: draggedItem.layer }, true);
    draggedItem = null;
    renderDoll();
  });

  // Tap route: an armed garment lands on any pad that matches its slot. With
  // nothing armed, a filled body pad takes its piece off — except on a fallback,
  // where the tap goes to that layer instead. The accessory pad does neither:
  // its rows each remove themselves, so a bare tap on the pad body does nothing
  // rather than guessing which of three accessories you meant.
  pad.onclick = () => {
    if (!armedItem) {
      if (fellBack) { dollLayer = fellBack; renderDoll(); return; }
      if (slot !== 'accessory' && doll[slot]?.[dollLayer]) {
        showWardrobeNotify(`Took off ${doll[slot][dollLayer].name}.`);
        delete doll[slot][dollLayer];
        renderDoll();
      }
      return;
    }
    if (armedItem.slot !== slot) return;
    placeOnDoll(slot, { itemId: armedItem.itemId, name: armedItem.name, layer: armedItem.layer }, true);
    armedItem = null;
    renderDoll();
  };
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
  // Nothing to wear with an empty doll — same rule Save already applies.
  const wearNowBtn = document.getElementById('wardrobe-wear-now');
  if (wearNowBtn) wearNowBtn.disabled = count === 0;
}

// Every piece on the doll, innermost first — an outfit is saved at FULL DEPTH.
// A body slot holds a `{ layer -> piece }` map, not one piece, so reading
// `doll[slot].itemId` here (as this once did) yielded `undefined` for every
// layered slot: the liner, the shirt and the plate all collapsed into one
// literal "undefined" id and the saved look came back empty. Walking LAYERS is
// what makes the panel able to save what it can visibly compose.
function dollItemIds() {
  const ids = [];
  for (const { slot } of PADS) {
    if (slot === 'accessory') { for (const p of (doll.accessory || [])) ids.push(p.itemId); continue; }
    const byLayer = doll[slot] || {};
    for (const layer of LAYERS) if (byLayer[layer]) ids.push(byLayer[layer].itemId);
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

  // "Wear Now" — put the composed look on directly, no save required. Before
  // this the doll could only ever produce a saved outfit, and the saved outfit's
  // own `wear` button was the sole way to actually put anything on: trying a
  // look meant naming it and spending a wardrobe slot just to test it once.
  document.getElementById('wardrobe-wear-now').addEventListener('click', () => {
    const ids = dollItemIds();
    if (!ids.length) { showWardrobeNotify('Drag at least one piece onto the doll.'); return; }
    sendCmdSilent(`outfitwearnowid ${activeWardrobeId} ${ids.join(',')}`);
  });

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
