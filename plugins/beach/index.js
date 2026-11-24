// plugins/beach/index.js
//
// Days at the beach. On a warm, dry day, groups of friends go down to Marina Beach (every zone
// with flags.beach), put up a parasol, lay out their towels, lie in the sun and go swimming.
// It's the daytime version of plugins/outings: each day's plan is worked out from the game
// date, so it's the same on every server and after a restart, and it uses the same friend
// network (friendsOf) and the same walking (registerLifeDriver, walkNpcToward).
//
// Who goes depends on where they live. Nobody comes from the slums in the south-east (district
// `slum`, or anywhere south and east of 918,912); people from the west of the city are the
// likeliest to go, and the middle of the city next. weightOf says so.
//
// A beachgoer's state is `npc._beach` (RAM): their spot, towel, parasol, and what they're
// doing, `sun`, `wade` (walking out into the water), `swim` (out in it for a while) or
// `back` (walking back up the beach). The room description (zone.describeRoom) says it, the
// clothes follow it (client/shared/summer-wear.js puts them in swimwear), and the street
// actors send it to GLASS as `b`, which draws the parasol, the towels, a body lying on one,
// and a swimmer out past the waterline (gl/beach.js).
//
// No query anywhere.

import { schedule } from '../../server/engine/scheduler.js';
import { world, getZone, getZonePlayers } from '../../server/engine/world.js';
import { registerLifeDriver, walkNpcToward, isNpcAsleep } from '../../server/engine/ai-behaviour.js';
import { getEnvironmentState } from '../../server/engine/environment.js';
import { gameMsToReal } from '../../server/engine/gametime.js';
import { weatherHeat } from '../../client/shared/summer-wear.js';
import { friendsOf, isFree as outingFree, isSocialNpc } from '../outings/index.js';

// ── Tunables ────────────────────────────────────────────────────────────────
const GROUPS          = 12;        // beach trips planned per day
const MAX_GROUP       = 4;         // host included
const DAY_FROM        = 10 * 60;   // first start, game minutes since midnight
const DAY_TO          = 15 * 60;   // last start
const BEACH_HOURS     = 3;         // how long they stay
const GATHER_LIMIT_MS = 8 * 60_000;
const SUN_GAME_MIN    = [20, 50];  // a spell on the towel
const SWIM_GAME_MIN   = [30, 60];  // a spell in the water: they stay out a while
export const WADE_MS  = 30_000;    // real time to walk out into the water, or back up the beach
const SAY_GAP_MS      = 75_000;

export const PARASOLS = ['red and white', 'blue and white', 'yellow', 'orange', 'green and white', 'pink'];
export const TOWELS   = ['striped', 'blue', 'red', 'yellow', 'white', 'green', 'orange-and-pink'];

// ── State (RAM only) ────────────────────────────────────────────────────────
let beaches = [];              // [{ id, x, y, sea: { dx, dy } }]
const trips = new Map();       // tripId -> trip
let plan = null;               // { key, events }
const launched = new Set();
let seq = 0;

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
  return h >>> 0;
}
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (arr, rnd = Math.random) => arr[Math.floor(rnd() * arr.length)];
const between = ([a, b], rnd = Math.random) => a + rnd() * (b - a);
const zoneOf = (npc) => npc.zoneId ?? npc.zone_id;
const gameMin = (m) => gameMsToReal(m * 60_000);

// The street tile a home is on: the zone itself, or the facade an interior exits to.
function homeTile(npc) {
  let z = getZone(npc?.home_zone);
  for (let i = 0; i < 3 && z && !Number.isFinite(z.grid_x); i++) {
    const exit = z.flags?.world_exit_zone || (z.map_id && world.maps?.get?.(z.map_id)?.parent_zone_id);
    z = exit ? getZone(exit) : null;
  }
  return z && Number.isFinite(z.grid_x) ? z : null;
}

