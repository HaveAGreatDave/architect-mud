// plugins/outings/index.js
//
// Friends and nights out. Every NPC with a home gets a small circle of friends, worked out
// at boot from who they work with, who they live with, who lives in their building and
// who an author named in flags.friends. Each evening has a plan worked out from the game
// date (planEvening), so every server and every restart agrees who's out where: nights out
// at a bar or club, and house parties at a host's flat. At its hour each event starts, its
// free members walk from wherever they are, meet, stay a few game hours and go home.
// Anyone due on shift drops out first. tonight() is the list, for anything telling players.
//
// All of it is RAM. The network is derived from content the server already holds, and an
// plan is a pure function of the date, so a restart picks tonight back up. No query anywhere.
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
const OUTING_GAME_HOURS       = 3;      // how long they stay
const SHIFT_MARGIN_HOURS      = OUTING_GAME_HOURS + 2; // free means nothing on for this long
const MAX_PARTY               = 5;      // caller included
const BAR_NIGHTS              = 6;      // nights out planned per evening
const HOUSE_PARTIES           = 3;      // house parties planned per evening
const HOUSE_GAME_HOURS        = 4;      // a house party runs longer than a round at the bar
const MAX_HOUSE_PARTY         = 8;      // host included
const GATHER_LIMIT_MS         = 8 * 60_000; // real time a member gets to walk there before they give up
const SAY_GAP_MS              = 90_000; // between table lines in one venue

// ── State (RAM only) ────────────────────────────────────────────────────────
const friends = new Map();   // npcId -> Set<npcId>
let venues = [];             // [{ id, facade, region, x, y, name }]
const outings = new Map();   // outingId -> outing
const memberOf = new Map();  // npcId -> outingId
let plan = null;             // { key, events: [...] } for the evening in hand
const launched = new Set();  // plan event ids already started (or given up on) this evening
let seq = 0;

// ── Small helpers ───────────────────────────────────────────────────────────
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const pick = (arr, rnd = Math.random) => arr[Math.floor(rnd() * arr.length)];
// mulberry32: a small seeded generator, so a seed gives the same draws on any server.
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
function shuffled(arr, rnd) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
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

export function venueFor(memberIds, rnd = Math.random) {
  const homes = memberIds.map(id => world.npcs.get(id)?.home_zone).filter(Boolean);
  const region = regionOf(homes[0]);
  const pool = venues.filter(v => !region || v.region === region);
  if (!pool.length) return null;
  const pts = homes.map(gridOf).filter(Boolean);
  if (!pts.length) return pick(pool, rnd);
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const near = pool.filter(v => Number.isFinite(v.x))
    .map(v => ({ v, d: Math.hypot(v.x - cx, v.y - cy) }))
    .sort((a, b) => a.d - b.d).slice(0, 3);
  return near.length ? pick(near, rnd).v : pick(pool, rnd);
}

