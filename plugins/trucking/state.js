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

import { getZone, getAllZones, addPlayerToZone, removePlayerFromZone, getLivePlayer } from '../../server/engine/world.js';
import { streetActors } from '../../server/engine/street-actors.js';
import { emit } from '../../server/engine/events.js';
import { sendToPlayer, sendToZone, teachVerb } from '../../server/engine/messaging.js';
import { query } from '../../server/models/db.js';
import { mapWindow, surfaceAt, isRoadCell, aircraftNearCoord, skyState } from '../flight/state.js';
import { corridorFor, corridorAt, corridorLocate, corridorPos, corridorProvider, TILES_PER_ROOM,
  nodeAt, addWreck, wreckAhead, signsBetween, ARROW_WORDS, isCarriageway, pavedAt, attachSigns,
  joinRoutes, reverseRoute, pairKey } from './corridor.js';
import { wearFor, breakdownRoll, BREAKDOWNS } from './rig.js';
import { applyDamage, wearSplit, damageOf, PARTS, partBand } from './damage.js';
import { routeOptions } from './routes.js';
// The crossing's own shape, read rather than reconstructed. ⚠ voidwalking imports nothing from
// this plugin, so this is a one-way edge and not the load-order tangle routes.js warns about.
import { crossingChain, crossingDest, crossingInfo, VOIDS, currentWindow as currentVoidWindow } from '../voidwalking/index.js';
import { trailersNear, standingIn, hitchReach, posed, refreshStanding, boxColour } from './trailers.js';
// The one paint→livery conversion, shared with the cab and the depot panel — see the file's own
// note on why it is in client/shared rather than in the renderer.
import { truckLivery } from '../../client/shared/truck-livery.js';

// Fallback range in tiles for a rig with no type attached (only the legacy roadhead mount). Every
// real truck carries its own `tank`; this is the Drayman's, so a stray rig behaves like the
// middle of the fleet rather than like something with infinite diesel. The route it is sized
// against is 495 tiles one way — see the tank note in flight-model.js.
const TANK_TILES = 1050;

// The window radius pushed to the cab. Flight uses 36 because a plane at altitude sees a long way;
// a truck's eye height is a metre and a half and the fog closes at ~15 tiles, so a smaller window
// carries everything the renderer can draw and cuts the payload to about a fifth.
// How far the cab can see, as a window radius. 16 → 22 → 30, and the ceiling on it is BANDWIDTH
// rather than anything visual: this is a square, so the cost is (2r+1)² cells of JSON. MEASURED on
// a corridor window rather than guessed, because the guess is badly wrong in the interesting
// direction — almost every cell out here is a real one. The verge runs to OFFROAD_R (24 tiles), so
// a window of this size is nearly all corridor and hardly any of the cheap `{kind:'air'}`:
// 2,025 cells ≈ 109 KB at 22, 3,721 ≈ 158 KB at 30, 4,761 ≈ 183 KB at the renderer's own 34-tile
// draw limit. `pushCab` only sends on a centre-tile change or once a second, and a truck at 68 mph
// crosses a tile slightly slower than that, so this is about one payload a second either way.
//
// 30 is where it lands because 29 tiles of road is a hair under everything the renderer can draw
// (VISIBLE_FAR_F is 34 and the haze eats the last few), so the extra 25 KB buys the whole of the
// remaining view and going further buys nothing you could see.
//
// ⚠ THE RENDERER DERIVES ITS FAR LIMIT FROM THIS, so the number is free to move without anything
// popping (windshield.js — drawWorldObjects for the buildings, drawGroundSurfaces for the road
// itself). That was NOT true before: the draw limit was a constant 34 while this was 16, so every
// building crossed into view at the window's edge at full opacity, eighteen tiles inside where the
// haze fade lives. Raising this is now a view-distance decision and only that.
export const CAB_RADIUS = 30;

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
// ⚠ ON THE CORRIDOR THE REAL WORLD IS UNDERNEATH, NOT REPLACED. This used to be a straight swap —
// `corridorProvider` INSTEAD of `surfaceAt` — which was the only honest thing to do while the road
// lived in a coordinate space of its own: the world's tiles were somewhere else entirely, so
// asking about them would have returned a tile from a different frame.
//
// Anchored, they are the same frame, and the swap becomes a lie by omission: a driver pulling out
// of Coldwater's south rim saw the city vanish the instant the road began, because everything
// off the corridor's own band answered `null` and `mapWindow` painted it as air. So the two are
// composed — the corridor owns the tarmac, the verge, the signs and the wrecks, and everything
// else is the world that was always there. The basin recedes in the mirrors and the Reach comes up
// out of the haze ahead, with no work done by either of them.
//
// ⚠ AND THE COMPOSITION IS PER-CLAIM, NOT ONE ORDER FOR EVERYTHING. Both of the obvious orders are
// wrong, and each was shipped and found by driving.
//
// `road(x, y) || surfaceAt(x, y)` DELETED COLDWATER. The corridor claims every tile within
// OFFROAD_R (24) of a centreline — that is what makes driving off the road driving rather than a
// stall — and the three limbs out of a void all leave from the SAME rim tile, heading south, east
// and west. A tile twenty tiles inside the basin is barely off the east limb's centreline and only
// a hair along it, so `locate` answered, and forty-eight tiles of the city's southern edge came back
// as synthesised hardpan. Driving out you never saw it; you saw it the moment you turned round.
//
// `surfaceAt(x, y) || road(x, y)` DELETED THE HIGHWAY. A region's grid is placed ground for a long
// way past anything anybody would call a town, so handing the world an unconditional veto took the
// tarmac away too — a driver came off the end of the Coldwater road into open desert with no road
// on it at all, which is worse than the bug it was fixing.
//
// So the question is asked of the CELL rather than of the provider: a road is laid ON ground that
// already exists and wins, and everything the corridor synthesises BESIDE the road is filler for
// ground the world does not place and loses. See `isCarriageway`, which lives in corridor.js so the
// two terrains that file chooses are not restated here.
//
// Nothing here is load-bearing for the DRIVE — the odometer, the node and the collision all read
// `locate` and `rig.route`, never this window (see corridorLocate) — so this decides what you SEE.
export function providerFor(rig) {
  // ── THE CITY LEG SEES THE ROAD IT IS DRIVING TOWARD ────────────────────────
  // It used to be bare `surfaceAt`, which is why the highway switched on the instant you crossed
  // the edge: on this side of the line the corridor was not consulted at all, so there was nothing
  // out past the rim but air. Now the approach composes the same road the crossing will lay (see
  // previewRoute — same seed, same anchor, same object), so the highway comes up out of the haze
  // while you are still on the map and the boundary stops being an event.
  //
  // ⚠ A rig nowhere near a void gets `null` here and this is exactly the provider it always was.
  if (rig.leg === 'city') {
    const pre = previewFor(rig);
    return pre ? composed(corridorProvider(pre)) : surfaceAt;
  }
  const road = corridorProvider(rig.route);
  if (!rig.route?.anchored) return road;   // legacy local frame — the world is genuinely elsewhere
  return composed(road);
}
// The one composition, so the approach and the crossing can never disagree about which of the two
// worlds owns a tile — see the ⚠ above providerFor for why it is per-claim rather than an order.
function composed(road) {
  return (x, y) => {
    const c = road(x, y);
    if (c && isCarriageway(c)) return c;
    return surfaceAt(x, y) || c;
  };
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
    // ⚠ YOU GOT IN. YOU DID NOT TURN THE KEY. Mounting used to start the engine, which is what
    // `drive` narrated ("the diesel catches on the second turn") — and it meant the one control on
    // the shelf that is a real, two-position, consequential switch had nothing to do on the only
    // occasion anybody would reach for it. A truck you have just climbed into is COLD; the key is
    // in the barrel and turning it is the first thing you do.
    //
    // The cab corrects this four times a second from the real sim state, so this is only the state
    // the drive BEGINS in — and the text rung, which has no ignition at all, sets it true as part
    // of pulling out (see startTextDrive's caller). A rung with no key must never be handed one.
    engineOn: false,
    // THE RADIO. It lives on the rig and nowhere else (see cb.js) — mounting puts you on the air
    // and dismounting takes you off, with no membership state anywhere to fall out of step with
    // where you actually are. 19 because that is where everybody else starts, which is the only
    // reason a channel number is ever the right default.
    cbChan: 19, cbSpeaker: false,
    // corridor half — filled in by joinCorridor when the rig leaves the map
    route: null, chain: null, instanceId: null, destKey: null, dest: null, s: 0, t: 0, node: 0,
  };
  rigs.set(player.id, rig);
  // THE ONE FLAG THE ENGINE READS. `enemyAttackPlayer` refuses a swing at a player in a cab (see
  // its ⚠), and it must not have to know this plugin exists to do it — so mounting sets a RAM flag
  // on the live player and dismounting clears it. It is written HERE rather than at the four call
  // sites for the obvious reason: a rig you can get into by a path that forgets the flag is a rig
  // that is not a safe box, and nothing downstream would ever tell you which path it was.
  player._inCab = true;
  return rig;
}

