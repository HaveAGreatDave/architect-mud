// Waterworks: the plant that decides whether a region's taps run. See docs/systems-water-supply.md.
//
// The engine owns supply (server/engine/water.js): what a water source is, which region's mains it
// draws from, and the law every drink, fill and wash obeys. This plugin is the one writer. It runs
// a small state machine per plant and turns it into a supply with setWaterSupply.
//
// Nothing here names a building. A plant is any furniture flagged `waterworks: <region id>` (the
// pump set), and its power is the power of the room the pumps stand in. Rain is read at furniture
// flagged `water_intake: <region id>`, and `gauges` works wherever furniture is flagged
// `water_gauges: <region id>`. Coldwater's plant is content.
//
// Memory only, like the power grid's fault state. A restart puts every plant back to running, and
// the first tick re-asserts it.

import { schedule } from '../../server/engine/scheduler.js';
import { world, getFurnitureById, getZoneFurniture, getAllLivePlayers } from '../../server/engine/world.js';
import { getZonePowerStatus, getZonePrecip, getZoneTemperature } from '../../server/engine/environment.js';
import { setWaterSupply, getNetworkSupply, waterNetworkOf, isWaterSource } from '../../server/engine/water.js';
import { on } from '../../server/engine/events.js';
import { sendToPlayer } from '../../server/engine/messaging.js';

// ── tunables ──────────────────────────────────────────────────────────────────
export const FAULT_CHANCE = 1 / 2000;   // per minute of play: a fault every day and a half or so
export const STORM_FAULT_MULT = 4;      // a storm or a hard frost makes one likelier
export const FROST_C = -5;              // at or below this at the intake, it's a hard frost
export const REPAIR_MINUTES = [20, 90]; // an ordinary fault: a seized valve, a tripped starter
export const MAJOR_FAULT = 0.1;         // share of faults that are a burnt-out motor instead
export const MAJOR_REPAIR_MINUTES = 360;
// How long the Coldwater Water Tower holds the city once the pumps stop. Orla Kemp's figure is four
// hours before the high ground loses pressure, so an ordinary fault is thin taps and nothing worse.
export const TOWER_MINUTES = 240;
export const HEAVY_RAIN = 0.5;          // precipRate at the intake that starts silting it
export const TURBID_CHANCE = 0.05;      // per minute of heavy rain at the intake
export const TURBID_MINUTES = 90;       // how long silted water takes to clear
export const FLUSH_MINUTES = 10;        // the mains run cloudy this long after a dry spell
const MIN = 60_000;

const STAFF_ROLES = new Set(['dev', 'admin', 'builder', 'designer']);
const STATES = ['running', 'fault', 'unpowered', 'turbid', 'foul'];

// region id -> { region, pumpId, zoneId, intakeZoneId, state, since, until, stopped }
const plants = new Map();
let scanned = false;

// ── finding the plants ────────────────────────────────────────────────────────
// One pass over the in-memory furniture, on the first tick and again if a pump set disappears.
function scan() {
  plants.clear();
  const intakes = new Map();
  for (const f of world.furniture.values()) {
    if (f.flags?.water_intake) intakes.set(f.flags.water_intake, f.zone_id);
  }
  for (const f of world.furniture.values()) {
    const region = f.flags?.waterworks;
    if (!region || plants.has(region)) continue;
    plants.set(region, {
      region, pumpId: f.id, zoneId: f.zone_id, intakeZoneId: intakes.get(region) || f.zone_id,
      state: 'running', since: Date.now(), until: null, stopped: null,
    });
  }
  scanned = true;
}

function ensurePlants() {
  if (!scanned) scan();
  for (const p of plants.values()) if (!getFurnitureById(p.pumpId)) { scan(); break; }
  return plants;
}

const powered = (p) => ['powered', 'overloaded'].includes(getZonePowerStatus(p.zoneId));

