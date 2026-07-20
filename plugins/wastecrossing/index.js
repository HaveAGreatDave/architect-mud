// Waste Crossing — void-travel, on-foot travel between regions across the void.
//
// Regions are islands. Between them is the VOID — no authored corridor, just a
// generated waste you cross on foot when you can't afford to fly. Strike out from
// a perimeter edge and a deterministic LINEAR chain of transient rooms is
// generated, walked south room by room, and deposits you at a distant region.
// No loot, encounters, or ghost-traces yet — those are later slices.
//
// Two ways in, one code path (launchCrossing):
//   • Walk off the map — moving the tile's void-direction off a `flags.void_gate`
//     edge with no authored exit fires the engine's `movement.edge` hook.
//   • `venture` — the explicit verb, from the same edge tile.
//
// INSTANCING (Slice 4): a crossing is a per-crossing INSTANCE, keyed by a unique
// instance id and registered in `crossings`. A PARTY shares one instance; two
// separate crossings never share rooms (instanced — no live collision). The room
// CONTENT is seeded by (route, window, node) — the shared-geometry model — so every
// instance this window looks identical (and a relog regenerates it byte-for-byte),
// but each instance's room IDS are namespaced by the instance so teardown and
// occupancy are private. Cohort = the leader + everyone following them, co-present
// at the origin: it reads the FOLLOW substrate (player.following), never the party
// plugin — party membership expresses itself as follow, so the void needs no
// party-aware code and the two systems don't import each other.
//
// It stands on the transient-zone substrate in server/engine/world.js
// (registerTransientZone / removeTransientZone): synthetic zones that live in the
// world store without a DB row, so movement/describe/minimap treat a void room
// like any other zone.
//
// State model:
//   • Live: player._crossing = { instanceId, node } — read on every zone.entered
//     (the hot path). node is RAM-only and is NOT written per step.
//   • Shared: crossings.get(instanceId) = { key, roomIds, origin, dest, heading,
//     window, members:Set<pid> } — the instance, reference-counted by members.
//   • Durable (per member): crossing_route / crossing_window / crossing_origin /
//     crossing_instance / crossing_node in player_flags — the minimum to RE-DERIVE
//     the instance after a server restart. node is flushed lazily on player.logout,
//     not per step. A same-session reconnect needs nothing (rooms still in RAM).

import { getLivePlayer, getAllLivePlayers, getZone, getMinimapData, addPlayerToZone, removePlayerFromZone,
  registerTransientZone, removeTransientZone } from '../../server/engine/world.js';
import { describeZone } from '../../server/engine/commands/describe.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { on } from '../../server/engine/events.js';
import { getFlag, setFlag, clearFlag } from '../../server/engine/flags.js';
import { query } from '../../server/models/db.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const VOID_MAP = 'map_void'; // non-map_world → flag/map-filtered world iterators skip void rooms

// ── Routes (the region adjacency graph — skeleton stub, one edge) ──────────────
export const ROUTES = {
  reach: { dest: 'zone_the_reach_870_1958', heading: 'The Reach', length: 8 },
};

// instanceId -> { id, key, roomIds, origin, dest, heading, window, members:Set<pid> }
const crossings = new Map();
let _seq = 0;

function currentWindow() { return Math.floor(Date.now() / WEEK_MS); }

// A tile is a void gate if flags.void_gate names a known route. flags.void_dir
// (default 'south') is the direction you walk off the map into that route.
function voidGateOf(zone) {
  const key = zone?.flags?.void_gate;
  if (!key || !ROUTES[key]) return null;
  return { key, route: ROUTES[key], dir: zone.flags.void_dir || 'south' };
}

// ── Deterministic generator ───────────────────────────────────────────────────
function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

const TERRAINS = ['scrub', 'ash', 'redrock', 'marsh'];
const ROOM_NAMES = ['The Open Waste', 'A Sea of Dust', 'Cracked Hardpan', 'The Rust Flats',
  'A Dead Wash', 'Bone Country', 'The Long Nothing', 'Ashfall', 'Scoured Flat', 'The Grey Miles'];
const ROOM_DESCS = [
  'Heat-shimmer boils off a horizon with nothing on it. Every direction looks the same, which is to say: bad.',
  'Grit hisses across cracked ground. The wind carries a chemical tang and no mercy.',
  'Rusted wreckage juts from the dust like the bones of something that died mid-crawl.',
  'The ground crunches, brittle and pale. Whatever grew here gave up a long time ago.',
  'A dry wash cuts the flat, choked with wind-scoured debris and the smell of old rot.',
  'Sun-bleached and silent — the kind of quiet that makes you check over your shoulder.',
  'Distance stops meaning anything out here. You walk, and the nothing walks with you.',
  'Fine grey ash drifts down from a colorless sky, settling on your shoulders like a verdict.',
];

