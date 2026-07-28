// The Studio's client. Two rules it never breaks:
//
//   1. It computes NO presentation. Every fill, ink and glyph on the canvas comes
//      from `spec`, the render spec derive produced (spec §2.3). There is no
//      palette in this file and no contrast function — that is what makes the
//      preview the ship rather than a second opinion about it.
//   2. It hand-writes NO form field. The inspector is generated from the field
//      catalog the game validates against, so a column somebody adds to the
//      catalog is editable here without touching this file.

const $ = (s) => document.querySelector(s);
const api = async (url, opts) => {
  const r = await fetch(url, opts);
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body };
};

const state = {
  mapId: null, zones: [], byId: new Map(), byCell: new Map(),
  terrains: [], terrain: null, tool: 'select',
  selected: null, catalog: null,
  cell: 14, ox: 0, oy: 0,
  maps: new Map(),   // id → { name, parent_zone_id } — the tile inspector needs to
                     // know whether a tile's map has an anchor at all
  mapView: null,     // the selected map's own properties, when the inspector is on it
};

const canvas = $('#c');
const ctx = canvas.getContext('2d');

// ── Map list ────────────────────────────────────────────────────────────────
async function loadMaps({ keep = false } = {}) {
  const { body } = await api('/api/world');
  state.maps = new Map(body.maps.map(m => [m.id, m]));
  $('#maps').innerHTML = body.maps.map(m =>
    `<button data-map="${m.id}">${m.name || m.id}<span class="n">${m.tiles}</span></button>`).join('');
  $('#maps').onclick = (e) => { const b = e.target.closest('button'); if (b) selectMap(b.dataset.map); };
  state.terrains = body.terrains;
  $('#terrains').innerHTML = state.terrains.map(t =>
    `<div class="sw" data-t="${t.key}" style="background:${t.fill}" title="${t.label}"><span>${t.key.slice(0, 4)}</span></div>`).join('');
  $('#terrains').onclick = (e) => {
    const s = e.target.closest('.sw'); if (!s) return;
    state.terrain = s.dataset.t; setTool('paint'); paintSwatches();
  };
  // A refresh after a rename must not yank the user back to the biggest map.
  if (keep) {
    document.querySelectorAll('.maplist button')
      .forEach(b => b.classList.toggle('on', b.dataset.map === state.mapId));
    return;
  }
  selectMap(body.maps[0]?.id);
}
const paintSwatches = () => document.querySelectorAll('.sw')
  .forEach(s => s.classList.toggle('on', s.dataset.t === state.terrain));

async function selectMap(id) {
  if (!id) return;
  state.mapId = id;
  state.selected = null;
  document.querySelectorAll('.maplist button').forEach(b => b.classList.toggle('on', b.dataset.map === id));
  const { body } = await api(`/api/world?map=${encodeURIComponent(id)}`);
  state.zones = body.zones;
  state.byId = new Map(body.zones.map(z => [z.id, z]));
  state.byCell = new Map(body.zones.map(z => [`${z.grid_x},${z.grid_y},${z.grid_z ?? 0}`, z]));
  fit();
  refreshLint();
  showMapProps();
}

// ── Canvas ──────────────────────────────────────────────────────────────────
function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  canvas.width = r.width; canvas.height = r.height;
  draw();
}
function bounds() {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const z of state.zones) {
    x0 = Math.min(x0, z.grid_x); x1 = Math.max(x1, z.grid_x);
    y0 = Math.min(y0, z.grid_y); y1 = Math.max(y1, z.grid_y);
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : { x0: 0, y0: 0, x1: 1, y1: 1 };
}
function fit() {
  // Re-measure first: the module runs before the grid has settled, so a fit that
  // trusted the last resize would centre the world on a 0×0 canvas.
  const r = canvas.parentElement.getBoundingClientRect();
  if (r.width && (canvas.width !== Math.floor(r.width) || canvas.height !== Math.floor(r.height))) {
    canvas.width = r.width; canvas.height = r.height;
  }
  const b = bounds();
  const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1;
  state.cell = Math.max(2, Math.min(28, Math.floor(Math.min(canvas.width / w, canvas.height / h))));
  state.ox = Math.round(canvas.width / 2 - ((b.x0 + b.x1 + 1) / 2) * state.cell);
  state.oy = Math.round(canvas.height / 2 - ((b.y0 + b.y1 + 1) / 2) * state.cell);
  draw();
}
const sx = (gx) => state.ox + gx * state.cell;
const sy = (gy) => state.oy + gy * state.cell;
const cellAt = (px, py) => state.byCell.get(
  `${Math.floor((px - state.ox) / state.cell)},${Math.floor((py - state.oy) / state.cell)},0`);

