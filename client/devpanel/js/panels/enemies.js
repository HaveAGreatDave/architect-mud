function renderEnemyRows(spawns, liveEnemies, zoneId) {
  if (!spawns.length) return '<div class="zone-subitem-empty">No enemies here.</div>';
  return spawns.map(s => {
    const live = liveEnemies.filter(e => e.templateId === s.enemy_id);
    const liveTag = live.length
      ? `<span style="color:var(--accent2);font-size:11px"> · ${live.map(e => `${e.hp}/${e.hp_max}HP`).join(', ')} live</span>`
      : `<span style="color:var(--text-dim);font-size:11px"> · none alive</span>`;
    return `<div class="zone-subitem-row" id="spawn-row-${s.id}">
      <span>${s.enemy_name}${liveTag} <span style="color:var(--text-dim);font-size:11px">· ×${s.max_count} · ${s.respawn_seconds}s respawn</span></span>
      <span class="zone-subitem-actions">
        <button class="action-btn" onclick="openEditEnemyInline('${s.enemy_id}')">Edit</button>
        <button class="action-btn" onclick="openEditSpawnInline('${s.id}','${zoneId}',${s.max_count},${s.respawn_seconds})">Spawn</button>
        <button class="action-btn danger" onclick="confirmDeleteSpawn('${s.id}','${zoneId}')">Remove</button>
      </span>
    </div>`;
  }).join('');
}
function openEditSpawnInline(spawnId, zoneId, maxCount, respawnSeconds) {
  const row = document.getElementById(`spawn-row-${spawnId}`);
  if (!row) return;
  const actions = row.querySelector('.zone-subitem-actions');
  actions.innerHTML = `
    <label style="font-size:11px;color:var(--text-dim)">×</label>
    <input type="number" id="es-max-${spawnId}" value="${maxCount}" min="1" style="width:46px;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:2px 4px;outline:none">
    <label style="font-size:11px;color:var(--text-dim)">s</label>
    <input type="number" id="es-resp-${spawnId}" value="${respawnSeconds}" min="1" style="width:58px;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:2px 4px;outline:none">
    <button class="action-btn success" onclick="saveSpawnInline('${spawnId}','${zoneId}')">Save</button>
    <button class="action-btn" onclick="refreshEnemiesSection('${zoneId}')">Cancel</button>`;
}
async function saveSpawnInline(spawnId, zoneId) {
  const max_count = parseInt(document.getElementById(`es-max-${spawnId}`)?.value);
  const respawn_seconds = parseInt(document.getElementById(`es-resp-${spawnId}`)?.value);
  if (!max_count || max_count < 1) { toast('Max count must be >= 1', true); return; }
  if (!respawn_seconds || respawn_seconds < 1) { toast('Respawn must be >= 1s', true); return; }
  const result = await directAPI(`/spawns/${encodeURIComponent(spawnId)}`, 'PUT', { max_count, respawn_seconds });
  if (result?.error) { toast(result.error, true); return; }
  toast('Spawn updated');
  await refreshEnemiesSection(zoneId);
}
function openAddSpawnForm(zoneId) {
  const options = zoneEditAllEnemiesCache
    .slice().sort((a,b) => (a.name||'').localeCompare(b.name||''))
    .map(e => `<option value="${e.id}">${e.name}</option>`).join('');
  document.getElementById('zone-add-spawn-form').innerHTML = `
    <div class="zone-inline-form">
      <div class="field"><label>Enemy</label>
        <select id="ns-enemy">${options || '<option value="">— no enemies defined —</option>'}</select>
      </div>
      <div class="field-row" style="gap:8px">
        <div class="field"><label>Max Count</label><input id="ns-max" type="number" value="1" min="1" style="width:70px"></div>
        <div class="field"><label>Respawn (s)</label><input id="ns-respawn" type="number" value="300" min="1" style="width:80px"></div>
        <div class="field"><label>Spawn Weight</label><input id="ns-weight" type="number" value="100" min="0" max="100" style="width:70px"></div>
      </div>
      <div class="zone-inline-form-actions">
        <button class="action-btn success" onclick='submitAddSpawn(${JSON.stringify(zoneId)})'>Add</button>
        <button class="action-btn" onclick="document.getElementById('zone-add-spawn-form').innerHTML=''">Cancel</button>
      </div>
    </div>`;
}
async function submitAddSpawn(zoneId) {
  const enemy_id = document.getElementById('ns-enemy')?.value;
  if (!enemy_id) { toast('Pick an enemy', true); return; }
  const max_count = parseInt(document.getElementById('ns-max').value) || 1;
  const respawn_seconds = parseInt(document.getElementById('ns-respawn').value) || 300;
  const weightEl = document.getElementById('ns-weight');
  const spawn_weight = weightEl && weightEl.value.trim() !== '' ? parseInt(weightEl.value) : 100;
  const result = await directAPI('/spawns', 'POST', { zone_id: zoneId, enemy_id, max_count, spawn_weight, respawn_seconds });
  if (result?.error) { toast(result.error, true); return; }
  await directAPI(`/zones/${encodeURIComponent(zoneId)}/live-enemies`, 'POST', { enemy_id });
  document.getElementById('zone-add-spawn-form').innerHTML = '';
  toast('Enemy added');
  await refreshEnemiesSection(zoneId);
}
async function refreshEnemiesSection(zoneId) {
  const [spawnsData, liveData] = await Promise.all([
    API(`/zones/${encodeURIComponent(zoneId)}/spawns`).catch(() => []),
    API(`/zones/${encodeURIComponent(zoneId)}/live-enemies`).catch(() => []),
  ]);
  const spawns = Array.isArray(spawnsData) ? spawnsData : [];
  const live = Array.isArray(liveData) ? liveData : [];
  zoneEditSpawnsCache = spawns;
  const container = document.getElementById('zone-enemies-list');
  if (container) container.innerHTML = renderEnemyRows(spawns, live, zoneId);
  const header = container?.closest('.zone-subsection')?.querySelector('.zone-subsection-count');
  if (header) header.textContent = spawns.length;
}
async function openEditEnemyInline(enemyId) {
  const enemies = await API('/enemies');
  const rec = Array.isArray(enemies) ? enemies.find(e => e.id === enemyId) : null;
  if (!rec) { toast('Enemy not found', true); return; }
  zoneEnemyEditReturn = zoneEditCurrentZoneId;
  currentPanel = 'enemies';
  currentRecord = rec;
  openEdit(rec, false);
}
function confirmDeleteSpawn(spawnId, zoneId) {
  const row = document.getElementById(`spawn-row-${spawnId}`);
  if (!row) return;
  const actions = row.querySelector('.zone-subitem-actions');
  actions.innerHTML = `<span style="color:var(--text-dim);font-size:11px">Sure?</span>
    <button class="action-btn danger" onclick="deleteSpawnQuick('${spawnId}','${zoneId}')">Yes</button>
    <button class="action-btn" onclick="refreshEnemiesSection('${zoneId}')">No</button>`;
}
async function deleteSpawnQuick(spawnId, zoneId) {
  // Despawn all live instances of this template in the zone
  const liveData = await API(`/zones/${encodeURIComponent(zoneId)}/live-enemies`).catch(() => []);
  const live = Array.isArray(liveData) ? liveData : [];
  const spawn = zoneEditSpawnsCache.find(s => s.id === spawnId);
  if (spawn) {
    for (const e of live.filter(e => e.templateId === spawn.enemy_id)) {
      await API(`/live-enemies/${encodeURIComponent(e.instanceId)}`, 'DELETE');
    }
  }
  const result = await directAPI(`/spawns/${encodeURIComponent(spawnId)}`, 'DELETE');
  if (result?.error) { toast(result.error, true); return; }
  toast('Enemy removed');
  await refreshEnemiesSection(zoneId);
}
async function despawnAllEnemies() {
  const result = await API('/live-enemies/despawn-all', 'POST');
  if (result?.error) { toast(result.error, true); return; }
  toast(result.message || 'All enemies despawned');
  if (zoneEditCurrentZoneId) await refreshEnemiesSection(zoneEditCurrentZoneId);
}
async function despawnAllZoneEnemies(zoneId) {
  const liveData = await directAPI(`/zones/${encodeURIComponent(zoneId)}/live-enemies`);
  const live = Array.isArray(liveData) ? liveData : [];
  await Promise.all(live.map(e => directAPI(`/live-enemies/${e.id}`, 'DELETE')));
  toast(`Despawned ${live.length} enem${live.length === 1 ? 'y' : 'ies'}`);
  await refreshEnemiesSection(zoneId);
}
async function respawnAllZoneEnemies(zoneId) {
  const spawnsData = await directAPI(`/zones/${encodeURIComponent(zoneId)}/spawns`);
  const spawns = Array.isArray(spawnsData) ? spawnsData : [];
  const results = await Promise.all(spawns.map(s => directAPI(`/zones/${encodeURIComponent(zoneId)}/live-enemies`, 'POST', { enemy_id: s.enemy_id })));
  const spawned = results.filter(r => !r?.skipped && !r?.error).length;
  toast(`Spawned ${spawned} enem${spawned === 1 ? 'y' : 'ies'}`);
  await refreshEnemiesSection(zoneId);
}
async function deleteAllZoneSpawns(zoneId) {
  if (!(await dpConfirm("Delete all enemy spawns from this zone? This can't be undone.", { danger: true }))) return;
  const [spawnsData, liveData] = await Promise.all([
    directAPI(`/zones/${encodeURIComponent(zoneId)}/spawns`),
    directAPI(`/zones/${encodeURIComponent(zoneId)}/live-enemies`),
  ]);
  const spawns = Array.isArray(spawnsData) ? spawnsData : [];
  const live = Array.isArray(liveData) ? liveData : [];
  await Promise.all(live.map(e => directAPI(`/live-enemies/${e.id}`, 'DELETE')));
  await Promise.all(spawns.map(s => directAPI(`/spawns/${encodeURIComponent(s.id)}`, 'DELETE')));
  toast(`Deleted ${spawns.length} spawn${spawns.length === 1 ? '' : 's'}`);
  await refreshEnemiesSection(zoneId);
}

