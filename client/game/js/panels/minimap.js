// Sidebar minimap (9×9 BFS/grid) and the full-screen map popup.
import { sendCmd, sendCmdSilent } from '../net.js';
import { appendMsg } from '../render.js';
import { state } from '../state.js';

// Avenue View for the sidebar/HUD/mobile minimaps: a rendering toggle (not a
// server round-trip) that strips room symbols down to "does a named artery run
// through here" — || north/south, = east/west, + at a crossing. Persisted, and
// the last node payload is cached so the toggle can re-render without a move.
const MM_AVENUE_KEY = 'mm_avenue';
let mmAvenueView = false; // avenue mode retired — toggle removed, always plain
let _lastMinimapNodes = null;

// Minimap zoom: three levels sharing the same render, differing only in the BFS
// window radius R (fewer tiles = closer) and a matching tile size so each minimap's
// footprint stays ~constant as you zoom. Level 0 (R=4, 9×9) reproduces the CSS
// defaults exactly, so nothing changes at the default zoom. Applies to all three
// minimaps (sidebar / HUD / mobile) since they share one rendered html string.
const MM_ZOOM_KEY = 'mm_zoom';
const MM_ZOOM = [{ R: 4 }, { R: 3 }, { R: 2 }]; // far → near (9×9, 7×7, 5×5)
const MM_GRIDS = [
  { id: 'minimap-grid', base: 1.7 },
  { id: 'minimap-grid-hud', base: 1.4 },
  { id: 'minimap-grid-mob', base: 1.75 },
];
let mmZoom = 0;
try { const z = parseInt(localStorage.getItem(MM_ZOOM_KEY), 10); if (z >= 0 && z < MM_ZOOM.length) mmZoom = z; } catch {}

// Size the grid tracks to the current zoom's window and scale the tile size so the
// grid keeps roughly the same overall footprint. At level 0 scale is 1, so the
// inline values match the CSS and there's no visual change from default.
function applyMinimapZoom() {
  const n = 2 * MM_ZOOM[mmZoom].R + 1;
  const scale = 9 / n;
  for (const { id, base } of MM_GRIDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.style.setProperty('--mm-room', (base * scale).toFixed(3) + 'em');
    el.style.gridTemplateColumns = `repeat(${n}, var(--mm-room))`;
    el.style.gridTemplateRows = `repeat(${n}, var(--mm-room))`;
  }
  const zin = document.getElementById('mm-zoom-in');
  const zout = document.getElementById('mm-zoom-out');
  if (zin) zin.disabled = mmZoom >= MM_ZOOM.length - 1;
  if (zout) zout.disabled = mmZoom <= 0;
}

// +1 = zoom in (closer, smaller R), −1 = zoom out. Clamped; re-renders in place.
function stepMinimapZoom(delta) {
  const next = Math.min(MM_ZOOM.length - 1, Math.max(0, mmZoom + delta));
  if (next === mmZoom) return;
  mmZoom = next;
  try { localStorage.setItem(MM_ZOOM_KEY, String(mmZoom)); } catch {}
  if (_lastMinimapNodes) renderMinimap(_lastMinimapNodes);
  else applyMinimapZoom();
}

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
// Run mode mirrors the server's player.running (source of truth). The Run toggle
// and the `run` command both round-trip through the server, which echoes a
// `run_state` message back into setRunState() to light the button and re-pace
// auto-walk. Kept in sync with the client's cached stamina so auto-walk can tell
// when a runner has gone too winded to keep the pace.
let runMode = false;
const RUN_STEP_STAMINA = 4;        // must match movement.js RUN_STEP_STAMINA
const WALK_STEP_MS = 1000;         // relaxed walking cadence
const RUN_STEP_MS  = 480;          // brisk running cadence
// Delay before the next auto-walk step: run cadence only while running AND with
// stamina left to spend — otherwise a winded runner auto-drops to the walk pace.
function autoWalkDelay() {
  const sta = state.player?.stamina ?? 100;
  return (runMode && sta >= RUN_STEP_STAMINA) ? RUN_STEP_MS : WALK_STEP_MS;
}
function runBtn() { return document.getElementById('mm-run-toggle'); }
// Called from dispatch on a `run_state` message (the server's answer to `run`).
export function setRunState(running) {
  runMode = !!running;
  runBtn()?.classList.toggle('active', runMode);
}

// Auto-walk: steps the player toward the plotted GPS route (mapState.tracePath,
// set by the `gps` command or a clicked map route) one hop at a time, until
// arrival, the route runs out, or the user stops it. Cadence follows run/walk mode.
const DIR_CMDS = ['north', 'south', 'east', 'west', 'up', 'down', 'in', 'out'];
let autoWalkTimer = null;
// The player's standing intent to auto-walk. Distinct from autoWalkTimer (the
// "currently stepping" state): it SURVIVES arriving at a waypoint, so when a quest
// advances a phase and re-plots the route (gps_route resumeAuto), we can pick the
// next leg up without another Auto click. Cleared only by an explicit stop
// (toggle off), a hard error, or the route being cleared.
let autoWalkArmed = false;
// Stuck detection: a step that leaves us in the same room made no progress. The
// only non-erroring way that happens mid-walk is an ambiguous exit throwing a SIFT
// picker (which auto-walk can't answer, so it just re-prompts). Two in a row → stop.
let autoNoProgress = 0;
let autoLastZone = null;
let autoPendingTarget = null; // the zone id the last auto-walk step is trying to reach

function autoWalkBtn() { return document.getElementById('mm-auto-toggle'); }

// An ambiguous-direction move threw a numbered exit picker. Because auto-walk
// already knows the exact next zone id on the route, match it against the picker's
// candidates and answer the matching number ourselves — so the walk flows straight
// through multi-exit junctions instead of stalling. Returns true if we answered
// (the caller then suppresses the picker text). `picker.candidates` is [{n,id}] in
// the same order the [1]/[2] options are rendered.
export function resolveAutoWalkPicker(picker) {
  if (!isAutoWalking() || autoPendingTarget == null) return false;
  const hit = (picker?.candidates || []).find((c) => c.id === autoPendingTarget);
  // The picker only accepts a number on the visible page (SIFT PAGE_SIZE = 5); if
  // our target sits deeper, let it fall through to the stall-and-stop path.
  if (!hit || hit.n == null || hit.n > 5) return false;
  sendCmdSilent(String(hit.n)); // resolves the pending selection → the move completes
  return true;
}

