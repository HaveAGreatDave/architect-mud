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
  overlay: 'icons',  // 'icons' | 'labels' — the game's own switch, same two names
                     // (client/game/js/panels/minimap.js `avenueOverlay`). It picks
                     // BETWEEN the two layers a tile can stand on; drawing both was
                     // a mode the game never renders.
  maps: new Map(),   // id → { name, parent_zone_id } — the tile inspector needs to
                     // know whether a tile's map has an anchor at all
  mapView: null,     // the selected map's own properties, when the inspector is on it
  portals: {},       // zoneId → seam[] for the open map, from the build's own edge
                     // projection (kind: 'portal'). The tool decides nothing about
                     // what a warp is; it draws what derive already called one.
  z: 0, floors: [0], // ONE floor is drawn at a time. 273 cells on this world hold
                     // more than one tile, so a stacked draw is tiles hidden under
                     // tiles — and a click could only ever reach the z=0 occupant.
  history: [],       // where a jump came from, so following a seam is not one-way
  journal: { entries: [], undone: [], max: 0 },  // the server's action log — what
                     // Ctrl+Z would take back, and what redo would put back. Held
                     // by the server, because the files are, so it survives a reload.
  // ── The district view ──────────────────────────────────────────────────────
  // A SECOND VIEW OF THE SAME MAP, not a second screen: the canvas, the camera,
  // the floor and the open map all survive the switch, and only three things
  // change — what the tiles are coloured by, what the sidebar lists, and what the
  // brush paints. A district is a property spread across thousands of tiles, so
  // the only honest way to edit it is on the map it covers.
  view: 'tiles',      // 'tiles' | 'districts' | 'threat'
  districts: [],      // the list, with tile counts, from /api/districts
  districtById: new Map(),
  district: null,     // the selected district id, or '' for the eraser
  districtStats: null,
  // ── The threat view ────────────────────────────────────────────────────────
  // The third view, and the only one that shows something the map does not own:
  // spawns are authored against zones, and this is where they land on ground.
  // Read-only — the Studio has no opinion about what a monster is.
  threat: null,       // the server's rollup for the open map, or null
  heat: null,         // { byTile: Map(id → threat), peak } under the current filter
  enemy: null,        // an enemy id to show alone, or null for all of them
  // ── Moving a building ──────────────────────────────────────────────────────
  // `arm` is the CHEAP half of the refusals, fetched once when a building is
  // picked up, so the ghost can be honest while the cursor moves instead of one
  // request per hovered cell. The authoritative answer is still the server's plan,
  // on click — this only decides what the overlay tints red.
  move: { arm: null, hover: null, plan: null },
};

const canvas = $('#c');
const ctx = canvas.getContext('2d');

// ── Map list ────────────────────────────────────────────────────────────────
async function loadMaps({ keep = false } = {}) {
  const { body } = await api('/api/world');
  state.maps = new Map(body.maps.map(m => [m.id, m]));
  // esc() like every other render site here. A map's name is DERIVED from the
  // building it hangs off, so it is authored prose reaching innerHTML — one
  // apostrophe-and-angle-bracket building name away from breaking this list.
  $('#maps').innerHTML = body.maps.map(m =>
    `<button data-map="${esc(m.id)}">${esc(m.name || m.id)}<span class="n">${esc(m.tiles)}</span></button>`).join('');
  $('#maps').onclick = (e) => { const b = e.target.closest('button'); if (b) selectMap(b.dataset.map); };
  showOpenMap();
  state.terrains = body.terrains;
  $('#terrains').innerHTML = state.terrains.map(t =>
    `<div class="sw" data-t="${esc(t.key)}" style="background:${esc(t.fill)}" title="${esc(t.label)}"><span>${esc(t.key.slice(0, 4))}</span></div>`).join('');
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

// The list fans down and folds back up, and its summary carries the one thing the
// open list was telling you all the time it was open: which map you are on. Picking
// one folds it — the answer is now in the summary, and 71 entries is most of the
// column otherwise. Following a seam changes the map without touching the list, so
// the summary is refreshed from state rather than from the click.
function showOpenMap() {
  const m = state.maps.get(state.mapId);
  $('#mapwho').textContent = m ? (m.name || m.id) : 'pick a map';
  $('#mapn').textContent = m ? m.tiles : '';
  $('#mapfan').title = m ? `${m.id} — ${state.maps.size} maps` : '';
}

// The tiles of one map and everything derived about them. Split out of selectMap
// because an undo needs the SAME re-read without the camera moving: after a revert
// the files have changed under a map you are already looking at, and re-fitting it
// would be the tool losing your place to tell you something it could have told you
// in situ. `resetFloor` is the difference between opening a map and refreshing one.
async function loadMapData(id, { resetFloor = false } = {}) {
  const { body } = await api(`/api/world?map=${encodeURIComponent(id)}`);
  state.zones = body.zones;
  state.byId = new Map(body.zones.map(z => [z.id, z]));
  state.byCell = new Map(body.zones.map(z => [`${z.grid_x},${z.grid_y},${z.grid_z ?? 0}`, z]));
  state.portals = body.portals || {};
  state.floors = [...new Set(body.zones.map(z => z.grid_z ?? 0))].sort((a, b) => b - a);
  if (!state.floors.length) state.floors = [0];
  if (resetFloor || !state.floors.includes(state.z)) {
    state.z = state.floors.includes(0) ? 0 : state.floors[0];
  }
}

// Re-read the open map in place: same camera, same floor, same selection. The
// specs come back re-derived by the server, so this is a fresh paint of the whole
// map rather than a patch of the tiles somebody names.
async function reloadOpenMap() {
  if (!state.mapId) return;
  const keep = state.selected;
  const onMapProps = !!state.mapView;
  await loadMapData(state.mapId);
  renderFloors();
  // A tile that moved took its spawns with it, so the heat is re-asked rather than
  // left pointing at where the building used to be.
  if (state.view === 'threat') await loadThreat({ force: true });
  draw();
  if (keep && state.byId.has(keep)) await showTile(keep);
  else if (onMapProps && state.view !== 'threat') await showMapProps();
}

// `focus` lands on one tile (following a seam); `restore` puts a remembered view
// back (stepping back out of one). Neither is given when a map is picked from the
// list, and then it fits and shows the map's own properties as it always has.
async function selectMap(id, { focus = null, restore = null } = {}) {
  if (!id) return;
  state.mapId = id;
  state.selected = null;
  document.querySelectorAll('.maplist button').forEach(b => b.classList.toggle('on', b.dataset.map === id));
  showOpenMap();
  $('#mapfan').open = false;
  await loadMapData(id, { resetFloor: true });
  renderFloors();
  if (restore) restoreView(restore);
  else if (focus) focusZone(focus);
  else if (state.view === 'threat') fit();     // the inspector is the threat one
  else { fit(); showMapProps(); }
  // The heat belongs to a map, so following a seam into a building has to re-ask.
  if (state.view === 'threat') await loadThreat().then(draw);
  refreshLint();
}

// ── Districts ───────────────────────────────────────────────────────────────
async function loadDistrictList() {
  const { body } = await api('/api/districts');
  state.districts = body.districts || [];
  state.districtById = new Map(state.districts.map(d => [d.id, d]));
  state.districtStats = { unassigned: body.unassigned || 0, unknown: body.unknown || [] };
  state.districtCatalog = body.catalog || {};
  renderDistrictList();
}

function renderDistrictList() {
  const s = state.districtStats || { unassigned: 0, unknown: [] };
  const row = (id, swatch, name, count, cls = '') =>
    `<button data-d="${esc(id)}" class="${cls}${state.district === id ? ' on' : ''}">
       ${swatch}<span class="nm">${esc(name)}</span><span class="n">${count}</span></button>`;
  const sw = (colour) => `<span class="sw" style="background:${esc(colour || 'transparent')}"></span>`;

  // The eraser first, because "this tile belongs to nothing" is a state you paint
  // INTO as often as out of, and because its count is the honest headline of this
  // screen: 1,150 tiles nobody has classified.
  let html = row('', '<span class="sw"></span>', 'Erase (no district)', s.unassigned, 'none');
  html += state.districts.map(d => row(d.id, sw(d.color), d.name || d.id, d.tiles)).join('');
  // A tile naming a district that does not exist is inert in the game and invisible
  // in review — listed loudly rather than counted as if it were an assignment.
  html += (s.unknown || []).map(u =>
    row(u.id, '<span class="sw"></span>', `${u.id} — no such district`, u.tiles, 'bad')).join('');
  $('#districts').innerHTML = html;
  $('#districts').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    selectDistrict(b.dataset.d);
  };
}

// Selecting a district loads it as the brush AND opens its properties. One click
// doing both is the point: the thing you are painting with is the thing you are
// editing, so a colour you change lands on the map you are looking at.
async function selectDistrict(id, { showProps = true } = {}) {
  state.district = id;
  state.selected = null;
  renderDistrictList();
  draw();
  if (!showProps) return;
  if (!id) {
    $('#inspector').innerHTML = `<div class="row" style="justify-content:space-between">
        <b>Erase</b><span class="pill">brush</span></div>
      <div class="help">Paint over a tile to clear <code>flags.district</code>. The tile
        falls back to the legacy id-prefix rung if it has one, and otherwise reads as
        nothing — which in game means the engine's own default neighbourhood, not silence.</div>`;
    return;
  }
  if (!state.districtById.has(id)) {
    $('#inspector').innerHTML = `<div class="row" style="justify-content:space-between">
        <b>${esc(id)}</b><span class="pill" style="border-color:var(--bad)">missing</span></div>
      <div class="help stale">Tiles claim this district and no district file defines it, so
        every one of them resolves to the engine default instead. Repaint them, or add
        <code>content/districts/${esc(id)}.json</code>.</div>`;
    return;
  }
  const { body } = await api(`/api/district/${encodeURIComponent(id)}`);
  editingDistrict = body.district;
  renderDistrictInspector();
}

let editingDistrict = null;

function renderDistrictInspector() {
  const d = editingDistrict;
  if (!d) return;
  const meta = state.districtById.get(d.id) || {};
  const cols = state.districtCatalog || {};
  const groups = new Map();
  const ordered = Object.entries(cols).sort((a, b) =>
    String(a[1].group || '').localeCompare(String(b[1].group || '')) || (a[1].order ?? 99) - (b[1].order ?? 99));
  for (const [key, def] of ordered) {
    const g = def.group || 'District';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(fieldHtml(key, def, d[key], 'dcol'));
  }
  $('#inspector').innerHTML = `
    <div class="row" style="justify-content:space-between">
      <b>${esc(d.name || d.id)}</b><span class="pill">district</span>
    </div>
    <div class="help">${esc(d.id)} · ${meta.tiles ?? 0} tile(s)
      — ${meta.authoredTiles ?? 0} painted, ${meta.prefixTiles ?? 0} by legacy id prefix</div>
    ${meta.isFallback ? `<div class="help">This is the engine's fallback: any tile that
      names no district and matches no prefix reads as this one. Editing its prose edits
      what ${state.districtStats?.unassigned ?? 0} unclassified tiles say.</div>` : ''}
    ${[...groups].map(([g, fs]) => `<div class="grp"><div class="t">${esc(g)}</div>${fs.join('')}</div>`).join('')}
    <div class="help" style="margin-top:12px">Writes <code>content/districts/${esc(d.id)}.json</code>.
      Colour shows on the tablet's regional map; terrain still paints the tile at normal zoom.</div>
    <div class="actions">
      <div class="row"><button id="d-save">Save district</button><button id="d-revert">Revert</button></div>
      <div id="errs"></div><div id="note" class="help"></div>
    </div>`;
  $('#d-revert').onclick = () => selectDistrict(d.id);
  $('#d-save').onclick = saveDistrict;
}

