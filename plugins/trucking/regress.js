// THE LONG HAUL regression suite — run by tests/regress.js (never in production).
//
// It drives a REAL crossing: a synthetic gate + destination are stapled into the world, the
// voidwalking muster is walked through exactly as a player would, and then the truck takes over
// and covers every tile of the corridor via the actual `trucksync` verb. That end-to-end shape is
// the point — the pieces (corridor geometry, the clamp, node crossings) are individually cheap to
// fake and individually meaningless. What has to hold is that an odometer reading turns into the
// right void room, every time, for a whole haul.
import { world, setLivePlayer, removeLivePlayer, addPlayerToZone, removePlayerFromZone } from '../../server/engine/world.js';
import { mapWindow, surfaceAt, isRoadCell, bounds as worldBounds } from '../flight/state.js';
import { TYPES, SURFACES, createTruckState, step, truckShift, truckSplit, bestGear, truckHitch, truckUnhitch, FADE_AT } from '../../client/game/js/panels/flight-model.js';
import { VOIDS, _test as voidTest } from '../voidwalking/index.js';
import { corridorFor, corridorAt, corridorLocate, corridorPos, corridorProvider, TILES_PER_ROOM, CORRIDOR_R, OFFROAD_R, nodeAt, sOfNode, roomLenOf, landformsFor, avoidTurn, trailFor, trailPos, campsOf, trailOffsetOn, isCampOn,
  addWreck, wrecksOn, wreckAhead, _clearWrecks, milesOf, signsBetween, ARROW_WORDS, isCarriageway, pavedAt, lanesAt, PAVED_R, joinRoutes, reverseRoute, pairKey } from './corridor.js';
import { CAB_VIEW_TUNE } from '../../client/shared/cab-render-tune.js';   // pure data, no DOM — that is exactly why it is not defined in windshield.js
import { rigs, rigOf, reconcileTruck, topTilesPerSec, surfaceUnder, CAB_RADIUS, truckContactsNear,
  atOrBeforeFork, cabContext, pumpAt, pumpClamp, FUEL_FULL, providerFor, regionGates, gatePair, networkRoute, interchangeFor, buildRoad, _clearGateCache, _previewRoute,
  ridingRigOf, seatsFree, boardPassenger, alightPassenger, driveToZone, dismountRig } from './state.js';
import { bodyTell } from '../../server/engine/dreamscape.js';
import { aircraftFaces, faceBaseRgb, truckMeta, vehicleLamps } from '../../client/game/js/panels/aircraft3d.js';
import { COMMODITIES, REGIONS, midPrice, askPrice, bidPrice, capacityFor } from './market.js';
import { isTextDriving } from './textdrive.js';
import { DASH_MATERIALS, DASH_COLOURWAYS, sanitizeTrim, isDashMaterial, isDashColourway, stockTrim,
  customColourway, sanitizeCustomTrim, isTrimHex, CUSTOM_COL } from '../../client/shared/cab-trim.js';
import { trimCost, sanitizePaint, paintCost, presetPaint, PAINT_DEFAULT, PAINT_PRESETS, FLASHES, FINISHES } from './rig.js';
import { restoreDrivingState } from './resume.js';
import { routeOptions } from './routes.js';
import { damageOf, overall, wearSplit, impactSplit, grindSplit, IMPACT_AREAS, partEffects, applyDamage, PARTS } from './damage.js';
import { accrueGrime, grimeBand, washCost, WASH_FULL } from './filth.js';
import { FITTINGS, FIT_IDS, SLOTS, installedFits, fitSuffix, fitByCode, priceFor } from './fittings.js';
import { truckLivery } from '../../client/shared/truck-livery.js';
import { isTerminal, TERMINAL_CONDITION } from './rig.js';   // breakChance is already imported below
import { displayRung, setDisplayRung } from '../../server/engine/presentation.js';
import { HELP_GROUPS } from '../../server/engine/commands/world.js';
import { query } from '../../server/models/db.js';
import { getBroadcast, setBroadcast } from '../../server/engine/messaging.js';
import { _test as truckTest } from './index.js';
import { TRAILER_TYPES, trailersAt, trailersOf, getTrailer, buyTrailer, hitchTrailer, dropTrailer, saveLoad, canDrop,
  posed, stockPose, stockSlots, findStockPose, STOCK_GAP, standStock, boxColour, boxLivery, paintTrailer, BOX_GREY,
  sellTrailer, trailerResale } from './trailers.js';
import { runScale, scaleAt, clearCustoms, afterDrive } from './scale.js';
import { hitcherAt, hitcherAhead, hitcherSOf, HITCHER_KINDS } from './hitchers.js';
import { roadNetwork, roadCellAt, worldRoadProvider, clearRoadNet } from './roadnet.js';
import { tryDoorBoard, rigLocked, passHitcher } from './state.js';
import { effTruckParams, tuneRange, repairCost, wearFor, wearForImpact, bandOf, FIELD_CAP,
  breakChance, fixOdds, BREAKDOWNS, FIX_GRACE_TILES } from './rig.js';
import { resaleValue, TRUCK_TYPES, buyTruck, getTruck } from './fleet.js';

const GATE = 'zone_regress_truckgate';
const mkZone = (id, name, extra = {}) => ({
  id, name, description: `${name}.`, flags: {}, exits: {},
  players: new Set(), npcs: new Set(), enemies: new Set(), corpses: new Set(), ...extra,
});

