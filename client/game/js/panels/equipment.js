import { state } from '../state.js';
import { sendCmd, sendCmdSilent } from '../net.js';

const DROP_SVG = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="1" width="6" height="4" rx="0.5" stroke="currentColor" stroke-width="1.3"/><line x1="7" y1="5" x2="7" y2="8.5" stroke="currentColor" stroke-width="1.3"/><path d="M4.5 7.5 L7 10.5 L9.5 7.5" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round" stroke-linecap="round"/><line x1="2" y1="13" x2="12" y2="13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;

let equipDraggedId = null;
let dragHandled = false;
let lastItems = [];
let lastWeight = null;
let lastCapacity = null;
let _invWaiters = []; // resolvers awaiting the next inventory payload
let _silentPending = 0; // count of in-flight silent refreshes (responses shouldn't open the panel)

// Read-only snapshot of the last inventory payload (id/name/tags/actions per item).
export function getEquipInventory() { return lastItems; }

// The next inventory response is a silent refresh iff a token is pending — the
// dispatch handler calls this to decide whether to auto-open the equip panel.
export function consumeSilentInventory() {
  if (_silentPending > 0) { _silentPending--; return true; }
  return false;
}

// Silently ask the server for a fresh inventory and resolve once it arrives (or
// after a short timeout, so callers never hang). Used by smartbar macros to make
// `has`/`lacks` reliable without the player having opened any panel — and without
// the response popping the inventory panel open.
export function refreshInventory() {
  return new Promise((resolve) => {
    _invWaiters.push(resolve);
    _silentPending++;
    sendCmdSilent('inventory');
    setTimeout(() => {
      const i = _invWaiters.indexOf(resolve);
      if (i >= 0) { _invWaiters.splice(i, 1); if (_silentPending > 0) _silentPending--; resolve(lastItems); }
    }, 1500);
  });
}

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

// Build a backpack item card (used by the plain inventory list). Click → detail,
// drop button → ground, drag out → drop.
function buildItemCard(item) {
  const tags = item.tags || {};
  const equippable = !!tags.slot;
  const card = document.createElement('div');
  card.className = 'equip-item-card' + (equippable ? ' equippable' : '');
  card.setAttribute('draggable', 'true');
  card.setAttribute('data-id', item.id);
  const qty = item.quantity > 1 ? ` x${item.quantity}` : '';
  const eq = item.is_equipped ? ' <span class="eic-eq">[equipped]</span>' : '';
  const slotLabel = tags.slot ? ` · ${tags.slot.replace('_',' ')}` : '';
  card.innerHTML = `<span class="eic-name">${item.name}${qty}${eq}</span><span class="eic-meta">${slotLabel}</span><button class="eic-drop-btn" title="Drop on ground">${DROP_SVG}</button>`;
  card.ondragstart = (e) => onItemDragStart(e, item.id);
  card.ondragend = () => card.classList.remove('dragging');
  card.onclick = () => showItemDetail(item);
  card.querySelector('.eic-drop-btn').onclick = (e) => { e.stopPropagation(); dropItem(item); };
  return card;
}

export function renderEquipPanel(items, weight, capacity) {
  lastItems = items;
  if (weight !== undefined) lastWeight = weight;
  if (capacity !== undefined) lastCapacity = capacity;
  // Wake anyone awaiting a fresh inventory (refreshInventory).
  if (_invWaiters.length) { const ws = _invWaiters; _invWaiters = []; for (const r of ws) r(lastItems); }

  const list = document.getElementById('equip-inv-list');
  list.innerHTML = '';
  for (const item of items) list.appendChild(buildItemCard(item));

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

  // Header badges: instance flags, equipped state.
  const badges = [];
  for (const f of ['broken', 'cursed']) {
    if (item.custom_data && item.custom_data[f]) badges.push(`<span class="idp-badge flag">${f}</span>`);
  }
  if (item.is_equipped) badges.push(`<span class="idp-badge equipped">equipped</span>`);
  const badgeHtml = badges.length ? `<div class="idp-badges">${badges.join('')}</div>` : '';

  const desc = tags.description ? escapeHtml(tags.description) : '<span class="idp-nodesc">No description.</span>';
  const statHtml = itemStatRows(item).map(([k, v]) =>
    `<div class="idp-stat"><span class="idp-stat-k">${escapeHtml(k)}</span><span class="idp-stat-v">${escapeHtml(v)}</span></div>`
  ).join('');

  // Verb buttons: Equip/Unequip (if equippable) + server-provided actions + Drop.
  const verbs = [];
  if (tags.slot && !item.is_equipped) verbs.push({ label: 'Equip', kind: 'equip' });
  if (tags.slot && item.is_equipped) verbs.push({ label: 'Unequip', kind: 'unequip' });
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
      if (v.kind === 'equip') { closeItemDetail(); sendCmdSilent(`equipid ${item.id}`); }
      else if (v.kind === 'unequip') { closeItemDetail(); sendCmdSilent(`unequipid ${item.id}`); }
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

  document.getElementById('equip-inv-list').addEventListener('dragover', e => e.preventDefault());

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

  initGearPanel();
}

