async function npcSendToWork(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Moving…'; }
  try {
    const res = await API('/npcs/send-to-work', 'POST');
    if (res?.error) { toast(res.error, true); return; }
    if (!res.count) { toast('All NPCs already at their work zone.'); return; }
    toast(`Moved ${res.count} NPC${res.count !== 1 ? 's' : ''} to their work zones.`);
    await loadPanel('npcs');
  } catch (e) {
    toast(e.message, true);
  } finally {
    if (btn) { btn.disabled = false; }
  }
}

async function deleteNpcRow(id) {
  const rec = allRecords.find(r => r.id === id);
  if (!rec || rec._stagingStatus === 'pending delete') return;
  if (!confirm(`Delete ${rec.name || id}?`)) return;
  const prev = currentRecord;
  currentRecord = rec;
  const result = await API(`/npcs/${id}`, 'DELETE');
  currentRecord = prev;
  if (result?.error) { toast(result.error, true); return; }
  if (result?.staged) {
    toast('Marked for deletion — publish to apply');
    await updateStagingBadge();
  } else {
    toast(result?.message || 'Deleted');
  }
  await loadPanel('npcs');
}

function renderNpcsPanel(data) {
  const records = Array.isArray(data) ? data : [];
  allRecords = records;
  const panel = document.getElementById('list-panel');
  if (!records.length) { panel.innerHTML = '<div style="padding:24px;color:var(--text-dim)">No NPCs found.</div>'; return; }

  const columns = PANELS.npcs.columns;
  const hasStagedRows = records.some(r => r._stagingStatus);
  let html = '<table><thead><tr>';
  for (const col of columns) {
    const isSorted = sortState.key === col.key;
    const arrow = isSorted ? (sortState.dir === 1 ? ' ▲' : ' ▼') : '';
    html += `<th class="sortable-col${isSorted?' sorted':''}" onclick="sortTableBy('${col.key}')">${col.label}${arrow}</th>`;
  }
  if (hasStagedRows) html += '<th>Status</th>';
  html += '<th></th></tr></thead><tbody>';

  let sorted = records;
  if (sortState.key) {
    sorted = [...records].sort((a, b) => {
      let av = a[sortState.key], bv = b[sortState.key];
      if (av == null) av = ''; if (bv == null) bv = '';
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sortState.dir;
      return String(av).localeCompare(String(bv)) * sortState.dir;
    });
  }

  for (const rec of sorted) {
    const isPendingDelete = rec._stagingStatus === 'pending delete';
    const rowStyle = isPendingDelete
      ? 'cursor:pointer;opacity:0.6;text-decoration:line-through'
      : rec._stagingStatus ? 'cursor:pointer;border-left:3px solid var(--warning)' : 'cursor:pointer';
    html += `<tr style="${rowStyle}" onclick="editRecord('${rec.id}')">`;
    for (const col of columns) {
      const raw = rec[col.key];
      const val = col.render ? col.render(raw) : (raw ?? '—');
      html += `<td>${val}</td>`;
    }
    if (hasStagedRows) {
      const s = rec._stagingStatus;
      const badge = s === 'pending delete'
        ? `<span style="color:var(--danger);font-size:11px">⚠ ${s}</span>`
        : s ? `<span style="color:var(--warning);font-size:11px">● ${s}</span>` : '';
      html += `<td>${badge}</td>`;
    }
    html += `<td style="white-space:nowrap">
      <button class="action-btn" onclick="event.stopPropagation();editRecord('${rec.id}')">Edit</button>
      ${isPendingDelete ? '' : `<button class="action-btn danger" style="margin-left:3px" onclick="event.stopPropagation();deleteNpcRow('${rec.id}')">Delete</button>`}
    </td>`;
    html += '</tr>';
  }
  html += '</tbody></table>';

  const lateCount = records.filter(r => r.work_zone_id && r.zone_id !== r.work_zone_id).length;
  const lateLabel = lateCount ? `Send to Work (${lateCount} late)` : 'Send to Work';
  const toolbar = `<div style="padding:6px 12px;border-bottom:1px solid var(--border);background:var(--bg2);display:flex;align-items:center;gap:8px">
    <button class="action-btn" style="font-size:11px;padding:3px 10px" onclick="npcSendToWork(this)"
      title="Teleport all NPCs with a work_zone who aren't there yet">${lateLabel}</button>
    ${lateCount ? `<span style="font-size:11px;color:var(--text-dim)">${lateCount} NPC${lateCount !== 1 ? 's' : ''} not at their work zone</span>` : '<span style="font-size:11px;color:var(--text-dim)">All NPCs at work</span>'}
  </div>`;

  panel.innerHTML = toolbar + html;
}

