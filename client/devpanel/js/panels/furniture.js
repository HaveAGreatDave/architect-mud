function furnitureItemRow(f, paddingLeft = '28px') {
  const lightBadge = f.is_light
    ? `<span style="font-size:10px;background:var(--bg3);padding:1px 5px;border-radius:2px;margin-left:6px;color:${f.light_on ? 'var(--yellow)' : 'var(--text-dim)'}">💡${f.light_type||''}</span>`
    : '';
  const stagedBadge = f._markedForDeletion
    ? `<span style="font-size:10px;background:rgba(255,59,92,0.12);border:1px solid var(--red);color:var(--red);padding:1px 6px;border-radius:2px;margin-left:6px;letter-spacing:0.5px">✕ Marked for Deletion</span>`
    : f._staged
      ? `<span style="font-size:10px;background:rgba(245,230,66,0.12);border:1px solid var(--yellow);color:var(--yellow);padding:1px 6px;border-radius:2px;margin-left:6px;letter-spacing:0.5px">! Not Published</span>`
      : _furniturePublishedNames.has(f.name)
        ? `<span style="font-size:10px;background:rgba(57,255,143,0.12);border:1px solid var(--accent2);color:var(--accent2);padding:1px 6px;border-radius:2px;margin-left:6px;letter-spacing:0.5px">✓ Published</span>`
        : '';
  const nameColor = f._markedForDeletion ? 'var(--red)' : f._staged ? 'var(--yellow)' : _furniturePublishedNames.has(f.name) ? 'var(--accent2)' : 'var(--text-bright)';
  return `<div style="display:flex;align-items:center;gap:8px;padding:5px 12px 5px ${paddingLeft};border-bottom:1px solid var(--border);background:var(--bg1);cursor:pointer" onclick="editRecord('${f.id}')">
    <div style="flex:1;min-width:0">
      <span style="color:${nameColor}">${f.name}</span>${lightBadge}${stagedBadge}
      ${f.description ? `<div style="font-size:11px;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:500px">${f.description}</div>` : ''}
    </div>
    <button class="action-btn" style="font-size:10px;padding:2px 8px" onclick="event.stopPropagation();editRecord('${f.id}')">Edit</button>
    <button class="action-btn danger" style="font-size:10px;padding:2px 8px" data-fid="${f.id}" data-fname="${f.name.replace(/"/g,'&quot;')}" onclick="event.stopPropagation();deleteFurnitureStaged(this.dataset.fid,this.dataset.fname)">Del</button>
  </div>`;
}

// Module-level cache so room/add modals can reference fresh data without
// re-fetching the whole panel.
let _furnitureAllItems = [];
let _furnitureZoneNames = new Map();
const _furnitureExpandedZones = new Set();
let _furnitureLastClickedZone = null;
const _furniturePublishedNames = new Set(); // names briefly shown as green after publish