// ── Gear screen ────────────────────────────────────────────────────────────
// Layered equipment view: a row per body slot × 3 layers, weapon, accessories,
// a soak-per-region table, passive effects, and the equippable-item list.

const GEAR_BODY_SLOTS = ['head','torso','hands','legs','feet'];
const GEAR_LAYERS = [
  { key: 'underwear', label: 'Underwear', n: 1 },
  { key: 'outerwear', label: 'Outerwear', n: 2 },
  { key: 'armor', label: 'Armor', n: 3 },
];
const GEAR_SLOT_LABELS = { head:'Head', torso:'Torso', hands:'Hands', legs:'Legs', feet:'Feet' };
// Armor table: one row per body slot (always all five), one column per damage type
// (always all five). Cells show that slot's total soak summed across worn layers.
const DAMAGE_TYPES = ['kinetic','edged','energy','fire','radiation'];
const ARMOR_SLOTS = ['head','torso','hands','legs','feet'];
// Filter categories (client-only toggles). All on by default.
const GEAR_FILTERS = ['underwear','outerwear','armor','weapon','accessories'];
let gearFilter = new Set(GEAR_FILTERS);
let lastGear = null;
// Layout view: 'grid' (layers × slots table) or 'paperdoll' (human silhouette,
// one layer at a time). gearDollLayer indexes GEAR_LAYERS (0..2).
// The view to open on when Gear is chosen (user-set via the "Default" checkbox).
function loadDefaultView() {
  return localStorage.getItem('gearDefaultView') === 'paperdoll' ? 'paperdoll' : 'grid';
}
let gearView = loadDefaultView();
let gearDollLayer = GEAR_LAYERS.length - 1; // default to Armor (top layer)
// A garment occupies its own slot plus every slot in its `covers` tag (a jumpsuit
// worn on the torso also fills the legs), so one piece reads as worn on — and
// protects — both body parts in the grid, paperdoll, and armor table.
const occupiesSlot = (i, slot) => i.slot === slot || (Array.isArray(i.tags?.covers) && i.tags.covers.includes(slot));
// Show per-part armor/insulation ratings on the paperdoll chips.
let gearShowRatings = localStorage.getItem('gearShowRatings') === '1';

export function openGearPanel() {
  gearView = loadDefaultView(); // always open on the user's chosen default view
  import('../net.js').then(m => m.sendCmd('gear'));
}
export function closeGearPanel() {
  document.getElementById('gear-panel').classList.remove('active');
}