// THE CROSSING, AS THE ROAD-BUILDER NEEDS IT: every limb, with the name a sign would call it and
// the number of rooms it runs for. `corridorFor` uses it for two things it could not do from one
// destination alone — synthesise the OTHER limbs so the junction is visible from the cab, and word
// the boards on the verge.
//
// It is derived here rather than passed in by the caller because both callers of joinCorridor
// already hold an instance id and nothing else, and a third one would have to learn the same two
// calls. A limb whose chain has gone missing is dropped rather than defaulted: a sign quoting a
// distance to a road that is not there is worse than a sign that does not mention it.
function crossingPlan(instanceId) {
  const info = instanceId ? crossingInfo(instanceId) : null;
  if (!info) return null;
  return {
    origin: info.originSign || info.origin || null,
    dests: (info.dests || [])
      .map((d) => {
        // WHERE THIS LIMB ACTUALLY COMES OUT, in world tiles. `d.dest` is a real zone id — the rim
        // tile the walker arrives on — so the road now has somewhere to be aimed. A dest whose
        // zone is not loaded contributes no coordinates and its limb falls back to the legacy
        // local frame, which is degraded rather than broken.
        const z = getZone(d.dest);
        return { key: d.key, name: d.sign || d.heading || d.key,
          nodes: crossingChain(instanceId, d.key).length,
          x: z?.grid_x ?? null, y: z?.grid_y ?? null };
      })
      .filter((d) => d.nodes > 0),
  };
}

// ── WHERE A REGION'S ROAD LEAVES IT ──────────────────────────────────────────
//
// THE GATE IS A PLACE, and until now the road out of a void did not have one. A crossing is
// anchored to `leader.current_zone` — the rim tile you happened to be standing on when you struck
// out — which is right for the ROOMS (you walk into the waste from where you are) and impossible
// for the ROAD: a highway whose start is not known until you have already left cannot be drawn
// while you are driving up to it, so it switched on the instant you crossed the edge. That is the
// pop-in, and no amount of rendering work fixes it, because there is nothing to render.
//
// So the road gets a gate of its own: the tile where the region's OWN ROAD runs out of the map. Not
// an arbitrary rim tile and not a derived midpoint — the highway is the continuation of a street
// that is already there, which is what makes the join read as a road leaving town rather than as
// tarmac beginning in a field. It is found by looking at the world rather than by authoring a zone
// id anywhere, because the world already says it: a rim tile carrying road IS the way out.
//
// ⚠ THIS CHANGES THE ANCHOR AND NOTHING ELSE. The crossing's rooms still hang off the tile you
// actually walked out of, `originSign` still names the place, and a walker's void is untouched. All
// that becomes canonical is where the road's GEOMETRY starts — which is precisely the thing that
// has to be knowable before you get there.
//
// ⚠ AND IT LIVES HERE RATHER THAN IN voidwalking, which is where it reads like it belongs. That
// plugin imports nothing from flight and nothing from this one (see the note on the crossingChain
// import above — it is deliberately a one-way edge), and the road test wants flight's `isRoadCell`.
// Trucking already depends on both, so putting it here adds no edge at all.
//
// ⚠ GATES ARE PLURAL, AND THAT IS DELIBERATE FROM THE FIRST LINE. The obvious shape is one gate per
// region, it is simpler, and it would have to be torn out: the design this is heading for is a road
// NETWORK where a region has several exits and a neighbour is reached through whichever one faces
// it — worked out from the map rather than authored. A singular gate bakes the opposite assumption
// into every caller, so there is no singular gate. A region publishes its exits; a ROAD is a pair of
// them; and which pair two regions use is a question with an answer (see `gatePair`) rather than a
// constant. Today most regions publish exactly one, and everything below reads identically for that
// case — which is what makes this a step rather than a promise.
//
// Cached: the world is static between deploys and this walks every zone once.
const _gates = new Map();
export function regionGates(regionKey) {
  if (_gates.has(regionKey)) return _gates.get(regionKey);
  const cand = [];
  for (const z of getAllZones()) {
    if (z.map_id !== 'map_world' || (z.grid_z ?? 0) !== 0) continue;
    if (z.flags?.region_id !== regionKey) continue;
    if (!isRoadCell({ flags: z.flags || {} })) continue;
    // A rim tile: the map genuinely stops on at least one side of it. `surfaceAt` indexes exactly
    // the placed surface tiles, so this is the same question voidwalking's own rim test asks — a
    // missing EXIT is a wall, a missing TILE is the edge of the world.
    const rim = [[0, -1], [0, 1], [1, 0], [-1, 0]]
      .some(([ddx, ddy]) => !surfaceAt(z.grid_x + ddx, z.grid_y + ddy));
    if (rim) cand.push({ id: z.id, x: z.grid_x, y: z.grid_y });
  }
  // ⚠ ONE MOUTH IS ONE EXIT. A road reaching the rim is two or three tiles wide by the time it gets
  // there (it has to be — see the 8-connectivity note in corridor.js), so the raw candidates come
  // out as clumps. Left unclustered, a single way out of town would publish itself as four gates
  // and the pair-chooser below would pick between four names for one place. Adjacent candidates are
  // therefore one gate, and the clump elects the member nearest its own centre.
  const by = new Map(cand.map((c) => [`${c.x},${c.y}`, c]));
  const seen = new Set(), out = [];
  for (const c of cand) {
    if (seen.has(c.id)) continue;
    const clump = [], stack = [c];
    seen.add(c.id);
    while (stack.length) {
      const cur = stack.pop(); clump.push(cur);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const nb = by.get(`${cur.x + dx},${cur.y + dy}`);
        if (nb && !seen.has(nb.id)) { seen.add(nb.id); stack.push(nb); }
      }
    }
    const mx = clump.reduce((a, p) => a + p.x, 0) / clump.length;
    const my = clump.reduce((a, p) => a + p.y, 0) / clump.length;
    // ⚠ TIES BROKEN ON THE COORDINATE, NEVER ON ITERATION ORDER. `getAllZones()` yields a Map's
    // insertion order and a content import can reshuffle it, which would silently move every road
    // in the game without a line of code changing.
    clump.sort((p, q) => ((p.x - mx) ** 2 + (p.y - my) ** 2) - ((q.x - mx) ** 2 + (q.y - my) ** 2)
      || p.x - q.x || p.y - q.y);
    out.push({ ...clump[0], width: clump.length });
  }
  out.sort((p, q) => p.x - q.x || p.y - q.y);   // stable order, for the same reason
  _gates.set(regionKey, out);
  return out;
}

