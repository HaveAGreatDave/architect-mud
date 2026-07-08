// Tablet OS — Weather app. "Now" reads the engine's live snapshot (environment.js
// getHUDPayload — the same numbers the HUD already shows); "Forecast" reads
// getForecast() (the same 7-day state the HUD's forecast strip uses), which
// carries a WEATHER_ICON per day for free. Indoor zones show "Indoor" plus the
// same outside snapshot — no separate indoor simulation exists, matching the
// design note that nothing should be fabricated (no cloud-layer/visibility
// fields; those aren't stored data).
import { getHUDPayload, getForecast } from '../../server/engine/environment.js';
import { getZone } from '../../server/engine/world.js';
import { registerTabletApp, normScreen } from './registry.js';

async function buildScreen(player, screenId, params) {
  const zone = getZone(player.current_zone);
  const indoor = !!(zone?.flags?.is_interior || zone?.flags?.is_apartment);
  const hud = getHUDPayload();

  if (normScreen(screenId) === 'forecast') {
    // getForecast() (not a raw weather_forecast query) so each day carries the
    // same WEATHER_ICON lookup the HUD already uses — one icon source of truth.
    const days = getForecast();
    return {
      view: 'list',
      breadcrumb: ['Forecast'],
      items: days.map(f => ({
        id: String(f.forecastDay),
        label: `${f.icon || ''} ${f.date ? new Date(f.date).toLocaleDateString() : `Day ${f.forecastDay}`}`.trim(),
        sub: `${f.weatherType} · ${f.tempC}°C · wind ${f.windKph}kph · humidity ${f.humidityPct}%`,
      })),
    };
  }

  return {
    view: 'detail',
    breadcrumb: [],
    detail: {
      name: `${hud.currentWeatherIcon || ''} ${indoor ? 'Indoor' : 'Now'}`.trim(),
      desc: indoor ? `${zone.name} — climate reads the outside weather; nothing indoor is simulated separately.` : '',
      rows: [
        { label: 'Conditions', value: hud.currentWeatherType },
        { label: 'Intensity', value: hud.currentIntensity },
        { label: 'Temperature', value: `${Math.round(hud.tempC)}°C (${hud.tempF}°F)` },
        { label: 'Feels like', value: `${Math.round(hud.feelsLikeC)}°C` },
      ],
    },
    actions: [{ id: 'nav_forecast', label: '7-Day Forecast' }],
  };
}

async function handleAction(player, actionId) {
  if (actionId === 'nav_forecast') return buildScreen(player, 'Forecast', '');
  return buildScreen(player, null, '');
}

registerTabletApp({
  id: 'weather', name: 'Weather', icon: '⛅', category: 'World',
  buildScreen, handleAction,
});
