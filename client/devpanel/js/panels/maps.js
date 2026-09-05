// --- Map zoom (shared by the Maps-tab editor, the big-map "world map" overlay,
// and the Power panel grids) ---
// A single stepped zoom axis with MAP_ZOOM_LEVELS stops. Level 0 = whole map in
// view (never enlarged past native); the top level = native tile size (get close,
// scroll to roam). Each intermediate level interpolates geometrically between the
// per-map fit factor and native scale, measured live per grid in applyMapScale().
const MAP_ZOOM_LEVELS = 10;
let mapZoomLevel = (() => {
  try { const n = parseInt(localStorage.getItem('devMapZoomLevel'), 10);
        return (n >= 0 && n < MAP_ZOOM_LEVELS) ? n : 0; } catch { return 0; }
})();

// Re-render whichever map view is currently on screen (mirrors the old scale flow).
function _rerenderActiveMap() {
  const overlay = document.getElementById('bigmap-overlay');
  if (overlay && overlay.classList.contains('active')) renderBigMapOverlay();
  else if (typeof currentPanel !== 'undefined' && currentPanel === 'power') renderPowerPanelBody();
  else if (typeof currentPanel !== 'undefined' && currentPanel === 'maps') renderMapOverview();
}

// delta +1 = zoom in (closer), −1 = zoom out (wider). Clamped to the ladder ends.
function setMapZoom(delta) {
  const next = Math.min(MAP_ZOOM_LEVELS - 1, Math.max(0, mapZoomLevel + delta));
  if (next === mapZoomLevel) return;
  mapZoomLevel = next;
  try { localStorage.setItem('devMapZoomLevel', String(mapZoomLevel)); } catch {}
  _rerenderActiveMap();
}

function mapScaleControlHtml() {
  const outOff = mapZoomLevel <= 0 ? ' disabled' : '';
  const inOff = mapZoomLevel >= MAP_ZOOM_LEVELS - 1 ? ' disabled' : '';
  return `<div class="map-scale-ctrl" style="display:flex;align-items:center;gap:4px">
    <span style="font-size:10px;color:var(--text-dim);letter-spacing:1px">ZOOM</span>
    <button class="action-btn"${outOff} onclick="setMapZoom(-1)" title="Zoom out (wider — whole map in view)">−</button>
    <span style="font-size:10px;color:var(--text-dim);min-width:34px;text-align:center">${mapZoomLevel + 1}/${MAP_ZOOM_LEVELS}</span>
    <button class="action-btn"${inOff} onclick="setMapZoom(1)" title="Zoom in (closer to the map)">+</button>
  </div>`;
}

// Pin the map editor's sub-tabs + toolbar to the top of the scrolling #list-panel.
function stickyHeadHtml(inner) {
  return `<div class="panel-sticky-head">${inner}</div>`;
}

function wrapMapScale(gridHtml) {
  return `<div class="map-scale-viewport"><div class="map-scale-inner">${gridHtml}</div></div>`;
}

// Post-render: measure each grid, work out its whole-map fit factor, then CSS-
// transform it to the current zoom level's factor (geometric ramp fit→native).
function applyMapScale(root) {
  const scope = root || document;
  scope.querySelectorAll('.map-scale-viewport').forEach(vp => {
    const inner = vp.querySelector('.map-scale-inner');
    if (!inner) return;
    inner.style.transform = 'none';
    const natW = inner.scrollWidth, natH = inner.scrollHeight;
    if (!natW || !natH) return;
    const availW = vp.clientWidth || (vp.parentElement && vp.parentElement.clientWidth) || natW;
    const availH = Math.max(200, window.innerHeight - vp.getBoundingClientRect().top - 90);
    // zMin = whole map in view (never enlarged past native); zMax = native tile size.
    const zMin = Math.min(availW / natW, availH / natH, 1);
    const zMax = 1;
    const t = mapZoomLevel / (MAP_ZOOM_LEVELS - 1);
    const factor = zMin * Math.pow(zMax / zMin, t); // pow(1,t)=1 when zMin===zMax
    inner.style.transformOrigin = 'top left';
    inner.style.transform = `scale(${factor})`;
    const scaledW = natW * factor, scaledH = natH * factor;
    if (scaledW <= availW + 1 && scaledH <= availH + 1) {
      // Fits fully — pin the viewport to the content, no scrollbars.
      vp.style.height = scaledH + 'px';
      vp.style.overflow = 'hidden';
    } else {
      // Larger than the frame — bound the viewport and scroll to roam.
      vp.style.height = Math.min(availH, scaledH) + 'px';
      vp.style.overflow = 'auto';
    }
  });
}

window.addEventListener('resize', () => applyMapScale(document));

function buildDynamicMapGrid(zones, mode, powerById, clickable) {
  const placed = zones.filter(z => z.grid_x != null && z.grid_y != null);
  if (!placed.length) return '<div style="padding:12px;color:var(--text-dim)">No zones have been placed on a map yet.</div>';

  const xs = placed.map(z => z.grid_x), ys = placed.map(z => z.grid_y);
  const minX = Math.min(...xs) - 1, maxX = Math.max(...xs) + 1;
  const minY = Math.min(...ys) - 1, maxY = Math.max(...ys) + 1;
  const byCoord = new Map(placed.map(z => [`${z.grid_x},${z.grid_y}`, z]));

  const W = maxX - minX + 1, H = maxY - minY + 1;
  const colTmpl = Array.from({ length: 2 * W - 1 }, (_, i) => i % 2 ? '12px' : '110px').join(' ');
  const rowTmpl = Array.from({ length: 2 * H - 1 }, (_, i) => i % 2 ? '12px' : '72px').join(' ');
  const col = x => 2 * (x - minX) + 1;
  const row = y => 2 * (y - minY) + 1;

  let html = `<div style="display:grid;grid-template-columns:${colTmpl};grid-template-rows:${rowTmpl}">`;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const z = byCoord.get(`${x},${y}`);
      const gs = `grid-column:${col(x)};grid-row:${row(y)}`;
      if (!z) { html += `<div style="${gs}"></div>`; continue; }
      const marker = z.marker ? `<span class="map-marker-badge">${z.marker}</span>` : '';
      let cls = 'bigmap-tile';
      let sub = '';
      const colorStyle = zoneColorStyle(z);
      let powerStatus = null;
      if (mode === 'power') {
        const p = powerById?.get(z.id);
        const cpGen = bigMapGenerators.find(g => (g.map_zone_id || g.zone_id) === z.id && g.generator_type === 'city_plant');
        if (cpGen) {
          // Power plant tile: Draw Request / Capacity
          const totalDemand = Number(cpGen.total_demand_w ?? 0);
          const overdrawn = totalDemand > cpGen.capacity_kw;
          const cpStatus = Number(cpGen.capacity_kw) === 0 ? 'offline' : cpGen.status !== 'online' ? 'offline' : overdrawn ? 'overloaded' : '';
          cls = `bigmap-tile bm-power-plant${cpStatus ? ' bm-power-' + cpStatus : ''}`;
          powerStatus = cpStatus || 'plant';
          sub = `<div style="font-size:13px;line-height:1;margin-top:1px">⚡</div><div style="font-size:9px;opacity:0.9">${totalDemand.toFixed(0)}/${cpGen.capacity_kw.toFixed(0)}W</div>`;
        } else {
          // Regular tile: Supply / Draw Request (zone + attached JBs)
          const jbs = powerJbByOutdoor.get(z.id) || [];
          // Draw Request = outdoor zone direct load + all building loads routed through JBs
          const jbRequest  = jbs.reduce((s, jb) => s + Number(jb.zone_load_w ?? 0), 0);
          const zoneRequest = p?.loadKw ?? 0;
          const totalRequest = zoneRequest + jbRequest;
          // Supply = actual city plant allocation to this area:
          //   outdoor zone supply + per-JB allocation (delivered to buildings + JB leftover)
          const jbSupply   = jbs.reduce((s, jb) => s + Number(jb.zone_supply_w ?? 0) + Number(jb.remaining_kw ?? 0), 0);
          const zoneSupply  = p?.availableKw ?? 0;
          const totalSupply  = zoneSupply + jbSupply;
          const status = p ? p.status : 'unpowered';
          const isBrownout = totalRequest > 0 && totalSupply > 0 && totalRequest > totalSupply + 0.01;
          // A wired-but-idle zone (a generator link but zero draw) reports
          // 'powered' from the sim; render it dark like the Building Interior
          // view so only tiles with live electricity glow.
          const idle = p && totalRequest === 0 && status !== 'offline';
          const effectiveStatus = isBrownout ? 'overloaded' : idle ? 'unpowered' : status;
          cls = `bigmap-tile bm-power-${effectiveStatus}`;
          powerStatus = effectiveStatus;
          if (totalRequest > 0) {
            const supplyStr = totalSupply > 0 ? totalSupply.toFixed(0) : '0';
            const zIdSafe = z.id.replace(/'/g, "\\'");
            sub = `<div style="font-size:9px;opacity:0.8;margin-top:2px">${supplyStr}/${totalRequest.toFixed(0)}W <span onclick="event.stopPropagation();editZoneMaxCapacity('${zIdSafe}')" style="cursor:pointer;opacity:0.6" title="Edit max capacity">✏</span></div>`;
          } else if (p) {
            const zIdSafe = z.id.replace(/'/g, "\\'");
            sub = `<div style="font-size:9px;opacity:0.5;margin-top:2px">idle <span onclick="event.stopPropagation();editZoneMaxCapacity('${zIdSafe}')" style="cursor:pointer;opacity:0.6" title="Edit max capacity">✏</span></div>`;
          } else {
            sub = `<div style="font-size:9px;opacity:0.6;margin-top:2px">no power</div>`;
          }
        }
      }
      const click = clickable ? ` onclick="bigMapTileClick('${z.id}')"` : '';
      let tileStyle = mode === 'power' ? gs : gs + colorStyle;
      if (powerStatus) tileStyle += `;color:${powerTileTextColor(powerStatus)}`;
      const ico = zoneIconHtml(z);
      html += `<div class="${cls}" style="${tileStyle}" title="${z.id}"${click}><div>${ico}${marker}${z.name}${sub}</div></div>`;
    }
  }

  // Connection indicators (non-interactive — visual only)
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      const a = byCoord.get(`${x},${y}`), b = byCoord.get(`${x+1},${y}`);
      const gs = `grid-column:${col(x)+1};grid-row:${row(y)}`;
      if (a && b) {
        const linked = a.exits?.east === b.id || b.exits?.west === a.id;
        html += `<div class="conn conn-h ${linked ? 'conn-linked' : 'conn-open'}" style="${gs}"><span class="ln"></span></div>`;
      } else {
        html += `<div class="conn conn-h" style="${gs}"></div>`;
      }
    }
  }
  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const a = byCoord.get(`${x},${y}`), b = byCoord.get(`${x},${y+1}`);
      const gs = `grid-column:${col(x)};grid-row:${row(y)+1}`;
      if (a && b) {
        const linked = a.exits?.south === b.id || b.exits?.north === a.id;
        html += `<div class="conn conn-v ${linked ? 'conn-linked' : 'conn-open'}" style="${gs}"><span class="ln"></span></div>`;
      } else {
        html += `<div class="conn conn-v" style="${gs}"></div>`;
      }
    }
  }

  html += '</div>';
  return html;
}

function luminanceTextColor(bgHex) {
  const hex = (bgHex || '').replace('#', '');
  if (hex.length !== 6) return '#eeeeee';
  const r = parseInt(hex.slice(0,2),16), g = parseInt(hex.slice(2,4),16), b = parseInt(hex.slice(4,6),16);
  const lum = (0.299*r + 0.587*g + 0.114*b) / 255;
  return lum > 0.5 ? '#111111' : '#eeeeee';
}

// Named zone-icon SVG (flags.icon → road_* connectors, statue, …) as a mask filled
// with currentColor, matching how the game minimap draws it. Served from the game
// client's assets (the /dev route only shadows /dev paths, so /assets resolves there).
function zoneIconHtml(zone) {
  const name = zone?.flags?.icon;
  if (!name) return '';
  const url = `/assets/zone-icons/${name}.svg`;
  return `<span style="display:inline-block;width:15px;height:15px;background:currentColor;` +
    `-webkit-mask:url(${url}) center/contain no-repeat;mask:url(${url}) center/contain no-repeat;` +
    `vertical-align:middle;margin-right:3px"></span>`;
}

function zoneColorStyle(colorOrZone, _unused) {
  // Accept either a zone object {color, bg_color} or a legacy bare color string.
  const zone = (colorOrZone && typeof colorOrZone === 'object') ? colorOrZone : { color: colorOrZone };
  const bgHex = (zone.bg_color || '').replace('#', '');
  const fgHex = (zone.color || '').replace('#', '');
  if (!bgHex && !fgHex) return '';
  let parts = [];
  if (bgHex && bgHex.length === 6) {
    const r = parseInt(bgHex.slice(0,2),16), g = parseInt(bgHex.slice(2,4),16), b = parseInt(bgHex.slice(4,6),16);
    parts.push(`background:#${bgHex}`);
    const br = `rgb(${Math.min(255,Math.round(r+(255-r)*0.5))},${Math.min(255,Math.round(g+(255-g)*0.5))},${Math.min(255,Math.round(b+(255-b)*0.5))})`;
    parts.push(`border-color:${br}`);
    if (!fgHex || fgHex.length !== 6) {
      // Auto text color from luminance of bg
      const lum = (0.299*r + 0.587*g + 0.114*b) / 255;
      const t = Math.round((1 - lum) * 255);
      parts.push(`color:rgb(${t},${t},${t})`);
    }
  }
  if (fgHex && fgHex.length === 6) {
    parts.push(`color:#${fgHex}`);
  }
  return ';' + parts.join(';');
}

// Zone ids with a staged-but-unpublished delete, so map tiles can flag them
// with an X until the deletion is published or reverted. Reads the shared
// staging pendingChanges list (kept fresh by updateStagingBadge).
function zonesPendingDelete() {
  const changes = (typeof pendingChanges !== 'undefined' && Array.isArray(pendingChanges)) ? pendingChanges : [];
  return new Set(changes.filter(c => c.entityType === 'zone' && c.changeType === 'delete').map(c => c.entityId));
}

// Suggest a zone marker color that matches the hue/saturation/lightness
// character of a map's existing zone colors but is visually distinct from
// every one of them — so newly placed zones blend into the map's palette
// instead of colliding with a neighbor's color or always defaulting to the
// same swatch.
function hexToRgbArr(hex) {
  hex = (hex || '').replace('#', '');
  if (hex.length !== 6) return null;
  return [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16)];
}

function rgbArrToHex([r,g,b]) {
  return '#' + [r,g,b].map(v => Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');
}

function rgbToHsl([r,g,b]) {
  r/=255; g/=255; b/=255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b);
  let h=0, s=0, l=(max+min)/2;
  if (max !== min) {
    const d = max-min;
    s = l>0.5 ? d/(2-max-min) : d/(max+min);
    switch (max) {
      case r: h=(g-b)/d+(g<b?6:0); break;
      case g: h=(b-r)/d+2; break;
      default: h=(r-g)/d+4;
    }
    h /= 6;
  }
  return [h*360, s, l];
}

function hslToRgbArr(h, s, l) {
  h = ((h % 360) + 360) / 360;
  if (s === 0) return [l*255, l*255, l*255];
  const hue2rgb = (p,q,t) => {
    if (t<0) t+=1;
    if (t>1) t-=1;
    if (t<1/6) return p+(q-p)*6*t;
    if (t<1/2) return q;
    if (t<2/3) return p+(q-p)*(2/3-t)*6;
    return p;
  };
  const q = l<0.5 ? l*(1+s) : l+s-l*s;
  const p = 2*l-q;
  return [hue2rgb(p,q,h+1/3)*255, hue2rgb(p,q,h)*255, hue2rgb(p,q,h-1/3)*255];
}

function colorDistance(hexA, hexB) {
  const a = hexToRgbArr(hexA), b = hexToRgbArr(hexB);
  if (!a || !b) return Infinity;
  return Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2);
}

function suggestZoneColor(existingHexColors) {
  const existing = (existingHexColors || []).filter(c => hexToRgbArr(c));
  if (!existing.length) return MAP_PALETTE[Math.floor(Math.random() * MAP_PALETTE.length)];

  const hsls = existing.map(c => rgbToHsl(hexToRgbArr(c)));
  const avgS = hsls.reduce((s,h) => s+h[1], 0) / hsls.length;
  const avgL = hsls.reduce((s,h) => s+h[2], 0) / hsls.length;

  const MIN_DISTANCE = 70; // RGB euclidean distance treated as "visually distinct"
  const GOLDEN_ANGLE = 137.508; // spreads candidate hues evenly around the wheel
  let hue = hsls[hsls.length - 1][0];
  let best = null, bestDist = -1;
  for (let i = 0; i < 36; i++) {
    hue += GOLDEN_ANGLE;
    const s = Math.min(0.95, Math.max(0.25, avgS + (Math.random()-0.5)*0.15));
    const l = Math.min(0.8, Math.max(0.25, avgL + (Math.random()-0.5)*0.15));
    const candidate = rgbArrToHex(hslToRgbArr(hue, s, l));
    const minDist = Math.min(...existing.map(c => colorDistance(candidate, c)));
    if (minDist >= MIN_DISTANCE) return candidate;
    if (minDist > bestDist) { bestDist = minDist; best = candidate; }
  }
  return best;
}

function mapLegendHtml(mode) {
  return mode === 'power'
    ? `<span><span class="legend-swatch" style="background:rgba(80,160,255,0.4);border:1px solid rgba(100,180,255,0.9)"></span>⚡ City Plant</span>
       <span><span class="legend-swatch" style="background:rgba(20,200,100,0.4);border:1px solid rgba(20,220,110,0.75)"></span>Powered</span>
       <span><span class="legend-swatch" style="background:rgba(255,165,0,0.5);border:1px solid rgba(255,165,0,0.85)"></span>Overloaded</span>
       <span><span class="legend-swatch" style="background:rgba(220,40,60,0.4);border:1px solid rgba(230,50,70,0.85)"></span>Offline</span>
       <span><span class="legend-swatch" style="background:rgba(40,40,60,0.55);border:1px solid rgba(80,80,110,0.4)"></span>Unpowered</span>`
    : `<span><span class="legend-swatch" style="background:rgba(57,255,143,0.4)"></span>Safe</span>
       <span><span class="legend-swatch" style="background:rgba(245,230,66,0.4)"></span>Low</span>
       <span><span class="legend-swatch" style="background:rgba(255,154,60,0.4)"></span>Medium</span>
       <span><span class="legend-swatch" style="background:rgba(255,59,92,0.4)"></span>High/Lethal</span>`;
}

let bigMapZones = [];
let bigMapPowerData = [];
let bigMapGenerators = [];
let powerJbByOutdoor = new Map(); // outdoor zone id → [jb generators attached via building]
let bigMapOverlayData = null;
let bigMapOverlayZ = 0;
let bigMapOverlayMode = 'zones';

async function openBigMap(mode = 'zones') {
  bigMapOverlayMode = mode;
  const calls = [API('/maps/map_world').catch(() => null)];
  if (mode === 'power') {
    calls.push(API('/environment/power/map').catch(() => []));
    calls.push(API('/environment/power/generators').catch(() => []));
  }
  const [mapData, powerMap, generators] = await Promise.all(calls);
  if (!mapData || mapData.error) { toast("Couldn't load map data", true); return; }
  bigMapOverlayData = {
    map: mapData.map,
    zones: new Map((mapData.zones || []).map(z => [z.id, { ...z, exits: z.exits || {}, grid_z: z.grid_z ?? 0 }])),
    children: mapData.children || [],
  };
  for (const [zoneId, overrides] of _mapPendingOverrides) {
    const z = bigMapOverlayData.zones.get(zoneId);
    if (z) _applyMapOverride(z, overrides);
  }
  bigMapZones = mapData.zones || [];
  bigMapPowerData = Array.isArray(powerMap) ? powerMap : [];
  bigMapGenerators = Array.isArray(generators) ? generators : [];
  bigMapOverlayZ = 0;
  await updateStagingBadge();  // keep pending-delete X markers accurate
  document.getElementById('bigmap-title').textContent = mode === 'power' ? 'Power Grid' : (mapData.map?.name || 'City Map');
  renderBigMapOverlay();
  document.getElementById('bigmap-overlay').classList.add('active');
}