// A flat somebody can throw a party in: their own home, a real room off the street map, not opted out.
function partyFlat(npc) {
  const z = npc && getZone(npc.home_zone);
  if (!z || z.map_id === 'map_world' || z.flags?.no_outings || z.flags?.no_house_parties) return null;
  return npc.home_zone;
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

// ── The evening's plan ──────────────────────────────────────────────────────
// Who goes out where, and when, is worked out from the game date alone: the same date gives the
// same plan on any server and after any restart, so the city has one known list of tonight's
// nights out and house parties (tonight()). The plan only reads things that are fixed for the
// evening (the network, the venues, shift rotas). Live state (asleep, fighting, shopping) is
// checked when an event starts and drops members then, so the plan is who was meant to go.

// An evening runs from 12:00 one day to 12:00 the next, so after midnight it's still last night.
function eveningOf(env) {
  if (!env.date) return null;
  if ((env.hour ?? 0) >= 12) return { date: env.date, dayOfWeek: env.dayOfWeek };
  const d = new Date(`${env.date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return { date: new Date(d.getTime() - 86_400_000).toISOString().slice(0, 10), dayOfWeek: ((env.dayOfWeek + 5) % 7) + 1 };
}
// Minutes since 12:00 on the evening's first day.
const eveningMinute = (env) => ((env.minutes ?? (env.hour ?? 0) * 60) + 1440 - 720) % 1440;

// Off shift for the whole stretch, by the rota alone.
function rotaFree(npc, dayOfWeek, startMin, hours) {
  if (!npc.vendor_schedule || !Object.keys(npc.vendor_schedule).length) return true;
  for (let m = startMin; m <= startMin + hours * 60 + 120; m += 60) {
    const clock = (720 + m) % 1440;
    const dow = 720 + m >= 1440 ? (dayOfWeek % 7) + 1 : dayOfWeek;
    if (isVendorWorkTime(npc, { dayOfWeek: dow, hour: Math.floor(clock / 60) }).working) return false;
  }
  return true;
}

export function planEvening(date, dayOfWeek) {
  const rnd = seeded(hash(`outings|${date}`));
  const booked = new Set();
  const events = [];
  const people = [...friends.keys()].sort().map(id => world.npcs.get(id)).filter(isSocialNpc);
  const fmt = (m) => { const c = (720 + m) % 1440; return `${String(Math.floor(c / 60)).padStart(2, '0')}:${String(c % 60).padStart(2, '0')}`; };

  const fill = (kind, want, from, to, hours, cap, minGuests) => {
    let made = 0;
    for (const host of shuffled(people, rnd)) {
      if (made >= want) break;
      if (booked.has(host.id)) continue;
      const start = from + Math.floor(rnd() * (to - from));
      if (!rotaFree(host, dayOfWeek, start, hours)) continue;
      let where = null;
      if (kind === 'house') { where = partyFlat(host); if (!where) continue; }
      const guests = shuffled(friendsOf(host.id).sort(), rnd)
        .map(id => world.npcs.get(id))
        .filter(n => n && isSocialNpc(n) && !booked.has(n.id) && rotaFree(n, dayOfWeek, start, hours))
        .slice(0, cap - 1);
      if (guests.length < minGuests) continue;
      const members = [host.id, ...guests.map(n => n.id)];
      let venueName;
      if (kind === 'bar') {
        const v = venueFor(members, rnd);
        if (!v) continue;
        where = v.id; venueName = v.name;
      } else {
        venueName = `${host.name}'s place`;
      }
      for (const id of members) booked.add(id);
      events.push({ id: `${date}|${kind}|${host.id}`, kind, host: host.id, members, venue: where, venueName, start, hours, at: fmt(start) });
      made++;
    }
  };
  // House parties first, so a host isn't already booked for the bar. They start later and run longer.
  fill('house', HOUSE_PARTIES, 8 * 60, 11 * 60, HOUSE_GAME_HOURS, MAX_HOUSE_PARTY, 2);
  fill('bar', BAR_NIGHTS, 6 * 60, 11 * 60, OUTING_GAME_HOURS, MAX_PARTY, 1);
  events.sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
  return { key: date, events };
}

function planFor(env) {
  const ev = eveningOf(env);
  if (!ev) return null;
  if (plan?.key !== ev.date) { plan = planEvening(ev.date, ev.dayOfWeek); launched.clear(); }
  return plan;
}

// Tonight's list, for anything that wants to tell players: [{ kind, at, venue, venueName, host, members }].
// Names, not ids, in `who`; `live` says whether it has started and who actually turned up.
export function tonight(env = getEnvironmentState()) {
  const p = planFor(env);
  if (!p) return [];
  return p.events.map(e => {
    const o = [...outings.values()].find(x => x.planId === e.id);
    return {
      kind: e.kind, at: e.at, venue: e.venue, venueName: e.venueName,
      host: world.npcs.get(e.host)?.name, who: e.members.map(id => world.npcs.get(id)?.name).filter(Boolean),
      live: o ? { there: [...o.arrived].map(id => world.npcs.get(id)?.name).filter(Boolean) } : null,
    };
  });
}

// ── Starting an event ───────────────────────────────────────────────────────
// The planned members who are free right now go; the host has to be one of them.
function launch(e, env, { force = false, now = Date.now() } = {}) {
  const host = world.npcs.get(e.host);
  if (!host || !isFree(host, env)) return null;
  const going = e.members.slice(1).map(id => world.npcs.get(id)).filter(n => n && (force || isFree(n, env)));
  if (!going.length) return null;
  const members = [e.host, ...going.map(n => n.id)];
  const left = force ? e.hours * 60 : Math.max(30, e.start + e.hours * 60 - eveningMinute(env));
  const o = {
    id: `outing_${++seq}`,
    planId: e.id,
    kind: e.kind,
    venue: e.venue,
    venueName: e.venueName,
    caller: e.host,
    members: new Set(members),
    arrived: new Set(),
    startedAt: now,
    endsAt: now + gameMsToReal(left * 60_000),
    lastSay: 0,
  };
  outings.set(o.id, o);
  for (const id of members) memberOf.set(id, o.id);
  return o;
}