// --- Enemies panel: list view + spawn map ------------------------------------
// The map view answers "where is the danger?" — one region at a time, drawn as a
// deliberately dumb monochrome plan (terrain tones only, no names or icons) with
// a red threat heat overlay on top. Interior rooms have no tile of their own, so
// their spawns are folded onto the building facade you enter them through.
// Tiles are clickable to add/remove spawns without hunting through the Zones editor.
let _enemyView = 'list';          // 'list' | 'map'
let _enemyQuery = '';
let _spawnMapData = null;         // { spawns, zones, regions, mapParents } — fetched once, cached
let _spawnMapZone = null;         // facade/tile zone id whose spawn editor is open
let _spawnMapRegion = null;       // selected region id ('__unassigned' for tiles with no region)
let _spawnMapZ = null;            // selected floor (grid_z); null = pick the busiest one

function enemyViewToggleHtml() {
  const btn = (v, label) =>
    `<button class="action-btn${_enemyView === v ? ' success' : ''}" onclick="setEnemyView('${v}')">${label}</button>`;
  const refresh = _enemyView === 'map'
    ? `<button class="action-btn" onclick="_spawnMapData=null;renderEnemiesPanel()">↻ Refresh</button>` : '';
  return `<div class="panel-sticky-head" style="display:flex;gap:6px;align-items:center;padding:8px 12px;border-bottom:1px solid var(--border);background:var(--bg2)">
    ${btn('list', 'Enemy List')}${btn('map', 'Spawn Map')}${refresh}
  </div>`;
}

function setEnemyView(v) {
  if (_enemyView === v) return;
  _enemyView = v;
  renderEnemiesPanel();
}

function renderEnemiesPanel(records) {
  const all = Array.isArray(records) ? records : allRecords;
  if (_enemyView === 'map') { renderSpawnMap(); return; }
  const q = _enemyQuery;
  const shown = q ? all.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(q))) : all;
  renderTable(PANELS.enemies.columns, shown, false);
  document.getElementById('list-panel').insertAdjacentHTML('afterbegin', enemyViewToggleHtml());
}

function filterEnemies(q) {
  _enemyQuery = (q || '').toLowerCase();
  renderEnemiesPanel();
}

