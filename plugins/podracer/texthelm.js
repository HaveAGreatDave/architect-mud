// THE SCARLETWASTES, BY TEXT.
//
// The racer's helm for the two text rungs of the Display Mode ladder (docs/systems-display-mode.md).
// The seat is a surface you act through: take it away and you can't move the racer at all, so the
// rung is read with `prefersTextMinigames`, and a text-rung player gets a real way to race rather
// than a description of somebody else racing.
//
// ONE MODEL. podracer-model.js is pure, so `stepPodracer` runs here at the seat's own frame rate
// (1/60 s calls, each made of the model's fixed 1/240 s sub-steps), fed the same lever and vane
// shaping the seat's keys get, the same fuel burn (`podracerBurn`), and the same solid ground and
// surfaces the seat reads off its map window. What comes out goes through the seat's own functions:
// a torn binder is `breakdownRacer`, a pod beaten to nothing is `wreckRacer`, climbing out is
// `parkRacer`, the row is `flushRig`, and the live racer is written to `rigs`, so everybody else
// sees a text racer the way they see any other. An accessibility path may change the interface,
// never the odds.
//
// ORDERS, NOT KEYS. A held key can't be typed, so this takes the powerboat's shape
// (plugins/powerboat/texthelm.js): you give a heading and a thrust and the tick holds them. The
// vanes are flown to the ordered heading through the same input the A and D keys drive, so a hard
// order at speed is a hard turn, exactly as holding D is. The slide is armed for the next turn and
// let go when the turn is done, which is when the whip fires on the seat too.
//
// EYES. The seat shows you the rock. Here the tick looks along the line of travel and says how far
// off the nearest solid thing is once it's close enough to matter, and `pod look` names what is
// round you. Nothing steers round it for you.
//
// The two rungs differ only in pace. `log` gets the status line when it has changed, slowly enough
// for a screen reader to keep up; `textgames` gets it every few seconds while moving. Events (a hit,
// a snap, the binder) reach both at once.

import { schedule } from '../../server/engine/scheduler.js';
import { getLivePlayer } from '../../server/engine/world.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { surfaceAt, deriveSurfaceCell } from '../flight/state.js';
import { PODRACER_TYPES, CRANK_S, createPodracerState, stepPodracer, placePodracer, tornBinder, mendBinder,
  podracerParts, podracerBurn } from '../../client/game/js/panels/podracer-model.js';
import { rowEng, rowCables, rowBinder, racerLiveryOf } from './lot.js';
// A cycle with index.js and seat.js, safe because everything taken from them is only read inside
// function bodies.
import { rigs, seated } from './index.js';
import { flushRig, breakdownRacer, wreckRacer, parkRacer, bayLotAt, bayDoors, cmdPodEvent, groundFor, trackRacer } from './seat.js';

const TICK = '1s';
const STEP = 1 / 60;               // the seat's frame
const MAX_DT = 3;                  // a stalled server does not fast-forward the race
const FLUSH_MS = 10_000;
// The seat's input shaping (podracer-view.js): lever travel a second, the vanes swinging over and
// back, and what a full turn takes off the inside turbine. Keys there, orders here, the same numbers.
const LEVER_UP = 2.2, LEVER_DOWN = 1.8, SPLIT_RATE = 5, SPLIT_BACK = 9, INNER_CUT = 0.25;
// Degrees off the ordered heading at which the vanes are hard over. Inside it they ease off in
// proportion, so the turbines settle on the heading instead of swinging through it.
const STEER_DEG = 15;
const SLIDE_DEG = 8;               // an armed slide is held while the turn has further than this to go
const STILL_MPH = 3;               // reverse engages under this, as the seat's does at a standstill
const STOP_MPH = 2;                // the air brakes let go under this: the seat's standstill (REV_STILL_MPH)
const BAY_STOP_MPH = 3;            // seat.js: stopped in the shed door
export const THRUST = { idle: 0, slow: 0.3, half: 0.55, cruise: 0.75, full: 1 };
const THRUST_WORDS = Object.keys(THRUST);
// How far ahead the tick looks, and when it speaks: under WARN_S seconds from the nearest solid
// thing at the speed you're doing, or under WARN_TILES at any speed.
const LOOK_TILES = 14, WARN_S = 3, WARN_TILES = 2.5, WARN_EVERY_MS = 2000;
// The status line's clock, per rung, in seconds: moving, then stopped.
const PACE = { log: [10, 45], textgames: [3, 20] };

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clamp01 = (v) => clamp(Number(v ?? 1), 0, 1);
const norm = (d) => ((d % 360) + 360) % 360;
const wrap180 = (d) => ((d % 360) + 540) % 360 - 180;
const pct = (v) => Math.round(clamp01(v) * 100) + '%';
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const compass = (d) => COMPASS[Math.round(norm(d) / 45) % 8];
const hdg = (d) => `${Math.round(norm(d)) % 360} (${compass(d)})`;
const BEARING_WORDS = { north: 0, n: 0, northeast: 45, ne: 45, east: 90, e: 90, southeast: 135, se: 135,
  south: 180, s: 180, southwest: 225, sw: 225, west: 270, w: 270, northwest: 315, nw: 315 };
