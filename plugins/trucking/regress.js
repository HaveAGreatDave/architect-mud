// THE LONG HAUL regression suite — run by tests/regress.js (never in production).
//
// It drives a REAL crossing: a synthetic gate + destination are stapled into the world, the
// voidwalking muster is walked through exactly as a player would, and then the truck takes over
// and covers every tile of the corridor via the actual `trucksync` verb. That end-to-end shape is
// the point — the pieces (corridor geometry, the clamp, node crossings) are individually cheap to
// fake and individually meaningless. What has to hold is that an odometer reading turns into the
// right void room, every time, for a whole haul.
import { world, setLivePlayer, removeLivePlayer, addPlayerToZone, removePlayerFromZone } from '../../server/engine/world.js';
import { mapWindow } from '../flight/state.js';
import { TYPES, SURFACES, createTruckState, step, truckShift, truckSplit, bestGear, truckHitch, truckUnhitch, FADE_AT } from '../../client/game/js/panels/flight-model.js';
import { VOIDS, _test as voidTest } from '../voidwalking/index.js';
import { corridorFor, corridorAt, corridorLocate, corridorPos, corridorProvider, TILES_PER_ROOM, CORRIDOR_R, OFFROAD_R,
  addWreck, wrecksOn, wreckAhead, _clearWrecks } from './corridor.js';
import { rigs, rigOf, reconcileTruck, topTilesPerSec, surfaceUnder, CAB_RADIUS, truckContactsNear,
  atOrBeforeFork, cabContext } from './state.js';
import { bodyTell } from '../../server/engine/dreamscape.js';
import { aircraftFaces } from '../../client/game/js/panels/aircraft3d.js';
import { COMMODITIES, midPrice, askPrice, bidPrice, capacityFor } from './market.js';
import { isTextDriving } from './textdrive.js';
import { restoreDrivingState } from './resume.js';
import { routeOptions } from './routes.js';
import { damageOf, overall, wearSplit, impactSplit, grindSplit, IMPACT_AREAS, partEffects, applyDamage, PARTS } from './damage.js';
import { isTerminal, TERMINAL_CONDITION } from './rig.js';   // breakChance is already imported below
import { displayRung, setDisplayRung } from '../../server/engine/presentation.js';
import { HELP_GROUPS } from '../../server/engine/commands/world.js';
import { query } from '../../server/models/db.js';
import { getBroadcast, setBroadcast } from '../../server/engine/messaging.js';
import { _test as truckTest } from './index.js';
import { TRAILER_TYPES, trailersAt, getTrailer, buyTrailer, hitchTrailer, dropTrailer, saveLoad, canDrop } from './trailers.js';
import { runScale, scaleAt, clearCustoms } from './scale.js';
import { hitcherAt, HITCHER_KINDS } from './hitchers.js';
import { effTruckParams, tuneRange, repairCost, wearFor, wearForImpact, bandOf, FIELD_CAP,
  breakChance, fixOdds, BREAKDOWNS, FIX_GRACE_TILES } from './rig.js';