function draw() {
  ctx.fillStyle = '#0e0f12';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const c = state.cell;
  ctx.font = `${Math.max(6, Math.floor(c * 0.62))}px ui-monospace, monospace`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const z of state.zones) {
    const x = sx(z.grid_x), y = sy(z.grid_y);
    if (x + c < 0 || y + c < 0 || x > canvas.width || y > canvas.height) continue;
    const spec = z.spec || {};
    ctx.fillStyle = spec.fill || '#1a1c21';
    ctx.fillRect(x, y, c - 1, c - 1);
    // The entrance arrow is a fact the spec carries (facades only) — drawn, never
    // guessed from the road graph, which is the whole point of authoring it.
    if (spec.entrance && c >= 8) {
      ctx.fillStyle = '#ffd479';
      const m = c / 2, q = Math.max(2, c * 0.16);
      const p = { north: [m, q], south: [m, c - q], east: [c - q, m], west: [q, m] }[spec.entrance];
      if (p) { ctx.beginPath(); ctx.arc(x + p[0], y + p[1], q * 0.8, 0, 7); ctx.fill(); }
    }
    if (z.marker && c >= 9) {
      ctx.fillStyle = spec.text || '#c8c8cc';
      ctx.fillText(z.marker, x + c / 2 - 0.5, y + c / 2);
    }
  }
  if (state.selected) {
    const z = state.byId.get(state.selected);
    if (z) {
      ctx.strokeStyle = '#6ee7d0'; ctx.lineWidth = 2;
      ctx.strokeRect(sx(z.grid_x) - 1, sy(z.grid_y) - 1, c + 1, c + 1);
    }
  }
}

// ── Input ───────────────────────────────────────────────────────────────────
let panning = null, painting = false;
const stroke = new Set();

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', (e) => {
  const r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  if (e.button === 2) { panning = { px, py, ox: state.ox, oy: state.oy }; return; }
  const z = cellAt(px, py);
  if (!z) return;
  if (state.tool === 'pick') { state.terrain = z.spec?.terrain || null; setTool('paint'); paintSwatches(); return; }
  if (state.tool === 'paint') { painting = true; stroke.clear(); stroke.add(z.id); return; }
  select(z.id);
});
canvas.addEventListener('mousemove', (e) => {
  const r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  if (panning) {
    state.ox = panning.ox + (px - panning.px); state.oy = panning.oy + (py - panning.py);
    return draw();
  }
  const z = cellAt(px, py);
  $('#status').textContent = z ? `${z.name || '(unnamed)'} · ${z.id} · ${z.grid_x},${z.grid_y} · ${z.spec?.terrain || 'no terrain'}` : '—';
  if (painting && z) { stroke.add(z.id); }
});
window.addEventListener('mouseup', async () => {
  panning = null;
  if (!painting) return;
  painting = false;
  await paint([...stroke]);
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  const gx = (px - state.ox) / state.cell, gy = (py - state.oy) / state.cell;
  state.cell = Math.max(2, Math.min(40, state.cell + (e.deltaY < 0 ? 1 : -1)));
  state.ox = px - gx * state.cell; state.oy = py - gy * state.cell;
  draw();
}, { passive: false });

function setTool(t) {
  state.tool = t;
  for (const k of ['select', 'paint', 'pick']) $(`#t-${k}`).classList.toggle('on', k === t);
}
$('#m-props').onclick = showMapProps;
$('#t-select').onclick = () => setTool('select');
$('#t-paint').onclick = () => setTool('paint');
$('#t-pick').onclick = () => setTool('pick');
$('#t-clear').onclick = () => { state.terrain = null; setTool('paint'); paintSwatches(); };
$('#zoom-in').onclick = () => { state.cell = Math.min(40, state.cell + 2); draw(); };
$('#zoom-out').onclick = () => { state.cell = Math.max(2, state.cell - 2); draw(); };
$('#fit').onclick = fit;

async function paint(ids) {
  if (!ids.length) return;
  const { body } = await api('/api/paint', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, terrain: state.terrain }),
  });
  // The server hands back the RE-DERIVED spec for every painted tile. The client
  // never guesses what a terrain looks like, so a paint that the build would
  // render differently cannot appear correct here.
  for (const [id, spec] of Object.entries(body.specs || {})) {
    const z = state.byId.get(id); if (z) z.spec = spec;
  }
  if (body.errors?.length) alert(body.errors.join('\n'));
  draw();
  refreshLint();
  if (state.selected && ids.includes(state.selected)) select(state.selected);
}

