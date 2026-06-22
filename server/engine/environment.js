// server/engine/environment.js
//
// Unified Environmental Simulation — Time, Weather, Power, Lighting, Visibility
//
// INTEGRATION (do once, in server bootstrap — e.g. server/index.js):
//
//   import { initEnvironment } from './engine/environment.js';
//   import { query } from './models/db.js';
//   import { emit as emitHook } from './engine/plugins.js'; // adjust to your actual plugin emitter export
//   import { broadcastAll } from './index.js';               // adjust to your actual WS broadcast helper
//
//   await initEnvironment({ query, emitHook, broadcast: broadcastAll });
//
// Run the matching migration once before first boot — call this from inside
// the existing migrate() in server/models/migrate.js:
//
//   import { migrateEnvironment } from './migrate.environment.js';
//   await migrateEnvironment(query);
//
// Mount the dev-panel/API routes — see server/api/environment.routes.js for
// the matching dispatcher and its own integration comment.
//
// Nothing in this file touches Postgres on a per-player basis. Reads
// (visibility, HUD, power map) are served from the in-memory `state` object;
// Postgres is only written on the two scheduled ticks plus dev-tool calls,
// matching the GDD's two-interval design (30-minute environmental tick,
// 24-hour world tick).

import { schedule } from './scheduler.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Used only for boot catch-up logic (have we missed a tick since last restart?).
// The actual intervals are now managed by scheduler.js.
const TICK_30M_MS = 30 * 60 * 1000;
const TICK_24H_MS = 24 * 60 * 60 * 1000;
// Boot catch-up ceiling: replay at most this many missed days after a long
// outage so a very stale clock can't stall startup with day-by-day sims.
const MAX_CATCHUP_DAYS = 30;

const WEATHER_TYPES = ['clear','cloudy','overcast','rain','sleet','thunderstorm','storm','snow','blizzard','fog','haze','ash'];

const WEATHER_ICON = {
  clear:        '☀️',
  cloudy:       '☁',
  overcast:     '🌥',
  rain:         '🌧',
  sleet:        '🌨',
  thunderstorm: '⛈',
  storm:        '⚡',
  snow:         '❄',
  blizzard:     '🌨',
  fog:          '🌫',
  haze:         '😶‍🌫️',
  ash:          '🌋',
};

const WEATHER_VISIBILITY_FACTOR = {
  clear:        1.0,
  cloudy:       0.9,
  overcast:     0.85,
  rain:         0.7,
  sleet:        0.65,
  thunderstorm: 0.5,
  storm:        0.45,
  snow:         0.75,
  blizzard:     0.35,
  fog:          0.55,
  haze:         0.65,
  ash:          0.4,
};

// Fog and haze apply an independent multiplicative fog factor on top of the
// weather visibility factor (GDD §7). Ash has a separate strong penalty.
const FOG_FACTOR = { fog: 0.4, haze: 0.7, ash: 0.5 };
const DEFAULT_FOG_FACTOR = 1.0;

const SEASON_BY_MONTH = [
  'winter', 'winter', 'spring', 'spring', 'spring', 'summer',
  'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter',
];


const POWER_OVERLOAD_RATIO = 1.0;    // alloc < demand × this → 'overloaded'
const EMERGENCY_LIGHT_LEVEL = 0.3;   // artificial-light contribution on emergency power only
const SNOW_LOAD_MULTIPLIER = 1.15;   // snow increases effective load (GDD §11: heating demand)
const STORM_GENERATOR_FAULT_CHANCE = 0.10; // per 24h tick, per non-building generator

// Fixture draw values stored and compared in Watts (column still named *_kw
// for historical reasons — the unit is W throughout the engine).
const DRAW_OVERHEAD_W    = 100;   // 100 W fluorescent / LED panel
const DRAW_STREETLIGHT_W = 150;   // 150 W HPS / LED streetlight
const DRAW_DEFAULT_W     = 50;    // 50 W generic fixture

const VISIBILITY_CLEAR = 0.6;
const VISIBILITY_DIM = 0.35;

// ---------------------------------------------------------------------------
// In-memory state — source of truth between ticks, persisted to Postgres so
// it survives restarts. Mirrors the world.js in-memory-cache-over-Postgres
// pattern already used elsewhere in this codebase.
// ---------------------------------------------------------------------------

const state = {
  ready: false,
  frozen: false,
  date: null,              // 'YYYY-MM-DD'
  minutes: 8 * 60,          // minutes since midnight, server-authoritative
  dayOfWeek: 1,             // 1=Mon..7=Sun
  season: 'spring',
  tempC: 12,
  weatherType: 'clear',
  forecast: [],             // 7 entries: { forecastDay, date, weatherType, tempC, locked }
  ambientLight: 1.0,        // 0..1, recalculated every 30-min tick
  phase: 'day',
  zones: new Map(),         // zoneId -> { powerStatus, capacityKw, loadKw, hasEmergencyLighting, artificialLight }
  windows: [],              // all window rows from DB, refreshed on init and mutation
  lastTick30m: 0,
  lastTick24h: 0,
  activeClimateProfileId: null,
  activeClimateProfile: null,  // { monthly_temp_c: [...12], monthly_precip_chance: [...12] }
};

let deps = { query: null, emitHook: null, broadcast: null };
let ticksScheduled = false;

