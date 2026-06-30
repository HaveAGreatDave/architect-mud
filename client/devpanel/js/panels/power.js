let powerPanelGenerators = [];
let powerPanelMode = 'power';
let powerPanelView = 'city';   // 'city' | 'interior'
let powerPanelBuilding = null; // selected building zone id for interior view
let powerPanelAllZones = [];   // full zone list (for building interior search)
let powerPanelInteriorZ = 0;  // current floor for interior map view

async function renderPowerPanel(zones) {
  const [powerMap, generators, allZones] = await Promise.all([
    API('/environment/power/map').catch(() => []),
    API('/environment/power/generators').catch(() => []),
    API('/zones').catch(() => []),
  ]);
  bigMapZones = Array.isArray(zones) ? zones : [];
  bigMapPowerData = Array.isArray(powerMap) ? powerMap : [];
  powerPanelGenerators = Array.isArray(generators) ? generators : [];
  bigMapGenerators = powerPanelGenerators;
  powerPanelAllZones = Array.isArray(allZones) ? allZones : [];
  powerJbByOutdoor = _buildJbByOutdoor();
  powerPanelMode = 'power';
  powerPanelView = 'city';
  renderPowerPanelBody();
}

function setPowerPanelMode(mode) {
  powerPanelMode = mode;
  renderPowerPanelBody();
}

function setPowerPanelView(view) {
  powerPanelView = view;
  renderPowerPanelBody();
}

function setPowerPanelBuilding(zoneId) {
  powerPanelBuilding = zoneId || null;
  powerPanelInteriorZ = 0;
  renderPowerPanelBody();
}

function setPowerPanelInteriorZ(z) {
  powerPanelInteriorZ = z;
  renderPowerPanelBody();
}