function renderBigMapOverlay() {
  const d = bigMapOverlayData;
  if (!d) return;
  const powerById = new Map(bigMapPowerData.map(p => [p.zoneId, p]));
  const all = [...d.zones.values()];
  const floors = [...new Set(all.map(z => z.grid_z ?? 0))].sort((a, b) => a - b);
  const onFloor = all.filter(z => (z.grid_z ?? 0) === bigMapOverlayZ && z.grid_x != null && z.grid_y != null);

  // Floor selector
  const floorCtrl = document.getElementById('bigmap-floor-ctrl');
  if (floorCtrl) {
    const floorBtns = floors.length > 1
      ? `<button class="action-btn" onclick="changeBigMapFloor(-1)">▾</button>
         <span style="font-size:11px;color:var(--text-dim);min-width:48px;text-align:center">z = ${bigMapOverlayZ}</span>
         <button class="action-btn" onclick="changeBigMapFloor(1)">▴</button>`
      : '';
    floorCtrl.innerHTML = mapScaleControlHtml() + floorBtns;
  }

  if (!onFloor.length) {
    document.getElementById('bigmap-grid').innerHTML = '<div style="padding:24px;color:var(--text-dim);text-align:center">No zones on this floor.</div>';
    document.getElementById('bigmap-legend').innerHTML = mapLegendHtml(bigMapOverlayMode);
    return;
  }

  const xs = onFloor.map(z => z.grid_x), ys = onFloor.map(z => z.grid_y);
  const minX = Math.min(...xs) - 1, maxX = Math.max(...xs) + 1;
  const minY = Math.min(...ys) - 1, maxY = Math.max(...ys) + 1;
  const byCoord = new Map(onFloor.map(z => [`${z.grid_x},${z.grid_y}`, z]));
  const pendingDelete = zonesPendingDelete();

  const W = maxX - minX + 1, H = maxY - minY + 1;
  const colTmpl = Array.from({ length: 2 * W - 1 }, (_, i) => i % 2 ? '14px' : '110px').join(' ');
  const rowTmpl = Array.from({ length: 2 * H - 1 }, (_, i) => i % 2 ? '14px' : '76px').join(' ');
  const col = x => 2 * (x - minX) + 1, row = y => 2 * (y - minY) + 1;

  let html = `<div style="display:inline-grid;grid-template-columns:${colTmpl};grid-template-rows:${rowTmpl}">`;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const z = byCoord.get(`${x},${y}`);
      const gs = `grid-column:${col(x)};grid-row:${row(y)}`;
      if (!z) { html += `<div style="${gs}"></div>`; continue; }

      const marker = z.marker ? `<span class="map-marker-badge">${z.marker}</span>` : '';
      const child = d.children.find(c => c.parent_zone_id === z.id);
      const dive = child ? `<span class="map-dive-btn" title="Has interior">⤵</span>` : '';
      const exitDirs = Object.keys(z.exits || {});
      const exHtml = exitDirs.length
        ? `<div class="cell-exits">${exitDirs.map(dir => {
            const sym = dir === 'up' ? '▲' : dir === 'down' ? '▼' : dir[0].toUpperCase();
            return `<span class="${(dir === 'up' || dir === 'down') ? 'ex-vert' : ''}">${sym}</span>`;
          }).join(' ')}</div>`
        : '';

      let cls = 'bigmap-tile';
      let colorStyle = zoneColorStyle(z);
      let powerSub = '';
      if (bigMapOverlayMode === 'power') {
        colorStyle = '';
        const p = powerById.get(z.id);
        const cpGen = bigMapGenerators.find(g => (g.map_zone_id || g.zone_id) === z.id && g.generator_type === 'city_plant');
        if (cpGen) {
          const used = Number(cpGen.total_demand_w ?? 0);
          const overdrawn = used > Number(cpGen.capacity_kw);
          const cpStatus = Number(cpGen.capacity_kw) === 0 ? 'offline' : cpGen.status !== 'online' ? 'offline' : overdrawn ? 'overloaded' : '';
          cls = `bigmap-tile bm-power-plant${cpStatus ? ' bm-power-' + cpStatus : ''}`;
          powerSub = `<div style="font-size:9px;opacity:0.9;margin-top:2px">⚡ ${used.toFixed(0)}/${Number(cpGen.capacity_kw).toFixed(0)}W</div>`;
        } else {
          const zStatus = p ? p.status : 'unpowered';
          // Wired-but-idle zones report 'powered' with zero draw — render them
          // dark (unpowered) so only tiles with live electricity glow.
          const effStatus = (p && (p.loadKw ?? 0) === 0 && zStatus !== 'offline') ? 'unpowered' : zStatus;
          cls = `bigmap-tile bm-power-${effStatus}`;
          if (p) powerSub = `<div style="font-size:9px;opacity:0.8;margin-top:2px">${(p.loadKw??0).toFixed(1)}W load / ${(p.availableKw??0).toFixed(1)}W draw</div>`;
        }
      }

      if (pendingDelete.has(z.id)) cls += ' bm-pending-delete';

      html += `<div class="${cls}" style="${gs}${colorStyle}" title="${z.id}" onclick="bigMapTileClick('${z.id}')"><div>${dive}${zoneIconHtml(z)}${marker}${z.name}${exHtml}${powerSub}</div></div>`;
    }
  }

  // Connection slots — same rendering as renderMapOverview
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      const a = byCoord.get(`${x},${y}`), b = byCoord.get(`${x+1},${y}`);
      const gs = `grid-column:${col(x)+1};grid-row:${row(y)}`;
      if (a && b) {
        const aToB = a.exits?.east === b.id, bToA = b.exits?.west === a.id;
        if (aToB && bToA) html += `<div class="conn conn-h conn-linked" style="${gs}"><span class="ln"></span></div>`;
        else if (aToB || bToA) html += `<div class="conn conn-h conn-oneway" style="${gs}">${aToB ? '▸' : '◂'}</div>`;
        else html += `<div class="conn conn-h conn-open" style="${gs}"><span class="ln"></span></div>`;
      } else html += `<div class="conn conn-h" style="${gs}"></div>`;
    }
  }
  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const a = byCoord.get(`${x},${y}`), b = byCoord.get(`${x},${y+1}`);
      const gs = `grid-column:${col(x)};grid-row:${row(y)+1}`;
      if (a && b) {
        const aToB = a.exits?.south === b.id, bToA = b.exits?.north === a.id;
        if (aToB && bToA) html += `<div class="conn conn-v conn-linked" style="${gs}"><span class="ln"></span></div>`;
        else if (aToB || bToA) html += `<div class="conn conn-v conn-oneway" style="${gs}">${aToB ? '▾' : '▴'}</div>`;
        else html += `<div class="conn conn-v conn-open" style="${gs}"><span class="ln"></span></div>`;
      } else html += `<div class="conn conn-v" style="${gs}"></div>`;
    }
  }

  html += '</div>';
  const gridEl = document.getElementById('bigmap-grid');
  gridEl.innerHTML = wrapMapScale(html);
  document.getElementById('bigmap-legend').innerHTML = mapLegendHtml(bigMapOverlayMode);
  applyMapScale(gridEl);
}

function changeBigMapFloor(delta) {
  bigMapOverlayZ += delta;
  renderBigMapOverlay();
}

function closeBigMap() {
  document.getElementById('bigmap-overlay').classList.remove('active');
}

async function bigMapTileClick(zoneId) {
  closeBigMap();
  closeSettingsPanel();
  const data = await PANELS.zones.fetch();
  allRecords = Array.isArray(data) ? data : (data.zones || []);
  currentPanel = 'zones';
  mapZoneEditReturn = true;
  editRecord(zoneId);
}

// Push the just-saved display fields into the map's in-memory working copy and
// re-render, so the tile updates without refetching (which would discard
// unsaved layout edits). Reads the still-open form inputs before closeEdit.
function applyZoneEditToMap(zoneId) {
  const z = mapOverview?.zones.get(zoneId);
  if (!z) return;
  const g = id => document.getElementById(id);
  if (g('f-name')) z.name = g('f-name').value;
  if (g('f-marker')) z.marker = g('f-marker').value.trim() || null;
  if (g('f-color')) z.color = g('f-color').value.trim() || null;
  if (g('f-bg_color')) z.bg_color = g('f-bg_color').value.trim() || null;
  z.exits = { ...zoneEditExitsState };
  renderMapOverview();
}

// Live-patches the mapOverview zone with the current form color/marker values and
// re-renders the map if it's visible. Called from the color/marker edit controls so
// tile colors update immediately without needing to save first.
function _liveMapColorUpdate() {
  if (!currentRecord?.id || !mapOverview) return;
  const z = mapOverview.zones.get(currentRecord.id);
  if (!z) return;
  const color = document.getElementById('f-color')?.value.trim() || null;
  const bg_color = document.getElementById('f-bg_color')?.value.trim() || null;
  const marker = document.getElementById('f-marker')?.value.trim() || null;
  z.color = color;
  z.bg_color = bg_color;
  z.marker = marker;
  if (currentPanel === 'maps' || mapZoneEditReturn) renderMapOverview();
}

// Click a zone tile on the map overview to edit it in the zone editor, then
// return to the map after saving (mapZoneEditReturn).
async function mapTileEditClick(zoneId) {
  closeSettingsPanel();
  const data = await PANELS.zones.fetch();
  allRecords = Array.isArray(data) ? data : (data.zones || []);
  currentPanel = 'zones';
  mapZoneEditReturn = true;
  editRecord(zoneId);
}

// Dive into the interior map that hangs off a building zone.
function diveInto(zoneId) {
  if (!mapsGuard()) return;
  const child = mapOverview.children.find(c => c.parent_zone_id === zoneId);
  if (child) loadMapOverview(child.id);
  else toast('No interior map hangs off this zone.', true);
}

// ─── MAPS OVERVIEW EDITOR ─────────────────────────────────────────────────
// A grid view of one map at a time (one floor at a time), where you create
// zones in empty cells, drag zones to re-position, draw connections between
// adjacent cells, and dive into building interiors. Layout edits accumulate
// in a working copy and are saved in one batch; broken connections block the
// save (server is authoritative, this is the live pre-check).
const MAP_PALETTE = ['#39ff8f','#28e5ff','#f5e642','#ff9a3c','#ff3b5c','#9b59b6','#7ed321','#888888'];
const MAP_DIR3D = { north:[0,-1,0], south:[0,1,0], east:[1,0,0], west:[-1,0,0], up:[0,0,1], down:[0,0,-1], in:[0,0,0], out:[0,0,0] };
const MAP_OPP = { north:'south', south:'north', east:'west', west:'east', up:'down', down:'up', in:'out', out:'in' };

let pendingZonePlacement = null;  // {map_id,grid_x,grid_y,grid_z} for a new zone
let mapZoneEditReturn = false;    // true when zone editor was opened from the map overview
let zoneEnemyEditReturn = null;   // zoneId when enemy editor was opened from zone edit panel
let mapsList = [];
let mapOverview = null;           // { map, zones:Map, unplaced:Map, unplacedInterior:Map, children, z }
let _regionNames = null;          // Map<region_id, name>, lazily fetched — labels the exterior editor
let mapDragId = null;
let mapDragFromTray = false;
let mapDragIsInterior = false;
let mapViewTab = 'exterior';      // 'exterior' | 'interior'
let mapExteriorMapId = null;      // last-loaded exterior map id, so we can return from interior view
let mapSelectedInteriorId = null;
let mapInteriorsList = [];        // interior maps (parent_zone_id != null)
let _exteriorBuildingZones = [];  // building zones from the exterior map, for interior tab dropdown
let _mapPendingOverrides = new Map(); // zoneId → {color,bg_color,marker,terrain} for staged-but-unpublished zone edits

// Re-apply one staged override onto a freshly-fetched map zone, so staged edits stay
// visible across tab switches / map reloads (the DB doesn't have them until Publish).
// Display fields assign onto the zone; `terrain` merges into flags. Cleared per-zone on
// publish/reject (staging.js), so a published/discarded edit stops overriding.
function _applyMapOverride(z, overrides) {
  const { terrain, runway, icon, district, ...display } = overrides;
  Object.assign(z, display);   // color / bg_color / marker (present only for runway edits)
  if (terrain !== undefined || runway !== undefined || icon !== undefined || district !== undefined) {
    z.flags = { ...(z.flags || {}) };
    if (terrain !== undefined) { if (terrain) z.flags.terrain = terrain; else delete z.flags.terrain; }
    if (runway !== undefined) { if (runway) z.flags.runway = runway; else delete z.flags.runway; }
    if (icon !== undefined) { if (icon) z.flags.icon = icon; else delete z.flags.icon; }
    if (district !== undefined) { if (district) z.flags.district = district; else delete z.flags.district; }
  }
}
let mapSafeZoneMode = false;   // true while the Sanctuary paint tool is active
let mapSafeZonePainting = false; // mouse button down, actively dragging a paint stroke
let mapSafeZonePaintValue = null; // true = attaching the sanctuary tag this stroke, false = clearing
let mapSafeZonePendingSaves = new Set(); // zoneIds with an in-flight/queued save, to avoid dupe writes mid-drag

function mapsGuard() { return true; }

function toggleSafeZoneMode() {
  mapSafeZoneMode = !mapSafeZoneMode;
  if (mapSafeZoneMode) { mapPaintMode = false; mapTerrainMode = false; mapMoveBuildingMode = false; mapNewBuildingMode = false; mapDistrictMode = false; }
  renderMapOverview();
}

// Persists a single zone's sanctuary tag through the atomic single-tag PATCH
// (server-side jsonb merge — safe during drag strokes, no read-merge-write
// race). Fire-and-forget; the tile is already updated optimistically.
async function _saveSafeZone(zoneId, value) {
  if (mapSafeZonePendingSaves.has(zoneId)) return;
  mapSafeZonePendingSaves.add(zoneId);
  try {
    const r = await API(`/zones/${zoneId}/tag`, 'PATCH', { name: 'sanctuary', value: value ? true : null });
    if (r?.error) toast(r.error, true);
    else updateStagingBadge();
  } finally {
    mapSafeZonePendingSaves.delete(zoneId);
  }
}

function safeZonePaintStart(e, zoneId) {
  e.preventDefault();
  const z = mapOverview?.zones.get(zoneId);
  if (!z) return;
  mapSafeZonePainting = true;
  mapSafeZonePaintValue = !z.flags?.sanctuary;
  z.flags = { ...(z.flags || {}) };
  if (mapSafeZonePaintValue) z.flags.sanctuary = true; else delete z.flags.sanctuary;
  renderMapOverview();
  _saveSafeZone(zoneId, mapSafeZonePaintValue);
}

function safeZonePaintOver(zoneId) {
  if (!mapSafeZonePainting) return;
  const z = mapOverview?.zones.get(zoneId);
  if (!z || !!z.flags?.sanctuary === mapSafeZonePaintValue) return;
  z.flags = { ...(z.flags || {}) };
  if (mapSafeZonePaintValue) z.flags.sanctuary = true; else delete z.flags.sanctuary;
  renderMapOverview();
  _saveSafeZone(zoneId, mapSafeZonePaintValue);
}

document.addEventListener('mouseup', () => { mapSafeZonePainting = false; });

// ─── COLOUR PAINTER ────────────────────────────────────────────────────────
// A floating paint tool over the map: brush + flood-fill-by-colour, a full
// swatch palette + arbitrary picker, a whole-map luminance slider, and a
// luminance normaliser. Parallels the Safe-Zone tool but writes zone bg_color.
let mapPaintMode = false;
let mapPaintTool = 'brush';       // 'brush' | 'fill'
let mapPaintColor = '#e05555';    // the colour currently loaded on the brush
let mapPainting = false;          // mouse down, dragging a brush stroke
let mapPaintPending = new Set();  // zoneIds with an in-flight bg_color save
let mapLumBase = null;            // Map(zoneId->hex) snapshot taken at slider drag start
let mapSatBase = null;            // Map(zoneId->hex) snapshot taken at saturation slider drag start

const PAINT_SWATCHES = [
  '#2f86cc','#1fb5aa','#d9a83a','#b56fbf','#4bb36a','#c9a884','#e08a4a','#e85aa0',
  '#8e6fd0','#9a8a4f','#e5822a','#7c6a4a','#8b9097','#cf6a2e','#e05555','#39ff8f',
  '#ff9a3c','#f5e642','#7ed321','#28e5ff','#3f8fff','#9b59b6','#ff5ea8','#ffffff',
  '#c8c8c8','#909090','#585858','#202020',
];

function togglePaintMode() {
  mapPaintMode = !mapPaintMode;
  if (mapPaintMode) { mapSafeZoneMode = false; mapTerrainMode = false; mapMoveBuildingMode = false; mapNewBuildingMode = false; mapDistrictMode = false; mapUndoStack = []; mapRedoStack = []; }
  renderMapOverview();
}
function setPaintTool(t) { mapPaintTool = t; renderMapOverview(); }
function setPaintColor(hex) { mapPaintColor = hex; renderMapOverview(); }

// Locate the live grid tile element for a zone (null if off-screen / a gap).
function _tileEl(z) {
  const g = document.getElementById('bigmap-grid-scroll');
  const el = g && g.querySelector(`[data-map-cell="${z.grid_x},${z.grid_y}"]`);
  return (el && el.classList.contains('bigmap-tile')) ? el : null;
}

// Paint a hex straight onto a tile's DOM (bg + auto border + auto text) without
// a full re-render — keeps brush/slider strokes smooth.
function _applyTileColor(el, hex) {
  const rgb = hexToRgbArr(hex); if (!rgb) return;
  const [r, g, b] = rgb;
  el.style.background = hex;
  el.style.borderColor = `rgb(${Math.min(255,Math.round(r+(255-r)*0.5))},${Math.min(255,Math.round(g+(255-g)*0.5))},${Math.min(255,Math.round(b+(255-b)*0.5))})`;
  const lum = (0.299*r + 0.587*g + 0.114*b) / 255;
  const t = Math.round((1 - lum) * 255);
  el.style.color = `rgb(${t},${t},${t})`;
}

// Fire-and-forget single-tile save (brush).
async function _savePaintColor(zoneId, hex) {
  if (mapPaintPending.has(zoneId)) return;
  mapPaintPending.add(zoneId);
  try {
    const r = await API(`/zones/${zoneId}`, 'PUT', { bg_color: hex });
    if (r?.error) toast(r.error, true); else updateStagingBadge();
  } finally { mapPaintPending.delete(zoneId); }
}

// Sequential bulk save (fill / luminance / normalise / text) — avoids a burst
// of hundreds of concurrent PUTs. `field` is the zone column to persist.
async function _saveColorsBulk(ids, field = 'bg_color') {
  for (const id of ids) {
    const z = mapOverview?.zones.get(id);
    if (!z) continue;
    const r = await API(`/zones/${id}`, 'PUT', { [field]: z[field] });
    if (r?.error) { toast(r.error, true); break; }
  }
  updateStagingBadge();
}

// Eyedropper: sample a tile's colour onto the brush, then drop back to Brush.
function mapPickColor(zoneId) {
  const z = mapOverview?.zones.get(zoneId);
  if (!z || !z.bg_color) return;
  mapPaintColor = z.bg_color;
  mapPaintTool = 'brush';
  renderMapOverview();
}

function paintStart(e, zoneId) { e.preventDefault(); _pushUndo(); mapPainting = true; _brushTile(zoneId); }
function paintOver(zoneId) { if (mapPainting) _brushTile(zoneId); }
function _brushTile(zoneId) {
  const z = mapOverview?.zones.get(zoneId);
  if (!z || z.bg_color === mapPaintColor) return;
  z.bg_color = mapPaintColor;
  const el = _tileEl(z); if (el) _applyTileColor(el, mapPaintColor);
  _savePaintColor(zoneId, mapPaintColor);
}
document.addEventListener('mouseup', () => {
  const wasPainting = mapPainting;
  mapPainting = false;
  if (wasPainting && mapPaintMode) renderMapOverview(); // refresh Undo/Redo state after a brush stroke
});

// Flood-fill: from the clicked tile, spread to orthogonally-adjacent tiles that
// share its colour, stopping at any different colour or empty cell (barrier).
async function mapFloodFill(startId) {
  const start = mapOverview?.zones.get(startId);
  if (!start) return;
  const from = (start.bg_color || '').toLowerCase();
  if (from === mapPaintColor.toLowerCase()) return;
  _pushUndo();
  const z0 = mapOverview.z;
  const byCoord = new Map();
  for (const z of mapOverview.zones.values())
    if ((z.grid_z ?? 0) === z0 && z.grid_x != null && z.grid_y != null)
      byCoord.set(`${z.grid_x},${z.grid_y}`, z);
  const queue = [start], seen = new Set([startId]), hit = [];
  while (queue.length) {
    const z = queue.shift(); hit.push(z);
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const n = byCoord.get(`${z.grid_x+dx},${z.grid_y+dy}`);
      if (n && !seen.has(n.id) && (n.bg_color || '').toLowerCase() === from) { seen.add(n.id); queue.push(n); }
    }
  }
  for (const z of hit) z.bg_color = mapPaintColor;
  renderMapOverview();
  await _saveColorsBulk(hit.map(z => z.id));
}

// Shift a hex's HSL lightness by delta (clamped), returning a new hex.
function adjustHexLightness(hex, delta) {
  const rgb = hexToRgbArr(hex); if (!rgb) return hex;
  const [h, s, l] = rgbToHsl(rgb);
  return rgbArrToHex(hslToRgbArr(h, s, Math.max(0, Math.min(1, l + delta))));
}

// Whole-map luminance slider. Live-previews against a snapshot taken at drag
// start (so dragging is non-cumulative), commits + resets on release.
function mapLumInput(val) {
  if (!mapOverview) return;
  const delta = parseInt(val, 10) / 200; // -100..100 → -0.5..+0.5 lightness
  const z0 = mapOverview.z;
  if (!mapLumBase) {
    _pushUndo();
    mapLumBase = new Map();
    for (const z of mapOverview.zones.values())
      if ((z.grid_z ?? 0) === z0 && z.grid_x != null && z.grid_y != null && z.bg_color)
        mapLumBase.set(z.id, z.bg_color);
  }
  for (const [id, base] of mapLumBase) {
    const z = mapOverview.zones.get(id); if (!z) continue;
    const hex = adjustHexLightness(base, delta);
    z.bg_color = hex;
    const el = _tileEl(z); if (el) _applyTileColor(el, hex);
  }
  const lbl = document.getElementById('map-lum-val');
  if (lbl) lbl.textContent = (delta >= 0 ? '+' : '') + Math.round(delta * 100);
}
async function mapLumCommit() {
  if (!mapLumBase) return;
  const ids = [...mapLumBase.keys()];
  mapLumBase = null;
  renderMapOverview(); // resets slider + refreshes Undo/Redo state
  await _saveColorsBulk(ids);
}

// Shift a hex's HSL saturation by delta (clamped), returning a new hex.
function adjustHexSaturation(hex, delta) {
  const rgb = hexToRgbArr(hex); if (!rgb) return hex;
  const [h, s, l] = rgbToHsl(rgb);
  return rgbArrToHex(hslToRgbArr(h, Math.max(0, Math.min(1, s + delta)), l));
}

// Whole-map saturation slider. Mirrors the luminance slider: live-previews
// against a snapshot taken at drag start, commits + resets on release.
function mapSatInput(val) {
  if (!mapOverview) return;
  const delta = parseInt(val, 10) / 200; // -100..100 → -0.5..+0.5 saturation
  const z0 = mapOverview.z;
  if (!mapSatBase) {
    _pushUndo();
    mapSatBase = new Map();
    for (const z of mapOverview.zones.values())
      if ((z.grid_z ?? 0) === z0 && z.grid_x != null && z.grid_y != null && z.bg_color)
        mapSatBase.set(z.id, z.bg_color);
  }
  for (const [id, base] of mapSatBase) {
    const z = mapOverview.zones.get(id); if (!z) continue;
    const hex = adjustHexSaturation(base, delta);
    z.bg_color = hex;
    const el = _tileEl(z); if (el) _applyTileColor(el, hex);
  }
  const lbl = document.getElementById('map-sat-val');
  if (lbl) lbl.textContent = (delta >= 0 ? '+' : '') + Math.round(delta * 100);
}
async function mapSatCommit() {
  if (!mapSatBase) return;
  const ids = [...mapSatBase.keys()];
  mapSatBase = null;
  renderMapOverview(); // resets slider + refreshes Undo/Redo state
  await _saveColorsBulk(ids);
}

