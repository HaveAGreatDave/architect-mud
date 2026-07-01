import { state } from '../state.js';
import { formatTemp, formatTempPrecise } from '/shared/settings.js';

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
let envBodyTempC = null;
let envWindKph = null;
let envHumidity = null;
let envFeelsLikeC = null;

function bodyFeelLabel(tempC) {
  if (tempC === null) return '';
  if (tempC <= 0)  return 'Freezing';
  if (tempC <= 8)  return 'Cold';
  if (tempC <= 15) return 'Chilly';
  if (tempC <= 24) return 'Comfortable';
  if (tempC <= 30) return 'Warm';
  if (tempC <= 37) return 'Hot';
  return 'Overheating';
}

function renderEnvironmentHUD() {
  if (clientMinutes === null) return;
  const timeStr = formatHHMM(clientMinutes);
  const timeIcon = timeIconForMinutes(clientMinutes);
  const tempStr = envTempC !== null ? formatTemp(envTempC) : '—';
  const feelStr = bodyFeelLabel(envTempC);
  const precipLabel = envCurrentPrecipIntensity && envCurrentPrecipIntensity !== 'none'
    ? envCurrentPrecipIntensity.charAt(0).toUpperCase() + envCurrentPrecipIntensity.slice(1)
    : '';
  for (const suffix of ['', '-m']) {
    const w  = document.getElementById(`env-weather-icon${suffix}`);
    const c  = document.getElementById(`env-clock${suffix}`);
    const t  = document.getElementById(`env-time-icon${suffix}`);
    const p  = document.getElementById(`env-temp${suffix}`);
    const bf = document.getElementById(`env-body-feel${suffix}`);
    const bt = document.getElementById(`env-body-temp${suffix}`);
    const pl = document.getElementById(`env-precip-intensity${suffix}`);
    if (w)  w.textContent  = envWeatherIcon;
    if (c)  c.textContent  = timeStr;
    if (t)  t.textContent  = timeIcon;
    if (p)  p.textContent  = tempStr;
    if (bf) bf.textContent = feelStr;
    if (bt) {
      if (envBodyTempC !== null) {
        bt.textContent = `🌡 ${formatTempPrecise(envBodyTempC)}`;
        bt.style.display = '';
      } else {
        bt.style.display = 'none';
      }
    }
    if (pl) pl.textContent = precipLabel;
  }
}

let _lastServerTick = 0;

export function updateEnvironmentHUD(env) {
  if (!env) return;
  if (env.time) clientMinutes = parseHHMM(env.time);
  if (clientMinutes === null) return; // not ready yet
  if (env.weatherIcon !== undefined) envWeatherIcon = env.weatherIcon || '—';
  if (env.tempC !== undefined) envTempC = env.tempC;
  if (env.currentWeatherType !== undefined) envCurrentWeatherType = env.currentWeatherType;
  if (env.currentIntensity !== undefined) envCurrentPrecipIntensity = env.currentIntensity;
  if (env.windKph !== undefined) envWindKph = env.windKph;
  if (env.humidityPct !== undefined) envHumidity = env.humidityPct;
  if (env.feelsLikeC !== undefined) envFeelsLikeC = env.feelsLikeC;
  _lastServerTick = Date.now();
  renderEnvironmentHUD();
  if (env.time) refreshZoneVisibility();
}

export function refreshTempDisplay() {
  const tempStr = envTempC !== null ? formatTemp(envTempC) : null;
  if (tempStr === null) return;
  for (const suffix of ['', '-m']) {
    const p  = document.getElementById(`env-temp${suffix}`);
    const bt = document.getElementById(`env-body-temp${suffix}`);
    if (p) p.textContent = tempStr;
    if (bt && envBodyTempC !== null) bt.textContent = `🌡 ${formatTempPrecise(envBodyTempC)}`;
  }
}

export function updateBodyTempHUD(tempC) {
  envBodyTempC = tempC;
  renderEnvironmentHUD();
}