const tiles = (d) => (d < 1 ? 'under a tile' : `${Math.round(d)} tile${Math.round(d) === 1 ? '' : 's'}`);

/** Every racer being driven by text, by player id. RAM only, like `rigs`. */
export const runs = new Map();
export const isTextRacing = (pid) => runs.has(pid);

// ── The ground ─────────────────────────────────────────────────────────────────
//
// What the seat's map window says, tile by tile, through the flight sim's own derivation: the
// seat's `solid()` (no ground, high ground, any building but a bay door) and the leg's ground
// provider (seat.js groundFor): the placed world in a region, the highway and its verge on the
// corridor. The placed world is content, so those tiles are kept until the cache is cleared, which a
// new run does when nobody else is racing by text; a road's cells are synthesised and not cached.
const _cells = new Map();
function cellAt(x, y, at = surfaceAt) {
  const gx = Math.round(x), gy = Math.round(y), k = gx + ',' + gy;
  if (at !== surfaceAt) {
    const z = at(gx, gy);
    return z ? deriveSurfaceCell(z, gx, gy, at) : { kind: 'air' };
  }
  let c = _cells.get(k);
  if (c === undefined) {
    const z = surfaceAt(gx, gy);
    c = z ? deriveSurfaceCell(z, gx, gy) : { kind: 'air' };
    if (_cells.size > 20000) _cells.clear();
    _cells.set(k, c);
  }
  return c;
}
export function solidAt(x, y, at = surfaceAt) {
  const c = cellAt(x, y, at);
  return c.kind === 'air' || !!c.hi || (!!c.bt && c.mark !== 'bay');
}
export function groundAt(x, y, at = surfaceAt) {
  const c = cellAt(x, y, at);
  if (c.biome === 'water' || c.sub) return 'water';
  if (c.road || c.ft === 'dust') return 'road';
  return 'redrock';
}
function solidName(x, y, at = surfaceAt) {
  const c = cellAt(x, y, at);
  if (c.kind === 'air') return 'the edge of the waste';
  if (c.hi) return 'rock';
  return c.bn || 'a building';
}

/** The nearest solid thing along `deg` from (x, y), as { d, what }, or null inside `max` tiles. */
export function clearAhead(x, y, deg, max = LOOK_TILES, at = surfaceAt) {
  const fx = Math.sin(deg * D2R), fy = -Math.cos(deg * D2R);
  for (let d = 0.25; d <= max; d += 0.25) {
    if (solidAt(x + fx * d, y + fy * d, at)) return { d, what: solidName(x + fx * d, y + fy * d, at) };
  }
  return null;
}

// ── A run ──────────────────────────────────────────────────────────────────────

const pairHeading = (s) => norm(Math.atan2(Math.sin(s.eng[0].a) + Math.sin(s.eng[1].a), Math.cos(s.eng[0].a) + Math.cos(s.eng[1].a)) * R2D);
// Which way it is actually going: along its way when it has some, else where the turbines point.
const travelHeading = (s) => (s.speed > 10 ? norm(Math.atan2(s.pod.vx, -s.pod.vy) * R2D) : pairHeading(s));

