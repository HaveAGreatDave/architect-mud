// Waterworks: the plants that decide whether a region's taps run. See docs/systems-water-supply.md.
//
// The engine owns supply (server/engine/water.js): what a water source is, which region's mains it
// draws from, and the law every drink, fill and wash obeys. This plugin is the one writer. It runs
// a small state machine per pumping station and turns a region's stations into one supply with
// setWaterSupply.
//
// Nothing here names a building. A station is any furniture flagged `waterworks: <region id>` (a
// pump set), and its power is the power of the room it stands in. A region's stations are in series:
// one stopped is the whole region running off the tower. Rain is read at furniture flagged
// `water_intake: <region id>`, which silts only the station in the same building, and `gauges`
// works wherever furniture is flagged `water_gauges: <region id>`. Coldwater's stations are content.
//
// It also prices water. A vendor price rule (server/engine/vendor.js) raises what stored water costs
// while the taps are failing, sells it out vendor by vendor through a dry spell, and stops anyone
// selling mains water while the main is empty. Items opt in with the `drinking_water` tag.
//
// Memory only, like the power grid's fault state. A restart puts every station back to running, and
// the first tick re-asserts it.

import { schedule } from '../../server/engine/scheduler.js';
import { world, getZone, getFurnitureById, getZoneFurniture, getAllLivePlayers } from '../../server/engine/world.js';
import { getZonePowerStatus, getZonePrecip, getZoneTemperature } from '../../server/engine/environment.js';
import { setWaterSupply, getNetworkSupply, waterNetworkOf, isWaterSource } from '../../server/engine/water.js';
import { registerVendorPriceRule } from '../../server/engine/vendor.js';
import { on } from '../../server/engine/events.js';
import { sendToPlayer } from '../../server/engine/messaging.js';

// ── tunables ──────────────────────────────────────────────────────────────────
export const FAULT_CHANCE = 1 / 2000;   // per station per minute of play: about one a day and a half
export const STORM_FAULT_MULT = 4;      // a storm or a hard frost makes one likelier
export const FROST_C = -5;              // at or below this at the intake, it's a hard frost
export const REPAIR_MINUTES = [20, 90]; // an ordinary fault: a seized valve, a tripped starter
export const MAJOR_FAULT = 0.1;         // share of faults that are a burnt-out motor instead
export const MAJOR_REPAIR_MINUTES = 360;
// How long the Coldwater Water Tower holds the city once a station stops. Orla Kemp's figure is four
// hours before the high ground loses pressure, so an ordinary fault is thin taps and nothing worse.
export const TOWER_MINUTES = 240;
export const HEAVY_RAIN = 0.5;          // precipRate at the intake that starts silting it
export const TURBID_CHANCE = 0.05;      // per minute of heavy rain at the intake
export const TURBID_MINUTES = 90;       // how long silted water takes to clear
export const FLUSH_MINUTES = 10;        // the mains run cloudy this long after a dry spell
// The market. Stored water (bottles, cans) costs more while the taps fail; mains water is never
// marked up, only unavailable when the main is empty.
export const STORED_MULT = { low: 1.5, dry: 3 };
export const QUALITY_MULT = { cloudy: 1.25, foul: 2 };
export const SELLOUT_MINUTES = [60, 180]; // into a dry spell, each vendor's stored water runs out
export const RESTOCK_MINUTES = 120;       // after the water comes back, before a sold-out vendor restocks
const MIN = 60_000;

const STAFF_ROLES = new Set(['dev', 'admin', 'builder', 'designer']);
const STATES = ['running', 'fault', 'unpowered', 'turbid', 'foul'];
const STOPPED = new Set(['fault', 'unpowered']);

// pump furniture id -> { id, region, zoneId, tileId, name, intakeZoneId, state, since, until, stopped }
const stations = new Map();
// region id -> { dryAt, lastDryEnd, lastDryLen }, kept from water.supply.changed
const spells = new Map();
let scanned = false;

// ── finding the stations ──────────────────────────────────────────────────────
// The map tile a zone belongs to: itself, or the facade its parent_zone chain leads to.
function tileOf(zoneId) {
  let z = getZone(zoneId);
  for (let hops = 0; z && hops < 8; hops++) {
    if (z.flags?.region_id) return z;
    z = z.parent_zone ? getZone(z.parent_zone) : null;
  }
  return null;
}

