// ─── WORLD EDITOR ────────────────────────────────────────────────────────────
// Zoomed-out map of the whole map_world grid — every district drawn as a
// positioned rectangle on the global array. Create a new district (size + base
// terrain → a blank, exit-wired rectangle), jump into one to edit its tiles (the
// Maps terrain painter, scoped to it), or drag a district to reposition it.
//
// All writes go through staging (like the rest of the panel): create/move produce
// ONE grouped staged change (district_create / district_move) — see
// server/api/staging.routes.js — published atomically from the Changes panel.
//
// Reuses TERRAIN_TYPES / TERRAIN_FILL_BY_KEY (maps.js), the dp* dialogs (modal.js),
// and API/directAPI (api.js). window.worldSelectedDistrictId is the hand-off to
// maps.js: setting it scopes the terrain painter to that district.

let _worldData = { districts: [], zones: [] };
let _worldSelected = null;
let _worldShowLegacy = false;

function _wdEsc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function _wdName(id) { return _worldData.districts.find(d => d.id === id)?.name || id; }
function _wdHue(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return `hsl(${h % 360} 42% 44%)`; }

// Per-district (and one lumped "legacy/unassigned") bounding boxes on the grid.
function _wdBlocks() {
  const byDist = new Map();
  let un = null;
  const grow = (b, z) => {
    b.minX = Math.min(b.minX, z.grid_x); b.maxX = Math.max(b.maxX, z.grid_x);
    b.minY = Math.min(b.minY, z.grid_y); b.maxY = Math.max(b.maxY, z.grid_y); b.count++;
  };
  for (const z of _worldData.zones) {
    if (z.grid_x == null || z.grid_y == null) continue;
    const did = z.flags?.district_id;
    if (did) {
      let b = byDist.get(did);
      if (!b) { b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, count: 0 }; byDist.set(did, b); }
      grow(b, z);
    } else {
      if (!un) un = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, count: 0 };
      grow(un, z);
    }
  }
  return { byDist, un };
}
function _wdBlockCount(id) { return _wdBlocks().byDist.get(id)?.count || 0; }

function _wdToolbarHtml() {
  return `<div style="display:flex;align-items:center;gap:12px;padding:10px 12px;flex-wrap:wrap">
    <button class="action-btn primary" id="wd-new">＋ New District</button>
    <label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--text-dim);cursor:pointer">
      <input type="checkbox" id="wd-legacy" ${_worldShowLegacy ? 'checked' : ''} style="accent-color:var(--accent)"> Show legacy tiles</label>
    <span style="margin-left:auto;font-size:11px;color:var(--text-dim)">Drag a district to reposition · click to select</span>
  </div>`;
}

