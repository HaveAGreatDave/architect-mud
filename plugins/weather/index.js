/**
 * Weather plugin — owns the 7-day deterministic forecast.
 *
 * Subscribes to hooks from environment.js:
 *   environment.init             — load (or generate) forecast at boot
 *   environment.advanceWeather   — shift forecast forward one day (tick24h)
 *   environment.recalculateForecast — full regeneration from climate profile
 */
import { createHash } from 'node:crypto';
import { query } from '../../server/models/db.js';

const SEASON_BY_MONTH = [
  'winter', 'winter', 'spring', 'spring', 'spring', 'summer',
  'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter',
];

const SEASON_BASE_TEMP_C  = { winter: 2,    spring: 12, summer: 24, autumn: 11 };
const SEASON_BASE_PRECIP  = { winter: 0.35, spring: 0.40, summer: 0.35, autumn: 0.45 };
// Prevailing wind runs higher in the cold, unsettled seasons and drops in summer.
const SEASON_BASE_WIND_KPH = { winter: 22, spring: 18, summer: 13, autumn: 20 };
// Damp air pools in the cold seasons; summer runs drier by default.
const SEASON_BASE_HUMIDITY = { winter: 82, spring: 70, summer: 58, autumn: 78 };

// How each weather type scales the day's wind. Fog and haze only form in near-still
// air, so they pull wind right down; storms and blizzards are wind events by nature.
const WIND_BY_WEATHER = {
  clear: 0.7, fog: 0.25, haze: 0.4, cloudy: 1.0, overcast: 1.1,
  rain: 1.2, sleet: 1.25, snow: 1.0, thunderstorm: 1.9, blizzard: 2.0, storm: 2.0,
};

function seedFromString(str) {
  const hash = createHash('sha256').update(str).digest();
  return hash.readUInt32LE(0);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rand, arr) {
  return arr[Math.floor(rand() * arr.length) % arr.length];
}

function seasonForDate(dateStr) {
  const month = Number(dateStr.slice(5, 7)) - 1;
  return SEASON_BY_MONTH[month];
}

// Turn a climate/season baseline into a concrete day's wind. The weather type sets
// the ceiling (a foggy day can't be a gale); on top of that we roll the day's
// "windiness": most days sit near the mean, but ~15% come out dead calm and ~15%
// blow up into a gusty day. Deterministic — driven by the shared rand stream.
function windForDay(baseWind, weatherType, rand) {
  const typeMult = WIND_BY_WEATHER[weatherType] ?? 1.0;
  const r = rand();
  let dayMult;
  if (r < 0.15)      dayMult = 0.3 + rand() * 0.3;   // calm day
  else if (r > 0.85) dayMult = 1.4 + rand() * 0.8;   // windy / gusty day
  else               dayMult = 0.7 + rand() * 0.7;   // ordinary day
  return Math.max(0, Math.round(baseWind * typeMult * dayMult));
}

// Turn a climate/season baseline into a concrete day's relative humidity. The
// weather type drives it hard: fog and rain mean saturated air, clear skies dry
// it out. Small day-to-day jitter on top. Deterministic via the shared stream.
function humidityForDay(baseHumidity, weatherType, rand) {
  let h = baseHumidity;
  if (weatherType === 'fog')              h += 18;
  else if (weatherType === 'haze')        h += 6;
  else if (weatherType === 'clear')       h -= 15;
  else if (weatherType === 'cloudy')      h += 2;
  else if (weatherType === 'overcast')    h += 8;
  else if (PRECIP_TYPES.has(weatherType)) h += 14;   // rain/sleet/snow/blizzard/thunderstorm/storm
  h += Math.round((rand() - 0.5) * 12);              // ±6 day jitter
  return Math.max(15, Math.min(100, Math.round(h)));
}

function precipTypeForTemp(tempC, rand) {
  const heavy = rand() < 0.25;
  if (tempC > 3)  return heavy ? 'thunderstorm' : 'rain';
  if (tempC > -1) return 'sleet';
  if (tempC > -8) return heavy ? 'blizzard' : 'snow';
  return 'blizzard';
}