// One pass over the in-memory furniture, on the first tick and again if a pump set disappears.
// A rescan keeps the state of every station that is still there.
function scan() {
  const intakes = [];
  for (const f of world.furniture.values()) {
    if (f.flags?.water_intake) intakes.push({ region: f.flags.water_intake, zoneId: f.zone_id, tileId: tileOf(f.zone_id)?.id });
  }
  const found = new Map();
  for (const f of world.furniture.values()) {
    const region = f.flags?.waterworks;
    if (!region) continue;
    const tile = tileOf(f.zone_id);
    const own = intakes.find(i => i.region === region && i.tileId && i.tileId === tile?.id);
    const prev = stations.get(f.id);
    found.set(f.id, {
      id: f.id, region, zoneId: f.zone_id, tileId: tile?.id || null,
      name: tile?.flags?.building_name || tile?.name || f.name,
      intakeZoneId: own?.zoneId || null,
      weatherZoneId: own?.zoneId || intakes.find(i => i.region === region)?.zoneId || f.zone_id,
      state: prev?.state || 'running', since: prev?.since || Date.now(), until: prev?.until ?? null, stopped: prev?.stopped ?? null,
    });
  }
  stations.clear();
  for (const [id, st] of found) stations.set(id, st);
  scanned = true;
}

function ensureStations() {
  if (!scanned) scan();
  for (const st of stations.values()) if (!getFurnitureById(st.id)) { scan(); break; }
  return stations;
}

const stationsOf = (region) => [...ensureStations().values()].filter(st => st.region === region);
const regions = () => [...new Set([...ensureStations().values()].map(st => st.region))];
const powered = (st) => ['powered', 'overloaded'].includes(getZonePowerStatus(st.zoneId));

// ── the state machine ─────────────────────────────────────────────────────────
// `stopped` is when the pumps last stopped, kept across fault and unpowered: a station that loses
// its power halfway through a repair has not refilled the tower in between.
function enter(st, state, minutes = null, now = Date.now()) {
  if (!STOPPED.has(state)) st.stopped = null;
  else if (!STOPPED.has(st.state) || st.stopped == null) st.stopped = now;
  st.state = state;
  st.since = now;
  st.until = minutes == null ? null : now + minutes * MIN;
}

// What a region's stations mean at the tap. They are in series, so one stopped is the region running
// off the tower from the moment the first one stopped; the water is as bad as the worst station
// still pumping.
export function supplyOf(list, now = Date.now()) {
  const stopped = list.filter(st => STOPPED.has(st.state));
  const pumping = list.filter(st => !STOPPED.has(st.state));
  const quality = pumping.some(st => st.state === 'foul') ? 'foul'
    : pumping.some(st => st.state === 'turbid') ? 'cloudy' : 'clean';
  if (stopped.length) {
    const since = Math.min(...stopped.map(st => st.stopped ?? st.since));
    return { state: now - since < TOWER_MINUTES * MIN ? 'low' : 'dry', quality, reason: stopped[0].state };
  }
  return { state: 'flowing', quality, reason: quality === 'clean' ? null : quality === 'foul' ? 'foul' : 'turbid' };
}

function repairMinutes(rand = Math.random) {
  if (rand() < MAJOR_FAULT) return MAJOR_REPAIR_MINUTES;
  const [lo, hi] = REPAIR_MINUTES;
  return Math.round(lo + rand() * (hi - lo));
}

// One minute of one station. `wasDry` is the region's: a station coming back to a dry city flushes.
function stepStation(st, wasDry, now, rand) {
  const live = powered(st);
  if (!live && !STOPPED.has(st.state)) {
    enter(st, 'unpowered', null, now);
  } else if (st.state === 'unpowered' && live) {
    if (wasDry) enter(st, 'turbid', FLUSH_MINUTES, now); else enter(st, 'running', null, now);
  } else if (st.until != null && now >= st.until) {
    // A repair or a clearing has run its course.
    if (!live) enter(st, 'unpowered', null, now);
    else if (st.state === 'fault' && wasDry) enter(st, 'turbid', FLUSH_MINUTES, now);
    else enter(st, 'running', null, now);
  } else if (st.state === 'running') {
    const rain = getZonePrecip(st.weatherZoneId);
    const storm = ['storm', 'thunderstorm'].includes(rain.precipType) || getZoneTemperature(st.weatherZoneId) <= FROST_C;
    if (rand() < FAULT_CHANCE * (storm ? STORM_FAULT_MULT : 1)) enter(st, 'fault', repairMinutes(rand), now);
    else if (st.intakeZoneId && rain.precipRate >= HEAVY_RAIN && rand() < TURBID_CHANCE) enter(st, 'turbid', TURBID_MINUTES, now);
  }
}