function _wdSelectedBarHtml() {
  if (!_worldSelected || _worldSelected === '__unassigned') return '';
  return `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-top:1px solid var(--border);background:var(--bg2)">
    <strong style="color:var(--text)">${_wdEsc(_wdName(_worldSelected))}</strong>
    <code style="font-size:11px;color:var(--text-dim)">${_wdEsc(_worldSelected)}</code>
    <span style="font-size:11px;color:var(--text-dim)">${_wdBlockCount(_worldSelected)} tiles</span>
    <button class="action-btn" id="wd-edit">✎ Edit tiles in Maps</button>
    <button class="action-btn" id="wd-deselect" style="opacity:.7">Deselect</button>
  </div>`;
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
  if (data) _worldData = { districts: data.districts || [], zones: data.zones || [] };
  const panel = document.getElementById('list-panel');
  const { byDist, un } = _wdBlocks();

  const blocks = [...byDist.entries()].map(([id, b]) => ({ id, ...b, kind: 'district' }));
  if (_worldShowLegacy && un) blocks.push({ id: '__unassigned', ...un, kind: 'unassigned' });

  if (!blocks.length) {
    panel.innerHTML = _wdToolbarHtml() +
      `<div style="padding:48px 24px;color:var(--text-dim);font-size:13px">No districts placed yet. Click <strong>＋ New District</strong> to generate one.</div>`;
    _wdWireChrome();
    return;
  }

  const gMinX = Math.min(...blocks.map(b => b.minX)), gMaxX = Math.max(...blocks.map(b => b.maxX));
  const gMinY = Math.min(...blocks.map(b => b.minY)), gMaxY = Math.max(...blocks.map(b => b.maxY));
  const pad = 2;
  const vbX = gMinX - pad, vbY = gMinY - pad, vbW = (gMaxX - gMinX) + 1 + pad * 2, vbH = (gMaxY - gMinY) + 1 + pad * 2;

  let rects = '';
  for (const b of blocks) {
    const x = b.minX, y = b.minY, w = (b.maxX - b.minX) + 1, h = (b.maxY - b.minY) + 1;
    const isDist = b.kind === 'district';
    const d = isDist ? _worldData.districts.find(dd => dd.id === b.id) : null;
    const fill = isDist ? (TERRAIN_FILL_BY_KEY[d?.base_terrain] || _wdHue(b.id)) : '#33373d';
    const sel = _worldSelected === b.id;
    const fs = Math.max(0.9, Math.min(w, h) * 0.2);
    rects += `<g class="wd-block" data-id="${_wdEsc(b.id)}" data-kind="${b.kind}" style="cursor:${isDist ? 'grab' : 'pointer'}">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="0.4"
        style="fill:${fill};fill-opacity:${isDist ? 0.85 : 0.28};stroke:${sel ? 'var(--accent)' : '#000'};stroke-width:${sel ? 0.55 : 0.15};stroke-opacity:${isDist ? 0.9 : 0.5}"></rect>
      <text x="${x + w / 2}" y="${y + h / 2}" text-anchor="middle" dominant-baseline="middle" font-size="${fs}"
        style="pointer-events:none;font-weight:700;fill:#fff;paint-order:stroke;stroke:#000;stroke-width:0.08">${_wdEsc(isDist ? _wdName(b.id) : 'legacy tiles')}</text>
      <text x="${x + w / 2}" y="${y + h / 2 + fs}" text-anchor="middle" font-size="${fs * 0.62}"
        style="pointer-events:none;fill:#d6dae0">${w}×${h} · ${b.count} tiles</text>
    </g>`;
  }

  const svg = `<svg id="wd-svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" preserveAspectRatio="xMidYMid meet"
    style="width:100%;max-height:calc(100vh - 210px);background:var(--bg1);border:1px solid var(--border);display:block">
    ${_wdGridLines(vbX, vbY, vbW, vbH)}${rects}</svg>`;

  panel.innerHTML = _wdToolbarHtml() + svg + _wdSelectedBarHtml();
  _wdWireChrome();
  _wdWireSvg();
}

function _wdWireChrome() {
  document.getElementById('wd-new')?.addEventListener('click', _wdNewDistrict);
  document.getElementById('wd-legacy')?.addEventListener('change', e => { _worldShowLegacy = e.target.checked; renderWorldEditor(); });
  document.getElementById('wd-edit')?.addEventListener('click', () => { window.worldSelectedDistrictId = _worldSelected; showPanel('maps'); });
  document.getElementById('wd-deselect')?.addEventListener('click', () => { _worldSelected = null; renderWorldEditor(); });
}

