// Waste Crossing — void-travel, on-foot travel between regions across the void.
//
// Regions are islands. Between them is the VOID — no authored corridor, just a
// generated waste you cross on foot when you can't afford to fly. Strike out from a
// perimeter edge and a deterministic graph of transient rooms is generated, walked
// on foot, and deposits you at a distant region.
//
// Two ways in, one code path (launchCrossing):
//   • Walk off the map — moving in any direction with no authored exit off a tile
//     in a void-region fires the engine's `movement.edge` hook.
//   • `voidwalk [heading]` — the explicit verb, from anywhere in a void-region.
//
// THE BRAID: a void off a gate is a SHARED TRUNK that forks toward MULTIPLE
// destinations. You walk the trunk (identical for everyone this window), reach the
// fork, and choose a limb toward a region — hold your declared heading, or divert to
// a neighbour. Off trunk rooms hang risk-for-loot DETOURS (a lateral `west` gamble).
//
// INSTANCING (Slice 4): a crossing is a per-crossing INSTANCE (unique id) in
// `crossings`. A PARTY shares one instance; two crossings never share rooms
// (instanced — no live collision). Room CONTENT is seeded by (void, window, salt) —
// shared geometry — so every instance this window is identical (relog regenerates it
// byte-for-byte), but room IDS are namespaced by the instance so occupancy/teardown
// are private. Cohort = the leader + everyone FOLLOWING them (the follow substrate,
// never the party plugin) co-present at the origin.
//
// ENCOUNTERS (Slice 2): on first arrival at a non-threshold room a live roll spawns a
// real enemy from the void roster — real combat via spawnEnemySync; despawned on
// teardown. Detour rooms roll hotter.
//
// State model:
//   • Live: player._crossing = { instanceId, seen:Set } — read on every zone.entered.
//   • Shared: crossings.get(id) = { voidKey, plan, roomSet, detourSet, destSet,
//     dests, entry, origin, window, members:Set, enemies:Set } — reference-counted.
//     `plan` is the ROUTE (pure, nothing registered); `roomSet` is what is
//     currently MATERIALISED. They are the same set today because ensureInstance
//     is still eager; see planFor for why they had to be separated anyway.
//   • Durable (per member): crossing_void / crossing_window / crossing_origin /
//     crossing_instance / crossing_room in player_flags — enough to RE-DERIVE the
//     instance after a server restart. crossing_room is flushed on player.logout, not
//     per step. A same-session reconnect needs nothing (rooms still in RAM).

import { getLivePlayer, getAllLivePlayers, getAllZones, getZone, getZoneEnemies, getMinimapData, addPlayerToZone, removePlayerFromZone,
  registerTransientZone, removeTransientZone, spawnEnemySync, removeEnemyInstance, propsOf } from '../../server/engine/world.js';
import { describeZone } from '../../server/engine/commands/describe.js';
import { sendToPlayer, sendToZone, teachVerb } from '../../server/engine/messaging.js';
import { on, emit } from '../../server/engine/events.js';
// The single named exemption engine:impassable-terrain carries — a body that grew wings. Imported
// rather than reimplemented so the void and the world agree about what a cliff is.
import { mutationFlag } from '../../server/engine/mutations.js';
import { registerMoveGate } from '../../server/engine/movement-gates.js';
import { getFlag, setFlag, setFlags, clearFlagsIn } from '../../server/engine/flags.js';
import { OPPOSITE } from '../../server/engine/directions.js';
import { VOID_TERRAINS, FEATURES, WAYSIDE, groundFlavour, featureFor } from './flavour.js';
import { effectiveSkill, awardSkillUse } from '../../server/engine/skills.js';
import { query } from '../../server/models/db.js';
import { getItem } from '../../server/engine/items-cache.js';
import { randomUUID } from 'crypto';
import { loadWindow, getTraces, addTrace, claimTrace } from './traces.js';
// The traversal verb. It reads the plan and nothing else, and imports nothing back — see wireMarch.
import { cmdMarch, wireMarch, isMarching, _test as _march } from './march.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const VOID_MAP = 'map_void'; // non-map_world → flag/map-filtered world iterators skip void rooms

// ── Voids (the region adjacency graph — keyed by region) ──────────────────────
// A void is owned by a whole REGION, keyed by flags.region_id. It is entered ONLY by
// walking off that region's rim — a cardinal step from a boundary tile into a
// coordinate that holds no tile at all (see isMapRim). A void has a shared `trunk` (room count
// before the fork) and `dests` — the adjacent regions it forks toward. Each dest
// carries the fork-exit `dir` (n/s/e/w) that leads to its limb, and an optional
// `length` override (else the total gate→dest length is distance-derived).
//
// A dest may also carry `sign` — WHAT A ROAD SIGN CALLS THE PLACE, which is a different question
// from what the fork is called and only looks like the same one. `heading` is the choice you make
// at the junction ("Exodus" is a direction people went, and the codex is explicit that they would
// not name a town); a board bolted to a post on the verge is naming somewhere you can drive to, so
// it says TERMINUS. Absent, the board falls back to `heading`, which is right for every dest whose
// heading is already a place. THE LONG HAUL reads this; nothing else does.
//
// A dest also NAMES the region it lands in (`region`), rather than that being read off the
// destination zone at runtime. It is the same fact either way in play, but this table is a graph
// and a graph edge should know its own endpoint: the return-leg check ("is anything reachable also
// leavable?") is about the shape of the table, and reading it out of live world state made it
// depend on which zones happened to be loaded.
export const VOIDS = {
  region_coldwater: {
    origin: 'Coldwater',
    sign: 'Coldwater Basin',
    // trunk: was 4 ROOMS, when a room was a twelfth of a leg. A room is a TILE now, so the
    // number no longer means anything and the shared stretch is derived (see trunkTilesFor).
    dests: [
      // The `length: 8` that used to be here is now DERIVED and comes out at 8 unchanged: the gates
      // are 93 tiles apart and a room is 12, so the fork still sits exactly halfway at a trunk of 4.
      // (The old comment said 40 tiles and clamping to MIN_ROOMS, which was true of the wrong
      // measurement — origin tile to destination tile, divided by the unanchored 90. See totalLength.)
      { key: 'reach',  dest: 'zone_the_reach_870_1958', region: 'region_the_reach', heading: 'The Reach', dir: 'south' },
      // TERMINUS. `zone_exodus_waypoint` never existed — this limb deposited walkers at a zone id
      // with no zone behind it. The destination is now the roadhead outside the Exodus wall.
      //
      // `heading` stays 'Exodus' because that is what the fork means: the direction the Exodus
      // went, not a town of that name. The codex is explicit that they will not say where they are
      // going, and Terminus is where they went when they left the Basin, not where they are going.
      //
      // The `length: 12` here is derived now, and comes out at the real distance: the gates are 282
      // tiles apart, which is 23 rooms before the clamp. That is a real answer rather than a
      // failure — the ROAD is 282 tiles whatever this says — and what the clamp changes is that the
      // longest crossing gets longer rooms rather than a silly number of them.
      //
      // ⚠ THE RANGE GATE THIS COMMENT USED TO CLAIM DOES NOT EXIST, AND NEVER DID. It said fifteen
      // rooms put Terminus "beyond the range of the two cheapest trucks and beyond ANY truck's
      // round trip, so the fleet ladder doubles as a map gate". That was read off the `route`
      // picker, which computed a distance as room count × 90 — the UNANCHORED per-room constant —
      // and so reported this crossing at 1,350 tiles. The road is 282. Fuel burns `moved / tank`
      // over the real road (plugins/trucking/state.js) and the cheapest tank is 850 tiles, so a
      // Scrapper has always been able to reach Terminus and come back on two thirds of a tank.
      //
      // The picker tells the truth now, which means it prints 'ok' where it used to warn. Nothing
      // about the sim changed; a surface stopped misreporting it. IF THE MAP GATE IS WANTED, it has
      // to go in the tanks or the burn rate — somewhere that actually bites — and not back into a
      // number this file multiplies by the wrong constant. See docs/proposals/terminus.md, whose
      // design intent for the gate is still unbuilt rather than merely undone.
      { key: 'exodus', dest: 'zone_terminus_1200_940', region: 'region_terminus', heading: 'Exodus', sign: 'Terminus', dir: 'east' },
      // DEADWATER, southwest, landing at the Roadhead six tiles in off its east rim.
      //
      // `dir: 'west'` is not a preference, it is the last cardinal left: `reach` holds south and
      // `exodus` holds east, and north is the basin (a water tile has no rim in any direction, so
      // there was never a fourth). THE FORK IS NOW FULL AT THREE LIMBS. A fifth destination off
      // Coldwater needs a design change — a second gate, or a fork that is not a room with four
      // walls — and not another row in this array.
      //
      // Derived as well now — 108 tiles between the gates is 9 rooms, one more than the 8 that was
      // written here, and the road is the same 108 tiles it always was.
      { key: 'deadwater', dest: 'zone_dw_812_955', region: 'region_deadwater', heading: 'Deadwater', dir: 'west' },
    ],
  },

  // ── The way home ───────────────────────────────────────────────────────────
  // Until these existed the void was ONE-WAY. Only Coldwater had an entry, so a walker who
  // reached the Reach — or a trucker who drove to Terminus — could not leave by the road they had
  // just come down: the rim they were standing on was an ordinary wall in that direction. Terminus
  // made it plain, because the Gantry is `vtol_only, charter: false`, so the only way out of the
  // place was a Dragonfly you had to already own. Somebody who spent 31,000 credits on a rig
  // could be stranded by it.
  //
  // These are NOT new roads. Each is the same crossing read backwards — and it is the same LENGTH
  // by construction now rather than by careful copying: the room count is derived from the gate
  // pair (see totalLength), and `gatePair` picks the same two mouths whichever end you ask from.
  // So the corridor is the same distance in both directions and the tank maths holds, without two
  // numbers in this table having to be edited together. The arrival tile is the rim tile that
  // faces the way you went. A trunk of one keeps a single-destination
  // void honest: there is nothing to fork toward, so the "shared trunk" is a formality and the
  // limb is the crossing. (Detours need `trunkLen >= 3` and therefore do not appear on a return
  // leg — correct: the gamble is a thing you take on the way OUT, with a full tank and a choice
  // still ahead of you.)
  region_the_reach: {
    origin: 'The Reach',
    // Raised 1 → 2 when Deadwater gave the Reach a second way out. This is the one place in this
    // table where a SHIPPED crossing changed shape: the Coldwater limb keeps its `length: 8`, so
    // the corridor is the same distance it always was and the tank maths in flight-model.js still
    // holds — only the trunk/limb split moved. A trunk of 2 stays detour-free (`trunkLen >= 3`),
    // which is right: the gamble belongs on the way out, not on a leg home.
    // trunk: was 2 ROOMS, when a room was a twelfth of a leg. A room is a TILE now, so the
    // number no longer means anything and the shared stretch is derived (see trunkTilesFor).
    dests: [
      // North out of the Reach, back onto the dirt road at the foot of the Coldwater map — the one
      // tile on that whole rim that is `dirt_road` rather than redrock, because it is the road.
      { key: 'coldwater', dest: 'zone_district_918_947', region: 'region_coldwater', heading: 'Coldwater', sign: 'Coldwater Basin', dir: 'north' },
      // West across the flats to Deadwater's Eastern Ruts. `west` is both true and free (north is
      // Coldwater's), so the Reach is the one region whose two crossings do not compete.
      { key: 'deadwater', dest: 'zone_dw_818_988', region: 'region_deadwater', heading: 'Deadwater', dir: 'west' },
      // ── EAST TO THE SCARLETWASTES ────────────────────────────────────────────
      // The edge that closes the loop. Until this the graph was a CHAIN with the Reach at one end
      // and the Scarletwastes at the other, so the two ends of the world were four crossings apart
      // through Coldwater — the long way round a map on which they are the two most southerly
      // places. `east` is true and free (north is Coldwater's, west is Deadwater's), which is the
      // last cardinal the Reach had.
      //
      // ⚠ IT NEEDED A SECOND MOUTH AT BOTH ENDS, AND THAT IS THE POINT OF PLURAL GATES. The Reach's
      // only road ran west out of Main Street to the Coldwater rim; the Scarletwastes' only one ran
      // east to Talus. Neither faced the other, and `gatePair` would have paired the two mouths it
      // had — laying a highway back across both regions' own placed ground. Main Street is now
      // paved out to the Reach's east rim (922,1039) and the Deadleg's spur down and west to the
      // Scarletwastes' west rim (1000,968), so each region reaches this neighbour through the exit
      // that actually points at it, and keeps using its old mouth for its old neighbours. Nothing
      // in the code chooses that; `gatePair` reads it off the map.
      { key: 'scarletwastes', dest: 'zone_scw_1000_968', region: 'region_scarletwastes', heading: 'The Scarletwastes', sign: 'Thornwarren', dir: 'east' },
    ],
  },
  region_deadwater: {
    origin: 'Deadwater',
    // trunk: was 2 ROOMS, when a room was a twelfth of a leg. A room is a TILE now, so the
    // number no longer means anything and the shared stretch is derived (see trunkTilesFor).
    dests: [
      // NORTH out of Deadwater for Coldwater, and this is the one dest in the table that is NOT the
      // mirror of its outbound leg (`dir: 'west'` from Coldwater). It is not an oversight: Coldwater
      // lies entirely north of Deadwater AND entirely east of it, so both readings are true, and
      // `east` is already spoken for by the Reach below. Landing on Coldwater's south rim at x870
      // keeps it clear of the Reach's own arrival at x918 on the same row.
      { key: 'coldwater', dest: 'zone_district_870_947', region: 'region_coldwater', heading: 'Coldwater', sign: 'Coldwater Basin', dir: 'north' },
      // East to the Reach's west rim, level with the middle of its original block.
      { key: 'reach', dest: 'zone_the_reach_863_1956', region: 'region_the_reach', heading: 'The Reach', dir: 'east' },
    ],
  },
  region_terminus: {
    origin: 'Terminus',
    // trunk: was 1 ROOMS, when a room was a twelfth of a leg. A room is a TILE now, so the
    // number no longer means anything and the shared stretch is derived (see trunkTilesFor).
    // West out of Terminus, onto Coldwater's east rim at the same latitude as the Roadhead — you
    // come back in level with where you left.
    dests: [
      { key: 'coldwater', dest: 'zone_district_955_940', region: 'region_coldwater', heading: 'Coldwater', sign: 'Coldwater Basin', dir: 'west' },
      // ── SOUTH TO THE SCARLETWASTES ──────────────────────────────────────────
      // `dir: 'south'` because west is Coldwater's and south is the free cardinal, and because it
      // is half true: the Scarletwastes sit west-southwest.
      //
      // ⚠ IT LEAVES BY THE ROADHEAD, NOT BY THE SOUTH RIM. This used to read "the WEST rim (x1200)
      // is cliff for its whole length … so the gate is the westernmost passable tile of the south
      // rim, (1219,960), painted `dirt_road` to match every other gate in this table", and all
      // three claims were wrong. The west rim is cliff only from y943 SOUTH — (1200,940) is graded
      // dirt road through it, because Coldwater's own road comes in there. (1219,960) is not the
      // westernmost passable south-rim tile either (the ramp at x1201 is, and gravel at x1212).
      // And a lone tile of `dirt_road` on a hardpan flat is not a road: it is 20 tiles of open
      // ground from The Gate, with nothing to drive on.
      //
      // What made it visible is that NOTHING READ IT. `gatePair` takes the nearest pair of mouths
      // off the map, so the Scarletwastes road has always joined Terminus at (1200,940) — 109 tiles
      // against the south gate's 127 — while this table sent the WALKER to (1219,960) and
      // `crossingPlan` measured that limb's mile boards to it. Two arrivals, one region, and the
      // paint was the only thing holding the second one up. The tile is hardpan again (which is what
      // its own description, its name and every neighbour already said) and Terminus publishes the
      // one gate it has: the roadhead. See docs/systems-overland-void-travel.md.
      { key: 'scarletwastes', dest: 'zone_scw_1092_957', region: 'region_scarletwastes', heading: 'The Scarletwastes', sign: 'Thornwarren', dir: 'south' },
    ],
  },

  // ── THE SCARLETWASTES ──────────────────────────────────────────────────────
  // The fourth region on the road, and the last one reachable without a design change: Coldwater's
  // junction has been full at three limbs since Deadwater (a room has four walls and the fourth is
  // the way you came in), so a hub was never going to hold everything. The network is a CHAIN
  // instead — Coldwater–Terminus–Scarletwastes on this side, Coldwater–Reach–Deadwater on the other
  // — which is also why this hangs off Terminus rather than off the Basin. It is not a compromise;
  // it is the only shape that keeps growing.
  //
  // Geometry picked the neighbour, not taste. The Scarletwastes run x1000–1092 / y950–1001 and
  // Terminus x1200–1239 / y921–960: they overlap in latitude and sit about 108 tiles apart, the
  // same gap Coldwater and Deadwater are, while Deadwater (x812) and the Reach (y1958) are absurd
  // from here.
  //
  // The road on the far side is authored, not generated: it enters at Talus on the east rim, runs
  // west along y957, and turns south to ring the Thorn Wall. ⚠ It stops at x1053 and the Deadleg
  // depot is at x1024, so the last stretch to the yard is open redrock — drivable (nothing out
  // there is impassable) but off the tarmac, which is a tyre bill rather than a wall. That is a
  // painting job in the Studio, not a change here.
  region_scarletwastes: {
    origin: 'The Scarletwastes',
    sign: 'Thornwarren',
    // Raised 1 → 2 when the Reach gave the Scarletwastes a second way out. A trunk of 1 was the
    // formality a single-destination void gets — there is nothing to fork toward, so the "shared
    // trunk" is a name and the limb is the crossing. There is a real fork now. It stays below 3,
    // so detours still do not appear here: the gamble belongs on the way OUT of somewhere with a
    // full tank, not on a frontier hop between two places at the bottom of the map.
    // trunk: was 2 ROOMS, when a room was a twelfth of a leg. A room is a TILE now, so the
    // number no longer means anything and the shared stretch is derived (see trunkTilesFor).
    dests: [
      // Terminus has ONE way in and both crossings use it — the roadhead at (1200,940), the same
      // tile the Basin's own walkers arrive on and the same tile `gatePair` ends the road at. This
      // pointed at (1219,960) until 2026-08-21; see the ⚠ on Terminus' own scarletwastes limb above
      // for why that was a gate that only this line believed in.
      { key: 'exodus', dest: 'zone_terminus_1200_940', region: 'region_terminus', heading: 'Terminus', sign: 'Terminus', dir: 'east' },
      // ── WEST TO THE REACH ────────────────────────────────────────────────────
      // The other half of the loop-closing edge (see the Reach's own entry for why it exists and
      // what it cost in tarmac). `west` is true and free — east is Terminus's.
      //
      // ⚠ THE ROAD TO IT GOES ROUND THE PLATEAU, NOT OVER IT. The spur west along y957 stops at the
      // Deadleg's apron (x1024) and the ground beyond is the cliff-ringed mesa at x1011–1017 —
      // `cliff` being the one terrain `engine:impassable-terrain` refuses. Same trap as Terminus'
      // west rim, and answered the same way: the road drops south down the Deadleg's own column to
      // y=968 and runs west under the mesa to the rim at (1000,968), which is the gate.
      { key: 'reach', dest: 'zone_the_reach_882_1959', region: 'region_the_reach', heading: 'The Reach', dir: 'west' },
    ],
  },
};

