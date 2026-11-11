// plugins/outings/index.js
//
// Friends and nights out. Every NPC with a home gets a small circle of friends, worked out
// at boot from who they work with, who they live with, who lives in their building and
// who an author named in flags.friends. In the evening a free NPC with free friends calls
// a night out: they each walk from wherever they are to the same bar or club, meet there,
// stay a few game hours and go home. Anyone due on shift drops out first.
//
// All of it is RAM. The network is derived from content the server already holds, and an
// outing lasts hours, so a restart just means nobody's out tonight. No query anywhere.
//
// Seams: registerLifeDriver and walkNpcToward (server/engine/ai-behaviour.js) take the NPC
// off its graph while it's out; isVendorWorkTime/hoursUntilOpen and isNpcScheduledNow say
// who's free; the 1m scheduler tick calls the nights.

import { schedule } from '../../server/engine/scheduler.js';
import { world, getZone, getZonePlayers, resolveLanding } from '../../server/engine/world.js';
import {
  registerLifeDriver, walkNpcToward, isNpcAsleep, isVendorWorkTime, hoursUntilOpen,
} from '../../server/engine/ai-behaviour.js';
import { isNpcScheduledNow } from '../../server/engine/broadcast-bridge.js';
import { getEnvironmentState } from '../../server/engine/environment.js';
import { gameMsToReal } from '../../server/engine/gametime.js';

// ── Tunables ────────────────────────────────────────────────────────────────
export const MAX_FRIENDS      = 6;      // per NPC; the circle is trimmed by tie strength
export const MAX_CIRCLE       = 12;     // hard cap once other people's picks are added in
export const VENUE_TYPES      = new Set(['bar', 'pub', 'club', 'nightclub', 'honkytonk']);
const EVENING_FROM            = 18;     // game hour a night out can be called
const EVENING_TO              = 1;      // ...and the last hour one can (wraps midnight)
const OUTING_GAME_HOURS       = 3;      // how long they stay
const SHIFT_MARGIN_HOURS      = OUTING_GAME_HOURS + 2; // free means nothing on for this long
const MAX_PARTY               = 5;      // caller included
const MAX_LIVE_OUTINGS        = 6;      // across the city at once
const CALLS_PER_TICK          = 2;      // new nights out a minute can start
const CALL_CHANCE             = 0.35;   // per tick, per attempt
const GATHER_LIMIT_MS         = 8 * 60_000; // real time a member gets to walk there before they give up
const SAY_GAP_MS              = 90_000; // between table lines in one venue

// ── State (RAM only) ────────────────────────────────────────────────────────
const friends = new Map();   // npcId -> Set<npcId>
let venues = [];             // [{ id, facade, region, x, y, name }]
const outings = new Map();   // outingId -> outing
const memberOf = new Map();  // npcId -> outingId
const wentOut = new Map();   // npcId -> Date.now() their last night out was called
let seq = 0;

// ── Small helpers ───────────────────────────────────────────────────────────
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const zoneOf = (npc) => npc.zoneId ?? npc.zone_id;
function mapOf(zoneId) { return getZone(zoneId)?.map_id || null; }
function regionOf(zoneId) {
  const z = getZone(zoneId);
  if (!z) return null;
  if (z.flags?.region_id) return z.flags.region_id;
  const exit = z.flags?.world_exit_zone ? getZone(z.flags.world_exit_zone) : null;
  return exit?.flags?.region_id || null;
}
function gridOf(zoneId) {
  let z = getZone(zoneId);
  if (z && !Number.isFinite(z.grid_x) && z.flags?.world_exit_zone) z = getZone(z.flags.world_exit_zone);
  return z && Number.isFinite(z.grid_x) ? { x: z.grid_x, y: z.grid_y } : null;
}

// Somebody with a life of their own: a placed, non-hostile, graph-driven person with a home.
export function isSocialNpc(npc) {
  if (!npc || npc.instanceId != null || npc._dead) return false;
  if (!npc.home_zone || !npc.behaviour_graph?._start) return false;
  const f = npc.flags || {};
  if (f.set_aside || f.no_outings || f.stray_cat || f.covert || f.hostile) return false;
  return ['vendor', 'employed', 'unemployed', 'actor'].includes(npc.npc_type) || !!npc.work_zone_id || !!npc.vendor_schedule;
}