function _wdWireSvg() {
  const svg = document.getElementById('wd-svg');
  if (!svg) return;
  const vb = svg.viewBox.baseVal;
  // Uniform scale under preserveAspectRatio "meet" = min of the two axis ratios.
  const pxPerCell = () => Math.min(svg.clientWidth / vb.width, svg.clientHeight / vb.height) || 1;

  svg.querySelectorAll('.wd-block').forEach(g => {
    if (g.dataset.kind !== 'district') {
      g.addEventListener('click', () => { _worldSelected = g.dataset.id; renderWorldEditor(); });
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
      if (!moved || (!dx && !dy)) { _worldSelected = id; renderWorldEditor(); return; }
      const name = _wdName(id);
      const ok = await dpConfirm(`Move "${name}" by (${dx}, ${dy})?\n\nStaged as ONE change (${_wdBlockCount(id)} tiles) — publishes atomically. Exits stay intact.`, { title: 'Move District' });
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

// Where a freshly generated district lands: just east of the current occupied
// grid, top-aligned, with a gutter. The user drags it wherever afterward.
function _wdFreeOrigin() {
  const placed = _worldData.zones.filter(z => z.grid_x != null && (z.grid_z ?? 0) === 0);
  if (!placed.length) return { x: 0, y: 0 };
  return { x: Math.max(...placed.map(z => z.grid_x)) + 4, y: Math.min(...placed.map(z => z.grid_y)) };
}

async function _wdStageMove(id, dx, dy) {
  const res = await directAPI('/maps/move-district', 'POST', { districtId: id, dx, dy });
  if (res?.error) { toast(res.error, true); return false; }
  const changes = res.changes || [];
  const name = _wdName(id);
  const r = await directAPI('/staging/stage', 'POST', {
    entityType: 'district_move', entityId: id, entityName: name,
    changeType: 'update', method: 'POST', apiPath: '/maps/move-district',
    requestBody: { changes }, description: `Move district "${name}" by (${dx}, ${dy})`,
  });
  if (r?.error) { toast(r.error, true); return false; }
  // Optimistic: shift member zones locally so the overview previews until Publish.
  const byId = new Map(_worldData.zones.map(z => [z.id, z]));
  for (const c of changes) { const z = byId.get(c.id); if (z) { z.grid_x = c.patch.grid_x; z.grid_y = c.patch.grid_y; } }
  await updateStagingBadge();
  toast('District move staged ✓ — Publish to apply.');
  return true;
}

async function _wdNewDistrict() {
  const form = await _wdNewDistrictDialog();
  if (!form) return;
  const origin = _wdFreeOrigin();
  const res = await directAPI('/maps/generate-district', 'POST', {
    name: form.name, width: form.width, height: form.height, terrain: form.terrain,
    originX: origin.x, originY: origin.y, gridZ: 0,
  });
  if (res?.error) { toast(res.error, true); return; }
  const { district, zones } = res;
  const r = await directAPI('/staging/stage', 'POST', {
    entityType: 'district_create', entityId: district.id, entityName: district.name,
    changeType: 'create', method: 'POST', apiPath: '/maps/generate-district',
    requestBody: { district, zones }, description: `New district "${district.name}" (${form.width}×${form.height} ${form.terrain})`,
  });
  if (r?.error) { toast(r.error, true); return; }
  // Optimistic: add to the local model so it shows immediately (east of the rest).
  _worldData.districts.push(district);
  _worldData.zones.push(...zones);
  _worldSelected = district.id;
  await updateStagingBadge();
  toast(`District "${district.name}" staged ✓ — Publish to create it.`);
  renderWorldEditor();
}

// Multi-field form modal (dpPrompt is single-field). Resolves {name,width,height,terrain} or null.
function _wdNewDistrictDialog() {
  return new Promise(resolve => {
    document.getElementById('dp-dialog')?.remove();
    const fld = 'display:block;font-size:12px;color:var(--text-dim);margin-top:10px';
    const inp = 'width:100%;margin-top:4px;padding:6px 8px;background:var(--bg1);border:1px solid var(--border);border-radius:4px;color:var(--text);box-sizing:border-box';
    const terrOpts = TERRAIN_TYPES.map(t => `<option value="${t.key}">${t.label}</option>`).join('');
    const overlay = document.createElement('div');
    overlay.id = 'dp-dialog';
    overlay.className = 'dp-dialog-overlay';
    overlay.innerHTML = `
      <div class="dp-dialog-card" style="min-width:320px">
        <div class="dp-dialog-title">New District</div>
        <div class="dp-dialog-msg">A blank rectangle of terrain — fully walkable and exit-wired. Paint roads and buildings into it afterward from the Maps editor.</div>
        <label style="${fld}">Name<input class="wd-name" type="text" placeholder="e.g. Saltmarsh" style="${inp}"></label>
        <div style="display:flex;gap:10px">
          <label style="${fld};flex:1">Width<input class="wd-w" type="number" min="1" max="30" value="8" style="${inp}"></label>
          <label style="${fld};flex:1">Height<input class="wd-h" type="number" min="1" max="30" value="8" style="${inp}"></label>
        </div>
        <label style="${fld}">Base terrain<select class="wd-terrain" style="${inp}">${terrOpts}</select></label>
        <div class="wd-hint" style="font-size:11px;margin-top:8px;color:var(--text-dim)"></div>
        <div class="dp-dialog-actions">
          <button class="dp-dialog-cancel">Cancel</button>
          <button class="dp-dialog-ok">Create (staged)</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const nameEl = overlay.querySelector('.wd-name'), wEl = overlay.querySelector('.wd-w'),
      hEl = overlay.querySelector('.wd-h'), tEl = overlay.querySelector('.wd-terrain'),
      hint = overlay.querySelector('.wd-hint');
    tEl.value = 'concrete';
    nameEl.focus();
    const updateHint = () => {
      const n = (Math.floor(+wEl.value) || 0) * (Math.floor(+hEl.value) || 0);
      hint.textContent = n ? `${n} tiles${n > 400 ? ' — over the 400-tile limit, make it smaller' : ''}` : '';
      hint.style.color = n > 400 ? 'var(--danger)' : 'var(--text-dim)';
    };
    [wEl, hEl].forEach(el => el.addEventListener('input', updateHint));
    updateHint();
    const done = v => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onOk = () => {
      const name = nameEl.value.trim(), width = Math.floor(+wEl.value), height = Math.floor(+hEl.value);
      if (!name) { nameEl.focus(); return; }
      if (!(width >= 1 && height >= 1)) { wEl.focus(); return; }
      if (width * height > 400) { updateHint(); return; }
      done({ name, width, height, terrain: tEl.value });
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
