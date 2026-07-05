// Sidebar minimap (5×5 BFS/grid) and the full-screen map popup.
import { sendCmdSilent } from '../net.js';

// Avenue View for the sidebar/HUD/mobile minimaps: a rendering toggle (not a
// server round-trip) that strips room symbols down to "does a named artery run
// through here" — || north/south, = east/west, + at a crossing. Persisted, and
// the last node payload is cached so the toggle can re-render without a move.
const MM_AVENUE_KEY = 'mm_avenue';
let mmAvenueView = false;
try { mmAvenueView = localStorage.getItem(MM_AVENUE_KEY) === '1'; } catch {}
let _lastMinimapNodes = null;

function wireMinimapAvenueToggle() {
  const btn = document.getElementById('mm-avenue-toggle');
  if (!btn || btn._wired) return;
  btn._wired = true;
  btn.classList.toggle('active', mmAvenueView);
  btn.addEventListener('click', () => {
    mmAvenueView = !mmAvenueView;
    try { localStorage.setItem(MM_AVENUE_KEY, mmAvenueView ? '1' : '0'); } catch {}
    btn.classList.toggle('active', mmAvenueView);
    if (_lastMinimapNodes) renderMinimap(_lastMinimapNodes);
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireMinimapAvenueToggle);
else wireMinimapAvenueToggle();

function luminanceTextColor(hex) {
  const h = hex.replace('#', '');
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
  const lum = (0.299*r + 0.587*g + 0.114*b) / 255;
  const t = Math.round((1 - lum) * 255);
  return `rgb(${t},${t},${t})`;
}

// Slide the minimap in the direction of travel so a move reads as movement
// rather than a hard swap. Offset is one cell; the new frame starts shifted
// toward where you came from and slides to center (camera-follow feel).
const MM_SLIDE = { north:[0,-1], south:[0,1], east:[1,0], west:[-1,0] };
// Scale for z-transitions: up feels like rising (expand), down like descending (contract).
const MM_SCALE = { up: 1.18, down: 0.82 };

function slideMinimap(direction) {
  if (document.documentElement.getAttribute('data-motion') === 'off') return;
  for (const id of ['minimap-grid', 'minimap-grid-mob']) {
    const el = document.getElementById(id);
    if (!el || !el.animate) continue;
    const off = MM_SLIDE[direction];
    if (off) {
      el.animate(
        [{ transform: `translate(${off[0] * 1.6}em, ${off[1] * 1.6}em)` }, { transform: 'translate(0, 0)' }],
        { duration: 180, easing: 'ease-out' }
      );
    } else if (MM_SCALE[direction]) {
      // Z-level shift: fade+scale from the departure state into the new floor.
      const s = MM_SCALE[direction];
      el.animate(
        [{ opacity: 0, transform: `scale(${s})` }, { opacity: 1, transform: 'scale(1)' }],
        { duration: 220, easing: 'ease-out' }
      );
    } else if (direction === 'in' || direction === 'out') {
      // Portal/building transition: quick opacity dip.
      el.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: 200, easing: 'ease-in-out' }
      );
    }
  }
}

function minimapMessage(msg) {
  for (const id of ['minimap-grid', 'minimap-grid-mob', 'minimap-grid-hud']) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `<span class="mm-msg">${msg}</span>`;
  }
}

