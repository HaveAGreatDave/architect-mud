// --- Map scale (shared by the Maps big-map overlay and the Power panel grids) ---
// 'fit'  = shrink the whole grid so every tile is visible on screen without scrolling (default)
// 'full' = native tile size (scroll to see the rest)
let mapScaleMode = (() => { try { return localStorage.getItem('devMapScaleMode') || 'fit'; } catch { return 'fit'; } })();

function setMapScaleMode(mode) {
  mapScaleMode = mode;
  try { localStorage.setItem('devMapScaleMode', mode); } catch {}
  const overlay = document.getElementById('bigmap-overlay');
  if (overlay && overlay.classList.contains('active')) renderBigMapOverlay();
  else if (typeof currentPanel !== 'undefined' && currentPanel === 'power') renderPowerPanelBody();
  else if (typeof currentPanel !== 'undefined' && currentPanel === 'maps') renderMapOverview();
}

function mapScaleControlHtml() {
  const fit = mapScaleMode === 'fit';
  return `<div class="map-scale-ctrl" style="display:flex;align-items:center;gap:4px">
    <span style="font-size:10px;color:var(--text-dim);letter-spacing:1px">SCALE</span>
    <button class="action-btn${fit ? ' primary' : ''}" onclick="setMapScaleMode('fit')" title="Shrink the map so every tile fits on screen">Fit</button>
    <button class="action-btn${fit ? '' : ' primary'}" onclick="setMapScaleMode('full')" title="Native tile size (scroll to see the rest)">Full</button>
  </div>`;
}

function wrapMapScale(gridHtml) {
  return `<div class="map-scale-viewport"><div class="map-scale-inner">${gridHtml}</div></div>`;
}

