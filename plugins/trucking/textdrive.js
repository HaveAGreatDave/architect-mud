// THE LONG HAUL — driving by text.
//
// The accessibility half. The cab is a surface you ACT through: delete it and the player is not
// merely reading less, they are STUCK — they cannot drive at all. Per docs/systems-display-mode.md
// that puts it on the `prefersTextMinigames` axis, and it means a player on the `textgames` or
// `log` rung needs a real way to make the run, not a shorter description of somebody else making it.
//
// The pattern is lifted from plugins/flight/textpilot.js, and so is the principle that makes it
// cheap: `flight-model.js` is a pure, DOM-free module, so `stepTruck` runs here exactly as it runs
// in the browser. There is no second physics.
//
// ASSISTED, NOT RAW — and more so than flight. A text pilot still sets intent (`climb to 3000`),
// because an aircraft has somewhere to be in three dimensions. A truck on a road does not: the
// route IS the road, and hand-steering a corridor by typed command would be busywork dressed as
// agency. So the text driver DRIVES ITSELF along the road, and the player's decisions are the ones
// that were always the real ones — which load, when to stop, when to fuel, and what to do about
// whatever just walked out of the haze.
//
// EVERY TRANSITION IS THE SHARED ONE. This module owns narration and a clock. Node crossings go
// through `crossToNode`, city tiles through `driveToZone`, the rim through the caller's
// `leaveTheMap`, arrival through `arrive` — so encounters, ghost-traces, teardown, delivery and
// payment behave identically whichever rung you are on. If that stops being true, the two rungs
// have become two games.

import { schedule } from '../../server/engine/scheduler.js';
import { getZone, getLivePlayer } from '../../server/engine/world.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { findPath } from '../../server/engine/pathfinding.js';
import { rigs, driveToZone, crossToNode, surfaceUnder, announceBreak, cbLine, passSign,
  tryDoorBoard, doorBoardLine } from './state.js';
import { TILES_PER_ROOM, nodeAt } from './corridor.js';
import { afterDrive } from './scale.js';
import { hitcherAt } from './hitchers.js';
import { wearFor, breakdownRoll } from './rig.js';
import { createTruckState, step, truckReadout, truckShift, truckSplit } from '../../client/game/js/panels/flight-model.js';

// One tile of city road, or one slice of corridor, per tick. 2s is deliberately unhurried: the
// point of a long haul is that it takes a while, and a text player should be able to read the road
// going by rather than scroll it.
const TICK = '2s';
const TICK_S = 2;
const CORRIDOR_TILES_PER_TICK = 26;      // ≈ a 90-tile room every 7 ticks — about the same wall-clock
                                          // as the graphical cab covers a room in, so neither rung
                                          // is a faster way to make money than the other.

// ── The box, by typed command ────────────────────────────────────────────────
// Phase 2.5. The rung used to be paced travel: the server drove and you said when to stop, so the
// entire gearbox — the one system in this game you are meant to drive by EAR — was a thing a
// text-rung player could not touch. That is the axis's whole test failing: delete the cab and they
// were not reading less, they were playing a shorter game.
//
// THE RULE THAT SHAPES IT: every command here must be one a visual driver's keystroke also sends.
// `revs up` is the `.` key. `jake` is the C key. So there is ONE model with two input surfaces
// rather than two games, and the same `stepTruck` decides what happens either way.
//
// WHAT IS DELIBERATELY NOT HERE: steering, and therefore the trailer. Holding a line needs a
// continuous input, and a typed `left a bit` is not one — it would be a chore wearing agency's
// clothes. So a text driver runs on the auto-steer that already exists, and nothing a haul is
// GATED on requires the half they cannot reach.
const THROTTLE = { throttle: 1, cruise: 0.55, coast: 0, brake: 0 };