export function renderMinimap(nodes, direction) {
  if (!nodes || !nodes.length) { minimapMessage('(unmapped)'); return; }

  const current = nodes.find(n => n.is_current);
  if (!current) { minimapMessage('(unmapped)'); return; }
  _lastMinimapNodes = nodes; // cache so the Avenue View toggle can re-render in place

  const byId = new Map(nodes.map(n => [n.id, n]));
  const coords = new Map();

  if (current.map_id && current.grid_x != null && current.grid_y != null) {
    for (const n of nodes) {
      if (n.map_id === current.map_id && n.grid_z === current.grid_z && n.grid_x != null && n.grid_y != null) {
        coords.set(n.id, [n.grid_x - current.grid_x, n.grid_y - current.grid_y]);
      }
    }
  }

  if (!coords.size) {
    const DIR_OFFSET = { north:[0,-1], south:[0,1], east:[1,0], west:[-1,0] };
    coords.set(current.id, [0,0]);
    const queue = [current.id];
    const seen = new Set([current.id]);
    while (queue.length) {
      const id = queue.shift();
      const node = byId.get(id);
      const [x,y] = coords.get(id);
      if (!node) continue;
      for (const [dir, targetId] of Object.entries(node.exits || {})) {
        if (!DIR_OFFSET[dir] || !byId.has(targetId) || seen.has(targetId)) continue;
        const [dx,dy] = DIR_OFFSET[dir];
        coords.set(targetId, [x+dx, y+dy]);
        seen.add(targetId);
        queue.push(targetId);
      }
    }
  }

  // A 5×5 window (x,y ∈ −R..R) expands to a (2·(2R+1)−1)² cell grid: even indices
  // hold rooms, odd indices hold the connector *between* two rooms. A gap with a
  // connector = a walkable exit; an empty gap = a wall. This is the readability
  // fix — the same room+gap connector model openMapPopup() uses for the full map.
  const R = 2;
  const gCols = (2 * R + 1) * 2 - 1, gRows = gCols;
  const cell = Array.from({ length: gRows }, () => new Array(gCols).fill(null));
  const inWin = (x, y) => x >= -R && x <= R && y >= -R && y <= R;

  for (const [id, [x, y]] of coords) {
    if (!inWin(x, y)) continue;
    cell[(y + R) * 2][(x + R) * 2] = { kind: 'room', id };
  }
  // Draw a connector into the gap between a room and each neighbour it has a real
  // exit to (positional dx/dy off the coord map, exactly like the full map). Non-
  // cardinal exits (up/down/in/out) target tiles off this coord map and are skipped.
  for (const [id, [x, y]] of coords) {
    if (!inWin(x, y)) continue;
    const node = byId.get(id);
    if (!node) continue;
    const gx = (x + R) * 2, gy = (y + R) * 2;
    for (const targetId of Object.values(node.exits || {})) {
      if (!coords.has(targetId)) continue;
      const [tx, ty] = coords.get(targetId);
      const dx = tx - x, dy = ty - y;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) continue;
      const cx = gx + dx, cy = gy + dy;
      if (cx < 0 || cx >= gCols || cy < 0 || cy >= gRows) continue;
      if (cell[cy][cx]?.kind === 'room') continue;
      const ch = (dx !== 0 && dy === 0) ? '─' : (dx === 0 && dy !== 0) ? '│' : (dx === dy ? '╲' : '╱');
      // A major road (flags.artery): both endpoints must share a named artery,
      // so a cross-street into an unrelated side street doesn't light up. Feeds
      // Avenue View, which reads these to place ||/=/+ artery glyphs.
      const tnode = byId.get(targetId);
      const artery = !!(node.artery && tnode?.artery && node.artery.some(s => tnode.artery.includes(s)));
      cell[cy][cx] = { kind: 'link', ch, artery };
    }
  }

  const symFor = (node) => node.marker
    ? (node.marker.length === 1 ? node.marker + ' ' : node.marker.slice(0, 2))
    : (node.is_safe_zone ? '◆ ' : (node.pvp_enabled ? '✕ ' : '○ '));
  // Hover tooltip: zone name, plus any building(s) on the tile on a second line.
  // Escaped so a name with quotes can't break out of the title attribute.
  const titleFor = (node) => {
    const parts = [node.name];
    if (node.buildings?.length) parts.push(node.buildings.join(', '));
    return escapeHtml(parts.join('\n'));
  };

  let html = '';
  for (let r = 0; r < gRows; r++) {
    for (let c = 0; c < gCols; c++) {
      const it = cell[r][c];
      if (!it) { html += `<span class="mm-c mm-void"></span>`; continue; }
      if (it.kind === 'link') { html += `<span class="mm-c mm-link">${it.ch}</span>`; continue; }
      const node = byId.get(it.id);
      if (!node) { html += `<span class="mm-c mm-void"></span>`; continue; }
      if (node.is_current) { html += `<span class="mm-c mm-room mm-current" title="${titleFor(node)}"></span>`; continue; }
      const styles = [];
      if (node.bg_color) styles.push(`background:${node.bg_color}`);
      const textColor = node.color || (node.bg_color ? luminanceTextColor(node.bg_color) : null);
      if (textColor) styles.push(`color:${textColor}`);
      const styleAttr = styles.length ? ` style="${styles.join(';')}"` : '';
      const styled = (node.bg_color || node.color) ? ' mm-styled' : '';
      // Avenue View: strip room identity down to the artery glyph the crossing roads
      // imply (|| N/S, = E/W, + a crossing); non-artery tiles render blank.
      let sym, avenueCls = '';
      if (mmAvenueView) {
        const isArteryLink = (link) => link?.kind === 'link' && link.artery;
        const hasNS = isArteryLink(cell[r - 1]?.[c]) || isArteryLink(cell[r + 1]?.[c]);
        const hasEW = isArteryLink(cell[r]?.[c - 1]) || isArteryLink(cell[r]?.[c + 1]);
        sym = hasNS && hasEW ? '+' : hasNS ? '||' : hasEW ? '=' : '';
        if (sym) avenueCls = ' mm-avenue-road';
      } else sym = symFor(node);
      const cls = `mm-c mm-room danger-${node.danger_rating || 'safe'}${styled}${avenueCls}`;
      html += `<span class="${cls}"${styleAttr} title="${titleFor(node)}">${sym}</span>`;
    }
  }
  for (const id of ['minimap-grid', 'minimap-grid-mob', 'minimap-grid-hud']) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }
  if (direction) slideMinimap(direction);
}