function renderFurniturePanel(data) {
  const furniture = data.furniture || [];
  const zones = data.zones || [];
  allRecords = furniture;
  _furnitureAllItems = furniture;
  _furnitureZoneNames = new Map(zones.map(z => [z.id, z.name]));

  // Build interior-to-building mapping from zone exits.
  // A building zone's exits may include interior zone ids.
  const _zoneById = new Map(zones.map(z => [z.id, z]));
  const _interiorParent = new Map(); // interiorZoneId -> buildingZoneId
  for (const z of zones) {
    if (z.flags?.is_building && z.exits) {
      for (const exitZoneId of flatNeighbors(z.exits)) {
        const exitZone = _zoneById.get(exitZoneId);
        if (exitZone?.flags?.is_interior) _interiorParent.set(exitZoneId, z.id);
      }
    }
  }

  const panel = document.getElementById('list-panel');

  const byZone = new Map();
  // Seed every zone so empty rooms appear
  for (const z of zones) byZone.set(z.id, []);
  for (const f of furniture) {
    const key = f.zone_id || '__unplaced__';
    if (!byZone.has(key)) byZone.set(key, []);
    byZone.get(key).push(f);
  }

  // Also include building zones as parents even if they have no furniture themselves
  for (const [intId, bldId] of _interiorParent) {
    if (byZone.has(intId) && !byZone.has(bldId)) byZone.set(bldId, []);
  }

  // Zones that are interior rooms and belong to a building — rendered as children
  const _childZones = new Set(_interiorParent.keys());

  const zoneKeys = [...byZone.keys()].sort((a, b) => {
    if (a === '__unplaced__') return 1;
    if (b === '__unplaced__') return -1;
    return (_furnitureZoneNames.get(a) || a).localeCompare(_furnitureZoneNames.get(b) || b);
  }).filter(zid => !_childZones.has(zid)); // child zones rendered inline under parent

  const sections = zoneKeys.map(zoneId => {
    const items = byZone.get(zoneId) || [];
    const isUnplaced = zoneId === '__unplaced__';
    const zoneName = isUnplaced ? 'Unplaced' : (_furnitureZoneNames.get(zoneId) || zoneId);
    const zone = _zoneById.get(zoneId);
    const isBuilding = zone?.flags?.is_building;

    // Collect child interior rooms for this building
    const childSections = isBuilding ? [..._interiorParent.entries()]
      .filter(([, bldId]) => bldId === zoneId)
      .map(([intId]) => {
        const intItems = byZone.get(intId) || [];
        if (!intItems.length) return '';
        const intName = _furnitureZoneNames.get(intId) || intId;
        const intRows = intItems.map(f => furnitureItemRow(f, '42px')).join('');
        return `<div>
          <div data-zone-id="${intId}" style="display:flex;align-items:center;gap:0;padding:5px 12px 5px 28px;background:var(--bg2);border-top:1px solid var(--border);cursor:pointer;user-select:none" onclick="fToggle(this)">
            <span class="f-arrow" style="color:var(--text-dim);font-size:11px;width:14px;display:inline-block;flex-shrink:0">▸</span>
            <span style="color:var(--accent);font-size:12px">↳ ${intName}</span>
            <span style="margin-left:auto;font-size:10px;color:var(--text-dim)">${intItems.length} item${intItems.length!==1?'s':''}</span>
            <button class="action-btn" style="font-size:10px;padding:2px 8px;margin-left:4px" onclick="event.stopPropagation();openFurnitureAddModal('${intId}')">Clone</button>
            <button class="action-btn" style="font-size:10px;padding:2px 8px;margin-left:4px" onclick="event.stopPropagation();openFurnitureRoomModal('${intId}')">View Room</button>
          </div>
          <div class="f-children" style="display:none">${intRows}</div>
        </div>`;
      }).join('')
    : '';


    const headerLabel = isUnplaced
      ? `<span style="color:var(--text-dim);font-style:italic">Unplaced</span>`
      : `<span style="color:var(--cyan);font-weight:700;font-size:13px">${zoneName}</span>
         <span style="color:var(--text-dim);font-size:10px;margin-left:4px">${zoneId}</span>`;

    const rows = items.map(f => furnitureItemRow(f, '28px')).join('');

    const addBtn = !isUnplaced
      ? `<button class="action-btn" style="font-size:10px;padding:2px 8px;margin-left:8px" onclick="event.stopPropagation();openFurnitureAddModal('${zoneId}')">Clone</button>`
      : '';

    return `<div>
      <div data-zone-id="${zoneId}" style="display:flex;align-items:center;gap:0;padding:7px 12px;background:var(--bg3);border-top:2px solid var(--border);border-bottom:1px solid var(--border);cursor:pointer;user-select:none"
           onclick="fToggle(this)">
        <span class="f-arrow" style="color:var(--text-dim);font-size:11px;width:14px;display:inline-block;flex-shrink:0">▸</span>
        ${headerLabel}
        <span style="margin-left:auto;font-size:10px;color:var(--text-dim);flex-shrink:0">${items.length} item${items.length!==1?'s':''}</span>
        ${addBtn}
        ${!isUnplaced ? `<button class="action-btn" style="font-size:10px;padding:2px 8px;margin-left:4px" onclick="event.stopPropagation();openFurnitureRoomModal('${zoneId}')">View Room</button>` : ''}
      </div>
      <div class="f-children" style="display:none">${rows}${childSections}</div>
    </div>`;
  }).join('');

  const streetlightsToolbar = `<div class="panel-sticky-head" style="padding:8px 12px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px">
    <button class="action-btn" onclick="bulkAddStreetlights()" title="Add a Street Light to every outdoor city zone that doesn't have one yet">🔦 Add Street Lights to All City Tiles</button>
    <span id="streetlights-result" style="font-size:11px;color:var(--text-dim)"></span>
  </div>`;
  panel.innerHTML = streetlightsToolbar + (furniture.length
    ? sections
    : '<div style="padding:24px;color:var(--text-dim)">No furniture found.</div>');

  for (const zid of _furnitureExpandedZones) {
    const header = panel.querySelector(`[data-zone-id="${zid}"]`);
    if (header) {
      header.nextElementSibling.style.display = 'block';
      header.querySelector('.f-arrow').textContent = '▾';
    }
  }
}