// keepArmed:true is the "arrived at this leg's end but still want to auto-walk the
// next one" case — the timer stops but the intent persists for a resume.
function stopAutoWalk(message, { keepArmed = false } = {}) {
  if (autoWalkTimer) { clearTimeout(autoWalkTimer); autoWalkTimer = null; }
  if (!keepArmed) { autoWalkArmed = false; autoWalkBtn()?.classList.remove('active'); }
  autoNoProgress = 0; autoLastZone = null; autoPendingTarget = null;
  if (message) appendMsg(message, 'system');
}

export function isAutoWalking() { return autoWalkTimer !== null; }

// A quest re-plotted the GPS route for a new phase (gps_route resumeAuto). If the
// player had auto-walk engaged for the prior leg — even if it "arrived" and paused
// between legs — resume walking the fresh route automatically.
export function resumeAutoWalkIfArmed() {
  if (autoWalkArmed && !autoWalkTimer) startAutoWalk();
}

function autoWalkStep() {
  autoWalkTimer = null;
  const current = (_lastMinimapNodes || []).find(n => n.is_current);
  if (!current) { stopAutoWalk('Auto-walk stopped — lost track of where you are.'); return; }
  const path = effectiveTracePath(current.id);
  // Arrived at this leg's end: keep the intent armed so a quest advancing to a new
  // waypoint (gps_route resumeAuto) continues the walk without another Auto click.
  if (!path || path.length < 2) { stopAutoWalk('Auto-walk: arrived.', { keepArmed: true }); return; }

  // Still in the same room as last step = the move didn't take (an ambiguous exit
  // threw a SIFT picker). Tolerate one hiccup; on the second, stop and dismiss the
  // pending picker so it doesn't swallow the player's next input.
  if (autoLastZone === current.id) {
    if (++autoNoProgress >= 2) {
      sendCmdSilent('cancel');
      stopAutoWalk('Auto-walk stopped — the way ahead is ambiguous. Pick an exit yourself.');
      return;
    }
  } else {
    autoNoProgress = 0;
  }
  autoLastZone = current.id;

  const nextId = path[1];
  const dir = Object.entries(current.exits || {}).find(([, id]) => id === nextId)?.[0];
  if (!dir || !DIR_CMDS.includes(dir)) { stopAutoWalk("Auto-walk stopped — can't step off the route from here."); return; }
  autoPendingTarget = nextId; // so an exit picker can be answered toward this zone
  sendCmd(dir);
  autoWalkTimer = setTimeout(autoWalkStep, autoWalkDelay());
}

export function startAutoWalk() {
  // Idempotent — clear any walk already in flight so a fresh route (e.g. the
  // Tablet's Auto button re-plotting) never leaves two step-timers racing.
  if (autoWalkTimer) { clearTimeout(autoWalkTimer); autoWalkTimer = null; }
  const current = (_lastMinimapNodes || []).find(n => n.is_current);
  const path = current ? effectiveTracePath(current.id) : null;
  if (!path || path.length < 2) { appendMsg('Auto-walk: no GPS route plotted.', 'system'); return; }
  autoWalkArmed = true;
  autoNoProgress = 0; autoLastZone = null;
  autoWalkBtn()?.classList.add('active');
  autoWalkStep();
}

// `auto` command / Auto button: toggle the route walk. Armed-but-paused (arrived
// between quest legs) counts as "on" so a click turns the intent fully off.
export function toggleAutoWalk() {
  if (isAutoWalking() || autoWalkArmed) stopAutoWalk('Auto-walk stopped.');
  else startAutoWalk();
}

// Cancel an in-progress (or armed-but-paused) walk from outside the module — a
// typed `stop`, or a blocked move (locked door, encumbrance) echoed back as an
// error. No-ops (and stays silent) if there was nothing to stop.
export function cancelAutoWalk(message) {
  if (!isAutoWalking() && !autoWalkArmed) return false;
  stopAutoWalk(message);
  return true;
}

