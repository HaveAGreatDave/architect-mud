// THE LONG HAUL — rig state and the server's half of the drive loop.
//
// The model is lifted straight from flight: the CLIENT simulates at 60fps (that is where the feel
// lives) and streams packed telemetry; the SERVER clamps rather than re-simulates. Anti-cheat is an
// envelope, not a second physics engine — see plugins/flight/state.js reconcile().
//
// What makes a truck different from an aircraft is WHICH number has to be defended. A plane's
// position is two coordinates and every one of them is visible to other players, so all of them
// matter a bit. A truck on a corridor has exactly one economically meaningful value: the ODOMETER
// `s`. Arrival, contract clocks, fuel burn and node crossings all key off it, and nothing else
// does. So `s` is clamped hard against elapsed wall-clock, and lateral `t` is merely bounded.
//
// RAM-ONLY, by design. A rig mid-haul is `rigs`, keyed by player id. Nothing here is written per
// tick — the crossing's own five `player_flags` (plugins/voidwalking) already survive a relog, and
// re-deriving `s` from the room you woke up in is both cheap and correct. The persistence-tier
// rules in docs/architecture.md are explicit that per-tick state does not go near the DB.

import { getZone, addPlayerToZone, removePlayerFromZone } from '../../server/engine/world.js';
import { emit } from '../../server/engine/events.js';
import { sendToPlayer, sendToZone, teachVerb } from '../../server/engine/messaging.js';
import { query } from '../../server/models/db.js';
import { mapWindow, surfaceAt, aircraftNearCoord } from '../flight/state.js';
import { corridorFor, corridorAt, corridorLocate, corridorPos, corridorProvider, TILES_PER_ROOM,
  addWreck, wreckAhead } from './corridor.js';
import { wearFor, breakdownRoll, BREAKDOWNS } from './rig.js';
import { applyDamage, wearSplit, damageOf, PARTS, partBand } from './damage.js';

// Fallback range in tiles for a rig with no type attached (only the legacy roadhead mount). Every
// real truck carries its own `tank`; this is the Drayman's, so a stray rig behaves like the
// middle of the fleet rather than like something with infinite diesel. The route it is sized
// against is 495 tiles one way — see the tank note in flight-model.js.
const TANK_TILES = 1050;

// The window radius pushed to the cab. Flight uses 36 because a plane at altitude sees a long way;
// a truck's eye height is a metre and a half and the fog closes at ~15 tiles, so a smaller window
// carries everything the renderer can draw and cuts the payload to about a fifth.
export const CAB_RADIUS = 16;

// Telemetry cadence guard. The client reports ~4×/s; anything faster is either a broken client or
// somebody trying to buy odometer with request volume, and either way the clamp below handles it.
const MIN_SYNC_MS = 120;

export const rigs = new Map();   // playerId -> rig

// ── The truck's tuning, mirrored from the client model ───────────────────────
// The client owns the physics; the server owns the CEILING. These two numbers are the only part of
// the model the server needs, and they are deliberately duplicated rather than imported: importing
// a client panel into the server to read two constants coples boot order to the browser bundle for
// no gain, and if they ever drift the clamp gets LOOSER, never tighter — which is the safe way for
// a duplicate to fail. plugins/trucking/regress.js asserts they still agree.
const TOP_SPEED_MPH = 68;
const TILE_MPH = 80;             // road speed at which the truck covers one tile per second
const CLAMP_SLACK = 1.35;        // headroom for frame jitter and a fast client — generous on purpose

export function topTilesPerSec() { return (TOP_SPEED_MPH / TILE_MPH) * CLAMP_SLACK; }

// ── Two legs, one rig ────────────────────────────────────────────────────────
// A haul is driven in two different worlds and the rig moves between them without changing
// anything but its CELL PROVIDER:
//
//   leg 'city'     — real `map_world` tiles. `x`/`y` are world grid coords, the provider is
//                    `surfaceAt`, and each tile is a real zone you are actually standing in.
//   leg 'corridor' — the synthetic highway across the void. `x`/`y` are corridor coords, the
//                    provider is `corridorProvider(route)`, and a tile is 1/90th of a void room.
//
// That is the entire difference, and it is the payoff for the provider seam: `mapWindow` renders
// both identically, the physics model never learns which one it is on, and `groundObstructionAt`
// collides against real city buildings and roadside ruins with the same code.
export function providerFor(rig) {
  return rig.leg === 'city' ? surfaceAt : corridorProvider(rig.route);
}

