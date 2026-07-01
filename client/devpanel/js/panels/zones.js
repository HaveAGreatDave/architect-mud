function renderZonesTable(records) {
  const panel = document.getElementById('list-panel');
  if (!records.length) { panel.innerHTML = '<div style="padding:24px;color:var(--text-dim)">No records found.</div>'; return; }

  const byId = new Map(records.map(z => [z.id, z]));
  const childrenByParent = new Map();
  const childIds = new Set();

  // Group interior/apartment zones under their parent building.
  // Primary: look at building zone exits pointing to interior zones (authoritative).
  for (const z of records) {
    if (!z.flags?.is_building) continue;
    for (const exitZoneId of Object.values(z.exits || {})) {
      const exitZone = byId.get(exitZoneId);
      if (exitZone?.flags?.is_interior || exitZone?.flags?.is_apartment) {
        if (!childrenByParent.has(z.id)) childrenByParent.set(z.id, []);
        if (!childIds.has(exitZoneId)) {
          childrenByParent.get(z.id).push(exitZone);
          childIds.add(exitZoneId);
        }
      }
    }
  }
  // Fallback: apartment zones that weren't matched above — use their first exit as parent.
  for (const z of records) {
    if (childIds.has(z.id) || !z.flags?.is_apartment) continue;
    const parentId = Object.values(z.exits || {})[0];
    if (parentId && byId.has(parentId)) {
      if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
      childrenByParent.get(parentId).push(z);
      childIds.add(z.id);
    }
  }

  let topLevel = records.filter(z => !childIds.has(z.id));
  if (sortState.key) {
    topLevel = [...topLevel].sort((a, b) => {
      let av = a[sortState.key], bv = b[sortState.key];
      if (av == null) av = '';
      if (bv == null) bv = '';
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sortState.dir;
      return String(av).localeCompare(String(bv)) * sortState.dir;
    });
  }

  const columns = PANELS.zones.columns;
  const hasStagedRows = records.some(r => r._stagingStatus);
  let html = `<div style="padding:10px 12px"><button class="action-btn" onclick="openBigMap()">🗺 View Big Map</button></div>`;
  html += '<table><thead><tr>';
  for (const col of columns) {
    const isSorted = sortState.key === col.key;
    const arrow = isSorted ? (sortState.dir === 1 ? ' ▲' : ' ▼') : '';
    html += `<th class="sortable-col${isSorted?' sorted':''}" onclick="sortTableBy('${col.key}')">${col.label}${arrow}</th>`;
  }
  if (hasStagedRows) html += '<th>Status</th>';
  html += '<th></th></tr></thead><tbody>';

  const stagingBadge = s => {
    if (!s) return '';
    if (s === 'pending delete') return `<span style="color:var(--danger);font-size:11px">!Marked for Deletion</span>`;
    return `<span style="color:var(--warning);font-size:11px">!Not Published</span>`;
  };

  const renderRow = (rec, isChild, hasKids, collapsed) => {
    const isPendingDelete = rec._stagingStatus === 'pending delete';
    const rowStyle = isPendingDelete
      ? 'cursor:pointer;opacity:0.6;text-decoration:line-through'
      : rec._stagingStatus ? 'cursor:pointer;border-left:3px solid var(--warning)' : 'cursor:pointer';
    let row = `<tr class="${isChild ? 'zone-child-row' : ''}" style="${rowStyle}" onclick="editRecord('${rec.id}')">`;
    columns.forEach((col, i) => {
      const raw = rec[col.key];
      let val = col.render ? col.render(raw) : (raw ?? '—');
      if (i === 0 && isChild) val = `<span class="zone-child-indent">↳</span>${val}`;
      if (i === 0 && hasKids) {
        val = `<span class="zone-collapse-toggle" title="${collapsed ? 'Expand' : 'Collapse'} rooms" onclick="event.stopPropagation();toggleBuildingCollapse('${rec.id}')">${collapsed ? '+' : '−'}</span>${val}`;
      }
      row += `<td>${val}</td>`;
    });
    if (hasStagedRows) row += `<td>${stagingBadge(rec._stagingStatus)}</td>`;
    row += `<td style="white-space:nowrap">
      <button class="action-btn" onclick="event.stopPropagation();editRecord('${rec.id}')">Edit</button>
      <button class="action-btn" style="margin-left:3px" onclick="event.stopPropagation();cloneZoneRow('${rec.id}')">Clone</button>
      ${isPendingDelete ? '' : `<button class="action-btn danger" style="margin-left:3px" onclick="event.stopPropagation();deleteZoneRow('${rec.id}')">Delete</button>`}
    </td>`;
    row += '</tr>';
    return row;
  };

  for (const rec of topLevel) {
    const kids = childrenByParent.get(rec.id);
    const collapsed = collapsedBuildings.has(rec.id);
    html += renderRow(rec, false, !!kids, collapsed);
    if (kids && !collapsed) {
      kids.sort((a, b) => String(a.name).localeCompare(String(b.name)));
      for (const kid of kids) html += renderRow(kid, true, false, false);
    }
  }
  html += '</tbody></table>';
  panel.innerHTML = html;
}

async function deleteZoneRow(id) {
  const rec = allRecords.find(r => r.id === id);
  if (!rec) return;
  const children = allRecords.filter(z => (z.flags?.is_apartment || z.flags?.is_interior) && Object.values(z.exits || {})[0] === id);
  const childCount = children.length;
  const msg = childCount
    ? `Delete ${rec.name || id}? This will also queue ${childCount} attached room${childCount > 1 ? 's' : ''} for deletion.`
    : `Delete ${rec.name || id}?`;
  if (!confirm(msg)) return;
  currentRecord = rec;
  const result = await API(`/zones/${id}`, 'DELETE');
  if (result?.error) { currentRecord = null; toast(result.error, true); return; }
  for (const child of children) {
    currentRecord = child;
    await API(`/zones/${child.id}`, 'DELETE');
  }
  currentRecord = null;
  if (result?.staged) {
    toast(childCount
      ? `${rec.name || id} + ${childCount} room${childCount !== 1 ? 's' : ''} marked for deletion — publish to apply`
      : 'Marked for deletion — publish to apply');
    await updateStagingBadge();
  } else {
    toast(result?.message || 'Deleted');
  }
  await loadPanel('zones');
}

function cloneZoneRow(id) {
  const src = allRecords.find(r => r.id === id);
  if (!src) return;
  currentRecord = null;
  openEdit({ ...src, id: '', name: `${src.name} (copy)` }, true);
}

const BUILDING_TYPES = [
  { id: 'hotel', label: 'Hotel / Bar' },
  { id: 'apartment', label: 'Apartment Building' },
  { id: 'clinic', label: 'Clinic' },
  { id: 'store', label: 'Convenience Store' },
  { id: 'warehouse', label: 'Warehouse' },
  { id: 'powerplant', label: 'Power Plant' },
];

