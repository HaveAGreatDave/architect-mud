// Which accordion sections (exterior zones, building sub-trees, catch-all
// bands) are expanded. Keyed by zone id; module-level so it survives the
// re-renders that follow a toggle, edit, or refresh within the session.
const _zonesExpanded = new Set();

// District table, fetched once from the server (server/engine/districts.js is
// the single source of truth). _districtMeta: key -> {name,color}; _districtPrefix:
// id-prefix -> key. Cached module-wide; the list re-renders once it arrives.
let _districtMeta = null;
let _districtPrefix = null;
async function ensureDistrictData() {
  if (_districtMeta) return;
  const d = await API('/districts').catch(() => null);
  _districtMeta = d?.districts || {};
  _districtPrefix = d?.prefix || {};
}

// Region table (spatial regions — flags.region_id), fetched once to name the Zones
// panel's region dropdown. Mirrors the Maps tab's region switcher. _regionMeta:
// region_id -> name; cached module-wide, re-render once it arrives.
let _regionMeta = null;
// region_id -> regions.defaults: the region rung of resolveDefault. The zone form
// reads it so a blank override field can say what the tile inherits instead of
// reading as silence (see the Audio Theme select below).
let _regionDefaults = {};
async function ensureRegionData() {
  if (_regionMeta) return;
  const d = await API('/maps/regions').catch(() => null);
  _regionMeta = Object.fromEntries((d?.regions || []).map(r => [r.id, r.name]));
  _regionDefaults = Object.fromEntries((d?.regions || []).map(r => [r.id, r.defaults || {}]));
}
// Which region the Zones accordion is scoped to: null = all regions, a region_id,
// or '__none__' for zones carrying no region_id (legacy / hand-authored).
let _zonesRegionFilter = null;
function setZonesRegion(id) { _zonesRegionFilter = id || null; renderZonesTable(allRecords); }
// Client-side mirror of server districtFor(): explicit flags.district override,
// then the id-prefix table, then a lethal-zone fallback to 'hazard', else the
// urban default. Uses the zone's already-computed `danger` field.
function districtKeyFor(z) {
  const override = z.flags?.district;
  if (override && _districtMeta[override]) return override;
  const p = (z.id || '').match(/^zone_([a-z0-9]+)/)?.[1] || '';
  if (_districtPrefix[p]) return _districtPrefix[p];
  return z.danger === 'lethal' ? 'hazard' : 'residential';
}