// A rig exists only while somebody is driving one. Mounted in the CITY — the crossing is joined
// later, by driving to the rim, which is the whole point of starting in a depot.
export function mountRig(player, { x, y, heading = 180, depot = null }) {
  const rig = {
    playerId: player.id, leg: 'city',
    x, y, heading, speed: 0,
    fromDepot: depot, cargo: null, fuel: 1,
    // THE FIFTH WHEEL. A rig mounts BOBTAIL — tractor only — because that is the honest state of a
    // truck somebody just got into, and because bobtail is a real way to drive rather than a
    // half-finished one: quick, light, nothing to jackknife. `trailer` is null or the box on the
    // back; cargo cannot exist without one, which is the whole reason `hitch` is a verb and not a
    // checkbox on the depot panel.
    trailer: null,
    lastSync: Date.now(), started: Date.now(), bogged: false, blocked: 0,
    // corridor half — filled in by joinCorridor when the rig leaves the map
    route: null, chain: null, instanceId: null, destKey: null, dest: null, s: 0, t: 0, node: 0,
  };
  rigs.set(player.id, rig);
  return rig;
}

// City → corridor. Called when the rig drives off the rim into a live crossing.
export function joinCorridor(rig, { instanceId, destKey, voidKey, window, chain, dest, trunk = 1 }) {
  rig.leg = 'corridor';
  rig.instanceId = instanceId; rig.destKey = destKey; rig.voidKey = voidKey;
  rig.window = window; rig.chain = chain; rig.dest = dest; rig.trunk = Math.max(1, trunk | 0);
  rig.route = corridorFor(voidKey, destKey, window, chain.length, rig.trunk);
  rig.s = 0; rig.t = 0; rig.node = 0;
  const start = corridorPos(rig.route, 0, 0);
  rig.x = start.x; rig.y = start.y; rig.heading = start.heading;
  rig.speed = Math.min(rig.speed, 25);   // you don't leave the world at cruise
  return rig;
}

// ── Changing your mind at the fork ───────────────────────────────────────────
// The junction, as a thing you can actually take. Both limbs already exist in the same crossing
// instance (voidwalking builds every dest's rooms up front and hangs them off the last trunk
// room), and the trunk tarmac is now seeded independently of the destination — so switching is
// genuinely just a different road AHEAD, with the odometer, the fuel and the rooms behind you
// untouched. Which is why this is four lines rather than a system: the two hard parts were
// decided in `crossingInfo` and `corridorFor`.
//
// The caller owns the RULE (you must still be on the trunk); this owns the move. Nothing here
// touches `current_zone`, and that is not an oversight: while you are on the trunk you are
// standing in a room BOTH chains contain, so there is nothing to move you to.
export function switchLimb(rig, { destKey, chain, dest }) {
  rig.destKey = destKey; rig.chain = chain; rig.dest = dest;
  rig.route = corridorFor(rig.voidKey, destKey, rig.window, chain.length, rig.trunk);
  rig.s = Math.min(rig.s, rig.route.L);
  const p = corridorPos(rig.route, rig.s, rig.t);
  rig.x = p.x; rig.y = p.y;
  rig.node = Math.max(0, Math.min(chain.length - 1, Math.floor(rig.s / TILES_PER_ROOM)));
  return rig;
}
// Is the fork still ahead of us? The last trunk room IS the junction, so the answer is "you have
// not left it yet" rather than "you have not reached it".
export const atOrBeforeFork = (rig) => rig.leg === 'corridor' && rig.route
  && rig.s <= (rig.route.trunkL || 0) + 2;

