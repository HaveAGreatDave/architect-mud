// THE BASIN — a race boat you drive.
//
// The water half of THE LONG HAUL, and built to its shape on purpose: a client-sim integrator the
// server reconciles rather than re-runs (`stepBoat` in flight-model.js), a row that is the
// OWNERSHIP while the TYPE is the boat, and a hull bar that is the one number the whole thing turns
// on. What it deliberately does NOT borrow is the gearbox — a blown boat has one drive and no
// ratios, so the interesting longitudinal decision is the throttle alone.
//
// ── ⚠ WHAT IS HERE AND WHAT IS NOT ──────────────────────────────────────────
//
// All of it ships now. The physics, the mesh, the wake and the break-up were first; the boatyard
// ([yard.js](yard.js)) decides where a hull lives between runs; and the seat is both rungs —
// [helm.js](helm.js) hands the browser a helm and takes its telemetry back, [texthelm.js](texthelm.js)
// runs the same `stepBoat` here for a player who is not looking at a canvas.
//
// `rigs` was a real registry with no producers for months — a finished seam waiting for the thing
// that fills it, the same arrangement `ownWake` was in. Both rungs fill it now, and that is not a
// detail: it is the map `vehicle.contacts` publishes, so a boat missing from it is one nobody else
// on the Basin can see, hear or collide with, and nothing anywhere would say so.

import { registerAction } from '../../server/engine/actions.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { query } from '../../server/models/db.js';
import { hurtInWreck, wreckSeverity, wreckLines } from './breakup.js';
import { cmdBoat, cmdBoats, cmdBerth, cmdRefit, boatEmbark, boatDisembark, aboard, berthKind } from './yard.js';
// The seat. `yard.js` owns where a hull lives between runs; this owns the twenty seconds after you
// step down into her — the helm the client paints, the telemetry back, and the events it reports.
import { cmdHelm, cmdBoatSync, cmdBoatEvent } from './helm.js';
// The bottom two Display Mode rungs: the same `stepBoat`, run here, conned by order. See its
// header — a helm is a surface you ACT through, so without this the whole system is unreachable
// for anybody not looking at a canvas.
import { cmdConn, endTextHelm } from './texthelm.js';
// The yard as a screen — the `prefersLoggedPanels` half. ⚠ It decides nothing: every button on it
// sends a verb a player could have typed, so deleting it leaves nobody stuck.
import { installMarinaShopfront, repushMarina } from './shopfront.js';
// The tank. `stepBoat` has spent fuel since the day it shipped and nothing anywhere could put any
// in, which made a 14,500₵ hull a four-minute countdown. Registers BOAT_FUEL and answers the
// forecourt's price board.
import { fuelPrices } from './fuel.js';
// Stopping in the middle of the Basin: over the side into the water, the hull left floating where
// you left her, and the launch that comes out for her when the tank runs dry.
import { overboard, describeAdrift } from './adrift.js';

// Every boat currently under way, by player id. RAM only and deliberately so: a position on the
// water is per-tick state, and the persistence tiers are explicit that per-tick state does not go
// to the database. What survives a restart is the row — where she is berthed, her fuel and her
// hull — and a boat that was out on the water comes back tied up, which is the same answer the
// truck gives and for the same reason.
export const rigs = new Map();