function wireMinimapAutoToggle() {
  const btn = autoWalkBtn();
  if (btn && !btn._wired) { btn._wired = true; btn.addEventListener('click', toggleAutoWalk); }
  // Run toggle: let the server flip player.running (it echoes run_state back).
  const rbtn = runBtn();
  if (rbtn && !rbtn._wired) { rbtn._wired = true; rbtn.addEventListener('click', () => sendCmd('run')); }
}
// Double-clicking any minimap (sidebar / HUD / mobile) opens the full-screen map.
// Delegated on document so it works no matter when the grids are created.
let _mmDblWired = false;
function wireMinimapDblClick() {
  if (_mmDblWired) return;
  _mmDblWired = true;
  document.addEventListener('dblclick', (e) => {
    if (e.target?.closest?.('#minimap-grid, #minimap-grid-hud, #minimap-grid-mob')) sendCmdSilent('map');
  });
}
function wireMinimapZoom() {
  const zin = document.getElementById('mm-zoom-in');
  const zout = document.getElementById('mm-zoom-out');
  if (zin && !zin._wired) { zin._wired = true; zin.addEventListener('click', () => stepMinimapZoom(1)); }
  if (zout && !zout._wired) { zout._wired = true; zout.addEventListener('click', () => stepMinimapZoom(-1)); }
  applyMinimapZoom(); // apply the persisted level + set initial button disabled states
}
function wireMinimap() { wireMinimapAvenueToggle(); wireMinimapAutoToggle(); wireMinimapDblClick(); wireMinimapZoom(); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireMinimap);
else wireMinimap();

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

  // District clipping: the sidebar shows only YOUR district plus the doors out of
  // it. Any tile in a different district is dropped, except the ones you can step
  // straight into — those render as "gateway" edge markers (see below). This
  // sharpens the sense of crossing between neighborhoods. `gateways` collects the
  // foreign tiles that sit one step across a boundary. (Interiors share one prefix,
  // so inside a building everything is same-district and nothing clips.)
  const curDistrict = current.district?.key || null;
  const inDist = (n) => !curDistrict || n?.district?.key === curDistrict;
  const gateways = new Set();

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

  // Edge-to-edge 1:1: a 9×9 tile window (x,y ∈ −R..R), one cell per tile — tiles
  // touch and roads/buildings render their own icon_svg footprint, so there are no
  // connector/gap cells (mirrors the full-map popup). Gateways: a foreign tile one
  // step across a district boundary from an in-district tile still renders as an edge
  // marker, so crossing between neighborhoods reads.
  const R = MM_ZOOM[mmZoom].R;
  const gCols = 2 * R + 1, gRows = gCols;
  const cell = Array.from({ length: gRows }, () => new Array(gCols).fill(null));
  const inWin = (x, y) => x >= -R && x <= R && y >= -R && y <= R;
  for (const [id, [x, y]] of coords) {
    if (!inWin(x, y)) continue;
    cell[y + R][x + R] = id;
    const node = byId.get(id);
    if (!node || !inDist(node)) continue;
    for (const targetId of Object.values(node.exits || {})) {
      if (!coords.has(targetId)) continue;
      const [tx, ty] = coords.get(targetId);
      if (Math.abs(tx - x) > 1 || Math.abs(ty - y) > 1) continue;
      const tnode = byId.get(targetId);
      if (tnode && !inDist(tnode)) gateways.add(targetId);
    }
  }

  // A named zone-icon SVG (icon_svg → assets/zone-icons/<name>.svg) is the tile's
  // footprint, drawn as a CSS mask so it takes the tile's text colour. Mirrors the
  // full map: the SVG footprint is the base layer in every overlay mode, and the
  // shared overlay setting (mapState.avenueOverlay) paints a 2-letter acronym or a
  // building-type glyph over building tiles on top.
  const iconSvg = (name) => /^[a-z0-9_-]+$/i.test(name || '')
    ? `<span class="mm-icon" style="--zi:url(/assets/zone-icons/${name}.svg)"></span>` : '';
  const overlay = mapState.avenueOverlay || 'icons'; // none | labels | icons
  const baseSym = (node) => iconSvg(node.icon_svg) || (node.enterable
    ? '▣ ' // pass-through building tile: a door you enter, not a room you stand in
    : (node.sanctuary ? '◆ ' : '')); // bare tile — no marker glyph (#, ⸪., …)
  // A tile counts as a building for the overlay if it's an enterable facade, carries a
  // building type, or has a building name — broader than building_type alone so labels
  // still land on buildings the type-detector misses.
  const isBuilding = (node) => !!(node.building_type || node.enterable || node.building_name);
  const symFor = (node) => {
    // Labels: hide the building graphic entirely and show a 2-letter acronym filling the
    // tile square (mm-bld-label turns the tile into a solid labelled box).
    if (overlay === 'labels' && isBuilding(node))
      return `<span class="map-bld-ov map-bld-label">${twoLetterAbbrev(node.building_name || node.name)}</span>`;
    const base = baseSym(node);
    if (overlay === 'none' || !node.building_type) return base;
    const glyph = BUILDING_ICON[node.building_type] || BUILDING_ICON._default;
    return base + `<span class="map-bld-ov map-bld-icon">${glyph}</span>`;
  };
  // Hover tooltip: zone name, its district, street name(s), plus any building(s).
  const titleFor = (node) => {
    const parts = [node.enterable && node.building_name ? `${node.building_name} — enter` : node.name];
    if (node.district?.name) parts.push(node.district.name);
    if (node.artery?.length) parts.push(node.artery.join(' / '));
    if (node.buildings?.length) parts.push(node.buildings.join(', '));
    return escapeHtml(parts.join('\n'));
  };

  // Route trace (shared with the full map): the tiles on the plotted route inside
  // this window are highlighted (mm-trace), matching the full map's tile highlight.
  const traceSet = new Set(effectiveTracePath(current.id) || []);

  let html = '';
  for (let r = 0; r < gRows; r++) {
    for (let c = 0; c < gCols; c++) {
      const id = cell[r][c];
      if (!id) { html += `<span class="mm-c mm-void"></span>`; continue; }
      const node = byId.get(id);
      if (!node) { html += `<span class="mm-c mm-void"></span>`; continue; }
      const traceCls = traceSet.has(id) ? ' mm-trace' : '';
      if (node.is_current) {
        // Render the tile you're standing on (its terrain fill / authored colour)
        // UNDER the "you are here" beacon, so the marker reads as a locator on a
        // visible tile rather than a blank swatch. The beacon (mm-current ::before/
        // ::after) is a small centred dot+ring, so the tile shows around it.
        const cs = [];
        const cterr = TERRAIN.has(node.terrain) ? node.terrain : null;
        if (cterr === 'road') cs.push(`background-color:${ROAD_SURFACE}`);
        else if (cterr === 'water' || cterr === 'grass') cs.push(`background-color:${node.bg_color || TERRAIN_FILL[cterr]}`);
        else if (node.bg_color) cs.push(`background-color:${node.bg_color}`);
        else if (node.district?.color) { const [dr, dg, db] = hexToRgb(node.district.color); cs.push(`background-color:rgba(${dr},${dg},${db},0.20)`); }
        const cterrCls = cterr ? ` mm-terr mm-${cterr}` : '';
        const cStyle = cs.length ? ` style="${cs.join(';')}"` : '';
        html += `<span class="mm-c mm-room mm-current${cterrCls}${traceCls}"${cStyle} title="${titleFor(node)}"></span>`;
        continue;
      }
      // Foreign tile: only the ones one step across a boundary survive, as a gateway
      // edge marker (the district's initials in its colour). Deeper foreign tiles are
      // dropped to void so the sidebar stays scoped to your district.
      if (!inDist(node)) {
        if (gateways.has(node.id)) {
          const g = node.district || {};
          const gs = [];
          if (g.color) { const [r0, g0, b0] = hexToRgb(g.color); gs.push(`background:rgba(${r0},${g0},${b0},0.12)`, `color:${g.color}`, `border-color:${g.color}`); }
          html += `<span class="mm-c mm-room mm-gateway" style="${gs.join(';')}" title="→ ${escapeHtml(g.name || node.name)}">${streetAbbrev(g.name || node.name)}</span>`;
        } else {
          html += `<span class="mm-c mm-void"></span>`;
        }
        continue;
      }
      // Authored bg wins; otherwise a faint district tint so the sidebar reads as
      // coloured neighborhood regions, not a uniform code-grid.
      const styles = [];
      if (node.bg_color) styles.push(`background:${node.bg_color}`);
      else if (node.district?.color) { const [dr, dg, db] = hexToRgb(node.district.color); styles.push(`background:rgba(${dr},${dg},${db},0.20)`); }
      const textColor = node.color || (node.bg_color ? luminanceTextColor(node.bg_color) : null);
      if (textColor) styles.push(`color:${textColor}`);
      let styled = (node.bg_color || node.color) ? ' mm-styled' : '';
      // Terrain override (road / water / grass): seamless tileable fill. Roads become
      // grey asphalt with yellow markings (the road SVG mask inherits `color`); water
      // and grass drop their marker text for a clean coloured expanse + a connecting
      // texture supplied by the .mm-<terrain> class. `background-color` (long-hand) is
      // used so the class's texture background-image survives.
      let content = symFor(node);
      const terr = TERRAIN.has(node.terrain) ? node.terrain : null;
      if (terr === 'road') {
        styles.length = 0;
        styles.push(`background-color:${ROAD_SURFACE}`, `color:${ROAD_MARKING}`);
        styled = ' mm-styled';
      } else if (terr === 'water' || terr === 'grass') {
        styles.length = 0;
        styles.push(`background-color:${node.bg_color || TERRAIN_FILL[terr]}`);
        styled = ' mm-styled';
        content = '';
      }
      const terrCls = terr ? ` mm-terr mm-${terr}` : '';
      const styleAttr = styles.length ? ` style="${styles.join(';')}"` : '';
      const unreach = node.reachable === false ? ' mm-unreachable' : '';
      // Enterable buildings are doors, not rooms — clickable (action-link + data-dest
      // rides main.js's delegated handler, sending `go <building name>`).
      const dangerCls = node.enterable ? 'safe' : (node.danger || 'safe');
      const enterCls = node.enterable ? ' mm-building action-link' : '';
      const enterAttrs = node.enterable && node.building_name
        ? ` data-action="go" data-target="${escapeHtml(node.building_name)}" data-dest="${escapeHtml(node.building_name)}"`
        : '';
      const cls = `mm-c mm-room danger-${dangerCls}${styled}${unreach}${enterCls}${terrCls}${traceCls}`;
      html += `<span class="${cls}"${styleAttr}${enterAttrs} title="${titleFor(node)}">${content}${entranceMark(node.entrance, 'mm')}</span>`;
    }
  }
  applyMinimapZoom(); // keep the grid tracks in step with R before painting the cells
  for (const id of ['minimap-grid', 'minimap-grid-mob', 'minimap-grid-hud']) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }
  if (direction) slideMinimap(direction);
}