const crossings = new Map();
let _seq = 0;

// The whole crossing — trunk length, detour placement, hard nodes, the big score —
// is seeded off (voidKey, window), and the window is the real-world week. That is
// correct in play (everyone this week walks the same waste) and poison in a test:
// the regress suite would walk a DIFFERENT map every Monday, so a green gate could
// go red on a tree nobody touched. WINDOW_FORCE lets the suite pin one week and get
// a deterministic layout. Never set outside regress.
let WINDOW_FORCE = null;
// Exported because the road over the waste is seeded on it, and trucking now derives that road
// BEFORE any crossing exists (see previewRoute) — so the week has stopped being only the void's
// business. ⚠ Still honours WINDOW_FORCE, which is what lets a regress suite pin a week and get a
// fixed road out of both this plugin and that one.
export function currentWindow() { return WINDOW_FORCE ?? Math.floor(Date.now() / WEEK_MS); }

export function voidGateOf(zone) {
  const key = zone?.flags?.region_id;
  if (!key || !VOIDS[key]) return null;
  return { key, void: VOIDS[key] };
}
// ── The rim: where the world actually stops ───────────────────────────────────
// The void is entered by walking out of the world, so "off the map" has to mean the
// real thing: no TILE at the neighbouring coordinate. A missing `exits` entry is NOT
// the rim — 483 map_world tiles (building facades, water margins) sit beside a real
// neighbour they simply don't connect to, and bumping those must stay an ordinary
// wall. Cardinals only; up/down/in/out are never the rim.
const RIM_DELTA = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

// Coordinate index over placed tiles, so a rim test is a hash lookup instead of a
// ~5,700-zone scan — describeRim runs on every look, which is a hot path. Transient
// void rooms are coordless and never enter the index. Short TTL so a dev-panel zone
// add self-heals without a restart; the shipped world is static between deploys.
const RIM_INDEX_TTL_MS = 60_000;
let coordIndex = null, coordIndexAt = 0;
function placedCoords() {
  const now = Date.now();
  if (coordIndex && now - coordIndexAt < RIM_INDEX_TTL_MS) return coordIndex;
  const set = new Set();
  for (const z of getAllZones()) {
    if (!z.map_id || z.grid_x == null || z.grid_y == null) continue;
    set.add(`${z.map_id}|${z.grid_z ?? 0}|${z.grid_x},${z.grid_y}`);
  }
  coordIndex = set; coordIndexAt = now;
  return set;
}

function isMapRim(zone, direction) {
  const d = RIM_DELTA[direction];
  if (!d || !zone?.map_id || zone.grid_x == null || zone.grid_y == null) return false;
  // You cross the waste on foot. Open water is not the waste: the entire northern
  // edge of Coldwater (y=896) is basin, and "the ground runs out to the north" is a
  // lie told to someone who is swimming in it. A water tile has no rim in any
  // direction — no line, and no way in. Whatever lies past the far shore is a
  // different system's problem (boats, the leviathan), not the void's.
  if (propsOf(zone.id).liquid) return false;
  return !placedCoords().has(
    `${zone.map_id}|${zone.grid_z ?? 0}|${zone.grid_x + d[0]},${zone.grid_y + d[1]}`);
}

// Which cardinals off this tile lead clean out of the world.
function rimDirs(zone) {
  if (!zone?.map_id || zone.grid_x == null || zone.grid_y == null) return [];
  return Object.keys(RIM_DELTA).filter((dir) => isMapRim(zone, dir));
}

// zone.describeRoom: a boundary tile says so. The rim is the void's only entrance and
// a full muster overlay is a hard thing to meet with no warning, so the edge announces
// itself one step before you can walk off it — and the warning IS the tutorial. Returns
// undefined everywhere else; fireHook keeps the last defined result, so a silent
// non-rim zone never clobbers the airfield/elevator/AA panels.
async function describeRim(zone) {
  if (!zone?.map_id || zone.grid_x == null) return undefined;
  if (!voidGateOf(zone)) return undefined; // a rim with no void behind it promises nothing
  const dirs = rimDirs(zone);
  if (!dirs.length) return undefined;
  const where = dirs.length === 1
    ? `to the ${dirs[0]}`
    : `to the ${dirs.slice(0, -1).join(', ')} and ${dirs[dirs.length - 1]}`;
  return `<span class="ambient">The ground runs out ${where}. There is no horizon that way to read and no distance to judge — only the waste, going on being nothing in particular for as long as you can stand to look at it. People do walk out into it from here. The ones who come back mostly come back somewhere else.</span>`;
}

// ── A CAMP SAYS WHAT THE SHORT WAY COSTS ─────────────────────────────────────
//
// The only genuinely new decision in a crossing is whether to take a cut, and it was invisible. The
// branch is a real `east` exit so the word appeared in the room, and nothing said what was down it,
// what it saved, or that it was any different from a detour. A choice nobody can see is not a choice.
//
// ⚠ THE SAVING IS ON THE TABLE AND THE RISK IS NOT QUANTIFIED. "Save twenty tiles, lose the road" only
// works if the twenty is knowable; the other side is deliberately left as prose, because a stated
// percentage would turn a decision about nerve into arithmetic. And whether the cut is PASSABLE is
// never hinted at all: you find the face by walking to it, which is the whole of what a cut risks.
function describeCut(zone) {
  const c = crossingOfRoom(zone?.id);
  const r = c?.plan?.rooms?.get(zone.id);
  if (!r?.cutSaves || !r.exits?.east) return undefined;
  return `<span class="ambient">A path goes off east from the camp, out across the open where the road will not follow. `
    + `Boots have been this way: it comes back to the tarmac about <b>${r.cutSaves} tiles</b> sooner than the long way round. `
    + `There is nothing out there to walk toward and nothing to be seen from.</span>`;
}

// Which crossing a room belongs to, for a hook that is handed a zone and nothing else.
function crossingOfRoom(id) {
  if (!id) return null;
  for (const c of crossings.values()) if (c.plan?.rooms?.has(id)) return c;
  return null;
}

async function describeVoidRoom(zone) {
  return describeCut(zone) ?? await describeRim(zone);
}

function destByHeading(vdef, heading) {
  if (!heading) return null;
  const h = heading.toLowerCase();
  return vdef.dests.find(d => d.heading.toLowerCase().includes(h) || d.key === h) || null;
}

// ── A ROOM IS A TILE ─────────────────────────────────────────────────────────
//
// The crossing used to be 5 to 15 abstract rooms whose count was the gate distance divided by
// ROOM_TILES (12) and clamped. That made the void the ONE place in the game where movement meant
// something private: a tile is a tile inside a region, under a truck and under an aircraft, and only
// a walker's `south` bought an eighteenth of a leg. Every conversion in the system came from that one
// disagreement, and this deletes it. One `south` is one tile of ground. `ROOM_TILES`, `MAX_ROOMS` and
// the walker's half of `roomLen` are gone with it, and a shortcut now shortens the walk in the only
// unit anybody counts.
//
// What the numbers become: Coldwater→Reach 93, Reach→Deadwater 99, Coldwater→Deadwater 108,
// Terminus→Scarletwastes 109, Coldwater→Terminus 282. Real distances, no clamp, no arithmetic.
//
// ⚠ A FLOOR SURVIVES AND A CEILING DOES NOT. `MIN_ROOMS` stays because a degenerate route (a
// mis-authored dest, two gates on top of each other) must still be a crossing rather than a doorway,
// and it is a guard rather than a tuning knob. A ceiling is the thing that was wrong: it existed to
// stop a long haul becoming "a silly number of rooms", and a long haul being a long walk is the point.
const MIN_ROOMS = 5;
const DEFAULT_ROOMS = 24;        // no gate pairing and no coordinates: a plain unremarkable crossing

// ⚠ THE TRUNK IS DERIVED, IN TILES, AND THE AUTHORED NUMBER IS GONE. `VOIDS[].trunk` was a ROOM count
// (4, 2, 2, 1, 2) tuned when a room was a twelfth of a leg, so read as tiles it would put the fork
// four steps off the rim of a ninety-three tile walk. The shared stretch is a FRACTION of the nearest
// destination instead: far enough out to be a journey, near enough that the fork is still a decision
// you make rather than one you have already made. Bounded at both ends so a short hop still forks and
// a long haul does not spend a quarter of itself undecided.
//
// An authored `trunk` on a void is honoured as an override, in tiles. Nothing uses one.
const TRUNK_FRACTION = 0.2, TRUNK_MIN = 6, TRUNK_MAX = 30;

function gridDist(a, b) {
  if (!a || !b || a.grid_x == null || b.grid_x == null || a.grid_y == null || b.grid_y == null) return null;
  return Math.hypot(a.grid_x - b.grid_x, a.grid_y - b.grid_y);
}
// HOW FAR IS IT, REALLY — from the mouth of one region's road to the mouth of the other's.
//
// Registered rather than imported. The gate pairing lives in the trucking plugin (it is the same
// `gatePair` the road anchors on, so the room count and the geometry cannot disagree about the
// distance), and trucking already imports THIS module, so importing it back would be a cycle.
// Pushing the capability in the direction the dependency already runs is the way out, and it is the
// same shape as registerZoneReloadHook and registerMinimapNodeFilter.
let _gateDistance = null;
export function registerCrossingDistance(fn) { if (typeof fn === "function") _gateDistance = fn; }

// HOW FAR A CROSSING IS, IN TILES — the road's real length, gate to gate.
//
// Published here rather than read off `gatePair` by each caller because the trucking plugin owns
// the pairing and imports THIS module, so the dependency only runs one way. The room count and the
// distance therefore come from one source, and a caller cannot end up with a length that disagrees
// with the count derived from it.
//
// ⚠ THE STRAIGHT LINE, NOT THE ARC. The built road bends, so its true length is a couple of per
// cent longer than this (282 tiles of gap comes out as a 288-tile road). That gap is deliberately
// not chased: this number exists so a driver can budget a tank, and two per cent is far inside the
// margin they would leave anyway. Reporting the arc would mean building the road to ask.
export function crossingDistance(fromKey, dest) {
  if (_gateDistance && fromKey && dest?.region) {
    const gd = _gateDistance(fromKey, dest.region);
    if (gd > 0) return gd;
  }
  // No pairing available (trucking not loaded, or a far end that publishes no gate): fall back to
  // the room count at the anchored per-room length, which is the same arithmetic one step removed.
  // A room IS a tile, so the room count and the tile distance are the same number now. This used to
  // multiply by ROOM_TILES and the multiplication is the thing that went away.
  return crossingRooms(fromKey, dest);
}

