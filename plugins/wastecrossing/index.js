// Waste Crossing — void-travel Slice 1 (walking skeleton).
//
// Regions are islands. Between them is the VOID — no authored corridor, just a
// generated waste you cross on foot when you can't afford to fly. This slice is
// the walking skeleton of docs/systems-overland-void-travel.md: strike out from a
// perimeter edge and a deterministic LINEAR chain of transient rooms is
// generated, walked south room by room, and deposits you at a distant region.
// No loot, encounters, parties, traces, or map yet — those are later slices.
//
// Two ways in, one code path (launchCrossing):
//   • Walk off the map — moving the tile's void-direction off a `flags.void_gate`
//     edge with no authored exit fires the engine's `movement.edge` hook (the
//     passive-edge departure the design calls for).
//   • `venture` — the explicit, discoverable verb, from the same edge tile.
//
// It stands on the transient-zone substrate in server/engine/world.js
// (registerTransientZone / removeTransientZone): synthetic zones that live in the
// world store without a DB row, so movement/describe/minimap treat a void room
// like any other zone. See the substrate contract in world.js.
//
// State model:
//   • Fast/live: player._crossing = { key, roomIds, origin, dest, heading, node }
//     — read on every zone.entered (the hot path), never the DB.
//   • Durable: crossing_route / crossing_window / crossing_node / crossing_origin
//     in player_flags — the minimum to RE-DERIVE the crossing after a server
//     restart (the transient rooms are RAM-only and vanish on reboot). A same-
//     session disconnect/reconnect needs nothing: the rooms are still in RAM.
//   • Geometry is a pure function of (route, window, node) — the seed model the
//     full design shares per route+window so a later slice can put parties on the
//     same map. Slice 1 is solo + linear: room IDs are namespaced per player so
//     teardown never touches another crosser, but the CONTENT is seeded from the
//     route, so a relog regenerates byte-identical rooms.

import { getLivePlayer, getZone, getMinimapData, addPlayerToZone, removePlayerFromZone,
  registerTransientZone, removeTransientZone, isTransientZone } from '../../server/engine/world.js';
import { describeZone } from '../../server/engine/commands/describe.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { on } from '../../server/engine/events.js';
import { getFlag, setFlag, clearFlag } from '../../server/engine/flags.js';
import { query } from '../../server/models/db.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const VOID_MAP = 'map_void'; // non-map_world → flag/map-filtered world iterators skip void rooms

// ── Routes (the region adjacency graph — skeleton stub, one edge) ──────────────
// Keyed by route id. Later slices author these in the World Editor (docs: "Where
// the graph lives"). A tile becomes an entry by carrying flags.void_gate=<key>
// (+ optional flags.void_dir, default 'south'); dest is a real DB zone.
export const ROUTES = {
  reach: { dest: 'zone_the_reach_870_1958', heading: 'The Reach', length: 8 },
};

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

// One room = a pure function of (route, window, node). North is back toward the
// gate/origin, south is deeper; the ends stitch to the real DB zones.
function roomFor(player, key, route, window, node, originZoneId) {
  const rng = mulberry32(hashSeed(`${key}|${window}|${node}`));
  const base = `void_${player.id}_${key}`;
  const north = node === 0 ? originZoneId : `${base}_${node - 1}`;
  const south = node === route.length - 1 ? route.dest : `${base}_${node + 1}`;
  return {
    id: `${base}_${node}`,
    name: pick(rng, ROOM_NAMES),
    description: pick(rng, ROOM_DESCS),
    map_id: VOID_MAP,
    grid_x: null, grid_y: null, grid_z: null,
    flags: { terrain: pick(rng, TERRAINS), void_crossing: true },
    exits: { north, south },
  };
}

// Register (or re-register, on relog) the whole chain and hang the live state on
// the player. Returns the room ids.
function instantiate(player, key, route, window, originZoneId) {
  const roomIds = [];
  for (let node = 0; node < route.length; node++) {
    const room = registerTransientZone(roomFor(player, key, route, window, node, originZoneId));
    roomIds.push(room.id);
  }
  player._crossing = { key, roomIds, origin: originZoneId, dest: route.dest, heading: route.heading, window, node: 0 };
  return roomIds;
}