async function renderSpawnMap() {
  const host = document.getElementById('list-panel');
  host.innerHTML = enemyViewToggleHtml() + '<div style="padding:24px;color:var(--text-dim)">Loading spawns...</div>';
  if (!_spawnMapData) {
    const [spawns, zones, regionData, maps] = await Promise.all([
      API('/spawns').catch(() => []),
      API('/zones').catch(() => []),
      API('/maps/regions').catch(() => null),
      API('/maps').catch(() => []),
    ]);
    _spawnMapData = {
      spawns: Array.isArray(spawns) ? spawns : [],
      zones: Array.isArray(zones) ? zones : [],
      regions: new Map((regionData?.regions || []).map(r => [r.id, r.name || r.id])),
      // interior map -> the exterior zone (facade tile) it hangs off
      mapParents: new Map((Array.isArray(maps) ? maps : [])
        .filter(m => m.parent_zone_id).map(m => [m.id, m.parent_zone_id])),
    };
  }
  _spawnMapDraw();
}

function _spawnMapDraw() {
  const host = document.getElementById('list-panel');
  host.innerHTML = enemyViewToggleHtml() + spawnMapBodyHtml();
}

// --- Data shaping ------------------------------------------------------------

// Every spawn keyed by the *tile* it should paint: its own zone if that zone sits
// on the grid, otherwise the facade of the building whose interior map holds it.
// Walks up through nested interior maps so a 4th-floor room still lands on the door.
function _spawnTileZone(zone, zoneById) {
  const seen = new Set();
  let z = zone;
  while (z && !seen.has(z.id)) {
    if (z.grid_x != null && z.grid_y != null) return z;
    seen.add(z.id);
    const parentId = _spawnMapData.mapParents.get(z.map_id);
    z = parentId ? zoneById.get(parentId) : null;
  }
  return null;
}

// { byTile: Map(tileZoneId -> [{zone, spawns}]), orphans: [{zone, spawns}] }
// honouring the search box (matches enemy name).
function _spawnMapIndex() {
  const q = _enemyQuery;
  const zoneById = new Map(_spawnMapData.zones.map(z => [z.id, z]));
  const byZone = new Map();
  for (const s of _spawnMapData.spawns) {
    if (q && !(s.enemy_name || '').toLowerCase().includes(q)) continue;
    if (!byZone.has(s.zone_id)) byZone.set(s.zone_id, []);
    byZone.get(s.zone_id).push(s);
  }
  const byTile = new Map(), orphans = [];
  for (const [zoneId, spawns] of byZone) {
    const zone = zoneById.get(zoneId) || { id: zoneId, name: `${zoneId} (zone missing)` };
    const tile = zoneById.has(zoneId) ? _spawnTileZone(zone, zoneById) : null;
    if (!tile) {
      orphans.push({ zone, spawns });
      byTile.set(zone.id, [{ zone, spawns }]);   // so the detail editor still opens for them
      continue;
    }
    if (!byTile.has(tile.id)) byTile.set(tile.id, []);
    byTile.get(tile.id).push({ zone, spawns });
  }
  return { byTile, orphans, zoneById };
}

// The Under carries no region_id (it's a district, not a region) but it's a whole
// map's worth of danger, so it gets its own bucket instead of drowning in the
// unassigned pile beside stray basin tiles.
const _spawnRegionOf = z =>
  z.flags?.region_id || (z.flags?.district === 'sewer' ? '__under' : '__unassigned');
const _spawnRegionName = rid =>
  rid === '__under' ? 'The Under (sewers)'
  : rid === '__unassigned' ? 'Unassigned tiles'
  : (_spawnMapData.regions.get(rid) || rid);

// --- Threat ------------------------------------------------------------------
// Rough power score for one enemy definition — HP + average swing + accuracy.
function enemyThreat(enemyId) {
  const e = (allRecords || []).find(r => r.id === enemyId);
  if (!e) return 1;
  const weapon = Array.isArray(e.weapon) ? e.weapon : [];
  const dmg = weapon.reduce((n, c) => n + ((+c.min || 0) + (+c.max || 0)) / 2, 0);
  return Math.max(1, (+e.hp_max || 30) / 10 + dmg * 2 + (+e.hit || 0));
}
// Total threat parked on a zone: every spawn's power × how many of them stand up.
function zoneThreat(list) {
  return (list || []).reduce((n, s) => n + enemyThreat(s.enemy_id) * (+s.max_count || 1), 0);
}
// Threat of a whole tile — its own spawns plus every interior room folded onto it.
function tileThreat(entries) {
  return (entries || []).reduce((n, e) => n + zoneThreat(e.spawns), 0);
}

// --- Monochrome terrain base -------------------------------------------------
// One accent hue, four tones. Enough to read coastline, roads and blocks at a
// glance; never enough to compete with the red on top.
const SPAWN_MAP_INK = '150,190,210';
const SPAWN_TERRAIN_TONE = {
  water: 0.10, marsh: 0.13,
  grass: 0.19, park: 0.19, scrub: 0.19,
  sand: 0.24, dirt: 0.24, dirt_road: 0.26, gravel: 0.26, redrock: 0.24, ash: 0.22,
  road: 0.34, asphalt: 0.34, concrete: 0.38, dock: 0.30,
};
const SPAWN_TILE_DEFAULT = 0.16;   // placed tile with no authored terrain
const SPAWN_TILE_BUILDING = 0.62;  // facades read as solid mass

function _spawnTileIsBuilding(z) {
  return !!(z.flags?.building_type || z.flags?.is_building);
}
function _spawnTileTone(z) {
  if (_spawnTileIsBuilding(z)) return SPAWN_TILE_BUILDING;
  if (z.flags?.runway) return 0.42;
  const t = z.flags?.terrain;
  return (t && SPAWN_TERRAIN_TONE[t] != null) ? SPAWN_TERRAIN_TONE[t] : SPAWN_TILE_DEFAULT;
}

// --- Render ------------------------------------------------------------------

