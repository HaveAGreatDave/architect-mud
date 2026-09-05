// THE ROAD TEST — the truck half of the pilot's checkride.
//
// Flight has had a training run since the day it shipped: an examiner, a free loaner, a staged set
// of instructions paced off the live telemetry, and a licence at the end of it. Driving had the
// whole simulation — eight gears, a trailer that folds, brakes that fade — and NOTHING that ever
// told a new driver any of it. The depot panel sold you a truck and the road did the teaching, at
// forty tonnes and whatever a shopfront costs.
//
// So this is the checkride's shape, deliberately, and three of its decisions are copied wholesale:
// a FREE loaner (nothing you can lose), a FORGIVING ride (a fluffed stage costs a repeat, never the
// run), and a crash that simply ends it with no bill. Everything that differs, differs because a
// truck is not an aeroplane:
//
//  · IT IS RUNG-NEUTRAL BY CONSTRUCTION. The checkride is paced off a 60fps cockpit and pushes ring
//    gates into it; there is no such client on the log rung, so flight needs a second server-side
//    observer for text pilots (checkGateProximity). Every milestone here is a DISTANCE FROM THE
//    YARD read off the rig, which both rungs already maintain — the cab reconciles it four times a
//    second and the text tick walks it a tile at a time — so one evaluator serves all three rungs
//    and there is no second law to drift.
//  · THE INSTRUCTIONS GO TO THE LOG, not to a card over the windscreen. Same reason: the log is the
//    one surface every rung has (docs/systems-display-mode.md), and an instruction a text driver
//    cannot read is a tutorial that only exists for people who did not need it.
//  · AND THE LICENCE HAS TO BE ADDED WITHOUT CONFISCATING ANYTHING. Flight can gate the seat
//    outright because it shipped gated; `drive` has been open for months, so the same gate bolted
//    on flat would meet every existing driver at their own yard and tell them to go and learn.
//    `isLicensedDriver` is where that is answered: OWNING A TRUCK IS THE LICENCE — you demonstrably
//    drive — and the flag is written the first time anybody asks, so the fleet converges with no
//    one-shot script. New drivers, who own nothing, meet the gate; nobody loses a rig to it.
//
// The loaner is a real `trucks` row, exactly as the trainer Mayfly is a real `aircraft` row, so it
// mounts, steers, wears and parks through the ordinary code with nothing special-cased. It is
// stamped `custom_data.roadtest` and deleted the moment the ride ends — plus a sweep at boot, so a
// server that died mid-lesson does not leave school rigs standing in yards for ever.
import { query } from '../../server/models/db.js';
import { on } from '../../server/engine/events.js';
import { sendToPlayer, teachVerb } from '../../server/engine/messaging.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { buyTruck } from './fleet.js';

const LICENSE_FLAG = 'truck_licensed';
const SCHOOL_TYPE = 'drayman';     // "The one everybody learns on" — its own blurb says so
const PURSE = 400;

// ── The stages ────────────────────────────────────────────────────────────────
// KEY → OUT → RUN → BACK → PARK. Distances are straight-line tiles from the yard, which is the one
// measurement that means the same thing at all five depots and needs nothing authored anywhere.
export const STAGE = { KEY: 0, OUT: 1, RUN: 2, BACK: 3, PARK: 4 };
const OUT_TILES = 3;     // clear of the hardstand
const RUN_TILES = 10;    // far enough that the box has to be shifted through the gears
const BACK_TILES = 2;    // near enough to the door to be called back

const INSTRUCTIONS = {
  [STAGE.KEY]: 'Turn the key and hold it until she catches — <b>K</b>, or the barrel on the shelf. '
    + 'Nothing else on this truck works until the diesel is running.',
  [STAGE.OUT]: 'First is a crawler, so she will pull away at walking pace on almost no throttle. '
    + 'Get her out of the yard and onto the road, and change up as the needle comes round.',
  [STAGE.RUN]: "Now put some road under her — ten tiles out, and I don't care which way. Work up through the box. "
    + 'She stops in about three times what you think she does, and on anything long and downhill you hold a gear '
    + 'and use the <b>jake</b> rather than cooking the brakes.',
  [STAGE.BACK]: 'Good. Now bring her home. Back to the yard you came out of — the same road will do it.',
  [STAGE.PARK]: "Line her up and set the brakes. That's the test.",
};
const STAGE_NAME = {
  [STAGE.KEY]: 'THE KEY', [STAGE.OUT]: 'PULLING OUT', [STAGE.RUN]: 'ON THE ROAD',
  [STAGE.BACK]: 'COMING BACK', [STAGE.PARK]: 'PARKING HER',
};
const STAGE_TOTAL = 5;

