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
// Boot catch-up ceiling: replay at most this many missed days after a long
// outage so a very stale clock can't stall startup with day-by-day sims.
const MAX_CATCHUP_DAYS = 30;

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
  windows: [],              // all window rows from DB, refreshed on init and mutation
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

function seasonForDate(dateStr) {
  const month = Number(dateStr.slice(5, 7)) - 1;
  return SEASON_BY_MONTH[month];
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
  await loadWindows(query);
  recalcAmbientAndVisibility();

  // Catch up on time missed during downtime. Game time runs 1:1 with real time,
  // so advance by the FULL elapsed interval — not a single tick. (The old
  // once-each version under-counted: a 3-hour outage only added 30 minutes,
  // leaving the world clock permanently behind after every cold start.)
  const now = Date.now();

  // Whole missed days: replay one tick24h per day so the weather plugin's
  // rolling forecast and the power sim advance day-by-day. Capped for sanity.
  const missed24h = Math.floor((now - state.lastTick24h) / TICK_24H_MS);
  if (missed24h > 0) {
    for (let i = 0; i < Math.min(missed24h, MAX_CATCHUP_DAYS); i++) await tick24h();
    state.lastTick24h = now;
  }

  // Time-of-day: jump straight to the correct minute in one step (O(1), exact
  // for any outage length) rather than looping tick30m.
  const missed30m = Math.floor((now - state.lastTick30m) / TICK_30M_MS);
  if (missed30m > 0) {
    state.minutes = (state.minutes + missed30m * 30) % (24 * 60);
    state.lastTick30m = now;
    recalcAmbientAndVisibility();
    await query(
      `UPDATE world_clock SET game_time_minutes = $1, last_tick_30m = now() WHERE id = 1`,
      [state.minutes]
    );
  }

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
      availableKw: z.available_kw,
      hasEmergencyLighting: light ? !!light.has_emergency_lighting : false,
      artificialLight: computeArtificialLight(z.status, light),
    });
  }
}

export async function loadWindows(query) {
  const { rows } = await query('SELECT * FROM windows').catch(() => ({ rows: [] }));
  state.windows = rows;
}

// Called by the API after a window is created/updated/deleted.
export async function reloadWindows() {
  if (deps.query) await loadWindows(deps.query);
}

// Light reaching zone_interior through its windows.
// Outdoor ambient is attenuated by weather, then by each window's transmission
// and state. Interior-facing windows pass the other room's effective light.
export function getWindowLightContribution(zoneId) {
  const weatherFactor = WEATHER_VISIBILITY_FACTOR[state.weatherType] ?? 1.0;
  const fogFactor = FOG_FACTOR[state.weatherType] ?? DEFAULT_FOG_FACTOR;
  let best = 0;
  for (const w of state.windows) {
    if (w.zone_interior !== zoneId) continue;
    if (!w.curtain_open && w.glass_state !== 'broken') continue; // blocked
    const transmission = w.glass_state === 'broken' ? 1.0 : (w.light_transmission ?? 0.8);
    let source;
    if (!w.zone_exterior) {
      // Faces outdoors — transmit global ambient dampened by weather
      source = state.ambientLight * weatherFactor * fogFactor * transmission;
    } else {
      // Interior window — transmit the other room's effective light
      const otherZone = state.zones.get(w.zone_exterior);
      const otherArtificial = otherZone ? otherZone.artificialLight : 0;
      source = Math.max(getWindowLightContribution(w.zone_exterior), otherArtificial) * transmission;
    }
    if (source > best) best = source;
  }
  return clamp01(best);
}

// All windows visible in a zone (for room description and look-through).
export function getWindowsForZone(zoneId) {
  return state.windows.filter(w => w.zone_interior === zoneId);
}