// ── THE WRECK ────────────────────────────────────────────────────────────────
//
// Registered as an ACTION rather than exported as a function, because the thing that fires it is
// the sim noticing the hull reached zero, and an action is how one system reaches another here
// without importing it. Same arrangement demolition uses for CHARGE_CRIME: the plugin that owns the
// consequence registers it by name, and the plugin that causes it dispatches by name.
//
// ⚠ IT DOES NOT KILL ANYBODY. `hurtInWreck` reports `killed` and the caller routes it, because a
// death that skipped the engine's own death path leaves no corpse, no respawn zone and no wanted
// handling. See the note in breakup.js.
registerAction({
  type: 'BOAT_BREAKUP',
  validate: ({ actor }) => (actor ? null : 'no one is in the boat'),
  handler: async ({ actor, params = {} }) => {
    const sev = params.severity != null
      ? params.severity
      : wreckSeverity({ speed: params.speed, topSpeed: params.topSpeed, impact: params.impact });
    const res = await hurtInWreck(actor, sev);
    const lines = wreckLines(res, params.boatName || 'the boat');

    // The boat is gone. ⚠ DELETED RATHER THAN ZEROED, which is the decision taken up front: a hull
    // at zero is matchwood, not a repair job, so leaving the row behind at condition 0 would be a
    // wreck sitting in somebody's fleet list forever pretending to be an asset.
    if (params.boatId) {
      try { await query('DELETE FROM boats WHERE id = $1', [params.boatId]); }
      catch (err) { console.error('BOAT_BREAKUP: could not delete boat ' + params.boatId + ': ' + err.message); }
    }
    rigs.delete(actor.id);
    // The boat is gone, so the seat goes with it — see the note on BOAT_DISEMBARK.
    sendToPlayer(actor.id, { type: 'boat_sim_close' });

    return { ok: true, ...res, lines };
  },
});

// ── WHO IS OUT THERE ─────────────────────────────────────────────────────────
//
// The seam that puts a boat in a pilot's windscreen and a driver's mirror. `vehicle.contacts` is
// asked by the flight sim and answered by whoever has something afloat or on the road; trucking
// already answers it, and this is the water's reply.
//
// ⚠ THE SHAPE IS `airContact`'s AND THE UNITS ARE ITS UNITS. A contact carries `ias`, and the two
// existing producers disagree about what that means — aircraft send knots off their airspeed,
// trucks send mph off theirs — which the renderer's own note flags as a live divergence. A boat is
// a boat, so it sends KNOTS, and the wake the renderer paints is driven off `wake` rather than off
// `ias` precisely so the picture does not depend on winning that argument.
function boatContactsNear(x, y, range = 26) {
  if (!rigs.size) return [];
  const out = [];
  for (const rig of rigs.values()) {
    if (rig.x == null || rig.y == null) continue;
    if (Math.hypot(rig.x - x, rig.y - y) > range) continue;
    out.push({
      id: 'boat_' + rig.playerId,
      cls: rig.typeId || 'hydro',
      x: rig.x, y: rig.y,
      hdg: rig.heading || 0,
      ias: Math.round((rig.speed || 0) * 0.8689),      // mph on the dial -> knots on the wire
      wake: Math.max(0, Math.min(1.25, (rig.speed || 0) / Math.max(1, rig.topSpeed || 138))),
      alt: 0, band: 'ground', onGround: true, groundZ: 0, altDiff: 0,
      bank: (rig.roll || 0) * 180 / Math.PI,
      pitch: (rig.pitch || 0) * 180 / Math.PI,
      vs: 0,
      hullPct: Math.max(0, Math.round((rig.hull ?? 1) * 100)),
      // ⚠ THREE FIELDS FOR THE MOTOR, AND THE TWO SMALL ONES ARE THE INTERESTING ONES. `power` is
      // the blower follower — what the engine is making — and the renderer draws a flame off the
      // GAP between that and the lever, because that gap IS unburnt fuel going down a pipe. The
      // sim owns the derivative (it is the only party here with a dt), so a boat stabbing the
      // throttle two hundred yards away lights up in your windscreen without this file knowing
      // what a flame is.
      power: +(rig.pedal ?? 0).toFixed(2),
      rich: +(rig.rich ?? 0).toFixed(2),
      bang: +(rig.bang ?? 0).toFixed(2),
      nitroOn: !!rig.nitroOn,
      // ⚠ WHAT MAKES THIS A HULL RATHER THAN AN AEROPLANE, and it is a flag rather than something
      // anybody infers from `cls`. One contact shape carries aircraft, trucks and boats, and the
      // audio layer has to pick the hulls out of it — a class-name allowlist over there would be a
      // second register of what floats, out of date the first time a second hull ships and silent
      // about it, because what it gets wrong is a boat that makes no noise.
      marine: true,
      reg: rig.name || 'boat',
      livery: rig.livery || null,
    });
  }
  return out;
}

