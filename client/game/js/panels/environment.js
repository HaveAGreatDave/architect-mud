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

function renderEnvironmentHUD() {
  if (clientMinutes === null) return;
  const weatherEl = document.getElementById('env-weather-icon');
  const clockEl   = document.getElementById('env-clock');
  const timeIconEl = document.getElementById('env-time-icon');
  const tempEl    = document.getElementById('env-temp');
  if (weatherEl) weatherEl.textContent = envWeatherIcon;
  if (clockEl)   clockEl.textContent   = formatHHMM(clientMinutes);
  if (timeIconEl) timeIconEl.textContent = timeIconForMinutes(clientMinutes);
  if (tempEl)    tempEl.textContent    = envTempC !== null ? `${envTempC}°C` : '—°C';
}

let _lastServerTick = 0;

export function updateEnvironmentHUD(env) {
  if (!env || !env.time) return;
  clientMinutes = parseHHMM(env.time);
  if (env.weatherIcon !== undefined) envWeatherIcon = env.weatherIcon || '—';
  if (env.tempC !== undefined) envTempC = env.tempC;
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

