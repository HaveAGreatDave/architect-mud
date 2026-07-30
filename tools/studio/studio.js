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
  // ── The district view ──────────────────────────────────────────────────────
  // A SECOND VIEW OF THE SAME MAP, not a second screen: the canvas, the camera,
  // the floor and the open map all survive the switch, and only three things
  // change — what the tiles are coloured by, what the sidebar lists, and what the
  // brush paints. A district is a property spread across thousands of tiles, so
  // the only honest way to edit it is on the map it covers.
  view: 'tiles',      // 'tiles' | 'districts'
  districts: [],      // the list, with tile counts, from /api/districts
  districtById: new Map(),
  district: null,     // the selected district id, or '' for the eraser
  districtStats: null,
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
  const { body } = await api(`/api/world?map=${encodeURIComponent(id)}`);
  state.zones = body.zones;
  state.byId = new Map(body.zones.map(z => [z.id, z]));
  state.byCell = new Map(body.zones.map(z => [`${z.grid_x},${z.grid_y},${z.grid_z ?? 0}`, z]));
  state.portals = body.portals || {};
  state.floors = [...new Set(body.zones.map(z => z.grid_z ?? 0))].sort((a, b) => b - a);
  if (!state.floors.length) state.floors = [0];
  state.z = state.floors.includes(0) ? 0 : state.floors[0];
  renderFloors();
  if (restore) restoreView(restore);
  else if (focus) focusZone(focus);
  else { fit(); showMapProps(); }
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
    <div class="row" style="margin-top:12px"><button id="d-save">Save district</button><button id="d-revert">Revert</button></div>
    <div id="errs"></div><div id="note" class="help"></div>
    <div class="help" style="margin-top:8px">Writes <code>content/districts/${esc(d.id)}.json</code>.
      Colour shows on the tablet's regional map; terrain still paints the tile at normal zoom.</div>`;
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
  draw();
  refreshLint();
}

