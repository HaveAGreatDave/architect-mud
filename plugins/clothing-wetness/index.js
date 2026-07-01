/**
 * Clothing Wetness Plugin
 *
 * Hooks:
 *   tick.minute — increases wetness on equipped wettable items when precipRate > 0,
 *                 dries them when indoors or when precipitation has stopped.
 *
 * Wetness thresholds: 25 (damp), 50 (wet), 75 (very wet), 100 (soaked)
 *
 * Rain wetting: precipRate² × 30 per minute (quadratic — torrential wets much faster than drizzle)
 *   light rain (0.3) → ~37 min to soaked
 *   moderate  (0.5) → ~13 min
 *   heavy     (0.65)→ ~8 min
 *   torrential(0.95)→ ~4 min
 *
 * Snow wetting: piecewise linear — blizzard (dry wind) is slower than heavy snow
 *   light flurries (≤0.2) → ~250 min (effectively never)
 *   moderate–heavy (0.2–0.7) → precipRate × 6 per minute
 *   blizzard (>0.7) → min(precipRate × 3, 3) per minute (dry wind cap)
 *
 * Drying: base 2/min outdoors, 3/min indoors, × temp multiplier (every 10°C above 15°C adds 50%).
 *   Outdoors also × wind multiplier (up to 2.5× at gale) and × humidity multiplier
 *   (damp air slows evaporation, dry air speeds it). Interiors are sheltered/HVAC-neutral.
 */
import { query } from '../../server/models/db.js';
import { hasTag } from '../../server/engine/tags.js';
import { getZoneTemperature, getZonePrecip, getWindKph, getHumidityPct } from '../../server/engine/environment.js';
import { getAllLivePlayers, getZone } from '../../server/engine/world.js';

function rainWettingRate(precipRate) {
  return precipRate * precipRate * 30;
}

function snowWettingRate(precipRate) {
  if (precipRate <= 0.2) return precipRate * 2;
  if (precipRate <= 0.7) return precipRate * 6;
  return Math.min(precipRate * 3, 3); // blizzard — dry wind limits soak rate
}

// Drying multiplier: every 10°C above 15°C adds 50% more drying speed.
// e.g. 15°C → 1×, 25°C → 1.5×, 35°C → 2×, 45°C → 2.5×
function dryMultiplier(tempC) {
  return 1 + Math.max(0, tempC - 15) / 20;
}

// Wind speeds evaporation (forced convection). Outdoors only; up to +150% at gale.
// e.g. 0 kph → 1×, 15 → 1.5×, 30 → 2×, 45+ → 2.5× (capped).
function windMultiplier(windKph) {
  return 1 + Math.min(1.5, windKph / 30);
}

// Humid air holds moisture, so evaporation slows; dry air speeds it. Neutral at
// ~60% RH. null (unknown) → 1×. Clamped so it never fully stalls or runs away.
// e.g. 30% → ~1.15×, 60% → 0.9×, 90% → 0.6×, 100% → 0.5×.
function humidityMultiplier(humidityPct) {
  if (humidityPct == null) return 1;
  return Math.max(0.5, Math.min(1.3, 1.5 - humidityPct / 100));
}

// Thresholds: { value, risingMsg, fallingMsg }
// risingMsg shown when wetness crosses value going up; fallingMsg going down.
const WETNESS_THRESHOLDS = [
  { value: 25,  risingMsg: "You're starting to get damp.",   fallingMsg: "You're almost completely dry." },
  { value: 50,  risingMsg: "You're getting quite wet.",      fallingMsg: "You're drying off." },
  { value: 75,  risingMsg: "You're very wet now.",           fallingMsg: "You're starting to dry out." },
  { value: 100, risingMsg: "You're completely soaked.",      fallingMsg: null },
];
const DRY_MSG = "You're completely dry.";

export const hooks = {
  'tick.minute': async ({ broadcast }) => {
    for (const player of getAllLivePlayers()) {
      const playerId = player.id;
      if (player.sleeping) continue;

      const zone = getZone(player.current_zone);
      const isIndoors = zone?.flags?.is_interior ?? false;
      // Local precipitation at the player's tile — under a passing cell or not.
      const { precipRate, precipType } = getZonePrecip(player.current_zone);
      const isPrecipitating = precipRate > 0 && !isIndoors;
      const isSnow = precipType === 'snow';
      const zoneTemp = getZoneTemperature(player.current_zone);
      const baseDryRate = isIndoors ? 3 : 2;
      // Wind and humidity only bite outdoors; interiors are sheltered and HVAC-neutral.
      const windMult = isIndoors ? 1 : windMultiplier(getWindKph());
      const humidMult = isIndoors ? 1 : humidityMultiplier(getHumidityPct());
      const dryRate = baseDryRate * dryMultiplier(zoneTemp) * windMult * humidMult;

      const { rows } = await query(
        `SELECT pi.id, pi.custom_data, i.tags
         FROM player_inventory pi JOIN items i ON i.id = pi.item_id
         WHERE pi.player_id = $1 AND pi.is_equipped = 1`,
        [playerId]
      );
      const wettable = rows.filter(r => hasTag(r, 'gets_wet'));
      if (!wettable.length) {
        player.wetness = 0;
        continue;
      }

      const wettingRate = isPrecipitating
        ? (isSnow ? snowWettingRate(precipRate) : rainWettingRate(precipRate))
        : 0;

      let totalWetness = 0;
      for (const item of wettable) {
        const prev = item.custom_data?.wetness ?? 0;
        let next = isPrecipitating ? prev + wettingRate : prev - dryRate;
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

      const messages = [];
      const rising  = newWetness > prevWetness;
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

      const wetnessChanged = Math.round(newWetness) !== Math.round(prevWetness);
      if ((messages.length || wetnessChanged) && broadcast) {
        broadcast(null, { type: 'resource_tick', messages, player_update: { wetness: Math.round(newWetness) } }, null, playerId);
      }
    }
  },
};
