import { state } from '../state.js';

const DAY_PHASES_CLIENT = [
  { name: 'dawn',  start: 5 * 60,  end: 7 * 60,  icon: '🌅' },
  { name: 'day',   start: 7 * 60,  end: 17 * 60, icon: '☀' },
  { name: 'dusk',  start: 17 * 60, end: 20 * 60, icon: '🌇' },
  { name: 'night', start: 20 * 60, end: 5 * 60,  icon: '🌙' },
];

function timeIconForMinutes(m) {
  if (m >= 5 * 60 && m < 7 * 60)  return DAY_PHASES_CLIENT[0].icon;
  if (m >= 7 * 60 && m < 17 * 60) return DAY_PHASES_CLIENT[1].icon;
  if (m >= 17 * 60 && m < 20 * 60) return DAY_PHASES_CLIENT[2].icon;
  return DAY_PHASES_CLIENT[3].icon;
}

function parseHHMM(str) {
  const [h, m] = (str || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function formatHHMM(m) {
  const h = Math.floor(m / 60) % 24;
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

let clientMinutes = null;
let envWeatherIcon = '—';
let envTempC = null;
let envCurrentWeatherType = null;
let envCurrentPrecipIntensity = null;

function renderEnvironmentHUD() {
  if (clientMinutes === null) return;
  const timeStr = formatHHMM(clientMinutes);
  const timeIcon = timeIconForMinutes(clientMinutes);
  const tempStr = envTempC !== null ? `${envTempC}°C` : '—°C';
  const weatherLabel = envCurrentWeatherType
    ? envCurrentWeatherType.charAt(0).toUpperCase() + envCurrentWeatherType.slice(1)
    : '';
  const precipLabel = envCurrentPrecipIntensity && envCurrentPrecipIntensity !== 'none'
    ? envCurrentPrecipIntensity.charAt(0).toUpperCase() + envCurrentPrecipIntensity.slice(1)
    : '';
  for (const suffix of ['', '-m']) {
    const w  = document.getElementById(`env-weather-icon${suffix}`);
    const c  = document.getElementById(`env-clock${suffix}`);
    const t  = document.getElementById(`env-time-icon${suffix}`);
    const p  = document.getElementById(`env-temp${suffix}`);
    const wl = document.getElementById(`env-weather-type${suffix}`);
    const pl = document.getElementById(`env-precip-intensity${suffix}`);
    if (w)  w.textContent  = envWeatherIcon;
    if (c)  c.textContent  = timeStr;
    if (t)  t.textContent  = timeIcon;
    if (p)  p.textContent  = tempStr;
    if (wl) wl.textContent = weatherLabel;
    if (pl) pl.textContent = precipLabel;
  }
}

let _lastServerTick = 0;

export function updateEnvironmentHUD(env) {
  if (!env || !env.time) return;
  clientMinutes = parseHHMM(env.time);
  if (env.weatherIcon !== undefined) envWeatherIcon = env.weatherIcon || '—';
  if (env.tempC !== undefined) envTempC = env.tempC;
  if (env.currentWeatherType !== undefined) envCurrentWeatherType = env.currentWeatherType;
  if (env.currentIntensity !== undefined) envCurrentPrecipIntensity = env.currentIntensity;
  _lastServerTick = Date.now();
  renderEnvironmentHUD();
}

export function refreshZoneVisibility() {
  if (!state.currentZone) return;
  fetch(`/api/environment/visibility/${encodeURIComponent(state.currentZone)}`)
    .then(r => r.json())
    .then(v => {
      document.body.classList.toggle('env-vis-dim', v.category === 'dim');
      document.body.classList.toggle('env-vis-dark', v.category === 'dark');
    })
    .catch(() => {});
}

// Fallback tick — only increments if the server hasn't pushed in over 90 seconds
// (i.e. WS is disconnected). Normal operation is driven entirely by server pushes.
setInterval(() => {
  if (clientMinutes === null) return;
  if (Date.now() - _lastServerTick < 90_000) return;
  clientMinutes = (clientMinutes + 1) % (24 * 60);
  renderEnvironmentHUD();
}, 60_000);