async function saveDistrict() {
  $('#errs').textContent = '';
  const row = { ...editingDistrict };
  try {
    for (const el of document.querySelectorAll('#inspector [data-kind="dcol"]')) {
      const k = el.dataset.k, shape = el.dataset.shape;
      if (shape === 'number') row[k] = el.value === '' ? null : Number(el.value);
      else if (shape === 'json') {
        if (el.value.trim() === '') row[k] = null;
        else { try { row[k] = JSON.parse(el.value); } catch { throw new Error(`${k}: not valid JSON`); } }
      } else row[k] = el.value === '' ? null : el.value;
    }
  } catch (e) { $('#errs').textContent = e.message; return; }
  const { ok, body } = await api(`/api/district/${encodeURIComponent(row.id)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(row),
  });
  if (!ok) { $('#errs').textContent = (body.errors || [body.error]).join('\n'); return; }
  editingDistrict = body.district;
  state.districts = body.districts || state.districts;
  state.districtById = new Map(state.districts.map(x => [x.id, x]));
  state.districtStats = { unassigned: body.unassigned || 0, unknown: body.unknown || [] };
  renderDistrictList();
  renderJournal(body.journal);
  renderDistrictInspector();
  $('#note').textContent = 'Saved.';
  draw();          // a colour change lands on the map in the same breath
  refreshLint();
}

// Painting a district is the same gesture as painting terrain, against a different
// field: the stroke collects tile ids, and the server writes flags.district on each.
async function assign(ids) {
  if (!ids.length) return;
  const { body } = await api('/api/assign', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, district: state.district || null }),
  });
  for (const [id, d] of Object.entries(body.changed || {})) {
    const z = state.byId.get(id);
    if (z) z.district = d ? { id: d, source: 'authored' } : { id: null, source: 'none' };
  }
  if (body.errors?.length) alert(body.errors.join('\n'));
  state.districts = body.districts || state.districts;
  state.districtById = new Map(state.districts.map(x => [x.id, x]));
  state.districtStats = { unassigned: body.unassigned || 0, unknown: body.unknown || [] };
  renderDistrictList();
  renderJournal(body.journal);
  draw();
  refreshLint();
}

// ── Threat ──────────────────────────────────────────────────────────────────
// WHERE THE DANGER IS, on the map you are already looking at. A spawn row says
// "3 clonejackers in zone_district_918_904" and nothing about where that is; the
// answer to "is the north side of town harder than the docks" was 120 files and a
// mental picture. So it is drawn: heat on the tiles, hottest enemies in the list.
//
// The score is crude on purpose (hp + swing + accuracy, times how many stand up)
// and the server owns it. Nothing in the game reads it; it exists to make one tile
// redder than another, and a scale nobody can act on would be worse than none.
const THREAT_STEPS = [0.15, 0.4, 0.7, 1];

async function loadThreat({ force = false, pickFloor = false } = {}) {
  if (!state.mapId) return;
  if (!force && state.threat?.map === state.mapId) { recomputeHeat(); return pickFloor && landOnDanger(); }
  const { body } = await api(`/api/threat?map=${encodeURIComponent(state.mapId)}`);
  state.threat = body;
  // A filter naming an enemy that is not on this map would silently show an empty
  // map, so switching map lets it go rather than carrying it across.
  if (state.enemy && !body.enemies.some(e => e.id === state.enemy)) state.enemy = null;
  recomputeHeat();
  renderFloors();
  if (pickFloor) landOnDanger();
}

// Opening the view on the wrong floor is opening it on a lie: 119 of the world
// map's 120 spawns are at z=-1, in The Under, beneath streets that hold one. So
// ENTERING the view lands on the busiest floor. It moves you only on the switch —
// a floor you pick afterwards is a floor you meant, and nothing here takes it back.
function landOnDanger() {
  const by = spawnsByFloor();
  const best = [...by.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best && best[1] > 0) setFloor(best[0]);
}

// How many spawns stand on each floor of the open map. A floor is a separate
// PLACE here, not a storey — The Under is z=-1 beneath the same streets — so this
// is the difference between "this town is quiet" and "you are on the wrong floor".
function spawnsByFloor() {
  const by = new Map();
  for (const [id, t] of Object.entries(state.threat?.tiles || {})) {
    const z = state.byId.get(id);
    if (!z) continue;
    const f = z.grid_z ?? 0;
    by.set(f, (by.get(f) || 0) + t.spawns);
  }
  return by;
}

// The heat, under whatever the list is filtered to. Held rather than recomputed
// per tile per frame: a pan over map_world is 5,439 tiles × 60fps, and this is the
// same numbers every time until the filter moves.
function recomputeHeat() {
  const byTile = new Map();
  let peak = 0;
  for (const [id, t] of Object.entries(state.threat?.tiles || {})) {
    const sum = state.enemy
      ? t.entries.reduce((n, e) => n + e.spawns.reduce((m, s) => m + (s.enemy_id === state.enemy ? s.threat : 0), 0), 0)
      : t.threat;
    if (sum > 0) { byTile.set(id, sum); peak = Math.max(peak, sum); }
  }
  state.heat = { byTile, peak };
  renderThreatPane();
}

// How red one tile goes: a sqrt ramp, so a lone weak spawn still reads without
// washing out the tile with eleven of them on it. 0 means draw no heat at all —
// a dimmed tile with nothing on it must not look like a tile with something quiet.
const heatAlpha = (threat) => {
  const peak = state.heat?.peak || 0;
  if (!peak || !threat) return 0;
  return 0.2 + 0.8 * Math.sqrt(threat / peak);
};

function renderThreatPane() {
  const t = state.threat;
  if (!t) return;
  const { totals } = t;
  // The count on THIS floor, said separately, because the map only ever draws one
  // and a headline of 120 over a plan showing 8 is the tool misleading you.
  const by = spawnsByFloor();
  const floors = [...by.entries()].filter(([, n]) => n).sort((a, b) => b[1] - a[1]);
  const elsewhereFloors = floors.filter(([z]) => z !== state.z);
  $('#threatsum').innerHTML = totals.spawns
    ? `<b>${by.get(state.z) || 0}</b> spawn${by.get(state.z) === 1 ? '' : 's'} on this floor,
       <b>${totals.spawns}</b> on the map — ${t.enemies.length} kind${t.enemies.length === 1 ? '' : 's'} of thing.
       ${elsewhereFloors.length ? `<span class="muted">Also ${elsewhereFloors.map(([z, n]) =>
         `<a href="#" data-floor="${z}" style="color:var(--accent);text-decoration:none">z=${z}</a> (${n})`).join(', ')}.</span>` : ''}`
    : `Nothing spawns on this map. <span class="muted">${totals.world} spawn(s) exist in the world.</span>`;
  $('#threatsum').onclick = (ev) => {
    const a = ev.target.closest('[data-floor]'); if (!a) return;
    ev.preventDefault(); setFloor(Number(a.dataset.floor));
  };
  $('#heatkey').innerHTML = `<span class="muted" style="margin-right:4px">quiet</span>`
    + THREAT_STEPS.map(s => `<i><span style="opacity:${(0.2 + 0.8 * s).toFixed(2)}"></span></i>`).join('')
    + `<span class="muted" style="margin-left:4px">deadly</span>`;

  const top = t.enemies[0]?.threat || 1;
  const rows = t.enemies.map(e => {
    const on = state.enemy === e.id;
    const width = Math.max(2, Math.round(100 * e.threat / top));
    return `<button data-e="${esc(e.id)}" class="${e.missing ? 'bad ' : ''}${on ? 'on' : ''}">
      <span class="bar" style="width:${width}%"></span>
      <span class="nm">${esc(e.name || `${e.id} — no such enemy`)}</span>
      <span class="n">×${e.heads}</span>
      <span class="go" data-go="${esc(e.top || '')}" title="fly to where it is thickest">⌖</span>
    </button>`;
  }).join('');
  $('#enemies').innerHTML = rows || '<div class="help">—</div>';
  $('#enemies').onclick = (ev) => {
    const go = ev.target.closest('.go');
    const b = ev.target.closest('button'); if (!b) return;
    // ⌖ takes you there without changing what you are looking at; the row itself
    // filters. Two answers to two different impulses, one row.
    if (go) { if (go.dataset.go) focusZone(go.dataset.go); return; }
    setEnemyFilter(state.enemy === b.dataset.e ? null : b.dataset.e);
  };

  // The two things a map of one map cannot show: danger that lives on another map,
  // and danger that lives nowhere at all.
  const notes = [];
  if (totals.elsewhere) notes.push(`${totals.elsewhere} spawn(s) sit on other maps.`);
  if (t.orphans.length) {
    notes.push(`<span class="help stale"><b>${t.orphans.length}</b> spawn zone(s) are on no grid at all
      — they spawn in game and appear on no map:</span> ${t.orphans.slice(0, 6).map(o =>
        esc(o.zone.name || o.zone.id)).join(', ')}${t.orphans.length > 6 ? '…' : ''}`);
  }
  $('#threatnote').innerHTML = notes.join('<br>');
}

function setEnemyFilter(id) {
  state.enemy = id;
  recomputeHeat();
  draw();
}

// One tile's spawns, in the inspector: what is on it, what is folded up into it
// from inside, and how the number was reached. Read-only, and it says so.
function renderThreatInspector(z) {
  if (!z) return;
  const t = state.threat?.tiles?.[z.id];
  const total = t ? Math.round(t.threat) : 0;
  const line = (s, from) => `<div class="row" style="justify-content:space-between;gap:8px;margin:2px 0">
      <span class="${s.missing ? 'help stale' : ''}">${esc(s.name || `${s.enemy_id} — no such enemy`)}
        <span class="muted">×${s.max_count}</span></span>
      <span class="muted" style="flex:none">${s.respawn_seconds}s · w${s.spawn_weight} · ${Math.round(s.threat)}</span>
    </div>${from ? `<div class="help" style="margin:-2px 0 4px">inside: ${esc(from)}</div>` : ''}`;
  const body = t ? t.entries.map(e =>
      e.spawns.map(s => line(s, e.zone.inside ? `${e.zone.name} — ${e.zone.mapName}` : '')).join('')).join('')
    : '<div class="help">Nothing spawns here.</div>';
  $('#inspector').innerHTML = `
    <div class="row" style="justify-content:space-between">
      <b>${esc(z.name || z.id)}</b><span class="pill">threat ${total}</span>
    </div>
    <div class="help">${esc(z.id)} · ${z.grid_x},${z.grid_y}${z.grid_z ? `,${z.grid_z}` : ''}</div>
    <div class="grp" style="margin-top:10px"><div class="t">Spawns</div>${body}</div>
    <div class="help" style="margin-top:10px">Count, respawn, weight, and this row's share
      of the tile's score. Spawns are authored in <code>content/zone_spawns/</code> and the
      monsters themselves in <code>content/enemies/</code> — the Studio reads both and writes
      neither.</div>`;
}

function setView(v) {
  state.view = v;
  $('#v-tiles').classList.toggle('on', v === 'tiles');
  $('#v-districts').classList.toggle('on', v === 'districts');
  $('#v-threat').classList.toggle('on', v === 'threat');
  $('#pane-terrain').style.display = v === 'tiles' ? '' : 'none';
  $('#pane-districts').style.display = v === 'districts' ? '' : 'none';
  $('#pane-threat').style.display = v === 'threat' ? '' : 'none';
  // The camera, the floor and the open map are deliberately untouched — switching
  // view is a change of question ("what is here?" / "whose is this?"), not a change
  // of place. Only the brush has to be handed over, since the two views paint
  // different fields with the same drag.
  setTool('select');
  if (v === 'districts') { if (state.district === null) state.district = ''; selectDistrict(state.district); }
  else if (v === 'threat') {
    // The heat is fetched, so the first frame after the switch is drawn without it
    // and the second with it. That is one flash of the plain map, which is the
    // right thing to show while the question is still being answered.
    state.selected = null;
    $('#inspector').innerHTML = '<div class="muted">Reading the spawns…</div>';
    loadThreat({ pickFloor: true }).then(() => {
      if (state.view !== 'threat') return;
      if (!state.selected) $('#inspector').innerHTML =
        '<div class="muted">Click a tile to see what stands on it.</div>';
      draw();
    });
  }
  else if (state.selected) select(state.selected); else showMapProps();
  draw();
}

// ── Floors ──────────────────────────────────────────────────────────────────
// A map is a stack, not a sheet: 20 of the 71 have more than one z, and the
// residential lobby has five. Drawing them at once buried tiles under tiles and
// let a click reach only the ground floor, so the canvas shows one at a time.
function renderFloors() {
  const wrap = $('#floors');
  wrap.style.display = state.floors.length > 1 ? '' : 'none';
  // In the threat view a floor with nothing on it is a floor you do not need to
  // look at, and the one you want is often not the one you are on: the whole of
  // The Under is z=-1 under the streets. So the buttons carry a dot.
  const hot = state.view === 'threat' ? spawnsByFloor() : null;
  wrap.innerHTML = state.floors.map(z =>
    `<button data-z="${z}" class="${z === state.z ? 'on' : ''}" ${hot?.get(z)
      ? `title="${hot.get(z)} spawn(s)"` : ''}>${z > 0 ? `+${z}` : z}${hot?.get(z) ? ' •' : ''}</button>`).join('');
  wrap.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    setFloor(Number(b.dataset.z));
  };
}
function setFloor(z) {
  if (z === state.z) return;
  state.z = z;
  renderFloors();
  // The threat headline counts the floor you are looking at, so it moves with you.
  if (state.view === 'threat' && state.threat) renderThreatPane();
  draw();
}

// ── Canvas ──────────────────────────────────────────────────────────────────
function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  canvas.width = r.width; canvas.height = r.height;
  draw();
}
const onFloor = (z) => (z.grid_z ?? 0) === state.z;

function bounds() {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const z of state.zones.filter(onFloor)) {
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
  `${Math.floor((px - state.ox) / state.cell)},${Math.floor((py - state.oy) / state.cell)},${state.z}`);

// A BAR ACROSS AN EDGE, never an arrow. This is the one piece of chrome that took
// three goes, so the reasoning lives here.
//
// A portal's `direction` is the movement VERB you would type. Its far end is on
// another map, so no side of this tile faces it — but the direction is still a
// true statement about THIS TILE'S EDGE, because an authored connection *claims*
// its (from, direction) and the grid edge there steps aside (§7.5). Nothing is
// reachable that way except the seam.
//
// Drawn as an arrow that reads as a vector AT THE NEIGHBOUR, and the neighbour is
// innocent: Pawn & Pity's seam direction is `east`, and east on the world map is
// The Lucky Bastard, so the arrow pointed at the casino while meaning "step east into
// Pawn & Pity's own interior". Drawn as a bar ON the edge it reads as a property
// of this tile — a threshold, the way a floor plan draws a doorway — and says the
// same thing without pointing at anybody.
//
// WHICH edge, when a tile has two candidates: the AUTHORED one wins. A facade
// carries `flags.entrance` (the street-facing door) and a seam direction into the
// building, and they are opposite by construction on 60 of the 62 — through a
// north door means heading south. Two bars on two edges is one fact rendered
// twice, so the entrance bar is drawn INSTEAD, not as well. Only a tile with no
// authored door falls back to its seam direction (65 of 150). Up/down/in/out have
// no side at all (23), and those keep a centre dot; there is no edge to bar and
// inventing one would be the arrow all over again.
const BAR = {
  north: (x, y, c, t) => [x + 2, y + 1, c - 5, t],
  south: (x, y, c, t) => [x + 2, y + c - 2 - t, c - 5, t],
  west: (x, y, c, t) => [x + 1, y + 2, t, c - 5],
  east: (x, y, c, t) => [x + c - 2 - t, y + 2, t, c - 5],
};
const edgeBar = (x, y, c, dir, colour) => {
  const at = BAR[dir];
  if (!at) return false;
  ctx.fillStyle = colour;
  ctx.fillRect(...at(x, y, c, Math.max(2, Math.round(c * 0.17))));
  return true;
};

// ── The feature layer (spec.feature) ────────────────────────────────────────
//
// THE ACTUAL SVG THE GAME DRAWS, not a drawing of one. `spec.feature` is a name in
// client/game/assets/zone-icons/ — a road connector, a building rooftop, a statue —
// resolved by the build (derive.mjs deriveFeature), and the game paints exactly the
// same file through a CSS mask.
//
// An earlier pass hand-drew the road lanes on canvas from `spec.auto_tile`, matching
// the connector SVGs' geometry and dash pattern by eye. It looked right, and it was
// still the Studio holding an opinion about what a road looks like — the one thing
// this file is not allowed to do, and guaranteed drift the moment anyone retouches
// one of those assets. Naming a piece here at all is what regress forbids.
//
// The assets are stroked `currentColor` on a 24-unit viewBox, so the tile's own ink
// (spec.text — yellow road markings, tan for a dirt lane) is substituted in and the
// result cached per name+colour. A miss draws nothing this frame and repaints once
// loaded, which keeps draw() synchronous.
const ICON_CACHE = new Map();   // "name|ink" → Image once loaded, null while pending
let iconPending = 0;

// Chrome colours come from the one place chrome is declared — index.html's `:root` —
// so the swatch in the key and the mark on the tile cannot drift apart. A canvas will
// not take a `var()`, so they are resolved once and cached.
const CSSVAR = new Map();
function chrome(name) {
  if (!CSSVAR.has(name)) {
    CSSVAR.set(name, getComputedStyle(document.documentElement).getPropertyValue(name).trim());
  }
  return CSSVAR.get(name) || '#c8c8cc';
}

function featureImage(name, ink) {
  if (!/^[a-z0-9_-]+$/i.test(name || '')) return null;
  const key = `${name}|${ink || 'none'}`;
  const hit = ICON_CACHE.get(key);
  if (hit !== undefined) return hit;
  ICON_CACHE.set(key, null);
  iconPending++;
  const settle = () => { if (--iconPending === 0) draw(); };
  fetch(`/zone-icons/${encodeURIComponent(name)}.svg`)
    .then(r => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
    .then((svg) => {
      const img = new Image();
      // `currentColor` is what lets one asset serve every terrain. The game does the
      // substitution with a CSS mask and `color`; a canvas has no cascade.
      const painted = svg.replace(/currentColor/g, ink || '#c8c8cc');
      img.onload = () => { ICON_CACHE.set(key, img); settle(); };
      img.onerror = settle;
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(painted);
    })
    .catch(settle);
  return null;
}

function drawFeature(x, y, c, name, ink) {
  const img = featureImage(name, ink);
  if (img) ctx.drawImage(img, x, y, c, c);
}

// ── Why this tile looks like this ───────────────────────────────────────────
//
// `prov` is derive's own precedence reporting which rung won (featureProvenance),
// not a second opinion computed here. It answers the question an editor has to
// answer and a renderer never does: not "what does this draw" but "who decided".
//
// The stale case is the one worth the code. An authored `flags.icon` outranks
// auto-tiling — that is what makes it an override — but a pin does not grow an arm
// when a lane is painted beside it later, and the result is a road visibly dead-
// ending into another road. 13 tiles are already in that state. Aggregate counts in
// a regress log do not get read while you are looking at the map; this does.
const PROV_WORDS = {
  authored: 'pinned by hand — outranks everything below',
  rooftop: "derived from this building's type",
  auto: 'auto-tiled from the lanes beside it',
};
// WHICH RUNG PAINTED THIS TILE. The three Presentation fields are real overrides
// now — a tile's own marker/colour/fill beats the terrain palette on every terrain
// (docs/proposals/tile-presentation-overrides.md). Before that flip the palette won
// almost everywhere and this form said nothing about it, so 3,484 authored fills sat
// in the inspector looking live while the map ignored every one of them. Attribution
// is one line and it is the check: a field that says "yours" is on the map, and if it
// ever stops being, this line is where that shows up instead of nowhere.
function paintedLine(spec) {
  const t = spec?.terrain;
  const from = (own) => (own != null && own !== '')
    ? 'yours' : (t ? `the ${t} palette` : 'derived');
  return `<div class="help">painted:
    fill <b>${esc(spec?.fill || '—')}</b> (${esc(from(editing.bg_color))})
    · glyph <b>${esc(spec?.text || '—')}</b> (${esc(from(editing.color))})
    · marker <b>${esc(spec?.label?.text || '—')}</b> (${editing.marker ? 'yours' : 'derived'})
    · terrain <b>${esc(t || '—')}</b> — <b>Paint</b> over the tile to change it
    ${t && editing.bg_color ? `<div class="warn" style="font-size:10px">Tile Colour
      <b>${esc(editing.bg_color)}</b> is shadowing the ${esc(t)} palette: repaint this tile and the
      fill will not move. Clear it to hand the ground back to its terrain.</div>` : ''}</div>`;
}

function featureLine(p) {
  if (!p?.name) return '<div class="help">art: none — this tile draws only its ground</div>';
  const stale = p.stale;
  return `<div class="help">art: <b>${esc(p.name)}</b> — ${esc(PROV_WORDS[p.source] || p.source)}</div>`
    + (stale ? `<div class="help stale">⚠ this pin is stale: the lanes around it now imply
         <b>${esc(p.implied)}</b>. Clear Map Icon to follow the map, or leave it to keep this.</div>` : '');
}

function drawPortal(x, y, c, seams, authoredDoor) {
  const leaves = seams.find(s => s.way === 'out') || seams[0];
  ctx.strokeStyle = chrome('--seam'); ctx.lineWidth = c >= 12 ? 2 : 1;
  ctx.strokeRect(x + 1, y + 1, c - 3, c - 3);
  if (c < 9) return;
  // The authored door already barred this tile — don't bar a second edge.
  if (authoredDoor) return;
  // An inbound-only seam's direction belongs to the tile at the OTHER end, so it
  // is not an edge of this one.
  if (leaves.way === 'out' && edgeBar(x, y, c, leaves.dir, chrome('--seam'))) return;
  const m = (c - 1) / 2, q = Math.max(2.5, c * 0.2);
  ctx.fillStyle = chrome('--seam'); ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(x + m, y + m, q * 0.7, 0, 7);
  if (leaves.way === 'out') ctx.fill(); else ctx.stroke();
}

// THE DISTRICT BOUNDARY. A wash says which tiles are claimed; it does not say what
// SHAPE the claim is, and shape is the thing you are editing. So every district is
// also drawn as an outline: one line on every tile edge whose neighbour is not the
// same district, which is a boundary derived per tile rather than a polygon traced
// once. That is deliberate — a district is a property of tiles, not a region, and
// nothing anywhere requires it to be connected. A neighbourhood split across a
// river, an orphan tile someone painted three streets away and a doughnut with a
// hole in it all outline correctly, because each of them is just a set of tiles
// whose edges happen to face something else.
//
// The selected district is drawn bold over a dark casing so the line survives on
// top of its own wash and on top of whatever ground colour is underneath; the rest
// are hairlines in their own colour, enough to read the seams between them without
// competing with the one you are working on. Off-map counts as "not the same
// district", so the outer rim of the world is a boundary too.
const DIR4 = [[0, -1], [1, 0], [0, 1], [-1, 0]];
function districtAt(gx, gy) {
  return state.byCell.get(`${gx},${gy},${state.z}`)?.district?.id || null;
}
function strokeSegs(segs) {
  ctx.beginPath();
  for (const s of segs) { ctx.moveTo(s[0], s[1]); ctx.lineTo(s[2], s[3]); }
  ctx.stroke();
}
// A boundary line sits ON the tile edge, centred, never inset inside the tile. Two
// insets is what makes a line look wrong: a bold edge pushed half its width inward
// and a hairline pushed half a pixel meet at a corner with a notch between them, and
// two districts sharing an edge draw two parallel lines with a sliver of ground
// showing through. Centred, every line is the same line — the widths stack on one
// axis and the last one drawn wins, which is why the selected district strokes last.
//
// `off` is the half-pixel alignment: a canvas line of ODD width centred on an
// integer coordinate straddles two pixel columns and renders as two grey ones. Tile
// edges are always integers here (`ox` is rounded, `cell` is whole), so an odd width
// takes a 0.5 nudge and an even one takes none.
function edgeSeg(x, y, c, dir, off) {
  if (dir === 0) return [x, y + off, x + c, y + off];
  if (dir === 1) return [x + c + off, y, x + c + off, y + c];
  if (dir === 2) return [x, y + c + off, x + c, y + c + off];
  return [x + off, y, x + off, y + c];
}
function drawDistrictEdges(c) {
  if (c < 3) return;
  const sel = state.district || null;
  // Even widths only: the casing is bold+2 and both must land on the same alignment
  // as each other, and an even line centred on an integer edge is the crisp case.
  const bold = Math.max(2, Math.min(6, Math.round(c * 0.22 / 2) * 2));
  const others = new Map();   // colour → segments, so each district strokes once
  const mine = [];
  for (const z of state.zones) {
    if (!onFloor(z)) continue;
    const id = z.district?.id;
    if (!id) continue;
    const x = sx(z.grid_x), y = sy(z.grid_y);
    if (x + c < 0 || y + c < 0 || x > canvas.width || y > canvas.height) continue;
    const owned = id === sel;
    for (let d = 0; d < 4; d++) {
      if (districtAt(z.grid_x + DIR4[d][0], z.grid_y + DIR4[d][1]) === id) continue;
      const seg = edgeSeg(x, y, c, d, owned ? 0 : 0.5);
      if (owned) { mine.push(seg); continue; }
      // A tile claiming a district with no file has no colour to outline in, so it
      // outlines in the same red the wash-less marker uses.
      const col = state.districtById.get(id)?.color || chrome('--bad');
      const bucket = others.get(col);
      if (bucket) bucket.push(seg); else others.set(col, [seg]);
    }
  }
  const cap = ctx.lineCap;
  ctx.lineCap = 'square';       // square caps close the corners; round ones nick them
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.55;
  for (const [col, segs] of others) { ctx.strokeStyle = col; strokeSegs(segs); }
  ctx.globalAlpha = 1;
  if (mine.length) {
    ctx.lineWidth = bold + 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    strokeSegs(mine);
    ctx.lineWidth = bold;
    ctx.strokeStyle = state.districtById.get(sel)?.color || chrome('--bad');
    strokeSegs(mine);
  }
  ctx.lineWidth = 1;
  ctx.lineCap = cap;
}

function draw() {
  ctx.fillStyle = chrome('--bg');
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const c = state.cell;
  ctx.font = `${Math.max(6, Math.floor(c * 0.62))}px ui-monospace, monospace`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const z of state.zones) {
    if (!onFloor(z)) continue;
    const x = sx(z.grid_x), y = sy(z.grid_y);
    if (x + c < 0 || y + c < 0 || x > canvas.width || y > canvas.height) continue;
    const spec = z.spec || {};
    ctx.fillStyle = spec.fill || chrome('--bg3');
    // EDGE TO EDGE. Painted ground is a surface, not a swatch: the 1px gutter this
    // used to leave broke a bay into 945 blue squares and a road into a dotted line
    // of separate tiles. The grid comes back as a hairline once you are zoomed in
    // far enough to be editing rather than looking (below), which is the only time
    // counting tiles is what you are doing.
    ctx.fillRect(x, y, c, c);
    if (c >= 14) {
      ctx.fillStyle = 'rgba(255,255,255,0.055)';
      ctx.fillRect(x + c - 1, y, 1, c); ctx.fillRect(x, y + c - 1, c, 1);
    }
    // The entrance is a fact the spec carries (facades only) — drawn, never guessed
    // from the road graph, which is the whole point of authoring it. It is a BAR
    // rather than a dot because the side is the useful half: a street of shops
    // reads as a row of thresholds facing the road, and a door on the wrong side
    // is visible from across the map instead of one tile at a time.
    const authoredDoor = !!(spec.entrance && c >= 8 && edgeBar(x, y, c, spec.entrance, chrome('--entrance')));
    // The two layers that stand on the ground, in the same order the game stacks
    // them: the footprint SVG, then the code someone reads off it. Which of the two
    // a tile shows is the OVERLAY MODE, and the rule is the game's — minimap.js's
    // `symFor`, not a second one written here:
    //
    //   Labels REPLACES the graphic. A building's art and its navigable code are two
    //   ways of saying the same tile, so the game shows one or the other. Drawing
    //   both — which this did — is the one combination no screen in the game renders,
    //   and on a small cell the letters sit in the middle of the rooftop.
    //   A label of kind `mark` is exempt in both directions: an AUTHORED marker is
    //   the TILE'S OWN DRAWING, like a road connector, so it survives every mode.
    //   Derived codes are annotations and toggle; a glyph someone deliberately
    //   placed is not. (This was `art`, a class that meant "in the sewers" and was
    //   tested by id prefix — see deriveLabel for why it is gone.)
    //   A tile with no label falls through to its art, so Labels mode empties the
    //   map of buildings' rooftops and nothing else.
    //
    // The one place this parts company with the game: a tile with a code and NO art
    // still shows the code in Art mode. Most interiors are that — Chrome Court is 12
    // room designations and not one SVG — and the game can afford to show those as
    // bare floor because a player is standing in the room reading its name. An editor
    // cannot: the toggle is there to stop two layers fighting over one tile, and
    // there is nothing to fight with here.
    const lbl = (spec.label && c >= 9) ? spec.label : null;
    const lettersWin = state.overlay === 'labels' && lbl && lbl.kind !== 'mark';
    if (spec.feature && !lettersWin) drawFeature(x, y, c, spec.feature, spec.text);
    if (lbl && (lettersWin || lbl.kind === 'mark' || !spec.feature)) {
      ctx.fillStyle = spec.text || '#c8c8cc';
      ctx.fillText(spec.label.text, x + c / 2 - 0.5, y + c / 2);
    }
    // A pinned tile is marked, because an override you cannot see is one you cannot
    // review — and a STALE pin (adjacency has moved on beneath it) is marked louder,
    // since that one is a defect rather than a decision. This is the only thing on
    // the canvas that is about authoring rather than about what the game will draw.
    if (z.prov?.source === 'authored' && c >= 7) {
      const stale = z.prov.stale;
      ctx.fillStyle = chrome(stale ? '--bad' : '--accent');
      ctx.beginPath();
      ctx.arc(x + c - Math.max(2.5, c * 0.16), y + Math.max(2.5, c * 0.16), Math.max(1.5, c * 0.09), 0, 7);
      ctx.fill();
    }
    // DISTRICT VIEW. The ground keeps its own colour underneath — a district is a
    // claim ABOUT this tile, not a replacement for it, and painting over the terrain
    // entirely would leave you assigning neighbourhoods to a map you can no longer
    // read. So it goes on as a wash, the district's own authored colour, with the
    // selected one at full strength and the rest halved: which tiles are mine, and
    // what is around them, in one look.
    //
    // A tile claiming nothing gets NO wash and a dim cross-hatch dot instead. That
    // is 1,150 tiles, and they must not look like a decision somebody made.
    if (state.view === 'districts') {
      const d = z.district || { id: null, source: 'none' };
      const colour = d.id ? state.districtById.get(d.id)?.color : null;
      if (colour) {
        const mine = state.district && d.id === state.district;
        ctx.globalAlpha = mine ? 0.72 : 0.34;
        ctx.fillStyle = colour;
        ctx.fillRect(x, y, c, c);
        ctx.globalAlpha = 1;
        // Claimed by a district that does not exist: the wash cannot show it (there
        // is no colour to show), so it is marked the way a stale pin is.
      } else if (d.id) {
        ctx.strokeStyle = chrome('--bad'); ctx.lineWidth = 1;
        ctx.strokeRect(x + 1.5, y + 1.5, c - 3, c - 3);
      } else if (c >= 6) {
        ctx.fillStyle = chrome('--dim'); ctx.globalAlpha = 0.5;
        ctx.fillRect(x + c / 2 - 1, y + c / 2 - 1, 2, 2);
        ctx.globalAlpha = 1;
      }
      // A tile assigned only by its zone-id prefix is inherited, not authored. It
      // reads as a district today and stops the moment its id changes, so it is
      // drawn a half-tone lighter than a painted one rather than identically.
      if (colour && d.source === 'prefix' && c >= 8) {
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, c - 1, c - 1);
      }
    }
    // THREAT VIEW. The ground is dimmed rather than replaced — a coastline and a
    // street grid are how you know *where* the red is, and a monochrome plan drawn
    // here would be a second map disagreeing with the one next door. So: a scrim
    // over the tile, then the heat on top of it. The scrim goes over the feature
    // and the label too, on purpose; in this view the question is not what the
    // building is called.
    if (state.view === 'threat') {
      const threat = state.heat?.byTile.get(z.id) || 0;
      // Both colours are the page's own chrome, read from the stylesheet like every
      // other non-map mark here — the scrim is the canvas background and the heat is
      // --bad, the same red a stale pin and a refused destination wear.
      ctx.globalAlpha = 0.62;
      ctx.fillStyle = chrome('--bg');
      ctx.fillRect(x, y, c, c);
      ctx.globalAlpha = 1;
      const a = heatAlpha(threat);
      if (a) {
        ctx.globalAlpha = a;
        ctx.fillStyle = chrome('--bad');
        ctx.fillRect(x, y, c, c);
        ctx.globalAlpha = 1;
        // At a readable zoom the hottest tiles get an outline, because a spawn
        // point is a place you go to, and "which tile exactly" stops being
        // answerable by a wash once four of them are adjacent.
        if (c >= 9 && a > 0.55) {
          ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, c - 1, c - 1);
        }
      }
    }
    const seams = state.portals[z.id];
    if (seams && c >= 5) drawPortal(x, y, c, seams, authoredDoor);
  }
  // After every tile, never during: a boundary drawn tile-by-tile inside the loop
  // gets half painted over by the neighbour that comes next.
  if (state.view === 'districts') drawDistrictEdges(c);
  // MOVING A BUILDING. Two things are drawn and neither is a decision this file
  // makes: the cells the server said are already built on or already have something
  // standing on them, and a ghost of the building under the cursor. The ghost wears
  // the door on the side the building's own `flags.entrance` says, because that side
  // does not move — it is the whole of why a destination gets refused, and seeing it
  // land on a wall is quicker than reading that it did.
  const arm = state.view === 'tiles' ? state.move.arm : null;
  if (arm) {
    for (const z of state.zones) {
      if (!onFloor(z) || z.id === arm.facade) continue;
      if (!arm.built.has(z.id) && !arm.occupied.has(z.id)) continue;
      const x = sx(z.grid_x), y = sy(z.grid_y);
      if (x + c < 0 || y + c < 0 || x > canvas.width || y > canvas.height) continue;
      ctx.fillStyle = chrome('--bad'); ctx.globalAlpha = 0.28;
      ctx.fillRect(x, y, c, c);
      ctx.globalAlpha = 1;
    }
    const held = state.byId.get(arm.facade);
    if (held && onFloor(held)) {
      ctx.strokeStyle = chrome('--accent'); ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(sx(held.grid_x) - 1, sy(held.grid_y) - 1, c + 1, c + 1);
      ctx.setLineDash([]);
    }
    const over = state.move.hover && state.byId.get(state.move.hover);
    if (over && onFloor(over) && over.id !== arm.facade) {
      const bad = arm.built.has(over.id) || arm.occupied.has(over.id);
      const x = sx(over.grid_x), y = sy(over.grid_y);
      ctx.strokeStyle = chrome(bad ? '--bad' : '--accent'); ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, c - 2, c - 2);
      if (arm.entrance && c >= 8) edgeBar(x, y, c, arm.entrance, chrome('--entrance'));
    }
  }

  if (state.selected) {
    const z = state.byId.get(state.selected);
    if (z && onFloor(z)) {
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
  // Same three tools, pointed at whichever field the view is about.
  if (state.view === 'districts') {
    if (state.tool === 'pick') { selectDistrict(z.district?.id || ''); setTool('paint'); return; }
    if (state.tool === 'paint') { painting = true; stroke.clear(); stroke.add(z.id); return; }
    // Select, in this view, answers "whose is this?" — it opens the tile's district
    // rather than the tile, which is the question you are in this view to ask.
    selectDistrict(z.district?.id || '');
    return;
  }
  // Nothing in this view paints, so every tool is Select and a click is a look.
  if (state.view === 'threat') {
    state.selected = z.id;
    state.mapView = null;
    draw();
    renderThreatInspector(z);
    return;
  }
  if (state.tool === 'pick') { state.terrain = z.spec?.terrain || null; setTool('paint'); paintSwatches(); return; }
  if (state.tool === 'paint') { painting = true; stroke.clear(); stroke.add(z.id); return; }
  if (state.tool === 'move') { moveClick(z); return; }
  select(z.id);
});
canvas.addEventListener('mousemove', (e) => {
  const r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  if (panning) {
    state.ox = panning.ox + (px - panning.px); state.oy = panning.oy + (py - panning.py);
    return draw();
  }
  const z = cellAt(px, py);
  const seam = z && seamLabel(state.portals[z.id]);
  // In the district view the readout answers that view's question: which district,
  // and whether the tile was painted into it or merely inherits it from its id.
  const SOURCE_WORDS = { authored: 'painted', prefix: 'by legacy id prefix', unknown: 'NO SUCH DISTRICT' };
  const dis = z && state.view === 'districts'
    ? (z.district?.id
        ? `${state.districtById.get(z.district.id)?.name || z.district.id} (${SOURCE_WORDS[z.district.source] || z.district.source})`
        : 'no district')
    : null;
  // And in the threat view, what stands here — the names, not the score, because
  // the colour has already told you the score and cannot tell you this.
  const t = z && state.view === 'threat' ? state.threat?.tiles?.[z.id] : null;
  const danger = z && state.view === 'threat'
    ? (t ? t.entries.flatMap(e => e.spawns.map(s =>
          `${s.name || s.enemy_id} ×${s.max_count}${e.zone.inside ? ` (${e.zone.name})` : ''}`)).join(', ')
         : 'nothing spawns here')
    : null;
  $('#status').textContent = z
    ? `${z.name || '(unnamed)'} · ${z.id} · ${z.grid_x},${z.grid_y} · ${danger || dis || z.spec?.terrain || 'no terrain'}${seam ? ` · ${seam} — double-click to follow` : ''}`
    : '—';
  if (painting && z) { stroke.add(z.id); }
  if (state.tool === 'move' && state.move.arm) {
    const id = z?.id ?? null;
    if (id !== state.move.hover) { state.move.hover = id; draw(); }
  }
});

// Following a seam is the whole point of marking it: the map list is 71 entries
// deep and finding the far side of a door by name is the thing this replaces.
canvas.addEventListener('dblclick', (e) => {
  if (state.tool !== 'select') return;   // a double-click while painting is a paint
  const r = canvas.getBoundingClientRect();
  const z = cellAt(e.clientX - r.left, e.clientY - r.top);
  const seams = z && state.portals[z.id];
  if (!seams?.length) return;
  const seam = seams.find(s => s.way === 'out') || seams[0];
  jumpTo(seam.far);
});
window.addEventListener('mouseup', async () => {
  panning = null;
  if (!painting) return;
  painting = false;
  if (state.view === 'districts') await assign([...stroke]);
  else await paint([...stroke]);
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
  for (const k of ['select', 'paint', 'pick', 'move']) $(`#t-${k}`).classList.toggle('on', k === t);
  $('#pane-move').style.display = (t === 'move' && state.view === 'tiles') ? '' : 'none';
  // Putting the tool down puts the building down with it. A building held across a
  // switch to Paint would be a pickup nothing on screen was still showing.
  if (t !== 'move') disarmMove();
}
$('#m-props').onclick = showMapProps;
$('#t-select').onclick = () => setTool('select');
$('#t-paint').onclick = () => setTool('paint');
$('#t-pick').onclick = () => setTool('pick');
$('#t-move').onclick = () => setTool('move');
$('#m-cancel').onclick = () => { disarmMove(); if (state.selected) select(state.selected); else showMapProps(); };
$('#t-clear').onclick = () => { state.terrain = null; setTool('paint'); paintSwatches(); };
function setOverlay(o) {
  state.overlay = o;
  $('#o-art').classList.toggle('on', o === 'icons');
  $('#o-labels').classList.toggle('on', o === 'labels');
  draw();
}
$('#v-tiles').onclick = () => setView('tiles');
$('#v-districts').onclick = () => setView('districts');
$('#v-threat').onclick = () => setView('threat');
$('#o-art').onclick = () => setOverlay('icons');
$('#o-labels').onclick = () => setOverlay('labels');
$('#fit').onclick = fit;

// ── Traversal ───────────────────────────────────────────────────────────────
// UP IS NOT NORTH. They shared `↑` while the only list this fed was a tile's
// portals, where a `north` seam and an `up` seam never appeared together. A
// tile's full exit list puts them one row apart — a stairwell landing reads
// north, east, up, down — so the two vertical steps take glyphs of their own and
// the compass keeps the plain arrows.
//
// EVERY DIRECTION THE WORLD HAS ONE, which is the other half of the same lesson.
// The diagonals had no entry and fell back to the raw word, and the word does not
// fit the 12px cell an arrow was sized for: an apartment landing with a northeast
// exit printed "northeast" straight through the name of the flat it led to. The
// keys here are OPPOSITE's, so a direction that can exist has a glyph — and the
// diagonals took `↘`/`↖` back off in/out, which now read as crossing a threshold
// rather than as pointing somewhere.
const DIR_ARROW = {
  north: '↑', south: '↓', east: '→', west: '←',
  northeast: '↗', southeast: '↘', southwest: '↙', northwest: '↖',
  up: '⇧', down: '⇩', in: '⇥', out: '⇤',
};
function seamLabel(seams) {
  if (!seams?.length) return null;
  const s = seams.find(x => x.way === 'out') || seams[0];
  const where = `${s.far.name || s.far.zone}${s.far.mapName ? ` · ${s.far.mapName}` : ' · on no map'}`;
  return s.way === 'out'
    ? `${DIR_ARROW[s.dir] || s.dir} ${where}${s.twoWay ? '' : ' (one-way)'}`
    : `← ${where} (one-way in)`;
}

// Centre the view on one tile, on ITS floor — a destination two storeys down is
// not "found" if the canvas is still showing the ground floor.
function focusZone(id) {
  const z = state.byId.get(id);
  if (!z) return;
  if ((z.grid_z ?? 0) !== state.z) { state.z = z.grid_z ?? 0; renderFloors(); }
  state.cell = Math.max(state.cell, 14);
  state.ox = Math.round(canvas.width / 2 - (z.grid_x + 0.5) * state.cell);
  state.oy = Math.round(canvas.height / 2 - (z.grid_y + 0.5) * state.cell);
  showTile(id);
}

// Landing on a tile answers the question the CURRENT view is asking. Following a
// seam in the threat view and being handed the terrain form would be the tool
// changing the subject at the moment you arrived.
function showTile(id) {
  if (state.view !== 'threat') return select(id);
  state.selected = id;
  state.mapView = null;
  draw();
  renderThreatInspector(state.byId.get(id));
}

function restoreView(v) {
  state.z = v.z; state.cell = v.cell; state.ox = v.ox; state.oy = v.oy;
  renderFloors();
  if (v.zone && state.byId.has(v.zone)) showTile(v.zone);
  else if (state.view === 'threat') { state.selected = null; draw(); }
  else { state.selected = null; draw(); showMapProps(); }
}

// A tile on no map has nowhere to open — 12 seams end that way, and the honest
// answer is to say so rather than to jump somewhere plausible.
async function jumpTo(far) {
  if (!far?.map) { $('#status').textContent = `${far?.name || far?.zone} is on no map — nothing to open.`; return; }
  state.history.push({ map: state.mapId, zone: state.selected, z: state.z, cell: state.cell, ox: state.ox, oy: state.oy });
  if (far.map !== state.mapId) await selectMap(far.map, { focus: far.zone });
  else focusZone(far.zone);
  updateBack();
}

async function goBack() {
  const v = state.history.pop();
  if (!v) return;
  if (v.map !== state.mapId) await selectMap(v.map, { restore: v });
  else restoreView(v);
  updateBack();
}
function updateBack() {
  const b = $('#back');
  b.disabled = !state.history.length;
  b.textContent = state.history.length ? `← Back (${state.history.length})` : '← Back';
}
$('#back').onclick = goBack;

// ── The action log ──────────────────────────────────────────────────────────
// Every write in this tool is a file on disk before you have finished the gesture
// — there is no unsaved buffer to close without saving — so the only honest undo
// is one that writes the files back, and that is the server's job (see the action
// log in serve.mjs). This half is the shelf it goes on: what happened, what a
// Ctrl+Z would take back, and where to look while it does.
//
// Nothing here decides what an action was or what reverting it means. Every
// mutation response carries the log, so the list is the server's answer rather
// than a client-side guess that drifts the first time a save touches a file the
// client did not know about — which a map save, pushing its anchor onto 331
// tiles, does every time.
const ago = (t) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
};

