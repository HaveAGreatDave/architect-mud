let sortState = { key: null, dir: 1 };

function _nameToId(prefix, name) {
  return `${prefix}_${name.toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'')}`;
}

function _autoFillIdFromName() {
  const p = PANELS[currentPanel];
  if (!p?.idPrefix) return;
  const idEl = document.getElementById('f-id');
  const nameEl = document.getElementById('f-name');
  if (!idEl || idEl.dataset.userEdited || !nameEl) return;
  idEl.value = _nameToId(p.idPrefix, nameEl.value);
}

// Mark ID field as user-edited if they type in it manually
document.addEventListener('input', e => {
  if (e.target.id === 'f-id') e.target.dataset.userEdited = '1';
  if (e.target.id === 'f-name') _autoFillIdFromName();
});

function renderTable(columns, records, noEdit = false) {
  const panel = document.getElementById('list-panel');
  if (!records.length) { panel.innerHTML = '<div style="padding:24px;color:var(--text-dim)">No records found.</div>'; return; }

  let sorted = records;
  if (sortState.key) {
    sorted = [...records].sort((a, b) => {
      let av = a[sortState.key], bv = b[sortState.key];
      if (av == null) av = '';
      if (bv == null) bv = '';
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sortState.dir;
      return String(av).localeCompare(String(bv)) * sortState.dir;
    });
  }

  let html = '<table><thead><tr>';
  for (const col of columns) {
    const isSorted = sortState.key === col.key;
    const arrow = isSorted ? (sortState.dir === 1 ? ' ▲' : ' ▼') : '';
    html += `<th class="sortable-col${isSorted?' sorted':''}" onclick="sortTableBy('${col.key}')">${col.label}${arrow}</th>`;
  }
  if (!noEdit) html += '<th></th>';
  html += '</tr></thead><tbody>';

  for (const rec of sorted) {
    html += `<tr onclick="selectRecord('${rec.id}')">`;
    for (const col of columns) {
      const raw = rec[col.key];
      const val = col.render ? col.render(raw) : (raw ?? '—');
      html += `<td>${val}</td>`;
    }
    if (!noEdit) html += `<td><button class="action-btn" onclick="event.stopPropagation();editRecord('${rec.id}')">Edit</button></td>`;
    html += '</tr>';
  }
  html += '</tbody></table>';
  panel.innerHTML = html;
}

// Zones-specific renderer: any zone flagged is_apartment is treated as a
// unit belonging to whatever zone its (single) exit leads back to — that's
// how apiBuildApartmentBlock wires units to their lobby, and how the
// hand-seeded apartment zones are wired too. Units are listed immediately
// under their parent building instead of the flat alphabetical/sorted list,
// and excluded from the top-level rows so they don't appear twice. A unit
// whose parent isn't in the current zone list (orphaned) just falls back
// to a normal top-level row, sorted in as usual.
// Tracks which buildings are collapsed in the Zones list (id -> true).
// Module-level so it survives re-renders (sorting, refreshing after an
// edit) within the session; not persisted across page loads.
const collapsedBuildings = new Set();
function toggleBuildingCollapse(id) {
  if (collapsedBuildings.has(id)) collapsedBuildings.delete(id);
  else collapsedBuildings.add(id);
  renderZonesTable(allRecords);
}

const collapsedItemTypes = new Set();
function toggleItemTypeCollapse(type) {
  if (collapsedItemTypes.has(type)) collapsedItemTypes.delete(type);
  else collapsedItemTypes.add(type);
  renderItemsPanel();
}

function sortTableBy(key) {
  if (sortState.key === key) sortState.dir *= -1;
  else { sortState.key = key; sortState.dir = 1; }
  const p = PANELS[currentPanel];
  if (p?.render) { p.render(allRecords); return; }
  if (p?.columns) renderTable(p.columns, allRecords, p.noEdit);
}

function sortWorldStateBy(key) {
  if (sortState.key === key) sortState.dir *= -1;
  else { sortState.key = key; sortState.dir = 1; }
  if (window._wsData) renderWorldState(window._wsData);
}