// WHICH WAY OUT FACES WHICH NEIGHBOUR — the question the network turns on, answered from the map.
// Nearest pair of exits wins, which is what "nearby regions share a road and use different exits"
// means in arithmetic. With one exit each it degenerates to the only possible answer, so this is
// live and exercised long before any region grows a second.
//
// ⚠ NULL RATHER THAN A GUESS. A region with no road reaching its rim publishes no exits, and every
// caller falls back to the tile the driver actually left from — the behaviour that shipped.
export function gatePair(aKey, bKey) {
  const A = regionGates(aKey), B = regionGates(bKey);
  if (!A.length || !B.length) return null;
  let best = null;
  for (const a of A) for (const b of B) {
    const d2 = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
    if (!best || d2 < best.d2 - 1e-9) best = { a, b, d2 };
  }
  return best ? { from: best.a, to: best.b } : null;
}
export const _clearGateCache = () => _gates.clear();   // regress only — the world is rebuilt between suites

// ── THE INTERCHANGE ──────────────────────────────────────────────────────────
//
// A gate's own junction, out in the waste. Every road leaving that gate runs down the SAME spoke to
// it and only diverges there, which is what turns the fork from a room boundary into a place: you
// can see it, the boards can point at it, and it is the same piece of tarmac for everybody.
//
// PLACED, NOT AUTHORED. It sits `SPOKE_LEN` tiles out from the gate along the mean bearing to
// everywhere that gate can reach — so it is ahead of you as you leave, roughly on the way to all of
// your options, and it moves by itself when a destination is added. A hub, in the end, is nothing
// more than an interchange that several roads meet at; nothing here has to know which kind it is.
//
// ⚠ FAR ENOUGH OUT THAT THE ROADS HAVE ROOM TO PART. Inside the minimum turn radius the limbs
// leaving it would have to bend tighter than the geometry allows (see MIN_RADIUS and the fold
// invariant), so they would either fold through their own verge or leave as one road that slowly
// smears apart. This is comfortably outside it.
const SPOKE_LEN = 140;
export function interchangeFor(regionKey, gate) {
  const g = gate || regionGates(regionKey)[0];
  if (!g) return null;
  const v = VOIDS[regionKey];
  let ax = 0, ay = 0, n = 0;
  for (const d of v?.dests || []) {
    const p = d.region ? gatePair(regionKey, d.region) : null;
    if (p) { ax += p.to.x; ay += p.to.y; n++; }
  }
  if (!n) return null;
  let dx = ax / n - g.x, dy = ay / n - g.y;
  const m = Math.hypot(dx, dy);
  if (m < 1e-6) return null;
  dx /= m; dy /= m;
  // ⚠ NEVER PAST THE HALFWAY POINT. On a short hop the two interchanges would otherwise overshoot
  // each other and the middle segment would run BACKWARDS between them — a road that doubles back
  // on itself, which `locate` resolves by handing out two answers for one tile.
  const reach = Math.min(SPOKE_LEN, m * 0.4);
  return { x: g.x + dx * reach, y: g.y + dy * reach };
}

// ── THE WHOLE ROAD, GATE TO GATE ─────────────────────────────────────────────
// spoke out → the middle → spoke in, reversed. The middle is seeded on the PAIR of gates, so this
// road and the one built from the other end are the same tarmac driven in opposite directions; each
// spoke is seeded on its own gate, so it is shared by every road that leaves it.
export function networkRoute(fromKey, toKey, window, nodes) {
  const pair = gatePair(fromKey, toKey);
  if (!pair) return null;
  const iA = interchangeFor(fromKey, pair.from), iB = interchangeFor(toKey, pair.to);
  if (!iA || !iB) return null;
  const spoke = (key, gate, ic) => corridorFor(key, 'spoke', window, nodes, 0, null,
    { x0: gate.x, y0: gate.y, x1: ic.x, y1: ic.y }, `spoke|${gate.id}`);
  // ⚠ THE MIDDLE IS BUILT ONCE, CANONICALLY, AND REVERSED FOR THE OTHER DIRECTION. Building it from
  // each end with the same seed is the obvious thing and it does not work: the wander integrates a
  // heading from wherever it starts, so running it from A toward B is not the mirror of running it
  // from B toward A. Same seed, same endpoints, two different curves — nine tiles apart at worst,
  // which regress caught on the first run and which is the entire bug this phase exists to kill.
  // So the lower-sorted gate id is the road's own direction (the same sort `pairKey` uses, for the
  // same reason: something has to decide and a coin flip is not a decision), and a driver coming
  // the other way gets it turned round rather than rebuilt.
  const canon = String(pair.from.id) < String(pair.to.id);
  const [m0, m1] = canon ? [iA, iB] : [iB, iA];
  const [k0, k1] = canon ? [fromKey, toKey] : [toKey, fromKey];
  const midCanon = corridorFor(k0, k1, window, nodes, 0, null,
    { x0: m0.x, y0: m0.y, x1: m1.x, y1: m1.y }, `mid|${pairKey(pair.from.id, pair.to.id)}`);
  const mid = canon ? midCanon : reverseRoute(midCanon);
  const out = joinRoutes([spoke(fromKey, pair.from, iA), mid, reverseRoute(spoke(toKey, pair.to, iB))]);
  if (out) { out.nodes = nodes; out.roomLen = out.L / Math.max(1, nodes); out.anchored = true; }
  return out;
}

