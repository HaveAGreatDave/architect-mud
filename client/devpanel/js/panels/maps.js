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
        const cpGen = bigMapGenerators.find(g => g.zone_id === z.id && g.generator_type === 'city_plant');
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
          const effectiveStatus = isBrownout ? 'overloaded' : status;
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
      html += `<div class="${cls}" style="${tileStyle}" title="${z.id}"${click}><div>${marker}${z.name}${sub}</div></div>`;
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
  bigMapZones = mapData.zones || [];
  bigMapPowerData = Array.isArray(powerMap) ? powerMap : [];
  bigMapGenerators = Array.isArray(generators) ? generators : [];
  bigMapOverlayZ = 0;
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
    floorCtrl.innerHTML = floors.length > 1
      ? `<button class="action-btn" onclick="changeBigMapFloor(-1)">▾</button>
         <span style="font-size:11px;color:var(--text-dim);min-width:48px;text-align:center">z = ${bigMapOverlayZ}</span>
         <button class="action-btn" onclick="changeBigMapFloor(1)">▴</button>`
      : '';
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
        const cpGen = bigMapGenerators.find(g => g.zone_id === z.id && g.generator_type === 'city_plant');
        if (cpGen) {
          const used = Number(cpGen.total_demand_w ?? 0);
          const overdrawn = used > Number(cpGen.capacity_kw);
          const cpStatus = Number(cpGen.capacity_kw) === 0 ? 'offline' : cpGen.status !== 'online' ? 'offline' : overdrawn ? 'overloaded' : '';
          cls = `bigmap-tile bm-power-plant${cpStatus ? ' bm-power-' + cpStatus : ''}`;
          powerSub = `<div style="font-size:9px;opacity:0.9;margin-top:2px">⚡ ${used.toFixed(0)}/${Number(cpGen.capacity_kw).toFixed(0)}W</div>`;
        } else {
          const zStatus = p ? p.status : 'unpowered';
          cls = `bigmap-tile bm-power-${zStatus}`;
          if (p) powerSub = `<div style="font-size:9px;opacity:0.8;margin-top:2px">${(p.loadKw??0).toFixed(1)}W load / ${(p.availableKw??0).toFixed(1)}W draw</div>`;
        }
      }

      html += `<div class="${cls}" style="${gs}${colorStyle}" title="${z.id}" onclick="bigMapTileClick('${z.id}')"><div>${dive}${marker}${z.name}${exHtml}${powerSub}</div></div>`;
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
  document.getElementById('bigmap-grid').innerHTML = html;
  document.getElementById('bigmap-legend').innerHTML = mapLegendHtml(bigMapOverlayMode);
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
  if (g('f-danger_rating')) z.danger_rating = g('f-danger_rating').value;
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
  _mapPendingOverrides.set(currentRecord.id, { color, bg_color, marker });
  if (currentPanel === 'maps') renderMapOverview();
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