// One minute of one region. `rand` is a seam for the regress suite.
export function step(region, now = Date.now(), rand = Math.random) {
  const list = stationsOf(region);
  const wasDry = supplyOf(list, now).state === 'dry';
  for (const st of list) stepStation(st, wasDry, now, rand);
  return setWaterSupply(region, supplyOf(list, now));
}

// The regress suite pauses the tick so a real minute can't overwrite the supply it is testing.
let paused = false;
function tick() {
  if (paused) return;
  for (const region of regions()) step(region);
}

// ── dry spells, and the announcements ─────────────────────────────────────────
// One line to everyone standing at a mains tap in the region when the flow changes. Quality is not
// announced: you find that out at the tap.
const LINES = {
  low: 'Somewhere in the walls the pipes shudder, and a tap nearby starts to run thin.',
  dry: 'The pipes knock twice inside the wall and go quiet.',
  flowing: 'The pipes thump and hiss, and water comes back into them.',
};

on('water.supply.changed', ({ network, from, to }) => {
  if (from.state === to.state) return;
  const spell = spells.get(network) || spells.set(network, { dryAt: null, lastDryEnd: null, lastDryLen: 0 }).get(network);
  const now = Date.now();
  if (to.state === 'dry') spell.dryAt = now;
  else if (from.state === 'dry' && spell.dryAt != null) {
    spell.lastDryEnd = now;
    spell.lastDryLen = now - spell.dryAt;
    spell.dryAt = null;
  }
  const line = LINES[to.state];
  if (!line) return;
  for (const pl of getAllLivePlayers()) {
    if (!pl.current_zone || waterNetworkOf(pl.current_zone) !== network) continue;
    if (!getZoneFurniture(pl.current_zone).some(isWaterSource)) continue;
    sendToPlayer(pl.id, { type: 'output', message: `<span class="text-dim">${line}</span>` });
  }
});

