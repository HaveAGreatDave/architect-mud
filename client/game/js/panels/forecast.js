import { appendMsg } from '../render.js';
import { formatTemp } from '/shared/settings.js';
import { getEnvSnapshot, isEnvUnreal } from './environment.js';

// A forecast day at or above this severity shows a ⚠ warning. Deliberately a
// boolean band, not the raw number — the telegraph warns "severe conditions
// likely" without revealing exact timing or intensity (see systems-weather-extreme.md).
const SEVERE_THRESHOLD = 0.45;

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
  // No weather here, and no week to have weather in — see setEnvUnreal in
  // environment.js. Answering in fiction rather than opening a panel full of
  // Coldwater's forecast at someone standing in the prologue's corridor.
  if (isEnvUnreal()) {
    appendMsg("There's no sky here to read, and no tomorrow to read it for.", 'ambient');
    return;
  }
  renderForecastToday();
  document.getElementById('forecast-panel').classList.add('active');
  fetch('/api/environment/forecast')
    .then(r => r.json())
    .then(renderForecastDays)
    .catch(() => appendMsg("Couldn't reach the forecast feed.", 'error'));
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
  `;
}

function renderForecastDays(forecast) {
  const el = document.getElementById('forecast-days');
  if (!el) return;
  el.innerHTML = (forecast || []).map((f, i) => {
    const severe = (f.severity ?? 0) >= SEVERE_THRESHOLD;
    // A hero day outranks an ordinary severe day and has to LOOK it: its own
    // icon, its own row class, and a named warning instead of the vague band.
    // This is the week of notice the acid/EMP teeth are balanced against.
    const hero = f.heroEvent ? { icon: f.heroEventIcon || '⚠', label: f.heroEventLabel || f.heroEvent.replace(/_/g, ' ') } : null;
    return `
    <div class="forecast-day-row ${i === 0 ? 'fd-today' : ''} ${severe ? 'fd-severe' : ''} ${hero ? 'fd-hero' : ''}">
      <span class="fd-label">${i === 0 ? 'Today' : (f.date || '').slice(5) || `+${i}`}</span>
      <span class="fd-icon">${hero ? hero.icon : (f.icon || '')}</span>
      <span class="fd-weather">${hero ? hero.label : (f.weatherType || '').replace('_', ' ')}${hero
        ? ` <span class="fd-hero-warn" title="${hero.label} forecast for this day — this one kills people who go out unprepared">⚠⚠</span>`
        : (severe ? ' <span class="fd-warn" title="Severe conditions likely — gear up before heading out">⚠</span>' : '')}</span>
      ${f.humidityPct != null ? `<span class="fd-humid" title="Humidity">\u{1F4A7} ${f.humidityPct}%</span>` : ''}
      ${f.windKph != null ? `<span class="fd-wind" title="${windLabel(f.windKph)}">\u{1F4A8} ${f.windKph}</span>` : ''}
      <span class="fd-temp">${formatTemp(f.tempC)}</span>
    </div>`;
  }).join('');
}

export function closeForecast() {
  document.getElementById('forecast-panel').classList.remove('active');
}

export function initForecast() {
  document.getElementById('forecast-panel').addEventListener('click', (e) => {
    if (e.target.id === 'forecast-panel') closeForecast();
  });
  document.getElementById('env-hud-sidebar').addEventListener('click', openForecast);
  document.getElementById('mob-hud-env')?.addEventListener('click', openForecast);
  // Wire static close button inside forecast-panel
  document.querySelectorAll('#forecast-panel .dialogue-opt').forEach(btn => {
    if (btn.textContent.trim().includes('Close')) btn.addEventListener('click', closeForecast);
  });
}