// Deterministic weather generation (seedFromString, mulberry32, generateWeatherForDate)
// has moved to plugins/weather/index.js.

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// node-postgres parses DATE columns into JS Date objects on read (it only
// accepts strings going IN). pg builds that Date from UTC components, so
// toISOString().slice(0,10) round-trips correctly regardless of server TZ.
function toDateString(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function seasonForDate(dateStr) {
  const month = Number(dateStr.slice(5, 7)) - 1;
  return SEASON_BY_MONTH[month];
}

function dayOfWeekFor(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const jsDay = d.getUTCDay(); // 0=Sun..6=Sat
  return jsDay === 0 ? 7 : jsDay; // 1=Mon..7=Sun
}

// ---------------------------------------------------------------------------
// Time / phase helpers
// ---------------------------------------------------------------------------

const DAY_PHASES = [
  { name: 'dawn', startMin: 5 * 60, endMin: 7 * 60, icon: '🌅' },
  { name: 'day', startMin: 7 * 60, endMin: 17 * 60, icon: '☀' },
  { name: 'dusk', startMin: 17 * 60, endMin: 20 * 60, icon: '🌇' },
  { name: 'night', startMin: 20 * 60, endMin: 5 * 60, icon: '🌙' }, // wraps midnight
];

function phaseForMinutes(minutesOfDay) {
  const m = minutesOfDay;
  if (m >= 5 * 60 && m < 7 * 60) return DAY_PHASES[0];
  if (m >= 7 * 60 && m < 17 * 60) return DAY_PHASES[1];
  if (m >= 17 * 60 && m < 20 * 60) return DAY_PHASES[2];
  return DAY_PHASES[3];
}

function clamp01(n) { return Math.max(0, Math.min(1, n)); }

function ambientLightForMinutes(minutesOfDay) {
  const phase = phaseForMinutes(minutesOfDay);
  if (phase.name === 'day') return 1.0;
  if (phase.name === 'night') return 0.0;
  if (phase.name === 'dawn') {
    const t = (minutesOfDay - phase.startMin) / (phase.endMin - phase.startMin);
    return clamp01(t);
  }
  // dusk
  const t = (minutesOfDay - phase.startMin) / (phase.endMin - phase.startMin);
  return clamp01(1 - t);
}

function formatHHMM(minutesOfDay) {
  const h = Math.floor(minutesOfDay / 60) % 24;
  const m = minutesOfDay % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function logError(err) {
  // eslint-disable-next-line no-console
  console.error('[environment]', err);
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

export async function initEnvironment({ query, emitHook, broadcast }) {
  deps = { query, emitHook, broadcast };

  const clockRow = await ensureClockRow(query);
  state.date = toDateString(clockRow.game_date);
  state.minutes = clockRow.game_time_minutes;
  state.dayOfWeek = clockRow.day_of_week;
  state.season = clockRow.season;
  state.lastTick30m = new Date(clockRow.last_tick_30m).getTime();
  state.lastTick24h = new Date(clockRow.last_tick_24h).getTime();
  const lastTick1m = clockRow.last_tick_1m ? new Date(clockRow.last_tick_1m).getTime() : state.lastTick30m;

  state.activeClimateProfileId = clockRow.active_climate_profile_id || null;
  if (state.activeClimateProfileId) {
    const { rows: cpRows } = await query('SELECT * FROM climate_profiles WHERE id = $1', [state.activeClimateProfileId]);
    if (cpRows[0]) state.activeClimateProfile = { monthly_temp_c: cpRows[0].monthly_temp_c, monthly_precip_chance: cpRows[0].monthly_precip_chance };
  }

  // Weather plugin initializes the forecast via this hook. Must run before
  // loadZonePowerAndLighting + recalcAmbientAndVisibility so state.weatherType
  // is populated when those functions read it.
  if (emitHook) await emitHook('environment.init', { setWeatherState, climateProfile: state.activeClimateProfile });

  await loadZonePowerAndLighting(query);
  await loadWindows(query);
  recalcAmbientAndVisibility();

  // Catch up on time missed during downtime. Game time runs 1:1 with real time,
  // so advance by the FULL elapsed interval — not a single tick. (The old
  // once-each version under-counted: a 3-hour outage only added 30 minutes,
  // leaving the world clock permanently behind after every cold start.)
  const now = Date.now();

  // Whole missed days: replay one tick24h per day so the weather plugin's
  // rolling forecast and the power sim advance day-by-day. Capped for sanity.
  const missed24h = Math.floor((now - state.lastTick24h) / TICK_24H_MS);
  if (missed24h > 0) {
    for (let i = 0; i < Math.min(missed24h, MAX_CATCHUP_DAYS); i++) await tick24h();
    state.lastTick24h = now;
  }

  // Time-of-day: jump straight to the correct minute based on elapsed real time
  // since the last 1-minute clock tick. This is exact for any outage length.
  const missedMinutes = Math.floor((now - lastTick1m) / 60_000);
  if (missedMinutes > 0) {
    state.minutes = (state.minutes + missedMinutes) % (24 * 60);
    recalcAmbientAndVisibility();
    await query(
      `UPDATE world_clock SET game_time_minutes = $1, last_tick_1m = now() WHERE id = 1`,
      [state.minutes]
    );
  }

  scheduleTicks();
  state.ready = true;

  // Sync streetlights to the current phase on boot — otherwise a server
  // restart at night would leave them off until the next dusk transition.
  const bootLightsOn = (state.phase === 'night' || state.phase === 'dusk') ? 1 : 0;
  await query(`UPDATE furniture SET light_on=$1 WHERE light_type='streetlight'`, [bootLightsOn]).catch(()=>{});
}

function scheduleTicks() {
  if (ticksScheduled) return; // schedule() is append-only; guard against double-init
  ticksScheduled = true;
  schedule('1m',  () => { if (!state.frozen) tick1m().catch(logError); });
  schedule('30m', () => { if (!state.frozen) tick30m().catch(logError); });
  schedule('24h', () => { if (!state.frozen) tick24h().catch(logError); });

  // 5-minute brownout rotation: only runs the full power redistribution when
  // at least one zone is overloaded, so there's zero cost on a healthy grid.
  schedule('5m', () => {
    if (state.frozen) return;
    const anyOverloaded = [...state.zones.values()].some(z => z.powerStatus === 'overloaded');
    if (anyOverloaded) tick5m().catch(logError);
  });

  // 30-second flicker: pure broadcast to overloaded zones — no DB writes,
  // just keeps the visual effect alive between redistribution ticks.
  schedule('30s', () => { flickerOverloadedZones(); });
}

async function ensureClockRow(query) {
  const today = new Date().toISOString().slice(0, 10);
  await query(
    `INSERT INTO world_clock (id, game_date, game_time_minutes, day_of_week, season)
     VALUES (1, $1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [today, 8 * 60, dayOfWeekFor(today), seasonForDate(today)]
  );
  const { rows } = await query('SELECT * FROM world_clock WHERE id = 1');
  return rows[0];
}

// loadForecast and regenerateFullForecast have moved to plugins/weather/index.js.
// Forecast state (state.weatherType, state.tempC, state.forecast) is still
// stored here and set via setWeatherState() — exported below.

async function loadZonePowerAndLighting(query) {
  const { rows: zones } = await query(`
    SELECT pz.*, g.generator_type
    FROM power_zones pz
    LEFT JOIN generators g ON g.id = pz.generator_id
  `);
  const { rows: lights } = await query('SELECT * FROM lighting_states');
  const lightByZone = new Map(lights.map((l) => [l.zone_id, l]));
  state.zones.clear();
  for (const z of zones) {
    const light = lightByZone.get(z.id);
    state.zones.set(z.id, {
      powerStatus: z.status,
      capacityKw: z.capacity_kw,
      loadKw: z.current_load_kw,
      availableKw: z.available_kw,
      maxCapacityKw: z.max_capacity_kw ?? 1000,
      generatorId: z.generator_id,
      generatorType: z.generator_type,
      hasEmergencyLighting: light ? !!light.has_emergency_lighting : false,
      artificialLight: computeArtificialLight(z.status, light),
    });
  }
}

export async function loadWindows(query) {
  const { rows } = await query('SELECT * FROM windows').catch(() => ({ rows: [] }));
  state.windows = rows;
}

// Called by the API after a window is created/updated/deleted.
export async function reloadWindows() {
  if (deps.query) await loadWindows(deps.query);
}

// Light reaching zone_interior through its windows.
// Outdoor ambient is attenuated by weather, then by each window's transmission
// and state. Interior-facing windows pass the other room's effective light.
export function getWindowLightContribution(zoneId) {
  const weatherFactor = WEATHER_VISIBILITY_FACTOR[state.weatherType] ?? 1.0;
  const fogFactor = FOG_FACTOR[state.weatherType] ?? DEFAULT_FOG_FACTOR;
  let best = 0;
  for (const w of state.windows) {
    if (w.zone_interior !== zoneId) continue;
    if (!w.curtain_open && w.glass_state !== 'broken') continue; // blocked
    const transmission = w.glass_state === 'broken' ? 1.0 : (w.light_transmission ?? 0.8);
    let source;
    if (!w.zone_exterior) {
      // Faces outdoors — transmit global ambient dampened by weather
      source = state.ambientLight * weatherFactor * fogFactor * transmission;
    } else {
      // Interior window — transmit the other room's effective light
      const otherZone = state.zones.get(w.zone_exterior);
      const otherArtificial = otherZone ? otherZone.artificialLight : 0;
      source = Math.max(getWindowLightContribution(w.zone_exterior), otherArtificial) * transmission;
    }
    if (source > best) best = source;
  }
  return clamp01(best);
}

// All windows visible in a zone (for room description and look-through).
export function getWindowsForZone(zoneId) {
  return state.windows.filter(w => w.zone_interior === zoneId);
}

// Mutate a window's curtain or glass state in memory + DB.
export async function setWindowState(windowId, updates) {
  const w = state.windows.find(w => w.id === windowId);
  if (!w) return null;
  Object.assign(w, updates);
  const { query: q } = deps;
  if (updates.curtain_open !== undefined)
    await q('UPDATE windows SET curtain_open=$1 WHERE id=$2', [updates.curtain_open, windowId]);
  if (updates.glass_state !== undefined)
    await q('UPDATE windows SET glass_state=$1 WHERE id=$2', [updates.glass_state, windowId]);
  return w;
}

function computeArtificialLight(powerStatus, light) {
  if (powerStatus === 'powered') {
    const fixtureBonus = light ? Math.min(1, (light.fixture_count || 1) / 4) : 1;
    return clamp01(0.3 + 0.7 * fixtureBonus);
  }
  if (powerStatus === 'overloaded') return 0.6;
  // offline
  return light && light.has_emergency_lighting ? EMERGENCY_LIGHT_LEVEL : 0.0;
}

// ---------------------------------------------------------------------------
// 5-Minute Brownout Rotation Tick (only active when grid is overloaded)
// ---------------------------------------------------------------------------

async function tick5m() {
  const { query } = deps;
  await simulatePowerNetwork(query, { weatherType: state.weatherType });
  await loadZonePowerAndLighting(query);
}

// Sends flicker broadcasts to overloaded zones — no DB writes.
function flickerOverloadedZones() {
  const { broadcast } = deps;
  if (!broadcast) return;
  for (const [zoneId, z] of state.zones) {
    if (z.powerStatus === 'overloaded') {
      broadcast(zoneId, { type: 'zone_event', message: '<span class="power-flicker">The lights flicker.</span>' });
    }
  }
}

// ---------------------------------------------------------------------------
// 1-Minute Clock Tick
// Increments game time by 1 minute, saves to DB, broadcasts to all clients.
// ---------------------------------------------------------------------------

async function tick1m() {
  const { query, broadcast } = deps;
  state.minutes = (state.minutes + 1) % (24 * 60);
  await query(
    `UPDATE world_clock SET game_time_minutes = $1, last_tick_1m = now() WHERE id = 1`,
    [state.minutes]
  );
  if (broadcast) broadcast({ type: 'environment.clockTick', time: formatHHMM(state.minutes) });
}

// ---------------------------------------------------------------------------
// 30-Minute Environmental Tick
// Ambient light → visibility baseline → streetlights → full client sync.
// Time is already up-to-date from the 1-minute tick — do NOT add 30 here.
// ---------------------------------------------------------------------------

async function tick30m() {
  const { query, emitHook, broadcast } = deps;

  state.lastTick30m = Date.now();

  const prevPhase = state.phase;
  recalcAmbientAndVisibility();

  await query(`UPDATE world_clock SET last_tick_30m = now() WHERE id = 1`);

  // Street lights are city-grid infrastructure, not player-switchable —
  // they follow the day/night cycle directly rather than a room switch.
  if (prevPhase !== state.phase) {
    if (state.phase === 'night' && prevPhase === 'dusk') {
      await query(`UPDATE furniture SET light_on=1 WHERE light_type='streetlight'`).catch(()=>{});
      await recomputePower().catch(() => {});
    }
    if (state.phase === 'day' && prevPhase === 'dawn') {
      await query(`UPDATE furniture SET light_on=0 WHERE light_type='streetlight'`).catch(()=>{});
      await recomputePower().catch(() => {});
    }
  }

  const payload = getHUDPayload();
  if (broadcast) broadcast({ type: 'environment.sync', ...payload });

  if (emitHook) {
    await emitHook('environment.tick30m', payload);
    if (prevPhase !== state.phase) {
      if (state.phase === 'day' && prevPhase === 'dawn') await emitHook('environment.sunrise', payload);
      if (state.phase === 'night' && prevPhase === 'dusk') await emitHook('environment.sunset', payload);
    }
  }
}

function recalcAmbientAndVisibility() {
  state.ambientLight = ambientLightForMinutes(state.minutes);
  state.phase = phaseForMinutes(state.minutes).name;
  // Per-zone visibility is computed on demand via getZoneVisibility(); only
  // the ambient baseline is refreshed here, per GDD §7: "Ambient light is
  // recalculated every 30-minute environmental tick."
}

// ---------------------------------------------------------------------------
// 24-Hour World Tick
// Calendar → forecast → weather/temp model → power simulation → lighting
// ---------------------------------------------------------------------------

async function tick24h() {
  const { query, emitHook, broadcast } = deps;

  state.date = addDays(state.date, 1);
  state.dayOfWeek = dayOfWeekFor(state.date);
  state.season = seasonForDate(state.date);
  state.lastTick24h = Date.now();

  await query(
    `UPDATE world_clock SET game_date = $1, day_of_week = $2, season = $3, last_tick_24h = now() WHERE id = 1`,
    [state.date, state.dayOfWeek, state.season]
  );

  // Weather plugin advances the forecast and updates state.weatherType/tempC
  // via setWeatherState() BEFORE simulatePowerNetwork reads weatherType for
  // snow-load calculations.
  if (emitHook) await emitHook('environment.advanceWeather', { setWeatherState, currentForecast: state.forecast, currentDate: state.date, climateProfile: state.activeClimateProfile });
  await simulatePowerNetwork(query, { weatherType: state.weatherType });
  await loadZonePowerAndLighting(query);
  recalcAmbientAndVisibility();

  const payload = { ...getHUDPayload(), forecast: getForecast() };
  if (broadcast) broadcast({ type: 'environment.daily', ...payload });
  if (emitHook) {
    await emitHook('environment.tick24h', payload);
    await emitHook('environment.weatherChange', { weatherType: state.weatherType, tempC: state.tempC });
  }
}

// advanceForecast has moved to plugins/weather/index.js (environment.advanceWeather hook).

// ---------------------------------------------------------------------------
// Power Network Simulation
// ---------------------------------------------------------------------------

// Handles light-state side-effects when a zone's power status changes.
// prevStatus = status stored in DB before this tick; newStatus = just computed.
async function applyPowerLightEffects(query, zoneId, prevStatus, newStatus, available, maxCap) {
  const broadcast = deps.broadcast;

  const wasOk = prevStatus === 'powered';
  const nowOk  = newStatus === 'powered';
  const nowDown = newStatus === 'offline';
  const nowBrown = newStatus === 'overloaded';

  if (nowDown) {
    // Preserve intended state before cutting everything.
    await query(`UPDATE furniture SET light_on_intended = COALESCE(light_on_intended, light_on) WHERE zone_id=$1 AND is_light=1`, [zoneId]);
    await query(`UPDATE furniture SET light_on=0 WHERE zone_id=$1 AND is_light=1`, [zoneId]);
    await query(`UPDATE power_zones SET current_load_kw=0 WHERE id=$1`, [zoneId]);
    await query(`UPDATE lighting_states SET fixture_count=0 WHERE zone_id=$1`, [zoneId]).catch(() => {});
    if (broadcast && prevStatus !== 'offline') {
      broadcast(zoneId, { type: 'zone_event', message: '<span class="power-out">The lights cut out. Darkness.</span>' });
    }
  } else if (nowBrown) {
    // Preserve intended state before any changes.
    await query(`UPDATE furniture SET light_on_intended = COALESCE(light_on_intended, light_on) WHERE zone_id=$1 AND is_light=1`, [zoneId]);

    // Per-device allocation: fetch all powered devices with their draw.
    const { rows: lights } = await query(`
      SELECT id, light_on_intended,
        COALESCE(power_draw_kw,
          CASE light_type
            WHEN 'overhead'    THEN ${DRAW_OVERHEAD_W}
            WHEN 'streetlight' THEN ${DRAW_STREETLIGHT_W}
            ELSE ${DRAW_DEFAULT_W}
          END
        ) AS draw_kw
      FROM furniture WHERE zone_id=$1 AND is_light=1
    `, [zoneId]);

    // Only devices the player intends to be on compete for available power.
    // Sort ascending by draw — cheapest devices served first.
    const wantOn = lights.filter(l => l.light_on_intended === 1).sort((a, b) => a.draw_kw - b.draw_kw);

    let pool = available;
    const fullyOn = [], flickering = [], forcedOff = [];

    for (const light of wantOn) {
      if (pool >= light.draw_kw) {
        fullyOn.push(light.id);
        pool -= light.draw_kw;
      } else if (pool > 0) {
        flickering.push(light.id);
        pool = 0;
      } else {
        forcedOff.push(light.id);
      }
    }

    if (fullyOn.length)   await query(`UPDATE furniture SET light_on=1 WHERE id=ANY($1::text[])`, [fullyOn]);
    if (forcedOff.length) await query(`UPDATE furniture SET light_on=0 WHERE id=ANY($1::text[])`, [forcedOff]);
    // Flickering devices randomly toggle each tick.
    for (const id of flickering) {
      await query(`UPDATE furniture SET light_on=$1 WHERE id=$2`, [Math.random() > 0.5 ? 1 : 0, id]);
    }

    await recalcZoneLoad(query, zoneId);
    const { rows: lc } = await query(`SELECT COUNT(*)::int AS cnt FROM furniture WHERE zone_id=$1 AND is_light=1 AND light_on=1`, [zoneId]);
    await query(`UPDATE lighting_states SET fixture_count=$1 WHERE zone_id=$2`, [lc[0]?.cnt || 0, zoneId]).catch(() => {});

    if (broadcast) {
      if (forcedOff.length) {
        broadcast(zoneId, { type: 'zone_event', message: '<span class="power-flicker">Some lights cut out as the grid strains under load.</span>' });
      } else if (flickering.length) {
        broadcast(zoneId, { type: 'zone_event', message: '<span class="power-flicker">The lights flicker and dim.</span>' });
      }
    }
  } else if (nowOk && !wasOk) {
    // Power restored — recover intended light states.
    await query(`
      UPDATE furniture
      SET light_on = COALESCE(light_on_intended, light_on),
          light_on_intended = NULL
      WHERE zone_id = $1 AND is_light = 1
    `, [zoneId]);
    await recalcZoneLoad(query, zoneId);
    const { rows: lc } = await query(`SELECT COUNT(*)::int AS cnt FROM furniture WHERE zone_id=$1 AND is_light=1 AND light_on=1`, [zoneId]);
    await query(`UPDATE lighting_states SET fixture_count=$1 WHERE zone_id=$2`, [lc[0]?.cnt || 0, zoneId]).catch(() => {});
    if (broadcast) {
      broadcast(zoneId, { type: 'zone_event', message: '<span class="power-restore">Emergency power hums to life. The lights come back on.</span>' });
    }
  }
}

async function simulatePowerNetwork(query, { weatherType }) {
  const { rows: allGenerators } = await query('SELECT * FROM generators');
  const loadMultiplier = weatherType === 'snow' ? SNOW_LOAD_MULTIPLIER : 1.0;

  // ── Phase 1: Resolve generator statuses ─────────────────────────────────
  // city_plant and junction_box are permanent (no fuel). Only player generators
  // consume fuel or stay permanently offline. Storms can transiently fault
  // city_plant and player types; junction boxes are hardwired inside buildings.
  const updatedStatus = new Map();
  for (const gen of allGenerators) {
    let status = (gen.generator_type === 'player') ? gen.status : 'online';
    if (status === 'flickering') status = 'online';
    let fuelRemaining = gen.fuel_remaining;
    if (gen.generator_type === 'player' && gen.fuel_type) {
      fuelRemaining = Math.max(0, fuelRemaining - gen.fuel_burn_rate * 30);
      if (fuelRemaining <= 0) status = 'offline';
    }
    if (weatherType === 'storm' && gen.generator_type === 'city_plant' && status !== 'offline') {
      if (Math.random() < STORM_GENERATOR_FAULT_CHANCE) status = 'flickering';
    }
    updatedStatus.set(gen.id, { ...gen, status, fuel_remaining: fuelRemaining });
    await query(`UPDATE generators SET status=$1, fuel_remaining=$2 WHERE id=$3`, [status, fuelRemaining, gen.id]);
  }

  // ── Phase 2: Recalculate zone loads from active furniture ────────────────
  await query(`
    UPDATE power_zones pz SET current_load_kw = (
      SELECT COALESCE(SUM(CASE
        WHEN f.power_draw_kw IS NOT NULL THEN f.power_draw_kw
        WHEN f.light_type = 'overhead'    THEN ${DRAW_OVERHEAD_W}
        WHEN f.light_type = 'streetlight' THEN ${DRAW_STREETLIGHT_W}
        ELSE ${DRAW_DEFAULT_W}
      END), 0)
      FROM furniture f WHERE f.zone_id = pz.id AND f.is_light = 1 AND f.light_on = 1
    )
  `);
  const { rows: allZones } = await query('SELECT * FROM power_zones');
  const zonesByGen = new Map();
  for (const z of allZones) {
    const key = z.generator_id ?? '__orphan__';
    if (!zonesByGen.has(key)) zonesByGen.set(key, []);
    zonesByGen.get(key).push(z);
  }

  // ── Phase 3: Calculate each junction box's aggregate demand ─────────────
  // A junction box's "ask" to its city plant = sum of its building zone loads,
  // capped at the junction box's own throughput rating.
  const jbDemand = new Map(); // jbId → watts demanded from city plant
  for (const gen of allGenerators) {
    if (gen.generator_type !== 'junction_box') continue;
    const jbZones = zonesByGen.get(gen.id) || [];
    const raw = jbZones.reduce((s, z) => s + (z.current_load_kw ?? 0), 0) * loadMultiplier;
    jbDemand.set(gen.id, Math.min(raw, gen.capacity_kw));
  }

  // ── Phase 4: City plant distributes to outdoor zones + junction boxes ────
  const jbAlloc = new Map(); // jbId → watts allocated by city plant
  const cityPlants = allGenerators.filter(g => g.generator_type === 'city_plant');

  for (const cp of cityPlants) {
    const cpSt = updatedStatus.get(cp.id);
    const directZones = zonesByGen.get(cp.id) || [];
    const connectedJBs = allGenerators.filter(g =>
      g.generator_type === 'junction_box' && g.city_generator_id === cp.id
    );

    if (!cpSt || cpSt.status === 'offline') {
      // City plant down — kill everything it feeds.
      await query(`UPDATE generators SET remaining_kw=0 WHERE id=$1`, [cp.id]);
      for (const z of directZones) {
        const cap = z.max_capacity_kw ?? 1000;
        await query(`UPDATE power_zones SET status='offline', available_kw=0, capacity_kw=$1 WHERE id=$2`, [cap, z.id]);
        await applyPowerLightEffects(query, z.id, z.status, 'offline', 0, cap);
      }
      for (const jb of connectedJBs) {
        jbAlloc.set(jb.id, 0);
        await query(`UPDATE generators SET remaining_kw=0 WHERE id=$1`, [jb.id]);
      }
      continue;
    }

    // Build a unified consumer list: direct outdoor zones + junction boxes.
    // Sort ascending by demand so cheaper consumers get served first.
    const consumers = [
      ...directZones.map(z => ({
        kind: 'zone', id: z.id, zone: z,
        demand: (z.current_load_kw ?? 0) * loadMultiplier,
        ceiling: z.max_capacity_kw ?? 1000,
      })),
      ...connectedJBs.map(jb => ({
        kind: 'jb', id: jb.id,
        demand: jbDemand.get(jb.id) ?? 0,
        ceiling: jb.capacity_kw,
      })),
    ].sort((a, b) => a.demand - b.demand);

    let pool = cpSt.capacity_kw;
    for (const c of consumers) {
      const ask  = Math.min(c.demand, c.ceiling);
      const alloc = Math.min(ask, Math.max(0, pool));
      pool -= alloc;
      if (c.kind === 'zone') {
        const { zone, demand, ceiling } = c;
        const status = demand === 0 ? 'powered'
          : alloc <= 0 ? 'offline'
          : alloc < demand ? 'overloaded'
          : 'powered';
        await query(`UPDATE power_zones SET status=$1, available_kw=$2, capacity_kw=$3 WHERE id=$4`,
          [status, alloc, ceiling, zone.id]);
        await applyPowerLightEffects(query, zone.id, zone.status, status, alloc, ceiling);
      } else {
        jbAlloc.set(c.id, alloc);
        await query(`UPDATE generators SET remaining_kw=$1 WHERE id=$2`, [alloc, c.id]);
      }
    }
    await query(`UPDATE generators SET remaining_kw=$1 WHERE id=$2`, [Math.max(0, pool), cp.id]);
  }

  // ── Phase 5: Junction boxes distribute their city-plant allocation ───────
  for (const gen of allGenerators) {
    if (gen.generator_type !== 'junction_box') continue;
    const jbSt = updatedStatus.get(gen.id);
    const allocation = jbAlloc.get(gen.id) ?? 0;
    const jbZones = zonesByGen.get(gen.id) || [];

    if (!jbSt || jbSt.status === 'offline' || allocation <= 0) {
      for (const z of jbZones) {
        const cap = z.max_capacity_kw ?? 1000;
        await query(`UPDATE power_zones SET status='offline', available_kw=0, capacity_kw=$1 WHERE id=$2`, [cap, z.id]);
        await applyPowerLightEffects(query, z.id, z.status, 'offline', 0, cap);
      }
      if (jbSt) await query(`UPDATE generators SET remaining_kw=0 WHERE id=$1`, [gen.id]);
      continue;
    }

    const sorted = [...jbZones].sort((a, b) => (a.current_load_kw ?? 0) - (b.current_load_kw ?? 0));
    let pool = allocation;
    for (const zone of sorted) {
      const demand  = (zone.current_load_kw ?? 0) * loadMultiplier;
      const ceiling = zone.max_capacity_kw ?? 1000;
      const ask     = Math.min(demand, ceiling);
      const alloc   = Math.min(ask, Math.max(0, pool));
      pool -= alloc;
      const status = demand === 0 ? 'powered'
        : alloc <= 0 ? 'offline'
        : alloc < demand ? 'overloaded'
        : 'powered';
      await query(`UPDATE power_zones SET status=$1, capacity_kw=$2, available_kw=$3 WHERE id=$4`,
        [status, ceiling, alloc, zone.id]);
      await applyPowerLightEffects(query, zone.id, zone.status, status, alloc, ceiling);
    }
    await query(`UPDATE generators SET remaining_kw=$1 WHERE id=$2`, [Math.max(0, pool), gen.id]);
  }

  // ── Phase 6: Orphan zones (no valid generator_id) go offline ────────────
  for (const z of (zonesByGen.get('__orphan__') || [])) {
    const cap = z.max_capacity_kw ?? 1000;
    await query(`UPDATE power_zones SET status='offline', available_kw=0, capacity_kw=$1 WHERE id=$2`, [cap, z.id]);
    await applyPowerLightEffects(query, z.id, z.status, 'offline', 0, cap);
  }
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

/**
 * Visibility = max(ambient, artificial) × weather × fog
 *
 * GDD §7 diagrams this as a straight product (Ambient × Artificial × Weather
 * × Fog). Taken literally, that zeroes out daytime visibility in any zone
 * with its lights off (artificial = 0) — clearly not the intent. Light
 * sources are combined with max() instead — the brighter of sun-or-bulb
 * wins — and weather/fog then act as a shared multiplicative dampener on top
 * of whatever light is present. This preserves every documented interaction
 * (storms/fog/snow reduce visibility; no power + night = true darkness;
 * daylight is unaffected by indoor light switches) without the degenerate
 * zero case the literal formula produces.
 */
export function getZoneVisibility(zoneId) {
  const zone = state.zones.get(zoneId);
  const artificial = zone ? zone.artificialLight : 0;

  // Interior zones (is_apartment / is_interior flag) don't receive outdoor
  // ambient directly — only through windows. Exterior zones use global ambient.
  const hasWindows = state.windows.some(w => w.zone_interior === zoneId);
  const windowLight = hasWindows ? getWindowLightContribution(zoneId) : 0;
  const isInterior = !!(zone && (zone.flags?.is_interior || zone.flags?.is_apartment));
  const ambientContrib = isInterior ? windowLight : state.ambientLight;

  const effectiveLight = Math.max(ambientContrib, artificial);
  const weatherFactor = WEATHER_VISIBILITY_FACTOR[state.weatherType] ?? 1.0;
  const fogFactor = FOG_FACTOR[state.weatherType] ?? DEFAULT_FOG_FACTOR;
  // Interior zones aren't directly affected by outdoor weather/fog —
  // that attenuation was already applied inside getWindowLightContribution.
  const envFactor = isInterior ? 1.0 : weatherFactor * fogFactor;
  const visibility = clamp01(effectiveLight * envFactor);

  let category = 'clear';
  if (visibility === 0) category = 'pitch_dark';
  else if (visibility < VISIBILITY_DIM) category = 'dark';
  else if (visibility < VISIBILITY_CLEAR) category = 'dim';

  return { visibility, category, ambientLight: ambientContrib, artificialLight: artificial, windowLight };
}

// GDD §7.2 feedback lines, for room-description injection on a visibility
// category change (wire into commands.js room rendering / zone.describeAmbient).
export function describeVisibilityTransition(prevCategory, nextCategory) {
  if (prevCategory !== 'dark' && nextCategory === 'dark') {
    return 'It is becoming difficult to make out more than shadows.';
  }
  if (prevCategory === 'dark' && nextCategory !== 'dark') {
    return 'Light returns, revealing your surroundings once again.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// HUD / Forecast / Power accessors
// ---------------------------------------------------------------------------

export function getHUDPayload() {
  const phase = phaseForMinutes(state.minutes);
  return {
    date: state.date,
    time: formatHHMM(state.minutes),
    dayOfWeek: state.dayOfWeek,
    season: state.season,
    weatherType: state.weatherType,
    weatherIcon: WEATHER_ICON[state.weatherType],
    tempC: state.tempC,
    tempF: Math.round((state.tempC * 9) / 5 + 32),
    timePhase: phase.name,
    timeIcon: phase.icon,
    frozen: state.frozen,
    activeClimateProfileId: state.activeClimateProfileId,
  };
}

export function getForecast() {
  return state.forecast.map((f) => ({ ...f, icon: WEATHER_ICON[f.weatherType] }));
}

// Setter used by the weather plugin to update in-memory weather state.
// Keep weather logic in the plugin; keep state here where the rest of the
// engine can read it without importing the plugin.
export function setWeatherState(weatherType, tempC, forecast) {
  if (weatherType !== undefined) state.weatherType = weatherType;
  if (tempC !== undefined) state.tempC = tempC;
  if (forecast !== undefined) state.forecast = forecast;
}

export function getPowerMap() {
  return [...state.zones.entries()].map(([zoneId, z]) => ({
    zoneId,
    status: z.powerStatus,
    capacityKw: z.capacityKw,
    loadKw: z.loadKw,
    availableKw: z.availableKw,
    maxCapacityKw: z.maxCapacityKw,
    artificialLight: z.artificialLight,
    generatorId: z.generatorId,
    generatorType: z.generatorType,
  }));
}

export function getEnvironmentState() {
  return { ...getHUDPayload(), ambientLight: state.ambientLight, forecast: getForecast(), powerMap: getPowerMap() };
}

// ---------------------------------------------------------------------------
// Dev Tools (called from server/api/environment.routes.js)
// ---------------------------------------------------------------------------

export async function devSetTime({ date, minutes }) {
  const { query, broadcast } = deps;
  if (date) state.date = date;
  if (minutes !== undefined) state.minutes = ((Number(minutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  state.dayOfWeek = dayOfWeekFor(state.date);
  recalcAmbientAndVisibility();
  await query(
    `UPDATE world_clock SET game_date = $1, game_time_minutes = $2, day_of_week = $3 WHERE id = 1`,
    [state.date, state.minutes, state.dayOfWeek]
  );
  const payload = getHUDPayload();
  if (broadcast) broadcast({ type: 'environment.sync', ...payload });
  return payload;
}

export async function devAdvanceTime(minutesToAdd) {
  return devSetTime({ minutes: state.minutes + Number(minutesToAdd || 0) });
}

export function devFreeze(frozen) {
  state.frozen = !!frozen;
  return { frozen: state.frozen };
}

export async function devForceTick5()  { await tick5m();  return getHUDPayload(); }
export async function devForceTick30() { await tick30m(); return getHUDPayload(); }
export async function devForceTick24() { await tick24h(); return { ...getHUDPayload(), forecast: state.forecast }; }

export async function devGetClimateProfiles() {
  const { rows } = await deps.query('SELECT * FROM climate_profiles ORDER BY name ASC');
  return rows.map(r => ({ id: r.id, name: r.name, monthly_temp_c: r.monthly_temp_c, monthly_precip_chance: r.monthly_precip_chance }));
}

export async function devSaveClimateProfile({ id, name, monthly_temp_c, monthly_precip_chance }) {
  const { query } = deps;
  if (!id) id = `climate_${Date.now()}`;
  if (!name) throw new Error('Profile name required');
  await query(
    `INSERT INTO climate_profiles (id, name, monthly_temp_c, monthly_precip_chance)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET name = $2, monthly_temp_c = $3, monthly_precip_chance = $4`,
    [id, name, JSON.stringify(monthly_temp_c), JSON.stringify(monthly_precip_chance)]
  );
  return { id, name, monthly_temp_c, monthly_precip_chance };
}

export async function devDeleteClimateProfile(id) {
  await deps.query('DELETE FROM climate_profiles WHERE id = $1', [id]);
  if (state.activeClimateProfileId === id) {
    state.activeClimateProfileId = null;
    state.activeClimateProfile = null;
    await deps.query('UPDATE world_clock SET active_climate_profile_id = NULL WHERE id = 1');
  }
  return { ok: true };
}

export async function devSetActiveClimate(id) {
  const { query } = deps;
  if (!id) {
    state.activeClimateProfileId = null;
    state.activeClimateProfile = null;
    await query('UPDATE world_clock SET active_climate_profile_id = NULL WHERE id = 1');
    return { activeClimateProfileId: null };
  }
  const { rows } = await query('SELECT * FROM climate_profiles WHERE id = $1', [id]);
  if (!rows[0]) throw new Error('Climate profile not found');
  state.activeClimateProfileId = id;
  state.activeClimateProfile = { monthly_temp_c: rows[0].monthly_temp_c, monthly_precip_chance: rows[0].monthly_precip_chance };
  await query('UPDATE world_clock SET active_climate_profile_id = $1 WHERE id = 1', [id]);
  return { activeClimateProfileId: id };
}

export async function devRecalculateForecast({ monthly_temp_c, monthly_precip_chance } = {}) {
  const { emitHook, broadcast } = deps;
  // Use profile data sent from the client if provided; otherwise fall back to active profile.
  const climateProfile = (monthly_temp_c && monthly_precip_chance)
    ? { monthly_temp_c, monthly_precip_chance }
    : state.activeClimateProfile;
  if (emitHook) await emitHook('environment.recalculateForecast', { setWeatherState, climateProfile, currentDate: state.date });
  const payload = { ...getHUDPayload(), forecast: getForecast() };
  if (broadcast) broadcast({ type: 'environment.sync', ...payload });
  return payload;
}

export async function devOverrideWeather({ weatherType, tempC }) {
  const { query, broadcast } = deps;
  if (!WEATHER_TYPES.includes(weatherType)) throw new Error(`Unknown weather type: ${weatherType}`);
  state.weatherType = weatherType;
  if (tempC !== undefined) state.tempC = Number(tempC);
  await query(`UPDATE weather_forecast SET weather_type = $1, temp_c = $2 WHERE forecast_day = 0`, [weatherType, state.tempC]);
  state.forecast[0] = { ...state.forecast[0], weatherType, tempC: state.tempC };
  if (broadcast) broadcast({ type: 'environment.weatherOverride', ...getHUDPayload() });
  return getHUDPayload();
}

export async function devTriggerStorm() { return devOverrideWeather({ weatherType: 'storm' }); }
export async function devTriggerSnow() { return devOverrideWeather({ weatherType: 'snow' }); }

export async function devSpawnGenerator({ id, zoneId, generatorType, capacityKw, fuelType, fuelRemaining, fuelBurnRate, connectionRange }) {
  const { query } = deps;
  await query(
    `INSERT INTO generators (id, zone_id, generator_type, capacity_kw, fuel_type, fuel_remaining, fuel_burn_rate, connection_range, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'online')
     ON CONFLICT (id) DO UPDATE SET zone_id = $2, generator_type = $3, capacity_kw = $4,
       fuel_type = $5, fuel_remaining = $6, fuel_burn_rate = $7, connection_range = $8`,
    [id, zoneId ?? null, generatorType ?? 'player', Number(capacityKw) || 0, fuelType ?? null, Number(fuelRemaining) || 0, Number(fuelBurnRate) || 0, Number(connectionRange) || 0]
  );
  return { ok: true, id };
}

export async function devModifyLoad(zoneId, loadKw) {
  const { query } = deps;
  await query(`UPDATE power_zones SET current_load_kw = $1 WHERE id = $2`, [Number(loadKw) || 0, zoneId]);
  await simulatePowerNetwork(query, { weatherType: state.weatherType });
  await loadZonePowerAndLighting(query);
  return getPowerMap();
}

export async function devSimulateFailure(generatorId) {
  const { query } = deps;
  await query(`UPDATE generators SET status = 'offline' WHERE id = $1`, [generatorId]);
  await simulatePowerNetwork(query, { weatherType: state.weatherType });
  await loadZonePowerAndLighting(query);
  return getPowerMap();
}

// ---------------------------------------------------------------------------
// Generator install/remove — dev panel feature. A 'building' generator
// auto-connects to every zone in the same building cluster (the install
// zone plus anything reachable through is_apartment/is_interior exit
// linkage, transitively — the same notion of "building" the Rooms: list
// and dev panel nesting already use). A 'city_plant' generator connects to
// every outdoor zone on the map (every zone that ISN'T is_apartment/
// is_interior) — this is what powers street lights and outdoor equipment.
// ---------------------------------------------------------------------------

async function getBuildingNetwork(query, startZoneId) {
  const { rows: allZones } = await query('SELECT id, exits, flags FROM zones');
  const byId = new Map(allZones.map(z => [z.id, z]));
  const isInterior = z => !!(z?.flags?.is_apartment || z?.flags?.is_interior);
  const visited = new Set([startZoneId]);
  const queue = [startZoneId];
  while (queue.length) {
    const id = queue.shift();
    const zone = byId.get(id);
    if (!zone) continue;
    const neighbors = new Set(Object.values(zone.exits || {}));
    for (const other of allZones) {
      if (Object.values(other.exits || {}).includes(id)) neighbors.add(other.id);
    }
    for (const nId of neighbors) {
      if (visited.has(nId)) continue;
      const neighbor = byId.get(nId);
      if (isInterior(neighbor)) {
        visited.add(nId);
        queue.push(nId);
      }
    }
  }
  return [...visited];
}

export async function installGenerator({ zoneId, generatorType = 'junction_box', capacityKw, name, cityGeneratorId }) {
  const { query } = deps;
  if (!zoneId) throw new Error('zoneId is required');
  const { rows: zoneRows } = await query('SELECT * FROM zones WHERE id=$1', [zoneId]);
  if (!zoneRows.length) throw new Error(`Zone ${zoneId} does not exist`);
  const zone = zoneRows[0];

  const id = `gen_${zoneId}_${Date.now()}`;
  // city_plant: 10 000 W. junction_box: 5 000 W default throughput (enough
  // for a multi-room building with several lights).
  const capacity = Number(capacityKw) || (generatorType === 'city_plant' ? 10000 : 5000);
  const genName = name || (generatorType === 'city_plant' ? 'City Power Plant' : `${zone.name} Junction Box`);

  // Auto-assign nearest city plant for junction boxes if not specified.
  let cityGenId = cityGeneratorId || null;
  if (generatorType === 'junction_box' && !cityGenId) {
    const { rows: cpRows } = await query(`
      SELECT g.id, z.grid_x, z.grid_y FROM generators g
      LEFT JOIN zones z ON z.id = g.zone_id
      WHERE g.generator_type = 'city_plant'
    `);
    let nearest = null, minDist = Infinity;
    for (const cp of cpRows) {
      if (zone.grid_x != null && cp.grid_x != null) {
        const d = Math.hypot(zone.grid_x - cp.grid_x, zone.grid_y - cp.grid_y);
        if (d < minDist) { minDist = d; nearest = cp; }
      } else if (!nearest) nearest = cp;
    }
    cityGenId = nearest?.id || null;
  }

  await query(
    `INSERT INTO generators (id, zone_id, name, generator_type, capacity_kw, fuel_type, fuel_remaining, fuel_burn_rate, connection_range, status, city_generator_id)
     VALUES ($1,$2,$3,$4,$5,NULL,0,0,0,'online',$6)`,
    [id, zoneId, genName, generatorType, capacity, cityGenId]
  );

  const networkZoneIds = generatorType === 'city_plant'
    ? (await query(`SELECT id FROM zones WHERE NOT COALESCE((flags->>'is_apartment')::boolean,false) AND NOT COALESCE((flags->>'is_interior')::boolean,false)`)).rows.map(r => r.id)
    : await getBuildingNetwork(query, zoneId);

  for (const zid of networkZoneIds) {
    const { rows: zRows } = await query('SELECT name FROM zones WHERE id=$1', [zid]);
    const zName = zRows[0]?.name || zid;
    await query(
      `INSERT INTO power_zones (id, name, source_type, generator_id, capacity_kw, current_load_kw, status)
       VALUES ($1,$2,$3,$4,$5,0,'powered')
       ON CONFLICT (id) DO UPDATE SET name=$2, source_type=$3, generator_id=$4, capacity_kw=$5`,
      [zid, zName, generatorType === 'city_plant' ? 'city_grid' : 'junction_box', id, capacity]
    );
    const { rows: fixtureRows } = await query(`SELECT COUNT(*)::int AS cnt FROM furniture WHERE zone_id=$1 AND is_light=1`, [zid]);
    await query(
      `INSERT INTO lighting_states (zone_id, has_emergency_lighting, artificial_light_level, fixture_count)
       VALUES ($1,0,0,$2)
       ON CONFLICT (zone_id) DO UPDATE SET fixture_count=$2`,
      [zid, fixtureRows[0]?.cnt || 0]
    );
  }

  await recomputePower();
  return { id, zoneId, name: genName, generatorType, capacityKw: capacity, poweredZones: networkZoneIds };
}

export async function removeGenerator(generatorId) {
  const { query } = deps;
  const { rows } = await query('SELECT * FROM generators WHERE id=$1', [generatorId]);
  if (!rows.length) throw new Error('Generator not found');
  const zoneId = rows[0].zone_id;
  await query('DELETE FROM power_zones WHERE generator_id=$1', [generatorId]);
  await query('DELETE FROM generators WHERE id=$1', [generatorId]);
  // If the generator was in a dedicated room (is_interior), and that room is
  // now empty of content, remove it so a stale roof/basement isn't left behind.
  if (zoneId) {
    const [npcs, furn, otherGen] = await Promise.all([
      query('SELECT 1 FROM npcs WHERE zone_id=$1 LIMIT 1', [zoneId]),
      query('SELECT 1 FROM furniture WHERE zone_id=$1 LIMIT 1', [zoneId]),
      query('SELECT 1 FROM generators WHERE zone_id=$1 LIMIT 1', [zoneId]),
    ]);
    const zoneRow = await query(`SELECT flags FROM zones WHERE id=$1`, [zoneId]);
    const isInterior = zoneRow.rows[0]?.flags?.is_interior;
    if (isInterior && !npcs.rows.length && !furn.rows.length && !otherGen.rows.length) {
      // Remove exit from parent zones pointing at this room, then delete it.
      const { rows: parents } = await query(
        `SELECT id, exits FROM zones WHERE exits::text LIKE $1`, [`%${zoneId}%`]
      );
      for (const p of parents) {
        const newExits = Object.fromEntries(Object.entries(p.exits || {}).filter(([, v]) => v !== zoneId));
        await query('UPDATE zones SET exits=$1 WHERE id=$2', [JSON.stringify(newExits), p.id]);
      }
      await query('DELETE FROM lighting_states WHERE zone_id=$1', [zoneId]);
      await query('DELETE FROM zones WHERE id=$1', [zoneId]);
    }
  }
  await recomputePower();
  return { ok: true, deletedZone: zoneId };
}

// ---------------------------------------------------------------------------
// Power fix tools — dev panel utilities to auto-connect unlinked zones.
// ---------------------------------------------------------------------------

// Finds outdoor zones with no power_zones row and connects each to the
// nearest city_plant generator (by Euclidean grid distance).
export async function fixZonePowerConnections() {
  const { query } = deps;

  const { rows: cityGens } = await query(`
    SELECT g.id, g.name, g.capacity_kw, z.grid_x, z.grid_y
    FROM generators g
    LEFT JOIN zones z ON z.id = g.zone_id
    WHERE g.generator_type = 'city_plant' AND g.status = 'online'
  `);
  if (!cityGens.length) throw new Error('No online city plant generators found');

  const { rows: unpowered } = await query(`
    SELECT z.id, z.name, z.grid_x, z.grid_y FROM zones z
    WHERE NOT COALESCE((z.flags->>'is_apartment')::boolean, false)
      AND NOT COALESCE((z.flags->>'is_interior')::boolean, false)
      AND (
        z.id NOT IN (SELECT id FROM power_zones)
        OR z.id IN (
          SELECT pz.id FROM power_zones pz
          WHERE pz.generator_id IS NOT NULL
            AND pz.generator_id NOT IN (SELECT id FROM generators)
        )
      )
  `);

  const connected = [];
  for (const zone of unpowered) {
    let nearest = null;
    let minDist = Infinity;
    for (const gen of cityGens) {
      if (zone.grid_x != null && zone.grid_y != null && gen.grid_x != null && gen.grid_y != null) {
        const d = Math.hypot(zone.grid_x - gen.grid_x, zone.grid_y - gen.grid_y);
        if (d < minDist) { minDist = d; nearest = gen; }
      } else if (!nearest) {
        nearest = gen;
      }
    }
    if (!nearest) continue;
    await query(
      `INSERT INTO power_zones (id, name, source_type, generator_id, capacity_kw, current_load_kw, status)
       VALUES ($1, $2, 'city_grid', $3, $4, 0, 'powered')
       ON CONFLICT (id) DO UPDATE SET source_type='city_grid', generator_id=$3, capacity_kw=$4`,
      [zone.id, zone.name, nearest.id, nearest.capacity_kw]
    );
    const { rows: ls } = await query(`SELECT COUNT(*)::int AS cnt FROM furniture WHERE zone_id=$1 AND is_light=1`, [zone.id]);
    await query(
      `INSERT INTO lighting_states (zone_id, has_emergency_lighting, artificial_light_level, fixture_count)
       VALUES ($1, 0, 0, $2) ON CONFLICT (zone_id) DO UPDATE SET fixture_count=$2`,
      [zone.id, ls[0]?.cnt || 0]
    );
    connected.push({ zoneId: zone.id, zoneName: zone.name, generatorName: nearest.name });
  }

  if (connected.length) await recomputePower();
  return { connected };
}

// For each distinct building cluster (is_apartment/is_interior zone network),
// checks how many generators serve it and either connects (1 gen), logs missing
// (0 gens), or returns an error (2+ gens with both names).
export async function fixBuildingPowerConnections() {
  const { query } = deps;

  const { rows: interiorZones } = await query(`
    SELECT id, name FROM zones
    WHERE COALESCE((flags->>'is_apartment')::boolean, false)
       OR COALESCE((flags->>'is_interior')::boolean, false)
  `);

  const visited = new Set();
  const results = { connected: [], needsGenerator: [], multipleGenerators: [] };

  for (const root of interiorZones) {
    if (visited.has(root.id)) continue;
    const network = await getBuildingNetwork(query, root.id);
    for (const id of network) visited.add(id);

    const { rows: gens } = await query(
      `SELECT id, name, capacity_kw FROM generators WHERE zone_id = ANY($1::text[]) AND generator_type = 'junction_box'`,
      [network]
    );

    // Representative name: prefer an is_building-flagged zone, else first alphabetically
    const { rows: namedRows } = await query(
      `SELECT name FROM zones WHERE id = ANY($1::text[])
         AND COALESCE((flags->>'is_building')::boolean, false) = true
       LIMIT 1`,
      [network]
    );
    const buildingName = namedRows[0]?.name || root.name;

    if (gens.length === 0) {
      results.needsGenerator.push({ buildingName, rootId: root.id });
    } else if (gens.length >= 2) {
      results.multipleGenerators.push({ buildingName, generators: gens.map(g => g.name) });
    } else {
      const gen = gens[0];
      // Only write rows that are missing or pointing at the wrong generator.
      const { rows: already } = await query(
        `SELECT id FROM power_zones WHERE id = ANY($1::text[]) AND generator_id = $2`,
        [network, gen.id]
      );
      const alreadyIds = new Set(already.map(r => r.id));
      const toFix = network.filter(zid => !alreadyIds.has(zid));
      if (toFix.length === 0) continue;
      for (const zid of toFix) {
        const { rows: zRows } = await query('SELECT name FROM zones WHERE id=$1', [zid]);
        const zName = zRows[0]?.name || zid;
        await query(
          `INSERT INTO power_zones (id, name, source_type, generator_id, capacity_kw, current_load_kw, status)
           VALUES ($1, $2, 'building_generator', $3, $4, 0, 'powered')
           ON CONFLICT (id) DO UPDATE SET source_type='building_generator', generator_id=$3, capacity_kw=$4`,
          [zid, zName, gen.id, gen.capacity_kw]
        );
        const { rows: ls } = await query(`SELECT COUNT(*)::int AS cnt FROM furniture WHERE zone_id=$1 AND is_light=1`, [zid]);
        await query(
          `INSERT INTO lighting_states (zone_id, has_emergency_lighting, artificial_light_level, fixture_count)
           VALUES ($1, 0, 0, $2) ON CONFLICT (zone_id) DO UPDATE SET fixture_count=$2`,
          [zid, ls[0]?.cnt || 0]
        );
      }
      results.connected.push({ buildingName, generatorName: gen.name, zonesCount: toFix.length });
    }
  }

  // Auto-assign city_generator_id to any junction box that lacks one.
  const { rows: cityGens } = await query(`
    SELECT g.id, z.grid_x, z.grid_y FROM generators g
    LEFT JOIN zones z ON z.id = g.zone_id
    WHERE g.generator_type = 'city_plant'
  `);
  const { rows: unlinkedJBs } = await query(`
    SELECT g.id, g.zone_id, z.grid_x, z.grid_y FROM generators g
    LEFT JOIN zones z ON z.id = g.zone_id
    WHERE g.generator_type = 'junction_box' AND g.city_generator_id IS NULL
  `);
  for (const jb of unlinkedJBs) {
    let nearest = null, minDist = Infinity;
    for (const cp of cityGens) {
      if (jb.grid_x != null && cp.grid_x != null) {
        const d = Math.hypot(jb.grid_x - cp.grid_x, jb.grid_y - cp.grid_y);
        if (d < minDist) { minDist = d; nearest = cp; }
      } else if (!nearest) nearest = cp;
    }
    if (!nearest) continue;
    await query(`UPDATE generators SET city_generator_id=$1 WHERE id=$2`, [nearest.id, jb.id]);
    results.connected.push({ buildingName: jb.id, generatorName: `linked to city plant ${nearest.id}`, zonesCount: 0 });
  }

  if (results.connected.length) await recomputePower();
  return results;
}

export async function setGeneratorCapacity(generatorId, capacityKw, name) {
  const { query } = deps;
  const kw = Math.max(0, Number(capacityKw) || 0);
  const { rowCount } = await query(
    `UPDATE generators SET capacity_kw = $1${name ? ', name = $3' : ''} WHERE id = $2`,
    name ? [kw, generatorId, name] : [kw, generatorId]
  );
  if (!rowCount) throw new Error(`Generator ${generatorId} not found`);
  await recomputePower();
  return (await getGeneratorsList()).find(g => g.id === generatorId);
}

export async function getGeneratorsList() {
  const { query } = deps;
  const { rows } = await query(`
    SELECT g.*, z.name as zone_name,
      COALESCE((
        SELECT SUM(pz.current_load_kw) FROM power_zones pz WHERE pz.generator_id = g.id
      ), 0) AS zone_load_w
    FROM generators g LEFT JOIN zones z ON z.id = g.zone_id
    ORDER BY g.generator_type, g.id
  `);
  return rows;
}

export async function getCityGenerators() {
  const { query } = deps;
  const { rows } = await query(`
    SELECT g.id, g.name, g.capacity_kw, g.status, z.name as zone_name
    FROM generators g LEFT JOIN zones z ON z.id = g.zone_id
    WHERE g.generator_type = 'city_plant'
    ORDER BY g.id
  `);
  return rows;
}

export async function setJunctionBoxCityGenerator(jbId, cityGenId) {
  const { query } = deps;
  const { rows } = await query(
    `UPDATE generators SET city_generator_id=$1 WHERE id=$2 AND generator_type='junction_box' RETURNING *`,
    [cityGenId || null, jbId]
  );
  if (!rows.length) throw new Error('Junction box not found');
  return rows[0];
}

export async function getGeneratorZones(generatorId) {
  const { query } = deps;
  const { rows: genRows } = await query('SELECT * FROM generators WHERE id=$1', [generatorId]);
  if (!genRows.length) throw new Error('Generator not found');
  const { rows } = await query(`
    SELECT pz.id, pz.status, pz.capacity_kw, pz.current_load_kw, pz.available_kw,
           pz.max_capacity_kw, z.name, z.grid_x, z.grid_y,
           COALESCE((z.flags->>'is_interior')::boolean, false) AS is_interior,
           COALESCE((z.flags->>'is_apartment')::boolean, false) AS is_apartment
    FROM power_zones pz
    LEFT JOIN zones z ON z.id = pz.id
    WHERE pz.generator_id = $1
    ORDER BY z.name
  `, [generatorId]);
  return { generator: genRows[0], zones: rows };
}

// Sums active powered furniture in a zone and writes the result to
// power_zones.current_load_kw. Call this whenever a light or electronic
// is switched on or off so the power sim always has fresh load data.
export async function recalcZoneLoad(queryFn, zoneId) {
  const { rows } = await queryFn(`
    SELECT COALESCE(SUM(
      CASE
        WHEN power_draw_kw IS NOT NULL THEN power_draw_kw
        WHEN light_type = 'overhead'    THEN ${DRAW_OVERHEAD_W}
        WHEN light_type = 'streetlight' THEN ${DRAW_STREETLIGHT_W}
        ELSE ${DRAW_DEFAULT_W}
      END
    ), 0) AS total_load
    FROM furniture
    WHERE zone_id = $1 AND is_light = 1 AND light_on = 1
  `, [zoneId]);
  const load = rows[0]?.total_load ?? 0;
  await queryFn(`UPDATE power_zones SET current_load_kw = $1 WHERE id = $2`, [load, zoneId]);
  return load;
}

export async function reassignZoneGenerator(zoneId, generatorId) {
  const { query } = deps;
  const { rows: genRows } = await query('SELECT id, name, capacity_kw FROM generators WHERE id=$1', [generatorId]);
  if (!genRows.length) throw new Error('Generator not found');
  const gen = genRows[0];
  await query(
    `UPDATE power_zones SET generator_id=$1, source_type='city_grid', capacity_kw=$2 WHERE id=$3`,
    [gen.id, gen.capacity_kw, zoneId]
  );
  await recomputePower();
  return { zoneId, generatorId: gen.id, generatorName: gen.name };
}

export async function getZonePowerInfo(zoneId) {
  const { query } = deps;
  const { rows } = await query(`
    SELECT pz.status, pz.capacity_kw, pz.available_kw, pz.max_capacity_kw,
           pz.current_load_kw, pz.generator_id,
           g.name AS generator_name, g.generator_type, g.capacity_kw AS gen_capacity_kw, g.status AS gen_status
    FROM power_zones pz
    LEFT JOIN generators g ON g.id = pz.generator_id
    WHERE pz.id = $1
  `, [zoneId]);
  return rows[0] || null;
}

export async function setZoneMaxCapacity(zoneId, maxCapacityKw) {
  const { query } = deps;
  const kw = Math.max(0, Number(maxCapacityKw) || 50);
  const { rowCount } = await query(
    `UPDATE power_zones SET max_capacity_kw = $1 WHERE id = $2`,
    [kw, zoneId]
  );
  if (!rowCount) throw new Error(`Zone ${zoneId} not found in power_zones`);
  await recomputePower();
  return getPowerMap().find(z => z.zoneId === zoneId);
}

// Re-runs the power simulation immediately (instead of waiting for the next
// 24h tick) — used after install/remove so the dev panel's power map and
// any live "look at generator" reflect the change right away.
export async function recomputePower() {
  const { query } = deps;
  await simulatePowerNetwork(query, { weatherType: state.weatherType });
  await loadZonePowerAndLighting(query);
  return getPowerMap();
}

// Used by commands.js (light switches, generator examine) to check whether
// a zone currently has any power at all before allowing an indoor light to
// be switched on.
export function getZonePowerStatus(zoneId) {
  const z = state.zones.get(zoneId);
  return z ? z.powerStatus : 'unpowered';
}

// ---------------------------------------------------------------------------
// Plugin hook names this module emits — register these in your plugin
// loader's known-hooks list alongside tick.minute / player.enterZone / etc.
// ---------------------------------------------------------------------------

export const ENVIRONMENT_HOOKS = [
  'environment.tick30m',
  'environment.tick24h',
  'environment.weatherChange',
  'environment.sunrise',
  'environment.sunset',
];