// Zones list: a district-first accordion. Tier 1 = the canonical neighborhood a
// zone belongs to (districtKeyFor). Within each district, buildings lead (the
// authored content), then any named exterior, then the bulk map grid collapsed
// into one Terrain-tiles fold. Building interiors nest under their building,
// derived live from the exit graph (a spanning tree from the entrance).
function renderZonesTable(records) {
  const panel = document.getElementById('list-panel');
  if (!records.length) { panel.innerHTML = '<div style="padding:24px;color:var(--text-dim)">No records found.</div>'; return; }
  if (!_districtMeta || !_regionMeta) {
    panel.innerHTML = '<div style="padding:24px;color:var(--text-dim)">Loading districts…</div>';
    Promise.all([ensureDistrictData(), ensureRegionData()]).then(() => renderZonesTable(records));
    return;
  }

  // Region scoping (the dropdown). null = show every region; a region_id keeps only
  // zones carrying it; '__none__' keeps zones with no region_id. Interiors have no
  // region_id — they ride along with their building (claimed by the BFS below), so
  // the filter is applied to buildings/exteriors/tiles, never to nested rooms.
  const rf = _zonesRegionFilter;
  const regionMatch = z => {
    if (!rf) return true;
    const r = z.flags?.region_id || null;
    return rf === '__none__' ? !r : r === rf;
  };

  const byId = new Map(records.map(z => [z.id, z]));
  const isInterior = z => !!(z.flags?.is_interior || z.flags?.is_apartment);
  const isBuilding = z => !!z.flags?.is_building;
  const isExterior = z => !isInterior(z) && !isBuilding(z);
  // A bulk region grid tile (auto-generated terrain — `zone_district_<x>_<y>`,
  // `zone_<region>_<x>_<y>`, optional `_z<z>`) vs a hand-authored named exterior:
  // decides what collapses into the Terrain fold. ANY region's coordinate-suffixed
  // grid tiles group here so a region never spams the list (interiors + buildings are
  // already excluded before this test). This is the standard for every region.
  const isGridTile = z => /_-?\d+_-?\d+(_z-?\d+)?$/.test(z.id || '');
  const byName = (a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id));
  // Terrain classification for sub-grouping the grid tiles: the `flags.terrain` SSOT
  // wins (scrub/concrete/dock/…), else inferred water/road/grass, else 'land'.
  const terrainKey = z => {
    if (z.flags?.terrain) return z.flags.terrain;
    if (z.flags?.water) return 'water';
    if (/^(road_|runway_)/.test(z.flags?.icon || '')) return 'road';
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(z.bg_color || '');
    if (m) { const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
      if (g > r && g - b >= 15 && g >= 45) return 'grass'; }
    return 'land';
  };

  // Interior spanning tree per building. BFS over exits from each entrance,
  // claiming interior/apartment rooms; the first building to reach a room owns
  // it. Unclaimed interiors fall to the Unattached-rooms band at the bottom.
  const claimed = new Set();
  const buildingMembers = new Map();   // buildingId -> [interior zones], reachable via exits
  for (const b of records.filter(z => isBuilding(z) && regionMatch(z))) {
    const members = [];
    const queue = [b.id];
    const seen = new Set([b.id]);
    while (queue.length) {
      const cur = queue.shift();
      const curZ = byId.get(cur);
      if (!curZ) continue;
      for (const n of flatNeighbors(curZ.exits)
        .map(id => byId.get(id))
        .filter(z => z && isInterior(z) && !seen.has(z.id) && !claimed.has(z.id))) {
        seen.add(n.id); claimed.add(n.id);
        members.push(n); queue.push(n.id);
      }
    }
    buildingMembers.set(b.id, members);
  }

  // Group every non-interior zone by district. Buildings and grid tiles and
  // named exteriors keep separate buckets so the render can lead with the
  // authored content and collapse the map-grid bulk.
  const push = (map, k, v) => { (map.get(k) || map.set(k, []).get(k)).push(v); };
  const bDistrict = new Map();   // district key -> [buildings]
  const eNamed = new Map();      // district key -> [named exteriors]
  const eTiles = new Map();      // district key -> [grid tiles]
  for (const z of records) {
    if (isInterior(z)) continue;   // nested under its building, or an orphan
    if (!regionMatch(z)) continue; // scoped out by the region dropdown
    const k = districtKeyFor(z);
    if (isBuilding(z)) push(bDistrict, k, z);
    else if (isGridTile(z)) push(eTiles, k, z);
    else push(eNamed, k, z);
  }

  // --- Row / band builders (furniture-panel visual language) ---
  const stBadge = s => !s ? '' :
    s === 'pending delete'
      ? `<span style="font-size:10px;color:var(--danger);margin-left:6px">!Marked for Deletion</span>`
      : `<span style="font-size:10px;color:var(--warning);margin-left:6px">!Not Published</span>`;
  const rowBtns = id => `
    <button class="action-btn" style="font-size:10px;padding:2px 8px;margin-left:4px" onclick="event.stopPropagation();editRecord('${id}')">Edit</button>
    <button class="action-btn" style="font-size:10px;padding:2px 8px;margin-left:4px" onclick="event.stopPropagation();cloneZoneRow('${id}')">Clone</button>
    <button class="action-btn danger" style="font-size:10px;padding:2px 8px;margin-left:4px" onclick="event.stopPropagation();deleteZoneRow('${id}')">Delete</button>`;

  const interiorRow = (z, pad) => {
    const del = z._stagingStatus === 'pending delete';
    return `<div style="display:flex;align-items:center;gap:8px;padding:5px 12px 5px ${pad}px;border-bottom:1px solid var(--border);background:var(--bg1);cursor:pointer;${del ? 'opacity:0.6;text-decoration:line-through' : ''}" onclick="editRecord('${z.id}')">
      <div style="flex:1;min-width:0">
        <span class="zone-child-indent" style="color:var(--text-dim)">↳</span>
        <span style="color:var(--text-bright)">${z.name || z.id}</span>
        <span style="font-size:10px;color:var(--text-dim);margin-left:6px">${z.id}</span>${stBadge(z._stagingStatus)}
      </div>
      ${rowBtns(z.id)}
    </div>`;
  };

  // Interior rooms grouped by grid_z into collapsible floor sections; each floor
  // is its own fold. A single-floor building skips the floor tier and lists its
  // rooms directly. Floors read bottom-up (lowest grid_z first, so Floor 2 sits
  // below Floor 1).
  const floorLabel = z => z === 0 ? 'Ground Floor' : z > 0 ? `Floor ${z}` : z === -1 ? 'Basement' : `Basement ${-z}`;
  const floorGroup = (bId, z, rooms) => {
    const key = `${bId}__z${z}`;
    const inner = rooms.slice().sort(byName).map(r => interiorRow(r, 60)).join('');
    return `<div>
      <div data-zone-id="${key}" style="display:flex;align-items:center;gap:0;padding:5px 12px 5px 44px;background:var(--bg2);border-top:1px solid var(--border);cursor:pointer;user-select:none" onclick="zToggle(this)">
        <span class="z-arrow">▸</span>
        <span style="color:var(--accent2);font-weight:600">${floorLabel(z)}</span>
        <span style="font-size:10px;color:var(--text-dim);margin-left:6px">z${z}</span>
        <span style="margin-left:auto;font-size:10px;color:var(--text-dim)">${rooms.length} room${rooms.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="z-children" style="display:none">${inner}</div>
    </div>`;
  };

  const buildingBlock = b => {
    const members = buildingMembers.get(b.id) || [];
    const del = b._stagingStatus === 'pending delete';
    const floors = new Map();
    for (const m of members) {
      const z = m.grid_z ?? 0;
      (floors.get(z) || floors.set(z, []).get(z)).push(m);
    }
    let rows;
    if (!members.length) {
      rows = '<div style="padding:5px 12px 5px 44px;color:var(--text-dim);font-size:11px">No interior rooms.</div>';
    } else if (floors.size <= 1) {
      rows = members.slice().sort(byName).map(m => interiorRow(m, 44)).join('');
    } else {
      rows = [...floors.keys()].sort((a, b) => a - b).map(z => floorGroup(b.id, z, floors.get(z))).join('');
    }
    return `<div>
      <div data-zone-id="${b.id}" style="display:flex;align-items:center;gap:0;padding:5px 12px 5px 28px;background:var(--bg2);border-top:1px solid var(--border);cursor:pointer;user-select:none;${del ? 'opacity:0.6;text-decoration:line-through' : ''}" onclick="zToggle(this)">
        <span class="z-arrow">▸</span>
        <span style="color:var(--accent)">↳ ${b.name || b.id}</span>
        <span style="font-size:10px;color:var(--text-dim);margin-left:6px">${b.id}</span>${stBadge(b._stagingStatus)}
        <span style="margin-left:auto;font-size:10px;color:var(--text-dim)">${members.length} room${members.length !== 1 ? 's' : ''}</span>
        ${rowBtns(b.id)}
      </div>
      <div class="z-children" style="display:none">${rows}</div>
    </div>`;
  };

  // A named exterior / grid tile — a plain clickable row (no interior tree).
  const exteriorRow = (z, pad) => {
    const del = z._stagingStatus === 'pending delete';
    return `<div style="display:flex;align-items:center;gap:8px;padding:5px 12px 5px ${pad}px;border-bottom:1px solid var(--border);background:var(--bg1);cursor:pointer;${del ? 'opacity:0.6;text-decoration:line-through' : ''}" onclick="editRecord('${z.id}')">
      <div style="flex:1;min-width:0">
        <span style="color:var(--text-bright)">${z.name || z.id}</span>
        <span style="font-size:10px;color:var(--text-dim);margin-left:6px">${z.id}</span>${stBadge(z._stagingStatus)}
      </div>
      ${rowBtns(z.id)}
    </div>`;
  };

  const HEAD_STYLE = 'display:flex;align-items:center;gap:0;padding:7px 12px;background:var(--bg3);border-top:2px solid var(--border);border-bottom:1px solid var(--border);cursor:pointer;user-select:none';
  const catchAllBand = (key, title, count, inner) => `<div>
    <div data-zone-id="${key}" style="${HEAD_STYLE}" onclick="zToggle(this)">
      <span class="z-arrow">▸</span>
      <span style="color:var(--text-dim);font-style:italic;font-weight:700;font-size:13px">${title}</span>
      <span style="margin-left:auto;font-size:10px;color:var(--text-dim)">${count}</span>
    </div>
    <div class="z-children" style="display:none">${inner}</div>
  </div>`;

  // A collapsible sub-fold (buildings' floor tier reused for terrain buckets).
  const subFold = (key, label, count, inner, pad) => `<div>
    <div data-zone-id="${key}" style="display:flex;align-items:center;gap:0;padding:5px 12px 5px ${pad}px;background:var(--bg2);border-top:1px solid var(--border);cursor:pointer;user-select:none" onclick="zToggle(this)">
      <span class="z-arrow">▸</span>
      <span style="color:var(--text-dim)">${label}</span>
      <span style="margin-left:auto;font-size:10px;color:var(--text-dim)">${count}</span>
    </div>
    <div class="z-children" style="display:none">${inner}</div>
  </div>`;

  // Labels + display order for the terrain sub-buckets. Covers the full terrain palette
  // (docs/systems-terrain.md) plus the inferred fallbacks; any key not listed still renders
  // under its raw name at the end, so no tile is ever silently dropped from the fold.
  const TERRAIN_LABELS = {
    road: '🛣 Roads', water: '🌊 Water', dock: '🪵 Docks', grass: '🌿 Grass', park: '🌳 Park',
    concrete: '▪ Concrete', asphalt: '▪ Asphalt', dirt: '▪ Dirt', sand: '🏜 Sand', gravel: '▪ Gravel',
    scrub: '🌵 Scrubland', redrock: '🪨 Red Rock', ash: '🌫 Ash', marsh: '🐊 Marsh', land: '▪ Land',
  };
  const TERRAIN_ORDER = Object.keys(TERRAIN_LABELS);
  const districtBlock = (key, meta) => {
    const blds = (bDistrict.get(key) || []).slice().sort(byName);
    const named = (eNamed.get(key) || []).slice().sort(byName);
    const tiles = (eTiles.get(key) || []).slice();
    const rooms = blds.reduce((n, b) => n + (buildingMembers.get(b.id)?.length || 0), 0);
    const total = blds.length + named.length + tiles.length + rooms;
    const color = meta?.color || 'var(--cyan)';

    let inner = blds.map(buildingBlock).join('');
    inner += named.map(z => exteriorRow(z, 28)).join('');
    if (tiles.length) {
      const groups = {};
      for (const z of tiles) (groups[terrainKey(z)] = groups[terrainKey(z)] || []).push(z);
      // Render every present terrain group (known order first, then any extras alpha) —
      // never filter to a fixed list, or an unlisted terrain would vanish from the tree.
      const keys = Object.keys(groups).sort((a, b) => {
        const ia = TERRAIN_ORDER.indexOf(a), ib = TERRAIN_ORDER.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
      });
      const tinner = keys.map(k =>
        subFold(`__tile_${key}_${k}__`, TERRAIN_LABELS[k] || `▪ ${k}`, groups[k].length,
          groups[k].sort(byName).map(z => exteriorRow(z, 60)).join(''), 44)).join('');
      inner += subFold(`__tiles_${key}__`, '<em>Terrain tiles</em>', tiles.length, tinner, 28);
    }

    return `<div>
      <div data-zone-id="__district_${key}__" style="${HEAD_STYLE};border-left:3px solid ${color}" onclick="zToggle(this)">
        <span class="z-arrow">▸</span>
        <span style="color:${color};font-weight:700;font-size:13px">${meta?.name || key}</span>
        <span style="margin-left:auto;font-size:10px;color:var(--text-dim)">${blds.length} building${blds.length !== 1 ? 's' : ''} · ${total} zone${total !== 1 ? 's' : ''}</span>
      </div>
      <div class="z-children" style="display:none">${inner}</div>
    </div>`;
  };

  // --- Assemble ---
  // Region dropdown: every region present in the data (named from _regionMeta), plus
  // an "All regions" default and an "Unassigned" bucket for zones lacking a region_id.
  const presentRegions = new Set();
  for (const z of records) if (z.grid_x != null && z.flags?.region_id) presentRegions.add(z.flags.region_id);
  const hasUnassigned = records.some(z => !isInterior(z) && z.grid_x != null && !z.flags?.region_id);
  const regionOpt = (val, label) => `<option value="${val}"${(_zonesRegionFilter || '') === val ? ' selected' : ''}>${label}</option>`;
  const regionOpts = [regionOpt('', 'All regions')]
    .concat([...presentRegions].sort().map(id => regionOpt(id, _regionMeta[id] || id)))
    .concat(hasUnassigned ? [regionOpt('__none__', 'Unassigned')] : [])
    .join('');
  let html = `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px">
    <button class="action-btn" onclick="openBigMap()">🗺 View Big Map</button>
    <select class="settings-select" style="margin-left:auto;width:auto;padding:4px 26px 4px 10px;font-size:12px" onchange="setZonesRegion(this.value)" title="Scope the zone list to one region">${regionOpts}</select>
  </div>`;
  // Districts in the curated server order; any district holding zones is shown,
  // any unrecognised key (shouldn't happen) falls to the end.
  const present = new Set([...bDistrict.keys(), ...eNamed.keys(), ...eTiles.keys()]);
  const orderedKeys = Object.keys(_districtMeta).filter(k => present.has(k));
  for (const k of present) if (!_districtMeta[k]) orderedKeys.push(k);
  html += orderedKeys.map(k => districtBlock(k, _districtMeta[k])).join('');

  const orphans = records.filter(z => isInterior(z) && !claimed.has(z.id) && regionMatch(z)).sort(byName);
  if (orphans.length) {
    html += catchAllBand('__orphan_rooms__', 'Unattached rooms', orphans.length,
      orphans.map(z => interiorRow(z, 28)).join(''));
  }
  panel.innerHTML = html;

  // Restore expanded sections from the session's toggle state.
  for (const zid of _zonesExpanded) {
    const header = panel.querySelector(`[data-zone-id="${zid}"]`);
    const children = header && header.nextElementSibling;
    if (children && children.classList.contains('z-children')) {
      children.style.display = 'block';
      const arrow = header.querySelector('.z-arrow');
      if (arrow) arrow.textContent = '▾';
    }
  }
}

