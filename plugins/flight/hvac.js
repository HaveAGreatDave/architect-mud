// plugins/flight/hvac.js — a cockpit is a climate-controlled box while the engine runs.
//
// The aircraft half of the vehicle-cabin seam (`registerCabinProvider`,
// server/engine/environment.js). Nothing here implements heating: the engine owns the
// thermometer, the 20°C setpoint, how fast a cabin reaches it and how fast it loses it once the
// engine stops. This file answers only which cabins exist, who is in them, and whether the
// engine is turning — and the body-temperature drift, frostbite's peripheral skin temperature
// and the HUD thermometer all inherit the answer without knowing aircraft exist.
//
// WHY A PILOT NEEDED THIS MORE THAN ANYONE. A player who takes off keeps `current_zone`
// pointing at the airfield they left (see the takeoff loop in index.js — occupants are removed
// from the zone's player SET but not moved anywhere, because there is nowhere to move them to).
// So every thermal question about a pilot was being answered by the weather on a patch of ramp
// they were four thousand feet above, and answered with full wind chill besides. A cockpit is
// the clearest case in the game of climate control that belongs to a person rather than a room.
//
// ⚠ THE WALKABLE CABIN IS NOT THIS. The Leviathan's interior rooms are REAL zones — flagged
// `is_interior`, wired into `power_zones`, and therefore already held at 20°C by the ordinary
// indoor HVAC simulation, running off the airframe's own power exactly as the Echelon's
// interiors run off her junction box. Anybody standing in one is excluded here, or a parked
// Leviathan with cold engines would drag its own furnished lounge down to the outside air —
// a room that got colder than the identical room in a building, for no reason a player could
// see. The room wins wherever there is a room.

import { registerCabinProvider } from '../../server/engine/environment.js';
import { liveAircraft, isCabinZone } from './state.js';
import { getLivePlayer, getZone } from '../../server/engine/world.js';

registerCabinProvider(() => {
  const out = [];
  for (const [id, live] of liveAircraft) {
    if (!live?.occupants?.size) continue;
    const occupants = [];
    let zoneId = null;
    for (const pid of live.occupants) {
      const p = getLivePlayer(pid);
      if (!p) continue;                                            // NPC companions ride along; they have no body temperature
      if (isCabinZone(getZone(p.current_zone), live)) continue;    // see the ⚠ above — the room owns them
      occupants.push(pid);
      zoneId = zoneId || p.current_zone || null;
    }
    if (!occupants.length) continue;
    out.push({ id: `aircraft:${id}`, on: !!live.row?.engine_on, zoneId, occupants });
  }
  return out;
});
