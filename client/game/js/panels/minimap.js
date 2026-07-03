// Sidebar minimap (5×5 BFS/grid) and the full-screen map popup.
import { sendCmdSilent } from '../net.js';

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

export function renderMinimap(nodes, direction) {
  const grid = document.getElementById('minimap-grid');
  if (!nodes || !nodes.length) { grid.textContent = '(unmapped)'; return; }

  const current = nodes.find(n => n.is_current);
  if (!current) { grid.textContent = '(unmapped)'; return; }

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

  const cellAt = new Map();
  for (const [id, [x,y]] of coords) cellAt.set(`${x},${y}`, id);

  const dangerClass = { safe:'mm-safe', low:'mm-low', medium:'mm-medium', high:'mm-high', lethal:'mm-lethal' };

  let html = '';
  for (let y = -2; y <= 2; y++) {
    for (let x = -2; x <= 2; x++) {
      const id = cellAt.get(`${x},${y}`);
      if (!id) { html += `<span class="mm-cell mm-blank">. </span>`; continue; }
      const node = byId.get(id);
      if (!node) { html += `<span class="mm-cell mm-blank">. </span>`; continue; }
      if (node.is_current) { html += `<span class="mm-cell mm-current" title="${node.name}">()</span>`; continue; }
      const sym = node.marker
        ? (node.marker.length === 1 ? node.marker + ' ' : node.marker.slice(0,2))
        : (node.is_safe_zone ? '◆ ' : (node.pvp_enabled ? '✕ ' : '○ '));
      const styles = [];
      if (node.bg_color) styles.push(`background:${node.bg_color}`);
      const textColor = node.color || (node.bg_color ? luminanceTextColor(node.bg_color) : null);
      if (textColor) styles.push(`color:${textColor}`);
      const styleAttr = styles.length ? ` style="${styles.join(';')}"` : '';
      const cls = `mm-cell ${node.color || node.bg_color ? 'mm-zone' : (dangerClass[node.danger_rating] || 'mm-zone')}`;
      html += `<span class="${cls}"${styleAttr} title="${node.name}">${sym}</span>`;
    }
    html += '<br>';
  }
  grid.innerHTML = html;
  const mob = document.getElementById('minimap-grid-mob');
  if (mob) mob.innerHTML = html;
  const hud = document.getElementById('minimap-grid-hud');
  if (hud) hud.innerHTML = html;
  if (direction) slideMinimap(direction);
}

// Land-use / function colour key for the default map view. Keys match server mapFunc().
const FUNC_LEGEND = {
  corporate:   { label: 'Corporate / Uptown',   color: '#b0bde2' },
  civic:       { label: 'Civic / institutional', color: '#b3e2cf' },
  residential: { label: 'Residential',           color: '#a9c9dc' },
  commercial:  { label: 'Commercial / trade',    color: '#a9dcea' },
  nightlife:   { label: 'Nightlife / bars',      color: '#e2b8ea' },
  media:       { label: 'Media / studio',        color: '#c6b6ec' },
  industrial:  { label: 'Industrial',            color: '#d8cfa0' },
  wasteland:   { label: 'Wasteland / ruins',     color: '#c9b89a' },
  slum:        { label: 'Slum / Undermarket',    color: '#eccaa0' },
  water:       { label: 'Water',                 color: '#a8cbe2' },
  hazard:      { label: 'Hazard / lethal',       color: '#eeb0b0' },
  other:       { label: 'Other',                 color: '#c2c8d0' },
};

// ── Three-level map popup: interior → zone → regional ────────────────────────
const LEVEL_LABEL = { interior: 'Interior', zone: 'Zone', regional: 'Regional' };
// Popup state, kept across re-opens so the toggle button + wheel know the current
// level and the tooltip can look tiles up by id.
const mapState = { mode: 'zone', insideInterior: false, byId: new Map() };
let mapUiWired = false;
// Pan offset of the grid within the fixed 11×11 viewport, and live drag state.
const mapPan = { tx: 0, ty: 0 };
const mapDrag = { on: false };

function twoLetterAbbrev(name) {
  return ((name || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 2) || '??');
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
// Toggle button: advance outward with wrap.
function cycleMapLevel() {
  const levels = mapLevels();
  let i = levels.indexOf(mapState.mode);
  if (i < 0) i = 0;
  sendCmdSilent(`map ${levels[(i + 1) % levels.length]}`);
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
  document.getElementById('map-toggle')?.addEventListener('click', cycleMapLevel);
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
  }
}