// How likely somebody is to spend a day at the beach, by where they live. 0 never.
export function weightOf(npc) {
  const t = homeTile(npc);
  if (!t) return 0;
  if (t.flags?.region_id && t.flags.region_id !== 'region_coldwater') return 0;
  if (t.flags?.district === 'slum' || (t.grid_x >= 918 && t.grid_y >= 912)) return 0; // the poor south-east
  if (t.grid_x <= 904) return 4;   // the west: Halcyon Fields, the Glasshouse, the Filaments
  if (t.grid_x <= 913) return 3;   // the middle of the city
  return 1;
}

// ── The beach ───────────────────────────────────────────────────────────────
// Every flags.beach tile on the surface, with the way to the water: the average direction of the
// water tiles within two of it, so a swimmer walks the right way.
export function buildBeaches() {
  const byGrid = new Map();
  for (const z of world.zones.values()) {
    if (z.map_id !== 'map_world' || (z.grid_z ?? 0) !== 0 || !Number.isFinite(z.grid_x)) continue;
    byGrid.set(`${z.grid_x},${z.grid_y}`, z);
  }
  beaches = [];
  for (const z of byGrid.values()) {
    if (!z.flags?.beach) continue;
    let dx = 0, dy = 0;
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
      const n = byGrid.get(`${z.grid_x + ox},${z.grid_y + oy}`);
      if (n?.flags?.terrain === 'water' && !n.flags?.is_building && !n.flags?.pier) { const d = Math.hypot(ox, oy); dx += ox / d / d; dy += oy / d / d; }
    }
    const m = Math.hypot(dx, dy);
    beaches.push({ id: z.id, x: z.grid_x, y: z.grid_y, sea: m ? { dx: +(dx / m).toFixed(3), dy: +(dy / m).toFixed(3) } : { dx: 0, dy: -1 } });
  }
  beaches.sort((a, b) => (a.id < b.id ? -1 : 1));
  return beaches;
}
export const beachList = () => beaches;

// ── The day's plan ──────────────────────────────────────────────────────────
// Who goes, when and where, from the date alone. The weather is checked when a trip starts, not
// here, so a cold or wet day simply has nobody go.
export function planDay(date) {
  const rnd = seeded(hash(`beach|${date}`));
  const booked = new Set();
  const events = [];
  if (!beaches.length) return { key: date, events };
  // weighted order: each person drawn with a key rnd^(1/w), highest first (weighted shuffle)
  const people = [...world.npcs.values()].filter(isSocialNpc).sort((a, b) => (a.id < b.id ? -1 : 1))
    .map(n => ({ n, w: weightOf(n) })).filter(p => p.w > 0)
    .map(p => ({ n: p.n, k: Math.pow(rnd(), 1 / p.w) })).sort((a, b) => b.k - a.k).map(p => p.n);
  const load = new Map(beaches.map(b => [b.id, 0]));
  for (const host of people) {
    if (events.length >= GROUPS) break;
    if (booked.has(host.id)) continue;
    const guests = friendsOf(host.id).sort().map(id => world.npcs.get(id))
      .filter(n => n && !booked.has(n.id) && weightOf(n) > 0 && rnd() < 0.6).slice(0, MAX_GROUP - 1);
    const members = [host.id, ...guests.map(n => n.id)];
    // the emptiest stretch of beach, ties broken by the draw
    const least = Math.min(...load.values());
    const spot = pick(beaches.filter(b => load.get(b.id) === least), rnd);
    load.set(spot.id, least + 1);
    for (const id of members) booked.add(id);
    const start = DAY_FROM + Math.floor(rnd() * (DAY_TO - DAY_FROM));
    events.push({
      id: `${date}|beach|${host.id}`, host: host.id, members, zone: spot.id, start, hours: BEACH_HOURS,
      parasol: Math.floor(rnd() * PARASOLS.length),
      // where on the tile they set up, 0..1 each way, kept off the edges
      at: { u: +(0.25 + rnd() * 0.5).toFixed(3), v: +(0.25 + rnd() * 0.5).toFixed(3) },
    });
  }
  events.sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
  return { key: date, events };
}

function planFor(env) {
  if (!env.date) return null;
  if (plan?.key !== env.date) { plan = planDay(env.date); launched.clear(); }
  return plan;
}