/** The racer as the seat would bring it out (podracer-view.js openPodracer), cold, from its row. */
// `ground` replaces the world's solid and surface tests, for the regress suite's open flat.
export function makeRun(row, at, { pid = null, rung = 'textgames', ground = null } = {}) {
  const p = PODRACER_TYPES[row.type_id] || PODRACER_TYPES.podracer;
  const s = createPodracerState(p);
  s.engHp = rowEng(row);
  rowCables(row).forEach((ok, i) => { if (!ok) s.cable[i].ok = false; });
  s.hull = clamp01(row.condition);
  placePodracer(s, p, at.x, at.y, at.heading ?? 0);
  if (!rowBinder(row)) tornBinder(s, p);
  return {
    pid, racerId: row.id, typeId: row.type_id || 'podracer', p, s,
    rigName: row.name || 'racer', name: row.name || p.name,
    livery: racerLiveryOf(row), rung: rung === 'log' ? 'log' : 'textgames', ground,
    // The ground provider for this run's leg, set by the tick from the live racer (seat.js groundFor).
    at: surfaceAt,
    fuel: clamp01(row.fuel),
    want: { thrust: 0, bearing: null, brake: false, reverse: false, boost: false, slide: false, dock: false },
    lever: [0, 0], split: 0, crank: 0, sliding: false,
    last: Date.now(), sinceSay: 0, said: {}, warnAt: 0, lastLine: '',
  };
}

// One frame's input, as the seat's `readInput` builds it from keys, built from the standing orders.
function inputFor(run, h) {
  const { s, p, want } = run;
  const fwd = (s.pod.vx * Math.sin(s.pod.a) - s.pod.vy * Math.cos(s.pod.a)) * p.tileMph;
  // Reverse lets go once it is going forward again, or the turbines are out (the seat's rule).
  if (want.reverse && (fwd > STILL_MPH || !s.running)) want.reverse = false;
  // The air brakes are held until it has stopped, then let go, so a standstill does not become reverse.
  if (want.brake) { want.thrust = 0; if (s.speed < STOP_MPH) { want.brake = false; run.stopped = true; } }
  const to = want.reverse ? 0 : want.thrust;
  for (let i = 0; i < 2; i++) run.lever[i] = clamp(run.lever[i] + clamp(to - run.lever[i], -LEVER_DOWN * h, LEVER_UP * h), 0, 1);
  const err = want.bearing == null ? 0 : wrap180(want.bearing - pairHeading(s));
  const target = clamp(err / STEER_DEG, -1, 1);
  const rate = Math.abs(target) < Math.abs(run.split) || Math.sign(target) !== Math.sign(run.split) ? SPLIT_BACK : SPLIT_RATE;
  run.split += clamp(target - run.split, -rate * h, rate * h);
  // The slide, armed for one turn: held while the turn has a way to go, then let go.
  let slide = false;
  if (want.slide) {
    if (Math.abs(err) > SLIDE_DEG) { slide = true; run.sliding = true; }
    else if (run.sliding) { want.slide = false; run.sliding = false; }
  }
  const dockToggle = want.dock;
  want.dock = false;
  if (run.crank > 0) run.crank = Math.max(0, run.crank - h);
  return {
    left: run.lever[0] * (1 - INNER_CUT * Math.max(0, -run.split)),
    right: run.lever[1] * (1 - INNER_CUT * Math.max(0, run.split)),
    steer: run.split,
    brake: want.brake ? 1 : 0,
    reverse: want.reverse ? 1 : 0,
    dockToggle, slide, boost: !!want.boost,
    starter: run.crank > 0 && run.lever[0] < 0.05 && run.lever[1] < 0.05,
    fuel: run.fuel,
    solid: run.ground?.solid || ((x, y) => solidAt(x, y, run.at)),
    surface: run.ground?.surface ? run.ground.surface(s.x, s.y) : groundAt(s.x, s.y, run.at),
  };
}

/**
 * Run the racer on by `dt` seconds of real time, in the seat's frames. Returns the model's events.
 * Pure but for the ground it reads, so the regress suite steps it headless.
 */