async function bulkAddStreetlights() {
  const btn = document.querySelector('button[onclick="bulkAddStreetlights()"]');
  const result_el = document.getElementById('streetlights-result');
  if (btn) { btn.disabled = true; btn.textContent = 'Working...'; }
  const result = await API('/furniture/bulk/streetlights', 'POST');
  if (btn) { btn.disabled = false; btn.textContent = '🔦 Add Street Lights to All City Tiles'; }
  if (result?.error) {
    toast(result.error, true);
    if (result_el) result_el.textContent = result.error;
  } else {
    toast(result.message || `Added street lights to ${result.added} zones`);
    if (result_el) result_el.textContent = result.message || `Done — ${result.added} added`;
    await updateStagingBadge();
    await loadPanel('furniture');
  }
}

function fToggle(header) {
  const children = header.nextElementSibling;
  const arrow = header.querySelector('.f-arrow');
  const open = children.style.display !== 'none';
  children.style.display = open ? 'none' : 'block';
  arrow.textContent = open ? '▸' : '▾';
  const zid = header.dataset.zoneId;
  if (zid) {
    if (open) _furnitureExpandedZones.delete(zid);
    else _furnitureExpandedZones.add(zid);
    if (zid !== '__unplaced__') _furnitureLastClickedZone = zid;
  }
}

function openFurnitureAddModal(zoneId) {
  const zoneName = _furnitureZoneNames.get(zoneId) || zoneId;

  // Deduplicate furniture by name to show unique types
  const seen = new Set();
  const types = _furnitureAllItems
    .sort((a,b) => a.name.localeCompare(b.name))
    .filter(f => { if (seen.has(f.name)) return false; seen.add(f.name); return true; });

  const opts = types.map(f =>
    `<option value="${f.id}">${f.name}</option>`
  ).join('');

  document.getElementById('modal-title').textContent = `Add furniture to: ${zoneName}`;
  document.getElementById('modal-body').innerHTML = opts
    ? `<div class="field"><label>Furniture type to clone here</label>
        <select id="fam-pick" style="width:100%">${opts}</select></div>
       <div style="font-size:11px;color:var(--text-dim);margin-top:4px">Creates a new copy of the selected furniture type in this room.</div>`
    : `<div style="color:var(--text-dim);padding:8px 0">No furniture types exist yet. Create one first via the furniture panel.</div>`;

  document.getElementById('modal-save').style.display = opts ? '' : 'none';
  document.getElementById('modal-save').onclick = async () => {
    const id = document.getElementById('fam-pick')?.value;
    if (!id) return;
    const template = _furnitureAllItems.find(f => f.id === id);
    if (!template) return;
    const r = await API('/furniture', 'POST', {
      zone_id: zoneId,
      name: template.name,
      description: template.description || '',
      flags: template.flags || {},
      object_type: template.object_type || 'furniture',
      light_type: template.light_type || null,
      light_on: 0,
      power_draw_kw: template.power_draw_kw ?? null,
    });
    if (r?.error) { toast(r.error, true); return; }
    toast('Furniture added to room');
    closeModal();
    const newId = r.id || r.entityId || `furniture_${Date.now()}`;
    _furnitureAllItems.push({ id: newId, zone_id: zoneId, name: template.name, description: template.description || '', flags: template.flags || {}, object_type: template.object_type || 'furniture', light_on: 0, light_type: template.light_type || null, power_draw_kw: template.power_draw_kw ?? null, _staged: true });
    _furnitureExpandedZones.add(zoneId);
    renderFurniturePanel({ furniture: _furnitureAllItems, zones: [..._furnitureZoneNames.entries()].map(([zid, zname]) => ({ id: zid, name: zname })) });
    updateStagingBadge();
  };
  document.getElementById('generic-modal').style.display = 'flex';
}

