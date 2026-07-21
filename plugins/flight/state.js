// Flight — shared state substrate for the plugin's submodules.
//
// index.js owns the flight *verbs* and the tick loop; combat.js / contracts.js /
// hangars.js / hazards.js / acquisition.js are the *systems*. They all need the
// same live-aircraft registry, the computed-overlay coord lookup, the synthesized
// HUD payload, and the shared park/crash transitions — so those live here, in one
// place, and every module imports them. Nothing here is a command; it's the
// engine-facing seam the whole plugin shares.

import { query } from '../../server/models/db.js';
import { getZone, getAllZones, getLivePlayer, getMinimapData, buildingEntranceDir, getRegion, addPlayerToZone, removePlayerFromZone } from '../../server/engine/world.js';
import { describeZone } from '../../server/engine/commands/describe.js';
import { biomeOf, districtBiome } from './biomes.js';
import { normalizeLivery } from './livery.js';
import { sendToPlayer, sendToZone, sendToZoneExcept } from '../../server/engine/messaging.js';
import { setPosture, forceStand } from '../../server/engine/posture.js';
import { handlePlayerDeath } from '../../server/engine/gameLoop.js';
import { emit } from '../../server/engine/events.js';
import { applyCrashCollateral, isSeverelyImpaired } from './collateral.js';
import { getEnvironmentState, getWeatherFieldSnapshot } from '../../server/engine/environment.js';

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

// ── Air-to-air missiles (Phase C) ─────────────────────────────────────────────
// Lockable seekers for beyond-guns kills, flares as the counter. The client owns the
// lock *cycle* feel (hold the bogey in the seeker cone LOCK_TIME_MS to acquire); the
// server validates the lock (`airlock`) and owns the entire missile outcome — launch,
// flight time, flare/jink defeat rolls, damage. Ammo = the airframe's hardpoints,
// spent per sortie and rearmed free on parking at a field (guns stay infinite).
export const MISSILE_RANGE = 8;           // client seeker range (tiles)
export const MISSILE_RANGE_GATE = 9.5;    // server range gate (lenient for lag)
export const MISSILE_CONE = 25;           // client seeker half-cone (deg off the nose)
export const LOCK_TIME_MS = 2500;         // client hold-to-lock time
export const MISSILE_FLIGHT_MS = 4000;    // launch → impact resolution window
export const MISSILE_PK = 0.7;            // base kill probability of a clean shot
export const MISSILE_DMG = 0.5;           // hull fraction on impact (two kill a healthy craft)
export const MISSILE_COOLDOWN_MS = 1500;  // min ms between launches (server-enforced)
export const FLARE_DEFEAT = 0.6;          // chance flares decoy an inbound seeker
export const FLARE_WINDOW_MS = 5000;      // how long a flare burst covers you
export const FLARE_COOLDOWN_MS = 8000;    // launcher recycle time
// Missiles remaining on the rails (in-memory per sortie; null = full rails).
export function mslAmmo(live) { return live.msl ?? (live.type?.hardpoints || 0); }

// ── Missile SWARM (the Viper's fire-and-forget barrage) ───────────────────────
// An armed heli with `data.salvo > 1` ripples that many seekers off the rails in ONE
// trigger squeeze at the bore-designated bogey — NO lock, NO seeker tone, NO RWR lock
// warning (the target only gets the inbound-missile shout as they arrive). The trade for
// skipping the lock cycle: each dumb seeker is less likely to connect (SWARM_PK_MULT) and
// carries a smaller warhead (SWARM_DMG_MULT) than a full locked Hellfire, and the launch
// envelope is a wide forward cone rather than a tight seeker gate. Flares/notch still defeat
// each one individually, so a swarm overwhelms by numbers, not certainty.
export const SWARM_PK_MULT = 0.5;        // per-seeker kill-prob vs a clean locked shot (no lock = dumber)
export const SWARM_DMG_MULT = 0.7;       // per-seeker warhead vs a full Hellfire
export const SWARM_CONE = 45;            // forward launch cone (deg off the nose) — no lock, so lenient
export const SWARM_COOLDOWN_MS = 2200;   // ripple reload between swarms
export function salvoOf(live) { return Math.max(1, live.type?.data?.salvo || 1); }

// ── Continuous-flight seam (Phase 1 slice) ────────────────────────────────────
// The overhaul's continuous energy model runs client-side; the server reconciles
// and owns the consequences. It's gated to ONE airframe (the Mayfly) for the slice
// — every other type keeps the discrete band/deck flow untouched until Phase 3.
// Craft flown on the continuous cockpit sim. The whole fleet is here now — the fixed-wing
// set plus the Dragonfly (VTOL), which flies the client's dedicated hover model (collective
// + cyclic + pedals) instead of the old modal VTOL-lift deck.
export const CONTINUOUS_TYPES = new Set(['ac_mayfly', 'ac_mule', 'ac_leviathan', 'ac_reaper', 'ac_carcass', 'ac_dragonfly', 'ac_grasshopper', 'ac_locust', 'ac_viper']);
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
// When two map_world zones share a grid tile (e.g. a bespoke landmark stamped ONTO an
// existing terrain tile — the Echelon sits on a Coldwater Basin water cell), the index can
// only hold one. Rank them so the content-bearing tile always wins its grid instead of
// last-iterated-wins silently clobbering it: a landmark/airfield/building outranks a road,
// which outranks bare terrain. Used by both surfaceAt (live) and the flightsim snapshot.
export function surfaceRank(flags = {}) {
  if (flags.yacht) return 3;                                             // bespoke landmark — always owns its tile
  if (flags.airfield_id || flags.building_type) return 2;               // airfield / building
  if (/^(road_|runway_|statue)/.test(flags.icon || '')
      || (Array.isArray(flags.artery) && flags.artery.length)) return 1; // road / artery / statue
  return 0;                                                             // plain terrain (water, land)
}
let _coordIndex = null;
let _bounds = null;

// ── Echelon "making way" ─────────────────────────────────────────────────────
// When the yacht sails a tile, she carries a decaying wake for a short spell so EVERY
// nearby pilot's windshield paints it at her new position — not just the owner's Helm
// chase view (which sets its own wake client-side). The yacht plugin pings setYachtMakingWay
// on a successful move via the soft-import it already uses; the window builder below reads
// this to attach `wake:{spd}` to the yacht cell. Transient, module-local — no DB, no flags.
const YACHT_WAKE_MS = 20_000;
let _yachtWakeUntil = 0;
export function setYachtMakingWay() { _yachtWakeUntil = Date.now() + YACHT_WAKE_MS; }

// An in-progress ten-minute passage: while set, the yacht is between tiles and the window builder
// glides her model sub-tile toward the destination so EVERY nearby pilot sees her actually making
// way across the Basin (not sitting still until she pops to the next tile). Authoritative + time-
// based, so it's identical for everyone and correct even for a pilot who arrives mid-passage. The
// yacht plugin sets/clears it around its own `transit`. Transient, module-local — no DB, no flags.
// Either a straight leg — { fromX, fromY, toX, toY, startAt, arriveAt } — or, for a charted
// course that bends around land, a POLYLINE — { path:[[x,y],…], startAt, arriveAt } where path[0]
// is her departure tile. yachtTransitPose() folds both into a live sub-tile offset + heading.
let _yachtTransit = null;
export function setYachtTransit(t) { _yachtTransit = t || null; }
export function clearYachtTransit() { _yachtTransit = null; }
// Heading (deg, bow-north = 0) implied by a tile delta, snapped to the nearest of the eight rhumbs
// — handles the diagonals a charted course walks, not just the four cardinals.
function deltaHeading(dx, dy) {
  if (!dx && !dy) return 0;
  const deg = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
  return (Math.round(deg / 45) * 45) % 360;
}
// Her live sub-tile lead (from the departure tile) + bow heading partway through a passage, for
// both the straight-leg `sail` and the pathfound `sailto`. null once she's arrived / not underway.
function yachtTransitPose(now) {
  const T = _yachtTransit;
  if (!T || now >= T.arriveAt) return null;
  const frac = Math.max(0, Math.min(1, (now - T.startAt) / (T.arriveAt - T.startAt)));
  if (Array.isArray(T.path) && T.path.length >= 2) {
    const segs = T.path.length - 1, f = frac * segs;
    const i = Math.min(segs - 1, Math.floor(f)), local = f - i;
    const [ax, ay] = T.path[i], [bx, by] = T.path[i + 1];
    const cx = ax + (bx - ax) * local, cy = ay + (by - ay) * local;
    return { sub: { x: cx - T.path[0][0], y: cy - T.path[0][1] }, heading: deltaHeading(bx - ax, by - ay) };
  }
  const ddx = T.toX - T.fromX, ddy = T.toY - T.fromY;
  return { sub: { x: ddx * frac, y: ddy * frac }, heading: deltaHeading(ddx, ddy) };
}