export function stepRun(run, dt) {
  const { s, p } = run;
  const out = [];
  let left = clamp(dt, 0, MAX_DT);
  while (left > 1e-9) {
    const h = Math.min(STEP, left);
    left -= h;
    const input = inputFor(run, h);
    // The seat's frame, line for line: a dry tank shuts the levers, a lit racer burns.
    if (run.fuel <= 0) { run.lever = [0, 0]; input.left = input.right = 0; }
    else run.fuel = Math.max(0, run.fuel - podracerBurn(s, p, h));
    stepPodracer(s, input, p, h);
    for (const ev of s.events) {
      out.push(ev);
      if (ev === 'started' || ev === 'dry' || ev === 'nobinder') run.crank = 0;
    }
    // From here the seat's own functions take over, at the speed it was doing when it happened.
    if (s.events.includes('binder') || s.events.includes('wrecked')) break;
  }
  return out;
}

// The live racer, in the record `vehicle.contacts` publishes and the seat's functions read.
function publish(run, now) {
  const { s, p } = run;
  const parts = podracerParts(s, p);
  const rig = Object.assign(rigs.get(run.pid) || { flushed: now }, {
    playerId: run.pid, racerId: run.racerId, typeId: run.typeId, name: run.rigName, livery: run.livery,
    x: +s.x.toFixed(3), y: +s.y.toFixed(3), heading: Math.round(s.heading) % 360, speed: Math.round(s.speed),
    hull: s.hull, eng: [...s.engHp], fuel: run.fuel, lever: [...s.lever],
    cables: s.cable.map((c) => c.ok), binder: s.binder,
    ex: +((parts.L.x + parts.R.x) / 2).toFixed(3), ey: +((parts.L.y + parts.R.y) / 2).toFixed(3),
    eh: Math.round(parts.L.h) % 360, at: now,
  });
  rigs.set(run.pid, rig);
  return rig;
}

// ── Starting and stopping ──────────────────────────────────────────────────────

export function startTextPod(player, row, at, rung) {
  if (!runs.size) _cells.clear();
  const run = makeRun(row, at, { pid: player.id, rung });
  runs.set(player.id, run);
  publish(run, Date.now());
  return run;
}
/** Drop the run. The seat's leaveSeat and dropSeat call this, and they flush the row. */
export function stopTextPod(pid) { return runs.delete(pid); }

/**
 * What the seat sends the client in `podracer_ctx` when the yard puts the racer right or paints it,
 * applied to the text racer, or the next tick would write the old wear back over the repair.
 */
export function textPodCtx(pid, msg) {
  const run = runs.get(pid);
  if (!run) return;
  const { s, p } = run;
  if (msg.hull != null) s.hull = msg.hull;
  if (msg.fuel != null) run.fuel = msg.fuel;
  if (Array.isArray(msg.eng)) s.engHp = msg.eng.slice(0, 2);
  if (Array.isArray(msg.cables)) msg.cables.forEach((ok, i) => { if (ok && s.cable[i]) s.cable[i].ok = true; });
  if ('livery' in msg) run.livery = msg.livery || null;
  if (msg.binder === true && !s.binder) mendBinder(s, p);
  run.said = {};
}

// ── What you're told ───────────────────────────────────────────────────────────

export function statusLine(run) {
  const { s, want } = run;
  const name = `<b>${run.name}</b>`;
  const wear = `Pod ${pct(s.hull)}, turbines ${pct(s.engHp[0])} and ${pct(s.engHp[1])}, fuel ${pct(run.fuel)}`
    + s.cable.map((c, i) => (c.ok ? '' : `, ${i ? 'right' : 'left'} cable gone`)).join('') + '.';
  if (!s.binder) return `${name}: the binder is torn out and nothing will light. ${wear} <b>pod park</b> climbs out; <b>podracer recover</b> sends the flatbed.`;
  if (!s.running) {
    const why = run.crank > 0 ? 'the starters are turning' : run.fuel <= 0 ? 'the tank is dry' : 'the turbines are cold (<b>pod start</b>)';
    return `${name}: ${why}. Heading ${hdg(pairHeading(s))}${s.speed > 2 ? `, rolling at ${Math.round(s.speed)} mph` : ''}. ${wear}`;
  }
  const bits = [`${Math.round(s.speed)} mph`, `heading ${hdg(pairHeading(s))}`];
  if (want.bearing != null && Math.abs(wrap180(want.bearing - pairHeading(s))) > 3) bits.push(`coming round to ${Math.round(want.bearing)}`);
  bits.push(want.reverse ? 'in reverse' : want.brake ? 'air brakes on' : `thrust ${thrustWord(want.thrust)}`);
  bits.push(s.mode === 'launched' ? `launched, binder ${Math.round((s.binderPower || 0) * 100)}%` : s.mode === 'docking' ? 'docking' : 'docked');
  if (s.boosting) bits.push('boosting'); else if (want.boost) bits.push('boost held');
  if (want.slide) bits.push('slide armed');
  const heat = Math.max(...(s.heat || [0, 0]));
  if (heat > 0.5) bits.push(`turbines ${Math.round(heat * 100)}% hot`);
  const ahead = clearAhead(s.x, s.y, travelHeading(s));
  bits.push(ahead ? `${ahead.what} ${tiles(ahead.d)} ahead` : 'clear ahead');
  return `${name}: ${bits.join(', ')}. ${wear}`;
}