// ── the state machine ─────────────────────────────────────────────────────────
// `stopped` is when the pumps last stopped, kept across fault and unpowered: a plant that loses its
// power halfway through a repair has not refilled the tower in between.
const STOPPED = new Set(['fault', 'unpowered']);
function enter(p, state, minutes = null, now = Date.now()) {
  if (!STOPPED.has(state)) p.stopped = null;
  else if (!STOPPED.has(p.state) || p.stopped == null) p.stopped = now;
  p.state = state;
  p.since = now;
  p.until = minutes == null ? null : now + minutes * MIN;
}

// What the plant's state means at the tap. A stopped plant runs off the tower until it's empty.
export function supplyOf(p, now = Date.now()) {
  switch (p.state) {
    case 'turbid': return { state: 'flowing', quality: 'cloudy', reason: 'turbid' };
    case 'foul': return { state: 'flowing', quality: 'foul', reason: 'foul' };
    case 'fault':
    case 'unpowered':
      return { state: now - (p.stopped ?? p.since) < TOWER_MINUTES * MIN ? 'low' : 'dry', quality: 'clean', reason: p.state };
    default: return { state: 'flowing', quality: 'clean', reason: null };
  }
}

function repairMinutes(rand = Math.random) {
  if (rand() < MAJOR_FAULT) return MAJOR_REPAIR_MINUTES;
  const [lo, hi] = REPAIR_MINUTES;
  return Math.round(lo + rand() * (hi - lo));
}

// One minute of one plant. `rand` is a seam for the regress suite.
export function step(p, now = Date.now(), rand = Math.random) {
  const wasDry = supplyOf(p, now).state === 'dry';
  const live = powered(p);
  if (!live && p.state !== 'unpowered' && p.state !== 'fault') {
    enter(p, 'unpowered', null, now);
  } else if (p.state === 'unpowered' && live) {
    if (wasDry) enter(p, 'turbid', FLUSH_MINUTES, now); else enter(p, 'running', null, now);
  } else if (p.until != null && now >= p.until) {
    // A repair or a clearing has run its course.
    if (!live) enter(p, 'unpowered', null, now);
    else if (p.state === 'fault' && wasDry) enter(p, 'turbid', FLUSH_MINUTES, now);
    else enter(p, 'running', null, now);
  } else if (p.state === 'running') {
    const rain = getZonePrecip(p.intakeZoneId);
    const storm = ['storm', 'thunderstorm'].includes(rain.precipType) || getZoneTemperature(p.intakeZoneId) <= FROST_C;
    if (rand() < FAULT_CHANCE * (storm ? STORM_FAULT_MULT : 1)) enter(p, 'fault', repairMinutes(rand), now);
    else if (rain.precipRate >= HEAVY_RAIN && rand() < TURBID_CHANCE) enter(p, 'turbid', TURBID_MINUTES, now);
  }
  return setWaterSupply(p.region, supplyOf(p, now));
}

// The regress suite pauses the tick so a real minute can't overwrite the supply it is testing.
let paused = false;
function tick() {
  if (paused) return;
  for (const p of ensurePlants().values()) step(p);
}

// ── announcements ─────────────────────────────────────────────────────────────
// One line to everyone standing at a mains tap in the region when the flow changes. Quality is not
// announced: you find that out at the tap.
const LINES = {
  low: 'Somewhere in the walls the pipes shudder, and a tap nearby starts to run thin.',
  dry: 'The pipes knock twice inside the wall and go quiet.',
  flowing: 'The pipes thump and hiss, and water comes back into them.',
};

on('water.supply.changed', ({ network, from, to }) => {
  if (from.state === to.state) return;
  const line = LINES[to.state];
  if (!line) return;
  for (const pl of getAllLivePlayers()) {
    if (!pl.current_zone || waterNetworkOf(pl.current_zone) !== network) continue;
    if (!getZoneFurniture(pl.current_zone).some(isWaterSource)) continue;
    sendToPlayer(pl.id, { type: 'output', message: `<span class="text-dim">${line}</span>` });
  }
});