// Normalise luminance: pull every tile's lightness to the map's mean, keeping
// each tile's hue + saturation, so no tile reads much darker/lighter than another.
async function mapNormalizeLum() {
  if (!mapOverview) return;
  const z0 = mapOverview.z;
  const tiles = [...mapOverview.zones.values()].filter(z =>
    (z.grid_z ?? 0) === z0 && z.grid_x != null && z.grid_y != null && z.bg_color);
  if (!tiles.length) return;
  _pushUndo();
  let sum = 0;
  for (const z of tiles) sum += rgbToHsl(hexToRgbArr(z.bg_color))[2];
  const target = sum / tiles.length;
  for (const z of tiles) {
    const [h, s] = rgbToHsl(hexToRgbArr(z.bg_color));
    z.bg_color = rgbArrToHex(hslToRgbArr(h, s, target));
  }
  renderMapOverview();
  await _saveColorsBulk(tiles.map(z => z.id));
}

// Bake each tile's text colour to the readable black/white for its background
// luminance (luminanceTextColor), replacing any custom fg colour. Persists the
// `color` column so text renders identically everywhere (no auto-derive needed).
async function mapRecalcText() {
  if (!mapOverview) return;
  const z0 = mapOverview.z;
  const tiles = [...mapOverview.zones.values()].filter(z =>
    (z.grid_z ?? 0) === z0 && z.grid_x != null && z.grid_y != null && z.bg_color);
  if (!tiles.length) return;
  _pushUndo();
  for (const z of tiles) z.color = luminanceTextColor(z.bg_color);
  renderMapOverview();
  await _saveColorsBulk(tiles.map(z => z.id), 'color');
}

// Randomise the whole-map palette: give every distinct colour in use a fresh
// hue spaced evenly around the wheel (random offset + shuffled, so no two
// conflict), at ONE shared random saturation, preserving each colour's original
// lightness. Repaints map-wide by colour group (all floors).
async function mapRandomizeColors() {
  if (!mapOverview) return;
  const tiles = [...mapOverview.zones.values()].filter(z => z.bg_color && z.grid_x != null && z.grid_y != null);
  if (!tiles.length) return;
  _pushUndo();
  const used = [...new Set(tiles.map(z => z.bg_color.toLowerCase()))];
  const n = used.length;
  const sat = 0.45 + Math.random() * 0.3;         // one saturation for every colour
  const base = Math.random() * 360;
  const hues = Array.from({ length: n }, (_, i) => (base + i * 360 / n) % 360);
  for (let i = hues.length - 1; i > 0; i--) {     // shuffle which group gets which hue
    const j = Math.floor(Math.random() * (i + 1));
    [hues[i], hues[j]] = [hues[j], hues[i]];
  }
  const remap = new Map();
  used.forEach((hex, i) => {
    const rgb = hexToRgbArr(hex);
    const l = rgb ? rgbToHsl(rgb)[2] : 0.5;        // keep this colour's lightness
    remap.set(hex, rgbArrToHex(hslToRgbArr(hues[i], sat, l)));
  });
  for (const z of tiles) z.bg_color = remap.get(z.bg_color.toLowerCase());
  renderMapOverview();
  await _saveColorsBulk(tiles.map(z => z.id));
}

// ─── UNDO / REDO ───────────────────────────────────────────────────────────
// 3-step complete history for painter actions. Each action calls _pushUndo()
// before mutating; a snapshot is the {bg_color,color} of every placed tile, so
// undo/redo restores the exact prior map state and re-saves only what changed.
let mapUndoStack = [];
let mapRedoStack = [];

function _snapshotMap() {
  const snap = {};
  if (!mapOverview) return snap;
  for (const z of mapOverview.zones.values())
    if (z.grid_x != null && z.grid_y != null) snap[z.id] = { bg_color: z.bg_color, color: z.color };
  return snap;
}
function _pushUndo() {
  mapUndoStack.push(_snapshotMap());
  if (mapUndoStack.length > 3) mapUndoStack.shift();
  mapRedoStack = [];
}
async function _restoreSnapshot(snap) {
  const changed = [];
  for (const [id, c] of Object.entries(snap)) {
    const z = mapOverview?.zones.get(id);
    if (!z) continue;
    if (z.bg_color !== c.bg_color || z.color !== c.color) {
      z.bg_color = c.bg_color; z.color = c.color; changed.push(id);
    }
  }
  renderMapOverview();
  for (const id of changed) {
    const z = mapOverview.zones.get(id);
    const r = await API(`/zones/${id}`, 'PUT', { bg_color: z.bg_color, color: z.color });
    if (r?.error) { toast(r.error, true); break; }
  }
  updateStagingBadge();
}
async function mapUndo() {
  if (!mapUndoStack.length) return;
  mapRedoStack.push(_snapshotMap());
  if (mapRedoStack.length > 3) mapRedoStack.shift();
  await _restoreSnapshot(mapUndoStack.pop());
}
async function mapRedo() {
  if (!mapRedoStack.length) return;
  mapUndoStack.push(_snapshotMap());
  if (mapUndoStack.length > 3) mapUndoStack.shift();
  await _restoreSnapshot(mapRedoStack.pop());
}

// Drag-to-move state for the painter popup. Position persists across the
// frequent map re-renders (paintPanelHtml reads it), so the card stays put.
let mapPaintPanelPos = null;  // {left, top} px once moved; null = default corner
let _paintDrag = null;        // {dx, dy} grab offset during an active drag

function paintPanelDragStart(e) {
  if (e.target.closest('button, input')) return; // let the ✕ / picker work
  const panel = document.getElementById('map-paint-panel');
  if (!panel) return;
  e.preventDefault();
  const rect = panel.getBoundingClientRect();
  _paintDrag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
  mapPaintPanelPos = { left: rect.left, top: rect.top }; // pin to left/top so it won't jump
  panel.style.right = 'auto';
  panel.style.left = rect.left + 'px';
  panel.style.top = rect.top + 'px';
  document.addEventListener('mousemove', _paintPanelDragMove);
  document.addEventListener('mouseup', _paintPanelDragEnd);
}
function _paintPanelDragMove(e) {
  const panel = document.getElementById('map-paint-panel');
  if (!_paintDrag || !panel) return;
  const left = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, e.clientX - _paintDrag.dx));
  const top = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, e.clientY - _paintDrag.dy));
  mapPaintPanelPos = { left, top };
  panel.style.left = left + 'px';
  panel.style.top = top + 'px';
}
function _paintPanelDragEnd() {
  _paintDrag = null;
  document.removeEventListener('mousemove', _paintPanelDragMove);
  document.removeEventListener('mouseup', _paintPanelDragEnd);
}

// The floating painter card (position:fixed so it hovers over the map;
// drag its header to reposition — mapPaintPanelPos survives re-renders).
function paintPanelHtml() {
  const sw = PAINT_SWATCHES.map(c =>
    `<button onclick="setPaintColor('${c}')" title="${c}" style="width:100%;aspect-ratio:1;border-radius:3px;border:2px solid ${c.toLowerCase() === mapPaintColor.toLowerCase() ? '#fff' : 'transparent'};background:${c};cursor:pointer;padding:0"></button>`
  ).join('');
  const toolBtn = (t, label) => `<button onclick="setPaintTool('${t}')" style="flex:1;font-size:11px;padding:5px 6px;border-radius:4px;cursor:pointer;border:1px solid var(--border);background:${mapPaintTool === t ? 'var(--accent)' : 'var(--bg3)'};color:${mapPaintTool === t ? '#111' : 'var(--text)'}">${label}</button>`;
  const pos = mapPaintPanelPos ? `left:${mapPaintPanelPos.left}px;top:${mapPaintPanelPos.top}px` : `top:100px;right:28px`;
  return `<div id="map-paint-panel" style="position:fixed;${pos};z-index:60;width:216px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 28px #000a;padding:11px;font-size:12px">
    <div onmousedown="paintPanelDragStart(event)" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:9px;cursor:move;user-select:none">
      <strong style="font-size:12px;letter-spacing:.3px">⠿ 🎨 Colour Painter</strong>
      <button onclick="togglePaintMode()" title="Close painter" style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:15px;line-height:1">✕</button>
    </div>
    <div style="display:flex;gap:6px;margin-bottom:7px">
      <button onclick="mapUndo()" title="Undo (3-step history)" ${mapUndoStack.length ? '' : 'disabled'} style="flex:1;font-size:11px;padding:4px 6px;border-radius:4px;cursor:${mapUndoStack.length ? 'pointer' : 'default'};border:1px solid var(--border);background:var(--bg3);color:var(--text);opacity:${mapUndoStack.length ? 1 : 0.4}">↶ Undo${mapUndoStack.length ? ` (${mapUndoStack.length})` : ''}</button>
      <button onclick="mapRedo()" title="Redo" ${mapRedoStack.length ? '' : 'disabled'} style="flex:1;font-size:11px;padding:4px 6px;border-radius:4px;cursor:${mapRedoStack.length ? 'pointer' : 'default'};border:1px solid var(--border);background:var(--bg3);color:var(--text);opacity:${mapRedoStack.length ? 1 : 0.4}">↷ Redo${mapRedoStack.length ? ` (${mapRedoStack.length})` : ''}</button>
    </div>
    <div style="display:flex;gap:6px;margin-bottom:9px">${toolBtn('brush', '🖌 Brush')}${toolBtn('fill', '🪣 Fill')}${toolBtn('pick', '💧 Pick')}</div>
    <div style="display:flex;align-items:center;gap:7px;margin-bottom:7px">
      <span style="width:24px;height:24px;flex-shrink:0;border-radius:4px;background:${mapPaintColor};border:1px solid #0007"></span>
      <input type="color" value="${mapPaintColor}" onchange="setPaintColor(this.value)" title="Pick any colour" style="width:100%;height:26px;background:none;border:none;cursor:pointer;padding:0">
    </div>
    <div style="display:grid;grid-template-columns:repeat(8,1fr);gap:4px;margin-bottom:11px">${sw}</div>
    <div style="border-top:1px solid var(--border);padding-top:9px">
      <label style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-dim);margin-bottom:2px"><span>Map luminance</span><span id="map-lum-val" style="color:var(--text)">0</span></label>
      <input id="map-lum-slider" type="range" min="-100" max="100" value="0" oninput="mapLumInput(this.value)" onchange="mapLumCommit()" style="width:100%">
      <label style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-dim);margin-top:9px;margin-bottom:2px"><span>Map saturation</span><span id="map-sat-val" style="color:var(--text)">0</span></label>
      <input id="map-sat-slider" type="range" min="-100" max="100" value="0" oninput="mapSatInput(this.value)" onchange="mapSatCommit()" style="width:100%">
      <button onclick="mapNormalizeLum()" title="Pull every tile to the map's mean lightness (keeps hue)" style="width:100%;margin-top:9px;font-size:11px;padding:6px;border-radius:4px;border:1px solid var(--border);background:var(--bg3);color:var(--text);cursor:pointer">⚖ Normalise luminance</button>
      <button onclick="mapRecalcText()" title="Set every tile's text colour to readable black/white by its background luminance" style="width:100%;margin-top:6px;font-size:11px;padding:6px;border-radius:4px;border:1px solid var(--border);background:var(--bg3);color:var(--text);cursor:pointer">🔤 Recalc text colours</button>
      <button onclick="mapRandomizeColors()" title="Give each used colour a fresh, mutually-distinct random hue at one shared random saturation (whole map)" style="width:100%;margin-top:6px;font-size:11px;padding:6px;border-radius:4px;border:1px solid var(--border);background:var(--bg3);color:var(--text);cursor:pointer">🎲 Randomize palette</button>
    </div>
    <div style="font-size:10px;color:var(--text-dim);margin-top:9px;line-height:1.45">${mapPaintTool === 'fill' ? 'Click a tile to flood-fill its same-colour region (stops at other colours).' : mapPaintTool === 'pick' ? 'Click a tile to sample its colour onto the brush.' : 'Click-drag across tiles to paint.'}</div>
  </div>`;
}

// ─── TERRAIN PAINTER ─────────────────────────────────────────────────────────
// Paint flags.terrain (the ground-surface SSOT — zoneTerrain prefers it) onto tiles.
// Mirrors the colour painter: brush / fill / pick / rectangle-select, drag-safe
// single-tag PATCH so strokes stage into the Changes panel. Road tiles auto-tile their
// connector piece from adjacent road tiles, previewed live in the grid.
// The brush palette, loaded from content/map/terrain.json via /map/palette. It was
// a hardcoded table here, a second one in the game minimap and a third in the
// tablet — and they had drifted: this one painted redrock #9e4a30 while the game
// drew #6f3524, so on 2,996 tiles the map an author painted was not the map a
// player saw. One file now, fetched once. (Populated by ensureTerrainPalette();
// empty until then, which only means the swatch row renders late.)
let TERRAIN_TYPES = [];
let _terrainPalette = null;
async function ensureTerrainPalette() {
  if (_terrainPalette) return _terrainPalette;
  const p = await API('/map/palette').catch(() => null);
  _terrainPalette = p && p.terrains ? p : { terrains: {} };
  TERRAIN_TYPES = Object.entries(_terrainPalette.terrains).map(([key, t]) => ({ key, label: t.label || key, fill: t.fill }));
  rebuildTerrainFillIndex();
  return _terrainPalette;
}
// Runway pseudo-surfaces. A runway isn't a flags.terrain value — it's a directional
// centreline strip written as flags.runway ('ns'|'ew') + flags.icon (runway_ns/_ew)
// plus the canonical yellow-marking / asphalt / bar-marker presentation, exactly how
// the seeded runway tiles carry it, so runwayFor() and the map icon both pick it up.
// These keys live in the terrain palette but branch away from the flags.terrain path.
const RUNWAY_KEYS = {
  runway_ns: { runway: 'ns', icon: 'runway_ns', marker: '┃', label: 'Runway ↕ N-S' },
  runway_ew: { runway: 'ew', icon: 'runway_ew', marker: '━', label: 'Runway ↔ E-W' },
};
const RUNWAY_COLOR = '#f5d400', RUNWAY_BG = '#2b2b2b';
const isRunwayKey = k => !!RUNWAY_KEYS[k];
// Brush-preview fills only — what a swatch looks like and what a tile turns into
// the instant you paint it, before the derive pass has run. The AUTHORITY for what
// a tile looks like is its spec (zone_derived), which the editor reads directly.
let TERRAIN_FILL_BY_KEY = Object.fromEntries(Object.keys(RUNWAY_KEYS).map(k => [k, RUNWAY_COLOR]));
function rebuildTerrainFillIndex() {
  TERRAIN_FILL_BY_KEY = Object.fromEntries([
    ...TERRAIN_TYPES.map(t => [t.key, t.fill]),
    ...Object.keys(RUNWAY_KEYS).map(k => [k, RUNWAY_COLOR]),
  ]);
}
// The surface key a tile currently carries (runway pseudo-key wins over flags.terrain),
// so paint guards can no-op when a tile is already the brushed surface.
function _tileSurfaceKey(z) {
  if (z?.flags?.runway === 'ns') return 'runway_ns';
  if (z?.flags?.runway === 'ew') return 'runway_ew';
  return z?.flags?.terrain || null;
}
// Apply a palette surface (terrain string OR runway pseudo-key) to a tile's flags and
// presentation in place; erase clears whatever surface it holds. Switching cleanly wipes
// any prior terrain/runway before stamping the new one, and sheds the runway's yellow
// colour/marker when a tile stops being a runway.
function _setTileSurface(tile, key, erase) {
  const wasRunway = !!tile.flags?.runway;
  tile.flags = { ...(tile.flags || {}) };
  delete tile.flags.terrain; delete tile.flags.runway;
  if (/^runway_/.test(tile.flags.icon || '')) delete tile.flags.icon;
  if (!erase && key && isRunwayKey(key)) {
    const r = RUNWAY_KEYS[key];
    tile.flags.runway = r.runway; tile.flags.icon = r.icon;
    tile.color = RUNWAY_COLOR; tile.bg_color = RUNWAY_BG; tile.marker = r.marker;
    return;
  }
  if (!erase && key) tile.flags.terrain = key;
  if (wasRunway) { tile.color = null; tile.bg_color = null; tile.marker = null; } // drop runway livery
}
let mapTerrainMode = true;   // Maps tab opens in the terrain editor by default
let mapTerrainType = 'road';
let mapTerrainTool = 'brush';       // 'brush' | 'fill' | 'pick' | 'rect'
let mapTerrainPanelPos = null;      // {left, top} once the palette is dragged; null = default top/right anchor
let mapTerrainPainting = false;
let mapTerrainPending = new Set();
let mapTerrainRectStart = null;     // {x,y} anchor while dragging a rectangle
let mapEditingRegionId = null;      // the region the exterior editor is scoped to; painted/conjured tiles auto-join it
let _terrainOutlined = [];          // tile els currently showing the rect preview outline

function toggleTerrainMode() {
  mapTerrainMode = !mapTerrainMode;
  if (mapTerrainMode) { mapPaintMode = false; mapSafeZoneMode = false; mapMoveBuildingMode = false; mapNewBuildingMode = false; mapDistrictMode = false; }
  renderMapOverview();
}
function setTerrainType(k) { mapTerrainType = k; renderMapOverview(); }
function setTerrainTool(t) { mapTerrainTool = t; mapTerrainRectStart = null; renderMapOverview(); }
// Re-scope the exterior editor to another region (the toolbar dropdown). Today every
// region's tiles are already loaded, so this just re-filters + re-frames the grid.
// When regions load one at a time this becomes the place to fetch the chosen one.
function selectEditRegion(id) { window.worldSelectedRegionId = id || null; renderMapOverview(); }

// Working-copy mirror of server zoneTerrain (authored terrain wins, then inference) so the
// dev preview matches what the game renders — including tiles that were never painted, so
// the editor shows the current terrain (water/grass/road/dock) instead of blank.
function mapZoneTerrain(z) {
  if (!z) return null;
  if (z.flags?.terrain) return z.flags.terrain;
  if (z.flags?.pier) return 'dock';
  if (/^(road_|runway_)/.test(z.flags?.icon || '')) return 'road';
  // Green-dominant bg = parkland/grass (same test as server zoneTerrain).
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(z.bg_color || '');
  if (m) {
    const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
    if (g > r && g - b >= 15 && g >= 45) return 'grass';
  }
  return null;
}
// The connector SVG name for a road tile from adjacent road terrain (mirror of the server
// roadConnector). `byCoord` maps "x,y" → zone on the current floor.
function mapRoadConnector(z, byCoord) {
  if (!z || z.grid_x == null) return 'road_x';
  // Paved road and dirt_road auto-tile together (mirror of server isRoadTerrain).
  const isRoad = (x, y) => { const t = mapZoneTerrain(byCoord.get(`${x},${y}`)); return t === 'road' || t === 'dirt_road'; };
  let s = '';
  if (isRoad(z.grid_x, z.grid_y - 1)) s += 'n';
  if (isRoad(z.grid_x + 1, z.grid_y)) s += 'e';
  if (isRoad(z.grid_x, z.grid_y + 1)) s += 's';
  if (isRoad(z.grid_x - 1, z.grid_y)) s += 'w';
  return s ? 'road_' + s : 'road_x';
}

// Terrain-aware tile visual — the same surface the terrain painter shows (fills + road
// auto-tile + runway icon), with buildings kept as their authored colour + name. Returns
// { style, inner } so the Move-Building / New-Building overlays render on the real terrain
// map (streets, water, ground) with buildings on it, instead of a flat authored-colour view.
function _terrainTileVisual(z, byCoord) {
  const marker = z.marker ? `<span class="map-marker-badge">${z.marker}</span>` : '';
  if (_isBuildingTile(z)) return { style: zoneColorStyle(z), inner: `${marker}${z.name}` };
  const rwKey = _tileSurfaceKey(z);
  if (isRunwayKey(rwKey)) {
    const iconName = RUNWAY_KEYS[rwKey].icon;
    const ico = `<span style="display:inline-block;width:26px;height:26px;background:currentColor;-webkit-mask:url(/assets/zone-icons/${iconName}.svg) center/contain no-repeat;mask:url(/assets/zone-icons/${iconName}.svg) center/contain no-repeat"></span>`;
    return { style: `;background:${RUNWAY_BG};color:${RUNWAY_COLOR}`, inner: `${ico}${marker}` };
  }
  const terr = mapZoneTerrain(z);
  if (terr === 'road' || terr === 'dirt_road') {
    const conn = mapRoadConnector(z, byCoord);
    const ico = `<span style="display:inline-block;width:26px;height:26px;background:currentColor;-webkit-mask:url(/assets/zone-icons/${conn}.svg) center/contain no-repeat;mask:url(/assets/zone-icons/${conn}.svg) center/contain no-repeat"></span>`;
    const dirt = terr === 'dirt_road';
    return { style: `;background:${dirt ? TERRAIN_FILL_BY_KEY.dirt_road : TERRAIN_FILL_BY_KEY.road};color:${dirt ? '#c9a86a' : '#f2c53d'}`, inner: `${ico}${marker}` };
  }
  const fill = terr ? TERRAIN_FILL_BY_KEY[terr] : null;
  const style = fill ? `;background:${fill};color:${luminanceTextColor(fill)}` : zoneColorStyle(z);
  return { style, inner: `${marker}${z.name}` };
}

// Stage a terrain edit through the Changes panel (nothing goes live until you Publish).
// Routes through the staging-aware API() as a full-flags zone PUT — the shape the staging
// publisher replays via apiUpdateZone. The working copy already holds the tile's COMPLETE
// flags (apiGetMap returns the whole jsonb) with the terrain change applied, so we send
// those verbatim: no server read-merge-write, and no other flags are dropped. The staging
// queue coalesces repeated edits to the same zone into one pending change.
// A paint changes what a tile LOOKS like, and what a tile looks like now comes
// from zone_derived — which only a derive pass writes. Without this the painter
// would stage a change nobody could see until the next deploy, which is a painter
// nobody would use. Debounced, because a drag stroke is dozens of saves and derive
// is whole-map by design (spec §7.2).
let _deriveTimer = null;
function _scheduleDerive() {
  clearTimeout(_deriveTimer);
  _deriveTimer = setTimeout(async () => {
    await API('/map/derive', 'POST', {}).catch(() => null);
    if (typeof renderMapOverview === 'function') renderMapOverview();
  }, 500);
}

