/**
 * Weather plugin — owns the 7-day deterministic forecast.
 *
 * Subscribes to hooks from environment.js:
 *   environment.init             — load (or generate) forecast at boot
 *   environment.advanceWeather   — shift forecast forward one day (tick24h)
 *   environment.recalculateForecast — full regeneration from climate profile
 */
import { createHash } from 'node:crypto';
import { query } from '../../server/models/db.js';
import { on } from '../../server/engine/events.js';
import { getAllLivePlayers } from '../../server/engine/world.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { recomputeEquipped } from '../../server/engine/commands/inventory.js';
import { registerAction } from '../../server/engine/actions.js';
import { devTriggerWeatherEvent } from '../../server/engine/environment.js';

const SEASON_BY_MONTH = [
  'winter', 'winter', 'spring', 'spring', 'spring', 'summer',
  'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter',
];

const SEASON_BASE_TEMP_C  = { winter: 2,    spring: 12, summer: 24, autumn: 11 };
const SEASON_BASE_PRECIP  = { winter: 0.35, spring: 0.40, summer: 0.35, autumn: 0.45 };
// Prevailing wind runs higher in the cold, unsettled seasons and drops in summer.
const SEASON_BASE_WIND_KPH = { winter: 22, spring: 18, summer: 13, autumn: 20 };
// Damp air pools in the cold seasons; summer runs drier by default.
const SEASON_BASE_HUMIDITY = { winter: 82, spring: 70, summer: 58, autumn: 78 };

// How each weather type scales the day's wind. Fog and haze only form in near-still
// air, so they pull wind right down; storms and blizzards are wind events by nature.
const WIND_BY_WEATHER = {
  clear: 0.7, fog: 0.25, haze: 0.4, cloudy: 1.0, overcast: 1.1,
  rain: 1.2, sleet: 1.25, snow: 1.0, thunderstorm: 1.9, blizzard: 2.0, storm: 2.0,
};

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

// Turn a climate/season baseline into a concrete day's wind. The weather type sets
// the ceiling (a foggy day can't be a gale); on top of that we roll the day's
// "windiness": most days sit near the mean, but ~15% come out dead calm and ~15%
// blow up into a gusty day. Deterministic — driven by the shared rand stream.
function windForDay(baseWind, weatherType, rand) {
  const typeMult = WIND_BY_WEATHER[weatherType] ?? 1.0;
  const r = rand();
  let dayMult;
  if (r < 0.15)      dayMult = 0.3 + rand() * 0.3;   // calm day
  else if (r > 0.85) dayMult = 1.4 + rand() * 0.8;   // windy / gusty day
  else               dayMult = 0.7 + rand() * 0.7;   // ordinary day
  return Math.max(0, Math.round(baseWind * typeMult * dayMult));
}

// Turn a climate/season baseline into a concrete day's relative humidity. The
// weather type drives it hard: fog and rain mean saturated air, clear skies dry
// it out. Small day-to-day jitter on top. Deterministic via the shared stream.
function humidityForDay(baseHumidity, weatherType, rand) {
  let h = baseHumidity;
  if (weatherType === 'fog')              h += 18;
  else if (weatherType === 'haze')        h += 6;
  else if (weatherType === 'clear')       h -= 15;
  else if (weatherType === 'cloudy')      h += 2;
  else if (weatherType === 'overcast')    h += 8;
  else if (PRECIP_TYPES.has(weatherType)) h += 14;   // rain/sleet/snow/blizzard/thunderstorm/storm
  h += Math.round((rand() - 0.5) * 12);              // ±6 day jitter
  return Math.max(15, Math.min(100, Math.round(h)));
}

function precipTypeForTemp(tempC, rand) {
  const heavy = rand() < 0.25;
  if (tempC > 3)  return heavy ? 'thunderstorm' : 'rain';
  if (tempC > -1) return 'sleet';
  if (tempC > -8) return heavy ? 'blizzard' : 'snow';
  return 'blizzard';
}

// ── Day-to-day temperature: an autocorrelated anomaly, not a fresh coin flip ──
// Until 2026-07-21 this was `variance = (rand() - 0.5) * (isExtreme ? 40 : 20)` — an
// INDEPENDENT UNIFORM roll per day. Measured over a simulated year that produced a
// mean day-to-day jump of 7.4°C (real temperate climates run 2-3°C), moved 10°C or
// more on 32% of days, and spread winter across -18°C..21°C — so a winter day could
// come out warmer than a summer one. Uniform also made a +10°C day exactly as likely
// as an average one, which is not how air temperature is distributed.
//
// Air masses persist for days, so the anomaly is smooth value noise over the day
// index, summed over three octaves: a slow regime, the synoptic (frontal) week, and
// short-term wobble. Consecutive days now differ by a couple of degrees, hot and cold
// spells last several days instead of teleporting in and out, and most days sit near
// the seasonal mean with the tails getting rarer.
//
// Still a pure function of the date — no state, no chaining — so a day generated a
// week ahead in the forecast matches the day when it arrives.
//
// Octaves alone come out unnaturally SMOOTH (mean day-to-day change 0.45°C, i.e. most
// consecutive days identical once rounded). Real daily temperature carries a
// mesoscale/local component on top of the synoptic signal, so a small independent
// per-day jitter rides the octaves. Tuned against a 3,000-day simulation to
// mean |Δday| 1.5°C, σ 2.7°C, range about ±9°C — a maritime basin, which is what
// Coldwater is.
const TEMP_OCTAVES = [[25, 3.4], [6.5, 2.9], [2.8, 2.0], [1.4, 1.1]];  // [period in days, amplitude °C]
const TEMP_JITTER_C = 2.0;                                              // ± per-day mesoscale noise

