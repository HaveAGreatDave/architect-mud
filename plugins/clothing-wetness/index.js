/**
 * Clothing Wetness Plugin
 *
 * Hooks:
 *   environment.tick30m — rolls for precipitation start/stop based on daily forecast
 *   tick.minute         — updates per-item wetness and player.wetness for all online players
 */
import { query } from '../../server/models/db.js';
import { hasTag } from '../../server/engine/tags.js';
import { getEnvironmentState } from '../../server/engine/environment.js';
import { getAllLivePlayers, getZone } from '../../server/engine/world.js';

// Derived precipitation chance from the daily forecast weather type.
// The daily forecast says what kind of day it is; the 30-min tick decides
// whether precipitation is falling right now.
const PRECIP_CHANCE = {
  rain:          0.70,
  thunderstorm:  0.70,
  storm:         0.70,
  sleet:         0.70,
  snow:          0.70,
  blizzard:      0.70,
  overcast:      0.25,
  cloudy:        0.10,
  clear:         0.03,
  fog:           0.03,
  haze:          0.03,
  ash:           0.03,
};

// precipRate is a 0.0–1.0 value. Labels are looked up at display time via
// intensityLabel(). Wetness delta per minute = precipRate * MAX_WETNESS_RATE.
const MAX_WETNESS_RATE = 35; // wetness units/min at precipRate 1.0 (~3 min to fully soak)

const RAIN_INTENSITIES = [
  { label: 'mist',                   rate: 0.1 },
  { label: 'light drizzle',          rate: 0.2 },
  { label: 'light rain',             rate: 0.3 },
  { label: 'steady rain',            rate: 0.4 },
  { label: 'moderate rain',          rate: 0.5 },
  { label: 'heavy rain',             rate: 0.6 },
  { label: 'very heavy rain',        rate: 0.7 },
  { label: 'storm',                  rate: 0.8 },
  { label: 'severe storm',           rate: 0.9 },
  { label: 'extreme deluge',         rate: 1.0 },
];
const SNOW_INTENSITIES = [
  { label: 'light flurries',         rate: 0.1 },
  { label: 'scattered snow',         rate: 0.2 },
  { label: 'steady snowfall',        rate: 0.3 },
  { label: 'moderate snow',          rate: 0.4 },
  { label: 'accumulating snow',      rate: 0.5 },
  { label: 'thick snowfall',         rate: 0.6 },
  { label: 'wind-blown snow',        rate: 0.7 },
  { label: 'blizzard conditions',    rate: 0.8 },
  { label: 'whiteout blizzard',      rate: 0.9 },
  { label: 'severe whiteout blizzard', rate: 1.0 },
];

// Returns the intensity label for a given precipType and precipRate.
function intensityLabel(precipType, precipRate) {
  if (!precipRate || precipRate <= 0) return 'clear';
  const table = (precipType === 'snow') ? SNOW_INTENSITIES : RAIN_INTENSITIES;
  // Find exact match, or nearest
  const entry = table.find(e => Math.abs(e.rate - precipRate) < 0.001) ?? table[0];
  return entry.label;
}

// Wetness thresholds for player broadcast messages.
// Each entry: { value, risingMsg, fallingMsg }
// risingMsg shown when wetness crosses value going up; fallingMsg going down.
const WETNESS_THRESHOLDS = [
  { value: 10,  risingMsg: "You're starting to get a little wet.",  fallingMsg: "You're almost completely dry." },
  { value: 50,  risingMsg: "You're getting quite wet.",             fallingMsg: "You're starting to dry off." },
  { value: 100, risingMsg: "You're completely soaked.",             fallingMsg: null },
];
const DRY_MSG = "You're completely dry.";

function pickIntensity(intensities) {
  return intensities[Math.floor(Math.random() * intensities.length)];
}

