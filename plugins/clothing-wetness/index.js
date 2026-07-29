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
import { getAllLivePlayers, getZone, bodyZoneOf } from '../../server/engine/world.js';
import { resolveInventoryForPlayers, patchInventoryCustomData } from '../../server/engine/inventory.js';
import { wear, announceWear } from '../../server/engine/durability.js';

// Wear points per minute at full-rate acid, before the precipRate scale. Sits
// between `hard_use` (2) and `mishap` (8): a hero event should visibly cost you
// gear over its ~5-minute peak without shredding a good coat in one downpour.
const ACID_WEAR_POINTS = 4;

function rainWettingRate(precipRate) {
  return precipRate * precipRate * 30;
}

function snowWettingRate(precipRate) {
  if (precipRate <= 0.2) return precipRate * 2;
  if (precipRate <= 0.7) return precipRate * 6;
  return Math.min(precipRate * 3, 3); // blizzard — dry wind limits soak rate
}

// Bare skin sheds water far faster than cloth does — it absorbs none, so there is nothing
// to evaporate but the film on the surface. Multiplies the garment dry rate for a player
// wearing nothing wettable: soaked skin is dry in ~7 minutes at the outdoor base rate and
// faster once wind, heat or an interior multiply it — against ~50 minutes for a soaked coat.
const SKIN_DRY_FACTOR = 8;