// THE ONE PLACE A DRIVEN ROAD IS BUILT. Joining the corridor and changing your mind at the fork
// both come through here, so the two can never produce roads that disagree — which they would the
// first time one of them learned about a new argument and the other did not.
//
// ⚠ IT FALLS BACK TO THE OLD BUILDER, and that is not timidity. The network needs a gate at BOTH
// ends and a region key on the destination; a crossing that cannot supply those (a void whose road
// never reaches its rim, a dest with no region) still has to be drivable, and the pre-network road
// is a perfectly good road — it is only a lonely one. Regress asserts every shipped void takes the
// network path, so this is a fallback rather than a second way of doing things.
function routeForRig(rig, destKey, nodes) {
  const info = rig.instanceId ? crossingInfo(rig.instanceId) : null;
  const dests = destsFor(rig.voidKey, info);
  const region = dests.find((d) => d.key === destKey)?.region;
  const net = region && buildRoad(rig.voidKey, destKey, region, rig.window, nodes, dests);
  if (net) return net;
  return corridorFor(rig.voidKey, destKey, rig.window, nodes, rig.trunk, crossingPlan(rig.instanceId),
    anchorFor(rig.instanceId, destKey));
}

// ── THE FINISHED ROAD, AS EVERYTHING ELSE EXPECTS ONE ────────────────────────
// `networkRoute` is geometry. This is the road: identity stamped on it, boards worked out from the
// finished shape, and the other roads out of this gate hung off it so the fork is visible and
// drivable.
//
// ⚠ SIBLINGS ARE BUILT WITHOUT SIBLINGS OF THEIR OWN. It terminates the recursion, and it is the
// same rule the old builder followed for the same second reason: a sign is a thing the road you are
// ON tells you, and sixty boards facing a road nobody is driving are texture with a per-tile cost.
export function buildRoad(fromKey, destKey, toRegion, window, nodes, dests = null, withSiblings = true) {
  const road = networkRoute(fromKey, toRegion, window, nodes);
  if (!road) return null;
  road.destKey = destKey;
  road.origin = dests ? (VOIDS[fromKey]?.sign || VOIDS[fromKey]?.origin || null) : null;
  attachSigns(road, dests);
  road.branches = [];
  if (withSiblings) {
    for (const d of dests || []) {
      if (d.key === destKey || !d.region) continue;
      const b = buildRoad(fromKey, d.key, d.region, window, d.nodes || nodes, null, false);
      if (b) road.branches.push({ key: d.key, name: d.name || d.key, route: b });
    }
  }
  return road;
}

// Every destination out of a void, in the shape `buildRoad` and `signsFor` both want. Derived from
// the crossing where there is one and from the void's own table where there is not, so the approach
// preview and the live drive are looking at the same list.
function destsFor(voidKey, info) {
  const src = info?.dests || VOIDS[voidKey]?.dests || [];
  return src.map((d) => ({
    key: d.key,
    name: d.sign || d.heading || d.key,
    region: d.region || null,
    nodes: (info ? crossingChain(info.instanceId || null, d.key)?.length : 0) || d.length || d.nodes || 0,
  })).filter((d) => d.region && d.nodes > 0);
}

// ── THE TWO REAL TILES A ROAD RUNS BETWEEN ───────────────────────────────────
// The whole point of anchoring: the crossing already knows both ends as ZONES, and both zones
// already carry `grid_x`/`grid_y`, so the road can be laid in the same coordinates the flight sim
// and a walker's own tile use. Nothing new is authored and nothing is stored — this is a lookup of
// two rows that were always there.
//
// ⚠ RETURNS NULL RATHER THAN A GUESS. A missing coordinate on either end means the legacy local
// frame, which still drives correctly; a fabricated one would put the road somewhere real and
// wrong, and every downstream consumer would believe it.
function anchorFor(instanceId, destKey) {
  const info = instanceId ? crossingInfo(instanceId) : null;
  if (!info) return null;
  // ⚠ THE GATE FIRST, THE TILE YOU LEFT FROM ONLY AS A FALLBACK. Anchoring on `originZone` — where
  // the driver happened to be standing — is what made the road unknowable until after you had left
  // it, and therefore undrawable on the approach. The gate is the region's own road running off the
  // map (see voidGateTile), so the same crossing produces the same road for everybody, every time,
  // and a preview built before you cross is the road you actually get rather than a guess at it.
  const dest = (info.dests || []).find((d) => d.key === destKey);
  // GATE TO GATE where both ends publish one, which is what makes a road a thing joining two places
  // rather than a thing leaving one. `gatePair` picks the exits that face each other, so a region
  // with several ways out uses the one pointing at this neighbour.
  const pair = dest?.region ? gatePair(info.voidKey, dest.region) : null;
  if (pair) return { x0: pair.from.x, y0: pair.from.y, x1: pair.to.x, y1: pair.to.y,
    fromGate: pair.from.id, toGate: pair.to.id };
  // Falling back a piece at a time rather than all at once: an origin gate with no gate at the far
  // end still fixes the near end, which is the half the approach preview depends on.
  const g = regionGates(info.voidKey)[0];
  const from = g || getZone(info.originZone);
  const to = getZone(dest?.dest);
  const x0 = g ? g.x : from?.grid_x, y0 = g ? g.y : from?.grid_y;
  if (x0 == null || to?.grid_x == null) return null;
  return { x0, y0, x1: to.grid_x, y1: to.grid_y, fromGate: g?.id || null, toGate: null };
}