// Corridor → city. The far side of the crossing: drop the rig onto the destination region's tiles.
export function leaveCorridor(rig, x, y, heading = 180) {
  rig.leg = 'city';
  rig.x = x; rig.y = y; rig.heading = heading;
  rig.route = null; rig.chain = null; rig.s = 0; rig.t = 0; rig.node = 0;
  return rig;
}
export function dismountRig(playerId) { rigs.get(playerId)?.playerId && rigs.delete(playerId); }
export function rigOf(player) { return rigs.get(player?.id) || null; }

// ── Reconcile: the one place a client number becomes a server fact ───────────
// `d` is the unpacked telemetry frame. Returns { moved, node, bogged } for the caller to act on.
export function reconcileTruck(rig, d, now = Date.now()) {
  const dtMs = Math.max(1, now - rig.lastSync);
  if (dtMs < MIN_SYNC_MS) return { moved: false, node: rig.node, bogged: rig.bogged };
  rig.lastSync = now;

  const px = rig.x, py = rig.y;
  if (Number.isFinite(d.x)) rig.x = d.x;
  if (Number.isFinite(d.y)) rig.y = d.y;
  rig.heading = Number.isFinite(d.hdg) ? ((d.hdg % 360) + 360) % 360 : rig.heading;
  rig.speed = Math.max(0, Math.min(TOP_SPEED_MPH, Number.isFinite(d.spd) ? d.spd : 0));

  // Fuel burns on DISTANCE, never on the clock — an idling truck at a depot must not drain its
  // tank while you read a job board. Same principle as the durability system's "wear accrues on
  // use, never on the clock".
  const moved = Math.hypot(rig.x - px, rig.y - py);
  if (Number.isFinite(moved)) {
    // Range is the TRUCK's tank, not a constant — a Krell barely reaches the far side and an Orlov
    // round-trips, and that is most of what the price difference buys.
    const was = rig.fuel;
    // The TUNED tank and the TUNED thirst: a hard turbo drinks, an auxiliary tank holds more, and
    // both arrive here as one number each from rig.js rather than as a second copy of the maths.
    rig.fuel = Math.max(0, rig.fuel - (moved * (rig.burnMul || 1)) / (rig.params?.tank || rig.type?.tank || TANK_TILES));
    rig.travelled = (rig.travelled || 0) + moved;   // lifetime tiles, flushed with the fuel on park
    // WEAR ACCRUES ON USE, NEVER ON THE CLOCK, and it accrues IN RAM — this is the hot path, four
    // times a second per driver, and a condition write here would be a query per frame. It rides
    // home on `park` in the same coalesced UPDATE that already carries fuel and the odometer.
    //
    // PER COMPONENT since the damage model landed. `wearFor` still computes the TOTAL — the tune,
    // the surface and the death-spiral multiplier are unchanged and still live in rig.js — and
    // `wearSplit` decides where that total goes. The body is deliberately not in the split: miles
    // do not dent panels, only impacts do. `applyDamage` recomputes `rig.condition` from the parts,
    // so every downstream reader of the headline number (the breakdown roll two lines below,
    // resale, the repair price, the band label) is untouched by any of this.
    applyDamage(rig, wearSplit(
      wearFor(moved, { surface: surfaceUnder(rig), tune: rig.cd?.tune || {}, condition: rig.condition ?? 1 }),
      { surface: surfaceUnder(rig) }
    ));
    // A GAUGE THAT NEVER BITES IS DECORATION. For a long time this counted down to zero and the
    // truck simply carried on, which made every tank number in the fleet a label rather than a
    // constraint. Running dry now stops it dead, and the low warning fires once on the way past so
    // it is a decision you got wrong rather than a thing that happened to you.
    if (was > 0 && rig.fuel <= 0) rig.dry = true;
    if (!rig.warnedLow && rig.fuel > 0 && rig.fuel < 0.15) { rig.warnedLow = true; rig.warnLow = true; }
    if (rig.fuel > 0.3) rig.warnedLow = false;

    // BREAKDOWNS ride the same distance the wear does, on the same frame, off the same number —
    // which is the point: the bar you have been ignoring is the die you are rolling. The grace
    // window a roadside fix bought is spent in tiles here too, so it is distance you were given
    // and distance you use up, never a timer that runs down while you sit still.
    if (rig.fixGrace > 0) rig.fixGrace = Math.max(0, rig.fixGrace - moved);
    if (!rig.broken && !rig.fixGrace) {
      const kind = breakdownRoll(moved, { condition: rig.condition ?? 1, surface: surfaceUnder(rig) });
      if (kind) rig.broken = { kind, attempts: 0, told: false };
    }
  }
  // Out of diesel, or broken down: no drive, whatever the client reports. The client is told and
  // clamps its own throttle, but the server does not take its word for the speed either.
  if (rig.dry || rig.broken) rig.speed = 0;

  // ── City leg ──
  // No corridor to be off, and no bogged law: buildings are SOLID here (the client's CFIT-derived
  // sweep stops you dead), so the only geometry rule left is the world's own edge. The position is
  // clamped to the same envelope the corridor gets — distance per second — and the zone you are
  // standing in is whatever tile you are over.
  if (rig.leg === 'city') {
    const cap = topTilesPerSec() * (dtMs / 1000);
    if (moved > cap) {                      // rubber-band an impossible jump back toward the last fix
      const k = cap / moved;
      rig.x = px + (rig.x - px) * k; rig.y = py + (rig.y - py) * k;
    }
    const cell = surfaceAt(Math.round(rig.x), Math.round(rig.y));
    return { moved: !!cell && cell.id !== rig.zoneId, zone: cell?.id || null, node: rig.node, bogged: !cell, city: true };
  }

  // ── Corridor leg ──
  // Bogged: past the corridor's half-width is not a collision, it's a law. The rig stalls and the
  // caller puts it back on the shoulder. Never a wall, never a crash the player can't read.
  const hit = corridorLocate(rig.route, rig.x, rig.y);
  const bogged = !hit;

  // THE CLAMP. The odometer is DERIVED here from the reported position rather than taken from the
  // client, because the corridor is the server's geometry and a client that reports its own
  // progress along it is a client that can weave, or lie, or simply drift out of agreement. The
  // client says where it is; the server decides how far that is. `d.s` is accepted only as a
  // fallback when the position is unusable (a bog).
  //
  // However far it claims, it cannot have gone further than flat-out for the elapsed time. And it
  // is monotonic — phase 1 has no reverse, so a decreasing odometer is either a bug or an attempt
  // to re-drive a stretch of road that has already been paid for.
  const ceiling = rig.s + topTilesPerSec() * (dtMs / 1000);
  const claimed = hit ? hit.s : (Number.isFinite(d.s) ? d.s : rig.s);
  rig.s = Math.max(rig.s, Math.min(claimed, ceiling, rig.route.L));
  // Lateral is derived too, and merely bounded — nothing economic depends on it.
  if (hit) rig.t = Math.max(-rig.route.R, Math.min(rig.route.R, hit.t));
  const node = Math.max(0, Math.min(rig.chain.length - 1, Math.floor(rig.s / TILES_PER_ROOM)));
  return { moved: node !== rig.node, node, bogged, city: false };
}