function zToggle(header) {
  const children = header.nextElementSibling;
  if (!children || !children.classList.contains('z-children')) return;
  const arrow = header.querySelector('.z-arrow');
  const open = children.style.display !== 'none';
  children.style.display = open ? 'none' : 'block';
  if (arrow) arrow.textContent = open ? '▸' : '▾';
  const zid = header.dataset.zoneId;
  if (zid) { if (open) _zonesExpanded.delete(zid); else _zonesExpanded.add(zid); }
}

// Search: flat matches by name / id / description, furniture-panel style.
function filterZones(q) {
  if (!q) { renderZonesTable(allRecords); return; }
  const panel = document.getElementById('list-panel');
  const matches = allRecords.filter(z =>
    String(z.name || '').toLowerCase().includes(q) ||
    String(z.id || '').toLowerCase().includes(q) ||
    String(z.description || '').toLowerCase().includes(q)
  ).sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
  if (!matches.length) { panel.innerHTML = '<div style="padding:24px;color:var(--text-dim)">No zones matching search.</div>'; return; }
  panel.innerHTML = matches.map(z => `<div style="display:flex;align-items:center;gap:8px;padding:5px 12px;border-bottom:1px solid var(--border);background:var(--bg1);cursor:pointer" onclick="editRecord('${z.id}')">
    <div style="flex:1;min-width:0">
      <span style="color:var(--text-bright)">${z.name || z.id}</span>
      <span style="font-size:10px;color:var(--text-dim);margin-left:8px">${z.id}</span>
    </div>
    <button class="action-btn" style="font-size:10px;padding:2px 8px" onclick="event.stopPropagation();editRecord('${z.id}')">Edit</button>
  </div>`).join('');
}