// ── THE ROAD YOU CAN SEE BEFORE YOU ARE ON IT ────────────────────────────────
//
// The whole point of the gate. A crossing instance does not exist until you strike out, so the
// approach cannot ask one what the road looks like — but every argument `corridorFor` takes is now
// static: the void's own table gives the destinations and the room counts, `voidGateTile` gives the
// origin, and the week gives the seed. So the road over the waste is derivable from a standing
// start, and the city leg can render the same geometry the corridor leg will.
//
// ⚠ IT MUST BE THE SAME ROAD, NOT A SIMILAR ONE. Every argument here is the one `joinCorridor`
// passes, and regress asserts the two routes come out identical for a real crossing — because a
// preview that differs by so much as its seed is a road that visibly jumps at the exact moment the
// pop-in used to happen, which is the bug wearing a different hat.
//
// Cached per void+week: the road is a pure function of those, so this builds once and every rig in
// the region reads the same object.
const _preview = new Map();
function previewRoute(voidKey, window) {
  const key = `${voidKey}|${window}`;
  if (_preview.has(key)) return _preview.get(key);
  const v = VOIDS[voidKey], gate = regionGates(voidKey)[0];
  let route = null;
  // The approach builds the SAME road the crossing will, through the same function — which is the
  // whole contract of the preview (see the ⚠ above it) and is now one call rather than a careful
  // re-assembly of the same arguments in a second place.
  const dests = destsFor(voidKey, null);
  if (dests.length) {
    const d = dests[0];
    return _preview.set(key, buildRoad(voidKey, d.key, d.region, window, d.nodes, dests)).get(key);
  }
  if (v && gate) {
    // Each destination aimed at the exit that FACES it, not at the middle of the far region — the
    // same `gatePair` the real anchor uses, so the preview and the crossing agree limb for limb.
    const dests = (v.dests || []).map((d) => {
      const pair = d.region ? gatePair(voidKey, d.region) : null;
      const z = getZone(d.dest);
      return { key: d.key, name: d.sign || d.heading || d.key, nodes: d.length | 0,
        x: pair ? pair.to.x : (z?.grid_x ?? null), y: pair ? pair.to.y : (z?.grid_y ?? null) };
    }).filter((d) => d.nodes > 0 && Number.isFinite(d.x));
    const first = dests[0];
    if (first) {
      const trunk = Math.max(1, v.trunk | 0);
      const pair = v.dests?.[0]?.region ? gatePair(voidKey, v.dests[0].region) : null;
      route = corridorFor(voidKey, first.key, window, first.nodes, trunk,
        { origin: v.sign || v.origin || null, dests },
        { x0: (pair?.from || gate).x, y0: (pair?.from || gate).y, x1: first.x, y1: first.y });
    }
  }
  _preview.set(key, route);
  return route;
}
export const _clearPreview = () => _preview.clear();   // regress only
export { previewRoute as _previewRoute };   // regress only — the suite asserts it equals the joined route

// Which void's road, if any, runs off the edge of the region this rig is standing in. A rig nowhere
// near a void gets null and the city leg is exactly what it always was.
function previewFor(rig) {
  if (rig.leg !== 'city') return null;
  const here = surfaceAt(Math.round(rig.x), Math.round(rig.y));
  const voidKey = here?.flags?.region_id;
  if (!voidKey || !VOIDS[voidKey]) return null;
  return previewRoute(voidKey, currentVoidWindow());
}

