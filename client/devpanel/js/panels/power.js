let powerPanelGenerators = [];
let powerPanelMode = 'power';
let powerPanelView = 'region'; // 'region' | 'city' | 'interior' — the map is what you open on
let powerPanelBuilding = null; // selected building zone id for interior view
let powerPanelAllZones = [];   // full zone list (for building interior search)
let powerPanelInteriorZ = 0;  // current floor for interior map view

async function renderPowerPanel(zones) {
  const [powerMap, generators, allZones, maps, regionData] = await Promise.all([
    API('/environment/power/map').catch(() => []),
    API('/environment/power/generators').catch(() => []),
    API('/zones').catch(() => []),
    API('/maps').catch(() => []),
    API('/maps/regions').catch(() => null),
  ]);
  bigMapZones = Array.isArray(zones) ? zones : [];
  bigMapPowerData = Array.isArray(powerMap) ? powerMap : [];
  powerPanelGenerators = Array.isArray(generators) ? generators : [];
  bigMapGenerators = powerPanelGenerators;
  powerPanelAllZones = Array.isArray(allZones) ? allZones : [];
  // Region Map folds interior rooms onto the facade they hang off, so it needs the
  // interior-map -> parent-zone parentage; and the region names for its selector.
  powerPanelMapParents = new Map((Array.isArray(maps) ? maps : [])
    .filter(m => m.parent_zone_id).map(m => [m.id, m.parent_zone_id]));
  powerPanelRegions = new Map((regionData?.regions || []).map(r => [r.id, r.name || r.id]));
  powerJbByOutdoor = _buildJbByOutdoor();
  powerPanelMode = 'power';
  powerPanelView = 'region';
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

// Jump straight into the interior view for a building (from a City Grid tile).
function powerPanelOpenBuilding(zoneId) {
  powerPanelView = 'interior';
  powerPanelBuilding = zoneId || null;
  powerPanelInteriorZ = 0;
  renderPowerPanelBody();
}

// City Grid = a plant→junction-box schematic. The old view rendered a full CSS
// grid over the bounding box of every placed zone (a <div> per coordinate cell),
// which froze the panel once the district map grew to ~888 zones. Power only ever
// flows city plant → building junction box → building interior, so we draw exactly
// that: each plant node, and one tile per building it feeds. Bounded by generator
// count, not map area — no terrain, no freeze.
function _buildPlantSchematicHtml() {
  const STATUS_CLS = { powered: 'bm-power-powered', overloaded: 'bm-power-overloaded', offline: 'bm-power-offline', unpowered: 'bm-power-unpowered' };
  const zoneById = new Map(powerPanelAllZones.map(z => [z.id, z]));
  const powerById = new Map(bigMapPowerData.map(p => [p.zoneId, p]));
  const plants = powerPanelGenerators.filter(g => g.generator_type === 'city_plant');
  const jbs = powerPanelGenerators.filter(g => g.generator_type === 'junction_box');

  // Walk a junction box's interior network out to the building entrance it serves.
  const buildingFor = jb => {
    const seen = new Set([jb.zone_id]);
    const queue = [jb.zone_id];
    while (queue.length) {
      const cur = zoneById.get(queue.shift());
      if (!cur) continue;
      if (cur.flags?.is_building) return cur;
      for (const exitId of flatNeighbors(cur.exits)) {
        if (seen.has(exitId)) continue;
        seen.add(exitId);
        const nb = zoneById.get(exitId);
        if (!nb) continue;
        if (nb.flags?.is_building) return nb;
        if (nb.flags?.is_interior || nb.flags?.is_apartment) queue.push(exitId);
      }
    }
    return null;
  };

  const jbTile = jb => {
    const b = buildingFor(jb);
    const label = b?.name || jb.zone_name || jb.name || jb.id;
    const draw = Number(jb.zone_load_w ?? 0);
    const jbOn = Number(jb.capacity_kw) > 0;
    const pw = b ? powerById.get(b.id) : null;
    let status;
    if (!jbOn || pw?.status === 'offline') status = 'offline';
    else if (draw === 0) status = 'unpowered';
    else status = pw?.status || 'powered';
    const cls = STATUS_CLS[status] || 'bm-power-unpowered';
    const nav = b ? ` style="cursor:pointer" onclick="powerPanelOpenBuilding('${b.id.replace(/'/g, "\\'")}')"` : '';
    const drawStr = draw > 0 ? `${draw.toFixed(0)}W` : 'idle';
    return `<div class="bigmap-tile ${cls}"${nav} title="${(label + '').replace(/"/g, '&quot;')} — ${status} · JB ${jb.name || jb.id}">
      <div>🏢 ${label}<div style="font-size:9px;opacity:0.8;margin-top:2px">${drawStr} · ${status}</div></div>
    </div>`;
  };

  const plantBlock = p => {
    const fed = jbs.filter(jb => jb.city_generator_id === p.id);
    const used = Number(p.total_demand_w ?? 0);
    const cap = Number(p.capacity_kw);
    const overdrawn = used > cap;
    const cls = cap === 0 ? 'bm-power-plant bm-power-offline' : overdrawn ? 'bm-power-plant bm-power-overloaded' : 'bm-power-plant';
    const plantNode = `<div class="bigmap-tile ${cls}" style="min-width:150px" title="${(p.zone_name || p.zone_id || '').replace(/"/g, '&quot;')}">
      <div>⚡ ${p.name || p.id}<div style="font-size:10px;opacity:0.9;margin-top:2px">${used.toFixed(0)}/${cap.toFixed(0)}W · ${fed.length} bldg</div></div>
    </div>`;
    const tiles = fed.length
      ? fed.map(jbTile).join('')
      : `<div style="color:var(--text-dim);font-size:11px;align-self:center">No buildings wired to this plant.</div>`;
    return `<div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:20px">
      ${plantNode}
      <div style="color:var(--text-dim);font-size:20px;align-self:center">→</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;flex:1">${tiles}</div>
    </div>`;
  };

  if (!plants.length) {
    return `<div style="color:var(--text-dim);padding:8px">No city power plants installed yet — install one from a zone's editor.</div>`;
  }

  let html = plants.map(plantBlock).join('');

  const unlinked = jbs.filter(jb => !jb.city_generator_id || !plants.find(p => p.id === jb.city_generator_id));
  const offgrid = unlinked.filter(jb => jb.flags?.offgrid);
  const unassigned = unlinked.filter(jb => !jb.flags?.offgrid);
  if (offgrid.length) {
    html += `<div style="margin-top:6px">
      <div style="color:var(--text-dim);font-size:11px;margin-bottom:6px">🔋 Independent power (off-grid — self-generated, not on the city plant):</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">${offgrid.map(jbTile).join('')}</div>
    </div>`;
  }
  if (unassigned.length) {
    html += `<div style="margin-top:6px">
      <div style="color:var(--warning);font-size:11px;margin-bottom:6px">⚠ Junction boxes not wired to any city plant:</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">${unassigned.map(jbTile).join('')}</div>
    </div>`;
  }

  return html;
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
      if (flatNeighbors(z.exits).some(id => networkIds.has(id))) {
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

  let gridHtml = `<div style="display:grid;grid-template-columns:${colTmpl};grid-template-rows:${rowTmpl}">`;

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

  gridHtml = wrapMapScale(gridHtml + `</div>`);

  return buildingDropdown + floorNav + gridHtml + `<div style="margin-top:10px;display:flex;gap:14px;flex-wrap:wrap;font-size:10px;color:var(--text-dim)">${mapLegendHtml('power')}</div>`;
}

// --- Region Map --------------------------------------------------------------
// The third view, and the one that answers "where is the grid, and is it well?"
// City Grid is a schematic — it shows what is wired to what and deliberately
// throws the geography away. This is the same data laid back over the ground, on
// the monochrome plan base the spawn map already uses (maps.js), so a dark block
// of city reads as a dark block of city rather than as a list of building names.
//
// Interior rooms have no tile of their own, so their draw is folded onto the
// facade you enter them through — one building, one tile, one number.
const POWER_HOME_REGION = 'region_coldwater';
let powerRegionId = null;       // selected region ('__unassigned' for tiles with no region)
let powerRegionZ = null;        // selected floor (grid_z); null = pick the busiest one
let powerRegionSel = null;      // clicked tile zone id
let powerRegionPlantSel = null; // clicked plant generator id
let powerPanelMapParents = new Map();  // interior map id -> exterior parent zone id
let powerPanelRegions = new Map();     // region id -> name

const POWER_STATUS_RANK = { offline: 3, overloaded: 2, powered: 1 };
const POWER_STATUS_RGB = {
  offline: '220,40,60',
  overloaded: '255,165,0',
  // Muted on purpose: every wired facade paints this, so a saturated green
  // washed the whole city and left the faults it exists to show competing with
  // it. Desaturated, and the alpha ramp is shallower than the fault colours.
  powered: '130,185,160',
  unpowered: '90,90,120',
};
// Street lighting is not a building and must not read as one: a lamp column on a
// road is fed straight off the plant with no junction box, so it gets its own
// neutral white rather than a dimmer shade of the building green.
const POWER_LAMP_RGB = '236,240,246';
// Draw is the thing this map is read for, so it is the thing that gets the
// colour. A tile pulling any watts at all starts at a medium green that is
// already legible against the plan base, and climbs to a bright one at the
// region's heaviest draw — brightness IS consumption, and a served tile pulling
// nothing stays the flat idle tone so it cannot be mistaken for a light load.
const POWER_DRAW_LOW  = [46, 170, 104];   // any draw at all
const POWER_DRAW_HIGH = [120, 255, 150];  // the heaviest draw in the region
const POWER_IDLE_RGB  = '120,160,145';    // powered, drawing nothing
function _powerDrawRgb(t) {
  return POWER_DRAW_LOW.map((c, i) => Math.round(c + (POWER_DRAW_HIGH[i] - c) * t)).join(',');
}

function setPowerRegion(rid) {
  powerRegionId = rid;
  powerRegionZ = null;      // re-pick the busiest floor of the new region
  powerRegionSel = null;
  powerRegionPlantSel = null;
  renderPowerPanelBody();
}
function setPowerRegionZ(z) {
  powerRegionZ = z;
  powerRegionSel = null;
  powerRegionPlantSel = null;
  renderPowerPanelBody();
}
function powerRegionStepZ(delta) {
  const tiles = planPlacedTiles(powerPanelAllZones).filter(z => planRegionOf(z) === powerRegionId);
  const floors = [...new Set(tiles.map(z => z.grid_z ?? 0))].sort((a, b) => a - b);
  const next = delta > 0 ? floors.find(z => z > powerRegionZ)
                         : floors.slice().reverse().find(z => z < powerRegionZ);
  if (next != null) setPowerRegionZ(next);
}
function powerRegionSelect(zoneId) {
  powerRegionSel = powerRegionSel === zoneId ? null : zoneId;
  powerRegionPlantSel = null;
  renderPowerPanelBody();
  document.getElementById('power-region-detail')?.scrollIntoView({ block: 'nearest' });
}
function powerRegionSelectPlant(genId) {
  powerRegionPlantSel = powerRegionPlantSel === genId ? null : genId;
  powerRegionSel = null;
  renderPowerPanelBody();
  document.getElementById('power-region-detail')?.scrollIntoView({ block: 'nearest' });
}

// Every power-model zone folded onto the tile it should paint.
// -> Map(tileZoneId -> { load, available, capacity, status, served, rooms: [...] })
//
// ⚠ Being on the power model is NOT the same as being served, and painting the
// first washed the whole region: 11,763 of the 17,267 rows are open ground wired
// straight to a city plant (a street with a lamp on it draws 5W), so every field
// of grass in the Basin read as a lit building. Power reaches a PLACE through a
// junction box — that is what a building has and a road does not — so `served`
// is what the map paints, while the row itself stays in the model so the detail
// panel can still say what a street lamp draws.
const POWER_SERVED_GEN = new Set(['junction_box', 'building']);
function _powerIsOffgrid(genId) {
  const g = powerPanelGenerators.find(x => x.id === genId);
  return !!g && (g.flags?.offgrid || !g.city_generator_id);
}
function _powerByTile() {
  const zoneById = new Map(powerPanelAllZones.map(z => [z.id, z]));
  const byTile = new Map();
  for (const pw of bigMapPowerData) {
    const zone = zoneById.get(pw.zoneId);
    if (!zone) continue;
    const tile = planTileZoneFor(zone, zoneById, powerPanelMapParents);
    if (!tile) continue;
    let e = byTile.get(tile.id);
    if (!e) byTile.set(tile.id, e = { load: 0, available: 0, capacity: 0, status: null, served: false, offgrid: false, lamps: 0, lampFed: false, lampOn: false, rooms: [] });
    if (POWER_SERVED_GEN.has(pw.generatorType)) {
      e.served = true;
      // The Echelon runs its own engine room, so it is powered but it is not the
      // city's problem: an off-grid box has no city plant behind it and must not
      // land in a grid-health tally about a plant it was never wired to.
      if (_powerIsOffgrid(pw.generatorId)) e.offgrid = true;
    }
    // A road is wired for street lighting and nothing else, so the LAMP COLUMNS
    // are what mark it — never the draw. A streetlight only draws after dark, so
    // keying on load painted the city's road grid at night and erased it by day.
    else if (Number(pw.streetlights ?? 0) > 0) {
      e.lamps += Number(pw.streetlights);
      if ((pw.status || 'powered') !== 'offline') e.lampFed = true;
      if (Number(pw.loadKw ?? 0) > 0) e.lampOn = true;
    }
    e.load += Number(pw.loadKw ?? 0);
    e.available += Number(pw.availableKw ?? 0);
    e.capacity += Number(pw.capacityKw ?? 0);
    e.rooms.push({ zone, pw });
    // A tile is as bad as the worst room behind its door: one dead floor is the
    // thing you opened this map to find, and averaging would hide it.
    const s = pw.status || 'powered';
    if (!e.status || (POWER_STATUS_RANK[s] || 0) > (POWER_STATUS_RANK[e.status] || 0)) e.status = s;
  }
  return { byTile, zoneById };
}

// Plants keyed by the tile they stand on. map_zone_id is computed server-side and
// already resolves a plant sitting in an interior back out to its exterior zone.
function _powerPlantsByTile() {
  const byTile = new Map();
  for (const g of powerPanelGenerators) {
    if (g.generator_type !== 'city_plant') continue;
    const tid = g.map_zone_id || g.zone_id;
    if (!byTile.has(tid)) byTile.set(tid, []);
    byTile.get(tid).push(g);
  }
  return byTile;
}

// Which city plant ultimately feeds a power row — through its junction box if it
// has one. Returns the plant generator, or null for off-grid and unwired zones.
function _powerPlantFor(pw) {
  if (!pw?.generatorId) return null;
  const gen = powerPanelGenerators.find(g => g.id === pw.generatorId);
  if (!gen) return null;
  if (gen.generator_type === 'city_plant') return gen;
  return powerPanelGenerators.find(g => g.id === gen.city_generator_id) || null;
}

function _buildRegionMapHtml() {
  const { byTile, zoneById } = _powerByTile();
  const plantsByTile = _powerPlantsByTile();
  const buckets = planRegionBuckets(powerPanelAllZones);
  if (!buckets.size) return '<div style="color:var(--text-dim);padding:8px">No placed tiles to map.</div>';

  const regions = [...buckets.entries()].map(([rid, tiles]) => ({
    rid, tiles,
    name: planRegionName(powerPanelRegions, rid),
    load: tiles.reduce((n, z) => n + (byTile.get(z.id)?.load || 0), 0),
    wired: tiles.filter(z => byTile.has(z.id)).length,
  })).sort((a, b) => b.load - a.load || a.name.localeCompare(b.name));

  // Coldwater Basin first: it is where the game starts and the only region with a
  // grid worth reading, so opening on whichever region happened to draw the most
  // watts this tick just costs a click.
  if (!regions.some(r => r.rid === powerRegionId)) {
    powerRegionId = (regions.find(r => r.rid === POWER_HOME_REGION) || regions[0]).rid;
  }
  const sel = regions.find(r => r.rid === powerRegionId);

  const options = regions.map(r =>
    `<option value="${r.rid}"${r.rid === powerRegionId ? ' selected' : ''}>${r.name} — ${r.wired} wired tile${r.wired === 1 ? '' : 's'}</option>`).join('');

  // Floors are separate places, not storeys of one thing, so one draws at a time.
  const floors = [...new Set(sel.tiles.map(z => z.grid_z ?? 0))].sort((a, b) => b - a);
  const floorWired = z => sel.tiles.filter(t => (t.grid_z ?? 0) === z && byTile.has(t.id)).length;
  if (!floors.includes(powerRegionZ)) {
    powerRegionZ = floors.slice().sort((a, b) => floorWired(b) - floorWired(a) || b - a)[0] ?? 0;
  }
  const onFloor = sel.tiles.filter(z => (z.grid_z ?? 0) === powerRegionZ);

  const floorNav = floors.length > 1 ? `<div class="field" style="flex:0 0 auto"><label>Floor</label>
    <div style="display:flex;align-items:center;gap:4px">
      <button class="action-btn" onclick="powerRegionStepZ(-1)"${powerRegionZ === floors[floors.length - 1] ? ' disabled' : ''}>▾</button>
      <span style="min-width:52px;text-align:center;font-size:12px">z = ${powerRegionZ}</span>
      <button class="action-btn" onclick="powerRegionStepZ(1)"${powerRegionZ === floors[0] ? ' disabled' : ''}>▴</button>
      <span style="font-size:10px;color:var(--text-dim)">${floors.map(z =>
        `<a href="#" onclick="setPowerRegionZ(${z});return false" style="color:${z === powerRegionZ ? 'var(--text)' : 'var(--text-dim)'};text-decoration:none;padding:0 3px">${z}${floorWired(z) ? '•' : ''}</a>`).join('')}</span>
    </div></div>` : '';

  let html = `<div style="display:flex;gap:10px;align-items:flex-end;margin-bottom:8px">
    <div class="field" style="flex:0 0 280px"><label>Region</label>
      <select onchange="setPowerRegion(this.value)">${options}</select></div>
    ${floorNav}
    <div style="color:var(--text-dim);font-size:11px;padding-bottom:6px">
      Click a building or a plant for what it draws, what feeds it and whether it's up.
    </div>
  </div>`;

  html += _powerGridHealthHtml(sel, byTile, plantsByTile);
  html += onFloor.length
    ? _powerRegionGridHtml(onFloor, byTile, plantsByTile)
    : `<div style="color:var(--text-dim);padding:12px">No placed tiles on floor z=${powerRegionZ}.</div>`;
  html += _powerRegionLegendHtml();
  html += `<div id="power-region-detail">${_powerRegionDetailHtml(byTile, zoneById)}</div>`;
  html += _powerOffPlantHtml();
  return html;
}

// The actions the Generators table used to carry, beside the generator itself.
function _powerGenActionsHtml(g) {
  const id = JSON.stringify(g.id);
  return `<button class="action-btn" onclick='toggleGeneratorPower(${id})'>${Number(g.capacity_kw) > 0 ? 'Switch off' : 'Switch on'}</button>
    <button class="action-btn" onclick='editGeneratorCapacity(${id}, ${Number(g.capacity_kw) || 0})'>Capacity</button>
    <button class="action-btn" onclick='viewGeneratorZones(${id})'>Zones</button>
    <button class="action-btn danger" onclick='removeGeneratorFromPowerPanel(${id})'>Remove</button>`;
}

function _powerGenRowHtml(g, prefix) {
  const on = Number(g.capacity_kw) > 0;
  return `<div class="zone-subitem-row">
    <span>${prefix || ''}${g.name || g.id}
      <span style="color:var(--text-dim);font-size:11px">· ${g.zone_name || g.zone_id || '—'} · ${Number(g.zone_load_w ?? 0).toFixed(0)}W${on ? '' : ' · <span style="color:var(--warning)">offline</span>'}</span></span>
    <span class="zone-subitem-actions">${_powerGenActionsHtml(g)}</span>
  </div>`;
}

// Junction boxes on no city plant. Off-grid is a building running its own
// generator on purpose; unassigned is a fault, and says so.
function _powerOffPlantHtml() {
  const plantIds = new Set(powerPanelGenerators.filter(g => g.generator_type === 'city_plant').map(g => g.id));
  const loose = powerPanelGenerators.filter(g => g.generator_type === 'junction_box'
    && (!g.city_generator_id || !plantIds.has(g.city_generator_id)));
  const offgrid = loose.filter(g => g.flags?.offgrid);
  const unassigned = loose.filter(g => !g.flags?.offgrid);
  if (!loose.length) return '';
  let h = '';
  if (offgrid.length) {
    h += `<div style="margin-top:10px"><div style="color:var(--text-dim);font-size:11px;margin-bottom:4px">🔋 Independent power — self-generated, not on a city plant</div>
      ${offgrid.map(g => _powerGenRowHtml(g, '')).join('')}</div>`;
  }
  if (unassigned.length) {
    h += `<div style="margin-top:10px"><div style="color:var(--warning);font-size:11px;margin-bottom:4px">⚠ Junction boxes wired to no city plant</div>
      ${unassigned.map(g => _powerGenRowHtml(g, '')).join('')}</div>`;
  }
  return h;
}

// Grid health for the whole region — every floor of it, not just the one drawn,
// because a plant is regional and a basement is still on it.
function _powerGridHealthHtml(sel, byTile, plantsByTile) {
  const tileIds = new Set(sel.tiles.map(z => z.id));
  const plants = [...plantsByTile.entries()].filter(([tid]) => tileIds.has(tid)).flatMap(([, gs]) => gs);
  const online = plants.filter(p => Number(p.capacity_kw) > 0);
  const capacity = online.reduce((n, p) => n + Number(p.capacity_kw || 0), 0);
  const demand = plants.reduce((n, p) => n + Number(p.total_demand_w ?? 0), 0);
  const headroom = capacity > 0 ? Math.max(0, 1 - demand / capacity) : 0;

  const counts = { offline: 0, overloaded: 0, powered: 0, unwired: 0, lamps: 0, offgrid: 0 };
  for (const z of sel.tiles) {
    const e = byTile.get(z.id);
    if (e?.offgrid) counts.offgrid++;
    else if (e?.served) counts[e.status] = (counts[e.status] || 0) + 1;
    else if (e?.lamps > 0) counts.lamps++;
    else if (planTileIsBuilding(z)) counts.unwired++;
  }

  // One sentence, so the number you act on is a word before it's a percentage.
  const verdict = !plants.length ? ['no plant in this region', 'var(--text-dim)']
    : !online.length ? ['blackout — every plant is down', '#e34']
    : demand > capacity ? ['over capacity — drawing more than it makes', 'var(--warning)']
    : counts.offline ? [`${counts.offline} tile${counts.offline === 1 ? '' : 's'} dark`, 'var(--warning)']
    : headroom < 0.1 ? ['at the limit — under 10% headroom', 'var(--warning)']
    : ['healthy', '#2c8'];

  const barPct = capacity > 0 ? Math.min(100, (demand / capacity) * 100) : 0;
  const barColour = demand > capacity ? 'rgba(220,40,60,0.85)' : barPct > 90 ? 'rgba(255,165,0,0.85)' : 'rgba(20,200,100,0.75)';
  const stat = (label, value) => `<span style="display:inline-flex;flex-direction:column;gap:1px">
    <b style="font-size:13px">${value}</b><span style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.5px">${label}</span></span>`;

  return `<div style="border:1px solid var(--border);border-radius:4px;padding:10px;margin-bottom:10px;background:var(--bg2)">
    <div style="display:flex;gap:22px;align-items:flex-end;flex-wrap:wrap">
      ${stat('grid', `<span style="color:${verdict[1]}">${verdict[0]}</span>`)}
      ${stat('plants up', `${online.length}/${plants.length}`)}
      ${stat('capacity', `${capacity.toFixed(0)}W`)}
      ${stat('demand', `${demand.toFixed(0)}W`)}
      ${stat('headroom', `${(headroom * 100).toFixed(0)}%`)}
      ${stat('tiles', `${counts.powered} up · ${counts.overloaded} strained · ${counts.offline} dark · ${counts.unwired} unwired · ${counts.lamps} lit street${counts.offgrid ? ` · ${counts.offgrid} off-grid` : ''}`)}
    </div>
    <div style="margin-top:8px;height:6px;background:var(--bg);border-radius:3px;overflow:hidden">
      <div style="height:100%;width:${barPct.toFixed(1)}%;background:${barColour}"></div>
    </div>
  </div>`;
}

// One floor of the region: terrain tone underneath, power status on top.
function _powerRegionGridHtml(tiles, byTile, plantsByTile) {
  const xs = tiles.map(z => z.grid_x), ys = tiles.map(z => z.grid_y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const cols = maxX - minX + 1;
  const cell = Math.max(5, Math.min(20, Math.floor(880 / cols)));

  const byCoord = new Map();
  for (const z of tiles) {
    const key = `${z.grid_x},${z.grid_y}`;
    const cur = byCoord.get(key);
    if (!cur || (z.grid_z ?? 0) < (cur.grid_z ?? 0)) byCoord.set(key, z);
  }
  // Served tiles only: a plant-fed street must not set the ramp the buildings ride.
  const peak = Math.max(0, ...tiles.map(z => byTile.get(z.id)?.served ? byTile.get(z.id).load : 0));

  let html = planGridOpen(cols, cell);
  for (const [coord, z] of byCoord) {
      const [x, y] = coord.split(',').map(Number);
      const e = byTile.get(z.id);
      const plants = plantsByTile.get(z.id) || [];
      const tone = planTileTone(z);
      const border = planTileIsBuilding(z) ? `;box-shadow:inset 0 0 0 1px rgba(${PLAN_MAP_INK},0.85)` : '';

      let overlay = '';
      if (e && !e.served && e.lamps > 0) {
        // Bright and flat: how much a lamp draws is not a question anybody opens
        // this map to ask, so it carries one value and reads as a lit street.
        // Full while the lamps are burning, halved while they are merely wired —
        // the road is still there at noon, and the map should still show it.
        const a = e.lampOn ? 0.34 : e.lampFed ? 0.17 : 0.07;
        overlay = `<div style="position:absolute;inset:0;background:rgba(${POWER_LAMP_RGB},${a})"></div>`;
      } else if (e && e.served) {
        // A fault outranks a magnitude: offline and overloaded keep their own
        // colours whatever they were drawing when they went. Everything else
        // rides the draw ramp. sqrt, so the long tail of small draws separates
        // instead of all landing on the bottom step.
        const t = peak > 0 && e.load > 0 ? Math.sqrt(e.load / peak) : 0;
        const [rgb, alpha] = e.status !== 'powered'
          ? [POWER_STATUS_RGB[e.status] || POWER_STATUS_RGB.powered, e.status === 'offline' ? 0.85 : 0.18 + 0.72 * t]
          : e.load > 0 ? [_powerDrawRgb(t), 0.5 + 0.45 * t]
          : [POWER_IDLE_RGB, 0.16];
        overlay = `<div style="position:absolute;inset:0;background:rgba(${rgb},${alpha.toFixed(3)})"></div>`;
      }
      let onClick = `powerRegionSelect(${JSON.stringify(z.id)})`;
      let lift = '';
      let tip = (z.name || z.id) + (e
        ? `\n${e.load.toFixed(0)}W of ${e.available.toFixed(0)}W · ${e.served ? e.status : e.lamps > 0 ? `${e.lamps} street lamp${e.lamps === 1 ? '' : 's'}, ${e.lampOn ? 'lit' : e.lampFed ? 'wired, off' : 'no power'}` : 'no junction box — grid-fed street'}${e.rooms.length > 1 ? ` · ${e.rooms.length} rooms` : ''}`
        : '\nnot on the power model');
      if (plants.length) {
        const p = plants[0];
        const up = Number(p.capacity_kw) > 0;
        const over = Number(p.total_demand_w ?? 0) > Number(p.capacity_kw || 0);
        const ring = up ? (over ? '255,165,0' : '110,190,255') : '220,40,60';
        overlay += `<div style="position:absolute;inset:-2px;background:rgba(80,160,255,${up ? 0.8 : 0.45});box-shadow:0 0 0 2px rgba(${ring},0.95),0 0 9px 3px rgba(${ring},0.5)"></div>`;
        lift = ';z-index:2;overflow:visible';
        onClick = `powerRegionSelectPlant(${JSON.stringify(p.id)})`;
        tip = `⚡ ${p.name || p.id}\n${Number(p.total_demand_w ?? 0).toFixed(0)}W drawn of ${Number(p.capacity_kw || 0).toFixed(0)}W${up ? '' : ' · OFFLINE'}`;
      }
      const isSel = z.id === powerRegionSel || plants.some(p => p.id === powerRegionPlantSel);
      html += `<div class="plan-tile${isSel ? ' plan-tile-sel' : ''}" style="${planCellPos(x, y, minX, minY)};position:relative;background:rgba(${PLAN_MAP_INK},${tone})${border}${lift}"
        title="${tip.replace(/"/g, '&quot;')}" onclick='${onClick}'>${overlay}</div>`;
  }
  return html + '</div>';
}

function _powerRegionLegendHtml() {
  const sw = (rgb, a, label, ring) => `<span style="display:inline-flex;gap:4px;align-items:center"><span style="display:inline-block;width:12px;height:12px;background:rgba(${rgb},${a})${ring ? `;box-shadow:inset 0 0 0 2px ${ring}` : ''}"></span>${label}</span>`;
  return `<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:8px 0;font-size:10px;color:var(--text-dim)">
    ${sw('80,160,255', 0.8, 'city plant', 'rgba(110,190,255,0.95)')}
    ${sw(POWER_IDLE_RGB, 0.16, 'powered, no draw')}
    ${sw(_powerDrawRgb(0), 0.5, 'drawing')}
    ${sw(_powerDrawRgb(0.55), 0.75, 'heavier')}
    ${sw(_powerDrawRgb(1), 0.95, 'heaviest in region')}
    ${sw(POWER_STATUS_RGB.overloaded, 0.7, 'overloaded')}
    ${sw(POWER_STATUS_RGB.offline, 0.85, 'offline')}
    ${sw(PLAN_MAP_INK, PLAN_TILE_BUILDING, 'not on the grid')}
    ${sw(POWER_LAMP_RGB, 0.34, 'street lighting')}
    <span>· unpainted ground has no junction box and no lamp</span>
    <span style="opacity:0.7">interior rooms fold onto their facade</span>
  </div>`;
}

function _powerRegionDetailHtml(byTile, zoneById) {
  if (powerRegionPlantSel) {
    const p = powerPanelGenerators.find(g => g.id === powerRegionPlantSel);
    if (!p) return '';
    const fed = powerPanelGenerators.filter(g => g.generator_type === 'junction_box' && g.city_generator_id === p.id);
    const cap = Number(p.capacity_kw || 0), demand = Number(p.total_demand_w ?? 0);
    const rows = fed.map(jb => _powerGenRowHtml(jb, '↳ ')).join('');
    return `<div class="zone-inline-form" style="margin:0 0 12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <b>⚡ ${p.name || p.id}</b>
        <span style="display:flex;gap:6px">${_powerGenActionsHtml(p)}
          <button class="action-btn" onclick='powerRegionSelectPlant(${JSON.stringify(p.id)})'>Close</button>
        </span>
      </div>
      <div style="font-size:12px;margin-bottom:6px">
        ${cap > 0 ? 'Online' : '<span style="color:var(--warning)">Offline (zero capacity)</span>'} ·
        supplies <b>${cap.toFixed(0)}W</b> · drawn <b style="color:${demand > cap ? 'var(--warning)' : 'inherit'}">${demand.toFixed(0)}W</b> ·
        ${fed.length} junction box${fed.length === 1 ? '' : 'es'} · at ${p.zone_name || p.zone_id}
      </div>
      ${rows || '<div class="zone-subitem-empty">Nothing wired to this plant.</div>'}
    </div>`;
  }

  if (!powerRegionSel) return '';
  const zone = zoneById.get(powerRegionSel);
  if (!zone) return '';
  const e = byTile.get(zone.id);
  const zoneArg = JSON.stringify(zone.id);
  const head = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <b>${zone.name || zone.id}</b>
      <span style="display:flex;gap:6px">
        ${zone.flags?.is_building ? `<button class="action-btn" onclick='powerPanelOpenBuilding(${zoneArg})'>Open interior</button>` : ''}
        <button class="action-btn" onclick='editRecord(${zoneArg})'>Edit zone</button>
        <button class="action-btn" onclick='powerRegionSelect(${zoneArg})'>Close</button>
      </span>
    </div>`;
  if (!e) {
    return `<div class="zone-inline-form" style="margin:0 0 12px">${head}
      <div class="zone-subitem-empty">This tile isn't on the power model — nothing here draws or supplies.</div></div>`;
  }
  const plant = _powerPlantFor(e.rooms[0]?.pw);
  const room = r => {
    const load = Number(r.pw.loadKw ?? 0);
    const st = r.pw.status || 'powered';
    return `<div class="zone-subitem-row" style="cursor:pointer" onclick='editRecord(${JSON.stringify(r.zone.id)})'>
      <span>${r.zone.name || r.zone.id}
        <span style="color:var(--text-dim);font-size:11px">· ${load.toFixed(0)}W of ${Number(r.pw.availableKw ?? 0).toFixed(0)}W · ${st}${r.pw.artificialLight ? ' · lit' : ''}</span></span>
    </div>`;
  };
  const rooms = e.rooms.slice().sort((a, b) => Number(b.pw.loadKw ?? 0) - Number(a.pw.loadKw ?? 0));
  return `<div class="zone-inline-form" style="margin:0 0 12px">${head}
    <div style="font-size:12px;margin-bottom:6px">
      Draws <b>${e.load.toFixed(0)}W</b> of <b>${e.available.toFixed(0)}W</b> available ·
      <b style="color:rgba(${POWER_STATUS_RGB[e.status]},1)">${e.status}</b> ·
      ${e.rooms.length} room${e.rooms.length === 1 ? '' : 's'} ·
      fed by ${plant ? `⚡ ${plant.name || plant.id}` : '<span style="color:var(--text-dim)">no city plant (off-grid or unwired)</span>'}
    </div>
    ${rooms.map(room).join('')}
  </div>`;
}

function renderPowerPanelBody() {
  const panel = document.getElementById('list-panel');
  const powerById = new Map(bigMapPowerData.map(p => [p.zoneId, p]));

  const tabBar = `<div class="panel-sticky-head" style="display:flex;gap:8px;margin-bottom:12px;align-items:center;padding:4px 0">
    <button class="action-btn${powerPanelView === 'city' ? ' primary' : ''}" onclick="setPowerPanelView('city')">⚡ City Grid</button>
    <button class="action-btn${powerPanelView === 'interior' ? ' primary' : ''}" onclick="setPowerPanelView('interior')">🏢 Building Interior</button>
    <button class="action-btn${powerPanelView === 'region' ? ' primary' : ''}" onclick="setPowerPanelView('region')">🗺 Region Map</button>
  </div>`;

  let html;
  if (powerPanelView === 'region') {
    html = `<div style="padding:12px">${tabBar}${_buildRegionMapHtml()}</div>`;
  } else if (powerPanelView === 'interior') {
    html = `<div style="padding:12px">${tabBar}${_buildInteriorMapHtml()}</div>`;
  } else {
    html = `<div style="padding:12px">
    ${tabBar}
    ${_buildPlantSchematicHtml()}
    <div style="margin-top:10px;display:flex;gap:14px;flex-wrap:wrap;font-size:10px;color:var(--text-dim)">${mapLegendHtml('power')}</div>
  </div>`;
  }

  html += `<div style="padding:12px">
    <h3 style="color:var(--accent);font-size:12px;letter-spacing:1px;text-transform:uppercase;margin-bottom:10px">Power Tools</h3>
    <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
      <button class="action-btn primary" onclick="autoResolvePower()">🛠 Auto-Resolve Power</button>
      <button class="action-btn" onclick="fixZonePowerConnections()">🔌 Fix Zone Connections</button>
      <button class="action-btn" onclick="fixBuildingPowerConnections()">🏢 Fix Building Connections</button>
      <button class="action-btn" onclick="resyncAllLighting()">💡 Resync Lighting</button>
      <button class="action-btn" onclick="forceRecomputePower()">↺ Force Recompute</button>
    </div>
    <div id="power-tool-log" style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:8px;font-size:11px;font-family:monospace;min-height:48px;max-height:200px;overflow-y:auto;color:var(--text-dim)">No tools run yet.</div>
  </div>`;

  panel.innerHTML = html;
  applyMapScale(panel);
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
  const lines = _buildingFixLines(result);
  powerToolLog(lines);
  if (result.connected.length || result.created?.length) {
    await _refreshPowerMapData();
    renderPowerPanelBody();
    powerToolLog(lines);
  }
}

function _buildingFixLines(result) {
  const lines = [];
  if (result.connected.length) {
    lines.push(`✅ Connected ${result.connected.length} building(s):`);
    for (const b of result.connected) {
      lines.push(`&nbsp;&nbsp;• ${b.buildingName} → ${b.generatorName} (${b.zonesCount} zone(s) fixed)`);
    }
  }
  if (result.created?.length) {
    lines.push(`🛠 Built ${result.created.length} utility room(s) + junction box(es):`);
    for (const b of result.created) {
      lines.push(`&nbsp;&nbsp;• ${b.buildingName} → ${b.utilityRoomId}`);
    }
  }
  if (result.needsGenerator.length) {
    for (const b of result.needsGenerator) {
      lines.push(`⚠️ ${b.buildingName}: couldn't auto-fix${b.error ? ' — ' + b.error : ''}`);
    }
  }
  if (result.multipleGenerators.length) {
    for (const b of result.multipleGenerators) {
      lines.push(`❌ ${b.buildingName}: multiple generators — ${b.generators.join(', ')}`);
    }
  }
  if (!lines.length) lines.push('✅ All buildings already correctly connected.');
  return lines;
}

async function autoResolvePower() {
  powerToolLog(['⏳ Auto-resolving power: zones, buildings, utility rooms, recompute...']);
  const result = await API('/environment/power/auto-resolve', 'POST').catch(e => ({ error: e.message }));
  if (result?.error) { powerToolLog([`❌ Error: ${result.error}`]); return; }
  const lines = [];
  const zc = result.zones?.connected?.length || 0;
  lines.push(zc
    ? `🔌 Connected ${zc} outdoor zone(s) to the city grid.`
    : '🔌 All outdoor zones already on the city grid.');
  lines.push('—');
  lines.push(..._buildingFixLines(result.buildings || { connected: [], created: [], needsGenerator: [], multipleGenerators: [] }));
  lines.push('—');
  lines.push('↺ Power network recomputed.');
  await _refreshPowerMapData();
  renderPowerPanelBody();
  powerToolLog(lines);
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
  const [powerMap, generators, allZones] = await Promise.all([
    API('/environment/power/map').catch(() => []),
    API('/environment/power/generators').catch(() => []),
    API('/zones').catch(() => null),
  ]);
  bigMapPowerData = Array.isArray(powerMap) ? powerMap : [];
  powerPanelGenerators = Array.isArray(generators) ? generators : [];
  bigMapGenerators = powerPanelGenerators;
  // Fix-buildings/auto-resolve can dig new utility rooms; keep the zone list fresh
  // so the City Grid schematic can resolve every junction box to its building.
  if (Array.isArray(allZones)) powerPanelAllZones = allZones;
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
      for (const exitId of flatNeighbors(curZ.exits)) {
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
      if (flatNeighbors(oz.exits).includes(entrance.id)) addJb(oz.id);
    }
    for (const exitId of flatNeighbors(entrance.exits)) {
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
  const input = await dpPrompt(`Max capacity (W) for zone ${zoneId}:`, current);
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
  if (!(await dpConfirm('Remove this generator? Every zone it powers will go dark.', { danger: true }))) return;
  const result = await API(`/environment/power/generators/${generatorId}`, 'DELETE');
  if (result?.error) { toast(result.error, true); return; }
  toast('Generator removed');
  loadPanel('power');
}

// --- Settings ---