// One tick of real physics, at the real tick length, returning the tiles covered. The distance is
// DERIVED from the sim rather than being a constant with a gear-shaped modifier bolted on, which is
// the only reason picking the wrong gear can cost a text driver anything.
function drivePhysics(rig, run) {
  const p = rig.type || {};
  if (!p.ground || !run.sim) return CORRIDOR_TILES_PER_TICK;
  const input = {
    steer: 0, surface: 'road',
    throttle: THROTTLE[run.mode] ?? THROTTLE.cruise,
    brake: run.mode === 'brake' ? 1 : 0,
    jake: run.jake ? 1 : 0,
    starter: 1,                          // a text driver restarts a stall by driving on; the visual
                                         // rung holds a key, and neither is a decision worth making
  };
  let tiles = 0;
  for (let i = 0; i < TICK_S * 20; i++) {              // 20 Hz is plenty for a 2s tick
    step(run.sim, input, p, 1 / 20);
    tiles += (run.sim.speed / p.tileMph) * (1 / 20);
  }
  return Math.max(0, tiles);
}

// What the tick SAYS. A visual driver reads the band off a needle and hears it in the engine; a
// text driver has to be told, and told the same thing — which gear, whether it is pulling, and
// whether the brakes have had enough. Anything the cab shows and this does not is a rung that is
// not finished.
function boxLine(run, p) {
  if (!run.sim || !p?.ground) return '';
  const r = truckReadout(run.sim, p);
  const bits = [`<b>${r.stalled ? 'STALLED' : r.gear === 0 ? 'neutral' : `gear ${r.gear}`}</b>`];
  if (!r.stalled) bits.push(r.inBand ? '<span class="text-green">pulling</span>'
    : r.rpm < p.band[0] * 100 ? '<span class="text-amber">lugging</span>'
    : '<span class="text-amber">screaming</span>');
  bits.push(`${Math.round(run.sim.speed)} mph`);
  if (r.fading) bits.push('<span class="text-red">brakes fading</span>');
  else if (r.brakeTemp > 0.42) bits.push('<span class="text-amber">brakes hot</span>');
  if (r.best !== r.gear && !r.stalled) bits.push(`<span class="text-dim">(${r.best} would hold it)</span>`);
  return bits.join(' · ');
}

// The verbs. Each returns prose; none of them touches the world, because the tick does that.
export function textDriveCommand(pid, what, arg) {
  const run = runs.get(pid);
  const rig = rigs.get(pid);
  if (!run || !rig?.type?.ground || !run.sim) return null;      // not a text run — the caller falls through
  const p = rig.type;
  const say = (m) => ({ type: 'emote', message: m });
  if (what === 'gear') {
    const a = String(arg || '').toLowerCase();
    if (a === 'up' || a === '+') truckShift(run.sim, p, 1);
    else if (a === 'down' || a === '-') truckShift(run.sim, p, -1);
    else if (a === 'split') truckSplit(run.sim, p);
    else if (/^\d+$/.test(a)) truckShift(run.sim, p, parseInt(a, 10) - (run.sim.gear || 0));
    else if (a === 'n' || a === 'neutral') truckShift(run.sim, p, -(run.sim.gear || 0));
    else return say(`The box has ${p.gears.length - 1} forward gears. <span class="text-dim">revs up · revs down · revs 4 · revs split · revs neutral</span>`);
    return say(`You go for it. ${boxLine(run, p)}`);
  }
  if (what === 'jake') {
    run.jake = !run.jake;
    return say(run.jake
      ? 'You drop the Jake in. The engine starts making that hard flat bark that carries for a mile.'
      : 'Jake off. The noise stops and the truck goes quiet again.');
  }
  if (THROTTLE[what] !== undefined || what === 'brake') {
    run.mode = what;
    const line = { throttle: 'Boot down.', cruise: 'You settle it at a working pace.', coast: 'Off the throttle.', brake: 'On the brakes.' }[what];
    return say(`${line} ${boxLine(run, p)}`);
  }
  return null;
}

