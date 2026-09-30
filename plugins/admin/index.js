// Admin plugin: in-game staff controls. The typed verb is `sysop` (the engine
// already owns `admin`, which opens the older command reference panel). The
// Tablet app in tablet-app.js is a skin over these verbs: every button runs a
// sysop subcommand, so everything the app can do can also be typed.
//
// Built: weather and time. Players and the staff channel follow; see
// docs/systems-admin.md.
import {
  WEATHER_TYPES, getHUDPayload, getForecast, getWeatherEvent,
  devOverrideWeather, devClearWeatherOverride, devTriggerWeatherEvent,
} from '../../server/engine/environment.js';
import { logActivity } from '../../server/models/db.js';
import { heroEventTypes } from '../weather/index.js';
import { timeView, skipTime, setClock, setFrozen, setSpeed } from './time.js';
import './tablet-app.js';

export const STAFF_ROLES = ['dev', 'admin', 'builder', 'designer'];
export const isStaff = (player) => !!player && STAFF_ROLES.includes(player.role);

const DENIED = { type: 'error', message: 'Unknown command: "sysop". Type HELP for commands.' };

// Everything the Weather tab shows, from engine memory. No query.
export function weatherView() {
  const hud = getHUDPayload() || {};
  const today = getForecast()?.[0] || {};
  const event = getWeatherEvent();
  return {
    weatherType: hud.weatherType,
    icon: hud.currentWeatherIcon || hud.weatherIcon,
    humidityPct: hud.humidityPct,
    current: hud.currentWeatherType,
    intensity: hud.currentIntensity,
    tempC: Math.round(hud.tempC ?? 0),
    feelsLikeC: Math.round(hud.feelsLikeC ?? hud.tempC ?? 0),
    windKph: Math.round(hud.windKph ?? 0),
    precipPct: Math.round((today.precipChance ?? 0) * 100),
    override: !!hud.weatherOverrideActive,
    event,
  };
}

// Change today's weather. Any field left undefined keeps its current value, so
// "set the temperature" doesn't also reset the condition.
export async function setWeather(player, { weatherType, tempC, precipPct, windKph } = {}) {
  const now = weatherView();
  const type = (weatherType || now.weatherType || '').toLowerCase();
  if (!WEATHER_TYPES.includes(type)) return { ok: false, error: `Unknown weather "${weatherType}". Options: ${WEATHER_TYPES.join(', ')}.` };
  const t = tempC === undefined ? now.tempC : Number(tempC);
  if (!Number.isFinite(t) || t < -60 || t > 60) return { ok: false, error: 'Temperature must be between -60 and 60 °C.' };
  const p = precipPct === undefined ? now.precipPct : Number(precipPct);
  if (!Number.isFinite(p) || p < 0 || p > 100) return { ok: false, error: 'Precipitation chance must be 0 to 100.' };
  const k = windKph === undefined ? now.windKph : Number(windKph);
  if (!Number.isFinite(k) || k < 0 || k > 200) return { ok: false, error: 'Wind must be 0 to 200 kph.' };
  await devOverrideWeather({ weatherType: type, tempC: t, precipChance: p / 100, windKph: k });
  logActivity('admin_cmd', player.handle, null, `weather set ${type} ${t}C ${p}% ${k}kph`);
  return { ok: true, message: `Weather forced: ${type}, ${t}°C, ${p}% precipitation, wind ${k} kph.` };
}

export async function resetWeather(player) {
  if (!weatherView().override) return { ok: true, message: 'The weather is already on its forecast.' };
  await devClearWeatherOverride();
  logActivity('admin_cmd', player.handle, null, 'weather reset to forecast');
  return { ok: true, message: 'Override cleared. The weather is back on its forecast.' };
}

export function fireWeatherEvent(player, type) {
  const t = String(type || '').toLowerCase().replace(/\s+/g, '_');
  const known = heroEventTypes();
  if (!known.some(e => e.type === t)) return { ok: false, error: `Unknown event "${type}". Options: ${known.map(e => e.type).join(', ')}.` };
  const res = devTriggerWeatherEvent(t);
  if (!res?.ok) return { ok: false, error: res?.error || "Couldn't start that event." };
  logActivity('admin_cmd', player.handle, null, `weather event ${t}`);
  return { ok: true, message: `Started ${res.label}. It begins to approach.` };
}

