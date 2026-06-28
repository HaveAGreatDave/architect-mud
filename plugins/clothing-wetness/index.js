/**
 * Clothing Wetness Plugin
 *
 * Hooks:
 *   tick.minute — increases wetness on equipped wettable items when precipRate > 0,
 *                 dries them when indoors or when precipitation has stopped.
 */
import { query } from '../../server/models/db.js';
import { hasTag } from '../../server/engine/tags.js';
import { getEnvironmentState, getZoneTemperature } from '../../server/engine/environment.js';
import { getAllLivePlayers, getZone } from '../../server/engine/world.js';

// precipRate is set by the environment system (0.1–1.0 when raining/snowing, 0 when dry).
// Rain: wetness += precipRate * 12 per minute. At 0.1 ~83 min to soak; at 1.0 ~8 min.
// Snow: wetness += precipRate * 6 per minute (frozen — melts slower). At 0.1 ~167 min; at 1.0 ~17 min.
const RAIN_RATE_SCALE = 12;
const SNOW_RATE_SCALE = 6;

// Drying: base rate 2/min outdoors, 3/min indoors.
// Multiplied by a temperature factor: every 10°C above 15°C adds 50% more drying speed.
// e.g. 15°C → 1×, 25°C → 1.5×, 35°C → 2×, 45°C → 2.5×
function dryMultiplier(tempC) {
  return 1 + Math.max(0, tempC - 15) / 20;
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

export const hooks = {
  // Increase wetness on equipped wettable items each minute when precipRate > 0,
  // dry them when indoors or precipitation has stopped.
  'tick.minute': async ({ broadcast }) => {
    const env = getEnvironmentState();
    const { precipRate } = env;

    for (const player of getAllLivePlayers()) {
      const playerId = player.id;
      if (player.sleeping) continue;

      const zone = getZone(player.current_zone);
      const isIndoors = zone?.flags?.is_interior ?? false;
      const isPrecipitating = precipRate > 0 && !isIndoors;
      const isSnow = env.currentPrecip === 'snow';
      const zoneTemp = getZoneTemperature(player.current_zone);
      const baseDryRate = isIndoors ? 3 : 2;
      const dryRate = baseDryRate * dryMultiplier(zoneTemp);

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
        const wettingRate = isPrecipitating
          ? precipRate * (isSnow ? SNOW_RATE_SCALE : RAIN_RATE_SCALE)
          : 0;
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

      const wetnessChanged = Math.round(newWetness) !== Math.round(prevWetness);
      if ((messages.length || wetnessChanged) && broadcast) {
        broadcast(null, { type: 'resource_tick', messages, player_update: { wetness: Math.round(newWetness) } }, null, playerId);
      }
    }
  },
};