async function deleteZoneRow(id) {
  const rec = allRecords.find(r => r.id === id);
  if (!rec) return;
  const children = allRecords.filter(z => (z.flags?.is_apartment || z.flags?.is_interior) && flatNeighbors(z.exits).includes(id));
  const childCount = children.length;
  const msg = childCount
    ? `Delete ${rec.name || id}? This will also queue ${childCount} attached room${childCount > 1 ? 's' : ''} for deletion.`
    : `Delete ${rec.name || id}?`;
  if (!(await dpConfirm(msg, { danger: true }))) return;
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
  { id: 'bar', label: 'Bar' },
  { id: 'hotel', label: 'Hotel' },
  { id: 'apartment', label: 'Apartment Building' },
  { id: 'clinic', label: 'Clinic' },
  { id: 'store', label: 'Convenience Store' },
  { id: 'warehouse', label: 'Warehouse' },
  { id: 'powerplant', label: 'Power Plant' },
];

// Zone flag keys owned by the structured form widgets above the tag editor
// (checkboxes / dropdowns). The Zone Tags picker excludes them so a key is
// never editable in two places at once.
const ZONE_STRUCTURED_KEYS = ['is_apartment', 'is_building', 'building_name',
  'building_type', 'world_exit_zone', 'is_interior', 'scavenging_table_id'];