// Land-use / function colour key for the default map view. Keys + colours match
// server mapFunc() (movement.js) and scripts/landuse-zone-colors.js — keep synced.
const FUNC_LEGEND = {
  northcity:   { label: 'North City / Uptown',   color: '#d9a83a' },
  government:  { label: 'Government',             color: '#b56fbf' },
  civic:       { label: 'Civic / institutional', color: '#4bb36a' },
  residential: { label: 'Residential',           color: '#c9a884' },
  commercial:  { label: 'Commercial / shops',    color: '#e08a4a' },
  nightlife:   { label: 'Nightlife — Marquee',   color: '#e85aa0' },
  media:       { label: 'Media / studio',        color: '#8e6fd0' },
  docks:       { label: 'Docks / waterfront',    color: '#1fb5aa' },
  water:       { label: 'Water — Coldwater Bay',  color: '#2f86cc' },
  industrial:  { label: 'Industrial',            color: '#9a8a4f' },
  slaglands:   { label: 'Slagworks',             color: '#e5822a' },
  wasteland:   { label: 'Wasteland / ruins',     color: '#7c6a4a' },
  ashway:      { label: 'The Ashway',            color: '#8b9097' },
  slum:        { label: 'Slum / Undermarket',    color: '#cf6a2e' },
  hazard:      { label: 'Hazard / lethal',       color: '#e05555' },
};