// ── Inspector: generated from the field catalog ─────────────────────────────
async function loadCatalog() { state.catalog = (await api('/api/catalog')).body; }

let editing = null;   // the authored row, as loaded

async function select(id) {
  state.selected = id;
  state.mapView = null;
  draw();
  const { body } = await api(`/api/zone/${encodeURIComponent(id)}`);
  editing = body.zone;
  renderInspector(body.spec);
}

// ── The map's own properties ────────────────────────────────────────────────
// A map hangs off one world tile and is named after the building on it. Both are
// facts about the MAP, so this is where they are edited — and saving pushes the
// anchor onto every tile at once, which is the thing that keeps 331 tiles from
// each holding a private opinion about where their building is.
async function showMapProps() {
  if (!state.mapId) return;
  state.selected = null;
  const { body } = await api(`/api/map/${encodeURIComponent(state.mapId)}`);
  state.mapView = body;
  editing = null;
  draw();
  renderMapInspector();
}

function renderMapInspector() {
  const v = state.mapView;
  if (!v) return;
  const m = v.map;
  const zoneOpts = (sel, rows) => ['<option value="">—</option>',
    ...rows.map(r => `<option value="${esc(r.id)}"${r.id === sel ? ' selected' : ''}>${esc(r.name || r.id)}</option>`)].join('');
  const allZones = state.catalog.refs.zones || [];

  $('#inspector').innerHTML = `
    <div class="row" style="justify-content:space-between">
      <b>${esc(v.resolvedName || m.id)}</b><span class="pill">map</span>
    </div>
    <div class="help">${esc(m.id)} · ${v.tiles} tile(s)</div>

    <div class="grp"><div class="t">Map: Identity</div>
      <label for="m-name">Name${v.nameIsAuthored ? '' : ' (derived)'}</label>
      <input type="text" id="m-name" value="${esc(v.nameIsAuthored ? m.name : '')}"
             placeholder="${esc(v.derivedName || 'name this map')}">
      <div class="help">${v.derivedName
        ? `Leave it empty and this map is named after its building — <b>${esc(v.derivedName)}</b> — so renaming the facade renames the map. Type something only to override that.`
        : 'Nothing to derive a name from, so this one has to be typed.'}</div>
    </div>

    <div class="grp"><div class="t">Map: Anchor</div>
      <label for="m-parent">Parent Zone (world anchor)</label>
      <select id="m-parent">${zoneOpts(m.parent_zone_id ?? '', allZones)}</select>
      <div class="help">The world tile this whole map hangs off. Every tile on the map
        takes its <code>parent_zone</code> from here when you save — that is why it is
        edited on the map and locked on the tile. Empty means a top-level map
        (the world itself, Dreamzones, the Leviathan).</div>

      <label for="m-entry">Entry Zone</label>
      <select id="m-entry">${zoneOpts(m.entry_zone_id ?? '', v.zonesOnMap)}</select>
      <div class="help">Where a player lands diving into this map. Must be a tile on it.</div>
    </div>

    ${v.drifted ? `<div class="grp"><div class="t" style="color:var(--warn)">Out of sync</div>
      <div class="help">${v.drifted} tile(s) on this map disagree with the anchor. Saving repairs them.</div></div>` : ''}

    <div class="row" style="margin-top:12px"><button id="m-save">Save map</button><button id="m-revert">Revert</button></div>
    <div id="errs"></div><div id="note" class="help"></div>
    <div class="help" style="margin-top:8px">Writes <code>content/maps/${esc(m.id)}.json</code>
      and any tile it has to bring back into line.</div>`;

  $('#m-revert').onclick = showMapProps;
  $('#m-save').onclick = saveMapProps;
}

