let validatorAutoRun = localStorage.getItem('validator-auto-run') === 'true';
let lastValidatorReport = null;

async function renderValidatorPanel() {
  const panel = document.getElementById('list-panel');
  const zonesData = await API('/zones');
  const zones = Array.isArray(zonesData) ? zonesData : [];
  zones.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
  const zoneOptions = zones.map(z => `<option value="${z.id}">${z.name} (${z.id})</option>`).join('');
  panel.innerHTML = `
    <div style="padding:20px;max-width:860px">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
        <button class="action-btn primary" onclick="runFullValidation()">Run Full Validation</button>
        <div style="display:flex;gap:6px;align-items:center">
          <select id="v-zone-id" style="background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:5px 8px;border-radius:2px;width:280px;outline:none">
            <option value="">Select a zone…</option>
            ${zoneOptions}
          </select>
          <button class="action-btn" onclick="runZoneValidation()">Validate Zone</button>
        </div>
        <label style="display:flex;align-items:center;gap:6px;color:var(--text-dim);font-size:13px;cursor:pointer">
          <input type="checkbox" id="v-auto-run" ${validatorAutoRun ? 'checked' : ''} onchange="toggleValidatorAutoRun(this.checked)" />
          Auto-validate on zone save
        </label>
        <button class="action-btn" onclick="exportValidatorReport()" style="margin-left:auto">Export JSON</button>
      </div>
      <div id="validator-results" style="color:var(--text-dim);font-size:13px">
        Click <strong>Run Full Validation</strong> to scan all zone exits for integrity issues.
      </div>
      <div style="margin-top:24px;padding-top:20px;border-top:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <span style="font-size:13px;font-weight:600;color:var(--text-bright)">Map Geometry</span>
          <button class="action-btn primary" onclick="runMapGeometryValidation()">Check Map Geometry</button>
        </div>
        <div id="validator-map-results" style="color:var(--text-dim);font-size:12px">
          Click <strong>Check Map Geometry</strong> to scan all maps for exit/position issues.
        </div>
      </div>
      <div style="margin-top:24px;padding-top:20px;border-top:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <span style="font-size:13px;font-weight:600;color:var(--text-bright)">Item Integrity</span>
          <button class="action-btn primary" onclick="runItemValidation()">Check Items</button>
        </div>
        <div id="validator-item-results" style="color:var(--text-dim);font-size:12px">
          Click <strong>Check Items</strong> to scan every item for null values and malformed tags.
        </div>
      </div>
    </div>`;
}

function toggleValidatorAutoRun(val) {
  validatorAutoRun = val;
  localStorage.setItem('validator-auto-run', val);
}

async function runFullValidation(opts = {}) {
  const el = document.getElementById('validator-results');
  if (el) el.innerHTML = '<span style="color:var(--text-dim)">Running full validation…</span>';
  try {
    const result = await API('/worldvalidator/run-full', 'POST', opts);
    lastValidatorReport = result;
    renderValidatorResults(result);
  } catch (err) {
    if (el) el.innerHTML = `<span style="color:var(--danger)">Error: ${err.message}</span>`;
  }
}

async function runZoneValidation(zoneId) {
  const id = zoneId || document.getElementById('v-zone-id')?.value?.trim();
  if (!id) { toast('Enter a zone ID first', true); return; }
  const el = document.getElementById('validator-results');
  if (el) el.innerHTML = `<span style="color:var(--text-dim)">Validating ${id}…</span>`;
  try {
    const result = await API('/worldvalidator/run-zone', 'POST', { zoneId: id });
    lastValidatorReport = result;
    renderValidatorResults(result);
  } catch (err) {
    if (el) el.innerHTML = `<span style="color:var(--danger)">Error: ${err.message}</span>`;
  }
}

const ISSUE_LABELS = {
  null_dest:            'Null destination',
  self_loop:            'Self-loop',
  missing_dest:         'Missing destination',
  duplicate_dest:       'Duplicate destination',
  building_no_entrance:      'Building: no world-map entrance',
  building_entrance_broken:  'Building: exterior zone has no exit to this building',
  orphaned_entity:           'Orphaned entity (zone deleted)',
  orphaned_room:             'Orphaned room (map deleted)',
};