// pid → ride. Transient by design: the flag is the only durable result, and a logout ends the
// lesson rather than parking it, exactly as a dropped connection ends a checkride.
const rides = new Map();
export const hasRoadTest = (pid) => rides.has(pid);
export const roadTestState = (pid) => rides.get(pid) || null;

// ── THE LICENCE ───────────────────────────────────────────────────────────────
// The gate on `drive`, and the mirror of flight's `isPilotLicensed` — same shape, same one flag,
// same admin exemption. Two things are load-bearing about how it answers:
//
//  ⚠ ANYBODY WHO ALREADY OWNS A TRUCK IS GRANDFATHERED, ON THE SPOT AND SILENTLY. A gate added to a
//    verb that has been open for months is a gate that CONFISCATES: every driver who bought a rig
//    before today would come back to a yard, type `drive`, and be told to go and learn. So owning
//    one IS the licence — you demonstrably drive — and the flag is written the first time we ask,
//    which converges without a one-shot script and costs one cold query on a path that already
//    reads the fleet.
//  ⚠ AND THE ROAD TEST ITSELF IS EXEMPT, because it mounts through this very verb. The school rig
//    is how you get the licence; refusing it for want of one is the door locked from the inside.
export async function isLicensedDriver(player, { fleetOf } = {}) {
  if (!player) return false;
  if (['admin', 'dev'].includes(player.role)) return true;
  if (rides.has(player.id)) return true;
  const v = await getFlag('player', LICENSE_FLAG, player).catch(() => null);
  if (v === '1' || v === 1 || v === true) return true;
  if (fleetOf) {
    const mine = await fleetOf(player.id).catch(() => []);
    if (mine.length) { await setFlag('player', LICENSE_FLAG, '1', player).catch(() => {}); return true; }
  }
  return false;
}

// The refusal. It names the way through and nothing else — a gate that blocks without naming its
// own escape hatch is a bug with prose on it, which is the rule the move gate two files over is
// written to.
export const unlicensedLine = () => ({
  type: 'emote',
  message: '<span class="text-amber">You get as far as the door handle before somebody asks, without any particular malice, '
    + 'whether you have ever driven one. Nobody in a freight yard hands over forty tonnes on trust.</span>'
    + '\n<span class="text-dim">The lesson is free and the rig is theirs: ' + teachVerb('roadtest', 'roadtest')
    + '. Take it out, bring it back, park it, and the licence is yours.</span>',
});

function tell(pid, msg) { sendToPlayer(pid, { type: 'emote', message: msg }); }

function brief(pid, ride) {
  const step = ride.stage === STAGE.PARK
    ? ' ' + teachVerb('park', 'park') + ' when she is standing still.'
    : '';
  tell(pid, '<span class="text-green">[ROAD TEST ' + (ride.stage + 1) + '/' + STAGE_TOTAL + ' — '
    + STAGE_NAME[ride.stage] + ']</span> <span class="text-dim">' + INSTRUCTIONS[ride.stage] + step + '</span>');
}

function advance(pid, ride, stage) {
  ride.stage = stage;
  brief(pid, ride);
}