// --- Zone tag picker (mirrors the furniture picker; reuses itemTagWidget /
// readItemTag from items.js). Tags are flat keys in zones.flags filtered to
// catalog entries with scope 'zone'. ---
function zoneTagRow(name, value) {
  const def = TAG_CATALOG[name];
  return `<div class="field tag-row" data-tag="${name}">
    <label>${def.label}<button type="button" onclick="removeZoneTag(this)" style="float:right;background:none;border:none;color:inherit;cursor:pointer;font-size:15px;line-height:1">×</button></label>
    ${itemTagWidget(name, value)}
    <div class="zone-subsection-note">${def.help}</div>
  </div>`;
}

function zoneAddTagPicker(presentNames) {
  const groups = {};
  for (const [name, def] of Object.entries(TAG_CATALOG)) {
    if (!tagAppliesTo(def, 'zone') || presentNames.includes(name) || ZONE_STRUCTURED_KEYS.includes(name)) continue;
    (groups[def.group] = groups[def.group] || []).push([name, def]);
  }
  const optgroups = Object.entries(groups).map(([g, list]) =>
    `<optgroup label="${g}">${list.map(([n, d])=>`<option value="${n}">${d.label}</option>`).join('')}</optgroup>`).join('');
  if (!optgroups) return '<div style="font-size:11px;color:var(--text-dim)">No more zone tags available.</div>';
  return `<div class="field-row" style="align-items:flex-end">
    <div class="field"><label>Add tag</label><select id="zone-add-tag">${optgroups}</select></div>
    <button type="button" class="action-btn" onclick="addZoneTag()">Add</button>
  </div>`;
}

function refreshZoneTagPicker() {
  const present = [...document.querySelectorAll('#zone-tags .tag-row')].map(r => r.dataset.tag);
  document.getElementById('zone-add-tag-picker').innerHTML = zoneAddTagPicker(present);
}

function addZoneTag() {
  const name = document.getElementById('zone-add-tag')?.value;
  if (!name) return;
  const def = TAG_CATALOG[name];
  const defaults = { flag:true, int:0, number:0, enum:def.options?.[0], ref:'', range:{min:0,max:0}, hot:{amount:0,duration_seconds:0}, statmap:{}, object:{}, list:[], text:'' };
  document.getElementById('zone-tags').insertAdjacentHTML('beforeend', zoneTagRow(name, defaults[def.shape]));
  refreshZoneTagPicker();
}

function removeZoneTag(btn) {
  btn.closest('.tag-row').remove();
  refreshZoneTagPicker();
}

