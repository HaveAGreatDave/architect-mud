import { state } from '../state.js';
import { formatTemp } from '/shared/settings.js';
import { setWeatherFx } from './weather-fx.js';

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

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "Thu 14 Jul 2087" from the server's `YYYY-MM-DD` game date + 1..7 day index.
// The day index comes off the payload rather than being derived here so the HUD
// can never disagree with the scheduler about what day it is.
function formatGameDate(dateStr, dow) {
  if (!dateStr) return '';
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '';
  const day = DAY_NAMES[(dow || 0) - 1];
  return `${day ? day + ' ' : ''}${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

// Mirrors WETNESS_LABELS in markup.js — the same ladder the `$wet` token uses,
// so the HUD and the prose never describe the same soaking differently.
const WETNESS_BANDS = [
  [85, 'Sopping'],
  [70, 'Drenched'],
  [50, 'Soaked'],
  [30, 'Wet'],
  [10, 'Damp'],
];

function wetnessLabel(v) {
  for (const [floor, label] of WETNESS_BANDS) if (v >= floor) return label;
  return 'Dry';   // bone dry still reads — the panel says where you stand, always
}

let clientMinutes = null;
let envDateStr = '';
let envWeatherIcon = '—';
let envTempC = null;
let envCurrentWeatherType = null;
let envCurrentPrecipIntensity = null;
let envBodyTempC = null;
let envWindKph = null;
let envHumidity = null;
let envFeelsLikeC = null;

// --- Weather FX overlay driver ---
// Tracked separately from the HUD labels because the overlay needs the raw
// weather taxonomy + local precip rate + indoor flag, not the display strings.
let fxIndoor = true;             // default suppressed until a visibility fetch confirms outdoors
let fxWeatherType = null;        // headline type: fog/haze/ash/clear/...
let fxPrecipType = 'none';       // active precip taxonomy (rain/snow/sleet/...)
let fxPrecipRate = 0;            // 0..1 local precip intensity
const WIND_FX_KPH = 40;          // gust streaks only show in genuinely windy weather

// ── Dream / hallucination FX override ───────────────────────────────────────
//
// A dream or a trip drives the particle field directly, ignoring the real
// weather and the indoor gate entirely. Ash falling in a windowless corridor is
// exactly the point — the room is not obeying the rules, and the cheapest way to
// SHOW that (rather than describe it) is to run weather where weather cannot be.
//
// Held here rather than pushed straight at weather-fx.js because environment
// re-resolves on every tick and would otherwise stamp the override out within a
// second.
let dreamFx = null;   // { effect, intensity } | null

export function setDreamFx(fx) {
  dreamFx = fx && fx.effect && fx.effect !== 'none'
    ? { effect: fx.effect, intensity: Math.max(0, Math.min(1, Number(fx.intensity) || 0.5)) }
    : null;
  refreshWeatherFx();
}

function resolveWeatherFx() {
  // Wins over everything, including the indoor gate.
  if (dreamFx) return { effect: dreamFx.effect, intensity: dreamFx.intensity, windKph: 0 };
  // Real weather cannot fall in an unreal room. A scripted override (dreamFx, above)
  // still can — that's a thing the corridor is DOING, not the city leaking in.
  if (envUnreal) return { effect: 'none', intensity: 0, windKph: 0 };
  if (fxIndoor) return { effect: 'none', intensity: 0, windKph: envWindKph || 0 };
  const pt = fxPrecipType;
  if (pt === 'rain' || pt === 'sleet' || pt === 'thunderstorm' || pt === 'storm' || pt === 'acid')
    return { effect: 'rain', intensity: fxPrecipRate || 0.5, windKph: envWindKph || 0 };  // acid renders as rain; the green tint is the event overlay
  if (pt === 'snow' || pt === 'blizzard')
    return { effect: 'snow', intensity: fxPrecipRate || 0.5, windKph: envWindKph || 0 };
  if (fxWeatherType === 'ash') return { effect: 'ash', intensity: 0.6, windKph: envWindKph || 0 };
  if (fxWeatherType === 'fog' || fxWeatherType === 'haze')
    return { effect: 'fog', intensity: fxWeatherType === 'fog' ? 0.85 : 0.5, windKph: envWindKph || 0 };
  if ((envWindKph || 0) >= WIND_FX_KPH)
    return { effect: 'wind', intensity: Math.min(1, ((envWindKph || 0) - 30) / 45), windKph: envWindKph || 0 };
  return { effect: 'none', intensity: 0, windKph: envWindKph || 0 };
}

function refreshWeatherFx() {
  setWeatherFx(resolveWeatherFx());
}

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

// ── The unreal environment (the prologue's corridor) ────────────────────────
//
// The Inbetween is not a place with weather in it. A HUD reading "☁ 14°C, light
// rain" over a room with no floor is the single loudest immersion break in the
// whole prologue — it tells a brand-new player that the metaphysical corridor
// they're standing in is really just a room in Coldwater. So while the server
// says the zone is unreal (`env_unreal`, pushed by plugins/prologue off
// `flags.prologue`), the weather rows come off entirely and the clock stops
// telling the truth: time doesn't run here either.
//
// Driven by a push rather than read off the zone because the client is never
// told a zone's flags — same seam, and for the same reason, as `tablet_access`.
let envUnreal = false;
const UNREAL_GLYPHS = ['?', '–', '∅', '8', '0'];

export function setEnvUnreal(on) {
  const next = !!on;
  if (next === envUnreal) return;
  envUnreal = next;
  // The weather rows and the temperature come off outright; the clock stays,
  // scrambled, because a missing clock reads as a broken HUD where a wrong one
  // reads as a wrong world.
  const hide = envUnreal ? 'none' : '';
  for (const el of document.querySelectorAll('#env-hud-sidebar .env-hud-weather, #mob-hud-env .env-hud-weather'))
    el.style.display = hide;
  renderEnvironmentHUD();   // repaints the clock and the weather rows
  refreshWeatherFx();       // and stops any rain that was already falling
}

export function isEnvUnreal() { return envUnreal; }

// A clock that means nothing, and means something different every tick.
function unrealClockStr() {
  const g = () => UNREAL_GLYPHS[Math.floor(Math.random() * UNREAL_GLYPHS.length)];
  return `${g()}${g()}:${g()}${g()}`;
}

function renderEnvironmentHUD() {
  if (clientMinutes === null) return;
  const timeStr = envUnreal ? unrealClockStr() : formatHHMM(clientMinutes);
  const timeIcon = envUnreal ? '∞' : timeIconForMinutes(clientMinutes);
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
    const pl = document.getElementById(`env-precip-intensity${suffix}`);
    if (w)  w.textContent  = envWeatherIcon;
    if (c)  c.textContent  = timeStr;
    // The date goes with the clock: the corridor has no calendar either, so it
    // comes off outright rather than being scrambled (a garbled date reads as a bug).
    const dt = document.getElementById(`env-date${suffix}`);
    if (dt) dt.textContent = envUnreal ? '' : envDateStr;
    if (t)  t.textContent  = timeIcon;
    if (p)  p.textContent  = tempStr;
    // `bf` is how the AIR feels and stays — it sits at the right edge of the
    // wetness row in the sidebar (the temp row's own right edge is the reading),
    // which is what keeps every value on one column. It is how the AIR feels and stays — that's the world describing itself.
    // Your own core temperature does NOT appear here any more: it is one of the
    // things you are meant to feel through prose (shivering, sweating, the
    // hypothermia lines) rather than read off a gauge to two decimal places.
    // The value is still tracked and still drives everything it drove before.
    if (bf) bf.textContent = feelStr;
    if (pl) pl.textContent = precipLabel;
  }
  // The mobile precip line has a row to itself (the sidebar shares one with the
  // light readout), so an empty label has to take the row with it or it leaves a
  // gap in a column where every pixel is contested.
  const mPrecipRow = document.getElementById('env-precip-intensity-m')?.parentElement;
  if (mPrecipRow && !envUnreal) mPrecipRow.style.display = precipLabel ? '' : 'none';
  renderWetnessRow();
}

// Your own soaking, read straight off the live player object — the wetness tick
// already pushes `player_update: { wetness }`, so there is nothing new on the wire.
// Bone dry reads "Dry" rather than vanishing — a row that disappears leaves the
// panel looking incomplete, and "Dry" is an answer. Only the unreal (dream/void)
// case drops it, where there is no body weather to report.
function renderWetnessRow() {
  const label = envUnreal ? '' : wetnessLabel(Math.round(state.player?.wetness ?? 0));
  for (const suffix of ['', '-m']) {
    const row = document.getElementById(`env-wet-row${suffix}`);
    const el  = document.getElementById(`env-wetness${suffix}`);
    if (el) el.textContent = label;
    if (row) row.style.display = label ? '' : 'none';
  }
}

// Called when the player object changes (resource ticks carry wetness).
export function refreshWetnessHUD() { renderWetnessRow(); }

let _lastServerTick = 0;

export function updateEnvironmentHUD(env) {
  if (!env) return;
  if (env.time) clientMinutes = parseHHMM(env.time);
  if (env.date !== undefined) envDateStr = formatGameDate(env.date, env.dayOfWeek);
  if (clientMinutes === null) return; // not ready yet
  if (env.weatherIcon !== undefined) envWeatherIcon = env.weatherIcon || '—';
  if (env.tempC !== undefined) envTempC = env.tempC;
  if (env.currentWeatherType !== undefined) envCurrentWeatherType = env.currentWeatherType;
  if (env.currentIntensity !== undefined) envCurrentPrecipIntensity = env.currentIntensity;
  if (env.windKph !== undefined) envWindKph = env.windKph;
  if (env.humidityPct !== undefined) envHumidity = env.humidityPct;
  if (env.feelsLikeC !== undefined) envFeelsLikeC = env.feelsLikeC;
  // Headline weather type (carries fog/haze/ash) + wind feed the FX overlay; the
  // visibility fetch below refines indoor/outdoor and local precip authoritatively.
  if (env.currentWeatherType !== undefined) { fxWeatherType = env.currentWeatherType; refreshWeatherFx(); }
  _lastServerTick = Date.now();
  renderEnvironmentHUD();
  if (env.time) refreshZoneVisibility();
}

export function refreshTempDisplay() {
  const tempStr = envTempC !== null ? formatTemp(envTempC) : null;
  if (tempStr === null) return;
  for (const suffix of ['', '-m']) {
    const p  = document.getElementById(`env-temp${suffix}`);
    if (p) p.textContent = tempStr;
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
  // Weather-FX side-channel. Only touch indoor/precip state when a real zoneTempTick
  // carries `local` — the move handler calls us with tempC only, and the per-room
  // visibility fetch is the authoritative indoor/outdoor source for that path.
  if (local && local.cloudCover !== undefined) {          // outdoor tick
    fxIndoor = false;
    fxPrecipType = (local.precipType && local.precipType !== 'none') ? local.precipType : 'none';
    fxPrecipRate = local.precipRate || 0;
    refreshWeatherFx();
  } else if (local) {                                       // indoor per-minute tick
    fxIndoor = true;
    refreshWeatherFx();
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
  // Inverse factor for panes that opt out of the dimming (e.g. the Exits line):
  // a child brightness(1/x) cancels the parent's brightness(x) back to normal.
  const m = /brightness\(([\d.]+)\)/.exec(brightness);
  const undim = m ? (1 / parseFloat(m[1])).toFixed(3) : '1';
  for (const id of ['area-pane', 'output']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.style.transition = instant ? 'none' : '';
    el.style.filter = brightness;
    el.style.setProperty('--vis-undim', undim);
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

// `preloaded` is a visibility object the server already sent (the move payload
// carries one — describeZone computes the same value the /environment/visibility
// route would, so re-fetching it is a wasted round trip). Callers without one
// still fetch.
export function refreshZoneVisibility(preloaded) {
  if (!state.currentZone) return;
  const zone = state.currentZone;
  const apply = (v) => {
      const vis = Math.max(0, Math.min(1, v.visibility ?? 1));
      // VISIBILITY_CLEAR on the server is 0.6 — any zone at or above that is
      // considered well-lit, so clear the filter entirely to preserve theme colors.
      // Below 0.6, remap 0→0.6 to t=0→1 and dim the text toward DARK_FLOOR.
      //
      // The floor was 0.2 and a pitch-dark room was a log you squinted at rather
      // than read. This is a READABILITY setting and nothing else: the server's
      // `visibility` still drives to-hit, the stealth notice roll and what `look`
      // shows you, all untouched, so the room is exactly as dangerous as it was.
      //
      // DAYLIGHT LIFT. A dark room with a bright day outside it is a room you can
      // still read in — light gets in around a door, through a gap, off the
      // street. So the floor lifts by up to DAY_LIFT at noon, tapering to nothing
      // at night, and never past 1 (normal text is the ceiling; nothing about
      // being in the dark should make the log brighter than usual).
      //
      // Except underground, where there is no sky to leak in. `buried` is the
      // server's own answer (`skyVantage`), the same predicate that decides
      // whether The Under hears a weather announcement.
      const DARK_FLOOR = 0.35;
      const DAY_LIFT = 0.15;
      const daylight = v.buried ? 0 : Math.max(0, Math.min(1, v.daylight ?? 0));
      const lift = 1 + DAY_LIFT * daylight;
      const level = Math.min(1, (DARK_FLOOR + (1 - DARK_FLOOR) * (vis / 0.6)) * lift);
      const brightness = vis >= 0.6 ? '' : `brightness(${level.toFixed(3)})`;

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
        blazing:    { label: 'Blazing',    color: 'var(--cyan)' },
        bright:     { label: 'Bright',     color: 'var(--green)' },
        clear:      { label: 'Well Lit',   color: 'var(--green)' },
        dim:        { label: 'Dim',        color: 'var(--yellow)' },
        gloomy:     { label: 'Gloomy',     color: 'var(--orange)' },
        dark:       { label: 'Dark',       color: 'var(--red)' },
        murk:       { label: 'Murky',      color: 'var(--purple)' },
        pitch_dark: { label: 'Pitch Dark', color: 'var(--text-dim)' },
      };
      // Authoritative per-room weather for the FX overlay — drives it the instant
      // a room is entered (old servers omit these keys; the periodic ticks still
      // keep it live). `outdoor` present ⇒ new server; treat absent as "no change".
      if (v.outdoor !== undefined) {
        fxIndoor = !v.outdoor;
        fxWeatherType = v.weatherType ?? fxWeatherType;
        fxPrecipType = v.precipType ?? 'none';
        fxPrecipRate = v.precipRate || 0;
        if (v.windKph !== undefined) envWindKph = v.windKph;
        refreshWeatherFx();
      }

      const lc = LIGHT_CATS[v.category] || LIGHT_CATS.clear;
      for (const suffix of ['', '-m']) {
        const iconEl = document.getElementById(`env-light-icon${suffix}`);
        const labelEl = document.getElementById(`env-light-label${suffix}`);
        if (iconEl) iconEl.style.color = lc.color;
        if (labelEl) { labelEl.textContent = lc.label; labelEl.style.color = lc.color; }
      }
  };

  if (preloaded) { apply(preloaded); return; }

  // Send the player's API token so the server can apply THIS player's perception
  // (a carried lit flashlight lifts the room's visibility for them) — otherwise
  // the brightness filter reflects only ambient zone lighting.
  const token = sessionStorage.getItem('devpanel-token');
  fetch(`/api/environment/visibility/${encodeURIComponent(zone)}`,
    token ? { headers: { Authorization: `Bearer ${token}` } } : undefined)
    .then(r => r.json())
    .then(apply)
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

// Whether the player is currently indoors, per the authoritative visibility/tick state.
// Consumers that only make sense outdoors (e.g. the on-foot fireworks sky-flash) gate on this.
export function isFxIndoors() {
  return fxIndoor;
}

// Fallback tick — only increments if the server hasn't pushed in over 90 seconds
// (i.e. WS is disconnected). Normal operation is driven entirely by server pushes.
setInterval(() => {
  if (clientMinutes === null) return;
  if (Date.now() - _lastServerTick < 90_000) return;
  clientMinutes = (clientMinutes + 1) % (24 * 60);
  renderEnvironmentHUD();
}, 60_000);