function renderValidatorResults(r) {
  const el = document.getElementById('validator-results');
  if (!el) return;
  if (r.error) { el.innerHTML = `<span style="color:var(--danger)">${r.error}</span>`; return; }

  const s = r.summary;
  const ok = s.totalIssues === 0;
  const summaryColor = ok ? 'var(--success)' : 'var(--warning)';

  let html = `<div style="margin-bottom:14px;padding:12px;background:var(--bg3);border-radius:6px">
    <div style="font-size:15px;font-weight:600;color:${summaryColor};margin-bottom:6px">
      ${ok ? '✓ No issues found' : `⚠ ${s.totalIssues} issue${s.totalIssues !== 1 ? 's' : ''} found`}
    </div>
    <div style="color:var(--text-dim);font-size:12px;display:flex;gap:20px;flex-wrap:wrap">
      <span>Zones scanned: <strong>${r.zonesScanned}</strong></span>
      <span>Exits scanned: <strong>${r.exitsScanned}</strong></span>
      <span>Auto-repaired: <strong>${r.totalRepairs}</strong></span>
    </div>`;

  if (!ok) {
    html += `<div style="margin-top:8px;font-size:12px;color:var(--text-dim);display:flex;gap:16px;flex-wrap:wrap">`;
    for (const [type, count] of Object.entries(s.byType)) {
      html += `<span>${ISSUE_LABELS[type] || type}: <strong>${count}</strong></span>`;
    }
    html += `</div>`;
  }
  html += `</div>`;

  const orphans = r.issues.filter(i => i.type === 'orphaned_entity');
  window._pendingOrphans = orphans.map(o => ({ table: o.entityTable, refId: o.refId }));
  if (orphans.length > 0) {
    html += `<div style="margin-bottom:8px;display:flex;align-items:center;gap:10px">
      <strong style="color:var(--warning);font-size:13px">Orphaned entities (${orphans.length})</strong>
      <button class="action-btn danger" onclick="deleteAllOrphans(window._pendingOrphans)">Delete All Orphans</button>
    </div>`;
  }

  if (r.issues.length > 0) {
    html += `<table><thead><tr>
      <th>Zone / Ref</th><th>Table / Dir</th><th>Destination</th><th>Issue</th><th>Status</th>
    </tr></thead><tbody>`;
    for (const issue of r.issues) {
      const status = issue.repaired
        ? `<span style="color:var(--success)">Auto-repaired</span>`
        : `<span style="color:var(--warning)">Manual review</span>`;
      if (issue.type === 'orphaned_entity') {
        const entityId = `${issue.entityTable}:${issue.refId}`;
        const isStaged = pendingChanges.some(c => c.entityType === 'orphan_cleanup' && c.entityId === entityId);
        const actionCell = isStaged
          ? `<span style="color:var(--danger);font-size:11px">⚠ Marked for Deletion</span>`
          : `<span style="color:var(--warning)">Manual review</span><button class="action-btn danger" style="margin-left:6px" onclick="deleteOrphan('${issue.entityTable}','${issue.refId}')">Delete</button>`;
        html += `<tr>
          <td><code>${issue.refId}</code></td>
          <td>${issue.entityTable}</td>
          <td>—</td>
          <td>${ISSUE_LABELS[issue.type]}</td>
          <td>${actionCell}</td>
        </tr>`;
      } else {
        html += `<tr>
          <td><code>${issue.zoneId}</code></td>
          <td>${issue.dir ?? '—'}</td>
          <td>${issue.destId ? `<code>${issue.destId}</code>` : '—'}</td>
          <td>${ISSUE_LABELS[issue.type] || issue.type}</td>
          <td>${status}</td>
        </tr>`;
      }
    }
    html += `</tbody></table>`;
  }

  if (r.needsManualReview?.length > 0) {
    html += `<div style="margin-top:12px;padding:10px;background:var(--bg3);border-radius:6px;font-size:12px">
      <strong style="color:var(--warning)">Needs manual review:</strong>
      <div style="margin-top:4px;color:var(--text-dim)">${r.needsManualReview.map(id => `<code>${id}</code>`).join(', ')}</div>
    </div>`;
  }

  el.innerHTML = html;
}

