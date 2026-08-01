// ─── WORLD EDITOR ────────────────────────────────────────────────────────────
// Zoomed-out map of the whole map_world grid — every region drawn as a
// positioned rectangle on the global array. Create a new region (size + base
// terrain → a blank, exit-wired rectangle), jump into one to edit its tiles (the
// Maps terrain painter, scoped to it), or drag a region to reposition it.
//
// All writes go through staging (like the rest of the panel): create/move produce
// ONE grouped staged change (region_create / region_move) — see
// server/api/staging.routes.js — published atomically from the Changes panel.
//
// Reuses TERRAIN_TYPES / TERRAIN_FILL_BY_KEY (maps.js), the dp* dialogs (modal.js),
// and API/directAPI (api.js). window.worldSelectedRegionId is the hand-off to
// maps.js: setting it scopes the terrain painter to that region.

let _worldData = { regions: [], zones: [] };
let _worldSelected = null;
let _worldShowLegacy = false;
let _worldShowTerrain = true;

// Zoom/pan of the world map. _wdFull is the fit-all viewBox rect (whole grid + pad),
// recomputed each render; _wdView is the current viewBox (null ⇒ fit all). Zoom runs on
// a 10-rung geometric ladder between the full extent (level 1) and WD_ZOOM_MIN_FRAC of it
// (level 10); double-clicking a region sets _wdView straight to that block's bounds.
const WD_ZOOM_LEVELS = 10;
const WD_ZOOM_MIN_FRAC = 0.06;   // level 10 = viewBox 6% of the full extent
let _wdFull = null;              // { x, y, w, h } — fit-all rect
let _wdView = null;              // { x, y, w, h } — current viewBox
let _wdLastClick = null;         // { id, t } — for manual dbl-click detection (a select re-renders the SVG, so native dblclick can't survive between the two clicks)

function _wdEsc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function _wdName(id) { return _worldData.regions.find(d => d.id === id)?.name || id; }
function _wdHue(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return `hsl(${h % 360} 42% 44%)`; }

// Per-region (and one lumped "legacy/unassigned") bounding boxes on the grid.
function _wdBlocks() {
  const byRegion = new Map();
  let un = null;
  const grow = (b, z) => {
    b.minX = Math.min(b.minX, z.grid_x); b.maxX = Math.max(b.maxX, z.grid_x);
    b.minY = Math.min(b.minY, z.grid_y); b.maxY = Math.max(b.maxY, z.grid_y); b.count++;
  };
  for (const z of _worldData.zones) {
    if (z.grid_x == null || z.grid_y == null) continue;
    const rid = z.flags?.region_id;
    if (rid) {
      let b = byRegion.get(rid);
      if (!b) { b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, count: 0 }; byRegion.set(rid, b); }
      grow(b, z);
    } else {
      if (!un) un = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, count: 0 };
      grow(un, z);
    }
  }
  return { byRegion, un };
}
function _wdBlockCount(id) { return _wdBlocks().byRegion.get(id)?.count || 0; }

// Member zones per block id (region_id, or '__unassigned' for legacy tiles), floor 0 only.
function _wdZonesByBlock() {
  const m = new Map();
  for (const z of _worldData.zones) {
    if (z.grid_x == null || z.grid_y == null || (z.grid_z ?? 0) !== 0) continue;
    const key = z.flags?.region_id || '__unassigned';
    let arr = m.get(key); if (!arr) { arr = []; m.set(key, arr); }
    arr.push(z);
  }
  return m;
}

// A region's real terrain, painted one <rect> per tile (roads/water/docks/grass) so the
// block reads as a mini-map — directionality at a glance. Falls back to nothing where a tile
// has no resolved terrain (the region base fill shows through). Uses the same authored-wins
// inference as the Maps painter (mapZoneTerrain) so it matches what the game renders.
function _wdTerrainTiles(zones) {
  if (!zones?.length) return '';
  let out = '';
  for (const z of zones) {
    const terr = typeof mapZoneTerrain === 'function' ? mapZoneTerrain(z) : z.flags?.terrain;
    const fill = terr && TERRAIN_FILL_BY_KEY[terr];
    if (!fill) continue;
    out += `<rect x="${z.grid_x}" y="${z.grid_y}" width="1" height="1" style="fill:${fill};pointer-events:none"></rect>`;
  }
  return out;
}