// Called with a zone's current temperature. For indoor zones this carries only
// tempC (overwrites the HUD outdoor temp while inside). For outdoor zones the
// weather field also sends local cloudCover/precipType/precipRate — additive
// keys we use to reflect the player's actual tile (a passing storm cell shows
// local rain even if the global headline is "cloudy"). Old servers omit them.
export function updateZoneTempHUD(tempC, local) {
  if (clientMinutes === null) return;
  envTempC = tempC;
  // Indoor updates carry no weather payload — there's no wind chill indoors, so
  // feels-like tracks the ambient temp (matches the server's apparent temp).
  if (!(local && local.cloudCover !== undefined)) envFeelsLikeC = tempC;
  if (local && local.cloudCover !== undefined) {
    if (local.precipType !== undefined && local.precipType !== 'none') {
      envCurrentWeatherType = local.precipType;
      envCurrentPrecipIntensity = localPrecipLabel(local.precipType, local.precipRate || 0);
    } else {
      envCurrentWeatherType = local.cloudCover >= 0.5 ? 'overcast' : (local.cloudCover >= 0.2 ? 'cloudy' : 'clear');
      envCurrentPrecipIntensity = '';
    }
  }
  renderEnvironmentHUD();
}

// Coarse local intensity label from a 0..1 precip rate (the fine server labels
// live server-side; this is just enough for the local HUD line).
function localPrecipLabel(type, rate) {
  const band = rate < 0.25 ? 'light' : rate < 0.5 ? 'moderate' : rate < 0.75 ? 'heavy' : 'severe';
  return `${band} ${type === 'snow' ? 'snow' : 'rain'}`;
}

// The flicker + pop fire only on a real grid power cut, which the server signals with a
// `power-out` zone_event. dispatch.js arms this with the affected zone; the next
// visibility refresh consumes it. Ordinary day/night dimming just fades.
let _powerOutArmedZone = null;
let _visPrevBrightness = '';
let _visFlickering = false;

// Called from the zone_event handler when the server broadcasts a `power-out` for the
// player's current zone. Arms the next refresh to flicker the lights out with a pop.
export function signalPowerOut() {
  _powerOutArmedZone = state.currentZone;
}

// Apply the brightness filter to the light-sensitive panes. `instant` bypasses the
// CSS fade (used for the rapid flicker steps).
function _applyBrightnessFilter(brightness, instant) {
  for (const id of ['area-pane', 'output']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.style.transition = instant ? 'none' : '';
    el.style.filter = brightness;
  }
}

// Power-cut flicker: stutter between the previous (lit) brightness and the new dark
// level a handful of times, then settle dark. Deliberately paced (~90–200 ms/step,
// 4–6 steps → ~5–11 Hz) so it reads as a dying light, not a strobe.
function _flickerLightsOut(litBrightness, darkBrightness) {
  _visFlickering = true;
  const steps = 4 + Math.floor(Math.random() * 3); // 4–6
  let i = 0;
  const step = () => {
    if (i >= steps) {
      _applyBrightnessFilter(darkBrightness, true); // land dark without the slow fade
      for (const id of ['area-pane', 'output']) {   // restore the CSS fade for later changes
        const el = document.getElementById(id);
        if (el) el.style.transition = '';
      }
      _visFlickering = false;
      return;
    }
    _applyBrightnessFilter(i % 2 === 0 ? darkBrightness : litBrightness, true);
    i++;
    setTimeout(step, 90 + Math.random() * 110); // 90–200 ms
  };
  step();
}