async function _saveTerrain(zoneId) {
  _scheduleDerive();
  if (mapTerrainPending.has(zoneId)) return;
  mapTerrainPending.add(zoneId);
  try {
    const z = mapOverview?.zones.get(zoneId);
    if (!z) return;
    // Remember the staged value so the preview survives tab switches / map reloads
    // (the DB won't carry it until Publish). Runway tiles also carry presentation
    // (icon + yellow/asphalt/marker) beyond flags.terrain; only tiles that are (or
    // just stopped being) a runway record those extra keys, so a plain terrain paint
    // never clobbers an unrelated tile's icon/colour.
    const prev = _mapPendingOverrides.get(zoneId) || {};
    const ov = { ...prev, terrain: z.flags?.terrain || null };
    let body = { flags: { ...(z.flags || {}) } };
    if (z.flags?.runway || prev.runway || prev.icon) {
      ov.runway = z.flags?.runway || null;
      ov.icon = /^runway_/.test(z.flags?.icon || '') ? z.flags.icon : null;
      ov.color = z.color ?? null; ov.bg_color = z.bg_color ?? null; ov.marker = z.marker ?? null;
      body = { ...body, color: z.color ?? null, bg_color: z.bg_color ?? null, marker: z.marker ?? null };
    }
    _mapPendingOverrides.set(zoneId, ov);
    const r = await API(`/zones/${zoneId}`, 'PUT', body);
    if (r?.error) toast(r.error, true); else updateStagingBadge();
  } finally { mapTerrainPending.delete(zoneId); }
}

// Paint a tile's terrain fill straight onto its DOM (bg only) during a stroke — the full
// re-render on mouse-up fixes neighbour road connectors.
function _terrainTileDom(zoneId) {
  const z = mapOverview?.zones.get(zoneId);
  const el = _tileEl(z);
  if (!el) return;
  const surf = _tileSurfaceKey(z);
  el.style.background = surf ? TERRAIN_FILL_BY_KEY[surf] : '';
}

function _terrainBrush(zoneId, erase) {
  const z = mapOverview?.zones.get(zoneId);
  if (!z) return;
  const val = erase ? null : mapTerrainType;
  if (_tileSurfaceKey(z) === (val || null)) return;
  _setTileSurface(z, val, erase);
  // Painting a tile folds it into the region being edited if it isn't in one yet
  // (legacy tiles predating the region system). Erasing doesn't claim ownership.
  if (val && mapEditingRegionId && !z.flags.region_id) z.flags.region_id = mapEditingRegionId;
  _terrainTileDom(zoneId);
  _saveTerrain(zoneId);
  if (val) _wireExistingTile(zoneId); // painting a surface also connects the tile; erasing leaves exits alone
}

// ─── PAINT NEW TERRAIN INTO EXISTENCE ────────────────────────────────────────
// In terrain mode an empty ("black") grid cell is paintable: brushing/rect-filling
// it conjures a minimal ground zone carrying the brushed surface, auto-wired to its
// orthogonal non-building neighbours (mirroring drag-place). Wildlands surfaces
// become wilds ground (district + radiation); anything else is plain ground.
const TERRAIN_TILE_DEFAULTS = {
  dirt_road: { color: '#c9a86a', bg: '#241d13', ambient: 'outdoors', name: 'Dirt Track', desc: 'A graded dirt lane, packed hard by tyres and scored with old ruts. No kerb, no paint — just where the driving wears the ground down.' },
  redrock: { color: '#b5744a', bg: '#2a1c16', ambient: 'wasteland', name: 'The Rust Flats', wild: true, rad: 30, desc: 'Cracked red hardpan runs out flat to a rust-colored horizon. Wind-scoured rock, grit, and nothing that grows.' },
  scrub:   { color: '#8f9256', bg: '#242a1c', ambient: 'wasteland', name: 'Dead Scrub',      wild: true, rad: 25, desc: "Low grey brush claws up through broken ground — brittle, half-dead stuff that shivers when there's no wind behind it." },
  ash:     { color: '#8a857f', bg: '#211f1d', ambient: 'wasteland', name: 'The Ash Barrens', wild: true, rad: 35, desc: "A grey waste of settled ash, soft and deep, printed with the tracks of things that passed and didn't come back." },
  marsh:   { color: '#5f7a4a', bg: '#1c241a', ambient: 'wasteland', name: 'The Toxic Marsh', wild: true, rad: 30, desc: 'Murky water pools between hummocks of sick green weed, slicked with a chemical sheen that never quite settles.' },
};
function _newTerrainTile(id, x, y, z, terr, mapId) {
  const rw = RUNWAY_KEYS[terr];
  const d = TERRAIN_TILE_DEFAULTS[terr] || {};
  const flags = {};
  if (rw) { flags.runway = rw.runway; flags.icon = rw.icon; } else { flags.terrain = terr; }
  if (d.wild) { flags.district = 'wilds'; flags.radiation = d.rad; }
  if (mapEditingRegionId) flags.region_id = mapEditingRegionId;  // a conjured tile joins the edited region
  return {
    id, name: rw ? 'Runway' : (d.name || (TERRAIN_TYPES.find(t => t.key === terr)?.label || 'Ground') + ' Ground'),
    description: rw ? 'Yellow runway markings stripe the asphalt, chipped and faded but still obeyed out of habit.' : (d.desc || ''),
    exits: {}, ambient_events: [], ambient_theme: rw ? 'outdoors' : (d.ambient || 'city'),
    audio_theme_id: null, flags, grid_x: x, grid_y: y, grid_z: z, map_id: mapId,
    color: rw ? RUNWAY_COLOR : (d.color || null), bg_color: rw ? RUNWAY_BG : (d.bg || null),
    marker: rw ? rw.marker : null, parent_zone: null,
  };
}
// Paint a cell's fill straight onto its DOM (works for the create-cell too, which
// _tileEl skips because it isn't yet a .bigmap-tile).
function _paintCellBg(x, y, terr) {
  const g = document.getElementById('bigmap-grid-scroll');
  const el = g && g.querySelector(`[data-map-cell="${x},${y}"]`);
  if (el) el.style.background = terr ? TERRAIN_FILL_BY_KEY[terr] : '';
}
// Stage a newly-conjured tile as a zone create, with its final exits.
async function _stageCreatedTile(id) {
  const t = mapOverview?.zones.get(id);
  if (!t || mapTerrainPending.has(id)) return;
  mapTerrainPending.add(id);
  try {
    const r = await API('/zones', 'POST', {
      id, name: t.name, description: t.description, exits: t.exits, ambient_events: [],
      ambient_theme: t.ambient_theme, audio_theme_id: null, flags: t.flags, marker: null,
      color: t.color, bg_color: t.bg_color, parent_zone: null,
      map_id: t.map_id, grid_x: t.grid_x, grid_y: t.grid_y, grid_z: t.grid_z,
    });
    if (r?.error) toast(r.error, true);
  } finally { mapTerrainPending.delete(id); }
}
// Conjure one tile at an empty cell: add it locally, wire reciprocal exits to
// orthogonal non-building neighbours, return the neighbour ids whose exits changed.
// District-tile id for a conjured cell. z=0 keeps the flat zone_district_<x>_<y>
// scheme; other floors get a _z<z> suffix so a sub-level tile (e.g. z-1 water)
// doesn't collide with the surface tile that shares its (x,y).
function _districtTileId(x, y, z) {
  return z ? `zone_district_${x}_${y}_z${z}` : `zone_district_${x}_${y}`;
}
function _conjureTileLocal(x, y) {
  const o = mapOverview;
  const id = _districtTileId(x, y, o.z);
  if (o.zones.has(id)) return null;
  if ([...o.zones.values()].some(z => (z.grid_z ?? 0) === o.z && z.grid_x === x && z.grid_y === y)) return null;
  const tile = _newTerrainTile(id, x, y, o.z, mapTerrainType, o.map.id);
  o.zones.set(id, tile);
  const changedNeighbours = [];
  for (const [dir, off] of Object.entries(MAP_DIR3D)) {
    if (off[2] !== 0) continue; // orthogonal only; up/down stay manual
    const n = [...o.zones.values()].find(z => z.id !== id && (z.grid_z ?? 0) === o.z && z.grid_x === x + off[0] && z.grid_y === y + off[1]);
    if (!n || _isBuildingTile(n) || _crossesWildsBoundary(tile, n)) continue; // no building, no curtain crossing
    tile.exits[dir] = n.id;
    n.exits = { ...(n.exits || {}) }; n.exits[MAP_OPP[dir]] = id;
    changedNeighbours.push(n.id);
  }
  return { id, changedNeighbours };
}
// The repaint-path analogue of the conjure wiring above: an EXISTING tile that
// gets painted also gets any MISSING orthogonal exit filled reciprocally to its
// non-building neighbours. Fill-only (never overwrites a slot that already points
// somewhere), so it's safe to run on every brush/fill stroke and idempotent. This
// is what makes painting terrain over already-created tiles connect them, not just
// conjured-from-empty ones. PUTs the tile and any neighbour it touched.
async function _wireExistingTile(zoneId) {
  const o = mapOverview;
  const tile = o?.zones.get(zoneId);
  if (!tile || _isBuildingTile(tile)) return;
  let tileChanged = false;
  const touched = new Set();
  for (const [dir, off] of Object.entries(MAP_DIR3D)) {
    if (off[2] !== 0) continue; // orthogonal only; up/down stay manual
    const n = [...o.zones.values()].find(z => z.id !== zoneId && (z.grid_z ?? 0) === (tile.grid_z ?? 0) && z.grid_x === tile.grid_x + off[0] && z.grid_y === tile.grid_y + off[1]);
    if (!n || _isBuildingTile(n) || _crossesWildsBoundary(tile, n)) continue; // edge, building, or curtain crossing
    if (tile.exits?.[dir] == null) { tile.exits = { ...(tile.exits || {}) }; tile.exits[dir] = n.id; tileChanged = true; }
    if (n.exits?.[MAP_OPP[dir]] == null) { n.exits = { ...(n.exits || {}) }; n.exits[MAP_OPP[dir]] = zoneId; touched.add(n.id); }
  }
  if (tileChanged) await API(`/zones/${zoneId}`, 'PUT', { exits: tile.exits });
  for (const nid of touched) { const n = o.zones.get(nid); if (n) await API(`/zones/${nid}`, 'PUT', { exits: n.exits }); }
}
// Brush a single empty cell into existence (during a stroke): local conjure + DOM
// tint now, stage the create + neighbour exit updates.
async function _terrainCreateAt(x, y) {
  const plan = _conjureTileLocal(x, y);
  if (!plan) return;
  _paintCellBg(x, y, mapTerrainType);
  await _stageCreatedTile(plan.id);
  for (const nid of plan.changedNeighbours) {
    const n = mapOverview.zones.get(nid);
    if (n) await API(`/zones/${nid}`, 'PUT', { exits: n.exits });
  }
  updateStagingBadge();
}
function terrainCreateStart(e, x, y) {
  e.preventDefault();
  if (mapTerrainTool === 'pick' || mapTerrainTool === 'fill') return; // nothing to sample/flood on empty
  if (mapTerrainTool === 'rect') { mapTerrainRectStart = { x, y }; return; }
  mapTerrainPainting = true;
  _terrainCreateAt(x, y);
}
function terrainCreateOver(e, x, y) {
  if (mapTerrainTool === 'rect') { if (mapTerrainRectStart) _terrainRectOutline(mapTerrainRectStart, { x, y }); return; }
  if (mapTerrainPainting) _terrainCreateAt(x, y);
}
function terrainCreateEnd(x, y) {
  if (mapTerrainTool === 'rect' && mapTerrainRectStart) _terrainRectCommitXY(x, y);
}

function terrainPaintStart(e, zoneId) {
  e.preventDefault();
  if (mapTerrainTool === 'pick') { terrainPick(zoneId); return; }
  if (mapTerrainTool === 'fill') { terrainFill(zoneId); return; }
  if (mapTerrainTool === 'rect') { terrainRectStart(zoneId); return; }
  mapTerrainPainting = true;
  _terrainBrush(zoneId, e.ctrlKey || e.metaKey || e.button === 2);
}
function terrainPaintOver(e, zoneId) {
  if (mapTerrainTool === 'rect') { if (mapTerrainRectStart) terrainRectOver(zoneId); return; }
  if (mapTerrainPainting) _terrainBrush(zoneId, e.ctrlKey || e.metaKey);
}
function terrainPaintEnd(zoneId) {
  if (mapTerrainTool === 'rect' && mapTerrainRectStart) terrainRectCommit(zoneId);
}

// Eyedropper: sample a tile's terrain (authored or inferred) onto the brush, then drop to Brush.
function terrainPick(zoneId) {
  const z = mapOverview?.zones.get(zoneId);
  const t = _tileSurfaceKey(z) || mapZoneTerrain(z);   // runway pseudo-key wins over the road inference
  if (!t) return;
  mapTerrainType = t;
  mapTerrainTool = 'brush';
  renderMapOverview();
}

// Flood-fill: from the clicked tile, spread to same-terrain orthogonal neighbours.
async function terrainFill(startId) {
  const start = mapOverview?.zones.get(startId);
  if (!start) return;
  const from = mapZoneTerrain(start);   // match the VISIBLE surface (authored or inferred)
  if (from === mapTerrainType) return;
  const z0 = mapOverview.z;
  const byCoord = new Map();
  for (const z of mapOverview.zones.values())
    if ((z.grid_z ?? 0) === z0 && z.grid_x != null) byCoord.set(`${z.grid_x},${z.grid_y}`, z);
  const queue = [start], seen = new Set([startId]), hit = [];
  while (queue.length) {
    const z = queue.shift(); hit.push(z);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = byCoord.get(`${z.grid_x + dx},${z.grid_y + dy}`);
      if (n && !seen.has(n.id) && mapZoneTerrain(n) === from) { seen.add(n.id); queue.push(n); }
    }
  }
  for (const z of hit) _setTileSurface(z, mapTerrainType, false);
  renderMapOverview();
  for (const z of hit) await _saveTerrain(z.id);
  for (const z of hit) await _wireExistingTile(z.id); // connect the filled region, not just recolour it
}

// Rectangle-select: drag a marquee, apply the brush terrain to every covered cell at once.
function terrainRectStart(zoneId) {
  const z = mapOverview?.zones.get(zoneId);
  if (!z) return;
  mapTerrainRectStart = { x: z.grid_x, y: z.grid_y };
}
function terrainRectOver(zoneId) {
  const z = mapOverview?.zones.get(zoneId);
  if (z && mapTerrainRectStart) _terrainRectOutline(mapTerrainRectStart, { x: z.grid_x, y: z.grid_y });
}
function _terrainClearOutline() { _terrainOutlined.forEach(el => (el.style.boxShadow = '')); _terrainOutlined = []; }
function _terrainRectOutline(a, b) {
  _terrainClearOutline();
  const g = document.getElementById('bigmap-grid-scroll');
  if (!g) return;
  const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x), minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const el = g.querySelector(`[data-map-cell="${x},${y}"]`);
    // Accent, not white — every other tile cursor in this file (paint, move-building,
    // new-building) outlines with var(--accent); this one was the odd hardcode out.
    if (el && (el.classList.contains('bigmap-tile') || el.classList.contains('bm-terrain-empty'))) { el.style.boxShadow = 'inset 0 0 0 2px var(--accent)'; _terrainOutlined.push(el); }
  }
}
async function terrainRectCommit(endId) {
  const end = mapOverview?.zones.get(endId);
  if (!end) { mapTerrainRectStart = null; _terrainClearOutline(); return; }
  await _terrainRectCommitXY(end.grid_x, end.grid_y);
}
// Apply the brush to every cell in the marquee: repaint existing (non-building)
// tiles, and conjure empty cells into existence — one wired batch.
async function _terrainRectCommitXY(endX, endY) {
  const a = mapTerrainRectStart;
  mapTerrainRectStart = null;
  _terrainClearOutline();
  if (!a) return;
  const minX = Math.min(a.x, endX), maxX = Math.max(a.x, endX);
  const minY = Math.min(a.y, endY), maxY = Math.max(a.y, endY);
  const o = mapOverview, z0 = o.z;
  const at = (x, y) => [...o.zones.values()].find(z => (z.grid_z ?? 0) === z0 && z.grid_x === x && z.grid_y === y);
  const repaintIds = [], createdIds = new Set();
  // Phase 1 — repaint existing / conjure empty (no wiring yet)
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const z = at(x, y);
    if (z) {
      if (_isBuildingTile(z)) continue; // don't overwrite a building's surface
      if (_tileSurfaceKey(z) === mapTerrainType) continue;
      _setTileSurface(z, mapTerrainType, false); repaintIds.push(z.id);
    } else {
      const id = _districtTileId(x, y, z0);
      if (o.zones.has(id)) continue;
      o.zones.set(id, _newTerrainTile(id, x, y, z0, mapTerrainType, o.map.id));
      createdIds.add(id);
    }
  }
  // Phase 2 — wire every conjured tile to orthogonal non-building neighbours
  const neighbourPut = new Set();
  for (const id of createdIds) {
    const tile = o.zones.get(id);
    for (const [dir, off] of Object.entries(MAP_DIR3D)) {
      if (off[2] !== 0) continue;
      const n = at(tile.grid_x + off[0], tile.grid_y + off[1]);
      if (!n || n.id === id || _isBuildingTile(n) || _crossesWildsBoundary(tile, n)) continue;
      tile.exits[dir] = n.id;
      n.exits = { ...(n.exits || {}) }; n.exits[MAP_OPP[dir]] = id;
      if (!createdIds.has(n.id)) neighbourPut.add(n.id);
    }
  }
  renderMapOverview();
  for (const id of repaintIds) await _saveTerrain(id);
  for (const id of createdIds) await _stageCreatedTile(id);
  for (const nid of neighbourPut) { const n = o.zones.get(nid); if (n) await API(`/zones/${nid}`, 'PUT', { exits: n.exits }); }
  for (const id of repaintIds) await _wireExistingTile(id); // repainted existing tiles get connected too (created tiles already wired in Phase 2)
  updateStagingBadge();
}

document.addEventListener('mouseup', () => {
  if (!mapTerrainMode) return;
  if (mapTerrainTool === 'rect') {
    if (mapTerrainRectStart) { mapTerrainRectStart = null; _terrainClearOutline(); }
    return;
  }
  if (mapTerrainPainting) { mapTerrainPainting = false; renderMapOverview(); }
});

// Middle-mouse drag = pan the big-map grid (never paint). The capture-phase
// mousedown beats the tiles' inline paint handlers so button-1 grabs instead of
// brushing, and living on document (not the scroll node) survives the panel's
// frequent innerHTML re-renders. preventDefault also kills the OS autoscroll.
// Horizontal scroll lives on the inner .map-scale-viewport and vertical on the
// outer #list-panel, so we pan whichever ancestor actually scrolls per axis
// (walking up from the tile, not from #bigmap-grid-scroll — the viewport is a
// CHILD of it) rather than assuming one node holds both.
let _mapPan = null;
function _scrollParent(el, axis) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    const s = getComputedStyle(n);
    const ov = axis === 'x' ? s.overflowX : s.overflowY;
    const can = axis === 'x' ? n.scrollWidth > n.clientWidth : n.scrollHeight > n.clientHeight;
    if (can && (ov === 'auto' || ov === 'scroll')) return n;
  }
  return null;
}
document.addEventListener('mousedown', e => {
  if (e.button !== 1) return;
  const grid = e.target.closest && e.target.closest('#bigmap-grid-scroll');
  if (!grid) return;
  e.preventDefault();
  e.stopPropagation();
  const xEl = _scrollParent(e.target, 'x'), yEl = _scrollParent(e.target, 'y');
  if (!xEl && !yEl) return;
  _mapPan = {
    grid, x: e.clientX, y: e.clientY, xEl, yEl,
    left: xEl ? xEl.scrollLeft : 0, top: yEl ? yEl.scrollTop : 0,
  };
  grid.style.cursor = 'grabbing';
}, true);
document.addEventListener('mousemove', e => {
  if (!_mapPan) return;
  if (_mapPan.xEl) _mapPan.xEl.scrollLeft = _mapPan.left - (e.clientX - _mapPan.x);
  if (_mapPan.yEl) _mapPan.yEl.scrollTop = _mapPan.top - (e.clientY - _mapPan.y);
});
document.addEventListener('mouseup', e => {
  if (!_mapPan || e.button !== 1) return;
  _mapPan.grid.style.cursor = '';
  _mapPan = null;
});

// ─── DISTRICT PAINTER ────────────────────────────────────────────────────────
// Paints flags.district, the land-use identity a tile carries. Deliberately the
// same four tools as the terrain painter above (brush / fill / rect / pick), so a
// builder who can paint terrain can already paint districts.
//
// TWO THINGS THIS DOES THAT THE TERRAIN PAINTER DOES NOT, and both are the point:
//
// 1. It renders the RESOLVED district, not the authored one, and marks which of the
//    three it came from. server/engine/districts.js falls back to 'residential' for
//    any tile it cannot classify, so an unpainted city reads as one enormous
//    Residential Blocks — and it reads that way in the game too, silently. Showing
//    authored solid / prefix hatched / fallback faint is what makes that visible.
// 2. It never conjures a tile. Painting terrain onto an empty cell creates ground;
//    a district is an identity carried BY ground, so an empty cell has nothing to
//    carry it and stays empty.
//
// Buildings are painted too — a shop in the Redline is in the Redline — which is the
// other reason this could not just be another terrain swatch.
//
// The palette needs no content file of its own: content/districts/*.json already
// carries id + name + color, which is exactly a swatch. It arrives via GET /districts
// and is cached by ensureDistrictData() in panels/zones.js (loaded before this file).
let mapDistrictMode = false;
let mapDistrictKey = null;          // null until the palette loads; then the first district
let mapDistrictTool = 'brush';      // 'brush' | 'fill' | 'pick' | 'rect'
let mapDistrictPainting = false;
let mapDistrictRectStart = null;
let mapDistrictPanelPos = null;     // {left, top} once dragged; null = default top/right anchor
let mapDistrictPending = new Set(); // zoneIds with an in-flight save, to avoid dupe writes mid-drag
let _mapDistrictOutlined = [];