export default async function regress({ run, check, getPlayer }) {
  const VOIDKEY = 'region_coldwater';
  const vdef = VOIDS[VOIDKEY];
  const DESTKEY = vdef.dests[0].key;              // the Reach limb
  const DEST = vdef.dests[0].dest;
  const player = getPlayer();
  const savedZone = player.current_zone;

  // ── 0a. EVERY DEPOT IS A BUILDING WITH A YARD ──────────────────────────────
  // `depotAt` used to accept two looser shapes — a bare string, and an object with no `yard` — and
  // what that bought was not flexibility, it was a second depot design nobody had decided to have.
  // Two of the five shipped depots were authored that way and had NO BUILDING ON THE MAP AT ALL:
  // the renderer extrudes a tile carrying a `building_type`, and a flag on open hardstand gives it
  // nothing to extrude, so a player stood in a yard, typed `drive`, and pulled out of bare ground.
  //
  // The reader is strict now, which means an author who writes the old shape gets a depot that does
  // not exist rather than one that half works. These three checks are what turn that into a build
  // failure with a name on it. `yard` is the one fact a bay cannot derive — a building tile is
  // solid and has no road under it — so a yard that is missing, absent from the world, or itself a
  // building is each a truck mounted somewhere a truck cannot be.
  {
    const depots = [...world.zones.values()].filter(z => z.flags?.truck_depot);
    check(`every depot is authored as a building (${depots.length})`,
      depots.length >= 5 && depots.every(z => z.flags.building_type && z.flags.is_building),
      depots.filter(z => !z.flags.building_type).map(z => z.id).join(', '));
    const yards = depots.map(z => ({ id: z.id, y: world.zones.get(z.flags.truck_depot?.yard) }));
    check('…and every one of them names a yard that exists',
      yards.every(v => !!v.y), yards.filter(v => !v.y).map(v => v.id).join(', '));
    // The yard is where the rig is mounted, so it has to be a real piece of road: grid coordinates
    // to stand on, and not itself a solid building.
    check('…which is a drivable tile, not another building',
      yards.every(v => v.y && v.y.grid_x != null && !v.y.flags?.is_building),
      yards.filter(v => v.y && (v.y.grid_x == null || v.y.flags?.is_building)).map(v => v.id).join(', '));
  }

  // ── 0. The air horn ────────────────────────────────────────────────────────
  // A horn is only a horn if the ROOM hears it, so the thing worth pinning is not that the verb
  // answers — it is that it refuses honestly when there is no truck within reach, and that both
  // spellings land on the same handler. Half the people who want this will type the other one.
  {
    const noTruck = await run('horn');
    check('the horn refuses when there is nothing here to sound one on',
      /nothing here|nothing parked/i.test(noTruck?.message || ''), noTruck?.message?.slice(0, 60));
    const alias = await run('honk');
    check('…and `honk` is the same verb, not an unknown command',
      (alias?.message || '') === (noTruck?.message || ''), alias?.message?.slice(0, 60));
  }

  // ── ⚠ THE VERB THIS PLUGIN BORROWED, AND MUST GIVE BACK ────────────────────
  // `lock`/`unlock` are ENGINE builtins (server/engine/commands/doors.js) and plugins beat
  // builtins outright, so registering them here points every apartment door, shop shutter, cell and
  // hatch in the game at a truck. It would fail everywhere at once and look nothing like trucking.
  //
  // The router only keeps the verb when the answer is unambiguous — behind a wheel, and either
  // nothing said after it or the cab named. Everything else returns undefined and falls through.
  // This case is the whole guarantee: no rig, so the trucking handler must not be what answers.
  {
    const noRig = await run('lock');
    const msg = noRig?.message || '';
    check('`lock` with no truck falls through to the engine door command',
      !/latch/i.test(msg), msg.slice(0, 70));
    const noRigU = await run('unlock');
    check('…and so does `unlock`', !/latch/i.test(noRigU?.message || ''),
      (noRigU?.message || '').slice(0, 70));
    // The narrow half: a target that is plainly not the cab is never eaten either, even in a truck.
    check('…and naming something else is always somebody else\'s verb',
      !/latch/i.test((await run('lock apartment'))?.message || ''));
  }

  // ── 1. The corridor, on its own ────────────────────────────────────────────
  // Pure geometry, no world needed. These are the invariants the whole system rests on: the road
  // is the same road for everyone this week, and every void room is reachable by driving.
  {
    const a = corridorFor(VOIDKEY, DESTKEY, 4242, 8);
    const b = corridorFor(VOIDKEY, DESTKEY, 4242, 8);
    check('the same route in the same week is the same road',
      JSON.stringify(a) === JSON.stringify(b));
    check('next week is a different road',
      JSON.stringify(a) !== JSON.stringify(corridorFor(VOIDKEY, DESTKEY, 4243, 8)));
    check('the road is exactly as long as the room chain',
      a.L === 8 * TILES_PER_ROOM, a.L);

    // ── THE ANCHORED ROAD ────────────────────────────────────────────────────
    // The corridor is laid between two REAL world tiles now, so that a driver, a pilot and a
    // walker all describe the same place with the same numbers. These are the invariants that
    // buys, and every one of them was a way it went wrong while being written.
    {
      const A = { x0: 918, y0: 947, x1: 910, y1: 1042 };     // Coldwater's south rim → the Reach
      const r = corridorFor(VOIDKEY, DESTKEY, 4242, 8, 4, null, A);
      const straight = Math.hypot(A.x1 - A.x0, A.y1 - A.y0);
      check('an anchored road starts on the rim tile it left',
        Math.hypot(corridorPos(r, 0, 0).x - A.x0, corridorPos(r, 0, 0).y - A.y0) < 0.01);
      // ⚠ THE ARRIVAL TILE IS THE WHOLE POINT. A road that ends "about there" puts the arrival
      // check, the destination sign and the tile `leaveCorridor` hands back in three places.
      check('…and ends exactly on the tile it was aimed at',
        Math.hypot(corridorPos(r, r.L, 0).x - A.x1, corridorPos(r, r.L, 0).y - A.y1) < 0.01,
        `${corridorPos(r, r.L, 0).x.toFixed(2)},${corridorPos(r, r.L, 0).y.toFixed(2)}`);
      // ⚠ THE LIMIT-CYCLE GUARD. Terminating the wander at a few fixed tiles let the road orbit
      // its own destination — homing to ~8 tiles out and then circling for the rest of its budget,
      // because it was correcting an 8-tile miss on a 43-tile turning circle. It only ever
      // arrived because the cap ran out. A road longer than MAX_SINUOSITY means that is back.
      check('…without orbiting it — the road converges under its own steam',
        r.L / straight <= 1.6, `sinuosity ${(r.L / straight).toFixed(3)}`);
      // The odometer must round-trip through world coordinates, or `locate` and `corridorPos`
      // disagree and the truck's one economically meaningful number is wrong.
      let worst = 0;
      for (let s = 0; s <= r.L; s += 1) {
        const p = corridorPos(r, s, 0);
        const hit = corridorLocate(r, p.x, p.y);
        worst = hit ? Math.max(worst, Math.abs(hit.s - s)) : Infinity;
      }
      check('…and the odometer round-trips through real coordinates the whole way',
        worst < 1, `worst ${worst === Infinity ? 'NO FIX' : worst.toFixed(3)}`);
      // A room is a FRACTION of the road now, not a fixed 90 tiles — but the chain must still be
      // spanned exactly, or a driver walks off the end of it.
      const rooms = new Set();
      for (let s = 0; s < r.L; s += r.L / 500) rooms.add(nodeAt(r, s));
      check('…and every void room is still reachable by driving', rooms.size === 8, `${rooms.size}/8`);
      // The composite provider in state.js leans on this: off the road, the corridor must decline
      // so the REAL world shows through instead of being painted over as air.
      check('…and a tile well off the road declines, so the world shows through',
        corridorAt(r, A.x0 + 400, A.y0 - 400) === null);
      // And the legacy frame is untouched, which is what makes every case above this one still
      // mean what it meant.
      check('an unanchored road is still the old local frame',
        a.anchored === false && a.roomLen === TILES_PER_ROOM && Math.abs(corridorPos(a, 0, 0).x) < 1e-9);
    }

    // Sweep the whole odometer down the centreline. Every tile must be road, and the node index
    // must climb 0..n-1 with no gaps and no repeats — a gap strands a driver off the map, and a
    // repeat means a room's encounter rolls twice.
    let gap = null, order = [];
    for (let s = 0; s <= a.L; s++) {
      const p = corridorPos(a, s, 0);
      const c = corridorAt(a, Math.round(p.x), Math.round(p.y));
      if (!c) { gap = s; break; }
      if (c.flags.terrain !== 'road') { gap = `s=${s} is ${c.flags.terrain}`; break; }
      const n = c.flags.corridor_node;
      if (order[order.length - 1] !== n) order.push(n);
    }
    check('the centreline is paved from end to end, with no gaps', gap === null, gap);
    check('driving crosses every room once, in order',
      JSON.stringify(order) === JSON.stringify([...Array(a.nodes).keys()]), order.join(','));

    // THE VERGE IS DRIVABLE AND THE FAR EDGE IS NOT A WALL — two facts, and the pair of them is
    // the whole "you may drive off the road" rule. Just past the tarmac there is real ground to
    // roll on (slow, and murder on tyres); four times the half-width out there is nothing at all,
    // which is what keeps the limit a law rather than something you can collide with.
    // These probe ACROSS the road at the mid point, and they have to be taken along the road's own
    // normal rather than along +x — the road is a curve now and "sideways" is only occasionally east.
    const across = (s, t) => { const p = corridorPos(a, s, t); return corridorAt(a, Math.round(p.x), Math.round(p.y)); };
    check('just off the pavement there is still ground to drive on',
      across(a.L / 2, CORRIDOR_R + 2) !== null);
    check('…and it is NOT road, so the surface is the punishment',
      across(a.L / 2, CORRIDOR_R + 2)?.flags.terrain !== 'road');
    check('past the off-road limit is open air, not a wall',
      across(a.L / 2, OFFROAD_R + 4) === null);
    // ⚠ Probe the ORDER of the bands, never a specific `t`. The shoulder is barely a tile wide and
    // the road runs at an angle, so rounding a point at t=2 onto the tile grid lands on tarmac or on
    // verge often enough to make an exact-offset assertion a coin flip. What actually matters is
    // that crossing outward you meet tarmac, then dirt, then open ground, in that order and with no
    // band missing — which is the thing that makes drifting off READ before it costs.
    {
      let bad = null;
      for (let s = 40; s <= a.L - 40 && !bad; s += 37) {
        const seq = [];
        for (let t = 0; t <= OFFROAD_R; t += 0.25) {
          const c = across(s, t);
          const band = !c ? 'air' : c.flags.terrain === 'road' ? 'road' : c.flags.terrain === 'dirt_road' ? 'dirt' : 'verge';
          if (seq[seq.length - 1] !== band) seq.push(band);
        }
        const want = ['road', 'dirt', 'verge'];
        if (seq.slice(0, 3).join('>') !== want.join('>')) bad = `s=${s}: ${seq.join('>')}`;
      }
      check('crossing outward you meet tarmac, then graded dirt, then open ground — in that order',
        bad === null, bad);
    }

    // ── The curve invariants ────────────────────────────────────────────────
    // The road bends now, and every one of these is a way that goes wrong silently.

    // 1. IT ACTUALLY BENDS. The whole point of the change; a generator that quietly degenerated to
    // due south would pass every other test in this file.
    const degs = a.legs.map(l => l.deg);
    check('the road actually turns, rather than running due south',
      Math.max(...degs) - Math.min(...degs) > 15, `${Math.min(...degs).toFixed(1)}..${Math.max(...degs).toFixed(1)}`);

    // 2. ⚠ THE MINIMUM TURN RADIUS. Every cell out here is classified by distance from the
    // centreline out to OFFROAD_R, so a bend tighter than that folds the verge band through itself
    // and two distant stretches of one route start claiming the same tile. This is the invariant the
    // whole synthesis rests on, and nothing else in the suite would notice it breaking.
    let tightest = Infinity;
    for (let i = 1; i < a.legs.length; i++) {
      const dth = Math.abs(a.legs[i].deg - a.legs[i - 1].deg) * (Math.PI / 180);
      if (dth > 1e-9) tightest = Math.min(tightest, a.legs[i - 1].len / dth);
    }
    check('no bend is tighter than the verge is wide, so the road never folds through itself',
      tightest > OFFROAD_R * 2, `tightest radius ${tightest.toFixed(0)} tiles`);

    // 3. A STRAIGHT IS STRAIGHT. The first cut leashed the heading back toward south a little every
    // tile, which reads as a road that never stops wandering — the wheel is never still and no bend
    // registers as an event because everything is one.
    let straight = 0;
    for (let i = 1; i < a.legs.length; i++) if (Math.abs(a.legs[i].deg - a.legs[i - 1].deg) < 1e-9) straight++;
    check('a good half of the road is genuinely straight, so a bend is an event',
      straight > a.legs.length * 0.3, `${straight}/${a.legs.length} segments`);

    // 4. THE ROUND TRIP. corridorPos and corridorLocate must stay inverses across the whole verge,
    // because the odometer, every node crossing and the bogged test are all derived through them.
    // Tolerance is not zero and cannot be: the nearest point on a CURVE to an offset point is not
    // the point the offset was measured from, so a tile far out on the verge legitimately locates a
    // little ahead or behind. A tile's worth of that is fine; a segment's worth is a fold.
    let rt = 0, rtNull = null;
    for (let s = 0; s <= a.L; s += 1) for (const t of [0, 1, 5, 15, 22]) {
      const p = corridorPos(a, s, t);
      const h = corridorLocate(a, p.x, p.y);
      if (!h) { rtNull = `s=${s} t=${t}`; break; }
      rt = Math.max(rt, Math.abs(h.s - s));
    }
    check('every point of the corridor locates back to itself', rtNull === null, rtNull);
    check('…to within a tile, so the odometer never jumps through a fold', rt < 1.5, rt.toFixed(2));

    // 5. ⚠ THE PAVED BAND IS ONE PIECE. This is the test the widened tarmac exists to pass. A road
    // one tile wide is fine on an axis and comes apart the moment it isn't: the tiles of a diagonal
    // band touch only at their CORNERS, so the highway renders as a dotted line of squares with
    // verge showing through the gaps. Flood-fill the whole paved set and demand a single component.
    {
      const paved = new Set();
      const xs = a.legs.map(l => l.x0), ys = a.legs.map(l => l.y0);
      const x0 = Math.floor(Math.min(...xs)) - 4, x1 = Math.ceil(Math.max(...xs)) + 4;
      const y0 = Math.floor(Math.min(...ys)) - 4, y1 = Math.ceil(Math.max(...ys)) + 4;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (corridorAt(a, x, y)?.flags.terrain === 'road') paved.add(`${x},${y}`);
      }
      const seen = new Set(), stack = [[...paved][0]];
      seen.add(stack[0]);
      while (stack.length) {
        const [px, py] = stack.pop().split(',').map(Number);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const k = `${px + dx},${py + dy}`;
          if (paved.has(k) && !seen.has(k)) { seen.add(k); stack.push(k); }
        }
      }
      check('the tarmac is one unbroken piece, not a dotted line of tiles',
        seen.size === paved.size, `${seen.size}/${paved.size} tiles connected`);
    }

    // 5b. THE ROAD MEETS THE MAP LIKE A SLIP ROAD, NOT LIKE A STEP. A city street is one tile across
    // and the highway is not, and because a cell either is carriageway or is not, that change used
    // to happen between two adjacent tiles — you came off a two-lane street and were abruptly on
    // something four lanes wide. The width and the lane count both ramp over the first stretch and
    // close again on the approach to the far end, because you arrive at a town as well as leaving
    // one. ⚠ The narrow end is bounded by the connectivity test above, not by taste.
    {
      const mid = a.L / 2;
      check('the road is narrower where it meets the map than out in the middle',
        pavedAt(a, 0) < pavedAt(a, mid) - 0.1, `${pavedAt(a, 0).toFixed(2)} → ${pavedAt(a, mid).toFixed(2)}`);
      check('…and narrows again on the approach to the far end',
        pavedAt(a, a.L) < pavedAt(a, mid) - 0.1, pavedAt(a, a.L).toFixed(2));
      check('…monotonically, so no tile is wider than the one further in',
        Array.from({ length: 26 }, (_, i) => pavedAt(a, i)).every((w, i, arr) => i === 0 || w >= arr[i - 1] - 1e-9));
      // The lane count is what a driver actually reads off the ruts, and it must move WITH the width
      // — a two-lane-wide road with four sets of wheel tracks on it is not a taper, it is a mistake.
      check('the lanes taper with it, two at the gate and four in the middle',
        lanesAt(a, 0) === 2 && lanesAt(a, mid) === 4, `${lanesAt(a, 0)} → ${lanesAt(a, mid)}`);
      check('…and the count never leaves the range the renderer lays ruts for',
        Array.from({ length: 60 }, (_, i) => lanesAt(a, i * a.L / 59)).every((n) => n >= 2 && n <= 4));
      // The surface is DIRT to look at and ROAD to drive on, and that split is the whole reason
      // `road_dirt` exists rather than an honest `terrain: 'dirt_road'` — see its ⚠. If this ever
      // flips, the highway silently acquires the shoulder's grip penalty for its entire length.
      const c0 = across(mid, 0);
      check('the highway is surfaced in dirt without becoming a dirt road',
        c0.flags.road_dirt === 1 && c0.flags.terrain === 'road');
      check('…so the physics still calls it road, not shoulder',
        surfaceUnder({ leg: 'corridor', route: a, x: corridorPos(a, mid, 0).x, y: corridorPos(a, mid, 0).y }) === 'road');
      check('…and it ships the lane count the renderer draws ruts from',
        c0.flags.road_lanes === lanesAt(a, mid), String(c0.flags.road_lanes));
    }

    // 6. EVERY PAVED TILE CARRIES A HEADING, and it is the heading that makes the renderer paint a
    // curve instead of an elbow. A tarmac cell shipping only an icon is a bend drawn as a crossroads.
    {
      let missing = null;
      for (let s = 0; s <= a.L && !missing; s += 7) {
        const c = across(s, 0);
        if (!Number.isFinite(c?.flags?.road_deg) || !Number.isFinite(c?.flags?.road_t)) missing = `s=${s}`;
        // The icon is the FALLBACK and must never be a bend piece — a 90° elbow is not what the road
        // does here, and drawing one puts lane markings down an arm the highway never takes.
        else if (!['road_ns', 'road_ew'].includes(c.flags.icon)) missing = `icon ${c.flags.icon} @ s=${s}`;
      }
      check('every paved tile ships its own heading, and an axis-aligned icon as the fallback',
        missing === null, missing);
    }

    // 7. THE TRUNK IS ONE ROAD. Both destinations out of a void share their first `trunk` rooms, so
    // the tarmac over them must be identical tile for tile — otherwise changing your mind at the
    // fork teleports the rig sideways onto a road that was somewhere else the whole way. The curve
    // generator has to keep the trunk/limb seed split intact to hold this.
    if ((vdef.dests || []).length > 1) {
      const t1 = corridorFor(VOIDKEY, vdef.dests[0].key, 4242, 8, 3);
      const t2 = corridorFor(VOIDKEY, vdef.dests[1].key, 4242, 8, 3);
      let diverged = null;
      for (let s = 0; s <= 3 * TILES_PER_ROOM && !diverged; s++) {
        const p = corridorPos(t1, s, 0), q = corridorPos(t2, s, 0);
        if (Math.abs(p.x - q.x) > 1e-9 || Math.abs(p.y - q.y) > 1e-9) diverged = `s=${s}`;
      }
      check('both destinations drive the identical trunk before the fork', diverged === null, diverged);
      check('…and part company after it',
        Math.abs(corridorPos(t1, 3 * TILES_PER_ROOM + 200, 0).x - corridorPos(t2, 3 * TILES_PER_ROOM + 200, 0).x) > 1);
    }

    // Every roadside structure must be a type the renderer actually models. A bad `building_type`
    // is invisible in every test except a player driving past it, which is precisely the failure
    // mode scripts/shapes/smoke.mjs exists to prevent for the flight sim.
    const KNOWN = new Set(['fuel_yard', 'diner', 'garage', 'warehouse', 'junkyard', 'ruins', 'layover', 'reefer']);
    let badType = null;
    for (let s = 0; s <= a.L && !badType; s += 1) {
      for (let t = -a.R; t <= a.R; t++) {
        const p = corridorPos(a, s, t);
        const bt = corridorAt(a, Math.round(p.x), Math.round(p.y))?.flags?.building_type;
        if (bt && !KNOWN.has(bt)) { badType = `${bt} @ s=${s}`; break; }
      }
    }
    check('every roadside structure is a modelled building type', badType === null, badType);
  }


  // ── 1b. The junction you can see, and the boards that name it ──────────────
  // Two things that are one thing: the highway used to be a single limb ending in open waste, so
  // the fork was a room name changing and the road appeared to just STOP. It now carries its
  // siblings and a handful of signs.
  {
    const PLAN = { origin: 'Coldwater Basin', dests: [
      { key: DESTKEY, name: 'The Reach', nodes: 8 },
      { key: 'exodus', name: 'Terminus', nodes: 12 },
      { key: 'deadwater', name: 'Deadwater', nodes: 8 },
    ] };
    const r = corridorFor(VOIDKEY, DESTKEY, 4242, 8, 4, PLAN);
    const bare = corridorFor(VOIDKEY, DESTKEY, 4242, 8, 4);

    // 1. THE TRUNK IS THE SAME ROAD WHETHER OR NOT YOU KNOW ABOUT THE OTHER LIMBS. This is what
    // makes `switchLimb` a change of mind rather than a teleport, and adding siblings must not have
    // perturbed it — the trunk is seeded without the destination precisely so it cannot.
    check('the plan does not move the road it describes',
      JSON.stringify(r.legs) === JSON.stringify(bare.legs));
    check('a route with no plan has no siblings and no signs',
      bare.branches.length === 0 && bare.signs.length === 0);
    check('a route with a plan carries the limbs it did NOT take',
      r.branches.map(b => b.key).sort().join(',') === 'deadwater,exodus');
    check('…and each of those is a whole road of its own length',
      r.branches.every(b => b.route.L === b.route.nodes * TILES_PER_ROOM));
    check('a sibling does not recurse into siblings of its own',
      r.branches.every(b => b.route.branches.length === 0));

    // 2. THE OTHER ROAD IS ACTUALLY THERE, past the fork, where it is a different road. Before this
    // the window past the junction held one highway and open waste where the other one went.
    let branchTiles = 0, ours = 0;
    const mid = corridorPos(r, r.trunkL + 140, 0);
    for (let dx = -70; dx <= 70; dx++) for (let dy = -70; dy <= 70; dy++) {
      const c = corridorAt(r, Math.round(mid.x) + dx, Math.round(mid.y) + dy);
      if (!c) continue;
      if (c.flags.corridor_branch) branchTiles++; else ours++;
    }
    check('past the junction the road you did not take is still out there', branchTiles > 200, branchTiles);
    check('…and it never outranks the road under your wheels', ours > branchTiles);

    // 3. ⚠ A SIBLING'S CELL CARRIES NO ODOMETER. `corridor_s` and `corridor_node` are the two
    // numbers the whole drive is derived from, and a cell handing out another limb's reading would
    // be wrong in a way that looked right.
    let leaked = null;
    for (let dx = -70; dx <= 70 && !leaked; dx++) for (let dy = -70; dy <= 70; dy++) {
      const c = corridorAt(r, Math.round(mid.x) + dx, Math.round(mid.y) + dy);
      if (c?.flags?.corridor_branch && (c.flags.corridor_s !== undefined || c.flags.corridor_node !== undefined)) {
        leaked = `${c.flags.corridor_branch} @ ${dx},${dy}`; break;
      }
    }
    check('a sibling limb never hands out an odometer reading', leaked === null, leaked);

    // 4. THE BOARDS. One at the gate, one before the junction, one on the approach to each bend.
    check('the road puts up signs at all', r.signs.length >= 3, r.signs.length);
    check('the first board is at the gate, where the road names itself', r.signs[0].kind === 'gate');
    check('there is a board on the approach to the junction',
      r.signs.some(g => g.kind === 'fork' && g.s < r.trunkL));
    check('no two boards are close enough to read as one repeated board',
      r.signs.every((g, i) => i === 0 || g.s - r.signs[i - 1].s >= 40));

    // 5. ⚠ ONE BOARD IS ONE TILE. Matched on a tolerance band (the way a wreck is) a post comes out
    // as three or four identical boards in a row, which reads as a bug rather than as a sign.
    for (const g of r.signs) {
      let n = 0;
      for (let dx = -6; dx <= 6; dx++) for (let dy = -6; dy <= 6; dy++) {
        if (corridorAt(r, g.x + dx, g.y + dy)?.flags?.road_sign) n++;
      }
      check(`the board at mile ${milesOf(g.s)} stands on exactly one tile`, n === 1, n);
    }
    // …and it stands OFF the road, on the verge, where a truck holding its line drives past it.
    check('every board is clear of the tarmac and the shoulder',
      r.signs.every(g => {
        const t = corridorAt(r, g.x, g.y);
        return t && t.flags.terrain !== 'road' && t.flags.terrain !== 'dirt_road';
      }));

    // 6. WHAT THE BOARD SAYS. Miles, never tiles, and every place named on it is one you can still
    // get to from where it stands — a board naming a town on the other side of a junction you have
    // already passed is a board that lies, and there is no cutting across out here.
    const gate = r.signs[0], last = r.signs[r.signs.length - 1];
    check('the gate board names every destination out of the void',
      gate.rows.filter(row => row.n !== 'COLDWATER BASIN').length === 3, gate.rows.length);
    check('…and it names the place you came from too, pointing back',
      gate.rows.some(row => row.n === 'COLDWATER BASIN' && row.a === 4));
    check('the distance is in miles, not tiles',
      gate.rows.find(row => row.n === 'THE REACH').m === milesOf(r.L - gate.s));
    if (last.s > r.trunkL) {
      check('past the junction a board stops naming roads you can no longer reach',
        last.rows.every(row => row.n === 'THE REACH' || row.n === 'COLDWATER BASIN'),
        last.rows.map(row => row.n).join('/'));
    }
    check('every arrow is one of the eight, so nothing renders a rotation off the end of the table',
      r.signs.every(g => g.rows.every(row => ARROW_WORDS[row.a] !== undefined)));

    // 6b. BOTH FACES OF THE BOARD. This road has one lane each way and one post, so a driver
    // running home passed a board they could not read — and the renderer, mapping one set of
    // lettering onto a quad seen from behind, drew it MIRRORED. The distances are a property of the
    // road and do not change; the arrows are measured from the driver's heading and all do.
    check('every board carries a back face as well as a front',
      r.signs.every(g => g.back?.length === g.rows.length));
    // ⚠ AS A SET, NOT INDEX-WISE. This used to compare row i to row i, which was true when both
    // faces were built in the same order — and that sameness was the bug: a driver running home
    // read a board whose TOP LINE was the place behind them. The places and the distances are
    // still identical (a distance along a road does not care which way you face); what differs is
    // which of them is read first.
    const key = (row) => row.n + '|' + row.m;
    check('…naming the same places at the same distances', r.signs.every(g =>
      g.back.map(key).slice().sort().join() === g.rows.map(key).slice().sort().join()));
    check('…with the arrows re-measured for a driver facing the other way',
      r.signs.some(g => g.back.some((row) => {
        const same = g.rows.find(f => key(f) === key(row));
        return same && same.a !== row.a;
      })));
    // AND EACH FACE LEADS WITH WHERE THAT DRIVER IS GOING, which is the whole point of two faces.
    // A row pointing back is 3, 4 or 5 on the eight-point arrow; anything else is a road in front
    // of you, including a hard turn at a fork.
    const behind = (row) => (row.a | 0) === 3 || (row.a | 0) === 4 || (row.a | 0) === 5;
    const leadsAhead = (rows) => rows.length < 2 || !behind(rows[0]) || rows.every(behind);
    check('a board leads with the destination you are driving toward', r.signs.every(g => leadsAhead(g.rows)));

    // ── THE SIDEBAR MAP'S HIGHWAY WINDOW ───────────────────────────────────────
    // The sidebar minimap eats zone NODES and the cab GPS eats derived surface CELLS, so out on a
    // crossing the sidebar was a chain of boxes on the one stretch of world where the road IS the
    // content. `mmroad` serves it the cab's own cells on its own packet.
    //
    // ⚠ AND THE CASES THAT MATTER ARE THE CLEARING ONES. Drawing a road is the easy half; a window
    // left behind after you step off the corridor is a sidebar showing a highway that is not there,
    // and that reads as a render fault rather than the state fault it is. So the transition is what
    // is pinned here, in both directions, rather than the picture.
    {
      const { roadWindowFor, pushRoadWindow, MMROAD_RADIUS } = await import('./mmroad.js');
      const onRoad = { id: player.id, current_zone: player.current_zone };
      // A rig standing on a real corridor route — the same builder the drive uses.
      const rigged = { playerId: onRoad.id, leg: 'corridor', route: r, x: 0, y: 0, heading: 180 };
      const pos = corridorPos(r, 0, 0);
      rigged.x = pos.x; rigged.y = pos.y; rigged.heading = pos.heading;
      rigs.set(onRoad.id, rigged);
      try {
        const win = roadWindowFor(onRoad);
        check('a rig on a corridor gets a road window', !!win?.cells?.length);
        check('…square, and the size mmroad asked for', win.cells.length === MMROAD_RADIUS * 2 + 1
          && win.cells.every(row => row.length === MMROAD_RADIUS * 2 + 1), String(win.cells.length));
        check('…centred on the rig, in whole tiles', win.x === Math.round(rigged.x) && win.y === Math.round(rigged.y));
        check('…carrying the heading, so the arrow can point', Number.isFinite(win.heading));
        // The cells are the SAME derivation the cab eats — a road is a road here because it is a
        // road out there, which is the whole reason this rides providerFor rather than a copy.
        check('…and the road is actually in them',
          win.cells.some(row => row.some(c => c && (c.road || c.terrain === 'road'))));

        // THE PUSH, and its one-shot. First call on a road sends; a second changes nothing to say.
        delete onRoad._sentRoad;
        check('pushing on a corridor sends a window', !!pushRoadWindow(onRoad) && onRoad._sentRoad === true);

        // ⚠ THE CLEAR. Step off the road and the NEXT push must send `null` — a message, not a
        // silence — and must then fall quiet rather than repeating it every step across town.
        rigs.delete(onRoad.id);
        check('…stepping off it sends the clear', pushRoadWindow(onRoad) === null && onRoad._sentRoad === false);
        check('…and then says nothing at all', pushRoadWindow(onRoad) === null && onRoad._sentRoad === false);
        // And a player who was never on one is silent from the start, so an ordinary walk down a
        // city street costs one call and no packet.
        const never = { id: player.id + '_never', current_zone: player.current_zone };
        check('a player who was never on a road is never sent one',
          pushRoadWindow(never) === null && !never._sentRoad);
        check('…and has no window to build', roadWindowFor(never) === null);
      } finally {
        rigs.delete(onRoad.id);
      }
    }

    // ── WHAT A ZONE EDIT INVALIDATES ───────────────────────────────────────────
    // Two spatial indexes are built over tile POSITIONS rather than read through them: the flight
    // plugin's coordinate index (which `surfaceAt`, and therefore the whole road network, sits on)
    // and this plugin's memoised rim gates. Neither of them is `world.zones`, so refreshing that
    // Map left both describing the world as it stood at boot.
    //
    // ⚠ AND IT FAILED SILENTLY AND PERMANENTLY. Nothing threw, nothing logged, and reloading did
    // not help — because reloading was the thing that was not working. `_coordIndex` had NO
    // invalidator at all, and the comment above it asserted that /world/reload rebuilt it, which
    // was never true: every guard on it reads `if (!_coordIndex)`, and it was never nulled.
    {
      const { registerZoneReloadHook, reloadZone, getZone } = await import('../../server/engine/world.js');
      const { surfaceAt: sa, invalidateCoordIndex } = await import('../flight/state.js');
      // A real content tile: `reloadZone` returns early on a row it cannot find, and an early
      // return fires no hook — so a made-up id would make every case below pass for no reason.
      const probe = 'zone_district_922_910';
      check('the engine publishes a zone-reload seam', typeof registerZoneReloadHook === 'function');
      check('the flight plugin publishes an index invalidator', typeof invalidateCoordIndex === 'function');
      check('…and the probe tile is really in the world', !!getZone(probe));

      // THE RIM GATES. Warm the memo, prove it IS a memo, then reload and prove it went.
      const warm = regionGates(VOIDKEY);
      check('rim gates are memoised while nothing changes', regionGates(VOIDKEY) === warm);
      await reloadZone(probe);
      check('…and a zone reload drops them, so a moved region re-derives its road mouths',
        regionGates(VOIDKEY) !== warm);

      // THE COORDINATE INDEX — the bigger of the two, because everything spatial reads through it.
      // The world has not actually changed here, so the ANSWER must not change; what is being
      // asserted is that it is still answerable after the drop, i.e. that the index rebuilt itself
      // rather than staying null or holding the old sweep.
      const gz = getZone(probe);
      const before = sa(gz.grid_x, gz.grid_y);
      await reloadZone(probe);
      const after = sa(gz.grid_x, gz.grid_y);
      check('a reload rebuilds the coordinate index rather than emptying it', !!after);
      check('…and an untouched tile still reads the same through it',
        (before ? before.id : null) === (after ? after.id : null));
    }

    // ── HOW LONG A CROSSING IS, DERIVED ────────────────────────────────────────
    // Every destination in VOIDS used to carry a hand-written `length`, and the reason was a wrong
    // constant rather than a design decision: `totalLength` divided a real distance by
    // TILES_PER_ROOM (90), which is what a room is worth on an UNANCHORED road — the legacy local
    // frame where L = nodes × 90 because there was nothing to measure against. The real gates are
    // 93 to 282 tiles apart, so every crossing came out at 1 to 3 rooms, clamped to MIN_ROOMS, and
    // every dest had to override it by hand.
    {
      const vw = await import('../voidwalking/index.js');
      const { VOIDS: V, totalLength } = vw._test;
      const { getZone } = await import('../../server/engine/world.js');
      const dist = (from, to) => { const p = gatePair(from, to); return p ? Math.hypot(p.to.x - p.from.x, p.to.y - p.from.y) : 0; };

      // ⚠ NOTHING IN THE TABLE OVERRIDES IT ANY MORE. The mechanism stays — an author may want to
      // pin a crossing — but a `length` sitting on a row that the derivation already agrees with is
      // a number nobody will think to update, which is how the old ones came to describe a
      // measurement that was never taken.
      const pinned = [];
      for (const [fromKey, def] of Object.entries(V)) for (const d of def.dests || []) if (d.length) pinned.push(fromKey + '→' + d.key);
      check('no crossing needs a hand-written length any more', pinned.length === 0, pinned.join(' '));

      // The derivation is gate-to-gate, and the gates are the same ones the ROAD anchors on — so
      // the room count and the geometry cannot disagree about how far it is.
      for (const [fromKey, def] of Object.entries(V)) {
        for (const d of def.dests || []) {
          const gd = dist(fromKey, d.region);
          check(`${fromKey.replace('region_', '')}→${d.key}: the gates are a real distance apart`, gd > 0, String(gd));
          const rooms = totalLength(d, null, getZone(d.dest), fromKey);
          check('…and its room count IS that distance',
            rooms === Math.max(5, Math.round(gd)), `${rooms} for ${gd.toFixed(0)} tiles`);
        }
      }
      // ⚠ AND OUT AND BACK AGREE BY CONSTRUCTION. The old table kept the two directions equal by
      // copying a number into both rows; `gatePair` picks the same two mouths whichever end asks,
      // so a return leg is the same length as its outbound without anything having to be edited
      // twice. This is the case that silently rots when somebody tunes one direction.
      const roomsFor = (fromKey, destKey) => {
        const d = (V[fromKey]?.dests || []).find(x => x.key === destKey);
        return d ? totalLength(d, null, getZone(d.dest), fromKey) : null;
      };
      for (const [a, ak, b, bk] of [
        ['region_coldwater', 'reach', 'region_the_reach', 'coldwater'],
        ['region_coldwater', 'deadwater', 'region_deadwater', 'coldwater'],
        ['region_coldwater', 'exodus', 'region_terminus', 'coldwater'],
        ['region_the_reach', 'deadwater', 'region_deadwater', 'reach'],
      ]) {
        const out = roomsFor(a, ak), back = roomsFor(b, bk);
        check(`${ak}/${bk}: the way back is the same length as the way out`, out != null && out === back, `${out} vs ${back}`);
      }

      // ⚠ THE FORK IS A FRACTION OF THE NEAREST DESTINATION, NOT A HALFWAY POINT.
      // This used to assert that Coldwater→Reach forked exactly halfway, because a trunk of 4 on an
      // 8-room crossing was the tuned case the per-room constant of 12 existed to reproduce. A room
      // is a TILE now: the Reach is 93 tiles rather than 8 rooms, the authored trunk is gone, and
      // the shared stretch is derived from the nearest destination. Halfway would put the fork 46
      // tiles out on the short hop and mean nothing at all on the 282-tile haul, which is why the
      // rule changed rather than the number.
      //
      // What has to hold is that the shared stretch is a real journey, is bounded at both ends, and
      // still leaves the fork a decision rather than a formality.
      {
        const trunk = voidTest.trunkTilesFor('region_coldwater', V.region_coldwater, null);
        const nearest = Math.min(...V.region_coldwater.dests.map(d => roomsFor('region_coldwater', d.key)));
        check('the shared trunk is derived, in tiles, and bounded',
          trunk >= voidTest.TRUNK_MIN && trunk <= voidTest.TRUNK_MAX, String(trunk));
        check('…as a fraction of the nearest destination',
          trunk === Math.max(voidTest.TRUNK_MIN, Math.min(voidTest.TRUNK_MAX,
            Math.round(nearest * voidTest.TRUNK_FRACTION))), `${trunk} of ${nearest}`);
        // The fork has to leave something on the other side of it, or committing to a heading is a
        // thing that happens at the gate and never again.
        check('…and every limb is longer than the trunk it hangs off',
          V.region_coldwater.dests.every(d => roomsFor('region_coldwater', d.key) - trunk > 0),
          V.region_coldwater.dests.map(d => `${d.key}=${roomsFor('region_coldwater', d.key) - trunk}`).join(' '));
      }
      // ── ONE JOURNEY, ONE DISTANCE ────────────────────────────────────────────
      // The `route` picker used to print a room count times 90 — the UNANCHORED per-room constant —
      // so it called the Reach 720 tiles while the road it builds is 93 and the mile board on that
      // road's own verge says 31. Eight times apart, on two surfaces describing one journey, which
      // is exactly what the single shared mile conversion exists to prevent.
      const { crossingDistance } = vw;
      for (const [fromKey, def] of Object.entries(V)) {
        for (const d of def.dests || []) {
          const gd = dist(fromKey, d.region);
          const printed = crossingDistance(fromKey, d);
          const label = `${fromKey.replace('region_', '')}→${d.key}`;
          check(`${label}: the picker's distance IS the road's distance`,
            Math.abs(printed - gd) < 1, `${printed.toFixed(0)} vs ${gd.toFixed(0)}`);
          // ⚠ THE NUMBER THAT WOULD HAVE CAUGHT IT. The old arithmetic is off by roughly the ratio
          // between the unanchored constant and the real one (90 to 12), so anything still using it
          // lands several times high. A future edit that quietly reintroduces `rooms × 90` fails
          // here rather than in a player's fuel budget.
          check(`${label}: …and is nowhere near the room-count-times-90 it used to print`,
            printed < roomsFor(fromKey, d.key) * 90 * 0.5,
            `${printed.toFixed(0)} vs ${roomsFor(fromKey, d.key) * 90}`);
        }
      }

      // AND THE RANGE BANDS FOLLOW THE SIM RATHER THAN THE FICTION. Fuel burns `moved / tank` over
      // the real road and the cheapest tank is 850 tiles, so a round trip to the furthest
      // destination fits — which is the honest state of the world and was ALWAYS the honest state
      // of it. The warning that said otherwise was reading the fiction. If a range gate is wanted
      // it goes in the tanks; this asserts only that the surface and the sim now agree.
      const worst = Math.max(...Object.entries(V).flatMap(([k, def]) =>
        (def.dests || []).map(d => crossingDistance(k, d))));
      check('the furthest crossing is within the cheapest tank, both ways', worst * 2 < 850,
        `${worst.toFixed(0)} tiles each way`);
    }
    check('…and so does its back face', r.signs.every(g => leadsAhead(g.back)));
    // The one that would have caught the report: on a two-way road the two faces must not open
    // with the same name, or turning round changes nothing about what the board tells you.
    check('…so the two faces do not open with the same place',
      r.signs.some(g => g.rows.length > 1 && g.back.length > 1 && g.rows[0].n !== g.back[0].n));
    check('…and every back arrow is one of the eight too',
      r.signs.every(g => g.back.every(row => ARROW_WORDS[row.a] !== undefined)));

    // 7. THE BOARD REACHES THE LOG. Swept, not proximity-tested — the text rung covers a slab of
    // road per tick and a proximity test would step straight over most of the boards it passes.
    check('a board a whole tick of road wide is still passed, not stepped over',
      signsBetween(r, gate.s - 200, gate.s + 200).length >= 1);
    check('a board is passed exactly once as the odometer sweeps the whole road',
      r.signs.every(g => signsBetween(r, g.s - 0.5, g.s + 0.5).length === 1));
    check('nothing is passed by standing still', signsBetween(r, 400, 400).length === 0);
    // ⚠ AND THE SWEEP IS UNSIGNED. It answered nothing at all when the odometer went DOWN, so a
    // driver running back toward the origin passed every board on the road without one of them
    // reaching the log — boards that existed for traffic going one way, on a two-way road.
    check('a board is passed driving back down the road too',
      signsBetween(r, gate.s + 0.5, gate.s - 0.5).length === 1);

    // 8. THE RENDER SEAM, for the board specifically. The rows have to survive deriveSurfaceCell or
    // they are a server-side fact nobody can read.
    const g0 = r.signs[0];
    const win = mapWindow({ grid_x: g0.x, grid_y: g0.y }, 2, corridorProvider(r));
    check('a board survives the trip through mapWindow as a mark with its rows on it',
      win[2][2].mark === 'sign' && win[2][2].sgn?.rows?.length === g0.rows.length,
      JSON.stringify(win[2][2].mark));
    check('…carrying BOTH faces, so the renderer picks one rather than mirroring one',
      win[2][2].sgn?.back?.length === g0.rows.length);
  }

  // ── 1b. THE REAL WORLD OUTRANKS THE SYNTHESISED ONE ────────────────────────
  // The bug this exists for deleted Coldwater Basin. The corridor claims every tile within
  // OFFROAD_R of a centreline — that is what makes driving off the road driving rather than a
  // stall — and the three limbs out of a void all leave from the SAME rim tile, heading three
  // different ways. So a tile twenty tiles INSIDE the basin sits barely along the east limb and
  // well within its verge, `locate` answered, and the composite provider painted the city's
  // southern edge as synthesised hardpan. You never saw it driving out, because it was behind you.
  // You saw it the instant you turned round and drove home, and the basin was gone.
  //
  // Needs the world (unlike section 1): the whole point is what happens where real tiles exist.
  {
    const b = worldBounds();
    let real = null;
    for (let y = b.miny; y <= b.maxy && !real; y++) {
      for (let x = b.minx; x <= b.maxx; x++) { const c = surfaceAt(x, y); if (c) { real = { x, y, c }; break; } }
    }
    if (!real) check('a world tile exists to test the provider against', false);
    else {
      // Anchored so the road STARTS on that real tile — the sharpest form of both halves, because
      // its origin is the one tile the corridor most wants to pave and the one the world most
      // obviously owns the ground around.
      const r = corridorFor(VOIDKEY, DESTKEY, 4242, 8, 4, null,
        { x0: real.x, y0: real.y, x1: real.x, y1: real.y + 300 });
      const at = providerFor({ leg: 'corridor', route: r });
      // ── HALF ONE: the road is laid ON the world and wins ─────────────────────
      // ⚠ THIS IS THE HALF THE FIRST FIX BROKE. Giving the world a blanket veto took the tarmac with
      // it — a region's grid is placed ground for a long way past anything anybody would call a
      // town, so a driver came off the end of the Coldwater road into open desert with no road on
      // it at all, which is worse than the bug being fixed.
      const on = corridorPos(r, 6, 0), onx = Math.round(on.x), ony = Math.round(on.y);
      check('the corridor owns its own carriageway, over placed ground or not',
        at(onx, ony)?.flags?.terrain === 'road', String(at(onx, ony)?.flags?.terrain));
      check('…and that really is placed ground, or this case proves nothing',
        !!surfaceAt(onx, ony), 'the probe fell outside the world grid');
      // ── HALF TWO: the ground BESIDE it is filler, and loses ──────────────────
      const side = corridorPos(r, 6, 12), sx = Math.round(side.x), sy = Math.round(side.y);
      const w = surfaceAt(sx, sy);
      check('…but never the ground beside it, where the world has placed some',
        !w || at(sx, sy)?.id === w.id, String(at(sx, sy)?.id));
      check('…and the corridor did claim that tile, so the case is not vacuous',
        !!corridorAt(r, sx, sy) && !isCarriageway(corridorAt(r, sx, sy)));
      // …and the filler still stands where the world places nothing, or the rule would have traded
      // a painted-out basin for a road running through featureless air.
      let fill = null, atS = 0;
      for (let s = 1; s <= r.L && !fill; s++) {
        const p = corridorPos(r, s, 12), px = Math.round(p.x), py = Math.round(p.y);
        if (!surfaceAt(px, py) && corridorAt(r, px, py)) { fill = at(px, py); atS = s; }
      }
      check('…and the verge is still synthesised out where the world places nothing',
        !fill || /^corridor_/.test(String(fill.id)), `${fill?.id} at s=${atS}`);
    }
  }

  // ── 1c. THE ROAD IS THERE BEFORE YOU ARE ───────────────────────────────────
  // The crossing was anchored to whichever rim tile the driver happened to be standing on, so the
  // road's start was not knowable until after they had left — and a highway you cannot locate until
  // you are on it cannot be drawn while you drive up to it. That is the pop-in, and no amount of
  // rendering work fixes it, because there is nothing to render. The gate makes it static.
  {
    // ⚠ EVERY VOID, NOT JUST THE ONE THIS SUITE DRIVES. The fallback (anchor on the tile the driver
    // left from) still exists and still works, and that is exactly the problem: a region whose road
    // never reaches its rim would go on quietly popping its highway in at the edge, with a green
    // suite and nothing to say which region it was. A gate is a content requirement now — if this
    // fails, the region named needs a road authored out to its edge, not a special case here.
    {
      const missing = Object.keys(VOIDS).filter((k) => !regionGates(k).length);
      check('every void has a gate — the tile its own road runs off the map at',
        missing.length === 0, missing.join(', ') || 'all present');
    }
    const gate = regionGates(VOIDKEY)[0];
    check('the suite\'s own void has one', !!gate, VOIDKEY);
    if (gate) {
      const at = surfaceAt(gate.x, gate.y);
      check('…and it really is a road tile of that region',
        isRoadCell(at) && at?.flags?.region_id === VOIDKEY, String(at?.id));
      check('…on the rim, with the map genuinely stopping beside it',
        [[0, -1], [0, 1], [1, 0], [-1, 0]].some(([dx, dy]) => !surfaceAt(gate.x + dx, gate.y + dy)));
      // ⚠ AND IT IS STABLE. `getAllZones()` yields a Map's insertion order and a content import can
      // reshuffle it; a gate that moved with that would silently move every road in the game.
      _clearGateCache();
      const again = regionGates(VOIDKEY)[0];
      check('…and picking it twice picks the same tile', again?.id === gate.id, String(again?.id));
    }
    // ── GATES ARE PLURAL, AND THE NETWORK TURNS ON THAT ──────────────────────
    // The design this is heading for is a road network where a region has several exits and a
    // neighbour is reached through whichever one faces it, worked out from the map. A singular gate
    // bakes the opposite assumption into every caller, so there is no singular gate — these pin the
    // contract while every region still happens to publish one, which is the only time it is cheap
    // to get wrong and impossible to notice.
    for (const k of Object.keys(VOIDS)) {
      const gs = regionGates(k);
      check(`${k} publishes its ways out as a list`, Array.isArray(gs) && gs.length >= 1, String(gs.length));
      // ⚠ ONE MOUTH IS ONE EXIT. A road is two or three tiles wide by the time it reaches the rim
      // (it has to be — see the 8-connectivity invariant), so unclustered candidates come out as
      // clumps and a single way out of town would publish itself as four gates.
      check(`…clustered, so one road out of ${k} is one gate`, gs.every((g) => !gs.some((h) =>
        h !== g && Math.abs(h.x - g.x) <= 1 && Math.abs(h.y - g.y) <= 1)));
    }
    // WHICH EXIT FACES WHICH NEIGHBOUR — the question the network turns on, answered from the map.
    // With one exit each it degenerates to the only possible answer, so it is live and exercised
    // long before any region grows a second.
    {
      const dest = (VOIDS[VOIDKEY]?.dests || []).find((d) => d.region && regionGates(d.region).length);
      if (dest) {
        const pair = gatePair(VOIDKEY, dest.region);
        check('a road knows which exit at each end it joins', !!pair?.from && !!pair?.to);
        // Nearest pair wins — that IS "nearby regions share a road and use the exits facing it".
        const all = [];
        for (const a of regionGates(VOIDKEY)) for (const b of regionGates(dest.region)) {
          all.push({ a, b, d2: (a.x - b.x) ** 2 + (a.y - b.y) ** 2 });
        }
        all.sort((p, q) => p.d2 - q.d2);
        check('…and it is the pair of exits that actually face each other',
          pair.from.id === all[0].a.id && pair.to.id === all[0].b.id);
        // ⚠ UNORDERED. Asking from the other end must name the same two tiles, or the road between
        // two towns is two roads again — which is the whole of what phase 1 is for.
        const back = gatePair(dest.region, VOIDKEY);
        check('…and asking from the far end names the same two exits',
          back?.from.id === pair.to.id && back?.to.id === pair.from.id);
      }
    }
    // A rig standing in the region sees the corridor from the city leg. This is the fix, stated as
    // the thing a driver would notice: road, out past the edge of the world, from on the map.
    if (gate) {
      const rig = { leg: 'city', x: gate.x, y: gate.y };
      const provider = providerFor(rig);
      const pre = _previewRoute(VOIDKEY, voidTest.currentWindow());
      check('the approach can see the road before the crossing exists', !!pre);
      if (pre) {
        let seen = null;
        for (let s = 4; s <= 60 && !seen; s += 2) {
          const p = corridorPos(pre, s, 0), px = Math.round(p.x), py = Math.round(p.y);
          if (!surfaceAt(px, py) && provider(px, py)?.flags?.terrain === 'road') seen = s;
        }
        check('…out past the edge of the map, from a truck still standing on it', seen !== null,
          seen === null ? 'no corridor road visible off-map from the city leg' : `s=${seen}`);
        check('…and it starts on the gate, not on wherever somebody happened to stand',
          Math.hypot(corridorPos(pre, 0, 0).x - gate.x, corridorPos(pre, 0, 0).y - gate.y) < 0.01);
      }
    }
  }

  // ── 1c-bis. THE ROAD EXISTS FOR EVERYBODY, NOT JUST FOR THE TRUCK ON IT ────
  // The corridor has been anchored in real world coordinates since the frame change, and the only
  // thing that ever looked at it was the cab of the truck on it. So the flight sim rendered the
  // same journey as nothing at all — `kind: 'air'` over 282 tiles of tarmac — and `truckContactsNear`
  // dropped corridor rigs on the honest grounds that the corridor was not in anybody's world window.
  // roadnet.js builds the week's whole network from the gates, and flight takes it as a cell
  // provider. These are the four things that has to mean.
  {
    const win = voidTest.currentWindow();
    clearRoadNet();
    const net = roadNetwork(win);
    check('the world has a road network without anybody driving on it',
      net.routes.length > 0, `${net.routes.length} roads`);

    // ⚠ ONE ROAD PER PAIR OF GATES, NOT ONE PER DESTINATION ROW. VOIDS lists both directions of
    // every leg and `networkRoute` hands back the same tarmac for both, so building every row lays
    // each highway twice on top of itself — and the two copies carry different destKeys and
    // different boards, so which one answered for a tile would depend on iteration order.
    {
      const pairs = new Set();
      for (const k of Object.keys(VOIDS)) {
        for (const d of VOIDS[k].dests || []) {
          const p = d.region ? gatePair(k, d.region) : null;
          if (p) pairs.add(pairKey(p.from.id, p.to.id));
        }
      }
      check('…one road per PAIR of gates, not one per direction',
        net.routes.length === pairs.size, `${net.routes.length} built vs ${pairs.size} pairs`);
    }

    const pre = _previewRoute(VOIDKEY, win);
    const provider = worldRoadProvider();
    if (pre) {
      // THE WHOLE POINT, STATED AS A COMPARISON. The driver reads their own route; everybody else
      // reads the network. If those two ever answer differently for a tile, a truck and the plane
      // above it are looking at different ground — which is the defect this exists to close, and it
      // would be invisible from either seat.
      let tested = 0, agreed = 0, bad = null, shared = 0, sharedBad = null;
      // A tile several roads pave still has to BE a road to the pilot. That is the whole claim for
      // the shared-spoke tiles, and it is the one that would fail if the picker ever handed back a
      // verge or nothing at all.
      const check_shared = (cell, px, py) => {
        shared++;
        if (!isCarriageway(cell) && !sharedBad) sharedBad = `${px},${py} → ${cell?.name || 'nothing'}`;
      };
      // ⚠ THE DIRECTION-OF-TRAVEL FIELDS ARE COMPARED MODULO THE DIRECTION, AND THAT IS THE HONEST
      // INVARIANT RATHER THAN A WEAKENED ONE. `road_deg` is the heading of the road AS DRIVEN and
      // `road_t` is the tile's offset to the RIGHT of that heading, so a road built from the far
      // end reports both flipped — 9.3° vs 189.3°, −0.365 vs +0.365, on the same piece of tarmac.
      // That asymmetry is not something this overlay introduced: it is exactly what two drivers
      // passing each other have always seen, because each builds the road from their own end. The
      // renderer takes `road_deg` as an undirected line (the marking span is symmetric about the
      // tile and `road_t` shifts the paint back along a normal derived from the same angle, so both
      // flips cancel), which is why the picture is identical. What must NOT differ is the road:
      // where the tarmac is, how wide, how many lanes, what it is surfaced in.
      // ⚠ WRAPPED BOTH WAYS. JS `%` keeps the sign of its left operand, so the tidy
      // `((a - b + 90) % 180) - 90` reads 0 when the driver is the larger angle and 180 when the
      // pilot is — the same pair of headings passing or failing depending on argument order. It
      // cost a debugging pass on a test that was reporting a bug the code did not have.
      const sameLine = (a, b) => { const d = ((a - b) % 180 + 180) % 180; return Math.min(d, 180 - d) < 0.5; };
      for (let s = 6; s < Math.min(pre.L, 600); s += 7) {
        const p = corridorPos(pre, s, 0);
        const px = Math.round(p.x), py = Math.round(p.y);
        if (surfaceAt(px, py)) continue;              // over placed ground the world wins for both
        const driver = corridorAt(pre, px, py);
        if (!driver || !isCarriageway(driver)) continue;
        // ⚠ TILES TWO ROADS BOTH PAVE ARE SKIPPED, AND THEY ARE A THIRD OF THE NETWORK. Every road
        // leaving a gate runs down the SAME spoke to its interchange — that is what makes the fork
        // a place rather than a room boundary — so near a mouth several roads genuinely share one
        // piece of tarmac. The pilot gets the nearest centreline, which on shared tarmac may be a
        // different road's; both answers are the same ground. What is asserted for those tiles is
        // the thing that matters (it is still road, never air), just below.
        const claims = roadNetwork(win).routes.filter((r) => corridorAt(r, px, py)?.flags?.terrain === 'road');
        const pilot = provider(px, py);
        if (claims.length > 1) { check_shared(pilot, px, py); continue; }
        tested++;
        const df = driver.flags, pf = pilot?.flags || {};
        if (pilot && isCarriageway(pilot) && pf.terrain === df.terrain && pf.icon === df.icon
          && pf.road_lanes === df.road_lanes && Math.abs((pf.road_w || 0) - (df.road_w || 0)) < 1e-9
          && Math.abs(Math.abs(pf.road_t || 0) - Math.abs(df.road_t || 0)) < 1e-9
          && sameLine(pf.road_deg || 0, df.road_deg || 0) && !!pf.road_dirt === !!df.road_dirt) agreed++;
        else if (!bad) bad = `${px},${py}: driver ${df.icon}/${df.road_deg}/${df.road_lanes} vs pilot ${pf.icon}/${pf.road_deg}/${pf.road_lanes}`;
      }
      check('the pilot and the driver see the same tarmac, tile for tile',
        tested > 0 && agreed === tested, bad || `${agreed}/${tested} tiles`);
      check('…and where several roads share a spoke, it is still road under the plane',
        !sharedBad, sharedBad || `${shared} shared tile(s) all road`);

      // ⚠ AND IT IS STILL NOT PLACED GROUND. `regionGates` finds a road mouth by testing that the
      // map STOPS beside it, and voidwalking's `isMapRim` opens the void on the same question — so
      // an overlay that leaked into `surfaceAt` would delete every gate, every rim and the void's
      // only entrance, while looking exactly like this feature working.
      const mid = corridorPos(pre, pre.L / 2, 0);
      const mx = Math.round(mid.x), my = Math.round(mid.y);
      check('…over ground the placed world still says is not there', surfaceAt(mx, my) === null);
      check('…so the gates the road hangs off still exist', regionGates(VOIDKEY).length > 0);
      {
        // ⚠ THE ZONE, NOT THE SURFACE CELL. `surfaceAt` hands back a light `{id,name,flags,danger}`
        // with no `map_id` or coordinates on it, so `rimDirs` reads it as "not a placed tile" and
        // answers `[]` — which looks exactly like the rim having been destroyed. It cost a
        // debugging pass to find that out; it costs one comment not to.
        const g = regionGates(VOIDKEY)[0];
        const gz = (await import('../../server/engine/world.js')).getZone(g.id);
        check('…and the rim the void opens at is still a rim',
          voidTest.rimDirs(gz).length > 0, `${voidTest.rimDirs(gz).join(',') || 'none'} at ${g.x},${g.y}`);
      }

      // END TO END, THROUGH THE RENDERER. Not "the provider returns a cell" — `mapWindow` +
      // `deriveSurfaceCell` is what actually reaches the canopy, and the pair below is the before
      // and the after of this whole change in two numbers.
      const count = (at) => {
        let road = 0, air = 0;
        for (const row of mapWindow({ grid_x: mx, grid_y: my }, 8, at)) {
          for (const c of row) { if (c.road) road++; if (c.kind === 'air') air++; }
        }
        return { road, air };
      };
      const withRoad = count(provider), bare = count(surfaceAt);
      check('a pilot over the highway sees highway', withRoad.road > 0,
        `${withRoad.road} road cells, ${withRoad.air} air`);
      check('…where the placed world alone shows open air and nothing else',
        bare.road === 0 && bare.air > 0, `${bare.road} road / ${bare.air} air`);

      // TRAFFIC, THE OTHER HALF. A road nobody can be seen on is scenery.
      {
        const fake = { playerId: 'rt_road', leg: 'corridor', route: pre, x: mid.x, y: mid.y,
          heading: 180, speed: 45, typeId: 'hauler', cd: {}, trailer: null, type: { name: 'Test Rig' } };
        rigs.set('rt_road', fake);
        const seen = truckContactsNear(mid.x, mid.y, 26);
        check('a truck on the highway is traffic a pilot can see',
          seen.some((c) => c.id === 'truck_rt_road'), `${seen.length} contacts`);
        // ⚠ THE LEGACY LOCAL FRAME IS STILL WITHHELD, and that is not belt and braces: an
        // unanchored route measures x/y from the gate, so those are good positions in a coordinate
        // system nothing else uses. Reported as world tiles they put a truck off the map, drawn
        // confidently, with nothing to say it was wrong.
        fake.route = { ...pre, anchored: false };
        check('…and one in the legacy local frame is not',
          !truckContactsNear(mid.x, mid.y, 26).some((c) => c.id === 'truck_rt_road'));
        rigs.delete('rt_road');
      }
    }

    // A miss costs one Map lookup and answers null — the case that runs 26,000 times a push for a
    // pilot who is nowhere near a road.
    check('a tile nowhere near a road has no road on it', roadCellAt(-9999, -9999) === null);

    // ── EVERY REGION REACHES EVERY NEIGHBOUR THROUGH THE EXIT THAT FACES IT ──
    //
    // ⚠ THIS IS THE TEST THAT CATCHES A NEW ROAD RE-ROUTING AN OLD ONE, AND IT HAS ALREADY EARNED
    // ITSELF ONCE. `gatePair` takes the NEAREST pair of mouths, so paving a new one anywhere in a
    // region silently re-aims every road that region already had if the new mouth happens to be
    // closer. Running the Reach's Scarletwastes road straight out the end of Main Street put a
    // mouth 92.1 tiles from Coldwater's gate against the existing 93.2 — and the Coldwater highway,
    // shipped and named for on both sides, moved to the other end of town with nothing to say so.
    // (It leaves by the Field Road instead, one row south, which is further from Coldwater and
    // nearer to the Scarletwastes.) Nothing about that failure is visible in a diff.
    for (const fromKey of Object.keys(VOIDS)) {
      for (const d of VOIDS[fromKey].dests || []) {
        if (!d.region) continue;
        const pair = gatePair(fromKey, d.region);
        if (!pair) continue;
        const A = regionGates(fromKey), B = regionGates(d.region);
        let best = null;
        for (const a of A) for (const b of B) {
          const d2 = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
          if (!best || d2 < best.d2) best = { a, b, d2 };
        }
        check(`${fromKey}→${d.key} leaves by the mouth that faces it`,
          pair.from.id === best.a.id && pair.to.id === best.b.id,
          `${pair.from.id} → ${pair.to.id}`);
      }
    }
    // The two pairings the new Reach↔Scarletwastes edge could have stolen, named explicitly so a
    // failure says WHICH road moved rather than "a pairing changed".
    {
      const cw = gatePair('region_coldwater', 'region_the_reach');
      check('the Coldwater highway still lands on the Reach road named after it',
        cw?.to?.id === 'zone_the_reach_863_1955', String(cw?.to?.id));
      const scw = gatePair('region_the_reach', 'region_scarletwastes');
      check('…and the Scarletwastes road leaves the Reach by the Field Road, not Main Street',
        scw?.from?.id === 'zone_the_reach_882_1959', String(scw?.from?.id));
    }
  }

  // ── 1d. THE FORK IS A THING YOU CAN DRIVE INTO ─────────────────────────────
  // Both limbs are synthesised and rendered, and `locate` only ever asked the road you were
  // nominally on — so putting your wheels on the other one changed nothing, and following it far
  // enough separated the limbs past OFFROAD_R and bogged you: stalled, on what is unmistakably a
  // road, for no reason the windscreen could explain. The only real way to take a junction was to
  // type a destination at it, which is a menu rather than a fork.
  {
    const plan = { origin: 'Coldwater Basin', dests: [
      { key: DESTKEY, name: 'The Reach', nodes: 8, x: 910, y: 1042 },
      { key: 'exodus', name: 'Terminus', nodes: 8, x: 1000, y: 1020 },
    ] };
    const r = corridorFor(VOIDKEY, DESTKEY, 4242, 8, 4, plan, { x0: 918, y0: 947, x1: 910, y1: 1042 });
    const sib = r.branches?.[0];
    check('a route carries the limb it did not take', !!sib, String(r.branches?.length));
    if (sib) {
      // A point on the sibling's own centreline past the junction — somewhere a driver who steered
      // across at the fork and kept going would actually be.
      let onSib = null;
      for (let s = r.trunkL + 4; s <= sib.route.L && !onSib; s += 2) {
        const p = corridorPos(sib.route, s, 0);
        const theirs = corridorLocate(sib.route, p.x, p.y);
        if (!theirs || Math.abs(theirs.t) > pavedAt(sib.route, theirs.s)) continue;
        const ours = corridorLocate(r, p.x, p.y);
        // ⚠ THE PRECONDITION FOR THE WHOLE FEATURE, and it is the OLD BEHAVIOUR stated as a test:
        // standing on the other limb's tarmac, our own road either does not hold us at all (a bog,
        // stalled on what is unmistakably a road) or holds us out in its verge (driving down a road
        // the game does not think we are on). Both are the same bug from different distances.
        if (!ours || Math.abs(ours.t) > pavedAt(r, ours.s)) onSib = { p, s, ours, theirs };
      }
      check('there is tarmac on the far limb that our own road does not hold us on', !!onSib);
      if (onSib) {
        check('…the wheels are squarely on the sibling\'s carriageway there',
          Math.abs(onSib.theirs.t) <= pavedAt(sib.route, onSib.theirs.s), onSib.theirs.t.toFixed(2));
        check('…and that is exactly what used to bog you, or drive you down the wrong road',
          !onSib.ours || Math.abs(onSib.ours.t) > pavedAt(r, onSib.ours.s),
          onSib.ours ? `verge t=${onSib.ours.t.toFixed(1)}` : 'no fix at all — a bog');
      }
      // ── ⚠ AND NOTHING MAY STEER FOR YOU ON THE WAY ACROSS ────────────────────
      // Taking an exit means leaving one limb before reaching the other, and for that moment the
      // road you are on has let go. `bogged` is `!hit`, and being bogged snaps you to the centreline
      // of the road you were LEAVING, facing down it — the client adopts that pose wholesale. So
      // requiring the sibling's carriageway before handing you over put a force on the wheel at
      // exactly the place a driver is steering hardest: you steered off, and the truck steered back.
      // Bogging means NO road has you. These walk the gap and assert somebody always does.
      {
        let stranded = null;
        for (let s = r.trunkL + 2; s <= Math.min(r.L, sib.route.L) - 2 && !stranded; s += 3) {
          const on = corridorPos(sib.route, s, 0);          // where the far limb's tarmac is
          const from = corridorLocate(r, on.x, on.y);
          if (!from) continue;                              // already fully off ours — covered above
          // Step across from our centreline toward theirs, the way a driver actually does it.
          const here = corridorPos(r, from.s, 0);
          for (let k = 0.1; k <= 1 && !stranded; k += 0.1) {
            const px = here.x + (on.x - here.x) * k, py = here.y + (on.y - here.y) * k;
            const ours = corridorLocate(r, px, py);
            const theirs = corridorLocate(sib.route, px, py);
            if (!ours && !theirs) stranded = `s=${s.toFixed(0)} k=${k.toFixed(1)}`;
          }
        }
        check('crossing between the limbs, some road always has you — nothing bogs you mid-exit',
          !stranded, stranded);
      }
    }
  }

  // ── 1e. A ROAD MADE OF SEGMENTS ────────────────────────────────────────────
  // The network's enabling primitive: a road becomes gate → interchange → interchange → gate, so
  // every road out of a gate can share its spoke, the middle can be seeded on the PAIR, and a hub
  // is just an interchange more than two roads meet at. Built by CONCATENATION rather than by
  // teaching the wander about waypoints — every invariant of a segment stays a property the
  // existing builder already guarantees, and what is tested here is only the joining.
  {
    const A = corridorFor(VOIDKEY, DESTKEY, 4242, 8, 4, null, { x0: 918, y0: 947, x1: 910, y1: 1000 });
    const B = corridorFor(VOIDKEY, 'exodus', 4242, 8, 4, null, { x0: 910, y0: 1000, x1: 910, y1: 1042 });
    const J = joinRoutes([A, B]);
    check('joining two segments gives one road as long as both', Math.abs(J.L - (A.L + B.L)) < 1e-6,
      `${J.L.toFixed(1)} vs ${(A.L + B.L).toFixed(1)}`);
    check('…with one continuous leg list', J.legs.length === A.legs.length + B.legs.length);
    // ⚠ THE ODOMETER HAS TO RUN THROUGH THE SEAM. If `s` restarts or jumps, every single thing
    // downstream is wrong at once — arrival, the node index, the fuel burn, the mile boards.
    let broken = null;
    for (let i = 1; i < J.legs.length && !broken; i++) {
      if (Math.abs(J.legs[i].s0 - J.legs[i - 1].s1) > 1e-6) broken = `leg ${i}`;
    }
    check('…and an odometer that runs continuously across the seam', !broken, broken);
    check('…so a point on the second segment reads past the first',
      corridorLocate(J, corridorPos(J, A.L + 20, 0).x, corridorPos(J, A.L + 20, 0).y)?.s > A.L,
      String(corridorLocate(J, corridorPos(J, A.L + 20, 0).x, corridorPos(J, A.L + 20, 0).y)?.s?.toFixed(1)));
    // The spoke out of the gate is the trunk, which is what moves the fork to the interchange
    // rather than leaving it at a room boundary.
    check('the first segment is the trunk — the spoke every road out of the gate shares',
      Math.abs(J.trunkL - A.L) < 1e-6, J.trunkL.toFixed(1));
    // ⚠ A room is a fraction of the WHOLE road. Carried off the first segment it would walk a
    // driver off the end of the chain somewhere in the middle of the second.
    check('…and a room is a fraction of the whole road, not of its first piece',
      Math.abs(J.roomLen - J.L / J.nodes) < 1e-6);
    // ⚠ The seam is a real change of direction, and `signsFor` boards a fixed distance BEFORE each
    // bend — without this the one turn a driver most needs telling about has no sign on it.
    check('…and the seam registers as a bend, so it gets a board',
      (J.bends || []).some((b) => b.seam && Math.abs(b.s - A.L) < 1e-6));
    // Reversing it is the other half of "one road, both directions".
    const R = reverseRoute(J);
    check('a reversed road is the same length', Math.abs(R.L - J.L) < 1e-6);
    check('…and its start is the other road\'s end',
      Math.hypot(corridorPos(R, 0, 0).x - corridorPos(J, J.L, 0).x,
        corridorPos(R, 0, 0).y - corridorPos(J, J.L, 0).y) < 0.01);
    check('…and it is the SAME tarmac, not a similar road', (() => {
      for (let s = 5; s < J.L - 5; s += 17) {
        const p = corridorPos(J, s, 0), q = corridorPos(R, R.L - s, 0);
        if (Math.hypot(p.x - q.x, p.y - q.y) > 0.02) return false;
      }
      return true;
    })());
  }

  // ── 1f. THE NETWORK: GATE → INTERCHANGE → INTERCHANGE → GATE ───────────────
  // The shape the whole thing has been heading for. A hub is nothing more than an interchange that
  // several roads meet at, so nothing here has to know which kind it is.
  {
    const a = VOIDKEY, b = (VOIDS[VOIDKEY]?.dests || []).find((d) => d.region && regionGates(d.region).length)?.region;
    check('there are two regions with gates to build a road between', !!b, String(b));
    if (b) {
      const win = voidTest.currentWindow();
      const AB = networkRoute(a, b, win, 8), BA = networkRoute(b, a, win, 8);
      check('a network road is built end to end', !!AB && !!BA);
      if (AB && BA) {
        const ga = gatePair(a, b);
        check('it starts on the gate it leaves and ends on the gate it arrives at',
          Math.hypot(corridorPos(AB, 0, 0).x - ga.from.x, corridorPos(AB, 0, 0).y - ga.from.y) < 0.01
          && Math.hypot(corridorPos(AB, AB.L, 0).x - ga.to.x, corridorPos(AB, AB.L, 0).y - ga.to.y) < 0.01);
        // ⚠ THE HEADLINE INVARIANT OF THE WHOLE PHASE. Driving out and driving back must retrace ONE
        // road. Built from either end, the tarmac has to be the same tarmac — not a similar road
        // that happens to join the same two towns, which is what shipped before.
        check('…and the same length in both directions', Math.abs(AB.L - BA.L) < 0.01,
          `${AB.L.toFixed(1)} vs ${BA.L.toFixed(1)}`);
        let worst = 0;
        for (let s = 2; s < AB.L - 2; s += 13) {
          const p = corridorPos(AB, s, 0), q = corridorPos(BA, BA.L - s, 0);
          worst = Math.max(worst, Math.hypot(p.x - q.x, p.y - q.y));
        }
        check('…and driving it back is the SAME ROAD, not a second one between the same towns',
          worst < 0.05, `worst divergence ${worst.toFixed(3)} tiles`);
        // The spoke is shared by every road out of that gate, which is what moves the fork to a
        // place. Two destinations from the same gate must lay identical tarmac until the interchange.
        // ⚠ A SHARED SPOKE MEANS "THESE ROADS START OFF THE SAME WAY", AND THAT IS A CONDITION, NOT
        // A GUARANTEE. One interchange per gate does not survive Coldwater — the Reach is south,
        // Terminus east, Deadwater west, a fan of over 120° — so whichever way a single junction
        // faced, one road would have to leave it through a hairpin, which folds the verge through
        // itself. A gate therefore grows as many interchanges as its destinations need, and roads
        // share a spoke exactly when they genuinely go the same way. So the test is per PAIR: same
        // interchange ⇒ same tarmac to it; different interchange ⇒ they part at the gate, which is
        // the honest answer for two roads heading 120° apart.
        for (const other of (VOIDS[a]?.dests || [])) {
          if (!other.region || other.region === b || !regionGates(other.region).length) continue;
          const AC = networkRoute(a, other.region, win, 8);
          if (!AC) continue;
          const iB = interchangeFor(a, gatePair(a, b).from, b);
          const iC = interchangeFor(a, gatePair(a, other.region).from, other.region);
          const shared = Math.hypot(iB.x - iC.x, iB.y - iC.y) < 0.01;
          let same = true;
          for (let s = 1; s < Math.min(AB.trunkL, AC.trunkL) - 1 && same; s += 7) {
            const p = corridorPos(AB, s, 0), q = corridorPos(AC, s, 0);
            if (Math.hypot(p.x - q.x, p.y - q.y) > 0.05) same = false;
          }
          check(`roads to ${b} and ${other.region} share a spoke exactly when they share an interchange`,
            same === shared, shared ? 'same junction, different tarmac' : 'different junctions, same tarmac');
        }
        check('…and a road parts from its neighbours at an interchange, not at the gate',
          AB.trunkL > 20, AB.trunkL.toFixed(1));
        // Every destination is served by a junction it can leave without a hairpin — the bound that
        // decides how many junctions a gate grows in the first place.
        for (const d of (VOIDS[a]?.dests || [])) {
          if (!d.region || !regionGates(d.region).length) continue;
          const gp = gatePair(a, d.region), ic = interchangeFor(a, gp.from, d.region);
          const toIc = Math.atan2(ic.x - gp.from.x, -(ic.y - gp.from.y)) * 180 / Math.PI;
          const toDest = Math.atan2(gp.to.x - gp.from.x, -(gp.to.y - gp.from.y)) * 180 / Math.PI;
          const off = Math.abs(((toDest - toIc) % 360 + 540) % 360 - 180);
          check(`…and ${d.region} is served by a junction it can leave without a hairpin`,
            off <= 40, `${off.toFixed(0)}° off`);
        }
        // The odometer still has to survive the whole thing, or none of the above matters.
        let bad = null;
        for (let s = 0; s <= AB.L && !bad; s += 3) {
          const p = corridorPos(AB, s, 0);
          const hit = corridorLocate(AB, p.x, p.y);
          if (!hit || Math.abs(hit.s - s) > 1.5) bad = `s=${s.toFixed(0)} → ${hit ? hit.s.toFixed(1) : 'NO FIX'}`;
        }
        check('…and the odometer round-trips the whole road, through both seams', !bad, bad);

        // ── THE SHAPE CASES, ON THE ROAD PEOPLE ACTUALLY DRIVE ────────────────
        // ⚠ The pinned sinuosity/bend/connectivity cases further up build with `corridorFor`
        // directly, so they describe the pre-network road — which is still real (it is the
        // fallback), and is no longer what a driver is on. Every invariant that mattered about a
        // road has to be re-asserted about THIS one, or the suite is green about the wrong object.
        const road = buildRoad(a, 'reach', b, win, 8, [{ key: 'reach', name: 'The Reach', region: b, nodes: 8 }]);
        check('the driven road is assembled with its identity and its boards on it',
          !!road && road.destKey === 'reach' && road.segments.length === 3);
        // THE FOLD INVARIANT, and it matters more here than anywhere: the road now has SEAMS, and a
        // seam is exactly where two pieces of geometry could fail to touch.
        {
          const paved = new Set();
          for (let s = 0; s <= road.L; s += 0.5) {
            for (let t = -PAVED_R; t <= PAVED_R; t += 0.4) {
              const p = corridorPos(road, s, t), px = Math.round(p.x), py = Math.round(p.y);
              if (corridorAt(road, px, py)?.flags.terrain === 'road') paved.add(`${px},${py}`);
            }
          }
          const seen = new Set(), stack = [paved.values().next().value];
          seen.add(stack[0]);
          while (stack.length) {
            const [px, py] = stack.pop().split(',').map(Number);
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
              const k = `${px + dx},${py + dy}`;
              if (paved.has(k) && !seen.has(k)) { seen.add(k); stack.push(k); }
            }
          }
          check('…and its tarmac is one unbroken piece, seams and all',
            seen.size === paved.size, `${seen.size}/${paved.size} tiles connected`);
        }
        // Every void room still has road in it. A road that skipped one would strand a driver in a
        // room the chain says they must pass through.
        {
          const rooms = new Set();
          for (let s = 0; s < road.L; s += road.L / 400) rooms.add(nodeAt(road, s));
          check('…and every room of the chain is still reachable by driving it', rooms.size === 8,
            `${rooms.size}/8`);
        }
        // ⚠ THE SEAM IS A CORNER, AND A CORNER HAS A LIMIT. Two segments are built independently and
        // meet at the interchange, so the heading can change by any amount at all there — and the
        // fold invariant is not a style rule: cells are classified by distance from the centreline
        // out to OFFROAD_R, so a turn tighter than that radius folds the verge through itself and
        // `locate` hands out two answers for one tile. A 90° kink at an interchange would do it.
        {
          let worstTurn = 0, at = null;
          for (const seg of [road.trunkL, road.trunkL + road.segments[1].L]) {
            const before = corridorPos(road, Math.max(0, seg - 2), 0).heading;
            const after = corridorPos(road, Math.min(road.L, seg + 2), 0).heading;
            const turn = Math.abs(((after - before) % 360 + 540) % 360 - 180);
            if (turn > worstTurn) { worstTurn = turn; at = seg; }
          }
          check('…and no seam turns sharper than the road is allowed to bend',
            worstTurn <= 60, `${worstTurn.toFixed(0)}° at s=${at?.toFixed(0)}`);
        }
        check('…and it puts up boards, worked out from the finished shape', road.signs.length >= 2,
          `${road.signs.length} boards`);
        // The seam gets one, which is the whole reason `joinRoutes` marks it as a bend — the
        // interchange is the one turn a driver most needs telling about.
        check('…including one on the approach to the interchange',
          road.signs.some((g) => Math.abs(g.s - road.trunkL) < 60), road.signs.map((g) => g.s | 0).join(','));
        // ── THE INTERCHANGE IS SOMETHING YOU CAN SEE ──────────────────────────
        // The junction line has said "the graded road splits around a stand of dead pylons" for a
        // long time, and there were no pylons — it fired on a node crossing and the windscreen
        // showed the same empty verge as everywhere else. That gap is worse now that the fork is a
        // PLACE rather than a room boundary, because a place you cannot see is a room boundary with
        // a better comment.
        check('an interchange has the pylons the junction line has always promised',
          (road.junctions || []).length >= 2, `${road.junctions?.length ?? 0} pylons`);
        {
          const marked = (road.junctions || []).filter((j) =>
            corridorAt(road, j.x, j.y)?.flags?.junction_pylons === 1);
          check('…standing on real tiles, so the renderer is handed something',
            marked.length === road.junctions.length, `${marked.length}/${road.junctions.length}`);
          // ⚠ ON THE VERGE. The thing marking a junction must never be a thing you drive into: the
          // sweep collides against anything solid, and a landmark you hit at the one place you are
          // choosing a road is the worst possible place to put an obstacle.
          check('…clear of the tarmac and the shoulder, so it is never something you hit',
            road.junctions.every((j) => {
              const hit = corridorLocate(road, j.x, j.y);
              return hit && Math.abs(hit.t) > pavedAt(road, hit.s) + 1.0;
            }));
          check('…and it survives deriveSurfaceCell as a mark the windscreen knows',
            mapWindow({ grid_x: road.junctions[0].x, grid_y: road.junctions[0].y }, 1,
              corridorProvider(road))[1][1].mark === 'pylons');
        }
      }
    }
  }

  // ── 2. The render seam ─────────────────────────────────────────────────────
  // The corridor must go through mapWindow and come back as a drawn road. If this breaks, the
  // truck is driving through a void with no world in it and nothing else here would notice.
  {
    const route = corridorFor(VOIDKEY, DESTKEY, 4242, 8);
    const p = corridorPos(route, 200, 0);
    const win = mapWindow({ grid_x: Math.round(p.x), grid_y: Math.round(p.y) }, 4, corridorProvider(route));
    const centre = win[4][4];
    check('the corridor renders through the SAME mapWindow the flight sim uses',
      centre.road === 1 && !!centre.rd, JSON.stringify(centre));
    // Nobody has resurfaced this road since the basin emptied, and the renderer derives the whole
    // worn look (bleached tar, sand drift, dead paint, patches) from this one bit. A city street
    // never carries it, which is what keeps every other road in the game pixel-identical.
    check('the highway ships stamped unmaintained, and the stamp survives the render seam',
      centre.wr === 1, String(centre.wr));
    check('a straight highway renders straight, not as a crossroads',
      centre.rd === 'ns' || centre.rd === 'ew', centre.rd);
    // Sample beyond the OFF-ROAD limit, not merely beyond the tarmac: the verge is drivable ground
    // now and renders as ground, so a window that only reached the pavement edge would be asserting
    // the opposite of the rule. Past the limit there is genuinely nothing, and that is what must
    // still be true — the road ends in open air, never in a wall.
    const wide = mapWindow({ grid_x: Math.round(p.x), grid_y: Math.round(p.y) }, OFFROAD_R + 3,
      corridorProvider(route));
    check('past the off-road limit the window renders open air', wide[0][0].kind === 'air', wide[0][0].kind);
    check('the cab window is smaller than the cockpit\'s', CAB_RADIUS < 36, CAB_RADIUS);
    // The cab's LOD ring has to fit inside the cab's own draw limit, and for the whole of THE LONG
    // HAUL it did not. The renderer draws out to (CAB_RADIUS - 1) tiles, and RENDER_TUNE's 'lodFar'
    // - a number calibrated for an aircraft asking for 36 - ships at 32. With a 30-tile window that
    // is four tiles PAST the edge of everything a driver can ever see, so no building in the cab
    // reached the cheap LOD tier at any distance and the expensive full-detail arm ran for the
    // entire visible city. Nothing looked wrong; it was only slow, which is exactly the kind of
    // defect that survives for months.
    //
    // CAB_VIEW_TUNE fixes the numbers; this is the guard that keeps them honest. The failure comes
    // back silently the moment somebody changes CAB_RADIUS without re-deriving the ring, and the
    // only symptom it has is frame rate.
    const drawFar = CAB_RADIUS - 1;
    check('the cab LOD ring finishes inside the cab draw limit',
      CAB_VIEW_TUNE.lodFar < drawFar, 'lodFar ' + CAB_VIEW_TUNE.lodFar + ' vs draw limit ' + drawFar);
    check('the cab LOD ring is ordered and starts inside it',
      CAB_VIEW_TUNE.lodNear > 0 && CAB_VIEW_TUNE.lodNear < CAB_VIEW_TUNE.lodFar,
      'lodNear ' + CAB_VIEW_TUNE.lodNear);
    // Same trap, same cause: a cull distance further out than the draw limit is a cull that never
    // fires. Both of these were the aircraft's numbers too.
    check('the cab culls rooftop signage and shadows inside the draw limit',
      CAB_VIEW_TUNE.decoFar < drawFar && CAB_VIEW_TUNE.shadowFar < drawFar,
      'decoFar ' + CAB_VIEW_TUNE.decoFar + ' shadowFar ' + CAB_VIEW_TUNE.shadowFar);
  }

  // ── 3. The clamp ───────────────────────────────────────────────────────────
  // The odometer is the only economically meaningful number a driving client reports, so it is the
  // only one defended hard. These cases are the anti-cheat.
  {
    const route = corridorFor(VOIDKEY, DESTKEY, 4242, 8);
    const rig = { route, chain: new Array(8), s: 0, t: 0, x: 0, y: 0, heading: 180, speed: 0, node: 0, lastSync: 0, bogged: false };
    const start = corridorPos(route, 0, 0); rig.x = start.x; rig.y = start.y;

    // The odometer is DERIVED from the reported position against the server's own corridor, so a
    // teleport is a position a long way down the road — not a big number in the `s` field. One
    // second of wall-clock buys at most one second of flat-out road either way.
    const away = corridorPos(route, 400, 0);
    reconcileTruck(rig, { s: 99999, t: 0, hdg: 180, spd: 68, x: away.x, y: away.y }, 1000);
    check('a client teleporting down the road gets clamped to what a second could cover',
      rig.s <= topTilesPerSec() * 1 + 0.001, rig.s.toFixed(3));
    check('…and that is a real distance, not zero', rig.s > 0.5, rig.s.toFixed(3));
    // The client cannot buy road by inflating the odometer field either: park it back at the start
    // and claim a huge `s` — the position is what counts, and the position says otherwise.
    // NOTE: timestamps below must ASCEND. reconcileTruck has a cadence guard (MIN_SYNC_MS) that
    // early-returns on frames closer together than the client's report interval, and a `now` that
    // goes backwards reads as a zero-length gap — every later case would silently no-op and pass.
    const held = rig.s;
    reconcileTruck(rig, { s: 99999, t: 0, hdg: 180, spd: 68, x: start.x, y: start.y }, 2000);
    check('the odometer is derived from POSITION, not from what the client claims',
      rig.s < held + 0.001, `${held.toFixed(3)} -> ${rig.s.toFixed(3)}`);

    // ── BACKTRACKING ────────────────────────────────────────────────────────
    // The odometer used to be floored at its own previous value, and this case asserted it "never
    // runs backwards". That is deliberately no longer true: phase 2 shipped a reverse gear,
    // nothing is paid per tile (a delivery pays a flat sum on arrival), and a walker in the same
    // crossing has always been able to turn round and go back out the way they came. The floor
    // made the truck the only thing in the void that could not.
    //
    // What has to survive is the ANTI-CHEAT, and it was never about direction — it was about RATE.
    // So the property under test flips from "monotonic" to "symmetric envelope": you may go back,
    // and going back is clamped exactly as hard as going forward.
    // ⚠ DRIVE IT OUT FIRST. The case above leaves the rig back at the gate with s already at the
    // floor, so testing "can it go backwards" from there measures nothing — 0 → 0 passes a
    // monotonic clamp and a symmetric one identically. Walk it out to real road, one clamped
    // second at a time, before asking whether it can come back.
    for (let t = 3000, i = 0; i < 20; i++, t += 1000) {
      const fwd = corridorPos(route, 60, 0);
      reconcileTruck(rig, { s: 60, t: 0, hdg: 180, spd: 68, x: fwd.x, y: fwd.y }, t);
    }
    check('…and it can be driven back out to real road', rig.s > 10, rig.s.toFixed(3));

    const was = rig.s;
    reconcileTruck(rig, { s: 0, t: 0, hdg: 0, spd: 0, x: start.x, y: start.y }, 23000);
    check('the odometer CAN run backwards — a truck may turn round like a walker',
      rig.s < was, `${was.toFixed(3)} -> ${rig.s.toFixed(3)}`);
    check('…but no faster backwards than a second of road', rig.s >= was - (topTilesPerSec() + 0.001),
      `moved ${(was - rig.s).toFixed(3)} in 1s, cap ${topTilesPerSec().toFixed(3)}`);
    // And it cannot be driven below the gate: s = 0 is the rim tile you left, not a negative
    // number the node bucketing would read off the front of the chain as `undefined`.
    for (let t = 24000; t < 49000; t += 1000) {
      reconcileTruck(rig, { s: 0, t: 0, hdg: 0, spd: 0, x: start.x, y: start.y }, t);
    }
    check('…and the odometer floors at the gate rather than going negative',
      rig.s >= 0 && rig.s < 1, rig.s.toFixed(3));

    // Lateral is bounded but not defended — nothing economic depends on it.
    reconcileTruck(rig, { s: rig.s, t: 9999, hdg: 180, spd: 0, x: start.x, y: start.y }, 50000);
    check('lateral offset is bounded to the corridor', Math.abs(rig.t) <= route.R, rig.t);

    // RUNNING DRY HAS TO BITE. For a long time the gauge counted to zero and the truck carried on,
    // which made every tank number in the fleet a decoration. A tank that never empties is not a
    // constraint, and the whole range ladder rests on this.
    {
      const r2 = corridorFor(VOIDKEY, DESTKEY, 4242, 8);
      const dry = { route: r2, chain: new Array(8), leg: 'corridor', s: 0, t: 0, heading: 180,
        speed: 60, node: 0, lastSync: 0, fuel: 0.001, type: TYPES.scrapper };
      const p0 = corridorPos(r2, 0, 0); dry.x = p0.x; dry.y = p0.y;
      const p1 = corridorPos(r2, 40, 0);
      reconcileTruck(dry, { s: 40, t: 0, hdg: 180, spd: 60, x: p1.x, y: p1.y }, 1000);
      check('running the tank out stops the truck', dry.dry === true && dry.speed === 0,
        `dry=${dry.dry} speed=${dry.speed}`);
      check('…and it does not quietly refill itself', dry.fuel === 0, dry.fuel);
      const p2 = corridorPos(r2, 80, 0);
      reconcileTruck(dry, { s: 80, t: 0, hdg: 180, spd: 60, x: p2.x, y: p2.y }, 2000);
      check('…and stays stopped however fast the client claims to be going', dry.speed === 0, dry.speed);
    }

    // Off the corridor entirely is reported as bogged, so the caller can apply the law.
    const lost = reconcileTruck(rig, { s: rig.s, t: 0, hdg: 180, spd: 40, x: 99999, y: 99999 }, 51000);
    check('driving off the corridor reports bogged, not a collision', lost.bogged === true);
  }

  // ── 4. Surface classification ──────────────────────────────────────────────
  // The corridor speaks TERRAIN and the physics model speaks SURFACE; this is the only mapping
  // between them, so a rename on either side has to fail here rather than in play.
  {
    const route = corridorFor(VOIDKEY, DESTKEY, 4242, 8);
    const mk = (s, t) => { const p = corridorPos(route, s, t); return { route, x: p.x, y: p.y }; };
    check('the centreline classifies as road', surfaceUnder(mk(200, 0)) === 'road');
    // Sweep outward for the shoulder rather than naming an offset — see the band-order note above:
    // the shoulder is about a tile wide and the road is at an angle, so any fixed `t` is a coin flip
    // once rounded onto the grid. What has to hold is that a shoulder EXISTS between the two.
    let firstShoulder = null;
    for (let t = 0; t <= CORRIDOR_R && firstShoulder === null; t += 0.1) {
      if (surfaceUnder(mk(200, t)) === 'shoulder') firstShoulder = t;
    }
    check('there is a shoulder between the tarmac and the verge', firstShoulder !== null, firstShoulder);
    check('the verge classifies as offroad', surfaceUnder(mk(200, 5)) === 'offroad');
    check('beyond the corridor classifies as offroad', surfaceUnder({ route, x: 9e5, y: 9e5 }) === 'offroad');
    for (const name of ['road', 'shoulder', 'offroad']) {
      check(`the model knows the surface "${name}" the corridor can produce`, !!SURFACES[name]);
    }
    // The server's clamp duplicates two knobs from the client model on purpose (see state.js).
    // If they drift the clamp gets LOOSER, never tighter — but they should not drift silently.
    const p = TYPES.hauler;
    check('the server clamp still matches the client model\'s top speed',
      topTilesPerSec() > p.topSpeed / p.tileMph, `${topTilesPerSec().toFixed(3)} vs ${(p.topSpeed / p.tileMph).toFixed(3)}`);
  }

  // ── 4a. The gearbox ────────────────────────────────────────────────────────
  // The one system in the sim you drive with your EARS, so the cases are about whether the box
  // has opinions — a gearbox where every gear works is a gearbox nobody shifts.
  {
    const p = TYPES.hauler;
    const pull = (gear, secs = 15, input = {}) => {
      const s = createTruckState(p); s.gear = gear;
      for (let i = 0; i < secs * 60; i++) {
        step(s, { throttle: 1, brake: 0, steer: 0, surface: 'road', ...input }, p, 1 / 60);
      }
      return s;
    };
    // ⚠ MEASURED FROM REST, WHICH IS A SHORT WINDOW. `pull` runs full throttle for `secs`, and the
    // property under test is which gear pulls HARDER off the line — not which one has the most road
    // speed left after a quarter of a minute. With the ceiling doubled, first now redlines at 18mph
    // and runs out of revs inside the old 15s window, so third overtakes it and the case failed on a
    // truck whose low gears are working exactly as intended. Six seconds is still 'from rest'.
    const g1 = pull(1), g3 = pull(3), g8 = pull(8);
    const r1 = pull(1, 6), r3 = pull(3, 6), r8 = pull(8, 6);
    check('first gear pulls away from rest', g1.speed > 10, g1.speed.toFixed(1));
    // A LOW GEAR PULLS HARDER, and until weight arrived this case asserted the opposite — third
    // beat first — because `drive` read the throttle and the band but never the ratio, so gears
    // differed only in where they put the revs. That is invisible bobtail and fatal loaded.
    check('a low gear out-accelerates a high one from rest', r1.speed > r3.speed && r3.speed > r8.speed,
      `1:${r1.speed.toFixed(1)} 3:${r3.speed.toFixed(1)} 8:${r8.speed.toFixed(1)}`);
    check('pulling away in top gear STALLS the engine', g8.stalled === true && g8.speed < 1,
      `${g8.speed.toFixed(1)} mph, stalled=${g8.stalled}`);

    // THE CLASSIC. Coming to a stop without going down the box has to punish you, or the whole
    // lever is decoration; going down the box, or dipping the clutch, has to save you.
    const brakeDown = (input) => {
      const s = createTruckState(p); s.gear = 6; s.speed = 45;
      for (let i = 0; i < 600; i++) {
        // Down the box the way a driver does it: keep the gear the band wants for the speed you
        // are actually doing. (A hand-written speed ladder was tried first and lagged the braking,
        // which is exactly the mistake the driver makes and not the one being tested for.)
        if (input.downshift && s.gear > bestGear(s.speed, p)) truckShift(s, p, -1);
        step(s, { throttle: 0, brake: 1, steer: 0, surface: 'road', clutch: input.clutch || 0 }, p, 1 / 60);
      }
      return s;
    };
    check('braking to a stop in sixth stalls it', brakeDown({}).stalled === true);
    check('…but going down the box saves it', brakeDown({ downshift: true }).stalled === false);
    check('…and so does the clutch', brakeDown({ clutch: 1 }).stalled === false);

    // Parking must never be a stall. A driver crawling into a bay in third has done nothing wrong.
    // ⚠ AND 'PARKING SPEED' IS A NUMBER ON THE DIAL, WHICH MOVED. The ceiling doubled without
    // `tileMph`, so the needle now reads twice what it did for the same ground covered — the crawl
    // that was 3mph is 6mph. And the GEAR moved with it: the ladder came down to put the new ceiling
    // in top, so third is now 16–26mph and a bay crawl belongs in second, exactly as it would in a
    // vehicle that tops at a hundred. Left in third at a walking pace this case asserts that a truck
    // can idle along at a third of the speed the gear is geared for, which is a stall in anything.
    const crawl = createTruckState(p); crawl.gear = 2; crawl.speed = 6;
    for (let i = 0; i < 300; i++) step(crawl, { throttle: 0.15, brake: 0, steer: 0, surface: 'road' }, p, 1 / 60);
    check('crawling at parking speed does not stall', crawl.stalled === false, crawl.speed.toFixed(1));

    // The Jake is only worth a lever if it out-brakes coasting in the same gear.
    const coastTo = (jake) => {
      const s = createTruckState(p); s.gear = 6; s.speed = 50;
      for (let i = 0; i < 120; i++) step(s, { throttle: 0, brake: 0, steer: 0, surface: 'road', jake }, p, 1 / 60);
      return s.speed;
    };
    check('the Jake brake holds a descent better than coasting does', coastTo(1) < coastTo(0) - 1,
      `${coastTo(1).toFixed(1)} vs ${coastTo(0).toFixed(1)}`);

    // The splitter used to chain on truckShift's return value, which is a GEAR NUMBER — so a split
    // into neutral was falsy and left `split` lying. It round-trips or it is not a lever.
    const sp = createTruckState(p); sp.gear = 4;
    truckSplit(sp, p); const mid = { g: sp.gear, s: sp.split };
    truckSplit(sp, p);
    check('the splitter round-trips to the gear it started in',
      sp.gear === 4 && sp.split === false, `${mid.g}/${mid.s} -> ${sp.gear}/${sp.split}`);

    // Every truck has to be drivable, not just the one the cab happens to default to.
    for (const [id, t] of Object.entries(TYPES)) {
      if (!t.ground) continue;
      const s = createTruckState(t); s.gear = 1;
      for (let i = 0; i < 900; i++) step(s, { throttle: 1, brake: 0, steer: 0, surface: 'road' }, t, 1 / 60);
      check(`the ${t.name} pulls away in first without stalling`, s.speed > 8 && !s.stalled,
        `${s.speed.toFixed(1)} mph, stalled=${s.stalled}`);
      check(`the ${t.name}'s torque band is inside its rev range`, t.band[0] > 0 && t.band[1] < 1 && t.band[0] < t.band[1],
        `${id}: ${t.band}`);
    }
  }

  // ── 4c. The rig ────────────────────────────────────────────────────────────
  // Phase 2. Every case here is about ONE scalar — the articulation angle — plus the weight that
  // feeds it, because everything people mean by "it handles like a semi" is those two.
  {
    const p = TYPES.drayman;
    const mk = (loadKg, hitch = true) => {
      const s = createTruckState(p);
      if (hitch) truckHitch(s, p, { loadKg });
      s.gear = 1;
      return s;
    };
    const run = (s, inp, secs) => {
      for (let i = 0; i < secs * 60; i++) step(s, { steer: 0, throttle: 0, brake: 0, surface: 'road', ...inp }, p, 1 / 60);
      return s;
    };

    // Hitching is a stopped, lined-up act — and the MODEL says so, not the verb, so the rule the
    // player feels and the rule the server enforces cannot drift apart.
    const rolling = createTruckState(p); rolling.speed = 30;
    check('you cannot hitch at speed', truckHitch(rolling, p) === false && !rolling.hitched);
    const still = createTruckState(p);
    check('you can hitch stopped', truckHitch(still, p) === true && still.hitched);
    check('a fresh trailer starts straight behind you', still.phi === 0);
    still.speed = 30;
    check('you cannot drop a trailer at speed', truckUnhitch(still) === null && still.hitched);
    still.speed = 0;
    check('you can drop it stopped, and it remembers its weight',
      truckUnhitch(still)?.kg === p.trailerKg && !still.hitched);

    // The load is bounded by what the deck is rated for — the same number `market buy` sizes a
    // purchase against. An unbounded load is not a hard truck to drive, it is one that cannot move.
    const over = createTruckState(p); truckHitch(over, p, { loadKg: 999999 });
    check('the deck rating clamps the load rather than immobilising the truck', over.loadKg === p.kg, over.loadKg);

    // Weight, in the two places it is supposed to show and the one place it isn't.
    const accel = (load, hitch) => run(mk(load, hitch), { throttle: 1, auto: 1 }, 18).speed;
    check('bobtail out-accelerates the same truck loaded', accel(0, false) > accel(p.kg, true) + 4,
      `${accel(0, false).toFixed(1)} vs ${accel(p.kg, true).toFixed(1)}`);
    const stopDist = (load, hitch) => {
      const s = mk(load, hitch); s.gear = 7; s.speed = 55;
      let d = 0;
      for (let i = 0; i < 60 * 60 && s.speed > 1; i++) { run(s, { brake: 1 }, 1 / 60); d += s.speed / 3600; }
      return d;
    };
    const [empty, laden] = [stopDist(0, false), stopDist(p.kg, true)];
    check('a loaded rig takes appreciably longer to STOP', laden > empty * 1.5, `${empty.toFixed(2)} vs ${laden.toFixed(2)}`);

    // The trailer follows in a turn, and φ is a real angle rather than a number that only ever sits
    // at zero — which is exactly what a wrongly-signed constraint looks like from the outside.
    const turn = run(mk(0), { throttle: 0.6, steer: 0.35, auto: 1 }, 10);
    check('the trailer takes up an angle in a steady turn', Math.abs(turn.phi) > 3, turn.phi.toFixed(1));
    check('…and does not fold doing something ordinary', Math.abs(turn.phi) < 55, turn.phi.toFixed(1));
    check('…and never passes the physical limit', Math.abs(turn.phi) <= 88.001, turn.phi.toFixed(1));

    // REVERSE. Two things: it must actually go backwards loaded (reverse borrows first gear, is
    // capped below the crawl window and is therefore permanently on a slipping clutch — the first
    // cut could not back a loaded trailer out of a bay at all), and it must invert the constraint,
    // because the trailer running away from you is the entire reason backing one is a skill.
    for (const [id, t] of Object.entries(TYPES)) {
      if (!t.ground) continue;
      const s = createTruckState(t); truckHitch(s, t, { loadKg: t.kg }); s.gear = -1;
      // ⚠ AND THIS IS A WINDOW, NOT A SPEED — the same trap the `pull` note above documents, and it
      // sprung the same way. The property under test is that a loaded rig GOES BACKWARDS, not that
      // it reaches two miles an hour inside seven seconds; that number was only ever the old
      // acceleration written down. `INERTIA` (flight-model.js) doubled how long every truck takes to
      // wind up, which left three of the four at about −1.1 in the old window while still pulling
      // perfectly well toward a cap four times that. Fifteen seconds is still "out of a bay", and it
      // puts the slowest truck in the fleet a third clear of the threshold rather than a hair over.
      // Not longer: at twenty the Courier has wound its trailer onto the PHI_MAX clamp, and a fixture
      // sitting on a saturated constraint stops measuring the thing the second check reads off it.
      for (let i = 0; i < 900; i++) step(s, { steer: 0.3, throttle: 0.7, brake: 0, surface: 'road' }, t, 1 / 60);
      check(`the ${t.name} can back a loaded trailer up`, s.speed < -2, `${s.speed.toFixed(1)} mph`);
      check(`…and reversing swings the trailer instead of straightening it`, Math.abs(s.phi) > 1, s.phi.toFixed(1));
    }

    // BRAKE FADE, and the reason the gearbox pays off on a descent: the pedal heats, the engine
    // brake does not. Riding one down a grade has to cost you something the other doesn't.
    const grade = (jake) => {
      const s = mk(p.kg); s.gear = 7; s.speed = 50;
      for (let i = 0; i < 45 * 60; i++) {
        s.speed = Math.max(s.speed, 45);                    // the hill keeps pushing — that IS the grade
        step(s, { steer: 0, throttle: 0, brake: jake ? 0 : 1, jake, surface: 'road' }, p, 1 / 60);
      }
      return s.brakeTemp;
    };
    check('riding the service brakes down a grade heats them', grade(0) > FADE_AT, grade(0).toFixed(2));
    check('…and holding a gear on the Jake keeps them cold', grade(1) < 0.05, grade(1).toFixed(2));
    const cold = mk(0);
    check('an ordinary drive never fades the brakes',
      run(cold, { throttle: 0.6, auto: 1 }, 30).brakeTemp < FADE_AT, cold.brakeTemp.toFixed(2));
  }

  // ── 4d. Trailers as world objects ──────────────────────────────────────────
  // Phase 2.9. The point of the whole phase is that a dropped box is a THING IN A PLACE — so these
  // cases are about persistence and about the one place a trailer may never be left.
  {
    const T = 'zone_regress_trailerdrop';
    const prevT = world.zones.get(T);
    world.zones.set(T, mkZone(T, 'Drop Yard', { map_id: 'map_world', grid_x: 3100, grid_y: 3100, flags: { truck_depot: { name: 'Drop Yard', yard: T } } }));
    try {
      const made = await buyTrailer(player.id, 'box', T);
      check('a bought trailer stands in the yard it was bought in', made?.parkedZone === T, made?.parkedZone);
      check('…and is listed as standing there', (await trailersAt(T)).some(t => t.id === made.id));

      // The load stays ON the box. That is the whole reason the phase exists.
      await saveLoad(made.id, { kind: 'goods', key: 'scrap', name: 'scrap', kg: 900, qty: 9 }, null);
      const again = await getTrailer(made.id);
      check('a load left on a dropped trailer is still on it', again?.cargo?.kg === 900, JSON.stringify(again?.cargo));

      // One trailer, one truck — enforced by a partial unique index rather than by a code path
      // that has to remember to check, so two drivers racing for one box is a lost UPDATE.
      const first = await hitchTrailer(made.id, 'truck_a', T);
      const second = await hitchTrailer(made.id, 'truck_b', T);
      check('the first truck to back under it gets it', first?.towedBy === 'truck_a', first?.towedBy);
      check('…and the second is told somebody beat them to it', second === null);
      check('…and a hitched trailer is standing nowhere', (await trailersAt(T)).length === 0);

      const back = await dropTrailer(made.id, T);
      check('dropping it puts it back on its legs', back?.parkedZone === T && !back.towedBy);

      // RULE 2, and it is the one that protects somebody's freight: a transient void room is torn
      // down with the crossing, so a trailer left in one would be a row pointing at nothing.
      check('a real map tile can hold a trailer', canDrop(world.zones.get(T)));
      check('a coordless void room can NEVER hold one',
        !canDrop(mkZone('zone_regress_voidish', 'Nowhere')));

      const rated = { flat: 2200, box: 3600, reefer: 4200, tank: 6000 };
      for (const t of TRAILER_TYPES) {
        check(`the ${t.id} is rated for what the lot says`, t.rated === rated[t.id], `${t.rated}`);
        // The real rule is not "cheaper than a truck" (a reefer should out-price a Barrow) — it is
        // that a box never costs more than the tractor that would pull it, or the ladder inverts
        // and the sensible first purchase stops being a truck.
        check(`…and never out-prices the top of the fleet`, t.price < TYPES.continental.price,
          `${t.price} vs ${TYPES.continental.price}`);
        check(`…and buys capacity in step with what it costs`, (t.rated / t.price) > 0.6,
          `${t.rated}kg for ${t.price}₵`);
      }
      await query('DELETE FROM trailers WHERE owner_id = $1', [player.id]).catch(() => {});
    } finally {
      if (prevT) world.zones.set(T, prevT); else world.zones.delete(T);
    }
  }

  // ── 4d-bis. THE BOX IS STILL ON THE BACK, WHICHEVER DOOR YOU CAME IN BY ────
  // A driver stopped out on the void road, climbed down and climbed back up, and their trailer was
  // gone. It was not: `park` never unhitches (only `dropTrailer` clears `towed_by`), so the row
  // still pointed at the tractor — and because a towed box holds no `parked_zone` it was in no
  // yard either, so it was invisible in every surface at once.
  //
  // The cause was that there are THREE ways into a cab and only one of them read the hitch back.
  // `drive` reaches the crossing mount before the depot path, so out on the road the restore could
  // never run. These cases pin the invariant rather than the route: hydrating a bare rig from a
  // truck row puts the trailer and its load back, and it is the one funnel every path goes through.
  {
    const { hydrateFromTruck } = truckTest;
    const Z = 'zone_regress_hitchback';
    const prevZ = world.zones.get(Z);
    world.zones.set(Z, mkZone(Z, 'Test Roadhead', { map_id: 'map_world', grid_x: 3300, grid_y: 3300 }));
    let truck = null, box = null;
    try {
      check('the mount helper is reachable from every path that needs it', typeof hydrateFromTruck === 'function');
      truck = await buyTruck(player.id, 'hauler', Z, 'REGRESS');
      box = await buyTrailer(player.id, 'box', Z);
      check('a bought box starts standing in the yard', !!box && box.parkedZone === Z && !box.towedBy);
      check('…and hitches to the tractor', await hitchTrailer(box.id, truck.id, Z));

      // THE BUG, AS A TEST. mountRig builds every rig bobtail on purpose; the hydrate is what puts
      // the box back. A rig that skipped it is the exact state the driver was handed.
      const bare = { playerId: player.id, trailer: null, cargo: null };
      await hydrateFromTruck(bare, await getTruck(truck.id, player.id));
      check('hydrating from the truck row puts the trailer back on the pin', bare.trailer?.id === box.id);
      check('…and it is the truck you own, not a generic rig', bare.truckId === truck.id && !!bare.params);

      // AND THE LOAD RIDES WITH IT, because cargo lives on the trailer row — a restored box that
      // dropped its freight would be the same bug one step quieter.
      await saveLoad(box.id, { kind: 'goods', key: 'scrap', name: 'scrap', kg: 900, qty: 9 }, null);
      const bare2 = { playerId: player.id, trailer: null, cargo: null };
      await hydrateFromTruck(bare2, await getTruck(truck.id, player.id));
      check('…and the load on it comes back too', bare2.cargo?.key === 'scrap' && bare2.trailer?.id === box.id);

      // ⚠ AND A HITCHED BOX IS IN NO YARD, which is why forgetting the read looked like a deletion
      // rather than like a rig that had simply been built wrong.
      check('a towed box stands in no yard, so it cannot be found by looking for it',
        !(await trailersAt(Z)).some(t => t.id === box.id));
    } finally {
      if (box) await query('DELETE FROM trailers WHERE id = $1', [box.id]).catch(() => {});
      if (truck) await query('DELETE FROM trucks WHERE id = $1', [truck.id]).catch(() => {});
      if (prevZ) world.zones.set(Z, prevZ); else world.zones.delete(Z);
    }
  }

  // ── 4d-ter. SELLING THE TRACTOR MUST NOT ORPHAN THE BOX ────────────────────
  // A player's yard listed THREE reefers 'on the pin' and they owned one truck. The other two were
  // hitched to tractors that had been sold months apart: `sellTruck` is a bare DELETE and
  // `towed_by` is a plain TEXT column with no foreign key, so nothing anywhere stopped the trailer
  // row outliving the truck it pointed at.
  //
  // ⚠ AND THE RESULT IS NOT A MISLABELLED ROW, IT IS AN UNREACHABLE ONE, which is why this is a
  // case rather than a copy fix. A towed box holds no `parked_zone`, so `trailersAt` cannot see it
  // and it is standing in no yard; it holds a `towed_by`, so `hitchTrailer` (guarded on IS NULL),
  // `sellTrailer` (same guard) and BOTH branches of `yardSellTrailer` refuse it. Four figures of
  // capital, listed on the panel, and nothing a player can type will ever touch it again.
  //
  // So the case sells a truck with a box on the pin through the real verb, and then asks the two
  // questions the owner would ask: is it standing here, and can I get rid of it?
  {
    const D = 'zone_regress_sellyard';
    const prevD = world.zones.get(D);
    const savedZone = player.current_zone, savedCredits = player.credits || 0;
    world.zones.set(D, mkZone(D, 'Test Yard', {
      map_id: 'map_world', grid_x: 3310, grid_y: 3310,
      flags: { truck_depot: { name: 'Test Yard', yard: D } },
    }));
    removePlayerFromZone(player.id, savedZone);
    player.current_zone = D; addPlayerToZone(player.id, D);
    setLivePlayer(player.id, player);   // (pid, data) — see the ⚠ on the one-arg call above
    let truck = null, box = null;
    try {
      truck = await buyTruck(player.id, 'hauler', D, 'REGRESS');
      box = await buyTrailer(player.id, 'box', D);
      check('a box is on the pin before the tractor is sold', !!await hitchTrailer(box.id, truck.id, D));

      const sold = await run(`yard sell ${truck.id}`);
      check('a truck with a trailer on it still sells', /Sold the/i.test(sold?.message || ''), sold?.message?.slice(0, 60));
      check('…and the line says what happened to the box, rather than leaving it to be discovered',
        /pin|legs|standing/i.test(sold?.message || ''), sold?.message?.slice(0, 120));

      const after = await getTrailer(box.id);
      check('THE BUG: the box comes off the pin instead of following the truck into the void',
        !!after && !after.towedBy, after?.towedBy || 'off the pin');
      check('…onto the concrete of the yard it was sold in, where it can be found again',
        after?.parkedZone === D, after?.parkedZone);
      check('…so looking for what is standing here finds it',
        (await trailersAt(D)).some(t => t.id === box.id));

      // The whole point of the drop: it is an ORDINARY trailer again. Through the verb, not through
      // `sellTrailer` — the orphan's other half was that both branches of the sale could not reach
      // it, and a helper call would prove the easy half and skip the one that failed.
      const gone = await run(`yard sell ${box.id}`);
      check('…and it is a box you can now actually get rid of', /Sold/i.test(gone?.message || ''), gone?.message?.slice(0, 60));
      check('…which really left the table', !await getTrailer(box.id));
    } finally {
      if (box) await query('DELETE FROM trailers WHERE id = $1', [box.id]).catch(() => {});
      if (truck) await query('DELETE FROM trucks WHERE id = $1', [truck.id]).catch(() => {});
      removePlayerFromZone(player.id, player.current_zone);
      player.current_zone = savedZone; addPlayerToZone(player.id, savedZone);
      setLivePlayer(player.id, player);
      player.credits = savedCredits;
      if (prevD) world.zones.set(D, prevD); else world.zones.delete(D);
    }
  }

  // ── 4e. The scale house ────────────────────────────────────────────────────
  // Phase 3, and the only genuinely new idea in the system: THE SCALE DETECTS WEIGHT, NOT
  // CONTRABAND. Every case here is a restatement of that sentence, because every interesting
  // property of the design is downstream of it.
  {
    const S = 'zone_regress_scale';
    const prevS = world.zones.get(S);
    world.zones.set(S, mkZone(S, 'Test Scale', { map_id: 'map_world', grid_x: 3200, grid_y: 3200, flags: { weigh_station: { name: 'the test scale' } } }));
    const LAWLESS = 'zone_regress_scale_lawless';
    world.zones.set(LAWLESS, mkZone(LAWLESS, 'Lawless Scale', { map_id: 'map_world', grid_x: 3201, grid_y: 3200, flags: { weigh_station: true, lawless: true } }));
    try {
      const box = { id: 'trl_test', name: 'a dry box', kg: 1400, ratedKg: 3600, cargo: null, stash: null };
      const rig = { playerId: player.id, truckId: null, trailer: box, speed: 40 };
      const zone = world.zones.get(S);

      check('a weigh station is content, not code', !!scaleAt(zone), 'weigh_station flag');
      check('…and a lawless region never runs one', !scaleAt(world.zones.get(LAWLESS)));

      // BOBTAIL AND HONEST BOTH PASS, and they pass for the same reason: no discrepancy. Nothing
      // about WHAT you are carrying enters into it anywhere.
      check('a bobtail rig has nothing to weigh',
        (await runScale(player, { ...rig, trailer: null }, zone)) === null);
      box.cargo = { kind: 'goods', key: 'scrap', name: 'scrap', kg: 2000, qty: 20 };
      check('a declared load matching the manifest passes',
        (await runScale(player, rig, zone)) === null);

      // ── SOMEBODY LOOKS IN THE CAB ────────────────────────────────────────
      // The other half of the fugitive fork, and the half that was never built: the sleeper was
      // fast, free and had no risk attached at all, so 'pickup sleeper' was strictly correct and
      // the eighty kilos in the trailer bought nothing. These cases pin the two properties that
      // make the fork a fork, and the one property that must NOT change.
      {
        const seat = (kind, inTrailer) => ({ ...rig, rider: { id: kind, inTrailer, look: 'a thin figure' } });

        // ⚠ THE ONE THAT MUST NOT CHANGE. This is the whole scale house in one line: it is looking
        // at the PAPER against the PLATES. A cab check that also fired at the weighbridge — or one
        // that taught the weighbridge to recognise a person — would collapse "weight, not
        // contraband" into the generic contraband scanner this building was designed not to be.
        const honest = seat('fugitive', false);
        await afterDrive(player, honest, zone);
        check('the cab check is a SEPARATE law — it never touches the weighbridge',
          (await runScale(player, rig, zone)) === null);

        // Found, every time, because the design's own sentence is that anyone who looks FINDS them.
        // A roll here would make that a lie and hand the sleeper back its free ride.
        check('a fugitive in the sleeper is found at a scale house', honest.rider === null);

        // ⚠ BOBTAIL, which is the case that made this reachable at all. 'runScale' returns
        // immediately with nothing on the pin — correct for a weighbridge — so a driver carrying a
        // person and no trailer was never inspected by anything.
        const bob = { ...seat('fugitive', false), trailer: null };
        await afterDrive(player, bob, zone);
        check('…and bobtail too, where there is nothing to weigh at all', bob.rider === null);

        // A lift is not a crime. Three of the four kinds are ordinary people and a check that took
        // everybody would make them unpickable on any lawful road for a reason nobody could name.
        const lift = seat('mechanic', false);
        await afterDrive(player, lift, zone);
        check('giving an ordinary person a lift is not a crime', lift.rider !== null);

        // THE TRAILER RIDER IS THE SCALE'S, NOT THE CAB CHECK'S. They are caught as eighty kilos
        // that are not on the paper — the right answer, reached without anybody knowing what the
        // eighty kilos is, which is the entire point of the building.
        const boxed = seat('fugitive', true);
        await afterDrive(player, boxed, zone);
        check('somebody in the box is not found by looking in the cab', boxed.rider !== null);

        // …and a lawless region runs neither law.
        const free = seat('fugitive', false);
        await afterDrive(player, free, world.zones.get(LAWLESS));
        check('a lawless region does not look in the cab either', free.rider !== null);
        clearCustoms(player.id);
      }

      // THE LIE. Eight hundred kilos behind the bulkhead is past the certainty threshold's roll and
      // the scale does not care what it is — it cares that the numbers disagree.
      box.stash = [{ itemId: 'x', name: 'a crate', kg: 2800 }];
      const caught = await runScale(player, rig, zone);
      check('undeclared weight stops the truck', !!caught, caught && `${caught.over}kg over`);
      check('…and the scale knows only the DISCREPANCY, never what it is',
        caught && caught.over === 2800 && !('contraband' in caught), JSON.stringify(Object.keys(caught || {})));
      clearCustoms(player.id);

      // HONEST GREED FAILS THE SAME SCALE. Nothing hidden at all — just more than the plate allows —
      // and it is the same interaction with the same three answers. That is the whole texture.
      //
      // 6,500 kg, NOT 6,000, and the extra half-tonne is the whole point: at 6,000 the load came out
      // 2,400 kg over its plate, which is UNDER `CERTAIN_KG` (2,500) — so the scale rolled Deception
      // for it, and the case was a coin flip on the fixture player's skill rather than an assertion
      // about the system. It passed locally and failed in CI, which is exactly how a flake announces
      // itself. Past the certainty threshold there is no roll and the three claims below are about
      // the design instead of about a die.
      box.stash = null;
      box.cargo = { kind: 'goods', key: 'scrap', name: 'scrap', kg: 6500, qty: 65 };
      const heavy = await runScale(player, rig, zone);
      check('a LEGAL overweight load fails the same scale', !!heavy, heavy && `${heavy.overRated}kg over rating`);
      check('…and is charged as weight, not as crime', heavy && heavy.over === 0 && heavy.overRated > 0,
        heavy && `over=${heavy.over} overRated=${heavy.overRated}`);
      check('…and carries a fine proportional to the overload', heavy && heavy.fine > 0, heavy?.fine);
      clearCustoms(player.id);

      // The tolerance exists so the system is a decision rather than a tax.
      box.cargo = { kind: 'goods', key: 'scrap', name: 'scrap', kg: 2000, qty: 20 };
      box.stash = [{ itemId: 'x', name: 'a parcel', kg: 40 }];
      check('a trivial discrepancy is beneath a weighbridge\'s notice',
        (await runScale(player, rig, zone)) === null);
      clearCustoms(player.id);
    } finally {
      clearCustoms(player.id);
      if (prevS) world.zones.set(S, prevS); else world.zones.delete(S);
      world.zones.delete(LAWLESS);
    }
  }

  // ── 4f. People on the shoulder ─────────────────────────────────────────────
  {
    const route = corridorFor(VOIDKEY, DESTKEY, 4242, 8);
    const at = (n) => hitcherAt(route, n, 8);
    check('the same stretch has the same person on it all week',
      JSON.stringify(at(3)) === JSON.stringify(hitcherAt(corridorFor(VOIDKEY, DESTKEY, 4242, 8), 3, 8)));
    check('…and a different one next week',
      JSON.stringify(at(3)) !== JSON.stringify(hitcherAt(corridorFor(VOIDKEY, DESTKEY, 4243, 8), 3, 8))
      || at(3) === null);
    check('nobody is standing at the gate you just left', at(0) === null);
    check('…nor within sight of the far town', at(7) === null);
    let found = 0;
    for (let n = 0; n < 8; n++) if (at(n)) found++;
    check('the road is not lined with them', found <= 3, `${found} of 8 nodes`);
    check('every hitcher is one of the authored kinds',
      [...Array(8).keys()].every(n => !at(n) || HITCHER_KINDS.some(k => k.id === at(n).id)));
    // The fugitive is the one that closes the design: a person in the box is weight the scale sees.
    check('the roster includes somebody who is contraband with legs',
      HITCHER_KINDS.some(k => k.id === 'fugitive'));

    // ── THE DOORS ────────────────────────────────────────────────────────────
    // 'pickup' is now the INVITATION rather than the only way in: stop on the corridor with the
    // latches up beside somebody with their hand out and they let themselves into the seat.
    {
      const who = HITCHER_KINDS.find(k => k.id === 'fugitive');
      const mk = (over = {}) => ({ leg: 'corridor', node: 3, speed: 0, cd: {}, rider: null, ...over });
      const T0 = 1000000;

      // ⚠ THE DWELL. A speed gate on its own turns easing off for a bend into an unavoidable
      // passenger, so the first tick only STARTS the clock and nothing happens until you have
      // genuinely stood still.
      const r1 = mk();
      check('slowing down is not stopping — the first tick only starts the clock',
        tryDoorBoard(r1, who, T0) === null && r1.rider === null);
      check('…and a moment later is still not long enough',
        tryDoorBoard(r1, who, T0 + 1500) === null);
      check('stopped long enough, somebody lets themselves in',
        !!tryDoorBoard(r1, who, T0 + 4000) && r1.rider?.id === 'fugitive');

      // ⚠ ALWAYS THE SEAT. Nobody climbs into a sealed box off their own bat, and if they could the
      // latch would quietly become a way to smuggle a person without ever deciding to — the
      // weighbridge would start finding people the driver never chose to hide.
      check('…into the SEAT, never the trailer', r1.rider.inTrailer === false);
      check('…and it is recorded as uninvited', r1.rider.invited === false);
      check('…and the stretch is spent, so they do not reappear behind you',
        r1.hitchDone?.has(3) === true);

      // The latch is the whole point of the feature.
      const r2 = mk({ cd: { locked: true } });
      check('latched doors keep everybody out', rigLocked(r2) === true
        && tryDoorBoard(r2, who, T0) === null
        && tryDoorBoard(r2, who, T0 + 9000) === null);

      // Rolling is rolling, however slowly, and the clock resets when you move off.
      const r3 = mk();
      tryDoorBoard(r3, who, T0);
      check('driving off resets the clock', tryDoorBoard({ ...r3, speed: 30 }, who, T0 + 9000) === null);

      // Nothing to get in.
      check('an empty stretch is quiet however long you sit on it',
        tryDoorBoard(mk(), null, T0 + 9000) === null);
      // …and a city street has no hitchers at all, so the law never runs there.
      check('nobody opens your door in town', tryDoorBoard(mk({ leg: 'city' }), who, T0 + 9000) === null);
      // Somebody already aboard.
      check('a full seat is a full seat',
        tryDoorBoard(mk({ rider: { id: 'local' } }), who, T0 + 9000) === null);
      check('the doors start OPEN, or nobody ever finds the button', rigLocked(mk()) === false);
    }

    // ── ⚠ THE ROLL IS PER STRETCH, NOT PER WEEK ──────────────────────────────
    // This is the case the whole feature turned on and nothing was watching. 'seed' hashed a
    // 'route.key' that does not exist and took raw FNV-1a as its fraction, so a week's eight nodes
    // came out inside a band about 0.03 wide — which against a 0.34 threshold is not a chance per
    // stretch at all, it is a coin flip for the ENTIRE ROAD. Twenty-four eligible stretches across
    // three consecutive windows produced zero hitchers, and every check above passed the whole time
    // (they ask whether a hitcher is well-formed, never whether one exists).
    //
    // So: sample real ground. Over twenty weeks the rate has to sit near the authored one, and no
    // single week may be all-or-nothing, which is precisely the shape the old hash produced.
    {
      let seen = 0, eligible = 0, allWeeks = 0, emptyWeeks = 0;
      for (let w = 4240; w < 4260; w++) {
        const r = corridorFor(VOIDKEY, DESTKEY, w, 8);
        const row = [...Array(8).keys()].map(n2 => hitcherAt(r, n2, 8));
        const hits = row.filter(Boolean).length;
        seen += hits; eligible += 6;                 // nodes 0 and 7 are never eligible
        if (hits === 6) allWeeks++;
        if (hits === 0) emptyWeeks++;
      }
      const rate = seen / eligible;
      check('about one stretch in five has somebody on it', rate > 0.10 && rate < 0.30,
        `${(rate * 100).toFixed(0)}% over 20 weeks`);
      // ⚠ THE BOUND IS ARITHMETIC, NOT A TASTE CALL. At the authored 0.18 an empty week is
      // 0.82^6 ≈ 30%, so about six weeks in twenty are EXPECTED to be empty and an empty week is
      // no longer evidence of anything — which is the half of this case that the rarity work cost.
      // Thirteen is a bit over three standard deviations out and still far short of the failure
      // this exists for, which drove roughly THIRTEEN empty weeks in twenty with the rate set at
      // nearly DOUBLE this one, by clustering a week's values inside a band about 0.03 wide.
      //
      // ⚠ SO THE LOAD-BEARING HALF IS NOW THE SPREAD rather than the empty count. The old hash
      // produced weeks that were all six or none; a healthy sample has weeks in between, and that
      // is what `allWeeks === 0` with a real distribution behind it actually asserts.
      check('…and no week is all-or-nothing', allWeeks === 0 && emptyWeeks <= 13,
        `${allWeeks} full, ${emptyWeeks} empty`);
    }
    // …AND WHICH ROAD YOU ARE ON IS PART OF IT. Two corridors in the same week met identical people
    // on identically numbered stretches, because the road's identity never reached the hash.
    check('two different roads do not have the same people on them',
      [...Array(8).keys()].some(n2 => JSON.stringify(hitcherAt(route, n2, 8))
        !== JSON.stringify(hitcherAt(corridorFor(VOIDKEY, 'slagworks', 4242, 8), n2, 8))));

    // ── WHERE THEY ARE STANDING, so the cab can draw them ────────────────────
    // The figure out on the road is placed from the corridor's own geometry rather than stored, so
    // the only thing that can go wrong is the derivation: a hitcher who is not ON the stretch they
    // belong to, or who is standing in the carriageway. Both would read as a rendering fault and
    // neither would throw.
    {
      const node = [...Array(8).keys()].find(n2 => at(n2));
      if (node != null) {
        const hs = hitcherSOf(route, node);
        // ⚠ THE CAB AND THE WARNING HAVE TO AGREE, and until this became one function they were
        // two copies of the same expression in two files. A call saying "two miles" about somebody
        // the renderer has drawn somewhere else is worse than no call at all, and the drift would
        // never throw.
        check('the cab and the warning place them in the same spot',
          hs === sOfNode(route, node) + roomLenOf(route) * 0.5);
        const half = pavedAt(route, hs);
        const pos = corridorPos(route, hs, half + 0.45);
        const back = corridorLocate(route, pos.x, pos.y);
        check('the figure is on the stretch they belong to',
          back && nodeAt(route, back.s, 8) === node, `node ${node} → ${back && nodeAt(route, back.s, 8)}`);
        // ⚠ OFF THE TARMAC, NOT ON IT. '+t' is to the RIGHT of travel and 'pavedAt' is the paved
        // HALF-width, so anything at or inside it is a person standing in a live lane — which is
        // not where somebody waiting for a lift stands, and is exactly what a sign error would
        // produce without ever throwing.
        check('…and on the verge rather than in the road',
          back && Math.abs(back.t) > half, `|t| ${back && back.t?.toFixed(2)} vs half ${half.toFixed(2)}`);
      }
    }
  }

  // ── 4f-bis. Being told about them in time ──────────────────────────────────
  // A hitcher used to be announced exactly once, on the node crossing, with no distance in it.
  // Since they stand half a room in, that line landed fifteen miles and about two and a half
  // minutes before you were level with them: simultaneously too early to act on and impossible to
  // act on, because nothing said how far and nothing ever said anything again.
  {
    const route = corridorFor(VOIDKEY, DESTKEY, 4242, 8);
    const node = [...Array(8).keys()].find((n) => hitcherAt(route, n, 8));
    if (node == null) {
      check('a seeded week with somebody on it, to test the warning against', false, 'nobody in week 4242');
    } else {
      const hs = hitcherSOf(route, node);

      // ⚠ ACROSS THE BOUNDARY, which is the entire reason the lookahead exists rather than being a
      // tidier spelling of the old check. At 60 tiles out the driver is still in the PREVIOUS node
      // — if the scan could not see over the join, no warning could ever be earlier than the
      // crossing itself, whatever number got printed in it.
      const far = hitcherAhead(route, hs - 60, 8, 60);
      check('somebody is seen coming from a whole stretch away',
        far?.node === node && Math.abs(far.tiles - 60) < 0.01, String(far && far.tiles));
      check('…from the node BEFORE theirs, or the warning can never beat the crossing',
        nodeAt(route, hs - 60, 8) === node - 1, `${nodeAt(route, hs - 60, 8)} vs ${node - 1}`);
      check('…and not from beyond the lookahead', hitcherAhead(route, hs - 61, 8, 60) === null);

      // ⚠ UNSIGNED, exactly as signsBetween is. `s` runs back down too (see retreat), and a driver
      // coming back at somebody is closing on them just the same.
      check('somebody you are driving back toward is still somebody ahead of you',
        hitcherAhead(route, hs + 20, 8, 60)?.node === node);

      // ── THE CALLS THEMSELVES ─────────────────────────────────────────────────
      // Driven through the real function and captured off the wire — the same shape the cab-mount
      // case uses, and for the same reason: these are pushes rather than return values, which is
      // the class of thing that has been silently absent in this plugin before.
      const mk = (at) => ({
        leg: 'corridor', route, s: at, chain: { length: 8 }, node: nodeAt(route, at, 8),
        rider: null, playerId: player.id,
      });
      const saidAt = (rig, at) => {
        const out = [];
        const saved = getBroadcast();
        setBroadcast((_z, m, _ex, target) => { if (target === player.id) out.push(m); });
        try { rig.s = at; passHitcher(player, rig); } finally { setBroadcast(saved); }
        return out.map((m) => m?.message || '').join(' ');
      };
      const armed = (at = hs - 200) => { const r = mk(at); saidAt(r, at); return r; };

      const rig = armed();
      check('nothing is said about a road you cannot see the end of', saidAt(rig, hs - 61) === '');

      const first = saidAt(rig, hs - 60);
      check('the first call comes twenty miles out', /20 miles/.test(first), first.slice(0, 90));
      // ⚠ A DISTANCE IS THE FEATURE. Every complaint this answers is "I could not slow down in
      // time", and a warning with no number in it is not something a driver can plan against.
      check('…and it carries one at all', /\d+ mile/.test(first));
      check('…and does not repeat itself for the next forty tiles',
        saidAt(rig, hs - 40) === '' && saidAt(rig, hs - 19) === '');

      const mid = saidAt(rig, hs - 18);
      check('the second comes at six miles, in time to come off the throttle',
        /6 miles/.test(mid), mid.slice(0, 90));
      const near = saidAt(rig, hs - 6);
      check('the last is close enough to see who it is, and names the verb',
        /2 miles/.test(near) && /pickup/.test(near), near.slice(0, 120));

      // ⚠ THE MARKS ARE CROSSINGS OF A CLOSING DISTANCE, so a rung that covers two of them in one
      // step must report the NEARER. The text rung advances by a slab of road a tick, and saying
      // "twenty miles" to a driver now six miles off is a call that is stale rather than early.
      const both = saidAt(armed(), hs - 6);
      check('a tick that covers two marks reports the nearer one',
        /2 miles/.test(both) && !/20 miles/.test(both), both.slice(0, 90));

      // Nothing to warn about: the seat is full, or that stretch is already spent.
      check('a driver who already has one aboard is not told about them again',
        saidAt(armed(), hs - 60) !== ''
        && saidAt(Object.assign(armed(), { rider: { id: 'local' } }), hs - 60) === '');
      check('…nor on a stretch already spent',
        saidAt(Object.assign(armed(), { hitchDone: new Set([node]) }), hs - 60) === '');

      // ⚠ THE RADIO GATES THE LEAD, NEVER THE FEATURE. Twenty miles is over the horizon and the CB
      // is the only honest voice for it — but a driver running silent still has to get enough road
      // to stop in, or switching a radio off would quietly delete a whole system.
      const quiet = Object.assign(armed(), { cbOff: true });
      check('a driver with the CB off misses the far call', saidAt(quiet, hs - 60) === '');
      check('…but still gets the six-mile one, which is what they can actually stop in',
        /6 miles/.test(saidAt(quiet, hs - 18)));
    }
  }

  // ── 4g. City driving ───────────────────────────────────────────────────────
  // Phase 4. The mechanical halves of it (a city leg on real tiles, solid buildings) shipped in
  // phase 1 — what was missing was a REASON: the city was a corridor you crossed to reach the rim
  // and there was nowhere in it to go. These cases are about the destinations, and about the one
  // thing that has to make driving in a populated place feel different from driving on a road.
  {
    const docks = truckTest.allDocks();
    check('the city has businesses that take freight', docks.length >= 4, `${docks.length} docks`);
    check('…every one on a drivable street tile, not a solid facade',
      docks.every(d => !d.flags.building_type && !d.is_building),
      docks.filter(d => d.flags.building_type).map(d => d.id).join(','));
    check('…and every one on a real coordinate a truck can reach',
      docks.every(d => d.grid_x != null && d.grid_y != null));
    // Spread matters: six docks on one street is a manoeuvre, not a drive.
    const streets = new Set(docks.map(d => d.name));
    check('…and they are spread across the city, so a local run is a DRIVE', streets.size >= 3,
      [...streets].join(', '));

    // The board has to actually offer them, and pay local money for them. If in-town work paid
    // well nobody would cross the waste, and the waste is the game.
    const depot = truckTest.allDepots().find(d => d.flags?.region_id === 'region_coldwater');
    if (depot) {
      const board = truckTest.boardFor(depot.id);
      check('a city board offers work that does not leave town', board.some(b => b.local),
        board.map(b => `${b.toName}${b.local ? '*' : ''}`).join(', '));
      const local = board.filter(b => b.local), far = board.filter(b => b.crosses);
      if (local.length && far.length) {
        check('…and crossing the waste pays a great deal better than staying in it',
          Math.max(...far.map(b => b.pay)) > Math.max(...local.map(b => b.pay)) * 3,
          `local ${Math.max(...local.map(b => b.pay))} vs waste ${Math.max(...far.map(b => b.pay))}`);
      }
      check('…and a local job names the street, because that is how you find it',
        local.every(b => !!b.where), JSON.stringify(local.map(b => b.where)));
      // Delivery needed NO new code — a contract keys on a zone id, so a dock was a destination for
      // free. This case exists to keep it that way.
      check('…and its destination is an ordinary zone id, like any other contract',
        local.every(b => typeof b.to === 'string' && !!truckTest.allDocks().find(d => d.id === b.to)));
    }
  }

  // ── 4b. The market ─────────────────────────────────────────────────────────
  // Prices are a pure function of (commodity, region, day) — no table, no tick, no DB. These cases
  // guard the two things that make it a market rather than a lookup: every good must run ONE way
  // (or the route is a coin-flip), and the spread must be narrow enough that no single commodity
  // is the only correct answer.
  {
    const CW = 'region_coldwater', RE = 'region_the_reach';
    check('a price is the same price all day', midPrice('parts', CW, 500) === midPrice('parts', CW, 500));
    check('…and a different one tomorrow', midPrice('parts', CW, 500) !== midPrice('parts', CW, 501));
    check('a depot sells dearer than it buys', askPrice('parts', CW, 500) > bidPrice('parts', CW, 500));
    check('an unknown region trades at par rather than throwing', midPrice('parts', 'region_nowhere', 500) > 0);

    // ⚠ AND PAR IS THE FALLBACK FOR CONTENT THAT HAS NOT ARRIVED YET, NEVER FOR A PLACE YOU CAN
    // DRIVE A TRUCK INTO. A region with a depot has a yard, a board and a market verb; if it has no
    // profile it trades at 1.0 across the board and is character-free — the numbers still work, so
    // nothing fails and nobody notices. Terminus and the Scarletwastes sat like that for months.
    // Author the row in the same pass as the depot.
    {
      const withDepots = [...new Set(truckTest.allDepots().map(d => d.flags?.region_id).filter(Boolean))];
      const unpriced = withDepots.filter(r => !REGIONS[r]);
      check('every region you can drive to has an authored market profile', unpriced.length === 0, unpriced.join(' '));
    }

    // Every commodity must be profitable in exactly ONE direction, averaged over a month. A good
    // that pays both ways is free money; a good that pays neither is dead weight on the board.
    const dirs = {};
    for (const k of Object.keys(COMMODITIES)) {
      let out = 0, back = 0;
      for (let d = 0; d < 30; d++) {
        out += bidPrice(k, RE, d) - askPrice(k, CW, d);
        back += bidPrice(k, CW, d) - askPrice(k, RE, d);
      }
      dirs[k] = out > 0 && back > 0 ? 'both' : out > 0 ? 'out' : back > 0 ? 'back' : 'neither';
    }
    const bad = Object.entries(dirs).filter(([, v]) => v === 'both' || v === 'neither');
    check('every commodity runs exactly one way', bad.length === 0, JSON.stringify(dirs));
    check('…and the waste is a two-way trade, not a one-way street',
      Object.values(dirs).includes('out') && Object.values(dirs).includes('back'), JSON.stringify(dirs));

    // The ladder: return% must stay in a band so capital, not a magic commodity, is the gate. The
    // first cut had medical at 10,500₵ a load against 731₵ for the best backhaul.
    const rets = [];
    for (const k of Object.keys(COMMODITIES)) {
      const per = capacityFor(k);
      const outR = (bidPrice(k, RE, 7) - askPrice(k, CW, 7)) * per / (askPrice(k, CW, 7) * per);
      const backR = (bidPrice(k, CW, 7) - askPrice(k, RE, 7)) * per / (askPrice(k, RE, 7) * per);
      rets.push(Math.max(outR, backR));
    }
    const hi = Math.max(...rets), lo = Math.min(...rets);
    check('no commodity is the only correct answer', hi < 0.75, `best return ${(hi * 100).toFixed(0)}%`);
    check('…and none is pure dead weight', lo > 0.02, `worst return ${(lo * 100).toFixed(0)}%`);
    check('a trailer bounds the load by WEIGHT, so the cheap goods are bulky',
      capacityFor('water') < capacityFor('medical'), `${capacityFor('water')} vs ${capacityFor('medical')}`);
  }

  // ── 4c. Discoverability ────────────────────────────────────────────────────
  // Before this, the ONLY way into the entire system was typing `drive` blind on one of three
  // street tiles: nothing in the world mentioned it, and `help` is hand-maintained so a plugin
  // verb never appears there by itself. A system nobody can find is a system nobody has, so the
  // routes in are asserted rather than assumed.
  {
    // THE DEPOT IS INDOORS AND ITS YARD IS NOT. This pair replaces the old assertion that the depot
    // flag sat on a drivable street tile, which was the previous design and is now precisely the
    // bug: the whole shop used to blow open over the road because you crossed a kerb. What has to
    // stay true is the OTHER half of it — the tile a rig is mounted on is still a road you cannot
    // collide with, because a bay has no grid coordinates and a facade is solid.
    const bay = world.zones.get('zone_yard_bonded');
    const yard = world.zones.get('zone_district_922_908');
    check('the Coldwater depot is inside a building you walk into',
      !!bay?.flags?.truck_depot && !!bay.flags.is_interior, bay?.flags?.is_interior);
    check('…and it names a yard that is a drivable street tile',
      world.zones.get(bay?.flags?.truck_depot?.yard)?.flags?.terrain === 'road', bay?.flags?.truck_depot?.yard);
    check('…which is NOT a solid building facade you would collide with',
      !yard?.flags?.building_type, yard?.flags?.building_type);
    check('…and the street outside says the depot is through the door',
      /roller door/i.test(await truckTest.describeDepot(yard) || ''), (await truckTest.describeDepot(yard) || '').slice(0, 48));
    // ── YOU START INSIDE THE SHED, FACING THE WAY OUT ────────────────────────
    // The mount used to be on the apron, so the roller door was a line in the log and the first
    // frame was already on the road. It is the door TILE now, and these are the three things that
    // have to hold for that to be a drive rather than a truck buried in a wall. `mountSpot` exists
    // as a function precisely so this can be asserted without buying a rig first (see its note).
    // ⚠ AND FROM THE APRON TOO, WHICH IS WHERE PARKING LEAVES YOU.
    //
    // `mountSpot` asked `depotAt(stood)`, which is true of the BAY and of nothing else. Walking in
    // puts you in the bay so it resolved; `park` puts the truck under the roof and the DRIVER on
    // the hardstand, so it returned null — and `cmdDrive` then read `spot.heading` off null and
    // threw. The depot panel came up after parking with a live 'Take it out' button on it, you
    // pressed it, and nothing happened, because the command died before it could even refuse.
    //
    // Every tile of a depot has to answer this identically, which is the same widening
    // `depotZonesOf` already took. Asserted against the YARD as well as the bay, so the two paths
    // into a truck cannot drift apart again.
    for (const bayId of ['zone_yard_bonded', 'zone_yard_roadhead', 'zone_yard_lastload',
                         'zone_yard_dryrun', 'zone_yard_deadleg']) {
      const bay = world.zones.get(bayId);
      const yard = world.zones.get(bay?.flags?.truck_depot?.yard);
      if (!yard) continue;
      const fromBay = truckTest.mountSpot(bay);
      const fromYard = truckTest.mountSpot(yard);
      check(`${bayId}: parking on the apron still finds a mount`, !!fromYard, String(fromYard));
      // The SAME seat, not merely some seat — otherwise parking and walking in are two different
      // features wearing one button.
      check('…the same one walking into the shed gives you',
        fromYard?.zone?.id === fromBay?.zone?.id && fromYard?.heading === fromBay?.heading,
        `${fromYard?.zone?.id}@${fromYard?.heading} vs ${fromBay?.zone?.id}@${fromBay?.heading}`);
      // ⚠ AND IT HAS A HEADING AT ALL. This is the exact dereference that threw: `cmdDrive` reads
      // `spot?.heading` for the mount and `standStock` had always read it as an optional chain, so
      // the two lines disagreed about whether the value could be missing.
      check('…and carries a heading the mount can actually read', Number.isFinite(fromYard?.heading),
        String(fromYard?.heading));
    }

    for (const bayId of ['zone_yard_bonded', 'zone_yard_roadhead', 'zone_yard_lastload',
                         'zone_yard_dryrun', 'zone_yard_deadleg']) {
      const bay = world.zones.get(bayId);
      const spot = truckTest.mountSpot(bay);
      const yard = world.zones.get(bay?.flags?.truck_depot?.yard);
      check(`${bayId}: drive mounts you INSIDE the shed, not out on the apron`,
        !!spot?.fromShed && spot.zone?.id === bay?.flags?.world_exit_zone && spot.zone.id !== yard?.id,
        `${spot?.zone?.id} (fromShed=${spot?.fromShed})`);
      // Without this the truck spawns in solid mass and cannot move a foot in any direction —
      // `groundObstructionAt`'s only hole is a tile marked `bay`, and it is derived from this flag.
      check('…on a tile authored drive-through, or it is parked inside a wall',
        spot?.zone?.flags?.vehicle_bay === true, spot?.zone?.flags?.vehicle_bay);
      // FACING THE YARD, not merely "some direction". The heading is derived from the facade's
      // `entrance`, so this proves the two agree: point the truck that way and it reaches the
      // hardstand rather than the back wall.
      const step = { 0: [0, -1], 90: [1, 0], 180: [0, 1], 270: [-1, 0] }[spot?.heading];
      check('…pointed at the yard, so pulling away takes you out of the door',
        !!step && !!yard && spot.zone.grid_x + step[0] === yard.grid_x
                         && spot.zone.grid_y + step[1] === yard.grid_y,
        `heading ${spot?.heading} from ${spot?.zone?.grid_x},${spot?.zone?.grid_y} → yard ${yard?.grid_x},${yard?.grid_y}`);
    }

    // ── A BOUGHT TRAILER HAS TO BE REACHABLE FROM THE TRUCK ──────────────────
    // `yard buy` parks a trailer in the BAY, with the trucks and under the roof. A truck can only
    // ever be standing on the door tile or the apron, because a bay has no road in it. So for every
    // real depot in the game a freshly bought box sat in a room the verb could not see into, and
    // `hitch` answered "nothing standing here" from the only positions it is possible to ask from.
    // The synthetic depot used by the haul case below is one tile that is its own bay AND its own
    // yard, which collapses the three and passes — so this asserts against SHIPPED content instead.
    for (const bayId of ['zone_yard_bonded', 'zone_yard_roadhead', 'zone_yard_dryrun']) {
      const bay = world.zones.get(bayId);
      const door = world.zones.get(bay?.flags?.world_exit_zone);
      const yard = world.zones.get(bay?.flags?.truck_depot?.yard);
      // The depot has to be findable from the two tiles a driver can actually be sitting on. The
      // door tile is the new one and the one that was missing: `drive` puts you there.
      for (const [label, z] of [['the door tile', door], ['the apron', yard]]) {
        check(`${bayId}: the depot is findable from ${label}, where a driver actually sits`,
          truckTest.depotFrom(z?.id)?.bay?.id === bayId, truckTest.depotFrom(z?.id)?.bay?.id);
      }
      // …and the set `hitch` searches has to contain the bay, or the box you just paid for is in a
      // room nothing can look into.
      check('…and the trailer search from the cab reaches into the bay',
        (truckTest.hitchZones(door?.id) || []).includes(bayId),
        (truckTest.hitchZones(door?.id) || []).join(' '));
    }

    // Every depot resolves to somewhere a truck can actually stand — the one invariant that stops a
    // freight board offering a run to a room with no road in it.
    check('every depot resolves to a drivable yard',
      truckTest.allDepots().every(d => d.grid_x != null && !d.flags?.is_interior),
      truckTest.allDepots().map(d => d.id).join(' '));

    // ── …AND A FOURTH ROOM NOBODY COULD FIND ─────────────────────────────────
    // Every depot has a bunkroom off the shed floor. `flags.truck_bunkroom` was authored on all
    // five when they were built and read by nothing at all, which made the room something you
    // discovered by trying directions at a wall — so the depot panel now carries a door to it.
    //
    // ⚠ THE DIRECTION IS DERIVED FROM THE EXIT, and this is the case that justifies deriving it:
    // four of the five are north of their shed and the Last Load's is east, so the constant
    // anybody would have written first is right four times out of five. Both halves are asserted —
    // that every flagged bunkroom is FOUND from its bay, and that the direction reported is a real
    // exit leading to that exact room.
    {
      const bunks = [...world.zones.values()].filter((z) => z.flags?.truck_bunkroom);
      check('the depots have bunkrooms in them at all', bunks.length >= 4, `${bunks.length}`);
      const bays = [...world.zones.values()].filter((z) => truckTest.depotAt(z));
      const found = bays.map((b) => truckTest.bunkFrom(b)).filter(Boolean);
      check('…and every one of them is on the far side of a door from its shed',
        found.length === bunks.length, `${found.length} doors for ${bunks.length} bunkrooms`);
      check('…each reported as a direction that really is an exit to it',
        bays.every((b) => { const k = truckTest.bunkFrom(b); return !k || b.exits?.[k.dir] === k.id; }),
        bays.map((b) => { const k = truckTest.bunkFrom(b); return k && `${b.id}:${k.dir}`; }).filter(Boolean).join(' '));
      // ⚠ NOT A CONSTANT. If this ever comes back true for every depot, somebody has quietly made
      // the door a fixed direction and the odd one out has stopped working.
      check('…and they are not all the same direction, which is why it is derived',
        new Set(found.map((k) => k.dir)).size > 1, [...new Set(found.map((k) => k.dir))].join(' '));
      // A bunkroom is not a depot: walking into one has to CLOSE the panel rather than keep it up,
      // which is what the zone.entered handler already does for anything outside the place.
      check('…and a bunkroom is not itself part of the depot, so the screen comes down in there',
        bunks.every((z) => !truckTest.depotFrom(z.id)), bunks.map((z) => z.id).join(' '));
    }

    // ── A DEPOT IS THREE TILES, AND THE SET HAS TO SAY SO FROM ANY OF THEM ────
    // `depotZonesOf` named two: the tile you handed it, and the depot's own yard. From inside the
    // bay that happened to be [bay, apron] and everything worked; from the APRON it was [apron,
    // apron], with the bay missing — and `park` stores a rig in the BAY. So parking at a yard and
    // then trying to drive off the hardstand answered "your truck is parked at <this very yard>,
    // not here". Asserted from all three tiles because the bug was only ever visible from one.
    for (const d of truckTest.allDepots().slice(0, 3)) {
      const bayZone = [...world.zones.values()].find(z => truckTest.depotAt(z)?.yard === d.id);
      if (!bayZone) continue;
      const want = [bayZone.id, d.id];
      const facade = bayZone.flags?.world_exit_zone;
      for (const from of [bayZone, d, facade ? world.zones.get(facade) : null].filter(Boolean)) {
        const set = truckTest.depotZonesOf(from, truckTest.depotAt(from) || truckTest.depotFrom(from.id)?.depot);
        check(`a depot answers for its whole place from ${from.id === bayZone.id ? 'the bay' : from.id === d.id ? 'the apron' : 'the facade'}`,
          want.every(z => set.includes(z)), `${set.join(',')} missing one of ${want.join(',')}`);
      }
    }

    const line = await truckTest.describeDepot(bay);
    check('a depot describes its own trucks and board', !!line && /fence/i.test(line), (line || '').slice(0, 40));
    for (const v of ['drive', 'haul', 'market', 'yard']) {
      check(`…and teaches "${v}" as a clickable verb`, new RegExp(`data-action="${v}"`).test(line || ''));
    }
    // A tightened tank is only fair if there IS a pump at the far end — otherwise the fix strands
    // people instead of pressuring them. Checked HERE, against shipped content, before the haul
    // case staples its synthetic depots into the world.
    const realDepots = truckTest.allDepots();
    check('every shipped depot sells diesel, so a tight tank pressures rather than strands',
      realDepots.length >= 3 && realDepots.every(d => d.flags?.truck_fuel || d.flags?.building_type === 'fuel_yard'),
      realDepots.map(d => `${d.flags?.truck_depot?.name}:${!!d.flags?.truck_fuel}`).join(' '));

    // (Kessler Street, one tile east — not an apron, not a bay.)
    check('a non-depot street says nothing about trucks',
      (await truckTest.describeDepot(world.zones.get('zone_district_923_908'))) === undefined);

    check('the hand-maintained help book lists the hauling verbs',
      HELP_GROUPS.some(g => g.cat === 'HAULING' && /drive/.test(g.text) && /market/.test(g.text)));

    const rennie = [...world.npcs.values()].find(n => n.id === 'npc_kessler_dispatcher');
    check('a dispatcher stands in the yard', !!rennie, rennie?.name);
    check('…with a rooted dialogue tree the engine can actually render',
      !!rennie?.dialogue_tree?.root?.text, Object.keys(rennie?.dialogue_tree || {}).join(','));
    check('…whose options all lead somewhere real', (() => {
      const t = rennie?.dialogue_tree || {};
      return Object.values(t).every(n => (n.options || []).every(o => o.next && t[o.next]));
    })());
    check('…and who introduces herself exactly once', !!rennie?.dialogue_tree?.root?.first);
  }

  // ── 4d. A truck exists to other people ─────────────────────────────────────
  // Every one of these was FALSE when the system first worked end to end: a rig was visible only
  // to its own driver. It could be parked in a public yard, driven through a street full of people
  // and flown over by a pilot, and none of them saw anything at all. A vehicle nobody else can
  // perceive is a private view, not a thing in the world.
  {
    // A driver reads as a driver. Posture is engine state, so this names no system and fixes
    // `flying` for free — a pilot sat on a ramp had the same problem.
    check('somebody behind the wheel does not read as a pedestrian',
      bodyTell({ posture: 'driving' }, 'zone_x') === 'behind the wheel');
    check('…and neither does a pilot', bodyTell({ posture: 'flying' }, 'zone_x') === 'in the cockpit');
    check('…while somebody just standing there still reads as nothing',
      bodyTell({ posture: 'standing' }, 'zone_x') === null);
    check('…and being out cold still outranks the wheel',
      bodyTell({ posture: 'driving', _koUntil: Date.now() + 5000 }, 'zone_x') === 'out cold');

    // A MOVING rig is traffic a pilot can see; a parked one is scenery and belongs in the room
    // description instead, or it would sit in the contact list as a permanent blip.
    const fake = { playerId: 'p_traffic', leg: 'city', x: 900, y: 900, heading: 90, speed: 40,
      type: TYPES.drayman,
      // …AND IT IS PAINTED. Everything that draws a truck drew it in the owner's colours except
      // this — the only place anybody ELSE sees your rig — so a paint job was a thing you bought
      // and were then the only person alive who could see.
      cd: { paint: { base: '#112233', trim: '#445566', flash: 'scallop', finish: 'matte' } } };
    rigs.set('p_traffic', fake);
    try {
      const seen = truckContactsNear(900, 900, 26);
      check('a moving rig shows up as traffic', seen.length === 1, seen.length);
      check('…in the same contact shape an aircraft uses',
        seen[0]?.cls === 'truck' && seen[0].onGround === true && Number.isFinite(seen[0].hdg),
        JSON.stringify(seen[0] || {}).slice(0, 60));
      check('…pinned to the deck, not floating at altitude',
        seen[0]?.groundZ === 0 && seen[0]?.altDiff === 0 && seen[0]?.alt === 0);
      check('…and out of range is out of sight', truckContactsNear(2000, 2000, 26).length === 0);
      // The paint reaches the people who can see the truck. Asserted as the RENDERER's shape
      // rather than as the stored one, because the whole failure was a raw paint handed through
      // where a livery was expected: `pattern` under the truck: prefix is the conversion, and a
      // missing one paints a flat undercoat and looks like nothing is wrong.
      check('…wearing its own paint, in the shape the model painter reads',
        seen[0]?.livery?.base === '#112233' && seen[0]?.livery?.pattern === 'truck:scallop'
        && seen[0]?.livery?.finish === 'matte',
        JSON.stringify(seen[0]?.livery || null).slice(0, 80));
      const bare = { ...fake, playerId: 'p_traffic2', cd: {} };
      rigs.set('p_traffic2', bare);
      check('…and a rig nobody has painted carries no livery to argue with the mesh defaults',
        JSON.stringify(truckContactsNear(900, 900, 26).find(c => c.id === 'truck_p_traffic2')?.livery) === '{}');
      rigs.delete('p_traffic2');
      fake.speed = 0;
      check('a PARKED rig is scenery, not a permanent blip on every pilot\'s glass',
        truckContactsNear(900, 900, 26).length === 0);
      fake.speed = 40; fake.leg = 'corridor';
      check('…and a rig out on the corridor is off the map entirely',
        truckContactsNear(900, 900, 26).length === 0);
    } finally { rigs.delete('p_traffic'); }

    // The renderer has to have something to draw it WITH. `drawAircraftModel` is per-class and
    // every other class in aircraft3d.js has wings, so without this a truck relayed to a pilot
    // would have rendered as an aeroplane sliding along the road.
    const mesh = aircraftFaces('truck', 1, false);
    check('there is a truck mesh, not an aeroplane standing in for one', mesh.length > 20, mesh.length);
    check('…with a windscreen and wheels, so the silhouette reads',
      mesh.some(f => f.role === 'glass') && mesh.some(f => f.role === 'gear'));

    // FOUR TRUCKS, FOUR SILHOUETTES. The first cut handed one box set to every type, which quietly
    // undid the fleet ladder — the whole reason to want the next truck up is that it is visibly a
    // bigger animal. These assert the shapes are actually different rather than differently priced.
    const extent = (v) => {
      const f = aircraftFaces('truck', 1, false, v);
      let lo = [9, 9, 9], hi = [-9, -9, -9];
      for (const x of f) for (const p of x.p) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
      return { len: hi[0] - lo[0], tall: hi[2] - lo[2], mid: (lo[0] + hi[0]) / 2, n: f.length };
    };
    const ids = ['scrapper', 'hauler', 'drayman', 'continental'];
    const tall = ids.map(id => extent(id).tall);
    check('a costlier truck is a physically bigger one',
      tall.every((t, i) => i === 0 || t > tall[i - 1]), tall.map(t => t.toFixed(2)).join(' < '));
    check('every truck is a distinct mesh, not one model priced four ways',
      new Set(ids.map(id => extent(id).n + ':' + extent(id).tall.toFixed(3))).size === ids.length);

    // Bobtail has to READ as bobtail — it is a real way to drive, not an unfinished one.
    for (const id of ids) {
      check(`a hitched ${id} is longer than the same truck bobtail`,
        extent(id + '+t').len > extent(id).len + 0.1, `${extent(id).len.toFixed(2)} -> ${extent(id + '+t').len.toFixed(2)}`);
      // Every consumer places this mesh by its ORIGIN, so an off-centre model draws ahead of where
      // the truck actually is and spins about its own bumper in the dealer's turntable.
      check(`…and both sit centred on their own origin`,
        Math.abs(extent(id).mid) < 0.01 && Math.abs(extent(id + '+t').mid) < 0.01,
        `${extent(id).mid.toFixed(3)} / ${extent(id + '+t').mid.toFixed(3)}`);
    }
  }

  // ── 4e. The bench: condition, tuning, kits ─────────────────────────────────
  // The half of a truck that is not the drive. What is actually being defended here is that a
  // number typed into a dial ends up in the PHYSICS the client runs — the whole reason
  // `effTruckParams` exists is that there must not be a second copy of this maths anywhere.
  {
    const base = TYPES.drayman;
    const stock = effTruckParams('drayman', {}, 1);
    check('an untouched truck derives exactly its own type', stock.topSpeed === base.topSpeed
      && Math.abs(stock.thrustMax - base.thrustMax) < 1e-9, `${stock.topSpeed} / ${stock.thrustMax}`);

    // THE TUNE IS A TRADE. A dial whose right answer is always "+1" is a chore, not a choice, so
    // each one has to cost something measurable in the other direction.
    const road = effTruckParams('drayman', { tune: { gearing: 1 } }, 1);
    const haul = effTruckParams('drayman', { tune: { gearing: -1 } }, 1);
    check('gearing trades top speed against pull', road.topSpeed > stock.topSpeed && road.thrustMax < stock.thrustMax
      && haul.topSpeed < stock.topSpeed && haul.thrustMax > stock.thrustMax,
      `road ${road.topSpeed}/${road.thrustMax.toFixed(2)} vs haul ${haul.topSpeed}/${haul.thrustMax.toFixed(2)}`);

    // Condition bites POWER and BRAKES, and nothing else — a worn truck must not become a truck
    // that steers badly, because that is illegible from the seat.
    const worn = effTruckParams('drayman', {}, 0.1);
    check('wear costs power and stopping', worn.thrustMax < stock.thrustMax && worn.brake < stock.brake);
    check('…and never costs handling', Math.abs(worn.wheelbase - stock.wheelbase) < 1e-9);

    // THE SURFACE INVARIANT (flight-model.js SURFACES). thrustMax × drive must clear
    // rollFric × drag on the verge, or "the edge of the road is a law, not a wall" is quietly
    // broken by a tuning number rather than by a decision. Worst case the bench can produce.
    const worst = effTruckParams('scrapper', { tune: { gearing: 1, boost: -1 } }, 0);
    const v = SURFACES.offroad;
    check('even the worst tuned, most derelict rig can still crawl off the pavement',
      worst.thrustMax * v.drive > worst.rollFric * v.drag * 1.05,
      `${(worst.thrustMax * v.drive).toFixed(2)} vs ${(worst.rollFric * v.drag).toFixed(2)}`);

    // A kit is meant to be an unambiguous improvement — that is what the money buys.
    const kitted = effTruckParams('drayman', { kits: ['auxtank', 'aerokit'] }, 1);
    check('kits are strictly better than no kits', kitted.tank > stock.tank && kitted.dragP < stock.dragP);
    check('…and the workshop set is the one that widens the dials',
      tuneRange(20, ['benchkit']) > tuneRange(20, []), `${tuneRange(20, [])} → ${tuneRange(20, ['benchkit'])}`);

    // A field repair cannot take a rig past Worked, and a shop job is dearer than doing it yourself.
    check('a shop repair costs more than your own hands',
      repairCost(base, 0.3, true) > repairCost(base, 0.3, false));
    check('wear accrues on distance, and a rough surface costs more of it',
      wearFor(100, { surface: 'offroad' }) > wearFor(100, { surface: 'road' }) && wearFor(0, {}) === 0);
    check('condition is part of what a truck is worth',
      resaleValue(base, 0, 1) > resaleValue(base, 0, 0.2));
  }

  // ── 4f. Breakdowns ─────────────────────────────────────────────────────────
  // The rule the whole feature rests on is that a breakdown is never a bolt from a clear sky: it
  // is the bill for a bar you watched go down and drove past a bench anyway. If the top bands can
  // break, condition stops being a decision and every haul becomes a dice roll.
  {
    check('a sound truck never breaks down, however far it goes',
      breakChance(100000, { condition: 1 }) === 0 && breakChance(100000, { condition: 0.55 }) === 0);
    const ailing = breakChance(500, { condition: 0.25 });
    const derelict = breakChance(500, { condition: 0.05 });
    check('a neglected one does, and a derelict one does much more',
      ailing > 0.05 && ailing < 0.45 && derelict > ailing * 2,
      `${ailing.toFixed(3)} vs ${derelict.toFixed(3)}`);
    check('and bad ground shakes it apart faster',
      breakChance(500, { condition: 0.2, surface: 'offroad' }) > breakChance(500, { condition: 0.2 }));
    // NOBODY IS EVER STRANDED. Every failed attempt raises the next one's odds, so the tail is
    // bounded — a driver on a shoulder in the dark must not be rolling dice forever.
    check('a roadside fix gets more likely every time you fail it',
      fixOdds(0, 1) > fixOdds(0, 0) && fixOdds(0, 4) >= 1, `${fixOdds(0, 0).toFixed(2)} → ${fixOdds(0, 4).toFixed(2)}`);
    check('…and skill helps, but is not what saves you', fixOdds(60, 0) > fixOdds(0, 0));
    check('every breakdown has prose and a name for what let go',
      Object.values(BREAKDOWNS).every(b => b.label && b.broke && b.fixed), Object.keys(BREAKDOWNS).join(','));
    // A fix buys DISTANCE, not health — otherwise a spanner in a waste replaces the bench.
    check('a fix buys road, not condition', FIX_GRACE_TILES > 0 && FIX_GRACE_TILES < TILES_PER_ROOM * 4, FIX_GRACE_TILES);
  }

  // ── 4g. The fork ───────────────────────────────────────────────────────────
  // Two roads out of Coldwater, and until this existed a truck could only ever take the first row
  // of the table — which quietly made Terminus (a destination DESIGNED around truck range)
  // unreachable by road. The invariant that makes changing your mind safe is that the trunk is one
  // road: if the shared rooms had different tarmac per destination, switching would teleport the
  // rig sideways onto a road that had been somewhere else all along.
  {
    // Derived, in tiles. The authored room count is gone (see voidwalking's trunkTilesFor) and a
    // corridor built against `undefined` puts its fork at zero, which reads as "both roads share
    // the whole trunk" and passes for the wrong reason.
    const trunk = voidTest.trunkTilesFor(VOIDKEY, vdef, null);
    const other = vdef.dests[1];
    // ⚠ THE NODE COUNTS HAVE TO EXCEED THE TRUNK, AND THEY USED TO BY ACCIDENT. Hard-coded 8 and 12
    // were comfortably past a trunk of 4 rooms; against a trunk derived in TILES they are shorter
    // than the shared stretch itself, so the fork lands past the end of the road and `trunkL` comes
    // back as the whole thing. Sized off the trunk now, so this cannot drift again.
    const a = corridorFor(VOIDKEY, vdef.dests[0].key, 4242, trunk * 3, trunk);
    const b = corridorFor(VOIDKEY, other?.key || 'x', 4242, trunk * 4, trunk);
    const trunkLegs = (r) => r.legs.filter(l => l.trunk).map(l => [l.s0, l.s1, l.x0, l.y0, l.ux, l.uy].join(','));
    check('both roads out of a void share the same trunk, tile for tile',
      trunkLegs(a).join('|') === trunkLegs(b).join('|'), trunkLegs(a).length + ' legs');
    check('…and the trunk ends exactly where the fork is',
      a.trunkL === trunk * TILES_PER_ROOM && trunkLegs(a).length > 0, `${a.trunkL}`);
    check('past the fork the two roads are genuinely different',
      JSON.stringify(a.legs.filter(l => !l.trunk)) !== JSON.stringify(b.legs.filter(l => !l.trunk)));
    // A rig standing on the trunk is at the same PLACE on either road — that is the whole licence
    // for switchLimb, and it is derived here rather than asserted in a comment.
    const sMid = Math.floor(a.trunkL * 0.5);
    const pa = corridorPos(a, sMid, 0), pb = corridorPos(b, sMid, 0);
    check('so a rig on the trunk is in the same place whichever limb it is aimed at',
      Math.abs(pa.x - pb.x) < 1e-9 && Math.abs(pa.y - pb.y) < 1e-9, `${pa.x},${pa.y} / ${pb.x},${pb.y}`);
    check('the fork is still ahead in the middle of the trunk, and behind past it',
      atOrBeforeFork({ leg: 'corridor', route: a, s: sMid }) && !atOrBeforeFork({ leg: 'corridor', route: a, s: a.trunkL + 50 }));
    // The crossing has to SAY where the fork is, or nothing above can find it.
    check('a crossing reports its own trunk length', typeof trunk === 'number' && trunk >= 1, trunk);
  }

    // ── THE FOOT TRAIL IS CONTINUOUS, INCLUDING ROUND THE BENDS ───────────────
    // The walking route runs parallel to this road and a driver crosses it constantly. What is
    // defended here is the thing that would break it invisibly: placement by TOLERANCE rather than by
    // rounding. On a straight the tiles at a fixed lateral offset form a clean row and
    // `Math.round(at) === TRAIL_OFFSET` lands on exactly one of them; on a BEND that row is a diagonal
    // and rounding lands on none for stretches at a time, so the path appears for forty tiles, goes
    // missing for twenty and comes back. That reads as a bug, not as a trail — and it is the third
    // feature on this verge to need the rule, after the wreck and the sign.
    {
      const tr = corridorFor(VOIDKEY, DESTKEY, 4242, 120, 20);
      let sampled = 0, named = 0, longestGap = 0, gap = 0;
      // Walk the route and, at each step, probe the tile nearest the trail's own offset on both sides.
      for (let s = 4; s < Math.min(tr.L - 4, 400); s += 2) {
        let hit = false;
        for (const side of [1, -1]) {
          const p = corridorPos(tr, s, side * trailOffsetOn(tr, s));
          const cell = corridorAt(tr, Math.round(p.x), Math.round(p.y));
          if (cell?.name === 'The Foot Trail' || cell?.name === 'A Wayside Camp') hit = true;
        }
        sampled++;
        if (hit) { named++; gap = 0; } else { gap++; if (gap > longestGap) longestGap = gap; }
      }
      check('the road knows where the foot trail runs', named > 0, `${named}/${sampled}`);
      // A path is a continuous thing. Rounding-based placement produced runs of misses on the bends;
      // a tolerance band should never leave more than a couple of probes unhit in a row.
      check('…and it does not go missing round the bends', longestGap <= 3, `longest gap ${longestGap}`);
      check('…on the great majority of the route', named / Math.max(1, sampled) > 0.8,
        `${((named / Math.max(1, sampled)) * 100).toFixed(0)}%`);
      // ⚠ AND IT IS NOT THE ROAD. Naming a band must not have made it drivable or paved: the trail
      // keeps the verge's own terrain, so `surfaceUnder` still charges verge physics for it.
      const p0 = corridorPos(tr, 40, trailOffsetOn(tr, 40));
      const trailCell = corridorAt(tr, Math.round(p0.x), Math.round(p0.y));
      check('…and the trail is not tarmac', trailCell?.flags?.terrain !== 'road', trailCell?.flags?.terrain);

      // ── A WAYSIDE IS WHERE THE TWO ROUTES ARE THE SAME PLACE ────────────────
      // Not a seeded landmark. The path comes IN to the road every WAYSIDE_EVERY tiles, which is why
      // there is somewhere for a camp to be and somewhere for a rig to pull over beside it. Two lines
      // running exactly parallel would never have met at all.
      let camps = 0;
      for (let s = 0; s < Math.min(tr.L - 4, 400); s += 1) {
        if (!isCampOn(tr, s)) continue;
        for (const side of [1, -1]) {
          const p = corridorPos(tr, s, side * trailOffsetOn(tr, s));
          if (corridorAt(tr, Math.round(p.x), Math.round(p.y))?.name === 'A Wayside Camp') { camps++; break; }
        }
      }
      check('the trail comes in to the road at intervals', camps > 0, `${camps} wayside tiles`);
      // The approach is smooth. A path that jumped from seven tiles out to three between one tile and
      // the next is a corner rather than a track, and the room coordinates would step sideways with it.
      let maxStep = 0;
      for (let s = 0; s < 200; s++) {
        maxStep = Math.max(maxStep, Math.abs(trailOffsetOn(tr, s + 1) - trailOffsetOn(tr, s)));
      }
      check('…and swings in smoothly rather than turning a corner', maxStep < 1.2, maxStep.toFixed(3));
      // At the camp it is close enough that a rig on the shoulder is beside it, and away from one it
      // is properly off the road. Both halves matter: the first is what makes a pickup possible, the
      // second is what stops the walk being a hundred miles of hard shoulder.
      {
        const camps = campsOf(tr);
        const mid = camps.length > 1 ? (camps[0] + camps[1]) / 2 : tr.L / 2;
        // Relative rather than absolute, so retuning the offsets cannot break a test that is about
        // the SHAPE: in close at a camp, out in the country between them.
        const atCamp = trailOffsetOn(tr, camps[0]), between = trailOffsetOn(tr, mid);
        check('…close at the camp, out in the country between them',
          between > atCamp * 1.5, `${atCamp.toFixed(1)} at the camp / ${between.toFixed(1)} between`);
        // ⚠ AND THE CAMPS ARE WHERE THE ROAD IS BACK ON COURSE, not at a fixed spacing. A camp landing
        // in the middle of a detour pins the trail to the very bend it exists to cut, which is exactly
        // how the fixed-spacing version came out LONGER than the road on every leg.
        check('…and camps sit where the road is on course, not at a fixed interval',
          camps.length >= 2 && camps[0] === 0 && camps[camps.length - 1] === tr.L, camps.length + ' camps');
      }
    }

  // ── 4i. Passengers ─────────────────────────────────────────────────────────
  // An aircraft has carried people since charter; a truck was a single-occupancy object, so two
  // people crossing the void together had to walk it. What is defended here is the pair of things
  // that would strand somebody: a rider who does not come with the truck, and a rider who is never
  // let go of.
  //
  // ⚠ THIS NEEDS A SECOND LIVE PLAYER, which is why it is worth writing rather than assuming. The
  // suite drives one fake player; a passenger system is by definition about two.
  {
    const drv = getPlayer();
    const PAX = 'player_regress_pax';
    const A = `${PAX}_a`, B = `${PAX}_b`;
    world.zones.set(A, mkZone(A, 'Pax Yard A', { map_id: 'map_world', grid_x: 3400, grid_y: 3400 }));
    world.zones.set(B, mkZone(B, 'Pax Yard B', { map_id: 'map_world', grid_x: 3401, grid_y: 3400 }));
    const paxZone = A;
    const pax = {
      id: PAX, handle: 'Regress Passenger', current_zone: paxZone,
      stat_brawn: 5, stat_reflexes: 5, hp: 50, max_hp: 50,
    };
    setLivePlayer(PAX, pax);          // ⚠ TWO ARGS. One poisons world.players with undefined.
    addPlayerToZone(PAX, paxZone);

    const rig = { playerId: drv.id, zoneId: paxZone, speed: 0, passengers: new Set(), rider: null };
    rigs.set(drv.id, rig);

    check('a cab has room before anybody is in it', seatsFree(rig) === 2, String(seatsFree(rig)));
    boardPassenger(rig, pax);
    check('a passenger boards', rig.passengers.has(PAX) && pax._ridingRig === drv.id);
    check('…and reads as being in the cab', pax._inCab === true);
    check('…and the rig can be found from the passenger', ridingRigOf(pax) === rig);
    check('…and the seat is taken', seatsFree(rig) === 1, String(seatsFree(rig)));

    // ⚠ THE SEEDED HITCHER SHARES THE BENCH. `rig.rider` is a different field holding a different
    // KIND of thing, and the only place the two meet is the seat count.
    rig.rider = { id: 'local', look: 'a wiry man' };
    check('…and the hitcher in the sleeper fills the cab', seatsFree(rig) === 0, String(seatsFree(rig)));
    rig.rider = null;

    // The truck moves. The passenger goes with it — this is the whole feature.
    const dest = B;
    {
      driveToZone(drv, rig, dest);
      check('a passenger is carried when the truck moves', pax.current_zone === dest, pax.current_zone);
      check('…and is actually in the destination zone', world.zones.get(dest)?.players?.has(PAX));
      check('…and is not left in the one it drove out of', !world.zones.get(paxZone)?.players?.has(PAX));
    }

    // ⚠ AND EVERYBODY IS LET GO OF. Parking, a tow, a recovery and a driver logging out all come
    // through dismountRig, so this is the one release path rather than four that each remember.
    const wasAt = pax.current_zone;
    dismountRig(drv.id);
    check('parking sets a passenger down', !pax._ridingRig && pax._inCab === false);
    check('…where the truck stopped, not where they got in', pax.current_zone === wasAt, pax.current_zone);
    check('…and the rig is gone', !rigs.has(drv.id));

    // A stale back-reference must never resolve to a rig that no longer exists: that is a passenger
    // riding a ghost, and it is the failure that would be hardest to see.
    pax._ridingRig = drv.id;
    check('a stale ride reference resolves to nothing', ridingRigOf(pax) === null);
    check('…and clears itself rather than lingering', !pax._ridingRig);

    removePlayerFromZone(PAX, pax.current_zone);
    removeLivePlayer(PAX);
    world.zones.delete(A); world.zones.delete(B);
  }

    // ── 4j. The road bends because there is something there ────────────────────
    // The bends used to be a coin flip: they looked like a road and meant nothing, so there was no
    // reason for the tarmac to go left here rather than right and no corner worth a walker cutting.
    // The gap carries a seeded field of landforms now and the road prefers to go round them.
    //
    // ⚠ WHAT IS ASSERTED IS A PREFERENCE, NOT A PROHIBITION, and that is the honest claim. The leash
    // still wins outright wherever it is engaged (a mesa may bias the road and must never drag it off
    // the target or stop it converging), and bends alternate with straights, so a road that NEVER
    // crossed high ground would be a maze rather than a highway. What has to hold is that it crosses
    // less of it than a straight line between the same two gates would.
    {
      const anch = { x0: 918, y0: 947, x1: 1200, y1: 940 };   // Coldwater → Terminus, the long gap
      const seed = 'region_coldwater|region_terminus';
      const inside = (field, x, y) => field.some(m => Math.hypot(x - m.x, y - m.y) < m.r);

      let wins = 0, sumStraight = 0, sumRoad = 0, windows = 0;
      for (const w of [4242, 4243, 4244, 4245, 4246, 4247]) {
        const field = landformsFor(seed, w, anch);
        if (!field.length) continue;
        windows++;
        let sIn = 0, sN = 0;
        for (let t = 0; t <= 1; t += 0.005) {
          sN++;
          if (inside(field, anch.x0 + (anch.x1 - anch.x0) * t, anch.y0 + (anch.y1 - anch.y0) * t)) sIn++;
        }
        const route = corridorFor('region_coldwater', 'exodus', w, 282, 20, null, anch, seed);
        let rIn = 0, rN = 0;
        for (let s = 0; s <= route.L; s += 2) {
          const p = corridorPos(route, s, 0);
          rN++;
          if (inside(field, p.x, p.y)) rIn++;
        }
        const sf = sIn / Math.max(1, sN), rf = rIn / Math.max(1, rN);
        sumStraight += sf; sumRoad += rf;
        if (rf <= sf) wins++;
      }
      check('the gap has a seeded landform field', windows > 0, `${windows} windows`);
      check('the road goes round more of it than a straight line would',
        windows > 0 && sumRoad < sumStraight * 0.85,
        `road ${(sumRoad / Math.max(1, windows) * 100).toFixed(1)}% vs straight ${(sumStraight / Math.max(1, windows) * 100).toFixed(1)}%`);
      check('…and it is better in most weeks rather than on average by luck',
        wins >= Math.ceil(windows * 0.75), `${wins}/${windows}`);

      // ── THE TRAIL IS A REAL PATH, AND IT IS NOT A SHORTCUT ────────────────
      // ⚠ THIS PINS A MEASUREMENT THAT CONTRADICTS THE DESIGN, ON PURPOSE. The premise says the walk
      // is shorter than the drive because the road goes round what a person goes over. It is not: the
      // built road is only about 1.03 to 1.10 times the straight line between its gates, so there are
      // no corners worth cutting and the trail comes out slightly LONGER once its swings in to each
      // camp are counted. If this check ever starts failing because the trail got shorter, the road
      // has learned to genuinely detour — and THAT is when the room count moves onto the trail
      // (see `registerTrailLength` in voidwalking).
      {
        const t = trailFor(corridorFor('region_coldwater', 'exodus', 4242, 282, 20, null, anch, seed), seed, 4242);
        check('the trail is its own path with real length', !!t && t.L > 0, t ? t.L.toFixed(0) : 'none');
        check('…that starts and ends on the road it shadows',
          !!t && Math.hypot(t.pts[0].x - anch.x0, t.pts[0].y - anch.y0) < 40
             && Math.hypot(t.pts[t.pts.length - 1].x - anch.x1, t.pts[t.pts.length - 1].y - anch.y1) < 40);
        // ⚠ AND THE WALK IS NOW SHORTER THAN THE DRIVE, which is the premise finally being true. This
        // check used to assert the OPPOSITE and carried a note saying that when it started failing the
        // road had learned to detour. It did: the country outranks the homing bias (the hard clamp is
        // untouched) and camps anchor where the road is back on course, so the chord between two of
        // them crosses what the road went round.
        {
          const rd = corridorFor('region_coldwater', 'exodus', 4242, 282, 20, null, anch, seed);
          // ⚠ THE SHORTCUT BELONGS TO A WALK THAT TAKES THE CUTS, NOT TO THE SPINE. `t.L` is the
          // SHADOW — it follows the road, so of course it is about as long as the road. The claim is
          // that a walker who takes every cut open to them this week gets there sooner than the truck.
          const open = (t?.cuts || []).filter(c => c.open);
          const best = t ? t.L - open.reduce((a, c) => a + c.saves, 0) : Infinity;
          check('the spine is the long way round, and tracks the road', !!t && Math.abs(t.L - rd.L) < rd.L * 0.12,
            t ? `spine ${t.L.toFixed(0)} vs road ${rd.L.toFixed(0)}` : 'none');
          check('taking the cuts beats the drive', best < rd.L,
            `best walk ${best.toFixed(0)} vs road ${rd.L.toFixed(0)} (${open.length} cuts open)`);
          check('…and the road is longer than the straight line it could not take',
            rd.L > Math.hypot(anch.x1 - anch.x0, anch.y1 - anch.y0) * 1.08,
            `x${(rd.L / Math.hypot(anch.x1 - anch.x0, anch.y1 - anch.y0)).toFixed(2)}`);
          // ⚠ AND BOTH WAYS ALWAYS EXIST. A cut that replaced the spine would make being refused on it
          // a dead end; a cut that branches off it makes being refused a loss. That is decision 2.
          check('every cut leaves and rejoins the spine rather than replacing it',
            (t?.cuts || []).every(c => c.toD > c.fromD && c.len < (c.toD - c.fromD)));
        }
        // A cut is still a real place even when it saves nothing: off the road, no lifeline, and it
        // rolls encounters hot. The DANGER half of the trade ships; the distance half does not.
        check('…and every camp is on the route, never cut across',
          !!t && t.pts.some(p => p.wayside));
      }

      // The turn itself, unit-tested, because the statistic above cannot tell you WHY it improved.
      check('a rock dead ahead turns the road away', avoidTurn([{ x: 0, y: -100, r: 30 }], 0, 0, 0) === -1);
      check('…one behind you does not', avoidTurn([{ x: 0, y: -100, r: 30 }], 0, -200, 0) === 0);
      check('…and one you already clear does not', avoidTurn([{ x: 300, y: -100, r: 30 }], 0, 0, 0) === 0);
      // ⚠ TWO ROADS MEETING THE SAME ROCK MUST AGREE. A coin flip for the dead-ahead case would let
      // the trunk two limbs share peel apart on a tile neither of them chose.
      check('…and dead-centre resolves the same way twice',
        avoidTurn([{ x: 0, y: -100, r: 30 }], 0, 0, 0) === avoidTurn([{ x: 0, y: -100, r: 30 }], 0, 0, 0));

      // ⚠ AND THE LEGACY FRAME IS UNTOUCHED. Every pinned route in this suite is unanchored, which
      // has no real coordinates for a landform to sit at — so the field is empty there and the turn
      // is the coin flip it always was, character for character.
      check('an unanchored road has no country and no avoidance',
        landformsFor(seed, 4242, null).length === 0);
    }

  // ── 4h. Wrecks and the CB ──────────────────────────────────────────────────
  // The road remembers hauls that did not finish. What is defended here is that a wreck is a
  // PLACE rather than a decoration: the same tile for everybody, reported before you reach it,
  // and capped so a corridor never turns into a scrapyard.
  {
    _clearWrecks();
    const wreckTrunk = voidTest.trunkTilesFor(VOIDKEY, vdef, null);
    const route = corridorFor(VOIDKEY, DESTKEY, 4242, wreckTrunk * 3, wreckTrunk);
    const w = addWreck(route, { s: 300, what: 'A dead Krell Barrow', who: 'Somebody' });
    check('a wreck lands on the verge, not on the road', w && Math.abs(w.off) >= 3 && Math.abs(w.off) <= route.R, w?.off);
    const cell = corridorAt(route, ...Object.values(corridorPos(route, 300, w.side * w.off)).slice(0, 2));
    check('…and it is really there in the world the renderer reads',
      cell?.flags?.wreck === true && cell.flags.building_type, JSON.stringify(cell?.flags?.building_name));
    check('two rigs do not pile up on the same spot', addWreck(route, { s: 302, what: 'x' }) === null);
    check('the CB warns about it BEFORE you reach it, never after',
      wreckAhead(route, 200)?.s === 300 && wreckAhead(route, 400) === null);
    for (let i = 0; i < 40; i++) addWreck(route, { s: 600 + i * 20, what: 'A dead thing' });
    check('a road lined with wrecks stops being a road — so the list is capped',
      wrecksOn(route).length <= 12, wrecksOn(route).length);
    // THE WINDOW ROLLS AND THE OLD DEAD GO WITH IT — but only once it has rolled TWICE. A rig that
    // set out before the roll drives a route stamped with the previous window until it re-derives,
    // so window−1 has to survive or two live drivers wipe each other's ghosts for the length of the
    // overlap. Asserted through the public surface, on three windows at once.
    _clearWrecks();
    const stale = corridorFor(VOIDKEY, DESTKEY, 4240, wreckTrunk * 3, wreckTrunk);
    const prev  = corridorFor(VOIDKEY, DESTKEY, 4241, wreckTrunk * 3, wreckTrunk);
    addWreck(stale, { s: 300, what: 'A dead thing from two weeks ago' });
    addWreck(prev,  { s: 300, what: 'A dead thing from last week' });
    check('a wreck on an older window is on its own road and nobody else\'s',
      wrecksOn(stale).length === 1 && wrecksOn(prev).length === 1);
    addWreck(route, { s: 900, what: 'A dead thing from this week' });
    check('rolling the window sweeps what nothing can still be driving',
      wrecksOn(stale).length === 0, wrecksOn(stale).length);
    check('…and spares the window a rig may still be out on',
      wrecksOn(prev).length === 1 && wrecksOn(route).length === 1,
      `${wrecksOn(prev).length}/${wrecksOn(route).length}`);
    _clearWrecks();
    check('and a clean road has none on it', wrecksOn(route).length === 0);
  }

  // ── 4b. The damage model ───────────────────────────────────────────────────
  // Four components under one derived headline. Every case here is a rule from damage.js that would
  // be silently violable otherwise — most importantly the MIGRATION INVARIANT, which is what made
  // it safe to switch a live fleet over: a truck with no component bag must come out of this
  // identical to the truck that went in.
  {
    // The invariant, at both ends of the range and in the middle. `damageOf` on a row with no bag
    // falls back to the single condition for every part, and `overall` of a uniform bag is exactly
    // that number — so no existing truck's condition moved by a hair when this shipped.
    let uniformOk = true;
    for (const c of [1, 0.87, 0.5, 0.22, 0]) {
      const d = damageOf({ condition: c });
      if (Math.abs(overall(d) - c) > 1e-9) uniformOk = false;
    }
    check('a truck with no component bag is EXACTLY as worn as it was (the migration invariant)', uniformOk);

    // Weakest link, not a mean. This is the case the whole weighting exists for: an average would
    // let a perfect engine and a perfect body hide wheels that are about to end the evening.
    const oneDead = overall({ engine: 1, wheels: 0, body: 1 });
    check('one destroyed component reads as a destroyed truck, not as two-thirds of one',
      oneDead < 0.45, oneDead);
    check('…and it is strictly worse than the mean would have been', oneDead < 2 / 3);

    // Miles never dent panels. The body bar is a history of impacts and nothing else, and if
    // distance ever leaks into it the component stops meaning anything.
    const roadSplit = wearSplit(0.01, { surface: 'road' });
    check('distance wears the engine and the wheels and NEVER the body', roadSplit.body === 0);
    const vergeSplit = wearSplit(0.01, { surface: 'offroad' });
    check('the verge is a tyre bill — wheels wear far harder off the tarmac',
      vergeSplit.wheels > roadSplit.wheels * 3, `${vergeSplit.wheels} vs ${roadSplit.wheels}`);
    check('…and the engine does not care what it is rolling over',
      Math.abs(vergeSplit.engine - roadSplit.engine) < 1e-9);

    // Impacts land where the truck was hit, and every area costs the SAME total — which is what
    // makes the client's `area` token safe to trust. It chooses a destination, never a discount.
    for (const area of IMPACT_AREAS) {
      const s = impactSplit(0.2, area);
      const sum = s.engine + s.wheels + s.body;
      check(`a ${area} impact costs the same total as any other`, Math.abs(sum - 0.2) < 1e-9, sum);
      // The body is never NOT the biggest share. That is what makes it the impact component, and
      // it is what stops any area token being a way to route damage somewhere cheaper to fix.
      check(`…and the body always takes the largest share of it`,
        s.body >= Math.max(s.engine, s.wheels), JSON.stringify(s));
    }
    check('a scrape down the flank is a wheel bill in a way a nose-first hit is not',
      impactSplit(1, 'side').wheels > impactSplit(1, 'front').wheels * 3);
    check('backing into something barely touches the engine',
      impactSplit(1, 'rear').engine < impactSplit(1, 'front').engine / 5);

    // A full bag must reproduce the untouched parameter set exactly, or every truck in the game
    // quietly changed handling the day this landed.
    const eff = partEffects({ engine: 1, wheels: 1, body: 1 });
    check('an undamaged truck is affected by nothing',
      eff.thrustMax === 1 && eff.brake === 1 && eff.grip === 1, JSON.stringify(eff));
    const worn = partEffects({ engine: 0, wheels: 0, body: 0 });
    check('…and a destroyed one is slower and vaguer but never immobile',
      worn.thrustMax > 0.5 && worn.brake > 0.5 && worn.grip > 0.5, JSON.stringify(worn));
    // The body is the one component with NO mechanical effect, and it has to stay that way — the
    // moment it makes you slower it is a second engine bar wearing a different name.
    const bodyOnly = partEffects({ engine: 1, wheels: 1, body: 0 });
    check('a battered body costs you resale and nothing else — it never makes the truck worse to drive',
      bodyOnly.thrustMax === 1 && bodyOnly.brake === 1 && bodyOnly.grip === 1);

    // The bottom of the bar is a wall. A worn-out truck breaking down is not a die roll.
    check('a truck at the bottom of the bar breaks on the next tile, every time',
      breakChance(1, { condition: 0 }) === 1 && breakChance(1, { condition: TERMINAL_CONDITION }) === 1);
    check('…and a healthy one never does', breakChance(500, { condition: 0.9 }) === 0);
    check('…and standing still cannot break anything', breakChance(0, { condition: 0 }) === 0);
    check('the terminal gate agrees with the roll', isTerminal(0) && !isTerminal(0.5));

    // `applyDamage` is the only writer, and the headline number must always follow the parts it is
    // derived from — a path that writes one without the other is how a paid-for repair gets undone.
    const rig = { dmg: { engine: 1, wheels: 1, body: 1 }, condition: 1 };
    applyDamage(rig, impactSplit(0.3, 'front'));
    check('applying damage re-derives the headline number from the parts',
      Math.abs(rig.condition - overall(rig.dmg)) < 1e-9 && rig.condition < 1);
    check('…and nothing can be driven below zero', applyDamage(rig, { engine: 99, wheels: 99, body: 99 }) === 0);

    // A MISSED SHIFT IS THE DRIVELINE'S BILL AND NOBODY ELSE'S. The gearbox has no bar of its own
    // (see grindSplit) and it must not quietly become the body's problem: no sheet metal moved.
    const g = grindSplit(1);
    check('a grind lands on the engine alone', g.engine > 0 && g.wheels === 0 && g.body === 0);
    check('…and one of them is a wince, not an incident', g.engine < impactSplit(wearForImpact(30), 'front').body);
    check('…and a laden box pays more for the same mistake', grindSplit(3).engine > g.engine);
    // The multiplier is clamped at both ends: a client cannot report itself into a free grind, and
    // a hitched trailer cannot turn one into a write-off.
    check('…within bounds, whatever it is handed', grindSplit(1e6).engine === grindSplit(4).engine
      && grindSplit(0).engine === grindSplit(0.25).engine);
  }

  // ── 4i. Filth ──────────────────────────────────────────────────────────────
  // The truck gets dirty and a hose puts it back. Every case here is a rule from filth.js, and the
  // first one is the one that matters most: this is COSMETIC, and a suite that lets it quietly
  // become a fifth damage component is a suite that lets a car wash repair an engine.
  {
    // IT NEVER TOUCHES THE HEALTH OF THE TRUCK. Not by import and not by arithmetic — the filth
    // module and the damage module share no reader, so the only way this can go wrong is somebody
    // wiring `accrueGrime` into the wear split, and this is what catches that.
    const t = { dmg: { engine: 0.8, wheels: 0.7, body: 0.9 }, condition: 0.74, grime: 0 };
    const before = overall(t.dmg);
    for (let i = 0; i < 400; i++) accrueGrime(t, 1, { surface: 'offroad' });
    check('filth never moves the condition of the truck — it is cosmetic, and that is load-bearing',
      Math.abs(overall(t.dmg) - before) < 1e-9 && Math.abs((t.condition ?? 1) - 0.74) < 1e-9);
    check('…and it does saturate, rather than climbing forever', t.grime === 1);

    // THE VERGE IS THE THING THAT DIRTIES A TRUCK. The tarmac is deliberately not zero (a highway
    // at speed throws grit), but it must never be the thing that maxes the bar over a normal haul,
    // or the number saturates on every run and stops saying anything at all.
    const road = { grime: 0 }, verge = { grime: 0 };
    for (let i = 0; i < 300; i++) { accrueGrime(road, 1, { surface: 'road' }); accrueGrime(verge, 1, { surface: 'shoulder' }); }
    check('300 tiles of tarmac leaves a truck used, not filthy', road.grime > 0.05 && road.grime < 0.55, road.grime);
    check('…and the same distance on the shoulder is far worse', verge.grime > road.grime * 2.5, `${road.grime} vs ${verge.grime}`);

    // ⚠ RAIN IS NOT A CAR WASH. It takes the dust off and leaves the film, and the hose at the
    // depot is the only thing that finishes the job — if weather could finish it, a wash would be
    // a thing you wait out rather than a thing you buy.
    const wet = { grime: 1 };
    for (let i = 0; i < 4000; i++) accrueGrime(wet, 1, { surface: 'road', weather: 'storm' });
    check('a downpour cleans a truck up to a point and no further', wet.grime > 0.2 && wet.grime < 0.5, wet.grime);
    const dirty = { grime: 0.05 };
    for (let i = 0; i < 200; i++) accrueGrime(dirty, 1, { surface: 'shoulder', weather: 'rain' });
    check('…and below the film the road is still throwing muck at you', dirty.grime > 0.05, dirty.grime);

    // ON DISTANCE, NEVER ON THE CLOCK — the rule fuel and wear already follow. A truck standing in
    // a shed while somebody reads a job board is not getting dirty, because nothing is happening.
    const parked = { grime: 0.3 };
    accrueGrime(parked, 0, { surface: 'offroad' });
    check('a truck that has not moved does not get dirty', parked.grime === 0.3);

    // The bands, and the price that hangs off them.
    check('a clean truck is CLEAN and a buried one is BURIED',
      grimeBand(0).key === 'clean' && grimeBand(1).key === 'buried');
    check('a wash is free on a clean truck and never more than the top of the scale',
      washCost(0) === 0 && washCost(1) <= WASH_FULL && washCost(1) >= washCost(0.5));

    // THE TINT IS THE ONE CONVERSION, and this is the case that keeps it honest: a livery must
    // change with the dirt, must not change WITHOUT it, and must never reach the muck colour
    // outright — the paint the player bought has to stay legible as itself at the top of the bar.
    const paint = { base: '#c0392b', trim: '#2e86de', hw: '#23262b', deck: '#c0392b', bright: '#d8dee9',
      glow: '#60c4d6', glass: '#324a5c', chrome: 1, flash: 'stripe', finish: 'gloss', art: 'none' };
    const clean = truckLivery(paint, 0), filthy = truckLivery(paint, 1);
    check('a clean truck renders EXACTLY the paint it was sprayed with (the no-op invariant)',
      clean.base === paint.base && clean.trim === paint.trim && clean.finish === 'gloss' && clean.chrome === 1);
    check('a filthy one does not', filthy.base !== paint.base && filthy.trim !== paint.trim);
    check('…but it is still red under there, not brown-on-brown with every other truck',
      filthy.base !== filthy.trim && parseInt(filthy.base.slice(1, 3), 16) > parseInt(filthy.base.slice(3, 5), 16));
    check('the brightwork dies and the LAMPS do not — a lamp is light coming out',
      filthy.glow === paint.glow && filthy.chrome < 0.5);
    check('and enough dirt is a matte coat, because it is', filthy.finish === 'matte');
    check('an unpainted truck still converts to nothing at all, dirty or not',
      Object.keys(truckLivery(null, 1)).length === 0);
  }

  // ── 4j. Cosmetic fittings ──────────────────────────────────────────────────
  // Thirty-eight things that do nothing, and the cases are all about the ways "does nothing" can
  // quietly become "does something" — to the mesh, to the lamps, or to the wire.
  {
    // THE CODE IS THE WIRE AND IT IS STAMPED IN LIVE ROWS. fittings.js throws at import on a
    // collision, so this is the belt to that braces: two characters, lower case, unique.
    const codes = FIT_IDS.map((id) => FITTINGS[id].code);
    check('every fitting has a distinct two-character code',
      new Set(codes).size === codes.length && codes.every((c) => /^[a-z]{2}$/.test(c)));
    check('every fitting sits in a real slot',
      FIT_IDS.every((id) => SLOTS.some((s) => s.id === FITTINGS[id].slot)));
    // A SLOT WITH NOTHING IN IT IS A DEAD CELL. The depot's rig sheet renders one cell per slot and
    // opens that slot's shelf when you click it, so an empty slot is a button that opens nothing —
    // and the sheet is also the navigation, so there is no other way back out of it.
    check('every place on the truck has something you can put there',
      SLOTS.every((s) => FIT_IDS.some((id) => FITTINGS[id].slot === s.id)),
      SLOTS.filter((s) => !FIT_IDS.some((id) => FITTINGS[id].slot === s.id)).map((s) => s.id).join(' '));
    // ⚠ `rig fit <place>` IS A LISTING AND `rig fit <thing>` IS A PURCHASE, and the only thing
    // keeping those apart is that no fitting is NAMED after a place. A collision would not error —
    // it would silently print a shelf where somebody expected to buy something (or, if the
    // precedence in `rigFit` were ever flipped, charge them for a listing).
    const places = new Set(SLOTS.flatMap((s) => [s.id, s.label.toLowerCase()]).concat('all'));
    const clash = FIT_IDS.filter((id) => places.has(id) || places.has(FITTINGS[id].name.toLowerCase()));
    check('no fitting is named after a place on the truck', clash.length === 0, clash.join(' '));

    // ONE PER SLOT, enforced on READ rather than only at the write — a hand-edited bag, an old row
    // or a fitting that changes slot in a later build would all otherwise put two bars on a truck.
    const twoBars = installedFits({ fits: ['rampl', 'tusks', 'cage'] });
    check('two fittings for one place resolve to one, first mention winning',
      twoBars.length === 2 && twoBars.includes('rampl') && !twoBars.includes('tusks'));
    check('a junk id in the bag wears nothing rather than crashing a renderer',
      installedFits({ fits: ['nonesuch', 'skull'] }).join() === 'skull');

    // ⚠ THE SUFFIX MUST BE CANONICAL. It is a client mesh-cache key, so the same truck described in
    // two orders MUST produce the same string — otherwise a rig holds one cached mesh per
    // permutation of its own fittings, which is the exact leak the cache cap exists to bound.
    check('the same fittings in any order produce the same suffix',
      fitSuffix({ fits: ['skull', 'cage', 'rampl'] }) === fitSuffix({ fits: ['rampl', 'skull', 'cage'] }));
    check('a bare truck adds nothing to the wire at all', fitSuffix({}) === '' && fitSuffix(null) === '');
    check('the suffix round-trips through the code table',
      fitSuffix({ fits: ['rampl'] }) === '^rp' && fitByCode('rp').id === 'rampl');

    // EVERY FITTING ACTUALLY DRAWS SOMETHING. This is the case that catches the real failure mode —
    // a code in the catalogue that no branch in `buildTruck` matches — which is silent in every
    // other way: the truck renders, the money is taken, and nothing appears. Tested against the
    // CONTINENTAL because it is the only rig with every feature a fitting can hang off (two stacks,
    // a bonnet, a sleeper); a stack sleeve on a scrapper legitimately draws nothing.
    const bare = aircraftFaces('truck', 1, false, 'continental').length;
    const silent = FIT_IDS.filter((id) => aircraftFaces('truck', 1, false, 'continental^' + FITTINGS[id].code).length <= bare);
    check('every fitting in the catalogue puts geometry on the truck', silent.length === 0, silent.join(' '));

    // …AND THE SCREEN SLOT DRAWS ON EVERY SHAPE, which is the one place that claim can be made for
    // all four rigs: a stack fitting has nothing to hang off a scrapper and a mascot moves to the
    // cowl on a cab-over, but every truck in the game has a windscreen. The pieces are quads in the
    // screen's own raked plane rather than boxes, and that plane is derived per shape — so this is
    // the case that would catch a cab-over's screen fittings being authored against a bonneted
    // truck's stations and landing in mid-air, on the two cheapest rigs only.
    const glassIds = FIT_IDS.filter((id) => FITTINGS[id].slot === 'glass');
    const blindShapes = ['scrapper', 'hauler', 'drayman', 'continental'].filter((sh) => {
      const bareN = aircraftFaces('truck', 1, false, sh).length;
      return glassIds.some((id) => aircraftFaces('truck', 1, false, sh + '^' + FITTINGS[id].code).length <= bareN);
    });
    check('everything for the screen draws on every truck, bonnet or not', blindShapes.length === 0, blindShapes.join(' '));

    // NO FITTING IS LOAD-BEARING GEOMETRY. Nothing may move the door decal, the kingpin, the lamp
    // pods or the centring — thirty-eight parts must not be thirty-eight ways to break one mesh.
    aircraftFaces('truck', 1, false, 'continental');
    const m0 = truckMeta('continental:1');
    const all = '^' + FIT_IDS.map((id) => FITTINGS[id].code).join('.');
    aircraftFaces('truck', 1, false, 'continental' + all);
    const m1 = truckMeta('continental' + all + ':1');
    check('a fully fitted truck has the same door panel, pin, cab back and pods as a bare one',
      m1 && Math.abs(m1.pin - m0.pin) < 1e-9 && Math.abs(m1.door.f0 - m0.door.f0) < 1e-9
        && Math.abs(m1.cabBack - m0.cabBack) < 1e-9 && m1.pods.length === m0.pods.length,
      m1 ? `${m1.pin} vs ${m0.pin}` : 'no meta');

    // ⚠ THE SUFFIX MUST NOT EAT THE TRAILER MARKER. `^` can follow `+t`, and a lazy strip would hand
    // the type parser a tail of 't^rp' — every fitted rig would silently render bobtail, which is
    // the sort of bug that reads as "the trailer disappeared sometimes".
    const loaded = aircraftFaces('truck', 1, false, 'hauler+t').filter((f) => f.deck).length;
    const loadedFit = aircraftFaces('truck', 1, false, 'hauler+t^rp.lb').filter((f) => f.deck).length;
    check('a fitted rig still has its trailer', loadedFit === loaded && loaded > 20, `${loadedFit} vs ${loaded}`);
    check('…and is still the same truck, not a fallback hauler',
      aircraftFaces('truck', 1, false, 'scrapper^sk').length < aircraftFaces('truck', 1, false, 'continental^sk').length);

    // A DROPPED BOX WEARS NOBODY'S FITTINGS. They are bolted to the TRACTOR, and the solo splice is
    // what a trailer standing in a yard is cut at — a fitting emitted after that split survives it.
    check('a dropped trailer never wears the tractor that left it',
      aircraftFaces('truck', 1, false, 'hauler+t~s' + all).length === aircraftFaces('truck', 1, false, 'hauler+t~s').length);

    // THE LIGHT IS LIGHT, NOT GEOMETRY (the rule written on `pod()`), and only the fitting that was
    // bought lights up.
    check('underglow adds lamp stations only when it is fitted',
      (vehicleLamps('truck', 'hauler^ug').neon || []).length > 0 && (vehicleLamps('truck', 'hauler').neon || []).length === 0);
    check('…and a beacon is one station, not a set', !!vehicleLamps('truck', 'hauler^bc').beacon && !vehicleLamps('truck', 'hauler').beacon);
    check('a fitted truck lights its headlamps in exactly the same places',
      JSON.stringify(vehicleLamps('truck', 'hauler^rp.lb.ug').head) === JSON.stringify(vehicleLamps('truck', 'hauler').head));

    // OWNED ONCE, WORN WHENEVER — the rule that makes experimenting free.
    check('a fitting you already own costs nothing to put back on',
      priceFor({ owned_fits: ['skull'] }, 'skull') === 0 && priceFor({}, 'skull') === FITTINGS.skull.price);
  }

  // ── 5. The whole haul, end to end, through the real verbs ──────────────────
  // Depot → city street → off the rim → the crossing → the far region. A synthetic depot that is
  // ALSO a rim tile (so the city leg is one tile long and the case stays fast), a real
  // `launchCrossing`, and then the truck driving every tile of the corridor via `trucksync`.
  // This is the case that would catch the drive and the crossing disagreeing about which room the
  // player is standing in, and the one that proves a rig can change legs without losing the player.
  {
    voidTest.setWindow(2900);
    voidTest.setEncounters(false);          // a foe blocking the spine is voidwalking's case, not ours
    const prev = new Map([[GATE, world.zones.get(GATE)], [DEST, world.zones.get(DEST)]]);
    // GATE is a depot AND a rim tile (so the city leg is one tile long and this case stays fast),
    // with one real neighbour east so the move-gate path has a resolvable target to be blocked on.
    // ⚠ THESE FIXTURES NAME THEMSELVES AS THEIR OWN YARD, and they have to say it out loud. They are
    // road tiles rather than buildings — deliberately, because this case is about the CROSSING and a
    // shed either end would buy it nothing but two more rooms to walk through — and `yardIdOf` no
    // longer falls back to the depot's own id when `yard` is missing. That fallback was the legacy
    // depot shape, and on real content it silently mounted a truck inside a building; here the same
    // arrangement is what the case wants, so it is authored rather than inherited.
    const NEXT = 'zone_regress_trucknext';
    prev.set(NEXT, world.zones.get(NEXT));
    world.zones.set(GATE, mkZone(GATE, 'Truck Gate', {
      map_id: 'map_world', grid_x: 2000, grid_y: 2000, exits: { east: NEXT },
      flags: { region_id: VOIDKEY, terrain: 'road', truck_depot: { name: 'Test Yard', yard: GATE } },
    }));
    world.zones.set(NEXT, mkZone(NEXT, 'Kessler Street', {
      map_id: 'map_world', grid_x: 2001, grid_y: 2000, exits: { west: GATE },
      flags: { region_id: VOIDKEY, terrain: 'road' },
    }));
    world.zones.set(DEST, mkZone(DEST, 'The Reach', {
      map_id: 'map_world', grid_x: 2000, grid_y: 2630,
      flags: { region_id: 'region_the_reach', terrain: 'dirt_road', truck_depot: { name: 'The Last Load', yard: DEST } },
    }));
    voidTest.invalidateRimIndex();

    // The load board offers runs to every OTHER depot it knows about — including the real ones in
    // shipped content. A test that let those in would have its cargo bound for Dray Lane and could
    // never deliver, and worse, would start failing the day somebody authors a new depot. Take the
    // world's depots off the board for the duration; this case owns its own geography.
    const realDepots = [];
    for (const z of world.zones.values()) {
      if (z.flags?.truck_depot && z.id !== GATE && z.id !== DEST) { realDepots.push([z, z.flags.truck_depot]); delete z.flags.truck_depot; }
    }

    removePlayerFromZone(player.id, player.current_zone);
    player.current_zone = GATE; addPlayerToZone(player.id, GATE);
    setLivePlayer(player.id, player);   // (pid, data) — a one-arg call keys the map by the OBJECT
                                        // and stores undefined, which every getAllLivePlayers()
                                        // consumer then trips over. It took down movement.edge.
    // The suites share one player, and voidwalking's own cases open musters on it. A muster left
    // standing makes `movement.edge` bail before it ever tests the rim, so stepping off the edge
    // reports an ordinary wall and this whole case fails for a reason that has nothing to do with
    // trucks. Start from a clean board rather than inheriting one.
    voidTest.playerStaging.delete(player.id);
    for (const [sid, st] of voidTest.stagings) if (st.leaderId === player.id) voidTest.stagings.delete(sid);
    delete player._crossing;

    try {
      // A haul starts at a DEPOT, not out in the waste.
      const board = await run('haul');
      check('a depot shows a load board', /freight board/i.test(board?.message || ''), board?.message?.slice(0, 40));
      // Not a specific destination by name any more: phase 4 mixed local dock runs into the board,
      // so what a board is guaranteed to have is WORK, not a particular town.
      check('…listing somewhere to take it', /\d+ kg/i.test(board?.message || ''), board?.message?.slice(0, 80));

      // ── Ownership is the gate ──
      const broke = await run('drive');
      check('you cannot drive without owning a truck',
        /don't own a truck/i.test(broke?.message || ''), broke?.message?.slice(0, 45));

      const yard = await run('yard');
      check('the yard lists the dealer stock', (yard?.stock || []).length >= 4, yard?.stock?.length);
      // Trucks are maker + haulage model, a different family from the aircraft (animals and
      // insects). An early cut named one the "Kestrel Mule" and collided with `ac_mule` twice over.
      // RANGE IS A LADDER, tuned against the REAL route (495 tiles one way, ~990 round). The first
      // cut sized tanks against 765 — the geography of this very fixture, where DEST sits 630 tiles
      // out — and produced a fleet where even the 1,300₵ beater round-tripped on one fill, so the
      // `fuel` verb had nothing to do and every gauge read full. These assert the shape, not the
      // numbers: the cheap truck must NOT get home on one tank and the dear one must.
      const ONE_WAY = 495, ROUND = ONE_WAY * 2;
      const byPrice = [...(yard?.stock || [])].sort((a, b) => a.price - b.price);
      check('the cheapest truck cannot round-trip on one tank',
        byPrice[0] && byPrice[0].tank < ROUND, `${byPrice[0]?.name} ${byPrice[0]?.tank}`);
      check('…but it does reach the far side with fuel to spare',
        byPrice[0] && byPrice[0].tank > ONE_WAY * 1.1, `${byPrice[0]?.tank} vs ${ONE_WAY}`);
      check('the dearest truck round-trips comfortably',
        byPrice[byPrice.length - 1]?.tank > ROUND * 1.25, byPrice[byPrice.length - 1]?.tank);
      check('range rises with price, with no rung out of order',
        byPrice.every((t, i) => i === 0 || byPrice[i - 1].tank <= t.tank), byPrice.map(t => t.tank).join(' < '));
      check('no truck borrows an aircraft\'s name',
        !(yard?.stock || []).some(t => /\b(mule|kestrel|mayfly|locust|dragonfly|viper|reaper|leviathan|grasshopper|carcass)\b/i.test(t.name)),
        (yard?.stock || []).map(t => t.name).join(', '));
      check('…cheapest first, so the ladder reads top-down',
        (yard?.stock || []).every((t, i, a) => i === 0 || a[i - 1].price <= t.price));
      check('…and an empty fleet is an empty fleet', Array.isArray(yard?.fleet));

      const savedCredits = player.credits || 0;
      player.credits = 40000;
      const tooRich = await run('yard buy continental');
      check('a truck you can afford is bought', !!tooRich && !/cannot|have \d/.test(tooRich?.message || ''), tooRich?.message?.slice(0, 45));
      check('…and it cost the sticker price', player.credits === 40000 - TYPES.continental.price, player.credits);
      // ── A YARD IS WHERE A FLEET LIVES ─────────────────────────────────────
      // This used to assert the opposite: a yard held ONE of yours and the second buy was refused,
      // so that `drive` never had to ask which. What that bought was an unambiguous verb and what
      // it cost was the only place a fleet can actually BE — "own several trucks" meant "own
      // several, in several towns". The ambiguity is answered where it arises now, and only when
      // there is something to be ambiguous about.
      const second = await run('yard buy scrapper');
      check('a second truck can stand in the same yard as the first',
        /Bought/i.test(second?.message || ''), second?.message?.slice(0, 45));
      const { rows: both } = await query('SELECT id, type_id FROM trucks WHERE owner_id=$1 AND depot_zone=$2 ORDER BY created_at',
        [player.id, player.current_zone]);
      check('…and both of them are really parked here', both.length === 2, both.map(r => r.type_id).join(' + '));

      // WITH TWO IN THE YARD, THE VERB ASKS — and the asking is a MENU, because every line of it
      // is the command that picks that truck. A refusal that does not name its own way out is a
      // bug with prose on it.
      const ask = await run('drive');
      check('…so a bare `drive` asks which one rather than guessing',
        !rigOf(player) && /Which one/i.test(ask?.message || ''), ask?.message?.slice(0, 40));
      check('…and names every one of them, with the command to take it',
        both.every(r => (ask?.message || '').includes(`drive ${r.id}`) || /drive scrapper|drive continental/i.test(ask?.message || '')),
        (ask?.message || '').slice(0, 120));
      const wrong = await run('drive tanker');
      check('…and a name that is nothing of yours says so instead of taking the nearest',
        !rigOf(player) && /answers to/i.test(wrong?.message || ''), wrong?.message?.slice(0, 45));
      const picked = await run('drive scrapper');
      check('…while naming one takes THAT one', rigOf(player)?.typeId === 'scrapper', rigOf(player)?.typeId);
      // ── PARKING INSIDE A DEPOT LEAVES YOU ABLE TO DRIVE OUT OF IT ──────────
      // The reported symptom is that the yard screen's CLIMB IN buttons do nothing after you park
      // in a shed, while the identical buttons work if you walked in — so the two ways of arriving
      // at one screen disagree about where you are standing. `drive` mounts you INSIDE the shed
      // (mountSpot), which is a different tile from the bay you bought in, and `park` leaves you
      // on it: whatever the panel offers from there has to actually run from there.
      const parkedIn = await run('park');
      check('parking inside a depot gets you out of the cab', !rigOf(player), parkedIn?.message?.slice(0, 40));
      const zoneAfterPark = player.current_zone;
      const backIn = await run('drive scrapper');
      check('…and the truck you just parked can be driven again from where you stand',
        rigOf(player)?.typeId === 'scrapper',
        `at ${zoneAfterPark} → ${backIn?.message?.slice(0, 70)}`);
      await run('park');

      // ── AND EACH ONE IS PAINTED SEPARATELY ────────────────────────────────
      // Paint has always lived on the truck's own row, but nothing proved it: one bag per truck is
      // only true until something writes the wrong row, and the symptom of that would be a whole
      // fleet turning the colour of the last thing you resprayed.
      const [tA, tB] = both.map(r => r.id);
      player.credits = 40000;
      await run(`rig paint ${tA} base=#101820 flash=flame`);
      await run(`rig paint ${tB} base=#e0d8c0 flash=scallop`);
      const { rows: painted } = await query(
        "SELECT id, custom_data->'paint'->>'base' AS base, custom_data->'paint'->>'flash' AS flash FROM trucks WHERE owner_id=$1 AND depot_zone=$2",
        [player.id, player.current_zone]);
      const pA = painted.find(r => r.id === tA), pB = painted.find(r => r.id === tB);
      check('two trucks in one yard hold two different paint jobs',
        pA?.base === '#101820' && pB?.base === '#e0d8c0', `${pA?.base} vs ${pB?.base}`);
      check('…right down to the flash, which is the half nobody looks at',
        pA?.flash === 'flame' && pB?.flash === 'scallop', `${pA?.flash} vs ${pB?.flash}`);
      // And the yard SAYS so — the panel and the log rung both read one list, and a paint that
      // reaches the database and not the screen is a paint nobody bought.
      const twoUp = await run('yard');
      check('…and the yard hands the client both trucks, each with its own paint',
        (twoUp?.fleet || []).length >= 2
        && (twoUp?.fleet || []).some(t => t.paint?.base === '#101820')
        && (twoUp?.fleet || []).some(t => t.paint?.base === '#e0d8c0'),
        (twoUp?.fleet || []).map(t => t.paint?.base).join(', '));

      // ── AND THE ROOM'S OWN LINK HAS TO BE A VERB THAT WORKS ───────────────
      // "Parked up:" was copied off flight's ramp line complete with `examine <name>`, which works
      // THERE because flight shadows the examine verb and nothing here does: a truck is not an
      // item, an NPC or furniture, so SIFT cannot see one and every click on a parked rig answered
      // "You don't see \"orlov continental\" here." A dead affordance is worse than none.
      const room = await truckTest.describeDepot(world.zones.get(player.current_zone), player);
      check('a truck parked in the yard is a link that climbs into it',
        new RegExp(`data-cmd="drive ${tA}"`).test(room || ''), (room || '').slice(-150));
      check('…and never an examine this plugin cannot answer',
        !/data-cmd="examine /.test(room || ''), (room || '').slice(-150));
      const stranger = await truckTest.describeDepot(world.zones.get(player.current_zone), { id: 'p_nobody' });
      check("…while somebody else's rig is named without a button that could only refuse",
        /Parked up/.test(stranger || '') && !/data-cmd="drive /.test(stranger || ''), (stranger || '').slice(-150));

      // The rest of this suite drives THE truck at this yard, so the second one goes back to the
      // dealer — the assertions above are about owning two, not about the fixture keeping them.
      await query('DELETE FROM trucks WHERE id=$1', [tB]);
      await query("UPDATE trucks SET custom_data='{}'::jsonb WHERE id=$1", [both[0].id]);
      player.credits = 40000 - TYPES.continental.price;

      // ── Recovery: a truck you did not drive home ──────────────────────────
      // The whole point of the verb is a rig that is somewhere else, so the case has to put one
      // there. Parking it in another zone by hand is exactly the state a driver who caught a lift
      // back is in.
      {
        const { rows: mine } = await query('SELECT id, depot_zone FROM trucks WHERE owner_id=$1', [player.id]);
        const truckId = mine[0]?.id;
        const homeZone = mine[0]?.depot_zone;
        const away = [...world.zones.values()].find(z => z.id !== homeZone && z.grid_x != null
          && Math.hypot(z.grid_x - (world.zones.get(homeZone)?.grid_x ?? 0), z.grid_y - (world.zones.get(homeZone)?.grid_y ?? 0)) > 12);
        await query('UPDATE trucks SET depot_zone=$1 WHERE id=$2', [away?.id || null, truckId]);

        const denied = await run('drive');
        check('a truck parked elsewhere cannot be driven from here',
          !rigOf(player) && /not here|another yard|parked at/i.test(denied?.message || ''), denied?.message?.slice(0, 50));

        player.credits = 60;
        const broke = await run(`yard recall ${truckId}`);
        check('…and recovery quotes a price rather than happening on credit',
          /Recovery from/i.test(broke?.message || ''), broke?.message?.slice(0, 50));
        const stillAway = await query('SELECT depot_zone FROM trucks WHERE id=$1', [truckId]);
        check('…and nothing moved', stillAway.rows[0]?.depot_zone === (away?.id || null));

        player.credits = 40000;
        const before = player.credits;
        const towed = await run(`yard recall ${truckId}`);
        check('a low-loader fetches it home for a fee', /low-loader/i.test(towed?.message || ''), towed?.message?.slice(0, 45));
        check('…and the fee actually left the wallet', player.credits < before, `${before} → ${player.credits}`);
        const home = await query('SELECT depot_zone FROM trucks WHERE id=$1', [truckId]);
        check('…and the rig is standing in this yard now', home.rows[0]?.depot_zone === player.current_zone,
          `${home.rows[0]?.depot_zone} vs ${player.current_zone}`);
        const again = await run(`yard recall ${truckId}`);
        check('…and fetching one that is already here is refused, not billed twice',
          /already standing here/i.test(again?.message || ''), again?.message?.slice(0, 40));
        player.credits = 40000 - TYPES.continental.price;
      }

      // WHAT THE CLIENT IS ACTUALLY HANDED AT THE TURN OF THE KEY. This is captured rather than
      // asserted off the return value, because the windscreen is a PUSH and the return value is
      // only the prose beside it — which is exactly how the mount shipped broken: the payload was
      // built as `{ type: 'truck_sim', ...cabContext() }` and `cabContext` carries its own
      // `type: 'truck_ctx'`, so the spread overwrote it. The message went out as an ordinary
      // context update, the client's handler saw no cab open and returned on its first line, and
      // the driver was left mounted on a road tile with no cab and `drive` telling them they were
      // already behind the wheel. Nothing threw. Only the type on the wire could have caught it.
      const pushes = [];
      const savedBc = getBroadcast();
      setBroadcast((_z, message, _ex, targetId) => { if (targetId === player.id) pushes.push(message); });
      const got = await run('drive');
      setBroadcast(savedBc);
      const cab = pushes.find(m => m?.type === 'truck_sim');
      check('the cab itself is pushed to the client, as truck_sim', !!cab,
        pushes.map(m => m?.type).join(', ') || 'nothing pushed');
      check('…carrying the world window and the truck it is', !!cab?.map && !!cab?.params,
        `map=${!!cab?.map} params=${!!cab?.params}`);
      // ⚠ …AND WHAT TIME IT IS OUT THERE. The cab renders through the flight sim's canopy, which
      // has drawn a time-of-day sky since it was built — and this payload never carried `hour` or
      // `weather`, so the client's `?? 12` / `'clear'` defaults stood in and EVERY haul in the game
      // was driven at high noon under a clear sky. Nothing threw and nothing looked broken; the
      // world simply had no nights in it from behind a wheel. Absence is the whole failure mode
      // here, so it is asserted as presence rather than as a value.
      check('…and what time it is out there, so the cab is not stuck at noon', cab?.hour != null,
        `hour=${cab?.hour}`);
      check('…and the weather, so rain reaches the windscreen', !!cab?.weather, `weather=${cab?.weather}`);
      check('…and tonight\'s moon, in phase with every other canopy in the world',
        typeof cab?.moon === 'number' && cab.moon >= 0 && cab.moon < 1, `moon=${cab?.moon}`);
      // THE DOOR ONLY EXISTS IF YOU CAME OUT OF ONE. This suite's yard is a bare road tile
      // carrying the flag — the legacy apron shape, no shed — so the cab must be told there is no
      // roller door to lift. Getting this wrong is two and a half seconds of a player staring at
      // a steel shutter that was never in front of them.
      check('…and no roller door when you were never inside one', cab?.fromBay == null, cab?.fromBay);
      const rig = rigOf(player);
      check('a rig mounts at a depot once you own one', !!rig, got?.message?.slice(0, 50));
      // ── AND IT IS COLD ─────────────────────────────────────────────────────
      // Mounting used to start the engine, which left the one genuinely consequential switch on the
      // shelf with nothing to do on the only occasion anybody reaches for it. The cab seeds its own
      // sim from this bit, so if it stops reaching the wire the browser silently goes back to
      // mounting a running truck and no other check in this suite would notice.
      check('…with the engine OFF, because you have not turned the key yet', rig?.engineOn === false, rig?.engineOn);
      check('…and the cab is told so, or it seeds itself running', cabContext(rig).engineOn === false);

      // ── THE HORN ───────────────────────────────────────────────────────────
      // The SOUND has no cooldown and must never get one — a horn is meant to be leaned on. The
      // SENTENCE does: three identical lines in everybody's log is not a horn, it is what makes
      // somebody scroll past the line that mattered.
      const h1 = await run('horn');
      const h2 = await run('horn');
      check('a horn narrates the first pull', /pull the cord/i.test(h1?.message || ''), h1?.message?.slice(0, 40));
      check('…and the second inside the minute is silent, not refused',
        h2?.type === 'noop' && !h2?.message, JSON.stringify(h2).slice(0, 60));
      rigOf(player)._hornSaidAt = Date.now() - 61_000;
      const h3 = await run('horn');
      check('…and a minute later it says it again', /pull the cord/i.test(h3?.message || ''), h3?.message?.slice(0, 40));

      // EVERY TRUCK HAS ITS OWN HORN. `HORN[typeId] || HORN.drayman` means a missing row is a truck
      // that silently borrows another's trumpets — audible, plausible, and wrong forever.
      {
        const { HORN } = await import('../../client/game/js/panels/engine-audio.js');
        const voiceless = TRUCK_TYPES.filter(t => !HORN[t.id]).map(t => t.id);
        check('every truck in the fleet has a horn voice of its own', voiceless.length === 0, voiceless.join(', '));
        check('…and every one of them is loud enough to be the point of the device',
          TRUCK_TYPES.every(t => (HORN[t.id]?.gain ?? 0) >= 0.3),
          TRUCK_TYPES.map(t => `${t.id}:${HORN[t.id]?.gain}`).join(' '));
      }
      check('…and it is the truck you actually bought',
        rig?.typeId === 'continental' && rig?.type?.kg === 6200, `${rig?.typeId} ${rig?.type?.kg}kg`);
      check('…on the CITY leg, on real world tiles', rig?.leg === 'city', rig?.leg);
      check('…and it is not on a crossing yet', !player._crossing);

      // Phase 2: cargo needs a trailer. Taking the load bobtail must FAIL, and that refusal is
      // itself the case worth having — it is the only thing making bobtail a real state.
      // Phase 4 mixed LOCAL dock runs into the board, so slot 1 is no longer reliably the one that
      // crosses the waste. The suite picks the crossing deliberately — which is also the case for
      // the board carrying both kinds at once.
      const slots = truckTest.boardFor(player.current_zone);
      const crossSlot = (slots.find(b => b.crosses)?.i ?? 0) + 1;
      check('the board carries work that leaves town as well as work that does not',
        slots.some(b => b.crosses), slots.map(b => b.toName).join(', '));
      const bobtail = await run(`haul ${crossSlot}`);
      check('you cannot take freight bobtail', !rig?.cargo && /bobtail/i.test(bobtail?.message || ''), bobtail?.message?.slice(0, 40));
      // Phase 2.9: a trailer is a ROW you have to own and that has to be standing here. Buying one
      // is part of the loop now, not a formality the suite can skip.
      const gotBox = await run('yard buy box');
      check('you can buy a trailer off the same line as the trucks', /Bought/i.test(gotBox?.message || ''), gotBox?.message?.slice(0, 50));
      // …AND IT IS STOOD SOMEWHERE YOU CAN SEE IT. Stock used to be parked in the bay with no pose,
      // which made it undrawable (a bay has no coordinates) and hitchable from anywhere — the cab's
      // air knob named a box that was on no picture. It now stands on the hardstand at a real pose,
      // so buying one and coupling to one are two different acts with a manoeuvre in between.
      const stock = (await trailersAt(player.current_zone)).find(t => t.ownerId === player.id);
      check('a bought trailer is stood on the hardstand at a pose you can drive to', posed(stock),
        stock ? `${stock.x},${stock.y} @${stock.heading}` : 'nothing standing');
      check('…and it stays on the tile it is parked in, or `hitch` could never reach it',
        !!stock && Math.abs(stock.x - Math.round(stock.x)) <= 0.5 && Math.abs(stock.y - Math.round(stock.y)) <= 0.5,
        `${stock?.x},${stock?.y}`);
      // The truck is still in the shed doorway where `drive` put it, which is not under the pin.
      const across = await run('hitch');
      check('…so you cannot couple to it from across the yard', !rig?.trailer, across?.message?.slice(0, 60));
      // Back under it: the pose IS the coupling point, so standing on it squares every test.
      rig.x = stock.x; rig.y = stock.y; rig.heading = stock.heading; rig.speed = 0;
      const hitched = await run('hitch');
      check('you can hitch a trailer at a depot once the fifth wheel is under the pin',
        !!rig?.trailer, hitched?.message?.slice(0, 50));
      const load = await run(`haul ${crossSlot}`);
      check('you can take a load off the board', !!rig?.cargo, load?.message?.slice(0, 60));
      const bound = rig?.cargo?.to;

      // While driving you cannot walk — the two would disagree about where you are. Walk EAST,
      // toward a real neighbouring tile: the move gate only runs once a direction has resolved a
      // target, so a direction with no exit at all never reaches it (that case is the rim, and it
      // is held shut by the posture check in voidwalking's movement.edge instead).
      // Reset the step clock first — the pacing gate defers a too-fast move SILENTLY, which reads
      // as an empty result and looks exactly like the move gate never firing.
      player._lastStepAt = 0;
      const wasIn = player.current_zone;
      const walked = await run('east');
      check('a driver cannot walk out of the cab by accident',
        /behind the wheel/i.test(walked?.message || ''), walked?.message?.slice(0, 50));
      check('…and stays where the truck is', player.current_zone === wasIn, player.current_zone);

      // The rim is held shut a different way (posture, in movement.edge) — a muster overlay must
      // not open over a truck cab.
      player._lastStepAt = 0;
      const offRim = await run('south');
      check('a driver cannot open a void muster by stepping off the rim',
        offRim?.type !== 'voidwalk_staging' && !voidTest.playerStaging.has(player.id), offRim?.type);

      // Drive NORTH off the rim. In the city leg an off-map position is the rim, and the rim is
      // where the highway begins — the same `launchCrossing` a walker gets, from behind a wheel.
      rig.lastSync = 0;
      await run(`trucksync 0 0 0 40 2000 1999`);
      check('driving off the map starts a crossing', !!player._crossing);
      check('…and the rig changes to the corridor leg', rig.leg === 'corridor', rig.leg);
      check('the rig lays its road over the crossing\'s own room chain',
        rig.chain?.length > 0 && rig.chain[0] === player.current_zone, `${rig.chain?.length} rooms`);
      // ⚠ AND THE ROAD IT LAYS IS THE NETWORK'S, NOT THE OLD ONE. `routeForRig` keeps the pre-network
      // builder as a fallback for a crossing that cannot supply a gate at both ends, which is right
      // — and it means the whole network can be built, proven, wired, and silently not used, with a
      // green suite the entire time. This is the case that would notice. Three segments: the spoke
      // out, the middle, the spoke in.
      check('…and it is a NETWORK road — spoke, middle, spoke — not the old one-piece wander',
        rig.route?.segments?.length === 3, `${rig.route?.segments?.length ?? 'no'} segments`);
      check('…whose first segment is the shared spoke, so the fork happens at the interchange',
        rig.route.trunkL > 20 && Math.abs(rig.route.trunkL - rig.route.segments[0].L) < 1e-6,
        rig.route.trunkL?.toFixed(1));
      check('…and which still starts exactly on the gate it left',
        Math.hypot(corridorPos(rig.route, 0, 0).x - rig.x, corridorPos(rig.route, 0, 0).y - rig.y) < 0.01);

      // ── YOU CAN GET OUT ON THE ROAD, AND IT IS STILL THERE WHEN YOU COME BACK ──
      //
      // For a while it was not: a healthy rig parked mid-crossing was silently turned round and
      // driven back to the gate it came in by, so the one thing the corridor was built to allow —
      // stop, climb down, walk about, climb up — could not be done at all. `mountOnCrossing` could
      // always put a driver back into their own cab out here; nothing could get them out of it.
      //
      // The room the truck stops in is TRANSIENT, so this pins both halves: that the rig is left
      // exactly where it stopped, and that it names somewhere real to be dragged to when the
      // crossing ends without it. A park that silently failed to write `void_home` is a truck that
      // passes the first half of this test and is lost the moment the player walks out of the waste.
      //
      // ⚠ THE FIXTURE IS HANDED BACK ITS OWN RIG OBJECT AT THE END. The corridor sweep below holds
      // `rig` by identity and drives it tile by tile; `drive` builds a NEW rig, so leaving that one
      // in place strands the sweep on a stale object and the whole crossing block fails downstream
      // for reasons that look nothing like parking.
      {
        const roomBefore = player.current_zone;
        const truckId = rig.truckId;
        rig.speed = 0;
        const down = await run('park');
        check('void park: park lets go of the wheel rather than turning you round',
          !rigs.has(player.id) && player.current_zone === roomBefore,
          `${player.current_zone} vs ${roomBefore} | ${down?.message?.slice(0, 50)}`);

        const { rows: [t] } = await query(
          `SELECT depot_zone, impound_fee, custom_data->>'void_home' AS void_home FROM trucks WHERE id=$1`,
          [truckId]).catch(() => ({ rows: [] }));
        check('void park: the truck is parked in the room you left it in', t?.depot_zone === roomBefore,
          `${t?.depot_zone} vs ${roomBefore}`);
        // Truthiness, not `== null`: the lot is cleared by writing a ZERO fee (fleet.js
        // recoverTruck) and every reader in this plugin treats 0 and NULL as the same state.
        check('void park: …and stopping on purpose is not abandonment, so nothing impounds it',
          !t?.impound_fee, String(t?.impound_fee));
        check('void park: …but it names a real yard to be recovered to', !!t?.void_home, t?.void_home);

        const back = await run('drive');
        check('void park: you can climb back into your own rig out on the road',
          rigs.has(player.id), back?.message?.slice(0, 60));
        check('void park: …onto the corridor leg, not a generic roadhead tractor',
          rigs.get(player.id)?.leg === 'corridor' && rigs.get(player.id)?.truckId === truckId,
          `${rigs.get(player.id)?.leg} truck=${rigs.get(player.id)?.truckId === truckId}`);

        // AND THE ROOM GOING AWAY MUST NOT TAKE THE TRUCK WITH IT. The safety property is that the
        // row points at somewhere real either way — losing a 16,500₵ rig to a torn-down transient
        // zone is the failure this whole path exists to prevent.
        const home = t?.void_home;
        const moved = await truckTest.recoverTrucksFrom([roomBefore], null);
        const { rows: [after] } = await query(
          'SELECT depot_zone, impound_fee FROM trucks WHERE id=$1', [truckId]).catch(() => ({ rows: [] }));
        check('void park: a crossing ending drags an abandoned rig home rather than orphaning it',
          moved === 1 && after?.depot_zone === home, `${moved} moved → ${after?.depot_zone} (want ${home})`);
        check('void park: …and charges to fetch it', after?.impound_fee > 0, after?.impound_fee);
        // ⚠ IDEMPOTENT. The teardown event and the boot sweep can both reach the same truck, and a
        // fee re-set on every pass is a bill that grows while the rig sits still.
        const feeOnce = after?.impound_fee;
        await truckTest.recoverTrucksFrom([roomBefore, after?.depot_zone], null);
        const { rows: [again] } = await query(
          'SELECT impound_fee FROM trucks WHERE id=$1', [truckId]).catch(() => ({ rows: [] }));
        check('void park: …once, however many times the sweep runs', again?.impound_fee === feeOnce,
          `${feeOnce} → ${again?.impound_fee}`);

        // Put the fixture back exactly as the crossing left it: its own rig, on the road, mounted,
        // with the recovery bookkeeping undone so the sweep below drives a truck that is not in a lot.
        await query(`UPDATE trucks SET depot_zone=$1, impound_fee=NULL WHERE id=$2`, [roomBefore, truckId]).catch(() => {});
        rigs.set(player.id, rig);
        rig.engineOn = true; rig.locked = false;
        player.posture = 'driving';   // the fixture's own state, restored directly — no posture side effects wanted here
      }

      // ── THE GPS AND THE VERB GIVE ONE ANSWER ──────────────────────────────────
      //
      // The dash screen is a face for `route`, and the whole value of it over typing is the two facts
      // that MOVE: how far each fork is, and whether this truck's tank reaches. Both are derived from
      // things that change under you — a tune changes the tank, the fork passes behind you as you
      // drive — so the danger was never a wrong list, it was a STALE one that still looks authoritative.
      // `routeOptions` is the single implementation both surfaces read; these cases pin its shape and
      // the one rule the picker leans on.
      {
        const rig = rigs.get(player.id);
        if (rig && rig.leg === 'corridor') {
          const opts = routeOptions(rig, { zoneId: player.current_zone, forkAhead: atOrBeforeFork(rig) });
          check('routes: the road answers with its destinations', !!opts?.dests?.length,
            JSON.stringify(opts && { n: opts.dests?.length }));
          check('routes: every row carries the distance the picker prints',
            (opts?.dests || []).every((d) => Number.isFinite(d.tiles) && d.tiles > 0),
            JSON.stringify((opts?.dests || []).map((d) => d.tiles)));
          // THREE STATES, NOT A BOOLEAN. "further than your tank, one way" is a run you can choose to
          // make; collapsing it into "no" would turn a judgement call into a locked door.
          check('routes: reach is one of the three the screen paints',
            (opts?.dests || []).every((d) => ['ok', 'thin', 'far'].includes(d.reach)),
            JSON.stringify((opts?.dests || []).map((d) => d.reach)));
          check('routes: exactly one row is marked current',
            (opts?.dests || []).filter((d) => d.current).length <= 1,
            JSON.stringify((opts?.dests || []).map((d) => d.current)));
          // The picker shows the fork as live or dead off this flag alone — it never re-derives it.
          check('routes: forkAhead agrees with the road itself',
            opts.forkAhead === atOrBeforeFork(rig), `${opts.forkAhead} vs ${atOrBeforeFork(rig)}`);
          // …and the cab payload carries the same object, or the screen has nothing to draw.
          const cab = cabContext(rig, {});
          check('routes: the cab payload carries them, so the screen and the verb cannot disagree',
            !!cab.routes?.dests?.length && cab.routes.dests.length === opts.dests.length,
            JSON.stringify(cab.routes && { n: cab.routes.dests?.length }));
        }
      }


      // Drive the corridor. Feed the odometer forward at a legal rate; the plugin does the rest.
      const rooms = new Set([player.current_zone]);
      const tps = topTilesPerSec() * 0.6;
      // The guard is DERIVED from the road, not a magic number. It was a flat 4000, which quietly
      // became too small the moment the Reach crossing was pinned to 8 rooms — the haul then ran
      // out of iterations three rooms short and took eleven downstream assertions with it, none of
      // which had anything wrong with them. A bound that has to be re-guessed when the world
      // changes is a bound that will be wrong again.
      const guardMax = Math.ceil(rig.route.L / (tps * 0.25)) + 250;
      let t = 0, guard = 0;
      while (guard++ < guardMax && rigs.has(player.id) && rig.leg === 'corridor') {
        t += 250;
        const s = Math.min(rig.route.L, rig.s + tps * 0.25);
        const p = corridorPos(rig.route, s, 0);
        rig.lastSync = t - 250;             // hand the clamp an honest elapsed time
        await run(`trucksync ${s} 0 ${p.heading} 60 ${p.x} ${p.y}`);
        if (rigs.has(player.id) && rig.leg === 'corridor') rooms.add(player.current_zone);
      }
      check('the haul completes without running the guard out', guard < guardMax, `${guard} of ${guardMax}`);
      check('driving visited every room on the chain',
        (rig.chain || []).every(id => rooms.has(id)), `${rooms.size} of ${rig.chain?.length}`);
      check('arriving puts the driver in the destination region',
        player.current_zone === DEST, player.current_zone);
      check('…and ends the crossing', !player._crossing);
      check('…and puts the rig back on the CITY leg, still driving',
        rigs.has(player.id) && rig.leg === 'city', `${rig.leg} mounted=${rigs.has(player.id)}`);
      // The destination IS the depot the load named, so rolling in should have paid.
      check('delivering the load at its depot pays', bound === DEST && !rig.cargo,
        `bound=${bound} cargo=${rig.cargo ? 'still aboard' : 'delivered'}`);

      // ── The trade loop, at the far depot ──
      // Contracts are wages; this is the half where your own money is at risk. The rig is standing
      // in The Reach's yard, so buy what the Reach is cheap in and check the books add up.
      const before = player.credits || 0;
      const stake = before + 20000;
      player.credits = stake;                          // stake the test trader

      // The exchange on BOTH rungs. A price list is a surface you only READ, so the panel is the
      // `prefersLoggedPanels` axis: a visual player gets the terminal, a log player gets the same
      // numbers as prose. The panel must never be the only way to see a price.
      // ONE panel for the whole depot. `yard` and `market` are two questions about one place, so
      // they land on the same screen with a different tab open — a player should never have to
      // compare two panels to decide one thing.
      const exch = await run('market');
      const fleetView = await run('yard');
      check('a visual player gets the depot panel', exch?.type === 'truck_depot', exch?.type);
      check('…and `yard` is the same panel, not a second one',
        fleetView?.type === 'truck_depot', fleetView?.type);
      check('…opened on the tab you asked for',
        exch?.tab === 'market' && fleetView?.tab === 'fleet', `${exch?.tab} / ${fleetView?.tab}`);
      check('…carrying fleet, dealer, board and exchange all at once',
        ['fleet', 'stock', 'board', 'quotes'].every(k => Array.isArray(exch?.[k])),
        Object.keys(exch || {}).join(','));
      check('…carrying both the freight board and the exchange',
        Array.isArray(exch?.board) && Array.isArray(exch?.quotes), `${exch?.board?.length} loads, ${exch?.quotes?.length} goods`);
      check('…with a buy and a sell price on every good',
        (exch?.quotes || []).every(q => q.ask > 0 && q.bid > 0 && q.ask > q.bid));
      check('…and the client is told what it can afford, not left to work it out',
        (exch?.quotes || []).every(q => Number.isFinite(q.canAfford) && Number.isFinite(q.holds)));

      const savedForMarket = await displayRung(player);
      await setDisplayRung(player, 'log');
      // The depot at the log rung is now the generic list dialog, not a prose dump
      // (docs/audits/log-vs-dialog-audit.md — a price list you ACT on is a control,
      // and 40–60 lines of it was the biggest uncapped surface in the system). The
      // NUMBERS are what this case is really about, so they are asserted on the
      // rows; the prose form is asserted right below, because it still exists.
      const exchDlg = await run('market');
      check('a log-rung player gets the depot as a focusable dialog, not a panel',
        exchDlg?.type === 'list_dialog', exchDlg?.type);
      const exRows = (exchDlg?.rows || []).filter(r => r.group === 'Exchange');
      check('…carrying the exchange', exRows.length > 0, `${exRows.length} rows`);
      check('…including the buy/sell spread', exRows.every(r => /buy \d+₵ · sell \d+₵/.test(r.detail || '')),
        exRows[0]?.detail);
      check('…and every row offers a verb the player could have typed',
        exRows.every(r => (r.commands || []).every(c => /^market (buy|sell) /.test(c.command))));

      // ⚠ Nothing is taken away: `market text` still prints the identical prose at
      // any rung. If this breaks, the conversion has become a removal.
      const exchText = await run('market text');
      check('`market text` still gives the same numbers as prose',
        exchText?.type === 'emote' && /exchange/i.test(exchText?.message || ''), exchText?.type);
      check('…including the buy/sell spread', /buy · /.test(exchText?.message || ''));
      if (savedForMarket) await setDisplayRung(player, savedForMarket);
      else await setDisplayRung(player, 'visual');

      await run('hitch');   // the goods trade needs a deck too — the box was bought above
      const vague = await run('market buy');
      check('a bare buy asks what, rather than guessing', /Buy what/i.test(vague?.message || ''), vague?.message?.slice(0, 40));
      const nope = await run('market buy unobtainium');
      check('an unknown good is refused by name', /Nobody here trades/i.test(nope?.message || ''), nope?.message?.slice(0, 40));

      const bought = await run('market buy scrap full');
      const rig2 = rigOf(player);
      check('you can fill the trailer with what the Reach is cheap in',
        rig2?.cargo?.kind === 'goods' && rig2.cargo.key === 'scrap', bought?.message?.slice(0, 60));
      check('…and it cost you real money', (player.credits || 0) < stake);
      // WHAT THE DECK HOLDS IS THE TRAILER'S RATING. This case used to assert it was the TRUCK's
      // mass, which was standing in for a deck because there was no trailer to ask — and that
      // meant buying a bigger tractor bought you capacity it does not actually have. The truck
      // pulls; the box carries; the two are separate purchases and now say so.
      const rated = rig2.trailer.ratedKg;
      check('…and the deck is bounded by the TRAILER\'s rating, not the tractor\'s mass',
        rig2.cargo.kg <= rated && rig2.cargo.qty === capacityFor('scrap', rated),
        `${rig2.cargo.qty} × ${rig2.cargo.kg}kg on a ${rated}kg rated deck (tractor is ${rig2.type.kg}kg)`);
      // …and the ladder still exists, it has just moved onto the right object: a tanker carries
      // nearly three times a flatbed, and both are cheaper than any truck on the fence.
      check('…and a bigger box is a bigger deck',
        capacityFor('scrap', 6000) > capacityFor('scrap', 2200),
        `${capacityFor('scrap', 6000)} vs ${capacityFor('scrap', 2200)}`);

      const full = await run('market buy water 1');
      check('a full deck refuses a second load', /deck is full/i.test(full?.message || ''), full?.message?.slice(0, 40));

      // The ROUND TRIP must lose money — selling always adds credits, so the meaningful comparison
      // is against what you started with, not against the moment after you paid. This is the spread
      // doing its job: it is what stops a player earning by buying and selling on the spot without
      // ever driving anywhere, which would make the entire road optional.
      await run('market sell');
      check('buying and selling on the spot loses on the spread',
        player.credits < stake, `${stake} → ${player.credits}`);
      check('…and clears the deck', !rigOf(player).cargo);
      player.credits = before;                          // hand the stake back

      // ── PARK IS A SEQUENCE, AND THE KEY COMES FIRST ──
      // The refusal is tested through the REAL WIRE rather than by poking `engineOn`, because the
      // whole mechanic rests on one bit travelling in a slot of the sync packet that used to be a
      // literal 0. Setting the flag by hand would pass while the packet quietly stopped carrying it.
      const rg = rigOf(player);
      // ⚠ THE IGNITION GOES IN THROUGH `reconcileTruck`, NOT THROUGH THE `trucksync` VERB. A real
      // packet is a position as well as a state bit, and this rig is sitting on a corridor leg — so
      // any sync here crosses a node, which MOVES THE PLAYER into a void room, and the text-rung
      // block below then gets answered by `drive`'s roadhead branch and fails in four places for
      // reasons that have nothing to do with an ignition. `now` is pinned inside the throttle window
      // on purpose: it proves the bit is read BEFORE that gate (see the ⚠ in reconcileTruck), which
      // is the whole reason turning the key is felt immediately rather than up to a sync later.
      const ignition = (on) => reconcileTruck(rg, { t: on ? 1 : 0 }, rg.lastSync + 1);
      // ── WHAT STOPS YOU GETTING OUT IS MOTION, AND ONLY MOTION ────────────────
      // The refusal used to be the IGNITION, which made the cab's park-brake knob — the one
      // deliberate get-out gesture a driver has — answer with a lecture every time. Now a rolling
      // truck is the only thing that refuses, and the key is turned as part of parking.
      ignition(true);
      rg.speed = 24;
      const refused = await run('park');
      check('you cannot step out of a moving truck', rigs.has(player.id), refused?.message?.slice(0, 40));
      check('…and it says to stop it first', /rolling|stand/i.test(refused?.message || ''), refused?.message);
      rg.speed = 0;
      const out = await run('park');
      check('park drops you out of a stopped truck with the engine still running', !rigs.has(player.id), out?.message?.slice(0, 30));
      check('…and turns the key off on the way down', rg.engineOn === false);
      check('…and it locks the door behind you', rg.locked === true);
      // ── THE BOARD WORKS FROM WHERE THE BOARD IS ────────────────────────────
      // Standing in the yard, on foot, with a hitched truck in front of you — which is exactly the
      // state the depot panel opens in, and which used to refuse every button on it. `haul` and
      // `market buy` both opened with "get in a truck first", where `truck` meant a MOUNTED rig; and
      // mounting closes the panel, so the board could only be seen in the one state it could not be
      // used in. These are the cases that would notice it going back.
      check('the fixture is standing in the yard, out of the cab', !rigs.has(player.id));
      const footBoard = truckTest.boardFor(player.current_zone);
      const footSlot = (footBoard.find(b => b.crosses)?.i ?? 0) + 1;
      const onFoot = await run(`haul ${footSlot}`);
      check('you can take freight standing at the board, not only from the cab',
        /Loaded:/i.test(onFoot?.message || ''), onFoot?.message?.slice(0, 70));
      check('…and it says which truck it went on', /waiting for you/i.test(onFoot?.message || ''));

      // ⚠ AND IT LANDED ON THE TRAILER ROW, which is the only reason loading on foot is possible at
      // all: `rig.cargo` is a RAM copy hydrated at mount, so writing the box IS loading the truck.
      // A load that lived only in the panel would be gone by the time anybody turned a key.
      const footBox = (await trailersOf(player.id)).find(t => t.towedBy);
      check('…onto the trailer\'s own row, not into memory somewhere',
        !!footBox?.cargo && footBox.cargo.kg > 0, footBox?.cargo?.name || 'nothing on the row');

      // A second load must refuse for the RIGHT reason — the deck is full, not "get in a truck".
      const twice = await run(`haul ${footSlot}`);
      check('…and a loaded deck refuses a second contract', /Already loaded/i.test(twice?.message || ''),
        twice?.message?.slice(0, 50));
      const buyLoaded = await run('market buy scrap 1');
      check('…as does the exchange, on the same deck', /deck is full/i.test(buyLoaded?.message || ''),
        buyLoaded?.message?.slice(0, 50));

      // AND THE PANEL AGREES WITH THE VERB. The button was gated on `driving`, which is why it was
      // greyed out on the screen that displays it; it is gated on `canLoad` now, and that has to be
      // the same answer the verb gives or the two halves of the depot disagree again.
      const footPanel = await run('haul panel');
      const panelNow = footPanel?.type === 'truck_depot' ? footPanel : await run('yard');
      check('the panel says this yard can take a load, standing on foot',
        panelNow?.canLoad === true && !panelNow?.driving, `canLoad=${panelNow?.canLoad} driving=${panelNow?.driving}`);
      check('…and shows the load that is on the deck, which on foot it never used to',
        !!panelNow?.cargo, panelNow?.cargo?.name || 'no cargo on the panel');
      // …AND NAMES THE BOARD ROW IT CAME OFF. Without this the freight screen has no way to tell
      // which of the four rows it is already carrying, so it redrew a live Take it on all of them
      // after a load — the button the verb was certain to refuse. The client matches on the slot
      // AND on the name and destination, so all three have to be here.
      check('…and names the board slot the contract came off, so the row can dim',
        panelNow?.cargo?.slot === footSlot - 1
          && panelNow.cargo.name === footBoard[footSlot - 1].name
          && panelNow.cargo.to === footBoard[footSlot - 1].toName,
        `slot=${panelNow?.cargo?.slot} want ${footSlot - 1} · ${panelNow?.cargo?.to}`);
      check('…and quotes the box\'s real rating rather than a default',
        panelNow?.deckKg === footBox.ratedKg, `${panelNow?.deckKg} vs ${footBox.ratedKg}`);

      // Put it back as it was found: the rest of this fixture drives, and it must not inherit a
      // contract it did not take.
      await saveLoad(footBox.id, null, footBox.stash);


      // ── The text rung ──
      // The cab is a surface you ACT through, so a player at the textgames/log rung must be able to
      // make the run, not read about somebody else making it. This is the case that would catch a
      // rung being quietly locked out — the failure mode systems-display-mode.md exists to prevent.
      // Set the rung through `setDisplayRung`, not by poking `player.displayRung` — the predicates
      // read the FLAG and the latch is only a sync fast path for hot callers, so assigning the
      // latch alone leaves every `await prefersTextMinigames` still answering "visual".
      const savedRung = await displayRung(player);
      try {
        await setDisplayRung(player, 'log');
        const t = await run('drive');
        check('a text-rung player can still start a run', rigs.has(player.id), t?.message?.slice(0, 40));
        // Phase 2.5 changed what this rung IS. It used to be paced travel — "she drives herself,
        // you say when to stop" — and the gearbox, the one system you are meant to drive by ear,
        // was unreachable from it. The opening line now hands over the box, and it has to TEACH the
        // verbs, because a control nobody is told about is a control nobody has.
        check('…and is handed the gearbox, not just a lift', /revs up/i.test(t?.message || ''), t?.message?.slice(-90));
        check('…and told how to hold a descent', /jake/i.test(t?.message || ''));
        check('…and gets NO canvas cab pushed at them', !/truck_sim/.test(JSON.stringify(t || {})));
        check('…and is actually text-driving, not just mounted', isTextDriving(player.id));

        // THE BOX, BY TYPED COMMAND. The point of these is not that the words work — it is that
        // they reach the SAME `stepTruck` the cab does, so a text driver in the wrong gear is
        // lugging for the same reason and at the same cost. Two rungs, one model.
        const up = await run('revs up');
        check('a text driver can shift up', /gear 2/i.test(up?.message || ''), up?.message?.slice(0, 60));
        const down = await run('revs down');
        check('…and down again', /gear 1/i.test(down?.message || ''), down?.message?.slice(0, 60));
        const pick4 = await run('revs 4');
        check('…and straight to a gear by number', /gear 4/i.test(pick4?.message || ''), pick4?.message?.slice(0, 60));
        const neutral = await run('revs neutral');
        check('…and into neutral', /neutral/i.test(neutral?.message || ''), neutral?.message?.slice(0, 60));
        await run('revs 3');
        const jakeOn = await run('jake');
        check('the Jake is a verb here too', /jake/i.test(jakeOn?.message || '') || /bark/i.test(jakeOn?.message || ''), jakeOn?.message?.slice(0, 50));
        for (const v of ['boot', 'cruise', 'coast', 'brake']) {
          const r = await run(v);
          check(`\`${v}\` is a real control on the text rung`, r?.type === 'emote' && /mph/.test(r?.message || ''), r?.message?.slice(0, 50));
        }
        // The readout must carry what the CAB shows, or the rung is not finished — the visual
        // driver hears the band and sees a needle, and this is the only place a text driver can
        // learn the same thing.
        const state = await run('cruise');
        check('the text readout names the gear, the band and the speed',
          /gear \d|neutral|STALLED/.test(state?.message || '') && /(pulling|lugging|screaming)/.test(state?.message || ''),
          state?.message?.slice(0, 80));


        await run('park');
        check('…and can stop', !rigs.has(player.id) && !isTextDriving(player.id));
      } finally { if (savedRung) await setDisplayRung(player, savedRung); }
    } finally {
      // ⚠ THE BOXES GO WITH THE TRUCKS. This block hitches a trailer and loads it on foot, and
      // deleting the tractor out from under it leaves exactly the orphan `yardSell` was just fixed
      // to stop creating: `towed_by` pointing at a truck row that no longer exists, `parked_zone`
      // null, and nothing in the game able to reach it again. Harmless in a scratch DB and residue
      // in a dev one — a `test_regress_*` box was found standing on a ghost in the local database.
      await query('DELETE FROM trailers WHERE owner_id = $1', [player.id]).catch(() => {});
      await query('DELETE FROM trucks WHERE owner_id = $1', [player.id]).catch(() => {});
      for (const [z, f] of realDepots) z.flags.truck_depot = f;
      rigs.delete(player.id);
      delete player._crossing;
      voidTest.setEncounters(true);
      voidTest.setWindow(null);
      for (const [id, z] of prev) { if (z) world.zones.set(id, z); else world.zones.delete(id); }
      voidTest.invalidateRimIndex();
      removePlayerFromZone(player.id, player.current_zone);
      player.current_zone = savedZone; addPlayerToZone(player.id, savedZone);
      setLivePlayer(player.id, player);
    }
  }

  // ── RECONNECT: A LIVE RIG MUST ALWAYS RE-PUSH THE CAB ─────────────────────
  //
  // The failure this pins is invisible from the server's side and total from the player's: the rig
  // is in `rigs`, the posture is `driving`, every movement verb correctly refuses with "you'd have
  // to park and climb down first" — and there is no truck on the screen. A page reload gets a
  // FRESH SOCKET WITH NO CAB PANEL ON IT, and `restoreDrivingState` used to return early on
  // exactly that state (`rigs.has(id)`), on the reasonable-sounding grounds that somebody already
  // mounted needs no restoring. `rigs` is server memory; the cab is a client panel; a reload
  // separates them. A live rig is not a reason to do nothing — it is the case the push exists for.
  {
    const pushes = [];
    const savedBc2 = getBroadcast();
    const savedRig = rigs.get(player.id);
    const savedPosture = player.posture;
    try {
      setBroadcast((_z, message, _ex, targetId) => { if (targetId === player.id) pushes.push(message); });
      rigs.set(player.id, {
        truckId: 't_regress_resume', leg: 'city', x: 10, y: 10, heading: 180,
        fuel: 1, speed: 0, s: 0, t: 0, node: 0, chain: [], zoneId: player.current_zone,
        route: null, dmg: null, condition: 1, cd: {}, params: TYPES.hauler, type: TYPES.hauler,
        typeId: 'hauler', cargo: null, trailer: null,
      });
      const out = await restoreDrivingState(player, { mountOnCrossing: () => null });
      setBroadcast(savedBc2);
      check('reconnect: a live rig re-pushes the cab instead of returning early', out === true, String(out));
      check('…and what reaches the client is the cab itself',
        pushes.some((m) => m?.type === 'truck_sim'),
        pushes.map((m) => m?.type).join(', ') || 'nothing pushed');
      check('…and the posture rides the same reconnect', player.posture === 'driving', String(player.posture));
    } finally {
      setBroadcast(savedBc2);
      if (savedRig) rigs.set(player.id, savedRig); else rigs.delete(player.id);
      player.posture = savedPosture;
    }
  }

  // ── SCRATCH, FAULT, FAILURE ───────────────────────────────────────────────
  // The severity split is what decides whether a repair is a bill or an errand, so the three
  // things that must stay true are: a scratch is mechanically nothing, a failure needs the real
  // part, and the engine is the one you cannot carry.
  {
    const { severityOf, isBroken, isCosmetic, partEffects, PART_ITEMS, PART_SHARE, COSMETIC_AT, BROKEN_AT }
      = await import('./damage.js');
    check('the top of the bar is cosmetic', severityOf(0.95) === 'scratch', severityOf(0.95));
    check('the middle is a fault you can pay to fix', severityOf(0.5) === 'fault', severityOf(0.5));
    check('the bottom has failed', isBroken(0.05) && severityOf(0.05) === 'broken', severityOf(0.05));
    // The load-bearing one: cosmetic damage must not quietly cost you performance, or "you can
    // live with it" is a lie and every scratch is a stealth nerf.
    const clean = partEffects({ engine: 1, wheels: 1 });
    const scuffed = partEffects({ engine: COSMETIC_AT + 0.01, wheels: COSMETIC_AT + 0.01 });
    check('…and a scratched truck still pulls and stops like a clean one',
      scuffed.thrustMax > clean.thrustMax * 0.93 && scuffed.brake > clean.brake * 0.93,
      `${scuffed.thrustMax.toFixed(2)} vs ${clean.thrustMax.toFixed(2)}`);
    check('an engine cannot be carried, and the other two can',
      PART_ITEMS.engine.carry === false && PART_ITEMS.wheels.carry && PART_ITEMS.body.carry,
      JSON.stringify(Object.fromEntries(Object.entries(PART_ITEMS).map(([k, v]) => [k, v.carry]))));
    // Three targeted repairs must come to one whole one, or there is arbitrage in one direction.
    const sum = PARTS.reduce((n, p) => n + PART_SHARE[p], 0);
    check('the part shares sum to one whole truck', Math.abs(sum - 1) < 1e-9, sum.toFixed(4));
    check('an engine is the dearest of the three', PART_SHARE.engine > PART_SHARE.wheels && PART_SHARE.wheels > PART_SHARE.body,
      JSON.stringify(PART_SHARE));
    // Cosmetic damage has to show up SOMEWHERE or it does not exist. Resale is that somewhere.
    const { resaleValue } = await import('./fleet.js');
    const t = TYPES.drayman;
    check('…so scratched panels are worth less at the gate',
      resaleValue(t, 0, 1, { body: 0.5 }) < resaleValue(t, 0, 1, { body: 1 }),
      `${resaleValue(t, 0, 1, { body: 0.5 })} vs ${resaleValue(t, 0, 1, { body: 1 })}`);
    check('…and a truck with no damage bag prices exactly as it always did',
      resaleValue(t, 0, 1) === resaleValue(t, 0, 1, { body: 1 }),
      `${resaleValue(t, 0, 1)} vs ${resaleValue(t, 0, 1, { body: 1 })}`);
  }

  // ── A TRAILER IS SOMEWHERE, AND YOU HAVE TO BACK UNDER IT ─────────────────
  // The pose turned hitching from a menu choice into a manoeuvre, and the three tests are the
  // three ways a driver can get it wrong. The one that matters most is the LAST one: a trailer
  // with no pose (yard stock, or any row written before this existed) must still be hitchable, or
  // the feature silently strands every box already in the world.
  {
    const { hitchReach, posed, HITCH_ALONG, HITCH_ACROSS, HITCH_DEG } = await import('./trailers.js');
    const box = { id: 't1', name: 'a dry box', x: 10, y: 10, heading: 90, ratedKg: 3600 };
    const at = (x, y, heading, speed = 0) => ({ x, y, heading, speed });

    check('square, close and stopped couples', hitchReach(at(10, 10, 90), box).ok, 'refused');
    check('…a truck length away does not', !hitchReach(at(11.5, 10, 90), box).ok, 'coupled from a distance');
    check('…nor does driving at it sideways',
      !hitchReach(at(10, 10, 90 + HITCH_DEG + 15), box).ok, 'coupled across the box');
    check('…nor does hitting it at speed', !hitchReach(at(10, 10, 90, 40), box).ok, 'coupled at 40mph');
    check('a hair inside the reach still couples',
      hitchReach(at(10 + HITCH_ALONG * 0.9, 10, 90), box).ok, 'refused inside its own tolerance');

    // ⚠ THE FLANK. The whole reason the tolerance is a lane and not a disc: this truck is CLOSER to
    // the pose than the one on the last line, is pointing the same way as the box, and must still be
    // refused — it is beside the trailer, which is the one place a fifth wheel can never be under a
    // pin. A round tolerance says yes to it, and that is what this case exists to catch.
    const flank = hitchReach(at(10, 10 + HITCH_ACROSS * 2, 90), box);
    check('…but standing alongside it does not, however close', !flank.ok, 'coupled from the flank');
    check('…and it is refused for being off the centreline, not for distance',
      flank.why === 'across', flank.why);
    check('…nor can you couple from behind the pin, inside the box',
      !hitchReach(at(9.4, 10, 90), box).ok, 'coupled from inside the trailer');

    const unplaced = { id: 't2', name: 'yard stock', x: null, y: null, heading: null, ratedKg: 2200 };
    check('a trailer with no pose is not drawable', !posed(unplaced), 'claimed a position it has not got');
    check('…but is still hitchable, so nothing already in the world is stranded',
      hitchReach(at(999, 999, 0), unplaced).ok, 'an existing trailer became unreachable');

    // ── WHERE THE DEALER STANDS ITS STOCK ────────────────────────────────────
    // Three rules. A box has to STAY on the tile it is parked in, or `hitch` — which only searches the
    // depot's own zones — refuses a trailer the driver is sitting under. It has to land in the bays
    // the shed PAINTS, because stock parked anywhere else makes a liar of its own floor. And no two
    // may land on the same spot, or a second purchase is invisible inside the first and both answer
    // to one pin.
    const bays = stockSlots(40, 70, 180, true);
    check('stock stands inside the tile it is parked in',
      bays.every(p => Math.abs(p.x - 40) <= 0.5 && Math.abs(p.y - 70) <= 0.5),
      bays.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' '));
    // ⚠ THE SAME SIDE OF THE LANE, fore and aft of each other. The painted bays are all on ONE side;
    // alternating would park every other box in the numbered tractor stalls opposite — and across
    // the way out. This is the assertion that used to say the opposite, and it was wrong.
    check('…on the one side the bays are painted on, one behind the other',
      bays.length === 2 && bays[0].x === bays[1].x && bays[0].y !== bays[1].y,
      bays.map(p => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' '));
    // ⚠ AND IT FACES ACROSS THE LANE, NOT ALONG IT. A box lying lengthways down a bay has its pin at
    // one end of a forty-foot object with a wall behind it, and there is nowhere for a tractor to be
    // when its fifth wheel is under that pin. Turned a quarter it is backed into the bay with its
    // nose out over the lane, which is the manoeuvre the lane exists for. This assertion used to
    // demand the opposite.
    check('…turned across the lane, so the pin faces the middle of the room',
      bays.every(p => p.heading === 90), bays[0].heading);
    check('…and that quarter-turn follows the door, whichever way the shed faces',
      stockSlots(0, 0, 270, true)[0].heading === 180 && stockSlots(0, 0, 0, true)[0].heading === 270,
      `${stockSlots(0, 0, 270, true)[0].heading} ${stockSlots(0, 0, 0, true)[0].heading}`);
    // ⚠ AND THE ALLOCATOR FINDS A FREE ONE RATHER THAN COUNTING. Placing at `length` is right
    // exactly once: sell a box and the next purchase is stood at that index again, inside the one
    // that is already there. Fill the depot one at a time and no two may come out together.
    const places = [{ zone: { id: 'shed', grid_x: 40, grid_y: 70 }, bays: true },
      { zone: { id: 'apron', grid_x: 40, grid_y: 71 }, bays: false }];
    const taken = [];
    for (let i = 0; i < 5; i++) { const p2 = findStockPose(places, 180, taken); if (p2) taken.push(p2); }
    check('five boxes find five places', taken.length === 5);
    check('…and no two of them are standing inside another',
      taken.every((a, i) => taken.every((b, j) => i === j || Math.hypot(a.x - b.x, a.y - b.y) >= STOCK_GAP)),
      taken.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' '));
    check('…and the first two went under the roof, not out on the apron',
      taken[0].zoneId === 'shed' && taken[1].zoneId === 'shed', `${taken[0].zoneId} ${taken[1].zoneId}`);
    // Selling the first one frees its bay, and the next box takes it back — the whole point of
    // searching rather than counting.
    const reused = findStockPose(places, 180, taken.slice(1));
    check('…and a sold box frees its bay for the next one',
      Math.hypot(reused.x - taken[0].x, reused.y - taken[0].y) < 1e-9,
      `${reused.x},${reused.y} vs ${taken[0].x},${taken[0].y}`);
  }

  // ── A BOX IS ONE COLOUR, AND IT IS THE BOX'S ───────────────────────────────
  // The cheap version of this derives the colour from whoever is TOWING (the tractor already has a
  // `deck` field and the towed mesh already reads it) and it is wrong for the reason a trailer is a row
  // at all: the same box would be two colours in one yard depending on which cab was hooked to it,
  // and would change under you at the moment you dropped it. So it is stamped on the row.
  {
    const me = getPlayer();
    const depotZone = truckTest.allDepots().find(d => truckTest.depotFrom(d.id)?.yard?.grid_x != null);
    const ctx = depotZone ? truckTest.depotFrom(depotZone.id) : null;
    if (ctx?.yard) {
      const painted = await buyTrailer(me.id, 'box', ctx.yard.id, null, '#8E0F18');
      check('a bought box carries the colour it was sprayed', boxColour(painted) === '#8e0f18', boxColour(painted));
      const bare = await buyTrailer(me.id, 'box', ctx.yard.id, null, null);
      // ⚠ EVERY BOX ALREADY IN THE WORLD HAS NO STAMP, and must render as a real colour rather than
      // as a hole — an unpainted box off the line, which is a true thing for a trailer to be.
      check('a box with no stamp is unbranded grey, never undefined', boxColour(bare) === BOX_GREY, boxColour(bare));
      // ⚠ AND THE LIVERY PAINTS THE DECK. The solo mesh is the rig with the tractor spliced off and
      // every face left is stamped `deck`, so a livery that set only `base` would paint nothing.
      const lv = boxLivery(painted);
      check('…and its livery reaches the faces a box is actually made of', lv.deck === '#8e0f18' && lv.base === '#8e0f18', JSON.stringify(lv));
      check('…while the chassis stays hardware-coloured, not washed in the body colour', lv.hw !== '#8e0f18', lv.hw);
      // Repainting is guarded on the OWNER: a box standing in a public yard is somebody's, and a
      // spray gun is not a claim on it.
      check('you can repaint your own box', await paintTrailer(painted.id, me.id, '#123f6b'));
      check('…and not a box that is not yours', !(await paintTrailer(painted.id, 'someone_else', '#000000')));
      check('…and the repaint is what is read back', boxColour(await getTrailer(painted.id)) === '#123f6b');
      await query('DELETE FROM trailers WHERE id = ANY($1)', [[painted.id, bare.id]]).catch(() => {});
    }
  }

  // ── AND YOU CAN GET RID OF ONE ─────────────────────────────────────────────
  // A trailer could be bought and never sold, which made it the one thing in the yard you could
  // spend four figures on by mistake and be stuck with forever — and it is the piece of kit you are
  // most likely to buy wrong, because the whole choice is a capacity number you have not run yet.
  {
    const me = getPlayer();
    const depotZone = truckTest.allDepots().find(d => truckTest.depotFrom(d.id)?.yard?.grid_x != null);
    const ctx = depotZone ? truckTest.depotFrom(depotZone.id) : null;
    if (ctx?.yard) {
      const box = await buyTrailer(me.id, 'reefer', ctx.yard.id, null, null);
      const worth = trailerResale(box);
      // Priced off the LIST and the condition, exactly as a tractor is — and never zero, because a
      // box in poor order is still a box.
      check('a used box is worth something, and less than it cost',
        worth > 0 && worth < TRAILER_TYPES.find(t => t.id === 'reefer').price, String(worth));
      check('…and a wrecked one is still worth taking away',
        trailerResale({ ...box, condition: 0 }) > 0 && trailerResale({ ...box, condition: 0 }) < worth);
      // ⚠ GUARDED ON THE OWNER AND ON BEING PARKED. Selling a box off somebody else's fifth wheel
      // is the race hitchTrailer already refuses, stated from the other side.
      check('a box that is not yours cannot be sold', !(await sellTrailer(box.id, 'someone_else')));
      check('you can sell your own', await sellTrailer(box.id, me.id));
      // ⚠ AND A BOX ON THE PIN IS STILL IN THE YARD. `sellTrailer` refuses a towed row on purpose —
      // it is the race `hitchTrailer` refuses from the other side — so the VERB drops it first and
      // then sells the parked row. This asserts the guard is still there, since the verb leaning on
      // it is what makes the two-step safe.
      const hooked = await buyTrailer(me.id, 'box', ctx.yard.id, null, null);
      await hitchTrailer(hooked.id, 'truck_probe', ctx.yard.id);
      check('a box on a fifth wheel cannot be sold out from under it', !(await sellTrailer(hooked.id, me.id)));
      await dropTrailer(hooked.id, ctx.yard.id, null);
      check('…and can be, the moment it is dropped', await sellTrailer(hooked.id, me.id));
      check('…and it is gone', !(await getTrailer(box.id)));
    }
  }

  // ── A DEPOT MUST NOT CONTAIN A TRAILER THAT IS NOWHERE ─────────────────────
  // The other half of the pose rule, and the one that had to be added afterwards: the dealer stands
  // what it SELLS on the hardstand, and everything already in the world stayed exactly where it was.
  // A box parked in the bay with no pose is on the fleet list, in the depot panel, in the `hitch`
  // search and on the cab's air knob, and on no picture anywhere — you are told you own a reefer,
  // told it is here, offered a button that couples to it, and there is nothing in the yard to walk
  // round. Worse, the row that gets into that state is parked in the BAY, which is a building
  // interior at grid 0,0 — so there is no coordinate to draw it at even in principle.
  //
  // These drive the real converge (`standStock`) against a real depot rather than asserting on the
  // geometry, because the failure was never the geometry — it was that nothing ever ran.
  {
    const me = getPlayer();
    const depotZone = truckTest.allDepots().find(d => truckTest.depotFrom(d.id)?.yard?.grid_x != null);
    const ctx = depotZone ? truckTest.depotFrom(depotZone.id) : null;
    check('there is a depot with a drivable yard to stand a box in', !!ctx?.yard, depotZone?.id || 'no depot');
    if (ctx?.yard) {
      // The legacy shape, made deliberately: parked in the room behind the door, with no place.
      const lost = await buyTrailer(me.id, 'reefer', ctx.bay.id, null);
      check('the case exists: a box in the bay with no pose at all', !!lost && !posed(lost));
      const moved = await standStock(ctx.bay, [{ zone: ctx.yard, bays: false }], 180);
      const out = await getTrailer(lost.id);
      check('the yard walks a homeless box out onto the hardstand', moved >= 1 && posed(out),
        out ? `${out.x},${out.y}` : 'gone');
      check('…and stands it in the YARD, not in the room that has no coordinates',
        out?.parkedZone === ctx.yard.id, out?.parkedZone);
      check('…on the tile itself, or hitch could never reach it',
        Math.abs(out.x - ctx.yard.grid_x) <= 0.5 && Math.abs(out.y - ctx.yard.grid_y) <= 0.5,
        `${out.x},${out.y} vs ${ctx.yard.grid_x},${ctx.yard.grid_y}`);
      // ⚠ AND IT IS A NO-OP THE SECOND TIME. This runs on every yard open and every mount, so a
      // version that rewrote a pose each pass would be a write on a read path — and worse, would
      // pick up a box the driver had deliberately dropped somewhere in the yard and shuffle it.
      check('…and running it again moves nothing', await standStock(ctx.bay, [{ zone: ctx.yard, bays: false }], 180) === 0);
      await query('DELETE FROM trailers WHERE id = $1', [lost.id]).catch(() => {});
    }
  }

  // ── THE CAB IS A BOX, AND HIJACK IS ITS ONLY DOOR ─────────────────────────
  //
  // Three things, and they are the three that would each silently break the whole design:
  // the flag the ENGINE reads must go up on mount and down on dismount (a stale one leaves a
  // player permanently unattackable, and nothing downstream would ever say so); a MOVING truck
  // must be unreachable (driving on is the answer to every threat in this file, and it stops
  // being one the moment a roll can land on a rolling rig); and a drag-out must actually end the
  // protection rather than merely narrating that it did.
  {
    const savedRig = rigs.get(player.id);
    const savedInCab = player._inCab;
    try {
      const { mountRig, dismountRig } = await import('./state.js');
      const { cabIsOpenTo, dragOut, STOPPED_MPH, _setOdds } = await import('./hijack.js');

      mountRig(player, { x: 5, y: 5 });
      check('mounting a rig raises the flag combat reads', player._inCab === true, String(player._inCab));
      const rig = rigs.get(player.id);

      rig.speed = 0;
      check('a stopped cab is reachable', !!cabIsOpenTo(player), 'null');
      rig.speed = STOPPED_MPH + 20;
      check('…and a rolling one is not, at any odds', cabIsOpenTo(player) === null, 'reachable while moving');

      rig.speed = 0;
      const savedBc3 = getBroadcast();
      setBroadcast(() => {});
      const out = dragOut(player, null, { attackerName: 'a test' });
      setBroadcast(savedBc3);
      check('a drag-out takes the driver out of the rig', out === true && !rigOf(player), String(out));
      check('…and clears the flag, so the fight can actually happen', !player._inCab, String(player._inCab));
      _setOdds({ breakChance: 0.16, attemptMs: 4200 });   // leave the live odds where the file set them
    } finally {
      if (savedRig) rigs.set(player.id, savedRig); else rigs.delete(player.id);
      player._inCab = savedInCab;
    }
  }

  // ── THE CB ─────────────────────────────────────────────────────────────────
  // Three things have to hold, and all three are about the PARSE rather than the delivery: the
  // radio's default action is talking (a set whose bare verb changed a setting would be absurd),
  // the four control words are the only exceptions, and a channel is clamped to the band no matter
  // what arrives. The fourth check is the one that would silently rot — every listener must be a
  // rig that is actually on the air, so a set switched off can never be handed a transmission.
  {
    const savedRig = rigs.get(player.id);
    const savedInCab = player._inCab;
    try {
      const { mountRig } = await import('./state.js');
      const { cbTune, cbPower, cbSpeaker, cbStatus, cbTransmit, cbAudience, clampChan, CB_DEFAULT }
        = await import('./cb.js');

      mountRig(player, { x: 5, y: 5 });
      const rig = rigs.get(player.id);

      check('a fresh rig is on the channel everybody else starts on', rig.cbChan === CB_DEFAULT, String(rig.cbChan));
      check('…with the set live and the speaker off', !rig.cbOff && !rig.cbSpeaker, `${rig.cbOff}/${rig.cbSpeaker}`);

      check('the dial clamps below the band', clampChan(0) === 1, String(clampChan(0)));
      check('…and above it', clampChan(999) === 40, String(clampChan(999)));
      check('…and on nonsense falls back to 19', clampChan('banana') === CB_DEFAULT, String(clampChan('banana')));

      cbTune(player, rig, 21);
      check('tuning moves the set', rig.cbChan === 21, String(rig.cbChan));
      check('…and tuning a dead set brings it back up', (cbPower(player, rig, false), cbTune(player, rig, 22), !rig.cbOff), 'still off');

      cbSpeaker(player, rig, true);
      check('the speaker latches on', rig.cbSpeaker === true, String(rig.cbSpeaker));
      cbSpeaker(player, rig);
      check('…and the bare switch toggles it back', rig.cbSpeaker === false, String(rig.cbSpeaker));

      // Nobody else is on the air in a one-player test, so the audience is the honest zero — and
      // that is exactly the case that must not throw, since it is every first drive ever made.
      check('an empty channel counts nobody', cbAudience(rig) === 0, String(cbAudience(rig)));
      // The set itself is never an audience member for its own transmission.
      rig.cbChan = 19;
      check('…and your own set is never in your own audience', cbAudience(rig) === 0, String(cbAudience(rig)));

      // A set that is OFF is not a listener, which is the check that stops the radio quietly
      // becoming a broadcast to everybody who ever mounted a truck.
      rig.cbOff = true;
      check('a set that is off hears nothing', cbAudience(rig) === 0, String(cbAudience(rig)));
      const refused = cbTransmit(player, rig, 'anybody out there');
      check('…and cannot transmit either', refused?.type === 'error', String(refused?.type));
      rig.cbOff = false;

      // The limiter is a real gate, not a decoration: two lines back to back must not both go.
      rig.cbSentAt = 0;
      const first = cbTransmit(player, rig, 'first');
      const second = cbTransmit(player, rig, 'second');
      check('a transmission goes out', first?.type === 'noop', String(first?.type));
      check('…and the mic will not key twice in a second', second?.type === 'error', String(second?.type));

      // HTML in a player's mouth stays in the player's mouth. This is the only place the radio
      // takes arbitrary text and puts it on somebody else's screen.
      rig.cbSentAt = 0;
      const sent = [];
      const savedBc4 = getBroadcast();
      setBroadcast((_zone, m) => { if (m?.type === 'cb_msg') sent.push(m); });
      cbTransmit(player, rig, '<img src=x onerror=alert(1)>');
      setBroadcast(savedBc4);
      check('a transmission cannot carry markup',
        sent.length === 1 && !/<img/.test(sent[0].message) && /&lt;img/.test(sent[0].message),
        JSON.stringify(sent[0]?.message));
      check('…and the sender hears their own set', sent[0]?.self === true, String(sent[0]?.self));

      const status = cbStatus(player, rig);
      check('the status line names the channel it is on', /channel <b>19<\/b>/.test(status.message), status.message);
      check('…and carries the state the cab paints from', status.cb?.chan === 19 && status.cb?.on === true, JSON.stringify(status.cb));
    } finally {
      if (savedRig) rigs.set(player.id, savedRig); else rigs.delete(player.id);
      player._inCab = savedInCab;
    }
  }

  // ── The pump, and the cab handle that meters it ────────────────────────────
  //
  // The value of these cases is that FOUR readers now ask "is there a pump here" — the `fuel`
  // verb, the depot panel, the cab payload and the `truckpump` commit — and they got that way by
  // being collapsed onto one function. A regression here is a handle that lights on a tile the
  // verb then refuses, which is the exact drift the collapse was for.
  {
    check('a fuel yard is a pump', pumpAt({ leg: 'city', zoneId: 'zone_district_923_907' }) === true);
    check('…and an ordinary street is not', pumpAt({ leg: 'city', zoneId: 'zone_district_923_908' }) === false);
    check('…and neither is nothing at all', pumpAt(null) === false && pumpAt({ leg: 'city', zoneId: 'nope' }) === false);

    // THE AFFORDABILITY CLAMP, as arithmetic. A driver with less than a tank's worth takes what
    // they can pay for and no more — the handle clicks off, it does not refuse the transaction —
    // and the cost can never exceed the balance, which is the only invariant that actually matters
    // when a client is reporting the amount.
    // ⚠ THE REAL FUNCTION, not a copy of its arithmetic. `pumpClamp` is what the commit charges
    // with and what the cab's readout is drawn from, so a test that reimplemented the same three
    // Math.min arguments would go on passing after the shipping one changed.
    const broke = pumpClamp(90, 0.2, 1);
    check('a short driver gets what they paid for, not a refusal',
      broke.take > 0 && broke.cost <= 90, JSON.stringify(broke));
    const rich = pumpClamp(99999, 0.5, 1);
    check('…and a full tank is never overcharged',
      Math.abs(rich.take - 0.5) < 1e-9 && rich.cost === Math.round(0.5 * FUEL_FULL), JSON.stringify(rich));
    const greedy = pumpClamp(99999, 0.9, 5);   // a lying client asking for five tanks
    check('…and asking for more than the tank holds buys only the tank',
      Math.abs(greedy.take - 0.1) < 1e-9, JSON.stringify(greedy));
    check('…a broke driver at a pump buys nothing and is charged nothing',
      pumpClamp(0, 0.1, 1).cost === 0, JSON.stringify(pumpClamp(0, 0.1, 1)));
    check('…and a garbage amount from the client cannot go negative',
      pumpClamp(9999, 0.5, -3).take === 0 && pumpClamp(9999, 0.5, NaN).take > 0);
  }

  // ── ON FOOT AT THE PUMP ────────────────────────────────────────────────────
  //
  // `fuel` used to mean "the cab I am sitting in" and nothing else, so a driver who parked under
  // the canopy and got out was answered "You are not driving anything" by the one verb the pump's
  // own examine line offers them (plugins/fuelstation renders that link). `rig fuel` is not the way
  // out: it is the depot bench and refuses anywhere there is no depot, which is every forecourt.
  //
  // The case walks the actual state a parked driver is in — a real `trucks` row whose `depot_zone`
  // is the forecourt, which is exactly what `persistTruck` writes on `park` — and drives the real
  // verb. It asserts the money as well as the fuel, because a fill that does not bill is the more
  // expensive half of getting this wrong.
  {
    const savedZone = player.current_zone, savedCredits = player.credits || 0;
    const FORECOURT = 'zone_district_923_907';
    const STREET = 'zone_district_923_908';
    const tid = 'truck_regress_pump';
    try {
      await query('DELETE FROM trucks WHERE id=$1', [tid]).catch(() => {});
      await query('INSERT INTO trucks (id, type_id, name, owner_id, depot_zone, fuel) VALUES ($1,$2,$3,$4,$5,$6)',
        [tid, TRUCK_TYPES[0].id, 'Regress', player.id, FORECOURT, 0.25]).catch(() => {});

      removePlayerFromZone(player.id, savedZone);
      player.current_zone = FORECOURT; addPlayerToZone(player.id, FORECOURT);
      setLivePlayer(player.id, player);
      player.credits = 100000;

      const filled = await run('fuel');
      const { rows: after } = await query('SELECT fuel FROM trucks WHERE id=$1', [tid]);
      check('a parked rig can be fuelled by somebody standing at the pump',
        Number(after[0]?.fuel) > 0.99, `${filled?.message?.slice(0, 60)} → ${after[0]?.fuel}`);
      check('…and it was billed for exactly the three quarters it took',
        player.credits === 100000 - Math.round(0.75 * FUEL_FULL), player.credits);
      const again = await run('fuel');
      check('…and a full tank is refused rather than resold',
        /already full/i.test(again?.message || ''), again?.message?.slice(0, 40));

      // The refusal has to survive OFF the forecourt, or the fix has quietly made `fuel` mean
      // "top up whatever I own, wherever I am standing".
      removePlayerFromZone(player.id, FORECOURT);
      player.current_zone = STREET; addPlayerToZone(player.id, STREET);
      setLivePlayer(player.id, player);
      const nowhere = await run('fuel');
      check('…while a street with no pump on it still says you are not driving anything',
        /not driving anything/i.test(nowhere?.message || ''), nowhere?.message?.slice(0, 50));
    } finally {
      await query('DELETE FROM trucks WHERE id=$1', [tid]).catch(() => {});
      removePlayerFromZone(player.id, player.current_zone);
      player.current_zone = savedZone; addPlayerToZone(player.id, savedZone);
      setLivePlayer(player.id, player);
      player.credits = savedCredits;
    }
  }

  // ── The cab is a heated box, and only while the engine runs ────────────────
  // hvac.js registers the rig set as a cabin provider; the engine owns the thermometer. This
  // drives the real curve rather than a copy of it, so a retune of either constant is visible
  // here. Note it never touches the shared fake player — mounting for real would set
  // `player._inCab`, and a leaked one makes a player permanently unattackable somewhere
  // that looks nothing like trucking.
  {
    const { cabinTemperature, stepCabinTemps, getZoneTemperature } =
      await import('../../server/engine/environment.js');
    const pid = 'trucking_regress_hvac_driver';
    const zoneId = 'trucking_regress_hvac_zone';
    rigs.set(pid, { playerId: pid, engineOn: true, zoneId });
    try {
      for (let i = 0; i < 20; i++) stepCabinTemps();
      check('a running cab is held at the 20C setpoint',
        cabinTemperature(pid) === 20, String(cabinTemperature(pid)));

      rigs.get(pid).engineOn = false;
      for (let i = 0; i < 200; i++) stepCabinTemps();
      const cold = cabinTemperature(pid), out = getZoneTemperature(zoneId);
      check('killing the engine bleeds the cab back to the weather',
        Math.abs(cold - out) < 0.5, `${cold} vs ${out} outside`);
    } finally {
      rigs.delete(pid);
      stepCabinTemps();
    }
    check('climbing down leaves no cabin behind', cabinTemperature(pid) === null);
  }

  // ── CAB TRIM: THE BENCH SELLS SURFACE, NEVER INSTRUMENTS ────────────────────
  // The whole rule of `rig trim` in one place. The vocabulary is shared with the renderer
  // (client/shared/cab-trim.js) precisely so a trim a player pays for is always one the cab can
  // draw; these assert the two halves of that — nothing unknown gets stored, and nothing stored can
  // reach the fleet ladder.
  {
    const stock = stockTrim(0);
    check('a stock trim is the tier it came from', stock.col === 'oxide' && stock.mat === 'steel');

    // Every buyable key must exist on BOTH sides. If a colourway is ever added to the bench without
    // a colour set, the swatch sells a trim that renders as the fallback and nobody finds out.
    check('every material the bench sells has a surface to draw',
      Object.keys(DASH_MATERIALS).every(k => isDashMaterial(k) && DASH_MATERIALS[k].gloss > 0));
    check('every colourway the bench sells has a full colour set',
      Object.keys(DASH_COLOURWAYS).every(k => {
        const c = DASH_COLOURWAYS[k];
        return c && Array.isArray(c.dash) && c.dash.length === 3 && Array.isArray(c.face) && c.needle && c.glow;
      }));
    // …and every STOCK trim has to name keys that exist, or a truck nobody retrimmed renders wrong.
    check('every stock interior names a real material and colourway',
      [0, 1, 2, 3].every(t => isDashMaterial(stockTrim(t).mat) && isDashColourway(stockTrim(t).col)));

    // ⚠ SURFACE ONLY. A payload carrying instrument keys must not be able to fit a rev counter.
    // Three keys now, not two — `cust` carries the player's own three picks — and the assertion is
    // still the same one: whatever arrives, what comes out is EXACTLY this set and never a ladder key.
    const dirty = sanitizeTrim({ mat: 'wood', col: 'walnut', dials: 2, band: true, lamps: 5 }, {});
    check('a trim is a fixed set of keys and cannot smuggle instruments',
      Object.keys(dirty).sort().join(',') === 'col,cust,mat');

    // An unrecognised argument falls back to what the truck ALREADY had, never to a default —
    // a typo must not silently repaint a cab the driver was happy with.
    const kept = sanitizeTrim({ mat: 'marble', col: 'chartreuse' }, { mat: 'vinyl', col: 'moss' });
    check('an unknown swatch keeps the fitted one', kept.mat === 'vinyl' && kept.col === 'moss');
    check('an unknown swatch on a stock truck stays null',
      sanitizeTrim({ mat: 'marble' }, {}).mat === null);

    // The price is a real number on every rung, including a truck with no price at all.
    check('a retrim is priced on every rung and never free',
      [{ price: 1300 }, { price: 31000 }, {}].every(t => trimCost(t) >= 240));

    // ── …AND ONE THE PLAYER MIXED ────────────────────────────────────────────
    // A mixed interior is not a fourth thing the renderer has to know about: it is a COLOURWAY,
    // derived from three picks, and the contract is that nothing downstream can tell it from a
    // bought one. That is what these assert — the shape first, then the two ways it must refuse.
    const MIX = { panel: '#4a1f2e', needle: '#ffd489', glow: '#c07a34' };
    const mixed = customColourway(MIX);
    check('a mixed colourway is the same shape as a bought one',
      Object.keys(DASH_COLOURWAYS.slate).every(k => k === 'stock' || k === 'crazed' || mixed[k] !== undefined));
    check('…with a full colour set, exactly as the catalogue check demands of the bought ones',
      Array.isArray(mixed.dash) && mixed.dash.length === 3 && Array.isArray(mixed.face) && mixed.face.length === 2
      && !!mixed.needle && !!mixed.glow && !!mixed.ring && !!mixed.lip);
    // ⚠ THE PANEL IS THE PICK, NOT A SHADE OF IT. Everything else is derived DOWN from it, so if
    // this ever stops being an identity the well and the dashboard are two different colours.
    check('the panel colour is the panel colour', mixed.dash[0] === MIX.panel && mixed.needle === MIX.needle && mixed.glow === MIX.glow);
    const lum = (h) => parseInt(String(h).slice(1), 16);
    check('…and the derived slab only ever gets darker', lum(mixed.dash[1]) < lum(mixed.dash[0]) && lum(mixed.dash[2]) < lum(mixed.dash[1]));
    // The two refusals. A colour that is not a colour, and a mix with a hole in it — either would
    // reach the renderer as an undefined in a gradient string, which draws a cab with holes in it.
    check('a mix wants real colours', !isTrimHex('teal') && !isTrimHex('#fff') && isTrimHex('#4A1F2E'));
    check('a partial mix is not a mix', sanitizeCustomTrim({ panel: '#4a1f2e' }, {}) === null && customColourway({ panel: '#4a1f2e' }) === null);
    check('…but it completes itself from the one already stored',
      sanitizeCustomTrim({ needle: '#8fe0a0' }, MIX)?.panel === MIX.panel);
    // ⚠ 'custom' IS NOT A CATALOGUE KEY AND MUST NEVER LOOK LIKE ONE. It is only a colourway while
    // there are three picks behind it; a row that says custom with nothing to mix from has to fall
    // back to what the cab was wearing, or it renders as slate on a truck nobody repainted.
    check('custom is not in the swatch book', !isDashColourway(CUSTOM_COL));
    check('a mix survives a round trip', sanitizeTrim({ col: CUSTOM_COL, cust: MIX }, {}).col === CUSTOM_COL);
    check('custom with nothing behind it keeps the fitted colourway',
      sanitizeTrim({ col: CUSTOM_COL }, { col: 'moss', mat: 'vinyl' }).col === 'moss');
    // The mix is KEPT while a swatch is worn, so trying oxblood does not throw away the colour you
    // spent five minutes on — that is the whole reason `rig trim custom` has a way back.
    check('picking a swatch does not delete your mix',
      sanitizeTrim({ col: 'moss' }, { col: CUSTOM_COL, cust: MIX }).cust?.panel === MIX.panel);
  }
  // ── THE BOOTH ──────────────────────────────────────────────────────────────
  // Paint went from two colours and four flashes to four colours, fifteen paint jobs, eight finish
  // coats and eleven door pictures. Almost none of that needs a test — a swatch either looks right
  // or it does not, and no assertion here can tell. What DOES need one is the seam every widening
  // like this breaks: the trucks that were painted before it.
  {
    const legacy = { base: '#112233', trim: '#445566', flash: 'wave', chrome: 0 };
    const read = sanitizePaint({}, legacy);
    // ⚠ THE MIGRATION INVARIANT. Every truck in the database carries the OLD four keys and nothing
    // else, and it is read back through here rather than rewritten (see the ⚠ in the bench payload).
    // So reading a legacy paint must preserve every field it had and fill the rest from the
    // defaults — anything else is a fleet that changes colour on the day this ships.
    check('a truck painted before the model widened keeps its own colours',
      read.base === legacy.base && read.trim === legacy.trim && read.flash === 'wave' && read.chrome === 0);
    check('…and gains the new fields at their defaults rather than undefined',
      read.hw === PAINT_DEFAULT.hw && read.deck === PAINT_DEFAULT.deck
      && read.bright === PAINT_DEFAULT.bright && read.glow === PAINT_DEFAULT.glow && read.glass === PAINT_DEFAULT.glass
      && read.finish === PAINT_DEFAULT.finish && read.art === PAINT_DEFAULT.art);
    // ⚠ AND THOSE DEFAULTS ARE THE MESH'S OWN HARDCODED ARRAYS, TO THE BYTE. The brightwork, the
    // beltline strip and the door glass were literals in buildTruck that no paint job could reach;
    // making them buyable is only invisible to an existing truck if the default IS the literal.
    // Get one of these wrong and every rig in the game changes colour on deploy day.
    check('the new colours default to exactly what the mesh already drew',
      PAINT_DEFAULT.bright === '#e2e8f0' && PAINT_DEFAULT.glow === '#60c4d6' && PAINT_DEFAULT.glass === '#324a5c');
    // …and reading it TWICE is the same answer, which is what makes the panel's "nothing changed"
    // test honest: it compares the edited paint against this exact normalisation.
    check('normalising a paint is idempotent', JSON.stringify(sanitizePaint({}, read)) === JSON.stringify(read));
  }
  {
    // A typo must not silently respray a truck the driver was happy with — the same rule the cab
    // trim already holds itself to, and the reason every field falls back through `prev`.
    const prev = sanitizePaint({ base: '#8e0f18', flash: 'scallop', finish: 'candy', art: 'wolf' }, {});
    const junk = sanitizePaint({ base: 'crimson', flash: 'stripes', finish: 'chrome', art: 'sharkmouth' }, prev);
    check('an unknown colour keeps the fitted one', junk.base === '#8e0f18');
    // ⚠ `stripes` IS A REAL PATTERN — the AIRFRAME one. The two vocabularies share words (the fleet
    // has `stripe`, the airframes have `stripes`; `candy` is both a paint job and a finish coat),
    // which is exactly why the verb's grammar is named rather than inferred from the catalogues.
    check('an airframe pattern is not a truck paint job', junk.flash === 'scallop');
    check('a finish that is not a finish keeps the coat', junk.finish === 'candy');
    check('nose art is not door art', junk.art === 'wolf');
  }
  {
    // Every scheme on the panel has to expand into a paint that survives sanitising unchanged.
    // A preset with a typo in it is a one-click button that quietly does something else.
    const bad = PAINT_PRESETS.filter(p => {
      const s = presetPaint(p.id, {});
      return !s || s.flash !== p.flash || s.finish !== p.finish
        || ['base', 'trim', 'hw', 'deck', 'bright', 'glow', 'glass'].some(k => s[k] !== p[k]);
    });
    // ⚠ AND A SCHEME IS THE WHOLE TRUCK. The panel sells these as "one click, whole truck"; a
    // preset that names six of the seven colours leaves the seventh at whatever the rig was wearing
    // and the click quietly does not do what the button says. Checked as a missing FIELD rather
    // than through sanitizePaint, which would fill it from the defaults and hide exactly this.
    const partial = PAINT_PRESETS.filter(p => ['base', 'trim', 'hw', 'deck', 'bright', 'glow', 'glass'].some(k => !p[k]));
    check('every scheme names every colour on the truck', partial.length === 0, partial.map(p => p.id).join(','));
    check('every one-click scheme is a paint the booth accepts', bad.length === 0, bad.map(p => p.id).join(','));
    check('an unknown scheme is refused rather than guessed', presetPaint('sunburst', {}) === null);
  }
  {
    // The finish is the only thing that moves the fee, and the panel re-quotes locally off the
    // gloss price × a multiplier the server sends. If the two ever disagree the booth is showing a
    // number the till has never heard of, so the arithmetic is asserted rather than trusted.
    const type = { price: 31000 };
    const gloss = paintCost(type, { finish: 'gloss' });
    check('flake and candy cost more than gloss, primer costs less',
      paintCost(type, { finish: 'metallic' }) > gloss && paintCost(type, { finish: 'candy' }) > gloss
      && paintCost(type, { finish: 'primer' }) < gloss);
    check('a respray is priced on every rung and never free',
      FINISHES.every(f => paintCost({}, f) >= 60) && FINISHES.every(f => paintCost(type, f) >= 60));
  }
  {
    // ── AND THE RENDERER AGREES ABOUT THE VOCABULARY ─────────────────────────
    // The catalogue is the server's and the pictures are the client's, and nothing joins them but
    // a string. A paint job the mesh has never heard of paints the truck one flat colour and a
    // door picture with no texture behind it paints nothing at all — both are silent, both look
    // like "that swatch does not do much", and neither would ever be filed as a bug.
    const face = { role: 'body', p: [[0.1, 0.15, 0.14], [0.2, 0.15, 0.14], [0.2, 0.15, 0.16], [0.1, 0.15, 0.16]] };
    const pal = { base: [10, 20, 30], trim: [200, 200, 200], pat: 'truck:none' };
    const inert = FLASHES.filter(f => {
      // A paint job DOES something when at least one facet somewhere on the flank comes out trim.
      for (let i = 0; i < 40; i++) for (let j = 0; j < 24; j++) {
        const fx = -0.2 + i * 0.02, hz = j * 0.012;
        const q = { role: 'body', p: [[fx, 0.15, hz], [fx, 0.15, hz]] };
        if (faceBaseRgb(q, { ...pal, pat: `truck:${f.id}` }) === pal.trim) return false;
      }
      return true;
    }).map(f => f.id);
    check('every paint job in the catalogue paints something on the mesh',
      inert.length === 1 && inert[0] === 'none', inert.join(','));   // 'none' is a choice, and paints nothing on purpose
    // The hardware and the box are two keys the airframes must never grow. An aeroplane has carried
    // an `accent` since the jazz scheme, and hanging structural metal off THAT would have turned
    // every undercarriage in the game magenta — see the ⚠ in faceBaseRgb.
    const strut = { role: 'strut', p: [[0, 0, 0]] };
    check('an airframe strut is untouched by the truck colours',
      faceBaseRgb(strut, { base: [1, 2, 3], trim: [4, 5, 6], accent: [194, 43, 140], pat: 'jazz' }).join(',') === '44,48,54');
    // ── THE PARTS THAT USED TO BE UNPAINTABLE ────────────────────────────────
    // A facet stamped with a paint key takes the palette colour; the same facet on a palette that
    // does not carry one (every aircraft) takes the literal it always had. And `chrome: 0` is the
    // blacked-out rig — brightwork falls back to the HARDWARE colour rather than simply vanishing,
    // which is what a murdered-out truck actually looks like.
    const brightF = { role: 'window', pk: 'bright', tint: [226, 232, 240], p: [[0, 0, 0]] };
    const glowF = { role: 'window', pk: 'glow', tint: [96, 196, 214], p: [[0, 0, 0]] };
    check('brightwork wears the colour the booth sold',
      faceBaseRgb(brightF, { bright: [10, 20, 30], hw: [1, 2, 3], pat: 'truck:none' }).join(',') === '10,20,30');
    check('…and blacks out to the hardware when the chrome is off',
      faceBaseRgb(brightF, { bright: [10, 20, 30], hw: [1, 2, 3], chrome: 0, pat: 'truck:none' }).join(',') === '1,2,3');
    check('the running-light strip wears its own colour',
      faceBaseRgb(glowF, { glow: [200, 30, 40], pat: 'truck:none' }).join(',') === '200,30,40');
    check('…and a palette with no truck colours leaves both exactly as the mesh drew them',
      faceBaseRgb(brightF, { base: [1, 2, 3], pat: 'bare' }).join(',') === '226,232,240'
      && faceBaseRgb(glowF, { base: [1, 2, 3], pat: 'bare' }).join(',') === '96,196,214');
    // Glass is SCALED by the chosen tint, so the reference pane reproduces it exactly — which is
    // the identity that makes retinting invisible on a truck nobody has retinted.
    const pane = { role: 'glass', tint: [50, 74, 92], p: [[0, 0, 0]] };
    check('the reference pane is the identity under its own default tint',
      faceBaseRgb(pane, { glass: [50, 74, 92], pat: 'truck:none' }).map(Math.round).join(',') === '50,74,92');
    check('a truck strut wears the hardware colour',
      faceBaseRgb(strut, { base: [1, 2, 3], trim: [4, 5, 6], hw: [35, 38, 43], pat: 'truck:none' }).join(',') === '35,38,43');
    // ⚠ AND A FINISH NOBODY SET CHANGES NOTHING. This runs on every facet of every mesh in the
    // game, aircraft included, so the neutral path has to be exactly the identity — a coat that
    // tinted by a rounding error would repaint the whole fleet the day it shipped.
    const plain = { base: [123, 63, 42], trim: [216, 207, 192], pat: 'truck:none' };
    check('satin and an unset finish are the identity',
      faceBaseRgb(face, plain) === plain.base
      && faceBaseRgb(face, { ...plain, finish: 'satin' }) === plain.base
      && faceBaseRgb(face, { ...plain, finish: 'gloss' }) === plain.base);
    check('a finish coat actually changes the colour',
      ['metallic', 'pearl', 'candy', 'matte', 'weathered', 'primer']
        .every(fin => faceBaseRgb(face, { ...plain, finish: fin }).join(',') !== plain.base.join(',')));
    // …and it is STABLE. A finish that reads a clock or a random would shimmer, which is the thing
    // camoHash exists to prevent and the reason a finish is geometry-driven rather than view-driven.
    check('a finish coat is the same answer twice',
      faceBaseRgb(face, { ...plain, finish: 'metallic' }).join(',') === faceBaseRgb(face, { ...plain, finish: 'metallic' }).join(','));
  }
  {
    // ── WHERE THE DOOR IS ────────────────────────────────────────────────────
    // Door art is placed from `TRUCK_META.door`, which the mesh publishes AFTER it slides itself
    // back to centre on its origin — the same transform that once left the headlamps hanging in the
    // road ahead of the bumper. So the panel has to land on the CAB of all four rigs, and a dropped
    // box (which has no cab at all) has to publish none.
    const off = [];
    for (const id of ['scrapper', 'hauler', 'drayman', 'continental']) {
      aircraftFaces('truck', 1, false, id);
      const d = truckMeta(id + ':1')?.door;
      if (!d) { off.push(`${id}: no door`); continue; }
      // The bounds of the drawn mesh, so this measures the door against the TRUCK rather than
      // against a constant that would have to be kept in step with four vehicles.
      let f0 = Infinity, f1 = -Infinity, z1 = -Infinity;
      for (const fc of aircraftFaces('truck', 1, false, id)) for (const p of fc.p) {
        if (p[0] < f0) f0 = p[0]; if (p[0] > f1) f1 = p[0]; if (p[2] > z1) z1 = p[2];
      }
      if (!(d.f0 > f0 && d.f1 < f1)) off.push(`${id}: door is off the ends of the truck`);
      if (!(d.z0 > 0 && d.z1 < z1)) off.push(`${id}: door is under the road or over the roof`);
      if (!(d.f1 > f0 + (f1 - f0) * 0.55)) off.push(`${id}: door is back on the deck, not on the cab`);
      if (!(d.g > 0)) off.push(`${id}: door has no flank to sit on`);
    }
    check('every rig publishes a door panel, on its own cab', off.length === 0, off.join(' · '));
    aircraftFaces('truck', 1, false, 'hauler~s');
    check('a dropped box publishes no door — it has no cab', !truckMeta('hauler~s:1')?.door);
    // And the box knows it is the box, which is what the fourth colour paints.
    const tractor = aircraftFaces('truck', 1, false, 'hauler').filter(f => f.deck).length;
    const rig = aircraftFaces('truck', 1, false, 'hauler+t').filter(f => f.deck).length;
    check('a bobtail has no trailer faces and a coupled rig does', tractor === 0 && rig > 20, `${tractor}/${rig}`);
  }
}