// Street tint: a connector inherits meaning from the tiles it joins. In zone/interior
// view it takes the *higher* danger of its two endpoints (so any street touching a
// lethal tile glows red); in regional view it blends the two land-use colours.
const DANGER_RANK = { safe: 0, low: 1, medium: 2, high: 3, lethal: 4 };
const DANGER_STREET = [
  'rgba(120,140,165,0.40)', // safe — neutral steel
  'rgba(205,180,70,0.44)',  // low
  'rgba(220,140,55,0.48)',  // medium
  'rgba(212,70,60,0.52)',   // high
  'rgba(214,55,55,0.64)',   // lethal
];
function hexToRgb(hex) {
  const h = (hex || '').replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function streetColor(a, b, regional) {
  if (regional) {
    const [r1, g1, b1] = hexToRgb(FUNC_LEGEND[a.func]?.color || FUNC_LEGEND.residential.color);
    const [r2, g2, b2] = hexToRgb(FUNC_LEGEND[b.func]?.color || FUNC_LEGEND.residential.color);
    return `rgba(${(r1 + r2) >> 1},${(g1 + g2) >> 1},${(b1 + b2) >> 1},0.5)`;
  }
  return DANGER_STREET[Math.max(DANGER_RANK[a.danger] ?? 0, DANGER_RANK[b.danger] ?? 0)];
}

// Landmark icons — icon glyph must match the server POI_ICON in movement.js.
const POI_LEGEND = {
  airport: { icon: '✈', label: 'Airport / airfield' },
  police:  { icon: '★', label: 'Police station' },
  power:   { icon: '⚡', label: 'Power plant' },
  club:    { icon: '♥', label: 'Strip club' },
  hotel:   { icon: '🏨', label: 'Hotel' },
  bar:     { icon: '🍺', label: 'Bar' },
  vendor:  { icon: '$', label: 'Vendor / shop' },
  home:    { icon: '⌂', label: 'Apartments / housing' },
  stairs:  { icon: '⇕', label: 'Stairs (up/down)' },
};

// ── Three-level map popup: interior → zone → regional ────────────────────────
// Popup state, kept across re-opens so the tab buttons + wheel know the current
// level and the tooltip can look tiles up by id.
const mapState = { mode: 'zone', insideInterior: false, byId: new Map(), tiles: [], avenueView: false, labelsView: false };
let mapUiWired = false;
// Pan offset of the grid within the fixed 11×11 viewport, and live drag state.
const mapPan = { tx: 0, ty: 0 };
const mapDrag = { on: false };

function twoLetterAbbrev(name) {
  return ((name || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 2) || '??');
}
// Avenue-View label: initials of the significant words ("Franchise Strip" → "FS",
// "Muster Yard" → "MY"); a single word falls back to its first two letters. Drops
// leading articles so "The Marquee" → "MA", not "TM".
function streetAbbrev(name) {
  const words = String(name || '').split(/\s+/).filter(w => w && !/^(the|of|and|at|a|an)$/i.test(w));
  if (!words.length) return twoLetterAbbrev(name);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words.map(w => w[0]).join('').slice(0, 3).toUpperCase();
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
}

// Available zoom levels, inner→outer. Interior only exists when you're inside one.
function mapLevels() {
  return mapState.insideInterior ? ['interior', 'zone', 'regional'] : ['zone', 'regional'];
}
// Step one level; +1 = zoom out (toward regional), −1 = zoom in. Clamps at the ends.
function stepMapLevel(delta) {
  const levels = mapLevels();
  let i = levels.indexOf(mapState.mode);
  if (i < 0) i = 0;
  const next = levels[Math.min(levels.length - 1, Math.max(0, i + delta))];
  if (next && next !== mapState.mode) sendCmdSilent(`map ${next}`);
}

function mapTooltipEl() {
  let t = document.getElementById('map-tooltip');
  if (!t) { t = document.createElement('div'); t.id = 'map-tooltip'; document.body.appendChild(t); }
  return t;
}
function positionTooltip(t, e) {
  const pad = 14;
  const r = t.getBoundingClientRect();
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + r.width > window.innerWidth) x = e.clientX - r.width - pad;
  if (y + r.height > window.innerHeight) y = e.clientY - r.height - pad;
  t.style.left = Math.max(4, x) + 'px';
  t.style.top = Math.max(4, y) + 'px';
}
// ── Drag-to-pan the grid within the fixed 11×11 viewport ─────────────────────
// Clamp so the grid never drags past its own edges; when a dimension is smaller
// than the viewport (grid fits) it's centered and locked.
function applyMapPan() {
  const vp = document.getElementById('map-viewport');
  const grid = document.getElementById('map-grid');
  if (!vp || !grid) return;
  const vw = vp.clientWidth, vh = vp.clientHeight;
  const gw = grid.scrollWidth, gh = grid.scrollHeight;
  const clamp = (t, view, content) =>
    content <= view ? (view - content) / 2 : Math.min(0, Math.max(view - content, t));
  mapPan.tx = clamp(mapPan.tx, vw, gw);
  mapPan.ty = clamp(mapPan.ty, vh, gh);
  grid.style.transform = `translate(${mapPan.tx}px, ${mapPan.ty}px)`;
}
function centerMapOnCurrent() {
  const vp = document.getElementById('map-viewport');
  const grid = document.getElementById('map-grid');
  if (!vp || !grid) return;
  const cur = grid.querySelector('.map-current');
  if (cur) {
    mapPan.tx = vp.clientWidth / 2 - (cur.offsetLeft + cur.offsetWidth / 2);
    mapPan.ty = vp.clientHeight / 2 - (cur.offsetTop + cur.offsetHeight / 2);
  } else { mapPan.tx = 0; mapPan.ty = 0; }
  applyMapPan();
}

