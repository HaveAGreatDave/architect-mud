// The dev panel's map kit: zoom, tile colours, the plan-map base the Enemies and
// Power panels draw on, and the big-map overlay the NPC and Zones panels open.
// The old Region Maps and World Map editor tabs that grew it are gone; maps are
// edited in the Studio (tools/studio), which writes content/ files.
//
// --- Map zoom (shared by the big-map overlay and the Power panel grids) ---
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

// --- Shared "plan map" base --------------------------------------------------
// One region, one floor, drawn as a deliberately dumb monochrome plan: terrain
// tones only, no names or icons, so a coloured overlay on top is the only thing
// competing for the eye. Two panels draw on it — the Enemies panel's spawn heat
// map and the Power panel's regional grid — and they share this base so the
// terrain palette can't drift into two different pictures of the same city.
//
// ⚠ The bounding-box-of-every-placed-zone grid is what froze the old City Grid
// view at ~888 zones. What makes this shape affordable is that it is bounded to
// ONE region on ONE floor and each cell is a bare few-pixel div — no text, no
// per-cell exits. Keep both of those and it stays fast; widen either and it
// won't.
const PLAN_MAP_INK = '150,190,210';
const PLAN_TERRAIN_TONE = {
  water: 0.10, marsh: 0.13,
  grass: 0.19, park: 0.19, scrub: 0.19,
  sand: 0.24, dirt: 0.24, dirt_road: 0.26, gravel: 0.26, redrock: 0.24, ash: 0.22,
  road: 0.34, asphalt: 0.34, concrete: 0.38, dock: 0.30,
};
const PLAN_TILE_DEFAULT = 0.16;   // placed tile with no authored terrain
const PLAN_TILE_BUILDING = 0.62;  // facades read as solid mass

function planTileIsBuilding(z) {
  return !!(z.flags?.building_type || z.flags?.is_building);
}
function planTileTone(z) {
  if (planTileIsBuilding(z)) return PLAN_TILE_BUILDING;
  if (z.flags?.runway) return 0.42;
  const t = z.flags?.terrain;
  return (t && PLAN_TERRAIN_TONE[t] != null) ? PLAN_TERRAIN_TONE[t] : PLAN_TILE_DEFAULT;
}

// The Under carries no region_id (it's a district, not a region) but it's a whole
// map's worth of world, so it gets its own bucket instead of drowning in the
// unassigned pile beside stray basin tiles.
function planRegionOf(z) {
  return z.flags?.region_id || (z.flags?.district === 'sewer' ? '__under' : '__unassigned');
}
function planRegionName(regions, rid) {
  return rid === '__under' ? 'The Under (sewers)'
    : rid === '__unassigned' ? 'Unassigned tiles'
    : (regions?.get(rid) || rid);
}

// The *tile* a zone should paint onto: its own if it sits on the grid, otherwise
// the facade of the building whose interior map holds it. Walks up through nested
// interior maps so a 4th-floor room still lands on the door. `mapParents` is
// interior map id -> exterior parent zone id.
function planTileZoneFor(zone, zoneById, mapParents) {
  const seen = new Set();
  let z = zone;
  while (z && !seen.has(z.id)) {
    if (planIsPlacedTile(z)) return z;
    seen.add(z.id);
    const parentId = mapParents.get(z.map_id);
    z = parentId ? zoneById.get(parentId) : null;
  }
  return null;
}

// Zones that sit on the grid as actual ground.
// ⚠ `grid_x != null` is NOT sufficient: an interior room carries 0,0 to mean
// UNSET, and ONE such room in a region stretches its bounding box from the
// region's own 93x52 out to 956x948 — nine hundred thousand cells for one
// mis-parked zone. See reference/land-taxonomy.md.
// ⚠ Shared with planTileZoneFor: an interior room parked at 0,0 is NOT a tile,
// so folding must walk PAST it to the facade it hangs off. Returning it as its
// own tile is what left building fronts dark on the power map while the rooms
// behind them were lit.
function planIsPlacedTile(z) {
  return z.grid_x != null && z.grid_y != null
    && !(z.grid_x === 0 && z.grid_y === 0 && (z.flags?.is_interior || z.flags?.is_apartment));
}
function planPlacedTiles(zones) {
  return zones.filter(planIsPlacedTile);
}

// Region buckets that actually hold placed tiles, for a region <select>.
function planRegionBuckets(zones) {
  const byRegion = new Map();
  for (const z of planPlacedTiles(zones)) {
    const rid = planRegionOf(z);
    if (!byRegion.has(rid)) byRegion.set(rid, []);
    byRegion.get(rid).push(z);
  }
  return byRegion;
}

// The grid shell every plan map draws into. ⚠ Place each real tile explicitly
// rather than emitting a div per cell of the bounding box: a region is not
// obliged to be dense, and the empty-cell divs for a sparse one cost far more
// than the tiles do.
function planGridOpen(cols, cell) {
  return `<div style="display:grid;grid-template-columns:repeat(${cols},${cell}px);grid-auto-rows:${cell}px;gap:1px;width:max-content">`;
}
function planCellPos(x, y, minX, minY) {
  return `grid-column:${x - minX + 1};grid-row:${y - minY + 1}`;
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

      html += `<div class="${cls}" style="${gs}${colorStyle}" title="${z.id}" onclick="bigMapTileClick('${z.id}')"><div>${dive}${zoneIconHtml(z)}${marker}${z.name}${exHtml}${powerSub}</div></div>`;
    }
  }

  // Connection slots between neighbouring tiles
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
  editRecord(zoneId);
}

// Swatches the Zones form offers for a tile's colour and background.
const MAP_PALETTE = ['#39ff8f','#28e5ff','#f5e642','#ff9a3c','#ff3b5c','#9b59b6','#7ed321','#888888'];