// THE PUBLIC NAME, because two other places were answering this question for themselves.
//
// ⚠ `d.length` WAS BEING READ DIRECTLY IN THREE PLACES — here, and twice in the trucking plugin
// (`destsFor` and `previewRoute`, both `d.length | 0`). That was survivable only while every dest
// carried one; the moment the count became derived, the two readers that did not know about the
// derivation got zero, filtered the destination out, and the approach preview produced a road with
// no segments at all. Which is the good version of that mistake: it failed loudly, in a test, the
// first time it was possible.
//
// So the question has one answer and one place to ask it. A caller that wants a room count asks
// this; nothing outside this module reads `length` again.
export function crossingRooms(fromKey, dest, originZone = null) {
  return totalLength(dest, originZone, getZone(dest?.dest), fromKey);
}

// Total gate→dest room count.
//
// ⚠ ROOM COUNT AND ROAD LENGTH ARE NOW THE SAME NUMBER, WHICH IS THE POINT. They used to be two
// answers to one question: the road was built gate to gate in real tiles while this returned a
// clamped abstraction, and `roomLen` existed to convert between them. A room is a tile, so there is
// nothing left to convert and nothing that can disagree.
//
// `dest.length` still wins. It is now an author's override rather than a workaround, and nothing in
// the table uses one — the derivation reproduces what they were hand-set to.
// ⚠ `window` IS A REAL PARAMETER AND NOT `currentWindow()`. A crossing is re-derived on relog from
// the window it was STARTED in, so reading the live one here would hand somebody reconnecting into
// last week's void a route of a different length — and the room they logged out in would not be on it.
function totalLength(dest, originZone, destZone, fromKey = null, window = currentWindow()) {
  if (dest.length) return dest.length;
  // ⚠ NO DIVISION AND NO CEILING. The distance in tiles IS the room count. The floor is a guard
  // against a degenerate route, not a tuning knob (see MIN_ROOMS).
  const rooms = (n) => Math.max(MIN_ROOMS, Math.round(n));
  // ⚠ THE GATE DISTANCE, AND NOT THE TRAIL'S OWN LENGTH — measured, and the question is now CLOSED.
  // A seam (`registerTrailLength`) sat here unused with a note saying it would become the room count
  // "the day the road earns it". The road has since earned it — the walk IS shorter than the drive —
  // and the answer is still no, for a reason the first note missed: the trail is shorter than the
  // ROAD, never than the straight line between the gates. It is an offset path with swings in to
  // every camp, so the spine runs about 338 tiles where the gates are 282 apart. Making a crossing as
  // long as the walk would make every crossing LONGER. The seam is gone rather than left promising
  // something the evidence has answered.
  if (_gateDistance && fromKey && dest.region) {
    const gd = _gateDistance(fromKey, dest.region);
    if (gd > 0) return rooms(gd);
  }
  // …then the tile you left from, which is what this always used. Kept as a fallback for a
  // crossing whose far end publishes no gate, and it now divides by the same honest constant.
  const d = gridDist(originZone, destZone);
  if (d == null) return DEFAULT_ROOMS;
  return rooms(d);
}

// ── Deterministic generator ───────────────────────────────────────────────────
function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

// ⚠ THE PROSE LIVES IN flavour.js AND IS KEYED BY THE GROUND. Four flat lists used to sit here, and
// the room's name, its description and its terrain were three INDEPENDENT draws off one stream, so
// "Bone Country" could hand you drifting ash. Ten names and eight descriptions was already thin on a
// fifteen-room walk; at one room per tile it is a 93-to-282-room walk and the repetition would be the
// texture of the whole system. See plugins/voidwalking/flavour.js for the tables and the tone rules.

// void_salt is the room's deterministic identity (the seed salt) — ghost-traces
// key on it so a scrawl/corpse pins to the same room across every instance this
// window. lawless: dying out here clone-vats you, never jails you (off-grid waste).
// ⚠ THE GROUND IS ROLLED FIRST AND THEN SPEAKS. Terrain used to be drawn AFTER the name and the
// description off the same stream, which is why they never agreed with each other. Rolling it first
// and handing it to `groundFlavour` makes the three one decision, and means the landform field can
// drive the prose the day it lands by doing nothing but supplying a better terrain.
//
// ⚠ AND THE HIGHLIGHT GETS ITS OWN STREAM. Seeding the feature roll off `|feat` rather than reading
// further down the ground's generator keeps the two independent: retuning FEATURE_CHANCE, or adding a
// kind, must not silently rename and re-surface every room in the world.
function mkRoom(id, voidKey, window, salt, exits, extraFlags = {}, pt = null, wayside = false) {
  const rng = mulberry32(hashSeed(`${voidKey}|${window}|${salt}`));
  const terrain = pick(rng, VOID_TERRAINS);
  const ground = groundFlavour(rng, terrain);
  // ⚠ A WAYSIDE OUTRANKS THE HIGHLIGHT ROLL, because it is not a roll. A highlight is seeded onto a
  // tile; a wayside is the place where the walking route and the road are the same place, which the
  // trail's geometry decides. Letting a rolled wreck sit on top of the camp would put two landmarks
  // on one tile and hide the only water on that stretch behind whichever won.
  const feat = wayside ? null : featureFor(mulberry32(hashSeed(`${voidKey}|${window}|${salt}|feat`)), terrain);
  const camp = wayside
    ? { name: WAYSIDE.name, description: pick(mulberry32(hashSeed(`${voidKey}|${window}|${salt}|camp`)), WAYSIDE.descs) }
    : null;
  return {
    id,
    // The country, then the thing standing on it. A highlight takes the room's NAME because that is
    // what a walker would call the place, and appends to the description rather than replacing it,
    // so the ground underfoot is never contradicted by the landmark on top of it.
    name: camp ? camp.name : (feat ? feat.name : ground.name),
    description: camp ? `${ground.description} ${camp.description}`
      : (feat ? `${ground.description} ${feat.desc}` : ground.description),
    // ⚠ COORDINATES, AND STILL `map_void`. The room is somewhere now, but it is not PLACED ground:
    // `getAllZones()` excludes transient zones by the marker rather than by missing coordinates, so
    // `surfaceAt`, `regionGates` and voidwalking's own rim index never see it — which is what keeps
    // every road mouth and the map rim exactly where they were. See systems-overland-void-travel.md.
    map_id: VOID_MAP,
    grid_x: pt ? Math.round(pt.x) : null,
    grid_y: pt ? Math.round(pt.y) : null,
    grid_z: pt ? 0 : null,
    flags: {
      terrain, void_crossing: true, lawless: true, void_salt: salt,
      // Readers wire off the KIND, never off the name (see flavour.js). `void_feature` is the id and
      // is for traces and debugging; `void_feature_kind` is the mechanical contract.
      ...(feat ? { void_feature: feat.id, void_feature_kind: feat.kind } : {}),
      // ⚠ AND ITS MECHANICS, WHICH ARE ORDINARY ZONE TAGS AND NOTHING NEW. A rad pocket sets
      // `radiation` and the engine's own `getZoneRadiation` charges for it; a spring sets
      // `water_source`. Nothing here teaches the void a mechanic, it borrows the ones the rest of the
      // world already runs on, which is why a highlight is a content row rather than a code change.
      ...(feat?.flags || {}),
      // The camp's barrel and its fire, as the ordinary tags cooking and the rest already read.
      ...(camp ? { ...WAYSIDE.flags, void_wayside: true } : {}),
      ...extraFlags,
    },
    exits,
  };
}
// A detour IS a salvage site, so it draws from the one salvage pool rather than keeping a second
// private list of wreck names that would drift out of step with it.
function mkDetour(id, voidKey, window, salt, spineRoomId, pt = null) {
  const rng = mulberry32(hashSeed(`${voidKey}|${window}|${salt}|d`));
  const terrain = pick(rng, VOID_TERRAINS);
  const pool = FEATURES.filter(f => f.kind === 'salvage' && (!f.terrains || f.terrains.includes(terrain)));
  const feat = pick(rng, pool.length ? pool : FEATURES.filter(f => f.kind === 'salvage'));
  return {
    id, name: feat.name, description: `${groundFlavour(rng, terrain).description} ${feat.desc}`,
    map_id: VOID_MAP,
    grid_x: pt ? Math.round(pt.x) : null,
    grid_y: pt ? Math.round(pt.y) : null,
    grid_z: pt ? 0 : null,
    flags: { terrain, void_crossing: true, void_detour: true, lawless: true, void_salt: `d_${salt}`,
      void_feature: feat.id, void_feature_kind: 'salvage' },
    exits: { east: spineRoomId }, // the only way out is back the way you came in
  };
}

// ── Encounters (Slice 2) ──────────────────────────────────────────────────────
// ⚠ THESE ARE PER TILE NOW, AND THAT IS THE WHOLE OF THE RETUNE. They were per ROOM when a room was
// a twelfth of a leg, so 0.45 meant "most rooms" across a walk of eight. A room is a tile, and 0.45
// across the 282 tiles to Terminus is a hundred and twenty-seven fights: not a gauntlet, a queue.
//
// The shape to preserve was never the per-step odds, it was **how often something happens per mile
// walked**, so the numbers are set from a target spacing instead of scaled blindly. At 0.045 an
// encounter lands roughly every 22 tiles: about 4 crossing to the Reach (93) and about 13 to
// Terminus (282), against 3.6 and 6.7 before. Nearer to the Reach, meaningfully worse to Terminus,
// which is the right direction — the long haul SHOULD be the dangerous one, and under the clamp it
// could not be.
//
// ⚠ DETOUR AND HARD-NODE ODDS ARE DELIBERATELY NOT SCALED. Those are not "a tile you walked over",
// they are a single place you chose to enter or were warned about, and a discrete gamble should read
// the same whatever the crossing's length is. Only the AMBIENT rate is a function of distance.
const ENCOUNTER_CHANCE = 0.045;      // per tile: something every ~22 tiles of open waste
const DETOUR_ENCOUNTER_CHANCE = 0.7; // one room, one gamble, unchanged
const HARD_ENCOUNTER_CHANCE = 0.85;  // a seeded hard node reliably bites
// Hard nodes were ~1 in 5 ROOMS. At 1 in 5 tiles the Terminus run would carry sixty-two of them and
// the marking would stop meaning anything. 0.02 puts about 2 on the Reach hop and 6 on the long haul,
// which keeps "bad ground" rare enough to be worth naming.
const HARD_NODE_CHANCE = 0.02;
// ⚠ THE OTHER HALF OF "FEWER ROOMS, EACH HOTTER". A cut is a real saving in tiles and it is paid for
// per tile: three times the ambient rate is something every ~7 tiles rather than every ~22. It is a
// multiplier and not the hard-node number on purpose — a cut runs for dozens of tiles, and 0.85 on
// each of them would not be a gamble, it would be a sentence.
const CUT_ENCOUNTER_MULT = 3;
// ⚠ AND SOME OF IT SIMPLY WILL NOT LET YOU PAST. A cut goes over what the road went round, which on a
// mesa means a face. This is deliberately NOT a difficulty check you can retry your way through and
// NOT a thing you can buy your way past: it is the engine's own `engine:impassable-terrain` rule, the
// one whose comment says "nothing you can buy, steal or carry opens a cliff, only a body that grew
// wings".
//
// ⚠ THE ROLL IS PER CUT, NOT PER ROOM, AND GETTING THAT WRONG MADE CUTS UNUSABLE. It was 12% per room
// — which reads as "sometimes" and is not: a cut is 25 to 70 rooms long, and 0.88^30 is **2%**. Nearly
// every cut in the game was blocked somewhere, so the shortcut a player weighed up and chose was
// almost always a wasted walk. One roll decides whether THIS cut has a pitch on it at all; a second
// decides where along it the pitch stands, so you still find out by walking to it.
const PITCH_CHANCE = 0.3;      // …of CUTS that carry a pitch somewhere along them
const VOID_FOE_IDS = [
  'enemy_ash_crawler', 'enemy_bloated_mutant', 'enemy_rad_mutant', 'enemy_feral_dog',
  'enemy_wire_jackal', 'enemy_gutter_hound', 'enemy_scav', 'enemy_scrap_picker',
  'enemy_sprawl_ganger', 'enemy_slag_wretch', 'enemy_slag_wight',
  // The one foe out here that has something to do with a truck. `flags.hijacker` is what makes it
  // work the door of a stopped cab (plugins/trucking/hijack.js); to a walker it is an ordinary
  // roadside thug and reads as one, which is the point — the road does not grow a second bestiary
  // for drivers, it grows one enemy who noticed that trucks stop.
  'enemy_prybar_nomad',
];
// The deep-waste menaces — a clear tier above the normal roster (100–130 HP vs a
// 65-HP top-end rad mutant). A hard node fields one of these on top of its pack.
const VOID_HARD_FOE_IDS = ['enemy_arbiterclass_enforcement_unit', 'enemy_redline_horror'];
let FOE_POOL = [];
let HARD_FOE_POOL = [];
let ENCOUNTERS_ON = true; // regress flips this off so movement tests stay deterministic

