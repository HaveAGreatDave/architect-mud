// Waste Crossing — void-travel, on-foot travel between regions across the void.
//
// Regions are islands. Between them is the VOID — no authored corridor, just a
// generated waste you cross on foot when you can't afford to fly. Strike out from a
// perimeter edge and a deterministic graph of transient rooms is generated, walked
// on foot, and deposits you at a distant region.
//
// Two ways in, one code path (launchCrossing):
//   • Walk off the map — moving the void-direction off a `flags.void_gate` edge with
//     no authored exit fires the engine's `movement.edge` hook.
//   • `journey [heading]` — the explicit verb, from the same edge tile.
//
// THE BRAID: a void off a gate is a SHARED TRUNK that forks toward MULTIPLE
// destinations. You walk the trunk (identical for everyone this window), reach the
// fork, and choose a limb toward a region — hold your declared heading, or divert to
// a neighbour. Off trunk rooms hang risk-for-loot DETOURS (a lateral `west` gamble).
//
// INSTANCING (Slice 4): a crossing is a per-crossing INSTANCE (unique id) in
// `crossings`. A PARTY shares one instance; two crossings never share rooms
// (instanced — no live collision). Room CONTENT is seeded by (void, window, salt) —
// shared geometry — so every instance this window is identical (relog regenerates it
// byte-for-byte), but room IDS are namespaced by the instance so occupancy/teardown
// are private. Cohort = the leader + everyone FOLLOWING them (the follow substrate,
// never the party plugin) co-present at the origin.
//
// ENCOUNTERS (Slice 2): on first arrival at a non-threshold room a live roll spawns a
// real enemy from the void roster — real combat via spawnEnemySync; despawned on
// teardown. Detour rooms roll hotter.
//
// State model:
//   • Live: player._crossing = { instanceId, seen:Set } — read on every zone.entered.
//   • Shared: crossings.get(id) = { voidKey, roomSet, detourSet, destSet, dests,
//     entry, origin, window, members:Set, enemies:Set } — reference-counted.
//   • Durable (per member): crossing_void / crossing_window / crossing_origin /
//     crossing_instance / crossing_room in player_flags — enough to RE-DERIVE the
//     instance after a server restart. crossing_room is flushed on player.logout, not
//     per step. A same-session reconnect needs nothing (rooms still in RAM).

import { getLivePlayer, getAllLivePlayers, getZone, getMinimapData, addPlayerToZone, removePlayerFromZone,
  registerTransientZone, removeTransientZone, spawnEnemySync, removeEnemyInstance } from '../../server/engine/world.js';
import { describeZone } from '../../server/engine/commands/describe.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { on } from '../../server/engine/events.js';
import { getFlag, setFlag, clearFlag } from '../../server/engine/flags.js';
import { OPPOSITE } from '../../server/engine/directions.js';
import { effectiveSkill, awardSkillUse } from '../../server/engine/skills.js';
import { query } from '../../server/models/db.js';
import { randomUUID } from 'crypto';
import { loadWindow, getTraces, addTrace, claimTrace } from './traces.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const VOID_MAP = 'map_void'; // non-map_world → flag/map-filtered world iterators skip void rooms

// ── Voids (the region adjacency graph — skeleton stub) ────────────────────────
// A tile becomes an entry by carrying flags.void_gate = <voidKey> (+ flags.void_dir,
// the walk-off direction, default 'south'). A void has a shared `trunk` (room count
// before the fork) and `dests` — the adjacent regions it forks toward. Each dest
// carries the fork-exit `dir` (n/s/e/w) that leads to its limb, and an optional
// `length` override (else the total gate→dest length is distance-derived).
export const VOIDS = {
  southern_waste: {
    origin: 'Coldwater',
    trunk: 4,
    dests: [
      { key: 'reach',  dest: 'zone_the_reach_870_1958', heading: 'The Reach', dir: 'south' },
      { key: 'exodus', dest: 'zone_exodus_waypoint',    heading: 'Exodus',    dir: 'east'  },
    ],
  },
};

const crossings = new Map();
let _seq = 0;

function currentWindow() { return Math.floor(Date.now() / WEEK_MS); }