function renderJournal(j) {
  if (j) state.journal = j;
  const { entries = [], undone = [], max = 0 } = state.journal;
  $('#undo').disabled = !entries.length;
  $('#redo').disabled = !undone.length;
  $('#undo').title = entries.length ? `Undo: ${entries[0].label}` : 'Nothing to undo';
  $('#redo').title = undone.length ? `Redo: ${undone[undone.length - 1].label}` : 'Nothing to redo';
  $('#logwho').textContent = entries.length ? entries[0].label : 'no edits yet';
  $('#logn').textContent = entries.length ? `${entries.length}/${max}` : '';
  // Newest first, undone entries above the ones still in effect — the line between
  // them is where you are, and it moves as you travel rather than the list rewriting.
  const rows = [...undone, ...entries];
  const row = (e, i) => `<button data-seq="${e.seq}" data-undone="${e.undone ? 1 : 0}"
      class="${e.undone ? 'undone' : ''}${i === undone.length && !e.undone ? ' here' : ''}"
      title="${esc(e.detail || '')}">${esc(e.label)}<span class="n">${e.files} file(s)</span><span class="when">${ago(e.at)}</span></button>`;
  $('#log').innerHTML = rows.length
    ? rows.map(row).join('')
    : `<div class="help">Nothing yet. Paint, assign or save and it lands here — the
       last ${max} actions, oldest dropped.</div>`;
  $('#log').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    travelTo(Number(b.dataset.seq), b.dataset.undone === '1');
  };
}