// Short electric pop + buzz for a sudden power cut. Two layered one-shots on the SFX
// bus, together well under half a second so they punctuate the flicker without dragging.
function _playPowerOutSfx() {
  const eng = window.AudioEngine;
  if (!eng?.playSfx) return;
  // Buzz — a brief mains-hum crackle that pitches down as the supply dies.
  eng.playSfx({
    id: 'power_out_buzz', category: 'sfx', priority: 4,
    config: {
      waveform: 'sawtooth', freq: 120, duration: 0.22, noiseMix: 0.25, gain: 0.35,
      tremolo: { rate: 60, depth: 0.7 },
      pitchBend: { to: 40, time: 0.15 },
      filter: { type: 'lowpass', freq: 2000, q: 1 },
      adsr: { a: 0.001, d: 0.05, s: 0.4, r: 0.12 },
    },
  });
  // Pop — a sharp broadband transient: the click of the cut.
  eng.playSfx({
    id: 'power_out_pop', category: 'sfx', priority: 4,
    config: {
      waveform: 'noise', noiseMix: 1, duration: 0.05, gain: 0.5,
      filter: { type: 'bandpass', freq: 1800, q: 0.8 },
      adsr: { a: 0.001, d: 0.03, s: 0, r: 0.03 },
    },
  });
}

export function refreshZoneVisibility() {
  if (!state.currentZone) return;
  const zone = state.currentZone;
  fetch(`/api/environment/visibility/${encodeURIComponent(zone)}`)
    .then(r => r.json())
    .then(v => {
      const vis = Math.max(0, Math.min(1, v.visibility ?? 1));
      // VISIBILITY_CLEAR on the server is 0.6 — any zone at or above that is
      // considered well-lit, so clear the filter entirely to preserve theme colors.
      // Below 0.6, remap 0→0.6 to t=0→1 and dim text down to 0.2 at pitch dark.
      const brightness = vis >= 0.6
        ? ''
        : `brightness(${(0.2 + 0.8 * (vis / 0.6)).toFixed(3)})`;

      // Flicker + pop only when the server signalled a grid power cut for this zone;
      // everything else (day/night, curtains, moving rooms) just fades.
      const powerCut = _powerOutArmedZone === zone;

      if (!_visFlickering) {
        if (powerCut) { _playPowerOutSfx(); _flickerLightsOut(_visPrevBrightness, brightness); }
        else _applyBrightnessFilter(brightness, false);
      }

      if (powerCut) _powerOutArmedZone = null;
      _visPrevBrightness = brightness;

      const LIGHT_CATS = {
        pitch_dark: { label: 'Pitch Dark', color: 'var(--text-dim)' },
        dark:       { label: 'Dark',       color: 'var(--red)' },
        dim:        { label: 'Dim',        color: 'var(--yellow)' },
        clear:      { label: 'Well Lit',   color: 'var(--green)' },
      };
      const lc = LIGHT_CATS[v.category] || LIGHT_CATS.clear;
      const iconEl = document.getElementById('env-light-icon');
      const labelEl = document.getElementById('env-light-label');
      if (iconEl) iconEl.style.color = lc.color;
      if (labelEl) { labelEl.textContent = lc.label; labelEl.style.color = lc.color; }
    })
    .catch(() => {});
}

export function getEnvSnapshot() {
  if (clientMinutes === null) return null;
  return {
    time: formatHHMM(clientMinutes),
    timeIcon: timeIconForMinutes(clientMinutes),
    weatherIcon: envWeatherIcon,
    tempC: envTempC,
    bodyTempC: envBodyTempC,
    precipIntensity: envCurrentPrecipIntensity,
    weatherType: envCurrentWeatherType,
    windKph: envWindKph,
    humidityPct: envHumidity,
    feelsLikeC: envFeelsLikeC,
    // Comfort reflects the apparent temperature (wind chill / humidity), not the
    // raw thermometer reading — falls back to actual temp before the first sync.
    bodyFeel: bodyFeelLabel(envFeelsLikeC ?? envTempC),
  };
}

// Fallback tick — only increments if the server hasn't pushed in over 90 seconds
// (i.e. WS is disconnected). Normal operation is driven entirely by server pushes.
setInterval(() => {
  if (clientMinutes === null) return;
  if (Date.now() - _lastServerTick < 90_000) return;
  clientMinutes = (clientMinutes + 1) % (24 * 60);
  renderEnvironmentHUD();
}, 60_000);

