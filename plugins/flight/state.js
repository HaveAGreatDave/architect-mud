// Flight — shared state substrate for the plugin's submodules.
//
// index.js owns the flight *verbs* and the tick loop; combat.js / contracts.js /
// hangars.js / hazards.js / acquisition.js are the *systems*. They all need the
// same live-aircraft registry, the computed-overlay coord lookup, the synthesized
// HUD payload, and the shared park/crash transitions — so those live here, in one
// place, and every module imports them. Nothing here is a command; it's the
// engine-facing seam the whole plugin shares.

import { query } from '../../server/models/db.js';
import { getZone, getAllZones, getLivePlayer, getMinimapData } from '../../server/engine/world.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { setPosture, forceStand } from '../../server/engine/posture.js';
import { handlePlayerDeath } from '../../server/engine/gameLoop.js';

export const TICK_MS = 3000;
export const FUEL_RESERVE_FRAC = 0.10;
export const BINGO_FRAC = 0.20;
export const REFUEL_PRICE_PER_UNIT = 2;
export const BANDS = ['ground', 'low', 'cruise', 'high'];
export const BAND_LABEL = { ground: 'GND', low: 'LOW', cruise: 'CRUISE', high: 'HIGH' };
export const BAND_BURN = { ground: 1, low: 1, cruise: 1.25, high: 1.6 };

