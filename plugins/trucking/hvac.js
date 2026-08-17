// plugins/trucking/hvac.js — the cab is a climate-controlled box while the engine runs.
//
// Sibling of bunk.js, and a small file for the same reason: nothing here implements heating.
// The engine owns the thermometer, the setpoint, the rate it climbs at and the rate it bleeds
// away once the key comes out (`registerCabinProvider`, server/engine/environment.js). This
// file answers one question — WHICH CABS EXIST RIGHT NOW, WHO IS IN THEM, AND IS THE ENGINE
// RUNNING — and every downstream behaviour comes free: the body-temperature drift, frostbite's
// peripheral skin temperature and the HUD thermometer all read the same number.
//
// WHY THIS COULD NOT BE A HEAT SOURCE. `registerHeatSource` warms a ZONE, and a driver's
// `current_zone` is the road tile the rig happens to be over — a public outdoor tile with
// pedestrians on it. Heating the zone would heat the street. A cab is climate control that
// travels with a PERSON, which is exactly the distinction the cabin seam exists to draw.
//
// THE ENGINE BIT IS THE ONE THE SIM ALREADY MAINTAINS. `rig.engineOn` is reconciled from the
// cab's own telemetry four times a second (see the ⚠ on the ignition in state.js:reconcileTruck,
// which reads it BEFORE the throttle gate precisely so the server's belief about the key is
// never a sync window stale). So there is no second notion of "is the heater on" to fall out of
// step with the truck — turning the key off starts the cab cooling on the very next tick, and a
// breakdown in a blizzard is a genuine problem rather than a long wait in a warm car.

import { registerCabinProvider } from '../../server/engine/environment.js';
import { rigs } from './state.js';
import { getLivePlayer } from '../../server/engine/world.js';

registerCabinProvider(() => {
  const out = [];
  for (const rig of rigs.values()) {
    if (!rig?.playerId) continue;
    out.push({
      id: `rig:${rig.playerId}`,
      on: !!rig.engineOn,
      // The tile the rig is over, for the engine to bleed toward once the engine stops.
      // `rig.zoneId` is written by driveToZone on every tile; the live player is the fallback
      // for the first moments after a mount, before the rig has driven anywhere.
      zoneId: rig.zoneId || getLivePlayer(rig.playerId)?.current_zone || null,
      occupants: [rig.playerId],
    });
  }
  return out;
});