// Post-render: in 'fit' mode, measure each grid and CSS-transform it down to fit its container.
function applyMapScale(root) {
  const scope = root || document;
  scope.querySelectorAll('.map-scale-viewport').forEach(vp => {
    const inner = vp.querySelector('.map-scale-inner');
    if (!inner) return;
    inner.style.transform = 'none';
    if (mapScaleMode !== 'fit') { vp.style.height = ''; vp.style.overflow = 'auto'; return; }
    const natW = inner.scrollWidth, natH = inner.scrollHeight;
    if (!natW || !natH) return;
    const availW = vp.clientWidth || (vp.parentElement && vp.parentElement.clientWidth) || natW;
    const availH = Math.max(200, window.innerHeight - vp.getBoundingClientRect().top - 90);
    const factor = Math.min(availW / natW, availH / natH, 1);
    inner.style.transformOrigin = 'top left';
    inner.style.transform = `scale(${factor})`;
    vp.style.height = (natH * factor) + 'px';
    vp.style.overflow = 'hidden';
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
  if (!mapData || mapData.error) { toast('Could not load map data', true); return; }
  bigMapOverlayData = {
    map: mapData.map,
    zones: new Map((mapData.zones || []).map(z => [z.id, { ...z, exits: z.exits || {}, grid_z: z.grid_z ?? 0 }])),
    children: mapData.children || [],
  };
  for (const [zoneId, overrides] of _mapPendingOverrides) {
    const z = bigMapOverlayData.zones.get(zoneId);
    if (z) Object.assign(z, overrides);
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
let mapDragId = null;
let mapDragFromTray = false;
let mapDragIsInterior = false;
let mapViewTab = 'exterior';      // 'exterior' | 'interior'
let mapExteriorMapId = null;      // last-loaded exterior map id, so we can return from interior view
let mapSelectedInteriorId = null;
let mapInteriorsList = [];        // interior maps (parent_zone_id != null)
let _exteriorBuildingZones = [];  // building zones from the exterior map, for interior tab dropdown
let _mapPendingOverrides = new Map(); // zoneId → {color,bg_color,marker} for staged-but-unpublished zone edits
let mapSafeZoneMode = false;   // true while the Sanctuary paint tool is active
let mapSafeZonePainting = false; // mouse button down, actively dragging a paint stroke
let mapSafeZonePaintValue = null; // true = attaching the sanctuary tag this stroke, false = clearing
let mapSafeZonePendingSaves = new Set(); // zoneIds with an in-flight/queued save, to avoid dupe writes mid-drag

function mapsGuard() { return true; }

function toggleSafeZoneMode() {
  mapSafeZoneMode = !mapSafeZoneMode;
  if (mapSafeZoneMode) mapPaintMode = false;
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
  if (mapPaintMode) { mapSafeZoneMode = false; mapUndoStack = []; mapRedoStack = []; }
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

async function renderMapsPanel(data) {
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
  mapOverview = { map: data.map, zones, unplaced, unplacedInterior, children: data.children || [], buildingZoneIds: data.buildingZoneIds || [], z: keepZ };
  if (!data.map.parent_zone_id) {
    _exteriorBuildingZones = (data.zones || []).filter(z => z.flags?.is_building);
  }
  // Re-apply any staged-but-unpublished color/marker changes so the map stays in sync
  // even after a fresh fetch (tab switch, panel reload, etc.)
  for (const [zoneId, overrides] of _mapPendingOverrides) {
    const z = zones.get(zoneId);
    if (z) Object.assign(z, overrides);
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
  // Scope the exterior editor to the new district (the bp_district planner grid). The
  // world map still carries legacy zones parked near the origin (~900 tiles away), and
  // spanning both clusters would blow the grid up to ~900×900 mostly-empty cells. When
  // there's no district grid (e.g. an interior map), show everything as before.
  const districtZones = all.filter(z => z.flags?.planner === 'bp_district' && z.grid_x != null);
  let dbbox = null;
  if (districtZones.length) {
    const dxs = districtZones.map(z => z.grid_x), dys = districtZones.map(z => z.grid_y);
    dbbox = { minX: Math.min(...dxs), maxX: Math.max(...dxs), minY: Math.min(...dys), maxY: Math.max(...dys) };
  }
  const inDistrict = z => !dbbox || (z.grid_x >= dbbox.minX && z.grid_x <= dbbox.maxX && z.grid_y >= dbbox.minY && z.grid_y <= dbbox.maxY);
  const floors = [...new Set(all.filter(inDistrict).map(z => z.grid_z ?? 0))].sort((a, b) => a - b);
  const onFloor = all.filter(z => (z.grid_z ?? 0) === o.z && z.grid_x != null && z.grid_y != null && inDistrict(z));
  const knownZoneIds = new Set((Array.isArray(allRecords) ? allRecords : []).map(z => z.id));
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

  // Toolbar
  let html = subTabHtml;
  if (mapViewTab === 'interior' && !mapSelectedInteriorId) {
    html += `<div style="padding:32px 24px;color:var(--text-dim);font-size:13px">
      No interior maps yet.<br><br>
      Switch to <strong>Exterior</strong>, then drag an <strong>Unplaced Interior Zone</strong> from the tray onto any exterior zone tile to link it and create an interior map.
    </div>`;
    panel.innerHTML = html;
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
    html += `<div class="map-toolbar">
      <label>Interior</label>
      <select onchange="switchInteriorMap(this.value)">${intOpts}</select>
      <button class="action-btn danger" style="font-size:10px;padding:2px 8px" onclick="mapDeleteInterior()" title="Delete this interior map and all its zones">Delete Map</button>
      <button class="action-btn${mapSafeZoneMode ? ' active' : ''}" style="font-size:10px;padding:2px 8px${mapSafeZoneMode ? ';background:var(--accent);color:#111' : ''}" onclick="toggleSafeZoneMode()" title="Paint zones as Safe (police cameras present) or not">${mapSafeZoneMode ? '✓ Painting Safe Zones' : 'Paint Safe Zones'}</button>
      <button class="action-btn${mapPaintMode ? ' active' : ''}" style="font-size:10px;padding:2px 8px;margin-left:6px${mapPaintMode ? ';background:var(--accent);color:#111' : ''}" onclick="togglePaintMode()" title="Paint zone colours with a floating palette (brush, fill, luminance)">${mapPaintMode ? '✓ Painting Colours' : '🎨 Paint Colours'}</button>
      <span style="margin-left:6px">Floor</span>
      <button class="action-btn" onclick="changeFloor(-1)">▾</button>
      <span style="min-width:60px;text-align:center">z = ${o.z}</span>
      <button class="action-btn" onclick="changeFloor(1)">▴</button>
      <span style="margin-left:14px">${mapScaleControlHtml()}</span>
    </div>`;
  } else {
    html += `<div class="map-toolbar">
      <span style="color:var(--text-bright);font-weight:600;font-size:13px">${o.map.name}</span>
      <button class="action-btn${mapSafeZoneMode ? ' active' : ''}" style="font-size:10px;padding:2px 8px;margin-left:12px${mapSafeZoneMode ? ';background:var(--accent);color:#111' : ''}" onclick="toggleSafeZoneMode()" title="Paint zones as Safe (police cameras present) or not">${mapSafeZoneMode ? '✓ Painting Safe Zones' : 'Paint Safe Zones'}</button>
      <button class="action-btn${mapPaintMode ? ' active' : ''}" style="font-size:10px;padding:2px 8px;margin-left:6px${mapPaintMode ? ';background:var(--accent);color:#111' : ''}" onclick="togglePaintMode()" title="Paint zone colours with a floating palette (brush, fill, luminance)">${mapPaintMode ? '✓ Painting Colours' : '🎨 Paint Colours'}</button>
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
  html += `<div style="color:var(--text-dim);margin-top:6px;font-size:10px">Drag to move · click zone to edit · click gap to connect/disconnect · click empty cell to create. Exit badges: <span style="color:var(--cyan)">▲▼</span> = up/down, <span style="color:#ff3b5c">red</span> = geometry error.</div>`;
  html += `</div>`;

  // Grid — pad by one cell so there are empty cells to place new zones into.
  // Bounds are computed across ALL floors so the grid stays the same size when
  // switching z-levels, meaning (x,y) positions align visually between floors.
  const allPlaced = all.filter(z => z.grid_x != null && z.grid_y != null);
  let minX, maxX, minY, maxY;
  if (allPlaced.length) {
    const xs = allPlaced.map(z => z.grid_x), ys = allPlaced.map(z => z.grid_y);
    minX = Math.min(...xs) - 1; maxX = Math.max(...xs) + 1;
    minY = Math.min(...ys) - 1; maxY = Math.max(...ys) + 1;
  } else { minX = -1; maxX = 1; minY = -1; maxY = 1; }
  const byCoord = new Map(onFloor.map(z => [`${z.grid_x},${z.grid_y}`, z]));

  // Per-direction broken set, so a cell's exit readout can flag the bad ones.
  const brokenByZone = new Map();
  for (const e of errors) { if (!brokenByZone.has(e.zoneId)) brokenByZone.set(e.zoneId, new Set()); brokenByZone.get(e.zoneId).add(e.direction); }

  // Expanded grid: cells sit at even slots, with a connection slot in the gap
  // between every pair of orthogonally-adjacent cells.
  const W = maxX - minX + 1, H = maxY - minY + 1;
  const colTmpl = Array.from({ length: 2 * W - 1 }, (_, i) => i % 2 ? '16px' : '110px').join(' ');
  const rowTmpl = Array.from({ length: 2 * H - 1 }, (_, i) => i % 2 ? '16px' : '76px').join(' ');
  const col = x => 2 * (x - minX) + 1, row = y => 2 * (y - minY) + 1;
  const cellStyle = (x, y, extra = '') => `style="grid-column:${col(x)};grid-row:${row(y)}${extra}"`;

  html += `<div id="bigmap-grid-scroll" style="padding:12px;overflow:auto" ondragover="event.preventDefault()" ondrop="mapGridDrop(event)"><div class="map-scale-viewport"><div class="map-scale-inner"><div style="display:grid;grid-template-columns:${colTmpl};grid-template-rows:${rowTmpl}">`;

  // Cells (and empty/create slots)
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const z = byCoord.get(`${x},${y}`);
      if (!z) {
        html += `<div class="bigmap-tile-create" ${cellStyle(x, y)} data-map-cell="${x},${y}" ondragover="event.preventDefault()" onclick="createZoneAt(${x},${y})">+</div>`;
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

      const colorStyle = zoneColorStyle(z);
      const child = o.children.find(c => c.parent_zone_id === z.id);
      const dive = child ? `<span class="map-dive-btn" title="Dive into ${child.name}" onclick="event.stopPropagation();diveInto('${z.id}')">⤵</span>` : '';
      const marker = z.marker ? `<span class="map-marker-badge">${z.marker}</span>` : '';
      const bset = brokenByZone.get(z.id) || new Set();
      const exitDirs = Object.keys(z.exits || {});
      const exHtml = exitDirs.length ? `<div class="cell-exits">${exitDirs.map(d => {
        const cl = bset.has(d) ? 'ex-broken' : ((d === 'up' || d === 'down') ? 'ex-vert' : '');
        const sym = d === 'up' ? '▲' : d === 'down' ? '▼' : d[0].toUpperCase();
        return `<span class="${cl}">${sym}</span>`;
      }).join(' ')}</div>` : '';
      html += `<div class="${cls}" ${cellStyle(x, y, colorStyle)} data-map-cell="${x},${y}" title="${z.id}" draggable="true" ondragstart="mapDragStart(event,'${z.id}')" ondragover="event.preventDefault()" onclick="mapTileEditClick('${z.id}')"><div>${dive}${marker}${z.name}${exHtml}</div></div>`;
    }
  }

  // Connection slots between adjacent cells.
  const connHtml = (a, b, dir, orient, gridStyle) => {
    if (!a || !b) return `<div class="conn conn-${orient}" style="${gridStyle}"></div>`;
    const opp = MAP_OPP[dir];
    const aToB = a.exits[dir] === b.id, bToA = b.exits[opp] === a.id;
    const click = ` onclick="mapToggleConn('${a.id}','${b.id}','${dir}')"`;
    const title = ` title="${a.name} ↔ ${b.name}"`;
    if (aToB && bToA) return `<div class="conn conn-${orient} conn-linked" style="${gridStyle}"${click}${title}><span class="ln"></span></div>`;
    if (aToB || bToA) {
      const arrow = orient === 'h' ? (aToB ? '▸' : '◂') : (aToB ? '▾' : '▴');
      return `<div class="conn conn-${orient} conn-oneway" style="${gridStyle}"${click} title="one-way: ${aToB ? a.name + '→' + b.name : b.name + '→' + a.name}">${arrow}</div>`;
    }
    return `<div class="conn conn-${orient} conn-open" style="${gridStyle}"${click}${title}><span class="ln"></span></div>`;
  };
  for (let y = minY; y <= maxY; y++) for (let x = minX; x < maxX; x++) {
    html += connHtml(byCoord.get(`${x},${y}`), byCoord.get(`${x + 1},${y}`), 'east', 'h', `grid-column:${col(x) + 1};grid-row:${row(y)}`);
  }
  for (let y = minY; y < maxY; y++) for (let x = minX; x <= maxX; x++) {
    html += connHtml(byCoord.get(`${x},${y}`), byCoord.get(`${x},${y + 1}`), 'south', 'v', `grid-column:${col(x)};grid-row:${row(y) + 1}`);
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
  // Preserve scroll across the full innerHTML rebuild so paint-drag strokes
  // (which re-render on every tile) don't yank the view back to the top.
  const prevPanelTop = panel.scrollTop, prevPanelLeft = panel.scrollLeft;
  const prevGrid = document.getElementById('bigmap-grid-scroll');
  const prevGridLeft = prevGrid?.scrollLeft || 0, prevGridTop = prevGrid?.scrollTop || 0;
  panel.innerHTML = html;
  panel.scrollTop = prevPanelTop;
  panel.scrollLeft = prevPanelLeft;
  const newGrid = document.getElementById('bigmap-grid-scroll');
  if (newGrid) { newGrid.scrollLeft = prevGridLeft; newGrid.scrollTop = prevGridTop; }
  applyMapScale(panel);
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

// Toggle a reciprocal connection between two adjacent zones from the gap slot.
// Saves immediately so the Zones panel stays in sync without needing Save Layout.
async function mapToggleConn(aId, bId, dir) {
  const o = mapOverview;
  const a = o.zones.get(aId), b = o.zones.get(bId);
  if (!a || !b) return;
  const opp = MAP_OPP[dir];
  const wasLinked = a.exits[dir] === bId || b.exits[opp] === aId;
  if (wasLinked) { delete a.exits[dir]; delete b.exits[opp]; }
  else { a.exits[dir] = bId; b.exits[opp] = aId; }
  renderMapOverview();
  const [ra, rb] = await Promise.all([
    API(`/zones/${aId}`, 'PUT', { exits: a.exits }),
    API(`/zones/${bId}`, 'PUT', { exits: b.exits }),
  ]);
  if (ra?.error || rb?.error) {
    // Revert in-memory on failure
    if (wasLinked) { a.exits[dir] = bId; b.exits[opp] = aId; }
    else { delete a.exits[dir]; delete b.exits[opp]; }
    renderMapOverview();
    toast(ra?.error || rb?.error, true);
    return;
  }
  updateStagingBadge();
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