// The breakdown announcement, shared by BOTH rungs — it lives here rather than in either of them
// so the driven cab and the text run cannot drift into telling different stories about the same
// failure. It says what let go and then what to do about it, in that order: a driver whose truck
// has just stopped in the middle of a waste needs the verb more than the prose, and `fix` is a
// verb nobody would ever guess at.
export function announceBreak(player, rig) {
  if (!rig?.broken || rig.broken.told) return false;
  rig.broken.told = true;
  const b = BREAKDOWNS[rig.broken.kind] || BREAKDOWNS.hose;
  sendToPlayer(player.id, {
    type: 'emote',
    message: `<span class="text-red">${b.broke}</span>\n`
      + `<span class="text-amber">The ${b.label} is finished, and so is the run until you deal with it.</span> `
      + `<span class="text-dim">${teachVerb('fix', 'fix')} to get under it with what you have, or ${teachVerb('park', 'park')} and walk — the road out here goes on without you either way.</span>`,
  });
  return true;
}

// ── What the road remembers ──────────────────────────────────────────────────
// A wreck out here is not scenery: it is the tile a real driver stopped on, with the model of
// truck they were in and the name of whoever it was. The corridor's seeded roadside props are the
// same eight buildings for everybody forever; these are the ones that mean something, and the
// only way one appears is that somebody's haul ended there.
export function markWreck(rig, player) {
  if (!rig?.route) return null;
  return addWreck(rig.route, { s: rig.s, what: `A dead ${rig.type?.name || 'truck'}`, who: player?.handle || null });
}