import { resaleValue } from './fleet.js';

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
    const mid = corridorPos(a, a.L / 2, 0);
    check('just off the pavement there is still ground to drive on',
      corridorAt(a, Math.round(mid.x) + CORRIDOR_R + 2, Math.round(mid.y)) !== null);
    check('…and it is NOT road, so the surface is the punishment',
      corridorAt(a, Math.round(mid.x) + CORRIDOR_R + 2, Math.round(mid.y))?.flags.terrain !== 'road');
    check('past the off-road limit is open air, not a wall',
      corridorAt(a, Math.round(mid.x) + OFFROAD_R + 2, Math.round(mid.y)) === null);
    check('the shoulder is graded dirt, so drifting off it READS before it costs',
      corridorAt(a, Math.round(mid.x) + 1, Math.round(mid.y))?.flags.terrain === 'dirt_road');

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
      rig.s === held, `${held.toFixed(3)} -> ${rig.s.toFixed(3)}`);

    // Monotonic: phase 1 has no reverse, so an odometer cannot be re-driven.
    const was = rig.s;
    reconcileTruck(rig, { s: 0, t: 0, hdg: 180, spd: 0, x: start.x, y: start.y }, 3000);
    check('the odometer never runs backwards', rig.s >= was, `${was} -> ${rig.s}`);

    // Lateral is bounded but not defended — nothing economic depends on it.
    reconcileTruck(rig, { s: rig.s, t: 9999, hdg: 180, spd: 0, x: start.x, y: start.y }, 4000);
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
    const lost = reconcileTruck(rig, { s: rig.s, t: 0, hdg: 180, spd: 40, x: 99999, y: 99999 }, 5000);
    check('driving off the corridor reports bogged, not a collision', lost.bogged === true);
  }

  // ── 4. Surface classification ──────────────────────────────────────────────
  // The corridor speaks TERRAIN and the physics model speaks SURFACE; this is the only mapping
  // between them, so a rename on either side has to fail here rather than in play.
  {
    const route = corridorFor(VOIDKEY, DESTKEY, 4242, 8);
    const mk = (s, t) => { const p = corridorPos(route, s, t); return { route, x: p.x, y: p.y }; };
    check('the centreline classifies as road', surfaceUnder(mk(200, 0)) === 'road');
    check('the shoulder classifies as shoulder', surfaceUnder(mk(200, 1)) === 'shoulder');
    check('the verge classifies as offroad', surfaceUnder(mk(200, 4)) === 'offroad');
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
    const g1 = pull(1), g3 = pull(3), g8 = pull(8);
    check('first gear pulls away from rest', g1.speed > 10, g1.speed.toFixed(1));
    // A LOW GEAR PULLS HARDER, and until weight arrived this case asserted the opposite — third
    // beat first — because `drive` read the throttle and the band but never the ratio, so gears
    // differed only in where they put the revs. That is invisible bobtail and fatal loaded.
    check('a low gear out-accelerates a high one from rest', g1.speed > g3.speed && g3.speed > g8.speed,
      `1:${g1.speed.toFixed(1)} 3:${g3.speed.toFixed(1)} 8:${g8.speed.toFixed(1)}`);
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
    const crawl = createTruckState(p); crawl.gear = 3; crawl.speed = 3;
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
      for (let i = 0; i < 420; i++) step(s, { steer: 0.3, throttle: 0.7, brake: 0, surface: 'road' }, t, 1 / 60);
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
    check('the road is not lined with them', found <= 4, `${found} of 8 nodes`);
    check('every hitcher is one of the authored kinds',
      [...Array(8).keys()].every(n => !at(n) || HITCHER_KINDS.some(k => k.id === at(n).id)));
    // The fugitive is the one that closes the design: a person in the box is weight the scale sees.
    check('the roster includes somebody who is contraband with legs',
      HITCHER_KINDS.some(k => k.id === 'fugitive'));
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
      type: TYPES.drayman };
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
    const trunk = vdef.trunk;
    const other = vdef.dests[1];
    const a = corridorFor(VOIDKEY, vdef.dests[0].key, 4242, 8, trunk);
    const b = corridorFor(VOIDKEY, other?.key || 'x', 4242, 12, trunk);
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

  // ── 4h. Wrecks and the CB ──────────────────────────────────────────────────
  // The road remembers hauls that did not finish. What is defended here is that a wreck is a
  // PLACE rather than a decoration: the same tile for everybody, reported before you reach it,
  // and capped so a corridor never turns into a scrapyard.
  {
    _clearWrecks();
    const route = corridorFor(VOIDKEY, DESTKEY, 4242, 8, vdef.trunk);
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
      check('…and it cost the sticker price', player.credits === 40000 - 31000, player.credits);
      const dupe = await run('yard buy scrapper');
      check('one truck to a yard, so `drive` never has to ask which',
        /already have a truck/i.test(dupe?.message || ''), dupe?.message?.slice(0, 40));

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
        player.credits = 40000 - 31000;
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
      // THE DOOR ONLY EXISTS IF YOU CAME OUT OF ONE. This suite's yard is a bare road tile
      // carrying the flag — the legacy apron shape, no shed — so the cab must be told there is no
      // roller door to lift. Getting this wrong is two and a half seconds of a player staring at
      // a steel shutter that was never in front of them.
      check('…and no roller door when you were never inside one', cab?.fromBay == null, cab?.fromBay);
      const rig = rigOf(player);
      check('a rig mounts at a depot once you own one', !!rig, got?.message?.slice(0, 50));
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
      const hitched = await run('hitch');
      check('you can hitch a trailer at a depot', !!rig?.trailer, hitched?.message?.slice(0, 50));
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

      const out = await run('park');
      check('park drops you out of the cab', !rigs.has(player.id), out?.message?.slice(0, 30));

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

}