export function renderGearPanel(msg) {
  lastGear = msg;
  const items = msg.items || [];
  const equipped = items.filter(i => i.is_equipped);

  renderGearLayout();
  updateViewbar();

  // Armor table: a row per body slot (always all five), a column per damage type
  // (always all five). Each cell is the slot's total soak, summed across every worn
  // layer covering that slot. Empty slots read as zeroes.
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const slotSoak = (slot) => {
    const totals = {};
    for (const p of equipped.filter(i => occupiesSlot(i, slot))) {
      const soak = p.tags?.armor_soak || {};
      for (const t of DAMAGE_TYPES) totals[t] = (totals[t] || 0) + (Number(soak[t]) || 0);
    }
    return totals;
  };
  let armorHtml = '<table class="gear-armortable"><thead><tr><th>Slot</th>' +
    DAMAGE_TYPES.map(t => `<th>${escapeHtml(cap(t))}</th>`).join('') + '</tr></thead><tbody>';
  for (const slot of ARMOR_SLOTS) {
    const totals = slotSoak(slot);
    armorHtml += `<tr><td class="gear-armor-slot">${escapeHtml(GEAR_SLOT_LABELS[slot])}</td>` +
      DAMAGE_TYPES.map(t => `<td>${totals[t] || 0}</td>`).join('') + '</tr>';
  }
  document.getElementById('gear-armor').innerHTML = armorHtml + '</tbody></table>';

  // Passive effects block.
  const fx = msg.effects || {};
  const fxParts = [];
  const sb = fx.stat_bonus || {};
  for (const [k,v] of Object.entries(sb)) fxParts.push(`${k.replace('stat_','')} ${v > 0 ? '+' : ''}${v}`);
  if (fx.insulation) fxParts.push(`insulation ${fx.insulation}°C`);
  if (fx.sealed) fxParts.push('sealed airway');
  if (fx.exposurePenalty) fxParts.push(`exposure ${fx.exposurePenalty}`);
  const fxEl = document.getElementById('gear-effects');
  fxEl.innerHTML = fxParts.length
    ? `<div class="gear-fx">${fxParts.map(escapeHtml).join(' · ')}</div>`
    : '<div class="gear-fx gear-fx-empty">None.</div>';

  // Equippable-item list (reuses the inventory card + detail modal).
  // Only unequipped pieces — what's worn already shows in the layout/armor tables above.
  const list = document.getElementById('gear-inv-list');
  list.innerHTML = '';
  for (const item of items.filter(i => !i.is_equipped)) list.appendChild(buildItemCard(item));

  applyGearFilter();
}

// Render #gear-layout in the active view (grid or paperdoll). Reads lastGear so
// the view toggle / layer stepper can re-render without a server round-trip.
function renderGearLayout() {
  const layout = document.getElementById('gear-layout');
  if (!layout || !lastGear) return;
  const items = lastGear.items || [];
  const equipped = items.filter(i => i.is_equipped);
  if (gearView === 'paperdoll') renderPaperdoll(layout, equipped);
  else renderGearGrid(layout, equipped);

  // Clicking a filled cell opens the item detail (same behaviour as inventory).
  layout.querySelectorAll('[data-id]').forEach(el => {
    el.onclick = () => { const it = items.find(i => i.id == el.dataset.id); if (it) showItemDetail(it); };
  });
  // Any cell carrying a data-slot accepts a dragged inventory item → equip.
  layout.querySelectorAll('[data-slot]').forEach(wireEquipDropTarget);
}

// Grid view: body slots × layers table, then a weapon + accessories strip.
function renderGearGrid(layout, equipped) {
  const cellItem = (slot, n) => equipped.find(i => occupiesSlot(i, slot) && (i.layer || 1) === n);
  let html = '<table class="gear-grid"><thead><tr><th></th>' +
    GEAR_LAYERS.map(l => `<th data-cat="${l.key}">${l.label}</th>`).join('') + '</tr></thead><tbody>';
  for (const slot of GEAR_BODY_SLOTS) {
    html += `<tr><th class="gear-rowlabel">${GEAR_SLOT_LABELS[slot]}</th>`;
    for (const l of GEAR_LAYERS) {
      const it = cellItem(slot, l.n);
      html += `<td data-cat="${l.key}" data-slot="${slot}" class="gear-cell${it ? ' filled' : ''}"${it ? ` data-id="${it.id}"` : ''}>${it ? escapeHtml(it.name) : '·'}</td>`;
    }
    html += '</tr>';
  }
  layout.innerHTML = html + '</tbody></table>';

  const weapon = equipped.find(i => i.slot === 'weapon_hand');
  const accessories = equipped.filter(i => i.slot === 'accessory').sort((a,b) => (a.layer||0)-(b.layer||0));
  let strip = `<div class="gear-strip" data-cat="weapon"><span class="gear-striplabel">Weapon</span>` +
    `<span class="gear-cell${weapon ? ' filled' : ''}" data-slot="weapon_hand"${weapon ? ` data-id="${weapon.id}"` : ''}>${weapon ? escapeHtml(weapon.name) : '·'}</span></div>`;
  strip += `<div class="gear-strip" data-cat="accessories"><span class="gear-striplabel">Accessories</span>`;
  for (let i = 0; i < 3; i++) {
    const a = accessories[i];
    strip += `<span class="gear-cell${a ? ' filled' : ''}" data-slot="accessory"${a ? ` data-id="${a.id}"` : ''}>${a ? escapeHtml(a.name) : '·'}</span>`;
  }
  strip += '</div>';
  layout.insertAdjacentHTML('beforeend', strip);
}