// ── The CB ───────────────────────────────────────────────────────────────────
// Voices on the corridor. It is deliberately NOT a chat channel and deliberately not a tick: lines
// fire on node crossings, which is where everything else about the drive already happens, so the
// radio costs no scheduler and can never talk over a truck that is standing still.
//
// HALF OF IT IS TRUE. A radio that only said atmospheric nothings would be a screensaver, so a
// wreck ahead is reported before you reach it — by name, which is the whole reason a wreck
// remembers who left it. The flavour exists so the useful lines don't read as a UI element in a
// hat. It lives here rather than in either rung's file because both rungs call it, and a radio
// that said different things in the cab and in the text run would be two radios.
const CB_CHATTER = [
  'Somebody two hundred miles back is describing his divorce to nobody in particular.',
  '“…and I told him, that is not a load, that is an insult with a tarp over it.”',
  'A woman counts something out, slowly, in a language the radio is not helping with.',
  'Static, and under the static something that has been repeating for a long time.',
  '“Anybody running east tonight? Anybody at all.” Nobody answers her.',
  '“Watch the third node, the graders have been through and left it worse.”',
  'Two drivers argue about a diner that closed before either of them was driving.',
  'Somebody sings four bars, thinks better of it, and clicks off.',
];
export function cbLine(player, rig) {
  if (!rig || rig.cbOff || rig.leg !== 'corridor' || !rig.route) return false;
  // A wreck ahead outranks flavour every time — it is the one thing on this channel that is about
  // where you are going rather than about who else is out here.
  const w = wreckAhead(rig.route, rig.s);
  if (w && !rig.cbSeen?.has(w.s)) {
    (rig.cbSeen = rig.cbSeen || new Set()).add(w.s);
    sendToPlayer(player.id, { type: 'emote', message:
      `<span class="text-dim">CB: “${w.who ? `${w.who}'s rig` : 'A rig'} is on the shoulder a few miles up. `
      + `${w.who ? 'Left there a while back.' : 'Nobody in it.'} Give it room.”</span>` });
    return true;
  }
  if (Math.random() < 0.55) return false;            // the radio is mostly quiet, which is the point
  const line = CB_CHATTER[Math.floor(Math.random() * CB_CHATTER.length)];
  sendToPlayer(player.id, { type: 'emote', message: `<span class="text-dim">CB: ${line}</span>` });
  return true;
}

// Put a bogged rig back on the pavement, facing down-corridor, stopped. The penalty is the time
// and the fuel, not the position — being teleported backwards would be worse than a wall.
export function unbog(rig) {
  const p = corridorPos(rig.route, rig.s, 0);
  rig.x = p.x; rig.y = p.y; rig.heading = p.heading; rig.speed = 0; rig.bogged = false;
  return p;
}