async function deleteOrphan(table, refId) {
  const entityId = `${table}:${refId}`;
  const result = await API('/staging/stage', 'POST', {
    entityType: 'orphan_cleanup',
    entityId,
    entityName: `${table} (zone: ${refId})`,
    changeType: 'delete',
    method: 'DELETE',
    apiPath: '/worldvalidator/delete-orphan',
    requestBody: { table, refId },
    description: `Delete orphaned ${table} records referencing non-existent zone ${refId}`,
  });
  if (result?.error) { toast(result.error, true); return; }
  toast('Marked for deletion — publish to apply');
  await updateStagingBadge();
  if (lastValidatorReport) renderValidatorResults(lastValidatorReport);
}

async function deleteAllOrphans(orphans) {
  if (!confirm(`Stage deletion of all ${orphans.length} orphaned records for publishing?`)) return;
  for (const { table, refId } of orphans) {
    const entityId = `${table}:${refId}`;
    await API('/staging/stage', 'POST', {
      entityType: 'orphan_cleanup',
      entityId,
      entityName: `${table} (zone: ${refId})`,
      changeType: 'delete',
      method: 'DELETE',
      apiPath: '/worldvalidator/delete-orphan',
      requestBody: { table, refId },
      description: `Delete orphaned ${table} records referencing non-existent zone ${refId}`,
    });
  }
  toast(`${orphans.length} orphan${orphans.length !== 1 ? 's' : ''} marked for deletion — publish to apply`);
  await updateStagingBadge();
  if (lastValidatorReport) renderValidatorResults(lastValidatorReport);
}

async function runMapGeometryValidation() {
  const el = document.getElementById('validator-map-results');
  if (el) el.innerHTML = '<span style="color:var(--text-dim)">Scanning maps…</span>';
  const mapsData = await API('/maps').catch(() => null);
  const maps = Array.isArray(mapsData) ? mapsData : [];
  const allErrors = [], allOneWay = [], zoneNames = new Map();
  // Collect all zone IDs across all maps first so cross-map exits aren't flagged as dangling.
  const allMapData = [];
  for (const map of maps) {
    const data = await API(`/maps/${map.id}`);
    if (data?.error || !data?.zones) continue;
    allMapData.push({ map, data });
    for (const z of data.zones || []) zoneNames.set(z.id, z.name);
  }
  const knownZoneIds = new Set(zoneNames.keys());
  for (const { map, data } of allMapData) {
    const zonesMap = new Map((data.zones || []).map(z => [z.id, { ...z, exits: z.exits || {} }]));
    const interiorZoneIds = new Set([
      ...(data.unplacedInterior || []).map(z => z.id),
      ...(data.children || []).map(c => c.entry_zone_id).filter(Boolean),
      ...(data.buildingZoneIds || []),
      data.map?.parent_zone_id,
    ].filter(Boolean));
    const { errors, oneWay } = validateMapOverview(zonesMap, knownZoneIds, interiorZoneIds);
    errors.forEach(e => {
      const cellOccupied = e.reason === 'geometry' && [...zonesMap.values()].some(z =>
        z.grid_x === e.expectedX && z.grid_y === e.expectedY && (z.grid_z ?? 0) === e.expectedZ);
      allErrors.push({ ...e, mapId: map.id, mapName: map.name, cellOccupied });
    });
    oneWay.forEach(w => allOneWay.push({ ...w, mapId: map.id, mapName: map.name }));
  }
  if (el) el.innerHTML = renderValidatorMapResults(allErrors, allOneWay, zoneNames);
}

