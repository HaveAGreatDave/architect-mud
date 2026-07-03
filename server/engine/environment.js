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
// The environment tables (world_clock, generators, power_zones, weather_*,
// lighting_states) are part of SCHEMA_SQL in server/models/schema.js. Apply
// the schema once before first boot with `npm run db:schema`.
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
import { emit } from './events.js';
import { world } from './world.js';
import { neighborZoneIds, allExits, addExit } from './exits.js';

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

const WEATHER_TYPES = ['clear','cloudy','overcast','rain','sleet','thunderstorm','storm','snow','blizzard','fog','haze','ash'];
const PRECIP_FORECAST_TYPES = new Set(['rain','thunderstorm','storm','sleet','snow','blizzard']);

// Intensity tables — mirrors plugins/clothing-wetness/index.js.
// Used both for label lookup (rate→label) and random picking during precip rolls.
const RAIN_INTENSITY_TABLE = [
  { label: 'mist',                   rate: 0.1 }, { label: 'light drizzle',          rate: 0.2 },
  { label: 'light rain',             rate: 0.3 }, { label: 'steady rain',             rate: 0.4 },
  { label: 'moderate rain',          rate: 0.5 }, { label: 'heavy rain',              rate: 0.6 },
  { label: 'very heavy rain',        rate: 0.7 }, { label: 'storm',                   rate: 0.8 },
  { label: 'severe storm',           rate: 0.9 }, { label: 'extreme deluge',          rate: 1.0 },
];
const SNOW_INTENSITY_TABLE = [
  { label: 'light flurries',         rate: 0.1 }, { label: 'scattered snow',          rate: 0.2 },
  { label: 'steady snowfall',        rate: 0.3 }, { label: 'moderate snow',           rate: 0.4 },
  { label: 'accumulating snow',      rate: 0.5 }, { label: 'thick snowfall',          rate: 0.6 },
  { label: 'wind-blown snow',        rate: 0.7 }, { label: 'blizzard conditions',     rate: 0.8 },
  { label: 'whiteout blizzard',      rate: 0.9 }, { label: 'severe whiteout blizzard',rate: 1.0 },
];
const RAIN_INTENSITY_LABELS = new Map(RAIN_INTENSITY_TABLE.map(e => [e.rate, e.label]));
const SNOW_INTENSITY_LABELS = new Map(SNOW_INTENSITY_TABLE.map(e => [e.rate, e.label]));

function currentIntensityLabel() {
  if (!state.precipRate || state.precipRate <= 0 || state.currentPrecip === 'none') return '';
  const rate = Math.round(state.precipRate * 10) / 10;
  const map = state.currentPrecip === 'snow' ? SNOW_INTENSITY_LABELS : RAIN_INTENSITY_LABELS;
  return map.get(rate) ?? '';
}

// Triangular distribution: mode at (0.1 + chance * 0.9), full range [0.1, 1.0].
// High-chance days cluster toward heavy intensity but can still produce a drizzle;
// low-chance days cluster light but can spike to a deluge.
export function precipRateFromChance(chance) {
  const min = 0.1, max = 1.0;
  const mode = min + chance * (max - min);
  const u = Math.random();
  const fc = (mode - min) / (max - min);
  return u < fc
    ? min + Math.sqrt(u * (max - min) * (mode - min))
    : max - Math.sqrt((1 - u) * (max - min) * (max - mode));
}

// Roll for precipitation and set current state immediately.
// precipChance is 0–1. Called on day advance, recalculate, and weather override.
export function rollAndSetCurrentPrecip(weatherType, tempC, precipChance) {
  const chance = precipChance ?? 0.05;
  if (Math.random() < chance) {
    const precipType = (weatherType === 'snow' || weatherType === 'blizzard') ? 'snow'
      : tempC <= 1 ? 'snow' : 'rain';
    setCurrentPrecip(precipType, precipRateFromChance(chance));
  } else {
    setCurrentPrecip('none', 0);
  }
}

const WEATHER_ICON = {
  clear:        '☀️',
  cloudy:       '☁',
  overcast:     '🌥',
  rain:         '🌧',
  sleet:        '🌨',
  thunderstorm: '⛈',
  storm:        '⚡',
  snow:         '❄',
  blizzard:     '🌨',
  fog:          '🌫',
  haze:         '😶‍🌫️',
  ash:          '🌋',
};

const WEATHER_VISIBILITY_FACTOR = {
  clear:        1.0,
  cloudy:       0.9,
  overcast:     0.85,
  rain:         0.7,
  sleet:        0.65,
  thunderstorm: 0.5,
  storm:        0.45,
  snow:         0.75,
  blizzard:     0.35,
  fog:          0.55,
  haze:         0.65,
  ash:          0.4,
};

// Fog and haze apply an independent multiplicative fog factor on top of the
// weather visibility factor (GDD §7). Ash has a separate strong penalty.
const FOG_FACTOR = { fog: 0.4, haze: 0.7, ash: 0.5 };
const DEFAULT_FOG_FACTOR = 1.0;

const SEASON_BY_MONTH = [
  'winter', 'winter', 'spring', 'spring', 'spring', 'summer',
  'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter',
];


// Indoor zone temperature simulation.
// When powered, HVAC drives zone temp toward 20°C at 2°C/min in either
// direction (cools if above 20, heats if below — reaches target in ~10 min
// from an extreme). Without power, passive conduction drifts the zone toward
// outdoor temp at a rate PROPORTIONAL to the indoor↔outdoor gap (heat flux ∝ ΔT):
// a mild outage barely drifts, but a blackout during an extreme cold snap or
// heatwave bleeds fast enough to become lethal — no free safe haven (see
// docs/systems-weather-extreme.md).
const INDOOR_HVAC_TARGET_C         = 20;
const INDOOR_HVAC_RATE_PER_MIN     = 2.0;
// Fraction of the indoor↔outdoor gap bled per minute when unpowered. Tuned so
// ΔT=10°C ≈ 0.1°C/min (the old flat rate) while ΔT=50°C bleeds at ~0.5°C/min.
const INDOOR_PASSIVE_CONDUCTION    = 0.01;

const POWER_OVERLOAD_RATIO = 1.0;    // alloc < demand × this → 'overloaded'
const EMERGENCY_LIGHT_LEVEL = 0.3;   // artificial-light contribution on emergency power only
// Portable-generator work light: a battery reserve (0..MAX) that lights the
// unit's room even while it's stopped, so you can see to deploy and hook it up
// in a blackout. Idle-but-lit drains the battery; a running generator recharges.
const GEN_BATTERY_MAX = 100;
const GEN_BATTERY_DRAIN = 4;         // per power-sim tick, lit off battery (stopped)
const GEN_BATTERY_RECHARGE = 12;     // per tick, while the generator runs
const SNOW_LOAD_MULTIPLIER = 1.15;   // snow increases effective load (GDD §11: heating demand)
const STORM_GENERATOR_FAULT_CHANCE = 0.10; // base per-tick fault chance, scaled by severity
// Extreme-weather power scar (docs/systems-weather-extreme.md, step 3): a severe
// storm can knock the city plant offline, and it STAYS down for a recovery window
// even after the weather eases — the grid doesn't snap back the instant it clears.
const STORM_FAULT_SEVERITY   = 0.45;  // min local severity before a storm can fault a generator
const STORM_RECOVER_BASE_MIN = 10;    // recovery window floor (minutes)
const STORM_RECOVER_SPAN_MIN = 30;    // + up to this much, scaled by severity (→ 10–40 min)

// Fixture draw values stored and compared in Watts (column still named *_kw
// for historical reasons — the unit is W throughout the engine).
const DRAW_OVERHEAD_W    = 20;    //  20 W overhead panel
const DRAW_STREETLIGHT_W = 200;   // 200 W HPS / LED streetlight
const DRAW_LAMP_W        = 5;     //   5 W bar lamp / small fixture
const DRAW_DEFAULT_W     = 5;     //   5 W generic fixture

const VISIBILITY_DIM = 0.35;   // streetlights switch on below this ambient level

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
  weatherType: 'clear',
  forecast: [],             // 7 entries: { forecastDay, date, weatherType, tempC, locked }
  ambientLight: 1.0,        // 0..1, recalculated every 30-min tick
  phase: 'day',
  zones: new Map(),         // zoneId -> { powerStatus, capacityKw, loadKw, hasEmergencyLighting, artificialLight }
  zoneTemps: new Map(),     // zoneId -> current indoor tempC (indoor zones only; outdoor zones use global state.tempC)
  windows: [],              // all window rows from DB, refreshed on init and mutation
  lastTick1m: 0,           // epoch ms anchor for the last whole game-minute advanced; drives elapsed-based clock
  lastTick30m: 0,
  lastTick24h: 0,
  activeClimateProfileId: null,
  activeClimateProfile: null,  // { monthly_temp_c: [...12], monthly_precip_chance: [...12], monthly_wind_kph: [...12], monthly_humidity: [...12] }
  currentPrecip: 'none',       // 'none' | 'rain' | 'snow' — live state, updated each 30-min tick
  precipRate: 0,               // 0.1–1.0 intensity scale; 0 when dry. Label derived via currentIntensityLabel().
  weatherOverrideActive: false, // true while a dev has manually forced weather outside the forecast
  weatherOverrideBackup: null,  // { weatherType, tempC, precipChance } — pre-override forecast day 0 values
  lightningKills: [],           // [{ handle, date, time }] — players killed by storm lightning (not smite)
};

let deps = { query: null, emitHook: null, broadcast: null };
let ticksScheduled = false;
// True while at least one generator is inside a storm-fault recovery window. Keeps
// the 5-minute power tick running until the grid recovers, then lets it go quiet.
let stormFaultActive = false;

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

// Diurnal temperature offset: cosine curve peaking at 2pm (+5°C above daily
// base) and troughing at 2am (-12°C below). Amplitude = 8.5, midpoint = -3.5.
function diurnalOffset(minutesOfDay) {
  const peakMinute = 14 * 60; // 2 pm
  const amplitude  = 8.5;
  const midpoint   = -3.5;
  const t = (minutesOfDay - peakMinute) / (24 * 60);
  return Math.round(midpoint + amplitude * Math.cos(2 * Math.PI * t));
}

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

export async function initEnvironment({ query, emitHook, broadcast, getOccupiedZones }) {
  deps = { query, emitHook, broadcast, getOccupiedZones };

  const clockRow = await ensureClockRow(query);
  state.date = toDateString(clockRow.game_date);
  state.minutes = clockRow.game_time_minutes;
  state.dayOfWeek = clockRow.day_of_week;
  state.season = clockRow.season;
  state.lastTick30m = new Date(clockRow.last_tick_30m).getTime();
  state.lastTick24h = new Date(clockRow.last_tick_24h).getTime();
  const lastTick1m = clockRow.last_tick_1m ? new Date(clockRow.last_tick_1m).getTime() : state.lastTick30m;

  state.weatherOverrideActive = clockRow.weather_override_active || false;
  state.weatherOverrideBackup = clockRow.weather_override_backup || null;
  state.lightningKills = clockRow.lightning_kills || [];

  state.activeClimateProfileId = clockRow.active_climate_profile_id || null;
  if (state.activeClimateProfileId) {
    const { rows: cpRows } = await query('SELECT * FROM climate_profiles WHERE id = $1', [state.activeClimateProfileId]);
    if (cpRows[0]) state.activeClimateProfile = { monthly_temp_c: cpRows[0].monthly_temp_c, monthly_precip_chance: cpRows[0].monthly_precip_chance, monthly_wind_kph: cpRows[0].monthly_wind_kph, monthly_humidity: cpRows[0].monthly_humidity };
  }

  // Weather plugin initializes the forecast via this hook. Must run before
  // loadZonePowerAndLighting + recalcAmbientAndVisibility so state.weatherType
  // is populated when those functions read it.
  if (emitHook) await emitHook('environment.init', { setWeatherState, setCurrentPrecip, climateProfile: state.activeClimateProfile, registerWeatherField, registerWeatherFieldSnapshot, registerWeatherFieldAdvance });

  await loadZonePowerAndLighting(query);
  await loadWindows(query);
  recalcAmbientAndVisibility();
  initIndoorTemps();

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

  // Time-of-day: jump straight to the correct minute based on elapsed real time
  // since the last 1-minute clock tick. This is exact for any outage length.
  let anchor1m = lastTick1m;
  const missedMinutes = Math.floor((now - anchor1m) / 60_000);
  if (missedMinutes > 0) {
    state.minutes = (state.minutes + missedMinutes) % (24 * 60);
    // Advance the anchor by whole minutes only, keeping the sub-minute
    // remainder, so restarts can't shed a fraction of a minute each time.
    anchor1m += missedMinutes * 60_000;
    recalcAmbientAndVisibility();
    await query(
      `UPDATE world_clock SET game_time_minutes = $1, last_tick_1m = to_timestamp($2) WHERE id = 1`,
      [state.minutes, anchor1m / 1000]
    );
  }
  state.lastTick1m = anchor1m;

  scheduleTicks();
  state.ready = true;

  // Sync streetlights on boot — each zone lit per its own local ambient visibility.
  await syncStreetlights().catch(() => {});
  await recomputePower().catch(() => {});
}