function openFurnitureRoomModal(zoneId) {
  const zoneName = _furnitureZoneNames.get(zoneId) || zoneId;
  const items = _furnitureAllItems.filter(f => f.zone_id === zoneId);
  const available = _furnitureAllItems.filter(f => f.zone_id !== zoneId);

  const lightBadge = f => f.is_light
    ? ` <span style="font-size:10px;color:${f.light_on?'var(--yellow)':'var(--text-dim)'}">💡${f.light_type||''}</span>`
    : '';

  const tableRows = items.map(f => `<tr style="cursor:pointer" onclick="closeModal();editRecord('${f.id}')">
    <td style="color:var(--text-bright);font-weight:600">${f.name}${lightBadge(f)}</td>
    <td style="color:var(--text-dim);font-size:11px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.description||''}</td>
    <td style="text-align:right;white-space:nowrap">
      <button class="action-btn" style="font-size:10px;padding:2px 6px" onclick="event.stopPropagation();closeModal();editRecord('${f.id}')">Edit</button>
      <button class="action-btn danger" style="font-size:10px;padding:2px 6px;margin-left:2px" onclick="event.stopPropagation();closeModal();deleteFurnitureStaged('${f.id}','${f.name.replace(/'/g,"\\'")}')">Del</button>
    </td>
  </tr>`).join('');

  const addOpts = available.sort((a,b)=>a.name.localeCompare(b.name)).map(f => {
    const cur = f.zone_id ? (_furnitureZoneNames.get(f.zone_id)||f.zone_id) : 'unplaced';
    return `<option value="${f.id}">${f.name} (${cur})</option>`;
  }).join('');

  document.getElementById('modal-title').textContent = zoneName;
  document.getElementById('modal-body').innerHTML = `
    ${items.length ? `
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
      <thead><tr>
        <th style="text-align:left;padding:4px 6px;color:var(--text-dim);font-size:11px">Name</th>
        <th style="text-align:left;padding:4px 6px;color:var(--text-dim);font-size:11px">Description</th>
        <th></th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>` : `<div style="color:var(--text-dim);font-style:italic;margin-bottom:16px;font-size:12px">No furniture in this room.</div>`}
    <div style="border-top:1px solid var(--border);padding-top:12px">
      <div style="font-size:12px;font-weight:600;color:var(--accent);margin-bottom:8px">Move furniture here</div>
      ${addOpts
        ? `<div class="field"><label>Select furniture to move here</label>
           <select id="frm-pick" style="width:100%">${addOpts}</select></div>`
        : `<div style="color:var(--text-dim);font-size:11px">No other furniture to move.</div>`}
    </div>`;

  document.getElementById('modal-save').style.display = addOpts ? '' : 'none';
  document.getElementById('modal-save').textContent = 'Move here';
  document.getElementById('modal-save').onclick = async () => {
    const id = document.getElementById('frm-pick')?.value;
    if (!id) return;
    const r = await API(`/furniture/${id}`, 'PUT', { zone_id: zoneId });
    if (r?.error) { toast(r.error, true); return; }
    toast('Furniture moved to room');
    closeModal();
    loadPanel('furniture');
  };
  document.getElementById('generic-modal').style.display = 'flex';
}