function renderValidatorMapResults(errors, oneWay, zoneNames) {
  const nameOf = id => zoneNames.get(id) || id;
  if (!errors.length && !oneWay.length) return '<div style="color:var(--accent2)">✓ No map geometry issues found.</div>';
  let html = '';
  if (errors.length) {
    html += `<div style="color:var(--red);font-weight:600;margin-bottom:6px">${errors.length} geometry error(s):</div>`;
    html += errors.map(e => {
      const del = `<button class="action-btn danger" style="font-size:10px;padding:1px 7px;flex-shrink:0" onclick="vFixRemoveExit('${e.zoneId}','${e.direction}')">Delete exit</button>`;
      if (e.reason === 'dangling') return `<div class="v-error" style="display:flex;align-items:center;gap:8px;margin-top:3px"><span>• [${e.mapName}] ${nameOf(e.zoneId)} → ${e.direction} → <em>${e.targetId}</em> (zone not found)</span>${del}</div>`;
      if (e.reason === 'unplaced-target') return `<div class="v-error" style="display:flex;align-items:center;gap:8px;margin-top:3px"><span>• [${e.mapName}] ${nameOf(e.zoneId)} → ${e.direction} → ${nameOf(e.targetId)} (target has no map position)</span>${del}</div>`;
      return `<div class="v-error" style="display:flex;align-items:center;gap:8px;margin-top:3px">
        <span>• [${e.mapName}] ${nameOf(e.zoneId)} → ${e.direction} → ${nameOf(e.targetId)} (expected at ${e.expectedX},${e.expectedY},${e.expectedZ})</span>
        ${!e.cellOccupied ? `<button class="action-btn" style="font-size:10px;padding:1px 7px;flex-shrink:0" onclick="vFixGeometry('${e.targetId}',${e.expectedX},${e.expectedY},${e.expectedZ},'${e.mapId}')">Move here</button>` : `<span style="font-size:10px;color:var(--text-dim);flex-shrink:0">(cell occupied)</span>`}
        ${del}
      </div>`;
    }).join('');
  }
  if (oneWay.length) {
    html += `<div style="color:var(--yellow);font-weight:600;margin-top:10px;margin-bottom:6px">${oneWay.length} one-way connection(s):</div>`;
    html += oneWay.map(w => {
      const opp = MAP_OPP[w.direction];
      return `<div class="v-warn" style="display:flex;align-items:center;gap:8px;margin-top:3px">
        <span>• [${w.mapName}] ${nameOf(w.zoneId)} → ${w.direction} → ${nameOf(w.targetId)} (no ${opp} return)</span>
        <button class="action-btn" style="font-size:10px;padding:1px 7px;flex-shrink:0" onclick="vFixAddReciprocal('${w.targetId}','${opp}','${w.zoneId}')">Add ${opp} return</button>
        <button class="action-btn danger" style="font-size:10px;padding:1px 7px;flex-shrink:0" onclick="vFixRemoveExit('${w.zoneId}','${w.direction}')">Delete exit</button>
      </div>`;
    }).join('');
  }
  return html;
}

async function vFixRemoveExit(zoneId, dir) {
  const z = await API(`/zones/${zoneId}`);
  if (z?.error) { toast(z.error, true); return; }
  const exits = { ...z.exits }; delete exits[dir];
  const r = await API(`/zones/${zoneId}`, 'PUT', { exits });
  if (r?.error) { toast(r.error, true); return; }
  updateStagingBadge(); toast('Exit removed');
  runMapGeometryValidation();
}

async function vFixAddReciprocal(zoneId, dir, targetId) {
  const z = await API(`/zones/${zoneId}`);
  if (z?.error) { toast(z.error, true); return; }
  const exits = { ...z.exits, [dir]: targetId };
  const r = await API(`/zones/${zoneId}`, 'PUT', { exits });
  if (r?.error) { toast(r.error, true); return; }
  updateStagingBadge(); toast('Reciprocal exit added');
  runMapGeometryValidation();
}

async function vFixGeometry(zoneId, x, y, z, mapId) {
  const zone = await API(`/zones/${zoneId}`);
  if (zone?.error) { toast(zone.error, true); return; }
  const r = await API(`/zones/${zoneId}`, 'PUT', { grid_x: x, grid_y: y, grid_z: z, map_id: mapId, exits: zone.exits });
  if (r?.error) { toast(r.error, true); return; }
  updateStagingBadge(); toast('Zone moved to correct position');
  runMapGeometryValidation();
}