// Paperdoll view: slot chips positioned in a human silhouette. Body slots show
// the piece worn in the currently-selected layer (gearDollLayer); weapon and
// accessories (which aren't layered) always show.
function renderPaperdoll(layout, equipped) {
  const layer = GEAR_LAYERS[gearDollLayer];
  const bodyItem = (slot) => equipped.find(i => occupiesSlot(i, slot) && (i.layer || 1) === layer.n);
  // Per-part protection, summed across every worn layer on that slot (not just the
  // displayed one) — shown under the chip name when "Ratings" is on.
  const ratingRow = (slot) => {
    if (!gearShowRatings || !GEAR_BODY_SLOTS.includes(slot)) return '';
    let armor = 0, insul = 0;
    for (const p of equipped.filter(i => occupiesSlot(i, slot))) {
      armor += Number(p.tags?.armor) || 0;
      insul += Number(p.tags?.insulation) || 0;
    }
    return `<span class="gds-rating">🛡${armor} · ❄${insul % 1 ? insul.toFixed(1) : insul}</span>`;
  };
  const chip = (slot, it, label) =>
    `<div class="gear-doll-slot gear-doll-${slot}${it ? ' filled' : ''}" data-slot="${slot}"${it ? ` data-id="${it.id}"` : ''}>` +
    `<span class="gds-label">${label}</span><span class="gds-name">${it ? escapeHtml(it.name) : '·'}</span>${ratingRow(slot)}</div>`;

  let html = '<div class="gear-paperdoll">';
  html += `<svg class="gear-doll-svg" viewBox="0 0 120 260" aria-hidden="true">` +
    `<circle cx="60" cy="26" r="18"/>` +
    `<path d="M42 46 h36 l8 60 h-14 l-4 -34 v78 h-8 v-46 h-2 v46 h-8 v-78 l-4 34 h-14 z"/>` +
    `<rect x="34" y="46" width="52" height="4"/></svg>`;
  for (const slot of GEAR_BODY_SLOTS) html += chip(slot, bodyItem(slot), GEAR_SLOT_LABELS[slot]);
  html += chip('weapon_hand', equipped.find(i => i.slot === 'weapon_hand'), 'Weapon');
  const acc = equipped.filter(i => i.slot === 'accessory').sort((a,b) => (a.layer||0)-(b.layer||0))[0];
  html += chip('accessory', acc, 'Accessory');
  html += '</div>';
  layout.innerHTML = html;
}

// Build/refresh the view toggle + layer stepper above the layout.
function updateViewbar() {
  const bar = document.getElementById('gear-viewbar');
  if (!bar) return;
  const layer = GEAR_LAYERS[gearDollLayer];
  const isDefault = gearView === loadDefaultView();
  bar.innerHTML =
    `<button class="gear-view-btn" data-view="grid">Grid</button>` +
    `<button class="gear-view-btn" data-view="paperdoll">Paperdoll</button>` +
    `<label class="gear-check" title="Open Gear on this view by default">` +
      `<input type="checkbox" class="gear-default-check"${isDefault ? ' checked' : ''}> Default</label>` +
    (gearView === 'paperdoll'
      ? `<label class="gear-check" title="Show armor/insulation on each body part">` +
          `<input type="checkbox" class="gear-ratings-check"${gearShowRatings ? ' checked' : ''}> Ratings</label>` +
        `<div class="gear-layer-step"><button class="gls-btn" data-dir="up" title="Layer up">▲</button>` +
        `<span class="gls-label">${layer.label} (${gearDollLayer + 1}/${GEAR_LAYERS.length})</span>` +
        `<button class="gls-btn" data-dir="down" title="Layer down">▼</button></div>`
      : '');
  bar.querySelectorAll('.gear-view-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === gearView);
    b.onclick = () => { gearView = b.dataset.view; renderGearLayout(); updateViewbar(); };
  });
  // "Default" marks the current view as the one Gear opens on. With only two views,
  // unchecking necessarily makes the other view the default.
  const defCheck = bar.querySelector('.gear-default-check');
  if (defCheck) defCheck.onchange = () => {
    const def = defCheck.checked ? gearView : (gearView === 'grid' ? 'paperdoll' : 'grid');
    localStorage.setItem('gearDefaultView', def);
    updateViewbar();
  };
  const rateCheck = bar.querySelector('.gear-ratings-check');
  if (rateCheck) rateCheck.onchange = () => {
    gearShowRatings = rateCheck.checked;
    localStorage.setItem('gearShowRatings', gearShowRatings ? '1' : '0');
    renderGearLayout();
  };
  bar.querySelectorAll('.gls-btn').forEach(b => {
    b.onclick = () => { stepDollLayer(b.dataset.dir === 'up' ? 1 : -1); };
  });
}