// An unplanned night out, called now (tests and dev tools). kind 'house' throws it at the caller's flat.
export function callOuting(callerId, { env = getEnvironmentState(), force = false, kind = 'bar' } = {}) {
  const caller = world.npcs.get(callerId);
  if (!caller || !isFree(caller, env)) return null;
  const free = friendsOf(callerId).map(id => world.npcs.get(id)).filter(n => n && isFree(n, env));
  if (!free.length) return null;
  const members = [callerId, ...shuffled(free, Math.random).slice(0, (kind === 'house' ? MAX_HOUSE_PARTY : MAX_PARTY) - 1).map(n => n.id)];
  let venue, venueName;
  if (kind === 'house') { venue = partyFlat(caller); venueName = `${caller.name}'s place`; }
  else { const v = venueFor(members); venue = v?.id; venueName = v?.name; }
  if (!venue) return null;
  const hours = kind === 'house' ? HOUSE_GAME_HOURS : OUTING_GAME_HOURS;
  return launch({ id: `adhoc|${++seq}`, kind, host: callerId, members, venue, venueName, start: 0, hours }, env, { force });
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
  if (o?.kind === 'house' && npc.id === o.caller && o.members.size > 1) return endParty(o, npc, { broadcast, ai, why });
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

// The host has to go (work, a fight, asleep on the sofa): the guests are shown out.
function endParty(o, host, { broadcast, ai, why }) {
  const guests = [...o.arrived].filter(id => id !== host.id);
  if (guests.length && zoneOf(host) === o.venue) {
    say(o.venue, why === 'shift'
      ? `${host.name} has work in the morning and starts turning the lights on. ${names(guests)} take the hint.`
      : `${host.name} calls it a night. ${names(guests)} find their coats.`, broadcast);
  }
  for (const id of [...o.members]) {
    memberOf.delete(id);
    const m = world.npcs.get(id);
    if (m?._ai) { m._ai.patrolPath = []; m._ai.patrolTarget = null; m._ai._lifeActivity = null; }
  }
  if (ai) { ai.patrolPath = []; ai.patrolTarget = null; ai._lifeActivity = null; }
  outings.delete(o.id);
}

const HOUSE_LINES = [
  (a, b) => `${a} turns the music up. ${b} turns it back down.`,
  (a, b) => `${a} and ${b} end up in the kitchen, the way people do.`,
  (a) => `Somebody bangs on the wall. ${a} bangs back.`,
  (a, b) => `${a} finds the last of the good stuff and shares it with ${b}.`,
  (a, b) => `${a} tells ${b} the flat's bigger than it looks. It isn't.`,
  (a, b, rest) => `${a} hands round drinks to ${rest}.`,
  (a, b) => `${a} spills something on ${b}'s shoes and apologises twice.`,
];

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
    const host = world.npcs.get(o.caller)?.name;
    say(o.venue, o.kind === 'house'
      ? (npc.id === o.caller ? `${npc.name} clears the table and puts some music on.`
        : already.length ? `${npc.name} knocks and ${o.arrived.has(o.caller) ? host : names(already)} lets them in.` : `${npc.name} turns up early and waits for ${host}.`)
      : already.length
        ? `${npc.name} comes in, spots ${names(already)} and goes over.`
        : `${npc.name} comes in, looks round for somebody and takes a table.`, broadcast);
    return true;
  }

  // At the table. A line now and then, only with an audience and more than one of them there.
  if (o.arrived.size >= 2 && now - o.lastSay > SAY_GAP_MS && Math.random() < 0.15 && getZonePlayers(o.venue).length) {
    o.lastSay = now;
    const others = [...o.arrived].filter(id => id !== npc.id);
    const b = world.npcs.get(pick(others))?.name;
    if (b) say(o.venue, pick(o.kind === 'house' ? HOUSE_LINES : TABLE_LINES)(npc.name, b, names(others)), broadcast);
  }
  return true;
}

// ── Tick ────────────────────────────────────────────────────────────────────
function tick() {
  if (!venues.length || !friends.size) return;
  const env = getEnvironmentState();
  const p = planFor(env);
  if (!p) return;
  const m = eveningMinute(env);
  for (const e of p.events) {
    if (launched.has(e.id) || m < e.start) continue;
    if (m >= e.start + e.hours * 60 - 30) { launched.add(e.id); continue; } // too late to bother
    // Retried each minute until the host is free, so a host stuck at work just starts late.
    if (launch(e, env)) launched.add(e.id);
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
  drive, release, outings, memberOf, friends, launched,
  get venues() { return venues; },
  reset() { outings.clear(); memberOf.clear(); launched.clear(); plan = null; },
};