function voidGateOf(zone) {
  const key = zone?.flags?.void_gate;
  if (!key || !VOIDS[key]) return null;
  return { key, void: VOIDS[key], dir: zone.flags.void_dir || 'south' };
}
function destByHeading(vdef, heading) {
  if (!heading) return null;
  const h = heading.toLowerCase();
  return vdef.dests.find(d => d.heading.toLowerCase().includes(h) || d.key === h) || null;
}

// ── Distance-relative limb length ─────────────────────────────────────────────
const TILES_PER_ROOM = 90;
const MIN_ROOMS = 5;
const MAX_ROOMS = 15;
const DEFAULT_ROOMS = 8;

function gridDist(a, b) {
  if (!a || !b || a.grid_x == null || b.grid_x == null || a.grid_y == null || b.grid_y == null) return null;
  return Math.hypot(a.grid_x - b.grid_x, a.grid_y - b.grid_y);
}
// Total gate→dest room count (distance-derived, clamped; a dest `length` overrides).
function totalLength(dest, originZone, destZone) {
  if (dest.length) return dest.length;
  const d = gridDist(originZone, destZone);
  if (d == null) return DEFAULT_ROOMS;
  return Math.max(MIN_ROOMS, Math.min(MAX_ROOMS, Math.round(d / TILES_PER_ROOM)));
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
const DETOUR_NAMES = ['A Half-Buried Wreck', 'A Collapsed Bunker', "A Scavenger's Cache",
  'A Downed Hauler', 'A Wind-Scoured Ruin', 'A Sunken Rig', 'A Buried Silo'];
const DETOUR_DESCS = [
  'Wreckage juts from the dust off the line — the kind of place that swallows the desperate and, sometimes, rewards them. No telling which until you are in it.',
  'A dark opening in the ground, half-collapsed. Salvage, maybe. A grave, maybe. Both, maybe.',
  'Something went down out here long ago and was never picked clean — or it was, and what picked it is still around.',
  'A hulk of rusted metal leans in the haze. Worth a look, if the look does not cost you.',
];

// void_salt is the room's deterministic identity (the seed salt) — ghost-traces
// key on it so a scrawl/corpse pins to the same room across every instance this
// window. lawless: dying out here clone-vats you, never jails you (off-grid waste).
function mkRoom(id, voidKey, window, salt, exits, extraFlags = {}) {
  const rng = mulberry32(hashSeed(`${voidKey}|${window}|${salt}`));
  return {
    id, name: pick(rng, ROOM_NAMES), description: pick(rng, ROOM_DESCS),
    map_id: VOID_MAP, grid_x: null, grid_y: null, grid_z: null,
    flags: { terrain: pick(rng, TERRAINS), void_crossing: true, lawless: true, void_salt: salt, ...extraFlags },
    exits,
  };
}
function mkDetour(id, voidKey, window, salt, spineRoomId) {
  const rng = mulberry32(hashSeed(`${voidKey}|${window}|${salt}|d`));
  return {
    id, name: pick(rng, DETOUR_NAMES), description: pick(rng, DETOUR_DESCS),
    map_id: VOID_MAP, grid_x: null, grid_y: null, grid_z: null,
    flags: { terrain: pick(rng, TERRAINS), void_crossing: true, void_detour: true, lawless: true, void_salt: `d_${salt}` },
    exits: { east: spineRoomId }, // the only way out is back the way you came in
  };
}

// ── Encounters (Slice 2) ──────────────────────────────────────────────────────
const ENCOUNTER_CHANCE = 0.45;
const DETOUR_ENCOUNTER_CHANCE = 0.7;
const VOID_FOE_IDS = [
  'enemy_ash_crawler', 'enemy_bloated_mutant', 'enemy_rad_mutant', 'enemy_feral_dog',
  'enemy_wire_jackal', 'enemy_gutter_hound', 'enemy_scav', 'enemy_scrap_picker',
  'enemy_sprawl_ganger', 'enemy_slag_wretch', 'enemy_slag_wight',
];
let FOE_POOL = [];
let ENCOUNTERS_ON = true; // regress flips this off so movement tests stay deterministic

async function loadFoes() {
  try {
    const { rows } = await query('SELECT * FROM enemies WHERE id = ANY($1)', [VOID_FOE_IDS]);
    FOE_POOL = rows;
  } catch (e) { console.error('[wastecrossing] loadFoes:', e.message); }
  return FOE_POOL;
}
const ENCOUNTER_LINES = [
  'Something detaches from the haze and comes at you —',
  'A shape you took for a rock uncoils and charges —',
  'Grit scatters as it breaks cover —',
  'You are not alone out here. It was waiting —',
];
function spawnFoe(c, roomId) {
  if (!FOE_POOL.length) return null;
  const zone = getZone(roomId);
  if (!zone || zone.enemies.size > 0) return null;
  const template = FOE_POOL[Math.floor(Math.random() * FOE_POOL.length)];
  const inst = spawnEnemySync(template, roomId);
  c.enemies.add(inst.instanceId);
  const line = ENCOUNTER_LINES[Math.floor(Math.random() * ENCOUNTER_LINES.length)];
  sendToZone(roomId, { type: 'zone_event', message: `${line} <b>${inst.name}</b>.`, refresh: true });
  return inst;
}
// The dead are your map: show any scrawls/corpses left at this room this window.
function showTraces(actor, c, roomId) {
  const salt = getZone(roomId)?.flags?.void_salt;
  if (!salt) return;
  const trunk = VOIDS[c.voidKey].trunk;
  const lines = [];
  if (bigScoreOpen(c.voidKey, c.window, salt, trunk))
    lines.push("The hulk of a downed gunship dominates this stretch — real salvage in it, if it's still here. <b>(sift)</b>");
  for (const t of getTraces(c.voidKey, c.window, salt)) {
    if (t.kind === 'scrawl') lines.push(`Scratched into the ground, four letters: <b>${t.note}</b>`);
    else if (t.kind === 'corpse') lines.push(`A body half-buried in the dust${t.handle ? ` — what's left of <b>${t.handle}</b>` : ''}${t.note ? `, ${t.note.toLowerCase()}` : ''}.${!t.claimed && packItems(t.pack).length ? ' <b>(sift to strip it)</b>' : ''}`);
  }
  if (lines.length) sendToPlayer(actor.id, { type: 'output', message: lines.join('\n') });
}

function maybeEncounter(actor, c, roomId, chance) {
  if (!ENCOUNTERS_ON) return;
  const live = actor._crossing;
  if (!live) return;
  if (!live.seen) live.seen = new Set();
  if (live.seen.has(roomId)) return; // only the first time you reach a room
  live.seen.add(roomId);
  if (roomId === c.entry) return;    // the threshold room is a beat to breathe
  if (Math.random() >= chance) return;
  spawnFoe(c, roomId);
}

// ── Instance generation (trunk → fork → limbs → detours) ──────────────────────
function ensureInstance(instanceId, voidKey, window, origin) {
  let c = crossings.get(instanceId);
  if (c) return c;
  const vdef = VOIDS[voidKey];
  const originZone = getZone(origin);
  const roomSet = new Set(), detourSet = new Set(), destSet = new Set();

  // Shared trunk (linear). t0 exits back to the real origin tile.
  const trunkLen = Math.max(1, vdef.trunk);
  const trunkId = (i) => `${instanceId}_t${i}`;
  for (let i = 0; i < trunkLen; i++) {
    const exits = { north: i === 0 ? origin : trunkId(i - 1) };
    if (i < trunkLen - 1) exits.south = trunkId(i + 1); // fork's forward exits added below
    registerTransientZone(mkRoom(trunkId(i), voidKey, window, `t${i}`, exits));
    roomSet.add(trunkId(i));
  }
  const fork = trunkId(trunkLen - 1);

  // A limb per destination, forking off `fork` in the dest's `dir`.
  for (const d of vdef.dests) {
    destSet.add(d.dest);
    const total = totalLength(d, originZone, getZone(d.dest));
    const limbLen = Math.max(1, total - trunkLen);
    const limbId = (i) => `${instanceId}_${d.key}${i}`;
    for (let i = 0; i < limbLen; i++) {
      const exits = {};
      // The entry room hangs off the fork via the reciprocal of the fork's dir;
      // deeper rooms use north(back)/south(forward).
      exits[i === 0 ? OPPOSITE[d.dir] : 'north'] = i === 0 ? fork : limbId(i - 1);
      exits.south = i === limbLen - 1 ? d.dest : limbId(i + 1);
      registerTransientZone(mkRoom(limbId(i), voidKey, window, `${d.key}${i}`, exits));
      roomSet.add(limbId(i));
    }
    getZone(fork).exits[d.dir] = limbId(0); // fork → this limb
  }

  // Risk-for-loot detours off shared-trunk interior rooms (a `west` gamble).
  for (let i = 1; i < trunkLen - 1; i++) {
    const drng = mulberry32(hashSeed(`${voidKey}|${window}|t${i}|detour`));
    if (drng() < 0.5) addDetour(instanceId, voidKey, window, `t${i}`, trunkId(i), detourSet, roomSet);
  }
  if (detourSet.size === 0 && trunkLen >= 3) {
    const i = Math.floor(trunkLen / 2);
    addDetour(instanceId, voidKey, window, `t${i}`, trunkId(i), detourSet, roomSet);
  }

  c = {
    id: instanceId, voidKey, roomSet, detourSet, destSet, dests: vdef.dests,
    entry: trunkId(0), origin, window, members: new Set(), enemies: new Set(),
  };
  crossings.set(instanceId, c);
  return c;
}
function addDetour(instanceId, voidKey, window, salt, spineRoomId, detourSet, roomSet) {
  const id = `${instanceId}_d_${salt}`;
  registerTransientZone(mkDetour(id, voidKey, window, salt, spineRoomId));
  getZone(spineRoomId).exits.west = id;
  detourSet.add(id); roomSet.add(id);
}

function teardownInstance(c) {
  for (const eid of c.enemies) removeEnemyInstance(eid); // despawn spawned foes (no-op if already killed)
  for (const id of c.roomSet) removeTransientZone(id);   // trunk + limbs + detours
  crossings.delete(c.id);
}
async function clearCrossingFlags(player) {
  for (const k of ['crossing_void', 'crossing_window', 'crossing_room', 'crossing_origin', 'crossing_instance'])
    await clearFlag('player', k, player).catch(() => {});
}

// ── Entry (shared by the verb and the walk-off-map hook) ──────────────────────
async function enterMember(m, c, entry, origin) {
  removePlayerFromZone(m.id, m.current_zone);
  addPlayerToZone(m.id, entry.id);
  m.current_zone = entry.id;
  m._crossing = { instanceId: c.id, seen: new Set([entry.id]) };
  c.members.add(m.id);
  await query('UPDATE players SET current_zone=$1 WHERE id=$2', [entry.id, m.id]).catch(() => {});
  await setFlag('player', 'crossing_void', c.voidKey, m);
  await setFlag('player', 'crossing_window', String(c.window), m);
  await setFlag('player', 'crossing_origin', origin, m);
  await setFlag('player', 'crossing_instance', c.id, m);
  await setFlag('player', 'crossing_room', entry.id, m);
}

async function launchCrossing(leader, gate, broadcast, heading) {
  if (leader._crossing) return { type: 'emote', message: 'You are already out in the waste. The only way through it is through it.' };
  const origin = leader.current_zone;
  const window = currentWindow();
  await discoverRoutes(leader, gate.key); // striking out charts this gate's routes
  await loadWindow(gate.key, window); // warm the ghost-trace cache for this void+window
  const instanceId = `xing_${leader.id}_${++_seq}`;
  const c = ensureInstance(instanceId, gate.key, window, origin);
  const entry = getZone(c.entry);
  const aim = destByHeading(gate.void, heading);

  const followers = getAllLivePlayers().filter(p =>
    p.id !== leader.id && p.following === leader.id && p.current_zone === origin && !p._crossing);
  for (const m of [leader, ...followers]) await enterMember(m, c, entry, origin);

  if (broadcast) broadcast(origin, { type: 'zone_event', message: `${leader.handle}${followers.length ? ' and their party' : ''} walk out past the edge, into the waste.` }, leader.id);
  for (const f of followers) {
    const fdesc = await describeZone(entry, f);
    sendToPlayer(f.id, { type: 'move', message: `You follow ${leader.handle} out past the edge, into the waste.\n\n${fdesc}`, zone: entry.id, minimap: getMinimapData(entry.id, 8, f) });
  }
  const dests = gate.void.dests.map(d => d.heading).join(' or ');
  const aimLine = aim ? ` You set your heading for ${aim.heading}.` : '';
  const desc = await describeZone(entry, leader);
  return {
    type: 'move',
    message: `→ You strike out into the waste. The edge of the map falls away behind you and the road is gone — only the going. Somewhere ahead it splits toward ${dests}.${aimLine}\n\n${desc}`,
    zone: entry.id,
    minimap: getMinimapData(entry.id, 8, leader),
  };
}

async function cmdJourney(args, raw, player, broadcast) {
  if (player._crossing) return { type: 'emote', message: 'You are already out in the waste. The only way through it is through it.' };
  const gate = voidGateOf(getZone(player.current_zone));
  if (!gate) return { type: 'emote', message: 'There is nowhere to strike out into the waste from here.' };
  return launchCrossing(player, gate, broadcast, args.join(' ').trim());
}

async function onMovementEdge({ player, zone, direction, broadcast }) {
  if (player._crossing) return undefined;
  const gate = voidGateOf(zone);
  if (!gate || direction !== gate.dir) return undefined;
  return launchCrossing(player, gate, broadcast, null);
}

// ── The Frontier map (Slice 6): fogged discovery of regions + void-routes ─────
// You can't draw the void to scale, so the "map" is an abstract topology: origin
// regions, and the routes you've CHARTED (seen a gate) or SURVIVED (crossed). Fogged
// — what you haven't seen isn't on it. Stored per-player in a `frontier_log` flag
// (JSON routeId → state), written only on discovery/arrival (rare).
async function getFrontierLog(player) {
  try { return JSON.parse((await getFlag('player', 'frontier_log', player)) || '{}'); } catch { return {}; }
}
async function setFrontierState(player, routeId, state) {
  const log = await getFrontierLog(player);
  // never downgrade survived → charted
  if (log[routeId] === 'survived' && state !== 'survived') return;
  if (log[routeId] === state) return;
  log[routeId] = state;
  await setFlag('player', 'frontier_log', JSON.stringify(log), player).catch(() => {});
}
async function discoverRoutes(player, voidKey) {
  for (const d of VOIDS[voidKey].dests) await setFrontierState(player, `${voidKey}:${d.key}`, 'charted');
}
function markSurvived(player, voidKey, destKey) { return setFrontierState(player, `${voidKey}:${destKey}`, 'survived'); }

// The map data the Tablet Frontier app renders: origin regions → the routes you know.
export async function frontierView(player) {
  const log = await getFrontierLog(player);
  const regions = {};
  for (const [voidKey, vdef] of Object.entries(VOIDS)) {
    for (const d of vdef.dests) {
      const state = log[`${voidKey}:${d.key}`];
      if (!state) continue; // fogged — you haven't seen this route
      (regions[vdef.origin || 'the frontier'] ??= []).push({ heading: d.heading, state });
    }
  }
  return regions;
}

// `frontier` — read the signpost at a gate: where can you strike out to from here.
async function cmdFrontier(args, raw, player, broadcast) {
  const gate = voidGateOf(getZone(player.current_zone));
  if (!gate) return { type: 'emote', message: 'You see no way to strike out into the waste from here — find a perimeter gate. (Your charted routes are on the Tablet Frontier map.)' };
  await discoverRoutes(player, gate.key);
  const dests = gate.void.dests.map(d => `<b>${d.heading}</b>`).join(', ');
  return { type: 'output', message: `You read the waste from the edge. Somewhere out there, past the wind, the trail splits toward: ${dests}. (journey, or just walk off the edge — and pray the fork reads true.)` };
}

// ── `scrawl` — leave a four-letter mark for whoever comes next ─────────────────
async function cmdScrawl(args, raw, player, broadcast) {
  const live = player._crossing;
  const c = live && crossings.get(live.instanceId);
  if (!c) return { type: 'emote', message: 'There is nothing out here worth marking. (Scrawls are for the waste — you leave them for whoever comes after.)' };
  const text = args.join('').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  if (!text) return { type: 'error', message: 'Scrawl what? Four letters, max — a warning, a curse, a name. (scrawl RUN)' };
  const salt = getZone(player.current_zone)?.flags?.void_salt;
  if (!salt) return { type: 'emote', message: "The ground here won't hold a mark." };
  await addTrace(c.voidKey, c.window, salt, 'scrawl', player.handle, text);
  if (broadcast) broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} scratches something into the ground.` }, player.id);
  return { type: 'emote', message: `You scratch <b>${text}</b> into the hardpan. Whoever crosses here this window will find it — until the wind takes it.` };
}

// ── Reference-counted leave (arrived / bailed / died / tp'd) ──────────────────
function leaveCrossing(member, zone) {
  const live = member._crossing;
  delete member._crossing;
  clearCrossingFlags(member).catch(() => {});
  const c = live && crossings.get(live.instanceId);
  if (!c) return;
  c.members.delete(member.id);
  const dest = c.dests.find(d => d.dest === zone); // arrived at a region?
  if (dest) {
    sendToPlayer(member.id, { type: 'output', message: `<span class="item-grant">You stagger up out of the waste onto solid ground — <b>${dest.heading}</b>. You crossed it on foot.</span>` });
    markSurvived(member, c.voidKey, dest.key).catch(() => {}); // the route joins your charted frontier
  }
  if (c.members.size === 0) teardownInstance(c);
}

// ── Node tracking + teardown + encounters (every move) ────────────────────────
on('zone.entered', ({ actor, zone }) => {
  try {
    const live = actor?._crossing;
    if (!live) return;
    const c = crossings.get(live.instanceId);
    if (!c) { delete actor._crossing; return; }
    if (c.roomSet.has(zone)) { // a crossing room (trunk / limb / detour)
      showTraces(actor, c, zone);
      maybeEncounter(actor, c, zone, c.detourSet.has(zone) ? DETOUR_ENCOUNTER_CHANCE : ENCOUNTER_CHANCE);
      return; // crossing_room is RAM (player.current_zone); flushed lazily on logout, not per step
    }
    leaveCrossing(actor, zone); // left the void (arrived at a region, or bailed)
  } catch (e) { console.error('[wastecrossing] zone.entered error:', e.message); }
});

// ── RAM reclaim on a clean disconnect (crossing_room already persisted per move) ─
on('player.logout', ({ id }) => {
  try {
    const player = getLivePlayer(id);
    const live = player?._crossing;
    if (!live) return;
    setFlag('player', 'crossing_room', player.current_zone, player).catch(() => {}); // lazy flush for restart-relog
    const c = crossings.get(live.instanceId);
    delete player._crossing;
    if (c) { c.members.delete(id); if (c.members.size === 0) teardownInstance(c); }
  } catch (e) { console.error('[wastecrossing] player.logout error:', e.message); }
});

// ── `salvage` — scavenge a room (Slice 5) ─────────────────────────────────────
// Reuses the Scavenging skill + the 2d8−2d8 check. The waste's loot is generated in
// RAM (no DB scavenge tables — the rooms are transient): a room offers a richness
// tier (detours richer than the spine), and your Scavenging skill decides whether
// you reach the good stuff. Survival staples (water/rations) up top so scavenging
// literally extends your range; salvage/rare deeper. Once per room per crossing.
const LOOT = {
  1: { diff: 4,  items: ['item_water_bottle', 'item_ration', 'item_scrap_metal', 'item_tangled_wire'] },
  2: { diff: 8,  items: ['item_salvaged_wiring', 'item_cracked_circuit', 'item_scrap_ore', 'item_bar_jerky'] },
  3: { diff: 12, items: ['item_mystery_component', 'item_glowing_scrap', 'item_scrap_pistol'] },
};
let SALVAGE_FORCE = null; // regress override: null → real roll, 0/1 → forced fail/success
function roll2d8() { return Math.floor(Math.random() * 8) + 1 + Math.floor(Math.random() * 8) + 1; }
function packItems(pack) {
  if (Array.isArray(pack)) return pack;
  if (typeof pack === 'string') { try { return JSON.parse(pack) || []; } catch { return []; } }
  return pack || [];
}

// The weekly "big score" (Slice 5b): one telegraphed prize per (void, window), at a
// seeded shared-trunk room, kept globally scarce by a claim trace — first crosser to
// sift it takes it (the async race). Everyone this window sees the same wreck at the
// same room; whoever gets there first wins.
const BIGSCORE_POOL = ['item_scrap_pistol', 'item_mystery_component', 'item_glowing_scrap'];
function bigScoreSalt(voidKey, window, trunk) {
  const span = Math.max(1, trunk - 2);
  return `t${1 + (hashSeed(`${voidKey}|${window}|bigscore`) % span)}`;
}
function bigScoreItem(voidKey, window) {
  return pick(mulberry32(hashSeed(`${voidKey}|${window}|bigscore_item`)), BIGSCORE_POOL);
}
function bigScoreOpen(voidKey, window, salt, trunk) {
  return salt === bigScoreSalt(voidKey, window, trunk) && !getTraces(voidKey, window, salt).some(t => t.kind === 'bigscore_claim');
}

async function grantItem(playerId, itemId) {
  await query('INSERT INTO player_inventory (id, player_id, item_id, quantity, condition) VALUES ($1,$2,$3,1,1.0)', [randomUUID(), playerId, itemId]).catch(() => {});
  const { rows } = await query('SELECT name FROM items WHERE id=$1', [itemId]).catch(() => ({ rows: [] }));
  return rows?.[0]?.name || 'a piece of salvage';
}

// The engine's spawnPlayerCorpse already stripped the dead's gear into a
// player_corpses row at the death room — but that room tears down and orphans it.
// Capture the carried item ids, delete the orphaned corpse, and re-home the pack
// onto the shared void trace so another crosser (in their own instance) can loot it.
async function captureCorpsePack(playerId, deathZone) {
  try {
    const { rows: cr } = await query('SELECT id FROM player_corpses WHERE player_id=$1 AND zone_id=$2 ORDER BY created_at DESC LIMIT 1', [playerId, deathZone]);
    const corpseId = cr?.[0]?.id;
    if (!corpseId) return [];
    const { rows: items } = await query("SELECT item_id FROM player_inventory WHERE player_id=$1 AND item_id <> 'item_credit_chip' LIMIT 24", [corpseId]);
    const ids = items.map(r => r.item_id);
    await query('DELETE FROM player_inventory WHERE player_id=$1', [corpseId]).catch(() => {});
    await query('DELETE FROM player_corpses WHERE id=$1', [corpseId]).catch(() => {});
    return ids;
  } catch (e) { console.error('[wastecrossing] captureCorpsePack:', e.message); return []; }
}

async function cmdSift(args, raw, player, broadcast) {
  const live = player._crossing;
  const c = live && crossings.get(live.instanceId);
  if (!c) return { type: 'emote', message: "There's nothing out here worth picking through. (You sift the waste for salvage.)" };
  const roomId = player.current_zone;
  const salt = getZone(roomId)?.flags?.void_salt;
  if (!salt) return { type: 'emote', message: 'Nothing here but dust and wind.' };
  const trunk = VOIDS[c.voidKey].trunk;

  // 1. The weekly big score, first-come and gone (the async claim race).
  if (bigScoreOpen(c.voidKey, c.window, salt, trunk)) {
    const name = await grantItem(player.id, bigScoreItem(c.voidKey, c.window));
    await addTrace(c.voidKey, c.window, salt, 'bigscore_claim', player.handle, name);
    return { type: 'emote', message: `<span class="item-grant">You haul <b>${name}</b> out of the wreck — the prize this stretch of waste was hiding. It's gone now; word will spread.</span>` };
  }

  // 2. Strip the dead — a corpse-pack, first-come.
  const corpse = getTraces(c.voidKey, c.window, salt).find(t => t.kind === 'corpse' && !t.claimed && packItems(t.pack).length);
  if (corpse) {
    await claimTrace(corpse);
    const names = [];
    for (const itemId of packItems(corpse.pack)) names.push(await grantItem(player.id, itemId));
    return { type: 'emote', message: `<span class="item-grant">You strip what the waste left of ${corpse.handle || 'the dead'} — ${names.join(', ')}.</span>` };
  }

  // 3. Ambient scavenging (once per room).
  if (!live.scavenged) live.scavenged = new Set();
  if (live.scavenged.has(roomId)) return { type: 'emote', message: "You've already picked this spot clean." };
  live.scavenged.add(roomId);

  const isDetour = c.detourSet.has(roomId);
  const tiers = isDetour ? [2, 3] : [1, 2];       // detours hide the better hauls
  const tier = tiers[Math.floor(Math.random() * tiers.length)];
  const table = LOOT[tier];
  const itemId = table.items[Math.floor(Math.random() * table.items.length)];

  const effective = await effectiveSkill(player, 'scavenging');
  const margin = (effective - table.diff) + (roll2d8() - roll2d8());
  await awardSkillUse(player.id, 'scavenging', margin).catch(() => {}); // a near-miss still trains you
  const success = SALVAGE_FORCE != null ? SALVAGE_FORCE : margin >= 0;
  if (!success) return { type: 'emote', message: `You dig through the ${isDetour ? 'wreckage' : 'dust'} and come up with nothing but grit and disappointment.` };

  const name = await grantItem(player.id, itemId);
  return { type: 'emote', message: `<span class="item-grant">You dig ${name} out of the ${isDetour ? 'wreck' : 'waste'} and pocket it.</span>` };
}

