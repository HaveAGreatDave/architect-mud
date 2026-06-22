/**
 * Weather plugin — owns the 7-day deterministic forecast.
 *
 * Subscribes to two hooks from environment.js:
 *   environment.init        — load (or generate) the forecast at server boot
 *   environment.advanceWeather — shift the forecast forward one day (called
 *                               from tick24h BEFORE simulatePowerNetwork so
 *                               the new weatherType is in place for load calc)
 *
 * environment.js keeps state.weatherType / state.tempC / state.forecast as
 * readable values for the rest of the engine; this plugin writes them via
 * the setWeatherState() setter passed through each hook.
 */
import { createHash } from 'node:crypto';
import { query } from '../../server/models/db.js';

const SEASON_BY_MONTH = [
  'winter', 'winter', 'spring', 'spring', 'spring', 'summer',
  'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter',
];

const SEASON_BASE_TEMP_C = { winter: 2, spring: 12, summer: 24, autumn: 11 };
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

// Determine precipitation type from temperature.
function precipTypeForTemp(tempC, rand) {
  const heavy = rand() < 0.25;
  if (tempC > 3)   return heavy ? 'thunderstorm' : 'rain';
  if (tempC > -1)  return 'sleet';
  if (tempC > -8)  return heavy ? 'blizzard' : 'snow';
  return 'blizzard';
}

function generateWeatherForDate(dateStr, climateProfile) {
  const rand = mulberry32(seedFromString(`weather:${dateStr}`));
  const month = Number(dateStr.slice(5, 7)) - 1;
  const season = seasonForDate(dateStr);

  const baseTemp     = climateProfile?.monthly_temp_c?.[month]        ?? SEASON_BASE_TEMP_C[season];
  const precipChance = climateProfile?.monthly_precip_chance?.[month] ?? SEASON_BASE_PRECIP[season];

  const variance = Math.round((rand() - 0.5) * 8);
  const tempC = baseTemp + variance;

  let weatherType;
  if (rand() < precipChance) {
    weatherType = precipTypeForTemp(tempC, rand);
  } else {
    // Non-precipitating: weight toward clear in summer, overcast in winter
    const dryOptions = tempC < 0
      ? ['cloudy', 'cloudy', 'overcast', 'clear']
      : ['clear', 'clear', 'cloudy', 'overcast', 'fog', 'haze'];
    weatherType = pick(rand, dryOptions);
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

async function regenerateFullForecast(startDate, climateProfile, overwriteUnlocked = false) {
  for (let i = 0; i < 7; i++) {
    const date = addDays(startDate, i);
    const { weatherType, tempC } = generateWeatherForDate(date, climateProfile);
    if (overwriteUnlocked) {
      await query(
        `INSERT INTO weather_forecast (forecast_day, game_date, weather_type, temp_c, locked)
         VALUES ($1, $2, $3, $4, 0)
         ON CONFLICT (forecast_day) DO UPDATE
           SET game_date = $2, weather_type = $3, temp_c = $4
           WHERE weather_forecast.locked = 0`,
        [i, date, weatherType, tempC]
      );
    } else {
      await query(
        `INSERT INTO weather_forecast (forecast_day, game_date, weather_type, temp_c, locked)
         VALUES ($1, $2, $3, $4, 0)
         ON CONFLICT (forecast_day) DO NOTHING`,
        [i, date, weatherType, tempC]
      );
    }
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
    locked: !!r.locked,
  }));
  setWeatherState(forecast[0].weatherType, forecast[0].tempC, forecast);
}

export const hooks = {
  'environment.init': async ({ setWeatherState, climateProfile }) => {
    await loadForecast(setWeatherState, climateProfile);
  },

  'environment.advanceWeather': async ({ setWeatherState, currentForecast, climateProfile }) => {
    // Shift forecast: drop day 0, promote days 1-6, generate new day 6.
    const shifted = currentForecast.slice(1);
    const newDate = addDays(currentForecast[6].date, 1);
    const generated = generateWeatherForDate(newDate, climateProfile);

    const nextForecast = [
      ...shifted,
      { date: newDate, weatherType: generated.weatherType, tempC: generated.tempC, locked: false },
    ].map((f, i) => ({ ...f, forecastDay: i, locked: i < shifted.length ? shifted[i].locked : false }));

    await query('DELETE FROM weather_forecast');
    for (const f of nextForecast) {
      await query(
        `INSERT INTO weather_forecast (forecast_day, game_date, weather_type, temp_c, locked)
         VALUES ($1, $2, $3, $4, $5)`,
        [f.forecastDay, f.date, f.weatherType, f.tempC, f.locked ? 1 : 0]
      );
    }
    setWeatherState(nextForecast[0].weatherType, nextForecast[0].tempC, nextForecast);
  },

  'environment.recalculateForecast': async ({ setWeatherState, climateProfile, currentDate }) => {
    await regenerateFullForecast(currentDate, climateProfile, true);
    await loadForecast(setWeatherState, climateProfile);
  },
};
