// THE LONG HAUL — you log out in the cab, you log back in in the cab.
//
// A rig is RAM-only by design (see the header of state.js), and that is still the right call for
// the DRIVE: nothing here is written per tick, per node or per mile. But "not written per tick" and
// "gone the moment your connection drops" are two different claims, and the second one was an
// accident of the first. A dropped socket halfway across the waste put a player back on their feet
// in a void room with a truck that had ceased to exist, and the only tell was the posture snapping
// out of `driving`. On a train, on hotel wifi, or on a browser that decided to reload, that is the
// haul lost — and it is lost to the network rather than to anything the player did.
//
// So: ONE WRITE AT LOGOUT, ONE READ AT LOGIN, and nothing in between. That is the cheapest tier
// this could possibly live in and it is squarely inside what the persistence rules allow — it is
// session boundary state, not per-tick state. It goes in `player_flags` rather than a new column,
// per the no-sparse-columns rule.
//
// WHAT IS AND IS NOT STORED. Only what cannot be re-derived: which truck, which leg, where on it,
// and what is on the back. Everything else — the route geometry, the corridor chain, the truck's
// tuned parameters, the fuel curve — is rebuilt from the sources that already own it, because a
// second copy of a route in a flag is a route that can disagree with the crossing it belongs to.
//
// THE CORRIDOR HALF IS ALMOST FREE, and that is not luck. A crossing already survives a relog in
// voidwalking's own five player_flags, and `mountOnCrossing` already knows how to put a driver back
// on the road from nothing but `player._crossing` — it is what answers `drive` for somebody who
// walked out into the waste. Resuming a corridor leg is therefore calling the thing that was
// already there, at login, instead of waiting for the player to type the verb.
//
// TWO RULES WORTH KEEPING:
//
//  1. THE FLAG IS CONSUMED, ALWAYS — cleared before anything can throw. A resume record that
//     survives its own failed resume is a player who is put back in a truck they are not in on
//     every single login, forever, and there is no verb to get out of it.
//  2. A FAILED RESUME IS SILENT AND HARMLESS. Every reason it can fail (the truck was sold, the
//     crossing ended, the zone is gone) leaves the player standing exactly where the ordinary login
//     put them. This must never be the thing between somebody and their character.

import { setFlagById, getFlag } from '../../server/engine/flags.js';
import { query } from '../../server/models/db.js';
import { getZone } from '../../server/engine/world.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { setPosture } from '../../server/engine/posture.js';
import { rigs, mountRig, cabContext } from './state.js';
import { getTruck } from './fleet.js';
import { effTruckParams, burnMul } from './rig.js';
import { damageOf, overall } from './damage.js';
import { getTrailer } from './trailers.js';

const KEY = 'truck_resume';

// ── Logout ───────────────────────────────────────────────────────────────────
// Called from the `player.logout` handler. The live player object is already on its way out and the
// flag cache has been evicted, so this writes by id and never reaches for either.
export async function saveDrivingState(playerId) {
  const rig = rigs.get(playerId);
  if (!rig) return false;
  // A parked rig is not a drive to come back to. The point of this is a haul in progress; somebody
  // who stopped, got out and logged off should be standing in a yard, which is where they are.
  if (!rig.truckId) { rigs.delete(playerId); return false; }
  const rec = {
    truckId: rig.truckId,
    leg: rig.leg,
    // City leg only. A corridor leg is rebuilt from the crossing itself, which is the authority on
    // where that road goes — storing corridor coordinates here would be a second copy of a route.
    x: rig.leg === 'city' ? rig.x : null,
    y: rig.leg === 'city' ? rig.y : null,
    heading: Math.round(rig.heading || 180),
    zoneId: rig.zoneId || null,
    fuel: rig.fuel ?? 1,
    cargo: rig.cargo || null,
    trailerId: rig.trailer?.id || null,
    at: Date.now(),
  };
  await setFlagById(playerId, KEY, JSON.stringify(rec)).catch(() => {});
  rigs.delete(playerId);
  return true;
}

