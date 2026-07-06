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
import { biomeOf, districtBiome } from './biomes.js';
import { normalizeLivery } from './livery.js';
import { sendToPlayer, sendToZone, sendToZoneExcept } from '../../server/engine/messaging.js';
import { setPosture, forceStand } from '../../server/engine/posture.js';
import { handlePlayerDeath } from '../../server/engine/gameLoop.js';
import { emit } from '../../server/engine/events.js';
import { getEnvironmentState } from '../../server/engine/environment.js';

export const TICK_MS = 3000;
// Overall traversal pace — a single knob that slows the flight down without
// touching burn, so a leg reads a little more leisurely across the map.
export const FLIGHT_PACE = 0.78;
export const FUEL_RESERVE_FRAC = 0.10;
export const BINGO_FRAC = 0.20;
export const REFUEL_PRICE_PER_UNIT = 2;
export const BANDS = ['ground', 'low', 'cruise', 'high'];
export const BAND_LABEL = { ground: 'GND', low: 'LOW', cruise: 'CRUISE', high: 'HIGH' };
export const BAND_BURN = { ground: 1, low: 1, cruise: 1.25, high: 1.6 };

// ── Air-to-air contacts (Phase A: see other airborne craft) ───────────────────
// A pilot sees other airborne craft within CONTACT_RANGE tiles. When one is inside
// FAST_SYNC_RANGE the client raises its own flightsync cadence (a client-side call)
// so the mutual position picture stays fresh enough to fly formation — and, in the
// later phases, to fight. Kept as one knob-pair so the netcode bubble is tunable.
export const CONTACT_RANGE = 12;
export const FAST_SYNC_RANGE = 5;

// ── Air-to-air guns (Phase B) ─────────────────────────────────────────────────
// The client owns aim (manual pipper tracking) and reports an aimQuality; the server
// owns consequences. GUN_RANGE/CONE are the client's tight solution; the *_GATE pair
// is the lenient server anti-spoof envelope (allows for ~sync lag). GUN_DMG is the hull
// fraction a perfectly-aimed burst deals, before the defender's opposed jink reduces it.
export const GUN_RANGE = 2.2;        // client effective gun range (tiles)
export const GUN_RANGE_GATE = 3.4;   // server range gate (lenient for lag)
export const GUN_CONE_GATE = 24;     // server bearing gate (deg off the shooter's nose)
export const GUN_DMG = 0.16;         // hull fraction per solid burst at perfect aim
export const GUN_COOLDOWN_MS = 550;  // min ms between bursts (server-enforced)

// ── Continuous-flight seam (Phase 1 slice) ────────────────────────────────────
// The overhaul's continuous energy model runs client-side; the server reconciles
// and owns the consequences. It's gated to ONE airframe (the Mayfly) for the slice
// — every other type keeps the discrete band/deck flow untouched until Phase 3.
// Craft flown on the continuous cockpit sim. The whole fleet is here now — the fixed-wing
// set plus the Dragonfly (VTOL), which flies the client's dedicated hover model (collective
// + cyclic + pedals) instead of the old modal VTOL-lift deck.
export const CONTINUOUS_TYPES = new Set(['ac_mayfly', 'ac_mule', 'ac_leviathan', 'ac_reaper', 'ac_carcass', 'ac_dragonfly']);
export function isContinuous(live) { return !!live && CONTINUOUS_TYPES.has(live.type?.id); }

// Continuous altitude (ft) → the legacy band the consequence systems still read
// (noise / no-fly / combat branch on this). A derived shim so those systems don't
// need rewriting for the slice.
export const ALT_LOW = 500, ALT_CRUISE = 1200;
export function bandFromAltitude(alt, onGround) {
  if (onGround || alt < 15) return 'ground';
  if (alt < ALT_LOW) return 'low';
  if (alt < ALT_CRUISE) return 'cruise';
  return 'high';
}

// ── Cabin loadout (weight & balance) ──────────────────────────────────────────
// Configurable haulers (they have BOTH seats and cargo capacity) can be re-rigged in
// the hangar between more passengers and more cargo, within one fixed payload budget.
// The per-aircraft choice lives in custom_data.loadout = { seats, cargoCap }; unset =
// the type's authored split. `seats` is total occupancy (pilot included).
export const SEAT_KG = 90;
// Rental billing: a flat desk fee up front (charged at rent = price_rent_hourly), then a
// running meter while airborne — an operating fee every RENTAL_BILL_MS of FLIGHT time that
// bundles gas + upkeep, so a renter never pays at the pump or for repairs (the desk covers
// maintenance). Buying instead makes you responsible for your own fuel and repairs.
export const RENTAL_BILL_MS = 30 * 60 * 1000;   // bill per 30 min of flight
export function rentalOpFee(type) { return Math.max(30, Math.round((type?.price_rent_hourly || 200) * 0.5)); }
export function isConfigurable(type) { return (type?.seats || 0) >= 2 && (type?.cargo_capacity || 0) > 0; }
export function loadoutBudget(type) { return (type?.seats || 1) * SEAT_KG + (type?.cargo_capacity || 0); }
export function effLoadout(row, type) {
  const c = row?.custom_data?.loadout;
  if (c && Number.isFinite(c.seats)) return { seats: Math.max(1, c.seats), cargoCap: Math.max(0, c.cargoCap || 0) };
  return { seats: type?.seats || 1, cargoCap: type?.cargo_capacity || 0 };
}

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
    idx.set(`${z.grid_x},${z.grid_y}`, { id: z.id, name: z.name, flags: z.flags || {}, danger: z.danger_rating });
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