// --- Item integrity validation ---
// Detection runs client-side against the globally-loaded TAG_CATALOG (like Map
// Geometry above). Resolutions route through the normal staged API: a Fix is a
// full-object PUT to /items/:id (auto-staged as an item update); a Remove stages
// an item delete. Both land in the Changes panel to publish.

let _itemIssues = [];
const _itemIssuesById = new Map();

const _isNum = n => typeof n === 'number' && !Number.isNaN(n);

function _fmtBad(v) {
  if (v === null || v === undefined) return 'null';
  if (v === '') return 'empty';
  return `"${v}"`;
}

function deriveItemName(id) {
  const base = String(id || 'item').replace(/^item_/, '').replace(/_/g, ' ').trim();
  return base ? base.replace(/\b\w/g, c => c.toUpperCase()) : String(id);
}

// Returns a human string if the tag value is malformed for its shape, else null.
function tagValueError(def, v) {
  switch (def.shape) {
    case 'flag':    return v === true ? null : 'should be a flag';
    case 'int':     return Number.isInteger(v) ? null : 'should be an integer';
    case 'text':    return typeof v === 'string' ? null : 'should be text';
    case 'enum':    return (def.options || []).includes(v) ? null : `is not one of ${(def.options || []).join('/')}`;
    case 'range':   return (v && typeof v === 'object' && _isNum(v.min) && _isNum(v.max)) ? null : 'is missing min/max';
    case 'hot':     return (v && typeof v === 'object' && _isNum(v.amount) && _isNum(v.duration_seconds)) ? null : 'is missing amount/duration';
    case 'statmap': return (v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(_isNum)) ? null : 'has non-numeric values';
    default:        return null;
  }
}

// Validate one item row. Returns null if clean, else { id, name, problems, fixedItem, fixable }.
function validateItem(item) {
  const problems = [];
  let name = item.name, weight = item.weight, value = item.value;
  const tagsIsObject = item.tags && typeof item.tags === 'object' && !Array.isArray(item.tags);
  let nameFixable = true;

  if (name === null || name === undefined || String(name).trim() === '') {
    name = deriveItemName(item.id);
    nameFixable = /[a-z]/i.test(name);
    problems.push({ msg: 'Name is missing', fix: nameFixable ? `set to "${name}"` : 'no safe default — remove' });
  }
  if (weight === null || weight === undefined || !(Number(weight) > 0)) {
    problems.push({ msg: `Weight is ${_fmtBad(weight)}`, fix: 'set to 1000g' });
    weight = 1000;
  }
  if (value === null || value === undefined || Number.isNaN(Number(value)) || Number(value) < 0) {
    problems.push({ msg: `Value is ${_fmtBad(value)}`, fix: 'set to 0' });
    value = 0;
  }
  if (item.tags !== null && item.tags !== undefined && !tagsIsObject) {
    problems.push({ msg: 'Tags is not a valid object', fix: 'reset to empty' });
  }

  // Own-tag scan: drop unknown or malformed authored tags. Supertag members are
  // preserved by re-materializing with the item's existing __super keys.
  const rawTags = tagsIsObject ? item.tags : {};
  const own = itemOwnTags(rawTags);
  const supers = itemSuperKeys(rawTags);
  const cleanedOwn = { ...own };
  for (const [k, v] of Object.entries(own)) {
    if (k === 'description') continue;
    const def = TAG_CATALOG[k];
    if (!def) {
      problems.push({ msg: `Unknown tag "${k}"`, fix: 'remove tag' });
      delete cleanedOwn[k];
      continue;
    }
    const err = tagValueError(def, v);
    if (err) {
      problems.push({ msg: `Tag "${k}" ${err}`, fix: 'remove tag' });
      delete cleanedOwn[k];
    }
  }

  if (!problems.length) return null;
  return {
    id: item.id,
    name: item.name || item.id,
    problems,
    fixable: nameFixable,
    fixedItem: { id: item.id, name, type: item.type || null, weight, value, tags: cleanedOwn, supertags: supers },
  };
}