function _wdToolbarHtml() {
  return `<div style="display:flex;align-items:center;gap:12px;padding:10px 12px;flex-wrap:wrap">
    <button class="action-btn primary" id="wd-new">＋ New Region</button>
    <label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--text-dim);cursor:pointer">
      <input type="checkbox" id="wd-terrain" ${_worldShowTerrain ? 'checked' : ''} style="accent-color:var(--accent)"> Terrain snapshot</label>
    <label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--text-dim);cursor:pointer">
      <input type="checkbox" id="wd-legacy" ${_worldShowLegacy ? 'checked' : ''} style="accent-color:var(--accent)"> Show legacy tiles</label>
    <span style="margin-left:auto;font-size:11px;color:var(--text-dim)">Drag to reposition · click to select · double-click to zoom in</span>
    <div style="display:flex;align-items:center;gap:4px">
      <button class="action-btn" id="wd-zoom-out" title="Zoom out" style="padding:2px 9px;font-size:14px;line-height:1">−</button>
      <span id="wd-zoom-lvl" style="min-width:56px;text-align:center;font-size:11px;color:var(--text-dim)">${_wdZoomLevel()} / ${WD_ZOOM_LEVELS}</span>
      <button class="action-btn" id="wd-zoom-in" title="Zoom in" style="padding:2px 9px;font-size:14px;line-height:1">＋</button>
      <button class="action-btn" id="wd-zoom-fit" title="Fit whole world" style="padding:2px 8px;font-size:11px;margin-left:4px">⤢ Fit</button>
    </div>
  </div>`;
}

function _wdSelectedBarHtml() {
  if (!_worldSelected || _worldSelected === '__unassigned') return '';
  return `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-top:1px solid var(--border);background:var(--bg2)">
    <strong style="color:var(--text)">${_wdEsc(_wdName(_worldSelected))}</strong>
    <code style="font-size:11px;color:var(--text-dim)">${_wdEsc(_worldSelected)}</code>
    <span style="font-size:11px;color:var(--text-dim)">${_wdBlockCount(_worldSelected)} tiles</span>
    <button class="action-btn" id="wd-edit">✎ Edit tiles in Region Map</button>
    <button class="action-btn" id="wd-deselect" style="opacity:.7">Deselect</button>
  </div>`;
}

