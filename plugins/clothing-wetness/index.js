/**
 * Clothing Wetness Plugin
 *
 * Hooks:
 *   tick.minute — increases wetness on equipped wettable items when precipRate > 0,
 *                 dries them when indoors or when precipitation has stopped.
 *
 * Wetness thresholds: 25 (damp), 50 (wet), 75 (very wet), 100 (soaked)
 *
 * WATER RUNS OUTSIDE-IN. Rain lands on your outermost layer and only what that
 * layer passes reaches the next one down, and finally the skin — see
 * `layerPassthrough`. This is the rule the whole file is arranged around, and it
 * is why `waterproof` is worth wearing: the old model wet every garment you had
 * on at the same rate simultaneously, so a slicker over a shirt left the shirt
 * exactly as soaked as no slicker at all.
 *
 * Rain wetting: precipRate^1.4 × 34 per minute, on the OUTERMOST layer
 *   light rain (0.3) → ~19 min to soaked
 *   moderate  (0.5) → ~9 min
 *   heavy     (0.65)→ ~6 min
 *   torrential(0.95)→ ~4 min
 *   × driven-rain multiplier (up to 1.6× at gale — wind drives water into cloth)
 *
 * Snow wetting: piecewise linear — blizzard (dry wind) is slower than heavy snow
 *   light flurries (≤0.2) → ~250 min (effectively never)
 *   moderate–heavy (0.2–0.7) → precipRate × 6 per minute
 *   blizzard (>0.7) → min(precipRate × 3, 3) per minute (dry wind cap)
 *   NOT wind-driven: dry blown snow is the one case where a gale wets you less,
 *   which `snowWettingRate` already caps for.
 *
 * Drying: base 2/min outdoors, 3/min indoors, × temp multiplier (every 10°C above 15°C adds 50%).
 *   Outdoors also × wind multiplier (up to 2.5× at gale) and × humidity multiplier
 *   (damp air slows evaporation, dry air speeds it). Interiors are sheltered/HVAC-neutral.
 *   Evaporation is proportional to how much water is left (`dryStep`), so a garment
 *   sheds the first half fast and keeps a long damp tail — the opposite of the old
 *   linear subtraction, which dried the last 10 points as fast as the first 10.
 */
import { query } from '../../server/models/db.js';
import { hasTag, tagValue } from '../../server/engine/tags.js';
import { getZoneTemperature, getZonePrecip, getWindKph, getHumidityPct } from '../../server/engine/environment.js';
import { getAllLivePlayers, getZone, bodyZoneOf } from '../../server/engine/world.js';
import { resolveInventoryForPlayers, patchInventoryCustomData } from '../../server/engine/inventory.js';
import { wear, announceWear } from '../../server/engine/durability.js';

// Wear points per minute at full-rate acid, before the precipRate scale. Sits
// between `hard_use` (2) and `mishap` (8): a hero event should visibly cost you
// gear over its ~5-minute peak without shredding a good coat in one downpour.
const ACID_WEAR_POINTS = 4;

// Rain: superlinear, so a downpour still dwarfs a drizzle, but a gentler exponent than
// the old square. `precipRate²` suppressed the bottom of the range so hard that light
// rain took 37 minutes to soak a coat — you are visibly wet in real light rain inside ten.
// Torrential is deliberately left where it was; this only lifts the light-to-heavy band.
function rainWettingRate(precipRate) {
  return Math.pow(precipRate, 1.4) * 34;
}

function snowWettingRate(precipRate) {
  if (precipRate <= 0.2) return precipRate * 2;
  if (precipRate <= 0.7) return precipRate * 6;
  return Math.min(precipRate * 3, 3); // blizzard — dry wind limits soak rate
}

// ── The layer stack ─────────────────────────────────────────────────────────────
// Worn layers, OUTERMOST FIRST — the order water meets them in. `layer` defaults to
// outerwear when unset (same default the equip code uses), so an unauthored garment
// sits in the middle of the stack rather than against the skin.
const LAYER_ORDER = { armor: 0, outerwear: 1, underwear: 2 };
function layerRank(item) { return LAYER_ORDER[tagValue(item, 'layer') || 'outerwear'] ?? 1; }

// The body slots rain can land on. `weapon_hand` and `accessory` are not coverage.
const BODY_SLOTS = ['head', 'torso', 'hands', 'legs', 'feet'];

// Share of the exposed body each slot accounts for. Sums to 1. This is what makes
// `player.wetness` an area-weighted average instead of an unweighted mean over
// garments, where a wet hat counted for as much as a wet coat and putting on more
// clothes changed the number without changing anything physical.
const SLOT_AREA = { head: 0.09, torso: 0.36, hands: 0.05, legs: 0.40, feet: 0.10 };

// Every body slot a garment actually sits over: its own plus anything in `covers`.
function slotsOf(item) {
  const out = [];
  const slot = tagValue(item, 'slot');
  if (BODY_SLOTS.includes(slot)) out.push(slot);
  const covers = tagValue(item, 'covers');
  if (Array.isArray(covers)) for (const c of covers) if (BODY_SLOTS.includes(c) && !out.includes(c)) out.push(c);
  return out;
}