// ── The network ─────────────────────────────────────────────────────────────
// Ties are weighted: named friends 100, housemates 40, workmates 30, same building 10. Each NPC keeps
// its strongest MAX_FRIENDS, ties broken by a hash of the pair so the circle is the same every boot.
// A tie is mutual, so it's kept if either side keeps it.
export function buildNetwork(npcs = [...world.npcs.values()]) {
  friends.clear();
  const people = npcs.filter(isSocialNpc);
  const ids = new Set(people.map(n => n.id));
  const weight = new Map(); // "a|b" (a<b) -> score
  const tie = (a, b, w) => {
    if (a === b || !ids.has(a) || !ids.has(b)) return;
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    weight.set(k, (weight.get(k) || 0) + w);
  };
  const groups = (keyFn, w) => {
    const by = new Map();
    for (const n of people) {
      const k = keyFn(n);
      if (!k) continue;
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(n.id);
    }
    for (const list of by.values()) {
      if (list.length < 2 || list.length > 40) continue; // a 40-strong "building" is a district, not neighbours
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) tie(list[i], list[j], w);
    }
  };
  for (const n of people) {
    const named = n.flags?.friends;
    if (Array.isArray(named)) for (const f of named) tie(n.id, String(f), 100);
  }
  groups(n => n.home_zone, 40);
  groups(n => n.work_zone_id ? mapOf(n.work_zone_id) || n.work_zone_id : null, 30);
  groups(n => { const m = mapOf(n.home_zone); return m && m !== 'map_world' ? m : null; }, 10);

  const ranked = new Map(); // id -> [{ other, score }]
  for (const [k, w] of weight) {
    const [a, b] = k.split('|');
    const score = w + (hash(k) % 1000) / 1000;
    (ranked.get(a) || ranked.set(a, []).get(a)).push({ other: b, score });
    (ranked.get(b) || ranked.set(b, []).get(b)).push({ other: a, score });
  }
  for (const [id, list] of ranked) {
    list.sort((x, y) => y.score - x.score);
    for (const { other } of list.slice(0, MAX_FRIENDS)) {
      (friends.get(id) || friends.set(id, new Set()).get(id)).add(other);
      (friends.get(other) || friends.set(other, new Set()).get(other)).add(id);
    }
  }
  // A tie kept by the other side can push a popular NPC past its own picks, so cap every circle at
  // MAX_CIRCLE, dropping the weakest ties from both ends so friendship stays mutual.
  const scoreOf = (a, b) => { const k = a < b ? `${a}|${b}` : `${b}|${a}`; return weight.get(k) + (hash(k) % 1000) / 1000; };
  for (const [id, set] of friends) {
    if (set.size <= MAX_CIRCLE) continue;
    const weakest = [...set].sort((x, y) => scoreOf(id, y) - scoreOf(id, x)).slice(MAX_CIRCLE);
    for (const other of weakest) { set.delete(other); friends.get(other)?.delete(id); }
  }
  return friends;
}

export function friendsOf(npcId) { return [...(friends.get(npcId) || [])]; }

// ── Venues ──────────────────────────────────────────────────────────────────
// A bar, pub or club on the live map (not set aside), entered at its interior entry room. A zone can
// opt in with flags.outing_venue, or out with flags.no_outings.
export function buildVenues() {
  const seen = new Set();
  venues = [];
  for (const [id, z] of world.zones) {
    const f = z.flags || {};
    if (f.no_outings) continue;
    if (!f.outing_venue && !(z.map_id === 'map_world' && VENUE_TYPES.has(f.building_type))) continue;
    const room = resolveLanding(id);
    if (!room || seen.has(room) || !getZone(room)) continue;
    seen.add(room);
    const g = gridOf(id);
    venues.push({ id: room, facade: id, region: regionOf(id), x: g?.x, y: g?.y, name: f.building_name || z.name });
  }
  return venues;
}