// Good beach weather: warm (the same switch that takes the coats off) and nothing falling.
export function beachWeather(env = getEnvironmentState()) {
  return weatherHeat() >= 1 && !(env.precipRate > 0);
}

// Free for the beach: free for a night out (awake, off shift, not busy), and not already down here.
const isFree = (npc, env) => !npc._beach && outingFree(npc, env);

// ── Starting a trip ─────────────────────────────────────────────────────────
function launch(e, env, { force = false, now = Date.now() } = {}) {
  const host = world.npcs.get(e.host);
  if (!host || !(force || isFree(host, env))) return null;
  const going = e.members.map(id => world.npcs.get(id)).filter(n => n && (n === host || force || isFree(n, env)));
  const left = force ? e.hours * 60 : Math.max(30, e.start + e.hours * 60 - (env.minutes ?? 0));
  const beach = beaches.find(b => b.id === e.zone) || beaches[0];
  const trip = {
    id: `beach_${++seq}`, planId: e.id, zone: beach.id, sea: beach.sea, parasol: e.parasol, at: e.at,
    members: new Set(going.map(n => n.id)), arrived: new Set(), startedAt: now,
    endsAt: now + gameMin(left), lastSay: 0, packing: false,
  };
  trips.set(trip.id, trip);
  going.forEach((n, i) => {
    const r = seeded(hash(`${e.id}|${n.id}`));
    // the towels go round the parasol, the first on the landward side
    const ang = Math.atan2(-beach.sea.dy, -beach.sea.dx) + (i - (going.length - 1) / 2) * 1.1;
    n._beach = {
      trip: trip.id, zone: beach.id, state: 'walk', since: now, until: 0,
      towel: Math.floor(r() * TOWELS.length),
      off: { u: +(Math.cos(ang) * 0.09).toFixed(3), v: +(Math.sin(ang) * 0.09).toFixed(3), r: +(ang + Math.PI / 2).toFixed(3) },
      seed: hash(n.id) % 997,
    };
  });
  return trip;
}

// A trip started now, for tests and dev tools.
export function callBeachTrip(hostId, { env = getEnvironmentState(), force = false } = {}) {
  if (!beaches.length) buildBeaches();
  const host = world.npcs.get(hostId);
  if (!host || !beaches.length) return null;
  const members = [hostId, ...friendsOf(hostId).filter(id => { const n = world.npcs.get(id); return n && (force || isFree(n, env)); }).slice(0, MAX_GROUP - 1)];
  return launch({ id: `adhoc|${++seq}`, host: hostId, members, zone: beaches[seq % beaches.length].id, start: 0, hours: BEACH_HOURS, parasol: seq % PARASOLS.length, at: { u: 0.5, v: 0.5 } }, env, { force });
}

// ── Lines ───────────────────────────────────────────────────────────────────
function names(ids) {
  const list = ids.map(id => world.npcs.get(id)?.name).filter(Boolean);
  if (list.length <= 1) return list[0] || '';
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}
function say(zoneId, message, broadcast) {
  if (broadcast && zoneId) broadcast(zoneId, { type: 'zone_event', message });
}
const AT_REST = [
  (a) => `${a} rolls over onto their front.`,
  (a, b) => `${a} asks ${b} to do their back. ${b} does a bad job of it.`,
  (a) => `${a} reads the same page of a paperback for the third time and falls asleep under it.`,
  (a, b) => `${a} passes ${b} a can out of the cool box. It's warm.`,
  (a) => `${a} moves their towel into the shade of the parasol, then back out of it.`,
  (a, b) => `${a} flicks sand at ${b}. ${b} pretends not to notice.`,
  (a) => `${a} sits up, looks at the water, and lies back down.`,
  (a) => `${a} has fallen asleep with their sunglasses on. There's going to be a mark.`,
];