async function refreshJournal() { renderJournal((await api('/api/journal')).body); }

// One step, either way. A refusal is reported and the entry stays exactly where it
// was: the usual cause is somebody else having written the file since (a git pull,
// sync-map-anchors), and there is nothing to retry until that is dealt with.
async function timeTravel(url) {
  const { ok, body } = await api(url, { method: 'POST' });
  if (!ok) {
    renderJournal(body.journal);
    $('#status').textContent = (body.errors || [body.error]).join(' ');
    return false;
  }
  renderJournal(body.journal);
  const t = body.touched || {};
  // GO AND LOOK AT IT. A revert that lands on a map you are not showing is a
  // silent write, which is the thing this feature exists to stop being possible.
  const target = t.maps?.includes(state.mapId) ? state.mapId : t.maps?.[0];
  if (target && target !== state.mapId) await selectMap(target, { focus: t.zones?.[0] });
  else await reloadOpenMap();
  // A district's colour, a tile's membership and a map's resolved name all move
  // with the same revert, and each is read from somewhere other than the tiles.
  await loadDistrictList();
  if (state.view === 'districts') await selectDistrict(state.district);
  await loadMaps({ keep: true });
  $('#status').textContent =
    `${body.direction === 'redo' ? 'Redid' : 'Undid'}: ${body.entry.label} · ${body.entry.files} file(s) rewritten`;
  refreshLint();
  return true;
}