// Zone-aware value reader. 'text' is handled by readItemTag (raw prose, with a
// JSON object/array still parsing — e.g. the greeter config); this only adds the
// zone-specific 'list' error message.
function readZoneTag(rowEl) {
  const def = TAG_CATALOG[rowEl.dataset.tag];
  const input = rowEl.querySelector('.tag-input');
  if (def.shape === 'list') {
    try { const p = JSON.parse(input.value); if (!Array.isArray(p)) throw 0; return p; }
    catch { throw new Error(`${def.label}: expected a JSON array, e.g. ["The Haul Road"]`); }
  }
  return readItemTag(rowEl);
}

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
  await ensureRegionData();   // the Audio Theme select names what a blank field inherits
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
  const scavTables = await API('/scavenging-tables').catch(() => []);
  const scavSelected = flags.scavenging_table_id || '';
  const scavOptions = (Array.isArray(scavTables) ? scavTables : [])
    .map(t => `<option value="${t.id}" ${t.id===scavSelected?'selected':''}>${t.name} (${t.entry_count} items)</option>`).join('');

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
        for (const nId of flatNeighbors(curZ.exits)) {
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
      flatNeighbors(z.exits).includes(rec.id)
    );
    const isExteriorZone = !flags.is_interior && !flags.is_apartment && !flags.is_building;
    const freeDirs = (isExteriorZone ? ['in','out','up','down'] : ['north','south','east','west','up','down','in','out']).filter(d => !zoneEditExitsState[d]);

    // A door binds to one specific exit (exit_dir + target_zone). Offer every exit
    // that doesn't already have a door; a legacy door with no target_zone occupies
    // its whole direction. Value encodes "dir|targetId".
    const _dUsedExits = new Set(zoneDoors.map(d => d.target_zone ? `${d.exit_dir}|${d.target_zone}` : d.exit_dir));
    const _dAvailExits = allExits(zoneEditExitsState).filter(e =>
      !_dUsedExits.has(`${e.dir}|${e.target}`) && !_dUsedExits.has(e.dir));
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
          return `<div class="zone-subitem-row" id="door-row-${d.id}" style="cursor:pointer" onclick="openEditDoorDialog('${dIdSafe}','${rec.id}')">
            <span style="display:flex;align-items:center;gap:6px"><strong>${d.name || d.id}</strong> <span style="color:var(--text-dim);font-size:11px">${d.door_type} · ${d.exit_dir||'?'} · ${d.hp}/${d.hp_max}HP · ${dLockLabel}</span></span>
            <span class="zone-subitem-actions">
              <button class="action-btn" onclick="event.stopPropagation();openEditDoorDialog('${dIdSafe}','${rec.id}')" style="padding:2px 8px;font-size:11px">Edit</button>
              <button class="action-btn danger" onclick="event.stopPropagation();deleteDoorQuick('${dIdSafe}','${rec.id}')" style="padding:2px 8px;font-size:14px;font-weight:bold">−</button>
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
            ${_dAvailExits.length ? _dAvailExits.map(e => {
              const dest = allRecords.find(z => z.id === e.target);
              return `<option value="${e.dir}|${e.target}">${e.dir} → ${dest ? dest.name : e.target}</option>`;
            }).join('') : '<option value="">No free exits</option>'}
          </select>
          <button class="action-btn success" onclick='submitAddDoor(${JSON.stringify(rec.id)})'>Install Door</button>
        </div>
      </div>

      <div class="zone-subsection">
        <div class="zone-subsection-header">Rooms <span class="zone-subsection-count">${childRooms.length}</span></div>
        <div id="zone-rooms-list">${childRooms.length ? childRooms.map(r => `
          <div class="zone-subitem-row" style="cursor:pointer" onclick="editRecord('${r.id}')">
            <span>${r.name}</span>
            <span class="zone-subitem-actions">
              <button class="action-btn" onclick="event.stopPropagation();editRecord('${r.id}')">Edit</button>
              <button class="action-btn danger" onclick="event.stopPropagation();deleteRoomQuick('${r.id}','${rec.id}')">Delete</button>
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
          <div class="zone-subitem-row" id="npc-row-${n.id}" style="cursor:pointer" onclick="openEditNpcQuick('${n.id}')">
            <span>${n.name}</span>
            <span class="zone-subitem-actions">
              <button class="action-btn" onclick="event.stopPropagation();openEditNpcQuick('${n.id}')">Edit</button>
              <button class="action-btn danger" onclick="event.stopPropagation();deleteNpcQuick('${n.id}','${rec.id}')">Delete</button>
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
          <div class="zone-subitem-row" id="furniture-row-${f.id}" style="cursor:pointer" onclick="openEditFurnitureQuick('${f.id}')">
            <span>${f.name}</span>
            <span class="zone-subitem-actions">
              <button class="action-btn" onclick="event.stopPropagation();openEditFurnitureQuick('${f.id}')">Edit</button>
              <button class="action-btn danger" onclick="event.stopPropagation();deleteFurnitureQuick('${f.id}','${rec.id}')">Delete</button>
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
              for (const nId of flatNeighbors(curZone.exits)) {
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
    <div class="field"><label>Name</label><input id="f-name" value="${rec.name || ''}" ${isNew ? 'oninput="document.getElementById(\'f-id\').value=\'zone_\'+this.value.toLowerCase().replace(/\\s+/g,\'_\')"' : ''}></div>
    <div class="field"><label>Description</label><textarea id="f-description" rows="5">${rec.description || ''}</textarea></div>
    <div class="field"><label>Danger <span style="color:var(--text-dim);font-weight:400">(inferred from enemy spawns + radiation; override with the <code>danger</code> zone tag below)</span></label>
      <input readonly style="opacity:0.6" value="${rec.danger || 'safe'}${flags.danger ? ' (tag override)' : ''}${rec.radiation ? ` — ☢ radiation ${rec.radiation}` : ''}${rec.sanctuary ? ' — ⛨ sanctuary' : ''}">
    </div>
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
    <div class="field"><label>Parent Zone (building hierarchy — leave blank for standalone zones)</label>
      <select id="f-parent_zone">
        <option value="">— none (top-level zone) —</option>
        ${(allRecords||[]).filter(z=>z.id!==rec.id).sort((a,b)=>a.name.localeCompare(b.name)).map(z=>`<option value="${z.id}"${rec.parent_zone===z.id?' selected':''}>${z.name} [${z.id}]</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>Scavenging Table (players can <code>scavenge</code> here for loot from this table)</label>
      <select id="f-scavenging_table_id">
        <option value="">— none —</option>
        ${scavOptions}
      </select>
    </div>
    ${(() => {
      const tagNames = Object.keys(flags).filter(n =>
        TAG_CATALOG[n] && tagAppliesTo(TAG_CATALOG[n], 'zone') && !ZONE_STRUCTURED_KEYS.includes(n));
      return `<div class="field">
        <label>Zone Tags</label>
        <div id="zone-tags">${tagNames.map(n => zoneTagRow(n, flags[n])).join('')}</div>
        <div id="zone-add-tag-picker">${zoneAddTagPicker(tagNames)}</div>
        <div style="font-size:10px;color:var(--text-dim);margin-top:2px">Tag-driven zone properties (radiation, sanctuary, street life, …). The checkboxes above are structured views of the same flags bag.</div>
      </div>`;
    })()}
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
    <div class="field"><label>Map Placement</label>
      <div style="display:flex;gap:8px;align-items:center">
        <input readonly style="opacity:0.6;flex:1" value="${place.map_id ? `${place.map_id} @ (${place.grid_x ?? '–'}, ${place.grid_y ?? '–'}, ${place.grid_z ?? 0}) — move on the Maps overview` : 'unplaced — position from the Maps overview'}">
        ${(!isNew && place.map_id) ? `<button type="button" class="action-btn danger" style="white-space:nowrap;flex-shrink:0" onclick="removeZoneFromMap('${rec.id}')">Remove from Map</button>` : ''}
      </div>
    </div>
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
        <option value="">${(() => {
          // Blank means "no override", not "no music" — the region's default plays.
          // Naming it here is the whole defaults-and-overrides UX: you can see what
          // you'd be typing over before you type over it.
          const inherited = _regionDefaults[flags.region_id]?.audio_theme_id;
          if (!inherited) return '— None —';
          const song = (Array.isArray(audioSongs) ? audioSongs : []).find(s => s.id === inherited);
          const regionName = _regionMeta?.[flags.region_id] || 'region';
          return `— Inherit from ${regionName}: ${song?.name || inherited} —`;
        })()}</option>
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
        flatNeighbors(z.exits).includes(zoneId)
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
  const id = document.getElementById('f-id').value.trim();
  const isNew = !existing?.id;
  let ambients;
  try { ambients = JSON.parse(document.getElementById('f-ambient_events').value); } catch { return { error: 'Ambient events: invalid JSON' }; }

  const existingFlags = existing?.flags || {};
  const flags = { ...existingFlags };
  // Presence IS the signal in the flags bag (it's the catalog-validated zone
  // tag bag) — unchecked/empty structured widgets remove their key instead of
  // packing false/null junk that validateTags would reject.
  const setOrDelete = (key, val) => { if (val) flags[key] = val; else delete flags[key]; };
  setOrDelete('is_apartment', document.getElementById('f-is_apartment').checked);
  setOrDelete('is_building', document.getElementById('f-is_building').checked);
  setOrDelete('building_name', document.getElementById('f-building_name')?.value.trim());
  setOrDelete('building_type', document.getElementById('f-building_type')?.value);
  setOrDelete('world_exit_zone', document.getElementById('f-world_exit_zone')?.value.trim());
  setOrDelete('is_interior', document.getElementById('f-is_interior').checked);
  setOrDelete('scavenging_table_id', document.getElementById('f-scavenging_table_id')?.value);
  // Re-derive picker-managed zone tags from the tag rows. Structured keys above
  // are excluded from the picker; unknown/legacy keys pass through untouched.
  for (const [name, def] of Object.entries(TAG_CATALOG)) {
    if (tagAppliesTo(def, 'zone') && !ZONE_STRUCTURED_KEYS.includes(name)) delete flags[name];
  }
  try {
    for (const row of document.querySelectorAll('#zone-tags .tag-row')) flags[row.dataset.tag] = readZoneTag(row);
  } catch (e) { return { error: e.message }; }

  const rawMapId = document.getElementById('f-map_id')?.value;
  const rawGridX = document.getElementById('f-grid_x')?.value;
  const rawGridY = document.getElementById('f-grid_y')?.value;
  const rawGridZ = document.getElementById('f-grid_z')?.value;

  const body = {
    name: document.getElementById('f-name').value,
    description: document.getElementById('f-description').value,
    exits: { ...zoneEditExitsState }, ambient_events: ambients, ambient_theme: document.getElementById('f-ambient_theme').value, flags,
    audio_theme_id: document.getElementById('f-audio_theme_id').value || null,
    marker: document.getElementById('f-marker').value.trim() || null,
    color: document.getElementById('f-color').value.trim() || null,
    bg_color: document.getElementById('f-bg_color').value.trim() || null,
    parent_zone: document.getElementById('f-parent_zone')?.value || null,
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

async function removeZoneFromMap(zoneId) {
  if (!(await dpConfirm(`Remove "${zoneId}" from its map? The zone and its exits are unchanged — only the grid placement is erased.`, { danger: true }))) return;
  const d = await API(`/zones/${zoneId}`, 'PUT', { map_id: null, grid_x: null, grid_y: null, grid_z: null });
  if (d.error) { toast(d.error || 'Failed to remove from map', true); return; }
  // Sync mapOverview in-memory so the tile disappears immediately
  if (typeof mapOverview !== 'undefined' && mapOverview) {
    const z = mapOverview.zones.get(zoneId);
    if (z) {
      z.map_id = null; z.grid_x = null; z.grid_y = null; z.grid_z = null;
      mapOverview.zones.delete(zoneId);
      mapOverview.unplaced.set(zoneId, z);
      if (typeof renderMapOverview === 'function') renderMapOverview();
    }
  }
  await refreshZoneEditPanel(zoneId);
}

// Exits — direction + destination-zone picker instead of hand-edited JSON.
// zoneEditExitsState holds the working set for whichever zone is currently
// open; saveZone() reads from it directly.

// Only non-cardinal directions may hold multiple exits (SIFT disambiguates them
// by destination name). Cardinals map to grid cells — two "north" exits can't
// coexist geometrically — so they stay single-exit and are culled once used.
const MULTI_EXIT_DIRS = ['in', 'out', 'up', 'down'];

function renderExitsBuilder(selfId) {
  // Offer in/out/up/down always (they can stack); offer a cardinal only while it
  // is still free. Adding a second exit to a stackable direction stores an array
  // for it (see the exits.js mirror in core/state.js).
  const dirs = ['north','south','east','west','up','down','in','out']
    .filter(d => MULTI_EXIT_DIRS.includes(d) || !exitTargets(zoneEditExitsState, d).length);
  const zoneOptions = allRecords.filter(z => z.id !== selfId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(z => `<option value="${z.id}">${z.name} (${z.id})</option>`).join('');
  const rows = allExits(zoneEditExitsState).map(({ dir, target: targetId }) => {
    const target = allRecords.find(z => z.id === targetId);
    return `<div class="zone-subitem-row">
      <span>${dir} → ${target ? target.name : targetId}</span>
      <span class="zone-subitem-actions"><button class="action-btn danger" onclick="removeExit('${dir}','${targetId}')">Remove</button></span>
    </div>`;
  }).join('') || '<div class="zone-subitem-empty">No exits yet.</div>';
  const addRow = `
    <div class="zone-inline-form" style="margin-top:6px">
      <div class="field-row">
        <div class="field"><label>Direction</label><select id="exit-add-dir">${dirs.map(d=>`<option>${d}</option>`).join('')}</select></div>
        <div class="field"><label>Destination Zone</label><select id="exit-add-zone"><option value="">— select —</option>${zoneOptions}</select></div>
      </div>
      <button class="action-btn success" onclick='addExit(${JSON.stringify(selfId)})'>+ Add Exit</button>
    </div>`;
  return `<div id="exits-list">${rows}</div>${addRow}`;
}

function addExit(selfId) {
  const dir = document.getElementById('exit-add-dir').value;
  const zoneId = document.getElementById('exit-add-zone').value;
  if (!zoneId) { toast('Pick a destination zone first', true); return; }
  if (!MULTI_EXIT_DIRS.includes(dir) && exitTargets(zoneEditExitsState, dir).length) {
    toast(`${dir} already has an exit — only in/out/up/down can have several.`, true); return;
  }
  addExitTo(zoneEditExitsState, dir, zoneId);
  document.getElementById('exits-builder-body').innerHTML = renderExitsBuilder(selfId);
}

function removeExit(dir, targetId) {
  removeExitFrom(zoneEditExitsState, dir, targetId);
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
  if (!(await dpConfirm('Remove this generator? Stage for deletion — publish to apply.', { danger: true }))) return;
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