// ── The evaluator ─────────────────────────────────────────────────────────────
// Called from BOTH ticks — the cab's telemetry handler and the text drive's step — and cheap enough
// to be on either: a Map lookup, and for a live ride two subtractions. It never awaits, so neither
// hot path grows a round trip (docs/architecture.md, read tiers).
export function roadTestTick(player, rig) {
  const ride = rides.get(player?.id);
  if (!ride || !rig) return;
  // Driving off the rim is not part of the lesson, and the corridor's coordinates are not world
  // tiles anyway — a distance measured across the two grids would be a number about nothing.
  if (rig.leg !== 'city') return;
  const dist = Math.hypot((rig.x ?? 0) - ride.ox, (rig.y ?? 0) - ride.oy);
  ride.far = Math.max(ride.far, dist);

  if (ride.stage === STAGE.KEY) {
    if (!rig.engineOn) return;
    advance(player.id, ride, STAGE.OUT);
    return;
  }
  if (ride.stage === STAGE.OUT) {
    if (dist < OUT_TILES) return;
    advance(player.id, ride, STAGE.RUN);
    return;
  }
  if (ride.stage === STAGE.RUN) {
    if (dist < RUN_TILES) return;
    advance(player.id, ride, STAGE.BACK);
    return;
  }
  if (ride.stage === STAGE.BACK) {
    if (dist > BACK_TILES) return;
    advance(player.id, ride, STAGE.PARK);
  }
}

// ── Parking, which is the last stage and the only judgement ───────────────────
// Called from parkRig BEFORE it dismounts, so the ride can read where the truck actually stopped.
export async function roadTestPark(player, rig) {
  const ride = rides.get(player?.id);
  if (!ride) return false;
  const dist = Math.hypot((rig?.x ?? 0) - ride.ox, (rig?.y ?? 0) - ride.oy);

  // Parked short of the yard. Not a failure — a driver who stops for a look is doing nothing wrong —
  // but the lesson is over, because the school rig goes back in the shed at the end of the day.
  if (ride.stage !== STAGE.PARK || dist > BACK_TILES) {
    rides.delete(player.id);
    tell(player.id, '<span class="text-amber">You climb down short of the yard, and that\'s the lesson over. '
      + 'No harm in it — the rig goes back, and you can take it out again whenever you like.</span>'
      + '\n<span class="text-dim">' + teachVerb('roadtest', 'roadtest') + ' at any depot to start over.</span>');
    await sweepLoaner(ride);
    return true;
  }

  rides.delete(player.id);
  await pass(player, ride);
  await sweepLoaner(ride);
  return true;
}

async function pass(player, ride) {
  await setFlag('player', LICENSE_FLAG, '1', player).catch(() => {});
  player.credits = (player.credits || 0) + PURSE;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  // The dents ARE the report card, and they are the only mark anybody gives you: a first lesson with
  // nothing bent is worth saying out loud, and one with a mirror missing is worth not making a fuss
  // about. ⚠ Deliberately NOT a grade: flight can fail a landing because a bad one is a crater, and
  // the equivalent here — parking badly — is a thing every driver in the world does daily. Bringing
  // it back IS the pass, and the corners are a remark.
  tell(player.id, '<span class="item-grant">★ ROAD TEST PASSED — you\'re licensed to drive, and ' + PURSE + '₵ for the day.</span>'
    + '\n<span class="text-dim">' + (ride.hit
      ? 'You brought it back with the corners rearranged, which the fitters will mention for a fortnight. It still came back.'
      : "Nothing bent, nothing scraped. They won't say so, but that's unusual.")
    + ' Buy your own in the ' + teachVerb('yard', 'yard') + ', read the board with ' + teachVerb('haul', 'haul')
    + ', and see what a town is paying with ' + teachVerb('market', 'market') + '.</span>');
}

// The loaner, gone. Never `sellTruck` — nobody bought it, and a school rig has no resale to pay
// anybody with; it is a row that existed for one lesson. The `custom_data` test is belt and braces:
// this id came out of a ride, and no ride ever holds an id it did not create.
async function sweepLoaner(ride) {
  if (!ride?.truckId) return;
  await query("DELETE FROM trucks WHERE id = $1 AND custom_data->>'roadtest' IS NOT NULL", [ride.truckId]).catch(() => {});
}

