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
  if (!(await dpConfirm('Delete all enemy spawns from this zone? This cannot be undone.', { danger: true }))) return;
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
// The map view answers "where does this thing actually spawn?" — every zone_spawns
// row in the world, laid over the map grid, grouped by region. Tiles are clickable
// to add/remove spawns without hunting through the Zones editor.
let _enemyView = 'list';          // 'list' | 'map'
let _enemyQuery = '';
let _spawnMapData = null;         // { spawns, zones, regionNames } — fetched once, cached
let _spawnMapZone = null;         // zone id whose spawn editor is open
const _spawnMapCollapsed = new Set();

function enemyViewToggleHtml() {
  const btn = (v, label) =>
    `<button class="action-btn${_enemyView === v ? ' success' : ''}" onclick="setEnemyView('${v}')">${label}</button>`;
  const refresh = _enemyView === 'map'
    ? `<button class="action-btn" onclick="_spawnMapData=null;renderEnemiesPanel()">↻ Refresh</button>` : '';
  return `<div style="display:flex;gap:6px;align-items:center;padding:8px 12px;border-bottom:1px solid var(--border)">
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
    const [spawns, zones, regionData] = await Promise.all([
      API('/spawns').catch(() => []),
      API('/zones').catch(() => []),
      API('/maps/regions').catch(() => null),
    ]);
    _spawnMapData = {
      spawns: Array.isArray(spawns) ? spawns : [],
      zones: Array.isArray(zones) ? zones : [],
      regionNames: new Map((regionData?.regions || []).map(r => [r.id, r.name])),
    };
  }
  host.innerHTML = enemyViewToggleHtml() + spawnMapBodyHtml();
  applyMapScale(host);
}

// Spawns keyed by zone, honouring the search box (matches enemy name).
function _spawnsByZone() {
  const q = _enemyQuery;
  const byZone = new Map();
  for (const s of _spawnMapData.spawns) {
    if (q && !(s.enemy_name || '').toLowerCase().includes(q)) continue;
    if (!byZone.has(s.zone_id)) byZone.set(s.zone_id, []);
    byZone.get(s.zone_id).push(s);
  }
  return byZone;
}

function spawnMapBodyHtml() {
  const { zones, regionNames } = _spawnMapData;
  const byZone = _spawnsByZone();
  const zoneById = new Map(zones.map(z => [z.id, z]));

  // Placed tiles group by region + floor; everything else (interiors, stale rows)
  // falls into a flat list at the bottom.
  const groups = new Map();   // regionId -> Map(floor -> zones[])
  const loose = [];
  for (const z of zones) {
    if (z.grid_x == null || z.grid_y == null) { if (byZone.has(z.id)) loose.push(z); continue; }
    const rid = z.flags?.region_id || '__unassigned';
    if (!groups.has(rid)) groups.set(rid, new Map());
    const floors = groups.get(rid);
    const f = z.grid_z ?? 0;
    if (!floors.has(f)) floors.set(f, []);
    floors.get(f).push(z);
  }
  for (const zoneId of byZone.keys()) {
    if (!zoneById.has(zoneId)) loose.push({ id: zoneId, name: `${zoneId} (zone missing)` });
  }

  const sections = [...groups.entries()].map(([rid, floors]) => {
    const all = [...floors.values()].flat();
    const count = all.reduce((n, z) => n + (byZone.get(z.id)?.length || 0), 0);
    const name = rid === '__unassigned' ? 'Unassigned tiles' : (regionNames.get(rid) || rid);
    return { rid, floors, count, name };
  }).sort((a, b) => (b.count > 0) - (a.count > 0) || a.name.localeCompare(b.name));

  const total = [...byZone.values()].reduce((n, l) => n + l.length, 0);
  let html = `<div style="padding:10px 12px;color:var(--text-dim);font-size:11px">
    ${total} spawn${total === 1 ? '' : 's'} across ${byZone.size} zone${byZone.size === 1 ? '' : 's'}${_enemyQuery ? ` (filtered by "${_enemyQuery}")` : ''} — click a tile to add or remove spawns.
  </div>`;
  html += `<div id="spawn-detail">${spawnDetailHtml(zoneById.get(_spawnMapZone) || (_spawnMapZone ? { id: _spawnMapZone, name: _spawnMapZone } : null), byZone)}</div>`;

  for (const sec of sections) {
    const open = !_spawnMapCollapsed.has(sec.rid) && sec.count > 0;
    html += `<div style="border-top:1px solid var(--border)">
      <div style="padding:8px 12px;cursor:pointer;display:flex;gap:8px;align-items:center"
           onclick='toggleSpawnRegion(${JSON.stringify(sec.rid)})'>
        <span style="color:var(--text-dim)">${open ? '▾' : '▸'}</span>
        <b>${sec.name}</b>
        <span style="color:${sec.count ? 'var(--accent2)' : 'var(--text-dim)'};font-size:11px">${sec.count} spawn${sec.count === 1 ? '' : 's'}</span>
      </div>`;
    if (open) {
      for (const [floor, list] of [...sec.floors.entries()].sort((a, b) => a[0] - b[0])) {
        const label = sec.floors.size > 1 ? `<div style="padding:2px 12px;font-size:10px;color:var(--text-dim)">Floor ${floor}</div>` : '';
        html += label + `<div style="padding:0 12px 12px">${wrapMapScale(spawnGridHtml(list, byZone))}</div>`;
      }
    }
    html += '</div>';
  }

  if (loose.length) {
    html += `<div style="border-top:1px solid var(--border);padding:8px 12px">
      <b>Interiors &amp; unplaced rooms</b> <span style="color:var(--text-dim);font-size:11px">${loose.length}</span>
      ${loose.map(z => {
        const list = byZone.get(z.id) || [];
        return `<div class="zone-subitem-row" onclick='spawnTileSelect(${JSON.stringify(z.id)})' style="cursor:pointer">
          <span>${z.name || z.id} <span style="color:var(--text-dim);font-size:11px">· ${list.map(s => `${s.enemy_name} ×${s.max_count}`).join(', ')}</span></span>
        </div>`;
      }).join('')}
    </div>`;
  }
  return html;
}

function toggleSpawnRegion(rid) {
  if (_spawnMapCollapsed.has(rid)) _spawnMapCollapsed.delete(rid); else _spawnMapCollapsed.add(rid);
  const host = document.getElementById('list-panel');
  host.innerHTML = enemyViewToggleHtml() + spawnMapBodyHtml();
  applyMapScale(host);
}

// Compact map grid for one region floor, tinted by spawn density.
function spawnGridHtml(zones, byZone) {
  const xs = zones.map(z => z.grid_x), ys = zones.map(z => z.grid_y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const byCoord = new Map(zones.map(z => [`${z.grid_x},${z.grid_y}`, z]));
  let html = `<div style="display:grid;grid-template-columns:repeat(${maxX - minX + 1},110px);grid-auto-rows:76px;gap:2px">`;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const z = byCoord.get(`${x},${y}`);
      if (!z) { html += '<div></div>'; continue; }
      const list = byZone.get(z.id) || [];
      const heat = list.length === 0 ? '' : list.length === 1 ? ' bm-spawn-1' : list.length <= 3 ? ' bm-spawn-2' : ' bm-spawn-3';
      const sel = z.id === _spawnMapZone ? ' bm-spawn-sel' : '';
      const sub = list.length
        ? `<div style="font-size:9px;opacity:0.9;margin-top:2px">☠ ${list.map(s => `${s.enemy_name}×${s.max_count}`).join(', ')}</div>`
        : '';
      const style = heat ? '' : zoneColorStyle(z);
      html += `<div class="bigmap-tile${heat}${sel}" style="${style}" title="${z.id}"
        onclick='spawnTileSelect(${JSON.stringify(z.id)})'><div>${zoneIconHtml(z)}${z.name}${sub}</div></div>`;
    }
  }
  return html + '</div>';
}

function spawnTileSelect(zoneId) {
  _spawnMapZone = _spawnMapZone === zoneId ? null : zoneId;
  const host = document.getElementById('list-panel');
  host.innerHTML = enemyViewToggleHtml() + spawnMapBodyHtml();
  applyMapScale(host);
}

function spawnDetailHtml(zone, byZone) {
  if (!zone) return '';
  const list = byZone.get(zone.id) || [];
  const zoneArg = JSON.stringify(zone.id);
  const options = allRecords.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    .map(e => `<option value="${e.id}">${e.name}</option>`).join('');
  const rows = list.length
    ? list.map(s => `<div class="zone-subitem-row">
        <span>${s.enemy_name} <span style="color:var(--text-dim);font-size:11px">· ×${s.max_count} · ${s.respawn_seconds}s · weight ${s.spawn_weight}</span></span>
        <span class="zone-subitem-actions">
          <button class="action-btn danger" onclick='spawnMapDelete(${JSON.stringify(s.id)})'>Remove</button>
        </span>
      </div>`).join('')
    : '<div class="zone-subitem-empty">No spawns here.</div>';
  return `<div class="zone-inline-form" style="margin:0 12px 12px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <b>${zone.name || zone.id}</b>
      <button class="action-btn" onclick='spawnTileSelect(${zoneArg})'>Close</button>
    </div>
    ${rows}
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
  renderSpawnMap();
}

async function spawnMapDelete(spawnId) {
  const result = await directAPI(`/spawns/${encodeURIComponent(spawnId)}`, 'DELETE');
  if (result?.error) { toast(result.error, true); return; }
  _spawnMapData.spawns = _spawnMapData.spawns.filter(s => s.id !== spawnId);
  toast('Spawn removed');
  renderSpawnMap();
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