function spawnMapBodyHtml() {
  const { byTile, orphans, zoneById } = _spawnMapIndex();

  // Regions that actually have placed tiles, ordered by how much threat they hold.
  const regionTiles = new Map();   // rid -> tile zones
  for (const z of _spawnMapData.zones) {
    if (z.grid_x == null || z.grid_y == null) continue;
    const rid = _spawnRegionOf(z);
    if (!regionTiles.has(rid)) regionTiles.set(rid, []);
    regionTiles.get(rid).push(z);
  }
  const regions = [...regionTiles.entries()].map(([rid, tiles]) => ({
    rid, tiles,
    name: _spawnRegionName(rid),
    threat: tiles.reduce((n, z) => n + tileThreat(byTile.get(z.id)), 0),
    spawns: tiles.reduce((n, z) => n + (byTile.get(z.id) || []).reduce((m, e) => m + e.spawns.length, 0), 0),
  })).sort((a, b) => b.threat - a.threat || a.name.localeCompare(b.name));

  if (!regions.length) return '<div style="padding:24px;color:var(--text-dim)">No placed tiles to map.</div>';
  if (!regions.some(r => r.rid === _spawnMapRegion)) _spawnMapRegion = regions[0].rid;
  const sel = regions.find(r => r.rid === _spawnMapRegion);

  const options = regions.map(r =>
    `<option value="${r.rid}"${r.rid === _spawnMapRegion ? ' selected' : ''}>${r.name} — ${r.spawns} spawn${r.spawns === 1 ? '' : 's'}</option>`).join('');

  // Floors are separate *places*, not storeys of one thing — the Under sits at
  // z=-1 under the same x/y as the streets above it — so one floor draws at a
  // time and the rest are a click away.
  const floors = [...new Set(sel.tiles.map(z => z.grid_z ?? 0))].sort((a, b) => b - a);
  const floorSpawns = z => sel.tiles.filter(t => (t.grid_z ?? 0) === z)
    .reduce((n, t) => n + (byTile.get(t.id) || []).reduce((m, e) => m + e.spawns.length, 0), 0);
  if (!floors.includes(_spawnMapZ)) {
    // Default to the busiest floor so a region whose only danger is underground
    // doesn't open on an empty street plan.
    _spawnMapZ = floors.slice().sort((a, b) => floorSpawns(b) - floorSpawns(a) || b - a)[0] ?? 0;
  }
  const onFloor = sel.tiles.filter(z => (z.grid_z ?? 0) === _spawnMapZ);
  const here = floorSpawns(_spawnMapZ);

  const floorNav = floors.length > 1 ? `<div class="field" style="flex:0 0 auto"><label>Floor</label>
    <div style="display:flex;align-items:center;gap:4px">
      <button class="action-btn" onclick="spawnMapStepZ(-1)"${_spawnMapZ === floors[floors.length - 1] ? ' disabled' : ''}>▾</button>
      <span style="min-width:52px;text-align:center;font-size:12px">z = ${_spawnMapZ}</span>
      <button class="action-btn" onclick="spawnMapStepZ(1)"${_spawnMapZ === floors[0] ? ' disabled' : ''}>▴</button>
      <span style="font-size:10px;color:var(--text-dim)">${floors.map(z =>
        `<a href="#" onclick="spawnMapSetZ(${z});return false" style="color:${z === _spawnMapZ ? 'var(--text)' : 'var(--text-dim)'};text-decoration:none;padding:0 3px">${z}${floorSpawns(z) ? '•' : ''}</a>`).join('')}</span>
    </div></div>` : '';

  let html = `<div style="display:flex;gap:10px;align-items:flex-end;padding:10px 12px">
    <div class="field" style="flex:0 0 260px"><label>Region</label>
      <select id="spawn-map-region" onchange="spawnMapSetRegion(this.value)">${options}</select></div>
    ${floorNav}
    <div style="color:var(--text-dim);font-size:11px;padding-bottom:6px">
      ${here} spawn${here === 1 ? '' : 's'} on this floor${floors.length > 1 ? ` of ${sel.spawns} in the region` : ''}${_enemyQuery ? ` (filtered by "${_enemyQuery}")` : ''} — click a tile to add or remove spawns. Interior rooms fold onto their building's facade.
    </div>
  </div>`;

  html += onFloor.length
    ? `<div style="padding:0 12px 12px">${spawnRegionMapHtml(onFloor, byTile)}</div>`
    : `<div style="padding:24px;color:var(--text-dim)">No placed tiles on floor z=${_spawnMapZ}.</div>`;
  html += spawnHeatLegendHtml();
  html += `<div id="spawn-detail">${spawnDetailHtml(zoneById.get(_spawnMapZone) || null, byTile)}</div>`;

  if (orphans.length) {
    html += `<div style="border-top:1px solid var(--border);padding:8px 12px">
      <b>Spawns with no tile</b> <span style="color:var(--text-dim);font-size:11px">${orphans.length}</span>
      ${orphans.map(o => `<div class="zone-subitem-row" onclick='spawnTileSelect(${JSON.stringify(o.zone.id)})' style="cursor:pointer">
        <span>${o.zone.name || o.zone.id} <span style="color:var(--text-dim);font-size:11px">· ${o.spawns.map(s => `${s.enemy_name} ×${s.max_count}`).join(', ')}</span></span>
      </div>`).join('')}
    </div>`;
  }
  return html;
}

function spawnMapSetRegion(rid) {
  _spawnMapRegion = rid;
  _spawnMapZone = null;
  _spawnMapZ = null;      // re-pick the busiest floor of the new region
  _spawnMapDraw();
}

function spawnMapSetZ(z) {
  _spawnMapZ = z;
  _spawnMapZone = null;
  _spawnMapDraw();
}

// Step to the next floor that actually has tiles, so ▾/▴ never lands on a gap.
function spawnMapStepZ(delta) {
  const tiles = (_spawnMapData?.zones || []).filter(z =>
    z.grid_x != null && z.grid_y != null && _spawnRegionOf(z) === _spawnMapRegion);
  const floors = [...new Set(tiles.map(z => z.grid_z ?? 0))].sort((a, b) => a - b);
  const next = delta > 0 ? floors.find(z => z > _spawnMapZ)
                         : floors.slice().reverse().find(z => z < _spawnMapZ);
  if (next != null) spawnMapSetZ(next);
}