// ── Starting one ──────────────────────────────────────────────────────────────
// `depotHere` and `mount` are index.js's own helpers, handed in rather than imported, so this file
// never reaches back into the 3,000-line module that calls it.
export async function beginRoadTest(player, { depotHere, mount, isDriving }) {
  if (rides.has(player.id)) {
    return { type: 'emote', message: "You're on one. Get back in the school rig and finish it." };
  }
  const { depot, yard } = depotHere(player);
  if (!depot) return { type: 'emote', message: 'The lessons run out of the freight yards. Find a depot and ask there.' };
  if (!depot.yard || yard?.grid_x == null) {
    return { type: 'emote', message: 'Nobody can get the school rig out of this yard today.' };
  }

  const truck = await buyTruck(player.id, SCHOOL_TYPE, depot.yard, 'SCHOOL RIG');
  await query("UPDATE trucks SET custom_data = jsonb_build_object('roadtest', $2::text) WHERE id = $1",
    [truck.id, player.id]).catch(() => {});

  const ride = { pid: player.id, truckId: truck.id, stage: STAGE.KEY, ox: yard.grid_x, oy: yard.grid_y, far: 0, hit: false };
  rides.set(player.id, ride);

  tell(player.id, '<span class="text-green">The yard foreman looks you over, decides against saying whatever it was, '
    + 'and walks you out to a Vachon Drayman with SCHOOL painted down both doors in a hand that gave up halfway. '
    + '"Nothing on the back, nothing in it, and nothing of yours to lose. Take it out, bring it back, park it. '
    + 'I will tell you what to do as you go."</span>');

  // The ordinary mount, by id. Everything the lesson is about — the roller door, the cold engine,
  // the gearbox, the rung you drive on — is whatever `drive` already does, because a lesson that
  // taught a special case would be teaching the wrong truck.
  const res = await mount(player, truck.id);
  if (res && res.type !== 'noop') sendToPlayer(player.id, res);
  // ⚠ WHETHER IT WORKED IS ASKED OF THE WORLD, NEVER OF THE REPLY. `drive` refuses in prose — no
  // road out of this yard, a rig already under you — and every one of those refusals is the same
  // shape as its success line, so reading the message would be guessing. `isDriving` is the fact.
  if (!isDriving(player.id)) {
    abortRoadTest(player.id, null);
    return { type: 'noop' };
  }
  brief(player.id, ride);
  return { type: 'noop' };
}

// The verb. Deliberately does nothing clever when you have already passed — a driver who wants the
// lesson again gets the lesson again, because the only thing it costs anybody is the foreman's time.
export async function cmdRoadTest(args, raw, player, deps) {
  return beginRoadTest(player, deps);
}

// ── Endings that are not a park ───────────────────────────────────────────────
// A wreck, a logout, a death. All three end the lesson the way flight ends a balled-up checkride:
// no bill, no scolding, come back and take it again.
export function abortRoadTest(pid, line) {
  const ride = rides.get(pid);
  if (!ride) return;
  rides.delete(pid);
  if (line) tell(pid, line);
  sweepLoaner(ride).catch(() => {});
}

// A bent school rig is not a failure, it is the thing lessons are FOR — but it is remembered, and it
// is what the pass line reads to decide whether to mention the corners.
export function roadTestImpact(pid) {
  const ride = rides.get(pid);
  if (ride) ride.hit = true;
}

on('player.logout', ({ id }) => abortRoadTest(id, null));
on('player.death', ({ player }) => {
  const id = player?.id;
  if (id && rides.has(id)) abortRoadTest(id,
    '<span class="text-amber">Whatever just happened to you, it happened halfway through a driving lesson. The rig goes back.</span>');
});

// ⚠ AND THE STALE ONES. A ride is RAM, so a server that goes down mid-lesson leaves a school rig
// standing in a yard owned by somebody who never bought it — it would show on their fleet tab, be
// drivable, and be sellable at 55% of a Drayman. One statement at boot, on a key no other row in
// the table sets.
query("DELETE FROM trucks WHERE custom_data->>'roadtest' IS NOT NULL").catch(() => {});

export const _test = { STAGE, STAGE_TOTAL, rides, OUT_TILES, RUN_TILES, BACK_TILES, INSTRUCTIONS, LICENSE_FLAG };