// ─── ZOOM / PAN ──────────────────────────────────────────────────────────────
// The viewBox width at zoom level L (1 = full extent, 10 = most zoomed), on a
// geometric ladder so each rung is a constant ratio tighter than the last.
function _wdFracForLevel(L) {
  const r = Math.pow(WD_ZOOM_MIN_FRAC, 1 / (WD_ZOOM_LEVELS - 1));
  return Math.pow(r, L - 1);
}
// The level (1..10) the current view sits closest to — inverse of the ladder above.
function _wdZoomLevel() {
  if (!_wdFull || !_wdView) return 1;
  const r = Math.pow(WD_ZOOM_MIN_FRAC, 1 / (WD_ZOOM_LEVELS - 1));
  const L = 1 + Math.log(_wdView.w / _wdFull.w) / Math.log(r);
  return Math.max(1, Math.min(WD_ZOOM_LEVELS, Math.round(L)));
}
// Keep a subset view inside the full extent (or centre it if it's as big/bigger).
function _wdClampView(v) {
  const f = _wdFull;
  v.x = v.w >= f.w ? f.x + (f.w - v.w) / 2 : Math.max(f.x, Math.min(v.x, f.x + f.w - v.w));
  v.y = v.h >= f.h ? f.y + (f.h - v.h) / 2 : Math.max(f.y, Math.min(v.y, f.y + f.h - v.h));
  return v;
}
// Snap to zoom level L, keeping `anchor` (a user-space point, e.g. the cursor) fixed;
// with no anchor the current view centre stays put.
function _wdSetZoom(L, anchor) {
  if (!_wdFull || !_wdView) return;
  L = Math.max(1, Math.min(WD_ZOOM_LEVELS, L));
  const frac = _wdFracForLevel(L);
  const w = _wdFull.w * frac, h = _wdFull.h * frac;
  let nx, ny;
  if (anchor) {
    const fx = (anchor.x - _wdView.x) / _wdView.w, fy = (anchor.y - _wdView.y) / _wdView.h;
    nx = anchor.x - fx * w; ny = anchor.y - fy * h;
  } else {
    nx = _wdView.x + _wdView.w / 2 - w / 2; ny = _wdView.y + _wdView.h / 2 - h / 2;
  }
  _wdView = _wdClampView({ x: nx, y: ny, w, h });
  renderWorldEditor();
}
// Double-click hand-off: frame one block (region or the legacy lump) to the screen.
function _wdFitBlock(id) {
  const { byRegion, un } = _wdBlocks();
  const b = id === '__unassigned' ? un : byRegion.get(id);
  if (!b || !isFinite(b.minX)) return;
  const pad = 1;
  _wdView = _wdClampView({ x: b.minX - pad, y: b.minY - pad,
    w: (b.maxX - b.minX) + 1 + pad * 2, h: (b.maxY - b.minY) + 1 + pad * 2 });
  renderWorldEditor();
}
function _wdGridLines(x, y, w, h) {
  let out = ''; const step = 10;
  for (let gx = Math.ceil(x / step) * step; gx < x + w; gx += step)
    out += `<line x1="${gx}" y1="${y}" x2="${gx}" y2="${y + h}" style="stroke:var(--border);stroke-opacity:.4" stroke-width="0.06"/>`;
  for (let gy = Math.ceil(y / step) * step; gy < y + h; gy += step)
    out += `<line x1="${x}" y1="${gy}" x2="${x + w}" y2="${gy}" style="stroke:var(--border);stroke-opacity:.4" stroke-width="0.06"/>`;
  return out;
}