// The terrain "look" of a parked field, so the client can paint the right airport
// backdrop out the canopy (city skyline, dock cranes, wasteland rock, …). Derived
// from the zone — an explicit `flags.airfield_theme` wins, otherwise inferred from
// the zone id so every field themes itself without extra authoring.
export function groundTheme(zone) {
  const f = zone?.flags || {};
  if (f.airfield_theme) return f.airfield_theme;
  const id = (zone?.id || '').toLowerCase();
  if (/slag|ashway|foundry|smelt/.test(id)) return 'slag';
  if (/waste|redline|red_|ashreach|cinder|scald|slop|ruin/.test(id)) return 'wastes';
  if (/dock|bay|slip|boat|wharf|pier|harbor|quay/.test(id)) return 'docks';
  if (/yard|freight|marshal|rail|depot|cargo/.test(id)) return 'yards';
  if (/civ|city|mq_|downtown|threshold|outskirt|residential|gov|commons|market|plaza|precinct|steps|vellum/.test(id)) return 'city';
  return 'default';
}

// The exterior airfield ("ramp") zone for the player's location — whether they're
// standing on the ramp tile itself (flags.airfield_id) or inside its walk-in
// hangar interior (flags.hangar_ramp → the ramp). Every flight service resolves
// through this, so all of them work from inside the hangar too but always park /
// transact against the exterior ramp (where the aircraft physically sit and fly).
export function fieldFor(player) {
  const z = getZone(player.current_zone);
  if (!z) return null;
  if (z.flags?.airfield_id) return z;                                      // on the ramp
  if (z.flags?.hangar_ramp) return getZone(z.flags.hangar_ramp) || null;   // inside the hangar → its ramp
  return null;
}

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
    cruise: t.cruise_speed * FLIGHT_PACE * (1 + (tune.pitch || 0) * 0.12),  // coarse pitch (+) = faster cruise
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
      // Each surface cell carries its derived biome, whether a major road (artery)
      // runs through it, and its danger tier — the windshield renders the real world.
      const biome = biomeOf(cell);
      const road = Array.isArray(cell.flags?.artery) && cell.flags.artery.length ? 1 : 0;
      const kind = cell.flags?.airfield_id ? 'field' : cell.flags?.airspace_restricted ? 'nofly' : 'land';
      row.push({ kind, biome, road, danger: cell.danger });
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

// All airfields within FIELD_TAG_RANGE tiles of a coord, each as a bearing tag the
// cockpit paints on the heading tape — purely distance-gated (shown at any altitude),
// nearest first. Bearing is world-absolute; the client slides each tag as it turns.
const FIELD_TAG_RANGE = 24;
function nearbyFields(x, y) {
  const out = [];
  for (const z of getAllZones()) {
    if (z.map_id !== 'map_world' || !z.flags?.airfield_id || z.grid_x == null) continue;
    const d = Math.hypot(z.grid_x - x, z.grid_y - y);
    if (d > FIELD_TAG_RANGE) continue;
    out.push({ name: z.flags.airfield_name || z.name, bearing: Math.round(bearingDeg(x, y, z.grid_x, z.grid_y)), dist: Math.round(d) });
  }
  return out.sort((a, b) => a.dist - b.dist);
}

export function gaugePayload(live) {
  const a = live.row, t = live.type, eff = effStats(live);
  const cap = eff.fuelCap;
  const below = a.airborne ? surfaceAt(a.grid_x, a.grid_y) : null;
  const parkedZone = a.airborne ? null : getZone(a.parked_zone_id);
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
    livery: normalizeLivery(a.custom_data),   // interior (cabin/upholstery) shows in the cockpit chrome
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
    biomeBelow: a.airborne && below ? districtBiome(below) : null,
    minimap: a.airborne && below ? getMinimapData(below.id, 3) : null,
    guide: (a.airborne && fuelPct < 30) ? nearestField(a.grid_x, a.grid_y) : null,
    // Parked: the terrain look of the field, for the out-the-canopy airport scene.
    ground: a.airborne ? null : { theme: groundTheme(parkedZone), field: parkedZone?.flags?.airfield_name || parkedZone?.name || null },
    sky: skyState(),
  };
}