installMarinaShopfront();

export const hooks = {
  'vehicle.contacts': (x, y, range) => boatContactsNear(x, y, range),
  // A hull somebody left floating in this square of water. ⚠ GATHERED, so this line sits beside
  // whatever else the room has to say rather than replacing it, and it answers `undefined` for
  // every tile in the world that is not open water — which is all but 932 of them — before it
  // costs a query.
  'zone.describeRoom': (zone, player) => describeAdrift(zone, player),
  // What the forecourt's board and the price pylon print for marine fuel. ⚠ SYNC BY CONTRACT —
  // see the note on `fuelPrices`: the map window derives ~5,300 cells a snapshot, so a contributor
  // that turns async keeps working for `examine` and silently vanishes from the sign.
  'fuel.prices': (zone) => fuelPrices(zone),
  // ⚠ SITTING IN A BOAT IS NOT SWIMMING, AND NOTHING KNEW IT. Swimming decides who is treading
  // water from what they are CARRYING, which is the only thing it can see on its own — so a player
  // who climbed into a hull lying off the quay was a body in the water to every rule it owns, and
  // the tick bled their stamina until they drowned at the wheel of a perfectly good boat. One
  // `Map.has` out of RAM; sync by that hook's contract, because it is asked on every move in the
  // game and once a second for every body in the water.
  'swim.afloat': (player) => !!player && aboard.has(player.id),
  // ⚠ A BERTH IS NOT SHUTTABLE, WHATEVER ELSE HAPPENS TO TRADE IN IT. Marit Colvane sells
  // chandlery and her shift is in the covered dock, so commerce derived the hall as her shopfront
  // and locked it at six and all day Sunday — with the player's boat inside. Her work zone cannot
  // move, because `refit` wants a shipwright in the same room as a covered berth and that is the
  // whole reason it was put there. A place you keep a vehicle has no closing time, and the
  // marina's own prose has said so from the first commit: the dock does not lock, there is no lock
  // on it. Sync — a flags read — because the shut provider behind this is asked for every cardinal
  // side of every interior tile in the minimap window.
  'shop.neverShuts': (zone) => !!berthKind(zone),
};

// ── THE BOATYARD ─────────────────────────────────────────────────────────────
//
// The piece the header above has been holding a seam open for. It owns no physics — it owns where a
// hull LIVES between runs, which is `boats.berth_zone` and nothing else.

