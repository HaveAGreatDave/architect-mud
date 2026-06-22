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

  return { weatherType, tempC };
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
    const { weatherType, tempC } = generateWeatherForDate(date, climateProfile);
    await query(
      `INSERT INTO weather_forecast (forecast_day, game_date, weather_type, temp_c)
       VALUES ($1, $2, $3, $4)`,
      [i, date, weatherType, tempC]
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
  const forecast = rows.map(r => ({
    forecastDay: r.forecast_day,
    date: toDateString(r.game_date),
    weatherType: r.weather_type,
    tempC: r.temp_c,
  }));
  setWeatherState(forecast[0].weatherType, forecast[0].tempC, forecast);
}

export const hooks = {
  'environment.init': async ({ setWeatherState, climateProfile }) => {
    await loadForecast(setWeatherState, climateProfile);
  },

  'environment.advanceWeather': async ({ setWeatherState, currentForecast, climateProfile }) => {
    const shifted = currentForecast.slice(1);
    const newDate = addDays(currentForecast[6].date, 1);
    const generated = generateWeatherForDate(newDate, climateProfile);

    const nextForecast = [
      ...shifted,
      { date: newDate, weatherType: generated.weatherType, tempC: generated.tempC },
    ].map((f, i) => ({ ...f, forecastDay: i }));

    await query('DELETE FROM weather_forecast');
    for (const f of nextForecast) {
      await query(
        `INSERT INTO weather_forecast (forecast_day, game_date, weather_type, temp_c)
         VALUES ($1, $2, $3, $4)`,
        [f.forecastDay, f.date, f.weatherType, f.tempC]
      );
    }
    setWeatherState(nextForecast[0].weatherType, nextForecast[0].tempC, nextForecast);
  },

  'environment.recalculateForecast': async ({ setWeatherState, climateProfile, currentDate }) => {
    await regenerateFullForecast(currentDate, climateProfile);
    await loadForecast(setWeatherState, climateProfile);
  },
};