export const hooks = {
  // Roll for precipitation every 30 minutes. If it starts, pick an intensity
  // and broadcast a HUD update. If it stops, clear the state and broadcast.
  'environment.tick30m': async ({ weatherType, tempC, setCurrentPrecip, getHUDPayload, broadcast }) => {
    const envState = getEnvironmentState();
    const precipOverride = envState.forecast?.[0]?.precipChance;
    const chance = precipOverride !== undefined ? precipOverride : (PRECIP_CHANCE[weatherType] ?? 0.05);
    // Roll out of 100 — rain/snow if roll < chance (both expressed as 0–1 fractions)
    const roll = Math.random();
    const isCurrentlyPrecipitating = envState.currentPrecip !== 'none';

    if (roll < chance && !isCurrentlyPrecipitating) {
      // Derive precip type from the forecast weatherType, fall back to temperature
      let precipType;
      if (weatherType === 'snow' || weatherType === 'blizzard') precipType = 'snow';
      else if (weatherType === 'sleet')                          precipType = tempC <= 1 ? 'snow' : 'rain';
      else                                                        precipType = tempC <= 1 ? 'snow' : 'rain';
      const { label, rate } = pickIntensity(precipType === 'snow' ? SNOW_INTENSITIES : RAIN_INTENSITIES);
      setCurrentPrecip(precipType, intensityLabel(precipType, rate), rate);
      if (broadcast) broadcast({ type: 'environment.sync', ...getHUDPayload() });
    } else if (roll >= chance && isCurrentlyPrecipitating) {
      setCurrentPrecip('none', 'none', 0);
      if (broadcast) broadcast({ type: 'environment.sync', ...getHUDPayload() });
    }
  },

  // Update wetness on every equipped wettable item for every online player,
  // then compute player.wetness (average) and send threshold messages.
  'tick.minute': async ({ broadcast }) => {
    const env = getEnvironmentState();
    const { precipRate } = env;

    for (const player of getAllLivePlayers()) {
      const playerId = player.id;
      if (player.sleeping) continue;

      const zone = getZone(player.current_zone);
      const isIndoors = zone?.flags?.is_interior ?? false;
      const isRaining = precipRate > 0 && !isIndoors;
      const dryRate   = isIndoors ? 3 : 2;

      // Fetch all equipped items that can get wet
      const { rows } = await query(
        `SELECT pi.id, pi.custom_data, i.tags
         FROM player_inventory pi JOIN items i ON i.id = pi.item_id
         WHERE pi.player_id = $1 AND pi.is_equipped = 1`,
        [playerId]
      );
      const wettable = rows.filter(r => hasTag(r, 'gets_wet'));
      if (!wettable.length) {
        player.wetness = 0;
        player._prevWetness = 0;
        continue;
      }

      let totalWetness = 0;
      for (const item of wettable) {
        const prev = item.custom_data?.wetness ?? 0;
        let next = isRaining ? prev + precipRate * MAX_WETNESS_RATE : prev - dryRate;
        next = Math.max(0, Math.min(100, next));
        totalWetness += next;

        if (Math.round(next) !== Math.round(prev)) {
          await query(
            `UPDATE player_inventory SET custom_data = COALESCE(custom_data, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
            [JSON.stringify({ wetness: Math.round(next) }), item.id]
          );
        }
      }

      const prevWetness = player.wetness ?? 0;
      const newWetness  = totalWetness / wettable.length;
      player.wetness    = newWetness;

      // Emit threshold crossing messages
      const messages = [];
      const rising = newWetness > prevWetness;
      const falling = newWetness < prevWetness;

      if (rising) {
        for (const t of WETNESS_THRESHOLDS) {
          if (prevWetness < t.value && newWetness >= t.value) messages.push(t.risingMsg);
        }
      } else if (falling) {
        for (const t of [...WETNESS_THRESHOLDS].reverse()) {
          if (prevWetness >= t.value && newWetness < t.value && t.fallingMsg) messages.push(t.fallingMsg);
        }
        if (prevWetness > 0 && newWetness === 0) messages.push(DRY_MSG);
      }

      player._prevWetness = newWetness;

      if (messages.length && broadcast) {
        broadcast(null, { type: 'resource_tick', messages, player_update: {} }, null, playerId);
      }
    }
  },
};