// One floor of the region on one plan: terrain tone underneath, red on top.
// Tiles arrive pre-filtered to the selected grid_z.
function spawnRegionMapHtml(tiles, byTile) {
  const xs = tiles.map(z => z.grid_x), ys = tiles.map(z => z.grid_y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const cols = maxX - minX + 1, rows = maxY - minY + 1;
  const cell = Math.max(4, Math.min(18, Math.floor(880 / cols)));

  // Normally one zone per coord on a floor; if two overlap, the lower one draws
  // and the threat still sums across both.
  const byCoord = new Map();
  for (const z of tiles) {
    const key = `${z.grid_x},${z.grid_y}`;
    const cur = byCoord.get(key);
    if (!cur || (z.grid_z ?? 0) < (cur.grid_z ?? 0)) byCoord.set(key, z);
  }
  const stack = new Map();   // coord -> zones on it
  for (const z of tiles) {
    const key = `${z.grid_x},${z.grid_y}`;
    if (!stack.has(key)) stack.set(key, []);
    stack.get(key).push(z);
  }

  let peak = 0;
  const threatByCoord = new Map();
  for (const [key, list] of stack) {
    const t = list.reduce((n, z) => n + tileThreat(byTile.get(z.id)), 0);
    threatByCoord.set(key, t);
    if (t > peak) peak = t;
  }

  let html = `<div style="display:grid;grid-template-columns:repeat(${cols},${cell}px);grid-auto-rows:${cell}px;gap:1px;width:max-content">`;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const key = `${x},${y}`;
      const z = byCoord.get(key);
      if (!z) { html += '<div></div>'; continue; }
      const tone = _spawnTileTone(z);
      const threat = threatByCoord.get(key) || 0;
      // sqrt ramp so a lone weak spawn still reads, without washing out the peak.
      const t = peak > 0 && threat > 0 ? Math.sqrt(threat / peak) : 0;
      const heat = t ? `<div style="position:absolute;inset:0;background:rgba(255,48,48,${(0.2 + 0.8 * t).toFixed(3)})"></div>` : '';
      const border = _spawnTileIsBuilding(z) ? `;box-shadow:inset 0 0 0 1px rgba(${SPAWN_MAP_INK},0.85)` : '';
      const entries = (stack.get(key) || []).flatMap(zz => byTile.get(zz.id) || []);
      const detail = entries.length
        ? `\n${entries.flatMap(e => e.spawns.map(s => `${s.enemy_name} ×${s.max_count}${e.zone.id === z.id ? '' : ` (${e.zone.name || e.zone.id})`}`)).join('\n')}\nthreat ${Math.round(threat)}`
        : '';
      const isSel = (stack.get(key) || []).some(zz => zz.id === _spawnMapZone);
      html += `<div class="spawn-heat-tile${isSel ? ' spawn-heat-sel' : ''}" style="position:relative;background:rgba(${SPAWN_MAP_INK},${tone})${border}"
        title="${(z.name || z.id).replace(/"/g, '&quot;')}${detail}"
        onclick='spawnTileSelect(${JSON.stringify(z.id)})'>${heat}</div>`;
    }
  }
  return html + '</div>';
}

function spawnHeatLegendHtml() {
  const heat = t => `<span style="display:inline-block;width:16px;height:12px;background:rgba(${SPAWN_MAP_INK},${SPAWN_TILE_DEFAULT});position:relative"><span style="position:absolute;inset:0;background:rgba(255,48,48,${(0.2 + 0.8 * t).toFixed(2)})"></span></span>`;
  const ink = (a, label) => `<span style="display:inline-flex;gap:4px;align-items:center"><span style="display:inline-block;width:12px;height:12px;background:rgba(${SPAWN_MAP_INK},${a})"></span>${label}</span>`;
  return `<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:0 12px 10px;font-size:10px;color:var(--text-dim)">
    <span style="display:flex;gap:4px;align-items:center"><span>quiet</span>${[0.15, 0.4, 0.7, 1].map(heat).join('')}<span>deadly</span></span>
    <span style="opacity:0.7">count × strength</span>
    <span style="display:flex;gap:10px;align-items:center;margin-left:auto">
      ${ink(SPAWN_TERRAIN_TONE.water, 'water')}${ink(SPAWN_TERRAIN_TONE.grass, 'open')}${ink(SPAWN_TERRAIN_TONE.road, 'paved')}${ink(SPAWN_TILE_BUILDING, 'building')}
    </span>
  </div>`;
}

function spawnTileSelect(zoneId) {
  _spawnMapZone = _spawnMapZone === zoneId ? null : zoneId;
  _spawnMapDraw();
  document.getElementById('spawn-detail')?.scrollIntoView({ block: 'nearest' });
}

// The clicked tile plus every interior room folded onto it — you edit the tile's
// own spawns here, and can strip a room's spawns without leaving the map.
function spawnDetailHtml(zone, byTile) {
  if (!zone) return '';
  const entries = byTile.get(zone.id) || [];
  const own = entries.find(e => e.zone.id === zone.id);
  const inside = entries.filter(e => e.zone.id !== zone.id);
  const zoneArg = JSON.stringify(zone.id);
  const options = allRecords.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    .map(e => `<option value="${e.id}">${e.name}</option>`).join('');
  const spawnRow = (s, label) => `<div class="zone-subitem-row">
      <span>${s.enemy_name} <span style="color:var(--text-dim);font-size:11px">· ×${s.max_count} · ${s.respawn_seconds}s · weight ${s.spawn_weight}${label ? ` · ${label}` : ''}</span></span>
      <span class="zone-subitem-actions">
        <button class="action-btn danger" onclick='spawnMapDelete(${JSON.stringify(s.id)})'>Remove</button>
      </span>
    </div>`;
  const rows = (own ? own.spawns.map(s => spawnRow(s, '')).join('') : '')
    + inside.map(e => e.spawns.map(s => spawnRow(s, e.zone.name || e.zone.id)).join('')).join('');
  return `<div class="zone-inline-form" style="margin:0 12px 12px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <b>${zone.name || zone.id}</b>
      <button class="action-btn" onclick='spawnTileSelect(${zoneArg})'>Close</button>
    </div>
    ${rows || '<div class="zone-subitem-empty">No spawns here.</div>'}
    <div class="field-row" style="gap:8px;align-items:flex-end;margin-top:8px">
      <div class="field"><label>Enemy</label><select id="sm-enemy">${options || '<option value="">— no enemies defined —</option>'}</select></div>
      <div class="field"><label>Max</label><input id="sm-max" type="number" value="1" min="1" style="width:60px"></div>
      <div class="field"><label>Respawn (s)</label><input id="sm-respawn" type="number" value="300" min="1" style="width:80px"></div>
      <div class="field"><label>Weight</label><input id="sm-weight" type="number" value="100" min="0" max="100" style="width:70px"></div>
      <button class="action-btn success" onclick='spawnMapAdd(${zoneArg})'>Add Spawn</button>
    </div>
  </div>`;
}