function teardown(player) {
  const c = player._crossing;
  if (!c) return;
  for (const id of c.roomIds) removeTransientZone(id);
  delete player._crossing;
}
async function clearCrossingFlags(player) {
  for (const k of ['crossing_route', 'crossing_window', 'crossing_node', 'crossing_origin'])
    await clearFlag('player', k, player).catch(() => {});
}

// ── Entry (shared by the verb and the walk-off-map hook) ──────────────────────
async function launchCrossing(player, gate, broadcast) {
  const originZoneId = player.current_zone;
  const window = currentWindow();
  const roomIds = instantiate(player, gate.key, gate.route, window, originZoneId);
  const first = getZone(roomIds[0]);

  await setFlag('player', 'crossing_route', gate.key, player);
  await setFlag('player', 'crossing_window', String(window), player);
  await setFlag('player', 'crossing_node', '0', player);
  await setFlag('player', 'crossing_origin', originZoneId, player);

  // Direct placement into room 0 — a teleport, NOT a directional move, so no
  // zone.entered fires here and the teardown hook can't trip on entry.
  removePlayerFromZone(player.id, originZoneId);
  addPlayerToZone(player.id, first.id);
  player.current_zone = first.id;
  await query('UPDATE players SET current_zone=$1 WHERE id=$2', [first.id, player.id]).catch(() => {});

  if (broadcast) broadcast(originZoneId, { type: 'zone_event', message: `${player.handle} walks out past the edge, into the waste.` }, player.id);
  const desc = await describeZone(first, player);
  return {
    type: 'move',
    message: `→ You strike out toward ${gate.route.heading}. The edge of the map falls away behind you and the waste swallows the road. There is no path now — only the going.\n\n${desc}`,
    zone: first.id,
    minimap: getMinimapData(first.id, 8, player),
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
// Fires from cmdMove when a direction has no authored exit. If you're on a void
// gate tile and walking its void-direction, that's you stepping off the edge into
// the waste. Returning a move result makes it the outcome; undefined falls through
// to the normal "No exit that way".
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
    const c = actor?._crossing;
    if (!c) return;
    const idx = c.roomIds.indexOf(zone);
    if (idx >= 0) {
      c.node = idx;
      setFlag('player', 'crossing_node', String(idx), actor).catch(() => {});
      return;
    }
    // Entered a non-void zone → the crossing is over (arrived / bailed / died / tp'd).
    const arrived = zone === c.dest;
    teardown(actor);
    clearCrossingFlags(actor).catch(() => {});
    if (arrived) sendToPlayer(actor.id, { type: 'output', message: `<span class="item-grant">You stagger up out of the waste onto solid ground. You crossed it on foot. You made it to ${c.heading}.</span>` });
  } catch (e) { console.error('[wastecrossing] zone.entered error:', e.message); }
});

// ── Relog re-derivation (after a server restart wiped the RAM rooms) ──────────
on('player.login', async ({ id }) => {
  try {
    const player = getLivePlayer(id);
    if (!player) return;
    const key = await getFlag('player', 'crossing_route', player);
    if (!key) return;
    if (!ROUTES[key]) { await clearCrossingFlags(player); return; }
    const route = ROUTES[key];

    const window = Number(await getFlag('player', 'crossing_window', player)) || currentWindow();
    const origin = (await getFlag('player', 'crossing_origin', player)) || null;
    let node = Number(await getFlag('player', 'crossing_node', player)) || 0;
    if (!(node >= 0 && node < route.length)) node = 0;

    const roomIds = instantiate(player, key, route, window, origin);
    player._crossing.node = node;
    const room = getZone(roomIds[node]);

    // The login flow already rescued them to zone_start (their void room was gone
    // after the restart). Pull them back into the regenerated room.
    removePlayerFromZone(player.id, player.current_zone);
    addPlayerToZone(player.id, room.id);
    player.current_zone = room.id;
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

console.log('[wastecrossing] Plugin loaded.');