// A room's CONTENT is a pure function of (route, window, node) — shared geometry,
// so every instance this window is identical and relog regenerates it exactly. Its
// room IDS are namespaced by the instance, so occupancy/teardown are private.
function roomFor(instanceId, key, route, window, node, origin) {
  const rng = mulberry32(hashSeed(`${key}|${window}|${node}`));
  const north = node === 0 ? origin : `${instanceId}_${node - 1}`;
  const south = node === route.length - 1 ? route.dest : `${instanceId}_${node + 1}`;
  return {
    id: `${instanceId}_${node}`,
    name: pick(rng, ROOM_NAMES),
    description: pick(rng, ROOM_DESCS),
    map_id: VOID_MAP,
    grid_x: null, grid_y: null, grid_z: null,
    flags: { terrain: pick(rng, TERRAINS), void_crossing: true },
    exits: { north, south },
  };
}

// Get or build (on launch, or regenerate on relog) an instance's rooms + registry
// entry. Idempotent: a second member relogging after a restart joins the instance
// the first one already rebuilt.
function ensureInstance(instanceId, key, window, origin) {
  let c = crossings.get(instanceId);
  if (c) return c;
  const route = ROUTES[key];
  const roomIds = [];
  for (let node = 0; node < route.length; node++)
    roomIds.push(registerTransientZone(roomFor(instanceId, key, route, window, node, origin)).id);
  c = { id: instanceId, key, roomIds, origin, dest: route.dest, heading: route.heading, window, members: new Set() };
  crossings.set(instanceId, c);
  return c;
}

function teardownInstance(c) {
  for (const id of c.roomIds) removeTransientZone(id);
  crossings.delete(c.id);
}
async function clearCrossingFlags(player) {
  for (const k of ['crossing_route', 'crossing_window', 'crossing_node', 'crossing_origin', 'crossing_instance'])
    await clearFlag('player', k, player).catch(() => {});
}

// Place one member into room 0 of the instance and stamp their durable state.
async function enterMember(m, c, first, origin) {
  removePlayerFromZone(m.id, m.current_zone);
  addPlayerToZone(m.id, first.id);
  m.current_zone = first.id;
  m._crossing = { instanceId: c.id, node: 0 };
  c.members.add(m.id);
  await query('UPDATE players SET current_zone=$1 WHERE id=$2', [first.id, m.id]).catch(() => {});
  await setFlag('player', 'crossing_route', c.key, m);
  await setFlag('player', 'crossing_window', String(c.window), m);
  await setFlag('player', 'crossing_origin', origin, m);
  await setFlag('player', 'crossing_instance', c.id, m);
  await setFlag('player', 'crossing_node', '0', m);
}

// Remove one member from the void (arrived / bailed / died / tp'd). Reference-
// counted: the instance's transient rooms are torn down only when the last member
// leaves — so a party member who lingers keeps the instance alive for the others.
function leaveCrossing(member, arrived) {
  const live = member._crossing;
  delete member._crossing;
  clearCrossingFlags(member).catch(() => {});
  const c = live && crossings.get(live.instanceId);
  if (!c) return;
  c.members.delete(member.id);
  if (arrived) sendToPlayer(member.id, { type: 'output', message: `<span class="item-grant">You stagger up out of the waste onto solid ground. You crossed it on foot. You made it to ${c.heading}.</span>` });
  if (c.members.size === 0) teardownInstance(c);
}

// ── Entry (shared by the verb and the walk-off-map hook) ──────────────────────
async function launchCrossing(leader, gate, broadcast) {
  if (leader._crossing) return { type: 'emote', message: 'You are already out in the waste. The only way through it is through it.' };
  const origin = leader.current_zone;
  const window = currentWindow();
  const instanceId = `xing_${leader.id}_${++_seq}`;
  const c = ensureInstance(instanceId, gate.key, window, origin);
  const first = getZone(c.roomIds[0]);

  // Cohort = the leader + everyone following them, co-present at the origin (the
  // follow substrate — a party expresses itself as follow). Not already crossing.
  const followers = getAllLivePlayers().filter(p =>
    p.id !== leader.id && p.following === leader.id && p.current_zone === origin && !p._crossing);
  for (const m of [leader, ...followers]) await enterMember(m, c, first, origin);

  if (broadcast) broadcast(origin, { type: 'zone_event', message: `${leader.handle}${followers.length ? ' and their party' : ''} walk out past the edge, into the waste.` }, leader.id);

  // Followers get their own pushed arrival view; the leader's is the verb return.
  for (const f of followers) {
    const fdesc = await describeZone(first, f);
    sendToPlayer(f.id, { type: 'move', message: `You follow ${leader.handle} out past the edge, into the waste.\n\n${fdesc}`, zone: first.id, minimap: getMinimapData(first.id, 8, f) });
  }
  const partyNote = followers.length ? ` ${followers.length === 1 ? 'One follows' : `${followers.length} follow`} you.` : '';
  const desc = await describeZone(first, leader);
  return {
    type: 'move',
    message: `→ You strike out toward ${gate.route.heading}. The edge of the map falls away behind you and the waste swallows the road.${partyNote} There is no path now — only the going.\n\n${desc}`,
    zone: first.id,
    minimap: getMinimapData(first.id, 8, leader),
  };
}