const undo = () => timeTravel('/api/undo');
const redo = () => timeTravel('/api/redo');

// Clicking an entry goes back (or forward) THROUGH it, which is only ever repeated
// single steps — the stack stays strictly last-in-first-out, because that is what
// makes each step's "this file was mine to revert" true. A step that refuses stops
// the run where it is rather than skipping over it.
async function travelTo(seq, isUndone) {
  for (let i = 0; i <= state.journal.max; i++) {
    const { entries = [], undone = [] } = state.journal;
    if (!isUndone && !entries.some(e => e.seq === seq)) break;   // it has been undone
    if (isUndone && !undone.some(e => e.seq === seq)) break;     // it has been redone
    if (!(await timeTravel(isUndone ? '/api/redo' : '/api/undo'))) break;
  }
}

$('#undo').onclick = undo;
$('#redo').onclick = redo;

// A text field owns its own Ctrl+Z — the inspector is full of them, and stealing
// the keystroke there would mean a typo in a description could only be taken back
// by reverting the whole file.
window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const t = e.target;
  if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
});

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
  // Provenance moves with the spec: painting a lane beside a PINNED tile is exactly
  // what turns that pin stale, so the badge and the warning have to land in the same
  // stroke that caused it — not on the next reload.
  for (const [id, prov] of Object.entries(body.provs || {})) {
    const z = state.byId.get(id); if (z) z.prov = prov;
  }
  if (body.errors?.length) alert(body.errors.join('\n'));
  renderJournal(body.journal);
  draw();
  refreshLint();
  if (state.selected && ids.includes(state.selected)) select(state.selected);
}

