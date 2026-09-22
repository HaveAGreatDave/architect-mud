// THE BASIN — regression suite.
//
// Two halves, and they are tested very differently on purpose. The PHYSICS is a pure module, so it
// is stepped headlessly at 1/60 exactly as the browser steps it and the assertions are about what
// the numbers do. The WRECK ends at `applyStrikeToPlayer`, which is the engine's, so what is
// asserted here is the PLAN and the loop around it rather than a second opinion about how much a
// torso soaks.

import {
  TYPES, WATER, createBoatState, boatReadout, boatSeaPose, step,
} from '../../client/game/js/panels/flight-model.js';
import fs from 'fs';
import { seaAmpsFor, SEA_FULL_KT } from '../../client/shared/sea-swell.js';
import { wreckSeverity, wreckPlan, wreckLines, WRECK } from './breakup.js';
import { boatContactsNear, rigs } from './index.js';

export default async function regress({ run, check, getPlayer }) {
  const p = TYPES.hydro;
  // ⚠ THE SEA COMES FROM THE SEA, NEVER FROM A LITERAL HERE. Both cases below used to hand-set
  // roll 0.32 / wind 0.20 and roll 0.9 / wind 0.7 — the FIXED amplitudes the swell had before
  // JONSWAP made it a function of the wind, and before the trains lengthened to 179 m. A number
  // fitted against another system's output goes stale when that system is retuned and says
  // nothing while it does: the boat simply stopped flying and stopped being able to sink.
  // `glSeaGain` is the renderer's own taste knob and is read out of the source for the same
  // reason `sea.mjs` reads it — restate it and this suite goes on passing while the sea moves
  // out from under the hull exactly as before.
  const gainM = fs.readFileSync('client/game/js/panels/windshield.js', 'utf8').match(/glSeaGain:\s*([\d.]+)/);
  check('the sea gain the boat rides can be read', !!gainM);
  const FULL = seaAmpsFor(SEA_FULL_KT, gainM ? +gainM[1] : 1);

  const drive = (s, inp, secs, dt = 1 / 60) => {
    for (let i = 0; i < Math.round(secs / dt); i++) {
      step(s, { steer: 0, throttle: 0, surface: 'open', ...inp }, p, dt);
    }
    return s;
  };

  // ── 1. THE HULL TYPE EXISTS AND IS A BOAT ─────────────────────────────────
  check('the hydro is a water type', !!p && p.water === true);
  check('the hydro is not a ground type', !p.ground, 'a boat that answers p.ground goes to stepTruck');

  // ── 2. THE VERGE INVARIANT, ON EVERY WATER SURFACE ────────────────────────
  // The truck's rule, quoted: thrustMax x drive > waterFric x drag, with headroom, or a boat that
  // drifts off the racing line is STUCK rather than slow.
  for (const [name, v] of Object.entries(WATER)) {
    const pull = p.thrustMax * v.drive, hold = p.waterFric * v.drag;
    check('water surface ' + name + ' is drivable (' + pull.toFixed(2) + ' > ' + hold.toFixed(2) + ')',
      pull > hold * 1.05);
    const s = drive(createBoatState(p), { throttle: 1, surface: name }, 14);
    check('the hydro gets moving on ' + name, s.speed > 8, name + ' reached only ' + s.speed.toFixed(1));
  }

  // ── 3. GREAT ACCELERATION, AND IT PLANES ──────────────────────────────────
  const quick = drive(createBoatState(p), { throttle: 1 }, 5);
  check('0-5s puts the hydro on the plane', quick.planing && quick.speed > 80,
    '5s reached ' + quick.speed.toFixed(1) + ' planing=' + quick.planing);

  // ⚠ AND IT CAN STILL CREEP. The hump used to be a FLOOR rather than a bump, so below about a
  // third throttle the thrust never exceeded it and the boat did not move at all — a wall wearing a
  // penalty's clothes, arriving through a term the surface invariant above does not cover.
  const creep = drive(createBoatState(p), { throttle: 0.15 }, 20);
  check('a quarter throttle still moves the boat off a dock', creep.speed > 1,
    'idle-ahead reached ' + creep.speed.toFixed(2) + ' mph');
  check('and a quarter throttle does NOT plane', !creep.planing);

  // ── 4. HARD TO TURN, AND IT SLIDES ────────────────────────────────────────
  const fast = drive(createBoatState(p), { throttle: 1 }, 12);
  const h0 = fast.heading;
  drive(fast, { throttle: 1, steer: 1 }, 2);
  const fastYaw = Math.abs(fast.heading - h0);
  const slow = drive(createBoatState(p), { throttle: 0.55 }, 8);
  const h1 = slow.heading;
  drive(slow, { throttle: 0.55, steer: 1 }, 2);
  const slowYaw = Math.abs(slow.heading - h1);
  check('rudder authority falls with speed', slowYaw > fastYaw,
    'slow ' + slowYaw.toFixed(1) + 'deg vs fast ' + fastYaw.toFixed(1) + 'deg');
  check('a hard turn at speed carries the hull sideways', Math.abs(fast.drift) > 0.01 && fast.slip > 0.05,
    'drift ' + fast.drift.toFixed(3) + ' slip ' + fast.slip.toFixed(2));
  // ⚠ AND THE SLIDE IS A RATE. Without its dt the drift accumulates once per FRAME, which is a
  // factor of sixty and makes the handling a function of the frame rate.
  const at = (hz) => {
    const s = createBoatState(p);
    for (let i = 0; i < 10 * hz; i++) step(s, { steer: 1, throttle: 1, surface: 'open' }, p, 1 / hz);
    return s;
  };
  const a60 = at(60), a30 = at(30);
  check('the handling does not depend on the frame rate',
    Math.abs(a60.heading - a30.heading) < 2 && Math.abs(a60.speed - a30.speed) < 3,
    '60hz ' + a60.heading.toFixed(1) + '/' + a60.speed.toFixed(1)
    + ' vs 30hz ' + a30.heading.toFixed(1) + '/' + a30.speed.toFixed(1));

  // ── 5. THE SWELL'S OFF-SWITCH IS PROVABLY THE OLD SEA ─────────────────────
  // Every harness that says nothing about the sea must get flat water: no heave, no attitude, no
  // launches and no damage. That is what makes "the boat rides the swell" a claim with a control.
  const flat = createBoatState(p);
  drive(flat, { throttle: 1 }, 60);
  check('with no swell the ride is dead flat', flat.pitch === 0 && flat.roll === 0 && flat.heave === 0);
  check('with no swell the boat never leaves the water', !flat.airborne && flat.z === 0);
  check('with no swell a minute at full chat costs no hull', flat.hull === 1,
    'hull came back ' + flat.hull.toFixed(3));

  // And with one, it does ride — and the pose is a real attitude rather than a constant.
  const sea = createBoatState(p);
  sea.seaRoll = FULL.roll; sea.seaWind = FULL.wind;   // the top of the scale: a 45-knot gale
  let sawPitch = 0, sawRoll = 0, launches = 0;
  for (let i = 0; i < 60 * 60; i++) {
    step(sea, { throttle: 1, surface: 'open' }, p, 1 / 60);
    sawPitch = Math.max(sawPitch, Math.abs(sea.pitch));
    sawRoll = Math.max(sawRoll, Math.abs(sea.roll));
    for (const e of sea.events) if (e === 'launch') launches++;
  }
  check('in a seaway the hull takes a real attitude', sawPitch > 0.02 && sawRoll > 0.02,
    'pitch ' + sawPitch.toFixed(3) + ' roll ' + sawRoll.toFixed(3));
  check('and a minute at full chat throws it off the crests', launches > 0, 'launches=' + launches);
  check('and costs it some hull', sea.hull < 1 && sea.hull > 0.5,
    'hull ' + sea.hull.toFixed(3));

  // ── 6. LAND IS A LAW ──────────────────────────────────────────────────────
  const beach = drive(createBoatState(p), { throttle: 1 }, 10);
  const wasHull = beach.hull, wasSpeed = beach.speed;
  drive(beach, { throttle: 1, surface: 'land' }, 3);
  check('running it up the beach costs hull', beach.hull < wasHull,
    wasHull.toFixed(2) + ' -> ' + beach.hull.toFixed(2));
  check('and it will not drive on land', beach.speed < wasSpeed * 0.5,
    'still doing ' + beach.speed.toFixed(1) + ' mph aground');
  check('aground is reported', beach.aground === true);

  // ── 7. THE READOUT CONVERTS EXACTLY ONCE ──────────────────────────────────
  // Stored as CONDITION (1 is out of the shop, the trucks convention); reported as hullPct (the
  // aircraft convention). If both conventions ever reach the same surface, one of them is wrong.
  const ro = boatReadout(Object.assign(createBoatState(p), { hull: 0.64 }), p);
  check('condition 0.64 reports as hull 64%', ro.hullPct === 64, 'got ' + ro.hullPct);
  check('a fresh boat reports 100%', boatReadout(createBoatState(p), p).hullPct === 100);

  // ── 8. THE WRECK ──────────────────────────────────────────────────────────
  // ⚠ SEVERITY IS DOMINATED BY SPEED AND IS SQUARED, because energy is. Idling and flat out must
  // not be close together, or the whole point of the hull bar goes.
  const sIdle = wreckSeverity({ speed: 5, topSpeed: 138 });
  const sHalf = wreckSeverity({ speed: 69, topSpeed: 138 });
  const sFull = wreckSeverity({ speed: 138, topSpeed: 138 });
  check('a wreck at idle is mild', sIdle < 0.05, 'idle severity ' + sIdle.toFixed(3));
  check('severity climbs faster than speed does', (sFull - sHalf) > (sHalf - sIdle),
    'idle ' + sIdle.toFixed(2) + ' half ' + sHalf.toFixed(2) + ' full ' + sFull.toFixed(2));
  check('severity is bounded', sFull <= 1 && wreckSeverity({ speed: 999, topSpeed: 138, impact: 9 }) <= 1);

  // The plan: count and size both scale, and both stay inside their authored bounds at every
  // severity and at both ends of the roll.
  let planOk = true, reach = false;
  for (let i = 0; i <= 20; i++) {
    for (const r of [() => 0, () => 0.999]) {
      const pl = wreckPlan(i / 20, r);
      if (pl.hits < WRECK.minHits || pl.hits > WRECK.maxHits) planOk = false;
      if (pl.min > pl.max) planOk = false;
      if (pl.hits === WRECK.maxHits) reach = true;
    }
  }
  check('a wreck plan is always inside its bounds', planOk);
  // ⚠ ROUNDED, NOT FLOORED. Floored, the worst wreck in the game is one nobody ever sees.
  check('the worst wreck is actually reachable', reach);
  const mild = wreckPlan(0, () => 0.5), bad = wreckPlan(1, () => 0.5);
  check('a bad wreck hits harder than a mild one', bad.max > mild.max * 2 && bad.hits >= mild.hits,
    'mild ' + mild.hits + 'x' + mild.max + ' vs bad ' + bad.hits + 'x' + bad.max);
  check('a wreck is blunt and everywhere, not a bullet', bad.damageType === 'explosive');

  // The prose names the parts and never the numbers — the damage event already carries those.
  const lines = wreckLines({
    severity: 0.8,
    hits: [{ part: 'head', partLabel: 'head' }, { part: 'l_arm', partLabel: 'left arm' }],
  }, 'the Rooster');
  check('the wreck says what happened to the boat', /Rooster/.test(lines.hull));
  check('and names the parts that took it', /head/.test(lines.body) && /left arm/.test(lines.body));
  check('and quotes no damage numbers', !/\d/.test(lines.body), lines.body);

  // ── 9. THE HULL CAN REACH ZERO, AND ONLY THE HARD WAY ─────────────────────
  // Both halves matter: a hull that cannot be destroyed makes the whole system decoration, and one
  // that a single ordinary impact destroys makes it a trap.
  const one = drive(createBoatState(p), { throttle: 1 }, 10);
  drive(one, { throttle: 1, surface: 'land' }, 2);
  check('one grounding does not destroy the boat', one.hull > 0.4,
    'a single beaching left ' + one.hull.toFixed(2));
  const doomed = createBoatState(p);
  // ⚠ THREE TIMES THE TOP OF THE SCALE, DELIBERATELY. This claim is about the DAMAGE MODEL —
  // that a hull can be destroyed and only the hard way — so it wants a sea harder than any the
  // weather can make. At the real gale the hydro is down to 0.93 after four minutes and never
  // holes, which is the model working rather than the model being untested.
  doomed.seaRoll = FULL.roll * 3; doomed.seaWind = FULL.wind * 3;
  let holed = false;
  for (let i = 0; i < 60 * 240 && !holed; i++) {
    step(doomed, { throttle: 1, surface: 'chop' }, p, 1 / 60);
    for (const e of doomed.events) if (e === 'holed') holed = true;
  }
  check('a hull driven hard enough in a big sea does break', holed && doomed.hull <= 0,
    'hull ended at ' + doomed.hull.toFixed(3));

  // ── 10. THE POSE IS PURE ──────────────────────────────────────────────────
  const st = createBoatState(p);
  st.seaRoll = 0.3; st.x = 12.5; st.y = -7.25; st.heading = 47;
  const a = boatSeaPose(st, p, 100), b = boatSeaPose(st, p, 100);
  check('the sea pose is a pure function of where and when',
    a.heave === b.heave && a.pitch === b.pitch && a.roll === b.roll);
  const off = boatSeaPose(Object.assign(createBoatState(p), { seaRoll: 0, seaWind: 0 }), p, 100);
  check('and answers dead flat when there is no swell',
    off.heave === 0 && off.pitch === 0 && off.roll === 0);

  // ── 11. THE BOATYARD ──────────────────────────────────────────────────────
  //
  // The yard's own half is tested through its PURE helpers plus a live walk of the world, because
  // the interesting failures here are not arithmetic: they are a flag nothing reads, a berth that
  // counts itself wrong, and a verb that collides with somebody else's.
  const Y = (await import('./yard.js'))._test;

  // The three kinds of place, and the precedence between them. A zone carrying two of these is an
  // authoring mistake rather than a state, so what matters is only that each is recognised.
  check('a pontoon is a berth', Y.berthKind({ flags: { marina_berths: 6 } }) === 'berth');
  check('an apron is hardstanding', Y.berthKind({ flags: { boat_hardstanding: 2 } }) === 'hard');
  check('a shed is covered', Y.berthKind({ flags: { boat_covered: 2 } }) === 'covered');
  check('and ordinary ground is none of them', Y.berthKind({ flags: { terrain: 'road' } }) === null);
  check('a berth of zero is not a berth', Y.berthKind({ flags: { marina_berths: 0 } }) === null);

  // ⚠ CAPACITY READS WHICHEVER FLAG IS THERE. A first cut read `marina_berths` alone, which gave
  // every shed and cradle yard in the world a capacity of 0 — so `berth` refused to move a hull in
  // and reported it as "full", which is a sentence about a room with nothing in it.
  check('a shed reports its own capacity', Y.berthCapacity({ flags: { boat_covered: 2 } }) === 2);
  check('an apron reports its own capacity', Y.berthCapacity({ flags: { boat_hardstanding: 3 } }) === 3);

  // The hull bands, at their boundaries.
  check('a fresh hull is sound', Y.hullBand(1) === 'sound');
  check('and a wrecked one is unsound', Y.hullBand(0.05) === 'unsound');
  check('the bands are ordered', Y.hullBand(0.8) === 'marked' && Y.hullBand(0.5) === 'worked' && Y.hullBand(0.3) === 'tender');

  // ⚠ A REFIT AWAY FROM A SHED MUST NOT REACH SOUND. This is the entire economic argument for the
  // covered bay, and it is one comparison — so it is asserted rather than trusted.
  check('a field patch is capped well short of sound', Y.REFIT_CAP.patch < Y.REFIT_CAP.covered - 0.3);
  check('a cradle sits between the two', Y.REFIT_CAP.hard > Y.REFIT_CAP.patch && Y.REFIT_CAP.hard < Y.REFIT_CAP.covered);
  check('only a shed finishes the job', Y.REFIT_CAP.covered === 1);
  check('and one patch cannot finish a hull on its own', Y.PATCH_GAIN < Y.REFIT_CAP.patch);

  // Naming a boat out of a small fleet.
  const fleet = [
    { id: 'b1', type_id: 'hydro', name: 'Mischief' },
    { id: 'b2', type_id: 'hydro', name: 'Second Wind' },
  ];
  check('one boat needs no name', Y.pickBoat([fleet[0]], '').boat === fleet[0]);
  check('two boats do', !!Y.pickBoat(fleet, '').ambiguous);
  check('a name picks one', Y.pickBoat(fleet, 'mischief').boat === fleet[0]);
  check('a partial name picks one', Y.pickBoat(fleet, 'second').boat === fleet[1]);
  check('a wrong name picks none', !!Y.pickBoat(fleet, 'albatross').miss);
  check('and an empty fleet says so', !!Y.pickBoat([], 'anything').none);

  // ── 12. THE WORLD ACTUALLY CARRIES A MARINA ───────────────────────────────
  //
  // ⚠ THE POINT OF THIS BLOCK IS THAT THE FLAGS REACH THE LOADED WORLD. Every check above passes
  // against object literals and would go on passing if `content/` had never been touched — which is
  // exactly the failure worth catching, because a boatyard whose flags nothing authored is a set of
  // verbs that politely refuse for ever.
  const { getZone } = await import('../../server/engine/world.js');
  // ⚠ THE PONTOONS ARE GONE AND THE FAIRWAY IS OPEN WATER. 894,901 and 894,902 carried
  // `building_type: pontoon` with `marina_berths` 4 and 6 on them — ten of the twelve berths
  // — and they were pulled back to plain Basin water. The arm survives in windshield.js for a
  // tile that wants it later, so what has to be asserted here is the ABSENCE: a berth flag left
  // behind on open water is a mooring the yard offers and the eye cannot find.
  for (const id of ['zone_district_894_901', 'zone_district_894_902']) {
    const w = getZone(id);
    check('the old pontoon at ' + id + ' is open water',
      !!w && w.flags.terrain === 'water' && !w.flags.building_type && !w.flags.pier,
      w ? JSON.stringify(w.flags) : 'no zone');
    check('…and carries no berth', !!w && Y.berthKind(w) === null);
  }
  const hall = getZone('zone_consv_hall');
  check('the covered bay is loaded', !!hall && Y.berthKind(hall) === 'covered');
  check('and it is where hulls are sold', !!hall && hall.flags.boat_dealer === true);
  const hard = getZone('zone_district_892_902');
  check('the hardstanding is loaded', !!hard && Y.berthKind(hard) === 'hard');

  // ⚠ AND THE THREE OF THEM HAVE TO BE ONE YARD ON FOOT, or `berth` refuses to move a hull from the
  // pontoon into the shed and reports it as being "at another yard" — from twenty metres away.
  if (hall) {
    const reach = Y.berthsNear(hall.id).map(z => z.id);
    check('the covered dock can see itself', reach.includes('zone_consv_hall'), reach.join(','));
    check('and the hardstanding', reach.includes('zone_district_892_902'), reach.join(','));
  }

  // ⚠ AND FROM THE SHED TOO, WHICH IS THE DIRECTION THAT BROKE. `berth` measures from where the
  // PLAYER is standing, and the person moving a hull out of the covered dock onto a cradle for the
  // winter is standing in the covered dock. Adding a lobby and a restaurant between the dock and
  // the front door put the cradle yard a sixth step away and `berth` started calling it another
  // yard from inside the same marina.
  if (hall) {
    const fromHall = Y.berthsNear(hall.id).map(z => z.id);
    check('the cradle yard is reachable from the covered dock',
      fromHall.includes('zone_district_892_902'), fromHall.join(','));
    check('and the covered bays are its own',
      fromHall.includes('zone_consv_hall'), fromHall.join(','));
  }

  // ⚠ THE BUILDING IS THE WAY THROUGH TO THE WATER. The marina's whole job on the map is that you
  // walk in off the quay and come out over the fairway, so the dock hall's east exit is
  // load-bearing content rather than decoration. It used to land on a pontoon; with the pontoons
  // gone it lands on open Basin, which is what the boathouse arm's own note always said that tile
  // was — `EAST is the fairway and the boats`. The exit has to survive the pontoons going.
  const fairway = getZone('zone_district_894_902');
  check('the dock hall still opens east onto the fairway',
    !!hall && hall.exits && hall.exits.east === 'zone_district_894_902',
    hall ? JSON.stringify(hall.exits) : 'no hall');
  check('and the fairway opens back west into it',
    !!fairway && fairway.exits && fairway.exits.west === 'zone_consv_hall',
    fairway ? JSON.stringify(fairway.exits) : 'no zone');

  // ⚠ A COVERED BERTH WITH NOBODY IN IT IS A REFIT THAT CAN NEVER FINISH, AND IT FAILS SILENTLY.
  // `cmdRefit`'s full-shed branch needs all three of: the player in a `covered` zone, the boat
  // within reach, and an NPC flagged `repairman` IN THAT ZONE. Marit's `work_zone_id` was the
  // chandlery counter and her `home_zone` is the gallery, so she was never once in the only room
  // where the work can happen — and the refusal falls through to the patch branch, which reads as
  // 'you need a hull patch' rather than as 'this feature is unreachable'. The durable claim is
  // about where she WORKS, because who is standing where at any moment is a function of the clock.
  {
    const { getNpc } = await import('../../server/engine/world.js');
    const wright = getNpc && getNpc('npc_consv_marit');
    check('the yard has a shipwright', !!wright && !!wright.flags && wright.flags.repairman === true,
      wright ? JSON.stringify(wright.flags || {}) : 'no npc_consv_marit');
    const wz = wright && wright.work_zone_id && getZone(wright.work_zone_id);
    check('and she works in a zone a hull can actually be refitted in',
      !!wz && Y.berthKind(wz) === 'covered',
      wright ? 'works in ' + wright.work_zone_id + ' (' + (wz ? Y.berthKind(wz) : 'no zone') + ')' : 'no npc');
  }

  // ── 13. THE MOTOR, AS SOMETHING YOU CAN SEE ───────────────────────────────
  //
  // `rich` and `bang` are the two halves of the gap between the lever and the blower, and they
  // are physics rather than presentation: the flame the renderer draws and the pops the audio
  // schedules are both read off them, so a sign or a gate wrong here is wrong in two places at
  // once and looks like two separate bugs.
  //
  // ⚠ THE REASON THEY LIVE IN THE SIM AT ALL is that they are a DERIVATIVE, and this is the only
  // party with a dt. Taken between two frames anywhere downstream they would be a different number
  // at 30 Hz than at 60 — which is the bug the drift term shipped with, one field over.
  {
    const stab = createBoatState(p);
    step(stab, { throttle: 1, surface: 'open' }, p, 1 / 60);
    check('standing on it from rest runs the motor rich', stab.rich > 0.8, 'rich ' + stab.rich.toFixed(2));
    check('and nothing is backfiring', stab.bang === 0, 'bang ' + stab.bang.toFixed(2));

    // ⚠ A MOTOR HELD AT A STEADY THROTTLE MUST NOT FLAME FOR EVER. The follower catches up, so
    // both fall back to nothing — without that, a boat at a cruise is on fire for the whole run.
    const held = drive(createBoatState(p), { throttle: 1 }, 10);
    check('a steady throttle settles down', held.rich < 0.02 && held.bang < 0.02,
      'rich ' + held.rich.toFixed(3) + ' bang ' + held.bang.toFixed(3));

    const chop = drive(createBoatState(p), { throttle: 1 }, 12);
    step(chop, { throttle: 0, surface: 'open' }, p, 1 / 60);
    check('shutting it at speed backfires', chop.bang > 0.8, 'bang ' + chop.bang.toFixed(2));
    check('and nothing is running rich', chop.rich === 0, 'rich ' + chop.rich.toFixed(2));

    // ⚠ GATED ON REVS, NOT ON THE LEVER. Snapping it shut at a dock is a motor dropping to idle;
    // snapping it shut at seven grand is the noise the hull is known for. Ungated, every boat in
    // the basin would bang every time anybody came alongside.
    const dock = createBoatState(p);
    step(dock, { throttle: 0.3, surface: 'open' }, p, 1 / 60);
    step(dock, { throttle: 0, surface: 'open' }, p, 1 / 60);
    check('but shutting it at a dock does not', dock.bang < 0.1, 'bang ' + dock.bang.toFixed(3));

    // Same elapsed time, two frame rates, one answer.
    const lag = (hz) => { const s2 = createBoatState(p);
      for (let i = 0; i < 0.5 * hz; i++) step(s2, { throttle: 1, surface: 'open' }, p, 1 / hz);
      return s2.rich; };
    check('and the lag does not depend on the frame rate', Math.abs(lag(60) - lag(30)) < 0.08,
      '60hz ' + lag(60).toFixed(3) + ' vs 30hz ' + lag(30).toFixed(3));
  }

  // ── 14. AND IT REACHES SOMEBODY ELSE'S WINDSCREEN ─────────────────────────
  //
  // ⚠ THE FLAG IS THE WHOLE POINT OF THIS CHECK. One contact shape carries aircraft, trucks and
  // boats, and the audio layer picks the hulls out of it on `marine` alone — so a payload that
  // stops stamping it is a boat nobody can hear, silently, from every seat at once.
  {
    rigs.set(-1, { playerId: -1, x: 900, y: 900, heading: 90, speed: 96, topSpeed: 138,
      pedal: 0.82, rich: 0.44, bang: 0.11, nitroOn: true, hull: 0.8, name: 'Test Hull' });
    const [c] = boatContactsNear(900, 900, 5);
    rigs.delete(-1);
    check('a running hull appears as a contact', !!c);
    check('and it declares itself a hull rather than an aeroplane', c && c.marine === true);
    check('carrying what the motor is making', c && c.power === 0.82, c ? 'power ' + c.power : '');
    check('and how far behind the lever it is', c && c.rich === 0.44 && c.bang === 0.11);
    check('and the bottle', c && c.nitroOn === true);
  }

  // ── 12. THE HELM, ON BOTH RUNGS ───────────────────────────────────────────
  //
  // ⚠ WHAT IS ACTUALLY AT RISK HERE IS THAT THE TWO RUNGS BECOME TWO GAMES. The panel integrates
  // `stepBoat` in the browser and `texthelm.js` integrates the same function on a tick here, and
  // the only thing keeping them one system is that neither has a model of its own. A second
  // integrator would not throw, would not fail any other check, and would drift apart from the
  // first over exactly the passages nobody watches twice.
  const T = (await import('./texthelm.js'))._test;
  const FM = await import('../../client/game/js/panels/flight-model.js');

  // The bells are a LEVER POSITION and not a percentage — see the note on the table. What matters
  // is the ordering and the two ends, because those are what make an order mean something.
  check('stop is stopped', T.BELLS.stop === 0);
  check('flank is everything', T.BELLS.flank === 1);
  check('the bells climb', T.BELLS.slow < T.BELLS.half && T.BELLS.half < T.BELLS.full && T.BELLS.full < T.BELLS.flank);
  check('slow is steerage way rather than a crawl', T.BELLS.slow > 0.1 && T.BELLS.slow < 0.35);

  // ⚠ ONE PHYSICS, ASSERTED BY RUNNING IT. Drive the same orders through `stepBoat` directly and
  // through the text helm's own input derivation, and the hull has to end up in the same state —
  // which is only true while the text rung owns no integrator.
  {
    const p = FM.TYPES.hydro;
    const mk = () => ({ x: 0, y: 0, heading: 0, speed: 0, drift: 0, pedal: 0, hull: 1, nitro: 1,
      nitroHeat: 0, vs: 0, z: 0, airborne: false, pitch: 0, roll: 0, clock: 0 });
    const a = mk(), b = mk();
    for (let i = 0; i < 40; i++) {
      const at = 1000 + i * 250;
      const inp = { throttle: T.BELLS.full, steer: 0, nitro: false, surface: 'open', aground: false, now: at };
      FM.stepBoat(a, inp, p, 0.25);
      FM.stepBoat(b, { ...inp }, p, 0.25);
    }
    check('the same orders reach the same hull', Math.abs(a.speed - b.speed) < 1e-9 && Math.abs(a.x - b.x) < 1e-9,
      `speeds ${a.speed.toFixed(4)} / ${b.speed.toFixed(4)}`);
    check('…and full ahead actually gets her going', a.speed > 40, 'speed ' + a.speed.toFixed(1));
  }

  // The status line is what the bottom rung reads INSTEAD of a dial, so it has to carry every
  // number the geometry cluster shows. ⚠ A READOUT THAT DROPS ONE IS NOT A SHORTER LINE, it is a
  // gauge the player on that rung does not have.
  {
    const c = { name: 'Rooster', want: { bearing: 270, bell: 'half' }, fuel: 0.42,
      s: { heading: 268, speed: 61, hull: 0.77, nitro: 0.33 } };
    const line = T.statusLine(c);
    check('the status line names her', line.includes('Rooster'));
    for (const [what, bit] of [['the heading', '268'], ['the order', '270'], ['the speed', '61'],
      ['the bell', 'half'], ['the hull', '77'], ['the fuel', '42'], ['the bottle', '33']]) {
      check('the status line carries ' + what, line.includes(bit), line);
    }
  }

  // ⚠ AND THE ORDER VERB REFUSES RATHER THAN SHRUGS. An order quietly ignored on open water is the
  // one thing a helm may not do — you would be standing at a wheel that had stopped answering with
  // nothing anywhere saying so.
  {
    // ⚠ `run` TAKES THE COMMAND ALONE. It reads the fake player off the harness itself, so passing
    // one lands the player object where the dispatcher expects a string and every check in the
    // section dies at `input.trim is not a function` — which names neither the verb nor the file.
    const notAboard = await run('conn 270');
    check('conning nothing says so', !!notAboard && /not conning|not at the helm/i.test(notAboard.message || ''),
      JSON.stringify(notAboard));

    // ⚠ AND THE ORDER HAS TO ACTUALLY LAND, WHICH THE REFUSAL ABOVE CANNOT SHOW. The engine calls
    // a verb as `handler(args, raw, player)`; written `(player, args)` it reads the ARGUMENT ARRAY
    // as the person, every lookup keyed on `player.id` gets undefined, and the command answers
    // "you are not conning anything" — to somebody at the wheel. That is exactly the shape that
    // passed a green suite here, because a check that only asserts the refusal gets the refusal for
    // the wrong reason. So this seats a helm and gives a real order.
    const p = await getPlayer();
    T.conning.set(p.id, {
      playerId: p.id, boatId: 'rg_test', name: 'Testbed', p: FM.TYPES.hydro,
      s: { x: 0, y: 0, heading: 0, speed: 0, drift: 0, pedal: 0, hull: 1, nitro: 1, nitroHeat: 0,
        vs: 0, z: 0, airborne: false, pitch: 0, roll: 0, clock: 0 },
      fuel: 1, want: { bearing: 0, bell: 'stop', bottle: false, trim: 0 },
      last: Date.now(), said: {}, sinceSay: 0,
    });
    try {
      const bearing = await run('conn 270');
      check('a bearing order reaches the helm', /270/.test(bearing?.message || ''), JSON.stringify(bearing));
      check('…and it is the wheel that moved', T.conning.get(p.id)?.want.bearing === 270,
        String(T.conning.get(p.id)?.want.bearing));

      const bell = await run('conn full');
      check('a bell order reaches the helm', /full/i.test(bell?.message || ''), JSON.stringify(bell));
      check('…and it is the lever that moved', T.conning.get(p.id)?.want.bell === 'full');

      const tabs = await run('conn tabs down');
      check('a tab order reaches the helm', /bow down/i.test(tabs?.message || ''), JSON.stringify(tabs));
      check('…and it is the tabs that moved', T.conning.get(p.id)?.want.trim < 0);

      const nonsense = await run('conn sideways');
      check('a bad order is refused rather than ignored',
        /No such order/i.test(nonsense?.message || ''), JSON.stringify(nonsense));

      const bare = await run('conn');
      check('a bare order is the status line', /Testbed/.test(bare?.message || ''), JSON.stringify(bare));

      // ── THE KEY ON THE TEXT RUNG ──────────────────────────────────────────
      //
      // ⚠ THIS SEAT IS HAND-SEEDED WITHOUT `running`, WHICH IS THE MIGRATION INVARIANT STANDING UP
      // IN A TEST RATHER THAN AN OVERSIGHT: absent means running, so every order above is answered
      // by a live boat exactly as it was before there was a key at all. The cases below drive the
      // flag deliberately, in both directions.
      const c = T.conning.get(p.id);
      const already = await run('conn start');
      check('starting a running boat is refused rather than done twice',
        /already running/i.test(already?.message || ''), JSON.stringify(already));

      const killed = await run('conn kill');
      check('the key reaches the text helm', c.s.running === false, JSON.stringify(killed));
      // ⚠ AND IT RINGS OFF WITH HER. A bell left at FULL on a dead motor is an order the model
      // silently cannot obey, which is the one thing a helm may not do — `conn` would go on
      // printing "full" over a boat making no way.
      check('…and it rings off', c.want.bell === 'stop', String(c.want.bell));

      const deadBell = await run('conn full');
      check('a bell on a dead motor is refused, never accepted and ignored',
        /not running/i.test(deadBell?.message || ''), JSON.stringify(deadBell));
      check('…and the lever did not move', c.want.bell === 'stop', String(c.want.bell));

      // ⚠ STOP IS STILL REACHABLE WITH THE KEY OFF, because ringing off is the one bell that means
      // the same thing on a dead boat and is what `kill` itself does.
      const offBell = await run('conn stop');
      check('…but ringing off still works', !/not running/i.test(offBell?.message || ''), JSON.stringify(offBell));

      const started = await run('conn start');
      check('the starter is armed rather than the motor being switched on',
        c.starting === true && c.s.running === false, JSON.stringify(started));
      // ⚠ ARMED, NOT FIRED — the tick holds the key, because a typed order cannot be held down.
      // A `conn start` that set `running` outright would be an ignition with no crank in it, and
      // the dry-tank refusal below would have nowhere to happen.
      c.starting = false;
    } finally {
      T.conning.delete(p.id);
    }
  }

  // ⚠ SHE HAS TO SETTLE ON THE BEARING RATHER THAN WEAVE ABOUT IT, and that is not a tuning
  // preference — it is discrete time. Rudder authority FALLS with speed, so the LOWEST bell has the
  // most lock, and at a one-second tick a controller asking for full rudder at a modest error
  // commands more turn than the error. Measured at a flat `err / 25` she crossed her ordered
  // bearing NINETEEN times in two minutes at slow ahead and was clean on every other bell — which
  // is exactly the shape of bug nobody finds by driving, because the bell it appears on is the one
  // you use for thirty seconds leaving a pontoon.
  {
    const FM3 = await import('../../client/game/js/panels/flight-model.js');
    const pr = FM3.TYPES.hydro;
    const sail = (bell) => {
      const s = { x: 0, y: 0, heading: 0, speed: 0, drift: 0, pedal: 0, hull: 1, nitro: 1,
        nitroHeat: 0, vs: 0, z: 0, airborne: false, pitch: 0, roll: 0, clock: 0 };
      const norm = (d) => ((d % 360) + 360) % 360;
      let cross = 0, last = 0, settled = null;
      for (let t = 1; t <= 140; t++) {
        const err = ((90 - norm(s.heading) + 540) % 360) - 180;
        FM3.stepBoat(s, { throttle: T.BELLS[bell], steer: T.steerFor(err, pr, 1),
          surface: 'open', aground: false, now: 1000 + t * 1000 }, pr, 1);
        const e2 = ((90 - norm(s.heading) + 540) % 360) - 180;
        const sg = Math.sign(e2);
        if (last && sg && sg !== last) cross++;
        if (sg) last = sg;
        if (settled === null && Math.abs(e2) < 1.5) settled = t;
      }
      return { cross, settled };
    };
    for (const bell of ['slow', 'half', 'full', 'flank']) {
      const r = sail(bell);
      check(`a 90° order on ${bell} settles`, r.settled !== null && r.settled < 30, 'settled ' + r.settled);
      check(`…without weaving about it on ${bell}`, r.cross === 0, r.cross + ' crossings');
    }
    // And the gain is the hull's, not a constant: a boat with a bigger lock asks for less rudder at
    // the same error, which is the whole reason it cannot go stale when somebody retunes a hull.
    check('the gain follows the hull it is steering',
      Math.abs(T.steerFor(20, { turnLock: 60 }, 1)) < Math.abs(T.steerFor(20, { turnLock: 20 }, 1)));
    check('and the tick, so a slower clock asks for less',
      Math.abs(T.steerFor(20, pr, 2)) < Math.abs(T.steerFor(20, pr, 1)));
  }

  // ── THE WRECK HAS TO ACTUALLY FIRE ────────────────────────────────────────
  //
  // ⚠ `dispatchAction` TAKES ONE OBJECT AND RETURNS AN ERROR RATHER THAN THROWING, which is the
  // worst possible pair for a call site that gets the shape wrong: both of these were written as
  // `dispatchAction('BOAT_BREAKUP', {...})`, the destructure read `type` off a string, the registry
  // answered "Unknown action: undefined" — and the result was discarded. So the hull reached zero,
  // the client said something let go, and NOTHING happened: no injuries, no deletion, a wreck
  // sitting in your fleet at zero condition pretending to be an asset. Nothing threw, nothing
  // logged, and every other check in this suite stayed green.
  {
    const fs2 = await import('node:fs');
    for (const f of ['plugins/powerboat/helm.js', 'plugins/powerboat/texthelm.js']) {
      const src = fs2.readFileSync(f, 'utf8');
      const twoArg = /dispatchAction\(\s*['"]/.test(src);
      check(`${f.split('/').pop()} dispatches the wreck as one object`, !twoArg,
        'called as (type, payload) — the registry will answer "Unknown action: undefined"');
      if (/BOAT_BREAKUP/.test(src)) {
        // ⚠ AND THE PARAMS THE HANDLER READS. It sizes the wreck off `speed`/`topSpeed` and deletes
        // the row by `boatId`; without them every wreck is the gentlest possible one and the boat
        // survives its own destruction.
        for (const k of ['boatId', 'speed', 'topSpeed']) {
          check(`…carrying ${k}`, new RegExp(`\\b${k}\\b`).test(src));
        }
      }
    }
  }

  // ── AND NO CONTROL MAY BE WIRED TO A FIELD THE MODEL DOES NOT READ ────────
  //
  // ⚠ THE PANEL HELD S TO AN `astern` LEVER AND `stepBoat` HAS NO ASTERN TERM AT ALL — it clamps
  // speed at zero. The key accumulated a number, handed it over and was discarded, with a comment
  // beside it calling it "a separate, much smaller lever". A control that does nothing is worse
  // than a missing one: it reads as the boat being broken rather than as the feature being absent.
  {
    const fs3 = await import('node:fs');
    const model = fs3.readFileSync('client/game/js/panels/flight-model.js', 'utf8');
    const boat = model.slice(model.indexOf('export function stepBoat'));
    const panel = fs3.readFileSync('client/game/js/panels/boat-view.js', 'utf8');
    const sent = [...panel.matchAll(/^\s{4}(\w+):\s/gm)].map((m) => m[1]);
    const known = new Set(['throttle', 'steer', 'trim', 'nitro', 'surface', 'aground', 'now']);
    for (const f of sent.filter((x) => known.has(x))) {
      check(`the model reads the panel's \`${f}\``, new RegExp(`input\\.${f}\\b`).test(boat));
    }
    check('the panel no longer sends an astern the model cannot read',
      !/astern:/.test(panel) || /input\.astern/.test(boat));

    // ⚠ AND THE SAME RULE FOR THE OTHER TWO WIDGETS IT DRIVES, both of which failed it. The wheel
    // was handed an `onHold` the widget does not read and told to `setAngle`, which is not in its
    // API — so it drew beautifully and steered nothing, while the panel kept a second `steer` of
    // its own that the dead flag meant nothing ever used. The engine was handed `load`, `nitro` and
    // `airborne`, none of which `rampV8` reads, with the PEDAL passed in as the rpm. Every one of
    // those makes a control that looks right and is inert, which is the hardest kind to see.
    const wheel = fs3.readFileSync('client/game/js/panels/helm-wheel.js', 'utf8');
    for (const opt of [...panel.matchAll(/createHelmWheel\([\s\S]*?\n  \}\);/g)]
      .flatMap((m) => [...m[0].matchAll(/^\s{4}(\w+):/gm)].map((o) => o[1]))) {
      check(`the wheel reads the panel's \`${opt}\``, new RegExp(`opts\\.${opt}\\b`).test(wheel));
    }
    for (const call of [...panel.matchAll(/st\.wheel\?\.(\w+)\?\./g)].map((m) => m[1])) {
      check(`the wheel's api has \`${call}\``, new RegExp(`^\\s{4}${call}\\s*[({]`, 'm').test(wheel));
    }
    // ⚠ AND THE WAY OUT HAS TO EXIST AT BOTH ENDS. The client route for `boat_sim_close` shipped
    // with NO SENDER anywhere: ESC sent `disembark`, the server cleared `aboard`, and the helm
    // stayed on the screen — painting, and syncing four times a second into a handler that now
    // returns null because you are not aboard anything — with no way out but reloading. A dead
    // route is invisible from either side on its own, which is why this asserts the PAIR.
    const disp = fs3.readFileSync('client/game/js/dispatch.js', 'utf8');
    const plug = fs3.readFileSync('plugins/powerboat/index.js', 'utf8');
    for (const msg of ['boat_sim', 'boat_sim_close', 'marina', 'marina_close']) {
      const routed = new RegExp(`^\\s*${msg}:`, 'm').test(disp);
      const sent = new RegExp(`['"]${msg}['"]`).test(plug)
        || new RegExp(`['"]${msg}['"]`).test(fs3.readFileSync('plugins/powerboat/helm.js', 'utf8'))
        || new RegExp(`type: '${msg}'`).test(fs3.readFileSync('plugins/powerboat/shopfront.js', 'utf8'));
      check(`\`${msg}\` is routed by the client`, routed);
      check(`…and something actually sends it`, sent, 'a route with no sender is dead in both directions');
    }
    // The seat has to come down on every path that ends a passage, not just the typed one.
    for (const path of ['BOAT_DISEMBARK', 'player.death', 'BOAT_BREAKUP']) {
      const i = plug.indexOf(path);
      check(`${path} takes the seat down`, i >= 0 && plug.slice(i, i + 1400).includes('boat_sim_close'),
        'a helm left open over a dead body, a wrecked hull or an empty pontoon');
    }

    const audio = fs3.readFileSync('client/game/js/panels/boat-audio.js', 'utf8');
    const ramp = audio.slice(audio.indexOf('function rampV8'), audio.indexOf('function rampV8') + 1400);
    for (const k of [...(panel.match(/updateBoatEngine\(\{[^}]*\}/) || [''])[0].matchAll(/(\w+):/g)].map((m) => m[1])) {
      check(`the synth reads the panel's \`${k}\``, new RegExp(`s\\.${k}\\b`).test(ramp));
    }
  }

  // ⚠ THE TEXT RUNG FILLS THE SAME REGISTRY THE PANEL DOES, which is what makes a text driver a
  // boat other people can see. Asserted against the module's own source rather than by sailing
  // one, because what can go wrong is an omission: the tick that forgets `rigs` sails perfectly.
  {
    const src = (await import('node:fs')).readFileSync('plugins/powerboat/texthelm.js', 'utf8');
    check('the text tick writes rigs', /rigs\.set\(/.test(src));
    check('…with the flame fields the contact feed publishes',
      /rich:/.test(src) && /bang:/.test(src) && /pedal:/.test(src));
    check('…and lets go of them when the helm ends', /rigs\.delete\(/.test(src));
    check('the text rung owns no integrator of its own',
      !/function\s+stepBoat/.test(src) && /stepBoat\(/.test(src));
  }

  // ── 13. THE TABS ──────────────────────────────────────────────────────────
  //
  // ⚠ THE CLAIM THAT MATTERS IS THE ONE THAT SOUNDS LIKE A FORMALITY: neutral is EXACT. Every trim
  // term is `1 + k * trim`, so at 0 each is 1 and every passage anybody has ever driven behaves
  // bit-for-bit as it did. That is what let this land without retuning a single authored row, and
  // it is worth one assertion because the alternative — "close enough" — is a boat that handles
  // slightly differently than it did yesterday, with no way to tell whether that was the point.
  {
    const FM2 = await import('../../client/game/js/panels/flight-model.js');
    const p = FM2.TYPES.hydro;
    const mk = () => ({ x: 0, y: 0, heading: 0, speed: 0, drift: 0, pedal: 0, hull: 1, nitro: 1,
      nitroHeat: 0, vs: 0, z: 0, airborne: false, pitch: 0, roll: 0, clock: 0 });
    const run = (trim, n = 400) => {
      const s = mk();
      for (let i = 0; i < n; i++) {
        const inp = { throttle: 1, steer: 0, surface: 'open', aground: false, now: 1000 + i * 50 };
        if (trim !== undefined) inp.trim = trim;
        FM2.stepBoat(s, inp, p, 0.05);
      }
      return s;
    };
    const none = run(undefined), flat = run(0);
    check('no trim field and trim 0 are the SAME hull',
      Object.is(none.speed, flat.speed) && Object.is(none.x, flat.x) && Object.is(none.heading, flat.heading),
      `${none.speed} vs ${flat.speed}`);

    const up = run(1), down = run(-1);
    check('bow up is faster than flat', up.speed > flat.speed + 1, `${up.speed.toFixed(1)} vs ${flat.speed.toFixed(1)}`);
    check('bow down is slower than flat', down.speed < flat.speed - 1, `${down.speed.toFixed(1)} vs ${flat.speed.toFixed(1)}`);

    // ⚠ AND THE TRADE HAS TO GO THE OTHER WAY OUT OF THE HOLE, or trim is not a decision — it is a
    // button marked GO FASTER that you would hold down for ever.
    const plane = (trim) => {
      const s = mk();
      for (let i = 0; i < 800; i++) {
        FM2.stepBoat(s, { throttle: 1, steer: 0, trim, surface: 'open', aground: false, now: 1000 + i * 50 }, p, 0.05);
        if (s.planing) return (i + 1) * 0.05;
      }
      return Infinity;
    };
    const tDown = plane(-1), tFlat = plane(0), tUp = plane(1);
    check('bow down gets her on the plane soonest', tDown < tFlat && tFlat < tUp,
      `down ${tDown.toFixed(2)}s flat ${tFlat.toFixed(2)}s up ${tUp.toFixed(2)}s`);

    // The rudder half. Bow down puts the forefoot in, so she holds on better — asserted through the
    // heading she actually makes rather than through the coefficient, because the coefficient is
    // the thing under test.
    const swing = (trim) => {
      const s = mk();
      for (let i = 0; i < 200; i++) FM2.stepBoat(s, { throttle: 0.8, steer: 0, trim, surface: 'open', aground: false, now: 1000 + i * 50 }, p, 0.05);
      const h0 = s.heading;
      for (let i = 0; i < 40; i++) FM2.stepBoat(s, { throttle: 0.8, steer: 1, trim, surface: 'open', aground: false, now: 11000 + i * 50 }, p, 0.05);
      return Math.abs(s.heading - h0);
    };
    check('bow down turns harder than bow up', swing(-1) > swing(1),
      `down ${swing(-1).toFixed(1)}° vs up ${swing(1).toFixed(1)}°`);

    check('the model records where the tabs are', typeof flat.trim === 'number');
  }

  // ⚠ BOTH RUNGS REACH THE SAME FIELD. The panel holds a rocker and the text helm takes a notch,
  // because a typed order cannot be held — but if either stops handing `stepBoat` a `trim` the
  // control silently does nothing on that rung, which is the exact shape of failure this whole
  // Display Mode axis exists to prevent.
  {
    const fs = await import('node:fs');
    const panel = fs.readFileSync('client/game/js/panels/boat-view.js', 'utf8');
    const text = fs.readFileSync('plugins/powerboat/texthelm.js', 'utf8');
    check('the panel sends a trim', /trim:\s*st\.trim/.test(panel));
    check('the text helm sends a trim', /trim:\s*c\.want\.trim/.test(text));
    check('the panel holds the tabs rather than springing them back',
      /TRIM_RATE/.test(panel) && !/st\.trim\s*-=\s*st\.trim/.test(panel));
  }

  // ── 14. THE YARD AS A SCREEN ──────────────────────────────────────────────
  //
  // ⚠ THE CLAIM THIS SECTION EXISTS FOR IS THAT THE PANEL DECIDES NOTHING. It sits on the
  // `prefersLoggedPanels` axis, which means deleting it must leave nobody stuck — and the only
  // thing keeping that true is that every button sends a verb string a player could have typed. A
  // button that grew its own route would break it in the one way nobody notices until somebody on
  // the log rung cannot do something everybody else can.
  {
    const fsm = await import('node:fs');
    const path = await import('node:path');
    const panel = fsm.readFileSync('client/game/js/panels/marina-panel.js', 'utf8');

    const cmds = [...panel.matchAll(/data-cmd="([^"$]+)/g)].map((m) => m[1].trim().split(/\s+/)[0])
      .concat([...panel.matchAll(/data-cmd="([a-z]+)\s/g)].map((m) => m[1]));
    const verbs = [...new Set(cmds.filter(Boolean))];
    check('the panel offers at least one verb', verbs.length > 0);

    // ⚠ CHECKED AGAINST THE MANIFESTS, WHICH ARE THE ONE THING IN A PLUGIN FOLDER THAT CANNOT LIE:
    // the loader registers exactly what they list. A source scan of the handlers would pass on a
    // verb somebody wrote and never declared, which is a verb that does not exist at runtime.
    const declared = new Set();
    const dir = 'plugins';
    for (const e of fsm.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const mf = path.join(dir, e.name, 'plugin.json');
      if (!fsm.existsSync(mf)) continue;
      for (const c of (JSON.parse(fsm.readFileSync(mf, 'utf8')).commands || [])) declared.add(c);
    }
    const { builtinCommandNames } = await import('../../server/engine/commands/index.js');
    for (const b of builtinCommandNames()) declared.add(b);

    const orphan = verbs.filter((v) => !declared.has(v));
    check('every button on the screen is a verb you could have typed', orphan.length === 0,
      orphan.join(', '));

    // ⚠ AND NOTHING ON IT IS AN OPAQUE ID. A panel that sent `{action:'buy', id:7}` would pass the
    // check above by having no verbs at all, so the shape is asserted too.
    check('the panel sends verb strings rather than ids', !/data-cmd="\d/.test(panel));
  }

  // ── THE DESK IS NEVER EMPTY, AND THAT IS A MEASUREMENT ─────────────────────────────────────────
  //
  // Two people on twelve hours each is the marina's whole claim about access, and it is the kind of
  // claim that is easy to make in prose and quietly false in the data: Odile's shift crosses
  // midnight, and a `vendor_schedule` block could not do that until the day this was written — so
  // the honest form of "somebody is always here" is a sweep of all 168 hours of the week.
  //
  // ⚠ AND THE DOUBLE COUNT MATTERS AS MUCH AS THE GAP. Two blocks that overlap also cover every
  // hour, and two clerks behind one desk is a different world from the one the prose describes.
  {
    const { isVendorWorkTime } = await import('../../server/engine/ai-behaviour.js');
    const { getNpc } = await import('../../server/engine/world.js');
    const day = getNpc('npc_marina_desk_day');
    const night = getNpc('npc_marina_desk_night');
    if (day && night) {
      let gaps = 0, doubles = 0;
      for (let iso = 1; iso <= 7; iso++) {
        for (let h = 0; h < 24; h++) {
          const d = isVendorWorkTime(day, { dayOfWeek: iso, hour: h }).working;
          const n = isVendorWorkTime(night, { dayOfWeek: iso, hour: h }).working;
          if (!d && !n) gaps++;
          if (d && n) doubles++;
        }
      }
      check('the marina desk is staffed every hour of the week', gaps === 0, gaps + ' unstaffed hour(s)');
      check('…and never by both of them at once', doubles === 0, doubles + ' double-staffed hour(s)');
      // ⚠ The night shift is the case the wrap exists for, so it is named rather than merely covered
      // by the sweep above: a two-block rewrite would pass the sweep and lose the demonstration.
      check('…with the night shift written as one block that crosses midnight',
        Object.values(night.vendor_schedule || {}).every(b => b.length === 1 && b[0].to < b[0].from));
    }
  }

  // The reachability half. Fairweather is five rooms and two pontoons, and the whole place has to
  // answer as one — which is the bug the truck depot shipped and this is written against.
  {
    const SF = await import('./shopfront.js');
    const { getZone } = await import('../../server/engine/world.js');
    const HALL = 'zone_consv_hall';
    if (getZone(HALL)) {
      const hall = SF.yardHere(HALL);
      check('the dock hall is a yard', !!hall);
      check('…and it can see its own berths', !!hall && hall.zones.length > 1, String(hall?.zones.length));
      check('…and the dealer, which is not itself a berth', !!hall?.dealer);
      // The lobby is a room with no berth flag of its own: if IT answers, the walk is doing its job.
      if (getZone('zone_marina_lobby')) {
        check('the lobby is the same yard', !!SF.yardHere('zone_marina_lobby'));
      }
      // ⚠ AND SOMEWHERE ELSE ENTIRELY IS NOT, or the screen opens over the whole city.
      check('an ordinary street is not a yard', !SF.yardHere('zone_district_900_900'));

      // ── ⚠ AND NEITHER IS THE QUAY OUTSIDE THE DOOR ───────────────────────────────────────────
      //
      // The check above is far too easy: `zone_district_900_900` is most of the way across the
      // city, and the walk that answers this question goes FIVE STEPS. The tile that actually
      // catches the bug is the one on the other side of the dock's own gangway — one step from a
      // berth — and for a long time it answered yes, so the marina HUD came up over Halcyon Quay a
      // block before you reached the door. Reported exactly that way.
      for (const outside of ['zone_district_894_902', 'zone_district_893_903']) {
        if (getZone(outside)) check('the quay outside is not the marina (' + outside + ')', !SF.yardHere(outside));
      }
      // ⚠ THE HARDSTANDING IS THE OTHER SIDE OF THAT RULE AND MUST STILL ANSWER. It is an OUTDOOR
      // tile with no building around it, so a test written as "are you indoors" would have shut the
      // cradle yard out of its own screen. It is a berth, which is the claim that matters.
      if (getZone('zone_district_892_902')) {
        check('…but a cradle yard out in the open still is', !!SF.yardHere('zone_district_892_902'));
      }

      // ⚠ AND THE ROOM DECIDES THE SCREEN. A berth gets the dock; the paperwork rooms do not, and
      // the panel drops the whole tab on that answer rather than drawing a picture of water
      // somebody is not standing beside.
      check('the dock hall is a dock', SF.yardHere(HALL)?.dock === true);
      if (getZone('zone_marina_lobby')) {
        check('…and the lobby is not', SF.yardHere('zone_marina_lobby')?.dock === false);
      }

      // ⚠ THE CACHE MUST NOT CHANGE THE ANSWER. It is keyed on content and asked on the hottest
      // path in the game, so the thing to prove is that a cold walk and a warm one agree.
      const warm = SF.yardHere(HALL);
      SF._forgetYards();
      const cold = SF.yardHere(HALL);
      check('the cache and a cold walk agree',
        !!warm === !!cold && warm.zones.length === cold.zones.length && !!warm.dealer === !!cold.dealer);

      // ⚠ AND THE RUNG GATE THE RIGHT WAY ROUND, which is the one thing about this panel that
      // cannot be seen from the outside. `prefersLoggedPanels` is true ONLY on the bottom rung, so
      // a panel pusher tests it to decide to print TEXT INSTEAD. Written with the sense inverted
      // the screen goes to the handful of players who asked for no screens and to NOBODY ELSE —
      // which is what shipped, and it reads as a feature that was never built rather than as a
      // bug, because every verb the panel offers goes on working perfectly.
      const pres = await import('../../server/engine/presentation.js');
      const p2 = getPlayer();
      const before = p2.current_zone;
      p2.current_zone = HALL;
      try {
        await pres.setDisplayRung(p2, 'visual');
        check('a visual player gets the yard screen', (await SF.pushMarina(p2, HALL)) === true);
        await pres.setDisplayRung(p2, 'log');
        check('…and a log player gets none of it', (await SF.pushMarina(p2, HALL)) === false);
      } finally {
        await pres.setDisplayRung(p2, 'visual').catch(() => {});
        p2.current_zone = before;
      }
    }
  }

  // ── `helm` IS SHARED WITH THE ECHELON, AND A COLLISION IS SILENT ──────────────────────────────
  //
  // `plugins/yacht` declares `helm` too and loads AFTER this one, so the loader hands it the word
  // outright — every `helm` a boat owner typed was answered "You can only take the helm from her
  // bridge." Nothing failed: the plugin loaded, the manifest sweep passed, the verb existed and
  // refused. The fix is the `BOAT_HELM` action the yacht dispatches by name off her bridge, so what
  // is worth asserting is the SEAM rather than the word: the action is registered, and the yacht
  // hands it on instead of spending the verb.
  {
    const { dispatchAction } = await import('../../server/engine/actions.js');
    const unknown = await dispatchAction({ type: 'BOAT_HELM', actor: null });
    check('BOAT_HELM is a registered action', !/^Unknown action:/.test(unknown?.message || ''));

    const src = await import('node:fs').then(m => m.readFileSync('plugins/yacht/index.js', 'utf8'));
    check('the yacht hands `helm` on off her bridge', /BOAT_HELM/.test(src));
    // ⚠ AND BEFORE ITS ADMIN GATE. `helm` is admin-only on the Echelon, so a delegation placed
    // under that check reaches nobody who owns a boat — which looks exactly like this bug again.
    check('…before the admin gate, not after',
      src.indexOf('BOAT_HELM') < src.indexOf("player.role !== 'admin') return ADMIN_ONLY", src.indexOf('cmdHelmConsole')));
  }

  // ── THE TANK ──────────────────────────────────────────────────────────────────────────────────
  //
  // `stepBoat` has spent fuel since the day it shipped and nothing in the world could put any in.
  // What is asserted here is the ARITHMETIC and the SEAM: the price is a pure function of the
  // type's own tank, the clamp never sells more than the tank or the balance holds, and the verb
  // that reaches it is somebody else's word routed by name.
  {
    const FUEL = await import('./fuel.js');
    const fm = await import('../../client/game/js/panels/flight-model.js');

    // ⚠ READ OFF THE TYPE, NEVER WRITTEN DOWN. The whole point of pricing per unit is that a
    // second hull with a bigger tank costs more to fill with nothing authored — a test asserting
    // `299` would pass for ever while the ladder moved out from under it. Trucking's own suite
    // makes exactly this move against FUEL_FULL and says why.
    const tank = fm.TYPES.hydro.tank;
    check('a full tank is the type\'s own capacity at the marine rate',
      FUEL._test.tankPrice('hydro') === Math.round(tank * FUEL._test.FUEL_PER_UNIT),
      String(FUEL._test.tankPrice('hydro')));
    check('…and a hull the dealer has never heard of is still not free to fill',
      FUEL._test.tankPrice('nothing_like_this') > 0);

    const full = FUEL._test.tankPrice('hydro');
    const rich = FUEL._test.fuelClamp(1e9, 0, 1, 'hydro');
    check('a rich player fills it', Math.abs(rich.take - 1) < 1e-9 && rich.cost === full,
      JSON.stringify(rich));
    // ⚠ THE BALANCE IS A CLAMP AND NEVER A REFUSAL — trucking's own rule, and it matters more
    // here, because the thing you are short of fuel in does not float anywhere useful on its own.
    const poor = FUEL._test.fuelClamp(Math.round(full / 4), 0, 1, 'hydro');
    check('a poor player gets what they can pay for and no error',
      poor.take > 0.2 && poor.take < 0.3 && poor.cost <= Math.round(full / 4), JSON.stringify(poor));
    const brimmed = FUEL._test.fuelClamp(1e9, 1, 1, 'hydro');
    check('a full tank takes nothing and costs nothing', brimmed.take === 0 && brimmed.cost === 0);
    const part = FUEL._test.fuelClamp(1e9, 0.75, 1, 'hydro');
    check('…and a part-full one is only ever topped to the brim',
      Math.abs(part.take - 0.25) < 1e-9, JSON.stringify(part));

    const { dispatchAction } = await import('../../server/engine/actions.js');
    const unknownFuel = await dispatchAction({ type: 'BOAT_FUEL', actor: null });
    check('BOAT_FUEL is a registered action', !/^Unknown action:/.test(unknownFuel?.message || ''));

    // ⚠ THE VERBS ARE SOMEBODY ELSE'S AND THE ANSWER IS DISPATCHED BY NAME. `fuel` is trucking's
    // and `refuel` is flight's; a plugin verb silently beats an engine builtin, so a collision is
    // not a load error but two systems quietly ceasing to work — which is exactly what `helm` did
    // above. The seam is the thing to assert, because the word can never be tested from here.
    const fsm2 = await import('node:fs');
    const truckSrc = fsm2.readFileSync('plugins/trucking/index.js', 'utf8');
    const flightSrc = fsm2.readFileSync('plugins/flight/index.js', 'utf8');
    check('trucking hands `fuel` on when nobody is in a cab', /BOAT_FUEL/.test(truckSrc));
    check('flight hands `refuel` on before it reaches the generator',
      flightSrc.indexOf('BOAT_FUEL') > 0
      && flightSrc.indexOf('BOAT_FUEL') < flightSrc.indexOf('generatorCommands.refuel', flightSrc.indexOf('BOAT_FUEL') - 600));
    // ⚠ AND A WORLD WITHOUT THIS PLUGIN MUST FALL THROUGH RATHER THAN ANSWER "Unknown action".
    // `dispatchAction` returns that error instead of throwing, so a router that merely tested for
    // truthiness would print it at a driver standing at a forecourt.
    // ⚠ MEASURED FROM THE DISPATCH CALL, NOT FROM THE FIRST MENTION OF THE NAME. The comment
    // above the router explains the fall-through, so it says "Unknown action" several lines
    // BEFORE the code does — a window taken from the first occurrence of `BOAT_FUEL` reads the
    // prose and then reports the guard missing, which is a check testing its own anchor.
    const UNKNOWN_GUARD = /\/\^Unknown action\/\.test\(/;
    const truckAt = truckSrc.indexOf("type: 'BOAT_FUEL'");
    check('trucking\'s router treats an unregistered action as a fall-through',
      truckAt > 0 && UNKNOWN_GUARD.test(truckSrc.slice(truckAt, truckAt + 400)));
    // Flight's guard lives in `tryVesselAction`, the shared helper the two swimming rungs already
    // go through, so what is asserted there is that the fuel hop USES it rather than dispatching
    // by hand beside it — the helper is where the rule is, and a second call site with its own
    // truthiness test is how a router starts printing `Unknown action` at a driver.
    check('…and flight\'s goes through the helper that owns the rule',
      /tryVesselAction\('BOAT_FUEL'/.test(flightSrc) && UNKNOWN_GUARD.test(flightSrc));
  }

  // ── THE FUEL FLOAT ────────────────────────────────────────────────────────────────────────────
  //
  // The content half, and it is worth a test because three separate facts have to line up on one
  // tile and any of them missing is silent: a deck you can stand on, berths to lie at, and a pump.
  {
    const FUEL = await import('./fuel.js');
    const Y = await import('./yard.js');
    const { getZone } = await import('../../server/engine/world.js');
    const FLOAT = 'zone_district_892_901';
    const float = getZone(FLOAT);
    if (float) {
      check('the fuel float is a berth', Y.berthKind(float) === 'berth');
      check('…with room at it', Y.berthCapacity(float) > 0);
      check('…and a pump on it', FUEL._test.boatFuelAt(float));
      // ⚠ A PONTOON IS A DECK, NOT WATER, and that is the one property a `terrain: water` tile has
      // to be overridden out of. Without it the pump stands in the Basin: you tread water at your
      // own fuel float, the swim tick bleeds you while you fill up, and `isOpenWater` calls a real
      // berth adrift.
      check('…and it is a deck rather than water to stand in', !Y.isOpenWater(float));
      // It has to be reachable on foot from the hulls, or `berthsNear` cannot see the yard's only
      // pump from the shed the yard's boats are kept in — which is the bug that moved REACH twice.
      if (getZone('zone_consv_hall')) {
        check('the covered dock can reach the float on foot',
          Y.berthsNear('zone_consv_hall').some((z) => z.id === FLOAT));
        check('…and the float can reach the covered dock',
          Y.berthsNear(FLOAT).some((z) => z.id === 'zone_consv_hall'));
      }
      // ⚠ SYNC BY CONTRACT. The pylon's rows come through `gatherHookSync`, so a contributor that
      // turns async keeps working for `examine` and silently disappears from the sign by the road.
      const row = FUEL.fuelPrices(float);
      check('the price board is answered here', !!row && row.price > 0);
      check('…synchronously', typeof row?.then !== 'function');
      check('…with the number it will actually charge',
        row.price === FUEL._test.tankPrice('hydro'), JSON.stringify(row));
      check('a room with no pump answers the board nothing',
        FUEL.fuelPrices(getZone('zone_consv_hall')) === undefined);
      // ⚠ AND THE HOOK IS ASKED WITH `{ id }` AND NOTHING ELSE. `deriveSurfaceCell` gathers this
      // for the price sign out the windscreen and hands over a bare id — no flags at all — so a
      // contributor that read them off the argument works perfectly for `examine`, answers nothing
      // for the pylon, and says not one word about why. Both other contributors on this hook make
      // the same move, which is why this is asserted rather than assumed.
      check('…and it answers the same to a bare id', !!FUEL.fuelPrices({ id: FLOAT }));

      // ⚠ THE PUMP'S OWN PRICE IS AUTHORED AND MUST BE THE ONE THIS FILE CHARGES. `fuel_source` is
      // a FURNITURE flag — the rate `fill` draws a jerry can at — and there is no way to derive it
      // from here at authoring time, so it is the one number in this system that exists twice. The
      // fuelstation rule says a sign that lies about a price is worse than no sign; this is the
      // same argument pointed at the pump itself, and trucking's suite makes the identical move by
      // reading FUEL_FULL back rather than writing 380.
      const fsm3 = await import('node:fs');
      const pump = JSON.parse(fsm3.readFileSync('content/furniture/furn_marina_fuel_pump.json', 'utf8'));
      check('the pump charges a can what the float charges a boat',
        Number(pump.flags.fuel_source) === FUEL._test.FUEL_PER_UNIT,
        pump.flags.fuel_source + ' vs ' + FUEL._test.FUEL_PER_UNIT);
      check('…and it stands on the float', pump.zone_id === FLOAT);
      // The framed board only renders where somebody authored a sign, so without this the hook
      // above is a contributor nothing in the world ever asks.
      check('…and it is the thing that carries the board', !!pump.flags.fuel_price_sign);
    }

    // OPEN WATER IS THE FOURTH PLACE A HULL CAN BE, and it is derived rather than authored.
    const basin = getZone('zone_district_894_902');
    if (basin) check('open water is open water', Y.isOpenWater(basin));
    const hall = getZone('zone_consv_hall');
    if (hall) check('…and a covered dock is not', !Y.isOpenWater(hall));
    check('…and nothing at all is not', !Y.isOpenWater(null));
  }

  // ── GOING OVER THE SIDE, AND THE LAUNCH THAT COMES OUT ────────────────────────────────────────
  {
    const A = await import('./adrift.js');
    const { dispatchAction } = await import('../../server/engine/actions.js');
    const { getZone } = await import('../../server/engine/world.js');

    const unknownTow = await dispatchAction({ type: 'BOAT_TOW', actor: null });
    check('BOAT_TOW is a registered action', !/^Unknown action:/.test(unknownTow?.message || ''));
    const truckSrc = (await import('node:fs')).readFileSync('plugins/trucking/index.js', 'utf8');
    check('trucking hands `tow` on when nobody is in a cab', /BOAT_TOW/.test(truckSrc));

    // ⚠ A RECOVERY CAN NEVER COST MORE THAN A FRACTION OF THE BOAT. The distance term reads
    // coordinates off content, and content can always grow a row whose coordinates are not where
    // the thing is — which is the measurement bug that once quoted 10,038₵ to fetch a 1,300₵ truck.
    const price = (await import('../../client/game/js/panels/flight-model.js')).TYPES.hydro.price;
    const near = A._test.towFee('hydro', 'zone_district_892_901', 'zone_district_892_902');
    const far = A._test.towFee('hydro', 'zone_district_892_901', 'zone_terminus_1210_940');
    check('a tow from next door is the call-out and not much more', near > 0 && near < price * 0.1,
      String(near));
    check('…a tow from further is dearer', far >= near, near + ' -> ' + far);
    check('…and no tow anywhere can cost a third of the hull again',
      far <= Math.round(price * 0.35) && near <= Math.round(price * 0.35), String(far));
    check('an unknown type is still billed something',
      A._test.towFee('not_a_boat', 'zone_district_892_901', 'zone_district_892_902') > 0);

    // ⚠ AN INTERIOR HAS NO COORDINATES AND THAT IS NOT A POSITION, IT IS THE ABSENCE OF ONE. Every
    // one of the 324 interiors in this world sits at grid 0,0, so a fee measured straight off the
    // row bills the distance from the origin of the coordinate space to the far side of the map.
    if (getZone('zone_consv_hall')) {
      const fromShed = A._test.towFee('hydro', 'zone_district_892_901', 'zone_consv_hall');
      check('a covered dock is billed from its own tile, not from 0,0', fromShed < price * 0.1,
        String(fromShed));
    }

    // Nobody is under way in a headless suite, so what can be asserted is the fall-through that
    // makes the whole arrangement safe: no passage, no answer, and the ordinary climb-out runs.
    const p3 = await getPlayer();
    check('nothing to end means the ordinary climb-out still gets its turn',
      (await A.overboard(p3, null)) === null);

    // The room line is gathered on EVERY look in the game, so the thing that matters about it is
    // what it costs to say nothing: a resolved-property read, no await, no query.
    check('a room that is not open water says nothing about boats',
      (await A._test.describeAdrift(getZone('zone_consv_hall'), p3)) === undefined);
    check('…and neither does a berth', (await A._test.describeAdrift(getZone('zone_district_892_901'), p3)) === undefined);
  }

  // ── SITTING IN A BOAT IS NOT SWIMMING ─────────────────────────────────────────────────────────
  //
  // `swim.afloat` exists because swimming decides who is treading water from what they are
  // CARRYING, which is all it can see on its own — so a player who climbed into a hull lying off
  // the quay was a body in the water to every rule it owns, and the tick bled their stamina until
  // they drowned at the wheel of a working boat.
  {
    const { hooks } = await import('./index.js');
    const p4 = await getPlayer();
    check('the boat answers the afloat question', typeof hooks['swim.afloat'] === 'function');
    check('…false for somebody not in one', hooks['swim.afloat'](p4) === false);
    check('…and it never throws on nobody', hooks['swim.afloat'](null) === false);
    // ⚠ SYNC BY CONTRACT, because this is asked on every move in the game and once a second for
    // every body in the water. `gatherHookSync` drops a promise and logs it, so an answer that
    // became async would fail quietly by drowning somebody.
    check('…synchronously', typeof hooks['swim.afloat'](p4)?.then !== 'function');

    const swimSrc = (await import('node:fs')).readFileSync('plugins/swimming/index.js', 'utf8');
    check('swimming asks rather than assuming', /swim\.afloat/.test(swimSrc));
    check('…through the SYNC gather', /gatherHookSync\(\s*'swim\.afloat'/.test(swimSrc));
    // ⚠ AND IT HAS TO REACH `syncSwimmer`, which is the one function that decides membership of
    // the drowning roster. Asked anywhere else it is a fact nothing acts on.
    const sync = swimSrc.slice(swimSrc.indexOf('function syncSwimmer'), swimSrc.indexOf('function dropSwimmer'));
    check('…inside syncSwimmer, which is what decides who is drowning', /afloatByPlugin/.test(sync));
  }

  // ── A BERTH HAS NO CLOSING TIME ───────────────────────────────────────────────────────────────
  //
  // Marit Colvane sells chandlery and her shift is in the covered dock, so commerce derived the
  // hall as her SHOPFRONT and locked it every evening and all day Sunday — with the player's boat
  // inside it. Her work zone cannot move: `refit` wants a shipwright in the same room as a covered
  // berth and that is the whole reason it was put there. The building's own prose has said "the
  // dock does not lock — there is no lock on it" since the day it was written.
  {
    const { hooks } = await import('./index.js');
    const { getZone } = await import('../../server/engine/world.js');
    const SD = await import('../commerce/shopdoor.js');
    check('a berth says it never shuts', typeof hooks['shop.neverShuts'] === 'function');
    // ⚠ SYNC — the shut provider behind this is asked for every cardinal side of every interior
    // tile in the minimap window, and `gatherHookSync` drops a promise.
    const hall = getZone('zone_consv_hall');
    if (hall) {
      const ans = hooks['shop.neverShuts'](hall);
      check('…of the covered dock', ans === true);
      check('…synchronously', typeof ans?.then !== 'function');
    }
    // ⚠ AND IT IS NOT A BLANKET "NOTHING SHUTS". The restaurant next door is the one thing in the
    // building that is supposed to close, so a hook that answered true for any marina room would
    // take the hours off it too and nothing would say so.
    const anch = getZone('zone_marina_anchovies');
    if (anch) check('…and the restaurant still keeps its hours', hooks['shop.neverShuts'](anch) !== true);

    // ── ⚠ AND COMMERCE HAS TO AGREE, WITH THE VENDOR ACTUALLY SHUT ──────────────────────────────
    //
    // The hook existing while the door still locks is the exact shape of a carve-out wired at one
    // end, so what matters is `shopClosedFor` — the one function the move gate's refusal, the shut
    // provider and the closing sweep all read. ⚠ AND IT CANNOT BE ASKED AGAINST THE LIVE CLOCK:
    // the shipwright keeps ordinary shop hours, so for most of a working day the hall is open
    // anyway and the check passes without the exemption ever firing. Mutation-tested exactly that
    // way — deleting the fix left this green.
    //
    // So both vendors are put off-shift and the pair is compared. ⚠ THE RESTAURANT IS THE CONTROL
    // and it is the whole test: with both shut, a hall that answers open and an Anchovies that
    // answers shut is the exemption doing it, where two nulls would only mean the manipulation
    // did not take.
    {
      const { world } = await import('../../server/engine/world.js');
      const DAY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
      const { getEnvironmentState } = await import('../../server/engine/environment.js');
      // Three days out: never today, and never YESTERDAY either — a block is filed under the day
      // it starts on and spills across midnight, so a neighbouring day can still read as on-shift.
      const far = DAY[(((getEnvironmentState().dayOfWeek ?? 1) % 7) + 3) % 7];
      const shut = { [far]: [{ from: 9, to: 17 }] };
      const pick = (zid) => [...world.npcs.values()].find((n) => n?.work_zone_id === zid && n.vendor_inventory?.length);
      const marit = pick('zone_consv_hall'), otta = pick('zone_marina_anchovies');
      const saved = [[marit, marit?.vendor_schedule], [otta, otta?.vendor_schedule]];
      try {
        // ⚠ MUTATED IN PLACE, because `shopIndex` caches the NPC OBJECTS on a 60s TTL and has no
        // buster — replacing the row in the Map would leave the index holding the old one.
        for (const [n] of saved) if (n) n.vendor_schedule = shut;
        if (marit && hall) {
          check('…so the dock is open even with the shipwright off shift',
            SD.shopClosedFor(hall) === null, 'the shipwright still locks the hall her shift is in');
        }
        if (otta && anch) {
          check('…while the restaurant beside it is shut, which is the control',
            SD.shopClosedFor(anch) !== null, 'both rooms read open — the manipulation did not take');
        }
      } finally {
        for (const [n, s] of saved) if (n) n.vendor_schedule = s;
      }
    }
    const street = getZone('zone_district_900_900');
    if (street) check('…and an ordinary street is not a berth either', hooks['shop.neverShuts'](street) !== true);
  }

  // ── THE ROOM SAYS WHAT IS FLOATING IN IT ──────────────────────────────────────────────────────
  //
  // A thing in a place the room does not mention is a thing nobody will ever find again — and the
  // place here is a square of open water that looks exactly like the four squares around it.
  {
    const { hooks } = await import('./index.js');
    check('the room description is contributed to', typeof hooks['zone.describeRoom'] === 'function');
    const src = (await import('node:fs')).readFileSync('plugins/powerboat/adrift.js', 'utf8');
    // ⚠ YOUR OWN HULL IS A LINK AND A STRANGER'S IS NOT. Offering somebody a button that can only
    // refuse is an affordance that lies — the parked-truck line's own rule, quoted.
    check('your own boat is clickable', /data-cmd="embark"/.test(src));
    check('…and the click is a verb rather than an id', !/data-cmd="\w+ \$\{/.test(src));
    // ⚠ AND THE GATE COMES BEFORE THE QUERY. This is gathered on every look in the game.
    check('the tile is tested before any query is made',
      src.indexOf('isOpenWater(zone)') < src.indexOf('SELECT id, name, type_id'));
  }
}
