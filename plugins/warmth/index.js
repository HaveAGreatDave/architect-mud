/**
 * Space heaters — the first thing in the game that makes a room WARMER rather than merely
 * sheltered.
 *
 * Why it needed a mechanic first: until the body-temp drift's rewarming rate scaled with how
 * warm you actually are, a heater would have been a decoration. A cold player in a 20°C room
 * and a cold player next to a blazing brazier rewarmed at exactly the same flat 5%/min, so
 * there was nothing a heat source could have DONE. Now that recovery is a gradient, a heater
 * is worth carrying.
 *
 * THE BATTERY IS THE POINT. On mains it is an ordinary appliance and it tops itself up; the
 * charge only matters when the grid drops — which is precisely the "no free safe haven"
 * scenario the extreme-weather system exists to create (HVAC dies in a blackout and an
 * unheated flat bleeds toward outdoor temp). So this is a UPS for your body: twelve in-game
 * hours of holding a room habitable while the district is dark, and then it is a box.
 *
 * Reuses `plug`/`unplug` from the appliances plugin for on/off — a heater is an appliance with
 * `power_draw_kw`, so it inherits those verbs and needs no new ones.
 */
import { getAllZones, getZoneFurniture, updateFurniture, getZonePlayers } from '../../server/engine/world.js';
import { getZonePowerStatus, registerHeatSource } from '../../server/engine/environment.js';
import { isPluggedIn } from '../appliances/index.js';
import { sendToZone } from '../../server/engine/messaging.js';
import { getTimeScale } from '../../server/engine/gametime.js';
import { applyWarmth } from '../../server/engine/warmth.js';

// A heater is any furniture carrying `flags.heater_target_c` — the temperature it HOLDS its
// room at. A target rather than an offset, because that is what a thermostat does and because
// it is self-limiting: a heater makes a freezing room habitable and does nothing at all to a
// room that is already warm, so leaving one running in summer is merely wasteful, not lethal.
const heaterTarget = (f) => Number(f?.flags?.heater_target_c) || 0;
const isHeater = (f) => heaterTarget(f) > 0;
const capacityOf = (f) => Number(f?.flags?.heater_battery_min) || 720;   // 12 in-game hours

// Charge lives in RAM and is flushed coarsely. Writing a furniture row once a minute per
// heater is exactly the per-tick DB write the persistence tiers forbid; a 10% band means a
// twelve-hour discharge costs ten writes instead of seven hundred.
const charge = new Map();       // furnitureId -> minutes remaining
const flushed = new Map();      // furnitureId -> last persisted band
const FLUSH_BAND = 0.1;

function chargeOf(f) {
  if (!charge.has(f.id)) {
    const stored = Number(f.flags?.heater_charge_min);
    charge.set(f.id, Number.isFinite(stored) ? stored : capacityOf(f));
  }
  return charge.get(f.id);
}

async function flush(f, force = false) {
  const cap = capacityOf(f) || 1;
  const band = Math.round((charge.get(f.id) / cap) / FLUSH_BAND);
  if (!force && flushed.get(f.id) === band) return;
  flushed.set(f.id, band);
  const flags = { ...(f.flags || {}), heater_charge_min: Math.round(charge.get(f.id)) };
  await updateFurniture(f.id, { flags: JSON.stringify(flags) }).catch(() => {});
}

// Is this heater actually putting out heat right now? On mains whenever the grid is up;
// otherwise on battery for as long as the battery lasts.
function running(f) {
  if (!isPluggedIn(f)) return false;
  const powered = getZonePowerStatus(f.zone_id) === 'powered';
  return powered || chargeOf(f) > 0;
}

// The engine sums this into `getZoneTemperature`, so the drift, frostbite's peripheral skin
// temperature and the HUD thermometer all agree. Sync and query-free by contract — it is
// called from a per-player hot path.
registerHeatSource((zoneId, baseC) => {
  let best = 0;
  for (const f of getZoneFurniture(zoneId) || []) {
    if (isHeater(f) && running(f)) best = Math.max(best, heaterTarget(f));
  }
  // Two heaters are not twice as warm — they are the same room, held at whichever thermostat
  // is set higher. Summing targets would let a stack of cheap heaters cook an apartment.
  return best > baseC ? best - baseC : 0;
});

export const hooks = {
  'tick.minute': async () => {
    // The hook fires once a REAL minute and carries no clock, so the game-minutes elapsed come
    // straight off the speed knob — the battery is specified in GAME hours, and at 3× a night
    // is three times shorter. Charge is a float in RAM, so fractional scales just work.
    const gm = Math.max(0, getTimeScale() || 1);
    for (const zone of getAllZones()) {
      const furniture = getZoneFurniture(zone.id) || [];
      for (const f of furniture) {
        if (!isHeater(f) || !isPluggedIn(f)) continue;
        const cap = capacityOf(f);
        const before = chargeOf(f);
        const onMains = getZonePowerStatus(f.zone_id) === 'powered';
        if (onMains) {
          // Mains runs it AND tops it up, at half the discharge rate — a full recharge is a
          // day, so a heater that carried you through last night's outage is not automatically
          // ready for tonight's.
          charge.set(f.id, Math.min(cap, before + 0.5 * gm));
        } else if (before > 0) {
          const now = Math.max(0, before - gm);
          charge.set(f.id, now);
          // Tell the room when it dies. A heater going out in a blackout is the single most
          // consequential thing that can happen in a cold snap and it must never be silent.
          if (before > 0 && now === 0 && getZonePlayers(f.zone_id).length) {
            sendToZone(f.zone_id, `<span style="color:var(--orange)">The ${f.name} ticks, dims, and stops. The cold starts coming back in.</span>`);
            await flush(f, true);
            continue;
          }
        }
        if (charge.get(f.id) !== before) await flush(f);
      }
    }
  },

  // The `warming` tag, fired by the engine's consumable path for every item used — so it must
  // be cheap and silent for the overwhelming majority that are food, exactly like the injury
  // and frostbite hooks. Hot DRINKS do not come through here (a vessel never touches
  // `applyItemUse`); the drinks plugin applies their warmth itself, scaled by how hot the cup
  // still is. This is for the disposable stuff: hand warmers, heat patches.
  'item.consumed': (player, tags) => {
    const rx = tags?.warming;
    if (!rx) return undefined;
    const degrees = Number(rx.degrees) || 0;
    const minutes = Number(rx.minutes) || 0;
    if (!(degrees > 0 && minutes > 0)) return undefined;
    applyWarmth(player, degrees, minutes);
    return "It takes a moment, and then it's genuinely, surprisingly hot.";
  },
};

export const _test = { heaterTarget, isHeater, capacityOf, charge, chargeOf, running, FLUSH_BAND };