export function openMapPopup(tiles, mode = 'zone', insideInterior = false) {
  // Back-compat with the old two-mode server payloads.
  if (mode === 'function') mode = 'regional';
  else if (mode === 'zones') mode = 'zone';

  mapState.mode = mode;
  mapState.insideInterior = !!insideInterior;
  mapState.byId = new Map(tiles.map(t => [t.id, t]));

  wireMapUi();

  const grid = document.getElementById('map-grid');
  const legend = document.getElementById('map-legend');
  const title = document.getElementById('map-title');
  if (title) title.textContent =
    mode === 'regional' ? 'City Map — Regional' : mode === 'interior' ? 'City Map — Interior' : 'City Map — Zone';

  const toggle = document.getElementById('map-toggle');
  if (toggle) {
    const levels = mapLevels();
    const i = Math.max(0, levels.indexOf(mode));
    const next = levels[(i + 1) % levels.length];
    toggle.textContent = `${LEVEL_LABEL[mode]} ▸ ${LEVEL_LABEL[next]}`;
    toggle.style.display = levels.length > 1 ? '' : 'none';
  }

  const tip = document.getElementById('map-tooltip');
  if (tip) tip.style.display = 'none';

  if (!tiles.length) {
    grid.textContent = '(no map data)';
    legend.innerHTML = '';
    document.getElementById('map-panel').classList.add('active');
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
    if (t.isCurrent) return '()';
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
      let ch = '·';
      if (dx !== 0 && dy === 0) ch = '─';
      else if (dx === 0 && dy !== 0) ch = '│';
      else if (dx !== 0 && dy !== 0) ch = (dx === dy) ? '╲' : '╱';
      cell[cy][cx] = { kind: 'link', ch };
    }
  }

  grid.style.gridTemplateColumns = Array.from({ length: gCols }, (_, c) =>
    c % 2 === 0 ? 'var(--map-room)' : 'var(--map-gap)').join(' ');

  let html = '';
  for (let r = 0; r < gRows; r++) {
    for (let c = 0; c < gCols; c++) {
      const it = cell[r][c];
      if (!it) { html += `<span class="map-c"></span>`; continue; }
      if (it.kind === 'link') { html += `<span class="map-c map-link">${it.ch}</span>`; continue; }
      const t = it.tile;
      const funcColor = FUNC_LEGEND[t.func]?.color || FUNC_LEGEND.other.color;
      const bg = regional ? funcColor : t.bg_color;
      const styles = [];
      if (bg) styles.push(`background:${bg}`);
      const tColor = regional
        ? luminanceTextColor(bg)
        : (t.color || (t.bg_color ? luminanceTextColor(t.bg_color) : null));
      if (tColor) styles.push(`color:${tColor}`);
      const cls = `map-c map-room danger-${t.danger || 'safe'}` +
        (t.isCurrent ? ' map-current' : '') +
        (regional || t.bg_color || t.color ? ' map-styled' : '');
      const style = styles.length ? ` style="${styles.join(';')}"` : '';
      html += `<span class="${cls}"${style} data-zone-id="${t.id}">${symFor(t)}</span>`;
    }
  }
  grid.innerHTML = html;

  // Right panel: land-use legend (regional) or alphabetical room list (interior/zone).
  if (regional) {
    let leg = `<div class="map-leg-row"><span class="map-leg-sym map-current">()</span> You are here</div>`;
    const present = new Set(tiles.map(t => t.func || 'other'));
    for (const key of Object.keys(FUNC_LEGEND)) {
      if (!present.has(key)) continue;
      const f = FUNC_LEGEND[key];
      const style = `background:${f.color};color:${luminanceTextColor(f.color)}`;
      leg += `<div class="map-leg-row"><span class="map-leg-sym map-styled" style="${style}">&nbsp;&nbsp;</span> ${f.label}</div>`;
    }
    legend.innerHTML = leg;
  } else {
    const youLabel = (mode === 'zone' && insideInterior) ? 'You are here (inside)' : 'You are here';
    let leg = `<div class="map-leg-row map-leg-head"><span class="map-leg-sym map-current">()</span> ${youLabel}</div>`;
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

  document.getElementById('map-panel').classList.add('active');
  // Center the viewport on the current tile (offsets require the panel laid out).
  centerMapOnCurrent();
}