// Time-of-day + weather for the client windshield's out-the-window scene.
function skyState() {
  try {
    const env = getEnvironmentState();
    return { hour: env.hour, weather: env.currentWeatherType || env.weatherType || 'clear', wind: env.windKph || 0 };
  } catch { return { hour: 12, weather: 'clear', wind: 0 }; }
}

export function pushHud(live) {
  const payload = gaugePayload(live);
  for (const pid of live.occupants) {
    const p = getLivePlayer(pid);
    if (!p) continue;
    sendToPlayer(pid, { type: 'cockpit_update', state: { ...payload, seat: p.seat } });
  }
}
// ── Continuous-flight reconcile (client sim → authoritative server state) ─────
// The client runs the physics at 60fps and reports state; the server clamps it to
// a sane envelope (anti-cheat) and writes it into the live row so every consequence
// system reads current position / heading / throttle / band. The client owns
// attitude + airspeed (feel); the server owns fuel and the world below.
export function reconcile(live, d) {
  const a = live.row, b = bounds();
  const cl = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  live.fx = cl(d.gx, b.minx, b.maxx); live.fy = cl(d.gy, b.miny, b.maxy);
  a.grid_x = Math.round(live.fx); a.grid_y = Math.round(live.fy);
  a.heading = String(((Math.round(d.hdg) % 360) + 360) % 360);
  a.throttle = cl(Math.round(d.thr), 0, 100);
  const alt = Math.max(0, d.alt || 0);
  a.altitude_band = bandFromAltitude(alt, d.onGround);
  live.cont = { altitude: alt, airspeed: Math.max(0, d.ias || 0), vs: d.vs || 0,
    bank: Number.isFinite(d.bank) ? d.bank : 0, pitch: Number.isFinite(d.pitch) ? d.pitch : 0,
    onGround: !!d.onGround, stalled: !!d.stalled };
}

// The world context pushed back to the client sim each server tick: authoritative
// fuel, the surface/obstacle window, sky/weather, and any warning.
export function contextPayload(live) {
  const a = live.row, eff = effStats(live), cap = eff.fuelCap || 1;
  return {
    type: 'flight_ctx',
    fuel: Math.round(a.fuel), fuelCap: Math.round(cap), fuelPct: Math.max(0, Math.round(a.fuel / cap * 100)),
    map: mapWindow(a), mapX: a.grid_x, mapY: a.grid_y, sky: skyState(),   // window centre → client keeps map+centre paired (no recenter pop)
    surface: surfaceAt(a.grid_x, a.grid_y)?.name || 'open air',
    biomeBelow: districtBiome(surfaceAt(a.grid_x, a.grid_y)),
    minimap: (() => { const b = surfaceAt(a.grid_x, a.grid_y); return b ? getMinimapData(b.id, 3) : null; })(),
    fields: nearbyFields(a.grid_x, a.grid_y),   // airport bearing tags for the heading tape
    cargo: a.custom_data?.cargoWeight || 0,     // current hold weight (drives the cockpit jettison bind)
    engines: live.type.engines || 1, seats: live.type.seats || 1, occupants: seatList(live),   // gauge count + cabin readout
    warn: a.fuel <= 0 ? 'STARVATION' : (a.fuel <= cap * BINGO_FRAC ? 'BINGO' : null),
    aa: live.aaThreat || null,                  // AA engagement-envelope telegraph (set by combat.tickCombat)
    hull: Math.max(0, Math.round((1 - (a.damage || 0)) * 100)),   // for the cockpit hull readout / battle damage
  };
}
// Who's in each seat, padded to the airframe's seat count: index 0 = the pilot, the rest
// passengers in boarding order (null = empty). Feeds the cockpit's cabin-occupancy readout.
export function seatList(live) {
  const seats = Math.max(1, live.type.seats || 1);
  const out = new Array(seats).fill(null);
  let next = 1;
  for (const pid of live.occupants) {
    const p = getLivePlayer(pid); if (!p) continue;
    const name = String(p.handle || p.name || p.username || '???').slice(0, 16);
    if (p.seat === 'pilot') out[0] = { role: 'pilot', name };
    else if (next < seats) out[next++] = { role: 'pax', name };
  }
  return out;
}
export function pushContext(live) {
  const payload = contextPayload(live);
  for (const pid of live.occupants) { const p = getLivePlayer(pid); if (p) sendToPlayer(pid, payload); }
}