function mapsGuard() { return true; }

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
    for (const [dir, target] of Object.entries(z.exits || {})) {
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
  const o = mapOverview;
  const panel = document.getElementById('list-panel');
  const all = [...o.zones.values()];
  const floors = [...new Set(all.map(z => z.grid_z ?? 0))].sort((a, b) => a - b);
  const onFloor = all.filter(z => (z.grid_z ?? 0) === o.z && z.grid_x != null && z.grid_y != null);
  const knownZoneIds = new Set((Array.isArray(allRecords) ? allRecords : []).map(z => z.id));
  const interiorZoneIds = new Set([
    ...o.unplacedInterior.keys(),
    ...o.children.map(c => c.entry_zone_id).filter(Boolean),
    ...(o.buildingZoneIds || []),
    o.map?.parent_zone_id,  // interior maps: parent exterior zone is a valid cross-map exit target
  ].filter(Boolean));
  const { errors, oneWay } = validateMapOverview(o.zones, knownZoneIds, interiorZoneIds);
  const broken = new Set(errors.map(e => e.zoneId));
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
      <span style="margin-left:6px">Floor</span>
      <button class="action-btn" onclick="changeFloor(-1)">▾</button>
      <span style="min-width:60px;text-align:center">z = ${o.z}</span>
      <button class="action-btn" onclick="changeFloor(1)">▴</button>
    </div>`;
  } else {
    html += `<div class="map-toolbar">
      <span style="color:var(--text-bright);font-weight:600;font-size:13px">${o.map.name}</span>
      <span style="margin-left:auto">Floor</span>
      <button class="action-btn" onclick="changeFloor(-1)">▾</button>
      <span style="min-width:60px;text-align:center">z = ${o.z}</span>
      <button class="action-btn" onclick="changeFloor(1)">▴</button>
    </div>`;
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

  html += `<div style="padding:12px;overflow:auto" ondragover="event.preventDefault()" ondrop="mapGridDrop(event)"><div style="display:grid;grid-template-columns:${colTmpl};grid-template-rows:${rowTmpl}">`;

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
  html += `</div></div>`;

  // Unplaced-zones tray:
  const trayChip = (z, dragFn) => `<span class="bigmap-tile bm-edit" style="width:auto;height:auto;padding:4px 8px;cursor:grab;flex-shrink:0${zoneColorStyle(z)}" draggable="true" ondragstart="${dragFn}(event,'${z.id}')" title="${z.id}">${z.name}</span>`;

  if (mapViewTab === 'interior') {
    // Interior tray: rooms with no grid position OR no exits established,
    // plus any interior/apartment rooms that aren't on any map at all.
    // Rooms in o.zones with no grid position are already map-assigned — drag them
    // with mapDragStart (repositioning flow) not mapTrayDragStart (tray/unplaced flow).
    const onMap = [...o.zones.values()].filter(z => z.grid_x == null || Object.keys(z.exits || {}).length === 0);
    const orphaned = [...(o.unplacedInterior?.values() || [])].filter(z => !z.flags?.is_building && !o.zones.has(z.id));
    const needsAttention = [...onMap, ...orphaned];
    html += `<div style="padding:0 12px 14px;border-top:1px solid var(--border);margin-top:8px">
      <div style="font-size:11px;font-weight:600;color:var(--accent);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;padding-top:10px">Unplaced / No Exits</div>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px">Rooms with no grid position or no exits. Drag unplaced rooms onto an empty cell to place.</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${needsAttention.length
        ? needsAttention.map(z => trayChip(z, o.zones.has(z.id) ? 'mapDragStart' : 'mapTrayDragStart')).join('')
        : `<span style="color:var(--text-dim);font-style:italic;font-size:11px">None — all rooms are placed and connected.</span>`
      }</div>
    </div>`;
  } else {
    const extTray = [...o.unplaced.values()];
    const noPosition = [...o.zones.values()].filter(z => z.grid_x == null && !z.flags?.is_interior && !z.flags?.is_apartment && !z.flags?.is_building);
    const disconnected = [...o.zones.values()].filter(z => Object.keys(z.exits || {}).length === 0 && z.grid_x != null);
    const allExtUnplaced = [...extTray, ...noPosition].sort((a, b) => a.name.localeCompare(b.name));
    const intUnplaced = [...(o.unplacedInterior?.values() || [])];
    const unplacedBuildings = intUnplaced.filter(z => z.flags?.is_building);
    const orphanedRooms = intUnplaced.filter(z => !z.flags?.is_building);
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
      <div style="font-size:11px;font-weight:600;color:var(--yellow);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Orphaned Interior Rooms</div>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px">Interior rooms with no map and no exits — open each to wire up its exits to a parent zone.</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${orphanedRooms.length
        ? orphanedRooms.map(roomChip).join('')
        : `<span style="color:var(--text-dim);font-style:italic;font-size:11px">None.</span>`
      }</div>
    </div>`;
  }
  panel.innerHTML = html;
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
  const dirs = ['in','out','north','south','east','west','up','down'];
  openModal(`Link to ${extZone?.name || exteriorZoneId}`, `
    <div class="field">
      <p style="color:var(--text-dim);margin:0 0 12px">
        Linking <strong>${intZone?.name || interiorZoneId}</strong> to
        <strong>${extZone?.name || exteriorZoneId}</strong>.<br>
        Choose the exit direction from the exterior zone into this interior.
      </p>
      <label>Entrance direction</label>
      <select id="int-link-dir">
        ${dirs.map(d => `<option value="${d}"${d === 'in' ? ' selected' : ''}>${d}</option>`).join('')}
      </select>
    </div>
  `);
  document.getElementById('modal-save').onclick = async () => {
    const dir = document.getElementById('int-link-dir').value;
    closeModal();
    await linkInteriorToExterior(interiorZoneId, exteriorZoneId, dir);
  };
}

async function linkInteriorToExterior(interiorZoneId, exteriorZoneId, dir) {
  const intZone = mapOverview.unplacedInterior?.get(interiorZoneId);
  const r = await API('/maps/link-interior', 'POST', { exteriorZoneId, interiorZoneId, direction: dir });
  if (r?.error) { toast(r.error, true); return; }

  const interiorMap = r.interiorMap;
  mapOverview.unplacedInterior?.delete(interiorZoneId);
  // Update exterior zone exits in-memory so the exterior view reflects the link
  const extZone = mapOverview.zones.get(exteriorZoneId);
  if (extZone) extZone.exits[dir] = interiorZoneId;
  toast(`Interior linked! Opening interior editor…`);

  // Build interior map overview from what we know — the server has committed
  // everything, but reloading via loadMapOverview would show empty (the zone's
  // map_id was just set so it appears now, but entry zone is at 0,0,0).
  const entryZone = {
    ...(intZone || { id: interiorZoneId, name: interiorZoneId, exits: {}, danger_rating: 'safe' }),
    map_id: interiorMap.id, grid_x: 0, grid_y: 0, grid_z: 0,
    flags: { is_interior: true },
  };
  mapViewTab = 'interior';
  mapSelectedInteriorId = interiorMap.id;
  if (!mapsList.find(m => m.id === interiorMap.id)) mapsList.push(interiorMap);
  mapOverview = { map: interiorMap, zones: new Map([[interiorZoneId, entryZone]]), unplaced: new Map(), unplacedInterior: new Map(), children: [], z: 0 };
  renderMapOverview();
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
  if (!confirm(`Delete "${mapName}" and all its zones? This cannot be undone.`)) return;
  const res = await directAPI(`/maps/${mapId}`, 'DELETE');
  if (res?.error) { alert(res.error); return; }
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