async function loadFoes() {
  try {
    const { rows } = await query('SELECT * FROM enemies WHERE id = ANY($1)', [[...VOID_FOE_IDS, ...VOID_HARD_FOE_IDS]]);
    const hard = new Set(VOID_HARD_FOE_IDS);
    FOE_POOL = rows.filter(r => !hard.has(r.id));
    HARD_FOE_POOL = rows.filter(r => hard.has(r.id));
  } catch (e) { console.error('[voidwalking] loadFoes:', e.message); }
  return FOE_POOL;
}
// A room is a hard node if its seed says so — deterministic per (void, window, salt),
// so everyone this window meets the same rough stretches (and a scrawl warns the next).
function isHardNode(voidKey, window, salt) {
  return mulberry32(hashSeed(`${voidKey}|${window}|${salt}|hard`))() < HARD_NODE_CHANCE;
}
const ENCOUNTER_LINES = [
  'Something detaches from the haze and comes at you —',
  'A shape you took for a rock uncoils and charges —',
  'Grit scatters as it breaks cover —',
  'You are not alone out here. It was waiting —',
];
const HARD_ENCOUNTER_LINES = [
  'The ground itself seems to give something up —',
  "This is the kind of place people don't walk out of —",
  'Whatever owns this stretch of waste steps into the open —',
];
const MAX_VOID_FOES = 4; // a pack this size is plenty — keeps a big party from a slog
// Scale the pack to the party crossing together: solo/duo → 1, then +1 per pair,
// capped. Sized to the whole crossing, not who's in the room this instant, so
// splitting up costs you the numbers instead of thinning every ambush.
function foesFor(c) {
  return Math.max(1, Math.min(MAX_VOID_FOES, Math.ceil((c.members?.size || 1) / 2)));
}
function spawnFoe(c, roomId) {
  if (!FOE_POOL.length) return null;
  const zone = getZone(roomId);
  if (!zone || zone.enemies.size > 0) return null; // one pack per room — the first arrival spawns it
  const hard = !!zone.flags?.void_hard;
  const n = foesFor(c) + (hard ? 1 : 0); // a hard node pushes the pack one past the cap
  const spawned = [];
  for (let i = 0; i < n; i++) {
    // At a hard node the pack is led by a tougher foe (if the hard roster loaded);
    // the rest are the usual waste vermin.
    const pool = (hard && i === 0 && HARD_FOE_POOL.length) ? HARD_FOE_POOL : FOE_POOL;
    const template = pool[Math.floor(Math.random() * pool.length)];
    const inst = spawnEnemySync(template, roomId);
    c.enemies.add(inst.instanceId);
    spawned.push(inst);
  }
  if (!spawned.length) return null;
  const lines = hard ? HARD_ENCOUNTER_LINES : ENCOUNTER_LINES;
  const line = lines[Math.floor(Math.random() * lines.length)];
  const names = spawned.map(s => `<b>${s.name}</b>`);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  sendToZone(roomId, { type: 'zone_event', message: `${line} ${list}.`, refresh: true });
  return spawned[0];
}
// The dead are your map: show any scrawls/corpses left at this room this window.
function showTraces(actor, c, roomId) {
  const salt = getZone(roomId)?.flags?.void_salt;
  if (!salt) return;
  const trunk = c.plan.trunkLen;   // derived in tiles; see trunkTilesFor
  const lines = [];
  if (bigScoreOpen(c.voidKey, c.window, salt, trunk))
    lines.push("The hulk of a downed gunship dominates this stretch — real salvage in it, if it's still here. <b>(loot)</b>");
  for (const t of getTraces(c.voidKey, c.window, salt)) {
    if (t.kind === 'scrawl') lines.push(`Scratched into the ground, four letters: <b>${t.note}</b>`);
    else if (t.kind === 'corpse') lines.push(`A body half-buried in the dust${t.handle ? ` — what's left of <b>${t.handle}</b>` : ''}${t.note ? `, ${t.note.toLowerCase()}` : ''}.${!t.claimed && packItems(t.pack).length ? ' <b>(loot to strip it)</b>' : ''}`);
  }
  if (lines.length) sendToPlayer(actor.id, { type: 'output', message: lines.join('\n') });
}

function maybeEncounter(actor, c, roomId, chance) {
  if (!ENCOUNTERS_ON) return;
  const live = actor._crossing;
  if (!live) return;
  if (!live.seen) live.seen = new Set();
  if (live.seen.has(roomId)) return; // only the first time you reach a room
  live.seen.add(roomId);
  if (roomId === c.entry) return;    // the threshold room is a beat to breathe
  if (Math.random() >= chance) return;
  spawnFoe(c, roomId);
}

// ── THE PLAN vs THE MATERIALISED WINDOW ──────────────────────────────────────
//
// A crossing used to be built the only way it sensibly could be while it was 5 to 15 rooms long:
// register every room up front and let `roomSet` mean both "the route" and "what exists". At one room
// per TILE a crossing is 93 to 282 rooms and those two meanings come apart, because the entire point
// of windowing is that most of the route has not been made yet.
//
// They are therefore separated FIRST, while nothing observable changes. `plan` is the route as a pure
// function of the seed with nothing registered; `roomSet` is what is currently materialised. Today
// `ensureInstance` materialises the whole plan, so the two are the same set and the suite proves the
// split is a no-op. Windowing then becomes a change to WHEN a room is made, not to what a crossing is.
//
// ⚠ TWO CONSUMERS NEED THE PLAN AND NOT THE WINDOW, AND BOTH WOULD FAIL QUIETLY:
//   • `crossingChain` — THE LONG HAUL maps an odometer reading onto a room across the WHOLE route,
//     including the part nobody has walked to. Reading the window would hand a driver a room id that
//     does not exist and deliver them into nothing.
//   • the relog re-derive — after a restart the room you logged out in is on the route but is not
//     materialised, and `!roomSet.has(roomId)` would silently return everybody to the threshold.
//
// ⚠ AND THE PLAN CARRIES EACH ROOM'S EXITS, rather than them being written as neighbours are built.
// Materialising room N on demand means knowing its exits without having built N-1 or N+1, so the
// wiring has to be a property of the route rather than a side effect of the order it was made in.
// ── WHERE A ROOM IS, IN THE WORLD ────────────────────────────────────────────
//
// A crossing room used to have no position at all: `grid_x: null`, and the walk happened beside the
// map rather than on it. That was the last place the space between regions was still an abstraction,
// and the premise settles it — the trail is a weekly path laid across the same country the road
// crosses, so a room is somewhere, in the same coordinates a truck and an aircraft use.
//
// Registered rather than imported, exactly like `registerCrossingDistance` above and for the same
// reason: the geometry lives in trucking, trucking imports THIS module, and importing back would be
// a cycle. A LIST of odometer readings goes out and a list of points comes back, so the route is
// built once per limb instead of once per room, and `corridorPos` never has to leave trucking.
//
// ⚠ AND IT DEGRADES TO EXACTLY WHAT SHIPPED BEFORE IT. With no provider registered (trucking not
// loaded, or a leg whose road cannot be built) every room keeps a null position and behaves as it
// always did. Coordinates are an enrichment of the crossing, never a requirement of it.
let _crossingPoints = null;
export function registerCrossingPoints(fn) { if (typeof fn === "function") _crossingPoints = fn; }

// THE CUTS BRANCHING OFF THAT SPINE — where each leaves and rejoins, how long it is, and whether it
// is walkable this window. Registered from the same side and for the same reason as the points: the
// geometry lives in trucking, trucking imports this module, and the edge only runs one way.
let _trailCuts = null;
export function registerTrailCuts(fn) { if (typeof fn === "function") _trailCuts = fn; }


// How far off the road's centreline the trail runs, in tiles, and how much further a detour strays.
//
// ⚠ THE TRAIL IS OFF THE TARMAC AND STILL WITHIN REACH OF IT, AND THAT IS THE POINT. The paved band
// is about two tiles wide and the corridor's classified ground runs out to `OFFROAD_R` (24). Seven
// puts a walker clear of the shoulder without putting them out of the world the road belongs to,
// which is what makes the road a LIFELINE rather than scenery: you can see it, a mile board is
// readable when the trail runs close, and a truck can pull over for you. Push the trail past the
// corridor entirely and decision D — that walkers and drivers meet — quietly stops being possible.
//
// A DETOUR is the opposite statement and sits deliberately OUTSIDE the corridor: taking one means
// leaving the road behind, which is the whole of what the gamble costs.

// The trail's SHAPE lives in trucking (plugins/trucking/corridor.js): where it runs, where it
// comes in to the road, and where the camps are, are all properties of a specific ROAD rather than of
// a spacing constant — see campsOf. This plugin asks that geometry where each room stands and whether
// it is a camp (registerCrossingPoints) and holds no copy of the answer.
// The shared stretch before the fork, in tiles, derived from the nearest destination. See
// TRUNK_FRACTION for why the authored room count could not simply be reused.
function trunkTilesFor(voidKey, vdef, originZone, window = currentWindow()) {
  if (vdef.trunk) return Math.max(1, vdef.trunk);        // an authored override, in tiles
  let shortest = Infinity;
  for (const d of vdef.dests) {
    const n = totalLength(d, originZone, getZone(d.dest), voidKey, window);
    if (n < shortest) shortest = n;
  }
  if (!Number.isFinite(shortest)) return TRUNK_MIN;
  return Math.max(TRUNK_MIN, Math.min(TRUNK_MAX, Math.round(shortest * TRUNK_FRACTION)));
}

function planFor(instanceId, voidKey, window, origin, originZone) {
  const vdef = VOIDS[voidKey];
  const rooms = new Map();          // id → { salt, kind, exits, hard, spine? }
  const detourIds = new Set();
  const cutIds = new Set();      // the FIRST room of each cut, for `the way on` prose
  const cutSet = new Set();      // every room on a cut
  const trunkLen = trunkTilesFor(voidKey, vdef, originZone, window);
  const trunkId = (i) => `${instanceId}_t${i}`;
  const limbId = (key, i) => `${instanceId}_${key}${i}`;

  // Shared trunk (linear). t0 exits back to the real origin tile, and is never a hard node: it is a
  // beat to breathe before the country starts charging for it.
  for (let i = 0; i < trunkLen; i++) {
    const exits = { north: i === 0 ? origin : trunkId(i - 1) };
    if (i < trunkLen - 1) exits.south = trunkId(i + 1);   // the fork's forward exits are added below
    rooms.set(trunkId(i), { salt: `t${i}`, kind: 'trunk', exits,
      hard: i >= 1 && isHardNode(voidKey, window, `t${i}`) });
  }
  const trunkRooms = Array.from({ length: trunkLen }, (_, i) => trunkId(i));
  const fork = trunkId(trunkLen - 1);
  const limbs = {};

  // A limb per destination, forking off the last trunk room in that dest's own direction.
  for (const d of vdef.dests) {
    const total = totalLength(d, originZone, getZone(d.dest), voidKey, window);
    const limbLen = Math.max(1, total - trunkLen);
    limbs[d.key] = [];
    for (let i = 0; i < limbLen; i++) {
      const exits = {};
      // The entry room hangs off the fork by the reciprocal of the fork's direction; deeper rooms
      // use north for back and south for on.
      exits[i === 0 ? OPPOSITE[d.dir] : 'north'] = i === 0 ? fork : limbId(d.key, i - 1);
      exits.south = i === limbLen - 1 ? d.dest : limbId(d.key, i + 1);
      const id = limbId(d.key, i);
      rooms.set(id, { salt: `${d.key}${i}`, kind: 'limb', destKey: d.key, exits,
        hard: isHardNode(voidKey, window, `${d.key}${i}`) });
      limbs[d.key].push(id);
    }
    rooms.get(fork).exits[d.dir] = limbId(d.key, 0);      // fork → this limb
  }

  // ── Risk-for-loot detours (a lateral `west` gamble) ─────────────────────────
  //
  // ⚠ INTERIOR ROOMS ONLY, AND THAT IS A COLLISION RULE RATHER THAN TASTE. A detour is attached by
  // writing `exits.west` on its spine room, and a limb's FIRST room already spends one lateral exit
  // on the way back to the fork: `OPPOSITE[d.dir]`, which for an `east` limb IS `west`. A detour hung
  // there would overwrite the only path back and strand the walker in a dead end that reads exactly
  // like a gamble. Interior rooms use north and south only, so `west` is free on every one of them.
  const rollFor = (salt) => mulberry32(hashSeed(`${voidKey}|${window}|${salt}|detour`))();
  const addTo = (salt, spineId) => {
    const id = `${instanceId}_d_${salt}`;
    rooms.set(id, { salt, kind: 'detour', spine: spineId, exits: { east: spineId }, hard: false });
    rooms.get(spineId).exits.west = id;
    detourIds.add(id);
  };

  let trunkDetours = 0;
  for (let i = 1; i < trunkLen - 1; i++) {
    if (rollFor(`t${i}`) < 0.5) { addTo(`t${i}`, trunkId(i)); trunkDetours++; }
  }

  // ⚠ EVERY VOID GETS DETOURS, AND THAT IS A BUG FIX RATHER THAN AN ADDITION. Until 2026-08-21 the
  // trunk loop above was the whole of it, so a detour needed an INTERIOR TRUNK room, and Coldwater's
  // trunk of 4 was the only one in the game that has one. The Reach, Deadwater and the Scarletwastes
  // run a trunk of 2 and Terminus a trunk of 1, so `i = 1; i < trunkLen - 1` never executed for four
  // of the five voids, the `trunkLen >= 3` fallback could not fire for them either, and four fifths
  // of the game's crossings carried no gamble at all with nothing to say so. It was found by charting
  // the generator's output rather than by reading it.
  //
  // The length is in the LIMBS (4 to 14 rooms against a trunk of 1 to 4), so that is where the rest
  // of the gambles live. ⚠ ONE CANDIDATE SLOT PER LIMB, NOT A ROLL PER ROOM: a per-room 0.5 across
  // the eleven-room Terminus limb is five detours, which is not a gamble but a corridor of them.
  //
  // ⚠ AND THE GUARANTEE IS PER ROUTE, NOT PER INSTANCE. The old fallback asked whether the CROSSING
  // had a detour, which off a multi-limb fork means one heading can carry the only gamble in the void
  // while the other two walk dry. A limb whose route has nothing on it takes its slot rather than
  // rolling for it, so no declared heading is ever a detourless walk.
  //
  // A trunk detour is shared by every destination out of this void; a limb detour belongs to one
  // heading. Both are seeded off (void, window, salt) and both are stable for the window. The limb
  // one is simply narrower, and that is the trade taken knowingly.
  for (const d of vdef.dests) {
    const limbLen = limbs[d.key].length;
    if (limbLen < 3) continue;                       // no interior room to hang one off
    const slot = 1 + Math.floor(rollFor(`${d.key}|slot`) * (limbLen - 2));
    if (trunkDetours === 0 || rollFor(`${d.key}|take`) < 0.5) addTo(`${d.key}${slot}`, limbId(d.key, slot));
  }

  // ── Lay the route on the ground ─────────────────────────────────────────────
  //
  // A room's odometer reading is its index along the walk: trunk room i sits at s = i and limb room j
  // at s = trunkLen + j, because a room is a tile. Each request also carries its own lateral offset,
  // so the trail, and a detour swinging further off it, come back from ONE call per limb rather than
  // one per room or one per offset.
  //
  // ⚠ THE TRUNK TAKES ITS POINTS FROM WHICHEVER LIMB ANSWERS FIRST, AND THAT IS SAFE BY INVARIANT.
  // Every road out of a void shares its trunk tile for tile (trucking's own regress asserts it, and
  // `switchLimb` is licensed by it), so the shared stretch is in the same place whichever destination
  // is asked. Asking three times for one answer would be waste, not rigour.
  //
  // ⚠ A DETOUR HAS NO ODOMETER OF ITS OWN. It is not ON the walk, it is a step sideways off it, so it
  // takes its spine's `s` and a wider `t`. That is exactly what a lateral gamble is, and it means a
  // detour is always drawn beside the room it hangs off rather than somewhere along the route.
  if (_crossingPoints) {
    const sOfTrunk = (i) => i;
    const sOfLimb = (j) => trunkLen + j;
    let trunkDone = false;

    for (const d of vdef.dests) {
      const limb = limbs[d.key];
      const reqs = [];                      // [{ id, s, t }]
      if (!trunkDone) {
        for (let i = 0; i < trunkLen; i++) {
          const s = sOfTrunk(i);
          reqs.push({ id: trunkId(i), s });
        }
      }
      for (let j = 0; j < limb.length; j++) {
        const s = sOfLimb(j);
        reqs.push({ id: limb[j], s });
      }
      // Detours hanging off anything in this request set, at the wider offset.
      // A detour has no distance of its own — it is a step sideways off the walk — so it borrows its
      // spine's. Its lateral offset is applied when the room is made rather than asked for here.
      for (const did of detourIds) {
        const r = rooms.get(did);
        const host = reqs.find(q => q.id === r.spine);
        if (host) reqs.push({ id: did, s: host.s });
      }

      let pts = null;
      // ⚠ DISTANCES ALONG THE TRAIL, NOT ALONG THE ROAD. A room's index IS its distance from the
      // origin gate because a room is a tile, and the trail is its own path — shorter than the road,
      // because it cuts over what the road went round. The provider answers where each one stands and
      // whether it is a camp or on a cut; the offset is the trail's own and no longer this file's.
      try { pts = _crossingPoints(voidKey, d, window, reqs.map(q => q.s)); }
      catch { pts = null; }
      // No road on this leg: those rooms stay placeless, which is precisely how every room behaved
      // before coordinates existed. A partial answer is refused rather than half-applied.
      if (!Array.isArray(pts) || pts.length !== reqs.length) continue;

      for (let k = 0; k < reqs.length; k++) {
        const p = pts[k];
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        const room = rooms.get(reqs[k].id);
        if (!room || room.pt) continue;
        room.pt = { x: p.x, y: p.y };
        // ⚠ THE TRAIL SAYS WHICH ROOMS ARE CAMPS AND WHICH ARE ON A CUT, rather than this file
        // recomputing it from a phase. A camp is where the walking route and the road are the same
        // place, which only the geometry knows; asking twice would be two answers to one question.
        if (p.wayside) room.wayside = true;
        if (p.cut) room.cut = true;
      }
      trunkDone = true;
    }
  }

  // ── THE CUTS: A BRANCH THAT REJOINS ─────────────────────────────────────────
  //
  // A detour is a dead end you come back out of. A cut is the other kind of branch: it leaves the
  // spine at one camp and rejoins it at the next, so the room graph stops being a tree. That loop is
  // the whole of decision 2 — the long way round is always there, so being refused on a cut is a loss
  // rather than a dead end, and taking one is a decision rather than something the week decided for
  // you.
  //
  // ⚠ THE SPINE IS STILL A SIMPLE ORDERED LINE, AND IT HAS TO BE. `crossingChain` maps a driver's
  // odometer onto a room, and a driver is on the ROAD — so the chain is the shadow, the cut hangs off
  // it, and nothing about the drive learns that walkers have another way round.
  //
  // ⚠ CUTS LEAVE BY `east`, WHICH IS THE ONLY LATERAL EXIT LEFT. `west` is the detour's and a limb's
  // first room already spends one lateral on the way back to the fork (`OPPOSITE[d.dir]`). A camp that
  // IS a limb's first room therefore gets no cut: overwriting either would strand somebody, and the
  // same trap has now bitten twice in this file.
  if (_trailCuts) {
    for (const d of vdef.dests) {
      const limb = limbs[d.key];
      const spine = [...trunkRooms, ...limb];        // room index === distance along the spine
      let list = [];
      try { list = _trailCuts(voidKey, d, window) || []; } catch { list = []; }
      let n = 0;
      for (const c of list) {
        if (!c.open || !Array.isArray(c.pts) || c.pts.length < 2) continue;
        const i = Math.round(c.fromD), j = Math.round(c.toD);
        const from = spine[i], to = spine[j];
        if (!from || !to || j <= i + 1) continue;
        // A limb's first room keeps its lateral exit for the way back to the fork.
        if (from === limb[0] || rooms.get(from)?.exits?.east) continue;
        const ids = [];
        for (let k = 0; k < c.pts.length - 1; k++) ids.push(`${instanceId}_${d.key}c${n}_${k}`);
        if (!ids.length) continue;
        // One roll for the whole cut, then one for where the face stands on it. See PITCH_CHANCE.
        const cutSalt = `${d.key}c${n}`;
        const hasPitch = mulberry32(hashSeed(`${voidKey}|${window}|${cutSalt}|pitch`))() < PITCH_CHANCE;
        const pitchAt = hasPitch
          ? Math.floor(mulberry32(hashSeed(`${voidKey}|${window}|${cutSalt}|pitchat`))() * ids.length)
          : -1;
        ids.forEach((id, k) => {
          const exits = {};
          exits[k === 0 ? 'west' : 'north'] = k === 0 ? from : ids[k - 1];
          exits.south = k === ids.length - 1 ? to : ids[k + 1];
          rooms.set(id, {
            salt: `${d.key}c${n}_${k}`, kind: 'cut', destKey: d.key, exits,
            hard: isHardNode(voidKey, window, `${d.key}c${n}_${k}`),
            pt: { x: c.pts[k].x, y: c.pts[k].y }, cut: true,
            // ⚠ THE PITCH IS WHAT MAKES A CUT ABLE TO REFUSE YOU, and it is the engine's own rule
            // rather than a new one: `engine:impassable-terrain` already blocks a cliff and already
            // carries the single named exemption, a body that grew wings. Nothing purchasable opens
            // one. Seeded per room, so a cut is not reliably passable OR reliably shut.
            pitch: k === pitchAt,
          });
        });
        rooms.get(from).exits.east = ids[0];
        // ⚠ WHAT IT SAVES IS RECORDED ON THE CAMP, because that is where the decision is made. A cut
        // is the only genuinely new choice in the crossing and it was INVISIBLE: the branch is a real
        // `east` exit so a player could see the word, and nothing anywhere said what was down it or
        // what it was worth. "Save twenty tiles, lose the road" only works as a decision if the twenty
        // is on the table. What is deliberately NOT recorded is whether the cut is passable — you find
        // the face by walking to it.
        rooms.get(from).cutSaves = Math.max(1, Math.round(c.saves));
        rooms.get(from).cutLen = Math.max(1, Math.round(c.len));
        cutIds.add(ids[0]);
        for (const id of ids) cutSet.add(id);
        n++;
      }
    }
  }

  return {
    rooms, detourIds, cutIds, cutSet, limbs, trunkLen, fork,
    trunk: trunkRooms,
    entry: trunkId(0),
    all: new Set(rooms.keys()),
    destSet: new Set(vdef.dests.map(d => d.dest)),
  };
}

// Bring one planned room into existence. Idempotent through registerTransientZone, which preserves
// occupant Sets across a re-register, so re-materialising a room somebody is standing in is safe.
function materialise(c, id) {
  const r = c.plan.rooms.get(id);
  if (!r) return null;
  const z = r.kind === 'detour'
    ? registerTransientZone(mkDetour(id, c.voidKey, c.window, r.salt, r.spine, r.pt))
    : registerTransientZone(mkRoom(id, c.voidKey, c.window, r.salt, { ...r.exits },
        { ...(r.hard ? { void_hard: true } : {}), ...(r.cut ? { void_cut: true } : {}),
          ...(r.pitch ? { void_pitch: true } : {}) }, r.pt, !!r.wayside));
  // ⚠ Exits are re-applied from the PLAN on every materialise rather than trusted from the zone. A
  // room that fell out of the window and came back must not keep a stale copy of a neighbour's id.
  z.exits = { ...r.exits };
  c.roomSet.add(id);
  if (c.plan.detourIds.has(id)) c.detourSet.add(id);
  return z;
}

// ── THE WINDOW: a room exists near somebody, and nowhere else ────────────────
//
// The plan is the route; this is the part of it that is currently made. At 5 to 15 rooms materialising
// everything was free and the distinction was academic. At one room per TILE a crossing is 93 to 282
// rooms per party, and a route that builds itself in full the moment somebody steps off the rim is a
// memory and teardown problem rather than a pacing one. The generator is a pure function of
// (route, window, node), so a room is a LOOKUP and not a build: make the ones near people, drop the
// rest, and the walk is identical either way.
//
// ⚠ RADIUS IS IN HOPS ALONG THE PLAN'S OWN EXITS, not in array indices. A BFS over the exits handles
// the fork, the limbs and the detours without knowing that any of them exist, which is what keeps this
// correct when the shape changes under it. It must stay comfortably above 1: movement resolves against
// a zone that has to already be there, so the window needs a skirt of unvisited rooms ahead of
// whichever way anybody might step next.
const WINDOW_R = 3;

function windowAround(c, roomId, radius) {
  const out = new Set();
  if (!c.plan.rooms.has(roomId)) return out;
  out.add(roomId);
  let frontier = [roomId];
  for (let d = 0; d < radius && frontier.length; d++) {
    const next = [];
    for (const cur of frontier) {
      const r = c.plan.rooms.get(cur);
      if (!r) continue;
      for (const to of Object.values(r.exits)) {
        // An exit that leaves the plan is the origin tile or a destination region: real ground that
        // is somebody else's to make.
        if (!c.plan.rooms.has(to) || out.has(to)) continue;
        out.add(to); next.push(to);
      }
    }
    frontier = next;
  }
  return out;
}

// ⚠ NEVER EVICT A ROOM WITH ANYTHING IN IT. A player is the obvious one and the others are not:
// unregistering a zone holding an enemy leaks the instance (teardown despawns from `c.enemies`, and
// this is not teardown), and a corpse is somebody's loot with a timer on it.
//
// Ground items are deliberately NOT in this test, and that is safe rather than an oversight: an item
// on the floor is a `player_inventory` row owned by `_ground_<zoneId>`, so it lives in the DB and was
// never on the zone object. Room ids are deterministic, so a room that is evicted and later
// re-materialised comes back under the same id with everything anybody left on its floor still there.
function canEvict(id) {
  const z = getZone(id);
  if (!z) return true;
  return z.players.size === 0 && z.enemies.size === 0 && z.npcs.size === 0 && z.corpses.size === 0;
}

// The union of every member's window. Reference counting by hand would need a count per room and a
// decrement on every move; recomputing the union is O(members × radius) against a plan already in
// memory, and it cannot drift.
function refreshWindow(c) {
  const keep = new Set();
  for (const pid of c.members) {
    const p = getLivePlayer(pid);
    const at = p?.current_zone;
    if (!at || !c.plan.rooms.has(at)) continue;
    for (const id of windowAround(c, at, WINDOW_R)) keep.add(id);
  }
  // A crossing with nobody placed yet (it is built before the leader is moved in) still needs its
  // threshold, or there is nowhere to step onto.
  if (!keep.size) for (const id of windowAround(c, c.plan.entry, WINDOW_R)) keep.add(id);

  for (const id of keep) if (!c.roomSet.has(id)) materialise(c, id);
  for (const id of [...c.roomSet]) {
    if (keep.has(id) || !canEvict(id)) continue;
    removeTransientZone(id);
    c.roomSet.delete(id);
    c.detourSet.delete(id);
  }
  return c;
}

// ── Instance generation (trunk → fork → limbs → detours) ──────────────────────
function ensureInstance(instanceId, voidKey, window, origin) {
  let c = crossings.get(instanceId);
  if (c) return c;
  const plan = planFor(instanceId, voidKey, window, origin, getZone(origin));
  c = {
    id: instanceId, voidKey, plan,
    roomSet: new Set(), detourSet: new Set(), destSet: plan.destSet, dests: VOIDS[voidKey].dests,
    entry: plan.entry, origin, window, members: new Set(), enemies: new Set(),
  };
  crossings.set(instanceId, c);
  return refreshWindow(c);
}
function teardownInstance(c) {
  for (const eid of c.enemies) removeEnemyInstance(eid); // despawn spawned foes (no-op if already killed)
  // ⚠ ANNOUNCED BEFORE THE ROOMS GO, not after. A subscriber's whole job is to deal with something
  // it left in one of these rooms, and by the time they are unregistered there is no way to ask
  // what was in them. `origin` rides along because a room that is about to stop existing is no
  // answer to "where should this be put instead" — the tile the crossing set out from is.
  //
  // This is the ONE thing that leaves this plugin, and it is an event rather than a call so the
  // edge stays one-way: voidwalking still imports nothing from trucking (which parks trucks out
  // here), and nothing here knows or cares whether anybody is listening.
  // ⚠ THE WHOLE PLAN, NOT THE WINDOW. A subscriber's job is to deal with what it left out here, and
  // under windowing most of the route is not materialised at any given moment. Handing over the live
  // set would tell a listener that rooms it parked something in never existed, which is exactly the
  // silent break the plan/window split was made to prevent. Only the materialised half is
  // unregistered below, because only the materialised half exists.
  emit('crossing.ended', { instanceId: c.id, rooms: [...c.plan.all], origin: c.origin, voidKey: c.voidKey });
  for (const id of c.roomSet) removeTransientZone(id);   // whatever is currently made
  crossings.delete(c.id);
}
async function clearCrossingFlags(player) {
  // One DELETE for all five crossing_* flags rather than five serial clearFlags.
  // Goes through the flag store's multi-key funnel so a live player's cached Map
  // is invalidated with it — a raw DELETE here would leave them reading as
  // mid-crossing forever.
  await clearFlagsIn(player, ['crossing_void', 'crossing_window', 'crossing_room', 'crossing_origin', 'crossing_instance'])
    .catch(() => {});
}

// ── Entry (shared by the verb and the walk-off-map hook) ──────────────────────
async function enterMember(m, c, entry, origin) {
  removePlayerFromZone(m.id, m.current_zone);
  addPlayerToZone(m.id, entry.id);
  m.current_zone = entry.id;
  refreshWindow(c);   // a member arriving is a new centre for the window
  m._crossing = { instanceId: c.id, seen: new Set([entry.id]) };
  c.members.add(m.id);
  await query('UPDATE players SET current_zone=$1 WHERE id=$2', [entry.id, m.id]).catch(() => {});
  // One upsert for all five crossing_* flags rather than five serial setFlags
  // (mirror of clearCrossingFlags). Goes through the flag store's multi-key
  // funnel so the live player's cached Map moves with the write.
  await setFlags(m, [
    ['crossing_void', c.voidKey],
    ['crossing_window', c.window],
    ['crossing_origin', origin],
    ['crossing_instance', c.id],
    ['crossing_room', entry.id],
  ]).catch(() => {});
}

// The threshold stamp in the message pane — the one line that marks the moment the
// map ends. Printed to every member the instant they step off the edge.
// Ruled rather than boxed on purpose: no glyph has to line up with a closing edge,
// so it can't break in a proportional font or a narrow pane.
const VOID_ENTRY_BANNER = [
  '',
  '────────────────────────────────────────────',
  '◈  E N T E R I N G   T H E   V O I D',
  'no roads · no rescue · no record of you here',
  '────────────────────────────────────────────',
].join('\n');

export async function launchCrossing(leader, gate, broadcast, heading) {
  if (leader._crossing) return { type: 'emote', message: 'You are already out in the waste. The only way through it is through it.' };
  const origin = leader.current_zone;
  const window = currentWindow();
  await discoverRoutes(leader, gate.key); // striking out charts this gate's routes
  await loadWindow(gate.key, window); // warm the ghost-trace cache for this void+window
  const instanceId = `xing_${leader.id}_${++_seq}`;
  const c = ensureInstance(instanceId, gate.key, window, origin);
  const entry = getZone(c.entry);
  const aim = destByHeading(gate.void, heading);

  const followers = getAllLivePlayers().filter(p =>
    p.id !== leader.id && p.following === leader.id && p.current_zone === origin && !p._crossing);
  for (const m of [leader, ...followers]) await enterMember(m, c, entry, origin);

  if (broadcast) broadcast(origin, { type: 'zone_event', message: `${leader.handle}${followers.length ? ' and their party' : ''} walk out past the edge, into the waste.` }, leader.id);
  for (const f of followers) {
    const fdesc = await describeZone(entry, f);
    sendToPlayer(f.id, { type: 'move', message: `${VOID_ENTRY_BANNER}\nYou follow ${leader.handle} out past the edge, into the waste.\n\n${fdesc}`, zone: entry.id, minimap: getMinimapData(entry.id, 8, f) });
  }
  const dests = gate.void.dests.map(d => d.heading).join(' or ');
  const aimLine = aim ? ` You set your heading for ${aim.heading}.` : '';
  // The one place `march` is taught, because it is the one place where the number of tiles ahead of
  // somebody stops being a figure of speech. See plugins/voidwalking/march.js.
  const marchLine = `\n<span class="text-dim">It is a long way on foot. ${teachVerb('march')} to walk it until something needs deciding.</span>`;
  const desc = await describeZone(entry, leader);
  return {
    type: 'move',
    message: `${VOID_ENTRY_BANNER}\nYou strike out into the waste. The edge of the map falls away behind you and the road is gone — only the going. Somewhere ahead it splits toward ${dests}.${aimLine}${marchLine}\n\n${desc}`,
    zone: entry.id,
    minimap: getMinimapData(entry.id, 8, leader),
  };
}

// ── The muster (staging + ready-up) ───────────────────────────────────────────
// `voidwalk` (or walking off the edge) doesn't launch immediately — it opens a
// Tablet-OS staging window: your kit, your party, some lore for the road, and a
// ready-check. Everyone in the cohort must `ready` before the crossing launches.
const stagings = new Map();      // stagingId -> { id, leaderId, gate, heading, members:[pid], ready:Set }
const playerStaging = new Map(); // pid -> stagingId

function stagingLore(vdef) {
  const dests = (vdef?.dests || []).map(d => d.heading).join(' or ') || 'the unknown';
  return `Past the wall the map ends and the waste begins — no roads out here, no rescue, no second chance the Architect will pay for. Between you and ${dests} lies trackless killing ground: it shifts with the wind, it buries its own dead, and it does not forgive the unprepared. Check your water. Check your people. When everyone's set, walk off the edge of the known world — and don't look back for whoever falls.`;
}
async function stagingInventory(pid) {
  const { rows } = await query(
    `SELECT i.name AS name, SUM(pi.quantity)::int AS qty
       FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id = $1 AND pi.container_id IS NULL
      GROUP BY i.name ORDER BY i.name`, [pid]
  ).catch(() => ({ rows: [] }));
  return rows.map(r => ({ name: r.name, qty: r.qty }));
}
async function buildStagingPanel(player, staging) {
  const vdef = VOIDS[staging.gate];
  return {
    type: 'voidwalk_staging',
    region: vdef?.origin || 'the frontier',
    dests: (vdef?.dests || []).map(d => d.heading),
    heading: staging.heading || null,
    lore: stagingLore(vdef),
    inventory: await stagingInventory(player.id),
    party: staging.members.map(id => {
      const p = getLivePlayer(id);
      return { handle: p?.handle || 'someone', ready: staging.ready.has(id), you: id === player.id, leader: id === staging.leaderId };
    }),
    youReady: staging.ready.has(player.id),
    allReady: staging.members.every(id => staging.ready.has(id)),
    solo: staging.members.length === 1,
    // Private party comms — history so a re-open / late render restores the log.
    chat: staging.chat.map(c => ({ handle: c.handle, message: c.message, leader: c.pid === staging.leaderId, you: c.pid === player.id })),
  };
}
// Post a line to the muster's private comms and fan it out to every member.
// Ephemeral: lives on the staging object, evaporates when the muster closes.
function stagingChat(player, text) {
  const staging = stagings.get(playerStaging.get(player.id));
  if (!staging) return { type: 'emote', message: "You're not mustering for anything right now." };
  const message = (text || '').trim().slice(0, 300);
  if (!message) return undefined;
  staging.chat.push({ pid: player.id, handle: player.handle, message });
  if (staging.chat.length > 50) staging.chat.shift();
  const leader = player.id === staging.leaderId;
  for (const id of staging.members)
    sendToPlayer(id, { type: 'voidwalk_staging_chat', line: { handle: player.handle, message, leader, you: id === player.id } });
  return undefined;
}
async function openStaging(leader, gate, heading, broadcast) {
  const followers = getAllLivePlayers().filter(p =>
    p.id !== leader.id && p.following === leader.id && p.current_zone === leader.current_zone && !p._crossing && !playerStaging.has(p.id));
  const members = [leader.id, ...followers.map(p => p.id)];
  const staging = { id: `stg_${leader.id}_${++_seq}`, leaderId: leader.id, gate: gate.key, heading, members, ready: new Set(), chat: [] };
  stagings.set(staging.id, staging);
  for (const id of members) playerStaging.set(id, staging.id);
  for (const f of followers) sendToPlayer(f.id, await buildStagingPanel(f, staging));
  if (followers.length && broadcast) broadcast(leader.current_zone, { type: 'zone_event', message: `${leader.handle} musters a party at the edge, weighing the voidwalk.` }, leader.id);
  return buildStagingPanel(leader, staging);
}
function closeStaging(staging) {
  for (const id of staging.members) { playerStaging.delete(id); sendToPlayer(id, { type: 'voidwalk_staging', close: true }); }
  stagings.delete(staging.id);
}
function cancelStaging(player) {
  const staging = stagings.get(playerStaging.get(player.id));
  if (!staging) return { type: 'emote', message: 'You are not mustering for anything.' };
  closeStaging(staging);
  return { type: 'emote', message: 'You step back from the edge. The waste can wait.' };
}
async function launchFromStaging(staging, broadcast) {
  const leader = getLivePlayer(staging.leaderId);
  closeStaging(staging); // close the overlay for everyone; the move payloads render the void behind it
  if (!leader) return null;
  const gate = { key: staging.gate, void: VOIDS[staging.gate] };
  const leaderPanel = await launchCrossing(leader, gate, broadcast, staging.heading);
  sendToPlayer(leader.id, leaderPanel); // followers were already sent their move payloads inside launchCrossing
  return null;
}
async function cmdReady(args, raw, player, broadcast) {
  const staging = stagings.get(playerStaging.get(player.id));
  if (!staging) return { type: 'emote', message: "You're not mustering for anything right now." };
  staging.ready.add(player.id);
  if (staging.members.every(id => staging.ready.has(id))) return launchFromStaging(staging, broadcast);
  for (const id of staging.members) { const p = getLivePlayer(id); if (p) sendToPlayer(id, await buildStagingPanel(p, staging)); }
  return buildStagingPanel(player, staging);
}

// `voidwalk` is no longer an entry point — the void is entered by walking out of the
// world, not by naming it. The verb stays registered because the staging overlay's
// buttons send `voidwalk cancel` / `voidwalk say <text>` (client/game/js/panels/
// voidwalk-staging.js), and because the bare form is the best place to answer the
// player who has heard of the void and is looking for the command.
async function cmdVoidwalk(args, raw, player, broadcast) {
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'cancel') return cancelStaging(player);
  if (sub === 'say') return stagingChat(player, args.slice(1).join(' '));
  const existing = stagings.get(playerStaging.get(player.id));
  if (existing) return buildStagingPanel(player, existing); // already mustering — re-open the window
  if (player._crossing) return { type: 'emote', message: 'You are already out in the waste. The only way through it is through it.' };
  return { type: 'emote', message: 'There is no word for it that works. Nobody steps into the waste by deciding to — they walk, and keep walking, out past the last street and the last fence and the last anything, until there is no next tile to step into. Then they take that step anyway. <span class="text-dim">(pick a direction and hold it until the world runs out)</span>' };
}