function furnitureEditForm(rec, isNew) {
  const zoneOptions = [..._furnitureZoneNames.entries()]
    .sort((a,b) => a[1].localeCompare(b[1]))
    .map(([id, name]) => `<option value="${id}" ${rec.zone_id===id?'selected':''}>${name} (${id})</option>`)
    .join('');
  return `
    <div class="field"><label>Furniture ID</label><input id="f-id" value="${isNew?'':rec.id}" readonly style="opacity:0.5${isNew?';font-style:italic':''}"></div>
    <div class="field"><label>Name</label><input id="f-name" value="${rec.name||''}" ${isNew?'oninput="document.getElementById(\'f-id\').value=\'furniture_\'+this.value.toLowerCase().replace(/\\s+/g,\'_\').replace(/[^a-z0-9_]/g,\'\')"':''}></div>
    <div class="field"><label>Description</label><textarea id="f-description" rows="4">${rec.description||''}</textarea></div>
    <div class="field"><label>Price (cr)</label>
      <input id="f-price" type="number" min="0" step="1" value="${rec.price ?? 0}">
      <div style="font-size:10px;color:var(--text-dim);margin-top:3px">Appraisal / base value in credits. Used as the vendor shop price for sellable furniture.</div>
    </div>
    <div class="field"><label>Zone</label>
      <select id="f-zone_id">
        <option value="" ${!rec.zone_id?'selected':''}>— Unplaced —</option>
        ${zoneOptions}
      </select>
    </div>
    <div class="field"><label>Object Type</label>
      ${(rec.object_type && !['furniture','light','container'].includes(rec.object_type)) ? `
      <div style="font-size:11px;color:var(--text-bright);background:var(--bg2);border:1px solid var(--border);padding:6px 8px;border-radius:3px">
        Specialized type <b>${rec.object_type}</b> — managed by another panel/script. This form preserves it on save; the dropdown below is disabled to prevent coercion.
      </div>
      <select id="f-object_type" disabled><option selected>${rec.object_type}</option></select>` : `
      <select id="f-object_type" onchange="const show=this.value==='light';['f-light-fields','f-lighton-field','f-powerdraw-field','f-lumens-field'].forEach(function(id){document.getElementById(id).style.display=show?'':'none';})">
        <option value="furniture" ${(!rec.object_type||rec.object_type==='furniture')?'selected':''}>Furniture</option>
        <option value="light" ${rec.object_type==='light'?'selected':''}>Light</option>
        <option value="container" ${rec.object_type==='container'?'selected':''}>Container</option>
      </select>`}
    </div>
    <div class="field" id="f-light-fields" style="${rec.object_type==='light'?'':'display:none'}">
      <label>Light Type</label>
      <select id="f-light_type">
        <option value="lamp" ${rec.light_type==='lamp'?'selected':''}>Lamp</option>
        <option value="overhead" ${rec.light_type==='overhead'?'selected':''}>Overhead</option>
        <option value="streetlight" ${rec.light_type==='streetlight'?'selected':''}>Streetlight</option>
      </select>
    </div>
    <div class="field" id="f-lighton-field" style="${rec.object_type==='light'?'':'display:none'}">
      <label>Light On</label>
      <select id="f-light_on">
        <option value="0" ${!rec.light_on?'selected':''}>Off</option>
        <option value="1" ${rec.light_on?'selected':''}>On</option>
      </select>
    </div>
    <div class="field" id="f-powerdraw-field" style="${rec.object_type==='light'?'':'display:none'}">
      <label>Power Draw (W)</label>
      ${(() => {
        const LIGHT_DEFAULTS = { streetlight: 200, overhead: 20, lamp: 5 };
        const defaultW = LIGHT_DEFAULTS[rec.light_type] ?? 5;
        const effectiveW = rec.power_draw_kw ?? defaultW;
        const isCustom = rec.power_draw_kw != null;
        return `<input id="f-power_draw_kw" type="number" min="0" step="1" value="${effectiveW}">
        <div style="font-size:10px;color:var(--text-dim);margin-top:3px">${isCustom ? `Custom (default for ${rec.light_type||'this type'}: ${defaultW}W)` : `Default for ${rec.light_type||'this type'} — clear to reset`}</div>`;
      })()}
    </div>
    <div class="field" id="f-lumens-field" style="${rec.object_type==='light'?'':'display:none'}">
      <label>Lumen Output</label>
      ${(() => {
        const LUMEN_DEFAULTS = { streetlight: 8000, overhead: 1200, lamp: 400 };
        const defaultLm = LUMEN_DEFAULTS[rec.light_type] ?? 400;
        const effectiveLm = rec.lumen_output ?? defaultLm;
        const isCustom = rec.lumen_output != null;
        return `<input id="f-lumen_output" type="number" min="0" step="50" value="${effectiveLm}">
        <div style="font-size:10px;color:var(--text-dim);margin-top:3px">${isCustom ? `Custom (default for ${rec.light_type||'this type'}: ${defaultLm} lm)` : `Default for ${rec.light_type||'this type'} — clear to reset`}<br>lamp≈400 lm · overhead≈1200 lm · streetlight≈8000 lm</div>`;
      })()}
    </div>
    <div class="field">
      <label>Interactions</label>
      <div style="display:flex;gap:14px;flex-wrap:wrap;padding:6px 0">
        ${['sit','lie','lean','watch','switch'].map(i => {
          const checked = (rec.flags?.interactions || []).includes(i) ? 'checked' : '';
          return `<label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;font-weight:normal">
            <input type="checkbox" id="f-ix-${i}" ${checked} style="accent-color:var(--accent)"> ${i}
          </label>`;
        }).join('')}
      </div>
      <div style="font-size:10px;color:var(--text-dim);margin-top:2px">Which commands players can use on this piece of furniture.</div>
    </div>
    <div class="field">
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:normal">
        <input type="checkbox" id="f-woven" ${rec.flags?.woven ? 'checked' : ''} style="accent-color:var(--accent)"> Woven into room prose
      </label>
      <div style="font-size:10px;color:var(--text-dim);margin-top:2px">Fold this piece into the room description (its first sentence) instead of the Furniture list. Best for scenery/dressing — woven pieces collapse with the description on mobile.</div>
    </div>
    ${(() => {
      const flags = (rec.flags && typeof rec.flags === 'object') ? rec.flags : {};
      const tagNames = Object.keys(flags).filter(n => TAG_CATALOG[n] && tagAppliesTo(TAG_CATALOG[n], 'furniture'));
      return `<div class="field">
        <label>Capabilities & Tags</label>
        <div id="furniture-tags">${tagNames.map(n => furnitureTagRow(n, flags[n])).join('')}</div>
        <div id="furniture-add-tag-picker">${furnitureAddTagPicker(tagNames)}</div>
        <div class="field" style="margin-top:8px">
          <label style="font-size:11px;opacity:0.6;text-transform:uppercase;letter-spacing:0.05em">Attached Tags</label>
          <div id="furniture-tag-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">${furnitureTagChips(tagNames)}</div>
        </div>
        <div style="font-size:10px;color:var(--text-dim);margin-top:2px">Tag-driven affordances. A capability enables verbs from any plugin that asks for it (e.g. Water Source → drink/wash).</div>
      </div>`;
    })()}
  `;
}