// ⚠ `helm` IS NOT THIS PLUGIN'S VERB AND NEVER WAS — `plugins/yacht` has declared it since long
// before the marina existed, and the loader's last writer wins, so every `helm` a boat owner typed
// reached the Echelon and came back "You can only take the helm from her bridge." The README's own
// collision warning, three lines under the verb list, checked `refit` and `conn` and missed the one
// word in that list that was already taken — which is exactly the failure it describes.
//
// The way out is the `CHARGE_CRIME` idiom rather than an import: the boat's helm is an ACTION, the
// yacht dispatches it BY NAME when the helmsman is not on her bridge, and neither plugin learns what
// the other is. It also makes the seat reachable from a VINE script, a macro or the marina panel
// without any of them knowing which plugin currently owns the word.
registerAction({
  type: 'BOAT_HELM',
  validate: ({ actor }) => (actor ? null : 'nobody there'),
  handler: ({ actor, params }) => cmdHelm(params?.args || [], params?.raw || 'helm', actor),
});
registerAction({
  type: 'BOAT_EMBARK',
  validate: ({ actor }) => (actor ? null : 'nobody there'),
  handler: ({ actor }) => boatEmbark(actor),
});
registerAction({
  type: 'BOAT_DISEMBARK',
  validate: ({ actor }) => (actor ? null : 'nobody there'),
  // ⚠ CLIMBING OUT ENDS THE TEXT HELM TOO, and without this it does not: `aboard` is cleared by
  // `boatDisembark` and `conning` is a second map that nothing was telling. A text helmsman who
  // typed `disembark` kept sailing — the tick has no idea anybody left, so she carries on across
  // the Basin under orders from somebody standing on a pontoon, with the status line still arriving.
  handler: async ({ actor, context }) => {
    // ⚠ OUT ON THE WATER FIRST, AND IT HAS TO BE FIRST. `boatDisembark` below is the pontoon case:
    // it clears the seat and prints a line about climbing back onto the deck — a deck that, for
    // somebody a mile offshore, is in a room they have not been in for ten minutes. Asked in the
    // other order the ordinary climb-out always answers, and going over the side is unreachable.
    // `overboard` returns null when there is no passage to end, which is what makes that safe.
    const wet = await overboard(actor, context?.broadcast);
    if (wet) return wet;
    await endTextHelm(actor.id);
    const out = await boatDisembark(actor);
    // ⚠ AND IT TAKES THE PANE DOWN, which NOTHING WAS DOING. The seat's own exit sends `disembark`
    // and the client route for `boat_sim_close` existed from the first commit — with no sender
    // anywhere. So ESC cleared `aboard` on the server and left the helm open on the screen: still
    // painting, still syncing four times a second into a `cmdBoatSync` that now returns null
    // because you are not aboard anything, with no way out but reloading the page. The worst of the
    // six wired-to-nothing bugs in this feature, and the only one on the way OUT.
    // ⚠ SENT EVEN WHEN THE DISEMBARK DECLINED, deliberately: the pane is the client's and the one
    // thing worse than closing it early is leaving somebody in it.
    sendToPlayer(actor.id, { type: 'boat_sim_close' });
    return out;
  },
});

// ⚠ A BODY LEAVING THE GAME LEAVES THE BOAT. `aboard` is RAM keyed on player id, so without this a
// logout while sitting in a hull leaves an entry that the next session inherits — reported to the
// player as "you are already aboard her" from the far side of the map, with no way to get out.
export const events = {
  // ⚠ `endTextHelm` RATHER THAN `stopTextHelm`, so the hull and the tank reach the row. The tick
  // flushes on a ten-second clock, so simply dropping the record loses up to ten seconds of a run —
  // and a player who logs out after a hard passage would find her mysteriously in better condition
  // than they left her. Not awaited: an event handler is not a transaction, and the alternative is
  // holding up a logout on a write.
  'player.logout': ({ player }) => { aboard.delete(player.id); endTextHelm(player.id); },
  // ⚠ DEATH TAKES THE SEAT DOWN TOO. A corpse at the wheel is a pane the next thing you see is
  // drawn behind. (Logout needs no message — the socket has gone.)
  'player.death': ({ player }) => { aboard.delete(player.id); endTextHelm(player.id); sendToPlayer(player.id, { type: 'boat_sim_close' }); },
};

// ⚠ THE THREE THAT CHANGE THE WORLD RE-PUSH THE SCREEN, and the one that only reads does not.
// This is the depot's oldest complaint quoted: a purchase that worked and looked as though it had
// not, because the panel over the top still showed the same Buy button and a stale balance.
const andRepush = (fn, tab) => async (args, raw, player) => {
  const out = await fn(args, raw, player);
  await repushMarina(player, tab);
  return out;
};

export const commands = {
  boat: andRepush(cmdBoat, 'dealer'),
  boats: cmdBoats,
  berth: andRepush(cmdBerth, 'berths'),
  refit: andRepush(cmdRefit, 'bench'),
  helm: cmdHelm,
  // ⚠ NEITHER OF THESE IS A VERB A PLAYER TYPES. They are the client's telemetry channel and its
  // event report, and they are registered as commands because that is the wire this game has —
  // the identical arrangement `trucksync` is in. They are listed in NOT_PLAYER_TYPED in
  // scripts/docs/verbs.mjs for the same reason.
  boatsync: cmdBoatSync,
  boatevent: cmdBoatEvent,
  conn: cmdConn,
};

export { boatContactsNear };