async function runItemValidation() {
  const el = document.getElementById('validator-item-results');
  if (el) el.innerHTML = '<span style="color:var(--text-dim)">Scanning items…</span>';
  const itemsData = await API('/items').catch(() => null);
  const items = Array.isArray(itemsData) ? itemsData : [];
  _itemIssues = items.map(validateItem).filter(Boolean);
  _itemIssuesById.clear();
  for (const r of _itemIssues) _itemIssuesById.set(r.id, r);
  if (el) el.innerHTML = renderItemValidatorResults(items.length);
}

function renderItemValidatorResults(scanned) {
  if (!_itemIssues.length) {
    return `<div style="color:var(--accent2)">✓ No item integrity issues found (${scanned} scanned).</div>`;
  }
  let html = `<div style="margin-bottom:10px;color:var(--warning);font-weight:600">${_itemIssues.length} item${_itemIssues.length !== 1 ? 's' : ''} with issues (${scanned} scanned)</div>`;
  html += `<div style="border-top:1px solid var(--border)">`;
  for (const r of _itemIssues) {
    const problemList = r.problems.map(p => `<div>• ${p.msg} — <span style="color:var(--text-dim)">${p.fix}</span></div>`).join('');
    html += `
      <div class="item-issue-row" style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
        <input type="checkbox" class="item-issue-cb" data-id="${r.id}" checked style="margin-top:3px;accent-color:var(--accent)">
        <div style="flex:1;min-width:0">
          <div style="margin-bottom:3px"><code>${r.id}</code> <span style="color:var(--text)">${r.name}</span></div>
          <div style="font-size:11px;color:var(--text)">${problemList}</div>
        </div>
        <select class="item-issue-mode" style="background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:11px;padding:3px 6px;border-radius:2px;outline:none">
          <option value="fix"${r.fixable ? '' : ' disabled'}>Fix</option>
          <option value="remove"${r.fixable ? '' : ' selected'}>Remove</option>
        </select>
      </div>`;
  }
  html += `</div>
    <div style="display:flex;gap:8px;margin-top:12px;align-items:center">
      <button class="action-btn" onclick="selectAllItemIssues(true)">Select All</button>
      <button class="action-btn" onclick="selectAllItemIssues(false)">Select None</button>
      <button class="action-btn success" onclick="resolveSelectedItemIssues()">Resolve Selected</button>
      <span style="font-size:11px;color:var(--text-dim)">Fixes stage as changes — publish to apply.</span>
    </div>`;
  return html;
}

function selectAllItemIssues(checked) {
  document.querySelectorAll('.item-issue-cb').forEach(el => { el.checked = checked; });
}

async function resolveSelectedItemIssues() {
  const rows = [...document.querySelectorAll('.item-issue-row')].filter(row => row.querySelector('.item-issue-cb')?.checked);
  if (!rows.length) { toast('Select at least one item', true); return; }
  let staged = 0;
  for (const row of rows) {
    const id = row.querySelector('.item-issue-cb').dataset.id;
    const mode = row.querySelector('.item-issue-mode')?.value || 'fix';
    const rec = _itemIssuesById.get(id);
    if (!rec) continue;
    if (mode === 'remove') {
      const res = await API('/staging/stage', 'POST', {
        entityType: 'item', entityId: id, entityName: rec.name, changeType: 'delete',
        method: 'DELETE', apiPath: `/items/${id}`, requestBody: {},
        description: `Delete broken item ${id}`,
      });
      if (res?.error) { toast(res.error, true); continue; }
    } else {
      const res = await API(`/items/${id}`, 'PUT', rec.fixedItem);
      if (res?.error) { toast(res.error, true); continue; }
    }
    staged++;
  }
  toast(`${staged} item resolution${staged !== 1 ? 's' : ''} staged — publish to apply`);
  await updateStagingBadge();
  runItemValidation();
}

function exportValidatorReport() {
  if (!lastValidatorReport) { toast('Run a validation first', true); return; }
  const blob = new Blob([JSON.stringify(lastValidatorReport, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `zone-validator-${Date.now()}.json`; a.click();
  URL.revokeObjectURL(url);
}

// Toast