function thrustWord(v) {
  const named = Object.entries(THRUST).find(([, t]) => Math.abs(t - v) < 0.005);
  return named ? named[0] : Math.round(v * 100) + '%';
}

/** What is round the racer: the nearest solid thing each of eight ways, and the way to the shed. */
export function lookLine(run) {
  const { s } = run;
  const seen = [];
  for (let i = 0; i < 8; i++) {
    const hit = clearAhead(s.x, s.y, i * 45, 10, run.at);
    if (hit) seen.push(`${hit.what} ${tiles(hit.d)} ${COMPASS[i]}`);
  }
  const open = 8 - seen.length;
  let home = '';
  const doors = bayDoors();
  if (doors.length) {
    const near = doors.reduce((a, b) => (Math.hypot(b.x - s.x, b.y - s.y) < Math.hypot(a.x - s.x, a.y - s.y) ? b : a));
    const d = Math.hypot(near.x - s.x, near.y - s.y);
    const b = norm(Math.atan2(near.x - s.x, -(near.y - s.y)) * R2D);
    home = d < 0.6 ? ' You are in the shed door.' : ` The shed door is ${tiles(d)} away, bearing ${hdg(b)} (<b>pod home</b>).`;
  }
  const ground = { road: 'graded road', water: 'water', redrock: 'red hardpan' }[groundAt(s.x, s.y, run.at)];
  return `Over ${ground}, heading ${hdg(pairHeading(s))}. `
    + (seen.length ? `Within ten tiles: ${seen.join('; ')}.` : 'Nothing solid within ten tiles any way.')
    + (seen.length && open ? ` Open ${open === 1 ? 'one way' : `${open} ways`}.` : '') + home;
}

function hitLine(ev, run) {
  const what = nearSolid(run.s.x, run.s.y, run.at);
  if (ev.part === 'turbines') return `The turbines clash together at ${ev.mph} mph.`;
  if (ev.part === 'pod') return `The pod hits ${what} at ${ev.mph} mph. Pod ${pct(run.s.hull)}.`;
  const i = ev.part === 'right' ? 1 : 0;
  return `The ${ev.part} turbine hits ${what} at ${ev.mph} mph. It is at ${pct(run.s.engHp[i])}.`;
}
function nearSolid(x, y, at = surfaceAt) {
  for (let r = 1; r <= 2; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (solidAt(x + dx * 0.5, y + dy * 0.5, at)) return solidName(x + dx * 0.5, y + dy * 0.5, at);
  }
  return 'something solid';
}