function _buildInteriorMapHtml() {
  const buildings = powerPanelAllZones.filter(z => z.flags?.is_building);
  if (!buildings.length) return `<div style="color:var(--text-dim);padding:8px">No buildings found.</div>`;

  const selId = powerPanelBuilding || buildings[0]?.id;
  const buildingDropdown = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
    <label style="font-size:11px;color:var(--text-dim);white-space:nowrap">Building</label>
    <select onchange="setPowerPanelBuilding(this.value)" style="flex:1">
      ${buildings.map(b => `<option value="${b.id}" ${b.id === selId ? 'selected' : ''}>${b.name || b.id}</option>`).join('')}
    </select>
  </div>`;

  const building = buildings.find(b => b.id === selId);
  if (!building) return buildingDropdown;

  // Expand interior network: find all interior/apartment zones that have an exit
  // back into the already-known network (seeded from the building entrance).
  const powerById = new Map(bigMapPowerData.map(p => [p.zoneId, p]));
  const networkIds = new Set([building.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const z of powerPanelAllZones) {
      if (networkIds.has(z.id)) continue;
      if (!(z.flags?.is_interior || z.flags?.is_apartment)) continue;
      if (Object.values(z.exits || {}).some(id => networkIds.has(id))) {
        networkIds.add(z.id);
        changed = true;
      }
    }
  }
  // Keep building entrance in the network so it shows on the grid
  const interiorZones = powerPanelAllZones.filter(z => networkIds.has(z.id));

  if (interiorZones.length === 0) {
    return buildingDropdown + `<div style="color:var(--text-dim);font-size:11px">No interior rooms connected to this building yet.</div>`;
  }

  // Junction box lookup by zone
  const jbByZone = new Map(powerPanelGenerators.filter(g => g.generator_type === 'junction_box').map(g => [g.zone_id, g]));

  // Floor selector
  const placed = interiorZones.filter(z => z.grid_x != null);
  const zLevels = [...new Set(placed.map(z => z.grid_z ?? 0))].sort((a, b) => b - a);
  const currentZ = zLevels.includes(powerPanelInteriorZ) ? powerPanelInteriorZ : (zLevels[0] ?? 0);

  const floorNav = `<div style="display:flex;align-items:center;gap:6px;margin-bottom:10px">
    <span style="font-size:11px;color:var(--text-dim)">Floor</span>
    <button class="action-btn" onclick="setPowerPanelInteriorZ(${currentZ - 1})">▾</button>
    <span style="min-width:60px;text-align:center;font-size:12px">z = ${currentZ}</span>
    <button class="action-btn" onclick="setPowerPanelInteriorZ(${currentZ + 1})">▴</button>
    ${zLevels.length > 1 ? `<span style="font-size:10px;color:var(--text-dim)">(floors: ${zLevels.join(', ')})</span>` : ''}
  </div>`;

  const onFloor = placed.filter(z => (z.grid_z ?? 0) === currentZ);
  if (!onFloor.length) {
    return buildingDropdown + floorNav + `<div style="color:var(--text-dim);font-size:11px">No placed rooms on floor z=${currentZ}.</div>`;
  }

  // Build coordinate grid
  const xs = onFloor.map(z => z.grid_x), ys = onFloor.map(z => z.grid_y);
  const minX = Math.min(...xs) - 1, maxX = Math.max(...xs) + 1;
  const minY = Math.min(...ys) - 1, maxY = Math.max(...ys) + 1;
  const byCoord = new Map(onFloor.map(z => [`${z.grid_x},${z.grid_y}`, z]));

  const W = maxX - minX + 1, H = maxY - minY + 1;
  const colTmpl = Array.from({length: 2*W-1}, (_, i) => i % 2 ? '16px' : '110px').join(' ');
  const rowTmpl = Array.from({length: 2*H-1}, (_, i) => i % 2 ? '16px' : '76px').join(' ');
  const col = x => 2 * (x - minX) + 1;
  const row = y => 2 * (y - minY) + 1;

  const STATUS_CLS = { powered: 'bm-power-powered', overloaded: 'bm-power-overloaded', offline: 'bm-power-offline' };

  let gridHtml = `<div style="overflow:auto"><div style="display:grid;grid-template-columns:${colTmpl};grid-template-rows:${rowTmpl}">`;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const z = byCoord.get(`${x},${y}`);
      const gcs = `grid-column:${col(x)};grid-row:${row(y)}`;
      if (!z) {
        gridHtml += `<div style="${gcs};opacity:0.1" class="bigmap-tile"></div>`;
        continue;
      }
      const pw = powerById.get(z.id);
      const rawStatus = pw?.status || 'unpowered';
      const status = ((pw?.loadKw ?? 0) === 0 && rawStatus !== 'offline') ? 'unpowered' : rawStatus;
      const pwCls = STATUS_CLS[status] || 'bm-power-unpowered';
      const drawReq = pw ? Number(pw.loadKw ?? 0) : 0;
      const supply  = pw ? Number(pw.availableKw ?? 0) : 0;
      const loadStr = drawReq > 0
        ? `${drawReq.toFixed(0)}/${supply.toFixed(0)}W`
        : (pw ? 'idle' : '');
      const jb = jbByZone.get(z.id);
      const jbIcon = jb ? `<span title="${jb.name || 'Junction Box'} — ${jb.status}" style="font-size:11px;margin-right:2px">⚡</span>` : '';
      const isBuildingEntrance = z.flags?.is_building;
      const entranceIcon = isBuildingEntrance ? `<span title="Building entrance" style="font-size:11px;margin-right:2px">🚪</span>` : '';
      const exitDirs = Object.keys(z.exits || {});
      const exHtml = exitDirs.length
        ? `<div class="cell-exits">${exitDirs.map(d => `<span class="${(d==='up'||d==='down') ? 'ex-vert' : ''}">${d==='up' ? '▲' : d==='down' ? '▼' : d[0].toUpperCase()}</span>`).join(' ')}</div>`
        : '';
      gridHtml += `<div class="bigmap-tile ${pwCls}" style="${gcs}" title="${z.name} — ${status}${loadStr ? ' ' + loadStr : ''}${jb ? ' · JB: ' + (jb.name || jb.id) : ''}" onclick="editRecord('${z.id.replace(/'/g, "\\'")}')"><div>${entranceIcon}${jbIcon}${z.name}${exHtml}<div style="font-size:9px;opacity:0.75;margin-top:2px">${status}${loadStr ? ' · ' + loadStr : ''}</div></div></div>`;
    }
  }

  // Connection slots
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      const a = byCoord.get(`${x},${y}`), b = byCoord.get(`${x+1},${y}`);
      const linked = a && b && (a.exits?.east === b.id || b.exits?.west === a.id);
      gridHtml += `<div class="conn conn-h${linked ? ' conn-linked' : ''}" style="grid-column:${col(x)+1};grid-row:${row(y)}">${linked ? '<span class="ln"></span>' : ''}</div>`;
    }
  }
  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const a = byCoord.get(`${x},${y}`), b = byCoord.get(`${x},${y+1}`);
      const linked = a && b && (a.exits?.south === b.id || b.exits?.north === a.id);
      gridHtml += `<div class="conn conn-v${linked ? ' conn-linked' : ''}" style="grid-column:${col(x)};grid-row:${row(y)+1}">${linked ? '<span class="ln"></span>' : ''}</div>`;
    }
  }

  gridHtml += `</div></div>`;

  return buildingDropdown + floorNav + gridHtml + `<div style="margin-top:10px;display:flex;gap:14px;flex-wrap:wrap;font-size:10px;color:var(--text-dim)">${mapLegendHtml('power')}</div>`;
}