function dayIndexOf(dateStr) {
  return Math.floor(Date.UTC(+dateStr.slice(0, 4), +dateStr.slice(5, 7) - 1, +dateStr.slice(8, 10)) / 86400000);
}
function noiseAnchor(n) { return mulberry32(seedFromString(`tempnoise:${n}`))() * 2 - 1; }  // -1..1
function smoothNoise(t) {
  const i = Math.floor(t), f = t - i;
  const u = f * f * (3 - 2 * f);                             // smoothstep — C1, no kinks at anchors
  return noiseAnchor(i) * (1 - u) + noiseAnchor(i + 1) * u;
}
// Signed °C departure from the seasonal base for a given day. Bounded by the octave
// sum plus jitter (±11.4°C worst case); typical magnitude is ~2.7°C.
function tempAnomalyC(dayIndex) {
  let a = TEMP_JITTER_C * (mulberry32(seedFromString(`tempjit:${dayIndex}`))() * 2 - 1);
  for (const [period, amp] of TEMP_OCTAVES) a += amp * smoothNoise(dayIndex / period);
  return a;
}

function generateWeatherForDate(dateStr, climateProfile) {
  const rand = mulberry32(seedFromString(`weather:${dateStr}`));
  const month = Number(dateStr.slice(5, 7)) - 1;
  const season = seasonForDate(dateStr);

  const baseTemp     = climateProfile?.monthly_temp_c?.[month]        ?? SEASON_BASE_TEMP_C[season];
  const precipChance = climateProfile?.monthly_precip_chance?.[month] ?? SEASON_BASE_PRECIP[season];
  const baseWind     = climateProfile?.monthly_wind_kph?.[month]      ?? SEASON_BASE_WIND_KPH[season];
  const baseHumidity = climateProfile?.monthly_humidity?.[month]      ?? SEASON_BASE_HUMIDITY[season];

  const tempC = Math.round(baseTemp + tempAnomalyC(dayIndexOf(dateStr)));

  let weatherType;
  if (rand() < precipChance) {
    weatherType = precipTypeForTemp(tempC, rand);
  } else {
    // Dry days: cloudiness scales with precipChance
    const r = rand();
    if (r < precipChance * 0.5)           weatherType = 'overcast';
    else if (r < precipChance * 0.85)     weatherType = 'cloudy';
    else if (rand() < precipChance * 0.3) weatherType = rand() < 0.5 ? 'fog' : 'haze';
    else                                  weatherType = 'clear';
  }

  // Wind and humidity are rolled last so adding them never shifts the
  // temp/precip/type outcomes above for a given date+climate.
  const windKph     = windForDay(baseWind, weatherType, rand);
  const humidityPct = humidityForDay(baseHumidity, weatherType, rand);

  return { weatherType, tempC, precipChance, windKph, humidityPct };
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

// Always replaces all 7 days — no locking.
async function regenerateFullForecast(startDate, climateProfile) {
  await query('DELETE FROM weather_forecast');
  for (let i = 0; i < 7; i++) {
    const date = addDays(startDate, i);
    const { weatherType, tempC, windKph, humidityPct } = generateWeatherForDate(date, climateProfile);
    await query(
      `INSERT INTO weather_forecast (forecast_day, game_date, weather_type, temp_c, wind_kph, humidity_pct)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [i, date, weatherType, tempC, windKph, humidityPct]
    );
  }
}

async function loadForecast(setWeatherState, climateProfile) {
  let { rows } = await query('SELECT * FROM weather_forecast ORDER BY forecast_day ASC');
  if (rows.length === 0) {
    const { rows: clockRows } = await query('SELECT game_date FROM world_clock WHERE id = 1');
    const startDate = clockRows[0] ? toDateString(clockRows[0].game_date) : new Date().toISOString().slice(0, 10);
    await regenerateFullForecast(startDate, climateProfile);
    ({ rows } = await query('SELECT * FROM weather_forecast ORDER BY forecast_day ASC'));
  }
  const forecast = rows.map(r => {
    const date = toDateString(r.game_date);
    const { precipChance } = generateWeatherForDate(date, climateProfile);
    return {
      forecastDay: r.forecast_day,
      date,
      weatherType: r.weather_type,
      tempC: r.temp_c,
      windKph: r.wind_kph,
      humidityPct: r.humidity_pct,
      precipChance,
      severity: severityForForecast0(r.weather_type, r.temp_c, r.wind_kph),
      // Derived, never stored — which is why it survives the forecast being
      // regenerated, rescheduled, or overridden from the dev panel.
      ...heroFieldsFor(date),
    };
  });
  setWeatherState(forecast[0].weatherType, forecast[0].tempC, forecast);
  return forecast;
}

// ---------------------------------------------------------------------------
// Per-zone weather field
//
// A handful of moving "systems" (cloud / precip / storm cells) drift across the
// outdoor map (map_world). Each outdoor zone samples the field by its grid_x/
// grid_y to get local cloud cover, precip, a temperature offset and storm
// intensity. Deterministic per day (same seed scheme as the forecast). The
// engine never imports this plugin — it holds the sampler we hand it at init
// (registerWeatherField), exactly like setWeatherState / rollAndSetCurrentPrecip.
// The field is fully re-derivable from (date, forecast[0], seed): no DB table,
// no per-tick writes. See docs/systems-world.md.
// ---------------------------------------------------------------------------

const K_TEMP = 4;                                   // °C pulled down at a cell core
const STORM_TYPES  = new Set(['thunderstorm', 'storm']);
const PRECIP_TYPES = new Set(['rain', 'sleet', 'snow', 'blizzard', 'thunderstorm', 'storm']);

// ── Extreme-weather severity (0..1) ─────────────────────────────────────────
// One derived scalar the whole extreme-weather layer reads (see
// docs/systems-weather-extreme.md). baseSeverity is a day-level property rolled
// from forecast[0]; sampleWeatherAt intensifies it locally under storm/precip
// cells. Cold and heat use raw forecast tempC (the engine folds wind chill into
// the thermal channel separately); wind and type contribute via max(), so
// "very cold OR gale OR blizzard" all read severe without double-counting.
const COLD_LETHAL_C = -12, COLD_RANGE = 25;   // -12°C → 0 … -37°C → 1
const HEAT_LETHAL_C = 38,  HEAT_RANGE = 12;   //  38°C → 0 …  50°C → 1
const GALE_KPH      = 45,  WIND_RANGE = 45;   //  45kph → 0 …  90kph → 1
const PRECIP_SEVERE = 0.7;                    // local precipRate above this adds severity
const TYPE_FLOOR    = { blizzard: 0.5, storm: 0.5, thunderstorm: 0.35, ash: 0.4, sleet: 0.2 };

function clamp01(n) { return Math.max(0, Math.min(1, n)); }

function severityForForecast0(weatherType, tempC, windKph) {
  const cold = (COLD_LETHAL_C - tempC) / COLD_RANGE;
  const heat = (tempC - HEAT_LETHAL_C) / HEAT_RANGE;
  const wind = ((windKph ?? 0) - GALE_KPH) / WIND_RANGE;
  const type = TYPE_FLOOR[weatherType] ?? 0;
  return clamp01(Math.max(cold, heat, wind, type));
}

const field = {
  systems: [],        // moving cells (below)
  baseCloud: 0,       // ambient cloudiness floor from weatherType
  date: null,         // the game date the field was seeded for (drives hero-event scheduling)
  baseSeverity: 0,    // day-level extreme-weather severity floor from forecast[0]
  bounds: null,       // { minX, maxX, minY, maxY } of map_world, cached
  wind: null,         // { angle, kph } — the prevailing wind that drifts every cell
  regionBoxes: [],    // [{ id, temp, dryness, minX..maxY, area }] — static per-region climate lean
};

// ── Per-region climate bias ─────────────────────────────────────────────────
// A STATIC lean folded into the field sampler so a whole region reads warmer/
// drier (or cooler/wetter) than the global forecast — WITHOUT its own forecast.
// Because both the visual field (weather map, ambient light) and felt temperature
// (getZoneTemperature → body-temp/survival) read sampleWeatherAt, this single spot
// covers both. Regions absent here are the baseline (no bias).
//   temp    — °C added to every cell's tempOffset in the region (felt warmer/cooler)
//   dryness — 0..1 multiplier on local precip + cloud (0.6 = ~40% drier/clearer)
// Boxes are resolved from each region's zone extent; a cell picks the SMALLEST box
// it falls in, so a small region nested inside a big one wins. The effective bias
// per region is regions.climate_bias (dev-panel editable) if set, else the
// hardcoded default below — so The Reach ships hot+dry with no DB write required,
// and a dev can retune any region (or bias a new one) from the Weather tab.
const REGION_BIAS = {
  region_the_reach: { temp: 9, dryness: 0.6 },   // far-future frontier: hotter + drier
};

function effectiveBias(id, dbBias) {
  const b = dbBias || REGION_BIAS[id] || null;
  if (!b) return null;
  const temp = Number(b.temp) || 0;
  const dryness = (b.dryness == null) ? null : Number(b.dryness);
  if (!temp && dryness == null) return null;   // baseline — no box
  return { temp, dryness };
}

async function computeRegionBoxes() {
  // Join each region's stored bias to its zone extent on the outdoor map. Regions
  // with neither a stored bias nor a hardcoded default fall out (baseline).
  const { rows } = await query(
    `SELECT r.id AS id, r.climate_bias AS bias,
            MIN(z.grid_x) AS minx, MAX(z.grid_x) AS maxx,
            MIN(z.grid_y) AS miny, MAX(z.grid_y) AS maxy
       FROM regions r
       JOIN zones z ON z.flags->>'region_id' = r.id
      WHERE z.map_id = 'map_world' AND z.grid_x IS NOT NULL AND z.grid_y IS NOT NULL
      GROUP BY r.id, r.climate_bias`
  ).catch(() => ({ rows: [] }));
  return rows
    .map(r => ({ r, eff: effectiveBias(r.id, r.bias) }))
    .filter(({ r, eff }) => eff && r.minx != null)
    .map(({ r, eff }) => ({
      id: r.id, temp: eff.temp, dryness: eff.dryness,
      minX: r.minx, maxX: r.maxx, minY: r.miny, maxY: r.maxy,
      area: (r.maxx - r.minx + 1) * (r.maxy - r.miny + 1),
    }))
    .sort((a, b) => a.area - b.area);   // smallest first → nested region wins
}

function regionBiasAt(gx, gy) {
  for (const r of field.regionBoxes) {
    if (gx >= r.minX && gx <= r.maxX && gy >= r.minY && gy <= r.maxY) return r;
  }
  return null;
}

// ── Named "hero" weather events (step 7) ────────────────────────────────────
// Rare, announced events that ride ON TOP of the forecast/field with an
// approach→peak→passing lifecycle, forcing a severity preset (and, for acid
// rain, a precip override) instead of deriving it. Owned here (the field owner);
// the engine drives the lifecycle by calling stepWeatherEvent() on its 30s tick
// and broadcasting the returned announce lines. See docs/systems-weather-extreme.md.
//
// Every entry MUST carry a `present` block. A hero event is not just a severity
// preset — it is the thing the whole world talks about while it happens, and the
// surfaces that talk about it (forecast icon, weather FX overlay, soundscape bed,
// weatherman pools, tablet news) all read this one block rather than each keeping
// their own `if (type === 'ion_storm')`. Adding a third hero event should be a
// matter of filling this in, not of hunting through eight files.
//
//   icon      forecast/tablet glyph for a day carrying this event
//   fx        weather-FX overlay key (client/game/js/panels/weather-fx.js)
//   audio     ambience id / route suffix (plugins/audio WEATHER_EVENT_*)
//   pool      `.bsm` pool suffix — sky.<pool> / warn.<pool> / weather.<pool>
//   sky       the pseudo weather-type the flight windshield renders it as
//   severe    the one-word severity the news and the weatherman lean on
const NAMED_EVENTS = {
  ion_storm: {
    label: 'ion storm', severity: 0.9,
    present: { icon: '⚡', fx: 'ion_storm', audio: 'ion', pool: 'ion', sky: 'ion_storm', severe: 'catastrophic' },
    phases: {
      approach: { secs: 90,  line: 'A sick green glow crawls up the horizon and the air begins to hum with static.' },
      peak:     { secs: 240, line: 'The ion storm breaks overhead — the sky screams white and every hair stands on end.' },
      passing:  { secs: 90,  line: 'The screaming static bleeds away. The ion storm is passing.' },
    },
  },
  acid_rain: {
    label: 'acid rain', severity: 0.6, precipOverride: 'acid',
    present: { icon: '☣', fx: 'acid_rain', audio: 'acid', pool: 'acid', sky: 'acid_rain', severe: 'lethal' },
    phases: {
      approach: { secs: 90,  line: 'The rain thickens and takes on a yellow, chemical reek. Something is wrong with it.' },
      peak:     { secs: 300, line: 'The downpour turns caustic — acid rain, hissing where it lands.' },
      passing:  { secs: 90,  line: 'The rain loses its bite and washes clean again. The acid storm is passing.' },
    },
  },
};
const PHASE_ORDER = ['approach', 'peak', 'passing'];
// An unscheduled event can still ambush you, but it's now the rare case — the
// ordinary path is a scheduled day (below), which the forecast has been warning
// about for a week.
const AUTO_EVENT_CHANCE_PER_30S = 0.00002;

// ── Scheduled hero days ─────────────────────────────────────────────────────
//
// Derived from the date, exactly like everything else in this file: no table, no
// state, no chaining. That is what lets the SEVEN-DAY FORECAST know a hero event
// is coming — a scheduled day is knowable a week out, which is the whole point
// of giving these events teeth. You get to prepare, or you get to find out.
//
// What stays hidden is WHEN in the day it lands: the roll below is per-30s
// against a rate that makes arrival near-certain across a game day, so the band
// is a warning, never a timetable.
const HERO_EVENT_DAY_CHANCE = 0.12;              // ~1 hero day in 8
const SCHEDULED_EVENT_CHANCE_PER_30S = 0.004;    // ~1-in-250 per tick on its day

export function heroEventForDate(dateStr) {
  if (!dateStr) return null;
  const rand = mulberry32(seedFromString(`heroevent:${dateStr}`));
  if (rand() >= HERO_EVENT_DAY_CHANCE) return null;
  const types = Object.keys(NAMED_EVENTS);
  return types[Math.floor(rand() * types.length)];
}

// Presentation block for a type, or null. The one accessor every surface uses.
export function heroEventPresentation(type) {
  const def = NAMED_EVENTS[type];
  return def ? { type, label: def.label, ...def.present } : null;
}

// The three fields a forecast row carries for a hero day. Attached HERE rather
// than looked up in the engine's WEATHER_ICON table, because the plugin owns
// what a hero event looks like and the engine must not import the plugin.
function heroFieldsFor(dateStr) {
  const type = heroEventForDate(dateStr);
  if (!type) return { heroEvent: null, heroEventIcon: null, heroEventLabel: null };
  const p = heroEventPresentation(type);
  return { heroEvent: type, heroEventIcon: p.icon, heroEventLabel: p.label };
}

let activeEvent = null;   // { type, phase, phaseEndsAtMs } | null
let scheduledFiredFor = null;   // date string whose scheduled event already ran

// Phase-ramped severity: half in approach/passing, full at peak.
function eventSeverity() {
  if (!activeEvent) return 0;
  const mult = activeEvent.phase === 'peak' ? 1 : 0.5;
  return NAMED_EVENTS[activeEvent.type].severity * mult;
}
// Acid precip override applies only at peak.
function eventPrecipOverride() {
  if (!activeEvent || activeEvent.phase !== 'peak') return null;
  return NAMED_EVENTS[activeEvent.type].precipOverride ?? null;
}
// The severity floor the whole extreme-weather layer reads — the forecast-derived
// day floor, lifted by any active named event.
function currentBaseSeverity() {
  return Math.min(1, Math.max(field.baseSeverity, eventSeverity()));
}

function startWeatherEvent(type) {
  const def = NAMED_EVENTS[type];
  if (!def) return null;
  activeEvent = { type, phase: 'approach', phaseEndsAtMs: Date.now() + def.phases.approach.secs * 1000 };
  return def.phases.approach.line;
}

// Current event as { type, phase } | null — the signal the engine broadcasts to
// clients (FX overlay) and re-emits for the audio plugin (soundscape bed).
function currentEventSnapshot() {
  return activeEvent ? { type: activeEvent.type, phase: activeEvent.phase } : null;
}

// Advance the lifecycle by wall-clock and/or auto-roll a new event. Returns
// { lines, event } — announce lines to broadcast + the current event snapshot.
// Called by the engine every 30s.
function stepWeatherEvent() {
  const now = Date.now();
  const lines = [];
  if (!activeEvent) {
    // Today's scheduled hero event, if this is one of its days and it hasn't
    // already been and gone. The forecast has shown this coming all week; only
    // the hour of arrival was ever a secret.
    const today = field.date;
    const scheduled = today && scheduledFiredFor !== today ? heroEventForDate(today) : null;
    if (scheduled && Math.random() < SCHEDULED_EVENT_CHANCE_PER_30S) {
      scheduledFiredFor = today;
      const line = startWeatherEvent(scheduled);
      if (line) lines.push(line);
    } else if (Math.random() < AUTO_EVENT_CHANCE_PER_30S) {
      const types = Object.keys(NAMED_EVENTS);
      const line = startWeatherEvent(types[Math.floor(Math.random() * types.length)]);
      if (line) lines.push(line);
    }
    return { lines, event: currentEventSnapshot() };
  }
  const def = NAMED_EVENTS[activeEvent.type];
  while (activeEvent && now >= activeEvent.phaseEndsAtMs) {
    const next = PHASE_ORDER[PHASE_ORDER.indexOf(activeEvent.phase) + 1];
    if (!next) { activeEvent = null; break; }
    activeEvent.phase = next;
    activeEvent.phaseEndsAtMs = now + def.phases[next].secs * 1000;
    lines.push(def.phases[next].line);
  }
  return { lines, event: currentEventSnapshot() };
}

// Dev trigger (engine devTriggerWeatherEvent → here).
function triggerWeatherEvent(type) {
  if (!NAMED_EVENTS[type]) return { ok: false, error: `Unknown event "${type}". Options: ${Object.keys(NAMED_EVENTS).join(', ')}` };
  const line = startWeatherEvent(type);
  return { ok: true, line, label: NAMED_EVENTS[type].label, event: currentEventSnapshot() };
}

function smoothstep(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

function precipTypeForFieldTemp(tempC) {
  return tempC <= 1 ? 'snow' : 'rain';
}

async function computeBounds() {
  const { rows } = await query(
    `SELECT MIN(grid_x) AS minx, MAX(grid_x) AS maxx, MIN(grid_y) AS miny, MAX(grid_y) AS maxy
     FROM zones WHERE map_id = 'map_world' AND grid_x IS NOT NULL AND grid_y IS NOT NULL`
  ).catch(() => ({ rows: [] }));
  const r = rows[0] || {};
  if (r.minx == null) return { minX: 0, maxX: 10, minY: 0, maxY: 10 };
  return { minX: r.minx, maxX: r.maxx, minY: r.miny, maxY: r.maxy };
}

// Build the day's systems from forecast[0]. count/intensity scale with weather
// type + precipChance; positions/velocities are seeded so the layout and the
// prevailing wind are reproducible for a given date.
function systemsForForecast(weatherType, precipChance, tempC, windKph, bounds, rand) {
  const width  = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const span   = Math.max(width, height);

  // One prevailing wind for the day; each cell jitters around it. When the
  // forecast carries a wind speed, the fronts drift proportionally faster — a
  // calm day barely moves, a gale rips across the map. Falls back to a random
  // breeze when no wind figure is available.
  const windAngle = rand() * Math.PI * 2;
  const windSpeed = windKph != null
    ? 0.05 + Math.min(1, windKph / 60) * 0.30       // ~0.05 (calm) → 0.35 (gale)
    : 0.08 + rand() * 0.22;                          // grid units per 30s advect
  const baseVx = Math.cos(windAngle) * windSpeed;
  const baseVy = Math.sin(windAngle) * windSpeed;

  const pType = precipTypeForFieldTemp(tempC);
  const systems = [];
  const spawn = (type, intensity) => {
    const radius = span * (0.22 + rand() * 0.18);   // covers a fraction of the map
    systems.push({
      x: bounds.minX + rand() * width,
      y: bounds.minY + rand() * height,
      vx: baseVx * (0.7 + rand() * 0.6),
      vy: baseVy * (0.7 + rand() * 0.6),
      radius, type, intensity, precipType: pType,
    });
  };

  let baseCloud = 0, cloudCells = 0, precipCells = 0, stormCells = 0;
  if (weatherType === 'clear')                  { cloudCells = rand() < 0.5 ? 1 : 0; }
  else if (weatherType === 'fog' || weatherType === 'haze') { baseCloud = 0.3; cloudCells = 1; }
  else if (weatherType === 'cloudy')            { baseCloud = 0.4; cloudCells = 2 + Math.floor(rand() * 2); }
  else if (weatherType === 'overcast')          { baseCloud = 0.7; cloudCells = 2 + Math.floor(rand() * 3); }
  else if (STORM_TYPES.has(weatherType))        { baseCloud = 0.5; cloudCells = 1 + Math.floor(rand() * 2); stormCells = 1 + Math.floor(rand() * 2); }
  else if (PRECIP_TYPES.has(weatherType))       { baseCloud = 0.45; cloudCells = 2; precipCells = 1 + Math.floor(rand() * 2); }
  else                                          { cloudCells = 1; }

  for (let i = 0; i < cloudCells;  i++) spawn('cloud',  0.5 + rand() * 0.4);
  for (let i = 0; i < precipCells; i++) spawn('precip', 0.5 + precipChance * 0.5);
  for (let i = 0; i < stormCells;  i++) spawn('storm',  0.6 + precipChance * 0.4);

  // The day's prevailing wind — the one that drifts every cell — so the same wind can drive the
  // flight sim's HUD wind arrow + turbulence, not a separate per-hour formula. Angle is in grid
  // (x,y) space (baseVx/baseVy); windKph is the forecast speed the drift already scales with.
  return { systems, baseCloud, wind: { angle: windAngle, kph: windKph } };
}

function seedField(date, forecast0, bounds) {
  const rand = mulberry32(seedFromString(`weatherfield:${date}`));
  const weatherType  = forecast0?.weatherType ?? 'clear';
  const tempC        = forecast0?.tempC ?? 12;
  const precipChance = forecast0?.precipChance ?? 0.05;
  const windKph      = forecast0?.windKph ?? null;
  const { systems, baseCloud, wind } = systemsForForecast(weatherType, precipChance, tempC, windKph, bounds, rand);
  field.date         = toDateString(date);   // the day whose hero event is due
  field.systems      = systems;
  field.baseCloud    = baseCloud;
  field.baseSeverity = severityForForecast0(weatherType, tempC, windKph);
  field.bounds       = bounds;
  field.wind         = wind;
}

// Drift every cell one step; torus-wrap (with padding) so cells re-enter the
// map naturally and the system count stays stable. Pure in-memory math.
function advectField() {
  const b = field.bounds;
  if (!b) return;
  const pad = 2;
  for (const s of field.systems) {
    s.x += s.vx;
    s.y += s.vy;
    const lo = b.minX - s.radius - pad, spanX = (b.maxX - b.minX) + s.radius * 2 + pad * 2;
    const loY = b.minY - s.radius - pad, spanY = (b.maxY - b.minY) + s.radius * 2 + pad * 2;
    if (s.x < lo)  s.x += spanX; else if (s.x > lo + spanX)  s.x -= spanX;
    if (s.y < loY) s.y += spanY; else if (s.y > loY + spanY) s.y -= spanY;
  }
}

// The shared sampler handed to the engine. O(systems); systems are single digits.
function sampleWeatherAt(gx, gy) {
  let cloudCover = field.baseCloud, precipRate = 0, stormIntensity = 0, tempOffset = 0;
  let precipType = 'none';
  if (gx == null || gy == null) return { cloudCover, precipRate, precipType, tempOffset, stormIntensity, severity: currentBaseSeverity() };
  for (const s of field.systems) {
    const dist = Math.hypot(gx - s.x, gy - s.y);
    if (dist >= s.radius) continue;
    const f = s.intensity * smoothstep(1 - dist / s.radius);
    if (f <= 0) continue;
    cloudCover = Math.max(cloudCover, f);
    tempOffset -= f * K_TEMP;
    if (s.type === 'precip' || s.type === 'storm') {
      if (f > precipRate) { precipRate = f; precipType = s.precipType; }
      if (s.type === 'storm') stormIntensity = Math.max(stormIntensity, f);
    }
  }
  // Static per-region climate lean (e.g. The Reach reads hotter + drier). Applied
  // before severity so a drier region also reads a touch less precip-severe. Felt
  // downstream because getZoneTemperature folds this tempOffset into ambient temp.
  const bias = regionBiasAt(gx, gy);
  if (bias) {
    tempOffset += bias.temp;
    if (bias.dryness != null) { precipRate *= bias.dryness; cloudCover *= bias.dryness; }
  }
  // Local severity: the day-level floor (lifted by any named event), intensified
  // where a storm cell sits overhead or precip runs torrential on this tile.
  const precipSev = precipRate >= PRECIP_SEVERE ? (precipRate - PRECIP_SEVERE) / (1 - PRECIP_SEVERE) : 0;
  const severity = Math.min(1, Math.max(currentBaseSeverity(), stormIntensity, precipSev));
  // Acid-rain overlay: an active acid event makes whatever precip is falling on
  // this tile acidic (rides existing rain — no new weather type). 7b reads this.
  const acid = eventPrecipOverride();
  if (acid && precipRate > 0) precipType = acid;
  return {
    cloudCover: Math.min(1, cloudCover),
    precipRate: Math.min(1, precipRate),
    precipType,
    tempOffset,
    stormIntensity: Math.min(1, stormIntensity),
    severity,
  };
}

function getWeatherFieldSnapshot() {
  return {
    bounds: field.bounds,
    baseSeverity: currentBaseSeverity(),
    wind: field.wind,
    regionBias: field.regionBoxes.map(b => ({ id: b.id, temp: b.temp, dryness: b.dryness })),
    systems: field.systems.map(s => ({
      x: s.x, y: s.y, radius: s.radius, vx: s.vx, vy: s.vy,
      type: s.type, intensity: s.intensity, precipType: s.precipType,
    })),
  };
}

async function reseedFromForecast0(forecast0) {
  if (!forecast0) return;
  const bounds = field.bounds || await computeBounds();
  seedField(forecast0.date, forecast0, bounds);
}

// ── EMP consequences ────────────────────────────────────────────────────────
//
// The blackout itself is the engine's (forceGridBlackout). What a pulse does to
// things PEOPLE are carrying is content-shaped, so it lives out here.
//
// Two different lifetimes, deliberately:
//   • Gear is fried DURABLY (`custom_data.fried`) and stays dead until someone
//     repairs it — losing your tablet to a storm you were warned about is the
//     teeth, and the fix is an existing bench repair, not a new system.
//   • Chrome is knocked out TRANSIENTLY, in memory only. Permanently bricking an
//     augment the player paid surgery for is a different, much crueller game, and
//     a minutes-long transient has no business in the DB (see the persistence
//     tiers in docs/architecture.md).
const AUG_BLACKOUT_MS_PER_MIN = 60_000;

async function fryCarriedElectronics(playerIds) {
  if (!playerIds.length) return new Map();
  // One round trip for every live player's carried gear. `container_id` rides
  // along so a device tucked inside a faraday sleeve can be spared.
  const { rows } = await query(
    `SELECT pi.id, pi.player_id, pi.container_id, pi.item_id, pi.custom_data, i.name, i.tags
       FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id = ANY($1::text[])`,
    [playerIds]
  );
  const byId = new Map(rows.map(r => [r.id, r]));
  const isShielded = r => !!r?.tags?.shielded;
  const victims = rows.filter(r => {
    if (!r.tags?.electronic || isShielded(r)) return false;
    if (r.custom_data?.fried) return false;                 // already dead
    return !isShielded(byId.get(r.container_id));           // in a faraday bag = spared
  });
  if (!victims.length) return new Map();
  await query(
    `UPDATE player_inventory SET custom_data = COALESCE(custom_data, '{}'::jsonb) || '{"fried":true}'::jsonb
      WHERE id = ANY($1::text[])`,
    [victims.map(v => v.id)]
  );
  const namesByPlayer = new Map();
  for (const v of victims) {
    if (!namesByPlayer.has(v.player_id)) namesByPlayer.set(v.player_id, []);
    namesByPlayer.get(v.player_id).push(v.name);
  }
  return namesByPlayer;
}

on('weather.empPulse', async ({ minutes }) => {
  const players = getAllLivePlayers();
  if (!players.length) return;
  let fried;
  try { fried = await fryCarriedElectronics(players.map(p => p.id)); }
  catch (e) { console.error(`[weather] EMP fry failed: ${e.message}`); return; }

  const until = Date.now() + (minutes || 1) * AUG_BLACKOUT_MS_PER_MIN;
  for (const player of players) {
    const lines = [];
    if (player.chromed) {
      player._augFriedUntil = until;
      // Soak is cached on the live player, so the window only bites if we
      // recompute at both ends of it. Twice per hero event, on a deliberate-
      // action tier path — not a tick.
      recomputeEquipped(player).catch(() => {});
      setTimeout(() => {
        if (player._augFriedUntil !== until) return;   // a later pulse owns it now
        player._augFriedUntil = 0;
        recomputeEquipped(player).catch(() => {});
        sendToPlayer(player.id, { type: 'output', message: `<span class="msg-system">Your chrome comes back up with a lurch, rebooting somewhere behind your eyes.</span>` });
      }, until - Date.now()).unref?.();
      lines.push(`<span class="msg-system">Your chrome stutters and drops out. Whatever it was doing for you, it isn't doing it now.</span>`);
    }
    const names = fried.get(player.id);
    if (names?.length) {
      const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
      lines.push(`<span class="msg-system">Something in your pockets pops. ${list} — dead. Cooked right through.</span>`);
    }
    for (const message of lines) sendToPlayer(player.id, { type: 'output', message });
  }
});