// ── Moving a building ───────────────────────────────────────────────────────
// Two clicks and a review. Pick the building up, drop it on a cell, read what the
// write would be, confirm. The review is not decoration: a move rewrites the two
// cells, the interior's anchor, the front door and every row that named the old
// facade — a dozen files for a small building and eighty for the Yards tenement —
// and the list comes from the SAME call that performs it, so it cannot describe
// something other than what lands.
function disarmMove() {
  if (!state.move.arm && !state.move.plan) return;
  state.move = { arm: null, hover: null, plan: null };
  $('#movewho').textContent = 'Click a building to pick it up.';
  $('#m-cancel').disabled = true;
  draw();
}

async function armMove(id) {
  const { ok, body } = await api(`/api/move-arm/${encodeURIComponent(id)}`);
  if (!ok) { $('#status').textContent = body.error || 'not a building'; return; }
  state.move = {
    arm: { ...body, built: new Set(body.built), occupied: new Set(body.occupied) },
    hover: null, plan: null,
  };
  $('#movewho').innerHTML = `Holding <b>${esc(body.name || id)}</b><br>
    <span class="muted">door faces ${esc(body.entrance || '—')} · ${body.interior} interior tile(s)</span>`;
  $('#m-cancel').disabled = false;
  $('#status').textContent = `Holding ${body.name || id}. Click where it should stand.`;
  draw();
}

async function moveClick(z) {
  if (!state.move.arm) return armMove(z.id);
  if (z.id === state.move.arm.facade) return disarmMove();
  const { body } = await api('/api/move-plan', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ facadeId: state.move.arm.facade, toX: z.grid_x, toY: z.grid_y }),
  });
  state.move.plan = { ...body, toX: z.grid_x, toY: z.grid_y, donorId: body.donor?.id ?? null };
  state.selected = null;
  renderMovePlan();
}

function renderMovePlan() {
  const p = state.move.plan;
  if (!p) return;
  const arm = state.move.arm;
  const donorOpts = (p.donorOptions || []).map(d =>
    `<option value="${esc(d.id)}"${d.id === p.donorId ? ' selected' : ''}>${esc(d.name || d.id)}${d.terrain ? ` · ${esc(d.terrain)}` : ''}</option>`).join('');

  $('#inspector').innerHTML = `
    <div class="row" style="justify-content:space-between">
      <b>${esc(arm?.name || 'building')}</b><span class="pill">move</span>
    </div>
    <div class="help">→ ${p.toX}, ${p.toY} · door stays ${esc(arm?.entrance || '—')}</div>
    ${p.errors.length
      ? `<div id="errs">${p.errors.map(esc).join('\n\n')}</div>`
      : `<div class="warn">${p.warnings.map(esc).join('\n') || ''}</div>`}
    ${p.errors.length ? '' : `
      <div class="grp"><div class="t">The hole heals to</div>
        <select id="mv-donor">${donorOpts}</select>
        <div class="help">The cell it leaves has to be something. It copies a neighbour
          rather than inventing a name and a description — a building in the grasslands
          leaves Grasslands behind, one on Ironside Street leaves Ironside Street.</div>
      </div>
      <div class="grp"><div class="t">Would write ${p.files.length} file(s)</div>
        <div class="files">${p.files.map(esc).join('<br>')}</div>
      </div>
      <div class="row" style="margin-top:12px">
        <button id="mv-go">Move it</button><button id="mv-no">Cancel</button>
      </div>`}
    ${p.errors.length ? '<div class="row" style="margin-top:12px"><button id="mv-no">Cancel</button></div>' : ''}`;

  const no = $('#mv-no');
  if (no) no.onclick = () => { disarmMove(); showMapProps(); };
  const donor = $('#mv-donor');
  // Re-plan rather than patch: the donor changes what the backfill row says, and the
  // file list has to be the one the commit would produce.
  if (donor) donor.onchange = async () => {
    const { body } = await api('/api/move-plan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ facadeId: arm.facade, toX: p.toX, toY: p.toY, donorId: donor.value }),
    });
    state.move.plan = { ...body, toX: p.toX, toY: p.toY, donorId: donor.value };
    renderMovePlan();
  };
  const go = $('#mv-go');
  if (go) go.onclick = commitMove;
}

async function commitMove() {
  const p = state.move.plan, arm = state.move.arm;
  const { ok, body } = await api('/api/move', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ facadeId: arm.facade, toX: p.toX, toY: p.toY, donorId: p.donorId }),
  });
  if (!ok) { $('#errs').textContent = (body.errors || [body.error]).join('\n'); return; }
  const landed = body.facadeId;
  renderJournal(body.journal);
  disarmMove();
  // The whole map is re-read rather than patched, exactly as an undo does: a move
  // changes what the neighbours auto-tile into and what the building's rooftop is
  // derived from, and derive is whole-map by contract.
  await reloadOpenMap();
  setTool('select');
  await select(landed);
  $('#status').textContent = `Moved · ${body.files.length} file(s) rewritten. Ctrl+Z takes it back.`;
  refreshLint();
}

// ── Turning a building ──────────────────────────────────────────────────────
// The door is the reason this exists, so the control is the four door SIDES rather
// than a pair of ±90° arrows. Measured on the shipped world: 30 of the 62 buildings
// have exactly ONE alternative side their door can open onto, and for some of those
// it is the opposite one — reachable only as a half turn. A ↺/↻ pair would make that
// building's only legal door two clicks through an illegal intermediate, which the
// tool would have to refuse.
async function renderTurnControls(id) {
  const box = $('#turnbox');
  if (!box) return;
  const { ok, body } = await api(`/api/turn-options/${encodeURIComponent(id)}`);
  if (!ok) { box.innerHTML = `<div class="help">${esc(body.error || 'cannot turn this')}</div>`; return; }
  const sides = [{ k: 0, to: body.entrance, ok: false, why: 'the door is already on this side' }, ...body.sides]
    .sort((a, b) => ['north', 'east', 'south', 'west'].indexOf(a.to) - ['north', 'east', 'south', 'west'].indexOf(b.to));
  box.innerHTML = `<label>Door side</label>
    <div class="turn">${sides.map(s => `
      <button data-k="${s.k}" ${s.ok ? '' : 'disabled'} class="${s.k === 0 ? 'now' : ''}"
        title="${esc(s.why || `turn the whole building so the door faces ${s.to}`)}">${esc(s.to || '—')}</button>`).join('')}</div>
    <div class="help">Turns the whole building: the door, the facade's exits, the
      interior grid, every exit inside it, the front door and any camera. Prose is not
      turned — a room that says "the north wall" still says it.</div>`;
  box.onclick = (e) => {
    const b = e.target.closest('button[data-k]');
    if (b && !b.disabled) turnBuilding(id, Number(b.dataset.k));
  };
}

async function turnBuilding(id, k) {
  const { ok, body } = await api('/api/rotate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ facadeId: id, k }),
  });
  if (!ok) { $('#errs').textContent = (body.errors || [body.error]).join('\n'); return; }
  renderJournal(body.journal);
  await reloadOpenMap();
  await select(id);
  $('#status').textContent = `Door ${body.from} → ${body.to} · ${body.files.length} file(s) rewritten`
    + (body.warnings?.length ? ` · ${body.warnings.length} thing(s) to read` : '');
  if (body.warnings?.length) alert(body.warnings.join('\n'));
  refreshLint();
}

// ── Inspector: generated from the field catalog ─────────────────────────────
async function loadCatalog() { state.catalog = (await api('/api/catalog')).body; }

let editing = null;   // the authored row, as loaded
let editingExits = [];   // …and its derived exits, which the row itself never carries