// ── Node crossing: the odometer's equivalent of a `move` ─────────────────────
// Walk the player one room along the crossing's spine and emit `zone.entered`, which is the same
// event an ordinary step fires — so voidwalking's encounters, ghost-traces, hard nodes and
// teardown all run untouched. This is the whole reason the drive IS the crossing rather than a
// parallel system: none of that behaviour is re-implemented here, it is merely triggered.
// Driving one tile in the CITY is a zone change — each tile is a real room, so other players must
// see you go past and arriving at a depot has to mean standing in it.
//
// THE WRITE IS DELIBERATELY NOT PERSISTED. At cruise a tile passes every ~1.3s, so a
// `UPDATE players SET current_zone` per tile would be a DB round trip on the hottest path in the
// system — precisely what the persistence tiers in docs/architecture.md forbid. The live Maps and
// `player.current_zone` move in RAM; the row is flushed once, on `park`/`arrive`/logout. That is
// the same discipline voidwalking uses for `crossing_room` ("flushed lazily on logout, not per
// step"), and the failure mode is identical and acceptable: a hard crash puts you back where you
// last stopped, which for a truck is the depot you left.
export function driveToZone(player, rig, zoneId) {
  if (!zoneId || zoneId === player.current_zone) { rig.zoneId = zoneId; return null; }
  const zone = getZone(zoneId);
  if (!zone) return null;
  const from = player.current_zone;
  removePlayerFromZone(player.id, from);
  addPlayerToZone(player.id, zoneId);
  player.current_zone = zoneId;
  rig.zoneId = zoneId;
  rig.zoneDirty = true;
  announcePassing(player, rig, from, zoneId);
  // `from` matters: listeners that care about what you LEFT (the depot panel closing itself when a
  // rig rolls off its apron) are dead without it, and it cost nothing to carry.
  emit('zone.entered', { actor: player, zone: zoneId, from });
  return zone;
}

// A FORTY-TONNE VEHICLE IS NOT A SECRET. This path deliberately does not go through `cmdMove`, so
// it never inherited the engine's departure/arrival lines — which meant a rig crossed a city tile
// in total silence and the people standing on it saw nothing at all. The driver simply blinked
// into and out of their "Also here" list.
//
// The lines are rig-flavoured rather than the engine's footstep prose (`X leaves north`), because
// what the room actually experiences is the vehicle, not the person inside it. Deliberately NOT
// sent when the driver is barely moving: parking, creeping into a bay, or nudging a tile at idle
// should not spam a yard.
const PASSING_MPH = 8;
function announcePassing(player, rig, fromId, toId) {
  if ((rig.speed || 0) < PASSING_MPH) return;
  const what = rig.type?.name ? `a ${rig.type.name}` : 'a truck';
  const dir = bearingWord(rig.heading);
  sendToZone(fromId, { type: 'zone_event',
    message: `<span class="text-dim">${what} pulls away${dir ? ` to the ${dir}` : ''}, ${player.handle} at the wheel.</span>` }, player.id);
  sendToZone(toId, { type: 'zone_event',
    message: `<span class="text-dim">${what} rolls in${dir ? ` from the ${OPPOSITE_WORD[dir] || 'the road'}` : ''} and keeps going.</span>` }, player.id);
}
const bearingWord = (h) => {
  const d = ((h % 360) + 360) % 360;
  if (d < 45 || d >= 315) return 'north';
  if (d < 135) return 'east';
  if (d < 225) return 'south';
  return 'west';
};
const OPPOSITE_WORD = { north: 'south', south: 'north', east: 'west', west: 'east' };

// The coalesced flush. Called from park/arrive/logout — anywhere the drive stops being hot.
export async function flushZone(player, rig) {
  if (!rig?.zoneDirty) return;
  rig.zoneDirty = false;
  await query('UPDATE players SET current_zone=$1 WHERE id=$2', [player.current_zone, player.id]).catch(() => {});
}

export async function crossToNode(player, rig, node) {
  const to = rig.chain[node];
  if (!to || to === player.current_zone) { rig.node = node; return null; }
  const zone = getZone(to);
  if (!zone) return null;                                   // instance torn down under us — caller aborts
  removePlayerFromZone(player.id, player.current_zone);
  addPlayerToZone(player.id, to);
  player.current_zone = to;
  rig.node = node;
  await query('UPDATE players SET current_zone=$1 WHERE id=$2', [to, player.id]).catch(() => {});
  if (player._crossing) player._crossing.seen.add(to);
  emit('zone.entered', { actor: player, zone: to });
  return zone;
}