async function onMovementEdge({ player, zone, direction, broadcast }) {
  if (player._crossing || playerStaging.has(player.id)) return undefined;
  // You strike out into the waste ON FOOT. Somebody sitting in a vehicle is not on foot, and a
  // muster overlay opening over a cockpit or a truck cab is nonsense — the vehicle has its own way
  // of leaving the map (THE LONG HAUL drives off the rim through `trucksync`). Expressed in
  // POSTURE rather than by asking any particular plugin, so this stays a law about bodies rather
  // than a list of systems: a move gate can't catch it, because the edge hook fires first,
  // before a direction with no exits ever resolves a target for the gates to inspect.
  if (player.posture === 'driving' || player.posture === 'flying') return undefined;
  if (!isMapRim(zone, direction)) return undefined; // an ordinary wall — let the engine report it
  const gate = voidGateOf(zone);
  if (!gate) return undefined; // rim of a region with no void behind it
  return openStaging(player, gate, null, broadcast); // stepping off the rim opens the muster, not the crossing
}

// ── The Frontier map (Slice 6): fogged discovery of regions + void-routes ─────
// You can't draw the void to scale, so the "map" is an abstract topology: origin
// regions, and the routes you've CHARTED (seen a gate) or SURVIVED (crossed). Fogged
// — what you haven't seen isn't on it. Stored per-player in a `frontier_log` flag
// (JSON routeId → state), written only on discovery/arrival (rare).
async function getFrontierLog(player) {
  try { return JSON.parse((await getFlag('player', 'frontier_log', player)) || '{}'); } catch { return {}; }
}
async function setFrontierState(player, routeId, state) {
  const log = await getFrontierLog(player);
  // never downgrade survived → charted
  if (log[routeId] === 'survived' && state !== 'survived') return;
  if (log[routeId] === state) return;
  log[routeId] = state;
  await setFlag('player', 'frontier_log', JSON.stringify(log), player).catch(() => {});
}
async function discoverRoutes(player, voidKey) {
  for (const d of VOIDS[voidKey].dests) await setFrontierState(player, `${voidKey}:${d.key}`, 'charted');
}
function markSurvived(player, voidKey, destKey) { return setFrontierState(player, `${voidKey}:${destKey}`, 'survived'); }