// City → corridor. Called when the rig drives off the rim into a live crossing.
export function joinCorridor(rig, { instanceId, destKey, voidKey, window, chain, dest, trunk = 1 }) {
  rig.leg = 'corridor';
  rig.instanceId = instanceId; rig.destKey = destKey; rig.voidKey = voidKey;
  rig.window = window; rig.chain = chain; rig.dest = dest; rig.trunk = Math.max(1, trunk | 0);
  rig.route = routeForRig(rig, destKey, chain.length);
  rig.s = 0; rig.t = 0; rig.node = 0; rig.sMax = 0;
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
// ⚠ `keepPose` IS FOR THE LIMB YOU TOOK WITH THE WHEEL. Taking the fork by TYPING at it happens on
// the trunk, where both limbs are the same tarmac, so re-seating the rig on the new road's (s, t)
// is a no-op and the node can be settled here. Taking it by DRIVING onto the other limb is the
// opposite case in both respects: the truck is already exactly where it is and must not be moved
// under the driver, and `rig.node` has to be left alone so the caller's own comparison fires and
// walks them into the right room through `crossToNode` — the same path an ordinary node crossing
// takes. Two callers, two genuinely different situations, one move.
export function switchLimb(rig, { destKey, chain, dest, keepPose = false }) {
  rig.destKey = destKey; rig.chain = chain; rig.dest = dest;
  rig.route = routeForRig(rig, destKey, chain.length);
  rig.s = Math.min(rig.s, rig.route.L);
  if (keepPose) return rig;
  const p = corridorPos(rig.route, rig.s, rig.t);
  rig.x = p.x; rig.y = p.y;
  rig.node = nodeAt(rig.route, rig.s, chain.length);
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
export function dismountRig(playerId) {
  rigs.get(playerId)?.playerId && rigs.delete(playerId);
  // Out of the cab, out of the box — see mountRig. Cleared unconditionally rather than only when a
  // rig was found, because the failure this guards against is a stale flag making somebody
  // permanently unattackable, and that is far worse than clearing a flag that was already false.
  const p = getLivePlayer(playerId);
  if (p) p._inCab = false;
}
export function rigOf(player) { return rigs.get(player?.id) || null; }

// ── Reconcile: the one place a client number becomes a server fact ───────────
// `d` is the unpacked telemetry frame. Returns { moved, node, bogged } for the caller to act on.
export function reconcileTruck(rig, d, now = Date.now()) {
  // ⚠ THE IGNITION IS READ BEFORE THE THROTTLE GATE, and everything else after it. The gate exists
  // to stop a burst of packets integrating fuel and distance several times over a few milliseconds
  // — that is about MOTION, which is a rate. The ignition is a STATE BIT: dropping it because the
  // last packet was recent means the server can believe an engine is running for up to a sync
  // window after the key came out, and `park` refuses on exactly that belief. Turning the key and
  // being told the truck is still running is a bug the player cannot even diagnose.
  if (Number.isFinite(d.t)) rig.engineOn = d.t > 0.5;
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
  // Bogged: past the OFF-ROAD limit — four times the paved half-width — there is no ground left to
  // synthesise, the rig stalls, and the caller puts it back on the shoulder. This used to fire at
  // the edge of the tarmac, which made the verge a wall wearing a penalty's clothes. Now leaving
  // the road is ordinary driving that is slow and eats tyres (see WHEEL_SURFACE in damage.js), and
  // this is only the far end of that: somewhere you have to genuinely set out for.
  // ── TAKING THE FORK BY STEERING INTO IT ────────────────────────────────────
  //
  // The junction was a thing you could SEE and not a thing you could DRIVE. Both limbs are
  // synthesised and rendered (see branchAt) so the highway visibly splits — and `locate` only ever
  // asked the road you were nominally on, so putting your wheels on the other one changed nothing.
  // Follow it far enough and the limbs separate past OFFROAD_R, at which point you bog: stalled, on
  // what is unmistakably a road, for no reason the windscreen can explain. The only real way to
  // take a junction was to type a destination at it, which is a menu rather than a fork.
  //
  // So the wheels decide. If a sibling limb claims this position on its CARRIAGEWAY and holds it
  // closer to its own centreline than our road does, you are on that road, and the rig is moved
  // onto it. Nothing here is a distance rule and nothing here is a permission: it is the same
  // question `locate` already answers, asked of the other roads as well as of this one.
  //
  // ⚠ THE CARRIAGEWAY, NOT THE BAND. `locate` answers out to OFFROAD_R because the verge is
  // drivable, so testing "does the sibling locate me" would switch roads while you were still
  // squarely on your own tarmac — the limbs are within each other's verge for a long way past the
  // junction. Crossing has to mean crossing: your wheels on their pavement.
  //
  // ⚠ AND `rig.node` IS DELIBERATELY NOT UPDATED. The caller compares the returned node against it
  // and does the zone move through `crossToNode` — the same path an ordinary node crossing takes.
  // Setting it here would suppress that comparison and leave the driver standing in the room of the
  // road they just left, which is the sort of thing nothing notices until a teardown strands them.
  let hit = corridorLocate(rig.route, rig.x, rig.y);
  let tookFork = null;
  if (rig.route?.branches?.length) {
    const ours = hit ? Math.abs(hit.t) : Infinity;
    let best = null;
    for (const b of rig.route.branches) {
      const bh = corridorLocate(b.route, rig.x, rig.y);
      if (!bh) continue;
      const paved = pavedAt(b.route, bh.s);
      if (Math.abs(bh.t) > paved || Math.abs(bh.t) >= ours) continue;
      if (!best || Math.abs(bh.t) < Math.abs(best.hit.t)) best = { b, hit: bh };
    }
    if (best) {
      const chain = crossingChain(rig.instanceId, best.b.key);
      const dest = crossingDest(rig.instanceId, best.b.key);
      if (chain?.length) {
        // Re-derived from the POSITION, never carried over: `s` on the limb you left and `s` on the
        // limb you joined are two different distances along two different roads, and the wheels are
        // the only thing that knows which point on the new one you are actually standing at.
        switchLimb(rig, { destKey: best.b.key, chain, dest, keepPose: true });
        rig.s = Math.max(0, Math.min(rig.route.L, best.hit.s));
        rig.sMax = Math.max(rig.sMax || 0, rig.s);
        hit = corridorLocate(rig.route, rig.x, rig.y);
        tookFork = { key: best.b.key, name: best.b.name };
      }
    }
  }
  const bogged = !hit;

  // THE CLAMP. The odometer is DERIVED here from the reported position rather than taken from the
  // client, because the corridor is the server's geometry and a client that reports its own
  // progress along it is a client that can weave, or lie, or simply drift out of agreement. The
  // client says where it is; the server decides how far that is. `d.s` is accepted only as a
  // fallback when the position is unusable (a bog).
  //
  // However far it claims, it cannot have moved further than flat-out for the elapsed time.
  //
  // ⚠ THE ENVELOPE IS SYMMETRIC NOW, AND THE ODOMETER IS NO LONGER MONOTONIC. It used to be
  // floored at its own previous value on the reasoning that "phase 1 has no reverse, so a
  // decreasing odometer is either a bug or an attempt to re-drive road already paid for". Both
  // halves of that stopped being true: phase 2 shipped a reverse gear, and nothing is paid per
  // tile — a delivery pays a flat `job.pay` on arrival, so re-driving a stretch buys nothing.
  //
  // What the floor actually did was make the truck the only thing out here that could not turn
  // round. A walker in the same crossing has always been able to: trunk rooms carry a `north` exit
  // back the way they came, and the move gate seals only the FORWARD one, and only while an enemy
  // is standing in the room. So the same waste had two rules depending on whether you were on your
  // feet or in a cab, and the cab's was the strange one.
  //
  // The anti-cheat job survives intact, because it was never the direction that mattered — it was
  // the RATE. Clamping |Δs| against wall-clock says exactly what the old ceiling said ("you cannot
  // have covered more ground than flat-out in this interval") and says it about both directions.
  const room = topTilesPerSec() * (dtMs / 1000);
  const claimed = hit ? hit.s : (Number.isFinite(d.s) ? d.s : rig.s);
  rig.s = Math.max(0, Math.min(rig.route.L,
    Math.max(rig.s - room, Math.min(claimed, rig.s + room))));
  // THE HIGH-WATER MARK. Not the odometer — that can now go down — but the furthest out this rig
  // has ever been on this road. It is what arms the near-end exit (see the ⚠ in index.js), and it
  // deliberately never decreases: coming back to the gate is the whole thing it exists to detect.
  rig.sMax = Math.max(rig.sMax || 0, rig.s);
  // Lateral is derived too, and merely bounded — nothing economic depends on it.
  if (hit) rig.t = Math.max(-rig.route.R, Math.min(rig.route.R, hit.t));
  const node = nodeAt(rig.route, rig.s, rig.chain.length);
  return { moved: node !== rig.node, node, bogged, city: false, tookFork };
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

// ── Reading a sign ───────────────────────────────────────────────────────────
// THE BOARD HAS TO REACH THE LOG, and that is a contract rather than a nicety. A sign painted on
// the windscreen is a sign that does not exist for anybody on the bottom rung of the display ladder
// (docs/systems-display-mode.md: if a system's record does not reach the log, that rung is not done
// for it) — and out here the board is not decoration, it is the ONLY statement of how far anything
// is. So passing one writes the same rows out as prose.
//
// Fired off the same reconcile the breakdowns are, not off a node crossing: a node is 90 tiles and
// a sign is one, so hanging it off the crossing would announce a board a driver passed a minute ago
// or one they have not reached. `signSeen` is a per-rig Set, which is RAM like everything else
// about a drive — driving back past a board you already read does not read it out again, and a
// relog puts you at a node boundary anyway.
export function passSign(player, rig) {
  if (!rig || rig.leg !== 'corridor' || !rig.route) return false;
  const from = Number.isFinite(rig._signAt) ? rig._signAt : rig.s;
  rig._signAt = rig.s;
  const passed = signsBetween(rig.route, from, rig.s).filter((g) => !rig.signSeen?.has(g.s));
  if (!passed.length) return false;
  rig.signSeen = rig.signSeen || new Set();
  // WHICH FACE YOU READ IS A FACT ABOUT YOU, NOT ABOUT THE BOARD. Running back toward the origin
  // you go past the far side of the post, where the same places sit at the same distances and every
  // arrow points somewhere else — so the log rung picks its rows the same way the windscreen picks
  // its face, and neither of them recomputes an arrow. Older routes carry no `back`; falling back to
  // the front is the pre-existing behaviour rather than a blank board.
  const rev = rig.s < from;
  for (const g of passed) {
    rig.signSeen.add(g.s);
    const rows = ((rev && g.back) || g.rows).map(r => `<b>${r.n}</b> <span class="text-dim">${r.m} miles, ${ARROW_WORDS[r.a] || 'straight on'}</span>`).join('\n  ');
    sendToPlayer(player.id, {
      type: 'emote',
      message: '<span class="text-dim">A board goes by on the shoulder, green under the dust, still bolted to its legs:</span>\n  ' + rows,
    });
  }
  return true;
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
  // The new tile's standing trailers, into the RAM cache the cab draws from. Fire-and-forget: this
  // is the one place a DB read touches the drive and it must never block it, so the boxes appear a
  // beat after you roll in rather than holding the move up for a round trip. (A yard you have just
  // entered at 30 mph is a yard you cannot couple in yet anyway.)
  refreshStanding(zoneId).catch(() => {});
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
      // WHAT THIS TRUCK'S LAMPS ARE DOING, so the rig behind sees the brake lights come on and the
      // rig ahead is a pair of headlights rather than a dark shape. Straight off the telemetry
      // packet (cmdTruckSync) — no query, no column, and the one field carries both.
      // ⚠ `?? true` on the headlights, not `|| false`: a rig whose driver is on an older client has
      // never sent the slot, and the behaviour that shipped is lamps ON.
      heads: rig.headlights ?? true, braking: !!rig.braking,
      alt: 0, band: 'ground', onGround: true, groundZ: 0, altDiff: 0,
      bank: 0, pitch: 0, vs: 0, hullPct: 100,
      reg: rig.type?.name || 'truck',
      // ⚠ AND WHAT IT IS PAINTED. Every other renderer in the game drew a rig in its owner's
      // colours — the cab, the depot floor, the walkaround — and this one, the only place ANYBODY
      // ELSE sees your truck, drew it in the factory undercoat. So a paint job was a thing you
      // bought and then were the only person alive who could see, which is the opposite of what
      // paint is for: an aircraft's livery says whose it is, and a truck's says who you are.
      // Contacts have carried a finished `livery` since flight (plugins/flight/state.js), and the
      // model painter reads `c.livery` whatever the `cls` — so this is one field, not a code path.
      // ⚠ …AND THE BOX ON THE BACK KEEPS ITS OWN COLOUR. `deck` is the tractor's opinion about what
      // colour a trailer should be, which is fine for a rig with no box on it and wrong the moment
      // there is one: the same trailer would be one colour hooked to your cab and another hooked to
      // somebody else's, and would change under you at the pin. The stamp on the ROW wins, so a box
      // is the same colour standing in a yard, towed by you, and towed by a stranger.
      livery: { ...truckLivery(rig.cd?.paint), ...(rig.trailer ? { deck: boxColour(rig.trailer) } : {}) },
    });
  }
  return out;
}