function filterTable() {
  const q = document.getElementById('search-input').value.toLowerCase();
  const p = PANELS[currentPanel];
  if (!p) return;
  if (p.filter) { p.filter(q); return; }
  if (!p.columns) return;
  const filtered = allRecords.filter(r =>
    Object.values(r).some(v => String(v).toLowerCase().includes(q))
  );
  renderTable(p.columns, filtered, p.noEdit);
}

function selectRecord(id) {
  currentRecord = allRecords.find(r => r.id === id);
}

function editRecord(id) {
  currentRecord = allRecords.find(r => r.id === id);
  openEdit(currentRecord, false);
}

function newRecord(defaults = {}) {
  currentRecord = null;
  if (currentPanel === 'zones' && !('color' in defaults)) {
    defaults = { ...defaults, color: suggestZoneColor(allRecords.map(z => z.color).filter(Boolean)) };
  }
  if (currentPanel === 'furniture' && !('zone_id' in defaults) && typeof _furnitureLastClickedZone !== 'undefined' && _furnitureLastClickedZone) {
    defaults = { ...defaults, zone_id: _furnitureLastClickedZone };
  }
  openEdit(defaults, true);
}

async function openEdit(record, isNew) {
  const p = PANELS[currentPanel];
  if (!p?.editForm) return;
  document.getElementById('edit-panel').classList.add('open');
  const singular = p.title.endsWith('ies') ? p.title.slice(0,-3)+'y' : p.title.slice(0,-1);
  document.getElementById('edit-title').textContent = isNew ? `New ${singular}` : `Edit: ${record.name || record.id}`;
  document.getElementById('delete-btn').style.display = isNew ? 'none' : '';
  document.getElementById('edit-body').innerHTML = '<div style="padding:24px;color:var(--text-dim)">Loading...</div>';
  document.getElementById('edit-body').innerHTML = await p.editForm(record, isNew);
  const idEl = document.getElementById('f-id');
  if (idEl) delete idEl.dataset.userEdited;
  // Populate the script node editor after DOM is ready
  if (currentPanel === 'scripts') renderScriptEditor();
  // Populate zone windows sub-section after DOM is ready
  if (currentPanel === 'zones' && record?.id) zoneWindowsRefresh(record.id);
  // Populate door list with the up-to-date template (initial render uses stale inline template)
  if (currentPanel === 'zones' && record?.id) refreshDoorList(record.id);
  // Populate world map exit dropdown if this is a building zone
  if (currentPanel === 'zones' && record?.flags?.is_building) {
    toggleBuildingFields(true, record.id);
  }
}

let _mapZoneEditSaved = false;

function closeEdit() {
  document.getElementById('edit-panel').classList.remove('open');
  document.getElementById('edit-body').innerHTML = '';
  // Revert live map color preview if the edit was discarded (closed without saving)
  if (mapZoneEditReturn && !_mapZoneEditSaved && currentRecord) {
    const z = mapOverview?.zones.get(currentRecord.id);
    if (z) {
      z.color = currentRecord.color || null;
      z.bg_color = currentRecord.bg_color || null;
      z.marker = currentRecord.marker || null;
      renderMapOverview();
    }
  }
  _mapZoneEditSaved = false;
  currentRecord = null;
  // Restore the standard Save/Delete footer in case it was overridden (e.g. broadcast NPC sidebar)
  const editFooter = document.querySelector('#edit-panel .edit-footer');
  if (editFooter) {
    editFooter.innerHTML = `
      <button class="action-btn success" onclick="saveRecord()" style="flex:1">Save</button>
      <button class="action-btn danger" id="delete-btn" onclick="deleteRecord()">Delete</button>`;
  }
  // Clean up VINE editor if active (removes document-level key listeners)
  if (window._vineActiveEditor) {
    window._vineActiveEditor.destroy();
    window._vineActiveEditor = null;
  }
  if (mapZoneEditReturn) { currentPanel = 'maps'; mapZoneEditReturn = false; }
  if (zoneEnemyEditReturn) { currentPanel = 'zones'; activatePanelNav('zones'); zoneEnemyEditReturn = null; }
}