// --- Furniture tag picker (mirrors the item picker; reuses itemTagWidget /
// readItemTag). Tags are stored as flat keys in furniture.flags and filtered to
// the catalog entries marked usable on furniture. ---
function furnitureTagRow(name, value) {
  const def = TAG_CATALOG[name];
  return `<div class="field tag-row" data-tag="${name}">
    <label>${def.label}<button type="button" onclick="removeFurnitureTag(this)" style="float:right;background:none;border:none;color:inherit;cursor:pointer;font-size:15px;line-height:1">×</button></label>
    ${itemTagWidget(name, value)}
    <div class="zone-subsection-note">${def.help}</div>
  </div>`;
}

function furnitureAddTagPicker(presentNames) {
  const groups = {};
  for (const [name, def] of Object.entries(TAG_CATALOG)) {
    if (!tagAppliesTo(def, 'furniture') || presentNames.includes(name)) continue;
    (groups[def.group] = groups[def.group] || []).push([name, def]);
  }
  const optgroups = Object.entries(groups).map(([g, list]) =>
    `<optgroup label="${g}">${list.map(([n, d])=>`<option value="${n}">${d.label}</option>`).join('')}</optgroup>`).join('');
  if (!optgroups) return '<div style="font-size:11px;color:var(--text-dim)">No more furniture tags available.</div>';
  return `<div class="field-row" style="align-items:flex-end">
    <div class="field"><label>Add tag</label><select id="furniture-add-tag">${optgroups}</select></div>
    <button type="button" class="action-btn" onclick="addFurnitureTag()">Add</button>
  </div>`;
}