function renderWorldEditor(data) {
  // TERRAIN_TYPES / TERRAIN_FILL_BY_KEY are loaded from content/map/terrain.json by
  // maps.js now, not hardcoded. Kick the fetch and re-render when it lands, so the
  // region swatches aren't blank on a cold open of this tab.
  if (!TERRAIN_TYPES.length) ensureTerrainPalette().then(() => renderWorldEditor());
  if (data) _worldData = { regions: data.regions || [], zones: data.zones || [] };
  const panel = document.getElementById('list-panel');
  const { byRegion, un } = _wdBlocks();

  const blocks = [...byRegion.entries()].map(([id, b]) => ({ id, ...b, kind: 'region' }));
  if (_worldShowLegacy && un) blocks.push({ id: '__unassigned', ...un, kind: 'unassigned' });

  if (!blocks.length) {
    panel.innerHTML = _wdToolbarHtml() +
      `<div style="padding:48px 24px;color:var(--text-dim);font-size:13px">No regions placed yet. Click <strong>＋ New Region</strong> to generate one.</div>`;
    _wdWireChrome();
    return;
  }

  const gMinX = Math.min(...blocks.map(b => b.minX)), gMaxX = Math.max(...blocks.map(b => b.maxX));
  const gMinY = Math.min(...blocks.map(b => b.minY)), gMaxY = Math.max(...blocks.map(b => b.maxY));
  const pad = 2;
  const vbX = gMinX - pad, vbY = gMinY - pad, vbW = (gMaxX - gMinX) + 1 + pad * 2, vbH = (gMaxY - gMinY) + 1 + pad * 2;
  // Fit-all extent drives the zoom ladder; the live view is a subset of it (or the whole
  // thing on first paint / after Fit-all). Grid lines still cover the full extent so they
  // persist when zoomed in.
  _wdFull = { x: vbX, y: vbY, w: vbW, h: vbH };
  if (!_wdView) _wdView = { ..._wdFull }; else _wdClampView(_wdView);
  const view = _wdView;

  const zonesByBlock = _worldShowTerrain ? _wdZonesByBlock() : null;
  let rects = '';
  for (const b of blocks) {
    const x = b.minX, y = b.minY, w = (b.maxX - b.minX) + 1, h = (b.maxY - b.minY) + 1;
    const isRegion = b.kind === 'region';
    const d = isRegion ? _worldData.regions.find(dd => dd.id === b.id) : null;
    const fill = isRegion ? (TERRAIN_FILL_BY_KEY[d?.base_terrain] || _wdHue(b.id)) : '#33373d';
    const sel = _worldSelected === b.id;
    const fs = Math.max(0.9, Math.min(w, h) * 0.2);
    const tiles = zonesByBlock ? _wdTerrainTiles(zonesByBlock.get(b.id)) : '';
    // Base fill sits under the per-tile terrain; when terrain is shown it just backs the gaps.
    const baseOpacity = tiles ? (isRegion ? 0.35 : 0.18) : (isRegion ? 0.85 : 0.28);
    rects += `<g class="wd-block" data-id="${_wdEsc(b.id)}" data-kind="${b.kind}" style="cursor:${isRegion ? 'grab' : 'pointer'}">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="0.4" style="fill:${fill};fill-opacity:${baseOpacity}"></rect>
      ${tiles}
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="0.4"
        style="fill:none;stroke:${sel ? 'var(--accent)' : '#000'};stroke-width:${sel ? 0.55 : 0.15};stroke-opacity:${isRegion ? 0.9 : 0.5}"></rect>
      <text x="${x + w / 2}" y="${y + h / 2}" text-anchor="middle" dominant-baseline="middle" font-size="${fs}"
        style="pointer-events:none;font-weight:700;fill:#fff;paint-order:stroke;stroke:#000;stroke-width:0.14">${_wdEsc(isRegion ? _wdName(b.id) : 'legacy tiles')}</text>
      <text x="${x + w / 2}" y="${y + h / 2 + fs}" text-anchor="middle" font-size="${fs * 0.62}"
        style="pointer-events:none;fill:#fff;paint-order:stroke;stroke:#000;stroke-width:0.1">${w}×${h} · ${b.count} tiles</text>
    </g>`;
  }

  const svg = `<svg id="wd-svg" viewBox="${view.x} ${view.y} ${view.w} ${view.h}" preserveAspectRatio="xMidYMid meet"
    style="width:100%;max-height:calc(100vh - 210px);background:var(--bg1);border:1px solid var(--border);display:block">
    ${_wdGridLines(vbX, vbY, vbW, vbH)}${rects}</svg>`;

  panel.innerHTML = _wdToolbarHtml() + svg + _wdSelectedBarHtml();
  _wdWireChrome();
  _wdWireSvg();
}

function _wdWireChrome() {
  document.getElementById('wd-new')?.addEventListener('click', _wdNewRegion);
  document.getElementById('wd-terrain')?.addEventListener('change', e => { _worldShowTerrain = e.target.checked; renderWorldEditor(); });
  document.getElementById('wd-legacy')?.addEventListener('change', e => { _worldShowLegacy = e.target.checked; renderWorldEditor(); });
  document.getElementById('wd-edit')?.addEventListener('click', () => { window.worldSelectedRegionId = _worldSelected; showPanel('maps'); });
  document.getElementById('wd-deselect')?.addEventListener('click', () => { _worldSelected = null; renderWorldEditor(); });
  document.getElementById('wd-zoom-in')?.addEventListener('click', () => _wdSetZoom(_wdZoomLevel() + 1));
  document.getElementById('wd-zoom-out')?.addEventListener('click', () => _wdSetZoom(_wdZoomLevel() - 1));
  document.getElementById('wd-zoom-fit')?.addEventListener('click', () => { _wdView = { ..._wdFull }; renderWorldEditor(); });
}

