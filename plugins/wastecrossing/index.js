// Waste Crossing — void-travel Slice 1 (walking skeleton).
//
// Regions are islands. Between them is the VOID — no authored corridor, just a
// generated waste you cross on foot when you can't afford to fly. This slice is
// the walking skeleton of docs/systems-overland-void-travel.md: `venture` out
// from a perimeter gate and a deterministic LINEAR chain of transient rooms is
// generated, walked south room by room, and deposits you at a distant region.
// No loot, encounters, parties, traces, or map yet — those are later slices.
//
// It stands on the transient-zone substrate added to server/engine/world.js
// (registerTransientZone / removeTransientZone): synthetic zones that live in
// the world store without a DB row, so ordinary movement/describe/minimap treat
// a void room like any other zone. See the substrate contract in world.js.
//
// State model:
//   • Fast/live: player._crossing = { roomIds, gate, dest, heading, window, node }
//     — read on every zone.entered (the hot path), never the DB.
//   • Durable: crossing_gate / crossing_window / crossing_node in player_flags —
//     the minimum needed to RE-DERIVE the crossing after a server restart (the
//     transient rooms are RAM-only and vanish on reboot). A same-session
//     disconnect/reconnect needs nothing: the rooms are still in RAM.
//   • The geometry is a pure function of (gate, window, node), the seed model the
//     full design shares per (origin, window) so a later slice can make parties
//     walk the same map. Slice 1 is solo + linear: room IDs are namespaced per
//     player so teardown never touches another crosser, but the CONTENT is seeded
//     from the route, so a relog regenerates byte-identical rooms.

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
// Later slices author these in the World Editor (docs: "Where the graph lives").
// For the skeleton it's a single hard-coded edge: the Coldwater South Gate → the
// Reach. gate/dest are real DB zones; the void is everything the generator makes
// in between.
export const ROUTES = [{
  gate: 'zone_district_918_919',    // South Gate (Coldwater perimeter)
  dest: 'zone_the_reach_870_1958',  // Buzzard Field scrub (The Reach)
  heading: 'The Reach',
  length: 8,
}];

function routeFromGate(zoneId) { return ROUTES.find(r => r.gate === zoneId) || null; }
function routeByGate(gate) { return ROUTES.find(r => r.gate === gate) || null; }
function currentWindow() { return Math.floor(Date.now() / WEEK_MS); }

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

// One room = a pure function of (gate, window, node). North is back toward the
// gate, south is deeper into the waste; the ends stitch to the real DB zones.
function roomFor(player, route, window, node) {
  const rng = mulberry32(hashSeed(`${route.gate}|${window}|${node}`));
  const north = node === 0 ? route.gate : `void_${player.id}_${node - 1}`;
  const south = node === route.length - 1 ? route.dest : `void_${player.id}_${node + 1}`;
  return {
    id: `void_${player.id}_${node}`,
    name: pick(rng, ROOM_NAMES),
    description: pick(rng, ROOM_DESCS),
    map_id: VOID_MAP,
    grid_x: null, grid_y: null, grid_z: null,
    flags: { terrain: pick(rng, TERRAINS), void_crossing: true },
    exits: { north, south },
  };
}

// Register (or re-register, on relog) the whole chain and hang the live state on
// the player. Returns the room objects.
function instantiate(player, route, window) {
  const roomIds = [];
  for (let node = 0; node < route.length; node++) {
    const room = registerTransientZone(roomFor(player, route, window, node));
    roomIds.push(room.id);
  }
  player._crossing = { roomIds, gate: route.gate, dest: route.dest, heading: route.heading, window, node: 0 };
  return roomIds;
}

function teardown(player) {
  const c = player._crossing;
  if (!c) return;
  for (const id of c.roomIds) removeTransientZone(id);
  delete player._crossing;
}
async function clearCrossingFlags(player) {
  await clearFlag('player', 'crossing_gate', player).catch(() => {});
  await clearFlag('player', 'crossing_window', player).catch(() => {});
  await clearFlag('player', 'crossing_node', player).catch(() => {});
}

// ── `venture` — strike out from a gate into the waste ─────────────────────────
async function cmdVenture(args, raw, player, broadcast) {
  if (player._crossing) return { type: 'emote', message: 'You are already out in the waste. Keep moving — the only way through it is through it.' };
  const route = routeFromGate(player.current_zone);
  if (!route) return { type: 'emote', message: 'There is nowhere to strike out into the waste from here.' };
  if (!getZone(route.dest)) return { type: 'error', message: 'Whatever lies out past the waste, there is no reaching it right now.' };

  const window = currentWindow();
  const roomIds = instantiate(player, route, window);
  const first = getZone(roomIds[0]);

  await setFlag('player', 'crossing_gate', route.gate, player);
  await setFlag('player', 'crossing_window', String(window), player);
  await setFlag('player', 'crossing_node', '0', player);

  // Direct placement into room 0 — a teleport, NOT a directional move, so no
  // zone.entered fires here and the teardown hook can't trip on entry.
  const fromZone = player.current_zone;
  removePlayerFromZone(player.id, fromZone);
  addPlayerToZone(player.id, first.id);
  player.current_zone = first.id;
  await query('UPDATE players SET current_zone=$1 WHERE id=$2', [first.id, player.id]).catch(() => {});

  broadcast(fromZone, { type: 'zone_event', message: `${player.handle} turns their back on the wall and walks out into the waste.` }, player.id);
  const desc = await describeZone(first, player);
  return {
    type: 'move',
    message: `→ You strike out toward ${route.heading}. The wall falls away behind you and the waste swallows the road. There is no path now — only the going.\n\n${desc}`,
    zone: first.id,
    minimap: getMinimapData(first.id, 8, player),
  };
}

// ── Node tracking + teardown (every move within/out of the void) ──────────────
on('zone.entered', ({ actor, zone }) => {
  try {
    const c = actor?._crossing;
    if (!c) return;
    const idx = c.roomIds.indexOf(zone);
    if (idx >= 0) {
      // Stepped deeper (or back) within the void — track the node for relog.
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
    const gate = await getFlag('player', 'crossing_gate', player);
    if (!gate) return;
    const route = routeByGate(gate);
    if (!route) { await clearCrossingFlags(player); return; }

    const window = Number(await getFlag('player', 'crossing_window', player)) || currentWindow();
    let node = Number(await getFlag('player', 'crossing_node', player)) || 0;
    if (!(node >= 0 && node < route.length)) node = 0;

    const roomIds = instantiate(player, route, window);
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

console.log('[wastecrossing] Plugin loaded.');