// Land-use / function colour key for the default map view. Keys + colours match
// server mapFunc() (movement.js) and scripts/landuse-zone-colors.js — keep synced.
export const FUNC_LEGEND = {
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
  redline:     { label: 'Redline / Slaughterworks', color: '#c0392b' },
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
export const POI_LEGEND = {
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

// Building-type → overlay glyph for the map's "icons" mode. One entry per
// building_type the content pipeline emits (server BUILDING_TYPE_ICON in world.js);
// synonyms collapse the way the rooftop-SVG table does (store/grocery → shop). Keep
// this in sync when a new building_type is added so it reads on the map, not just
// from the air. Unlisted types fall back to _default.
export const BUILDING_ICON = {
  residential: '⌂', apartment: '🏢',
  shop: '$', store: '$', grocery: '$',
  bar: '🍺', club: '♥', police: '★',
  corporate_office: '💼', hotel: '🏨', power: '⚡',
  hangar: '✈', studio: '🎬', clinic: '✚', diner: '🍔',
  _default: '▢',
};

// Tileable terrain styling (server `terrain` field). Roads recolour to grey asphalt
// with yellow lane markings; water/grass render as a seamless coloured expanse with a
// connecting texture from the .mm-<terrain> / .map-<terrain> CSS classes.
const TERRAIN = new Set(['road', 'water', 'grass']);
const ROAD_SURFACE = '#4c5157';   // grey asphalt
const ROAD_MARKING = '#f2c53d';   // yellow lane markings (the road SVG mask takes `color`)
const TERRAIN_FILL = { water: '#3f7fb0', grass: '#5a9e57' }; // fallback if a tile has no authored bg
// The full-map popup's fixed window size in px (11 tiles × 34px — keep in sync with
// #map-viewport in styles.css). The window never resizes; the regional view scales
// its tiles down to fit the whole region inside it.
const MAP_WINDOW_PX = 374;
const MAP_BASE_TILE = 34; // #map-grid --map-room default (zone/interior tile px)

// Small entrance arrow overlaid on a building tile, pointing to the edge the door
// faces (server `entrance` field). A CSS triangle (no glyph) via .<pfx>-ent-<dir>;
// pfx is 'mm' (sidebar) or 'map' (full popup).
const ENTRANCE_DIRS = new Set(['north', 'south', 'east', 'west']);
function entranceMark(dir, pfx) {
  return ENTRANCE_DIRS.has(dir) ? `<span class="${pfx}-entrance ${pfx}-ent-${dir}"></span>` : '';
}

// ── Three-level map popup: interior → zone → regional ────────────────────────
// Popup state, kept across re-opens so the tab buttons + wheel know the current
// level and the tooltip can look tiles up by id.
// The overlay slider setting is persisted so it survives reloads and both the
// full map and the sidebar minimap read the one saved value.
const MAP_OVERLAY_KEY = 'map_overlay';
let _savedOverlay = 'none';
try { _savedOverlay = localStorage.getItem(MAP_OVERLAY_KEY) || 'icons'; } catch {}
// Territory overlay: tint held tiles by controlling org on top of the avenue+labels
// view. Persisted like the other view toggles; the control layer itself is fetched
// on demand from the corps plugin (`corp territory`) and cached here.
const MAP_TERRITORY_KEY = 'map_territory';
let _savedTerritory = false;
try { _savedTerritory = localStorage.getItem(MAP_TERRITORY_KEY) === '1'; } catch {}
let _territory = null; // last { control: {zoneId:{...}}, orgs, myOrgId } payload
// Route trace: click-a-tile-to-see-how-to-get-there. `routeMode` is armed-to-place
// (persisted; true only while waiting for the next tile click — placing one, or
// clearing an existing route via the GPS button, both disarm it); `tracePath` is
// the current ordered list of tile ids, cleared on arrival or by the GPS button.
const MAP_ROUTE_KEY = 'map_route';
let _savedRoute = false;
try { _savedRoute = localStorage.getItem(MAP_ROUTE_KEY) === '1'; } catch {}
const mapState = { mode: 'zone', insideInterior: false, byId: new Map(), tiles: [], avenueView: false, avenueOverlay: _savedOverlay, territoryView: _savedTerritory, routeMode: _savedRoute, tracePath: null, legendSel: null };

// Black/white ink for legibility on a saturated org fill (mirrors corp-map.js inkFor).
function contrastInk(hex) {
  const h = (hex || '').replace('#', '');
  if (h.length < 6) return '#08110d';
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#08110d' : '#eafffb';
}
// hex -> rgba(...) string at a given alpha, for the territory overlay tint.
function hexA(hex, a) {
  const h = (hex || '').replace('#', '');
  if (h.length < 6) return `rgba(0,0,0,${a})`;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// Store the fetched corp-control layer and re-tint the map if it's open.
export function setMapTerritory(msg) {
  _territory = msg || null;
  if (document.getElementById('map-panel')?.classList.contains('active')) renderMapGrid();
}
// Ask the server for the current control layer (silent — routes back as map_territory).
function fetchTerritory() { sendCmdSilent('corp territory'); }
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

// Shortest walkable route between two tiles over the currently-shown tiles, stepping
// only through orthogonal grid-adjacent exits (so every leg can be drawn as a road
// band). Returns an ordered array of tile ids from `fromId` to `toId`, or null if
// there's no drawable path on this map level (e.g. only reachable via up/down/in/out).
function traceRoute(fromId, toId, byId) {
  if (!fromId || !toId || fromId === toId) return null;
  const from = byId.get(fromId), to = byId.get(toId);
  if (!from || !to || from.x == null || to.x == null) return null;
  const prev = new Map([[fromId, null]]);
  const queue = [fromId];
  while (queue.length) {
    const id = queue.shift();
    if (id === toId) break;
    const t = byId.get(id);
    for (const targetId of Object.values(t?.exits || {})) {
      if (prev.has(targetId)) continue;
      const n = byId.get(targetId);
      if (!n || n.x == null) continue;
      const dx = Math.abs(n.x - t.x), dy = Math.abs(n.y - t.y);
      if (dx + dy !== 1) continue; // orthogonal unit step only (drawable)
      prev.set(targetId, id);
      queue.push(targetId);
    }
  }
  if (!prev.has(toId)) return null;
  const path = [];
  for (let id = toId; id != null; id = prev.get(id)) path.push(id);
  return path.reverse();
}

// The still-relevant slice of the stored route, given where you are now: trimmed to
// start at the current tile (so tiles already walked drop off), or the whole route if
// you've stepped off it. Returns null once you've arrived (nothing left ahead) and
// consumes the stored route at that point so it doesn't linger behind you.
function effectiveTracePath(currentId) {
  const p = mapState.tracePath;
  if (!p || !p.length) return null;
  const i = p.indexOf(currentId);
  if (i === -1) return p;                 // stepped off-route — still show the corridor
  const rest = p.slice(i);
  if (rest.length <= 1) { mapState.tracePath = null; return null; } // arrived
  return rest;
}

// ── Shared with the Tablet Map app (panels/tablet-os.js) ─────────────────────
// The tablet renders its own grid from the same `map` payload, but leans on the
// popup's route machinery so there's one source of truth for GPS routes.
// Plot the shortest drawable route between two tiles over an arbitrary tile list.
export function routeBetween(fromId, toId, tiles) {
  const byId = new Map((tiles || []).map(t => [t.id, t]));
  return traceRoute(fromId, toId, byId);
}
// The currently-plotted GPS/route path (ordered tile ids), or null — so the
// tablet map can highlight the same route the sidebar minimap + full map show.
export function getTracePath() { return mapState.tracePath; }

// Reflect mapState.avenueOverlay onto the 3-stop slider (active segment + the
// data-ov attribute that slides the highlight).
function syncOverlaySlider() {
  const slider = document.getElementById('map-overlay-slider');
  if (!slider) return;
  slider.setAttribute('data-ov', mapState.avenueOverlay);
  for (const seg of slider.querySelectorAll('.mo-seg'))
    seg.classList.toggle('active', seg.getAttribute('data-ov') === mapState.avenueOverlay);
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
  const district = FUNC_LEGEND[z.func];
  if (district) html += `<div class="map-tt-district" style="color:${district.color}">${escapeHtml(district.label)}</div>`;
  const terr = mapState.territoryView ? _territory?.control?.[z.id] : null;
  if (terr) {
    const contested = terr.status === 'CONTESTED'
      ? ` · contested${terr.challenger ? ' by ' + escapeHtml(terr.challenger) : ''}` : '';
    html += `<div class="map-tt-bld"><b>${escapeHtml(terr.tag)}</b> · ${terr.influence}% grip${contested}</div>`;
  }
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
  // Overlay slider: what rides on top of the avenue roads — nothing / the minimap
  // POI icons / 2-letter abbrevs. Picking an overlay implies Avenue View.
  // Tile-symbol overlay: none (colours only) / text (2-letter labels) / icons.
  document.getElementById('map-overlay-slider')?.addEventListener('click', (e) => {
    const slider = e.currentTarget;
    const segs = [...slider.querySelectorAll('.mo-seg')];
    if (!segs.length) return;
    // Step to the NEXT option in order (none → labels → icons → none), wherever you
    // click — a sequential cycle, not a jump-to-the-nearest-segment toggle.
    const order = segs.map((s) => s.getAttribute('data-ov') || 'icons');
    const next = (order.indexOf(mapState.avenueOverlay) + 1) % order.length;
    mapState.avenueOverlay = order[next];
    try { localStorage.setItem(MAP_OVERLAY_KEY, mapState.avenueOverlay); } catch {}
    syncOverlaySlider();
    renderMapGrid();
    if (_lastMinimapNodes) renderMinimap(_lastMinimapNodes); // mirror the overlay onto the sidebar minimap
  });
  // Territory: tint held tiles by controlling org, and fetch a fresh control layer.
  document.getElementById('map-territory-toggle')?.addEventListener('click', () => {
    mapState.territoryView = !mapState.territoryView;
    try { localStorage.setItem(MAP_TERRITORY_KEY, mapState.territoryView ? '1' : '0'); } catch {}
    document.getElementById('map-territory-toggle')?.classList.toggle('active', mapState.territoryView);
    if (mapState.territoryView) fetchTerritory();
    renderMapGrid();
  });
  // Route (GPS button): a route already drawn? click clears it. Otherwise the
  // click arms the next tile click to place one (single-shot — placing a route
  // disarms itself; see the grid click handler below).
  document.getElementById('map-route-toggle')?.addEventListener('click', () => {
    const btn = document.getElementById('map-route-toggle');
    if (mapState.tracePath) {
      mapState.tracePath = null;
      mapState.routeMode = false;
      try { localStorage.setItem(MAP_ROUTE_KEY, '0'); } catch {}
      btn?.classList.remove('active', 'has-route');
      if (isAutoWalking()) stopAutoWalk('Auto-walk stopped — route cleared.');
      renderMapGrid();
      if (_lastMinimapNodes) renderMinimap(_lastMinimapNodes); // clear it off the minimap too
      return;
    }
    mapState.routeMode = !mapState.routeMode;
    try { localStorage.setItem(MAP_ROUTE_KEY, mapState.routeMode ? '1' : '0'); } catch {}
    btn?.classList.toggle('active', mapState.routeMode);
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

    // Drag to pan the grid within the bounded viewport. Pointer capture is deferred
    // until movement actually crosses the drag threshold — capturing immediately on
    // pointerdown redirects the subsequent 'click' event's target to `vp` itself
    // (per the Pointer Events capture spec), which broke tile clicks (route trace,
    // charter destination-pick) on every plain click, not just drags.
    let dsx = 0, dsy = 0, downX = 0, downY = 0, pid = null;
    vp.addEventListener('pointerdown', (e) => {
      mapDrag.on = true;
      mapDrag.moved = false;
      downX = e.clientX; downY = e.clientY;
      dsx = e.clientX - mapPan.tx;
      dsy = e.clientY - mapPan.ty;
      pid = e.pointerId;
    });
    vp.addEventListener('pointermove', (e) => {
      if (!mapDrag.on) return;
      if (!mapDrag.moved && Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 4) {
        mapDrag.moved = true;
        vp.classList.add('grabbing');
        try { vp.setPointerCapture(pid); } catch {}
        const t = document.getElementById('map-tooltip');
        if (t) t.style.display = 'none';
      }
      if (!mapDrag.moved) return;
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
  // Drag the whole popup by its header. A grab on empty header space (or the
  // title) moves the box via a translate offset from its flex-centred origin;
  // the tabs / slider / buttons inside the header keep their own click behaviour.
  // The offset (bx/by) is closure state, so it persists while the popup stays
  // wired (wireMapUi runs once) — reopening keeps wherever you left it.
  const box = document.getElementById('map-box');
  const header = document.getElementById('map-header');
  if (box && header) {
    let bx = 0, by = 0, sx = 0, sy = 0, dragging = false, hpid = null;
    header.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, .map-tab, .map-overlay-slider, #map-tabs')) return;
      dragging = true; hpid = e.pointerId;
      sx = e.clientX - bx; sy = e.clientY - by;
      try { header.setPointerCapture(hpid); } catch {}
      box.classList.add('map-dragging');
    });
    header.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      bx = e.clientX - sx; by = e.clientY - sy;
      box.style.transform = `translate(${bx}px, ${by}px)`;
    });
    const endBoxDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      box.classList.remove('map-dragging');
      try { header.releasePointerCapture(e.pointerId); } catch {}
    };
    header.addEventListener('pointerup', endBoxDrag);
    header.addEventListener('pointercancel', endBoxDrag);
  }
  for (const id of ['map-grid', 'map-legend']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener('mouseover', onMapHover);
    el.addEventListener('mousemove', onMapMove);
    el.addEventListener('mouseout', onMapOut);
    el.addEventListener('click', (e) => {
      const cell = e.target.closest('[data-zone-id]');
      if (!cell) return;
      const zid = cell.getAttribute('data-zone-id');
      // Charter destination-pick takes precedence while armed.
      if (_pickCb) {
        const cb = _pickCb; _pickCb = null;
        document.getElementById('map-panel')?.classList.remove('active');
        cb(zid);
        return;
      }
      // Clicking a tile — on the map OR in the legend — selects it: every tile of that
      // building lights up on the map (via .map-legend-sel) and its legend row
      // highlights and scrolls into view. Re-clicking the same selection clears it.
      // Route plotting takes over instead while the GPS button is armed.
      if (!mapState.routeMode) {
        if (el.id === 'map-grid' && mapDrag.moved) return; // ignore the click that ends a pan-drag
        mapState.legendSel = (mapState.legendSel === zid) ? null : zid;
        renderMapGrid();
        document.querySelector('#map-legend .map-list-sel')?.scrollIntoView({ block: 'nearest' });
        return;
      }
      // Route trace: draw a yellow road from the current tile to the clicked one.
      // Ignore the click that ends a pan-drag (grid only; the legend can't be dragged).
      if (el.id === 'map-grid' && mapDrag.moved) return;
      plotMapRoute(zid);
    });
    // Double-clicking any (non-water) tile GPS-routes to it, no need to arm the GPS
    // button first. Ignore the double-click that ends a pan-drag.
    if (el.id === 'map-grid') {
      el.addEventListener('dblclick', (e) => {
        const cell = e.target.closest('[data-zone-id]');
        if (!cell || mapDrag.moved) return;
        plotMapRoute(cell.getAttribute('data-zone-id'));
      });
    }
  }
}

// Plot a client-side GPS route from the current tile to `zid` and mirror it onto the
// sidebar minimap. Shared by route-mode single-click and double-click-to-GPS.
function plotMapRoute(zid) {
  // Open water is impassable — you can't route to it. Say so rather than plot nothing.
  if (mapState.byId.get(zid)?.water) { appendMsg('Must be on Land.', 'error'); return; }
  const current = mapState.tiles.find(t => t.isCurrent);
  const path = current ? traceRoute(current.id, zid, mapState.byId) : null;
  mapState.tracePath = (path && path.length > 1) ? path : null;
  mapState.routeMode = false; // single-shot: placed, disarm until cleared + re-armed
  try { localStorage.setItem(MAP_ROUTE_KEY, '0'); } catch {}
  const rbtn = document.getElementById('map-route-toggle');
  rbtn?.classList.remove('active');
  rbtn?.classList.toggle('has-route', !!mapState.tracePath);
  renderMapGrid();
  if (_lastMinimapNodes) renderMinimap(_lastMinimapNodes); // mirror the route on the sidebar minimap
}

// Server-driven route (the `gps` command): the path can span the whole map, not
// just whatever's currently on screen, so it's set directly rather than via
// traceRoute's on-screen BFS. Mirrors onto the sidebar minimap immediately;
// doesn't pop the full map open — if it's already open, refresh it in place
// (regional, so the whole route is visible) rather than disturbing the player
// with an unrequested popup.
export function setGpsRoute(path) {
  mapState.tracePath = (path && path.length > 1) ? path : null;
  mapState.routeMode = false;
  try { localStorage.setItem(MAP_ROUTE_KEY, '0'); } catch {}
  const rbtn = document.getElementById('map-route-toggle');
  rbtn?.classList.remove('active');
  rbtn?.classList.toggle('has-route', !!mapState.tracePath);
  if (!mapState.tracePath && isAutoWalking()) stopAutoWalk('Auto-walk stopped — route cleared.');
  if (_lastMinimapNodes) renderMinimap(_lastMinimapNodes);
  if (document.getElementById('map-panel')?.classList.contains('active')) sendCmdSilent('map regional');
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
  // A stored route persists across moves/reopens; effectiveTracePath() trims it to the
  // leg still ahead and drops it on arrival, so it never needs a blanket clear here.

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
  document.getElementById('map-territory-toggle')?.classList.toggle('active', mapState.territoryView);
  document.getElementById('map-route-toggle')?.classList.toggle('active', mapState.routeMode);
  document.getElementById('map-route-toggle')?.classList.toggle('has-route', !!mapState.tracePath);
  syncOverlaySlider();
  if (mapState.territoryView) fetchTerritory(); // refresh the control layer each open

  const tip = document.getElementById('map-tooltip');
  if (tip) tip.style.display = 'none';

  renderMapGrid();
  document.getElementById('map-panel').classList.add('active');
}

// Refreshes the map popup's grid/legend from mapState (tiles/mode/insideInterior/
// avenueView) without touching the server — used both by the initial open and by
// the Avenue View toggle (a pure rendering-mode switch on already-fetched tiles).
function renderMapGrid() {
  const { mode, insideInterior } = mapState;
  const grid = document.getElementById('map-grid');
  const legend = document.getElementById('map-legend');

  // Regional view: show only the district you're in (hide the neighbouring ones) so it
  // reads as "full zoom on this district", centred in the window. Zone/interior show
  // everything as-is. Falls back to all tiles if the current tile carries no district.
  let tiles = mapState.tiles;
  if (mode === 'regional') {
    const curDistrict = tiles.find(t => t.isCurrent)?.district;
    if (curDistrict) tiles = tiles.filter(t => t.district === curDistrict);
  }

  if (!tiles.length) {
    grid.textContent = '(no map data)';
    legend.innerHTML = '';
    return;
  }

  const regional = mode === 'regional';
  // Corp-control tint only applies on the overworld levels (zone/regional), never
  // inside an interior. null = no tinting this pass.
  const territory = (mapState.territoryView && mode !== 'interior') ? (_territory?.control || null) : null;
  // Compact placement: regional packs every distinct occupied coord to an index
  // (so a far-flung district can't blow the grid up); zone/interior stay an 11×11
  // window centred on you. Tiles touch — no connection/gap cells.
  let colOf, rowOf, gCols, gRows;
  if (regional) {
    const xs = [...new Set(tiles.map(t => t.x))].sort((a, b) => a - b);
    const ys = [...new Set(tiles.map(t => t.y))].sort((a, b) => a - b);
    const xi = new Map(xs.map((x, i) => [x, i])), yi = new Map(ys.map((y, i) => [y, i]));
    colOf = t => xi.get(t.x); rowOf = t => yi.get(t.y);
    gCols = xs.length; gRows = ys.length;
  } else {
    colOf = t => t.x + 5; rowOf = t => t.y + 5;
    gCols = 11; gRows = 11;
  }

  const overlay = mapState.avenueOverlay || 'icons'; // none | labels (text) | icons
  // Base layer for every mode: the tile's own named SVG (road connector, building-
  // type rooftop, statue, water). Rendered under every overlay so the map always
  // reads as an illustrated map, never bare coloured squares. Falls back to the POI
  // landmark glyph / marker only when a tile has no SVG of its own.
  const baseSym = (t) => {
    if (t.svg) return `<span class="mm-icon" style="--zi:url(/assets/zone-icons/${t.svg}.svg)"></span>`;
    if (t.icon) return t.icon + ' ';                 // POI landmark (airport, police, …)
    return '';                                       // bare tile — no marker glyph (#, ⸪., …)
  };
  const symFor = (t) => {
    if (t.isCurrent) return '';
    const base = baseSym(t);
    // Icons ride ON TOP of a building's footprint; non-building tiles show only their
    // base SVG. `none` shows the base everywhere. Labels hide the footprint and show a
    // big 2-letter acronym in its place.
    if (overlay === 'none' || !t.building_type) return base;
    if (overlay === 'labels')
      return `<span class="map-bld-ov map-bld-label">${twoLetterAbbrev(t.building_name || t.name)}</span>`;
    const glyph = BUILDING_ICON[t.building_type] || BUILDING_ICON._default;
    return base + `<span class="map-bld-ov map-bld-icon">${glyph}</span>`;
  };

  const cell = Array.from({ length: gRows }, () => new Array(gCols).fill(null));
  for (const t of tiles) {
    const c = colOf(t), r = rowOf(t);
    if (r >= 0 && r < gRows && c >= 0 && c < gCols) cell[r][c] = t;
  }

  // Route trace: the tiles on the walkable path to a clicked tile (drawn as a line below).
  const curTile = tiles.find(t => t.isCurrent);
  document.getElementById('map-route-toggle')?.classList.toggle('has-route', !!mapState.tracePath);
  // Legend selection: the building name the player clicked in the legend, highlighted
  // (accent) on the map and in the list. Matched by name so every tile of a multi-tile
  // building lights up.
  const selName = mapState.legendSel ? mapState.byId.get(mapState.legendSel)?.name || null : null;

  // Regional: shrink the tiles so the whole region fits inside the fixed window at
  // once — full district in view, no panning. Zone/interior keep the CSS default tile
  // size (34px). The window itself never changes size. `--map-room` drives both the
  // column width and the .map-c row height, so setting it here scales tiles square.
  let tilePx = MAP_BASE_TILE; // CSS default #map-grid --map-room (zone/interior)
  if (regional) {
    tilePx = Math.max(5, Math.floor(Math.min(MAP_WINDOW_PX / gCols, MAP_WINDOW_PX / gRows)));
    grid.style.setProperty('--map-room', `${tilePx}px`);
  } else {
    grid.style.removeProperty('--map-room');
  }
  grid.style.gridTemplateColumns = `repeat(${gCols}, var(--map-room))`;
  grid.classList.remove('avenue');

  let html = '';
  for (let r = 0; r < gRows; r++) {
    for (let c = 0; c < gCols; c++) {
      const t = cell[r][c];
      if (!t) { html += `<span class="map-c"></span>`; continue; }
      const terrain = TERRAIN.has(t.terrain) ? t.terrain : null;
      const org = territory ? territory[t.id] : null; // controlling org, if any
      // The tile's own painted colour is the whole story now — no land-use tint.
      const bg = t.bg_color || null;
      const styles = [];
      // Regional overview: tiles are tiny, so keep only the scalable SVG footprint
      // (mask) and drop non-scaling glyphs / building labels — colour carries the read.
      let content = regional
        ? (t.svg && !t.isCurrent ? `<span class="mm-icon" style="--zi:url(/assets/zone-icons/${t.svg}.svg)"></span>` : '')
        : symFor(t);
      const isPoi = !terrain && t.icon && !t.isCurrent; // POI icon gets its own colour via a class
      // Terrain override (road / water / grass): seamless tileable fill (see the sidebar
      // minimap for the same treatment). Roads → grey asphalt + yellow markings (the road
      // SVG mask inherits `color`); water/grass → clean coloured expanse (marker dropped)
      // + a connecting texture from the .map-<terrain> class. `background-color` long-hand
      // keeps that texture's background-image alive.
      if (terrain === 'road') {
        styles.push(`background-color:${ROAD_SURFACE}`, `color:${ROAD_MARKING}`);
      } else if (terrain === 'water' || terrain === 'grass') {
        styles.push(`background-color:${t.bg_color || TERRAIN_FILL[terrain]}`);
        content = '';
      } else {
        if (bg) styles.push(`background:${bg}`);
        const tColor = t.color || (bg ? luminanceTextColor(bg) : null);
        if (tColor && !isPoi) styles.push(`color:${tColor}`);
      }
      let terrOv = '';
      if (org) {
        // Territory overlay: a 90%-opacity org-colour layer painted ABOVE the tile's
        // own icons/labels (a positioned .map-terr-ov child, not a background), so
        // control reads at a glance and dominates POI icons, abbreviations, and the
        // avenue-road overlay. The tile goes position:relative so the layer clips to it.
        styles.push('position:relative');
        // Org-colour glow (doubled for rival-held turf) sits outside the fill; dashed
        // outline while contested rings the tile.
        styles.push(`box-shadow:inset 0 0 0 1px ${org.color},0 0 8px ${org.color}${org.mine ? '' : ',0 0 4px ' + org.color}`);
        if (org.status === 'CONTESTED') styles.push(`outline:1px dashed ${contrastInk(org.color)};outline-offset:-3px`);
        terrOv = `<span class="map-terr-ov" style="background:${hexA(org.color, 0.9)}"></span>`;
      }
      const cls = `map-c map-room danger-${t.danger || 'safe'}` +
        (t.isCurrent ? ' map-current' : '') +
        (regional || t.bg_color || t.color ? ' map-styled' : '') +
        (isPoi ? ` map-poi map-poi-${t.poi}` : '') +
        (terrain ? ` map-terr map-${terrain}` : '') +
        (selName && t.name === selName ? ' map-legend-sel' : '');
      const style = styles.length ? ` style="${styles.join(';')}"` : '';
      const entMark = regional ? '' : entranceMark(t.entrance, 'map'); // arrow only when tiles are big enough to read
      html += `<span class="${cls}"${style} data-zone-id="${t.id}">${content}${entMark}${terrOv}</span>`;
    }
  }
  // GPS route: draw a yellow line through the centres of the route tiles (an SVG laid
  // over the grid) rather than highlighting boxes. Tiles off the current grid/window
  // (or in another district in regional view) are skipped.
  const routeIds = effectiveTracePath(curTile?.id) || [];
  if (routeIds.length > 1) {
    const pts = [];
    for (const id of routeIds) {
      const rt = mapState.byId.get(id);
      if (!rt) continue;
      const c = colOf(rt), r = rowOf(rt);
      if (c == null || r == null || c < 0 || c >= gCols || r < 0 || r >= gRows) continue;
      pts.push(`${((c + 0.5) * tilePx).toFixed(1)},${((r + 0.5) * tilePx).toFixed(1)}`);
    }
    if (pts.length > 1)
      html += `<svg class="map-gps-svg" viewBox="0 0 ${gCols * tilePx} ${gRows * tilePx}" preserveAspectRatio="none"><polyline class="map-gps-line" stroke-width="${Math.max(2, tilePx * 0.18).toFixed(1)}" points="${pts.join(' ')}"/></svg>`;
  }
  grid.innerHTML = html;

  // Right panel: "you are here" + landmark keys + the deduped tile list (one row
  // per distinct building/terrain, in its own painted colour). Same for every zoom
  // level now — no separate land-use legend.
  let KEYS = '';
  const poiPresent = new Set(tiles.map(t => t.poi).filter(Boolean));
  for (const key of Object.keys(POI_LEGEND)) {
    if (!poiPresent.has(key)) continue;
    const p = POI_LEGEND[key];
    KEYS += `<div class="map-leg-row"><span class="map-leg-sym map-poi map-poi-${key}">${p.icon}</span> ${p.label}</div>`;
  }
  if (territory && _territory?.orgs?.length) {
    KEYS += `<div class="map-leg-row map-leg-head">Territory</div>`;
    for (const o of _territory.orgs) {
      const style = `background:${o.color};color:${contrastInk(o.color)}`;
      const you = o.id === _territory.myOrgId ? ' (you)' : '';
      KEYS += `<div class="map-leg-row"><span class="map-leg-sym map-styled" style="${style}">&nbsp;&nbsp;</span> ${escapeHtml(o.tag)} ${escapeHtml(o.name)}${you}</div>`;
    }
  }
  const youLabel = (mode === 'zone' && insideInterior) ? 'You are here (inside)' : 'You are here';
  let leg = `<div class="map-leg-row map-leg-head"><span class="map-leg-sym map-current"></span> ${youLabel}</div>` + KEYS + `<div class="map-list">`;
  // Alphabetical by marker (falling back to the 2-letter tile abbrev), then name;
  // deduped so each distinct building/terrain name appears exactly once.
  const seenNames = new Set();
  const sorted = [...tiles].sort((a, b) => {
    const ka = (a.marker || twoLetterAbbrev(a.name)).toLowerCase();
    const kb = (b.marker || twoLetterAbbrev(b.name)).toLowerCase();
    if (ka !== kb) return ka < kb ? -1 : 1;
    return (a.name || '').localeCompare(b.name || '');
  }).filter(t => { const n = (t.name || '').toLowerCase(); if (seenNames.has(n)) return false; seenNames.add(n); return true; });
  for (const t of sorted) {
    const styles = [];
    if (t.bg_color) styles.push(`background:${t.bg_color}`);
    const legColor = t.color || (t.bg_color ? luminanceTextColor(t.bg_color) : null);
    if (legColor) styles.push(`color:${legColor}`);
    const symCls = `map-leg-sym danger-${t.danger || 'safe'}` + (t.bg_color || t.color ? ' map-styled' : '');
    const style = styles.length ? ` style="${styles.join(';')}"` : '';
    const rowCls = 'map-leg-row map-list-row' + (t.isCurrent ? ' map-list-current' : '')
      + (selName && t.name === selName ? ' map-list-sel' : '');
    leg += `<div class="${rowCls}" data-zone-id="${t.id}"><span class="${symCls}"${style}>${symFor(t)}</span> ${escapeHtml(t.name)}</div>`;
  }
  leg += `</div>`;
  legend.innerHTML = leg;

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