async function saveMapProps() {
  const v = state.mapView;
  $('#errs').textContent = '';
  const name = $('#m-name').value.trim();
  const row = {
    ...v.map,
    parent_zone_id: $('#m-parent').value || null,
    entry_zone_id: $('#m-entry').value || null,
  };
  // Absent, not empty: an omitted name is how a map says "derive it".
  if (name) row.name = name; else delete row.name;

  const { ok, body } = await api(`/api/map/${encodeURIComponent(v.map.id)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(row),
  });
  if (!ok) { $('#errs').textContent = (body.errors || [body.error]).join('\n'); return; }
  state.mapView = body;
  renderMapInspector();
  if (body.failed?.length) $('#errs').textContent = body.failed.join('\n');
  $('#note').textContent = body.pushed?.length
    ? `Saved · anchor pushed to ${body.pushed.length} tile(s).` : 'Saved.';
  await loadMaps({ keep: true });   // the list shows resolved names; this one may have changed
  refreshLint();
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function fieldHtml(key, def, value, kind) {
  const id = `f-${kind}-${key}`;
  const help = def.help ? `<div class="help">${esc(def.help)}</div>` : '';
  let input;
  switch (def.shape) {
    case 'flag':
      return `<div class="flagrow"><input type="checkbox" id="${id}" data-k="${esc(key)}" data-kind="${kind}" data-shape="flag" ${value ? 'checked' : ''}>
              <span class="k" title="${esc(def.help || '')}">${esc(def.label || key)}</span></div>`;
    case 'enum': {
      const opts = ['', ...(def.options || [])]
        .map(o => `<option value="${esc(o)}"${String(value ?? '') === o ? ' selected' : ''}>${o || '—'}</option>`).join('');
      input = `<select id="${id}" data-k="${esc(key)}" data-kind="${kind}" data-shape="enum">${opts}</select>`;
      break;
    }
    case 'ref': {
      const rows = state.catalog.refs[def.refTable] || [];
      const known = rows.some(r => r.id === value);
      const opts = ['<option value="">—</option>',
        ...(value && !known ? [`<option value="${esc(value)}" selected>${esc(value)} — NOT IN ${esc(def.refTable)}</option>`] : []),
        ...rows.map(r => `<option value="${esc(r.id)}"${r.id === value ? ' selected' : ''}>${esc(r.name || r.id)}</option>`)].join('');
      input = `<select id="${id}" data-k="${esc(key)}" data-kind="${kind}" data-shape="ref"${value && !known ? ' style="border-color:var(--bad)"' : ''}>${opts}</select>`;
      break;
    }
    case 'number':
      input = `<input type="number" id="${id}" data-k="${esc(key)}" data-kind="${kind}" data-shape="number" value="${esc(value ?? '')}">`;
      break;
    case 'list':
    case 'object':
    case 'range':
    case 'statmap':
    case 'hot':
      input = `<textarea id="${id}" data-k="${esc(key)}" data-kind="${kind}" data-shape="json">${esc(value == null ? '' : JSON.stringify(value, null, 1))}</textarea>`;
      break;
    default:
      input = (key === 'description')
        ? `<textarea id="${id}" data-k="${esc(key)}" data-kind="${kind}" data-shape="text">${esc(value ?? '')}</textarea>`
        : `<input type="text" id="${id}" data-k="${esc(key)}" data-kind="${kind}" data-shape="text" value="${esc(value ?? '')}">`;
  }
  return `<label for="${id}">${esc(def.label || key)}</label>${input}${help}`;
}

// A field the MAP owns, shown but not editable. Rendered without `data-k` so
// collect() never sees it and the value survives untouched from `editing` — the
// tile keeps carrying the anchor, it just no longer gets a second opinion about
// it. (The server refuses an anchor-violating save too; this is so you find out
// before you type, not after.)
function lockedFieldHtml(label, value, why) {
  return `<label>${esc(label)} <span class="pill">map</span></label>
          <input type="text" value="${esc(value ?? '')}" disabled>
          <div class="help">${why}</div>`;
}

function renderInspector(spec) {
  if (!editing) return;
  const cols = state.catalog.columns, flags = state.catalog.flags;
  const groups = new Map();
  const push = (g, html) => { if (!groups.has(g)) groups.set(g, []); groups.get(g).push(html); };

  const ordered = (o) => Object.entries(o).sort((a, b) =>
    String(a[1].group || '').localeCompare(String(b[1].group || '')) || (a[1].order ?? 99) - (b[1].order ?? 99));

  // `parent_zone` is the map's anchor once a tile is on a map; only a tile on NO
  // map still owns it (there it means the dev panel's room grouping, which is a
  // different thing and stays editable).
  const onMap = !!editing.map_id;
  const mapAnchor = state.maps.get(editing.map_id)?.parent_zone_id ?? null;
  for (const [key, def] of ordered(cols)) {
    if (key === 'parent_zone' && onMap) {
      push(def.group || 'Zone', lockedFieldHtml(def.label || key, editing[key],
        `Owned by map <code>${esc(editing.map_id)}</code> — every tile on it shares one anchor. Change it in the map's properties.`));
      continue;
    }
    push(def.group || 'Zone', fieldHtml(key, def, editing[key], 'col'));
  }
  // Only flags the tile CARRIES, plus an add-a-flag picker: 104 checkboxes is a
  // wall, and a tile's flags are a short list in practice.
  const carried = Object.keys(editing.flags || {}).filter(k => flags[k]);
  for (const key of carried) {
    // Same rule for the interior tile's copy of the anchor. On a FACADE the flag
    // means the street out front, which is nobody else's business — left alone.
    if (key === 'world_exit_zone' && onMap && !editing.flags?.facade && mapAnchor != null) {
      push(flags[key].group || 'Flags', lockedFieldHtml(flags[key].label || key, editing.flags[key],
        'On an interior tile this is the map anchor again. Change it in the map\'s properties.'));
      continue;
    }
    push(flags[key].group || 'Flags', fieldHtml(key, flags[key], editing.flags[key], 'flag'));
  }
  const uncatalogued = Object.keys(editing.flags || {}).filter(k => !flags[k]);

  const addable = Object.entries(flags).filter(([k]) => !carried.includes(k))
    .sort((a, b) => String(a[1].label || a[0]).localeCompare(String(b[1].label || b[0])));

  $('#inspector').innerHTML = `
    <div class="row" style="justify-content:space-between">
      <b>${esc(editing.name || editing.id)}</b>
      <span class="pill">${esc(editing.grid_x)},${esc(editing.grid_y)}</span>
    </div>
    <div class="help">${esc(editing.id)}</div>
    <div class="help">derived: fill ${esc(spec?.fill || '—')} · glyph ${esc(spec?.glyph || '—')} · terrain ${esc(spec?.terrain || '—')}</div>
    ${[...groups].map(([g, fs]) => `<div class="grp"><div class="t">${esc(g)}</div>${fs.join('')}</div>`).join('')}
    ${uncatalogued.length ? `<div class="grp"><div class="t" style="color:var(--warn)">Not in the catalog</div>
      <div class="help">${uncatalogued.map(esc).join(', ')} — these fail content:lint. Catalogue them or remove them.</div></div>` : ''}
    <div class="grp">
      <div class="t">Add a flag</div>
      <select id="addflag"><option value="">—</option>${addable.map(([k, d]) =>
        `<option value="${esc(k)}">${esc(d.label || k)}</option>`).join('')}</select>
    </div>
    <div class="row" style="margin-top:12px"><button id="save">Save file</button><button id="revert">Revert</button></div>
    <div id="errs"></div>`;

  $('#addflag').onchange = (e) => {
    const k = e.target.value; if (!k) return;
    const def = flags[k];
    editing.flags = { ...(editing.flags || {}), [k]: def.shape === 'flag' ? true : (def.options?.[0] ?? '') };
    renderInspector(spec);
  };
  $('#revert').onclick = () => select(editing.id);
  $('#save').onclick = save;
}