// ── Login ────────────────────────────────────────────────────────────────────
// `mountOnCrossing` is passed in rather than imported, because index.js imports this module and a
// cycle back the other way is exactly the kind of load-order tangle the plugin loader punishes.
export async function restoreDrivingState(player, { mountOnCrossing }) {
  if (!player?.id || rigs.has(player.id)) return false;
  const raw = await getFlag('player', KEY, player).catch(() => undefined);
  if (!raw) return false;
  // RULE 1 — consumed first, before anything below can throw.
  await query('DELETE FROM player_flags WHERE player_id=$1 AND flag_key=$2', [player.id, KEY]).catch(() => {});

  let rec = null;
  try { rec = JSON.parse(raw); } catch { return false; }
  if (!rec?.truckId) return false;

  // The truck has to still be yours. Selling it from another session, an impound, or a wipe all
  // land here, and all of them mean the same thing: there is nothing to get back into.
  // `getTruck` is already owner-scoped — it takes the player id and returns null for somebody
  // else's truck — so ownership is the query, not a check after it.
  const owned = await getTruck(rec.truckId, player.id).catch(() => null);
  if (!owned) return false;

  // The corridor half. `player._crossing` is hydrated by voidwalking at login from its own flags,
  // so if it is there the crossing genuinely survived and the existing mount path is correct and
  // complete — including lining the rig up on the room the player woke up in.
  if (rec.leg === 'corridor' && player._crossing) {
    const out = mountOnCrossing(player);
    if (out) sendToPlayer(player.id, out);
    return true;
  }

  // The city half. The rig goes back on the tile it was on, stopped — never rolling. Whatever was
  // happening when the connection dropped, waking up already moving at fifty is not a recovery,
  // it is a second accident.
  const zone = getZone(rec.zoneId) || getZone(player.current_zone);
  if (!zone || zone.grid_x == null) return false;
  const x = rec.x ?? zone.grid_x, y = rec.y ?? zone.grid_y;

  const rig = mountRig(player, { x, y, heading: rec.heading ?? 180, depot: zone.id });
  rig.zoneId = zone.id;
  rig.truckId = owned.id;
  rig.typeId = owned.type_id;
  rig.type = owned.type;
  rig.cd = owned.custom_data || {};
  // The component bag first, and the headline number derived from it — never the other way round.
  rig.dmg = damageOf({ cd: rig.cd, condition: owned.condition });
  rig.condition = overall(rig.dmg);
  rig.params = effTruckParams(owned.type_id, rig.cd, rig.condition, rig.dmg);
  rig.burnMul = burnMul(rig.cd);
  // Fuel comes off the TRUCK ROW, not the flag. The row is the authority and it is written on
  // dismount; the flag's copy is a fallback for a rig that never got that far.
  rig.fuel = owned.fuel ?? rec.fuel ?? 1;
  rig.travelled = 0;
  rig.speed = 0;
  rig.cargo = rec.cargo || null;
  // The trailer is re-read rather than trusted. It is a row with its own owner and its own place,
  // and between the two sessions somebody may legitimately have taken it — in which case you wake
  // up bobtail, which is true, rather than towing a box that is standing in another yard.
  if (rec.trailerId) {
    const t = await getTrailer(rec.trailerId).catch(() => null);
    if (t && t.towedBy === owned.id) rig.trailer = t;
    else rig.cargo = null;                        // no trailer, nothing to have been carrying
  }
  setPosture(player, 'driving');
  // Type AFTER the spread — see the ⚠ in cmdDrive; `cabContext` carries its own type and writing
  // ours first lets the spread quietly turn the mount into an ordinary context update.
  sendToPlayer(player.id, { ...cabContext(rig, { mounted: true }), type: 'truck_sim' });
  sendToPlayer(player.id, {
    type: 'emote',
    message: '<span class="text-green">You come to with your hands still on the wheel and the engine idling. '
      + 'However long you were out, the road is where you left it.</span>',
  });
  return true;
}