// The map data the Tablet Frontier app renders: origin regions → the routes you know.
export async function frontierView(player) {
  const log = await getFrontierLog(player);
  const regions = {};
  for (const [voidKey, vdef] of Object.entries(VOIDS)) {
    for (const d of vdef.dests) {
      const state = log[`${voidKey}:${d.key}`];
      if (!state) continue; // fogged — you haven't seen this route
      (regions[vdef.origin || 'the frontier'] ??= []).push({ heading: d.heading, state });
    }
  }
  return regions;
}

// `frontier` — read the signpost at a gate: where can you strike out to from here.
async function cmdFrontier(args, raw, player, broadcast) {
  const gate = voidGateOf(getZone(player.current_zone));
  if (!gate) return { type: 'emote', message: 'You see no way to strike out into the waste from here — this is not a frontier region. (Your charted routes are on the Tablet Frontier map.)' };
  await discoverRoutes(player, gate.key);
  const dests = gate.void.dests.map(d => `<b>${d.heading}</b>`).join(', ');
  return { type: 'output', message: `You read the waste from the edge. Somewhere out there, past the wind, the trail splits toward: ${dests}. (voidwalk, or just walk off the edge — and pray the fork reads true.)` };
}

// ── `scrawl` — leave a four-letter mark for whoever comes next ─────────────────
async function cmdScrawl(args, raw, player, broadcast) {
  const live = player._crossing;
  const c = live && crossings.get(live.instanceId);
  if (!c) return { type: 'emote', message: 'There is nothing out here worth marking. (Scrawls are for the waste — you leave them for whoever comes after.)' };
  const text = args.join('').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  if (!text) return { type: 'error', message: 'Scrawl what? Four letters, max — a warning, a curse, a name. (scrawl RUN)' };
  const salt = getZone(player.current_zone)?.flags?.void_salt;
  if (!salt) return { type: 'emote', message: "The ground here won't hold a mark." };
  await addTrace(c.voidKey, c.window, salt, 'scrawl', player.handle, text);
  if (broadcast) broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} scratches something into the ground.` }, player.id);
  return { type: 'emote', message: `You scratch <b>${text}</b> into the hardpan. Whoever crosses here this window will find it — until the wind takes it.` };
}

// ── Reference-counted leave (arrived / bailed / died / tp'd) ──────────────────
function leaveCrossing(member, zone) {
  const live = member._crossing;
  delete member._crossing;
  clearCrossingFlags(member).catch(() => {});
  const c = live && crossings.get(live.instanceId);
  if (!c) return;
  c.members.delete(member.id);
  const dest = c.dests.find(d => d.dest === zone); // arrived at a region?
  if (dest) {
    sendToPlayer(member.id, { type: 'output', message: `<span class="item-grant">You stagger up out of the waste onto solid ground — <b>${dest.heading}</b>. You crossed it on foot.</span>` });
    markSurvived(member, c.voidKey, dest.key).catch(() => {}); // the route joins your charted frontier
    // The one thing the city ever hears about a crossing. An EVENT rather than a call, for the same
    // reason `crossing.ended` is one: the void must not import a news desk, and nothing out here
    // knows or cares who is listening.
    // ⚠ THE HUMAN NAMES RIDE ON THE PAYLOAD. A subscriber that read `origin` off VOIDS would have to
    // import this plugin to do it, which is exactly the edge this shape exists to keep one-way.
    emit('void.crossed', {
      handle: member.handle, voidKey: c.voidKey, origin: VOIDS[c.voidKey]?.origin || null,
      heading: dest.heading, tiles: live?.seen?.size || 0,
    });
  }
  if (c.members.size === 0) teardownInstance(c);
}

// ── Forward is earned: a live foe out here blocks the way on ──────────────────
// Encounters aren't optional in the void — you can't stroll past what's stalking you.
// While an enemy stands in your room, the forward exit (`south`, "deeper", the design's
// one advancing direction) is sealed; you can still retreat (`north`) or take a detour.
// Clear the foe (kill it, or it flees) and the way opens.
// ── THE PITCH: A CUT THAT WILL NOT LET YOU PAST ──────────────────────────────
// The way on goes up a face. ⚠ This is the ENGINE's rule rather than a second one: the same single
// named exemption `engine:impassable-terrain` carries — a body that grew wings — and nothing you can
// buy, steal or carry opens it. You lose the water it took to get here and you take the long way,
// which the spine has never stopped being.
registerMoveGate(({ player, from, direction }) => {
  if (direction !== 'south') return;
  if (!from?.flags?.void_pitch) return;
  if (mutationFlag(player, 'flight')) return;
  return { block: true, message:
    'The ground goes up sheer in front of you, and keeps going. There is no way up it with what you have on you.'
    + '\n<span class="text-dim">Back the way you came, and round the long side.</span>' };
}, 'voidwalking:pitch');

registerMoveGate(({ player, from, direction }) => {
  if (!player?._crossing) return;
  if (!from?.flags?.void_crossing) return;
  if (direction !== 'south') return; // only the advancing exit is barred; retreat/detour stay open
  if (getZoneEnemies(from.id).length === 0) return;
  return { block: true, message: 'It plants itself between you and the way on — no getting past it until it is down.' };
}, 'voidwalking');

// ── Node tracking + teardown + encounters (every move) ────────────────────────
// `mounted` is set by anything carrying the actor through the void under its own power — today that
// is a rig on the road (plugins/trucking, crossToNode). A passenger sees the country and the traces
// left in it, and is not exposed to what lives there.
on('zone.entered', ({ actor, zone, mounted }) => {
  try {
    const live = actor?._crossing;
    if (!live) return;
    const c = crossings.get(live.instanceId);
    if (!c) { delete actor._crossing; return; }
    if (c.roomSet.has(zone)) { // a crossing room (trunk / limb / detour)
      // Every step moves the window: make what is now within reach, drop what is now behind. This is
      // the ONLY place the window advances during a walk, and it must run before anything that can
      // block or divert, or a player can be standing one step from a room that was never made.
      refreshWindow(c);
      showTraces(actor, c, zone);   // what happened here is visible from a cab too
      if (!mounted) {
        const f = getZone(zone)?.flags;
        // ⚠ A CUT IS FEWER TILES AND EVERY ONE OF THEM ROLLS HOT. That is the whole trade and it is
        // deliberately a MULTIPLIER on the ambient rate rather than the hard-node number: a cut is a
        // long stretch, and 0.85 per tile across sixty of them is not a gamble, it is an execution.
        // At CUT_ENCOUNTER_MULT something lands every ~7 tiles out there against ~22 on the road,
        // so the shortcut saves you distance and spends it back in blood.
        const chance = f?.void_hard ? HARD_ENCOUNTER_CHANCE
          : c.detourSet.has(zone) ? DETOUR_ENCOUNTER_CHANCE
          : f?.void_cut ? Math.min(0.9, ENCOUNTER_CHANCE * CUT_ENCOUNTER_MULT)
          : ENCOUNTER_CHANCE;
        maybeEncounter(actor, c, zone, chance);
      }
      return; // crossing_room is RAM (player.current_zone); flushed lazily on logout, not per step
    }
    leaveCrossing(actor, zone); // left the void (arrived at a region, or bailed)
  } catch (e) { console.error('[voidwalking] zone.entered error:', e.message); }
});

// ── RAM reclaim on a clean disconnect (crossing_room already persisted per move) ─
on('player.logout', ({ id }) => {
  try {
    const staging = stagings.get(playerStaging.get(id)); // dropping out of a muster cancels it
    if (staging) closeStaging(staging);
    const player = getLivePlayer(id);
    const live = player?._crossing;
    if (!live) return;
    setFlag('player', 'crossing_room', player.current_zone, player).catch(() => {}); // lazy flush for restart-relog
    const c = crossings.get(live.instanceId);
    delete player._crossing;
    if (c) { c.members.delete(id); if (c.members.size === 0) teardownInstance(c); }
  } catch (e) { console.error('[voidwalking] player.logout error:', e.message); }
});

// ── `salvage` — scavenge a room (Slice 5) ─────────────────────────────────────
// Reuses the Scavenging skill + the 2d8−2d8 check. The waste's loot is generated in
// RAM (no DB scavenge tables — the rooms are transient): a room offers a richness
// tier (detours richer than the spine), and your Scavenging skill decides whether
// you reach the good stuff. Survival staples (water/rations) up top so scavenging
// literally extends your range; salvage/rare deeper. Once per room per crossing.
// Salvage tiers. Entries are `[itemId, maxQty]` — the quantity rolls 1..maxQty, so
// the stackable staples and bulk materials sometimes come up as an actual haul
// instead of a single sad wire.
//
// Deliberately wide (2026-07-21). The first cut was 4/4/3 items with `item_scrap_metal`
// on tier 1 — an item vendors buy for ₵0 — so the reward for crossing a place that
// spawns enemy packs and eats your corpse was frequently nothing at all, and when it
// wasn't, it was the same roadside junk you can scavenge free at the spawn tile.
// The top end is unchanged; this widens the small/medium band, which is where a
// crossing's felt value lives.
const LOOT = {
  // The waste's leavings — small, but a body could live on it.
  1: { diff: 4, items: [
    ['item_water_bottle', 2], ['item_ration', 2], ['item_bar_jerky', 2], ['item_rag_bandage', 2],
    ['item_tangled_wire', 3], ['item_ball_bearings', 2], ['item_salvaged_wadding', 3],
    ['item_steel_plate', 2], ['item_rusty_pipe', 1], ['item_mutated_bone', 2], ['item_duct_tape', 1],
  ] },
  // Proper salvage — worth the weight out, worth real credits back.
  2: { diff: 8, items: [
    ['item_battery', 2], ['item_bandage', 2], ['item_copper_bundle', 2], ['item_scrap_ore', 3],
    ['item_slag_glass', 2], ['item_salvaged_wiring', 3], ['item_depleted_battery', 2],
    ['item_cracked_circuit', 1], ['item_glowing_scrap', 2], ['item_industrial_tape', 1],
    ['item_catalyst_pellets', 1], ['item_pressure_gauge', 1], ['item_valve_assembly', 1],
    ['item_pain_pills', 1], ['item_scrap_shiv', 1], ['item_control_relay', 1],
    ['item_field_splint', 1], ['item_scrap_helmet', 1], ['item_rad_band', 1], ['item_gun_oil_kit', 1],
  ] },
  // What people actually cross for. Kept DELIBERATELY narrow and high — widening this
  // tier with ₵20-ish odds and ends would dilute the scrap-pistol roll, i.e. quietly
  // nerf the payoff for the hardest check while appearing to add rewards.
  3: { diff: 12, items: [
    ['item_scrap_pistol', 1], ['item_buried_strongbox', 1], ['item_mystery_component', 1],
    ['item_copper_nodule', 2], ['item_rad_pills', 2], ['item_busted_datapad', 1],
  ] },
};
// A dig this close still turns something up. The waste is generous with rubbish and
// stingy with everything else, and a flat miss is a dead 3.5s in a room that can kill you.
const NEAR_MISS = -4;
const rollEntry = (t) => t.items[Math.floor(Math.random() * t.items.length)];
const rollQty = (maxQty = 1) => 1 + Math.floor(Math.random() * maxQty);
let SALVAGE_FORCE = null; // regress override: null → real roll, 0/1 → forced fail/success
function roll2d8() { return Math.floor(Math.random() * 8) + 1 + Math.floor(Math.random() * 8) + 1; }
function packItems(pack) {
  if (Array.isArray(pack)) return pack;
  if (typeof pack === 'string') { try { return JSON.parse(pack) || []; } catch { return []; } }
  return pack || [];
}

// The weekly "big score" (Slice 5b): one telegraphed prize per (void, window), at a
// seeded shared-trunk room, kept globally scarce by a claim trace — first crosser to
// loot it takes it (the async race). Everyone this window sees the same wreck at the
// same room; whoever gets there first wins.
const BIGSCORE_POOL = ['item_scrap_pistol', 'item_mystery_component', 'item_glowing_scrap'];
function bigScoreSalt(voidKey, window, trunk) {
  const span = Math.max(1, trunk - 2);
  return `t${1 + (hashSeed(`${voidKey}|${window}|bigscore`) % span)}`;
}
function bigScoreItem(voidKey, window) {
  return pick(mulberry32(hashSeed(`${voidKey}|${window}|bigscore_item`)), BIGSCORE_POOL);
}
function bigScoreOpen(voidKey, window, salt, trunk) {
  return salt === bigScoreSalt(voidKey, window, trunk) && !getTraces(voidKey, window, salt).some(t => t.kind === 'bigscore_claim');
}

async function grantItem(playerId, itemId, qty = 1) {
  await query('INSERT INTO player_inventory (id, player_id, item_id, quantity, condition) VALUES ($1,$2,$3,$4,1.0)', [randomUUID(), playerId, itemId, qty]).catch(() => {});
  const name = getItem(itemId)?.name || 'a piece of salvage'; // name lives in the RAM items cache — no need to re-query per grant
  return qty > 1 ? `${qty}× ${name}` : name;
}

// The engine's spawnPlayerCorpse already stripped the dead's gear into a
// player_corpses row at the death room — but that room tears down and orphans it.
// Capture the carried item ids, delete the orphaned corpse, and re-home the pack
// onto the shared void trace so another crosser (in their own instance) can loot it.
async function captureCorpsePack(playerId, deathZone) {
  try {
    const { rows: cr } = await query('SELECT id FROM player_corpses WHERE player_id=$1 AND zone_id=$2 ORDER BY created_at DESC LIMIT 1', [playerId, deathZone]);
    const corpseId = cr?.[0]?.id;
    if (!corpseId) return [];
    const { rows: items } = await query("SELECT item_id FROM player_inventory WHERE player_id=$1 AND item_id <> 'item_credit_chip' LIMIT 24", [corpseId]);
    const ids = items.map(r => r.item_id);
    await query('DELETE FROM player_inventory WHERE player_id=$1', [corpseId]).catch(() => {});
    await query('DELETE FROM player_corpses WHERE id=$1', [corpseId]).catch(() => {});
    return ids;
  } catch (e) { console.error('[voidwalking] captureCorpsePack:', e.message); return []; }
}

async function cmdLoot(args, raw, player, broadcast) {
  const live = player._crossing;
  const c = live && crossings.get(live.instanceId);
  // `loot` is the engine's corpse-looting verb. Only bare `loot` mid-crossing is
  // void salvage; anything else falls through so corpse looting still works.
  if (!c || args.length) return undefined;
  const roomId = player.current_zone;
  const salt = getZone(roomId)?.flags?.void_salt;
  if (!salt) return { type: 'emote', message: 'Nothing here but dust and wind.' };
  const trunk = c.plan.trunkLen;   // derived in tiles; see trunkTilesFor

  // 1. The weekly big score, first-come and gone (the async claim race).
  if (bigScoreOpen(c.voidKey, c.window, salt, trunk)) {
    const name = await grantItem(player.id, bigScoreItem(c.voidKey, c.window));
    await addTrace(c.voidKey, c.window, salt, 'bigscore_claim', player.handle, name);
    // "Word will spread" is a promise the line has been making since it shipped, and until this
    // event nothing kept it: the claim was written where only another crosser standing on the same
    // tile could ever fail to find it. The news desk is what makes it true in the city.
    emit('void.bigscore', {
      handle: player.handle, voidKey: c.voidKey, origin: VOIDS[c.voidKey]?.origin || null, item: name,
    });
    return { type: 'emote', message: `<span class="item-grant">You haul <b>${name}</b> out of the wreck — the prize this stretch of waste was hiding. It's gone now; word will spread.</span>` };
  }

  // 2. Strip the dead — a corpse-pack, first-come.
  const corpse = getTraces(c.voidKey, c.window, salt).find(t => t.kind === 'corpse' && !t.claimed && packItems(t.pack).length);
  if (corpse) {
    await claimTrace(corpse);
    const names = [];
    for (const itemId of packItems(corpse.pack)) names.push(await grantItem(player.id, itemId));
    return { type: 'emote', message: `<span class="item-grant">You strip what the waste left of ${corpse.handle || 'the dead'} — ${names.join(', ')}.</span>` };
  }

  // 3. Ambient scavenging (once per room).
  if (!live.scavenged) live.scavenged = new Set();
  if (live.scavenged.has(roomId)) return { type: 'emote', message: "You've already picked this spot clean." };
  live.scavenged.add(roomId);

  const isDetour = c.detourSet.has(roomId);
  const tiers = isDetour ? [2, 3] : [1, 2];       // detours hide the better hauls
  const tier = tiers[Math.floor(Math.random() * tiers.length)];
  const table = LOOT[tier];
  const [itemId, maxQty] = rollEntry(table);

  const effective = await effectiveSkill(player, 'scavenging');
  const margin = (effective - table.diff) + (roll2d8() - roll2d8());
  await awardSkillUse(player.id, 'scavenging', margin).catch(() => {}); // a near-miss still trains you
  const forced = SALVAGE_FORCE != null;                                // regress override: a hard pass/fail, no consolation
  const success = forced ? !!SALVAGE_FORCE : margin >= 0;
  if (!success) {
    if (!forced && margin >= NEAR_MISS) {
      const [scrapId, scrapMax] = rollEntry(LOOT[1]);
      const scrap = await grantItem(player.id, scrapId, rollQty(scrapMax));
      return { type: 'emote', message: `<span class="item-grant">Nothing in here worth the name — but you turn up ${scrap} on your way back out.</span>` };
    }
    return { type: 'emote', message: `You dig through the ${isDetour ? 'wreckage' : 'dust'} and come up with nothing but grit and disappointment.` };
  }

  const name = await grantItem(player.id, itemId, rollQty(maxQty));
  return { type: 'emote', message: `<span class="item-grant">You dig ${name} out of the ${isDetour ? 'wreck' : 'waste'} and pocket it.</span>` };
}