// --- Zone forms ---
// Controls which entrance-discovery flavor-text bank a building uses
// (server-side bank lives in commands.js, keyed by the same ids).
const NPC_CHITCHAT_PRESETS = {
  tv_host: [
    "We'll be right back after these messages.",
    "Incredible. Simply incredible. Stay with us.",
    "That's all the time we have for tonight, folks.",
    "Let's go to our correspondent in the field.",
    "Live from the ruins of civilization — this is the news.",
    "Don't touch that dial. Actually, you can't. The dial broke years ago.",
    "Our ratings are through the roof. The roof itself is on fire.",
    "I'm told we have a caller. Hello, you're on the air.",
    "This next segment has been approved by our corporate overlords.",
    "Remember: what you're about to see cannot be unseen.",
  ],
  bartender: [
    "What'll it be?",
    "You look like you've had a rough one.",
    "Pay first. Trust later. That's policy.",
    "You're not the first person to cry at this bar. Won't be the last.",
    "I've heard worse. Much worse.",
    "Last call was three hours ago. I'm still here.",
    "We're out of the good stuff. We were always out of the good stuff.",
    "Tab's running. Keep drinking.",
    "I don't ask questions. That's why people come here.",
    "You want ice with that? Funny.",
  ],
  vendor: [
    "Best prices in the district. That's not saying much.",
    "You touch it, you bought it.",
    "Everything's genuine. Genuinely acquired.",
    "Trade you for it. Credits preferred. Bullets accepted.",
    "Limited supply. Always limited. That's the pitch.",
    "I don't know where it came from. That's not your business either.",
    "Come back tomorrow — stock changes. If I'm still here.",
    "Quality merchandise at prices that won't kill you. Probably.",
  ],
  guard: [
    "Move along.",
    "Eyes forward.",
    "I see you.",
    "Nothing happens on my watch. Usually.",
    "This area is restricted. That's not a suggestion.",
    "I've had a long shift. Don't make it longer.",
    "Protocol says I have to say something. So: stop.",
    "Keep it moving.",
    "Don't make me call this in.",
  ],
  thug: [
    "You looking at something?",
    "Watch where you're walking.",
    "This block's got rules.",
    "Nice gear. Shame what happens to nice things.",
    "I seen you around here before?",
    "Mind your business and you'll keep your fingers.",
    "The crew knows your face now.",
    "We run things here. Not them. Us.",
  ],
  doctor: [
    "Don't touch that with your bare hands.",
    "I've seen worse. Barely.",
    "The human body is remarkably resilient. And remarkably stupid.",
    "This won't hurt much.",
    "I can fix that. The question is whether you'll want me to.",
    "My rates are reasonable. For the apocalypse.",
    "Symptom management is all any of us are doing at this point.",
    "Sign the waiver. Everyone signs the waiver.",
  ],
  politician: [
    "We're making progress.",
    "The data supports our approach.",
    "I hear your concerns. I'll note them down.",
    "The situation is under control. My definition of control.",
    "We're committed to accountability. The accountability of others.",
    "This is a temporary measure.",
    "Due process is very important to us.",
    "We are exploring all options. Except the obvious ones.",
  ],
  preacher: [
    "The end was promised. The end delivered.",
    "Repent. It won't help, but the gesture matters.",
    "He watches. Even here.",
    "Salvation is available. Supply is limited.",
    "Blessed are the adaptable.",
    "The scripture didn't specify what kind of fire.",
    "Sin freely. Confess generously. That's the cycle.",
    "Judgment is coming. It commutes.",
  ],
  vagrant: [
    "You got a smoke?",
    "I used to have a job. Good job too.",
    "Don't sleep near the east wall. Trust me.",
    "Seen things out there you wouldn't believe.",
    "It's gonna rain. I can tell. My knee knows.",
    "You got any credits? Just asking.",
    "They took everything. But not this spot. This spot's mine.",
    "The machines don't sleep. I've watched.",
  ],
  mercenary: [
    "This isn't personal. It's a contract.",
    "Better paid than the last job. That's all I ask.",
    "Don't mistake my silence for hesitation.",
    "I've seen a lot of warzones. They all look the same eventually.",
    "Loyalty's expensive. I'm surprisingly affordable.",
    "Eyes open. That's the whole philosophy.",
    "I get paid either way.",
    "There's no good side. Just better rates.",
  ],
  scientist: [
    "The results were unexpected. As always.",
    "Containment is holding. For now.",
    "This is theoretically reversible.",
    "The ethical review board no longer exists. We proceed.",
    "Note: do not touch the sample with your left hand.",
    "I've run the numbers. The numbers are concerning.",
    "Progress requires sacrifice. Usually someone else's.",
    "We're close. We are always close.",
  ],
  cult_member: [
    "He is coming. He is always coming.",
    "Join us. The waiting is easier with company.",
    "The old world is ash. This is better.",
    "We don't recruit. We recognise.",
    "Pain is just loyalty with nerve endings.",
    "Doubt is the first step. We help with the next ones.",
    "There is no leaving. There is only becoming.",
    "The vessel is willing. Are you?",
  ],
};

function npcLoadChitchatPreset() {
  const key = document.getElementById('f-chitchat-preset')?.value;
  if (!key || !NPC_CHITCHAT_PRESETS[key]) return;
  const ta = document.getElementById('f-chitchat');
  if (!ta) return;
  const existing = ta.value.trim();
  const preset = NPC_CHITCHAT_PRESETS[key].join('\n');
  ta.value = existing ? `${existing}\n${preset}` : preset;
}

// ─── Vendor Shop Editor ─────────────────────────────────────────────────────
// Two-bucket picker: Item Pool (left) → Shop Catalogue (right).
// vendor_inventory = catalogue [{item_id, price?}]; managed here.
// vendor_stock     = active shelf; auto-managed by 24 h restock tick.

const _ve = {
  allItems: [],
  catalogue: [],      // [{item_id, price?}]
  leftSel: new Set(),
  rightSel: new Set(),
  lastLeftIdx: null,
  lastRightIdx: null,
  category: 'all',
  search: '',
  activeStockCount: 0,
  npcId: null,
};

const _VE_TYPE = { clothing:'👕', armor:'🛡', weapon:'⚔', consumable:'🧪', drug:'💊', key:'🗝', misc:'📦', ammo:'🔫', tool:'🔧', implant:'🔩', furniture:'🪑' };
const _VE_RARITY_ICON = { common:'⬜', uncommon:'🟩', rare:'🟦', legendary:'🟧', epic:'🟪' };
const _VE_RARITY_COLOR = { common:'var(--text-dim)', uncommon:'var(--accent2)', rare:'var(--cyan)', legendary:'var(--accent3)', epic:'var(--accent)' };