export function venueFor(memberIds) {
  const homes = memberIds.map(id => world.npcs.get(id)?.home_zone).filter(Boolean);
  const region = regionOf(homes[0]);
  const pool = venues.filter(v => !region || v.region === region);
  if (!pool.length) return null;
  const pts = homes.map(gridOf).filter(Boolean);
  if (!pts.length) return pick(pool);
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const near = pool.filter(v => Number.isFinite(v.x))
    .map(v => ({ v, d: Math.hypot(v.x - cx, v.y - cy) }))
    .sort((a, b) => a.d - b.d).slice(0, 3);
  return near.length ? pick(near).v : pick(pool);
}

// ── Who's free ──────────────────────────────────────────────────────────────
function onShiftSoon(npc, env) {
  if (isNpcScheduledNow(npc.id)) return true;
  if (npc.vendor_schedule && Object.keys(npc.vendor_schedule).length) {
    if (isVendorWorkTime(npc, env).working) return true;
    const h = hoursUntilOpen(npc);
    if (h != null && h < SHIFT_MARGIN_HOURS) return true;
  }
  return false;
}

export function isFree(npc, env = getEnvironmentState()) {
  if (!isSocialNpc(npc) || memberOf.has(npc.id)) return false;
  const ai = npc._ai;
  if (!ai || ai.alarm || ai.dosedOut || ai.shopPaused) return false;
  if (npc._aboard || npc._escorting || npc._charterHeld || npc._combatTargetId) return false;
  if (isNpcAsleep(npc)) return false;
  return !onShiftSoon(npc, env);
}

function eveningNow(env) {
  const h = env.hour ?? 0;
  return EVENING_FROM <= EVENING_TO ? (h >= EVENING_FROM && h < EVENING_TO) : (h >= EVENING_FROM || h < EVENING_TO);
}
// One night out per NPC per game day: the gap is measured in real time scaled from game hours.
const outAgain = () => gameMsToReal(14 * 3600_000);
const wentOutRecently = (id, now) => now - (wentOut.get(id) || 0) < outAgain();

// ── Calling a night out ─────────────────────────────────────────────────────
export function callOuting(callerId, { env = getEnvironmentState(), force = false } = {}) {
  const caller = world.npcs.get(callerId);
  if (!caller || !isFree(caller, env)) return null;
  const now = Date.now();
  if (!force && wentOutRecently(callerId, now)) return null;
  const free = friendsOf(callerId)
    .map(id => world.npcs.get(id))
    .filter(n => n && isFree(n, env) && (force || !wentOutRecently(n.id, now)));
  if (!free.length) return null;
  free.sort(() => Math.random() - 0.5);
  const members = [callerId, ...free.slice(0, MAX_PARTY - 1).map(n => n.id)];
  const venue = venueFor(members);
  if (!venue) return null;
  const o = {
    id: `outing_${++seq}`,
    venue: venue.id,
    venueName: venue.name,
    caller: callerId,
    members: new Set(members),
    arrived: new Set(),
    startedAt: now,
    endsAt: now + gameMsToReal(OUTING_GAME_HOURS * 3600_000),
    lastSay: 0,
  };
  outings.set(o.id, o);
  for (const id of members) { memberOf.set(id, o.id); wentOut.set(id, now); }
  return o;
}