// ── Death in the void: leave a corpse trace + clean up the crossing ───────────
// Respawn is an in-memory move (gameLoop), NOT a cmdMove, so zone.entered never
// fires on death — this is where a void crossing gets torn down. deathZone is still
// the void room here (teardown runs after), so its void_salt is available.
async function onVoidDeath({ player, deathZone, cause }) {
  try {
    const live = player?._crossing;
    if (!live) return;
    const c = crossings.get(live.instanceId);
    const salt = getZone(deathZone)?.flags?.void_salt;
    if (c && salt) {
      const pack = await captureCorpsePack(player.id, deathZone);
      await addTrace(c.voidKey, c.window, salt, 'corpse', player.handle, (cause?.label || 'killed by the waste').slice(0, 40), pack.length ? pack : null);
      emit('void.died', {
        handle: player.handle, voidKey: c.voidKey, origin: VOIDS[c.voidKey]?.origin || null,
        cause: cause?.label || null, pack: pack.length,
      });
    }
    delete player._crossing;
    clearCrossingFlags(player).catch(() => {});
    if (c) { c.members.delete(player.id); if (c.members.size === 0) teardownInstance(c); }
  } catch (e) { console.error('[voidwalking] player.death error:', e.message); }
}
on('player.death', onVoidDeath);