// Mutate a window's curtain or glass state in memory + DB.
export async function setWindowState(windowId, updates) {
  const w = state.windows.find(w => w.id === windowId);
  if (!w) return null;
  Object.assign(w, updates);
  const { query: q } = deps;
  if (updates.curtain_open !== undefined)
    await q('UPDATE windows SET curtain_open=$1 WHERE id=$2', [updates.curtain_open, windowId]);
  if (updates.glass_state !== undefined)
    await q('UPDATE windows SET glass_state=$1 WHERE id=$2', [updates.glass_state, windowId]);
  return w;
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

  // Compute new statuses first, then build genById from the updated values so
  // zone status checks below use current-tick data rather than stale pre-update rows.
  const updatedStatus = new Map();

  for (const gen of generators) {
    // Permanent generators (building / city_plant) always start each tick online —
    // they have no fuel and can't run dry (GDD §5.2). Flicker is transient and
    // clears each tick unless a storm re-triggers it.
    let status = (gen.generator_type === 'player') ? gen.status : 'online';
    if (status === 'flickering') status = 'online';
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

    updatedStatus.set(gen.id, { ...gen, status, fuel_remaining: fuelRemaining });
    await query(`UPDATE generators SET status = $1, fuel_remaining = $2 WHERE id = $3`, [status, fuelRemaining, gen.id]);
  }

  // Group zones by generator so they share the generator's capacity pool.
  const zonesByGen = new Map();
  for (const zone of zones) {
    const key = zone.generator_id ?? '__orphan__';
    if (!zonesByGen.has(key)) zonesByGen.set(key, []);
    zonesByGen.get(key).push(zone);
  }

  for (const [genId, genZones] of zonesByGen) {
    const gen = updatedStatus.get(genId);
    const genCapacity = gen ? gen.capacity_kw : 0;
    const zoneCount = genZones.length;

    // Equal share of the generator's capacity allocated to each connected zone.
    // This is what the plant "pushes" to each zone — independent of current draw.
    const perZoneAlloc = zoneCount > 0 ? genCapacity / zoneCount : 0;
    const totalAllocated = perZoneAlloc * zoneCount; // == genCapacity

    // Generator remaining = capacity minus what's actually being consumed.
    const totalLoad = genZones.reduce((s, z) => s + z.current_load_kw * loadMultiplier, 0);
    const remaining = Math.max(0, genCapacity - totalLoad);

    if (gen) {
      await query(`UPDATE generators SET remaining_kw = $1 WHERE id = $2`, [remaining, genId]);
    }

    // When total allocation exceeds generator capacity (shouldn't happen with equal
    // split, but guards against manual edits), pro-rate delivery proportionally.
    const deliveryRatio = totalAllocated > 0 ? Math.min(1, genCapacity / totalAllocated) : 0;

    for (const zone of genZones) {
      // Power delivered = zone's allocation × delivery ratio (1.0 when healthy).
      const available = perZoneAlloc * deliveryRatio;

      let status;
      if (!gen && zone.generator_id) status = 'offline'; // orphaned — generator deleted
      else if (gen && gen.status === 'offline') status = 'offline';
      else if (available <= 0) status = 'offline';
      else if (available < perZoneAlloc * (1 / POWER_BLACKOUT_RATIO)) status = 'offline';
      else if (available < perZoneAlloc * (1 / POWER_OVERLOAD_RATIO)) status = 'overloaded';
      else status = 'powered';

      // capacity_kw = zone's equal share allocation from the generator.
      // available_kw = what the generator is actually delivering this tick.
      await query(`UPDATE power_zones SET status = $1, capacity_kw = $2, available_kw = $3 WHERE id = $4`,
        [status, perZoneAlloc, available, zone.id]);
    }
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

  // Interior zones (is_apartment / is_interior flag) don't receive outdoor
  // ambient directly — only through windows. Exterior zones use global ambient.
  const hasWindows = state.windows.some(w => w.zone_interior === zoneId);
  const windowLight = hasWindows ? getWindowLightContribution(zoneId) : 0;
  const isInterior = !!(zone && (zone.flags?.is_interior || zone.flags?.is_apartment));
  const ambientContrib = isInterior ? windowLight : state.ambientLight;

  const effectiveLight = Math.max(ambientContrib, artificial);
  const weatherFactor = WEATHER_VISIBILITY_FACTOR[state.weatherType] ?? 1.0;
  const fogFactor = FOG_FACTOR[state.weatherType] ?? DEFAULT_FOG_FACTOR;
  // Interior zones aren't directly affected by outdoor weather/fog —
  // that attenuation was already applied inside getWindowLightContribution.
  const envFactor = isInterior ? 1.0 : weatherFactor * fogFactor;
  const visibility = clamp01(effectiveLight * envFactor);

  let category = 'clear';
  if (visibility === 0) category = 'pitch_dark';
  else if (visibility < VISIBILITY_DIM) category = 'dark';
  else if (visibility < VISIBILITY_CLEAR) category = 'dim';

  return { visibility, category, ambientLight: ambientContrib, artificialLight: artificial, windowLight };
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
    availableKw: z.availableKw,
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
  const { query, broadcast } = deps;
  if (date) state.date = date;
  if (minutes !== undefined) state.minutes = ((Number(minutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  state.dayOfWeek = dayOfWeekFor(state.date);
  recalcAmbientAndVisibility();
  await query(
    `UPDATE world_clock SET game_date = $1, game_time_minutes = $2, day_of_week = $3 WHERE id = 1`,
    [state.date, state.minutes, state.dayOfWeek]
  );
  const payload = getHUDPayload();
  if (broadcast) broadcast({ type: 'environment.sync', ...payload });
  return payload;
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
  const zoneId = rows[0].zone_id;
  await query('DELETE FROM power_zones WHERE generator_id=$1', [generatorId]);
  await query('DELETE FROM generators WHERE id=$1', [generatorId]);
  // If the generator was in a dedicated room (is_interior), and that room is
  // now empty of content, remove it so a stale roof/basement isn't left behind.
  if (zoneId) {
    const [npcs, furn, otherGen] = await Promise.all([
      query('SELECT 1 FROM npcs WHERE zone_id=$1 LIMIT 1', [zoneId]),
      query('SELECT 1 FROM furniture WHERE zone_id=$1 LIMIT 1', [zoneId]),
      query('SELECT 1 FROM generators WHERE zone_id=$1 LIMIT 1', [zoneId]),
    ]);
    const zoneRow = await query(`SELECT flags FROM zones WHERE id=$1`, [zoneId]);
    const isInterior = zoneRow.rows[0]?.flags?.is_interior;
    if (isInterior && !npcs.rows.length && !furn.rows.length && !otherGen.rows.length) {
      // Remove exit from parent zones pointing at this room, then delete it.
      const { rows: parents } = await query(
        `SELECT id, exits FROM zones WHERE exits::text LIKE $1`, [`%${zoneId}%`]
      );
      for (const p of parents) {
        const newExits = Object.fromEntries(Object.entries(p.exits || {}).filter(([, v]) => v !== zoneId));
        await query('UPDATE zones SET exits=$1 WHERE id=$2', [JSON.stringify(newExits), p.id]);
      }
      await query('DELETE FROM lighting_states WHERE zone_id=$1', [zoneId]);
      await query('DELETE FROM zones WHERE id=$1', [zoneId]);
    }
  }
  await recomputePower();
  return { ok: true, deletedZone: zoneId };
}

// ---------------------------------------------------------------------------
// Power fix tools — dev panel utilities to auto-connect unlinked zones.
// ---------------------------------------------------------------------------

// Finds outdoor zones with no power_zones row and connects each to the
// nearest city_plant generator (by Euclidean grid distance).
export async function fixZonePowerConnections() {
  const { query } = deps;

  const { rows: cityGens } = await query(`
    SELECT g.id, g.name, g.capacity_kw, z.grid_x, z.grid_y
    FROM generators g
    JOIN zones z ON z.id = g.zone_id
    WHERE g.generator_type = 'city_plant' AND g.status = 'online'
  `);
  if (!cityGens.length) throw new Error('No online city plant generators found');

  const { rows: unpowered } = await query(`
    SELECT z.id, z.name, z.grid_x, z.grid_y FROM zones z
    WHERE NOT COALESCE((z.flags->>'is_apartment')::boolean, false)
      AND NOT COALESCE((z.flags->>'is_interior')::boolean, false)
      AND z.id NOT IN (SELECT id FROM power_zones)
  `);

  const connected = [];
  for (const zone of unpowered) {
    let nearest = null;
    let minDist = Infinity;
    for (const gen of cityGens) {
      if (zone.grid_x != null && zone.grid_y != null && gen.grid_x != null && gen.grid_y != null) {
        const d = Math.hypot(zone.grid_x - gen.grid_x, zone.grid_y - gen.grid_y);
        if (d < minDist) { minDist = d; nearest = gen; }
      } else if (!nearest) {
        nearest = gen;
      }
    }
    if (!nearest) continue;
    await query(
      `INSERT INTO power_zones (id, name, source_type, generator_id, capacity_kw, current_load_kw, status)
       VALUES ($1, $2, 'city_grid', $3, $4, 0, 'powered')
       ON CONFLICT (id) DO UPDATE SET source_type='city_grid', generator_id=$3, capacity_kw=$4`,
      [zone.id, zone.name, nearest.id, nearest.capacity_kw]
    );
    const { rows: ls } = await query(`SELECT COUNT(*)::int AS cnt FROM furniture WHERE zone_id=$1 AND is_light=1`, [zone.id]);
    await query(
      `INSERT INTO lighting_states (zone_id, has_emergency_lighting, artificial_light_level, fixture_count)
       VALUES ($1, 0, 0, $2) ON CONFLICT (zone_id) DO UPDATE SET fixture_count=$2`,
      [zone.id, ls[0]?.cnt || 0]
    );
    connected.push({ zoneId: zone.id, zoneName: zone.name, generatorName: nearest.name });
  }

  if (connected.length) await recomputePower();
  return { connected };
}

// For each distinct building cluster (is_apartment/is_interior zone network),
// checks how many generators serve it and either connects (1 gen), logs missing
// (0 gens), or returns an error (2+ gens with both names).
export async function fixBuildingPowerConnections() {
  const { query } = deps;

  const { rows: interiorZones } = await query(`
    SELECT id, name FROM zones
    WHERE COALESCE((flags->>'is_apartment')::boolean, false)
       OR COALESCE((flags->>'is_interior')::boolean, false)
  `);

  const visited = new Set();
  const results = { connected: [], needsGenerator: [], multipleGenerators: [] };

  for (const root of interiorZones) {
    if (visited.has(root.id)) continue;
    const network = await getBuildingNetwork(query, root.id);
    for (const id of network) visited.add(id);

    const { rows: gens } = await query(
      `SELECT id, name, capacity_kw FROM generators WHERE zone_id = ANY($1::text[])`,
      [network]
    );

    // Representative name: prefer an is_building-flagged zone, else first alphabetically
    const { rows: namedRows } = await query(
      `SELECT name FROM zones WHERE id = ANY($1::text[])
         AND COALESCE((flags->>'is_building')::boolean, false) = true
       LIMIT 1`,
      [network]
    );
    const buildingName = namedRows[0]?.name || root.name;

    if (gens.length === 0) {
      results.needsGenerator.push({ buildingName, rootId: root.id });
    } else if (gens.length >= 2) {
      results.multipleGenerators.push({ buildingName, generators: gens.map(g => g.name) });
    } else {
      const gen = gens[0];
      // Only write rows that are missing or pointing at the wrong generator.
      const { rows: already } = await query(
        `SELECT id FROM power_zones WHERE id = ANY($1::text[]) AND generator_id = $2`,
        [network, gen.id]
      );
      const alreadyIds = new Set(already.map(r => r.id));
      const toFix = network.filter(zid => !alreadyIds.has(zid));
      if (toFix.length === 0) continue;
      for (const zid of toFix) {
        const { rows: zRows } = await query('SELECT name FROM zones WHERE id=$1', [zid]);
        const zName = zRows[0]?.name || zid;
        await query(
          `INSERT INTO power_zones (id, name, source_type, generator_id, capacity_kw, current_load_kw, status)
           VALUES ($1, $2, 'building_generator', $3, $4, 0, 'powered')
           ON CONFLICT (id) DO UPDATE SET source_type='building_generator', generator_id=$3, capacity_kw=$4`,
          [zid, zName, gen.id, gen.capacity_kw]
        );
        const { rows: ls } = await query(`SELECT COUNT(*)::int AS cnt FROM furniture WHERE zone_id=$1 AND is_light=1`, [zid]);
        await query(
          `INSERT INTO lighting_states (zone_id, has_emergency_lighting, artificial_light_level, fixture_count)
           VALUES ($1, 0, 0, $2) ON CONFLICT (zone_id) DO UPDATE SET fixture_count=$2`,
          [zid, ls[0]?.cnt || 0]
        );
      }
      results.connected.push({ buildingName, generatorName: gen.name, zonesCount: toFix.length });
    }
  }

  if (results.connected.length) await recomputePower();
  return results;
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

export async function getGeneratorZones(generatorId) {
  const { query } = deps;
  const { rows: genRows } = await query('SELECT * FROM generators WHERE id=$1', [generatorId]);
  if (!genRows.length) throw new Error('Generator not found');
  const { rows } = await query(`
    SELECT pz.id, pz.status, pz.capacity_kw, pz.current_load_kw, z.name, z.grid_x, z.grid_y,
           COALESCE((z.flags->>'is_interior')::boolean, false) AS is_interior,
           COALESCE((z.flags->>'is_apartment')::boolean, false) AS is_apartment
    FROM power_zones pz
    LEFT JOIN zones z ON z.id = pz.id
    WHERE pz.generator_id = $1
    ORDER BY z.name
  `, [generatorId]);
  return { generator: genRows[0], zones: rows };
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