// Working-copy mirror of server districtFor() that also reports WHERE the answer came
// from. Kept beside the painter rather than reusing districtKeyFor() in panels/zones.js
// because that one answers 'which district' and this one has to answer 'and is that
// authored or is the tile just falling through', which is the whole diagnostic.
function _distResolve(z) {
  const meta = (typeof _districtMeta === 'object' && _districtMeta) || {};
  const prefix = (typeof _districtPrefix === 'object' && _districtPrefix) || {};
  const authored = z?.flags?.district;
  if (authored && meta[authored]) return { key: authored, source: 'authored' };
  const p = (z?.id || '').match(/^zone_([a-z0-9]+)/)?.[1] || '';
  if (prefix[p]) return { key: prefix[p], source: 'prefix' };
  return { key: z?.danger === 'lethal' ? 'hazard' : 'residential', source: 'fallback' };
}

function _distColor(key) {
  const meta = (typeof _districtMeta === 'object' && _districtMeta) || {};
  return meta[key]?.color || '#8b9097';
}
function _distName(key) {
  const meta = (typeof _districtMeta === 'object' && _districtMeta) || {};
  return meta[key]?.name || key || 'unassigned';
}

// Palette rows, sorted the way the districts content sorts itself.
function _distPalette() {
  const meta = (typeof _districtMeta === 'object' && _districtMeta) || {};
  return Object.entries(meta)
    .map(([key, d]) => ({ key, name: d.name || key, color: d.color || '#8b9097', sort: d.sort ?? 0 }))
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}

function toggleDistrictMode() {
  mapDistrictMode = !mapDistrictMode;
  if (mapDistrictMode) {
    mapPaintMode = false; mapTerrainMode = false; mapSafeZoneMode = false;
    mapMoveBuildingMode = false; mapNewBuildingMode = false;
    // The palette is fetched once and shared with the Zones panel; re-render when it lands.
    if (typeof ensureDistrictData === 'function' && !mapDistrictKey) {
      ensureDistrictData().then(() => {
        if (!mapDistrictKey) mapDistrictKey = _distPalette()[0]?.key || null;
        renderMapOverview();
      });
    }
  }
  mapDistrictRectStart = null;
  renderMapOverview();
}
function setDistrictKey(k) { mapDistrictKey = k || null; renderMapOverview(); }
function setDistrictTool(t) { mapDistrictTool = t; mapDistrictRectStart = null; renderMapOverview(); }

// Stage the flags.district change. Mirrors _saveTerrain: staged through API() (this is
// authored content, not a live-world action), with the value remembered in
// _mapPendingOverrides so the preview survives a tab switch before Publish.
async function _saveZoneDistrict(zoneId) {
  if (mapDistrictPending.has(zoneId)) return;
  mapDistrictPending.add(zoneId);
  try {
    const z = mapOverview?.zones.get(zoneId);
    if (!z) return;
    const prev = _mapPendingOverrides.get(zoneId) || {};
    _mapPendingOverrides.set(zoneId, { ...prev, district: z.flags?.district || null });
    const r = await API(`/zones/${zoneId}`, 'PUT', { flags: { ...(z.flags || {}) } });
    if (r?.error) toast(r.error, true); else updateStagingBadge();
  } finally { mapDistrictPending.delete(zoneId); }
}

// Repaint one tile's DOM background mid-stroke; the full re-render on mouse-up
// refreshes the panel counts.
function _distTileDom(zoneId) {
  const z = mapOverview?.zones.get(zoneId);
  const el = _tileEl(z);
  if (!el) return;
  el.style.background = _distTileStyleBg(z);
}

// Authored reads solid, inherited-from-id-prefix reads striped, fallback reads faint.
// That gradient IS the diagnostic — a floor that is mostly faint has not been painted.
function _distTileStyleBg(z) {
  const r = _distResolve(z);
  const c = _distColor(r.key);
  if (r.source === 'authored') return c;
  if (r.source === 'prefix') return `repeating-linear-gradient(45deg, ${c} 0 6px, ${c}99 6px 12px)`;
  return `${c}26`;
}

function _distBrush(zoneId, erase) {
  const z = mapOverview?.zones.get(zoneId);
  if (!z || !mapDistrictKey) return;
  const want = erase ? null : mapDistrictKey;
  if ((z.flags?.district || null) === want) return;
  z.flags = { ...(z.flags || {}) };
  if (want) z.flags.district = want; else delete z.flags.district;
  _distTileDom(zoneId);
  _saveZoneDistrict(zoneId);
}

function districtPaintStart(e, zoneId) {
  e.preventDefault();
  if (mapDistrictTool === 'pick') { districtPick(zoneId); return; }
  if (mapDistrictTool === 'fill') { districtFill(zoneId); return; }
  if (mapDistrictTool === 'rect') { districtRectStart(zoneId); return; }
  mapDistrictPainting = true;
  _distBrush(zoneId, e.ctrlKey || e.metaKey || e.button === 2);
}
function districtPaintOver(e, zoneId) {
  if (mapDistrictTool === 'rect') { if (mapDistrictRectStart) districtRectOver(zoneId); return; }
  if (mapDistrictPainting) _distBrush(zoneId, e.ctrlKey || e.metaKey);
}
function districtPaintEnd(zoneId) {
  if (mapDistrictTool === 'rect' && mapDistrictRectStart) { districtRectCommit(zoneId); return; }
  if (mapDistrictPainting) { mapDistrictPainting = false; renderMapOverview(); }
}

// Eyedropper: sample the RESOLVED district (so you can pick up what a tile is
// currently reading as, fallback included) and drop back to the brush.
function districtPick(zoneId) {
  const z = mapOverview?.zones.get(zoneId);
  if (!z) return;
  mapDistrictKey = _distResolve(z).key;
  mapDistrictTool = 'brush';
  renderMapOverview();
}

// Flood-fill across orthogonal neighbours sharing the clicked tile's RESOLVED
// district. Matching on resolved (not authored) is what lets one click claim a whole
// unpainted quarter that is currently falling through to 'residential'.
async function districtFill(startId) {
  const start = mapOverview?.zones.get(startId);
  if (!start || !mapDistrictKey) return;
  const from = _distResolve(start).key;
  if (from === mapDistrictKey && start.flags?.district) return;
  const z0 = mapOverview.z;
  const byCoord = new Map();
  for (const z of mapOverview.zones.values())
    if ((z.grid_z ?? 0) === z0 && z.grid_x != null) byCoord.set(`${z.grid_x},${z.grid_y}`, z);
  const queue = [start], seen = new Set([startId]), hit = [];
  while (queue.length) {
    const z = queue.shift(); hit.push(z);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = byCoord.get(`${z.grid_x + dx},${z.grid_y + dy}`);
      if (n && !seen.has(n.id) && _distResolve(n).key === from) { seen.add(n.id); queue.push(n); }
    }
  }
  for (const z of hit) {
    z.flags = { ...(z.flags || {}) };
    z.flags.district = mapDistrictKey;
  }
  renderMapOverview();
  for (const z of hit) await _saveZoneDistrict(z.id);
  toast(`${hit.length} tile${hit.length !== 1 ? 's' : ''} → ${_distName(mapDistrictKey)}`);
}

function districtRectStart(zoneId) {
  const z = mapOverview?.zones.get(zoneId);
  if (!z) return;
  mapDistrictRectStart = { x: z.grid_x, y: z.grid_y };
}
function districtRectOver(zoneId) {
  const z = mapOverview?.zones.get(zoneId);
  if (z && mapDistrictRectStart) _distRectOutline(mapDistrictRectStart, { x: z.grid_x, y: z.grid_y });
}
function _distClearOutline() { _mapDistrictOutlined.forEach(el => (el.style.boxShadow = '')); _mapDistrictOutlined = []; }
function _distRectOutline(a, b) {
  _distClearOutline();
  const g = document.getElementById('bigmap-grid-scroll');
  if (!g) return;
  const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x), minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const el = g.querySelector(`[data-map-cell="${x},${y}"]`);
    if (el && el.classList.contains('bigmap-tile')) { el.style.boxShadow = 'inset 0 0 0 2px var(--accent)'; _mapDistrictOutlined.push(el); }
  }
}
async function districtRectCommit(endId) {
  const end = mapOverview?.zones.get(endId);
  const a = mapDistrictRectStart;
  mapDistrictRectStart = null;
  _distClearOutline();
  if (!a || !end || !mapDistrictKey) { renderMapOverview(); return; }
  const minX = Math.min(a.x, end.grid_x), maxX = Math.max(a.x, end.grid_x);
  const minY = Math.min(a.y, end.grid_y), maxY = Math.max(a.y, end.grid_y);
  const z0 = mapOverview.z;
  const hit = [];
  for (const z of mapOverview.zones.values()) {
    if ((z.grid_z ?? 0) !== z0 || z.grid_x == null) continue;
    if (z.grid_x < minX || z.grid_x > maxX || z.grid_y < minY || z.grid_y > maxY) continue;
    if ((z.flags?.district || null) === mapDistrictKey) continue;
    z.flags = { ...(z.flags || {}) };
    z.flags.district = mapDistrictKey;
    hit.push(z);
  }
  renderMapOverview();
  for (const z of hit) await _saveZoneDistrict(z.id);
  toast(`${hit.length} tile${hit.length !== 1 ? 's' : ''} → ${_distName(mapDistrictKey)}`);
}

// Per-floor coverage counts. This is the number the phase-0 pass is working against:
// 'fallback' is the sinkhole, and the job is done when it reads zero for the city.
function _distStats() {
  const o = mapOverview;
  const out = { authored: 0, prefix: 0, fallback: 0, offRegion: 0 };
  if (!o) return out;
  for (const z of o.zones.values()) {
    if ((z.grid_z ?? 0) !== o.z || z.grid_x == null) continue;
    const r = _distResolve(z);
    out[r.source]++;
    // A tile whose district is authored but which sits outside the region being edited
    // is the Deadwater/Terminus fallout the ledger must never fire into.
    if (r.source === 'authored' && mapEditingRegionId && z.flags?.region_id && z.flags.region_id !== mapEditingRegionId) out.offRegion++;
  }
  return out;
}

// The floating district palette card (position:fixed, hovers over the map).
function districtPanelHtml() {
  const pal = _distPalette();
  if (!pal.length) {
    return `<div id="map-district-panel" style="position:fixed;top:100px;right:28px;z-index:60;width:210px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:11px;font-size:12px;color:var(--text-dim)">Loading districts…</div>`;
  }
  const swatch = (key, name, color) =>
    `<button onclick="setDistrictKey('${key}')" title="${name}" style="display:flex;align-items:center;gap:7px;width:100%;padding:5px 7px;border-radius:4px;cursor:pointer;border:1px solid ${key === mapDistrictKey ? 'var(--accent)' : 'var(--border)'};background:${key === mapDistrictKey ? 'var(--bg3)' : 'transparent'};color:var(--text);font-size:12px;text-align:left">
      <span style="width:18px;height:18px;flex-shrink:0;border-radius:3px;background:${color};border:1px solid #0007"></span>${name}</button>`;
  const sw = pal.map(d => swatch(d.key, d.name, d.color)).join('');
  const toolBtn = (t, label) => `<button onclick="setDistrictTool('${t}')" style="flex:1;font-size:11px;padding:5px 4px;border-radius:4px;cursor:pointer;border:1px solid var(--border);background:${mapDistrictTool === t ? 'var(--accent)' : 'var(--bg3)'};color:${mapDistrictTool === t ? '#111' : 'var(--text)'}">${label}</button>`;
  const hint = mapDistrictTool === 'fill' ? 'Click a tile to flood every orthogonal neighbour reading as the same district — including a whole unpainted quarter falling through to Residential.'
    : mapDistrictTool === 'pick' ? 'Click a tile to sample the district it currently resolves to.'
    : mapDistrictTool === 'rect' ? 'Drag a rectangle to claim every tile it covers. Empty cells stay empty — a district needs ground to sit on.'
    : 'Click-drag to paint · Ctrl-drag or right-drag to clear back to inherited.';
  const s = _distStats();
  const total = s.authored + s.prefix + s.fallback;
  const pct = total ? Math.round((s.authored / total) * 100) : 0;
  const anchor = mapDistrictPanelPos ? `left:${mapDistrictPanelPos.left}px;top:${mapDistrictPanelPos.top}px` : 'top:100px;right:28px';
  return `<div id="map-district-panel" style="position:fixed;${anchor};z-index:60;width:210px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 28px #000a;padding:11px;font-size:12px">
    <div id="map-district-drag" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:9px;cursor:move;user-select:none">
      <strong style="font-size:12px;letter-spacing:.3px">🗺 District</strong>
      <button onclick="toggleDistrictMode()" title="Close district painter" style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:15px;line-height:1">✕</button>
    </div>
    <div style="display:flex;gap:6px;margin-bottom:9px">${toolBtn('brush', '🖌')}${toolBtn('fill', '🪣')}${toolBtn('pick', '💧')}${toolBtn('rect', '▭')}</div>
    <div style="display:flex;flex-direction:column;gap:4px;max-height:280px;overflow-y:auto">${sw}</div>
    <div style="border-top:1px solid var(--border);margin-top:9px;padding-top:9px;font-size:10px;line-height:1.6">
      <div style="display:flex;justify-content:space-between"><span style="color:var(--text-dim)">Authored</span><strong style="color:var(--text)">${s.authored} · ${pct}%</strong></div>
      <div style="display:flex;justify-content:space-between"><span style="color:var(--text-dim)">By id prefix</span><span style="color:var(--text)">${s.prefix}</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:${s.fallback ? 'var(--yellow)' : 'var(--text-dim)'}">Fallback</span><strong style="color:${s.fallback ? 'var(--yellow)' : 'var(--text)'}">${s.fallback}</strong></div>
      ${s.offRegion ? `<div style="display:flex;justify-content:space-between;margin-top:3px"><span style="color:#ff6b6b">Outside region</span><strong style="color:#ff6b6b">${s.offRegion}</strong></div>` : ''}
    </div>
    <div style="font-size:10px;color:var(--text-dim);margin-top:8px;line-height:1.45">Solid = authored · striped = inherited from the zone id · faint = falling through to the default. ${hint}</div>
  </div>`;
}

// Drag the floating District palette by its header. Same shape as the Terrain one:
// the card is position:fixed and rebuilt on every renderMapOverview(), so the dragged
// position lives in mapDistrictPanelPos and districtPanelHtml() re-applies it.
(function enableDistrictPanelDrag() {
  if (window.__dpDistrictDrag) return;   // install once
  window.__dpDistrictDrag = true;
  let panel = null, startX = 0, startY = 0, baseL = 0, baseT = 0;
  function onMove(e) {
    if (!panel) return;
    const left = baseL + (e.clientX - startX), top = baseT + (e.clientY - startY);
    mapDistrictPanelPos = { left, top };
    panel.style.left = left + 'px'; panel.style.top = top + 'px'; panel.style.right = 'auto';
  }
  function onUp() {
    panel = null;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }
  document.addEventListener('mousedown', e => {
    const handle = e.target.closest?.('#map-district-drag');
    if (!handle || e.target.closest('button')) return;
    panel = document.getElementById('map-district-panel');
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    startX = e.clientX; startY = e.clientY; baseL = r.left; baseT = r.top;
    e.preventDefault();
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, true);
})();

// The floating terrain palette card (position:fixed, hovers over the map).
function terrainPanelHtml() {
  const swatchBtn = (key, label, fill, swatchCss = '') =>
    `<button onclick="setTerrainType('${key}')" title="${label}" style="display:flex;align-items:center;gap:7px;width:100%;padding:5px 7px;border-radius:4px;cursor:pointer;border:1px solid ${key === mapTerrainType ? 'var(--accent)' : 'var(--border)'};background:${key === mapTerrainType ? 'var(--bg3)' : 'transparent'};color:var(--text);font-size:12px;text-align:left">
      <span style="width:18px;height:18px;flex-shrink:0;border-radius:3px;background:${fill};border:1px solid #0007${swatchCss}"></span>${label}</button>`;
  const sw = TERRAIN_TYPES.map(t => swatchBtn(t.key, t.label, t.fill)).join('');
  // Runways sit below the terrains under their own heading — same brush/rect/pick tools,
  // but they write flags.runway + the runway icon instead of flags.terrain. The swatch
  // shows a yellow centreline over asphalt so it reads as a strip, not a plain colour.
  const rw = Object.entries(RUNWAY_KEYS).map(([key, r]) => {
    const stripe = r.runway === 'ns'
      ? 'background:linear-gradient(90deg,#2b2b2b 40%,#f5d400 40%,#f5d400 60%,#2b2b2b 60%)'
      : 'background:linear-gradient(0deg,#2b2b2b 40%,#f5d400 40%,#f5d400 60%,#2b2b2b 60%)';
    return swatchBtn(key, r.label, '#2b2b2b', ';' + stripe);
  }).join('');
  const toolBtn = (t, label) => `<button onclick="setTerrainTool('${t}')" style="flex:1;font-size:11px;padding:5px 4px;border-radius:4px;cursor:pointer;border:1px solid var(--border);background:${mapTerrainTool === t ? 'var(--accent)' : 'var(--bg3)'};color:${mapTerrainTool === t ? '#111' : 'var(--text)'}">${label}</button>`;
  const hint = mapTerrainTool === 'fill' ? 'Click a tile to flood-fill its same-terrain region.'
    : mapTerrainTool === 'pick' ? 'Click a tile to sample its terrain onto the brush.'
    : mapTerrainTool === 'rect' ? 'Drag a rectangle to fill every covered tile — empty cells become new ground tiles.'
    : 'Click-drag to paint · Ctrl-drag or right-drag to erase · paint an empty cell to conjure new ground.';
  const anchor = mapTerrainPanelPos ? `left:${mapTerrainPanelPos.left}px;top:${mapTerrainPanelPos.top}px` : 'top:100px;right:28px';
  return `<div id="map-terrain-panel" style="position:fixed;${anchor};z-index:60;width:190px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 28px #000a;padding:11px;font-size:12px">
    <div id="map-terrain-drag" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:9px;cursor:move;user-select:none">
      <strong style="font-size:12px;letter-spacing:.3px">🌍 Terrain</strong>
      <button onclick="toggleTerrainMode()" title="Close terrain painter" style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:15px;line-height:1">✕</button>
    </div>
    <div style="display:flex;gap:6px;margin-bottom:9px">${toolBtn('brush', '🖌')}${toolBtn('fill', '🪣')}${toolBtn('pick', '💧')}${toolBtn('rect', '▭')}</div>
    <div style="display:flex;flex-direction:column;gap:4px">${sw}</div>
    <div style="font-size:10px;color:var(--text-dim);margin:9px 0 4px;text-transform:uppercase;letter-spacing:.4px">✈ Runway</div>
    <div style="display:flex;flex-direction:column;gap:4px">${rw}</div>
    <div style="font-size:10px;color:var(--text-dim);margin-top:9px;line-height:1.45">${hint}</div>
    ${(typeof pendingChanges !== 'undefined' && pendingChanges.length) ? `<div style="border-top:1px solid var(--border);margin-top:9px;padding-top:9px">
      <div style="font-size:10px;color:var(--yellow);margin-bottom:6px">⚠ ${pendingChanges.length} unpublished edit${pendingChanges.length !== 1 ? 's' : ''} — not saved to the world yet.</div>
      <button onclick="publishAll()" style="width:100%;font-size:11px;padding:6px;border-radius:4px;border:1px solid var(--border);background:var(--accent);color:#111;cursor:pointer;font-weight:600">⬆ Publish now</button>
    </div>` : ''}
    <div style="border-top:1px solid var(--border);margin-top:9px;padding-top:9px">
      <button id="rebake-flight-btn" onclick="rebakeFlightSnapshot()" title="Regenerate the flight sim's baked world so it reflects published terrain" style="width:100%;font-size:11px;padding:6px;border-radius:4px;border:1px solid var(--border);background:var(--bg3);color:var(--text);cursor:pointer">⟳ Re-bake flight sim</button>
      <div style="font-size:10px;color:var(--text-dim);margin-top:6px;line-height:1.4">The open flight sim flies a baked snapshot — Publish, then re-bake so it matches the world.</div>
    </div>
  </div>`;
}

// Drag the floating Terrain palette by its header. The card is position:fixed and
// rebuilt on every renderMapOverview(), so the dragged position lives in
// mapTerrainPanelPos and terrainPanelHtml() re-applies it; the handler updates it
// live. Document-level move/up (no pointer capture), mirroring enableDialogDrag.
(function enableTerrainPanelDrag() {
  if (window.__dpTerrainDrag) return;   // install once
  window.__dpTerrainDrag = true;
  let panel = null, startX = 0, startY = 0, baseL = 0, baseT = 0;
  function onMove(e) {
    if (!panel) return;
    const left = baseL + (e.clientX - startX), top = baseT + (e.clientY - startY);
    mapTerrainPanelPos = { left, top };
    panel.style.left = left + 'px'; panel.style.top = top + 'px'; panel.style.right = 'auto';
  }
  function onUp() {
    panel = null;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
  }
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest?.('#map-terrain-drag')) return;
    if (e.target.closest('button')) return;   // let the ✕ close button through
    panel = document.getElementById('map-terrain-panel');
    if (!panel) return;
    const r = panel.getBoundingClientRect();  // seeds from the current (possibly right-anchored) position
    baseL = r.left; baseT = r.top; startX = e.clientX; startY = e.clientY;
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    e.preventDefault();                        // no text selection while dragging
  });
})();