function names(ids) {
  const list = ids.map(id => world.npcs.get(id)?.name).filter(Boolean);
  if (list.length <= 1) return list[0] || '';
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

function say(zoneId, message, broadcast) {
  if (!broadcast || !zoneId) return;
  broadcast(zoneId, { type: 'zone_event', message });
}

function release(npc, o, { broadcast, ai, why } = {}) {
  memberOf.delete(npc.id);
  if (ai) { ai.patrolPath = []; ai.patrolTarget = null; ai._lifeActivity = null; }
  if (!o) return;
  o.members.delete(npc.id);
  const wasThere = o.arrived.delete(npc.id);
  if (wasThere && zoneOf(npc) === o.venue) {
    const rest = [...o.arrived];
    const line = why === 'shift'
      ? `${npc.name} checks the time, swears, and leaves for work.`
      : rest.length ? `${npc.name} says goodnight to ${names(rest)} and heads out.` : `${npc.name} finishes their drink and goes home.`;
    say(o.venue, line, broadcast);
  }
  if (o.members.size < 2) {
    for (const id of [...o.members]) {
      const m = world.npcs.get(id);
      memberOf.delete(id);
      if (m?._ai) { m._ai.patrolPath = []; m._ai.patrolTarget = null; }
      if (m && o.arrived.has(id) && zoneOf(m) === o.venue) say(o.venue, `${m.name} gives up on the night and goes home.`, broadcast);
    }
    outings.delete(o.id);
  }
}

const TABLE_LINES = [
  (a, b, rest) => `${a} buys a round for ${rest}.`,
  (a, b) => `${a} tells ${b} a story. ${b} doesn't believe a word of it.`,
  (a, b) => `${a} and ${b} argue about the hockey.`,
  (a, b) => `${a} pulls ${b} onto the floor. ${b} goes, complaining.`,
  (a, b) => `${a} laughs at something ${b} said, louder than it deserved.`,
  (a) => `${a} checks the time and orders another anyway.`,
  (a, b) => `${a} steals one of ${b}'s chips.`,
  (a, b) => `${a} leans over to ${b} and points out somebody across the room.`,
];

// ── The driver: holds a member while they're out ────────────────────────────
function drive(npc, { broadcast, query, ai, zoneId }) {
  const oid = memberOf.get(npc.id);
  if (!oid) return false;
  const o = outings.get(oid);
  if (!o) { memberOf.delete(npc.id); return false; }
  const now = Date.now();
  if (now >= o.endsAt) { release(npc, o, { broadcast, ai }); return false; }
  if (onShiftSoon(npc, getEnvironmentState()) && (hoursUntilOpen(npc) ?? 99) < 1.5) { release(npc, o, { broadcast, ai, why: 'shift' }); return false; }
  if (isNpcAsleep(npc) || ai.alarm || ai.dosedOut || npc._combatTargetId) { release(npc, o, { broadcast, ai }); return false; }

  if (zoneId !== o.venue) {
    if (o.arrived.has(npc.id)) o.arrived.delete(npc.id); // walked out somehow: go back
    if (now - o.startedAt > GATHER_LIMIT_MS) { release(npc, o, { broadcast, ai }); return false; }
    const r = walkNpcToward(npc, o.venue, broadcast, query);
    if (r === 'stuck') { release(npc, o, { broadcast, ai }); return false; }
    if (r !== 'arrived') return true;
  }

  if (!o.arrived.has(npc.id)) {
    const already = [...o.arrived];
    o.arrived.add(npc.id);
    say(o.venue, already.length
      ? `${npc.name} comes in, spots ${names(already)} and goes over.`
      : `${npc.name} comes in, looks round for somebody and takes a table.`, broadcast);
    return true;
  }

  // At the table. A line now and then, only with an audience and more than one of them there.
  if (o.arrived.size >= 2 && now - o.lastSay > SAY_GAP_MS && Math.random() < 0.15 && getZonePlayers(o.venue).length) {
    o.lastSay = now;
    const others = [...o.arrived].filter(id => id !== npc.id);
    const b = world.npcs.get(pick(others))?.name;
    if (b) say(o.venue, pick(TABLE_LINES)(npc.name, b, names(others)), broadcast);
  }
  return true;
}

// ── Tick ────────────────────────────────────────────────────────────────────
function tick() {
  if (!venues.length || !friends.size) return;
  const env = getEnvironmentState();
  if (!eveningNow(env)) return;
  for (let i = 0; i < CALLS_PER_TICK; i++) {
    if (outings.size >= MAX_LIVE_OUTINGS || Math.random() > CALL_CHANCE) break;
    const pool = [...friends.keys()];
    for (let tries = 0; tries < 12; tries++) {
      if (callOuting(pick(pool), { env })) break;
    }
  }
}

let booted = false;
export function boot() {
  buildVenues();
  buildNetwork();
  booted = true;
}

registerLifeDriver(drive);
schedule('1m', () => {
  try {
    if (!booted && world.npcs.size && world.zones.size) boot();
    tick();
  } catch (e) { console.error(`[outings] tick: ${e.message}`); }
});

export const commands = {};
export const _test = {
  drive, release, outings, memberOf, wentOut, friends,
  get venues() { return venues; },
  reset() { outings.clear(); memberOf.clear(); wentOut.clear(); },
};
