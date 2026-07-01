function itemTagWidget(name, value) {
  const def = TAG_CATALOG[name];
  switch (def.shape) {
    case 'flag': return '';
    case 'int': return `<input type="number" class="tag-input" value="${value ?? 0}">`;
    case 'enum': return `<select class="tag-input">${def.options.map(o=>`<option ${value===o?'selected':''}>${o}</option>`).join('')}</select>`;
    case 'range': { const v = value||{}; return `<div class="field-row"><input type="number" class="tag-input" data-k="min" placeholder="min" value="${v.min??0}"><input type="number" class="tag-input" data-k="max" placeholder="max" value="${v.max??0}"></div>`; }
    case 'hot': { const v = value||{}; return `<div class="field-row"><input type="number" class="tag-input" data-k="amount" placeholder="amount" value="${v.amount??0}"><input type="number" class="tag-input" data-k="duration_seconds" placeholder="duration (s)" value="${v.duration_seconds??0}"></div>`; }
    default: return `<textarea class="tag-input" rows="2">${typeof value==='string'?value:JSON.stringify(value||{})}</textarea>`; // statmap/text
  }
}

function itemTagRow(name, value) {
  const def = TAG_CATALOG[name];
  return `<div class="field tag-row" data-tag="${name}">
    <label>${def.label}<button type="button" onclick="removeItemTag(this)" style="float:right;background:none;border:none;color:inherit;cursor:pointer;font-size:15px;line-height:1">×</button></label>
    ${itemTagWidget(name, value)}
    <div class="zone-subsection-note">${def.help}</div>
  </div>`;
}

function itemAddTagPicker(presentNames) {
  const groups = {};
  for (const [name, def] of Object.entries(TAG_CATALOG)) {
    if (!tagAppliesTo(def, 'item') || name === 'description' || presentNames.includes(name)) continue;
    (groups[def.group] = groups[def.group] || []).push([name, def]);
  }
  const optgroups = Object.entries(groups).map(([g, list]) =>
    `<optgroup label="${g}">${list.map(([n, d])=>`<option value="${n}">${d.label}</option>`).join('')}</optgroup>`).join('');
  return `<div class="field-row" style="align-items:flex-end">
    <div class="field"><label>Add tag</label><select id="item-add-tag">${optgroups}</select></div>
    <button type="button" class="action-btn" onclick="addItemTag()">Add</button>
  </div>`;
}

function itemTagChips(present) {
  if (!present.length) return '<span style="color:var(--text-dim);font-size:11px">No tags attached.</span>';
  return present.map(n => {
    const def = TAG_CATALOG[n];
    const label = def ? def.label : n;
    return `<span onclick="removeItemTagByName('${n}')" style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:12px;background:var(--bg-alt,rgba(255,255,255,0.08));border:1px solid var(--border,rgba(255,255,255,0.15));font-size:11px;cursor:pointer;user-select:none" title="Click to remove">${label} <span style="opacity:0.6">×</span></span>`;
  }).join('');
}

function refreshItemTagChips() {
  const el = document.getElementById('item-tag-chips');
  if (!el) return;
  const present = [...document.querySelectorAll('#item-tags .tag-row')].map(r => r.dataset.tag);
  el.innerHTML = itemTagChips(present);
}

function refreshItemTagPicker() {
  const present = [...document.querySelectorAll('#item-tags .tag-row')].map(r => r.dataset.tag);
  document.getElementById('item-add-tag-picker').innerHTML = itemAddTagPicker(present);
  refreshItemTagChips();
}

function addItemTag() {
  const name = document.getElementById('item-add-tag').value;
  if (!name) return;
  const def = TAG_CATALOG[name];
  const defaults = { flag:true, int:0, enum:def.options?.[0], range:{min:0,max:0}, hot:{amount:0,duration_seconds:0}, statmap:{}, text:'' };
  document.getElementById('item-tags').insertAdjacentHTML('beforeend', itemTagRow(name, defaults[def.shape]));
  refreshItemTagPicker();
}

function removeItemTag(btn) {
  btn.closest('.tag-row').remove();
  refreshItemTagPicker();
}

function removeItemTagByName(name) {
  const row = document.querySelector(`#item-tags .tag-row[data-tag="${name}"]`);
  if (row) { row.remove(); refreshItemTagPicker(); }
}