export function buildCoordIndex() {
  const idx = new Map();
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (const z of getAllZones()) {
    if (z.map_id !== 'map_world' || z.grid_x == null || z.grid_y == null) continue;
    const key = `${z.grid_x},${z.grid_y}`, prev = idx.get(key);
    // Keep the higher-priority tile when two zones collide on one grid (see surfaceRank).
    if (!prev || surfaceRank(z.flags || {}) > surfaceRank(prev.flags)) {
      idx.set(key, { id: z.id, name: z.name, flags: z.flags || {}, danger: z.danger });
    }
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

// Nearest airfield tile to a grid point (Chebyshev distance) — used to tow a craft
// home after an off-strip landing. Returns { id, name, dist } or null if the world
// somehow has no airfields.
export function nearestAirfield(x, y) {
  if (!_coordIndex) buildCoordIndex();
  let best = null;
  for (const cell of _coordIndex.values()) {
    if (!cell.flags?.airfield_id) continue;
    const z = getZone(cell.id);
    if (z?.grid_x == null) continue;
    const dist = Math.max(Math.abs(z.grid_x - x), Math.abs(z.grid_y - y));
    if (!best || dist < best.dist) best = { id: cell.id, name: cell.flags.airfield_name || cell.name, dist };
  }
  return best;
}

// Every landable airfield on the world grid — { id, name, gx, gy } — for the NAV console's
// destination list (the walkable-base crew flies charted airfield-to-airfield legs).
export function listAirfields() {
  if (!_coordIndex) buildCoordIndex();
  const out = [];
  for (const cell of _coordIndex.values()) {
    if (!cell.flags?.airfield_id) continue;
    const z = getZone(cell.id);
    if (z?.grid_x == null) continue;
    out.push({ id: cell.id, name: cell.flags.airfield_name || cell.name, gx: z.grid_x, gy: z.grid_y });
  }
  return out;
}

// The Echelon's helipad field if she's within `range` tiles of (x,y). She's a small,
// moving target, so a VTOL setting down *alongside* her — not just dead-centre on her one
// tile — still lands on the pad. Keyed off flags.yacht so only the Echelon gets this
// proximity forgiveness; ordinary helipads keep their exact-tile touch-and-go. Reads the
// coord index (her tile commits there on arrival), so it tracks her around the Basin.
export const YACHT_LAND_RANGE = 1;
export function yachtFieldNear(x, y, range = YACHT_LAND_RANGE) {
  if (!_coordIndex) buildCoordIndex();
  for (const cell of _coordIndex.values()) {
    if (!cell.flags?.yacht || !cell.flags?.airfield_id) continue;
    const z = getZone(cell.id);
    if (z?.grid_x == null) continue;
    if (Math.max(Math.abs(z.grid_x - x), Math.abs(z.grid_y - y)) <= range) return z;
  }
  return null;
}

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

// The real runway a field's aircraft take off along, derived from the map's yellow
// runway-centreline tiles (flags.runway = 'ns'|'ew') rather than the aircraft's own
// stored heading — so the runway the cockpit draws sits exactly on the tiles you see
// on the map. Returns { ox, oy, hdg, len } (origin = the threshold nearest the ramp,
// heading points down the strip toward the far end, len = tile count) or null if the
// field has no runway near it (e.g. a VTOL helipad).
export function runwayFor(fieldZone) {
  if (!fieldZone || fieldZone.grid_x == null) return null;
  const rx = fieldZone.grid_x, ry = fieldZone.grid_y, map = fieldZone.map_id;
  const cl = getAllZones().filter(z => z.map_id === map && z.grid_x != null &&
    (z.flags?.runway === 'ns' || z.flags?.runway === 'ew'));
  if (!cl.length) return null;
  let near = null, nd = Infinity;
  for (const z of cl) { const d = Math.max(Math.abs(z.grid_x - rx), Math.abs(z.grid_y - ry)); if (d < nd) { nd = d; near = z; } }
  if (nd > 3) return null; // no runway adjacent to this field
  const ns = near.flags.runway === 'ns';
  // The contiguous centreline through `near` (tiles sharing its axis line).
  const along = cl.filter(z => ns ? z.grid_x === near.grid_x : z.grid_y === near.grid_y)
    .map(z => ns ? z.grid_y : z.grid_x).sort((a, b) => a - b);
  const lo = along[0], hi = along[along.length - 1], len = hi - lo + 1;
  const fieldC = ns ? ry : rx;
  const nearEnd = Math.abs(fieldC - lo) <= Math.abs(fieldC - hi) ? lo : hi;
  const farEnd = nearEnd === lo ? hi : lo;
  if (ns) return { ox: near.grid_x, oy: nearEnd, hdg: farEnd < nearEnd ? 0 : 180, len };
  return { ox: nearEnd, oy: near.grid_y, hdg: farEnd > nearEnd ? 90 : 270, len };
}

// The airfield a runway tile serves: given a tile that carries flags.runway but not
// flags.airfield_id, find the airfield zone whose ramp sits within reach of the strip
// (mirrors runwayFor's ≤3-tile field↔runway contract, inverted). Lets a craft that
// touches down anywhere along the strip resolve to its field even when the airfield_id
// tile sits BESIDE the centreline (e.g. Buzzard Field's hangar is east of its runway)
// rather than on it (as at Coldwater Regional, where the airfield_id tile is a runway
// end) — otherwise an off-centreline touchdown reads as off-strip and tows home.
export function airfieldForRunway(tile) {
  if (!tile || tile.grid_x == null || !tile.flags?.runway) return null;
  let best = null, nd = Infinity;
  for (const z of getAllZones()) {
    if (z.map_id !== tile.map_id || z.grid_x == null || !z.flags?.airfield_id) continue;
    const d = Math.max(Math.abs(z.grid_x - tile.grid_x), Math.abs(z.grid_y - tile.grid_y));
    if (d <= 3 && d < nd) { nd = d; best = z; }
  }
  return best;
}

// True when the player is standing INSIDE a walk-in hangar interior (at the desk),
// as opposed to out on the exterior ramp. Aircraft *requests* (buy/rent/charter) are
// gated to inside the hangar — you deal with the desk indoors, then the machine is
// out on the ramp to fly. Maintenance verbs stay usable from either.
export function inHangarInterior(player) {
  return !!getZone(player.current_zone)?.flags?.hangar_interior;
}

// A VTOL-only field (a helipad): no runway, so only rotorcraft/VTOL can work out of it.
// Gates acquisition (buy/rent) AND charter to `takeoff_mode === 'vtol'` craft. The
// canonical flag is `airfield_vtol_only`; `charter_vtol_only` is the older Echelon-pad
// flag, kept working here so both read as the same thing.
export function vtolOnlyField(field) {
  const f = field?.flags || {};
  return !!(f.airfield_vtol_only || f.charter_vtol_only);
}

// The airframes a field may sell or rent. SSOT for both the text desk
// (acquisition.js `buy`/`rent`) and the hangar-bay lot (hangars.js) — they used to
// run separate copies of this query and drifted, so a helipad's lot offered
// fixed-wings whose Buy/Rent buttons the text path then refused.
export async function acquirableTypes(field) {
  const { rows } = await query(
    `SELECT id, name, class, seats, cargo_capacity, fuel_type, price_buy, price_rent_hourly, takeoff_mode, hardpoints
       FROM aircraft_types WHERE class <> 'wreck'${vtolOnlyField(field) ? " AND takeoff_mode = 'vtol'" : ''} ORDER BY price_buy`);
  return rows;
}

// ── Live aircraft registry (in-memory; the aircraft owns its occupant set) ────
export const liveAircraft = new Map();   // id -> { row, type, occupants:Set<pid>, pending, starving, hazard, persistCtr }

export async function loadAircraft(id) {
  if (liveAircraft.has(id)) return liveAircraft.get(id);
  const { rows } = await query('SELECT * FROM aircraft WHERE id=$1', [id]);
  if (!rows.length) return null;
  const { rows: tRows } = await query('SELECT * FROM aircraft_types WHERE id=$1', [rows[0].type_id]);
  if (!tRows.length) return null;
  const live = { row: rows[0], type: tRows[0], occupants: new Set(), pilotId: null, pending: null, starving: false, hazard: null, persistCtr: 0 };
  liveAircraft.set(id, live);
  return live;
}

// `pilotId` is the durable source of truth (survives a pilot's hard refresh, which
// tears down and rebuilds their in-memory player object — see the flight `player.login`
// reconnect-resume hook in index.js). Fall back to scanning occupants' `.seat` for any
// craft that predates the field (shouldn't happen once everything sets it on boarding).
export function pilotOf(live) {
  if (live.pilotId) {
    const p = getLivePlayer(live.pilotId);
    if (p) return p;
  }
  for (const pid of live.occupants) {
    const p = getLivePlayer(pid);
    if (p && p.seat === 'pilot') return p;
  }
  return null;
}

// ── Tuning model (continuous knobs) ───────────────────────────────────────────
// Four knobs, each a signed float. How far a knob turns (its "reasonable range") is
// gated by Fabrication skill + installed kits and capped at TUNE_DIAL_MAX — you
// can't push a curve past what your hands and your gear allow. Every knob trades
// one thing for another; the bench graphs read straight off computeStats below, so
// the picture the player sees is exactly how she'll fly.
export const TUNE_DIAL_MAX = 2.0;      // absolute knob travel (±), even fully kitted
const TUNE_SAFE_BASE = 0.8;            // reachable ± at zero Fabrication, no kits
export const TUNE_KEYS = ['mixture', 'pitch', 'boost', 'cg'];

// Bolt-on kits — bought and installed at a hangar, stored on the craft as
// custom_data.kits. A kit either widens the tuning range (rangeBonus) or bends the
// physics (read in computeStats). Deliberately a small authored catalogue (like the
// contracts' JOB_TYPES), not DB content: a kit is a mechanic, not world content.
export const KITS = {
  kit_precision: { name: 'Precision Tuning Kit', price: 850, rangeBonus: 0.6,
    blurb: 'Machined linkages and a wideband sensor — every knob turns further before she bites.' },
  kit_intercooler: { name: 'Intercooler & Oil Cooler', price: 1200, coolMult: 0.6,
    blurb: 'Sheds heat, so lean mixtures and boost cost far less temperature and reliability.' },
  kit_smuggler_hold: { name: "Smuggler's False-Bottom Hold", price: 2200, smugglerHold: true,
    blurb: 'A machined false floor and a lead-lined liner — customs scanners skate right over what rides underneath. Most of the time.' },
};
export function installedKits(cd) { return Array.isArray(cd?.kits) ? cd.kits.filter(k => KITS[k]) : []; }
// The reachable ± for every knob: a base band, widened smoothly by Fabrication and
// by any range-widening kits, hard-capped at TUNE_DIAL_MAX.
export function tuneRange(fabSkill, kits) {
  const kitBonus = (kits || []).reduce((s, k) => s + (KITS[k]?.rangeBonus || 0), 0);
  const r = TUNE_SAFE_BASE + Math.min(0.6, (fabSkill || 0) * 0.045) + kitBonus;
  return Math.round(Math.min(TUNE_DIAL_MAX, r) * 100) / 100;
}

// The SINGLE source of truth for how tune + load + kits bend a template's base
// numbers. effStats (the tick loop / hazards / HUD) and perfAxes (the bench graphs)
// both go through here, so a change can never look one way on the dyno and fly
// another. Signs are internally coherent: lean (+mixture) saves fuel but runs hot
// and sheds a little power; coarse pitch and boost buy speed; boost also drinks and
// heats; tail-heavy CG trades stability for agility.
export function computeStats(type, tune = {}, cargo = 0, kits = []) {
  const mix = tune.mixture || 0, pitch = tune.pitch || 0, boost = tune.boost || 0, cg = tune.cg || 0;
  const maxTOW = type.max_takeoff_weight || 300;
  const loadFrac = cargo / maxTOW;                                 // 0..1+ (weight & balance)
  const coolMult = kits.includes('kit_intercooler') ? KITS.kit_intercooler.coolMult : 1;
  return {
    burn: type.fuel_burn_base * (1 - mix * 0.12 + boost * 0.06) * (1 + loadFrac * 0.5),   // lean saves fuel; boost drinks; cargo drinks
    cruise: type.cruise_speed * FLIGHT_PACE * (1 + pitch * 0.12 + boost * 0.10 - mix * 0.03),  // coarse pitch + boost = faster; lean sheds a little power
    handling: (type.handling || 0) + cg * 0.5 + Math.abs(boost) * 0.2 + loadFrac * 3,    // tail-heavy + boost = twitchier; heavy = harder
    heatBias: (mix * 13 + Math.abs(boost) * 11) * coolMult,        // lean & boost run hot (intercooler tames it)
    ceiling: Math.min(3, type.altitude_ceiling || 2),
    fuelCap: type.fuel_capacity || 1,
    cargo, maxTOW, overweight: cargo > maxTOW,
  };
}
export function effStats(live) {
  const cd = live.row.custom_data || {};
  return computeStats(live.type, cd.tune || {}, cd.cargoWeight || 0, installedKits(cd));
}

// Five performance axes for the bench radar/delta-bars, each 0..100 with 50 = stock.
// SPEED/ECON/RANGE/COOL come straight off computeStats (so the graph can't lie about
// how she flies); AGILITY is read off the knobs directly (the CG/pitch handling feel,
// which isn't a single computeStats scalar). Mirrored client-side in hangar-bay.js —
// keep the two in sync.
export const PERF_AXES = [
  { id: 'speed', label: 'SPEED' },
  { id: 'economy', label: 'ECON' },
  { id: 'range', label: 'RANGE' },
  { id: 'cool', label: 'COOL' },
  { id: 'agility', label: 'AGILITY' },
];
export function perfAxes(type, tune = {}, cargo = 0, kits = []) {
  const cur = computeStats(type, tune, cargo, kits), stk = computeStats(type, {}, cargo, kits);
  const cl = v => Math.max(2, Math.min(100, Math.round(v)));
  const rangeOf = s => s.cruise / s.burn;
  const cg = tune.cg || 0, pitch = tune.pitch || 0, loadFrac = cargo / (type.max_takeoff_weight || 300);
  return {
    speed: cl(50 + (cur.cruise / stk.cruise - 1) * 300),
    economy: cl(50 + (stk.burn / cur.burn - 1) * 300),
    range: cl(50 + (rangeOf(cur) / rangeOf(stk) - 1) * 260),
    cool: cl(50 - cur.heatBias * 1.6),
    agility: cl(50 + cg * 16 - pitch * 8 - loadFrac * 22),
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
// The surface window streamed to the cockpit. Radius 24 (a 49×49 tile block) feeds the
// windshield's long skyline (VISIBLE_FAR_F = 20 tiles) with a ~4-tile drift margin — the
// window only refreshes every TICK_MS (3s) while the client slides it locally, so the far
// edge must sit well beyond the draw distance or new tiles would starve/pop. Keep
// radius ≥ VISIBLE_FAR_F + drift so the farthest tile the renderer wants always exists in
// the payload. It's a ~2400-cell JSON pushed only every 3s while airborne — cheap.
// A surface cell reads as road if it's a named artery, carries a road/runway map icon, or
// is painted `road` terrain — the same signals the minimap paints grey asphalt from.
function isRoadCell(c) {
  const f = c && c.flags;
  if (!f) return false;
  return (Array.isArray(f.artery) && f.artery.length > 0)
    || /^(road_|runway_)/.test(f.icon || '')
    || f.terrain === 'road' || f.terrain === 'dirt_road';
}

// The Curtain — the Architect's energy wall on the city's land edges (flags.curtain). The
// windshield raises a shimmer plane on each such tile; it needs to know WHICH neighbours are
// also Curtain so the wall arms only reach toward real neighbours and fuse into one barrier.
// Returns the directions (subset of 'n','e','s','w') that carry on the wall — so a straight run
// gets 'ns'/'ew' (a full span), a corner gets an L like 'nw' (no stray stub poking into empty
// air), and an endpoint gets a single arm. Same directional scheme the road auto-tiler uses.
// A perimeter GATE tile counts as a wall-continuation here (though it carries no curtain flag of
// its own — it's the gap): so the flanking Curtain reaches all the way to the shared edge with the
// gate and butts into its blast-pylons, instead of stopping a tile short with a visible break.
const isCurtain = c => !!(c && c.flags && (c.flags.curtain || c.flags.perimeter_gate));
export function curtainRun(cx, cy) {
  let s = '';
  if (isCurtain(surfaceAt(cx, cy - 1))) s += 'n';
  if (isCurtain(surfaceAt(cx + 1, cy))) s += 'e';
  if (isCurtain(surfaceAt(cx, cy + 1))) s += 's';
  if (isCurtain(surfaceAt(cx - 1, cy))) s += 'w';
  return s || 'ns';   // isolated tile: stand a lone N–S wall so it never vanishes
}

function mapWindow(a, radius = 36) {
  const rows = [];
  for (let dy = -radius; dy <= radius; dy++) {
    const row = [];
    for (let dx = -radius; dx <= radius; dx++) {
      // The tile directly under the craft (0,0): keep its REAL surface so the runway/road
      // still paints under us — just flag it `self` so nothing extrudes on our own tile (the
      // building/tree/rock pass and the radar own-blip skip on `self`). Nuking it to a bare
      // { kind:'craft' } used to leave a hole in the pavement right where we sit.
      const self = dx === 0 && dy === 0 ? 1 : undefined;
      const cell = surfaceAt(a.grid_x + dx, a.grid_y + dy);
      if (!cell) { row.push({ kind: 'air', self }); continue; }
      // Each surface cell carries its derived biome, whether a road runs through it, and its
      // danger tier — the windshield renders the real world. A tile counts as road if it's a
      // named artery OR carries a road/runway map icon (the authoritative per-tile road marker,
      // the same one the minimap paints grey asphalt), so EVERY street on the map gets its
      // asphalt + lane markings out the canopy — not just the major avenues.
      const biome = biomeOf(cell);
      const road = isRoadCell(cell) ? 1 : 0;
      const kind = cell.flags?.airfield_id ? 'field' : cell.flags?.airspace_restricted ? 'nofly' : 'land';
      // Surface look ('dust' = graded dirt — wheel ruts, no paint/PAPI/edge lights). On a field
      // tile an explicit `flags.airfield_surface` wins, else a lawless frontier strip defaults to
      // dust (paved regional airports leave it undefined). A `dirt_road` terrain tile — including
      // a frontier runway centreline painted as dirt_road — carries the same dust look so the
      // road pass renders it as a packed-dirt track rather than asphalt.
      const ft = (kind === 'field'
        ? (cell.flags?.airfield_surface || (cell.flags?.airfield_lawless ? 'dust' : undefined))
        : undefined)
        || (cell.flags?.terrain === 'dirt_road' ? 'dust' : undefined);
      // Building tiles carry their building_type AND their name so the windshield can
      // render either a dedicated per-building model (keyed off the name) or, failing
      // that, the type's 3-D archetype (office tower, warehouse, diner…), with a fallback.
      const bt = cell.flags?.building_type || undefined;
      const bn = cell.flags?.building_name || undefined;
      // Door face + storey count so the windshield can angle the building's entrance
      // toward the street and scale its height by real floors (a 3-floor shop is not
      // a tower). `ent` is 'north'|'south'|'east'|'west' (cached in world.js); `flr`
      // is an explicit authored floor override (flags.floors), else the windshield
      // falls back to a sensible per-type default.
      let ent, flr;
      if (bt) {
        const z = getZone(cell.id);
        ent = (z && buildingEntranceDir(z)) || undefined;
        flr = cell.flags?.floors || undefined;
      }
      // Bespoke landmarks the windshield raises instead of bare ground, carried on the
      // `mark` channel: a `statue-*` map icon → the town-square statue+fountain; the
      // Echelon's exterior tile (flags.yacht) → a sleek black yacht with a lit helipad.
      const mark = cell.flags?.yacht ? 'yacht'
        : cell.flags?.perimeter_gate ? 'gate'
        : (/^statue/.test(cell.flags?.icon || '') ? 'statue' : undefined);
      // A yacht that's recently sailed streams a decaying wake to every pilot in view.
      let wake, sub, heading;
      if (mark === 'yacht') {
        const now = Date.now();
        // Underway: glide the hull sub-tile from her departure cell toward the destination by the
        // passage's time-progress (0→1), point her bow along the course, and hold a steady wake.
        // The yacht's own tile only commits on arrival, so her cell sits at `from`; `sub` carries
        // the fractional lead so the windshield draws the model partway across the water.
        const pose = yachtTransitPose(now);
        if (pose) {
          sub = pose.sub;
          heading = pose.heading;
          wake = { spd: 0.42 };   // steady but calm making-way wash for the whole passage (a big hull moves slowly)
        } else {
          // Moored (or just arrived): hold the last course she steamed (persisted on flags.heading),
          // so she never snaps back to bow-north for pilots overflying her.
          heading = Number(cell.flags?.heading) || 0;
          if (_yachtWakeUntil > now) wake = { spd: (_yachtWakeUntil - now) / YACHT_WAKE_MS };   // 1 → 0 over YACHT_WAKE_MS
        }
      }
      // Road piece connections, straight off the map icon suffix (road_ns, road_ne turn,
      // road_nes T, road_nesw / road_x crossroads, road_n stub, …). The windshield paints
      // lane markings toward each connected edge, so junctions, turns and Ts all read as what
      // they are — not just straights. `rd` = the connected-direction letters (subset of nesw).
      let rd;
      const im = /^road_([nesw]+|x)$/.exec(cell.flags?.icon || '');
      if (im) rd = im[1] === 'x' ? 'nesw' : im[1];
      else if (cell.flags?.terrain === 'road' || cell.flags?.terrain === 'dirt_road') {
        // Painted road/dirt_road with no authored icon: auto-tile the connector from adjacent road cells.
        const cx = a.grid_x + dx, cy = a.grid_y + dy;
        let s = '';
        if (isRoadCell(surfaceAt(cx, cy - 1))) s += 'n';
        if (isRoadCell(surfaceAt(cx + 1, cy))) s += 'e';
        if (isRoadCell(surfaceAt(cx, cy + 1))) s += 's';
        if (isRoadCell(surfaceAt(cx - 1, cy))) s += 'w';
        rd = s || 'nesw';
      }
      // The Curtain energy wall on a land-edge tile — carry its run axis so the windshield
      // stands a shimmer barrier along it (see curtainRun).
      // A Curtain tile carries its own run axis; the perimeter GATE tile carries no curtain flag
      // (it's the gap) but still needs the wall's run — read it off its Curtain neighbours so the
      // gate's flanking pylons line up with the wall it breaches.
      const cur = (cell.flags?.curtain || cell.flags?.perimeter_gate) ? curtainRun(a.grid_x + dx, a.grid_y + dy) : undefined;
      row.push({ kind, biome, road, danger: cell.danger, bt, bn, ent, flr, mark, rd, wake, sub, heading, self, cur, ft, pf: cell.flags?.park_feature });
    }
    rows.push(row);
  }
  return rows;
}

// The same REAL world window (piers, buildings, roads, water, the city skyline) centred on an
// arbitrary tile — for the Echelon's Helm chase view, so she's framed against the actual basin
// and shoreline she sits in, not a blank ocean. The centre is her own tile: clear its `self`
// flag (which suppresses the extrusion pass) so the windshield draws her 3D model, and keep it a
// `mark:'yacht'` water cell. The client overlays live wake/heading on that centre cell each frame.
// Radius matches the flight-sim window (36) — ≥ the renderer's VISIBLE_FAR_F (34) — so the WHOLE
// skyline the chase view can draw is always in the payload. A smaller window (was 24) left the far
// city short of the draw distance, so buildings "popped in" at the window edge as she made way; at
// 36 the full basin is present from the moment the helm opens and never reveals in as she moves.
export function yachtHelmWindow(x, y, radius = 36) {
  const rows = mapWindow({ grid_x: x, grid_y: y }, radius);
  const c = rows[radius] && rows[radius][radius];
  if (c) { c.self = undefined; if (!c.mark) c.mark = 'yacht'; }
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
  const all = [];
  for (const z of getAllZones()) {
    if (z.map_id !== 'map_world' || !z.flags?.airfield_id || z.grid_x == null) continue;
    const d = Math.hypot(z.grid_x - x, z.grid_y - y);
    // gx/gy let the client project a live target ring at the field's spot; id keeps the
    // player's chosen target stable across the list re-sorting each tick.
    all.push({ id: z.flags.airfield_id, name: z.flags.airfield_name || z.name, gx: z.grid_x, gy: z.grid_y,
      bearing: Math.round(bearingDeg(x, y, z.grid_x, z.grid_y)), dist: Math.round(d), _d: d });
  }
  all.sort((a, b) => a._d - b._d);
  // Every field within range tags the heading tape, but ALWAYS keep at least the nearest so the
  // target guide can always lock onto a field — even out over open country beyond tag range.
  let out = all.filter((f) => f._d <= FIELD_TAG_RANGE);
  if (!out.length && all.length) out = [all[0]];
  return out.map(({ _d, ...f }) => f);
}

// Named buildings near a coord, as targetable waypoints for the cockpit's target guide —
// the same {id,name,gx,gy,bearing,dist} shape as nearbyFields, so the client can cycle a
// real landmark (Precinct 9, the Embassy…) with the same [ / ] control that picks fields.
// Deduped by name (a building placed on more than one tile targets its nearest instance),
// nearest first, capped so the cycle list stays short. Range spans the whole city cluster
// so you can lock a landmark from across town and fly toward it.
const LANDMARK_RANGE = 60, LANDMARK_MAX = 8;
function nearbyLandmarks(x, y) {
  const all = [];
  for (const z of getAllZones()) {
    if (z.map_id !== 'map_world' || z.grid_x == null) continue;
    const name = z.flags?.building_name; if (!name) continue;
    const d = Math.hypot(z.grid_x - x, z.grid_y - y);
    if (d > LANDMARK_RANGE) continue;
    all.push({ id: z.id, name, gx: z.grid_x, gy: z.grid_y, bearing: Math.round(bearingDeg(x, y, z.grid_x, z.grid_y)), dist: Math.round(d), _d: d });
  }
  all.sort((a, b) => a._d - b._d);
  const seen = new Set(), out = [];
  for (const f of all) { if (seen.has(f.name)) continue; seen.add(f.name); out.push(f); if (out.length >= LANDMARK_MAX) break; }
  return out.map(({ _d, ...f }) => f);
}

// The spatial regions (Coldwater Basin, The Reach…) as coarse waypoints for the same
// target guide — one entry per region, its centroid derived from its member tiles, in
// the same {id,name,gx,gy,bearing,dist} shape so the client cycles them alongside fields
// and landmarks. A region spans many tiles, so this is a "fly toward that place" marker
// rather than a precise spot; capped to the nearest few centroids so the cycle stays sane.
// Region display names come from the in-memory regions cache (no DB round trip here).
const REGION_MAX = 6;
function nearbyRegions(x, y) {
  const acc = new Map();   // region_id → { sx, sy, n }
  for (const z of getAllZones()) {
    if (z.map_id !== 'map_world' || z.grid_x == null) continue;
    const rid = z.flags?.region_id; if (!rid) continue;
    const e = acc.get(rid) || { sx: 0, sy: 0, n: 0 };
    e.sx += z.grid_x; e.sy += z.grid_y; e.n++;
    acc.set(rid, e);
  }
  const all = [];
  for (const [rid, e] of acc) {
    const gx = Math.round(e.sx / e.n), gy = Math.round(e.sy / e.n);
    const dist = Math.hypot(gx - x, gy - y);
    all.push({ id: rid, name: getRegion(rid)?.name || rid, gx, gy, bearing: Math.round(bearingDeg(x, y, gx, gy)), dist: Math.round(dist), _d: dist });
  }
  all.sort((a, b) => a._d - b._d);
  return all.slice(0, REGION_MAX).map(({ _d, ...f }) => f);
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
    surface: a.airborne ? (below ? (below.flags?.building_name || below.name) : 'open air') : null,
    airborne: !!a.airborne, warn, fuelType: t.fuel_type, noise: t.noise || 2,
    armed: !!a.weapons_hot, hardpoints: t.hardpoints || 0,
    cargo: eff.cargo, maxTOW: eff.maxTOW, cargoCap: t.cargo_capacity || 0,
    seats: t.seats || 1, vtol: t.takeoff_mode === 'vtol', hover: !!live.hover,
    // Sent parked too (grid coords are valid on the deck) so the charter cabin can
    // paint the city skyline BEFORE takeoff instead of having it pop in during the
    // climb — the client fades it up under the airport scenery.
    map: mapWindow(a),
    biomeBelow: a.airborne && below ? districtBiome(below) : null,
    minimap: a.airborne && below ? getMinimapData(below.id, 3) : null,
    guide: (a.airborne && fuelPct < 30) ? nearestField(a.grid_x, a.grid_y) : null,
    // Parked: the terrain look of the field, for the out-the-canopy airport scene.
    // `helipad` swaps the out-the-canopy departure STRIP for a circle-H pad. Keyed
    // off the same vtolOnlyField() the rosters use, so any field flagged
    // airfield_vtol_only renders correctly without extra art data.
    ground: a.airborne ? null : { theme: groundTheme(parkedZone), field: parkedZone?.flags?.airfield_name || parkedZone?.name || null, helipad: vtolOnlyField(parkedZone) },
    sky: skyState(),
  };
}

// Time-of-day + weather for the client windshield's out-the-window scene (also
// reused by the hangar-bay floor, which shows the same sky through its open bay
// door).
export function skyState() {
  try {
    const env = getEnvironmentState();
    return {
      hour: env.hour, weather: env.currentWeatherType || env.weatherType || 'clear', wind: env.windKph || 0,
      // Spatial weather: the day's moving cloud/precip/storm cells over map_world, so the flight
      // sim can render the REAL clouds/rain out the canopy at their true bearings and advect them
      // itself between packets. `tick` is the field's advect interval (s) — `vx/vy` are per that
      // tick — so the client can extrapolate positions forward and needn't be re-sent every frame.
      field: weatherFieldForClient(),
    };
  } catch { return { hour: 12, weather: 'clear', wind: 0 }; }
}

// Compact the engine's weather-field snapshot for the wire: just the cells the renderer needs
// (position, radius, velocity, kind, strength) plus the map bounds it wraps within.
function weatherFieldForClient() {
  const snap = getWeatherFieldSnapshot();
  if (!snap || !snap.bounds || !snap.systems?.length) return null;
  // Prevailing wind as the compass bearing the cells drift TOWARD (renderer convention: 0 = -y
  // north, 90 = +x east), so the HUD wind arrow + flight turbulence share the drift's own wind.
  let wind = null;
  if (snap.wind) {
    const a = snap.wind.angle;
    wind = { dir: (Math.atan2(Math.cos(a), -Math.sin(a)) * 180 / Math.PI + 360) % 360, kph: snap.wind.kph || 0 };
  }
  return {
    tick: 30,   // advectField() steps once per 30s environment tick; vx/vy are grid units per tick
    bounds: snap.bounds, wind,
    cells: snap.systems.map(s => ({
      x: s.x, y: s.y, r: s.radius, vx: s.vx, vy: s.vy,
      type: s.type, intensity: s.intensity, precip: s.precipType,
    })),
  };
}

export function pushHud(live) {
  const payload = gaugePayload(live);
  const walkable = isWalkableCabin(live);
  for (const pid of live.occupants) {
    const p = getLivePlayer(pid);
    if (!p) continue;
    // Walkable cabin: an occupant walking the interior rooms is in a real MUD room, not
    // on the cockpit-window HUD — don't clobber it. But once they open the WINDOW overlay
    // (cabinWindowOpen) it IS fed the live view here. Non-cabin occupants (a seated pilot)
    // always get the HUD.
    if (walkable && isCabinZone(getZone(p.current_zone), live) && !p.cabinWindowOpen) {
      // No HUD — but they should still HEAR the engines around them (throttle-reactive):
      // a slim audio-only feed the client drives through the same engine-audio loops the
      // window overlay uses, without mounting a panel. Stopped by the cockpit_close that
      // landing/disembark already sends.
      sendToPlayer(pid, { type: 'cabin_audio', audio: {
        airborne: payload.airborne, engineOn: payload.engineOn, class: payload.class,
        throttle: payload.throttle, spd: payload.spd, engines: payload.engines, bandIndex: payload.bandIndex,
      } });
      continue;
    }
    sendToPlayer(pid, { type: 'cockpit_update', state: { ...payload, seat: p.cabinWindowOpen ? 'passenger' : p.seat } });
  }
}
// Feed ONE occupant the through-hull window view (the passenger cockpit_update the client
// mounts as the cabin-window overlay). The `window` verb calls this on open; pushHud then
// keeps it live each tick while cabinWindowOpen is set.
export function pushWindowTo(live, player) {
  sendToPlayer(player.id, { type: 'cockpit_update', state: { ...gaugePayload(live), seat: 'passenger' } });
}
// The authoritative stall read for reconcile: the client's own stall flag OR the unambiguous
// slow-nose-up-sinking signature. Pure + exported so the regress suite can pin the envelope.
// LENIENT by design — the thresholds sit well below any airframe's flapped stall speed and
// require a real nose-up AND a real sink, so an honest slow approach, or a pilot already
// recovering (nose down), is never flagged; it only catches a client reporting "not stalled"
// while plainly parked in the stall regime, so the flightTick consequences can't be dodged.
// cruise_speed is the only speed anchor the server carries per type; 0.35× it is sub-stall for all.
export function stalledState(type, d) {
  if (d.stalled) return true;
  if (!d.airborne || d.onGround) return false;
  const ias = Math.max(0, d.ias || 0), pitch = Number.isFinite(d.pitch) ? d.pitch : 0;
  return ias < (type?.cruise_speed || 80) * 0.35 && pitch > 3 && (d.vs || 0) < -400;
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
  let alt = Math.max(0, d.alt || 0), vs = d.vs || 0;
  // Damage-aware envelope: a craft that's shed a wing can't be flown straight-and-level by
  // a modified client — it can hold height or lose it, never climb. Deliberately LOOSE
  // (reject "flying like nothing happened", not a physics re-sim), so a legit pilot fighting
  // the controls on the way down is never false-snapped. Tightening these is a pure tuning pass.
  if (a.airborne && anyWingLost(a)) {
    const prevAlt = live.cont?.altitude ?? alt;
    if (alt > prevAlt) alt = prevAlt;   // no net climb on one wing
    if (vs > 0) vs = 0;
  }
  a.altitude_band = bandFromAltitude(alt, d.onGround);
  const ias = Math.max(0, d.ias || 0), pitch = Number.isFinite(d.pitch) ? d.pitch : 0;
  live.cont = { altitude: alt, airspeed: ias, vs,
    bank: Number.isFinite(d.bank) ? d.bank : 0, pitch,
    onGround: !!d.onGround,
    // Trust the client's stall flag for feel, but the unambiguous slow/nose-up/sinking signature
    // reads as stalled whatever a modified client claims (lenient anti-spoof; see stalledState).
    stalled: stalledState(live.type, { airborne: a.airborne, ias, pitch, vs, onGround: d.onGround, stalled: d.stalled }) };
}

// The world context pushed back to the client sim each server tick: authoritative
// fuel, the surface/obstacle window, sky/weather, and any warning.
export function contextPayload(live) {
  const a = live.row, eff = effStats(live), cap = eff.fuelCap || 1;
  // Grounded at a field, the "surface" readout should read as the airfield you're
  // sitting at, not whatever zone the grid rounds to — a landing/taxi roll-out can
  // drift the float position (live.fx/fy → rounded grid_x/grid_y) a tile or two off
  // the ramp's exact cell before it settles, coincidentally landing on a neighboring
  // zone's tile (e.g. reporting "Aid Station" while still physically on the strip).
  // parked_zone_id is the actual field you're at while grounded (null mid-flight —
  // takeoff clears it, parkAt sets it on landing), so it's the authoritative answer.
  const groundedField = !a.airborne && a.parked_zone_id ? getZone(a.parked_zone_id) : null;
  const surfaceZone = groundedField?.flags?.airfield_id ? groundedField : surfaceAt(a.grid_x, a.grid_y);
  return {
    type: 'flight_ctx',
    fuel: Math.round(a.fuel), fuelCap: Math.round(cap), fuelPct: Math.max(0, Math.round(a.fuel / cap * 100)),
    map: mapWindow(a), mapX: a.grid_x, mapY: a.grid_y, sky: skyState(),   // window centre → client keeps map+centre paired (no recenter pop)
    // Overflight readout: the real place under the craft — a named building wins over the
    // raw tile name, so you read "Embassy Hotel & Bar", not the street cell it sits on.
    surface: surfaceZone?.flags?.airfield_name || surfaceZone?.flags?.building_name || surfaceZone?.name || 'open air',
    biomeBelow: districtBiome(surfaceAt(a.grid_x, a.grid_y)),
    minimap: (() => { const b = surfaceAt(a.grid_x, a.grid_y); return b ? getMinimapData(b.id, 3) : null; })(),
    fields: nearbyFields(a.grid_x, a.grid_y),   // airport bearing tags for the heading tape
    landmarks: nearbyLandmarks(a.grid_x, a.grid_y),   // named buildings you can lock the target guide onto
    regions: nearbyRegions(a.grid_x, a.grid_y),   // spatial world-map places (Coldwater Basin…) you can lock the guide onto
    onField: !!surfaceAt(a.grid_x, a.grid_y)?.flags?.airfield_id,   // rolled onto a real airfield tile → auto-park + hangar on stop
    onYacht: !!yachtFieldNear(a.grid_x, a.grid_y),   // a VTOL set down alongside the Echelon → auto-land on her helipad
    cargo: a.custom_data?.cargoWeight || 0,     // current hold weight (drives the cockpit jettison bind)
    engines: live.type.engines || 1, seats: live.type.seats || 1, occupants: seatList(live),   // gauge count + cabin readout
    warn: a.fuel <= 0 ? 'STARVATION' : (a.fuel <= cap * BINGO_FRAC ? 'BINGO' : null),
    aa: live.aaThreat || null,                  // AA engagement-envelope telegraph (set by combat.tickCombat)
    hull: Math.max(0, Math.round((1 - (a.damage || 0)) * 100)),   // for the cockpit hull readout / battle damage
    surfaces: surfacesWire(a),                  // sheared structural surfaces (null when intact) → live breakup model + asymmetric physics
    msl: mslAmmo(live),                         // missiles left on the rails (ammo pips)
    checkride: live.checkride?.clientView || null,   // guided-checkride instruction toast + ring gates (null = not on a checkride)
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
    onGround: !a.airborne,   // rolling/taxiing on the deck → viewers pin its gear to the ground (z=0), not eye-level
    hullPct: Math.max(0, Math.round((1 - (a.damage || 0)) * 100)),
    surfaces: surfacesWire(a),   // sheared surfaces → spectators render the cripple too, not a pristine bogey
    reg: String(a.name || live.type?.name || '???').toUpperCase().slice(0, 8),
    cls: live.type?.class || 'prop',
    armed: (live.type?.hardpoints || 0) > 0,   // an armed heli renders the attack-heli mesh (stub wings, pods, chin gun)
    firing: (live.firingUntil || 0) > Date.now(),   // guns hot right now → viewers draw its tracers
  };
}

// A craft rolling under power on the ground — taxiing, on its takeoff roll, or on a landing
// rollout — is a moving contact other pilots should SEE, even though it isn't airborne yet.
// Gated on engine-on + actually moving so a parked, idling craft doesn't clutter the traffic
// picture. Position is the reconciled-authoritative one (same as every airborne contact), so
// this stays inside the client-sim + server-reconcile law — no server-side physics.
export const GROUND_CONTACT_MIN_KT = 5;
export function isGroundRolling(live) {
  return !!live && !live.row.airborne && !live.row.is_wreck
    && !!live.row.engine_on && (live.cont?.airspeed ?? 0) >= GROUND_CONTACT_MIN_KT;
}

// Airborne (or ground-rolling) craft near an arbitrary tile (the Echelon), as airContacts — so the
// Helm chase view can paint planes passing over the Basin with the SAME 3D models the flight sim
// draws out its canopy.
export function aircraftNearCoord(x, y, range = 26) {
  const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
  const out = [];
  for (const other of liveAircraft.values()) {
    if (other.row?.is_wreck) continue;
    const flying = other.row?.airborne && !other.cont?.onGround;
    if (!flying && !isGroundRolling(other)) continue;
    if (cheb(x, y, other.row.grid_x ?? 0, other.row.grid_y ?? 0) > range) continue;
    out.push(airContact(other));
  }
  return out;
}

export function closeHud(pid) { sendToPlayer(pid, { type: 'cockpit_close' }); }
export function out(pid, message) { sendToPlayer(pid, { type: 'output', message }); }
export function toOccupants(live, message) { for (const pid of live.occupants) out(pid, message); }

// ── Walkable aircraft cabins ──────────────────────────────────────────────────
// A craft type whose interior is authored as coordinate-free MUD rooms
// (content/zones/zone_<type>_*, map_aircraft_<type>) that occupants WALK on foot
// instead of riding the synthesized cabin-window HUD. Per-aircraft privacy comes
// free from the in-memory occupant Set (who you see is scoped to your aircraft), so
// two owners share the one authored shell with no runtime zone rows. Design +
// roadmap: docs/proposals/leviathan-flying-base.md.
export const WALKABLE_CABINS = new Set(['leviathan']);
export function cabinTypeOf(live) {
  const t = live?.type?.id?.replace(/^ac_/, '');
  return t && WALKABLE_CABINS.has(t) ? t : null;
}
export function isWalkableCabin(live) { return !!cabinTypeOf(live); }
// The room a boarder arrives in (mirrors the cabin map's entry_zone_id).
export function cabinEntryZone(live) {
  const t = cabinTypeOf(live);
  return t ? getZone(`zone_${t}_cabin`) : null;
}
// Is this zone an interior room of THIS live aircraft's cabin? All instances of a
// type share the one authored shell, so the aircraft_cabin flag (= the type) matches.
export function isCabinZone(zone, live) {
  const t = cabinTypeOf(live);
  return !!(t && zone?.flags?.aircraft_cabin === t);
}
// Render the player's current room to their client — the same `look` payload the
// move/look commands ship — so a boarding passenger drops straight into the cabin.
export async function lookPayload(player) {
  const zone = getZone(player.current_zone);
  if (!zone) return null;
  return { type: 'look', message: await describeZone(zone, player), zone: zone.id, minimap: getMinimapData(zone.id, 8, player) };
}
// Seat a boarder inside the walkable cabin: move them into the entry room on foot
// (no posture-freeze — they walk it) and hand back the room render. The move gate
// keeps world exits sealed while airborne; egress is via `disembark` (detach below).
export async function boardCabin(player, live) {
  const entry = cabinEntryZone(live);
  if (!entry) return null;
  const from = player.current_zone;
  if (from) removePlayerFromZone(player.id, from);
  player.current_zone = entry.id;
  addPlayerToZone(player.id, entry.id);
  setPosture(player, 'standing');
  emit('zone.entered', { actor: player, zone: entry.id, from });
  return await lookPayload(player);
}

// ── Attach / detach ───────────────────────────────────────────────────────────
export function detach(player, { restore = true } = {}) {
  const live = player.aircraftId ? liveAircraft.get(player.aircraftId) : null;
  // Walkable cabin: step the occupant out of the interior room onto the aircraft's
  // current ground (its parked ramp). Airborne egress is impossible — the move gate
  // seals it — so a detach from a cabin zone means we're parked. Non-walkable
  // occupants are never in a cabin zone, so this is a no-op for every other craft.
  if (live && isCabinZone(getZone(player.current_zone), live)) {
    removePlayerFromZone(player.id, player.current_zone);
    const ground = getZone(live.row.parked_zone_id);
    if (ground) { player.current_zone = ground.id; addPlayerToZone(player.id, ground.id); }
  }
  if (live) {
    live.occupants.delete(player.id);
    if (live.pilotId === player.id) live.pilotId = null;
  }
  if (player.posture === 'flying') forceStand(player, 'flight.detach');
  delete player.aircraftId;
  delete player.seat;
  delete player.cabinWindowOpen;
  if (restore) closeHud(player.id);
  if (live) reap(live);
}

// ── Structural surfaces (battle damage) ───────────────────────────────────────
// A craft's structural surfaces that combat fire can shear clean off. Binary
// intact(1)/sheared(0) per surface for now — the map shape leaves room for graduated
// 0..1 health later without a data migration. Lives on custom_data.surfaces so it
// rides the existing persist (no schema change). Absent/empty ⇒ everything intact
// (back-compat for every existing row). These four map onto the render roles
// (wing+aileron+flap per side, stab/elevator = tail, fin/rudder = rudder) and onto
// distinct flight-physics effects (asymmetric roll/yaw/lift, pitch/yaw authority).
export const SURFACE_KEYS = ['leftWing', 'rightWing', 'tail', 'rudder'];
// A surface can only shear once the hull is deep in the red — early hits stay ordinary
// attrition; catastrophic loss is a late-fight drama beat, not a lucky one-shot.
export const SHEAR_HULL_THRESHOLD = 0.7;   // hull < 30%
const SHEAR_WEIGHTS = [['leftWing', 3], ['rightWing', 3], ['tail', 2], ['rudder', 1]];

// The surfaces map for the wire/render — but ONLY when something's actually gone, so
// an intact craft sends nothing and the client's "any surfaces present ⇒ cripple" test
// stays trivial. Returns null when nothing is sheared.
export function surfacesWire(a) {
  const s = a.custom_data?.surfaces;
  if (!s || typeof s !== 'object') return null;
  if (!SURFACE_KEYS.some(k => s[k] === 0)) return null;
  const out = {}; for (const k of SURFACE_KEYS) out[k] = s[k] === 0 ? 0 : 1;
  return out;
}
export function anyWingLost(a) {
  const s = a.custom_data?.surfaces;
  return !!s && (s.leftWing === 0 || s.rightWing === 0);
}
// Clear all battle damage to surfaces — called from the repair/rebuild paths alongside
// damage=0 (a field DIY patch can't reattach a wing, but a full hangar job can).
export function resetSurfaces(a) {
  if (a.custom_data?.surfaces) delete a.custom_data.surfaces;
}
// Roll whether this hit shears a structural surface. Gated on the hull threshold, then a
// crit whose odds scale with the bite of the hit (a graze rarely tears metal off; a solid
// cannon burst or a missile often does). Mutates a.custom_data.surfaces and returns the
// sheared surface key (for feedback) or null. Wings are likelier to go than the tail feathers.
export function shearRoll(a, amount) {
  if ((a.damage || 0) < SHEAR_HULL_THRESHOLD) return null;
  if (Math.random() >= Math.min(0.8, 0.2 + amount * 1.8)) return null;
  const cd = a.custom_data || (a.custom_data = {});
  const surf = cd.surfaces || (cd.surfaces = {});
  const intact = SHEAR_WEIGHTS.filter(([k]) => surf[k] !== 0);
  if (!intact.length) return null;   // nothing left to lose
  const total = intact.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total, pick = intact[0][0];
  for (const [k, w] of intact) { if ((r -= w) <= 0) { pick = k; break; } }
  surf[pick] = 0;
  return pick;
}

// ── Difficulty helpers (piloting checks + minigame board tuning) ──────────────
// A lost structural surface piles onto the piloting-check difficulty on top of the raw
// hull penalty — a one-winged bird is a nightmare to set down.
function surfacePenalty(a) {
  const s = a.custom_data?.surfaces; if (!s) return 0;
  return SURFACE_KEYS.reduce((n, k) => n + (s[k] === 0 ? 3 : 0), 0);
}
export function takeoffDifficulty(live) {
  return Math.round(4 + effStats(live).handling + (live.row.damage || 0) * 6 + surfacePenalty(live.row));
}
export function landDifficulty(live, emergency) {
  return Math.round(5 + effStats(live).handling + (live.row.damage || 0) * 6 + surfacePenalty(live.row) + (emergency ? 4 : 0));
}

// ── Bring a craft to rest at an airfield; restore occupants to the ground ──────
export async function parkAt(live, zoneId) {
  const z = getZone(zoneId);
  if (z) {
    live.row.grid_x = z.grid_x; live.row.grid_y = z.grid_y; live.fx = z.grid_x; live.fy = z.grid_y;
    // Face the craft down the runway it landed on, so it sits aligned with the strip
    // (and its next departure lines up with the real centreline tiles).
    const rw = runwayFor(z);
    if (rw) live.row.heading = String(rw.hdg);
  }
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
  live.msl = null;             // rearm the rails at the ramp
  live.lockTargetId = null;    // a parked craft holds no seeker lock
  live.inboundMsl = null;      // anything chasing it lost the plot on touchdown
  live.flaredUntil = 0;
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
    const from = p.current_zone;
    p.current_zone = occZone;
    getZone(occZone)?.players.add(pid);
    closeHud(pid);
    out(pid, occZone === zoneId
      ? `<span class="text-dim">You are down at ${z?.name || 'the field'}.</span>`
      : `<span class="text-dim">You taxi into the hangar at ${z?.name || 'the field'}, cut the engine, and climb out.</span>`);
    // Setting foot on the ground is an arrival — fire the event so zone.entered
    // consumers (first-visit lore, and the Echelon's board check that smites an
    // uninvited pilot who set down on the yacht) run for a fly-in exactly as they
    // do for someone who walked in.
    emit('zone.entered', { actor: p, zone: occZone, from });
  }
  await persist(live);
}

// Relocate every craft PARKED on a moving field (the Echelon) to the field's new tile, so a
// helicopter left on her helipad sails with her — its next takeoff lifts off from where she is
// now, not the open water she left. parkAt froze the craft's grid at landing time; this re-anchors
// it whenever the field commits to a new position. Updates loaded rows AND the DB (a reaped craft
// exists only as a row until someone re-boards it). Airborne craft carry a null parked_zone_id, so
// the `parked_zone_id` filter already excludes anything in flight. Called by the yacht plugin from
// arriveEchelon; flight owns the aircraft table, so the write lives here.
export async function moveParkedAircraftTo(zoneId, x, y) {
  for (const live of liveAircraft.values()) {
    if (live.row.parked_zone_id === zoneId) { live.row.grid_x = x; live.row.grid_y = y; live.fx = x; live.fy = y; }
  }
  await query('UPDATE aircraft SET grid_x=$1, grid_y=$2 WHERE parked_zone_id=$3 AND airborne=0', [x, y, zoneId]);
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
  // Stamp when it went down so the flight plugin's wreck-maintenance sweep can age it
  // out (players get a salvage window first; see wreckSweep in index.js).
  live.row.custom_data = { ...(live.row.custom_data || {}), crashed_at: Date.now() };
  live.hazard = null;
  live.aaThreat = null;
  live.aaWarned = false;
  await persist(live);
  const downedBy = byPlayer ? ` — ${byPlayer.handle} splashes it` : '';
  sendToZone(wreckZone, { type: 'zone_event', message: `<span class="text-red">A ${live.type.name} screams down out of the sky and craters into the ground in a fireball${downedBy}.</span>`, refresh: true });
  // Collateral: what the wreck does to the tile it hits (bystanders, damage bill, crimes).
  // Charge the responsible pilot BEFORE the death loop detaches them; the wanted persists.
  const pilot = [...live.occupants].map(getLivePlayer).find(p => p && p.seat === 'pilot') || null;
  // Capture "was the pilot fit to fly?" now, while their impairment state is intact.
  const impaired = isSeverelyImpaired(pilot);
  if (pilot) pilot.current_zone = wreckZone;
  // Never let collateral (NPC kills / crime charges) break the core crash path.
  let liabilityBill = 0, casualties = 0;
  try { ({ bill: liabilityBill, casualties } = await applyCrashCollateral(live, surface, pilot)); }
  catch (e) { console.error(`[flight] crash collateral error: ${e.message}`); }
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
  if (byPlayer) {
    out(byPlayer.id, `<span class="text-green">★ SPLASH ONE — you shot down the ${live.type.name}.</span>`);
    sendToPlayer(byPlayer.id, { type: 'flight_kill', name: live.type.name });   // big top-of-glass kill banner
  }
  // Notify listeners (Halcyon Assurance files a claim if the craft was insured). Past-tense,
  // fire-and-forget — insurance reads the wreck row it just persisted above.
  emit('flight.crashed', {
    aircraftId: live.row.id, ownerId: live.row.owner_id, typeId: live.type.id,
    typeName: live.type.name, reason, wreckZone, rental: !!live.row.rental,
    // Fault context for insurers: combat = shot down (not your fault); restricted =
    // the loss happened in illegal/no-fly airspace (voids cover).
    combat: !!byPlayer, restricted: !!surface?.flags?.airspace_restricted, impaired,
    // Third-party damage the pilot is liable for (covered by liability insurance, else owed).
    pilotId: pilot?.id || null, liabilityBill, casualties,
  });
  liveAircraft.delete(live.row.id);
}

// Accepts a cardinal ('nw'), a compass degree (247 or '247'), or a legacy string;
// always stores a normalised degree string on the row.
export function setHeading(live, dirOrDeg) { live.row.heading = String(toDeg(dirOrDeg)); }
export { syncEngineTemp };

// Convenience re-exports so submodules import world/zone helpers from one place.
export { getZone, getLivePlayer, sendToZone, sendToZoneExcept, sendToPlayer, setPosture, forceStand };