// Re-bake the open flight sim's baked world (client/game/flightsim-world.json) from the
// live server world, so painted+published terrain shows up over there. The server derives
// it in-memory (zone publishes reloadZone() into the live world), so this is instant.
async function rebakeFlightSnapshot() {
  const btn = document.getElementById('rebake-flight-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⟳ Re-baking…'; }
  try {
    const r = await directAPI('/maps/flight-snapshot', 'POST', {});
    if (r?.error) toast(r.error, true);
    else toast(`Flight sim re-baked · ${r.tiles} tiles — reload the flight sim to see it.`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⟳ Re-bake flight sim'; }
  }
}

// ─── MOVE BUILDING ───────────────────────────────────────────────────────────
// Relocate a building facade to a new cell, safely rewiring its front door (the
// interior travels for free — linked by parent_zone_id). Deliberate multi-step flow:
// arm a building → click an empty destination → review the change plan → confirm.
let mapMoveBuildingMode = false;
let mapMoveArmed = null; // facade zoneId picked up for relocation

function toggleMoveBuildingMode() {
  mapMoveBuildingMode = !mapMoveBuildingMode;
  mapMoveArmed = null;
  if (mapMoveBuildingMode) { mapPaintMode = false; mapSafeZoneMode = false; mapTerrainMode = false; mapNewBuildingMode = false; mapDistrictMode = false; }
  renderMapOverview();
}
function _isBuildingTile(z) {
  return !!(z && (z.flags?.building_type || z.flags?.is_building || mapOverview?.children.find(c => c.parent_zone_id === z.id)));
}
// The city↔wilds curtain: a wilds tile (flags.district==='wilds', set by
// _newTerrainTile for wild surfaces) never auto-connects to a non-wilds neighbour,
// so painting the frontier can't re-open the sealed boundary. Gates are authored by
// hand. Inert between two same-side tiles.
function _crossesWildsBoundary(a, b) {
  return (a?.flags?.district === 'wilds') !== (b?.flags?.district === 'wilds');
}
function moveBuildingTileClick(zoneId) {
  const z = mapOverview?.zones.get(zoneId);
  if (mapMoveArmed === zoneId) { mapMoveArmed = null; renderMapOverview(); return; } // click again to drop
  if (!mapMoveArmed) {
    if (!_isBuildingTile(z)) { toast('Click a building tile to pick it up.', true); return; }
    mapMoveArmed = zoneId;
    renderMapOverview();
    return;
  }
  // Armed, clicked an occupied cell. In a fully-tiled region there are no empty cells,
  // so dropping onto a plain ground tile SWAPS it into the building's vacated cell. Another
  // building/interior can't be a target; the server does the final validation + rewiring.
  if (_isBuildingTile(z)) { toast('That cell holds another building — pick an empty or ground tile.', true); return; }
  moveBuildingPropose(mapMoveArmed, z.grid_x, z.grid_y);
}
function moveBuildingDest(x, y) {
  if (!mapMoveArmed) return;
  moveBuildingPropose(mapMoveArmed, x, y);
}
async function moveBuildingPropose(facadeId, x, y) {
  // Plan the move (validates + returns per-zone changes; never mutates).
  const res = await directAPI('/maps/move-building', 'POST', { facadeId, toX: x, toY: y, toZ: mapOverview.z });
  if (res?.error) { toast(res.error, true); return; }
  const plan = res.plan || { moves: [] };
  const changes = res.changes || [];
  const name = plan.facade?.name || facadeId;
  const summary = `Move "${name}" to (${x}, ${y})?\n\nThis rewires:\n` +
    plan.moves.map(m => '• ' + m).join('\n') +
    `\n\nStaged as ONE grouped change (${changes.length} zone${changes.length !== 1 ? 's' : ''}) — publishes atomically. The interior and its rooms move with it.`;
  if (!(await dpConfirm(summary, { title: 'Move Building' }))) return;
  // Stage the whole move as a single grouped `building_move` change, so it publishes
  // atomically (never a half-moved building from a partial publish).
  const r = await directAPI('/staging/stage', 'POST', {
    entityType: 'building_move', entityId: facadeId, entityName: name,
    changeType: 'update', method: 'POST', apiPath: '/maps/move-building',
    requestBody: { changes }, description: `Move building "${name}" to (${x}, ${y})`,
  });
  if (r?.error) { toast(r.error, true); return; }
  // Mirror into the working copy + per-zone overrides so the map previews the move and it
  // survives tab switches until Publish (the grouped change carries the affected zone ids,
  // so publish/reject clears these overrides — see staging.js).
  for (const c of changes) {
    const z = mapOverview.zones.get(c.id);
    if (z) _applyMapOverride(z, c.patch);
    _mapPendingOverrides.set(c.id, { ...(_mapPendingOverrides.get(c.id) || {}), ...c.patch });
  }
  mapMoveArmed = null;
  await updateStagingBadge();
  toast('Building move staged ✓ — Publish to apply.');
  renderMapOverview();
}

// ─── NEW BUILDING (templated generator) ──────────────────────────────────────
// Place a whole building of a chosen type: pick a type, click a ground/empty cell,
// confirm. The server stamps facade + interior + power/lights + type furniture/NPC in
// one shot (POST /maps/build-building → apiBuildBuilding). Hangars reuse the flow and
// get the flight-ops desk + hangar_interior wiring. Commits directly (not staged).
let mapNewBuildingMode = false;
let mapNewBuildingType = 'shop';
let mapNewBuildingName = '';
const NEW_BUILDING_TYPES = [
  ['shop', 'Shop'], ['bar', 'Bar'], ['club', 'Nightclub'], ['diner', 'Diner'],
  ['clinic', 'Clinic'], ['gun_shop', 'Gun Shop'], ['casino', 'Casino'], ['studio', 'Broadcast Studio'],
  ['hotel', 'Hotel'], ['corporate_office', 'Corporate Office'], ['warehouse', 'Warehouse'],
  ['residential', 'Residence'], ['police', 'Precinct'], ['power', '⚡ Power Plant'], ['hangar', '✈ Hangar'],
];
function toggleNewBuildingMode() {
  mapNewBuildingMode = !mapNewBuildingMode;
  if (mapNewBuildingMode) { mapPaintMode = false; mapSafeZoneMode = false; mapTerrainMode = false; mapMoveBuildingMode = false; mapDistrictMode = false; mapMoveArmed = null; }
  renderMapOverview();
}
function setNewBuildingType(t) { mapNewBuildingType = t; renderMapOverview(); }
function setNewBuildingName(v) { mapNewBuildingName = v; }   // no re-render — keeps input focus while typing

function newBuildingTileClick(x, y) {
  const o = mapOverview;
  const z = [...o.zones.values()].find(zz => (zz.grid_z ?? 0) === o.z && zz.grid_x === x && zz.grid_y === y);
  if (z && _isBuildingTile(z)) { toast('That cell already holds a building — pick a ground tile.', true); return; }
  buildBuildingPropose(x, y);
}
async function buildBuildingPropose(x, y) {
  const label = NEW_BUILDING_TYPES.find(t => t[0] === mapNewBuildingType)?.[1] || mapNewBuildingType;
  const nm = mapNewBuildingName.trim();
  const extras = mapNewBuildingType === 'hangar' ? 'furniture + a flight-ops desk' : 'furniture + an inhabitant';
  const summary = `Build a new ${label}${nm ? ` "${nm}"` : ''} at (${x}, ${y})?\n\n` +
    `Creates a facade + a lit, powered interior (lobby, rooms, ${extras}) and wires the front door to an adjacent street.\n\n` +
    `Commits directly to the dev DB (not staged) — export + push via CODEX to ship.`;
  if (!(await dpConfirm(summary, { title: 'New Building' }))) return;
  const r = await directAPI('/maps/build-building', 'POST', {
    toX: x, toY: y, toZ: mapOverview.z, building_type: mapNewBuildingType, name: nm || undefined,
  });
  if (r?.error) { toast(r.error, true); return; }
  toast(r.message || 'Building created ✓');
  mapNewBuildingName = '';
  await loadMapOverview(mapOverview.map.id);   // reload so the new facade + door render
}

// Floating New Building palette (position:fixed, hovers over the map — like the terrain one).
function newBuildingPanelHtml() {
  const opts = NEW_BUILDING_TYPES.map(([v, l]) => `<option value="${v}"${v === mapNewBuildingType ? ' selected' : ''}>${l}</option>`).join('');
  const extras = mapNewBuildingType === 'hangar' ? ' + flight-ops desk' : ' + an inhabitant';
  const anchor = dpFloatAnchor('map-newbuilding-panel', 'top:100px;right:28px');
  return `<div id="map-newbuilding-panel" class="dp-float-panel" style="position:fixed;${anchor};z-index:60;width:212px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 28px #000a;padding:11px;font-size:12px">
    <div class="dp-float-drag" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:9px;cursor:move;user-select:none">
      <strong style="font-size:12px;letter-spacing:.3px">🏗 New Building</strong>
      <button onclick="toggleNewBuildingMode()" title="Close" style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:15px;line-height:1">✕</button>
    </div>
    <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:3px">Type</label>
    <select class="settings-select" style="width:100%;margin-bottom:8px" onchange="setNewBuildingType(this.value)">${opts}</select>
    <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:3px">Name (optional)</label>
    <input value="${mapNewBuildingName.replace(/"/g, '&quot;')}" oninput="setNewBuildingName(this.value)" placeholder="auto from type" style="width:100%;box-sizing:border-box;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-size:12px;padding:5px 8px;border-radius:4px;margin-bottom:9px">
    <div style="font-size:10px;color:var(--text-dim);line-height:1.45">Click a <strong>ground tile</strong> next to a street. Facade + interior + power/lights + ${mapNewBuildingType === 'hangar' ? 'a hangar bay' : 'furniture'}${extras} are generated. Commits directly (not staged).</div>
  </div>`;
}

async function renderMapsPanel(data) {
  await ensureTerrainPalette();   // brush swatches come from content/map/terrain.json
  mapsList = Array.isArray(data) ? data : [];
  const panel = document.getElementById('list-panel');
  if (!mapsList.length) { panel.innerHTML = '<div style="padding:24px;color:var(--text-dim)">No maps yet. Run <code>npm run db:seed</code> to create map_world.</div>'; return; }
  const target = mapsList.find(m => m.id === 'map_world')?.id || mapsList.find(m => !m.parent_zone_id)?.id || mapsList[0]?.id;
  mapExteriorMapId = target;
  // Always load exterior first — this populates _exteriorBuildingZones which the interior
  // tab dropdown needs to list unmapped buildings. Set tab to exterior so renderMapOverview
  // renders the exterior grid, then switch to interior if we were previously there.
  const restoreInteriorId = mapViewTab === 'interior' ? mapSelectedInteriorId : null;
  mapViewTab = 'exterior';
  await loadMapOverview(target);
  if (restoreInteriorId && mapsList.find(m => m.id === restoreInteriorId && m.parent_zone_id)) {
    mapViewTab = 'interior';
    await switchInteriorMap(restoreInteriorId);
  }
}

async function loadMapOverview(mapId) {
  const data = await API(`/maps/${mapId}`);
  if (data.error) { toast(data.error, true); return; }
  mapUndoStack = []; mapRedoStack = []; // painter history doesn't carry across maps
  const zones = new Map((data.zones || []).map(z => [z.id, { ...z, exits: { ...(z.exits || {}) }, flags: z.flags || {}, grid_z: z.grid_z ?? 0 }]));
  const unplaced = new Map((data.unplaced || []).map(z => [z.id, { ...z, exits: { ...(z.exits || {}) }, flags: z.flags || {} }]));
  const unplacedInterior = new Map((data.unplacedInterior || []).map(z => [z.id, { ...z, exits: { ...(z.exits || {}) }, flags: z.flags || {} }]));
  const keepZ = (mapOverview && mapOverview.map.id === mapId) ? mapOverview.z : 0;
  mapOverview = { map: data.map, zones, unplaced, unplacedInterior, children: data.children || [], buildingZoneIds: data.buildingZoneIds || [], allZoneIds: data.allZoneIds || [], z: keepZ };
  if (!data.map.parent_zone_id) {
    _exteriorBuildingZones = (data.zones || []).filter(z => z.flags?.is_building);
    // The exterior editor is scoped to one region; fetch region names to label the
    // toolbar + populate its switcher. Refreshed each exterior load so a region added
    // in the World Map shows up in the dropdown without a full app reload.
    const dd = await API('/maps/regions').catch(() => null);
    if (dd?.regions) _regionNames = new Map(dd.regions.map(d => [d.id, d.name]));
    else if (!_regionNames) _regionNames = new Map();
  }
  // Re-apply any staged-but-unpublished color/marker changes so the map stays in sync
  // even after a fresh fetch (tab switch, panel reload, etc.)
  for (const [zoneId, overrides] of _mapPendingOverrides) {
    const z = zones.get(zoneId);
    if (z) _applyMapOverride(z, overrides);
  }
  // Refresh staged-change list so tiles pending deletion render their X marker.
  await updateStagingBadge();
  renderMapOverview();
}

// Live mirror of the server's validateMapLayout, over the working copy. Exits
// whose target isn't on this map are cross-map portals (exempt from geometry;
// the server checks them for dangling). Geometry mismatch = error; missing
// reciprocal = warning.
function validateMapOverview(zonesMap, knownZoneIds, interiorZoneIds) {
  const errors = [], oneWay = [];
  for (const z of zonesMap.values()) {
    if (z.grid_x == null) continue; // unplaced source — not on the grid, skip
    for (const { dir, target } of allExits(z.exits)) {
      const t = zonesMap.get(target);
      const off = MAP_DIR3D[dir];
      let geomError = false;

      if (!t) {
        // Target not on this map. Cardinal exits pointing to zones that exist on another
        // map (e.g. building entrances) are valid cross-map portals — skip them.
        // Interior/apartment zones never have a position on the exterior map — also exempt.
        // Only flag as dangling if the target zone doesn't exist anywhere.
        if (off && !(knownZoneIds && knownZoneIds.has(target)) && !(interiorZoneIds && interiorZoneIds.has(target))) {
          errors.push({ zoneId: z.id, direction: dir, targetId: target, reason: 'dangling', expectedX: null, expectedY: null, expectedZ: null });
          geomError = true;
        }
        continue;
      }

      if (t.flags?.is_building) continue; // exits into a building entrance are valid regardless of geometry

      if (t.grid_x == null) {
        // Target is assigned to this map but has no grid position yet.
        errors.push({ zoneId: z.id, direction: dir, targetId: target, reason: 'unplaced-target', expectedX: null, expectedY: null, expectedZ: null });
        geomError = true;
      } else if (off) {
        // Geometry check: target must sit at the expected grid offset from source.
        const [ex, ey, ez] = [z.grid_x + off[0], z.grid_y + off[1], (z.grid_z ?? 0) + off[2]];
        const actual = `${t.grid_x},${t.grid_y},${t.grid_z ?? 0}`;
        if (`${ex},${ey},${ez}` !== actual) {
          errors.push({ zoneId: z.id, direction: dir, targetId: target, reason: 'geometry', expectedX: ex, expectedY: ey, expectedZ: ez });
          geomError = true;
        }
      }

      // One-way check — only when no geometry error, avoid double-reporting pairs.
      if (!geomError) {
        const opp = MAP_OPP[dir];
        if (opp && (t.exits || {})[opp] !== z.id) {
          const alreadyFlagged = oneWay.some(w => w.zoneId === target && w.direction === opp && w.targetId === z.id);
          if (!alreadyFlagged) oneWay.push({ zoneId: z.id, direction: dir, targetId: target });
        }
      }
    }
  }
  return { errors, oneWay };
}

function renderMapOverview() {
  if (!mapOverview) return;
  const o = mapOverview;
  const panel = document.getElementById('list-panel');
  const all = [...o.zones.values()];
  // Scope the exterior editor to ONE region's grid. The world map carries multiple
  // regions (plus legacy zones parked near the origin ~900 tiles away); spanning them
  // would blow the grid up to a mostly-empty ~900×900. window.worldSelectedRegionId
  // (set by the World Editor's "Edit tiles" hand-off) picks the region; with no
  // selection we default to the largest one. When there's no region grid at all
  // (e.g. an interior map), show everything as before.
  const regionedZones = all.filter(z => z.flags?.region_id && z.grid_x != null);
  let regionZones = [];
  let selectedRegionId = null;
  if (regionedZones.length) {
    const sel = window.worldSelectedRegionId;
    if (sel && regionedZones.some(z => z.flags.region_id === sel)) {
      selectedRegionId = sel;
    } else {
      // Default to the region with the most placed tiles.
      const counts = new Map();
      for (const z of regionedZones) counts.set(z.flags.region_id, (counts.get(z.flags.region_id) || 0) + 1);
      selectedRegionId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
    regionZones = regionedZones.filter(z => z.flags.region_id === selectedRegionId);
  }
  // Remember the scoped region so terrain paints/conjures stamp it onto tiles that
  // lack one — the editor implicitly grows the region you jumped in to edit.
  mapEditingRegionId = selectedRegionId;
  let dbbox = null;
  if (regionZones.length) {
    const dxs = regionZones.map(z => z.grid_x), dys = regionZones.map(z => z.grid_y);
    dbbox = { minX: Math.min(...dxs), maxX: Math.max(...dxs), minY: Math.min(...dys), maxY: Math.max(...dys) };
  }
  const inRegion = z => !dbbox || (z.grid_x >= dbbox.minX && z.grid_x <= dbbox.maxX && z.grid_y >= dbbox.minY && z.grid_y <= dbbox.maxY);
  const floors = [...new Set(all.filter(inRegion).map(z => z.grid_z ?? 0))].sort((a, b) => a - b);
  const onFloor = all.filter(z => (z.grid_z ?? 0) === o.z && z.grid_x != null && z.grid_y != null && inRegion(z));
  // Authoritative universe of zone ids from the map payload (mirrors the server's
  // whole-world validator) — allRecords is only the last-loaded table, so it would
  // mis-flag valid cross-map portals (e.g. an up-exit into an interior zone) as dangling.
  const knownZoneIds = new Set((o.allZoneIds && o.allZoneIds.length ? o.allZoneIds : (Array.isArray(allRecords) ? allRecords : []).map(z => z.id)));
  const interiorZoneIds = new Set([
    ...o.unplacedInterior.keys(),
    ...o.children.map(c => c.entry_zone_id).filter(Boolean),
    ...(o.buildingZoneIds || []),
    o.map?.parent_zone_id,  // interior maps: parent exterior zone is a valid cross-map exit target
  ].filter(Boolean));
  const { errors, oneWay } = validateMapOverview(o.zones, knownZoneIds, interiorZoneIds);
  const broken = new Set(errors.map(e => e.zoneId));
  const pendingDelete = zonesPendingDelete();
  const nameOf = id => o.zones.get(id)?.name || id;

  // Sub-tab buttons (always at top)
  const subTabHtml = `<div style="display:flex;border-bottom:1px solid var(--border);background:var(--bg3)">
    <button onclick="switchMapTab('exterior')" style="flex:1;padding:7px;background:${mapViewTab==='exterior'?'var(--bg2)':'transparent'};border:none;border-bottom:2px solid ${mapViewTab==='exterior'?'var(--accent)':'transparent'};color:${mapViewTab==='exterior'?'var(--accent)':'var(--text-dim)'};cursor:pointer;font-size:12px;font-weight:600;letter-spacing:0.5px">Exterior</button>
    <button onclick="switchMapTab('interior')" style="flex:1;padding:7px;background:${mapViewTab==='interior'?'var(--bg2)':'transparent'};border:none;border-bottom:2px solid ${mapViewTab==='interior'?'var(--accent)':'transparent'};color:${mapViewTab==='interior'?'var(--accent)':'var(--text-dim)'};cursor:pointer;font-size:12px;font-weight:600;letter-spacing:0.5px">Interior</button>
  </div>`;

  // Toolbar. Sub-tabs + toolbar are collected into `head` so they can be pinned
  // to the top of the scrolling panel — on a tall map you'd otherwise scroll the
  // zoom/floor/paint controls off screen right when you want them.
  let head = '';
  // The Studio (npm run studio) is the file-authoring map tool — it edits
  // content/ directly, so what it draws is what ships. This panel edits the LIVE
  // DATABASE and the save-hook mirrors each edit into a file afterwards. Both
  // work; what doesn't work is assuming they see each other. Say so, because
  // "I painted in the Studio and this map is stale" is the predictable failure
  // (map-pipeline-spec §10).
  let html = `<div style="margin:0 0 8px;padding:6px 10px;border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:3px;color:var(--text-dim);font-size:11px;line-height:1.5">
      <strong style="color:var(--text)">This map is the live database.</strong>
      The Studio (<code>npm run studio</code>) edits <code>content/</code> files and previews with the build's own derive pass.
      Paint there and this panel stays stale until <code>npm run content:import</code>; paint here and the file is written for you.
      Don't run both on the same tiles in one sitting.
    </div>`;
  if (mapViewTab === 'interior' && !mapSelectedInteriorId) {
    panel.innerHTML = stickyHeadHtml(subTabHtml) + `<div style="padding:32px 24px;color:var(--text-dim);font-size:13px">
      No interior maps yet.<br><br>
      Switch to <strong>Exterior</strong>, then drag an <strong>Unplaced Interior Zone</strong> from the tray onto any exterior zone tile to link it and create an interior map.
    </div>`;
    return;
  }

  if (mapViewTab === 'interior') {
    const intMaps = mapsList.filter(m => m.parent_zone_id);
    const intBuildingIds = new Set(intMaps.map(m => m.parent_zone_id));
    const unmappedBuildings = _exteriorBuildingZones.filter(z => !intBuildingIds.has(z.id));
    const allIntOpts = [
      ...intMaps.map(m => `<option value="${m.id}" ${m.id === mapSelectedInteriorId ? 'selected' : ''}>${m.name}</option>`),
      ...unmappedBuildings.map(z => `<option value="bz:${z.id}" ${'bz:'+z.id === mapSelectedInteriorId ? 'selected' : ''}>${z.name}</option>`),
    ];
    const intOpts = allIntOpts.length
      ? allIntOpts.join('')
      : `<option value="">— no interiors yet —</option>`;
    head += `<div class="map-toolbar">
      <label>Interior</label>
      <select onchange="switchInteriorMap(this.value)">${intOpts}</select>
      <button class="action-btn danger" style="font-size:10px;padding:2px 8px" onclick="mapDeleteInterior()" title="Delete this interior map and all its zones">Delete Map</button>
      <button class="action-btn${mapSafeZoneMode ? ' active' : ''}" style="font-size:10px;padding:2px 8px${mapSafeZoneMode ? ';background:var(--accent);color:#111' : ''}" onclick="toggleSafeZoneMode()" title="Paint zones as Safe (police cameras present) or not">${mapSafeZoneMode ? '✓ Painting Safe Zones' : 'Paint Safe Zones'}</button>
      <button class="action-btn${mapTerrainMode ? ' active' : ''}" style="font-size:10px;padding:2px 8px;margin-left:6px${mapTerrainMode ? ';background:var(--accent);color:#111' : ''}" onclick="toggleTerrainMode()" title="Paint ground terrain (road auto-tiles into junctions; water, grass, asphalt, dock…) — writes flags.terrain">${mapTerrainMode ? '✓ Painting Terrain' : '🌍 Terrain'}</button>
      <button class="action-btn${mapMoveBuildingMode ? ' active' : ''}" style="font-size:10px;padding:2px 8px;margin-left:6px${mapMoveBuildingMode ? ';background:var(--accent);color:#111' : ''}" onclick="toggleMoveBuildingMode()" title="Relocate a building: pick it up, drop it on an empty cell, review + confirm — the interior and front door move with it">${mapMoveBuildingMode ? '✓ Moving Building' : '🏢 Move Building'}</button>
      <span style="margin-left:6px">Floor</span>
      <button class="action-btn" onclick="changeFloor(-1)">▾</button>
      <span style="min-width:60px;text-align:center">z = ${o.z}</span>
      <button class="action-btn" onclick="changeFloor(1)">▴</button>
      <span style="margin-left:14px">${mapScaleControlHtml()}</span>
    </div>`;
  } else {
    const exteriorLabel = (selectedRegionId && _regionNames?.get(selectedRegionId)) || o.map.name;
    // Switch which region the editor is scoped to without hopping back to the World
    // Map. Falls back to a plain label when the map has no regions (interiors, legacy).
    const regionOpts = [...(_regionNames?.entries() || [])]
      .map(([id, name]) => `<option value="${id}"${id === selectedRegionId ? ' selected' : ''}>${name}</option>`).join('');
    const regionSelector = (selectedRegionId && regionOpts)
      ? `<select class="settings-select" style="width:auto;padding:3px 26px 3px 8px;font-size:13px;font-weight:600;color:var(--text-bright)" onchange="selectEditRegion(this.value)" title="Switch which region you're editing">${regionOpts}</select>`
      : `<span style="color:var(--text-bright);font-weight:600;font-size:13px">${exteriorLabel}</span>`;
    head += `<div class="map-toolbar">
      ${regionSelector}
      <button class="action-btn${mapSafeZoneMode ? ' active' : ''}" style="font-size:10px;padding:2px 8px;margin-left:12px${mapSafeZoneMode ? ';background:var(--accent);color:#111' : ''}" onclick="toggleSafeZoneMode()" title="Paint zones as Safe (police cameras present) or not">${mapSafeZoneMode ? '✓ Painting Safe Zones' : 'Paint Safe Zones'}</button>
      <button class="action-btn${mapTerrainMode ? ' active' : ''}" style="font-size:10px;padding:2px 8px;margin-left:6px${mapTerrainMode ? ';background:var(--accent);color:#111' : ''}" onclick="toggleTerrainMode()" title="Paint ground terrain (road auto-tiles into junctions; water, grass, asphalt, dock…) — writes flags.terrain">${mapTerrainMode ? '✓ Painting Terrain' : '🌍 Terrain'}</button>
      <button class="action-btn${mapMoveBuildingMode ? ' active' : ''}" style="font-size:10px;padding:2px 8px;margin-left:6px${mapMoveBuildingMode ? ';background:var(--accent);color:#111' : ''}" onclick="toggleMoveBuildingMode()" title="Relocate a building: pick it up, drop it on an empty cell, review + confirm — the interior and front door move with it">${mapMoveBuildingMode ? '✓ Moving Building' : '🏢 Move Building'}</button>
      <button class="action-btn${mapNewBuildingMode ? ' active' : ''}" style="font-size:10px;padding:2px 8px;margin-left:6px${mapNewBuildingMode ? ';background:var(--accent);color:#111' : ''}" onclick="toggleNewBuildingMode()" title="Create a new building by type (shop, bar, hangar…): pick a type, click a ground tile — facade + interior + power/lights + furniture are generated. Build a ⚡ Power Plant to power the region.">${mapNewBuildingMode ? '✓ New Building' : '🏗 New Building'}</button>
      <button class="action-btn${mapDistrictMode ? ' active' : ''}" style="font-size:10px;padding:2px 8px;margin-left:6px${mapDistrictMode ? ';background:var(--accent);color:#111' : ''}" onclick="toggleDistrictMode()" title="Paint the land-use district a tile belongs to (the Ashway, the Redline, North City…) — writes flags.district. Shows which tiles are authored and which are only falling through to the default.">${mapDistrictMode ? '✓ Painting Districts' : '🗺 Districts'}</button>
      <span style="margin-left:auto">Floor</span>
      <button class="action-btn" onclick="changeFloor(-1)">▾</button>
      <span style="min-width:60px;text-align:center">z = ${o.z}</span>
      <button class="action-btn" onclick="changeFloor(1)">▴</button>
      <span style="margin-left:14px">${mapScaleControlHtml()}</span>
    </div>`;
  }
  if (mapSafeZoneMode) {
    html += `<div style="padding:4px 12px;font-size:11px;color:var(--text-dim);background:var(--bg3);border-bottom:1px solid var(--border)">
      Click-drag across tiles to paint. <span style="color:#39ff8f">Green</span> = safe zone (police cameras present). <span style="color:#ff3b5c">Red</span> = not safe.
    </div>`;
  }
  if (mapPaintMode) {
    html += `<div style="padding:4px 12px;font-size:11px;color:var(--text-dim);background:var(--bg3);border-bottom:1px solid var(--border)">
      Colour painter active — use the floating palette (top-right). ${mapPaintTool === 'fill' ? 'Fill: click a tile to flood its same-colour region.' : mapPaintTool === 'pick' ? 'Pick: click a tile to sample its colour.' : 'Brush: click-drag to paint tiles.'}
    </div>` + paintPanelHtml();
  }
  if (mapTerrainMode) {
    html += `<div style="padding:4px 12px;font-size:11px;color:var(--text-dim);background:var(--bg3);border-bottom:1px solid var(--border)">
      Terrain painter active — pick a surface from the floating palette (top-right). Roads auto-tile into junctions from their neighbours. Writes flags.terrain (stages in Changes).
    </div>` + terrainPanelHtml();
  }
  if (mapDistrictMode) {
    const ds = _distStats();
    html += `<div style="padding:4px 12px;font-size:11px;color:var(--text-dim);background:var(--bg3);border-bottom:1px solid var(--border)">
      District painter active — pick a district from the floating palette (top-right). Writes flags.district (stages in Changes).
      ${ds.fallback ? ` <span style="color:var(--yellow)">⚠ ${ds.fallback} tile${ds.fallback !== 1 ? 's' : ''} on this floor carry no district and fall through to the default.</span>` : ' <span style="color:#39ff8f">✓ Every tile on this floor resolves to an assigned district.</span>'}
    </div>` + districtPanelHtml();
  }
  if (mapMoveBuildingMode) {
    const movePublish = (typeof pendingChanges !== 'undefined' && pendingChanges.length)
      ? ` &nbsp;·&nbsp; <span style="color:var(--yellow)">⚠ ${pendingChanges.length} unpublished</span> <button onclick="publishAll()" style="font-size:10px;padding:1px 7px;border-radius:3px;border:1px solid var(--border);background:var(--accent);color:#111;cursor:pointer;font-weight:600">⬆ Publish now</button>`
      : '';
    html += `<div style="padding:4px 12px;font-size:11px;color:var(--text-dim);background:var(--bg3);border-bottom:1px solid var(--border)">
      ${mapMoveArmed
        ? `Armed: <strong style="color:var(--accent)">${o.zones.get(mapMoveArmed)?.name || mapMoveArmed}</strong> — click an empty cell (or a ground tile, to swap) next to a road, then confirm. Click the building again to drop it.`
        : 'Move Building — click a building tile to pick it up. Its interior and front door move with it.'}${movePublish}
    </div>`;
  }
  if (mapNewBuildingMode) {
    html += `<div style="padding:4px 12px;font-size:11px;color:var(--text-dim);background:var(--bg3);border-bottom:1px solid var(--border)">
      New Building — pick a type in the floating panel (top-right), then click a ground tile next to a street. Facade + interior + power/lights + furniture are generated in one shot (commits directly).
    </div>` + newBuildingPanelHtml();
  }

  // Validation panel
  html += `<div class="map-validation">`;
  if (errors.length) {
    html += `<div class="v-error"><strong>${errors.length} geometry error(s) — exit points to zone at wrong position:</strong></div>`;
    html += errors.map(e => {
      const del = `<button class="action-btn danger" style="font-size:10px;padding:1px 7px;flex-shrink:0" onclick="mapRemoveExit('${e.zoneId}','${e.direction}')">Delete exit</button>`;
      if (e.reason === 'dangling') {
        return `<div class="v-error" style="display:flex;align-items:center;gap:8px;margin-top:3px">
          <span>• ${nameOf(e.zoneId)} → ${e.direction} → <em>${e.targetId}</em> (zone not found on this map)</span>
          ${del}
        </div>`;
      }
      if (e.reason === 'unplaced-target') {
        return `<div class="v-error" style="display:flex;align-items:center;gap:8px;margin-top:3px">
          <span>• ${nameOf(e.zoneId)} → ${e.direction} → ${nameOf(e.targetId)} (target has no map position — drag it from the tray)</span>
          ${del}
        </div>`;
      }
      // reason === 'geometry'
      const occupied = [...o.zones.values()].find(z => z.grid_x === e.expectedX && z.grid_y === e.expectedY && (z.grid_z ?? 0) === e.expectedZ);
      return `<div class="v-error" style="display:flex;align-items:center;gap:8px;margin-top:3px">
        <span>• ${nameOf(e.zoneId)} → ${e.direction} → ${nameOf(e.targetId)} (expected at ${e.expectedX},${e.expectedY},${e.expectedZ})</span>
        ${!occupied
          ? `<button class="action-btn" style="font-size:10px;padding:1px 7px;flex-shrink:0" onclick="mapFixGeometry('${e.targetId}',${e.expectedX},${e.expectedY},${e.expectedZ})">Move here</button>`
          : `<span style="font-size:10px;color:var(--text-dim);flex-shrink:0">(cell occupied — move manually)</span>`}
        ${del}
      </div>`;
    }).join('');
  } else {
    html += `<div class="v-ok">✓ No geometry errors.</div>`;
  }
  if (oneWay.length) {
    html += `<div class="v-warn" style="margin-top:6px"><strong>${oneWay.length} one-way connection(s) — return exit missing:</strong></div>`;
    html += oneWay.map(w => {
      const opp = MAP_OPP[w.direction];
      return `<div class="v-warn" style="display:flex;align-items:center;gap:8px;margin-top:3px">
        <span>• ${nameOf(w.zoneId)} → ${w.direction} → ${nameOf(w.targetId)} (no ${opp} return)</span>
        <button class="action-btn" style="font-size:10px;padding:1px 7px;flex-shrink:0" onclick="mapAddReciprocal('${w.targetId}','${opp}','${w.zoneId}')">Add ${opp} return</button>
        <button class="action-btn danger" style="font-size:10px;padding:1px 7px;flex-shrink:0" onclick="mapRemoveExit('${w.zoneId}','${w.direction}')">Delete exit</button>
      </div>`;
    }).join('');
  }
  html += `<div style="color:var(--text-dim);margin-top:6px;font-size:10px">Drag to move (auto-connects to neighbours) · click zone to edit · click empty cell to create. Exit badges: <span style="color:var(--cyan)">▲▼</span> = up/down, <span style="color:#ff3b5c">red</span> = geometry error.</div>`;
  html += `</div>`;

  // Grid — pad by one cell so there are empty cells to place new zones into.
  // Bounds are computed across ALL floors so the grid stays the same size when
  // switching z-levels, meaning (x,y) positions align visually between floors.
  // Scope to the region (inRegion) like onFloor does — otherwise the legacy
  // zones parked ~900 tiles from the region cluster stretch the bounds into a
  // ~1800×1800 grid of empty cells and freeze the render.
  const allPlaced = all.filter(z => z.grid_x != null && z.grid_y != null && inRegion(z));
  let minX, maxX, minY, maxY;
  if (allPlaced.length) {
    const xs = allPlaced.map(z => z.grid_x), ys = allPlaced.map(z => z.grid_y);
    minX = Math.min(...xs) - 1; maxX = Math.max(...xs) + 1;
    // In terrain mode, open extra empty rows to the south so you can paint the
    // wilds further out than the current extent (paint-to-create fills them in).
    minY = Math.min(...ys) - 1; maxY = Math.max(...ys) + (mapTerrainMode && dbbox ? 6 : 1);
  } else { minX = -1; maxX = 1; minY = -1; maxY = 1; }
  const byCoord = new Map(onFloor.map(z => [`${z.grid_x},${z.grid_y}`, z]));

  // Per-direction broken set, so a cell's exit readout can flag the bad ones.
  const brokenByZone = new Map();
  for (const e of errors) { if (!brokenByZone.has(e.zoneId)) brokenByZone.set(e.zoneId, new Set()); brokenByZone.get(e.zoneId).add(e.direction); }

  // Tight grid — tiles touch (no connection-gap slots). Connections are auto-wired on
  // drag, shown as per-tile exit badges, and edited in the zone editor / validation panel.
  const W = maxX - minX + 1, H = maxY - minY + 1;
  const colTmpl = Array.from({ length: W }, () => '110px').join(' ');
  const rowTmpl = Array.from({ length: H }, () => '76px').join(' ');
  const col = x => x - minX + 1, row = y => y - minY + 1;
  const cellStyle = (x, y, extra = '') => `style="grid-column:${col(x)};grid-row:${row(y)}${extra}"`;

  html += `<div id="bigmap-grid-scroll" style="padding:12px;overflow:auto" ondragover="event.preventDefault()" ondrop="mapGridDrop(event)"><div class="map-scale-viewport"><div class="map-scale-inner"><div style="display:grid;grid-template-columns:${colTmpl};grid-template-rows:${rowTmpl}">`;

  // Cells (and empty/create slots)
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const z = byCoord.get(`${x},${y}`);
      if (!z) {
        if (mapNewBuildingMode) {
          html += `<div class="bigmap-tile-create" ${cellStyle(x, y, ';cursor:cell;outline:1px dashed var(--accent)')} data-map-cell="${x},${y}" title="Build a ${mapNewBuildingType} here" onclick="newBuildingTileClick(${x},${y})">🏗</div>`;
        } else if (mapMoveBuildingMode && mapMoveArmed) {
          html += `<div class="bigmap-tile-create" ${cellStyle(x, y, ';cursor:cell;outline:1px dashed var(--accent)')} data-map-cell="${x},${y}" title="Place ${o.zones.get(mapMoveArmed)?.name || 'building'} here" onclick="moveBuildingDest(${x},${y})">▣</div>`;
        } else if (mapTerrainMode && dbbox) {
          // Paint terrain onto a black cell to conjure a new ground tile there.
          // Gated to the region exterior grid — the zone_district_<x>_<y> id
          // scheme (and south-extended rows) only make sense out in the world.
          const handlers = `onmousedown="terrainCreateStart(event,${x},${y})" onmouseenter="terrainCreateOver(event,${x},${y})" onmouseup="terrainCreateEnd(${x},${y})" oncontextmenu="return false"`;
          html += `<div class="bigmap-tile-create bm-terrain-empty" ${cellStyle(x, y, ';cursor:crosshair')} data-map-cell="${x},${y}" title="Paint ${mapTerrainType} here — creates a new tile" ${handlers}></div>`;
        } else {
          html += `<div class="bigmap-tile-create" ${cellStyle(x, y)} data-map-cell="${x},${y}" ondragover="event.preventDefault()" onclick="createZoneAt(${x},${y})">+</div>`;
        }
        continue;
      }
      let cls = 'bigmap-tile bm-edit';
      if (broken.has(z.id)) cls += ' bm-broken';
      if (pendingDelete.has(z.id)) cls += ' bm-pending-delete';

      if (mapSafeZoneMode) {
        const safeStyle = (z.flags?.sanctuary
          ? ';background:rgba(57,255,143,0.35);border-color:rgba(57,255,143,0.9)'
          : ';background:rgba(255,59,92,0.25);border-color:rgba(255,59,92,0.75)') + ';cursor:crosshair';
        const marker = z.marker ? `<span class="map-marker-badge">${z.marker}</span>` : '';
        html += `<div class="${cls}" ${cellStyle(x, y, safeStyle)} data-map-cell="${x},${y}" title="${z.id}" onmousedown="safeZonePaintStart(event,'${z.id}')" onmouseenter="safeZonePaintOver('${z.id}')"><div>${marker}${z.name}</div></div>`;
        continue;
      }

      if (mapPaintMode) {
        const marker = z.marker ? `<span class="map-marker-badge">${z.marker}</span>` : '';
        const handler = mapPaintTool === 'fill'
          ? `onmousedown="mapFloodFill('${z.id}')"`
          : mapPaintTool === 'pick'
          ? `onmousedown="mapPickColor('${z.id}')"`
          : `onmousedown="paintStart(event,'${z.id}')" onmouseenter="paintOver('${z.id}')"`;
        html += `<div class="${cls}" ${cellStyle(x, y, zoneColorStyle(z) + ';cursor:crosshair')} data-map-cell="${x},${y}" title="${z.id}" ${handler}><div>${marker}${z.name}</div></div>`;
        continue;
      }

      if (mapDistrictMode) {
        const r = _distResolve(z);
        const marker = z.marker ? `<span class="map-marker-badge">${z.marker}</span>` : '';
        // Authored tiles take readable text off their own colour; the two weaker
        // sources stay dim so a painted block reads as finished at a glance.
        const txt = r.source === 'authored' ? luminanceTextColor(_distColor(r.key)) : 'var(--text-dim)';
        const dStyle = `;background:${_distTileStyleBg(z)};color:${txt};cursor:crosshair`;
        const handlers = `onmousedown="districtPaintStart(event,'${z.id}')" onmouseenter="districtPaintOver(event,'${z.id}')" onmouseup="districtPaintEnd('${z.id}')" oncontextmenu="return false"`;
        const src = r.source === 'authored' ? '' : r.source === 'prefix' ? ' (from id prefix)' : ' (fallback — unassigned)';
        html += `<div class="${cls}" ${cellStyle(x, y, dStyle)} data-map-cell="${x},${y}" title="${z.id} — ${_distName(r.key)}${src}" ${handlers}><div>${marker}${z.name}</div></div>`;
        continue;
      }

      if (mapTerrainMode) {
        const rwKey = _tileSurfaceKey(z);                 // 'runway_ns'/'runway_ew' when this tile is a runway
        const terr = mapZoneTerrain(z);
        const fill = terr && terr !== 'road' ? TERRAIN_FILL_BY_KEY[terr] : null;
        const marker = z.marker ? `<span class="map-marker-badge">${z.marker}</span>` : '';
        let tStyle, ico = '', label = z.name;
        if (isRunwayKey(rwKey)) {
          const iconName = RUNWAY_KEYS[rwKey].icon;
          tStyle = `;background:${RUNWAY_BG};color:${RUNWAY_COLOR};cursor:crosshair`;
          ico = `<span style="display:inline-block;width:26px;height:26px;background:currentColor;-webkit-mask:url(/assets/zone-icons/${iconName}.svg) center/contain no-repeat;mask:url(/assets/zone-icons/${iconName}.svg) center/contain no-repeat"></span>`;
          label = '';
        } else if (terr === 'road') {
          const conn = mapRoadConnector(z, byCoord);
          tStyle = `;background:${TERRAIN_FILL_BY_KEY.road};color:#f2c53d;cursor:crosshair`;
          ico = `<span style="display:inline-block;width:26px;height:26px;background:currentColor;-webkit-mask:url(/assets/zone-icons/${conn}.svg) center/contain no-repeat;mask:url(/assets/zone-icons/${conn}.svg) center/contain no-repeat"></span>`;
          label = '';
        } else if (fill) {
          tStyle = `;background:${fill};color:${luminanceTextColor(fill)};cursor:crosshair`;
        } else {
          // No known terrain (a plain 'Residential Area' tile, or an unrecognised value):
          // fall back to the tile's authored colour so it's visible + paintable, not a blank hole.
          tStyle = zoneColorStyle(z) + ';cursor:crosshair';
        }
        const handlers = `onmousedown="terrainPaintStart(event,'${z.id}')" onmouseenter="terrainPaintOver(event,'${z.id}')" onmouseup="terrainPaintEnd('${z.id}')" oncontextmenu="return false"`;
        html += `<div class="${cls}" ${cellStyle(x, y, tStyle)} data-map-cell="${x},${y}" title="${z.id} — ${terr || 'untyped'}" ${handlers}><div>${ico}${marker}${label}</div></div>`;
        continue;
      }

      if (mapMoveBuildingMode) {
        const bldg = _isBuildingTile(z);
        const armed = z.id === mapMoveArmed;
        // Render the real terrain surface (streets/water/ground) with buildings on it, then
        // add the mode cursor/outline. With a building armed, plain ground tiles are valid
        // swap targets (cursor:cell); without one armed, only buildings are pickable.
        const vis = _terrainTileVisual(z, byCoord);
        const mStyle = vis.style + (armed ? ';outline:2px solid var(--accent);cursor:grab'
          : mapMoveArmed ? (bldg ? ';cursor:not-allowed;opacity:0.6' : ';cursor:cell;outline:1px dashed var(--accent)')
          : bldg ? ';cursor:grab' : ';cursor:not-allowed;opacity:0.6');
        const grip = bldg ? '🏢 ' : '';
        html += `<div class="${cls}" ${cellStyle(x, y, mStyle)} data-map-cell="${x},${y}" title="${z.id}" onclick="moveBuildingTileClick('${z.id}')"><div>${grip}${vis.inner}</div></div>`;
        continue;
      }

      if (mapNewBuildingMode) {
        const bldg = _isBuildingTile(z);
        // Real terrain surface + buildings, so you can see the streets to place against.
        const vis = _terrainTileVisual(z, byCoord);
        const nbStyle = vis.style + (bldg ? ';cursor:not-allowed;opacity:0.5' : ';cursor:cell;outline:1px dashed var(--accent)');
        html += `<div class="${cls}" ${cellStyle(x, y, nbStyle)} data-map-cell="${x},${y}" title="${bldg ? z.id + ' (occupied)' : 'Build a ' + mapNewBuildingType + ' here'}" onclick="newBuildingTileClick(${x},${y})"><div>${vis.inner}</div></div>`;
        continue;
      }

      // Tile colour is terrain-driven: a non-building tile takes the fill for its terrain
      // (flags.terrain, or inferred), so ground reads from what it IS without an independently
      // painted colour. Buildings keep their authored colour. Unknown terrain falls back to the
      // authored bg_color so nothing renders blank.
      let colorStyle;
      if (_isBuildingTile(z)) {
        colorStyle = zoneColorStyle(z);
      } else {
        const terr = mapZoneTerrain(z);
        const fill = terr ? TERRAIN_FILL_BY_KEY[terr] : null;
        colorStyle = fill ? `;background:${fill};color:${luminanceTextColor(fill)}` : zoneColorStyle(z);
      }
      // Curtain (the Architect's forcefield): tiles flagged flags.curtain get a
      // hard-light sheet on whichever sides face out of the region (no neighbour),
      // so the sealed edge reads as a wall rather than plain terrain.
      if (z.flags?.curtain) {
        cls += ' bm-curtain';
        for (const [d, dx, dy] of [['n', 0, -1], ['s', 0, 1], ['e', 1, 0], ['w', -1, 0]]) {
          if (!byCoord.get(`${x + dx},${y + dy}`)) cls += ` bm-curtain-${d}`;
        }
      }
      const child = o.children.find(c => c.parent_zone_id === z.id);
      const dive = child ? `<span class="map-dive-btn" title="Dive into ${child.name}" onclick="event.stopPropagation();diveInto('${z.id}')">⤵</span>` : '';
      const curtainBadge = z.flags?.curtain ? `<span class="map-curtain-badge" title="Architect's Curtain — sealed edge">⛨</span>` : '';
      const marker = z.marker ? `<span class="map-marker-badge">${z.marker}</span>` : '';
      const bset = brokenByZone.get(z.id) || new Set();
      const exitDirs = Object.keys(z.exits || {});
      const exHtml = exitDirs.length ? `<div class="cell-exits">${exitDirs.map(d => {
        const cl = bset.has(d) ? 'ex-broken' : ((d === 'up' || d === 'down') ? 'ex-vert' : '');
        const sym = d === 'up' ? '▲' : d === 'down' ? '▼' : d[0].toUpperCase();
        return `<span class="${cl}">${sym}</span>`;
      }).join(' ')}</div>` : '';
      html += `<div class="${cls}" ${cellStyle(x, y, colorStyle)} data-map-cell="${x},${y}" title="${z.id}" draggable="true" ondragstart="mapDragStart(event,'${z.id}')" ondragover="event.preventDefault()" onclick="mapTileEditClick('${z.id}')"><div>${dive}${curtainBadge}${marker}${z.name}${exHtml}</div></div>`;
    }
  }

  html += `</div></div></div></div>`;

  // Unplaced-zones tray:
  const trayChip = (z, dragFn) => `<span class="bigmap-tile bm-edit" style="width:auto;height:auto;padding:4px 8px;cursor:grab;flex-shrink:0${zoneColorStyle(z)}" draggable="true" ondragstart="${dragFn}(event,'${z.id}')" title="${z.id}">${z.name}</span>`;

  if (mapViewTab === 'interior') {
    // Interior tray: rooms with no grid position OR no exits, plus unplaced
    // interior rooms not on any map. Rooms with a parent_zone are grouped by
    // their parent and rendered inside a labelled box.
    const onMap = [...o.zones.values()].filter(z => z.grid_x == null || Object.keys(z.exits || {}).length === 0);
    const orphaned = [...(o.unplacedInterior?.values() || [])].filter(z => !z.flags?.is_building && !z.is_building_root && !o.zones.has(z.id));

    // Split into grouped (have parent_zone) and standalone
    const grouped = orphaned.filter(z => z.parent_zone);
    const standalone = [...onMap, ...orphaned.filter(z => !z.parent_zone)];

    // Build parent groups map: parent_zone → { name, zones[] }
    const parentGroups = new Map();
    for (const z of grouped) {
      if (!parentGroups.has(z.parent_zone)) {
        parentGroups.set(z.parent_zone, { name: z.parent_zone_name || z.parent_zone, zones: [] });
      }
      parentGroups.get(z.parent_zone).zones.push(z);
    }

    let trayHtml = '';
    // Grouped sections — one labeled box per parent
    for (const [parentId, group] of parentGroups) {
      trayHtml += `<div style="border:1px solid var(--border);border-radius:4px;padding:8px 10px;margin-bottom:8px;width:100%;box-sizing:border-box">
        <div style="font-size:10px;font-weight:700;color:var(--accent2);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px" title="${parentId}">${group.name}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${group.zones.map(z => trayChip(z, 'mapTrayDragStart')).join('')}</div>
      </div>`;
    }
    // Standalone (on-map unpositioned or truly orphaned with no parent)
    if (standalone.length) {
      trayHtml += `<div style="display:flex;gap:6px;flex-wrap:wrap">${standalone.map(z => trayChip(z, o.zones.has(z.id) ? 'mapDragStart' : 'mapTrayDragStart')).join('')}</div>`;
    }

    html += `<div style="padding:0 12px 14px;border-top:1px solid var(--border);margin-top:8px">
      <div style="font-size:11px;font-weight:600;color:var(--accent);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;padding-top:10px">Unplaced / No Exits</div>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px">Rooms with no grid position or no exits. Drag onto an empty cell to place.</div>
      ${trayHtml || `<span style="color:var(--text-dim);font-style:italic;font-size:11px">None — all rooms are placed and connected.</span>`}
    </div>`;
  } else {
    const extTray = [...o.unplaced.values()];
    const noPosition = [...o.zones.values()].filter(z => z.grid_x == null && !z.flags?.is_interior && !z.flags?.is_apartment && !z.flags?.is_building);
    const disconnected = [...o.zones.values()].filter(z => Object.keys(z.exits || {}).length === 0 && z.grid_x != null);
    const allExtUnplaced = [...extTray, ...noPosition].sort((a, b) => a.name.localeCompare(b.name));
    const intUnplaced = [...(o.unplacedInterior?.values() || [])];
    // Buildings: is_building flag or is a building root. Exclude child zones (have parent_zone).
    const unplacedBuildings = intUnplaced.filter(z => (z.flags?.is_building || z.is_building_root) && !z.parent_zone);
    // Orphaned: no parent_zone, not a building root — truly unattached interior rooms
    const orphanedRooms = intUnplaced.filter(z => !z.flags?.is_building && !z.is_building_root && !z.parent_zone);
    const extChip = z => `<span class="bigmap-tile bm-edit" style="width:auto;height:auto;padding:4px 8px;cursor:grab;flex-shrink:0${zoneColorStyle(z)};border-color:var(--accent)" draggable="true" ondragstart="mapTrayDragStart(event,'${z.id}')" title="${z.id}">${z.name}</span>`;
    const intChip = z => `<span class="bigmap-tile bm-edit" style="width:auto;height:auto;padding:4px 8px;cursor:grab;flex-shrink:0${zoneColorStyle(z)};border-color:var(--accent2);color:var(--accent2);font-weight:600" draggable="true" ondragstart="mapInteriorTrayDragStart(event,'${z.id}')" title="${z.id}">🏢 ${z.name}</span>`;
    const roomChip = z => `<span class="bigmap-tile bm-edit" style="width:auto;height:auto;padding:4px 8px;cursor:pointer;flex-shrink:0${zoneColorStyle(z)};border-color:var(--yellow);color:var(--yellow)" onclick="mapTileEditClick('${z.id}')" title="${z.id}">🚪 ${z.name}</span>`;
    html += `<div style="padding:0 12px 14px;border-top:1px solid var(--border);margin-top:8px">
      <div style="font-size:11px;font-weight:600;color:var(--accent);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;padding-top:10px">Unplaced Exterior Zones</div>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px">Drag onto an empty cell to place on the world map.</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">${allExtUnplaced.length
        ? allExtUnplaced.map(extChip).join('')
        : `<span style="color:var(--text-dim);font-style:italic;font-size:11px">None.</span>`
      }</div>
      ${disconnected.length ? `
      <div style="font-size:11px;font-weight:600;color:var(--yellow);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">No Connections</div>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px">On the map grid but have no exits — may need wiring up.</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">${disconnected.map(z => trayChip(z, 'mapTrayDragStart')).join('')}</div>
      ` : ''}
      <div style="font-size:11px;font-weight:600;color:var(--accent2);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Unplaced Buildings</div>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px">Drag onto an existing exterior zone tile to link and create an interior map.</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">${unplacedBuildings.length
        ? unplacedBuildings.map(intChip).join('')
        : `<span style="color:var(--text-dim);font-style:italic;font-size:11px">None.</span>`
      }</div>
      ${orphanedRooms.length ? `
      <div style="font-size:11px;font-weight:600;color:var(--yellow);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Orphaned Interior Rooms</div>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px">Interior rooms with no map, no exits, and no parent zone.</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${orphanedRooms.map(roomChip).join('')}</div>
      ` : ''}
    </div>`;
  }
  // Preserve scroll across the full innerHTML rebuild so paint-drag strokes and
  // floor changes (which re-render every tile) don't yank the view back. The
  // outer #list-panel scrolls the page vertically; the inner .map-scale-viewport
  // is the grid's real scroller on both axes, so both must be captured+restored.
  const prevPanelTop = panel.scrollTop, prevPanelLeft = panel.scrollLeft;
  const prevGrid = document.getElementById('bigmap-grid-scroll');
  const prevGridLeft = prevGrid?.scrollLeft || 0, prevGridTop = prevGrid?.scrollTop || 0;
  const prevVp = prevGrid?.querySelector('.map-scale-viewport');
  const prevVpLeft = prevVp?.scrollLeft || 0, prevVpTop = prevVp?.scrollTop || 0;
  panel.innerHTML = stickyHeadHtml(subTabHtml + head) + html;
  panel.scrollTop = prevPanelTop;
  panel.scrollLeft = prevPanelLeft;
  const newGrid = document.getElementById('bigmap-grid-scroll');
  if (newGrid) { newGrid.scrollLeft = prevGridLeft; newGrid.scrollTop = prevGridTop; }
  applyMapScale(panel); // resets the inner transform → do the viewport restore after, once scrollWidth is final
  const newVp = newGrid?.querySelector('.map-scale-viewport');
  if (newVp) { newVp.scrollLeft = prevVpLeft; newVp.scrollTop = prevVpTop; }
}