const WATERPROOF_PASSTHROUGH = 0.05;  // an oilskin sheds all but a trickle down the collar
const SHELL_PASSTHROUGH      = 0.9;   // plate/plastic: holds no water, so it runs straight off onto what's below
const DRY_CLOTH_PASSTHROUGH  = 0.15;  // dry cloth drinks nearly everything that lands on it

// Fraction of the water arriving at a garment that reaches the layer beneath it.
// The load-bearing part is the saturation term: a DRY coat protects the shirt under
// it and a SOAKED one barely does, because there is nowhere left for the water to go.
// That is the single most recognisable thing about being rained on, and the flat model
// had none of it.
function layerPassthrough(item, wetness = 0) {
  if (hasTag(item, 'waterproof')) return WATERPROOF_PASSTHROUGH;
  if (!hasTag(item, 'gets_wet')) return SHELL_PASSTHROUGH;
  return DRY_CLOTH_PASSTHROUGH + (1 - DRY_CLOTH_PASSTHROUGH) * (Math.max(0, Math.min(100, wetness)) / 100);
}

// Wind drives rain into cloth rather than letting it run off — horizontal rain wets you
// faster than the same rain falling straight down. Deliberately weaker than the drying
// bonus wind also grants (`windMultiplier`, up to 2.5×), so a gale is still net-drying
// once the rain stops but is worse than a still day while it falls.
function drivenRainMultiplier(windKph) {
  return 1 + Math.min(0.6, windKph / 60);
}

// Absorption tapers as a garment fills: the last of the capacity is the hardest to use.
// Keeps the approach to `soaked` asymptotic instead of the old hard clamp arriving at
// full speed.
const SATURATION_TAPER = 0.35;
function absorbStep(prev, incoming) {
  const next = prev + incoming * (1 - SATURATION_TAPER * (prev / 100));
  return Math.max(0, Math.min(100, next));
}

// Evaporation is proportional to the water still there, with a floor so the tail still
// terminates in finite time rather than crawling toward zero forever.
const DRY_FLOOR = 0.3;
function dryStep(prev, dryRate) {
  return Math.max(0, prev - dryRate * (DRY_FLOOR + (1 - DRY_FLOOR) * (prev / 100)));
}

// Bare skin sheds water far faster than cloth does — it absorbs none, so there is nothing
// to evaporate but the film on the surface. Multiplies the garment dry rate for a player
// wearing nothing wettable: soaked skin is dry in ~7 minutes at the outdoor base rate and
// faster once wind, heat or an interior multiply it — against ~50 minutes for a soaked coat.
const SKIN_DRY_FACTOR = 8;

// …but skin under cloth barely airs at all. A slot with a soaked garment over it stays
// clammy long after a bare one has dried, which is the honest reason to take a wet coat off.
const COVERED_SKIN_DRY_FACTOR = 1.5;

// Per-slot skin wetness, lazily created. RAM-only and deliberately not persisted.
function skinState(player) {
  if (!player._skinWetness) {
    // Seed from whatever the player already read as, so a restart mid-storm doesn't
    // snap a soaked body to bone dry.
    const seed = player.wetness ?? 0;
    player._skinWetness = Object.fromEntries(BODY_SLOTS.map(s => [s, seed]));
  }
  return player._skinWetness;
}

// One minute of weather on bare skin. Split out from the tick so the rule it encodes is
// testable on its own: skin WETS at the same rate cloth does and DRIES much faster — it is
// never simply "always dry", which is what the old `wetness = 0` shortcut amounted to.
// Skin drying stays LINEAR where cloth's is proportional: there is nothing absorbed to
// wick back out, just a film evaporating at a roughly constant rate until it's gone.
function skinWetnessStep(prev, { isPrecipitating, wettingRate, dryRate, dryFactor = SKIN_DRY_FACTOR }) {
  const next = isPrecipitating ? prev + wettingRate : prev - dryRate * dryFactor;
  return Math.max(0, Math.min(100, next));
}