async function tell(live, run, events, dt) {
  const say = (m) => sendToPlayer(run.pid, { type: 'emote', message: m });
  const { s, p } = run;
  // The hardest hit first, once a tick, then everything else in the order it happened.
  const hits = events.filter((e) => e?.type === 'hit' && e.mph > 15);
  if (hits.length) {
    const worst = hits.reduce((a, b) => (b.mph > a.mph ? b : a));
    say(`<span class="text-amber">${hitLine(worst, run)}</span>`);
  }
  for (const ev of events) {
    const t = typeof ev === 'string' ? ev : ev?.type;
    if (t === 'started' || t === 'snap') {
      const r = await cmdPodEvent([t], '', live);
      if (r?.message) say(r.message);
    } else if (t === 'dry') say('<span class="text-red">The starters turn and turn and nothing lights. The tank is dry.</span> <span class="text-dim"><b>podracer recover</b> sends the flatbed.</span>');
    else if (t === 'nobinder') say('Nothing lights. The turbines\' controls run through the binder, and it is torn out.');
    else if (t === 'launch') say('<span class="text-green">You kick the turbines off. They fly out ahead on the cables and the binder comes up.</span>');
    else if (t === 'docking') say('The turbines drop back toward the pod.');
    else if (t === 'docked') say('The pins lock. The turbines are docked alongside.');
    else if (t === 'whip') say(`<span class="text-green">The pod snaps back in on its cables and the turbines kick. Whip ${Math.round(ev.k * 100)}%.</span>`);
    else if (t === 'overheat') say(`<span class="text-red">The ${ev.eng ? 'right' : 'left'} turbine is burning. Come off the boost: <b>pod boost</b>.</span>`);
    else if (t === 'engineout') say(`<span class="text-red">The ${ev.engine ? 'right' : 'left'} turbine is dead.</span>`);
    else if (t === 'cutout') say('<span class="text-red">Both cables are gone, and the turbines cut out with them.</span>');
    else if (t === 'binder') {
      const r = await breakdownRacer(live);
      if (r?.message) say(r.message.replace(/Climb out \(Esc\)/, 'Climb out (<b>pod park</b>)'));
      if (!runs.has(run.pid)) return;
    } else if (t === 'wrecked') {
      const r = await wreckRacer(live, 'wrecked');
      runs.delete(run.pid);
      if (r) sendToPlayer(run.pid, r);
      return;
    }
  }
  if (run.stopped) { run.stopped = false; if (s.running) say('It comes to a stop. The air brakes let go.'); }

  // Once each on the way down, a state you can act on.
  if (run.fuel < 0.12 && run.fuel > 0 && !run.said.fuel) { run.said.fuel = 1; say('<span class="text-amber">The tank is nearly out.</span>'); }
  // A dry tank shuts the levers (the seat's rule), so the racer coasts down with the turbines idling.
  if (run.fuel <= 0 && !run.said.dry) {
    run.said.dry = 1;
    say('<span class="text-red">The turbines lean out to an idle and the levers go dead. The tank is dry.</span> <span class="text-dim"><b>podracer recover</b> sends the flatbed.</span>');
  }
  if (s.hull < 0.3 && !run.said.hull) { run.said.hull = 1; say('<span class="text-red">The pod is coming apart around you.</span>'); }
  const heat = Math.max(...(s.heat || [0, 0]));
  if (heat > 0.85 && s.boosting && !run.said.heat) { run.said.heat = 1; say('<span class="text-amber">The turbines are running hot.</span>'); }
  if (heat < 0.5) run.said.heat = 0;

  // In the shed door, stopped: the yard is right there.
  const inDoor = s.speed <= BAY_STOP_MPH && bayLotAt(s.x, s.y);
  if (inDoor && !run.said.door) {
    run.said.door = 1;
    say('<span class="text-dim">You are stopped in the shed door. <b>pod park</b> puts it back on the blocks in the bay; <b>podracer service</b> repairs and fills it here.</span>');
  } else if (!inDoor && s.speed > 10) run.said.door = 0;

  // What is coming. The seat shows you the rock; this says how far it is.
  const now = Date.now();
  if (s.speed > 5 && now - run.warnAt > WARN_EVERY_MS) {
    const hit = clearAhead(s.x, s.y, travelHeading(s), LOOK_TILES, run.at);
    if (hit && (hit.d < WARN_TILES || hit.d / (s.speed / p.tileMph) < WARN_S)) {
      run.warnAt = now;
      say(`<span class="text-red">${hit.what[0].toUpperCase() + hit.what.slice(1)}, ${tiles(hit.d)} ahead at ${Math.round(s.speed)} mph.</span>`);
    }
  }

  // The running line, on the rung's clock, and on the log rung only when something has changed.
  run.sinceSay += dt;
  const [moving, still] = PACE[run.rung];
  if (run.sinceSay >= (s.speed > 2 || run.crank > 0 ? moving : still)) {
    const line = statusLine(run);
    const key = line.replace(/\d+ mph/, (m) => Math.round(parseInt(m, 10) / 10) * 10 + ' mph');
    run.sinceSay = 0;
    if (run.rung === 'textgames' || key !== run.lastLine) { run.lastLine = key; say(`<span class="text-dim">${line}</span>`); }
  }
}