function readItemTag(rowEl) {
  const def = TAG_CATALOG[rowEl.dataset.tag];
  const inputs = [...rowEl.querySelectorAll('.tag-input')];
  switch (def.shape) {
    case 'flag': return true;
    case 'int': return +inputs[0].value || 0;
    case 'enum': return inputs[0].value;
    case 'range': case 'hot': { const o = {}; inputs.forEach(i => o[i.dataset.k] = +i.value || 0); return o; }
    default: { try { return JSON.parse(inputs[0].value); } catch { throw new Error(`${def.label}: invalid JSON`); } } // statmap/text
  }
}

function filterItems(q) {
  if (!q) { renderItemsPanel(); return; }
  const filtered = allRecords.filter(r =>
    Object.values(r).some(v => String(v).toLowerCase().includes(q))
  );
  renderItemsPanel(filtered);
}

function renderItemsPanel(records = allRecords) {
  const panel = document.getElementById('list-panel');
  if (!records.length) {
    panel.innerHTML = '<div style="padding:24px;color:var(--text-dim)">No items found.</div>';
    return;
  }

  const cols = [
    { key: 'name', label: 'Name', width: '35%' },
    { key: 'rarity', label: 'Rarity', width: '15%' },
    { key: 'weight', label: 'Weight (g)', width: '10%' },
    { key: 'value', label: 'Value', width: '10%' },
  ];

  const byType = new Map();
  for (const r of records) {
    const t = r.type || '(none)';
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t).push(r);
  }

  let html = '';
  for (const [type, items] of [...byType.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const collapsed = collapsedItemTypes.has(type);
    const typeSafe = type.replace(/'/g, "\\'");
    html += `<div class="item-section">
      <div class="item-type-hdr" onclick="toggleItemTypeCollapse('${typeSafe}')">
        <span class="item-type-hdr-arrow">${collapsed ? '▶' : '▼'}</span>
        <span class="item-type-hdr-label">${type}</span>
        <span class="item-type-hdr-count">${items.length}</span>
      </div>`;
    if (!collapsed) {
      html += '<table style="table-layout:fixed"><thead><tr>';
      for (const col of cols) html += `<th style="width:${col.width}">${col.label}</th>`;
      html += '<th style="width:10%"></th></tr></thead><tbody>';
      for (const rec of [...items].sort((a, b) => (a.name || '').localeCompare(b.name || ''))) {
        const idSafe = rec.id.replace(/'/g, "\\'");
        html += `<tr onclick="selectRecord('${idSafe}')">`;
        for (const col of cols) {
          const val = col.key === 'name' ? `${rec.name ?? '—'} <span style="color:var(--text-dim);font-size:10px">(${rec.id})</span>` : (rec[col.key] ?? '—');
          html += `<td>${val}</td>`;
        }
        html += `<td><button class="action-btn" onclick="event.stopPropagation();editRecord('${idSafe}')">Edit</button></td></tr>`;
      }
      html += '</tbody></table>';
    }
    html += '</div>';
  }
  panel.innerHTML = html;
}

// An item with supertags stores its flattened effective tags plus bookkeeping
// keys (__own = its own authored tags, __super = applied supertag keys). The
// editor only ever edits __own; supertag members are shown as inherited chips.
function itemOwnTags(tags) {
  if (tags && typeof tags.__own === 'object') return { ...tags.__own };
  const own = { ...(tags || {}) };
  delete own.__own; delete own.__super;
  return own;
}
function itemSuperKeys(tags) {
  return Array.isArray(tags?.__super) ? tags.__super.slice() : [];
}

function itemSupertagPicker(presentKeys) {
  const reg = window.TAG_SUPERTAGS || {};
  const opts = Object.keys(reg).sort().filter(k => !presentKeys.includes(k))
    .map(k => `<option value="${k}">${reg[k].label || k}</option>`).join('');
  return `<div class="field-row" style="align-items:flex-end">
    <div class="field"><label>Apply supertag</label><select id="item-add-super">${opts || '<option value="">— none defined —</option>'}</select></div>
    <button type="button" class="action-btn" onclick="applyItemSupertag()">Apply</button>
  </div>`;
}

function itemSupertagChip(key) {
  const reg = window.TAG_SUPERTAGS || {};
  const s = reg[key] || {};
  const members = Object.keys(s.members || {}).map(m => `<code style="font-size:10px">${m}</code>`).join(' ');
  return `<div class="field tag-row" data-super="${key}" style="background:var(--bg-alt,rgba(255,255,255,0.03));padding:6px 8px;border-radius:4px">
    <label>${s.label || key} <span style="color:var(--text-dim);font-weight:normal;font-size:11px">(supertag)</span><button type="button" onclick="removeItemSupertag(this)" style="float:right;background:none;border:none;color:inherit;cursor:pointer;font-size:15px;line-height:1">×</button></label>
    <div class="zone-subsection-note">Inherits: ${members || '(no member tags)'}. Your own tags below override these.</div>
  </div>`;
}

function refreshItemSupertagPicker() {
  const present = [...document.querySelectorAll('#item-supertags .tag-row')].map(r => r.dataset.super);
  document.getElementById('item-supertag-picker').innerHTML = itemSupertagPicker(present);
}

function applyItemSupertag() {
  const key = document.getElementById('item-add-super')?.value;
  if (!key) return;
  document.getElementById('item-supertags').insertAdjacentHTML('beforeend', itemSupertagChip(key));
  refreshItemSupertagPicker();
}

function removeItemSupertag(btn) {
  btn.closest('.tag-row').remove();
  refreshItemSupertagPicker();
}

function itemEditForm(rec, isNew) {
  const rawTags = (rec.tags && typeof rec.tags === 'object') ? rec.tags : JSON.parse(rec.tags||'{}');
  const tags = itemOwnTags(rawTags);
  const superApplied = itemSuperKeys(rawTags);
  const tagNames = Object.keys(tags).filter(n => n !== 'description' && TAG_CATALOG[n]);
  return `
    <div class="field"><label>Item ID</label><input id="f-id" value="${isNew?'':rec.id}" ${!isNew?'readonly style="opacity:0.5"':''}></div>
    <div class="field"><label>Name</label><input id="f-name" value="${rec.name||''}"></div>
    <div class="field-row">
      <div class="field"><label>Category</label>
        <select id="f-type">${['clothing','armor','weapon','consumable','drug','key','misc','ammo','tool','implant'].map(t=>`<option value="${t}" ${rec.type===t?'selected':''}>${t}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Rarity</label>
        <select id="f-rarity">${['common','uncommon','rare','very_rare','legendary'].map(r=>`<option ${rec.rarity===r?'selected':''}>${r}</option>`).join('')}</select>
      </div>
    </div>
    <div class="field-row">
      <div class="field"><label>Weight (g)</label><input type="number" id="f-weight" value="${rec.weight||1000}" step="1"></div>
      <div class="field"><label>Value</label><input type="number" id="f-value" value="${rec.value||0}"></div>
    </div>
    <div class="field"><label>Description</label><textarea id="f-description" rows="3">${tags.description||''}</textarea></div>
    <div id="item-supertags">${superApplied.map(k => itemSupertagChip(k)).join('')}</div>
    <div id="item-supertag-picker">${itemSupertagPicker(superApplied)}</div>
    <div id="item-tags">${tagNames.map(n => itemTagRow(n, tags[n])).join('')}</div>
    <div id="item-add-tag-picker">${itemAddTagPicker(tagNames)}</div>
    <div class="field" style="margin-top:8px">
      <label style="font-size:11px;opacity:0.6;text-transform:uppercase;letter-spacing:0.05em">Attached Tags</label>
      <div id="item-tag-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">${itemTagChips(tagNames)}</div>
    </div>
  `;
}

async function saveItem(existing) {
  const isNew = !existing?.id;
  const tags = {};
  const desc = document.getElementById('f-description').value;
  if (desc) tags.description = desc;
  try {
    for (const row of document.querySelectorAll('#item-tags .tag-row')) tags[row.dataset.tag] = readItemTag(row);
  } catch (e) { return { error: e.message }; }
  const supertags = [...document.querySelectorAll('#item-supertags .tag-row')].map(r => r.dataset.super);
  const body = {
    name: document.getElementById('f-name').value,
    type: document.getElementById('f-type').value,
    rarity: document.getElementById('f-rarity').value,
    weight: parseInt(document.getElementById('f-weight').value)||1000,
    value: +document.getElementById('f-value').value,
    tags,
    supertags,
  };
  if (isNew) { body.id = document.getElementById('f-id').value.trim(); return API('/items', 'POST', body); }
  return API(`/items/${existing.id}`, 'PUT', body);
}

// --- NPC forms ---