async function select(id) {
  state.selected = id;
  state.mapView = null;
  draw();
  const { body } = await api(`/api/zone/${encodeURIComponent(id)}`);
  editing = body.zone;
  // Derived, and fetched WITH the tile rather than held for the whole map: see
  // exitsOf() in serve.mjs for why the graph does not ride along in /api/world.
  editingExits = body.exits || [];
  // prov comes from the server with the tile, not from the map view: `editing` is the
  // AUTHORED row and carries no derived anything, and the inspector must be able to
  // explain a tile whether or not it is on the map currently drawn.
  renderInspector(body.spec, body.prov);
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
  const seams = mapSeams();

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

    ${seams.length
      ? seamsHtml(seams, `Leads off this map (${seams.length})`)
      : `<div class="grp"><div class="t">Leads off this map</div>
         <div class="help">No tile on this map crosses to another one. Players reach it some
         other way — boarding, a dream, a script — or they cannot reach it at all.</div></div>`}

    <div class="help" style="margin-top:12px">Writes <code>content/maps/${esc(m.id)}.json</code>
      and any tile it has to bring back into line.</div>
    <div class="actions">
      <div class="row"><button id="m-save">Save map</button><button id="m-revert">Revert</button></div>
      <div id="errs"></div><div id="note" class="help"></div>
    </div>`;

  $('#m-revert').onclick = showMapProps;
  $('#m-save').onclick = saveMapProps;
  wireSeams(seams);
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
  renderJournal(body.journal);
  renderMapInspector();
  // No partial-success branch to render any more: the server validates and
  // conflict-checks every file the push would touch BEFORE writing any of them, so
  // a save that had objections came back 422 above with nothing written. "Saved."
  // over a half-applied anchor push was the bug that branch used to describe.
  $('#note').textContent = body.pushed?.length
    ? `Saved · anchor pushed to ${body.pushed.length} tile(s).` : 'Saved.';
  await loadMaps({ keep: true });   // the list shows resolved names; this one may have changed
  refreshLint();
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// The seams, in words — the same list the canvas draws, for when you want to read
// where a map goes rather than hunt for the marked tiles.
// One row per way out (or one way in), clickable through to the far end.
//
// `homeMap` is the map the ASKING tile is on, and it exists so a tile's own exit
// list does not label all four of its neighbours with the map they obviously
// share — on the world map that is the same twelve characters under every row,
// which is how a meta line stops being read at all. The map-level index passes
// none, so a seam there still names where it lands, which is its whole point.
//
// AN INBOUND ROW GETS NO ARROW OF ITS OWN. Its direction belongs to the tile at
// the other end — the same reasoning the canvas hollow-dot key states — so
// drawing `↑` on a row you cannot walk would be the tool telling you to type a
// step that does not exist. `↩` says it arrives here; the meta line says which
// step the far tile takes, in words. (Not `←`: that is west, one row up.)
//
// A DIRECTION WITH NO GLYPH DOES NOT GO IN THE ARROW CELL. That cell is one
// character wide by design and a word does not fit it — the diagonals proved
// that by printing over the destination name. Every direction the world has is
// in DIR_ARROW now, so this is the case that should never fire; when it does,
// the word goes to the meta line where there is room for it and the cell gets a
// dot. A direction authored tomorrow is then merely unglyphed, not unreadable.
function seamsHtml(seams, title, homeMap) {
  if (!seams.length) return '';
  return `<div class="grp"><div class="t">${esc(title)}</div>${seams.map((s, i) => {
    const inbound = s.way === 'in';
    const glyph = inbound ? '↩' : DIR_ARROW[s.dir];
    const where = s.far.map == null ? 'on no map'
      : (homeMap && s.far.map === homeMap) ? '' : esc(s.far.mapName || s.far.map);
    const note = inbound ? `one-way in — their ${esc(s.dir)}` : s.twoWay ? '' : 'one-way';
    const meta = [glyph ? '' : esc(s.dir), where, note].filter(Boolean).join(' · ');
    return `
    <button class="seam" data-seam="${i}"${s.far.map ? '' : ' disabled'}
      title="${esc(inbound ? `${s.far.name || s.far.zone} leads here` : `${s.dir} → ${s.far.name || s.far.zone}`)}">
      <span class="d">${glyph || '·'}</span>
      <span class="w">${esc(s.far.name || s.far.zone)}</span>
      ${meta ? `<span class="m">${meta}</span>` : ''}
    </button>`;
  }).join('')}</div>`;
}
function wireSeams(seams) {
  for (const b of document.querySelectorAll('#inspector button.seam')) {
    b.onclick = () => jumpTo(seams[Number(b.dataset.seam)].far);
  }
}
// Every seam on the open map, sorted by where it lands. On map_world this is the
// index of all 62 buildings you can walk into.
function mapSeams() {
  const out = [];
  for (const seams of Object.values(state.portals)) out.push(...seams);
  return out.sort((a, b) => String(a.far.mapName || '').localeCompare(String(b.far.mapName || ''))
    || String(a.far.name || '').localeCompare(String(b.far.name || '')));
}

function fieldHtml(key, def, value, kind) {
  const id = `f-${kind}-${key}`;
  const help = def.help ? `<div class="help">${esc(def.help)}</div>` : '';
  let input;
  switch (def.shape) {
    case 'flag':
      return `<div class="flagrow"><input type="checkbox" id="${id}" data-k="${esc(key)}" data-kind="${kind}" data-shape="flag" ${value ? 'checked' : ''}>
              <span class="k" title="${esc(def.help || '')}">${esc(def.label || key)}</span></div>`;
    // TRI-STATE: a three-way select, because a checkbox cannot say "explicitly no".
    // Blank = inherit the terrain preset; the other two are deliberate overrides.
    // `def.preset` names where the inherited value comes from, so the row reads as
    // an override of something rather than as a bare boolean.
    case 'tristate': {
      const sel = value === undefined || value === null ? '' : (value ? 'true' : 'false');
      const from = def.presetFrom ? ` (from ${esc(def.presetFrom)})` : '';
      const opts = [['', `— inherit${from}`], ['true', 'Yes (override)'], ['false', 'No (override)']]
        .map(([v, l]) => `<option value="${v}"${sel === v ? ' selected' : ''}>${l}</option>`).join('');
      input = `<select id="${id}" data-k="${esc(key)}" data-kind="${kind}" data-shape="tristate">${opts}</select>`;
      break;
    }
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
  return `<label>${esc(label)}${why ? ' <span class="pill">map</span>' : ''}</label>
          <input type="text" value="${esc(value ?? '')}" disabled>
          ${why ? `<div class="help">${why}</div>` : ''}`;
}

// Stated in the corner instead of typed in the form — see the note in the loop below.
// Named from the catalog's own keys, so a coordinate the catalog renames stops being
// suppressed here rather than quietly staying hidden.
const COORDS = new Set(['grid_x', 'grid_y', 'grid_z']);

// The tile's side of the district seam. The tile view still ANSWERS "which
// neighbourhood is this?" — it just doesn't let you type the answer. Clicking it
// crosses to the district view with that district selected and the camera exactly
// where it was, which is the whole of what "seamless" has to mean here.
function districtLine() {
  const d = state.byId.get(editing?.id)?.district;
  if (!d) return '';
  const known = d.id && state.districtById.get(d.id);
  if (!d.id) {
    return `<div class="help">district: <b>none</b> — this tile is one of
      ${state.districtStats?.unassigned ?? '?'} that claim nothing, so it reads as the
      engine's default neighbourhood. <button id="d-jump" data-d="">Paint one →</button></div>`;
  }
  if (!known) {
    return `<div class="help stale">district: <b>${esc(d.id)}</b> — no district by that
      name exists, so the tile falls through to the default.
      <button id="d-jump" data-d="${esc(d.id)}">Show →</button></div>`;
  }
  const why = d.source === 'authored' ? 'painted onto this tile'
    : `inherited from the id prefix — rename the zone and it changes`;
  return `<div class="help">district: <b>${esc(known.name || d.id)}</b> — ${esc(why)}
    <button id="d-jump" data-d="${esc(d.id)}">Open →</button></div>`;
}

// A group's heading is worth reading in the order it is useful, and that order is not
// alphabetical: a tile that says nothing about aircraft should not put Zone: Aircraft
// above Zone: Identity for the sake of the letter A. Groups holding an answer keep
// the catalog's own order and come first; the rest fall to the bottom, shut, counted.
function groupsHtml(groups) {
  const live = [], empty = [];
  for (const entry of groups) (entry[1].set.length ? live : empty).push(entry);
  const rows = ([g, b]) => {
    const more = b.unset.length
      ? `<details class="more" data-keys="${esc(JSON.stringify(b.unset))}">
           <summary>+ ${b.unset.length} not set</summary><div class="lazy"></div></details>`
      : '';
    return b.set.join('') + more;
  };
  return live.map(e => `<div class="grp"><div class="t">${esc(e[0])}</div>${rows(e)}</div>`).join('')
    + empty.map(([g, b]) => `<details class="grp" data-keys="${esc(JSON.stringify(b.unset))}">
         <summary class="t">${esc(g)} <span class="pill">${b.unset.length}</span></summary>
         <div class="lazy"></div></details>`).join('');
}

// The fields are built the first time a section opens and kept after that, so a
// reopened section does not rebuild a 5,841-option select — and a value typed into
// one survives being folded away, because folding is `display:none` and not a
// re-render. They are ordinary rows with ordinary `data-k`, so the moment they exist
// collect() treats them exactly like a carried flag: filled in, it becomes one;
// left blank, it deletes nothing because there is nothing there to delete.
function wireLazyGroups() {
  for (const d of document.querySelectorAll('#inspector details[data-keys]')) {
    d.addEventListener('toggle', () => {
      const box = d.querySelector('.lazy');
      if (!d.open || !box || box.dataset.built) return;
      box.dataset.built = '1';
      const flags = state.catalog.flags;
      box.innerHTML = JSON.parse(d.dataset.keys)
        .map(k => `<div class="unset">${fieldHtml(k, flags[k], undefined, 'flag')}</div>`).join('');
      // A parent can live inside a group that was only just built, so re-run here as
      // well as after the first render — otherwise ticking a parent you had to open a
      // fold to reach would reveal nothing.
      wireDependents();
    });
  }
}

// Fields whose `requires` parent is not set on this tile — held back by the flag loop
// and attached here, under whichever checkbox controls them.
let pendingDeps = [];

// Put each held-back field directly beneath its parent's checkbox, hidden, and tie its
// visibility to that checkbox. No re-render: the inspector is a live form and rebuilding
// it on a tick would throw away every other edit in progress.
//
// A hidden row keeps its `data-k`, which is deliberate — collect() reads it, finds it
// blank, and deletes nothing. Untick Storefront after typing a price and the price goes
// with it, which is the correct outcome: the engine could not have read it anyway.
function wireDependents() {
  for (const dep of pendingDeps) {
    if (dep.attached) continue;
    const parentEl = document.querySelector(`#inspector [data-k="${CSS.escape(dep.parent)}"]`);
    if (!parentEl) continue;                     // parent not on the form yet — try again later
    const row = parentEl.closest('.flagrow') || parentEl.closest('.f') || parentEl;
    const host = document.createElement('div');
    host.className = 'unset dep';
    host.innerHTML = fieldHtml(dep.key, dep.def, undefined, 'flag');
    row.after(host);
    dep.attached = true;
    const sync = () => { host.style.display = parentEl.checked ? '' : 'none'; };
    parentEl.addEventListener('change', sync);
    sync();
  }
}

