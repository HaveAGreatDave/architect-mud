import { state } from '../state.js';
import { sendCmd, sendCmdSilent } from '../net.js';

const DROP_SVG = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="1" width="6" height="4" rx="0.5" stroke="currentColor" stroke-width="1.3"/><line x1="7" y1="5" x2="7" y2="8.5" stroke="currentColor" stroke-width="1.3"/><path d="M4.5 7.5 L7 10.5 L9.5 7.5" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round" stroke-linecap="round"/><line x1="2" y1="13" x2="12" y2="13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;

let equipDraggedId = null;
let dragHandled = false;
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
// Soak table regions. Combat maps the 'arms' body part to the hands armor slot.
const SOAK_REGIONS = [
  { slot:'head', label:'Head' }, { slot:'torso', label:'Torso' },
  { slot:'hands', label:'Arms' }, { slot:'legs', label:'Legs' },
  { slot:'feet', label:'Feet' },
];
// Filter categories (client-only toggles). All on by default.
const GEAR_FILTERS = ['underwear','outerwear','armor','weapon','accessories'];
let gearFilter = new Set(GEAR_FILTERS);
let lastGear = null;

export function openGearPanel() {
  import('../net.js').then(m => m.sendCmd('gear'));
}
export function closeGearPanel() {
  document.getElementById('gear-panel').classList.remove('active');
}

export function renderGearPanel(msg) {
  lastGear = msg;
  const items = msg.items || [];
  const equipped = items.filter(i => i.is_equipped);
  const cellItem = (slot, n) => equipped.find(i => i.slot === slot && (i.layer || 1) === n);

  // Layered layout: body slots × layers, then weapon + accessories.
  const layout = document.getElementById('gear-layout');
  let html = '<table class="gear-grid"><thead><tr><th></th>' +
    GEAR_LAYERS.map(l => `<th data-cat="${l.key}">${l.label}</th>`).join('') + '</tr></thead><tbody>';
  for (const slot of GEAR_BODY_SLOTS) {
    html += `<tr><th class="gear-rowlabel">${GEAR_SLOT_LABELS[slot]}</th>`;
    for (const l of GEAR_LAYERS) {
      const it = cellItem(slot, l.n);
      html += `<td data-cat="${l.key}" class="gear-cell${it ? ' filled' : ''}"${it ? ` data-id="${it.id}"` : ''}>${it ? escapeHtml(it.name) : '·'}</td>`;
    }
    html += '</tr>';
  }
  layout.innerHTML = html + '</tbody></table>';

  // Weapon + accessories strip.
  const weapon = equipped.find(i => i.slot === 'weapon_hand');
  const accessories = equipped.filter(i => i.slot === 'accessory').sort((a,b) => (a.layer||0)-(b.layer||0));
  let strip = `<div class="gear-strip" data-cat="weapon"><span class="gear-striplabel">Weapon</span>` +
    `<span class="gear-cell${weapon ? ' filled' : ''}"${weapon ? ` data-id="${weapon.id}"` : ''}>${weapon ? escapeHtml(weapon.name) : '·'}</span></div>`;
  strip += `<div class="gear-strip" data-cat="accessories"><span class="gear-striplabel">Accessories</span>`;
  for (let i = 0; i < 3; i++) {
    const a = accessories[i];
    strip += `<span class="gear-cell${a ? ' filled' : ''}"${a ? ` data-id="${a.id}"` : ''}>${a ? escapeHtml(a.name) : '·'}</span>`;
  }
  strip += '</div>';
  layout.insertAdjacentHTML('beforeend', strip);

  // Clicking a filled cell opens the item detail (same behaviour as inventory).
  layout.querySelectorAll('[data-id]').forEach(el => {
    el.onclick = () => { const it = items.find(i => i.id == el.dataset.id); if (it) showItemDetail(it); };
  });

  // Soak table (all five regions, including feet).
  const soak = msg.soak || {};
  const types = [...new Set(SOAK_REGIONS.flatMap(r => Object.keys(soak[r.slot]?.soak || {})))];
  let soakHtml = '<div class="gear-section-label">Soak</div><table class="gear-soaktable"><tbody>';
  for (const r of SOAK_REGIONS) {
    const entry = soak[r.slot] || {};
    const parts = types.map(t => `${t} ${entry.soak?.[t] || 0}`);
    if (entry.flat) parts.push(`flat ${entry.flat}`);
    const val = parts.length ? parts.join(' · ') : '—';
    soakHtml += `<tr><td class="gear-soak-region">${r.label}</td><td class="gear-soak-val">${escapeHtml(val)}</td></tr>`;
  }
  document.getElementById('gear-soak').innerHTML = soakHtml + '</tbody></table>';

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
    ? `<div class="gear-section-label">Effects</div><div class="gear-fx">${fxParts.map(escapeHtml).join(' · ')}</div>`
    : '';

  // Equippable-item list (reuses the inventory card + detail modal).
  const list = document.getElementById('gear-inv-list');
  list.innerHTML = '';
  for (const item of items) list.appendChild(buildItemCard(item));

  document.getElementById('gear-credits-val').textContent = msg.credits ?? ((state.player && state.player.credits) || 0);
  const wtEl = document.getElementById('gear-weight-val');
  if (wtEl && msg.capacity != null) wtEl.textContent = `${formatWeight(msg.weight)}/${formatWeight(msg.capacity)}`;

  applyGearFilter();
}

// Show/hide columns and strips per the active filter set; dim non-matching list rows.
function applyGearFilter() {
  const on = (cat) => gearFilter.has(cat);
  document.querySelectorAll('#gear-layout [data-cat]').forEach(el => {
    el.classList.toggle('gear-hidden', !on(el.dataset.cat));
  });
  // List cards: dim those whose slot/layer category is filtered off.
  document.querySelectorAll('#gear-inv-list .equip-item-card').forEach(el => {
    const item = (lastGear?.items || []).find(i => i.id == el.dataset.id);
    const cat = itemCategory(item);
    el.classList.toggle('gear-dim', cat && !on(cat));
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
  mk('all', 'All').onclick = () => { gearFilter = new Set(GEAR_FILTERS); applyGearFilter(); };
  for (const f of GEAR_FILTERS) {
    mk(f, f.charAt(0).toUpperCase() + f.slice(1)).onclick = () => {
      if (gearFilter.has(f)) gearFilter.delete(f); else gearFilter.add(f);
      applyGearFilter();
    };
  }
}