// ── The push to the cab ──────────────────────────────────────────────────────
// The corridor's cells go through the SAME mapWindow the flight sim uses (see the cell-provider
// note there) — the truck ships a rendered world it did not derive.
// ── Traffic, both ways ───────────────────────────────────────────────────────
// A rig relayed to pilots, in the SAME contact shape an aircraft uses (plugins/flight/state.js
// airContact). It is answered through a gather hook rather than pushed, so flight never imports
// trucking — the same seam `aircraft.companions` uses, and the same reason.
//
// Only a MOVING rig is traffic: a truck parked in a yard is scenery and belongs in the room
// description, not in a pilot's contact list where it would sit as a permanent blip. Mirrors
// flight's own rule (`isGroundRolling` gates a taxiing aircraft into the picture at 5 kt).
const TRAFFIC_MPH = 6;
export function truckContactsNear(x, y, range = 26) {
  const out = [];
  for (const rig of rigs.values()) {
    if (rig.leg !== 'city') continue;            // the corridor is not in anybody's world window
    if ((rig.speed || 0) < TRAFFIC_MPH) continue;
    if (Math.max(Math.abs(x - rig.x), Math.abs(y - rig.y)) > range) continue;
    out.push({
      id: `truck_${rig.playerId}`, cls: 'truck',
      // WHICH truck, and whether it is pulling anything — the four models have four silhouettes
      // and bobtail is a real one, so a pilot overhead can tell an Orlov with a box on it from a
      // Barrow running empty.  stays 'truck' because the whole renderer switches on it.
      // WHICH truck, and whether it is pulling anything. The four models have four silhouettes and
      // bobtail is a real one, so a pilot overhead can tell an Orlov with a box on it from a Barrow
      // running empty. `cls` stays 'truck' because the whole renderer switches on it; this is a
      // fourth, optional channel that only the truck mesh reads.
      variant: `${rig.typeId || 'hauler'}${rig.trailer ? '+t' : ''}`,
      x: rig.x, y: rig.y, hdg: rig.heading, ias: Math.round(rig.speed),
      alt: 0, band: 'ground', onGround: true, groundZ: 0, altDiff: 0,
      bank: 0, pitch: 0, vs: 0, hullPct: 100,
      reg: rig.type?.name || 'truck',
    });
  }
  return out;
}