function renderInspector(spec, prov) {
  if (!editing) return;
  const cols = state.catalog.columns, flags = state.catalog.flags;
  // Each group holds what this tile SAYS and what it could say: `set` is rendered,
  // `unset` is a list of keys rendered on demand. See the note above the flag loop.
  const groups = new Map();
  const bucket = (g) => {
    if (!groups.has(g)) groups.set(g, { set: [], unset: [] });
    return groups.get(g);
  };
  const push = (g, html) => bucket(g).set.push(html);

  const ordered = (o) => Object.entries(o).sort((a, b) =>
    String(a[1].group || '').localeCompare(String(b[1].group || '')) || (a[1].order ?? 99) - (b[1].order ?? 99));

  // `parent_zone` is the map's anchor once a tile is on a map; only a tile on NO
  // map still owns it (there it means the dev panel's room grouping, which is a
  // different thing and stays editable).
  const onMap = !!editing.map_id;
  const mapAnchor = state.maps.get(editing.map_id)?.parent_zone_id ?? null;
  for (const [key, def] of ordered(cols)) {
    // WHERE A TILE IS, IS NOT A FIELD. The coordinates are stated in the corner and
    // shown by the canvas the tile is sitting on, so a second copy as three number
    // boxes is the same fact typed twice — and typed is the problem: the spinners
    // invite a nudge, and nudging one moves the tile with none of what moving a tile
    // needs (the neighbours it auto-tiles with, the cell it might land on top of,
    // the seams that point at it). Moving a tile is a structural operation the
    // Studio does not do yet; it should not be reachable by an arrow key either.
    if (COORDS.has(key)) continue;
    // Which map a tile is on is the same fact as where it is: a dropdown would drop
    // the tile onto another map's grid with none of what moving a tile needs (the
    // cell it might land on top of, the neighbours it leaves, the seams pointing at
    // it). Shown, not typed — resolved to the map's name, which is what the list says.
    if (key === 'map_id') {
      push(def.group || 'Zone',
        lockedFieldHtml(def.label || key, state.maps.get(editing.map_id)?.name || editing.map_id));
      continue;
    }
    if (key === 'parent_zone' && onMap) {
      push(def.group || 'Zone', lockedFieldHtml(def.label || key, editing[key],
        `Owned by map <code>${esc(editing.map_id)}</code> — every tile on it shares one anchor. Change it in the map's properties.`));
      continue;
    }
    push(def.group || 'Zone', fieldHtml(key, def, editing[key], 'col'));
  }
  // EVERY CATALOGUED FLAG, IN ITS GROUP — the ones this tile carries rendered, the
  // rest offered under the same heading.
  //
  // This used to be carried-flags-only plus an alphabetical "Add a flag" dropdown,
  // on the reasoning that 104 checkboxes is a wall. The wall was never the count: it
  // was 104 rows FLAT. The catalog already sorts them into ten groups and no group is
  // bigger than Structure's 25, so grouped they fit — and half of them (Flight 20,
  // Echelon 11, Ascendant 6, Aircraft 3) are situational enough to stay shut on
  // almost every tile you will ever select.
  //
  // What the dropdown cost is the case that found it: Map Icon is a field you go
  // looking for BY NAME, and a field you have to know the name of to discover is a
  // field that does not exist as far as the tool is concerned. Note also why "show
  // the flags tiles like this one usually carry" is not the fix — `icon` is on 18
  // tiles out of 5,841, so any frequency rule buries exactly the field that prompted
  // this. Rare is not the same as irrelevant.
  //
  // Unset rows are built ON OPEN, never up front. `world_exit_zone` is a ref to
  // `zones` and that select is 5,841 options; paying for it on every tile click, on
  // a field nobody asked for, is the thing that would make this change a regression.
  // Until a group is opened its fields carry no `data-k`, so collect() cannot see
  // them and an unopened group can neither add nor remove anything.
  const carried = Object.keys(editing.flags || {}).filter(k => flags[k]);
  for (const key of carried) {
    // WHAT A BRUSH PAINTS IS NOT A FIELD — `district` and `terrain` both.
    //
    // `district` was a free-text box holding a key that had to match a district
    // exactly, with nothing checking it did: a typo read as "unclassified" and
    // looked identical to a blank. `terrain` was a dropdown that changed the
    // tile's gameplay — swimmability, GPS routing, pacing, the minimap class —
    // through the one seam in the tool with no swatch to show you what you just
    // did. It was the reported bug: on the 1,374 tiles whose own `bg_color`
    // shadowed the palette it repainted nothing at all, and it carried none of
    // the brush's guards (a building is not ground; painting one strips its map
    // code, which /api/paint refuses and this did not).
    //
    // Both are painted now, from a palette of the values that exist, and the
    // tile STATES what it landed in — the `painted:` line above for terrain, the
    // district line below with a way over to it. Same rule as the coordinates:
    // shown, not typed.
    if (key === 'district' || key === 'terrain') continue;
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
  // EVERY way out, not just the seams. This used to list `state.portals` — the
  // doors between maps — which meant the one tile whose exits you were looking at
  // was the one place the tool would not tell you where north went. The portal
  // rows are still all here (they are edges like any other), so nothing that used
  // to be listed has gone; what joins them is the other 21,000 steps.
  const seams = editingExits;

  // PAINTED IS NOT OFFERED EITHER. Skipping `district`/`terrain` in the loop above
  // only hid the row on a tile that already carried one; a tile with no terrain would
  // still have been offered "Terrain" here and handed back the box the loop just took
  // away — and on an unpainted tile that is the more destructive of the two, since it
  // is the building footprints and interiors that have no terrain.
  //
  // `world_exit_zone` on a mapped interior is the map's anchor, not this tile's
  // business. Carried, it shows locked (above); unset, it is not offered at all —
  // an editor should not hand you a field whose only legal value belongs to
  // somebody else.
  // A DEPENDENT FIELD IS NOT OFFERED UNTIL ITS PARENT IS SET. `shop_price` prices a
  // unit nobody can buy unless `is_storefront` is on the same tile, and the catalog
  // now says so (`requires`). Seven fields carry one, and on an ordinary tile all
  // seven were sitting in the "not set" list being irrelevant together.
  //
  // Unlike hiding a whole GROUP — which needs a guess about what KIND of place this
  // tile is, and which is why that idea was dropped — this asks one exact question
  // about the tile in front of you: is the parent key set, yes or no. It cannot be
  // wrong about a tile it is looking at.
  //
  // They are not merely hidden: wireDependents() puts each one directly under its
  // parent's checkbox and reveals it the moment you tick it, so the three shop terms
  // appear where you just said "this is a storefront". Hiding a field with no way to
  // reach it would be the same sin as the old alphabetical "Add a flag" dropdown.
  pendingDeps = [];
  for (const [key, def] of ordered(flags)) {
    if (carried.includes(key) || key === 'district' || key === 'terrain') continue;
    if (key === 'world_exit_zone' && onMap && !editing.flags?.facade && mapAnchor != null) continue;
    if (def.requires && !editing.flags?.[def.requires]) {
      pendingDeps.push({ key, def, parent: def.requires });
      continue;
    }
    bucket(def.group || 'Flags').unset.push(key);
  }

  // The coordinates left the form, so the group they lived in says where they went.
  // The group NAME comes from the catalog entry rather than being typed here, so it
  // follows a re-grouping instead of stranding this line under a heading that moved.
  if (cols.grid_x) {
    push(cols.grid_x.group || 'Zone', `<div class="help">Coordinates
      <b>${esc(editing.grid_x)},${esc(editing.grid_y)},${esc(editing.grid_z ?? 0)}</b>
      (x, y, floor) — in the corner above, and on the canvas. A tile's position is not
      a number box: a nudge would move it with none of what moving a tile needs.</div>`);
    // The structural operations live where the coordinates would have been, because
    // that is the question this group is about. Only a facade has them — a building
    // is the only thing here that can be picked up or turned, and it is picked up
    // and turned WHOLE, interior and all.
    if (editing.flags?.facade) {
      push(cols.grid_x.group || 'Zone', `<div id="turnbox"><div class="help">…</div></div>
        <div class="help" style="margin-top:6px">Pick this building up with the
        <b>Move</b> tool to stand it somewhere else. Its door does not move with it —
        turn it here first if the new spot needs a different side.</div>`);
    }
  }

  $('#inspector').innerHTML = `
    <div class="row" style="justify-content:space-between">
      <b>${esc(editing.name || editing.id)}</b>
      <span class="pill" title="x, y, floor">${esc(editing.grid_x)},${esc(editing.grid_y)},${esc(editing.grid_z ?? 0)}</span>
    </div>
    <div class="help">${esc(editing.id)}</div>
    ${paintedLine(spec)}
    ${featureLine(prov)}
    ${districtLine()}
    ${seams.length ? seamsHtml(seams, `Leads to (${seams.length})`, editing.map_id)
      : `<div class="grp"><div class="t">Leads to</div>
         <div class="help" style="color:var(--warn)">Nothing. No step out of this tile and
         none into it — whatever is here, no player reaches it on foot.</div></div>`}
    ${groupsHtml(groups)}
    ${uncatalogued.length ? `<div class="grp"><div class="t" style="color:var(--warn)">Not in the catalog</div>
      <div class="help">${uncatalogued.map(esc).join(', ')} — these fail content:lint. Catalogue them or remove them.</div></div>` : ''}
    <div class="actions">
      <div class="row"><button id="save">Save file</button><button id="revert">Revert</button></div>
      <div id="errs"></div>
    </div>`;

  wireLazyGroups();
  wireDependents();
  $('#revert').onclick = () => select(editing.id);
  $('#save').onclick = save;
  if (editing.flags?.facade) renderTurnControls(editing.id);
  const jump = $('#d-jump');
  if (jump) jump.onclick = () => { setView('districts'); selectDistrict(jump.dataset.d || ''); };
  wireSeams(seams);
}

function collect() {
  const row = { ...editing, flags: { ...(editing.flags || {}) } };
  for (const el of document.querySelectorAll('#inspector [data-k]')) {
    const k = el.dataset.k, kind = el.dataset.kind, shape = el.dataset.shape;
    let v;
    if (shape === 'flag') v = el.checked ? true : undefined;
    // '' = inherit, and undefined is what deletes the key below. The explicit
    // 'false' MUST survive as a boolean — it is the whole point of the shape.
    else if (shape === 'tristate') v = el.value === '' ? undefined : el.value === 'true';
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
  if (z) { z.spec = body.spec; z.prov = body.prov; z.name = row.name; }
  renderJournal(body.journal);
  draw();
  await select(row.id);
  refreshLint();
}

// ── Lint: the authored half, live (§8.4) ────────────────────────────────────
// COALESCED, because a lint is a whole-tree read (~2s) and this server is one
// thread. Every mutation asks for one, so a run of strokes used to queue a lint
// per stroke and each of them sat in front of the NEXT paint request — the tool
// felt slower the faster you worked. One trailing run after the writes stop says
// exactly the same thing, and the badge goes stale-marked meanwhile so a pause
// mid-edit is never read as "lint clean".
let lintTimer = null, lintRunning = false, lintAgain = false;
function refreshLint() {
  const el = $('#lint');
  if (el && !el.dataset.stale) { el.dataset.stale = '1'; el.style.opacity = '0.55'; }
  if (lintRunning) { lintAgain = true; return; }
  clearTimeout(lintTimer);
  lintTimer = setTimeout(runLint, 500);
}

async function runLint() {
  lintRunning = true;
  try { await lintNow(); } finally { lintRunning = false; }
  if (lintAgain) { lintAgain = false; refreshLint(); }
}

async function lintNow() {
  const { ok, body } = await api('/api/lint');
  const el = $('#lint');
  if (el) { delete el.dataset.stale; el.style.opacity = ''; }
  // A lint that crashed is not a lint that passed. Reporting `{error}` as zero
  // errors would render the one badge this tool stakes its promise on as
  // "lint clean" at the exact moment nothing was checked.
  if (!ok) {
    $('#lint').innerHTML = `<b style="color:var(--bad)">lint did not run</b> — ${esc(body.error || 'server error')}`;
    return;
  }
  const e = body.errors?.length || 0, w = body.warnings?.length || 0;
  $('#lint').innerHTML = e
    ? `<b style="color:var(--bad)">${e} lint error(s)</b> — ${esc(body.errors[0])}`
    : `lint clean · <b>${w}</b> warning(s) <span class="muted">· derived-half rules need an import</span>`;
}

// ── Theme ────────────────────────────────────────────────────────────────────
// The dev panel's themes, not a second set: every id here has its palette in
// client/shared/themes.css, which this page <link>s. The Studio is served from
// its own port, so it cannot READ the dev panel's stored choice — localStorage
// does not cross an origin — but it stores under the same key, so a Studio ever
// served from the game server would find the panel's answer already there.
// Until then the panel HANDS the theme over in `?theme=`, which is why the URL
// beats the stored value: the launching panel is the more recent answer, and a
// Studio opened by hand has no param and keeps its own.
const THEME_KEY = 'architect_settings';
const STUDIO_THEMES = [
  ['Dark', [
    ['dark','Void'],['eclipse','Eclipse'],['iron','Iron'],['contrast','Terminal'],
    ['phosphor','Phosphor Green'],['synthwave','Synthwave'],['bloodmoon','Blood Moon'],['slate','Slate'],
    ['aurora','Aurora'],['neon','Neon'],['cathode','Cathode'],['grove','Grove'],
    ['tide','Tide'],['dusk','Dusk'],['solarflare','Solar Flare'],['abyss','Abyss'],
    ['mulberry','Mulberry'],['umber','Umber'],
  ]],
  ['Light', [
    ['light','Parchment'],['inkwell','Inkwell'],['studio','Studio'],['arctic','Arctic'],
    ['solar','Solar'],['mint','Mint'],['lavender','Lavender'],['fog','Fog'],
    ['latte','Latte'],['rose','Rosewater'],['papertape','Papertape'],['bubblegum','Bubblegum'],
    ['meadow','Meadow'],['clay','Clay'],['highbeam','Highbeam'],
  ]],
];

function applyTheme(id) {
  document.documentElement.setAttribute('data-theme', id || 'dark');
  // chrome() caches, and the canvas is drawn from that cache — a theme change
  // that did not clear it would repaint the map in the OLD palette's ink.
  CSSVAR.clear();
  draw();
}

// Merge, never replace: the key is the dev panel's whole settings blob, and a
// Studio served from the game server one day would be writing over its siblings.
function saveTheme(id) {
  try {
    const s = JSON.parse(localStorage.getItem(THEME_KEY) || '{}');
    s.theme = id;
    localStorage.setItem(THEME_KEY, JSON.stringify(s));
  } catch {}
}

function initTheme() {
  const sel = $('#theme');
  if (!sel) return;
  let saved = 'dark';
  try { saved = JSON.parse(localStorage.getItem(THEME_KEY) || '{}').theme || 'dark'; } catch {}
  const handed = new URLSearchParams(location.search).get('theme');
  if (handed) saved = handed;
  sel.innerHTML = STUDIO_THEMES.map(([label, items]) =>
    `<optgroup label="${label}">${items.map(([v, l]) =>
      `<option value="${v}"${v === saved ? ' selected' : ''}>${l}</option>`).join('')}</optgroup>`).join('');
  // A custom dev-panel theme has no palette block here; fall back to Void rather
  // than leaving an unstyled data-theme on the element.
  if (!sel.value) sel.value = 'dark';
  applyTheme(sel.value);
  // Remember what was handed over, so a RELOAD (which drops the query string)
  // doesn't snap back to Void — and drop the param from the address bar, since a
  // stale `?theme=` in a bookmark would keep overriding the picker forever.
  if (handed) {
    saveTheme(sel.value);
    try { history.replaceState(null, '', location.pathname); } catch {}
  }
  sel.addEventListener('change', () => {
    applyTheme(sel.value);
    saveTheme(sel.value);
  });
}

window.addEventListener('resize', resize);
await loadCatalog();
resize();
initTheme();
await loadMaps();
await loadDistrictList();
// The log is the SERVER'S — a reloaded tab can still take back what the session
// wrote, because the files it would be reverting are still there.
await refreshJournal();