function scheduleTicks() {
  if (ticksScheduled) return; // schedule() is append-only; guard against double-init
  ticksScheduled = true;
  schedule('1m',  () => { if (!state.frozen) tick1m().catch(logError); });
  schedule('30m', () => { if (!state.frozen) tick30m().catch(logError); });
  schedule('24h', () => { if (!state.frozen) tick24h().catch(logError); });

  // 5-minute brownout rotation: only runs the full power redistribution when
  // at least one zone is overloaded, so there's zero cost on a healthy grid.
  schedule('5m', () => {
    if (state.frozen) return;
    const anyOverloaded = [...state.zones.values()].some(z => z.powerStatus === 'overloaded');
    // Also run while severe weather can fault the grid, or while a storm fault is
    // still recovering — so blackouts trigger and clear on a 5-minute cadence
    // rather than waiting for the daily tick.
    const severity = weatherFieldSnapshot ? (weatherFieldSnapshot()?.baseSeverity ?? 0) : 0;
    if (anyOverloaded || stormFaultActive || severity >= STORM_FAULT_SEVERITY) tick5m().catch(logError);
  });

  // 30-second flicker: pure broadcast to overloaded zones — no DB writes,
  // just keeps the visual effect alive between redistribution ticks. Also
  // advects the moving weather field one step and pushes local outdoor weather
  // to occupied zones (in-memory only; no DB writes).
  schedule('30s', () => {
    flickerOverloadedZones();
    if (!state.frozen && advanceWeatherField) {
      advanceWeatherField();
      const occupied = deps.getOccupiedZones ? [...deps.getOccupiedZones()] : [];
      broadcastZoneWeather(occupied);
      // Snappy streetlights: reconcile only the zones players are standing in so
      // a storm rolling overhead lights their block at once; the 30-minute tick
      // still sweeps the whole map.
      if (occupied.length) {
        syncStreetlights(occupied)
          .then(changed => (changed ? recomputePower() : null))
          .catch(() => {});
      }
    }
  });
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
  const { rows: zones } = await query(`
    SELECT pz.*, g.generator_type, z.flags AS zone_flags, z.grid_x, z.grid_y, z.map_id
    FROM power_zones pz
    LEFT JOIN generators g ON g.id = pz.generator_id
    LEFT JOIN zones z ON z.id = pz.id
  `);
  const { rows: lights } = await query('SELECT * FROM lighting_states');
  const lightByZone = new Map(lights.map((l) => [l.zone_id, l]));
  state.zones.clear();
  for (const z of zones) {
    const light = lightByZone.get(z.id);
    const zf = z.zone_flags || {};
    state.zones.set(z.id, {
      powerStatus: z.status,
      capacityKw: z.capacity_kw,
      loadKw: z.current_load_kw,
      availableKw: z.available_kw,
      maxCapacityKw: z.max_capacity_kw ?? 1000,
      generatorId: z.generator_id,
      generatorType: z.generator_type,
      hasEmergencyLighting: light ? !!light.has_emergency_lighting : false,
      artificialLight: computeArtificialLight(z.status, light),
      flags: zf,
      gridX: z.grid_x,
      gridY: z.grid_y,
      mapId: z.map_id,
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

// Lumen thresholds for the log curve. 400 lm (1 lamp) → ~0.64 (just clear);
// 1200 lm (1 overhead) → ~0.73; 8000 lm (streetlight) → ~0.95; 12000+ → 1.0.
const LUMEN_LOG_SCALE = 400;
const LUMEN_LOG_SAT   = 12000;

function computeArtificialLight(powerStatus, light) {
  if (powerStatus === 'powered') {
    const lumens = light ? (light.total_lumens || 0) : 0;
    if (lumens === 0) return 0.3; // powered but no lights on → dim ambient
    return clamp01(0.55 + 0.45 * Math.log(1 + lumens / LUMEN_LOG_SCALE) / Math.log(1 + LUMEN_LOG_SAT / LUMEN_LOG_SCALE));
  }
  if (powerStatus === 'overloaded') return 0.6;
  return light && light.has_emergency_lighting ? EMERGENCY_LIGHT_LEVEL : 0.0;
}

// ---------------------------------------------------------------------------
// Indoor Temperature Simulation
// ---------------------------------------------------------------------------

function isIndoorZone(z) {
  return !!(z?.flags?.is_interior || z?.flags?.is_apartment || z?.flags?.is_building);
}

// Seed indoor zones that have no entry yet with the current outdoor temp.
// Safe to call repeatedly — skips zones already tracked.
function initIndoorTemps() {
  const outdoorTemp = state.tempC + diurnalOffset(state.minutes);
  for (const [zoneId, z] of state.zones) {
    if (isIndoorZone(z) && !state.zoneTemps.has(zoneId)) {
      state.zoneTemps.set(zoneId, outdoorTemp);
    }
  }
}

// Called every 1-minute tick. Steps each indoor zone one minute toward its target.
function stepIndoorTemps() {
  const outdoorTemp = state.tempC + diurnalOffset(state.minutes);
  for (const [zoneId, z] of state.zones) {
    if (!isIndoorZone(z)) continue;
    const current = state.zoneTemps.get(zoneId) ?? outdoorTemp;
    const powered = z.powerStatus === 'powered' || z.powerStatus === 'overloaded';
    let step;
    if (powered) {
      // HVAC pulls toward the setpoint at a fixed rate (linear crawl, capped so it can't overshoot).
      const diff = INDOOR_HVAC_TARGET_C - current;
      step = Math.sign(diff) * Math.min(Math.abs(diff), INDOOR_HVAC_RATE_PER_MIN);
    } else {
      // Unpowered: passive conduction toward outdoor temp, proportional to the gap.
      // Asymptotic (never overshoots); accelerates automatically in extreme weather.
      step = (outdoorTemp - current) * INDOOR_PASSIVE_CONDUCTION;
    }
    state.zoneTemps.set(zoneId, Math.round((current + step) * 10) / 10);
  }
}

// ---------------------------------------------------------------------------
// 5-Minute Brownout Rotation Tick (only active when grid is overloaded)
// ---------------------------------------------------------------------------

async function tick5m() {
  const { query } = deps;
  await simulatePowerNetwork(query, { weatherType: state.weatherType });
  await loadZonePowerAndLighting(query);
}

function _pluralizeLastWord(name) {
  const words = name.split(' ');
  const last = words[words.length - 1];
  let plural;
  if (/(s|sh|ch|x|z)$/i.test(last))   plural = last + 'es';
  else if (/[^aeiou]y$/i.test(last))   plural = last.slice(0, -1) + 'ies';
  else                                  plural = last + 's';
  return [...words.slice(0, -1), plural].join(' ');
}

// Formats a list of light names into a readable phrase, deduplicating repeated
// names and pluralizing them (e.g. three "overhead light" → "the overhead lights").
// Returns { text, isSingular } — isSingular is true only when exactly one fixture.
function _fmtLightNames(names) {
  if (!names.length) return { text: 'the lights', isSingular: false };
  const counts = new Map();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  const parts = [...counts.entries()].map(([n, c]) => `the ${c > 1 ? _pluralizeLastWord(n) : n}`);
  const isSingular = counts.size === 1 && [...counts.values()][0] === 1;
  const text = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return { text, isSingular };
}

const _cap = s => s.charAt(0).toUpperCase() + s.slice(1);

const FLICKER_MSGS = [
  (n, s) => `${_cap(n)} ${s ? 'flickers' : 'flicker'} erratically as the power supply struggles.`,
  (n, s) => `${_cap(n)} ${s ? 'stutters' : 'stutter'}, casting unsteady light.`,
  (n, s) => `${_cap(n)} ${s ? 'pulses' : 'pulse'} weakly — the grid is under strain.`,
  (n, s) => `${_cap(n)} ${s ? 'dims' : 'dim'} and ${s ? 'brightens' : 'brighten'} in an uneven rhythm.`,
];

// Sends flicker broadcasts to overloaded zones — no DB writes.
async function flickerOverloadedZones() {
  const { broadcast, query } = deps;
  if (!broadcast || !query) return;
  for (const [zoneId, z] of state.zones) {
    if (z.powerStatus !== 'overloaded') continue;
    const { rows } = await query(
      `SELECT name FROM furniture WHERE zone_id=$1 AND object_type='light' AND light_on=1 LIMIT 3`,
      [zoneId]
    ).catch(() => ({ rows: [] }));
    const { text: nameStr, isSingular } = _fmtLightNames(rows.map(r => r.name));
    const pick = FLICKER_MSGS[Math.floor(Math.random() * FLICKER_MSGS.length)];
    broadcast(zoneId, { type: 'zone_event', message: `<br><span class="power-flicker">${pick(nameStr, isSingular)}</span><br>` });
  }
}

// ---------------------------------------------------------------------------
// 1-Minute Clock Tick
// Increments game time by 1 minute, saves to DB, broadcasts to all clients.
// ---------------------------------------------------------------------------

async function tick1m() {
  const { query, broadcast } = deps;
  // Advance by however many whole minutes of real time have actually elapsed,
  // not a blind +1. setInterval only ever fires late (event-loop lag, GC), so
  // counting fires makes the clock drift permanently behind real time; anchoring
  // to the wall clock makes a late or delayed tick self-correcting. The
  // sub-minute remainder is carried in the anchor so nothing is lost.
  const now = Date.now();
  const elapsedMin = Math.floor((now - state.lastTick1m) / 60_000);
  if (elapsedMin >= 1) {
    state.minutes = (state.minutes + elapsedMin) % (24 * 60);
    state.lastTick1m += elapsedMin * 60_000;
    await query(
      `UPDATE world_clock SET game_time_minutes = $1, last_tick_1m = to_timestamp($2) WHERE id = 1`,
      [state.minutes, state.lastTick1m / 1000]
    );
  }
  stepIndoorTemps();
  if (broadcast) {
    broadcast({ type: 'environment.clockTick', time: formatHHMM(state.minutes), tempC: state.tempC + diurnalOffset(state.minutes), currentWeatherType: state.currentPrecip !== 'none' ? state.currentPrecip : (PRECIP_FORECAST_TYPES.has(state.weatherType) ? 'cloudy' : state.weatherType), currentIntensity: currentIntensityLabel() });
    // Per-zone indoor temp broadcasts so indoor HUDs stay current.
    for (const [zoneId, tempC] of state.zoneTemps) {
      broadcast(zoneId, { type: 'environment.zoneTempTick', tempC });
    }
  }
  await flickerOverloadedZones();
}

// Per-zone ambient visibility: time-of-day light attenuated by that zone's LOCAL
// weather (the moving cloud/storm field on map_world falls back to global weather
// factors elsewhere). Deliberately excludes artificial light so streetlights are
// decided without feedback from the very lights being toggled. Mirrors the
// outdoor blend in getZoneVisibility.
function zoneAmbientVisibility(gridX, gridY, mapId) {
  const weatherFactor = WEATHER_VISIBILITY_FACTOR[state.weatherType] ?? 1.0;
  const fogFactor     = FOG_FACTOR[state.weatherType] ?? DEFAULT_FOG_FACTOR;
  let factor = weatherFactor * fogFactor;
  if (sampleField && mapId === 'map_world' && gridX != null) {
    const f = sampleField(gridX, gridY);
    const activePrecip = state.currentPrecip !== 'none' ? f.precipRate : 0;
    const localCloudFactor = clamp01(1 - 0.5 * f.cloudCover - 0.4 * activePrecip);
    factor = Math.min(factor, localCloudFactor);
  }
  return state.ambientLight * factor;
}

// Reconcile streetlights to each zone's LOCAL ambient visibility, so lights come
// on tile-by-tile — a storm cell rolling over one block lights it while a clear
// block nearby stays dark, and nightfall lights everything. Only powered zones
// light up; unpowered or clearing zones go dark. Sends a zone_event + look
// refresh to zones that changed. Returns true if anything changed so the caller
// can recompute power. Pass zoneFilter (array of zoneIds) to reconcile only
// those zones — the 30-second tick uses this to react instantly for the zones
// players are actually standing in, while the 30-minute tick sweeps everything.
async function syncStreetlights(zoneFilter = null) {
  const { query, broadcast } = deps;

  const filter = zoneFilter && zoneFilter.length ? [...zoneFilter] : null;
  const { rows } = await query(
    filter
      ? `SELECT f.zone_id, f.light_on, z.grid_x, z.grid_y, z.map_id
         FROM furniture f JOIN zones z ON z.id = f.zone_id
         WHERE f.light_type = 'streetlight' AND f.zone_id = ANY($1)`
      : `SELECT f.zone_id, f.light_on, z.grid_x, z.grid_y, z.map_id
         FROM furniture f JOIN zones z ON z.id = f.zone_id
         WHERE f.light_type = 'streetlight'`,
    filter ? [filter] : undefined
  ).catch(() => ({ rows: [] }));
  if (!rows.length) return false;

  const want = new Map();     // zoneId -> 1|0 desired
  const wasOn = new Set();    // zones with >=1 streetlight currently on
  for (const r of rows) {
    if (r.light_on) wasOn.add(r.zone_id);
    if (!want.has(r.zone_id)) {
      const z = state.zones.get(r.zone_id);
      const powered = z && (z.powerStatus === 'powered' || z.powerStatus === 'overloaded');
      const vis = zoneAmbientVisibility(r.grid_x, r.grid_y, r.map_id);
      want.set(r.zone_id, (powered && vis < VISIBILITY_DIM) ? 1 : 0);
    }
  }

  const onZones = [], offZones = [];
  for (const [zoneId, w] of want) {
    const on = wasOn.has(zoneId);
    if (w && !on) onZones.push(zoneId);
    else if (!w && on) offZones.push(zoneId);
  }
  if (!onZones.length && !offZones.length) return false;

  if (onZones.length)  await query(`UPDATE furniture SET light_on = 1 WHERE light_type = 'streetlight' AND zone_id = ANY($1)`, [onZones]).catch(() => {});
  if (offZones.length) await query(`UPDATE furniture SET light_on = 0 WHERE light_type = 'streetlight' AND zone_id = ANY($1)`, [offZones]).catch(() => {});

  if (broadcast) {
    const isDarkPhase = state.phase === 'night' || state.phase === 'dusk';
    const onMsg = isDarkPhase
      ? '<br><span class="power-restore">The streetlights flicker to life as darkness falls.</span><br>'
      : '<br><span class="power-restore">The streetlights flicker on against the gloom.</span><br>';
    const offMsg = isDarkPhase
      ? '<br><span class="ambient">The streetlights go dark as conditions clear.</span><br>'
      : '<br><span class="ambient">The streetlights dim and go dark as daylight returns.</span><br>';
    for (const zoneId of onZones)  broadcast(zoneId, { type: 'zone_event', message: onMsg,  refresh: true });
    for (const zoneId of offZones) broadcast(zoneId, { type: 'zone_event', message: offMsg, refresh: true });
  }
  return true;
}

// ---------------------------------------------------------------------------
// 30-Minute Environmental Tick
// Ambient light → visibility baseline → streetlights → full client sync.
// Time is already up-to-date from the 1-minute tick — do NOT add 30 here.
// ---------------------------------------------------------------------------

async function tick30m() {
  const { query, emitHook, broadcast } = deps;

  state.lastTick30m = Date.now();

  const prevPhase = state.phase;
  recalcAmbientAndVisibility();

  await query(`UPDATE world_clock SET last_tick_30m = now() WHERE id = 1`);

  // Reconcile streetlights against each zone's LOCAL ambient visibility, so a
  // block under a passing storm cell lights up while clear blocks stay dark —
  // as well as the usual nightfall/fog darkening.
  if (await syncStreetlights().catch(() => false)) await recomputePower().catch(() => {});

  // Precipitation roll: start if dry and roll wins; stop if raining and roll loses.
  const precipChance = state.forecast[0]?.precipChance ?? 0.05;
  const precipRoll = Math.random();
  if (precipRoll < precipChance && state.currentPrecip === 'none') {
    const precipType = (state.weatherType === 'snow' || state.weatherType === 'blizzard') ? 'snow'
      : state.tempC <= 1 ? 'snow' : 'rain';
    setCurrentPrecip(precipType, precipRateFromChance(precipChance));
  } else if (precipRoll >= precipChance && state.currentPrecip !== 'none') {
    setCurrentPrecip('none', 0);
  }

  const payload = getHUDPayload();
  if (broadcast) broadcast({ type: 'environment.sync', ...payload });

  if (emitHook) {
    await emitHook('environment.tick30m', { ...payload, setCurrentPrecip, getHUDPayload, broadcast });
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
  if (emitHook) await emitHook('environment.advanceWeather', { setWeatherState, rollAndSetCurrentPrecip, getHUDPayload, broadcast, currentForecast: state.forecast, currentDate: state.date, climateProfile: state.activeClimateProfile });
  await simulatePowerNetwork(query, { weatherType: state.weatherType });
  await loadZonePowerAndLighting(query);
  recalcAmbientAndVisibility();

  const payload = { ...getHUDPayload(), forecast: getForecast() };
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

// Handles light-state side-effects when a zone's power status changes.
// prevStatus = status stored in DB before this tick; newStatus = just computed.
async function applyPowerLightEffects(query, zoneId, prevStatus, newStatus, available, maxCap, opts = {}) {
  const broadcast = deps.broadcast;

  const wasOk = prevStatus === 'powered';
  const nowOk  = newStatus === 'powered';
  const nowDown = newStatus === 'offline';
  const nowBrown = newStatus === 'overloaded';

  if (nowDown) {
    // Capture which lights are on before cutting them.
    const { rows: activeLights } = await query(
      `SELECT name FROM furniture WHERE zone_id=$1 AND object_type='light' AND light_on=1`,
      [zoneId]
    ).catch(() => ({ rows: [] }));
    // Preserve intended state for non-streetlights only.
    // Streetlights are managed by the day/night cycle — they don't need
    // light_on_intended because syncStreetlights sets them correctly on restore.
    await query(`UPDATE furniture SET light_on_intended = COALESCE(light_on_intended, light_on) WHERE zone_id=$1 AND object_type='light' AND light_type != 'streetlight'`, [zoneId]);
    await query(`UPDATE furniture SET light_on=0 WHERE zone_id=$1 AND object_type='light'`, [zoneId]);
    // Do NOT zero current_load_kw — demand stays constant; only available_kw=0 signals no supply.
    await query(`UPDATE lighting_states SET fixture_count=0, total_lumens=0 WHERE zone_id=$1`, [zoneId]).catch(() => {});
    if (broadcast && prevStatus !== 'offline' && !opts.silent) {
      const { text: nameStr, isSingular } = _fmtLightNames(activeLights.map(l => l.name));
      const CUTOUT_MSGS = [
        `${_cap(nameStr)} ${isSingular ? 'cuts' : 'cut'} out abruptly. Darkness.`,
        `${_cap(nameStr)} ${isSingular ? 'dies' : 'die'} with a sharp click as power fails.`,
        `Power lost. ${nameStr} ${isSingular ? 'goes' : 'go'} dark without warning.`,
      ];
      const msg = CUTOUT_MSGS[Math.floor(Math.random() * CUTOUT_MSGS.length)];
      broadcast(zoneId, { type: 'zone_event', message: `<span class="power-out">${msg}</span><br>`, refresh: true });
    }
  } else if (nowBrown) {
    // Preserve intended state before any changes.
    await query(`UPDATE furniture SET light_on_intended = COALESCE(light_on_intended, light_on) WHERE zone_id=$1 AND object_type='light'`, [zoneId]);

    // Per-device allocation: fetch all powered devices with their draw.
    const { rows: lights } = await query(`
      SELECT id, name, light_on_intended,
        COALESCE(power_draw_kw,
          CASE light_type
            WHEN 'overhead'    THEN ${DRAW_OVERHEAD_W}
            WHEN 'streetlight' THEN ${DRAW_STREETLIGHT_W}
            WHEN 'lamp'        THEN ${DRAW_LAMP_W}
            ELSE ${DRAW_DEFAULT_W}
          END
        ) AS draw_kw
      FROM furniture WHERE zone_id=$1 AND object_type='light'
    `, [zoneId]);

    // Streetlights are infrastructure — always on when dark, never compete for brownout pool.
    const isDark = state.phase === 'night' || state.phase === 'dusk';
    const streetlightIds = lights.filter(l => l.light_type === 'streetlight').map(l => l.id);
    if (streetlightIds.length) {
      await query(`UPDATE furniture SET light_on=$1, light_on_intended=NULL WHERE id=ANY($2::text[])`, [isDark ? 1 : 0, streetlightIds]);
    }
    const wantOn = lights.filter(l => l.light_on_intended === 1 && l.light_type !== 'streetlight').sort((a, b) => a.draw_kw - b.draw_kw);

    let pool = available;
    const fullyOn = [], flickering = [], forcedOff = [];

    for (const light of wantOn) {
      if (pool >= light.draw_kw) {
        fullyOn.push(light.id);
        pool -= light.draw_kw;
      } else if (pool > 0) {
        flickering.push(light.id);
        pool = 0;
      } else {
        forcedOff.push(light.id);
      }
    }

    if (fullyOn.length)   await query(`UPDATE furniture SET light_on=1 WHERE id=ANY($1::text[])`, [fullyOn]);
    if (forcedOff.length) await query(`UPDATE furniture SET light_on=0 WHERE id=ANY($1::text[])`, [forcedOff]);
    // Flickering devices randomly toggle each tick.
    for (const id of flickering) {
      await query(`UPDATE furniture SET light_on=$1 WHERE id=$2`, [Math.random() > 0.5 ? 1 : 0, id]);
    }

    await recalcZoneLoad(query, zoneId);
    const { rows: lc } = await query(`SELECT COUNT(*)::int AS cnt, COALESCE(SUM(COALESCE(lumen_output,0)),0)::int AS lm FROM furniture WHERE zone_id=$1 AND object_type='light' AND light_on=1`, [zoneId]);
    await query(`UPDATE lighting_states SET fixture_count=$1, total_lumens=$2 WHERE zone_id=$3`, [lc[0]?.cnt || 0, lc[0]?.lm || 0, zoneId]).catch(() => {});

    if (broadcast) {
      if (forcedOff.length) {
        const { text: nameStr, isSingular } = _fmtLightNames(forcedOff.map(id => lights.find(l => l.id === id)?.name).filter(Boolean));
        broadcast(zoneId, { type: 'zone_event', message: `<br><span class="power-flicker">${_cap(nameStr)} ${isSingular ? 'cuts' : 'cut'} out abruptly — not enough power to keep everything on.</span><br>`, refresh: true });
      } else if (flickering.length) {
        const { text: nameStr, isSingular } = _fmtLightNames(flickering.map(id => lights.find(l => l.id === id)?.name).filter(Boolean));
        broadcast(zoneId, { type: 'zone_event', message: `<br><span class="power-flicker">${_cap(nameStr)} ${isSingular ? 'flickers' : 'flicker'} as the supply runs thin.</span><br>`, refresh: true });
      }
    }
  } else if (nowOk && !wasOk) {
    // Power restored — recover intended light states for non-streetlights.
    await query(`
      UPDATE furniture
      SET light_on = COALESCE(light_on_intended, light_on),
          light_on_intended = NULL
      WHERE zone_id = $1 AND object_type = 'light' AND light_type != 'streetlight'
    `, [zoneId]);
    // Streetlights follow the day/night cycle exclusively — set them to the
    // correct state for the current phase regardless of what light_on_intended was.
    const isDark = state.phase === 'night' || state.phase === 'dusk';
    await query(`UPDATE furniture SET light_on=$1, light_on_intended=NULL WHERE zone_id=$2 AND light_type='streetlight'`, [isDark ? 1 : 0, zoneId]);
    await recalcZoneLoad(query, zoneId);
    const { rows: lc2 } = await query(`SELECT COUNT(*)::int AS cnt, COALESCE(SUM(COALESCE(lumen_output,0)),0)::int AS lm FROM furniture WHERE zone_id=$1 AND object_type='light' AND light_on=1`, [zoneId]);
    await query(`UPDATE lighting_states SET fixture_count=$1, total_lumens=$2 WHERE zone_id=$3`, [lc2[0]?.cnt || 0, lc2[0]?.lm || 0, zoneId]).catch(() => {});
    if (broadcast) {
      broadcast(zoneId, { type: 'zone_event', message: '<span class="power-restore">Emergency power hums to life. The lights come back on.</span><br>', refresh: true });
    }
  }
}

async function simulatePowerNetwork(query, { weatherType }) {
  const { rows: allGenerators } = await query('SELECT * FROM generators');
  const loadMultiplier = weatherType === 'snow' ? SNOW_LOAD_MULTIPLIER : 1.0;
  // Global outdoor severity, defined once in the weather plugin and read here via
  // the field snapshot (no duplicated thresholds). Drives storm faults below.
  const severity = weatherFieldSnapshot ? (weatherFieldSnapshot()?.baseSeverity ?? 0) : 0;
  const now = Date.now();
  let anyRecovering = false;

  // ── Phase 1: Resolve generator statuses ─────────────────────────────────
  // city_plant and junction_box are permanent (no fuel). Only player generators
  // consume fuel or stay permanently offline. Severe storms fault individual
  // junction_boxes OFFLINE — the building-level distribution feeds fail before the
  // hardened central plant, giving scattered per-building blackouts rather than a
  // city-wide one — and hold them there for a recovery window (recover_after in
  // flags), so a downed building doesn't snap back the instant the weather eases.
  const updatedStatus = new Map();
  const genLightByZone = new Map(); // zoneId → any portable gen wants its work light on
  for (const gen of allGenerators) {
    // A destroyed unit (its physical furniture was smashed apart) stays dark
    // regardless of type — this is what cuts power to everything downstream.
    if (gen.flags?.destroyed) {
      updatedStatus.set(gen.id, { ...gen, status: 'offline' });
      await query(`UPDATE generators SET status=$1 WHERE id=$2`, ['offline', gen.id]);
      continue;
    }
    let status = (gen.generator_type === 'player') ? gen.status : 'online';
    if (status === 'flickering') status = 'online';
    let fuelRemaining = gen.fuel_remaining;
    // A portable generator only burns fuel while it's actually running (online).
    // A stopped unit (offline) holds its tank; an empty tank stalls it out.
    if (gen.generator_type === 'player' && gen.fuel_type && status === 'online') {
      fuelRemaining = Math.max(0, fuelRemaining - gen.fuel_burn_rate * 30);
      if (fuelRemaining <= 0) status = 'offline';
    }

    // Storm-fault persistence: honour an active recovery window, expire a lapsed
    // one, and roll a fresh fault only in severe weather. Only city_plant faults.
    let flags = gen.flags || {};
    let flagsChanged = false;
    let inRecovery = false;
    const recoverAfter = flags.recover_after ? new Date(flags.recover_after).getTime() : 0;
    if (recoverAfter && now < recoverAfter) {
      inRecovery = true;
      if (gen.generator_type === 'junction_box') status = 'offline';  // still knocked out
      anyRecovering = true;
    } else if (recoverAfter) {
      const { recover_after, ...rest } = flags;                       // window elapsed — clear the scar
      flags = rest; flagsChanged = true;
    }
    if (gen.generator_type === 'junction_box' && !inRecovery && status !== 'offline'
        && severity >= STORM_FAULT_SEVERITY && Math.random() < STORM_GENERATOR_FAULT_CHANCE * severity) {
      status = 'offline';
      const recoverMs = (STORM_RECOVER_BASE_MIN + severity * STORM_RECOVER_SPAN_MIN) * 60_000;
      flags = { ...flags, recover_after: new Date(now + recoverMs).toISOString() };
      flagsChanged = true;
      anyRecovering = true;
    }

    // Portable-generator battery + work light. Recharge while running, drain
    // while lit off the battery (stopped), and note the room so its emergency
    // light is applied after the loop (aggregated, so two units don't fight).
    if (gen.generator_type === 'player') {
      const bmax = gen.flags?.battery_max ?? GEN_BATTERY_MAX;
      let battery = gen.flags?.battery ?? bmax;
      if (status === 'online') battery = Math.min(bmax, battery + GEN_BATTERY_RECHARGE);
      else if (battery > 0) battery = Math.max(0, battery - GEN_BATTERY_DRAIN);
      flags = { ...flags, battery, battery_max: bmax };
      flagsChanged = true;
      if (gen.zone_id) {
        const lit = status === 'online' || battery > 0;
        genLightByZone.set(gen.zone_id, (genLightByZone.get(gen.zone_id) || false) || lit);
      }
    }

    updatedStatus.set(gen.id, { ...gen, status, fuel_remaining: fuelRemaining, flags });
    if (flagsChanged) {
      await query(`UPDATE generators SET status=$1, fuel_remaining=$2, flags=$3 WHERE id=$4`, [status, fuelRemaining, JSON.stringify(flags), gen.id]);
    } else {
      await query(`UPDATE generators SET status=$1, fuel_remaining=$2 WHERE id=$3`, [status, fuelRemaining, gen.id]);
    }
  }
  stormFaultActive = anyRecovering;

  // Drive each portable generator's room emergency light off its battery/run
  // state. We only ever write zones that hold a portable generator, so this
  // owns nothing else's lighting. This is what lets a unit dropped in a
  // blacked-out room light itself before it back-feeds the building's fixtures.
  for (const [zoneId, lit] of genLightByZone) {
    await query(
      `INSERT INTO lighting_states (zone_id, has_emergency_lighting, artificial_light_level, fixture_count, total_lumens)
       VALUES ($1, $2, 0, 0, 0)
       ON CONFLICT (zone_id) DO UPDATE SET has_emergency_lighting=$2`,
      [zoneId, lit ? 1 : 0]
    );
  }

  // ── Phase 2: Recalculate zone loads from active furniture ────────────────
  // Streetlights are always counted as drawing power when it's dark, regardless
  // of light_on — this prevents demand oscillation where lights turning off drops
  // demand to 0, causing the zone to flip to 'powered' and back on every tick.
  const isDark = state.phase === 'night' || state.phase === 'dusk';
  await query(`
    UPDATE power_zones pz SET current_load_kw = (
      SELECT COALESCE(SUM(CASE
        WHEN f.power_draw_kw IS NOT NULL THEN f.power_draw_kw
        WHEN f.light_type = 'overhead'    THEN ${DRAW_OVERHEAD_W}
        WHEN f.light_type = 'streetlight' THEN ${DRAW_STREETLIGHT_W}
        WHEN f.light_type = 'lamp'        THEN ${DRAW_LAMP_W}
        ELSE ${DRAW_DEFAULT_W}
      END), 0)
      FROM furniture f WHERE f.zone_id = pz.id AND (
        (f.object_type = 'light' AND COALESCE(f.light_on_intended, f.light_on) = 1 AND f.light_type != 'streetlight') OR
        (f.object_type = 'light' AND f.light_type = 'streetlight' AND $1) OR
        (f.object_type != 'light' AND f.power_draw_kw > 0)
      )
    )
  `, [isDark]);
  // Sync fixture counts and total lumens so visibility is always based on current light_on state.
  await query(`
    UPDATE lighting_states ls
    SET fixture_count = sub.cnt,
        total_lumens  = sub.lm
    FROM (
      SELECT zone_id,
             COUNT(*)::int AS cnt,
             COALESCE(SUM(COALESCE(lumen_output, 0)), 0)::int AS lm
      FROM furniture
      WHERE object_type = 'light' AND light_on = 1
      GROUP BY zone_id
    ) sub
    WHERE ls.zone_id = sub.zone_id
  `).catch(() => {});
  const { rows: allZones } = await query('SELECT * FROM power_zones');
  const zonesByGen = new Map();
  for (const z of allZones) {
    const key = z.generator_id ?? '__orphan__';
    if (!zonesByGen.has(key)) zonesByGen.set(key, []);
    zonesByGen.get(key).push(z);
  }

  // ── Phase 3: Calculate each junction box's aggregate demand ─────────────
  // A junction box's "ask" to its city plant = sum of its building zone loads,
  // capped at the junction box's own throughput rating.
  const jbDemand = new Map(); // jbId → watts demanded from city plant
  for (const gen of allGenerators) {
    if (gen.generator_type !== 'junction_box') continue;
    // A faulted/destroyed junction box draws nothing — don't let its dead load
    // consume city-plant capacity that Phase 5 would then discard.
    if (updatedStatus.get(gen.id)?.status === 'offline') { jbDemand.set(gen.id, 0); continue; }
    const jbZones = zonesByGen.get(gen.id) || [];
    const raw = jbZones.reduce((s, z) => s + (z.current_load_kw ?? 0), 0) * loadMultiplier;
    jbDemand.set(gen.id, Math.min(raw, gen.capacity_kw));
  }

  // ── Phase 4: City plant distributes to outdoor zones + junction boxes ────
  const jbAlloc = new Map(); // jbId → watts allocated by city plant
  const cityPlants = allGenerators.filter(g => g.generator_type === 'city_plant');

  for (const cp of cityPlants) {
    const cpSt = updatedStatus.get(cp.id);
    const directZones = zonesByGen.get(cp.id) || [];
    const connectedJBs = allGenerators.filter(g =>
      g.generator_type === 'junction_box' && g.city_generator_id === cp.id
    );

    if (!cpSt || cpSt.status === 'offline' || Number(cpSt.capacity_kw) === 0) {
      // City plant down — kill everything it feeds.
      await query(`UPDATE generators SET remaining_kw=0 WHERE id=$1`, [cp.id]);
      for (const z of directZones) {
        const cap = z.max_capacity_kw ?? 1000;
        await query(`UPDATE power_zones SET status='offline', available_kw=0, capacity_kw=$1 WHERE id=$2`, [cap, z.id]);
        await applyPowerLightEffects(query, z.id, z.status, 'offline', 0, cap);
      }
      for (const jb of connectedJBs) {
        jbAlloc.set(jb.id, 0);
        await query(`UPDATE generators SET remaining_kw=0 WHERE id=$1`, [jb.id]);
      }
      continue;
    }

    // Build a unified consumer list: direct outdoor zones + junction boxes.
    // Shuffle randomly — plant distributes in a different order each tick so
    // brownout load rotates naturally, causing the flicker effect on equipment.
    const consumers = [
      ...directZones.map(z => ({
        kind: 'zone', id: z.id, zone: z,
        demand: (z.current_load_kw ?? 0) * loadMultiplier,
        ceiling: z.max_capacity_kw ?? 1000,
      })),
      ...connectedJBs.map(jb => ({
        kind: 'jb', id: jb.id,
        demand: jbDemand.get(jb.id) ?? 0,
        ceiling: jb.capacity_kw,
      })),
    ];
    for (let i = consumers.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [consumers[i], consumers[j]] = [consumers[j], consumers[i]];
    }

    let pool = cpSt.capacity_kw;
    for (const c of consumers) {
      const ask  = Math.min(c.demand, c.ceiling);
      const alloc = Math.min(ask, Math.max(0, pool));
      pool -= alloc;
      if (c.kind === 'zone') {
        const { zone, demand, ceiling } = c;
        const status = demand === 0 ? 'powered'
          : alloc <= 0 ? 'offline'
          : alloc < demand ? 'overloaded'
          : 'powered';
        await query(`UPDATE power_zones SET status=$1, available_kw=$2, capacity_kw=$3 WHERE id=$4`,
          [status, alloc, ceiling, zone.id]);
        await applyPowerLightEffects(query, zone.id, zone.status, status, alloc, ceiling);
      } else {
        jbAlloc.set(c.id, alloc);
        await query(`UPDATE generators SET remaining_kw=$1 WHERE id=$2`, [alloc, c.id]);
      }
    }
    await query(`UPDATE generators SET remaining_kw=$1 WHERE id=$2`, [Math.max(0, pool), cp.id]);
  }

  // ── Phase 5: Junction boxes distribute their city-plant allocation ───────
  for (const gen of allGenerators) {
    if (gen.generator_type !== 'junction_box') continue;
    const jbSt = updatedStatus.get(gen.id);
    const cityAlloc = jbAlloc.get(gen.id) ?? 0;
    const jbZones = zonesByGen.get(gen.id) || [];
    const jbTotalDemand = jbDemand.get(gen.id) ?? 0;

    // Backup power: portable player generators plugged into this junction box
    // (flags.junction_box_id) that are running with fuel left. Their pooled
    // capacity feeds the building whenever the city plant can't — the outage a
    // player rides out on a generator. A physically destroyed panel can't
    // distribute, so a smashed junction box voids the backup.
    let backupKw = 0;
    if (!gen.flags?.destroyed) {
      for (const pg of allGenerators) {
        if (pg.generator_type !== 'player' || pg.flags?.junction_box_id !== gen.id) continue;
        const pst = updatedStatus.get(pg.id);
        if (pst?.status === 'online' && (pst.fuel_remaining ?? 0) > 0) backupKw += pg.capacity_kw || 0;
      }
    }

    // City feed is down when the JB is offline, or it had demand but the plant
    // gave it nothing. Fall back to plugged-in generator power if there is any.
    const cityDown = !jbSt || jbSt.status === 'offline' || (jbTotalDemand > 0 && cityAlloc <= 0);
    const onBackup = cityDown && backupKw > 0;
    const allocation = cityDown ? backupKw : cityAlloc;

    // Only mark building offline if the JB itself is down, or it had demand but
    // the city plant gave it nothing — and no backup generator is carrying it.
    if (cityDown && !onBackup) {
      for (const z of jbZones) {
        const cap = z.max_capacity_kw ?? 1000;
        await query(`UPDATE power_zones SET status='offline', available_kw=0, capacity_kw=$1 WHERE id=$2`, [cap, z.id]);
        await applyPowerLightEffects(query, z.id, z.status, 'offline', 0, cap);
      }
      if (jbSt) await query(`UPDATE generators SET remaining_kw=0 WHERE id=$1`, [gen.id]);
      continue;
    }

    const sorted = [...jbZones];
    for (let i = sorted.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
    }
    let pool = allocation;
    for (const zone of sorted) {
      const demand  = (zone.current_load_kw ?? 0) * loadMultiplier;
      const ceiling = zone.max_capacity_kw ?? 1000;
      const ask     = Math.min(demand, ceiling);
      const alloc   = Math.min(ask, Math.max(0, pool));
      pool -= alloc;
      const status = demand === 0 ? 'powered'
        : alloc <= 0 ? 'offline'
        : alloc < demand ? 'overloaded'
        : 'powered';
      await query(`UPDATE power_zones SET status=$1, capacity_kw=$2, available_kw=$3 WHERE id=$4`,
        [status, ceiling, alloc, zone.id]);
      await applyPowerLightEffects(query, zone.id, zone.status, status, alloc, ceiling);
    }
    await query(`UPDATE generators SET remaining_kw=$1 WHERE id=$2`, [Math.max(0, pool), gen.id]);
  }

  // ── Phase 6: Orphan zones (no valid generator_id) go offline ────────────
  for (const z of (zonesByGen.get('__orphan__') || [])) {
    const cap = z.max_capacity_kw ?? 1000;
    await query(`UPDATE power_zones SET status='offline', available_kw=0, capacity_kw=$1 WHERE id=$2`, [cap, z.id]);
    await applyPowerLightEffects(query, z.id, z.status, 'offline', 0, cap);
  }

  await reconcileDevicePower(query);
}

// Tracks the last-known operational state of each destructible power device
// (generator / junction box) so we fire a one-shot event — the power-up/down
// sound + flash — only on a transition, never every tick. Operational is keyed
// on the device's own zone power status, which uniformly captures both a smashed
// unit (its generator offlines → zone dark) and an upstream blackout.
const _devicePowerState = new Map(); // furnitureId -> boolean

async function reconcileDevicePower(query) {
  const { rows } = await query(
    `SELECT f.id, f.zone_id, f.name, f.object_type, f.hp,
            COALESCE(pz.status,'offline') AS zone_status
       FROM furniture f
       LEFT JOIN power_zones pz ON pz.id = f.zone_id
      WHERE f.hp_max IS NOT NULL`
  );
  for (const d of rows) {
    const destroyed = (d.hp ?? 1) <= 0;
    const operational = !destroyed && d.zone_status === 'powered';
    const prev = _devicePowerState.get(d.id);
    _devicePowerState.set(d.id, operational);
    if (prev === undefined || prev === operational) continue; // first sight / no change
    emit('device.power.changed', {
      zoneId: d.zone_id, deviceId: d.id, name: d.name,
      deviceType: d.object_type, operational,
    });
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
  const isInterior = !!(zone && (zone.flags?.is_interior || zone.flags?.is_apartment || zone.flags?.is_building));
  const ambientContrib = isInterior ? windowLight : state.ambientLight;

  const effectiveLight = Math.max(ambientContrib, artificial);
  const weatherFactor = WEATHER_VISIBILITY_FACTOR[state.weatherType] ?? 1.0;
  const fogFactor = FOG_FACTOR[state.weatherType] ?? DEFAULT_FOG_FACTOR;
  // Interior zones aren't directly affected by outdoor weather/fog —
  // that attenuation was already applied inside getWindowLightContribution.
  let envFactor = isInterior ? 1.0 : weatherFactor * fogFactor;
  // Outdoor zones under a local cloud/precip cell get extra attenuation so a
  // passing storm dims that tile specifically. Fog/ash/haze stay global.
  const f = isInterior ? null : fieldAt(zoneId);
  if (!isInterior && f) {
    const activePrecip = state.currentPrecip !== 'none' ? f.precipRate : 0;
    const localCloudFactor = clamp01(1 - 0.5 * f.cloudCover - 0.4 * activePrecip);
    envFactor = Math.min(envFactor, localCloudFactor);
  }
  const visibility = clamp01(effectiveLight * envFactor);

  // 8-step light ladder, brightest → darkest. The bright half is finer-grained
  // (blazing/bright/clear) so well-lit zones read with more nuance; the dark
  // half adds gloomy (between dim and dark) and murk (between dark and black).
  // Consumers: describe.js render gating, client HUD LIGHT_CATS, lightview.
  let category;
  if (visibility === 0) category = 'pitch_dark';
  else if (visibility >= 0.90) category = 'blazing';
  else if (visibility >= 0.75) category = 'bright';
  else if (visibility >= 0.60) category = 'clear';
  else if (visibility >= 0.42) category = 'dim';
  else if (visibility >= 0.26) category = 'gloomy';
  else if (visibility >= 0.10) category = 'dark';
  else category = 'murk';

  // Local outdoor weather so the client can drive its immersion overlay the
  // instant a room is entered (the 30s zoneTempTick still keeps it live). Indoor
  // zones report outdoor:false → the client suppresses the effect. Additive keys;
  // existing consumers read only visibility/category.
  const precipActive = !isInterior && state.currentPrecip !== 'none';
  return {
    visibility, category, ambientLight: ambientContrib, artificialLight: artificial, windowLight,
    outdoor: !isInterior,
    weatherType: state.weatherType,
    precipType: precipActive ? state.currentPrecip : 'none',
    precipRate: precipActive && f ? f.precipRate : 0,
    cloudCover: f ? f.cloudCover : 0,
    windKph: state.forecast[0]?.windKph ?? 0,
  };
}

// Ordered light ladder (dimmest → brightest), matching the category thresholds
// in getZoneVisibility. Exposed so a per-player light source (a carried, lit
// flashlight) can raise how bright THIS player perceives a room without
// duplicating the ladder. See plugins/flashlight.
export const LIGHT_LADDER = ['pitch_dark', 'murk', 'dark', 'gloomy', 'dim', 'clear', 'bright', 'blazing'];
// The visibility value at the bottom of each category band (from getZoneVisibility).
const CATEGORY_MIN_VIS = { pitch_dark: 0, murk: 0.05, dark: 0.10, gloomy: 0.26, dim: 0.42, clear: 0.60, bright: 0.75, blazing: 0.90 };

// Return a copy of `vis` raised to at least `floorCategory`. If it's already that
// bright or brighter (or either category is unknown), returns `vis` unchanged.
export function floorVisibility(vis, floorCategory) {
  const cur = LIGHT_LADDER.indexOf(vis.category);
  const tgt = LIGHT_LADDER.indexOf(floorCategory);
  if (cur < 0 || tgt < 0 || tgt <= cur) return vis;
  return { ...vis, category: floorCategory, visibility: Math.max(vis.visibility || 0, CATEGORY_MIN_VIS[floorCategory]) };
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
    windKph: state.forecast[0]?.windKph ?? 0,
    humidityPct: state.forecast[0]?.humidityPct ?? null,
    feelsLikeC: apparentTemperature(state.tempC + diurnalOffset(state.minutes), state.forecast[0]?.windKph ?? 0, state.forecast[0]?.humidityPct ?? null),
    tempC: state.tempC + diurnalOffset(state.minutes),
    tempF: Math.round(((state.tempC + diurnalOffset(state.minutes)) * 9) / 5 + 32),
    timePhase: phase.name,
    timeIcon: phase.icon,
    frozen: state.frozen,
    weatherOverrideActive: state.weatherOverrideActive,
    activeClimateProfileId: state.activeClimateProfileId,
    currentWeatherType: state.currentPrecip !== 'none'
      ? state.currentPrecip
      : (PRECIP_FORECAST_TYPES.has(state.weatherType) ? 'cloudy' : state.weatherType),
    currentWeatherIcon: WEATHER_ICON[state.currentPrecip !== 'none'
      ? state.currentPrecip
      : (PRECIP_FORECAST_TYPES.has(state.weatherType) ? 'cloudy' : state.weatherType)],
    currentIntensity: currentIntensityLabel(),
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

// Setter used by the clothing-wetness plugin to update live precipitation state.
// Separate from the daily forecast weatherType — this changes every 30-min tick.
export function setCurrentPrecip(type, rate) {
  state.currentPrecip = type ?? 'none';
  state.precipRate    = rate ?? 0;
}

// Current global precipitation type ('none' | 'rain' | 'sleet' | 'snow' |
// 'blizzard' | 'thunderstorm'). Carries the full taxonomy (the field only
// distinguishes rain/snow), so the audio layer picks the right ambience loop.
export function getCurrentPrecipType() {
  return state.currentPrecip;
}

// ---------------------------------------------------------------------------
// Per-zone weather field
//
// The weather plugin owns a moving field of cloud/storm cells over the outdoor
// map (map_world). It injects a synchronous sampler here at boot; the engine
// samples it without importing the plugin — mirroring the setWeatherState /
// rollAndSetCurrentPrecip injection style. If no sampler is registered (field
// disabled), every per-zone path below falls back to the global weather.
// ---------------------------------------------------------------------------
let sampleField = null;             // (gridX, gridY) => { cloudCover, precipRate, precipType, tempOffset, stormIntensity, severity }
let weatherFieldSnapshot = null;    // () => { bounds, systems[] } — for the dev map
let advanceWeatherField = null;     // () => void — advect one step

export function registerWeatherField(fn)          { sampleField = fn; }
export function registerWeatherFieldSnapshot(fn)  { weatherFieldSnapshot = fn; }
export function registerWeatherFieldAdvance(fn)   { advanceWeatherField = fn; }

// Sample the field for an outdoor zone. Returns null for interiors / zones off
// the outdoor map / null coords / when the field is disabled → callers fall back
// to the global model.
function fieldAt(zoneId) {
  const z = state.zones.get(zoneId);
  if (!sampleField || !z || z.mapId !== 'map_world') return null;
  return sampleField(z.gridX, z.gridY);
}

// Local precipitation for a zone. The global 30-minute roll stays the map-wide
// "is precip active" gate; the field decides which tiles are actually under it.
export function getZonePrecip(zoneId) {
  const f = fieldAt(zoneId);
  if (!f) return { precipType: state.currentPrecip, precipRate: state.precipRate };
  if (state.currentPrecip === 'none') return { precipType: 'none', precipRate: 0 };
  return {
    precipType: f.precipType === 'none' ? state.currentPrecip : f.precipType,
    precipRate: f.precipRate,
  };
}

// Local storm intensity (0..1) driving lightning frequency/lethality per tile.
// Field disabled / off-map → uniform fallback matching the old global behaviour.
export function getZoneStormIntensity(zoneId) {
  const f = fieldAt(zoneId);
  if (f) return f.stormIntensity;
  return (state.weatherType === 'thunderstorm' || state.weatherType === 'storm') ? 0.5 : 0;
}

// Local extreme-weather severity (0..1) — the scalar the extreme-weather layer
// (thermal/wind/blackout/breathing channels + telegraph) reads per tile. Field
// disabled / off-map → 0 (indoor and non-outdoor zones are never "severe").
// See docs/systems-weather-extreme.md.
export function getZoneSeverity(zoneId) {
  const f = fieldAt(zoneId);
  return f ? f.severity : 0;
}

// Full outdoor-zone weather snapshot for the dev weather map. Queries map_world
// zones directly so it covers every placed zone, not just those in state.zones.
export async function getWeatherMap() {
  const snap = weatherFieldSnapshot ? weatherFieldSnapshot() : { bounds: null, systems: [] };
  const base = state.tempC + diurnalOffset(state.minutes);
  const active = state.currentPrecip !== 'none';
  const baseHum = state.forecast[0]?.humidityPct ?? 60;
  const zones = [];
  if (deps.query) {
    const { rows } = await deps.query(
      `SELECT id, name, grid_x, grid_y FROM zones
       WHERE map_id = 'map_world' AND grid_x IS NOT NULL AND grid_y IS NOT NULL`
    ).catch(() => ({ rows: [] }));
    for (const z of rows) {
      const f = sampleField ? sampleField(z.grid_x, z.grid_y) : null;
      const cloud  = f ? f.cloudCover : 0;
      const precip = (f && active) ? f.precipRate : 0;
      // Day humidity is the floor; tiles under cloud / active precip read damper.
      const localHum = localHumidity(baseHum, cloud, precip);
      zones.push({
        id: z.id, name: z.name, grid_x: z.grid_x, grid_y: z.grid_y,
        tempC: f ? Math.round(base + f.tempOffset) : Math.round(base),
        cloudCover: cloud,
        precipRate: precip,
        precipType: (f && active && f.precipType !== 'none') ? f.precipType : 'none',
        humidityPct: localHum,
        severity: f ? f.severity : 0,
      });
    }
  }
  return { bounds: snap.bounds, systems: snap.systems, zones };
}

// Muffled rain bleed: a tile that isn't directly under a storm cell but sits
// exit-adjacent to one shouldn't go completely silent — it borrows a fainter
// version of the loudest nearby cell, attenuated per hop. Only zones whose own
// local sample is weak bother looking; roofs and other open_sky zones are
// never map_world so they never enter this path — they always get their own
// (unmuffled) sample instead. Walked over the outdoor exit graph the same way
// sounds.js walks zone exits for SFX/yell propagation. Returns the winning
// bleed rate and the hop distance it came from, so the audio layer can spread
// the falloff out (a cell 2 tiles away reads quieter than one 1 tile away).
const MUFFLE_LOCAL_THRESHOLD = 0.12;
const MUFFLE_RADIUS = 2;
const MUFFLE_FALLOFF = 0.45; // per-hop attenuation

function muffledNeighborPrecip(zoneId) {
  const visited = new Set([zoneId]);
  let frontier = [zoneId];
  let best = 0;
  let bestHops = 0;
  for (let hop = 1; hop <= MUFFLE_RADIUS; hop++) {
    const next = [];
    for (const id of frontier) {
      const z = world.zones.get(id);
      if (!z) continue;
      for (const neighborId of neighborZoneIds(z)) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);
        next.push(neighborId);
        const nz = world.zones.get(neighborId);
        if (nz && nz.map_id === 'map_world' && nz.grid_x != null && nz.grid_y != null) {
          const nf = sampleField(nz.grid_x, nz.grid_y);
          if (nf && nf.precipRate > 0) {
            const bleed = nf.precipRate * Math.pow(MUFFLE_FALLOFF, hop);
            if (bleed > best) { best = bleed; bestHops = hop; }
          }
        }
      }
    }
    frontier = next;
  }
  return { rate: best, hops: bestHops };
}

// Broadcast local outdoor weather to player-occupied outdoor zones. Additive to
// the existing environment.zoneTempTick — old clients ignore the extra keys.
// Iterates occupied zones only (via deps.getOccupiedZones) so cost scales with
// active players, not world size.
function broadcastZoneWeather(occupied) {
  const { broadcast } = deps;
  if (!broadcast || !sampleField || !occupied) return;
  const base = state.tempC + diurnalOffset(state.minutes);
  const active = state.currentPrecip !== 'none';
  for (const zoneId of occupied) {
    const z = state.zones.get(zoneId);
    if (!z || z.mapId !== 'map_world') continue;
    const f = sampleField(z.gridX, z.gridY);
    let precipRate = active ? f.precipRate : 0;
    let muffled = false;
    let muffleHops = 0;
    if (active && precipRate < MUFFLE_LOCAL_THRESHOLD) {
      const { rate: bleed, hops } = muffledNeighborPrecip(zoneId);
      if (bleed > precipRate) { precipRate = bleed; muffled = true; muffleHops = hops; }
    }
    broadcast(zoneId, {
      type: 'environment.zoneTempTick',
      tempC: Math.round(base + f.tempOffset),
      cloudCover: f.cloudCover,
      precipType: precipRate > 0 ? state.currentPrecip : 'none',
      precipRate,
      severity: f.severity,
    });
    // Signal the audio layer what weather ambience this tile is under. The audio
    // plugin runs two reactive beds off this: a precip bed (type from the full
    // taxonomy state.currentPrecip, gated + gain-scaled by this tile's local
    // precipRate, further cut if `muffled`) and a wind bed (gain-scaled by the
    // day's windKph).
    emit('weather.zoneAmbience', {
      zoneId,
      precipType: state.currentPrecip,
      active: precipRate > 0,
      precipRate,
      windKph: state.forecast[0]?.windKph ?? 0,
      muffled,
      muffleHops,
    });
  }
}

const WEATHER_DESCRIPTIONS = {
  clear:        ['The sky above is open and clear.', 'A crisp stillness hangs in the air.', 'Pale light cuts through the haze overhead.'],
  cloudy:       ['Broken clouds drift across the sky.', 'Grey-white clouds roll overhead.'],
  overcast:     ['Heavy cloud cover blankets the sky, diffusing what little light reaches the street.', 'The sky is a flat, featureless grey.'],
  rain:         ['Rain falls in a steady drizzle, pooling in the cracks of the pavement.', 'The hiss of rain fills the air.', 'Gutters run with dark water.'],
  sleet:        ['Freezing sleet pelts down, stinging exposed skin.', 'Half-frozen rain rattles against every surface.'],
  thunderstorm: ['Thunder rolls in distant waves overhead.', 'Lightning fractures the sky — a thunderstorm rages.', 'The air smells of ozone. Thunder follows every flicker of lightning.'],
  storm:        ['Wind howls between the buildings, carrying debris.', 'A violent storm tears through the area.', 'The force of the wind makes every step an effort.'],
  snow:         ["Snow falls quietly, softening the city's sharp edges.", 'A thin coat of snow covers everything in sight.', 'Snowflakes spiral down through the amber glow of the streetlights.'],
  blizzard:     ['A blizzard rages, cutting visibility to almost nothing.', 'Snow and wind form a near-solid wall of white.'],
  fog:          ['Thick fog clings to the streets, muffling sound and swallowing distance.', 'Visibility is poor. Shapes dissolve into grey at any distance.'],
  haze:         ['A chemical haze hangs low over the street, yellow-brown and faintly acrid.', 'The air tastes of something industrial. A murky haze obscures the skyline.'],
  ash:          ['Grey ash drifts down from somewhere upwind, coating every surface.', 'A fine layer of ash has settled over everything. The air smells of burning.'],
};

export function getWeatherDescription() {
  if (!state.ready) return null;
  const descs = WEATHER_DESCRIPTIONS[state.weatherType];
  if (!descs?.length) return null;
  return descs[Math.floor(Math.random() * descs.length)];
}

// Returns the effective temperature for a zone. Indoor zones (is_interior /
// is_apartment) return their HVAC-simulated temp; outdoor zones return the
// global outdoor temp with diurnal offset.
export function getZoneTemperature(zoneId) {
  const z = state.zones.get(zoneId);
  if (isIndoorZone(z) && state.zoneTemps.has(zoneId)) {
    return state.zoneTemps.get(zoneId);
  }
  const base = state.tempC + diurnalOffset(state.minutes);
  const f = fieldAt(zoneId);
  return f ? Math.round(base + f.tempOffset) : base;
}

// Prevailing wind speed (kph) for the current day. Global — one figure for the
// whole world, driven by the active forecast. 0 until the forecast is ready.
export function getWindKph() {
  return state.forecast[0]?.windKph ?? 0;
}

// Relative humidity (%) for the current day, or null if unknown. Global, from
// the active forecast. Feeds apparent-temperature and clothing drying.
export function getHumidityPct() {
  return state.forecast[0]?.humidityPct ?? null;
}

// Apparent ("feels like") temperature. Wind chill bites in the cold and rising
// wind; humidity pushes the heat index up when it's hot and makes deep cold
// feel damper. Returns the dry-air temp unchanged when neither applies.
//   tempC       — actual air temperature (°C)
//   windKph     — prevailing wind speed (km/h); 0 indoors/sheltered
//   humidityPct — relative humidity 0–100, or null if unknown
export function apparentTemperature(tempC, windKph = 0, humidityPct = null) {
  let feels = tempC;
  // Wind chill — only meaningful in cold air moving faster than a light breeze.
  if (tempC <= 10 && windKph >= 5) {
    const v = Math.pow(windKph, 0.16);
    feels = 13.12 + 0.6215 * tempC - 11.37 * v + 0.3965 * tempC * v;
  }
  if (humidityPct != null) {
    if (tempC >= 27) {
      // Heat index: muggy heat feels hotter, scaling with how far over 27°C.
      const humidExcess = Math.max(0, Math.min(100, humidityPct) - 40) / 100; // 0..0.6
      feels += (tempC - 27) * humidExcess * 1.2;
    } else if (tempC < 8 && humidityPct > 70) {
      // Damp cold cuts deeper than dry cold.
      feels -= (humidityPct - 70) / 100 * 2;
    }
  }
  return Math.round(feels * 10) / 10;
}

// Per-zone relative humidity formula. The day's humidity is the floor; tiles
// under cloud / active precip read damper. Kept in one place so the feels-like
// calc and the dev weather-map agree.
function localHumidity(baseHum, cloudCover, precipRate) {
  return Math.min(100, Math.round(baseHum + cloudCover * 8 + precipRate * 15));
}

// Relative humidity (%) at a specific zone, folding in its local cloud/precip.
// Falls back to the global day value for zones off the outdoor weather field.
export function getZoneHumidity(zoneId) {
  const base = state.forecast[0]?.humidityPct ?? null;
  if (base == null) return null;
  const f = fieldAt(zoneId);
  if (!f) return base;
  const precip = state.currentPrecip !== 'none' ? f.precipRate : 0;
  return localHumidity(base, f.cloudCover, precip);
}

// Feels-like temperature for a zone: outdoors it folds in the day's wind and
// the zone's local humidity; indoors (and for a sheltered interior) it's just
// the ambient temp. extraOffsetC lets callers add a zone temp_offset flag
// before the wind bites.
export function getZoneApparentTemperature(zoneId, extraOffsetC = 0) {
  const ambient = getZoneTemperature(zoneId) + extraOffsetC;
  const z = state.zones.get(zoneId);
  if (isIndoorZone(z)) return ambient;
  return apparentTemperature(ambient, state.forecast[0]?.windKph ?? 0, getZoneHumidity(zoneId));
}

export function getPowerMap() {
  return [...state.zones.entries()].map(([zoneId, z]) => ({
    zoneId,
    status: z.powerStatus,
    capacityKw: z.capacityKw,
    loadKw: z.loadKw,
    availableKw: z.availableKw,
    maxCapacityKw: z.maxCapacityKw,
    artificialLight: z.artificialLight,
    generatorId: z.generatorId,
    generatorType: z.generatorType,
  }));
}

// Current in-world date/time, formatted the same way the lightning-kill log
// stamps its entries. Used by the deaths plugin to timestamp deaths in-fiction.
export function getGameDateTime() {
  return { date: state.date, time: formatHHMM(state.minutes) };
}

export function getEnvironmentState() {
  return { ...getHUDPayload(), minutes: state.minutes, hour: Math.floor(state.minutes / 60), ambientLight: state.ambientLight, forecast: getForecast(), powerMap: getPowerMap(), precipRate: state.precipRate, currentPrecip: state.currentPrecip, lightningKills: state.lightningKills };
}

// Records a player killed by storm lightning (not smite). Appends
// { handle, date, time } stamped with the current in-game date/time and
// persists the log to world_clock so it survives restarts.
export async function recordLightningKill(handle) {
  const entry = { handle, date: state.date, time: formatHHMM(state.minutes) };
  state.lightningKills.push(entry);
  if (deps.query) {
    await deps.query(`UPDATE world_clock SET lightning_kills = $1 WHERE id = 1`,
      [JSON.stringify(state.lightningKills)]).catch(logError);
  }
  return entry;
}

// ---------------------------------------------------------------------------
// Dev Tools (called from server/api/environment.routes.js)
// ---------------------------------------------------------------------------

export async function devSetTime({ date, minutes }) {
  const { query, broadcast } = deps;
  if (date) state.date = date;
  if (minutes !== undefined) state.minutes = ((Number(minutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  // Re-anchor so the elapsed-based tick continues 1:1 from the newly set time
  // rather than jumping forward by the gap since the last real tick.
  state.lastTick1m = Date.now();
  state.dayOfWeek = dayOfWeekFor(state.date);
  recalcAmbientAndVisibility();
  await query(
    `UPDATE world_clock SET game_date = $1, game_time_minutes = $2, day_of_week = $3 WHERE id = 1`,
    [state.date, state.minutes, state.dayOfWeek]
  );
  if (await syncStreetlights().catch(() => false)) await recomputePower().catch(() => {});
  const payload = getHUDPayload();
  if (broadcast) broadcast({ type: 'environment.sync', ...payload });
  // A manual clock jump can move NPCs on or off shift — let the game loop force
  // an immediate work re-check rather than waiting for the next wander tick
  // (and, for a sleeping NPC, until its scheduled wake).
  emit('environment.timeSet', { minutes: state.minutes, date: state.date, phase: state.phase });
  return payload;
}

export async function devAdvanceTime(minutesToAdd) {
  return devSetTime({ minutes: state.minutes + Number(minutesToAdd || 0) });
}

export function devFreeze(frozen) {
  const wasFrozen = state.frozen;
  state.frozen = !!frozen;
  // Re-anchor on unfreeze so the paused span isn't counted as elapsed real time
  // by the next tick (which would snap the clock forward). Freeze stays a true
  // pause; the elapsed-based tick simply resumes from now.
  if (wasFrozen && !state.frozen) state.lastTick1m = Date.now();
  return { frozen: state.frozen };
}

export async function devForceTick5()  { await tick5m();  return getHUDPayload(); }
export async function devForceTick30() { await tick30m(); return getHUDPayload(); }
export async function devForceTick24() { await tick24h(); return { ...getHUDPayload(), forecast: state.forecast }; }

export async function devGetClimateProfiles() {
  const { rows } = await deps.query('SELECT * FROM climate_profiles ORDER BY name ASC');
  return rows.map(r => ({ id: r.id, name: r.name, monthly_temp_c: r.monthly_temp_c, monthly_precip_chance: r.monthly_precip_chance, monthly_wind_kph: r.monthly_wind_kph, monthly_humidity: r.monthly_humidity }));
}

export async function devSaveClimateProfile({ id, name, monthly_temp_c, monthly_precip_chance, monthly_wind_kph, monthly_humidity }) {
  const { query } = deps;
  if (!id) id = `climate_${Date.now()}`;
  if (!name) throw new Error('Profile name required');
  await query(
    `INSERT INTO climate_profiles (id, name, monthly_temp_c, monthly_precip_chance, monthly_wind_kph, monthly_humidity)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET name = $2, monthly_temp_c = $3, monthly_precip_chance = $4, monthly_wind_kph = $5, monthly_humidity = $6`,
    [id, name, JSON.stringify(monthly_temp_c), JSON.stringify(monthly_precip_chance), JSON.stringify(monthly_wind_kph ?? []), JSON.stringify(monthly_humidity ?? [])]
  );
  return { id, name, monthly_temp_c, monthly_precip_chance, monthly_wind_kph, monthly_humidity };
}

export async function devDeleteClimateProfile(id) {
  await deps.query('DELETE FROM climate_profiles WHERE id = $1', [id]);
  if (state.activeClimateProfileId === id) {
    state.activeClimateProfileId = null;
    state.activeClimateProfile = null;
    await deps.query('UPDATE world_clock SET active_climate_profile_id = NULL WHERE id = 1');
  }
  return { ok: true };
}

export async function devSetActiveClimate(id) {
  const { query } = deps;
  if (!id) {
    state.activeClimateProfileId = null;
    state.activeClimateProfile = null;
    await query('UPDATE world_clock SET active_climate_profile_id = NULL WHERE id = 1');
    return { activeClimateProfileId: null };
  }
  const { rows } = await query('SELECT * FROM climate_profiles WHERE id = $1', [id]);
  if (!rows[0]) throw new Error('Climate profile not found');
  state.activeClimateProfileId = id;
  state.activeClimateProfile = { monthly_temp_c: rows[0].monthly_temp_c, monthly_precip_chance: rows[0].monthly_precip_chance, monthly_wind_kph: rows[0].monthly_wind_kph, monthly_humidity: rows[0].monthly_humidity };
  await query('UPDATE world_clock SET active_climate_profile_id = $1 WHERE id = 1', [id]);
  return { activeClimateProfileId: id };
}

export async function devRecalculateForecast({ monthly_temp_c, monthly_precip_chance, monthly_wind_kph, monthly_humidity } = {}) {
  const { emitHook, broadcast } = deps;
  const climateProfile = (monthly_temp_c && monthly_precip_chance)
    ? { monthly_temp_c, monthly_precip_chance, monthly_wind_kph, monthly_humidity }
    : state.activeClimateProfile;
  if (emitHook) await emitHook('environment.recalculateForecast', { setWeatherState, climateProfile, currentDate: state.date });
  // Re-roll current precip against the newly forecasted precipChance.
  rollAndSetCurrentPrecip(state.weatherType, state.tempC + diurnalOffset(state.minutes), state.forecast[0]?.precipChance ?? 0.05);
  const payload = { ...getHUDPayload(), forecast: getForecast() };
  if (broadcast) broadcast({ type: 'environment.sync', ...payload });
  return payload;
}

export async function devOverrideWeather({ weatherType, tempC, precipChance }) {
  const { query, broadcast, emitHook } = deps;
  if (!WEATHER_TYPES.includes(weatherType)) throw new Error(`Unknown weather type: ${weatherType}`);
  if (!state.weatherOverrideActive) {
    state.weatherOverrideBackup = { weatherType: state.weatherType, tempC: state.tempC, precipChance: state.forecast[0]?.precipChance ?? 0.05 };
  }
  state.weatherOverrideActive = true;
  state.weatherType = weatherType;
  // tempC from the client is already offset-adjusted (getHUDPayload adds diurnalOffset).
  // Strip the offset before storing so the base value stays stable across applies.
  if (tempC !== undefined) state.tempC = Number(tempC) - diurnalOffset(state.minutes);
  await query(`UPDATE weather_forecast SET weather_type = $1, temp_c = $2 WHERE forecast_day = 0`, [weatherType, state.tempC]);
  await query(`UPDATE world_clock SET weather_override_active = TRUE, weather_override_backup = $1 WHERE id = 1`,
    [JSON.stringify(state.weatherOverrideBackup)]);
  state.forecast[0] = { ...state.forecast[0], weatherType, tempC: state.tempC, ...(precipChance !== undefined ? { precipChance: Number(precipChance) } : {}) };
  // Roll current precip against the new precipChance, replacing whatever was active.
  rollAndSetCurrentPrecip(weatherType, state.tempC + diurnalOffset(state.minutes), Number(precipChance ?? state.forecast[0]?.precipChance ?? 0.05));
  // Re-seed the moving field to match the forced weather/intensity.
  if (emitHook) await emitHook('environment.weatherFieldSync', { forecast0: state.forecast[0] });
  if (await syncStreetlights().catch(() => false)) await recomputePower().catch(() => {});
  if (broadcast) broadcast({ type: 'environment.weatherOverride', ...getHUDPayload() });
  return getHUDPayload();
}

export async function devClearWeatherOverride() {
  const { query, broadcast, emitHook } = deps;
  if (!state.weatherOverrideActive) return getHUDPayload();
  state.weatherOverrideActive = false;
  state.weatherOverrideBackup = null;
  await query(`UPDATE world_clock SET weather_override_active = FALSE, weather_override_backup = NULL WHERE id = 1`);
  // Recalculate forecast so state reflects real forecast values (not the backed-up override values).
  // (The recalculateForecast hook also re-seeds the weather field.)
  if (emitHook) await emitHook('environment.recalculateForecast', { setWeatherState, climateProfile: state.activeClimateProfile, currentDate: state.date });
  rollAndSetCurrentPrecip(state.weatherType, state.tempC + diurnalOffset(state.minutes), state.forecast[0]?.precipChance ?? 0.05);
  if (await syncStreetlights().catch(() => false)) await recomputePower().catch(() => {});
  const payload = { ...getHUDPayload(), forecast: getForecast() };
  if (broadcast) broadcast({ type: 'environment.sync', ...payload });
  return payload;
}

// Edits a single upcoming forecast day (1-6) directly — schedules an extreme
// weather event ahead of time instead of forcing "now" like devOverrideWeather.
// Day 0 (today) isn't valid here since that's what the override already owns.
export async function devScheduleForecastDay({ forecastDay, weatherType, tempC, windKph, humidityPct }) {
  const { broadcast, emitHook } = deps;
  const day = Number(forecastDay);
  if (!Number.isInteger(day) || day < 1 || day > 6) throw new Error('forecastDay must be 1-6 — use weather/override to force today (day 0)');
  if (weatherType !== undefined && !WEATHER_TYPES.includes(weatherType)) throw new Error(`Unknown weather type: ${weatherType}`);
  if (!emitHook) throw new Error('Weather plugin not loaded');
  await emitHook('environment.scheduleForecastDay', { forecastDay: day, weatherType, tempC, windKph, humidityPct, setWeatherState, currentForecast: state.forecast });
  const payload = { ...getHUDPayload(), forecast: getForecast() };
  if (broadcast) broadcast({ type: 'environment.sync', ...payload });
  return payload;
}

// precipChance: 1.0 forces the roll so the trigger actually precipitates — otherwise
// it sets the weather type but rolls precip at the ambient (~5%) chance, so the sky
// says "snow" while nothing falls and the client weather-FX overlay stays empty.
export async function devTriggerStorm() { return devOverrideWeather({ weatherType: 'storm', precipChance: 1.0 }); }
export async function devTriggerSnow() { return devOverrideWeather({ weatherType: 'snow', precipChance: 1.0 }); }

export async function devMaxStorm() {
  const { broadcast } = deps;
  // Override to thunderstorm at current temp, then force precipRate to maximum.
  await devOverrideWeather({ weatherType: 'thunderstorm', tempC: state.tempC + diurnalOffset(state.minutes), precipChance: 1.0 });
  setCurrentPrecip('rain', 1.0);
  if (broadcast) broadcast({ type: 'environment.weatherOverride', ...getHUDPayload() });
  return getHUDPayload();
}

export function devResetBuildingTemps() {
  let count = 0;
  for (const [zoneId, z] of state.zones) {
    if (isIndoorZone(z)) {
      state.zoneTemps.set(zoneId, 20);
      count++;
    }
  }
  return { reset: count };
}

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
    const neighbors = new Set(neighborZoneIds(zone));
    for (const other of allZones) {
      if (neighborZoneIds(other).includes(id)) neighbors.add(other.id);
    }
    for (const nId of neighbors) {
      if (visited.has(nId)) continue;
      const neighbor = byId.get(nId);
      if (isInterior(neighbor)) {
        visited.add(nId);
        queue.push(nId);
      }
    }
  }
  return [...visited];
}

export async function installGenerator({ zoneId, generatorType = 'junction_box', capacityKw, name, cityGeneratorId }) {
  const { query } = deps;
  if (!zoneId) throw new Error('zoneId is required');
  const { rows: zoneRows } = await query('SELECT * FROM zones WHERE id=$1', [zoneId]);
  if (!zoneRows.length) throw new Error(`Zone ${zoneId} does not exist`);
  const zone = zoneRows[0];

  const id = `gen_${zoneId}_${Date.now()}`;
  // city_plant: 10 000 W. junction_box: 5 000 W default throughput (enough
  // for a multi-room building with several lights).
  const capacity = Number(capacityKw) || (generatorType === 'city_plant' ? 10000 : 5000);
  const genName = name || (generatorType === 'city_plant' ? 'City Power Plant' : `${zone.name} Junction Box`);

  // Auto-assign nearest city plant for junction boxes if not specified.
  let cityGenId = cityGeneratorId || null;
  if (generatorType === 'junction_box' && !cityGenId) {
    const { rows: cpRows } = await query(`
      SELECT g.id, z.grid_x, z.grid_y FROM generators g
      LEFT JOIN zones z ON z.id = g.zone_id
      WHERE g.generator_type = 'city_plant'
    `);
    let nearest = null, minDist = Infinity;
    for (const cp of cpRows) {
      if (zone.grid_x != null && cp.grid_x != null) {
        const d = Math.hypot(zone.grid_x - cp.grid_x, zone.grid_y - cp.grid_y);
        if (d < minDist) { minDist = d; nearest = cp; }
      } else if (!nearest) nearest = cp;
    }
    cityGenId = nearest?.id || null;
  }

  await query(
    `INSERT INTO generators (id, zone_id, name, generator_type, capacity_kw, fuel_type, fuel_remaining, fuel_burn_rate, connection_range, status, city_generator_id)
     VALUES ($1,$2,$3,$4,$5,NULL,0,0,0,'online',$6)`,
    [id, zoneId, genName, generatorType, capacity, cityGenId]
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
      [zid, zName, generatorType === 'city_plant' ? 'city_grid' : 'junction_box', id, capacity]
    );
    const { rows: fixtureRows } = await query(`SELECT COUNT(*)::int AS cnt, COALESCE(SUM(COALESCE(lumen_output,0)),0)::int AS lm FROM furniture WHERE zone_id=$1 AND object_type='light'`, [zid]);
    await query(
      `INSERT INTO lighting_states (zone_id, has_emergency_lighting, artificial_light_level, fixture_count, total_lumens)
       VALUES ($1,0,0,$2,$3)
       ON CONFLICT (zone_id) DO UPDATE SET fixture_count=$2, total_lumens=$3`,
      [zid, fixtureRows[0]?.cnt || 0, fixtureRows[0]?.lm || 0]
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
        const newExits = {};
        for (const { dir, target } of allExits(p)) {
          if (target !== zoneId) addExit(newExits, dir, target);
        }
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
    LEFT JOIN zones z ON z.id = g.zone_id
    WHERE g.generator_type = 'city_plant' AND g.status = 'online'
  `);
  if (!cityGens.length) throw new Error('No online city plant generators found');

  const { rows: unpowered } = await query(`
    SELECT z.id, z.name, z.grid_x, z.grid_y FROM zones z
    WHERE NOT COALESCE((z.flags->>'is_apartment')::boolean, false)
      AND NOT COALESCE((z.flags->>'is_interior')::boolean, false)
      AND z.id NOT IN (
        SELECT pz.id FROM power_zones pz
        WHERE pz.generator_id IS NOT NULL
          AND pz.generator_id IN (SELECT id FROM generators)
      )
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
      `INSERT INTO power_zones (id, name, source_type, generator_id, capacity_kw, current_load_kw, status, max_capacity_kw)
       VALUES ($1, $2, 'city_grid', $3, $4, 0, 'powered', $4)
       ON CONFLICT (id) DO UPDATE SET source_type='city_grid', generator_id=$3, capacity_kw=$4, max_capacity_kw=$4`,
      [zone.id, zone.name, nearest.id, nearest.capacity_kw]
    );
    const { rows: ls } = await query(`SELECT COUNT(*)::int AS cnt, COALESCE(SUM(COALESCE(lumen_output,0)),0)::int AS lm FROM furniture WHERE zone_id=$1 AND object_type='light'`, [zone.id]);
    await query(
      `INSERT INTO lighting_states (zone_id, has_emergency_lighting, artificial_light_level, fixture_count, total_lumens)
       VALUES ($1, 0, 0, $2, $3) ON CONFLICT (zone_id) DO UPDATE SET fixture_count=$2, total_lumens=$3`,
      [zone.id, ls[0]?.cnt || 0, ls[0]?.lm || 0]
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
      `SELECT id, name, capacity_kw FROM generators WHERE zone_id = ANY($1::text[]) AND generator_type = 'junction_box'`,
      [network]
    );

    // A network that houses the city plant itself (e.g. Coldwater's turbine hall)
    // is powered at the source — it never needs its own junction box.
    const { rows: cityPlantHere } = await query(
      `SELECT 1 FROM generators WHERE zone_id = ANY($1::text[]) AND generator_type = 'city_plant' LIMIT 1`,
      [network]
    );
    if (cityPlantHere.length) continue;

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
      for (const zid of toFix) {
        const { rows: zRows } = await query('SELECT name FROM zones WHERE id=$1', [zid]);
        const zName = zRows[0]?.name || zid;
        await query(
          `INSERT INTO power_zones (id, name, source_type, generator_id, capacity_kw, current_load_kw, status)
           VALUES ($1, $2, 'building_generator', $3, $4, 0, 'powered')
           ON CONFLICT (id) DO UPDATE SET source_type='building_generator', generator_id=$3, capacity_kw=$4`,
          [zid, zName, gen.id, gen.capacity_kw]
        );
      }
      // Always sync lighting_states for every zone in the network.
      for (const zid of network) {
        const { rows: ls } = await query(`SELECT COUNT(*)::int AS cnt, COALESCE(SUM(COALESCE(lumen_output,0)),0)::int AS lm FROM furniture WHERE zone_id=$1 AND object_type='light'`, [zid]);
        await query(
          `INSERT INTO lighting_states (zone_id, has_emergency_lighting, artificial_light_level, fixture_count, total_lumens)
           VALUES ($1, 0, 0, $2, $3) ON CONFLICT (zone_id) DO UPDATE SET fixture_count=$2, total_lumens=$3`,
          [zid, ls[0]?.cnt || 0, ls[0]?.lm || 0]
        );
      }
      if (toFix.length > 0) results.connected.push({ buildingName, generatorName: gen.name, zonesCount: toFix.length });
    }
  }

  // Auto-assign city_generator_id to any junction box that lacks one.
  const { rows: cityGens } = await query(`
    SELECT g.id, z.grid_x, z.grid_y FROM generators g
    LEFT JOIN zones z ON z.id = g.zone_id
    WHERE g.generator_type = 'city_plant'
  `);
  const { rows: unlinkedJBs } = await query(`
    SELECT g.id, g.zone_id, z.grid_x, z.grid_y FROM generators g
    LEFT JOIN zones z ON z.id = g.zone_id
    WHERE g.generator_type = 'junction_box' AND g.city_generator_id IS NULL
  `);
  for (const jb of unlinkedJBs) {
    let nearest = null, minDist = Infinity;
    for (const cp of cityGens) {
      if (jb.grid_x != null && cp.grid_x != null) {
        const d = Math.hypot(jb.grid_x - cp.grid_x, jb.grid_y - cp.grid_y);
        if (d < minDist) { minDist = d; nearest = cp; }
      } else if (!nearest) nearest = cp;
    }
    if (!nearest) continue;
    await query(`UPDATE generators SET city_generator_id=$1 WHERE id=$2`, [nearest.id, jb.id]);
    results.connected.push({ buildingName: jb.id, generatorName: `linked to city plant ${nearest.id}`, zonesCount: 0 });
  }

  if (results.connected.length) await recomputePower();
  return results;
}

export async function toggleGeneratorStatus(generatorId) {
  const { query } = deps;
  const { rows } = await query(`SELECT capacity_kw, flags FROM generators WHERE id=$1`, [generatorId]);
  if (!rows.length) throw new Error(`Generator ${generatorId} not found`);
  const { capacity_kw, flags } = rows[0];
  const f = flags || {};
  let newCapacity, newFlags;
  if (capacity_kw > 0) {
    // Turn off: zero out capacity, save original so toggle-on can restore it.
    newCapacity = 0;
    newFlags = { ...f, saved_capacity_kw: capacity_kw };
  } else {
    // Turn on: restore saved capacity (fall back to 3000 if no saved value).
    newCapacity = f.saved_capacity_kw ?? 3000;
    newFlags = { ...f };
    delete newFlags.saved_capacity_kw;
  }
  await query(`UPDATE generators SET capacity_kw=$1, flags=$2::jsonb WHERE id=$3`, [newCapacity, JSON.stringify(newFlags), generatorId]);
  await recomputePower();
  return { id: generatorId, capacity_kw: newCapacity, isOn: newCapacity > 0 };
}

export async function setGeneratorCapacity(generatorId, capacityKw, name) {
  const { query } = deps;
  const kw = Math.max(0, Number(capacityKw) || 0);
  const { rowCount } = await query(
    `UPDATE generators SET capacity_kw = $1${name ? ', name = $3' : ''} WHERE id = $2`,
    name ? [kw, generatorId, name] : [kw, generatorId]
  );
  if (!rowCount) throw new Error(`Generator ${generatorId} not found`);
  await recomputePower();
  return (await getGeneratorsList()).find(g => g.id === generatorId);
}

export async function getGeneratorsList() {
  const { query } = deps;
  const { rows } = await query(`
    SELECT g.*, z.name as zone_name,
      CASE
        WHEN g.generator_type = 'city_plant' AND COALESCE((z.flags->>'is_interior')::boolean, false)
          THEN COALESCE(z.parent_zone, z.flags->>'world_exit_zone', g.zone_id)
        ELSE g.zone_id
      END AS map_zone_id,
      COALESCE((
        SELECT SUM(pz.current_load_kw) FROM power_zones pz WHERE pz.generator_id = g.id
      ), 0) AS zone_load_w,
      COALESCE((
        SELECT SUM(pz.available_kw) FROM power_zones pz WHERE pz.generator_id = g.id
      ), 0) AS zone_supply_w,
      COALESCE((
        SELECT SUM(pz.current_load_kw) FROM power_zones pz WHERE pz.generator_id = g.id
      ), 0) + COALESCE((
        SELECT SUM(pz2.current_load_kw)
        FROM generators jb JOIN power_zones pz2 ON pz2.generator_id = jb.id
        WHERE jb.city_generator_id = g.id AND jb.generator_type = 'junction_box'
      ), 0) AS total_demand_w
    FROM generators g LEFT JOIN zones z ON z.id = g.zone_id
    ORDER BY g.generator_type, g.id
  `);
  return rows;
}

export async function getCityGenerators() {
  const { query } = deps;
  const { rows } = await query(`
    SELECT g.id, g.name, g.capacity_kw, g.status, z.name as zone_name
    FROM generators g LEFT JOIN zones z ON z.id = g.zone_id
    WHERE g.generator_type = 'city_plant'
    ORDER BY g.id
  `);
  return rows;
}

export async function setJunctionBoxCityGenerator(jbId, cityGenId) {
  const { query } = deps;
  const { rows } = await query(
    `UPDATE generators SET city_generator_id=$1 WHERE id=$2 AND generator_type='junction_box' RETURNING *`,
    [cityGenId || null, jbId]
  );
  if (!rows.length) throw new Error('Junction box not found');
  return rows[0];
}

export async function getGeneratorZones(generatorId) {
  const { query } = deps;
  const { rows: genRows } = await query('SELECT * FROM generators WHERE id=$1', [generatorId]);
  if (!genRows.length) throw new Error('Generator not found');
  const { rows } = await query(`
    SELECT pz.id, pz.status, pz.capacity_kw, pz.current_load_kw, pz.available_kw,
           pz.max_capacity_kw, z.name, z.grid_x, z.grid_y,
           COALESCE((z.flags->>'is_interior')::boolean, false) AS is_interior,
           COALESCE((z.flags->>'is_apartment')::boolean, false) AS is_apartment
    FROM power_zones pz
    LEFT JOIN zones z ON z.id = pz.id
    WHERE pz.generator_id = $1
    ORDER BY z.name
  `, [generatorId]);
  return { generator: genRows[0], zones: rows };
}

// Sums intended demand for a zone and writes it to power_zones.current_load_kw.
// Demand = COALESCE(light_on_intended, light_on) for non-streetlights (stable
// through supply interruptions), plus streetlight draw when dark. Call this
// whenever a light or device is toggled so the power sim has fresh demand data.
export async function recalcZoneLoad(queryFn, zoneId) {
  const isDark = state.phase === 'night' || state.phase === 'dusk';
  const { rows } = await queryFn(`
    SELECT COALESCE(SUM(
      CASE
        WHEN power_draw_kw IS NOT NULL THEN power_draw_kw
        WHEN light_type = 'overhead'    THEN ${DRAW_OVERHEAD_W}
        WHEN light_type = 'streetlight' THEN ${DRAW_STREETLIGHT_W}
        WHEN light_type = 'lamp'        THEN ${DRAW_LAMP_W}
        ELSE ${DRAW_DEFAULT_W}
      END
    ), 0) AS total_load
    FROM furniture
    WHERE zone_id = $1 AND (
      (object_type = 'light' AND COALESCE(light_on_intended, light_on) = 1 AND light_type != 'streetlight') OR
      (object_type = 'light' AND light_type = 'streetlight' AND $2) OR
      (object_type != 'light' AND power_draw_kw > 0)
    )
  `, [zoneId, isDark]);
  const load = rows[0]?.total_load ?? 0;
  await queryFn(`UPDATE power_zones SET current_load_kw = $1 WHERE id = $2`, [load, zoneId]);
  return load;
}

export async function assignZoneToJunctionBox(zoneId, generatorId) {
  const { query } = deps;
  const { rows: genRows } = await query(`SELECT id, name, capacity_kw FROM generators WHERE id=$1 AND generator_type='junction_box'`, [generatorId]);
  if (!genRows.length) throw new Error('Junction box not found');
  const gen = genRows[0];
  const { rows: zRows } = await query('SELECT name FROM zones WHERE id=$1', [zoneId]);
  if (!zRows.length) throw new Error('Zone not found');
  await query(
    `INSERT INTO power_zones (id, name, source_type, generator_id, capacity_kw, current_load_kw, status)
     VALUES ($1, $2, 'building_generator', $3, $4, 0, 'powered')
     ON CONFLICT (id) DO UPDATE SET source_type='building_generator', generator_id=$3, capacity_kw=$4`,
    [zoneId, zRows[0].name, gen.id, gen.capacity_kw]
  );
  const { rows: ls } = await query(`SELECT COUNT(*)::int AS cnt, COALESCE(SUM(COALESCE(lumen_output,0)),0)::int AS lm FROM furniture WHERE zone_id=$1 AND object_type='light'`, [zoneId]);
  await query(
    `INSERT INTO lighting_states (zone_id, has_emergency_lighting, artificial_light_level, fixture_count, total_lumens)
     VALUES ($1, 0, 0, $2, $3) ON CONFLICT (zone_id) DO UPDATE SET fixture_count=$2, total_lumens=$3`,
    [zoneId, ls[0]?.cnt || 0, ls[0]?.lm || 0]
  );
  await recomputePower();
  return { zoneId, generatorId: gen.id, generatorName: gen.name };
}

export async function reassignZoneGenerator(zoneId, generatorId) {
  const { query } = deps;
  const { rows: genRows } = await query('SELECT id, name, capacity_kw FROM generators WHERE id=$1', [generatorId]);
  if (!genRows.length) throw new Error('Generator not found');
  const gen = genRows[0];
  await query(
    `UPDATE power_zones SET generator_id=$1, source_type='city_grid', capacity_kw=$2 WHERE id=$3`,
    [gen.id, gen.capacity_kw, zoneId]
  );
  await recomputePower();
  return { zoneId, generatorId: gen.id, generatorName: gen.name };
}

export async function getZonePowerInfo(zoneId) {
  const { query } = deps;
  const { rows } = await query(`
    SELECT pz.status, pz.capacity_kw, pz.available_kw, pz.max_capacity_kw,
           pz.current_load_kw, pz.generator_id,
           g.name AS generator_name, g.generator_type, g.capacity_kw AS gen_capacity_kw, g.status AS gen_status
    FROM power_zones pz
    LEFT JOIN generators g ON g.id = pz.generator_id
    WHERE pz.id = $1
  `, [zoneId]);
  return rows[0] || null;
}

export async function setZoneMaxCapacity(zoneId, maxCapacityKw) {
  const { query } = deps;
  const kw = Math.max(0, Number(maxCapacityKw) || 50);
  const { rowCount } = await query(
    `UPDATE power_zones SET max_capacity_kw = $1 WHERE id = $2`,
    [kw, zoneId]
  );
  if (!rowCount) throw new Error(`Zone ${zoneId} not found in power_zones`);
  await recomputePower();
  return getPowerMap().find(z => z.zoneId === zoneId);
}

// Resyncs lighting_states.total_lumens for every zone from its actual furniture.
// Fixes zones (e.g. studio interiors) where lighting_states was never populated
// or went stale. Safe to call at any time — all updates are upserts.
export async function resyncAllLightingStates() {
  const { query } = deps;
  const { rows: zones } = await query(`SELECT DISTINCT zone_id FROM furniture WHERE object_type='light'`);
  let fixed = 0;
  for (const { zone_id } of zones) {
    const { rows: lc } = await query(
      `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(CASE WHEN light_on=1 THEN COALESCE(lumen_output,0) ELSE 0 END),0)::int AS lm
         FROM furniture WHERE zone_id=$1 AND object_type='light'`, [zone_id]
    );
    await query(
      `INSERT INTO lighting_states (zone_id,has_emergency_lighting,artificial_light_level,fixture_count,total_lumens)
       VALUES ($1,0,0,$2,$3) ON CONFLICT (zone_id) DO UPDATE SET fixture_count=$2, total_lumens=$3`,
      [zone_id, lc[0]?.cnt || 0, lc[0]?.lm || 0]
    );
    fixed++;
  }
  await recomputePower();
  return { fixed };
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

// Ghost-mode sabotage: force a zone fully offline right now. Zeroes its supply
// and load, cuts the lights via the standard blackout path (which broadcasts a
// zone_event with refresh:true, so clients re-look and the visibility filter
// fades to darkness), then reloads in-memory power state so getZoneVisibility()
// drops immediately. Returns { ok, prevStatus }; ok:false when the zone has no
// power_zones row to drain.
export async function drainZonePower(zoneId) {
  const { query } = deps;
  const { rows } = await query('SELECT status, max_capacity_kw FROM power_zones WHERE id=$1', [zoneId]);
  if (!rows.length) return { ok: false };
  const prevStatus = rows[0].status;
  const cap = rows[0].max_capacity_kw ?? 0;
  await query(`UPDATE power_zones SET status='offline', available_kw=0, current_load_kw=0 WHERE id=$1`, [zoneId]);
  // silent: the generic "lights cut out" line is suppressed so the ghost layer
  // can broadcast its own dramatic, sourceless blackout emote (with refresh) instead.
  await applyPowerLightEffects(query, zoneId, prevStatus, 'offline', 0, cap, { silent: true });
  await loadZonePowerAndLighting(query);
  return { ok: true, prevStatus };
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