async function switchMap(id) {
  if (!mapsGuard()) { renderMapOverview(); return; }
  mapViewTab = 'exterior';
  mapExteriorMapId = id;
  await loadMapOverview(id);
}

function changeFloor(delta) {
  mapOverview.z += delta;
  renderMapOverview();
}

async function mapFixGeometry(zoneId, x, y, z) {
  const zone = mapOverview.zones.get(zoneId);
  if (!zone) return;
  const oldX = zone.grid_x, oldY = zone.grid_y, oldZ = zone.grid_z;
  zone.grid_x = x; zone.grid_y = y; zone.grid_z = z;
  renderMapOverview();
  const r = await API(`/zones/${zoneId}`, 'PUT', { grid_x: x, grid_y: y, grid_z: z, map_id: zone.map_id, exits: zone.exits });
  if (r?.error) { zone.grid_x = oldX; zone.grid_y = oldY; zone.grid_z = oldZ; renderMapOverview(); toast(r.error, true); return; }
  updateStagingBadge();
}

async function mapAddReciprocal(zoneId, dir, targetId) {
  const z = mapOverview.zones.get(zoneId);
  if (!z) return;
  z.exits[dir] = targetId;
  renderMapOverview();
  const r = await API(`/zones/${zoneId}`, 'PUT', { exits: z.exits });
  if (r?.error) { delete z.exits[dir]; renderMapOverview(); toast(r.error, true); return; }
  updateStagingBadge();
}