// One airborne craft as another pilot's radar/windshield sees it: world position
// (sub-tile float for smooth tracking), altitude/heading/speed for client-side
// dead-reckoning between relays, hull, and a short tail readout. Built fresh each relay.
export function airContact(live) {
  const a = live.row;
  const lv = normalizeLivery(a.custom_data);   // paint the viewer renders the bogey in
  return {
    id: a.id,
    livery: { base: lv.base, trim: lv.trim, pattern: lv.pattern, finish: lv.finish },
    x: live.fx ?? a.grid_x ?? 0,
    y: live.fy ?? a.grid_y ?? 0,
    alt: Math.max(0, Math.round(live.cont?.altitude ?? 0)),
    hdg: toDeg(a.heading),
    ias: Math.max(0, Math.round(live.cont?.airspeed ?? 0)),
    bank: Math.round(live.cont?.bank ?? 0),      // attitude → viewers render true orientation
    pitch: Math.round(live.cont?.pitch ?? 0),
    vs: Math.round(live.cont?.vs ?? 0),
    band: a.altitude_band,
    hullPct: Math.max(0, Math.round((1 - (a.damage || 0)) * 100)),
    reg: String(a.name || live.type?.name || '???').toUpperCase().slice(0, 8),
    cls: live.type?.class || 'prop',
  };
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
  live.aaThreat = null;
  live.aaWarned = false;
  live.runup = false;
  live.engines = null;
  live.coldStart = 0;
  // The aircraft comes to rest on the ramp (parked_zone_id above, boardable from the
  // hangar), but you taxi it into the walk-in hangar to shut down and climb out — so
  // occupants disembark INSIDE the hangar office when the field has one (mirrors the
  // hangar-only embark), otherwise onto the ramp itself.
  const hangar = z?.flags?.hangar_interior_zone;
  const occZone = getZone(hangar) ? hangar : zoneId;
  for (const pid of live.occupants) {
    const p = getLivePlayer(pid);
    if (!p) continue;
    if (p.posture === 'flying') forceStand(p, 'flight.land');
    p.current_zone = occZone;
    getZone(occZone)?.players.add(pid);
    closeHud(pid);
    out(pid, occZone === zoneId
      ? `<span class="text-dim">You are down at ${z?.name || 'the field'}.</span>`
      : `<span class="text-dim">You taxi into the hangar at ${z?.name || 'the field'}, cut the engine, and climb out.</span>`);
  }
  await persist(live);
}

// ── Turn the craft into a salvageable wreck + kill everyone aboard ────────────
// `byPlayer` (optional) is the pilot who shot it down — used for the kill feed + the
// death label so an air-to-air kill reads as a kill, not a solo crash.
export async function crash(live, reason = 'crash', byPlayer = null) {
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
  live.aaThreat = null;
  live.aaWarned = false;
  await persist(live);
  const downedBy = byPlayer ? ` — ${byPlayer.handle} splashes it` : '';
  sendToZone(wreckZone, { type: 'zone_event', message: `<span class="text-red">A ${live.type.name} screams down out of the sky and craters into the ground in a fireball${downedBy}.</span>`, refresh: true });
  const label = byPlayer ? `Shot down by ${byPlayer.handle}` : 'Died in an aircraft crash';
  const doomed = [...live.occupants];
  for (const pid of doomed) {
    const p = getLivePlayer(pid);
    if (!p) continue;
    detach(p, { restore: true });
    p.current_zone = wreckZone;
    out(pid, byPlayer
      ? '<span class="text-red">Rounds find something vital — the controls go dead and the world tips up. There is a noise, and then nothing.</span>'
      : '<span class="text-red">The ground comes up to meet you. There is a noise, and then there is nothing.</span>');
    await handlePlayerDeath(p, byPlayer || null, { type: reason, label });
  }
  if (byPlayer) out(byPlayer.id, `<span class="text-green">★ SPLASH ONE — you shot down the ${live.type.name}.</span>`);
  // Notify listeners (Halcyon Assurance files a claim if the craft was insured). Past-tense,
  // fire-and-forget — insurance reads the wreck row it just persisted above.
  emit('flight.crashed', {
    aircraftId: live.row.id, ownerId: live.row.owner_id, typeId: live.type.id,
    typeName: live.type.name, reason, wreckZone, rental: !!live.row.rental,
  });
  liveAircraft.delete(live.row.id);
}

// Accepts a cardinal ('nw'), a compass degree (247 or '247'), or a legacy string;
// always stores a normalised degree string on the row.
export function setHeading(live, dirOrDeg) { live.row.heading = String(toDeg(dirOrDeg)); }
export { syncEngineTemp };

// Convenience re-exports so submodules import world/zone helpers from one place.
export { getZone, getLivePlayer, sendToZone, sendToZoneExcept, sendToPlayer, setPosture, forceStand };