// ── Leaving ─────────────────────────────────────────────────────────────────
function release(npc, trip, { broadcast, ai, why } = {}) {
  const b = npc._beach;
  npc._beach = null;
  if (ai) { ai.patrolPath = []; ai.patrolTarget = null; ai._lifeActivity = null; }
  if (!trip) return;
  trip.members.delete(npc.id);
  const wasThere = trip.arrived.delete(npc.id);
  if (wasThere && zoneOf(npc) === trip.zone) {
    const last = trip.arrived.size === 0;
    say(trip.zone, why === 'rain'
      ? `${npc.name} grabs their towel and runs for it.`
      : last ? `${npc.name} shakes the sand out of their towel, folds up the ${PARASOLS[trip.parasol]} parasol and heads home.`
        : `${npc.name} shakes the sand out of their towel and heads home.`, broadcast);
  }
  if (!trip.members.size) trips.delete(trip.id);
  return b;
}

// ── The driver ──────────────────────────────────────────────────────────────
function drive(npc, { broadcast, query, ai, zoneId }) {
  const b = npc._beach;
  if (!b) return false;
  const trip = trips.get(b.trip);
  if (!trip) { npc._beach = null; return false; }
  const now = Date.now();
  const env = getEnvironmentState();
  if (isNpcAsleep(npc) || ai.alarm || ai.dosedOut || npc._combatTargetId) { release(npc, trip, { broadcast, ai }); return false; }
  if (env.precipRate > 0) { release(npc, trip, { broadcast, ai, why: 'rain' }); return false; }

  if (zoneId !== trip.zone) {
    trip.arrived.delete(npc.id);
    if (now >= trip.endsAt || now - trip.startedAt > GATHER_LIMIT_MS + gameMin(BEACH_HOURS * 60)) { release(npc, trip, { broadcast, ai }); return false; }
    if (now - trip.startedAt > GATHER_LIMIT_MS && b.state === 'walk') { release(npc, trip, { broadcast, ai }); return false; }
    const r = walkNpcToward(npc, trip.zone, broadcast, query);
    if (r === 'stuck') { release(npc, trip, { broadcast, ai }); return false; }
    if (r !== 'arrived') return true;
  }

  if (!trip.arrived.has(npc.id)) {
    const first = trip.arrived.size === 0;
    trip.arrived.add(npc.id);
    b.state = 'sun'; b.since = now; b.until = now + gameMin(between(SUN_GAME_MIN));
    say(trip.zone, first
      ? `${npc.name} pushes a ${PARASOLS[trip.parasol]} parasol into the sand, screws it down and spreads a ${TOWELS[b.towel]} towel under it.`
      : `${npc.name} drops a ${TOWELS[b.towel]} towel next to ${names([...trip.arrived].filter(id => id !== npc.id))} and kicks off their shoes.`, broadcast);
    return true;
  }

  // Home time: a swimmer comes back up the beach first.
  if (now >= trip.endsAt) {
    if (b.state === 'swim' || b.state === 'wade') {
      b.state = 'back'; b.since = now; b.until = now + WADE_MS;
      say(trip.zone, `${npc.name} swims in and wades back up the beach.`, broadcast);
      return true;
    }
    if (b.state === 'back' && now < b.until) return true;
    release(npc, trip, { broadcast, ai });
    return false;
  }

  if (now >= b.until) {
    if (b.state === 'sun') {
      b.state = 'wade'; b.since = now; b.until = now + WADE_MS;
      say(trip.zone, pick([
        `${npc.name} gets up off their towel and walks down into the water, slowing as it gets to their waist.`,
        `${npc.name} wades out into the basin, arms up, going "ooh, ooh, ooh" at every step.`,
        `${npc.name} walks down to the water and keeps going until it's up to their chest.`,
      ]), broadcast);
    } else if (b.state === 'wade') {
      b.state = 'swim'; b.since = now; b.until = now + gameMin(between(SWIM_GAME_MIN));
      say(trip.zone, `${npc.name} pushes off and swims out.`, broadcast);
    } else if (b.state === 'swim') {
      b.state = 'back'; b.since = now; b.until = now + WADE_MS;
      say(trip.zone, `${npc.name} swims in and wades back up the beach, dripping.`, broadcast);
    } else if (b.state === 'back') {
      b.state = 'sun'; b.since = now; b.until = now + gameMin(between(SUN_GAME_MIN));
      say(trip.zone, `${npc.name} drops onto their towel and lies there with their eyes shut.`, broadcast);
    }
    return true;
  }

  // On the towel: a line now and then, only with somebody to hear it.
  if (b.state === 'sun' && now - trip.lastSay > SAY_GAP_MS && Math.random() < 0.2 && getZonePlayers(trip.zone).length) {
    trip.lastSay = now;
    const others = [...trip.arrived].filter(id => id !== npc.id && world.npcs.get(id)?._beach?.state === 'sun');
    const other = world.npcs.get(pick(others.length ? others : [npc.id]))?.name || npc.name;
    say(trip.zone, pick(others.length ? AT_REST : AT_REST.filter(f => f.length < 2))(npc.name, other), broadcast);
  }
  return true;
}