// Flavour, in the shape a zone authors `ambient_events`. None of these carry a number the player
// would have to trust — the readouts are separate and explicit.
const ROAD_LINES = [
  'The road unrolls. Grit ticks against the underside of the cab.',
  'Something dead by the shoulder, too far gone to name. It goes by.',
  'The engine settles into its note and holds it.',
  'Heat-shimmer stands on the hardtop ahead and never gets closer.',
  'A wind comes across the flat and leans on the trailer for a while.',
  'Mile markers, if that is what they are. Nobody has repainted them.',
];
const CITY_LINES = [
  'A junction, a dead signal, nobody coming the other way.',
  'The tyres change note over a stretch of bad surface.',
  'Somebody has spray-canned a arrow on a wall. It points at nothing.',
  'A shutter comes down as you pass. Not for you, probably.',
];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// Everything distance costs, in one place, because a rung that skips one of them is a way to opt
// out of a constraint the other rung obeys — which is exactly what the display-mode contract says
// a rung must never be. Fuel off the TRUCK's own tank, wear off the same `wearFor` the driven leg
// uses, and the same breakdown roll. It sets the same `dry`/`broken` flags reconcileTruck does, so
// both rungs stop for the same reasons and `fix` is one verb rather than two.
function burn(rig, tiles) {
  const was = rig.fuel;
  rig.fuel = Math.max(0, rig.fuel - tiles / (rig.type?.tank || 1400));
  rig.travelled = (rig.travelled || 0) + tiles;
  if (was > 0 && rig.fuel <= 0) rig.dry = true;
  const surface = surfaceUnder(rig);
  rig.condition = Math.max(0, (rig.condition ?? 1)
    - wearFor(tiles, { surface, tune: rig.cd?.tune || {}, condition: rig.condition ?? 1 }));
  if (rig.fixGrace > 0) rig.fixGrace = Math.max(0, rig.fixGrace - tiles);
  if (!rig.broken && !rig.fixGrace) {
    const kind = breakdownRoll(tiles, { condition: rig.condition ?? 1, surface });
    if (kind) rig.broken = { kind, attempts: 0, told: false };
  }
}

// Live text runs, keyed by player id. RAM only, like the rig itself.
const runs = new Map();
export const isTextDriving = (pid) => runs.has(pid);

// Start a text run. `hooks` carries the two transitions this module must not own copies of.
export function startTextDrive(player, rig, hooks) {
  // A REAL truck state, not a counter. Same struct the browser makes, so the same physics runs on
  // both rungs and the gearbox is a thing a text driver can get wrong.
  runs.set(player.id, {
    pid: player.id, hooks, path: null, step: 0, since: 0,
    sim: rig.type?.ground ? createTruckState(rig.type) : null,
    mode: 'cruise', jake: false,
  });
  narrate(player, '<span class="text-green">You pull out of the yard. The road ahead is yours and the clock is running.</span>');
  return true;
}
export function stopTextDrive(pid) { runs.delete(pid); }

function narrate(player, msg) { sendToPlayer(player.id, { type: 'emote', message: msg }); }

// The city leg drives a ROUTE rather than a heading: a road path from where the rig is to wherever
// it is going, over `findPath`'s existing roads-only mode. That is the assisted half — a text
// driver does not hand-steer a street grid, and asking them to would be busywork.
function ensurePath(rig, run) {
  if (run.path && run.step < run.path.length) return run.path;
  const from = rig.zoneId;
  const to = run.target;
  if (!from || !to) return null;
  run.path = findPath(from, to, { roads: true, maxDistance: 400 }) || findPath(from, to, { maxDistance: 400 });
  run.step = 1;                                     // [0] is where we already are
  return run.path;
}

async function tick() {
  for (const [pid, run] of [...runs]) {
    const player = getLivePlayer(pid);
    const rig = rigs.get(pid);
    if (!player || !rig) { runs.delete(pid); continue; }
    try { await stepRun(player, rig, run); }
    catch (e) { console.error('[trucking] text drive error:', e.message); runs.delete(pid); }
  }
}

