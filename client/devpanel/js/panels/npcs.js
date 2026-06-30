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
  panel.innerHTML = html;
}

// --- Zone forms ---
// Controls which entrance-discovery flavor-text bank a building uses
// (server-side bank lives in commands.js, keyed by the same ids).
async function npcEditForm(rec, isNew) {
  const tree = typeof rec.dialogue_tree === 'object' ? rec.dialogue_tree : JSON.parse(rec.dialogue_tree||'{}');
  const vendor = Array.isArray(rec.vendor_inventory) ? rec.vendor_inventory : JSON.parse(rec.vendor_inventory||'[]');
  const behaviourGraph = typeof rec.behaviour_graph === 'object' ? rec.behaviour_graph : JSON.parse(rec.behaviour_graph||'{}');
  const flags = typeof rec.flags === 'object' ? rec.flags : JSON.parse(rec.flags||'{}');
  const zones = await API('/zones').catch(() => []);
  const zoneList = Array.isArray(zones) ? [...zones].sort((a, b) => (a.id||'').localeCompare(b.id||'')) : [];
  const homeZoneVal = rec.home_zone || 'zone_residential_lobby';
  const homeZoneOpts = zoneList.map(z => `<option value="${z.id}" ${z.id===homeZoneVal?'selected':''}>${z.id}</option>`).join('');
  return `
    <div class="field"><label>NPC ID</label><input id="f-id" value="${isNew?'':rec.id}" ${!isNew?'readonly style="opacity:0.5"':''}></div>
    <div class="field"><label>Name</label><input id="f-name" value="${rec.name||''}"></div>
    <div class="field"><label>Description</label><textarea id="f-description">${rec.description||''}</textarea></div>
    <div class="field-row">
      <div class="field"><label>Zone ID</label><input id="f-zone_id" value="${rec.zone_id||''}"></div>
      <div class="field"><label>Home Zone</label><select id="f-home_zone">${homeZoneOpts}</select></div>
      <div class="field"><label>Faction</label><input id="f-faction" value="${rec.faction||''}"></div>
    </div>
    <div class="checkbox-field"><input type="checkbox" id="f-wanders" ${rec.wanders?'checked':''} onchange="document.getElementById('f-wander_zones-wrap').style.display=this.checked?'':'none'"><label>Wanders between zones</label></div>
    <div class="field" id="f-wander_zones-wrap" style="${rec.wanders?'':'display:none'}">
      <label>Permitted Wander Zones (one zone ID per line)</label>
      <textarea id="f-wander_zones" rows="4" placeholder="Leave blank to wander to adjacent zones only">${(Array.isArray(rec.wander_zones)?rec.wander_zones:JSON.parse(rec.wander_zones||'[]')).join('\n')}</textarea>
      <div class="zone-subsection-note">Current zone is always included at runtime.</div>
    </div>
    <div class="field">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <label>Dialogue Tree (JSON)</label>
        <button type="button" class="action-btn" onclick="npcOpenVine()">🌿 Visual Editor</button>
      </div>
      <textarea id="f-dialogue_tree" rows="10">${JSON.stringify(tree, null, 2)}</textarea>
    </div>
    <div class="field"><label>Vendor Inventory — array of { "item_id": "...", "price"?: 0, "stock"?: 99 } (price/stock optional)</label><textarea id="f-vendor_inventory" rows="5">${JSON.stringify(vendor, null, 2)}</textarea></div>
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
  let tree, vendor, behaviour_graph;
  try { tree = JSON.parse(document.getElementById('f-dialogue_tree').value); } catch { return { error: 'Dialogue tree: invalid JSON' }; }
  try { vendor = JSON.parse(document.getElementById('f-vendor_inventory').value); } catch { return { error: 'Vendor inventory: invalid JSON' }; }
  if (!Array.isArray(vendor)) return { error: 'Vendor inventory must be a JSON array.' };
  for (const e of vendor) {
    if (!e || typeof e.item_id !== 'string' || !e.item_id.trim()) {
      return { error: 'Vendor inventory: each entry needs an "item_id" string (price/stock optional).' };
    }
  }
  try { behaviour_graph = JSON.parse(document.getElementById('f-behaviour_graph')?.value || '{}'); } catch { return { error: 'Behaviour graph: invalid JSON' }; }
  let flags;
  try { flags = JSON.parse(document.getElementById('f-flags')?.value || '{}'); } catch { return { error: 'Flags: invalid JSON' }; }
  const wanderZonesRaw = document.getElementById('f-wander_zones')?.value || '';
  const wander_zones = wanderZonesRaw.split('\n').map(s => s.trim()).filter(Boolean);
  const body = {
    name: document.getElementById('f-name').value,
    description: document.getElementById('f-description').value,
    zone_id: document.getElementById('f-zone_id').value || null,
    home_zone: document.getElementById('f-home_zone').value || null,
    faction: document.getElementById('f-faction').value || null,
    wanders: document.getElementById('f-wanders').checked,
    wander_zones,
    dialogue_tree: tree,
    vendor_inventory: vendor,
    behaviour_graph,
    flags,
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