export const DIRS = {
  n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0],
  ne: [1, -1], nw: [-1, -1], se: [1, 1], sw: [-1, 1],
};
export const DIR_ALIASES = { north: 'n', south: 's', east: 'e', west: 'w',
  northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw' };

// ── Heading model (degrees) ───────────────────────────────────────────────────
// Heading is stored on the row as a string but is really a compass degree
// (0=N, 90=E, 180=S, 270=W). Legacy cardinal strings map in. Movement uses a
// continuous heading vector + sub-tile float accumulation, so `heading 247` flies
// a true bearing across the tile grid, not just one of eight steps.
const CARD_DEG = { n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315 };
export function toDeg(h) {
  if (h == null) return 0;
  if (typeof h === 'number') return ((h % 360) + 360) % 360;
  if (CARD_DEG[h] != null) return CARD_DEG[h];
  const n = parseInt(h, 10);
  return Number.isFinite(n) ? ((n % 360) + 360) % 360 : 0;
}
export function degToCardinal(deg) {
  const dirs = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}
// Screen/grid vector for a heading: N = -y, E = +x.
export function headingVec(deg) {
  const r = deg * Math.PI / 180;
  return [Math.sin(r), -Math.cos(r)];
}
// Bearing (deg) from one grid point to another (N-up).
export function bearingDeg(fromX, fromY, toX, toY) {
  const dx = toX - fromX, dy = toY - fromY;
  return ((Math.atan2(dx, -dy) * 180 / Math.PI) % 360 + 360) % 360;
}

// ── Surface coord index (the computed-overlay lookup) ─────────────────────────
let _coordIndex = null;
let _bounds = null;
export function buildCoordIndex() {
  const idx = new Map();
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (const z of getAllZones()) {
    if (z.map_id !== 'map_world' || z.grid_x == null || z.grid_y == null) continue;
    idx.set(`${z.grid_x},${z.grid_y}`, { id: z.id, name: z.name, flags: z.flags || {} });
    minx = Math.min(minx, z.grid_x); maxx = Math.max(maxx, z.grid_x);
    miny = Math.min(miny, z.grid_y); maxy = Math.max(maxy, z.grid_y);
  }
  _coordIndex = idx;
  _bounds = Number.isFinite(minx) ? { minx, maxx, miny, maxy } : { minx: 0, maxx: 0, miny: 0, maxy: 0 };
}
export function surfaceAt(x, y) {
  if (!_coordIndex) buildCoordIndex();
  return _coordIndex.get(`${x},${y}`) || null;   // null = open air (no obstacle)
}
export function bounds() { if (!_bounds) buildCoordIndex(); return _bounds; }

// ── Live aircraft registry (in-memory; the aircraft owns its occupant set) ────
export const liveAircraft = new Map();   // id -> { row, type, occupants:Set<pid>, pending, starving, hazard, persistCtr }

export async function loadAircraft(id) {
  if (liveAircraft.has(id)) return liveAircraft.get(id);
  const { rows } = await query('SELECT * FROM aircraft WHERE id=$1', [id]);
  if (!rows.length) return null;
  const { rows: tRows } = await query('SELECT * FROM aircraft_types WHERE id=$1', [rows[0].type_id]);
  if (!tRows.length) return null;
  const live = { row: rows[0], type: tRows[0], occupants: new Set(), pending: null, starving: false, hazard: null, persistCtr: 0 };
  liveAircraft.set(id, live);
  return live;
}

export function pilotOf(live) {
  for (const pid of live.occupants) {
    const p = getLivePlayer(pid);
    if (p && p.seat === 'pilot') return p;
  }
  return null;
}

// Effective tuning-adjusted numbers: a craft's installed tune (custom_data.tune)
// nudges the base template values. Kept here so the tick loop, hazards, and the
// HUD all read one consistent set of "effective" stats.
export function effStats(live) {
  const t = live.type, cd = live.row.custom_data || {}, tune = cd.tune || {};
  const cargo = cd.cargoWeight || 0;
  const maxTOW = t.max_takeoff_weight || 300;
  const loadFrac = cargo / maxTOW;                                  // 0..1+ (weight & balance)
  return {
    burn: t.fuel_burn_base * (1 + (tune.mixture || 0) * 0.15) * (1 + loadFrac * 0.5),  // lean burns cooler; cargo drinks
    cruise: t.cruise_speed * (1 + (tune.pitch || 0) * 0.12),        // coarse pitch (+) = faster cruise
    handling: (t.handling || 0) + (tune.cg || 0) * 0.5 + loadFrac * 3,  // heavy + tail-heavy = twitchier/harder
    heatBias: (tune.mixture || 0) * 14 + (tune.boost || 0) * 10,    // lean/boost run hot
    ceiling: Math.min(3, t.altitude_ceiling || 2),
    fuelCap: t.fuel_capacity || 1,
    cargo, maxTOW, overweight: cargo > maxTOW,
  };
}

export async function persist(live) {
  const a = live.row;
  await query(
    `UPDATE aircraft SET grid_x=$1, grid_y=$2, altitude_band=$3, heading=$4, parked_zone_id=$5,
       fuel=$6, throttle=$7, engine_temp=$8, damage=$9, airborne=$10, engine_on=$11, is_wreck=$12,
       weapons_hot=$13, custom_data=$14, hangar_id=$15 WHERE id=$16`,
    [a.grid_x, a.grid_y, a.altitude_band, a.heading, a.parked_zone_id, a.fuel, a.throttle,
     a.engine_temp, a.damage, a.airborne, a.engine_on, a.is_wreck, a.weapons_hot || 0,
     JSON.stringify(a.custom_data || {}), a.hangar_id || null, a.id]
  );
}

export function reap(live) {
  if (!live.occupants.size && !live.row.airborne) liveAircraft.delete(live.row.id);
}

// ── Per-engine model (run-up + gauges) ────────────────────────────────────────
// Each powerplant carries its own temperature; startup runs them up toward a
// stable idle band. Taking off before every engine has stabilised risks failure.
export const ENGINE_IDLE = 78;         // °C target at idle
export const ENGINE_STABLE_BAND = 8;   // ± window that counts as "stable"
export function engineCount(live) { return Math.max(1, live.type.engines || 1); }
export function initEngines(live, temp) {
  const n = engineCount(live);
  live.engines = Array.from({ length: n }, (_, i) => ({
    temp: temp ?? 20 + Math.random() * 6, stable: false, stableFor: 0, seed: i,
  }));
}
export function enginesAllStable(live) {
  return !!live.engines && live.engines.every(e => e.stable);
}
// Average per-engine temp back onto the row for persistence/legacy reads.
function syncEngineTemp(live) {
  if (live.engines?.length) live.row.engine_temp = Math.round(live.engines.reduce((s, e) => s + e.temp, 0) / live.engines.length);
}

// ── Continuous-heading sub-tile advance ───────────────────────────────────────
export function initFloat(live) {
  if (live.fx == null) { live.fx = live.row.grid_x ?? 0; live.fy = live.row.grid_y ?? 0; }
}
export function advance(live, tiles) {
  initFloat(live);
  const [ux, uy] = headingVec(toDeg(live.row.heading));
  const b = bounds();
  live.fx = Math.max(b.minx, Math.min(b.maxx, live.fx + ux * tiles));
  live.fy = Math.max(b.miny, Math.min(b.maxy, live.fy + uy * tiles));
  live.row.grid_x = Math.round(live.fx);
  live.row.grid_y = Math.round(live.fy);
}

// ── HUD payload (synthesized cockpit state, pushed to occupants) ──────────────
function mapWindow(a, radius = 4) {
  const rows = [];
  for (let dy = -radius; dy <= radius; dy++) {
    const row = [];
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx === 0 && dy === 0) { row.push({ kind: 'craft' }); continue; }
      const cell = surfaceAt(a.grid_x + dx, a.grid_y + dy);
      if (!cell) { row.push({ kind: 'air' }); continue; }
      if (cell.flags?.airfield_id) row.push({ kind: 'field' });
      else if (cell.flags?.airspace_restricted) row.push({ kind: 'nofly' });
      else row.push({ kind: 'land' });
    }
    rows.push(row);
  }
  return rows;
}