// One minute of weather on bare skin. Split out from the tick so the rule it encodes is
// testable on its own: skin WETS at the same rate cloth does and DRIES much faster — it is
// never simply "always dry", which is what the old `wetness = 0` shortcut amounted to.
function skinWetnessStep(prev, { isPrecipitating, wettingRate, dryRate }) {
  const next = isPrecipitating ? prev + wettingRate : prev - dryRate * SKIN_DRY_FACTOR;
  return Math.max(0, Math.min(100, next));
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
    // ONE read and ONE write for the whole world, not one of each per player.
    // This hook is awaited by the minute tick, so the old shape (a joined SELECT
    // per player, then an UPDATE per changed garment) put ~6-8 serial round trips
    // per player in front of radiation and drug decay — at 50 players that is
    // several hundred sequential waits inside a 60-second tick, holding a pool
    // slot while player commands queue behind it.
    // SLEEPERS INCLUDED. Rain does not check whether you're awake, and since the body's
    // temperature drift now follows you into bed (gameLoop's driftBodyTemperature), leaving
    // sleepers dry would have quietly re-created the immunity that change removed — sleeping
    // rough in a downpour would cost you the ambient cold but never the 2× wet multiplier.
    // They get no wetness MESSAGES, though: they're asleep. Cold is what wakes them.
    const people = getAllLivePlayers();
    if (!people.length) return;
    const equippedByPlayer = await resolveInventoryForPlayers(
      people.map(p => p.id), { equipped: true, topLevel: false });
    // [invId, {wetness}] pairs, flushed together after the loop.
    const wetnessPatches = [];

    for (const player of people) {
      const playerId = player.id;
      const asleep = !!player.sleeping;
      const say = (payload) => { if (!asleep && broadcast) broadcast(null, payload, null, playerId); };

      // The BODY's room, not the mind's — a dreamer's current_zone is a dreamscape with
      // no sky, but the body it belongs to may be lying out in the rain.
      const zoneId = bodyZoneOf(player);
      const zone = getZone(zoneId);
      const isIndoors = zone?.flags?.is_interior ?? false;
      // Local precipitation at the player's tile — under a passing cell or not.
      const { precipRate, precipType } = getZonePrecip(zoneId);
      const isPrecipitating = precipRate > 0 && !isIndoors;
      const isSnow = precipType === 'snow';
      const zoneTemp = getZoneTemperature(zoneId);
      const baseDryRate = isIndoors ? 3 : 2;
      // Wind and humidity only bite outdoors; interiors are sheltered and HVAC-neutral.
      const windMult = isIndoors ? 1 : windMultiplier(getWindKph());
      const humidMult = isIndoors ? 1 : humidityMultiplier(getHumidityPct());
      const dryRate = baseDryRate * dryMultiplier(zoneTemp) * windMult * humidMult;

      const rows = equippedByPlayer.get(playerId) || [];
      const wettable = rows.filter(r => hasTag(r, 'gets_wet'));

      // ── Acid corrosion ────────────────────────────────────────────────────
      // Acid eats EVERYTHING you're wearing, not just the things that get wet,
      // and a waterproof piece sheds it. This is the one sanctioned exception to
      // durability rule 1 ("wear accrues on use, never on the clock"): it is not
      // the clock, it's the player choosing to stand in a hero event — gear in a
      // wardrobe, or on a body under shelter, is untouched. `wear` is sync by
      // contract, so this adds no round trips.
      if (precipType === 'acid' && precipRate > 0 && !isIndoors) {
        for (const item of rows) {
          if (hasTag(item, 'waterproof')) continue;
          announceWear(player, item, wear(player, item, ACID_WEAR_POINTS * precipRate, 'acid rain'));
        }
      }

      // Submersion (swimming, player._submerged from the swimming plugin) soaks you
      // completely — skin and every wettable garment — overriding the precipitation
      // model. Runs BEFORE the no-wettables early-return so a bare-skinned swimmer
      // still reads soaked. On climbing out, the normal drying below takes over
      // (equipped garments drip-dry gradually; bare skin dries at once).
      if (player._submerged) {
        for (const item of wettable) {
          if ((item.custom_data?.wetness ?? 0) < 100) wetnessPatches.push([item.inv_id, { wetness: 100 }]);
        }
        const prevWetness = player.wetness ?? 0;
        player.wetness = 100;
        const messages = [];
        for (const t of WETNESS_THRESHOLDS) {
          if (prevWetness < t.value && 100 >= t.value) messages.push(t.risingMsg);
        }
        if ((messages.length || Math.round(prevWetness) !== 100) && broadcast) {
          say({ type: 'resource_tick', messages, player_update: { wetness: 100 } });
        }
        continue;
      }

      const wettingRate = isPrecipitating
        ? (isSnow ? snowWettingRate(precipRate) : rainWettingRate(precipRate))
        : 0;

      // ── Bare skin ─────────────────────────────────────────────────────────
      // This used to pin `wetness` to 0 whenever nothing wettable was equipped, which read as
      // "bare skin dries at once" (true, and what the submersion branch above hands over to)
      // but silently also meant "bare skin never gets wet" — so a naked player in freezing
      // rain took the −15 exposure penalty and NONE of the 2× wet multiplier, making
      // stripping off a way to shrug off a storm. Skin wets like anything else; it just holds
      // no water, so it sheds several times faster than cloth. RAM-only, because skin has no
      // inventory row to persist to — which is correct: nobody logs back in still damp.
      if (!wettable.length) {
        const prev = player.wetness ?? 0;
        const next = skinWetnessStep(prev, { isPrecipitating, wettingRate, dryRate });
        player.wetness = next;
        const msgs = [];
        for (const t of WETNESS_THRESHOLDS) {
          if (prev < t.value && next >= t.value) msgs.push(t.risingMsg);
          else if (prev > t.value && next <= t.value) msgs.push(t.fallingMsg);
        }
        if (next === 0 && prev > 0) msgs.push(DRY_MSG);
        if (msgs.length || Math.round(prev) !== Math.round(next)) {
          say({ type: 'resource_tick', messages: msgs, player_update: { wetness: Math.round(next) } });
        }
        continue;
      }

      let totalWetness = 0;
      for (const item of wettable) {
        const prev = item.custom_data?.wetness ?? 0;
        let next = isPrecipitating ? prev + wettingRate : prev - dryRate;
        next = Math.max(0, Math.min(100, next));
        totalWetness += next;

        if (Math.round(next) !== Math.round(prev)) wetnessPatches.push([item.inv_id, { wetness: Math.round(next) }]);
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
        say({ type: 'resource_tick', messages, player_update: { wetness: Math.round(newWetness) } });
      }
    }

    // One write for every garment that changed, anywhere in the world.
    if (wetnessPatches.length) await patchInventoryCustomData(wetnessPatches);
  },
};

// Test surface (regress only; never imported in production).
export const _test = {
  rainWettingRate, snowWettingRate, dryMultiplier, windMultiplier, humidityMultiplier,
  skinWetnessStep, SKIN_DRY_FACTOR, WETNESS_THRESHOLDS,
};
