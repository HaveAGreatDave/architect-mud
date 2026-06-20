// server/engine/environment.js
//
// Unified Environmental Simulation — Time, Weather, Power, Lighting, Visibility
//
// INTEGRATION (do once, in server bootstrap — e.g. server/index.js):
//
//   import { initEnvironment } from './engine/environment.js';
//   import { query } from './models/db.js';
//   import { emit as emitHook } from './engine/plugins.js'; // adjust to your actual plugin emitter export
//   import { broadcastAll } from './index.js';               // adjust to your actual WS broadcast helper
//
//   await initEnvironment({ query, emitHook, broadcast: broadcastAll });
//
// Run the matching migration once before first boot — call this from inside
// the existing migrate() in server/models/migrate.js:
//
//   import { migrateEnvironment } from './migrate.environment.js';
//   await migrateEnvironment(query);
//
// Mount the dev-panel/API routes — see server/api/environment.routes.js for
// the matching dispatcher and its own integration comment.
//
// Nothing in this file touches Postgres on a per-player basis. Reads
// (visibility, HUD, power map) are served from the in-memory `state` object;
// Postgres is only written on the two scheduled ticks plus dev-tool calls,
// matching the GDD's two-interval design (30-minute environmental tick,
// 24-hour world tick).

import { schedule } from './scheduler.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Used only for boot catch-up logic (have we missed a tick since last restart?).
// The actual intervals are now managed by scheduler.js.
const TICK_30M_MS = 30 * 60 * 1000;
const TICK_24H_MS = 24 * 60 * 60 * 1000;

const WEATHER_TYPES = ['sunny', 'cloudy', 'rain', 'fog', 'storm', 'snow'];

const WEATHER_ICON = {
  sunny: '☀', cloudy: '☁', rain: '☂', fog: '▒', storm: '⚡', snow: '❄',
};

const WEATHER_VISIBILITY_FACTOR = {
  sunny: 1.0, cloudy: 0.9, rain: 0.7, fog: 0.55, storm: 0.5, snow: 0.75,
};

// Fog is both a weather TYPE and an independent multiplicative term in the
// GDD's visibility formula (section 7). "fog" weather sets a strong fog
// factor; every other weather type defaults to 1.0 (no extra penalty), which
// leaves the term available for a future patchy-fog event without
// double-penalizing visibility today.
const FOG_FACTOR = { fog: 0.4 };
const DEFAULT_FOG_FACTOR = 1.0;

const SEASON_BY_MONTH = [
  'winter', 'winter', 'spring', 'spring', 'spring', 'summer',
  'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter',
];


const POWER_OVERLOAD_RATIO = 1.0;    // load/capacity above this → 'overloaded'
const POWER_BLACKOUT_RATIO = 1.25;   // load/capacity above this → 'offline'
const EMERGENCY_LIGHT_LEVEL = 0.3;   // artificial-light contribution on emergency power only
const SNOW_LOAD_MULTIPLIER = 1.15;   // snow increases effective load (GDD §11: heating demand)
const STORM_GENERATOR_FAULT_CHANCE = 0.10; // per 24h tick, per non-building generator

const VISIBILITY_CLEAR = 0.6;
const VISIBILITY_DIM = 0.35;

// ---------------------------------------------------------------------------
// In-memory state — source of truth between ticks, persisted to Postgres so
// it survives restarts. Mirrors the world.js in-memory-cache-over-Postgres
// pattern already used elsewhere in this codebase.
// ---------------------------------------------------------------------------

const state = {
  ready: false,
  frozen: false,
  date: null,              // 'YYYY-MM-DD'
  minutes: 8 * 60,          // minutes since midnight, server-authoritative
  dayOfWeek: 1,             // 1=Mon..7=Sun
  season: 'spring',
  tempC: 12,
  weatherType: 'sunny',
  forecast: [],             // 7 entries: { forecastDay, date, weatherType, tempC, locked }
  ambientLight: 1.0,        // 0..1, recalculated every 30-min tick
  phase: 'day',
  zones: new Map(),         // zoneId -> { powerStatus, capacityKw, loadKw, hasEmergencyLighting, artificialLight }
  lastTick30m: 0,
  lastTick24h: 0,
};