function onMapHover(e) {
  if (mapDrag.on) return;
  const cell = e.target.closest('[data-zone-id]');
  if (!cell) return;
  const z = mapState.byId.get(cell.getAttribute('data-zone-id'));
  if (!z) return;
  const t = mapTooltipEl();
  let html = `<div class="map-tt-name">${escapeHtml(z.name)}</div>`;
  if (z.description) html += `<div class="map-tt-desc">${escapeHtml(z.description)}</div>`;
  if (z.buildings && z.buildings.length)
    html += `<div class="map-tt-bld"><b>Buildings:</b> ${z.buildings.map(escapeHtml).join(', ')}</div>`;
  t.innerHTML = html;
  t.style.display = 'block';
  positionTooltip(t, e);
}
function onMapMove(e) {
  const t = document.getElementById('map-tooltip');
  if (t && t.style.display === 'block') positionTooltip(t, e);
}
function onMapOut(e) {
  const cell = e.target.closest('[data-zone-id]');
  if (!cell) return;
  const to = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('[data-zone-id]');
  if (to) return; // sliding between cells — the next hover updates the tooltip
  const t = document.getElementById('map-tooltip');
  if (t) t.style.display = 'none';
}

// One-time wiring for the toggle button, mouse-wheel level cycling, and the
// custom hover tooltip (delegated over the grid + legend list).
function wireMapUi() {
  if (mapUiWired) return;
  mapUiWired = true;
  // Three explicit level buttons (interior / zone / regional). The wheel still
  // cycles; these jump straight to a level.
  document.getElementById('map-tabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.map-tab');
    if (!btn || btn.disabled) return;
    const level = btn.getAttribute('data-level');
    if (level && level !== mapState.mode) sendCmdSilent(`map ${level}`);
  });
  // Avenue View: a rendering toggle, not a zoom level — swaps room symbols for
  // connected road icons (no server round-trip needed, just re-render).
  document.getElementById('map-avenue-toggle')?.addEventListener('click', () => {
    mapState.avenueView = !mapState.avenueView;
    document.getElementById('map-avenue-toggle')?.classList.toggle('active', mapState.avenueView);
    renderMapGrid();
  });
  // Labels: overlay 2–3 letter tile abbreviations on the road icons. Only meaningful
  // in Avenue View, so turning it on turns Avenue View on too.
  document.getElementById('map-labels-toggle')?.addEventListener('click', () => {
    mapState.labelsView = !mapState.labelsView;
    if (mapState.labelsView && !mapState.avenueView) {
      mapState.avenueView = true;
      document.getElementById('map-avenue-toggle')?.classList.toggle('active', true);
    }
    document.getElementById('map-labels-toggle')?.classList.toggle('active', mapState.labelsView);
    renderMapGrid();
  });
  const vp = document.getElementById('map-viewport');
  if (vp) {
    let lastWheel = 0;
    vp.addEventListener('wheel', (e) => {
      e.preventDefault();
      const now = Date.now();
      if (now - lastWheel < 150) return; // one notch = one step
      lastWheel = now;
      stepMapLevel(e.deltaY < 0 ? 1 : -1); // up = zoom out, down = zoom in
    }, { passive: false });

    // Drag to pan the grid within the bounded viewport.
    let dsx = 0, dsy = 0;
    vp.addEventListener('pointerdown', (e) => {
      mapDrag.on = true;
      dsx = e.clientX - mapPan.tx;
      dsy = e.clientY - mapPan.ty;
      vp.classList.add('grabbing');
      try { vp.setPointerCapture(e.pointerId); } catch {}
      const t = document.getElementById('map-tooltip');
      if (t) t.style.display = 'none';
    });
    vp.addEventListener('pointermove', (e) => {
      if (!mapDrag.on) return;
      mapPan.tx = e.clientX - dsx;
      mapPan.ty = e.clientY - dsy;
      applyMapPan();
    });
    const endDrag = (e) => {
      if (!mapDrag.on) return;
      mapDrag.on = false;
      vp.classList.remove('grabbing');
      try { vp.releasePointerCapture(e.pointerId); } catch {}
    };
    vp.addEventListener('pointerup', endDrag);
    vp.addEventListener('pointercancel', endDrag);
  }
  for (const id of ['map-grid', 'map-legend']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener('mouseover', onMapHover);
    el.addEventListener('mousemove', onMapMove);
    el.addEventListener('mouseout', onMapOut);
    // Charter destination-pick: while armed, clicking a tile chooses it.
    el.addEventListener('click', (e) => {
      if (!_pickCb) return;
      const cell = e.target.closest('[data-zone-id]');
      if (!cell) return;
      const zid = cell.getAttribute('data-zone-id');
      const cb = _pickCb; _pickCb = null;
      document.getElementById('map-panel')?.classList.remove('active');
      cb(zid);
    });
  }
}