async function saveRecord() {
  const p = PANELS[currentPanel];
  if (!p?.save) return;
  const submitBtn = document.querySelector('.edit-footer .action-btn.success');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving...'; }
  try {
    // Auto-generate ID from name if the ID field is still empty on a new record
    if (!currentRecord && p.idPrefix) {
      const idEl = document.getElementById('f-id');
      const nameEl = document.getElementById('f-name');
      if (idEl && !idEl.value.trim() && nameEl?.value.trim()) {
        idEl.value = _nameToId(p.idPrefix, nameEl.value.trim());
      }
    }
    const result = await p.save(currentRecord);
    if (result?.error) { toast(result.error, true); return; }
    if (result?.staged) {
      toast('Staged for review ✓');
      await updateStagingBadge();
    } else {
      toast('Saved & published ✓');
    }
    if (validatorAutoRun && currentPanel === 'zones' && currentRecord?.id) {
      const savedId = currentRecord.id;
      runZoneValidation(savedId).then(() => {
        const issues = lastValidatorReport?.summary?.totalIssues;
        if (issues > 0) toast(`Zone saved — ${issues} exit issue(s) found (see Validator)`, true);
      }).catch(() => {});
    }
    if (mapZoneEditReturn) {
      const savedId = currentRecord?.id;
      applyZoneEditToMap(savedId);
      // Persist staged color/marker overrides so the map stays correct after panel reloads
      if (result?.staged && savedId) {
        const z = mapOverview?.zones.get(savedId);
        if (z) _mapPendingOverrides.set(savedId, { color: z.color || null, bg_color: z.bg_color || null, marker: z.marker || null });
      }
    } else if (zoneEnemyEditReturn) {
      await refreshEnemiesSection(zoneEnemyEditReturn);
    } else {
      await loadPanel(currentPanel);
    }
    _mapZoneEditSaved = true;
    closeEdit();
  } catch (err) {
    toast(`Unexpected error: ${err.message}`, true);
    console.error('saveRecord failed:', err);
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save'; }
  }
}

async function deleteFurnitureStaged(id, name) {
  const item = _furnitureAllItems.find(f => f.id === id);
  const prev = currentRecord;
  currentRecord = { name }; // staging interceptor reads currentRecord.name for the entity label
  const r = await API(`/furniture/${id}`, 'DELETE');
  currentRecord = prev;
  if (r?.error) { toast(r.error, true); return; }
  if (item) item._markedForDeletion = true;
  renderFurniturePanel({ furniture: _furnitureAllItems, zones: [..._furnitureZoneNames.entries()].map(([zid, zname]) => ({ id: zid, name: zname })) });
  updateStagingBadge();
  toast(`"${name}" marked for deletion`);
}

async function deleteRecord() {
  if (!currentRecord) return;
  // Furniture deletes are staged — route to the staged delete path.
  if (currentPanel === 'furniture') {
    await deleteFurnitureStaged(currentRecord.id, currentRecord.name || currentRecord.id);
    closeEdit();
    return;
  }
  let confirmMsg = `Delete ${currentRecord.name || currentRecord.id}?`;
  if (currentPanel === 'zones') {
    const childCount = allRecords.filter(z => (z.flags?.is_apartment || z.flags?.is_interior) && Object.values(z.exits || {})[0] === currentRecord.id).length;
    if (childCount) confirmMsg = `Delete ${currentRecord.name || currentRecord.id}? This will also delete ${childCount} attached room${childCount > 1 ? 's' : ''}.`;
  }
  if (!confirm(confirmMsg)) return;
  const p = PANELS[currentPanel];
  if (!p?.delete) return;
  try {
    const result = await p.delete(currentRecord.id);
    if (result?.error) { toast(result.error, true); return; }
    if (result?.staged) {
      toast('Marked for deletion — publish to apply');
      await updateStagingBadge();
    } else {
      toast(result?.message || 'Deleted');
    }
    await loadPanel(currentPanel);
    closeEdit();
  } catch (err) {
    toast(`Unexpected error: ${err.message}`, true);
    console.error('deleteRecord failed:', err);
  }
}

// Inline Delete/Clone for zones table rows — act without opening the edit panel.