// Nearest airfield to a coord + the bearing to it (for the <30%-fuel guide icon).
function nearestField(x, y) {
  let best = null, bestD = Infinity;
  for (const z of getAllZones()) {
    if (z.map_id !== 'map_world' || !z.flags?.airfield_id || z.grid_x == null) continue;
    const d = Math.hypot(z.grid_x - x, z.grid_y - y);
    if (d < bestD) { bestD = d; best = z; }
  }
  return best ? { name: best.flags.airfield_name || best.name, bearing: Math.round(bearingDeg(x, y, best.grid_x, best.grid_y)), dist: Math.round(bestD) } : null;
}

export function gaugePayload(live) {
  const a = live.row, t = live.type, eff = effStats(live);
  const cap = eff.fuelCap;
  const below = a.airborne ? surfaceAt(a.grid_x, a.grid_y) : null;
  const fuelPct = Math.max(0, Math.round((a.fuel / cap) * 100));
  const deg = toDeg(a.heading);
  let warn = null;
  if (a.fuel <= 0) warn = 'STARVATION';
  else if (live.hazard) warn = live.hazard.type;
  else if (a.fuel <= cap * BINGO_FRAC) warn = 'BINGO';

  // Per-engine gauges (fall back to a single synthetic engine when cold/never run).
  const engines = (live.engines?.length ? live.engines : Array.from({ length: engineCount(live) }, () => ({ temp: a.engine_temp, stable: false })))
    .map(e => ({ temp: Math.round(e.temp), stable: !!e.stable, pct: Math.max(0, Math.min(100, Math.round((e.temp / 160) * 100))) }));

  return {
    craft: t.name, tail: a.name || t.name, class: t.class,
    band: a.altitude_band, bandLabel: BAND_LABEL[a.altitude_band] || a.altitude_band,
    bandIndex: BANDS.indexOf(a.altitude_band), ceiling: eff.ceiling,
    heading: degToCardinal(deg), headingDeg: deg,
    throttle: a.throttle, spd: a.airborne ? Math.round(eff.cruise * (a.throttle / 100) * 84) : 0,
    fuel: Math.round(a.fuel), fuelPct, fuelCap: Math.round(cap),
    temp: Math.round(a.engine_temp), tempMax: 160,
    engines, enginesStable: enginesAllStable(live), engineOn: !!a.engine_on, runup: !!live.runup,
    hullPct: Math.max(0, Math.round((1 - a.damage) * 100)),
    x: a.grid_x, y: a.grid_y, fx: live.fx, fy: live.fy,
    surface: a.airborne ? (below ? below.name : 'open air') : null,
    airborne: !!a.airborne, warn, fuelType: t.fuel_type, noise: t.noise || 2,
    armed: !!a.weapons_hot, hardpoints: t.hardpoints || 0,
    cargo: eff.cargo, maxTOW: eff.maxTOW, cargoCap: t.cargo_capacity || 0,
    seats: t.seats || 1, vtol: t.takeoff_mode === 'vtol', hover: !!live.hover,
    map: a.airborne ? mapWindow(a) : null,
    minimap: a.airborne && below ? getMinimapData(below.id, 3) : null,
    guide: (a.airborne && fuelPct < 30) ? nearestField(a.grid_x, a.grid_y) : null,
  };
}