async function mapRemoveExit(zoneId, dir) {
  const z = mapOverview.zones.get(zoneId);
  if (!z) return;
  const old = z.exits[dir];
  delete z.exits[dir];
  renderMapOverview();
  const r = await API(`/zones/${zoneId}`, 'PUT', { exits: z.exits });
  if (r?.error) { z.exits[dir] = old; renderMapOverview(); toast(r.error, true); return; }
  updateStagingBadge();
}

// Single drop handler on the grid wrapper — walks up from event.target to find
// the nearest element with data-map-cell, then delegates to mapDrop. This
// avoids the HTML5 DnD bug where drop fires on an inner child that has no
// ondrop, gets silently discarded even though the parent has a handler.
function mapGridDrop(e) {
  e.preventDefault();
  let el = e.target;
  while (el && !el.dataset.mapCell) el = el.parentElement;
  if (!el) return;
  const [x, y] = el.dataset.mapCell.split(',').map(Number);
  mapDrop(e, x, y);
}

function mapDragStart(e, id) {
  mapDragId = id; mapDragFromTray = false; mapDragIsInterior = false;
  e.dataTransfer.effectAllowed = 'move';
}

// Drag an unplaced zone out of the tray.
function mapTrayDragStart(e, id) {
  mapDragId = id; mapDragFromTray = true; mapDragIsInterior = false;
  e.dataTransfer.effectAllowed = 'move';
}

// Drag an unplaced interior zone — must be dropped onto an existing exterior tile.
function mapInteriorTrayDragStart(e, id) {
  mapDragId = id; mapDragFromTray = true; mapDragIsInterior = true;
  e.dataTransfer.effectAllowed = 'move';
}

function openInteriorLinkModal(interiorZoneId, exteriorZoneId) {
  const extZone = mapOverview.zones.get(exteriorZoneId);
  const intZone = mapOverview.unplacedInterior?.get(interiorZoneId);
  const entranceDirs = ['in','out','north','south','east','west','up','down'];
  const stackDirs = ['up','down','north','south','east','west'];
  openModal(`Link to ${extZone?.name || exteriorZoneId}`, `
    <div class="field">
      <p style="color:var(--text-dim);margin:0 0 12px">
        Linking <strong>${intZone?.name || interiorZoneId}</strong> to
        <strong>${extZone?.name || exteriorZoneId}</strong>.<br>
        Choose the exit direction from the exterior zone into this interior.
      </p>
      <label>Entrance direction</label>
      <select id="int-link-dir">
        ${entranceDirs.map(d => `<option value="${d}"${d === 'in' ? ' selected' : ''}>${d}</option>`).join('')}
      </select>
    </div>
    <div class="field" style="margin-top:12px">
      <label>Hallway stacking direction</label>
      <p style="color:var(--text-dim);font-size:11px;margin:2px 0 6px">Direction hallways extend from the lobby — each floor/corridor is placed one step further in this direction.</p>
      <select id="int-link-stack-dir">
        ${stackDirs.map(d => `<option value="${d}"${d === 'up' ? ' selected' : ''}>${d}</option>`).join('')}
      </select>
    </div>
  `);
  document.getElementById('modal-save').onclick = async () => {
    const dir = document.getElementById('int-link-dir').value;
    const stackDir = document.getElementById('int-link-stack-dir').value;
    closeModal();
    await linkInteriorToExterior(interiorZoneId, exteriorZoneId, dir, stackDir);
  };
}

async function linkInteriorToExterior(interiorZoneId, exteriorZoneId, dir, hallwayDir) {
  const r = await API('/maps/link-interior', 'POST', { exteriorZoneId, interiorZoneId, direction: dir, hallwayDir: hallwayDir || null });
  if (r?.error) { toast(r.error, true); return; }

  const interiorMap = r.interiorMap;
  const laid = r.layoutCount || 0;
  toast(`Interior linked${laid ? ` — ${laid} zone${laid !== 1 ? 's' : ''} auto-laid out` : ''}. Opening interior editor…`);

  mapViewTab = 'interior';
  mapSelectedInteriorId = interiorMap.id;
  if (!mapsList.find(m => m.id === interiorMap.id)) mapsList.push(interiorMap);
  // Reload from server so the auto-layout is reflected immediately
  await loadMapOverview(interiorMap.id);
}

async function switchMapTab(tab, interiorId) {
  mapViewTab = tab;
  if (tab === 'exterior') {
    const extId = mapsList.find(m => m.id === 'map_world')?.id || mapsList.find(m => !m.parent_zone_id)?.id || mapsList[0]?.id;
    mapExteriorMapId = extId;
    await loadMapOverview(extId);
    return;
  }
  // Interior tab: refresh mapsList so the dropdown is always current.
  const mapsData = await API('/maps');
  if (!mapsData?.error) {
    mapsList = Array.isArray(mapsData) ? mapsData : [];
  }
  const intMaps = mapsList.filter(m => m.parent_zone_id);
  const intBuildingIds = new Set(intMaps.map(m => m.parent_zone_id));
  const unmappedBuildings = _exteriorBuildingZones.filter(z => !intBuildingIds.has(z.id));
  const allIntIds = [...intMaps.map(m => m.id), ...unmappedBuildings.map(z => 'bz:' + z.id)];
  if (interiorId) {
    mapSelectedInteriorId = interiorId;
  } else if (!mapSelectedInteriorId || !allIntIds.includes(mapSelectedInteriorId)) {
    mapSelectedInteriorId = allIntIds[0] || null;
  }
  if (mapSelectedInteriorId) {
    await switchInteriorMap(mapSelectedInteriorId);
  } else {
    // No interiors exist — show placeholder using existing mapOverview (exterior data)
    renderMapOverview();
  }
}

async function mapDeleteInterior() {
  const o = mapOverview;
  if (!o?.map?.id || !o.map.parent_zone_id) return; // only for interior maps
  const mapId = o.map.id;
  const mapName = o.map.name;
  if (!(await dpConfirm(`Delete "${mapName}" and all its zones? This cannot be undone.`, { danger: true }))) return;
  const res = await directAPI(`/maps/${mapId}`, 'DELETE');
  if (res?.error) { await dpAlert(res.error); return; }
  // Switch back to the world map and refresh
  mapSelectedInteriorId = null;
  mapsList = mapsList.filter(m => m.id !== mapId);
  const worldId = mapsList.find(m => m.id === 'map_world')?.id || mapsList.find(m => !m.parent_zone_id)?.id || mapsList[0]?.id;
  if (worldId) await loadMapOverview(worldId);
}

async function switchInteriorMap(id) {
  mapSelectedInteriorId = id;
  if (id.startsWith('bz:')) {
    const zoneId = id.slice(3);
    const bz = _exteriorBuildingZones.find(z => z.id === zoneId);
    if (bz) {
      const pseudoZone = { ...bz, grid_x: 0, grid_y: 0, grid_z: 0, map_id: id };
      mapOverview = { map: { id, name: bz.name + ' (Interior)', parent_zone_id: bz.id }, zones: new Map([[zoneId, pseudoZone]]), unplaced: new Map(), unplacedInterior: new Map(), children: [], z: 0 };
      renderMapOverview();
    }
    return;
  }
  await loadMapOverview(id);
}

async function mapDrop(e, x, y) {
  e.preventDefault();
  if (!mapDragId) return;
  const o = mapOverview;
  const occupied = [...o.zones.values()].find(z => (z.grid_z ?? 0) === o.z && z.grid_x === x && z.grid_y === y);

  // Interior zone dragged from tray — must land on an existing exterior tile
  if (mapDragIsInterior) {
    mapDragIsInterior = false;
    const intId = mapDragId; mapDragId = null; mapDragFromTray = false;
    if (!occupied) { toast('Drop interior zones onto an existing exterior zone tile to link them.', true); return; }
    openInteriorLinkModal(intId, occupied.id);
    return;
  }

  if (occupied && occupied.id !== mapDragId) { toast('That cell is occupied.', true); mapDragId = null; return; }

  const draggedId = mapDragId, fromTray = mapDragFromTray;
  mapDragId = null; mapDragFromTray = false;

  if (fromTray) {
    // Adopt the unplaced zone onto this map at the dropped cell.
    const z = o.unplaced.get(draggedId);
    o.unplaced.delete(draggedId);
    o.zones.set(draggedId, { ...z, map_id: o.map.id, grid_x: x, grid_y: y, grid_z: o.z });
  } else {
    const z = o.zones.get(draggedId);
    z.grid_x = x; z.grid_y = y; z.grid_z = o.z; z.map_id = o.map.id;
  }

  // Auto-connect to orthogonally adjacent zones on the same floor. Remove
  // unwanted links afterward via the gap slots.
  const movedZone = o.zones.get(draggedId);
  const touched = new Set([draggedId]);
  for (const [dir, off] of Object.entries(MAP_DIR3D)) {
    if (off[2] !== 0) continue; // skip up/down — those are manual
    const neighbor = [...o.zones.values()].find(z => z.id !== draggedId && (z.grid_z ?? 0) === o.z && z.grid_x === x + off[0] && z.grid_y === y + off[1]);
    if (!neighbor) continue;
    const opp = MAP_OPP[dir];
    movedZone.exits[dir] = neighbor.id;
    neighbor.exits[opp] = draggedId;
    touched.add(neighbor.id);
  }

  renderMapOverview();

  // Persist immediately through the staging-aware API() — each touched zone's
  // position + exits stage into the Changes panel for review/publish.
  const results = await Promise.all([...touched].map(id => {
    const z = o.zones.get(id);
    return API(`/zones/${id}`, 'PUT', { grid_x: z.grid_x, grid_y: z.grid_y, grid_z: z.grid_z ?? 0, map_id: z.map_id, exits: z.exits });
  }));
  const failed = results.find(r => r?.error);
  if (failed) { toast(failed.error, true); await loadMapOverview(o.map.id); return; }
  toast('Moved ✓');
  updateStagingBadge();
}


async function createZoneAt(x, y) {
  if (!mapsGuard()) return;
  pendingZonePlacement = { map_id: mapOverview.map.id, grid_x: x, grid_y: y, grid_z: mapOverview.z };
  const data = await PANELS.zones.fetch();
  allRecords = Array.isArray(data) ? data : (data.zones || []);
  currentPanel = 'zones';
  mapZoneEditReturn = true;
  const existingColors = allRecords.filter(z => z.map_id === mapOverview.map.id).map(z => z.color).filter(Boolean);
  newRecord({ color: suggestZoneColor(existingColors) });
}

// --- Power tab — embedded version of the same grid, toggleable between
// power coloring and the regular danger-rating coloring, plus a generator
// list with quick-remove. ---
