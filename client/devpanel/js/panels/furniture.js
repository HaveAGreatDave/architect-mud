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
  return `<div style="display:flex;align-items:center;gap:8px;padding:5px 12px 5px ${paddingLeft};border-bottom:1px solid var(--border);background:var(--bg1)">
    <div style="flex:1;min-width:0">
      <span style="color:${nameColor}">${f.name}</span>${lightBadge}${stagedBadge}
      ${f.description ? `<div style="font-size:11px;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:500px">${f.description}</div>` : ''}
    </div>
    <button class="action-btn" style="font-size:10px;padding:2px 8px" onclick="editRecord('${f.id}')">Edit</button>
    <button class="action-btn danger" style="font-size:10px;padding:2px 8px" data-fid="${f.id}" data-fname="${f.name.replace(/"/g,'&quot;')}" onclick="deleteFurnitureStaged(this.dataset.fid,this.dataset.fname)">Del</button>
  </div>`;
}

// Module-level cache so room/add modals can reference fresh data without
// re-fetching the whole panel.
let _furnitureAllItems = [];
let _furnitureZoneNames = new Map();
const _furnitureExpandedZones = new Set();
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
      for (const exitZoneId of Object.values(z.exits)) {
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
            <button class="action-btn" style="font-size:10px;padding:2px 8px;margin-left:4px" onclick="event.stopPropagation();openFurnitureAddModal('${intId}')">+ Add</button>
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
      ? `<button class="action-btn" style="font-size:10px;padding:2px 8px;margin-left:8px" onclick="event.stopPropagation();openFurnitureAddModal('${zoneId}')">+ Add</button>`
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

  const streetlightsToolbar = `<div style="padding:8px 12px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px">
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

  const tableRows = items.map(f => `<tr>
    <td style="color:var(--text-bright);font-weight:600">${f.name}${lightBadge(f)}</td>
    <td style="color:var(--text-dim);font-size:11px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.description||''}</td>
    <td style="text-align:right;white-space:nowrap">
      <button class="action-btn" style="font-size:10px;padding:2px 6px" onclick="closeModal();editRecord('${f.id}')">Edit</button>
      <button class="action-btn danger" style="font-size:10px;padding:2px 6px;margin-left:2px" onclick="closeModal();deleteFurnitureStaged('${f.id}','${f.name.replace(/'/g,"\\'")}')">Del</button>
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
    <div class="field"><label>Furniture ID</label><input id="f-id" value="${isNew?'':rec.id}" ${!isNew?'readonly style="opacity:0.5"':''}></div>
    <div class="field"><label>Name</label><input id="f-name" value="${rec.name||''}"></div>
    <div class="field"><label>Description</label><textarea id="f-description" rows="4">${rec.description||''}</textarea></div>
    ${!isNew ? `<div class="field"><label>Zone</label>
      <select id="f-zone_id">
        <option value="" ${!rec.zone_id?'selected':''}>— Unplaced —</option>
        ${zoneOptions}
      </select>
    </div>` : `<input type="hidden" id="f-zone_id" value="${rec.zone_id||''}">`}
    <div class="field"><label>Object Type</label>
      <select id="f-object_type" onchange="const show=this.value==='light';['f-light-fields','f-lighton-field','f-powerdraw-field','f-lumens-field'].forEach(function(id){document.getElementById(id).style.display=show?'':'none';})">
        <option value="furniture" ${(!rec.object_type||rec.object_type==='furniture')?'selected':''}>Furniture</option>
        <option value="light" ${rec.object_type==='light'?'selected':''}>Light</option>
        <option value="fixture" ${rec.object_type==='fixture'?'selected':''}>Fixture</option>
        <option value="appliance" ${rec.object_type==='appliance'?'selected':''}>Appliance</option>
        <option value="decoration" ${rec.object_type==='decoration'?'selected':''}>Decoration</option>
        <option value="terminal" ${rec.object_type==='terminal'?'selected':''}>Terminal</option>
        <option value="container" ${rec.object_type==='container'?'selected':''}>Container</option>
      </select>
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
        ${['sit','lie','lean','switch'].map(i => {
          const checked = (rec.flags?.interactions || []).includes(i) ? 'checked' : '';
          return `<label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;font-weight:normal">
            <input type="checkbox" id="f-ix-${i}" ${checked} style="accent-color:var(--accent)"> ${i}
          </label>`;
        }).join('')}
      </div>
      <div style="font-size:10px;color:var(--text-dim);margin-top:2px">Which commands players can use on this piece of furniture.</div>
    </div>
    ${(() => {
      const caps = Object.entries(window.TAG_CATALOG || {})
        .filter(([, def]) => def.scope === 'furniture' && def.shape === 'flag');
      if (!caps.length) return '';
      const boxes = caps.map(([key, def]) => {
        const checked = rec.flags?.[key] ? 'checked' : '';
        return `<label style="display:flex;align-items:flex-start;gap:6px;font-size:12px;cursor:pointer;font-weight:normal" title="${(def.help||'').replace(/"/g,'&quot;')}">
          <input type="checkbox" id="f-cap-${key}" ${checked} style="accent-color:var(--accent);margin-top:2px"> ${def.label}
        </label>`;
      }).join('');
      return `<div class="field">
        <label>Capabilities</label>
        <div style="display:flex;flex-direction:column;gap:8px;padding:6px 0">${boxes}</div>
        <div style="font-size:10px;color:var(--text-dim);margin-top:2px">Tag-driven affordances. A capability enables verbs from any plugin that asks for it (e.g. Water Source → drink/wash).</div>
      </div>`;
    })()}
  `;
}

// Catalog keys with scope 'furniture' + shape 'flag' — the capability checkboxes
// rendered in the editor and persisted as flat keys in furniture.flags.
function furnitureCapabilityKeys() {
  return Object.entries(window.TAG_CATALOG || {})
    .filter(([, def]) => def.scope === 'furniture' && def.shape === 'flag')
    .map(([key]) => key);
}
async function assignRoomToJB(zoneId) {
  const genId = document.getElementById('assign-jb-select')?.value;
  if (!genId) { toast('Select a junction box first.', true); return; }
  const result = await API(`/environment/power/zones/${encodeURIComponent(zoneId)}/assign-jb`, 'POST', { generatorId: genId }).catch(e => ({ error: e.message }));
  if (result?.error) { toast(result.error, true); return; }
  toast(`Assigned to ${result.generatorName}.`);
  editRecord(zoneId);
}

async function saveFurniture(existing) {
  const isNew = !existing?.id;
  const objectType = document.getElementById('f-object_type')?.value || 'furniture';
  const isLight = objectType === 'light';
  const flags = { ...(existing?.flags || {}), interactions: ['sit','lie','lean','switch'].filter(i => document.getElementById(`f-ix-${i}`)?.checked) };
  for (const key of furnitureCapabilityKeys()) {
    if (document.getElementById(`f-cap-${key}`)?.checked) flags[key] = true;
    else delete flags[key];
  }
  const body = {
    name: document.getElementById('f-name').value,
    description: document.getElementById('f-description').value,
    zone_id: document.getElementById('f-zone_id').value || null,
    flags,
    object_type: objectType,
    light_type: isLight ? (document.getElementById('f-light_type')?.value || 'lamp') : null,
    light_on: isLight ? Number(document.getElementById('f-light_on')?.value || 0) : 0,
  };
  const pdEl = document.getElementById('f-power_draw_kw');
  if (pdEl) body.power_draw_kw = pdEl.value.trim() === '' ? null : Number(pdEl.value);
  const lmEl = document.getElementById('f-lumen_output');
  if (lmEl) body.lumen_output = lmEl.value.trim() === '' ? null : Number(lmEl.value);
  let result;
  if (isNew) { body.id = document.getElementById('f-id').value.trim(); result = await API('/furniture', 'POST', body); }
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
    return `<div style="display:flex;align-items:center;gap:8px;padding:5px 12px;border-bottom:1px solid var(--border);background:var(--bg1)">
      <div style="flex:1;min-width:0">
        <span style="color:var(--text-bright)">${f.name}</span>
        <span style="font-size:10px;color:var(--text-dim);margin-left:8px">${zoneName}</span>
        ${f.description ? `<div style="font-size:11px;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:500px">${f.description}</div>` : ''}
      </div>
      <button class="action-btn" style="font-size:10px;padding:2px 8px" onclick="editRecord('${f.id}')">Edit</button>
      <button class="action-btn danger" style="font-size:10px;padding:2px 8px" data-fid="${f.id}" data-fname="${f.name.replace(/"/g,'&quot;')}" onclick="deleteFurnitureStaged(this.dataset.fid,this.dataset.fname)">Del</button>
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