function setView(v) {
  state.view = v;
  $('#v-tiles').classList.toggle('on', v === 'tiles');
  $('#v-districts').classList.toggle('on', v === 'districts');
  $('#pane-terrain').style.display = v === 'tiles' ? '' : 'none';
  $('#pane-districts').style.display = v === 'districts' ? '' : 'none';
  // The camera, the floor and the open map are deliberately untouched — switching
  // view is a change of question ("what is here?" / "whose is this?"), not a change
  // of place. Only the brush has to be handed over, since the two views paint
  // different fields with the same drag.
  setTool('select');
  if (v === 'districts') { if (state.district === null) state.district = ''; selectDistrict(state.district); }
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
  wrap.innerHTML = state.floors.map(z =>
    `<button data-z="${z}" class="${z === state.z ? 'on' : ''}">${z > 0 ? `+${z}` : z}</button>`).join('');
  wrap.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    setFloor(Number(b.dataset.z));
  };
}
function setFloor(z) {
  if (z === state.z) return;
  state.z = z;
  renderFloors();
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
// The Neon Vig, so the arrow pointed at the casino while meaning "step east into
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
function featureLine(p) {
  if (!p?.name) return '<div class="help">art: none — this tile draws only its ground</div>';
  const stale = p.stale;
  return `<div class="help">art: <b>${esc(p.name)}</b> — ${esc(PROV_WORDS[p.source] || p.source)}</div>`
    + (stale ? `<div class="help stale">⚠ this pin is stale: the lanes around it now imply
         <b>${esc(p.implied)}</b>. Clear Map Icon to follow the map, or leave it to keep this.</div>` : '');
}

function drawPortal(x, y, c, seams, authoredDoor) {
  const leaves = seams.find(s => s.way === 'out') || seams[0];
  ctx.strokeStyle = '#8ab4ff'; ctx.lineWidth = c >= 12 ? 2 : 1;
  ctx.strokeRect(x + 1, y + 1, c - 3, c - 3);
  if (c < 9) return;
  // The authored door already barred this tile — don't bar a second edge.
  if (authoredDoor) return;
  // An inbound-only seam's direction belongs to the tile at the OTHER end, so it
  // is not an edge of this one.
  if (leaves.way === 'out' && edgeBar(x, y, c, leaves.dir, '#8ab4ff')) return;
  const m = (c - 1) / 2, q = Math.max(2.5, c * 0.2);
  ctx.fillStyle = '#8ab4ff'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(x + m, y + m, q * 0.7, 0, 7);
  if (leaves.way === 'out') ctx.fill(); else ctx.stroke();
}

function draw() {
  ctx.fillStyle = '#0e0f12';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const c = state.cell;
  ctx.font = `${Math.max(6, Math.floor(c * 0.62))}px ui-monospace, monospace`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const z of state.zones) {
    if (!onFloor(z)) continue;
    const x = sx(z.grid_x), y = sy(z.grid_y);
    if (x + c < 0 || y + c < 0 || x > canvas.width || y > canvas.height) continue;
    const spec = z.spec || {};
    ctx.fillStyle = spec.fill || '#1a1c21';
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
    const authoredDoor = !!(spec.entrance && c >= 8 && edgeBar(x, y, c, spec.entrance, '#ffd479'));
    // The two layers that stand on the ground, in the same order the game stacks
    // them: the footprint SVG, then the code someone reads off it. Which of the two
    // a tile shows is the OVERLAY MODE, and the rule is the game's — minimap.js's
    // `symFor`, not a second one written here:
    //
    //   Labels REPLACES the graphic. A building's art and its navigable code are two
    //   ways of saying the same tile, so the game shows one or the other. Drawing
    //   both — which this did — is the one combination no screen in the game renders,
    //   and on a small cell the letters sit in the middle of the rooftop.
    //   A label of kind `art` is exempt in both directions: the sewer corridors'
    //   connectivity pieces are the TILE'S OWN DRAWING, like a road connector, so
    //   they survive every mode. That is the rule that stops half the sewers
    //   vanishing when someone switches buildings to letters.
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
    const lettersWin = state.overlay === 'labels' && lbl && lbl.kind !== 'art';
    if (spec.feature && !lettersWin) drawFeature(x, y, c, spec.feature, spec.text);
    if (lbl && (lettersWin || lbl.kind === 'art' || !spec.feature)) {
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
    const seams = state.portals[z.id];
    if (seams && c >= 5) drawPortal(x, y, c, seams, authoredDoor);
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
  const seam = z && seamLabel(state.portals[z.id]);
  // In the district view the readout answers that view's question: which district,
  // and whether the tile was painted into it or merely inherits it from its id.
  const SOURCE_WORDS = { authored: 'painted', prefix: 'by legacy id prefix', unknown: 'NO SUCH DISTRICT' };
  const dis = z && state.view === 'districts'
    ? (z.district?.id
        ? `${state.districtById.get(z.district.id)?.name || z.district.id} (${SOURCE_WORDS[z.district.source] || z.district.source})`
        : 'no district')
    : null;
  $('#status').textContent = z
    ? `${z.name || '(unnamed)'} · ${z.id} · ${z.grid_x},${z.grid_y} · ${dis || z.spec?.terrain || 'no terrain'}${seam ? ` · ${seam} — double-click to follow` : ''}`
    : '—';
  if (painting && z) { stroke.add(z.id); }
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
  for (const k of ['select', 'paint', 'pick']) $(`#t-${k}`).classList.toggle('on', k === t);
}
$('#m-props').onclick = showMapProps;
$('#t-select').onclick = () => setTool('select');
$('#t-paint').onclick = () => setTool('paint');
$('#t-pick').onclick = () => setTool('pick');
$('#t-clear').onclick = () => { state.terrain = null; setTool('paint'); paintSwatches(); };
function setOverlay(o) {
  state.overlay = o;
  $('#o-art').classList.toggle('on', o === 'icons');
  $('#o-labels').classList.toggle('on', o === 'labels');
  draw();
}
$('#v-tiles').onclick = () => setView('tiles');
$('#v-districts').onclick = () => setView('districts');
$('#o-art').onclick = () => setOverlay('icons');
$('#o-labels').onclick = () => setOverlay('labels');
$('#zoom-in').onclick = () => { state.cell = Math.min(40, state.cell + 2); draw(); };
$('#zoom-out').onclick = () => { state.cell = Math.max(2, state.cell - 2); draw(); };
$('#fit').onclick = fit;

// ── Traversal ───────────────────────────────────────────────────────────────
const DIR_ARROW = { north: '↑', south: '↓', east: '→', west: '←', up: '↑', down: '↓', in: '↘', out: '↖' };
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
  select(id);
}

function restoreView(v) {
  state.z = v.z; state.cell = v.cell; state.ox = v.ox; state.oy = v.oy;
  renderFloors();
  if (v.zone && state.byId.has(v.zone)) select(v.zone); else { state.selected = null; draw(); showMapProps(); }
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

    <div class="row" style="margin-top:12px"><button id="m-save">Save map</button><button id="m-revert">Revert</button></div>
    <div id="errs"></div><div id="note" class="help"></div>
    <div class="help" style="margin-top:8px">Writes <code>content/maps/${esc(m.id)}.json</code>
      and any tile it has to bring back into line.</div>`;

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
function seamsHtml(seams, title) {
  if (!seams.length) return '';
  return `<div class="grp"><div class="t">${esc(title)}</div>${seams.map((s, i) => `
    <button class="seam" data-seam="${i}"${s.far.map ? '' : ' disabled'}>
      <span class="d">${esc(DIR_ARROW[s.dir] || s.dir)}</span>
      <span class="w">${esc(s.far.name || s.far.zone)}</span>
      <span class="m">${s.far.mapName ? esc(s.far.mapName) : 'on no map'}${
        s.way === 'in' ? ' · one-way in' : s.twoWay ? '' : ' · one-way'}</span>
    </button>`).join('')}</div>`;
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

function renderInspector(spec, prov) {
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
    // WHERE A TILE IS, IS NOT A FIELD. The coordinates are stated in the corner and
    // shown by the canvas the tile is sitting on, so a second copy as three number
    // boxes is the same fact typed twice — and typed is the problem: the spinners
    // invite a nudge, and nudging one moves the tile with none of what moving a tile
    // needs (the neighbours it auto-tiles with, the cell it might land on top of,
    // the seams that point at it). Moving a tile is a structural operation the
    // Studio does not do yet; it should not be reachable by an arrow key either.
    if (COORDS.has(key)) continue;
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
    // `district` is not typed on a tile any more. It was a free-text box holding a
    // key that had to match a district exactly, with nothing checking it did — a
    // typo read as "unclassified" and looked identical to a blank. It is painted
    // in the district view now, from a list of the districts that exist, and the
    // tile states which one it landed in (below) with a way over to it.
    if (key === 'district') continue;
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
  const seams = state.portals[editing.id] || [];

  const addable = Object.entries(flags).filter(([k]) => !carried.includes(k))
    .sort((a, b) => String(a[1].label || a[0]).localeCompare(String(b[1].label || b[0])));

  // The coordinates left the form, so the group they lived in says where they went.
  // The group NAME comes from the catalog entry rather than being typed here, so it
  // follows a re-grouping instead of stranding this line under a heading that moved.
  if (cols.grid_x) {
    push(cols.grid_x.group || 'Zone', `<div class="help">Coordinates
      <b>${esc(editing.grid_x)},${esc(editing.grid_y)},${esc(editing.grid_z ?? 0)}</b>
      (x, y, floor) — in the corner above, and on the canvas. Moving a tile is a
      structural change the Studio does not make.</div>`);
  }

  $('#inspector').innerHTML = `
    <div class="row" style="justify-content:space-between">
      <b>${esc(editing.name || editing.id)}</b>
      <span class="pill" title="x, y, floor">${esc(editing.grid_x)},${esc(editing.grid_y)},${esc(editing.grid_z ?? 0)}</span>
    </div>
    <div class="help">${esc(editing.id)}</div>
    <div class="help">derived: fill ${esc(spec?.fill || '—')} · terrain ${esc(spec?.terrain || '—')} · label ${esc(spec?.label?.text || '—')}</div>
    ${featureLine(prov)}
    ${districtLine()}
    ${seamsHtml(seams, 'Leads to')}
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
    // Same prov: adding an empty flag row changes nothing derived until you save.
    renderInspector(spec, prov);
  };
  $('#revert').onclick = () => select(editing.id);
  $('#save').onclick = save;
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
  draw();
  await select(row.id);
  refreshLint();
}

// ── Lint: the authored half, live (§8.4) ────────────────────────────────────
async function refreshLint() {
  const { ok, body } = await api('/api/lint');
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

window.addEventListener('resize', resize);
await loadCatalog();
resize();
await loadMaps();
await loadDistrictList();