// WHICH ZONES' STANDING BOXES THIS DRIVER CAN SEE. Where the wheels are, plus the yard this rig
// belongs to — because a depot is three tiles and you mount on the DOOR one, so the stock on the
// hardstand is in a zone you are not standing in until you have rolled a truck's length. The range
// test in `trailersNear` is what actually decides what is drawn; this only decides where to look.
const drawZones = (rig) => [...new Set([rig?.zoneId, rig?.fromDepot].filter(Boolean))];

// WHICH BOX THE FIFTH WHEEL COULD TAKE RIGHT NOW. Nearest first, so a driver reversing between two
// parked trailers gets the one they are actually under. Returns null rather than a list because the
// cab's HITCH button is one button: it is either lit, with a name on it, or it is not there.
//
// It scans the SAME zones the picture is drawn from (see `drawZones`), which is what keeps the knob
// and the box on the glass talking about the same object: a trailer you can see is a trailer the
// button can offer. The VERB still searches wider — the whole depot, `hitchZones` — so this can
// only ever be a subset of what typing `hitch` would find, never the other way round.
function hitchableFor(rig) {
  if (!rig || rig.leg !== 'city' || rig.trailer) return null;
  let best = null, bd = Infinity;
  for (const zoneId of drawZones(rig)) {
    for (const t of standingIn(zoneId)) {
      if (!hitchReach(rig, t).ok) continue;
      const d = posed(t) ? Math.hypot(rig.x - t.x, rig.y - t.y) : 99;
      if (d < bd) { bd = d; best = t; }
    }
  }
  return best ? { id: best.id, name: best.name } : null;
}