// ── The orders ─────────────────────────────────────────────────────────────────
//
// `pod` and a word. One verb, because the good single words are taken: `throttle` is flight's,
// `stop` the wheelhouse's, `brake` and `launch` one plugin away from being somebody's.

const HELP = 'Orders, each <b>pod</b> and a word: <b>start</b> and <b>kill</b> the turbines; '
  + `thrust <b>${THRUST_WORDS.join('</b>, <b>')}</b> or <b>thrust 0-100</b>; `
  + 'a heading as a number (<b>pod 270</b>) or a compass point (<b>pod west</b>), <b>left 30</b>, <b>right 90</b>, <b>straight</b>, <b>home</b> for the shed door; '
  + '<b>brake</b> to stop, <b>reverse</b> from a standstill; <b>launch</b> the turbines out on the cables and <b>dock</b> them back; '
  + '<b>boost</b> on and off; <b>slide</b> to hang the pod out through the next turn; '
  + '<b>look</b> for what is round you; <b>park</b> to climb out. Bare <b>pod</b> is the dials.';

export async function cmdPod(args = [], raw, player, broadcast) {
  const run = runs.get(player.id);
  if (!run) {
    return { type: 'error', message: seated.has(player.id)
      ? 'You are in the seat with the screen. The <b>pod</b> orders are the text helm, for the text display modes.'
      : 'You are not strapped into a racer. <b>podracer</b> climbs into yours.' };
  }
  const word = String(args[0] || '').toLowerCase();
  const arg = String(args[1] || '').toLowerCase();
  const { s, want } = run;
  const say = (m) => ({ type: 'emote', message: m });
  const no = (m) => ({ type: 'error', message: m });
  const cold = () => no('The turbines are cold. <b>pod start</b> first.');

  if (!word || word === 'status' || word === 'dials') return say(statusLine(run));
  if (word === 'look' || word === 'scan') return say(lookLine(run));
  if (word === 'help' || word === '?') return say(HELP);
  if (word === 'park' || word === 'out' || word === 'exit') return parkRacer(player, broadcast);

  if (word === 'start') {
    if (s.running) return no('The turbines are already lit.');
    if (!s.binder) return no('Nothing will light with the binder torn out. <b>podracer recover</b> sends the flatbed.');
    if (run.fuel <= 0) return no('The tank is dry. <b>podracer recover</b> sends the flatbed.');
    // The seat's START button: the levers back to idle, and the starters held for the crank.
    want.thrust = 0; run.lever = [0, 0];
    run.crank = CRANK_S + 0.4;
    return say('You hit the starters. The turbines begin to turn over.');
  }
  if (word === 'kill' || word === 'shutdown' || word === 'off') {
    if (!s.running) return no('The turbines are not lit.');
    s.running = false;
    run.crank = 0; run.lever = [0, 0];
    Object.assign(want, { thrust: 0, boost: false, slide: false, reverse: false });
    return (await cmdPodEvent(['stopped'], raw, player)) || say('You shut the turbines down.');
  }

  if (word === 'thrust' || word === 'levers' || word in THRUST) {
    const v = word in THRUST ? THRUST[word] : arg in THRUST ? THRUST[arg] : parseFloat(arg) / 100;
    if (!Number.isFinite(v)) return no(`Thrust ${THRUST_WORDS.join(', ')}, or a number from 0 to 100.`);
    if (!s.running && v > 0) return cold();
    Object.assign(want, { thrust: clamp(v, 0, 1), brake: false, reverse: false });
    return say(v <= 0 ? 'You let the levers back to idle.' : `You push the levers up to ${thrustWord(want.thrust)}.`);
  }
  if (word === 'brake' || word === 'stop') {
    Object.assign(want, { brake: true, thrust: 0, boost: false, reverse: false });
    return say('You haul on the air brakes. The petals open on the turbines.');
  }
  if (word === 'reverse' || word === 'back') {
    if (!s.running) return cold();
    if (s.speed > STILL_MPH) return no('Not while it is moving. <b>pod brake</b>, then <b>pod reverse</b>.');
    Object.assign(want, { reverse: true, thrust: 0, brake: false, boost: false });
    return say('The petals swing into the exhaust as reversers, and it starts to back up.');
  }
  if (word === 'launch') {
    if (!s.running) return cold();
    if (!s.binder) return no('Not without a binder.');
    if (s.mode === 'launched') return no('The turbines are already out on the cables.');
    want.dock = true;
    return say('You hit the launch.');
  }
  if (word === 'dock') {
    if (s.mode !== 'launched') return no('The turbines are already docked alongside.');
    if (!s.running || !s.binder) return no('The turbines have to be lit to fly themselves back in.');
    want.dock = true;
    return say('You call the turbines back in.');
  }
  if (word === 'boost') {
    if (!s.running && !want.boost) return cold();
    want.boost = !want.boost;
    return say(want.boost
      ? 'You lift the cover and hold the boost down. It lights with both levers near full.'
      : 'You come off the boost.');
  }
  if (word === 'slide') {
    if (!s.running && !want.slide) return cold();
    want.slide = !want.slide;
    if (!want.slide) run.sliding = false;
    return say(want.slide
      ? 'Slide armed. The next turn you order hangs the pod out wide, and letting it go whips it back.'
      : 'Slide off.');
  }

  // Steering: a heading to fly to, which the tick holds until you order another.
  let bearing = null;
  if (word === 'left' || word === 'right') {
    const n = arg ? parseFloat(arg) : 45;
    if (!Number.isFinite(n) || n <= 0) return no(`${word === 'left' ? 'Left' : 'Right'} by how many degrees?`);
    bearing = pairHeading(s) + (word === 'right' ? 1 : -1) * Math.min(180, n);
  } else if (word === 'straight' || word === 'hold' || word === 'ahead') bearing = pairHeading(s);
  else if (word === 'home' || word === 'shed') {
    const doors = bayDoors();
    if (!doors.length) return no('There is no shed door to steer for.');
    const near = doors.reduce((a, b) => (Math.hypot(b.x - s.x, b.y - s.y) < Math.hypot(a.x - s.x, a.y - s.y) ? b : a));
    bearing = Math.atan2(near.x - s.x, -(near.y - s.y)) * R2D;
  } else if (word in BEARING_WORDS) bearing = BEARING_WORDS[word];
  else if (/^\d+(\.\d+)?$/.test(word)) bearing = Number(word);
  if (bearing != null) {
    want.bearing = norm(bearing);
    return say(`You steer for ${hdg(want.bearing)}.`);
  }
  return no(`No such order. ${HELP}`);
}