async function spawnMapAdd(zoneId) {
  const enemy_id = document.getElementById('sm-enemy')?.value;
  if (!enemy_id) { toast('Pick an enemy', true); return; }
  const row = await directAPI('/spawns', 'POST', {
    zone_id: zoneId,
    enemy_id,
    max_count: parseInt(document.getElementById('sm-max').value) || 1,
    respawn_seconds: parseInt(document.getElementById('sm-respawn').value) || 300,
    spawn_weight: parseInt(document.getElementById('sm-weight').value) || 100,
  });
  if (row?.error) { toast(row.error, true); return; }
  _spawnMapData.spawns.push(row);
  toast('Spawn added');
  _spawnMapDraw();
}

async function spawnMapDelete(spawnId) {
  const result = await directAPI(`/spawns/${encodeURIComponent(spawnId)}`, 'DELETE');
  if (result?.error) { toast(result.error, true); return; }
  _spawnMapData.spawns = _spawnMapData.spawns.filter(s => s.id !== spawnId);
  toast('Spawn removed');
  _spawnMapDraw();
}

// Furniture
let _lootItems = [];
function lootItemOptions(items, selectedId) {
  const opts = items.map(it => `<option value="${it.id}" ${it.id===selectedId?'selected':''}>${it.name} (${it.id})</option>`);
  if (selectedId && !items.some(it => it.id===selectedId)) opts.unshift(`<option value="${selectedId}" selected>${selectedId} (missing!)</option>`);
  return opts.join('');
}
function lootRow(items, entry) {
  const e = entry || {};
  const min = Array.isArray(e.qty) ? e.qty[0] : (e.qty ?? 1);
  const max = Array.isArray(e.qty) ? e.qty[1] : (e.qty ?? 1);
  const sel = e.item || '';
  return `<div class="loot-row field-row" style="align-items:flex-end;gap:6px">
    <div class="field" style="flex:2"><label>Item</label>
      <select class="loot-item">${sel?'':'<option value="">— select item —</option>'}${lootItemOptions(items, sel)}</select>
    </div>
    <div class="field" style="flex:0 0 78px"><label>Chance %</label><input type="number" class="loot-weight" value="${e.weight ?? 100}" min="0" max="100" step="1"></div>
    <div class="field" style="flex:0 0 62px"><label>Qty min</label><input type="number" class="loot-min" value="${min}" min="1" step="1"></div>
    <div class="field" style="flex:0 0 62px"><label>Qty max</label><input type="number" class="loot-max" value="${max}" min="1" step="1"></div>
    <button type="button" class="action-btn" onclick="removeLootRow(this)" style="flex:0 0 auto">×</button>
  </div>`;
}
function addLootRow() {
  document.getElementById('loot-rows').insertAdjacentHTML('beforeend', lootRow(_lootItems, {}));
}
function removeLootRow(btn) { btn.closest('.loot-row').remove(); }

// Butcher table — same shape as loot, but rolled per-item against the body's
// butcher difficulty when a player butchers the corpse.
function butcherRow(items, entry) {
  const e = entry || {};
  const min = Array.isArray(e.qty) ? e.qty[0] : (e.qty ?? 1);
  const max = Array.isArray(e.qty) ? e.qty[1] : (e.qty ?? 1);
  const sel = e.item || '';
  return `<div class="butcher-row field-row" style="align-items:flex-end;gap:6px">
    <div class="field" style="flex:2"><label>Item</label>
      <select class="butcher-item">${sel?'':'<option value="">— select item —</option>'}${lootItemOptions(items, sel)}</select>
    </div>
    <div class="field" style="flex:0 0 62px"><label>Qty min</label><input type="number" class="butcher-min" value="${min}" min="1" step="1"></div>
    <div class="field" style="flex:0 0 62px"><label>Qty max</label><input type="number" class="butcher-max" value="${max}" min="1" step="1"></div>
    <button type="button" class="action-btn" onclick="removeButcherRow(this)" style="flex:0 0 auto">×</button>
  </div>`;
}
function addButcherRow() {
  document.getElementById('butcher-rows').insertAdjacentHTML('beforeend', butcherRow(_lootItems, {}));
}
function removeButcherRow(btn) { btn.closest('.butcher-row').remove(); }

// Damage types shared by weapon components and per-part soak. Mirrors the
// item tag catalog's damage_type options.
const ENEMY_DAMAGE_TYPES = ['kinetic','edged','energy','fire','radiation'];
// Must mirror combat.js DEFAULT_BODY_PART_WEIGHTS / PART_TO_SLOT — including
// `feet`, or monsters built here can never be struck on the feet (boot soak
// would never apply against them).
const ENEMY_BODY_PARTS = ['head','torso','left_arm','right_arm','left_leg','right_leg','feet'];
const DEFAULT_BODY_PART_WEIGHTS = { head:10, torso:40, left_arm:12, right_arm:12, left_leg:11, right_leg:11, feet:4 };