function stepDollLayer(delta) {
  const n = GEAR_LAYERS.length;
  gearDollLayer = (gearDollLayer + delta + n) % n;
  renderGearLayout();
  updateViewbar();
}

// Wire an element carrying data-slot as a drop target: an equippable inventory
// item whose natural slot matches is equipped on drop.
function wireEquipDropTarget(el) {
  const slot = el.dataset.slot;
  el.addEventListener('dragover', e => {
    const item = equipDraggedId != null && (lastGear?.items || []).find(i => i.id == equipDraggedId);
    if (item && (item.tags?.slot) === slot) { e.preventDefault(); el.classList.add('gear-drop-ok'); }
  });
  el.addEventListener('dragleave', () => el.classList.remove('gear-drop-ok'));
  el.addEventListener('drop', e => {
    el.classList.remove('gear-drop-ok');
    const id = equipDraggedId;
    const item = id != null && (lastGear?.items || []).find(i => i.id == id);
    if (!item || (item.tags?.slot) !== slot) return;
    e.preventDefault();
    dragHandled = true;
    sendCmdSilent(`equipid ${id}`);
  });
}

// Filter the equippable list per the active filter set. The worn layout/armor
// tables above are never affected — filtering only narrows the list of pieces you
// could equip.
function applyGearFilter() {
  const on = (cat) => gearFilter.has(cat);
  document.querySelectorAll('#gear-inv-list .equip-item-card').forEach(el => {
    const item = (lastGear?.items || []).find(i => i.id == el.dataset.id);
    const cat = itemCategory(item);
    el.classList.toggle('gear-hidden', cat && !on(cat));
  });
  document.querySelectorAll('#gear-filters .gear-filter-btn').forEach(b => {
    if (b.dataset.filter === 'all') return;
    b.classList.toggle('off', !on(b.dataset.filter));
  });
}

// Which filter category an item belongs to, for list dimming.
function itemCategory(item) {
  const t = item?.tags || {};
  if (!t.slot) return null;
  if (t.slot === 'weapon_hand') return 'weapon';
  if (t.slot === 'accessory') return 'accessories';
  const layer = t.layer || 'outerwear';
  return GEAR_LAYERS.some(l => l.key === layer) ? layer : 'outerwear';
}

function initGearPanel() {
  document.getElementById('gear-close').addEventListener('click', closeGearPanel);
  document.getElementById('gear-panel').addEventListener('click', (e) => {
    if (e.target.id === 'gear-panel') closeGearPanel();
  });

  // Collapsible Armor / Insulation sections: collapsed by default, state persisted.
  document.querySelectorAll('#gear-body .gear-collapse').forEach(sec => {
    const key = `gearCollapse_${sec.dataset.collapse}`;
    // Default collapsed; only an explicit '0' expands.
    sec.classList.toggle('collapsed', localStorage.getItem(key) !== '0');
    sec.querySelector('.gear-collapse-head').addEventListener('click', () => {
      const collapsed = sec.classList.toggle('collapsed');
      localStorage.setItem(key, collapsed ? '1' : '0');
    });
  });

  // Build filter buttons: All + per-category toggles.
  const bar = document.getElementById('gear-filters');
  const mk = (filter, label) => {
    const b = document.createElement('button');
    b.className = 'gear-filter-btn';
    b.dataset.filter = filter;
    b.textContent = label;
    bar.appendChild(b);
    return b;
  };
  // Up/Down arrows cycle paperdoll layers while the gear panel is open.
  document.addEventListener('keydown', e => {
    const panel = document.getElementById('gear-panel');
    if (!panel || !panel.classList.contains('active') || gearView !== 'paperdoll') return;
    if (e.key === 'ArrowUp') { e.preventDefault(); stepDollLayer(1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); stepDollLayer(-1); }
  });

  mk('all', 'All').onclick = () => { gearFilter = new Set(GEAR_FILTERS); applyGearFilter(); };
  for (const f of GEAR_FILTERS) {
    mk(f, f.charAt(0).toUpperCase() + f.slice(1)).onclick = () => {
      if (gearFilter.has(f)) gearFilter.delete(f); else gearFilter.add(f);
      applyGearFilter();
    };
  }
}