// ── The tick ───────────────────────────────────────────────────────────────────
//
// Once a second, with the real elapsed time, in the seat's frames. Never asks the rung: it was
// latched when you climbed in.
export async function tick() {
  if (!runs.size) return;
  const now = Date.now();
  for (const [pid, run] of [...runs]) {
    const live = getLivePlayer(pid);
    if (!live || seated.get(pid) !== run.racerId) { runs.delete(pid); continue; }
    try {
      const dt = (now - run.last) / 1000;
      run.last = now;
      // The ground this frame reads is the live racer's leg: the region's tiles, or the road's.
      run.at = groundFor(rigs.get(pid));
      const events = stepRun(run, dt);
      const rig = publish(run, now);
      // Where that is in the world, through the seat's own tracking: off the rim and onto the road,
      // down the crossing's rooms, off at either end. A move the server made is put on the model.
      const moved = await trackRacer(live, rig, dt * 1000, run.p, null);
      if (!runs.has(pid)) continue;
      if (moved.snap) placePodracer(run.s, run.p, rig.x, rig.y, rig.heading);
      await tell(live, run, events, dt);
      if (runs.has(pid) && now - (rig.flushed || 0) > FLUSH_MS) await flushRig(rig).catch(() => {});
    } catch (e) {
      console.error('[podracer] text helm:', e.message);
    }
  }
}

// Idle-gated by `schedule` itself, and free when nobody is racing by text.
schedule(TICK, () => tick().catch((e) => console.error('[podracer] text helm tick:', e.message)));

export const _test = { makeRun, stepRun, statusLine, lookLine, clearAhead, solidAt, groundAt, inputFor, runs, THRUST, tick };