function renderPowerPanelBody() {
  const panel = document.getElementById('list-panel');
  const powerById = new Map(bigMapPowerData.map(p => [p.zoneId, p]));

  const tabBar = `<div style="display:flex;gap:8px;margin-bottom:12px">
    <button class="action-btn${powerPanelView === 'city' ? ' primary' : ''}" onclick="setPowerPanelView('city')">⚡ City Grid</button>
    <button class="action-btn${powerPanelView === 'interior' ? ' primary' : ''}" onclick="setPowerPanelView('interior')">🏢 Building Interior</button>
  </div>`;

  let html;
  if (powerPanelView === 'interior') {
    html = `<div style="padding:12px">${tabBar}${_buildInteriorMapHtml()}</div>`;
  } else {
    html = `<div style="padding:12px">
    ${tabBar}
    ${buildDynamicMapGrid(bigMapZones, powerPanelMode, powerById, true)}
    <div style="margin-top:10px;display:flex;gap:14px;flex-wrap:wrap;font-size:10px;color:var(--text-dim)">${mapLegendHtml(powerPanelMode)}</div>
  </div>`;
  }

  html += `<div style="padding:12px">
    <h3 style="color:var(--accent);font-size:12px;letter-spacing:1px;text-transform:uppercase;margin-bottom:10px">Power Tools</h3>
    <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
      <button class="action-btn" onclick="fixZonePowerConnections()">🔌 Fix Zone Connections</button>
      <button class="action-btn" onclick="fixBuildingPowerConnections()">🏢 Fix Building Connections</button>
      <button class="action-btn" onclick="resyncAllLighting()">💡 Resync Lighting</button>
      <button class="action-btn" onclick="forceRecomputePower()">↺ Force Recompute</button>
    </div>
    <div id="power-tool-log" style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:8px;font-size:11px;font-family:monospace;min-height:48px;max-height:200px;overflow-y:auto;color:var(--text-dim)">No tools run yet.</div>
  </div>`;

  html += `<div style="padding:12px"><h3 style="color:var(--accent);font-size:12px;letter-spacing:1px;text-transform:uppercase;margin-bottom:10px">Generators</h3>`;
  if (powerPanelGenerators.length) {
    const cityPlants = powerPanelGenerators.filter(g => g.generator_type === 'city_plant');
    const jbsByCity = new Map();
    const unassignedJBs = [];
    for (const jb of powerPanelGenerators.filter(g => g.generator_type === 'junction_box')) {
      if (jb.city_generator_id) {
        if (!jbsByCity.has(jb.city_generator_id)) jbsByCity.set(jb.city_generator_id, []);
        jbsByCity.get(jb.city_generator_id).push(jb);
      } else {
        unassignedJBs.push(jb);
      }
    }

    html += '<table><thead><tr><th>Name</th><th>Zone / Building</th><th>Generation / Draw</th><th>Status</th><th></th></tr></thead><tbody>';

    for (const cp of cityPlants) {
      const cpIdSafe = cp.id.replace(/'/g, "\\'");
      const used = Number(cp.total_demand_w ?? 0);
      const pct = cp.capacity_kw > 0 ? Math.round((used / cp.capacity_kw) * 100) : 0;
      const cpOn = Number(cp.capacity_kw) > 0;
      const statusCls = cpOn ? 'safe' : 'high';
      html += `<tr style="background:rgba(20,200,100,0.06)">
        <td><strong>⚡ ${cp.name || cp.id}</strong></td>
        <td style="color:var(--text-dim)">${cp.zone_name || cp.zone_id || '—'}</td>
        <td style="white-space:nowrap">${used.toFixed(1)} / ${Number(cp.capacity_kw).toFixed(0)}W <span style="color:var(--text-dim);font-size:10px">(${pct}%)</span></td>
        <td><span class="badge badge-${statusCls}">${cpOn ? 'online' : 'offline'}</span></td>
        <td style="white-space:nowrap">
          <button class="action-btn" onclick="toggleGeneratorPower('${cpIdSafe}')">Toggle</button>
          <button class="action-btn" style="margin-left:3px" onclick="editGeneratorCapacity('${cpIdSafe}', ${cp.capacity_kw})">Edit</button>
          <button class="action-btn" style="margin-left:3px" onclick="viewGeneratorZones('${cpIdSafe}')">Zones</button>
          <button class="action-btn danger" style="margin-left:3px" onclick="removeGeneratorFromPowerPanel('${cpIdSafe}')">Remove</button>
        </td>
      </tr>`;
      for (const jb of (jbsByCity.get(cp.id) || [])) {
        const jbIdSafe = jb.id.replace(/'/g, "\\'");
        const draw = Number(jb.zone_load_w ?? 0);
        const jbOn = Number(jb.capacity_kw) > 0;
        const jbStatusCls = jbOn ? 'safe' : 'high';
        html += `<tr>
          <td style="padding-left:22px;color:var(--text-dim)">↳ ${jb.name || jb.id}</td>
          <td style="color:var(--text-dim);font-size:11px">${jb.zone_name || jb.zone_id || '—'}</td>
          <td style="white-space:nowrap">${draw.toFixed(1)}W draw</td>
          <td><span class="badge badge-${jbStatusCls}">${jbOn ? 'online' : 'offline'}</span></td>
          <td style="white-space:nowrap">
            <button class="action-btn" onclick="toggleGeneratorPower('${jbIdSafe}')">Toggle</button>
            <button class="action-btn" style="margin-left:3px" onclick="editGeneratorCapacity('${jbIdSafe}', ${jb.capacity_kw})">Edit</button>
            <button class="action-btn" style="margin-left:3px" onclick="viewGeneratorZones('${jbIdSafe}')">Zones</button>
            <button class="action-btn danger" style="margin-left:3px" onclick="removeGeneratorFromPowerPanel('${jbIdSafe}')">Remove</button>
          </td>
        </tr>`;
      }
    }

    if (unassignedJBs.length) {
      html += `<tr><td colspan="5" style="color:var(--warning);font-size:11px;padding-top:8px">⚠ Unassigned junction boxes (no city plant linked):</td></tr>`;
      for (const jb of unassignedJBs) {
        const jbIdSafe = jb.id.replace(/'/g, "\\'");
        const draw = Number(jb.zone_load_w ?? 0);
        html += `<tr>
          <td style="padding-left:10px">${jb.name || jb.id}</td>
          <td style="color:var(--text-dim);font-size:11px">${jb.zone_name || jb.zone_id || '—'}</td>
          <td>${draw.toFixed(1)}W draw</td>
          <td><span class="badge badge-${Number(jb.capacity_kw) > 0 ? 'safe' : 'high'}">${Number(jb.capacity_kw) > 0 ? 'online' : 'offline'}</span></td>
          <td style="white-space:nowrap">
            <button class="action-btn" onclick="toggleGeneratorPower('${jbIdSafe}')">Toggle</button>
            <button class="action-btn" style="margin-left:3px" onclick="editGeneratorCapacity('${jbIdSafe}', ${jb.capacity_kw})">Edit</button>
            <button class="action-btn danger" style="margin-left:3px" onclick="removeGeneratorFromPowerPanel('${jbIdSafe}')">Remove</button>
          </td>
        </tr>`;
      }
    }

    html += '</tbody></table>';
  } else {
    html += `<div style="color:var(--text-dim)">No generators installed yet — install one from a zone's editor.</div>`;
  }
  html += '</div>';

  panel.innerHTML = html;
}

function powerToolLog(lines) {
  const el = document.getElementById('power-tool-log');
  if (el) el.innerHTML = lines.map(l => `<div>${l}</div>`).join('');
}

async function fixZonePowerConnections() {
  powerToolLog(['⏳ Checking zone power connections...']);
  const result = await API('/environment/power/fix-zones', 'POST').catch(e => ({ error: e.message }));
  if (result?.error) { powerToolLog([`❌ Error: ${result.error}`]); return; }
  const lines = [];
  if (!result.connected.length) {
    lines.push('✅ All outdoor zones are already connected to power.');
  } else {
    lines.push(`✅ Connected ${result.connected.length} zone(s) to power:`);
    for (const z of result.connected) {
      lines.push(`&nbsp;&nbsp;• ${z.zoneName} → ${z.generatorName}`);
    }
  }
  await _refreshPowerMapData();
  renderPowerPanelBody();
  powerToolLog(lines);
}

async function fixBuildingPowerConnections() {
  powerToolLog(['⏳ Checking building power connections...']);
  const result = await API('/environment/power/fix-buildings', 'POST').catch(e => ({ error: e.message }));
  if (result?.error) { powerToolLog([`❌ Error: ${result.error}`]); return; }
  const lines = [];
  if (result.connected.length) {
    lines.push(`✅ Connected ${result.connected.length} building(s):`);
    for (const b of result.connected) {
      lines.push(`&nbsp;&nbsp;• ${b.buildingName} → ${b.generatorName} (${b.zonesCount} zone(s) fixed)`);
    }
  }
  if (result.needsGenerator.length) {
    for (const b of result.needsGenerator) {
      lines.push(`⚠️ ${b.buildingName} has no junction box — install one from the building zone's editor`);
    }
  }
  if (result.multipleGenerators.length) {
    for (const b of result.multipleGenerators) {
      lines.push(`❌ ${b.buildingName}: multiple generators — ${b.generators.join(', ')}`);
    }
  }
  if (!lines.length) lines.push('✅ All buildings already correctly connected.');
  powerToolLog(lines);
  if (result.connected.length) {
    await _refreshPowerMapData();
    renderPowerPanelBody();
    powerToolLog(lines);
  }
}

async function resyncAllLighting() {
  powerToolLog(['⏳ Resyncing lighting states from furniture...']);
  const result = await API('/environment/power/resync-lighting', 'POST').catch(e => ({ error: e.message }));
  if (result?.error) { powerToolLog([`❌ Error: ${result.error}`]); return; }
  await _refreshPowerMapData();
  renderPowerPanelBody();
  powerToolLog([`✅ Lighting resynced for ${result.fixed} zone(s). Overhead lights should now register correctly.`]);
}

async function forceRecomputePower() {
  powerToolLog(['⏳ Recomputing power network...']);
  const result = await API('/environment/power/recompute', 'POST').catch(e => ({ error: e.message }));
  if (result?.error) { powerToolLog([`❌ Error: ${result.error}`]); return; }
  await _refreshPowerMapData();
  const lines = [`✅ Power network recomputed. ${bigMapPowerData.length} zone(s) in grid.`];
  renderPowerPanelBody();
  powerToolLog(lines);
}

async function _refreshPowerMapData() {
  const [powerMap, generators] = await Promise.all([
    API('/environment/power/map').catch(() => []),
    API('/environment/power/generators').catch(() => []),
  ]);
  bigMapPowerData = Array.isArray(powerMap) ? powerMap : [];
  powerPanelGenerators = Array.isArray(generators) ? generators : [];
  bigMapGenerators = powerPanelGenerators;
  powerJbByOutdoor = _buildJbByOutdoor();
}

// Build a map: outdoor zone id → [junction box generators] for those JBs whose
// building entrance is accessible via that outdoor zone's exits (or vice versa).
function _buildJbByOutdoor() {
  const result = new Map();
  for (const jb of powerPanelGenerators) {
    if (jb.generator_type !== 'junction_box') continue;
    // BFS forward from JB's zone through interior/apartment zones to find building entrance
    const seen = new Set([jb.zone_id]);
    const queue = [jb.zone_id];
    let entrance = null;
    outer: while (queue.length) {
      const cur = queue.shift();
      const curZ = powerPanelAllZones.find(z => z.id === cur);
      if (!curZ) continue;
      for (const exitId of Object.values(curZ.exits || {})) {
        if (seen.has(exitId)) continue;
        seen.add(exitId);
        const neighbor = powerPanelAllZones.find(z => z.id === exitId);
        if (!neighbor) continue;
        if (neighbor.flags?.is_building) { entrance = neighbor; break outer; }
        if (neighbor.flags?.is_interior || neighbor.flags?.is_apartment) queue.push(exitId);
      }
    }
    if (!entrance) continue;
    // Find outdoor world-map zones connected to this building entrance
    const addJb = ozId => {
      if (!result.has(ozId)) result.set(ozId, []);
      if (!result.get(ozId).find(g => g.id === jb.id)) result.get(ozId).push(jb);
    };
    for (const oz of bigMapZones) {
      if (oz.flags?.is_building || oz.flags?.is_interior || oz.flags?.is_apartment) continue;
      if (Object.values(oz.exits || {}).includes(entrance.id)) addJb(oz.id);
    }
    for (const exitId of Object.values(entrance.exits || {})) {
      const oz = bigMapZones.find(z => z.id === exitId && !z.flags?.is_building && !z.flags?.is_interior && !z.flags?.is_apartment);
      if (oz) addJb(oz.id);
    }
  }
  return result;
}

async function viewGeneratorZones(generatorId) {
  const result = await API(`/environment/power/generators/${encodeURIComponent(generatorId)}/zones`).catch(e => ({ error: e.message }));
  if (result?.error) { toast(result.error, true); return; }
  const { generator: g, zones } = result;
  const statusColor = { powered: 'var(--green,#0f0)', overloaded: 'var(--warning,orange)', offline: 'var(--danger,#f44)' };
  const rows = zones.map(z => {
    const kind = z.is_interior ? 'interior' : z.is_apartment ? 'apartment' : 'outdoor';
    const col = statusColor[z.status] || 'var(--text-dim)';
    const avail = (z.available_kw ?? 0).toFixed(1);
    const maxCap = Number(z.max_capacity_kw ?? 1000).toFixed(1);
    const zIdSafe = z.id.replace(/'/g, "\\'");
    return `<tr>
      <td>${z.name || z.id}</td>
      <td style="font-size:10px;color:var(--text-dim)">${z.id}</td>
      <td>${kind}</td>
      <td style="color:${col}">${z.status}</td>
      <td>${avail}/${maxCap}W</td>
      <td><button class="action-btn" style="font-size:10px;padding:1px 6px" onclick="editZoneMaxCapacity('${zIdSafe}')">✏ Max</button></td>
    </tr>`;
  }).join('');
  const body = zones.length
    ? `<table><thead><tr><th>Name</th><th>ID</th><th>Kind</th><th>Status</th><th>Available/Max</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
    : `<div style="color:var(--text-dim);padding:8px">No zones connected to this generator.</div>`;
  openModal(`${g.name || g.id} — ${zones.length} zone(s)`, body);
}

async function editZoneMaxCapacity(zoneId) {
  const current = bigMapPowerData.find(p => p.zoneId === zoneId)?.maxCapacityKw ?? 1000;
  const input = prompt(`Max capacity (W) for zone ${zoneId}:`, current);
  if (input === null) return;
  const kw = parseFloat(input);
  if (isNaN(kw) || kw < 0) { toast('Invalid capacity value', true); return; }
  const result = await API(`/environment/power/zones/${encodeURIComponent(zoneId)}`, 'POST', { maxCapacityKw: kw }).catch(e => ({ error: e.message }));
  if (result?.error) { toast(result.error, true); return; }
  toast(`Max capacity set to ${kw}W`);
  await _refreshPowerMapData();
  renderPowerPanelBody();
}

async function toggleGeneratorPower(generatorId) {
  const result = await API(`/environment/power/generators/${encodeURIComponent(generatorId)}/toggle`, 'POST', {}).catch(e => ({ error: e.message }));
  if (result?.error) { toast(result.error, true); return; }
  toast(result.isOn ? 'Generator on' : 'Generator off');
  await API('/environment/power/recompute', 'POST').catch(() => {});
  await _refreshPowerMapData();
  renderPowerPanelBody();
  if (document.getElementById('bigmap-overlay')?.classList.contains('active')) renderBigMapOverlay();
}

function editGeneratorCapacity(generatorId, currentKw) {
  const g = powerPanelGenerators.find(g => g.id === generatorId) || {};
  const isJB = g.generator_type === 'junction_box';
  const cityPlant = isJB && g.city_generator_id
    ? powerPanelGenerators.find(p => p.id === g.city_generator_id)
    : null;
  const cityPlantHtml = isJB ? `
    <div class="field" style="margin-top:8px"><label>City Plant</label>
      <div style="padding:5px 8px;background:var(--bg3);border-radius:3px;font-size:12px;color:${cityPlant ? 'var(--text-bright)' : 'var(--text-dim)'}">
        ${cityPlant ? `${cityPlant.name || cityPlant.id} (${Number(cityPlant.capacity_kw).toFixed(0)}W)` : '— None assigned —'}
      </div>
    </div>` : '';
  document.getElementById('modal-title').textContent = `Edit ${isJB ? 'Junction Box' : 'Generator'} — ${g.name || generatorId}`;
  document.getElementById('modal-body').innerHTML = `
    <div class="field"><label>Capacity (W)</label>
      <input type="number" id="gen-edit-capacity" value="${currentKw}" min="0" step="100" style="width:100%">
    </div>
    <div class="field" style="margin-top:8px"><label>Name</label>
      <input type="text" id="gen-edit-name" value="${g.name || ''}" placeholder="Generator name" style="width:100%">
    </div>
    ${cityPlantHtml}
  `;
  document.getElementById('modal-save').style.display = '';
  document.getElementById('modal-save').textContent = 'Save';
  document.getElementById('modal-save').onclick = async () => {
    const kw = parseFloat(document.getElementById('gen-edit-capacity').value);
    if (isNaN(kw) || kw < 0) { toast('Invalid capacity value', true); return; }
    const name = document.getElementById('gen-edit-name').value.trim();
    const result = await API(`/environment/power/generators/${encodeURIComponent(generatorId)}/capacity`, 'POST', { capacityKw: kw, name: name || undefined }).catch(e => ({ error: e.message }));
    if (result?.error) { toast(result.error, true); return; }
    toast('Generator updated');
    closeModal();
    await _refreshPowerMapData();
    renderPowerPanelBody();
  };
  document.getElementById('generic-modal').style.display = 'flex';
}

async function setJunctionBoxCityGen(jbId, zoneId) {
  const cityGeneratorId = document.getElementById('jb-city-gen-select')?.value || null;
  const result = await API(`/environment/power/generators/${encodeURIComponent(jbId)}/city-generator`, 'POST', { cityGeneratorId }).catch(e => ({ error: e.message }));
  if (result?.error) { toast(result.error, true); return; }
  toast(`City plant assigned`);
  await refreshZoneEditPanel(zoneId);
}

async function removeGeneratorFromPowerPanel(generatorId) {
  if (!confirm('Remove this generator? Every zone it powers will go dark.')) return;
  const result = await API(`/environment/power/generators/${generatorId}`, 'DELETE');
  if (result?.error) { toast(result.error, true); return; }
  toast('Generator removed');
  loadPanel('power');
}

// --- Settings ---