// ── Relog re-derivation (after a server restart wiped the RAM rooms) ──────────
on('player.login', async ({ id }) => {
  try {
    const player = getLivePlayer(id);
    if (!player) return;
    const voidKey = await getFlag('player', 'crossing_void', player);
    if (!voidKey) return;
    const instanceId = await getFlag('player', 'crossing_instance', player);
    if (!VOIDS[voidKey] || !instanceId) { await clearCrossingFlags(player); return; }
    const window = Number(await getFlag('player', 'crossing_window', player)) || currentWindow();
    const origin = (await getFlag('player', 'crossing_origin', player)) || null;
    await loadWindow(voidKey, window);

    const c = ensureInstance(instanceId, voidKey, window, origin);
    let roomId = await getFlag('player', 'crossing_room', player);
    // ⚠ AGAINST THE PLAN, NOT THE WINDOW. The room you logged out in is on the route but need not be
    // materialised yet, and testing `roomSet` would quietly return every reconnecting walker to the
    // threshold room having thrown away the crossing they had already walked.
    if (!c.plan.all.has(roomId)) roomId = c.entry;
    const room = materialise(c, roomId) || getZone(roomId);

    removePlayerFromZone(player.id, player.current_zone);
    addPlayerToZone(player.id, room.id);
    player.current_zone = room.id;
    player._crossing = { instanceId, seen: new Set([room.id]) };
    c.members.add(player.id);
    refreshWindow(c);   // the window follows whoever just reconnected into it
    await query('UPDATE players SET current_zone=$1 WHERE id=$2', [room.id, player.id]).catch(() => {});

    const desc = await describeZone(room, player);
    sendToPlayer(player.id, {
      type: 'move',
      message: `You come to in the middle of the waste, right where you left off. The crossing goes on.\n\n${desc}`,
      zone: room.id,
      minimap: getMinimapData(room.id, 8, player),
    });
  } catch (e) { console.error('[voidwalking] player.login error:', e.message); }
});

// ── `camp` — the risky rest site ─────────────────────────────────────────────
//
// ⚠ THE VERB IS `camp` BECAUSE `rest` IS AN ENGINE ALIAS FOR `sleep`, and that is a FOURTH way a verb
// can be taken that the psionics note does not list. Checking plugin manifests, engine builtins and
// specialized actions all came back clean; `server/engine/commands/aliases.js` maps `rest → sleep`
// and the dispatcher resolves aliases BEFORE it looks a plugin up, so the handler below was never
// reached and the player got "it's not safe enough to sleep here" from a system that had never heard
// of the void. Check the alias table too.
//
// The relief half of the crossing, and the reason a hot spring or a camp firepit is worth walking to
// rather than just worth reading. Nothing out here heals you: the engine's only passive HP regen is
// `healOverTime` and `wellFedUntil`, and neither fires on its own in a waste room. So a respite site
// GRANTS one rather than the void suppressing anything, which is the same answer arrived at from the
// other side and one fewer moving part.
//
// ⚠ IT IS PAID FOR IN WATER, AND THAT IS THE WHOLE DESIGN OF IT. Recovery out here is a gamble you
// choose, never a given: sitting still in the heat costs you the thing the crossing is actually a race
// against. The gap has real temperature now (the weather interpolation), so a rest on the hot leg to
// Terminus costs more in practice than one on the way to Deadwater without anything here saying so.
//
// ⚠ AND IT ROLLS FOR AN AMBUSH, ON THE ROOM'S OWN ODDS. A camp is not a safe room — the void stays
// `lawless`, a resting body is a body — so this goes through the ordinary encounter path rather than
// inventing a second one. The roll happens BEFORE the heal is granted, so being jumped means you got
// nothing for the water.
const REST_THIRST = 12;        // what an hour off your feet costs you in the heat
const REST_HEAL_TICKS = 10;    // …and how long the recovery runs for afterwards
const REST_HEAL_PER_TICK = 3;

async function cmdRest(args, raw, player) {
  const live = player._crossing;
  const c = live && crossings.get(live.instanceId);
  if (!c) return undefined;   // not in the void: the word is free for anything else that wants it
  const z = getZone(player.current_zone);
  const kind = z?.flags?.void_feature_kind;
  const ok = z?.flags?.void_wayside || kind === 'respite' || kind === 'shelter';
  if (!ok) return { type: 'error', message: 'There is nowhere here to get off your feet that is any better than where you are standing.' };

  if (getZoneEnemies(z.id).length)
    return { type: 'error', message: 'Not with that still standing there.' };
  if ((player.thirst ?? 100) <= REST_THIRST)
    return { type: 'error', message: 'You are too far gone for that. Sitting still without water is just a slower way of doing the same thing.' };
  if (player.hp >= player.hp_max && !(player.healOverTime?.length))
    return { type: 'emote', message: 'You sit for a while. There is nothing about you that needs mending.' };

  player.thirst = Math.max(0, (player.thirst ?? 100) - REST_THIRST);

  // The ambush, on this room's own odds — a camp is quieter than open ground and a detour is not.
  const chance = z.flags?.void_hard ? HARD_ENCOUNTER_CHANCE
    : c.detourSet.has(z.id) ? DETOUR_ENCOUNTER_CHANCE
    : z.flags?.void_cut ? Math.min(0.9, ENCOUNTER_CHANCE * CUT_ENCOUNTER_MULT)
    : ENCOUNTER_CHANCE;
  // ⚠ Deliberately NOT `maybeEncounter`: that one fires once per room for ever (`seen`), which is
  // right for walking into a place and wrong for choosing to stay in it. Resting is a fresh risk
  // every time you do it, which is what stops a cleared room becoming a free hotel.
  if (ENCOUNTERS_ON && Math.random() < chance * 2) {
    spawnFoe(c, z.id);
    return { type: 'emote', message: '<span class="text-amber">You get your boots off and your back against something, and that is exactly how far you get.</span>' };
  }

  player.healOverTime = player.healOverTime || [];
  player.healOverTime.push({ perTick: REST_HEAL_PER_TICK, ticksRemaining: REST_HEAL_TICKS });
  const warm = z.flags?.stove_tier ? ' The fire does most of the work.' : '';
  const wet = z.flags?.water_source ? ' You drink, and refill, and drink again.' : '';
  return { type: 'emote', message:
    `<span class="text-green">You stop. Boots off, back against something solid, and for a while the country is just weather.</span>${warm}${wet}`
    + '\n<span class="text-dim">You will feel it mending for a while yet. It cost you water you are not getting back out here.</span>' };
}

// ── FLAGGING A TRUCK DOWN ────────────────────────────────────────────────────
//
// The social half of the crossing. A truck can carry people (`ride`/`hop` in the trucking plugin), so
// the only thing missing was a way for a walker out in the waste to ASK — and for a driver to know
// somebody is asking before they have already gone past.
//
// ⚠ A BEACON HAS A LIFETIME; IT IS NOT A STATE YOU SIT IN. A permanent flag turns every wayside into
// a taxi rank and every driver's HUD into a list of them. It expires, and putting your arm out again
// costs the time it costs.
//
// ⚠ AND YOU CAN ONLY DO IT AT A CAMP, which is not an arbitrary gate: a wayside is the place where
// the walking route and the road are the same place (`campsOf` in trucking), so it is the only ground where
// a rig CAN stop for you. Flagging from the middle of a cut would be asking a truck to leave the road
// and come and find you.
//
// ⚠ RAM-ONLY AND DELIBERATELY SO. A beacon is worth exactly as long as somebody is standing there;
// a logout, a crash or a restart should clear it, and nothing about it is worth a row.
const BEACON_MS = 4 * 60 * 1000;      // how long an arm stays out
const BEACON_RECHARGE_MS = 45 * 1000; // and how long before you can put it out again
const beacons = new Map();            // playerId → { until, x, y, zoneId, handle, at }

// Every beacon still burning. Prunes as it goes, which is the only expiry this needs: nothing ticks.
export function activeBeacons(now = Date.now()) {
  const out = [];
  for (const [id, b] of beacons) {
    if (b.until <= now) { beacons.delete(id); continue; }
    out.push({ playerId: id, ...b });
  }
  return out;
}

// The ones a driver at (x, y) could plausibly stop for. Distance is the whole test — two people in
// the same gap are in DIFFERENT transient rooms (a crossing is instanced), so "the same place" out
// here is a coordinate and can never be a zone id.
export function beaconsNear(x, y, radius, now = Date.now()) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
  return activeBeacons(now)
    .map(b => ({ ...b, dist: Math.hypot(b.x - x, b.y - y) }))
    .filter(b => b.dist <= radius)
    .sort((a, b) => a.dist - b.dist);
}

export function clearBeacon(playerId) { beacons.delete(playerId); }

async function cmdFlag(args, raw, player) {
  const live = player._crossing;
  const c = live && crossings.get(live.instanceId);
  if (!c) return { type: 'error', message: 'There is no road out here to flag anything down on.' };
  const z = getZone(player.current_zone);
  if (!z?.flags?.void_wayside)
    return { type: 'error', message: 'Nothing comes past here. You would have to be at a camp on the road for that.' };
  if (z.grid_x == null || z.grid_y == null)
    return { type: 'error', message: 'You cannot tell where the road is from here.' };

  const now = Date.now();
  const prev = beacons.get(player.id);
  if (prev && prev.until > now)
    return { type: 'emote', message: 'You are already standing where they can see you, arm out.' };
  if (prev && now - prev.at < BEACON_RECHARGE_MS)
    return { type: 'emote', message: 'You just did that. Give it a minute and try again.' };

  beacons.set(player.id, {
    until: now + BEACON_MS, at: now, x: z.grid_x, y: z.grid_y, zoneId: z.id, handle: player.handle,
  });
  return { type: 'emote', message: '<span class="text-green">You walk out to the edge of the tarmac and put your arm out, and then there is nothing to do but stand there and be seen.</span>'
    + '\n<span class="text-dim">Anything coming down this road will know you are here for a while. Whether it stops is somebody else\'s decision.</span>' };
}

// ── Public surface for other systems ─────────────────────────────────────────
// A crossing is walked room-by-room, so nothing here ever needed to know the ORDER of the chain —
// you just took the exit in front of you. Driving it does: THE LONG HAUL (plugins/trucking) turns
// an odometer reading into "which room am I standing in", which means it needs the spine as an
// ordered list. It is exported here rather than reconstructed there, because reconstructing it
// means copying this file's room-id naming, and the day that naming changes the truck would
// silently deliver people to rooms that no longer exist.
//
// Returns the trunk followed by one destination's limb: index 0 is the threshold room, the last
// index is the room whose `south` exit is the destination region itself.
// ⚠ THIS READS THE PLAN, NEVER THE MATERIALISED SET. It used to walk `roomSet` and parse the order
// back out of the room IDs with a regex, which worked only because every room existed from the moment
// the crossing did. A driver asks this about the WHOLE route, including the stretch nobody has walked
// to, so under windowing that version would return a chain with holes in it and deliver people into
// rooms that had never been made. The plan is ordered by construction, so there is nothing to parse.
export function crossingChain(instanceId, destKey) {
  const c = crossings.get(instanceId);
  if (!c) return [];
  return [...c.plan.trunk, ...(c.plan.limbs[destKey] || [])];
}
// The destination zone a limb ends at, where the road comes out.
export function crossingDest(instanceId, destKey) {
  const c = crossings.get(instanceId);
  return c?.dests?.find(d => d.key === destKey)?.dest || null;
}
// What a caller needs to lay something over a crossing without reaching into `crossings`.
// `player._crossing` deliberately carries only { instanceId, seen } — everything else about the
// crossing is shared state and belongs here, not copied onto each member.
export function crossingInfo(instanceId) {
  const c = crossings.get(instanceId);
  if (!c) return null;
  // `trunk` is the number of SHARED rooms before the fork. A walker never needed it — they take
  // an exit and the world decides — but anything laying its own geometry over the crossing does:
  // it is the boundary between the road everybody drives and the limb you chose. (THE LONG HAUL.)
  // ⚠ `origin` IS THE PLACE'S NAME, NOT THE ROOM IT HANGS OFF. `c.origin` is a zone ID (the trunk's
  // first room exits north into it), and this handed that id out under a name every consumer was
  // reading as prose — the `route` verb printed "Out of zone_district_918_947" for anyone already
  // on the road, and printed the real name in a yard, because the yard branch fell through to
  // VOIDS. The id is still available as `originZone` for anything that genuinely wants the room.
  const vdef = VOIDS[c.voidKey];
  return { voidKey: c.voidKey, window: c.window, origin: vdef?.origin || c.origin, originZone: c.origin,
    // What a ROAD SIGN calls the place you came from — see the `sign` note on VOIDS.
    originSign: vdef?.sign || vdef?.origin || null,
    entry: c.entry, dests: c.dests,
    trunk: Math.max(1, c.plan?.trunkLen || 1) };
}

// The march reads the plan (which room hosts a detour, what a cut saves, where a room sits along the
// spine) and never the materialised set, for the same reason `crossingChain` does not: most of the
// route is not made at any given moment. Handing it the map is enough — it owns no crossing state.
wireMarch({ crossings });

export const commands = {
  voidwalk: cmdVoidwalk,
  ready: cmdReady,
  scrawl: cmdScrawl,
  loot: cmdLoot,
  frontier: cmdFrontier,
  flag: cmdFlag,
  camp: cmdRest,
  march: cmdMarch,
};

export const hooks = {
  'movement.edge': onMovementEdge,
  'zone.describeRoom': describeVoidRoom,
};

export const _test = {
  crossings, VOIDS, totalLength, MIN_ROOMS, TRUNK_FRACTION, TRUNK_MIN, TRUNK_MAX, trunkTilesFor,
  // The window, so the suite can drive it deliberately rather than inferring it from where a fake
  // player happens to be standing.
  planFor, materialise, refreshWindow, windowAround, WINDOW_R, describeVoidRoom,
  beacons, beaconsNear, clearBeacon, activeBeacons,
  // ⚠ FOR TESTS THAT ARE NOT ABOUT THE WINDOW. Salvage, the minimap payload and the braid's shape
  // all want the whole route standing at once, and making them model the window instead would turn
  // three good tests into three worse ones that break every time the radius is tuned. The window's
  // own behaviour is asserted separately, on a crossing nobody has forced.
  materialiseAll: (c) => { for (const id of c.plan.rooms.keys()) materialise(c, id); return c; },
  loadFoes, spawnFoe, foesFor, MAX_VOID_FOES, isHardNode, hardFoePool: () => HARD_FOE_POOL, teardownInstance, LOOT, bigScoreSalt, handleDeath: onVoidDeath, frontierView, markSurvived,
  stagings, playerStaging, isMapRim, rimDirs, describeRim, isMarching, march: _march,
  foePool: () => FOE_POOL,
  invalidateRimIndex: () => { coordIndex = null; },
  setEncounters: (on) => { ENCOUNTERS_ON = on; },
  setSalvage: (v) => { SALVAGE_FORCE = v; },
  setWindow: (w) => { WINDOW_FORCE = w; },
  currentWindow,
};

loadFoes(); // warm the void roster from the enemies table (one boot query)

console.log('[voidwalking] Plugin loaded.');