// ── What you see ────────────────────────────────────────────────────────────
// One sentence per party on this stretch of beach.
export function describeBeach(zone) {
  if (!zone?.flags?.beach) return undefined;
  const lines = [];
  for (const trip of trips.values()) {
    if (trip.zone !== zone.id || !trip.arrived.size) continue;
    const doing = [...trip.arrived].map(id => world.npcs.get(id)).filter(Boolean).map(n => {
      const s = n._beach?.state;
      if (s === 'swim') return `${n.name} is swimming out past the shallows`;
      if (s === 'wade') return `${n.name} is wading out into the water`;
      if (s === 'back') return `${n.name} is wading back in`;
      return `${n.name} is lying on a ${TOWELS[n._beach?.towel ?? 0]} towel`;
    });
    const list = doing.length > 1 ? `${doing.slice(0, -1).join(', ')} and ${doing[doing.length - 1]}` : doing[0];
    lines.push(`Under a ${PARASOLS[trip.parasol]} parasol, ${list}.`);
  }
  return lines.length ? `<span class="text-dim">${lines.join(' ')}</span>` : undefined;
}

// What the street actors send GLASS for a beachgoer: where on the tile, which way the sea is, what
// they're doing and for how long. Sync, from RAM.
export function beachLook(npc, now = Date.now()) {
  const b = npc?._beach;
  if (!b || b.state === 'walk' || zoneOf(npc) !== b.zone) return null;
  const trip = trips.get(b.trip);
  if (!trip) return null;
  return {
    k: b.state, u: trip.at.u, v: trip.at.v, ou: b.off.u, ov: b.off.v, r: b.off.r,
    sx: trip.sea.dx, sy: trip.sea.dy, p: trip.parasol, w: b.towel,
    // ms into this state, and how long a wade lasts, so the client animates the walk out and back
    t: Math.min(now - b.since, 3_600_000), d: WADE_MS, n: b.seed,
  };
}

// ── Tick ────────────────────────────────────────────────────────────────────
function tick() {
  if (!beaches.length) return;
  const env = getEnvironmentState();
  const p = planFor(env);
  if (!p) return;
  const m = env.minutes ?? 0;
  for (const e of p.events) {
    if (launched.has(e.id) || m < e.start) continue;
    if (m >= e.start + e.hours * 60 - 30) { launched.add(e.id); continue; }
    if (!beachWeather(env)) continue; // waits for the sun, until it's too late
    if (launch(e, env)) launched.add(e.id);
  }
}

let booted = false;
registerLifeDriver(drive);
schedule('1m', () => {
  try {
    if (!booted && world.zones.size && world.npcs.size) { buildBeaches(); booted = true; }
    tick();
  } catch (e) { console.error(`[beach] tick: ${e.message}`); }
});

export const hooks = {
  'zone.describeRoom': describeBeach,
  'npc.streetPose': (npc) => beachLook(npc) || undefined,
};
export const commands = {};
export const _test = {
  drive, release, trips, launched,
  reset() {
    for (const n of world.npcs.values()) if (n._beach) n._beach = null;
    trips.clear(); launched.clear(); plan = null;
  },
};