// ── gauges ────────────────────────────────────────────────────────────────────
const PLANT_WORDS = {
  running: 'The pump dials sit steady in the green.',
  fault: 'The pump dials are at zero, and a red lamp is lit over the one marked MAIN.',
  unpowered: 'Every dial is dead. The board has no power, and neither do the pumps.',
  turbid: 'The pumps are running. The turbidity needle is well over to the right.',
  foul: 'The pumps are running. Somebody has chalked DO NOT DRINK across the turbidity dial.',
};

export function gaugeReport(p, now = Date.now()) {
  const s = supplyOf(p, now);
  const lines = [PLANT_WORDS[p.state] || PLANT_WORDS.running];
  if (s.state === 'flowing') lines.push('The tower gauge reads full.');
  else if (s.state === 'low') {
    const left = Math.max(1, Math.ceil(((p.stopped ?? p.since) + TOWER_MINUTES * MIN - now) / MIN));
    lines.push(`The tower gauge is falling. At this rate the city has about ${left} minute${left === 1 ? '' : 's'} of water.`);
  } else lines.push('The tower gauge is on the stop. The city is dry.');
  if (p.until && (p.state === 'fault' || p.state === 'turbid')) {
    const left = Math.max(1, Math.ceil((p.until - now) / MIN));
    lines.push(`<span class="text-dim">A note on the board, in grease pencil: ${p.state === 'fault' ? 'back up' : 'clear'} in ~${left} min.</span>`);
  }
  return lines.join('\n');
}

function cmdGauges(args, raw, player) {
  const board = getZoneFurniture(player.current_zone).find(f => f.flags?.water_gauges);
  if (!board) return { type: 'error', message: `There are no gauges here to read.` };
  const p = ensurePlants().get(board.flags.water_gauges);
  if (!p) return { type: 'output', message: `The ${board.name} is dead. Nothing is connected to it.` };
  return { type: 'output', message: `You read the ${board.name}.\n${gaugeReport(p)}` };
}

// ── the staff verb ────────────────────────────────────────────────────────────
const DENIED = { type: 'error', message: 'Unknown command: "waterworks". Type HELP for commands.' };

function plantFor(player) {
  const all = ensurePlants();
  return all.get(waterNetworkOf(player.current_zone)) || all.values().next().value || null;
}

function cmdWaterworks(args, raw, player) {
  if (!STAFF_ROLES.has(player?.role)) return DENIED;
  const [sub, arg, arg2] = args.map(a => a.toLowerCase());
  const all = ensurePlants();
  if (!sub || sub === 'status') {
    if (!all.size) return { type: 'output', message: 'No waterworks: nothing is flagged `waterworks`.' };
    const rows = [...all.values()].map(p => {
      const s = getNetworkSupply(p.region);
      return `${p.region}: plant ${p.state}, taps ${s.state}/${s.quality}${p.until ? ` (${Math.ceil((p.until - Date.now()) / MIN)}m left)` : ''}`;
    });
    return { type: 'output', message: rows.join('\n') };
  }
  const p = plantFor(player);
  if (!p) return { type: 'error', message: 'No waterworks: nothing is flagged `waterworks`.' };
  if (sub === 'repair') { enter(p, 'running'); step(p); return { type: 'output', message: `${p.region}: running.` }; }
  if (sub === 'set') {
    if (!STATES.includes(arg)) return { type: 'error', message: `waterworks set ${STATES.join('|')}` };
    const minutes = { fault: arg2 ? Number(arg2) || MAJOR_REPAIR_MINUTES : repairMinutes(), turbid: TURBID_MINUTES, foul: TURBID_MINUTES }[arg] ?? null;
    enter(p, arg, minutes);
    const s = setWaterSupply(p.region, supplyOf(p));
    return { type: 'output', message: `${p.region}: plant ${p.state}, taps ${s.state}/${s.quality}.` };
  }
  return { type: 'error', message: 'waterworks status | set <state> [minutes] | repair' };
}

schedule('1m', tick);

export const commands = { gauges: cmdGauges, waterworks: cmdWaterworks };

export const _internals = { plants, scan, enter, step, supplyOf, gaugeReport, pause: (v) => { paused = !!v; } };