function furnitureTagChips(present) {
  if (!present.length) return '<span style="color:var(--text-dim);font-size:11px">No tags attached.</span>';
  return present.map(n => {
    const def = TAG_CATALOG[n];
    const label = def ? def.label : n;
    return `<span onclick="removeFurnitureTagByName('${n}')" style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:12px;background:var(--bg-alt,rgba(255,255,255,0.08));border:1px solid var(--border,rgba(255,255,255,0.15));font-size:11px;cursor:pointer;user-select:none" title="Click to remove">${label} <span style="opacity:0.6">×</span></span>`;
  }).join('');
}

function refreshFurnitureTagChips() {
  const el = document.getElementById('furniture-tag-chips');
  if (!el) return;
  const present = [...document.querySelectorAll('#furniture-tags .tag-row')].map(r => r.dataset.tag);
  el.innerHTML = furnitureTagChips(present);
}

function refreshFurnitureTagPicker() {
  const present = [...document.querySelectorAll('#furniture-tags .tag-row')].map(r => r.dataset.tag);
  document.getElementById('furniture-add-tag-picker').innerHTML = furnitureAddTagPicker(present);
  refreshFurnitureTagChips();
}

function addFurnitureTag() {
  const name = document.getElementById('furniture-add-tag').value;
  if (!name) return;
  const def = TAG_CATALOG[name];
  const defaults = { flag:true, int:0, enum:def.options?.[0], range:{min:0,max:0}, hot:{amount:0,duration_seconds:0}, statmap:{}, text:'' };
  document.getElementById('furniture-tags').insertAdjacentHTML('beforeend', furnitureTagRow(name, defaults[def.shape]));
  refreshFurnitureTagPicker();
}

function removeFurnitureTag(btn) {
  btn.closest('.tag-row').remove();
  refreshFurnitureTagPicker();
}

function removeFurnitureTagByName(name) {
  const row = document.querySelector(`#furniture-tags .tag-row[data-tag="${name}"]`);
  if (row) { row.remove(); refreshFurnitureTagPicker(); }
}
async function assignRoomToJB(zoneId) {
  const genId = document.getElementById('assign-jb-select')?.value;
  if (!genId) { toast('Select a junction box first.', true); return; }
  const result = await API(`/environment/power/zones/${encodeURIComponent(zoneId)}/assign-jb`, 'POST', { generatorId: genId }).catch(e => ({ error: e.message }));
  if (result?.error) { toast(result.error, true); return; }
  toast(`Assigned to ${result.generatorName}.`);
  editRecord(zoneId);
}

// Object types this generic form is allowed to author. Anything else
// (generator, junction_box, broadcast_camera, media_deck, cosmetic_machine,
// security_device, toilet, generator_portable, …) is created by other panels
// or seed scripts; this form must preserve it, not coerce it back.
const FURNITURE_EDITABLE_TYPES = ['furniture','light','container'];
// Interactions the checkbox row can set. Values outside this list (e.g. lift,
// examine) are set by scripts and must be preserved on save.
const FURNITURE_STD_INTERACTIONS = ['sit','lie','lean','watch','switch'];