// Arm the map popup so the next tile click selects a destination (charter). The
// callback receives the clicked zone id; picking closes the map.
let _pickCb = null;
export function armMapPick(cb) {
  _pickCb = cb;
  const title = document.getElementById('map-title');
  if (title) title.textContent = 'Charter — pick your destination';
}

export function openMapPopup(tiles, mode = 'zone', insideInterior = false) {
  // Back-compat with the old two-mode server payloads.
  if (mode === 'function') mode = 'regional';
  else if (mode === 'zones') mode = 'zone';

  mapState.mode = mode;
  mapState.insideInterior = !!insideInterior;
  mapState.byId = new Map(tiles.map(t => [t.id, t]));
  mapState.tiles = tiles;

  wireMapUi();

  const title = document.getElementById('map-title');
  if (title) title.textContent =
    mode === 'regional' ? 'City Map — Regional' : mode === 'interior' ? 'City Map — Interior' : 'City Map — Zone';

  // Highlight the active level; disable Interior when you're not inside one.
  for (const btn of document.querySelectorAll('#map-tabs .map-tab')) {
    const level = btn.getAttribute('data-level');
    btn.classList.toggle('active', level === mode);
    btn.disabled = (level === 'interior' && !insideInterior);
  }
  document.getElementById('map-avenue-toggle')?.classList.toggle('active', mapState.avenueView);
  document.getElementById('map-labels-toggle')?.classList.toggle('active', mapState.labelsView);

  const tip = document.getElementById('map-tooltip');
  if (tip) tip.style.display = 'none';

  renderMapGrid();
  document.getElementById('map-panel').classList.add('active');
}

