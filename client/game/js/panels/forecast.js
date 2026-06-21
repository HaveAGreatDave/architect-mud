import { appendMsg } from '../render.js';

export function openForecast() {
  fetch('/api/environment/forecast')
    .then(r => r.json())
    .then(renderForecastPanel)
    .catch(() => appendMsg('Could not reach the forecast feed.', 'error'));
}

function renderForecastPanel(forecast) {
  const el = document.getElementById('forecast-days');
  if (!el) return;
  el.innerHTML = (forecast || []).map((f, i) => `
    <div class="forecast-day-row ${i === 0 ? 'fd-today' : ''}">
      <span class="fd-label">${i === 0 ? 'Today' : (f.date || '').slice(5) || `+${i}`}</span>
      <span class="fd-icon">${f.icon || ''}</span>
      <span class="fd-weather">${(f.weatherType || '').replace('_', ' ')}</span>
      <span class="fd-temp">${f.tempC}°C</span>
    </div>
  `).join('');
  document.getElementById('forecast-panel').classList.add('active');
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
