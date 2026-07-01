import { appendMsg } from '../render.js';
import { formatTemp, formatTempPrecise } from '/shared/settings.js';
import { getEnvSnapshot } from './environment.js';

// Plain-language wind strength, roughly Beaufort. Keeps "windy vs calm" legible.
function windLabel(kph) {
  if (kph == null) return '';
  if (kph < 6)  return 'Calm';
  if (kph < 20) return 'Breezy';
  if (kph < 39) return 'Windy';
  if (kph < 62) return 'Strong';
  return 'Gale';
}

export function openForecast() {
  renderForecastToday();
  document.getElementById('forecast-panel').classList.add('active');
  fetch('/api/environment/forecast')
    .then(r => r.json())
    .then(renderForecastDays)
    .catch(() => appendMsg('Could not reach the forecast feed.', 'error'));
}

export function updateForecast(forecast) {
  if (!forecast?.length) return;
  const panel = document.getElementById('forecast-panel');
  if (panel && panel.classList.contains('active')) renderForecastDays(forecast);
}

function renderForecastToday() {
  const el = document.getElementById('forecast-today');
  if (!el) return;
  const env = getEnvSnapshot();
  if (!env) { el.innerHTML = ''; return; }
  const precipStr = env.precipIntensity && env.precipIntensity !== 'none'
    ? env.precipIntensity.charAt(0).toUpperCase() + env.precipIntensity.slice(1)
    : '';
  const weatherLabel = (env.weatherType || '').replace(/_/g, ' ');
  el.innerHTML = `
    <div class="ft-row"><span class="ft-label">Time</span><span class="ft-val">${env.timeIcon} ${env.time}</span></div>
    ${weatherLabel ? `<div class="ft-row"><span class="ft-label">Weather</span><span class="ft-val">${env.weatherIcon} ${weatherLabel}</span></div>` : ''}
    <div class="ft-row"><span class="ft-label">Temp</span><span class="ft-val ft-temp">${formatTemp(env.tempC)}</span></div>
    ${env.feelsLikeC != null && Math.round(env.feelsLikeC) !== Math.round(env.tempC) ? `<div class="ft-row"><span class="ft-label">Feels like</span><span class="ft-val ft-temp">${formatTemp(env.feelsLikeC)}</span></div>` : ''}
    ${env.windKph != null ? `<div class="ft-row"><span class="ft-label">Wind</span><span class="ft-val">\u{1F4A8} ${env.windKph} km/h · ${windLabel(env.windKph)}</span></div>` : ''}
    ${env.humidityPct != null ? `<div class="ft-row"><span class="ft-label">Humidity</span><span class="ft-val">\u{1F4A7} ${env.humidityPct}%</span></div>` : ''}
    ${env.bodyFeel ? `<div class="ft-row"><span class="ft-label">Feels</span><span class="ft-val">${env.bodyFeel}</span></div>` : ''}
    ${precipStr ? `<div class="ft-row"><span class="ft-label">Precip</span><span class="ft-val ft-precip">${precipStr}</span></div>` : ''}
    ${env.bodyTempC !== null ? `<div class="ft-row"><span class="ft-label">Body</span><span class="ft-val">\u{1F321} ${formatTempPrecise(env.bodyTempC)}</span></div>` : ''}
  `;
}

function renderForecastDays(forecast) {
  const el = document.getElementById('forecast-days');
  if (!el) return;
  el.innerHTML = (forecast || []).map((f, i) => `
    <div class="forecast-day-row ${i === 0 ? 'fd-today' : ''}">
      <span class="fd-label">${i === 0 ? 'Today' : (f.date || '').slice(5) || `+${i}`}</span>
      <span class="fd-icon">${f.icon || ''}</span>
      <span class="fd-weather">${(f.weatherType || '').replace('_', ' ')}</span>
      ${f.humidityPct != null ? `<span class="fd-humid" title="Humidity">\u{1F4A7} ${f.humidityPct}%</span>` : ''}
      ${f.windKph != null ? `<span class="fd-wind" title="${windLabel(f.windKph)}">\u{1F4A8} ${f.windKph}</span>` : ''}
      <span class="fd-temp">${formatTemp(f.tempC)}</span>
    </div>
  `).join('');
}

export function closeForecast() {
  document.getElementById('forecast-panel').classList.remove('active');
}

export function initForecast() {
  document.getElementById('forecast-panel').addEventListener('click', (e) => {
    if (e.target.id === 'forecast-panel') closeForecast();
  });
  document.getElementById('env-hud-sidebar').addEventListener('click', openForecast);
  // Wire static close button inside forecast-panel
  document.querySelectorAll('#forecast-panel .dialogue-opt').forEach(btn => {
    if (btn.textContent.trim().includes('Close')) btn.addEventListener('click', closeForecast);
  });
}