let deps = { query: null, emitHook: null, broadcast: null };
let ticksScheduled = false;

// Deterministic weather generation (seedFromString, mulberry32, generateWeatherForDate)
// has moved to plugins/weather/index.js.

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// node-postgres parses DATE columns into JS Date objects on read (it only
// accepts strings going IN). pg builds that Date from UTC components, so
// toISOString().slice(0,10) round-trips correctly regardless of server TZ.
function toDateString(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function dayOfWeekFor(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const jsDay = d.getUTCDay(); // 0=Sun..6=Sat
  return jsDay === 0 ? 7 : jsDay; // 1=Mon..7=Sun
}

// ---------------------------------------------------------------------------
// Time / phase helpers
// ---------------------------------------------------------------------------

const DAY_PHASES = [
  { name: 'dawn', startMin: 5 * 60, endMin: 7 * 60, icon: '🌅' },
  { name: 'day', startMin: 7 * 60, endMin: 17 * 60, icon: '☀' },
  { name: 'dusk', startMin: 17 * 60, endMin: 20 * 60, icon: '🌇' },
  { name: 'night', startMin: 20 * 60, endMin: 5 * 60, icon: '🌙' }, // wraps midnight
];

function phaseForMinutes(minutesOfDay) {
  const m = minutesOfDay;
  if (m >= 5 * 60 && m < 7 * 60) return DAY_PHASES[0];
  if (m >= 7 * 60 && m < 17 * 60) return DAY_PHASES[1];
  if (m >= 17 * 60 && m < 20 * 60) return DAY_PHASES[2];
  return DAY_PHASES[3];
}

function clamp01(n) { return Math.max(0, Math.min(1, n)); }

function ambientLightForMinutes(minutesOfDay) {
  const phase = phaseForMinutes(minutesOfDay);
  if (phase.name === 'day') return 1.0;
  if (phase.name === 'night') return 0.0;
  if (phase.name === 'dawn') {
    const t = (minutesOfDay - phase.startMin) / (phase.endMin - phase.startMin);
    return clamp01(t);
  }
  // dusk
  const t = (minutesOfDay - phase.startMin) / (phase.endMin - phase.startMin);
  return clamp01(1 - t);
}

function formatHHMM(minutesOfDay) {
  const h = Math.floor(minutesOfDay / 60) % 24;
  const m = minutesOfDay % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function logError(err) {
  // eslint-disable-next-line no-console
  console.error('[environment]', err);
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

export async function initEnvironment({ query, emitHook, broadcast }) {
  deps = { query, emitHook, broadcast };

  const clockRow = await ensureClockRow(query);
  state.date = toDateString(clockRow.game_date);
  state.minutes = clockRow.game_time_minutes;
  state.dayOfWeek = clockRow.day_of_week;
  state.season = clockRow.season;
  state.lastTick30m = new Date(clockRow.last_tick_30m).getTime();
  state.lastTick24h = new Date(clockRow.last_tick_24h).getTime();

  // Weather plugin initializes the forecast via this hook. Must run before
  // loadZonePowerAndLighting + recalcAmbientAndVisibility so state.weatherType
  // is populated when those functions read it.
  if (emitHook) await emitHook('environment.init', { setWeatherState });

  await loadZonePowerAndLighting(query);
  recalcAmbientAndVisibility();

  // Catch up on missed ticks after downtime, at most once each, then resume
  // the normal interval from "now" — avoids a restart firing a storm of
  // redundant ticks while still keeping the world from going stale.
  const now = Date.now();
  if (now - state.lastTick24h >= TICK_24H_MS) await tick24h();
  if (now - state.lastTick30m >= TICK_30M_MS) await tick30m();

  scheduleTicks();
  state.ready = true;

  // Sync streetlights to the current phase on boot — otherwise a server
  // restart at night would leave them off until the next dusk transition.
  const bootLightsOn = (state.phase === 'night' || state.phase === 'dusk') ? 1 : 0;
  await query(`UPDATE furniture SET light_on=$1 WHERE light_type='streetlight'`, [bootLightsOn]).catch(()=>{});
}

function scheduleTicks() {
  if (ticksScheduled) return; // schedule() is append-only; guard against double-init
  ticksScheduled = true;
  schedule('30m', () => { if (!state.frozen) tick30m().catch(logError); });
  schedule('24h', () => { if (!state.frozen) tick24h().catch(logError); });
}

async function ensureClockRow(query) {
  const today = new Date().toISOString().slice(0, 10);
  await query(
    `INSERT INTO world_clock (id, game_date, game_time_minutes, day_of_week, season)
     VALUES (1, $1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [today, 8 * 60, dayOfWeekFor(today), seasonForDate(today)]
  );
  const { rows } = await query('SELECT * FROM world_clock WHERE id = 1');
  return rows[0];
}

// loadForecast and regenerateFullForecast have moved to plugins/weather/index.js.
// Forecast state (state.weatherType, state.tempC, state.forecast) is still
// stored here and set via setWeatherState() — exported below.

async function loadZonePowerAndLighting(query) {
  const { rows: zones } = await query('SELECT * FROM power_zones');
  const { rows: lights } = await query('SELECT * FROM lighting_states');
  const lightByZone = new Map(lights.map((l) => [l.zone_id, l]));
  state.zones.clear();
  for (const z of zones) {
    const light = lightByZone.get(z.id);
    state.zones.set(z.id, {
      powerStatus: z.status,
      capacityKw: z.capacity_kw,
      loadKw: z.current_load_kw,
      hasEmergencyLighting: light ? !!light.has_emergency_lighting : false,
      artificialLight: computeArtificialLight(z.status, light),
    });
  }
}

function computeArtificialLight(powerStatus, light) {
  if (powerStatus === 'powered') {
    const fixtureBonus = light ? Math.min(1, (light.fixture_count || 1) / 4) : 1;
    return clamp01(0.3 + 0.7 * fixtureBonus);
  }
  if (powerStatus === 'overloaded') return 0.6;
  // offline
  return light && light.has_emergency_lighting ? EMERGENCY_LIGHT_LEVEL : 0.0;
}

// ---------------------------------------------------------------------------
// 30-Minute Environmental Tick
// World time → ambient light → visibility baseline → client clock sync
// ---------------------------------------------------------------------------

async function tick30m() {
  const { query, emitHook, broadcast } = deps;

  state.minutes = (state.minutes + 30) % (24 * 60);
  state.lastTick30m = Date.now();

  const prevPhase = state.phase;
  recalcAmbientAndVisibility();

  await query(
    `UPDATE world_clock SET game_time_minutes = $1, last_tick_30m = now() WHERE id = 1`,
    [state.minutes]
  );

  // Street lights are city-grid infrastructure, not player-switchable —
  // they follow the day/night cycle directly rather than a room switch.
  if (prevPhase !== state.phase) {
    if (state.phase === 'night' && prevPhase === 'dusk') {
      await query(`UPDATE furniture SET light_on=1 WHERE light_type='streetlight'`).catch(()=>{});
    }
    if (state.phase === 'day' && prevPhase === 'dawn') {
      await query(`UPDATE furniture SET light_on=0 WHERE light_type='streetlight'`).catch(()=>{});
    }
  }

  const payload = getHUDPayload();
  if (broadcast) broadcast({ type: 'environment.sync', ...payload });

  if (emitHook) {
    await emitHook('environment.tick30m', payload);
    if (prevPhase !== state.phase) {
      if (state.phase === 'day' && prevPhase === 'dawn') await emitHook('environment.sunrise', payload);
      if (state.phase === 'night' && prevPhase === 'dusk') await emitHook('environment.sunset', payload);
    }
  }
}

function recalcAmbientAndVisibility() {
  state.ambientLight = ambientLightForMinutes(state.minutes);
  state.phase = phaseForMinutes(state.minutes).name;
  // Per-zone visibility is computed on demand via getZoneVisibility(); only
  // the ambient baseline is refreshed here, per GDD §7: "Ambient light is
  // recalculated every 30-minute environmental tick."
}

// ---------------------------------------------------------------------------
// 24-Hour World Tick
// Calendar → forecast → weather/temp model → power simulation → lighting
// ---------------------------------------------------------------------------

async function tick24h() {
  const { query, emitHook, broadcast } = deps;

  state.date = addDays(state.date, 1);
  state.dayOfWeek = dayOfWeekFor(state.date);
  state.season = seasonForDate(state.date);
  state.lastTick24h = Date.now();

  await query(
    `UPDATE world_clock SET game_date = $1, day_of_week = $2, season = $3, last_tick_24h = now() WHERE id = 1`,
    [state.date, state.dayOfWeek, state.season]
  );

  // Weather plugin advances the forecast and updates state.weatherType/tempC
  // via setWeatherState() BEFORE simulatePowerNetwork reads weatherType for
  // snow-load calculations.
  if (emitHook) await emitHook('environment.advanceWeather', { setWeatherState, currentForecast: state.forecast, currentDate: state.date });
  await simulatePowerNetwork(query, { weatherType: state.weatherType });
  await loadZonePowerAndLighting(query);
  recalcAmbientAndVisibility();

  const payload = { ...getHUDPayload(), forecast: state.forecast };
  if (broadcast) broadcast({ type: 'environment.daily', ...payload });
  if (emitHook) {
    await emitHook('environment.tick24h', payload);
    await emitHook('environment.weatherChange', { weatherType: state.weatherType, tempC: state.tempC });
  }
}

// advanceForecast has moved to plugins/weather/index.js (environment.advanceWeather hook).

// ---------------------------------------------------------------------------
// Power Network Simulation
// ---------------------------------------------------------------------------

async function simulatePowerNetwork(query, { weatherType }) {
  const { rows: generators } = await query('SELECT * FROM generators');
  const { rows: zones } = await query('SELECT * FROM power_zones');

  const loadMultiplier = weatherType === 'snow' ? SNOW_LOAD_MULTIPLIER : 1.0;

  for (const gen of generators) {
    let status = gen.status === 'flickering' ? 'online' : gen.status; // flicker is transient, clears each tick unless re-triggered
    let fuelRemaining = gen.fuel_remaining;

    // Only player/portable generators consume fuel — building and
    // city-plant generators are infinite by design (GDD §5.2).
    if (gen.generator_type === 'player' && gen.fuel_type) {
      fuelRemaining = Math.max(0, fuelRemaining - gen.fuel_burn_rate * 30);
      if (fuelRemaining <= 0) status = 'offline';
    }

    // Storms can transiently fault non-building generators (GDD §11).
    if (weatherType === 'storm' && gen.generator_type !== 'building' && status !== 'offline') {
      if (Math.random() < STORM_GENERATOR_FAULT_CHANCE) status = 'flickering';
    }

    await query(`UPDATE generators SET status = $1, fuel_remaining = $2 WHERE id = $3`, [status, fuelRemaining, gen.id]);
  }

  const genById = new Map(generators.map((g) => [g.id, g]));
  for (const zone of zones) {
    const gen = genById.get(zone.generator_id);
    const capacity = gen ? gen.capacity_kw : zone.capacity_kw;
    const load = zone.current_load_kw * loadMultiplier;
    const ratio = capacity > 0 ? load / capacity : Infinity;

    let status;
    if (gen && gen.status === 'offline') status = 'offline';
    else if (ratio > POWER_BLACKOUT_RATIO) status = 'offline';
    else if (ratio > POWER_OVERLOAD_RATIO) status = 'overloaded';
    else status = 'powered';

    await query(`UPDATE power_zones SET status = $1 WHERE id = $2`, [status, zone.id]);
  }
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

/**
 * Visibility = max(ambient, artificial) × weather × fog
 *
 * GDD §7 diagrams this as a straight product (Ambient × Artificial × Weather
 * × Fog). Taken literally, that zeroes out daytime visibility in any zone
 * with its lights off (artificial = 0) — clearly not the intent. Light
 * sources are combined with max() instead — the brighter of sun-or-bulb
 * wins — and weather/fog then act as a shared multiplicative dampener on top
 * of whatever light is present. This preserves every documented interaction
 * (storms/fog/snow reduce visibility; no power + night = true darkness;
 * daylight is unaffected by indoor light switches) without the degenerate
 * zero case the literal formula produces.
 */
export function getZoneVisibility(zoneId) {
  const zone = state.zones.get(zoneId);
  const artificial = zone ? zone.artificialLight : 0;
  const effectiveLight = Math.max(state.ambientLight, artificial);
  const weatherFactor = WEATHER_VISIBILITY_FACTOR[state.weatherType] ?? 1.0;
  const fogFactor = FOG_FACTOR[state.weatherType] ?? DEFAULT_FOG_FACTOR;
  const visibility = clamp01(effectiveLight * weatherFactor * fogFactor);

  let category = 'clear';
  if (visibility < VISIBILITY_DIM) category = 'dark';
  else if (visibility < VISIBILITY_CLEAR) category = 'dim';

  return { visibility, category, ambientLight: state.ambientLight, artificialLight: artificial };
}

// GDD §7.2 feedback lines, for room-description injection on a visibility
// category change (wire into commands.js room rendering / zone.describeAmbient).
export function describeVisibilityTransition(prevCategory, nextCategory) {
  if (prevCategory !== 'dark' && nextCategory === 'dark') {
    return 'It is becoming difficult to make out more than shadows.';
  }
  if (prevCategory === 'dark' && nextCategory !== 'dark') {
    return 'Light returns, revealing your surroundings once again.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// HUD / Forecast / Power accessors
// ---------------------------------------------------------------------------

export function getHUDPayload() {
  const phase = phaseForMinutes(state.minutes);
  return {
    date: state.date,
    time: formatHHMM(state.minutes),
    dayOfWeek: state.dayOfWeek,
    season: state.season,
    weatherType: state.weatherType,
    weatherIcon: WEATHER_ICON[state.weatherType],
    tempC: state.tempC,
    tempF: Math.round((state.tempC * 9) / 5 + 32),
    timePhase: phase.name,
    timeIcon: phase.icon,
    frozen: state.frozen,
  };
}

export function getForecast() {
  return state.forecast.map((f) => ({ ...f, icon: WEATHER_ICON[f.weatherType] }));
}

// Setter used by the weather plugin to update in-memory weather state.
// Keep weather logic in the plugin; keep state here where the rest of the
// engine can read it without importing the plugin.
export function setWeatherState(weatherType, tempC, forecast) {
  if (weatherType !== undefined) state.weatherType = weatherType;
  if (tempC !== undefined) state.tempC = tempC;
  if (forecast !== undefined) state.forecast = forecast;
}

export function getPowerMap() {
  return [...state.zones.entries()].map(([zoneId, z]) => ({
    zoneId,
    status: z.powerStatus,
    capacityKw: z.capacityKw,
    loadKw: z.loadKw,
    artificialLight: z.artificialLight,
  }));
}

export function getEnvironmentState() {
  return { ...getHUDPayload(), ambientLight: state.ambientLight, forecast: getForecast(), powerMap: getPowerMap() };
}

// ---------------------------------------------------------------------------
// Dev Tools (called from server/api/environment.routes.js)
// ---------------------------------------------------------------------------

export async function devSetTime({ date, minutes }) {
  const { query } = deps;
  if (date) state.date = date;
  if (minutes !== undefined) state.minutes = ((Number(minutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  state.dayOfWeek = dayOfWeekFor(state.date);
  recalcAmbientAndVisibility();
  await query(
    `UPDATE world_clock SET game_date = $1, game_time_minutes = $2, day_of_week = $3 WHERE id = 1`,
    [state.date, state.minutes, state.dayOfWeek]
  );
  return getHUDPayload();
}

export async function devAdvanceTime(minutesToAdd) {
  return devSetTime({ minutes: state.minutes + Number(minutesToAdd || 0) });
}

export function devFreeze(frozen) {
  state.frozen = !!frozen;
  return { frozen: state.frozen };
}

export async function devForceTick30() { await tick30m(); return getHUDPayload(); }
export async function devForceTick24() { await tick24h(); return { ...getHUDPayload(), forecast: state.forecast }; }

export async function devOverrideWeather({ weatherType, tempC }) {
  const { query, broadcast } = deps;
  if (!WEATHER_TYPES.includes(weatherType)) throw new Error(`Unknown weather type: ${weatherType}`);
  state.weatherType = weatherType;
  if (tempC !== undefined) state.tempC = Number(tempC);
  await query(`UPDATE weather_forecast SET weather_type = $1, temp_c = $2 WHERE forecast_day = 0`, [weatherType, state.tempC]);
  state.forecast[0] = { ...state.forecast[0], weatherType, tempC: state.tempC };
  if (broadcast) broadcast({ type: 'environment.weatherOverride', ...getHUDPayload() });
  return getHUDPayload();
}

export async function devLockForecastDay(forecastDay, locked) {
  const { query } = deps;
  await query(`UPDATE weather_forecast SET locked = $1 WHERE forecast_day = $2`, [locked ? 1 : 0, forecastDay]);
  if (state.forecast[forecastDay]) state.forecast[forecastDay].locked = !!locked;
  return getForecast();
}

export async function devTriggerStorm() { return devOverrideWeather({ weatherType: 'storm' }); }
export async function devTriggerSnow() { return devOverrideWeather({ weatherType: 'snow' }); }

export async function devSpawnGenerator({ id, zoneId, generatorType, capacityKw, fuelType, fuelRemaining, fuelBurnRate, connectionRange }) {
  const { query } = deps;
  await query(
    `INSERT INTO generators (id, zone_id, generator_type, capacity_kw, fuel_type, fuel_remaining, fuel_burn_rate, connection_range, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'online')
     ON CONFLICT (id) DO UPDATE SET zone_id = $2, generator_type = $3, capacity_kw = $4,
       fuel_type = $5, fuel_remaining = $6, fuel_burn_rate = $7, connection_range = $8`,
    [id, zoneId ?? null, generatorType ?? 'player', Number(capacityKw) || 0, fuelType ?? null, Number(fuelRemaining) || 0, Number(fuelBurnRate) || 0, Number(connectionRange) || 0]
  );
  return { ok: true, id };
}

export async function devModifyLoad(zoneId, loadKw) {
  const { query } = deps;
  await query(`UPDATE power_zones SET current_load_kw = $1 WHERE id = $2`, [Number(loadKw) || 0, zoneId]);
  await simulatePowerNetwork(query, { weatherType: state.weatherType });
  await loadZonePowerAndLighting(query);
  return getPowerMap();
}

export async function devSimulateFailure(generatorId) {
  const { query } = deps;
  await query(`UPDATE generators SET status = 'offline' WHERE id = $1`, [generatorId]);
  await simulatePowerNetwork(query, { weatherType: state.weatherType });
  await loadZonePowerAndLighting(query);
  return getPowerMap();
}

// ---------------------------------------------------------------------------
// Generator install/remove — dev panel feature. A 'building' generator
// auto-connects to every zone in the same building cluster (the install
// zone plus anything reachable through is_apartment/is_interior exit
// linkage, transitively — the same notion of "building" the Rooms: list
// and dev panel nesting already use). A 'city_plant' generator connects to
// every outdoor zone on the map (every zone that ISN'T is_apartment/
// is_interior) — this is what powers street lights and outdoor equipment.
// ---------------------------------------------------------------------------

async function getBuildingNetwork(query, startZoneId) {
  const { rows: allZones } = await query('SELECT id, exits, flags FROM zones');
  const byId = new Map(allZones.map(z => [z.id, z]));
  const isInterior = z => !!(z?.flags?.is_apartment || z?.flags?.is_interior);
  const visited = new Set([startZoneId]);
  const queue = [startZoneId];
  while (queue.length) {
    const id = queue.shift();
    const zone = byId.get(id);
    if (!zone) continue;
    const neighbors = new Set(Object.values(zone.exits || {}));
    for (const other of allZones) {
      if (Object.values(other.exits || {}).includes(id)) neighbors.add(other.id);
    }
    for (const nId of neighbors) {
      if (visited.has(nId)) continue;
      const neighbor = byId.get(nId);
      if (isInterior(neighbor) || isInterior(zone)) {
        visited.add(nId);
        queue.push(nId);
      }
    }
  }
  return [...visited];
}

export async function installGenerator({ zoneId, generatorType = 'building', capacityKw, name }) {
  const { query } = deps;
  if (!zoneId) throw new Error('zoneId is required');
  const { rows: zoneRows } = await query('SELECT * FROM zones WHERE id=$1', [zoneId]);
  if (!zoneRows.length) throw new Error(`Zone ${zoneId} does not exist`);
  const zone = zoneRows[0];

  const id = `gen_${zoneId}_${Date.now()}`;
  const capacity = Number(capacityKw) || (generatorType === 'city_plant' ? 500 : 50);
  const genName = name || (generatorType === 'city_plant' ? 'City Power Plant' : `${zone.name} Generator`);

  // Permanent generators — building and city-plant types never consume
  // fuel (GDD §5.2), so this row never goes offline from running dry.
  await query(
    `INSERT INTO generators (id, zone_id, name, generator_type, capacity_kw, fuel_type, fuel_remaining, fuel_burn_rate, connection_range, status)
     VALUES ($1,$2,$3,$4,$5,NULL,0,0,0,'online')`,
    [id, zoneId, genName, generatorType, capacity]
  );

  const networkZoneIds = generatorType === 'city_plant'
    ? (await query(`SELECT id FROM zones WHERE NOT COALESCE((flags->>'is_apartment')::boolean,false) AND NOT COALESCE((flags->>'is_interior')::boolean,false)`)).rows.map(r => r.id)
    : await getBuildingNetwork(query, zoneId);

  for (const zid of networkZoneIds) {
    const { rows: zRows } = await query('SELECT name FROM zones WHERE id=$1', [zid]);
    const zName = zRows[0]?.name || zid;
    await query(
      `INSERT INTO power_zones (id, name, source_type, generator_id, capacity_kw, current_load_kw, status)
       VALUES ($1,$2,$3,$4,$5,0,'powered')
       ON CONFLICT (id) DO UPDATE SET name=$2, source_type=$3, generator_id=$4, capacity_kw=$5`,
      [zid, zName, generatorType === 'city_plant' ? 'city_grid' : 'building_generator', id, capacity]
    );
    const { rows: fixtureRows } = await query(`SELECT COUNT(*)::int AS cnt FROM furniture WHERE zone_id=$1 AND is_light=1`, [zid]);
    await query(
      `INSERT INTO lighting_states (zone_id, has_emergency_lighting, artificial_light_level, fixture_count)
       VALUES ($1,0,0,$2)
       ON CONFLICT (zone_id) DO UPDATE SET fixture_count=$2`,
      [zid, fixtureRows[0]?.cnt || 0]
    );
  }

  await recomputePower();
  return { id, zoneId, name: genName, generatorType, capacityKw: capacity, poweredZones: networkZoneIds };
}

export async function removeGenerator(generatorId) {
  const { query } = deps;
  const { rows } = await query('SELECT * FROM generators WHERE id=$1', [generatorId]);
  if (!rows.length) throw new Error('Generator not found');
  await query('DELETE FROM power_zones WHERE generator_id=$1', [generatorId]);
  await query('DELETE FROM generators WHERE id=$1', [generatorId]);
  await recomputePower();
  return { ok: true };
}

export async function getGeneratorsList() {
  const { query } = deps;
  const { rows } = await query(`
    SELECT g.*, z.name as zone_name
    FROM generators g LEFT JOIN zones z ON z.id = g.zone_id
    ORDER BY g.generator_type, g.id
  `);
  return rows;
}

// Re-runs the power simulation immediately (instead of waiting for the next
// 24h tick) — used after install/remove so the dev panel's power map and
// any live "look at generator" reflect the change right away.
export async function recomputePower() {
  const { query } = deps;
  await simulatePowerNetwork(query, { weatherType: state.weatherType });
  await loadZonePowerAndLighting(query);
  return getPowerMap();
}

// Used by commands.js (light switches, generator examine) to check whether
// a zone currently has any power at all before allowing an indoor light to
// be switched on.
export function getZonePowerStatus(zoneId) {
  const z = state.zones.get(zoneId);
  return z ? z.powerStatus : 'unpowered';
}

// ---------------------------------------------------------------------------
// Plugin hook names this module emits — register these in your plugin
// loader's known-hooks list alongside tick.minute / player.enterZone / etc.
// ---------------------------------------------------------------------------

export const ENVIRONMENT_HOOKS = [
  'environment.tick30m',
  'environment.tick24h',
  'environment.weatherChange',
  'environment.sunrise',
  'environment.sunset',
];