// --- Enemy weapon (typed multi-component damage) ---
function weaponRow(comp) {
  const c = comp || {};
  const type = c.type || 'kinetic';
  return `<div class="weapon-row field-row" style="align-items:flex-end;gap:6px">
    <div class="field" style="flex:2"><label>Type</label>
      <select class="wpn-type">${ENEMY_DAMAGE_TYPES.map(t=>`<option ${t===type?'selected':''}>${t}</option>`).join('')}</select>
    </div>
    <div class="field" style="flex:0 0 62px"><label>Min</label><input type="number" class="wpn-min" value="${c.min ?? 1}" min="0" step="1"></div>
    <div class="field" style="flex:0 0 62px"><label>Max</label><input type="number" class="wpn-max" value="${c.max ?? 2}" min="0" step="1"></div>
    <button type="button" class="action-btn" onclick="removeWeaponRow(this)" style="flex:0 0 auto">×</button>
  </div>`;
}
function addWeaponRow() {
  document.getElementById('weapon-rows').insertAdjacentHTML('beforeend', weaponRow({}));
}
function removeWeaponRow(btn) { btn.closest('.weapon-row').remove(); }

// --- Enemy body parts (hit % + per-part typed soak) ---
function bodyPartRow(entry) {
  const e = entry || {};
  const part = e.part || 'torso';
  const soak = (e.soak && typeof e.soak === 'object') ? e.soak : {};
  return `<div class="bodypart-row field-row" style="align-items:flex-end;gap:6px">
    <div class="field" style="flex:0 0 110px"><label>Part</label>
      <select class="bp-part">${ENEMY_BODY_PARTS.map(p=>`<option ${p===part?'selected':''}>${p}</option>`).join('')}</select>
    </div>
    <div class="field" style="flex:0 0 70px"><label>Hit %</label><input type="number" class="bp-weight" value="${e.weight ?? 10}" min="0" step="1"></div>
    <div class="field" style="flex:2"><label>Soak (JSON, e.g. {"kinetic":3})</label><input class="bp-soak" value='${JSON.stringify(soak)}'></div>
    <button type="button" class="action-btn" onclick="removeBodyPartRow(this)" style="flex:0 0 auto">×</button>
  </div>`;
}
function addBodyPartRow() {
  document.getElementById('bodypart-rows').insertAdjacentHTML('beforeend', bodyPartRow({}));
}
function removeBodyPartRow(btn) { btn.closest('.bodypart-row').remove(); }
// Standard hit-location spread, with empty soak — the default for a new monster.
function defaultBodyParts() {
  return ENEMY_BODY_PARTS.map(p => ({ part: p, weight: DEFAULT_BODY_PART_WEIGHTS[p], soak: {} }));
}

function lootItemList(published) {
  // Mirror the loadPanel staging overlay so unpublished items are selectable too.
  let items = Array.isArray(published) ? published.slice() : [];
  if (stagingEnabled && pendingChanges.length) {
    const staged = pendingChanges.filter(c => c.entityType === 'item');
    const stagedById = new Map(staged.map(c => [c.entityId, c]));
    items = items.flatMap(r => {
      const s = stagedById.get(r.id);
      if (s?.changeType === 'delete') return [];
      if (s?.changeType === 'update') return [{ ...r, ...s.stagedData }];
      return [r];
    });
    for (const s of staged) {
      if (s.changeType === 'create' && !items.some(r => r.id === s.entityId)) {
        items.push({ ...s.stagedData, id: s.entityId });
      }
    }
  }
  return items.sort((a,b)=>(a.name||'').localeCompare(b.name||''));
}

let _enemyBehaviourGraph = {};

function enemyOpenVineAI() {
  let graph;
  try { graph = JSON.parse(document.getElementById('f-behaviour_graph').value || '{}'); }
  catch { toast('Behaviour graph: invalid JSON — fix it before opening the visual editor.', true); return; }
  const graphData = VineAISchema.fromAiGraph(graph);
  vineModalOpen(
    `AI Behaviour: ${currentRecord?.name || 'Enemy'}`,
    VineAISchema,
    graphData,
    (savedGraph) => {
      const out = VineAISchema.toAiGraph(savedGraph);
      _enemyBehaviourGraph = out;
      document.getElementById('f-behaviour_graph').value = JSON.stringify(out, null, 2);
      toast('Behaviour graph saved to form — click Save to persist.');
    },
    null,
    vineFamilyTabs('ai')
  );
}