// ── the market ────────────────────────────────────────────────────────────────
// How far into a dry spell this vendor's stored water lasts: a fixed point in SELLOUT_MINUTES per
// vendor, so the city's shelves empty one after another rather than all at once.
function selloutMinutes(npcId) {
  let h = 0;
  for (const c of String(npcId)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const [lo, hi] = SELLOUT_MINUTES;
  return lo + (h % (hi - lo + 1));
}

export function soldOut(npcId, region, now = Date.now()) {
  const spell = spells.get(region);
  if (!spell) return false;
  const lasts = selloutMinutes(npcId) * MIN;
  if (spell.dryAt != null) return now - spell.dryAt >= lasts;
  return spell.lastDryEnd != null && spell.lastDryLen >= lasts && now - spell.lastDryEnd < RESTOCK_MINUTES * MIN;
}

export function waterPrice({ npc, item }, now = Date.now()) {
  const kind = item?.tags?.drinking_water;
  if (!kind || !npc) return null;
  const region = waterNetworkOf(npc.work_zone_id || npc.current_zone);
  if (!region) return null;
  const s = getNetworkSupply(region);
  if (kind === 'mains') {
    return s.state === 'dry'
      ? { soldOut: true, line: `"Nothing in the main," ${npc.name} says. "Come back when the water does."` }
      : null;
  }
  if (soldOut(npc.id, region, now)) {
    return { soldOut: true, line: `"Sold the last of it," ${npc.name} says. "Everybody had the same idea."` };
  }
  if (npc.flags?.holds_water_price) return null;
  const mult = Math.max(STORED_MULT[s.state] || 1, QUALITY_MULT[s.quality] || 1);
  return mult > 1 ? { mult } : null;
}

registerVendorPriceRule((ctx) => waterPrice(ctx), 'waterworks');

// ── gauges ────────────────────────────────────────────────────────────────────
const STATION_WORDS = {
  running: 'steady in the green',
  fault: 'at zero, with a red lamp lit',
  unpowered: 'dead. No power to the pumps',
  turbid: 'running, with the turbidity needle well over',
  foul: 'running, with DO NOT DRINK chalked across the turbidity dial',
};

export function gaugeReport(list, now = Date.now()) {
  const s = supplyOf(list, now);
  const lines = list.map(st => `${st.name}: ${STATION_WORDS[st.state] || STATION_WORDS.running}.`);
  if (s.state === 'flowing') lines.push('The tower gauge reads full.');
  else if (s.state === 'low') {
    const since = Math.min(...list.filter(st => STOPPED.has(st.state)).map(st => st.stopped ?? st.since));
    const left = Math.max(1, Math.ceil((since + TOWER_MINUTES * MIN - now) / MIN));
    lines.push(`The tower gauge is falling. At this rate the city has about ${left} minute${left === 1 ? '' : 's'} of water.`);
  } else lines.push('The tower gauge is on the stop. The city is dry.');
  for (const st of list) {
    if (!st.until || !(st.state === 'fault' || st.state === 'turbid')) continue;
    const left = Math.max(1, Math.ceil((st.until - now) / MIN));
    lines.push(`<span class="text-dim">Grease pencil, by ${st.name}: ${st.state === 'fault' ? 'back up' : 'clear'} in ~${left} min.</span>`);
  }
  return lines.join('\n');
}

function cmdGauges(args, raw, player) {
  const board = getZoneFurniture(player.current_zone).find(f => f.flags?.water_gauges);
  if (!board) return { type: 'error', message: `There are no gauges here to read.` };
  const list = stationsOf(board.flags.water_gauges);
  if (!list.length) return { type: 'output', message: `The ${board.name} is dead. Nothing is connected to it.` };
  return { type: 'output', message: `You read the ${board.name}.\n${gaugeReport(list)}` };
}

// ── the staff verb ────────────────────────────────────────────────────────────
const DENIED = { type: 'error', message: 'Unknown command: "waterworks". Type HELP for commands.' };

// The station in the building you're standing in, or else the first in your region (or anywhere).
function stationFor(player) {
  const here = tileOf(player.current_zone)?.id;
  const all = [...ensureStations().values()];
  return all.find(st => st.tileId && st.tileId === here)
    || all.find(st => st.region === waterNetworkOf(player.current_zone))
    || all[0] || null;
}

function cmdWaterworks(args, raw, player) {
  if (!STAFF_ROLES.has(player?.role)) return DENIED;
  const [sub, arg, arg2] = args.map(a => a.toLowerCase());
  if (!sub || sub === 'status') {
    const rs = regions();
    if (!rs.length) return { type: 'output', message: 'No waterworks: nothing is flagged `waterworks`.' };
    const rows = [];
    for (const region of rs) {
      const s = getNetworkSupply(region);
      rows.push(`${region}: taps ${s.state}/${s.quality}`);
      for (const st of stationsOf(region)) {
        rows.push(`  ${st.name}: ${st.state}${st.until ? ` (${Math.ceil((st.until - Date.now()) / MIN)}m left)` : ''}`);
      }
    }
    return { type: 'output', message: rows.join('\n') };
  }
  const st = stationFor(player);
  if (!st) return { type: 'error', message: 'No waterworks: nothing is flagged `waterworks`.' };
  if (sub === 'repair') {
    enter(st, 'running');
    const s = step(st.region);
    return { type: 'output', message: `${st.name}: running. Taps ${s.state}/${s.quality}.` };
  }
  if (sub === 'set') {
    if (!STATES.includes(arg)) return { type: 'error', message: `waterworks set ${STATES.join('|')} [minutes]` };
    const minutes = { fault: arg2 ? Number(arg2) || MAJOR_REPAIR_MINUTES : repairMinutes(), turbid: TURBID_MINUTES, foul: TURBID_MINUTES }[arg] ?? null;
    enter(st, arg, minutes);
    const s = setWaterSupply(st.region, supplyOf(stationsOf(st.region)));
    return { type: 'output', message: `${st.name}: ${st.state}. Taps ${s.state}/${s.quality}.` };
  }
  return { type: 'error', message: 'waterworks status | set <state> [minutes] | repair' };
}

schedule('1m', tick);

export const commands = { gauges: cmdGauges, waterworks: cmdWaterworks };

export const _internals = {
  stations, spells, scan, enter, step, stepStation, supplyOf, gaugeReport, stationsOf, selloutMinutes,
  pause: (v) => { paused = !!v; },
};