function collect() {
  const row = { ...editing, flags: { ...(editing.flags || {}) } };
  for (const el of document.querySelectorAll('#inspector [data-k]')) {
    const k = el.dataset.k, kind = el.dataset.kind, shape = el.dataset.shape;
    let v;
    if (shape === 'flag') v = el.checked ? true : undefined;
    else if (shape === 'number') v = el.value === '' ? null : Number(el.value);
    else if (shape === 'json') {
      if (el.value.trim() === '') v = null;
      else { try { v = JSON.parse(el.value); } catch { throw new Error(`${k}: not valid JSON`); } }
    } else v = el.value === '' ? null : el.value;
    if (kind === 'flag') { if (v === undefined || v === null) delete row.flags[k]; else row.flags[k] = v; }
    else row[k] = v;
  }
  return row;
}

async function save() {
  $('#errs').textContent = '';
  let row;
  try { row = collect(); } catch (e) { $('#errs').textContent = e.message; return; }
  const { ok, body } = await api(`/api/zone/${encodeURIComponent(row.id)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(row),
  });
  if (!ok) { $('#errs').textContent = (body.errors || [body.error]).join('\n'); return; }
  const z = state.byId.get(row.id);
  if (z) { z.spec = body.spec; z.name = row.name; z.marker = row.marker ?? null; }
  draw();
  await select(row.id);
  refreshLint();
}

// ── Lint: the authored half, live (§8.4) ────────────────────────────────────
async function refreshLint() {
  const { body } = await api('/api/lint');
  const e = body.errors?.length || 0, w = body.warnings?.length || 0;
  $('#lint').innerHTML = e
    ? `<b style="color:var(--bad)">${e} lint error(s)</b> — ${esc(body.errors[0])}`
    : `lint clean · <b>${w}</b> warning(s) <span class="muted">· derived-half rules need an import</span>`;
}

window.addEventListener('resize', resize);
await loadCatalog();
resize();
await loadMaps();