async function stepRun(player, rig, run) {
  // A fight stops the truck. You cannot drive away from something that is already on you, and a
  // text player who is mid-combat must not have the road narrating over the top of it.
  if (player.inCombat || player.combatTarget) return;

  // Out of diesel stops a text run exactly as it stops a driven one — the rung must not be a way
  // to ignore a constraint the other rung obeys.
  if (rig.dry) {
    if (!run.driedTold) {
      run.driedTold = true;
      narrate(player, '<span class="text-amber">The engine coughs, catches once out of spite, and dies. The gauge has been on the pin for a while. Wherever this is, this is where you are.</span>');
    }
    return;
  }
  // Broken down stops a text run the same way, and through the SAME announcement — the prose and
  // the `fix` prompt live in index.js so the two rungs cannot drift into telling different stories
  // about the same failure.
  if (rig.broken) { announceBreak(player, rig); return; }

  if (rig.leg === 'corridor') {
    const covered = drivePhysics(rig, run);
    rig.s = Math.min(rig.route.L, rig.s + covered);
    rig.speed = Math.round(run.sim?.speed || 0);
    burn(rig, covered);
    // The boards, read out. Swept rather than proximity-tested (see signsBetween) precisely because
    // a text tick covers far more road than a cab frame does, so "near a sign" would step over most
    // of them — and a rung that cannot read the only source of distances out here is a rung with a
    // hole in it.
    passSign(player, rig);
    const node = nodeAt(rig.route, rig.s, rig.chain.length);
    if (rig.s >= rig.route.L - 1) { await run.hooks.arrive(player, rig); return; }
    if (node !== rig.node) {
      const zone = await crossToNode(player, rig, node);
      if (zone) narrate(player, `<span class="text-dim">— ${zone.name} —</span> <span class="text-dim">${rig.chain.length - node - 1} to go.</span>`);
      // The radio is a rung-neutral thing: it says the same lines, on the same node crossings, in
      // whichever cab you are sitting in. A text driver who could not hear a wreck reported ahead
      // would be missing information the other rung gets, which is the one thing a rung may not do.
      cbLine(player, rig);
      // The same figure on the same shoulder. One law, both rungs — `hitcherAt` is a pure function
      // of the route and the node, so there is nothing here to keep in step.
      const who = rig.hitchDone?.has(node) ? null : hitcherAt(rig.route, node, rig.chain.length);
      if (who && !rig.rider) {
        narrate(player, `<span class="text-amber">Ahead on the shoulder: ${who.look}. A hand comes up.</span> <span class="text-dim"><b>pickup</b> if you are stopping.</span>`);
      }
      return;
    }
    // ── SOMEBODY TRIES THE DOOR ──────────────────────────────────────────────
    // ⚠ OUTSIDE THE NODE-CROSSING BRANCH, and that placement is the point: the event is about
    // standing still, and a rig that is standing still crosses no boundary. Inside the branch above
    // this would be unreachable by construction — which is exactly how a rung quietly becomes a
    // different game. The law itself is 'tryDoorBoard' in state.js, shared with the cab.
    {
      const near = rig.hitchDone?.has(node) ? null : hitcherAt(rig.route, node, rig.chain.length);
      const got = tryDoorBoard(rig, near);
      if (got) { narrate(player, doorBoardLine(got)); return; }
    }
    if (++run.since % 2 === 0) narrate(player, `<span class="text-dim">${pick(ROAD_LINES)}</span>`);
    return;
  }

  // City leg: walk the road path one tile a tick.
  const path = ensurePath(rig, run);
  if (!path || path.length < 2) {
    // No road route to the target. If the target is out of the region entirely, the way there is
    // off the rim — hand to the shared transition rather than inventing a second one.
    if (run.wantsRim) return void await run.hooks.leaveTheMap(player, rig);
    narrate(player, '<span class="text-amber">No road goes that way from here. You sit with the engine running.</span>');
    runs.delete(player.id);
    return;
  }
  const next = path[run.step];
  if (!next) {
    if (run.wantsRim) return void await run.hooks.leaveTheMap(player, rig);
    narrate(player, '<span class="text-green">You roll in through the gate and set the brake.</span>');
    runs.delete(player.id);
    return;
  }
  run.step++;
  const z = getZone(next);
  if (z?.grid_x != null) { rig.x = z.grid_x; rig.y = z.grid_y; }
  burn(rig, 1);
  const zone = driveToZone(player, rig, next);
  await afterDrive(player, rig, zone);      // the same weighbridge — one law, both rungs
  if (zone && run.since++ % 3 === 0) narrate(player, `<span class="text-dim">${zone.name}. ${pick(CITY_LINES)}</span>`);
}

// Where a text run is headed. Set before the first tick; the rim case is the interesting one,
// because "drive to the Reach" means "drive to the edge of the world and keep going".
export function setTextTarget(pid, { target, wantsRim = false }) {
  const run = runs.get(pid);
  if (!run) return;
  run.target = target; run.wantsRim = wantsRim; run.path = null; run.step = 0;
}

schedule(TICK, () => tick().catch(e => console.error('[trucking] text tick error:', e.message)));