export function pushHud(live) {
  const payload = gaugePayload(live);
  for (const pid of live.occupants) {
    const p = getLivePlayer(pid);
    if (!p) continue;
    sendToPlayer(pid, { type: 'cockpit_update', state: { ...payload, seat: p.seat } });
  }
}
export function closeHud(pid) { sendToPlayer(pid, { type: 'cockpit_close' }); }
export function out(pid, message) { sendToPlayer(pid, { type: 'output', message }); }
export function toOccupants(live, message) { for (const pid of live.occupants) out(pid, message); }

// ── Attach / detach ───────────────────────────────────────────────────────────
export function detach(player, { restore = true } = {}) {
  const live = player.aircraftId ? liveAircraft.get(player.aircraftId) : null;
  if (live) live.occupants.delete(player.id);
  if (player.posture === 'flying') forceStand(player, 'flight.detach');
  delete player.aircraftId;
  delete player.seat;
  if (restore) closeHud(player.id);
  if (live) reap(live);
}

// ── Difficulty helpers (piloting checks + minigame board tuning) ──────────────
export function takeoffDifficulty(live) {
  return Math.round(4 + effStats(live).handling + (live.row.damage || 0) * 6);
}
export function landDifficulty(live, emergency) {
  return Math.round(5 + effStats(live).handling + (live.row.damage || 0) * 6 + (emergency ? 4 : 0));
}

// ── Bring a craft to rest at an airfield; restore occupants to the ground ──────
export async function parkAt(live, zoneId) {
  const z = getZone(zoneId);
  if (z) { live.row.grid_x = z.grid_x; live.row.grid_y = z.grid_y; live.fx = z.grid_x; live.fy = z.grid_y; }
  live.row.airborne = 0;
  live.row.altitude_band = 'ground';
  live.row.throttle = 0;
  live.row.parked_zone_id = zoneId;
  live.row.weapons_hot = 0;
  live.row.engine_on = 0;
  live.starving = false;
  live.hazard = null;
  live.runup = false;
  live.engines = null;
  live.coldStart = 0;
  for (const pid of live.occupants) {
    const p = getLivePlayer(pid);
    if (!p) continue;
    if (p.posture === 'flying') forceStand(p, 'flight.land');
    p.current_zone = zoneId;
    getZone(zoneId)?.players.add(pid);
    closeHud(pid);
    out(pid, `<span class="text-dim">You are down at ${z?.name || 'the field'}.</span>`);
  }
  await persist(live);
}

// ── Turn the craft into a salvageable wreck + kill everyone aboard ────────────
export async function crash(live, reason = 'crash') {
  const surface = surfaceAt(live.row.grid_x, live.row.grid_y);
  const wreckZone = surface?.id || live.row.parked_zone_id || 'zone_start';
  live.row.airborne = 0;
  live.row.is_wreck = 1;
  live.row.damage = 1;
  live.row.engine_on = 0;
  live.row.throttle = 0;
  live.row.weapons_hot = 0;
  live.row.altitude_band = 'ground';
  live.row.parked_zone_id = wreckZone;
  live.hazard = null;
  await persist(live);
  sendToZone(wreckZone, { type: 'zone_event', message: `<span class="text-red">A ${live.type.name} screams down out of the sky and craters into the ground in a fireball.</span>`, refresh: true });
  const doomed = [...live.occupants];
  for (const pid of doomed) {
    const p = getLivePlayer(pid);
    if (!p) continue;
    detach(p, { restore: true });
    p.current_zone = wreckZone;
    out(pid, '<span class="text-red">The ground comes up to meet you. There is a noise, and then there is nothing.</span>');
    await handlePlayerDeath(p, null, { type: reason, label: 'Died in an aircraft crash' });
  }
  liveAircraft.delete(live.row.id);
}

// Accepts a cardinal ('nw'), a compass degree (247 or '247'), or a legacy string;
// always stores a normalised degree string on the row.
export function setHeading(live, dirOrDeg) { live.row.heading = String(toDeg(dirOrDeg)); }
export { syncEngineTemp };

// Convenience re-exports so submodules import world/zone helpers from one place.
export { getZone, getLivePlayer, sendToZone, sendToPlayer, setPosture, forceStand };