// Client coords → SVG user space, so wheel-zoom can anchor on the cursor.
function _wdUserPoint(svg, e) {
  const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function _wdWireSvg() {
  const svg = document.getElementById('wd-svg');
  if (!svg) return;
  const vb = svg.viewBox.baseVal;
  // Uniform scale under preserveAspectRatio "meet" = min of the two axis ratios.
  const pxPerCell = () => Math.min(svg.clientWidth / vb.width, svg.clientHeight / vb.height) || 1;

  // Wheel zooms one rung per notch, anchored on the cursor.
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    _wdSetZoom(_wdZoomLevel() + (e.deltaY < 0 ? 1 : -1), _wdUserPoint(svg, e));
  }, { passive: false });

  // A tap selects; a second tap on the same block within 350ms zooms to fit it.
  const tapBlock = id => {
    const now = Date.now();
    if (_wdLastClick && _wdLastClick.id === id && now - _wdLastClick.t < 350) { _wdLastClick = null; _wdFitBlock(id); return; }
    _wdLastClick = { id, t: now };
    _worldSelected = id; renderWorldEditor();
  };

  svg.querySelectorAll('.wd-block').forEach(g => {
    if (g.dataset.kind !== 'region') {
      g.addEventListener('click', () => tapBlock(g.dataset.id));
      return;
    }
    let startX = 0, startY = 0, ppc = 1, dragging = false, moved = false;
    const onMove = e => {
      if (!dragging) return;
      const dx = Math.round((e.clientX - startX) / ppc), dy = Math.round((e.clientY - startY) / ppc);
      if (dx || dy) moved = true;
      g.setAttribute('transform', `translate(${dx},${dy})`);
    };
    const onUp = async e => {
      dragging = false; g.style.cursor = 'grab';
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      const dx = Math.round((e.clientX - startX) / ppc), dy = Math.round((e.clientY - startY) / ppc);
      g.removeAttribute('transform');
      const id = g.dataset.id;
      if (!moved || (!dx && !dy)) { tapBlock(id); return; }   // no drag ⇒ select / dbl-tap zoom
      const name = _wdName(id);
      const ok = await dpConfirm(`Move "${name}" by (${dx}, ${dy})?\n\nStaged as ONE change (${_wdBlockCount(id)} tiles) — publishes atomically. Exits stay intact.`, { title: 'Move Region' });
      if (!ok) { renderWorldEditor(); return; }
      await _wdStageMove(id, dx, dy);
      _worldSelected = id;
      renderWorldEditor();
    };
    g.addEventListener('pointerdown', e => {
      e.preventDefault();
      dragging = true; moved = false; startX = e.clientX; startY = e.clientY; ppc = pxPerCell();
      g.style.cursor = 'grabbing';
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
  });
}

// Where a freshly generated region lands: just east of the current occupied
// grid, top-aligned, with a gutter. The user drags it wherever afterward.
function _wdFreeOrigin() {
  const placed = _worldData.zones.filter(z => z.grid_x != null && (z.grid_z ?? 0) === 0);
  if (!placed.length) return { x: 0, y: 0 };
  return { x: Math.max(...placed.map(z => z.grid_x)) + 4, y: Math.min(...placed.map(z => z.grid_y)) };
}

// Place a new w×h region `dist` empty tiles off one edge of an existing region
// (the "origin"), into empty space. Perpendicular axis is edge-aligned to the origin.
function _wdOriginFrom(originId, dir, dist, w, h) {
  const b = _wdBlocks().byRegion.get(originId);
  if (!b || !isFinite(b.minX)) return _wdFreeOrigin();
  const gap = Math.max(0, Math.floor(+dist) || 0);
  switch (dir) {
    case 'N': return { x: b.minX, y: b.minY - gap - h };
    case 'S': return { x: b.minX, y: b.maxY + 1 + gap };
    case 'W': return { x: b.minX - gap - w, y: b.minY };
    case 'E':
    default:  return { x: b.maxX + 1 + gap, y: b.minY };
  }
}

async function _wdStageMove(id, dx, dy) {
  const res = await directAPI('/maps/move-region', 'POST', { regionId: id, dx, dy });
  if (res?.error) { toast(res.error, true); return false; }
  const changes = res.changes || [];
  const name = _wdName(id);
  const r = await directAPI('/staging/stage', 'POST', {
    entityType: 'region_move', entityId: id, entityName: name,
    changeType: 'update', method: 'POST', apiPath: '/maps/move-region',
    requestBody: { changes }, description: `Move region "${name}" by (${dx}, ${dy})`,
  });
  if (r?.error) { toast(r.error, true); return false; }
  // Optimistic: shift member zones locally so the overview previews until Publish.
  const byId = new Map(_worldData.zones.map(z => [z.id, z]));
  for (const c of changes) { const z = byId.get(c.id); if (z) { z.grid_x = c.patch.grid_x; z.grid_y = c.patch.grid_y; } }
  await updateStagingBadge();
  toast('Region move staged ✓ — Publish to apply.');
  return true;
}

async function _wdNewRegion() {
  const form = await _wdNewRegionDialog();
  if (!form) return;
  const origin = form.originId
    ? _wdOriginFrom(form.originId, form.direction, form.distance, form.width, form.height)
    : _wdFreeOrigin();
  const res = await directAPI('/maps/generate-region', 'POST', {
    name: form.name, width: form.width, height: form.height, terrain: form.terrain,
    originX: origin.x, originY: origin.y, gridZ: 0,
  });
  if (res?.error) { toast(res.error, true); return; }
  const { region, zones } = res;
  const r = await directAPI('/staging/stage', 'POST', {
    entityType: 'region_create', entityId: region.id, entityName: region.name,
    changeType: 'create', method: 'POST', apiPath: '/maps/generate-region',
    requestBody: { region, zones },
    description: `New region "${region.name}" (${form.width}×${form.height} ${form.terrain})` +
      (form.originId ? ` — ${form.distance} tiles ${{ N: 'N', E: 'E', S: 'S', W: 'W' }[form.direction] || 'E'} of ${_wdName(form.originId)}` : ''),
  });
  if (r?.error) { toast(r.error, true); return; }
  // Optimistic: add to the local model so it shows immediately (east of the rest).
  _worldData.regions.push(region);
  _worldData.zones.push(...zones);
  _worldSelected = region.id;
  await updateStagingBadge();
  toast(`Region "${region.name}" staged ✓ — Publish to create it.`);
  renderWorldEditor();
}

// Multi-field form modal (dpPrompt is single-field).
// Resolves {name,width,height,terrain,originId,direction,distance} or null.
function _wdNewRegionDialog() {
  return new Promise(resolve => {
    document.getElementById('dp-dialog')?.remove();
    const fld = 'display:block;font-size:12px;color:var(--text-dim);margin-top:10px';
    const inp = 'width:100%;margin-top:4px;padding:6px 8px;background:var(--bg1);border:1px solid var(--border);border-radius:4px;color:var(--text);box-sizing:border-box';
    const terrOpts = TERRAIN_TYPES.map(t => `<option value="${t.key}">${t.label}</option>`).join('');
    // Origin = an existing placed region to spawn off of. Absent on an empty world.
    const placed = [...(_wdBlocks().byRegion.keys())];
    const originOpts = placed.map(id => `<option value="${_wdEsc(id)}">${_wdEsc(_wdName(id))}</option>`).join('');
    const placeRow = placed.length ? `
        <div style="display:flex;gap:10px">
          <label style="${fld};flex:2">Spawn from region<select class="wd-origin" style="${inp}">${originOpts}</select></label>
          <label style="${fld};flex:1">Direction<select class="wd-dir" style="${inp}">
            <option value="E">East →</option><option value="W">← West</option>
            <option value="S">South ↓</option><option value="N">North ↑</option></select></label>
        </div>
        <label style="${fld}">Distance — empty tiles between it and the origin<input class="wd-dist" type="number" min="0" max="200" value="2" style="${inp}"></label>` : '';
    const overlay = document.createElement('div');
    overlay.id = 'dp-dialog';
    overlay.className = 'dp-dialog-overlay';
    overlay.innerHTML = `
      <div class="dp-dialog-card" style="min-width:320px">
        <div class="dp-dialog-title">New Region</div>
        <div class="dp-dialog-msg">A blank rectangle of terrain — fully walkable and exit-wired. Paint roads and buildings into it afterward from the Maps editor.</div>
        <label style="${fld}">Name<input class="wd-name" type="text" placeholder="e.g. Saltmarsh" style="${inp}"></label>
        <div style="display:flex;gap:10px">
          <label style="${fld};flex:1">Width<input class="wd-w" type="number" min="1" max="30" value="8" style="${inp}"></label>
          <label style="${fld};flex:1">Height<input class="wd-h" type="number" min="1" max="30" value="8" style="${inp}"></label>
        </div>
        <label style="${fld}">Base terrain<select class="wd-terrain" style="${inp}">${terrOpts}</select></label>
        ${placeRow}
        <div class="wd-hint" style="font-size:11px;margin-top:8px;color:var(--text-dim)"></div>
        <div class="dp-dialog-actions">
          <button class="dp-dialog-cancel">Cancel</button>
          <button class="dp-dialog-ok">Create (staged)</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const nameEl = overlay.querySelector('.wd-name'), wEl = overlay.querySelector('.wd-w'),
      hEl = overlay.querySelector('.wd-h'), tEl = overlay.querySelector('.wd-terrain'),
      originEl = overlay.querySelector('.wd-origin'), dirEl = overlay.querySelector('.wd-dir'),
      distEl = overlay.querySelector('.wd-dist'), hint = overlay.querySelector('.wd-hint');
    tEl.value = 'concrete';
    nameEl.focus();
    const updateHint = () => {
      const n = (Math.floor(+wEl.value) || 0) * (Math.floor(+hEl.value) || 0);
      let msg = n ? `${n} tiles${n > 400 ? ' — over the 400-tile limit, make it smaller' : ''}` : '';
      if (originEl && n && n <= 400) {
        const dirName = { N: 'north', E: 'east', S: 'south', W: 'west' }[dirEl.value] || 'east';
        msg = `${n} tiles · ${Math.max(0, Math.floor(+distEl.value) || 0)} tiles ${dirName} of ${_wdName(originEl.value)}`;
      }
      hint.textContent = msg;
      hint.style.color = n > 400 ? 'var(--danger)' : 'var(--text-dim)';
    };
    [wEl, hEl].forEach(el => el.addEventListener('input', updateHint));
    [originEl, dirEl, distEl].forEach(el => el?.addEventListener('input', updateHint));
    updateHint();
    const done = v => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onOk = () => {
      const name = nameEl.value.trim(), width = Math.floor(+wEl.value), height = Math.floor(+hEl.value);
      if (!name) { nameEl.focus(); return; }
      if (!(width >= 1 && height >= 1)) { wEl.focus(); return; }
      if (width * height > 400) { updateHint(); return; }
      done({
        name, width, height, terrain: tEl.value,
        originId: originEl?.value || null,
        direction: dirEl?.value || 'E',
        distance: Math.max(0, Math.floor(+distEl?.value) || 0),
      });
    };
    overlay.querySelector('.dp-dialog-ok').addEventListener('click', onOk);
    overlay.querySelector('.dp-dialog-cancel').addEventListener('click', () => done(null));
    let downSelf = false;
    overlay.addEventListener('mousedown', e => { downSelf = e.target === overlay; });
    overlay.addEventListener('click', e => { if (downSelf && e.target === overlay) done(null); });
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); done(null); }
      else if (e.key === 'Enter' && e.target.tagName !== 'SELECT') { e.preventDefault(); onOk(); }
    }
    document.addEventListener('keydown', onKey);
  });
}