// ── Death in the void: leave a corpse trace + clean up the crossing ───────────
// Respawn is an in-memory move (gameLoop), NOT a cmdMove, so zone.entered never
// fires on death — this is where a void crossing gets torn down. deathZone is still
// the void room here (teardown runs after), so its void_salt is available.
async function onVoidDeath({ player, deathZone, cause }) {
  try {
    const live = player?._crossing;
    if (!live) return;
    const c = crossings.get(live.instanceId);
    const salt = getZone(deathZone)?.flags?.void_salt;
    if (c && salt) {
      const pack = await captureCorpsePack(player.id, deathZone);
      await addTrace(c.voidKey, c.window, salt, 'corpse', player.handle, (cause?.label || 'killed by the waste').slice(0, 40), pack.length ? pack : null);
    }
    delete player._crossing;
    clearCrossingFlags(player).catch(() => {});
    if (c) { c.members.delete(player.id); if (c.members.size === 0) teardownInstance(c); }
  } catch (e) { console.error('[wastecrossing] player.death error:', e.message); }
}
on('player.death', onVoidDeath);

// ── Relog re-derivation (after a server restart wiped the RAM rooms) ──────────
on('player.login', async ({ id }) => {
  try {
    const player = getLivePlayer(id);
    if (!player) return;
    const voidKey = await getFlag('player', 'crossing_void', player);
    if (!voidKey) return;
    const instanceId = await getFlag('player', 'crossing_instance', player);
    if (!VOIDS[voidKey] || !instanceId) { await clearCrossingFlags(player); return; }
    const window = Number(await getFlag('player', 'crossing_window', player)) || currentWindow();
    const origin = (await getFlag('player', 'crossing_origin', player)) || null;
    await loadWindow(voidKey, window);

    const c = ensureInstance(instanceId, voidKey, window, origin);
    let roomId = await getFlag('player', 'crossing_room', player);
    if (!c.roomSet.has(roomId)) roomId = c.entry;
    const room = getZone(roomId);

    removePlayerFromZone(player.id, player.current_zone);
    addPlayerToZone(player.id, room.id);
    player.current_zone = room.id;
    player._crossing = { instanceId, seen: new Set([room.id]) };
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
  journey: cmdJourney,
  scrawl: cmdScrawl,
  sift: cmdSift,
  frontier: cmdFrontier,
};

export const hooks = {
  'movement.edge': onMovementEdge,
};

export const _test = {
  crossings, VOIDS, totalLength, TILES_PER_ROOM, MIN_ROOMS, MAX_ROOMS,
  loadFoes, spawnFoe, teardownInstance, LOOT, bigScoreSalt, handleDeath: onVoidDeath, frontierView, markSurvived,
  foePool: () => FOE_POOL,
  setEncounters: (on) => { ENCOUNTERS_ON = on; },
  setSalvage: (v) => { SALVAGE_FORCE = v; },
};

loadFoes(); // warm the void roster from the enemies table (one boot query)

console.log('[wastecrossing] Plugin loaded.');