// ── `venture` — the explicit verb ────────────────────────────────────────────
async function cmdVenture(args, raw, player, broadcast) {
  if (player._crossing) return { type: 'emote', message: 'You are already out in the waste. The only way through it is through it.' };
  const gate = voidGateOf(getZone(player.current_zone));
  if (!gate) return { type: 'emote', message: 'There is nowhere to strike out into the waste from here.' };
  if (!getZone(gate.route.dest)) return { type: 'error', message: 'Whatever lies out past the waste, there is no reaching it right now.' };
  return launchCrossing(player, gate, broadcast);
}

// ── Walk off the map — the passive-edge departure ─────────────────────────────
async function onMovementEdge({ player, zone, direction, broadcast }) {
  if (player._crossing) return undefined;
  const gate = voidGateOf(zone);
  if (!gate || direction !== gate.dir) return undefined;
  if (!getZone(gate.route.dest)) return undefined; // route closed → let the wall stand
  return launchCrossing(player, gate, broadcast);
}

// ── Node tracking + teardown (every move within/out of the void) ──────────────
on('zone.entered', ({ actor, zone }) => {
  try {
    const live = actor?._crossing;
    if (!live) return;
    const c = crossings.get(live.instanceId);
    if (!c) { delete actor._crossing; return; }
    const idx = c.roomIds.indexOf(zone);
    if (idx >= 0) { live.node = idx; return; } // RAM only — node is flushed on logout, not per step
    leaveCrossing(actor, zone === c.dest);
  } catch (e) { console.error('[wastecrossing] zone.entered error:', e.message); }
});

// ── Lazy node flush + RAM reclaim on a clean disconnect ──────────────────────
on('player.logout', ({ id }) => {
  try {
    const player = getLivePlayer(id);
    const live = player?._crossing;
    if (!live) return;
    setFlag('player', 'crossing_node', String(live.node), player).catch(() => {}); // durable flush for restart-relog
    const c = crossings.get(live.instanceId);
    delete player._crossing;
    if (c) { c.members.delete(id); if (c.members.size === 0) teardownInstance(c); }
  } catch (e) { console.error('[wastecrossing] player.logout error:', e.message); }
});

// ── Relog re-derivation (after a server restart wiped the RAM rooms) ──────────
on('player.login', async ({ id }) => {
  try {
    const player = getLivePlayer(id);
    if (!player) return;
    const key = await getFlag('player', 'crossing_route', player);
    if (!key) return;
    const instanceId = await getFlag('player', 'crossing_instance', player);
    if (!ROUTES[key] || !instanceId) { await clearCrossingFlags(player); return; }
    const route = ROUTES[key];
    const window = Number(await getFlag('player', 'crossing_window', player)) || currentWindow();
    const origin = (await getFlag('player', 'crossing_origin', player)) || null;
    let node = Number(await getFlag('player', 'crossing_node', player)) || 0;
    if (!(node >= 0 && node < route.length)) node = 0;

    const c = ensureInstance(instanceId, key, window, origin);
    const room = getZone(c.roomIds[node]);
    removePlayerFromZone(player.id, player.current_zone);
    addPlayerToZone(player.id, room.id);
    player.current_zone = room.id;
    player._crossing = { instanceId, node };
    c.members.add(player.id);
    await query('UPDATE players SET current_zone=$1 WHERE id=$2', [room.id, player.id]).catch(() => {});

    const desc = await describeZone(room, player);
    sendToPlayer(player.id, {
      type: 'move',
      message: `You come to in the middle of the waste, right where you left off. The crossing goes on.\n\n${desc}`,
      zone: room.id,
      minimap: getMinimapData(room.id, 8, player),
    });
  } catch (e) { console.error('[wastecrossing] player.login error:', e.message); }
});

export const commands = {
  venture: cmdVenture,
};

export const hooks = {
  'movement.edge': onMovementEdge,
};

export const _test = { crossings, ROUTES };

console.log('[wastecrossing] Plugin loaded.');
