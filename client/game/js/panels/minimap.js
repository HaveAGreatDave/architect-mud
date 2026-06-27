// Sidebar minimap (5×5 BFS/grid) and the full-screen map popup.

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

function slideMinimap(direction) {
  if (document.documentElement.getAttribute('data-motion') === 'off') return;
  const off = MM_SLIDE[direction];
  if (!off) return;
  for (const id of ['minimap-grid', 'minimap-grid-mob']) {
    const el = document.getElementById(id);
    if (!el || !el.animate) continue;
    el.animate(
      [{ transform: `translate(${off[0] * 1.6}em, ${off[1] * 1.6}em)` }, { transform: 'translate(0, 0)' }],
      { duration: 180, easing: 'ease-out' }
    );
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
  if (direction) slideMinimap(direction);
}

export function openMapPopup(tiles) {
  const grid = document.getElementById('map-grid');
  const legend = document.getElementById('map-legend');
  if (!tiles.length) {
    grid.textContent = '(no map data)';
    legend.innerHTML = '';
    document.getElementById('map-panel').classList.add('active');
    return;
  }

  const xs = tiles.map(t => t.x), ys = tiles.map(t => t.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const W = maxX - minX + 1, H = maxY - minY + 1;
  const byId = new Map(tiles.map(t => [t.id, t]));

  const symFor = (t) => {
    if (t.isCurrent) return '()';
    if (t.marker) return (t.marker.length === 1 ? t.marker + ' ' : t.marker.slice(0, 2));
    const letters = (t.name || '').replace(/[^A-Za-z0-9]/g, '');
    return (letters.slice(0, 2) || '??').padEnd(2, ' ');
  };

  const gCols = W * 2 - 1, gRows = H * 2 - 1;
  const cell = Array.from({ length: gRows }, () => new Array(gCols).fill(null));

  for (const t of tiles) {
    const gx = (t.x - minX) * 2, gy = (t.y - minY) * 2;
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
      const styles = [];
      if (t.bg_color) styles.push(`background:${t.bg_color}`);
      const tColor = t.color || (t.bg_color ? luminanceTextColor(t.bg_color) : null);
      if (tColor) styles.push(`color:${tColor}`);
      const cls = `map-c map-room danger-${t.danger || 'safe'}` +
        (t.isCurrent ? ' map-current' : '') +
        (t.bg_color || t.color ? ' map-styled' : '');
      const style = styles.length ? ` style="${styles.join(';')}"` : '';
      html += `<span class="${cls}"${style} title="${t.name}">${symFor(t)}</span>`;
    }
  }
  grid.innerHTML = html;

  let leg = `<div class="map-leg-row"><span class="map-leg-sym map-current">()</span> You are here</div>`;
  for (const t of tiles) {
    if (t.isCurrent) continue;
    const styles = [];
    if (t.bg_color) styles.push(`background:${t.bg_color}`);
    const legColor = t.color || (t.bg_color ? luminanceTextColor(t.bg_color) : null);
    if (legColor) styles.push(`color:${legColor}`);
    const cls = `map-leg-sym danger-${t.danger || 'safe'}` + (t.bg_color || t.color ? ' map-styled' : '');
    const style = styles.length ? ` style="${styles.join(';')}"` : '';
    leg += `<div class="map-leg-row"><span class="${cls}"${style}>${symFor(t)}</span> ${t.name}</div>`;
  }
  legend.innerHTML = leg;

  document.getElementById('map-panel').classList.add('active');
}