// The sky isn't the only thing that can cause one of these. A VINE quest step,
// a corp sabotage script, or a reactor someone shouldn't have touched can all
// reach for a hero event through the ordinary action registry.
//
//   { type: 'WEATHER_EVENT', event: 'ion_storm' }
registerAction({
  type: 'WEATHER_EVENT',
  handler: ({ params }) => {
    const type = String(params?.event || params?.value || '').trim();
    if (!NAMED_EVENTS[type]) return { ok: false, error: `Unknown weather event "${type}".` };
    return devTriggerWeatherEvent(type);
  },
});

// A city plant coming apart takes the grid's regulation with it, and the sky
// notices. Blowing the turbine hall is now a way to CAUSE an ion storm, which
// makes the destructible-power path something a player might do on purpose.
on('generator.destroyed', ({ generatorType }) => {
  if (generatorType !== 'generator') return;   // a plant, not a junction box
  if (activeEvent) return;                     // one hero event at a time
  devTriggerWeatherEvent('ion_storm');
});

export const hooks = {
  'environment.init': async ({ setWeatherState, climateProfile, registerWeatherField, registerWeatherFieldSnapshot, registerWeatherFieldAdvance, registerWeatherEventStep, registerWeatherEventTrigger, registerWeatherRegionRefresh }) => {
    const forecast = await loadForecast(setWeatherState, climateProfile);
    const bounds = await computeBounds();
    seedField(forecast[0].date, forecast[0], bounds);
    field.regionBoxes = await computeRegionBoxes();   // static per-region climate lean
    if (registerWeatherRegionRefresh) registerWeatherRegionRefresh(async () => { field.regionBoxes = await computeRegionBoxes(); });
    if (registerWeatherField) registerWeatherField(sampleWeatherAt);
    if (registerWeatherFieldSnapshot) registerWeatherFieldSnapshot(getWeatherFieldSnapshot);
    if (registerWeatherFieldAdvance) registerWeatherFieldAdvance(advectField);
    if (registerWeatherEventStep) registerWeatherEventStep(stepWeatherEvent);
    if (registerWeatherEventTrigger) registerWeatherEventTrigger(triggerWeatherEvent);
  },

  'environment.advanceWeather': async ({ setWeatherState, rollAndSetCurrentPrecip, getHUDPayload, broadcast, currentForecast, climateProfile }) => {
    const shifted = currentForecast.slice(1);
    const newDate = addDays(currentForecast[6].date, 1);
    const generated = generateWeatherForDate(newDate, climateProfile);

    const nextForecast = [
      ...shifted,
      { date: newDate, weatherType: generated.weatherType, tempC: generated.tempC, windKph: generated.windKph, humidityPct: generated.humidityPct, precipChance: generated.precipChance },
    ].map((f, i) => ({ ...f, forecastDay: i, severity: severityForForecast0(f.weatherType, f.tempC, f.windKph), ...heroFieldsFor(f.date) }));

    await query('DELETE FROM weather_forecast');
    for (const f of nextForecast) {
      await query(
        `INSERT INTO weather_forecast (forecast_day, game_date, weather_type, temp_c, wind_kph, humidity_pct)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [f.forecastDay, f.date, f.weatherType, f.tempC, f.windKph ?? 0, f.humidityPct ?? 60]
      );
    }
    setWeatherState(nextForecast[0].weatherType, nextForecast[0].tempC, nextForecast);
    // Roll current precip against the new day's forecasted precipChance.
    rollAndSetCurrentPrecip(nextForecast[0].weatherType, nextForecast[0].tempC, nextForecast[0].precipChance ?? 0.05);
    // Re-seed the moving field for the new day.
    seedField(nextForecast[0].date, nextForecast[0], field.bounds || await computeBounds());
    if (broadcast) broadcast({ type: 'environment.sync', ...getHUDPayload() });
  },

  'environment.recalculateForecast': async ({ setWeatherState, climateProfile, currentDate }) => {
    await regenerateFullForecast(currentDate, climateProfile);
    const forecast = await loadForecast(setWeatherState, climateProfile);
    seedField(forecast[0].date, forecast[0], field.bounds || await computeBounds());
  },

  // Fired by the engine after a dev weather override so the field re-seeds to
  // match the forced weather/intensity (Max Storm → full storm cells; clear → drain).
  'environment.weatherFieldSync': async ({ forecast0 }) => {
    await reseedFromForecast0(forecast0);
  },

  // Devpanel "schedule future weather" — edits a single upcoming forecast day
  // (1-6) in place, ahead of it becoming today. Unlike the day-0 override this
  // doesn't touch current conditions or the live field; it just rewrites the
  // stored forecast row so the day arrives severe when it rolls around.
  'environment.scheduleForecastDay': async ({ forecastDay, weatherType, tempC, windKph, humidityPct, setWeatherState, currentForecast }) => {
    const idx = currentForecast.findIndex(f => f.forecastDay === forecastDay);
    if (idx === -1) throw new Error('Forecast day not found');
    const existing = currentForecast[idx];
    const next = {
      ...existing,
      weatherType: weatherType ?? existing.weatherType,
      tempC: tempC !== undefined ? Number(tempC) : existing.tempC,
      windKph: windKph !== undefined ? Number(windKph) : existing.windKph,
      humidityPct: humidityPct !== undefined ? Number(humidityPct) : existing.humidityPct,
    };
    next.severity = severityForForecast0(next.weatherType, next.tempC, next.windKph);
    await query(
      `UPDATE weather_forecast SET weather_type = $1, temp_c = $2, wind_kph = $3, humidity_pct = $4 WHERE forecast_day = $5`,
      [next.weatherType, next.tempC, next.windKph ?? 0, next.humidityPct ?? 60, forecastDay]
    );
    const nextForecast = currentForecast.map((f, i) => (i === idx ? next : f));
    setWeatherState(nextForecast[0].weatherType, nextForecast[0].tempC, nextForecast);
  },
};