// Refreshes the map popup's grid/legend from mapState (tiles/mode/insideInterior/
// avenueView) without touching the server — used both by the initial open and by
// the Avenue View toggle (a pure rendering-mode switch on already-fetched tiles).
function renderMapGrid() {
  const { tiles, mode, insideInterior, avenueView, labelsView } = mapState;
  const grid = document.getElementById('map-grid');
  const legend = document.getElementById('map-legend');

  if (!tiles.length) {
    grid.textContent = '(no map data)';
    legend.innerHTML = '';
    return;
  }

  const regional = mode === 'regional';
  const xs = tiles.map(t => t.x), ys = tiles.map(t => t.y);
  // Interior/Zone are 11×11 windows pre-centered on you (0,0) — force the extent so
  // you stay centered even when the window's edges are empty. Regional is dynamic.
  const minX = regional ? Math.min(...xs) : -5;
  const maxX = regional ? Math.max(...xs) : 5;
  const minY = regional ? Math.min(...ys) : -5;
  const maxY = regional ? Math.max(...ys) : 5;
  const W = maxX - minX + 1, H = maxY - minY + 1;
  const byId = mapState.byId;

  const symFor = (t) => {
    if (t.isCurrent) return '';
    if (t.icon) return t.icon + ' ';                 // POI landmark (airport, police, …)
    if (t.marker) return (t.marker.length === 1 ? t.marker + ' ' : t.marker.slice(0, 2));
    return twoLetterAbbrev(t.name).padEnd(2, ' ');
  };

  const gCols = W * 2 - 1, gRows = H * 2 - 1;
  const cell = Array.from({ length: gRows }, () => new Array(gCols).fill(null));

  for (const t of tiles) {
    const gx = (t.x - minX) * 2, gy = (t.y - minY) * 2;
    if (gy < 0 || gy >= gRows || gx < 0 || gx >= gCols) continue;
    cell[gy][gx] = { kind: 'room', tile: t };
  }

  for (const t of tiles) {
    const gx = (t.x - minX) * 2, gy = (t.y - minY) * 2;
    for (const targetId of Object.values(t.exits || {})) {
      const n = byId.get(targetId);
      if (!n) continue;
      const dx = n.x - t.x, dy = n.y - t.y;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) continue;
      const cy = gy + dy, cx = gx + dx;
      if (cy < 0 || cy >= gRows || cx < 0 || cx >= gCols) continue;
      if (cell[cy][cx]?.kind === 'room') continue;
      const orient = (dx !== 0 && dy === 0) ? 'h' : (dx === 0 && dy !== 0) ? 'v' : (dx === dy ? 'd1' : 'd2');
      // A street adjacent to the current tile is one of "your exits" — highlight it.
      const open = !!(t.isCurrent || n.isCurrent) || !!cell[cy][cx]?.open;
      // A major road (flags.artery) is a fixed tag, not a computed tint — both
      // endpoints must share a named artery (an intersection tile carries more
      // than one), so a cross-street segment into an unrelated side street
      // doesn't light up.
      const artery = !!(t.artery && n.artery && t.artery.some(s => n.artery.includes(s)));
      cell[cy][cx] = { kind: 'link', orient, color: streetColor(t, n, regional), open, artery };
    }
  }

  grid.style.gridTemplateColumns = Array.from({ length: gCols }, (_, c) =>
    c % 2 === 0 ? 'var(--map-room)' : 'var(--map-gap)').join(' ');
  // Avenue View strips tile chrome to a road skeleton; Labels overlays abbrevs.
  grid.classList.toggle('avenue', avenueView);
  grid.classList.toggle('labels', avenueView && labelsView);

  let html = '';
  for (let r = 0; r < gRows; r++) {
    for (let c = 0; c < gCols; c++) {
      const it = cell[r][c];
      if (!it) { html += `<span class="map-c"></span>`; continue; }
      if (it.kind === 'link') {
        if (it.orient === 'd1' || it.orient === 'd2') { // diagonals stay glyphs (rare)
          html += `<span class="map-c map-link">${it.orient === 'd1' ? '╲' : '╱'}</span>`;
        } else {
          const scls = `map-c map-street map-street-${it.orient}${it.artery ? ' map-street-artery' : ''}${it.open ? ' map-street-open' : ''}`;
          html += `<span class="${scls}" style="--street:${it.color}"></span>`;
        }
        continue;
      }
      const t = it.tile;
      const funcColor = FUNC_LEGEND[t.func]?.color || FUNC_LEGEND.residential.color;
      const bg = regional ? funcColor : t.bg_color;
      const styles = [];
      if (bg) styles.push(`background:${bg}`);
      const isPoi = t.icon && !t.isCurrent; // POI icon gets its own colour via a class
      const tColor = regional
        ? luminanceTextColor(bg)
        : (t.color || (t.bg_color ? luminanceTextColor(t.bg_color) : null));
      if (tColor && !isPoi) styles.push(`color:${tColor}`);
      // Dead-end = exactly one connector touching this room.
      let deg = 0;
      for (const [rr, cc] of [[r, c - 1], [r, c + 1], [r - 1, c], [r + 1, c]])
        if (cell[rr]?.[cc]?.kind === 'link') deg++;
      const cls = `map-c map-room danger-${t.danger || 'safe'}` +
        (t.isCurrent ? ' map-current' : '') +
        (regional || t.bg_color || t.color ? ' map-styled' : '') +
        (isPoi ? ` map-poi map-poi-${t.poi}` : '') +
        (t.buildings && t.buildings.length ? ' map-has-building' : '') +
        (deg === 1 ? ' map-deadend' : '');
      const style = styles.length ? ` style="${styles.join(';')}"` : '';
      // Avenue View: draw a connected road icon whose arms point toward each
      // grid-adjacent artery link — straight / corner / T / crossroads emerge
      // from which arms are present, meeting the gap-cell bars seamlessly. With
      // Labels on, the tile abbreviation overlays the (dimmed) road.
      let sym;
      if (t.isCurrent) sym = '';
      else if (avenueView) {
        const arteryLink = (link) => link?.kind === 'link' && link.artery;
        let arms = '';
        if (arteryLink(cell[r - 1]?.[c])) arms += '<i class="av-arm-n"></i>';
        if (arteryLink(cell[r + 1]?.[c])) arms += '<i class="av-arm-s"></i>';
        if (arteryLink(cell[r]?.[c - 1])) arms += '<i class="av-arm-w"></i>';
        if (arteryLink(cell[r]?.[c + 1])) arms += '<i class="av-arm-e"></i>';
        if (arms) {
          sym = `<span class="av-road"><i class="av-node"></i>${arms}</span>`;
          if (labelsView) sym += `<span class="av-label">${escapeHtml(streetAbbrev(t.name))}</span>`;
        } else sym = '';
      } else sym = symFor(t);
      html += `<span class="${cls}"${style} data-zone-id="${t.id}">${sym}</span>`;
    }
  }
  grid.innerHTML = html;

  // Right panel: land-use legend (regional) or alphabetical room list (interior/zone).
  // Shared glyph keys (street / your-exits / building) — same visual language as the grid.
  let KEYS =
    `<div class="map-leg-row"><span class="map-leg-sym"><i class="map-leg-street"></i></span> Street</div>` +
    `<div class="map-leg-row"><span class="map-leg-sym"><i class="map-leg-street map-leg-street-artery"></i></span> Major road</div>` +
    `<div class="map-leg-row"><span class="map-leg-sym"><i class="map-leg-street map-leg-street-open"></i></span> Your exits</div>` +
    `<div class="map-leg-row"><span class="map-leg-sym"><i class="map-leg-bld"></i></span> Building here</div>`;
  // Landmark icons actually present in this view (kept sparse — see server mapPoi()).
  const poiPresent = new Set(tiles.map(t => t.poi).filter(Boolean));
  for (const key of Object.keys(POI_LEGEND)) {
    if (!poiPresent.has(key)) continue;
    const p = POI_LEGEND[key];
    KEYS += `<div class="map-leg-row"><span class="map-leg-sym map-poi map-poi-${key}">${p.icon}</span> ${p.label}</div>`;
  }
  if (regional) {
    let leg = `<div class="map-leg-row"><span class="map-leg-sym map-current"></span> You are here</div>` + KEYS;
    const present = new Set(tiles.map(t => t.func || 'residential'));
    for (const key of Object.keys(FUNC_LEGEND)) {
      if (!present.has(key)) continue;
      const f = FUNC_LEGEND[key];
      const style = `background:${f.color};color:${luminanceTextColor(f.color)}`;
      leg += `<div class="map-leg-row"><span class="map-leg-sym map-styled" style="${style}">&nbsp;&nbsp;</span> ${f.label}</div>`;
    }
    legend.innerHTML = leg;
  } else {
    const youLabel = (mode === 'zone' && insideInterior) ? 'You are here (inside)' : 'You are here';
    let leg = `<div class="map-leg-row map-leg-head"><span class="map-leg-sym map-current"></span> ${youLabel}</div>` + KEYS;
    leg += `<div class="map-list">`;
    // Alphabetical by marker (falling back to the 2-letter tile abbrev), then name.
    const sorted = [...tiles].sort((a, b) => {
      const ka = (a.marker || twoLetterAbbrev(a.name)).toLowerCase();
      const kb = (b.marker || twoLetterAbbrev(b.name)).toLowerCase();
      if (ka !== kb) return ka < kb ? -1 : 1;
      return (a.name || '').localeCompare(b.name || '');
    });
    for (const t of sorted) {
      const styles = [];
      if (t.bg_color) styles.push(`background:${t.bg_color}`);
      const legColor = t.color || (t.bg_color ? luminanceTextColor(t.bg_color) : null);
      if (legColor) styles.push(`color:${legColor}`);
      const symCls = `map-leg-sym danger-${t.danger || 'safe'}` + (t.bg_color || t.color ? ' map-styled' : '');
      const style = styles.length ? ` style="${styles.join(';')}"` : '';
      const rowCls = 'map-leg-row map-list-row' + (t.isCurrent ? ' map-list-current' : '');
      leg += `<div class="${rowCls}" data-zone-id="${t.id}"><span class="${symCls}"${style}>${symFor(t)}</span> ${escapeHtml(t.name)}</div>`;
    }
    leg += `</div>`;
    legend.innerHTML = leg;
  }

  // Center the viewport on the current tile (offsets require the panel laid out).
  centerMapOnCurrent();
}

// If the map popup is currently open, silently re-request it at the current
// zoom level so it stays in sync as the player moves — same-shape response as
// opening it fresh, just routed back through the normal 'map' message handler.
export function refreshMapIfOpen() {
  if (document.getElementById('map-panel')?.classList.contains('active')) {
    sendCmdSilent(`map ${mapState.mode}`);
  }
}