export function cabContext(rig, extra = {}) {
  const cx = Math.round(rig.x), cy = Math.round(rig.y);
  const city = rig.leg === 'city';
  return {
    type: 'truck_ctx',
    leg: rig.leg,
    map: mapWindow({ grid_x: cx, grid_y: cy }, CAB_RADIUS, providerFor(rig)),
    mapX: cx, mapY: cy,
    // Everyone standing on the surface grid inside the same window, so the cab draws a figure
    // per person on the pavement. Absolute tile coords, paired with mapX/mapY exactly as `map`
    // is. Corridor legs are void road with no placed tiles, so this is empty out there by
    // construction — nothing has to check the leg. The driver is dropped by id, or they would
    // stand in the road underneath their own truck.
    actors: city ? streetActors(cx, cy, CAB_RADIUS, rig.playerId) : [],
    x: +rig.x.toFixed(3), y: +rig.y.toFixed(3),
    heading: Math.round(rig.heading), speed: Math.round(rig.speed),
    fuel: +rig.fuel.toFixed(3),
    // WHETHER IT IS RUNNING, so the cab's sim can BEGIN where the server says rather than assuming.
    // It is read at mount only (the client owns the engine from the first frame and reports it back
    // through the telemetry's `t`), which is exactly why it has to be on the wire at all: without
    // it the browser's fresh `createTruckState` is always running, whatever the server thinks.
    engineOn: !!rig.engineOn,
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
    // The radio's three switches, so the cab's knob is a VIEW of the set rather than a second copy
    // of it: every path that changes the radio (the verb, the knob, mounting a different truck)
    // ends up here, and the panel paints whatever arrives.
    cb: { on: !rig.cbOff, chan: rig.cbChan ?? 19, spk: !!rig.cbSpeaker },
    paint: rig.cd?.paint || null,
    // The INSIDE of the paint job — `{ mat, col }` or null for however it left the factory. The
    // renderer merges it over the tier row and can reach nothing else (see cabTrim), so a truck
    // that has never been to the bench renders exactly as it always did.
    trim: rig.cd?.trim || null,
    cargo: rig.cargo ? { name: rig.cargo.name, kg: rig.cargo.kg, to: rig.cargo.toName } : null,
    // The client model owns φ and the brake temperature between frames — it simulates them at
    // 60fps and nothing here could improve on that. What the server owns is WHETHER there is a
    // trailer and what it weighs, because that is a fact about the world and not about this frame.
    // …and what colour it is, because the cab draws your own rig in the chase view and a box that
    // was one colour in the yard and another on the pin is not one box.
    trailer: rig.trailer ? { name: rig.trailer.name, kg: rig.trailer.kg, loadKg: rig.cargo?.kg || 0, colour: boxColour(rig.trailer) } : null,
    // The corridor half is only meaningful on that leg; in the city the cab shows the destination
    // rather than a distance-to-go, because there is no single road to be a distance along.
    s: city ? 0 : Math.round(rig.s), t: city ? 0 : +rig.t.toFixed(2),
    L: city ? 0 : rig.route.L,
    // WHERE THIS ROAD IS POINTED, for the cab's GPS screen to name. It is the route's own
    // `destKey` — the exact field the `route` verb sets — so the screen can never say one
    // destination while the tarmac runs to another. Naming only: the aiming, the fork rules and the
    // range check all stay in the verb.
    aim: city ? null : (rig.route?.destKey || null),
    // THE FORK, AS THE VERB SEES IT. Not a second opinion: routeOptions is the one function that
    // answers where this rig can go, and `route` prints the very rows the GPS paints. Distance and
    // whether the tank reaches are the whole value of the screen — a picker that only listed names
    // would be a slower way of typing — and both move (a tune changes the tank, the fork passes
    // behind you), so a copy here would go stale in the one place staleness is dangerous.
    routes: routeOptions(rig, { zoneId: rig.zoneId, forkAhead: atOrBeforeFork(rig) }),
    node: city ? 0 : rig.node, nodes: city ? 0 : rig.chain.length,
    surface: surfaceUnder(rig),
    // The other half of the traffic picture: aircraft near the truck, so a driver sees a Mule come
    // over the yard at two hundred feet. `aircraftNearCoord` already builds exactly this list for
    // the yacht helm, so a driver's sky costs one call and no new channel. City leg only — nothing
    // flies over the corridor, which is off the map entirely.
    contacts: city ? aircraftNearCoord(cx, cy, 22) : [],
    // THE BOXES STANDING IN THIS YARD, as world objects rather than as a list in a menu. Same
    // contact shape as the aircraft above, so the cab draws a dropped trailer with the renderer it
    // already has; served from the per-zone RAM cache (trailers.js) because this runs on the drive
    // and the drive does not get to touch the database.
    trailers: city ? trailersNear(drawZones(rig), cx, cy, 22) : [],
    // Which one, if any, the fifth wheel could take right now — the HITCH button in the cab lights
    // off this and nothing else, so the button and the verb can never disagree about whether you
    // are under it. (The verb still re-checks: a button is a hint, never an authority.)
    hitchable: hitchableFor(rig),
    // THE PUMP HANDLE ON THE DASH, and it is the same three facts the commit re-checks: is there a
    // pump here, what does a tank cost, and what can this driver actually pay. The cab needs the
    // last one because the whole point of the handle is that the running total is honest while it
    // is still running — a driver watching the credits climb must be stopped by the pump clicking
    // off, not by a refusal after the fact. (The verb re-checks all three: a button is a hint.)
    // WHAT TIME IT IS OUT THERE. The cab renders through the flight sim's own canopy, which has
    // always drawn a time-of-day sky, a moon and weather — and this context never sent it any of
    // the three, so `hour` fell through to the client's `?? 12` default and every haul in the game
    // was run at high noon under a clear sky. One call to the same `skyState` the cockpit uses, so
    // a driver and a pilot in the air above them can never disagree about the time or the weather.
    // The spatial weather FIELD is deliberately left off: the cab doesn't wire it, and putting a
    // payload on the wire that nothing reads is how a push gets expensive for nothing.
    // Flat rather than nested, because `ctx.hour` / `ctx.weather` are the names the cab has read
    // since it was built — it was waiting for these the whole time.
    ...(() => { const s = skyState(); return { hour: s.hour, weather: s.weather, moon: s.moon, wind: s.wind }; })(),
    pump: pumpAt(rig) ? { full: FUEL_FULL, credits: getLivePlayer(rig.playerId)?.credits || 0 } : null,
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
// ── The pump ─────────────────────────────────────────────────────────────────
// What a full tank costs. One number, because diesel is diesel — the interesting variable in this
// system is the DISTANCE between pumps, not the price at them.
export const FUEL_FULL = 380;

// IS THERE A PUMP WITHIN REACH RIGHT NOW. One definition, because there are now four readers — the
// `fuel` verb, the depot panel, the cab's hold-to-pump handle and the commit that handle sends —
// and the moment two of them disagree you get a button that lights on a tile the verb then refuses.
// A fuel yard is a pump by being one; any other depot is a pump by carrying `truck_fuel`. Out on
// the corridor the fuel stop is a roadside structure rather than a zone, so standing on one is it.
export function pumpAt(rig, fallbackZoneId) {
  if (!rig) return false;
  // ⚠ AND YOU HAVE TO HAVE STOPPED. The handle on the dash lit the moment the tile under the wheels
  // was a forecourt, which meant it came on as a driver swept THROUGH one at fifty and went out
  // again a second later — a control that appears and disappears while you are steering reads as a
  // glitch rather than as an offer. Nobody fuels a moving truck, so the reach test says so, and it
  // says it HERE because four things ask this question (the verb, the depot panel, the cab's handle
  // and the commit that handle sends) and the moment two of them disagree you get a button that
  // lights on a tile the verb then refuses. A caller with no rig in motion — the depot panel, which
  // asks about a yard rather than about a vehicle — sends no speed and is unaffected.
  if (Math.abs(rig.speed || 0) > 2) return false;
  if (rig.leg === 'corridor')
    return corridorAt(rig.route, Math.round(rig.x), Math.round(rig.y))?.flags?.building_type === 'fuel_yard';
  const z = getZone(rig.zoneId || fallbackZoneId);
  return !!(z?.flags?.truck_fuel || z?.flags?.building_type === 'fuel_yard');
}

// HOW MUCH FUEL A REQUEST ACTUALLY BUYS, as one pure function, because three things ask it and one
// of them is a client. The cab needs it to draw an honest running total under the driver's thumb;
// the commit needs it to decide what to charge; the test needs it to be checkable without a truck.
// Two ceilings — the tank, and the balance — and the balance one is a CLAMP rather than a refusal,
// which is what stops the system stranding a driver who had enough to reach the next town.
export function pumpClamp(credits, fuel, want) {
  const take = Math.max(0, Math.min(
    Number.isFinite(want) ? Math.max(0, want) : 1,
    1 - fuel,
    (credits || 0) / FUEL_FULL,
  ));
  return { take, cost: Math.round(take * FUEL_FULL) };
}

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
  // ⚠ `dirt_road` MEANS TWO DIFFERENT THINGS AND ONLY THE LEG CAN TELL THEM APART. Out on the
  // corridor it is the graded band beside the tarmac — `corridorAt` paints the verge with it
  // precisely because it earns the renderer's packed-dirt look — and a verge has to keep a verge's
  // penalty or the whole "the edge of the road is a law, not a wall" rule stops meaning anything.
  // In a CITY it is somebody's actual road: authored, driven, and the only way to reach a good deal
  // of the map. Bucketing both as `shoulder` made a real road handle like the strip you bog on —
  // 41 seconds to thirty in a loaded rig, which is indistinguishable from a gearbox that will not
  // leave second, and is exactly what it was reported as.
  if (terrain === 'dirt_road') return rig.leg === 'city' ? 'dirt' : 'shoulder';
  // Gravel stays the verge wherever it is: it is the material a shoulder is MADE of, and the 900-odd
  // tiles of it in the world are yards and lots rather than routes.
  if (terrain === 'gravel') return 'shoulder';
  return 'offroad';
}