async function enemyEditForm(rec, isNew) {
  _lootItems = lootItemList(await API('/items'));
  const loot = Array.isArray(rec.loot_table) ? rec.loot_table : JSON.parse(rec.loot_table||'[]');
  let weapon = Array.isArray(rec.weapon) ? rec.weapon : JSON.parse(rec.weapon||'[]');
  if (!weapon.length) weapon = [{ type:'kinetic', min:1, max:2 }];
  let bodyParts = Array.isArray(rec.body_parts) ? rec.body_parts : JSON.parse(rec.body_parts||'[]');
  if (!bodyParts.length) bodyParts = defaultBodyParts();
  const butcher = Array.isArray(rec.butcher_table) ? rec.butcher_table : JSON.parse(rec.butcher_table||'[]');
  const behaviourGraph = typeof rec.behaviour_graph === 'object' ? rec.behaviour_graph : JSON.parse(rec.behaviour_graph||'{}');
  _enemyBehaviourGraph = behaviourGraph;
  return `
    <div class="field"><label>Enemy ID</label><input id="f-id" value="${isNew?'':rec.id}" ${!isNew?'readonly style="opacity:0.5"':''}></div>
    <div class="field"><label>Name</label><input id="f-name" value="${rec.name||''}" ${isNew?'oninput="document.getElementById(\'f-id\').value=this.value.toLowerCase().replace(/\\s+/g,\'_\')"':''}></div>
    <div class="field"><label>Description</label><textarea id="f-description">${rec.description||''}</textarea></div>
    <div class="field"><label>Death Message</label><textarea id="f-death_message" rows="2">${rec.death_message||''}</textarea></div>
    <div class="field-row">
      <div class="field"><label>Behavior</label>
        <select id="f-behavior">
          ${['aggressive','territorial','patrol','defensive','passive'].map(b=>`<option ${rec.behavior===b?'selected':''}>${b}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Faction</label><input id="f-faction" value="${rec.faction||''}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Hit (attack rating)</label><input type="number" id="f-hit" value="${rec.hit ?? 1}" min="0"></div>
      <div class="field"><label>Dodge (defense rating)</label><input type="number" id="f-dodge" value="${rec.dodge ?? 1}" min="0"></div>
      <div class="field"><label>HP Max</label><input type="number" id="f-hp_max" value="${rec.hp_max||30}"></div>
    </div>
    <div class="field"><label>Weapon — typed damage components (e.g. 1-2 kinetic + 2-3 energy)</label>
      <div id="weapon-rows">${weapon.map(c=>weaponRow(c)).join('')}</div>
      <button type="button" class="action-btn" onclick="addWeaponRow()" style="margin-top:6px">+ Add Damage Type</button>
    </div>
    <div class="field"><label>Body Parts — hit % and per-part soak (defaults to the standard spread)</label>
      <div id="bodypart-rows">${bodyParts.map(e=>bodyPartRow(e)).join('')}</div>
      <button type="button" class="action-btn" onclick="addBodyPartRow()" style="margin-top:6px">+ Add Body Part</button>
    </div>
    <div class="field"><label>Loot Drops</label>
      <div id="loot-rows">${loot.map(e=>lootRow(_lootItems, e)).join('')}</div>
      <button type="button" class="action-btn" onclick="addLootRow()" style="margin-top:6px">+ Add Drop</button>
    </div>
    <div class="field"><label>Butcher Difficulty — skill check target for each carve (0 = trivial). Leave the table empty to make this enemy non-butcherable.</label><input type="number" id="f-butcher_difficulty" value="${rec.butcher_difficulty ?? 5}" min="0" step="1"></div>
    <div class="field"><label>Butcher Drops — carved with the Butchering skill (knife required)</label>
      <div id="butcher-rows">${butcher.map(e=>butcherRow(_lootItems, e)).join('')}</div>
      <button type="button" class="action-btn" onclick="addButcherRow()" style="margin-top:6px">+ Add Butcher Drop</button>
    </div>
    <div class="field"><label>First Strike Delay (ms) — hesitation before its first attack after aggroing. 0 = attacks immediately.</label><input type="number" id="f-first_strike_delay_ms" value="${rec.flags?.first_strike_delay_ms||0}" min="0" step="500"></div>
    <div class="field"><label>Battle Cries (one per line) — shown on its first strike</label><textarea id="f-battle_cries" rows="3">${(rec.flags?.battle_cries||[]).join('\n')}</textarea></div>
    <div class="field"><label><input type="checkbox" id="f-attacks_npcs" ${rec.flags?.attacks_npcs?'checked':''}> Attacks NPCs — will target and fight NPCs in the zone</label></div>
    <div class="field">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <label>AI Behaviour Graph (JSON) — leave empty to use hardcoded behavior field above</label>
        <button type="button" class="action-btn" onclick="enemyOpenVineAI()">🌿 AI Behaviour</button>
      </div>
      <textarea id="f-behaviour_graph" rows="6">${JSON.stringify(behaviourGraph, null, 2)}</textarea>
    </div>
  `;
}

// --- Mutation forms ---
async function saveEnemy(existing) {
  const isNew = !existing?.id;
  const loot = [];
  for (const row of document.querySelectorAll('#loot-rows .loot-row')) {
    const item = row.querySelector('.loot-item').value;
    if (!item) continue;
    const weight = +row.querySelector('.loot-weight').value || 0;
    let min = +row.querySelector('.loot-min').value || 1;
    let max = +row.querySelector('.loot-max').value || 1;
    if (min < 1) min = 1;
    if (max < min) max = min;
    loot.push({ item, weight, qty: [min, max] });
  }
  const butcher_table = [];
  for (const row of document.querySelectorAll('#butcher-rows .butcher-row')) {
    const item = row.querySelector('.butcher-item').value;
    if (!item) continue;
    let min = +row.querySelector('.butcher-min').value || 1;
    let max = +row.querySelector('.butcher-max').value || 1;
    if (min < 1) min = 1;
    if (max < min) max = min;
    butcher_table.push({ item, qty: [min, max] });
  }
  const weapon = [];
  for (const row of document.querySelectorAll('#weapon-rows .weapon-row')) {
    const type = row.querySelector('.wpn-type').value;
    let min = +row.querySelector('.wpn-min').value || 0;
    let max = +row.querySelector('.wpn-max').value || 0;
    if (max < min) max = min;
    weapon.push({ type, min, max });
  }
  const body_parts = [];
  for (const row of document.querySelectorAll('#bodypart-rows .bodypart-row')) {
    const part = row.querySelector('.bp-part').value;
    const weight = +row.querySelector('.bp-weight').value || 0;
    let soak;
    try { soak = JSON.parse(row.querySelector('.bp-soak').value || '{}'); }
    catch { return { error: `Body part ${part}: soak is invalid JSON` }; }
    body_parts.push({ part, weight, soak });
  }
  const existingFlags = existing?.flags || {};
  const cries = document.getElementById('f-battle_cries').value.split('\n').map(s=>s.trim()).filter(Boolean);
  const flags = { ...existingFlags, first_strike_delay_ms: +document.getElementById('f-first_strike_delay_ms').value || 0, battle_cries: cries, attacks_npcs: document.getElementById('f-attacks_npcs')?.checked || false };
  let behaviour_graph = {};
  try { behaviour_graph = JSON.parse(document.getElementById('f-behaviour_graph')?.value || '{}'); }
  catch { return { error: 'Behaviour graph: invalid JSON' }; }
  const body = {
    name: document.getElementById('f-name').value,
    description: document.getElementById('f-description').value,
    death_message: document.getElementById('f-death_message').value,
    behavior: document.getElementById('f-behavior').value,
    faction: document.getElementById('f-faction').value || null,
    hit: +document.getElementById('f-hit').value || 0,
    dodge: +document.getElementById('f-dodge').value || 0,
    hp_max: +document.getElementById('f-hp_max').value,
    weapon,
    body_parts,
    loot_table: loot,
    butcher_table,
    butcher_difficulty: +document.getElementById('f-butcher_difficulty').value || 0,
    flags,
    behaviour_graph,
  };
  if (isNew) { body.id = document.getElementById('f-id').value.trim(); return API('/enemies', 'POST', body); }
  return API(`/enemies/${existing.id}`, 'PUT', body);
}

// --- Item forms (tag-driven; the catalog is the single source of truth) ---