function _veInit(rec, items) {
  _ve.npcId = rec.id || null;
  _ve.allItems = Array.isArray(items) ? items : [];
  _ve.catalogue = Array.isArray(rec.vendor_inventory)
    ? rec.vendor_inventory.map(e => ({ ...e }))
    : JSON.parse(rec.vendor_inventory || '[]');
  _ve.leftSel = new Set();
  _ve.rightSel = new Set();
  _ve.lastLeftIdx = null;
  _ve.lastRightIdx = null;
  _ve.category = 'all';
  _ve.search = '';
  const stock = Array.isArray(rec.vendor_stock) ? rec.vendor_stock : JSON.parse(rec.vendor_stock || '[]');
  _ve.activeStockCount = stock.length;
}

function _veFilteredLeft() {
  const catalogueIds = new Set(_ve.catalogue.map(e => e.item_id));
  return _ve.allItems.filter(item => {
    if (catalogueIds.has(item.id)) return false;
    if (_ve.category !== 'all' && item.type !== _ve.category) return false;
    if (_ve.search) {
      const q = _ve.search.toLowerCase();
      if (!item.name.toLowerCase().includes(q) && !(item.type || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

function _veRow(item, selected, side) {
  const ri = _VE_RARITY_ICON[item.rarity] || '⬜';
  const rc = _VE_RARITY_COLOR[item.rarity] || 'var(--text-dim)';
  const ti = _VE_TYPE[item.type] || '📦';
  const catalogueEntry = _ve.catalogue.find(e => e.item_id === item.id);
  const price = side === 'right' ? (catalogueEntry?.price ?? item.value ?? 0) : (item.value ?? 0);
  const bg = selected ? 'background:rgba(255,46,196,0.1);border-color:rgba(255,46,196,0.4)' : 'border-color:transparent';
  const check = selected ? '☑' : '☐';
  const priceCell = side === 'right'
    ? `<span style="display:flex;align-items:center;gap:1px;flex-shrink:0">
        <span style="color:var(--accent3);font-size:10px">₵</span>
        <input type="number" value="${price}" min="0" step="10"
          style="width:58px;background:var(--bg);border:1px solid var(--border);color:var(--accent3);font-size:11px;padding:1px 4px;border-radius:2px"
          onclick="event.stopPropagation()" onchange="vePriceChange('${item.id}',+this.value)"
          title="Override price (0 = use item base value ₵${item.value ?? 0})">
       </span>`
    : `<span style="color:var(--accent3);font-size:11px;flex-shrink:0" title="Base value">₵${item.value ?? 0}</span>`;
  return `<div class="ve-row" data-id="${item.id}"
    onclick="ve${side==='left'?'Left':'Right'}Click(event,'${item.id}')"
    style="display:flex;align-items:center;gap:6px;padding:5px 8px;cursor:pointer;border:1px solid transparent;border-radius:2px;margin:1px 2px;user-select:none;${bg}">
    <span style="font-size:12px;color:var(--text-dim);flex-shrink:0;width:14px">${check}</span>
    <span style="flex-shrink:0;font-size:13px" title="${item.rarity || 'common'}">${ri}</span>
    <span style="flex:1;font-size:12px;color:${rc};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0" title="${item.name}">${item.name}</span>
    <span style="flex-shrink:0;font-size:12px;opacity:0.7" title="${item.type || ''}">${ti}</span>
    ${priceCell}
  </div>`;
}

function veRenderBuckets() {
  const leftItems = _veFilteredLeft();
  const rightItems = _ve.catalogue
    .map(e => _ve.allItems.find(i => i.id === e.item_id))
    .filter(Boolean);

  const leftEl = document.getElementById('ve-left-list');
  const rightEl = document.getElementById('ve-right-list');
  if (!leftEl || !rightEl) return;

  leftEl.innerHTML = leftItems.length
    ? leftItems.map(item => _veRow(item, _ve.leftSel.has(item.id), 'left')).join('')
    : `<div style="padding:24px 12px;color:var(--text-dim);font-size:11px;text-align:center;font-style:italic">No items${_ve.category !== 'all' ? ' in this category' : ''}</div>`;

  rightEl.innerHTML = rightItems.length
    ? rightItems.map(item => _veRow(item, _ve.rightSel.has(item.id), 'right')).join('')
    : `<div style="padding:24px 12px;color:var(--text-dim);font-size:11px;text-align:center;font-style:italic">Catalogue is empty — add items from the left panel</div>`;

  const lc = document.getElementById('ve-left-count');
  const rc = document.getElementById('ve-right-count');
  if (lc) lc.textContent = `${leftItems.length} item${leftItems.length !== 1 ? 's' : ''}`;
  if (rc) rc.textContent = `${rightItems.length} in catalogue`;

  const stockSize = parseInt(document.getElementById('f-vendor_stock_size')?.value) || 10;
  const statusEl = document.getElementById('ve-stock-status');
  if (statusEl) statusEl.textContent = `Active shelf: ${_ve.activeStockCount} / ${stockSize}`;
}

function veLeftClick(event, itemId) {
  const filtered = _veFilteredLeft();
  const idx = filtered.findIndex(i => i.id === itemId);
  if (event.shiftKey && _ve.lastLeftIdx !== null) {
    const lo = Math.min(_ve.lastLeftIdx, idx), hi = Math.max(_ve.lastLeftIdx, idx);
    for (let i = lo; i <= hi; i++) _ve.leftSel.add(filtered[i].id);
  } else if (event.ctrlKey || event.metaKey) {
    _ve.leftSel.has(itemId) ? _ve.leftSel.delete(itemId) : _ve.leftSel.add(itemId);
  } else {
    _ve.leftSel.clear(); _ve.leftSel.add(itemId);
  }
  _ve.lastLeftIdx = idx;
  veRenderBuckets();
}

function veRightClick(event, itemId) {
  const rightItems = _ve.catalogue.map(e => _ve.allItems.find(i => i.id === e.item_id)).filter(Boolean);
  const idx = rightItems.findIndex(i => i.id === itemId);
  if (event.shiftKey && _ve.lastRightIdx !== null) {
    const lo = Math.min(_ve.lastRightIdx, idx), hi = Math.max(_ve.lastRightIdx, idx);
    for (let i = lo; i <= hi; i++) _ve.rightSel.add(rightItems[i].id);
  } else if (event.ctrlKey || event.metaKey) {
    _ve.rightSel.has(itemId) ? _ve.rightSel.delete(itemId) : _ve.rightSel.add(itemId);
  } else {
    _ve.rightSel.clear(); _ve.rightSel.add(itemId);
  }
  _ve.lastRightIdx = idx;
  veRenderBuckets();
}

function veMoveSelected() {
  for (const id of _ve.leftSel) {
    if (!_ve.catalogue.find(e => e.item_id === id)) {
      const item = _ve.allItems.find(i => i.id === id);
      _ve.catalogue.push({ item_id: id, price: item?.value ?? 0 });
    }
  }
  _ve.leftSel.clear(); _ve.lastLeftIdx = null;
  veRenderBuckets();
}

function veMoveAll() {
  for (const item of _veFilteredLeft()) {
    if (!_ve.catalogue.find(e => e.item_id === item.id))
      _ve.catalogue.push({ item_id: item.id, price: item.value ?? 0 });
  }
  _ve.leftSel.clear();
  veRenderBuckets();
}

function veRemoveSelected() {
  _ve.catalogue = _ve.catalogue.filter(e => !_ve.rightSel.has(e.item_id));
  _ve.rightSel.clear(); _ve.lastRightIdx = null;
  veRenderBuckets();
}

function veRemoveAll() {
  if (!_ve.catalogue.length) return;
  if (!confirm('Remove all items from this vendor\'s catalogue?')) return;
  _ve.catalogue = []; _ve.rightSel.clear();
  veRenderBuckets();
}

function veSelectAllLeft(checked) {
  if (checked) _veFilteredLeft().forEach(i => _ve.leftSel.add(i.id));
  else _ve.leftSel.clear();
  veRenderBuckets();
}

function veSelectAllRight(checked) {
  if (checked) _ve.catalogue.forEach(e => _ve.rightSel.add(e.item_id));
  else _ve.rightSel.clear();
  veRenderBuckets();
}

function veCategory(val) {
  _ve.category = val; _ve.leftSel.clear(); _ve.lastLeftIdx = null;
  veRenderBuckets();
}

function veSearch(val) {
  _ve.search = val; _ve.leftSel.clear(); _ve.lastLeftIdx = null;
  veRenderBuckets();
}

function vePriceChange(itemId, value) {
  const entry = _ve.catalogue.find(e => e.item_id === itemId);
  if (entry) entry.price = Math.max(0, value) || 0;
}

async function veRestockNow() {
  if (!_ve.npcId) { toast('Save the NPC first before restocking.', true); return; }
  const btn = document.getElementById('ve-restock-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⟳ Restocking…'; }
  try {
    const res = await directAPI(`/npcs/${_ve.npcId}/restock`, 'POST');
    if (res?.error) { toast(res.error, true); return; }
    _ve.activeStockCount = (res.vendor_stock || []).length;
    veRenderBuckets();
    toast(`Restocked — ${_ve.activeStockCount} item(s) now on shelf`);
  } catch (e) {
    toast(e.message, true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⟳ Restock Now'; }
  }
}

function _veEditorHtml(rec) {
  const stockSize = rec.vendor_stock_size ?? 10;
  const restockRate = rec.vendor_restock_rate ?? 1;
  const allTypes = [...new Set(_ve.allItems.map(i => i.type))].sort();
  const catOpts = [['all', '— All types —'], ...allTypes.map(t => [t, `${_VE_TYPE[t] || '📦'} ${t}`])]
    .map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  const hdr = 'display:flex;align-items:center;justify-content:space-between;padding:7px 10px;background:var(--bg3);border-bottom:1px solid var(--border)';
  const list = 'height:270px;overflow-y:auto;background:var(--bg)';
  return `
  <div style="border:1px solid var(--border);border-radius:3px;overflow:hidden">
    <!-- top bar -->
    <div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--bg3);border-bottom:2px solid var(--border)">
      <span style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);white-space:nowrap">Category</span>
      <select onchange="veCategory(this.value)" style="font-size:11px;padding:3px 6px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:2px">${catOpts}</select>
      <input id="ve-search-input" placeholder="🔍 filter…" oninput="veSearch(this.value)"
        style="flex:1;font-size:11px;padding:3px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:2px;min-width:0">
    </div>
    <!-- buckets -->
    <div style="display:grid;grid-template-columns:1fr 42px 1fr">
      <!-- left -->
      <div style="display:flex;flex-direction:column">
        <div style="${hdr}">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin:0;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim)">
            <input type="checkbox" onchange="veSelectAllLeft(this.checked)" style="accent-color:var(--accent)"> Item Pool
          </label>
          <span id="ve-left-count" style="font-size:10px;color:var(--text-dim)">—</span>
        </div>
        <div id="ve-left-list" style="${list}"><div style="padding:24px;color:var(--text-dim);font-size:11px;text-align:center">Loading…</div></div>
      </div>
      <!-- transfer -->
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:6px 3px;background:var(--bg3);border-left:1px solid var(--border);border-right:1px solid var(--border)">
        <button class="action-btn primary" onclick="veMoveSelected()" title="Add selected → catalogue" style="padding:5px;width:34px;font-size:15px;line-height:1">→</button>
        <button class="action-btn" onclick="veMoveAll()" title="Add all visible → catalogue" style="padding:3px;width:34px;font-size:11px">⇒</button>
        <div style="height:10px"></div>
        <button class="action-btn danger" onclick="veRemoveSelected()" title="Remove selected from catalogue" style="padding:5px;width:34px;font-size:15px;line-height:1">←</button>
        <button class="action-btn danger" onclick="veRemoveAll()" title="Clear entire catalogue" style="padding:3px;width:34px;font-size:11px">⇐</button>
      </div>
      <!-- right -->
      <div style="display:flex;flex-direction:column">
        <div style="${hdr}">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin:0;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim)">
            <input type="checkbox" onchange="veSelectAllRight(this.checked)" style="accent-color:var(--accent)"> Shop Catalogue
          </label>
          <span id="ve-right-count" style="font-size:10px;color:var(--text-dim)">—</span>
        </div>
        <div id="ve-right-list" style="${list}"><div style="padding:24px;color:var(--text-dim);font-size:11px;text-align:center">Loading…</div></div>
      </div>
    </div>
    <!-- footer: settings + restock -->
    <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:8px 12px;background:var(--bg3);border-top:1px solid var(--border)">
      <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text-dim);white-space:nowrap">
        <span title="Maximum items on the active shelf at once">🛒 Shelf size</span>
        <input type="number" id="f-vendor_stock_size" value="${stockSize}" min="1" max="99"
          style="width:46px;background:var(--bg);border:1px solid var(--border);color:var(--text-bright);font-size:11px;padding:2px 4px;border-radius:2px"
          oninput="veRenderBuckets()">
      </label>
      <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text-dim);white-space:nowrap">
        <span title="Items added to the shelf per 24 h restock tick">⏱ Restock</span>
        <input type="number" id="f-vendor_restock_rate" value="${restockRate}" min="1" max="50"
          style="width:46px;background:var(--bg);border:1px solid var(--border);color:var(--text-bright);font-size:11px;padding:2px 4px;border-radius:2px">
        <span style="color:var(--text-dim)">/day</span>
      </label>
      <span id="ve-stock-status" style="font-size:10px;color:var(--text-dim)"></span>
      <div style="margin-left:auto;display:flex;align-items:center;gap:8px">
        <span style="font-size:10px;color:var(--text-dim)" title="Shift+click = select range · Ctrl/Cmd+click = toggle · Click = single">⌨ Shift·Ctrl to multi-select</span>
        <button class="action-btn success" id="ve-restock-btn" onclick="veRestockNow()"
          style="font-size:11px;padding:4px 10px" title="Run the restock tick for this vendor right now">⟳ Restock Now</button>
      </div>
    </div>
  </div>`;
}

// ─── Vendor schedule grid ────────────────────────────────────────────────────

const _VS_DAYS = ['mon','tue','wed','thu','fri','sat','sun'];
const _VS_DAY_LABELS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const _vs = { cells: {}, dragging: false, dragValue: null };

function _vsInit(schedule) {
  _vs.cells = {};
  const sched = typeof schedule === 'object' ? schedule : JSON.parse(schedule || '{}');
  for (const [day, blocks] of Object.entries(sched)) {
    if (!Array.isArray(blocks)) continue;
    for (const b of blocks) {
      for (let h = (b.from ?? 0); h < (b.to ?? 24); h++) _vs.cells[`${day}_${h}`] = true;
    }
  }
}

function _vsToSchedule() {
  const out = {};
  for (const day of _VS_DAYS) {
    const hours = Array.from({length:24},(_,h)=>h).filter(h => _vs.cells[`${day}_${h}`]);
    const blocks = [];
    let i = 0;
    while (i < hours.length) {
      const from = hours[i];
      let to = from + 1;
      while (i + 1 < hours.length && hours[i+1] === hours[i]+1) { i++; to++; }
      blocks.push({ from, to });
      i++;
    }
    out[day] = blocks;
  }
  return out;
}

function _vsToggleCell(day, hour, value) {
  const key = `${day}_${hour}`;
  _vs.cells[key] = value;
  const el = document.querySelector(`[data-vs="${key}"]`);
  if (el) el.classList.toggle('vs-on', !!value);
}

function _vsRender() {
  const wrap = document.getElementById('vendor-schedule-grid');
  if (!wrap) return;
  const hourLabels = Array.from({length:24},(_,h) =>
    `<div class="vs-hour-label">${String(h).padStart(2,'0')}</div>`
  ).join('');
  let html = `<div class="vs-grid"><div class="vs-corner"></div><div class="vs-header">${hourLabels}</div>`;
  for (let d = 0; d < _VS_DAYS.length; d++) {
    const day = _VS_DAYS[d];
    html += `<div class="vs-day-label">${_VS_DAY_LABELS[d]}</div>`;
    for (let h = 0; h < 24; h++) {
      const key = `${day}_${h}`;
      html += `<div class="vs-cell${_vs.cells[key]?' vs-on':''}" data-vs="${key}"
        onmousedown="event.preventDefault();_vsDragStart('${day}',${h})"
        onmouseover="_vsDragOver('${day}',${h})"></div>`;
    }
  }
  wrap.innerHTML = html + '</div>';
}

function _vsDragStart(day, hour) {
  _vs.dragging = true;
  _vs.dragValue = !_vs.cells[`${day}_${hour}`];
  _vsToggleCell(day, hour, _vs.dragValue);
  document.addEventListener('mouseup', () => { _vs.dragging = false; }, { once: true });
}

function _vsDragOver(day, hour) {
  if (_vs.dragging) _vsToggleCell(day, hour, _vs.dragValue);
}

// ─── Vendor work zone picker ──────────────────────────────────────────────────

async function openVendorZonePicker() {
  const origClick = window.bigMapTileClick;
  window.bigMapTileClick = async (zoneId) => {
    window.bigMapTileClick = origClick;
    if (typeof closeBigMap === 'function') closeBigMap();
    document.getElementById('f-work-zone-id').value = zoneId;
    const zones = await API('/zones').catch(() => []);
    const zone = Array.isArray(zones) ? zones.find(z => z.id === zoneId) : null;
    const nameEl = document.getElementById('f-work-zone-name');
    if (nameEl) nameEl.textContent = zone?.name || zoneId;
    await npcRefreshSafeStatus();
  };
  if (typeof openBigMap === 'function') openBigMap('normal');
}

async function npcRefreshSafeStatus() {
  const npcId = currentRecord?.id;
  const workZoneId = document.getElementById('f-work-zone-id')?.value;
  const btn = document.getElementById('f-place-safe-btn');
  if (!btn) return;
  if (!npcId || !workZoneId) { btn.disabled = true; return; }
  const result = await API(`/npcs/${npcId}/safe-status`).catch(() => null);
  if (result?.exists) {
    btn.disabled = true;
    btn.textContent = 'Safe placed ✓';
  } else {
    btn.disabled = false;
    const zoneName = document.getElementById('f-work-zone-name')?.textContent || workZoneId;
    btn.textContent = `Place Safe in ${zoneName}`;
  }
}

async function npcPlaceSafe() {
  const npcId = currentRecord?.id;
  if (!npcId) { toast('Save the NPC first before placing a safe.', true); return; }
  const btn = document.getElementById('f-place-safe-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Placing…'; }
  try {
    const result = await API(`/npcs/${npcId}/place-safe`, 'POST');
    if (result?.error) toast(result.error, true);
    else if (result?.already_exists) toast('Safe already exists in this work zone.');
    else toast('Safe placed in work zone.');
    await npcRefreshSafeStatus();
  } catch (e) {
    toast(e.message, true);
    await npcRefreshSafeStatus();
  }
}

// ─── Vendor default dialogue generator ───────────────────────────────────────

function npcGenerateDefaultDialogue(silent) {
  const ta = document.getElementById('f-dialogue_tree');
  if (!ta) return;
  // Flat dialogue format — server reads dialogue_tree.root for the entry node
  const tree = {
    root: { text: "What can I do for you?", options: [
      { label: "Browse your wares.", next: '__shop__' },
      { label: "Nothing, never mind.", next: 'bye' },
    ]},
    bye: { text: "Come back any time.", options: [] },
  };
  ta.value = JSON.stringify(tree, null, 2);
  if (!silent) toast('Default vendor dialogue set. Save to persist.');
}

// ─── NPC edit form ───────────────────────────────────────────────────────────

async function npcEditForm(rec, isNew) {
  const tree = typeof rec.dialogue_tree === 'object' ? rec.dialogue_tree : JSON.parse(rec.dialogue_tree||'{}');
  const behaviourGraph = typeof rec.behaviour_graph === 'object' ? rec.behaviour_graph : JSON.parse(rec.behaviour_graph||'{}');
  const flags = typeof rec.flags === 'object' ? rec.flags : JSON.parse(rec.flags||'{}');
  const chitchat = Array.isArray(rec.chitchat) ? rec.chitchat : JSON.parse(rec.chitchat||'[]');
  const homeActivities = Array.isArray(rec.home_activities) ? rec.home_activities : JSON.parse(rec.home_activities||'[]');
  const npcType = rec.npc_type || 'npc';
  const vendorSchedule = typeof rec.vendor_schedule === 'object' ? rec.vendor_schedule : JSON.parse(rec.vendor_schedule||'{}');
  const workZoneId = rec.work_zone_id || '';
  const vendorBankCredits = rec.vendor_bank_credits || 0;
  const vendorShopName = rec.vendor_shop_name || '';

  const [zones, allItems] = await Promise.all([
    API('/zones').catch(() => []),
    API('/items').catch(() => []),
  ]);
  _veInit(rec, Array.isArray(allItems) ? allItems : []);
  _vsInit(vendorSchedule);

  const zoneList = Array.isArray(zones) ? [...zones].sort((a, b) => (a.id||'').localeCompare(b.id||'')) : [];
  const workZoneName = (workZoneId && zoneList.find(z => z.id === workZoneId)?.name) || workZoneId || '—';
  const homeZoneVal = rec.home_zone || 'zone_residential_lobby';
  const homeZoneOpts = zoneList.map(z => `<option value="${z.id}" ${z.id===homeZoneVal?'selected':''}>${z.id}</option>`).join('');
  const presetOpts = [
    ['', '— load preset —'],
    ['tv_host','📺 TV Host'],['bartender','🍺 Bartender'],['vendor','🛒 Vendor'],
    ['guard','🔒 Guard'],['thug','🔪 Thug'],['doctor','🩺 Doctor'],
    ['politician','🎙 Politician'],['preacher','✝ Preacher'],['vagrant','🚬 Vagrant'],
    ['mercenary','💀 Mercenary'],['scientist','🔬 Scientist'],['cult_member','👁 Cult Member'],
  ].map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

  setTimeout(() => {
    veRenderBuckets();
    _vsRender();
    if (rec.id && workZoneId) npcRefreshSafeStatus();
    // Auto-set default vendor dialogue when type is vendor and dialogue is blank/empty
    if (npcType === 'vendor') {
      const ta = document.getElementById('f-dialogue_tree');
      const val = ta?.value?.trim();
      if (!val || val === '{}') npcGenerateDefaultDialogue(true), toast('Default vendor dialogue set automatically. Save to persist.');
    }
    // Show/hide vendor config on type change; auto-set dialogue when switching to vendor
    document.getElementById('f-npc_type')?.addEventListener('change', function() {
      const isVendor = this.value === 'vendor';
      document.getElementById('vendor-config-section').style.display = isVendor ? '' : 'none';
      if (isVendor) {
        const ta = document.getElementById('f-dialogue_tree');
        const val = ta?.value?.trim();
        if (!val || val === '{}') npcGenerateDefaultDialogue(true), toast('Default vendor dialogue set automatically. Save to persist.');
      }
    });
  }, 0);

  return `
    <div class="field"><label>NPC ID</label><input id="f-id" value="${isNew?'':rec.id}" ${!isNew?'readonly style="opacity:0.5"':''}></div>
    <div class="field"><label>Name</label><input id="f-name" value="${rec.name||''}" ${isNew?'oninput="document.getElementById(\'f-id\').value=this.value.toLowerCase().replace(/\\s+/g,\'_\')"':''}></div>
    <div class="field"><label>Description</label><textarea id="f-description">${rec.description||''}</textarea></div>
    <div class="field-row">
      <div class="field"><label>Zone ID</label><input id="f-zone_id" value="${rec.zone_id||''}"></div>
      <div class="field"><label>Home Zone</label><select id="f-home_zone">${homeZoneOpts}</select></div>
      <div class="field"><label>Faction</label><input id="f-faction" value="${rec.faction||''}"></div>
      <div class="field" style="max-width:100px"><label>Max HP</label><input id="f-hp_max" type="number" min="1" step="1" value="${rec.hp_max||20}"></div>
      <div class="field" style="max-width:110px"><label>NPC Type</label>
        <select id="f-npc_type">
          <option value="npc" ${npcType==='npc'?'selected':''}>NPC</option>
          <option value="vendor" ${npcType==='vendor'?'selected':''}>Vendor</option>
          <option value="unemployed" ${npcType==='unemployed'?'selected':''}>Unemployed</option>
        </select>
      </div>
    </div>
    <div class="field-row" style="align-items:flex-end">
      <div class="field"><label>Personality — drives combat reactions and MIS responses</label>
        <select id="f-personality">
          <option value="">— none —</option>
          ${[['tv_host','📺 TV Host'],['bartender','🍺 Bartender'],['vendor','🛒 Vendor'],['guard','🔒 Guard'],['thug','🔪 Thug'],['doctor','🩺 Doctor'],['politician','🎙 Politician'],['preacher','✝ Preacher'],['vagrant','🚬 Vagrant'],['mercenary','💀 Mercenary'],['scientist','🔬 Scientist'],['cult_member','👁 Cult Member']].map(([v,l])=>`<option value="${v}" ${flags.personality===v?'selected':''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="field" style="max-width:160px"><label><input type="checkbox" id="f-mis_willing" ${flags.mis_willing===true?'checked':''}> MIS willing — allows MIS actions</label></div>
    </div>
    <div class="checkbox-field"><input type="checkbox" id="f-wanders" ${rec.wanders?'checked':''} onchange="document.getElementById('f-wander_zones-wrap').style.display=this.checked?'':'none'"><label>Wanders between zones</label></div>
    <div class="field" id="f-wander_zones-wrap" style="${rec.wanders?'':'display:none'}">
      <label>Permitted Wander Zones (one zone ID per line)</label>
      <textarea id="f-wander_zones" rows="4" placeholder="Leave blank to wander to adjacent zones only">${(Array.isArray(rec.wander_zones)?rec.wander_zones:JSON.parse(rec.wander_zones||'[]')).join('\n')}</textarea>
      <div class="zone-subsection-note">Current zone is always included at runtime.</div>
    </div>
    <div class="field">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <label>Chitchat Lines <span style="font-weight:400;color:var(--text-dim);font-size:11px">— one per line, spoken at random during idle</span></label>
        <div style="display:flex;gap:6px;align-items:center">
          <select id="f-chitchat-preset" class="form-input" style="font-size:11px;padding:3px 6px">${presetOpts}</select>
          <button type="button" class="action-btn" style="font-size:11px;padding:3px 8px" onclick="npcLoadChitchatPreset()">Load</button>
        </div>
      </div>
      <textarea id="f-chitchat" rows="6" placeholder="She took everything, man.\nYou want another?">${chitchat.join('\n')}</textarea>
    </div>
    <div class="field">
      <label>Home Activities <span style="font-weight:400;color:var(--text-dim);font-size:11px">— one per line; quoted text = says, unquoted = emote</span></label>
      <textarea id="f-home_activities" rows="5" placeholder='"I could use a drink."\nstares blankly at the wall\n"Another day, another credit."'>${homeActivities.join('\n')}</textarea>
    </div>
    <div class="field">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <label>Dialogue Tree (JSON)</label>
        <div style="display:flex;gap:6px">
          <button type="button" class="action-btn" onclick="npcOpenVine()">🌿 Visual Editor</button>
        </div>
      </div>
      <textarea id="f-dialogue_tree" rows="10">${JSON.stringify(tree, null, 2)}</textarea>
    </div>
    <div class="field">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <label style="margin:0">Vendor Shop</label>
        <span style="font-size:10px;color:var(--text-dim)">Catalogue = full list · Active shelf = auto-managed subset</span>
      </div>
      ${_veEditorHtml(rec)}
    </div>

    <!-- ── Vendor Config (visible when npc_type=vendor) ─────────────────── -->
    <div id="vendor-config-section" style="${npcType==='vendor'?'':'display:none'}">
      <div style="border-top:1px solid var(--border);margin:16px 0 12px;padding-top:12px">
        <div style="font-size:12px;font-weight:600;color:var(--accent);letter-spacing:0.05em;margin-bottom:12px">VENDOR CONFIG</div>

        <div class="field">
          <label>Shop Name</label>
          <input id="f-vendor_shop_name" type="text" value="${vendorShopName}" placeholder="e.g. Neon Dreams Surplus">
        </div>

        <div class="field">
          <label>Work Schedule <span style="font-weight:400;color:var(--text-dim);font-size:11px">— click or drag to toggle hours</span></label>
          <div id="vendor-schedule-grid" style="overflow-x:auto;margin-top:6px"></div>
        </div>

        <div class="field">
          <label>Work Zone</label>
          <div style="display:flex;gap:8px;align-items:center;margin-top:4px">
            <input type="hidden" id="f-work-zone-id" value="${workZoneId}">
            <span id="f-work-zone-name" style="color:var(--text);min-width:120px">${workZoneName}</span>
            <button type="button" class="action-btn" onclick="openVendorZonePicker()">Pick on Map</button>
            ${workZoneId ? `<span style="font-size:11px;color:var(--text-dim)">${workZoneId}</span>` : ''}
          </div>
        </div>

        <div class="field">
          <label>Vendor Safe</label>
          <div style="display:flex;gap:8px;align-items:center;margin-top:4px">
            <button type="button" class="action-btn" id="f-place-safe-btn" onclick="npcPlaceSafe()"
              ${!rec.id || !workZoneId ? 'disabled' : ''}>
              Place Safe in ${workZoneName}
            </button>
            <span style="font-size:11px;color:var(--text-dim)">Places a hackable vendor safe linked to this NPC in the work zone</span>
          </div>
        </div>

        <div class="field">
          <label>Bank Balance</label>
          <div style="margin-top:4px;font-size:13px;color:var(--accent2)">${vendorBankCredits.toLocaleString()}c <span style="font-size:11px;color:var(--text-dim)">— deposited earnings (read-only)</span></div>
        </div>
      </div>
    </div>

    <div class="field">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <label>AI Behaviour Graph (JSON) — overrides random wander when set</label>
        <button type="button" class="action-btn" onclick="npcOpenVineAI()">🌿 AI Behaviour</button>
      </div>
      <textarea id="f-behaviour_graph" rows="6">${JSON.stringify(behaviourGraph, null, 2)}</textarea>
    </div>
    <div class="field"><label>Flags (JSON) — e.g. gender, first_strike_delay_ms, battle_cries</label><textarea id="f-flags" rows="3">${JSON.stringify(flags, null, 2)}</textarea></div>
  `;
}

async function saveNpc(existing) {
  const isNew = !existing?.id;
  let tree, behaviour_graph;
  try { tree = JSON.parse(document.getElementById('f-dialogue_tree').value); } catch { return { error: 'Dialogue tree: invalid JSON' }; }
  const vendor = _ve.catalogue.filter(e => e?.item_id);
  try { behaviour_graph = JSON.parse(document.getElementById('f-behaviour_graph')?.value || '{}'); } catch { return { error: 'Behaviour graph: invalid JSON' }; }
  let flags;
  try { flags = JSON.parse(document.getElementById('f-flags')?.value || '{}'); } catch { return { error: 'Flags: invalid JSON' }; }
  const personality = document.getElementById('f-personality')?.value || '';
  if (personality) flags.personality = personality; else delete flags.personality;
  const misWillingEl = document.getElementById('f-mis_willing');
  if (misWillingEl) flags.mis_willing = misWillingEl.checked; else delete flags.mis_willing;
  const wanderZonesRaw = document.getElementById('f-wander_zones')?.value || '';
  const wander_zones = wanderZonesRaw.split('\n').map(s => s.trim()).filter(Boolean);
  const chitchat = (document.getElementById('f-chitchat')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
  const home_activities = (document.getElementById('f-home_activities')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
  const body = {
    name: document.getElementById('f-name').value,
    description: document.getElementById('f-description').value,
    zone_id: document.getElementById('f-zone_id').value || null,
    home_zone: document.getElementById('f-home_zone').value || null,
    faction: document.getElementById('f-faction').value || null,
    wanders: document.getElementById('f-wanders').checked,
    wander_zones,
    chitchat,
    hp_max: parseInt(document.getElementById('f-hp_max')?.value) || 20,
    dialogue_tree: tree,
    vendor_inventory: vendor,
    vendor_stock_size: parseInt(document.getElementById('f-vendor_stock_size')?.value) || 10,
    vendor_restock_rate: parseInt(document.getElementById('f-vendor_restock_rate')?.value) || 1,
    behaviour_graph,
    flags,
    npc_type: document.getElementById('f-npc_type')?.value || 'npc',
    vendor_schedule: _vsToSchedule(),
    vendor_shop_name: document.getElementById('f-vendor_shop_name')?.value || null,
    home_activities,
    work_zone_id: document.getElementById('f-work-zone-id')?.value || null,
  };
  if (isNew) { body.id = document.getElementById('f-id').value.trim(); return API('/npcs', 'POST', body); }
  return API(`/npcs/${existing.id}`, 'PUT', body);
}

function npcOpenVine() {
  let tree;
  try { tree = JSON.parse(document.getElementById('f-dialogue_tree').value || '{}'); }
  catch { toast('Dialogue tree: invalid JSON — fix it before opening the visual editor.', true); return; }
  const graphData = VineDialogueSchema.fromDialogueTree(tree);
  vineModalOpen(
    `Dialogue: ${currentRecord?.name || 'NPC'}`,
    VineDialogueSchema,
    graphData,
    (savedGraph) => {
      const treeOut = VineDialogueSchema.toDialogueTree(savedGraph);
      document.getElementById('f-dialogue_tree').value = JSON.stringify(treeOut, null, 2);
      toast('Dialogue saved to form — click Save to persist.');
    }
  );
}

function npcOpenVineAI() {
  let graph;
  try { graph = JSON.parse(document.getElementById('f-behaviour_graph').value || '{}'); }
  catch { toast('Behaviour graph: invalid JSON — fix it before opening the visual editor.', true); return; }
  const graphData = VineAISchema.fromAiGraph(graph);
  vineModalOpen(
    `AI Behaviour: ${currentRecord?.name || 'NPC'}`,
    VineAISchema,
    graphData,
    (savedGraph) => {
      const out = VineAISchema.toAiGraph(savedGraph);
      document.getElementById('f-behaviour_graph').value = JSON.stringify(out, null, 2);
      toast('Behaviour graph saved to form — click Save to persist.');
    }
  );
}

// --- Furniture panel (grouped by zone) ---