function generateWeatherForDate(dateStr, climateProfile) {
  const rand = mulberry32(seedFromString(`weather:${dateStr}`));
  const month = Number(dateStr.slice(5, 7)) - 1;
  const season = seasonForDate(dateStr);

  const baseTemp     = climateProfile?.monthly_temp_c?.[month]        ?? SEASON_BASE_TEMP_C[season];
  const precipChance = climateProfile?.monthly_precip_chance?.[month] ?? SEASON_BASE_PRECIP[season];
  const baseWind     = climateProfile?.monthly_wind_kph?.[month]      ?? SEASON_BASE_WIND_KPH[season];
  const baseHumidity = climateProfile?.monthly_humidity?.[month]      ?? SEASON_BASE_HUMIDITY[season];

  // 5% chance of extreme day (±20°C swing), otherwise ±10°C
  const isExtreme = rand() < 0.05;
  const variance  = Math.round((rand() - 0.5) * (isExtreme ? 40 : 20));
  const tempC     = baseTemp + variance;

  let weatherType;
  if (rand() < precipChance) {
    weatherType = precipTypeForTemp(tempC, rand);
  } else {
    // Dry days: cloudiness scales with precipChance
    const r = rand();
    if (r < precipChance * 0.5)           weatherType = 'overcast';
    else if (r < precipChance * 0.85)     weatherType = 'cloudy';
    else if (rand() < precipChance * 0.3) weatherType = rand() < 0.5 ? 'fog' : 'haze';
    else                                  weatherType = 'clear';
  }

  // Wind and humidity are rolled last so adding them never shifts the
  // temp/precip/type outcomes above for a given date+climate.
  const windKph     = windForDay(baseWind, weatherType, rand);
  const humidityPct = humidityForDay(baseHumidity, weatherType, rand);

  return { weatherType, tempC, precipChance, windKph, humidityPct };
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function toDateString(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

// Always replaces all 7 days — no locking.
async function regenerateFullForecast(startDate, climateProfile) {
  await query('DELETE FROM weather_forecast');
  for (let i = 0; i < 7; i++) {
    const date = addDays(startDate, i);
    const { weatherType, tempC, windKph, humidityPct } = generateWeatherForDate(date, climateProfile);
    await query(
      `INSERT INTO weather_forecast (forecast_day, game_date, weather_type, temp_c, wind_kph, humidity_pct)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [i, date, weatherType, tempC, windKph, humidityPct]
    );
  }
}

async function loadForecast(setWeatherState, climateProfile) {
  let { rows } = await query('SELECT * FROM weather_forecast ORDER BY forecast_day ASC');
  if (rows.length === 0) {
    const { rows: clockRows } = await query('SELECT game_date FROM world_clock WHERE id = 1');
    const startDate = clockRows[0] ? toDateString(clockRows[0].game_date) : new Date().toISOString().slice(0, 10);
    await regenerateFullForecast(startDate, climateProfile);
    ({ rows } = await query('SELECT * FROM weather_forecast ORDER BY forecast_day ASC'));
  }
  const forecast = rows.map(r => {
    const date = toDateString(r.game_date);
    const { precipChance } = generateWeatherForDate(date, climateProfile);
    return {
      forecastDay: r.forecast_day,
      date,
      weatherType: r.weather_type,
      tempC: r.temp_c,
      windKph: r.wind_kph,
      humidityPct: r.humidity_pct,
      precipChance,
      severity: severityForForecast0(r.weather_type, r.temp_c, r.wind_kph),
    };
  });
  setWeatherState(forecast[0].weatherType, forecast[0].tempC, forecast);
  return forecast;
}

// ---------------------------------------------------------------------------
// Per-zone weather field
//
// A handful of moving "systems" (cloud / precip / storm cells) drift across the
// outdoor map (map_world). Each outdoor zone samples the field by its grid_x/
// grid_y to get local cloud cover, precip, a temperature offset and storm
// intensity. Deterministic per day (same seed scheme as the forecast). The
// engine never imports this plugin — it holds the sampler we hand it at init
// (registerWeatherField), exactly like setWeatherState / rollAndSetCurrentPrecip.
// The field is fully re-derivable from (date, forecast[0], seed): no DB table,
// no per-tick writes. See docs/systems-world.md.
// ---------------------------------------------------------------------------

const K_TEMP = 4;                                   // °C pulled down at a cell core
const STORM_TYPES  = new Set(['thunderstorm', 'storm']);
const PRECIP_TYPES = new Set(['rain', 'sleet', 'snow', 'blizzard', 'thunderstorm', 'storm']);

// ── Extreme-weather severity (0..1) ─────────────────────────────────────────
// One derived scalar the whole extreme-weather layer reads (see
// docs/systems-weather-extreme.md). baseSeverity is a day-level property rolled
// from forecast[0]; sampleWeatherAt intensifies it locally under storm/precip
// cells. Cold and heat use raw forecast tempC (the engine folds wind chill into
// the thermal channel separately); wind and type contribute via max(), so
// "very cold OR gale OR blizzard" all read severe without double-counting.
const COLD_LETHAL_C = -12, COLD_RANGE = 25;   // -12°C → 0 … -37°C → 1
const HEAT_LETHAL_C = 38,  HEAT_RANGE = 12;   //  38°C → 0 …  50°C → 1
const GALE_KPH      = 45,  WIND_RANGE = 45;   //  45kph → 0 …  90kph → 1
const PRECIP_SEVERE = 0.7;                    // local precipRate above this adds severity
const TYPE_FLOOR    = { blizzard: 0.5, storm: 0.5, thunderstorm: 0.35, ash: 0.4, sleet: 0.2 };

function clamp01(n) { return Math.max(0, Math.min(1, n)); }

function severityForForecast0(weatherType, tempC, windKph) {
  const cold = (COLD_LETHAL_C - tempC) / COLD_RANGE;
  const heat = (tempC - HEAT_LETHAL_C) / HEAT_RANGE;
  const wind = ((windKph ?? 0) - GALE_KPH) / WIND_RANGE;
  const type = TYPE_FLOOR[weatherType] ?? 0;
  return clamp01(Math.max(cold, heat, wind, type));
}

const field = {
  systems: [],        // moving cells (below)
  baseCloud: 0,       // ambient cloudiness floor from weatherType
  baseSeverity: 0,    // day-level extreme-weather severity floor from forecast[0]
  bounds: null,       // { minX, maxX, minY, maxY } of map_world, cached
};

function smoothstep(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

function precipTypeForFieldTemp(tempC) {
  return tempC <= 1 ? 'snow' : 'rain';
}

async function computeBounds() {
  const { rows } = await query(
    `SELECT MIN(grid_x) AS minx, MAX(grid_x) AS maxx, MIN(grid_y) AS miny, MAX(grid_y) AS maxy
     FROM zones WHERE map_id = 'map_world' AND grid_x IS NOT NULL AND grid_y IS NOT NULL`
  ).catch(() => ({ rows: [] }));
  const r = rows[0] || {};
  if (r.minx == null) return { minX: 0, maxX: 10, minY: 0, maxY: 10 };
  return { minX: r.minx, maxX: r.maxx, minY: r.miny, maxY: r.maxy };
}

// Build the day's systems from forecast[0]. count/intensity scale with weather
// type + precipChance; positions/velocities are seeded so the layout and the
// prevailing wind are reproducible for a given date.
function systemsForForecast(weatherType, precipChance, tempC, windKph, bounds, rand) {
  const width  = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const span   = Math.max(width, height);

  // One prevailing wind for the day; each cell jitters around it. When the
  // forecast carries a wind speed, the fronts drift proportionally faster — a
  // calm day barely moves, a gale rips across the map. Falls back to a random
  // breeze when no wind figure is available.
  const windAngle = rand() * Math.PI * 2;
  const windSpeed = windKph != null
    ? 0.05 + Math.min(1, windKph / 60) * 0.30       // ~0.05 (calm) → 0.35 (gale)
    : 0.08 + rand() * 0.22;                          // grid units per 30s advect
  const baseVx = Math.cos(windAngle) * windSpeed;
  const baseVy = Math.sin(windAngle) * windSpeed;

  const pType = precipTypeForFieldTemp(tempC);
  const systems = [];
  const spawn = (type, intensity) => {
    const radius = span * (0.22 + rand() * 0.18);   // covers a fraction of the map
    systems.push({
      x: bounds.minX + rand() * width,
      y: bounds.minY + rand() * height,
      vx: baseVx * (0.7 + rand() * 0.6),
      vy: baseVy * (0.7 + rand() * 0.6),
      radius, type, intensity, precipType: pType,
    });
  };

  let baseCloud = 0, cloudCells = 0, precipCells = 0, stormCells = 0;
  if (weatherType === 'clear')                  { cloudCells = rand() < 0.5 ? 1 : 0; }
  else if (weatherType === 'fog' || weatherType === 'haze') { baseCloud = 0.3; cloudCells = 1; }
  else if (weatherType === 'cloudy')            { baseCloud = 0.4; cloudCells = 2 + Math.floor(rand() * 2); }
  else if (weatherType === 'overcast')          { baseCloud = 0.7; cloudCells = 2 + Math.floor(rand() * 3); }
  else if (STORM_TYPES.has(weatherType))        { baseCloud = 0.5; cloudCells = 1 + Math.floor(rand() * 2); stormCells = 1 + Math.floor(rand() * 2); }
  else if (PRECIP_TYPES.has(weatherType))       { baseCloud = 0.45; cloudCells = 2; precipCells = 1 + Math.floor(rand() * 2); }
  else                                          { cloudCells = 1; }

  for (let i = 0; i < cloudCells;  i++) spawn('cloud',  0.5 + rand() * 0.4);
  for (let i = 0; i < precipCells; i++) spawn('precip', 0.5 + precipChance * 0.5);
  for (let i = 0; i < stormCells;  i++) spawn('storm',  0.6 + precipChance * 0.4);

  return { systems, baseCloud };
}

function seedField(date, forecast0, bounds) {
  const rand = mulberry32(seedFromString(`weatherfield:${date}`));
  const weatherType  = forecast0?.weatherType ?? 'clear';
  const tempC        = forecast0?.tempC ?? 12;
  const precipChance = forecast0?.precipChance ?? 0.05;
  const windKph      = forecast0?.windKph ?? null;
  const { systems, baseCloud } = systemsForForecast(weatherType, precipChance, tempC, windKph, bounds, rand);
  field.systems      = systems;
  field.baseCloud    = baseCloud;
  field.baseSeverity = severityForForecast0(weatherType, tempC, windKph);
  field.bounds       = bounds;
}

// Drift every cell one step; torus-wrap (with padding) so cells re-enter the
// map naturally and the system count stays stable. Pure in-memory math.
function advectField() {
  const b = field.bounds;
  if (!b) return;
  const pad = 2;
  for (const s of field.systems) {
    s.x += s.vx;
    s.y += s.vy;
    const lo = b.minX - s.radius - pad, spanX = (b.maxX - b.minX) + s.radius * 2 + pad * 2;
    const loY = b.minY - s.radius - pad, spanY = (b.maxY - b.minY) + s.radius * 2 + pad * 2;
    if (s.x < lo)  s.x += spanX; else if (s.x > lo + spanX)  s.x -= spanX;
    if (s.y < loY) s.y += spanY; else if (s.y > loY + spanY) s.y -= spanY;
  }
}

// The shared sampler handed to the engine. O(systems); systems are single digits.
function sampleWeatherAt(gx, gy) {
  let cloudCover = field.baseCloud, precipRate = 0, stormIntensity = 0, tempOffset = 0;
  let precipType = 'none';
  if (gx == null || gy == null) return { cloudCover, precipRate, precipType, tempOffset, stormIntensity, severity: field.baseSeverity };
  for (const s of field.systems) {
    const dist = Math.hypot(gx - s.x, gy - s.y);
    if (dist >= s.radius) continue;
    const f = s.intensity * smoothstep(1 - dist / s.radius);
    if (f <= 0) continue;
    cloudCover = Math.max(cloudCover, f);
    tempOffset -= f * K_TEMP;
    if (s.type === 'precip' || s.type === 'storm') {
      if (f > precipRate) { precipRate = f; precipType = s.precipType; }
      if (s.type === 'storm') stormIntensity = Math.max(stormIntensity, f);
    }
  }
  // Local severity: the day-level floor, intensified where a storm cell sits
  // overhead or precip runs torrential on this tile.
  const precipSev = precipRate >= PRECIP_SEVERE ? (precipRate - PRECIP_SEVERE) / (1 - PRECIP_SEVERE) : 0;
  const severity = Math.min(1, Math.max(field.baseSeverity, stormIntensity, precipSev));
  return {
    cloudCover: Math.min(1, cloudCover),
    precipRate: Math.min(1, precipRate),
    precipType,
    tempOffset,
    stormIntensity: Math.min(1, stormIntensity),
    severity,
  };
}

function getWeatherFieldSnapshot() {
  return {
    bounds: field.bounds,
    baseSeverity: field.baseSeverity,
    systems: field.systems.map(s => ({
      x: s.x, y: s.y, radius: s.radius, vx: s.vx, vy: s.vy,
      type: s.type, intensity: s.intensity, precipType: s.precipType,
    })),
  };
}

async function reseedFromForecast0(forecast0) {
  if (!forecast0) return;
  const bounds = field.bounds || await computeBounds();
  seedField(forecast0.date, forecast0, bounds);
}

export const hooks = {
  'environment.init': async ({ setWeatherState, climateProfile, registerWeatherField, registerWeatherFieldSnapshot, registerWeatherFieldAdvance }) => {
    const forecast = await loadForecast(setWeatherState, climateProfile);
    const bounds = await computeBounds();
    seedField(forecast[0].date, forecast[0], bounds);
    if (registerWeatherField) registerWeatherField(sampleWeatherAt);
    if (registerWeatherFieldSnapshot) registerWeatherFieldSnapshot(getWeatherFieldSnapshot);
    if (registerWeatherFieldAdvance) registerWeatherFieldAdvance(advectField);
  },

  'environment.advanceWeather': async ({ setWeatherState, rollAndSetCurrentPrecip, getHUDPayload, broadcast, currentForecast, climateProfile }) => {
    const shifted = currentForecast.slice(1);
    const newDate = addDays(currentForecast[6].date, 1);
    const generated = generateWeatherForDate(newDate, climateProfile);

    const nextForecast = [
      ...shifted,
      { date: newDate, weatherType: generated.weatherType, tempC: generated.tempC, windKph: generated.windKph, humidityPct: generated.humidityPct, precipChance: generated.precipChance },
    ].map((f, i) => ({ ...f, forecastDay: i, severity: severityForForecast0(f.weatherType, f.tempC, f.windKph) }));

    await query('DELETE FROM weather_forecast');
    for (const f of nextForecast) {
      await query(
        `INSERT INTO weather_forecast (forecast_day, game_date, weather_type, temp_c, wind_kph, humidity_pct)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [f.forecastDay, f.date, f.weatherType, f.tempC, f.windKph ?? 0, f.humidityPct ?? 60]
      );
    }
    setWeatherState(nextForecast[0].weatherType, nextForecast[0].tempC, nextForecast);
    // Roll current precip against the new day's forecasted precipChance.
    rollAndSetCurrentPrecip(nextForecast[0].weatherType, nextForecast[0].tempC, nextForecast[0].precipChance ?? 0.05);
    // Re-seed the moving field for the new day.
    seedField(nextForecast[0].date, nextForecast[0], field.bounds || await computeBounds());
    if (broadcast) broadcast({ type: 'environment.sync', ...getHUDPayload() });
  },

  'environment.recalculateForecast': async ({ setWeatherState, climateProfile, currentDate }) => {
    await regenerateFullForecast(currentDate, climateProfile);
    const forecast = await loadForecast(setWeatherState, climateProfile);
    seedField(forecast[0].date, forecast[0], field.bounds || await computeBounds());
  },

  // Fired by the engine after a dev weather override so the field re-seeds to
  // match the forced weather/intensity (Max Storm → full storm cells; clear → drain).
  'environment.weatherFieldSync': async ({ forecast0 }) => {
    await reseedFromForecast0(forecast0);
  },
};