// Caches the currently-open zone's NPCs/furniture so quick-edit buttons
// can look records up by id. Deliberately NOT embedding full records (with
// free-text names/descriptions) into onclick attributes — an apostrophe in
// a name or description would prematurely close the attribute and break
// the page.
let zoneEditNpcsCache = [];
let zoneEditAllNpcsCache = [];
let zoneEditFurnitureCache = [];
let zoneEditSpawnsCache = [];
let zoneEditAllEnemiesCache = [];
let zoneEditCurrentZoneId = null;
let zoneEditExitsState = {};

async function zoneEditForm(rec, isNew) {
  const exits = rec.exits || {};
  const ambients = Array.isArray(rec.ambient_events) ? rec.ambient_events : [];
  const flags = rec.flags || {};
  zoneEditExitsState = { ...exits };
  // New zones created by clicking an empty cell on the Maps overview arrive
  // with a pending grid placement; existing zones use the in-memory map state
  // so unsaved drag positions are reflected immediately. Fall back to server
  // data if not on the maps panel.
  const mapZone = mapOverview?.zones.get(rec?.id);
  const place = (isNew && pendingZonePlacement)
    ? { ...pendingZonePlacement }
    : mapZone
      ? { map_id: mapZone.map_id, grid_x: mapZone.grid_x, grid_y: mapZone.grid_y, grid_z: mapZone.grid_z ?? 0 }
      : { map_id: rec.map_id, grid_x: rec.grid_x, grid_y: rec.grid_y, grid_z: rec.grid_z };
  pendingZonePlacement = null;

  const audioSongs = await API('/audio/songs').catch(() => []);

  let subSectionsHtml = '<div class="zone-subsection-note">Save this zone first to add rooms, NPCs, furniture, or a generator.</div>';
  if (!isNew) {
    const isExterior = !flags.is_interior && !flags.is_apartment && !flags.is_building;
    const [npcsData, furnitureData, generatorsData, apartmentsData, zonePowerInfo, spawnsData, enemiesData, liveEnemiesData, doorsData] = await Promise.all([
      API('/npcs').catch(() => []),
      API('/furniture').catch(() => []),
      API('/environment/power/generators').catch(() => []),
      flags.is_apartment ? API('/apartments').catch(() => []) : Promise.resolve([]),
      isExterior ? API(`/environment/power/zones/${encodeURIComponent(rec.id)}`).catch(() => null) : Promise.resolve(null),
      API(`/zones/${encodeURIComponent(rec.id)}/spawns`).catch(() => []),
      API('/enemies').catch(() => []),
      API(`/zones/${encodeURIComponent(rec.id)}/live-enemies`).catch(() => []),
      API(`/zones/${encodeURIComponent(rec.id)}/doors`).catch(() => []),
    ]);
    const zoneDoors = Array.isArray(doorsData) ? doorsData : [];
    const zoneNpcs = (Array.isArray(npcsData) ? npcsData : []).filter(n => n.zone_id === rec.id);
    const zoneSpawns = Array.isArray(spawnsData) ? spawnsData : [];
    const zoneLiveEnemies = Array.isArray(liveEnemiesData) ? liveEnemiesData : [];
    const allEnemies = Array.isArray(enemiesData) ? enemiesData : [];
    const allFurniture = Array.isArray(furnitureData) ? furnitureData : [];
    if (allFurniture.length) _furnitureAllItems = allFurniture; // populate cache for clone dropdown
    const zoneFurniture = allFurniture.filter(f => f.zone_id === rec.id);
    const allGens = Array.isArray(generatorsData) ? generatorsData : [];
    const zoneGenerator = allGens.find(g => g.zone_id === rec.id) || null;
    // For building entrance zones, find any JB installed in the interior network
    const buildingJB = flags.is_building && !zoneGenerator ? (() => {
      const visited = new Set();
      const bfsQ = [rec.id];
      while (bfsQ.length) {
        const cur = bfsQ.shift();
        const curZ = allRecords.find(z => z.id === cur);
        if (!curZ) continue;
        for (const nId of Object.values(curZ.exits || {})) {
          if (visited.has(nId)) continue;
          const n = allRecords.find(z => z.id === nId);
          if (n && (n.flags?.is_interior || n.flags?.is_apartment)) {
            visited.add(nId);
            bfsQ.push(nId);
          }
        }
      }
      return allGens.find(g => g.generator_type === 'junction_box' && visited.has(g.zone_id)) || null;
    })() : null;
    const upId = zoneEditExitsState['up'], downId = zoneEditExitsState['down'];
    const upZone = upId ? allRecords.find(z => z.id === upId) : null;
    const downZone = downId ? allRecords.find(z => z.id === downId) : null;
    const genAbove = upId ? allGens.find(g => g.zone_id === upId) : null;
    const genBelow = downId ? allGens.find(g => g.zone_id === downId) : null;
    const upIsInterior = !!(upZone?.flags?.is_interior || upZone?.flags?.is_building);
    const downIsInterior = !!(downZone?.flags?.is_interior || downZone?.flags?.is_building);
    const canRoof = !upId || (upIsInterior && !genAbove);
    const canBasement = !downId || (downIsInterior && !genBelow);
    const apartmentRecord = (Array.isArray(apartmentsData) ? apartmentsData : []).find(a => a.zone_id === rec.id) || null;
    zoneEditNpcsCache = zoneNpcs;
    zoneEditAllNpcsCache = Array.isArray(npcsData) ? npcsData : [];
    zoneEditFurnitureCache = zoneFurniture;
    zoneEditSpawnsCache = zoneSpawns;
    zoneEditAllEnemiesCache = allEnemies;
    zoneEditCurrentZoneId = rec.id;
    const childRooms = allRecords.filter(z =>
      (z.flags?.is_apartment || z.flags?.is_interior) &&
      Object.values(z.exits || {})[0] === rec.id
    );
    const isExteriorZone = !flags.is_interior && !flags.is_apartment && !flags.is_building;
    const freeDirs = (isExteriorZone ? ['in','out','up','down'] : ['north','south','east','west','up','down','in','out']).filter(d => !zoneEditExitsState[d]);

    const _dUsedDirs = new Set(zoneDoors.map(d => d.exit_dir));
    const _dAvailExits = Object.keys(zoneEditExitsState).filter(d => zoneEditExitsState[d] && !_dUsedDirs.has(d));
    subSectionsHtml = `
      <div class="zone-subsection">
        <div class="zone-subsection-header">Doors <span class="zone-subsection-count" id="zone-doors-count">${zoneDoors.length}</span></div>
        <div id="zone-doors-list">${zoneDoors.length ? zoneDoors.map(d => {
          const dTagObj = (d.tags && !Array.isArray(d.tags)) ? d.tags : {};
          const dLockKey = Object.keys(dTagObj).find(k => k.startsWith('lock:'));
          const dLockTag = dLockKey ? { type: dLockKey, ...dTagObj[dLockKey] } : null;
          const dLockLabel = dLockTag
            ? (dLockTag.type === 'lock:keycardlock' ? `keycardlock${d.lock_state === 'locked' ? ' 🔒' : ''}` : `hololock diff:${dLockTag.difficulty}${d.lock_state === 'locked' ? ' 🔒' : ''}`)
            : 'no lock';
          const dIdSafe = d.id.replace(/'/g, "\\'");
          return `<div class="zone-subitem-row" id="door-row-${d.id}">
            <span style="display:flex;align-items:center;gap:6px"><strong>${d.name || d.id}</strong> <span style="color:var(--text-dim);font-size:11px">${d.door_type} · ${d.exit_dir||'?'} · ${d.hp}/${d.hp_max}HP · ${dLockLabel}</span></span>
            <span class="zone-subitem-actions">
              <button class="action-btn" onclick="openEditDoorDialog('${dIdSafe}','${rec.id}')" style="padding:2px 8px;font-size:11px">Edit</button>
              <button class="action-btn danger" onclick="deleteDoorQuick('${dIdSafe}','${rec.id}')" style="padding:2px 8px;font-size:14px;font-weight:bold">−</button>
            </span>
          </div>`;
        }).join('') : '<div class="zone-subitem-empty">No doors here.</div>'}</div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:6px">
          <select id="door-type-select" style="flex:1;min-width:100px">
            <option value="basic">Basic (1000 HP)</option>
            <option value="shoddy">Shoddy (300 HP)</option>
            <option value="blast">Blast Door (5000 HP)</option>
          </select>
          <select id="door-exit-select" style="flex:1;min-width:100px">
            ${_dAvailExits.length ? _dAvailExits.map(d => `<option value="${d}">${d}</option>`).join('') : '<option value="">No free exits</option>'}
          </select>
          <button class="action-btn success" onclick='submitAddDoor(${JSON.stringify(rec.id)})'>Install Door</button>
        </div>
      </div>

      <div class="zone-subsection">
        <div class="zone-subsection-header">Rooms <span class="zone-subsection-count">${childRooms.length}</span></div>
        <div id="zone-rooms-list">${childRooms.length ? childRooms.map(r => `
          <div class="zone-subitem-row">
            <span>${r.name}</span>
            <span class="zone-subitem-actions">
              <button class="action-btn" onclick="editRecord('${r.id}')">Edit</button>
              <button class="action-btn danger" onclick="deleteRoomQuick('${r.id}','${rec.id}')">Delete</button>
            </span>
          </div>`).join('') : '<div class="zone-subitem-empty">No rooms yet.</div>'}</div>
        <div id="zone-add-room-form"></div>
        ${freeDirs.length
          ? `<button class="action-btn success" style="margin-top:6px" onclick='openAddRoomForm(${JSON.stringify(rec.id)}, ${JSON.stringify(freeDirs)}, ${isExteriorZone})'>+ Add Building</button>`
          : `<div class="zone-subitem-empty">All directions are already in use — free one up in Exits above to add another building.</div>`}
      </div>

      <div class="zone-subsection">
        <div class="zone-subsection-header">NPCs <span class="zone-subsection-count">${zoneNpcs.length}</span></div>
        <div id="zone-npcs-list">${zoneNpcs.length ? zoneNpcs.map(n => `
          <div class="zone-subitem-row" id="npc-row-${n.id}">
            <span>${n.name}</span>
            <span class="zone-subitem-actions">
              <button class="action-btn" onclick="openEditNpcQuick('${n.id}')">Edit</button>
              <button class="action-btn danger" onclick="deleteNpcQuick('${n.id}','${rec.id}')">Delete</button>
            </span>
          </div>`).join('') : '<div class="zone-subitem-empty">No NPCs here.</div>'}</div>
        <div id="zone-add-npc-form"></div>
        <div style="display:flex;gap:6px;margin-top:6px">
          <button class="action-btn success" onclick='openAddNpcForm(${JSON.stringify(rec.id)})'>+ New NPC</button>
          <button class="action-btn" onclick='openAddExistingNpcForm(${JSON.stringify(rec.id)})'>+ Add Existing</button>
        </div>
      </div>

      <div class="zone-subsection">
        <div class="zone-subsection-header">Spawn Item</div>
        <div style="display:flex;gap:6px;align-items:center;padding-top:4px;flex-wrap:wrap">
          <input id="spawn-item-id" placeholder="item_id" style="flex:1;min-width:120px;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:4px 8px;outline:none">
          <input id="spawn-qty" type="number" value="1" min="1" style="width:52px;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:4px;outline:none;text-align:center">
          <button class="action-btn success" onclick="spawnItemInZone('${rec.id}')">Spawn</button>
        </div>
        <div id="spawn-feedback" style="font-size:11px;margin-top:4px;color:var(--text-dim);min-height:14px"></div>
      </div>

      <div class="zone-subsection">
        <div class="zone-subsection-header">Enemies <span class="zone-subsection-count">${zoneSpawns.length}</span></div>
        <div id="zone-enemies-list">${renderEnemyRows(zoneSpawns, zoneLiveEnemies, rec.id)}</div>
        <div id="zone-add-spawn-form"></div>
        <div style="display:flex;gap:6px;margin-top:6px">
          <button class="action-btn success" onclick='openAddSpawnForm(${JSON.stringify(rec.id)})'>+ Add Enemy</button>
          <button class="action-btn" style="margin-left:auto" onclick='respawnAllZoneEnemies(${JSON.stringify(rec.id)})'>Respawn All</button>
          <button class="action-btn danger" onclick='despawnAllZoneEnemies(${JSON.stringify(rec.id)})'>Despawn All</button>
          <button class="action-btn danger" onclick='deleteAllZoneSpawns(${JSON.stringify(rec.id)})'>Delete All</button>
        </div>
      </div>

      <div class="zone-subsection">
        <div class="zone-subsection-header">Furniture <span class="zone-subsection-count">${zoneFurniture.length}</span></div>
        <div id="zone-furniture-list">${zoneFurniture.length ? zoneFurniture.map(f => `
          <div class="zone-subitem-row" id="furniture-row-${f.id}">
            <span>${f.name}</span>
            <span class="zone-subitem-actions">
              <button class="action-btn" onclick="openEditFurnitureQuick('${f.id}')">Edit</button>
              <button class="action-btn danger" onclick="deleteFurnitureQuick('${f.id}','${rec.id}')">Delete</button>
            </span>
          </div>`).join('') : '<div class="zone-subitem-empty">No furniture here.</div>'}</div>
        <div id="zone-add-furniture-form"></div>
        <button class="action-btn success" style="margin-top:6px" onclick='openAddFurnitureForm(${JSON.stringify(rec.id)})'>+ Add Furniture</button>
      </div>

      <div class="zone-subsection">
        <div class="zone-subsection-header">Generator</div>
        ${(() => {
          const cityGens = allGens.filter(g => g.generator_type === 'city_plant');

          // Zone already has a generator installed here
          if (zoneGenerator) {
            const jbId = zoneGenerator.id.replace(/'/g, "\\'");
            const cityGenDropdown = zoneGenerator.generator_type === 'junction_box' && cityGens.length
              ? `<div class="field-row" style="margin-top:8px">
                  <div class="field"><label>City Plant</label>
                    <select id="jb-city-gen-select">
                      <option value="">— None —</option>
                      ${cityGens.map(g => `<option value="${g.id}" ${g.id === zoneGenerator.city_generator_id ? 'selected' : ''}>${g.name || g.id} (${Number(g.capacity_kw).toFixed(0)}W)</option>`).join('')}
                    </select>
                  </div>
                  <div class="field" style="display:flex;align-items:flex-end">
                    <button class="action-btn" onclick="setJunctionBoxCityGen('${jbId}','${rec.id}')">Assign</button>
                  </div>
                </div>`
              : '';
            return `
              <div class="zone-subitem-row">
                <span>${zoneGenerator.name || zoneGenerator.id} — <span class="text-dim">${zoneGenerator.generator_type === 'city_plant' ? 'City Plant' : 'Junction Box'}, ${Number(zoneGenerator.capacity_kw).toFixed(1)}W, ${zoneGenerator.status}</span></span>
                <span class="zone-subitem-actions">
                  <button class="action-btn danger" onclick="removeGeneratorQuick('${jbId}','${rec.id}')">Remove</button>
                </span>
              </div>
              <div class="zone-subsection-note">Routes power from the connected city plant to every interior zone in this building (or, for a city plant, every outdoor zone on the map).</div>
              ${cityGenDropdown}`;
          }

          // Building zone — show connected JB if found, or the install form
          if (flags.is_building) {
            // Show existing JB in the building's interior network
            if (buildingJB) {
              const jbIdSafe = buildingJB.id.replace(/'/g, "\\'");
              const jbZone = allRecords.find(z => z.id === buildingJB.zone_id);
              const cityGenDropdown = cityGens.length
                ? `<div class="field-row" style="margin-top:8px">
                    <div class="field"><label>City Plant</label>
                      <select id="jb-city-gen-select">
                        <option value="">— None —</option>
                        ${cityGens.map(g => `<option value="${g.id}" ${g.id === buildingJB.city_generator_id ? 'selected' : ''}>${g.name || g.id} (${Number(g.capacity_kw).toFixed(0)}W)</option>`).join('')}
                      </select>
                    </div>
                    <div class="field" style="display:flex;align-items:flex-end">
                      <button class="action-btn" onclick="setJunctionBoxCityGen('${jbIdSafe}','${rec.id}')">Assign</button>
                    </div>
                  </div>`
                : '';
              return `
                <div class="zone-subitem-row">
                  <span>${buildingJB.name || buildingJB.id} — <span class="text-dim">Junction Box in ${jbZone?.name || buildingJB.zone_id}, ${Number(buildingJB.capacity_kw).toFixed(1)}W, ${buildingJB.status}</span></span>
                  <span class="zone-subitem-actions">
                    <button class="action-btn danger" onclick="removeGeneratorQuick('${jbIdSafe}','${rec.id}')">Remove</button>
                  </span>
                </div>
                <div class="zone-subsection-note">Routes power from the connected city plant to every interior zone in this building.</div>
                ${cityGenDropdown}`;
            }

            // No JB found — show install form with z-level picker
            const jbZoneIds = new Set(allGens.filter(g => g.generator_type === 'junction_box').map(g => g.zone_id));
            const buildingZ = rec.grid_z ?? 0;
            const interiorNetwork = [];
            const visitedSet = new Set();
            const bfsQueue = [rec.id];
            while (bfsQueue.length) {
              const cur = bfsQueue.shift();
              const curZone = allRecords.find(z => z.id === cur);
              if (!curZone) continue;
              for (const nId of Object.values(curZone.exits || {})) {
                if (visitedSet.has(nId)) continue;
                const neighbor = allRecords.find(z => z.id === nId);
                if (neighbor && (neighbor.flags?.is_interior || neighbor.flags?.is_apartment)) {
                  visitedSet.add(nId);
                  interiorNetwork.push(neighbor);
                  bfsQueue.push(nId);
                }
              }
            }
            const byZ = new Map();
            for (const iz of interiorNetwork) {
              const zl = iz.grid_z ?? 0;
              if (!byZ.has(zl)) byZ.set(zl, iz);
            }
            // Always include z+1 and z-1 as new-floor options if not already present
            if (!byZ.has(buildingZ + 1)) byZ.set(buildingZ + 1, null);
            if (!byZ.has(buildingZ - 1)) byZ.set(buildingZ - 1, null);
            const sortedZ = [...byZ.entries()].sort(([a], [b]) => b - a);
            const cpSelect = cityGens.length
              ? `<div class="field"><label>City Plant</label><select id="gen-install-city-gen"><option value="">Auto (nearest)</option>${cityGens.map(g => `<option value="${g.id}">${g.name || g.id}</option>`).join('')}</select></div>`
              : '';
            return `
              <div class="zone-subitem-empty">No junction box installed here.</div>
              <div class="zone-subsection-note" style="margin-bottom:8px">Choose a floor to install in. Existing rooms are reused; new floors create a new room.</div>
              <div class="field-row" style="margin-top:6px">
                <div class="field"><label>Floor</label>
                  <select id="gen-install-location" onchange="document.getElementById('gen-new-floor-row').style.display=(this.value==='new'||this.value.startsWith('new:'))?'flex':'none'">
                    ${sortedZ.map(([zl, iz]) => {
                      if (!iz) return `<option value="new:${zl}">Z:${zl} — New floor</option>`;
                      const hasJB = jbZoneIds.has(iz.id);
                      return hasJB
                        ? `<option value="" disabled>Z:${zl} — ${iz.name} (junction box exists)</option>`
                        : `<option value="existing:${iz.id}:${zl}">Z:${zl} — ${iz.name}</option>`;
                    }).join('')}
                    <option value="new">New floor (custom z-level)</option>
                  </select>
                </div>
                <div class="field"><label>Throughput (W)</label><input type="number" id="gen-install-capacity" placeholder="auto (100)"></div>
              </div>
              <div class="field-row" id="gen-new-floor-row" style="display:none">
                <div class="field"><label>Z-level</label><input type="number" id="gen-install-zlevel-num" value="${buildingZ + 1}"></div>
                <div class="field"><label>Room Name</label><input id="gen-install-zonename" placeholder="${rec.name || ''} Roof"></div>
              </div>
              <div class="field"><label>Junction Box Name (optional)</label><input id="gen-install-name" placeholder="${rec.name || ''} Junction Box"></div>
              ${cpSelect}
              <button class="action-btn success" onclick='installGeneratorQuick(${JSON.stringify(rec.id)})'>Install Junction Box</button>`;
          }

          // Exterior zone — show city plant info + install option
          if (!flags.is_interior && !flags.is_apartment) {
            const powerStatus = zonePowerInfo
              ? `<div class="zone-subitem-row">
                  <span>Served by <strong>${zonePowerInfo.generator_name || zonePowerInfo.generator_id || 'Unknown'}</strong> — <span class="text-dim">${(zonePowerInfo.available_kw ?? 0).toFixed(1)}/${Number(zonePowerInfo.max_capacity_kw ?? 1000).toFixed(1)}W available, ${zonePowerInfo.status}</span></span>
                </div>
                ${cityGens.length > 1 ? `<div class="field-row" style="margin-top:8px">
                  <div class="field"><label>Reassign to generator</label>
                    <select id="zone-gen-reassign-select">
                      ${cityGens.map(g => `<option value="${g.id}" ${g.id === zonePowerInfo.generator_id ? 'selected' : ''}>${g.name || g.id} (${Number(g.capacity_kw).toFixed(0)}W)</option>`).join('')}
                    </select>
                  </div>
                  <div class="field" style="display:flex;align-items:flex-end">
                    <button class="action-btn" onclick="reassignZoneGenerator('${rec.id}')">Reassign</button>
                  </div>
                </div>` : ''}`
              : `<div class="zone-subitem-empty">No power zone record — not connected to the city grid. Use Fix Zone Connections in the Power tab.</div>`;
            return `
              ${powerStatus}
              <div class="zone-subsection-note" style="margin-bottom:8px;margin-top:6px">Install a new City Power Plant at this location.</div>
              <div class="field-row" style="margin-top:6px">
                <div class="field"><label>Capacity (W)</label><input type="number" id="gen-install-capacity" placeholder="auto (500000)"></div>
              </div>
              <div class="field"><label>Name (optional)</label><input id="gen-install-name" placeholder="${rec.name || ''} Power Plant"></div>
              <button class="action-btn success" onclick='installGeneratorQuick(${JSON.stringify(rec.id)})'>Install City Power Plant</button>`;
          }

          // Interior zone with no junction box yet
          const existingJBs = allGens.filter(g => g.generator_type === 'junction_box');
          const jbAssignDropdown = existingJBs.length
            ? `<div class="zone-subsection-note" style="margin-top:8px">Assign to an existing junction box:</div>
               <div class="field-row" style="margin-top:4px">
                 <div class="field"><label>Junction Box</label>
                   <select id="assign-jb-select">
                     <option value="">— Select —</option>
                     ${existingJBs.map(g => `<option value="${g.id}">${g.name || g.id} (${Number(g.capacity_kw).toFixed(0)}W)</option>`).join('')}
                   </select>
                 </div>
                 <div class="field" style="display:flex;align-items:flex-end">
                   <button class="action-btn" onclick='assignRoomToJB(${JSON.stringify(rec.id)})'>Assign</button>
                 </div>
               </div>
               <div class="zone-subsection-note" style="margin:6px 0 4px">— or install a new one —</div>`
            : '';
          const cpSelect = cityGens.length
            ? `<div class="field"><label>City Plant</label><select id="gen-install-city-gen"><option value="">Auto (nearest)</option>${cityGens.map(g => `<option value="${g.id}">${g.name || g.id}</option>`).join('')}</select></div>`
            : '';
          return `
            <div class="zone-subitem-empty">No junction box installed here.</div>
            ${jbAssignDropdown}
            <div class="field-row" style="margin-top:6px">
              <div class="field"><label>Throughput (W)</label><input type="number" id="gen-install-capacity" placeholder="auto (100)"></div>
            </div>
            ${cpSelect}
            <div class="field"><label>Name (optional)</label><input id="gen-install-name" placeholder="${rec.name || ''} Junction Box"></div>
            <button class="action-btn success" onclick='installGeneratorQuick(${JSON.stringify(rec.id)})'>Install Junction Box</button>`;
        })()}
      </div>

      ${flags.is_apartment ? `
      <div class="zone-subsection">
        <div class="zone-subsection-header">Apartment Details</div>
        ${apartmentRecord ? `
          <div class="field"><label>Owner</label><input value="${apartmentRecord.owner_handle || 'unowned'}" readonly style="opacity:0.6"></div>
          <div class="field-row">
            <div class="checkbox-field"><input type="checkbox" id="f-apt-locked" ${apartmentRecord.is_locked?'checked':''}><label>Locked</label></div>
            <div class="field"><label>Lock Difficulty</label><input type="number" id="f-apt-lock-difficulty" value="${apartmentRecord.lock_difficulty}" min="1" max="10"></div>
          </div>
          <div class="field"><label>Rent (credits)</label><input type="number" id="f-apt-rent" value="${apartmentRecord.rent_cost}" min="0"></div>
          <button class="action-btn success" onclick='saveApartmentDetailsQuick(${JSON.stringify(rec.id)})'>Save Apartment Details</button>
        ` : `<div class="zone-subitem-empty">Save this zone once more to register its apartment record.</div>`}
      </div>
      ` : ''}
    `;
  }

  return `
    <div class="field"><label>Zone ID</label><input id="f-id" value="${isNew ? '' : rec.id}" ${!isNew ? 'readonly style="opacity:0.5"' : ''}></div>
    <div class="field"><label>Name</label><input id="f-name" value="${rec.name || ''}" ${isNew ? 'oninput="autoFillId(this)"' : ''}></div>
    <div class="field"><label>Description</label><textarea id="f-description" rows="5">${rec.description || ''}</textarea></div>
    <div class="field-row">
      <div class="field"><label>Danger Rating</label>
        <select id="f-danger_rating">
          ${['safe','low','medium','high','lethal'].map(d => `<option ${rec.danger_rating===d?'selected':''}>${d}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Radiation Level</label><input type="number" id="f-radiation_level" value="${rec.radiation_level||0}" min="0" max="100"></div>
    </div>
    <div class="checkbox-field"><input type="checkbox" id="f-pvp_enabled" ${rec.pvp_enabled?'checked':''}><label>PvP Enabled</label></div>
    <div class="checkbox-field"><input type="checkbox" id="f-is_safe_zone" ${rec.is_safe_zone?'checked':''}><label>Safe Zone (no PvP, anchor point)</label></div>
    <div class="checkbox-field"><input type="checkbox" id="f-is_apartment" ${flags.is_apartment?'checked':''}><label>Rentable Apartment (players can RENT, LOCK, SLEEP here)</label></div>
    <div class="checkbox-field"><input type="checkbox" id="f-is_building" ${flags.is_building?'checked':''} onchange="toggleBuildingFields(this.checked,${JSON.stringify(rec.id)})"><label>Building (appears in a "Buildings:" list and entrance-discovery text on zones that connect to it)</label></div>
    <div id="building-fields" style="display:${flags.is_building?'block':'none'}">
      <div class="field"><label>Building Name (optional — defaults to Zone Name if blank)</label><input id="f-building_name" value="${flags.building_name || ''}" placeholder="${rec.name || ''}"></div>
      <div class="field"><label>Building Type (controls entrance-discovery flavor text)</label>
        <select id="f-building_type">
          <option value="">— none / generic —</option>
          ${BUILDING_TYPES.map(t => `<option value="${t.id}" ${flags.building_type===t.id?'selected':''}>${t.label}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>World Map Exit Zone (exterior zone this building leads back to)</label><select id="f-world_exit_zone"><option value="${flags.world_exit_zone || ''}">Loading exterior zones…</option></select></div>
    </div>
    <div class="checkbox-field"><input type="checkbox" id="f-is_interior" ${flags.is_interior?'checked':''}><label>Interior Room (for hand-built interiors not using Rentable Apartment — e.g. a Kitchen or Bedroom — appears in a "Rooms:" list from other interior zones)</label></div>
    <div class="field-row">
      <div class="field"><label>Map Marker (≤2 chars)</label><input id="f-marker" maxlength="2" value="${rec.marker || ''}" placeholder="e.g. ⌂" oninput="updateColorPreview()"></div>
      <div class="field"><label>Map Color (text)</label>
        <div class="color-swatches">${MAP_PALETTE.map(c => `<span class="color-swatch" style="background:${c}" title="${c}" onclick="setZoneColor('${c}')"></span>`).join('')}<span class="color-swatch" style="background:transparent;border-style:dashed" title="clear" onclick="setZoneColor('')"></span></div>
        <div style="display:flex;gap:4px;align-items:center">
          <input id="f-color" value="${rec.color || ''}" placeholder="#rrggbb (blank = danger color)" oninput="syncColorWheel('f-color','f-color-wheel');updateColorPreview()" style="flex:1">
          <input type="color" id="f-color-wheel" value="${rec.color || '#ffffff'}" oninput="setZoneColor(this.value)" onchange="setZoneColor(this.value)" style="width:28px;height:28px;padding:1px;border:1px solid var(--border);background:var(--bg3);cursor:pointer;flex-shrink:0">
        </div>
      </div>
      <div class="field"><label>Map BG Color</label>
        <div class="color-swatches">${MAP_PALETTE.map(c => `<span class="color-swatch" style="background:${c}" title="${c}" onclick="setBgColor('${c}')"></span>`).join('')}<span class="color-swatch" style="background:transparent;border-style:dashed" title="clear" onclick="setBgColor('')"></span></div>
        <div style="display:flex;gap:4px;align-items:center">
          <input id="f-bg_color" value="${rec.bg_color || ''}" placeholder="#rrggbb (blank = transparent)" oninput="syncColorWheel('f-bg_color','f-bg-wheel');updateColorPreview()" style="flex:1">
          <input type="color" id="f-bg-wheel" value="${rec.bg_color || '#000000'}" oninput="setBgColor(this.value)" onchange="setBgColor(this.value)" style="width:28px;height:28px;padding:1px;border:1px solid var(--border);background:var(--bg3);cursor:pointer;flex-shrink:0">
        </div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:flex-end;padding-bottom:8px;flex-shrink:0">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:4px">Preview</div>
        <span id="color-preview" style="font-family:var(--font);font-size:18px;display:inline-block;width:2.4ch;text-align:center;padding:2px 4px;border:1px solid var(--border);border-radius:2px;color:${rec.color||'var(--text-dim)'};background:${rec.bg_color||'transparent'}">${rec.marker ? (rec.marker.length===1 ? rec.marker+' ' : rec.marker.slice(0,2)) : '○ '}</span>
      </div>
    </div>
    <div class="field"><label>Map Placement</label><input readonly style="opacity:0.6" value="${place.map_id ? `${place.map_id} @ (${place.grid_x ?? '–'}, ${place.grid_y ?? '–'}, ${place.grid_z ?? 0}) — move on the Maps overview` : 'unplaced — position from the Maps overview'}"></div>
    <input type="hidden" id="f-map_id" value="${place.map_id || ''}">
    <input type="hidden" id="f-grid_x" value="${place.grid_x ?? ''}">
    <input type="hidden" id="f-grid_y" value="${place.grid_y ?? ''}">
    <input type="hidden" id="f-grid_z" value="${place.grid_z ?? ''}">
    <div class="field"><label>Exits</label><div id="exits-builder-body">${renderExitsBuilder(rec.id)}</div></div>
    <div class="field"><label>Ambient Theme <span style="color:var(--text-dim);font-weight:400">(global pool fallback theme)</span></label>
      <select id="f-ambient_theme">${AMBIENT_THEMES.map(t=>`<option value="${t}" ${(rec.ambient_theme||'indoors')===t?'selected':''}>${t.charAt(0).toUpperCase()+t.slice(1)}</option>`).join('')}</select>
    </div>
    <div class="field"><label>Audio Theme <span style="color:var(--text-dim);font-weight:400">(procedural music that plays while a player is in this zone — see the Audio panel)</span></label>
      <select id="f-audio_theme_id">
        <option value="">— None —</option>
        ${(Array.isArray(audioSongs) ? audioSongs : []).map(s => `<option value="${s.id}" ${rec.audio_theme_id===s.id?'selected':''}>${s.name}</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>Ambient Events (JSON array of strings)</label><textarea id="f-ambient_events" rows="6">${JSON.stringify(ambients, null, 2)}</textarea></div>
    ${rec.id ? `
    <div class="field" style="border-top:1px solid var(--border);padding-top:14px;margin-top:4px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <label style="margin:0">Windows</label>
        <button type="button" class="action-btn" style="font-size:11px;padding:3px 10px" onclick="zoneWindowAdd('${rec.id}')">+ Window</button>
      </div>
      <div id="zone-windows-list" style="min-height:24px"></div>
    </div>` : `<div class="field" style="color:var(--text-dim);font-size:11px;font-style:italic">Save this zone first to add windows.</div>`}
    ${subSectionsHtml}
  `;
}

function toggleBuildingFields(show, zoneId) {
  const el = document.getElementById('building-fields');
  if (el) el.style.display = show ? 'block' : 'none';
  if (show) {
    // Auto-detect the exterior zone that has an exit pointing to this building.
    let defaultExterior = document.getElementById('f-world_exit_zone')?.value || '';
    if (!defaultExterior && zoneId) {
      const exteriorZone = (Array.isArray(allRecords) ? allRecords : []).find(z =>
        !z.flags?.is_interior && !z.flags?.is_building && !z.flags?.is_apartment &&
        z.exits && Object.values(z.exits).includes(zoneId)
      );
      if (exteriorZone) defaultExterior = exteriorZone.id;
    }
    populateWorldZonesDropdown(defaultExterior);
  }
}

let _worldExtZonesCache = null;
async function populateWorldZonesDropdown(selectedId) {
  const sel = document.getElementById('f-world_exit_zone');
  if (!sel) return;
  if (!_worldExtZonesCache) {
    const data = await API('/maps/map_world');
    _worldExtZonesCache = (data?.zones || [])
      .filter(z => !z.flags?.is_interior && !z.flags?.is_apartment && !z.flags?.is_building && z.grid_x != null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  sel.innerHTML = '<option value="">— none —</option>' +
    _worldExtZonesCache.map(z =>
      `<option value="${z.id}"${z.id === selectedId ? ' selected' : ''}>${z.name}</option>`
    ).join('');
}

async function saveZone(existing) {
  const id = document.getElementById('f-id').value.trim() || document.getElementById('f-name').value.trim().toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'');
  const isNew = !existing?.id;
  let ambients;
  try { ambients = JSON.parse(document.getElementById('f-ambient_events').value); } catch { return { error: 'Ambient events: invalid JSON' }; }

  const existingFlags = existing?.flags || {};
  const flags = {
    ...existingFlags,
    is_apartment: document.getElementById('f-is_apartment').checked,
    is_building: document.getElementById('f-is_building').checked,
    building_name: document.getElementById('f-building_name')?.value.trim() || null,
    building_type: document.getElementById('f-building_type')?.value || null,
    world_exit_zone: document.getElementById('f-world_exit_zone')?.value.trim() || null,
    is_interior: document.getElementById('f-is_interior').checked,
  };

  const rawMapId = document.getElementById('f-map_id')?.value;
  const rawGridX = document.getElementById('f-grid_x')?.value;
  const rawGridY = document.getElementById('f-grid_y')?.value;
  const rawGridZ = document.getElementById('f-grid_z')?.value;

  const body = {
    name: document.getElementById('f-name').value,
    description: document.getElementById('f-description').value,
    danger_rating: document.getElementById('f-danger_rating').value,
    radiation_level: parseInt(document.getElementById('f-radiation_level').value)||0,
    pvp_enabled: document.getElementById('f-pvp_enabled').checked,
    is_safe_zone: document.getElementById('f-is_safe_zone').checked,
    exits: { ...zoneEditExitsState }, ambient_events: ambients, ambient_theme: document.getElementById('f-ambient_theme').value, flags,
    audio_theme_id: document.getElementById('f-audio_theme_id').value || null,
    marker: document.getElementById('f-marker').value.trim() || null,
    color: document.getElementById('f-color').value.trim() || null,
    bg_color: document.getElementById('f-bg_color').value.trim() || null,
  };

  if (rawMapId) body.map_id = rawMapId;
  if (rawGridX !== '' && rawGridX != null) body.grid_x = parseInt(rawGridX);
  if (rawGridY !== '' && rawGridY != null) body.grid_y = parseInt(rawGridY);
  if (rawGridZ !== '' && rawGridZ != null) body.grid_z = parseInt(rawGridZ);

  if (isNew) { body.id = id; return API('/zones', 'POST', body); }
  else return API(`/zones/${existing.id}`, 'PUT', body);
}

// --- Zone Editor: Rooms / NPCs / Furniture management ---
// These all operate while staying inside the building's own edit panel —
// no navigating away to a different top-level panel. After any add/edit/
// delete, refreshZoneEditPanel() reloads the zones list (so allRecords is
// current, e.g. a newly-added room shows up) and re-renders the same
// zone's edit form in place.
async function refreshZoneEditPanel(zoneId) {
  await loadPanel('zones');
  currentRecord = allRecords.find(r => r.id === zoneId);
  if (currentRecord) await openEdit(currentRecord, false);
}

// Exits — direction + destination-zone picker instead of hand-edited JSON.
// zoneEditExitsState holds the working set for whichever zone is currently
// open; saveZone() reads from it directly.
function renderExitsBuilder(selfId) {
  const dirs = ['north','south','east','west','up','down','in','out'];
  const freeDirs = dirs.filter(d => !zoneEditExitsState[d]);
  const zoneOptions = allRecords.filter(z => z.id !== selfId)
    .map(z => `<option value="${z.id}">${z.name} (${z.id})</option>`).join('');
  const rows = Object.entries(zoneEditExitsState).map(([dir, targetId]) => {
    const target = allRecords.find(z => z.id === targetId);
    return `<div class="zone-subitem-row">
      <span>${dir} → ${target ? target.name : targetId}</span>
      <span class="zone-subitem-actions"><button class="action-btn danger" onclick="removeExit('${dir}')">Remove</button></span>
    </div>`;
  }).join('') || '<div class="zone-subitem-empty">No exits yet.</div>';
  const addRow = freeDirs.length ? `
    <div class="zone-inline-form" style="margin-top:6px">
      <div class="field-row">
        <div class="field"><label>Direction</label><select id="exit-add-dir">${freeDirs.map(d=>`<option>${d}</option>`).join('')}</select></div>
        <div class="field"><label>Destination Zone</label><select id="exit-add-zone"><option value="">— select —</option>${zoneOptions}</select></div>
      </div>
      <button class="action-btn success" onclick='addExit(${JSON.stringify(selfId)})'>+ Add Exit</button>
    </div>` : '<div class="zone-subitem-empty">All directions are already in use.</div>';
  return `<div id="exits-list">${rows}</div>${addRow}`;
}

function addExit(selfId) {
  const dir = document.getElementById('exit-add-dir').value;
  const zoneId = document.getElementById('exit-add-zone').value;
  if (!zoneId) { toast('Pick a destination zone first', true); return; }
  zoneEditExitsState[dir] = zoneId;
  document.getElementById('exits-builder-body').innerHTML = renderExitsBuilder(selfId);
}

function removeExit(dir) {
  delete zoneEditExitsState[dir];
  document.getElementById('exits-builder-body').innerHTML = renderExitsBuilder(currentRecord?.id || '');
}

// Generators
async function installGeneratorQuick(zoneId) {
  const rec = allRecords.find(r => r.id === zoneId);
  const flags = rec?.flags || {};

  if (flags.is_building) {
    await _installBuildingGenerator(zoneId, rec);
    return;
  }

  // Exterior (no interior/apartment flags) → city_plant; anything else → junction_box
  const generatorType = (!flags.is_interior && !flags.is_apartment) ? 'city_plant' : 'junction_box';
  const name = document.getElementById('gen-install-name').value.trim();
  const capacityKw = parseInt(document.getElementById('gen-install-capacity').value) || undefined;
  const cityGeneratorId = document.getElementById('gen-install-city-gen')?.value || undefined;
  const result = await API('/environment/power/install', 'POST', { zoneId, generatorType, name: name || undefined, capacityKw, cityGeneratorId });
  if (result?.error) { toast(result.error, true); return; }
  toast(`Generator installed — powering ${result.poweredZones?.length || 0} zone(s)`);
  await refreshZoneEditPanel(zoneId);
}

async function _installBuildingGenerator(zoneId, rec) {
  const selection = document.getElementById('gen-install-location')?.value;
  if (!selection) { toast('Select a floor to install the junction box in.', true); return; }

  const genName    = document.getElementById('gen-install-name')?.value.trim();
  const capacityKw = parseInt(document.getElementById('gen-install-capacity')?.value) || undefined;
  const cityGeneratorId = document.getElementById('gen-install-city-gen')?.value || undefined;
  let targetZoneId;

  if (selection.startsWith('existing:')) {
    // Format: "existing:<zoneId>:<z-level>"
    targetZoneId = selection.split(':')[1];
  } else if (selection === 'new' || selection.startsWith('new:')) {
    const prefilledZ = selection.startsWith('new:') ? parseInt(selection.split(':')[1]) : NaN;
    const newZ = isNaN(prefilledZ) ? parseInt(document.getElementById('gen-install-zlevel-num')?.value) : prefilledZ;
    if (isNaN(newZ)) { toast('Enter a valid z-level number.', true); return; }
    const currentZ = rec.grid_z ?? 0;
    const exitDir  = newZ > currentZ ? 'up' : newZ < currentZ ? 'down' : 'in';
    const returnDir = newZ > currentZ ? 'down' : newZ < currentZ ? 'up' : 'out';

    if ((rec.exits || {})[exitDir]) {
      toast(`The "${exitDir}" exit is already occupied — choose a different z-level.`, true);
      return;
    }

    const defaultName = `${rec.name || zoneId} ${newZ > currentZ ? 'Roof' : 'Basement'}`;
    const zoneName = document.getElementById('gen-install-zonename')?.value.trim() || defaultName;
    const newZoneId = `${zoneId}_z${newZ}_${Date.now()}`;

    // Use directAPI — the power install step runs immediately (not staged), so the
    // new zone must exist live before we wire exits and attach the junction box.
    const createResult = await directAPI('/zones', 'POST', {
      id: newZoneId, name: zoneName,
      description: `${newZ > currentZ ? 'Rooftop' : 'Basement'} of ${rec.name || zoneId}.`,
      danger_rating: rec.danger_rating || 'medium',
      pvp_enabled: false, is_safe_zone: false,
      exits: { [returnDir]: zoneId },
      ambient_events: [], ambient_theme: 'indoors',
      flags: { is_interior: true },
      map_id: rec.map_id || null,
      grid_x: rec.grid_x ?? 0, grid_y: rec.grid_y ?? 0, grid_z: newZ,
    });
    if (createResult.error) { toast(`Failed to create floor zone: ${createResult.error}`, true); return; }
    targetZoneId = newZoneId;

    const exitResult = await directAPI(`/zones/${zoneId}`, 'PUT', { exits: { ...(rec.exits || {}), [exitDir]: newZoneId } });
    if (exitResult.error) toast(`Zone created but exit wiring failed: ${exitResult.error}`, true);
  } else {
    toast('Select a valid floor.', true); return;
  }

  const targetZone = allRecords.find(z => z.id === targetZoneId);
  const fallbackName = targetZone?.name || `${rec.name || zoneId} Junction Box`;
  const genResult = await API('/environment/power/install', 'POST', {
    zoneId: targetZoneId, generatorType: 'junction_box',
    name: genName || fallbackName, capacityKw, cityGeneratorId,
  });
  if (genResult?.error) { toast(`Junction box install failed: ${genResult.error}`, true); return; }
  toast(`Junction box installed — powering ${genResult.poweredZones?.length || 0} zone(s)`);
  await refreshZoneEditPanel(zoneId);
}

async function reassignZoneGenerator(zoneId) {
  const select = document.getElementById('zone-gen-reassign-select');
  if (!select) return;
  const generatorId = select.value;
  const result = await API(`/environment/power/zones/${encodeURIComponent(zoneId)}/reassign`, 'POST', { generatorId });
  if (result?.error) { toast(result.error, true); return; }
  toast(`Reassigned to ${result.generatorName || generatorId}`);
  await refreshZoneEditPanel(zoneId);
}

async function removeGeneratorQuick(generatorId, zoneId) {
  if (!confirm('Remove this generator? Stage for deletion — publish to apply.')) return;
  const result = await API('/staging/stage', 'POST', {
    entityType: 'generator',
    entityId: generatorId,
    entityName: `Generator ${generatorId}`,
    changeType: 'delete',
    method: 'DELETE',
    apiPath: `/environment/power/generators/${generatorId}`,
    requestBody: {},
    description: `Remove generator ${generatorId} from zone ${zoneId}`,
  });
  if (result?.error) { toast(result.error, true); return; }
  toast('Generator marked for removal — publish to apply');
  await updateStagingBadge();
  await refreshZoneEditPanel(zoneId);
}

// Apartment details (replaces the old standalone Apartments tab)
async function saveApartmentDetailsQuick(zoneId) {
  const body = {
    is_locked: document.getElementById('f-apt-locked').checked,
    lock_difficulty: parseInt(document.getElementById('f-apt-lock-difficulty').value) || 1,
    rent_cost: parseInt(document.getElementById('f-apt-rent').value) || 0,
  };
  const result = await API(`/apartments/${zoneId}`, 'PUT', body);
  if (result?.error) { toast(result.error, true); return; }
  toast('Apartment details saved');
  await refreshZoneEditPanel(zoneId);
}

// Rooms
function syncColorWheel(fieldId, wheelId) {
  const field = document.getElementById(fieldId);
  const wheel = document.getElementById(wheelId);
  if (!field || !wheel) return;
  const v = field.value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) wheel.value = v;
}
function setZoneColor(c) {
  const el = document.getElementById('f-color');
  if (el) { el.value = c; syncColorWheel('f-color','f-color-wheel'); updateColorPreview(); }
}
function setBgColor(c) {
  const el = document.getElementById('f-bg_color');
  if (el) { el.value = c; syncColorWheel('f-bg_color','f-bg-wheel'); updateColorPreview(); }
}
function updateColorPreview() {
  const el = document.getElementById('color-preview');
  if (!el) return;
  const color = document.getElementById('f-color')?.value || '';
  const bgColor = document.getElementById('f-bg_color')?.value || '';
  const marker = document.getElementById('f-marker')?.value || '';
  const sym = marker.length === 1 ? marker + ' ' : (marker.length >= 2 ? marker.slice(0,2) : '○ ');
  el.style.color = color || 'var(--text-dim)';
  el.style.background = bgColor || 'transparent';
  el.textContent = sym;
  _liveMapColorUpdate();
}

// Map layout edits (piece moves, connections) persist immediately through the
// staging-aware API() — each change lands in the Changes panel for review and
// publish. There is no separate map-publish step, so nothing to guard.