export function cabContext(rig, extra = {}) {
  const cx = Math.round(rig.x), cy = Math.round(rig.y);
  const city = rig.leg === 'city';
  return {
    type: 'truck_ctx',
    leg: rig.leg,
    map: mapWindow({ grid_x: cx, grid_y: cy }, CAB_RADIUS, providerFor(rig)),
    mapX: cx, mapY: cy,
    x: +rig.x.toFixed(3), y: +rig.y.toFixed(3),
    heading: Math.round(rig.heading), speed: Math.round(rig.speed),
    fuel: +rig.fuel.toFixed(3),
    // WHICH TRUCK THIS IS, and what a bench did to it. The cab used to hardcode the Courier's
    // parameters, so the gearbox, the top speed, the brakes and the turn-in of a 31,000₵
    // Continental were the 4,200₵ truck's — you could buy your way up the fleet and feel nothing.
    // `params` is the client model's own `p` object, assembled once at mount by rig.js.
    typeId: rig.typeId || null,
    params: rig.params || rig.type || null,
    condition: +(rig.condition ?? 1).toFixed(3),
    // THE DAMAGE HUD's whole payload. Four numbers and a band each, assembled here rather than in
    // the client, because "how bad is this" is a fact about the truck and not a rendering choice —
    // the panel is a skin over these numbers and computes none of them (the same rule the card
    // reveal and the poker table follow). The trailer's bar is the TRAILER's row, which is why it
    // is absent when you are bobtail rather than showing a hopeful 100%.
    dmg: (() => {
      const d = rig.dmg || (rig.dmg = damageOf(rig));
      const out = {};
      for (const p of PARTS) out[p] = { v: +d[p].toFixed(3), band: partBand(d[p]).key };
      if (rig.trailer) {
        const tc = rig.trailer.condition ?? 1;
        out.trailer = { v: +tc.toFixed(3), band: partBand(tc).key };
      }
      return out;
    })(),
    // The cab clamps its own throttle on both of these for the feel; the server clamps the speed
    // for the truth. Same split as `dry`, which is the shape this followed deliberately.
    broken: rig.broken ? rig.broken.kind : null,
    paint: rig.cd?.paint || null,
    cargo: rig.cargo ? { name: rig.cargo.name, kg: rig.cargo.kg, to: rig.cargo.toName } : null,
    // The client model owns φ and the brake temperature between frames — it simulates them at
    // 60fps and nothing here could improve on that. What the server owns is WHETHER there is a
    // trailer and what it weighs, because that is a fact about the world and not about this frame.
    trailer: rig.trailer ? { name: rig.trailer.name, kg: rig.trailer.kg, loadKg: rig.cargo?.kg || 0 } : null,
    // The corridor half is only meaningful on that leg; in the city the cab shows the destination
    // rather than a distance-to-go, because there is no single road to be a distance along.
    s: city ? 0 : Math.round(rig.s), t: city ? 0 : +rig.t.toFixed(2),
    L: city ? 0 : rig.route.L,
    // WHERE THIS ROAD IS POINTED, for the cab's GPS screen to name. It is the route's own
    // `destKey` — the exact field the `route` verb sets — so the screen can never say one
    // destination while the tarmac runs to another. Naming only: the aiming, the fork rules and the
    // range check all stay in the verb.
    aim: city ? null : (rig.route?.destKey || null),
    node: city ? 0 : rig.node, nodes: city ? 0 : rig.chain.length,
    surface: surfaceUnder(rig),
    // The other half of the traffic picture: aircraft near the truck, so a driver sees a Mule come
    // over the yard at two hundred feet. `aircraftNearCoord` already builds exactly this list for
    // the yacht helm, so a driver's sky costs one call and no new channel. City leg only — nothing
    // flies over the corridor, which is off the map entirely.
    contacts: city ? aircraftNearCoord(cx, cy, 22) : [],
    ...extra,
  };
}
// A CAB PUSH IS NOT A FRAME. Everything between frames belongs to the client sim; what the server
// owns here — the surface under the wheels, the map window, the distance to go, the traffic — can
// only change when the truck changes TILE. This was called unconditionally at the end of every
// sync, so a 33×33 window was derived cell by cell (mapWindow → deriveSurfaceCell → corridorAt)
// and an aircraft scan was run, several times a second, for a rig that had not left the square it
// was already on; and the client threw away a whole map and took a new one at the same rate.
//
// So: a full push when the centre tile moves, when a caller has something to SAY (`extra` is
// always a state change — bogged, fixed, stopped), or once a second as a floor so a slow
// authoritative correction still lands. Nothing downstream is throttled by this that isn't
// derived from the tile anyway.
const PUSH_MS = 1000;
export function pushCab(rig, extra) {
  const cx = Math.round(rig.x), cy = Math.round(rig.y), now = Date.now();
  if (!extra && rig.pushX === cx && rig.pushY === cy && now - (rig.pushAt || 0) < PUSH_MS) return;
  rig.pushX = cx; rig.pushY = cy; rig.pushAt = now;
  sendToPlayer(rig.playerId, cabContext(rig, extra));
}

// What is under the wheels, in the vocabulary the client model's SURFACES table speaks. The world
// answers in TERRAIN (its own vocabulary, and the renderer's); this is the one place the two are
// mapped, so neither side has to know about the other.
//
// Note the CITY reading of `dirt_road`: on the corridor it's the graded shoulder you drift onto by
// mistake, but in town it's an unpaved street somebody actually uses. Same terrain, same "slower
// than asphalt" answer, entirely different fiction — which is why this mapping lives in one place
// rather than being inferred at each callsite.
export function surfaceUnder(rig) {
  const c = rig.leg === 'city'
    ? surfaceAt(Math.round(rig.x), Math.round(rig.y))
    : corridorAt(rig.route, Math.round(rig.x), Math.round(rig.y));
  const terrain = c?.flags?.terrain;
  if (!c) return 'offroad';
  if (terrain === 'road' || terrain === 'asphalt' || terrain === 'concrete') return 'road';
  if (terrain === 'dirt_road' || terrain === 'gravel') return 'shoulder';
  return 'offroad';
}