export function weatherEventOptions() { return heroEventTypes(); }

function weatherText() {
  const w = weatherView();
  return [
    `<b>Weather</b>: ${w.weatherType} (now ${w.current}${w.intensity ? `, ${w.intensity}` : ''})`,
    `${w.tempC}°C, feels ${w.feelsLikeC}°C · wind ${w.windKph} kph · ${w.precipPct}% precipitation`,
    `Override: ${w.override ? 'ON' : 'off'} · Event: ${w.event ? `${w.event.type.replace(/_/g, ' ')} (${w.event.phase})` : 'none'}`,
  ].join('<br>');
}

const USAGE = [
  'sysop weather',
  'sysop weather set &lt;type&gt; [tempC] [precip%]',
  'sysop weather temp &lt;C&gt;  |  sysop weather rain &lt;0-100&gt;  |  sysop weather wind &lt;kph&gt;',
  'sysop weather event &lt;type&gt;',
  'sysop weather reset',
  'sysop time  |  sysop time skip &lt;4|8|12|24&gt;  |  sysop time set &lt;HH:MM&gt;',
  'sysop time freeze  |  sysop time unfreeze  |  sysop time speed &lt;1|2|3|6&gt;',
].map(l => `<span class="text-dim">${l}</span>`).join('<br>');

function timeText() {
  const t = timeView();
  return `<b>Time</b>: ${t.time}, ${t.dayOfWeek || ''} ${t.date} (${t.phase}) · ${t.frozen ? 'FROZEN' : 'running'} · ${t.scale}x speed`;
}

async function cmdTime(player, sub, rest) {
  if (!sub) return { type: 'output', message: timeText() };
  if (sub === 'skip' || sub === 'advance') return out(await skipTime(player, String(rest[0] || '').replace(/h$/i, '')));
  if (sub === 'set') return out(await setClock(player, rest[0]));
  if (sub === 'freeze') return out(setFrozen(player, true));
  if (sub === 'unfreeze' || sub === 'resume') return out(setFrozen(player, false));
  if (sub === 'speed' || sub === 'scale') return out(await setSpeed(player, rest[0]));
  return { type: 'error', message: USAGE };
}

const out = (res) => res.ok
  ? { type: 'output', message: `<span class="msg-system">${res.message}</span>` }
  : { type: 'error', message: res.error };

async function cmdSysop(args, raw, player) {
  if (!isStaff(player)) return DENIED;
  const [area, sub, ...rest] = args || [];
  if (!area) return { type: 'output', message: `${weatherText()}<br>${timeText()}<br><br>${USAGE}` };
  if (area === 'time') return cmdTime(player, sub, rest);
  if (area !== 'weather') return { type: 'error', message: `Unknown sysop area "${area}".<br>${USAGE}` };

  if (!sub) return { type: 'output', message: weatherText() };
  if (sub === 'set') {
    const [type, temp, precip] = rest;
    if (!type) return { type: 'error', message: `Options: ${WEATHER_TYPES.join(', ')}.` };
    return out(await setWeather(player, { weatherType: type, tempC: temp, precipPct: precip }));
  }
  if (sub === 'temp') return out(await setWeather(player, { tempC: rest[0] ?? NaN }));
  if (sub === 'wind') return out(await setWeather(player, { windKph: rest[0] ?? NaN }));
  if (sub === 'rain' || sub === 'precip') return out(await setWeather(player, { precipPct: rest[0] ?? NaN }));
  if (sub === 'event') {
    if (!rest.length) return { type: 'error', message: `Events: ${weatherEventOptions().map(e => e.type).join(', ')}.` };
    return out(fireWeatherEvent(player, rest.join('_')));
  }
  if (sub === 'reset' || sub === 'clear') return out(await resetWeather(player));
  return { type: 'error', message: USAGE };
}

export const commands = { sysop: cmdSysop };
