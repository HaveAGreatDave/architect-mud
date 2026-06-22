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

const WEATHER_TYPES = ['clear','cloudy','overcast','rain','thunderstorm','storm','snow','blizzard','fog','haze','ash'];

const SEASON_BY_MONTH = [
  'winter', 'winter', 'spring', 'spring', 'spring', 'summer',
  'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter',
];

const SEASON_BASE_TEMP_C = { winter: 2, spring: 12, summer: 24, autumn: 11 };

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

function generateWeatherForDate(dateStr) {
  const rand = mulberry32(seedFromString(`weather:${dateStr}`));
  const season = seasonForDate(dateStr);
  const candidates = WEATHER_TYPES.filter(w => w !== 'snow' || season === 'winter' || season === 'autumn');
  const weatherType = pick(rand, candidates);
  const base = SEASON_BASE_TEMP_C[season];
  const variance = Math.round((rand() - 0.5) * 8);
  return { weatherType, tempC: base + variance };
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

async function regenerateFullForecast(startDate) {
  for (let i = 0; i < 7; i++) {
    const date = addDays(startDate, i);
    const { weatherType, tempC } = generateWeatherForDate(date);
    await query(
      `INSERT INTO weather_forecast (forecast_day, game_date, weather_type, temp_c, locked)
       VALUES ($1, $2, $3, $4, 0)
       ON CONFLICT (forecast_day) DO NOTHING`,
      [i, date, weatherType, tempC]
    );
  }
}

async function loadForecast(setWeatherState) {
  let { rows } = await query('SELECT * FROM weather_forecast ORDER BY forecast_day ASC');
  if (rows.length === 0) {
    const { rows: clockRows } = await query('SELECT game_date FROM world_clock WHERE id = 1');
    const startDate = clockRows[0] ? toDateString(clockRows[0].game_date) : new Date().toISOString().slice(0, 10);
    await regenerateFullForecast(startDate);
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
  'environment.init': async ({ setWeatherState }) => {
    await loadForecast(setWeatherState);
  },

  'environment.advanceWeather': async ({ setWeatherState, currentForecast }) => {
    // Shift forecast: drop day 0, promote days 1-6, generate new day 6.
    // A locked day keeps its stored values through exactly one shift, then
    // the lock clears — GDD §4.3.
    const shifted = currentForecast.slice(1);
    const newDate = addDays(currentForecast[6].date, 1);
    const generated = generateWeatherForDate(newDate);

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
};