// Walk one slot's stack outermost-in, handing each garment the water that reached it and
// passing on what it sheds. Returns the per-item arrival rates plus whatever finally
// lands on skin. Pure, so the layering rule is testable without a world.
function stackFlux(stack, incomingRate, wetnessOf) {
  const arrivals = new Map();
  let flux = incomingRate;
  for (const item of stack) {
    arrivals.set(item, flux);
    flux *= layerPassthrough(item, wetnessOf(item));
  }
  return { arrivals, skinFlux: flux };
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
        // Under water there is no outermost layer — every slot is against it.
        player._skinWetness = skinState(player);
        for (const s of BODY_SLOTS) player._skinWetness[s] = 100;
        const messages = [];
        for (const t of WETNESS_THRESHOLDS) {
          if (prevWetness < t.value && 100 >= t.value) messages.push(t.risingMsg);
        }
        if ((messages.length || Math.round(prevWetness) !== 100) && broadcast) {
          say({ type: 'resource_tick', messages, player_update: { wetness: 100 } });
        }
        continue;
      }

      // Rain is driven into cloth by wind; dry blown snow is the opposite case and
      // `snowWettingRate` already caps for it, so the multiplier is rain-only.
      const wettingRate = isPrecipitating
        ? (isSnow ? snowWettingRate(precipRate)
                  : rainWettingRate(precipRate) * drivenRainMultiplier(getWindKph()))
        : 0;

      // ── Outside-in ────────────────────────────────────────────────────────
      // Build one stack per body slot, outermost garment first, and walk the water down
      // it. Everything below — how wet each garment gets, how wet the skin under it gets,
      // and the single number the HUD and the cold tick read — falls out of that walk.
      const stacks = new Map(BODY_SLOTS.map(s => [s, []]));
      // A wettable with no body slot (an accessory, a slung bag) is in the weather with
      // nothing over it, so it takes the full rate and shields nothing.
      const unslotted = [];
      for (const item of rows) {
        const slots = slotsOf(item);
        if (!slots.length) { if (hasTag(item, 'gets_wet')) unslotted.push(item); continue; }
        for (const s of slots) stacks.get(s).push(item);
      }
      for (const s of BODY_SLOTS) stacks.get(s).sort((a, b) => layerRank(a) - layerRank(b));

      const wetnessOf = (item) => item.custom_data?.wetness ?? 0;
      // Area-weighted mean of the water arriving at a garment across the slots it covers —
      // a jumpsuit is mostly legs and torso, so that is where its wetness comes from.
      const arrivalTotals = new Map();   // item → { flux, area }
      const skinFluxBySlot = {};
      for (const s of BODY_SLOTS) {
        const { arrivals, skinFlux } = stackFlux(stacks.get(s), wettingRate, wetnessOf);
        skinFluxBySlot[s] = skinFlux;
        for (const [item, flux] of arrivals) {
          const acc = arrivalTotals.get(item) || { flux: 0, area: 0 };
          acc.flux += flux * SLOT_AREA[s];
          acc.area += SLOT_AREA[s];
          arrivalTotals.set(item, acc);
        }
      }

      // ── Garments ──────────────────────────────────────────────────────────
      for (const item of wettable) {
        const prev = wetnessOf(item);
        const acc = arrivalTotals.get(item);
        const arriving = unslotted.includes(item) ? wettingRate
                       : acc && acc.area > 0 ? acc.flux / acc.area : 0;
        const next = isPrecipitating ? absorbStep(prev, arriving) : dryStep(prev, dryRate);
        if (Math.round(next) !== Math.round(prev)) wetnessPatches.push([item.inv_id, { wetness: Math.round(next) }]);
        // Keep the in-memory row in step with what we just queued, rounded the same way, so
        // the layer walk next tick reads the same number the DB holds.
        item.custom_data = { ...(item.custom_data || {}), wetness: Math.round(next) };
      }

      // ── Skin, per slot ────────────────────────────────────────────────────
      // This used to pin `wetness` to 0 whenever nothing wettable was equipped, which read as
      // "bare skin dries at once" (true, and what the submersion branch above hands over to)
      // but silently also meant "bare skin never gets wet" — so a naked player in freezing
      // rain took the −15 exposure penalty and NONE of the 2× wet multiplier, making
      // stripping off a way to shrug off a storm. Skin wets like anything else; it just holds
      // no water, so it sheds several times faster than cloth. RAM-only, because skin has no
      // inventory row to persist to — which is correct: nobody logs back in still damp.
      // It is per-slot now because the layer walk delivers a different amount of water to
      // each: a hood keeps your head dry while your boots fill.
      const skin = skinState(player);
      for (const s of BODY_SLOTS) {
        const covered = stacks.get(s).length > 0;
        skin[s] = skinWetnessStep(skin[s], {
          isPrecipitating, wettingRate: skinFluxBySlot[s], dryRate,
          dryFactor: covered ? COVERED_SKIN_DRY_FACTOR : SKIN_DRY_FACTOR,
        });
      }

      // ── The one number ────────────────────────────────────────────────────
      // What the HUD shows and the body-temp tick multiplies by is how wet you FEEL, which
      // is the water against your skin and in the layer touching it — not the average of
      // every garment you own. A soaked shell over a dry shirt reads as dry, correctly, and
      // that is what finally makes a raincoat do something.
      const prevWetness = player.wetness ?? 0;
      let newWetness = 0;
      for (const s of BODY_SLOTS) {
        const stack = stacks.get(s);
        const innermost = stack.length ? stack[stack.length - 1] : null;
        const cloth = innermost && hasTag(innermost, 'gets_wet') ? wetnessOf(innermost) : 0;
        newWetness += SLOT_AREA[s] * Math.max(skin[s], cloth);
      }
      player.wetness = newWetness;

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
  skinWetnessStep, SKIN_DRY_FACTOR, COVERED_SKIN_DRY_FACTOR, WETNESS_THRESHOLDS,
  layerPassthrough, layerRank, slotsOf, stackFlux, drivenRainMultiplier,
  absorbStep, dryStep, BODY_SLOTS, SLOT_AREA,
};