async function saveFurniture(existing) {
  const isNew = !existing?.id;
  const dropdownType = document.getElementById('f-object_type')?.value || 'furniture';
  // Don't let the 3-option dropdown coerce a specialized piece back to a plain type.
  const objectType = (existing && !FURNITURE_EDITABLE_TYPES.includes(existing.object_type))
    ? existing.object_type
    : dropdownType;
  const isLight = objectType === 'light';
  const checkedIx = FURNITURE_STD_INTERACTIONS.filter(i => document.getElementById(`f-ix-${i}`)?.checked);
  const preservedIx = (existing?.flags?.interactions || []).filter(i => !FURNITURE_STD_INTERACTIONS.includes(i));
  const flags = { ...(existing?.flags || {}), interactions: [...checkedIx, ...preservedIx] };
  if (document.getElementById('f-woven')?.checked) flags.woven = true;
  else delete flags.woven;
  // Re-derive furniture-applicable catalog tags from the picker. Non-catalog
  // flags (e.g. atm) and the interactions array are preserved.
  for (const [name, def] of Object.entries(TAG_CATALOG)) {
    if (tagAppliesTo(def, 'furniture')) delete flags[name];
  }
  try {
    for (const row of document.querySelectorAll('#furniture-tags .tag-row')) flags[row.dataset.tag] = readItemTag(row);
  } catch (e) { return { error: e.message }; }
  const body = {
    name: document.getElementById('f-name').value,
    description: document.getElementById('f-description').value,
    zone_id: document.getElementById('f-zone_id').value || null,
    flags,
    object_type: objectType,
    price: Number(document.getElementById('f-price')?.value) || 0,
    light_type: isLight ? (document.getElementById('f-light_type')?.value || 'lamp') : null,
    light_on: isLight ? Number(document.getElementById('f-light_on')?.value || 0) : 0,
  };
  const pdEl = document.getElementById('f-power_draw_kw');
  if (pdEl) body.power_draw_kw = pdEl.value.trim() === '' ? null : Number(pdEl.value);
  const lmEl = document.getElementById('f-lumen_output');
  if (lmEl) body.lumen_output = lmEl.value.trim() === '' ? null : Number(lmEl.value);
  let result;
  if (isNew) { body.id = `furniture_${body.name.trim().toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'')}` || `furniture_${Date.now()}`; result = await API('/furniture', 'POST', body); }
  else { result = await API(`/furniture/${existing.id}`, 'PUT', body); }
  if (isLight) API('/environment/power/fix-buildings', 'POST').catch(() => {});
  return result;
}

function filterFurniture(q) {
  const zonesArr = [..._furnitureZoneNames.entries()].map(([id, name]) => ({ id, name }));
  if (!q) {
    renderFurniturePanel({ furniture: _furnitureAllItems, zones: zonesArr });
    return;
  }
  const matches = _furnitureAllItems.filter(f =>
    f.name.toLowerCase().includes(q) || (f.description || '').toLowerCase().includes(q)
  );
  const panel = document.getElementById('list-panel');
  if (!matches.length) {
    panel.innerHTML = '<div style="padding:24px;color:var(--text-dim)">No furniture matching search.</div>';
    return;
  }
  panel.innerHTML = matches.map(f => {
    const zoneName = f.zone_id ? (_furnitureZoneNames.get(f.zone_id) || f.zone_id) : 'Unplaced';
    return `<div style="display:flex;align-items:center;gap:8px;padding:5px 12px;border-bottom:1px solid var(--border);background:var(--bg1);cursor:pointer" onclick="editRecord('${f.id}')">
      <div style="flex:1;min-width:0">
        <span style="color:var(--text-bright)">${f.name}</span>
        <span style="font-size:10px;color:var(--text-dim);margin-left:8px">${zoneName}</span>
        ${f.description ? `<div style="font-size:11px;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:500px">${f.description}</div>` : ''}
      </div>
      <button class="action-btn" style="font-size:10px;padding:2px 8px" onclick="event.stopPropagation();editRecord('${f.id}')">Edit</button>
      <button class="action-btn danger" style="font-size:10px;padding:2px 8px" data-fid="${f.id}" data-fname="${f.name.replace(/"/g,'&quot;')}" onclick="event.stopPropagation();deleteFurnitureStaged(this.dataset.fid,this.dataset.fname)">Del</button>
    </div>`;
  }).join('');
}

// --- Big Map (shared grid layout + renderer for both the Zones screen's
// popup and the embedded Power tab view) ---
// The city is a small, fixed 10-tile grid (see seed.js's map-shrink) — a
// hand-placed layout is simpler and more reliable here than a generic
// auto-layout algorithm.
// Dynamic map grid — reads actual grid_x/grid_y from zone records instead of
// a hardcoded layout. Used by the bigmap overlay and Power tab.
